from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin


class MenuCategory(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "menu_categories"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_menu_categories_tenant_slug"),)

    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(60))
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class Dish(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "dishes"

    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_categories.id", ondelete="RESTRICT"), index=True
    )

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    composition: Mapped[str | None] = mapped_column(Text, default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)

    price_kopecks: Mapped[int]

    weight_grams: Mapped[int | None] = mapped_column(default=None)
    volume_ml: Mapped[int | None] = mapped_column(default=None)
    calories: Mapped[int | None] = mapped_column(default=None)

    # Пищевая ценность на порцию — из таблицы КБЖУ сети
    proteins_g: Mapped[float | None] = mapped_column(Float, default=None)
    fats_g: Mapped[float | None] = mapped_column(Float, default=None)
    carbs_g: Mapped[float | None] = mapped_column(Float, default=None)

    # Метки поверх фотографии: помогают выбирать и оживляют сетку
    is_spicy: Mapped[bool] = mapped_column(default=False)
    is_vegetarian: Mapped[bool] = mapped_column(default=False)
    is_new: Mapped[bool] = mapped_column(default=False)

    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class DishPrice(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Цена блюда в конкретном ресторане. Нет строки — действует Dish.price_kopecks."""

    __tablename__ = "dish_prices"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "restaurant_id", "dish_id", name="uq_dish_prices_tenant_restaurant_dish"
        ),
    )

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )
    dish_id: Mapped[UUID] = mapped_column(ForeignKey("dishes.id", ondelete="CASCADE"), index=True)
    price_kopecks: Mapped[int]


class StopListEntry(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Блюдо временно недоступно в ресторане. until = None — до снятия вручную."""

    __tablename__ = "stop_list"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "restaurant_id", "dish_id", name="uq_stop_list_tenant_restaurant_dish"
        ),
    )

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )
    dish_id: Mapped[UUID] = mapped_column(ForeignKey("dishes.id", ondelete="CASCADE"), index=True)
    until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    comment: Mapped[str | None] = mapped_column(String(200), default=None)
