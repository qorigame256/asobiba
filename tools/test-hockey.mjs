// エアホッケーの動きの自動確認（node tools/test-hockey.mjs）。
// CPU どうし（下側は上下を入れ替えて同じ CPU を使う）で何試合も打たせ、パックが盤の外へ抜けない・決着が付く・
// 強い CPU が弱い CPU に勝ち越す、を確かめる。3人（六角形の盤）も同じことを確かめる。画面は使わない。
import {
  stepPuck, cpuTarget, clampMallet, CPU_LEVELS, stepHex, clampHex, cpuHex, zoneHex, addGoal, overOf, HEX_A, GOAL3,
} from '../app/js/games/hockey.js';
import { mulberry32 } from '../app/js/games/util.js';

const W = 1;
const H = 1.6;
const R_P = 0.042;
const GOAL = 0.36;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) failed++;
};

function move(m, p, t, maxV, dt) {
  const c = clampMallet(p, t.x, t.y);
  const dx = c.x - m.x;
  const dy = c.y - m.y;
  const d = Math.hypot(dx, dy);
  const s = Math.min(d, maxV * dt);
  const nx = d ? m.x + (dx / d) * s : m.x;
  const ny = d ? m.y + (dy / d) * s : m.y;
  m.vx = (nx - m.x) / dt; m.vy = (ny - m.y) / dt; m.x = nx; m.y = ny;
}
const flip = (o) => ({ x: W - o.x, y: H - o.y, vx: -(o.vx ?? 0), vy: -(o.vy ?? 0) });

// 1試合。lv0 = 下側の CPU、lv1 = 上側の CPU。返り値は勝った側・時間・おかしな所
function match(lv0, lv1, seed, target = 7) {
  const rnd = mulberry32(seed);
  const score = [0, 0];
  let puck = { x: W / 2, y: H * 0.72, vx: 0, vy: 0 };
  const ms = [{ x: W / 2, y: H - 0.16, vx: 0, vy: 0 }, { x: W / 2, y: 0.16, vx: 0, vy: 0 }];
  const goals = [{ ...ms[0] }, { ...ms[1] }];
  const timers = [0, 0];
  const dt = 1 / 60;
  let t = 0;
  let maxV = 0;
  let stuck = 0;
  while (t < 1200) {
    t += dt;
    for (const p of [0, 1]) {
      timers[p] -= dt;
      if (timers[p] > 0) continue;
      const lv = p === 0 ? lv0 : lv1;
      timers[p] = lv.react;
      goals[p] = p === 1 ? cpuTarget(puck, ms[1], lv, rnd) : flip(cpuTarget(flip(puck), flip(ms[0]), lv, rnd));
    }
    const n = Math.ceil(dt / (1 / 240));
    let g = null;
    for (let i = 0; i < n && g === null; i++) {
      move(ms[0], 0, goals[0], lv0.speed, dt / n);
      move(ms[1], 1, goals[1], lv1.speed, dt / n);
      g = stepPuck(puck, ms, dt / n);
      maxV = Math.max(maxV, Math.hypot(puck.vx, puck.vy));
      const out = puck.x < R_P - 1e-9 || puck.x > W - R_P + 1e-9
        || ((puck.y < R_P - 1e-6 || puck.y > H - R_P + 1e-6) && Math.abs(puck.x - W / 2) >= GOAL / 2);
      if (out) return { error: `パックが壁を抜けた (${puck.x.toFixed(3)}, ${puck.y.toFixed(3)})` };
    }
    stuck = Math.hypot(puck.vx, puck.vy) < 0.02 ? stuck + dt : 0;
    if (stuck > 20) return { error: `パックが20秒止まったまま (${puck.x.toFixed(2)}, ${puck.y.toFixed(2)})` };
    if (g !== null) {
      score[g]++;
      if (score[g] >= target) return { winner: g, t, score, maxV };
      puck = { x: W / 2, y: g === 0 ? H * 0.28 : H * 0.72, vx: 0, vy: 0 };
    }
  }
  return { error: '20分たっても決着しない', score };
}

