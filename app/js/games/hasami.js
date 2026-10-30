// はさみ将棋。2人。9×9 の盤で、先手（歩）は一番下の段に、後手（と）は一番上の段に9個ずつ並べて始める（先手から）。
// 駒は飛車と同じく、たて・よこに何マスでも動ける（ほかの駒は飛び越えられない。ななめは無し）。
// 動かした駒と自分の別の駒で、相手の駒をたて・よこにはさむと取れる（一列に並んだ何個でもまとめて。2026-10-06 本人承認）。
// 相手の駒を5個取ったら勝ち。詳細設定で「全部取ったら勝ち」も選べる（2026-10-06 本人の決定）。
// Claude の判断: 自分から相手の駒の間に入っても取られない。隅の駒は、となりの2マスをふさげば取れる。
//   動かせる駒が無くなった人の負け。同じ局面（次の番も同じ）が3回出たら引き分け、300手でも引き分け。
// 詳細設定「盤の大きさ」（2026-10-07 の11回目）: 9×9（最初）か 7×7。7×7 は手前の1段に7個ずつ並べ、「5個取ったら勝ち」は4個・「全部」は7個になる。
//   一辺は局面の n。どちらの盤でも決まり（隅の取り方・同じ局面3回・300手）は同じ。
// 手 = 動かす駒のマス * マスの数 + 行き先のマス（マス = 段*一辺+列。段0が一番上）。9×9 なら * 81 で、前と全く同じ。
// 詳細設定「人数」（2026-10-30 本人の決定。どれも Claude の推奨を本人が承認）: 2人（最初）・3人。3人は今の四角い盤のまま、
//   1番目は下の辺・2番目は右の辺・3番目は左の辺に、角を空けて1列ずつ並べる（9×9 は7個ずつ・7×7 は5個ずつ。上の辺は空き）。
//   自分の駒2つでほかの人の駒をはさむと取れ、決めた個数（9×9 は5個・7×7 は4個）を取った人の勝ち。
// Claude の判断（3人）: はさむ列は、ほかの2人の駒が混ざっていてもまとめて取れる（隅の駒も同じ）。順番は 下 → 右 → 左（自分から見て右どなりが次の人）。
//   駒を全部取られた人・自分の番に動かせる駒が無い人は脱落し、その人の駒は盤から消える（取った数には入らない）。最後に残った人も勝ち。
//   詳細設定「勝ち」の「全部」は、3人では最後まで残った人の勝ち（局面の goal が null）。
//   同じ局面（次の番も同じ）3回か 450手で引き分け（3人将棋と同じ手数）。3人の局面の目印は盤を文字にしたもの（3人の CPU は読まないので軽い）。
//   駒は 1番目「歩」・2番目「と」（赤）・3番目「金」（緑）。それぞれ自分の辺から盤の奥を向く。盤は自分の辺が下に来るように回して見せる。
//   3人の CPU は読みをせず、取れる数・動いたあとにほかの人に取られる自分の駒の数で選ぶ（hasami3Cpu）。結果には順位（place）を付ける。
//   2人のときの局面と手は前と全く同じ形（3人のときだけ np: 3）。

import { CPU_SETTING, boardCpu, mulberry32 } from './util.js';

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const MAX_PLY = 300;
const NAMES = ['歩', 'と', '金'];
const MAX_PLY3 = 450;
const GOAL = { 9: 5, 7: 4 }; // 「少なめ」で何個取ったら勝ちか（盤の一辺ごと）

// 盤の一辺ごとの形（マスの数・隅とそのとなりの2マス）。作るのは1回だけ
const GEO = {};
function geo(N) {
  if (GEO[N]) return GEO[N];
  const CELLS = N * N;
  const CORNERS = [[0, [1, N]], [N - 1, [N - 2, 2 * N - 1]], [N * (N - 1), [N * (N - 2), N * (N - 1) + 1]], [CELLS - 1, [CELLS - 2, CELLS - 1 - N]]];
  return (GEO[N] = { N, CELLS, CORNERS });
}
const sideOf = (board) => Math.round(Math.sqrt(board.length));

