import asyncio
import json
import os

import state
from config import CLAUDE_BIN, CLAUDE_PROXIES_BY_NAME

SESSION_ERROR_MARKERS = ("session", "not found", "no such file", "cannot resume", "invalid session")

FILE_DOWNLOAD_SYSTEM = (
    "When the user asks for a file to download (certificate, config, key, etc.), "
    "embed a download marker in your response using this exact format: "
    "[DOWNLOAD:/absolute/path/to/file] or with a custom display name: "
    "[DOWNLOAD:/absolute/path/to/file|display_name.ext]. "
    "Example: [DOWNLOAD:/etc/caddy/mkcert-root/rootCA.pem|rootCA.pem]. "
    "The system converts this marker into a real download button. "
    "Only reference files that actually exist on the server. "
    "Never use this format unless the user explicitly wants to download a file."
)


def _is_session_error(text: str) -> bool:
    low = text.lower()
    return any(m in low for m in SESSION_ERROR_MARKERS)


def _build_env() -> dict:
    # Base env always strips API key auth so a plain subscription run doesn't
    # accidentally bill against a (possibly empty) Console API credit balance.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL")}
    if state.claude_auth_mode == "proxy" and state.claude_active_proxy:
        proxy = CLAUDE_PROXIES_BY_NAME.get(state.claude_active_proxy)
        if proxy:
            env["ANTHROPIC_BASE_URL"] = proxy["base_url"]
            env["ANTHROPIC_API_KEY"] = proxy["api_key"]
    return env


async def _iter_stdout_lines(stream):
    """Read lines from an asyncio StreamReader using read() to avoid LimitOverrunError."""
    buf = b""
    while True:
        chunk = await stream.read(65536)
        if not chunk:
            if buf:
                yield buf.decode(errors="replace").strip()
            return
        buf += chunk
        while b"\n" in buf:
            idx = buf.index(b"\n")
            line = buf[:idx].decode(errors="replace").strip()
            buf = buf[idx + 1:]
            if line:
                yield line


async def stream_claude(
    prompt: str,
    user_model: str,
    session_id: str | None = None,
    workspace: str | None = None,
    _depth: int = 0,
):
    cmd = [
        CLAUDE_BIN, "--print",
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--model", user_model,
        "--append-system-prompt", FILE_DOWNLOAD_SYSTEM,
    ]
    if session_id:
        cmd += ["--resume", session_id]
    # "--" гарантирует, что prompt не будет распарсен как опция CLI,
    # если начинается с "-" (например, "-m venv ...")
    cmd += ["--", prompt]

    cwd = workspace if (workspace and os.path.isdir(workspace)) else None
    env = _build_env()

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
        env=env,
    )

    new_session_id = None
    stop_reason = None
    result_is_error = False
    result_error_text = ""
    chunks_emitted = False
    usage_event = None
    try:
        async for line in _iter_stdout_lines(proc.stdout):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            t = obj.get("type", "")

            if t == "assistant":
                msg = obj.get("message", {})
                for block in msg.get("content", []):
                    if block.get("type") == "text":
                        chunks_emitted = True
                        yield {"type": "chunk", "content": block["text"]}
                    elif block.get("type") == "thinking":
                        yield {"type": "thinking_chunk", "content": block.get("thinking", "")}

            elif t == "result":
                result_is_error = obj.get("is_error", False)
                if result_is_error:
                    # Don't set new_session_id from an error result — it's a bogus new session
                    result_error_text = "; ".join(obj.get("errors", []))
                else:
                    new_session_id = obj.get("session_id")
                    stop_reason = obj.get("stop_reason", "end_turn")
                    usage = obj.get("usage") or {}
                    usage_event = {
                        "type": "usage",
                        "input_tokens": usage.get("input_tokens", 0),
                        "output_tokens": usage.get("output_tokens", 0),
                        "cache_read_input_tokens": usage.get("cache_read_input_tokens", 0),
                        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens", 0),
                        "total_cost_usd": obj.get("total_cost_usd", 0),
                        "duration_ms": obj.get("duration_ms", 0),
                    }

            elif t == "text":
                yield {"type": "chunk", "content": obj.get("text", "")}

        await proc.wait()
    finally:
        # Kill subprocess if still running (generator closed early or timed out)
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            await proc.wait()

    if (proc.returncode != 0 and not new_session_id) or result_is_error:
        stderr = (await proc.stderr.read()).decode().strip()
        error_msg = stderr or result_error_text or "Claude CLI error"
        # Content was already streamed but process exited non-zero with no explicit error details
        # (e.g. rate-limit message delivered in full, then CLI exits with non-zero code)
        if chunks_emitted and not stderr and not result_error_text:
            yield {"type": "done", "session_id": None}
            return
        if session_id and _is_session_error(error_msg):
            yield {"type": "session_error", "content": error_msg}
        else:
            yield {"type": "error", "content": error_msg}
        return

    if usage_event:
        yield usage_event

    if stop_reason == "max_tokens" and new_session_id and _depth < 10:
        yield {"type": "chunk", "content": ""}
        async for event in stream_claude("Continue", user_model, new_session_id, workspace, _depth + 1):
            yield event
    else:
        yield {"type": "done", "session_id": new_session_id}
