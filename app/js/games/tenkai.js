// 展開図あて。立体の絵を見て、組み立てられる正しい展開図を4つから早押しで選ぶ。2〜10人・足りない分は CPU（弱め）。
// 2026-11-17 本人の決定（Claude が出した案「サイコロの展開図」を、本人が「いろんな図形の展開図当て」に変えて選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおり」）:
//   - 立体の絵を見て、正しい展開図を4つから選ぶ。まちがいの3つは、組み立てると面が重なったり足りなくなったりする展開図。
//   - 点と進め方は切り紙あてと同じ（10問、正解した速い順に 3・2・1点、まちがえたらその問題はもう押せないが点は減らない）。
//   - 詳細設定「むずかしさ」で立体を増やす: やさしい（立方体・直方体・三角柱）・ふつう（それに四角すい・正四面体・六角柱。最初）・むずかしい（それに円柱・円すい・正八面体）。
// Claude の判断:
//   - 問題はその場で種から作る。角のある立体（円柱・円すい以外）は、面のつながりからでたらめに切り開いて、平らに並べて面が重ならない正しい展開図を作る。
//     まちがいは、正しい展開図のはしの面を1つ外して、ほかの面の同じ長さの辺へ付け替え、平らには重ならないが組み立てられないもの（tryFold で確かめる）。
//     ちがう形が3つそろわないとき（正四面体など）は、面を1つ足りなくしたもの・1つ多くしたもので埋める。
//     まちがいどうしは、面の中心どうしの距離の組でくらべて、回したり裏返したりして同じになるものは入れない。
//   - 円柱・円すいの展開図は形を決めて作る: 円柱は長方形の上下にふたの円、円すいはおうぎ形に底の円。
//     まちがいは、円柱は ふたが同じ側・長方形が短い・円が小さい・円が大きい・円が横の辺、円すいは おうぎが広すぎ・せますぎ・円が先っぽ・円が大きい・円が小さい から種で3つ。
//   - 問題の立体は、むずかしさの立体を順にまぜて出す（同じ立体ばかり続かない）。立体の名前も出す。紙の色は問題ごとに種で選ぶ。
//   - 面の位置は足し算・かけ算・平方根だけで計算する（三角関数を使うと端末で末尾の桁がずれ、重なりの判定が割れて、端末ごとに選択肢が変わりうるため）。
//     立体の絵だけは三角関数で描く（見た目だけで、選択肢には関わらない）。
//   - 制限時間は やさしい15秒・ふつう18秒・むずかしい20秒。全員が答えたら0.8秒で締め切る。答えを見せる間は3秒。
//   - CPU の正解の見込みは やさしい8割・ふつう68%・むずかしい55%。3〜7秒（むずかしいは＋1秒）で答える。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（切り紙あてと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ札の番号（0〜3）, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = 10;
const LEVELS = [['easy', 'やさしい（立方体・直方体・三角柱）'], ['normal', 'ふつう（＋四角すい・正四面体・六角柱）'], ['hard', 'むずかしい（＋円柱・円すい・正八面体）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r?.level) ? r.level : 'normal');
export const KINDS = {
  easy: ['cube', 'cuboid', 'triprism'],
  normal: ['cube', 'cuboid', 'triprism', 'pyramid', 'tetra', 'hexprism'],
  hard: ['cube', 'cuboid', 'triprism', 'pyramid', 'tetra', 'hexprism', 'cylinder', 'cone', 'octa'],
};
export const NAMES = { cube: '立方体', cuboid: '直方体', triprism: '三角柱', pyramid: '四角すい', tetra: '正四面体', hexprism: '六角柱', cylinder: '円柱', cone: '円すい', octa: '正八面体' };
export const limitOf = (r) => ({ easy: 15000, normal: 18000, hard: 20000 }[levelOf(r)]);
const READY_MS = 3000;
const SHOWN_MS = 3000;
const GRACE_MS = 800;
const COLORS = ['#f3c98b', '#a9d4f0', '#b8e0a8', '#f5b3c4', '#d6c4f0'];

/* ---------- 立体（角のあるもの） ---------- */

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.sqrt(dot(a, a)); return a.map((v) => v / l); };
const mean = (ps) => ps[0].map((_, i) => ps.reduce((s, p) => s + p[i], 0) / ps.length);

// 面の頂点の並びを、外から見て左回りにそろえる
function orient(V, faces) {
  const c = mean(V);
  return faces.map((f) => {
    const n = cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]]));
    return dot(n, sub(mean(f.map((i) => V[i])), c)) < 0 ? f.slice().reverse() : f;
  });
}
function prism(base, h) {
  const n = base.length;
  const V = [...base.map(([x, y]) => [x, y, 0]), ...base.map(([x, y]) => [x, y, h])];
  const F = [[...Array(n).keys()], [...Array(n).keys()].map((i) => i + n)];
  for (let i = 0; i < n; i++) F.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
  return { V, F: orient(V, F) };
}
function pyramid(base, h) {
  const n = base.length;
  const c = mean(base);
  const V = [...base.map(([x, y]) => [x, y, 0]), [c[0], c[1], h]];
  const F = [[...Array(n).keys()]];
  for (let i = 0; i < n; i++) F.push([i, (i + 1) % n, n]);
  return { V, F: orient(V, F) };
}
const S3 = Math.sqrt(3);
const hexagon = (r) => [[r, 0], [r / 2, r * S3 / 2], [-r / 2, r * S3 / 2], [-r, 0], [-r / 2, -r * S3 / 2], [r / 2, -r * S3 / 2]];
export const SOLIDS = {
  cube: prism([[0, 0], [1, 0], [1, 1], [0, 1]], 1),
  cuboid: prism([[0, 0], [1.5, 0], [1.5, 1], [0, 1]], 0.6),
  // 三角柱は横に寝かせる（立てると絵が細くなるため。軸を x にまわす）
  triprism: (() => { const p = prism([[0, 0], [1, 0], [0.5, S3 / 2]], 1.5); const V = p.V.map(([x, y, z]) => [z, x, y]); return { V, F: orient(V, p.F) }; })(),
  hexprism: prism(hexagon(0.6), 1.2),
  pyramid: pyramid([[0, 0], [1, 0], [1, 1], [0, 1]], 0.9),
  // 正四面体は1つの面を下にして置く（1辺1。高さ √(2/3)）
  tetra: pyramid([[0, 0], [1, 0], [0.5, S3 / 2]], Math.sqrt(2 / 3)),
  octa: (() => {
    const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const F = [];
    for (const x of [0, 1]) for (const y of [2, 3]) for (const z of [4, 5]) F.push([x, y, z]);
    return { V, F: orient(V, F) };
  })(),
};
// 面ごとの平らな形（面の上の2次元の位置。外から見て左回り）と、辺のとなり
const prep = new Map();
function solidOf(kind) {
  if (prep.has(kind)) return prep.get(kind);
  const { V, F } = SOLIDS[kind];
  const flat = F.map((f) => {
    const p0 = V[f[0]];
    const e1 = norm3(sub(V[f[1]], p0));
    const n = norm3(cross(sub(V[f[1]], p0), sub(V[f[2]], p0)));
    const e2 = cross(n, e1);
    return f.map((i) => [dot(sub(V[i], p0), e1), dot(sub(V[i], p0), e2)]);
  });
  const edge = new Map(); // 'a,b' → [面, 何番目の辺]
  F.forEach((f, fi) => f.forEach((a, k) => edge.set(`${a},${f[(k + 1) % f.length]}`, [fi, k])));
  const x = { V, F, flat, edge, sig: flat.map(shapeSig) };
  prep.set(kind, x);
  return x;
}

