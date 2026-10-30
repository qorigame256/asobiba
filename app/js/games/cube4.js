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
// 詳細設定「重力なし」（free。2026-10-30 の31回目の案。本人が選んだ。分かれ目は Claude の判断）: どの段のマスにも直接置ける（もとの「立体四目」の遊び方）。
//   - 上から見た盤は出さず、4段の板を大きくして、板のマスを押して置く。
//   - 先手がかなり有利になる（完全に読めば先手必勝と知られている）が、もう一回で先手と後手が入れ替わるのでそのまま。
//   - CPU は打てる所が16から64に増えるので、読む手数を1つずつ減らす（よわい1・ふつう2・つよい3）。ときどき適当に打つ割合は同じ。
// 詳細設定「人数」（2026-10-30 本人の決定。どれも Claude の推奨を本人が承認）: 2人（最初）・3人。3人は 赤・黄・緑 の順に置き、4×4×4 のまま4つ並べたら勝ち。
//   Claude の判断: 2人のときの局面は前と全く同じ形（3人のときだけ np: 3）。重力なしとも一緒に使える。
//   3人の CPU は読みをせず（2人用の読みは相手が1人の前提のため）、置けるマスごとの点数で選ぶ（threeCpu。四目並べの3人の CPU と同じ考え方）。
// 手 = 柱の番号（上から見て 列 + 行×4。0〜15）。重力なしではマスの番号（0〜63）。マスの番号は 段×16 + 柱（段0 が一番下）。

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
// 重力なしのマス: 並びの多いマス（角と真ん中の 2×2×2。7本ずつ）を先に
const FREE_ORDER = [...Array(CELLS).keys()].sort((a, b) => BY_CELL[b].length - BY_CELL[a].length || a - b);
const legal = (s) => (s.free ? FREE_ORDER.filter((i) => s.grid[i] === null) : ORDER.filter((c) => s.grid[(N - 1) * COLS + c] === null));
const np = (s) => s.np ?? 2;

// マス i に p の駒が入れば4つ並ぶか
const wins = (s, i, p) => BY_CELL[i].some((li) => LINES[li].every((x) => x === i || s.grid[x] === p));

