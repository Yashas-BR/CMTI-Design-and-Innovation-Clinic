"""Database configuration and session setup."""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings


def _to_async_db_url(db_url: str) -> str:
    """Normalize PostgreSQL URL for SQLAlchemy async engine."""
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return db_url

# Create async engine
engine = create_async_engine(
    _to_async_db_url(settings.database_url),
    echo=settings.database_echo,
    future=True,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=0,
)

# Create async session factory
SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency function to get database session.

    Yields:
        AsyncSession: Database session for use in routes
    """
    async with SessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
