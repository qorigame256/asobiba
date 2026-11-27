// 色うつり四目（2026-11-27 本人が選んだ、Claude が考えた独自ルール。分かれ目は Claude の推奨を本人が承認）。2人。
// 盤の駒はだれのものでもなく、動かした駒がその人の色になる。直前に動いた駒は動かせない。自分の色を4つ並べたら勝ち。
//
// 本人が承認した分かれ目: 6×6 の盤に色の無い駒12個を決まった形で置いて始める。駒は縦横の空きマスへ1マス動く。
//   縦横斜めに自分の色が4つで勝ち。40手で決まらなければ引き分け。
// Claude の判断: 並べ方は LAYOUT（下）。つよいどうしの先手・後手の勝ち数で選んだ（実測は LAYOUT の上）。
//   動かせるのはどの色の駒でも（色の無い駒・自分の色・相手の色）。相手の色の駒を動かすと自分の色になる（相手の並びを崩せる）。
//   「直前に動いた駒」は、相手がいま動かした駒（そのマスにある駒）。始めの1手には無い。
//   色が変わるのは動かした駒だけなので、並びができるのは動かした人だけ（相手の並びが同時にできることは無い）。
//   40手は2人合わせて（1人20手）。番が来たのに動かせる駒が無い人の負け（駒12個では まず起きない）。
//
// 局面: { board: マスごとの駒（null 空き・-1 色の無い駒・0/1 その席の色）, turn, last: { f, d, was: 動かす前の色 } か null, ply, won }。
// 手 = 動かす駒のマス * 36 + 行き先のマス（マス = 段*6+列。段0が一番上）。
//
// 「自分の色は動かせない」（2026-11-27 の49回目の案。本人が選んだ。詳細設定 lockOwn、最初は なし）: 動かせるのは色の無い駒と相手の色の駒だけ。
// Claude の判断: 直前に動いた駒は動かせない決まりはそのまま。番が来たのに動かせる駒が無い人の負けもそのまま（自分の色ばかりになると起きうる）。
//   ありのときだけ局面に lockOwn: true を持つ（なしなら今までと同じ局面）。

import { CPU_SETTING, PEEK_SETTING, DANGER_SETTING, dangerMoves, dangerOn, peekMark, boardCpu, boardJudge, grabbable, justDragged, winLine, col } from './util.js';

const N = 6;
const CELLS = N * N;
const NONE = -1;
export const MAX_PLY = 40;
export const NEED = 4;

// 始めの並べ方（'X' が色の無い駒）。四角い輪。
// 2026-11-27 の実測: つよい（3手読み）どうしは、どの並べ方でもほとんど引き分け（相手の色の駒を動かせば並びを崩せるため。
//   輪・X字・ひし形・2本の棒・四隅・まんなかの固まり など8つを各10局で、決着は合わせて2局）。輪で40局は 1番手 1勝・2番手 0勝・引き分け 39。
//   1割だけ適当に打たせたつよいどうしは 1番手 6勝・2番手 9勝・引き分け 25（40局）、ふつうどうし 18・11・71、よわいどうし 48・46・6（各100局）で、先手の偏りは小さい
export const LAYOUT = [
  '......',
  '.XXXX.',
  '.X..X.',
  '.X..X.',
  '.XXXX.',
  '......',
];

export function startBoard(layout = LAYOUT) {
  const b = Array(CELLS).fill(null);
  layout.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') b[r * N + c] = NONE; }));
  return b;
}

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
// 4つ並びの窓（よこ 18・たて 18・ななめ 9×2 = 54）
const WINDOWS = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const er = r + dr * (NEED - 1);
    const ec = c + dc * (NEED - 1);
    if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
    WINDOWS.push(Array.from({ length: NEED }, (_, k) => (r + dr * k) * N + c + dc * k));
  }
}

// lock（直前に動いた駒のマス）と、色が skip の駒（自分の色は動かせないときの自分の色。無ければ undefined）を除いた、動かせる手の一覧
export function movesOf(b, lock, skip) {
  const out = [];
  for (let f = 0; f < CELLS; f++) {
    if (b[f] === null || f === lock || b[f] === skip) continue;
    const r = Math.floor(f / N);
    const c = f % N;
    for (const [dr, dc] of ORTH) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N || b[rr * N + cc] !== null) continue;
      out.push(f * CELLS + rr * N + cc);
    }
  }
  return out;
}
const lockOf = (s) => (s.last ? s.last.d : -1);
// 番の人（p）が打てる手
const legalOf = (s, p = s.turn) => movesOf(s.board, lockOf(s), s.lockOwn ? p : undefined);