const L = CPU_LEVELS;
let wins = { strongVsWeak: 0, normalVsWeak: 0 };
let errors = 0;
let longest = 0;
let fastest = 0;
for (let seed = 1; seed <= 20; seed++) {
  for (const [key, a, b] of [['strongVsWeak', L.strong, L.weak], ['normalVsWeak', L.normal, L.weak]]) {
    // 強い方を上下どちらにも置く
    const r1 = match(a, b, seed);
    const r2 = match(b, a, seed + 100);
    for (const [r, strongSide] of [[r1, 0], [r2, 1]]) {
      if (r.error) { errors++; if (errors <= 3) console.log('   ' + r.error); continue; }
      if (r.winner === strongSide) wins[key]++;
      longest = Math.max(longest, r.t);
      fastest = Math.max(fastest, r.maxV);
    }
  }
}
check('80試合でパックが壁を抜けない・止まり続けない・必ず決着する', errors === 0, `${errors}件`);
check('つよいはよわいに勝ち越す（40試合）', wins.strongVsWeak >= 30, `${wins.strongVsWeak}勝`);
check('ふつうはよわいに勝ち越す（40試合）', wins.normalVsWeak >= 24, `${wins.normalVsWeak}勝`);
console.log(`   いちばん長い試合 ${Math.round(longest)}秒・パックの最高速度 ${fastest.toFixed(2)}`);

// 当たりの確かめ: 止まったパックへマレットが動いて当たると、マレットの向きへ飛ぶ
{
  const puck = { x: 0.5, y: 1.2, vx: 0, vy: 0 };
  const m = { x: 0.5, y: 1.2 + R_P + 0.07 + 0.01, vx: 0, vy: -2 };
  for (let i = 0; i < 20; i++) { m.y += m.vy / 240; stepPuck(puck, [m], 1 / 240); }
  check('下から打ったパックは上へ飛ぶ', puck.vy < -1, `vy=${puck.vy.toFixed(2)}`);
}
// ゴール: 口の中なら入る、口の外なら跳ね返る
{
  const inMouth = { x: 0.5, y: 0.1, vx: 0, vy: -3 };
  let g = null;
  for (let i = 0; i < 240 && g === null; i++) g = stepPuck(inMouth, [], 1 / 240);
  check('上のゴールに入ると赤（下側）の点', g === 0);
  const wall = { x: 0.15, y: 0.1, vx: 0, vy: -3 };
  g = null;
  for (let i = 0; i < 60 && g === null; i++) g = stepPuck(wall, [], 1 / 240); // 0.25秒（下の壁に届く前）
  check('ゴールの外の壁では跳ね返る', g === null && wall.vy > 0);
}

/* ---------- 3人（六角形の盤） ---------- */

const dir = (deg) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
const seatDir = (p) => dir(90 + 120 * p);
const EDGE_DEGS = [30, 90, 150, 210, 270, 330];
// 盤の内側にいるか（ゴールの口の前は外へ出てよい）。r = 円の半径
function insideHex(o, r, allowMouth) {
  for (const deg of EDGE_DEGS) {
    const u = dir(deg);
    const d = o.x * u.x + o.y * u.y;
    const t = -o.x * u.y + o.y * u.x;
    const mouth = allowMouth && (deg - 90) % 120 === 0 && Math.abs(t) < GOAL3 / 2;
    if (!mouth && d > HEX_A - r + 1e-6) return false;
  }
  return true;
}
// 席 p の扇形の中か（境目から r 以上離れている）
function inSector(p, o, r) {
  const c = 90 + 120 * p;
  return [dir(c + 30), dir(c - 30)].every((n) => o.x * n.x + o.y * n.y >= r - 1e-6);
}
function moveHex(m, p, t, maxV, dt) {
  const c = clampHex(p, t.x, t.y);
  const dx = c.x - m.x;
  const dy = c.y - m.y;
  const d = Math.hypot(dx, dy);
  const s = Math.min(d, maxV * dt);
  const nx = d ? m.x + (dx / d) * s : m.x;
  const ny = d ? m.y + (dy / d) * s : m.y;
  m.vx = (nx - m.x) / dt; m.vy = (ny - m.y) / dt; m.x = nx; m.y = ny;
}
const homeHex = (p) => { const u = seatDir(p); return { x: u.x * (HEX_A - 0.16), y: u.y * (HEX_A - 0.16), vx: 0, vy: 0 }; };

