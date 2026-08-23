"""
Проставляет координаты адресам, сохранённым до появления карты.

Без координат приложение не знает, в какую зону попадает адрес, и не может
показать гостю, какой ресторан к нему везёт. Прогоняем такие адреса через тот
же справочник, что и подсказки при вводе.

Запуск: uv run python -m app.backfill_address_points [--dry]
"""

import asyncio
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.tenants import get_tenant
from app.models.geo import City
from app.models.guest import GuestAddress
from app.services import address_book

TENANT_ID = "mamaroma"


async def main(dry: bool) -> None:
    tenant = get_tenant(TENANT_ID)

    async with SessionLocal() as session:
        rows = list(
            await session.scalars(
                select(GuestAddress).where(
                    GuestAddress.tenant_id == tenant.id,
                    GuestAddress.latitude.is_(None),
                )
            )
        )
        print(f"Адресов без координат: {len(rows)}")

        cities = {
            city.id: city
            for city in await session.scalars(select(City).where(City.tenant_id == tenant.id))
        }

        filled = 0
        for address in rows:
            city = cities.get(address.city_id)
            regions = city.suggest_regions if city else []
            # Город в запрос не подставляем: у адреса в Кудрово он только мешает,
            # а нужный регион и так задан кодами КЛАДР
            parts = [address.locality or "", address.street, address.house, address.building or ""]
            text = ", ".join(part for part in parts if part)

            found = await address_book.search(session, text, regions, limit=1)
            point = found[0] if found else None

            if point is None or point.latitude is None:
                print(f"  не нашли: {text}")
                continue

            print(f"  {text} → {point.latitude:.5f}, {point.longitude:.5f}")
            if not dry:
                address.latitude = point.latitude
                address.longitude = point.longitude
                if point.city and not address.locality and city and point.city != city.name:
                    address.locality = point.city
            filled += 1

        if not dry:
            await session.commit()

        print(f"{'Нашли' if dry else 'Проставлено'} координат: {filled} из {len(rows)}")


if __name__ == "__main__":
    asyncio.run(main(dry="--dry" in sys.argv))
