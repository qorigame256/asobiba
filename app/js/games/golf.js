// ミニゴルフ。全員が同時に自分の画面で打ち、ほかの人の玉は半透明で見える。打数の合計が少ない人の勝ち。1〜6人・足りない分は CPU。
// 2026-11-02 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - ボウリングと同じく全員が同時に自分の画面で打つ。ほかの人の玉は半透明で見える。
//   - 6ホール（詳細設定で3・6・9）。コースは Claude が手で作った9つを順に遊ぶ（3ホールなら1〜3番、6ホールなら1〜6番）。
//   - 1ホール8打まで（入らなくても8打で次のホールへ）。
//   - 仕掛けは 壁・ななめの壁・砂（遅くなる）・水（1打足して打った所へ戻る）・回る風車（羽で跳ね返る）。
// Claude の判断:
//   - 人数は 1〜6人（ボウリングと同じ）。打ち方はビリヤードと同じく、盤のどこかを押して引っ張り、離すと引いたのと逆の向きへ打つ（引いた長さで強さ）。
//     ほんの少ししか引かなかったときは打たない。引いている間は向きの矢印と、まっすぐ進む道の点線（最初に当たる壁まで）を見せる。
//   - 玉の動きは打った人の端末で計算し、止まった位置（または入った・水に落ちた）だけを手として送る（端末どうしで結果が食い違わないように。ボウリングと同じ考え）。
//     打っている途中の玉の位置は見た目だけ送りっぱなし（o.stream）。ほかの人には、同じホールにいる人の玉だけを半透明で見せる。
//   - カップには、玉の真ん中がカップの中に入り、速さが一定より遅いときに入る（速すぎると通り過ぎる）。
//   - 水に落ちたら1打足して打った所へ戻る。8打目を打っても入らなければ、そのホールは8打（水の1打を足して9になっても8）。
//   - 風車の羽の向きは各自の端末の時計で回る（見た目も当たりも打った人の端末だけで決まるので、ずれても困らない）。
//   - 同じ打数の人は同じ順位。
//   - 詳細設定「コースの選び方」（2026-11-02 の32回目の案。本人がおすすめどおり選んだ。分かれ目は Claude の判断）: 順番どおり（最初）・くじで選ぶ（鍵は order）。
//     くじでは9つのコースを種で混ぜ、前からホールの数だけ遊ぶ（同じ対局で同じコースは出ない）。局面の order に、何ホール目がどのコースかを入れる（順番どおりのときは入れない）。
//     ホールの番号は遊ぶ順（1ホール目・2ホール目…）で出す。おまかせで抽選してよい（遊び方なので）。
//   - CPU は玉の動きを計算せず、ホールごとにパーの前後で打数を決め（−1: 10%・パー: 35%・+1: 35%・+2: 15%・+3: 5%）、ティーからカップへ近づく位置で1打ずつ送る。1打ごとに 2.5〜4秒あける。
// 手: { p, t: 'shot', h: 何ホール目（0 から）, k: そのホールで今まで数えた打数, x, y: 止まった位置（盤の横幅を 10000 とした整数）, in: 入ったら 1, pen: 水なら 1 }
//   h と k が局面のその人の今と同じときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { scoreChips } from './party.js';
import { mulberry32, shuffle } from './util.js';
import { fitCanvas, toBoard, clamp, SEAT_COLORS } from './action.js';
import { play } from '../sound.js';

export const H = 1.5; // 盤の縦の長さ（横幅 1 に対して）
export const BALL_R = 0.02;
export const CUP_R = 0.034;
export const MAX_STROKES = 8;
const IN_SPEED = 0.75; // これより遅ければカップに入る
export const MIN_V = 0.25, MAX_V = 2.2; // 打つ速さ（横幅 / 秒）
const PULL_MAX = 0.3; // いっぱいに引いた長さ（盤の横幅に対して）
const SIM_MAX = 15;
const MSG_MS = 1500;
const U = 10000; // 手の位置の単位

// 四角い囲い（左・上・右・下）の点の並び
const box = (l, t, r, b) => [[l, t], [r, t], [r, b], [l, b]];

