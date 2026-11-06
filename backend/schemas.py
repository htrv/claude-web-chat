import uuid
from datetime import datetime
from pydantic import BaseModel
from config import DEFAULT_WORKSPACE


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    model: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    requires_2fa: bool
    two_fa_token: str | None = None
    access_token: str | None = None
    token_type: str = "bearer"


class TwoFAStatusResponse(BaseModel):
    status: str  # pending | approved | denied | expired
    access_token: str | None = None


class TwoFAVerifyRequest(BaseModel):
    token: str
    action: str  # approve | deny


class ChatCreate(BaseModel):
    title: str = "Новый чат"
    workspace: str = DEFAULT_WORKSPACE


class ChatUpdate(BaseModel):
    title: str | None = None
    workspace: str | None = None


class ChatOut(BaseModel):
    id: uuid.UUID
    title: str
    workspace: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UpdateMeRequest(BaseModel):
    model: str


class MessageOut(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    role: str
    content: str
    thinking_content: str | None = None
    file_path: str | None
    created_at: datetime
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_input_tokens: int | None = None
    cache_creation_input_tokens: int | None = None
    cost_usd: float | None = None

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"
    model: str = "claude-sonnet-4-6"


class UserUpdate(BaseModel):
    role: str | None = None
    model: str | None = None
    is_active: bool | None = None
    password: str | None = None


class MessagesPage(BaseModel):
    items: list[MessageOut]
    has_more: bool


class QueueTaskOut(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: int
    prompt: str
    model: str | None = None
    status: str
    claude_session_id: str | None = None
    resume_at: datetime | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QueueTaskCreate(BaseModel):
    chat_id: uuid.UUID
    prompt: str = "Continue"
    model: str | None = None
    claude_session_id: str | None = None
    resume_at: datetime | None = None


class QueueScheduleOut(BaseModel):
    chat_id: uuid.UUID
    mode: str
    window_from: str | None = None
    window_to: str | None = None

    model_config = {"from_attributes": True}


class QueueScheduleUpdate(BaseModel):
    mode: str  # manual | auto | window
    window_from: str | None = None
    window_to: str | None = None
