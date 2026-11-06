import os
import re
import shutil
import time
import uuid

import state
from config import DOWNLOADS_DIR, DOWNLOAD_ALLOWED_PREFIXES

TOKEN_TTL = 86400  # 24h

DOWNLOAD_RE = re.compile(r'\[DOWNLOAD:([^\]|]+?)(?:\|([^\]]+?))?\]')


def register_file(path: str, display_name: str | None = None) -> str | None:
    """Validate path, copy to downloads dir, return token or None if not allowed."""
    real_path = os.path.realpath(path)
    if not any(real_path.startswith(p) for p in DOWNLOAD_ALLOWED_PREFIXES):
        return None
    if not os.path.isfile(real_path):
        return None

    filename = display_name or os.path.basename(real_path)
    token = uuid.uuid4().hex
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    dest = os.path.join(DOWNLOADS_DIR, token)
    shutil.copy2(real_path, dest)

    state.download_tokens[token] = (dest, filename, time.time() + TOKEN_TTL)
    return token


def process_download_markers(text: str) -> str:
    """Replace [DOWNLOAD:/path] or [DOWNLOAD:/path|name] with markdown download links."""
    def replace(m: re.Match) -> str:
        path = m.group(1).strip()
        name = (m.group(2) or os.path.basename(path)).strip()
        token = register_file(path, name)
        if token is None:
            return m.group(0)
        return f"[📥 {name}](/api/files/download/{token})"

    return DOWNLOAD_RE.sub(replace, text)
