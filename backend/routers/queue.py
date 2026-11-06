import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import QueueTask, QueueSchedule, Chat
from schemas import QueueTaskOut, QueueTaskCreate, QueueScheduleOut, QueueScheduleUpdate
from auth import get_current_user
from models import User

router = APIRouter(prefix="/api/queue", tags=["queue"])


@router.get("/tasks", response_model=list[QueueTaskOut])
async def list_tasks(
    status: str | None = None,
    chat_id: uuid.UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(QueueTask).where(QueueTask.user_id == current_user.id)
    if status and status != "all":
        stmt = stmt.where(QueueTask.status == status)
    if chat_id:
        stmt = stmt.where(QueueTask.chat_id == chat_id)
    stmt = stmt.order_by(QueueTask.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/tasks", response_model=QueueTaskOut)
async def create_task(
    body: QueueTaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == body.chat_id, Chat.user_id == current_user.id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    task = QueueTask(
        chat_id=body.chat_id,
        user_id=current_user.id,
        prompt=body.prompt,
        model=body.model,
        claude_session_id=body.claude_session_id or chat.claude_session_id,
        resume_at=body.resume_at,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(QueueTask).where(QueueTask.id == task_id, QueueTask.user_id == current_user.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "running":
        raise HTTPException(status_code=400, detail="Cannot delete a running task")
    await db.delete(task)
    await db.commit()
    return {"ok": True}


@router.post("/tasks/{task_id}/run")
async def run_task_now(
    task_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Force-run a pending task immediately, ignoring resume_at and schedule."""
    result = await db.execute(select(QueueTask).where(QueueTask.id == task_id, QueueTask.user_id == current_user.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != "pending":
        raise HTTPException(status_code=400, detail=f"Task is {task.status}, only pending tasks can be started")

    # Clear resume_at so the runner picks it up on next tick
    task.resume_at = None
    task.status = "pending"
    await db.commit()

    # Trigger immediately via queue runner
    import queue_runner
    import asyncio
    asyncio.create_task(queue_runner.run_task(task_id))

    return {"ok": True}


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(QueueTask).where(QueueTask.id == task_id, QueueTask.user_id == current_user.id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Cannot cancel task with status {task.status}")
    task.status = "cancelled"
    await db.commit()
    await db.refresh(task)
    return task


@router.get("/schedule/{chat_id}", response_model=QueueScheduleOut)
async def get_schedule(
    chat_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == current_user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    result2 = await db.execute(select(QueueSchedule).where(QueueSchedule.chat_id == chat_id))
    schedule = result2.scalar_one_or_none()
    if not schedule:
        # Return default
        return QueueScheduleOut(chat_id=chat_id, mode="auto")
    return schedule


@router.put("/schedule/{chat_id}", response_model=QueueScheduleOut)
async def update_schedule(
    chat_id: uuid.UUID,
    body: QueueScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.mode not in ("manual", "auto", "window"):
        raise HTTPException(status_code=400, detail="mode must be manual, auto, or window")
    if body.mode == "window" and (not body.window_from or not body.window_to):
        raise HTTPException(status_code=400, detail="window mode requires window_from and window_to (HH:MM)")

    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == current_user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Chat not found")

    result2 = await db.execute(select(QueueSchedule).where(QueueSchedule.chat_id == chat_id))
    schedule = result2.scalar_one_or_none()
    if not schedule:
        schedule = QueueSchedule(chat_id=chat_id)
        db.add(schedule)

    schedule.mode = body.mode
    schedule.window_from = body.window_from if body.mode == "window" else None
    schedule.window_to = body.window_to if body.mode == "window" else None
    await db.commit()
    await db.refresh(schedule)
    return schedule
