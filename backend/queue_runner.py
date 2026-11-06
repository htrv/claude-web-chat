import asyncio
import re
import time
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, or_, update
from sqlalchemy.ext.asyncio import AsyncSession

import state
from database import SessionLocal
from models import QueueTask, QueueSchedule, Chat, User, Message
from claude_client import stream_claude
from models_catalog import normalize_model
from file_downloads import process_download_markers

LIMIT_RE = re.compile(
    r"you['']ve hit your.*?limit.*?resets\s+(\d{1,2}(?::\d{2})?(?:am|pm))\s+\(([^)]+)\)",
    re.IGNORECASE | re.DOTALL,
)


def parse_limit_reset(text: str) -> datetime | None:
    m = LIMIT_RE.search(text)
    if not m:
        return None
    time_str, tz_name = m.group(1), m.group(2)
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
        now_local = datetime.now(tz)
        fmt = "%I:%M%p" if ":" in time_str else "%I%p"
        t = datetime.strptime(time_str.upper(), fmt).replace(
            year=now_local.year,
            month=now_local.month,
            day=now_local.day,
            tzinfo=tz,
        )
        if t <= now_local:
            t += timedelta(days=1)
        return (t + timedelta(minutes=5)).astimezone(timezone.utc)
    except Exception:
        return None


def _in_window(window_from: str | None, window_to: str | None) -> bool:
    if not window_from or not window_to:
        return True
    now_hm = datetime.now().strftime("%H:%M")
    if window_from <= window_to:
        return window_from <= now_hm <= window_to
    # overnight window (e.g. 22:00–06:00)
    return now_hm >= window_from or now_hm <= window_to


async def _broadcast(chat_id_str: str, event: dict):
    for ws in list(state.chat_ws_map.get(chat_id_str, set())):
        try:
            await ws.send_json(event)
        except Exception:
            state.chat_ws_map.get(chat_id_str, set()).discard(ws)


