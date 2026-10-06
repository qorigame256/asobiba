// 玉入れ（運動会の玉入れ風）。赤と白の2チーム対抗（2026-10-05 本人承認）。画面を指（マウス）ではじいて、自分のチームのカゴへ玉を投げる。
// 制限時間（詳細設定）が来たら、入った数の多いチームの勝ち。個人の入れた数も出す。
// チームは席の番号で決める（偶数の席が赤、奇数の席が白。席順は main.js が毎回まぜる）。人数は待合室で偶数にそろえる（evenTeams）。
// 玉の動きは各自の端末だけで計算し、入った数（合計）を 0.6秒ごとにまとめて手として送る（1個ずつ送ると手の一覧が長くなりすぎるため）。
// 同じチームの人が投げた玉は見た目だけ、送りっぱなしで届けて画面に出す（o.stream / onStream）。数には入らない。
// 詳細設定「カゴ」を「左右に動く」にすると、カゴが真ん中から幅の2割ずつ左右へ、約6秒で1往復する（2026-10-06 本人の決定）。
// 位置は「始まりの合図からの秒数」だけで決めるので、どの端末でもほぼ同じ所にある。CPU は入る見込みを3割から2割に下げる。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'in', n: その人がこれまでに入れた合計 }（前より大きいときだけ受け付ける）

import { since, scoreChips } from './party.js';
import { fitCanvas, toBoard, clamp } from './action.js';

const READY_MS = 3000;
const GRACE_MS = 2000;
const SEND_MS = 600;
export const H = 1.3;
export const G = 2.5; // 重力（盤の横幅 / 秒²）
export const BALL_R = 0.022;
export const RIM = { x: 0.5, y: 0.34, half: 0.095, depth: 0.09 }; // カゴの口（真ん中・高さ・半分の幅）と深さ
const GROUND = H - 0.04;
const HAND_Y = H - 0.16;
const RELOAD_MS = 280;
const MAX_V = 3.4;
export const TEAM = ['赤', '白'];
const TEAM_COLOR = ['#e04b3c', '#f4f4f4'];
const teamOf = (p) => p % 2;
const SWING = 0.2; // 動くカゴの、真ん中から左右へのふれ幅
const PERIOD = 6; // 1往復の秒数
// カゴの真ん中の横の位置（sec = 始まりからの秒数）
export const rimX = (moving, sec) => (moving ? RIM.x + SWING * Math.sin((2 * Math.PI * Math.max(0, sec)) / PERIOD) : RIM.x);

// 玉を dt 秒進める。カゴに入ったら 'in'、地面や盤の外へ出たら 'out'、まだ飛んでいれば null。rx はカゴの真ん中の横の位置
export function stepBall(b, dt, rx = RIM.x) {
  const py = b.y;
  b.vy += G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const L = rx - RIM.half;
  const R = rx + RIM.half;
  // 上から口を通ったら入る
  if (py <= RIM.y && b.y > RIM.y && b.vy > 0 && b.x > L + BALL_R * 0.4 && b.x < R - BALL_R * 0.4) return 'in';
  // 口のふち（左右の点）に当たったら跳ね返る
  for (const ex of [L, R]) {
    const dx = b.x - ex; const dy = b.y - RIM.y;
    const d = Math.hypot(dx, dy);
    if (d < BALL_R && d > 1e-6) {
      const nx = dx / d; const ny = dy / d;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
      b.x = ex + nx * BALL_R; b.y = RIM.y + ny * BALL_R;
    }
  }
  // カゴの横・下（網）と柱に当たったら跳ね返る
  const inBody = b.x > L - BALL_R && b.x < R + BALL_R && b.y > RIM.y + 0.005 && b.y < RIM.y + RIM.depth + BALL_R;
  if (inBody && !b.inside) { b.vx = -b.vx * 0.4; b.vy = Math.max(b.vy, 0) * 0.5 + 0.1; b.x += b.x < rx ? -0.01 : 0.01; }
  if (b.y > RIM.y + RIM.depth && Math.abs(b.x - rx) < 0.012 + BALL_R && Math.abs(b.vx) > 0) b.vx = -b.vx * 0.5;
  if (b.y > GROUND || b.x < -0.1 || b.x > 1.1) return 'out';
  return null;
}

