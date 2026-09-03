"""Права сотрудников админки.

Набор прав роли задан здесь, в коде, а у сотрудника в базе лежат только
отклонения от него (`StaffUser.permissions`). Так новая ручка не требует
миграции по всем учётным записям: сотрудник получает дефолт своей роли сам.

Суперпользователь права не проверяет вовсе — см. `permissions_for`.
"""

from enum import StrEnum

from app.models.enums import StaffRole


class Permission(StrEnum):
    STAFF_VIEW = "staff.view"
    STAFF_MANAGE = "staff.manage"

    ORDERS_VIEW = "orders.view"
    ORDERS_STATUS = "orders.status"
    ORDERS_EDIT_ITEMS = "orders.edit_items"
    ORDERS_CANCEL = "orders.cancel"

    RESERVATIONS_VIEW = "reservations.view"
    RESERVATIONS_MANAGE = "reservations.manage"

    FEEDBACK_VIEW = "feedback.view"

    MENU_VIEW = "menu.view"
    MENU_STOPLIST = "menu.stoplist"
    MENU_EDIT = "menu.edit"
    MENU_PRICES = "menu.prices"
    MENU_DELETE = "menu.delete"

    PROMOS_VIEW = "promos.view"
    PROMOS_EDIT = "promos.edit"
    PROMOCODES_VIEW = "promocodes.view"
    PROMOCODES_EDIT = "promocodes.edit"

    CAMPAIGNS_VIEW = "campaigns.view"
    CAMPAIGNS_EDIT = "campaigns.edit"
    CAMPAIGNS_SEND = "campaigns.send"
    NOTIFICATIONS_SETTINGS = "notifications.settings"
    AUTOMATIONS_MANAGE = "automations.manage"

    GUESTS_VIEW = "guests.view"
    GUESTS_EDIT = "guests.edit"
    GUESTS_POINTS = "guests.points"
    GUESTS_DELETE = "guests.delete"

    RESTAURANTS_VIEW = "restaurants.view"
    RESTAURANTS_AVAILABILITY = "restaurants.availability"
    RESTAURANTS_EDIT = "restaurants.edit"
    RESTAURANTS_DELETE = "restaurants.delete"
    ZONES_VIEW = "zones.view"
    ZONES_EDIT = "zones.edit"

    IIKO_VIEW = "iiko.view"
    IIKO_QUEUE_RETRY = "iiko.queue_retry"
    IIKO_LINKS = "iiko.links"
    IIKO_SECRETS = "iiko.secrets"

    SYNC_RUN = "sync.run"
    MEDIA_UPLOAD = "media.upload"


# Права, которые остаются за суперпользователем: выдать их флагом нельзя никому.
# Первое раздаёт доступы, второе — ключи к кассе ресторана.
OWNER_ONLY: frozenset[Permission] = frozenset({Permission.STAFF_MANAGE, Permission.IIKO_SECRETS})


_NETWORK_MANAGER = frozenset(
    {
        Permission.STAFF_VIEW,
        Permission.ORDERS_VIEW,
        Permission.ORDERS_STATUS,
        Permission.ORDERS_EDIT_ITEMS,
        Permission.ORDERS_CANCEL,
        Permission.RESERVATIONS_VIEW,
        Permission.RESERVATIONS_MANAGE,
        Permission.FEEDBACK_VIEW,
        Permission.MENU_VIEW,
        Permission.MENU_STOPLIST,
        Permission.MENU_EDIT,
        Permission.MENU_PRICES,
        Permission.MENU_DELETE,
        Permission.PROMOS_VIEW,
        Permission.PROMOS_EDIT,
        Permission.PROMOCODES_VIEW,
        Permission.PROMOCODES_EDIT,
        Permission.CAMPAIGNS_VIEW,
        Permission.CAMPAIGNS_EDIT,
        Permission.CAMPAIGNS_SEND,
        Permission.NOTIFICATIONS_SETTINGS,
        Permission.AUTOMATIONS_MANAGE,
        Permission.GUESTS_VIEW,
        Permission.RESTAURANTS_VIEW,
        Permission.RESTAURANTS_AVAILABILITY,
        Permission.RESTAURANTS_EDIT,
        Permission.RESTAURANTS_DELETE,
        Permission.ZONES_VIEW,
        Permission.IIKO_VIEW,
        Permission.IIKO_QUEUE_RETRY,
        Permission.SYNC_RUN,
        Permission.MEDIA_UPLOAD,
    }
)

