// 打ち上げ花火。いろいろな形の花火の土台から1つ選んで打ち上げ、いちばん高い所で開いた人の勝ち。2〜10人・足りない分は CPU。
// 2026-11-10 本人の決定（Claude が出した12の新しいゲームの案から本人が選び、ルールは本人が書き直した）:
//   - いろいろな形の打ち上げ花火の土台から1つを選ぶ。いちばん高い位置で炸裂した人の勝ち。
//   - 形による強さはなく、どの花火がいちばん高く上がるかはランダム。
//   - 遊び方は「運だけ」（Claude の推奨を本人が承認）: 選んだあとは全員の花火が自動で上がって頂上で開くのを見るだけ（開く時を自分で押す形はとらない）。
// Claude の判断:
//   - 形は8つ（菊・牡丹・柳・土星・ハート・星・蝶・千輪）。同じ形を何人が選んでもよい。花火の色は席の色（だれの花火か分かるように）。
//   - 選ぶ時間は15秒。選ばなかった人の形は種から決める。全員が選んだら0.7秒で打ち上げる。選び直しはできない。
//   - 開く高さは種と何回目かから決める。人数ぶんの高さを 0.40〜0.86（夜空の高さに対する割合）に等しい間をあけて並べ、間の3割まで揺らしてから席に配る
//     （同じ高さにならないので、いちばん高いのは必ず1人）。画面では高さ×380 を「m」で出す（152〜327m）。
//   - 全員同時に上がり、同じ速さで昇って低い花火から順に開く（いちばん高い花火が最後に開くので、最後まで分からない）。
//   - 詳細設定「勝負の回数」（鍵は rounds）: 1回（最初）・3回勝負・5回勝負。何回か勝負では、いちばん高かった回の数（1回1点）の多い人が勝ち。
//     回数なので、おまかせでは抽選しない（main.js の KEEP_KEYS の rounds）。
//   - 1回勝負の結果の順位は高さの順（成績表の「順位で点」に使う）。
//   - CPU は1.2〜3.5秒で形を1つ選ぶ（運だけなので強さは無い）。
//   - 打ち上げは「シュッ」（line）、開くたびに boom を小さめに鳴らす（局面の手の音ではなく、画面の動きに合わせて鳴らす）。
// 進行（ホストが時間を計って p = -1 の手を足す）: pick → launch → fly → done →（shown → next → pick …）→ end
// 手: { p, t: 'pick', r: 何回目, k: 形の番号 } / { p: -1, t: 'launch' | 'done' | 'next' }

import { mulberry32, shuffle } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

export const SHAPES = [
  ['kiku', '菊'], ['botan', '牡丹'], ['yanagi', '柳'], ['dosei', '土星'],
  ['heart', 'ハート'], ['star', '星'], ['chou', '蝶'], ['senrin', '千輪'],
];
const ROUNDS = [[1, '1回'], [3, '3回勝負'], [5, '5回勝負']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r?.rounds)) ? Number(r.rounds) : 1);
export const PICK_MS = 15000;
const ALL_MS = 700;
export const HMIN = 0.40;
export const HMAX = 0.86;
const RISE_MS = 3000; // いちばん高い所（HMAX）まで昇る時間
const BURST_MS = 2600;
export const FLY_MS = RISE_MS + BURST_MS + 700;
const SHOWN_MS = 3500;
export const meters = (h) => Math.round(h * 380);

// 何回目（round）の、席ごとの開く高さ
export function heightsOf(seed, round, n) {
  const rnd = mulberry32((seed ^ Math.imul(round + 11, 0x9e3779b1)) >>> 0);
  const step = n > 1 ? (HMAX - HMIN) / (n - 1) : 0;
  const slots = Array.from({ length: n }, (_, i) => {
    const j = i === 0 ? rnd() * 0.3 : i === n - 1 ? -rnd() * 0.3 : (rnd() - 0.5) * 0.6; // 端は外へはみ出さない
    return +(HMIN + step * (i + j)).toFixed(3);
  });
  return shuffle(slots, rnd);
}
// 選ばなかった人の形
const autoPick = (seed, round, p) => Math.floor(mulberry32((seed ^ Math.imul(round * 16 + p + 3, 0x85ebca6b)) >>> 0)() * SHAPES.length);
const top = (hs) => hs.indexOf(Math.max(...hs));

const clone = (s) => ({ ...s, picks: s.picks.slice(), wins: s.wins.slice() });
const cpuPlan = new Map();

/* ---------- 花火の形（粒の並び） ---------- */

