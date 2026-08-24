from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select, update

from app.api.deps import GuestDep, SessionDep, TenantDep
from app.models.enums import OrderStatus
from app.models.geo import City, Restaurant
from app.models.guest import Device
from app.models.menu import Dish
from app.models.notification import Campaign, CampaignDelivery, CartSnapshot
from app.models.order import Order, OrderItem
from app.schemas.auth import GuestRead
from app.schemas.guest import (
    AddressCreate,
    AddressRead,
    AddressSuggestion,
    AddressUpdate,
    CartPing,
    DeviceWrite,
    FavouriteDish,
    GuestSummary,
    GuestUpdate,
    MessageRead,
)
from app.services import address_book
from app.services import delivery as delivery_service
from app.services import geo as geo_service
from app.services import guest as guest_service

router = APIRouter(tags=["Профиль"])


@router.patch("/me", summary="Изменить данные гостя")
async def update_me(payload: GuestUpdate, session: SessionDep, guest: GuestDep) -> GuestRead:
    updated = await guest_service.update_guest(session, guest, payload)
    return GuestRead.model_validate(updated)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить аккаунт вместе с личными данными",
)
async def delete_me(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> None:
    """Требование Apple к приложениям со входом и право на забвение по ФЗ-152."""
    await guest_service.delete_account(session, tenant, guest)


@router.put("/devices", status_code=status.HTTP_204_NO_CONTENT, summary="Устройство для пушей")
async def register_device(
    payload: DeviceWrite,
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
) -> None:
    """Приложение присылает токен при каждом запуске: он может смениться."""
    device = await session.scalar(
        select(Device).where(
            Device.tenant_id == tenant.id, Device.push_token == payload.push_token
        )
    )

    if device is None:
        device = Device(tenant_id=tenant.id, push_token=payload.push_token)
        session.add(device)

    # Телефон мог перейти к другому гостю — привязку обновляем всегда
    device.guest_id = guest.id
    device.platform = payload.platform
    device.app_version = payload.app_version
    device.is_active = True
    device.last_seen_at = datetime.now(UTC)

    await session.commit()


@router.delete(
    "/devices/{push_token}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Отключить уведомления на устройстве",
)
async def forget_device(
    push_token: str,
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
) -> None:
    await session.execute(
        update(Device)
        .where(
            Device.tenant_id == tenant.id,
            Device.guest_id == guest.id,
            Device.push_token == push_token,
        )
        .values(is_active=False)
    )
    await session.commit()


@router.put("/cart", status_code=status.HTTP_204_NO_CONTENT, summary="След корзины")
async def remember_cart(
    payload: CartPing, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> None:
    """Приложение сообщает, что в корзине что-то лежит.

    Нужно ровно для одного: напомнить, если гость собрал корзину и ушёл.
    Пустая корзина стирает след — напоминать станет не о чем.
    """
    snapshot = await session.scalar(
        select(CartSnapshot).where(
            CartSnapshot.tenant_id == tenant.id, CartSnapshot.guest_id == guest.id
        )
    )

    if payload.positions == 0:
        if snapshot is not None:
            await session.delete(snapshot)
            await session.commit()
        return

    if snapshot is None:
        snapshot = CartSnapshot(tenant_id=tenant.id, guest_id=guest.id)
        session.add(snapshot)

    snapshot.positions = payload.positions
    snapshot.total_kopecks = payload.total_kopecks
    snapshot.changed_at = datetime.now(UTC)
    # Корзина изменилась — считаем её новой и напомним о ней ещё раз
    snapshot.reminded_at = None

    await session.commit()


@router.get("/messages", summary="Лента сообщений гостя")
async def messages(
    session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> list[MessageRead]:
    """Те же рассылки, что уходили уведомлениями, но внутри приложения.

    Половина гостей уведомления не разрешает — лента даёт им те же новости,
    когда они сами открывают приложение.
    """
    rows = (
        await session.execute(
            select(Campaign, CampaignDelivery)
            .join(CampaignDelivery, CampaignDelivery.campaign_id == Campaign.id)
            .where(
                CampaignDelivery.tenant_id == tenant.id,
                CampaignDelivery.guest_id == guest.id,
            )
            .order_by(CampaignDelivery.sent_at.desc())
            .limit(40)
        )
    ).all()

    return [
        MessageRead(
            id=campaign.id,
            title=campaign.title,
            body=campaign.body,
            image_url=campaign.image_url,
            target=campaign.target or {},
            sent_at=delivery.sent_at,
            is_read=delivery.opened_at is not None,
        )
        for campaign, delivery in rows
    ]


@router.post(
    "/messages/{campaign_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Отметить сообщение прочитанным",
)
async def read_message(
    campaign_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> None:
    delivery = await session.scalar(
        select(CampaignDelivery).where(
            CampaignDelivery.tenant_id == tenant.id,
            CampaignDelivery.campaign_id == campaign_id,
            CampaignDelivery.guest_id == guest.id,
        )
    )
    if delivery is None or delivery.opened_at is not None:
        return

    delivery.opened_at = datetime.now(UTC)

    # Счётчик открытий рассылки: по нему видно, какие темы цепляют
    campaign = await session.get(Campaign, campaign_id)
    if campaign is not None:
        campaign.opened_count += 1

    await session.commit()


@router.get("/addresses", summary="Адреса доставки гостя")
async def list_addresses(
    session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> list[AddressRead]:
    rows = await guest_service.list_addresses(session, tenant, guest)

    result: list[AddressRead] = []
    for row in rows:
        card = guest_service.to_read(row)

        # Зона считается по координатам: у адресов, введённых до карты, их нет
        if row.latitude is not None and row.longitude is not None:
            match = await delivery_service.resolve(session, tenant, row.latitude, row.longitude)
            if match is not None:
                card.restaurant_id = match.restaurant.id
                card.restaurant_name = match.restaurant.name
                card.delivery_covered = not match.restaurant.is_paused

        result.append(card)

    return result


@router.post("/addresses", status_code=status.HTTP_201_CREATED, summary="Добавить адрес")
async def add_address(
    payload: AddressCreate, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> AddressRead:
    try:
        address = await guest_service.add_address(session, tenant, guest, payload)
    except guest_service.GuestError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return guest_service.to_read(address)


@router.patch("/addresses/{address_id}", summary="Изменить адрес")
async def update_address(
    address_id: UUID,
    payload: AddressUpdate,
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
) -> AddressRead:
    try:
        address = await guest_service.update_address(session, tenant, guest, address_id, payload)
    except guest_service.GuestError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return guest_service.to_read(address)


@router.delete(
    "/addresses/{address_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить адрес",
)
async def delete_address(
    address_id: UUID, session: SessionDep, tenant: TenantDep, guest: GuestDep
) -> None:
    try:
        await guest_service.delete_address(session, tenant, guest, address_id)
    except guest_service.GuestError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc


def _to_suggestion(item: geo_service.Suggestion) -> AddressSuggestion:
    return AddressSuggestion(
        title=item.title,
        subtitle=item.subtitle,
        city=item.city,
        street=item.street,
        house=item.house,
        building=item.building,
        latitude=item.latitude,
        longitude=item.longitude,
    )


async def _regions(session: SessionDep, tenant: TenantDep, city_id: UUID | None) -> list[str]:
    """Где искать адрес: сам город и области вокруг него из настроек города."""
    if city_id is None:
        return []
    city = await session.scalar(select(City).where(City.id == city_id, City.tenant_id == tenant.id))
    if city is None:
        return []
    return city.suggest_regions


@router.get("/addresses/suggest", summary="Подсказки по адресу")
async def suggest(
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
    query: Annotated[str, Query(min_length=3, max_length=120)],
    city_id: Annotated[UUID | None, Query()] = None,
) -> list[AddressSuggestion]:
    regions = await _regions(session, tenant, city_id)
    found = await address_book.search(session, query, regions)
    return [_to_suggestion(item) for item in found]


@router.get("/addresses/locate", summary="Адрес по координатам")
async def locate(
    session: SessionDep,
    tenant: TenantDep,
    guest: GuestDep,
    latitude: Annotated[float, Query(ge=-90, le=90)],
    longitude: Annotated[float, Query(ge=-180, le=180)],
) -> AddressSuggestion | None:
    found = await geo_service.reverse_geocode(latitude, longitude)
    if found is None:
        return None

    # Раз уж заплатили за точку — пусть адрес останется в своём справочнике
    await address_book.remember(session, "", [found])
    return _to_suggestion(found)


@router.get("/me/summary", summary="Итоги гостя: траты и любимые блюда")
async def summary(session: SessionDep, tenant: TenantDep, guest: GuestDep) -> GuestSummary:
    totals = (
        await session.execute(
            select(
                func.count(Order.id),
                func.coalesce(func.sum(Order.total_kopecks), 0),
            ).where(
                Order.tenant_id == tenant.id,
                Order.guest_id == guest.id,
                Order.status != OrderStatus.CANCELLED,
            )
        )
    ).one()

    favourite_restaurant = await session.scalar(
        select(Restaurant.name)
        .join(Order, Order.restaurant_id == Restaurant.id)
        .where(
            Order.tenant_id == tenant.id,
            Order.guest_id == guest.id,
            Order.status != OrderStatus.CANCELLED,
        )
        .group_by(Restaurant.name)
        .order_by(func.count(Order.id).desc())
        .limit(1)
    )

    # Считаем по позициям заказов: три блюда, которые гость берёт чаще всего.
    # Цену и фото берём актуальные — за полгода блюдо могло подорожать
    rows = await session.execute(
        select(Dish, func.sum(OrderItem.quantity).label("times"))
        .join(OrderItem, OrderItem.dish_id == Dish.id)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            Order.tenant_id == tenant.id,
            Order.guest_id == guest.id,
            Order.status != OrderStatus.CANCELLED,
            Dish.is_active.is_(True),
        )
        .group_by(Dish.id)
        .order_by(func.sum(OrderItem.quantity).desc())
        .limit(3)
    )

    return GuestSummary(
        orders_count=totals[0] or 0,
        spent_kopecks=totals[1] or 0,
        favourite_restaurant=favourite_restaurant,
        favourites=[
            FavouriteDish(
                dish_id=dish.id,
                name=dish.name,
                image_url=dish.image_url,
                price_kopecks=dish.price_kopecks,
                times=int(times),
            )
            for dish, times in rows.all()
        ],
    )
