// 切り紙あて。折った紙のどこを切ったかが見えるので、開いたときの模様を4つから当てる早押し。2〜10人・足りない分は CPU（弱め）。
// 2026-11-10 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   - 詳細設定「難しさ」で折る回数を選ぶ: やさしい（1回）・ふつう（2回。最初）・むずかしい（3回）。問題はその場で作る（何度遊んでも同じ問題が出にくい）。
//   - 10問（詳細設定「問題の数」で 5・10・20問）。正解した速い順に 3・2・1点。まちがえたらその問題はもう答えられない（点は減らない）。
// Claude の判断:
//   - 紙は 1×1 の正方形（y は下向き）。1回は右半分へ（たての折り目）、2回は右下の4分の1へ、3回はさらに4分の1を対角線で折った三角へ折る。
//     開いた模様は、切り口をそれぞれの折り目で写したもの（1回は2つ、2回は4つ、3回は8つ）。
//   - 切り口は 丸・三角・ひし形・四角・星・ハート・月（三日月） のどれか（7つから同じ見込みで選ぶ。星・ハート・月は 2026-11-10 の38回目の案で足した）。やさしいは2つ、ふつう・むずかしいは3つ（3つ目を置ける所が見つからなければ2つ。6000問に4問ほど）。1つは必ず折り目の上に置く（開くと1つの大きな形になる、切り紙の見どころ）。
//     折った紙からはみ出た分は切れない（折った紙の形で切り取る）。
//   - まちがいの3つは、次の作り方の候補から、正解とも互いとも見た目がはっきり違う（48×48 の点で数えて12点以上違う）ものを種で選ぶ:
//     写す代わりに回す・写す折り目を減らす・切り口を折った紙の中で裏返してから開く・切り口を1つずらす・切り口を1つ消す。
//   - 制限時間は やさしい10秒・ふつう12秒・むずかしい15秒。全員が答えたら0.8秒で締め切る。答えを見せる間は2.5秒（正解の紙が開く動きを出す）。
//   - 紙の色は問題ごとに 朱・藍・若草・山吹・桜 から種で選ぶ。
//   - CPU の正解の見込みは やさしい8割・ふつう68%・むずかしい55%。2.5〜6秒（むずかしいは＋1秒）で答える。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ札の番号（0〜3）, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r?.rounds)) ? Number(r.rounds) : 10);
const LEVELS = [['easy', 'やさしい（1回折る）'], ['normal', 'ふつう（2回折る）'], ['hard', 'むずかしい（3回折る）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r?.level) ? r.level : 'normal');
export const FOLDS = { easy: 1, normal: 2, hard: 3 };
export const limitOf = (r) => ({ easy: 10000, normal: 12000, hard: 15000 }[levelOf(r)]);
const READY_MS = 3000;
const SHOWN_MS = 2500;
const GRACE_MS = 800;
const COLORS = ['#d9473a', '#2f5d9e', '#5a9e4b', '#e0a526', '#e58fa6'];

/* ---------- 紙と切り口の形 ---------- */

// 折った紙の形（全体の紙の上の多角形。時計回り）と、折り目の辺（点線で描く）
export const REGION = {
  1: [[0.5, 0], [1, 0], [1, 1], [0.5, 1]],
  2: [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]],
  3: [[0.5, 0.5], [1, 0.5], [1, 1]],
};
const FOLD_EDGES = { 1: [[[0.5, 0], [0.5, 1]]], 2: [[[0.5, 0.5], [0.5, 1]], [[0.5, 0.5], [1, 0.5]]], 3: [[[0.5, 0.5], [1, 0.5]], [[0.5, 0.5], [1, 1]]] };
const mx = ([x, y]) => [1 - x, y];
const my = ([x, y]) => [x, 1 - y];
const sw = ([x, y]) => [y, x];
const rot = ([x, y]) => [1 - y, x]; // 真ん中を中心に90度
const id = (p) => p;
const comp = (...fs) => (p) => fs.reduceRight((q, f) => f(q), p);
// 開いたときに切り口が写る先（折る回数ごと）
export const GROUP = {
  1: [id, mx],
  2: [id, mx, my, comp(mx, my)],
  3: [id, mx, my, comp(mx, my), sw, comp(mx, sw), comp(my, sw), comp(mx, my, sw)],
};
const R2 = comp(rot, rot);
const R3 = comp(rot, rot, rot);
// まちがい用の「写す代わりに回す」
const ROT_GROUP = { 1: [id, R2], 2: [id, rot, R2, R3], 3: [id, rot, R2, R3] };
// まちがい用の「写す折り目を減らす」
const HALF_GROUP = { 1: [id], 2: [id, mx], 3: [id, mx, my, comp(mx, my)] };
// まちがい用の「折った紙の中で裏返す」（その折り方では写る先にならない裏返し）
const FLIP_IN = { 1: ([x, y]) => [1.5 - x, y], 2: sw, 3: ([x, y]) => [1.5 - y, 1.5 - x] };

const r3 = (v) => Math.round(v * 1000) / 1000;
const mapPoly = (f, poly) => poly.map((p) => f(p).map(r3));

// 凸の多角形 clip で poly を切り取る（Sutherland–Hodgman）
function clipPoly(poly, clip) {
  let out = poly;
  const cx = clip.reduce((a, p) => a + p[0], 0) / clip.length;
  const cy = clip.reduce((a, p) => a + p[1], 0) / clip.length;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const sgn = Math.sign(side([cx, cy]));
    const inside = (p) => side(p) * sgn >= -1e-9;
    const src = out;
    out = [];
    for (let j = 0; j < src.length; j++) {
      const p = src[j], q = src[(j + 1) % src.length];
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) {
        const sp = side(p), sq = side(q);
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? out.map((p) => p.map(r3)) : null;
}

export const CUT_KINDS = ['circle', 'tri', 'diamond', 'square', 'star', 'heart', 'moon'];
// 中心 (0,0)・大きさ s で作った点を、ang だけ回して (cx, cy) へ動かす
const place = (pts, cx, cy, ang) => pts.map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]);