// コース。area = 囲いの多角形（時計回り）、walls = 中の壁（線分）、sand・water = 四角 [左, 上, 右, 下]、mill = 風車 { x, y, len: 羽の長さ, w: 回る速さ（1秒あたりの角度） }
export const COURSES = [
  { name: 'はじめの一打', par: 2, tee: [0.32, 1.28], cup: [0.64, 0.32], area: box(0.12, 0.12, 0.88, 1.4), walls: [] },
  { name: 'すきまを通す', par: 3, tee: [0.3, 1.28], cup: [0.3, 0.3], area: box(0.1, 0.12, 0.9, 1.4), walls: [[0.1, 0.76, 0.62, 0.76]] },
  {
    name: 'ななめの壁', par: 3, tee: [0.3, 1.25], cup: [0.72, 1.18], area: [[0.1, 0.32], [0.3, 0.12], [0.7, 0.12], [0.9, 0.32], [0.9, 1.4], [0.1, 1.4]],
    walls: [[0.5, 0.48, 0.5, 1.4]],
  },
  { name: '砂の道', par: 2, tee: [0.5, 1.28], cup: [0.5, 0.26], area: box(0.12, 0.12, 0.88, 1.4), walls: [], sand: [[0.24, 0.55, 0.76, 0.86]] },
  { name: '池のわき', par: 3, tee: [0.3, 1.28], cup: [0.3, 0.3], area: box(0.1, 0.12, 0.9, 1.4), walls: [], water: [[0.1, 0.6, 0.6, 0.82]] },
  {
    name: '風車', par: 3, tee: [0.5, 1.28], cup: [0.5, 0.26], area: box(0.1, 0.12, 0.9, 1.4),
    walls: [[0.1, 0.74, 0.36, 0.74], [0.64, 0.74, 0.9, 0.74]], mill: { x: 0.5, y: 0.74, len: 0.17, w: 1.3 },
  },
  {
    name: 'L字', par: 3, tee: [0.27, 1.26], cup: [0.74, 0.33], area: [[0.1, 0.3], [0.3, 0.12], [0.9, 0.12], [0.9, 0.55], [0.45, 0.55], [0.45, 1.4], [0.1, 1.4]],
    walls: [],
  },
  {
    name: '池をこえて', par: 3, tee: [0.5, 1.28], cup: [0.5, 0.26], area: box(0.1, 0.12, 0.9, 1.4), walls: [],
    water: [[0.32, 0.6, 0.68, 0.84]], sand: [[0.18, 0.14, 0.82, 0.2], [0.18, 0.36, 0.36, 0.44], [0.64, 0.36, 0.82, 0.44]],
  },
  {
    name: 'ジグザグ', par: 4, tee: [0.25, 1.28], cup: [0.74, 0.24], area: box(0.1, 0.12, 0.9, 1.4),
    walls: [[0.1, 1.02, 0.62, 1.02], [0.38, 0.62, 0.9, 0.62]], sand: [[0.62, 0.66, 0.9, 0.98]], mill: { x: 0.42, y: 0.36, len: 0.13, w: -1.6 },
  },
];
const HOLES = [[3, '3ホール'], [6, '6ホール'], [9, '9ホール']];
const ORDERS = [['in', '順番どおり'], ['random', 'くじで選ぶ']];
const holesOf = (r) => (HOLES.some(([v]) => v === r.holes) ? r.holes : 6);

