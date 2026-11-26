# Сводка

Отчёт по смене из iiko в Telegram

Кабинет: https://svodka-egor12.vercel.app/app/


## Структура (снято с production Vercel 04.11.2026)

```
public/          — сайт: лендинг + кабинет app/ (байт-в-байт как на проде)
api/*.js         — функции Vercel (обёртки над srv/api)
srv/             — серверный код: агенты, Telegram-бот, cron, интеграции
vercel.json      — cron, заголовки, таймауты
build.sh         — сборка (из файлов репо, либо из релиза в Supabase по release.txt/srv.txt)
```

Деплой на Vercel идёт из монорепозитория **dancekilla1999-gif/trio** (папка с тем же именем).
Секреты — только в переменных окружения Vercel, см. README в trio.

## Telegram Mini App

Кабинет в Telegram: `https://<домен>/tg/`. Сайт, мини-приложение и API — один origin. Регистрация только по приглашению: без `?invite=` страница `#/register` вход не открывает.

Миграция `sql/20261126_tg_auth.sql` лежит в репозитории и **не применяется** этим кодом к боевой базе Supabase. Её запускает человек после проверки.

Тесты ходят в локальный Postgres 17, не в прод:

```bash
docker compose up -d
export DATABASE_URL=postgres://svodka:svodka@127.0.0.1:5432/svodka
export TG_SESSION_SECRET=длинный-секрет
export REFRESH_GRACE_KEY=64-hex-байта
export IP_SALT=соль
node scripts/db-bootstrap.js
npm test
```

`db-bootstrap.js` поднимает роли `anon`, `authenticated`, `service_role`, расширение `pgcrypto` в схеме `extensions`, текущую схему и миграцию. К хосту `*.supabase.co` скрипт не подключается. Когда появится отдельный тестовый проект Supabase, тот же `npm test` берёт `TEST_DATABASE_URL`.

Джоб `acceptance` в GitHub Actions требует секрет `TG_REAL_INITDATA` (реальный initData с полем `signature`) и `TG_TEST_BOT_TOKEN`. Без них джоб падает, а не пропускает тест. Локально без `REQUIRE_REAL_INITDATA=1` этот тест пропускается.

### Имена переменных

Их добавляет человек в Production env Vercel, не в Preview и не в репозиторий. Значения сюда не пишутся.

- `TG_BOT_TOKEN` — токен бота Сводки
- `TG_BOT_USERNAME` — имя бота без `@`, для ссылок `t.me/<bot>/app`
- `TELEGRAM_WEBHOOK_SECRET` — секрет заголовка вебхука; если пусто, как раньше считается из `CRON_SECRET`
- `TG_SESSION_SECRET` — отдельный секрет функций сессии, не `CRON_SECRET`
- `SB_SERVICE_KEY` — service role ключ Supabase, только Production
- `REFRESH_GRACE_KEY` — 32 байта hex, шифрование пары refresh на 60 секунд
- `IP_SALT` — соль HMAC для IP в журнале
- `PUBLIC_URL` — канонический адрес кабинета
- `TG_ALERT_CHAT_ID` — служебный чат счётчиков 401/429, без персональных данных
- `TG_SETUP` — по умолчанию не `1`: деплой и крон не вызывают `setWebhook` и кнопку меню

После того как `TG_SESSION_SECRET` записан в env, хеш кладётся в базу (только локальный `DATABASE_URL`, боевой хост скрипт отвергает):

```bash
TG_SESSION_SECRET=... DATABASE_URL=postgres://... node scripts/set-session-secret.js
```

### BotFather, один раз, вручную

1. Создать бота или взять существующего бота Сводки, если токен не общий с другими продуктами. Иначе новый `@trio_svodka_bot`.
2. В BotFather указать ссылку на политику: `https://<домен>/legal/privacy`.
3. Короткое имя мини-приложения: `app`. Адрес: `https://<домен>/tg/`.
4. Запустить настройку самому, не из деплоя: `TG_SETUP=1 TG_BOT_TOKEN=... PUBLIC_URL=https://<домен> node scripts/tg-setup.js`. Скрипт вызывает `setMyCommands`, `setChatMenuButton` и `setWebhook`. При любом другом значении `TG_SETUP` он ничего не отправляет.

`/start` с кодом из 18 hex по-прежнему привязывает чат утренних отчётов. Код привязки входа начинается с `l_` и в этот вебхук не подставляется.

Утренний отчёт, если задан `TG_BOT_USERNAME`, ссылается на `t.me/<bot>/app?startapp=r_<id>`. В тексте для Telegram имена сотрудников заменяются на «официант N».

Этап 2 (не позже 10.12.2026): тот же набор путей на nginx, черновик `deploy/nginx.conf`. До проверки региона функций в политике по-прежнему: Vercel — США, Supabase — Германия (Франкфурт). В `vercel.json` указан `regions: ["fra1"]`.
