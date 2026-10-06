// エアホッケーの動きの自動確認（node tools/test-hockey.mjs）。
// CPU どうし（下側は上下を入れ替えて同じ CPU を使う）で何試合も打たせ、パックが盤の外へ抜けない・決着が付く・
// 強い CPU が弱い CPU に勝ち越す、を確かめる。3人（六角形の盤）も同じことを確かめる。画面は使わない。
// ゴールの広さ（せまい・ひろい）でも、決着が付く・パックが壁を抜けない・ひろいほど1試合が短い、を確かめる。
import HOCKEY, {
  stepPuck, cpuTarget, clampMallet, CPU_LEVELS, stepHex, clampHex, cpuHex, zoneHex, addGoal, overOf, HEX_A, HEX_R, GOAL3, bouncePucks, scoreOf,
  GOAL_SIZES,
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

// 1試合。lv0 = 下側の CPU、lv1 = 上側の CPU。goal = ゴールの幅。返り値は勝った側・時間・おかしな所
function match(lv0, lv1, seed, target = 7, goal = GOAL) {
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
      goals[p] = p === 1 ? cpuTarget(puck, ms[1], lv, rnd, goal) : flip(cpuTarget(flip(puck), flip(ms[0]), lv, rnd, goal));
    }
    const n = Math.ceil(dt / (1 / 240));
    let g = null;
    for (let i = 0; i < n && g === null; i++) {
      move(ms[0], 0, goals[0], lv0.speed, dt / n);
      move(ms[1], 1, goals[1], lv1.speed, dt / n);
      g = stepPuck(puck, ms, dt / n, null, goal);
      maxV = Math.max(maxV, Math.hypot(puck.vx, puck.vy));
      const out = puck.x < R_P - 1e-9 || puck.x > W - R_P + 1e-9
        || ((puck.y < R_P - 1e-6 || puck.y > H - R_P + 1e-6) && Math.abs(puck.x - W / 2) >= goal / 2);
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
// 盤の内側にいるか（ゴールの口の前は外へ出てよい）。r = 円の半径、goal = ゴールの幅
function insideHex(o, r, allowMouth, goal = GOAL3) {
  for (const deg of EDGE_DEGS) {
    const u = dir(deg);
    const d = o.x * u.x + o.y * u.y;
    const t = -o.x * u.y + o.y * u.x;
    const mouth = allowMouth && (deg - 90) % 120 === 0 && Math.abs(t) < goal / 2;
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

// 1試合。lvs = 席ごとの CPU の強さ。goal = ゴールの幅。返り値は順位・時間・おかしな所
function match3(lvs, seed, target = 7, goal = GOAL3) {
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
      goals[p] = cpuHex(p, puck, ms[p], lvs[p], rnd, ms, goal);
    }
    const n = Math.ceil(dt / (1 / 240));
    let g = null;
    for (let i = 0; i < n && g === null; i++) {
      for (const p of [0, 1, 2]) {
        moveHex(ms[p], p, goals[p], lvs[p].speed, dt / n);
        if (!insideHex(ms[p], 0.07, false) || !inSector(p, ms[p], 0.07)) return { error: `マレット${p}が範囲の外 (${ms[p].x.toFixed(3)}, ${ms[p].y.toFixed(3)})` };
      }
      g = stepHex(puck, ms, dt / n, null, goal);
      if (g === null && !insideHex(puck, R_P, true, goal)) return { error: `パックが壁を抜けた (${puck.x.toFixed(3)}, ${puck.y.toFixed(3)})` };
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

// パック2つ
{
  const a = { x: 0.4, y: 0.8, vx: 2, vy: 0 };
  const b = { x: 0.4 + 2 * R_P - 0.01, y: 0.8, vx: -1, vy: 0 };
  const hit = bouncePucks(a, b, 1);
  check('パック2つ: 正面でぶつかると速さが入れ替わる（はね返りの係数1）', hit > 0 && Math.abs(a.vx + 1) < 1e-9 && Math.abs(b.vx - 2) < 1e-9);
  check('パック2つ: 重なりを押し離す', Math.hypot(b.x - a.x, b.y - a.y) >= 2 * R_P - 1e-9);
  const c = { x: 0.3, y: 0.5, vx: 0.5, vy: 0.2 };
  const d = { x: 0.3 + R_P * 1.5, y: 0.5 + R_P * 0.5, vx: -0.4, vy: 0.1 };
  const px = c.vx + d.vx;
  const py = c.vy + d.vy;
  bouncePucks(c, d);
  check('パック2つ: ななめに当たっても勢いの合計は変わらない', Math.abs(c.vx + d.vx - px) < 1e-9 && Math.abs(c.vy + d.vy - py) < 1e-9);
  check('パック2つ: 離れていく2つは当たらない', bouncePucks({ x: 0.5, y: 0.5, vx: -1, vy: 0 }, { x: 0.5 + R_P, y: 0.5, vx: 1, vy: 0 }) === 0);
  check('失点から点数を作る（2人は相手の失点・3人は失点そのもの）', JSON.stringify(scoreOf(2, [1, 3])) === '[3,1]' && JSON.stringify(scoreOf(3, [1, 2, 0])) === '[1,2,0]');
  // CPU どうしを2つのパックで打たせる（どちらの CPU も、自分の陣地にあってゴールに近いパックを追う）
  let ok = true;
  let done = 0;
  let goals = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rnd = mulberry32(seed);
    const lost = [0, 0];
    const ps = [{ x: W / 2, y: H * 0.72, vx: 0, vy: 0 }, { x: W / 2, y: H * 0.28, vx: 0, vy: 0 }];
    const ms = [{ x: W / 2, y: H - 0.16, vx: 0, vy: 0 }, { x: W / 2, y: 0.16, vx: 0, vy: 0 }];
    const lv = CPU_LEVELS.normal;
    const aim = [{ ...ms[0] }, { ...ms[1] }];
    const timers = [0, 0];
    const pick = (p) => {
      const hy = p === 0 ? H : 0;
      const v = (q) => ((q.y > H / 2) === (p === 0) ? 0 : 1) + Math.abs(q.y - hy);
      return v(ps[1]) < v(ps[0]) ? ps[1] : ps[0];
    };
    for (let t = 0; t < 600 && Math.max(...lost) < 7; t += 1 / 60) {
      for (const p of [0, 1]) {
        timers[p] -= 1 / 60;
        if (timers[p] > 0) continue;
        timers[p] = lv.react;
        const q = pick(p);
        aim[p] = p === 1 ? cpuTarget(q, ms[1], lv, rnd) : flip(cpuTarget(flip(q), flip(ms[0]), lv, rnd));
      }
      for (let i = 0; i < 4; i++) {
        move(ms[0], 0, aim[0], lv.speed, 1 / 240);
        move(ms[1], 1, aim[1], lv.speed, 1 / 240);
        bouncePucks(ps[0], ps[1]); // hockey.js と同じく、パックどうしを先に・壁を後に
        ps.forEach((q, k) => {
          const g = stepPuck(q, ms, 1 / 240);
          if (g !== null) { lost[1 - g]++; goals++; ps[k] = { x: W / 2 + (k ? 0.15 : 0), y: g === 0 ? 0.28 * H : 0.72 * H, vx: 0, vy: 0 }; }
        });
        for (const q of ps) {
          if (q.x < R_P - 1e-6 || q.x > W - R_P + 1e-6 || ((q.y < R_P - 1e-3 || q.y > H - R_P + 1e-3) && Math.abs(q.x - W / 2) >= GOAL / 2)) ok = false;
        }
        if (Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) < 2 * R_P - 0.03) ok = false; // 1歩で近づく分（最高速度 / 240）までは重なってよい
      }
    }
    if (Math.max(...lost) >= 7) done++;
  }
  check('パック2つ: CPU どうしで、パックが壁を抜けず・ほとんど重ならない', ok);
  check('パック2つ: CPU どうしで決着が付く', done >= 18, `${done}/20 試合・ゴール ${goals}`);
}

// ゴールの広さ（詳細設定 goal）
{
  const setting = HOCKEY.settings.find((x) => x.key === 'goal');
  check('ゴールの広さ: 詳細設定は せまい・ふつう・ひろい で、最初は ふつう（前と同じ幅）',
    setting?.def === 'normal' && JSON.stringify(setting.choices) === '[["narrow","せまい"],["normal","ふつう"],["wide","ひろい"]]' && GOAL_SIZES.normal.mul === 1);
  // 形: パックが柱の間を通れる・柱が盤の角や横の壁と重ならない
  let shape = true;
  for (const { mul } of Object.values(GOAL_SIZES)) {
    const g2 = GOAL * mul;
    const g3 = GOAL3 * mul;
    if (g2 - 2 * R_P < 2 * R_P + 0.05 || W / 2 + g2 / 2 > W - 2 * R_P - 0.05) shape = false; // 2人: 柱の間＞パック、柱と横の壁の間もパックが通れる
    if (g3 - 2 * R_P < 2 * R_P + 0.05 || g3 / 2 > HEX_R / 2 - 2 * R_P - 0.05) shape = false; // 3人: 辺の長さ = HEX_R。柱と角の間もパックが通れる
  }
  check('ゴールの広さ: どの広さでもパックが柱の間を通れ、柱が角や横の壁と重ならない', shape);
  // 口の中と外: どの広さでも、柱の少し内側をまっすぐ打てば入り、柱の少し外側なら跳ね返る（柱の近くは柱に当たるので避ける）
  const shoot = (x, goal) => {
    const q = { x, y: 0.1, vx: 0, vy: -3 };
    let g = null;
    for (let i = 0; i < 120 && g === null; i++) g = stepPuck(q, [], 1 / 240, null, goal);
    return g;
  };
  const shoot3 = (off, goal) => {
    const q = { x: off, y: 0.3, vx: 0, vy: 3 }; // 席0（下）のゴールへまっすぐ
    let g = null;
    for (let i = 0; i < 120 && g === null; i++) g = stepHex(q, [], 1 / 240, null, goal);
    return g;
  };
  let mouth2 = true;
  let mouth3 = true;
  for (const { mul } of Object.values(GOAL_SIZES)) {
    const h2 = (GOAL * mul) / 2;
    const h3 = (GOAL3 * mul) / 2;
    if (shoot(W / 2 + h2 - R_P - 0.01, GOAL * mul) !== 0 || shoot(W / 2 + h2 + R_P + 0.01, GOAL * mul) !== null) mouth2 = false;
    if (shoot3(-(h3 - R_P - 0.01), GOAL3 * mul) !== 0 || shoot3(h3 + R_P + 0.01, GOAL3 * mul) !== null) mouth3 = false;
  }
  check('ゴールの広さ: 2人の口が広さに合わせて変わる（柱の内側は入り、外側は跳ね返る）', mouth2);
  check('ゴールの広さ: 3人の口が広さに合わせて変わる', mouth3);
  // CPU どうし（ふつう対ふつう）。広さごとに、決着が付く・壁を抜けない・1試合の長さ
  const avg2 = {};
  const avg3 = {};
  for (const key of ['narrow', 'normal', 'wide']) {
    const mul = GOAL_SIZES[key].mul;
    let err = 0;
    let sum = 0;
    let cnt = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = match(L.normal, L.normal, seed + 900, 7, GOAL * mul);
      if (r.error) { err++; if (err <= 3) console.log('   ' + r.error); continue; }
      sum += r.t; cnt++;
    }
    avg2[key] = cnt ? sum / cnt : Infinity;
    let err3 = 0;
    let sum3 = 0;
    let cnt3 = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const r = match3([L.normal, L.normal, L.normal], seed + 1700, 7, GOAL3 * mul);
      if (r.error) { err3++; if (err3 <= 3) console.log('   ' + r.error); continue; }
      sum3 += r.t; cnt3++;
    }
    avg3[key] = cnt3 ? sum3 / cnt3 : Infinity;
    if (key !== 'normal') {
      const name = GOAL_SIZES[key].name;
      check(`ゴール${name}: 2人の CPU どうし20試合で、パックが壁を抜けない・止まり続けない・必ず決着する`, err === 0, `${err}件`);
      check(`ゴール${name}: 3人の CPU どうし15試合で、パック・マレットが範囲を抜けない・止まり続けない・必ず決着する`, err3 === 0, `${err3}件`);
    }
  }
  const sec = (o) => ['narrow', 'normal', 'wide'].map((k) => `${GOAL_SIZES[k].name} ${Math.round(o[k])}秒`).join('・');
  check('ゴールの広さ: ひろいほど1試合が短い（2人）', avg2.wide < avg2.normal && avg2.normal < avg2.narrow, `平均 ${sec(avg2)}`);
  check('ゴールの広さ: ひろいほど1試合が短い（3人）', avg3.wide < avg3.normal && avg3.normal < avg3.narrow, `平均 ${sec(avg3)}`);
}

console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