// マス d を通る、色 p のいちばん長い並び（4つ以上の並びのマスをまとめて返す。無ければ空）
export function lineAt(b, d, p) {
  const r0 = Math.floor(d / N);
  const c0 = d % N;
  const out = new Set();
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const run = [d];
    for (const sg of [1, -1]) {
      for (let r = r0 + dr * sg, c = c0 + dc * sg; r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === p; r += dr * sg, c += dc * sg) run.push(r * N + c);
    }
    if (run.length >= NEED) for (const x of run) out.add(x);
  }
  return [...out];
}

/* ---------- CPU ---------- */

// 崩した並びが割れる（2026-11-27 の UI・UX の14回目）: 盤 b のマス f を通る、色 q の3つ以上の並び（いちばん長いもの。端から順のマス。無ければ null）
export function runAt(b, f, q) {
  const r0 = Math.floor(f / N);
  const c0 = f % N;
  let best = null;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let r = r0;
    let c = c0;
    while (r - dr >= 0 && r - dr < N && c - dc >= 0 && c - dc < N && b[(r - dr) * N + c - dc] === q) { r -= dr; c -= dc; }
    const run = [];
    for (; r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === q; r += dr, c += dc) run.push(r * N + c);
    if (run.length >= NEED - 1 && (!best || run.length > best.length)) best = run;
  }
  return best;
}

// あぶない所の知らせ（2026-11-27 の UI・UX の14回目。詳細設定 danger。util.js の dangerMoves）: 相手がいまの盤で駒を1つ動かして4つ並べられる行き先のマス（Set）。
// 相手の次の番では、いま自分が動かす駒が「直前に動いた駒」になるので、相手の直前の駒の縛りは外して数える（Claude の判断）。game は色うつり四目（render の this）
export function dangerCells(game, s) {
  return new Set([...dangerMoves(game, { ...s, last: null }, 2, (t) => legalOf(t))].map((m) => m % CELLS));
}

// p から見た点数: 4つの窓ごとに、相手の色が無ければ自分の色の数で足し、自分の色が無ければ相手の色の数で引く。
// 窓の中の色の無い駒・空きは、あとで自分の色にできる所として少しだけ数える
const W = [0, 1, 5, 24];
export function score(s, p) {
  const b = s.board;
  let v = 0;
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const i of w) {
      const x = b[i];
      if (x === p) mine++;
      else if (x !== null && x !== NONE) theirs++;
    }
    if (mine && !theirs) v += W[mine];
    else if (theirs && !mine) v -= W[theirs];
  }
  return v;
}

let ui = { key: null, from: null }; // 選んでいる駒（通信で描き直されても消えないよう外に持つ）

// 崩した並び run（端から順のマス）に、その人の色の線を出し、マス f の所で2つに割って落とす。線は盤の入れ物（grid）の中に置き、動き終わったら消す
function crackLine(grid, run, f, q) {
  if (!grid.isConnected) return;
  const g = grid.getBoundingClientRect();
  const ctr = (i) => { const r = grid.children[i].getBoundingClientRect(); return [r.left + r.width / 2 - g.left, r.top + r.height / 2 - g.top]; };
  const a = ctr(run[0]);
  const z = ctr(run[run.length - 1]);
  const k = run.indexOf(f);
  // 割れる所: 動かした駒の真ん中。端の駒なら、となりの駒との間
  const m = k > 0 && k < run.length - 1 ? ctr(f) : (() => { const p = ctr(f); const n = ctr(run[k === 0 ? 1 : run.length - 2]); return [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]; })();
  const ang = Math.atan2(z[1] - a[1], z[0] - a[0]) * 180 / Math.PI;
  [[a, m, -1], [m, z, 1]].forEach(([p, e, dir]) => {
    const len = Math.hypot(e[0] - p[0], e[1] - p[1]);
    if (len < 2) return;
    const bar = document.createElement('span');
    bar.className = 'ut-crack p' + col(q);
    bar.setAttribute('aria-hidden', 'true');
    Object.assign(bar.style, { left: p[0] + 'px', top: p[1] + 'px', width: len + 'px' });
    bar.style.setProperty('--a', ang + 'deg');
    bar.style.setProperty('--dir', dir);
    bar.addEventListener('animationend', () => bar.remove());
    grid.append(bar);
  });
}