export function shapePoly(kind, cx, cy, s, ang) {
  if (kind === 'star') {
    return place(Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const rr = i % 2 ? s * 0.45 : s * 1.1;
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    }), cx, cy, ang);
  }
  if (kind === 'heart') {
    // よく知られたハートの式（幅 32・高さ 29 ほど）を、幅 2.1s に縮める
    const k = (s * 2.1) / 32;
    return place(Array.from({ length: 28 }, (_, i) => {
      const t = (i / 28) * Math.PI * 2;
      return [16 * Math.sin(t) ** 3 * k, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) + 2.5) * k]; // + 2.5 は上下の真ん中を中心にそろえる分

    }), cx, cy, ang);
  }
  if (kind === 'moon') {
    // 半径 s の円から、右へ 0.6s ずらした同じ大きさの円を除いた三日月
    const d = s * 0.6, al = Math.atan2(Math.sqrt(s * s - (d * d) / 4), d / 2);
    const outer = Array.from({ length: 19 }, (_, i) => {
      const a = al + (i / 18) * (Math.PI * 2 - 2 * al);
      return [Math.cos(a) * s, Math.sin(a) * s];
    });
    const inner = Array.from({ length: 9 }, (_, i) => {
      const a = Math.PI + al - ((i + 1) / 10) * 2 * al;
      return [d + Math.cos(a) * s, Math.sin(a) * s];
    });
    return place([...outer, ...inner].map(([x, y]) => [x + s * 0.35, y]), cx, cy, ang); // + 0.35s で囲む四角の真ん中を中心に
  }
  const k = kind === 'circle' ? 24 : kind === 'tri' ? 3 : 4;
  const a0 = kind === 'square' ? ang + Math.PI / 4 : ang;
  return Array.from({ length: k }, (_, i) => {
    const a = a0 + (i / k) * Math.PI * 2;
    const rr = kind === 'diamond' ? (i % 2 ? s * 0.6 : s) : s;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
}

// 折った紙の上の切り口（全体の紙の座標）
function makeCuts(folds, count, rnd) {
  const reg = REGION[folds];
  const kinds = CUT_KINDS;
  const cuts = [];
  const centers = [];
  for (let tries = 0; cuts.length < count && tries < 200; tries++) {
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const s = 0.07 + rnd() * 0.05;
    let cx, cy;
    const mode = cuts.length === 0 ? 'fold' : rnd() < 0.3 ? 'edge' : 'inner';
    if (mode === 'fold') {
      const [[ax, ay], [bx, by]] = FOLD_EDGES[folds][Math.floor(rnd() * FOLD_EDGES[folds].length)];
      const t = 0.2 + rnd() * 0.6;
      cx = ax + (bx - ax) * t; cy = ay + (by - ay) * t;
    } else if (mode === 'edge') {
      if (folds === 1) { cx = 0.6 + rnd() * 0.3; cy = rnd() < 0.5 ? 0 : 1; if (rnd() < 0.4) { cx = 1; cy = 0.15 + rnd() * 0.7; } }
      else { cx = 1; cy = (folds === 3 ? 0.62 : 0.6) + rnd() * 0.3; if (folds === 2 && rnd() < 0.5) [cx, cy] = [cy, cx]; }
    } else {
      cx = 0.5 + rnd() * 0.5; cy = (folds === 1 ? 0 : 0.5) + rnd() * (folds === 1 ? 1 : 0.5);
    }
    const poly = clipPoly(shapePoly(kind, cx, cy, s, rnd() * Math.PI * 2), reg);
    if (!poly || polyArea(poly) < 0.0025) continue;
    if (centers.some(([x, y, t]) => Math.hypot(x - cx, y - cy) < (t + s) * 1.15)) continue;
    centers.push([cx, cy, s]);
    cuts.push(poly);
  }
  return cuts;
}
const polyArea = (poly) => Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

const unfold = (cuts, group) => group.flatMap((f) => cuts.map((c) => mapPoly(f, c)));

function inPoly([x, y], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
// 模様を 48×48 の点で見た「穴かどうか」の並び（見た目が違うかを数えるのに使う）
const GRID = 48;
// 横だけ半分から少しずらした所を見る（折り目の線 x=0.5・y=0.5・x=y・x+y=1 の上にちょうど乗る点を作らないため。乗ると、星・ハート・月を折り目で切ったときに
// 左右・ななめで写した模様の点の数え方が数点ずれた。2026-11-10）
const SX = 0.513;
export function raster(polys) {
  const out = new Uint8Array(GRID * GRID);
  for (const poly of polys) { // 多角形の囲む四角の中の点だけ調べる
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor(Math.min(...xs) * GRID - 0.5)), i1 = Math.min(GRID - 1, Math.ceil(Math.max(...xs) * GRID));
    const j0 = Math.max(0, Math.floor(Math.min(...ys) * GRID - 0.5)), j1 = Math.min(GRID - 1, Math.ceil(Math.max(...ys) * GRID));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!out[j * GRID + i] && inPoly([(i + SX) / GRID, (j + 0.5) / GRID], poly)) out[j * GRID + i] = 1;
    }
  }
  return out;
}
export const diff = (a, b) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
export const MIN_DIFF = 12;

