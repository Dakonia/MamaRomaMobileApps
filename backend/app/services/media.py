import secrets
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from PIL.Image import Image as PILImage
from PIL.Image import Resampling

from app.core.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


class MediaError(Exception):
    pass


def save_image(data: bytes, content_type: str | None, folder: str) -> str:
    """Кладёт картинку на диск и возвращает относительную ссылку.

    Ссылка относительная (/media/dishes/xxx.webp), потому что домен ещё
    не выбран — клиент дописывает адрес сервера сам.
    """
    if content_type is not None and content_type not in ALLOWED_TYPES:
        raise MediaError("Поддерживаем JPEG, PNG и WebP")

    if len(data) > settings.max_upload_bytes:
        limit = settings.max_upload_bytes // (1024 * 1024)
        raise MediaError(f"Файл больше {limit} МБ")

    try:
        opened = Image.open(BytesIO(data))
        opened.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise MediaError("Это не изображение или файл повреждён") from exc

    image: PILImage = opened.convert("RGB")

    side = settings.image_max_side
    if max(image.size) > side:
        ratio = side / max(image.size)
        image = image.resize(
            (round(image.width * ratio), round(image.height * ratio)), Resampling.LANCZOS
        )

    directory = settings.media_root / folder
    directory.mkdir(parents=True, exist_ok=True)

    name = f"{secrets.token_hex(12)}.webp"
    image.save(directory / name, format="WEBP", quality=settings.image_quality, method=6)

    return f"{settings.media_url_prefix}/{folder}/{name}"


def delete_image(url: str | None) -> None:
    if not url or not url.startswith(settings.media_url_prefix):
        return

    relative = url[len(settings.media_url_prefix) :].lstrip("/")
    path = (settings.media_root / relative).resolve()

    # Защита от «../»: удаляем только внутри своей папки
    if settings.media_root.resolve() in path.parents:
        path.unlink(missing_ok=True)
