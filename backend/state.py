# Shared in-process state (same event loop as FastAPI)
# Mutable dicts — importing modules share the same object reference

import asyncio

# session_id -> info dict (active Claude CLI processes)
active_sessions: dict[str, dict] = {}

# chat_id_str -> set of open WebSocket connections
chat_ws_map: dict[str, set] = {}

# session_id -> asyncio.Task (the running stream_task, for cancellation)
stream_tasks: dict[str, object] = {}

# token -> (dest_path, filename, expires_at_unix)
download_tokens: dict[str, tuple[str, str, float]] = {}

# asyncio event loop — set during lifespan startup, used for thread→loop communication
event_loop: asyncio.AbstractEventLoop | None = None

# Claude auth: "subscription" | "proxy" — глобальный переключатель для всех новых
# вызовов claude CLI. Загружается из app_settings при старте, меняется через админку.
claude_auth_mode: str = "subscription"
claude_active_proxy: str | None = None
