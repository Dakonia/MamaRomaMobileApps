"""Обновление каталога с сайта сети.

Работает в два шага. Сначала «посмотреть»: импортёр читает сайт, сверяет с
базой и складывает список предлагаемых изменений — ничего не записывая.
Менеджер снимает галочки с лишнего и нажимает «Сохранить» — только тогда
изменения уезжают в базу. Так обновление ничего не портит втихую.
"""

from dataclasses import dataclass, field
from typing import Any, Literal

SyncKind = Literal["menu", "restaurants", "promos"]
ChangeAction = Literal["create", "update", "delete"]

KIND_TITLES: dict[SyncKind, str] = {
    "menu": "Меню",
    "restaurants": "Рестораны",
    "promos": "Акции",
}


@dataclass(slots=True)
class Change:
    """Одно предлагаемое изменение: что за позиция и что с ней станет."""

    external_id: str
    title: str
    action: ChangeAction
    # «цена 690 → 720 ₽, описание» — понятная строка для менеджера
    summary: str
    # Всё, что нужно, чтобы изменение применить: сырые поля с сайта
    payload: dict[str, Any] = field(default_factory=dict)
    group: str | None = None


@dataclass(slots=True)
class Plan:
    changes: list[Change] = field(default_factory=list)
    # Позиции, которые сверили и трогать не нужно
    unchanged: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SyncReport:
    created: int = 0
    updated: int = 0
    removed: int = 0
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        parts = []
        if self.created:
            parts.append(f"добавлено {self.created}")
        if self.updated:
            parts.append(f"обновлено {self.updated}")
        if self.removed:
            parts.append(f"удалено {self.removed}")
        return ", ".join(parts) if parts else "изменений нет"


def describe(field_name: str, before: Any, after: Any) -> str:
    """Строка вида «цена 690 → 720 ₽» для списка изменений."""
    titles = {
        "price_kopecks": "цена",
        "description": "описание",
        "title": "название",
        "name": "название",
        "weight_grams": "вес",
        "volume_ml": "объём",
        "category": "раздел",
        "address": "адрес",
        "phone": "телефон",
        "metro": "метро",
        "hours": "часы работы",
        "point": "координаты",
        "image": "фотография",
        "label": "плашка",
        "restaurants": "рестораны",
        "starts_at": "дата начала",
        "ends_at": "дата окончания",
        "source_url": "ссылка на сайт",
    }
    title = titles.get(field_name, field_name)

    if field_name == "price_kopecks":
        return f"{title} {int(before or 0) // 100} → {int(after or 0) // 100} ₽"
    if before in (None, "", 0):
        return f"{title}: добавим"
    if after in (None, "", 0):
        return f"{title}: уберём"
    return title


async def plan(kind: SyncKind) -> Plan:
    # Импортёры тянут за собой httpx и парсеры — грузим только при запуске
    if kind == "menu":
        from app.import_menu import plan_changes as plan_menu

        return await plan_menu()

    if kind == "restaurants":
        from app.import_restaurants import plan_changes as plan_restaurants

        return await plan_restaurants()

    from app.import_promos import plan_changes as plan_promos

    return await plan_promos()


async def apply(kind: SyncKind, changes: list[Change]) -> SyncReport:
    if kind == "menu":
        from app.import_menu import apply_changes as apply_menu

        return await apply_menu(changes)

    if kind == "restaurants":
        from app.import_restaurants import apply_changes as apply_restaurants

        return await apply_restaurants(changes)

    from app.import_promos import apply_changes as apply_promos

    return await apply_promos(changes)
