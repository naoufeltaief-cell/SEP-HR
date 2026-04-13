"""Database configuration — async SQLAlchemy + PostgreSQL"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/soins_expert")

# Render.com gives postgres:// but asyncpg needs postgresql+asyncpg://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = str(os.getenv(name, str(default)) or str(default)).strip()
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    return max(value, minimum)


DB_POOL_SIZE = _env_int("DB_POOL_SIZE", 5, minimum=1)
DB_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 10, minimum=0)
DB_POOL_TIMEOUT = _env_int("DB_POOL_TIMEOUT", 30, minimum=1)
DB_POOL_RECYCLE = _env_int("DB_POOL_RECYCLE", 1800, minimum=30)
DB_CONNECT_TIMEOUT = _env_int("DB_CONNECT_TIMEOUT", 15, minimum=3)


engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=DB_POOL_RECYCLE,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT,
    pool_use_lifo=True,
    connect_args={"timeout": DB_CONNECT_TIMEOUT},
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
