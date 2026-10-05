// エアホッケー。手の一覧で進むほかのゲームと違い、毎フレーム動くので main.js の「live」の形で動かす
// （mount(要素, 設定) で始まり、自分で描いて自分で進める。main.js は部屋・待合室・通信の取り次ぎだけ）。
//
// 決めごと（本人の判断・2026-10-03）: 何点先取かは始める前に選ぶ（最初は7点）。CPU の強さは始める前に3段階から選ぶ。
//   パソコンでは「この画面で2人で」を出さない（main.js が指で触れる端末のときだけボタンを出す）。オンラインは試作で、
//   通信の遅れ（往復の時間）を画面に出し、本人が実際に試して続けるか決める。
// 3人（本人の判断・2026-10-05）: 盤は六角形で、1辺おきの3辺がそれぞれのゴール。誰かが決めた数だけ入れられたら終わりで、
//   失点の少ない順に順位。CPU 戦とオンラインの両方（オンラインで人が足りなければ CPU。CPU はホストの端末が動かす）。
// Claude の判断: 2人の盤は縦長（幅1・高さ1.6）。マレット（打つ道具）は自分の陣地から出られない（2人は半分、3人は中心から見た扇形）。
//   ゴールされた側から打ち始める。最初は赤（席0）から。
//
// 盤の形は「台」（RECT = 2人の長方形、HEX = 3人の六角形）にまとめ、動かし方・同期は台の関数だけを使う。
//   台の step はゴールに入れられた席（失点した席）を返す。点数の数え方は2人（取った点）と3人（失点）で違う（addGoal）。
//
// オンラインの同期（試作）: 「パックが今ある陣地の席を動かしている端末」がパックの動きを計算してほかへ送る（持ち主）。
//   パックがほかの陣地に入ったら持ち主をその席に渡す。自分の陣地では自分の端末で当たりを計算するので、打った感触に遅れが出ない。
//   ほかの陣地にあるパックは、届いた位置から通信の遅れの分だけ先へ進めて描く。ゴールは持ち主（＝決められた側）が判定して知らせる。
//   CPU の席（と、部屋を出た人の席）はホストの端末が動かす。送る中身には、その端末が動かしている席（c）を付ける。

import { play } from '../sound.js';

const W = 1;
const H = 1.6;
const R_P = 0.042; // パックの半径
const R_M = 0.07; // マレットの半径
const GOAL = 0.36; // ゴールの幅
const MAX_V = 3.4; // パックの最高速度（盤の幅 / 秒）
const MALLET_V = 7; // マレットが指を追いかける最高速度
const FRICTION = 0.3;
const E_WALL = 0.9;
const E_HIT = 0.9;
const STEP = 1 / 240;
const SEND_MS = 40; // オンラインで位置を送る間隔
const GOAL_PAUSE = 1.2;

// 3人の六角形の盤（中心が原点。角は 0°・60°…の向きで、上下の辺が平ら）。
// 席 p のゴールは、外向きの向きが 90°＋120°×p の辺（席0 が下）。席 p の陣地は、中心から見てその向きの ±60° の扇形
// （両隣の壁の半分ずつを含む）。広さは2人の盤より少し広い（3人分）
export const HEX_R = 0.83; // 中心から角まで
export const HEX_A = (HEX_R * Math.sqrt(3)) / 2; // 中心から辺まで
export const GOAL3 = 0.38;
const PAD = 0.03; // 縁の線を描く余白

export const CPU_LEVELS = {
  weak: { name: 'よわい', speed: 1.4, react: 0.32, err: 0.14 },
  normal: { name: 'ふつう', speed: 2.4, react: 0.16, err: 0.07 },
  strong: { name: 'つよい', speed: 3.6, react: 0.06, err: 0.025 },
};
const POINTS = [3, 5, 7, 10];
const COLORS = ['#d9643a', '#2f6fb3', '#2e9a52']; // style.css の --p0〜--p2 と同じ
const PLAYERS = ['赤', '青', '緑'];

/* ---------- 動き（2人・長方形） ---------- */

const servePuck = (side) => ({ x: W / 2, y: side === 0 ? H * 0.72 : H * 0.28, vx: 0, vy: 0 });
const homeMallet = (p) => ({ x: W / 2, y: p === 0 ? H - 0.16 : 0.16, vx: 0, vy: 0 });

export function clampMallet(p, x, y) {
  return {
    x: Math.min(W - R_M, Math.max(R_M, x)),
    y: p === 0 ? Math.min(H - R_M, Math.max(H / 2 + R_M, y)) : Math.min(H / 2 - R_M, Math.max(R_M, y)),
  };
}

function moveMallet(m, p, target, maxV, dt, clamp = clampMallet) {
  const t = clamp(p, target.x, target.y);
  const dx = t.x - m.x;
  const dy = t.y - m.y;
  const d = Math.hypot(dx, dy);
  const step = Math.min(d, maxV * dt);
  const nx = d > 0 ? m.x + (dx / d) * step : m.x;
  const ny = d > 0 ? m.y + (dy / d) * step : m.y;
  m.vx = (nx - m.x) / dt;
  m.vy = (ny - m.y) / dt;
  m.x = nx;
  m.y = ny;
}

// 当たったときの近づく速さを返す（重なっていない・離れていくときは 0）。効果音の大きさに使う
function bounceCircle(puck, cx, cy, rad, vx = 0, vy = 0, e = E_HIT) {
  const dx = puck.x - cx;
  const dy = puck.y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= rad || d === 0) return 0;
  const nx = dx / d;
  const ny = dy / d;
  puck.x = cx + nx * rad;
  puck.y = cy + ny * rad;
  const vn = (puck.vx - vx) * nx + (puck.vy - vy) * ny;
  if (vn < 0) { puck.vx -= (1 + e) * vn * nx; puck.vy -= (1 + e) * vn * ny; }
  return vn < 0 ? -vn : 0;
}

