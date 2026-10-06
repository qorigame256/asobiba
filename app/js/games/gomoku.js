// 五目並べ。2人（黒が先手）。交代で線の交わる点に石を置き、たて・よこ・ななめに5つ以上並べたら勝ち。
// 最初は禁じ手（連珠のルール）なしで、6つ以上並んでも勝ち（Claude の判断。ルールを覚えなくても遊べるように）。禁じ手は詳細設定（下）。
// 詳細設定「ぴったり五目」（2026-10-06 本人の決定）: ちょうど5つで勝ち。6つ以上つながっても勝ちにならない（置くことはできる）。両者とも同じ。
// 詳細設定「はさみ取り」（2026-10-06 本人の決定。決まりは Claude の推奨を本人が承認）: 相手の石がちょうど2つ並んだ両側を自分の石ではさむと取れる
//   （置いた石の8方向それぞれで見る）。5組（10個）取っても勝ち。自分から、はさまれる形に置いても取られない。取られた点にはまた置ける。
//   「ぴったり五目」と同時に使える。Claude の判断: 置いて取ったあとに5つ並びを見る。取って5組と5つ並びが同時なら5つ並びの光る石を出す。
// 詳細設定「禁じ手」（2026-10-06 本人の決定。正式な連珠どおり）: 先手の黒だけ、三三・四四・長連（6つ以上）になる点に置けない。
//   ちょうど5つ並ぶ点は、同時に三三などになっても置けて勝ち（連珠と同じ）。禁じ手の点は押せないようにして印を出す（本人承認。正式には置いたら負け）。
//   Claude の判断: 「三」は、もう1つ置くと両端の空いた四（達四）になる並び。その1つが禁じ手かどうかまでは見ない（正式にはさかのぼって見るが、まれなため）。
//   同じ線の上の2つの四（●_●●●_● など）も四四に数える。黒が置ける点が禁じ手しか無くなったら引き分け。
//   「ぴったり五目」と同時なら、白も6つ以上では勝てない（黒の長連は禁じ手のまま）。「はさみ取り」とも同時に使える（取る前の盤で見る）。
// 盤は詳細設定で 15路（最初）か 13路。手 = 点の番号（段*路数+列。段0が一番上）。全部埋まったら引き分け。

import { CPU_SETTING } from './util.js';

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const DIRS8 = [...DIRS, ...DIRS.map(([r, c]) => [-r, -c])];
const CAP_GOAL = 5; // はさみ取り: この組数を取ったら勝ち

// はさみ取り: 点 i に p が置いたときに取れる相手の石（点の番号の一覧。2つずつ）
function captures(grid, n, i, p) {
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const at = (k, dr, dc) => {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    return r >= 0 && r < n && c >= 0 && c < n ? r * n + c : -1;
  };
  const out = [];
  for (const [dr, dc] of DIRS8) {
    const a = at(1, dr, dc);
    const b = at(2, dr, dc);
    const e = at(3, dr, dc);
    if (e >= 0 && grid[a] === 1 - p && grid[b] === 1 - p && grid[e] === p) out.push(a, b);
  }
  return out;
}

// はさみ取り: 点 i に p が置くと、置いた石が相手にすぐ取られる形（自分の2つ並びの片側が相手・もう片側が空き）になる数
function exposed(grid, n, i, p) {
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const v = (k, dr, dc) => {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    return r >= 0 && r < n && c >= 0 && c < n ? grid[r * n + c] : 'x';
  };
  let k = 0;
  for (const [dr, dc] of DIRS8) {
    // 並び: (-1) i (+1) (+2)。i と +1 が自分で、両端の片方が相手・片方が空き
    if (v(1, dr, dc) !== p || v(2, dr, dc) === p || v(-1, dr, dc) === p) continue;
    const ends = [v(-1, dr, dc), v(2, dr, dc)];
    if (ends.includes(1 - p) && ends.includes(null)) k++;
  }
  return k;
}

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

