// 五目並べ。2人（黒が先手）。交代で線の交わる点に石を置き、たて・よこ・ななめに5つ以上並べたら勝ち。
// 禁じ手（連珠のルール）は無し。6つ以上並んでも勝ち（Claude の判断。ルールを覚えなくても遊べるように）。
// 詳細設定「ぴったり五目」（2026-10-06 本人の決定）: ちょうど5つで勝ち。6つ以上つながっても勝ちにならない（置くことはできる）。両者とも同じ。
// 盤は詳細設定で 15路（最初）か 13路。手 = 点の番号（段*路数+列。段0が一番上）。全部埋まったら引き分け。

import { CPU_SETTING } from './util.js';

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

// 点 i に p の石があるとして、方向 [dr, dc] に何個つながるか（i を含む）と、両端が空いているか
function run(s, i, p, dr, dc) {
  const n = s.size;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const cells = [i];
  let open = 0;
  for (const sign of [1, -1]) {
    let r = r0 + dr * sign;
    let c = c0 + dc * sign;
    while (r >= 0 && r < n && c >= 0 && c < n && s.grid[r * n + c] === p) {
      cells.push(r * n + c);
      r += dr * sign;
      c += dc * sign;
    }
    if (r >= 0 && r < n && c >= 0 && c < n && s.grid[r * n + c] === null) open++;
  }
  return { cells, open };
}

/* ---------- CPU ---------- */

// 石を置いたときに、その方向でできる形の点数（count = つながる数、open = 空いている端の数）
function shape(count, open, exact) {
  if (count >= 5) return exact && count > 5 ? 0 : 100000;
  if (open === 0) return 0;
  if (count === 4) return open === 2 ? 20000 : 1200; // 両端の空いた四は止められない
  if (count === 3) return open === 2 ? 1000 : 120;
  if (count === 2) return open === 2 ? 60 : 10;
  return open === 2 ? 4 : 1;
}

// すき間のある形の点数: i を含む5マスの並び（相手の石も盤の外も無いもの）ごとに、自分の石の数で足す
const WINDOW = [0, 1, 3, 12, 600, 0];

// 点 i に p が置いたときの点数（4方向の合計）
function cellValue(s, i, p) {
  const n = s.size;
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const at = (r, c) => (r < 0 || r >= n || c < 0 || c >= n ? 'x' : r === r0 && c === c0 ? p : s.grid[r * n + c]);
  let v = 0;
  let threats = 0;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let open = 0;
    for (const sg of [1, -1]) {
      let k = 1;
      while (at(r0 + dr * k * sg, c0 + dc * k * sg) === p) { count++; k++; }
      if (at(r0 + dr * k * sg, c0 + dc * k * sg) === null) open++;
    }
    v += shape(count, open, s.exact);
    let most = 0;
    for (let off = -4; off <= 0; off++) {
      let own = 0;
      let ok = true;
      for (let k = off; k < off + 5 && ok; k++) {
        const x = at(r0 + dr * k, c0 + dc * k);
        if (x === p) own++;
        else if (x !== null) ok = false;
      }
      if (ok) { v += WINDOW[own]; most = Math.max(most, own); }
    }
    if (most >= 4 || (count === 3 && open === 2)) threats++;
  }
  if (threats >= 2) v += 3000; // 四三・三三（2方向で同時に迫る形）
  return v;
}

// 石の近く（2マス以内）の空いた点。盤が空なら真ん中
function candidates(s) {
  const n = s.size;
  const out = [];
  for (let i = 0; i < n * n; i++) {
    if (s.grid[i] !== null) continue;
    const r = Math.floor(i / n);
    const c = i % n;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && s.grid[rr * n + cc] !== null) { near = true; break; }
      }
    }
    if (near) out.push(i);
  }
  if (!out.length) { const mid = (n - 1) / 2; out.push(mid * n + mid); }
  return out;
}

