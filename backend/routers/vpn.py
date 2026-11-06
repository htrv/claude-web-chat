import asyncio
import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth import require_admin
from models import User

router = APIRouter(prefix="/api/vpn", tags=["vpn"])

VPN_MANAGER = os.environ.get("VPN_MANAGER", "")
VPN_CONNECT = os.environ.get("VPN_CONNECT", "")
VPN_DISCONNECT = os.environ.get("VPN_DISCONNECT", "")


async def _run(cmd: list[str], timeout: int = 60) -> dict:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return {"returncode": -1, "stdout": "", "stderr": "Timeout"}
    return {
        "returncode": proc.returncode,
        "stdout": stdout.decode(errors="replace").strip(),
        "stderr": stderr.decode(errors="replace").strip(),
    }


class ConnectBody(BaseModel):
    suffix: str = ""


@router.get("/status")
async def vpn_status(_: User = Depends(require_admin)):
    if not VPN_MANAGER:
        return {"returncode": 1, "stdout": "", "stderr": "VPN_MANAGER is not set"}
    return await _run(["python3", VPN_MANAGER, "status"])


@router.post("/disconnect")
async def vpn_disconnect(_: User = Depends(require_admin)):
    if not VPN_DISCONNECT:
        return {"returncode": 1, "stdout": "", "stderr": "VPN_DISCONNECT is not set"}
    return await _run([VPN_DISCONNECT])


@router.post("/connect")
async def vpn_connect(body: ConnectBody, _: User = Depends(require_admin)):
    if not VPN_CONNECT:
        return {"returncode": 1, "stdout": "", "stderr": "VPN_CONNECT is not set"}
    cmd = [VPN_CONNECT, body.suffix] if body.suffix else [VPN_CONNECT]
    return await _run(cmd, timeout=60)
