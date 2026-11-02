// ビリヤード（ナインボール）。2〜4人が順番に打ち、9番を落とした人の勝ち。足りない分は CPU。
// 2026-11-02 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 2〜4人が順番に打つ。
//   - 本式を少しやさしくする: 毎回、台に残るいちばん小さい番号の玉に最初に当てる・9番を落とした人の勝ち・
//     反則（手玉を落とす・違う玉に先に当てる・どの玉にも当たらない）のあとは、次の人が手玉を好きな所に置ける。「3回続けて反則で負け」と「プッシュアウト」は入れない。
//   - 手玉から指（PC はマウス）を引っ張って離して打つ（引いた長さで強さ）。狙いの線は最初に当たる玉まで見せる。回転（スピン）はなし。1打の時間制限はなし。
// Claude の判断:
//   - 引っ張り始めるのは台のどこを押してもよい（手玉の上から始めなくてよい。指で手玉が隠れないように）。手玉を好きな所に置けるときだけ、手玉の近くを押すと手玉を動かす。
//   - 最初の1打（ブレイク）は手玉を台の手前の線より下で好きな所に置ける。反則のあとは台のどこでも（ほかの玉に重ならない所）。
//   - 反則でなく玉を1つ以上落としたら、同じ人が続けて打つ。反則で9番を落としたら、9番は台の上の方の決まった点（ふさがっていれば少し上）に戻す。ほかの玉は落ちたまま。
//   - 9番をいつ落としても（ブレイクでも・ほかの玉と一緒でも）反則でなければ勝ち。
//   - 玉の動きは打った人の端末で計算し、全部の玉の止まった位置（盤の横幅を 10000 とした整数）と、最初に当たった玉・落ちた玉を手として送る
//     （端末どうしで結果が食い違わないように。ボウリングと同じ考え）。ほかの人の画面では、同じ打ち方で動きを再生してから送られた位置に合わせる。
//   - 名前の札の数は、その人が落とした玉の数（反則で落としたのも数える。見た目だけで勝ち負けには使わない）。
//   - CPU は落とせそうなポケットを探して狙うが、向きに 1〜3.5°のずれを入れ、強さも少しばらつかせて弱める。手玉を置けるときは狙いやすい所に置く。
// 手: { p, t: 'shot', n: 何打目（0 から）, cx, cy: 打つ前の手玉の位置, vx, vy: 打った速さ（×10000 の整数）, b: [[番号, x, y]…] 止まった玉, pot: [落ちた番号…], first: 最初に当たった番号 | null }
//   n が局面の打った数と同じときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32, shuffle } from './util.js';
import { scoreChips } from './party.js';
import { fitCanvas, toBoard, clamp } from './action.js';
import { play } from '../sound.js';

export const H = 1.9; // 台の縦の長さ（横幅 1 に対して）
export const L = 0.07, R = 0.93, T = 0.07, B = 1.83; // クッションの内側
export const BR = 0.024; // 玉の半径
const PR = 0.046; // ポケットの半径（玉の真ん中がこの中に入ったら落ちる）
export const POCKETS = [[L, T], [R, T], [L - 0.008, (T + B) / 2], [R + 0.008, (T + B) / 2], [L, B], [R, B]];
export const HEAD_Y = 1.42; // ブレイクの手玉はこれより下（手前）
const FOOT = [0.5, 0.52]; // 9番を戻す点・ラックの真ん中
const MAX_V = 4.2; // いっぱいに引いたときの速さ（横幅 / 秒）
const PULL_MAX = 0.32;
const U = 10000;
const SIM_MAX = 25;
const COLORS = ['#ffffff', '#f2c230', '#2f5fd0', '#d8342c', '#6a3aa8', '#ef7d22', '#1f8a4c', '#8a2a1e', '#222222', '#f2c230'];

/* ---------- 物の動き（打った人の端末で計算する） ---------- */

const nearPocket = (x, y) => POCKETS.some(([px, py]) => Math.sqrt((x - px) ** 2 + (y - py) ** 2) < PR * 1.6);
const offCloth = (b) => b.x < L + BR || b.x > R - BR || b.y < T + BR || b.y > B - BR;