export function makeQuestion(folds, rnd) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const cuts = makeCuts(folds, folds === 1 ? 2 : 3, rnd);
    if (cuts.length < 2) continue;
    const right = unfold(cuts, GROUP[folds]);
    const cands = [
      unfold(cuts, ROT_GROUP[folds]),
      unfold(cuts, HALF_GROUP[folds]),
      unfold(cuts.map((c) => clipPoly(mapPoly(FLIP_IN[folds], c), REGION[folds])).filter(Boolean), GROUP[folds]),
      ...cuts.map((_, k) => unfold(cuts.filter((__, j) => j !== k), GROUP[folds])),
      ...cuts.map((c, k) => {
        const dx = (rnd() < 0.5 ? -1 : 1) * 0.1, dy = (rnd() < 0.5 ? -1 : 1) * 0.1;
        const moved = clipPoly(c.map(([x, y]) => [x + dx, y + dy]), REGION[folds]);
        return moved ? unfold(cuts.map((d, j) => (j === k ? moved : d)), GROUP[folds]) : null;
      }),
    ].filter(Boolean);
    const seen = [raster(right)];
    const wrong = [];
    for (const c of shuffle(cands, rnd)) {
      const r = raster(c);
      if (seen.every((x) => diff(x, r) >= MIN_DIFF)) { seen.push(r); wrong.push(c); }
      if (wrong.length === 3) break;
    }
    if (wrong.length < 3) continue;
    const order = shuffle([0, 1, 2, 3], rnd);
    const all = [right, ...wrong];
    return { folds, cuts, choices: order.map((i) => all[i]), side: order.indexOf(0), color: COLORS[Math.floor(rnd() * COLORS.length)] };
  }
  throw new Error('切り紙あて: 問題を作れなかった');
}

