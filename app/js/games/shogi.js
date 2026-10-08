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
// 詳細設定「盤」で5五将棋にもできる（2026-10-05 本人の決定。決まりは Claude の推奨を本人が承認）:
//   5×5 の盤に 王・金・銀・角・飛・歩 を1枚ずつ（公式の並べ方）。成れるのは相手側の一番奥の1段だけ。二歩・打ち歩詰めは禁止。
//   千日手は本将棋と同じ。200手で引き分け。駒落ち・3人とは組み合わせない。マスの番号は 段 * 5 + 列（列0 が 5筋）。
//   盤の大きさ N は盤の長さから決める（sizeOf）。
// 詳細設定「持ち駒」（2026-10-06 本人の決定。最初は「使う」）: 「使わない」にすると、取った駒は盤から消えるだけで打てない（チェスのよう）。
//   Claude の判断: 2人の本将棋と5五将棋だけ（3人・3×4 は今までどおり）。駒落ちとは一緒に使える。打ち歩詰めなどの決まりは打たないので関係なくなる。
//   作り: 持ち駒の hands[p][0]（駒の番号0は使っていない）を NO_HAND にしておき、make() が取った駒を持ち駒に足さない（CPU の読みも同じ make を通る）。
// 詳細設定「盤」の 3×4（動物の駒）は shogi34.js に任せる（2026-10-06 本人の決定。局面に zoo: true を持つ）。2人だけ・駒落ちとは組み合わせない。
// 詳細設定「いつも成る」（2026-10-07 本人の決定。最初は なし）: ありにすると、成れる手はいつも成る（成らない手 pr: false は反則）。
//   局面に auto: true を持ち、pseudoMoves / legalMoves が成らない手を作らない（CPU の読みも同じ）。画面は「成りますか？」を出さずに成る。
//   本将棋・5五将棋・3人将棋（shogi3.js）で効く。3×4 はもともとヒヨコが必ず成るので関係ない。なしのときの局面は今までと全く同じ。
// 詳細設定「トライ」（2026-10-07 本人の決定。最初は なし）: ありにすると、自分の玉が相手の玉の最初のマス（本将棋は 5一・5九、5五将棋は 5一・1五）に
//   入ったら勝ち。玉は利きのあるマスへ動けないので、入れた時点で「そこで取られない」は満たしている。入玉で長引いて 300手の引き分けになるのを防ぐ。
//   本将棋と5五将棋の2人だけ（3×4 はもとからトライがある・3人は使わない）。駒落ち・持ち駒なし・いつも成ると一緒に使える。
//   局面に trial: true を持つ（なしのときは今までと全く同じ形）。CPU の読みもトライを勝ちとして数える。
// 詳細設定「駒の並び」（2026-10-07 の18回目の案。最初は ふつう）: 「ばらばら」にすると、一番下の段の玉以外の8枚（香・桂・銀・金 2枚ずつ）の並びと、
//   角と飛の左右を、対局の種（seed）から毎回おまかせで決める（決まった序盤が使えない）。後手は先手と点対称の同じ並び。歩の段は今までどおり。
//   Claude の判断: 本将棋の2人・平手だけ（駒落ちを選んだときは駒落ちを優先して、ふつうの並び）。ふつうと全く同じ並びになったら引き直す。
//   局面に mixed: true を持つ（ふつうのときは今までと全く同じ形）。CPU の読みと点の付け方は駒の場所に頼らないので、そのまま。
// 詳細設定「王手の知らせ」（2026-10-07 の19回目の案。最初は あり）: 王手をかけた手が届いたら、盤に大きく「王手！」を1.5秒出し、
//   読み上げで「王手！」と言う（sound の 'oute'。🔊 がオフなら言わない）。なしでは今までどおり（状態の欄の「王手！」と赤いマスだけ）。
//   Claude の判断: 王手かどうかは局面から決める（送らない）ので、観戦の人の画面にも出る。出すのは新しく届いた手だけ（入り直し・ふりかえりでは出さない）。
//   詰み（決着）の手では出さない。本将棋・5五将棋・3人将棋（指した人の駒がほかの人の玉に利いた）・3×4（ライオンに利いた）のどれでも効く。
//   なしのときだけ局面に quiet: true を持つ（ありのときは今までと全く同じ形）。CPU の読みと apply の結果は変えない。

