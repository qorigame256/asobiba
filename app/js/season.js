// 季節の飾り（2026-11-09 本人の選択。room.md「演出・アニメーションの2回目」）。
// ホームと待合室に、日付で季節のものをうっすら舞わせる。対局の画面には出さない（出す・止めるは main.js の updateSeason が決める）。
// 本人の指示で見本の最初の形より控えめにした（見本の「控えめ」: 数は4割・小さく・ゆっくり・薄く。花火は間をあけて小さく）。
// Claude が決めた細部:
//   - 季節: 春 3〜5月・夏 6〜8月・秋 9〜11月・冬 12〜2月。1月1〜7日は正月（梅と金の粉）。端末の時計で決める。
//   - 画面全体に重ねる canvas（押せないので、下の物はそのまま押せる）。数は見本の電話の大きさ（260×360）を基準に、画面の広さに合わせて増やす（2.5倍まで）。
//   - 動きを減らす設定の端末では出さない（止まった絵も描かない。2026-11-11 本人の決定）。タブが裏にある間は止める。
//   - 確かめ用に URL の ?season=spring などで季節を替えられる（spring・summer・autumn・winter・newyear・none）。
// ブラウザにしか無いもの（window・document）は、呼ばれたときに初めて触る（Node の自動確認から読まれても動くように）。

const BASE = { spring: 18, autumn: 12, winter: 34, newyear: 22 };
const SOFT = { n: 0.4, sz: 0.75, sp: 0.7, a: 0.55, gap: 2.4, sparks: 16 };

export function seasonOf(d = new Date()) {
  const m = d.getMonth() + 1;
  if (m === 1 && d.getDate() <= 7) return 'newyear';
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

let cv = null, ctx = null, on = false, running = false, season = null;
let W = 0, H = 0, parts = [], sparks = [], nextBurst = 0, last = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function pickSeason() {
  try {
    const q = new URL(location.href).searchParams.get('season');
    if (q && /^(spring|summer|autumn|winter|newyear|none)$/.test(q)) return q;
  } catch { /* 無視 */ }
  return seasonOf();
}

function make(top) {
  const p = { x: rnd(0, W), y: top ? rnd(-40, -10) : rnd(0, H), ph: rnd(0, Math.PI * 2), rot: rnd(0, Math.PI * 2), vr: rnd(-0.04, 0.04) };
  if (season === 'spring') Object.assign(p, { vy: rnd(0.45, 0.9), sw: rnd(0.4, 0.9), r: rnd(4, 6.5), col: pick(['#f6b3c6', '#f9cdd9', '#f39bb5']) });
  if (season === 'autumn') Object.assign(p, { vy: rnd(0.55, 1), sw: rnd(0.5, 1.1), r: rnd(13, 19), ch: pick(['🍁', '🍁', '🍂']) });
  if (season === 'winter') Object.assign(p, { vy: rnd(0.35, 0.85), sw: rnd(0.2, 0.6), r: rnd(1.6, 3.6) });
  if (season === 'newyear') Object.assign(p, { vy: rnd(0.3, 0.6), sw: rnd(0.3, 0.7), r: rnd(2, 3.5), kind: Math.random() < 0.35 ? 'ume' : 'gold' });
  if (p.vy) { p.vy *= SOFT.sp; p.r *= SOFT.sz; p.sw *= SOFT.sp; }
  return p;
}

function size() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function reset() {
  parts = []; sparks = []; nextBurst = 0;
  const scale = Math.min(2.5, Math.max(1, (W * H) / (260 * 360)));
  const n = Math.round((BASE[season] || 0) * SOFT.n * scale);
  for (let i = 0; i < n; i++) parts.push(make(false));
}

function burst(now) {
  const x = rnd(W * 0.15, W * 0.85), y = rnd(H * 0.08, H * 0.35);
  const col = pick(['#e04b3c', '#f2a03a', '#3a8ee0', '#d65bc1', '#2fb36a', '#e8c23a']);
  for (let i = 0; i < SOFT.sparks; i++) {
    const a = (i / SOFT.sparks) * Math.PI * 2, sp = rnd(1.1, 2.1) * 0.7;
    sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col });
  }
  nextBurst = now + rnd(900, 1500) * SOFT.gap;
}

function star(x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}

function draw(now, k) {
  ctx.clearRect(0, 0, W, H);
  if (season === 'summer') {
    if (now > nextBurst) burst(now);
    for (const s of sparks) { s.x += s.vx * k; s.y += s.vy * k; s.vy += 0.025 * k; s.vx *= 0.985; s.life -= 0.014 * k; }
    sparks = sparks.filter((s) => s.life > 0);
    for (const s of sparks) { ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(s.x, s.y, 1.6, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
    return;
  }
  parts.forEach((p, i) => {
    p.ph += 0.02 * k; p.y += p.vy * k; p.x += Math.sin(p.ph) * p.sw * k * 0.6; p.rot += p.vr * k;
    if (p.y > H + 24) parts[i] = make(true);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    if (season === 'spring') { ctx.fillStyle = p.col; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 7); ctx.fill(); }
    if (season === 'autumn') { ctx.globalAlpha = 0.85; ctx.font = `${p.r}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.ch, 0, 0); }
    if (season === 'winter') { ctx.shadowColor = 'rgba(70,100,150,.45)'; ctx.shadowBlur = 3; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill(); }
    if (season === 'newyear') {
      if (p.kind === 'gold') { ctx.fillStyle = '#d9a520'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(p.ph * 3); star(0, 0, p.r * 1.6); }
      else {
        ctx.fillStyle = '#e0607e'; ctx.globalAlpha = 0.85;
        for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(Math.cos(j * 1.2566) * p.r, Math.sin(j * 1.2566) * p.r, p.r * 0.8, 0, 7); ctx.fill(); }
        ctx.fillStyle = '#f7d14a'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.45, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  });
}

function frame(now) {
  if (!on || document.hidden) { running = false; return; }
  if (still()) { running = false; ctx.clearRect(0, 0, W, H); return; } // 見ている途中で動きを減らす設定にしたら消す
  const k = last ? Math.min(3, (now - last) / 16.7) : 1;
  last = now;
  draw(now, k);
  requestAnimationFrame(frame);
}

function start() {
  if (!on) return;
  if (still()) { ctx.clearRect(0, 0, W, H); return; } // 動きを減らす設定の端末では出さない
  if (running) return;
  running = true; last = 0;
  requestAnimationFrame(frame);
}

function setup() {
  season = pickSeason();
  if (season === 'none') return false;
  cv = document.createElement('canvas');
  cv.className = 'season-fx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  ctx = cv.getContext('2d');
  cv.style.opacity = SOFT.a;
  size(); reset();
  window.addEventListener('resize', () => { size(); reset(); if (on) start(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  return true;
}

// 出す（true）・止めて消す（false）。何度呼んでもよい
export function showSeason(want) {
  if (want && still()) want = false; // 動きを減らす設定の端末では出さない（canvas も作らない）
  if (want === on) return;
  if (want && !cv && !setup()) return;
  if (!cv) return;
  on = want;
  cv.hidden = !want;
  if (want) start(); else { ctx.clearRect(0, 0, W, H); }
}
