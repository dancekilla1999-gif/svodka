// Конвейер агентов: данные дня из iiko (или демо) → отчёт → агенты → Telegram. Общий для крона, кабинета и демо.
const { rpc } = require('./sb');
const { open } = require('./box');
const { Iiko } = require('./iiko');
const { buildReport } = require('./report');
const { demoReport, demoPurchases } = require('./demo');
const { collectPurchases } = require('./purchases');
const { reportText, tgSend } = require('./text');
const A = require('./agents');

// доступ к базе от имени владельца: по токену (кабинет) или по секрету крона (сервер)
function dbFor(who) {
  return {
    op: (op, args) => who.token ? rpc('sv_agent', { p_token: who.token, p_op: op, p_args: args || {} })
      : rpc('sv_agent_sys', { p_secret: who.secret, p_owner: who.owner, p_op: op, p_args: args || {} }),
    saveReport: (day, data) => who.token ? rpc('sv_report_save', { p_token: who.token, p_day: day, p_dept: 'all', p_data: data })
      : rpc('sv_cron_save', { p_secret: who.secret, p_owner: who.owner, p_day: day, p_dept: 'all', p_data: data, p_error: '' }),
    chatAdd: (role, text, via) => who.token && role === 'user' ? rpc('sv_agent', { p_token: who.token, p_op: 'chat_add', p_args: { role, text, via } })
      : rpc('sv_agent_sys', { p_secret: who.secret || process.env.CRON_SECRET, p_owner: who.owner, p_op: 'chat_add', p_args: { role, text, via } })
  };
}
function save(db, res) { return res ? db.op('insight_save', { agent: res.agent, pkey: res.pkey, level: res.level, title: res.title, data: Object.assign({ items: res.items }, res.data), text: res.text }) : null; }

// День: conn = {mode, base_url, login, pass_enc, selected, departments, prefs}
async function runDay(db, conn, day, opts = {}) {
  const prefs = A.prefsOf(conn.prefs);
  let report, purch = null, purchErr = '';
  if (conn.mode === 'demo') {
    report = demoReport(day, { partial: opts.partial });
    if (prefs.purchases && !opts.partial) purch = demoPurchases(day);
  } else {
    const c = new Iiko(conn.base_url, conn.login, open(conn.pass_enc));
    const t0 = Date.now();
    await c.auth();
    console.log('iiko auth', Date.now() - t0, 'ms');
    try {
      report = await buildReport(c, day, conn.selected && conn.selected.length ? conn.selected : conn.departments, { partial: opts.partial });
      console.log('iiko report', Date.now() - t0, 'ms', report.errors ? 'errors: ' + report.errors.join(' | ') : '');
      // закупки — не дольше 20 с, чтобы отчёт успел уйти; не успели — цены подтянутся в следующий раз
      if (prefs.purchases && !opts.partial) {
        purch = await Promise.race([collectPurchases(c, day), new Promise((_, no) => setTimeout(() => no(new Error('iiko долго отдаёт накладные — закупки пропущены')), opts.purchBudget || 35000))])
          .catch((e) => { purchErr = e.message; return null; });
        console.log('iiko purchases', Date.now() - t0, 'ms', purchErr);
      }
    } finally { await c.logout(); }
  }
  // расходы владельца нужны уже для отчёта (прибыль смены)
  const ctx0 = await db.op('ctx', { days: 1 });
  const sh = A.shift(report, ctx0.expenses, prefs);
  report.profit = sh.data.metrics;
  if (purchErr) report.purchases_error = purchErr.slice(0, 200);
  const saved = await db.saveReport(day, report);
  await save(db, sh);
  let pr = null;
  if (purch && purch.rows.length) {
    const ing = await db.op('prices_ingest', { rows: purch.rows });
    pr = A.purchases(day, ing.changes, prefs, purch.sum);
    await save(db, pr);
  }
  let tip = null;
  if (prefs.daily_tips && !opts.noAi && !opts.partial) {
    tip = await A.dailyTip(sh, pr);
    if (tip) await db.op('insight_save', { agent: 'shift', pkey: day, level: sh.level, title: sh.title, data: Object.assign({ items: sh.items, tip }, sh.data), text: sh.text });
  }
  // по воскресеньям (или по запросу) — неделя целиком
  let week = null;
  if (opts.week === true || (opts.week !== false && A.dow(day) === 0 && !opts.partial)) week = await runWeek(db, day, { noAi: opts.noAi, prefs });
  let sent = false;
  if (opts.chatId && opts.send !== false) {
    const link = opts.base ? `${opts.base}/app/#/r/${saved.id}` : null;
    sent = await tgSend(opts.chatId, reportText(report, link) + '\n' + A.tgDailyExtra(sh, pr, tip)).catch(() => false);
    if (week && prefs.weekly_tg) await tgSend(opts.chatId, A.tgWeekly(week.director, week.finance, opts.base ? `${opts.base}/app/#/agents` : null)).catch(() => false);
  }
  return { id: saved.id, sent, week: !!week, shift: sh, purchases: pr, tip };
}

// Неделя, в которую входит day (пн–вс): финансы, персонал, меню и план управляющего — по сохранённым отчётам
async function runWeek(db, day, opts = {}) {
  const w = A.weekOf(day);
  const ctx = await db.op('ctx', { days: 21 });
  const prefs = opts.prefs || A.prefsOf(ctx.prefs);
  const fin = A.finance(w, ctx, prefs), st = A.staff(w, ctx), mn = A.menu(w, ctx);
  const pw = (ctx.prices || []).some((x) => x.day >= w.from && x.day <= w.to) ? A.purchasesWeek(w, ctx, prefs) : null;
  const label = `${A.dayRu(w.from)} – ${A.dayRu(w.to)}`;
  const dir = await A.director({ key: w.key, label, from: w.from, to: w.to }, [fin, st, mn, pw], { noAi: opts.noAi });
  await Promise.all([save(db, fin), save(db, st), save(db, mn), save(db, pw)]);
  await save(db, dir);
  return { finance: fin, staff: st, menu: mn, purchases: pw, director: dir };
}

module.exports = { dbFor, runDay, runWeek, save };