// CPU（3人。よわい・ふつう・つよい）。読みはせず、置けるマスごとの点数で選ぶ。
//   1. 並べられるなら置く  2. ほかの人が次に並べられるマスをふさぐ（次の番の人から。次の次の人は、よわい3割・ふつう6割だけ。次の人がふさげるため）
//   3. マスの点数: そのマスを含む窓のうち、自分の駒だけの窓は攻め、1人の相手の駒だけの窓は守りとして足す
//   4. 重力ありの ふつう・つよい: すぐ上のマスでほかの人が並べられる所へは置かない（上に乗せられて負けるため）
//   よわい: 半分は適当に打ち、次の人をふさぐのも半分だけ。ふつう: 1割は適当。つよい: 適当に打たず、2つの窓で同時に勝ちに迫る手を重く見る
function threeCpu(s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const p = s.turn;
  const n = np(s);
  const moves = legal(s);
  const at = (m) => (s.free ? m : landing(s, m));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const win = moves.find((m) => wins(s, at(m), p));
  if (win !== undefined && (level !== 'weak' || Math.random() < 0.8)) return win;
  if (Math.random() < { weak: 0.5, normal: 0.1, strong: 0 }[level]) return pick(moves);
  const after = { weak: 0.3, normal: 0.6, strong: 1 }[level];
  for (let d = 1; d < n; d++) {
    if (Math.random() >= (d === 1 ? (level === 'weak' ? 0.5 : 1) : after)) continue;
    const threat = moves.filter((m) => wins(s, at(m), (p + d) % n));
    if (threat.length) return pick(threat);
  }
  const ATTACK = [1, 4, 20, 120];
  const GUARD = [0, 3, 14, 80];
  let best = -Infinity;
  let top = [];
  for (const m of moves) {
    const i = at(m);
    let v = BY_CELL[i].length * 0.3; // 並びの多いマス（角と真ん中）を少し好む
    let near = 0; // 勝ちまであと1つになる窓の数（つよいだけが使う）
    for (const li of BY_CELL[i]) {
      let owner = null;
      let count = 0;
      let mixed = false;
      for (const x of LINES[li]) {
        const b = s.grid[x];
        if (b === null) continue;
        if (owner === null) owner = b;
        else if (owner !== b) { mixed = true; break; }
        count++;
      }
      if (mixed) continue;
      if (owner === null) v += ATTACK[0];
      else if (owner === p) {
        v += ATTACK[count];
        if (count === 2) near++;
      } else v += GUARD[count] * ((owner - p + n) % n === 1 ? 1 : 0.7);
    }
    if (!s.free && level !== 'weak' && i + COLS < CELLS) {
      const above = i + COLS;
      for (let d = 1; d < n; d++) if (wins(s, above, (p + d) % n)) v -= d === 1 ? 1000 : 600;
      if (wins(s, above, p)) v -= 30; // 自分の勝ちのマスの下を埋めると、ほかの人にふさがれる
    }
    if (level === 'strong' && near >= 2) v += 150;
    v += Math.random() * 0.5; // 同じ点数なら毎回違う手に
    if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
  }
  return top[0];
}

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
  desc: '4×4 の柱に下から積んで、立体のどの向きでも4つ並べたら勝ち。オンラインでは3人でも遊べる',
  ready: true,
  players: ['赤', '黄', '緑'],
  // 詳細設定の人数（2〜3人）。待合室の席の数になる
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  settings: [
    { key: 'players', label: '人数', def: 2, desc: '3人では 赤・黄・緑 の順に置く。大きさは 4×4×4 のまま', choices: [[2, '2人'], [3, '3人']] },
    CPU_SETTING,
    { key: 'free', label: '重力なし', desc: '下から積まずに、どの段のマスにも直接置ける', def: false },
  ],

  cpu(s, p, rules) {
    if (np(s) === 3) return threeCpu(s, rules);
    return boardCpu(this, s, rules, legal, score, {
      depth: s.free ? { weak: 1, normal: 2, strong: 3 } : { weak: 2, normal: 3, strong: 4 }, mistake: { weak: 0.35, normal: 0.1, strong: 0 },
    });
  },

  init({ rules } = {}) {
    const s = { grid: Array(CELLS).fill(null), turn: 0, last: null, won: null };
    if (rules?.players === 3) s.np = 3;
    return rules?.free ? { ...s, free: true } : s;
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (!Number.isInteger(m) || m < 0 || m >= (s.free ? CELLS : COLS) || s.won) return null;
    const i = s.free ? (s.grid[m] === null ? m : -1) : landing(s, m);
    if (i < 0) return null;
    const grid = s.grid.slice();
    grid[i] = s.turn;
    const line = BY_CELL[i].map((li) => LINES[li]).find((ln) => ln.every((x) => grid[x] === s.turn));
    const next = { grid, turn: (s.turn + 1) % np(s), last: i, won: line ? { winner: s.turn, cells: line } : null };
    if (s.np) next.np = s.np;
    return s.free ? { ...next, free: true } : next;
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
    root.className = 'board cb' + (s.free ? ' cb-free' : '');

    // 上から見た盤（押すとその柱に積む。重力なしでは出さない）
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

    // 4段の板（重力なしでは押して置く。ふだんは見るだけ）
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
        const v = s.grid[i];
        const cell = document.createElement(s.free ? 'button' : 'span');
        cell.className = 'cb-cell';
        if (s.free) {
          cell.type = 'button';
          cell.setAttribute('aria-label', `${z + 1}段目 ${Math.floor(c / N) + 1}行${(c % N) + 1}列`);
          if (o.canMove && v === null) {
            cell.classList.add('playable', 'p' + s.turn);
            cell.onclick = () => o.onMove(i);
          } else cell.tabIndex = -1;
        }
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
    if (s.free) root.append(layers); else root.append(top, layers);
  },
};
