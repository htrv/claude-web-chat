#!/usr/bin/env bash
set -e

BACKEND=${1:-http://localhost:4001}

read -p "Логин администратора: " username
read -sp "Пароль: " password
echo

curl -s -X POST "$BACKEND/api/auth/init-admin" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$username\", \"password\": \"$password\"}" | python3 -m json.tool
