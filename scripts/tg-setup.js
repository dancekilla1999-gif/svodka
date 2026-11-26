#!/usr/bin/env node
// Разовая настройка бота: команды, кнопка меню Mini App и вебхук.
// По умолчанию ничего не отправляет. Человек запускает сам: TG_SETUP=1 node scripts/tg-setup.js
// Токен берётся из окружения и в вывод не печатается.
const { hookSecret, publicUrl } = require('../srv/lib/common');

const COMMANDS = [
  { command: 'app', description: 'Открыть кабинет' },
  { command: 'today', description: 'Отчёт за последнюю смену' },
  { command: 'week', description: 'План на неделю' },
  { command: 'money', description: 'Финансы' },
  { command: 'buy', description: 'Закупки' },
  { command: 'team', description: 'Персонал' },
  { command: 'menu', description: 'Меню' },
  { command: 'help', description: 'Что умеет бот' }
];

async function api(token, method, body) {
  const r = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    const err = new Error(method + ' не выполнился');
    err.description = data.description || r.status;
    throw err;
  }
  return data.result;
}

async function main() {
  if (process.env.TG_SETUP !== '1') {
    console.log('TG_SETUP is not 1. BotFather and Telegram API were not called.');
    return;
  }
  const token = process.env.TG_BOT_TOKEN || '';
  if (!token) throw new Error('Нет TG_BOT_TOKEN');
  const base = publicUrl({ headers: {} });
  const app = base + '/tg/';
  await api(token, 'setMyCommands', { commands: COMMANDS });
  await api(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: app } }
  });
  await api(token, 'setWebhook', {
    url: base + '/api/tg',
    secret_token: hookSecret(),
    allowed_updates: ['message']
  });
  const info = await api(token, 'getWebhookInfo', {});
  console.log('ok webhook ' + (info.url ? 'set' : 'empty') + ' miniapp ' + app);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
