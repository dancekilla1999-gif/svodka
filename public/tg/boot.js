(function () {
  window.SV_TG = true;
  window.SV_TG_GATE = new Promise(function (resolve) { window.SV_TG_DONE = resolve; });
  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = new URLSearchParams(); }
  var demo = params.get("demo") || "";
  window.SV_DEMO = demo;
  var theme = params.get("theme") || "";
  function paintTheme(dark) {
    var root = document.documentElement;
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.style.setProperty("--bg", dark ? "#100E1C" : "#F5F4F8");
    root.style.setProperty("--surface", dark ? "#1A1730" : "#FFFFFF");
    root.style.setProperty("--ink", dark ? "#ECEAF5" : "#1B1733");
    root.style.setProperty("--muted", dark ? "#ABA6C2" : "#5D5873");
    root.style.setProperty("--line", dark ? "#2E2A4A" : "#DCD8E6");
  }
  if (theme === "dark" || demo === "dark") paintTheme(true);
  else if (theme === "light" || demo) paintTheme(false);

  var settled = false;
  function done() { if (settled) return; settled = true; window.SV_TG_DONE(); }
  function paintOpen() {
    if (window.SV_TG_BLOCK) return;
    window.SV_TG_BLOCK = true;
    var app = document.getElementById("app");
    if (!app) return;
    app.setAttribute("data-booted", "1");
    app.textContent = "";
    var main = document.createElement("main");
    main.className = "page narrow tg-open";
    var h1 = document.createElement("h1");
    h1.textContent = "Откройте в Telegram";
    var p = document.createElement("p");
    p.textContent = "Кабинет «Сводки» в мини-приложении открывается только из Telegram. В обычном браузере запросов к серверу нет.";
    var open = document.createElement("a");
    open.className = "btn primary";
    open.textContent = "Открыть бота";
    open.href = "https://t.me/trio_svodka_bot/app";
    var site = document.createElement("a");
    site.className = "btn";
    site.textContent = "Войти на сайте";
    site.href = "/app/";
    main.appendChild(h1);
    main.appendChild(p);
    main.appendChild(open);
    main.appendChild(site);
    app.appendChild(main);
  }

  function finishReady() {
    var tg = window.Telegram && Telegram.WebApp;
    if (tg && tg.initData) { try { tg.ready(); tg.expand(); } catch (e) {} }
    else paintOpen();
    done();
  }
  if (!demo) {
    if (window.Telegram && Telegram.WebApp && Telegram.WebApp.initData) { finishReady(); return; }
    var s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js";
    s.onload = finishReady;
    s.onerror = function () { paintOpen(); done(); };
    document.head.appendChild(s);
    setTimeout(function () {
      if (window.SV_TG_BLOCK) return;
      if (!(window.Telegram && Telegram.WebApp && Telegram.WebApp.initData)) { paintOpen(); done(); }
    }, 2000);
    return;
  }

  var dark = demo === "dark";
  var start = demo === "link" ? "l_DEMOCODE" : (demo === "report" ? "r_101" : "");
  window.Telegram = window.Telegram || {};
  window.Telegram.WebApp = {
    initData: "demo=1",
    initDataUnsafe: { start_param: start, user: { id: 1, first_name: "Егор", username: "rundego" } },
    platform: "ios",
    colorScheme: dark ? "dark" : "light",
    themeParams: dark
      ? { bg_color: "#100E1C", secondary_bg_color: "#1A1730", text_color: "#ECEAF5", hint_color: "#ABA6C2", button_color: "#F2B33D", button_text_color: "#100E1C" }
      : { bg_color: "#F5F4F8", secondary_bg_color: "#FFFFFF", text_color: "#1B1733", hint_color: "#5D5873", button_color: "#B26B00", button_text_color: "#FFFFFF" },
    viewportStableHeight: 700,
    ready: function () {},
    expand: function () {},
    close: function () {},
    enableClosingConfirmation: function () {},
    disableClosingConfirmation: function () {},
    disableVerticalSwipes: function () {},
    setHeaderColor: function () {},
    setBackgroundColor: function () {},
    openLink: function (url) { window.open(url, "_blank", "noopener"); },
    openTelegramLink: function (url) { window.open(url, "_blank", "noopener"); },
    isVersionAtLeast: function () { return false; },
    BackButton: { show: function () {}, hide: function () {}, onClick: function (fn) { this._fn = fn; } },
    onEvent: function () {}
  };
  done();
})();
