#!/usr/bin/env bash
# Деплой: git pull + пересборка фронтенда. Каталог — CLAUDE_WEB_CHAT_DIR или корень репозитория.
set -euo pipefail

SERVICES_DIR="${CLAUDE_WEB_CHAT_DIR:-$(cd "$(dirname "$0")" && pwd)}"

echo "==> git pull..."
git -C "$SERVICES_DIR" pull

echo "==> Пересборка фронтенда..."
bash "$SERVICES_DIR/build-frontend.sh"

echo "==> Готово"