// balls: [{ id, x, y }]（台の上の玉）。手玉 (id 0) を (vx, vy) で打つ。
// 返り値: { balls: 止まった玉 [{ id, x, y }], pot: 落ちた番号, first: 最初に当たった番号 | null, frames: 1/30 秒ごとの位置（record のとき） }
export function simulate(balls0, vx, vy, { record = false } = {}) {
  const bs = balls0.map((b) => ({ ...b, vx: b.id === 0 ? vx : 0, vy: b.id === 0 ? vy : 0, on: true }));
  const dt = 1 / 240;
  const pot = [];
  let first = null;
  const frames = [];
  let steps = 0;
  for (let i = 0; i * dt < SIM_MAX; i++) {
    steps = i;
    if (record && i % 8 === 0) frames.push(bs.map((b) => (b.on ? [b.id, b.x, b.y] : null)).filter(Boolean));
    let moving = false;
    for (const b of bs) {
      if (!b.on) continue;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp < 0.008) {
        b.vx = 0; b.vy = 0;
        if (offCloth(b)) { b.on = false; pot.push(b.id); } // ポケットの口（クッションの線より外）で止まった玉は落ちる
        continue;
      }
      moving = true;
      const ns = Math.max(0, sp - (0.22 + 0.45 * sp) * dt);
      b.vx *= ns / sp; b.vy *= ns / sp;
      b.x += b.vx * dt; b.y += b.vy * dt;
      // ポケット
      if (POCKETS.some(([px, py]) => (b.x - px) ** 2 + (b.y - py) ** 2 < PR * PR)) { b.on = false; pot.push(b.id); continue; }
      // クッション（ポケットの口の辺りでは跳ね返らない）
      if (!nearPocket(b.x, b.y)) {
        if (b.x < L + BR) { b.x = L + BR; b.vx = Math.abs(b.vx) * 0.8; }
        if (b.x > R - BR) { b.x = R - BR; b.vx = -Math.abs(b.vx) * 0.8; }
        if (b.y < T + BR) { b.y = T + BR; b.vy = Math.abs(b.vy) * 0.8; }
        if (b.y > B - BR) { b.y = B - BR; b.vy = -Math.abs(b.vy) * 0.8; }
      } else if (b.x < L - 0.06 || b.x > R + 0.06 || b.y < T - 0.06 || b.y > B + 0.06) { b.on = false; pot.push(b.id); continue; }
    }
    // 玉どうし
    for (let a = 0; a < bs.length; a++) {
      const p = bs[a];
      if (!p.on) continue;
      for (let c = a + 1; c < bs.length; c++) {
        const q = bs[c];
        if (!q.on) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * BR * BR || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const over = 2 * BR - d;
        p.x -= (nx * over) / 2; p.y -= (ny * over) / 2;
        q.x += (nx * over) / 2; q.y += (ny * over) / 2;
        const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
        if (rel <= 0) continue;
        const j = rel * 0.97; // 同じ重さ（はね返りの係数 0.94）
        p.vx -= j * nx; p.vy -= j * ny;
        q.vx += j * nx; q.vy += j * ny;
        if (first === null && (p.id === 0 || q.id === 0)) first = p.id === 0 ? q.id : p.id;
        moving = true;
      }
    }
    if (!moving) break;
  }
  if (record) frames.push(bs.map((b) => (b.on ? [b.id, b.x, b.y] : null)).filter(Boolean));
  return { balls: bs.filter((b) => b.on).map(({ id, x, y }) => ({ id, x, y })), pot, first, frames, d: Math.ceil(steps / 8) };
}

// 手玉を (x, y) から (dx, dy) の向きへ転がしたとき、最初に当たる玉（と当たる所の手玉の真ん中）。当たらなければクッションまで
export function aimHit(balls, x, y, dx, dy) {
  let best = null;
  for (const b of balls) {
    if (b.id === 0) continue;
    const ox = b.x - x, oy = b.y - y;
    const t = ox * dx + oy * dy;
    if (t <= 0) continue;
    const m2 = ox * ox + oy * oy - t * t;
    const r2 = 4 * BR * BR;
    if (m2 >= r2) continue;
    const tt = t - Math.sqrt(r2 - m2);
    if (!best || tt < best.t) best = { t: tt, id: b.id, bx: b.x, by: b.y };
  }
  if (best) return { ...best, x: x + dx * best.t, y: y + dy * best.t };
  // クッションまで
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (R - BR - x) / dx);
  if (dx < -1e-9) t = Math.min(t, (L + BR - x) / dx);
  if (dy > 1e-9) t = Math.min(t, (B - BR - y) / dy);
  if (dy < -1e-9) t = Math.min(t, (T + BR - y) / dy);
  return { t, id: null, x: x + dx * t, y: y + dy * t };
}

