// Клиент iikoServer (REST API /resto/api). Авторизация занимает слот лицензии — всегда выходим в finally.
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

function normalizeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new Error('Укажите адрес сервера iiko');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('Адрес сервера iiko указан неверно'); }
  if (u.protocol !== 'https:') throw new Error('Нужен защищённый адрес (https)');
  if (u.username || u.password) throw new Error('Логин и пароль вводятся в отдельных полях');
  const path = u.pathname.replace(/\/+$/, '').replace(/\/resto(\/.*)?$/i, '');
  return `${u.protocol}//${u.host}${path}`;
}
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
}
async function guardHost(base) {
  if (process.env.IIKO_ALLOW_PRIVATE === '1') return;
  const host = new URL(base).hostname;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Нужен внешний адрес сервера iiko');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error('Сервер iiko не найден — проверьте адрес'); });
  if (addrs.some((a) => privateIp(a.address))) throw new Error('Нужен внешний адрес сервера iiko (локальные адреса недоступны из облака)');
}

class Iiko {
  constructor(baseUrl, login, password) {
    this.base = normalizeUrl(baseUrl);
    this.login = String(login || '').trim();
    this.password = String(password || '');
    this.key = null;
  }
  async req(path, opts = {}) {
    const url = this.base + path;
    let r;
    try {
      r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers, body: opts.body, redirect: 'error', signal: AbortSignal.timeout(opts.timeout || 25000) });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'Сервер iiko не ответил вовремя' : 'Не удалось связаться с сервером iiko — проверьте адрес');
    }
    const txt = await r.text();
    if (!r.ok) {
      const short = txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      const e = new Error(`iiko ответил ${r.status}${short ? ': ' + short : ''}`); e.status = r.status; e.body = txt; throw e;
    }
    return txt;
  }
  async auth() {
    if (!this.login || !this.password) throw new Error('Укажите логин и пароль пользователя iiko');
    await guardHost(this.base);
    const sha = crypto.createHash('sha1').update(this.password, 'utf8').digest('hex');
    let t;
    try {
      t = await this.req(`/resto/api/auth?login=${encodeURIComponent(this.login)}&pass=${sha}`);
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('iiko не принял логин или пароль');
      if (e.status === 404) throw new Error('По этому адресу не отвечает сервер iiko — проверьте адрес (обычно вида имя-co.iiko.it)');
      if (e.status && /licen|лиценз/i.test(e.body || '')) throw new Error('В iiko заняты все слоты лицензии API — попробуйте позже');
      throw e;
    }
    t = String(t).trim().replace(/^"|"$/g, '');
    if (!/^[\w-]{8,}$/.test(t)) throw new Error('Сервер ответил, но это не похоже на iiko — проверьте адрес');
    this.key = t;
    return t;
  }
  async logout() {
    if (!this.key) return;
    const k = this.key; this.key = null;
    try { await this.req(`/resto/api/logout?key=${encodeURIComponent(k)}`, { timeout: 8000 }); } catch (e) { /* слот освободится по таймауту */ }
  }
  async departments() {
    const xml = await this.req(`/resto/api/corporation/departments?key=${encodeURIComponent(this.key)}`);
    const out = [];
    const re = /<corporateItemDto>([\s\S]*?)<\/corporateItemDto>/g;
    let m;
    const tag = (s, t) => { const x = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return x ? x[1].trim() : ''; };
    while ((m = re.exec(xml))) {
      const b = m[1];
      if (tag(b, 'type') === 'DEPARTMENT') out.push({ id: tag(b, 'id'), name: decodeXml(tag(b, 'name')) });
    }
    if (!out.length && xml.trim().startsWith('[')) {
      try { JSON.parse(xml).forEach((d) => { if (!d.type || d.type === 'DEPARTMENT') out.push({ id: d.id, name: d.name }); }); } catch (e) { /* формат не распознан */ }
    }
    return out;
  }
  async columns() {
    const txt = await this.req(`/resto/api/v2/reports/olap/columns?key=${encodeURIComponent(this.key)}&reportType=SALES`);
    try { return JSON.parse(txt); } catch (e) { throw new Error('iiko вернул непонятный список полей отчёта'); }
  }
  // Приходные накладные за период (даты включительно). Возвращает [{supplier, date, number, items:[{product, amount, sum}]}]
  async invoices(from, to) {
    const xml = await this.req(`/resto/api/documents/export/incomingInvoice?key=${encodeURIComponent(this.key)}&from=${from}&to=${to}`, { timeout: 40000 });
    const docs = [];
    const re = /<document>([\s\S]*?)<\/document>/g;
    let m;
    while ((m = re.exec(xml))) {
      const body = m[1];
      const head = body.replace(/<items>[\s\S]*?<\/items>/, '');
      const status = tag(head, 'status');
      if (/DELETED/i.test(status)) continue;
      const items = [];
      const ri = /<item>([\s\S]*?)<\/item>/g;
      let it;
      while ((it = ri.exec(body))) {
        const b = it[1];
        if (/^true$/i.test(tag(b, 'isAdditionalExpense'))) continue;
        const product = tag(b, 'product');
        const amount = num(tag(b, 'amount') || tag(b, 'actualAmount'));
        let sum = num(tag(b, 'sum'));
        if (!sum) sum = num(tag(b, 'price')) * amount;
        if (product && amount > 0) items.push({ product, amount, sum, article: tag(b, 'productArticle') });
      }
      docs.push({ supplier: tag(head, 'supplier'), date: (tag(head, 'incomingDate') || tag(head, 'dateIncoming')).slice(0, 10), number: decodeXml(tag(head, 'documentNumber')), status, items });
    }
    return docs;
  }
  // Справочник товаров: id → {name, unit}. Сначала новый JSON-метод, если его нет — старый XML.
  async products() {
    const map = {};
    try {
      const txt = await this.req(`/resto/api/v2/entities/products/list?key=${encodeURIComponent(this.key)}&includeDeleted=false`, { timeout: 40000 });
      const list = JSON.parse(txt);
      let units = {};
      try {
        const u = JSON.parse(await this.req(`/resto/api/v2/entities/list?key=${encodeURIComponent(this.key)}&rootType=MeasureUnit`, { timeout: 15000 }));
        (u || []).forEach((x) => { units[x.id] = x.name; });
      } catch (e) { units = {}; }
      (list || []).forEach((p) => { map[p.id] = { name: p.name || '', unit: units[p.mainUnit] || '' }; });
      if (Object.keys(map).length) return map;
    } catch (e) { /* старый сервер */ }
    const xml = await this.req(`/resto/api/products?key=${encodeURIComponent(this.key)}`, { timeout: 40000 });
    const re = /<productDto>([\s\S]*?)<\/productDto>/g;
    let m;
    while ((m = re.exec(xml))) {
      const unit = decodeXml(tag(m[1], 'mainUnit'));
      map[tag(m[1], 'id')] = { name: decodeXml(tag(m[1], 'name')), unit: /^[0-9a-f-]{30,}$/i.test(unit) ? '' : unit };
    }
    return map;
  }
  async suppliers() {
    const map = {};
    try {
      const xml = await this.req(`/resto/api/suppliers?key=${encodeURIComponent(this.key)}`, { timeout: 20000 });
      const re = /<employee>([\s\S]*?)<\/employee>/g;
      let m;
      while ((m = re.exec(xml))) map[tag(m[1], 'id')] = decodeXml(tag(m[1], 'name'));
    } catch (e) { /* без имён поставщиков */ }
    return map;
  }
  async olap(body) {
    const txt = await this.req(`/resto/api/v2/reports/olap?key=${encodeURIComponent(this.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeout: 45000
    });
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('iiko вернул непонятный ответ на отчёт'); }
    return Array.isArray(j.data) ? j.data : [];
  }
}
function tag(s, t) { const x = s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return x ? x[1].trim() : ''; }
function num(v) { const n = Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
function decodeXml(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }

module.exports = { Iiko, normalizeUrl };
