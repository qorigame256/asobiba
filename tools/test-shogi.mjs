// 将棋のルールと CPU の自動確認（node tools/test-shogi.mjs）。
// 盤のマス番号 = 段 * 9 + 列（段0 が一段目、列0 が 9筋）。正の数が先手の駒、負の数が後手の駒。
import shogi, { _test } from '../app/js/games/shogi.js';
import { _test3 } from '../app/js/games/shogi3.js';

const { legalMoves } = _test;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) failed++;
};
const sq = (r, c) => r * 9 + c;
const emptyHands = () => [Array(8).fill(0), Array(8).fill(0)];
// 好きな局面から始める（手の記録も作り直す）
function position(pieces, { hands = emptyHands(), turn = 0, ply = 0 } = {}) {
  const s = shogi.init();
  const board = Array(81).fill(0);
  for (const [r, c, v] of pieces) board[sq(r, c)] = v;
  const key = `${board.join(',')}|${hands[0].join('')}|${hands[1].join('')}|${turn}`;
  return { ...s, board, hands, turn, ply, keys: [key], checks: [false] };
}
const play = (s, moves) => moves.reduce((x, m) => (x ? shogi.apply(x, m) : null), s);
const has = (list, f) => list.some(f);

// 1. 最初の局面から何手先まで、指せる手が何通りあるか（よく知られた数: 30 / 900 / 25470）
function perft(board, hands, side, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of legalMoves(board, hands, side)) {
    const s = play({ ...shogi.init(), board, hands, turn: side }, [m]);
    n += perft(s.board, s.hands, 1 - side, d - 1);
  }
  return n;
}
{
  const s = shogi.init();
  const got = [1, 2, 3].map((d) => perft(s.board, s.hands, 0, d));
  check('最初の局面の手の数（1〜3手先）', got.join() === '30,900,25470', got.join());
}

// 2. 駒落ち
{
  const count = (rules) => shogi.init({ rules }).board.filter((v) => v > 0).length;
  check('平手は先手20枚', count({}) === 20);
  check('香落ち・角落ち・飛車落ち・二枚落ち', count({ handicap: 'lance' }) === 19 && count({ handicap: 'bishop' }) === 19
    && count({ handicap: 'rook' }) === 19 && count({ handicap: 'two' }) === 18);
  const two = shogi.init({ rules: { handicap: 'two' } }).board;
  check('二枚落ちで落ちるのは先手の角と飛', two[sq(7, 1)] === 0 && two[sq(7, 7)] === 0 && two[sq(1, 1)] === -7 && two[sq(1, 7)] === -6);
  check('香落ちで落ちるのは先手の1筋の香', shogi.init({ rules: { handicap: 'lance' } }).board[sq(8, 8)] === 0);
}

// 3. 打つ手の反則
{
  const hands = emptyHands();
  hands[0][1] = 1; // 歩
  hands[0][3] = 1; // 桂
  const s = position([[8, 8, 8], [0, 4, -8], [5, 2, 1]], { hands });
  const ms = legalMoves(s.board, s.hands, 0);
  check('二歩は打てない', !has(ms, (m) => m.d === 1 && m.t % 9 === 2) && has(ms, (m) => m.d === 1 && m.t === sq(4, 3)));
  check('歩は一段目に打てない', !has(ms, (m) => m.d === 1 && m.t < 9));
  check('桂は一・二段目に打てない', !has(ms, (m) => m.d === 3 && m.t < 18) && has(ms, (m) => m.d === 3 && m.t === sq(2, 0)));
}
{
  // 打ち歩詰め: 9一の玉に 9二歩。歩は 9三の金が守り、8筋は飛が押さえている
  const hands = emptyHands();
  hands[0][1] = 1;
  const mate = position([[8, 8, 8], [0, 0, -8], [2, 0, 5], [5, 1, 7]], { hands });
  check('打ち歩詰めは打てない', !has(legalMoves(mate.board, mate.hands, 0), (m) => m.d === 1 && m.t === sq(1, 0)));
  const notMate = position([[8, 8, 8], [0, 0, -8], [2, 0, 5]], { hands });
  check('詰まない歩の王手は打てる', has(legalMoves(notMate.board, notMate.hands, 0), (m) => m.d === 1 && m.t === sq(1, 0)));
  const s = play(mate, [{ f: sq(5, 1), t: sq(5, 2) }]);
  check('歩を突いての詰みは反則ではない（打つ時だけ）', !!s);
}

