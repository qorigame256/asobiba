// かべ置きレース（2026-11-25 本人の依頼。本人が考えたルール。分かれ目のうち4つは本人の答え（どれも Claude の推奨。人数だけ本人が選び直した））。
// 方眼の盤の上で、自分の丸を向かい側の辺まで先に運んだ人の勝ち。番が来たら「丸を1マスたて・よこに動かす」か「マスの間に長さ2の壁を置く」のどちらか。
// 動かす先にほかの人の丸がいたら、その丸を飛び越した先へ移る。
// 本人の答え（2026-11-25）:
//   - だれかのゴールへの道を全部ふさぐ壁は置けない（どの人にも必ず道が1本残る）。
//   - 飛び越す先が壁か盤の外（3〜4人では、ほかの丸がいるときも）なら、飛び越せない代わりに、その丸の左右（ななめ前）へ移れる。
//   - 盤は 9×9（最初）と 7×7。人数は 2人（最初）・3人・4人。
// Claude の判断:
//   - 置き場所: 2人は 下 → 上。3人は 下 → 右 → 左、4人は 下 → 右 → 上 → 左（はさみ将棋の3人と同じく、自分から見て右どなりが次の人）。
//     丸は自分の辺のまん中から始め、向かいの辺のどこかに着いたら勝ち。
//   - 1人の壁の数: 9×9 は 2人 10枚・3人 7枚・4人 5枚、7×7 は 2人 6枚・3人 4枚・4人 3枚（人数で分ける）。
//   - 壁は交わる点を真ん中にして2マス分。ほかの壁と重なる・十字に交わる置き方はできない。
//   - 3〜4人で、動かせる先も置ける壁も無い人は、その番を飛ばす。
//   - 引き分け: 2人 300手・3人 450手・4人 600手（ふつうは起きない。CPU どうしが行ったり来たりしても止まるように）。
//   - 3〜4人の順位（成績表の「順位で点」）: ゴールした人が1位、ほかはゴールまでの近さの順（同じ近さは同じ順位）。
// 2026-11-25 の47回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「壁の数」（鍵 wall）: 少なめ・ふつう（最初。上の数のまま）・多め。少なめは上の数の半分、多めは1.5倍（どちらも端数は切り上げ。9×9 の2人なら 5枚・10枚・15枚）。
//     遊び方なので、おまかせでは抽選する。ふつうのときの局面は前と全く同じ。
// 手 = 丸の行き先のマス（段*一辺+列。段0が一番上）か、一辺*一辺 + 壁の番号。
//   壁の番号 = 向き（0 よこ・1 たて）*M*M + 段*M + 列（M = 一辺−1。交わる点の左上のマスの段と列）。
//   よこの壁 (r, c) は r 段と r+1 段の間を c 列・c+1 列の2マス分ふさぐ。たての壁 (r, c) は c 列と c+1 列の間を r 段・r+1 段の2マス分ふさぐ。

import { CPU_SETTING, col } from './util.js';

const SIDES = { 2: ['B', 'T'], 3: ['B', 'R', 'L'], 4: ['B', 'R', 'T', 'L'] };
const WALLS = { 9: { 2: 10, 3: 7, 4: 5 }, 7: { 2: 6, 3: 4, 4: 3 } };
const WALL_RATE = { few: 0.5, mid: 1, many: 1.5 };
export const wallsOf = (n, np, wall) => Math.ceil(WALLS[n][np] * (WALL_RATE[wall] ?? 1));
const MAX_PLY = { 2: 300, 3: 450, 4: 600 };
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // 上・下・左・右