/* ---------- 局面 ---------- */

const ballsOf = (s) => s.balls.map(([id, x, y]) => ({ id, x: x / U, y: y / U }));
export const lowestOf = (s) => Math.min(...s.balls.map(([id]) => id).filter((id) => id > 0));
const hasCue = (s) => s.balls.some(([id]) => id === 0);
// 手玉をそこに置けるか（台の中・ほかの玉に重ならない・ブレイクは手前の線より下）
export function canPlace(s, x, y) {
  if (x < L + BR || x > R - BR || y < T + BR || y > B - BR) return false;
  if (s.shots === 0 && y < HEAD_Y) return false;
  return s.balls.every(([id, bx, by]) => id === 0 || (bx / U - x) ** 2 + (by / U - y) ** 2 >= (2 * BR + 0.002) ** 2);
}

// ラック: 1番が手玉に近い先頭、9番が真ん中、ほかはばらばら（種から）
function rack(seed) {
  const rnd = mulberry32(seed);
  const rest = shuffle([2, 3, 4, 5, 6, 7, 8], rnd);
  const dy = 2 * BR * 0.866 + 0.001, dx = BR + 0.0006;
  const spots = [[0, 2], [-1, 1], [1, 1], [-2, 0], [2, 0], [-1, -1], [1, -1], [0, -2]]; // [横, 縦]（縦は上が負）
  const ids = [1, ...rest];
  const out = spots.map(([c, r], i) => [ids[i], Math.round((FOOT[0] + c * dx) * U), Math.round((FOOT[1] + r * dy) * U)]);
  out.push([9, Math.round(FOOT[0] * U), Math.round(FOOT[1] * U)]);
  return out;
}

const clone = (s) => ({ ...s, balls: s.balls.map((b) => b.slice()), got: s.got.slice() });
const meOf = (o) => (o.me >= 0 && !o.watching ? o.me : null);
const now = () => performance.now();

/* ---------- 画面 ---------- */

let ui = null;

function draw() {
  const { s, o } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  // 枠とラシャ
  ctx.fillStyle = '#6b3f1f';
  ctx.fillRect(0, 0, k, k * H);
  ctx.fillStyle = '#1f7a4d';
  ctx.fillRect(L * k, T * k, (R - L) * k, (B - T) * k);
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L * k, HEAD_Y * k); ctx.lineTo(R * k, HEAD_Y * k); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.beginPath(); ctx.arc(FOOT[0] * k, FOOT[1] * k, 2, 0, Math.PI * 2); ctx.fill();
  for (const [px, py] of POCKETS) { ctx.beginPath(); ctx.arc(px * k, py * k, PR * k, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); }
  // 玉
  let balls;
  if (ui.anim) {
    const f = ui.anim.frames[Math.min(ui.anim.frames.length - 1, Math.floor((now() - ui.anim.at) / (1000 / 30)))];
    balls = f.map(([id, x, y]) => ({ id, x, y }));
  } else balls = ballsOf(s);
  if (ui.place && !ui.anim) balls = balls.filter((b) => b.id !== 0).concat([{ id: 0, x: ui.place.x, y: ui.place.y }]);
  const cue = balls.find((b) => b.id === 0);
  // 狙いの線（最初に当たる玉まで）
  if (ui.aim && cue && !ui.anim) {
    const { dx, dy, pw } = ui.aim;
    const hit = aimHit(balls, cue.x, cue.y, dx, dy);
    ctx.save();
    ctx.setLineDash([k * 0.012, k * 0.014]);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(1.5, k * 0.004);
    ctx.beginPath(); ctx.moveTo(cue.x * k, cue.y * k); ctx.lineTo(hit.x * k, hit.y * k); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(hit.x * k, hit.y * k, BR * k, 0, Math.PI * 2); ctx.stroke();
    if (hit.id !== null) {
      // 当たった玉が進む向き（短い線）
      const nx = hit.bx - hit.x, ny = hit.by - hit.y, d = Math.sqrt(nx * nx + ny * ny) || 1;
      ctx.strokeStyle = hit.id === lowestOf(s) ? 'rgba(255,255,255,.85)' : 'rgba(255,90,90,.9)';
      ctx.beginPath(); ctx.moveTo(hit.bx * k, hit.by * k); ctx.lineTo((hit.bx + (nx / d) * 0.12) * k, (hit.by + (ny / d) * 0.12) * k); ctx.stroke();
    }
    ctx.restore();
    // キュー（引いた分だけ下がる）
    const back = 0.03 + pw * 0.1;
    ctx.strokeStyle = '#d9b27a'; ctx.lineWidth = Math.max(3, k * 0.012); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo((cue.x - dx * (BR + back)) * k, (cue.y - dy * (BR + back)) * k);
    ctx.lineTo((cue.x - dx * (BR + back + 0.5)) * k, (cue.y - dy * (BR + back + 0.5)) * k);
    ctx.stroke();
  }
  for (const b of balls) drawBall(ctx, k, b);
  // 手玉を置けるときの印
  if (ui.canPlace && cue && !ui.anim && !ui.aim) {
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cue.x * k, cue.y * k, BR * 2.2 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  // 文字
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(12, k * 0.04)}px sans-serif`;
  if (!s.winner && s.winner !== 0) {
    const who = s.turn === ui.me ? 'あなた' : o.names[s.turn];
    ctx.fillText(`${who}の番 ・ ねらうのは ${lowestOf(s)}番`, k / 2, T * k - 8 > 10 ? T * k * 0.7 : 14);
  }
  if (now() - ui.msgAt < 2200 && ui.msg) {
    ctx.font = `bold ${k * 0.06}px sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = k * 0.01;
    ctx.strokeText(ui.msg, k / 2, k * 0.95); ctx.fillText(ui.msg, k / 2, k * 0.95);
  } else if (ui.mine && !ui.anim && !ui.aim) {
    ctx.font = `${Math.max(11, k * 0.032)}px sans-serif`;
    ctx.fillText(ui.canPlace ? '手玉を押して動かせる・ほかを押して引っ張ると打つ' : '押して引っ張り、離すと反対の向きへ打つ', k / 2, (B + (H - B) * 0.65) * k);
  }
}

