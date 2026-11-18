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
