// 将棋（本将棋）。先手（プレイヤー0）は盤の下側、後手（プレイヤー1）は上側から始める。
// マスの番号 = 段 * 9 + 列。段0 が一段目（上）、列0 が 9筋（左）。つまり 筋 = 9 - 列、段 = 段番号 + 1。
// 駒の番号: 1歩 2香 3桂 4銀 5金 6角 7飛 8玉。成った駒は +8（9と 10成香 11成桂 12成銀 14馬 15龍）。
// 盤の値: 0 = 空、正の数 = 先手の駒、負の数 = 後手の駒。持ち駒 hands[p][駒の番号] = 枚数（1〜7）。
// 手: { f: 動かす駒のマス, t: 行き先, pr: 成るか } / { d: 打つ駒（1〜7）, t: 打つマス } / { resign: true }（投了。手番の人）
//
// 決めごと（本人の判断）: 駒落ちは詳細設定、持ち時間なし、千日手は公式どおり（同じ局面4回で引き分け、
//   王手を続けていた側の負け）、入玉の点数宣言は作らず 300手で引き分け。
// Claude の判断: 駒落ちでは駒を落とす側（上手）を先手（下側）として先に指す。香落ちで落とすのは 1筋の香。
//   投了は自分の番のときだけ押せる。

import { CPU_SETTING } from './util.js';

const PAWN = 1;
const LANCE = 2;
const KNIGHT = 3;
const GOLD = 5;
const KING = 8;
const MAX_PLY = 300;

const KANJI = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉', 9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '龍' };
const NOTE_NAME = { ...KANJI, 10: '成香', 11: '成桂', 12: '成銀' };
const FILES = '９８７６５４３２１';
const RANKS = '一二三四五六七八九';
const HANDICAPS = { none: '平手', lance: '香落ち', bishop: '角落ち', rook: '飛車落ち', two: '二枚落ち' };

// 動き（先手から見た向き。上が -1）
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const GOLD_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
const STEPS = {
  1: [[-1, 0]], 3: [[-2, -1], [-2, 1]], 4: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], 5: GOLD_STEPS,
  8: [...ORTHO, ...DIAG], 9: GOLD_STEPS, 10: GOLD_STEPS, 11: GOLD_STEPS, 12: GOLD_STEPS, 14: ORTHO, 15: DIAG,
};
const SLIDES = { 2: [[-1, 0]], 6: DIAG, 7: ORTHO, 14: DIAG, 15: ORTHO };
const STEP_SET = Object.fromEntries(Object.entries(STEPS).map(([k, v]) => [k, new Set(v.map((x) => x.join()))]));
const SLIDE_SET = Object.fromEntries(Object.entries(SLIDES).map(([k, v]) => [k, new Set(v.map((x) => x.join()))]));

const sgnOf = (side) => (side === 0 ? 1 : -1);
const base = (t) => (t > 8 ? t - 8 : t);
const canPromote = (t) => t <= 7 && t !== GOLD;
const inZone = (side, r) => (side === 0 ? r <= 2 : r >= 6);
// 成らないと動けなくなるところ（歩・香の最奥、桂の奥2段）
function mustPromote(t, side, r) {
  const far = side === 0 ? r : 8 - r;
  return ((t === PAWN || t === LANCE) && far === 0) || (t === KNIGHT && far <= 1);
}

function initialBoard(handicap) {
  const b = Array(81).fill(0);
  const back = [2, 3, 4, 5, 8, 5, 4, 3, 2];
  for (let c = 0; c < 9; c++) {
    b[8 * 9 + c] = back[c];
    b[c] = -back[c];
    b[6 * 9 + c] = PAWN;
    b[2 * 9 + c] = -PAWN;
  }
  b[7 * 9 + 1] = 6; // 先手の角 8八
  b[7 * 9 + 7] = 7; // 先手の飛 2八
  b[9 + 1] = -7; // 後手の飛 8二
  b[9 + 7] = -6; // 後手の角 2二
  // 駒落ち: 先手（上手）の駒を落とす
  if (handicap === 'lance') b[8 * 9 + 8] = 0;
  if (handicap === 'bishop' || handicap === 'two') b[7 * 9 + 1] = 0;
  if (handicap === 'rook' || handicap === 'two') b[7 * 9 + 7] = 0;
  return b;
}