_DELIVERY_OPERATOR = frozenset(
    {
        Permission.ORDERS_VIEW,
        Permission.ORDERS_STATUS,
        Permission.ORDERS_EDIT_ITEMS,
        Permission.ORDERS_CANCEL,
        Permission.FEEDBACK_VIEW,
        Permission.MENU_VIEW,
        Permission.MENU_STOPLIST,
        Permission.PROMOS_VIEW,
        Permission.PROMOCODES_VIEW,
        Permission.PROMOCODES_EDIT,
        Permission.GUESTS_VIEW,
        Permission.RESTAURANTS_VIEW,
        Permission.RESTAURANTS_AVAILABILITY,
        Permission.ZONES_VIEW,
    }
)

_MARKETING = frozenset(
    {
        Permission.ORDERS_VIEW,
        Permission.RESERVATIONS_VIEW,
        Permission.FEEDBACK_VIEW,
        Permission.MENU_VIEW,
        Permission.PROMOS_VIEW,
        Permission.PROMOS_EDIT,
        Permission.PROMOCODES_VIEW,
        Permission.PROMOCODES_EDIT,
        Permission.CAMPAIGNS_VIEW,
        Permission.CAMPAIGNS_EDIT,
        Permission.CAMPAIGNS_SEND,
        Permission.NOTIFICATIONS_SETTINGS,
        Permission.AUTOMATIONS_MANAGE,
        Permission.GUESTS_VIEW,
        Permission.RESTAURANTS_VIEW,
        Permission.ZONES_VIEW,
        Permission.MEDIA_UPLOAD,
    }
)

# Заготовки: роли заводятся, но пока никем не используются. Наборы проставлены
# по смыслу роли и будут уточнены, когда дойдёт очередь до курьерского
# приложения и кабинета франчайзи.
_COURIER = frozenset(
    {
        Permission.ORDERS_VIEW,
        Permission.ORDERS_STATUS,
        Permission.GUESTS_VIEW,
    }
)

_RESTAURANT = frozenset(
    {
        Permission.ORDERS_VIEW,
        Permission.ORDERS_STATUS,
        Permission.RESTAURANTS_VIEW,
    }
)


ROLE_DEFAULTS: dict[StaffRole, frozenset[Permission]] = {
    StaffRole.OWNER: frozenset(Permission),
    StaffRole.NETWORK_MANAGER: _NETWORK_MANAGER,
    StaffRole.DELIVERY_OPERATOR: _DELIVERY_OPERATOR,
    StaffRole.MARKETING: _MARKETING,
    StaffRole.COURIER: _COURIER,
    StaffRole.RESTAURANT: _RESTAURANT,
}

# Роли, которые пока не пускаем в веб-админку: набор прав у них есть, но входа нет
WEB_ADMIN_ROLES: frozenset[StaffRole] = frozenset(
    {
        StaffRole.OWNER,
        StaffRole.NETWORK_MANAGER,
        StaffRole.DELIVERY_OPERATOR,
        StaffRole.MARKETING,
    }
)

ROLE_TITLES: dict[StaffRole, str] = {
    StaffRole.OWNER: "Суперпользователь",
    StaffRole.NETWORK_MANAGER: "Управляющий сетью",
    StaffRole.DELIVERY_OPERATOR: "Оператор доставки",
    StaffRole.MARKETING: "Маркетинг",
    StaffRole.COURIER: "Доставщик",
    StaffRole.RESTAURANT: "Ресторан",
}

