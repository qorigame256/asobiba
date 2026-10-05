// 2色爆弾サバイバル（本人の案。2026-10-05）。自分の盤の入り口から赤と青の爆弾が歩きながら出てくる。
// 枠は各色に「5」と「10」が1つずつ、合計4つ。爆弾を指でつまんで同じ色の枠へ入れ、5の枠に5個（10の枠に10個）入れたら、
// その数の爆弾が、生き残りの中からランダムに選んだ相手の盤へ飛んでいく。
// 爆弾は出てから FUSE 秒で爆発する（最後の2.5秒は点滅）。入れずに爆発させる・違う色の枠に入れるとライフが1減り、3回で脱落。最後まで残った人の勝ち。
// 出てくる間は時間とともに短くなる（だんだん忙しくなる）。
//
// 自分の盤の爆弾の動きは自分の端末だけで計算する（ほかの人の盤は見えない）。手の一覧に入るのは「爆発した」「送った」だけ。
// 送る相手は手の一覧の中身から決める（全員同じ相手になる）。届いた分は、その人の端末が入り口から出す（受け取った合計 inc と、
// 出し終えた数を比べる。開き直したときは、それまでに届いた分は出さない）。
//
// 進行: ready →(3秒)→ go → play → 生き残りが1人以下で end
// 手: { p: -1, t: 'go' } / { p, t: 'boom', n: その人の何回目の爆発か } / { p, t: 'send', n: 何回目の送りか, k: 5 | 10 }

import { mulberry32 } from './util.js';
import { since, scoreChips } from './party.js';
import { fitCanvas, toBoard, clamp } from './action.js';

const READY_MS = 3000;
export const LIVES = 3;
export const FUSE = 9; // 秒
const BLINK = 2.5;
export const H = 1.25;
const R = 0.035; // 爆弾の半径
const COLOR = ['#e74c3c', '#3b7ddd'];
const COLOR_NAME = ['赤', '青'];
const FIELD = { x0: 0.26, x1: 0.74, y0: 0.2, y1: H - 0.04 };
const DOOR = { x: 0.5, y: 0.13 };
// 枠: 左が赤、右が青。上が 5、下が 10
const BOXES = [
  { c: 0, cap: 5, x0: 0.02, x1: 0.23, y0: 0.2, y1: 0.58 },
  { c: 0, cap: 10, x0: 0.02, x1: 0.23, y0: 0.63, y1: H - 0.04 },
  { c: 1, cap: 5, x0: 0.77, x1: 0.98, y0: 0.2, y1: 0.58 },
  { c: 1, cap: 10, x0: 0.77, x1: 0.98, y0: 0.63, y1: H - 0.04 },
];
// 何秒ごとに1個出るか（始まりからの秒数 t）
export const spawnGap = (t) => Math.max(0.55, 1.5 - t * 0.006);

const goKey = (s) => `bombs:${s.seed}:go`;
const clone = (s) => ({ ...s, boom: s.boom.slice(), sent: s.sent.slice(), inc: s.inc.slice(), out: s.out.slice(), log: s.log.slice() });
export const aliveOf = (s) => s.out.map((v, p) => (v === null ? p : -1)).filter((p) => p >= 0);

// 送る相手: 送った人以外の生き残りから、種と手の数で決める（全員の端末で同じになる）
export function targetOf(s, from) {
  const cand = aliveOf(s).filter((p) => p !== from);
  if (!cand.length) return -1;
  const rng = mulberry32((s.seed ^ Math.imul(s.step + 1, 0x9e3779b1)) >>> 0);
  return cand[Math.floor(rng() * cand.length)];
}

/* ---------- 画面 ---------- */

let ui = null;

function boxAt(x, y) {
  return BOXES.findIndex((b) => x >= b.x0 - 0.02 && x <= b.x1 + 0.02 && y >= b.y0 - 0.02 && y <= b.y1 + 0.02);
}