/* ---------- 盤の上の計算（CPU の先読みでも使うので軽く作る） ---------- */

// side の駒が sq に利いているか
function attacked(board, sq, side) {
  const sgn = sgnOf(side);
  const r = Math.floor(sq / 9);
  const c = sq % 9;
  for (const [dr, dc] of [...ORTHO, ...DIAG]) {
    // 攻める駒から sq への向き（先手の向きに直したもの）
    const rel = [-dr * sgn, -dc * sgn].join();
    let rr = r + dr;
    let cc = c + dc;
    let dist = 1;
    while (rr >= 0 && rr < 9 && cc >= 0 && cc < 9) {
      const v = board[rr * 9 + cc];
      if (v !== 0) {
        if (v * sgn > 0) {
          const t = Math.abs(v);
          if (dist === 1 && STEP_SET[t]?.has(rel)) return true;
          if (SLIDE_SET[t]?.has(rel)) return true;
        }
        break;
      }
      rr += dr;
      cc += dc;
      dist++;
    }
  }
  // 桂
  for (const dc of [-1, 1]) {
    const rr = r + 2 * sgn;
    const cc = c + dc;
    if (rr >= 0 && rr < 9 && cc >= 0 && cc < 9 && board[rr * 9 + cc] === KNIGHT * sgn) return true;
  }
  return false;
}

const kingSq = (board, side) => board.indexOf(KING * sgnOf(side));

function pawnOnFile(board, side, c) {
  const v = PAWN * sgnOf(side);
  for (let r = 0; r < 9; r++) if (board[r * 9 + c] === v) return true;
  return false;
}

// 王を取る手も含めた、駒の動ける手（王手の放置は調べない）
function pseudoMoves(board, hands, side) {
  const out = [];
  const sgn = sgnOf(side);
  const add = (f, t, piece, rTo, rFrom) => {
    if (canPromote(piece) && (inZone(side, rFrom) || inZone(side, rTo))) {
      out.push({ f, t, pr: true });
      if (!mustPromote(piece, side, rTo)) out.push({ f, t, pr: false });
    } else {
      out.push({ f, t, pr: false });
    }
  };
  for (let i = 0; i < 81; i++) {
    const v = board[i];
    if (v * sgn <= 0) continue;
    const t = Math.abs(v);
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (const [dr, dc] of STEPS[t] ?? []) {
      const rr = r + dr * sgn;
      const cc = c + dc * sgn;
      if (rr < 0 || rr > 8 || cc < 0 || cc > 8) continue;
      if (board[rr * 9 + cc] * sgn > 0) continue;
      add(i, rr * 9 + cc, t, rr, r);
    }
    for (const [dr, dc] of SLIDES[t] ?? []) {
      let rr = r + dr * sgn;
      let cc = c + dc * sgn;
      while (rr >= 0 && rr < 9 && cc >= 0 && cc < 9) {
        const x = board[rr * 9 + cc];
        if (x * sgn > 0) break;
        add(i, rr * 9 + cc, t, rr, r);
        if (x !== 0) break;
        rr += dr * sgn;
        cc += dc * sgn;
      }
    }
  }
  for (let d = 1; d <= 7; d++) {
    if (!hands[side][d]) continue;
    for (let j = 0; j < 81; j++) {
      if (board[j] !== 0) continue;
      const r = Math.floor(j / 9);
      if (mustPromote(d, side, r)) continue; // 行き所のない駒
      if (d === PAWN && pawnOnFile(board, side, j % 9)) continue; // 二歩
      out.push({ d, t: j });
    }
  }
  return out;
}