// 盤の一辺ごとの形。blockers[マス*4+向き] = その向きへ動くのをふさぐ壁の番号の一覧
const GEO = {};
function geo(N) {
  if (GEO[N]) return GEO[N];
  const M = N - 1;
  const H = (r, c) => (r >= 0 && r < M && c >= 0 && c < M ? r * M + c : -1);
  const V = (r, c) => (r >= 0 && r < M && c >= 0 && c < M ? M * M + r * M + c : -1);
  const blockers = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      blockers.push([H(r - 1, c - 1), H(r - 1, c)].filter((w) => w >= 0)); // 上
      blockers.push([H(r, c - 1), H(r, c)].filter((w) => w >= 0)); // 下
      blockers.push([V(r - 1, c - 1), V(r, c - 1)].filter((w) => w >= 0)); // 左
      blockers.push([V(r - 1, c), V(r, c)].filter((w) => w >= 0)); // 右
    }
  }
  return (GEO[N] = { N, M, CELLS: N * N, WALLS: 2 * M * M, blockers });
}

const mid = (N) => (N - 1) / 2;
function startOf(side, N) {
  const m = mid(N);
  return { B: (N - 1) * N + m, T: m, R: m * N + N - 1, L: m * N }[side];
}
// その辺から始めた人のゴールか
function atGoal(side, N, cell) {
  const r = Math.floor(cell / N);
  const c = cell % N;
  return { B: r === 0, T: r === N - 1, R: c === 0, L: c === N - 1 }[side];
}

// 1マス先（盤の外・壁でふさがれていれば -1）
function step(g, walls, cell, d) {
  const { N, blockers } = g;
  const r = Math.floor(cell / N) + DIRS[d][0];
  const c = (cell % N) + DIRS[d][1];
  if (r < 0 || r >= N || c < 0 || c >= N) return -1;
  for (const w of blockers[cell * 4 + d]) if (walls[w]) return -1;
  return r * N + c;
}

// ゴールまでの一番短い道のりのマス数（丸は気にしない）。道が無ければ Infinity。path を渡すと道のマスを入れる
function distOf(g, walls, side, from, path) {
  const { N, CELLS } = g;
  if (atGoal(side, N, from)) return 0;
  const prev = new Int16Array(CELLS).fill(-1);
  prev[from] = from;
  let q = [from];
  for (let dist = 1; q.length; dist++) {
    const nq = [];
    for (const x of q) {
      for (let d = 0; d < 4; d++) {
        const y = step(g, walls, x, d);
        if (y < 0 || prev[y] >= 0) continue;
        prev[y] = x;
        if (atGoal(side, N, y)) {
          if (path) for (let z = y; z !== from; z = prev[z]) path.push(z);
          if (path) path.push(from);
          return dist;
        }
        nq.push(y);
      }
    }
    q = nq;
  }
  return Infinity;
}

// p の丸が動ける先
function pawnMoves(s, p) {
  const g = geo(s.n);
  const at = s.pos[p];
  const taken = (x) => s.pos.includes(x);
  const out = new Set();
  for (let d = 0; d < 4; d++) {
    const nb = step(g, s.walls, at, d);
    if (nb < 0) continue;
    if (!taken(nb)) { out.add(nb); continue; }
    const over = step(g, s.walls, nb, d);
    if (over >= 0 && !taken(over)) { out.add(over); continue; }
    // まっすぐ飛び越せないとき: その丸の左右（ななめ前）へ
    for (const d2 of d < 2 ? [2, 3] : [0, 1]) {
      const sd = step(g, s.walls, nb, d2);
      if (sd >= 0 && !taken(sd)) out.add(sd);
    }
  }
  return [...out];
}

// 重ならない・十字に交わらない場所か（道をふさぐかは見ない）
function wallFits(g, walls, w) {
  const { M } = g;
  if (w < 0 || w >= g.WALLS || walls[w]) return false;
  const o = w >= M * M ? 1 : 0;
  const k = w - o * M * M;
  const r = Math.floor(k / M);
  const c = k % M;
  if (o === 0) return !(c > 0 && walls[w - 1]) && !(c < M - 1 && walls[w + 1]) && !walls[M * M + k];
  return !(r > 0 && walls[w - M]) && !(r < M - 1 && walls[w + M]) && !walls[k];
}
// どの人にもゴールへの道が残るか
function allReach(s, walls) {
  const g = geo(s.n);
  return s.sides.every((side, q) => distOf(g, walls, side, s.pos[q]) < Infinity);
}
// 壁を置けない理由（置けるなら null）
function wallProblem(s, p, w) {
  const g = geo(s.n);
  if (!(s.left[p] > 0)) return 'none';
  if (!wallFits(g, s.walls, w)) return 'overlap';
  const walls = s.walls.slice();
  walls[w] = p + 1;
  return allReach(s, walls) ? null : 'block';
}

