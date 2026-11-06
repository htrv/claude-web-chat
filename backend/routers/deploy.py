import asyncio
import hashlib
import hmac
import json as _json
import logging
import os
import signal
import subprocess
import threading
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

import state

router = APIRouter()

DEPLOY_SECRET = os.getenv("DEPLOY_WEBHOOK_SECRET", "")
SERVICES_DIR = os.getenv("CLAUDE_WEB_CHAT_DIR", "")
logger = logging.getLogger(__name__)


async def _broadcast_all(event: dict):
    for ws_set in list(state.chat_ws_map.values()):
        for ws in list(ws_set):
            try:
                await ws.send_json(event)
            except Exception:
                pass


def _send_telegram(message: str):
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "")
    if not token or not chat_id:
        return
    try:
        data = _json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=8)
    except Exception as e:
        logger.warning("Telegram notification failed: %s", e)


@router.post("/api/webhook/deploy")
async def deploy_webhook(request: Request):
    body = await request.body()

    if not DEPLOY_SECRET:
        raise HTTPException(status_code=503, detail="Deploy webhook disabled: DEPLOY_WEBHOOK_SECRET not set")

    raw_sig = (
        request.headers.get("X-Gitea-Signature")
        or request.headers.get("X-Hub-Signature-256", "")
    )
    sig = raw_sig.removeprefix("sha256=")
    expected = hmac.new(DEPLOY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = __import__("json").loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    ref = payload.get("ref", "")
    if ref != "refs/heads/main":
        return {"status": "skipped", "ref": ref}

    commits = payload.get("commits", [])
    backend_changed = any(
        any(
            f.startswith("backend/")
            for f in c.get("modified", []) + c.get("added", []) + c.get("removed", [])
        )
        for c in commits
    )

    threading.Thread(target=_run_deploy, args=(backend_changed,), daemon=True).start()
    return {"status": "deploying", "restart_backend": backend_changed}


def _run_deploy(restart_backend: bool):
    now_str = datetime.now(timezone.utc).strftime("%H:%M UTC")
    if not SERVICES_DIR:
        logger.error("Deploy skipped: CLAUDE_WEB_CHAT_DIR is not set")
        return
    try:
        subprocess.run(["git", "pull"], cwd=SERVICES_DIR, check=True, capture_output=True)
        subprocess.run(
            ["bash", "build-frontend.sh"], cwd=SERVICES_DIR, check=True, capture_output=True
        )
        logger.info("Deploy completed: frontend rebuilt")

        # Notify all open WebSocket connections before the possible restart
        loop = state.event_loop
        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(
                _broadcast_all({"type": "deploy_done", "restart": restart_backend}), loop
            )
            try:
                future.result(timeout=5)
            except Exception as e:
                logger.warning("WS deploy_done broadcast failed: %s", e)

        if restart_backend:
            _send_telegram(
                f"✅ <b>Деплой завершён</b>\n"
                f"Время: {now_str}\n"
                f"Перезапускаю бэкенд через 3 сек..."
            )
            logger.info("Backend changed — graceful restart in 3s")
            threading.Timer(3, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
        else:
            _send_telegram(
                f"✅ <b>Деплой завершён</b>\n"
                f"Время: {now_str}\n"
                f"Только фронтенд — бэкенд не перезапускался."
            )

    except subprocess.CalledProcessError as e:
        err = e.stderr.decode(errors="replace")[:400] if e.stderr else str(e)
        logger.error("Deploy failed: %s\n%s", e, err)
        _send_telegram(f"❌ <b>Деплой упал!</b>\n{now_str}\n<pre>{err}</pre>")
    except Exception as e:
        logger.error("Deploy error: %s", e)
        _send_telegram(f"❌ <b>Деплой упал!</b>\n{now_str}\n{e}")
