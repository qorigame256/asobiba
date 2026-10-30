// ボウリング。全員が自分のレーンで同時に投げ、ほかの人の点は表で見える。1〜6人・足りない分は CPU。
// 2026-10-30 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 全員が自分のレーンで同時に投げる（順番待ちを無くすため）。ほかの人の点は横（表）に見える。
//   - 指（PC はマウス）で玉を前へなでて投げる。なでた向きと速さで、玉の向きと強さが決まる。
//   - 10フレーム（本式。詳細設定で5フレームも）。点の付け方は本式（ストライク・スペア）。
//   - ピンの倒れ方は投げた人の端末で計算し、倒れたピンだけを手として送る（端末どうしで結果が食い違わないように）。
// Claude の判断:
//   - 玉は押した所の横の位置から出る（レーンの中だけ）。押したまま前（上）へなでて離すと、離す前の0.1秒の指の動きで向きと速さが決まる。
//     向きはまっすぐから左右25°まで、速さは決まった幅に収める。ゆっくりすぎる・下へなでたときは投げない。
//   - ピンと玉は平らな円としてぶつかり合う（玉はピンの6倍の重さ）。元の場所から少しでも動いたピンは倒れたと数える。玉がレーンから外れたらガター（ピンに当たらない）。
//   - 5フレームの遊び方では、5フレーム目が本式の10フレーム目と同じ（ストライク・スペアなら3投目がある）。
//   - 全員が投げ終えたら終わり。合計の多い順に順位（同じ点は同じ順位）。
//   - CPU は物の動きを計算せず、腕前の見込みで倒すピンを決める（1投目は8%がストライク、ほかは4〜9本。2投目は25%で残りを全部。
//     4000ゲームの試算で平均107点（真ん中の8割が88〜128点）。物の動きで真ん中あたりを適当に狙う人のまねは平均106点だった）。
//     1投ごとに3.2〜5秒あけて投げる（人と同じくらいの速さで進むように。ブラウザで試したら、人は1投に4〜5秒かかった）。
// 詳細設定（2026-10-30 の31回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - ガードレール（bumper）: レーンの両わきに壁が立ち、玉はガターに落ちずに跳ね返る（横の速さを7割にして向きを返す）。ピンは壁に当たらない。
//     CPU は物の動きを計算しないので、ガードレールでも腕前は変えない（もともとガターを出さない）。
//   - 向きの線（guide）: なでている間、玉がそのまま進む道を点線で見せる（ピンに当たったあとの動きは見せない。ガードレールでは壁で折り返す。
//     ガードレールなしでは、レーンの端に着いた所で止める）。向きは離したときと同じく左右25°までに収める。
// 手: { p, t: 'roll', f: 何フレーム目（0 から）, b: そのフレームの何投目（0 から）, k: 倒したピンの番号の一覧 }
//   f と b が局面のその人の今と同じときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。
// ピンの番号: 0 が一番手前（ヘッドピン）、1〜2 が2列目、3〜5 が3列目、6〜9 が一番奥（左から）。

import { scoreChips } from './party.js';
import { fitCanvas, toBoard, clamp } from './action.js';
import { play } from '../sound.js';

export const H = 2.0; // レーンの縦の長さ（横幅 1 に対して）
const LANE_L = 0.15, LANE_R = 0.85;
const PIN_R = 0.04, BALL_R = 0.07;
const START_Y = 1.78; // 玉を置く高さ
const FOUL_Y = 1.55; // ファウルライン（玉はここより手前から出る）
const HEAD_Y = 0.75; // ヘッドピンの高さ
const SP = 0.2; // ピンの横の間
const ROW = SP * 0.866;
export const PINS = [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]]
  .map(([c, r]) => ({ x: 0.5 + (c * SP) / 2, y: HEAD_Y - r * ROW }));
const ALL = 0x3ff;
const MIN_V = 1.1, MAX_V = 3.2; // 玉の速さ（横幅 / 秒）
const MAX_ANGLE = (25 * Math.PI) / 180;
const MOVED = 0.015; // これより動いたピンは倒れた
const SIM_MAX = 4.5; // 計算を打ち切る秒数
const MSG_MS = 1300;

