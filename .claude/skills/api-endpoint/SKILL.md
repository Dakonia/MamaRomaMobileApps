---
name: api-endpoint
description: Добавить эндпоинт или модель в FastAPI-бэкенд с обязательной изоляцией по tenant_id и миграцией Alembic. Использовать при запросах «добавь ручку», «новый эндпоинт», «модель в БД», «таблица для…».
---

# Эндпоинт и модель бэкенда

## Раскладка

```
backend/app/
  api/v1/          роутеры, по файлу на домен (menu.py, orders.py, loyalty.py)
  models/          SQLAlchemy-модели
  schemas/         Pydantic-схемы запросов и ответов
  services/        бизнес-логика — роутер её только вызывает
  core/            конфиг, БД, безопасность, тенанты
```

Роутер не ходит в БД напрямую и не считает бизнес-правила — это работа сервиса.

## Обязательные требования

1. **tenant_id везде.** Модель наследует `TenantMixin` из `app.core.db`. Каждый
   запрос фильтруется по `tenant_id` — без исключений. Тенант берётся из
   зависимости, а не из тела запроса, иначе клиент сможет прочитать чужую сеть.

2. **Деньги — целые копейки** (`Mapped[int]`), никогда `float` и не `Numeric` в API.

3. **Схемы ответов явные.** У каждой ручки `response_model`. Не возвращаем модели
   SQLAlchemy напрямую.

4. **Async до конца.** `AsyncSession` через `Depends(get_session)`, никаких
   синхронных драйверов и блокирующих вызовов внутри корутин.

5. **Миграция обязательна** после изменения модели:
   ```
   cd backend && uv run alembic revision --autogenerate -m "описание"
   uv run alembic upgrade head
   ```
   Автогенерацию всегда просматриваем глазами — Alembic не видит переименования.

6. **Индексы под запросы.** Если поле участвует в фильтре или сортировке —
   `index=True`. Для частых пар — составной индекс вместе с `tenant_id`.

7. Персональные данные гостей не логируем и не отправляем в зарубежные сервисы (ФЗ-152).

## Шаблон модели

```python
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin


class Dish(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "dishes"

    title: Mapped[str] = mapped_column(String(200))
    price_kopecks: Mapped[int]
    category_id: Mapped[UUID] = mapped_column(ForeignKey("categories.id"), index=True)
    is_available: Mapped[bool] = mapped_column(default=True)
```

## После изменений

```
cd backend && uv run ruff check . && uv run mypy app
```
mypy настроен в strict — новый код должен проходить без послаблений.
