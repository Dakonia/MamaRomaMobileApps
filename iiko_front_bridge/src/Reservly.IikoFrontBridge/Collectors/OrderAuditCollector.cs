using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using Resto.Front.Api;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Payments;

namespace Reservly.IikoFrontBridge.Collectors;

internal static class OrderAuditCollector
{
    private const string TypeDiscount = "discount";
    private const string TypeDeletedItem = "deleted_item";
    private const string TypePrebillCancelled = "prebill_cancelled";
    private const string TypeStorno = "storno";
    private const string TypeRefund = "refund";
    private const string TypePayment = "payment";
    private const string TypePaymentCancelled = "payment_cancelled";
    private const string TypeNonRevenuePayment = "non_revenue_payment";
    private const string TypeNonFiscalPayment = "non_fiscal_payment";
    private const string TypeVoidedOrder = "voided_order";

    private static readonly string[] DirectItemCollections =
    {
        "DeletedItems", "DeletedEntries", "RemovedItems", "RemovedEntries",
        "Items", "Entries", "OrderItems", "ProductItems", "Dishes",
    };

    private static readonly string[] NestedItemCollections =
    {
        "Components", "Items", "Entries", "Children", "ProductItems", "Parts", "AssignedModifiers",
    };

    public static FrontOrderAuditPayload Collect(LiveOrderCache orderCache, int lookbackDays, int businessDayEndHour)
    {
        var payload = new FrontOrderAuditPayload();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var guestResolver = new OrderGuestCountResolver();
        var paymentResolver = new OrderPaymentSnapshotResolver();
        guestResolver.AddOrders(orderCache?.GetKnownOrders());
        paymentResolver.AddOrders(orderCache?.GetKnownOrders());

        CollectCurrentOrders(payload, seen, guestResolver, paymentResolver);
        CollectPastOrders(payload, seen, lookbackDays, businessDayEndHour, guestResolver, paymentResolver);
        CollectDetectedPrebillCancellations(payload, seen, orderCache);

        PluginDiagnostics.Info($"OrderAuditCollector: built {payload.Events.Count} audit records.");
        return payload;
    }

