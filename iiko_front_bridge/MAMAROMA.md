# Интеграция с приложением Mama Roma

Отдельный контур внутри плагина. Работа с Reservly не затронута: свой таймер,
свой клиент, свой секрет. Секция выключена — ни одна строчка этого кода
не исполняется.

## Что где лежит

```
src/Reservly.IikoFrontBridge/MamaRoma/
├── MamaRomaConfig.cs      настройки и флаги
├── MamaRomaPayloads.cs    что уходит и что приходит
├── MamaRomaClient.cs      HTTP: забрать заказы, отправить стоп-лист и меню
├── DeliveryWriter.cs      создание доставки в iiko через editSession
├── MamaRomaCollectors.cs  стоп-лист, меню, статусы заказов
└── MamaRomaWorker.cs      свой таймер и порядок шагов
```

В существующих файлах — четыре строки: поле конфига, `using`, создание работника
в конструкторе, освобождение в `Dispose`. Больше ничего не тронуто.

## Как включить

В `bridge.settings.json` секция `mamaroma`. По умолчанию `enabled: false` —
плагин ведёт себя ровно как раньше.

```json
"mamaroma": {
  "enabled": true,
  "backendUrl": "https://api.mamaroma.ru/api/v1/integrations/iiko",
  "secret": "общий секрет, свой у каждой сети",
  "restaurantId": "UUID ресторана из таблицы restaurants",

  "acceptDeliveries": true,
  "deliveryPollIntervalSeconds": 20,
  "deliveryOrderTypeName": "",
  "pickupOrderTypeName": "",
  "defaultDeliveryMinutes": 60,
  "deliveryBatchSize": 10,

  "syncStopList": true,
  "stopListIntervalMinutes": 1,
  "stopOnRemainingAmount": true,
  "remainingAmountThreshold": 0,

  "syncMenu": true,
  "menuIntervalMinutes": 360,
  "menuIncludeInactive": false,

  "syncDeliveryStatus": true,
  "deliveryStatusIntervalSeconds": 30,
  "deliveryStatusLookbackHours": 12
}
```

`restaurantId` и `secret` свои на каждом терминале: и то и другое выдаётся
в админке приложения, раздел **Касса → Плагины**, кнопка «Выдать ключ».
Секрет показывается один раз.

**База iiko у каждого ресторана своя**, поэтому коды товаров у точек разные.
Сопоставление блюд ведётся отдельно для каждой точки — там же в админке,
раздел **Касса → Сопоставление**. Пока блюдо не сопоставлено, заказ с ним
на кассу не уедет, и это будет видно в разделе **Очередь**.

### Про порог остатка

В iiko «поставить в стоп-лист» и «выставить остаток» — разные действия,
и продажу запрещает только первое.

| Настройка | Поведение |
|---|---|
| `stopOnRemainingAmount: false` | Прячем только то, что формально в стоп-листе |
| `true`, порог `0` | Плюс то, где не осталось ни порции |
| `true`, порог `5` | Прячем заранее: последние 5 порций уйдут в зал, а не в доставку |

Сервер получает и решение (`isStopped`), и основание (`reason`), и сырые данные —
видно, почему блюдо скрыто.

## Ручки на стороне сервера

Все запросы несут заголовки:

```
X-Iiko-Bridge-Secret: <secret>
X-Iiko-Restaurant-Id: <restaurantId>
```

### `GET /orders/pending?restaurant_id=…&limit=…`

Заказы, ожидающие заведения в iiko.

```json
{ "orders": [ {
  "orderId": "UUID заказа у нас",
  "orderNumber": "1024",
  "orderType": "delivery",
  "phone": "+79001234567",
  "customerName": "Владислав",
  "comment": "Домофон не работает",
  "expectedDeliveryAt": "",
  "deliveryMinutes": 60,
  "address": {
    "city": "Санкт-Петербург",
    "street": "Невский пр.",
    "house": "28",
    "building": "2",
    "construction": "",
    "flat": "55", "entrance": "3", "floor": "4", "doorphone": "55К",
    "additionalInfo": "во дворе"
  },
  "personsCount": 2,
  "payment": {
    "method": "cash_on_delivery",
    "methodLabel": "наличными курьеру",
    "isPaid": false,
    "changeFromKopecks": 200000,
    "subtotalKopecks": 100000,
    "deliveryKopecks": 20000,
    "discountKopecks": 10000,
    "promoCode": "LETO",
    "pointsSpent": 300,
    "totalKopecks": 110000
  },
  "items": [ {
    "productId": "UUID товара в iiko этой точки",
    "sizeId": "",
    "amount": 2,
    "name": "Маргарита",
    "modifiers": [ { "productId": "…", "groupId": "…", "amount": 2, "name": "бекон" } ]
  } ]
} ] }
```