// 粒: 開いた中心からの行き先（cx, cy）＋ d ミリ秒あとに広がる2段目（rx, ry。千輪の小さな花）。w は白の混ぜ具合。大きさの単位は花火の半径
const FORMS = {};
function formOf(kind) {
  if (FORMS[kind]) return FORMS[kind];
  const rnd = mulberry32(0x51ed27 + kind.length * 977 + kind.charCodeAt(0));
  const parts = [];
  const add = (cx, cy, w = rnd() * 0.35, extra = {}) => parts.push({ cx, cy, rx: 0, ry: 0, d: 0, w, ...extra });
  const ring = (k, f) => { for (let i = 0; i < k; i++) { const a = (i / k) * Math.PI * 2; f(a); } };
  let opt = { trail: 1, grav: 0.5, life: 2300, size: 1.6 };
  if (kind === 'kiku') { ring(72, (a) => { const m = 0.93 + rnd() * 0.07; add(Math.cos(a) * m, Math.sin(a) * m); }); ring(36, (a) => add(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.6)); }
  else if (kind === 'botan') { opt = { trail: 0, grav: 0.4, life: 2000, size: 2.6 }; ring(64, (a) => add(Math.cos(a), Math.sin(a))); ring(28, (a) => add(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.7)); }
  else if (kind === 'yanagi') { opt = { trail: 2.4, grav: 1.6, life: 2600, size: 1.4, gold: true }; ring(46, (a) => { const m = 0.75 + rnd() * 0.15; add(Math.cos(a) * m, Math.sin(a) * m * 0.8 - 0.1); }); }
  else if (kind === 'dosei') {
    opt = { trail: 0.6, grav: 0.35, life: 2300, size: 1.8 };
    ring(36, (a) => add(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0.2));
    const tilt = -0.35;
    ring(56, (a) => { const x = Math.cos(a), y = Math.sin(a) * 0.26; add(x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt), 0.75); });
  } else if (kind === 'heart') {
    opt = { trail: 0.4, grav: 0.3, life: 2300, size: 2 };
    ring(64, (a) => { const x = 16 * Math.sin(a) ** 3; const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); add(x / 17, -y / 17 + 0.1); });
  } else if (kind === 'star') {
    opt = { trail: 0.4, grav: 0.3, life: 2300, size: 2 };
    const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 0.42 : 1; return [Math.cos(a) * r, Math.sin(a) * r]; });
    for (let i = 0; i < 10; i++) { const [x1, y1] = pts[i]; const [x2, y2] = pts[(i + 1) % 10]; for (let k = 0; k < 7; k++) add(x1 + ((x2 - x1) * k) / 7, y1 + ((y2 - y1) * k) / 7); }
  } else if (kind === 'chou') {
    opt = { trail: 0.4, grav: 0.3, life: 2300, size: 1.9 };
    ring(80, (a) => { const r = Math.abs(Math.sin(2 * a)); const up = Math.sin(a) < 0; add(Math.cos(a) * r * 1.05, Math.sin(a) * r * (up ? 0.95 : 0.65)); });
    add(0, -0.15, 0.9); add(0, 0, 0.9); add(0, 0.15, 0.9);
  } else { // 千輪: 6つの小さな玉が飛んでから、それぞれ小さな花になる
    opt = { trail: 0.3, grav: 0.4, life: 2500, size: 1.5, multi: true };
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      const cx = k === 6 ? 0 : Math.cos(a) * 0.68, cy = k === 6 ? 0 : Math.sin(a) * 0.68;
      ring(14, (b) => parts.push({ cx: k === 6 ? 0 : cx, cy: k === 6 ? 0 : cy, rx: Math.cos(b) * 0.27, ry: Math.sin(b) * 0.27, d: 380 + k * 40, w: (k % 3) * 0.3 }));
    }
  }
  FORMS[kind] = { parts, ...opt };
  return FORMS[kind];
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const ease = (a, dur) => (a <= 0 ? 0 : 1 - (1 - Math.min(1, a / dur)) ** 3);