// 手を指した後の盤と持ち駒（元は変えない）。取った駒の番号も返す
function make(board, hands, side, m) {
  const b = board.slice();
  const h = [hands[0].slice(), hands[1].slice()];
  const sgn = sgnOf(side);
  let captured = 0;
  if (m.d) {
    b[m.t] = m.d * sgn;
    h[side][m.d]--;
  } else {
    captured = Math.abs(b[m.t]);
    if (captured) h[side][base(captured)]++;
    const t = Math.abs(b[m.f]);
    b[m.t] = (m.pr ? t + 8 : t) * sgn;
    b[m.f] = 0;
  }
  return { b, h, captured };
}

function legalMoves(board, hands, side, checkDropMate = true) {
  const list = [];
  for (const m of pseudoMoves(board, hands, side)) {
    const { b, h } = make(board, hands, side, m);
    if (attacked(b, kingSq(b, side), 1 - side)) continue; // 王手を放置する手
    // 打ち歩詰め: 歩を打って王手し、相手に逃げ道が無いなら反則
    if (checkDropMate && m.d === PAWN) {
      const them = 1 - side;
      const k = kingSq(b, them);
      if (k >= 0 && attacked(b, k, side) && !legalMoves(b, h, them, false).length) continue;
    }
    list.push(m);
  }
  return list;
}

const sameMove = (a, b) => a.t === b.t && (a.d ? a.d === b.d : a.f === b.f && !!a.pr === !!b.pr);
const posKey = (board, hands, turn) => `${board.join(',')}|${hands[0].join('')}|${hands[1].join('')}|${turn}`;

/* ---------- CPU ---------- */

const VALUE = { 1: 100, 2: 300, 3: 350, 4: 500, 5: 600, 6: 800, 7: 1000, 8: 0, 9: 600, 10: 600, 11: 600, 12: 600, 14: 1100, 15: 1300 };
const MATE = 1e6;

// side から見た形勢: 駒の点数（持ち駒は少し高め）＋歩と銀を前へ進めると少し加点
function evaluate(board, hands, side) {
  let v = 0;
  for (let i = 0; i < 81; i++) {
    const x = board[i];
    if (!x) continue;
    const t = Math.abs(x);
    let s = VALUE[t];
    if (t === PAWN || t === 4) {
      const r = Math.floor(i / 9);
      s += (x > 0 ? 6 - r : r - 2) * 4;
    }
    v += x > 0 ? s : -s;
  }
  for (let d = 1; d <= 7; d++) v += (hands[0][d] - hands[1][d]) * VALUE[d] * 1.1;
  return side === 0 ? v : -v;
}

// 決まった時間で打ち切る先読み。時間切れなら null
function searchRoot(board, hands, side, moves, depth, deadline) {
  let nodes = 0;
  let aborted = false;
  const nega = (b, h, s, d, alpha, beta) => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    if (d === 0) return evaluate(b, h, s);
    const ms = pseudoMoves(b, h, s);
    if (!ms.length) return -MATE;
    // 駒を取る手から先に読む（打ち切りが効きやすい）
    const scored = ms.map((m) => [m, m.d ? 0 : Math.abs(b[m.t]) === KING ? MATE : VALUE[Math.abs(b[m.t])] ?? 0]);
    scored.sort((x, y) => y[1] - x[1]);
    let best = -Infinity;
    for (const [m] of scored) {
      if (!m.d && Math.abs(b[m.t]) === KING) return MATE + d; // 王が取れる＝相手は王手を放置した
      const n = make(b, h, s, m);
      const v = -nega(n.b, n.h, 1 - s, d - 1, -beta, -alpha);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };
  const scores = [];
  for (const m of moves) {
    const n = make(board, hands, side, m);
    const v = -nega(n.b, n.h, 1 - side, depth - 1, -Infinity, Infinity);
    if (aborted) return null;
    scores.push([m, v]);
  }
  return scores;
}

