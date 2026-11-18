import Lenis from '../vendor/lenis.mjs';
import { createField } from './particles.js';

const root = document.documentElement;
const body = document.body;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 800px)').matches;

// ---------- плавный скролл ----------
let lenis = null;
if (!reduce) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const id = a.getAttribute('href'); if (id.length < 2) return;
    const el = document.querySelector(id); if (!el) return;
    e.preventDefault(); lenis.scrollTo(el, { offset: 0, duration: 1.6 }); menu && menu.classList.remove('open');
  }));
}
const onScroll = (fn) => { if (lenis) lenis.on('scroll', fn); else window.addEventListener('scroll', fn, { passive: true }); fn(); };

// ---------- шапка ----------
const top = document.querySelector('.top');
const menu = document.querySelector('.menu');
const burger = document.querySelector('.burger');
if (burger) burger.addEventListener('click', () => { const o = menu.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
const bgimg = document.querySelector('.bgimg');
onScroll(() => {
  if (top) top.classList.toggle('solid', window.scrollY > 40);
  if (bgimg) bgimg.style.setProperty('--bgo', (0.1 + 0.32 * Math.max(0, 1 - window.scrollY / window.innerHeight)).toFixed(3));
});

// ---------- частицы ----------
const canvas = document.getElementById('field');
const pal = (body.dataset.palette || '#ff8a3d,#ffd9a0,#ffb15c').split(',');
const field = canvas ? createField(canvas, { palette: pal }) : null;
const baseShape = Number(body.dataset.shape || 0);
const baseX = mobile ? 0 : Number(body.dataset.x || 0);
if (field) { field.setShape(baseShape); field.setX(baseX); setTimeout(() => field.setScatter(0), 250); }
requestAnimationFrame(() => root.classList.add('ready'));

// секции с data-shape меняют фигуру, когда оказываются в центре экрана
const shapeSecs = [...document.querySelectorAll('[data-shape]')].filter((s) => s !== body);
if (field && shapeSecs.length) {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting || journeyActive) return;
    const s = e.target.dataset;
    field.setShape(Number(s.shape)); field.setX(mobile ? 0 : Number(s.x || 0));
    field.setAlpha(Number(s.alpha || 1)); field.setScatter(Number(s.scatter || 0));
  }), { rootMargin: '-45% 0px -45% 0px' });
  shapeSecs.forEach((s) => io.observe(s));
}

