// かたち描き。お手本の形（丸・三角・四角・星・ハート）を指かマウスで一筆で描き、お手本に近いほど上。2〜10人・足りない分は CPU（弱め）。
// 2026-11-13 本人の決定（Claude が出した12の新しいゲームの案「まんまる描き」から本人が選び、「丸だけではなく、指定の形を何種類か出す」と直した。分かれ目は Claude の推奨を本人が承認）:
//   - 形は 丸・三角・四角・星・ハート の5つ。お手本を横に出し、描いた線がお手本にどれだけ近いかで点を付ける。大きさと位置は問わない。
// Claude の判断:
//   - 5回。5つの形を1回ずつ、順番は種からくじで決める。1回12秒。指を離したら描き終わり（小さすぎる線は描き直せる）。指を置いたまま時間切れになったら、そこまでの線を送る。
//   - 似ている度（0〜100%）: 描いた線とお手本を、それぞれの外枠の大きさ（縦横の長い方）で同じ大きさにそろえ、真ん中を合わせて比べる。
//     縦横の比はそろえない（四角を横長に描くと下がる）。向きもそろえない（お手本の向きで描く）。描き始めの場所と向きは問わない。
//     ずれ d = （描いた線の各点からお手本までの近さの平均 ＋ お手本の各点から描いた線までの近さの平均）÷ 2（外枠の大きさを1として）。
//     似ている度 = 100 ÷ (1 + (d ÷ 0.06)²) を四捨五入（d = 0.03 で 80%・0.06 で 50%）。閉じずに途中でやめると、お手本からの近さの方で下がる。
//   - 毎回、似ている度の高い順に 3・2・1点（同じ%は同じ点。描かなかった人は0点）。5回の合計で勝負（ぴったりストップと同じ）。
//   - ほかの人の絵は、その回の結果まで見せない（札に ✔ だけ）。結果では全員の絵と%を並べる。
//   - 似ている度は全員の端末で同じ数になるよう、手には整数の点だけを入れ、計算は四則と平方根だけで行う（三角関数を使うお手本は読み込み時に整数へ丸める）。
//   - CPU は お手本の形に大きさ・場所・線のゆれ・縦横のゆがみをばらばらに付けて描く（ゆれは外枠の大きさの 5〜14%、横は 0.82〜1.18倍。
//     似ている度はおよそ 25〜90%、真ん中は 40〜80%。2026-11-13 に300枚ずつ描かせて測った）。
// 詳細設定（2026-11-13 の41回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - 形（shapes）: 5つ（最初。前と全く同じ）・9つ（月・しずく・矢印・十字を足す）。9つでは毎回くじで、回数が形の数より多くなるまで同じ形は2回出さない。
//   - 描く時間（time）: 5秒・12秒（最初）・20秒。CPU は時間のおよそ 25〜67% で描き終える（12秒で前と同じ 3〜8秒）。
//   - 回数（rounds）: 3回・5回（最初）・10回。形の数より多いときは、全部の形を1巡してから、もう1巡くじで並べる（巡の切れ目で同じ形が続かないようにする）。
//   最初の値のときの形の順は前と全く同じ（同じ乱数の使い方。tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員描いた / 12秒）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'draw', q: 何回目, pts: [x0, y0, x1, y1, …]（0〜PAD の整数。4〜MAX_PTS 点） }

import { mulberry32, shuffle } from './util.js';
import { since, leaders, winnersText, scoreChips, SEAT_COLORS } from './party.js';

export const PAD = 200; // 描く場の大きさ（手の座標の範囲）
const MAX_PTS = 240;
const READY_MS = 3000;
const SHOWN_MS = 6000;
const GRACE_MS = 1500;
const MIN_SIZE = 30; // これより小さい線は描き直し
const N = 96; // 比べるときの点の数