function cpuMove(s, rules) {
  const level = { weak: 1, normal: 1, strong: 1 }[rules?.cpu] ? rules.cpu : 'normal';
  const moves = legalMoves(s.board, s.hands, s.turn);
  const mistake = { weak: 0.3, normal: 0.08, strong: 0 }[level];
  if (Math.random() < mistake) return moves[Math.floor(Math.random() * moves.length)];
  const maxDepth = { weak: 1, normal: 2, strong: 3 }[level];
  const deadline = Date.now() + 1500;
  let scores = null;
  for (let d = 1; d <= maxDepth; d++) { // 浅い読みから順に。時間切れならひとつ前の結果を使う
    const r = searchRoot(s.board, s.hands, s.turn, moves, d, deadline);
    if (!r) break;
    scores = r;
  }
  const best = Math.max(...scores.map((x) => x[1]));
  const top = scores.filter((x) => x[1] >= best - (level === 'strong' ? 0 : 10)).map((x) => x[0]);
  return top[Math.floor(Math.random() * top.length)];
}

/* ---------- 棋譜の書き方 ---------- */

function notation(s, m, prevTo) {
  const mark = s.turn === 0 ? '▲' : '△';
  const sq = m.t === prevTo ? '同' : FILES[m.t % 9] + RANKS[Math.floor(m.t / 9)];
  if (m.d) return `${mark}${sq}${KANJI[m.d]}打`;
  const t = Math.abs(s.board[m.f]);
  const r1 = Math.floor(m.f / 9);
  const r2 = Math.floor(m.t / 9);
  let suffix = '';
  if (m.pr) suffix = '成';
  else if (canPromote(t) && (inZone(s.turn, r1) || inZone(s.turn, r2))) suffix = '不成';
  return `${mark}${sq}${NOTE_NAME[t]}${suffix}`;
}

/* ---------- 画面 ---------- */

let ui = { key: null, from: null, drop: null, promo: null }; // 選んでいる駒・成るかの確認（描き直しで消えないよう外に持つ）

