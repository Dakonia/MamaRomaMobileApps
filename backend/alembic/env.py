import asyncio
from logging.config import fileConfig

from sqlalchemy import Enum, pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.sql.schema import SchemaItem

from alembic import context
from app.core.config import settings
from app.core.db import Base

# Импорт наполняет Base.metadata — без него автогенерация не увидит ни одной таблицы
from app import models  # noqa: F401  isort:skip

config = context.config
config.set_main_option("sqlalchemy.url", str(settings.database_url))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _enum_check_constraints() -> set[str]:
    """Имена CHECK, которые создаёт сам тип Enum.

    В metadata таких ограничений нет — их дорисовывает тип при выпуске DDL.
    Без этого списка автогенерация видит их только в базе и каждый раз
    предлагает удалить, унося валидацию статусов вместе с собой.
    """
    names: set[str] = set()
    for table in target_metadata.tables.values():
        for column in table.columns:
            column_type = column.type
            if isinstance(column_type, Enum) and column_type.name:
                names.add(f"ck_{table.name}_{column_type.name}")
    return names


ENUM_CHECK_CONSTRAINTS = _enum_check_constraints()


def include_object(
    obj: SchemaItem,
    name: str | None,
    type_: str,
    reflected: bool,
    compare_to: SchemaItem | None,
) -> bool:
    return not (type_ == "check_constraint" and name in ENUM_CHECK_CONSTRAINTS)


def run_migrations_offline() -> None:
    context.configure(
        url=str(settings.database_url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
