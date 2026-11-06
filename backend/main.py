import asyncio
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from contextvars import ContextVar
from datetime import datetime, timezone

import aiofiles
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── Logging ──────────────────────────────────────────────────────────────────
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


class _RidFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id.get("-")  # type: ignore[attr-defined]
        return True


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
for _h in logging.root.handlers:
    _h.addFilter(_RidFilter())

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sa_update

import state
from claude_client import stream_claude
from config import UPLOADS_DIR, BACKEND_PORT, WORKSPACE_ROOTS
from models_catalog import normalize_model
from database import get_db, init_db, SessionLocal
from models import User, Chat, Message, QueueTask, AppSetting
from auth import decode_token, get_current_user
from queue_runner import parse_limit_reset, start_runner
from routers.auth_router import router as auth_router
from routers.chats import router as chats_router
from routers.admin import router as admin_router
from routers.queue import router as queue_router
from routers.deploy import router as deploy_router
from routers.files import router as files_router
from routers.vpn import router as vpn_router
from file_downloads import process_download_markers


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.event_loop = asyncio.get_running_loop()
    await init_db()
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    # Reset tasks that got stuck in "running" state during a previous crash
    async with SessionLocal() as db:
        await db.execute(
            sa_update(QueueTask).where(QueueTask.status == "running").values(status="pending")
        )
        await db.commit()
    async with SessionLocal() as db:
        settings_row = await db.get(AppSetting, 1)
        if settings_row:
            state.claude_auth_mode = settings_row.claude_auth_mode
            state.claude_active_proxy = settings_row.claude_active_proxy
    start_runner()
    yield


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def _request_id_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:8]
    _request_id.set(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # Auth uses Authorization: Bearer headers, not cookies. Credentials must be
    # False here — "*" origins with credentials=True is rejected by browsers anyway.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(chats_router)
app.include_router(admin_router)
app.include_router(queue_router)
app.include_router(deploy_router)
app.include_router(files_router)
app.include_router(vpn_router)


@app.post("/api/chats/{chat_id}/upload")
async def upload_file(
    chat_id: uuid.UUID,
    file: UploadFile = File(...),
    message: str = Form(""),
    token: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    payload = decode_token(token)
    user_id = int(payload["sub"])
    result = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    # basename strips any path components in the client-supplied filename
    # (e.g. "../../etc/x") to keep the write inside UPLOADS_DIR.
    clean_name = os.path.basename(file.filename or "upload")
    safe_name = f"{uuid.uuid4()}_{clean_name}"
    file_path = os.path.join(UPLOADS_DIR, safe_name)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(await file.read())

    return {"file_path": file_path, "filename": file.filename}


async def _broadcast(chat_id_str: str, event: dict, dead_out: set | None = None):
    for ws in list(state.chat_ws_map.get(chat_id_str, set())):
        try:
            await ws.send_json(event)
        except Exception:
            state.chat_ws_map.get(chat_id_str, set()).discard(ws)
            if dead_out is not None:
                dead_out.add(ws)


@app.post("/api/chats/{chat_id}/test-limit")
async def test_limit_hit(chat_id: uuid.UUID, current_user: User = Depends(get_current_user)):
    """Dev helper: broadcast a fake limit_hit so the UI can be tested without hitting a real limit."""
    from datetime import timedelta
    chat_id_str = str(chat_id)
    resume_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    await _broadcast(chat_id_str, {
        "type": "limit_hit",
        "resume_at": resume_at,
        "claude_session_id": None,
    })
    return {"ok": True, "resume_at": resume_at}


@app.post("/api/chats/{chat_id}/stop")
async def stop_stream(chat_id: uuid.UUID, current_user: User = Depends(get_current_user)):
    chat_id_str = str(chat_id)
    session = next(
        (s for s in state.active_sessions.values() if s["chat_id"] == chat_id_str),
        None,
    )
    if session:
        session_key = session["session_id"]
        task = state.stream_tasks.pop(session_key, None)
        if task and not task.done():
            task.cancel()
    await _broadcast(chat_id_str, {"type": "stopped"})
    return {"ok": True}


@app.get("/api/usage")
async def get_usage(current_user: User = Depends(get_current_user)):
    import json
    import urllib.request
    from pathlib import Path

    creds_path = Path.home() / ".claude" / ".credentials.json"
    if not creds_path.exists():
        raise HTTPException(status_code=404, detail="Claude credentials not found")
    creds = json.loads(creds_path.read_text())
    token = creds.get("claudeAiOauth", {}).get("accessToken")
    plan = creds.get("claudeAiOauth", {}).get("subscriptionType", "unknown")
    if not token:
        raise HTTPException(status_code=500, detail="No OAuth access token in credentials")

    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage",
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-version": "2023-06-01",
            "anthropic-client-name": "claude-code",
            "anthropic-client-version": "2.1.152",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Anthropic usage API error: {e}")

    return {"plan": plan, **data}


@app.get("/api/workspaces")
async def list_workspaces(current_user: User = Depends(get_current_user)):
    workspaces = []
    for root in WORKSPACE_ROOTS:
        try:
            entries = os.scandir(root)
            for entry in entries:
                if entry.is_dir() and not entry.name.startswith("."):
                    workspaces.append({"path": entry.path, "name": entry.name, "root": root})
        except OSError:
            pass
    workspaces.sort(key=lambda w: (w["root"], w["name"]))
    return workspaces


@app.get("/api/active")
async def active_sessions_endpoint(current_user: User = Depends(get_current_user)):
    now = time.time()
    return [
        {**s, "elapsed_sec": round(now - s["started_at"])}
        for s in state.active_sessions.values()
    ]


@app.websocket("/ws/{chat_id}")
async def ws_chat(chat_id: uuid.UUID, websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    await websocket.accept()
    chat_id_str = str(chat_id)

    try:
        init_msg = await websocket.receive_json()
        token = init_msg.get("token", "")
        payload = decode_token(token)
        user_id = int(payload["sub"])

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            await websocket.send_json({"type": "error", "content": "Unauthorized"})
            return

        result2 = await db.execute(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
        chat = result2.scalar_one_or_none()
        if not chat:
            await websocket.send_json({"type": "error", "content": "Chat not found"})
            return

        # Snapshot active stream state and join broadcast list atomically (no awaits between).
        # This prevents delta chunks from arriving at the client before the catchup snapshot.
        active_for_chat = next(
            (s for s in state.active_sessions.values() if s["chat_id"] == chat_id_str), None
        )
        catchup_status = active_for_chat.get("status", "thinking") if active_for_chat else None
        catchup_thinking = active_for_chat.get("thinking_so_far", "") if active_for_chat else ""
        catchup_content = active_for_chat.get("content_so_far", "") if active_for_chat else ""
        state.chat_ws_map.setdefault(chat_id_str, set()).add(websocket)

        await websocket.send_json({"type": "ready"})

        if active_for_chat:
            if catchup_status == "thinking":
                await websocket.send_json({"type": "thinking"})
            else:
                if catchup_thinking:
                    await websocket.send_json({"type": "thinking_catchup", "content": catchup_thinking})
                await websocket.send_json({"type": "catchup", "content": catchup_content})

        while True:
            data = await websocket.receive_json()
            prompt = data.get("prompt", "").strip()
            file_paths: list[str] = data.get("file_paths") or []
            if not file_paths and data.get("file_path"):
                file_paths = [data["file_path"]]

            if not prompt and not file_paths:
                continue

            full_prompt = prompt
            if file_paths:
                files_str = ", ".join(file_paths)
                full_prompt = f"[Файлы загружены: {files_str}]\n{prompt}" if prompt else f"Файлы загружены: {files_str}"

            import json as _json
            stored_file_path = _json.dumps(file_paths) if len(file_paths) > 1 else (file_paths[0] if file_paths else None)
            user_msg = Message(chat_id=chat.id, role="user", content=prompt or "", file_path=stored_file_path)
            db.add(user_msg)
            chat.updated_at = datetime.now(timezone.utc)
            await db.commit()

            full_response = ""
            full_thinking = ""
            usage_totals = {
                "input_tokens": 0, "output_tokens": 0,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                "cost_usd": 0.0,
            }
            dead_ws: set = set()

            session_key = str(uuid.uuid4())
            state.active_sessions[session_key] = {
                "session_id": session_key,
                "chat_id": chat_id_str,
                "username": user.username,
                "model": user.model,
                "prompt_preview": (prompt or "")[:100],
                "status": "thinking",
                "content_so_far": "",
                "thinking_so_far": "",
                "started_at": time.time(),
            }

            await _broadcast(chat_id_str, {"type": "thinking"}, dead_ws)

            def _add_usage(event):
                usage_totals["input_tokens"] += event.get("input_tokens", 0)
                usage_totals["output_tokens"] += event.get("output_tokens", 0)
                usage_totals["cache_read_input_tokens"] += event.get("cache_read_input_tokens", 0)
                usage_totals["cache_creation_input_tokens"] += event.get("cache_creation_input_tokens", 0)
                usage_totals["cost_usd"] += event.get("total_cost_usd", 0)

            async def _process_stream(gen):
                nonlocal full_response, full_thinking
                async for event in gen:
                    if event["type"] in ("chunk", "thinking_chunk"):
                        state.active_sessions[session_key]["status"] = "streaming"

                    if event["type"] != "session_error":
                        await _broadcast(chat_id_str, event, dead_ws)

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
                        if not chat.claude_session_id or chat.title == "Новый чат":
                            words = (prompt or full_prompt)[:50].strip()
                            chat.title = words if words else "Чат"
                    elif event["type"] == "error":
                        full_response = event["content"]
                    elif event["type"] == "session_error":
                        chat.claude_session_id = None
                        await db.commit()
                        async for retry_event in stream_claude(full_prompt, normalize_model(user.model), None, chat.workspace):
                            if retry_event["type"] in ("chunk", "thinking_chunk"):
                                state.active_sessions[session_key]["status"] = "streaming"
                            await _broadcast(chat_id_str, retry_event, dead_ws)
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
                                if not chat.claude_session_id or chat.title == "Новый чат":
                                    words = (prompt or full_prompt)[:50].strip()
                                    chat.title = words if words else "Чат"
                            elif retry_event["type"] == "error":
                                full_response = retry_event["content"]

            await db.refresh(user)  # pick up model/settings changed mid-connection
            await db.refresh(chat)
            gen = stream_claude(full_prompt, normalize_model(user.model), chat.claude_session_id, chat.workspace)

            async def _keepalive():
                while True:
                    await asyncio.sleep(20)
                    await _broadcast(chat_id_str, {"type": "ping"}, dead_ws)

            stream_task = asyncio.ensure_future(_process_stream(gen))
            keepalive_task = asyncio.ensure_future(_keepalive())
            state.stream_tasks[session_key] = stream_task
            try:
                await asyncio.wait_for(asyncio.shield(stream_task), timeout=3600)
            except asyncio.TimeoutError:
                stream_task.cancel()
                if full_response:
                    full_response += "\n\n_(ответ прерван: превышено время ожидания)_"
                    await _broadcast(chat_id_str, {"type": "error", "content": "Время ожидания истекло — частичный ответ сохранён"}, dead_ws)
                else:
                    full_response = "Превышено время ожидания ответа"
                    await _broadcast(chat_id_str, {"type": "error", "content": full_response}, dead_ws)
            except asyncio.CancelledError:
                stopped_by_user = state.stream_tasks.get(session_key) is None
                if full_response or full_thinking:
                    try:
                        if full_response and stopped_by_user:
                            full_response += "\n\n_(остановлено пользователем)_"
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
                        chat.updated_at = datetime.now(timezone.utc)
                        await db.commit()
                    except Exception:
                        pass
                if not stopped_by_user:
                    raise
                continue  # skip the duplicate save below
            finally:
                keepalive_task.cancel()
                await gen.aclose()
                state.active_sessions.pop(session_key, None)
                state.stream_tasks.pop(session_key, None)

            # Post-process download markers before saving/broadcasting
            processed = process_download_markers(full_response)
            if processed != full_response:
                full_response = processed
                await _broadcast(chat_id_str, {"type": "replace", "content": full_response}, dead_ws)

            # Check for rate limit hit in completed response
            resume_at = parse_limit_reset(full_response)
            if resume_at:
                await _broadcast(chat_id_str, {
                    "type": "limit_hit",
                    "resume_at": resume_at.isoformat(),
                    "claude_session_id": chat.claude_session_id,
                }, dead_ws)

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
            chat.updated_at = datetime.now(timezone.utc)
            await db.commit()

            if websocket in dead_ws:
                return

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass
    finally:
        state.chat_ws_map.get(chat_id_str, set()).discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=BACKEND_PORT, reload=False)