// 点 i（空いている点）に手番の人が石を置いた局面（はさみ取りの取りと、勝ちの判定もする）
function place(s, i) {
  const grid = s.grid.slice();
  grid[i] = s.turn;
  let caps = s.caps ?? [0, 0];
  let taken = [];
  if (s.capture) {
    taken = captures(grid, s.size, i, s.turn);
    for (const j of taken) grid[j] = null;
    if (taken.length) { caps = caps.slice(); caps[s.turn] += taken.length / 2; }
  }
  const t = { ...s, grid, caps, taken };
  let won = null;
  for (const [dr, dc] of DIRS) {
    const { cells } = run(t, i, s.turn, dr, dc);
    if (s.exact ? cells.length === 5 : cells.length >= 5) { won = { winner: s.turn, cells }; break; }
  }
  if (!won && s.capture && caps[s.turn] >= CAP_GOAL) won = { winner: s.turn, cells: [i], byCap: true };
  return { ...t, turn: 1 - s.turn, last: i, won, count: s.count + 1 };
}

// 禁じ手: 点 i（空き）に黒が置くと三三・四四・長連になるか
const BLACK = 0;
function forbidden(grid, n, i) {
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const R = 6; // 置いた点から左右6マスずつ見る（線の配列の真ん中が i）
  let fours = 0;
  let threes = 0;
  let five = false;
  let over = false;
  for (const [dr, dc] of DIRS) {
    const line = [];
    for (let k = -R; k <= R; k++) {
      const r = r0 + dr * k;
      const c = c0 + dc * k;
      line.push(k === 0 ? BLACK : r >= 0 && r < n && c >= 0 && c < n ? grid[r * n + c] : 'x');
    }
    // 真ん中を含む黒のつながりの長さ（はみ出した端の位置も返す）
    const runAt = (L, j) => {
      let a = j;
      let b = j;
      while (a > 0 && L[a - 1] === BLACK) a--;
      while (b < L.length - 1 && L[b + 1] === BLACK) b++;
      return [a, b];
    };
    const [a0, b0] = runAt(line, R);
    const len = b0 - a0 + 1;
    if (len === 5) five = true;
    if (len >= 6) over = true;
    // 四: 1つ置けばちょうど5つ（置いた石を含む）になる空き点
    const fivePts = [];
    for (let j = 1; j < line.length - 1; j++) {
      if (line[j] !== null) continue;
      const L = line.slice();
      L[j] = BLACK;
      const [a, b] = runAt(L, j);
      if (b - a + 1 === 5 && a <= R && R <= b) fivePts.push(j);
    }
    if (fivePts.length) {
      // 両端の空いた四（_●●●●_）は1つの四。それ以外で2点あれば同じ線に四が2つ
      fours += fivePts.length >= 2 && !(fivePts.length === 2 && fivePts[1] - fivePts[0] === 5) ? 2 : 1;
      continue;
    }
    // 三: 1つ置くと達四（両端の空いた、ちょうど4つのつながり）になる
    for (let j = 2; j < line.length - 2; j++) {
      if (line[j] !== null) continue;
      const L = line.slice();
      L[j] = BLACK;
      const [a, b] = runAt(L, j);
      if (b - a + 1 !== 4 || a > R || R > b) continue;
      if (a < 2 || b > line.length - 3) continue;
      if (L[a - 1] === null && L[b + 1] === null && L[a - 2] !== BLACK && L[b + 2] !== BLACK) { threes++; break; }
    }
  }
  if (five) return false;
  return over || fours >= 2 || threes >= 2;
}
const banned = (s, i) => !!s.renju && s.turn === BLACK && s.grid[i] === null && forbidden(s.grid, s.size, i);
// 黒の番で、置ける点が禁じ手しか無い
const stuck = (s) => !!s.renju && s.turn === BLACK && s.grid.every((v, i) => v !== null || forbidden(s.grid, s.size, i));

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
// はさみ取りの点数: 取れる組の数（5組に届くなら勝ち・止めなければ負けと同じ重さ）
function capValue(s, i, p) {
  if (!s.capture) return 0;
  const k = captures(s.grid, s.size, i, p).length / 2;
  if (!k) return 0;
  return s.caps[p] + k >= CAP_GOAL ? 100000 : k * (s.caps[p] >= 3 ? 1500 : 700);
}

