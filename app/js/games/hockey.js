// エアホッケー。手の一覧で進むほかのゲームと違い、毎フレーム動くので main.js の「live」の形で動かす
// （mount(要素, 設定) で始まり、自分で描いて自分で進める。main.js は部屋・待合室・通信の取り次ぎだけ）。
//
// 決めごと（本人の判断・2026-10-03）: 何点先取かは始める前に選ぶ（最初は7点）。CPU の強さは始める前に3段階から選ぶ。
//   パソコンでは「この画面で2人で」を出さない（main.js が指で触れる端末のときだけボタンを出す）。オンラインは試作で、
//   通信の遅れ（往復の時間）を画面に出し、本人が実際に試して続けるか決める。
// Claude の判断: 盤は縦長（幅1・高さ1.6）。マレット（打つ道具）は自分の陣地（半分）から出られない。
//   ゴールされた側から打ち始める。最初は下側（赤）から。
//
// オンラインの同期（試作）: 「パックが今ある陣地の人」がパックの動きを計算して相手に送る（持ち主）。
//   パックが中央の線を越えたら持ち主を相手に渡す。自分の陣地では自分の端末で当たりを計算するので、打った感触に遅れが出ない。
//   相手の陣地にあるパックは、届いた位置から通信の遅れの分だけ先へ進めて描く。ゴールは持ち主（＝決められた側）が判定して知らせる。

import { play, endSound } from '../sound.js';

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

export const CPU_LEVELS = {
  weak: { name: 'よわい', speed: 1.4, react: 0.32, err: 0.14 },
  normal: { name: 'ふつう', speed: 2.4, react: 0.16, err: 0.07 },
  strong: { name: 'つよい', speed: 3.6, react: 0.06, err: 0.025 },
};
const POINTS = [3, 5, 7, 10];
const COLORS = ['#d9643a', '#2f6fb3'];

/* ---------- 動き ---------- */

const servePuck = (side) => ({ x: W / 2, y: side === 0 ? H * 0.72 : H * 0.28, vx: 0, vy: 0 });
const homeMallet = (p) => ({ x: W / 2, y: p === 0 ? H - 0.16 : 0.16, vx: 0, vy: 0 });

export function clampMallet(p, x, y) {
  return {
    x: Math.min(W - R_M, Math.max(R_M, x)),
    y: p === 0 ? Math.min(H - R_M, Math.max(H / 2 + R_M, y)) : Math.min(H / 2 - R_M, Math.max(R_M, y)),
  };
}