const inRect = (x, y, [l, t, r, b]) => x >= l && x <= r && y >= t && y <= b;
// 囲いの辺と中の壁をまとめた線分の一覧
const segsCache = new Map();
export function segsOf(c) {
  if (!segsCache.has(c)) {
    const out = c.area.map((p, i) => [...p, ...c.area[(i + 1) % c.area.length]]);
    segsCache.set(c, out.concat(c.walls));
  }
  return segsCache.get(c);
}
// 点 (x, y) が囲いの中か（多角形の内外）
export function inside(c, x, y) {
  let ok = false;
  const a = c.area;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
// 風車の羽（時刻 sec の線分の一覧。4枚）
export function bladesOf(m, sec) {
  const a0 = m.w * sec;
  return [0, 1, 2, 3].map((k) => {
    const a = a0 + (k * Math.PI) / 2;
    return [m.x, m.y, m.x + Math.cos(a) * m.len, m.y + Math.sin(a) * m.len];
  });
}

// 円（玉）と線分がめりこんでいたら押し戻して跳ね返す。wv = 線分のその点の速さ（風車の羽）
function hitSeg(b, [x1, y1, x2, y2], e, wv) {
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? clamp(((b.x - x1) * dx + (b.y - y1) * dy) / L2, 0, 1) : 0;
  const cx = x1 + dx * t, cy = y1 + dy * t;
  const ox = b.x - cx, oy = b.y - cy;
  const d = Math.hypot(ox, oy);
  if (d >= BALL_R || d < 1e-9) return false;
  const nx = ox / d, ny = oy / d;
  b.x = cx + nx * BALL_R;
  b.y = cy + ny * BALL_R;
  const vx = wv ? wv(cx, cy) : [0, 0];
  const rel = (b.vx - vx[0]) * nx + (b.vy - vx[1]) * ny;
  if (rel < 0) { b.vx -= (1 + e) * rel * nx; b.vy -= (1 + e) * rel * ny; }
  return true;
}

// 玉を (x, y) から (vx, vy) で打ったときの動き。t0 = 打った時刻（秒。風車の向き）。
// 返り値: { x, y: 止まった所, in: 入ったか, water: 水に落ちたか, frames: 絵に使う道のり（1/30秒ごと）, hits: 壁に当たった回数 }
export function simulate(c, x, y, vx, vy, { t0 = 0, record = false } = {}) {
  const b = { x, y, vx, vy };
  const dt = 1 / 240;
  const segs = segsOf(c);
  const frames = [];
  let hits = 0;
  for (let i = 0; i * dt < SIM_MAX; i++) {
    const t = i * dt;
    if (record && i % 8 === 0) frames.push([b.x, b.y]);
    const sp = Math.hypot(b.vx, b.vy);
    // カップ
    if (Math.hypot(b.x - c.cup[0], b.y - c.cup[1]) < CUP_R && sp < IN_SPEED) {
      if (record) frames.push([c.cup[0], c.cup[1]]);
      return { x: c.cup[0], y: c.cup[1], in: true, water: false, frames, hits };
    }
    // 水（囲いの外に出てしまったときも水と同じ）
    if ((c.water ?? []).some((r) => inRect(b.x, b.y, r)) || !inside(c, b.x, b.y)) {
      if (record) frames.push([b.x, b.y]);
      return { x, y, in: false, water: true, frames, hits };
    }
    // 止まる（砂は止まりやすい）
    const sand = (c.sand ?? []).some((r) => inRect(b.x, b.y, r));
    const dec = sand ? 2.6 + 3.2 * sp : 0.55 + 0.25 * sp; // 芝はよく転がる（強さの加減が要るように）
    const ns = sp - dec * dt;
    if (ns <= 0.02) { if (record) frames.push([b.x, b.y]); return { x: b.x, y: b.y, in: false, water: false, frames, hits }; }
    b.vx *= ns / sp; b.vy *= ns / sp;
    b.x += b.vx * dt; b.y += b.vy * dt;
    // 壁・風車
    for (const s of segs) if (hitSeg(b, s, 0.75)) hits += 1;
    if (c.mill) {
      const m = c.mill;
      const wv = (px, py) => [-m.w * (py - m.y), m.w * (px - m.x)]; // 回っている羽のその点の速さ
      for (const s of bladesOf(m, t0 + t)) if (hitSeg(b, s, 0.8, wv)) hits += 1;
    }
  }
  return { x: b.x, y: b.y, in: false, water: false, frames, hits };
}

// 向きの点線: (x, y) から (dx, dy) の向きに、最初に当たる壁まで
function rayToWall(c, x, y, dx, dy) {
  let best = 3;
  for (const [x1, y1, x2, y2] of segsOf(c)) {
    const ex = x2 - x1, ey = y2 - y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - x) * ey - (y1 - y) * ex) / den;
    const u = ((x1 - x) * dy - (y1 - y) * dx) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return Math.max(0, best - BALL_R);
}

const clone = (s) => ({ ...s, pl: s.pl.map((P) => ({ ...P, cards: P.cards.slice() })) });
const total = (P) => P.cards.reduce((a, v) => a + v, 0);
export const courseOf = (s, h) => COURSES[s.order ? s.order[h] : h];
const meOf = (o) => (o.me >= 0 && !o.watching ? o.me : null);
const now = () => performance.now();

/* ---------- 画面 ---------- */

let ui = null;
const canShoot = (s, o, me) => me !== null && o.canMove && !s.pl[me].done && !ui.sim && !ui.pending && now() - ui.msgAt > 900;