function hasAnyMove(s, p) {
  if (pawnMoves(s, p).length) return true;
  if (!(s.left[p] > 0)) return false;
  for (let w = 0; w < geo(s.n).WALLS; w++) if (!wallProblem(s, p, w)) return true;
  return false;
}

// 3〜4人の順位: ゴールした人が1位、ほかはゴールまでの近さの順
function placeOf(s, winner) {
  const g = geo(s.n);
  const d = s.sides.map((side, q) => (q === winner ? -1 : distOf(g, s.walls, side, s.pos[q])));
  return d.map((v) => 1 + d.filter((x) => x < v).length);
}

/* ---------- CPU ---------- */

// 局面 s の、p から見た点数（大きいほど p が有利）。一番近いほかの人との道のりの差に、このまま走り合えば先に着くか（番の人は同じ道のりなら先に着く）を足す。
// 走り合いの分が無いと、壁で相手を1マス遠ざけるより自分が1マス進む方がいつも得に見えて、よわい・ふつうが壁を1枚も置かなかった。壁の残りも少し見る
function evalFor(s, p) {
  const g = geo(s.n);
  const d = s.sides.map((side, q) => distOf(g, s.walls, side, s.pos[q]));
  const near = Math.min(...d.filter((_, q) => q !== p));
  const ahead = s.turn === p ? d[p] <= near : d[p] < near;
  return near - d[p] + (ahead ? 2 : 0) + 0.15 * s.left[p];
}

// 考える壁の候補: ほかの人の一番短い道をふさぐ壁だけ（全部を見ると重いため）
function wallCands(s, p) {
  if (!(s.left[p] > 0)) return [];
  const g = geo(s.n);
  const set = new Set();
  s.sides.forEach((side, q) => {
    if (q === p) return;
    const path = [];
    distOf(g, s.walls, side, s.pos[q], path);
    for (let i = path.length - 1; i > 0; i--) {
      const a = path[i];
      const b = path[i - 1];
      const d = b === a - g.N ? 0 : b === a + g.N ? 1 : b === a - 1 ? 2 : 3;
      for (const w of g.blockers[a * 4 + d]) set.add(w);
    }
  });
  return [...set].filter((w) => !wallProblem(s, p, w));
}

// 1手当てた局面（反則は null）
function tryMove(game, s, m) {
  try { return game.apply(s, m); } catch { return null; }
}

