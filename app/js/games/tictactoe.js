// マルバツ（三目並べ）。手 = マスの番号 0〜8（左上から右へ）。

import { CPU_SETTING, boardCpu } from './util.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARKS = [
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="28"/></svg>',
  '<svg viewBox="0 0 100 100"><path d="M26 26 L74 74 M74 26 L26 74"/></svg>',
];

export default {
  id: 'tictactoe',
  name: 'マルバツ',
  icon: '⭕',
  desc: 'たて・よこ・ななめに3つ並べたら勝ち',
  ready: true,
  players: ['○', '×'],
  settings: [CPU_SETTING],

  // CPU: よわい＝1手先だけ・半分は適当、ふつう＝相手の次の手まで読む・ときどき適当、つよい＝最後まで読む（負けない）
  cpu(s, p, rules) {
    const legal = (x) => x.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    return boardCpu(this, s, rules, legal, () => 0, {
      depth: { weak: 1, normal: 2, strong: 9 }, mistake: { weak: 0.5, normal: 0.15, strong: 0 },
    });
  },

  init() {
    return { board: Array(9).fill(null), turn: 0, last: null };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (!Number.isInteger(m) || m < 0 || m > 8 || s.board[m] !== null || this.result(s)) return null;
    const board = s.board.slice();
    board[m] = s.turn;
    return { board, turn: 1 - s.turn, last: m };
  },

  result(s) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (s.board[a] !== null && s.board[a] === s.board[b] && s.board[a] === s.board[c]) {
        return { winner: s.board[a], cells: line };
      }
    }
    if (s.board.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  render(root, s, o) {
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board ttt';
    s.board.forEach((v, i) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ttt-cell';
      if (v !== null) {
        cell.innerHTML = MARKS[v];
        cell.classList.add('p' + v);
        if (i === s.last && o.fresh) cell.classList.add('pop');
      }
      if (res?.cells.includes(i)) cell.classList.add('win');
      if (v === null && o.canMove) {
        cell.classList.add('playable');
        cell.onclick = () => o.onMove(i);
      } else {
        cell.tabIndex = -1;
      }
      root.append(cell);
    });
  },
};
