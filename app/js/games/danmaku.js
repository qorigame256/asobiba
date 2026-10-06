// 弾幕回避。全員が同じ弾幕の中を同時によける（2026-10-05 本人承認）。当たったら脱落し、長く残った人ほど上の順位。
// 弾の出方は対局の種（seed）から全員同じに作る（makeBullets）。時刻は各自の端末で「始まりの合図が届いてから」を測る
// （通信の遅れは「始まるのが少し遅れる」だけなので、だれも不利にならない）。
// 自分の当たり判定は自分の端末だけがして、当たったら「何秒もったか」を手として送る。順位はこの秒数で決める。
// 時間（詳細設定）まで残った人は全員1位。最後の1人になって、ほかの全員より長くもったら、その時点で終わる（手 last）。
// ほかの人の自機の位置は見た目だけなので、手の一覧に入れず 0.1秒ごとに送りっぱなしにする（o.stream / onStream）。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end
// 詳細設定「残機」（2026-10-06 本人の決定。最初は 1機＝今までどおり当たったら脱落）: 2機・3機なら、その数だけ当たったら脱落。
//   Claude の判断: 当たったあと2秒は当たらない（自機が点滅する）。その場で続ける。順位は脱落した時刻（最後の1機を失った時刻）で決める。
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'hit', ms: もった時間, k: 何回目の当たりか（0から） } / { p, t: 'last', ms }
//   k が局面の hits[p] と違う手は反則（同じ当たりが2回届いても1回だけ数える）。
// CPU（と部屋を出た人の席）はホストの端末がよける動きを計算する（cpu の中の sim）。腕前はわざと鈍くしてある。

import { mulberry32 } from './util.js';
import { since, scoreChips, esc } from './party.js';
import { SEAT_COLORS, fitCanvas, toBoard, clamp } from './action.js';

const READY_MS = 3000;
const GRACE_MS = 2500;
export const H = 1.25; // 盤は横 1 : 縦 1.25
export const HIT_R = 0.009; // 自機の当たり判定の半径（見た目より小さい）
const SHIP_R = 0.02;
const SEND_MS = 100;
const START = { x: 0.5, y: H - 0.12 };
const SAFE_SEC = 2; // 残機があって当たったあと、当たらない秒数

/* ---------- 弾の作り方（全員同じ） ---------- */

// 詳細設定「難しさ」（2026-10-06 本人の決定。最初は ふつう＝前からの弾幕）。数字は Claude の判断:
// n = 1回に出る弾の数、v = 弾の速さ、gap = 次の弾が出るまでの間（どれも ふつう に掛ける倍率）
export const LEVELS = {
  easy: { n: 0.65, v: 0.8, gap: 1.25 },
  normal: { n: 1, v: 1, gap: 1 },
  hard: { n: 1.3, v: 1.15, gap: 0.85 },
};

