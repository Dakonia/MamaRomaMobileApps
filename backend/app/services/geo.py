import asyncio
import logging
from dataclasses import asdict, dataclass, fields
from typing import Any

import httpx

from app.core import cache
from app.core.config import settings

logger = logging.getLogger(__name__)

DADATA_SUGGEST = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address"
DADATA_GEOLOCATE = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/geolocate/address"
DADATA_CLEAN = "https://cleaner.dadata.ru/api/v1/clean/address"
YANDEX_GEOCODE = "https://geocode-maps.yandex.ru/1.x/"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "MamaRomaApp/0.1 (address lookup for own mobile app)"

# Открытая карта просит не частить: держим паузу и одну очередь на процесс
SUGGEST_TTL = 24 * 3600
POINT_TTL = 7 * 24 * 3600

OSM_MIN_INTERVAL = 1.0
_osm_last_call = 0.0
_osm_lock = asyncio.Lock()


@dataclass(slots=True)
class Suggestion:
    title: str
    subtitle: str
    city: str
    street: str
    house: str
    building: str
    latitude: float | None = None
    longitude: float | None = None
    # Добирается вместе с адресом: код дома в ФИАС нужен курьерским службам,
    # район и точность координат — будущим зонам доставки
    fias_id: str | None = None
    postal_code: str | None = None
    city_district: str | None = None
    metro: str | None = None
    # Код КЛАДР региона: адрес в Кудрово относится к области, а не к городу
    region_code: str = ""
    # 0 — координаты дома, 1 — соседнего, 2 — улицы, 3+ — только город
    geo_precision: int | None = None


TYPE_WORDS = ("к", "корп", "стр", "литера", "лит", "соор", "влад")


def normalize_building(value: str) -> str:
    """«2» → «к 2»: гость пишет только номер, а в адресе нужен тип части дома."""
    text = value.strip()
    if not text:
        return ""

    first = text.split(" ", 1)[0].rstrip(".").lower()
    if first in TYPE_WORDS:
        return text
    return f"к {text}"


def _block(data: dict[str, Any]) -> str:
    """«литера а» → «литера А»: стандартизация отдаёт букву строчной."""
    block = str(data.get("block") or "")
    if not block:
        return ""
    block_type = str(data.get("block_type") or "к")
    return f"{block_type} {block.upper() if len(block) < 3 else block}"


def _compose(city: str, street: str, house: str, building: str) -> Suggestion:
    title = street
    if house:
        title = f"{title}, {house}"
    if building:
        title = f"{title} {building}"
    return Suggestion(
        title=title,
        subtitle=city,
        city=city,
        street=street,
        house=house,
        building=building,
    )


def from_cache(item: dict[str, Any]) -> Suggestion:
    """Кеш мог лечь до того, как у подсказки появились новые поля — лишнее отбрасываем."""
    known = {field.name for field in fields(Suggestion)}
    return Suggestion(**{key: value for key, value in item.items() if key in known})


def _precision(value: Any) -> int | None:
    return int(value) if isinstance(value, int | str) and str(value).isdigit() else None


def _float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# --- DaData: знает дома, корпуса и строения по всей России -------------------