import { CPU_SETTING, mulberry32 } from './util.js';
import * as three from './shogi3.js';
import * as zoo from './shogi34.js';

const PAWN = 1;
const LANCE = 2;
const KNIGHT = 3;
const GOLD = 5;
const KING = 8;
const MAX_PLY = 300;
const NO_HAND = -1; // hands[p][0] がこれなら、取った駒を持ち駒にしない（詳細設定「持ち駒」の「使わない」）
const MINI_MAX_PLY = 200;
const sizeOf = (board) => (board.length === 25 ? 5 : 9);
// トライのマス（side が入ったら勝ち）＝相手の玉の最初のマス。後手の玉は 5一（5五将棋も 5一）、先手の玉は 5九（5五将棋は 1五）
const trySq = (side, N) => (side === 0 ? (N === 5 ? 0 : 4) : N === 5 ? 24 : 76);
// m（王手を放置しない手）で side の玉がトライのマスに入るか
const isTry = (board, side, m) => !m.d && m.t === trySq(side, sizeOf(board)) && board[m.f] === KING * sgnOf(side);

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
// 敵陣（本将棋は奥3段、5五将棋は奥1段）
const inZone = (side, r, N) => { const z = N === 9 ? 3 : 1; return side === 0 ? r < z : r >= N - z; };
// 成らないと動けなくなるところ（歩・香の最奥、桂の奥2段）
function mustPromote(t, side, r, N) {
  const far = side === 0 ? r : N - 1 - r;
  return ((t === PAWN || t === LANCE) && far === 0) || (t === KNIGHT && far <= 1);
}

// 駒の並び「ばらばら」: 一番下の段（玉は真ん中のまま）と、角・飛の左右を rng で決める
function mixedBack(rng) {
  const STD = [2, 3, 4, 5, 5, 4, 3, 2];
  for (;;) {
    const rest = STD.slice();
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const swap = rng() < 0.5;
    if (!swap && rest.join() === STD.join()) continue; // ふつうと同じ並びは引き直す
    return { back: [...rest.slice(0, 4), KING, ...rest.slice(4)], swap };
  }
}

function initialBoard(handicap, rng = null) {
  const b = Array(81).fill(0);
  const mix = rng ? mixedBack(rng) : null;
  const back = mix ? mix.back : [2, 3, 4, 5, 8, 5, 4, 3, 2];
  for (let c = 0; c < 9; c++) {
    b[8 * 9 + c] = back[c];
    b[8 - c] = -back[c]; // 後手は点対称（ふつうの並びは左右対称なので今までと同じ）
    b[6 * 9 + c] = PAWN;
    b[2 * 9 + c] = -PAWN;
  }
  b[7 * 9 + 1] = 6; // 先手の角 8八
  b[7 * 9 + 7] = 7; // 先手の飛 2八
  b[9 + 1] = -7; // 後手の飛 8二
  b[9 + 7] = -6; // 後手の角 2二
  if (mix?.swap) { b[7 * 9 + 1] = 7; b[7 * 9 + 7] = 6; b[9 + 1] = -6; b[9 + 7] = -7; } // ばらばら: 角と飛を入れ替える
  // 駒落ち: 先手（上手）の駒を落とす
  if (handicap === 'lance') b[8 * 9 + 8] = 0;
  if (handicap === 'bishop' || handicap === 'two') b[7 * 9 + 1] = 0;
  if (handicap === 'rook' || handicap === 'two') b[7 * 9 + 7] = 0;
  return b;
}