// 弾 = { t: 出る秒, x, y, vx, vy, r, c: 色, end: 盤の外へ出る秒 }。t の早い順に並ぶ
export function makeBullets(seed, durSec, level = 'normal') {
  const L = LEVELS[level] ?? LEVELS.normal;
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const list = [];
  const add = (t, x, y, vx0, vy0, r, c) => {
    const vx = vx0 * L.v; const vy = vy0 * L.v;
    // 盤の外（少し余白）へ出る時刻
    const out = (p, v, lo, hi) => (v > 0 ? (hi - p) / v : v < 0 ? (lo - p) / v : Infinity);
    const life = Math.min(out(x, vx, -0.05, 1.05), out(y, vy, -0.08, H + 0.05));
    list.push({ t, x, y, vx, vy, r, c, end: t + Math.max(0.1, life) });
  };
  const pol = (a, sp) => [Math.cos(a) * sp, Math.sin(a) * sp];
  let t = 1.2;
  while (t < durSec) {
    const k = t / durSec; // 0（始め）〜1（終わり）。後ほど弾が多く速い
    const w = rng();
    if (w < 0.24) { // 輪: 1点から全方向へ
      const cx = 0.15 + rng() * 0.7; const cy = 0.06 + rng() * 0.22;
      const n = Math.round((10 + 12 * k) * L.n); const sp = 0.16 + 0.12 * k; const a0 = rng() * Math.PI * 2;
      for (let i = 0; i < n; i++) add(t, cx, cy, ...pol(a0 + (i / n) * Math.PI * 2, sp), 0.016, '#ff6b6b');
    } else if (w < 0.46) { // 雨: 上から
      const n = Math.round((5 + 9 * k) * L.n);
      for (let i = 0; i < n; i++) add(t + i * 0.08, rng(), -0.03, (rng() - 0.5) * 0.08, 0.22 + 0.14 * k + rng() * 0.05, 0.013, '#5dade2');
    } else if (w < 0.64) { // うず巻き
      const cx = 0.3 + rng() * 0.4; const cy = 0.12; const dir = rng() < 0.5 ? 1 : -1;
      const n = Math.round((14 + 16 * k) * L.n); const sp = 0.19 + 0.1 * k; const a0 = rng() * Math.PI * 2;
      const arms = k > 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < arms; j++) add(t + i * 0.06, cx, cy, ...pol(a0 + dir * i * 0.45 + j * Math.PI, sp), 0.012, '#f7dc6f');
      }
    } else if (w < 0.84) { // 扇: 下の方のどこかをねらう
      const ox = 0.1 + rng() * 0.8; const oy = 0.02;
      const tx = 0.1 + rng() * 0.8; const ty = H * 0.6 + rng() * H * 0.35;
      const base = Math.atan2(ty - oy, tx - ox);
      const n = Math.max(3, Math.round((5 + Math.round(4 * k)) * L.n)); const sp = 0.27 + 0.12 * k;
      const bursts = k > 0.4 ? 2 : 1;
      for (let b = 0; b < bursts; b++) {
        for (let i = 0; i < n; i++) add(t + b * 0.3, ox, oy, ...pol(base + (i / (n - 1) - 0.5) * 0.6, sp), 0.014, '#bb8fce');
      }
    } else { // 横から: 横一列に並んだ弾。どこかにすき間がある
      const left = rng() < 0.5;
      const n = Math.max(4, Math.round((6 + Math.round(4 * k)) * L.n)); const gap = Math.floor(rng() * n);
      const vx = (left ? 1 : -1) * (0.2 + 0.1 * k);
      for (let i = 0; i < n; i++) {
        if (i === gap) continue;
        add(t + i * 0.04, left ? -0.03 : 1.03, 0.3 + (i / n) * (H - 0.4), vx, 0, 0.015, '#58d68d');
      }
    }
    t += (1.5 - 0.95 * k) * (0.8 + rng() * 0.4) * L.gap;
  }
  list.sort((a, b) => a.t - b.t);
  return list;
}

// 盤の上に出ている弾を順に追う道具。at(秒) で時刻を進め、出ている弾の一覧を返す（時刻は戻せない）
export function tracker(bullets) {
  let next = 0;
  let active = [];
  return (sec) => {
    while (next < bullets.length && bullets[next].t <= sec) active.push(bullets[next++]);
    active = active.filter((b) => b.end > sec);
    return active;
  };
}
export const posOf = (b, sec) => [b.x + b.vx * (sec - b.t), b.y + b.vy * (sec - b.t)];
export function hitAt(active, sec, x, y) {
  for (const b of active) {
    const [bx, by] = posOf(b, sec);
    if (Math.hypot(bx - x, by - y) < b.r + HIT_R) return true;
  }
  return false;
}

/* ---------- CPU のよけ方 ---------- */

