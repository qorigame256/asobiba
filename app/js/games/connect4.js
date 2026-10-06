// コネクトフォー（四目並べ）。2人は7列×6段。手 = 列の番号（左から 0〜）。
// マスの番号は 段*列の数+列（段0が一番上）。
// 詳細設定「人数」で3人・4人にもできる（2026-10-04 本人の決定。決まりは Claude の推奨を本人が承認）:
//   赤・黄・緑・紫で順番に、広い盤に落とす。並べるのは4つのまま。盤の大きさは詳細設定「3人以上の盤」で選ぶ。
//   待合室では人数ぶんの席に人か CPU を選び、もう一回では打つ順番を1つずつ回す（マルバツと同じ）。
// 詳細設定「ポップアウト」（2026-10-05 本人の決定。決まりは Claude の推奨を本人が承認）: 2人のときだけ。
//   落とす代わりに、一番下の段にある自分のコマを1つ抜いてもよい（上のコマが1段ずつ下がる）。手 = { pop: 列の番号 }。
//   抜いて相手の4つ並びができたら相手の勝ち（自分も同時に並んでも相手の勝ち）。同じ盤面（次の番も同じ）が3回出たら引き分け。
//   盤が埋まっても抜ける手があれば続き、打てる手が無くなったら引き分け。
//   Claude の判断: 終わらないのを防ぐため、200手でも引き分け（同じ盤面の3回で、ふつうはそれより先に終わる）。
// 詳細設定「じゃま石」（2026-10-06 本人の決定。最初はなし）: 始めから誰のものでもない灰色の石が、ばらばらの列に落としてある。
//   じゃま石を含む並びではだれも勝てない。Claude の判断: 数は 2人 3個・3人以上は 列の数の半分（切り捨て）。1列に2個まで（一番下から積む）。
//   置き場所は対局の種（seed）から決める（全員の端末で同じ。init に seed が要る）。ポップアウトでは抜けない（自分のコマではないため）。

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
export const NEUTRAL = -1; // じゃま石

import { CPU_SETTING, boardCpu, mulberry32 } from './util.js';

// 盤（列 w・段 h）の4つ並びの窓の一覧。マスごとに、そのマスを含む窓の番号も持つ
const WINDOWS = {};
function windowsOf(w, h) {
  const key = w + ':' + h;
  if (WINDOWS[key]) return WINDOWS[key];
  const list = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      for (const [dr, dc] of DIRS) {
        const er = r + dr * 3;
        const ec = c + dc * 3;
        if (er < 0 || er >= h || ec < 0 || ec >= w) continue;
        list.push([0, 1, 2, 3].map((k) => (r + dr * k) * w + c + dc * k));
      }
    }
  }
  const byCell = Array.from({ length: w * h }, () => []);
  list.forEach((win, i) => { for (const x of win) byCell[x].push(i); });
  WINDOWS[key] = { list, byCell };
  return WINDOWS[key];
}

// CPU の形勢判断（2人）: 4マスの並びごとに、自分の駒だけ3つ・2つなら加点、相手の駒だけ3つなら減点。真ん中の列は少し加点
function score(s, p) {
  let v = 0;
  const mid = (s.w - 1) / 2;
  for (let r = 0; r < s.h; r++) {
    const x = s.grid[r * s.w + mid];
    if (x !== null && x !== NEUTRAL) v += x === p ? 3 : -3;
  }
  for (const win of windowsOf(s.w, s.h).list) {
    let mine = 0;
    let theirs = 0;
    let dead = false;
    for (const i of win) {
      const x = s.grid[i];
      if (x === NEUTRAL) dead = true;
      else if (x === p) mine++; else if (x !== null) theirs++;
    }
    if (dead) continue; // じゃま石を含む並びはだれも勝てない
    if (theirs === 0) v += mine === 3 ? 5 : mine === 2 ? 2 : 0;
    else if (mine === 0 && theirs === 3) v -= 4;
  }
  return v;
}

/* ---------- 3〜4人（広い盤） ---------- */

