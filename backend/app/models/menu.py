from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Table, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin


class MenuCategory(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "menu_categories"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_menu_categories_tenant_slug"),)

    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(60))
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # Размытый отпечаток снимка: показываем его, пока грузится сам снимок
    image_blurhash: Mapped[str | None] = mapped_column(String(40), default=None)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    # Полка «Часто заказывают» — про еду. Соусы, напитки и детское меню
    # там только мешают, даже когда их берут чаще всего
    show_in_popular: Mapped[bool] = mapped_column(default=True)

    extras: Mapped[list["DishExtra"]] = relationship(
        secondary="category_extra_links", lazy="selectin", order_by="DishExtra.name"
    )

    # Ветки номенклатуры кассы, где искать блюда этой категории: «КУХНЯ/ПИЦЦА»
    # и подобное. У каждой сети дерево своё, поэтому это данные, а не код.
    # Пусто — ищем по всем разрешённым веткам сети
    iiko_group_paths: Mapped[list[str]] = mapped_column(JSONB, default=list)


class Dish(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "dishes"

    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("menu_categories.id", ondelete="RESTRICT"), index=True
    )

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    composition: Mapped[str | None] = mapped_column(Text, default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # Размытый отпечаток снимка: показываем его, пока грузится сам снимок
    image_blurhash: Mapped[str | None] = mapped_column(String(40), default=None)

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

    # Что можно докинуть в блюдо: у пиццы свой набор, у пасты свой
    extras: Mapped[list["DishExtra"]] = relationship(
        secondary="dish_extra_links", lazy="selectin", order_by="DishExtra.name"
    )

    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


# Одна и та же добавка идёт к десяткам блюд: у пиццы свой набор из 51 позиции,
# у пасты и гарниров — свои. Поэтому справочник общий, а связь — многие ко многим
dish_extra_links = Table(
    "dish_extra_links",
    Base.metadata,
    Column("dish_id", ForeignKey("dishes.id", ondelete="CASCADE"), primary_key=True),
    Column("extra_id", ForeignKey("dish_extras.id", ondelete="CASCADE"), primary_key=True),
)


# Добавка может относиться ко всему разделу: пармезан уместен к любой пасте,
# даже если на сайте у конкретного блюда он не указан
category_extra_links = Table(
    "category_extra_links",
    Base.metadata,
    Column("category_id", ForeignKey("menu_categories.id", ondelete="CASCADE"), primary_key=True),
    Column("extra_id", ForeignKey("dish_extras.id", ondelete="CASCADE"), primary_key=True),
)


class DishExtra(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    """Добавка к блюду: «бекон 50 гр», «соус песто 40 гр»."""

    __tablename__ = "dish_extras"

    name: Mapped[str] = mapped_column(String(120))
    price_kopecks: Mapped[int] = mapped_column(default=0)
    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)


class DishPrice(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """
    Меню конкретного ресторана: своя цена и признак «продаётся ли вообще».
    Нет строки — блюдо продаётся по общей цене. Это не то же, что стоп-лист:
    стоп-лист — «сегодня закончилось», а здесь — «в этом ресторане не готовят».
    """

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
    is_available: Mapped[bool] = mapped_column(default=True)


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