// 4. 成り
{
  const s = position([[8, 8, 8], [0, 8, -8], [1, 4, 1], [3, 0, 3], [3, 6, 6], [6, 2, 5]]);
  const ms = legalMoves(s.board, s.hands, 0);
  const to = (f) => ms.filter((m) => m.f === f);
  check('歩が一段目へは成るしかない', to(sq(1, 4)).length === 1 && to(sq(1, 4))[0].pr === true);
  check('桂が二段目へは成るしかない', to(sq(3, 0)).every((m) => m.pr === true));
  check('角が敵陣へは成る・成らないを選べる', has(ms, (m) => m.f === sq(3, 6) && m.t === sq(2, 7) && m.pr) && has(ms, (m) => m.f === sq(3, 6) && m.t === sq(2, 7) && !m.pr));
  check('金は成れない', to(sq(6, 2)).every((m) => !m.pr));
}
{
  // 王手を放置する手は指せない: 後手の飛が 5筋から先手玉に王手
  const s = position([[8, 4, 8], [0, 4, -7], [0, 0, -8], [8, 0, 2]]);
  const ms = legalMoves(s.board, s.hands, 0);
  check('王手を放っておく手は指せない', !has(ms, (m) => m.f === sq(8, 0)) && ms.every((m) => m.f === sq(8, 4)));
}

// 5. 詰み・投了
{
  const hands = emptyHands();
  hands[0][5] = 1; // 金
  const s = position([[8, 8, 8], [0, 4, -8], [2, 4, 1]], { hands });
  const after = shogi.apply(s, { d: 5, t: sq(1, 4) });
  check('頭金で詰み（先手の勝ち）', after?.result?.winner === 0 && after.result.reason === '詰み');
  check('記録の書き方', after?.last?.note === '▲５二金打', after?.last?.note);
  const r = shogi.apply(shogi.init(), { resign: true });
  check('投了すると相手の勝ち', r?.result?.winner === 1);
  check('反則の手は受け付けない', shogi.apply(shogi.init(), { f: sq(6, 4), t: sq(4, 4) }) === null);
}

// 6. 千日手・手数
{
  // 先手の飛が 5筋と 6筋で王手を続け、後手の玉が 5一と 6一を行き来する
  const start = position([[8, 8, 8], [0, 4, -8], [4, 0, 7]]);
  const cycle = [{ f: sq(4, 0), t: sq(4, 4) }, { f: sq(0, 4), t: sq(0, 3) }, { f: sq(4, 4), t: sq(4, 3) }, { f: sq(0, 3), t: sq(0, 4) }, { f: sq(4, 3), t: sq(4, 4) }];
  const moves = [cycle[0], ...Array(3).fill(cycle.slice(1)).flat()];
  const end = play(start, moves);
  const before = play(start, moves.slice(0, -1));
  check('連続王手の千日手は王手をかけた側（先手）の負け', end?.result?.winner === 1 && end.result.reason === '連続王手の千日手', end?.result?.reason);
  check('3回目までは続く', before && !before.result);
  // 王手をしない往復
  const quiet = position([[8, 8, 8], [0, 4, -8], [4, 0, 7]]);
  const back = [{ f: sq(4, 0), t: sq(4, 1) }, { f: sq(0, 4), t: sq(0, 5) }, { f: sq(4, 1), t: sq(4, 0) }, { f: sq(0, 5), t: sq(0, 4) }];
  const q = play(quiet, Array(3).fill(back).flat());
  check('王手の無い千日手は引き分け', q?.result?.winner === null && q.result.reason === '千日手', q?.result?.reason);
  const last = play(position([[8, 8, 8], [0, 4, -8], [4, 0, 7]], { ply: 299 }), [{ f: sq(4, 0), t: sq(4, 1) }]);
  check('300手で引き分け', last?.result?.winner === null && last.result.reason === '300手に達した');
}

// 7. 同じ手の一覧からは必ず同じ局面になる（通信で手だけ送るため）
{
  let s = shogi.init();
  const moves = [];
  for (let i = 0; i < 40 && !s.result; i++) {
    const ms = legalMoves(s.board, s.hands, s.turn);
    const m = ms[(i * 7919) % ms.length];
    moves.push(m);
    s = shogi.apply(s, m);
  }
  const again = play(shogi.init(), JSON.parse(JSON.stringify(moves)));
  check('手の一覧を当て直すと同じ局面', again && again.keys.at(-1) === s.keys.at(-1));
}

