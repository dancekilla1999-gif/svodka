/* «Трио» — встроенная помощь в кабинетах Подачи, Журналки и Сводки:
   кнопка «Помощь» с чек-листом запуска (прогресс считается сам по данным кабинета), пошаговые инструкции и ответы на частые вопросы,
   плюс короткие подсказки на экранах — их можно закрыть, и они больше не появятся.
   Подключение: <script src="guide.js" data-product="pd|zh|sv" data-store="ключ localStorage" data-field="поле с токеном"></script> */
(function () {
  "use strict";
  var me = document.currentScript;
  var P = me.getAttribute("data-product"), STORE = me.getAttribute("data-store"), FIELD = me.getAttribute("data-field") || "";
  var URL = "https://qozyihhlocvgpkchyqsp.supabase.co", KEY = "sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov";
  var LINKS = { pd: "https://podacha-egor12.vercel.app/app/", zh: "https://zhurnalka.vercel.app/app/", sv: "https://svodka-egor12.vercel.app/app/" };
  var NAMES = { pd: "Подача — обучение зала", zh: "Журналка — санжурналы", sv: "Сводка — отчёты и агенты по iiko" };

  function sget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function token() { var v = sget(STORE); if (!v) return null; if (!FIELD) return v; try { var o = JSON.parse(v); return o && o[FIELD]; } catch (e) { return null; } }
  function rpc(fn, args) {
    return fetch(URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify(args || {}) })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function el(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { var v = attrs[k]; if (v == null || v === false) return; if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null || c === false) continue; if (Array.isArray(c)) c.forEach(function (x) { if (x) e.appendChild(typeof x === "string" ? document.createTextNode(x) : x); }); else e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }
    return e;
  }
  function path() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }
  function isOwner() { return !!token() && !/^\/(s|join|code|u)(\/|$)/.test(path()) && !/^\/(login|register)?$/.test(path()); }

  // ------------------------------------------------------------------ содержание
  // шаг: { id, title, how: [строки инструкции], go: "#/путь" или функция(ctx), done: функция(ctx) }
  var G = {
    sv: {
      intro: "Сводка забирает данные из iiko и каждое утро присылает отчёт по смене. Шесть агентов следят за закупками, прибылью, персоналом и меню. Настройка — 15 минут вместе с управляющим.",
      load: function (t) { return Promise.all([rpc("sv_me", { p_token: t }), rpc("sv_agent", { p_token: t, p_op: "home", p_args: {} })]).then(function (r) { return { me: r[0] || {}, ag: r[1] || {} }; }); },
      steps: [
        { id: "user", title: "Создайте в iiko пользователя для Сводки", go: "#/connect",
          how: ["Откройте iikoOffice под администратором.", "Меню «Администрирование» → «Пользователи» (или «Сотрудники») → «Добавить».", "Логин, например, svodka, придумайте пароль.", "Права: просмотр отчётов (B_RPT), отчёты по продажам (B_CASR) и просмотр приходных накладных — для агента «Закупки». Больше ничего не нужно: Сводка только читает.", "Если iiko настраивает дилер — перешлите ему этот список."],
          done: function (c) { return c.me.conn && c.me.conn.mode === "iiko"; } },
        { id: "connect", title: "Подключите iiko в кабинете", go: "#/connect",
          how: ["Раздел «Настройки» → «Подключить iiko» (или кнопка на главной).", "Адрес сервера — тот же, по которому заходите в iikoOffice, обычно вида имя-co.iiko.it.", "Введите логин и пароль пользователя из шага 1 → «Проверить подключение».", "Отметьте точки, по которым нужен отчёт → «Сохранить». Пароль хранится зашифрованным."],
          done: function (c) { return c.me.conn && c.me.conn.mode === "iiko" && c.me.conn.has_password; } },
        { id: "report", title: "Сформируйте первый отчёт", go: "#/home",
          how: ["На главной выберите вчерашнюю дату → «Сформировать».", "Дальше отчёты строятся сами каждое утро в 6:00 по Москве.", "Хотите сначала посмотреть, как это выглядит? Включите демо — две недели вымышленного кафе."],
          done: function (c) { return (c.me.reports || []).length > 0; } },
        { id: "tg", title: "Подключите Telegram", go: "#/settings",
          how: ["«Настройки» → «Подключить Telegram» → откроется бот → нажмите «Старт».", "Для общего чата управляющих: добавьте бота в группу и отправьте в группу ссылку из кабинета.", "В этот же чат можно писать вопросы — отвечает ИИ-управляющий: «почему упала выручка?», «что подорожало?»."],
          done: function (c) { return c.me.tg && c.me.tg.bound; } },
        { id: "expenses", title: "Внесите расходы, которых нет в iiko", go: "#/expenses",
          how: ["Раздел «Расходы»: аренда, зарплаты (ФОТ), коммуналка — суммой в месяц.", "Эквайринг и налог УСН — процентом от выручки.", "Разовые траты (ремонт, закупка посуды) — с датой.", "Без расходов агенты считают только валовую прибыль, с ними — чистую по каждой смене и неделе."],
          done: function (c) { return (c.ag.expenses || []).length > 0; } },
        { id: "goals", title: "Задайте цели для агентов", go: "#/expenses",
          how: ["Там же, справа: целевой фудкост (обычно 28–35%), доля ФОТ (25–30%) и порог подорожания закупок (5%).", "Агенты предупредят, когда показатели выйдут за цели."],
          done: function (c) { return c.ag.prefs && Object.keys(c.ag.prefs).length > 0; } },
        { id: "agents", title: "Посмотрите выводы агентов и задайте вопрос", go: "#/agents",
          how: ["Раздел «Агенты» → «Пересчитать неделю».", "Наверху — план Управляющего на неделю, ниже — карточки агентов. Нажмите на карточку, чтобы увидеть подробности.", "Спросите в чате: «сколько заработали за неделю?» — ответ по вашим данным."],
          done: function (c) { return (c.ag.insights || []).some(function (i) { return i.agent === "director"; }); } }
      ],
      faq: [
        ["iiko пишет «заняты все слоты лицензии API»", "Отчёт занимает слот на несколько секунд. Если ошибка повторяется — попросите дилера iiko добавить слот API или освободить зависший."],
        ["Нет себестоимости и прибыли", "Себестоимость берётся из техкарт iiko. Проверьте, что техкарты заполнены и у пользователя Сводки есть право на отчёты с себестоимостью."],
        ["Агент «Закупки» молчит", "Нужны проведённые приходные накладные в iiko и право пользователя на их просмотр. Проверьте, что включено «Следить за накладными» в разделе «Расходы»."],
        ["Можно ли подключить несколько точек?", "Да: при подключении iiko отметьте все нужные точки. Тариф «Сеть» — до 5 точек."]
      ],
      tips: [
        [/^\/connect/, "Адрес сервера — тот же, что в iikoOffice при входе (обычно имя-co.iiko.it). Логин и пароль — отдельного пользователя только для чтения отчётов."],
        [/^\/expenses/, "Начните с аренды и зарплат — это обычно половина всех расходов. Проценты (эквайринг, налог) агенты посчитают сами от выручки."],
        [/^\/agents$/, "Здесь шесть агентов. Сверху — план Управляющего, ниже — спросите его о чём угодно или откройте любую карточку."]
      ]
    },
    zh: {
      intro: "Журналка заменяет бумажные санитарные журналы: сотрудники отмечаются с телефона по QR-коду, вы видите всё в кабинете и печатаете по форме СанПиН. Пять агентов каждое утро проверяют, что ничего не пропущено.",
      load: function (t) {
        return rpc("zh_me", { p_token: t }).then(function (me) {
          me = me || {}; var p = (me.points || [])[0];
          return Promise.all([p ? rpc("zh_point_get", { p_token: t, p_point: p.id }) : null, rpc("zh_agent", { p_token: t, p_op: "home", p_args: {} })]).then(function (r) { return { me: me, point: r[0], ag: r[1] || {} }; });
        });
      },
      steps: [
        { id: "point", title: "Создайте точку", go: "#/o/new",
          how: ["Название, адрес и юрлицо — они попадут в шапку печатных журналов.", "Если точек несколько — создайте каждую отдельно."],
          done: function (c) { return (c.me.points || []).length > 0; } },
        { id: "units", title: "Добавьте холодильники и склады", go: function (c) { return c.point ? "#/o/p/" + c.point.id + "/units" : "#/o"; },
          how: ["Вкладка «Оборудование» → выберите готовый шаблон (холодильник +2…+6°, морозилка −18…−25°, склад) или добавьте свой.", "Назовите так, чтобы повар узнал: «Холодильник у раздачи», «Морозилка мясо».", "Нормы температуры можно поправить — по ним агенты ловят отклонения."],
          done: function (c) { return c.point && (c.point.units || []).length > 0; } },
        { id: "qr", title: "Распечатайте и наклейте QR-коды", go: function (c) { return c.point ? "#/o/p/" + c.point.id + "/units/qr" : "#/o"; },
          how: ["«Оборудование» → «QR-наклейки» → печать.", "Наклейте на каждый холодильник и склад: сотрудник наводит камеру — сразу открывается запись температуры."],
          done: function (c) { return c.point && (c.point.units || []).length > 0 && sget("trio_guide_zh_qr") === "1"; }, manual: true },
        { id: "team", title: "Подключите сотрудников", go: function (c) { return c.point ? "#/o/p/" + c.point.id + "/team" : "#/o"; },
          how: ["Вкладка «Команда» → скопируйте ссылку-приглашение и отправьте в чат кухни, или распечатайте плакат с QR.", "Сотрудник открывает ссылку, пишет имя и должность — приложение готово, пароли не нужны.", "Отметьте ответственного за допуск к работе (обычно шеф или су-шеф): он подтверждает гигиенический журнал."],
          done: function (c) { return c.point && (c.point.staff || []).length > 0; } },
        { id: "med", title: "Внесите сроки медкнижек", go: function (c) { return c.point ? "#/o/p/" + c.point.id + "/team" : "#/o"; },
          how: ["«Команда» → нажмите на сотрудника → «Медкнижка до».", "Агент «Медкнижки» напомнит за месяц и за неделю до окончания."],
          done: function (c) { return c.point && (c.point.staff || []).length > 0 && (c.point.staff || []).every(function (s) { return !!s.med_until; }); } },
        { id: "first", title: "Первые записи в журналах", go: function (c) { return c.point ? "#/o/p/" + c.point.id : "#/o"; },
          how: ["Каждый сотрудник перед сменой отмечается в гигиеническом журнале — 10 секунд в телефоне.", "Температура — по QR-наклейке, утром и при необходимости вечером.", "На вкладке «Сегодня» видно, что заполнено, а что нет."],
          done: function (c) { var s = c.me.points && c.me.points[0] && c.me.points[0].status; return !!(s && s.counts && Object.keys(s.counts).length); } },
        { id: "agents", title: "Включите агентов и Telegram", go: "#/o/agents",
          how: ["Раздел «✦ Агенты» → «Проверить сейчас».", "Ниже — «Подключить» Telegram: каждое утро придёт список пропусков и напоминания по медкнижкам.", "Спросите шеф-контроль: «готовы ли мы к проверке?»."],
          done: function (c) { return (c.ag.insights || []).length > 0; } }
      ],
      faq: [
        ["Как распечатать журнал для проверки?", "Вкладка «Журналы» → выберите журнал и месяц → «Печать / PDF». Форма соответствует образцам СанПиН."],
        ["Сотрудник потерял ссылку", "«Команда» → нажмите на сотрудника → «Новая ссылка входа» и отправьте ему."],
        ["Запись сделали по ошибке", "Откройте журнал, нажмите на запись → «Аннулировать» с причиной. Исправления видны в истории, как в бумажном журнале."],
        ["Температура вне нормы — что делать?", "Запишите, какие меры приняли (перенесли продукты, вызвали мастера). Агент «Оборудование» подскажет, если отклонения повторяются."]
      ],
      tips: [
        [/^\/o\/p\/[^/]+\/units$/, "Совет: названия пишите так, как их зовут на кухне — «Холодильник у раздачи», а не «ХШ-1». Потом распечатайте QR-наклейки."],
        [/^\/o\/p\/[^/]+\/team$/, "Отправьте ссылку-приглашение в общий чат кухни — каждый подключится сам за минуту, без паролей."],
        [/^\/o\/agents$/, "Агенты проверяют журналы каждое утро. Подключите Telegram внизу страницы — пропуски будут приходить сами."]
      ]
    },
    pd: {
      intro: "Подача учит официантов, барменов и кальянщиков вашему меню: 5-минутная разминка перед сменой, ситуации из зала и тренажёр «ИИ-гость». Агенты следят, кто учится, и подсказывают, что подтянуть.",
      load: function (t) { return Promise.all([rpc("pd_owner_me", { p_token: t }), rpc("pd_agent", { p_token: t, p_op: "home", p_args: {} })]).then(function (r) { return { me: r[0] || {}, ag: r[1] || {} }; }); },
      steps: [
        { id: "venue", title: "Создайте заведение", go: "#/o/new",
          how: ["Название и тип: кафе, бар, кальянная или ресторан.", "Модули: сервис в зале, бар, кальян — от них зависят ситуации из зала."],
          done: function (c) { return (c.me.venues || []).length > 0; } },
        { id: "menu", title: "Загрузите меню", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/import" : "#/o"; },
          how: ["«Меню» → «Загрузить»: вставьте меню текстом или скопируйте из Excel/Google-таблицы — по строке на блюдо.", "Удобный формат: Название; категория; состав через запятую; цена; что предложить к блюду.", "Позиции можно добавить и вручную."],
          done: function (c) { var v = (c.me.venues || [])[0]; return v && v.items > 0; } },
        { id: "confirm", title: "Проверьте карточки и нажмите «Проверено»", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/menu" : "#/o"; },
          how: ["Проверьте состав и аллергены — подсказка покажет, если аллерген в составе не отмечен.", "Добавьте «что предложить к блюду» — это допродажа, официанты будут её учить.", "Сотрудники учат только проверенные позиции."],
          done: function (c) { var v = (c.me.venues || [])[0]; return v && v.confirmed > 0; } },
        { id: "team", title: "Подключите команду", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/team" : "#/o"; },
          how: ["«Команда» → скопируйте ссылку-приглашение и отправьте в чат зала (или покажите QR-код на планёрке).", "Сотрудник открывает ссылку, пишет имя и должность — и сразу проходит первую разминку. Пароли не нужны.", "Новичков отметьте «новичок» — у них трек обучения с целью 80% знания меню."],
          done: function (c) { var v = (c.me.venues || [])[0]; return v && v.staff > 0; } },
        { id: "routine", title: "Сделайте разминку ритуалом", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/report" : "#/o"; },
          how: ["Договоритесь: разминка — каждый день до начала смены, 5 минут.", "В разделе «Отчёт» видно, кто тренируется и какие блюда путают.", "Отмечайте лидеров недели перед командой — это работает лучше штрафов."],
          done: function (c) { return (c.ag.insights || []).some(function (i) { return i.agent === "coach"; }); } },
        { id: "guest", title: "Попробуйте «ИИ-гость»", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/try" : "#/o"; },
          how: ["В приложении сотрудника есть плитка «✦ ИИ-гость»: «гость» задаёт вопросы по вашему меню, в конце — оценка и разбор.", "Попросите каждого пройти один диалог на неделе."],
          done: function (c) { return sget("trio_guide_pd_guest") === "1"; }, manual: true },
        { id: "agents", title: "Агенты и Telegram", go: function (c) { var v = (c.me.venues || [])[0]; return v ? "#/o/v/" + v.id + "/agents" : "#/o"; },
          how: ["Вкладка «✦ Агенты» → «Проверить сейчас»: аналитик обучения, наставник, меню-контроль, ИИ-гость и управляющий залом.", "Подключите Telegram внизу страницы — по понедельникам придёт итог недели и план."],
          done: function (c) { return (c.ag.insights || []).length > 0; } }
      ],
      faq: [
        ["Сотрудник потерял доступ", "«Команда» → нажмите на сотрудника → «Новая личная ссылка» и отправьте ему."],
        ["Обновилось меню", "Загрузите новые позиции или поправьте карточки и снова нажмите «Проверено». Прогресс сотрудников по старым блюдам сохранится."],
        ["Сколько диалогов с ИИ-гостем?", "4 ИИ-диалога в месяц на сотрудника. Сверх лимита работает сценарный режим — он бесплатный и без ограничений."],
        ["Как понять, что новичок готов?", "В отчёте и у агента «Аналитик обучения» видна готовность по меню. 80% — можно ставить на самостоятельную смену."]
      ],
      tips: [
        [/^\/o\/v\/[^/]+\/import$/, "Быстрее всего — скопировать меню из таблицы: каждая строка — одно блюдо, состав через запятую."],
        [/^\/o\/v\/[^/]+\/team$/, "Отправьте ссылку-приглашение в чат зала — каждый подключится за минуту, без паролей."],
        [/^\/o\/v\/[^/]+\/agents$/, "Подключите Telegram внизу страницы — итоги недели и план будут приходить сами."]
      ]
    }
  };
  var C = G[P]; if (!C) return;

  // ------------------------------------------------------------------ панель помощи
  var css = ".tg-help{position:fixed;right:16px;bottom:16px;z-index:900;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-weight:600;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer}" +
    ".tg-help b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#140d05;font-size:.8rem}.tg-help small{color:var(--muted);font-weight:500}" +
    ".tg-panel{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);z-index:950;background:var(--surface);color:var(--ink);border-left:1px solid var(--line);box-shadow:-10px 0 40px rgba(0,0,0,.35);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .25s}" +
    ".tg-panel.open{transform:none}.tg-ph{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line)}.tg-ph h2{margin:0;font-size:1.15rem}" +
    ".tg-pb{overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:14px;flex:1;min-height:0}.tg-pb>*{flex:none}.tg-bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}.tg-bar i{display:block;height:100%;background:var(--good);transition:width .3s}" +
    ".tg-step{border:1px solid var(--line);border-radius:12px;overflow:hidden}.tg-step summary{list-style:none;display:flex;gap:10px;align-items:center;padding:12px 14px;cursor:pointer;font-weight:600}.tg-step summary::-webkit-details-marker{display:none}" +
    ".tg-n{flex:none;display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);font-size:.85rem}.tg-step.done .tg-n{background:var(--good);border-color:var(--good);color:#fff}.tg-step.done summary span:last-child{color:var(--muted);text-decoration:line-through}" +
    ".tg-step ol{margin:0;padding:0 16px 10px 40px;display:grid;gap:6px;font-size:.92rem;line-height:1.5}.tg-step .tg-go{margin:0 14px 14px 40px}.tg-faq{border-top:1px solid var(--line);padding-top:12px;display:grid;gap:8px}.tg-faq details summary{cursor:pointer;font-weight:600;font-size:.95rem}.tg-faq p{margin:6px 0 0;font-size:.9rem;color:var(--muted)}" +
    ".tg-tip{display:flex;gap:10px;align-items:flex-start;padding:10px 14px;border-radius:10px;border:1px dashed var(--line);font-size:.9rem;color:var(--muted);margin-bottom:12px}.tg-tip b{color:var(--accent);flex:none}.tg-tip button{margin-left:auto;background:none;border:0;color:var(--muted);font-size:1.1rem;cursor:pointer;line-height:1}" +
    ".tg-other{display:grid;gap:6px;font-size:.9rem}.tg-other a{color:var(--accent)}@media print{.tg-help,.tg-panel,.tg-tip{display:none!important}}";
  document.head.appendChild(el("style", { text: css }));

  var btn = el("button", { class: "tg-help", type: "button", "aria-label": "Помощь и инструкция", hidden: "hidden" }, el("b", { text: "?" }), el("span", { text: "Помощь" }), el("small", { class: "tg-prog" }));
  var body = el("div", { class: "tg-pb" });
  var panel = el("aside", { class: "tg-panel", "aria-label": "Помощь", "aria-hidden": "true" },
    el("div", { class: "tg-ph" }, el("h2", { text: "Как всё настроить" }), el("button", { class: "btn ghost small", type: "button", text: "Закрыть", onclick: close })), body);
  function open() { panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); render(); }
  function close() { panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true"); }
  btn.addEventListener("click", function () { panel.classList.contains("open") ? close() : open(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  var lastCtx = null;
  function progress(ctx) {
    var done = C.steps.filter(function (s) { try { return s.done(ctx); } catch (e) { return false; } }).length;
    return { done: done, total: C.steps.length };
  }
  function refresh() {
    var t = token();
    btn.hidden = !isOwner();
    if (!t || btn.hidden) return Promise.resolve(null);
    return C.load(t).then(function (ctx) {
      lastCtx = ctx; var p = progress(ctx);
      btn.querySelector(".tg-prog").textContent = p.done < p.total ? p.done + "/" + p.total : "";
      return ctx;
    }).catch(function () { return null; });
  }
  function render() {
    body.textContent = "";
    body.appendChild(el("p", { class: "small muted", text: "Загружаю…" }));
    refresh().then(function (ctx) {
      body.textContent = "";
      ctx = ctx || lastCtx || {};
      var p = progress(ctx), first = true;
      body.appendChild(el("p", { text: C.intro }));
      body.appendChild(el("div", null, el("div", { class: "tg-bar" }, el("i", { style: "width:" + Math.round(p.done / p.total * 100) + "%" })), el("p", { class: "small muted", text: p.done === p.total ? "Всё настроено — отлично!" : "Готово " + p.done + " из " + p.total + ". Нажмите на шаг, чтобы увидеть инструкцию." })));
      C.steps.forEach(function (s, i) {
        var ok = false; try { ok = s.done(ctx); } catch (e) { ok = false; }
        var go = typeof s.go === "function" ? s.go(ctx) : s.go;
        var d = el("details", { class: "tg-step" + (ok ? " done" : "") }, el("summary", null, el("span", { class: "tg-n", text: ok ? "✓" : String(i + 1) }), el("span", { text: s.title })),
          el("ol", null, s.how.map(function (x) { return el("li", { text: x }); })),
          el("div", { class: "tg-go" }, go ? el("a", { class: "btn small primary", href: go, onclick: close, text: "Перейти" }) : null,
            s.manual && !ok ? el("button", { class: "btn small ghost", type: "button", style: "margin-left:8px", text: "Сделано", onclick: function () { sset("trio_guide_" + P + "_" + s.id, "1"); render(); } }) : null));
        if (!ok && first) { d.open = true; first = false; }
        body.appendChild(d);
      });
      body.appendChild(el("div", { class: "tg-faq" }, el("h3", { text: "Частые вопросы" }), C.faq.map(function (f) { return el("details", null, el("summary", { text: f[0] }), el("p", { text: f[1] })); })));
      body.appendChild(el("div", { class: "tg-other" }, el("h3", { text: "Пакет «Трио»" }), el("p", { class: "small muted", text: "У каждого сервиса свой кабинет — зарегистрируйтесь в каждом на ту же почту. Оплатить пакет со скидкой можно на сайте «Трио»." }),
        Object.keys(LINKS).filter(function (k) { return k !== P; }).map(function (k) { return el("a", { href: LINKS[k], target: "_blank", rel: "noopener", text: NAMES[k] + " →" }); }),
        el("a", { href: "https://trio-resto-egor12.vercel.app/trio", target: "_blank", rel: "noopener", text: "Пакет «Трио» — все три со скидкой →" })));
    });
  }

  // ------------------------------------------------------------------ подсказки на экранах
  function tip() {
    var old = document.querySelector(".tg-tip"); if (old) old.remove();
    if (!isOwner()) return;
    var p = path();
    for (var i = 0; i < C.tips.length; i++) {
      if (!C.tips[i][0].test(p)) continue;
      var key = "trio_tip_" + P + "_" + i;
      if (sget(key) === "1") return;
      var main = document.querySelector("main"); if (!main) return;
      var t = el("div", { class: "tg-tip", role: "note" }, el("b", { text: "Подсказка" }), el("span", { text: C.tips[i][1] }),
        el("button", { type: "button", "aria-label": "Больше не показывать", title: "Больше не показывать", text: "×", onclick: function () { sset(key, "1"); t.remove(); } }));
      main.insertBefore(t, main.firstChild);
      return;
    }
  }
  function onRoute() { btn.hidden = !isOwner(); setTimeout(tip, 700); setTimeout(tip, 2000); if (!btn.hidden) refresh(); }
  function boot() {
    document.body.appendChild(btn); document.body.appendChild(panel);
    onRoute();
    // при первом входе владельца — открыть помощь один раз
    if (isOwner() && sget("trio_guide_seen_" + P) !== "1") { sset("trio_guide_seen_" + P, "1"); setTimeout(open, 1200); }
  }
  window.addEventListener("hashchange", onRoute);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