export default {
  id: 'shogi',
  name: '将棋',
  icon: '☗',
  desc: '本将棋。駒落ちのハンデも選べる',
  ready: true,
  players: ['☗先手', '☖後手'],
  settings: [
    { key: 'handicap', label: '駒落ち', desc: '先手（上手）が駒を落として先に指す。腕の差があるときに', def: 'none', choices: Object.entries(HANDICAPS) },
    CPU_SETTING,
  ],

  init({ rules = {} } = {}) {
    const handicap = HANDICAPS[rules.handicap] ? rules.handicap : 'none';
    const board = initialBoard(handicap);
    const hands = [Array(8).fill(0), Array(8).fill(0)];
    return { board, hands, turn: 0, ply: 0, handicap, last: null, keys: [posKey(board, hands, 0)], checks: [false], result: null };
  },

  turn(s) { return s.turn; },
  result(s) { return s.result; },

  apply(s, m) {
    if (s.result || !m || typeof m !== 'object') return null;
    if (m.resign === true) {
      return { ...s, result: { winner: 1 - s.turn, cells: [], reason: `${s.turn === 0 ? '先手' : '後手'}の投了` }, last: { resign: true, side: s.turn } };
    }
    const legal = legalMoves(s.board, s.hands, s.turn);
    if (!legal.some((x) => sameMove(x, m))) return null;
    const mv = m.d ? { d: m.d, t: m.t } : { f: m.f, t: m.t, pr: !!m.pr };
    const { b, h } = make(s.board, s.hands, s.turn, mv);
    const next = 1 - s.turn;
    const check = attacked(b, kingSq(b, next), s.turn);
    const key = posKey(b, h, next);
    const keys = [...s.keys, key];
    const checks = [...s.checks, check];
    const ply = s.ply + 1;
    const n = {
      board: b, hands: h, turn: next, ply, handicap: s.handicap, keys, checks, result: null,
      last: { ...mv, side: s.turn, note: notation(s, mv, s.last?.t), check },
    };
    if (!legalMoves(b, h, next).length) {
      n.result = { winner: s.turn, cells: [], reason: '詰み' };
    } else if (keys.filter((k) => k === key).length >= 4) {
      // 千日手。くり返しの間ずっと王手をかけていた側の負け
      const from = keys.indexOf(key);
      const by = (side) => checks.slice(from + 1).filter((_, i) => (from + i) % 2 === side);
      const perpetual = [0, 1].find((side) => by(side).length && by(side).every(Boolean));
      n.result = perpetual === undefined
        ? { winner: null, cells: [], reason: '千日手' }
        : { winner: 1 - perpetual, cells: [], reason: '連続王手の千日手' };
    } else if (ply >= MAX_PLY) {
      n.result = { winner: null, cells: [], reason: `${MAX_PLY}手に達した` };
    }
    return n;
  },

  // CPU: 駒の損得で何手先まで読むか（よわい1・ふつう2・つよい3）。読みは1.5秒で打ち切る。弱いほど適当に指すことがある
  cpu(s, p, rules) { return cpuMove(s, rules); },

  info(s) {
    const parts = [];
    if (s.handicap !== 'none') parts.push(`${HANDICAPS[s.handicap]}（☗先手が上手）`);
    if (s.last?.note) parts.push(`${s.ply}手目 ${s.last.note}`);
    if (s.result) parts.push(s.result.reason);
    else if (s.last?.check) parts.push('<b class="sg-check-text">王手！</b>');
    return parts.join('　');
  },

  render(root, s, o) {
    const draw = () => this.render(root, s, o);
    // 自分の駒が下に来るように。観戦と同じ画面の対局では先手が下
    const bottom = o.me === 1 ? 1 : 0;
    const key = `${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, from: null, drop: null, promo: null };
    const can = o.canMove && !s.result;
    const legal = can ? legalMoves(s.board, s.hands, s.turn) : [];
    const targets = new Set();
    if (ui.from !== null) for (const m of legal) if (m.f === ui.from) targets.add(m.t);
    if (ui.drop !== null) for (const m of legal) if (m.d === ui.drop) targets.add(m.t);
    const movable = new Set(legal.filter((m) => !m.d).map((m) => m.f));
    const droppable = new Set(legal.filter((m) => m.d).map((m) => m.d));
    const inCheck = !s.result && attacked(s.board, kingSq(s.board, s.turn), 1 - s.turn);
    const checkedKing = inCheck ? kingSq(s.board, s.turn) : -1;

    root.innerHTML = '';
    root.className = 'board sg';

    const pick = (t) => {
      const opts = legal.filter((m) => m.t === t && (ui.drop !== null ? m.d === ui.drop : m.f === ui.from));
      if (!opts.length) return;
      if (opts.length === 2) { ui.promo = { f: ui.from, t }; draw(); return; } // 成る・成らないを選ぶ
      o.onMove(opts[0]);
    };

    const handRow = (side) => {
      const row = document.createElement('div');
      row.className = 'sg-hand' + (side === bottom ? ' mine' : '');
      const label = document.createElement('span');
      label.className = 'sg-hand-label';
      label.textContent = `${this.players[side]}の持ち駒`;
      row.append(label);
      let any = false;
      for (const d of [7, 6, 5, 4, 3, 2, 1]) {
        const n = s.hands[side][d];
        if (!n) continue;
        any = true;
        const ok = can && side === s.turn && droppable.has(d);
        const e = document.createElement(ok ? 'button' : 'span');
        e.className = 'sg-hand-piece' + (ok ? ' playable' : '') + (ui.drop === d && side === s.turn ? ' selected' : '');
        e.innerHTML = `<span class="sg-piece${side === bottom ? '' : ' flip'}">${KANJI[d]}</span>${n > 1 ? `<small>${n}</small>` : ''}`;
        if (ok) {
          e.type = 'button';
          e.onclick = () => {
            ui = { ...ui, from: null, promo: null, drop: ui.drop === d ? null : d };
            draw();
          };
        }
        row.append(e);
      }
      if (!any) {
        const none = document.createElement('span');
        none.className = 'sg-hand-none';
        none.textContent = 'なし';
        row.append(none);
      }
      return row;
    };

    root.append(handRow(1 - bottom));

    const wrap = document.createElement('div');
    wrap.className = 'sg-wrap';
    const files = document.createElement('div');
    files.className = 'sg-files';
    for (let k = 0; k < 9; k++) {
      const span = document.createElement('span');
      span.textContent = bottom === 0 ? 9 - k : k + 1;
      files.append(span);
    }
    const grid = document.createElement('div');
    grid.className = 'sg-grid';
    for (let k = 0; k < 81; k++) {
      const i = bottom === 0 ? k : 80 - k;
      const v = s.board[i];
      const mine = v !== 0 && (v > 0 ? 0 : 1) === s.turn;
      const isTarget = targets.has(i);
      const isMovable = can && mine && movable.has(i);
      const cell = document.createElement(isTarget || isMovable ? 'button' : 'div');
      cell.className = 'sg-cell';
      if (s.last && !s.last.resign && s.last.t === i) cell.classList.add('last', ...(o.fresh ? ['pop'] : []));
      if (i === ui.from) cell.classList.add('selected');
      if (isTarget) cell.classList.add('target');
      if (i === checkedKing) cell.classList.add('checked');
      if (v) {
        const t = Math.abs(v);
        const owner = v > 0 ? 0 : 1;
        const p = document.createElement('span');
        p.className = 'sg-piece' + (owner === bottom ? '' : ' flip') + (t > 8 ? ' promoted' : '');
        p.textContent = t === KING && owner === 1 ? '王' : KANJI[t];
        cell.append(p);
      }
      if (isTarget || isMovable) {
        cell.type = 'button';
        cell.onclick = () => {
          if (isTarget) { pick(i); return; }
          ui = { ...ui, drop: null, promo: null, from: ui.from === i ? null : i };
          draw();
        };
      }
      grid.append(cell);
    }
    const ranks = document.createElement('div');
    ranks.className = 'sg-ranks';
    for (let k = 0; k < 9; k++) {
      const span = document.createElement('span');
      span.textContent = RANKS[bottom === 0 ? k : 8 - k];
      ranks.append(span);
    }
    wrap.append(files, grid, ranks);
    root.append(wrap);

    root.append(handRow(bottom));

    if (ui.promo) {
      const box = document.createElement('div');
      box.className = 'cc-picker sg-promo';
      box.innerHTML = '<p>成りますか？</p>';
      const row = document.createElement('div');
      for (const [text, pr] of [['成る', true], ['成らない', false]]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (pr ? 'primary' : 'secondary');
        b.textContent = text;
        b.onclick = () => { const { f, t } = ui.promo; ui.promo = null; o.onMove({ f, t, pr }); };
        row.append(b);
      }
      box.append(row);
      root.append(box);
    }

    if (can) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const hint = document.createElement('p');
      hint.className = 'pk-hint';
      hint.textContent = ui.from !== null || ui.drop !== null ? '光っているマスをタップすると指せます' : '動かす駒か持ち駒をタップしてください';
      const resign = document.createElement('button');
      resign.type = 'button';
      resign.className = 'btn ghost';
      resign.textContent = '投了する';
      resign.onclick = () => { if (confirm('投了しますか？（負けになります）')) o.onMove({ resign: true }); };
      actions.append(resign);
      root.append(hint, actions);
    }
  },
};

// テスト用
export const _test = { legalMoves, attacked, kingSq, initialBoard, evaluate };