// 前の5つ（並びを変えないこと。最初の値の形の順はこの並びのくじで決まる）と、詳細設定「形」の9つで足す4つ
export const SHAPES = [
  { id: 'circle', name: '丸' },
  { id: 'triangle', name: '三角' },
  { id: 'square', name: '四角' },
  { id: 'star', name: '星' },
  { id: 'heart', name: 'ハート' },
  { id: 'moon', name: '月', more: true },
  { id: 'drop', name: 'しずく', more: true },
  { id: 'arrow', name: '矢印', more: true },
  { id: 'cross', name: '十字', more: true },
];
const SHAPE_CHOICES = [['basic', '5つ（丸・三角・四角・星・ハート）'], ['more', '9つ（月・しずく・矢印・十字も）']];
const TIME_CHOICES = [[5, '5秒'], [12, '12秒'], [20, '20秒']];
const ROUND_CHOICES = [[3, '3回'], [5, '5回'], [10, '10回']];
export const limitOf = (rules = {}) => (TIME_CHOICES.some(([v]) => v === rules.time) ? rules.time : 12) * 1000;
// 1回の対局の形の順（最初の値なら前と同じ: 5つを1回くじで並べる）
export function orderOf(seed, rules = {}) {
  const rnd = mulberry32(seed);
  const pool = SHAPES.filter((x) => rules.shapes === 'more' || !x.more).map((x) => x.id);
  const n = ROUND_CHOICES.some(([v]) => v === rules.rounds) ? rules.rounds : 5;
  const order = [];
  while (order.length < n) {
    const batch = shuffle(pool, rnd);
    if (order.length && batch[0] === order.at(-1)) [batch[0], batch[1]] = [batch[1], batch[0]];
    order.push(...batch);
  }
  return order.slice(0, n);
}

// 折れ線を、線の長さにそって等しい間を空けた n 点にする（closed なら最後の点から最初の点へも結ぶ）
export function resample(pts, n, closed) {
  const P = closed ? [...pts, pts[0]] : pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < P.length; i++) {
    const d = Math.sqrt((P[i][0] - P[i - 1][0]) ** 2 + (P[i][1] - P[i - 1][1]) ** 2);
    seg.push(d);
    total += d;
  }
  if (!(total > 0)) return Array.from({ length: n }, () => [P[0][0], P[0][1]]);
  const out = [];
  const step = total / (closed ? n : n - 1);
  let i = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const want = k * step;
    while (i < seg.length - 1 && acc + seg[i] < want) { acc += seg[i]; i += 1; }
    const f = seg[i] > 0 ? Math.min(1, Math.max(0, (want - acc) / seg[i])) : 0;
    out.push([P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f]);
  }
  return out;
}

// 外枠の大きさ（縦横の長い方）を1、真ん中を0にそろえる
function normalize(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const sz = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return pts.map(([x, y]) => [(x - cx) / sz, (y - cy) / sz]);
}
export function sizeOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// お手本の外形（-1000〜1000 の整数。y は下向き）。三角関数の端数は読み込み時に丸めて、どの端末でも同じ点にする
const R = 1000;
const round = (pts) => pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
function outline(id) {
  if (id === 'circle') return round(Array.from({ length: 72 }, (_, i) => [R * Math.cos((i / 72) * 2 * Math.PI), R * Math.sin((i / 72) * 2 * Math.PI)]));
  if (id === 'triangle') return round([[0, -R], [R * 0.95, R * 0.65], [-R * 0.95, R * 0.65]]);
  if (id === 'square') return [[-R, -R], [R, -R], [R, R], [-R, R]];
  if (id === 'moon') {
    // 三日月（右が欠ける）: 外の円（半径 R）の左側の弧と、中心を右へ 0.6R ずらした円の弧（2つの円の交点は (0.5R, ±0.866R)）
    const r2 = Math.sqrt(0.76) * R;
    const b = Math.atan2(0.866, -0.1); // 内の円の中心から見た交点の向き
    const outer = Array.from({ length: 41 }, (_, i) => { const a = Math.PI / 3 + (i / 40) * ((4 * Math.PI) / 3); return [R * Math.cos(a), R * Math.sin(a)]; });
    const inner = Array.from({ length: 27 }, (_, i) => { const a = 2 * Math.PI - b - ((i + 1) / 28) * (2 * Math.PI - 2 * b); return [0.6 * R + r2 * Math.cos(a), r2 * Math.sin(a)]; });
    return round([...outer, ...inner]);
  }
  if (id === 'drop') {
    // しずく（上がとがる）: x = sin t · sin(t/2)、y = −cos t
    return round(Array.from({ length: 72 }, (_, i) => { const t = (i / 72) * 2 * Math.PI; return [R * Math.sin(t) * Math.sin(t / 2), -R * Math.cos(t)]; }));
  }
  if (id === 'arrow') return round([[-R, -R * 0.3], [R * 0.1, -R * 0.3], [R * 0.1, -R * 0.75], [R, 0], [R * 0.1, R * 0.75], [R * 0.1, R * 0.3], [-R, R * 0.3]]);
  if (id === 'cross') {
    const w = R * 0.34;
    return round([[-w, -R], [w, -R], [w, -w], [R, -w], [R, w], [w, w], [w, R], [-w, R], [-w, w], [-R, w], [-R, -w], [-w, -w]]);
  }
  if (id === 'star') {
    return round(Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.4 : R;
      return [r * Math.cos(a), r * Math.sin(a)];
    }));
  }
  // ハート: よく使う式（x = 16 sin³t、y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t）を上下逆さにして使う
  return round(Array.from({ length: 80 }, (_, i) => {
    const t = (i / 80) * 2 * Math.PI;
    return [(R / 17) * 16 * Math.sin(t) ** 3, -(R / 17) * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))];
  }));
}
export const OUTLINES = Object.fromEntries(SHAPES.map((x) => [x.id, outline(x.id)]));
const TEMPLATES = Object.fromEntries(SHAPES.map((x) => [x.id, normalize(resample(OUTLINES[x.id], N, true))]));