export function kabeCpu(game, s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const p = s.turn;
  const g = geo(s.n);
  const pawns = pawnMoves(s, p);
  // そのまま勝てるなら勝つ
  for (const t of pawns) if (atGoal(s.sides[p], s.n, t)) return t;
  const mistake = { weak: 0.3, normal: s.np === 2 ? 0.3 : 0.1, strong: 0 }[level]; // ふつうの2人は相手の返しを読むので、適当に動く割合を多くしてつよいとの差を付ける
  if (pawns.length && Math.random() < mistake) return pawns[Math.floor(Math.random() * pawns.length)];
  // 3〜4人（ふつう・つよい）: 自分より先に着きそうな人がゴールの近く（ふつうは2マス・つよいは4マス以内）まで来たら、その人を一番遠ざける壁を置く。
  // 1手先の点数だけでは、壁1枚で1マス遠ざけるより自分が進む方が得に見えて、壁を使わなかったため
  if (s.np > 2 && level !== 'weak' && s.left[p] > 0) {
    const d = s.sides.map((side, q) => distOf(g, s.walls, side, s.pos[q]));
    let lead = -1;
    for (let k = 1; k < s.np; k++) { const q = (p + k) % s.np; if (lead < 0 || d[q] < d[lead]) lead = q; } // 同じ道のりなら先に番が来る人
    if (d[lead] < d[p] && d[lead] <= (level === 'strong' ? 4 : 3)) {
      let best = 0;
      let pick = null;
      for (const w of wallCands(s, p)) {
        const walls = s.walls.slice();
        walls[w] = p + 1;
        const gain = distOf(g, walls, s.sides[lead], s.pos[lead]) - d[lead] - 0.5 * (distOf(g, walls, s.sides[p], s.pos[p]) - d[p]);
        if (gain > best) { best = gain; pick = w; }
      }
      if (pick !== null) return g.CELLS + pick;
    }
  }
  let cands = [...pawns];
  // よわいは壁を考えるのが半分だけ
  if (level !== 'weak' || Math.random() < 0.5) cands.push(...wallCands(s, p).map((w) => g.CELLS + w));
  if (!cands.length) {
    for (let w = 0; w < g.WALLS; w++) if (!wallProblem(s, p, w)) return g.CELLS + w;
    return null;
  }
  const value = (child) => {
    const r = game.result(child);
    if (r) return r.winner === p ? 1e6 : r.winner === null ? 0 : -1e6;
    if (level === 'weak' || s.np !== 2) return evalFor(child, p);
    // ふつう・つよい（2人）: 相手の一番よい返し（丸の動き・相手の道をふさぐ壁）を1手読む
    const q = child.turn;
    let worst = Infinity;
    const replies = [...pawnMoves(child, q), ...wallCands(child, q).map((w) => g.CELLS + w)];
    for (const m of replies) {
      const nx = tryMove(game, child, m);
      if (!nx) continue;
      const rr = game.result(nx);
      const v = rr ? (rr.winner === p ? 1e6 : -1e6) : evalFor(nx, p);
      if (v < worst) worst = v;
    }
    return worst === Infinity ? evalFor(child, p) : worst;
  };
  let best = -Infinity;
  let top = [];
  for (const m of cands) {
    const child = tryMove(game, s, m);
    if (!child) continue;
    const v = value(child) + (m < g.CELLS ? 0.01 : 0); // 同じ点なら壁を取っておく
    if (v > best + 1e-9) { best = v; top = [m]; } else if (Math.abs(v - best) <= 1e-9) top.push(m);
  }
  return top.length ? top[Math.floor(Math.random() * top.length)] : cands[0];
}

/* ---------- 描く ---------- */

// 盤の向き: 下に来る人の辺が下になるよう回す。y・x は盤の左上を (0,0)、右下を (N,N) とした位置（マスの中心は +0.5）
const ROT = { B: 0, T: 180, R: 'cw', L: 'ccw' };
function toDisp(rot, N, y, x) {
  if (rot === 180) return [N - y, N - x];
  if (rot === 'cw') return [x, N - y];
  if (rot === 'ccw') return [N - x, y];
  return [y, x];
}
function fromDisp(rot, N, y, x) {
  if (rot === 180) return [N - y, N - x];
  if (rot === 'cw') return [N - x, y];
  if (rot === 'ccw') return [x, N - y];
  return [y, x];
}

let ui = { key: null, mode: 'move', ghost: null }; // 動く／壁を置く・置こうとしている壁（通信で描き直されても消えないよう外に持つ）

const PROBLEM = { overlap: 'ほかの壁と重なるので置けない', block: '道を全部ふさぐので置けない', none: '壁が残っていない' };

