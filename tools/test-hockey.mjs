// エアホッケーの動きの自動確認（node tools/test-hockey.mjs）。
// CPU どうし（下側は上下を入れ替えて同じ CPU を使う）で何試合も打たせ、パックが盤の外へ抜けない・決着が付く・
// 強い CPU が弱い CPU に勝ち越す、を確かめる。3人（六角形の盤）も同じことを確かめる。画面は使わない。
// ゴールの広さ（せまい・ひろい）でも、決着が付く・パックが壁を抜けない・ひろいほど1試合が短い、を確かめる。
// じゃまブロックでも、パックがブロックを抜けない・マレットが入らない・決着が付く・強さの順が崩れない・なしなら前と同じ、を確かめる。
// マレットの大きさ（小さい・大きい）でも、範囲と当たりが半径に合う・決着が付く・強さの順が崩れない・ふつうなら前と同じ、を確かめる。
import HOCKEY, {
  stepPuck, cpuTarget, clampMallet, CPU_LEVELS, stepHex, clampHex, cpuHex, zoneHex, addGoal, overOf, HEX_A, HEX_R, GOAL3, bouncePucks, scoreOf,
  GOAL_SIZES, table, moveMallet, BLOCK2, BLOCK3, blockDist, MALLET_SIZES,
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

// じゃまブロック（詳細設定 block）
{
  const R_M = 0.07;
  const setting = HOCKEY.settings.find((x) => x.key === 'block');
  check('じゃまブロック: 詳細設定は なし・あり で、最初は なし',
    setting?.def === 'off' && JSON.stringify(setting.choices) === '[["off","なし"],["on","あり"]]');
  // 形: 2人は真ん中の線の上の横長（長さはふつうのゴールの幅の半分くらい）、3人は真ん中の丸。両側をパックが楽に通れ、置き場所・マレットの家と重ならない
  const len2 = BLOCK2.bx - BLOCK2.ax + 2 * BLOCK2.r;
  const side2 = (W - len2) / 2; // ブロックの端から横の壁まで
  let shape = Math.abs(len2 - GOAL / 2) < 0.01 && BLOCK2.ay === H / 2 && BLOCK2.by === H / 2 && Math.abs((BLOCK2.ax + BLOCK2.bx) / 2 - W / 2) < 1e-12
    && side2 > 4 * 2 * R_P && BLOCK3.ax === 0 && BLOCK3.ay === 0 && BLOCK3.ax === BLOCK3.bx && BLOCK3.ay === BLOCK3.by && BLOCK3.r <= 0.08;
  for (const n of [2, 3]) {
    const T = table(n, 'normal', true);
    for (const p of (n === 2 ? [0, 1] : [0, 1, 2])) {
      const s = T.serve(p);
      const m = T.home(p);
      if (blockDist(T.block, s.x, s.y) < R_P + T.block.r + 0.1 || blockDist(T.block, m.x, m.y) < R_M + T.block.r + 0.1) shape = false;
    }
  }
  // 3人: ブロックのまわりの道（ブロックの縁から陣地の境目の壁のまん中まで）もパックが楽に通れる
  if (HEX_A - BLOCK3.r < 4 * 2 * R_P) shape = false;
  check('じゃまブロック: 2人は真ん中の線の上の横長（ゴールの幅の半分）・3人は真ん中の丸。両側の道が広く、置き場所と重ならない', shape,
    `2人の横の道 ${side2.toFixed(2)}`);

  // 速いパックをまっすぐブロックへ打っても抜けず、跳ね返る（いろいろな向き・当たる所で）
  let noPass = true;
  for (const n of [2, 3]) {
    const T = table(n, 'normal', true);
    const b = T.block;
    const cx = (b.ax + b.bx) / 2;
    const cy = (b.ay + b.by) / 2;
    for (let k = 0; k < 72; k++) {
      const a = (k * 5 * Math.PI) / 180;
      for (const off of [0, 0.03, -0.05, 0.09]) { // 中心・端に近い所をかすめる
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const q = { x: cx - ux * 0.3 - uy * off, y: cy - uy * 0.3 + ux * off, vx: ux * 3.4, vy: uy * 3.4 };
        if (blockDist(b, q.x, q.y) < R_P + b.r) continue;
        for (let i = 0; i < 240; i++) {
          if (T.step(q, [], 1 / 240) !== null) break;
          if (blockDist(b, q.x, q.y) < R_P + b.r - 1e-9) noPass = false;
          // ブロックの向こう側へ抜けていない（線分を横切っていない）
          const along = (q.x - cx) * ux + (q.y - cy) * uy;
          const across = Math.abs(-(q.x - cx) * uy + (q.y - cy) * ux);
          if (i < 60 && along > 0 && across < 0.02 && Math.abs(off) < 0.01) noPass = false;
        }
      }
    }
  }
  check('じゃまブロック: 速いパックをどの向きから打っても、ブロックを抜けずに跳ね返る（2人・3人）', noPass);
  {
    const T = table(2, 'normal', true);
    const q = { x: W / 2, y: H / 2 + 0.3, vx: 0, vy: -3.4 };
    for (let i = 0; i < 60; i++) T.step(q, [], 1 / 240);
    check('じゃまブロック: 2人の真ん中へまっすぐ打つと、まっすぐ跳ね返る', q.vy > 2 && Math.abs(q.vx) < 1e-9 && q.y > H / 2, `vy=${q.vy.toFixed(2)}`);
  }

  // マレットはブロックに入れない: どこを指しても、ブロックから R_M 離れた所までで止まる。動いている途中も入らず、回り込んで向こう側へ着く
  let fence = true;
  let around = true;
  const rnd = mulberry32(11);
  for (const n of [2, 3]) {
    const T = table(n, 'normal', true);
    const b = T.block;
    for (let i = 0; i < 3000; i++) {
      const p = i % n;
      const q = T.clamp(p, (rnd() - 0.5) * 3 + (n === 2 ? W / 2 : 0), (rnd() - 0.5) * 3 + (n === 2 ? H / 2 : 0));
      if (blockDist(b, q.x, q.y) < R_M + b.r - 1e-9) fence = false;
      if (n === 2) { const c = clampMallet(p, q.x, q.y); if (Math.abs(c.x - q.x) > 1e-9 || Math.abs(c.y - q.y) > 1e-9) fence = false; }
      else if (!insideHex(q, R_M, false) || !inSector(p, q, R_M)) fence = false;
    }
    // ブロックのすぐ脇の左から右へ（3人は陣地の左の端から右の端へ）、ブロックをはさんで動かす
    for (const p of (n === 2 ? [0, 1] : [0, 1, 2])) {
      // 2人は真ん中の線のすぐ脇（ブロックより線に近い）の左右、3人は中心の近くの左右。まっすぐ動くとブロックを通ってしまう2点
      let from;
      let to;
      if (n === 2) {
        const y = p === 0 ? H / 2 + R_M : H / 2 - R_M;
        from = T.clamp(p, W / 2 - 0.25, y);
        to = T.clamp(p, W / 2 + 0.25, y);
      } else {
        const u = { x: Math.cos(((90 + 120 * p) * Math.PI) / 180), y: Math.sin(((90 + 120 * p) * Math.PI) / 180) };
        from = T.clamp(p, u.x * 0.12 - u.y * 0.1, u.y * 0.12 + u.x * 0.1);
        to = T.clamp(p, u.x * 0.12 + u.y * 0.1, u.y * 0.12 - u.x * 0.1);
      }
      let gap = Infinity;
      for (let k = 0; k <= 100; k++) gap = Math.min(gap, blockDist(b, from.x + ((to.x - from.x) * k) / 100, from.y + ((to.y - from.y) * k) / 100));
      if (gap >= R_M + b.r - 1e-6) around = false; // まっすぐ動いてもブロックに入らない2点になっている（確かめる意味がない）
      for (const [s, goal] of [[from, to], [to, from]]) {
        const m = { ...s, vx: 0, vy: 0 };
        // わざとブロックの真ん中を指して動かしてから、向こう側を指す
        for (let i = 0; i < 240; i++) {
          moveMallet(m, p, i < 60 ? { x: (b.ax + b.bx) / 2, y: (b.ay + b.by) / 2 } : goal, 7, 1 / 240, T.clamp, T.keep);
          if (blockDist(b, m.x, m.y) < R_M + b.r - 1e-9) fence = false;
        }
        if (Math.hypot(m.x - goal.x, m.y - goal.y) > 0.01) around = false;
      }
    }
  }
  check('じゃまブロック: マレットはどこを指してもブロックに入らず、自分の陣地からも出ない（2人・3人）', fence);
  check('じゃまブロック: マレットはブロックを回り込んで向こう側へ着く', around);

  // CPU: まっすぐ打つとブロックに当たる所では、ブロックの横を通るように狙う
  {
    const still = () => 0.5; // 狙いのずれなし
    const puck = { x: W / 2, y: 0.45, vx: 0, vy: 0 };
    const m = { x: W / 2, y: 0.3 };
    const passes = (t) => { // マレットの行き先の向きにパックが飛ぶとして、ブロックに当たらないか
      const dx = t.x - puck.x;
      const dy = t.y - puck.y;
      const l = Math.hypot(dx, dy);
      let min = Infinity;
      for (let k = 0; k <= 200; k++) { const s = (k / 200) * 0.7; min = Math.min(min, blockDist(BLOCK2, puck.x + (dx / l) * s, puck.y + (dy / l) * s)); }
      return min >= R_P + BLOCK2.r;
    };
    const plain = cpuTarget(puck, m, L.strong, still);
    const dodge = cpuTarget(puck, m, L.strong, still, GOAL, BLOCK2);
    const far = { x: 0.2, y: 0.45, vx: 0, vy: 0 }; // 横に離れた所からはブロックに当たらないので、そのまま
    check('じゃまブロック: CPU はブロックに当たる所では横へずらして狙い、当たらない所ではそのまま狙う',
      !passes(plain) && passes(dodge) && JSON.stringify(cpuTarget(far, m, L.strong, still)) === JSON.stringify(cpuTarget(far, m, L.strong, still, GOAL, BLOCK2)));
  }

  // CPU どうしの試合（台の関数をそのまま使う）。n = 人数・goalKey = ゴールの広さ・npk = パックの数・block = じゃまブロック・mk = マレットの大きさ
  function matchT(n, goalKey, block, lvs, seed, npk = 1, target = 7, mk = 'normal') {
    const T = table(n, goalKey, block, mk);
    const rm = T.rm;
    const b = T.block;
    const rnd = mulberry32(seed);
    const seats = n === 2 ? [0, 1] : [0, 1, 2];
    const lost = Array(n).fill(0);
    const ps = npk === 2 ? [T.serve(0), T.serve(1)] : [T.serve(0)];
    const ms = seats.map(T.home);
    const aim = ms.map((m) => ({ ...m }));
    const timers = Array(n).fill(0);
    const still = ps.map(() => 0);
    // hockey.js の puckFor と同じ: 自分の陣地にあるもの、その中では自分のゴールに近いもの
    const pick = (p) => {
      if (ps.length === 1) return ps[0];
      const h = T.home(p);
      const v = (q) => (T.zone(q) === p ? 0 : 1) + Math.hypot(q.x - h.x, q.y - h.y);
      return v(ps[1]) < v(ps[0]) ? ps[1] : ps[0];
    };
    const dt = 1 / 60;
    for (let t = 0; t < 1200; t += dt) {
      for (const p of seats) {
        timers[p] -= dt;
        if (timers[p] > 0) continue;
        timers[p] = lvs[p].react;
        aim[p] = T.cpu(p, pick(p), ms[p], lvs[p], rnd, ms);
      }
      for (let i = 0; i < 4; i++) {
        for (const p of seats) {
          moveMallet(ms[p], p, aim[p], lvs[p].speed, dt / 4, T.clamp, T.keep);
          if (b && blockDist(b, ms[p].x, ms[p].y) < rm + b.r - 1e-9) return { error: `マレット${p}がブロックに入った (${ms[p].x.toFixed(3)}, ${ms[p].y.toFixed(3)})` };
          if (n === 3 && (!insideHex(ms[p], rm, false) || !inSector(p, ms[p], rm))) return { error: `マレット${p}が範囲の外` };
          if (n === 2 && (ms[p].x < rm - 1e-9 || ms[p].x > W - rm + 1e-9 || (p === 0 ? ms[p].y < H / 2 + rm - 1e-9 || ms[p].y > H - rm + 1e-9 : ms[p].y < rm - 1e-9 || ms[p].y > H / 2 - rm + 1e-9))) return { error: `マレット${p}が範囲の外` };
        }
        if (ps.length === 2) bouncePucks(ps[0], ps[1]); // hockey.js と同じく、パックどうしを先に・壁を後に
        for (let k = 0; k < ps.length; k++) {
          const q = ps[k];
          const c = T.step(q, ms, dt / 4);
          if (c !== null) {
            lost[c]++;
            const over = overOf(n, scoreOf(n, lost), target);
            if (over) return { rank: over.rank, t };
            // hockey.js の serveAt と同じ置き直し
            const s = T.serve(c);
            const other = ps[1 - k];
            if (other && Math.hypot(other.x - s.x, other.y - s.y) < 2 * R_P + 0.03) s.x += other.x > s.x ? -0.15 : 0.15;
            ps[k] = s;
            continue;
          }
          if (b && blockDist(b, q.x, q.y) < R_P + b.r - 1e-9) return { error: `パックがブロックに入った (${q.x.toFixed(3)}, ${q.y.toFixed(3)})` };
          const out = n === 2
            ? q.x < R_P - 1e-9 || q.x > W - R_P + 1e-9 || ((q.y < R_P - 1e-3 || q.y > H - R_P + 1e-3) && Math.abs(q.x - W / 2) >= T.goal / 2)
            : !insideHex(q, R_P, true, T.goal);
          if (out) return { error: `パックが壁を抜けた (${q.x.toFixed(3)}, ${q.y.toFixed(3)})` };
        }
      }
      for (let k = 0; k < ps.length; k++) {
        still[k] = Math.hypot(ps[k].vx, ps[k].vy) < 0.02 ? still[k] + dt : 0;
        if (still[k] > 20) return { error: `パックが20秒止まったまま (${ps[k].x.toFixed(2)}, ${ps[k].y.toFixed(2)})` };
      }
    }
    return { error: '20分たっても決着しない' };
  }

  // なし: 台の関数が前と全く同じ（同じ関数・同じ結果）
  {
    let same = true;
    for (const goalKey of ['narrow', 'normal', 'wide']) {
      const T2 = table(2, goalKey, false);
      const T3 = table(3, goalKey, false);
      const g2 = GOAL * GOAL_SIZES[goalKey].mul;
      const g3 = GOAL3 * GOAL_SIZES[goalKey].mul;
      if (T2.block !== null || T2.keep !== null || T2.clamp !== clampMallet || T3.block !== null || T3.keep !== null || T3.clamp !== clampHex) same = false;
      const r = mulberry32(5);
      for (let i = 0; i < 2000; i++) {
        const q = { x: r(), y: r() * H, vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 6 };
        const ms = [{ x: r(), y: r() * H, vx: (r() - 0.5) * 8, vy: (r() - 0.5) * 8 }];
        const a = { ...q };
        const bq = { ...q };
        const ga = T2.step(a, ms, 1 / 240);
        const gb = stepPuck(bq, ms, 1 / 240, null, g2);
        if (JSON.stringify(a) !== JSON.stringify(bq) || ga !== (gb === null ? null : 1 - gb)) same = false;
        const h = { x: (r() - 0.5) * 1.4, y: (r() - 0.5) * 1.4, vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 6 };
        const ha = { ...h };
        const hb = { ...h };
        if (T3.step(ha, ms, 1 / 240) !== stepHex(hb, ms, 1 / 240, null, g3) || JSON.stringify(ha) !== JSON.stringify(hb)) same = false;
        const lv = Object.values(L)[i % 3];
        const s1 = mulberry32(i);
        const s2 = mulberry32(i);
        if (JSON.stringify(T2.cpu(1, q, ms[0], lv, s1)) !== JSON.stringify(cpuTarget(q, ms[0], lv, s2, g2))) same = false;
        const mm = [0, 1, 2].map(() => ({ x: (r() - 0.5) * 1.2, y: (r() - 0.5) * 1.2 }));
        if (JSON.stringify(T3.cpu(i % 3, h, mm[i % 3], lv, s1, mm)) !== JSON.stringify(cpuHex(i % 3, h, mm[i % 3], lv, s2, mm, g3))) same = false;
      }
    }
    check('じゃまブロック: なしでは台の関数が前と全く同じ動きをする（2人・3人・ゴールの広さ3つ）', same);
  }

  // ありの CPU どうし（ふつう対ふつう）。人数・ゴールの広さ・パックの数のどれでも、抜けない・入らない・止まり続けない・決着する
  const avg = {};
  for (const n of [2, 3]) {
    for (const goalKey of ['narrow', 'normal', 'wide']) {
      for (const npk of [1, 2]) {
        let err = 0;
        let sum = 0;
        let cnt = 0;
        const games = n === 2 ? (npk === 1 ? 12 : 8) : (npk === 1 ? 8 : 5);
        for (let seed = 1; seed <= games; seed++) {
          const r = matchT(n, goalKey, true, Array(n).fill(L.normal), seed + 2300 + n * 100 + npk * 50);
          if (r.error) { err++; if (err <= 3) console.log('   ' + r.error); continue; }
          sum += r.t; cnt++;
        }
        avg[`${n}-${goalKey}-${npk}`] = cnt ? Math.round(sum / cnt) : '-';
        check(`じゃまブロック: ${n}人・ゴール${GOAL_SIZES[goalKey].name}・パック${npk}つの CPU どうし${games}試合で、ブロックも壁も抜けない・止まり続けない・必ず決着する`, err === 0, `${err}件`);
      }
    }
  }
  console.log(`   じゃまブロックありの1試合の平均（ふつう対ふつう・7点。パック1つ）: 2人 せまい ${avg['2-narrow-1']}秒・ふつう ${avg['2-normal-1']}秒・ひろい ${avg['2-wide-1']}秒、`
    + `3人 ${avg['3-narrow-1']}秒・${avg['3-normal-1']}秒・${avg['3-wide-1']}秒`);

  // 強さの順が崩れない（なしと同じ基準）
  let sw = 0;
  let nw = 0;
  let err = 0;
  for (let seed = 1; seed <= 20; seed++) {
    for (const [a, b, add] of [[L.strong, L.weak, (x) => { sw += x; }], [L.normal, L.weak, (x) => { nw += x; }]]) {
      const r1 = matchT(2, 'normal', true, [a, b], seed + 3000);
      const r2 = matchT(2, 'normal', true, [b, a], seed + 3100);
      for (const [r, side] of [[r1, 0], [r2, 1]]) {
        if (r.error) { err++; continue; }
        add(r.rank[side] === 1 ? 1 : 0);
      }
    }
  }
  let first3 = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sp = seed % 3;
    const r = matchT(3, 'normal', true, [0, 1, 2].map((p) => (p === sp ? L.strong : L.weak)), seed + 3500);
    if (r.error) { err++; continue; }
    if (r.rank[sp] === 1) first3++;
  }
  check('じゃまブロック: 強さを比べる試合も、ブロックも壁も抜けない・必ず決着する', err === 0, `${err}件`);
  check('じゃまブロック: つよいはよわいに勝ち越す（2人・40試合）', sw >= 30, `${sw}勝`);
  check('じゃまブロック: ふつうはよわいに勝ち越す（2人・40試合）', nw >= 24, `${nw}勝`);
  check('じゃまブロック: つよい1人と よわい2人では、つよいがたいてい1位（3人・30試合）', first3 >= 20, `${first3}回`);

  // マレットの大きさ（詳細設定 mallet）
  {
    const setting = HOCKEY.settings.find((x) => x.key === 'mallet');
    check('マレットの大きさ: 詳細設定は 小さい・ふつう・大きい で、最初は ふつう（前と同じ大きさ）',
      setting?.def === 'normal' && JSON.stringify(setting.choices) === '[["small","小さい"],["normal","ふつう"],["large","大きい"]]'
      && MALLET_SIZES.normal.mul === 1 && table(2).rm === R_M && table(3).rm === R_M);
    // ふつう: 台の関数が前と同じ（同じ関数）。ふつうを渡しても渡さなくても同じ動き
    {
      let same = true;
      for (const n of [2, 3]) {
        const A = table(n, 'normal', false, 'normal');
        if (A.clamp !== (n === 2 ? clampMallet : clampHex)) same = false;
        for (const blk of [false, true]) {
          const P = table(n, 'wide', blk);
          const Q = table(n, 'wide', blk, 'normal');
          const r = mulberry32(9);
          for (let i = 0; i < 500; i++) {
            const q = n === 2 ? { x: r(), y: r() * H, vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 6 } : { x: (r() - 0.5) * 1.4, y: (r() - 0.5) * 1.4, vx: (r() - 0.5) * 6, vy: (r() - 0.5) * 6 };
            const ms = [{ x: q.x + (r() - 0.5) * 0.3, y: q.y + (r() - 0.5) * 0.3, vx: (r() - 0.5) * 8, vy: (r() - 0.5) * 8 }];
            const a = { ...q };
            const c = { ...q };
            if (P.step(a, ms, 1 / 240) !== Q.step(c, ms, 1 / 240) || JSON.stringify(a) !== JSON.stringify(c)) same = false;
            const px = (r() - 0.5) * 3 + (n === 2 ? W / 2 : 0);
            const py = (r() - 0.5) * 3 + (n === 2 ? H / 2 : 0);
            if (JSON.stringify(P.clamp(i % n, px, py)) !== JSON.stringify(Q.clamp(i % n, px, py))) same = false;
          }
        }
      }
      check('マレットの大きさ: ふつうでは台の関数が前と全く同じ動きをする', same);
    }
    // 大きさが当たりと動ける範囲に効く: どこを指しても壁・陣地の境目から rm 離れ、パックは中心から rm + R_P の所で跳ね返る
    {
      let ok = true;
      const rnd = mulberry32(13);
      for (const mk of ['small', 'large']) {
        for (const n of [2, 3]) {
          for (const blk of [false, true]) {
            const T = table(n, 'normal', blk, mk);
            const rm = T.rm;
            if (Math.abs(rm - R_M * MALLET_SIZES[mk].mul) > 1e-12) ok = false;
            for (let i = 0; i < 2000; i++) {
              const p = i % n;
              const q = T.clamp(p, (rnd() - 0.5) * 3 + (n === 2 ? W / 2 : 0), (rnd() - 0.5) * 3 + (n === 2 ? H / 2 : 0));
              if (n === 3 && (!insideHex(q, rm, false) || !inSector(p, q, rm))) ok = false;
              if (n === 2 && (q.x < rm - 1e-9 || q.x > W - rm + 1e-9 || (p === 0 ? q.y < H / 2 + rm - 1e-9 || q.y > H - rm + 1e-9 : q.y < rm - 1e-9 || q.y > H / 2 - rm + 1e-9))) ok = false;
              if (T.block && blockDist(T.block, q.x, q.y) < rm + T.block.r - 1e-9) ok = false;
            }
            // 止まったマレットへまっすぐ向かうパックは、中心どうしが rm + R_P 離れた所で跳ね返る
            const c = n === 2 ? { x: 0.3, y: 1.3 } : { x: -0.2, y: 0.45 };
            const m = { ...c, vx: 0, vy: 0 };
            const puck = { x: c.x, y: c.y - 0.3, vx: 0, vy: 3 };
            let min = Infinity;
            for (let k = 0; k < 40; k++) { T.step(puck, [m], 1 / 240); min = Math.min(min, Math.hypot(puck.x - m.x, puck.y - m.y)); }
            if (Math.abs(min - (rm + R_P)) > 1e-6 || puck.vy >= 0) ok = false;
          }
        }
      }
      check('マレットの大きさ: 小さい・大きいでも、マレットは壁・陣地・ブロックから自分の半径だけ離れ、パックは半径に合わせて跳ね返る（2人・3人）', ok);
    }
    // CPU どうし: 大きさ・人数・ゴールの広さ・パックの数・じゃまブロックのどれでも、抜けない・止まり続けない・必ず決着する
    const mavg = {};
    for (const mk of ['small', 'large']) {
      for (const n of [2, 3]) {
        let err = 0;
        let cnt = 0;
        for (const goalKey of ['narrow', 'normal', 'wide']) {
          for (const [npk, blk] of [[1, false], [2, false], [1, true]]) {
            const games = goalKey === 'normal' && npk === 1 && !blk ? 12 : 3;
            let sum = 0;
            let c = 0;
            for (let seed = 1; seed <= games; seed++) {
              const r = matchT(n, goalKey, blk, Array(n).fill(L.normal), seed + 4000 + n * 100 + npk * 50 + (blk ? 25 : 0), npk, 7, mk);
              cnt++;
              if (r.error) { err++; if (err <= 3) console.log('   ' + r.error); continue; }
              sum += r.t; c++;
            }
            if (npk === 1 && !blk) mavg[`${mk}-${n}-${goalKey}`] = c ? Math.round(sum / c) : '-';
          }
        }
        check(`マレット${MALLET_SIZES[mk].name}: ${n}人の CPU どうし${cnt}試合（ゴールの広さ3つ・パック2つ・じゃまブロックも）で、抜けない・止まり続けない・必ず決着する`, err === 0, `${err}件`);
      }
    }
    // くらべるための、ふつうの大きさの1試合の平均（同じ種）
    for (const n of [2, 3]) {
      for (const goalKey of ['narrow', 'normal', 'wide']) {
        const games = goalKey === 'normal' ? 12 : 3;
        let sum = 0;
        let c = 0;
        for (let seed = 1; seed <= games; seed++) {
          const r = matchT(n, goalKey, false, Array(n).fill(L.normal), seed + 4000 + n * 100 + 50, 1, 7);
          if (!r.error) { sum += r.t; c++; }
        }
        mavg[`normal-${n}-${goalKey}`] = c ? Math.round(sum / c) : '-';
      }
    }
    const line = (n) => ['small', 'normal', 'large'].map((mk) => `${MALLET_SIZES[mk].name} ${['narrow', 'normal', 'wide'].map((g) => mavg[`${mk}-${n}-${g}`]).join('/')}秒`).join('・');
    console.log(`   マレットの大きさごとの1試合の平均（ふつう対ふつう・7点・パック1つ。ゴール せまい/ふつう/ひろい）: 2人 ${line(2)}、3人 ${line(3)}`);
    // 強さの順が崩れない（なしと同じ基準）
    for (const mk of ['small', 'large']) {
      let sw = 0;
      let nw = 0;
      let first3 = 0;
      let err = 0;
      for (let seed = 1; seed <= 20; seed++) {
        for (const [a, b, add] of [[L.strong, L.weak, (x) => { sw += x; }], [L.normal, L.weak, (x) => { nw += x; }]]) {
          const r1 = matchT(2, 'normal', false, [a, b], seed + 5000, 1, 7, mk);
          const r2 = matchT(2, 'normal', false, [b, a], seed + 5100, 1, 7, mk);
          for (const [r, side] of [[r1, 0], [r2, 1]]) {
            if (r.error) { err++; continue; }
            add(r.rank[side] === 1 ? 1 : 0);
          }
        }
      }
      for (let seed = 1; seed <= 30; seed++) {
        const sp = seed % 3;
        const r = matchT(3, 'normal', false, [0, 1, 2].map((p) => (p === sp ? L.strong : L.weak)), seed + 5500, 1, 7, mk);
        if (r.error) { err++; continue; }
        if (r.rank[sp] === 1) first3++;
      }
      const name = MALLET_SIZES[mk].name;
      check(`マレット${name}: 強さを比べる試合も、抜けない・必ず決着する`, err === 0, `${err}件`);
      check(`マレット${name}: つよいはよわいに勝ち越す（2人・40試合）`, sw >= 30, `${sw}勝`);
      check(`マレット${name}: ふつうはよわいに勝ち越す（2人・40試合）`, nw >= 24, `${nw}勝`);
      check(`マレット${name}: つよい1人と よわい2人では、つよいがたいてい1位（3人・30試合）`, first3 >= 20, `${first3}回`);
    }
  }
}

console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
