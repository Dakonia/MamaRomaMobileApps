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
cd backend && uv run ruff check . && uv run mypy .
```

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

## Стек и договорённости

- Мобилка: Expo SDK 57, TypeScript, expo-router, Reanimated 4, React Query (серверное
  состояние) + Zustand (локальное), react-hook-form + zod.
- Сборка только через облачный EAS Build — Xcode и Android SDK на машине нет.
- Бэкенд: Python 3.13, FastAPI, PostgreSQL 17, Redis.
- Платежи ЮKassa (СБП + Мир), карты Яндекс MapKit, аналитика AppMetrica, push через
  expo-notifications с RuStore как запасным каналом на Android.
- Дизайн-направление A «Mercato»: белый фон, терракота `#C0392B` как единственный
  акцент действия, базилик `#1B7F5A` для статусов, шрифты Oswald (заголовки) / Onest (текст).

## Лояльность

Четыре уровня: Ospite 5% → Amico 7% → Famiglia 10% → Maestro 12%.
1 балл = 1 ₽, списание до 50% чека, баллы сгорают через 180 дней.
Параметры не хардкодим — берём из `tenant.loyalty`.