// 開いた花火を1つ描く（X, Y は中心、a は開いてからの時間、R は半径）
function drawBurst(g, kind, X, Y, a, R, col) {
  const f = formOf(kind);
  if (a < 0 || a > f.life) return;
  const [r0, g0, b0] = f.gold ? [255, 196, 90] : hexRgb(col);
  const fade = Math.max(0, 1 - (a / f.life) ** 1.7);
  if (a < 260) { // 開いた瞬間の光
    const k = 1 - a / 260;
    const grad = g.createRadialGradient(X, Y, 0, X, Y, R * 0.7);
    grad.addColorStop(0, `rgba(255,250,230,${0.55 * k})`);
    grad.addColorStop(1, 'rgba(255,250,230,0)');
    g.fillStyle = grad;
    g.fillRect(X - R, Y - R, R * 2, R * 2);
  }
  const pos = (p, t) => {
    const e1 = ease(t, 700);
    const e2 = p.d ? ease(t - p.d, 520) : 0;
    const drop = f.grav * (t / 1000) ** 2 * R * 0.35;
    return [X + (p.cx * e1 + p.rx * e2) * R, Y + (p.cy * e1 + p.ry * e2) * R + drop];
  };
  for (const p of f.parts) {
    if (p.d && a < p.d) { // 千輪の玉: まだ開いていない
      if (p.rx !== Math.cos(0) * 0.27 || p.ry !== 0) continue; // 1つの玉に1粒だけ描く
      const [x, y] = pos(p, a);
      g.fillStyle = `rgba(255,235,190,${fade})`;
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
      continue;
    }
    const w = p.w;
    const tw = f.trail && a > f.life * 0.55 ? 0.65 + 0.35 * Math.sin(a / 40 + p.cx * 50) : 1; // 消えぎわにちらちら
    const al = fade * tw;
    const c = `rgba(${Math.round(r0 + (255 - r0) * w)},${Math.round(g0 + (255 - g0) * w)},${Math.round(b0 + (255 - b0) * w)},${al.toFixed(3)})`;
    const [x, y] = pos(p, a);
    if (f.trail) {
      const [px, py] = pos(p, Math.max(0, a - 70 * f.trail));
      g.strokeStyle = c;
      g.lineWidth = f.size * 0.8;
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(x, y);
      g.stroke();
    }
    g.fillStyle = c;
    const sz = f.size * (a < 900 ? 1.2 : 1);
    g.beginPath();
    g.arc(x, y, sz, 0, Math.PI * 2);
    g.fill();
  }
}

// 夜空（星・遠くの山・川）
const STARS = (() => { const r = mulberry32(2026); return Array.from({ length: 70 }, () => [r(), r() * 0.75, 0.4 + r() * 0.6]); })();
function drawSky(g, W, H, t) {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#060a24');
  grad.addColorStop(0.7, '#141c46');
  grad.addColorStop(1, '#25284f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (const [x, y, b] of STARS) {
    g.fillStyle = `rgba(255,255,255,${(b * (0.75 + 0.25 * Math.sin(t / 700 + x * 40))).toFixed(3)})`;
    g.fillRect(x * W, y * H, 1.3, 1.3);
  }
  // 遠くの山
  g.fillStyle = '#0b0f26';
  g.beginPath();
  g.moveTo(0, H * 0.9);
  for (let i = 0; i <= 12; i++) g.lineTo((i / 12) * W, H * (0.86 - 0.04 * Math.sin(i * 1.7) - (i === 4 ? 0.03 : 0)));
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();
  // 川（土台の並ぶ河原の手前）
  g.fillStyle = 'rgba(40,60,120,.55)';
  g.fillRect(0, H * 0.935, W, H * 0.065);
}

const seatX = (i, n, W) => W * (0.08 + (0.84 * (i + 0.5)) / n);
const groundY = (H) => H * 0.93;

// 打ち上げてから t ミリ秒の夜空（launch = { picks, heights }）。sounds は鳴らした音を覚える入れ物（無ければ鳴らさない）
function drawShow(g, W, H, t, launch, n, colors, sounds) {
  const R = Math.min(W, H) * (n > 6 ? 0.17 : 0.21);
  g.globalCompositeOperation = 'lighter';
  launch.heights.forEach((h, i) => {
    const X = seatX(i, n, W);
    const top = groundY(H) - (H * 0.93 - R * 0.4) * h;
    const T = Math.round((RISE_MS * h) / HMAX);
    if (t < T) {
      const u = t / T;
      const y = groundY(H) - (groundY(H) - top) * (1 - (1 - u) ** 2);
      for (let k = 0; k < 8; k++) { // 火の粉の尾
        const yy = y + k * 5;
        g.fillStyle = `rgba(255,${200 - k * 12},${120 - k * 10},${(0.9 - k * 0.11).toFixed(2)})`;
        g.fillRect(X - 1 + Math.sin((t + k * 50) / 30) * 0.8, yy, 2, 2);
      }
      return;
    }
    if (sounds && !sounds.has(i) && t - T < 400) { sounds.add(i); play('boom', 0.35); }
    drawBurst(g, SHAPES[launch.picks[i]][0], X, top, t - T, R, colors[i]);
  });
  g.globalCompositeOperation = 'source-over';
}

