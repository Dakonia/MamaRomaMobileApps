# Что в этой папке

Готовый плагин: копируется на терминал как есть.

| Файл | Зачем |
|---|---|
| `Reservly.IikoFrontBridge.dll` | Сам плагин |
| `Manifest.xml` | По нему iikoFront находит плагин и его лицензию |
| `bridge.settings.json` | Настройки: адреса, ключи, что собирать |
| `System.*.dll` | Библиотеки, которых нет в iikoFront |

Папка собирается заново командой `../tools/pack.sh` и в git не хранится:
в настройках лежат боевые ключи, а DLL пересобирается из исходников.

## Установка

1. Скопировать всю папку на терминал в
   `C:\Program Files\iiko\iikoRMS\Front.Net\Plugins\Reservly.IikoFrontBridge`
2. Снять с файлов пометку «скачано из интернета»: в PowerShell от администратора
   `Get-ChildItem -Recurse | Unblock-File`
3. Перезапустить iikoFront

Либо одной командой, если папку заархивировать:
`.\install-from-artifact.ps1 -ZipPath плагин.zip`

## Перед первым запуском

В `bridge.settings.json`, секция `mamaroma`:

- `secret` и `restaurantId` — из админки приложения, раздел **Касса → Плагины**
- `enabled` оставить `false` на первую установку: убедиться, что iikoFront
  поднялся и сбор данных для Reservly работает как раньше
- потом `enabled: true`, но `acceptDeliveries: false` — только чтение,
  в iiko ничего не пишется
- заказы включать последним шагом, когда блюда сопоставлены

Логи плагина: `logs/reservly-bridge.log` в этой же папке.
