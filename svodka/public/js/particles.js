// «Трио» — поле частиц на Three.js. Частицы собираются в фигуры (клош, бокал, щит с галочкой, график, три кольца)
// и перетекают между ними по скроллу. Без постобработки: свечение даёт аддитивное смешивание мягких точек.
import * as THREE from '../vendor/three.module.min.js';

const SHAPES = ['cloche', 'glass', 'shield', 'chart', 'rings'];
const TAU = Math.PI * 2;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- генераторы фигур: возвращают Float32Array(n*3), центр в нуле, размер ~3.2 ----------
function cloche(n, r) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = r(); let x, y, z;
    if (k < 0.62) { // купол
      const u = r() * TAU, v = Math.acos(1 - r() * 0.98); const R = 1.55;
      x = R * Math.sin(v) * Math.cos(u); z = R * Math.sin(v) * Math.sin(u); y = R * Math.cos(v) - 0.45;
    } else if (k < 0.68) { // ручка
      const u = r() * TAU, v = r() * Math.PI, R = 0.16;
      x = R * Math.sin(v) * Math.cos(u); z = R * Math.sin(v) * Math.sin(u); y = 1.2 + R * Math.cos(v);
    } else { // тарелка: кольцо с бортиком
      const u = r() * TAU, d = Math.sqrt(r()); const R = 0.4 + d * 1.75;
      x = R * Math.cos(u); z = R * Math.sin(u); y = -0.5 + (R > 1.75 ? (R - 1.75) * 0.5 : 0) + (r() - 0.5) * 0.02;
    }
    a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
  }
  return a;
}
function lathe(n, r, prof) { // prof(t) -> [radius, y], t∈[0,1]
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = r(), u = r() * TAU; const p = prof(t);
    const rr = p[0] * (0.985 + r() * 0.03);
    a[i * 3] = rr * Math.cos(u); a[i * 3 + 1] = p[1]; a[i * 3 + 2] = rr * Math.sin(u);
  }
  return a;
}
function glass(n, r) {
  const a = lathe(n, r, (t) => {
    if (t < 0.18) { const q = t / 0.18; return [q * 0.85, -1.75]; }                // основание
    if (t < 0.40) { const q = (t - 0.18) / 0.22; return [0.07, -1.75 + q * 1.35]; } // ножка
    const q = (t - 0.40) / 0.60;                                                    // чаша
    const y = -0.4 + q * 2.1; const rad = Math.sin(Math.min(1, q * 1.15) * Math.PI * 0.62) * 0.98 + 0.05;
    return [rad, y];
  });
  // вино внутри чаши
  for (let i = 0; i < n * 0.12; i++) {
    const j = Math.floor(r() * n); const u = r() * TAU, d = Math.sqrt(r()) * 0.86;
    a[j * 3] = d * Math.cos(u); a[j * 3 + 1] = 0.35 + (r() - 0.5) * 0.03; a[j * 3 + 2] = d * Math.sin(u);
  }
  return a;
}
function shield(n, r) {
  const a = new Float32Array(n * 3);
  const inside = (x, y) => { // щит: верх прямой, низ — дуга к острию
    if (y > 1.45 || y < -1.75 || Math.abs(x) > 1.35) return false;
    if (y >= 0) return Math.abs(x) <= 1.35 - (y > 1.25 ? (y - 1.25) * 2 : 0);
    const w = 1.35 * Math.sqrt(Math.max(0, 1 - Math.pow(-y / 1.75, 1.6)));
    return Math.abs(x) <= w;
  };
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  let i = 0;
  while (i < n) {
    const x = (r() - 0.5) * 2.8, y = (r() - 0.5) * 3.3 - 0.15;
    if (!inside(x, y)) continue;
    const edge = !inside(x * 1.08, y * 1.06 + (y < 0 ? -0.03 : 0.03));
    const ck = Math.min(segDist(x, y, -0.62, -0.05, -0.15, -0.55), segDist(x, y, -0.15, -0.55, 0.72, 0.62));
    const check = ck < 0.13;
    const keep = edge || check ? 1 : 0.16;
    if (r() > keep) continue;
    const z = check ? 0.32 + (r() - 0.5) * 0.18 : (edge ? (r() - 0.5) * 0.5 : (r() - 0.5) * 0.12 - 0.1);
    a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; i++;
  }
  return a;
}
function chart(n, r) {
  const a = new Float32Array(n * 3);
  const H = [0.9, 1.5, 1.15, 2.1, 2.9];
  for (let i = 0; i < n; i++) {
    const k = r();
    if (k < 0.82) { // столбики-колонны
      const b = Math.floor(r() * 5); const cx = -1.8 + b * 0.9; const h = H[b];
      const u = r() * TAU; const onTop = r() < 0.18; const rad = onTop ? Math.sqrt(r()) * 0.3 : 0.3;
      a[i * 3] = cx + rad * Math.cos(u); a[i * 3 + 1] = -1.6 + (onTop ? h : r() * h); a[i * 3 + 2] = rad * Math.sin(u);
    } else if (k < 0.94) { // линия тренда над столбиками
      const t = r() * 4; const b = Math.floor(t), f = t - b;
      const y0 = -1.6 + H[b] + 0.45, y1 = -1.6 + H[Math.min(4, b + 1)] + 0.45;
      a[i * 3] = -1.8 + t * 0.9; a[i * 3 + 1] = y0 + (y1 - y0) * f + (r() - 0.5) * 0.03; a[i * 3 + 2] = (r() - 0.5) * 0.04;
    } else { // основание
      a[i * 3] = (r() - 0.5) * 4.6; a[i * 3 + 1] = -1.62; a[i * 3 + 2] = (r() - 0.5) * 1.2;
    }
  }
  return a;
}
function rings(n, r) {
  const a = new Float32Array(n * 3);
  const C = [[-0.78, 0.45, 0], [0.78, 0.45, 0], [0, -0.9, 0]];
  for (let i = 0; i < n; i++) {
    const c = C[i % 3]; const u = r() * TAU, v = r() * TAU; const R = 1.05, q = 0.07 + r() * 0.05;
    const tilt = (i % 3 - 1) * 0.5;
    let x = (R + q * Math.cos(v)) * Math.cos(u), y = (R + q * Math.cos(v)) * Math.sin(u), z = q * Math.sin(v);
    const zz = z * Math.cos(tilt) - x * Math.sin(tilt); x = x * Math.cos(tilt) + z * Math.sin(tilt);
    a[i * 3] = x + c[0]; a[i * 3 + 1] = y + c[1]; a[i * 3 + 2] = zz + c[2];
  }
  return a;
}
const GEN = { cloche, glass, shield, chart, rings };

