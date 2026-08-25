# Reservly iikoFront Bridge

Каркас плагина `iikoFront`, который собирает данные на фронтовой станции и отправляет их в backend `Reservly`.

Что уже заложено:

- проект под `.NET Framework 4.7.2`
- target на `iikoFront API V8` для совместимости с LT и более широким диапазоном версий `iikoRMS`
- `Manifest.xml` для установки в `iikoFront`
- `single-instance` режим в группе терминалов, чтобы не дублировать события с нескольких станций
- таймерный сбор snapshot-данных
- отправка батча в backend endpoint `POST /api/iiko/front/profiles/<id>/ingest/`
- collectors для сотрудников, явок, выручки, доставок, raw report snapshots, статусов отчетов, заказов столов, живой выручки, статуса bridge, lifecycle/audit заказов и сверки дня

Что важно заменить перед реальной установкой:

- `LicenseModuleId` в [src/Reservly.IikoFrontBridge/Manifest.xml](./src/Reservly.IikoFrontBridge/Manifest.xml)
- атрибут `PluginLicenseModuleId` в [BridgePlugin.cs](./src/Reservly.IikoFrontBridge/BridgePlugin.cs)
- `bridge.settings.json` лучше скачать из админки Reservly в профиле iiko нужного ресторана
- в production держите `diagnosticsLogLevel: "warn"`, чтобы локальный `logs/reservly-bridge.log` не заполнялся подробным `Info`

## Структура

- `src/Reservly.IikoFrontBridge/` — исходники плагина
- `example.settings.json` — пример конфига
- `bridge.settings.explained.jsonc` — пояснения ко всем настройкам

## Как ставить

1. Собрать DLL на Windows-машине с установленным iikoFront SDK.
2. В Reservly Admin открыть ресторан -> iiko -> скачать config bridge.
3. Создать отдельную папку плагина внутри `C:\Program Files\iiko\iikoRMS\Front.Net\Plugins\Reservly.IikoFrontBridge`.
4. Положить туда:
   - `Reservly.IikoFrontBridge.dll`
   - `Manifest.xml`
   - `bridge.settings.json`
   - DLL-зависимости из папки сборки, кроме iiko API contract assemblies
5. Перезапустить `iikoFront`.

`backendUrl`, `secret` и `installationId` в config привязывают эту установку к конкретному ресторану и конкретному `IikoProfile`.
Backend принимает secret только через заголовок `X-IikoFront-Secret`; query-string secret намеренно не поддерживается.

Начиная с `0.4.3` bridge не использует `System.Text.Json` и `System.Runtime.CompilerServices.Unsafe`: эти сборки не нужны в папке плагина и могут конфликтовать с `iikoFront` host на некоторых рабочих версиях.

Начиная с `0.4.4` bridge отправляет события маленькими пакетами по одному event. Если backend вернет `413 payload too large` на один тяжелый event, остальные события цикла все равно будут отправлены. Для production обычно держите `syncReportSnapshots: false`: live/order/revenue/audit данные собираются отдельными collectors, а raw snapshots фронтовых отчетов нужны только как fallback-диагностика.

Начиная с `0.4.5` рабочий режим не таскает 7-дневную историю на каждом poll. `pastOrdersLookbackDays` по умолчанию равен `2` только из-за бизнес-дня до `06:00`; тяжелые списки заказов/аудита/доставок дополнительно отправляются как дельта по измененным записям.

Начиная с `0.4.6`: при первом блюде с `costSum == 0` bridge один раз за процесс пишет в `logs/reservly-bridge.log` (уровень `WARNING`) все публичные scalar-свойства order item и его `Product` — используется для диагностики реального имени COGS-поля.

Начиная с `0.4.7`: себестоимость читается из документированного SDK-свойства `IOrderProductItem.Cost` (per-unit, как и `Price`, поэтому умножается на `Amount`), а не из угаданных `CardinalSum`/`CostSum`. См. https://iiko.github.io/front.api.sdk/v7/html/P_Resto_Front_Api_Data_Orders_IOrderProductItem_Cost.htm. Также убрано неверное использование `Cost` как фоллбэка для выручки (`netSum`) — `Cost` это COGS, а не сумма к оплате. Известный баг iiko (https://github.com/iiko/front.api.sdk/issues/533): на некоторых версиях `Cost` может совпадать с `Price` вместо реальной себестоимости — диагностика `0.4.6` остаётся как страховка, если `Cost` всё ещё нулевой.

