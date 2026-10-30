// 立体四目並べ。4×4 の柱に下から積み（4段まで）、縦・横・斜め（立体の斜めも）で4つ並べたら勝ち。2人だけ。
// 2026-10-30 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 4×4 の柱に下から積む（重力あり。今ある四目並べと同じ感覚）。2人だけ。
//   - 盤は 4×4 の板を4段ぶん並べて見せ、上から見た 4×4 のマスを押すとその柱に積まれる。
//   - CPU（よわい・ふつう・つよい）と、同じ画面の2人を付ける。
// Claude の判断:
//   - 上から見た盤のマスには、その柱の4段を小さな4つの段（下が1段目）で描く。いちばん上の空いた段が次に積まれる所。
//   - 4段の板は小さく並べ、最後に置いた駒と勝ちの並びを光らせる（PC は横1列、スマホの幅では 2×2）。
//   - CPU は何手先まで読むか（よわい2・ふつう3・つよい4）と、ときどき適当に打つ割合（35%・10%・0%）で強さを変える。
//   - 64マス全部埋まって並ばなければ引き分け。
// 手 = 柱の番号（上から見て 列 + 行×4。0〜15）。マスの番号は 段×16 + 柱（段0 が一番下）。

import { CPU_SETTING, boardCpu } from './util.js';

const N = 4;
const COLS = N * N;
const CELLS = COLS * N;
const idx = (x, y, z) => z * COLS + y * N + x;

// 4つ並びの窓の一覧（76本）と、マスごとにそのマスを含む窓の番号
export const LINES = (() => {
  const out = [];
  const dirs = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue;
    // 向きの半分だけ使う（逆向きで同じ並びを2回数えない）
    const key = dz * 9 + dy * 3 + dx;
    if (key > 0) dirs.push([dx, dy, dz]);
  }
  const inside = (v) => v >= 0 && v < N;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (const [dx, dy, dz] of dirs) {
      if (!inside(x + dx * 3) || !inside(y + dy * 3) || !inside(z + dz * 3)) continue;
      out.push([0, 1, 2, 3].map((k) => idx(x + dx * k, y + dy * k, z + dz * k)));
    }
  }
  return out;
})();
const BY_CELL = Array.from({ length: CELLS }, () => []);
LINES.forEach((ln, i) => { for (const c of ln) BY_CELL[c].push(i); });

// 柱 c に積んだときに入るマス（満杯なら -1）
const landing = (s, c) => {
  for (let z = 0; z < N; z++) if (s.grid[z * COLS + c] === null) return z * COLS + c;
  return -1;
};
// 打てる柱（真ん中の4本、ふち、角の順。読みは良い手から調べるほど速い）
const ORDER = [5, 6, 9, 10, 0, 3, 12, 15, 1, 2, 4, 7, 8, 11, 13, 14];
const legal = (s) => ORDER.filter((c) => s.grid[(N - 1) * COLS + c] === null);

// CPU の形勢判断: 窓ごとに、自分の駒だけ3つ・2つなら加点、相手の駒だけ3つ・2つなら減点
function score(s, p) {
  let v = 0;
  for (const ln of LINES) {
    let mine = 0, theirs = 0;
    for (const i of ln) {
      const x = s.grid[i];
      if (x === p) mine++; else if (x !== null) theirs++;
    }
    if (theirs === 0) v += mine === 3 ? 6 : mine === 2 ? 2 : mine;
    else if (mine === 0) v -= theirs === 3 ? 6 : theirs === 2 ? 2 : 0;
  }
  return v;
}

export default {
  id: 'cube4',
  name: '立体四目並べ',
  icon: '🧊',
  desc: '4×4 の柱に下から積んで、立体のどの向きでも4つ並べたら勝ち',
  ready: true,
  players: ['赤', '黄'],
  settings: [CPU_SETTING],

  cpu(s, p, rules) {
    return boardCpu(this, s, rules, legal, score, {
      depth: { weak: 2, normal: 3, strong: 4 }, mistake: { weak: 0.35, normal: 0.1, strong: 0 },
    });
  },

  init() {
    return { grid: Array(CELLS).fill(null), turn: 0, last: null, won: null };
  },

  turn(s) { return s.turn; },

  apply(s, col) {
    if (!Number.isInteger(col) || col < 0 || col >= COLS || s.won) return null;
    const i = landing(s, col);
    if (i < 0) return null;
    const grid = s.grid.slice();
    grid[i] = s.turn;
    const line = BY_CELL[i].map((li) => LINES[li]).find((ln) => ln.every((x) => grid[x] === s.turn));
    return { grid, turn: 1 - s.turn, last: i, won: line ? { winner: s.turn, cells: line } : null };
  },

  result(s) {
    if (s.won) return s.won;
    if (s.grid.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  render(root, s, o) {
    const res = this.result(s);
    const win = new Set(res?.cells ?? []);
    root.innerHTML = '';
    root.className = 'board cb';

    // 上から見た盤（押すとその柱に積む）
    const top = document.createElement('div');
    top.className = 'cb-top';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const c = y * N + x;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cb-col';
      const h = s.grid.filter((v, i) => i % COLS === c && v !== null).length;
      b.setAttribute('aria-label', `${y + 1}行${x + 1}列（${h}段まで積んである）`);
      if (o.canMove && landing(s, c) >= 0) {
        b.classList.add('playable', 'p' + s.turn);
        b.onclick = () => o.onMove(c);
      } else b.tabIndex = -1;
      for (let z = N - 1; z >= 0; z--) {
        const i = z * COLS + c;
        const slot = document.createElement('span');
        const v = s.grid[i];
        slot.className = 'cb-slot' + (v === null ? '' : ' p' + v) + (win.has(i) ? ' win' : '') + (i === s.last ? ' last' : '');
        if (v === null && z === h && o.canMove) slot.classList.add('next');
        b.append(slot);
      }
      top.append(b);
    }

    // 4段の板（見るだけ）
    const layers = document.createElement('div');
    layers.className = 'cb-layers';
    for (let z = 0; z < N; z++) {
      const box = document.createElement('div');
      box.className = 'cb-layer';
      const cap = document.createElement('div');
      cap.className = 'cb-cap';
      cap.textContent = `${z + 1}段目`;
      const g = document.createElement('div');
      g.className = 'cb-grid';
      for (let c = 0; c < COLS; c++) {
        const i = z * COLS + c;
        const cell = document.createElement('span');
        cell.className = 'cb-cell';
        const v = s.grid[i];
        if (v !== null) {
          const d = document.createElement('span');
          d.className = 'cb-disc p' + v + (win.has(i) ? ' win' : '') + (i === s.last ? ' last' : '');
          cell.append(d);
        }
        g.append(cell);
      }
      box.append(cap, g);
      layers.append(box);
    }
    root.append(top, layers);
  },
};