const VERT = `
uniform float uTime, uMorph, uPR, uSize, uScatter, uCount;
attribute vec3 p0; attribute vec3 p1; attribute vec3 p2; attribute vec3 p3; attribute vec3 p4;
attribute vec4 aRnd;
varying float vA; varying float vH; varying float vD;
vec3 pick(float k){ if(k<0.5) return p0; if(k<1.5) return p1; if(k<2.5) return p2; if(k<3.5) return p3; return p4; }
void main(){
  float dust = step(0.94, aRnd.w);
  float m = clamp(uMorph + (aRnd.x - 0.5) * 0.35, 0.0, uCount - 1.0);
  float k0 = floor(m); float f = smoothstep(0.0, 1.0, fract(m));
  vec3 a = pick(k0), b = pick(min(k0 + 1.0, uCount - 1.0));
  // в середине перехода частицы «вздыхают» наружу
  float lift = sin(f * 3.14159) * (0.55 + aRnd.y * 0.9);
  vec3 dir = normalize(aRnd.xyz - 0.5 + 0.001);
  vec3 pos = mix(a, b, f) + dir * lift + dir * uScatter * (1.2 + aRnd.z * 3.0);
  float t = uTime * (0.25 + aRnd.y * 0.35);
  pos += vec3(sin(t + aRnd.x * 40.0), cos(t * 1.3 + aRnd.y * 30.0), sin(t * 0.7 + aRnd.z * 50.0)) * (0.012 + dust * 0.0);
  if (dust > 0.5) { // пыль в воздухе: медленно дрейфует вокруг
    float ang = aRnd.x * 6.2832 + uTime * 0.02 * (aRnd.y - 0.5);
    float rad = 2.6 + aRnd.z * 4.5;
    pos = vec3(cos(ang) * rad, (aRnd.y - 0.5) * 7.0 + sin(uTime * 0.1 + aRnd.x * 9.0) * 0.4, sin(ang) * rad - 1.5);
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = uSize * (0.55 + aRnd.z * 0.9) * (1.0 + dust * 2.8);
  gl_PointSize = sz * uPR * (6.0 / -mv.z);
  vA = (0.55 + 0.45 * sin(uTime * (0.6 + aRnd.y) + aRnd.x * 60.0)) * (1.0 - dust * 0.72);
  vH = clamp(pos.y * 0.28 + 0.5, 0.0, 1.0);
  vD = dust;
}`;
const FRAG = `
precision mediump float;
uniform vec3 uC1, uC2, uC3; uniform float uAlpha;
varying float vA; varying float vH; varying float vD;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d); core *= core;
  vec3 col = mix(uC1, uC2, vH); col = mix(col, uC3, vD * 0.6);
  gl_FragColor = vec4(col * (0.7 + core * 1.4), core * vA * uAlpha);
}`;