export default {
  id: 'kabe',
  name: 'かべ置きレース',
  icon: '🧱',
  flip: true, // 盤の向きを変える（⇅）ボタンを出す（main.js）
  keepColor: true,
  desc: '自分の丸を向かい側の辺まで先に運んだ人の勝ち。番が来たら、1マス動くか、壁を置いて相手の道をじゃまするか',
  ready: true,
  players: ['赤', '青', '緑', '紫'],
  seatCount(rules) { return [3, 4].includes(rules?.players) ? rules.players : 2; },
  settings: [
    { key: 'players', label: '人数', def: 2, desc: '3人は下・右・左、4人は4つの辺から始めて、それぞれ向かいの辺をめざす。壁は人数で分ける', choices: [[2, '2人'], [3, '3人'], [4, '4人']] },
    { key: 'size', label: '盤の大きさ', def: 9, desc: '7×7 は壁が少なく、早く終わる', choices: [[9, '9×9'], [7, '7×7（短い）']] },
    { key: 'wall', label: '壁の数', def: 'mid', desc: '1人が置ける壁の数。少なめは半分、多めは1.5倍（9×9 の2人なら 5枚・10枚・15枚）', choices: [['few', '少なめ'], ['mid', 'ふつう'], ['many', '多め']] },
    CPU_SETTING,
  ],

  cpu(s, p, rules) { return kabeCpu(this, s, rules); },

  init({ rules = {} } = {}) {
    const n = rules.size === 7 ? 7 : 9;
    const np = [3, 4].includes(rules.players) ? rules.players : 2;
    const sides = SIDES[np];
    return {
      n, np, sides, pos: sides.map((side) => startOf(side, n)), walls: Array(geo(n).WALLS).fill(0),
      left: Array(np).fill(wallsOf(n, np, rules.wall)), turn: 0, ply: 0, last: null, won: null, skipped: [],
    };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    const g = geo(s.n);
    if (s.won || !Number.isInteger(m) || m < 0 || m >= g.CELLS + g.WALLS) return null;
    const p = s.turn;
    let pos = s.pos;
    let walls = s.walls;
    let left = s.left;
    let last;
    let won = null;
    if (m < g.CELLS) {
      if (!pawnMoves(s, p).includes(m)) return null;
      pos = s.pos.slice();
      pos[p] = m;
      last = { p, f: s.pos[p], t: m };
      if (atGoal(s.sides[p], s.n, m)) won = { winner: p };
    } else {
      const w = m - g.CELLS;
      if (wallProblem(s, p, w)) return null;
      walls = s.walls.slice();
      walls[w] = p + 1;
      left = s.left.slice();
      left[p]--;
      last = { p, w };
    }
    const ply = s.ply + 1;
    const next = { ...s, pos, walls, left, last, ply, won, skipped: [] };
    if (won) {
      if (s.np > 2) won.place = placeOf(next, p);
      return next;
    }
    // 次の番（3〜4人で、動かせる先も置ける壁も無い人は飛ばす）
    let turn = (p + 1) % s.np;
    for (let k = 0; k < s.np - 1 && !hasAnyMove({ ...next, turn }, turn); k++) {
      next.skipped.push(turn);
      turn = (turn + 1) % s.np;
    }
    next.turn = turn;
    if (ply >= MAX_PLY[s.np]) next.won = { winner: null, long: true };
    return next;
  },

  result(s) { return s.won ? { ...s.won, cells: [] } : null; },

  sound(a, b) { return b.last && Number.isInteger(b.last.w) ? 'wall' : 'place'; },

  info(s) {
    const g = geo(s.n);
    const name = (q) => `<b class="pl p${col(q)}">${this.players[col(q)]}</b>`;
    let html = `のこりの壁　${s.left.map((k, q) => `${name(q)} ${k}`).join('　')}`;
    // 壁の効き目（2026-11-25 の UI・UX の12回目。本人が選んだ案）: 直前の手が壁で、その壁のせいでゴールまでが遠くなった人は、
    // 数字が前の数から数え上がり、横に「+2」が出る（次の手まで）。数え上がりは style.css の .kw-up（数は ::after に出すので、読み上げ用に aria-label を付ける）
    let before = null;
    if (Number.isInteger(s.last?.w)) { before = s.walls.slice(); before[s.last.w] = 0; }
    html += `<br>ゴールまで　${s.sides.map((side, q) => {
      const d = distOf(g, s.walls, side, s.pos[q]);
      const was = before ? distOf(g, before, side, s.pos[q]) : d;
      return d > was ? `${name(q)} <span class="kw-up" style="--from:${was};--to:${d}" aria-label="${d}"></span><b class="kw-plus">+${d - was}</b>` : `${name(q)} ${d}`;
    }).join('　')}`;
    for (const q of s.skipped ?? []) html += `<br>${name(q)}は動けないので飛ばし`;
    if (s.won?.long) html += `<br>${MAX_PLY[s.np]}手になったので引き分け`;
    return html;
  },

  render(root, s, o) {
    const g = geo(s.n);
    const { N, M, CELLS } = g;
    const draw = () => this.render(root, s, o);
    const bottom = Number.isInteger(o.view) ? o.view : Number.isInteger(o.me) && o.me >= 0 && o.me < s.np ? o.me : 0; // 自分の辺が下に来るように（観戦と同じ画面の対局では1番手が下。⇅ を押したときは o.view の人）
    const rot = ROT[s.sides[bottom]];
    const key = `${s.n}:${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, mode: 'move', ghost: null };
    const over = !!s.won || s.gave !== undefined; // 参りました（util.js の withGiveUp）も終わり
    const can = o.canMove && !over;
    const p = s.turn;
    if (!can || !(s.left[p] > 0)) ui.mode = 'move';
    const targets = new Set(can && ui.mode === 'move' ? pawnMoves(s, p) : []);

    root.innerHTML = '';
    root.className = 'board kw';
    root.style.setProperty('--n', N);

    // 動く／壁を置く の切り替え（自分の番だけ）
    if (can) {
      const bar = document.createElement('div');
      bar.className = 'kw-bar';
      const tab = (mode, text, disabled) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn kw-tab ' + (ui.mode === mode ? 'primary' : 'secondary');
        b.textContent = text;
        b.disabled = !!disabled;
        b.setAttribute('aria-pressed', String(ui.mode === mode));
        b.onclick = () => { ui = { ...ui, mode, ghost: null }; draw(); };
        return b;
      };
      bar.append(tab('move', '● 動く'), tab('wall', `🧱 壁を置く（のこり ${s.left[p]}）`, !(s.left[p] > 0)));
      root.append(bar);
    }

    const frame = document.createElement('div');
    frame.className = 'kw-frame';
    const grid = document.createElement('div');
    grid.className = 'kw-grid' + (can && ui.mode === 'wall' ? ' walling' : '');

    // ゴールの辺に、その辺をめざす人の色の帯
    s.sides.forEach((side, q) => {
      const goal = { B: [0, N / 2], T: [N, N / 2], R: [N / 2, 0], L: [N / 2, N] }[side];
      const [y, x] = toDisp(rot, N, ...goal);
      const edge = y === 0 ? 'top' : y === N ? 'bottom' : x === 0 ? 'left' : 'right';
      const strip = document.createElement('div');
      strip.className = `kw-goal ${edge} p${col(q)}`;
      frame.append(strip);
    });

    // マス（見た目の並びで作り、盤のマスに直す）
    for (let R = 0; R < N; R++) {
      for (let C = 0; C < N; C++) {
        const [y, x] = fromDisp(rot, N, R + 0.5, C + 0.5);
        const i = Math.floor(y) * N + Math.floor(x);
        const isTarget = targets.has(i);
        const cell = document.createElement(isTarget ? 'button' : 'div');
        cell.className = 'kw-cell';
        if (s.last && (s.last.t === i || s.last.f === i)) cell.classList.add('last');
        if (isTarget) {
          cell.type = 'button';
          cell.classList.add('target');
          cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${i % N + 1}列目へ動く`);
          cell.onclick = () => { ui = { ...ui, ghost: null }; o.onMove(i); };
        }
        const q = s.pos.indexOf(i);
        if (q >= 0) {
          const pawn = document.createElement('span');
          pawn.className = `kw-pawn p${col(q)}` + (q === p && !over ? ' turn' : '');
          pawn.dataset.fly = `kw:${q}`; // 動いた丸は前のマスから滑ってくる（main.js の flyPlay）
          pawn.dataset.flySlide = '';
          if (s.won && s.won.winner === q) cell.dataset.last = 'still';
          cell.append(pawn);
        }
        grid.append(cell);
      }
    }

    // 壁（置いた壁・置こうとしている壁）
    const wallEl = (w, cls) => {
      const or = w >= M * M ? 1 : 0;
      const k = w - or * M * M;
      const [Y, X] = toDisp(rot, N, Math.floor(k / M) + 1, (k % M) + 1);
      const horiz = (or === 0) === (rot === 0 || rot === 180);
      const e = document.createElement('div');
      e.className = 'kw-wall ' + (horiz ? 'h ' : 'v ') + cls;
      // マスの間にはすき間（--kg）があるので、k 本目の線の位置は k*(100%+すき間)/N − すき間/2。壁は2マスとその間のすき間の長さ
      const at = (k) => `calc(${k} * (100% + var(--kg)) / ${N} - var(--kg) / 2)`;
      const from = (k) => `calc(${k} * (100% + var(--kg)) / ${N})`;
      const len = `calc(2 * (100% + var(--kg)) / ${N} - var(--kg))`;
      if (horiz) Object.assign(e.style, { left: from(X - 1), width: len, top: at(Y) });
      else Object.assign(e.style, { top: from(Y - 1), height: len, left: at(X) });
      return e;
    };
    for (let w = 0; w < g.WALLS; w++) {
      if (!s.walls[w]) continue;
      const e = wallEl(w, `p${col(s.walls[w] - 1)}`);
      if (s.last?.w === w) {
        e.classList.add('new');
        e.dataset.fly = `kww:${w}`; // 置いた壁は置いた人の丸から飛んでくる
        e.dataset.flyFrom = `kw:${s.last.p}`;
        e.dataset.flyBase = e.classList.contains('h') ? 'translateY(-50%)' : 'translateX(-50%)'; // 動きの間も真ん中寄せを消さない
      }
      grid.append(e);
    }
    const problem = ui.ghost === null ? null : wallProblem(s, p, ui.ghost);
    if (ui.ghost !== null) grid.append(wallEl(ui.ghost, `ghost p${col(p)}` + (problem ? ' ng' : '')));

    // 壁を置く: 押した所から一番近いマスの間の線を選ぶ（同じ所をもう一度押すと置く）
    if (can && ui.mode === 'wall') {
      grid.onclick = (ev) => {
        const b = grid.getBoundingClientRect();
        if (!b.width) return;
        const kg = parseFloat(getComputedStyle(grid).getPropertyValue('--kg')) || 0; // マスの間のすき間（px）
        const [y, x] = fromDisp(rot, N, ((ev.clientY - b.top + kg / 2) / (b.height + kg)) * N, ((ev.clientX - b.left + kg / 2) / (b.width + kg)) * N);
        const R = Math.min(N - 1, Math.max(1, Math.round(y)));
        const C = Math.min(N - 1, Math.max(1, Math.round(x)));
        const w = (Math.abs(y - R) <= Math.abs(x - C) ? 0 : M * M) + (R - 1) * M + (C - 1);
        if (w === ui.ghost && !wallProblem(s, p, w)) { ui = { ...ui, ghost: null }; o.onMove(CELLS + w); return; }
        ui = { ...ui, ghost: w };
        draw();
      };
    }
    frame.append(grid);
    root.append(frame);

    // 置こうとしている壁の向きを変える・置く
    if (can && ui.mode === 'wall' && ui.ghost !== null) {
      const row = document.createElement('div');
      row.className = 'kw-bar';
      const turnBtn = document.createElement('button');
      turnBtn.type = 'button';
      turnBtn.className = 'btn secondary';
      turnBtn.textContent = '↻ 向きを変える';
      turnBtn.onclick = () => { ui = { ...ui, ghost: (ui.ghost + M * M) % (2 * M * M) }; draw(); };
      const put = document.createElement('button');
      put.type = 'button';
      put.className = 'btn primary';
      put.textContent = problem ? PROBLEM[problem] : 'ここに置く';
      put.disabled = !!problem;
      put.onclick = () => { const w = ui.ghost; ui = { ...ui, ghost: null }; o.onMove(CELLS + w); };
      row.append(turnBtn, put);
      root.append(row);
    }
  },
};
