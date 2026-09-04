from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import api_router
from app.core import audit
from app.core.config import settings
from app.core.db import engine

__all__ = ["app"]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.project_name,
    version="0.1.0",
    openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    lifespan=lifespan,
)

@app.middleware("http")
async def write_audit_log(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Каждое изменение в админке попадает в журнал.

    Пишем здесь, а не в самих ручках: восемьдесят с лишним ручек — и в любой
    новой запись появится сама, забыть про неё нельзя. Подробности ручки
    добавляют через `audit.describe`.
    """
    response = await call_next(request)

    staff = getattr(request.state, "staff", None)
    if (
        staff is not None
        and request.method in audit.WRITE_METHODS
        and request.url.path not in audit.SKIP_PATHS
        and response.status_code < 400
    ):
        await audit.record(request, staff, response.status_code)

    return response


# Меню сети — это триста килобайт JSON на каждое обновление. В сжатом виде их
# около сорока: на телефоне разница между «моргнуло» и «висит секунду»
app.add_middleware(GZipMiddleware, minimum_size=1_000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Локальную сеть пускаем только на машине разработчика: на публичном стенде
    # это означало бы, что любая страница из домашней сети посетителя может
    # обращаться к нашему API от его имени
    allow_origin_regex=(
        settings.cors_local_network_regex if settings.environment == "local" else None
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


settings.media_root.mkdir(parents=True, exist_ok=True)
app.mount(
    settings.media_url_prefix,
    StaticFiles(directory=settings.media_root),
    name="media",
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/ping")
async def ping() -> dict[str, bool]:
    """Жив ли сервер. Приложение спрашивает это у каждого телефона раз в минуту,
    поэтому здесь не должно быть ни базы, ни зависимостей — только ответ."""
    return {"ok": True}


@app.get("/health")
async def health() -> dict[str, str]:
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))
    return {"status": "ok", "environment": settings.environment}
