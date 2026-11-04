/* «Сводка» — команда агентов: обзор, подробности каждого агента, вопросы ИИ-управляющему, расходы и цели. */
(function () {
  "use strict";
  var SV = window.SV, h = SV.h, A = SV.app;
  var money = A.money, int = A.int;
  function pct1(x) { return x == null ? "—" : (Math.round(x * 1000) / 10).toString().replace(".", ",") + "%"; }
  function dayShort(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? A.dayShort(iso) : iso; }
  var AG = [
    { id: "director", name: "Управляющий", ico: "🧭", role: "Собирает выводы всех агентов в план на неделю и отвечает на ваши вопросы" },
    { id: "shift", name: "Смена", ico: "🧾", role: "Каждая смена: выручка, себестоимость, прибыль, удаления и скидки" },
    { id: "purchases", name: "Закупки", ico: "🛒", role: "Накладные из iiko: что подорожало, у какого поставщика и во сколько это обходится" },
    { id: "finance", name: "Финансы", ico: "📈", role: "Неделя: доходы, расходы, прибыль, фудкост, ФОТ и прогноз на месяц" },
    { id: "staff", name: "Персонал", ico: "👥", role: "Официанты и загрузка по часам: кого похвалить, с кем поговорить, где лишние люди" },
    { id: "menu", name: "Меню", ico: "🍽", role: "Блюда по продажам и марже: звёзды, лошадки, загадки и кандидаты на вывод" }
  ];
  var CAT = { rent: "Аренда", staff: "Зарплаты (ФОТ)", utilities: "Коммунальные", marketing: "Маркетинг", taxes: "Налоги", bank: "Эквайринг и банк", other: "Прочее" };
  var KIND = { month: "в месяц", week: "в неделю", once: "разово", percent: "% от выручки" };
  function byId(id) { for (var i = 0; i < AG.length; i++) if (AG[i].id === id) return AG[i]; return null; }
  function lvl(l) { return l === "bad" ? "bad" : l === "warn" ? "warn" : "ok"; }
  function dot(l) { return h("span", { class: "dot " + lvl(l), "aria-hidden": "true" }); }

  function srv(action, args) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);
    return fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action: action, token: A.tok() }, args || {})), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { clearTimeout(timer); if (!r.ok) { var e = new Error(d.error || ("Ошибка сервера (" + r.status + ")")); e.hint = d.hint; throw e; } return d; }); },
        function (e) { clearTimeout(timer); throw new Error(e && e.name === "AbortError" ? "Агенты думают слишком долго, попробуйте ещё раз" : "Нет связи с сервером"); })
      .catch(A.onAuth);
  }
  function items(list, max) {
    list = (list || []).slice(0, max || 50);
    if (!list.length) return h("div", { class: "flag ok" }, h("b", { text: "✓" }), h("span", { text: "Отклонений нет." }));
    return h("div", { class: "flags" }, list.map(function (i) { return h("div", { class: "flag " + (i.level === "bad" ? "bad" : i.level === "ok" ? "ok" : "") }, dot(i.level), h("span", { text: i.text })); }));
  }

  // ------------------------------------------------------------ обзор
  SV.route("/agents", function () {
    if (!A.need()) return;
    SV.mount([A.topbar(), SV.loading("Собираю выводы агентов…")]);
    Promise.all([A.call("sv_agent", { p_op: "home", p_args: {} }), srv("status").catch(function () { return { ai: false }; })]).then(function (r) {
      SV.mount([A.topbar(), overview(r[0], r[1])]);
    }, function (e) { SV.mount([A.topbar(), A.page(h("div", { class: "card form" }, h("p", { text: e.message }), h("a", { class: "btn", href: "#/home", text: "К отчётам" })))]); });
  });

  function overview(d, st) {
    var ins = {}; (d.insights || []).forEach(function (i) { ins[i.agent] = i; });
    var dir = ins.director;
    var weekBtn = h("button", { class: "btn small", text: "Пересчитать неделю" });
    weekBtn.addEventListener("click", function () {
      weekBtn.disabled = true; weekBtn.textContent = "Агенты считают неделю…";
      srv("week").then(function () { SV.toast("Готово — агенты пересчитали последнюю неделю"); SV.dispatch(); }, function (e) { weekBtn.disabled = false; weekBtn.textContent = "Пересчитать неделю"; SV.toast(e.message, "bad"); });
    });
    if (!d.mode) return A.page(h("div", { class: "card form" }, h("h1", { text: "Агенты" }), h("p", { class: "muted", text: "Агентам нужны данные. Подключите iiko или включите демо — и через минуту здесь появятся выводы." }), h("a", { class: "btn primary", href: "#/home", text: "Подключить" })));
    return A.page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Команда агентов" + (d.mode === "demo" ? " · демо" : "") }), h("h1", { text: "Что происходит в заведении" }),
        h("p", { class: "muted small", text: "Шесть агентов разбирают данные iiko каждое утро, по понедельникам — неделю целиком." + (st.ai ? "" : " ИИ-тексты появятся, когда администратор сервиса подключит YandexGPT; цифры и правила работают уже сейчас.") })),
        h("div", { class: "row" }, weekBtn)),
      dir ? h("section", { class: "card form brief " + lvl(dir.level) },
        h("div", { class: "row", style: "justify-content:space-between" }, h("span", { class: "label", text: "🧭 Управляющий · " + dir.title }), h("a", { class: "small", href: "#/agents/director", text: "Подробнее" })),
        h("div", { class: "brief-text", text: dir.text })) : h("div", { class: "notice" }, h("div", null, h("b", { text: "Плана на неделю пока нет. " }), "Он появится в понедельник утром или нажмите «Пересчитать неделю».")),
      chatBox(d.chat || [], st.ai),
      h("div", { class: "agent-grid" }, AG.filter(function (a) { return a.id !== "director"; }).map(function (a) {
        var i = ins[a.id];
        var top = i && i.data && i.data.items ? i.data.items.filter(function (x) { return x.level !== "ok"; }).slice(0, 2) : [];
        return h("a", { class: "card agent " + (i ? lvl(i.level) : ""), href: "#/agents/" + a.id },
          h("div", { class: "agent-head" }, h("span", { class: "agent-ico", text: a.ico, "aria-hidden": "true" }), h("div", null, h("h2", { text: a.name }), h("p", { class: "small muted", text: a.role }))),
          i ? h("div", { class: "agent-body" }, h("p", { class: "agent-title" }, dot(i.level), h("b", { text: i.title })),
            top.map(function (x) { return h("p", { class: "small", text: "• " + x.text }); }),
            h("span", { class: "small muted", text: "обновлено " + SV.ago(i.created_at) }))
            : h("p", { class: "small muted", text: a.id === "purchases" ? "Ждёт первых накладных из iiko." : "Ещё не работал — появится после ближайшего отчёта." }));
      })),
      d.history && d.history.length ? h("section", { class: "form" }, h("h2", { text: "Журнал агентов" }), h("div", { class: "rep-list" }, d.history.slice(0, 10).map(function (x) {
        var a = byId(x.agent) || { name: x.agent, ico: "•" };
        return h("a", { class: "rep", href: "#/agents/" + x.agent + "/" + encodeURIComponent(x.pkey) }, h("b", { text: a.ico + " " + a.name }), h("span", { text: x.title }), h("span", { class: "pill " + (x.level === "ok" ? "ok" : "bad"), text: x.level === "ok" ? "ок" : x.level === "bad" ? "важно" : "внимание" }));
      }))) : null);
  }

  // ------------------------------------------------------------ вопросы управляющему
  var SUGGEST = ["Почему изменилась выручка на этой неделе?", "Что подорожало у поставщиков?", "Сколько мы заработали за неделю?", "Кого из официантов похвалить, а с кем поговорить?", "Какие блюда поднять в цене?"];
  function chatBox(history, aiOn) {
    var log = h("div", { class: "chat-log", "aria-live": "polite" });
    function bubble(role, text) { log.appendChild(h("div", { class: "msg " + role }, h("span", { text: text }))); log.scrollTop = log.scrollHeight; }
    history.forEach(function (m) { bubble(m.role, m.text); });
    if (!history.length) bubble("assistant", "Здравствуйте! Я управляющий. Спросите про выручку, прибыль, закупки, персонал или меню — отвечу по вашим данным из iiko.");
    var inp = h("textarea", { rows: 2, maxlength: 1500, placeholder: "Например: почему в среду упала выручка?" });
    var btn = h("button", { class: "btn primary", type: "submit", text: "Спросить" });
    function ask(q) {
      q = String(q || "").trim(); if (q.length < 2) return;
      bubble("user", q); inp.value = ""; btn.disabled = true;
      var wait = h("div", { class: "msg assistant wait" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Смотрю данные…"); log.appendChild(wait); log.scrollTop = log.scrollHeight;
      srv("ask", { question: q }).then(function (r) { wait.remove(); bubble("assistant", r.text); btn.disabled = false; inp.focus(); },
        function (e) { wait.remove(); bubble("assistant", "Не получилось ответить: " + e.message); btn.disabled = false; });
    }
    return h("section", { class: "card form chat" },
      h("div", { class: "row", style: "justify-content:space-between" }, h("h2", { text: "Спросить управляющего" }), h("span", { class: "small muted", text: aiOn ? "YandexGPT · по вашим данным" : "пока без ИИ — отвечаю выводами агентов" })),
      log,
      h("div", { class: "chips" }, SUGGEST.map(function (s) { return h("button", { class: "chip", type: "button", text: s, onclick: function () { ask(s); } }); })),
      h("form", { class: "chat-form", onsubmit: function (ev) { ev.preventDefault(); ask(inp.value); } }, inp, btn),
      h("p", { class: "small muted", text: "Эти же вопросы можно задавать боту в Telegram — он отвечает в привязанном чате." }));
  }

  // ------------------------------------------------------------ подробности агента
  SV.route("/agents/:agent", function (p) { detailRoute(p.agent, null); });
  SV.route("/agents/:agent/:pkey", function (p) { detailRoute(p.agent, p.pkey); });
  function detailRoute(agent, pkey) {
    if (!A.need()) return;
    var a = byId(agent);
    if (!a) { SV.go("/agents"); return; }
    SV.mount([A.topbar(), SV.loading()]);
    A.call("sv_agent", { p_op: "insight_get", p_args: pkey ? { agent: agent, pkey: pkey } : { agent: agent } }).then(function (i) {
      SV.mount([A.topbar(), detail(a, i)]);
    }, function (e) {
      SV.mount([A.topbar(), A.page(h("div", { class: "card form" }, h("h1", { text: a.ico + " " + a.name }), h("p", { class: "muted", text: e.hint === "not_found" ? "Агент ещё не работал. Его выводы появятся после ближайшего отчёта (или нажмите «Пересчитать неделю»)." : e.message }), h("a", { class: "btn", href: "#/agents", text: "← К агентам" })))]);
    });
  }
  function detail(a, i) {
    var d = i.data || {};
    var body = [];
    if (i.agent === "director") body.push(h("section", { class: "card form brief " + lvl(i.level) }, h("div", { class: "brief-text", text: i.text }), d.by_ai ? h("p", { class: "small muted", text: "Текст написал ИИ (YandexGPT) по цифрам агентов." }) : null));
    if (i.agent === "shift") body.push(shiftView(d));
    if (i.agent === "purchases") body.push(purchView(d));
    if (i.agent === "finance") body.push(finView(d));
    if (i.agent === "staff") body.push(staffView(d));
    if (i.agent === "menu") body.push(menuView(d));
    return A.page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: a.ico + " Агент «" + a.name + "»" }), h("h1", { text: i.title }), h("p", { class: "small muted", text: a.role + " · обновлено " + SV.ago(i.created_at) })),
        h("div", { class: "row no-print" }, h("a", { class: "btn ghost small", href: "#/agents", text: "← Все агенты" }), h("button", { class: "btn small", text: "Печать / PDF", onclick: function () { window.print(); } }))),
      i.agent !== "director" ? h("section", { class: "card form" }, h("h2", { text: "Выводы" }), items(d.items)) : h("section", { class: "card form" }, h("h2", { text: "На чём основан план" }), items(d.actions)),
      body);
  }
  function kpi(label, val, sub, main) { return h("div", { class: "kpi" + (main ? " main" : "") }, h("span", { class: "k-label", text: label }), h("span", { class: "k-val", text: val }), sub ? h("span", { class: "k-sub", text: sub }) : null); }
  function shiftView(d) {
    var m = d.metrics || {};
    return [h("div", { class: "kpis" }, kpi("Выручка", money(m.revenue), null, true), m.cost != null ? kpi("Себестоимость", money(m.cost), "фудкост " + pct1(m.food_cost)) : null,
      m.gross != null ? kpi("Валовая прибыль", money(m.gross)) : null, m.has_expenses ? kpi("Доля расходов за день", money(m.expenses), m.labor ? "в т.ч. ФОТ " + money(m.labor) : null) : null,
      m.profit != null && m.has_expenses ? kpi("Прибыль смены", money(m.profit), "маржа " + pct1(m.margin), true) : null),
      d.tip ? h("section", { class: "card form" }, h("h2", { text: "🧭 Совет управляющего" }), h("p", { text: d.tip })) : null,
      h("a", { class: "btn small", href: "#/home", text: "Отчёты по сменам →" })];
  }
  function purchView(d) {
    var rows = d.rows || [];
    return [h("div", { class: "kpis" }, kpi("Закуплено", money(d.sum), null, true), kpi("Подорожало", int(d.up), "позиций"), kpi("Подешевело", int(d.down), "позиций"), kpi("Переплата к прошлым ценам", money(Math.max(0, d.impact || 0)))),
      rows.length ? h("section", { class: "form" }, h("h2", { text: "Цены по накладным" }), A.table(["Товар", "Поставщик", "Кол-во", "Цена", "Была", "Изм."], rows.map(function (r) {
        return [r.name, r.supplier || "—", int(r.qty) + (r.unit ? " " + r.unit : ""), money(r.price), r.prev_price != null ? money(r.prev_price) + " · " + dayShort(r.prev_day) : "новая",
          r.change == null ? "—" : h("span", { class: r.change > 0.001 ? "down" : r.change < -0.001 ? "up" : null, text: (r.change > 0 ? "+" : "") + pct1(r.change) })];
      }), [2, 3, 4, 5])) : h("p", { class: "muted", text: "Накладных за период нет." }),
      h("p", { class: "small muted", text: "Цена — средняя за единицу по накладной (сумма ÷ количество). Сравнение — с последней ценой этого товара до этой даты, у любого поставщика." })];
  }
  function finView(d) {
    var p = d.pnl || {}, pv = d.prev || {}, e = p.expenses || {}, mo = d.month || {};
    var rows = [["Выручка", money(p.revenue), pv.revenue ? money(pv.revenue) : "—"]];
    if (p.cost != null) rows.push(["Себестоимость продаж", "− " + money(p.cost), "фудкост " + pct1(p.food_cost)]);
    if (p.gross != null) rows.push(["Валовая прибыль", money(p.gross), ""]);
    (e.by || []).forEach(function (x) { rows.push(["  " + x.name + " (" + (CAT[x.category] || x.category) + ")", "− " + money(x.sum), KIND[x.kind] || ""]); });
    if (e.total) rows.push(["Расходы всего", "− " + money(e.total), p.labor_share != null && e.labor ? "ФОТ " + pct1(p.labor_share) : ""]);
    if (p.profit != null) rows.push([h("b", { text: "Прибыль" }), h("b", { text: money(p.profit) }), pv.profit != null ? "было " + money(pv.profit) : "маржа " + pct1(p.margin)]);
    var maxR = Math.max.apply(null, (p.by_day || []).map(function (x) { return x.revenue; }).concat([1]));
    return [h("div", { class: "kpis" }, kpi("Выручка недели", money(p.revenue), pv.revenue ? "прошлая " + money(pv.revenue) : null, true),
        p.profit != null && e.total ? kpi("Прибыль", money(p.profit), "маржа " + pct1(p.margin), true) : p.gross != null ? kpi("Валовая прибыль", money(p.gross)) : null,
        p.food_cost != null ? kpi("Фудкост", pct1(p.food_cost), pv.food_cost != null ? "было " + pct1(pv.food_cost) : null) : null,
        kpi("Средний чек", money(p.avg_check), pv.avg_check ? "было " + money(pv.avg_check) : null), kpi("Закупки", money(p.purchases)),
        mo.revenue ? kpi("Месяц", money(mo.revenue), "прогноз ≈ " + money(mo.forecast)) : null),
      h("section", { class: "form" }, h("h2", { text: "Отчёт о прибылях и убытках" }), A.table(["Статья", "Сумма", ""], rows, [1])),
      (p.by_day || []).length ? h("section", { class: "card" }, h("h2", { text: "Выручка по дням" }), h("div", { class: "bars" }, p.by_day.map(function (x) {
        return h("div", { class: "bar" }, h("span", { class: "name", text: dayShort(x.day) }), h("span", { class: "track" }, h("i", { style: "width:" + Math.round(x.revenue / maxR * 100) + "%" })), h("span", { class: "v", text: money(x.revenue) }));
      }))) : null,
      !e.total ? h("div", { class: "notice" }, h("div", null, h("b", { text: "Внесите расходы. " }), "Аренда, зарплаты, коммуналка, эквайринг — и агент покажет чистую прибыль по сменам и неделям."), h("a", { class: "btn small", href: "#/expenses", text: "Внести" })) : null];
  }
  function staffView(d) {
    var t = d.team || {}, list = d.staff || [], H = d.hours || [];
    var maxH = Math.max.apply(null, H.map(function (x) { return x.avg_revenue; }).concat([1]));
    return [h("div", { class: "kpis" }, kpi("Средний чек команды", money(t.avg_check), null, true), kpi("Скидки команды", pct1(t.discount_share)), kpi("Сотрудников в отчётах", int(list.length))),
      list.length ? h("section", { class: "form" }, h("h2", { text: "Рейтинг за неделю" }), A.table(["Сотрудник", "Смен", "Выручка", "За смену", "Средний чек", "Скидки", "Удаления"], list.map(function (x) {
        return [x.name, int(x.shifts), money(x.revenue), money(x.per_shift), h("span", { class: t.avg_check && x.avg_check >= t.avg_check * 1.12 ? "up" : t.avg_check && x.avg_check <= t.avg_check * 0.85 ? "down" : null, text: money(x.avg_check) }),
          h("span", { class: x.discount_share >= Math.max(0.08, (t.discount_share || 0) * 2) && x.discount >= 2000 ? "down" : null, text: money(x.discount) + " · " + pct1(x.discount_share) }),
          h("span", { class: x.deleted_no_wo >= 1500 ? "down" : null, text: money(x.deleted) + (x.deleted_no_wo ? " (без списания " + money(x.deleted_no_wo) + ")" : "") })];
      }), [1, 2, 3, 4, 5, 6])) : null,
      H.length ? h("section", { class: "card" }, h("h2", { text: "Средняя выручка по часам" }), h("div", { class: "hours" }, H.map(function (x) {
        return h("div", { class: "h", title: x.hour + ":00 — " + money(x.avg_revenue) + " в среднем" }, h("i", { style: "height:" + Math.max(2, Math.round(x.avg_revenue / maxH * 110)) + "px" }), String(x.hour));
      }))) : null];
  }
  function menuView(d) {
    var m = d.matrix;
    var groups = m ? [["star", "⭐ Звёзды", "Продаются часто и зарабатывают больше среднего — главное в меню"], ["horse", "🐎 Рабочие лошадки", "Популярны, но маржа ниже средней — поднять цену или удешевить порцию"],
      ["puzzle", "🧩 Загадки", "Выгодные, но берут редко — продвигать официантами и местом в меню"], ["dog", "🐕 Кандидаты на вывод", "Редко и невыгодно — убрать или переделать"]] : [];
    return [m ? h("p", { class: "small muted", text: "Средняя маржа с порции: " + money(m.avg_margin) + ". Популярность — доля продаж в штуках относительно средней (порог 70%)." }) : null,
      m ? h("div", { class: "matrix" }, groups.map(function (g) {
        return h("section", { class: "card form" }, h("h2", { text: g[1] + " · " + (m[g[0]] || []).length }), h("p", { class: "small muted", text: g[2] }),
          (m[g[0]] || []).length ? h("ul", { class: "mlist" }, m[g[0]].slice(0, 12).map(function (x) { return h("li", null, h("span", { text: x.name }), h("span", { class: "muted small", text: int(x.qty) + " шт · маржа " + money(x.unit_margin) + " · ФК " + pct1(x.food_cost) })); })) : h("p", { class: "small muted", text: "—" }));
      })) : null,
      (d.top || []).length ? h("section", { class: "form" }, h("h2", { text: "Топ-15 по выручке за неделю" }), A.table(["Позиция", "Кол-во", "Выручка", "Доля", "Фудкост"], d.top.map(function (x) { return [x.name, int(x.qty), money(x.sum), pct1(x.share), pct1(x.food_cost)]; }), [1, 2, 3, 4])) : null];
  }

  // ------------------------------------------------------------ расходы и цели
  SV.route("/expenses", function () {
    if (!A.need()) return;
    SV.mount([A.topbar(), SV.loading()]);
    A.call("sv_agent", { p_op: "home", p_args: {} }).then(function (d) { SV.mount([A.topbar(), expenses(d)]); }, A.fail);
  });
  function expenses(d) {
    var list = d.expenses || [], prefs = Object.assign({ food_cost_target: 0.32, labor_target: 0.28, price_alert: 0.05, weekly_tg: true, daily_tips: true, purchases: true }, d.prefs || {});
    var name = h("input", { placeholder: "Например: Аренда", maxlength: 80 });
    var cat = h("select", null, Object.keys(CAT).map(function (k) { return h("option", { value: k, text: CAT[k] }); }));
    var kind = h("select", null, Object.keys(KIND).map(function (k) { return h("option", { value: k, text: KIND[k] }); }));
    var amount = h("input", { type: "number", min: 0, step: "0.01", placeholder: "Сумма" });
    var day = h("input", { type: "date", hidden: true });
    kind.addEventListener("change", function () { day.hidden = kind.value !== "once"; amount.placeholder = kind.value === "percent" ? "Процент, например 2.5" : "Сумма, ₽"; });
    var err = h("p", { class: "form-err", role: "alert" });
    var add = h("button", { class: "btn primary", type: "submit", text: "Добавить" });
    var total = 0; list.forEach(function (e) { if (e.kind === "month") total += Number(e.amount); else if (e.kind === "week") total += Number(e.amount) * 52 / 12; });
    var presets = [["Аренда", "rent", "month"], ["Зарплаты (ФОТ)", "staff", "month"], ["Коммунальные", "utilities", "month"], ["Эквайринг", "bank", "percent"], ["Налог УСН", "taxes", "percent"], ["Реклама", "marketing", "month"]];
    function pref(key, label, hint, fmt) {
      var inp = h("input", { type: "number", min: 1, max: 70, step: "0.5", value: Math.round(prefs[key] * 1000) / 10, style: "width:90px" });
      inp.addEventListener("change", function () {
        var v = Number(inp.value) / 100; var o = {}; o[key] = v;
        A.call("sv_agent", { p_op: "prefs_save", p_args: o }).then(function () { SV.toast("Сохранено"); }, A.fail);
      });
      return h("label", { class: "row", style: "justify-content:space-between" }, h("span", null, label, h("br"), h("span", { class: "small muted", text: hint })), h("span", { class: "row" }, inp, "%"));
    }
    function sw(key, label) {
      return h("label", { class: "check" }, h("input", { type: "checkbox", checked: prefs[key] !== false, onchange: function (ev) { var o = {}; o[key] = ev.target.checked; A.call("sv_agent", { p_op: "prefs_save", p_args: o }).then(function () { SV.toast("Сохранено"); }, A.fail); } }), label);
    }
    return A.page(
      h("div", { class: "page-head" }, h("div", null, h("span", { class: "label", text: "Финансы" }), h("h1", { text: "Расходы и цели" }),
        h("p", { class: "muted small", text: "Выручку и себестоимость агенты берут из iiko. Здесь — то, чего в iiko обычно нет: аренда, зарплаты, коммуналка, проценты банку и налоги. Вносите один раз — агенты распределяют их по сменам и неделям." }))),
      !d.mode ? h("div", { class: "notice" }, h("div", null, "Сначала подключите iiko или включите демо."), h("a", { class: "btn small", href: "#/home", text: "Подключить" })) : null,
      h("div", { class: "two" },
        h("section", { class: "card form" }, h("h2", { text: "Статьи расходов" }),
          list.length ? h("div", { class: "exp-list" }, list.map(function (e) {
            return h("div", { class: "exp" }, h("div", null, h("b", { text: e.name }), h("span", { class: "small muted", text: " · " + (CAT[e.category] || e.category) })),
              h("span", { text: e.kind === "percent" ? String(e.amount).replace(".", ",") + "% от выручки" : money(e.amount) + " " + KIND[e.kind] + (e.kind === "once" && e.day ? " · " + dayShort(e.day) : "") }),
              h("button", { class: "icon-btn", "aria-label": "Удалить " + e.name, text: "×", onclick: function () { SV.confirm("Удалить расход?", e.name, "Удалить", function () { A.call("sv_agent", { p_op: "expense_remove", p_args: { id: e.id } }).then(function () { SV.dispatch(); }, A.fail); }, true); } }));
          })) : h("p", { class: "muted small", text: "Пока пусто. Начните с аренды и зарплат — это обычно 40–60% всех расходов." }),
          total ? h("p", { class: "small" }, "Постоянные расходы ≈ ", h("b", { text: money(total) }), " в месяц (без процентных и разовых)") : null,
          h("div", { class: "chips" }, presets.map(function (p) { return h("button", { class: "chip", type: "button", text: "+ " + p[0], onclick: function () { name.value = p[0]; cat.value = p[1]; kind.value = p[2]; kind.dispatchEvent(new Event("change")); amount.focus(); } }); })),
          h("form", { class: "form", onsubmit: function (ev) {
            ev.preventDefault(); err.textContent = ""; add.disabled = true;
            A.call("sv_agent", { p_op: "expense_save", p_args: { name: name.value, category: cat.value, kind: kind.value, amount: Number(amount.value), day: kind.value === "once" ? day.value || null : null } })
              .then(function () { SV.toast("Расход добавлен. Агенты учтут его в следующем расчёте"); SV.dispatch(); }, function (e) { add.disabled = false; err.textContent = e.message; });
          } }, h("label", null, "Название", name), h("div", { class: "row" }, h("label", null, "Категория", cat), h("label", null, "Как считать", kind)),
            h("div", { class: "row" }, h("label", null, "Сумма", amount), day), err, add)),
        h("section", { class: "card form" }, h("h2", { text: "Цели и настройки агентов" }),
          pref("food_cost_target", "Целевой фудкост", "выше цели — агент «Финансы» предупредит"),
          pref("labor_target", "Целевая доля ФОТ", "доля зарплат в выручке"),
          pref("price_alert", "Порог подорожания", "агент «Закупки» сообщит, если цена выросла больше"),
          sw("purchases", "Следить за накладными и ценами поставщиков"),
          sw("daily_tips", "Совет управляющего в утреннем отчёте"),
          sw("weekly_tg", "Итоги недели и план в Telegram по понедельникам"),
          h("p", { class: "small muted", text: "После изменения расходов нажмите «Пересчитать неделю» в разделе «Агенты», чтобы увидеть прибыль сразу." }))));
  }
})();