/* ---------- 平らな形の道具 ---------- */

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const len2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
// 形の目印: 辺の長さと角（内積）を順に並べたもの（回した並びで比べる）
function shapeSig(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % n], r = pts[(i + 2) % n];
    const u = [q[0] - p[0], q[1] - p[1]], w = [r[0] - q[0], r[1] - q[1]];
    return `${r6(len2(p, q))}/${r6((u[0] * w[0] + u[1] * w[1]) / Math.sqrt(len2(p, q) * len2(q, r)))}`;
  });
}
// a を rot だけ回すと b と同じ形か
const sameShape = (a, b, rot) => a.length === b.length && a.every((x, i) => x === b[(i + rot) % b.length]);

// 形 pts を、辺 (i0 → i1) が (A → B) に重なるように動かす（裏返さない。辺の長さは同じであること）
function placeOn(pts, i0, i1, A, B) {
  const P = pts[i0], Q = pts[i1];
  const u = [Q[0] - P[0], Q[1] - P[1]], w = [B[0] - A[0], B[1] - A[1]];
  const L = u[0] * u[0] + u[1] * u[1];
  const c = (u[0] * w[0] + u[1] * w[1]) / L, s = (u[0] * w[1] - u[1] * w[0]) / L;
  return pts.map(([x, y]) => { const dx = x - P[0], dy = y - P[1]; return [A[0] + c * dx - s * dy, A[1] + s * dx + c * dy]; });
}
// 2つの凸の形が重なるか（辺がくっつくだけなら重ならない）
const EPS = 1e-7;
function overlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = q[1] - p[1], ay = p[0] - q[0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = v[0] * ax + v[1] * ay; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = v[0] * ax + v[1] * ay; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      const scale = Math.sqrt(ax * ax + ay * ay);
      if (a1 <= b0 + EPS * scale || b1 <= a0 + EPS * scale) return false;
    }
  }
  return true;
}
const overlapsAny = (pts, faces, skip = -1) => faces.some((f, i) => i !== skip && overlap(pts, f));