function drawTubes(g, W, H, n, colors) {
  for (let i = 0; i < n; i++) {
    const X = seatX(i, n, W);
    g.fillStyle = '#3a2a1c';
    g.fillRect(X - 5, groundY(H) - 10, 10, 12);
    g.fillStyle = colors[i];
    g.fillRect(X - 5, groundY(H) - 12, 10, 3);
  }
}

// 形の見本（選ぶボタンの絵）
function previewCanvas(kind, col) {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  c.width = c.height = Math.round(64 * dpr);
  c.className = 'hb-prev';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#0b1030';
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  drawBurst(g, kind, 32, 30, 760, 24, col);
  return c;
}

export default {
  id: 'hanabi',
  name: '打ち上げ花火',
  icon: '🎆',
  desc: '花火の形を選んで打ち上げる。いちばん高い所で開いた人の勝ち（運だけ）',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '勝負の回数', desc: '何回か勝負は、いちばん高く上がった回の多い人の勝ち', def: 1, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 1, ...rules };
    return { n, seed, rules: r, round: 0, phase: 'pick', picks: Array(n).fill(null), wins: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'pick' && s.picks[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    if (roundsOf(s.rules) === 1) {
      const hs = s.last.heights;
      return { winners: [s.last.winner], place: hs.map((h) => 1 + hs.filter((x) => x > h).length), heights: hs.slice() };
    }
    return { winners: leaders(s.wins), scores: s.wins.slice() };
  },
  resultText(res, me, pn) {
    if (res.heights) {
      const w = res.winners[0];
      return `🎆 ${w === me ? 'あなた' : pn(w)}の花火がいちばん高く上がった！（${meters(res.heights[w])}m）${w === me ? '🎉' : ''}`;
    }
    return winnersText(res.winners, me, pn);
  },
  phaseText(s) {
    const r = roundsOf(s.rules) > 1 ? `${s.round + 1}回目 / ${roundsOf(s.rules)}・` : '';
    if (s.phase === 'pick') return `${r}花火の形を選んでください`;
    if (s.phase === 'fly') return `${r}🎆 打ち上げ！`;
    if (s.phase === 'shown') return `${r}まもなく次の打ち上げ`;
    return '';
  },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    return m.p === me ? 'chip' : null;
  },

  referee(s) {
    if (s.phase === 'pick') {
      if (s.picks.every((v) => v !== null)) return { key: 'all' + s.round, ms: ALL_MS, move: { t: 'launch' } };
      return { key: 'pick' + s.round, ms: PICK_MS + 800, move: { t: 'launch' } };
    }
    if (s.phase === 'fly') return { key: 'fly' + s.round, ms: FLY_MS, move: { t: 'done' } };
    if (s.phase === 'shown') return { key: 'shown' + s.round, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      const s = clone(s0);
      s.step += 1;
      if (m.t === 'launch' && s0.phase === 'pick') {
        s.picks = s.picks.map((k, p) => (k === null ? autoPick(s.seed, s.round, p) : k));
        const heights = heightsOf(s.seed, s.round, s.n);
        const winner = top(heights);
        s.wins[winner] += 1;
        s.last = { picks: s.picks.slice(), heights, winner };
        s.log = [...s0.log, s.last];
        s.phase = 'fly';
        return s;
      }
      if (m.t === 'done' && s0.phase === 'fly') {
        s.phase = s.round + 1 >= roundsOf(s.rules) ? 'end' : 'shown';
        return s;
      }
      if (m.t === 'next' && s0.phase === 'shown') {
        s.round += 1;
        s.phase = 'pick';
        s.picks = Array(s.n).fill(null);
        return s;
      }
      return null;
    }
    if (m.t !== 'pick' || m.r !== s0.round || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p)) return null;
    if (!Number.isInteger(m.k) || m.k < 0 || m.k >= SHAPES.length) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.k;
    return s;
  },

  cpuDelay(s) { return s.phase === 'pick' ? 200 : 600; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const key = `hanabi:${s.seed}:${s.round}`;
    let plan = cpuPlan.get(key + ':' + p);
    if (!plan) {
      plan = { at: 1200 + Math.random() * 2300, k: Math.floor(Math.random() * SHAPES.length) };
      cpuPlan.set(key + ':' + p, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(key) >= plan.at ? { t: 'pick', r: s.round, k: plan.k } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const n = s.n;
    const colors = Array.from({ length: n }, (_, p) => SEAT_COLORS[p % SEAT_COLORS.length]);
    const multi = roundsOf(s.rules) > 1;
    const res = this.result(s);
    const showRank = s.phase === 'shown' || s.phase === 'end';
    const extra = (p) => {
      if (s.phase === 'pick') return s.picks[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (!s.last) return '';
      const name = SHAPES[s.last.picks[p]][1];
      if (!showRank) return `<span class="hb-shape">${name}</span>`;
      return `<span class="${p === s.last.winner ? 'pt-ok' : 'hb-shape'}">${p === s.last.winner ? '👑 ' : ''}${meters(s.last.heights[p])}m</span>`;
    };
    root.innerHTML = '';
    root.className = 'board hb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    root.append(wrap);
    // 打ち上げの間は、その回の勝ちを点に入れずに見せる（局面では打ち上げたときに数えているが、開き終わるまで分からないように）
    const shownWins = s.phase === 'fly' ? s.wins.map((v, p) => (p === s.last.winner ? v - 1 : v)) : s.wins;
    wrap.append(scoreChips(o, shownWins, { won: res ? res.winners : [], extra, steady: true, gain: multi }));

    // 夜空
    const stage = document.createElement('div');
    stage.className = 'hb-stage';
    const cv = document.createElement('canvas');
    stage.append(cv);
    wrap.append(stage);
    const flyKey = `hanabi:fly:${s.seed}:${s.round}`;
    const sounds = s.phase === 'fly' ? (playedOf(flyKey)) : null;
    const loop = () => {
      if (!cv.isConnected && cv.dataset.on) return;
      cv.dataset.on = '1';
      const W = stage.clientWidth || 320;
      const H = Math.round(W * 0.72);
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      drawSky(g, W, H, now);
      if (s.phase === 'fly') {
        const t = since(flyKey);
        if (sounds && !sounds.has('go') && t < 600) { sounds.add('go'); play('line', 0.7); }
        drawShow(g, W, H, t, s.last, n, colors, sounds);
      } else if (s.last && (s.phase === 'shown' || s.phase === 'end')) {
        // 終わったあとは、その回の花火をくり返し咲かせる（終わりはいちばん高い花火で締める並び）
        const per = RISE_MS + BURST_MS;
        drawShow(g, W, H, (since(flyKey + ':again') + RISE_MS * 0.9) % per, s.last, n, colors, null);
      }
      drawTubes(g, W, H, n, colors);
      requestAnimationFrame(loop);
    };
    loop();

    const note = document.createElement('p');
    note.className = 'cc-log';
    if (s.phase === 'pick') {
      const key = `hanabi:${s.seed}:${s.round}`;
      since(key);
      wrap.insertBefore(timeBar(key, PICK_MS), stage);
      const mine = me === null ? null : s.picks[me];
      if (me !== null && mine === null && o.canMove) {
        const grid = document.createElement('div');
        grid.className = 'hb-grid';
        SHAPES.forEach(([kind, label], k) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'hb-pick';
          b.append(previewCanvas(kind, colors[me]), Object.assign(document.createElement('span'), { textContent: label }));
          b.onclick = () => {
            if (b.dataset.sent) return;
            grid.querySelectorAll('button').forEach((x) => { x.disabled = true; x.dataset.sent = '1'; });
            b.classList.add('picked');
            o.onMove({ t: 'pick', r: s.round, k });
          };
          grid.append(b);
        });
        wrap.append(grid);
        note.textContent = '花火の形を1つ選ぼう（形で強さは変わりません。どれが高く上がるかは運）';
      } else if (me !== null && mine !== null) note.textContent = `「${SHAPES[mine][1]}」を選びました。みんなを待っています…`;
      else note.textContent = me === null ? '観戦中' : '';
    } else if (s.phase === 'fly') note.textContent = '🎆 打ち上げ！ いちばん高い所で開くのはだれの花火？';
    else if (s.last) {
      const w = s.last.winner;
      note.textContent = `👑 いちばん高かったのは ${w === me ? 'あなた' : o.names[w]} の「${SHAPES[s.last.picks[w]][1]}」（${meters(s.last.heights[w])}m）`;
    }
    wrap.append(note);
  },
};

// 打ち上げごとに鳴らした音を覚える（描き直しで同じ音を2回鳴らさない）
const played = new Map();
function playedOf(key) {
  if (!played.has(key)) { played.set(key, new Set()); if (played.size > 20) played.delete(played.keys().next().value); }
  return played.get(key);
}