export const CPU_SPEED = 0.42; // 盤の横幅 / 秒
// 0.1〜0.22 秒ごとに向きを決め直す。近くの弾の少し先の位置から離れ、下の真ん中へ戻ろうとする。ときどき考えずに動く
export function cpuStep(c, active, sec, dt, rnd) {
  c.timer -= dt;
  if (c.timer <= 0) {
    c.timer = 0.1 + rnd() * 0.12;
    let fx = (0.5 - c.x) * 0.6;
    let fy = (H - 0.15 - c.y) * 0.6;
    for (const b of active) {
      const [bx, by] = posOf(b, sec + 0.22);
      const dx = c.x - bx; const dy = c.y - by;
      const d = Math.hypot(dx, dy);
      if (d > 0.16 || d < 1e-6) continue;
      const f = ((0.16 - d) / 0.16) ** 2 * 6;
      fx += (dx / d) * f; fy += (dy / d) * f;
    }
    if (rnd() < 0.06) { const a = rnd() * Math.PI * 2; fx = Math.cos(a); fy = Math.sin(a); } // うっかり
    const len = Math.hypot(fx, fy);
    c.vx = len > 0.05 ? (fx / len) * CPU_SPEED : fx * CPU_SPEED * 10;
    c.vy = len > 0.05 ? (fy / len) * CPU_SPEED : fy * CPU_SPEED * 10;
  }
  c.x = clamp(c.x + c.vx * dt, 0.02, 0.98);
  c.y = clamp(c.y + c.vy * dt, 0.02, H - 0.02);
}

const durOf = (s) => Number(s.rules.time);
const goKey = (s) => `danmaku:${s.seed}:go`;
const clone = (s) => ({ ...s, dead: s.dead.slice(), hits: s.hits.slice() });
const livesOf = (s) => ([1, 2, 3].includes(Number(s.rules.lives)) ? Number(s.rules.lives) : 1);
const aliveSeats = (s) => s.dead.map((v, p) => (v === null ? p : -1)).filter((p) => p >= 0);
const maxDead = (s) => Math.max(0, ...s.dead.filter((v) => v !== null));

// 順位用の秒数（最後まで残った人は時間いっぱい＋1）
const scoreOf = (s, p) => (s.dead[p] ?? durOf(s) * 1000 + 1);

const sims = new Map(); // CPU のよける動き（ホストの端末だけ）。`${seed}:${p}` → { x, y, vx, vy, timer, sec, at, dead }
const bulletCache = new Map();
function bulletsOf(s) {
  const key = `${s.seed}:${s.rules.time}:${s.rules.level}`;
  if (!bulletCache.has(key)) {
    bulletCache.set(key, makeBullets(s.seed, durOf(s), s.rules.level));
    if (bulletCache.size > 4) bulletCache.delete(bulletCache.keys().next().value);
  }
  return bulletCache.get(key);
}

/* ---------- 画面 ---------- */

let ui = null;

function draw() {
  const { s, o } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  const sec = s.phase === 'ready' ? 0 : Math.min(since(goKey(s)) / 1000, durOf(s));
  ctx.fillStyle = '#121a2e';
  ctx.fillRect(0, 0, k, k * H);
  // 弾
  const active = ui.view(sec);
  for (const b of active) {
    const [x, y] = posOf(b, sec);
    ctx.beginPath();
    ctx.arc(x * k, y * k, b.r * k, 0, Math.PI * 2);
    ctx.fillStyle = b.c;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x * k, y * k, b.r * k * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  // ほかの人（半透明）
  const now = performance.now();
  const ship = (x, y, p, alpha, label) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x * k, (y - SHIP_R * 1.3) * k);
    ctx.lineTo((x - SHIP_R) * k, (y + SHIP_R) * k);
    ctx.lineTo((x + SHIP_R) * k, (y + SHIP_R) * k);
    ctx.closePath();
    ctx.fillStyle = SEAT_COLORS[p % SEAT_COLORS.length];
    ctx.fill();
    if (label) {
      ctx.font = `${Math.max(10, k * 0.03)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x * k, (y + SHIP_R * 2.6) * k);
    }
    ctx.globalAlpha = 1;
  };
  for (let p = 0; p < s.n; p++) {
    if (p === ui.me || s.dead[p] !== null) continue;
    const g = ui.ghosts.get(p) ?? sims.get(`${s.seed}:${p}`);
    if (!g || (g.at && now - g.at > 1500)) continue;
    g.dx = g.dx === undefined ? g.x : g.dx + (g.x - g.dx) * 0.3; // 届いた位置へなめらかに
    g.dy = g.dy === undefined ? g.y : g.dy + (g.y - g.dy) * 0.3;
    ship(g.dx, g.dy, p, 0.4, o.names[p]);
  }
  // 自分
  if (ui.me !== null) {
    if (s.dead[ui.me] === null && !ui.hit) {
      const safe = sec < ui.safeUntil; // 当たったあとの、当たらない間は点滅
      ship(ui.x, ui.y, ui.me, safe && Math.floor(now / 120) % 2 ? 0.25 : 1, '');
      ctx.beginPath();
      ctx.arc(ui.x * k, ui.y * k, HIT_R * k, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else if (ui.boomAt && now - ui.boomAt < 600) {
      ctx.beginPath();
      ctx.arc(ui.x * k, ui.y * k, (0.02 + (now - ui.boomAt) / 6000) * k, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,80,0.8)';
      ctx.fill();
    }
  }
  // 上の文字
  ctx.font = `bold ${Math.max(13, k * 0.045)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  let text = '';
  if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`danmaku:${s.seed}:ready`)) / 1000);
    ctx.font = `bold ${k * 0.18}px sans-serif`;
    ctx.fillText(left > 0 ? String(left) : 'スタート！', k / 2, k * H * 0.5);
  } else if (s.phase === 'end') text = 'おしまい！';
  else if (sec >= durOf(s)) text = 'そこまで！';
  else {
    const alive = aliveSeats(s).length;
    text = `残り ${Math.ceil(durOf(s) - sec)}秒・生き残り ${alive}/${s.n}`;
    if (livesOf(s) > 1 && ui.me !== null && s.dead[ui.me] === null && !ui.hit) text += `・残機 ${livesOf(s) - ui.hits}`;
    if (ui.me !== null && (s.dead[ui.me] !== null || ui.hit)) text += '（観戦中）';
  }
  if (text) ctx.fillText(text, k / 2, k * 0.06);
}