function movesOf(board, p) {
  const { N, CELLS } = geo(sideOf(board));
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const list = [];
  for (let f = 0; f < CELLS; f++) {
    if (board[f] !== p) continue;
    const r0 = Math.floor(f / N);
    const c0 = f % N;
    for (const [dr, dc] of DIRS) {
      let r = r0 + dr;
      let c = c0 + dc;
      while (inside(r, c) && board[r * N + c] === null) {
        list.push(f * CELLS + r * N + c);
        r += dr;
        c += dc;
      }
    }
  }
  return list;
}

// p に動かせる駒が1つでもあるか（movesOf より速い。apply が毎回使う）
function canMoveAny(board, p) {
  const { N, CELLS } = geo(sideOf(board));
  for (let f = 0; f < CELLS; f++) {
    if (board[f] !== p) continue;
    const r = Math.floor(f / N);
    const c = f % N;
    if ((r > 0 && board[f - N] === null) || (r < N - 1 && board[f + N] === null) || (c > 0 && board[f - 1] === null) || (c < N - 1 && board[f + 1] === null)) return true;
  }
  return false;
}

// t に p の駒が来たときに取れる相手の駒
function capturesAt(board, t, p) {
  const { N, CORNERS } = geo(sideOf(board));
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const foe = (v) => v !== null && v !== p; // ほかの人の駒（2人なら相手、3人ならほかの2人のどちらでも）
  const out = [];
  const r0 = Math.floor(t / N);
  const c0 = t % N;
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (inside(r, c) && foe(board[r * N + c])) {
      line.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (line.length && inside(r, c) && board[r * N + c] === p) out.push(...line);
  }
  for (const [corner, sides] of CORNERS) {
    if (foe(board[corner]) && sides.includes(t) && sides.every((x) => board[x] === p) && !out.includes(corner)) out.push(corner);
  }
  return out;
}

// 局面の目印（ゾブリストハッシュ: マスと駒ごとに決めた乱数を XOR で重ねた32ビットの数を2つ）。決まった種から作るので全員同じ。
// 盤を文字にして比べると、CPU の読みで1手に1秒かかった。動いた駒と取った駒の分だけ足し引きして作る。
// 乱数の表は 9×9 の大きさで作り、7×7 はその前の方を使う（9×9 の目印は前と全く同じ）
const BIG = 81;
const rnd = mulberry32(0x5a17);
const ZA = Array.from({ length: 2 * BIG + 1 }, () => Math.floor(rnd() * 2 ** 32));
const ZB = Array.from({ length: 2 * BIG + 1 }, () => Math.floor(rnd() * 2 ** 32));
const zi = (p, i, cells) => p * cells + i;
const TURN = 2 * BIG; // 後手の番

export function hashOf(board, turn) {
  const cells = board.length;
  let a = turn ? ZA[TURN] : 0;
  let b = turn ? ZB[TURN] : 0;
  board.forEach((v, i) => { if (v !== null) { a ^= ZA[zi(v, i, cells)]; b ^= ZB[zi(v, i, cells)]; } });
  return [a >>> 0, b >>> 0];
}

// 同じ局面が何回目か。駒を取ると同じ局面には戻れないので、最後に取った所までさかのぼれば足りる
function seenCount(hist, a, b) {
  let n = 0;
  for (let h = hist; h; h = h.cap ? null : h.prev) if (h.a === a && h.b === b) n++;
  return n;
}

// CPU の形勢判断: 取った数の差だけ（動ける数も見ると、つよいの1手が PC で2秒を超えたため外した）
function score(s, p) {
  return s.taken[p] - s.taken[1 - p];
}

/* ---------- 3人 ---------- */

