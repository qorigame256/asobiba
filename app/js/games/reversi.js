// リバーシ。8×8（2人のときは詳細設定「盤の大きさ」で 6×6・10×10 も。2026-10-06 本人の決定）。黒（プレイヤー0）が先手。
// 手 = マスの番号（段*大きさ+列。8×8 なら 0〜63）。
// 置ける場所が無い側は自動でパスになる。両方置けなくなったら終局。
// 詳細設定「人数」で3人・4人にもできる（2026-10-04 本人の決定。市販の「ローリット」に近い決まりを Claude が推し、本人が承認）:
//   黒・白・赤・青で順番に置く。はさむ石は相手なら誰の色でも（混ざっていても）よい。はさめる所があれば必ずそこに置き、
//   どこにも無いときはパスせず、石のとなり（ななめも含む）の空いたマスならどこにでも置ける。盤が埋まったら終わりで、
//   石がいちばん多い人の勝ち（いちばん多い人が2人以上なら引き分け）。

import { CPU_SETTING, boardCpu } from './util.js';

const N8 = 8; // 3〜4人はいつも 8×8
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// 盤の一辺（盤は正方形なので、マスの数から分かる）
const sizeOf = (board) => Math.round(Math.sqrt(board.length));

// 相手の石 = 空きでも自分でもない石（2人なら 1 - p と同じ）
function flipsFor(board, p, i) {
  if (board[i] !== null) return [];
  const N = sizeOf(board);
  const r0 = Math.floor(i / N);
  const c0 = i % N;
  const all = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] !== null && board[r * N + c] !== p) {
      line.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === p) all.push(...line);
  }
  return all;
}

function legalMoves(board, p) {
  const N = sizeOf(board);
  const list = [];
  for (let i = 0; i < N * N; i++) if (flipsFor(board, p, i).length) list.push(i);
  return list;
}

// 3人以上: はさめる所が無ければ、石のとなりの空いたマス
function nearMoves(board) {
  const N = sizeOf(board);
  const list = [];
  for (let i = 0; i < N * N; i++) {
    if (board[i] !== null) continue;
    const r0 = Math.floor(i / N);
    const c0 = i % N;
    if (DIRS.some(([dr, dc]) => {
      const r = r0 + dr;
      const c = c0 + dc;
      return r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] !== null;
    })) list.push(i);
  }
  return list;
}
function movesOf(s) {
  const list = legalMoves(s.board, s.turn);
  return list.length || s.n <= 2 ? list : nearMoves(s.board);
}

// 3人以上の最初の石（真ん中の4マス。番号はマス）。CPU（つよい）どうしで最初の1巡だけ適当に打たせ、各400〜600局で決めた（2026-10-04）:
// 盤が埋まるまで打つので、最後の1手を打つ人が有利になりやすく、どの並べ方でも席順の差は1割ほど残る（もう一回で順番が回るのでならされる）。
// 3人: 黒・白・赤の3つだけだと 黒47%・白19%・赤30% と偏ったので、赤を2つにした（25%・33%・39%）。石を5〜6個にしても差は縮まらなかった。
// 4人: 1色1つずつで 14%・18%・28%・34%。石を5〜7個にしても差は同じくらいだったので、分かりやすいこの形にした。
const START = {
  3: { 27: 0, 28: 1, 35: 2, 36: 2 },
  4: { 27: 0, 28: 1, 36: 2, 35: 3 },
};