/* ---------- 展開図 ---------- */
// 展開図 = { faces: [平らな形], hinges: [[面i, 辺k, 面j, 辺l]] }（面i の辺k と 面j の辺l がつながって折る所）

// 立体をでたらめに切り開いて、重ならない正しい展開図を作る
function unfold(kind, rnd) {
  const S = solidOf(kind);
  for (let tries = 0; tries < 200; tries++) {
    const root = Math.floor(rnd() * S.F.length);
    const at = new Map([[root, S.flat[root]]]); // 立体の面 → 置いた形
    const order = [root];
    const hinges = [];
    let frontier = S.F[root].map((_, k) => [root, k]);
    while (order.length < S.F.length && frontier.length) {
      const [fi, k] = frontier.splice(Math.floor(rnd() * frontier.length), 1)[0];
      const f = S.F[fi];
      const a = f[k], b = f[(k + 1) % f.length];
      const [gi, l] = S.edge.get(`${b},${a}`);
      if (at.has(gi)) continue;
      const g = S.F[gi];
      // となりの面の辺 l は (b → a)
      const pts = placeOn(S.flat[gi], l, (l + 1) % g.length, at.get(fi)[(k + 1) % f.length], at.get(fi)[k]);
      if (overlapsAny(pts, [...at.values()])) continue;
      at.set(gi, pts);
      hinges.push([order.indexOf(fi), k, order.length, l]);
      order.push(gi);
      frontier.push(...g.map((_, kk) => [gi, kk]).filter(([, kk]) => kk !== l));
    }
    if (order.length === S.F.length) return { faces: order.map((fi) => at.get(fi)), hinges };
  }
  return null;
}

