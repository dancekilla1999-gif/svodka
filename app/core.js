/* «Сводка» — ядро: API, DOM-помощники, роутер, форматирование, QR. */
(function () {
  "use strict";

  var CFG = {
    url: "https://qozyihhlocvgpkchyqsp.supabase.co",
    key: "sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov"
  };
    var SV = window.SV = { cfg: CFG };

  // ------------------------------------------------------------ хранилище (с запасным вариантом в памяти)
  var mem = {};
  SV.store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v === null ? (mem[k] || null) : v; } catch (e) { return mem[k] || null; } },
    set: function (k, v) {
      if (v == null) { delete mem[k]; } else { mem[k] = v; }
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* приватный режим */ }
    }
  };

  // ------------------------------------------------------------ API
  SV.api = function (fn, args) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
    return fetch(CFG.url + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { "apikey": CFG.key, "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.text().then(function (txt) {
        clearTimeout(timer);
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var err = new Error((data && data.message) || ("Ошибка сервера (" + r.status + ")"));
          err.hint = data && data.hint;
          err.status = r.status;
          throw err;
        }
        return data;
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error(e && e.name === "AbortError" ? "Сервер не отвечает. Проверьте интернет и попробуйте ещё раз" : "Нет связи с сервером. Проверьте интернет");
      err.network = true;
      throw err;
    });
  };

  // серверные функции (iiko, Telegram)
  SV.fn = function (action, args) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);
    return fetch("/api/iiko", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action: action }, args || {})), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) {
        clearTimeout(timer);
        if (!r.ok) { var e = new Error(d.error || (r.status === 504 ? "iiko слишком долго отдаёт данные — попробуйте ещё раз через минуту" : "Ошибка сервера (" + r.status + ")")); e.hint = d.hint; e.status = r.status; throw e; }
        return d;
      }); }, function (e) { clearTimeout(timer); var err = new Error(e && e.name === "AbortError" ? "Сервер iiko отвечает слишком долго" : "Нет связи с сервером"); err.network = true; throw err; });
  };

  // ------------------------------------------------------------ DOM
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    if (typeof c === "string" || typeof c === "number") { el.appendChild(document.createTextNode(String(c))); return; }
    el.appendChild(c);
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "style") el.style.cssText = v;
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  SV.h = h;
  SV.add = add;

  SV.mount = function (node) {
    var root = document.getElementById("app");
    root.textContent = "";
    add(root, node);
    window.scrollTo(0, 0);
  };

  SV.loading = function (text) {
    return h("div", { class: "loading", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text || "Загружаю…");
  };

  var toastTimer = null;
  SV.toast = function (text, kind) {
    var t = document.getElementById("toast");
    if (!t) { t = h("div", { id: "toast", role: "status", "aria-live": "polite" }); document.body.appendChild(t); }
    t.textContent = text;
    t.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    t.onclick = function () { t.className = ""; };
    toastTimer = setTimeout(function () { t.className = ""; }, kind === "bad" ? 12000 : 3500);
  };

  // модальное окно; content — узел, actions — [{text, kind, onclick}]
  SV.modal = function (title, content, actions) {
    var back = h("div", { class: "modal-back", role: "dialog", "aria-modal": "true", "aria-label": title });
    function close() { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    var box = h("div", { class: "modal" },
      h("div", { class: "modal-head" }, h("h2", { text: title }), h("button", { class: "icon-btn", "aria-label": "Закрыть", onclick: close, text: "×" })),
      h("div", { class: "modal-body" }, content),
      actions && actions.length ? h("div", { class: "modal-actions" }, actions.map(function (a) {
        return h("button", { class: "btn " + (a.kind || ""), type: "button", onclick: function () { var r = a.onclick ? a.onclick(close) : null; if (r !== false && !a.keep) close(); }, text: a.text });
      })) : null);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    back.appendChild(box);
    document.body.appendChild(back);
    document.addEventListener("keydown", onKey);
    var f = box.querySelector("input, textarea, select, .btn.primary");
    if (f) setTimeout(function () { f.focus(); }, 30);
    return close;
  };

  SV.confirm = function (title, text, okText, onOk, danger) {
    SV.modal(title, h("p", { text: text }), [
      { text: "Отмена", kind: "ghost" },
      { text: okText || "Да", kind: danger ? "danger" : "primary", onclick: function () { onOk(); } }
    ]);
  };

  SV.copy = function (text) {
    function fallback() {
      var ta = h("textarea", { style: "position:fixed;left:-9999px;top:0", value: text });
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      SV.toast(ok ? "Скопировано" : "Не удалось скопировать — выделите текст вручную", ok ? "" : "bad");
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { SV.toast("Скопировано"); }, fallback);
    } else { fallback(); }
  };

  // ------------------------------------------------------------ роутер
  var routes = [];
  SV.route = function (pattern, handler) {
    var keys = [];
    var re = new RegExp("^" + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return "([^/]+)"; }) + "/?$");
    routes.push({ re: re, keys: keys, handler: handler });
  };
  SV.go = function (path) {
    if (location.hash === "#" + path) SV.dispatch(); else location.hash = "#" + path;
  };
  SV.path = function () { return location.hash.replace(/^#/, "") || "/"; };
  SV.dispatch = function () {
    var path = SV.path();
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].re);
      if (m) {
        var params = {};
        routes[i].keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
        try { routes[i].handler(params); } catch (e) { SV.fatal(e); }
        return;
      }
    }
    SV.go("/");
  };
  window.addEventListener("hashchange", function () { SV.dispatch(); });

  SV.fatal = function (e) {
    if (window.console) console.error(e);
    SV.mount(h("main", { class: "page narrow" }, h("div", { class: "card" },
      h("h1", { text: "Что-то пошло не так" }),
      h("p", { class: "muted", text: (e && e.message) || "Неизвестная ошибка" }),
      h("button", { class: "btn primary", onclick: function () { location.reload(); }, text: "Обновить страницу" }))));
  };


  SV.fmtPrice = function (n) {
    if (n == null || n === "" || isNaN(Number(n))) return "";
    var v = Number(n);
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: v % 1 ? 2 : 0 }).format(v) + " ₽";
  };
  SV.fmtDate = function (iso, withTime) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    var o = { day: "numeric", month: "short" };
    if (withTime) { o.hour = "2-digit"; o.minute = "2-digit"; }
    return d.toLocaleString("ru-RU", o);
  };
  SV.ago = function (iso) {
    if (!iso) return "ещё не заходил";
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return "только что";
    if (diff < 86400) return "сегодня";
    if (diff < 2 * 86400) return "вчера";
    return Math.floor(diff / 86400) + " дн. назад";
  };
  SV.plural = function (n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };
  SV.shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };

  // ------------------------------------------------------------ QR-код (байтовый режим, уровень M, версии 1–10)
  var QR_DATA = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
  var QR_EC = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var QR_BLOCKS = [[1, 16, 0], [1, 28, 0], [1, 44, 0], [2, 32, 0], [2, 43, 0], [4, 27, 0], [4, 31, 0], [2, 38, 2], [3, 36, 2], [4, 43, 1]];
  var QR_ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var k = 0; k < deg; k++) {
      for (var j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }
  SV.qr = function (text) {
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(text));
    var ver = 0;
    for (var v = 1; v <= 10; v++) {
      var ccBits = v < 10 ? 8 : 16;
      if (4 + ccBits + 8 * bytes.length <= QR_DATA[v - 1] * 8) { ver = v; break; }
    }
    if (!ver) return null;
    var bits = [];
    function put(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var capBits = QR_DATA[ver - 1] * 8;
    put(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (var pad = 0xEC; data.length < QR_DATA[ver - 1]; pad ^= 0xEC ^ 0x11) data.push(pad);
    // блоки и коррекция ошибок
    var spec = QR_BLOCKS[ver - 1], ecLen = QR_EC[ver - 1], div = rsDivisor(ecLen);
    var blocks = [], pos = 0;
    for (var g = 0; g < spec[0] + spec[2]; g++) {
      var len = spec[1] + (g >= spec[0] ? 1 : 0);
      var d = data.slice(pos, pos + len); pos += len;
      blocks.push({ d: d, e: rsRemainder(d, div) });
    }
    var all = [];
    var maxD = spec[1] + (spec[2] ? 1 : 0);
    for (var x = 0; x < maxD; x++) blocks.forEach(function (bl) { if (x < bl.d.length) all.push(bl.d[x]); });
    for (var y = 0; y < ecLen; y++) blocks.forEach(function (bl) { all.push(bl.e[y]); });
    // матрица
    var size = 17 + 4 * ver;
    var mod = [], fn = [];
    for (var r = 0; r < size; r++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setF(cx, cy, dark) { mod[cy][cx] = dark; fn[cy][cx] = true; }
    for (var t = 0; t < size; t++) { setF(6, t, t % 2 === 0); setF(t, 6, t % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) { var dist = Math.max(Math.abs(dx), Math.abs(dy)); setF(xx, yy, dist !== 2 && dist !== 4); }
      }
    });
    var al = QR_ALIGN[ver - 1], na = al.length;
    for (var ai = 0; ai < na; ai++) for (var aj = 0; aj < na; aj++) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === na - 1) || (ai === na - 1 && aj === 0)) continue;
      for (var ey = -2; ey <= 2; ey++) for (var ex = -2; ex <= 2; ex++) setF(al[ai] + ex, al[aj] + ey, Math.max(Math.abs(ex), Math.abs(ey)) !== 1);
    }
    function drawFormat(mask) {
      var dat = (0 << 3) | mask, rem = dat; // уровень M = 00
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((dat << 10) | rem) ^ 0x5412;
      function bit(n) { return ((fb >>> n) & 1) !== 0; }
      for (var k1 = 0; k1 <= 5; k1++) setF(8, k1, bit(k1));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (var k2 = 9; k2 < 15; k2++) setF(14 - k2, 8, bit(k2));
      for (var k3 = 0; k3 < 8; k3++) setF(size - 1 - k3, 8, bit(k3));
      for (var k4 = 8; k4 < 15; k4++) setF(8, size - 15 + k4, bit(k4));
      setF(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var vr = ver;
      for (var k5 = 0; k5 < 12; k5++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1F25);
      var vb = (ver << 12) | vr;
      for (var k6 = 0; k6 < 18; k6++) {
        var on = ((vb >>> k6) & 1) !== 0, a = size - 11 + k6 % 3, bb = Math.floor(k6 / 3);
        setF(a, bb, on); setF(bb, a, on);
      }
    }
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var jj = 0; jj < 2; jj++) {
        var cx = right - jj, up = ((right + 1) & 2) === 0, cy = up ? size - 1 - vert : vert;
        if (!fn[cy][cx] && bi < all.length * 8) { mod[cy][cx] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    function maskOn(m, mx, my) {
      switch (m) {
        case 0: return (mx + my) % 2 === 0;
        case 1: return my % 2 === 0;
        case 2: return mx % 3 === 0;
        case 3: return (mx + my) % 3 === 0;
        case 4: return (Math.floor(mx / 3) + Math.floor(my / 2)) % 2 === 0;
        case 5: return (mx * my) % 2 + (mx * my) % 3 === 0;
        case 6: return ((mx * my) % 2 + (mx * my) % 3) % 2 === 0;
        default: return ((mx + my) % 2 + (mx * my) % 3) % 2 === 0;
      }
    }
    function applyMask(m) { for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (!fn[yy][xx] && maskOn(m, xx, yy)) mod[yy][xx] = !mod[yy][xx]; }
    function penalty() {
      var p = 0, dark = 0;
      for (var yy = 0; yy < size; yy++) {
        var runR = 1, runC = 1;
        for (var xx = 0; xx < size; xx++) {
          if (mod[yy][xx]) dark++;
          if (xx > 0) {
            if (mod[yy][xx] === mod[yy][xx - 1]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
            if (mod[xx][yy] === mod[xx - 1][yy]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
          }
          if (xx > 0 && yy > 0) {
            var c0 = mod[yy][xx];
            if (c0 === mod[yy][xx - 1] && c0 === mod[yy - 1][xx] && c0 === mod[yy - 1][xx - 1]) p += 3;
          }
        }
      }
      var total = size * size;
      p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return p;
    }
    var best = 0, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size: size, modules: mod };
  };
  SV.qrSvg = function (text, px) {
    var q = SV.qr(text);
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    if (!q) return svg;
    var n = q.size + 8;
    svg.setAttribute("viewBox", "0 0 " + n + " " + n);
    svg.setAttribute("width", px || 200);
    svg.setAttribute("height", px || 200);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR-код ссылки");
    svg.setAttribute("shape-rendering", "crispEdges");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", n); bg.setAttribute("height", n); bg.setAttribute("fill", "#fff");
    svg.appendChild(bg);
    var d = "";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) d += "M" + (x + 4) + "," + (y + 4) + "h1v1h-1z";
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d); path.setAttribute("fill", "#000");
    svg.appendChild(path);
    return svg;
  };
})();
