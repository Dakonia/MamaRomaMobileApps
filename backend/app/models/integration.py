"""Связь с кассовой системой ресторана через плагин на терминале.

Плагин стоит в каждой точке и сам ходит к нам: забирает заказы, отдаёт
стоп-лист и номенклатуру. Направление связи именно такое, потому что интернет
в ресторане пропадает регулярно, а белого адреса у терминала нет.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TenantMixin, TimestampMixin, UUIDMixin
from app.models.enums import IikoHandoffStatus, enum_column


class IikoBridge(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Плагин, зарегистрированный за конкретным рестораном.

    Одна точка — один плагин. Пока запись есть и терминал выходил на связь,
    заказы этого ресторана уезжают на кассу. Нет записи — заказ остаётся
    только у нас, и менеджер ведёт его в админке как раньше.
    """

    __tablename__ = "iiko_bridges"
    __table_args__ = (
        UniqueConstraint("tenant_id", "restaurant_id", name="uq_iiko_bridges_tenant_restaurant"),
    )

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )

    # Общий секрет этой точки. У каждого ресторана свой: утёк один терминал —
    # меняем ключ только ему, остальные работают
    secret: Mapped[str] = mapped_column(String(128))

    is_active: Mapped[bool] = mapped_column(default=True)

    # Когда терминал последний раз выходил на связь. По этому полю видно,
    # какой ресторан онлайн, а какой молчит вторые сутки
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    plugin_version: Mapped[str | None] = mapped_column(String(32), default=None)
    terminal_name: Mapped[str | None] = mapped_column(String(120), default=None)


class IikoOrderHandoff(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Передача заказа на кассу: состояние отдельно от самого заказа.

    Заказ — документ, и его состояние описывает путь еды к гостю. А здесь
    техническая история одной попытки: отдали плагину, он ответил, что вышло.
    Мешать эти две вещи в одной таблице нельзя — они живут по разным правилам.
    """

    __tablename__ = "iiko_order_handoffs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "order_id", name="uq_iiko_handoffs_tenant_order"),
    )

    order_id: Mapped[UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )

    status: Mapped[IikoHandoffStatus] = mapped_column(
        enum_column(IikoHandoffStatus), default=IikoHandoffStatus.PENDING, index=True
    )

    attempts: Mapped[int] = mapped_column(default=0)

    # Плагин забрал заказ и работает над ним. До этого момента заказ повторно
    # не отдаём: два терминала не должны завести одну доставку дважды
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    iiko_order_id: Mapped[str | None] = mapped_column(String(64), default=None)
    iiko_order_number: Mapped[str | None] = mapped_column(String(32), default=None)

    # Текст ошибки для менеджера: он увидит его в админке и поймёт, что делать
    error: Mapped[str | None] = mapped_column(Text, default=None)

    # Блюда, которых не нашлось в номенклатуре кассы. Непусто — значит
    # сопоставление разъехалось, и это надо чинить, а не повторять попытку
    missing_products: Mapped[list[str]] = mapped_column(JSONB, default=list)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class IikoLink(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Сопоставление нашего блюда с товаром кассы — своё в каждом ресторане.

    У каждой точки сети своя база iiko, и код одного и того же блюда там разный.
    Поэтому связь живёт не в самом блюде, а здесь: ресторан плюс блюдо дают код
    товара. Нет строки — заказ с этим блюдом на кассу не уедет, и менеджер
    увидит в очереди, чего не хватает.

    Добавки сопоставляются так же: у модификатора свой код и своя группа.
    """

    __tablename__ = "iiko_links"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "restaurant_id", "dish_id", name="uq_iiko_links_tenant_rest_dish"
        ),
        UniqueConstraint(
            "tenant_id", "restaurant_id", "extra_id", name="uq_iiko_links_tenant_rest_extra"
        ),
    )

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )

    # Заполнено ровно одно из двух: строка описывает либо блюдо, либо добавку
    dish_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("dishes.id", ondelete="CASCADE"), index=True, default=None
    )
    extra_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("dish_extras.id", ondelete="CASCADE"), index=True, default=None
    )

    product_id: Mapped[str] = mapped_column(String(64), index=True)

    # Размер обязателен у товаров, где он заведён: без него касса не поймёт,
    # какую пиццу пробивать
    size_id: Mapped[str | None] = mapped_column(String(64), default=None)

    # Группа модификатора: у добавок касса требует не только код товара
    modifier_group_id: Mapped[str | None] = mapped_column(String(64), default=None)


class IikoProduct(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Номенклатура кассы, выгруженная плагином.

    Список товаров этой точки — из него менеджер выбирает, чему соответствует
    наше блюдо. Сама связь хранится в IikoLink: база iiko у каждого ресторана
    своя, и один и тот же товар имеет там разные коды.
    """

    __tablename__ = "iiko_products"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "restaurant_id", "product_id", name="uq_iiko_products_tenant_rest_product"
        ),
    )

    restaurant_id: Mapped[UUID] = mapped_column(
        ForeignKey("restaurants.id", ondelete="CASCADE"), index=True
    )

    # Код товара в кассе — то, что уходит в заказ
    product_id: Mapped[str] = mapped_column(String(64), index=True)

    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str | None] = mapped_column(String(32), default=None)
    group_name: Mapped[str | None] = mapped_column(String(160), default=None)
    group_path: Mapped[str | None] = mapped_column(String(400), default=None)
    category: Mapped[str | None] = mapped_column(String(120), default=None)
    measure_unit: Mapped[str | None] = mapped_column(String(32), default=None)

    # Вид товара в кассе: Dish, Goods, Modifier и прочее. «Активный» в iiko
    # значит «не удалён из справочника», поэтому отбирать по нему бесполезно —
    # продаётся именно то, что нужного вида
    product_type: Mapped[str | None] = mapped_column(String(32), default=None)

    # Цена по прайсу кассы в копейках. Нужна на экране сопоставления: у сети
    # бывает пять «Маргарит» разного размера, и цена — единственное отличие.
    #
    # Тип широкий намеренно: в кассе цену-заглушку ставят миллиардами
    # (8 888 888 888 рублей), чтобы товар нельзя было продать, и обычное
    # целое такое не вмещает — вся выгрузка падала на одной такой позиции
    price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)

    is_active: Mapped[bool] = mapped_column(default=True)

    # У товара есть размеры — тогда в заказе обязателен ещё и код размера
    has_sizes: Mapped[bool] = mapped_column(default=False)

    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class IikoMenuSetup(UUIDMixin, TenantMixin, TimestampMixin, Base):
    """Как устроено дерево номенклатуры кассы у этой сети.

    Один ресторан настраивают руками, дальше настройка работает на всю сеть:
    в iiko chain товары заводят централизованно, и ветки у точек совпадают.
    Ветки конкретных категорий лежат в самих категориях меню, а здесь общее —
    что считать мусором и где искать добавки.
    """

    __tablename__ = "iiko_menu_setup"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_iiko_menu_setup_tenant"),)

    # Куски пути, по которым ветку целиком пропускаем: заготовки, посуда,
    # прошлогодние акции. Сравниваем без учёта регистра
    deny_markers: Mapped[list[str]] = mapped_column(JSONB, default=list)

    # Где лежат модификаторы: добавки к блюдам сопоставляются отсюда
    extra_group_paths: Mapped[list[str]] = mapped_column(JSONB, default=list)

    # Забирать ли с кассы товары вне разрешённых веток. Выключено — в базу
    # приложения попадает только меню, а не весь справочник точки
    keep_unknown_groups: Mapped[bool] = mapped_column(default=False)
