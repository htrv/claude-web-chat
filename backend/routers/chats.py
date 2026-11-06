import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from database import get_db
from models import User, Chat, Message
from schemas import ChatCreate, ChatUpdate, ChatOut, MessageOut, MessagesPage
from auth import get_current_user

router = APIRouter(prefix="/api/chats", tags=["chats"])


@router.get("", response_model=list[ChatOut])
async def list_chats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chats_result = await db.execute(
        select(Chat).where(Chat.user_id == user.id).order_by(Chat.updated_at.desc())
    )
    chats = chats_result.scalars().all()
    if not chats:
        return []

    chat_ids = [c.id for c in chats]
    counts_result = await db.execute(
        select(Message.chat_id, func.count(Message.id).label("cnt"))
        .where(Message.chat_id.in_(chat_ids))
        .group_by(Message.chat_id)
    )
    counts = {row.chat_id: row.cnt for row in counts_result}

    return [
        ChatOut(
            id=c.id,
            title=c.title,
            workspace=c.workspace,
            message_count=counts.get(c.id, 0),
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in chats
    ]


@router.post("", response_model=ChatOut)
async def create_chat(body: ChatCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chat = Chat(user_id=user.id, title=body.title, workspace=body.workspace)
    db.add(chat)
    await db.commit()
    await db.refresh(chat)
    return chat


@router.patch("/{chat_id}", response_model=ChatOut)
async def update_chat(chat_id: uuid.UUID, body: ChatUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    if body.title is not None:
        chat.title = body.title
    if body.workspace is not None:
        chat.workspace = body.workspace
    await db.commit()
    await db.refresh(chat)
    return chat


@router.delete("/{chat_id}")
async def delete_chat(chat_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.delete(chat)
    await db.commit()
    return {"ok": True}


@router.delete("/{chat_id}/messages/{message_id}")
async def delete_message(chat_id: uuid.UUID, message_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")
    result2 = await db.execute(select(Message).where(Message.id == message_id, Message.chat_id == chat_id))
    msg = result2.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(msg)
    await db.commit()
    return {"ok": True}


@router.get("/{chat_id}/messages", response_model=MessagesPage)
async def get_messages(
    chat_id: uuid.UUID,
    limit: Optional[int] = Query(default=None),
    before_id: Optional[uuid.UUID] = Query(default=None),
    all: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    query = select(Message).where(Message.chat_id == chat_id)

    # Resolve cursor timestamp if before_id is given
    ref_time = None
    if before_id is not None:
        ref = await db.execute(select(Message.created_at).where(Message.id == before_id))
        ref_time = ref.scalar_one_or_none()
        if ref_time:
            query = query.where(Message.created_at < ref_time)

    if not all and limit is not None:
        # Paginated: fetch DESC limit+1, then reverse for chronological order
        rows = list((await db.execute(
            query.order_by(Message.created_at.desc()).limit(limit + 1)
        )).scalars().all())
        has_more = len(rows) > limit
        rows = rows[:limit]
        rows.reverse()
    else:
        # Full load (all=True or no limit given)
        rows = list((await db.execute(query.order_by(Message.created_at))).scalars().all())
        has_more = False

    return {"items": rows, "has_more": has_more}