// CPU の形勢判断: 隅は大きく加点、隅の隣は減点（相手に隅を取られやすい）。打てる場所の多さも少し見る
// 8×8 では次の表と同じになる（ほかの大きさでも、端からの距離で同じ考え方の点を付ける）:
//   100 -20 10  5  5 10 -20 100 / -20 -40 -2 -2 -2 -2 -40 -20 / 10 -2 1 1 1 1 -2 10 / 5 -2 1 0 0 1 -2 5 …
function weightOf(n, i) {
  const d = (x) => Math.min(x, n - 1 - x);
  const [a, b] = [d(Math.floor(i / n)), d(i % n)].sort((x, y) => x - y);
  if (a === 0) return b === 0 ? 100 : b === 1 ? -20 : b === 2 ? 10 : 5;
  if (a === 1) return b === 1 ? -40 : -2;
  return a === 2 ? 1 : 0;
}
const WEIGHT_CACHE = {};
const weights = (board) => (WEIGHT_CACHE[board.length] ??= Array.from({ length: board.length }, (_, i) => weightOf(sizeOf(board), i)));

function score(s, p) {
  const W = weights(s.board);
  let v = 0;
  s.board.forEach((x, i) => { if (x === p) v += W[i]; else if (x !== null) v -= W[i]; });
  return v + (legalMoves(s.board, p).length - legalMoves(s.board, 1 - p).length) * 3;
}

function count(board, n = 2) {
  const c = Array(n).fill(0);
  for (const v of board) if (v !== null) c[v]++;
  return c;
}

// CPU（3人以上）。読みはせず、置いた後の自分の石の点数（WEIGHTS）で選ぶ。
//   ふつう: 次の人が隅を取れるようになる手を避ける。つよい: ほかの全員について避ける（先に番が来る人ほど重く）。
//   よわい: 半分は適当に打つ。ふつう: 1割は適当。
function wideCpu(s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const moves = movesOf(s);
  if (moves.length === 1 || Math.random() < { weak: 0.5, normal: 0.1, strong: 0 }[level]) return moves[Math.floor(Math.random() * moves.length)];
  const p = s.turn;
  const N = N8;
  const W = weights(s.board);
  const CORNERS = [0, N - 1, N * (N - 1), N * N - 1];
  let best = -Infinity;
  let top = [];
  for (const m of moves) {
    const board = s.board.slice();
    board[m] = p;
    for (const i of flipsFor(s.board, p, m)) board[i] = p;
    let v = 0;
    board.forEach((x, i) => { if (x === p) v += W[i]; });
    const look = level === 'weak' ? 0 : level === 'normal' ? 1 : s.n - 1;
    for (let d = 1; d <= look; d++) {
      const q = (p + d) % s.n;
      const opp = movesOf({ board, turn: q, n: s.n });
      const corners = opp.filter((i) => CORNERS.includes(i)).length;
      v -= corners * (d === 1 ? 120 : 60);
    }
    v += Math.random() * 0.5;
    if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
  }
  return top[0];
}

