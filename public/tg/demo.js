(function () {
  if (!window.SV_DEMO) return;
  var demo = window.SV_DEMO;
  var plan = demo === "expired"
    ? { plan: null, status: "expired", plans: [] }
    : { plan: "kontrol", status: "active", paid_until: "2026-01-12", plans: [{ code: "kontrol", name: "Сводка" }] };
  var me = {
    email: "egor@example.test",
    name: "Егор",
    conn: { mode: "demo", auto: true, selected: [{ id: "soul", name: "Soul" }], has_password: true, base_url: "", login: "" },
    tg: { bound: true, title: "Управляющие", bound_at: "2026-11-20T06:00:00Z" },
    tg_login: { bound: demo !== "link" && demo !== "login", username: "rundego", first_name: "Егор", bound_at: "2026-11-26T08:00:00Z" },
    reports: [{ id: 101, day: "2026-11-25", dept_key: "all", created_at: "2026-11-26T03:00:00Z", demo: true, revenue: 186400, orders: 142, avg: 1313, flags: 1 }]
  };
  var devices = {
    bound: true, username: "rundego", recent: true, bound_at: "2026-11-26T08:00:00Z",
    devices: [
      { id: "11111111-1111-1111-1111-111111111111", kind: "tg", label: "iPhone · Telegram", created_at: "2026-11-26T08:00:00Z", last_used_at: "2026-11-26T12:00:00Z", current: true },
      { id: "22222222-2222-2222-2222-222222222222", kind: "web", label: "Chrome · Windows", created_at: "2026-11-20T09:00:00Z", last_used_at: "2026-11-25T18:00:00Z", current: false }
    ]
  };
  var realFetch = window.fetch;
  window.fetch = function (url, opt) {
    var u = String(url);
    if (demo === "browser") return realFetch.apply(this, arguments);
    function ok(body, status) {
      return Promise.resolve({ ok: !status || status < 400, status: status || 200, json: function () { return Promise.resolve(body); }, text: function () { return Promise.resolve(JSON.stringify(body)); } });
    }
    if (u.indexOf("/api/tg/auth") >= 0) {
      if (demo === "refresh") return ok({ error: "EXPIRED" }, 401);
      if (demo === "link" || demo === "login") return ok({ need_link: true, tg: { first_name: "Егор" } });
      return ok({ token: "demo-access-token", me: { email: me.email, name: me.name, tg: { username: "rundego", first_name: "Егор" } } });
    }
    if (u.indexOf("/api/tg/link") >= 0 || u.indexOf("/api/tg/login") >= 0) {
      return ok({ token: "demo-access-token", me: { email: me.email, name: me.name, tg: { username: "rundego", first_name: "Егор" } } });
    }
    if (u.indexOf("/api/auth/devices") >= 0 && u.indexOf("/end") < 0) return ok(devices);
    if (u.indexOf("/api/auth/") >= 0 || u.indexOf("/api/tg/") >= 0) return ok({ ok: true, token: "demo-access-token", email: me.email, name: me.name });
    if (u.indexOf("/rest/v1/rpc/") >= 0) {
      var fn = u.split("/rpc/")[1];
      if (fn === "sv_me") return ok(me);
      if (fn === "sv_plan") return ok(plan);
      if (fn === "sv_agent") return ok({ prefs: {} });
      if (fn === "sv_report_get") return ok({ id: 101, day: "2026-11-25", data: { demo: true, totals: { revenue: 186400, orders: 142, avg_check: 1313, guests: 160, avg_guest: 1165, discount: 0, deleted_sum: 0 }, pay: [], hours: [], flags: [], waiters: [], deletions: [] } });
      return ok({ ok: true });
    }
    return realFetch.apply(this, arguments);
  };
})();