function spawn(sec, incoming) {
  const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
  const sp = 0.08 + Math.random() * 0.05;
  ui.bombs.push({ c: Math.random() < 0.5 ? 0 : 1, x: DOOR.x, y: FIELD.y0 + R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: sec, turn: sec + 1 + Math.random(), inc: incoming });
}

function boom(x, y, sec) {
  ui.fx.push({ x, y, at: performance.now() });
  const { s, o } = ui.cur;
  if (ui.me === null || s.out[ui.me] !== null || ui.lost >= LIVES) return;
  ui.lost += 1;
  o.onMove({ t: 'boom', n: ui.lost });
  void sec;
}

function step() {
  const { s, o } = ui.cur;
  const now = performance.now();
  const dt = Math.min(0.05, (now - ui.last) / 1000);
  ui.last = now;
  if (s.phase !== 'play' || ui.me === null || s.out[ui.me] !== null || !o.canMove) return;
  const sec = since(goKey(s)) / 1000;
  // ふつうに出てくる分
  while (ui.nextSpawn <= sec) { spawn(ui.nextSpawn, false); ui.nextSpawn += spawnGap(ui.nextSpawn); }
  // 相手から届いた分（0.15秒おきに1個）
  if (ui.consumed < s.inc[ui.me] && sec >= ui.nextInc) {
    ui.consumed += 1;
    ui.nextInc = sec + 0.15;
    spawn(sec, true);
  }
  for (const b of ui.bombs) {
    if (b === ui.held) continue;
    if (sec > b.turn) { // ときどき向きを変える
      const a = Math.random() * Math.PI * 2;
      const sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
      b.turn = sec + 1 + Math.random();
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < FIELD.x0 + R) { b.x = FIELD.x0 + R; b.vx = Math.abs(b.vx); }
    if (b.x > FIELD.x1 - R) { b.x = FIELD.x1 - R; b.vx = -Math.abs(b.vx); }
    if (b.y < FIELD.y0 + R) { b.y = FIELD.y0 + R; b.vy = Math.abs(b.vy); }
    if (b.y > FIELD.y1 - R) { b.y = FIELD.y1 - R; b.vy = -Math.abs(b.vy); }
  }
  // 時間切れで爆発
  ui.bombs = ui.bombs.filter((b) => {
    if (sec - b.born < FUSE) return true;
    if (b === ui.held) ui.held = null;
    boom(b.x, b.y, sec);
    return false;
  });
}