// 5五将棋の並べ方。先手（下）: 5五飛 4五角 3五銀 2五金 1五玉 1四歩。後手はその点対称
function miniBoard() {
  const b = Array(25).fill(0);
  [7, 6, 4, 5, 8].forEach((v, c) => { b[20 + c] = v; b[4 - c] = -v; });
  b[15 + 4] = PAWN;
  b[5] = -PAWN;
  return b;
}

/* ---------- 盤の上の計算（CPU の先読みでも使うので軽く作る） ---------- */

// side の駒が sq に利いているか
function attacked(board, sq, side) {
  const N = sizeOf(board);
  const sgn = sgnOf(side);
  const r = Math.floor(sq / N);
  const c = sq % N;
  for (const [dr, dc] of [...ORTHO, ...DIAG]) {
    // 攻める駒から sq への向き（先手の向きに直したもの）
    const rel = [-dr * sgn, -dc * sgn].join();
    let rr = r + dr;
    let cc = c + dc;
    let dist = 1;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
      const v = board[rr * N + cc];
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
    if (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === KNIGHT * sgn) return true;
  }
  return false;
}

const kingSq = (board, side) => board.indexOf(KING * sgnOf(side));

function pawnOnFile(board, side, c, N) {
  const v = PAWN * sgnOf(side);
  for (let r = 0; r < N; r++) if (board[r * N + c] === v) return true;
  return false;
}