// ---------- появление ----------
document.querySelectorAll('.split').forEach((el) => {
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((w) => {
          if (!w) return;
          if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
          const o = document.createElement('span'); o.className = 'w'; const i = document.createElement('span'); i.textContent = w; o.appendChild(i); frag.appendChild(o);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
  };
  walk(el);
  el.querySelectorAll('.w>span').forEach((s, i) => { s.style.transitionDelay = (i * 0.045) + 's'; });
});
const rio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.rv,.split').forEach((el) => rio.observe(el));

// подсветка карточек за курсором
document.querySelectorAll('.pcard').forEach((c) => c.addEventListener('pointermove', (e) => {
  const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
}));

// ---------- путешествие: видео по скроллу ----------
let journeyActive = false;
const J = document.querySelector('.journey');
if (J) {
  const film = J.querySelector('.film');
  const chaps = [...J.querySelectorAll('.chap')];
  const dots = [...J.querySelectorAll('.progress a')];
  const barI = J.querySelector('.bar i');
  const stills = [...J.querySelectorAll('.still')];
  const DUR = Number(film.dataset.dur || 24);
  // ключевые точки: [доля скролла, секунда видео]; между ними — пролёт, на ровных участках — остановка на главе
  const KEY = [[0, 0], [0.06, 0], [0.22, DUR * 0.25], [0.30, DUR * 0.25], [0.46, DUR * 0.5], [0.54, DUR * 0.5], [0.70, DUR * 0.75], [0.78, DUR * 0.75], [0.94, DUR], [1, DUR]];
  const WIN = [[0, 0.055], [0.20, 0.32], [0.44, 0.56], [0.68, 0.80], [0.92, 1.01]];
  const SHAPE = [0, 1, 2, 3, 4];
  const timeAt = (p) => { for (let i = 1; i < KEY.length; i++) if (p <= KEY[i][0]) { const a = KEY[i - 1], b = KEY[i]; const f = (p - a[0]) / Math.max(1e-6, b[0] - a[0]); const s = f * f * (3 - 2 * f); return a[1] + (b[1] - a[1]) * s; } return DUR; };

  let video = null, ready = false, target = 0, shown = -1, seeking = false, seekAt = 0;
  const src = (mobile && film.dataset.srcM) || film.dataset.src;
  if (src && !reduce) {
    const attach = (url) => {
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
      video.preload = 'auto'; video.className = 'jv';
      // видео сразу в DOM (невидимым): Chrome не грузит отсоединённые и фоновые <video>
      film.prepend(video);
      const ok = () => { if (ready) return; ready = true; film.classList.add('has-video'); video.currentTime = target; };
      video.addEventListener('loadeddata', ok); video.addEventListener('canplay', ok);
      video.addEventListener('seeked', () => { seeking = false; });
      const unlock = () => { video.play().then(() => video.pause()).catch(() => {}); };
      window.addEventListener('touchstart', unlock, { once: true, passive: true });
      video.src = url; video.load();
    };
    fetch(src).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => attach(URL.createObjectURL(b)))
      .catch(() => attach(src));
  }
  const tick = () => {
    if (ready && !seeking) {
      const d = target - video.currentTime;
      if (Math.abs(d) > 0.016) { seeking = true; seekAt = performance.now(); video.currentTime = video.currentTime + d * (Math.abs(d) > 1.5 ? 1 : 0.35); }
    } else if (seeking && performance.now() - seekAt > 400) { seeking = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  onScroll(() => {
    const r = J.getBoundingClientRect(); const total = J.offsetHeight - window.innerHeight;
    const p = Math.max(0, Math.min(1, -r.top / Math.max(1, total)));
    const inside = r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.5;
    journeyActive = inside;
    target = timeAt(p);
    if (barI) barI.style.width = (p * 100).toFixed(2) + '%';
    let on = -1; WIN.forEach((w, i) => { if (p >= w[0] && p < w[1]) on = i; });
    if (on !== shown) { chaps.forEach((c, i) => c.classList.toggle('on', i === on)); shown = on; }
    let near = 0; for (let i = 0; i < WIN.length; i++) if (p >= WIN[i][0] - 0.12) near = i;
    dots.forEach((d, i) => d.classList.toggle('on', i + 1 === near));
    // кадры-заглушки, пока нет видео
    if (!ready && stills.length) { const k = Math.round(target / DUR * (stills.length - 1)); stills.forEach((s, i) => { s.style.opacity = i === k ? 1 : 0; }); }
    if (field && inside) { field.setShape(SHAPE[near]); field.setX(mobile ? 0 : 2.3); field.setAlpha(on >= 0 ? 0.75 : 0.35); field.setScatter(on >= 0 ? 0 : 0.6); }
  });
}

// ---------- заявка на пакет ----------
const SB = 'https://qozyihhlocvgpkchyqsp.supabase.co';
const KEY_PUB = 'sb_publishable_Us9CgaJDpwIpAHSQYN7QMg_ADy35Uov';
document.querySelectorAll('form[data-lead]').forEach((f) => {
  const err = f.querySelector('.err'); const btn = f.querySelector('button[type=submit]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = '';
    const d = Object.fromEntries(new FormData(f));
    if (!d.name || d.name.trim().length < 2) { err.textContent = 'Как к вам обращаться?'; return; }
    const digits = (d.phone || '').replace(/\D/g, '');
    if (digits.length < 10) { err.textContent = 'Проверьте номер телефона'; return; }
    if (!f.querySelector('[name=agree]').checked) { err.textContent = 'Нужно согласие на обработку контактов'; return; }
    btn.disabled = true; const t = btn.innerHTML; btn.textContent = 'Отправляем…';
    try {
      const r = await fetch(SB + '/rest/v1/rpc/hub_lead', { method: 'POST', headers: { 'content-type': 'application/json', apikey: KEY_PUB, authorization: 'Bearer ' + KEY_PUB },
        body: JSON.stringify({ p: { name: d.name, phone: d.phone, venue: d.venue || '', city: d.city || '', plan: f.dataset.lead, comment: d.comment || '', page: location.pathname } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j || j.ok !== true) throw new Error((j && (j.error || j.message)) || 'Не получилось отправить');
      f.hidden = true; const done = document.getElementById(f.dataset.done); if (done) { done.hidden = false; done.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    } catch (ex) { err.textContent = ex.message === 'rate' ? 'Заявка уже отправлена — мы свяжемся с вами' : 'Не получилось отправить. Попробуйте ещё раз через минуту.'; }
    finally { btn.disabled = false; btn.innerHTML = t; }
  });
});

// ---------- уведомление о cookies ----------
(() => {
  let seen = null; try { seen = localStorage.getItem('trio_ck'); } catch (e) {}
  if (seen) return;
  const host = location.hostname.indexOf('trio-resto') === 0 ? '' : 'https://trio-resto-egor12.vercel.app';
  const box = document.createElement('div'); box.className = 'ck'; box.setAttribute('role', 'status');
  box.innerHTML = `<span>Мы не используем рекламные cookies — только данные браузера, нужные для работы сайта. <a href="${host}/cookies">Подробнее</a></span>`;
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Понятно';
  b.addEventListener('click', () => { try { localStorage.setItem('trio_ck', '1'); } catch (e) {} box.remove(); });
  box.appendChild(b); setTimeout(() => document.body.appendChild(box), 1200);
})();