function moveMallet(m, p, target, maxV, dt) {
  const t = clampMallet(p, target.x, target.y);
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

// パックを dt 秒進める。ゴールに入ったら点を取った側（0 / 1）を返す。mallets は当たりを見るマレット。
// ev（任意）を渡すと、マレットに当たった強さ（ev.hit）と壁に当たった強さ（ev.wall）のいちばん大きいものを書き込む（効果音用）
export function stepPuck(puck, mallets, dt, ev = null) {
  puck.x += puck.vx * dt;
  puck.y += puck.vy * dt;
  const f = Math.max(0, 1 - FRICTION * dt);
  puck.vx *= f;
  puck.vy *= f;
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
  const v = Math.hypot(puck.vx, puck.vy);
  if (v > MAX_V) { puck.vx *= MAX_V / v; puck.vy *= MAX_V / v; }
  return null;
}

// 1回の描き替えの間にパックが当たった音。マレットの音を優先し、ゆっくり触れただけ・壁をこすっているだけでは鳴らさない
function bumpSound(ev) {
  if (ev.hit > 0.3) play('smack', ev.hit / 2.5);
  else if (ev.wall > 0.4) play('wall', ev.wall / 3);
}

/* ---------- CPU（上側・プレイヤー1） ---------- */

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

/* ---------- 画面 ---------- */

function drawTable(ctx, view, st, opts) {
  const { s, flip, w, h } = view;
  const X = (x) => (flip ? W - x : x) * s;
  const Y = (y) => (flip ? H - y : y) * s;
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
    const gy = Y(y);
    ctx.fillRect(X(W / 2) - (GOAL / 2) * s, gy - s * 0.012, GOAL * s, s * 0.024);
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
  // マレットとパック
  st.mallets.forEach((m, p) => {
    ctx.fillStyle = COLORS[p];
    ctx.beginPath();
    ctx.arc(X(m.x), Y(m.y), R_M * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.arc(X(m.x), Y(m.y), R_M * s * 0.45, 0, Math.PI * 2);
    ctx.fill();
  });
  if (st.puckVisible !== false) {
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(X(st.puck.x), Y(st.puck.y), R_P * s, 0, Math.PI * 2);
    ctx.fill();
  }
  if (st.banner) {
    for (const [cy, rot] of opts.rotateTop ? [[h * 0.3, true], [h * 0.7, false]] : [[h / 2, false]]) {
      ctx.save();
      ctx.translate(w / 2, cy);
      if (rot) ctx.rotate(Math.PI);
      ctx.font = `800 ${Math.round(s * 0.11)}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      const tw = ctx.measureText(st.banner).width;
      ctx.fillRect(-tw / 2 - 12, -s * 0.08, tw + 24, s * 0.16);
      ctx.fillStyle = '#2d2a26';
      ctx.fillText(st.banner, 0, 0);
      ctx.restore();
    }
  }
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

// opts = { mode: 'cpu' | 'two' | 'online', status: 状態表示の要素, me（オンライン: 0 / 1、観戦は -1）, names, rules, send }
function mount(root, opts) {
  root.className = 'board hk';
  root.innerHTML = '';
  const status = opts.status;
  let alive = true;
  let raf = 0;
  const canvas = el('canvas', 'hk-canvas');
  const ctx = canvas.getContext('2d');
  const panel = el('div', 'hk-panel');
  root.append(panel, canvas); // 設定・もう一回は盤の上（盤の下だとスマホで見落とすため）
  const view = { s: 1, w: 1, h: 1, flip: opts.mode === 'online' && opts.me === 1 };

  function resize() {
    const avail = Math.max(260, window.innerHeight - canvas.getBoundingClientRect().top - 90);
    const width = Math.min(root.clientWidth || 340, 440, avail / H);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${width * H}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(width * H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.s = width;
    view.w = width;
    view.h = width * H;
  }
  window.addEventListener('resize', resize);

  // 画面の座標 → 盤の座標
  const toWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / view.s;
    const y = (e.clientY - r.top) / view.s;
    return view.flip ? { x: W - x, y: H - y } : { x, y };
  };

  const st = { score: [0, 0], mallets: [homeMallet(0), homeMallet(1)], puck: servePuck(0), banner: '', pause: 0, over: null };
  const targets = [{ ...homeMallet(0) }, { ...homeMallet(1) }];
  const pointers = new Map(); // 指（ポインター）→ どちらのマレットか
  let target = opts.mode === 'online' ? Number(opts.rules?.points) || 7 : 7;
  let level = CPU_LEVELS.weak;
  let playing = false;

  const controlled = () => {
    if (opts.mode === 'online') return opts.me >= 0 ? [opts.me] : [];
    return opts.mode === 'two' ? [0, 1] : [0];
  };
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

  /* ---------- 同じ画面（CPU・2人） ---------- */

  let cpuTimer = 0;
  let cpuGoal = { ...homeMallet(1) };
  const rnd = Math.random;

  function startLocal() {
    st.score = [0, 0];
    st.mallets = [homeMallet(0), homeMallet(1)];
    st.puck = servePuck(0);
    st.over = null;
    st.banner = '';
    st.pause = 0.6;
    playing = true;
    panel.innerHTML = '';
    resize();
    showStatus();
  }

  function localGoal(scorer) {
    st.score[scorer]++;
    if (st.score[scorer] >= target) {
      st.over = { winner: scorer };
      st.banner = opts.mode === 'cpu' ? (scorer === 0 ? 'あなたの勝ち！' : 'CPU の勝ち') : `${scorer === 0 ? '赤' : '青'}の勝ち！`;
      playing = false;
      play(endSound(st.over, opts.mode === 'cpu' ? 0 : null));
      showOver();
    } else {
      play('goal');
      st.banner = 'ゴール！';
      st.pause = GOAL_PAUSE;
      st.puck = servePuck(1 - scorer); // 決められた側から
    }
    showStatus();
  }

  function localTick(dt) {
    if (st.pause > 0) {
      st.pause -= dt;
      if (st.pause <= 0) st.banner = '';
    }
    if (opts.mode === 'cpu') {
      cpuTimer -= dt;
      if (cpuTimer <= 0) { cpuTimer = level.react; cpuGoal = cpuTarget(st.puck, st.mallets[1], level, rnd); }
      targets[1] = cpuGoal;
    }
    const n = Math.ceil(dt / STEP);
    const ev = { hit: 0, wall: 0 };
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      moveMallet(st.mallets[0], 0, targets[0], MALLET_V, h);
      moveMallet(st.mallets[1], 1, targets[1], opts.mode === 'cpu' ? level.speed : MALLET_V, h);
      if (!playing || st.pause > 0) continue;
      const g = stepPuck(st.puck, st.mallets, h, ev);
      if (g !== null) { localGoal(g); break; }
    }
    bumpSound(ev);
  }

  function showSetup() {
    playing = false;
    panel.innerHTML = '';
    const prefs = loadPrefs();
    const box = el('div', 'hk-setup');
    const pts = selectEl(POINTS.map((p) => [p, `${p}点`]), POINTS.includes(prefs.points) ? prefs.points : 7);
    const row1 = el('label', 'hk-row');
    row1.append(el('span', '', '何点先取'), pts);
    box.append(row1);
    let lv;
    if (opts.mode === 'cpu') {
      lv = selectEl(Object.entries(CPU_LEVELS).map(([k, v]) => [k, v.name]), CPU_LEVELS[prefs.level] ? prefs.level : 'weak');
      const row2 = el('label', 'hk-row');
      row2.append(el('span', '', 'CPU の強さ'), lv);
      box.append(row2);
    }
    box.append(el('p', 'hk-note', opts.mode === 'cpu'
      ? 'あなたは下の赤です。指（パソコンはマウス）でマレットを動かして、パックを上のゴールへ入れてください。'
      : '下の人が赤、上の人が青です。それぞれ自分の側の画面を指で動かします。'));
    box.append(btn('始める', 'primary', () => {
      target = Number(pts.value);
      if (lv) level = CPU_LEVELS[lv.value];
      savePrefs({ points: target, level: lv?.value ?? prefs.level });
      startLocal();
    }));
    panel.append(box);
    resize();
    status.innerHTML = `<div class="status-main">${opts.mode === 'cpu' ? 'CPU と対戦' : 'この画面で2人で'}</div>`;
  }

  function showOver() {
    panel.innerHTML = '';
    const row = el('div', 'hk-actions');
    if (opts.mode === 'online') {
      if (opts.me >= 0) row.append(btn('もう一回', 'primary', () => onlineRestart()));
    } else {
      row.append(btn('もう一回', 'primary', () => startLocal()), btn('設定を変える', 'secondary', () => showSetup()));
    }
    panel.append(row);
    resize(); // 上にボタンが増えた分、盤を縮めて画面に収める
  }

  function showStatus() {
    const sc = `<b style="color:${COLORS[0]}">${st.score[0]}</b> − <b style="color:${COLORS[1]}">${st.score[1]}</b>`;
    if (opts.mode === 'online') {
      const who = (p) => (p === opts.me ? 'あなた' : esc(opts.names?.[p] ?? ''));
      let main = st.over ? (st.over.winner === opts.me ? 'あなたの勝ち！🎉' : opts.me < 0 ? `${who(st.over.winner)}の勝ち！` : 'あなたの負け…') : sc;
      if (!net.started && !st.over) main = '相手を待っています…';
      const lag = net.rtt === null ? '測っています…' : `往復 ${Math.round(net.rtt)}ms（直近10回の最大 ${Math.round(net.rttMax)}ms）`;
      const quiet = net.started && performance.now() - net.lastHeard > 3000 ? '・<b>相手の応答がありません</b>' : '';
      status.innerHTML = `<div class="status-main">${main}</div><div class="status-sub"><span style="color:${COLORS[0]}">赤</span> ${who(0)} ／ <span style="color:${COLORS[1]}">青</span> ${who(1)}・${target}点先取<br>通信の遅れ: ${lag}${quiet}</div>`;
      return;
    }
    const sub = opts.mode === 'cpu' ? `CPU（${level.name}）と対戦・${target}点先取` : `この画面で2人で・${target}点先取`;
    status.innerHTML = `<div class="status-main">${st.over ? st.banner : sc}</div><div class="status-sub">${sub}</div>`;
  }

  /* ---------- オンライン（試作） ---------- */

  const other = 1 - opts.me;
  const net = { started: false, owner: 0, ep: 0, lastSend: 0, lastPing: 0, rtt: null, rttMax: 0, rtts: [], peerOwner: null, lastHeard: 0, lastHi: 0, quietShown: false };

  function onlineReset(ep) {
    net.ep = ep;
    net.owner = 0;
    st.score = [0, 0];
    st.over = null;
    st.puck = servePuck(0);
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
    const n = Math.min(120, Math.ceil(sec / STEP));
    for (let i = 0; i < n; i++) if (stepPuck(q, [], sec / n) !== null) break;
    return q;
  }
  const lead = () => (net.rtt ?? 100) / 2000;

  function receive(d, from) {
    if (!d || typeof d !== 'object') return;
    if (from === other || (opts.me < 0 && from >= 0)) {
      net.lastHeard = performance.now();
      if (!net.started) { net.started = true; showStatus(); }
    }
    if (d.k === 'hi' && opts.me >= 0 && from === other && !d.ack) opts.send({ k: 'hi', ack: true });
    if (d.k === 'ping' && opts.me >= 0 && from === other) opts.send({ k: 'pong', t: d.t, to: from });
    if (d.k === 'pong' && d.to === opts.me) {
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
    if (d.k === 's' && from >= 0 && from <= 1) {
      if (from !== opts.me && Array.isArray(d.m)) targets[from] = { x: d.m[0], y: d.m[1] };
      // 相手の方が進んでいる（こちらが途中で再読み込みした）: 相手の点数に合わせる
      if (d.ep > net.ep && Array.isArray(d.sc) && !st.over) {
        net.ep = d.ep;
        net.owner = d.o;
        if (d.o === opts.me) st.puck = servePuck(opts.me); // 自分の受け持ちだったパックの位置は消えたので、自分の陣地に置き直す
        st.score = d.sc.slice();
        st.pause = 0;
        st.banner = '';
        showStatus();
      }
      if (d.ep !== net.ep) return;
      if (from === other) net.peerOwner = d.o; // 相手がいま誰を担当だと思っているか
      if (!d.p) return;
      const p = { x: d.p[0], y: d.p[1], vx: d.p[2], vy: d.p[3] };
      if (d.o === opts.me && net.owner !== opts.me) { net.owner = opts.me; st.puck = advance(p, lead()); } // 持ち主を渡された
      else if (d.o === from && net.owner !== opts.me) { net.owner = from; st.puck = advance(p, lead()); }
      if (Array.isArray(d.sc) && opts.me < 0) st.score = d.sc.slice();
    }
  }

  function applyGoal(d) {
    net.ep = d.ep;
    st.score = d.sc.slice();
    st.puck = servePuck(d.serve);
    net.owner = d.serve;
    if (st.score.some((x) => x >= target)) {
      st.over = { winner: st.score[0] >= target ? 0 : 1 };
      st.banner = st.over.winner === opts.me ? 'あなたの勝ち！' : opts.me < 0 ? `${st.over.winner === 0 ? '赤' : '青'}の勝ち` : 'あなたの負け';
      play(endSound(st.over, opts.me));
      showOver();
    } else {
      play('goal');
      st.banner = 'ゴール！';
      st.pause = GOAL_PAUSE;
    }
    showStatus();
  }

  function onlineTick(dt, now) {
    if (opts.me >= 0) {
      if (!net.started && now - net.lastHi > 500) { net.lastHi = now; opts.send({ k: 'hi' }); }
      // 遅れを測る合図の時刻は performance.now()（描き替えの時刻 now は古いことがあり、遅れが大きく出る）
      if (now - net.lastPing > 1000) { net.lastPing = now; opts.send({ k: 'ping', t: performance.now() }); }
      if (net.started && now - net.lastHeard > 3000 && !net.quietShown) { net.quietShown = true; showStatus(); }
      if (now - net.lastHeard < 3000) net.quietShown = false;
    }
    if (st.pause > 0) { st.pause -= dt; if (st.pause <= 0 && !st.over) st.banner = ''; }
    const mine = opts.me;
    const n = Math.ceil(dt / STEP);
    const ev = { hit: 0, wall: 0 }; // 相手の陣地ではマレットの当たりを計算しないので、相手が打った音は鳴らない（壁の音だけ）
    for (let i = 0; i < n; i++) {
      const h = dt / n;
      if (mine >= 0) moveMallet(st.mallets[mine], mine, targets[mine], MALLET_V, h);
      for (const p of [0, 1]) if (p !== mine) moveMallet(st.mallets[p], p, targets[p], MALLET_V * 2, h); // 相手のマレットは届いた位置へなめらかに
      if (!net.started || st.over || st.pause > 0) continue;
      if (net.owner === mine) {
        const g = stepPuck(st.puck, [st.mallets[mine]], h, ev);
        if (g !== null) { // 自分の陣地のゴールに入った（＝決められた）
          const sc = st.score.slice();
          sc[g]++;
          const d = { k: 'goal', ep: net.ep + 1, sc, serve: mine };
          opts.send(d, true);
          applyGoal(d);
          break;
        }
        const crossed = mine === 0 ? st.puck.y < H / 2 : st.puck.y > H / 2;
        if (crossed) { net.owner = other; sendState(now, true); }
      } else if (stepPuck(st.puck, [], h, ev) !== null) {
        st.puck.vx = 0; st.puck.vy = 0; // 相手の陣地のゴールの判定は相手に任せる
      }
    }
    bumpSound(ev);
    if (mine >= 0 && now - net.lastSend > SEND_MS) sendState(now, false);
  }

  function sendState(now, handoff) {
    net.lastSend = now;
    const m = st.mallets[opts.me];
    const d = { k: 's', ep: net.ep, o: net.owner, m: [r4(m.x), r4(m.y)], sc: st.score };
    // パックの位置を付けるのは、自分が担当のとき・担当を渡したのに相手がまだ受け取っていないとき
    // （渡す知らせが1通落ちても、次の送信で渡し直せるように）
    if (net.owner === opts.me || handoff || net.peerOwner !== net.owner) {
      d.p = [r4(st.puck.x), r4(st.puck.y), r4(st.puck.vx), r4(st.puck.vy)];
    }
    opts.send(d, handoff);
  }

  /* ---------- まわす ---------- */

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    if (opts.mode === 'online') onlineTick(dt, now);
    else localTick(dt);
  }
  function frame(now) {
    if (!alive) return;
    tick(now);
    drawTable(ctx, view, st, { rotateTop: opts.mode === 'two' });
    raf = requestAnimationFrame(frame);
  }
  // 画面が隠れて描き替えが止まっても（ほかのアプリへ切り替えたときなど）、オンラインでは位置のやり取りを続ける
  const backup = setInterval(() => {
    const now = performance.now();
    if (alive && opts.mode === 'online' && now - last > 120) tick(now);
  }, 50);

  resize();
  if (opts.mode === 'online') {
    target = Number(opts.rules?.points) || 7;
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
  desc: 'マレットでパックを打ち合う。CPU と、または同じ画面で2人で。オンラインは試作',
  ready: true,
  live: true,
  players: ['赤', '青'],
  settings: [
    { key: 'points', label: '何点先取', desc: 'オンラインで対戦するときの点数', def: 7, choices: POINTS.map((p) => [p, `${p}点`]) },
  ],
  mount,
};
