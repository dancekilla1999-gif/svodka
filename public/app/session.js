/* Сессия кабинета: access только в памяти, refresh только в cookie. Токен в localStorage не хранится. */
(function () {
  "use strict";
  var SV = window.SV;
  if (!SV) return;
  SV.session = { access: "", email: "", name: "", touched: 0 };
  SV.tg = !!window.SV_TG;

  function profile() {
    if (!SV.session.email && !SV.session.name && !SV.session.access) return null;
    return { email: SV.session.email, name: SV.session.name, token: SV.session.access };
  }
  SV.profile = profile;

  SV.deviceLabel = function () {
    if (SV.tg && window.Telegram && Telegram.WebApp) {
      var p = Telegram.WebApp.platform || "";
      var map = { ios: "iPhone · Telegram", android: "Android · Telegram", tdesktop: "Telegram Desktop", macos: "macOS · Telegram", web: "Telegram Web", weba: "Telegram Web" };
      return map[p] || (p ? p + " · Telegram" : "Telegram");
    }
    var ua = navigator.userAgent || "";
    var os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "macOS" : "компьютер";
    var br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Браузер";
    return br + " · " + os;
  };

  function authFetch(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Authorization": SV.session.access ? "Bearer " + SV.session.access : ""
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        var err = new Error((d && d.error) || "Ошибка сервера");
        err.hint = d && d.hint;
        err.status = r.status;
        err.body = d;
        if (!r.ok) throw err;
        return d;
      });
    });
  }
  SV.authFetch = authFetch;

  SV.offline = function () {
    var t = document.getElementById("sv-offline");
    if (!t) {
      t = document.createElement("div");
      t.id = "sv-offline";
      t.className = "notice";
      t.setAttribute("role", "status");
      t.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:50";
      t.textContent = "Нет связи. Повторяем запрос, из аккаунта не выходим.";
      document.body.appendChild(t);
    }
    clearTimeout(t._t);
    t._t = setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 6000);
  };

  SV.showDisabled = function () {
    SV.mount(SV.h("main", { class: "page narrow" }, SV.h("div", { class: "card form", role: "alert" },
      SV.h("h1", { text: "Аккаунт отключён" }),
      SV.h("p", { text: "Вход закрыт. Если это ошибка, напишите тому, кто выдал доступ." }))));
  };

  SV.refresh = function () {
    if (SV.tg) return Promise.reject(Object.assign(new Error("Сессия закончилась"), { hint: "expired" }));
    return authFetch("/api/auth/refresh", {}).then(function (d) {
      if (d && d.token) {
        SV.session.access = d.token;
        if (d.email) SV.session.email = d.email;
        if (d.name) SV.session.name = d.name;
      }
      return d;
    });
  };

  function dropStoredToken() {
    try {
      var raw = localStorage.getItem("sv_owner");
      if (!raw) return null;
      localStorage.removeItem("sv_owner");
      var o = JSON.parse(raw);
      return o && o.token ? o.token : null;
    } catch (e) { return null; }
  }

  SV.sessionReady = function () {
    if (SV.tg) return Promise.resolve();
    var legacy = dropStoredToken();
    var job = legacy
      ? authFetch("/api/auth/migrate", { token: legacy, device_label: SV.deviceLabel() }).then(function (d) {
          if (d && d.token) { SV.session.access = d.token; SV.session.email = d.email || ""; SV.session.name = d.name || ""; }
        }, function () {})
      : SV.refresh().catch(function () {});
    return job;
  };

  var orig = SV.api;
  SV.api = function (fn, args) {
    function once() { return orig(fn, args); }
    return once().then(function (data) {
      if (SV.tg && SV.session.access && Date.now() - SV.session.touched > 600000 && fn !== "sv_session_touch") {
        SV.session.touched = Date.now();
        orig("sv_session_touch", { p_token: SV.session.access }).catch(function () {});
      }
      return data;
    }, function (e) {
      if (e.network || (e.status >= 500 && e.hint !== "disabled")) { SV.offline(); throw e; }
      if (e.hint === "disabled") { SV.showDisabled(); throw e; }
      if (e.hint === "expired" && !SV.tg) {
        return SV.refresh().then(function () {
          if (args) args.p_token = SV.session.access;
          return once();
        });
      }
      throw e;
    });
  };
})();