async def run_task(task_id: uuid.UUID):
    async with SessionLocal() as db:
        # Atomic claim: only one caller wins the pending→running transition, so
        # the background runner and a manual "run now" can't both execute it.
        claim = await db.execute(
            update(QueueTask)
            .where(QueueTask.id == task_id, QueueTask.status == "pending")
            .values(status="running")
        )
        await db.commit()
        if claim.rowcount == 0:
            return

        task = await db.get(QueueTask, task_id)
        if not task:
            return

        chat = await db.get(Chat, task.chat_id)
        user = await db.get(User, task.user_id)
        if not chat or not user:
            task.status = "error"
            task.error = "Chat or user not found"
            await db.commit()
            return

        chat_id_str = str(chat.id)
        session_key = str(uuid.uuid4())
        state.active_sessions[session_key] = {
            "session_id": session_key,
            "chat_id": chat_id_str,
            "username": user.username,
            "model": user.model,
            "prompt_preview": task.prompt[:100],
            "status": "thinking",
            "content_so_far": "",
            "thinking_so_far": "",
            "started_at": time.time(),
        }

        await _broadcast(chat_id_str, {"type": "thinking"})

        full_response = ""
        full_thinking = ""
        usage_totals = {
            "input_tokens": 0, "output_tokens": 0,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
            "cost_usd": 0.0,
        }

        def _add_usage(event):
            usage_totals["input_tokens"] += event.get("input_tokens", 0)
            usage_totals["output_tokens"] += event.get("output_tokens", 0)
            usage_totals["cache_read_input_tokens"] += event.get("cache_read_input_tokens", 0)
            usage_totals["cache_creation_input_tokens"] += event.get("cache_creation_input_tokens", 0)
            usage_totals["cost_usd"] += event.get("total_cost_usd", 0)

        try:
            claude_session = task.claude_session_id or chat.claude_session_id
            effective_model = normalize_model(task.model or user.model)
            gen = stream_claude(task.prompt, effective_model, claude_session, chat.workspace)
            try:
                async for event in gen:
                    if event["type"] in ("chunk", "thinking_chunk"):
                        state.active_sessions[session_key]["status"] = "streaming"

                    if event["type"] != "session_error":
                        await _broadcast(chat_id_str, event)

                    if event["type"] == "chunk":
                        full_response += event["content"]
                        state.active_sessions[session_key]["content_so_far"] = full_response
                    elif event["type"] == "thinking_chunk":
                        full_thinking += event["content"]
                        state.active_sessions[session_key]["thinking_so_far"] = full_thinking
                    elif event["type"] == "usage":
                        _add_usage(event)
                    elif event["type"] == "done":
                        if event.get("session_id"):
                            chat.claude_session_id = event["session_id"]
                    elif event["type"] == "session_error":
                        # Session expired — use last user message as fallback so Claude
                        # has actual context instead of a bare "Continue".
                        chat.claude_session_id = None
                        await db.commit()
                        last_user_result = await db.execute(
                            select(Message)
                            .where(Message.chat_id == chat.id, Message.role == "user")
                            .order_by(Message.created_at.desc())
                            .limit(1)
                        )
                        last_user_msg = last_user_result.scalar_one_or_none()
                        fallback_prompt = last_user_msg.content if last_user_msg else task.prompt
                        retry_gen = stream_claude(fallback_prompt, effective_model, None, chat.workspace)
                        try:
                            async for retry_event in retry_gen:
                                if retry_event["type"] in ("chunk", "thinking_chunk"):
                                    state.active_sessions[session_key]["status"] = "streaming"
                                await _broadcast(chat_id_str, retry_event)
                                if retry_event["type"] == "chunk":
                                    full_response += retry_event["content"]
                                    state.active_sessions[session_key]["content_so_far"] = full_response
                                elif retry_event["type"] == "thinking_chunk":
                                    full_thinking += retry_event["content"]
                                    state.active_sessions[session_key]["thinking_so_far"] = full_thinking
                                elif retry_event["type"] == "usage":
                                    _add_usage(retry_event)
                                elif retry_event["type"] == "done":
                                    if retry_event.get("session_id"):
                                        chat.claude_session_id = retry_event["session_id"]
                                elif retry_event["type"] == "error":
                                    if not full_response:
                                        full_response = retry_event["content"]
                        finally:
                            await retry_gen.aclose()
                    elif event["type"] == "error":
                        if not full_response:
                            full_response = event["content"]
                        task.status = "error"
                        task.error = event["content"]
            finally:
                await gen.aclose()

            # Post-process download markers before saving/broadcasting
            processed = process_download_markers(full_response)
            if processed != full_response:
                full_response = processed
                await _broadcast(chat_id_str, {"type": "replace", "content": full_response})

            # Check if a new limit was hit
            resume_at = parse_limit_reset(full_response)
            if resume_at and task.status == "running":
                next_task = QueueTask(
                    chat_id=task.chat_id,
                    user_id=task.user_id,
                    prompt="Continue",
                    claude_session_id=chat.claude_session_id,
                    resume_at=resume_at,
                )
                db.add(next_task)
                await db.commit()
                await db.refresh(next_task)
                await _broadcast(chat_id_str, {
                    "type": "limit_hit",
                    "resume_at": resume_at.isoformat(),
                    "task_id": str(next_task.id),
                })

            if task.status == "running":
                task.status = "done"

        except Exception as e:
            task.status = "error"
            task.error = str(e)
            await _broadcast(chat_id_str, {"type": "error", "content": str(e)})
        finally:
            state.active_sessions.pop(session_key, None)

        ai_msg = Message(
            chat_id=chat.id,
            role="assistant",
            content=full_response,
            thinking_content=full_thinking or None,
            input_tokens=usage_totals["input_tokens"] or None,
            output_tokens=usage_totals["output_tokens"] or None,
            cache_read_input_tokens=usage_totals["cache_read_input_tokens"] or None,
            cache_creation_input_tokens=usage_totals["cache_creation_input_tokens"] or None,
            cost_usd=usage_totals["cost_usd"] or None,
        )
        db.add(ai_msg)
        await db.commit()


async def _process_queue():
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        stmt = (
            select(QueueTask)
            .where(QueueTask.status == "pending")
            .where(or_(QueueTask.resume_at.is_(None), QueueTask.resume_at <= now))
            .order_by(QueueTask.created_at)
        )
        result = await db.execute(stmt)
        tasks = result.scalars().all()

        seen_chats: set[str] = set()
        for task in tasks:
            chat_id_str = str(task.chat_id)
            if chat_id_str in seen_chats:
                continue
            seen_chats.add(chat_id_str)

            # Skip if chat is already actively streaming via WS handler
            if any(s["chat_id"] == chat_id_str for s in state.active_sessions.values()):
                continue

            # Check schedule
            sched_result = await db.execute(
                select(QueueSchedule).where(QueueSchedule.chat_id == task.chat_id)
            )
            schedule = sched_result.scalar_one_or_none()

            if schedule:
                if schedule.mode == "manual":
                    continue
                if schedule.mode == "window" and not _in_window(schedule.window_from, schedule.window_to):
                    continue

            asyncio.create_task(run_task(task.id))


async def _runner_loop():
    while True:
        await asyncio.sleep(30)
        try:
            await _process_queue()
        except Exception as e:
            print(f"[queue_runner] error: {e}")


def start_runner():
    asyncio.create_task(_runner_loop())