// 組み立てられるか: 展開図の面を立体の面へ、折る所のつながりどおりに1つずつ当てていき、全部の面にちょうど1回ずつ当たれば組み立てられる
export function tryFold(kind, net) {
  const S = solidOf(kind);
  const n = net.faces.length;
  if (n !== S.F.length) return false;
  const sig = net.faces.map(shapeSig);
  const adj = Array.from({ length: n }, () => []);
  for (const [i, k, j, l] of net.hinges) { adj[i].push([k, j, l]); adj[j].push([l, i, k]); }
  for (let P = 0; P < S.F.length; P++) {
    for (let r = 0; r < S.F[P].length; r++) {
      if (!sameShape(sig[0], S.sig[P], r)) continue;
      const map = new Array(n).fill(null); // 展開図の面 → [立体の面, ずれ]
      map[0] = [P, r];
      const used = new Set([P]);
      const stack = [0];
      let ok = true;
      while (ok && stack.length) {
        const i = stack.pop();
        const [Pi, ri] = map[i];
        for (const [k, j, l] of adj[i]) {
          const f = S.F[Pi];
          const e = (k + ri) % f.length;
          const [Q, eq] = S.edge.get(`${f[(e + 1) % f.length]},${f[e]}`);
          const rj = ((eq - l) % S.F[Q].length + S.F[Q].length) % S.F[Q].length;
          if (map[j]) { if (map[j][0] !== Q || map[j][1] !== rj) ok = false; continue; }
          if (used.has(Q) || !sameShape(sig[j], S.sig[Q], rj)) { ok = false; break; }
          map[j] = [Q, rj];
          used.add(Q);
          stack.push(j);
        }
      }
      if (ok && map.every(Boolean)) return true;
    }
  }
  return false;
}

// 平らに並べたときに辺どうしが重なっている所（折れそうに見える所）の一覧 [[面i, 辺k, 面j, 辺l]]
const near = (p, q) => r6(p[0]) === r6(q[0]) && r6(p[1]) === r6(q[1]);
export function contacts(faces) {
  const out = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const a = faces[i], b = faces[j];
    for (let k = 0; k < a.length; k++) for (let l = 0; l < b.length; l++) {
      if (near(a[k], b[(l + 1) % b.length]) && near(a[(k + 1) % a.length], b[l])) out.push([i, k, j, l]);
    }
  }
  return out;
}
// 見た目のとおりに組み立てられるか: 辺が重なっている所のどれを折り目に選んでも、組み立てられないなら false
// （付け替えた面がほかの面にもくっついていると、そちらで折れば組み立てられることがあるため）
export function anyFold(kind, faces) {
  const n = faces.length;
  const es = contacts(faces);
  const pick = [];
  const rec = (from) => {
    if (pick.length === n - 1) {
      const up = [...Array(n).keys()];
      const root = (x) => (up[x] === x ? x : (up[x] = root(up[x])));
      for (const e of pick) { const a = root(e[0]), b = root(e[2]); if (a === b) return false; up[a] = b; }
      return tryFold(kind, { faces, hinges: pick });
    }
    for (let i = from; i <= es.length - (n - 1 - pick.length); i++) {
      pick.push(es[i]);
      if (rec(i + 1)) return true;
      pick.pop();
    }
    return false;
  };
  return rec(0);
}

// 見た目の目印（回しても裏返しても同じになる）: 面の角の数と、面の中心どうしの距離の組
function netSig(net) {
  const cs = net.faces.map((f) => [f.reduce((a, p) => a + p[0], 0) / f.length, f.reduce((a, p) => a + p[1], 0) / f.length]);
  const d = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) d.push(Math.round(Math.sqrt(len2(cs[i], cs[j])) * 1000));
  return net.faces.map((f) => f.length).sort().join('') + ':' + d.sort((a, b) => a - b).join(',');
}
const degrees = (net) => { const d = net.faces.map(() => 0); for (const [i, , j] of net.hinges) { d[i]++; d[j]++; } return d; };

