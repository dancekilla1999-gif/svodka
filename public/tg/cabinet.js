(function () {
  var SV = window.SV;
  if (!SV || !SV.tg) return;
  var h = SV.h;
  var CONSENT = "2026-11-26.3";

  function wa() { return window.Telegram && Telegram.WebApp; }
  function applyTheme() {
    var w = wa();
    if (!w || !w.themeParams) return;
    var t = w.themeParams;
    var root = document.documentElement;
    if (t.bg_color) root.style.setProperty("--bg", t.bg_color);
    if (t.secondary_bg_color) root.style.setProperty("--surface", t.secondary_bg_color);
    if (t.text_color) root.style.setProperty("--ink", t.text_color);
    if (t.hint_color) root.style.setProperty("--muted", t.hint_color);
    if (t.button_color) root.style.setProperty("--accent", t.button_color);
    if (w.setHeaderColor && t.bg_color) { try { w.setHeaderColor(t.bg_color); } catch (e) {} }
    if (w.setBackgroundColor && t.bg_color) { try { w.setBackgroundColor(t.bg_color); } catch (e) {} }
    ["--tg-viewport-stable-height", "--tg-safe-area-inset-top", "--tg-safe-area-inset-bottom", "--tg-content-safe-area-inset-top", "--tg-content-safe-area-inset-bottom", "--tg-content-safe-area-inset-left", "--tg-content-safe-area-inset-right"].forEach(function (name) {
      var css = name.replace("--tg-", "").replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
    });
    if (w.viewportStableHeight) root.style.setProperty("--tg-viewport-stable-height", w.viewportStableHeight + "px");
  }
  function deviceId() {
    return new Promise(function (resolve) {
      var id = "";
      try { id = localStorage.getItem("sv_device_id") || ""; } catch (e) { id = ""; }
      if (!id) {
        var bytes = new Uint8Array(16);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
        id = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
        try { localStorage.setItem("sv_device_id", id); } catch (e2) {}
      }
      resolve(id);
    });
  }
  function saveToken(token) {
    SV.session.access = token;
    var w = wa();
    var ss = w && w.SecureStorage;
    if (ss && ss.setItem) { try { ss.setItem("sv_access", token, function () {}); } catch (e) {} }
  }
  function shell(node) {
    SV.mount(h("main", { class: "page narrow tg-open" }, node));
  }
  function consentBox(onOk) {
    var box = h("input", { type: "checkbox", id: "tg_consent" });
    var btn = h("button", { class: "btn primary wide", type: "button", text: onOk.label, disabled: true });
    box.addEventListener("change", function () { btn.disabled = !box.checked; });
    btn.addEventListener("click", function () {
      if (!box.checked) return;
      btn.disabled = true;
      onOk.run(true).catch(function (e) { btn.disabled = false; SV.toast(e.message, "bad"); });
    });
    return h("div", { class: "card form" },
      h("h1", { text: onOk.title }),
      h("p", { class: "small muted", text: "Проще: на сайте в Настройках нажмите «Привязать Telegram»." }),
      h("label", { class: "tg-check", for: "tg_consent" }, box, h("span", null, "Согласен на обработку моего Telegram ID, имени и username для входа без пароля. ", h("a", { href: "/legal/privacy", text: "Политика" }))),
      btn);
  }
  function updateScreen() {
    var w = wa();
    shell([
      h("h1", { text: "Обновите приложение" }),
      h("p", { text: "Мини-приложение открыто слишком долго. Закройте его и откройте снова — пароль не понадобится." }),
      h("button", { class: "btn primary", type: "button", text: "Закрыть", onclick: function () { if (w && w.close) w.close(); } })
    ]);
  }
  function enter(token, me) {
    saveToken(token);
    if (me) { SV.session.email = me.email || ""; SV.session.name = me.name || ""; }
    var start = (wa() && wa().initDataUnsafe && wa().initDataUnsafe.start_param) || "";
    if (start.indexOf("r_") === 0) SV.go("/r/" + start.slice(2));
    else SV.go("/home");
  }
  function authPayload(extra) {
    var w = wa();
    return deviceId().then(function (id) {
      return Object.assign({
        initData: (w && w.initData) || "",
        platform: (w && w.platform) || "",
        device_id: id
      }, extra || {});
    });
  }
  function showLink(code) {
    shell(consentBox({
      title: "Привязать Telegram",
      label: "Привязать",
      run: function () {
        return authPayload({ code: code, consent: true }).then(function (body) {
          return SV.authFetch("/api/tg/link", body).then(function (d) { enter(d.token, d.me); });
        });
      }
    }));
  }
  function showLogin() {
    var email = h("input", { type: "email", autocomplete: "username", required: true });
    var pass = h("input", { type: "password", autocomplete: "current-password", required: true });
    var box = h("input", { type: "checkbox", id: "tg_login_consent" });
    var err = h("p", { class: "form-err", role: "alert" });
    var btn = h("button", { class: "btn primary wide", type: "button", text: "Войти", disabled: true });
    box.addEventListener("change", function () { btn.disabled = !box.checked; });
    btn.addEventListener("click", function () {
      err.textContent = "";
      btn.disabled = true;
      authPayload({ email: email.value, password: pass.value, consent: true }).then(function (body) {
        return SV.authFetch("/api/tg/login", body);
      }).then(function (d) { enter(d.token, d.me); }, function (e) {
        btn.disabled = !box.checked;
        if (e.body && e.body.error === "EXPIRED") updateScreen();
        else err.textContent = e.message;
      });
    });
    var w = wa();
    shell(h("div", { class: "card form" },
      h("h1", { text: "Вход" }),
      h("p", { class: "small muted", text: "Проще: на сайте в Настройках нажмите «Привязать Telegram»." }),
      h("label", null, "Почта", email),
      h("label", null, "Пароль", pass),
      h("label", { class: "tg-check", for: "tg_login_consent" }, box, h("span", null, "Согласен на обработку моего Telegram ID, имени и username для входа без пароля. ", h("a", { href: "/legal/privacy", text: "Политика" }))),
      err, btn,
      h("p", { class: "small" }, h("button", { class: "btn ghost", type: "button", text: "Нет аккаунта? Зарегистрироваться на сайте", onclick: function () {
        var url = "/app/#/register";
        if (w && w.openLink) w.openLink(location.origin + url);
        else location.href = url;
      } }))));
  }
  SV.tgReauth = function () {
    return authPayload({}).then(function (body) {
      return SV.authFetch("/api/tg/auth", body).then(function (d) {
        if (d.need_link) { var start = (wa() && wa().initDataUnsafe.start_param) || ""; if (start.indexOf("l_") === 0) showLink(start.slice(2)); else showLogin(); throw Object.assign(new Error("Нет привязки"), { hint: "auth" }); }
        saveToken(d.token);
        return d;
      }, function (e) {
        if (e.body && e.body.error === "EXPIRED") updateScreen();
        throw e;
      });
    });
  };
  function chrome() {
    var w = wa();
    if (!w) return;
    applyTheme();
    if (w.BackButton) {
      w.BackButton.onClick(function () { history.back(); });
      var sync = function () {
        var path = (location.hash || "#/").replace(/^#/, "") || "/";
        var home = path === "/" || path === "/home" || path.indexOf("/home") === 0 && path.indexOf("/r/") !== 0;
        var nested = path.indexOf("/r/") === 0 || path === "/settings" || path === "/connect" || path === "/agents" || path === "/expenses";
        if (nested) w.BackButton.show(); else w.BackButton.hide();
        if (path.indexOf("/r/") === 0 || path === "/home") { try { w.disableVerticalSwipes(); } catch (e) {} }
      };
      window.addEventListener("hashchange", sync);
      sync();
    }
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("form, .card.form") && w.enableClosingConfirmation) { try { w.enableClosingConfirmation(); } catch (err) {} }
    });
    if (w.onEvent) w.onEvent("themeChanged", applyTheme);
  }
  SV.bootTelegram = function () {
    chrome();
    if (window.SV_DEMO === "link") { showLink("DEMOCODE"); return; }
    if (window.SV_DEMO === "login") { showLogin(); return; }
    if (window.SV_DEMO === "refresh") { updateScreen(); return; }
    authPayload({}).then(function (body) {
      return SV.authFetch("/api/tg/auth", body);
    }).then(function (d) {
      if (d.need_link) {
        var start = (wa() && wa().initDataUnsafe && wa().initDataUnsafe.start_param) || "";
        if (start.indexOf("l_") === 0) showLink(start.slice(2));
        else showLogin();
        return;
      }
      enter(d.token, d.me);
      if (window.SV_DEMO === "settings" || window.SV_DEMO === "expired") SV.go("/settings");
    }, function (e) {
      if (e.body && e.body.error === "EXPIRED") updateScreen();
      else shell(h("p", { text: e.message || "Не удалось войти" }));
    });
  };
  SV.tgConsentVersion = CONSENT;
})();