const framesOf = (s) => (s.rules.frames === 5 ? 5 : 10);
const bits = (m) => [...Array(10).keys()].filter((i) => m & (1 << i));
const clone = (s) => ({ ...s, pl: s.pl.map((x) => ({ ...x, frames: x.frames.map((f) => f.slice()) })) });

// フレーム i（0 から）が投げ終わっているか
function frameDone(fr, i, F) {
  if (!fr) return false;
  if (i < F - 1) return fr[0] === 10 || fr.length === 2;
  if (fr.length < 2) return false;
  return fr.length === 3 || fr[0] + fr[1] < 10;
}

// フレームごとの累計（まだ決まらないものは null）
export function totalsOf(frames, F) {
  const flat = frames.flat();
  const out = [];
  let k = 0, sum = 0, ok = true;
  for (let i = 0; i < F; i++) {
    const fr = frames[i];
    let v = null;
    if (ok && fr) {
      if (i < F - 1) {
        if (fr[0] === 10) { if (flat.length > k + 2) v = 10 + flat[k + 1] + flat[k + 2]; k += 1; }
        else if (fr.length === 2) { v = fr[0] + fr[1] === 10 ? (flat.length > k + 2 ? 10 + flat[k + 2] : null) : fr[0] + fr[1]; k += 2; }
      } else if (frameDone(fr, i, F)) v = fr.reduce((a, x) => a + x, 0);
    }
    if (v === null) ok = false;
    else sum += v;
    out.push(ok ? sum : null);
  }
  return out;
}
// いまわかっている合計（ボーナス待ちのフレームは倒した本数だけ数える。札と順位の目安）
const scoreNow = (frames, F) => {
  const t = totalsOf(frames, F);
  let last = -1;
  t.forEach((v, i) => { if (v !== null) last = i; });
  const base = last >= 0 ? t[last] : 0;
  return base + frames.slice(last + 1).flat().reduce((a, x) => a + x, 0);
};

// フレームの印（X・/・-・数）
function marks(fr, i, F) {
  const n = (v) => (v === 0 ? '-' : String(v));
  if (!fr) return [];
  if (i < F - 1) {
    if (fr[0] === 10) return ['', 'X'];
    return [n(fr[0]), fr.length > 1 ? (fr[0] + fr[1] === 10 ? '/' : n(fr[1])) : ''];
  }
  const [a, b, c] = fr;
  const out = [a === 10 ? 'X' : n(a)];
  if (b !== undefined) out.push(a === 10 ? (b === 10 ? 'X' : n(b)) : a + b === 10 ? '/' : n(b));
  if (c !== undefined) out.push((a === 10 && b === 10) || (a !== 10 && a + b === 10) ? (c === 10 ? 'X' : n(c)) : b + c === 10 ? '/' : n(c));
  return out;
}

/* ---------- 物の動き（投げた人の端末だけで計算する） ---------- */