// 正しい展開図の、はしの面を1つ別の辺へ付け替えたもの（組み立てられないものだけ）
function wrongMoves(kind, good, rnd) {
  const out = [];
  const deg = degrees(good);
  const leaves = shuffle(deg.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0), rnd);
  for (const L of leaves) {
    const rest = good.hinges.filter(([i, , j]) => i !== L && j !== L);
    const others = good.faces.filter((_, i) => i !== L);
    const shape = good.faces[L];
    for (let F = 0; F < good.faces.length; F++) {
      if (F === L) continue;
      const fp = good.faces[F];
      for (let m = 0; m < fp.length; m++) {
        const A = fp[m], B = fp[(m + 1) % fp.length];
        for (let k = 0; k < shape.length; k++) {
          const P = shape[k], Q = shape[(k + 1) % shape.length];
          if (r6(len2(P, Q)) !== r6(len2(A, B))) continue;
          const pts = placeOn(shape, k, (k + 1) % shape.length, B, A);
          if (overlapsAny(pts, others)) continue;
          const net = { faces: good.faces.map((f, i) => (i === L ? pts : f)), hinges: [...rest, [F, m, L, k]] };
          if (!anyFold(kind, net.faces)) out.push(net);
        }
      }
    }
  }
  return out;
}
// 埋め草: 面を1つ足りなくしたもの・1つ多くしたもの
function fillers(good, rnd) {
  const out = [];
  const deg = degrees(good);
  const L = shuffle(deg.map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0), rnd)[0];
  out.push({ faces: good.faces.filter((_, i) => i !== L), hinges: [] });
  const cand = [];
  good.faces.forEach((fp, F) => fp.forEach((A, m) => {
    const B = fp[(m + 1) % fp.length];
    const shape = good.faces[L];
    for (let k = 0; k < shape.length; k++) {
      if (r6(len2(shape[k], shape[(k + 1) % shape.length])) !== r6(len2(A, B))) continue;
      const pts = placeOn(shape, k, (k + 1) % shape.length, B, A);
      if (!overlapsAny(pts, good.faces)) cand.push(pts);
    }
  }));
  if (cand.length) out.push({ faces: [...good.faces, cand[Math.floor(rnd() * cand.length)]], hinges: [] });
  return out;
}

/* ---------- 円柱・円すい ---------- */
// 形: { rect: [x, y, 幅, 高さ] } / { circle: [cx, cy, r] } / { sector: [cx, cy, 半径, 開く角（度）] }（おうぎは下向きに開く）
const PI = Math.PI;
function cylNet(kind, rnd) {
  const r = 0.5, h = 1.2, W = 2 * PI * r;
  const at = (rr, w = W) => rr + rnd() * (w - 2 * rr);
  const make = (v) => {
    let w = W, rr = r;
    if (v === 'short') w = W * 0.62;
    if (v === 'small') rr = 0.3;
    if (v === 'big') rr = 0.78;
    const items = [{ rect: [0, 0, w, h] }];
    if (v === 'same') { const x = at(rr, w / 2 + rr); items.push({ circle: [x, -rr, rr] }, { circle: [Math.min(w - rr, x + 2 * rr + 0.2 + rnd() * 0.6), -rr, rr] }); }
    else if (v === 'side') items.push({ circle: [at(rr, w), -rr, rr] }, { circle: [w + rr, h / 2, rr] });
    else items.push({ circle: [at(rr, w), -rr, rr] }, { circle: [at(rr, w), h + rr, rr] });
    return { items };
  };
  const wrong = shuffle(['same', 'short', 'small', 'big', 'side'], rnd).slice(0, 3);
  return { good: make('good'), wrong: wrong.map(make) };
}
function coneNet(kind, rnd) {
  const r = 0.5, L = 1.2, A = 360 * r / L; // 150度
  const make = (v) => {
    let ang = A, rr = r;
    if (v === 'wide') ang = 250;
    if (v === 'narrow') ang = 85;
    if (v === 'big') rr = 0.8;
    if (v === 'small') rr = 0.28;
    const items = [{ sector: [0, 0, L, ang] }];
    if (v === 'tip') items.push({ circle: [0, -rr, rr] });
    else items.push({ circle: [0, L + rr, rr] });
    return { items };
  };
  const wrong = shuffle(['wide', 'narrow', 'tip', 'big', 'small'], rnd).slice(0, 3);
  return { good: make('good'), wrong: wrong.map(make) };
}