export default {
  id: 'reversi',
  name: 'リバーシ',
  icon: '⚫',
  desc: '相手の石をはさんでひっくり返す。最後に多い方が勝ち。オンラインでは盤の大きさ（6×6・10×10）や3〜4人も選べる',
  ready: true,
  players: ['黒', '白', '赤', '青'],
  // 詳細設定の人数（2〜4人）。待合室の席の数になる
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    {
      key: 'players', label: '人数', def: 2,
      desc: '3人・4人では 黒・白・赤・青 で順番に置く。はさめる所が無いときは、石のとなりならどこにでも置ける',
      choices: [[2, '2人'], [3, '3人'], [4, '4人']],
    },
    {
      key: 'size', label: '盤の大きさ', def: 8,
      desc: '2人のときだけ。6×6 は早く終わり、スマホでも押しやすい。3人・4人はいつも 8×8',
      choices: [[8, '8×8（ふつう）'], [6, '6×6（短い）'], [10, '10×10（長い）']],
    },
    CPU_SETTING,
  ],

  // CPU: 何手先まで読むかで強さを変える（よわい1・ふつう2・つよい4）。弱いほど適当に打つことがある
  cpu(s, p, rules) {
    if (s.n > 2) return wideCpu(s, rules);
    return boardCpu(this, s, rules, (x) => legalMoves(x.board, x.turn), score, {
      depth: { weak: 1, normal: 2, strong: 4 }, mistake: { weak: 0.35, normal: 0.1, strong: 0 },
    });
  },

  init({ rules = {} } = {}) {
    const n = rules.players ?? 2;
    const N = n > 2 ? N8 : [6, 8, 10].includes(rules.size) ? rules.size : N8;
    const board = Array(N * N).fill(null);
    if (n > 2) {
      for (const [i, p] of Object.entries(START[n])) board[i] = p;
    } else {
      const h = N / 2; // 真ん中の4マス。8×8 なら d4・e5 が白、e4・d5 が黒
      board[(h - 1) * N + h - 1] = 1; board[h * N + h] = 1;
      board[(h - 1) * N + h] = 0; board[h * N + h - 1] = 0;
    }
    return { n, board, turn: 0, last: null, flipped: [], passed: null, over: false };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.over || !Number.isInteger(m) || m < 0 || m >= s.board.length) return null;
    if (s.n > 2) {
      if (!movesOf(s).includes(m)) return null;
      const flips = flipsFor(s.board, s.turn, m);
      const board = s.board.slice();
      board[m] = s.turn;
      for (const i of flips) board[i] = s.turn;
      return { ...s, board, turn: (s.turn + 1) % s.n, last: m, flipped: flips, over: board.every((v) => v !== null) };
    }
    const flips = flipsFor(s.board, s.turn, m);
    if (!flips.length) return null;
    const board = s.board.slice();
    board[m] = s.turn;
    for (const i of flips) board[i] = s.turn;
    const next = 1 - s.turn;
    let turn = next;
    let passed = null;
    let over = false;
    if (!legalMoves(board, next).length) {
      if (legalMoves(board, s.turn).length) { turn = s.turn; passed = next; } else over = true;
    }
    return { ...s, board, turn, last: m, flipped: flips, passed, over };
  },

  result(s) {
    if (!s.over) return null;
    if (s.n > 2) {
      const c = count(s.board, s.n);
      const most = Math.max(...c);
      const top = c.flatMap((v, p) => (v === most ? [p] : []));
      return { winner: top.length === 1 ? top[0] : null, cells: [] };
    }
    const [b, w] = count(s.board);
    return { winner: b === w ? null : b > w ? 0 : 1, cells: [] };
  },

  info(s) {
    if (s.n > 2) {
      const c = count(s.board, s.n);
      let html = '<span class="rv-score">' + c.map((v, p) => `<span class="rv-mini p${p}"></span>${this.players[p]} ${v}`).join('　') + '</span>';
      if (!s.over && !legalMoves(s.board, s.turn).length) html += `<br>${this.players[s.turn]}ははさめる所がないので、石のとなりならどこにでも置けます`;
      return html;
    }
    const [b, w] = count(s.board);
    let html = `<span class="rv-score"><span class="rv-mini p0"></span>黒 ${b}　−　${w} 白<span class="rv-mini p1"></span></span>`;
    if (s.passed !== null && !s.over) html += `<br>${this.players[s.passed]}は置ける場所がないのでパスです`;
    return html;
  },

  render(root, s, o) {
    const legal = new Set(o.canMove ? movesOf(s) : []);
    const flipped = new Set(o.fresh ? s.flipped : []);
    root.innerHTML = '';
    root.className = 'board rv';
    root.style.setProperty('--rv-n', sizeOf(s.board));
    s.board.forEach((v, i) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'rv-cell';
      if (v !== null) {
        const disc = document.createElement('span');
        disc.className = 'rv-disc p' + v;
        if (flipped.has(i)) disc.classList.add('flip');
        if (i === s.last && o.fresh) disc.classList.add('pop');
        cell.append(disc);
      }
      if (i === s.last) cell.classList.add('last');
      if (legal.has(i)) {
        cell.classList.add('playable', 'p' + s.turn);
        cell.onclick = () => o.onMove(i);
      } else {
        cell.tabIndex = -1;
      }
      root.append(cell);
    });
  },
};
