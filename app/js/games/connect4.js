// コネクトフォー（四目並べ）。7列×6段。手 = 列の番号 0〜6（左から）。
// マスの番号は 段*7+列（段0が一番上）。

const COLS = 7;
const ROWS = 6;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

import { CPU_SETTING, boardCpu } from './util.js';

// CPU の形勢判断: 4マスの並びごとに、自分の駒だけ3つ・2つなら加点、相手の駒だけ3つなら減点。真ん中の列は少し加点
function score(s, p) {
  let v = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c === 3 && s.grid[r * COLS + c] !== null) v += s.grid[r * COLS + c] === p ? 3 : -3;
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k++) {
          const x = s.grid[(r + dr * k) * COLS + c + dc * k];
          if (x === p) mine++; else if (x !== null) theirs++;
        }
        if (theirs === 0) v += mine === 3 ? 5 : mine === 2 ? 2 : 0;
        else if (mine === 0 && theirs === 3) v -= 4;
      }
    }
  }
  return v;
}

export default {
  id: 'connect4',
  name: 'コネクトフォー',
  icon: '🔴',
  desc: '上からコマを落として、4つ並べたら勝ち',
  ready: true,
  players: ['赤', '黄'],
  settings: [CPU_SETTING],

  // CPU: 何手先まで読むかで強さを変える（よわい2・ふつう4・つよい6）。弱いほど適当に打つことがある
  cpu(s, p, rules) {
    const legal = (x) => [3, 2, 4, 1, 5, 0, 6].filter((c) => x.grid[c] === null);
    return boardCpu(this, s, rules, legal, score, {
      depth: { weak: 2, normal: 4, strong: 6 }, mistake: { weak: 0.35, normal: 0.12, strong: 0 },
    });
  },

  init() {
    return { grid: Array(COLS * ROWS).fill(null), turn: 0, last: null };
  },

  turn(s) { return s.turn; },

  apply(s, col) {
    if (!Number.isInteger(col) || col < 0 || col >= COLS || this.result(s)) return null;
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (s.grid[r * COLS + col] === null) { row = r; break; }
    }
    if (row < 0) return null;
    const grid = s.grid.slice();
    const i = row * COLS + col;
    grid[i] = s.turn;
    return { grid, turn: 1 - s.turn, last: i };
  },

  result(s) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = s.grid[r * COLS + c];
        if (v === null) continue;
        for (const [dr, dc] of DIRS) {
          const cells = [];
          for (let k = 0; k < 4; k++) {
            const rr = r + dr * k;
            const cc = c + dc * k;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || s.grid[rr * COLS + cc] !== v) break;
            cells.push(rr * COLS + cc);
          }
          if (cells.length === 4) return { winner: v, cells };
        }
      }
    }
    if (s.grid.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  render(root, s, o) {
    const res = this.result(s);
    const win = new Set(res?.cells ?? []);
    root.innerHTML = '';
    root.className = 'board c4';
    for (let c = 0; c < COLS; c++) {
      const col = document.createElement('button');
      col.type = 'button';
      col.className = 'c4-col';
      col.setAttribute('aria-label', `${c + 1}列目`);
      if (o.canMove && s.grid[c] === null) {
        col.classList.add('playable', 'p' + s.turn);
        col.onclick = () => o.onMove(c);
      } else {
        col.tabIndex = -1;
      }
      for (let r = 0; r < ROWS; r++) {
        const i = r * COLS + c;
        const cell = document.createElement('span');
        cell.className = 'c4-cell';
        const v = s.grid[i];
        if (v !== null) {
          const disc = document.createElement('span');
          disc.className = 'c4-disc p' + v;
          if (win.has(i)) disc.classList.add('win');
          if (i === s.last) {
            disc.classList.add('last');
            if (o.fresh) {
              disc.classList.add('drop');
              disc.style.setProperty('--fall', r + 1);
            }
          }
          cell.append(disc);
        }
        col.append(cell);
      }
      root.append(col);
    }
  },
};