// はじいた速さ（盤の横幅 / 秒）から、投げる玉の速さを決める
export function launch(vx, vy) {
  const sp = Math.hypot(vx, vy);
  const k = sp > MAX_V ? MAX_V / sp : 1;
  return { vx: vx * k * 0.9, vy: vy * k * 0.9 };
}

const durOf = (s) => Number(s.rules.time);
const goKey = (s) => `tamaire:${s.seed}:go`;
const movingOf = (s) => s.rules.move === 'move';
// いまのカゴの位置（始まる前は真ん中、終わったら止める）
const rimNow = (s) => rimX(movingOf(s), s.phase === 'ready' ? 0 : Math.min(since(goKey(s)) / 1000, durOf(s)));
const clone = (s) => ({ ...s, cnt: s.cnt.slice() });
export const teamScores = (s) => [0, 1].map((t) => s.cnt.reduce((a, v, p) => a + (teamOf(p) === t ? v : 0), 0));

/* ---------- 画面 ---------- */

let ui = null;

function drawField() {
  const { s, o } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  const team = ui.team;
  const rx = rimNow(s);
  // 空と校庭
  const sky = ctx.createLinearGradient(0, 0, 0, k * H);
  sky.addColorStop(0, '#8fd0ff');
  sky.addColorStop(0.75, '#d9f0ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, k, k * H);
  ctx.fillStyle = '#d8b67a';
  ctx.fillRect(0, (GROUND - 0.02) * k, k, k * H);
  // 柱
  ctx.fillStyle = '#8a6a45';
  ctx.fillRect((rx - 0.008) * k, (RIM.y + RIM.depth) * k, 0.016 * k, (GROUND - RIM.y - RIM.depth) * k);
  // カゴ（入った玉を少し見せる）
  const L = rx - RIM.half;
  const balls = Math.min(30, teamScores(s)[team]);
  for (let i = 0; i < balls; i++) {
    const col = i % 6; const row = Math.floor(i / 6);
    ctx.beginPath();
    ctx.arc((L + 0.022 + col * 0.0265) * k, (RIM.y + RIM.depth - 0.015 - row * 0.016) * k, BALL_R * 0.8 * k, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLOR[team];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.stroke();
  }
  ctx.strokeStyle = team === 0 ? '#b03224' : '#777';
  ctx.lineWidth = Math.max(2, k * 0.008);
  ctx.beginPath();
  ctx.moveTo(L * k, RIM.y * k);
  ctx.lineTo((L + 0.02) * k, (RIM.y + RIM.depth) * k);
  ctx.lineTo((rx + RIM.half - 0.02) * k, (RIM.y + RIM.depth) * k);
  ctx.lineTo((rx + RIM.half) * k, RIM.y * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(rx * k, RIM.y * k, RIM.half * k, 0.012 * k, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 飛んでいる玉
  for (const b of ui.balls) {
    ctx.beginPath();
    ctx.arc(b.x * k, b.y * k, BALL_R * k, 0, Math.PI * 2);
    ctx.globalAlpha = b.ghost ? 0.55 : 1;
    ctx.fillStyle = TEAM_COLOR[team];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 手もとの玉
  if (ui.me !== null && s.phase === 'play' && performance.now() - ui.lastThrow > RELOAD_MS) {
    ctx.beginPath();
    ctx.arc(ui.handX * k, HAND_Y * k, BALL_R * k, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLOR[team];
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.stroke();
  }
  // 「+1」
  const now = performance.now();
  ui.pops = ui.pops.filter((q) => now - q.at < 700);
  ctx.textAlign = 'center';
  for (const q of ui.pops) {
    ctx.font = `bold ${k * 0.05}px sans-serif`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('+1', q.x * k, (RIM.y - 0.04 - (now - q.at) / 7000) * k);
  }
  // 上の文字: 点数と残り時間
  const sc = teamScores(s);
  ctx.font = `bold ${Math.max(14, k * 0.055)}px sans-serif`;
  ctx.fillStyle = '#c0392b';
  ctx.textAlign = 'right';
  ctx.fillText(`赤 ${sc[0]}`, k * 0.45, k * 0.08);
  ctx.fillStyle = '#555';
  ctx.textAlign = 'left';
  ctx.fillText(`${sc[1]} 白`, k * 0.55, k * 0.08);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#333';
  ctx.fillText('−', k * 0.5, k * 0.08);
  ctx.font = `${Math.max(12, k * 0.04)}px sans-serif`;
  let text = '';
  if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`tamaire:${s.seed}:ready`)) / 1000);
    ctx.font = `bold ${k * 0.18}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(left > 0 ? String(left) : 'スタート！', k / 2, k * H * 0.62);
  } else if (s.phase === 'end') text = 'おしまい！';
  else {
    const t = since(goKey(s)) / 1000;
    text = t < durOf(s) ? `残り ${Math.ceil(durOf(s) - t)}秒` : 'そこまで！';
  }
  if (text) ctx.fillText(text, k / 2, k * 0.14);
  if (ui.me !== null && s.phase !== 'end') {
    ctx.font = `${Math.max(11, k * 0.035)}px sans-serif`;
    ctx.fillStyle = '#5a4a30';
    ctx.fillText(`あなたは${TEAM[team]}チーム・${Math.max(ui.count, s.cnt[ui.me])}個`, k / 2, (H - 0.012) * k);
  }
}

function step() {
  const { s, o } = ui.cur;
  const now = performance.now();
  const dt = Math.min(0.05, (now - ui.last) / 1000);
  ui.last = now;
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const rx = rimNow(s);
  ui.balls = ui.balls.filter((b) => {
    for (let i = 0; i < n; i++) {
      const r = stepBall(b, dt / n, rx);
      if (r === 'in') {
        if (!b.ghost) { ui.count += 1; ui.pops.push({ at: now, x: rx }); }
        return false;
      }
      if (r === 'out') return false;
    }
    return true;
  });
  // 入った合計をまとめて送る。時間が来たらすぐ送る
  if (ui.me !== null && s.phase === 'play' && o.canMove && ui.count > Math.max(s.cnt[ui.me], ui.sent)) {
    const over = since(goKey(s)) / 1000 >= durOf(s);
    if (over || now - ui.lastSend > SEND_MS) {
      ui.lastSend = now;
      ui.sent = ui.count;
      o.onMove({ t: 'in', n: ui.count });
    }
  }
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize(); // 画面の幅が変わった（向きを変えたときなど、知らせを取りこぼしても合わせ直す）
  step();
  drawField();
  requestAnimationFrame(() => loop(token));
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 24 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

const cpuNext = new Map();

export default {
  id: 'tamaire',
  name: '玉入れ',
  icon: '🧺',
  desc: '赤と白のチームに分かれて、画面をはじいて玉をカゴへ。たくさん入れたチームの勝ち',
  ready: true,
  multi: true,
  realtime: true,
  evenTeams: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: '1回の勝負の長さ', def: '60', choices: [['30', '30秒'], ['60', '60秒'], ['90', '90秒']] },
    { key: 'move', label: 'カゴ', desc: '左右に動く: カゴがゆっくり左右に行ったり来たりする。入れにくくなる', def: 'stay', choices: [['stay', '止まっている'], ['move', '左右に動く']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '60', move: 'stay', ...rules };
    return { n, seed, rules: r, phase: 'ready', cnt: Array(n).fill(0), step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'play'; },
  sound(a, b, m, me) {
    if (m.p === -1) return 'question';
    return m.p === me ? 'hit' : null; // ほかの人の玉は鳴らさない（にぎやかすぎるため）
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const sc = teamScores(s);
    if (sc[0] === sc[1]) return { draw: true, winner: null, team: null, teams: sc, scores: s.cnt.slice() };
    const t = sc[0] > sc[1] ? 0 : 1;
    const winners = s.cnt.map((_, p) => (teamOf(p) === t ? p : -1)).filter((p) => p >= 0);
    return { winners, team: t, teams: sc, scores: s.cnt.slice() };
  },
  resultText(res, me) {
    const sc = `（赤 ${res.teams[0]} − ${res.teams[1]} 白）`;
    if (res.team === null) return `引き分け！${sc}`;
    const mine = me >= 0 && teamOf(me) === res.team;
    return `${TEAM[res.team]}チームの勝ち！${mine ? '🎉' : ''}${sc}`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '玉をカゴへ投げ入れよう！'; },

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
    if (s0.phase !== 'play' || m.t !== 'in' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!Number.isInteger(m.n) || m.n <= s0.cnt[m.p] || m.n > s0.cnt[m.p] + 20) return null;
    const s = clone(s0);
    s.step += 1;
    s.cnt[m.p] = m.n;
    return s;
  },

  // CPU: 0.5〜0.9秒に1回投げ、3割ほど（カゴが動くときは2割）入る（入ったときだけ手になる）
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || since(goKey(s)) / 1000 >= durOf(s)) return null;
    const key = `${s.seed}:${p}`;
    const now = performance.now();
    if (!cpuNext.has(key)) cpuNext.set(key, now + 500 + Math.random() * 400);
    if (now < cpuNext.get(key)) return null;
    cpuNext.set(key, now + 500 + Math.random() * 400);
    if (cpuNext.size > 40) cpuNext.delete(cpuNext.keys().next().value);
    return Math.random() < (movingOf(s) ? 0.2 : 0.3) ? { t: 'in', n: s.cnt[p] + 1 } : null;
  },

  onStream(d, from) {
    if (!ui || ui.me === null || !Array.isArray(d?.b) || from < 0 || from === ui.me || teamOf(from) !== ui.team) return;
    const [x, y, vx, vy] = d.b.map(Number);
    if (![x, y, vx, vy].every(Number.isFinite) || ui.balls.length > 60) return;
    ui.balls.push({ x: clamp(x, 0, 1), y: clamp(y, 0, H), vx: clamp(vx, -4, 4), vy: clamp(vy, -4, 4), ghost: true });
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const chips = scoreChips(o, s.cnt, {
      extra: (p) => `<span style="color:${teamOf(p) ? '#777' : '#c0392b'}">${TEAM[teamOf(p)]}</span>`,
    });
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.canvas)) {
      // 同じチームの CPU が入れた玉は、カゴの上から落として見せる
      s.cnt.forEach((v, p) => {
        const before = ui.cur.s.cnt[p];
        if (o.cpu[p] && p !== me && teamOf(p) === ui.team && v > before && ui.balls.length < 60) {
          ui.balls.push({ x: rimNow(s) + (Math.random() - 0.5) * 0.08, y: RIM.y - 0.12, vx: 0, vy: 0.3, ghost: true });
        }
      });
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      ui.wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null);
      if (s.phase !== 'ready') since(goKey(s));
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
    note.textContent = '画面の下の方から、カゴへ向かって指（マウス）をすばやくはじくと玉が飛びます。';
    wrap.append(canvas);
    root.append(chips, wrap, note);
    if (s.phase !== 'end') window.scrollTo(0, 0);
    since(`tamaire:${s.seed}:ready`);
    if (s.phase !== 'ready') since(goKey(s));
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, wrap, me, cur: { s, o }, scale: 300,
      team: me === null ? 0 : teamOf(me), balls: [], pops: [], count: me === null ? 0 : s.cnt[me], sent: 0,
      lastSend: 0, lastThrow: 0, last: performance.now(), handX: 0.5,
    };
    wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null);
    resize();
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const b = toBoard(canvas, e);
      drag = { id: e.pointerId, pts: [{ t: performance.now(), ...b }] };
      ui.handX = clamp(b.x, 0.08, 0.92);
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      const b = toBoard(canvas, e);
      if (drag?.id === e.pointerId) {
        drag.pts.push({ t: performance.now(), ...b });
        if (drag.pts.length > 30) drag.pts.shift();
      } else if (e.pointerType === 'mouse') ui.handX = clamp(b.x, 0.08, 0.92);
      e.preventDefault();
    });
    const up = (e) => {
      if (drag?.id !== e.pointerId) return;
      const pts = drag.pts;
      drag = null;
      const { s: cur, o: co } = ui.cur;
      const now = performance.now();
      if (ui.me === null || cur.phase !== 'play' || !co.canMove || since(goKey(cur)) / 1000 >= durOf(cur) || now - ui.lastThrow < RELOAD_MS) return;
      // 最後の 0.1秒ほどの動きから、はじいた速さを出す
      const lastP = pts[pts.length - 1];
      const first = pts.find((q) => lastP.t - q.t <= 110) ?? pts[0];
      const dt = (lastP.t - first.t) / 1000;
      if (dt < 0.01) return;
      const vx = (lastP.x - first.x) / dt; const vy = (lastP.y - first.y) / dt;
      if (vy > -0.6) return; // 上向きにはじいていない
      const v = launch(vx, vy);
      ui.lastThrow = now;
      const ball = { x: ui.handX, y: HAND_Y, vx: v.vx, vy: v.vy };
      ui.balls.push(ball);
      co.stream({ b: [+ball.x.toFixed(3), +ball.y.toFixed(3), +ball.vx.toFixed(3), +ball.vy.toFixed(3)] });
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { drag = null; });
    loop(ui);
  },
};