const meanNear = (A, B) => {
  let sum = 0;
  for (const [ax, ay] of A) {
    let best = Infinity;
    for (const [bx, by] of B) {
      const d = (ax - bx) ** 2 + (ay - by) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / A.length;
};

// 描いた点（[x0, y0, …]）とお手本の似ている度（0〜100）。小さすぎる・点が少なすぎるときは 0
export function likeness(flat, shape) {
  if (!Array.isArray(flat) || flat.length < 8) return 0;
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const { w, h } = sizeOf(pts);
  if (Math.max(w, h) < MIN_SIZE) return 0;
  const A = normalize(resample(pts, N, false));
  const T = TEMPLATES[shape];
  const d = (meanNear(A, T) + meanNear(T, A)) / 2;
  const r = d / 0.06;
  return Math.round(100 / (1 + r * r));
}

// 似ている度の高い順の点（1位3点・2位2点・3位1点。同じ%は同じ順位。描かなかった人は0点）
export function pointsOf(likes) {
  return likes.map((v) => (v === null || v <= 0 ? 0 : Math.max(0, 3 - likes.filter((e) => e !== null && e > v).length)));
}

const qKey = (s, q = s.q) => `katachi:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), draws: s.draws.slice(), likes: s.likes.slice() });
const cpuPlan = new Map();
let ui = null; // { mount, chips }

// CPU の絵: お手本を大きさ・場所をばらばらにし、線をゆらして、ばらばらの所から描き始める
export function cpuDraw(shape) {
  const base = resample(OUTLINES[shape], 70, true);
  const size = 110 + Math.random() * 60;
  const cx = PAD / 2 + (Math.random() - 0.5) * (PAD - size - 20);
  const cy = PAD / 2 + (Math.random() - 0.5) * (PAD - size - 20);
  const amp = 0.05 + Math.random() * 0.09;
  const sx = 0.82 + Math.random() * 0.36; // 縦横のゆがみ
  const ph = [Math.random() * 6.3, Math.random() * 6.3];
  const start = Math.floor(Math.random() * base.length);
  const out = [];
  for (let k = 0; k <= base.length; k++) {
    const i = (start + k) % base.length;
    const [x, y] = base[i];
    const t = (k / base.length) * 2 * Math.PI;
    const wob = amp * (Math.sin(3 * t + ph[0]) + 0.6 * Math.sin(7 * t + ph[1]));
    const fx = (x / (2 * R)) * sx * (1 + wob) + (Math.random() - 0.5) * amp * 0.4;
    const fy = (y / (2 * R)) * (1 + wob) + (Math.random() - 0.5) * amp * 0.4;
    out.push(Math.max(0, Math.min(PAD, Math.round(cx + fx * size))), Math.max(0, Math.min(PAD, Math.round(cy + fy * size))));
  }
  return out;
}

// 点の並び → SVG の線
const pathOf = (flat, close = false) => {
  let d = '';
  for (let i = 0; i + 1 < flat.length; i += 2) d += `${i ? 'L' : 'M'}${flat[i]} ${flat[i + 1]}`;
  return d + (close ? 'Z' : '');
};
// お手本を描いた線の外枠に合わせた形（結果で重ねて見せる。比べたときと同じそろえ方）
function fittedOutline(flat, shape) {
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  const b = sizeOf(pts);
  const sz = Math.max(b.w, b.h);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const o = sizeOf(OUTLINES[shape]);
  const osz = Math.max(o.w, o.h), ocx = (o.x0 + o.x1) / 2, ocy = (o.y0 + o.y1) / 2;
  return OUTLINES[shape].flatMap(([x, y]) => [Math.round(cx + ((x - ocx) / osz) * sz), Math.round(cy + ((y - ocy) / osz) * sz)]);
}
// お手本の小さな絵（PAD の場の中ほどに置く）
const sampleFlat = (shape) => fittedOutline([30, 30, 170, 170], shape);

export default {
  id: 'katachi',
  name: 'かたち描き',
  icon: '✏️',
  desc: 'お手本の形を一筆で描く。お手本に近いほど上',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  settings: [
    { key: 'shapes', label: '形', desc: '9つでは月・しずく・矢印・十字も出て、毎回くじで選ぶ', def: 'basic', choices: SHAPE_CHOICES },
    { key: 'time', label: '描く時間', desc: '1回に描ける時間', def: 12, choices: TIME_CHOICES },
    { key: 'rounds', label: '回数', desc: '1回の対局で描く回数', def: 5, choices: ROUND_CHOICES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { shapes: 'basic', time: 12, rounds: 5, ...rules };
    const order = orderOf(seed, r);
    return { n, seed, rules: r, order, q: -1, phase: 'ready', draws: Array(n).fill(null), likes: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || s.draws[p] === null); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' && me !== null && me >= 0 && me < b.n ? ((b.last?.pts[me] ?? 0) >= 3 ? 'correct' : 'pop') : null;
    return m.p === me ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}回目 / ${s.order.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.draws.every((v) => v !== null)) return { key: 'all' + s.q, ms: 600, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s.rules) + GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.order.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.draws = Array(s.n).fill(null);
        s.likes = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.likes);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { shape: s.order[s.q], likes: s.likes.slice() }];
        return s;
      }
      return null;
    }
    if (m.t !== 'draw' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.draws[m.p] !== null) return null;
    const f = m.pts;
    if (!Array.isArray(f) || f.length % 2 || f.length < 8 || f.length > MAX_PTS * 2 || !f.every((v) => Number.isInteger(v) && v >= 0 && v <= PAD)) return null;
    const s = clone(s0);
    s.step += 1;
    s.draws[m.p] = f.slice();
    s.likes[m.p] = likeness(f, s.order[s.q]);
    return s;
  },

  // CPU: 描く時間のおよそ 25〜67%（12秒で 3〜8秒）で描き終える
  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.draws[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: limitOf(s.rules) * (0.25 + Math.random() * 0.42), pts: cpuDraw(s.order[s.q]) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'draw', q: s.q, pts: plan.pts } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.draws[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.draws[p] === null) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">${s.likes[p]}%${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替える（ほかの人の手が届くたびに作り直すと、描きかけ・押しかけが消えるため）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.draws[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    ui = { mount, chips };
    root.innerHTML = '';
    root.className = 'board kt';
    root.append(chips);
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const head = document.createElement('p');
    head.className = 'cp-head';
    root.append(head);
    if (s.phase === 'ready') {
      head.textContent = `よーい… お手本の形を一筆で描こう（全${s.order.length}回・1回${limitOf(s.rules) / 1000}秒・お手本に近い順に 3・2・1点）`;
      return;
    }
    const shape = s.order[s.q];
    const name = SHAPES.find((x) => x.id === shape).name;
    head.textContent = s.phase === 'open' ? `「${name}」を一筆で描こう（大きさと場所は自由）` : `「${name}」の結果`;
    const key = qKey(s);
    since(key);

    const row = document.createElement('div');
    row.className = 'kt-row';
    const sample = document.createElement('div');
    sample.className = 'kt-sample';
    sample.innerHTML = `<span>お手本</span><svg viewBox="0 0 ${PAD} ${PAD}" aria-label="お手本の${name}"><path d="${pathOf(sampleFlat(shape), true)}"/></svg>`;
    const pad = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pad.setAttribute('viewBox', `0 0 ${PAD} ${PAD}`);
    pad.setAttribute('class', 'kt-pad');
    row.append(sample, pad);
    root.append(row);
    const note = document.createElement('p');
    note.className = 'cc-log';
    root.append(note);

    const mine = me !== null ? s.draws[me] : null;
    if (s.phase === 'shown') {
      if (mine) {
        pad.innerHTML = `<path class="kt-fit" d="${pathOf(fittedOutline(mine, shape), true)}"/><path class="kt-ink" d="${pathOf(mine)}"/>`;
        note.textContent = `似ている度 ${s.likes[me]}%${s.last.pts[me] ? `（+${s.last.pts[me]}点）` : ''}　点線は、あなたの絵に合わせたお手本`;
      } else {
        pad.innerHTML = `<path class="kt-fit" d="${pathOf(sampleFlat(shape), true)}"/>`;
        note.textContent = me === null ? '' : '描けませんでした…';
      }
      // 全員の絵
      const all = document.createElement('div');
      all.className = 'kt-all';
      s.draws.forEach((d, p) => {
        const c = document.createElement('div');
        c.className = 'kt-mini';
        c.style.borderColor = SEAT_COLORS[p % SEAT_COLORS.length];
        c.innerHTML = `<svg viewBox="0 0 ${PAD} ${PAD}">${d ? `<path class="kt-ink" d="${pathOf(d)}"/>` : ''}</svg><b></b><span>${d ? s.likes[p] + '%' : '―'}</span>`;
        c.querySelector('b').textContent = p === me ? 'あなた' : o.names[p];
        all.append(c);
      });
      root.append(all);
      return;
    }

    // 描く場面
    if (mine) {
      pad.innerHTML = `<path class="kt-ink" d="${pathOf(mine)}"/>`;
      note.textContent = '描けた！ ほかの人を待っています';
      return;
    }
    if (me === null) { note.textContent = '観戦中'; return; }
    const ink = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ink.setAttribute('class', 'kt-ink');
    pad.append(ink);
    pad.classList.add('live');
    const LIMIT = limitOf(s.rules);
    const left = () => LIMIT - since(key);
    const noteText = (msg) => `${msg ? msg + '　' : ''}のこり ${Math.max(0, Math.ceil(left() / 1000))}秒`;
    note.textContent = noteText('指（マウス）を離したら描き終わり');
    let pts = null;
    let sent = false;
    const toPad = (e) => {
      const r = pad.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * PAD);
      const y = Math.round(((e.clientY - r.top) / r.height) * PAD);
      return [Math.max(0, Math.min(PAD, x)), Math.max(0, Math.min(PAD, y))];
    };
    const add = (e) => {
      const [x, y] = toPad(e);
      const n = pts.length;
      if (n >= 2 && Math.abs(pts[n - 2] - x) + Math.abs(pts[n - 1] - y) < 2) return;
      pts.push(x, y);
      ink.setAttribute('d', pathOf(pts));
    };
    pad.onpointerdown = (e) => {
      if (sent || left() <= 0 || !o.canMove) return;
      e.preventDefault();
      try { pad.setPointerCapture(e.pointerId); } catch { /* 指の番号が無いとき（命令で押したときなど）は捕まえずに描く */ }
      pts = [];
      add(e);
    };
    pad.onpointermove = (e) => {
      if (!pts || sent || left() <= 0) return; // 時間切れのあとの線は足さない（描いた所までを送る）
      const list = e.getCoalescedEvents?.(); // 速く動かしたときの間の点も拾う（無い・空のときはその1点だけ）
      for (const ev of list?.length ? list : [e]) add(ev);
    };
    const finish = () => {
      if (!pts || sent) return;
      const flat = pts;
      pts = null;
      const xy = [];
      for (let i = 0; i < flat.length; i += 2) xy.push([flat[i], flat[i + 1]]);
      const b = sizeOf(xy);
      if (flat.length < 8 || Math.max(b.w, b.h) < MIN_SIZE) {
        ink.setAttribute('d', '');
        note.textContent = noteText('もっと大きく描こう');
        return;
      }
      // 点が多すぎたら間引く
      let send = flat;
      if (flat.length > MAX_PTS * 2) {
        const k = Math.ceil(flat.length / 2 / MAX_PTS);
        send = [];
        for (let i = 0; i < flat.length; i += 2 * k) send.push(flat[i], flat[i + 1]);
        if (send.at(-2) !== flat.at(-2) || send.at(-1) !== flat.at(-1)) { send.pop(); send.pop(); send.push(flat.at(-2), flat.at(-1)); }
      }
      // 時間切れのときも、描きかけの線は送る（ホストの締め切りは GRACE_MS だけ遅いので届けば数える）。前はここで止めていて、指を置いたまま時間切れになると0点だった（2026-11-13 Codex の点検）
      sent = true;
      pad.classList.remove('live');
      o.onMove({ t: 'draw', q: s.q, pts: send });
    };
    pad.onpointerup = finish;
    pad.onpointercancel = finish;
    const tick = () => {
      if (!pad.isConnected || sent) return;
      if (left() <= 0) {
        pad.classList.remove('live');
        if (pts && !sent) finish();
        if (!sent) note.textContent = '時間切れ！';
        return;
      }
      if (!pts) note.textContent = noteText(note.textContent.startsWith('もっと') ? 'もっと大きく描こう' : '指（マウス）を離したら描き終わり');
      setTimeout(tick, 250);
    };
    tick();
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const best = Math.max(0, ...x.likes.map((v) => v ?? 0));
      const mine = me === null ? '' : x.likes[me] === null ? '―' : x.likes[me] + '%';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${SHAPES.find((y) => y.id === x.shape).name}</span><span>${mine}</span><span class="mk-rv-who">いちばん ${best}%</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
