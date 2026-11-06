"""Catalog of models exposed in UI (synced with blogmin /v1/models)."""

MODEL_CATALOG: list[dict[str, str]] = [
    {
        "id": "claude-opus-4-8",
        "label": "Opus 4.8 · максимум",
        "description": "Самая мощная модель. Сложные задачи, большой контекст (1M), глубокие рассуждения.",
        "tier": "opus",
    },
    {
        "id": "claude-opus-4-7",
        "label": "Opus 4.7 · мощная",
        "description": "Сложные задачи: архитектура, многошаговые рассуждения, большой контекст.",
        "tier": "opus",
    },
    {
        "id": "claude-sonnet-5",
        "label": "Sonnet 5 · новая",
        "description": "Новое поколение Sonnet. Баланс скорости и качества, контекст 1M.",
        "tier": "sonnet",
    },
    {
        "id": "claude-sonnet-4-6",
        "label": "Sonnet 4.6 · баланс",
        "description": "Оптимально для большинства задач: код, анализ, разговор.",
        "tier": "sonnet",
    },
    {
        "id": "claude-haiku-4-5",
        "label": "Haiku 4.5 · лёгкая",
        "description": "Быстрые короткие ответы, простые вопросы. Меньше всего тратит токены.",
        "tier": "haiku",
    },
]

# Модели, доступные логину CLI, но ещё не добавленные в основной каталог выше.
# Проверено вручную запуском `claude --print --model <id>` (2026-07-14).
EXTRA_AVAILABLE_MODELS: list[dict[str, str]] = [
    {
        "id": "claude-fable-5",
        "label": "Fable 5 · творческая",
        "description": "Модель поколения Claude 5, ориентированная на creative writing.",
        "tier": "fable",
    },
]

MODEL_CATALOG_AVAILABLE: list[dict[str, str]] = MODEL_CATALOG + EXTRA_AVAILABLE_MODELS

AVAILABLE_MODELS: list[str] = [m["id"] for m in MODEL_CATALOG_AVAILABLE]
DEFAULT_MODEL = "claude-sonnet-4-6"

# Legacy ids kept in DB → map to current catalog on use
LEGACY_MODEL_ALIASES: dict[str, str] = {
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
}


def normalize_model(model: str | None) -> str:
    if not model:
        return DEFAULT_MODEL
    if model in AVAILABLE_MODELS:
        return model
    return LEGACY_MODEL_ALIASES.get(model, DEFAULT_MODEL)


def model_options() -> list[dict[str, str]]:
    return [
        {"value": m["id"], "label": m["label"], "description": m["description"]}
        for m in MODEL_CATALOG
    ]


def available_model_options() -> list[dict[str, str]]:
    return [
        {"value": m["id"], "label": m["label"], "description": m["description"]}
        for m in MODEL_CATALOG_AVAILABLE
    ]
