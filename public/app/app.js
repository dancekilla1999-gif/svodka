/* «Сводка» — кабинет собственника: подключение iiko, отчёты по сменам, Telegram. */
(function () {
  "use strict";
  var SV = window.SV, h = SV.h;

  // ------------------------------------------------------------ сессия
  function me() {
    if (SV.session) return (SV.session.access || SV.session.email) ? { email: SV.session.email, name: SV.session.name, token: SV.session.access } : null;
    return null;
  }
  function setMe(o) {
    if (!SV.session) return;
    if (!o) { SV.session.access = ""; SV.session.email = ""; SV.session.name = ""; return; }
    if (o.token) SV.session.access = o.token;
    if (o.email) SV.session.email = o.email;
    if (o.name != null) SV.session.name = o.name;
    try { localStorage.removeItem("sv_owner"); } catch (e) {}
  }
  function tok() { return (SV.session && SV.session.access) || ""; }
  function onAuth(e) {
    if (e.network || (e.status >= 500 && e.hint !== "disabled")) { if (SV.offline) SV.offline(); throw e; }
    if (e.hint === "disabled") { if (SV.showDisabled) SV.showDisabled(); throw e; }
    if (e.hint === "auth" || e.hint === "revoked") {
      setMe(null);
      if (SV.tg && SV.bootTelegram) { SV.bootTelegram(); throw e; }
      SV.toast(e.message, "bad");
      SV.go("/login");
    }
    throw e;
  }
  function call(fn, args) { return SV.api(fn, Object.assign({ p_token: tok() }, args || {})).catch(onAuth); }
  function server(action, args) { return SV.fn(action, Object.assign({ token: tok() }, args || {})).catch(onAuth); }
  function rememberReturn() {
    try { var p = SV.path(); if (p && p.indexOf("/r/") === 0) sessionStorage.setItem("sv_return", p); } catch (e) {}
  }
  function takeReturn() {
    var p = null;
    try { p = sessionStorage.getItem("sv_return"); sessionStorage.removeItem("sv_return"); } catch (e) { p = null; }
    return p && p.indexOf("/r/") === 0 ? p : "/home";
  }
  function need() { if (!tok()) { rememberReturn(); SV.go("/login"); return false; } return true; }
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
  function legalLinks() {
    return h("nav", { class: "legal-foot", "aria-label": "Документы" },
      [["/legal/offer", "Оферта"], ["/legal/privacy", "Политика конфиденциальности"], ["/legal/consent", "Согласие на обработку данных"], ["/legal/cookies", "Cookies"]].map(function (x) {
        return h("a", { href: x[0], text: x[1] });
      }));
  }
  var TRIAL = "Первые 7 дней — бесплатно, карта не нужна. В эти дни открыты все функции и все агенты.";
  function operatorGaps() {
    var C = window.SV_LEGAL;
    if (!C || !C.operator) return ["реквизиты оператора"];
    var gaps = [];
    [["название", C.operator.name], ["ИНН", C.operator.inn], ["ОГРН", C.operator.ogrn], ["адрес", C.operator.address], ["почта", C.operator.email]].forEach(function (f) {
      if (f[1] == null || !String(f[1]).trim() || String(f[1]).indexOf("[УКАЖИТЕ") === 0) gaps.push(f[0]);
    });
    if (!docVersion()) gaps.push("редакцию документов");
    return gaps;
  }
  function docVersion() {
    var C = window.SV_LEGAL;
    var v = C && (C.version || C.updated);
    return v ? String(v).trim() : "";
  }
  function agreeLabel(id, parts) {
    var input = h("input", { type: "checkbox", id: id });
    return { input: input, label: h("label", { class: "tb-agree", for: id }, input, h("span", null, parts)) };
  }

  SV.app = { me: me, tok: tok, call: call, server: server, need: need, fail: fail, onAuth: onAuth, topbar: topbar, page: page, money: money, int: int, pct: pct, dayShort: dayShort, dayLong: dayLong, mskDay: mskDay, table: function () { return table.apply(null, arguments); } };

  // ------------------------------------------------------------ вход
  SV.route("/", function () {
    if (tok()) { SV.go("/home"); return; }
    SV.mount(h("main", { class: "page narrow" },
      h("a", { class: "brand big", href: "#/", text: "Сводка" }),
      h("p", { class: "center muted", text: "Отчёт собственнику после каждой смены — из iiko в Telegram" }),
      h("div", { class: "card form" },
        h("a", { class: "btn primary wide", href: "#/register", text: "Попробовать бесплатно" }),
        h("a", { class: "btn wide", href: "#/login", text: "Войти" })),
      legalLinks()));
  });
  function authPage(mode) {
    var email = h("input", { type: "email", id: "email", name: "email", autocomplete: "username", required: true });
    var pass = h("input", { type: "password", id: "password", name: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true, minlength: 8 });
    function ruField(input, emptyMsg, badMsg) {
      input.addEventListener("invalid", function () {
        var v = input.validity;
        if (v.valueMissing) input.setCustomValidity(emptyMsg);
        else if (v.typeMismatch) input.setCustomValidity(badMsg);
        else if (v.tooShort) input.setCustomValidity("Пароль — не короче 8 символов");
        else input.setCustomValidity("Проверьте это поле");
      });
      input.addEventListener("input", function () { input.setCustomValidity(""); });
    }
    ruField(email, "Введите почту", "Укажите почту в виде имя@домен");
    ruField(pass, "Введите пароль", "Проверьте пароль");
    var name = h("input", { id: "name", name: "name", autocomplete: "name", placeholder: "Как к вам обращаться" });
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "submit", text: mode === "login" ? "Войти" : "Создать аккаунт — 7 дней бесплатно", disabled: mode === "register" });
    var offer = null, consent = null, closed = null;
    if (mode === "register") {
      offer = agreeLabel("sv_offer", ["Принимаю ", h("a", { href: "/legal/offer", target: "_blank", rel: "noopener", text: "публичную оферту" }), "."]);
      consent = agreeLabel("sv_consent", ["Даю отдельное ", h("a", { href: "/legal/consent", target: "_blank", rel: "noopener", text: "согласие на обработку персональных данных" }), " по ", h("a", { href: "/legal/privacy", target: "_blank", rel: "noopener", text: "политике конфиденциальности" }), "."]);
      var gaps = operatorGaps();
      closed = gaps.length ? h("p", { class: "form-err", role: "status", text: "Регистрация закрыта, пока в документах не заполнены: " + gaps.join(", ") + ". Их меняют в public/legal/operator.js." }) : null;
      function syncReg() {
        var ready = !gaps.length && offer.input.checked && consent.input.checked;
        btn.disabled = !ready;
        if (ready) {
          err.textContent = "";
          offer.label.classList.remove("tb-need");
          consent.label.classList.remove("tb-need");
        }
      }
      offer.input.addEventListener("change", syncReg);
      consent.input.addEventListener("change", syncReg);
      syncReg();
    }
    SV.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/", text: "Сводка" }),
      h("form", { class: "card form", onsubmit: function (ev) {
        ev.preventDefault(); err.textContent = "";
        if (mode === "register") {
          if (operatorGaps().length || !offer.input.checked || !consent.input.checked || !docVersion()) {
            btn.disabled = true;
            if (!offer.input.checked) offer.label.classList.add("tb-need");
            if (!consent.input.checked) consent.label.classList.add("tb-need");
            err.textContent = operatorGaps().length
              ? "Регистрация закрыта: в документах ещё нет реквизитов оператора."
              : "Примите оферту и дайте отдельное согласие на обработку персональных данных.";
            return;
          }
        }
        btn.disabled = true;
        var flags = { p_offer: true, p_consent: true, p_doc_version: docVersion() };
        var invite = "";
        try { invite = sessionStorage.getItem("sv_invite") || ""; } catch (e) { invite = ""; }
        var req = mode === "login"
          ? SV.authFetch("/api/auth/login", { email: email.value, password: pass.value, device_label: SV.deviceLabel ? SV.deviceLabel() : "" })
          : SV.authFetch("/api/auth/register", { email: email.value, password: pass.value, name: name.value, invite: invite, offer: flags.p_offer, consent: flags.p_consent, doc_version: flags.p_doc_version, device_label: SV.deviceLabel ? SV.deviceLabel() : "" });
        req.then(function (r) { if (r && r.error) throw new Error(r.error); setMe({ token: r.token, email: r.email, name: r.name }); SV.go(takeReturn()); })
          .catch(function (e) { err.textContent = e.message; if (mode === "login") btn.disabled = false; else btn.disabled = !(offer.input.checked && consent.input.checked && !operatorGaps().length); });
      } },
        h("h1", { text: mode === "login" ? "Вход" : "Регистрация" }),
        mode === "register" ? h("label", null, "Имя", name) : null,
        h("label", null, "Почта", email),
        h("label", null, "Пароль" + (mode === "register" ? " (от 8 символов)" : ""), pass),
        offer ? offer.label : null,
        consent ? consent.label : null,
        closed, err, btn,
        mode === "register" ? h("p", { class: "small muted", text: TRIAL }) : null,
        (function () { try { return sessionStorage.getItem("sv_return"); } catch (e) { return null; } })() ? h("p", { class: "small center muted", text: "После входа откроется полный отчёт по смене." }) : null,
        h("p", { class: "small center" }, mode === "login" ? h("a", { class: "auth-alt", href: "#/register", text: "Нет аккаунта? Регистрация" }) : h("a", { class: "auth-alt", href: "#/login", text: "Уже есть аккаунт? Войти" }))),
      legalLinks()));
  }
  SV.route("/login", function () { authPage("login"); });
  SV.route("/register", function () {
    var invite = "";
    try { invite = sessionStorage.getItem("sv_invite") || ""; } catch (e) { invite = ""; }
    if (!invite) {
      SV.mount(h("main", { class: "page narrow" }, h("a", { class: "brand big", href: "#/", text: "Сводка" }),
        h("div", { class: "card form", role: "alert" },
          h("h1", { text: "Регистрация только по приглашению" }),
          h("p", { text: "Публичной формы нет. Откройте ссылку, которую прислал Егор, или войдите, если аккаунт уже есть." }),
          h("a", { class: "btn primary", href: "#/login", text: "Войти" })),
        legalLinks()));
      return;
    }
    authPage("register");
  });

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
          h("b", { text: dayShort(r.day) }), h("span", { class: "hide-m", text: money(r.revenue) }), h("span", { class: "hide-m muted", text: int(r.orders) + " " + SV.plural(r.orders, "чек", "чека", "чеков") + " · " + money(r.avg) }),
          r.flags ? h("span", { class: "pill bad", text: r.flags + " " + SV.plural(r.flags, "отклонение", "отклонения", "отклонений") }) : h("span", { class: "pill ok", text: "ок" }));
      })) : h("p", { class: "muted", text: "Отчётов пока нет — сформируйте первый за вчерашний день." }));
  }

  // ------------------------------------------------------------ отчёт
  SV.route("/r/:id", function (p) {
    if (!need()) return;
    var id = Number(p.id);
    function load() {
      SV.mount([topbar(), SV.loading("Открываю отчёт…")]);
      call("sv_report_get", { p_id: id }).then(function (r) {
        try { SV.mount([topbar(), report(r)]); }
        catch (e) { SV.mount([topbar(), SV.problem("Отчёт не открылся", e.message || "Не удалось показать отчёт", load)]); }
      }, function (e) {
        SV.mount([topbar(), SV.problem("Отчёт не открылся", e.message, load)]);
      });
    }
    if (!id) { SV.mount([topbar(), SV.problem("Отчёт не открылся", "В ссылке нет номера отчёта.", function () { SV.go("/home"); }, "На главную")]); return; }
    load();
  });
  function table(head, rows, numCols) {
    var compact = head.length <= 4;
    return h("div", { class: "table-box" }, h("table", { class: "table" + (compact ? " compact" : ""), style: compact ? "min-width:0;width:100%" : "min-width:520px" },
      h("thead", null, h("tr", null, head.map(function (x, i) { return h("th", { class: numCols.indexOf(i) >= 0 ? "num" : null, text: x }); }))),
      h("tbody", null, rows.map(function (r) { return h("tr", null, r.map(function (x, i) { return h("td", { class: numCols.indexOf(i) >= 0 ? "num" : null }, x); })); }))));
  }
  function revenueTable(items) {
    var payments = ["cash", "card", "bank", "unknown"];
    function row(label, floor, entity) {
      var amounts = payments.map(function (payment) {
        return items.reduce(function (sum, x) {
          return sum + ((!floor || x.floor === floor) && (!entity || x.entity === entity) && x.payment === payment ? x.sum : 0);
        }, 0);
      });
      return [label, money(amounts.reduce(function (sum, n) { return sum + n; }, 0))].concat(amounts.map(money));
    }
    var rows = [];
    ["1", "2"].forEach(function (floor) {
      ["ООО", "ИП"].forEach(function (entity) {
        if (items.some(function (x) { return x.floor === floor && x.entity === entity && x.sum; })) rows.push(row(floor + " этаж · " + entity, floor, entity));
      });
      if (items.some(function (x) { return x.floor === floor && x.entity === "unknown" && x.sum; })) {
        var names = Array.from(new Set(items.filter(function (x) { return x.floor === floor && x.entity === "unknown"; }).map(function (x) { return x.entity_name; }).filter(Boolean)));
        rows.push(row(floor + " этаж · Юрлицо не определено" + (names.length ? " (" + names.join(", ") + ")" : ""), floor, "unknown"));
      }
      rows.push(row("ИТОГО " + floor + " этаж", floor));
    });
    if (items.some(function (x) { return x.floor === "unknown" && x.sum; })) rows.push(row("Этаж не указан", "unknown"));
    rows.push(row("ВСЕГО по разбивке"));
    return table(["Этаж / юрлицо", "Итого", "Наличные", "Карты", "Безналичный расчёт / р/с", "Способ не определён"], rows, [1, 2, 3, 4, 5]);
  }
  function report(r) {
    var o = r.data || {}, t = o.totals || {}, p = o.prev || {};
    var maxPay = Math.max.apply(null, (o.pay || []).map(function (x) { return x.sum; }).concat([1]));
    var maxH = Math.max.apply(null, (o.hours || []).map(function (x) { return x.revenue; }).concat([1]));
    var discountBase = t.discount_base == null ? t.gross : t.discount_base;
    var discShare = discountBase > 0 ? t.discount / discountBase : 0;
    return page(
      h("div", { class: "page-head" },
        h("div", null, h("span", { class: "label", text: (o.demo ? "Демо · " : "") + (o.depts || []).join(", ") }), h("h1", { text: dayLong(r.day) }),
          o.partial ? h("p", { class: "small warn-text", text: "Смена ещё идёт — данные на момент " + new Date(o.generated_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) }) : null),
        h("div", { class: "row no-print" }, h("a", { class: "btn ghost small", href: "#/home", text: "← Все отчёты" }), h("button", { class: "btn small", text: "Печать / PDF", onclick: function () { window.print(); } }))),
      h("div", { class: "kpis" },
        h("div", { class: "kpi main" }, h("span", { class: "k-label", text: "Выручка" }), h("span", { class: "k-val", text: money(t.revenue) }), h("span", { class: "k-sub" }, delta(t.revenue, p.revenue), p.revenue ? " к " + dayShort(p.day) + " (" + money(p.revenue) + ")" : "")),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Чеков" }), h("span", { class: "k-val", text: int(t.orders) }), h("span", { class: "k-sub", text: (t.guests_include_non_fiscal ? "включая нефискальные" : "фискальные и промо") + (p.orders ? " · было " + int(p.orders) : "") })),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Средний чек" }), h("span", { class: "k-val", text: money(t.avg_check) }), h("span", { class: "k-sub" }, delta(t.avg_check, p.avg_check), p.avg_check ? " · было " + money(p.avg_check) : "")),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Гостей" }), h("span", { class: "k-val", text: int(t.guests) }), h("span", { class: "k-sub", text: (t.guests_include_non_fiscal ? "включая нефискальные · " : "") + "на гостя " + money(t.avg_guest) })),
        h("div", { class: "kpi" }, h("span", { class: "k-label", text: "Скидки" }), h("span", { class: "k-val", text: t.discount == null ? "—" : money(t.discount) }), h("span", { class: "k-sub", text: t.discount == null ? "Данные iiko недоступны" : pct(discShare) + " от суммы до скидок" })),
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
          return h("div", { class: "h", title: x.hour + ":00 — " + money(x.revenue) + ", " + x.orders + " " + SV.plural(x.orders, "чек", "чека", "чеков") }, h("i", { style: "height:" + Math.max(2, Math.round(x.revenue / maxH * 110)) + "px" }), String(x.hour));
        }))) : null),
      (o.by_dept || []).length > 1 ? h("section", { class: "form" }, h("h2", { text: "По подразделениям" }),
        table(["Подразделение", "Выручка", "Чеков", "Гостей", "Средний чек"], o.by_dept.map(function (x) { return [x.name, money(x.revenue), int(x.orders), int(x.guests), money(x.avg_check)]; }), [1, 2, 3, 4])) : null,
      (o.waiters || []).length ? h("section", { class: "form" }, h("h2", { text: "Официанты" }),
        table(["Сотрудник", "Выручка", "Чеков", "Средний чек", "Скидки"], o.waiters.map(function (w) {
          return [w.name, money(w.revenue), int(w.orders), money(w.avg_check), h("span", { class: w.discount_share >= Math.max(0.1, discShare * 2) && w.discount >= 1000 ? "down" : null, text: w.discount == null ? "—" : money(w.discount) + " · " + pct(w.discount_share) })];
        }), [1, 2, 3, 4])) : null,
      (o.dishes || []).length ? h("section", { class: "form" }, h("h2", { text: "Топ-10 позиций по выручке" }),
        table(["Позиция", "Кол-во", "Выручка"], o.dishes.map(function (x) { return [x.name, int(x.qty), money(x.sum)]; }), [1, 2])) : null,
      (o.deletions || []).length ? h("section", { class: "form" }, h("h2", { text: "Удаления" }),
        table(["Позиция", "Сотрудник", "Тип", "Кол-во", "Сумма"], o.deletions.slice(0, 30).map(function (x) { return [x.dish, x.waiter, DEL_TYPES[x.type] || x.type, int(x.qty), money(x.sum)]; }), [3, 4])) : null,
      o.revenue_breakdown ? h("section", { class: "form" }, h("h2", { text: "Выручка по этажам и юрлицам" }), revenueTable(o.revenue_breakdown)) : null,
      (function () {
        var types = o.discount_by_type && o.discount_by_type.length ? o.discount_by_type : (function () {
          var map = {}, list = [];
          (o.discount_details || o.discounts || []).forEach(function (x) {
            var k = x.type || "Тип не указан";
            if (!map[k]) { map[k] = { type: k, sum: 0, count: 0 }; list.push(map[k]); }
            map[k].sum += Number(x.sum || 0);
            map[k].count += 1;
          });
          return list.sort(function (a, b) { return b.sum - a.sum; });
        })();
        if (!types.length && !(t.discount > 0)) return null;
        return h("section", { class: "form", id: "discounts-by-type" }, h("h2", { text: "Скидки по типам" }),
          h("p", { class: "small muted", text: "Сумма скидок только по фискальным чекам. Одинаковые типы (например, «Луна») собраны в одну строку." }),
          types.length ? table(["Тип скидки", "Чеков", "Сумма"], types.map(function (x) {
            return [x.type, x.count ? int(x.count) : "—", money(x.sum)];
          }), [1, 2]) : h("p", { class: "small muted", text: t.discount == null ? "Данные недоступны." : "iiko не вернул разбивку по типам." }));
      })(),
      (o.discounts || []).length ? h("section", { class: "form" }, h("h2", { text: "Скидки по сотрудникам" }),
        table(["Скидка", "Сотрудник", "Сумма"], o.discounts.map(function (x) { return [x.type, x.waiter, money(x.sum)]; }), [2])) : null,
      (o.non_fiscal || []).length ? (function () {
        var F = "Учредительские столы";
        var cnt = function (l) { return l.reduce(function (s, x) { return s + (Number(x.count) || 0); }, 0); };
        var tot = function (l) { return l.reduce(function (s, x) { return s + (Number(x.sum) || 0); }, 0); };
        var row = function (x) { return [x.type, x.table || "—", x.count ? int(x.count) : "—", money(x.sum)]; };
        var founders = o.non_fiscal.filter(function (x) { return x.category === F; });
        var others = o.non_fiscal.filter(function (x) { return x.category !== F; });
        var rows = [];
        if (founders.length) {
          rows.push(["Учредительские столы", "", "", ""]);
          rows = rows.concat(founders.map(row));
          rows.push(["Итого учредительские", "", int(cnt(founders)) || "—", money(tot(founders))]);
          if (others.length) rows.push(["Прочие за счёт заведения", "", "", ""]);
        }
        rows = rows.concat(others.map(row));
        rows.push(["ВСЕГО", "", int(cnt(o.non_fiscal)) || "—", money(tot(o.non_fiscal))]);
        return h("section", { class: "form", id: "non-fiscal" }, h("h2", { text: "Списания / За счёт заведения" }),
          h("p", { class: "small muted", text: "Не в кассе, не в скидках, не в выручке. Тип оплаты из группы «За счёт заведения» или из списка в настройках." }),
          table(["Тип оплаты", "Стол", "Чеков", "Сумма"], rows, [2, 3]));
      })() : null,
      (o.unprinted && (o.unprinted.sum || o.unprinted.count)) ? h("p", { class: "small muted", text: "Без фискального чека, не из списка: " + money(o.unprinted.sum) + " · " + int(o.unprinted.count || 0) + " " + SV.plural(o.unprinted.count || 0, "чек", "чека", "чеков") + " (в выручке, проверьте тип оплаты)" }) : null,
      (function () {
        var items = o.promo_items && o.promo_items.length ? o.promo_items : (o.promo ? [
          o.promo["1"] ? { label: "1 этаж", sum: o.promo["1"] } : null,
          o.promo["2"] ? { label: "2 этаж", sum: o.promo["2"] } : null,
          o.promo.unknown ? { label: "Этаж не указан", sum: o.promo.unknown } : null
        ].filter(Boolean) : []);
        if (!items.length && !o.promo_total) return null;
        var total = o.promo_total != null ? o.promo_total : items.reduce(function (s, x) { return s + (Number(x.sum) || 0); }, 0);
        return h("section", { class: "form" }, h("h2", { text: "Промо без оплаты" }),
          h("p", { class: "small muted", text: "Входит в выручку." }),
          table(["Тип / стол", "Чеков", "Сумма"], items.map(function (x) {
            return [x.label || x.type, x.count ? int(x.count) : "—", money(x.sum)];
          }).concat([["ВСЕГО промо без оплаты", items.reduce(function (s, x) { return s + (Number(x.count) || 0); }, 0) ? int(items.reduce(function (s, x) { return s + (Number(x.count) || 0); }, 0)) : "—", money(total)]]), [1, 2]));
      })(),
      o.discount_details ? h("section", { class: "form", id: "discount-details" }, h("h2", { text: "Реестр скидок по чекам" }),
        h("p", { class: "small muted", text: "Подробности для разбора в кабинете. В Telegram уходит только сумма по каждому типу, без списка чеков." }),
        o.discount_details.length ? table(["Закрытие чека", "Чек", "Зал / стол", "Гость / владелец карты", "Вид скидки", "Сотрудник", "Авторизация", "Сумма"], o.discount_details.map(function (x) {
          return [x.closed ? x.closed.replace("T", " ").slice(0, 16) : "—", x.receipt || x.order_id || "—", [x.room, x.table ? "стол " + x.table : ""].filter(Boolean).join(" · ") || "—", x.guest || "Не указан", x.type, x.waiter, x.authorized_by || "—", money(x.sum)];
        }), [7]) : h("p", { class: "small muted", text: "Скидок по чекам нет." })) :
        t.discount > 0 ? h("section", { class: "form" }, h("h2", { text: "Реестр скидок по чекам" }), h("p", { class: "small muted", text: "Детализация по чекам не получена. Для старого отчёта сформируйте его повторно." })) : null,
      h("div", { class: "card row no-print", style: "justify-content:space-between" }, h("div", null, h("b", { text: "Что говорят агенты" }), h("p", { class: "small muted", text: "Закупки и цены, прибыль, персонал и меню — в разделе «Агенты». Там же можно спросить управляющего." })), h("a", { class: "btn small primary", href: "#/agents", text: "Открыть агентов" })),
      (o.fields_missing || []).length || (o.errors || []).length ? h("p", { class: "small muted", text: "Часть разделов недоступна на вашем сервере iiko" + ((o.errors || []).length ? ": " + o.errors[0] : "") + ". Проверьте права пользователя на отчёты по продажам." }) : null,
      h("p", { class: "small muted", text: "Источник — OLAP-отчёт продаж iiko за учётный день " + r.day + ". Выручка — со скидками, без удалённых позиций. Сравнение — с тем же днём недели неделю назад." }));
  }

  // ------------------------------------------------------------ подключение iiko
  SV.route("/connect", function () {
    if (!need()) return;
    function load() {
      SV.mount([topbar(), SV.loading()]);
      call("sv_me").then(function (d) {
        try { SV.mount([topbar(), connect(d.conn)]); }
        catch (e) { SV.mount([topbar(), SV.problem("Не удалось открыть подключение", e.message, load)]); }
      }, function (e) { SV.mount([topbar(), SV.problem("Не удалось открыть подключение", e.message, load)]); });
    }
    load();
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
          h("p", { class: "small muted" }, "Пароль шифруется и хранится только в зашифрованном виде; расшифровать его может лишь сервер отчётов. Мы только читаем отчёты — ничего не меняем в iiko. Логин и пароль обрабатываются по ", h("a", { href: "/legal/privacy", text: "политике конфиденциальности" }), ", согласие даётся отдельной галочкой при регистрации.")),
        h("div", { class: "card form" }, h("h2", { text: "Как подготовить доступ" }),
          h("ol", { class: "steps" },
            h("li", null, h("span", null, "В iikoOffice создайте отдельного пользователя, например ", h("code", { class: "kbd", text: "svodka" }), ".")),
            h("li", null, h("span", null, "Дайте ему права только на просмотр отчётов: ", h("code", { class: "kbd", text: "B_RPT" }), " (отчёты) и ", h("code", { class: "kbd", text: "B_CASR" }), " (продажи). Остальное не нужно.")),
            h("li", null, h("span", { text: "Адрес сервера — тот же, по которому управляющий заходит в iikoOffice, обычно вида имя-co.iiko.it." })),
            h("li", null, h("span", { text: "Отчёт занимает слот лицензии API на несколько секунд и сразу его освобождает. Если все слоты заняты — уточните у вашего дилера iiko." }))))));
  }

  SV.tariffLine = function (plan) {
    if (!plan || !plan.plan || plan.status === "expired" || plan.status === "none") return "Подписка неактивна";
    var title = "Сводка";
    (plan.plans || []).forEach(function (p) { if (p.code === plan.plan) title = p.name || title; });
    var until = plan.paid_until || plan.trial_until;
    if (!until) return "Тариф: " + title;
    var d = new Date(until);
    if (isNaN(d.getTime())) return "Тариф: " + title;
    return "Тариф: " + title + ", активен до " + d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  };
  function when(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function passwordCard() {
    var cur = h("input", { type: "password", autocomplete: "current-password", required: true });
    var next = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 8 });
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary", type: "button", text: "Сменить пароль" });
    btn.addEventListener("click", function () {
      err.textContent = "";
      btn.disabled = true;
      SV.authFetch("/api/auth/password", { current: cur.value, "new": next.value }).then(function () {
        btn.disabled = false;
        cur.value = ""; next.value = "";
        SV.toast(SV.tg ? "Пароль изменён. Этот Telegram остаётся привязанным." : "Пароль изменён. Вход через Telegram нужно привязать заново.");
      }, function (e) { btn.disabled = false; err.textContent = e.message; });
    });
    return h("section", { class: "card form", style: "max-width:720px" },
      h("h2", { text: "Пароль" }),
      h("p", { class: "small muted", text: "Нужен текущий пароль. Остальные входы завершатся." }),
      h("label", null, "Текущий пароль", cur),
      h("label", null, "Новый пароль", next),
      err, btn);
  }
  function devicesCard() {
    var box = h("div", { class: "form" });
    box.appendChild(SV.loading("Загружаю устройства…"));
    function paint(d) {
      box.textContent = "";
      if (d.bound) box.appendChild(h("p", null, "Привязан Telegram ", h("b", { text: d.username ? "@" + d.username : "без username" })));
      if (d.recent) box.appendChild(h("div", { class: "notice", role: "status" }, h("div", null, "Недавно привязали Telegram. Если это были не вы, нажмите «Это не я» на странице с кодом или завершите устройство Telegram здесь.")));
      (d.devices || []).forEach(function (row) {
        var kind = row.kind === "tg" ? "Telegram" : "Сайт";
        box.appendChild(h("div", { class: "row", style: "justify-content:space-between;align-items:center" },
          h("div", null,
            h("b", { text: kind + (row.label ? " · " + row.label : "") + (row.current ? " · это устройство" : "") }),
            h("p", { class: "small muted", text: "Вход " + when(row.created_at) + " · был " + when(row.last_used_at) })),
          row.current ? null : h("button", { class: "btn small danger", type: "button", text: "Завершить", onclick: function () {
            SV.authFetch("/api/auth/devices/" + row.id + "/end", {}).then(function () { SV.dispatch(); }, fail);
          } })));
      });
      box.appendChild(h("button", { class: "btn danger", type: "button", text: "Выйти на всех устройствах", onclick: function () {
        SV.confirm("Выйти везде?", "Все сессии и привязка Telegram будут сняты.", "Выйти везде", function () {
          SV.authFetch("/api/auth/logout-all", {}).then(function () { setMe(null); SV.go("/"); }, fail);
        }, true);
      } }));
    }
    SV.authFetch("/api/auth/devices", {}).then(paint, function (e) { box.textContent = ""; box.appendChild(h("p", { text: e.message })); });
    return h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Устройства" }), box);
  }
  function linkLoginCard(d) {
    var box = h("div", { class: "form" });
    var login = d.tg_login || {};
    if (login.bound) {
      box.appendChild(h("p", null, "Вход без пароля: ", h("b", { text: login.username ? "@" + login.username : (login.first_name || "Telegram") })));
      return h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Вход через Telegram" }), box);
    }
    var btn = h("button", { class: "btn primary", type: "button", text: "Привязать Telegram" });
    box.appendChild(h("p", { class: "small muted", text: "Кнопка откроет кабинет в Telegram. Код действует 10 минут и только один раз." }));
    box.appendChild(btn);
    btn.addEventListener("click", function () {
      btn.disabled = true;
      SV.authFetch("/api/auth/link-code", {}).then(function (r) {
        btn.disabled = false;
        var url = r.url || "";
        var hold = h("div", { class: "form" });
        hold.appendChild(h("p", { class: "small", text: url || "Имя бота ещё не задано. Код: " + r.start }));
        if (url && SV.qrSvg) hold.appendChild(SV.qrSvg(url, 220));
        if (url) hold.appendChild(h("a", { class: "btn", href: url, target: "_blank", rel: "noopener", text: "Открыть в Telegram" }));
        var who = h("p", { class: "small" });
        hold.appendChild(who);
        box.appendChild(hold);
        var timer = setInterval(function () {
          SV.authFetch("/api/auth/link-status", { code: r.code }).then(function (s) {
            if (!s || !s.bound) return;
            clearInterval(timer);
            who.textContent = "";
            who.appendChild(document.createTextNode("Привязан Telegram " + (s.username ? "@" + s.username : "") + " — это вы? "));
            who.appendChild(h("button", { class: "btn small danger", type: "button", text: "Это не я", onclick: function () {
              SV.authFetch("/api/auth/link-dispute", { code: r.code }).then(function () { SV.toast("Telegram отвязан"); SV.dispatch(); }, fail);
            } }));
          }, function () {});
        }, 2000);
        window.addEventListener("hashchange", function stop() { clearInterval(timer); window.removeEventListener("hashchange", stop); });
      }, function (e) { btn.disabled = false; fail(e); });
    });
    return h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Вход через Telegram" }), box);
  }

  // ------------------------------------------------------------ настройки
  SV.route("/settings", function () {
    if (!need()) return;
    function load() {
      SV.mount([topbar(), SV.loading()]);
      Promise.all([
        call("sv_me"),
        call("sv_agent", { p_op: "home", p_args: {} }).catch(function () { return {}; })
      ]).then(function (arr) {
        var d = arr[0] || {};
        d.prefs = (arr[1] && arr[1].prefs) || d.prefs || {};
        try { SV.mount([topbar(), settings(d)]); }
        catch (e) { SV.mount([topbar(), SV.problem("Не удалось открыть настройки", e.message, load)]); }
      }, function (e) { SV.mount([topbar(), SV.problem("Не удалось открыть настройки", e.message, load)]); });
    }
    load();
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
    var built = page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Настройки" }), h("h1", { text: "Аккаунт" }))),
      h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Чат отчётов" }), tgBox),
      linkLoginCard(d),
      devicesCard(),
      passwordCard(),
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
      SV.tg ? null : (function () {
        var prefs = d.prefs || {};
        var defNon = "334 Андрей Михайлович\n335 Алексей Р.Ш.\n338 Расим\n49 Представительская оплата\n19 Антон бухгалтер\n336 Надежда\n20 Маркетинг\n88 Захар\n88 Персонал";
        var defPromo = "ПромоБезОплаты";
        function asText(v, fallback) {
          if (Array.isArray(v) && v.length) return v.join("\n");
          if (typeof v === "string" && v.trim()) return v;
          return fallback;
        }
        var non = h("textarea", { rows: 8, style: "width:100%;min-height:8.5rem" });
        non.value = asText(prefs.non_fiscal_pay_types, defNon);
        var promo = h("textarea", { rows: 3, style: "width:100%;min-height:4rem" });
        promo.value = asText(prefs.promo_pay_types, defPromo);
        var btn = h("button", { class: "btn primary", type: "button", text: "Сохранить типы оплат", onclick: function () {
          btn.disabled = true;
          call("sv_agent", { p_op: "prefs_save", p_args: {
            non_fiscal_pay_types: non.value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean),
            promo_pay_types: promo.value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean)
          } }).then(function () { btn.disabled = false; SV.toast("Сохранено. Новый отчёт построится уже по этим правилам."); }, function (e) { btn.disabled = false; fail(e); });
        } });
        return h("section", { class: "card form", style: "max-width:720px" },
          h("h2", { text: "Типы оплаты iiko" }),
          h("p", { class: "small muted", text: "Сводка смотрит на название типа оплаты, а не на номер стола. Нефискальные «за счёт заведения» не входят в выручку и скидки; «промо без оплаты» входит в выручку." }),
          h("label", null, "Нефискальные (за счёт заведения) — по одному типу в строке", non),
          h("label", null, "Промо, которое входит в выручку", promo),
          btn);
      })(),
      SV.tg ? h("section", { class: "card form", id: "tg-tariff", style: "max-width:720px" }, h("h2", { text: "Тариф" }),
        h("p", { id: "tg-tariff-line", text: "Подписка неактивна" }))
        : h("section", { class: "card form", style: "max-width:720px" }, h("h2", { text: "Тариф" }),
        h("p", { class: "muted small", text: TRIAL + " «Смена» 1 990 ₽/мес — отчёт по смене, агенты «Смена» и «Закупки»; «Контроль» 2 990 ₽/мес — вся команда агентов: финансы и прибыль, персонал, меню, ИИ-управляющий в Telegram; «Сеть» 4 990 ₽/мес — до 5 точек." }),
        legalLinks()),
      h("section", { class: "card form", style: "max-width:720px" }, h("button", { class: "btn ghost", text: SV.tg ? "Выйти и отвязать Telegram" : "Выйти из аккаунта", onclick: function () {
        var job = SV.tg ? SV.authFetch("/api/tg/unbind", {}) : SV.authFetch("/api/auth/logout", {});
        job.catch(function () {}).then(function () { setMe(null); SV.go("/"); });
      } })));
    if (SV.tg) {
      call("sv_plan").then(function (plan) {
        var line = document.getElementById("tg-tariff-line");
        if (line) line.textContent = SV.tariffLine(plan);
      }, function () {});
    }
    return built;
  }
})();