Про деньги: касса считает свою цену по прайсу, поэтому наш итог, скидки и
сдача уходят отдельно и попадают в комментарий к заказу. Расхождение должно
быть видно кассиру сразу, а не всплыть при вручении.

Заказ, уже заведённый в кассе, второй раз не заводится: плагин ищет доставку
с таким внешним номером и возвращает прежний результат. Отчёт, не дошедший
из-за связи, ложится в очередь на диск (`mamaroma-ack-queue`) и уходит
на следующем круге.

Отдавать заказ повторно, пока не пришло подтверждение. Плагин заведёт его
один раз — защита от дублей на стороне сервера: помечать «в работе»
и не отдавать второй раз в течение минуты.

### `POST /orders/ack`

Чем закончилось. Приходит **всегда**, в том числе при неудаче.

```json
{ "restaurantId": "…", "results": [
  { "orderId": "…", "status": "accepted",
    "iikoOrderId": "…", "iikoOrderNumber": "512",
    "error": "", "missingProducts": [], "reportedAt": "…" },
  { "orderId": "…", "status": "failed",
    "error": "Не найдены товары: Пепперони (8f2a…)",
    "missingProducts": ["Пепперони (8f2a…)"] }
] }
```

`missingProducts` непусто — сопоставление блюд разъехалось. Это стоит показывать
в админке заметно: заказ не уехал на кухню, гость ждёт.

### `POST /stop-list`

```json
{ "restaurantId": "…", "capturedAt": "…",
  "stopOnRemainingAmount": true, "remainingAmountThreshold": 0,
  "items": [ {
    "productId": "…", "productName": "Карбонара", "sizeId": "",
    "remainingAmount": 0, "isRestricted": true,
    "isStopped": true, "reason": "restricted"
  } ] }
```

Приходит только при изменениях. Полный список того, что сейчас в стопе, —
позиции, которых нет в массиве, снова доступны.

### `POST /menu`

Номенклатура точки: `productId`, `name`, `code`, `groupName`, `groupPath`,
`category`, `measureUnit`, `isActive`, `hasSizes`. Нужна для сопоставления
блюд приложения с товарами iiko.

`hasSizes: true` — в заказе для этого товара обязателен `sizeId`.

### `POST /delivery-status`

Состояние заказов, заведённых через нас. Узнаём их по внешнему номеру —
его проставляет `DeliveryWriter`.

```json
{ "restaurantId": "…", "orders": [ {
  "orderId": "наш UUID", "iikoOrderNumber": "512", "status": "OnWay",
  "confirmedAt": "…", "printedAt": "…", "cookingFinishedAt": "…",
  "sentAt": "…", "deliveredAt": "…", "cancelledAt": "",
  "predictedCookingCompleteAt": "…",
  "hasProblem": false, "problemComment": "", "courierName": "Иван"
} ] }
```

**Этапы для гостя считаются по меткам, а не по статусу** — на V8 «готовим»
и «готово» иначе не получить:

| Этап у гостя | Признак |
|---|---|
| Принят | `confirmedAt` заполнено |
| Готовим | `printedAt` заполнено — позиции ушли на кухню |
| Готов / в пути | `cookingFinishedAt` или `sentAt` |
| Доставлен | `deliveredAt` |

`hasProblem` — отдельный случай: на кухне отметили проблему. Об этом стоит
узнать раньше гостя.

## Что проверить перед первым запуском

Код написан по документации V8, но **не собирался** — SDK нужен Windows.
Места, где вероятнее всего потребуется правка:

1. **`CreateDeliveryOrder`** — у метода две перегрузки, последний параметр `bool`.
   Сверьте назначение в справочнике SDK.
2. **`SubmitChanges`** — в примерах встречается и с учётными данными, и без.
3. **`AddOrderProductItem` / `AddOrderModifierItem`** — порядок параметров
   между версиями отличался.
4. **`OrderServiceTypes`** — проверьте имена значений для курьера и самовывоза.
5. **`TryGetProductGroupById`** — метод есть не во всех версиях; если его нет,
   модификаторы можно передавать без группы.

## Порядок обкатки

1. `enabled: false`, собрать, поставить — убедиться, что Reservly не пострадал
2. `enabled: true`, но `acceptDeliveries: false` — только чтение: стоп-лист,
   меню, статусы. **Ничего не пишется в iiko**
3. Сопоставить блюда по выгруженному меню
4. `acceptDeliveries: true` на **одном** терминале, один тестовый заказ
5. Раскатка на остальные точки

Второй шаг стоит подержать неделю: он полезен сам по себе и ничего не может
сломать у клиента.