function friction(puck, dt) {
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  const f = Math.max(0, 1 - FRICTION * dt);
  puck.vx *= f;
  puck.vy *= f;
}
function capSpeed(puck) {
  const v = Math.hypot(puck.vx, puck.vy);
  if (v > MAX_V) { puck.vx *= MAX_V / v; puck.vy *= MAX_V / v; }
}

// パックを dt 秒進める。ゴールに入ったら点を取った側（0 / 1）を返す。mallets は当たりを見るマレット。
// ev（任意）を渡すと、マレットに当たった強さ（ev.hit）と壁に当たった強さ（ev.wall）のいちばん大きいものを書き込む（効果音用）
export function stepPuck(puck, mallets, dt, ev = null) {
  friction(puck, dt);
  // マレットに押されて壁へめり込むことがあるので、マレットの当たりを先に、壁を後に見る
  let hit = 0;
  let wall = 0;
  for (const m of mallets) hit = Math.max(hit, bounceCircle(puck, m.x, m.y, R_P + R_M, m.vx, m.vy));
  if (puck.x < R_P) { wall = Math.max(wall, -puck.vx); puck.x = R_P; puck.vx = Math.abs(puck.vx) * E_WALL; }
  if (puck.x > W - R_P) { wall = Math.max(wall, puck.vx); puck.x = W - R_P; puck.vx = -Math.abs(puck.vx) * E_WALL; }
  const mouth = Math.abs(puck.x - W / 2) < GOAL / 2;
  if (puck.y < R_P && !mouth) { wall = Math.max(wall, -puck.vy); puck.y = R_P; puck.vy = Math.abs(puck.vy) * E_WALL; }
  if (puck.y > H - R_P && !mouth) { wall = Math.max(wall, puck.vy); puck.y = H - R_P; puck.vy = -Math.abs(puck.vy) * E_WALL; }
  if (puck.y < -R_P) return 0; // 上のゴール（青の陣地）に入った → 赤の点
  if (puck.y > H + R_P) return 1;
  for (const px of [W / 2 - GOAL / 2, W / 2 + GOAL / 2]) for (const py of [0, H]) wall = Math.max(wall, bounceCircle(puck, px, py, R_P, 0, 0, E_WALL));
  if (ev) { ev.hit = Math.max(ev.hit, hit); ev.wall = Math.max(ev.wall, wall); }
  capSpeed(puck);
  return null;
}

// 1回の描き替えの間にパックが当たった音。マレットの音を優先し、ゆっくり触れただけ・壁をこすっているだけでは鳴らさない
function bumpSound(ev) {
  if (ev.hit > 0.3) play('smack', ev.hit / 2.5);
  else if (ev.wall > 0.4) play('wall', ev.wall / 3);
}

/* ---------- CPU（2人の上側・プレイヤー1） ---------- */

// 打ち返せそうなら相手のゴールへ向けて打ち込み、相手の陣地にあるときはゴールの前で構える。
// 強さは、動く速さ・判断の間隔（反応の遅さ）・狙いのずれで変える
export function cpuTarget(puck, m, lv, rnd) {
  const defY = 0.2;
  if (puck.y < H / 2 + R_P) {
    if (puck.y < m.y - 0.01) return { x: W / 2 + (puck.x - W / 2) * 0.5, y: R_M + 0.01 }; // パックが後ろにある → 下がって回り込む
    const gx = W / 2 + (rnd() - 0.5) * GOAL * (1 + lv.err * 6);
    const ax = gx - puck.x;
    const ay = H - puck.y;
    const al = Math.hypot(ax, ay);
    return { x: puck.x + (ax / al) * 0.15 + (rnd() - 0.5) * lv.err, y: puck.y + (ay / al) * 0.15 };
  }
  let x = puck.x;
  if (puck.vy < -0.05) { // こちらへ向かってくる → 構える線に来る位置を読む（横の壁の跳ね返りも）
    const t = (puck.y - defY) / -puck.vy;
    x = puck.x + puck.vx * t;
    const span = W - 2 * R_P;
    x = ((x - R_P) % (2 * span) + 2 * span) % (2 * span);
    x = R_P + (x > span ? 2 * span - x : x);
  }
  x = Math.min(W / 2 + GOAL / 2 + 0.05, Math.max(W / 2 - GOAL / 2 - 0.05, x));
  return { x: x + (rnd() - 0.5) * lv.err * 2, y: defY };
}

const flipO = (o) => ({ x: W - o.x, y: H - o.y, vx: -(o.vx ?? 0), vy: -(o.vy ?? 0) });

/* ---------- 動き（3人・六角形） ---------- */

const dir = (deg) => ({ x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) });
const seatDir = (p) => dir(90 + 120 * p);
// 6つの辺（u = 外向きの向き）。goal = その辺をゴールにしている席（壁は -1）
const EDGES = [30, 90, 150, 210, 270, 330].map((deg) => ({ u: dir(deg), goal: (deg - 90) % 120 === 0 ? (((deg - 90) / 120) % 3 + 3) % 3 : -1 }));
const POSTS = [0, 1, 2].flatMap((p) => {
  const u = seatDir(p);
  return [1, -1].map((k) => ({ x: u.x * HEX_A - u.y * k * (GOAL3 / 2), y: u.y * HEX_A + u.x * k * (GOAL3 / 2) }));
});
// 席ごとのマレットの動ける範囲（「向き・点 ≦ 上限」の組の並び）: 盤の内側と、自分の扇形（境目から R_M 離れる）
const MALLET_LIMITS = [0, 1, 2].map((p) => {
  const c = 90 + 120 * p;
  const a = dir(c + 30);
  const b = dir(c - 30);
  return [...EDGES.map((e) => [e.u.x, e.u.y, HEX_A - R_M]), [-a.x, -a.y, -R_M], [-b.x, -b.y, -R_M]];
});

