/* «Трио» — выбор тарифа и пробный период в кабинетах Подачи, Журналки и Сводки.
   Подключается до dispatch() приложения. Настройки — data-атрибутами тега <script>:
   data-product="pd|zh|sv"  data-store="ключ localStorage"  data-field="поле с токеном (если там JSON)"
   data-owner="регэксп маршрутов владельца"  data-name="название сервиса" */
(function () {
  "use strict";
  var me = document.currentScript;
  var C = {
    product: me.getAttribute("data-product"),
    store: me.getAttribute("data-store"),
    field: me.getAttribute("data-field") || "",
    owner: new RegExp(me.getAttribute("data-owner") || "^/o(/|$)"),
    name: me.getAttribute("data-name") || "",
    url: "https://qozyihhlocvgpkchyqsp.supabase.co",
    key: "sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov",
    trio: "https://trio-resto-egor12.vercel.app/trio",
    site: "https://trio-resto-egor12.vercel.app",
    pay: "https://trio-resto-egor12.vercel.app/api/pay"
  };
  var PICK = "trio_plan_" + C.product;
  var paidReturn = 0, payOn = null;
  function payStatus() {
    if (payOn !== null) return Promise.resolve(payOn);
    return fetch(C.pay, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) })
      .then(function (r) { return r.json(); }).then(function (d) { payOn = !!(d && d.enabled); return payOn; }).catch(function () { payOn = false; return false; });
  }
  function startPay(plan, btn, out) {
    btn.disabled = true; out.textContent = "Готовим оплату…";
    fetch(C.pay, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", product: C.product, token: token(), plan: plan }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.url) { location.href = d.url; return; } out.textContent = (d && d.error) || "Не получилось создать платёж"; btn.disabled = false; })
      .catch(function () { out.textContent = "Нет связи с сервером оплаты. Попробуйте ещё раз."; btn.disabled = false; });
  }
  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function token() {
    var v = sget(C.store); if (!v) return null;
    if (!C.field) return v;
    try { var o = JSON.parse(v); return o && o[C.field]; } catch (e) { return null; }
  }
  function path() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }
  function rub(n) { return new Intl.NumberFormat("ru-RU").format(n) + " ₽"; }
  function date(s) { try { return new Date(s).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }); } catch (e) { return ""; } }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
    return e;
  }
  function api(fn, args) {
    return fetch(C.url + "/rest/v1/rpc/" + C.product + "_" + fn, { method: "POST", headers: { apikey: C.key, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) })
      .then(function (r) { return r.json().catch(function () { return null; }).then(function (d) { if (!r.ok) { var e = new Error((d && d.message) || "Ошибка сервера"); e.hint = d && d.hint; throw e; } return d; }); });
  }

  // ?plan=код в адресе (#/register?plan=kuhnya) — запоминаем выбор и убираем из адреса, чтобы роутер приложения его не видел
  (function () {
    var m = location.hash.match(/[?&]plan=([a-z0-9_-]+)/i);
    if (m) sset(PICK, m[1]);
    if (/[?&]paid=1/.test(location.hash)) paidReturn = Date.now();
    if (location.hash.indexOf("?") >= 0) { try { history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/\?.*$/, "")); } catch (e) {} }
  })();

  // список тарифов без входа: берём из кеша либо из встроенного запасного списка
  var FALLBACK = {
    pd: [{ code: "base", name: "Подача", price: 1990, main: true, features: ["1 заведение, до 15 сотрудников", "Обучение по вашему меню и ИИ-гость", "5 ИИ-агентов и отчёт в Telegram"] }],
    zh: [{ code: "tochka", name: "Точка", price: 1990, features: ["1 точка, до 15 сотрудников", "Все 6 журналов, печать и PDF", "Агент-санинспектор каждое утро"] },
         { code: "kuhnya", name: "Кухня", price: 2990, main: true, features: ["До 40 сотрудников", "Все 5 агентов санконтроля", "Готовность к проверке и Telegram"] },
         { code: "set", name: "Сеть", price: 4990, features: ["До 3 точек", "Сводка по всем точкам", "Помощь с запуском"] }],
    sv: [{ code: "smena", name: "Смена", price: 1990, features: ["1 точка", "Отчёт в Telegram каждое утро", "Агенты «Смена» и «Закупки»"] },
         { code: "kontrol", name: "Контроль", price: 2990, main: true, features: ["1 точка", "Все 6 ИИ-агентов", "Финансы, персонал, меню, ИИ-управляющий"] },
         { code: "set", name: "Сеть", price: 4990, features: ["До 5 точек", "Сравнение точек", "Помощь с подключением"] }]
  };
  function plans() { try { var c = JSON.parse(sget("trio_plans_" + C.product) || "null"); if (c && c.length) return c; } catch (e) {} return FALLBACK[C.product] || []; }
  function defaultPlan(list) { var p = sget(PICK); if (p && list.some(function (x) { return x.code === p; })) return p; var m = list.filter(function (x) { return x.main; })[0]; return (m || list[0] || {}).code; }

  function picker(list, current, onpick) {
    var fs = el("fieldset");
    list.forEach(function (p) {
      var inp = el("input", { type: "radio", name: "tb_plan", value: p.code });
      if (p.code === current) inp.checked = true;
      var lab = el("label", { class: "tb-plan" + (p.code === current ? " sel" : "") }, inp, el("b", { text: p.name }), el("span", { class: "tb-price", text: rub(p.price) + "/мес" }),
        el("span", { class: "tb-feat", text: (p.features || []).join(" · ") }), p.main && list.length > 1 ? el("span", { class: "tb-hit", text: "Популярный" }) : null);
      inp.addEventListener("change", function () { fs.querySelectorAll(".tb-plan").forEach(function (x) { x.classList.remove("sel"); }); lab.classList.add("sel"); onpick(p.code); });
      fs.appendChild(lab);
    });
    return el("div", { class: "tb-plans" }, el("legend", { text: list.length > 1 ? "Тариф" : "Ваш тариф" }), fs);
  }
  function trioLink() { return el("a", { class: "tb-trio", href: C.trio, target: "_blank", rel: "noopener" }, el("span", { text: "Нужны все три сервиса — обучение, журналы и отчёты из iiko?" }), el("b", { text: "Пакет «Трио» 5 990 ₽ →" })); }

  // ---------- регистрация: добавляем выбор тарифа в форму
  function enhanceRegister() {
    if (path() !== "/register") return;
    var form = document.querySelector("#app form"); if (!form || form.querySelector(".tb-plans")) return;
    var btn = form.querySelector("button[type=submit]"); if (!btn) return;
    var list = plans(); var cur = defaultPlan(list); sset(PICK, cur);
    var box = picker(list, cur, function (code) { sset(PICK, code); });
    btn.parentNode.insertBefore(box, btn.previousElementSibling && btn.previousElementSibling.getAttribute("role") === "alert" ? btn.previousElementSibling : btn);
    var agree = el("input", { type: "checkbox", id: "tb_agree" });
    var lab = el("label", { class: "tb-agree", for: "tb_agree" }, agree, el("span", null, "Принимаю ",
      el("a", { href: C.site + "/offer", target: "_blank", rel: "noopener", text: "оферту" }), " и даю ",
      el("a", { href: C.site + "/consent", target: "_blank", rel: "noopener", text: "согласие на обработку персональных данных" }), " по ",
      el("a", { href: C.site + "/privacy", target: "_blank", rel: "noopener", text: "политике" })));
    btn.parentNode.insertBefore(lab, btn);
    btn.parentNode.insertBefore(el("p", { class: "tb-note", text: "7 дней бесплатно, карта не нужна. Тариф можно поменять в любой момент." }), btn.nextSibling);
    if (btn.textContent.indexOf("7 дн") < 0) btn.textContent = "Создать аккаунт — 7 дней бесплатно";
  }

  // ---------- кабинет: тариф выбран? показываем плашку; не выбран — сначала выбор
  var state = null, loading = false, lastTok = null, pill = null;
  function refresh() {
    var t = token();
    if (!t || !C.owner.test(path())) { if (pill) { pill.remove(); pill = null; } return; }
    if (loading) return;
    if (state && lastTok === t) { drawPill(); return; }
    loading = true; lastTok = t;
    api("plan", { p_token: t }).then(function (s) {
      loading = false; state = s;
      if (s && s.plans) sset("trio_plans_" + C.product, JSON.stringify(s.plans));
      if (!s.plan) {
        if (s.plans.length === 1) return choose(s.plans[0].code, true);
        var want = sget(PICK);
        if (want && s.plans.some(function (p) { return p.code === want; })) return choose(want, true);
        return modal(true);
      }
      drawPill();
      if (paidReturn) {
        if (s.status === "active") { paidReturn = 0; notice("Оплата прошла — спасибо! Доступ продлён до " + date(s.paid_until)); }
        else if (Date.now() - paidReturn < 90000) { notice("Проверяем оплату…"); setTimeout(function () { state = null; refresh(); }, 4000); }
        else { paidReturn = 0; notice("Оплата ещё не подтвердилась. Если деньги списались — статус обновится в течение нескольких минут."); }
      }
    }).catch(function () { loading = false; state = null; });
  }
  function choose(code, silent) {
    return api("plan_set", { p_token: token(), p_plan: code }).then(function (s) { state = s; sset(PICK, code); drawPill(); if (!silent) close(); return s; });
  }
  function current() { var p = state && state.plans.filter(function (x) { return x.code === state.plan; })[0]; return p; }
  function statusText() {
    if (!state || !state.plan) return "";
    if (state.status === "active") return (state.bundle ? "Пакет «Трио» оплачен" : "Оплачено") + (state.paid_until ? " до " + date(state.paid_until) : "");
    if (state.status === "trial") return "Пробный период · осталось " + state.days_left + " дн. (до " + date(state.trial_until) + ")";
    return "Пробный период закончился — запросите счёт, чтобы продолжить";
  }
  function drawPill() {
    if (!state || !state.plan || !C.owner.test(path())) return;
    var p = current(); if (!p) return;
    var txt = (C.name && C.name !== p.name ? C.name + " · " : "") + p.name + " · " + (state.status === "trial" ? state.days_left + " дн. бесплатно" : state.status === "active" ? (state.bundle ? "пакет «Трио»" : "оплачен") : "нужна оплата");
    if (!pill) { pill = el("button", { type: "button", class: "tb-pill", onclick: function () { modal(false); } }); document.body.appendChild(pill); }
    pill.className = "tb-pill" + (state.status === "expired" ? " exp" : "");
    pill.textContent = ""; pill.appendChild(el("i")); pill.appendChild(document.createTextNode(txt));
  }
  var N = null;
  function notice(t) {
    if (!N) { N = el("div", { class: "tb-notice", role: "status" }); document.body.appendChild(N); }
    N.textContent = t; clearTimeout(N._t); N._t = setTimeout(function () { if (N) { N.remove(); N = null; } }, 7000);
  }
  var M = null;
  function close() { if (M) { M.remove(); M = null; } }
  function modal(first) {
    close();
    var list = (state && state.plans) || plans();
    var cur = (state && state.plan) || defaultPlan(list);
    var err = el("p", { class: "form-err", role: "alert" });
    var btn = el("button", { type: "button", class: "btn primary wide", text: first ? "Начать — 7 дней бесплатно" : "Сохранить тариф" });
    btn.addEventListener("click", function () { btn.disabled = true; err.textContent = ""; choose(cur).catch(function (e) { err.textContent = e.message; btn.disabled = false; }); });
    var box = el("div", { class: "card tb-box", role: "dialog", "aria-modal": "true", "aria-label": "Тариф" },
      el("span", { class: "label", text: C.name || "Тариф" }),
      el("h2", { text: first ? "Выберите тариф" : "Ваш тариф" }),
      !first ? el("div", { class: "tb-status" + (state.status === "expired" ? " exp" : ""), text: statusText() }) : el("p", { class: "muted small", text: "Первые 7 дней — бесплатно и со всеми функциями. Платить сейчас ничего не нужно." }),
      picker(list, cur, function (c) { cur = c; }), err, btn);
    if (!first) {
      var payBox = el("div", { class: "tb-pay" });
      box.appendChild(payBox);
      payStatus().then(function (on) {
        if (on) {
          var out = el("p", { class: "tb-note" });
          var one = el("button", { type: "button", class: "btn primary wide", text: "Оплатить месяц выбранного тарифа" });
          one.addEventListener("click", function () { startPay(cur, one, out); });
          var all = el("button", { type: "button", class: "btn wide", text: "Оплатить пакет «Трио» — 5 990 ₽ за все три сервиса" });
          all.addEventListener("click", function () { startPay("trio", all, out); });
          payBox.appendChild(one); payBox.appendChild(all); payBox.appendChild(out);
          payBox.appendChild(el("p", { class: "tb-note" }, "Оплата через ЮKassa: карта, СБП, ЮMoney, SberPay. Автосписаний нет. ",
            el("a", { href: C.site + "/offer", target: "_blank", rel: "noopener", text: "Оферта" })));
        } else {
          var phone = el("input", { type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: "Телефон для связи (необязательно)", maxlength: "40" });
          var ok = el("p", { class: "tb-note" });
          var inv = el("button", { type: "button", class: "btn wide", text: "Запросить счёт на оплату" });
          inv.addEventListener("click", function () {
            inv.disabled = true; ok.textContent = "";
            api("invoice", { p_token: token(), p_phone: phone.value, p_comment: "" }).then(function () { ok.textContent = "Готово — пришлём счёт на почту аккаунта в течение рабочего дня."; })
              .catch(function (e) { ok.textContent = e.message; }).then(function () { inv.disabled = false; });
          });
          payBox.appendChild(el("div", { class: "tb-row" }, phone)); payBox.appendChild(inv); payBox.appendChild(ok);
        }
      });
      box.appendChild(el("button", { type: "button", class: "btn ghost wide", text: "Закрыть", onclick: close }));
    }
    box.appendChild(trioLink());
    M = el("div", { class: "tb-modal" }, box);
    if (!first) M.addEventListener("click", function (e) { if (e.target === M) close(); });
    document.body.appendChild(M);
    var r = box.querySelector("input[type=radio]:checked") || box.querySelector("button"); if (r) r.focus();
  }

  // без согласия форму регистрации не отправляем (перехват до обработчика приложения)
  document.addEventListener("submit", function (e) {
    if (path() !== "/register") return;
    var a = document.getElementById("tb_agree");
    if (a && !a.checked) {
      e.preventDefault(); e.stopImmediatePropagation();
      var lab = a.closest("label"); if (lab) { lab.classList.add("tb-need"); setTimeout(function () { lab.classList.remove("tb-need"); }, 1600); }
      a.focus();
    }
  }, true);

  // уведомление о cookies
  function cookieNote() {
    if (sget("trio_ck")) return;
    var b = el("button", { type: "button", text: "Понятно" });
    var box = el("div", { class: "tb-ck", role: "status" }, el("span", null, "Мы не используем рекламные cookies — только данные браузера, нужные для входа. ",
      el("a", { href: C.site + "/cookies", target: "_blank", rel: "noopener", text: "Подробнее" })), b);
    b.addEventListener("click", function () { sset("trio_ck", "1"); box.remove(); });
    document.body.appendChild(box);
  }

  function tick() { enhanceRegister(); refresh(); }
  window.addEventListener("hashchange", function () { setTimeout(tick, 30); });
  document.addEventListener("DOMContentLoaded", function () {
    var app = document.getElementById("app");
    if (app && window.MutationObserver) new MutationObserver(function () { enhanceRegister(); if (!loading) refresh(); }).observe(app, { childList: true });
    setTimeout(tick, 60);
    setTimeout(cookieNote, 1500);
  });
  window.TrioBill = { open: function () { modal(false); }, refresh: function () { state = null; refresh(); } };
})();
