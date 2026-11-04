/* «Сводка» — кабинет собственника: подключение iiko, отчёты по сменам, Telegram. */
(function () {
  "use strict";
  var SV = window.SV, h = SV.h;

  // ------------------------------------------------------------ сессия
  function me() { try { return JSON.parse(SV.store.get("sv_owner") || "null"); } catch (e) { return null; } }
  function setMe(o) { SV.store.set("sv_owner", o ? JSON.stringify(o) : null); }
  function tok() { var o = me(); return o && o.token; }
  function onAuth(e) { if (e.hint === "auth") { setMe(null); SV.toast(e.message, "bad"); SV.go("/login"); } throw e; }
  function call(fn, args) { return SV.api(fn, Object.assign({ p_token: tok() }, args || {})).catch(onAuth); }
  function server(action, args) { return SV.fn(action, Object.assign({ token: tok() }, args || {})).catch(onAuth); }
  function need() { if (!tok()) { SV.go("/login"); return false; } return true; }
  function fail(e) { SV.toast(e.message || "Ошибка", "bad"); }

  // ------------------------------------------------------------ форматы
  var TZ = "Europe/Moscow";
  function money(n) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0)) + " ₽"; }
  function int(n) { return new Intl.NumberFormat("ru-RU").format(Math.round(Number(n) || 0)); }
  function pct(x) { return Math.round((Number(x) || 0) * 100) + "%"; }
  function mskDay(off) { var d = new Date(Date.now() + 3 * 3600000); d.setUTCDate(d.getUTCDate() + (off || 0)); return d.toISOString().slice(0, 10); }
  function dayLong(iso) { var s = new Date(iso + "T12:00:00Z").toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function dayShort(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function delta(a, b) {
    if (!b) return null;
    var d = Math.round((a / b - 1) * 100);
    return h("span", { class: d >= 0 ? "up" : "down", text: (d >= 0 ? "▲ +" : "▼ ") + d + "%" });
  }
  var DEL_TYPES = { DELETED_WITH_WRITEOFF: "со списанием", DELETED_WITHOUT_WRITEOFF: "без списания", DELETED: "удалено" };

  // ------------------------------------------------------------ каркас
  function topbar() {
    var o = me() || {};
    return h("header", { class: "topbar no-print" }, h("div", { class: "wrap topbar-in" },
      h("a", { class: "brand", href: "#/home", text: "Сводка" }),
      h("nav", { class: "row topnav", "aria-label": "Разделы" },
        [["#/home", "Отчёты"], ["#/agents", "Агенты"], ["#/expenses", "Расходы"], ["#/settings", "Настройки"]].map(function (x) {
          var cur = ("#" + SV.path()).indexOf(x[0]) === 0 || (x[0] === "#/home" && /^#\/r\//.test("#" + SV.path()));
          return h("a", { class: "btn ghost small" + (cur ? " cur" : ""), href: x[0], "aria-current": cur ? "page" : null, text: x[1] });
        }))));
  }
  function page() { var m = h("main", { class: "wrap page" }); for (var i = 0; i < arguments.length; i++) SV.add(m, arguments[i]); return m; }

  SV.app = { me: me, tok: tok, call: call, server: server, need: need, fail: fail, onAuth: onAuth, topbar: topbar, page: page, money: money, int: int, pct: pct, dayShort: dayShort, dayLong: dayLong, mskDay: mskDay, table: function () { return table.apply(null, arguments); } };

  // ------------------------------------------------------------ вход
  SV.route("/", function () {
    if (tok()) { SV.go("/home"); return; }
    SV.mount(h("main", { class: "page narrow" },
      h("a", { class: "brand big", href: "#/", text: "Сводка" }),
      h("p", { class: "center muted", text: "Отчёт собственнику после каждой смены — из iiko в Telegram" }),
      h("div", { class: "card form" },
        h("a", { class: "btn primary wide", href: "#/register", text: "Попробовать бесплатно" }),
        h("a", { class: "btn wide", href: "#/login", text: "Войти" }))));
  });
  function authPage(mode) {
    var email = h("input", { type: "email", autocomplete: "email", required: true });
    var pass = h("input", { type: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true, minlength: 8 });
    var name = h("input", { autocomplete: "name", placeholder: "Как к вам обращаться" });
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "submit", text: mode === "login" ? "Войти" : "Создать аккаунт" });
    SV.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/", text: "Сводка" }),
      h("form", { class: "card form", onsubmit: function (ev) {
        ev.preventDefault(); err.textContent = ""; btn.disabled = true;
        (mode === "login" ? SV.api("sv_login", { p_email: email.value, p_password: pass.value }) : SV.api("sv_register", { p_email: email.value, p_password: pass.value, p_name: name.value }))
          .then(function (r) { if (r && r.error) throw new Error(r.error); setMe(r); SV.go("/home"); })
          .catch(function (e) { err.textContent = e.message; btn.disabled = false; });
      } },
        h("h1", { text: mode === "login" ? "Вход" : "Регистрация" }),
        mode === "register" ? h("label", null, "Имя", name) : null,
        h("label", null, "Почта", email),
        h("label", null, "Пароль" + (mode === "register" ? " (от 8 символов)" : ""), pass), err, btn,
        h("p", { class: "small center" }, mode === "login" ? h("a", { href: "#/register", text: "Нет аккаунта? Регистрация" }) : h("a", { href: "#/login", text: "Уже есть аккаунт? Войти" })))));
  }
  SV.route("/login", function () { authPage("login"); });
  SV.route("/register", function () { authPage("register"); });

  // ------------------------------------------------------------ главная
  SV.route("/home", function () {
    if (!need()) return;
    SV.mount([topbar(), SV.loading()]);
    call("sv_me").then(function (d) {
      var o = me(); o.email = d.email; setMe(o);
      var c = d.conn;
      if (!c || (c.mode === "demo" && !d.reports.length) || (c.mode === "iiko" && !c.has_password && !d.reports.length)) { SV.mount([topbar(), onboarding()]); return; }
      SV.mount([topbar(), home(d)]);
    }, function (e) { SV.mount([topbar(), page(h("p", { text: e.message }))]); });
  });

  function onboarding() {
    return page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Начало" }), h("h1", { text: "Подключим ваш iiko" }),
        h("p", { class: "muted", text: "После каждой смены вы получите отчёт: выручка, чеки, средний чек, официанты, скидки и удаления — и что из этого подозрительно." }))),
      h("div", { class: "choice-cards" },
        h("div", { class: "card form" }, h("h2", { text: "Подключить iiko" }),
          h("p", { class: "muted small", text: "Нужны адрес сервера iiko и отдельный пользователь с доступом к отчётам. 10 минут вместе с управляющим или интегратором." }),
          h("a", { class: "btn primary", href: "#/connect", text: "Подключить" })),
        h("div", { class: "card form" }, h("h2", { text: "Сначала посмотреть на демо" }),
          h("p", { class: "muted small", text: "Покажем отчёты за неделю на данных вымышленного кафе — чтобы понять, как это выглядит." }),
          h("button", { class: "btn", text: "Включить демо", onclick: function (ev) {
            ev.target.disabled = true; ev.target.textContent = "Готовлю отчёты…";
            server("demo").then(function (r) { SV.go("/r/" + r.id); }, function (e) { ev.target.disabled = false; ev.target.textContent = "Включить демо"; fail(e); });
          } }))));
  }

  function home(d) {
    var c = d.conn, reps = d.reports;
    var status = c.mode === "demo" ? h("div", { class: "notice" }, h("div", null, h("b", { text: "Демо-режим. " }), "Отчёты построены на вымышленных данных."), h("a", { class: "btn small", href: "#/connect", text: "Подключить свой iiko" }))
      : c.last_error ? h("div", { class: "notice" }, h("div", null, h("b", { text: "iiko не ответил при последней попытке: " }), c.last_error), h("a", { class: "btn small", href: "#/connect", text: "Проверить подключение" }))
      : null;
    var dayIn = h("input", { type: "date", value: mskDay(-1), max: mskDay(0), style: "width:auto" });
    var sendCb = h("input", { type: "checkbox" });
    var btn = h("button", { class: "btn primary", text: "Сформировать" });
    btn.addEventListener("click", function () {
      btn.disabled = true; btn.textContent = c.mode === "demo" ? "Считаю…" : "Забираю данные из iiko…";
      server("run", { day: dayIn.value, send: sendCb.checked }).then(function (r) {
        if (sendCb.checked) SV.toast(r.sent ? "Отчёт готов и отправлен в Telegram" : "Отчёт готов. В Telegram не отправлен — подключите бота в настройках");
        SV.go("/r/" + r.id);
      }, function (e) { btn.disabled = false; btn.textContent = "Сформировать"; fail(e); });
    });
    var last = reps[0];
    return page(
      h("div", { class: "page-head" },
        h("div", null, h("span", { class: "label", text: c.mode === "demo" ? "Демо" : "iiko подключён" }), h("h1", { text: "Отчёты по сменам" }),
          h("p", { class: "muted small", text: (c.selected || []).map(function (x) { return x.name; }).join(", ") + (c.auto && (c.mode === "iiko" || d.tg.bound) ? " · каждое утро в 6:00 — отчёт за вчера" + (d.tg.bound ? " в Telegram" : "") : "") }))),
      status,
      h("a", { class: "card agents-teaser", href: "#/agents" }, h("div", null, h("span", { class: "label", text: "Команда агентов" }), h("h2", { text: "Смена · Закупки · Финансы · Персонал · Меню · Управляющий" }), h("p", { class: "small muted", text: "Следят за ценами поставщиков, считают прибыль по сменам и неделям, подсказывают, что делать с персоналом и меню. Задайте вопрос управляющему." })), h("span", { class: "btn small primary", text: "Открыть →" })),
      !d.tg.bound ? h("div", { class: "notice" }, h("div", null, h("b", { text: "Получайте отчёт в Telegram. " }), "Каждое утро — коротко, с отклонениями и ссылкой на полный отчёт."), h("a", { class: "btn small", href: "#/settings", text: "Подключить" })) : null,
      h("div", { class: "card row", style: "justify-content:space-between" },
        h("div", { class: "row" }, h("b", { text: "Отчёт за дату" }), dayIn, h("label", { class: "check small" }, sendCb, "и отправить в Telegram")), btn),
      last ? h("a", { class: "card", href: "#/r/" + last.id, style: "text-decoration:none;color:inherit;display:grid;gap:8px" },
        h("span", { class: "label", text: "Последняя смена · " + dayShort(last.day) }),
        h("div", { class: "kpis" },
          h("div", { class: "kpi main" }, h("span", { class: "k-label", text: "Выручка" }), h("span", { class: "k-val", text: money(last.revenue) })),
          h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Чеков" }), h("span", { class: "k-val", text: int(last.orders) })),
          h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Средний чек" }), h("span", { class: "k-val", text: money(last.avg) })),
          h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Отклонения" }), h("span", { class: "k-val", text: String(last.flags) }), h("span", { class: "k-sub", text: last.flags ? "есть на что посмотреть" : "всё спокойно" })))) : null,
      reps.length ? h("section", { class: "rep-list" }, h("h2", { text: "Все отчёты" }), reps.map(function (r) {
        return h("a", { class: "rep", href: "#/r/" + r.id },
          h("b", { text: dayShort(r.day) }), h("span", { class: "hide-m", text: money(r.revenue) }), h("span", { class: "hide-m muted", text: int(r.orders) + " чеков · " + money(r.avg) }),
          r.flags ? h("span", { class: "pill bad", text: r.flags + " " + SV.plural(r.flags, "отклонение", "отклонения", "отклонений") }) : h("span", { class: "pill ok", text: "ок" }));
      })) : h("p", { class: "muted", text: "Отчётов пока нет — сформируйте первый за вчерашний день." }));
  }

  // ------------------------------------------------------------ отчёт
  SV.route("/r/:id", function (p) {
    if (!need()) return;
    SV.mount([topbar(), SV.loading()]);
    call("sv_report_get", { p_id: Number(p.id) }).then(function (r) { SV.mount([topbar(), report(r)]); }, function (e) { SV.mount([topbar(), page(h("div", { class: "card" }, h("p", { text: e.message }), h("a", { class: "btn", href: "#/home", text: "К отчётам" })))]); });
  });
  function table(head, rows, numCols) {
    return h("div", { class: "table-box" }, h("table", { class: "table", style: "min-width:520px" },
      h("thead", null, h("tr", null, head.map(function (x, i) { return h("th", { class: numCols.indexOf(i) >= 0 ? "num" : null, text: x }); }))),
      h("tbody", null, rows.map(function (r) { return h("tr", null, r.map(function (x, i) { return h("td", { class: numCols.indexOf(i) >= 0 ? "num" : null }, x); })); }))));
  }
  function report(r) {
    var o = r.data || {}, t = o.totals || {}, p = o.prev || {};
    var maxPay = Math.max.apply(null, (o.pay || []).map(function (x) { return x.sum; }).concat([1]));
    var maxH = Math.max.apply(null, (o.hours || []).map(function (x) { return x.revenue; }).concat([1]));
    var discShare = t.gross ? t.discount / t.gross : 0;
    return page(
      h("div", { class: "page-head" },
        h("div", null, h("span", { class: "label", text: (o.demo ? "Демо · " : "") + (o.depts || []).join(", ") }), h("h1", { text: dayLong(r.day) }),
          o.partial ? h("p", { class: "small warn-text", text: "Смена ещё идёт — данные на момент " + new Date(o.generated_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) }) : null),
        h("div", { class: "row no-print" }, h("a", { class: "btn ghost small", href: "#/home", text: "← Все отчёты" }), h("button", { class: "btn small", text: "Печать / PDF", onclick: function () { window.print(); } }))),
      h("div", { class: "kpis" },
        h("div", { class: "kpi main" }, h("span", { class: "k-label", text: "Выручка" }), h("span", { class: "k-val", text: money(t.revenue) }), h("span", { class: "k-sub" }, delta(t.revenue, p.revenue), p.revenue ? " к " + dayShort(p.day) + " (" + money(p.revenue) + ")" : "")),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Чеков" }), h("span", { class: "k-val", text: int(t.orders) }), h("span", { class: "k-sub" }, delta(t.orders, p.orders), p.orders ? " · было " + int(p.orders) : "")),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Средний чек" }), h("span", { class: "k-val", text: money(t.avg_check) }), h("span", { class: "k-sub" }, delta(t.avg_check, p.avg_check), p.avg_check ? " · было " + money(p.avg_check) : "")),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Гостей" }), h("span", { class: "k-val", text: int(t.guests) }), h("span", { class: "k-sub", text: "на гостя " + money(t.avg_guest) })),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Скидки" }), h("span", { class: "k-val", text: money(t.discount) }), h("span", { class: "k-sub", text: pct(discShare) + " от суммы чеков" })),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Удаления" }), h("span", { class: "k-val", text: money(t.deleted_sum) }), h("span", { class: "k-sub", text: int(t.deleted_qty) + " позиций" })),
        t.cost != null ? h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Себестоимость" }), h("span", { class: "k-val", text: money(t.cost) }), h("span", { class: "k-sub", text: "фудкост " + pct(t.revenue ? t.cost / t.revenue : 0) })) : null,
        o.profit && o.profit.profit != null && o.profit.has_expenses ? h("div", { class: "kpi main" }, h("span", { class: "k-label", text: "Прибыль смены" }), h("span", { class: "k-val", text: money(o.profit.profit) }), h("span", { class: "k-sub", text: "после доли расходов " + money(o.profit.expenses) }))
          : o.profit && o.profit.gross != null ? h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Валовая прибыль" }), h("span", { class: "k-val", text: money(o.profit.gross) }), h("a", { class: "k-sub", href: "#/expenses", text: "внесите расходы →" })) : null),
      h("section", { class: "card form" }, h("h2", { text: "На что посмотреть" }),
        h("div", { class: "flags" }, (o.flags || []).length ? o.flags.map(function (f) {
          return h("div", { class: "flag " + (f.level === "bad" ? "bad" : "") }, h("b", { text: f.level === "bad" ? "●" : "○", style: "color:" + (f.level === "bad" ? "var(--bad)" : "var(--accent)") }), h("span", { text: f.text }));
        }) : h("div", { class: "flag ok" }, h("b", { text: "✓" }), h("span", { text: "Отклонений не найдено: удаления, скидки и выручка в норме." })))),
      h("div", { class: "two" },
        (o.pay || []).length ? h("section", { class: "card" }, h("h2", { text: "Оплаты" }), h("div", { class: "bars" }, o.pay.map(function (x) {
          return h("div", { class: "bar" }, h("span", { class: "name", text: x.name }), h("span", { class: "track" }, h("i", { style: "width:" + Math.round(x.sum / maxPay * 100) + "%" })), h("span", { class: "v", text: money(x.sum) + " · " + pct(x.share) }));
        }))) : null,
        (o.hours || []).length ? h("section", { class: "card" }, h("h2", { text: "Выручка по часам" }), h("div", { class: "hours" }, o.hours.map(function (x) {
          return h("div", { class: "h", title: x.hour + ":00 — " + money(x.revenue) + ", чеков: " + x.orders }, h("i", { style: "height:" + Math.max(2, Math.round(x.revenue / maxH * 110)) + "px" }), String(x.hour));
        }))) : null),
      (o.by_dept || []).length > 1 ? h("section", { class: "form" }, h("h2", { text: "По подразделениям" }),
        table(["Подразделение", "Выручка", "Чеков", "Гостей", "Средний чек"], o.by_dept.map(function (x) { return [x.name, money(x.revenue), int(x.orders), int(x.guests), money(x.avg_check)]; }), [1, 2, 3, 4])) : null,
      (o.waiters || []).length ? h("section", { class: "form" }, h("h2", { text: "Официанты" }),
        table(["Сотрудник", "Выручка", "Чеков", "Средний чек", "Скидки"], o.waiters.map(function (w) {
          return [w.name, money(w.revenue), int(w.orders), money(w.avg_check), h("span", { class: w.discount_share >= Math.max(0.1, discShare * 2) && w.discount >= 1000 ? "down" : null, text: money(w.discount) + " · " + pct(w.discount_share) })];
        }), [1, 2, 3, 4])) : null,
      (o.dishes || []).length ? h("section", { class: "form" }, h("h2", { text: "Топ-10 позиций по выручке" }),
        table(["Позиция", "Кол-во", "Выручка"], o.dishes.map(function (x) { return [x.name, int(x.qty), money(x.sum)]; }), [1, 2])) : null,
      (o.deletions || []).length ? h("section", { class: "form" }, h("h2", { text: "Удаления" }),
        table(["Позиция", "Сотрудник", "Тип", "Кол-во", "Сумма"], o.deletions.slice(0, 30).map(function (x) { return [x.dish, x.waiter, DEL_TYPES[x.type] || x.type, int(x.qty), money(x.sum)]; }), [3, 4])) : null,
      (o.discounts || []).length ? h("section", { class: "form" }, h("h2", { text: "Скидки по типам" }),
        table(["Скидка", "Сотрудник", "Сумма"], o.discounts.map(function (x) { return [x.type, x.waiter, money(x.sum)]; }), [2])) : null,
      h("div", { class: "card row no-print", style: "justify-content:space-between" }, h("div", null, h("b", { text: "Что говорят агенты" }), h("p", { class: "small muted", text: "Закупки и цены, прибыль, персонал и меню — в разделе «Агенты». Там же можно спросить управляющего." })), h("a", { class: "btn small primary", href: "#/agents", text: "Открыть агентов" })),
      (o.fields_missing || []).length || (o.errors || []).length ? h("p", { class: "small muted", text: "Часть разделов недоступна на вашем сервере iiko" + ((o.errors || []).length ? ": " + o.errors[0] : "") + ". Проверьте права пользователя на отчёты по продажам." }) : null,
      h("p", { class: "small muted", text: "Источник — OLAP-отчёт продаж iiko за учётный день " + r.day + ". Выручка — со скидками, без удалённых позиций. Сравнение — с тем же днём недели неделю назад." }));
  }

  // ------------------------------------------------------------ подключение iiko
  SV.route("/connect", function () {
    if (!need()) return;
    SV.mount([topbar(), SV.loading()]);
    call("sv_me").then(function (d) { SV.mount([topbar(), connect(d.conn)]); }, fail);
  });
  function connect(c) {
    c = c && c.mode === "iiko" ? c : null;
    var url = h("input", { placeholder: "например, mycafe-co.iiko.it", value: c ? c.base_url.replace(/^https:\/\//, "") : "", autocomplete: "off" });
    var login = h("input", { placeholder: "логин пользователя iiko", value: c ? c.login : "", autocomplete: "off" });
    var pass = h("input", { type: "password", placeholder: c && c.has_password ? "оставьте пустым, чтобы не менять" : "пароль этого пользователя", autocomplete: "new-password" });
    var err = h("p", { class: "form-err", role: "alert" });
    var depBox = h("div", { class: "form" });
    var btnTest = h("button", { class: "btn", type: "button", text: "Проверить подключение" });
    var btnSave = h("button", { class: "btn primary", type: "button", text: "Сохранить", hidden: !c });
    var deps = c ? c.departments : [];
    function showDeps(list, selected) {
      depBox.textContent = "";
      if (!list.length) { depBox.appendChild(h("p", { class: "muted small", text: "Подразделения не найдены — отчёт будет по всему серверу." })); return; }
      var sel = (selected || list).map(function (x) { return String(x.id); });
      depBox.appendChild(h("fieldset", null, h("legend", { text: "По каким точкам строить отчёт" }), list.map(function (x) {
        return h("label", { class: "check" }, h("input", { type: "checkbox", value: x.id, checked: sel.indexOf(String(x.id)) >= 0 }), x.name);
      })));
    }
    if (c) showDeps(c.departments, c.selected);
    function args() { return { base_url: url.value, login: login.value, password: pass.value }; }
    btnTest.addEventListener("click", function () {
      err.textContent = "";
      if (!pass.value && !(c && c.has_password)) { err.textContent = "Введите пароль"; return; }
      if (!pass.value) { err.textContent = "Для проверки введите пароль ещё раз"; return; }
      btnTest.disabled = true; btnTest.textContent = "Подключаюсь к iiko…";
      server("test", args()).then(function (r) {
        btnTest.disabled = false; btnTest.textContent = "Проверить подключение";
        deps = r.departments; showDeps(deps); btnSave.hidden = false;
        SV.toast("iiko ответил — подключение работает");
      }, function (e) { btnTest.disabled = false; btnTest.textContent = "Проверить подключение"; err.textContent = e.message; });
    });
    btnSave.addEventListener("click", function () {
      err.textContent = "";
      var selected = [].slice.call(depBox.querySelectorAll("input:checked")).map(function (i) { return i.value; });
      if (deps.length && !selected.length) { err.textContent = "Отметьте хотя бы одну точку"; return; }
      btnSave.disabled = true; btnSave.textContent = "Сохраняю…";
      server("save", Object.assign(args(), { selected: selected })).then(function () {
        pass.value = ""; SV.toast("Подключение сохранено. Пароль хранится в зашифрованном виде"); SV.go("/home");
      }, function (e) { btnSave.disabled = false; btnSave.textContent = "Сохранить"; err.textContent = e.message; });
    });
    return page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Подключение" }), h("h1", { text: "iiko" }))),
      h("div", { class: "two" },
        h("div", { class: "card form" },
          h("label", null, "Адрес сервера iiko", url),
          h("label", null, "Логин", login),
          h("label", null, "Пароль", pass),
          depBox, err, h("div", { class: "row" }, btnTest, btnSave),
          h("p", { class: "small muted", text: "Пароль шифруется и хранится только в зашифрованном виде; расшифровать его может лишь сервер отчётов. Мы только читаем отчёты — ничего не меняем в iiko." })),
        h("div", { class: "card form" }, h("h2", { text: "Как подготовить доступ" }),
          h("ol", { class: "steps" },
            h("li", null, h("span", null, "В iikoOffice создайте отдельного пользователя, например ", h("code", { class: "kbd", text: "svodka" }), ".")),
            h("li", null, h("span", null, "Дайте ему права только на просмотр отчётов: ", h("code", { class: "kbd", text: "B_RPT" }), " (отчёты) и ", h("code", { class: "kbd", text: "B_CASR" }), " (продажи). Остальное не нужно.")),
            h("li", null, h("span", { text: "Адрес сервера — тот же, по которому управляющий заходит в iikoOffice, обычно вида имя-co.iiko.it." })),
            h("li", null, h("span", { text: "Отчёт занимает слот лицензии API на несколько секунд и сразу его освобождает. Если все слоты заняты — уточните у вашего дилера iiko." }))))));
  }

  // ------------------------------------------------------------ настройки
  SV.route("/settings", function () {
    if (!need()) return;
    SV.mount([topbar(), SV.loading()]);
    call("sv_me").then(function (d) { SV.mount([topbar(), settings(d)]); }, fail);
  });
  function settings(d) {
    var c = d.conn;
    var tgBox = h("div", { class: "form" });
    if (d.tg.bound) {
      tgBox.appendChild(h("p", null, "✅ Отчёты приходят в чат ", h("b", { text: d.tg.title || "Telegram" })));
      tgBox.appendChild(h("div", { class: "row" },
        h("button", { class: "btn small", text: "Прислать отчёт за вчера", onclick: function (ev) {
          ev.target.disabled = true;
          server("run", { day: mskDay(-1), send: true }).then(function (r) { ev.target.disabled = false; SV.toast(r.sent ? "Отправлено в Telegram" : "Не удалось отправить — проверьте бота", r.sent ? "" : "bad"); }, function (e) { ev.target.disabled = false; fail(e); });
        } }),
        h("button", { class: "btn small", text: "Перенести в группу", onclick: function (ev) {
          ev.target.disabled = true;
          server("tg_link").then(function (r) {
            ev.target.disabled = false;
            if (!r.enabled || !r.group) { SV.toast("Бот ещё не настроен администратором сервиса", "bad"); return; }
            var old = tgBox.querySelector(".tg-grp"); if (old) old.remove();
            tgBox.appendChild(h("div", { class: "notice tg-grp" }, h("div", null,
              h("p", { class: "small", text: "Откроется Telegram — выберите группу управляющих. Бот пришлёт в неё «✅ Готово», и отчёты пойдут туда вместо личного чата. Бот уже в группе — всё равно выберите её." }),
              h("a", { class: "btn primary", href: r.group, target: "_blank", rel: "noopener", text: "Выбрать группу в Telegram →" }))));
          }, function (e) { ev.target.disabled = false; fail(e); });
        } }),
        h("button", { class: "btn small ghost", text: "Отключить", onclick: function () { call("sv_tg_unbind").then(function () { SV.dispatch(); }, fail); } })));
    } else {
      tgBox.appendChild(h("p", { class: "muted small", text: "Нажмите кнопку — откроется бот. Нажмите в нём «Старт». Можно подключить и общий чат управляющих — после нажатия появится ссылка для группы." }));
      tgBox.appendChild(h("button", { class: "btn primary", text: "Подключить Telegram", onclick: function (ev) {
        ev.target.disabled = true;
        server("tg_link").then(function (r) {
          ev.target.disabled = false;
          if (!r.enabled) { SV.toast("Бот ещё не настроен администратором сервиса", "bad"); return; }
          window.open(r.url, "_blank", "noopener");
          tgBox.appendChild(h("p", { class: "small" }, "Если бот не открылся: ", h("a", { href: r.url, target: "_blank", rel: "noopener", text: r.url }), ". После «Старт» обновите эту страницу."));
          if (r.group) tgBox.appendChild(h("p", { class: "small" }, "Для общего чата управляющих: ", h("a", { href: r.group, target: "_blank", rel: "noopener", text: "добавить бота в группу" }), " — выберите группу, бот сам привяжет её."));
        }, function (e) { ev.target.disabled = false; fail(e); });
      } }));
    }
    return page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Настройки" }), h("h1", { text: "Аккаунт" }))),
      h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Telegram" }), tgBox),
      c ? h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Ежедневный отчёт" }),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: c.auto, onchange: function (ev) {
          call("sv_conn_update", { p_patch: { auto: ev.target.checked } }).then(function () { SV.toast("Сохранено"); }, fail);
        } }), "Каждое утро в 6:00 (Москва) строить отчёт за вчерашний день"),
        h("p", { class: "small muted", text: c.mode === "demo" ? "Сейчас включено демо." : "iiko: " + c.base_url + " · пользователь " + c.login + (c.last_ok_at ? " · последний успешный обмен " + new Date(c.last_ok_at).toLocaleString("ru-RU", { timeZone: TZ }) : "") }),
        h("div", { class: "row" }, h("a", { class: "btn small", href: "#/connect", text: c.mode === "demo" ? "Подключить iiko" : "Изменить подключение" }),
          c.mode === "iiko" ? h("button", { class: "btn small danger", text: "Отключить iiko", onclick: function () {
            SV.confirm("Отключить iiko?", "Сохранённый пароль будет удалён, ежедневные отчёты остановятся. Старые отчёты останутся.", "Отключить", function () {
              call("sv_conn_remove").then(function () { SV.go("/home"); }, fail);
            }, true);
          } }) : null)) : null,
      h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Тариф" }),
        h("p", { class: "muted small", text: "Пробный период — 7 дней, все функции и все агенты открыты. «Смена» 1 990 ₽/мес — отчёт по смене, агенты «Смена» и «Закупки»; «Контроль» 2 990 ₽/мес — вся команда агентов: финансы и прибыль, персонал, меню, ИИ-управляющий в Telegram; «Сеть» 4 990 ₽/мес — до 5 точек." })),
      h("section", { class: "card form", style: "max-width:720px" }, h("button", { class: "btn ghost", text: "Выйти из аккаунта", onclick: function () {
        call("sv_logout").catch(function () {}).then(function () { setMe(null); SV.go("/"); });
      } })));
  }
})();
