// マルバツ（三目並べ）。手 = マスの番号 0〜8（左上から右へ）。
// 詳細設定「盤」でスーパーマルバツ（9×9）にできる（2026-10-04 本人の決定。決まりは Claude の推奨を本人が承認）:
//   3×3 の小さい盤が 3×3 に並ぶ。手 = 小さい盤の番号×9 ＋ その中のマスの番号（0〜80）。最初は真ん中の小さい盤に置く。
//   小さい盤の中で置いたマスの位置と同じ位置の小さい盤に、次の人が置く。小さい盤で3つ並べたらその盤は並べた人のもの。
//   取られた盤・埋まって誰も並ばなかった盤（引き分けの盤。誰のものでもない）にはもう置けず、そこへ送られたら空いている盤のどこにでも置ける。
//   取った盤が3つ並んだら勝ち。並ばずに置ける所が無くなったら引き分け。
//   同じ画面の2人対戦は詳細設定が無いので、ふつうのマルバツだけ（将棋の駒落ちと同じ）。

import { CPU_SETTING, boardCpu } from './util.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARKS = [
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="28"/></svg>',
  '<svg viewBox="0 0 100 100"><path d="M26 26 L74 74 M74 26 L26 74"/></svg>',
];
const DRAWN = 'd'; // 引き分けの小さい盤

// 3つ並んだ列（無ければ null）。v は9つの値
function lineOf(v) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if ((v[a] === 0 || v[a] === 1) && v[a] === v[b] && v[a] === v[c]) return line;
  }
  return null;
}

/* ---------- スーパーマルバツ ---------- */

const sub = (board, b) => board.slice(b * 9, b * 9 + 9);

// 打てる手の一覧
function bigLegal(s) {
  if (bigResult(s)) return [];
  const out = [];
  for (let b = 0; b < 9; b++) {
    if (s.owner[b] !== null || (s.next !== null && s.next !== b)) continue;
    for (let c = 0; c < 9; c++) if (s.board[b * 9 + c] === null) out.push(b * 9 + c);
  }
  return out;
}

function bigApply(s, m) {
  if (!Number.isInteger(m) || m < 0 || m > 80 || s.board[m] !== null || bigResult(s)) return null;
  const b = Math.floor(m / 9);
  const c = m % 9;
  if (s.owner[b] !== null || (s.next !== null && s.next !== b)) return null;
  const board = s.board.slice();
  board[m] = s.turn;
  const owner = s.owner.slice();
  const small = sub(board, b);
  if (lineOf(small)) owner[b] = s.turn;
  else if (small.every((v) => v !== null)) owner[b] = DRAWN;
  return { big: true, board, owner, next: owner[c] === null ? c : null, turn: 1 - s.turn, last: m };
}

// cells は光らせる小さい盤の番号
function bigResult(s) {
  const line = lineOf(s.owner);
  if (line) return { winner: s.owner[line[0]], cells: line };
  if (s.owner.every((v) => v !== null)) return { winner: null, cells: [] };
  return null;
}

// CPU の形勢の見積もり（p から見た点数）: 取った盤とその並び、小さい盤の中の2つ並び
function bigScore(s, p) {
  const q = 1 - p;
  let v = 0;
  for (const line of LINES) {
    const o = line.map((i) => s.owner[i]);
    const mine = o.filter((x) => x === p).length;
    const theirs = o.filter((x) => x === q).length;
    if (o.includes(DRAWN) || (mine && theirs)) continue;
    v += [0, 15, 80][mine] - [0, 15, 80][theirs];
  }
  for (let b = 0; b < 9; b++) {
    if (s.owner[b] === p) v += b === 4 ? 40 : 30;
    else if (s.owner[b] === q) v -= b === 4 ? 40 : 30;
    if (s.owner[b] !== null) continue;
    const small = sub(s.board, b);
    for (const line of LINES) {
      const o = line.map((i) => small[i]);
      const mine = o.filter((x) => x === p).length;
      const theirs = o.filter((x) => x === q).length;
      if (mine && theirs) continue;
      v += [0, 0.5, 4][mine] - [0, 0.5, 4][theirs];
    }
  }
  // 相手をどこにでも置ける形にするのは損
  if (s.next === null) v += s.turn === p ? 6 : -6;
  return v;
}

