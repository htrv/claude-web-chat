# Claude Web Chat

Браузерный чат поверх Claude Code CLI: стриминг, очередь задач и переключение между подпиской Claude и прокси.

## Стек

- Frontend: React, TypeScript, Vite, Mantine
- Backend: FastAPI, WebSocket
- База: PostgreSQL
- Раздача статики: Nginx

## Возможности

- Стриминг ответа и блок thinking
- Markdown, подсветка кода, диаграммы Mermaid
- Загрузка файлов
- Очередь задач
- В админке: режим подписки или один из прокси из `CLAUDE_PROXIES`
- Светлая и тёмная тема

## Запуск

```bash
cp .env.example .env
```

В `.env` задайте свои значения. Пустые поля в `.env.example` нужно заполнить локально. Файл `.env` в git не входит.

Обязательно: `DATABASE_URL`, `SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`.

Режим Claude:

- `CLAUDE_AUTH_MODE_DEFAULT=subscription` — подписка через локальный вход `claude`
- `CLAUDE_PROXIES` — JSON-массив `{"name","base_url","api_key"}`. Ключ остаётся только в `.env`

```bash
docker compose up -d
bash create-admin.sh
```

Интерфейс: `http://localhost:4000`.

Фронтенд отдельно:

```bash
cd frontend && npm install && npm run build
```

`CHAT_WWW` задавайте, только если собранную статику нужно скопировать в каталог веб-сервера.

## Структура

```
claude-web-chat/
├── backend/           # FastAPI
│   └── routers/       # auth, chats, queue, admin, files, deploy, vpn
├── frontend/
├── e2e/
├── docker-compose.yml
├── nginx/
└── .env.example
```

Шаблоны systemd (`claude-web-chat-*.service`) используют пути `/opt/claude-web-chat`. Подставьте свои.
