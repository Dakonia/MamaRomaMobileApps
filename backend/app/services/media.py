import secrets
from io import BytesIO
from pathlib import Path

import blurhash
from PIL import Image, UnidentifiedImageError
from PIL.Image import Image as PILImage
from PIL.Image import Resampling

from app.core.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


class MediaError(Exception):
    pass


def save_image(
    data: bytes,
    content_type: str | None,
    folder: str,
    max_side: int | None = None,
    quality: int | None = None,
) -> str:
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

    side = max_side or settings.image_max_side
    if max(image.size) > side:
        ratio = side / max(image.size)
        image = image.resize(
            (round(image.width * ratio), round(image.height * ratio)), Resampling.LANCZOS
        )

    directory = settings.media_root / folder
    directory.mkdir(parents=True, exist_ok=True)

    name = f"{secrets.token_hex(12)}.webp"
    image.save(directory / name, format="WEBP", quality=quality or settings.image_quality, method=6)

    return f"{settings.media_url_prefix}/{folder}/{name}"


def _path_for(url: str | None) -> Path | None:
    """Ссылка вида /media/dishes/x.webp → файл на диске, если он наш."""
    if not url or not url.startswith(settings.media_url_prefix):
        return None

    relative = url[len(settings.media_url_prefix) :].lstrip("/")
    path = (settings.media_root / relative).resolve()
    if settings.media_root.resolve() not in path.parents:
        return None

    return path


def blurhash_for(url: str | None) -> str | None:
    """Короткий отпечаток картинки: пока грузится снимок, приложение показывает
    размытое пятно его собственных цветов, а не серый прямоугольник."""
    path = _path_for(url)
    if path is None:
        return None

    try:
        with Image.open(path) as image:
            small = image.convert("RGB")
            small.thumbnail((64, 64))
            return str(blurhash.encode(small, x_components=4, y_components=3))
    except (UnidentifiedImageError, OSError, ValueError):
        return None


def dimensions(url: str | None) -> tuple[int, int] | None:
    """Размеры уже сохранённой картинки по её ссылке."""
    path = _path_for(url)
    if path is None:
        return None

    try:
        with Image.open(path) as image:
            return image.size
    except (UnidentifiedImageError, OSError):
        return None


def delete_image(url: str | None) -> None:
    if not url or not url.startswith(settings.media_url_prefix):
        return

    relative = url[len(settings.media_url_prefix) :].lstrip("/")
    path = (settings.media_root / relative).resolve()

    # Защита от «../»: удаляем только внутри своей папки
    if settings.media_root.resolve() in path.parents:
        path.unlink(missing_ok=True)
