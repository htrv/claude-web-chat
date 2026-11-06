from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import state
from database import get_db
from models import User, AppSetting
from schemas import UserCreate, UserUpdate, UserOut
from auth import require_admin, hash_password
from config import AVAILABLE_MODELS, DEFAULT_MODEL, CLAUDE_PROXIES, CLAUDE_PROXIES_BY_NAME
from models_catalog import model_options, available_model_options, normalize_model

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
async def list_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).order_by(User.created_at))
    return result.scalars().all()


@router.post("/users", response_model=UserOut)
async def create_user(body: UserCreate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already exists")
    if body.model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model. Available: {AVAILABLE_MODELS}")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        model=normalize_model(body.model),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == admin.id and body.role is not None and body.role != "admin":
        raise HTTPException(status_code=400, detail="Cannot demote yourself")

    if body.role is not None:
        user.role = body.role
    if body.model is not None:
        if body.model not in AVAILABLE_MODELS:
            raise HTTPException(status_code=400, detail=f"Unknown model. Available: {AVAILABLE_MODELS}")
        user.model = normalize_model(body.model)
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password is not None:
        user.password_hash = hash_password(body.password)

    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"ok": True}


@router.get("/models")
async def list_models(_: User = Depends(require_admin)):
    return {
        "models": AVAILABLE_MODELS,
        "default": DEFAULT_MODEL,
        "options": model_options(),
        "available_options": available_model_options(),
    }


class ClaudeAuthUpdate(BaseModel):
    mode: str  # subscription | proxy
    proxy: str | None = None


@router.get("/claude-auth")
async def get_claude_auth(_: User = Depends(require_admin)):
    return {
        "mode": state.claude_auth_mode,
        "active_proxy": state.claude_active_proxy,
        # api_key намеренно не отдаём фронту — он только в .env (config.CLAUDE_PROXIES)
        "proxies": [{"name": p["name"], "base_url": p["base_url"]} for p in CLAUDE_PROXIES],
    }


@router.put("/claude-auth")
async def set_claude_auth(body: ClaudeAuthUpdate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    if body.mode not in ("subscription", "proxy"):
        raise HTTPException(status_code=400, detail="mode must be 'subscription' or 'proxy'")
    if body.mode == "proxy":
        if not body.proxy or body.proxy not in CLAUDE_PROXIES_BY_NAME:
            raise HTTPException(status_code=400, detail=f"Unknown proxy. Available: {list(CLAUDE_PROXIES_BY_NAME)}")

    active_proxy = body.proxy if body.mode == "proxy" else None

    row = await db.get(AppSetting, 1)
    if not row:
        row = AppSetting(id=1)
        db.add(row)
    row.claude_auth_mode = body.mode
    row.claude_active_proxy = active_proxy
    await db.commit()

    state.claude_auth_mode = body.mode
    state.claude_active_proxy = active_proxy

    return {"mode": state.claude_auth_mode, "active_proxy": state.claude_active_proxy}
