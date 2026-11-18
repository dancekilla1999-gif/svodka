// Смотритель сайтов и черновики продвижения. Цифры проверки — код.
// ИИ только переписывает уже известные факты. Сам ничего не публикует и файлы сайта не меняет.
const SITES = [
  { id: 'podacha', name: 'Подача', url: 'https://podacha-egor12.vercel.app/' },
  { id: 'zhurnalka', name: 'Журналка', url: 'https://zhurnalka.vercel.app/' },
  { id: 'svodka', name: 'Сводка', url: 'https://svodka-egor12.vercel.app/' },
  { id: 'trio', name: 'Трио', url: 'https://trio-resto-egor12.vercel.app/' }
];

const PRODUCTS = {
  podacha: {
    name: 'Подача',
    url: 'https://podacha-egor12.vercel.app/',
    price: '1 990 ₽/мес за заведение',
    facts: [
      'Пять минут тренировки перед сменой по меню заведения',
      'Состав, аллергены, тренажёр «Гость», трек новичка на 7 дней',
      'До 15 сотрудников, первые 7 дней бесплатно'
    ],
    fallback: '«Подача» — пять минут перед сменой, и официант отвечает по вашему меню: состав, аллергены, что предложить к блюду. Есть тренажёр «Гость» и трек новичка. 1 990 ₽ в месяц за заведение, первые 7 дней бесплатно, до 15 сотрудников. https://podacha-egor12.vercel.app/'
  },
  zhurnalka: {
    name: 'Журналка',
    url: 'https://zhurnalka.vercel.app/',
    price: 'от 1 990 ₽/мес',
    facts: [
      'Шесть санитарных журналов в телефоне: гигиена, холодильники, склады, фритюр, бракераж, уборки',
      'Печать и PDF по форме',
      'Тариф «Точка» 1 990 ₽/мес, «Кухня» 2 990 ₽/мес, первые 7 дней бесплатно'
    ],
    fallback: '«Журналка» ведёт санитарные журналы в телефоне: гигиена, температура холодильников, фритюр и бракераж. Сотрудник отмечает смену по QR, владелец печатает журнал, когда нужно. От 1 990 ₽ в месяц, первые 7 дней бесплатно. https://zhurnalka.vercel.app/'
  },
  svodka: {
    name: 'Сводка',
    url: 'https://svodka-egor12.vercel.app/',
    price: 'от 1 990 ₽/мес',
    facts: [
      'Утренний отчёт по смене из iiko в Telegram: выручка, чеки, скидки, удаления',
      'Тариф «Смена» 1 990 ₽/мес, «Контроль» 2 990 ₽/мес',
      'Первые 7 дней бесплатно'
    ],
    fallback: '«Сводка» каждое утро присылает в Telegram отчёт по смене из iiko: выручка, чеки, официанты, скидки и удаления — и отмечает, что выглядит необычно. От 1 990 ₽ в месяц, первые 7 дней бесплатно. https://svodka-egor12.vercel.app/'
  },
  trio: {
    name: 'Трио',
    url: 'https://trio-resto-egor12.vercel.app/trio',
    price: '5 990 ₽/мес вместо 7 970 ₽',
    facts: [
      'В пакете Подача, Журналка «Кухня» и Сводка «Контроль»',
      'Один счёт, первые 7 дней бесплатно',
      'Подача 1 990, Журналка «Кухня» 2 990, Сводка «Контроль» 2 990 — по отдельности 7 970'
    ],
    fallback: 'Пакет «Трио» собирает обучение зала, санитарные журналы и утренний отчёт из iiko в одну подписку: 5 990 ₽ в месяц вместо 7 970 ₽ по отдельности. Первые 7 дней бесплатно. https://trio-resto-egor12.vercel.app/trio'
  }
};

function dayKey() { return new Date().toISOString().slice(0, 10); }

function levelOf(items) {
  return items.some((i) => i.level === 'bad') ? 'bad' : items.some((i) => i.level === 'warn') ? 'warn' : 'ok';
}

async function probe(site) {
  const t0 = Date.now();
  try {
    const r = await fetch(site.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'TrioKeeper/1.0' }
    });
    const ms = Date.now() - t0;
    const level = !r.ok ? 'bad' : ms > 2500 ? 'warn' : 'ok';
    return { id: site.id, name: site.name, url: site.url, status: r.status, ms, level };
  } catch (e) {
    return { id: site.id, name: site.name, url: site.url, status: 0, ms: Date.now() - t0, level: 'bad', error: String(e.message || e).slice(0, 160) };
  }
}

async function watch() {
  const rows = await Promise.all(SITES.map(probe));
  const items = rows.map((r) => ({
    level: r.level,
    text: r.level === 'bad'
      ? `${r.name} не открывается${r.error ? ': ' + r.error : r.status ? ' (HTTP ' + r.status + ')' : ''}`
      : `${r.name}: HTTP ${r.status}, ${r.ms} мс${r.level === 'warn' ? ' — отвечает медленно' : ''}`
  }));
  const level = levelOf(items);
  const bad = items.filter((i) => i.level === 'bad').length;
  const title = bad
    ? `Смотритель: не открывается ${bad} из ${rows.length}`
    : level === 'warn'
      ? 'Смотритель: сайты живы, есть медленные ответы'
      : 'Смотритель: Подача, Журналка, Сводка и Трио отвечают';
  return {
    agent: 'keeper',
    pkey: dayKey(),
    level,
    title,
    data: { rows, checked_at: new Date().toISOString() },
    items,
    text: title + '. Проверка идёт каждый день. Если страница лежит, смотритель пишет в кабинет и в Telegram. Код сайта он не меняет.'
  };
}

async function promo(productId, ai) {
  const p = PRODUCTS[productId] || PRODUCTS.trio;
  const sys = 'Ты редактор сервиса «Трио» для ресторанов. Напиши один пост для владельца кафе: 450–700 знаков, на «вы», по-русски. Без крика, скидок из воздуха и чужих отзывов. Опирайся только на факты. В конце оставь адрес страницы.';
  let text = null;
  if (ai && typeof ai.write === 'function') {
    text = await ai.write(sys, { продукт: p.name, цена: p.price, факты: p.facts, страница: p.url }, { maxTokens: 500 });
  }
  if (!text) text = p.fallback;
  return {
    agent: 'promo',
    pkey: 'w' + dayKey(),
    level: 'ok',
    title: `Продвижение: черновик про «${p.name}»`,
    data: { url: p.url, channel: 'черновик владельцу' },
    items: [{ level: 'ok', text: 'Это черновик. Агент никуда его не публикует — размещает человек.' }],
    text
  };
}

async function promoPack(ai) {
  const out = [];
  for (const id of Object.keys(PRODUCTS)) out.push(await promo(id, ai));
  return out;
}

module.exports = { SITES, PRODUCTS, watch, promo, promoPack };
