import mimetypes
import os
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import state
from config import DOWNLOADS_DIR, UPLOADS_DIR

router = APIRouter()


@router.get("/api/files/download/{token}")
async def download_file(token: str):
    entry = state.download_tokens.get(token)
    if not entry:
        raise HTTPException(status_code=404, detail="Файл не найден или ссылка устарела")

    dest, filename, expires_at = entry
    if time.time() > expires_at:
        state.download_tokens.pop(token, None)
        try:
            os.unlink(dest)
        except OSError:
            pass
        raise HTTPException(status_code=410, detail="Ссылка на скачивание истекла")

    if not os.path.isfile(dest):
        raise HTTPException(status_code=404, detail="Файл не найден")

    media_type, _ = mimetypes.guess_type(filename)
    return FileResponse(
        path=dest,
        filename=filename,
        media_type=media_type or "application/octet-stream",
    )


@router.get("/api/uploads/{filename}")
async def serve_upload(filename: str):
    """Serve uploaded files (images etc.) by their UUID-prefixed filename.
    No auth required — UUID prefix makes filenames unguessable."""
    safe = os.path.basename(filename)  # prevent path traversal
    path = os.path.join(UPLOADS_DIR, safe)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл не найден")
    media_type, _ = mimetypes.guess_type(safe)
    return FileResponse(path, media_type=media_type or "application/octet-stream")