// 最初の盤: 1番目は下の辺・2番目は右の辺・3番目は左の辺（どれも角を空ける）
function board3(N) {
  const board = Array(N * N).fill(null);
  for (let k = 1; k < N - 1; k++) {
    board[(N - 1) * N + k] = 0;
    board[k * N + N - 1] = 1;
    board[k * N] = 2;
  }
  return board;
}
const key3 = (board, turn) => board.map((v) => (v === null ? '.' : v)).join('') + turn;
function seen3(hist, key) {
  let n = 0;
  for (let h = hist; h; h = h.cap ? null : h.prev) if (h.key === key) n++;
  return n;
}

// 順位（1 が一番上）: 勝った人 → 残っている人（取った数の多い順）→ 脱落した人（あとまで残った順）
function place3(winner, alive, taken, out) {
  const st = [0, 1, 2].map((q) => (q === winner ? 1000 : alive[q] ? 100 + taken[q] : out.findIndex((o) => o.p === q)));
  return st.map((v) => 1 + st.filter((x) => x > v).length);
}

function apply3(s, m) {
  const { N, CELLS } = geo(s.n);
  if (s.won || !Number.isInteger(m) || m < 0 || m >= CELLS * CELLS) return null;
  const f = Math.floor(m / CELLS);
  const t = m % CELLS;
  if (s.board[f] !== s.turn || s.board[t] !== null) return null;
  const [fr, fc, tr, tc] = [Math.floor(f / N), f % N, Math.floor(t / N), t % N];
  if (fr !== tr && fc !== tc) return null;
  const dr = Math.sign(tr - fr);
  const dc = Math.sign(tc - fc);
  for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) if (s.board[r * N + c] !== null) return null;
  const p = s.turn;
  const board = s.board.slice();
  board[f] = null;
  board[t] = p;
  const cap = capturesAt(board, t, p);
  for (const i of cap) board[i] = null;
  const taken = s.taken.slice();
  taken[p] += cap.length;
  const alive = s.alive.slice();
  const out = s.out.slice();
  const drop = (q, why) => {
    alive[q] = false;
    out.push({ p: q, why });
    for (let i = 0; i < CELLS; i++) if (board[i] === q) board[i] = null;
  };
  for (let q = 0; q < 3; q++) if (alive[q] && q !== p && !board.includes(q)) drop(q, 'gone');
  const ply = s.ply + 1;
  const left = () => alive.filter(Boolean).length;
  let won = null;
  let turn = p;
  if (s.goal && taken[p] >= s.goal) won = { winner: p };
  else {
    // 次の番: 脱落していない人を順に。動かせる駒が無い人は脱落
    for (let d = 1; d <= 2 && left() > 1; d++) {
      const q = (p + d) % 3;
      if (!alive[q]) continue;
      if (!canMoveAny(board, q)) { drop(q, 'stuck'); continue; }
      turn = q;
      break;
    }
    if (left() === 1) won = { winner: alive.indexOf(true) };
  }
  const key = key3(board, turn);
  const hist = { key, prev: s.hist, cap: cap.length > 0 || out.length > s.out.length };
  if (!won && seen3(hist, key) >= 3) won = { winner: null, repeat: true };
  else if (!won && ply >= MAX_PLY3) won = { winner: null, long: true };
  if (won && won.winner !== null) won.place = place3(won.winner, alive, taken, out);
  return { ...s, board, turn, taken, alive, out, last: { f, t, cap }, ply, won, hist };
}

