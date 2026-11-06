import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from database import get_db
from models import User, Pending2FA
from schemas import LoginRequest, LoginResponse, TwoFAStatusResponse, TwoFAVerifyRequest, UserOut, UpdateMeRequest
from auth import verify_password, create_access_token, get_current_user, hash_password
from config import (
    TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID,
    TWO_FA_EXPIRE_SECONDS, DEFAULT_MODEL, AVAILABLE_MODELS
)
from models_catalog import model_options, available_model_options, normalize_model

router = APIRouter(prefix="/api/auth", tags=["auth"])

TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


async def send_2fa_telegram(token: uuid.UUID, username: str, ip: str, db: AsyncSession) -> int | None:
    text = (
        f"🔐 <b>Запрос входа в Claude Web Chat</b>\n\n"
        f"Пользователь: <code>{username}</code>\n"
        f"IP: <code>{ip}</code>\n"
        f"Время: {datetime.now(timezone.utc).strftime('%H:%M:%S UTC')}\n\n"
        f"Разрешить вход?"
    )
    keyboard = {
        "inline_keyboard": [[
            {"text": "✅ Разрешить", "callback_data": f"2fa_approve:{token}"},
            {"text": "❌ Отклонить", "callback_data": f"2fa_deny:{token}"},
        ]]
    }
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(f"{TELEGRAM_API}/sendMessage", json={
                "chat_id": TELEGRAM_ADMIN_CHAT_ID,
                "text": text,
                "parse_mode": "HTML",
                "reply_markup": keyboard,
            }, timeout=10)
            data = resp.json()
            if data.get("ok"):
                return data["result"]["message_id"]
        except Exception:
            pass
    return None


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    if user.role == "admin":
        token = uuid.uuid4()
        expires = datetime.now(timezone.utc) + timedelta(seconds=TWO_FA_EXPIRE_SECONDS)
        ip = request.headers.get("X-Real-IP") or request.client.host
        msg_id = await send_2fa_telegram(token, user.username, ip, db)
        pending = Pending2FA(
            token=token,
            user_id=user.id,
            ip_address=ip,
            expires_at=expires,
            telegram_message_id=msg_id,
        )
        db.add(pending)
        await db.commit()
        return LoginResponse(requires_2fa=True, two_fa_token=str(token))

    access_token = create_access_token(user.id, user.username, user.role)
    return LoginResponse(requires_2fa=False, access_token=access_token)


@router.get("/2fa/status/{token}", response_model=TwoFAStatusResponse)
async def check_2fa_status(token: str, db: AsyncSession = Depends(get_db)):
    try:
        token_uuid = uuid.UUID(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    result = await db.execute(select(Pending2FA).where(Pending2FA.token == token_uuid))
    pending = result.scalar_one_or_none()
    if not pending:
        raise HTTPException(status_code=404, detail="Token not found")

    now = datetime.now(timezone.utc)
    if pending.expires_at.tzinfo is None:
        from datetime import timezone as tz
        expires = pending.expires_at.replace(tzinfo=tz.utc)
    else:
        expires = pending.expires_at

    if expires < now and pending.status == "pending":
        pending.status = "expired"
        await db.commit()

    if pending.status == "approved":
        result2 = await db.execute(select(User).where(User.id == pending.user_id))
        user = result2.scalar_one()
        access_token = create_access_token(user.id, user.username, user.role)
        await db.delete(pending)
        await db.commit()
        return TwoFAStatusResponse(status="approved", access_token=access_token)

    return TwoFAStatusResponse(status=pending.status)


@router.post("/2fa/verify")
async def verify_2fa(body: TwoFAVerifyRequest, db: AsyncSession = Depends(get_db)):
    try:
        token_uuid = uuid.UUID(body.token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    result = await db.execute(select(Pending2FA).where(Pending2FA.token == token_uuid))
    pending = result.scalar_one_or_none()
    if not pending or pending.status != "pending":
        raise HTTPException(status_code=404, detail="Token not found or already used")

    now = datetime.now(timezone.utc)
    expires = pending.expires_at if pending.expires_at.tzinfo else pending.expires_at.replace(tzinfo=timezone.utc)
    if expires < now:
        pending.status = "expired"
        await db.commit()
        raise HTTPException(status_code=410, detail="Token expired")

    pending.status = "approved" if body.action == "approve" else "denied"
    await db.commit()
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    return user


@router.get("/models")
async def list_models(_: User = Depends(get_current_user)):
    return {
        "models": AVAILABLE_MODELS,
        "default": DEFAULT_MODEL,
        "options": model_options(),
        "available_options": available_model_options(),
    }


@router.patch("/me", response_model=UserOut)
async def update_me(body: UpdateMeRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if body.model not in AVAILABLE_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model. Available: {AVAILABLE_MODELS}")
    user.model = normalize_model(body.model)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/init-admin")
async def init_admin(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    existing = result.scalars().all()
    if existing:
        raise HTTPException(status_code=403, detail="Users already exist")
    admin = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role="admin",
        model=DEFAULT_MODEL,
    )
    db.add(admin)
    await db.commit()
    return {"ok": True, "message": "Admin created"}
