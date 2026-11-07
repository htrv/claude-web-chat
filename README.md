# Claude Web Chat

Веб-чат для Claude Code. Один установленный на сервере Claude CLI доступен нескольким людям в браузере: у каждого свой логин, свои диалоги и общая очередь фоновых задач.

Нужен, когда Claude должен работать на своей машине (подписка или свой прокси), а открывать его надо с телефона или чужого компьютера, без раздачи SSH и без ключей в браузере.

Как устроено: страница на React ходит в FastAPI. Сообщение запускает на сервере `claude --print` и стримит ответ в браузер по WebSocket. История лежит в PostgreSQL. В админке выбирается режим: подписка Claude на этой машине или один из прокси из `CLAUDE_PROXIES`. Ключи остаются только в `.env`.

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

## Лицензия

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) — см. `LICENSE`.

- **Бесплатно**: личное использование, учёба, исследования, некоммерческие организации, образование, госорганы.
- **Коммерческое использование** (в компании, в составе продукта, перепродажа, переработка на продажу) требует отдельной коммерческой лицензии. Для её получения откройте [issue](https://github.com/htrv/claude-web-chat/issues) с меткой `commercial`.

Отправляя pull request, вы соглашаетесь, что автор проекта вправе распространять ваш вклад на условиях этой и коммерческой лицензии.

## Благодарность

Если проект пригодился, можно отправить биткоин сюда:

`bc1q8dtk9sar0862ckav0hacmvllwkhy00rvzn6puv`
