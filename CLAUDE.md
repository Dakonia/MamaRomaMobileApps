# Mama Roma — мобильное приложение сети ресторанов

Мультитенантный white-label продукт: доставка, самовывоз, бронь стола, акции, бонусная лояльность.
Mama Roma — первый тенант. Продукт рассчитан на перепродажу другим сетям, поэтому ничего
брендового не хардкодим.

## Структура

```
apps/mobile/          Expo SDK 57, React Native 0.86, expo-router (src/app)
backend/              FastAPI + SQLAlchemy 2 async + Alembic, менеджер пакетов uv
packages/tenants/     Конфиги тенантов (бренд, фичи, лояльность, bundle id)
packages/design-tokens/  Палитра, типографика, spacing, motion
```

## Команды

```
pnpm mobile           запустить Expo dev server
pnpm api              запустить FastAPI (localhost:8000)
pnpm db:up            поднять postgresql@17 и redis через brew services
cd backend && uv run alembic upgrade head
cd backend && uv run pytest
cd backend && uv run ruff check . && uv run mypy .
cd apps/mobile && npx tsc --noEmit
```

## Проверки перед сдачей задачи

Любая правка бэкенда заканчивается прогоном `uv run pytest`, `ruff check .` и
`mypy .` — все три должны быть зелёными. Любая правка мобилки — `npx tsc --noEmit`
и успешная сборка бандла.

Тесты лежат в `backend/tests`, работают на той же базе, что и разработка, и
чистят за собой. Покрываем то, где ошибка стоит денег: счёт заказа, баллы и
уровни, зоны доставки, слоты брони, удаление аккаунта. Новая логика в этих
местах — новый тест вместе с ней.

## Правила

- **Никакого хардкода бренда.** Цвета, названия, телефоны, bundle id — только из
  `@mr/tenants`. Значения дизайна — только из `@mr/design-tokens`, магических чисел в стилях нет.
- **tenant_id обязателен** в каждой доменной таблице и в каждом запросе к БД.
  Модели наследуют `TenantMixin` из `app/core/db.py`.
- Тексты интерфейса — на русском, обращение к гостю на «вы».
- Деньги — целые копейки (`int`), никогда `float`. Отображение форматируем на клиенте.
- Даты в API — UTC ISO-8601, тайзмона ресторана лежит в конфиге тенанта.
- Схемы API описываем в Pydantic, TS-клиент генерируем из OpenAPI — руками типы ответов не пишем.
- Данные гостей хранятся в РФ (ФЗ-152). Персональные данные не отправляем в зарубежные сервисы.
- Токены авторизации — только `expo-secure-store`, никогда AsyncStorage.
- **Каждый `<Modal>` объявляет `statusBarTranslucent` и `navigationBarTranslucent`,**
  а отступ снизу берёт из `insets.bottom`. В React Native модалка — отдельное окно,
  и правило edge-to-edge на неё не распространяется: без этих свойств под шторкой
  на Android остаётся просвечивающая полоса системной навигации. На iOS свойства
  игнорируются, код один на обе платформы.

## Стек и договорённости

- Мобилка: Expo SDK 57, TypeScript, expo-router, Reanimated 4, React Query (серверное
  состояние) + Zustand (локальное), react-hook-form + zod.
- Сборка только через облачный EAS Build — Xcode и Android SDK на машине нет.
- Бэкенд: Python 3.13, FastAPI, PostgreSQL 17, Redis.
- Платежи ЮKassa (СБП + Мир), карты Яндекс MapKit, аналитика AppMetrica, push через
  expo-notifications с RuStore как запасным каналом на Android.
- Дизайн-направление A «Mercato»: белый фон, терракота `#C0392B` как единственный
  акцент действия, базилик `#1B7F5A` для статусов, шрифты Comfortaa (заголовки, кнопки,
  цены — как на сайте сети) / Onest (текст и плотный UI).
- Шрифты сайта mamaroma.ru перенесены не полностью: Adlery Pro и Citrica Cyrillic —
  коммерческие, нужна лицензия на embedding в приложение; Athelas есть только на iOS.
  Из системы сайта взята Comfortaa (Google Fonts, OFL, полная кириллица).

## Лояльность

Четыре уровня: Ospite 5% → Amico 7% → Famiglia 10% → Maestro 12%.
1 балл = 1 ₽, списание до 50% чека, баллы сгорают через 180 дней.
Параметры не хардкодим — берём из `tenant.loyalty`.