// 王を取る手も含めた、駒の動ける手（王手の放置は調べない）
// auto（詳細設定「いつも成る」）なら、成れる手の成らない方を作らない
function pseudoMoves(board, hands, side, auto = false) {
  const N = sizeOf(board);
  const out = [];
  const sgn = sgnOf(side);
  const add = (f, t, piece, rTo, rFrom) => {
    if (canPromote(piece) && (inZone(side, rFrom, N) || inZone(side, rTo, N))) {
      out.push({ f, t, pr: true });
      if (!auto && !mustPromote(piece, side, rTo, N)) out.push({ f, t, pr: false });
    } else {
      out.push({ f, t, pr: false });
    }
  };
  for (let i = 0; i < N * N; i++) {
    const v = board[i];
    if (v * sgn <= 0) continue;
    const t = Math.abs(v);
    const r = Math.floor(i / N);
    const c = i % N;
    for (const [dr, dc] of STEPS[t] ?? []) {
      const rr = r + dr * sgn;
      const cc = c + dc * sgn;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      if (board[rr * N + cc] * sgn > 0) continue;
      add(i, rr * N + cc, t, rr, r);
    }
    for (const [dr, dc] of SLIDES[t] ?? []) {
      let rr = r + dr * sgn;
      let cc = c + dc * sgn;
      while (rr >= 0 && rr < N && cc >= 0 && cc < N) {
        const x = board[rr * N + cc];
        if (x * sgn > 0) break;
        add(i, rr * N + cc, t, rr, r);
        if (x !== 0) break;
        rr += dr * sgn;
        cc += dc * sgn;
      }
    }
  }
  for (let d = 1; d <= 7; d++) {
    if (!hands[side][d]) continue;
    for (let j = 0; j < N * N; j++) {
      if (board[j] !== 0) continue;
      const r = Math.floor(j / N);
      if (mustPromote(d, side, r, N)) continue; // 行き所のない駒
      if (d === PAWN && pawnOnFile(board, side, j % N, N)) continue; // 二歩
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
    if (captured && h[side][0] !== NO_HAND) h[side][base(captured)]++;
    const t = Math.abs(b[m.f]);
    b[m.t] = (m.pr ? t + 8 : t) * sgn;
    b[m.f] = 0;
  }
  return { b, h, captured };
}

function legalMoves(board, hands, side, checkDropMate = true, auto = false) {
  const list = [];
  for (const m of pseudoMoves(board, hands, side, auto)) {
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
  const N = sizeOf(board);
  const home = N - 3; // 先手の歩の段（後手は N - 1 - home）
  let v = 0;
  for (let i = 0; i < N * N; i++) {
    const x = board[i];
    if (!x) continue;
    const t = Math.abs(x);
    let s = VALUE[t];
    if (t === PAWN || t === 4) {
      const r = Math.floor(i / N);
      s += (x > 0 ? home - r : r - (N - 1 - home)) * 4;
    }
    v += x > 0 ? s : -s;
  }
  for (let d = 1; d <= 7; d++) v += (hands[0][d] - hands[1][d]) * VALUE[d] * 1.1;
  return side === 0 ? v : -v;
}

// 決まった時間で打ち切る先読み。時間切れなら null
// trial（詳細設定「トライ」）なら、玉がトライのマスに入る手（取られないとき）を勝ちとして読む
function searchRoot(board, hands, side, moves, depth, deadline, auto, trial) {
  let nodes = 0;
  let aborted = false;
  const nega = (b, h, s, d, alpha, beta) => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    if (d === 0) return evaluate(b, h, s);
    const ms = pseudoMoves(b, h, s, auto);
    if (!ms.length) return -MATE;
    // 駒を取る手から先に読む（打ち切りが効きやすい）
    const scored = ms.map((m) => [m, m.d ? 0 : Math.abs(b[m.t]) === KING ? MATE : VALUE[Math.abs(b[m.t])] ?? 0]);
    scored.sort((x, y) => y[1] - x[1]);
    let best = -Infinity;
    for (const [m] of scored) {
      if (!m.d && Math.abs(b[m.t]) === KING) return MATE + d; // 王が取れる＝相手は王手を放置した
      const n = make(b, h, s, m);
      if (trial && isTry(b, s, m) && !attacked(n.b, m.t, 1 - s)) return MATE + d;
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
    const v = trial && isTry(board, side, m) ? MATE + depth : -nega(n.b, n.h, 1 - side, depth - 1, -Infinity, Infinity);
    if (aborted) return null;
    scores.push([m, v]);
  }
  return scores;
}

function cpuMove(s, rules) {
  const level = { weak: 1, normal: 1, strong: 1 }[rules?.cpu] ? rules.cpu : 'weak';
  const moves = legalMoves(s.board, s.hands, s.turn, true, !!s.auto);
  const mistake = { weak: 0.3, normal: 0.08, strong: 0 }[level];
  if (Math.random() < mistake) return moves[Math.floor(Math.random() * moves.length)];
  const maxDepth = (sizeOf(s.board) === 5 ? { weak: 1, normal: 2, strong: 4 } : { weak: 1, normal: 2, strong: 3 })[level];
  const deadline = Date.now() + 1500;
  let scores = null;
  for (let d = 1; d <= maxDepth; d++) { // 浅い読みから順に。時間切れならひとつ前の結果を使う
    const r = searchRoot(s.board, s.hands, s.turn, moves, d, deadline, !!s.auto, !!s.trial);
    if (!r) break;
    scores = r;
  }
  const best = Math.max(...scores.map((x) => x[1]));
  const top = scores.filter((x) => x[1] >= best - (level === 'strong' ? 0 : 10)).map((x) => x[0]);
  return top[Math.floor(Math.random() * top.length)];
}

/* ---------- 棋譜の書き方 ---------- */

function notation(s, m, prevTo) {
  const N = sizeOf(s.board);
  const mark = s.turn === 0 ? '▲' : '△';
  const sq = m.t === prevTo ? '同' : FILES[9 - N + m.t % N] + RANKS[Math.floor(m.t / N)];
  if (m.d) return `${mark}${sq}${KANJI[m.d]}打`;
  const t = Math.abs(s.board[m.f]);
  const r1 = Math.floor(m.f / N);
  const r2 = Math.floor(m.t / N);
  let suffix = '';
  if (m.pr) suffix = '成';
  else if (canPromote(t) && (inZone(s.turn, r1, N) || inZone(s.turn, r2, N))) suffix = '不成';
  return `${mark}${sq}${NOTE_NAME[t]}${suffix}`;
}

/* ---------- 王手の知らせ（詳細設定。最初は あり） ---------- */

// 最後の手で王手になったか（局面だけから決める。決着した局面では出さない）
function gaveCheck(s) {
  if (s.result || !s.last || s.last.resign) return false;
  if (s.n === 3) return three.gaveCheck(s);
  if (s.zoo) return zoo.gaveCheck(s);
  return !!s.last.check;
}

const FLASH_MS = 1500;
let flash = { key: null, at: 0 }; // いま出している「王手！」（どの局面か・出し始めた時刻）。描き直しても続きから出す
// 新しく届いた手（fresh）で王手になったら、盤の上に大きく「王手！」を出す。駒を選ぶなどの描き直しでは出し直さない
function checkFlash(root, s, fresh) {
  if (s.quiet || !gaveCheck(s)) return;
  const key = `${s.ply}|${s.keys[s.keys.length - 1]}`;
  if (fresh && flash.key !== key) flash = { key, at: Date.now() };
  const t = Date.now() - flash.at;
  if (flash.key !== key || t >= FLASH_MS) return;
  const e = document.createElement('div');
  e.className = 'sg-oute';
  e.setAttribute('aria-hidden', 'true'); // 状態の欄にも「王手！」が出る
  e.textContent = '王手！';
  e.style.animationDelay = `-${t}ms`;
  root.append(e);
  setTimeout(() => e.remove(), FLASH_MS - t);
}

/* ---------- 画面 ---------- */

let ui = { key: null, from: null, drop: null, promo: null }; // 選んでいる駒・成るかの確認（描き直しで消えないよう外に持つ）

export default {
  id: 'shogi',
  name: '将棋',
  icon: '☗',
  flip: true, // 盤の向きを変える（⇅）ボタンを出す（main.js）
  desc: '本将棋。駒落ちのハンデも選べる。オンラインでは小さい盤の5五将棋・動物の駒の 3×4 や、3人（六角形の盤）も選べる',
  ready: true,
  players: three.NAMES, // 3人目は3人将棋だけ
  // 詳細設定の人数。3人は shogi3.js が受け持つ（局面に n: 3 を持つ）
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  settings: [
    { key: 'players', label: '人数', desc: '3人では六角形の盤で3人が向き合う。王を取られた人は脱落（駒落ちは使わない）', def: 2, choices: [[2, '2人'], [3, '3人']] },
    { key: 'size', label: '盤', desc: '5五将棋は 5×5 の盤に 王・金・銀・角・飛・歩 が1枚ずつ。成れるのは一番奥の1段だけ。3×4 は動物の駒（ライオン・キリン・ゾウ・ヒヨコ）で、ライオンを取るか、ライオンが相手の奥の段に入って取られなければ勝ち（どちらも2人のときだけ。駒落ちは使わない）', def: 'full', choices: [['full', '本将棋（9×9）'], ['mini', '5五将棋（5×5）'], ['zoo', '3×4（動物の駒）']] },
    { key: 'drops', label: '持ち駒', desc: '「使わない」にすると、取った駒は消えるだけで打てない（チェスのよう）。本将棋と5五将棋の2人だけ', def: 'on', choices: [['on', '使う'], ['off', '使わない']] },
    { key: 'try', label: 'トライ', desc: '自分の玉が相手の玉の最初のマスに入ったら勝ち（入玉で長引かない）。本将棋と5五将棋の2人だけ', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'autopromo', label: 'いつも成る', desc: '成れるときは聞かずに自動で成る（わざと成らない手は指せない）。初めての人向け', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'mix', label: '駒の並び', desc: '「ばらばら」にすると、一番下の段の駒（玉は真ん中のまま）と角・飛の左右を毎回おまかせで並べる（先手と後手は同じ並び）。決まった序盤が使えない。本将棋の2人・平手だけ', def: 'off', choices: [['off', 'ふつう'], ['on', 'ばらばら']] },
    { key: 'check', label: '王手の知らせ', desc: '王手をかけたとき、盤に大きく「王手！」と出して読み上げる（🔊 がオンのとき）。3人・3×4 でも出る', def: 'on', choices: [['on', 'あり'], ['off', 'なし']] },
    { key: 'handicap', label: '駒落ち', desc: '先手（上手）が駒を落として先に指す。腕の差があるときに', def: 'none', choices: Object.entries(HANDICAPS) },
    CPU_SETTING,
  ],

  init({ rules = {}, seed = 1 } = {}) {
    const auto = rules.autopromo === 'on';
    const quiet = rules.check === 'off'; // 王手の知らせ「なし」
    if (rules.players === 3) return three.init(auto, quiet);
    if (rules.size === 'zoo') return zoo.init(quiet);
    const mini = rules.size === 'mini';
    const handicap = !mini && HANDICAPS[rules.handicap] ? rules.handicap : 'none';
    const mixed = !mini && handicap === 'none' && rules.mix === 'on'; // 駒の並び「ばらばら」
    const board = mini ? miniBoard() : initialBoard(handicap, mixed ? mulberry32(seed >>> 0) : null);
    const hands = [Array(8).fill(0), Array(8).fill(0)];
    if (rules.drops === 'off') { hands[0][0] = NO_HAND; hands[1][0] = NO_HAND; }
    const s = { board, hands, turn: 0, ply: 0, handicap, last: null, keys: [posKey(board, hands, 0)], checks: [false], result: null };
    if (auto) s.auto = true; // なしのときは局面に何も足さない（今までと同じ形）
    if (rules.try === 'on') s.trial = true; // トライも同じ
    if (mixed) s.mixed = true; // 駒の並びも同じ
    if (quiet) s.quiet = true; // 王手の知らせも同じ（なしのときだけ足す）
    return s;
  },

  turn(s) { return s.turn; },
  result(s) { return s.result; },

  apply(s, m) {
    if (s.n === 3) return three.apply(s, m);
    if (s.zoo) return zoo.apply(s, m);
    if (s.result || !m || typeof m !== 'object') return null;
    if (m.resign === true) {
      return { ...s, result: { winner: 1 - s.turn, cells: [], reason: `${s.turn === 0 ? '先手' : '後手'}の投了` }, last: { resign: true, side: s.turn } };
    }
    const legal = legalMoves(s.board, s.hands, s.turn, true, !!s.auto);
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
    if (s.auto) n.auto = true;
    if (s.trial) n.trial = true;
    if (s.mixed) n.mixed = true;
    if (s.quiet) n.quiet = true;
    if (s.trial && isTry(s.board, s.turn, mv)) {
      n.result = { winner: s.turn, cells: [mv.t], reason: 'トライ（玉が相手の玉の最初のマスに入った）' };
    } else if (!legalMoves(b, h, next, true, !!s.auto).length) {
      n.result = { winner: s.turn, cells: [], reason: '詰み' };
    } else if (keys.filter((k) => k === key).length >= 4) {
      // 千日手。くり返しの間ずっと王手をかけていた側の負け
      const from = keys.indexOf(key);
      const by = (side) => checks.slice(from + 1).filter((_, i) => (from + i) % 2 === side);
      const perpetual = [0, 1].find((side) => by(side).length && by(side).every(Boolean));
      n.result = perpetual === undefined
        ? { winner: null, cells: [], reason: '千日手' }
        : { winner: 1 - perpetual, cells: [], reason: '連続王手の千日手' };
    } else if (ply >= (b.length === 25 ? MINI_MAX_PLY : MAX_PLY)) {
      n.result = { winner: null, cells: [], reason: `${ply}手に達した` };
    }
    return n;
  },

  // CPU: 駒の損得で何手先まで読むか（よわい1・ふつう2・つよい3）。読みは1.5秒で打ち切る。弱いほど適当に指すことがある
  // 効果音: 王手の知らせが「あり」で王手をかけた手は読み上げの「王手！」、ほかはいつもの駒の音
  sound(a, b) { return !b.quiet && gaveCheck(b) ? 'oute' : 'place'; },

  cpu(s, p, rules) { return s.n === 3 ? three.cpuMove(s, rules) : s.zoo ? zoo.cpuMove(s, rules) : cpuMove(s, rules); },

  info(s) {
    if (s.n === 3) return three.info(s);
    if (s.zoo) return zoo.info(s);
    const parts = [];
    if (s.board.length === 25) parts.push('5五将棋');
    if (s.handicap !== 'none') parts.push(`${HANDICAPS[s.handicap]}（☗先手が上手）`);
    if (s.mixed) parts.push('ばらばらの並び');
    if (s.hands[0][0] === NO_HAND) parts.push('持ち駒なし');
    if (s.auto) parts.push('いつも成る');
    if (s.trial) parts.push('トライあり');
    if (s.last?.note) parts.push(`${s.ply}手目 ${s.last.note}`);
    if (s.result) parts.push(s.result.reason);
    else if (s.last?.check) parts.push('<b class="sg-check-text">王手！</b>');
    return parts.join('　');
  },

  render(root, s, o) {
    if (s.n === 3) three.render(root, s, o);
    else if (s.zoo) zoo.render(root, s, o, this.players);
    else this.renderBoard(root, s, o);
    checkFlash(root, s, o.fresh);
  },

  renderBoard(root, s, o) {
    const draw = () => this.render(root, s, o);
    const N = sizeOf(s.board);
    const last = N * N - 1;
    // 自分の駒が下に来るように。観戦と同じ画面の対局では先手が下。盤の向きを変えた（⇅）ときは o.view の人が下
    const bottom = Number.isInteger(o.view) ? o.view : o.me === 1 ? 1 : 0;
    const key = `${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, from: null, drop: null, promo: null };
    const can = o.canMove && !s.result;
    const legal = can ? legalMoves(s.board, s.hands, s.turn, true, !!s.auto) : []; // いつも成るなら成る手だけなので、確認は出ない
    const targets = new Set();
    if (ui.from !== null) for (const m of legal) if (m.f === ui.from) targets.add(m.t);
    if (ui.drop !== null) for (const m of legal) if (m.d === ui.drop) targets.add(m.t);
    const movable = new Set(legal.filter((m) => !m.d).map((m) => m.f));
    const droppable = new Set(legal.filter((m) => m.d).map((m) => m.d));
    const inCheck = !s.result && attacked(s.board, kingSq(s.board, s.turn), 1 - s.turn);
    const checkedKing = inCheck ? kingSq(s.board, s.turn) : -1;

    root.innerHTML = '';
    root.className = 'board sg' + (N === 5 ? ' sg5' : '');
    root.style.setProperty('--n', N);

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

    const noHand = s.hands[0][0] === NO_HAND; // 持ち駒なし（詳細設定）では持ち駒の段を出さない
    if (!noHand) root.append(handRow(1 - bottom));

    const wrap = document.createElement('div');
    wrap.className = 'sg-wrap';
    const files = document.createElement('div');
    files.className = 'sg-files';
    for (let k = 0; k < N; k++) {
      const span = document.createElement('span');
      span.textContent = bottom === 0 ? N - k : k + 1;
      files.append(span);
    }
    const grid = document.createElement('div');
    grid.className = 'sg-grid';
    for (let k = 0; k < N * N; k++) {
      const i = bottom === 0 ? k : last - k;
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
      if (s.trial && (i === trySq(0, N) || i === trySq(1, N))) cell.classList.add('try'); // トライのマスに薄い印
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
    for (let k = 0; k < N; k++) {
      const span = document.createElement('span');
      span.textContent = RANKS[bottom === 0 ? k : N - 1 - k];
      ranks.append(span);
    }
    wrap.append(files, grid, ranks);
    root.append(wrap);

    if (!noHand) root.append(handRow(bottom));

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
export const _test = { gaveCheck, legalMoves, attacked, kingSq, initialBoard, miniBoard, evaluate, trySq };