// CPU（3人。よわい・ふつう・つよい）。読みはせず、手ごとの点数で選ぶ:
//   取れる駒の数（決めた個数に届くなら必ず）− 動いたあとに、ほかの人に次に取られる自分の駒の数（ふつうは次の人だけ・つよいは2人とも）。
//   つよいは、次の自分の番に取れそうな駒の数も少し足す。よわい: 35% は適当・取られる駒は見ない。ふつう: 1割は適当
function hasami3Cpu(s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const { CELLS } = geo(s.n);
  const p = s.turn;
  const moves = movesOf(s.board, p);
  if (Math.random() < { weak: 0.35, normal: 0.1, strong: 0 }[level]) return moves[Math.floor(Math.random() * moves.length)];
  const foes = [1, 2].map((d) => (p + d) % 3).filter((q) => s.alive[q]);
  // 盤 b で q が次に動いたときに取れる駒のマスの集まり（who を渡せばその人の駒だけ）
  const reach = (b, q, who) => {
    const set = new Set();
    for (const mv of movesOf(b, q)) {
      const f = Math.floor(mv / CELLS);
      const t = mv % CELLS;
      const nb = b.slice();
      nb[f] = null;
      nb[t] = q;
      for (const i of capturesAt(nb, t, q)) if (who === undefined || b[i] === who) set.add(i);
    }
    return set;
  };
  let best = -Infinity;
  let top = moves[0];
  for (const mv of moves) {
    const f = Math.floor(mv / CELLS);
    const t = mv % CELLS;
    const b = s.board.slice();
    b[f] = null;
    b[t] = p;
    const cap = capturesAt(b, t, p);
    for (const i of cap) b[i] = null;
    let v = cap.length * 10 + Math.random();
    if (s.goal && s.taken[p] + cap.length >= s.goal) v += 1e6;
    if (level !== 'weak') {
      const lost = new Set();
      for (const q of level === 'strong' ? foes : foes.slice(0, 1)) for (const i of reach(b, q, p)) lost.add(i);
      v -= lost.size * 8;
    }
    if (level === 'strong') v += reach(b, p).size * 1.5;
    if (v > best) { best = v; top = mv; }
  }
  return top;
}

let ui = { key: null, from: null }; // 選んでいる駒（通信で描き直されても消えないよう外に持つ）

