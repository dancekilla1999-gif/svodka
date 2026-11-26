(function () {
  var shown = false;
  function bootError(msg) {
    var app = document.getElementById("app");
    if (!app || app.getAttribute("data-booted") === "1" || shown) return;
    shown = true;
    document.documentElement.style.background = "#100E1C";
    document.body.style.margin = "0";
    document.body.style.minHeight = "100vh";
    document.body.style.background = "#100E1C";
    app.textContent = "";
    app.setAttribute("role", "alert");
    var box = document.createElement("main");
    box.style.cssText = "max-width:28rem;margin:0;padding:28px 20px;color:#ECEAF5;font:16px/1.45 system-ui,sans-serif";
    var title = document.createElement("h1");
    title.textContent = "Отчёт не открылся";
    title.style.cssText = "font-size:1.35rem;margin:0 0 8px";
    var text = document.createElement("p");
    text.textContent = msg || "Не удалось загрузить кабинет. Проверьте интернет и попробуйте ещё раз.";
    text.style.cssText = "margin:0 0 16px;color:#ABA6C2";
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = "Повторить";
    button.style.cssText = "font:600 1rem system-ui,sans-serif;min-height:44px;padding:12px 18px;border-radius:8px;border:0;background:#ECEAF5;color:#100E1C;cursor:pointer";
    button.addEventListener("click", function () { location.reload(); });
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(button);
    app.appendChild(box);
  }
  window.__svBootError = bootError;
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "SCRIPT") bootError("Не удалось загрузить кабинет. Проверьте интернет и попробуйте ещё раз.");
  }, true);
  setTimeout(function () {
    var app = document.getElementById("app");
    if (window.SV_TG_BLOCK) return;
    if (!window.SV || !app || app.getAttribute("data-booted") !== "1") bootError("Страница слишком долго открывается. Проверьте интернет и попробуйте ещё раз.");
  }, 15000);
})();