function drop(b) {
  const { s, o } = ui.cur;
  const sec = since(goKey(s)) / 1000;
  const i = boxAt(b.x, b.y);
  if (i < 0) { // 枠の外: 歩く場所へ戻す
    b.x = clamp(b.x, FIELD.x0 + R, FIELD.x1 - R);
    b.y = clamp(b.y, FIELD.y0 + R, FIELD.y1 - R);
    return;
  }
  ui.bombs = ui.bombs.filter((q) => q !== b);
  const box = BOXES[i];
  if (box.c !== b.c) { boom(b.x, b.y, sec); return; } // 違う色の枠
  ui.counts[i] += 1;
  if (ui.counts[i] >= box.cap) {
    ui.counts[i] = 0;
    ui.sends += 1;
    ui.flash = { text: `${box.cap}個 発射！`, at: performance.now() };
    o.onMove({ t: 'send', n: ui.sends, k: box.cap });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBomb(ctx, k, b, sec, scale = 1) {
  const left = FUSE - (sec - b.born);
  const blink = left < BLINK && Math.floor(left * 6) % 2 === 0;
  ctx.beginPath();
  ctx.arc(b.x * k, b.y * k, R * k * scale, 0, Math.PI * 2);
  ctx.fillStyle = blink ? '#fff' : COLOR[b.c];
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = b.inc ? '#ffd400' : '#222';
  ctx.stroke();
  // 導火線と残り秒
  ctx.strokeStyle = '#555';
  ctx.beginPath();
  ctx.moveTo(b.x * k, (b.y - R * scale) * k);
  ctx.lineTo((b.x + R * 0.5) * k, (b.y - R * 1.5 * scale) * k);
  ctx.stroke();
  ctx.fillStyle = blink ? COLOR[b.c] : '#fff';
  ctx.font = `bold ${R * k * 0.95 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(0, Math.ceil(left))), b.x * k, b.y * k + 1);
  ctx.textBaseline = 'alphabetic';
}

function draw() {
  const { s } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  const sec = s.phase === 'play' ? since(goKey(s)) / 1000 : 0;
  ctx.fillStyle = '#2b2f3a';
  ctx.fillRect(0, 0, k, k * H);
  // 歩く場所と入り口
  ctx.fillStyle = '#3c4252';
  ctx.fillRect(FIELD.x0 * k, FIELD.y0 * k, (FIELD.x1 - FIELD.x0) * k, (FIELD.y1 - FIELD.y0) * k);
  ctx.fillStyle = '#111';
  roundRect(ctx, (DOOR.x - 0.07) * k, (FIELD.y0 - 0.05) * k, 0.14 * k, 0.06 * k, 6);
  ctx.fill();
  // 枠
  BOXES.forEach((b, i) => {
    roundRect(ctx, b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k, 10);
    ctx.fillStyle = b.c === 0 ? 'rgba(231,76,60,.18)' : 'rgba(59,125,221,.18)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR[b.c];
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = `bold ${k * 0.07}px sans-serif`;
    const cx = ((b.x0 + b.x1) / 2) * k;
    ctx.fillText(String(b.cap), cx, (b.y0 + 0.09) * k);
    ctx.font = `${k * 0.04}px sans-serif`;
    ctx.fillText(`${ui.counts[i]}/${b.cap}`, cx, (b.y0 + 0.15) * k);
    // 入った数を小さな玉で
    for (let j = 0; j < ui.counts[i]; j++) {
      ctx.beginPath();
      ctx.arc(cx + ((j % 2) - 0.5) * 0.07 * k, (b.y0 + 0.2 + Math.floor(j / 2) * 0.06) * k, 0.022 * k, 0, Math.PI * 2);
      ctx.fillStyle = COLOR[b.c];
      ctx.fill();
    }
  });
  for (const b of ui.bombs) if (b !== ui.held) drawBomb(ctx, k, b, sec);
  if (ui.held) drawBomb(ctx, k, ui.held, sec, 1.25);
  // 爆発
  const now = performance.now();
  ui.fx = ui.fx.filter((f) => now - f.at < 500);
  for (const f of ui.fx) {
    ctx.beginPath();
    ctx.arc(f.x * k, f.y * k, (0.04 + (now - f.at) / 4000) * k, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,170,40,${1 - (now - f.at) / 500})`;
    ctx.fill();
  }
  // 上の文字: ライフと知らせ
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(13, k * 0.05)}px sans-serif`;
  if (ui.me !== null) {
    const life = Math.max(0, LIVES - s.boom[ui.me]);
    ctx.fillText(s.out[ui.me] !== null ? '脱落… ほかの人を待っています' : `ライフ ${'❤'.repeat(life)}${'♡'.repeat(LIVES - life)}`, k / 2, k * 0.06);
  } else ctx.fillText('観戦中', k / 2, k * 0.06);
  if (ui.flash && now - ui.flash.at < 1600) {
    ctx.font = `bold ${k * 0.055}px sans-serif`;
    ctx.fillStyle = '#ffd400';
    ctx.fillText(ui.flash.text, k / 2, k * 0.12);
  }
  if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`bombs:${s.seed}:ready`)) / 1000);
    ctx.font = `bold ${k * 0.18}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(left > 0 ? String(left) : 'スタート！', k / 2, k * H * 0.55);
  } else if (s.phase === 'end') {
    ctx.font = `bold ${k * 0.1}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText('おしまい！', k / 2, k * H * 0.55);
  }
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize(); // 画面の幅が変わった（向きを変えたときなど、知らせを取りこぼしても合わせ直す）
  step();
  draw();
  requestAnimationFrame(() => loop(token));
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 24 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

/* ---------- CPU（ホストの端末だけ） ---------- */
// 盤の上の爆弾を「出た時刻の列」で持ち、1.0〜1.4秒に1個ずつ古い順に片付ける。2.5% は違う色の枠へ入れてしまう。
// 片付けが追いつかずに FUSE 秒たった爆弾は爆発する（だんだん忙しくなり、送られるとあふれる）。
const sims = new Map();
export function cpuAdvance(c, upto, incTotal, rnd) {
  while (c.t < upto) {
    const t = Math.min(upto, c.t + 0.1);
    while (c.nextSpawn <= t) { c.q.push(c.nextSpawn); c.nextSpawn += spawnGap(c.nextSpawn); }
    while (c.consumed < incTotal) { c.consumed += 1; c.q.push(t); }
    c.q.sort((a, b) => a - b);
    while (c.q.length && t - c.q[0] >= FUSE) { c.q.shift(); c.events.push('boom'); }
    if (t >= c.handleAt && c.q.length) {
      c.q.shift();
      c.handleAt = t + 1.0 + rnd() * 0.4;
      if (rnd() < 0.025) c.events.push('boom');
      else {
        const col = rnd() < 0.5 ? 0 : 1;
        const i = c.box[col][0] > 0 || rnd() < 0.5 ? 0 : 1; // 入れ始めた枠を先にうめる
        const cap = i === 0 ? 5 : 10;
        c.box[col][i] += 1;
        if (c.box[col][i] >= cap) { c.box[col][i] = 0; c.events.push(cap); }
      }
    } else if (!c.q.length) c.handleAt = Math.max(c.handleAt, t);
    c.t = t;
  }
}

export default {
  id: 'bombs',
  name: '2色爆弾サバイバル',
  icon: '💣',
  desc: '赤と青の爆弾を同じ色の枠へ。いっぱいにすると相手へ送れる。3回爆発させたら脱落',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, phase: 'ready', boom: Array(n).fill(0), sent: Array(n).fill(0), inc: Array(n).fill(0), out: Array(n).fill(null), outN: 0, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && s.out[p] === null; },
  sound(a, b, m, me) {
    if (m.p === -1) return 'question';
    if (m.t === 'boom') return m.p === me ? 'wrong' : null;
    if (m.t === 'send') return m.p === me || b.log.at(-1)?.to === me ? 'punch' : null;
    return null;
  },
  result(s) {
    if (s.phase !== 'end') return null;
    // 順位: 生き残り → あとで脱落した人ほど上
    const ranking = Array.from({ length: s.n }, (_, p) => p).sort((p, q) => (s.out[q] ?? 99) - (s.out[p] ?? 99));
    const winners = aliveOf(s);
    return { winners: winners.length ? winners : [ranking[0]], ranking };
  },
  resultText(res, me, pn) {
    const w = res.winners[0];
    return w === me ? 'あなたの勝ち！🎉' : `${pn(w)}の勝ち！`;
  },
  phaseText(s, me, pn) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    const last = s.log.at(-1);
    if (last && last.to === me) return `${pn(last.from)}から ${last.k}個 飛んできた！`;
    if (last) return `${pn(last.from)} → ${pn(last.to)} に ${last.k}個`;
    return '同じ色の枠へ入れよう！';
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t !== 'go' || s0.phase !== 'ready') return null;
      const s = clone(s0);
      s.step += 1;
      s.phase = 'play';
      return s;
    }
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.out[m.p] !== null) return null;
    if (m.t === 'boom') {
      if (m.n !== s0.boom[m.p] + 1) return null;
      const s = clone(s0);
      s.step += 1;
      s.boom[m.p] = m.n;
      if (m.n >= LIVES) {
        s.out[m.p] = s.outN;
        s.outN += 1;
        if (aliveOf(s).length <= 1) s.phase = 'end';
      }
      return s;
    }
    if (m.t === 'send') {
      if (m.n !== s0.sent[m.p] + 1 || (m.k !== 5 && m.k !== 10)) return null;
      const to = targetOf(s0, m.p);
      const s = clone(s0);
      s.step += 1;
      s.sent[m.p] = m.n;
      if (to >= 0) {
        s.inc[to] += m.k;
        s.log = [...s.log.slice(-4), { from: m.p, to, k: m.k }];
      }
      return s;
    }
    return null;
  },

  cpuDelay(s) { return s.phase === 'play' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.out[p] !== null) return null;
    const key = `${s.seed}:${p}`;
    const now = since(goKey(s)) / 1000;
    let c = sims.get(key);
    if (!c) {
      c = { t: now, nextSpawn: now, q: [], consumed: s.inc[p], handleAt: now + 1, box: [[0, 0], [0, 0]], events: [] };
      sims.set(key, c);
      if (sims.size > 40) sims.delete(sims.keys().next().value);
    }
    cpuAdvance(c, now, s.inc[p], Math.random);
    const e = c.events.shift();
    if (e === undefined) return null;
    if (e === 'boom') return { t: 'boom', n: s.boom[p] + 1 };
    return { t: 'send', n: s.sent[p] + 1, k: e };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const chips = scoreChips(o, s.boom.map(() => 0), {
      extra: (p) => (s.out[p] !== null ? '脱落' : `${'❤'.repeat(LIVES - s.boom[p])}`),
    });
    chips.querySelectorAll('.pt-score').forEach((e) => e.remove());
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.canvas)) {
      const last = s.log.at(-1);
      const sends = s.sent.reduce((x, y) => x + y, 0); // 描き直しのたびに局面は作り直されるので、送りの合計で新しい知らせか見分ける
      if (last && sends !== ui.cur.s.sent.reduce((x, y) => x + y, 0) && last.to === me) ui.flash = { text: `${o.names[last.from]}から ${last.k}個！`, at: performance.now() };
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      ui.wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null && s.out[me] === null);
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
    note.textContent = '爆弾を指（マウス）でつまんで、同じ色の枠へ運びます。黄色いふちの爆弾は、ほかの人から送られてきたものです。';
    wrap.append(canvas);
    root.append(chips, wrap, note);
    if (s.phase !== 'end') window.scrollTo(0, 0);
    since(`bombs:${s.seed}:ready`);
    if (s.phase !== 'ready') since(goKey(s));
    const sec = s.phase === 'play' ? since(goKey(s)) / 1000 : 0;
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, wrap, me, cur: { s, o }, scale: 300,
      bombs: [], held: null, fx: [], counts: [0, 0, 0, 0], flash: null, last: performance.now(),
      // 開き直したときは、それまでの爆発・送り・届いた分を引き継ぐ（同じ番号の手を送らないように）
      lost: me === null ? 0 : s.boom[me], sends: me === null ? 0 : s.sent[me], consumed: me === null ? 0 : s.inc[me],
      nextSpawn: sec, nextInc: 0,
    };
    wrap.classList.toggle('ac-live', s.phase === 'play' && me !== null && s.out[me] === null);
    resize();
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
      const { s: cur } = ui.cur;
      if (ui.me === null || cur.phase !== 'play' || cur.out[ui.me] !== null) return;
      const p = toBoard(canvas, e);
      let best = null; let bd = 0.075;
      for (const b of ui.bombs) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } }
      e.preventDefault();
      if (!best) return;
      ui.held = best;
      drag = { id: e.pointerId, dx: best.x - p.x, dy: best.y - p.y };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* 指がもう離れていたとき */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag?.id !== e.pointerId || !ui.held) return;
      const p = toBoard(canvas, e);
      ui.held.x = clamp(p.x + drag.dx, 0, 1);
      ui.held.y = clamp(p.y + drag.dy, 0, H);
      e.preventDefault();
    });
    const up = (e) => {
      if (drag?.id !== e.pointerId) return;
      drag = null;
      const b = ui.held;
      ui.held = null;
      if (b && ui.bombs.includes(b)) drop(b);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    loop(ui);
  },
};