// 3人以上の盤の選択肢。値は「列-段」。auto は人数で決める。
// CPU（つよい）どうしで400局ずつ打たせて決めた（2026-10-04。最初の1巡だけ適当に打たせて手順をばらけさせた）:
// 席順の差はどの盤でも数%と小さい。広い盤ほど引き分けが減るが長くなる。3人: 8×7 で引き分け 30〜38%・9×7 で 25%（約58手）・
// 10×8 で 17〜20%（約71手）。4人: 7×6〜9×7 は6割前後が引き分け・10×8 で 42〜50%・11×9 で 36〜45%（約93手）。
const WIDE_AUTO = { 3: '9-7', 4: '11-9' };
const WIDE_CHOICES = [['auto', 'おまかせ（3人は 9×7・4人は 11×9）'], ['8-7', '8列×7段'], ['9-7', '9列×7段'], ['10-8', '10列×8段'], ['11-9', '11列×9段']];
function wideSize(v, n) {
  const key = WIDE_CHOICES.some(([c]) => c === v) && v !== 'auto' ? v : WIDE_AUTO[n];
  return key.split('-').map(Number);
}

/* ---------- ポップアウト ---------- */

const POP_LIMIT = 200;

// 盤面と次の番を表す文字（同じ盤面が何回出たか数えるため）
const posKey = (grid, turn) => grid.map((v) => (v === null ? '.' : v === NEUTRAL ? 'x' : v)).join('') + turn;

// 打てる手（落とす列と、抜ける列）
function popLegal(s) {
  const out = [3, 2, 4, 1, 5, 0, 6].filter((c) => s.grid[c] === null);
  for (const c of [3, 2, 4, 1, 5, 0, 6]) if (s.grid[(s.h - 1) * s.w + c] === s.turn) out.push({ pop: c });
  return out;
}

// 手を打ったあとの盤面で、決着や引き分けを決めて新しい局面を返す
function popFinish(s, grid, last, popped) {
  const { list } = windowsOf(s.w, s.h);
  let won = null;
  if (popped) {
    // 抜いたときは列全体が動くので、盤全体で並びを探す。相手の並びを先に見る
    const lineOf = (p) => list.find((win) => win.every((x) => grid[x] === p));
    const theirs = lineOf(1 - s.turn);
    const mine = theirs ? null : lineOf(s.turn);
    if (theirs) won = { winner: 1 - s.turn, cells: theirs };
    else if (mine) won = { winner: s.turn, cells: mine };
  } else {
    const { byCell } = windowsOf(s.w, s.h);
    const line = byCell[last].map((wi) => list[wi]).find((win) => win.every((x) => grid[x] === s.turn));
    if (line) won = { winner: s.turn, cells: line };
  }
  const turn = 1 - s.turn;
  const key = posKey(grid, turn);
  const hist = { key, prev: s.hist };
  const moves = s.moves + 1;
  if (!won) {
    let seen = 0;
    for (let h = hist; h; h = h.prev) if (h.key === key) seen++;
    if (seen >= 3 || moves >= POP_LIMIT) won = { winner: null, cells: [] };
  }
  return { ...s, grid, turn, last, won, hist, moves };
}

function popApply(s, m) {
  if (s.won) return null;
  if (Number.isInteger(m)) {
    if (m < 0 || m >= s.w) return null;
    const i = landing(s, m);
    if (i < 0) return null;
    const grid = s.grid.slice();
    grid[i] = s.turn;
    return popFinish(s, grid, i, false);
  }
  const c = m?.pop;
  if (!Number.isInteger(c) || c < 0 || c >= s.w || s.grid[(s.h - 1) * s.w + c] !== s.turn) return null;
  const grid = s.grid.slice();
  for (let r = s.h - 1; r > 0; r--) grid[r * s.w + c] = grid[(r - 1) * s.w + c];
  grid[c] = null;
  return popFinish(s, grid, null, true);
}

// じゃま石を置いた最初の盤（種から決める。乱数や時刻は使わない）
function blockers(w, h, n, seed) {
  const grid = Array(w * h).fill(null);
  const rnd = mulberry32(seed ^ 0x5eed);
  const count = n === 2 ? 3 : Math.floor(w / 2);
  const height = Array(w).fill(0);
  for (let k = 0; k < count; k++) {
    const cols = [];
    for (let c = 0; c < w; c++) if (height[c] < 2) cols.push(c);
    const c = cols[Math.floor(rnd() * cols.length)];
    height[c] += 1;
    grid[(h - height[c]) * w + c] = NEUTRAL;
  }
  return grid;
}

// 列 c に落としたときに入るマス（満杯なら -1）
function landing(s, c) {
  for (let r = s.h - 1; r >= 0; r--) if (s.grid[r * s.w + c] === null) return r * s.w + c;
  return -1;
}

