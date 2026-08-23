from datetime import time
from uuid import UUID

from sqlalchemy import Float, ForeignKey, String, Text, Time, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin


class City(UUIDMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "cities"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_cities_tenant_slug"),)

    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(60))
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    is_active: Mapped[bool] = mapped_column(default=True)
    sort_order: Mapped[int] = mapped_column(default=0)

    # Где искать адреса гостей — коды КЛАДР регионов, первый считается основным.
    # Люди живут не только в самом городе: Кудрово и Мурино — уже Ленинградская
    # область (код 47), а заказывают оттуда постоянно.
    suggest_regions: Mapped[list[str]] = mapped_column(JSONB, default=list)


class GeoAddress(UUIDMixin, TimestampMixin, Base):
    """
    Свой справочник адресов: копим сюда всё, что хоть раз нашли во внешнем сервисе.
    Следующий гость, который наберёт ту же улицу, получит ответ из нашей базы —
    внешний запрос не тратится. Данные тут справочные и публичные (ФИАС), личного
    ничего нет, поэтому таблица общая для всех тенантов, без tenant_id.
    """

    __tablename__ = "geo_addresses"
    __table_args__ = (UniqueConstraint("fias_id", name="uq_geo_addresses_fias"),)

    # Код КЛАДР региона: по нему фильтруем выдачу под город тенанта
    region_code: Mapped[str] = mapped_column(String(2), index=True)
    locality: Mapped[str | None] = mapped_column(String(120), default=None)
    street: Mapped[str] = mapped_column(String(200))
    house: Mapped[str] = mapped_column(String(20), default="")
    building: Mapped[str] = mapped_column(String(40), default="")

    title: Mapped[str] = mapped_column(String(260))
    subtitle: Mapped[str] = mapped_column(String(260), default="")
    # Строка для поиска: нижний регистр без типов улиц, по ней стоит триграммный индекс
    search_text: Mapped[str] = mapped_column(String(400))

    fias_id: Mapped[str | None] = mapped_column(String(40), default=None)
    postal_code: Mapped[str | None] = mapped_column(String(10), default=None)
    city_district: Mapped[str | None] = mapped_column(String(120), default=None)
    metro: Mapped[str | None] = mapped_column(String(120), default=None)
    latitude: Mapped[float | None] = mapped_column(Float, default=None)
    longitude: Mapped[float | None] = mapped_column(Float, default=None)
    geo_precision: Mapped[int | None] = mapped_column(default=None)


class Restaurant(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    __tablename__ = "restaurants"

    city_id: Mapped[UUID] = mapped_column(ForeignKey("cities.id", ondelete="RESTRICT"), index=True)

    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str] = mapped_column(String(300))
    metro: Mapped[str | None] = mapped_column(String(120), default=None)
    phone: Mapped[str | None] = mapped_column(String(24), default=None)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)

    opens_at: Mapped[time] = mapped_column(Time)
    closes_at: Mapped[time] = mapped_column(Time)

    # Служба доставки работает короче зала: ресторан открыт с 08:00,
    # а курьеры возят с 11:00 до 22:30
    # Принимать ли заказы, пока ресторан закрыт: с флагом гость выбирает время
    # на ближайшие рабочие часы, без него — заказ просто не оформить
    preorder_enabled: Mapped[bool] = mapped_column(default=False)

    delivery_opens_at: Mapped[time | None] = mapped_column(Time, default=None)
    delivery_closes_at: Mapped[time | None] = mapped_column(Time, default=None)

    has_delivery: Mapped[bool] = mapped_column(default=True)
    has_pickup: Mapped[bool] = mapped_column(default=True)
    has_dine_in: Mapped[bool] = mapped_column(default=True)

    delivery_price_kopecks: Mapped[int] = mapped_column(default=0)
    delivery_min_order_kopecks: Mapped[int] = mapped_column(default=0)
    free_delivery_from_kopecks: Mapped[int | None] = mapped_column(default=None)

    description: Mapped[str | None] = mapped_column(Text, default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # Размытый отпечаток снимка: показываем его, пока грузится сам снимок
    image_blurhash: Mapped[str | None] = mapped_column(String(40), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)

    # Пауза — это ЧП на сегодня: авария, нет продуктов, нет курьеров. Ресторан
    # остаётся в списке, но заказы не принимает и объясняет гостю почему.
    # is_active — другое: закрыт совсем и в приложении не показывается
    is_paused: Mapped[bool] = mapped_column(default=False)
    pause_reason: Mapped[str | None] = mapped_column(String(200), default=None)

    photos: Mapped[list["RestaurantPhoto"]] = relationship(
        lazy="selectin",
        order_by="RestaurantPhoto.position",
        cascade="all, delete-orphan",
    )


class RestaurantPhoto(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Снимок зала: их несколько на точку, порядок задаёт сайт или админка."""

    __tablename__ = "restaurant_photos"

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(default=0)


class DeliveryZone(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    """
    Зона доставки: многоугольник на карте и ресторан, который её обслуживает.

    Один ресторан может держать несколько зон — например ближнюю с бесплатной
    доставкой и дальнюю с платной. Если зоны наложились, побеждает та, у которой
    меньше sort_order: так ближняя зона выигрывает у общей.
    """

    __tablename__ = "delivery_zones"

    city_id: Mapped[UUID] = mapped_column(ForeignKey("cities.id", ondelete="CASCADE"), index=True)
    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )

    name: Mapped[str] = mapped_column(String(160))
    # Контур зоны: список точек [[долгота, широта], ...] как в GeoJSON
    outline: Mapped[list[list[float]]] = mapped_column(JSONB)
    color: Mapped[str] = mapped_column(String(9), default="#C0392B")

    delivery_price_kopecks: Mapped[int] = mapped_column(default=0)
    min_order_kopecks: Mapped[int] = mapped_column(default=0)
    # С пятницы по воскресенье и в праздники минимум бывает выше.
    # Пусто — минимум одинаковый всю неделю
    min_order_weekend_kopecks: Mapped[int | None] = mapped_column(default=None)
    free_delivery_from_kopecks: Mapped[int | None] = mapped_column(default=None)
    # Сколько минут обычно едет курьер: показываем гостю до оформления
    delivery_minutes: Mapped[int | None] = mapped_column(default=None)

    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