// 1試合。lvs = 席ごとの CPU の強さ。返り値は順位・時間・おかしな所
function match3(lvs, seed, target = 7) {
  const rnd = mulberry32(seed);
  let score = [0, 0, 0];
  let puck = { x: 0, y: 0.3, vx: 0, vy: 0 };
  const ms = [0, 1, 2].map(homeHex);
  const goals = ms.map((m) => ({ ...m }));
  const timers = [0, 0, 0];
  const dt = 1 / 60;
  let t = 0;
  let stuck = 0;
  while (t < 1200) {
    t += dt;
    for (const p of [0, 1, 2]) {
      timers[p] -= dt;
      if (timers[p] > 0) continue;
      timers[p] = lvs[p].react;
      goals[p] = cpuHex(p, puck, ms[p], lvs[p], rnd, ms);
    }
    const n = Math.ceil(dt / (1 / 240));
    let g = null;
    for (let i = 0; i < n && g === null; i++) {
      for (const p of [0, 1, 2]) {
        moveHex(ms[p], p, goals[p], lvs[p].speed, dt / n);
        if (!insideHex(ms[p], 0.07, false) || !inSector(p, ms[p], 0.07)) return { error: `マレット${p}が範囲の外 (${ms[p].x.toFixed(3)}, ${ms[p].y.toFixed(3)})` };
      }
      g = stepHex(puck, ms, dt / n);
      if (g === null && !insideHex(puck, R_P, true)) return { error: `パックが壁を抜けた (${puck.x.toFixed(3)}, ${puck.y.toFixed(3)})` };
    }
    stuck = Math.hypot(puck.vx, puck.vy) < 0.02 ? stuck + dt : 0;
    if (stuck > 20) return { error: `パックが20秒止まったまま (${puck.x.toFixed(2)}, ${puck.y.toFixed(2)})` };
    if (g !== null) {
      score = addGoal(3, score, g);
      const over = overOf(3, score, target);
      if (over) return { rank: over.rank, t, score };
      const u = seatDir(g);
      puck = { x: u.x * 0.3, y: u.y * 0.3, vx: 0, vy: 0 };
    }
  }
  return { error: '20分たっても決着しない', score };
}

{
  let err3 = 0;
  let strongFirst = 0;
  let longest3 = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sp = seed % 3; // 強い CPU をどの席にも置く
    const lvs = [0, 1, 2].map((p) => (p === sp ? L.strong : L.weak));
    const r = match3(lvs, seed + 500);
    if (r.error) { err3++; if (err3 <= 3) console.log('   ' + r.error); continue; }
    if (r.rank[sp] === 1) strongFirst++;
    longest3 = Math.max(longest3, r.t);
  }
  check('3人: 30試合でパック・マレットが範囲を抜けない・止まり続けない・必ず決着する', err3 === 0, `${err3}件`);
  check('3人: つよい1人と よわい2人では、つよいがたいてい1位（30試合）', strongFirst >= 20, `${strongFirst}回`);
  console.log(`   3人のいちばん長い試合 ${Math.round(longest3)}秒`);
}
// 3人のゴール: それぞれの席のゴールに入ると、その席の失点。口の外は跳ね返る
{
  let ok = true;
  for (const p of [0, 1, 2]) {
    const u = seatDir(p);
    const puck = { x: u.x * 0.3, y: u.y * 0.3, vx: u.x * 3, vy: u.y * 3 };
    let g = null;
    for (let i = 0; i < 240 && g === null; i++) g = stepHex(puck, [], 1 / 240);
    if (g !== p) ok = false;
  }
  check('3人: 各席のゴールに入ると、その席が入れられた側になる', ok);
  // 壁（30° の辺）へまっすぐ
  const w = dir(30);
  const puck = { x: 0, y: 0, vx: w.x * 3, vy: w.y * 3 };
  let g = null;
  for (let i = 0; i < 120 && g === null; i++) g = stepHex(puck, [], 1 / 240);
  check('3人: 壁では跳ね返る', g === null && puck.vx * w.x + puck.vy * w.y < 0);
  // 陣地の分け方
  check('3人: 陣地の分け方（下は赤・左上は青・右上は緑）',
    zoneHex({ x: 0, y: 0.5 }) === 0 && zoneHex({ x: -0.4, y: -0.3 }) === 1 && zoneHex({ x: 0.4, y: -0.3 }) === 2);
  // マレットはどこを指しても自分の扇形と盤の内側に収まる
  const rnd = mulberry32(7);
  let inside = true;
  for (let i = 0; i < 3000; i++) {
    const p = i % 3;
    const q = clampHex(p, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3);
    if (!insideHex(q, 0.07, false) || !inSector(p, q, 0.07)) inside = false;
  }
  check('3人: マレットはどこを指しても自分の陣地と盤の内側に収まる', inside);
  // 点数と順位
  check('3人: 失点の少ない順に順位（同点は同じ順位）', JSON.stringify(overOf(3, [7, 2, 2], 7)?.rank) === '[3,1,1]' && overOf(3, [6, 2, 2], 7) === null);
  check('2人: 取った点で数える（入れられた側の相手に1点）', JSON.stringify(addGoal(2, [0, 0], 1)) === '[1,0]' && JSON.stringify(overOf(2, [7, 3], 7)?.rank) === '[1,2]');
}

console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