/* ---------- 問題 ---------- */

export function makeQuestion(kind, rnd) {
  if (kind === 'cylinder' || kind === 'cone') {
    const { good, wrong } = (kind === 'cylinder' ? cylNet : coneNet)(kind, rnd);
    const side = Math.floor(rnd() * 4);
    const choices = wrong.slice();
    choices.splice(side, 0, good);
    return { kind, choices, side };
  }
  for (let k = 0; k < 30; k++) {
    const good = unfold(kind, rnd);
    if (!good) continue;
    const seen = new Set();
    const wrong = [];
    for (const w of shuffle(wrongMoves(kind, good, rnd), rnd)) {
      const g = netSig(w);
      if (seen.has(g)) continue;
      seen.add(g);
      wrong.push(w);
      if (wrong.length === 3) break;
    }
    for (const w of fillers(good, rnd)) if (wrong.length < 3) wrong.push(w);
    if (wrong.length < 3) continue;
    const side = Math.floor(rnd() * 4);
    const choices = wrong.map((w) => ({ faces: w.faces }));
    choices.splice(side, 0, { faces: good.faces });
    return { kind, choices, side };
  }
  throw new Error('展開図が作れない: ' + kind);
}
const made = new Map();
export function makeQuestions(seed, level) {
  const key = `${seed}:${level}`;
  if (made.has(key)) return made.get(key);
  const rnd = mulberry32(seed);
  const kinds = [];
  while (kinds.length < ROUNDS) kinds.push(...shuffle(KINDS[level], rnd));
  const qs = kinds.slice(0, ROUNDS).map((kind) => ({ ...makeQuestion(kind, rnd), color: COLORS[Math.floor(rnd() * COLORS.length)] }));
  made.set(key, qs);
  if (made.size > 8) made.delete(made.keys().next().value);
  return qs;
}

/* ---------- 進行 ---------- */