Начиная с `0.4.8`: расследование расхождения "выручка по блюдам" vs "выручка ресторана" (ClosedSum). Свернуто по документации SDK (https://iiko.github.io/front.api.sdk/v8/html/N_Resto_Front_Api_Data_Orders.htm, https://iiko.github.io/front.api.sdk/v8/html/T_Resto_Front_Api_Data_Orders_IOrderCompoundItem.htm), не по угадыванию:
- Исправлено реальное имя свойства шаблона комбо-позиции — `IOrderCompoundItem.Template`, а не угаданное `CompoundItemTemplate` (которого не существует в SDK). Раньше комбо/сет-позиции (2 продукта в одном order item) никогда не резолвили имя и выпадали из аналитики блюд.
- `LiveRevenueCollector`: заказы, для которых `CollectItems` не нашёл ни одной позиции, раньше молча теряли всю выручку из аналитики блюд (лог шёл только в `PluginContext.Log`, локальный лог iikoFront, до backend не доходит). Теперь считается `ClosedOrdersSkippedNoItemsCount`/`Sum` и `DishRevenueSum`, лог идёт через `PluginDiagnostics` (уходит в backend через `bridge_status`) — расхождение станет измеримым по факту, а не гипотезой.
- Namespace `Resto.Front.Api.Data.Orders` кроме `IOrderProductItem` содержит `IOrderServiceItem` (почасовые услуги — бильярд/банкетный зал/караоке), `IDiscountItem`/`IAppliedDiscountItem` (скидки как order item), `IOrderModifierItem`. Заказ, где единственный распознанный item — не продукт (например, чисто сервисная позиция), законно не даёт ни одного блюда даже без бага; это не всегда двойной подсчёт.

Начиная с `0.4.9`: найдена и добавлена ранее не читавшаяся коллекция. `IOrder.Combos` (`IReadOnlyList<IOrderCombo>`, https://iiko.github.io/front.api.sdk/v8/html/P_Resto_Front_Api_Data_Orders_IOrder_Combos.htm) — это отдельная от `Items` коллекция для комбо/сет-предложений (бизнес-ланчи и т.п., иногда привязанные к программе лояльности через `ProgramId`). Раньше в `DirectItemCollectionNames` её не было вообще — такие заказы полностью выпадали из `CollectItems` и, соответственно, из аналитики блюд, не как "нечитаемое имя", а как полностью невидимая коллекция. `IOrderCombo` имеет собственные `Name`/`Price`/`Amount` прямо на верхнем уровне (в отличие от `IOrderProductItem`, где имя нужно доставать через `Product`), так что существующий `TryBuildItemRecord` подхватывает её без доработок — просто добавили `"Combos"` в список опрашиваемых коллекций. Дочерние позиции комбо (`OrderRootItemsByGroups`) пока не разбираются отдельно — комбо целиком попадает в аналитику одной строкой (напр. "Бизнес-ланч" x N), это самый безопасный вариант без догадок о распределении цены между составом.

## Что отправляется в backend

Плагин формирует envelope:

```json
{
  "installation_id": "lt-pilot-1",
  "terminal_name": "Manager station",
  "batch_id": "f5d53d4a6a0047cbacaa2b31c3d50f8b",
  "events": [
    {
      "type": "employees",
      "captured_at": "2026-05-27T10:00:00+03:00",
      "payload": {
        "employees": []
      }
    }
  ]
}
```

Поддержанные типы событий на backend:

- `ping`
- `employees`
- `attendance`
- `revenue`
- `deliveries`
- `report_snapshot`
- `report_snapshot_status`
- `table_orders`
- `live_revenue`
- `license_status`
- `bridge_status`
- `order_lifecycle`
- `order_audit`
- `daily_reconciliation`

Сейчас bridge реально собирает:

- `employees`
- `attendance` через `UserSessionChanged` и локальный агрегат сессий
- `revenue` через `GetPastOrders(...)`
- `deliveries`
- `report_snapshot`
- `report_snapshot_status` после каждой попытки снять отчет
- `table_orders` через full-scan `GetOrders(false, true)` для привязки столов к броням
- `live_revenue` через full-scan текущих заказов + `GetPastOrders(...)` + доставки; блюда для аналитики берутся только из закрытых past orders
- `license_status` для диагностики ModuleId, лицензии и slot
- `bridge_status` для статуса плагина, offline-очереди и активных флагов
- `order_lifecycle` при включенном `syncOrderLifecycle`
- `order_audit` при включенном `syncOrderAudit`: скидки, удаления блюд, сторно, возвраты, нефискал/без выручки
- `daily_reconciliation` при включенном `syncDailyReconciliation`

Что пока остается осторожной зоной:

- `attendance` можно вести двумя путями:
  - стабильно через `attendance`-event по сессиям пользователя
  - как fallback через `report_snapshot` по `EMPLOYEES_ATTENDANCES_REPORT`
- `report_snapshot` по явке зависит от контекста Front и может быть менее стабилен, чем session-based путь
- bridge не отправляет сырой `report_snapshot`, если markup не изменился или содержит `Отчет недоступен`, но отправляет `report_snapshot_status` с причиной
- открытые столы и предчеки больше не зависят только от `OrderChanged`: каждый live/table sync делает full-scan через `GetOrders(false, true)`
- session-based `attendance` начинает уходить только после накопления минимального порога минут из `bridge.settings.json`
- локальные диагностические логи bridge пишутся в `logs/reservly-bridge.log` рядом с DLL
- retryable-ошибки отправки складываются в `reservly-offline-queue` рядом с DLL и досылаются после восстановления связи
- backend пропускает дубликаты событий по idempotency key и не импортирует их второй раз
- в профиле iiko можно ротировать secret; предыдущий secret работает 24 часа для мягкой замены config