// 8. CPU
{
  const hands = emptyHands();
  hands[0][5] = 1;
  const s = position([[8, 8, 8], [0, 4, -8], [2, 4, 1]], { hands });
  const m = shogi.cpu(s, 0, { cpu: 'strong' });
  check('つよい CPU は1手で詰ませる', !!shogi.apply(s, m)?.result, JSON.stringify(m));
  const free = position([[8, 8, 8], [0, 0, -8], [4, 4, 7], [4, 7, -7]]);
  const take = shogi.cpu(free, 0, { cpu: 'strong' });
  check('つよい CPU はただの飛車を取る', take?.t === sq(4, 7), JSON.stringify(take));
  // 対局を最後まで（または120手まで）CPU どうしで指して、いつも指せる手を返すか・時間を測る
  for (const level of ['weak', 'normal', 'strong']) {
    let x = shogi.init();
    let worst = 0;
    let bad = 0;
    for (let i = 0; i < 120 && !x.result; i++) {
      const t0 = Date.now();
      const mv = shogi.cpu(x, x.turn, { cpu: level });
      worst = Math.max(worst, Date.now() - t0);
      const n = shogi.apply(x, mv);
      if (!n) { bad++; break; }
      x = n;
    }
    check(`CPU（${level}）はいつも指せる手を返し、1手2秒以内`, bad === 0 && worst < 2000, `最長 ${(worst / 1000).toFixed(2)}秒・${x.ply}手${x.result ? '・' + x.result.reason : ''}`);
  }
}