// CPU（よわい・ふつう・つよい）。読みはせず、置いた点の「攻め（自分の形）」と「守り（相手がそこに置いたときの形）」の点数で選ぶ。
// よわい: 守りを軽く見て、3割は上位8つから適当に選ぶ。ふつう: 2割弱は上位3つから適当。つよい: 相手の次の手まで見る（下）
const LEVEL = {
  weak: { guard: 0.6, slip: 0.3, top: 8 },
  normal: { guard: 0.9, slip: 0.18, top: 3 },
  strong: { guard: 1, slip: 0, top: 1, look: true },
};
function gomokuCpu(s, rules) {
  const lv = LEVEL[rules?.cpu] ?? LEVEL.weak;
  const p = s.turn;
  const list = candidates(s).map((i) => {
    const mine = cellValue(s, i, p);
    const theirs = cellValue(s, i, 1 - p);
    // 自分が勝てる手は必ず打つ。相手の五を止めるのも必ず（よわいでも）
    const v = mine >= 100000 ? 1e9 : theirs >= 100000 ? 1e8 : mine * 1.1 + theirs * lv.guard + Math.random();
    return { i, v };
  }).sort((a, b) => b.v - a.v);
  if (list[0].v < 1e8 && Math.random() < lv.slip) {
    const pool = list.slice(0, lv.top);
    return pool[Math.floor(Math.random() * pool.length)].i;
  }
  // つよい: 点数の高い順に、置いたあと相手に「止められない形」（両端の空いた四・四三など）を作らせない手を選ぶ（1手先読み）
  if (lv.look && list[0].v < 1e8) {
    for (const { i } of list.slice(0, 8)) {
      const grid = s.grid.slice();
      grid[i] = p;
      const t = { ...s, grid };
      if (candidates(t).every((j) => cellValue(t, j, 1 - p) < 3000)) return i;
    }
  }
  return list[0].i;
}

export default {
  id: 'gomoku',
  name: '五目並べ',
  icon: '⚪',
  desc: '交代で黒と白の石を置き、たて・よこ・ななめに5つ並べたら勝ち',
  ready: true,
  players: ['黒', '白'],
  settings: [
    { key: 'size', label: '盤', desc: '13路はスマホで押しやすい', def: 15, choices: [[15, '15路（15×15）'], [13, '13路（13×13）']] },
    { key: 'exact', label: 'ぴったり五目', desc: 'ちょうど5つで勝ち。6つ以上つながっても勝ちにならない', def: false },
    CPU_SETTING,
  ],

  cpu(s, p, rules) { return gomokuCpu(s, rules); },

  init({ rules = {} } = {}) {
    const size = rules.size === 13 ? 13 : 15;
    return { size, exact: !!rules.exact, grid: Array(size * size).fill(null), turn: 0, last: null, won: null, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, i) {
    if (!Number.isInteger(i) || i < 0 || i >= s.grid.length || s.grid[i] !== null || s.won) return null;
    const grid = s.grid.slice();
    grid[i] = s.turn;
    const t = { ...s, grid };
    let won = null;
    for (const [dr, dc] of DIRS) {
      const { cells } = run(t, i, s.turn, dr, dc);
      if (s.exact ? cells.length === 5 : cells.length >= 5) { won = { winner: s.turn, cells }; break; }
    }
    return { ...t, turn: 1 - s.turn, last: i, won, count: s.count + 1 };
  },

  result(s) {
    if (s.won) return s.won;
    if (s.count >= s.grid.length) return { winner: null, cells: [] };
    return null;
  },

  render(root, s, o) {
    const res = this.result(s);
    const win = new Set(res?.cells ?? []);
    const n = s.size;
    root.innerHTML = '';
    root.className = 'board gm';
    root.style.setProperty('--n', n);
    const stars = n === 15 ? [3, 7, 11] : [3, 6, 9]; // 目印の点（星）
    for (let i = 0; i < n * n; i++) {
      const r = Math.floor(i / n);
      const c = i % n;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'gm-pt' + (r === 0 ? ' t' : '') + (r === n - 1 ? ' b' : '') + (c === 0 ? ' l' : '') + (c === n - 1 ? ' r' : '');
      if (stars.includes(r) && stars.includes(c)) cell.classList.add('star');
      const v = s.grid[i];
      if (v !== null) {
        const stone = document.createElement('span');
        stone.className = 'gm-stone p' + v + (win.has(i) ? ' win' : '') + (i === s.last ? ' last' : '') + (i === s.last && o.fresh ? ' pop' : '');
        cell.append(stone);
        cell.tabIndex = -1;
      } else if (o.canMove) {
        cell.classList.add('playable', 'p' + s.turn);
        cell.setAttribute('aria-label', `${r + 1}段目 ${c + 1}列目`);
        cell.onclick = () => o.onMove(i);
      } else {
        cell.tabIndex = -1;
      }
      root.append(cell);
    }
  },
};
