import json
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

DATABASE_URL = os.environ["DATABASE_URL"]
SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_ADMIN_CHAT_ID = int(os.environ["TELEGRAM_ADMIN_CHAT_ID"])
CLAUDE_BIN = os.environ.get("CLAUDE_BIN", "claude")
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/tmp/claude-web-uploads")
DOWNLOADS_DIR = os.environ.get("DOWNLOADS_DIR", "/tmp/claude-web-downloads")

def _csv_paths(name: str, default: str = "") -> list[str]:
    raw = os.environ.get(name, default)
    return [p.strip() for p in raw.split(",") if p.strip()]

DOWNLOAD_ALLOWED_PREFIXES: list[str] = _csv_paths(
    "DOWNLOAD_ALLOWED_PREFIXES",
    "/tmp/claude-web-uploads/",
)
BACKEND_PORT = int(os.environ.get("BACKEND_PORT", "4001"))

from models_catalog import AVAILABLE_MODELS, DEFAULT_MODEL, normalize_model, model_options

TWO_FA_EXPIRE_SECONDS = 300  # 5 minutes

DEFAULT_WORKSPACE = os.environ.get("DEFAULT_WORKSPACE", "")
WORKSPACE_ROOTS = _csv_paths("WORKSPACE_ROOTS")

# Прокси для Claude CLI — задаются только через .env, чтобы api_key не летал через
# админку/БД. Формат CLAUDE_PROXIES: JSON-массив
# [{"name": "proxy1", "base_url": "https://...", "api_key": "sk-..."}, ...].
# В админке можно только выбрать один из уже описанных здесь прокси или подписку.
def _load_claude_proxies() -> list[dict]:
    raw = os.environ.get("CLAUDE_PROXIES", "[]")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [
        p for p in data
        if isinstance(p, dict) and p.get("name") and p.get("base_url") and p.get("api_key")
    ]


CLAUDE_PROXIES: list[dict] = _load_claude_proxies()
CLAUDE_PROXIES_BY_NAME: dict[str, dict] = {p["name"]: p for p in CLAUDE_PROXIES}

# Дефолтный режим при первом запуске (пока нет строки в БД) — переключается в админке.
CLAUDE_AUTH_MODE_DEFAULT = os.environ.get("CLAUDE_AUTH_MODE_DEFAULT", "subscription")