function drawBall(ctx, k, b) {
  const x = b.x * k, y = b.y * k, r = BR * k;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = COLORS[b.id]; ctx.fill();
  if (b.id === 9) { // 9番は白地に黄色の帯
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = COLORS[9]; ctx.fillRect(x - r, y - r * 0.55, r * 2, r * 1.1);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1; ctx.stroke();
  if (b.id > 0) {
    ctx.beginPath(); ctx.arc(x, y, r * 0.52, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = `bold ${Math.max(8, r * 0.85)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), x, y + 0.5);
    ctx.textBaseline = 'alphabetic';
  }
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize();
  if (ui.anim && now() - ui.anim.at > (ui.anim.frames.length * 1000) / 30) {
    const a = ui.anim;
    ui.anim = null;
    if (a.pot.length) play('drop');
    if (a.send) ui.cur.o.onMove(a.send);
  }
  draw();
  requestAnimationFrame(() => loop(token));
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 20, maxW: 380 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

// 打った結果の一言（全員の画面に出す）
function shotMsg(s) {
  const x = s.last;
  if (!x) return '';
  if (x.win !== undefined) return '9番が落ちた！';
  if (x.foul) return x.foul;
  return x.pot.length ? `${x.pot.join('・')}番が落ちた！続けて打てる` : '';
}

// 打つ（自分の画面）: 動きを計算して見せ、見せ終わったら手を送る
function shoot(s, o, vx, vy) {
  const balls = ballsOf(s);
  const cueAt = ui.place ?? balls.find((b) => b.id === 0);
  const start = balls.filter((b) => b.id !== 0).concat([{ id: 0, x: cueAt.x, y: cueAt.y }]);
  const res = simulate(start, vx, vy, { record: true });
  ui.place = null;
  ui.anim = {
    frames: res.frames, at: now(), pot: res.pot, n: s.shots,
    send: { t: 'shot', n: s.shots, cx: Math.round(cueAt.x * U), cy: Math.round(cueAt.y * U), vx: Math.round(vx * U), vy: Math.round(vy * U), b: res.balls.map((b) => [b.id, Math.round(b.x * U), Math.round(b.y * U)]), pot: res.pot, first: res.first, d: res.d },
  };
  ui.shown = s.shots + 1; // 自分の打った手は再生し直さない
  play('smack');
}

export default {
  id: 'billiards',
  name: 'ビリヤード',
  icon: '🎱',
  desc: 'ナインボール。順番に打ち、いちばん小さい番号の玉から当てて、9番を落とした人の勝ち',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 4,

  init(n, seed) {
    return {
      n, seed, balls: [[0, Math.round(0.5 * U), Math.round(1.6 * U)], ...rack(seed)], turn: 0, hand: true, shots: 0,
      got: Array(n).fill(0), last: null, winner: null, step: 0,
    };
  },

  turn(s) { return s.winner === null ? s.turn : null; },
  canAct(s, p) { return s.winner === null && s.turn === p; },
  result(s) { return s.winner === null ? null : { winner: s.winner }; },
  sound() { return null; }, // 打つ音・落ちる音は動きを見せる中で鳴らす
  // CPU は前の打球の動き（d は 1/30 秒の数）を見せ終わってから打つ
  cpuDelay(s) { return 1400 + ((s.last?.d ?? 0) * 1000) / 30; },

  apply(s0, m) {
    if (!m || m.t !== 'shot' || s0.winner !== null || m.p !== s0.turn || m.n !== s0.shots) return null;
    const ints = (...v) => v.every((x) => Number.isInteger(x));
    if (!ints(m.cx, m.cy, m.vx, m.vy) || !Array.isArray(m.b) || !Array.isArray(m.pot) || !(m.first === null || Number.isInteger(m.first))) return null;
    const ids = s0.balls.map(([id]) => id);
    // 打つ前の手玉: 置けるときは置いた所、ほかは今の所
    if (s0.hand) {
      if (!canPlace(s0, m.cx / U, m.cy / U)) return null;
    } else {
      const c = s0.balls.find(([id]) => id === 0);
      if (!c || c[1] !== m.cx || c[2] !== m.cy) return null;
    }
    // 止まった玉と落ちた玉で、打つ前の玉がちょうど分かれていること
    const after = m.b.map((x) => x?.[0]);
    if (!m.b.every((x) => Array.isArray(x) && x.length === 3 && ints(...x) && x[1] >= 0 && x[1] <= U && x[2] >= 0 && x[2] <= H * U)) return null;
    const all = [...after, ...m.pot].sort((a, b) => a - b);
    const want = (s0.hand && !ids.includes(0) ? [0, ...ids] : ids).slice().sort((a, b) => a - b);
    if (all.length !== want.length || all.some((v, i) => v !== want[i])) return null;
    if (m.first !== null && (m.first === 0 || !want.includes(m.first))) return null;
    const s = clone(s0);
    s.step += 1;
    s.shots += 1;
    const low = lowestOf(s0);
    const cueIn = m.pot.includes(0);
    let foul = '';
    if (cueIn) foul = 'ファウル: 手玉が落ちた';
    else if (m.first === null) foul = 'ファウル: どの玉にも当たらなかった';
    else if (m.first !== low) foul = `ファウル: ${low}番より先に${m.first}番に当たった`;
    s.balls = m.b.map((x) => x.slice());
    const potted = m.pot.filter((id) => id > 0);
    s.got[m.p] += potted.length;
    s.last = { p: m.p, n: s0.shots, cx: m.cx, cy: m.cy, vx: m.vx, vy: m.vy, from: s0.balls.map((b) => b.slice()), pot: potted, foul, d: Number.isInteger(m.d) ? clamp(m.d, 0, SIM_MAX * 30) : 0 };
    if (potted.includes(9) && !foul) {
      s.winner = m.p;
      s.last.win = m.p;
      return s;
    }
    if (potted.includes(9)) {
      // 反則で9番を落としたら戻す（ふさがっていれば少し上へ）
      let y = FOOT[1];
      while (s.balls.some(([, bx, by]) => (bx / U - FOOT[0]) ** 2 + (by / U - y) ** 2 < (2 * BR + 0.002) ** 2) && y > T + BR) y -= 0.01;
      s.balls.push([9, Math.round(FOOT[0] * U), Math.round(y * U)]);
    }
    if (foul) {
      s.turn = (m.p + 1) % s.n;
      s.hand = true;
    } else {
      s.hand = false;
      if (!potted.length) s.turn = (m.p + 1) % s.n;
    }
    if (cueIn) s.balls = s.balls.filter(([id]) => id !== 0);
    return s;
  },

  // CPU: いちばん小さい番号の玉を落とせそうなポケットを探して狙う。向きと強さに少しずれを入れて弱める
  cpu(s, p) {
    if (s.winner !== null || s.turn !== p) return null;
    const balls = ballsOf(s);
    const low = lowestOf(s);
    const tb = balls.find((b) => b.id === low);
    let cue = balls.find((b) => b.id === 0) ?? null;
    const plans = [];
    for (const [px, py] of POCKETS) {
      const ex = px - tb.x, ey = py - tb.y, ed = Math.sqrt(ex * ex + ey * ey);
      const gx = tb.x - (ex / ed) * 2 * BR, gy = tb.y - (ey / ed) * 2 * BR; // 当てる所の手玉の真ん中
      let from = cue;
      if (s.hand) {
        // 狙いやすい所に置く: 当てる所からポケットと逆の向きへ少し下がった所
        const tries = [0.25, 0.18, 0.32, 0.12];
        from = null;
        for (const back of tries) {
          const x = gx - (ex / ed) * back, y = gy - (ey / ed) * back;
          if (canPlace(s, x, y)) { from = { id: 0, x, y }; break; }
        }
        if (!from) continue;
      }
      const ax = gx - from.x, ay = gy - from.y, ad = Math.sqrt(ax * ax + ay * ay);
      if (ad < 1e-6) continue;
      const cut = Math.acos(clamp((ax * ex + ay * ey) / (ad * ed), -1, 1));
      if (cut > (75 * Math.PI) / 180) continue;
      const hit = aimHit(balls.filter((b) => b.id !== 0), from.x, from.y, ax / ad, ay / ad);
      if (hit.id !== low) continue; // ほかの玉にじゃまされる
      plans.push({ from, ax: ax / ad, ay: ay / ad, cost: cut * 1.5 + ad + ed, dist: ad + ed });
    }
    let plan = plans.sort((a, b) => a.cost - b.cost)[0];
    if (!plan) {
      // 落とせる筋が無ければ、とにかく狙う玉にまっすぐ当てる
      if (!cue || s.hand) {
        const spots = [[0.5, 1.6], [0.3, 1.6], [0.7, 1.6], [0.5, 1.2], [0.25, 1.0], [0.75, 1.0]];
        const sp = spots.find(([x, y]) => canPlace(s, x, y)) ?? [0.5, 1.7];
        cue = { id: 0, x: sp[0], y: sp[1] };
      }
      const ax = tb.x - cue.x, ay = tb.y - cue.y, ad = Math.sqrt(ax * ax + ay * ay) || 1;
      plan = { from: cue, ax: ax / ad, ay: ay / ad, dist: ad + 0.4 };
    }
    const err = (((0.4 + Math.random() * 1.6) * Math.PI) / 180) * (Math.random() < 0.5 ? -1 : 1);
    const a = Math.atan2(plan.ay, plan.ax) + err;
    const speed = clamp((0.6 + plan.dist * 0.9) * (0.85 + Math.random() * 0.3), 0.6, MAX_V);
    const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
    const start = balls.filter((b) => b.id !== 0).concat([{ id: 0, x: plan.from.x, y: plan.from.y }]);
    const res = simulate(start, vx, vy);
    return {
      t: 'shot', n: s.shots, cx: Math.round(plan.from.x * U), cy: Math.round(plan.from.y * U), vx: Math.round(vx * U), vy: Math.round(vy * U),
      b: res.balls.map((b) => [b.id, Math.round(b.x * U), Math.round(b.y * U)]), pot: res.pot, first: res.first, d: res.d,
    };
  },

  resultText(res, me, pn) { return res.winner === me ? 'あなたの勝ち！🎉 9番を落とした' : `${pn(res.winner)}の勝ち！（9番を落とした）`; },

  render(root, s, o) {
    const me = meOf(o);
    const chips = scoreChips(o, s.got, { turn: s.winner === null ? s.turn : null, won: s.winner !== null ? [s.winner] : [] });
    chips.querySelectorAll('.pt-score small').forEach((x) => { x.textContent = '個'; });
    const info = document.createElement('p');
    info.className = 'cc-log bl-info';
    const lastTxt = shotMsg(s);
    const myTurn = me !== null && s.winner === null && s.turn === me && o.canMove;
    info.textContent = s.winner !== null ? '' : (lastTxt ? lastTxt + '　' : '') + (myTurn ? (s.hand ? 'あなたの番（手玉を好きな所に置ける）' : 'あなたの番') : '');
    const key = `${s.seed}:${me}`;
    const fresh = !(ui?.key === key && root.contains(ui.canvas));
    if (fresh) {
      root.innerHTML = '';
      root.className = 'board ac bl';
      const wrap = document.createElement('div');
      wrap.className = 'ac-field';
      const canvas = document.createElement('canvas');
      canvas.className = 'ac-canvas';
      wrap.append(canvas);
      root.append(chips, info, wrap);
      ui = { key, canvas, ctx: canvas.getContext('2d'), chips, info, wrap, me, cur: { s, o }, scale: 300, anim: null, aim: null, place: null, msg: '', msgAt: -1e9, shown: s.shots };
      resize();
      hook(canvas);
      loop(ui);
    } else {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.info.replaceWith(info);
      ui.info = info;
      ui.cur = { s, o };
    }
    // ほかの人（CPU を含む）が打った手: 同じ打ち方で動きを再生してから、送られた位置に合わせる
    if (s.shots > ui.shown) {
      ui.shown = s.shots;
      const x = s.last;
      if (x && x.n === s.shots - 1 && !fresh) {
        const start = x.from.filter(([id]) => id !== 0).map(([id, bx, by]) => ({ id, x: bx / U, y: by / U })).concat([{ id: 0, x: x.cx / U, y: x.cy / U }]);
        const res = simulate(start, x.vx / U, x.vy / U, { record: true });
        ui.anim = { frames: res.frames.concat([ballsOf(s).map((b) => [b.id, b.x, b.y])]), at: now(), pot: x.pot, send: null };
        play('smack');
      }
    }
    if (s.last && (ui.lastMsgN ?? -1) < s.last.n) {
      ui.lastMsgN = s.last.n;
      ui.msg = shotMsg(s);
      ui.msgAt = now() + (ui.anim ? (ui.anim.frames.length * 1000) / 30 : 0);
    }
    ui.mine = myTurn;
    ui.canPlace = myTurn && s.hand;
    if (!ui.canPlace) ui.place = null;
    else if (!ui.place) {
      const c = s.balls.find(([id]) => id === 0);
      const def = c && canPlace(s, c[1] / U, c[2] / U) ? { x: c[1] / U, y: c[2] / U } : [[0.5, 1.6], [0.3, 1.6], [0.7, 1.6], [0.5, 1.7], [0.5, 1.2]].map(([x, y]) => ({ x, y })).find((q) => canPlace(s, q.x, q.y));
      ui.place = def ?? { x: 0.5, y: 1.7 };
    }
  },
};

// 押す・引っ張る・離す
function hook(canvas) {
  let drag = null;
  const ready = () => ui.mine && !ui.anim && ui.cur.s.winner === null;
  canvas.addEventListener('pointerdown', (e) => {
    if (drag || !ready()) return;
    const b = toBoard(canvas, e);
    const { s } = ui.cur;
    const cue = ui.place ?? ballsOf(s).find((q) => q.id === 0);
    const mode = ui.canPlace && cue && (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2 < (BR * 3.2) ** 2 ? 'move' : 'aim';
    drag = { id: e.pointerId, from: b, mode };
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    const b = toBoard(canvas, e);
    if (drag.mode === 'move') {
      const { s } = ui.cur;
      const x = Math.round(clamp(b.x, L + BR, R - BR) * U) / U, y = Math.round(clamp(b.y, s.shots === 0 ? HEAD_Y : T + BR, B - BR) * U) / U;
      if (canPlace(s, x, y)) ui.place = { x, y };
    } else {
      const px = drag.from.x - b.x, py = drag.from.y - b.y;
      const len = Math.sqrt(px * px + py * py);
      ui.aim = len < 0.012 ? null : { dx: px / len, dy: py / len, pw: Math.min(1, len / PULL_MAX) };
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag?.id !== e.pointerId) return;
    const mode = drag.mode;
    drag = null;
    const aim = ui.aim;
    ui.aim = null;
    if (mode !== 'aim' || !aim || aim.pw < 0.04 || !ready()) return;
    const sp = 0.15 + (MAX_V - 0.15) * aim.pw;
    shoot(ui.cur.s, ui.cur.o, aim.dx * sp, aim.dy * sp);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; ui.aim = null; });
}