// 9. 3人将棋（三人チェス式の盤。マス = 陣地 * 40 + 段 * 8 + 筋）
{
  const T = _test3;
  const R3 = { players: 3 };
  const q = (P, y, x) => P * 40 + y * 8 + x;
  const v = (owner, t) => owner * 16 + t;
  const s0 = shogi.init({ rules: R3 });
  check('3人: 席は3つ・2人は2つ', shogi.seatCount(R3) === 3 && shogi.seatCount({}) === 2);
  check('3人: 盤は120マスで各自18枚（香が1枚少ない8筋）', s0.board.length === 120 && [0, 1, 2].every((P) => s0.board.filter((x) => x && x >> 4 === P).length === 18));
  // 線のつながり: 縦横に1つ動いて逆向きに1つ戻ると元のマス（線をまたぐと向きが反転する）
  let bad = 0;
  for (let i = 0; i < 120; i++) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const r = T.step(i, dx, dy);
      if (!r) continue;
      const k = r[1] ? -1 : 1;
      const back = T.step(r[0], -dx * k, -dy * k);
      if (!back || back[0] !== i) bad++;
    }
  }
  check('3人: どのマスも1つ動いて戻ると元のマス', bad === 0, `食い違い ${bad}`);
  check('3人: 段4の先は左半分が左どなり・右半分が右どなり', T.step(q(0, 4, 0), 0, 1)[0] === q(2, 4, 7) && T.step(q(0, 4, 7), 0, 1)[0] === q(1, 4, 0)
    && T.step(q(1, 4, 3), 0, 1)[0] === q(0, 4, 4));
  check('3人: 真ん中の点は斜めに通れない', T.step(q(0, 4, 3), 1, 1) === null && T.step(q(0, 4, 4), -1, 1) === null && T.step(q(0, 4, 3), -1, 1) !== null);
  // 最初の局面の手の数（2026-10-05 に数えた値。動きを変えたら数え直す）
  const first = T.legalMoves(s0.board, s0.hands, 0);
  check('3人: 最初に指せる手は26手（☗先手）', first.length === 26, `${first.length}手`);
  // 香: 自分の陣地から真ん中を越えて、となりの陣地の奥（1段目）まで進める。奥では成らないといけない
  {
    const b = Array(120).fill(0);
    b[q(0, 0, 4)] = v(0, 8); b[q(1, 0, 4)] = v(1, 8); b[q(2, 0, 4)] = v(2, 8);
    b[q(0, 2, 1)] = v(0, 2);
    const to = T.reach(b, q(0, 2, 1));
    check('3人: 香は線をまたいでとなりの陣地の奥まで進む', to.includes(q(2, 0, 6)) && to.length === 7, to.join());
    const ms = T.legalMoves(b, [0, 1, 2].map(() => Array(8).fill(0)), 0).filter((m) => m.f === q(0, 2, 1) && m.t === q(2, 0, 6));
    check('3人: 奥の段へ行く香は成らないといけない', ms.length === 1 && ms[0].pr === true);
    // 二歩は線のつながりで数える（☗先手の筋1 は ☖後手…ではなく左どなり＝三番手の筋6 と同じ線）
    const hands = [0, 1, 2].map(() => Array(8).fill(0));
    hands[0][1] = 1;
    const b2 = b.slice();
    b2[q(0, 2, 1)] = v(0, 1);
    const drops = T.legalMoves(b2, hands, 0).filter((m) => m.d === 1);
    check('3人: 二歩は線のつながりで数える', !drops.some((m) => m.t === q(2, 3, 6)) && drops.some((m) => m.t === q(2, 3, 5)));
    check('3人: 歩はほかの人の陣地の1段目に打てない', !drops.some((m) => m.t === q(1, 0, 2)) && drops.some((m) => m.t === q(1, 1, 2)));
  }
  // 王を取ると脱落して駒が消える。最後の1人が勝ち
  {
    const b = Array(120).fill(0);
    b[q(0, 0, 4)] = v(0, 8); b[q(1, 0, 4)] = v(1, 8); b[q(2, 0, 4)] = v(2, 8);
    b[q(1, 1, 4)] = v(0, 7); // ☗先手の飛が ☖後手の玉の前
    b[q(1, 3, 0)] = v(1, 1); // ☖後手の歩
    b[q(2, 1, 4)] = v(1, 7); // ☖後手の飛が 三番手の玉の前
    const hands = [0, 1, 2].map(() => Array(8).fill(0));
    hands[1][4] = 2;
    const st = { ...s0, board: b, hands, keys: [] };
    const a = shogi.apply(st, { f: q(1, 1, 4), t: q(1, 0, 4), pr: true });
    check('3人: 王を取ると脱落し、その人の駒と持ち駒は消える', a && !a.alive[1] && a.board.every((x) => !x || x >> 4 !== 1) && a.hands[1].every((n) => n === 0) && a.turn === 2 && !a.result);
    const b3 = a.board.slice();
    b3[q(2, 2, 4)] = v(0, 7);
    const c = shogi.apply({ ...a, board: b3, turn: 0 }, { f: q(2, 2, 4), t: q(2, 0, 4), pr: true });
    check('3人: 最後の1人が勝ち・先に脱落した人が3位', c?.result?.winner === 0 && c.result.ranking.join() === '0,2,1', JSON.stringify(c?.result));
    const r = shogi.apply(st, { resign: true });
    check('3人: 投了すると脱落して続く', r && !r.alive[0] && r.turn === 1 && !r.result && r.board.every((x) => !x || x >> 4 !== 0));
    check('3人: 他人の駒は動かせない', shogi.apply(st, { f: q(1, 3, 0), t: q(1, 4, 0), pr: false }) === null);
  }
  // CPU どうしで最後まで（脱落・引き分けを含め）指して、いつも指せる手を返すか・時間を測る
  for (const level of ['weak', 'normal', 'strong']) {
    let x = shogi.init({ rules: R3 });
    let worst = 0;
    let badMove = 0;
    while (!x.result) {
      const t0 = Date.now();
      const mv = shogi.cpu(x, x.turn, { cpu: level });
      worst = Math.max(worst, Date.now() - t0);
      const n = shogi.apply(x, JSON.parse(JSON.stringify(mv)));
      if (!n) { badMove++; break; }
      x = n;
    }
    check(`3人: CPU（${level}）どうしで最後まで指せる・1手2秒以内`, badMove === 0 && worst < 2000, `最長 ${(worst / 1000).toFixed(2)}秒・${x.ply}手・${x.result?.reason}`);
  }
  // 手の一覧を当て直すと同じ局面
  {
    let x = shogi.init({ rules: R3 });
    const moves = [];
    for (let i = 0; i < 60 && !x.result; i++) {
      const ms = T.legalMoves(x.board, x.hands, x.turn);
      const m = ms[(i * 7919) % ms.length];
      moves.push(m);
      x = shogi.apply(x, m);
    }
    const again = JSON.parse(JSON.stringify(moves)).reduce((y, m) => (y ? shogi.apply(y, m) : null), shogi.init({ rules: R3 }));
    check('3人: 手の一覧を当て直すと同じ局面', again && again.keys.at(-1) === x.keys.at(-1));
  }
}

console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