# Раздел и название флага: по ним админка рисует переключатели прав
PERMISSION_TITLES: dict[Permission, tuple[str, str]] = {
    Permission.STAFF_VIEW: ("Сотрудники", "Смотреть список сотрудников"),
    Permission.STAFF_MANAGE: ("Сотрудники", "Заводить, менять роли и права"),
    Permission.ORDERS_VIEW: ("Заказы", "Смотреть заказы и карточку"),
    Permission.ORDERS_STATUS: ("Заказы", "Менять статус"),
    Permission.ORDERS_EDIT_ITEMS: ("Заказы", "Менять состав заказа"),
    Permission.ORDERS_CANCEL: ("Заказы", "Отменять заказ"),
    Permission.RESERVATIONS_VIEW: ("Брони", "Смотреть брони"),
    Permission.RESERVATIONS_MANAGE: ("Брони", "Подтверждать и менять статус"),
    Permission.FEEDBACK_VIEW: ("Отзывы", "Смотреть отзывы и сводку оценок"),
    Permission.MENU_VIEW: ("Меню", "Смотреть меню и добавки"),
    Permission.MENU_STOPLIST: ("Меню", "Ставить блюдо в стоп-лист"),
    Permission.MENU_EDIT: ("Меню", "Править категории, блюда, добавки"),
    Permission.MENU_PRICES: ("Меню", "Править цены по ресторану"),
    Permission.MENU_DELETE: ("Меню", "Удалять категории и блюда"),
    Permission.PROMOS_VIEW: ("Акции и промокоды", "Смотреть акции"),
    Permission.PROMOS_EDIT: ("Акции и промокоды", "Заводить и править акции"),
    Permission.PROMOCODES_VIEW: ("Акции и промокоды", "Смотреть промокоды"),
    Permission.PROMOCODES_EDIT: ("Акции и промокоды", "Заводить и править промокоды"),
    Permission.CAMPAIGNS_VIEW: ("Уведомления", "Смотреть рассылки"),
    Permission.CAMPAIGNS_EDIT: ("Уведомления", "Готовить рассылку"),
    Permission.CAMPAIGNS_SEND: ("Уведомления", "Отправлять рассылку гостям"),
    Permission.NOTIFICATIONS_SETTINGS: ("Уведомления", "Тексты шагов заказа и тихие часы"),
    Permission.AUTOMATIONS_MANAGE: ("Уведомления", "Сценарии: день рождения, спящие"),
    Permission.GUESTS_VIEW: ("Гости", "Смотреть гостей, контакты и историю"),
    Permission.GUESTS_EDIT: ("Гости", "Заводить и править гостя"),
    Permission.GUESTS_POINTS: ("Гости", "Начислять и списывать баллы"),
    Permission.GUESTS_DELETE: ("Гости", "Удалять гостя"),
    Permission.RESTAURANTS_VIEW: ("Рестораны и зоны", "Смотреть рестораны"),
    Permission.RESTAURANTS_AVAILABILITY: (
        "Рестораны и зоны",
        "Пауза, доставка и самовывоз вкл/выкл",
    ),
    Permission.RESTAURANTS_EDIT: ("Рестораны и зоны", "Править адреса, часы, условия"),
    Permission.RESTAURANTS_DELETE: ("Рестораны и зоны", "Удалять ресторан"),
    Permission.ZONES_VIEW: ("Рестораны и зоны", "Смотреть зоны доставки"),
    Permission.ZONES_EDIT: ("Рестораны и зоны", "Править и добавлять зоны"),
    Permission.IIKO_VIEW: ("Касса iiko", "Смотреть плагины, очередь, номенклатуру"),
    Permission.IIKO_QUEUE_RETRY: ("Касса iiko", "Отдать заказ на кассу заново"),
    Permission.IIKO_LINKS: ("Касса iiko", "Привязывать блюда к товарам кассы"),
    Permission.IIKO_SECRETS: ("Касса iiko", "Выдавать ключи и включать плагины"),
    Permission.SYNC_RUN: ("Обновление и файлы", "Сверять и записывать данные с сайта"),
    Permission.MEDIA_UPLOAD: ("Обновление и файлы", "Загружать фотографии"),
}


def permissions_for(
    role: StaffRole, overrides: dict[str, bool] | None = None
) -> frozenset[Permission]:
    """Права сотрудника: дефолт роли, поправленный флагами.

    Суперпользователю отдаём весь набор сразу: у него отклонений не бывает,
    иначе владельца сети можно было бы отрезать от собственной админки.
    """
    if role is StaffRole.OWNER:
        return ROLE_DEFAULTS[StaffRole.OWNER]

    granted = set(ROLE_DEFAULTS.get(role, frozenset()))

    for name, enabled in (overrides or {}).items():
        try:
            permission = Permission(name)
        except ValueError:
            # Флаг из прошлой версии: молча пропускаем, иначе снятая ручка
            # уронит вход всем, кому её когда-то настраивали
            continue

        if permission in OWNER_ONLY:
            continue

        if enabled:
            granted.add(permission)
        else:
            granted.discard(permission)

    return frozenset(granted)


def assignable_permissions(role: StaffRole) -> frozenset[Permission]:
    """Что суперпользователь вправе включить или выключить этой роли."""
    if role is StaffRole.OWNER:
        return frozenset()
    return frozenset(Permission) - OWNER_ONLY