/* ---------- 画面 ---------- */

function cellButton(v, i, s, o, playable) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'ttt-cell';
  if (v !== null) {
    cell.innerHTML = MARKS[v];
    cell.classList.add('p' + v);
    if (i === s.last) cell.classList.add('last');
    if (i === s.last && o.fresh) cell.classList.add('pop');
  }
  if (playable) {
    cell.classList.add('playable');
    cell.onclick = () => o.onMove(i);
  } else {
    cell.tabIndex = -1;
  }
  return cell;
}

function renderBig(root, s, o) {
  const res = bigResult(s);
  root.innerHTML = '';
  root.className = 'board ttt9';
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div');
    box.className = 'ttt9-sub';
    const open = !res && s.owner[b] === null && (s.next === null || s.next === b);
    if (open) box.classList.add('active');
    if (res?.cells.includes(b)) box.classList.add('win');
    for (let c = 0; c < 9; c++) {
      const i = b * 9 + c;
      box.append(cellButton(s.board[i], i, s, o, open && o.canMove && s.board[i] === null));
    }
    if (s.owner[b] !== null) {
      box.classList.add('closed');
      const cover = document.createElement('div');
      cover.className = 'ttt9-own' + (s.owner[b] === DRAWN ? ' drawn' : ' p' + s.owner[b]);
      cover.innerHTML = s.owner[b] === DRAWN ? '<span>引き分け</span>' : MARKS[s.owner[b]];
      box.append(cover);
    }
    root.append(box);
  }
}

export default {
  id: 'tictactoe',
  name: 'マルバツ',
  icon: '⭕',
  desc: 'たて・よこ・ななめに3つ並べたら勝ち。オンラインでは 9×9 のスーパーマルバツも選べる',
  ready: true,
  players: ['○', '×'],
  settings: [
    {
      key: 'size', label: '盤', def: 'normal',
      desc: 'スーパーは小さい盤（3×3）が9つ並んだ 9×9。置いたマスの位置で、次の人が置く小さい盤が決まる',
      choices: [['normal', 'ふつう（3×3）'], ['super', 'スーパー（9×9）']],
    },
    CPU_SETTING,
  ],

  // CPU: よわい＝1手先だけ・ときどき適当、ふつう＝相手の次の手まで読む、つよい＝最後まで読む（負けない）
  // スーパー: よわい＝1手先・4割は適当、ふつう＝2手先・1割は適当、つよい＝4手先（どこにでも置ける局面は3手先。重くなるため）
  cpu(s, p, rules) {
    if (s.big) {
      const free = s.next === null;
      return boardCpu(this, s, rules, bigLegal, bigScore, {
        depth: { weak: 1, normal: 2, strong: free ? 3 : 4 }, mistake: { weak: 0.4, normal: 0.1, strong: 0 },
      });
    }
    const legal = (x) => x.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    return boardCpu(this, s, rules, legal, () => 0, {
      depth: { weak: 1, normal: 2, strong: 9 }, mistake: { weak: 0.5, normal: 0.15, strong: 0 },
    });
  },

  init({ rules = {} } = {}) {
    if (rules.size === 'super') return { big: true, board: Array(81).fill(null), owner: Array(9).fill(null), next: 4, turn: 0, last: null };
    return { board: Array(9).fill(null), turn: 0, last: null };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.big) return bigApply(s, m);
    if (!Number.isInteger(m) || m < 0 || m > 8 || s.board[m] !== null || this.result(s)) return null;
    const board = s.board.slice();
    board[m] = s.turn;
    return { board, turn: 1 - s.turn, last: m };
  },

  result(s) {
    if (s.big) return bigResult(s);
    const line = lineOf(s.board);
    if (line) return { winner: s.board[line[0]], cells: line };
    if (s.board.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  info(s) {
    if (!s.big || bigResult(s)) return '';
    return s.next === null ? 'どの盤にでも置けます' : '光っている盤に置きます';
  },

  render(root, s, o) {
    if (s.big) { renderBig(root, s, o); return; }
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board ttt';
    s.board.forEach((v, i) => {
      const cell = cellButton(v, i, s, o, v === null && o.canMove);
      cell.classList.remove('last');
      if (res?.cells.includes(i)) cell.classList.add('win');
      root.append(cell);
    });
  },
};
