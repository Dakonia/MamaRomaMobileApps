from app.models.geo import Restaurant
from app.models.promotion import Promotion
from app.schemas.promotion import PromotionRead


def to_read(promotion: Promotion) -> PromotionRead:
    """Список ресторанов отдаём вместе с названиями: приложение показывает,
    где действует акция, и поднимает наверх акции ресторана гостя."""
    restaurants: list[Restaurant] = list(promotion.restaurants)

    return PromotionRead(
        id=promotion.id,
        title=promotion.title,
        description=promotion.description,
        label=promotion.label,
        image_url=promotion.image_url,
        image_blurhash=promotion.image_blurhash,
        image_width=promotion.image_width,
        image_height=promotion.image_height,
        restaurant_ids=[restaurant.id for restaurant in restaurants],
        restaurant_names=[restaurant.name for restaurant in restaurants],
        starts_at=promotion.starts_at,
        ends_at=promotion.ends_at,
        show_in_menu=promotion.show_in_menu,
        source_url=promotion.source_url,
    )