// 局面は手が届くたびに最初から当て直すので、同じ問題の組は作り直さずに覚えておく（中身は書き換えない約束）
const made = new Map();
export function makeQuestions(k, seed, folds) {
  const key = `${k}:${seed}:${folds}`;
  if (made.has(key)) return made.get(key);
  const rnd = mulberry32((seed ^ 0x6b43a9b5) >>> 0);
  const qs = Array.from({ length: k }, () => makeQuestion(folds, rnd));
  made.set(key, qs);
  if (made.size > 8) made.delete(made.keys().next().value);
  return qs;
}

/* ---------- 絵 ---------- */

const NS = 'http://www.w3.org/2000/svg';
let maskNo = 0;
const pathOf = (polys) => polys.map((p) => 'M' + p.map(([x, y]) => `${x},${y}`).join('L') + 'Z').join('');
// 紙（area = 紙の形の多角形。無ければ正方形）に穴をあけた絵
function paperSvg(color, holes, area = null, cls = 'kg-paper') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-0.04 -0.04 1.08 1.08');
  svg.setAttribute('class', cls);
  const mid = 'kgm' + ++maskNo;
  svg.innerHTML = `<defs><mask id="${mid}" maskUnits="userSpaceOnUse" x="-1" y="-1" width="3" height="3"><rect x="-1" y="-1" width="3" height="3" fill="#fff"/><path d="${pathOf(holes)}" fill="#000"/></mask></defs>`
    + `<path d="${area ? pathOf([area]) : 'M0,0L1,0L1,1L0,1Z'}" fill="${color}" mask="url(#${mid})" class="kg-sheet"/>`;
  return svg;
}
// 折った紙は、その形のまわりだけを大きく映す（全体の中では小さく、切り口と折り目が見えにくかったため）
const FOLDED_VB = { 1: '0.44 -0.06 0.62 1.12', 2: '0.44 0.44 0.62 0.62', 3: '0.44 0.44 0.62 0.62' };
function foldedSvg(x) {
  const svg = paperSvg(x.color, x.cuts, REGION[x.folds], 'kg-paper kg-folded');
  svg.setAttribute('viewBox', FOLDED_VB[x.folds]);
  for (const [[ax, ay], [bx, by]] of FOLD_EDGES[x.folds]) {
    const l = document.createElementNS(NS, 'line');
    Object.entries({ x1: ax, y1: ay, x2: bx, y2: by, class: 'kg-fold' }).forEach(([k, v]) => l.setAttribute(k, v));
    svg.append(l);
  }
  return svg;
}