const qKey = (s, q = s.q) => `tenkai:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'tenkai',
  name: '展開図あて',
  icon: '📦',
  desc: '立体の絵を見て、組み立てられる正しい展開図を4つから早押しで当てる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '出てくる立体の種類', def: 'normal', choices: LEVELS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', ...rules };
    return {
      n, seed, rules: r, qs: makeQuestions(seed, levelOf(r)), q: -1, phase: 'ready',
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
      plan = { at: 3000 + Math.random() * 4000 + (lv === 'hard' ? 1000 : 0), c: ok ? x.side : others[Math.floor(Math.random() * 3)] };
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
    root.className = 'board kj tn';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">立体を組み立てられる展開図はどれ？・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s.rules);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="tn-name">${NAMES[x.kind]}</div>`);
    card.append(solidSvg(x.kind, x.color));
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
    pad.className = 'tn-pad';
    x.choices.forEach((net, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tn-choice' + (s.phase === 'shown' && c === x.side ? ' ans' : '') + (s.phase === 'shown' && c !== x.side ? ' dim' : '');
      b.setAttribute('aria-label', `${c + 1}番の展開図`);
      b.disabled = !can;
      b.append(netSvg(net, x.color));
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
    else if (s.phase === 'open') note.textContent = '組み立てて、この立体になる展開図を押そう';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    list.className = 'tn-review';
    s.log.forEach((x, q) => {
      const qq = s.qs[q];
      const li = document.createElement('li');
      const name = Object.assign(document.createElement('span'), { className: 'mk-rv-n', textContent: NAMES[qq.kind] });
      li.append(name, solidSvg(qq.kind, qq.color, 'tn-solid small'), Object.assign(document.createElement('span'), { className: 'kg-rv-arrow', textContent: '➡' }), netSvg(qq.choices[qq.side], qq.color));
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

/* ---------- 絵 ---------- */
const NS = 'http://www.w3.org/2000/svg';
const f3 = (v) => (Math.round(v * 1000) / 1000).toString();
function svgEl(viewBox, cls) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('class', cls);
  svg.setAttribute('role', 'img');
  return svg;
}
const add = (svg, tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.append(e); return e; };
const bboxOf = (ps) => { const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
const box = ([x0, y0, x1, y1], pad) => `${f3(x0 - pad)} ${f3(y0 - pad)} ${f3(x1 - x0 + 2 * pad)} ${f3(y1 - y0 + 2 * pad)}`;
// 色を明るく・暗くする（k > 0 で白へ、k < 0 で黒へ）
function tint(hex, k) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return '#' + v.map((c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k)).toString(16).padStart(2, '0')).join('');
}

// 展開図の絵
export function netSvg(net, color) {
  if (net.items) return curvedSvg(net.items, color);
  let faces = net.faces;
  let [x0, y0, x1, y1] = bboxOf(faces.flat());
  // たてに長いときは横に寝かせる（ボタンが横長なので）
  if (y1 - y0 > (x1 - x0) * 1.15) {
    faces = faces.map((f) => f.map(([x, y]) => [y, -x]));
    [x0, y0, x1, y1] = bboxOf(faces.flat());
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.04;
  const svg = svgEl(box([x0, y0, x1, y1], pad), 'tn-net');
  const sw = Math.max(x1 - x0, y1 - y0) * 0.012;
  for (const f of faces) add(svg, 'polygon', { points: f.map((p) => p.map(f3).join(',')).join(' '), fill: color, stroke: '#4a3a2a', 'stroke-width': f3(sw), 'stroke-linejoin': 'round' });
  return svg;
}
function curvedSvg(items, color) {
  const pts = [];
  for (const it of items) {
    if (it.rect) { const [x, y, w, h] = it.rect; pts.push([x, y], [x + w, y + h]); }
    if (it.circle) { const [cx, cy, r] = it.circle; pts.push([cx - r, cy - r], [cx + r, cy + r]); }
    if (it.sector) {
      const [cx, cy, R, ang] = it.sector;
      pts.push([cx, cy]);
      for (let a = -ang / 2; a <= ang / 2 + 0.01; a += ang / 24) { const t = (a * PI) / 180; pts.push([cx + R * Math.sin(t), cy + R * Math.cos(t)]); }
    }
  }
  const bb = bboxOf(pts);
  const sz = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  const svg = svgEl(box(bb, sz * 0.04), 'tn-net');
  const common = { fill: color, stroke: '#4a3a2a', 'stroke-width': f3(sz * 0.012), 'stroke-linejoin': 'round' };
  for (const it of items) {
    if (it.rect) { const [x, y, w, h] = it.rect; add(svg, 'rect', { x: f3(x), y: f3(y), width: f3(w), height: f3(h), ...common }); }
    if (it.circle) { const [cx, cy, r] = it.circle; add(svg, 'circle', { cx: f3(cx), cy: f3(cy), r: f3(r), ...common }); }
    if (it.sector) {
      const [cx, cy, R, ang] = it.sector;
      const t0 = (-ang / 2 * PI) / 180, t1 = (ang / 2 * PI) / 180;
      const p0 = [cx + R * Math.sin(t0), cy + R * Math.cos(t0)], p1 = [cx + R * Math.sin(t1), cy + R * Math.cos(t1)];
      add(svg, 'path', { d: `M${f3(cx)},${f3(cy)} L${p0.map(f3).join(',')} A${f3(R)},${f3(R)} 0 ${ang > 180 ? 1 : 0} 0 ${p1.map(f3).join(',')} Z`, ...common });
    }
  }
  return svg;
}

// 立体の絵（少し上から見た形。見えない辺は点線）
const YAW = 0.6, PITCH = 0.42;
function project([x, y, z]) {
  const x1 = x * Math.cos(YAW) - y * Math.sin(YAW), y1 = x * Math.sin(YAW) + y * Math.cos(YAW);
  const y2 = y1 * Math.cos(PITCH) - z * Math.sin(PITCH), z2 = y1 * Math.sin(PITCH) + z * Math.cos(PITCH);
  return { X: x1, Y: -z2, D: y2 };
}
export function solidSvg(kind, color, cls = 'tn-solid') {
  if (kind === 'cylinder' || kind === 'cone') return roundSolidSvg(kind, color, cls);
  const { V, F } = SOLIDS[kind];
  const c = mean(V);
  const P = V.map((v) => project(sub(v, c)));
  const facing = F.map((f) => {
    const n = cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]]));
    return project(n).D - project([0, 0, 0]).D < 0;
  });
  const bb = bboxOf(P.map((p) => [p.X, p.Y]));
  const sz = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
  const svg = svgEl(box(bb, sz * 0.06), cls);
  svg.setAttribute('aria-label', NAMES[kind]);
  const sw = f3(sz * 0.018);
  // 見えない辺（両側の面がどちらも裏を向いている辺）
  const seen = new Set();
  F.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    const other = F.findIndex((g, gi) => gi !== fi && g.includes(a) && g.includes(b));
    if (facing[fi] || facing[other]) return;
    add(svg, 'line', { x1: f3(P[a].X), y1: f3(P[a].Y), x2: f3(P[b].X), y2: f3(P[b].Y), stroke: '#8a7a6a', 'stroke-width': sw, 'stroke-dasharray': f3(sz * 0.04) });
  }));
  // 見える面（向きで明るさを変える）
  F.forEach((f, fi) => {
    if (!facing[fi]) return;
    const n = norm3(cross(sub(V[f[1]], V[f[0]]), sub(V[f[2]], V[f[0]])));
    const light = dot(n, norm3([-0.4, -0.6, 0.9]));
    add(svg, 'polygon', { points: f.map((i) => `${f3(P[i].X)},${f3(P[i].Y)}`).join(' '), fill: tint(color, light > 0 ? light * 0.35 : light * 0.3), stroke: '#4a3a2a', 'stroke-width': sw, 'stroke-linejoin': 'round' });
  });
  return svg;
}
function roundSolidSvg(kind, color, cls) {
  const r = 0.5, h = kind === 'cylinder' ? 1.2 : Math.sqrt(1.2 * 1.2 - r * r);
  const ry = r * Math.sin(PITCH);
  const yOf = (z) => -(z - h / 2) * Math.cos(PITCH);
  const top = yOf(h), bot = yOf(0);
  const pad = 0.08;
  const svg = svgEl(`${f3(-r - pad)} ${f3(top - (kind === 'cylinder' ? ry : 0) - pad)} ${f3(2 * r + 2 * pad)} ${f3(bot - top + ry + (kind === 'cylinder' ? ry : 0) + 2 * pad)}`, cls);
  svg.setAttribute('aria-label', NAMES[kind]);
  const sw = f3(0.025);
  const line = { stroke: '#4a3a2a', 'stroke-width': sw, 'stroke-linejoin': 'round' };
  // 底の円の奥の半分（点線）
  add(svg, 'path', { d: `M${f3(-r)},${f3(bot)} A${f3(r)},${f3(ry)} 0 0 1 ${f3(r)},${f3(bot)}`, fill: 'none', stroke: '#8a7a6a', 'stroke-width': sw, 'stroke-dasharray': '0.05' });
  if (kind === 'cylinder') {
    add(svg, 'path', { d: `M${f3(-r)},${f3(top)} L${f3(-r)},${f3(bot)} A${f3(r)},${f3(ry)} 0 0 0 ${f3(r)},${f3(bot)} L${f3(r)},${f3(top)} Z`, fill: tint(color, -0.08), ...line });
    add(svg, 'ellipse', { cx: 0, cy: f3(top), rx: f3(r), ry: f3(ry), fill: tint(color, 0.3), ...line });
  } else {
    add(svg, 'path', { d: `M0,${f3(top)} L${f3(-r)},${f3(bot)} A${f3(r)},${f3(ry)} 0 0 0 ${f3(r)},${f3(bot)} Z`, fill: tint(color, -0.05), ...line });
  }
  return svg;
}