def _dadata_headers() -> dict[str, str]:
    return {
        "Authorization": f"Token {settings.dadata_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _from_dadata(item: dict[str, Any]) -> Suggestion | None:
    data = item.get("data")
    if not isinstance(data, dict):
        return None

    street = str(data.get("street_with_type") or "")
    if not street:
        return None

    locality = str(data.get("city") or data.get("settlement") or "")
    region = str(data.get("region_with_type") or data.get("region") or "")
    area = str(data.get("area_with_type") or "")

    found = _compose(
        city=locality or region,
        street=street,
        house=str(data.get("house") or ""),
        building=_block(data),
    )
    # Подпись под адресом: по ней видно, что дом в Кудрово, а не в городе.
    # «Санкт-Петербург» и «г Санкт-Петербург» — одно и то же, второй раз не пишем
    parts: list[str] = []
    for part in (locality, area, region):
        if part and not any(part in kept or kept in part for kept in parts):
            parts.append(part)
    found.subtitle = ", ".join(parts)
    found.latitude = _float(data.get("geo_lat"))
    found.longitude = _float(data.get("geo_lon"))
    found.fias_id = data.get("fias_id")
    found.postal_code = data.get("postal_code")
    found.city_district = data.get("city_district_with_type")
    found.geo_precision = _precision(data.get("qc_geo"))
    found.region_code = str(data.get("region_kladr_id") or data.get("kladr_id") or "")[:2]

    stations = data.get("metro")
    nearest = stations[0] if isinstance(stations, list) and stations else None
    if isinstance(nearest, dict):
        found.metro = str(nearest.get("name"))

    return found


async def _dadata_suggest(query: str, regions: list[str], limit: int) -> list[Suggestion]:
    payload: dict[str, Any] = {
        "query": query,
        "count": limit,
        "from_bound": {"value": "street"},
        "to_bound": {"value": "house"},
    }

    if regions:
        # Регион задаём кодом КЛАДР: по названию DaData ничего не находит.
        # Ищем по городу и области вокруг — Кудрово и Мурино уже область,
        # но первый код поднимаем наверх, чтобы свой город шёл раньше пригородов
        payload["locations"] = [{"kladr_id": code} for code in regions]
        payload["locations_boost"] = [{"kladr_id": regions[0]}]

    async with httpx.AsyncClient(timeout=4) as client:
        response = await client.post(DADATA_SUGGEST, headers=_dadata_headers(), json=payload)

    if response.status_code != 200:
        logger.warning("DaData ответила %s", response.status_code)
        return []

    found: list[Suggestion] = []
    for item in response.json().get("suggestions", []):
        entry = _from_dadata(item) if isinstance(item, dict) else None
        if entry and all(entry.title != other.title for other in found):
            found.append(entry)
    return found


async def _dadata_reverse(latitude: float, longitude: float) -> Suggestion | None:
    payload = {"lat": latitude, "lon": longitude, "count": 1, "radius_meters": 200}

    async with httpx.AsyncClient(timeout=4) as client:
        response = await client.post(DADATA_GEOLOCATE, headers=_dadata_headers(), json=payload)

    if response.status_code != 200:
        return None

    for item in response.json().get("suggestions", []):
        entry = _from_dadata(item) if isinstance(item, dict) else None
        if entry:
            return entry
    return None


async def clean_address(text: str) -> Suggestion | None:
    """
    Стандартизация: приводит адрес к виду ФИАС и добирает то, чего нет в подсказках —
    ближайшее метро и попадание внутрь КАД. Нужен секретный ключ.
    """
    if not settings.dadata_token or not settings.dadata_secret:
        return None

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(
                DADATA_CLEAN,
                headers={**_dadata_headers(), "X-Secret": settings.dadata_secret},
                json=[text],
            )
    except httpx.HTTPError as exc:
        logger.warning("Стандартизация адреса недоступна: %s", exc)
        return None

    if response.status_code != 200:
        logger.warning("Стандартизация ответила %s", response.status_code)
        return None

    rows = response.json()
    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        return None

    return _from_dadata({"data": rows[0]})


async def standardize(text: str, regions: list[str]) -> Suggestion | None:
    """
    Приводим введённый адрес к справочному виду. По умолчанию берём подсказки:
    они отдают дом, индекс, ФИАС и координаты, а лимит у них 10 000 в сутки против
    100 у стандартизации. Стандартизацию зовём, только если подсказка не нашлась
    или тариф позволяет платить за метро и КАД.
    """
    if settings.dadata_clean_addresses:
        cleaned = await clean_address(text)
        if cleaned is not None:
            return cleaned

    found = await suggest_addresses(text, regions, limit=1)
    if found:
        return found[0]

    return None if settings.dadata_clean_addresses else await clean_address(text)


# --- Яндекс: запасной вариант, если ключ геокодера уже есть ------------------


def _from_yandex(feature: dict[str, Any]) -> Suggestion | None:
    member = feature.get("GeoObject")
    if not isinstance(member, dict):
        return None

    meta = member.get("metaDataProperty", {}).get("GeocoderMetaData", {}).get("Address", {})
    components = meta.get("Components", [])
    if not isinstance(components, list):
        return None

    parts = {
        str(part.get("kind")): str(part.get("name"))
        for part in components
        if isinstance(part, dict)
    }

    street = parts.get("street", "")
    if not street:
        return None

    point = str(member.get("Point", {}).get("pos", ""))
    longitude, _, latitude = point.partition(" ")

    found = _compose(
        city=parts.get("locality", ""),
        street=street,
        house=parts.get("house", ""),
        building="",
    )
    found.latitude = _float(latitude)
    found.longitude = _float(longitude)
    return found


async def _yandex_request(params: dict[str, str], limit: int) -> list[Suggestion]:
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            YANDEX_GEOCODE,
            params={
                "apikey": settings.yandex_geocoder_key,
                "format": "json",
                "lang": "ru_RU",
                "results": str(limit),
                **params,
            },
        )

    if response.status_code != 200:
        logger.warning("Яндекс.Геокодер ответил %s", response.status_code)
        return []

    collection = response.json().get("response", {}).get("GeoObjectCollection", {})
    found: list[Suggestion] = []
    for feature in collection.get("featureMember", []):
        entry = _from_yandex(feature) if isinstance(feature, dict) else None
        if entry and all(entry.title != other.title for other in found):
            found.append(entry)
    return found


