#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

CHAT_WWW="${CHAT_WWW:-}"

echo "==> Сборка фронтенда через Docker..."
docker build \
  --target builder \
  -t claude-web-chat-frontend:build \
  ./frontend

echo "==> Копирование dist из контейнера..."
container=$(docker create claude-web-chat-frontend:build)
rm -rf frontend/dist
docker cp "$container:/app/dist" frontend/dist
docker rm "$container"

if [ -n "$CHAT_WWW" ]; then
  echo "==> Деплой статики в $CHAT_WWW..."
  mkdir -p "$CHAT_WWW"
  rsync -a --delete frontend/dist/ "$CHAT_WWW/"
fi

echo "==> Готово: frontend/dist"
