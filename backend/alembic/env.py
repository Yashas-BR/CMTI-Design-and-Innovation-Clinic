"""Alembic configuration for database migrations."""

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context
from app.core.config import settings
import app.models  # noqa: F401
from app.models.base import Base

# This is the Alembic Config object
config = context.config

# Configure logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set the SQLAlchemy URL
config.set_main_option(
    "sqlalchemy.url",
    settings.database_url.replace("postgresql://", "postgresql+asyncpg://", 1),
)

# Target metadata for autogenerate support
target_metadata = Base.metadata


def _to_async_db_url(db_url: str) -> str:
    """Normalize PostgreSQL URLs to asyncpg for async Alembic engine."""
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return db_url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = _to_async_db_url(config.get_main_option("sqlalchemy.url"))
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """Run migrations with connection."""
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    db_url = _to_async_db_url(settings.database_url)
    engine = create_async_engine(
        db_url,
        poolclass=pool.NullPool,
        echo=True,
    )

    async with engine.begin() as connection:
        await connection.run_sync(do_run_migrations)

    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