// マス i に p の駒が入れば4つ並ぶか
function wins(s, i, p) {
  const { list, byCell } = windowsOf(s.w, s.h);
  return byCell[i].some((wi) => list[wi].every((x) => x === i || s.grid[x] === p));
}

// CPU（3人以上。よわい・ふつう・つよい）。読みはせず、落とせるマスごとの点数で選ぶ。
//   1. 並べられるなら落とす  2. ほかの人が次に並べられるマスをふさぐ（先に番が来る人から）
//   3. マスの点数: そのマスを含む窓のうち、自分の駒だけの窓は攻め、1人の相手の駒だけの窓は守りとして足す
//   4. ふつう・つよい: すぐ上のマスでほかの人が並べられる所へは落とさない（上に乗せられて負けるため）
//   よわい: 半分は適当に打ち、ふさぐのも半分だけ。ふつう: 1割は適当。つよい: 適当に打たず、2つの窓で同時に勝ちに迫る手を重く見る
function wideCpu(s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const p = s.turn;
  const cols = [];
  for (let c = 0; c < s.w; c++) if (landing(s, c) >= 0) cols.push(c);
  const at = (c) => landing(s, c);
  const win = cols.find((c) => wins(s, at(c), p));
  if (win !== undefined && (level !== 'weak' || Math.random() < 0.8)) return win;
  if (Math.random() < { weak: 0.5, normal: 0.1, strong: 0 }[level]) return cols[Math.floor(Math.random() * cols.length)];
  if (level !== 'weak' || Math.random() < 0.5) {
    for (let d = 1; d < s.n; d++) {
      const threat = cols.filter((c) => wins(s, at(c), (p + d) % s.n));
      if (threat.length) return threat[Math.floor(Math.random() * threat.length)];
    }
  }
  const { list, byCell } = windowsOf(s.w, s.h);
  const ATTACK = [1, 4, 20, 120];
  const GUARD = [0, 3, 14, 80];
  const mid = (s.w - 1) / 2;
  let best = -Infinity;
  let top = [];
  for (const c of cols) {
    const i = at(c);
    let v = 2 - Math.abs(c - mid) * 0.4; // 真ん中寄りを少し好む
    let near = 0; // 勝ちまであと1つになる窓の数（つよいだけが使う）
    for (const wi of byCell[i]) {
      let owner = null;
      let count = 0;
      let mixed = false;
      for (const x of list[wi]) {
        const b = s.grid[x];
        if (b === null) continue;
        if (b === NEUTRAL) { mixed = true; break; } // じゃま石を含む並びはだれも勝てない
        if (owner === null) owner = b;
        else if (owner !== b) mixed = true;
        count++;
      }
      if (mixed) continue;
      if (owner === null) v += ATTACK[0];
      else if (owner === p) {
        v += ATTACK[count];
        if (count === 2) near++;
      } else {
        const soon = (owner - p + s.n) % s.n; // 1 = 次の番の人
        v += GUARD[count] * (soon === 1 ? 1 : 0.7);
      }
    }
    if (level !== 'weak' && i >= s.w) {
      const above = i - s.w;
      for (let d = 1; d < s.n; d++) if (wins(s, above, (p + d) % s.n)) v -= d === 1 ? 1000 : 600;
      if (wins(s, above, p)) v -= 30; // 自分の勝ちのマスの下を埋めると、ほかの人にふさがれる
    }
    if (level === 'strong' && near >= 2) v += 150;
    v += Math.random() * 0.5; // 同じ点数なら毎回違う手に
    if (v > best) { best = v; top = [c]; } else if (v === best) top.push(c);
  }
  return top[0];
}