function step() {
  const { s, o } = ui.cur;
  if (s.phase !== 'play' || ui.me === null || !o.canMove) return;
  const sec = since(goKey(s)) / 1000;
  if (sec > durOf(s)) return;
  const dt = Math.min(0.05, (performance.now() - (ui.last ?? performance.now())) / 1000);
  ui.last = performance.now();
  // キーボード（矢印キー）
  const kx = (ui.keys.has('ArrowRight') ? 1 : 0) - (ui.keys.has('ArrowLeft') ? 1 : 0);
  const ky = (ui.keys.has('ArrowDown') ? 1 : 0) - (ui.keys.has('ArrowUp') ? 1 : 0);
  if (kx || ky) { ui.x = clamp(ui.x + kx * 0.6 * dt, 0.02, 0.98); ui.y = clamp(ui.y + ky * 0.6 * dt, 0.02, H - 0.02); }
  if (s.dead[ui.me] !== null || ui.hit) return;
  const active = ui.mine(sec);
  if (sec >= ui.safeUntil && hitAt(active, sec, ui.x, ui.y)) {
    ui.boomAt = performance.now();
    o.onMove({ t: 'hit', ms: Math.round(sec * 1000), k: ui.hits });
    ui.hits += 1;
    if (ui.hits >= livesOf(s)) { ui.hit = true; return; }
    ui.safeUntil = sec + SAFE_SEC; // 残機があれば続ける
  }
  // 最後の1人になって、ほかの全員より長くもったら終わり
  const others = s.dead.filter((v, p) => p !== ui.me);
  if (s.n >= 2 && others.every((v) => v !== null) && sec * 1000 > maxDead(s) && !ui.sentLast) {
    ui.sentLast = true;
    o.onMove({ t: 'last', ms: Math.round(sec * 1000) });
  }
  const now = performance.now();
  if (now - ui.lastSend > SEND_MS) {
    ui.lastSend = now;
    o.stream({ a: [[ui.me, +ui.x.toFixed(3), +ui.y.toFixed(3)]] });
  }
}

