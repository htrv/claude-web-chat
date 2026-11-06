from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False, connect_args={"ssl": False})
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def init_db():
    from models import User, Chat, Message, Pending2FA, QueueTask, QueueSchedule, AppSetting  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from config import DEFAULT_WORKSPACE, CLAUDE_AUTH_MODE_DEFAULT
        await conn.execute(text(
            "ALTER TABLE chats ADD COLUMN IF NOT EXISTS workspace VARCHAR(500) "
            f"NOT NULL DEFAULT '{DEFAULT_WORKSPACE}'"
        ))
        await conn.execute(text(
            f"ALTER TABLE chats ALTER COLUMN workspace SET DEFAULT '{DEFAULT_WORKSPACE}'"
        ))
        await conn.execute(text(
            "INSERT INTO app_settings (id, claude_auth_mode) VALUES (1, :mode) "
            "ON CONFLICT (id) DO NOTHING"
        ), {"mode": CLAUDE_AUTH_MODE_DEFAULT})
