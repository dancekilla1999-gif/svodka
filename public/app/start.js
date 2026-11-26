try {
  var gate = window.SV_TG_GATE || Promise.resolve();
  gate.then(function () {
    if (window.SV_TG_BLOCK) return;
    if (!window.SV) {
      if (window.__svBootError) window.__svBootError("Кабинет не загрузился. Обновите страницу.");
      return;
    }
    var ready = SV.sessionReady ? SV.sessionReady() : Promise.resolve();
    ready.then(function () {
      if (window.SV_TG && SV.bootTelegram) SV.bootTelegram();
      else SV.dispatch();
    });
  }).catch(function (e) {
    if (window.SV && SV.fatal) SV.fatal(e);
    else if (window.__svBootError) window.__svBootError(e && e.message);
  });
} catch (e) {
  if (window.SV && SV.fatal) SV.fatal(e);
  else if (window.__svBootError) window.__svBootError(e && e.message);
}