// ホストの端末では CPU の位置も送る（ほかの人の画面に出すため）
function sendCpus() {
  const { s, o } = ui.cur;
  const now = performance.now();
  if (s.phase !== 'play' || now - ui.lastCpuSend < SEND_MS) return;
  ui.lastCpuSend = now;
  const a = [];
  for (let p = 0; p < s.n; p++) {
    const c = sims.get(`${s.seed}:${p}`);
    if (c && !c.dead && s.dead[p] === null) a.push([p, +c.x.toFixed(3), +c.y.toFixed(3)]);
  }
  if (a.length) o.stream({ a });
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize(); // 画面の幅が変わった（向きを変えたときなど、知らせを取りこぼしても合わせ直す）
  step();
  sendCpus();
  draw();
  requestAnimationFrame(() => loop(token));
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 24 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

export default {
  id: 'danmaku',
  name: '弾幕回避',
  icon: '💫',
  desc: 'みんな同じ弾幕の中を、指でよけ続ける。長く残った人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: 'この時間まで残った人は全員1位。後ほど弾が多く速くなる', def: '90', choices: [['60', '60秒'], ['90', '90秒'], ['120', '120秒']] },
    { key: 'lives', label: '残機', desc: '何回当たったら脱落するか。2機・3機なら、当たっても2秒は当たらずに続けられる', def: 1, choices: [[1, '1機（当たったら脱落）'], [2, '2機'], [3, '3機']] },
    { key: 'level', label: '難しさ', desc: '弾の数と速さ。やさしいは少なく遅く、むずかしいは多く速い', def: 'normal', choices: [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '90', level: 'normal', lives: 1, ...rules };
    return { n, seed, rules: r, phase: 'ready', dead: Array(n).fill(null), hits: Array(n).fill(0), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && s.dead[p] === null; },
  sound(a, b, m, me) {
    if (m.p === -1) return 'question';
    if (m.t === 'hit') return m.p === me ? 'wrong' : 'pop';
    return null;
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const sc = Array.from({ length: s.n }, (_, p) => scoreOf(s, p));
    const top = Math.max(...sc);
    const winners = sc.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
    return { winners, scores: sc, survived: aliveSeats(s) };
  },
  resultText(res, me, pn) {
    const ws = res.winners;
    if (ws.length === 1) return ws[0] === me ? 'あなたの勝ち！🎉' : `${pn(ws[0])}の勝ち！`;
    return `${ws.map(pn).join('・')}が最後まで残った！${ws.includes(me) ? '🎉' : ''}`;
  },
  phaseText(s, me) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (me >= 0 && s.dead[me] !== null) return `あなたは ${(s.dead[me] / 1000).toFixed(1)}秒 もちました。ほかの人を見ています…`;
    return '弾をよけ続けよう！';
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'play') return { key: 'play', ms: durOf(s) * 1000 + GRACE_MS, move: { t: 'end' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if ((m.t === 'go' && s0.phase === 'ready') || (m.t === 'end' && s0.phase === 'play')) {
        const s = clone(s0);
        s.step += 1;
        s.phase = m.t === 'go' ? 'play' : 'end';
        return s;
      }
      return null;
    }
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.dead[m.p] !== null) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > durOf(s0) * 1000) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.t === 'hit') {
      if ((m.k ?? 0) !== s0.hits[m.p]) return null; // 同じ当たりが2回届いた
      s.hits[m.p] += 1;
      if (s.hits[m.p] < livesOf(s0)) return s; // 残機がある
      s.dead[m.p] = Math.round(m.ms);
      if (aliveSeats(s).length === 0) s.phase = 'end';
      return s;
    }
    if (m.t === 'last') {
      // 最後の1人が、ほかの全員より長くもった
      if (aliveSeats(s0).length !== 1 || m.ms < maxDead(s0)) return null;
      s.phase = 'end';
      return s;
    }
    return null;
  },

  // CPU（と部屋を出た人の席）: ホストの端末で、始まりからの時刻まで少しずつよける動きを進める
  cpuDelay(s) { return s.phase === 'play' ? 100 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.dead[p] !== null) return null;
    const key = `${s.seed}:${p}`;
    const now = Math.min(since(goKey(s)) / 1000, durOf(s));
    let c = sims.get(key);
    if (!c) {
      c = { x: 0.2 + Math.random() * 0.6, y: H - 0.15, vx: 0, vy: 0, timer: 0, sec: now, dead: null, hitAt: [], safe: 0, view: tracker(bulletsOf(s)) };
      sims.set(key, c);
      if (sims.size > 40) sims.delete(sims.keys().next().value);
    }
    const dt = 1 / 30;
    while (!c.dead && c.sec + dt <= now) {
      c.sec += dt;
      const active = c.view(c.sec);
      cpuStep(c, active, c.sec, dt, Math.random);
      if (c.sec >= c.safe && hitAt(active, c.sec, c.x, c.y)) {
        c.hitAt.push(Math.round(c.sec * 1000));
        c.safe = c.sec + SAFE_SEC;
        if (c.hitAt.length >= livesOf(s)) c.dead = c.hitAt[c.hitAt.length - 1];
      }
    }
    const k = s.hits[p];
    if (k < c.hitAt.length) return { t: 'hit', ms: c.hitAt[k], k }; // まだ送っていない当たり（1回に1つずつ）
    const others = s.dead.filter((v, q) => q !== p);
    if (others.every((v) => v !== null) && now * 1000 > maxDead(s)) return { t: 'last', ms: Math.round(now * 1000) };
    return null;
  },

  onStream(d) {
    if (!ui || !Array.isArray(d?.a)) return;
    for (const e of d.a) {
      if (!Array.isArray(e) || !Number.isInteger(e[0]) || e[0] === ui.me) continue;
      const g = ui.ghosts.get(e[0]) ?? {};
      g.x = clamp(Number(e[1]) || 0, 0, 1);
      g.y = clamp(Number(e[2]) || 0, 0, H);
      g.at = performance.now();
      ui.ghosts.set(e[0], g);
    }
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const sc = s.dead.map((v) => (v === null ? '' : (v / 1000).toFixed(1)));
    const lives = livesOf(s);
    const chips = scoreChips(o, s.dead.map(() => 0), {
      extra: (p) => (s.dead[p] === null ? (s.phase === 'end' ? '最後まで' : lives > 1 ? `残機 ${lives - s.hits[p]}` : '') : `${esc(sc[p])}秒で脱落`),
    });
    chips.querySelectorAll('.pt-score').forEach((e) => e.remove());
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.canvas)) {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      ui.wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null && s.dead[me] === null);
      return;
    }
    root.innerHTML = '';
    root.className = 'board ac';
    const wrap = document.createElement('div');
    wrap.className = 'ac-field';
    const canvas = document.createElement('canvas');
    canvas.className = 'ac-canvas';
    const note = document.createElement('p');
    note.className = 'ac-note';
    note.textContent = '画面を指でなぞると、なぞった分だけ自機が動きます（パソコンはマウスか矢印キー）。当たるのは真ん中の白い点だけ。';
    wrap.append(canvas);
    root.append(chips, wrap, note);
    if (s.phase !== 'end') window.scrollTo(0, 0);
    since(`danmaku:${s.seed}:ready`);
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, wrap, me, cur: { s, o }, scale: 300,
      x: START.x, y: START.y, hit: me !== null && s.hits[me] >= livesOf(s), hits: me !== null ? s.hits[me] : 0, safeUntil: 0, boomAt: 0, sentLast: false, lastSend: 0, lastCpuSend: 0, last: null,
      ghosts: new Map(), keys: new Set(), view: tracker(bulletsOf(s)), mine: tracker(bulletsOf(s)),
    };
    wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null);
    resize();
    // なぞった分だけ動かす（指で自機が隠れないように）。マウスは押さなくても、その位置へ動く
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const b = toBoard(canvas, e);
      drag = { id: e.pointerId, bx: b.x, by: b.y, x: ui.x, y: ui.y };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const b = toBoard(canvas, e);
      if (drag && drag.id === e.pointerId) {
        ui.x = clamp(drag.x + (b.x - drag.bx) * 1.2, 0.02, 0.98);
        ui.y = clamp(drag.y + (b.y - drag.by) * 1.2, 0.02, H - 0.02);
      } else if (e.pointerType === 'mouse') {
        ui.x = clamp(b.x, 0.02, 0.98);
        ui.y = clamp(b.y, 0.02, H - 0.02);
      }
      e.preventDefault();
    });
    const up = (e) => { if (drag?.id === e.pointerId) drag = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    const token = ui;
    const kd = (e) => { if (ui !== token) { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); return; } if (e.key.startsWith('Arrow')) { ui.keys.add(e.key); e.preventDefault(); } };
    const ku = (e) => { if (ui === token) ui.keys.delete(e.key); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    loop(ui);
  },
};