    // OrderStatus в SDK не содержит факта "предчек отменён" (только New/Bill/Closed/Deleted),
    // поэтому ловим отмену как живой откат статуса Bill -> New (см. LiveOrderCache.OnOrderChanged)
    // и один раз забираем накопленные детекции здесь.
    private static void CollectDetectedPrebillCancellations(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        LiveOrderCache orderCache)
    {
        if (orderCache == null)
        {
            return;
        }

        foreach (var detection in orderCache.DrainDetectedPrebillCancellations())
        {
            try
            {
                var orderObj = (object)detection.Order;
                var orderId = FrontOrderScanner.GetOrderId(detection.Order);
                var orderNumber = OrderIntrospection.ReadOrderNumber(orderObj);
                var occurredAt = detection.DetectedAt.ToString("O", CultureInfo.InvariantCulture);
                var context = BuildOrderContext(orderObj, orderId, orderNumber, "New", occurredAt);

                AddEvent(
                    payload,
                    seen,
                    WithOrderContext(
                        new FrontOrderAuditRecord
                    {
                        AuditType = TypePrebillCancelled,
                        EventKey = OrderIntrospection.BuildEventKey(TypePrebillCancelled, orderId, occurredAt),
                        OccurredAt = occurredAt,
                        Reason = "Отмена предчека (обнаружено по возврату статуса счёта Bill -> New)",
                        Sum = FrontOrderValueReader.ReadOrderTotal(orderObj),
                    },
                        context)
                );
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"OrderAuditCollector: CollectDetectedPrebillCancellations skipped an order: {exc.Message}");
            }
        }
    }

    private static void CollectCurrentOrders(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        OrderGuestCountResolver guestResolver,
        OrderPaymentSnapshotResolver paymentResolver)
    {
        var scan = FrontOrderScanner.GetCurrentTableOrders();
        if (!scan.Success)
        {
            PluginDiagnostics.Info($"OrderAuditCollector: current orders scan failed: {scan.Error}");
            return;
        }

        foreach (var order in scan.Orders)
        {
            try
            {
                var orderObj = (object)order;
                var orderId = FrontOrderScanner.GetOrderId(order);
                var orderNumber = OrderIntrospection.ReadOrderNumber(orderObj);
                var status = FrontOrderScanner.GetStatus(order);
                var occurredAt = OrderIntrospection.ReadDateIso(orderObj, "CloseTime", "ClosedAt", "OpenTime", "OpenedAt");
                var context = BuildOrderContext(orderObj, orderId, orderNumber, status, occurredAt);
                guestResolver?.AddOrder(orderObj);
                paymentResolver?.AddOrder(orderObj);

                CollectDiscounts(payload, seen, orderObj, context, occurredAt);
                CollectDeletedItems(payload, seen, orderObj, context, occurredAt);
                CollectPrebillCancellation(payload, seen, orderObj, context, occurredAt);

                if (FrontOrderScanner.IsDeletedOrCancelled(status))
                {
                    AddEvent(
                        payload,
                        seen,
                        WithOrderContext(
                            new FrontOrderAuditRecord
                        {
                            AuditType = TypeVoidedOrder,
                            OccurredAt = occurredAt,
                            Reason = FrontOrderValueReader.ReadString(orderObj, "DeleteComment", "DeletionComment", "CancelComment", "Comment", "Reason"),
                            Sum = FrontOrderValueReader.ReadOrderTotal(orderObj),
                        },
                            context)
                    );
                }
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"OrderAuditCollector: current order skipped: {exc.Message}");
            }
        }
    }

    private static void CollectPastOrders(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        int lookbackDays,
        int businessDayEndHour,
        OrderGuestCountResolver guestResolver,
        OrderPaymentSnapshotResolver paymentResolver)
    {
        foreach (var order in PastOrderHelpers.GetRecentPastOrders(lookbackDays, businessDayEndHour))
        {
            try
            {
                var orderObj = (object)order;
                var orderId = PastOrderHelpers.GetOrderId(order);
                var orderNumber = OrderIntrospection.ReadOrderNumber(orderObj);
                var status = order.Deleted ? "Deleted" : order.Storned ? "Storned" : "Closed";
                var occurredAt = OrderIntrospection.ReadDateIso(order, "CloseTime", "ClosedAt", "WhenClosed");
                var context = BuildOrderContext(orderObj, orderId, orderNumber, status, occurredAt);
                if (context.GuestsCount <= 0)
                {
                    context.GuestsCount = guestResolver?.ReadPastOrderGuestCount(order) ?? 0;
                }

                CollectDiscounts(payload, seen, orderObj, context, occurredAt);
                CollectDeletedItems(payload, seen, orderObj, context, occurredAt);
                CollectPrebillCancellation(payload, seen, orderObj, context, occurredAt);
                CollectPaymentAudit(payload, seen, order, context, occurredAt, paymentResolver);

                if (order.Storned)
                {
                    var diagnostics = new Dictionary<string, object>();
                    var sum = PastOrderHelpers.SumPayments(order);
                    if (sum == 0m)
                    {
                        var diagnosticSum = FrontOrderValueReader.ReadOrderTotal(orderObj);
                        if (diagnosticSum == 0m)
                        {
                            diagnosticSum = SumDeletedItems(orderObj);
                        }
                        sum = diagnosticSum;
                        diagnostics["payment_sum_unavailable"] = "iikoFront API V8 returned zero opened payments for the storned order; diagnostic order/items sum is shown.";
                    }

                    AddEvent(
                        payload,
                        seen,
                        WithOrderContext(
                            new FrontOrderAuditRecord
                        {
                            AuditType = TypeStorno,
                            OccurredAt = occurredAt,
                            Reason = FirstNonEmpty(
                                FrontOrderValueReader.ReadString(orderObj, "StornoReason", "Reason", "Comment"),
                                FrontOrderValueReader.ReadNestedName(orderObj, "SourceOrderInfo"),
                                "Сторно заказа"
                            ),
                            Sum = sum,
                            Cost = sum,
                            Diagnostics = diagnostics,
                        },
                            context)
                    );
                }

                if (order.Deleted)
                {
                    AddEvent(
                        payload,
                        seen,
                        WithOrderContext(
                            new FrontOrderAuditRecord
                        {
                            AuditType = TypeVoidedOrder,
                            OccurredAt = occurredAt,
                            Reason = FrontOrderValueReader.ReadString(orderObj, "DeleteComment", "DeletionComment", "Reason", "Comment"),
                            Sum = PastOrderHelpers.SumPayments(order),
                        },
                            context)
                    );
                }
            }
            catch (Exception exc)
            {
                PluginDiagnostics.Info($"OrderAuditCollector: past order skipped: {exc.Message}");
            }
        }
    }

    private static void CollectDiscounts(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        object order,
        OrderContext context,
        string fallbackOccurredAt)
    {
        var customer = ReadCustomer(order);
        var orderCard = ReadDiscountCard(order);
        var iikoCard51Card = ReadIikoCard51DiscountCard(order);
        var orderCoupon = ReadCoupon(order);
        var grossSum = FrontOrderValueReader.ReadDecimal(order, "FullSum", "SumWithoutDiscounts", "Subtotal", "PriceSum");
        var netSum = FrontOrderValueReader.ReadDecimal(order, "ResultSum", "SumWithDiscounts", "TotalSum", "Sum");
        var discountSources = EnumerateDiscountApplications(order).ToList();
        var fallbackDifference = Math.Abs(grossSum - netSum);
        var orderCardProps = order == null ? new List<string>() : ScanCardRelatedProps(order);

        foreach (var discountSource in discountSources)
        {
            var discount = discountSource.Source;
            var discountItem = FrontOrderValueReader.ReadProperty(discount, "Discount")
                               ?? FrontOrderValueReader.ReadProperty(discount, "DiscountItem")
                               ?? discount;
            var discountType = ReadDiscountTypeObject(discountItem) ?? ReadDiscountTypeObject(discount);
            var appliedItems = ReadDiscountAppliedItems(discount);
            var sum = Math.Abs(FirstNonZero(
                FrontOrderValueReader.ReadDecimal(discount, "DiscountSum", "Sum", "Amount", "ResultSum", "Total"),
                FrontOrderValueReader.ReadDecimal(discountItem, "DiscountSum", "Sum", "Amount", "ResultSum", "Total"),
                appliedItems.Sum(item => Math.Abs(item.DiscountSum))
            ));
            if (sum == 0m && !discountSource.IsApplied && discountSources.Count == 1 && fallbackDifference > 0m)
            {
                sum = fallbackDifference;
            }
            if (sum == 0m && discountSource.IsMetadataFallback)
            {
                continue;
            }

            var employee = ReadPerson(discount, "User", "Employee", "Waiter", "Cashier");
            var meta = ReadDiscountMetadata(discountItem);
            var card = ReadDiscountCard(discount);
            var coupon = ReadCoupon(discount);
            var discountTypeId = FirstNonEmpty(
                FrontOrderValueReader.ReadString(discountType, "Id", "DiscountTypeId", "ExternalId"),
                FrontOrderValueReader.ReadString(discountItem, "Id", "DiscountId", "ExternalId")
            );
            var discountTypeName = FirstNonEmpty(
                FrontOrderValueReader.ReadString(discountType, "Name", "Title"),
                meta.Name,
                FrontOrderValueReader.ReadString(discount, "Name", "Reason", "Comment", "DiscountName")
            );
            var reason = FirstNonEmpty(
                FrontOrderValueReader.ReadString(discount, "Reason", "Comment", "DiscountName"),
                discountTypeName,
                "Скидка"
            );
            var percent = Math.Abs(FirstNonZero(
                FrontOrderValueReader.ReadDecimal(discount, "Percent", "PercentValue", "DiscountPercent", "Value"),
                meta.Percent
            ));
            if (percent == 0m && grossSum > 0m && sum > 0m)
            {
                percent = Math.Round(sum / grossSum * 100m, 2);
            }
            if (grossSum == 0m && netSum > 0m && sum > 0m)
            {
                grossSum = netSum + sum;
            }
            if (netSum == 0m && grossSum > 0m)
            {
                netSum = Math.Max(0m, grossSum - sum);
            }

            var occurredAt = FirstNonEmpty(
                OrderIntrospection.ReadDateIso(discount, "WhenApplied", "CreatedAt", "Date"),
                fallbackOccurredAt
            );
            var applicationId = FirstNonEmpty(
                FrontOrderValueReader.ReadString(discount, "Id", "AppliedDiscountId", "DiscountItemId"),
                string.Join(",", appliedItems.Select(item => item.ItemId).Where(id => !string.IsNullOrWhiteSpace(id)).ToArray())
            );

            AddEvent(
                payload,
                seen,
                WithOrderContext(
                    new FrontOrderAuditRecord
                {
                    AuditType = TypeDiscount,
                    EventKey = OrderIntrospection.BuildEventKey(
                        TypeDiscount,
                        context.OrderId,
                        discountTypeId,
                        discountTypeName,
                        percent,
                        sum,
                        applicationId,
                        occurredAt
                    ),
                    OccurredAt = occurredAt,
                    EmployeeFrontUserId = employee.Id,
                    EmployeeName = employee.Name,
                    CustomerName = customer.Name,
                    CustomerPhone = customer.Phone,
                    CardNumber = FirstNonEmpty(iikoCard51Card.Number, card.Number, orderCard.Number),
                    CardOwnerName = FirstNonEmpty(iikoCard51Card.OwnerName, card.OwnerName, orderCard.OwnerName),
                    CouponNumber = FirstNonEmpty(coupon.Number, orderCoupon.Number),
                    CouponSeries = FirstNonEmpty(coupon.Series, orderCoupon.Series),
                    Reason = reason,
                    Amount = percent,
                    Sum = sum,
                    Cost = sum,
                    GrossSum = grossSum,
                    NetSum = netSum,
                    DiscountTypeId = discountTypeId,
                    DiscountTypeName = discountTypeName,
                    DiscountPercent = percent,
                    DiscountSum = sum,
                    IsAutomatic = meta.IsAutomatic,
                    IsSelective = meta.IsSelective,
                    IsRounding = FrontOrderValueReader.ReadBool(discount, "IsRounding"),
                    AppliedItems = appliedItems,
                    Diagnostics = new Dictionary<string, object>
                    {
                        ["disc_card_num"] = card.Number,
                        ["disc_card_owner"] = card.OwnerName,
                        ["order_card_num"] = orderCard.Number,
                        ["order_card_owner"] = orderCard.OwnerName,
                        ["order_card_props"] = orderCardProps,
                        ["disc_props"] = ScanCardRelatedProps(discount),
                        ["disc_type"] = discount?.GetType().Name ?? string.Empty,
                        ["guest0_props"] = ScanAllProps(FrontOrderValueReader.ReadEnumerable(order, "Guests").FirstOrDefault()),
                        ["iiko51_card_num"] = iikoCard51Card.Number,
                        ["iiko51_card_owner"] = iikoCard51Card.OwnerName,
                    },
                },
                    context,
                    preserveEmployee: true)
            );
        }
    }

    private static void CollectDeletedItems(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        object order,
        OrderContext context,
        string fallbackOccurredAt)
    {
        foreach (var deletedItem in EnumerateDeletedItems(order))
        {
            var itemName = ReadItemName(deletedItem);
            if (string.IsNullOrWhiteSpace(itemName))
            {
                continue;
            }

            var amount = FrontOrderValueReader.ReadDecimal(deletedItem, "Amount", "Quantity", "Count");
            if (amount <= 0m)
            {
                amount = 1m;
            }
            var sum = Math.Abs(FrontOrderValueReader.ReadDecimal(deletedItem, "ResultSum", "Sum", "TotalSum", "FullSum", "Cost"));
            var price = Math.Abs(FrontOrderValueReader.ReadDecimal(deletedItem, "Price", "OpenPrice", "UnitPrice"));
            if (sum == 0m && price > 0m)
            {
                sum = price * amount;
            }

            var deletion = ReadDeletionDetails(deletedItem);
            var employee = ReadDeletionEmployee(deletedItem, deletion.Method);
            var waiter = OrderIntrospection.ReadWaiter(order);
            var authUser = ReadAuthorizationUser(deletedItem, deletion.Method, employee);
            var groupInfo = FrontOrderValueReader.ReadItemGroupInfo(deletedItem);
            var itemCreatedAt = OrderIntrospection.ReadDateIso(
                deletedItem,
                "WhenAddedToOrder", "AddedAt", "CreatedAt", "OrderedAt",
                "WhenOrdered", "OrderTime", "AddTime", "WhenAdded"
            );

            AddEvent(
                payload,
                seen,
                WithOrderContext(
                    new FrontOrderAuditRecord
                {
                    AuditType = TypeDeletedItem,
                    OccurredAt = FirstNonEmpty(
                        OrderIntrospection.ReadDateIso(deletedItem, "DeletedAt", "WhenDeleted", "DeletionTime", "RemovedAt"),
                        fallbackOccurredAt
                    ),
                    EmployeeFrontUserId = employee.Id,
                    EmployeeName = employee.Name,
                    WaiterFrontUserId = waiter.Id,
                    WaiterName = waiter.Name,
                    WaiterPhone = waiter.Phone,
                    Reason = deletion.Reason,
                    RemovalType = deletion.RemovalType,
                    RemovalComment = deletion.Comment,
                    WriteoffType = deletion.WriteoffType,
                    ItemName = itemName,
                    ItemGroupPath = groupInfo.groupPath,
                    ItemCategory = groupInfo.category,
                    ItemCreatedAt = itemCreatedAt,
                    AuthorizationUserName = authUser,
                    Amount = amount,
                    Sum = sum,
                    Cost = sum,
                    IsPrinted = deletion.IsPrinted,
                    IsNonRevenue = IsNonRevenueWriteoff(deletion.WriteoffType, deletion.RemovalType),
                    IsNonFiscal = IsNonFiscalWriteoff(deletion.WriteoffType, deletion.RemovalType),
                },
                    context,
                    preserveEmployee: true,
                    preserveWaiter: true)
            );
        }
    }

    private static void CollectPrebillCancellation(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        object orderObj,
        OrderContext context,
        string occurredAt)
    {
        var cancelledAt = FirstNonEmpty(
            OrderIntrospection.ReadDateIso(orderObj, "BillCancelTime", "BillCancelledAt", "PrebillCancelTime", "PrebillCancelledAt"),
            OrderIntrospection.ReadDateIso(orderObj, "PreBillCancelTime", "PreBillCancelledAt", "PrecheckCancelTime", "PrecheckCancelledAt"),
            OrderIntrospection.ReadDateIso(orderObj, "PreChequeCancelTime", "PreChequeCancelledAt")
        );
        var isCancelled = FrontOrderValueReader.ReadBool(
            orderObj,
            "IsBillCancelled", "BillCancelled", "IsPrebillCancelled", "PrebillCancelled",
            "IsPreBillCancelled", "PreBillCancelled", "IsPrecheckCancelled", "PrecheckCancelled",
            "IsPreChequeCancelled", "PreChequeCancelled"
        );
        if (!isCancelled && string.IsNullOrWhiteSpace(cancelledAt))
        {
            return;
        }

        AddEvent(
            payload,
            seen,
            WithOrderContext(
                new FrontOrderAuditRecord
            {
                AuditType = TypePrebillCancelled,
                OccurredAt = FirstNonEmpty(cancelledAt, occurredAt),
                Reason = FrontOrderValueReader.ReadString(
                    orderObj,
                    "BillCancelReason", "PrebillCancelReason", "PreBillCancelReason",
                    "PrecheckCancelReason", "PreChequeCancelReason", "CancelComment", "Reason", "Comment"
                ),
                Sum = FrontOrderValueReader.ReadOrderTotal(orderObj),
            },
                context)
        );
    }

    private static void CollectPaymentAudit(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        PastOrder order,
        OrderContext context,
        string occurredAt,
        OrderPaymentSnapshotResolver paymentResolver)
    {
        var paymentIndex = 0;
        foreach (var payment in order.Payments ?? Array.Empty<PastOrderPayment>())
        {
            if (payment == null)
            {
                continue;
            }

            var paymentType = PastOrderHelpers.GetPaymentTypeName(payment);
            var paymentKind = PastOrderHelpers.GetPaymentKindName(payment);
            var isNonRevenue = PastOrderHelpers.IsNonRevenuePayment(order, payment);
            var isNonFiscal = PastOrderHelpers.IsNonFiscalPayment(payment);
            var basePaymentKey = BuildBasePaymentKey(context, payment, paymentIndex, paymentType, paymentKind, occurredAt);

            var counteragent = PastOrderHelpers.GetPaymentCounteragent(payment);
            if (string.IsNullOrWhiteSpace(counteragent.Id) && string.IsNullOrWhiteSpace(counteragent.Name))
            {
                var snap = paymentResolver?.FindPaymentCounteragent(order, paymentType, payment.Sum);
                if (snap?.HasCounteragent == true)
                {
                    counteragent = new FrontOrderPersonInfo
                    {
                        Id = snap.CounteragentId,
                        Name = snap.CounteragentName,
                        Phone = snap.CounteragentPhone,
                    };
                }
            }

            AddPaymentEvent(payload, seen, TypePayment, order, context, occurredAt, payment, paymentType, paymentKind, isNonRevenue, isNonFiscal, basePaymentKey, counteragent);
            if (payment.Sum < 0m)
            {
                AddPaymentEvent(payload, seen, TypePaymentCancelled, order, context, occurredAt, payment, paymentType, paymentKind, isNonRevenue, isNonFiscal, basePaymentKey, counteragent);
                AddPaymentEvent(payload, seen, TypeRefund, order, context, occurredAt, payment, paymentType, paymentKind, isNonRevenue, isNonFiscal, basePaymentKey, counteragent);
            }
            if (isNonRevenue)
            {
                AddPaymentEvent(payload, seen, TypeNonRevenuePayment, order, context, occurredAt, payment, paymentType, paymentKind, true, isNonFiscal, basePaymentKey, counteragent);
            }
            if (isNonFiscal)
            {
                AddPaymentEvent(payload, seen, TypeNonFiscalPayment, order, context, occurredAt, payment, paymentType, paymentKind, isNonRevenue, true, basePaymentKey, counteragent);
            }
            paymentIndex++;
        }

        var unexposedNonRevenueSum = PastOrderHelpers.GetUnexposedNonRevenueSum(order);
        if (unexposedNonRevenueSum > 0m)
        {
            var basePaymentKey = BuildUnexposedNonRevenuePaymentKey(context, unexposedNonRevenueSum, occurredAt);
            var snapshot = paymentResolver?.FindNonRevenuePayment(order, unexposedNonRevenueSum);
            AddUnexposedNonRevenuePaymentEvent(payload, seen, TypePayment, order, context, occurredAt, unexposedNonRevenueSum, basePaymentKey, snapshot);
            AddUnexposedNonRevenuePaymentEvent(payload, seen, TypeNonRevenuePayment, order, context, occurredAt, unexposedNonRevenueSum, basePaymentKey, snapshot);
        }
    }

    private static void AddPaymentEvent(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        string auditType,
        PastOrder order,
        OrderContext context,
        string occurredAt,
        PastOrderPayment payment,
        string paymentType,
        string paymentKind,
        bool isNonRevenue,
        bool isNonFiscal,
        string basePaymentKey,
        FrontOrderPersonInfo counteragentOverride = null)
    {
        var counteragent = counteragentOverride ?? PastOrderHelpers.GetPaymentCounteragent(payment);
        var paymentComment = PastOrderHelpers.GetPaymentComment(order, payment);
        var diagnostics = new Dictionary<string, object>();
        if (string.IsNullOrWhiteSpace(paymentComment))
        {
            diagnostics["payment_comment"] = "iikoFront API V8 did not expose a dedicated payment comment for this payment.";
        }
        if (string.IsNullOrWhiteSpace(paymentType))
        {
            diagnostics["payment_type"] = "Payment type name was not exposed by iikoFront API V8.";
        }
        if (isNonRevenue)
        {
            diagnostics["non_revenue_classification"] = "Classified by payment kind/writeoff/discount flags or payment text fallback.";
        }

        AddEvent(
            payload,
            seen,
            WithOrderContext(
                new FrontOrderAuditRecord
            {
                AuditType = auditType,
                EventKey = OrderIntrospection.BuildEventKey(auditType, basePaymentKey),
                OccurredAt = occurredAt,
                Reason = FirstNonEmpty(
                    paymentComment,
                    FrontOrderValueReader.ReadString(payment, "Comment", "Reason", "AdditionalData"),
                    FrontOrderValueReader.ReadString(payment.PaymentType, "Comment", "PrintName"),
                    PastOrderHelpers.GetWriteoffReason(order)
                ),
                Sum = payment.Sum,
                Cost = payment.Sum,
                OrderWriteoffReason = PastOrderHelpers.GetWriteoffReason(order),
                BasePaymentKey = basePaymentKey,
                PaymentType = paymentType,
                PaymentTypeId = PastOrderHelpers.GetPaymentTypeId(payment),
                PaymentTypeCode = PastOrderHelpers.GetPaymentTypeCode(payment),
                PaymentKind = paymentKind,
                PaymentCategory = PastOrderHelpers.GetPaymentCategory(payment),
                PaymentCounteragentId = counteragent.Id,
                PaymentCounteragentName = counteragent.Name,
                PaymentCounteragentPhone = counteragent.Phone,
                PaymentComment = paymentComment,
                PaymentPrintCheque = PastOrderHelpers.ReadPaymentTypeBool(payment, "PrintCheque"),
                PaymentProcessAsDiscount = PastOrderHelpers.ReadPaymentTypeBool(payment, "ProcessAsDiscount"),
                PaymentFiscalizeAsDiscount = PastOrderHelpers.ReadPaymentTypeBool(payment, "FiscalizeAsDiscount"),
                PaymentIsPrepay = FrontOrderValueReader.ReadBool(payment, "IsPrepay"),
                PaymentIsWriteoff = PastOrderHelpers.IsWriteoffPayment(payment),
                PaymentIsRevenue = !isNonRevenue,
                IsNonRevenue = isNonRevenue,
                IsNonFiscal = isNonFiscal,
                Diagnostics = diagnostics,
            },
                context)
        );
    }

    private static void AddUnexposedNonRevenuePaymentEvent(
        FrontOrderAuditPayload payload,
        HashSet<string> seen,
        string auditType,
        PastOrder order,
        OrderContext context,
        string occurredAt,
        decimal sum,
        string basePaymentKey,
        OrderPaymentSnapshot paymentSnapshot)
    {
        var writeoffReason = PastOrderHelpers.GetWriteoffReason(order);
        var paymentComment = FirstNonEmpty(paymentSnapshot?.PaymentComment, writeoffReason);
        var paymentType = FirstNonEmpty(paymentSnapshot?.PaymentType, "Без выручки / тип оплаты не раскрыт iiko");
        var reason = FirstNonEmpty(
            paymentComment,
            "Закрытие без выручки: iikoFront не раскрыл PastOrderPayment"
        );
        var diagnostics = new Dictionary<string, object>
        {
            ["payment_not_exposed"] = "iikoFront API V8 returned no non-zero PastOrderPayment for a closed order with positive total.",
            ["non_revenue_classification"] = "Classified by positive order total with zero exposed payments; detailed writeoff category/comment may be unavailable in this iikoFront build.",
        };
        if (paymentSnapshot != null)
        {
            diagnostics["payment_snapshot_source"] = "Payment type was restored from live IOrder.Payments snapshot before PastOrder lost payment details.";
        }
        if (!string.IsNullOrWhiteSpace(paymentSnapshot?.WriteoffAuthorizationUserName))
        {
            diagnostics["writeoff_authorization_user"] = "Авторизовал списание: " + paymentSnapshot.WriteoffAuthorizationUserName;
        }
        if (paymentSnapshot?.WriteoffRatio != null)
        {
            diagnostics["writeoff_ratio"] = "Коэффициент списания: " + paymentSnapshot.WriteoffRatio.Value.ToString(CultureInfo.InvariantCulture);
        }
        if (string.IsNullOrWhiteSpace(paymentComment))
        {
            diagnostics["payment_comment"] = "iikoFront API V8 did not expose a dedicated payment/comment for this no-revenue closure.";
        }

        AddEvent(
            payload,
            seen,
            WithOrderContext(
                new FrontOrderAuditRecord
            {
                AuditType = auditType,
                EventKey = OrderIntrospection.BuildEventKey(auditType, basePaymentKey),
                OccurredAt = occurredAt,
                Reason = reason,
                Sum = sum,
                Cost = sum,
                GrossSum = sum,
                NetSum = 0m,
                OrderWriteoffReason = writeoffReason,
                BasePaymentKey = basePaymentKey,
                PaymentType = paymentType,
                PaymentTypeId = paymentSnapshot?.PaymentTypeId ?? string.Empty,
                PaymentTypeCode = paymentSnapshot?.PaymentTypeCode ?? string.Empty,
                PaymentKind = FirstNonEmpty(paymentSnapshot?.PaymentKind, "Writeoff"),
                PaymentCategory = FirstNonEmpty(paymentSnapshot?.PaymentCategory, "writeoff"),
                PaymentComment = paymentComment,
                PaymentPrintCheque = paymentSnapshot?.PaymentPrintCheque ?? false,
                PaymentProcessAsDiscount = paymentSnapshot?.PaymentProcessAsDiscount,
                PaymentFiscalizeAsDiscount = paymentSnapshot?.PaymentFiscalizeAsDiscount,
                PaymentIsWriteoff = true,
                PaymentIsRevenue = false,
                IsNonRevenue = true,
                IsNonFiscal = true,
                Diagnostics = diagnostics,
            },
                context)
        );
    }

    public static decimal SumDeletedItems(object order)
    {
        return EnumerateDeletedItems(order)
            .Sum(item => Math.Abs(FrontOrderValueReader.ReadDecimal(item, "ResultSum", "Sum", "TotalSum", "FullSum", "Cost")));
    }

    private sealed class OrderContext
    {
        public string OrderId { get; set; } = string.Empty;
        public string OrderNumber { get; set; } = string.Empty;
        public string OrderStatus { get; set; } = string.Empty;
        public string OpenedAt { get; set; } = string.Empty;
        public string ClosedAt { get; set; } = string.Empty;
        public string OccurredAt { get; set; } = string.Empty;
        public string TableNumber { get; set; } = string.Empty;
        public int GuestsCount { get; set; }
        public string OrderType { get; set; } = string.Empty;
        public string ServiceType { get; set; } = string.Empty;
        public string Source { get; set; } = string.Empty;
        public FrontOrderPersonInfo Employee { get; set; } = new FrontOrderPersonInfo();
        public FrontOrderPersonInfo Waiter { get; set; } = new FrontOrderPersonInfo();
    }

    private sealed class DiscountApplicationSource
    {
        public object Source { get; set; }
        public bool IsApplied { get; set; }
        public bool IsMetadataFallback { get; set; }
    }

    private static OrderContext BuildOrderContext(
        object order,
        string orderId,
        string orderNumber,
        string status,
        string occurredAt)
    {
        var waiter = ReadPerson(order, "Waiter", "Server");
        if (string.IsNullOrWhiteSpace(waiter.Id) && string.IsNullOrWhiteSpace(waiter.Name))
        {
            waiter = OrderIntrospection.ReadWaiter(order);
        }

        var employee = ReadPerson(order, "Cashier", "User", "Employee", "Manager", "Creator", "Author");
        return new OrderContext
        {
            OrderId = orderId,
            OrderNumber = orderNumber,
            OrderStatus = status,
            OpenedAt = OrderIntrospection.ReadDateIso(order, "OpenTime", "OpenedAt", "WhenOpened", "CreateTime", "CreatedAt"),
            ClosedAt = OrderIntrospection.ReadDateIso(order, "CloseTime", "ClosedAt", "WhenClosed"),
            OccurredAt = occurredAt,
            TableNumber = FrontOrderValueReader.GetFirstTableNumber(order),
            GuestsCount = FrontOrderValueReader.ReadGuestCount(order),
            OrderType = OrderIntrospection.ReadOrderTypeName(order),
            ServiceType = OrderIntrospection.ReadServiceType(order),
            Source = ReadOrderSource(order),
            Employee = employee,
            Waiter = waiter,
        };
    }

    private static FrontOrderAuditRecord WithOrderContext(
        FrontOrderAuditRecord record,
        OrderContext context,
        bool preserveEmployee = false,
        bool preserveWaiter = false)
    {
        if (record == null || context == null)
        {
            return record;
        }

        record.OrderId = FirstNonEmpty(record.OrderId, context.OrderId);
        record.OrderNumber = FirstNonEmpty(record.OrderNumber, context.OrderNumber);
        record.OrderStatus = FirstNonEmpty(record.OrderStatus, context.OrderStatus);
        record.OccurredAt = FirstNonEmpty(record.OccurredAt, context.OccurredAt);
        record.OpenedAt = FirstNonEmpty(record.OpenedAt, context.OpenedAt);
        record.ClosedAt = FirstNonEmpty(record.ClosedAt, context.ClosedAt);
        record.TableNumber = FirstNonEmpty(record.TableNumber, context.TableNumber);
        if (record.GuestsCount <= 0)
        {
            record.GuestsCount = context.GuestsCount;
        }
        record.OrderType = FirstNonEmpty(record.OrderType, context.OrderType);
        record.ServiceType = FirstNonEmpty(record.ServiceType, context.ServiceType);
        record.Source = FirstNonEmpty(record.Source, context.Source);

        if (!preserveEmployee || (string.IsNullOrWhiteSpace(record.EmployeeFrontUserId) && string.IsNullOrWhiteSpace(record.EmployeeName)))
        {
            record.EmployeeFrontUserId = FirstNonEmpty(record.EmployeeFrontUserId, context.Employee.Id);
            record.EmployeeName = FirstNonEmpty(record.EmployeeName, context.Employee.Name);
        }

        if (!preserveWaiter || (string.IsNullOrWhiteSpace(record.WaiterFrontUserId) && string.IsNullOrWhiteSpace(record.WaiterName)))
        {
            record.WaiterFrontUserId = FirstNonEmpty(record.WaiterFrontUserId, context.Waiter.Id);
            record.WaiterName = FirstNonEmpty(record.WaiterName, context.Waiter.Name);
            record.WaiterPhone = FirstNonEmpty(record.WaiterPhone, context.Waiter.Phone);
        }

        return record;
    }

    private static string BuildBasePaymentKey(
        OrderContext context,
        PastOrderPayment payment,
        int paymentIndex,
        string paymentType,
        string paymentKind,
        string occurredAt)
    {
        return OrderIntrospection.BuildEventKey(
            "payment",
            context == null ? string.Empty : context.OrderId,
            context == null ? string.Empty : context.OrderNumber,
            paymentIndex,
            PastOrderHelpers.GetPaymentTypeId(payment),
            PastOrderHelpers.GetPaymentTypeCode(payment),
            paymentType,
            paymentKind,
            payment == null ? 0m : payment.Sum,
            occurredAt
        );
    }

    private static string BuildUnexposedNonRevenuePaymentKey(OrderContext context, decimal sum, string occurredAt)
    {
        return OrderIntrospection.BuildEventKey(
            "payment",
            context == null ? string.Empty : context.OrderId,
            context == null ? string.Empty : context.OrderNumber,
            "unexposed-non-revenue",
            sum,
            occurredAt
        );
    }

    private static IEnumerable<DiscountApplicationSource> EnumerateDiscountApplications(object order)
    {
        var seenRefs = new HashSet<int>();
        var applied = new List<DiscountApplicationSource>();
        foreach (var collectionName in new[] { "AppliedDiscounts", "PaymentDiscounts" })
        {
            foreach (var item in FrontOrderValueReader.ReadEnumerable(order, collectionName))
            {
                if (seenRefs.Add(RuntimeHelpers.GetHashCode(item)))
                {
                    applied.Add(new DiscountApplicationSource { Source = item, IsApplied = true });
                }
            }
        }

        if (applied.Count > 0)
        {
            foreach (var item in applied)
            {
                yield return item;
            }
            yield break;
        }

        foreach (var collectionName in new[] { "Discounts", "DiscountItems", "DiscountsInfo" })
        {
            foreach (var item in FrontOrderValueReader.ReadEnumerable(order, collectionName))
            {
                if (seenRefs.Add(RuntimeHelpers.GetHashCode(item)))
                {
                    yield return new DiscountApplicationSource
                    {
                        Source = item,
                        IsApplied = false,
                        IsMetadataFallback = true,
                    };
                }
            }
        }
    }

    private static object ReadDiscountTypeObject(object discount)
    {
        if (discount == null)
        {
            return null;
        }

        return FrontOrderValueReader.ReadProperty(discount, "DiscountType")
               ?? FrontOrderValueReader.ReadProperty(discount, "Type")
               ?? FrontOrderValueReader.ReadProperty(discount, "MarketingCampaign");
    }

    private static List<FrontDiscountAppliedItemRecord> ReadDiscountAppliedItems(object appliedDiscount)
    {
        var result = new List<FrontDiscountAppliedItemRecord>();
        var map = FrontOrderValueReader.ReadProperty(appliedDiscount, "DiscountSumByOrderItemId")
                  ?? FrontOrderValueReader.ReadProperty(appliedDiscount, "DiscountByOrderItemId")
                  ?? FrontOrderValueReader.ReadProperty(appliedDiscount, "DiscountsByOrderItemId");
        var enumerable = map as IEnumerable;
        if (enumerable == null || map is string)
        {
            return result;
        }

        foreach (var entry in enumerable)
        {
            if (entry == null)
            {
                continue;
            }
            var key = FrontOrderValueReader.ReadProperty(entry, "Key");
            var value = FrontOrderValueReader.ReadProperty(entry, "Value");
            var itemId = key == null ? string.Empty : key.ToString();
            decimal sum;
            try
            {
                sum = Convert.ToDecimal(value, CultureInfo.InvariantCulture);
            }
            catch
            {
                sum = FrontOrderValueReader.ReadDecimal(entry, "Value");
            }

            result.Add(new FrontDiscountAppliedItemRecord
            {
                ItemId = itemId ?? string.Empty,
                DiscountSum = Math.Abs(sum),
            });
        }

        return result;
    }

    private static void AddEvent(FrontOrderAuditPayload payload, HashSet<string> seen, FrontOrderAuditRecord record)
    {
        if (string.IsNullOrWhiteSpace(record.EventKey))
        {
            record.EventKey = OrderIntrospection.BuildEventKey(
                record.AuditType,
                record.OrderId,
                record.OrderNumber,
                record.TableNumber,
                record.ItemName,
                record.BasePaymentKey,
                record.PaymentType,
                record.DiscountTypeId,
                record.DiscountSum,
                record.Reason,
                record.Sum,
                record.OccurredAt
            );
        }

        if (seen.Add(record.EventKey))
        {
            payload.Events.Add(record);
        }
    }

    private static IEnumerable<object> EnumerateDeletedItems(object order)
    {
        var seenRefs = new HashSet<int>();
        foreach (var collectionName in DirectItemCollections)
        {
            var forcedDeleted = collectionName.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0
                                || collectionName.IndexOf("Removed", StringComparison.OrdinalIgnoreCase) >= 0;
            foreach (var item in FrontOrderValueReader.ReadEnumerable(order, collectionName))
            {
                foreach (var nested in EnumerateDeletedItemRecursive(item, forcedDeleted, seenRefs, depth: 0))
                {
                    yield return nested;
                }
            }
        }

        var innerOrder = FrontOrderValueReader.ReadProperty(order, "Order");
        if (innerOrder != null && !ReferenceEquals(innerOrder, order))
        {
            foreach (var nested in EnumerateDeletedItems(innerOrder))
            {
                yield return nested;
            }
        }
    }

    private static IEnumerable<object> EnumerateDeletedItemRecursive(object item, bool forcedDeleted, HashSet<int> seenRefs, int depth)
    {
        if (item == null || depth > 4)
        {
            yield break;
        }

        var refId = RuntimeHelpers.GetHashCode(item);
        if (!seenRefs.Add(refId))
        {
            yield break;
        }

        if (forcedDeleted || IsDeletedItem(item))
        {
            yield return item;
        }

        foreach (var child in FrontOrderValueReader.ReadEnumerable(item, NestedItemCollections))
        {
            foreach (var nested in EnumerateDeletedItemRecursive(child, forcedDeleted: false, seenRefs, depth + 1))
            {
                yield return nested;
            }
        }
    }

    private static bool IsDeletedItem(object item)
    {
        if (FrontOrderValueReader.ReadBool(item, "Deleted", "IsDeleted", "Removed", "IsRemoved", "Voided", "IsVoided"))
        {
            return true;
        }

        var status = FrontOrderValueReader.ReadString(item, "Status", "State");
        return status.IndexOf("Deleted", StringComparison.OrdinalIgnoreCase) >= 0
               || status.IndexOf("Cancelled", StringComparison.OrdinalIgnoreCase) >= 0
               || status.IndexOf("Removed", StringComparison.OrdinalIgnoreCase) >= 0
               || status.IndexOf("Void", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private sealed class DeletionDetails
    {
        public string Reason { get; set; } = string.Empty;
        public string RemovalType { get; set; } = string.Empty;
        public string Comment { get; set; } = string.Empty;
        public string WriteoffType { get; set; } = string.Empty;
        public bool IsPrinted { get; set; }
        public object Method { get; set; }
    }

    private static DeletionDetails ReadDeletionDetails(object item)
    {
        var method = FrontOrderValueReader.ReadProperty(item, "DeletionMethod")
                     ?? FrontOrderValueReader.ReadProperty(item, "DeleteMethod")
                     ?? FrontOrderValueReader.ReadProperty(item, "RemovalMethod");
        var removalType = FrontOrderValueReader.ReadProperty(method, "RemovalType")
                          ?? FrontOrderValueReader.ReadProperty(item, "RemovalType")
                          ?? FrontOrderValueReader.ReadProperty(item, "DeletionReason")
                          ?? FrontOrderValueReader.ReadProperty(item, "DeleteReason")
                          ?? FrontOrderValueReader.ReadProperty(item, "RemovalReason")
                          ?? FrontOrderValueReader.ReadProperty(item, "Reason");

        var comment = FirstNonEmpty(
            FrontOrderValueReader.ReadString(method, "Comment", "DeletionComment", "DeleteComment", "RemovalComment", "Reason"),
            FrontOrderValueReader.ReadString(item, "DeletionComment", "DeleteComment", "RemovalComment", "Comment", "Reason")
        );
        var typeName = FirstNonEmpty(
            FrontOrderValueReader.ReadString(removalType, "Name", "Title"),
            FrontOrderValueReader.ReadNestedName(item, "DeletionReason", "DeleteReason", "RemovalReason", "Reason")
        );
        var writeoffType = FirstNonEmpty(
            FrontOrderValueReader.ReadString(removalType, "WriteoffType", "WriteOffType"),
            FrontOrderValueReader.ReadString(method, "WriteoffType", "WriteOffType"),
            FrontOrderValueReader.ReadString(item, "WriteoffType", "WriteOffType")
        );
        var reason = BuildReason(typeName, comment, writeoffType);

        return new DeletionDetails
        {
            Reason = reason,
            RemovalType = typeName,
            Comment = comment,
            WriteoffType = writeoffType,
            IsPrinted = FrontOrderValueReader.HasMeaningfulDate(item, "PrintTime", "PrintedAt", "WhenPrinted")
                        || FrontOrderValueReader.ReadBool(item, "IsPrinted", "Printed")
                        || FrontOrderValueReader.ReadString(item, "Status", "State").IndexOf("Printed", StringComparison.OrdinalIgnoreCase) >= 0,
            Method = method,
        };
    }

    private static FrontOrderPersonInfo ReadDeletionEmployee(object deletedItem, object deletionMethod)
    {
        var employee = ReadPerson(deletedItem, "DeletedBy", "RemovedBy", "User", "Employee", "Deleter", "Waiter", "Cashier", "Author");
        if (!string.IsNullOrWhiteSpace(employee.Id) || !string.IsNullOrWhiteSpace(employee.Name))
        {
            return employee;
        }

        employee = ReadPerson(deletedItem, "AuthUser", "Credentials");
        if (!string.IsNullOrWhiteSpace(employee.Id) || !string.IsNullOrWhiteSpace(employee.Name))
        {
            return employee;
        }

        return ReadPerson(deletionMethod, "User", "Employee", "Waiter", "Cashier", "Author", "AuthUser", "Credentials");
    }

    private static string ReadAuthorizationUser(object deletedItem, object deletionMethod, FrontOrderPersonInfo performer)
    {
        var authUser = ReadPerson(deletionMethod, "AuthUser", "Credentials", "Manager", "Supervisor", "AuthorizationUser", "AuthEmployee");
        if (string.IsNullOrWhiteSpace(authUser.Id) && string.IsNullOrWhiteSpace(authUser.Name))
        {
            authUser = ReadPerson(deletedItem, "AuthUser", "Credentials", "AuthorizationUser");
        }

        if (string.IsNullOrWhiteSpace(authUser.Name))
        {
            return string.Empty;
        }

        if (authUser.Id == performer.Id && authUser.Name == performer.Name)
        {
            return string.Empty;
        }

        return authUser.Name;
    }

    private static string BuildReason(string removalType, string comment, string writeoffType)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(removalType))
        {
            parts.Add(removalType.Trim());
        }
        if (!string.IsNullOrWhiteSpace(comment))
        {
            parts.Add(comment.Trim());
        }
        if (!string.IsNullOrWhiteSpace(writeoffType))
        {
            parts.Add("списание: " + writeoffType.Trim());
        }

        return string.Join("; ", parts);
    }

    private static bool IsNonRevenueWriteoff(string writeoffType, string removalType)
    {
        var value = (writeoffType + " " + removalType).Trim();
        return value.IndexOf("Cafe", StringComparison.OrdinalIgnoreCase) >= 0
               || value.IndexOf("Writeoff", StringComparison.OrdinalIgnoreCase) >= 0
               || value.IndexOf("Спис", StringComparison.OrdinalIgnoreCase) >= 0
               || value.IndexOf("Представ", StringComparison.OrdinalIgnoreCase) >= 0
               || value.IndexOf("Без выруч", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool IsNonFiscalWriteoff(string writeoffType, string removalType)
    {
        var value = (writeoffType + " " + removalType).Trim();
        return value.IndexOf("NonFiscal", StringComparison.OrdinalIgnoreCase) >= 0
               || value.IndexOf("Нефиск", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static string ReadItemName(object item)
    {
        var name = FrontOrderValueReader.ReadString(item, "ProductCustomName", "CustomName", "DishName", "Name", "Title");
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name;
        }

        return FrontOrderValueReader.ReadNestedName(item, "Product", "MenuItem", "Dish", "SimpleProduct", "Service");
    }

    private static FrontOrderPersonInfo ReadPerson(object obj, params string[] propertyNames)
    {
        foreach (var propertyName in propertyNames)
        {
            var personObj = FrontOrderValueReader.ReadProperty(obj, propertyName);
            if (personObj == null)
            {
                continue;
            }

            var person = new FrontOrderPersonInfo
            {
                Id = FrontOrderValueReader.ReadString(personObj, "Id", "UserId", "EmployeeId"),
                Name = FrontOrderValueReader.ReadString(personObj, "Name", "FullName", "DisplayName"),
                Phone = FrontOrderValueReader.ReadString(personObj, "CellPhone", "Phone", "MobilePhone"),
            };
            if (!string.IsNullOrWhiteSpace(person.Id) || !string.IsNullOrWhiteSpace(person.Name))
            {
                return person;
            }
        }

        return new FrontOrderPersonInfo();
    }

    private sealed class DiscountMetadata
    {
        public string Name { get; set; } = string.Empty;
        public decimal Percent { get; set; }
        public bool IsAutomatic { get; set; }
        public bool IsSelective { get; set; }
    }

    private sealed class CardInfo
    {
        public string Number { get; set; } = string.Empty;
        public string OwnerName { get; set; } = string.Empty;
    }

    // Кэш "номер карты -> имя владельца", чтобы не дёргать SearchDiscountCardByNumber
    // на каждый опрос для одних и тех же завсегдатаев. Владелец карты меняется крайне редко.
    private static readonly Dictionary<string, string> _cardOwnerCache =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    private static readonly object _cardOwnerCacheLock = new object();

    // order.IikoCard51Info.Coupon.Number — документированный путь к номеру карты лояльности
    // (см. IIikoCard51OrderInfo/IIikoCard51CouponInfo в iikoFront Front API V8 SDK). Сам купон
    // не содержит имени владельца — оно достаётся через реестр карт SearchDiscountCardByNumber.
    // Раньше код искал "IikoCard51Info.Coupons" (мн. число) как коллекцию — реальное свойство
    // называется "Coupon" (ед. число) и это одиночный объект, поэтому старый путь всегда был пуст.
    private static CardInfo ReadIikoCard51DiscountCard(object order)
    {
        var cardInfo = FrontOrderValueReader.ReadProperty(order, "IikoCard51Info");
        var coupon = FrontOrderValueReader.ReadProperty(cardInfo, "Coupon");
        var number = FrontOrderValueReader.ReadString(coupon, "Number");
        if (string.IsNullOrWhiteSpace(number))
        {
            return new CardInfo();
        }

        return new CardInfo { Number = number, OwnerName = ResolveCardOwnerName(number) };
    }

    private static string ResolveCardOwnerName(string cardNumber)
    {
        lock (_cardOwnerCacheLock)
        {
            if (_cardOwnerCache.TryGetValue(cardNumber, out var cached))
            {
                return cached;
            }
        }

        var ownerName = string.Empty;
        try
        {
            var card = PluginContext.Operations.SearchDiscountCardByNumber(cardNumber);
            if (card != null)
            {
                ownerName = card.OwnerName ?? string.Empty;
            }
        }
        catch (Exception exc)
        {
            PluginDiagnostics.Info($"OrderAuditCollector: SearchDiscountCardByNumber({cardNumber}) failed: {exc.Message}");
        }

        lock (_cardOwnerCacheLock)
        {
            _cardOwnerCache[cardNumber] = ownerName;
        }
        return ownerName;
    }

    private sealed class CouponInfo
    {
        public string Number { get; set; } = string.Empty;
        public string Series { get; set; } = string.Empty;
    }

    private static DiscountMetadata ReadDiscountMetadata(object discount)
    {
        var discountType = FrontOrderValueReader.ReadProperty(discount, "DiscountType")
                           ?? FrontOrderValueReader.ReadProperty(discount, "Type")
                           ?? FrontOrderValueReader.ReadProperty(discount, "Discount")
                           ?? FrontOrderValueReader.ReadProperty(discount, "MarketingCampaign");
        return new DiscountMetadata
        {
            Name = FirstNonEmpty(
                FrontOrderValueReader.ReadString(discount, "Name", "DiscountName"),
                FrontOrderValueReader.ReadString(discountType, "Name", "Title")
            ),
            Percent = Math.Abs(FirstNonZero(
                FrontOrderValueReader.ReadDecimal(discount, "Percent", "PercentValue", "DiscountPercent", "Value"),
                FrontOrderValueReader.ReadDecimal(discountType, "Percent", "PercentValue", "DiscountPercent", "Value")
            )),
            IsAutomatic = FrontOrderValueReader.ReadBool(discount, "IsAutomatic", "Automatic")
                          || FrontOrderValueReader.ReadBool(discountType, "IsAutomatic", "Automatic"),
            IsSelective = FrontOrderValueReader.ReadBool(discount, "IsSelectivelyApplied", "IsSelective")
                          || FrontOrderValueReader.ReadBool(discountType, "CanApplySelectively", "IsSelectivelyApplied", "IsSelective"),
        };
    }

    private static FrontOrderPersonInfo ReadCustomer(object order)
    {
        var person = ReadPerson(order, "Customer", "Client", "Guest", "DeliveryCustomer", "CustomerInfo");
        if (!string.IsNullOrWhiteSpace(person.Id) || !string.IsNullOrWhiteSpace(person.Name) || !string.IsNullOrWhiteSpace(person.Phone))
        {
            return person;
        }

        foreach (var guest in FrontOrderValueReader.ReadEnumerable(order, "Guests", "Customers"))
        {
            person = ReadPerson(guest, "Customer", "Client", "Guest", "Person");
            if (!string.IsNullOrWhiteSpace(person.Id) || !string.IsNullOrWhiteSpace(person.Name) || !string.IsNullOrWhiteSpace(person.Phone))
            {
                return person;
            }
        }

        return new FrontOrderPersonInfo
        {
            Name = FrontOrderValueReader.ReadString(order, "CustomerName", "ClientName", "GuestName"),
            Phone = FrontOrderValueReader.ReadString(order, "CustomerPhone", "ClientPhone", "Phone"),
        };
    }

    private static CardInfo ReadDiscountCard(object obj)
    {
        return ReadDiscountCard(obj, 0);
    }

    private static CardInfo ReadDiscountCard(object obj, int depth)
    {
        if (obj == null || depth > 3)
        {
            return new CardInfo();
        }

        var typeName = obj.GetType().Name ?? string.Empty;
        var canUseGenericNumber = typeName.IndexOf("Card", StringComparison.OrdinalIgnoreCase) >= 0
                                  || typeName.IndexOf("Loyalty", StringComparison.OrdinalIgnoreCase) >= 0;
        var directNumber = FirstNonEmpty(
            FrontOrderValueReader.ReadString(obj, "CardNumber", "CardTrack", "Track", "Identifier"),
            canUseGenericNumber ? FrontOrderValueReader.ReadString(obj, "Number") : string.Empty
        );
        var directOwnerName = FirstNonEmpty(
            FrontOrderValueReader.ReadString(obj, "OwnerName", "CustomerName", "ClientName", "GuestName", "MemberName", "HolderName", "CardHolderName"),
            FrontOrderValueReader.ReadNestedName(obj, "Owner", "Customer", "Client", "Guest", "Member", "Holder")
        );
        if (!string.IsNullOrWhiteSpace(directNumber) || !string.IsNullOrWhiteSpace(directOwnerName))
        {
            return new CardInfo { Number = directNumber, OwnerName = directOwnerName };
        }

        foreach (var propertyName in new[]
                 {
                     "DiscountCard", "Card", "IikoCard51Info", "CardInfo", "DiscountPaymentItem",
                     "PaymentItem", "CustomerCard", "LoyaltyCard", "GuestCard", "ClientCard",
                     "MemberCard", "BonusCard", "LoyaltyInfo", "GuestInfo", "MemberInfo",
                     "DiscountCardInfo", "AppliedCard",
                 })
        {
            var cardObj = FrontOrderValueReader.ReadProperty(obj, propertyName);
            if (cardObj == null)
            {
                continue;
            }

            var number = FirstNonEmpty(
                FrontOrderValueReader.ReadString(cardObj, "CardNumber", "Number", "Track", "Identifier", "CardTrack", "Code", "ExternalId"),
                string.Empty
            );
            var ownerName = FirstNonEmpty(
                FrontOrderValueReader.ReadString(cardObj, "OwnerName", "CustomerName", "ClientName", "GuestName", "MemberName", "HolderName"),
                FrontOrderValueReader.ReadNestedName(cardObj, "Owner", "Customer", "Client", "Guest", "Member", "Holder"),
                string.Empty
            );
            if (string.IsNullOrWhiteSpace(number) && string.IsNullOrWhiteSpace(ownerName))
            {
                var nested = ReadDiscountCard(cardObj, depth + 1);
                number = nested.Number;
                ownerName = nested.OwnerName;
            }
            if (!string.IsNullOrWhiteSpace(number) || !string.IsNullOrWhiteSpace(ownerName))
            {
                return new CardInfo { Number = number, OwnerName = ownerName };
            }
        }

        // Iterate collections that may contain card items: IikoCard51Info.Coupons, Cards, etc.
        foreach (var collectionName in new[] { "Coupons", "Cards", "DiscountCards", "LoyaltyCards", "ClientCards", "GuestCards" })
        {
            foreach (var item in FrontOrderValueReader.ReadEnumerable(obj, collectionName))
            {
                if (item == null)
                {
                    continue;
                }

                var number = FirstNonEmpty(
                    FrontOrderValueReader.ReadString(item, "CardNumber", "Number", "Code", "Track", "Identifier", "CardTrack"),
                    string.Empty
                );
                var ownerName = FirstNonEmpty(
                    FrontOrderValueReader.ReadString(item, "OwnerName", "Name", "CustomerName", "GuestName", "ClientName", "HolderName"),
                    FrontOrderValueReader.ReadNestedName(item, "Owner", "Customer", "Client", "Guest"),
                    string.Empty
                );
                if (!string.IsNullOrWhiteSpace(number) || !string.IsNullOrWhiteSpace(ownerName))
                {
                    return new CardInfo { Number = number, OwnerName = ownerName };
                }
            }
        }

        // At order level: walk Guests — iikoCard loyalty card holder is linked as a guest session
        if (depth == 0)
        {
            foreach (var guest in FrontOrderValueReader.ReadEnumerable(obj, "Guests"))
            {
                if (guest == null)
                {
                    continue;
                }

                var guestCard = ReadDiscountCard(guest, depth + 1);
                if (!string.IsNullOrWhiteSpace(guestCard.Number) || !string.IsNullOrWhiteSpace(guestCard.OwnerName))
                {
                    return guestCard;
                }
            }
        }

        return new CardInfo();
    }

    private static CouponInfo ReadCoupon(object obj)
    {
        var typeName = obj == null ? string.Empty : obj.GetType().Name ?? string.Empty;
        var canUseGenericNumber = typeName.IndexOf("Coupon", StringComparison.OrdinalIgnoreCase) >= 0;
        var directNumber = FirstNonEmpty(
            FrontOrderValueReader.ReadString(obj, "CouponNumber", "Code"),
            canUseGenericNumber ? FrontOrderValueReader.ReadString(obj, "Number") : string.Empty
        );
        var directSeries = FirstNonEmpty(
            FrontOrderValueReader.ReadString(obj, "CouponSeries"),
            canUseGenericNumber ? FrontOrderValueReader.ReadString(obj, "Series") : string.Empty
        );
        if (!string.IsNullOrWhiteSpace(directNumber) || !string.IsNullOrWhiteSpace(directSeries))
        {
            return new CouponInfo { Number = directNumber, Series = directSeries };
        }

        foreach (var propertyName in new[] { "Coupon", "CouponInfo", "IikoCard51CouponInfo", "DiscountCoupon" })
        {
            var couponObj = FrontOrderValueReader.ReadProperty(obj, propertyName);
            if (couponObj == null)
            {
                continue;
            }

            var number = FrontOrderValueReader.ReadString(couponObj, "Number", "CouponNumber", "Code");
            var series = FrontOrderValueReader.ReadString(couponObj, "Series", "CouponSeries");
            if (!string.IsNullOrWhiteSpace(number) || !string.IsNullOrWhiteSpace(series))
            {
                return new CouponInfo { Number = number, Series = series };
            }
        }

        return new CouponInfo();
    }

    private static string ReadOrderSource(object order)
    {
        var text = (OrderIntrospection.ReadOrderTypeName(order) + " " + OrderIntrospection.ReadServiceType(order)).Trim();
        if (text.IndexOf("Delivery", StringComparison.OrdinalIgnoreCase) >= 0
            || text.IndexOf("достав", StringComparison.OrdinalIgnoreCase) >= 0
            || text.IndexOf("pickup", StringComparison.OrdinalIgnoreCase) >= 0
            || text.IndexOf("самовывоз", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return "delivery";
        }

        return "table";
    }

    private static decimal FirstNonZero(params decimal[] values)
    {
        foreach (var value in values)
        {
            if (value != 0m)
            {
                return value;
            }
        }

        return 0m;
    }

    private static string FirstNonEmpty(string value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback ?? string.Empty : value;
    }

    private static string FirstNonEmpty(params string[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return string.Empty;
    }

    private static List<string> ScanCardRelatedProps(object obj)
    {
        if (obj == null) return new List<string>();
        try
        {
            return obj.GetType()
                .GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
                .Select(p => p.Name)
                .Where(n => n.IndexOf("card", StringComparison.OrdinalIgnoreCase) >= 0
                         || n.IndexOf("loyalty", StringComparison.OrdinalIgnoreCase) >= 0
                         || n.IndexOf("member", StringComparison.OrdinalIgnoreCase) >= 0
                         || n.IndexOf("discount", StringComparison.OrdinalIgnoreCase) >= 0
                         || n.IndexOf("coupon", StringComparison.OrdinalIgnoreCase) >= 0
                         || n.IndexOf("guest", StringComparison.OrdinalIgnoreCase) >= 0)
                .ToList();
        }
        catch
        {
            return new List<string>();
        }
    }

    private static List<string> ScanAllProps(object obj)
    {
        if (obj == null) return new List<string>();
        try
        {
            return obj.GetType()
                .GetProperties(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance)
                .Select(p => p.Name)
                .ToList();
        }
        catch
        {
            return new List<string>();
        }
    }
}
