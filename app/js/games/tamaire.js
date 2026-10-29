// 玉入れ（運動会の玉入れ風）。赤と白の2チーム対抗（2026-10-05 本人承認）。パチンコ（ゴムひもで玉を引いて飛ばす道具）で、自分のチームのカゴへ玉を飛ばす。
// 2026-10-26 本人の依頼で、はじく操作からパチンコに替えた: 画面のどこかを押してそのまま引き、離すと引いたのと逆の向きへ飛ぶ。
//   引いた長さ（SLING_PULL まで）が強さ。押した所の横の位置にパチンコを置く（押した位置からの動きで引くので、どこを押してもよい）。
//   遊んでいる間も画面をスクロールできるように、ページ全体は止めず、絵（canvas）の上だけ指の動きを取る（前は .ac-live でページごと止めていた）。
// 制限時間（詳細設定）が来たら、入った数の多いチームの勝ち。個人の入れた数も出す。
// チームは席の番号で決める（偶数の席が赤、奇数の席が白。席順は main.js が毎回まぜる）。人数は待合室で偶数にそろえる（evenTeams）。
// 玉の動きは各自の端末だけで計算し、入った数（合計）を 0.6秒ごとにまとめて手として送る（1個ずつ送ると手の一覧が長くなりすぎるため）。
// 同じチームの人が投げた玉は見た目だけ、送りっぱなしで届けて画面に出す（o.stream / onStream）。数には入らない。
// 詳細設定「カゴ」を「左右に動く」にすると、カゴが真ん中から幅の2割ずつ左右へ、約6秒で1往復する（2026-10-06 本人の決定）。
// 位置は「始まりの合図からの秒数」だけで決めるので、どの端末でもほぼ同じ所にある。CPU は入る見込みを3割から2割に下げる。
// 詳細設定「ラスト10秒は2点」をありにすると、残り10秒からは入った玉1つが2点（2026-10-07 本人承認）。
// 残り10秒を過ぎたかは、玉が入った端末の時計（始まりの合図が届いてからの秒数。CPU はホストの端末）で、入った瞬間に決める。
// そのうち何個が2点かを手の b（その人のこれまでの合計）に入れて送るので、手が届くのが遅れて境目をまたいでも点は変わらない。
// 点数は 入った数 ＋ 2点の玉の数。なしのときは b を送らず、前と全く同じ。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'in', n: その人がこれまでに入れた合計, b: そのうち2点の玉の合計（ラスト10秒は2点のときだけ） }
//     （n が前より大きいときだけ受け付ける。b は減らず、増えた分は n の増えた分まで）

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
export const HAND_Y = H - 0.30; // パチンコの位置（玉が飛び出す高さ）。下に引く分の場所を空けてある
const SLING_PULL = 0.2; // 引ける長さ（盤の横幅に対して）。いっぱいに引くと MAX_V の速さ
const SLING_MIN = 0.025; // これより短いと飛ばさない（押しただけ）
const RELOAD_MS = 280;
const MAX_V = 2.3; // 2026-10-30 本人の依頼で 3.4 から下げた（いっぱいに引くと盤の上の外まで飛んでいた。いまはまっすぐ上でもカゴの少し上まで）
export const TEAM = ['赤', '白'];
const TEAM_COLOR = ['#e04b3c', '#f4f4f4'];
const teamOf = (p) => p % 2;
const SWING = 0.2; // 動くカゴの、真ん中から左右へのふれ幅
const PERIOD = 6; // 1往復の秒数
// カゴの真ん中の横の位置（sec = 始まりからの秒数）
export const rimX = (moving, sec) => (moving ? RIM.x + SWING * Math.sin((2 * Math.PI * Math.max(0, sec)) / PERIOD) : RIM.x);
export const LAST_SEC = 10; // ラスト何秒から2点か

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

// パチンコで引いた分の速さ（盤の横幅 / 秒）から、投げる玉の速さを決める
export function launch(vx, vy) {
  const sp = Math.hypot(vx, vy);
  const k = sp > MAX_V ? MAX_V / sp : 1;
  return { vx: vx * k * 0.9, vy: vy * k * 0.9 };
}