export default {
  id: 'hasami',
  name: 'はさみ将棋',
  icon: '⚔️',
  flip: true, // 盤の向きを変える（⇅）ボタンを出す（main.js）
  desc: '飛車のように動く駒で、相手の駒をたて・よこにはさんで取る。先に5個（7×7 は4個）取った方の勝ち。オンラインでは3人でも遊べる',
  ready: true,
  players: ['先手（歩）', '後手（と）', '三番手（金）'],
  // 詳細設定の人数（2〜3人）。待合室の席の数になる
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  settings: [
    { key: 'players', label: '人数', def: 2, desc: '3人では、下・右・左の辺に1列ずつ並べる（角と上の辺は空き）。自分の駒2つでほかの人の駒をはさむと取れる', choices: [[2, '2人'], [3, '3人']] },
    { key: 'size', label: '盤の大きさ', desc: '7×7 は駒が7個ずつで、早く終わる', def: 9, choices: [[9, '9×9'], [7, '7×7（駒7個ずつ・短い）']] },
    // 値（5・'all'）は前のまま（前の部屋の設定がそのまま使えるように）。盤で個数が変わるので表示に両方書く
    { key: 'goal', label: '勝ち', desc: '何個取ったら勝ちか。「全部」は長くなる', def: 5, choices: [[5, '5個取ったら勝ち（7×7 は4個）'], ['all', '全部（9個）取ったら勝ち（7×7 は7個。3人は最後まで残った人の勝ち）']] },
    CPU_SETTING,
  ],

  // CPU: 何手先まで読むかで強さを変える（よわい1・ふつう2・つよい3）。弱いほど適当に打つことがある
  cpu(s, p, rules) {
    if (s.np === 3) return hasami3Cpu(s, rules);
    return boardCpu(this, s, rules, (x) => movesOf(x.board, x.turn), score, {
      depth: { weak: 1, normal: 2, strong: 3 }, mistake: { weak: 0.35, normal: 0.1, strong: 0 },
    });
  },

  init({ rules = {} } = {}) {
    const N = rules.size === 7 ? 7 : 9;
    if (rules.players === 3) {
      const board = board3(N);
      return { n: N, np: 3, board, goal: rules.goal === 'all' ? null : GOAL[N], turn: 0, taken: [0, 0, 0], alive: [true, true, true], out: [], last: null, ply: 0, won: null, hist: { key: key3(board, 0), prev: null, cap: true } };
    }
    const board = Array(N * N).fill(null);
    for (let c = 0; c < N; c++) { board[c] = 1; board[(N - 1) * N + c] = 0; }
    return { n: N, board, goal: rules.goal === 'all' ? N : GOAL[N], turn: 0, taken: [0, 0], last: null, ply: 0, won: null, hist: (([a, b]) => ({ a, b, prev: null, cap: true }))(hashOf(board, 0)) };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.np === 3) return apply3(s, m);
    const { N, CELLS } = geo(s.n ?? 9);
    if (s.won || !Number.isInteger(m) || m < 0 || m >= CELLS * CELLS) return null;
    const f = Math.floor(m / CELLS);
    const t = m % CELLS;
    if (s.board[f] !== s.turn || s.board[t] !== null) return null;
    const [fr, fc, tr, tc] = [Math.floor(f / N), f % N, Math.floor(t / N), t % N];
    if (fr !== tr && fc !== tc) return null;
    const dr = Math.sign(tr - fr);
    const dc = Math.sign(tc - fc);
    for (let r = fr + dr, c = fc + dc; r !== tr || c !== tc; r += dr, c += dc) if (s.board[r * N + c] !== null) return null;
    const p = s.turn;
    const board = s.board.slice();
    board[f] = null;
    board[t] = p;
    const cap = capturesAt(board, t, p);
    for (const i of cap) board[i] = null;
    const taken = s.taken.slice();
    taken[p] += cap.length;
    const turn = 1 - p;
    let a = s.hist.a ^ ZA[zi(p, f, CELLS)] ^ ZA[zi(p, t, CELLS)] ^ ZA[TURN];
    let b = s.hist.b ^ ZB[zi(p, f, CELLS)] ^ ZB[zi(p, t, CELLS)] ^ ZB[TURN];
    for (const i of cap) { a ^= ZA[zi(1 - p, i, CELLS)]; b ^= ZB[zi(1 - p, i, CELLS)]; }
    const hist = { a: a >>> 0, b: b >>> 0, prev: s.hist, cap: cap.length > 0 };
    const ply = s.ply + 1;
    let won = null;
    if (taken[p] >= s.goal) won = { winner: p };
    else if (!canMoveAny(board, turn)) won = { winner: p, stuck: true };
    else if (seenCount(hist, hist.a, hist.b) >= 3) won = { winner: null, repeat: true };
    else if (ply >= MAX_PLY) won = { winner: null, long: true };
    return { ...s, board, turn, taken, last: { f, t, cap }, ply, won, hist };
  },

  result(s) { return s.won ? { ...s.won, cells: [] } : null; },

  sound(a, b) { return b.last?.cap?.length ? 'punch' : 'place'; },

  info(s) {
    if (s.np === 3) {
      let html = `取った数　${s.taken.map((k, q) => `<b${s.alive[q] ? '' : ' style="opacity:.5"'}>${NAMES[q]} ${k}</b>`).join('　−　')}（${s.goal ? `${s.goal}個で勝ち` : '最後まで残った人の勝ち'}）`;
      for (const o of s.out) html += `<br>${this.players[o.p]}は${o.why === 'gone' ? '駒を全部取られて' : '動かせる駒が無くなって'}脱落`;
      if (s.won?.repeat) html += '<br>同じ局面が3回出たので引き分け';
      else if (s.won?.long) html += `<br>${MAX_PLY3}手になったので引き分け`;
      return html;
    }
    let html = `取った数　<b>歩 ${s.taken[0]}</b>　−　<b>と ${s.taken[1]}</b>（${s.goal}個で勝ち）`;
    if (s.won?.repeat) html += '<br>同じ局面が3回出たので引き分け';
    else if (s.won?.long) html += `<br>${MAX_PLY}手になったので引き分け`;
    else if (s.won?.stuck) html += `<br>${this.players[1 - s.won.winner]}は動かせる駒が無くなった`;
    return html;
  },

  render(root, s, o) {
    const { N, CELLS } = geo(s.n ?? 9);
    const draw = () => this.render(root, s, o);
    const three = s.np === 3;
    const bottom = Number.isInteger(o.view) ? o.view : three ? (Number.isInteger(o.me) && o.me >= 0 && o.me < 3 ? o.me : 0) : o.me === 1 ? 1 : 0; // 自分の駒が下に来るように。観戦と同じ画面の対局では先手が下。盤の向きを変えた（⇅）ときは o.view の人が下
    // 3人: 下に来る人の辺が下になるよう盤を回す（右の辺の人なら右回りに90度、左の辺の人なら左回りに90度）。駒はそれぞれ自分の辺から奥を向く
    const turnDeg = three ? [0, 90, -90][bottom] : 0;
    const cellAt = (k) => {
      const R = Math.floor(k / N);
      const C = k % N;
      if (!three) return bottom === 0 ? k : CELLS - 1 - k;
      if (turnDeg === 90) return (N - 1 - C) * N + R;
      if (turnDeg === -90) return C * N + (N - 1 - R);
      return k;
    };
    const key = `${s.n}:${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, from: null };
    const can = o.canMove && !s.won;
    const legal = can ? movesOf(s.board, s.turn) : [];
    const movable = new Set(legal.map((m) => Math.floor(m / CELLS)));
    const targets = new Set(ui.from === null ? [] : legal.filter((m) => Math.floor(m / CELLS) === ui.from).map((m) => m % CELLS));
    const caught = new Set(o.fresh && s.last ? s.last.cap : []);

    root.innerHTML = '';
    root.className = 'board sg hs';
    root.style.setProperty('--n', N);
    const grid = document.createElement('div');
    grid.className = 'sg-grid';
    for (let k = 0; k < CELLS; k++) {
      const i = cellAt(k);
      const v = s.board[i];
      const isTarget = targets.has(i);
      const isMovable = movable.has(i);
      const cell = document.createElement(isTarget || isMovable ? 'button' : 'div');
      cell.className = 'sg-cell';
      if (s.last && (s.last.t === i || s.last.f === i)) cell.classList.add('last');
      if (s.last?.t === i && o.fresh) cell.classList.add('pop');
      if (caught.has(i)) cell.classList.add('caught');
      if (i === ui.from) cell.classList.add('selected');
      if (isTarget) cell.classList.add('target');
      if (v !== null) {
        const piece = document.createElement('span');
        if (three) {
          const deg = (([0, -90, 90][v] + turnDeg + 540) % 360) - 180; // -180〜179
          piece.className = 'sg-piece' + (deg === -180 ? ' flip' : '') + (v === 1 ? ' promoted' : '') + (v === 2 ? ' hs-third' : '');
          if (deg === 90 || deg === -90) piece.style.transform = `rotate(${deg}deg)`;
        } else piece.className = 'sg-piece' + (v === bottom ? '' : ' flip') + (v === 1 ? ' promoted' : '');
        piece.textContent = NAMES[v];
        cell.append(piece);
      }
      if (isTarget || isMovable) {
        cell.type = 'button';
        cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${i % N + 1}列目`);
        cell.onclick = () => {
          if (isTarget) { const f = ui.from; ui = { ...ui, from: null }; o.onMove(f * CELLS + i); return; }
          ui = { ...ui, from: ui.from === i ? null : i };
          draw();
        };
      }
      grid.append(cell);
    }
    root.append(grid);
  },
};