// 玉を (x, START_Y) から (vx, vy) で投げたとき、立っているピン standing のうち倒れるもの（ビット）と、絵に使う道のりを返す
export function simulate(standing, x, vx, vy, { record = false, bumper = false } = {}) {
  const ball = { x, y: START_Y, vx, vy, gutter: false };
  const pins = PINS.map((p, i) => ({ x: p.x, y: p.y, vx: 0, vy: 0, on: !!(standing & (1 << i)), hit: false }));
  const frames = [];
  const dt = 1 / 240;
  for (let t = 0; t < SIM_MAX; t += dt) {
    // 玉
    if (!ball.gutter) {
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      // ガードレール: 壁で跳ね返る
      if (bumper && (ball.x < LANE_L + BALL_R || ball.x > LANE_R - BALL_R)) {
        const left = ball.x < LANE_L + BALL_R;
        ball.x = left ? LANE_L + BALL_R : LANE_R - BALL_R;
        ball.vx = (left ? 1 : -1) * Math.abs(ball.vx) * 0.7;
      }
      // ピンより手前でレーンから外れたらガター（ピンに当たって跳ねた玉はそのまま奥へ）
      if (ball.y > HEAD_Y + PIN_R + BALL_R && (ball.x < LANE_L + BALL_R * 0.3 || ball.x > LANE_R - BALL_R * 0.3)) {
        ball.gutter = true;
        ball.x = ball.x < 0.5 ? LANE_L - BALL_R * 0.55 : LANE_R + BALL_R * 0.55;
        ball.vx = 0;
        ball.vy = -Math.hypot(vx, vy);
      }
    } else ball.y += ball.vy * dt;
    // ピン
    for (const p of pins) {
      if (!p.on) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const f = Math.exp(-2.2 * dt);
      p.vx *= f; p.vy *= f;
    }
    // ぶつかり
    if (!ball.gutter) for (const p of pins) if (p.on) collide(ball, p, 6, BALL_R + PIN_R, 0.75);
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) if (pins[i].on && pins[j].on) collide(pins[i], pins[j], 1, PIN_R * 2, 0.6);
    if (record && Math.round(t / dt) % 8 === 0) frames.push({ bx: ball.x, by: ball.y, p: pins.map((q) => [q.x, q.y]) });
    const still = pins.every((q) => !q.on || Math.hypot(q.vx, q.vy) < 0.01);
    if (ball.y < -0.2 && still) break;
  }
  let down = 0;
  pins.forEach((q, i) => {
    if (q.on && (q.hit || Math.hypot(q.x - PINS[i].x, q.y - PINS[i].y) > MOVED)) down |= 1 << i;
  });
  return { down, frames, gutter: ball.gutter };
}

// 2つの円 a（重さ ma）と b（重さ 1）がめりこんでいたら跳ね返す
function collide(a, b, ma, dist, e) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= dist || d < 1e-9) return;
  const nx = dx / d, ny = dy / d;
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  // めりこみを戻す（重さで分ける）
  const over = dist - d;
  const wa = 1 / (ma + 1), wb = ma / (ma + 1);
  a.x -= nx * over * wa; a.y -= ny * over * wa;
  b.x += nx * over * wb; b.y += ny * over * wb;
  if (rel <= 0) return;
  const j = ((1 + e) * rel) / (1 / ma + 1);
  a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
  b.vx += j * nx; b.vy += j * ny;
  if (j > 0.05) { b.hit = true; if (ma === 1) a.hit = true; } // 強く当たったピンは倒れる（玉には印を付けない）
}

/* ---------- 画面 ---------- */

let ui = null;

const meOf = (o) => (o.me >= 0 && !o.watching ? o.me : null);
const canThrow = (s, o, me) => me !== null && o.canMove && !s.pl[me].done && !ui.sim && !ui.pending && performance.now() - ui.msgAt > 700;