export const zoneHex = (q) => {
  const deg = (Math.atan2(q.y, q.x) * 180) / Math.PI;
  return (((Math.round((deg - 90) / 120)) % 3) + 3) % 3;
};
const serveHex = (p) => { const u = seatDir(p); return { x: u.x * 0.3, y: u.y * 0.3, vx: 0, vy: 0 }; };
const homeHex = (p) => { const u = seatDir(p); return { x: u.x * (HEX_A - 0.16), y: u.y * (HEX_A - 0.16), vx: 0, vy: 0 }; };

// 範囲の外なら、はみ出した線へ順に寄せる（どの角も90°以上に開いているので数回でおさまる）
export function clampHex(p, x, y) {
  const q = { x, y };
  for (let it = 0; it < 8; it++) {
    let moved = false;
    for (const [ux, uy, lim] of MALLET_LIMITS[p]) {
      const d = q.x * ux + q.y * uy - lim;
      if (d > 1e-12) { q.x -= d * ux; q.y -= d * uy; moved = true; }
    }
    if (!moved) break;
  }
  return q;
}

// パックを dt 秒進める。ゴールに入ったら、入れられた席（0〜2）を返す
export function stepHex(puck, mallets, dt, ev = null) {
  friction(puck, dt);
  let hit = 0;
  let wall = 0;
  for (const m of mallets) hit = Math.max(hit, bounceCircle(puck, m.x, m.y, R_P + R_M, m.vx, m.vy));
  for (const e of EDGES) {
    const d = puck.x * e.u.x + puck.y * e.u.y; // 中心から外向きの距離
    if (e.goal >= 0 && Math.abs(-puck.x * e.u.y + puck.y * e.u.x) < GOAL3 / 2) { // ゴールの口の前
      if (d > HEX_A + R_P) return e.goal;
      continue;
    }
    if (d > HEX_A - R_P) {
      puck.x -= (d - (HEX_A - R_P)) * e.u.x;
      puck.y -= (d - (HEX_A - R_P)) * e.u.y;
      const vn = puck.vx * e.u.x + puck.vy * e.u.y;
      if (vn > 0) { wall = Math.max(wall, vn); puck.vx -= (1 + E_WALL) * vn * e.u.x; puck.vy -= (1 + E_WALL) * vn * e.u.y; }
    }
  }
  for (const q of POSTS) wall = Math.max(wall, bounceCircle(puck, q.x, q.y, R_P, 0, 0, E_WALL));
  if (ev) { ev.hit = Math.max(ev.hit, hit); ev.wall = Math.max(ev.wall, wall); }
  capSpeed(puck);
  return null;
}

// 3人の CPU。考え方は2人と同じで、自分のゴールが下に来る向きに回して考える。
// 打ち込む先は、2人の相手のうちゴールの前から離れている方（ときどき逆）
const rot = (o, deg) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return { x: o.x * c - o.y * s, y: o.x * s + o.y * c };
};
export function cpuHex(p, puck, m, lv, rnd, mallets) {
  const back = (o) => rot(o, 120 * p);
  const q = rot(puck, -120 * p);
  const v = rot({ x: puck.vx, y: puck.vy }, -120 * p);
  const mm = rot(m, -120 * p);
  const defY = HEX_A - 0.2;
  if (zoneHex(puck) === p) {
    if (q.y > mm.y + 0.01) return back({ x: q.x * 0.5, y: HEX_A - R_M - 0.01 }); // パックが後ろにある → 下がって回り込む
    const opp = [(p + 1) % 3, (p + 2) % 3].map((o) => {
      const g = homeHex(o);
      const om = mallets?.[o] ?? g;
      return { o, open: Math.hypot(om.x - g.x, om.y - g.y) };
    }).sort((a, b) => b.open - a.open);
    const o = (rnd() < 0.75 ? opp[0] : opp[1]).o;
    const u = seatDir(o);
    const off = (rnd() - 0.5) * GOAL3 * (1 + lv.err * 6);
    const gx = u.x * HEX_A - u.y * off;
    const gy = u.y * HEX_A + u.x * off;
    const ax = gx - puck.x;
    const ay = gy - puck.y;
    const al = Math.hypot(ax, ay) || 1;
    const e = (rnd() - 0.5) * lv.err;
    return { x: puck.x + (ax / al) * 0.15 + e, y: puck.y + (ay / al) * 0.15 + e };
  }
  let x = q.x;
  if (v.y > 0.05) x = q.x + v.x * ((defY - q.y) / v.y); // こちらへ向かってくる → 構える線に来る位置を読む（壁の跳ね返りは読まない）
  x = Math.min(GOAL3 / 2 + 0.05, Math.max(-GOAL3 / 2 - 0.05, x));
  return back({ x: x + (rnd() - 0.5) * lv.err * 2, y: defY });
}

/* ---------- 台（盤の形ごとの関数の組） ---------- */

const RECT = {
  n: 2, w: W, h: H,
  step(puck, ms, dt, ev) { const g = stepPuck(puck, ms, dt, ev); return g === null ? null : 1 - g; },
  clamp: clampMallet,
  zone: (q) => (q.y > H / 2 ? 0 : 1),
  serve: servePuck,
  home: homeMallet,
  cpu(p, puck, m, lv, rnd) {
    if (p === 1) return cpuTarget(puck, m, lv, rnd);
    const t = cpuTarget(flipO(puck), flipO(m), lv, rnd);
    return { x: W - t.x, y: H - t.y };
  },
};
const HEX = {
  n: 3, w: 2 * (HEX_R + PAD), h: 2 * (HEX_A + PAD),
  step: stepHex, clamp: clampHex, zone: zoneHex, serve: serveHex, home: homeHex, cpu: cpuHex,
};

