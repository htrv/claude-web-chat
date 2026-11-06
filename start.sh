#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==> Запуск PostgreSQL в Docker..."
docker compose up -d postgres

echo "==> Ожидание готовности PostgreSQL..."
until docker compose exec postgres pg_isready -U claudechat -q 2>/dev/null; do
  sleep 1
done
echo "    PostgreSQL готов."

echo "==> Запуск бэкенда..."
cd backend
bash start.sh