function drawLane() {
  const { s } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  ctx.fillStyle = '#5b636b';
  ctx.fillRect(0, 0, k, k * H);
  // レーン
  const wood = ctx.createLinearGradient(0, 0, k, 0);
  wood.addColorStop(0, '#d9a866'); wood.addColorStop(0.5, '#e8c08a'); wood.addColorStop(1, '#d9a866');
  ctx.fillStyle = wood;
  ctx.fillRect(LANE_L * k, 0, (LANE_R - LANE_L) * k, H * k);
  // ガター
  ctx.fillStyle = '#3d4248';
  ctx.fillRect((LANE_L - 0.1) * k, 0, 0.1 * k, H * k);
  ctx.fillRect(LANE_R * k, 0, 0.1 * k, H * k);
  if (s.rules.bumper) {
    ctx.fillStyle = '#f2c94c';
    ctx.fillRect((LANE_L - 0.03) * k, 0, 0.03 * k, H * k);
    ctx.fillRect(LANE_R * k, 0, 0.03 * k, H * k);
  }
  // ファウルラインと目印の三角
  ctx.fillStyle = '#7a2e1a';
  ctx.fillRect(LANE_L * k, FOUL_Y * k, (LANE_R - LANE_L) * k, 0.008 * k);
  ctx.fillStyle = 'rgba(90,50,20,.45)';
  for (let i = 1; i <= 5; i++) {
    const x = LANE_L + ((LANE_R - LANE_L) * i) / 6;
    const y = 1.2 + Math.abs(i - 3) * 0.03;
    ctx.beginPath();
    ctx.moveTo(x * k, y * k); ctx.lineTo((x - 0.015) * k, (y + 0.05) * k); ctx.lineTo((x + 0.015) * k, (y + 0.05) * k);
    ctx.fill();
  }
  // ピン
  const me = ui.me;
  let pins;
  let ball = null;
  if (ui.sim) {
    const fr = ui.sim.frames[Math.min(ui.sim.frames.length - 1, Math.floor((performance.now() - ui.sim.at) / (1000 / 30)))];
    pins = fr.p.map(([x, y], i) => ({ x, y, on: !!(ui.sim.standing & (1 << i)), fall: Math.hypot(x - PINS[i].x, y - PINS[i].y) > MOVED }));
    ball = { x: fr.bx, y: fr.by };
  } else {
    const standing = ui.pending ? ui.pending.left : me !== null ? s.pl[me].standing : ALL;
    pins = PINS.map((p, i) => ({ x: p.x, y: p.y, on: !!(standing & (1 << i)), fall: false }));
  }
  for (const p of pins) {
    if (!p.on) continue;
    ctx.globalAlpha = p.fall ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(p.x * k, p.y * k, PIN_R * k, 0, Math.PI * 2);
    ctx.fillStyle = '#fafafa';
    ctx.fill();
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x * k, p.y * k, PIN_R * 0.45 * k, 0, Math.PI * 2);
    ctx.strokeStyle = '#d33';
    ctx.lineWidth = Math.max(1.5, k * 0.008);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 玉（投げる前は手もと）
  if (!ball && me !== null && !s.pl[me].done && !ui.pending) ball = { x: ui.ballX, y: ui.ballY };
  if (ball && ball.y > -0.1) {
    ctx.beginPath();
    ctx.arc(ball.x * k, ball.y * k, BALL_R * k, 0, Math.PI * 2);
    const g = ctx.createRadialGradient((ball.x - 0.02) * k, (ball.y - 0.02) * k, 2, ball.x * k, ball.y * k, BALL_R * k);
    g.addColorStop(0, '#5a8fe0'); g.addColorStop(1, '#1d3d7a');
    ctx.fillStyle = g;
    ctx.fill();
  }
  // 向きの線（詳細設定）: なでている間、玉がそのまま進む道
  if (ui.aim && s.rules.guide && ui.aim.y < 0) {
    ctx.save();
    ctx.setLineDash([k * 0.02, k * 0.025]);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = Math.max(1.5, k * 0.006);
    ctx.beginPath();
    ctx.moveTo(ui.ballX * k, ui.ballY * k);
    for (const [x, y] of guidePath(ui.ballX, ui.ballY, ui.aim, !!s.rules.bumper)) ctx.lineTo(x * k, y * k);
    ctx.stroke();
    ctx.restore();
  }
  // なでている間の矢印
  if (ui.aim) {
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = Math.max(2, k * 0.01);
    ctx.beginPath();
    ctx.moveTo(ui.ballX * k, ui.ballY * k);
    ctx.lineTo((ui.ballX + ui.aim.x * 0.35) * k, (ui.ballY + ui.aim.y * 0.35) * k);
    ctx.stroke();
  }
  // 文字
  ctx.textAlign = 'center';
  const msgOn = performance.now() - ui.msgAt < MSG_MS;
  if (msgOn && ui.msg) {
    ctx.font = `bold ${k * 0.11}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = k * 0.012;
    ctx.strokeText(ui.msg, k / 2, k * 1.05);
    ctx.fillText(ui.msg, k / 2, k * 1.05);
  }
  ctx.font = `bold ${Math.max(13, k * 0.045)}px sans-serif`;
  ctx.fillStyle = '#fff';
  let line = '';
  if (me === null) line = '観戦中';
  else if (s.pl[me].done) line = 'おしまい！ ほかの人を待っています';
  else {
    const P = s.pl[me];
    line = `${P.f + 1}フレーム目・${P.frames[P.f]?.length ? P.frames[P.f].length + 1 : 1}投目`;
  }
  ctx.fillText(line, k / 2, k * 0.08);
  if (me !== null && !s.pl[me].done && !ui.sim && !ui.pending && !ui.aim) {
    ctx.font = `${Math.max(11, k * 0.035)}px sans-serif`;
    ctx.fillText('玉を押して、前へなでて離す', k / 2, (H - 0.03) * k);
  }
}

// 向きの線の折れ目（玉の真ん中の通り道。いちばん奥のピンの少し先まで）
function guidePath(x, y, aim, bumper) {
  const ang = clamp(Math.atan2(aim.x, -aim.y), -MAX_ANGLE, MAX_ANGLE);
  let dx = Math.sin(ang);
  const dy = -Math.cos(ang);
  const lo = LANE_L + BALL_R, hi = LANE_R - BALL_R;
  const endY = PINS[6].y - 0.08;
  const pts = [];
  for (let k = 0; k < 6 && y > endY; k++) {
    // 次に壁へ着く所か、奥の端
    const tWall = dx > 1e-9 ? (hi - x) / dx : dx < -1e-9 ? (lo - x) / dx : Infinity;
    const tEnd = (endY - y) / dy;
    if (tEnd <= tWall) { pts.push([x + dx * tEnd, endY]); break; }
    x += dx * tWall; y += dy * tWall;
    pts.push([x, y]);
    if (!bumper) break;
    dx = -dx * 0.7; // simulate と同じく横の速さを7割で返す（縦の速さは変えないので、向きが立つ）
  }
  return pts;
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize();
  if (ui.sim && performance.now() - ui.sim.at > (ui.sim.frames.length * 1000) / 30) finishSim();
  drawLane();
  requestAnimationFrame(() => loop(token));
}

// 投げ終わった: 結果を出して手を送る
function finishSim() {
  const { s, o } = ui.cur;
  const sim = ui.sim;
  ui.sim = null;
  const knocked = bits(sim.down & sim.standing);
  const left = sim.standing & ~sim.down;
  const P = s.pl[ui.me];
  ui.msg = sim.gutter && !knocked.length ? 'ガター…' : !left ? (sim.standing === ALL ? 'ストライク！' : 'スペア！') : `${knocked.length}本`;
  ui.msgAt = performance.now();
  if (!left) play('win'); else play(knocked.length ? 'punch' : 'wrong');
  if (P.done || P.f !== sim.f || (P.frames[P.f]?.length ?? 0) !== sim.b) return; // その間に局面が進んだ（開き直したなど）
  ui.pending = { f: sim.f, b: sim.b, left };
  o.onMove({ t: 'roll', f: sim.f, b: sim.b, k: knocked });
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 30, maxW: 360 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

// 点数の表（全員）
function table(s, o, me) {
  const F = framesOf(s);
  const box = document.createElement('div');
  box.className = 'bw-table';
  const t = document.createElement('table');
  const head = document.createElement('tr');
  head.innerHTML = '<th></th>' + [...Array(F).keys()].map((i) => `<th>${i + 1}</th>`).join('') + '<th>計</th>';
  t.append(head);
  s.pl.forEach((P, p) => {
    const tr = document.createElement('tr');
    if (p === me) tr.className = 'me';
    const name = document.createElement('th');
    name.textContent = p === me ? 'あなた' : o.names[p];
    tr.append(name);
    const tot = totalsOf(P.frames, F);
    for (let i = 0; i < F; i++) {
      const td = document.createElement('td');
      if (i === P.f && !P.done) td.className = 'now';
      td.innerHTML = `<div class="bw-mk">${marks(P.frames[i], i, F).map((m) => `<span>${m}</span>`).join('')}</div><div class="bw-tot">${tot[i] ?? ''}</div>`;
      tr.append(td);
    }
    const sum = document.createElement('td');
    sum.className = 'bw-sum';
    sum.textContent = scoreNow(P.frames, F);
    tr.append(sum);
    t.append(tr);
  });
  box.append(t);
  return box;
}

const cpuWait = new Map();

export default {
  id: 'bowling',
  name: 'ボウリング',
  icon: '🎳',
  desc: '自分のレーンで、みんな同時に投げる。玉を前へなでて投げ、点の多い人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 6,
  settings: [
    { key: 'frames', label: 'フレーム', desc: '1ゲームのフレームの数（5フレームは短い版）', def: 10, choices: [[10, '10フレーム'], [5, '5フレーム']] },
    { key: 'bumper', label: 'ガードレール', desc: 'レーンの両わきに壁が立ち、玉がガターに落ちずに跳ね返る', def: false },
    { key: 'guide', label: '向きの線', desc: 'なでている間、玉がそのまま進む道を点線で見せる', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { frames: 10, ...rules };
    return { n, seed, rules: r, pl: Array.from({ length: n }, () => ({ frames: [], f: 0, standing: ALL, done: false })), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !s.pl[p].done; },
  result(s) {
    if (!s.pl.every((P) => P.done)) return null;
    const F = framesOf(s);
    const scores = s.pl.map((P) => totalsOf(P.frames, F)[F - 1]);
    const place = scores.map((v) => 1 + scores.filter((w) => w > v).length);
    return { winners: place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0), place, scores };
  },
  resultText(res, me, pn) {
    const top = res.scores[res.winners[0]];
    if (res.scores.length === 1) return `おしまい！ ${top}点`;
    if (res.winners.length === 1) return (res.winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(res.winners[0])}の勝ち！`) + `（${top}点）`;
    return `${res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同点で1位！（${top}点）`;
  },
  phaseText(s, me) {
    if (me >= 0 && s.pl[me].done) return 'ほかの人が投げ終わるのを待っています…';
    return '玉を前へなでて投げよう！';
  },
  sound() { return null; }, // 自分の音は投げ終わった画面で鳴らす。ほかの人の手は鳴らさない

  apply(s0, m) {
    if (!m || m.t !== 'roll' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    const P0 = s0.pl[m.p];
    if (P0.done || m.f !== P0.f || m.b !== (P0.frames[P0.f]?.length ?? 0) || !Array.isArray(m.k)) return null;
    if (m.k.length > 10 || new Set(m.k).size !== m.k.length || !m.k.every((i) => Number.isInteger(i) && i >= 0 && i < 10 && (P0.standing & (1 << i)))) return null;
    const s = clone(s0);
    s.step += 1;
    const P = s.pl[m.p];
    const F = framesOf(s);
    const fr = P.frames[P.f] ?? (P.frames[P.f] = []);
    fr.push(m.k.length);
    for (const i of m.k) P.standing &= ~(1 << i);
    if (frameDone(fr, P.f, F)) {
      if (P.f === F - 1) P.done = true;
      else P.f += 1;
      P.standing = ALL;
    } else if (P.f === F - 1 && P.standing === 0) P.standing = ALL; // 最後のフレームのストライク・スペアは並べ直す
    return s;
  },

  // CPU: 腕前の見込みで倒すピンを決める（物の動きは計算しない）
  cpuDelay(s, p) {
    const key = `${s.seed}:${p}:${s.pl[p].f}:${s.pl[p].frames[s.pl[p].f]?.length ?? 0}`;
    if (!cpuWait.has(key)) cpuWait.set(key, 3200 + Math.random() * 1800);
    if (cpuWait.size > 200) cpuWait.delete(cpuWait.keys().next().value);
    return cpuWait.get(key);
  },
  cpu(s, p) {
    const P = s.pl[p];
    if (P.done) return null;
    const up = bits(P.standing);
    let n;
    if (up.length === 10) n = Math.random() < 0.08 ? 10 : 4 + Math.floor(Math.random() * 6);
    else n = Math.random() < 0.25 ? up.length : Math.floor(Math.random() * up.length);
    const k = up.sort(() => Math.random() - 0.5).slice(0, n);
    return { t: 'roll', f: P.f, b: P.frames[P.f]?.length ?? 0, k };
  },

  render(root, s, o) {
    const me = meOf(o);
    const F = framesOf(s);
    const chips = scoreChips(o, s.pl.map((P) => scoreNow(P.frames, F)), {
      extra: (p) => (s.pl[p].done ? '<span class="pt-ok">おわり</span>' : `<span>${s.pl[p].f + 1}F</span>`),
    });
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
        if (P.done || P.f !== ui.pending.f || (P.frames[P.f]?.length ?? 0) !== ui.pending.b) ui.pending = null;
      }
      return;
    }
    root.innerHTML = '';
    root.className = 'board ac bw';
    const wrap = document.createElement('div');
    wrap.className = 'ac-field';
    const canvas = document.createElement('canvas');
    canvas.className = 'ac-canvas';
    wrap.append(canvas);
    root.append(chips, wrap, tbl);
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, tbl, wrap, me, cur: { s, o }, scale: 300,
      sim: null, pending: null, msg: '', msgAt: -1e9, ballX: 0.5, ballY: START_Y, aim: null,
    };
    resize();
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const { s: cs, o: co } = ui.cur;
      if (drag || !canThrow(cs, co, ui.me)) return;
      const b = toBoard(canvas, e);
      if (b.y < FOUL_Y - 0.1) return; // 手もとの辺りだけで押せる
      drag = { id: e.pointerId, pts: [{ t: performance.now(), x: b.x, y: b.y }] };
      ui.ballX = clamp(b.x, LANE_L + BALL_R, LANE_R - BALL_R);
      ui.ballY = START_Y;
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      const b = toBoard(canvas, e);
      const now = performance.now();
      drag.pts.push({ t: now, x: b.x, y: b.y });
      drag.pts = drag.pts.filter((q) => now - q.t < 150);
      const a = drag.pts[0];
      ui.aim = { x: b.x - a.x, y: Math.min(0, b.y - a.y) };
      // 玉は指について動く（ファウルラインより手前だけ）
      ui.ballX = clamp(b.x, LANE_L + BALL_R, LANE_R - BALL_R);
      ui.ballY = clamp(b.y, FOUL_Y + BALL_R, START_Y + 0.12);
      e.preventDefault();
    });
    const up = (e) => {
      if (drag?.id !== e.pointerId) return;
      const now = performance.now();
      const b = toBoard(canvas, e);
      drag.pts.push({ t: now, x: b.x, y: b.y });
      const pts = drag.pts.filter((q) => now - q.t <= 100);
      drag = null;
      ui.aim = null;
      const { s: cs, o: co } = ui.cur;
      if (pts.length < 2 || !canThrow(cs, co, ui.me)) { ui.ballY = START_Y; return; }
      const a = pts[0], z = pts[pts.length - 1];
      const dtv = Math.max(0.016, (z.t - a.t) / 1000);
      let vx = (z.x - a.x) / dtv, vy = (z.y - a.y) / dtv;
      const sp = Math.hypot(vx, vy);
      if (vy > -0.4 || sp < 0.5) { ui.ballY = START_Y; return; } // ゆっくりすぎる・下へなでた
      let ang = Math.atan2(vx, -vy);
      ang = clamp(ang, -MAX_ANGLE, MAX_ANGLE);
      const speed = clamp(sp * 0.7, MIN_V, MAX_V);
      vx = Math.sin(ang) * speed;
      vy = -Math.cos(ang) * speed;
      const P = cs.pl[ui.me];
      const standing = P.standing;
      const res = simulate(standing, ui.ballX, vx, vy, { record: true, bumper: !!cs.rules.bumper });
      ui.sim = { ...res, standing, f: P.f, b: P.frames[P.f]?.length ?? 0, at: performance.now() };
      ui.ballY = START_Y;
      play('draw');
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { drag = null; ui.aim = null; ui.ballY = START_Y; });
    loop(ui);
  },
};
