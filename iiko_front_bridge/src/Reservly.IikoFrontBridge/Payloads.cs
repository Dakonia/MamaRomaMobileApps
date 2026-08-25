using System;
using System.Collections.Generic;

namespace Reservly.IikoFrontBridge;

internal sealed class FrontEnvelope
{
    public string InstallationId { get; set; } = string.Empty;
    public string TerminalName { get; set; } = string.Empty;
    public string BatchId { get; set; } = string.Empty;
    public List<FrontEventEnvelope> Events { get; set; } = new List<FrontEventEnvelope>();
}

internal sealed class FrontEventEnvelope
{
    public string Type { get; set; } = string.Empty;
    public DateTimeOffset CapturedAt { get; set; }
    public object Payload { get; set; } = new object();
}

internal sealed class FrontEmployeePayload
{
    public List<FrontEmployeeRecord> Employees { get; set; } = new List<FrontEmployeeRecord>();
}

internal sealed class FrontAttendancePayload
{
    public List<FrontAttendanceRecord> Records { get; set; } = new List<FrontAttendanceRecord>();
}

internal sealed class FrontAttendanceRecord
{
    public string FrontUserId { get; set; } = string.Empty;
    public string EmployeeName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string HoursWorked { get; set; } = string.Empty;
    public string ClockIn { get; set; } = string.Empty;
    public string ClockOut { get; set; } = string.Empty;
}

internal sealed class FrontEmployeeRecord
{
    public string FrontUserId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public List<string> Roles { get; set; } = new List<string>();
}

internal sealed class FrontDeliveriesPayload
{
    public List<FrontDeliveryRecord> Orders { get; set; } = new List<FrontDeliveryRecord>();
    public List<FrontDeliveryMetricRecord> Metrics { get; set; } = new List<FrontDeliveryMetricRecord>();
    public int OrdersWithoutAddress { get; set; }
    public int OrdersWithoutItems { get; set; }
}

