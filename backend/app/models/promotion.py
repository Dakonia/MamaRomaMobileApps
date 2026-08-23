from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, ExternalSyncMixin, TenantMixin, TimestampMixin, UUIDMixin
from app.models.geo import Restaurant

# Акция часто идёт сразу в нескольких ресторанах сети, но не во всех:
# «фестиваль грибов в 13 ресторанах» — обычная для сети история
promotion_restaurants = Table(
    "promotion_restaurants",
    Base.metadata,
    Column("promotion_id", ForeignKey("promotions.id", ondelete="CASCADE"), primary_key=True),
    Column("restaurant_id", ForeignKey("restaurants.id", ondelete="CASCADE"), primary_key=True),
)


class Promotion(UUIDMixin, TenantMixin, TimestampMixin, ExternalSyncMixin, Base):
    """Акция сети или отдельных ресторанов.

    Пустой список ресторанов означает «во всех», пустой ends_at — «бессрочно».
    """

    __tablename__ = "promotions"

    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    # Короткая плашка поверх картинки: «−20%», «Новинка», «2 по цене 1»
    label: Mapped[str | None] = mapped_column(String(24), default=None)
    image_url: Mapped[str | None] = mapped_column(String(500), default=None)
    # Размытый отпечаток снимка: показываем его, пока грузится сам снимок
    image_blurhash: Mapped[str | None] = mapped_column(String(40), default=None)
    # Размеры картинки: приложение рисует карточку в её же пропорции,
    # поэтому афиши и квадратные баннеры не режутся кадром
    image_width: Mapped[int | None] = mapped_column(default=None)
    image_height: Mapped[int | None] = mapped_column(default=None)

    restaurants: Mapped[list[Restaurant]] = relationship(
        secondary=promotion_restaurants, lazy="selectin", order_by=Restaurant.name
    )

    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    sort_order: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    # Карусель в меню — место для акций про доставку. Всё остальное живёт
    # во вкладке «Акции», иначе главный экран превращается в афишу
    show_in_menu: Mapped[bool] = mapped_column(default=False)
    # Страница акции на сайте: полные условия живут там, в приложении даём ссылку
    source_url: Mapped[str | None] = mapped_column(String(300), default=None)