export default {
  id: 'connect4',
  name: 'コネクトフォー',
  icon: '🔴',
  desc: '上からコマを落として、4つ並べたら勝ち。オンラインでは自分のコマを下から抜けるポップアウトや、3〜4人で広い盤も選べる',
  ready: true,
  players: ['赤', '黄', '緑', '紫'],
  // 詳細設定の人数（2〜4人）。待合室の席の数になる
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    {
      key: 'players', label: '人数', def: 2,
      desc: '3人・4人では、広い盤に 赤・黄・緑・紫 で順番に落とす（下の「3人以上の盤」）',
      choices: [[2, '2人'], [3, '3人'], [4, '4人']],
    },
    {
      key: 'wide', label: '3人以上の盤', def: 'auto',
      desc: '3人・4人で遊ぶときの盤の大きさ。どれも4つ並べたら勝ち',
      choices: WIDE_CHOICES,
    },
    {
      key: 'block', label: 'じゃま石', def: 'off',
      desc: '始めから誰のものでもない灰色の石が、いくつかの列に落としてある（置き場所は毎回変わる）。じゃま石をはさんだ並びでは勝てない',
      choices: [['off', 'なし'], ['on', 'あり']],
    },
    {
      key: 'pop', label: 'ポップアウト', def: 'off',
      desc: '落とす代わりに、一番下の段にある自分のコマを抜いてもよい（2人のときだけ）。同じ盤面が3回出たら引き分け',
      choices: [['off', 'なし'], ['on', 'あり']],
    },
    CPU_SETTING,
  ],

  // CPU（2人）: 何手先まで読むかで強さを変える（よわい2・ふつう4・つよい6）。弱いほど適当に打つことがある
  cpu(s, p, rules) {
    if (s.n > 2) return wideCpu(s, rules);
    if (s.pop) {
      return boardCpu(this, s, rules, popLegal, score, {
        depth: { weak: 2, normal: 4, strong: 5 }, mistake: { weak: 0.35, normal: 0.12, strong: 0 },
      });
    }
    const legal = (x) => [3, 2, 4, 1, 5, 0, 6].filter((c) => x.grid[c] === null);
    return boardCpu(this, s, rules, legal, score, {
      depth: { weak: 2, normal: 4, strong: 6 }, mistake: { weak: 0.35, normal: 0.12, strong: 0 },
    });
  },

  init({ rules = {}, seed = 0 } = {}) {
    const n = rules.players ?? 2;
    const [w, h] = n >= 3 ? wideSize(rules.wide, n) : [7, 6];
    const st = { n, w, h, grid: Array(w * h).fill(null), turn: 0, last: null, won: null };
    if (rules.block === 'on') st.grid = blockers(w, h, n, seed);
    if (n === 2 && rules.pop === 'on') Object.assign(st, { pop: true, moves: 0, hist: { key: posKey(st.grid, 0), prev: null } });
    return st;
  },

  turn(s) { return s.turn; },

  apply(s, col) {
    if (s.pop) return popApply(s, col);
    if (!Number.isInteger(col) || col < 0 || col >= s.w || s.won) return null;
    const i = landing(s, col);
    if (i < 0) return null;
    const { list, byCell } = windowsOf(s.w, s.h);
    const grid = s.grid.slice();
    grid[i] = s.turn;
    const line = byCell[i].map((wi) => list[wi]).find((win) => win.every((x) => grid[x] === s.turn));
    return { ...s, grid, turn: (s.turn + 1) % s.n, last: i, won: line ? { winner: s.turn, cells: line } : null };
  },

  result(s) {
    if (s.won) return s.won;
    if (s.pop) return popLegal(s).length ? null : { winner: null, cells: [] };
    if (s.grid.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  info(s) {
    if (!s.pop || this.result(s)) return '';
    return '盤の下の「抜く」で、一番下の自分のコマを抜けます';
  },

  render(root, s, o) {
    const res = this.result(s);
    const win = new Set(res?.cells ?? []);
    root.innerHTML = '';
    root.className = 'board c4' + (s.n > 2 ? ' c4w' : '');
    root.style.setProperty('--cols', s.w);
    for (let c = 0; c < s.w; c++) {
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
      for (let r = 0; r < s.h; r++) {
        const i = r * s.w + c;
        const cell = document.createElement('span');
        cell.className = 'c4-cell';
        const v = s.grid[i];
        if (v !== null) {
          const disc = document.createElement('span');
          disc.className = 'c4-disc ' + (v === NEUTRAL ? 'pn' : 'p' + v);
          if (v === NEUTRAL) disc.title = 'じゃま石';
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
    if (!s.pop) return;
    // ポップアウト: 盤の下に、列ごとの「抜く」ボタン（自分のコマが一番下にある列だけ押せる）
    for (let c = 0; c < s.w; c++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'c4-pop';
      btn.textContent = '抜く';
      btn.setAttribute('aria-label', `${c + 1}列目の一番下を抜く`);
      if (o.canMove && s.grid[(s.h - 1) * s.w + c] === s.turn) {
        btn.classList.add('playable');
        btn.onclick = () => o.onMove({ pop: c });
      } else {
        btn.disabled = true;
      }
      root.append(btn);
    }
  },
};
