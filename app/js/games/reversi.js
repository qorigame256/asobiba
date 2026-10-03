// リバーシ。8×8。黒（プレイヤー0）が先手。手 = マスの番号 0〜63（段*8+列）。
// 置ける場所が無い側は自動でパスになる。両方置けなくなったら終局。

import { CPU_SETTING, boardCpu } from './util.js';

const N = 8;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

function flipsFor(board, p, i) {
  if (board[i] !== null) return [];
  const r0 = Math.floor(i / N);
  const c0 = i % N;
  const all = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === 1 - p) {
      line.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === p) all.push(...line);
  }
  return all;
}

function legalMoves(board, p) {
  const list = [];
  for (let i = 0; i < N * N; i++) if (flipsFor(board, p, i).length) list.push(i);
  return list;
}

// CPU の形勢判断: 隅は大きく加点、隅の隣は減点（相手に隅を取られやすい）。打てる場所の多さも少し見る
const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -40, -2, -2, -2, -2, -40, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -40, -2, -2, -2, -2, -40, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];

function score(s, p) {
  let v = 0;
  s.board.forEach((x, i) => { if (x === p) v += WEIGHTS[i]; else if (x !== null) v -= WEIGHTS[i]; });
  return v + (legalMoves(s.board, p).length - legalMoves(s.board, 1 - p).length) * 3;
}

function count(board) {
  let b = 0;
  let w = 0;
  for (const v of board) { if (v === 0) b++; else if (v === 1) w++; }
  return [b, w];
}

export default {
  id: 'reversi',
  name: 'リバーシ',
  icon: '⚫',
  desc: '相手の石をはさんでひっくり返す。最後に多い方が勝ち',
  ready: true,
  players: ['黒', '白'],
  settings: [CPU_SETTING],

  // CPU: 何手先まで読むかで強さを変える（よわい1・ふつう2・つよい4）。弱いほど適当に打つことがある
  cpu(s, p, rules) {
    return boardCpu(this, s, rules, (x) => legalMoves(x.board, x.turn), score, {
      depth: { weak: 1, normal: 2, strong: 4 }, mistake: { weak: 0.35, normal: 0.1, strong: 0 },
    });
  },

  init() {
    const board = Array(N * N).fill(null);
    board[27] = 1; board[36] = 1; // d4, e5 = 白
    board[28] = 0; board[35] = 0; // e4, d5 = 黒
    return { board, turn: 0, last: null, flipped: [], passed: null, over: false };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.over || !Number.isInteger(m) || m < 0 || m >= N * N) return null;
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
    return { board, turn, last: m, flipped: flips, passed, over };
  },

  result(s) {
    if (!s.over) return null;
    const [b, w] = count(s.board);
    return { winner: b === w ? null : b > w ? 0 : 1, cells: [] };
  },

  info(s) {
    const [b, w] = count(s.board);
    let html = `<span class="rv-score"><span class="rv-mini p0"></span>黒 ${b}　−　${w} 白<span class="rv-mini p1"></span></span>`;
    if (s.passed !== null && !s.over) html += `<br>${this.players[s.passed]}は置ける場所がないのでパスです`;
    return html;
  },

  render(root, s, o) {
    const legal = new Set(o.canMove ? legalMoves(s.board, s.turn) : []);
    const flipped = new Set(o.fresh ? s.flipped : []);
    root.innerHTML = '';
    root.className = 'board rv';
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
