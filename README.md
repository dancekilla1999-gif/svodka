# Сводка

Отчёт по смене из iiko в Telegram

Кабинет: https://svodka-egor12.vercel.app/app/

Лендинг: https://svodka-egor12.vercel.app

Часть пакета **Трио** (https://trio-resto.vercel.app)

## Структура

```
index.html      — лендинг
app/            — кабинет (SPA)
  index.html
  core.js, app.js, team.js, guide.js, trio-bill.js
  app.css, trio-skin.css
fonts/
css/
media/
```

## Локальный запуск

```bash
npx serve .
# кабинет: http://localhost:3000/app/
```

Backend: Supabase (`qozyihhlocvgpkchyqsp.supabase.co`).

## Статус (04.11.2026)

Весь статический код (HTML, CSS, JS, шрифты, медиа) скопирован с production: https://svodka-egor12.vercel.app — файлы идентичны тому, что сейчас отдаёт сайт.

**Чего нет в репозитории:** серверных функций Vercel (api/agents, api/iiko). Их исходники не отдаются публично; их можно забрать только из деплоя через Vercel (Deployment → Source) и положить в `api/`.