const qKey = (s, q = s.q) => `kirigami:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'kirigami',
  name: '切り紙あて',
  icon: '✂️',
  desc: '折った紙の切り口を見て、開いたときの模様を4つから早押しで当てる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '難しさ', desc: '紙を折る回数。多いほど開いた模様が複雑になる', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', rounds: 10, ...rules };
    return {
      n, seed, rules: r, qs: makeQuestions(roundsOf(r), seed, FOLDS[levelOf(r)]), q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null;
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : `第${s.q + 1}問 / ${s.qs.length}`; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s.rules) + 1000, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
        s.miss = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const best = Math.min(...s.solved.filter((v) => v !== null));
        const winners = s.solved.map((v, p) => (v !== null && v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), miss: s.miss.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c > 3 || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0.rules) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.c === s.qs[s.q].side) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const lv = levelOf(s.rules);
      const ok = Math.random() < { easy: 0.8, normal: 0.68, hard: 0.55 }[lv];
      const others = [0, 1, 2, 3].filter((c) => c !== x.side);
      plan = { at: 2500 + Math.random() * 3500 + (lv === 'hard' ? 1000 : 0), c: ok ? x.side : others[Math.floor(Math.random() * 3)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limitOf(s.rules) ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj kg';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const folds = FOLDS[levelOf(s.rules)];
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">紙を${folds}回折って切りました。開くとどんな模様？・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s.rules);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`);
    const show = document.createElement('div');
    show.className = 'kg-show';
    show.append(foldedSvg(x));
    const arrow = document.createElement('div');
    arrow.className = 'kg-arrow';
    arrow.textContent = '➡';
    show.append(arrow);
    if (s.phase === 'shown') {
      // 正解の紙が開く（折った形から全体へ広がる）
      const open = paperSvg(x.color, x.choices[x.side], null, 'kg-paper kg-open');
      const k = since(key + ':open');
      if (k < 150) {
        open.style.clipPath = clipOf(folds);
        requestAnimationFrame(() => requestAnimationFrame(() => { open.style.clipPath = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)'; }));
      }
      show.append(open);
    } else {
      show.insertAdjacentHTML('beforeend', '<div class="kg-qmark">？</div>');
    }
    card.append(show);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, limit)); }
    else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < limit;
    const pad = document.createElement('div');
    pad.className = 'kg-pad';
    x.choices.forEach((polys, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kg-choice' + (s.phase === 'shown' && c === x.side ? ' ans' : '');
      b.setAttribute('aria-label', `${c + 1}番の模様`);
      b.disabled = !can;
      b.append(paperSvg(x.color, polys));
      const hit = (e) => {
        if (!can || b.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= limit) return;
        pad.querySelectorAll('button').forEach((y) => { y.disabled = true; y.dataset.sent = '1'; });
        b.classList.add('picked');
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit;
      b.onclick = (e) => { if (e.detail === 0) hit(e); };
      pad.append(b);
    });
    wrap.append(pad);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = '点線が折り目。開くと折り目で写した形になります';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    list.className = 'kg-review';
    s.log.forEach((x, q) => {
      const qq = s.qs[q];
      const li = document.createElement('li');
      li.append(foldedSvg(qq), Object.assign(document.createElement('span'), { className: 'kg-rv-arrow', textContent: '➡' }), paperSvg(qq.color, qq.choices[qq.side]));
      const info = document.createElement('span');
      info.className = 'mk-rv-who';
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      info.textContent = `${me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])} ` : '❌ '}${fast.length ? '⚡' + fast.join('・') : ''}`;
      li.append(info);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// 開く動きの始めの形（viewBox の余白 0.04 を見込んだ割合）
function clipOf(folds) {
  const pc = (v) => `${(((v + 0.04) / 1.08) * 100).toFixed(1)}%`;
  const pts = REGION[folds].length === 3 ? [...REGION[folds], REGION[folds][2]] : REGION[folds];
  return `polygon(${pts.map(([x, y]) => `${pc(x)} ${pc(y)}`).join(', ')})`;
}