# --- OpenStreetMap: работает без ключей, но медленно и знает не всё ----------


def _from_osm(item: dict[str, Any]) -> Suggestion | None:
    address = item.get("address")
    if not isinstance(address, dict):
        return None

    street = str(address.get("road") or address.get("pedestrian") or "")
    if not street:
        return None

    found = _compose(
        city=str(address.get("city") or address.get("town") or ""),
        street=street,
        house=str(address.get("house_number") or ""),
        building="",
    )
    found.latitude = _float(item.get("lat"))
    found.longitude = _float(item.get("lon"))
    return found


async def _osm_get(url: str, params: dict[str, str]) -> Any:
    global _osm_last_call

    async with _osm_lock:
        loop = asyncio.get_event_loop()
        delay = OSM_MIN_INTERVAL - (loop.time() - _osm_last_call)
        if delay > 0:
            await asyncio.sleep(delay)
        _osm_last_call = loop.time()

        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=8) as client:
            response = await client.get(url, params=params)

    return response.json() if response.status_code == 200 else None


async def _osm_suggest(query: str, limit: int) -> list[Suggestion]:
    body = await _osm_get(
        NOMINATIM,
        {
            "q": query,
            "format": "jsonv2",
            "addressdetails": "1",
            "countrycodes": "ru",
            "limit": str(limit),
            "accept-language": "ru",
        },
    )

    found: list[Suggestion] = []
    for item in body or []:
        entry = _from_osm(item) if isinstance(item, dict) else None
        if entry and all(entry.title != other.title for other in found):
            found.append(entry)
    return found


async def _osm_reverse(latitude: float, longitude: float) -> Suggestion | None:
    body = await _osm_get(
        NOMINATIM_REVERSE,
        {
            "lat": str(latitude),
            "lon": str(longitude),
            "format": "jsonv2",
            "addressdetails": "1",
            "accept-language": "ru",
            "zoom": "18",
        },
    )
    return _from_osm(body) if isinstance(body, dict) else None


# --- Точки входа ------------------------------------------------------------


async def suggest_addresses(
    query: str, regions: list[str], limit: int = 8
) -> list[Suggestion]:
    text = " ".join(query.split()).strip()
    if len(text) < 3:
        return []

    key = f"geo:suggest:{'|'.join(regions)}:{text.lower()}"
    cached = await cache.get_json(key)
    if cached is not None:
        return [from_cache(item) for item in cached]

    try:
        if settings.dadata_token:
            found = await _dadata_suggest(text, regions, limit)
        elif settings.yandex_geocoder_key:
            found = await _yandex_request({"geocode": text, "kind": "house"}, limit)
        else:
            found = await _osm_suggest(text, limit)
    except httpx.HTTPError as exc:
        logger.warning("Подсказки адресов недоступны: %s", exc)
        return []

    # Один и тот же кусок улицы набирают тысячи гостей — платим за него раз в сутки
    await cache.set_json(key, [asdict(item) for item in found], SUGGEST_TTL)
    return found


async def reverse_geocode(latitude: float, longitude: float) -> Suggestion | None:
    # Округляем до ~10 метров: соседние точки одного дома дают один и тот же адрес
    key = f"geo:point:{latitude:.4f}:{longitude:.4f}"
    cached = await cache.get_json(key)
    if cached is not None:
        return from_cache(cached) if cached else None

    try:
        if settings.dadata_token:
            found = await _dadata_reverse(latitude, longitude)
        elif settings.yandex_geocoder_key:
            rows = await _yandex_request(
                {"geocode": f"{longitude},{latitude}", "kind": "house", "sco": "longlat"}, 1
            )
            found = rows[0] if rows else None
        else:
            found = await _osm_reverse(latitude, longitude)
    except httpx.HTTPError as exc:
        logger.warning("Обратное геокодирование недоступно: %s", exc)
        return None

    await cache.set_json(key, asdict(found) if found else None, POINT_TTL)
    return found