export default {
  id: 'utsuri',
  name: '色うつり四目',
  icon: '🎨',
  desc: '駒はだれのものでもなく、動かした駒が自分の色になる。自分の色を4つ並べたら勝ち',
  ready: true,
  keepColor: true, // 続けて遊ぶ間は、その人の色を変えない（util.js の col）
  players: ['赤', '青'],
  settings: [
    { key: 'lockOwn', label: '自分の色は動かせない', desc: '動かせるのは色の無い駒と相手の色の駒だけ。自分の色の駒は、相手に動かされるまでそのまま', def: false, choices: [[false, 'なし'], [true, 'あり']] },
    DANGER_SETTING,
    PEEK_SETTING,
    CPU_SETTING,
  ],

  // CPU: 何手先まで読むかで強さを変える（4手読みは1手に最長2.4秒かかり、引き分けばかりで強くもならなかったので つよい は3手）。
  //   実測（強い方の勝ち・負け・引き分け。2026-11-27）: ふつう-よわい 23・4・3（30局）、つよい-ふつう 6・0・14（20局）、つよい-よわい 27・0・3（30局）。1手の最長 約80ms
  cpu(s, p, rules) {
    return boardCpu(this, s, rules, (x) => legalOf(x), score, {
      depth: { weak: 1, normal: 2, strong: 3 }, mistake: { weak: 0.4, normal: 0.15, strong: 0 },
    });
  },

  // 形勢（util.js の boardJudge）: 4つの窓の数え方を2手先まで読む
  judge(s) { return boardJudge(this, s, (x) => legalOf(x), score, 2, 30); },

  init({ rules = {} } = {}) {
    const s = { board: startBoard(), turn: 0, last: null, ply: 0, won: null };
    return rules.lockOwn === true ? { ...s, lockOwn: true } : s;
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.won || !Number.isInteger(m) || m < 0 || m >= CELLS * CELLS) return null;
    if (!legalOf(s).includes(m)) return null;
    const f = Math.floor(m / CELLS);
    const d = m % CELLS;
    const p = s.turn;
    const board = s.board.slice();
    const was = board[f];
    board[f] = null;
    board[d] = p;
    const ply = s.ply + 1;
    const line = lineAt(board, d, p);
    let won = null;
    if (line.length) won = { winner: p, cells: line };
    else if (ply >= MAX_PLY) won = { winner: null, long: true, cells: [] };
    else if (!movesOf(board, d, s.lockOwn ? 1 - p : undefined).length) won = { winner: p, stuck: true, cells: [] };
    return { ...s, board, turn: 1 - p, last: { f, d, was }, ply, won };
  },

  result(s) { return s.won; },

  sound() { return 'place'; },

  info(s) {
    const n = (p) => s.board.filter((v) => v === p).length;
    let html = `<b class="pl p${col(0)}">${this.players[col(0)]} ${n(0)}個</b>　−　<b class="pl p${col(1)}">${this.players[col(1)]} ${n(1)}個</b>`;
    if (s.won?.long) html += `<br>${MAX_PLY}手になったので引き分け`;
    else if (s.won?.stuck) html += `<br>${this.players[col(1 - s.won.winner)]}は動かせる駒が無くなった`;
    else if (!s.won && s.gave === undefined) html += `　<small class="ut-left">あと${MAX_PLY - s.ply}手</small>`;
    return html;
  },

  render(root, s, o) {
    const draw = () => this.render(root, s, o);
    const over = !!s.won || s.gave !== undefined;
    const key = `${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, from: null };
    const can = o.canMove && !over;
    const lock = lockOf(s);
    const legal = can ? legalOf(s) : [];
    const movable = new Set(legal.map((m) => Math.floor(m / CELLS)));
    const targets = new Set(ui.from === null ? [] : legal.filter((m) => Math.floor(m / CELLS) === ui.from).map((m) => m % CELLS));
    const win = new Set(s.won?.cells ?? []);
    const danger = dangerOn(o) && !over ? dangerCells(this, s) : new Set();

    root.innerHTML = '';
    root.className = 'board ut';
    const grid = document.createElement('div');
    grid.className = 'ut-grid';
    grid.style.setProperty('--pt', `var(--p${col(s.turn)})`); // 行き先の印に使う、番の人の色
    const winEls = [];
    for (let i = 0; i < CELLS; i++) {
      const v = s.board[i];
      const isTarget = targets.has(i);
      const isMovable = movable.has(i);
      const cell = document.createElement(isTarget || isMovable ? 'button' : 'div');
      cell.className = 'ut-cell';
      if (s.last && (s.last.d === i || s.last.f === i)) cell.classList.add('last');
      if (i === ui.from) cell.classList.add('selected');
      if (isTarget) { cell.classList.add('target'); cell.dataset.drop = i; } // data-drop: つまんだ駒を離せる所
      if (danger.has(i)) cell.classList.add('danger');
      peekMark(cell, i, o, isTarget, () => ({ f: ui.from, d: null })); // 相手の迷いが見える（main.js の o.peek・o.peekIn）
      if (v !== null) {
        const disc = document.createElement('span');
        disc.className = 'ut-disc ' + (v === NONE ? 'none' : 'p' + col(v)) + (win.has(i) ? ' win' : '');
        const moved = s.last && s.last.d === i;
        // 動かした駒は元のマスから滑ってきて置かれる（main.js の flyPlay）。色が変わった駒はくるっと回って染まる
        disc.dataset.fly = moved ? `mv:${s.ply}` : `sq:${i}`;
        if (moved) {
          Object.assign(disc.dataset, { flyFrom: `sq:${s.last.f}`, flySlide: '' });
          disc.dataset.last = 'still'; // 決め手のスロー（main.js の slowFinish）: 駒は滑ってくるので寄せるだけ
          if (o.fresh && s.last.was !== v) disc.classList.add('dye');
        }
        if (i === lock && !over) {
          disc.classList.add('locked'); // 直前に動いた駒（いまは動かせない）
          cell.setAttribute('aria-label', '直前に動いた駒（動かせない）');
        }
        if (win.has(i)) winEls.push(cell);
        cell.append(disc);
      }
      if (isTarget || isMovable) {
        cell.type = 'button';
        cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${i % N + 1}列目`);
        cell.onclick = () => {
          if (justDragged()) return;
          if (isTarget) { const f = ui.from; ui = { ...ui, from: null }; o.onMove(f * CELLS + i); return; }
          ui = { ...ui, from: ui.from === i ? null : i };
          draw();
        };
        // 指でつまんで動かす（util.js の grabbable）
        if (isMovable) grabbable(cell, { piece: () => cell.querySelector('.ut-disc'), pick: () => { ui = { ...ui, from: i }; draw(); }, drop: (t) => { if (t !== null && ui.from === i) { ui = { ...ui, from: null }; o.onMove(i * CELLS + Number(t)); } } });
      }
      grid.append(cell);
    }
    root.append(grid);
    if (winEls.length) winLine(grid, winEls, o.fresh, 'ut:' + [...win].join(','), 420);
    // 崩した並びが割れる（同じ14回目）: 相手の色の駒を動かして、その駒を通る相手の3つ以上の並びを崩したとき、その並びに線を出し、動かした駒の所で2つに割って落とす
    if (o.fresh && s.last && s.last.was !== NONE && s.last.was !== s.board[s.last.d] && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      const b0 = s.board.slice();
      b0[s.last.d] = null;
      b0[s.last.f] = s.last.was;
      const run = runAt(b0, s.last.f, s.last.was);
      if (run) setTimeout(() => crackLine(grid, run, s.last.f, s.last.was), 0); // 測るのは描き直しが済んでから（CLAUDE.md の「描き直しの途中で測らない」）
    }
    o.peek?.({ f: ui.from, d: null, a: null }); // 相手の迷いが見える: いまの選びを知らせる
  },
};