function draw() {
  const { s } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  const me = ui.me;
  const P = me !== null ? s.pl[me] : null;
  const h = P ? Math.min(P.h, s.holes - 1) : Math.min(...s.pl.map((q) => q.h), s.holes - 1);
  const c = courseOf(s, h);
  ctx.fillStyle = '#2f5d3a';
  ctx.fillRect(0, 0, k, k * H);
  // 芝
  ctx.beginPath();
  c.area.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
  ctx.closePath();
  ctx.fillStyle = '#5cb85c';
  ctx.fill();
  for (const [l, t, r, b] of c.sand ?? []) { ctx.fillStyle = '#e6cf8f'; ctx.fillRect(l * k, t * k, (r - l) * k, (b - t) * k); }
  for (const [l, t, r, b] of c.water ?? []) {
    ctx.fillStyle = '#3d8fd1'; ctx.fillRect(l * k, t * k, (r - l) * k, (b - t) * k);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (let yy = t + 0.04; yy < b; yy += 0.06) { ctx.beginPath(); ctx.moveTo((l + 0.03) * k, yy * k); ctx.lineTo((l + 0.09) * k, yy * k); ctx.stroke(); }
  }
  // ティーとカップ
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.fillRect((c.tee[0] - 0.035) * k, (c.tee[1] - 0.006) * k, 0.07 * k, 0.012 * k);
  ctx.beginPath(); ctx.arc(c.cup[0] * k, c.cup[1] * k, CUP_R * k, 0, Math.PI * 2); ctx.fillStyle = '#1b1b1b'; ctx.fill();
  ctx.strokeStyle = '#eee'; ctx.lineWidth = Math.max(1.5, k * 0.005);
  ctx.beginPath(); ctx.moveTo(c.cup[0] * k, c.cup[1] * k); ctx.lineTo(c.cup[0] * k, (c.cup[1] - 0.1) * k); ctx.stroke();
  ctx.fillStyle = '#e04b3c';
  ctx.beginPath(); ctx.moveTo(c.cup[0] * k, (c.cup[1] - 0.1) * k); ctx.lineTo((c.cup[0] + 0.055) * k, (c.cup[1] - 0.08) * k); ctx.lineTo(c.cup[0] * k, (c.cup[1] - 0.06) * k); ctx.fill();
  // 壁
  ctx.strokeStyle = '#7a4a22'; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(3, k * 0.014);
  for (const [x1, y1, x2, y2] of segsOf(c)) { ctx.beginPath(); ctx.moveTo(x1 * k, y1 * k); ctx.lineTo(x2 * k, y2 * k); ctx.stroke(); }
  // 風車
  if (c.mill) {
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = Math.max(3, k * 0.016);
    for (const [x1, y1, x2, y2] of bladesOf(c.mill, now() / 1000)) { ctx.beginPath(); ctx.moveTo(x1 * k, y1 * k); ctx.lineTo(x2 * k, y2 * k); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(c.mill.x * k, c.mill.y * k, 0.018 * k, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  }
  // ほかの人の玉（同じホールにいる人だけ。半透明）
  s.pl.forEach((Q, p) => {
    if (p === me || Q.done || Q.h !== h) return;
    const live = ui.ghosts.get(p);
    const pos = live && live.h === h && now() - live.at < 1500 ? live : { x: Q.x / U, y: Q.y / U };
    ball(ctx, k, pos.x, pos.y, SEAT_COLORS[p % SEAT_COLORS.length], 0.45);
  });
  // 自分の玉
  let mine = null;
  if (ui.sim) {
    const f = ui.sim.frames[Math.min(ui.sim.frames.length - 1, Math.floor((now() - ui.sim.at) / (1000 / 30)))];
    mine = { x: f[0], y: f[1] };
  } else if (P && !P.done && !ui.pending) mine = { x: P.x / U, y: P.y / U };
  else if (ui.pending && !ui.pending.done) mine = { x: ui.pending.x, y: ui.pending.y };
  if (mine) ball(ctx, k, mine.x, mine.y, '#ffffff', 1);
  // 引いている間: 向きの点線と矢印
  if (ui.aim && mine) {
    const { dx, dy, pw } = ui.aim;
    const len = rayToWall(c, mine.x, mine.y, dx, dy);
    ctx.save();
    ctx.setLineDash([k * 0.015, k * 0.02]);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = Math.max(1.5, k * 0.005);
    ctx.beginPath(); ctx.moveTo(mine.x * k, mine.y * k); ctx.lineTo((mine.x + dx * len) * k, (mine.y + dy * len) * k); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = `hsl(${120 - pw * 120}, 80%, 45%)`; ctx.lineWidth = Math.max(3, k * 0.012);
    ctx.beginPath(); ctx.moveTo(mine.x * k, mine.y * k); ctx.lineTo((mine.x + dx * (0.05 + pw * 0.2)) * k, (mine.y + dy * (0.05 + pw * 0.2)) * k); ctx.stroke();
  }
  // 文字
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(13, k * 0.042)}px sans-serif`;
  let line;
  if (me === null) line = `観戦中・${h + 1}ホール目「${c.name}」`;
  else if (P.done) line = 'おしまい！ ほかの人を待っています';
  else line = `${P.h + 1}/${s.holes}ホール「${c.name}」 パー${c.par} ・ ${P.n + 1}打目`;
  ctx.fillText(line, k / 2, k * 0.07);
  if (now() - ui.msgAt < MSG_MS && ui.msg) {
    ctx.font = `bold ${k * 0.09}px sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = k * 0.012;
    ctx.strokeText(ui.msg, k / 2, k * 0.78); ctx.fillText(ui.msg, k / 2, k * 0.78);
  } else if (P && !P.done && !ui.sim && !ui.pending && !ui.aim) {
    ctx.font = `${Math.max(11, k * 0.034)}px sans-serif`;
    ctx.fillText('押して引っ張り、離すと反対の向きへ打つ', k / 2, (H - 0.03) * k);
  }
}