// 点数: 2人は取った点、3人は失点（c = 入れられた席）
export function addGoal(n, score, c) {
  const sc = score.slice();
  if (n === 2) sc[1 - c]++;
  else sc[c]++;
  return sc;
}
// 決着していれば { rank: 席ごとの順位（1から。同点は同じ順位） }
export function overOf(n, score, target) {
  if (n === 2) {
    const w = score.findIndex((x) => x >= target);
    return w < 0 ? null : { rank: [w === 0 ? 1 : 2, w === 1 ? 1 : 2] };
  }
  if (!score.some((x) => x >= target)) return null;
  return { rank: score.map((x) => 1 + score.filter((y) => y < x).length) };
}
// 1位は勝ち・最下位は負け・あいだは引き分けの音（観戦・同じ画面の2人は勝ちの音）
function overSound(rank, me) {
  if (me === null || me === undefined || me < 0) return 'win';
  const r = rank[me];
  return r === 1 ? 'win' : r === Math.max(...rank) ? 'lose' : 'draw_game';
}

/* ---------- 画面 ---------- */

function drawPieces(ctx, P, s, st) {
  st.mallets.forEach((m, p) => {
    const [x, y] = P(m.x, m.y);
    ctx.fillStyle = COLORS[p];
    ctx.beginPath();
    ctx.arc(x, y, R_M * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.arc(x, y, R_M * s * 0.45, 0, Math.PI * 2);
    ctx.fill();
  });
  if (st.puckVisible !== false) {
    const [x, y] = P(st.puck.x, st.puck.y);
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(x, y, R_P * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBanner(ctx, text, s, cx, cy, rotate) {
  ctx.save();
  ctx.translate(cx, cy);
  if (rotate) ctx.rotate(Math.PI);
  ctx.font = `800 ${Math.round(s * 0.11)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  const tw = ctx.measureText(text).width;
  ctx.fillRect(-tw / 2 - 12, -s * 0.08, tw + 24, s * 0.16);
  ctx.fillStyle = '#2d2a26';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawRect(ctx, view, st, P, opts) {
  const { s, w, h } = view;
  const flip = opts.flip;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#eef6fb';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b9d3e3';
  ctx.lineWidth = Math.max(2, s * 0.008);
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, s * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  // ゴール
  for (const [y, p] of [[0, 1], [H, 0]]) {
    ctx.fillStyle = COLORS[p];
    ctx.globalAlpha = 0.85;
    const [gx, gy] = P(W / 2, y);
    ctx.fillRect(gx - (GOAL / 2) * s, gy - s * 0.012, GOAL * s, s * 0.024);
    ctx.globalAlpha = 1;
  }
  // 点数（盤の中央の線の近く。2人で同じ画面のときは上の人の分を逆さに）
  ctx.font = `700 ${Math.round(s * 0.16)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of [0, 1]) {
    const bottom = (p === 0) !== flip;
    ctx.save();
    ctx.translate(w * 0.85, bottom ? h / 2 + s * 0.13 : h / 2 - s * 0.13);
    if (!bottom && opts.rotateTop) ctx.rotate(Math.PI);
    ctx.fillStyle = COLORS[p];
    ctx.globalAlpha = 0.35;
    ctx.fillText(String(st.score[p]), 0, 0);
    ctx.restore();
  }
  drawPieces(ctx, P, s, st);
  if (st.banner) {
    for (const [cy, rot] of opts.rotateTop ? [[h * 0.3, true], [h * 0.7, false]] : [[h / 2, false]]) drawBanner(ctx, st.banner, s, w / 2, cy, rot);
  }
}

function drawHex(ctx, view, st, P) {
  const { s, w, h } = view;
  ctx.clearRect(0, 0, w, h);
  const corners = [0, 1, 2, 3, 4, 5].map((k) => { const v = dir(60 * k); return P(v.x * HEX_R, v.y * HEX_R); });
  const outline = () => {
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = '#eef6fb';
  ctx.fill();
  // 陣地の境目（中心から壁のまん中へ）と中央の円
  ctx.strokeStyle = '#b9d3e3';
  ctx.lineWidth = Math.max(2, s * 0.008);
  const [cx, cy] = P(0, 0);
  for (const deg of [30, 150, 270]) {
    const v = dir(deg);
    const [x, y] = P(v.x * HEX_A, v.y * HEX_A);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  // 縁
  outline();
  ctx.strokeStyle = '#5b7f99';
  ctx.lineWidth = Math.max(4, s * 0.022);
  ctx.lineJoin = 'round';
  ctx.stroke();
  // ゴール（縁の上に席の色で）
  ctx.lineWidth = Math.max(5, s * 0.03);
  for (let p = 0; p < 3; p++) {
    const u = seatDir(p);
    const [ax, ay] = P(u.x * HEX_A - u.y * (GOAL3 / 2), u.y * HEX_A + u.x * (GOAL3 / 2));
    const [bx, by] = P(u.x * HEX_A + u.y * (GOAL3 / 2), u.y * HEX_A - u.x * (GOAL3 / 2));
    ctx.strokeStyle = COLORS[p];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  // 失点（それぞれの陣地の中に薄く）
  ctx.font = `700 ${Math.round(s * 0.13)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.35;
  for (let p = 0; p < 3; p++) {
    const u = seatDir(p);
    const [x, y] = P(u.x * 0.42, u.y * 0.42);
    ctx.fillStyle = COLORS[p];
    ctx.fillText(String(st.score[p]), x, y);
  }
  ctx.globalAlpha = 1;
  drawPieces(ctx, P, s, st);
  if (st.banner) drawBanner(ctx, st.banner, s, w / 2, h / 2, false);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(text, cls, fn) {
  const b = el('button', 'btn ' + cls, text);
  b.type = 'button';
  b.onclick = fn;
  return b;
}
function selectEl(choices, value) {
  const s = el('select');
  for (const [v, label] of choices) {
    const o = el('option', '', label);
    o.value = String(v);
    o.selected = v === value;
    s.append(o);
  }
  return s;
}

// 遊ぶ前の設定（同じ画面で遊ぶとき）。最後に選んだものは端末に覚える
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('hockey-prefs')) ?? {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem('hockey-prefs', JSON.stringify(p)); } catch { /* 覚えられなくても遊べる */ }
}

// opts = { mode: 'cpu' | 'two' | 'online', status: 状態表示の要素, me（オンライン: 席の番号、観戦は -1）, names, rules, send,
//   isHost（オンライン: ホストの端末か）, cpuSeats()（オンライン: CPU が動かす席の番号の並び。部屋を出た人の席も入る） }
function mount(root, opts) {
  root.className = 'board hk';
  root.innerHTML = '';
  const status = opts.status;
  const online = opts.mode === 'online';
  let alive = true;
  let raf = 0;
  const canvas = el('canvas', 'hk-canvas');
  const ctx = canvas.getContext('2d');
  const panel = el('div', 'hk-panel');
  root.append(panel, canvas); // 設定・もう一回は盤の上（盤の下だとスマホで見落とすため）
  let n = online && Number(opts.rules?.players) === 3 ? 3 : 2;
  let T = n === 3 ? HEX : RECT;
  const view = { s: 1, w: 1, h: 1 };
  // 盤の座標 ↔ 画面の座標。自分は常に画面の下側（2人: オンラインの青は上下逆さ。3人: 自分のゴールが下に来るように回す）
  const flip = online && opts.me === 1;
  const ang = (-120 * (online && opts.me > 0 ? opts.me : 0) * Math.PI) / 180;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const toScreen = (x, y) => {
    if (n === 2) return [(flip ? W - x : x) * view.s, (flip ? H - y : y) * view.s];
    return [(x * ca - y * sa + T.w / 2) * view.s, (x * sa + y * ca + T.h / 2) * view.s];
  };
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) / view.s;
    const sy = (e.clientY - r.top) / view.s;
    if (n === 2) return flip ? { x: W - sx, y: H - sy } : { x: sx, y: sy };
    const rx = sx - T.w / 2;
    const ry = sy - T.h / 2;
    return { x: rx * ca + ry * sa, y: -rx * sa + ry * ca };
  };

  function resize() {
    const avail = Math.max(260, window.innerHeight - canvas.getBoundingClientRect().top - 90);
    const width = Math.min(root.clientWidth || 340, n === 3 ? 480 : 440, (avail / T.h) * T.w);
    const height = (width * T.h) / T.w;
    const dpr = window.devicePixelRatio || 1;
    canvas.classList.toggle('hex', n === 3);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.s = width / T.w;
    view.w = width;
    view.h = height;
  }
  window.addEventListener('resize', resize);

  const seats = () => Array.from({ length: n }, (_, i) => i);
  let st;
  let targets;
  let cpuTimer;
  let cpuGoal;
  function resetState() {
    st = { score: Array(n).fill(0), mallets: seats().map(T.home), puck: T.serve(0), banner: '', pause: 0, over: null };
    targets = seats().map((p) => ({ ...T.home(p) }));
    cpuTimer = Array(n).fill(0);
    cpuGoal = seats().map((p) => ({ ...T.home(p) }));
  }
  resetState();
  const pointers = new Map(); // 指（ポインター）→ どのマレットか
  let target = online ? Number(opts.rules?.points) || 7 : 7;
  let level = online ? CPU_LEVELS[opts.rules?.level] ?? CPU_LEVELS.weak : CPU_LEVELS.weak;
  let playing = false;

  // 指で動かす席・CPU が動かす席（オンラインの CPU はホストの端末だけが動かす）・この端末が動かす席
  const controlled = () => {
    if (online) return opts.me >= 0 ? [opts.me] : [];
    return opts.mode === 'two' ? [0, 1] : [0];
  };
  const botSeats = () => (online ? (opts.cpuSeats?.() ?? []).filter((p) => p >= 0 && p < n) : opts.mode === 'cpu' ? seats().slice(1) : []);
  const cpuSeats = () => (online && !opts.isHost ? [] : botSeats().filter((p) => !controlled().includes(p)));
  const driven = () => [...controlled(), ...cpuSeats()];

  canvas.addEventListener('pointerdown', (e) => {
    const w = toWorld(e);
    const mine = controlled();
    if (!mine.length) return;
    const p = mine.length === 2 ? (w.y > H / 2 ? 0 : 1) : mine[0];
    pointers.set(e.pointerId, p);
    targets[p] = w;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    const mine = controlled();
    let p = pointers.get(e.pointerId);
    if (p === undefined && e.pointerType === 'mouse' && mine.length === 1) p = mine[0]; // マウスは押さなくても動かせる
    if (p === undefined) return;
    targets[p] = toWorld(e);
    e.preventDefault();
  });
  const up = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const rnd = Math.random;
  function runCpus(dt, list) {
    for (const p of list) {
      cpuTimer[p] -= dt;
      if (cpuTimer[p] <= 0) { cpuTimer[p] = level.react; cpuGoal[p] = T.cpu(p, st.puck, st.mallets[p], level, rnd, st.mallets); }
      targets[p] = cpuGoal[p];
    }
  }

  // 自分から見た席（勝ち負けの文や音を決める）: オンラインは自分の席、CPU 戦は 0、同じ画面の2人は null
  const perspective = () => (online ? opts.me : opts.mode === 'cpu' ? 0 : null);
  const seatName = (p) => {
    if (online) return p === opts.me ? 'あなた' : esc(opts.names?.[p] ?? '');
    if (opts.mode === 'cpu') return p === 0 ? 'あなた' : n === 2 ? 'CPU' : `CPU${p}`;
    return PLAYERS[p];
  };
  const goalText = () => (n === 2 ? `${target}点先取` : `${target}点取られたら終わり`);
  // 決着したときの盤の上の文（画面に描くので色の名前を使う）
  function overBanner() {
    const me = perspective();
    const r = st.over.rank;
    if (me !== null && me >= 0) {
      if (r[me] === 1) return 'あなたの勝ち！';
      if (n === 2) return online ? 'あなたの負け' : 'CPU の勝ち';
      return `あなたは${r[me]}位`;
    }
    return `${seats().filter((p) => r[p] === 1).map((p) => PLAYERS[p]).join('と')}の勝ち${online ? '' : '！'}`;
  }
  function finish() {
    st.banner = overBanner();
    play(overSound(st.over.rank, perspective()));
    showOver();
  }

  /* ---------- 同じ画面（CPU・2人） ---------- */

  function startLocal() {
    resetState();
    st.pause = 0.6;
    playing = true;
    panel.innerHTML = '';
    resize();
    showStatus();
  }

  function localGoal(c) {
    st.score = addGoal(n, st.score, c);
    st.over = overOf(n, st.score, target);
    if (st.over) {
      playing = false;
      finish();
    } else {
      play('goal');
      st.banner = 'ゴール！';
      st.pause = GOAL_PAUSE;
      st.puck = T.serve(c); // 決められた側から
    }
    showStatus();
  }

  function localTick(dt) {
    if (st.pause > 0) {
      st.pause -= dt;
      if (st.pause <= 0) st.banner = '';
    }
    const bots = cpuSeats();
    runCpus(dt, bots);
    const steps = Math.ceil(dt / STEP);
    const ev = { hit: 0, wall: 0 };
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      for (let p = 0; p < n; p++) moveMallet(st.mallets[p], p, targets[p], bots.includes(p) ? level.speed : MALLET_V, h, T.clamp);
      if (!playing || st.pause > 0) continue;
      const c = T.step(st.puck, st.mallets, h, ev);
      if (c !== null) { localGoal(c); break; }
    }
    bumpSound(ev);
  }

  function showSetup() {
    playing = false;
    panel.innerHTML = '';
    const prefs = loadPrefs();
    const box = el('div', 'hk-setup');
    let pl;
    if (opts.mode === 'cpu') {
      pl = selectEl([[2, '2人（あなたと CPU）'], [3, '3人（あなたと CPU 2人）']], prefs.players === 3 ? 3 : 2);
      const row0 = el('label', 'hk-row');
      row0.append(el('span', '', '人数'), pl);
      box.append(row0);
    }
    const pts = selectEl(POINTS.map((p) => [p, `${p}点`]), POINTS.includes(prefs.points) ? prefs.points : 7);
    const row1 = el('label', 'hk-row');
    const ptsLabel = el('span');
    row1.append(ptsLabel, pts);
    box.append(row1);
    let lv;
    if (opts.mode === 'cpu') {
      lv = selectEl(Object.entries(CPU_LEVELS).map(([k, v]) => [k, v.name]), CPU_LEVELS[prefs.level] ? prefs.level : 'weak');
      const row2 = el('label', 'hk-row');
      row2.append(el('span', '', 'CPU の強さ'), lv);
      box.append(row2);
    }
    const note = el('p', 'hk-note');
    box.append(note);
    // 人数を変えたら、盤の形と説明をその場で切り替えて見せる
    const showPlayers = () => {
      n = pl && Number(pl.value) === 3 ? 3 : 2;
      T = n === 3 ? HEX : RECT;
      resetState();
      ptsLabel.textContent = n === 3 ? '何点取られたら終わり' : '何点先取';
      note.textContent = opts.mode !== 'cpu'
        ? '下の人が赤、上の人が青です。それぞれ自分の側の画面を指で動かします。'
        : n === 3
          ? 'あなたは下の赤です。自分のゴール（下）を守りながら、ほかの2人のゴールへパックを入れてください。失点のいちばん少ない人の勝ちです。'
          : 'あなたは下の赤です。指（パソコンはマウス）でマレットを動かして、パックを上のゴールへ入れてください。';
      resize();
    };
    if (pl) pl.onchange = showPlayers;
    box.append(btn('始める', 'primary', () => {
      target = Number(pts.value);
      if (lv) level = CPU_LEVELS[lv.value];
      savePrefs({ points: target, level: lv?.value ?? prefs.level, players: pl ? n : prefs.players });
      startLocal();
    }));
    panel.append(box);
    showPlayers();
    status.innerHTML = `<div class="status-main">${opts.mode === 'cpu' ? 'CPU と対戦' : 'この画面で2人で'}</div>`;
  }

  function showOver() {
    panel.innerHTML = '';
    const row = el('div', 'hk-actions');
    if (online) {
      if (opts.me >= 0) row.append(btn('もう一回', 'primary', () => onlineRestart()));
    } else {
      row.append(btn('もう一回', 'primary', () => startLocal()), btn('設定を変える', 'secondary', () => showSetup()));
    }
    panel.append(row);
    resize(); // 上にボタンが増えた分、盤を縮めて画面に収める
  }

  function scoreHtml() {
    if (n === 2) return `<b style="color:${COLORS[0]}">${st.score[0]}</b> − <b style="color:${COLORS[1]}">${st.score[1]}</b>`;
    return '失点 ' + seats().map((p) => `<b style="color:${COLORS[p]}">${st.score[p]}</b>`).join(' ・ ');
  }

  function showStatus() {
    if (online) {
      let main = scoreHtml();
      if (st.over) {
        const me = opts.me;
        const r = st.over.rank;
        if (me < 0) main = `${seats().filter((p) => r[p] === 1).map(seatName).join('と')}の勝ち！`;
        else if (r[me] === 1) main = 'あなたの勝ち！🎉';
        else main = n === 2 ? 'あなたの負け…' : `あなたは${r[me]}位`;
      } else if (!net.started) main = n === 2 ? '相手を待っています…' : 'ほかの人を待っています…';
      const lag = net.rtt === null ? '測っています…' : `往復 ${Math.round(net.rtt)}ms（直近10回の最大 ${Math.round(net.rttMax)}ms）`;
      const quiet = net.quietShown ? `・<b>${n === 2 ? '相手' : 'ほかの人'}の応答がありません</b>` : '';
      const who = seats().map((p) => `<span style="color:${COLORS[p]}">${PLAYERS[p]}</span> ${seatName(p)}`).join(' ／ ');
      status.innerHTML = `<div class="status-main">${main}</div><div class="status-sub">${who}・${goalText()}<br>通信の遅れ: ${lag}${quiet}</div>`;
      return;
    }
    const sub = opts.mode === 'cpu' ? `CPU${n === 3 ? ' 2人' : ''}（${level.name}）と対戦・${goalText()}` : `この画面で2人で・${goalText()}`;
    status.innerHTML = `<div class="status-main">${st.over ? st.banner : scoreHtml()}</div><div class="status-sub">${sub}</div>`;
  }

  /* ---------- オンライン（試作） ---------- */

  // owner = パックの持ち主の席。handed = 自分が持ち主を渡した席（受け取ったと分かるまでパックの位置を送り続ける）。
  // said = 席 → その席を動かしている端末が思っている持ち主。heard = 席 → 最後にその席の端末から届いた時刻
  const net = {
    started: false, owner: 0, ep: 0, lastSend: 0, lastPing: 0, rtt: null, rttMax: 0, rtts: [], handed: -1, said: {}, heard: {},
    lastHi: 0, quietShown: false, id: Math.random().toString(36).slice(2),
  };
  // 待つ相手: 自分以外の人の席（CPU の席は待たない）
  const needed = () => seats().filter((p) => p !== opts.me && !botSeats().includes(p));
  function checkStart() {
    if (net.started) return;
    const ok = driven().length ? needed().every((p) => net.heard[p]) : Object.keys(net.heard).length > 0;
    if (ok) { net.started = true; showStatus(); }
  }

  function onlineReset(ep) {
    net.ep = ep;
    net.owner = 0;
    net.handed = -1;
    st.score = Array(n).fill(0);
    st.over = null;
    st.puck = T.serve(0);
    st.banner = '';
    st.pause = 0.8;
    panel.innerHTML = '';
    resize();
    showStatus();
  }
  function onlineRestart() {
    const ep = net.ep + 1;
    opts.send({ k: 'restart', ep }, true);
    onlineReset(ep);
  }
  // 届いたパックの位置を、通信の遅れの半分だけ先へ進める（壁の跳ね返りだけ見る）
  function advance(p, sec) {
    const q = { ...p };
    const steps = Math.min(120, Math.ceil(sec / STEP));
    for (let i = 0; i < steps; i++) if (T.step(q, [], sec / steps) !== null) break;
    return q;
  }
  const lead = () => (net.rtt ?? 100) / 2000;

  function receive(d) {
    if (!d || typeof d !== 'object') return;
    const by = Array.isArray(d.c) ? d.c.filter((p) => Number.isInteger(p) && p >= 0 && p < n) : [];
    const now = performance.now();
    for (const p of by) net.heard[p] = now;
    checkStart();
    const dv = driven();
    if (d.k === 'hi' && dv.length && by.length && !d.ack) opts.send({ k: 'hi', ack: true, c: dv });
    if (d.k === 'ping' && dv.length && d.id !== net.id) opts.send({ k: 'pong', t: d.t, to: d.id });
    if (d.k === 'pong' && d.to === net.id) {
      const r = performance.now() - d.t;
      // 直近10回の中央値と最大（つながった直後の大きな値を引きずらないように）
      net.rtts = [...net.rtts.slice(-9), r];
      const sorted = net.rtts.slice().sort((a, b) => a - b);
      net.rtt = sorted[Math.floor(sorted.length / 2)];
      net.rttMax = sorted.at(-1);
      showStatus();
    }
    if (d.k === 'restart' && d.ep > net.ep) onlineReset(d.ep);
    if (d.k === 'goal' && d.ep > net.ep) applyGoal(d);
    if (d.k === 's' && by.length) {
      if (Array.isArray(d.m)) for (const e of d.m) if (Array.isArray(e) && by.includes(e[0]) && !dv.includes(e[0])) targets[e[0]] = { x: e[1], y: e[2] };
      // 相手の方が進んでいる（こちらが途中で再読み込みした）: 相手の点数に合わせる
      if (d.ep > net.ep && Array.isArray(d.sc) && d.sc.length === n && !st.over) {
        net.ep = d.ep;
        net.owner = d.o;
        net.handed = -1;
        if (dv.includes(d.o)) st.puck = T.serve(d.o); // 自分の受け持ちだったパックの位置は消えたので、その陣地に置き直す
        st.score = d.sc.slice();
        st.pause = 0;
        st.banner = '';
        showStatus();
      }
      if (d.ep !== net.ep) return;
      for (const p of by) net.said[p] = d.o; // その端末がいま誰を持ち主だと思っているか
      if (!d.p) return;
      const p = { x: d.p[0], y: d.p[1], vx: d.p[2], vy: d.p[3] };
      // 持ち主を渡された・持ち主から位置が届いた（自分が持ち主の間は、ほかから届いた位置を使わない）
      if (!dv.includes(net.owner) && (dv.includes(d.o) || by.includes(d.o))) { net.owner = d.o; st.puck = advance(p, lead()); }
      if (Array.isArray(d.sc) && d.sc.length === n && opts.me < 0) st.score = d.sc.slice();
    }
  }

  function applyGoal(d) {
    if (!Array.isArray(d.sc) || d.sc.length !== n) return;
    net.ep = d.ep;
    st.score = d.sc.slice();
    st.puck = T.serve(d.serve);
    net.owner = d.serve;
    net.handed = -1;
    st.over = overOf(n, st.score, target);
    if (st.over) finish();
    else {
      play('goal');
      st.banner = 'ゴール！';
      st.pause = GOAL_PAUSE;
    }
    showStatus();
  }

  function onlineTick(dt, now) {
    const dv = driven();
    if (dv.length) {
      if (!net.started && now - net.lastHi > 500) { net.lastHi = now; opts.send({ k: 'hi', c: dv }); }
      // 遅れを測る合図の時刻は performance.now()（描き替えの時刻 now は古いことがあり、遅れが大きく出る）
      if (now - net.lastPing > 1000) { net.lastPing = now; opts.send({ k: 'ping', t: performance.now(), id: net.id }); }
      const t = performance.now();
      const quiet = net.started && needed().some((p) => t - (net.heard[p] ?? 0) > 3000);
      if (quiet !== net.quietShown) { net.quietShown = quiet; showStatus(); }
    }
    checkStart();
    if (st.pause > 0) { st.pause -= dt; if (st.pause <= 0 && !st.over) st.banner = ''; }
    const bots = cpuSeats();
    runCpus(dt, bots);
    const steps = Math.ceil(dt / STEP);
    const ev = { hit: 0, wall: 0 }; // ほかの陣地ではマレットの当たりを計算しないので、ほかの人が打った音は鳴らない（壁の音だけ）
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      // ほかの端末のマレットは届いた位置へなめらかに
      for (let p = 0; p < n; p++) moveMallet(st.mallets[p], p, targets[p], !dv.includes(p) ? MALLET_V * 2 : bots.includes(p) ? level.speed : MALLET_V, h, T.clamp);
      if (!net.started || st.over || st.pause > 0) continue;
      if (dv.includes(net.owner)) {
        const c = T.step(st.puck, dv.map((p) => st.mallets[p]), h, ev);
        if (c !== null) { // この端末が動かしている陣地のゴールに入った（＝決められた）
          const d = { k: 'goal', ep: net.ep + 1, sc: addGoal(n, st.score, c), serve: c };
          opts.send(d, true);
          applyGoal(d);
          break;
        }
        const z = T.zone(st.puck);
        if (z !== net.owner) {
          net.owner = z;
          if (!dv.includes(z)) { net.handed = z; sendState(now, true, dv); }
        }
      } else if (T.step(st.puck, [], h, ev) !== null) {
        st.puck.vx = 0; st.puck.vy = 0; // ほかの陣地のゴールの判定はその陣地の端末に任せる
      }
    }
    bumpSound(ev);
    if (dv.length && now - net.lastSend > SEND_MS) sendState(now, false, dv);
  }

  function sendState(now, handoff, dv) {
    net.lastSend = now;
    const d = { k: 's', ep: net.ep, o: net.owner, c: dv, m: dv.map((p) => [p, r4(st.mallets[p].x), r4(st.mallets[p].y)]), sc: st.score };
    // パックの位置を付けるのは、自分が持ち主のとき・持ち主を渡したのに相手がまだ受け取っていないとき
    // （渡す知らせが1通落ちても、次の送信で渡し直せるように）
    if (dv.includes(net.owner) || handoff || (net.handed === net.owner && net.said[net.owner] !== net.owner)) {
      d.p = [r4(st.puck.x), r4(st.puck.y), r4(st.puck.vx), r4(st.puck.vy)];
    }
    opts.send(d, handoff);
  }

  /* ---------- まわす ---------- */

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    if (online) onlineTick(dt, now);
    else localTick(dt);
  }
  function frame(now) {
    if (!alive) return;
    tick(now);
    if (n === 2) drawRect(ctx, view, st, toScreen, { rotateTop: opts.mode === 'two', flip });
    else drawHex(ctx, view, st, toScreen);
    raf = requestAnimationFrame(frame);
  }
  // 画面が隠れて描き替えが止まっても（ほかのアプリへ切り替えたときなど）、オンラインでは位置のやり取りを続ける
  const backup = setInterval(() => {
    const now = performance.now();
    if (alive && online && now - last > 120) tick(now);
  }, 50);

  resize();
  if (online) {
    if (opts.me < 0) panel.append(el('p', 'hk-note', '観戦中です。'));
    else panel.append(el('p', 'hk-note', 'オンラインは試作です。下の通信の遅れの数字と、打ったときの感触を教えてください。'));
    showStatus();
  } else showSetup();
  raf = requestAnimationFrame(frame);

  return {
    receive,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(backup);
      window.removeEventListener('resize', resize);
    },
  };
}

const r4 = (v) => Math.round(v * 10000) / 10000;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default {
  id: 'hockey',
  name: 'エアホッケー',
  icon: '🏒',
  desc: 'マレットでパックを打ち合う。CPU と、または同じ画面で2人で。3人（六角形の盤）も。オンラインは試作',
  ready: true,
  live: true,
  players: PLAYERS,
  // 詳細設定の人数（2・3人）。待合室の席の数になる。3人のときだけ CPU を選べる
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  liveCpu(rules) { return rules?.players === 3; },
  settings: [
    { key: 'players', label: '人数', desc: '3人は六角形の盤で、人が足りなければ CPU が入る', def: 2, choices: [[2, '2人'], [3, '3人']] },
    { key: 'points', label: '何点で終わり', desc: '2人は先にこの点を取った方の勝ち。3人は誰かがこの数だけ入れられたら終わりで、失点の少ない人の勝ち', def: 7, choices: POINTS.map((p) => [p, `${p}点`]) },
    { key: 'level', label: 'CPU の強さ', desc: '3人で CPU が入るとき', def: 'weak', choices: Object.entries(CPU_LEVELS).map(([k, v]) => [k, v.name]) },
  ],
  mount,
};