internal sealed class FrontDeliveryItemRecord
{
    public string ProductId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal Price { get; set; }
    public decimal Cost { get; set; }
    public decimal CostSum { get; set; }
    public decimal GrossSum { get; set; }
    public decimal DiscountSum { get; set; }
    public decimal NetSum { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public string GroupPath { get; set; } = string.Empty;
    public string GroupLevel1 { get; set; } = string.Empty;
    public string GroupLevel2 { get; set; } = string.Empty;
    public string GroupLevel3 { get; set; } = string.Empty;
    public string ProductCategory { get; set; } = string.Empty;
    public string KitchenName { get; set; } = string.Empty;
}

internal sealed class FrontDeliveryRecord
{
    public string OrderId { get; set; } = string.Empty;
    public string OrderNumber { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string DeliveryAddress { get; set; } = string.Empty;
    public string DeliveryCity { get; set; } = string.Empty;
    public string DeliveryType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal TotalSum { get; set; }
    public string OrderAt { get; set; } = string.Empty;
    public string ClosedAt { get; set; } = string.Empty;
    public string DeliveryDate { get; set; } = string.Empty;
    public int GuestsCount { get; set; }
    public List<FrontDeliveryItemRecord> Items { get; set; } = new List<FrontDeliveryItemRecord>();
}

internal sealed class FrontDeliveryMetricRecord
{
    public string Date { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public int OrdersCount { get; set; }
}

internal sealed class FrontTableOrdersPayload
{
    public List<FrontTableOrderRecord> Orders { get; set; } = new List<FrontTableOrderRecord>();
}

internal sealed class FrontTableOrderRecord
{
    public string OrderId { get; set; } = string.Empty;
    public string TableNumber { get; set; } = string.Empty;
    public string OpenedAt { get; set; } = string.Empty;
    public string ClosedAt { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal TotalSum { get; set; }
    public decimal DiscountSum { get; set; }
    public int GuestsCount { get; set; }
    public List<FrontDeliveryItemRecord> Items { get; set; } = new List<FrontDeliveryItemRecord>();
    public string WaiterFrontUserId { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public string WaiterPhone { get; set; } = string.Empty;
}

internal sealed class FrontRevenuePayload
{
    public List<FrontRevenueDayRecord> Days { get; set; } = new List<FrontRevenueDayRecord>();
}

internal sealed class FrontRevenueDayRecord
{
    public string Date { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public decimal RevenueAmount { get; set; }
    public decimal NonRevenueAmount { get; set; }
    public decimal CashAmount { get; set; }
    public decimal CardAmount { get; set; }
    public decimal FiscalAmount { get; set; }
    public decimal NonFiscalAmount { get; set; }
    public int ReceiptsCount { get; set; }
    public int GuestsCount { get; set; }
}

internal sealed class ReportSnapshotPayload
{
    public string ReportId { get; set; } = string.Empty;
    public string Markup { get; set; } = string.Empty;
    public string CurrentUser { get; set; } = string.Empty;
    public string CashRegister { get; set; } = string.Empty;
    public bool Unavailable { get; set; }
}

internal sealed class ReportSnapshotResult
{
    public ReportSnapshotPayload Payload { get; set; } = new ReportSnapshotPayload();
    public string PayloadHash { get; set; } = string.Empty;
    public bool IsUnavailable { get; set; }
}

internal sealed class ReportSnapshotStatusPayload
{
    public string ReportId { get; set; } = string.Empty;
    public string AttemptedAt { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public int MarkupLength { get; set; }
    public string CurrentUser { get; set; } = string.Empty;
    public string CashRegister { get; set; } = string.Empty;
    public bool Unavailable { get; set; }
    public string Error { get; set; } = string.Empty;
}

internal sealed class LicenseStatusPayload
{
    public int ModuleId { get; set; }
    public string CheckedAt { get; set; } = string.Empty;
    public bool Enabled { get; set; }
    public bool SlotAcquired { get; set; }
    public string PluginVersion { get; set; } = string.Empty;
    public string Error { get; set; } = string.Empty;
}

internal sealed class BridgeStatusPayload
{
    public string CapturedAt { get; set; } = string.Empty;
    public string TerminalName { get; set; } = string.Empty;
    public string PluginVersion { get; set; } = string.Empty;
    public string Api { get; set; } = string.Empty;
    public bool OfflineQueueEnabled { get; set; }
    public int OfflineQueueDepth { get; set; }
    public string OfflineQueueOldestAt { get; set; } = string.Empty;
    public string LastPushSuccessAt { get; set; } = string.Empty;
    public string LastPushErrorAt { get; set; } = string.Empty;
    public string LastPushError { get; set; } = string.Empty;
    public Dictionary<string, object> Config { get; set; } = new Dictionary<string, object>();
    public List<string> RecentLogs { get; set; } = new List<string>();
}

internal sealed class OfflineQueueStats
{
    public int Depth { get; set; }
    public DateTimeOffset? OldestAt { get; set; }
}

internal sealed class FrontOrderLifecyclePayload
{
    public List<FrontOrderLifecycleRecord> Orders { get; set; } = new List<FrontOrderLifecycleRecord>();
}

internal sealed class FrontOrderLifecycleRecord
{
    public string OrderId { get; set; } = string.Empty;
    public string OrderNumber { get; set; } = string.Empty;
    public string TableNumber { get; set; } = string.Empty;
    public string OrderType { get; set; } = string.Empty;
    public string ServiceType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string WaiterFrontUserId { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public string OpenedAt { get; set; } = string.Empty;
    public string PrebillAt { get; set; } = string.Empty;
    public string ClosedAt { get; set; } = string.Empty;
    public string CancelledAt { get; set; } = string.Empty;
    public decimal TotalSum { get; set; }
    public decimal PaidSum { get; set; }
    public decimal RevenueSum { get; set; }
    public decimal NonRevenueSum { get; set; }
    public decimal FiscalSum { get; set; }
    public decimal NonFiscalSum { get; set; }
    public decimal DiscountSum { get; set; }
    public int GuestsCount { get; set; }
    public int ItemsCount { get; set; }
    public List<FrontDeliveryItemRecord> Items { get; set; } = new List<FrontDeliveryItemRecord>();
}

internal sealed class FrontOrderAuditPayload
{
    public List<FrontOrderAuditRecord> Events { get; set; } = new List<FrontOrderAuditRecord>();
}

internal sealed class FrontOrderAuditRecord
{
    public string EventKey { get; set; } = string.Empty;
    public string AuditType { get; set; } = string.Empty;
    public string OrderId { get; set; } = string.Empty;
    public string OrderNumber { get; set; } = string.Empty;
    public string OrderStatus { get; set; } = string.Empty;
    public string OccurredAt { get; set; } = string.Empty;
    public string OpenedAt { get; set; } = string.Empty;
    public string ClosedAt { get; set; } = string.Empty;
    public string TableNumber { get; set; } = string.Empty;
    public int GuestsCount { get; set; }
    public string OrderType { get; set; } = string.Empty;
    public string ServiceType { get; set; } = string.Empty;
    public string EmployeeFrontUserId { get; set; } = string.Empty;
    public string EmployeeName { get; set; } = string.Empty;
    public string WaiterFrontUserId { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public string WaiterPhone { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string CardNumber { get; set; } = string.Empty;
    public string CardOwnerName { get; set; } = string.Empty;
    public string CouponNumber { get; set; } = string.Empty;
    public string CouponSeries { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string RemovalType { get; set; } = string.Empty;
    public string RemovalComment { get; set; } = string.Empty;
    public string WriteoffType { get; set; } = string.Empty;
    public string ItemName { get; set; } = string.Empty;
    public string ItemGroupPath { get; set; } = string.Empty;
    public string ItemCategory { get; set; } = string.Empty;
    public string ItemCreatedAt { get; set; } = string.Empty;
    public string AuthorizationUserName { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public decimal Sum { get; set; }
    public decimal Cost { get; set; }
    public decimal GrossSum { get; set; }
    public decimal NetSum { get; set; }
    public string OrderWriteoffReason { get; set; } = string.Empty;
    public string BasePaymentKey { get; set; } = string.Empty;
    public string PaymentType { get; set; } = string.Empty;
    public string PaymentTypeId { get; set; } = string.Empty;
    public string PaymentTypeCode { get; set; } = string.Empty;
    public string PaymentKind { get; set; } = string.Empty;
    public string PaymentCategory { get; set; } = string.Empty;
    public string PaymentCounteragentId { get; set; } = string.Empty;
    public string PaymentCounteragentName { get; set; } = string.Empty;
    public string PaymentCounteragentPhone { get; set; } = string.Empty;
    public string PaymentComment { get; set; } = string.Empty;
    public bool? PaymentPrintCheque { get; set; }
    public bool? PaymentProcessAsDiscount { get; set; }
    public bool? PaymentFiscalizeAsDiscount { get; set; }
    public bool PaymentIsPrepay { get; set; }
    public bool PaymentIsWriteoff { get; set; }
    public bool PaymentIsRevenue { get; set; }
    public string DiscountTypeId { get; set; } = string.Empty;
    public string DiscountTypeName { get; set; } = string.Empty;
    public decimal DiscountPercent { get; set; }
    public decimal DiscountSum { get; set; }
    public bool IsAutomatic { get; set; }
    public bool IsSelective { get; set; }
    public bool IsRounding { get; set; }
    public bool IsPrinted { get; set; }
    public bool IsNonRevenue { get; set; }
    public bool IsNonFiscal { get; set; }
    public List<FrontDiscountAppliedItemRecord> AppliedItems { get; set; } = new List<FrontDiscountAppliedItemRecord>();
    public Dictionary<string, object> Diagnostics { get; set; } = new Dictionary<string, object>();
}

internal sealed class FrontDiscountAppliedItemRecord
{
    public string ItemId { get; set; } = string.Empty;
    public decimal DiscountSum { get; set; }
}

internal sealed class FrontDailyReconciliationPayload
{
    public List<FrontDailyReconciliationRecord> Days { get; set; } = new List<FrontDailyReconciliationRecord>();
}

internal sealed class FrontDailyReconciliationRecord
{
    public string Date { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RevenueAmount { get; set; }
    public decimal FiscalAmount { get; set; }
    public decimal NonFiscalAmount { get; set; }
    public decimal NonRevenueAmount { get; set; }
    public int ClosedOrdersCount { get; set; }
    public int DeletedOrdersCount { get; set; }
    public int StornoOrdersCount { get; set; }
    public decimal DiscountsAmount { get; set; }
    public decimal DeletedItemsAmount { get; set; }
    public decimal LiveClosedSum { get; set; }
    public decimal RevenueEntrySum { get; set; }
    public decimal DifferenceSum { get; set; }
    public List<string> Warnings { get; set; } = new List<string>();
    public string CapturedAt { get; set; } = string.Empty;
}

internal sealed class FrontLiveRevenuePayload
{
    public string Date { get; set; } = string.Empty;
    public string CapturedAt { get; set; } = string.Empty;
    // Table orders
    public int OpenCount { get; set; }
    public decimal OpenSum { get; set; }
    public int OpenGuestsCount { get; set; }
    public int PrebillCount { get; set; }
    public decimal PrebillSum { get; set; }
    public int PrebillGuestsCount { get; set; }
    public int CurrentOrdersWithItems { get; set; }
    public int CurrentOrdersWithoutItems { get; set; }
    public int CurrentOrderItemsCount { get; set; }
    public int CurrentOrdersSkippedClosed { get; set; }
    public int ClosedCount { get; set; }
    public decimal ClosedSum { get; set; }
    public int ClosedGuestsCount { get; set; }
    // Диагностика расхождения "выручка по блюдам" vs "выручка ресторана" (ClosedSum/DeliverySum
    // считаются по оплатам заказа независимо от того, распознали ли мы его позиции):
    public decimal DishRevenueSum { get; set; }
    public int ClosedOrdersSkippedNoItemsCount { get; set; }
    public decimal ClosedOrdersSkippedNoItemsSum { get; set; }
    // Delivery orders (open right now)
    public int DeliveryCount { get; set; }
    public decimal DeliverySum { get; set; }
    public int DeliveryGuestsCount { get; set; }
    public List<FrontWaiterDayRecord> Waiters { get; set; } = new List<FrontWaiterDayRecord>();
    public List<FrontDishRecord> Dishes { get; set; } = new List<FrontDishRecord>();
}

internal sealed class FrontWaiterDayRecord
{
    public string WaiterFrontUserId { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public string WaiterPhone { get; set; } = string.Empty;
    public int OrdersCount { get; set; }
    public int GuestsCount { get; set; }
    public decimal TotalSum { get; set; }
}

internal sealed class FrontStopListPayload
{
    public string CapturedAt { get; set; } = string.Empty;
    public List<FrontStopListItemRecord> Items { get; set; } = new List<FrontStopListItemRecord>();
}

internal sealed class FrontStopListItemRecord
{
    public string ProductId { get; set; } = string.Empty;
    public string ProductName { get; set; } = string.Empty;
    public string SizeId { get; set; } = string.Empty;
    public string SizeName { get; set; } = string.Empty;
    public decimal RemainingAmount { get; set; }
    public bool IsRestricted { get; set; }
    public string GroupName { get; set; } = string.Empty;
    public string GroupPath { get; set; } = string.Empty;
    public string GroupLevel1 { get; set; } = string.Empty;
    public string GroupLevel2 { get; set; } = string.Empty;
    public string GroupLevel3 { get; set; } = string.Empty;
    public string ProductCategory { get; set; } = string.Empty;
}

internal sealed class FrontDishRecord
{
    public string Date { get; set; } = string.Empty;
    public string DishName { get; set; } = string.Empty;
    public string ProductId { get; set; } = string.Empty;
    public string GroupName { get; set; } = string.Empty;
    public string GroupPath { get; set; } = string.Empty;
    public string GroupLevel1 { get; set; } = string.Empty;
    public string GroupLevel2 { get; set; } = string.Empty;
    public string GroupLevel3 { get; set; } = string.Empty;
    public string ProductCategory { get; set; } = string.Empty;
    public string KitchenName { get; set; } = string.Empty;
    public string Source { get; set; } = string.Empty;
    public string WaiterFrontUserId { get; set; } = string.Empty;
    public string WaiterName { get; set; } = string.Empty;
    public string WaiterPhone { get; set; } = string.Empty;
    public int Count { get; set; }
    public decimal Revenue { get; set; }
    public decimal GrossRevenue { get; set; }
    public decimal DiscountSum { get; set; }
    public decimal NetRevenue { get; set; }
    public decimal NonRevenueSum { get; set; }
    public decimal CostSum { get; set; }
    public decimal MinPrice { get; set; }
    public decimal MaxPrice { get; set; }
    public decimal LastPrice { get; set; }
}

internal sealed class FrontCashSessionPayload
{
    public string BusinessDate { get; set; } = string.Empty;
    public string DetectedAt { get; set; } = string.Empty;
}