function ball(ctx, k, x, y, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(x * k, y * k, BALL_R * k, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize();
  if (ui.sim) {
    const { o } = ui.cur;
    const i = Math.min(ui.sim.frames.length - 1, Math.floor((now() - ui.sim.at) / (1000 / 30)));
    if (now() - ui.lastStream > 120 && ui.sim.frames[i]) {
      ui.lastStream = now();
      const [x, y] = ui.sim.frames[i];
      o.stream?.({ g: [ui.sim.h, +x.toFixed(3), +y.toFixed(3)] });
    }
    if (now() - ui.sim.at > (ui.sim.frames.length * 1000) / 30) finishSim();
  }
  draw();
  requestAnimationFrame(() => loop(token));
}

// 打ち終わった: 結果を出して手を送る
function finishSim() {
  const { s, o } = ui.cur;
  const sim = ui.sim;
  ui.sim = null;
  const P = s.pl[ui.me];
  const n = P.n + 1 + (sim.water ? 1 : 0);
  ui.msg = sim.in ? (n === 1 ? 'ホールインワン！' : `カップイン！ ${n}打`) : sim.water ? '池ポチャ… 1打たす' : n >= MAX_STROKES ? `${MAX_STROKES}打で次のホールへ` : '';
  ui.msgAt = ui.msg ? now() : -1e9;
  if (sim.in) play(n <= courseOf(s, P.h).par ? 'win' : 'goal'); else if (sim.water) play('wrong');
  if (P.done || P.h !== sim.h || P.n !== sim.k) return; // その間に局面が進んだ（開き直したなど）
  ui.pending = { h: sim.h, k: sim.k, x: sim.x, y: sim.y, done: sim.in || n >= MAX_STROKES };
  o.onMove({ t: 'shot', h: sim.h, k: sim.k, x: Math.round(sim.x * U), y: Math.round(sim.y * U), in: sim.in ? 1 : 0, pen: sim.water ? 1 : 0 });
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 30, maxW: 420 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

// 打数の表（全員）
function table(s, o, me) {
  const boxEl = document.createElement('div');
  boxEl.className = 'bw-table';
  const t = document.createElement('table');
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + [...Array(s.holes).keys()].map((i) => `<th>${i + 1}</th>`).join('') + '<th>計</th>';
  const par = document.createElement('tr');
  par.className = 'gf-par';
  par.innerHTML = '<th>パー</th>' + [...Array(s.holes).keys()].map((i) => `<td>${courseOf(s, i).par}</td>`).join('') + `<td>${[...Array(s.holes).keys()].reduce((a, i) => a + courseOf(s, i).par, 0)}</td>`;
  t.append(head, par);
  s.pl.forEach((P, p) => {
    const tr = document.createElement('tr');
    if (p === me) tr.className = 'me';
    const name = document.createElement('th');
    name.textContent = p === me ? 'あなた' : o.names[p];
    tr.append(name);
    for (let i = 0; i < s.holes; i++) {
      const td = document.createElement('td');
      if (i === P.h && !P.done) td.className = 'now';
      const v = P.cards[i];
      td.textContent = v === undefined ? '' : String(v);
      if (v !== undefined && v < courseOf(s, i).par) td.classList.add('gf-good');
      tr.append(td);
    }
    const sum = document.createElement('td');
    sum.className = 'bw-sum';
    sum.textContent = String(total(P) + (P.done ? 0 : P.n));
    tr.append(sum);
    t.append(tr);
  });
  boxEl.append(t);
  return boxEl;
}

const cpuWait = new Map();
const cpuPlan = new Map();

export default {
  id: 'golf',
  name: 'ミニゴルフ',
  icon: '⛳',
  desc: 'みんな同時に自分のコースで打つ。少ない打数でカップに入れた人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 6,
  settings: [
    { key: 'holes', label: 'ホールの数', desc: '1回の対局で回るホールの数', def: 6, choices: HOLES },
    { key: 'order', label: 'コースの選び方', desc: '順番どおり: 1番のコースから順に遊ぶ／くじで選ぶ: 9つのコースから毎回くじで選ぶ（同じ対局で同じコースは出ない）', def: 'in', choices: ORDERS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { holes: 6, ...rules };
    const holes = holesOf(r);
    const order = r.order === 'random' ? shuffle([...COURSES.keys()], mulberry32(seed)).slice(0, holes) : null;
    const c = COURSES[order ? order[0] : 0];
    return {
      n, seed, rules: r, holes, ...(order ? { order } : {}),
      pl: Array.from({ length: n }, () => ({ h: 0, n: 0, x: Math.round(c.tee[0] * U), y: Math.round(c.tee[1] * U), cards: [], done: false })), step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return !s.pl[p].done; },
  result(s) {
    if (!s.pl.every((P) => P.done)) return null;
    const scores = s.pl.map(total);
    const place = scores.map((v) => 1 + scores.filter((w) => w < v).length);
    return { winners: place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0), place, strokes: scores };
  },
  resultText(res, me, pn) {
    const top = res.strokes[res.winners[0]];
    if (res.strokes.length === 1) return `おしまい！ ${top}打`;
    if (res.winners.length === 1) return (res.winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(res.winners[0])}の勝ち！`) + `（${top}打）`;
    return `${res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同点で1位！（${top}打）`;
  },
  phaseText(s, me) {
    if (me >= 0 && s.pl[me].done) return 'ほかの人が回り終わるのを待っています…';
    return '少ない打数でカップに入れよう！';
  },
  sound() { return null; }, // 自分の音は打ち終わった画面で鳴らす。ほかの人の手は鳴らさない

  apply(s0, m) {
    if (!m || m.t !== 'shot' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    const P0 = s0.pl[m.p];
    if (P0.done || m.h !== P0.h || m.k !== P0.n) return null;
    if (!Number.isInteger(m.x) || !Number.isInteger(m.y) || m.x < 0 || m.x > U || m.y < 0 || m.y > H * U) return null;
    if (![0, 1].includes(m.in) || ![0, 1].includes(m.pen) || (m.in && m.pen)) return null;
    const s = clone(s0);
    s.step += 1;
    const P = s.pl[m.p];
    P.n += 1 + m.pen;
    if (m.in || P.n >= MAX_STROKES) {
      P.cards.push(Math.min(P.n, MAX_STROKES));
      P.h += 1;
      P.n = 0;
      if (P.h >= s.holes) { P.done = true; return s; }
      const c = courseOf(s, P.h);
      P.x = Math.round(c.tee[0] * U);
      P.y = Math.round(c.tee[1] * U);
    } else if (!m.pen) { P.x = m.x; P.y = m.y; }
    return s;
  },

  // CPU: ホールごとにパーの前後で打数を決め、カップへ近づく位置で1打ずつ送る（玉の動きは計算しない）
  cpuDelay(s, p) {
    const P = s.pl[p];
    const key = `${s.seed}:${p}:${P.h}:${P.n}`;
    if (!cpuWait.has(key)) cpuWait.set(key, 2500 + Math.random() * 1500);
    if (cpuWait.size > 200) cpuWait.delete(cpuWait.keys().next().value);
    return cpuWait.get(key);
  },
  cpu(s, p) {
    const P = s.pl[p];
    if (P.done) return null;
    const c = courseOf(s, P.h);
    const key = `${s.seed}:${p}:${P.h}`;
    if (!cpuPlan.has(key)) {
      const x = Math.random();
      const d = x < 0.1 ? -1 : x < 0.45 ? 0 : x < 0.8 ? 1 : x < 0.95 ? 2 : 3;
      cpuPlan.set(key, clamp(c.par + d, 1, MAX_STROKES - 1));
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const n = cpuPlan.get(key);
    if (P.n + 1 >= n) return { t: 'shot', h: P.h, k: P.n, x: Math.round(c.cup[0] * U), y: Math.round(c.cup[1] * U), in: 1, pen: 0 };
    const f = ((P.n + 1) / n) * 0.9;
    const jx = (Math.random() - 0.5) * 0.08, jy = (Math.random() - 0.5) * 0.08;
    const x = clamp(c.tee[0] + (c.cup[0] - c.tee[0]) * f + jx, 0.12, 0.88);
    const y = clamp(c.tee[1] + (c.cup[1] - c.tee[1]) * f + jy, 0.14, 1.38);
    return { t: 'shot', h: P.h, k: P.n, x: Math.round(x * U), y: Math.round(y * U), in: 0, pen: 0 };
  },

  onStream(d, from) {
    if (!ui || from === ui.me || !Array.isArray(d?.g)) return;
    const [h, x, y] = d.g.map(Number);
    if (![h, x, y].every(Number.isFinite)) return;
    ui.ghosts.set(from, { h, x: clamp(x, 0, 1), y: clamp(y, 0, H), at: now() });
  },

  render(root, s, o) {
    const me = meOf(o);
    const chips = scoreChips(o, s.pl.map((P) => total(P) + (P.done ? 0 : P.n)), {
      extra: (p) => (s.pl[p].done ? '<span class="pt-ok">おわり</span>' : `<span>${s.pl[p].h + 1}H</span>`),
    });
    chips.querySelectorAll('.pt-score small').forEach((x) => { x.textContent = '打'; });
    const tbl = table(s, o, me);
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.canvas)) {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      tbl.scrollLeft = ui.tbl.scrollLeft;
      ui.tbl.replaceWith(tbl);
      ui.tbl = tbl;
      ui.cur = { s, o };
      // 送った手が局面に入ったら、待ちを解く
      if (ui.pending && me !== null) {
        const P = s.pl[me];
        if (P.done || P.h !== ui.pending.h || P.n !== ui.pending.k) ui.pending = null;
      }
      return;
    }
    root.innerHTML = '';
    root.className = 'board ac bw gf';
    const wrap = document.createElement('div');
    wrap.className = 'ac-field';
    const canvas = document.createElement('canvas');
    canvas.className = 'ac-canvas';
    wrap.append(canvas);
    root.append(chips, wrap, tbl);
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, tbl, wrap, me, cur: { s, o }, scale: 300,
      sim: null, pending: null, msg: '', msgAt: -1e9, aim: null, ghosts: new Map(), lastStream: 0,
    };
    resize();
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const { s: cs, o: co } = ui.cur;
      if (drag || !canShoot(cs, co, ui.me)) return;
      drag = { id: e.pointerId, from: toBoard(canvas, e) };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      const b = toBoard(canvas, e);
      const px = drag.from.x - b.x, py = drag.from.y - b.y; // 引いたのと逆の向き
      const len = Math.hypot(px, py);
      ui.aim = len < 0.015 ? null : { dx: px / len, dy: py / len, pw: Math.min(1, len / PULL_MAX) };
      e.preventDefault();
    });
    const up = (e) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      const aim = ui.aim;
      ui.aim = null;
      const { s: cs, o: co } = ui.cur;
      if (!aim || aim.pw < 0.05 || !canShoot(cs, co, ui.me)) return;
      const P = cs.pl[ui.me];
      const sp = MIN_V + (MAX_V - MIN_V) * aim.pw;
      const res = simulate(courseOf(s, P.h), P.x / U, P.y / U, aim.dx * sp, aim.dy * sp, { t0: now() / 1000, record: true });
      ui.sim = { ...res, h: P.h, k: P.n, at: now() };
      play('smack');
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { drag = null; ui.aim = null; });
    loop(ui);
  },
};