const durOf = (s) => Number(s.rules.time);
const goKey = (s) => `tamaire:${s.seed}:go`;
const movingOf = (s) => s.rules.move === 'move';
const lastOf = (s) => s.rules.last === 'on';
// いま入った玉が2点か（sec = 始まりからの秒数。時間が来たあとに入った玉も2点）
export const isDouble = (s, sec) => lastOf(s) && sec >= durOf(s) - LAST_SEC;
// いまのカゴの位置（始まる前は真ん中、終わったら止める）
const rimNow = (s) => rimX(movingOf(s), s.phase === 'ready' ? 0 : Math.min(since(goKey(s)) / 1000, durOf(s)));
const clone = (s) => ({ ...s, cnt: s.cnt.slice(), bon: s.bon.slice() });
// 各人の点（入った数 ＋ 2点の玉の数）
export const pointsOf = (s) => s.cnt.map((v, p) => v + s.bon[p]);
const teamSum = (arr) => [0, 1].map((t) => arr.reduce((a, v, p) => a + (teamOf(p) === t ? v : 0), 0));
export const teamScores = (s) => teamSum(pointsOf(s));

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
  const balls = Math.min(30, teamSum(s.cnt)[team]);
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
  // ラスト10秒（ありのとき）: 飛んでいる玉の後ろに、目立つ帯を出す
  const sec = s.phase === 'play' ? since(goKey(s)) / 1000 : -1;
  const hot = s.phase === 'play' && isDouble(s, sec) && sec < durOf(s);
  if (hot) {
    const fs = Math.max(14, k * 0.05);
    ctx.font = `bold ${fs}px sans-serif`;
    const label = '⚡ ラスト10秒！ 1つ2点';
    const w = Math.min(k * 0.94, ctx.measureText(label).width + fs * 1.4);
    const y = k * 0.17; const h = fs * 1.7;
    // 少しだけ明滅させて気づかせる（動きを減らす設定の端末では明滅させない）
    if (!ui.calm) ctx.globalAlpha = 0.8 + 0.2 * Math.sin(performance.now() / 160);
    ctx.fillStyle = '#ffd43b';
    ctx.strokeStyle = '#d9480f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect((k - w) / 2, y, w, h, h / 2);
    else ctx.rect((k - w) / 2, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a2e00';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, k / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
  }
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
  // パチンコ（Y の形の枠とゴムひも）と、手もとの玉（引いているときは引いた所）
  if (ui.me !== null && s.phase !== 'end') {
    const ax = ui.handX;
    const fork = 0.045;
    ctx.strokeStyle = '#6b4a2b';
    ctx.lineWidth = Math.max(3, k * 0.014);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax * k, (HAND_Y + 0.17) * k);
    ctx.lineTo(ax * k, (HAND_Y + 0.07) * k);
    ctx.lineTo((ax - fork) * k, HAND_Y * k);
    ctx.moveTo(ax * k, (HAND_Y + 0.07) * k);
    ctx.lineTo((ax + fork) * k, HAND_Y * k);
    ctx.stroke();
    const ready = s.phase === 'play' && performance.now() - ui.lastThrow > RELOAD_MS;
    const pull = ui.aim ?? { x: 0, y: 0 };
    const bx = ax + pull.x; const by = HAND_Y + pull.y;
    ctx.strokeStyle = '#3b2a1a';
    ctx.lineWidth = Math.max(1.5, k * 0.006);
    ctx.beginPath();
    ctx.moveTo((ax - fork) * k, HAND_Y * k);
    ctx.lineTo(bx * k, by * k);
    ctx.lineTo((ax + fork) * k, HAND_Y * k);
    ctx.stroke();
    ctx.lineCap = 'butt';
    if (ready) {
      ctx.beginPath();
      ctx.arc(bx * k, by * k, BALL_R * k, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLOR[team];
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // 「+1」（2点の玉は「+2」）
  const now = performance.now();
  ui.pops = ui.pops.filter((q) => now - q.at < 700);
  ctx.textAlign = 'center';
  for (const q of ui.pops) {
    ctx.font = `bold ${k * (q.two ? 0.065 : 0.05)}px sans-serif`;
    ctx.fillStyle = q.two ? '#d9480f' : '#c0392b';
    ctx.fillText(q.two ? '+2' : '+1', q.x * k, (RIM.y - 0.04 - (now - q.at) / 7000) * k);
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
    if (hot) { ctx.font = `bold ${Math.max(13, k * 0.045)}px sans-serif`; ctx.fillStyle = '#d9480f'; }
  }
  if (text) ctx.fillText(text, k / 2, k * 0.14);
  if (ui.me !== null && s.phase !== 'end') {
    ctx.font = `${Math.max(11, k * 0.035)}px sans-serif`;
    ctx.fillStyle = '#5a4a30';
    const got = Math.max(ui.count, s.cnt[ui.me]);
    const pts = lastOf(s) ? `（${Math.max(ui.count + ui.bonus, s.cnt[ui.me] + s.bon[ui.me])}点）` : '';
    ctx.fillText(`あなたは${TEAM[team]}チーム・${got}個${pts}`, k / 2, (H - 0.012) * k);
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
        if (!b.ghost) {
          // 2点かどうかは、この端末で入った瞬間の時刻で決めて手に入れる（届くのが遅れても変わらない）
          const two = isDouble(s, since(goKey(s)) / 1000);
          ui.count += 1;
          if (two) ui.bonus += 1;
          ui.pops.push({ at: now, x: rx, two });
        }
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
      o.onMove(lastOf(s) ? { t: 'in', n: ui.count, b: ui.bonus } : { t: 'in', n: ui.count });
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
  desc: '赤と白のチームに分かれて、パチンコで玉をカゴへ。たくさん入れたチームの勝ち',
  ready: true,
  multi: true,
  realtime: true,
  evenTeams: true,
  minPlayers: 2,
  // 自己ベスト（ランキング）: 自分が入れた点（チームの点ではない）
  record: { label: '入れた点', of: (s, p) => pointsOf(s)[p], fmt: (v) => `${v}点`, keys: ['time', 'move', 'last'], gc: ['time'] },
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: '1回の勝負の長さ', def: '60', choices: [['30', '30秒'], ['60', '60秒'], ['90', '90秒']] },
    { key: 'move', label: 'カゴ', desc: '左右に動く: カゴがゆっくり左右に行ったり来たりする。入れにくくなる', def: 'stay', choices: [['stay', '止まっている'], ['move', '左右に動く']] },
    { key: 'last', label: 'ラスト10秒は2点', desc: '残り10秒になると、入った玉が2点になる', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '60', move: 'stay', last: 'off', ...rules };
    return { n, seed, rules: r, phase: 'ready', cnt: Array(n).fill(0), bon: Array(n).fill(0), step: 0 };
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
    if (sc[0] === sc[1]) return { draw: true, winner: null, team: null, teams: sc, scores: pointsOf(s) };
    const t = sc[0] > sc[1] ? 0 : 1;
    const winners = s.cnt.map((_, p) => (teamOf(p) === t ? p : -1)).filter((p) => p >= 0);
    return { winners, team: t, teams: sc, scores: pointsOf(s) };
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
    // 2点の玉の合計（ありのときだけ。無ければ増えていないと見る）。減らない・増えた分は入った玉の増えた分まで
    const b = lastOf(s0) ? (m.b ?? s0.bon[m.p]) : s0.bon[m.p];
    if (!Number.isInteger(b) || b < s0.bon[m.p] || b - s0.bon[m.p] > m.n - s0.cnt[m.p]) return null;
    const s = clone(s0);
    s.step += 1;
    s.cnt[m.p] = m.n;
    s.bon[m.p] = b;
    return s;
  },

  // CPU: 0.5〜0.9秒に1回投げ、3割ほど（カゴが動くときは2割）入る（入ったときだけ手になる）
  // ラスト10秒は2点のときは、ホストの端末の時計で2点かを決めて b に入れる（入る見込みは変えない）
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    const sec = since(goKey(s)) / 1000;
    if (s.phase !== 'play' || sec >= durOf(s)) return null;
    const key = `${s.seed}:${p}`;
    const now = performance.now();
    if (!cpuNext.has(key)) cpuNext.set(key, now + 500 + Math.random() * 400);
    if (now < cpuNext.get(key)) return null;
    cpuNext.set(key, now + 500 + Math.random() * 400);
    if (cpuNext.size > 40) cpuNext.delete(cpuNext.keys().next().value);
    if (Math.random() >= (movingOf(s) ? 0.2 : 0.3)) return null;
    return lastOf(s) ? { t: 'in', n: s.cnt[p] + 1, b: s.bon[p] + (isDouble(s, sec) ? 1 : 0) } : { t: 'in', n: s.cnt[p] + 1 };
  },

  onStream(d, from) {
    if (!ui || ui.me === null || !Array.isArray(d?.b) || from < 0 || from === ui.me || teamOf(from) !== ui.team) return;
    const [x, y, vx, vy] = d.b.map(Number);
    if (![x, y, vx, vy].every(Number.isFinite) || ui.balls.length > 60) return;
    ui.balls.push({ x: clamp(x, 0, 1), y: clamp(y, 0, H), vx: clamp(vx, -4, 4), vy: clamp(vy, -4, 4), ghost: true });
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const chips = scoreChips(o, pointsOf(s), {
      extra: (p) => `<span style="color:${teamOf(p) ? '#777' : 'var(--red-ink, #c0392b)'}">${TEAM[teamOf(p)]}</span>`,
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
    note.textContent = 'パチンコです。絵のどこかを押したまま、飛ばしたい向きと逆へ引いて離すと玉が飛びます（長く引くほど強い）。'
      + (lastOf(s) ? `残り${LAST_SEC}秒からは1つ2点！` : '');
    wrap.append(canvas);
    root.append(chips, wrap, note);
    if (s.phase !== 'end') window.scrollTo(0, 0);
    since(`tamaire:${s.seed}:ready`);
    if (s.phase !== 'ready') since(goKey(s));
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, wrap, me, cur: { s, o }, scale: 300,
      team: me === null ? 0 : teamOf(me), balls: [], pops: [], count: me === null ? 0 : s.cnt[me], bonus: me === null ? 0 : s.bon[me], sent: 0,
      lastSend: 0, lastThrow: 0, last: performance.now(), handX: 0.5,
      calm: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    };
    resize();
    let drag = null;
    // 押した所からの指の動き（盤の座標）を、引いた長さ SLING_PULL までに縮めたもの
    const pullOf = (b) => {
      const dx = b.x - drag.x; const dy = b.y - drag.y;
      const d = Math.hypot(dx, dy);
      const k = d > SLING_PULL ? SLING_PULL / d : 1;
      return { x: dx * k, y: dy * k, d: Math.min(d, SLING_PULL) };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (drag) return;
      const b = toBoard(canvas, e);
      drag = { id: e.pointerId, x: b.x, y: b.y };
      ui.handX = clamp(b.x, 0.08, 0.92);
      ui.aim = { x: 0, y: 0 };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId) return;
      ui.aim = pullOf(toBoard(canvas, e));
      e.preventDefault();
    });
    const up = (e) => {
      if (drag?.id !== e.pointerId) return;
      const pull = pullOf(toBoard(canvas, e));
      drag = null;
      ui.aim = null;
      const { s: cur, o: co } = ui.cur;
      const now = performance.now();
      if (ui.me === null || cur.phase !== 'play' || !co.canMove || since(goKey(cur)) / 1000 >= durOf(cur) || now - ui.lastThrow < RELOAD_MS) return;
      if (pull.d < SLING_MIN || pull.y <= 0) return; // ほとんど引いていない・上へ引いた（下へは飛ばさない）
      const v = launch(-pull.x / SLING_PULL * MAX_V / 0.9, -pull.y / SLING_PULL * MAX_V / 0.9);
      ui.lastThrow = now;
      const ball = { x: ui.handX, y: HAND_Y, vx: v.vx, vy: v.vy };
      ui.balls.push(ball);
      co.stream({ b: [+ball.x.toFixed(3), +ball.y.toFixed(3), +ball.vx.toFixed(3), +ball.vy.toFixed(3)] });
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { drag = null; ui.aim = null; });
    loop(ui);
  },
};