function gomokuCpu(s, rules) {
  const lv = LEVEL[rules?.cpu] ?? LEVEL.weak;
  const p = s.turn;
  const list = candidates(s).filter((i) => !(p === BLACK && banned(s, i))).map((i) => {
    let mine = cellValue(s, i, p) + capValue(s, i, p);
    // 黒が禁じ手で置けない点は、白が守らなくてよい
    const theirs = s.renju && 1 - p === BLACK && forbidden(s.grid, s.size, i) ? 0 : cellValue(s, i, 1 - p) + capValue(s, i, 1 - p);
    if (s.capture && mine < 100000) mine -= exposed(s.grid, s.size, i, p) * 400 * lv.guard; // 取られる形へ置くのを嫌う
    // 自分が勝てる手は必ず打つ。相手の五を止めるのも必ず（よわいでも）
    const v = mine >= 100000 ? 1e9 : theirs >= 100000 ? 1e8 : mine * 1.1 + theirs * lv.guard + Math.random();
    return { i, v };
  }).sort((a, b) => b.v - a.v);
  if (list[0].v < 1e8 && Math.random() < lv.slip) {
    const pool = list.slice(0, lv.top);
    return pool[Math.floor(Math.random() * pool.length)].i;
  }
  // つよい: 点数の高い順に、置いたあと相手に「止められない形」（両端の空いた四・四三など）を作らせない手を選ぶ（1手先読み）。
  // はさみ取りでは、相手に石を取られない手も条件にする（入れないと つよい が ふつう に 25勝55敗と負け越した。入れて 40勝20敗）
  if (lv.look && list[0].v < 1e8) {
    for (const { i } of list.slice(0, 8)) {
      const t = place(s, i);
      if (candidates(t).every((j) => cellValue(t, j, 1 - p) < 3000 && capValue(t, j, 1 - p) === 0)) return i;
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
    { key: 'renju', label: '禁じ手', desc: '先手の黒だけ、三三・四四・6つ以上並ぶ点に置けない（連珠のルール。先手の有利を消す）', def: false },
    { key: 'capture', label: 'はさみ取り', desc: '相手の石がちょうど2つ並んだ両側をはさむと取れる。5組（10個）取っても勝ち', def: false },
    CPU_SETTING,
  ],

  cpu(s, p, rules) { return gomokuCpu(s, rules); },

  init({ rules = {} } = {}) {
    const size = rules.size === 13 ? 13 : 15;
    return { size, exact: !!rules.exact, renju: !!rules.renju, capture: !!rules.capture, caps: [0, 0], taken: [], grid: Array(size * size).fill(null), turn: 0, last: null, won: null, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, i) {
    if (!Number.isInteger(i) || i < 0 || i >= s.grid.length || s.grid[i] !== null || s.won || banned(s, i)) return null;
    return place(s, i);
  },

  result(s) {
    if (s.won) return s.won;
    if (s.grid.every((v) => v !== null) || stuck(s)) return { winner: null, cells: [] };
    return null;
  },

  sound(a, b) { return b.taken?.length ? 'punch' : 'place'; },

  info(s) {
    if (!s.capture) return '';
    let html = `取った組　<b>${this.players[0]} ${s.caps[0]}</b>　−　<b>${this.players[1]} ${s.caps[1]}</b>（${CAP_GOAL}組で勝ち）`;
    if (s.won?.byCap) html += `<br>${this.players[s.won.winner]}が${CAP_GOAL}組取った`;
    return html;
  },

  render(root, s, o) {
    const res = this.result(s);
    const win = new Set(res?.cells ?? []);
    const n = s.size;
    root.innerHTML = '';
    root.className = 'board gm';
    root.style.setProperty('--n', n);
    const ban = s.renju && s.turn === BLACK && !res;
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
      } else if (ban && forbidden(s.grid, n, i)) {
        cell.append(Object.assign(document.createElement('span'), { className: 'gm-ban', textContent: '×' }));
        cell.tabIndex = -1;
        cell.setAttribute('aria-label', `${r + 1}段目 ${c + 1}列目（禁じ手）`);
      } else if (o.canMove) {
        if (o.fresh && s.taken?.includes(i)) cell.append(Object.assign(document.createElement('span'), { className: 'gm-ghost' }));
        cell.classList.add('playable', 'p' + s.turn);
        cell.setAttribute('aria-label', `${r + 1}段目 ${c + 1}列目`);
        cell.onclick = () => o.onMove(i);
      } else {
        if (o.fresh && s.taken?.includes(i)) cell.append(Object.assign(document.createElement('span'), { className: 'gm-ghost' }));
        cell.tabIndex = -1;
      }
      root.append(cell);
    }
  },
};
