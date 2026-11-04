// ИИ агентов — YandexGPT через OpenAI-совместимый API Yandex AI Studio.
// Ключи только в переменных окружения: YC_API_KEY (API-ключ сервисного аккаунта с ролью ai.languageModels.user) и YC_FOLDER_ID.
// Нет ключа или ИИ не ответил — агенты продолжают работать на правилах (тексты по шаблонам), ничего не ломается.
const BASE = (process.env.YC_BASE || 'https://ai.api.cloud.yandex.net/v1').replace(/\/+$/, '');

function enabled() { return !!(process.env.YC_API_KEY && process.env.YC_FOLDER_ID); }

function modelUri(m) {
  const folder = process.env.YC_FOLDER_ID;
  const name = m || process.env.YC_MODEL || 'yandexgpt/latest';
  return name.startsWith('gpt://') ? name : `gpt://${folder}/${name}`;
}

async function chat(messages, opts = {}) {
  if (!enabled()) throw new Error('ИИ не подключён');
  const folder = process.env.YC_FOLDER_ID;
  let r;
  try {
    r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Api-Key ${process.env.YC_API_KEY}`, 'OpenAI-Project': folder, 'x-folder-id': folder },
      body: JSON.stringify({ model: modelUri(opts.model), messages, temperature: opts.temperature == null ? 0.3 : opts.temperature, max_tokens: opts.maxTokens || 1200 }),
      signal: AbortSignal.timeout(opts.timeout || 28000)
    });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? 'ИИ отвечает слишком долго' : 'Нет связи с ИИ');
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const m = j && (j.error && (j.error.message || j.error) || j.message);
    throw new Error(`ИИ ответил ${r.status}${m ? ': ' + String(m).slice(0, 160) : ''}`);
  }
  const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!t || !String(t).trim()) throw new Error('ИИ вернул пустой ответ');
  return String(t).trim();
}

// Текст по данным: system — роль агента, data — объект с цифрами. Возвращает null, если ИИ недоступен.
async function write(system, data, opts = {}) {
  if (!enabled()) return null;
  try {
    return clean(await chat([
      { role: 'system', content: system + '\n\nОпирайся только на цифры из данных, ничего не выдумывай. Если данных мало — так и скажи. Пиши по-русски, коротко, без канцелярита, без markdown-таблиц.' },
      { role: 'user', content: 'Данные (JSON):\n' + JSON.stringify(data).slice(0, opts.maxChars || 24000) + (opts.task ? '\n\nЗадача: ' + opts.task : '') }
    ], opts));
  } catch (e) {
    console.error('ai.write', e.message);
    return null;
  }
}

// убираем markdown-разметку, которую Telegram и кабинет показывают как есть
function clean(t) {
  return String(t || '').replace(/\r/g, '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/`/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { enabled, chat, write, clean };