export function createField(canvas, opts = {}) {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const N = opts.count || (small ? 7000 : 15000);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { document.documentElement.classList.add('no-webgl'); return null; }
  const PR = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
  renderer.setPixelRatio(PR);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 9.5);

  const g = new THREE.BufferGeometry();
  const r = rng(20261022);
  const order = opts.shapes || SHAPES;
  const pos = new Float32Array(N * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  for (let i = 0; i < 5; i++) g.setAttribute('p' + i, new THREE.BufferAttribute(GEN[order[Math.min(i, order.length - 1)]](N, rng(77 + i * 13)), 3));
  const rnd = new Float32Array(N * 4); for (let i = 0; i < N * 4; i++) rnd[i] = r();
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);

  const pal = opts.palette || ['#ff8a3d', '#ffd9a0', '#ffb15c'];
  const U = {
    uTime: { value: 0 }, uMorph: { value: 0 }, uPR: { value: PR }, uSize: { value: small ? 3.2 : 3.0 },
    uScatter: { value: 1 }, uCount: { value: Math.min(5, order.length) }, uAlpha: { value: 1 },
    uC1: { value: new THREE.Color(pal[0]) }, uC2: { value: new THREE.Color(pal[1]) }, uC3: { value: new THREE.Color(pal[2]) }
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, mat);
  const group = new THREE.Group(); group.add(pts); scene.add(group);

  const st = { morph: 0, tMorph: 0, scatter: 1, tScatter: 0, alpha: 1, tAlpha: 1, mx: 0, my: 0, sx: 0, sy: 0, x: opts.x || 0, tx: opts.x || 0, spin: 0, visible: true, running: true };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.position.z = w / h < 0.8 ? 13 : 9.5; camera.updateProjectionMatrix();
  }
  size();
  window.addEventListener('resize', size);
  window.addEventListener('pointermove', (e) => { st.mx = e.clientX / window.innerWidth - 0.5; st.my = e.clientY / window.innerHeight - 0.5; }, { passive: true });
  document.addEventListener('visibilitychange', () => { st.visible = !document.hidden; if (st.visible) loop(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('no-webgl'); st.running = false; });

  let last = performance.now(), raf = 0, slow = 0;
  function loop() {
    cancelAnimationFrame(raf);
    if (!st.visible || !st.running) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // если устройство не тянет — уменьшаем разрешение один раз
    if (dt > 0.034) { if (++slow > 90 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); U.uPR.value = 1; size(); slow = 0; } } else slow = Math.max(0, slow - 1);
    const e = 1 - Math.exp(-dt * 3.2);
    st.morph += (st.tMorph - st.morph) * e; st.scatter += (st.tScatter - st.scatter) * (1 - Math.exp(-dt * 1.6));
    st.alpha += (st.tAlpha - st.alpha) * e; st.x += (st.tx - st.x) * e;
    st.sx += (st.mx - st.sx) * (1 - Math.exp(-dt * 2)); st.sy += (st.my - st.sy) * (1 - Math.exp(-dt * 2));
    U.uTime.value += reduce ? 0 : dt; U.uMorph.value = st.morph; U.uScatter.value = st.scatter; U.uAlpha.value = st.alpha;
    st.spin += dt * (reduce ? 0 : 0.12);
    group.rotation.y = st.spin + st.sx * 0.6; group.rotation.x = -0.12 + st.sy * 0.25; group.position.x = st.x;
    renderer.render(scene, camera);
  }
  loop();
  return {
    setShape(v) { st.tMorph = Math.max(0, Math.min(U.uCount.value - 1, v)); },
    setScatter(v) { st.tScatter = v; },
    setAlpha(v) { st.tAlpha = v; },
    setX(v) { st.tx = v; },
    setPalette(p) { U.uC1.value.set(p[0]); U.uC2.value.set(p[1]); U.uC3.value.set(p[2]); }
  };
}
