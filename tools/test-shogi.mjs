// 将棋のルールと CPU の自動確認（node tools/test-shogi.mjs）。
// 盤のマス番号 = 段 * 9 + 列（段0 が一段目、列0 が 9筋）。正の数が先手の駒、負の数が後手の駒。
import shogi, { _test } from '../app/js/games/shogi.js';
import { _test3 } from '../app/js/games/shogi3.js';
import { _test34 } from '../app/js/games/shogi34.js';

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

// 8b. 5五将棋（マス = 段 * 5 + 列。列0 が 5筋）
{
  const M = { size: 'mini' };
  const s = shogi.init({ rules: M });
  const b = s.board;
  check('5五将棋の並べ方（先手 5五飛 4五角 3五銀 2五金 1五玉 1四歩・後手は点対称）',
    b.slice(20).join() === '7,6,4,5,8' && b[19] === 1 && b.slice(0, 5).join() === '-8,-5,-4,-6,-7' && b[5] === -1 && b.filter((v) => v).length === 12);
  check('最初に指せる手は14通り', legalMoves(b, s.hands, 0).length === 14);
  check('5五将棋では駒落ちを使わない', shogi.init({ rules: { ...M, handicap: 'two' } }).board.filter((v) => v > 0).length === 6);
  check('3人のときは5五将棋にならない', shogi.init({ rules: { ...M, players: 3 } }).n === 3);
  const mini = (pieces, { hands = emptyHands(), turn = 0 } = {}) => {
    const board = Array(25).fill(0);
    for (const [r, c, v] of pieces) board[r * 5 + c] = v;
    return { ...s, board, hands, turn, ply: 0, keys: [`${board.join(',')}|${hands[0].join('')}|${hands[1].join('')}|${turn}`], checks: [false] };
  };
  // 銀を2段目へ進めても成れない（敵陣は奥の1段だけ）。1段目へ入ると成れる
  let p = mini([[4, 4, 8], [0, 0, -8], [2, 2, 4]]);
  const silver = legalMoves(p.board, p.hands, 0).filter((m) => m.f === 12);
  check('2段目へ進んでも成れない', silver.filter((m) => m.t < 10 && m.t >= 5).every((m) => !m.pr));
  p = mini([[4, 4, 8], [0, 0, -8], [1, 2, 4]]);
  check('1段目へ入ると成れる', legalMoves(p.board, p.hands, 0).some((m) => m.f === 7 && m.t < 5 && m.pr));
  // 歩は1段目に打てない・二歩・歩が1段目へ進むなら必ず成る
  const h = emptyHands(); h[0][1] = 1;
  p = mini([[4, 4, 8], [0, 0, -8], [3, 1, 1]], { hands: h });
  const drops = legalMoves(p.board, p.hands, 0).filter((m) => m.d === 1);
  check('歩は1段目に打てず、二歩も打てない', drops.every((m) => m.t >= 5 && m.t % 5 !== 1) && drops.length > 0);
  p = mini([[4, 4, 8], [0, 0, -8], [1, 2, 1]]);
  check('歩が1段目へ進むなら必ず成る', legalMoves(p.board, p.hands, 0).filter((m) => m.f === 7).every((m) => m.pr));
  // 棋譜の書き方: 1四歩 → 1三歩
  const after = shogi.apply(s, { f: 19, t: 14, pr: false });
  check('棋譜の書き方（5五将棋の筋と段）', after?.last.note === '▲１三歩', after?.last.note);
  // 200手で引き分け（玉だけを行き来させると千日手になるので、198手目の局面から2手指す）
  p = { ...mini([[4, 4, 8], [0, 0, -8], [2, 2, 7]]), ply: 198 };
  const end = play(p, [{ f: 24, t: 23 }, { f: 0, t: 1 }]);
  check('200手で引き分け', end?.result?.winner === null && end.result.reason === '200手に達した', end?.result?.reason);
  for (const level of ['weak', 'normal', 'strong']) {
    let x = shogi.init({ rules: M });
    let worst = 0;
    let bad = 0;
    for (let i = 0; i < 200 && !x.result; i++) {
      const t0 = Date.now();
      const mv = shogi.cpu(x, x.turn, { cpu: level });
      worst = Math.max(worst, Date.now() - t0);
      const n = shogi.apply(x, mv);
      if (!n) { bad++; break; }
      x = n;
    }
    check(`5五将棋: CPU（${level}）はいつも指せる手を返し、1手2秒以内`, bad === 0 && worst < 2000, `最長 ${(worst / 1000).toFixed(2)}秒・${x.ply}手${x.result ? '・' + x.result.reason : ''}`);
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

// 3×4（動物の駒）。マス番号 = 段 * 3 + 列。1ヒヨコ 2ゾウ 3キリン 4ライオン 5ニワトリ
{
  const Z = { size: 'zoo' };
  const z = (r, c) => r * 3 + c;
  const start = shogi.init({ rules: Z });
  check('3×4: 最初の並べ方（先手は左からゾウ・ライオン・キリン、前にヒヨコ）', start.zoo && start.board.join() === '-3,-4,-2,0,-1,0,0,1,0,2,4,3');
  check('3×4: 最初に指せる手は4通り', _test34.moves(start.board, start.hands, 0).length === 4);
  const zpos = (pieces, { hands = [[0, 0, 0, 0], [0, 0, 0, 0]], turn = 0 } = {}) => {
    const board = Array(12).fill(0);
    for (const [r, c, v] of pieces) board[z(r, c)] = v;
    return { ...start, board, hands, turn, keys: [] };
  };
  // ヒヨコを取って持ち駒にし、奥の段に打てる（成らない）。二歩も禁止しない
  let a = shogi.apply(start, { f: z(2, 1), t: z(1, 1) });
  check('3×4: ヒヨコを取ると持ち駒になる', a && a.hands[0][1] === 1 && a.board[z(1, 1)] === 1);
  const drop = zpos([[3, 1, 4], [0, 0, -4], [2, 2, 1]], { hands: [[0, 1, 0, 0], [0, 0, 0, 0]] });
  const d1 = shogi.apply(drop, { d: 1, t: z(0, 2) });
  check('3×4: 奥の段にヒヨコを打てて、成らない', d1 && d1.board[z(0, 2)] === 1);
  check('3×4: 同じ列にヒヨコがあっても打てる（二歩なし）', !!shogi.apply(drop, { d: 1, t: z(1, 2) }));
  const pr = shogi.apply(zpos([[3, 1, 4], [0, 0, -4], [1, 2, 1]]), { f: z(1, 2), t: z(0, 2) });
  check('3×4: ヒヨコは奥の段で必ずニワトリになる', pr && pr.board[z(0, 2)] === 5 && /成/.test(pr.last.note));
  const hen = shogi.apply(zpos([[3, 1, 4], [0, 0, -4], [1, 0, 5]], { turn: 1 }), { f: z(0, 0), t: z(1, 0) });
  check('3×4: 取ったニワトリはヒヨコに戻る', hen && hen.hands[1][1] === 1 && hen.hands[1][5] === undefined);
  // 王手の放置ができる・ライオンを取ったら勝ち
  const leave = zpos([[3, 1, 4], [2, 1, -3], [0, 0, -4], [3, 0, 3]]);
  const l1 = shogi.apply(leave, { f: z(3, 0), t: z(2, 0) });
  check('3×4: ライオンがねらわれていても放っておける', l1 && !l1.result);
  const l2 = l1 && shogi.apply(l1, { f: z(2, 1), t: z(3, 1) });
  check('3×4: ライオンを取ったら勝ち', l2?.result?.winner === 1, JSON.stringify(l2?.result));
  // トライ: 取られない奥の段に入れば勝ち。取られる所へ入って取られなければ、相手の手のあとで勝ち
  const tr = shogi.apply(zpos([[1, 1, 4], [2, 2, -4]]), { f: z(1, 1), t: z(0, 1) });
  check('3×4: 取られない奥の段に入ったら勝ち（トライ）', tr?.result?.winner === 0 && /トライ/.test(tr.result.reason));
  const risky = zpos([[1, 1, 4], [2, 2, -4], [0, 2, -3]]);
  const r1 = shogi.apply(risky, { f: z(1, 1), t: z(0, 1) });
  check('3×4: 取られる奥の段に入っただけでは勝ちにならない', r1 && !r1.result);
  const r2 = r1 && shogi.apply(r1, { f: z(2, 2), t: z(2, 1) });
  check('3×4: 相手が取らなければトライの勝ち', r2?.result?.winner === 0);
  const r3 = r1 && shogi.apply(r1, { f: z(0, 2), t: z(0, 1) });
  check('3×4: 相手が取ればライオンを取った勝ち', r3?.result?.winner === 1);
  // 同じ局面4回で引き分け
  {
    let x = zpos([[3, 0, 4], [0, 2, -4]]);
    x = { ...x, keys: [`${x.board.join(',')}|0000|0000|0`] };
    const loop = [{ f: z(3, 0), t: z(3, 1) }, { f: z(0, 2), t: z(0, 1) }, { f: z(3, 1), t: z(3, 0) }, { f: z(0, 1), t: z(0, 2) }];
    for (let i = 0; i < 12 && x && !x.result; i++) x = shogi.apply(x, loop[i % 4]);
    check('3×4: 同じ局面4回で引き分け', x?.result?.winner === null && x.result.reason === '千日手', JSON.stringify(x?.result));
  }
  // つよい は取れるライオンを必ず取る・取られる手を避ける
  {
    const t = zpos([[3, 1, 4], [1, 1, -4], [2, 1, 3]]);
    let ok = true;
    for (let i = 0; i < 10; i++) { const m = shogi.cpu(t, 0, { cpu: 'strong' }); if (m.t !== z(1, 1)) ok = false; }
    check('3×4: CPU（つよい）は取れるライオンを取る', ok);
  }
  // CPU どうしで最後まで指せる・1手2秒以内・強さの順
  const game = (a0, a1) => {
    let x = shogi.init({ rules: Z });
    let worst = 0;
    while (!x.result) {
      const t0 = Date.now();
      const mv = shogi.cpu(x, x.turn, { cpu: x.turn === 0 ? a0 : a1 });
      worst = Math.max(worst, Date.now() - t0);
      const n = shogi.apply(x, JSON.parse(JSON.stringify(mv)));
      if (!n) return { bad: true };
      x = n;
    }
    return { winner: x.result.winner, worst, ply: x.ply };
  };
  for (const [hi, lo] of [['normal', 'weak'], ['strong', 'normal']]) {
    let win = 0;
    let lose = 0;
    let worst = 0;
    let bad = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      const hiFirst = i % 2 === 0;
      const r = hiFirst ? game(hi, lo) : game(lo, hi);
      if (r.bad) { bad++; continue; }
      worst = Math.max(worst, r.worst);
      if (r.winner === null) continue;
      if ((r.winner === 0) === hiFirst) win++; else lose++;
    }
    check(`3×4: CPU（${hi}）が（${lo}）に勝ち越す・1手2秒以内`, !bad && win > lose && worst < 2000, `${win}勝${lose}敗（${N}局）・最長 ${(worst / 1000).toFixed(2)}秒`);
  }
}

// 持ち駒なし（詳細設定）: 取った駒は持ち駒にならず、打つ手が出ない。CPU どうしでも最後まで指せる
{
  const nd = shogi.init({ rules: { drops: 'off' } });
  check('持ち駒なしは2人の本将棋の局面', nd.board.length === 81 && nd.hands[0][0] === -1);
  // 先手の角で後手の歩を取る: 角道を開けて（7六歩・3四歩）、2二角成で角を取る
  let x = play(nd, [{ f: sq(6, 2), t: sq(5, 2) }, { f: sq(2, 6), t: sq(3, 6) }, { f: sq(7, 1), t: sq(1, 7), pr: true }]);
  check('持ち駒なしで駒を取れる', !!x && Math.abs(x.board[sq(1, 7)]) === 14);
  check('取った駒は持ち駒にならない', !!x && x.hands[0].slice(1).every((v) => v === 0));
  check('打つ手が出ない', !!x && !legalMoves(x.board, x.hands, 1).some((m) => m.d) && !legalMoves(x.board, x.hands, 0).some((m) => m.d));
  const on = play(shogi.init(), [{ f: sq(6, 2), t: sq(5, 2) }, { f: sq(2, 6), t: sq(3, 6) }, { f: sq(7, 1), t: sq(1, 7), pr: true }]);
  check('ふつうは取った角が持ち駒になる', !!on && on.hands[0][6] === 1);
  check('5五将棋でも使える', shogi.init({ rules: { drops: 'off', size: 'mini' } }).hands[1][0] === -1);
  check('3人・3×4 では使わない', shogi.init({ rules: { drops: 'off', players: 3 } }).hands?.[0]?.[0] !== -1 && !shogi.init({ rules: { drops: 'off', size: 'zoo' } }).hands?.[0]?.includes?.(-1));
  let games = 0;
  for (const [size, lv] of [['mini', 'strong'], ['mini', 'weak'], ['full', 'weak']]) {
    let g = shogi.init({ rules: { drops: 'off', size } });
    let guard = 0;
    while (!g.result && guard++ < 400) {
      const m = shogi.cpu(g, g.turn, { cpu: lv });
      if (m.d) break;
      g = shogi.apply(g, m);
      if (!g) break;
    }
    if (g?.result && g.hands.every((h) => h.slice(1).every((v) => v === 0))) games++;
  }
  check('持ち駒なしで CPU どうしが最後まで指せる（打つ手なし）', games === 3, `${games}/3`);
}

// いつも成る（詳細設定）: 成れる手は必ず成る。成らない手は反則。行き所のない駒は今どおり。なしでは今と同じ
{
  const AUTO = { autopromo: 'on' };
  const a0 = shogi.init({ rules: AUTO });
  check('いつも成る: 局面に auto が付き、なしでは付かない', a0.auto === true && !('auto' in shogi.init()) && !('auto' in shogi.init({ rules: { autopromo: 'off' } })));
  check('いつも成る: 最初の局面は同じ並び', a0.board.join() === shogi.init().board.join() && a0.keys[0] === shogi.init().keys[0]);
  // 4. の成りの局面を、いつも成るで
  const base4 = position([[8, 8, 8], [0, 8, -8], [1, 4, 1], [3, 0, 3], [3, 6, 6], [6, 2, 5]]);
  const s = { ...base4, auto: true };
  const ms = legalMoves(s.board, s.hands, 0, true, true);
  check('いつも成る: 角が敵陣へは成る手だけ', has(ms, (m) => m.f === sq(3, 6) && m.t === sq(2, 7) && m.pr) && !has(ms, (m) => m.f === sq(3, 6) && m.t === sq(2, 7) && !m.pr));
  check('いつも成る: 成らない手は反則（null）', shogi.apply(s, { f: sq(3, 6), t: sq(2, 7), pr: false }) === null);
  const promoted = shogi.apply(s, { f: sq(3, 6), t: sq(2, 7), pr: true });
  check('いつも成る: 成る手は通り、次の局面にも auto が残る', promoted && promoted.board[sq(2, 7)] === 14 && promoted.auto === true && promoted.last.note === '▲２三角成', promoted?.last?.note);
  check('いつも成る: 敵陣に関係ない手・成れない駒は今どおり', !!shogi.apply(s, { f: sq(6, 2), t: sq(5, 2), pr: false }) && !!shogi.apply(s, { f: sq(3, 6), t: sq(4, 5), pr: false }));
  const forcedOf = (list) => JSON.stringify(list.filter((m) => m.f === sq(1, 4) || m.f === sq(3, 0)));
  const forced = legalMoves(s.board, s.hands, 0, true, true).filter((m) => m.f === sq(1, 4) || m.f === sq(3, 0));
  check('いつも成る: 行き所のない駒は今どおり必ず成る', forced.length === 2 && forced.every((m) => m.pr)
    && forcedOf(forced) === forcedOf(legalMoves(base4.board, base4.hands, 0)));
  // なしでは今と同じ（成らない手も指せる・手の数が同じ）
  check('いつも成る: なしでは成らない手も指せる', !!shogi.apply(base4, { f: sq(3, 6), t: sq(2, 7), pr: false }));
  const plain = legalMoves(base4.board, base4.hands, 0);
  const auto = legalMoves(s.board, s.hands, 0, true, true);
  check('いつも成る: 減るのは成れる手の「成らない」方だけ', plain.length - auto.length === plain.filter((m) => !m.pr && plain.some((x) => x.f === m.f && x.t === m.t && x.pr)).length);
  // 5五将棋・駒落ち・持ち駒なしと一緒に使える
  const mini = shogi.init({ rules: { ...AUTO, size: 'mini' } });
  const two = shogi.init({ rules: { ...AUTO, handicap: 'two', drops: 'off' } });
  check('いつも成る: 5五将棋・駒落ち・持ち駒なしと一緒に使える', mini.auto && mini.board.length === 25 && two.auto && two.handicap === 'two' && two.hands[0][0] === -1);
  // 3人将棋: 奥の段でない敵陣へ入る香は成る手だけ。成らない手は反則
  {
    const T = _test3;
    const q = (P, y, x) => P * 40 + y * 8 + x;
    const v = (owner, t) => owner * 16 + t;
    const s3 = shogi.init({ rules: { ...AUTO, players: 3 } });
    const b = Array(120).fill(0);
    b[q(0, 0, 4)] = v(0, 8); b[q(1, 0, 4)] = v(1, 8); b[q(2, 0, 4)] = v(2, 8);
    b[q(0, 2, 1)] = v(0, 2);
    const hands = [0, 1, 2].map(() => Array(8).fill(0));
    const st = { ...s3, board: b, hands, keys: [] };
    const off = T.legalMoves(b, hands, 0).filter((m) => m.f === q(0, 2, 1) && m.t === q(2, 1, 6));
    const on = T.legalMoves(b, hands, 0, true).filter((m) => m.f === q(0, 2, 1) && m.t === q(2, 1, 6));
    check('3人: いつも成るなら選べる所は成る手だけ', s3.auto === true && off.length === 2 && on.length === 1 && on[0].pr === true);
    check('3人: いつも成るなら成らない手は反則・成る手は通る', shogi.apply(st, { f: q(0, 2, 1), t: q(2, 1, 6), pr: false }) === null
      && shogi.apply(st, { f: q(0, 2, 1), t: q(2, 1, 6), pr: true })?.auto === true);
    check('3人: なしでは成らない手も指せる', !!shogi.apply({ ...st, auto: undefined }, { f: q(0, 2, 1), t: q(2, 1, 6), pr: false }));
  }
  // 3×4 はもともとヒヨコが必ず成る（いつも成るを付けても局面は同じ）
  check('3×4: いつも成るでも局面は同じ', JSON.stringify(shogi.init({ rules: { ...AUTO, size: 'zoo' } })) === JSON.stringify(shogi.init({ rules: { size: 'zoo' } })));
  // CPU どうしで最後まで。CPU が成らない手（成れたのに）を選ばないか・手の一覧を当て直すと同じ局面か
  const chooses = (x, m) => !m.d && !m.pr && !m.resign
    && (x.n === 3 ? _test3.legalMoves(x.board, x.hands, x.turn) : legalMoves(x.board, x.hands, x.turn)).some((y) => y.f === m.f && y.t === m.t && y.pr);
  for (const [label, rules, level] of [['本将棋', {}, 'weak'], ['本将棋・二枚落ち・持ち駒なし', { handicap: 'two', drops: 'off' }, 'normal'], ['5五将棋', { size: 'mini' }, 'normal'], ['3人', { players: 3 }, 'weak']]) {
    let x = shogi.init({ rules: { ...rules, ...AUTO } });
    const moves = [];
    let bad = 0;
    let noPromo = 0;
    let promos = 0;
    let worst = 0;
    while (!x.result) {
      const t0 = Date.now();
      const mv = JSON.parse(JSON.stringify(shogi.cpu(x, x.turn, { cpu: level })));
      worst = Math.max(worst, Date.now() - t0);
      if (chooses(x, mv)) noPromo++;
      if (mv.pr) promos++;
      const n = shogi.apply(x, mv);
      if (!n) { bad++; break; }
      moves.push(mv);
      x = n;
    }
    const again = moves.reduce((y, m) => (y ? shogi.apply(y, m) : null), shogi.init({ rules: { ...rules, ...AUTO } }));
    check(`いつも成る: ${label}の CPU（${level}）どうしで最後まで指せ、成らない手を選ばない・当て直すと同じ局面`,
      !bad && !noPromo && worst < 2000 && again?.keys.at(-1) === x.keys.at(-1) && again.result?.reason === x.result.reason,
      `${x.ply}手・成った手 ${promos}・${x.result?.reason}・最長 ${(worst / 1000).toFixed(2)}秒`);
  }
}

// トライ（詳細設定）: 玉が相手の玉の最初のマスに入ったら勝ち。利きのあるマスへは入れない。なしでは今と同じ
{
  const t0 = shogi.init({ rules: { try: 'on' } });
  check('トライ: 局面に trial が付き、なしでは付かない', t0.trial === true && !('trial' in shogi.init()) && !('trial' in shogi.init({ rules: { try: 'off' } })));
  check('トライ: 3×4・3人には付かない', !('trial' in shogi.init({ rules: { try: 'on', size: 'zoo' } })) && !('trial' in shogi.init({ rules: { try: 'on', players: 3 } })));
  // 先手の玉 5二・後手の玉 1一
  const base = position([[1, 4, 8], [0, 8, -8], [8, 0, 2]]);
  const won = shogi.apply({ ...base, trial: true }, { f: sq(1, 4), t: sq(0, 4), pr: false });
  check('トライ: 先手の玉が 5一 に入ったら先手の勝ち', won?.result?.winner === 0 && /トライ/.test(won.result.reason) && won.trial === true, won?.result?.reason);
  const plain = shogi.apply(base, { f: sq(1, 4), t: sq(0, 4), pr: false });
  check('トライ: なしでは 5一 に入っても続く', plain && !plain.result);
  const side = shogi.apply({ ...base, trial: true }, { f: sq(1, 4), t: sq(0, 3), pr: false });
  check('トライ: ほかのマスでは続く', side && !side.result);
  // 後手の金が 4一 にいると 5一 に利いているので入れない
  const guarded = position([[1, 4, 8], [0, 8, -8], [0, 3, -5]]);
  check('トライ: 利きのある 5一 には入れない', shogi.apply({ ...guarded, trial: true }, { f: sq(1, 4), t: sq(0, 4), pr: false }) === null);
  // 後手の玉が 5九 に入る
  const gote = position([[7, 4, -8], [8, 0, 8]], { turn: 1 });
  const gw = shogi.apply({ ...gote, trial: true }, { f: sq(7, 4), t: sq(8, 4), pr: false });
  check('トライ: 後手の玉が 5九 に入ったら後手の勝ち', gw?.result?.winner === 1);
  // 5五将棋: 先手は 5一（マス0）、後手は 1五（マス24）
  check('トライ: 5五将棋のトライのマスは相手の玉の最初のマス', _test.trySq(0, 5) === _test.miniBoard().indexOf(-8) && _test.trySq(1, 5) === _test.miniBoard().indexOf(8)
    && _test.trySq(0, 9) === _test.initialBoard('none').indexOf(-8) && _test.trySq(1, 9) === _test.initialBoard('none').indexOf(8));
  const mini = shogi.init({ rules: { size: 'mini', try: 'on' } });
  const mb = Array(25).fill(0);
  mb[5] = 8; mb[24 - 4] = -8; // 先手の玉 5二・後手の玉 5五
  const mk = `${mb.join(',')}|${mini.hands[0].join('')}|${mini.hands[1].join('')}|0`;
  const mw = shogi.apply({ ...mini, board: mb, keys: [mk] }, { f: 5, t: 0, pr: false });
  check('トライ: 5五将棋で先手の玉が 5一 に入ったら勝ち', mw?.result?.winner === 0);
  // CPU（つよい・ふつう）はトライできるならする。ふつうは 8% の見込みで適当に打つ（わざと弱める）ので、その分は乱数を固定して外す
  // （固定しないと、この確認が 1割ほどの見込みで運で落ちた）
  const realRandom = Math.random;
  Math.random = () => 0.5;
  const cpuTry = ['strong', 'normal'].every((cpu) => {
    const m = shogi.cpu({ ...base, trial: true }, 0, { cpu });
    return m && m.f === sq(1, 4) && m.t === sq(0, 4);
  });
  Math.random = realRandom;
  check('トライ: CPU（つよい・ふつう）は入れるならトライする', cpuTry);
  // CPU どうしで最後まで（当て直すと同じ局面）
  for (const [label, rules] of [['本将棋', {}], ['5五将棋', { size: 'mini' }]]) {
    let x = shogi.init({ rules: { ...rules, try: 'on' } });
    const moves = [];
    let bad = 0;
    while (!x.result) {
      const mv = JSON.parse(JSON.stringify(shogi.cpu(x, x.turn, { cpu: 'weak' })));
      const n = shogi.apply(x, mv);
      if (!n) { bad++; break; }
      moves.push(mv);
      x = n;
    }
    const again = moves.reduce((y, m) => (y ? shogi.apply(y, m) : null), shogi.init({ rules: { ...rules, try: 'on' } }));
    check(`トライ: ${label}の CPU どうしで最後まで指せ、当て直すと同じ局面`, !bad && again?.keys.at(-1) === x.keys.at(-1) && again.result?.reason === x.result.reason, `${x.ply}手・${x.result?.reason}`);
  }
}

// 駒の並び「ばらばら」（2026-10-07 の18回目の案）
{
  console.log('--- 駒の並び（ばらばら）');
  check('駒の並びは最初は「ふつう」', shogi.settings.some((x) => x.key === 'mix' && x.def === 'off'));
  const std = shogi.init({ rules: {} });
  check('ふつうは局面に何も足さない', !('mixed' in std) && JSON.stringify(shogi.init({ rules: { mix: 'off' }, seed: 5 })) === JSON.stringify(std));
  const boards = new Set();
  let ok = true;
  for (let seed = 1; seed <= 60; seed++) {
    const s = shogi.init({ rules: { mix: 'on' }, seed });
    const b = s.board;
    const sorted = (a) => a.slice().sort((x, y) => x - y).join();
    const bottom = b.slice(72, 81);
    if (!s.mixed || b[sq(8, 4)] !== 8 || b[sq(0, 4)] !== -8) ok = false; // 玉は真ん中
    if (sorted(bottom) !== sorted([2, 3, 4, 5, 8, 5, 4, 3, 2])) ok = false; // 下の段の駒の種類と数はふつうと同じ
    if (sorted([b[sq(7, 1)], b[sq(7, 7)]]) !== '6,7') ok = false; // 角と飛
    if (!b.every((v, i) => v === -b[80 - i])) ok = false; // 後手は点対称の同じ並び
    if (JSON.stringify(b) === JSON.stringify(std.board)) ok = false; // ふつうと同じ並びにはならない
    if (JSON.stringify(shogi.init({ rules: { mix: 'on' }, seed }).board) !== JSON.stringify(b)) ok = false; // 同じ種なら同じ並び
    if (legalMoves(b, s.hands, 0).length < 20) ok = false;
    boards.add(b.join());
  }
  check('ばらばら: 玉は真ん中・駒の数は同じ・点対称・ふつうと違う・同じ種なら同じ', ok);
  check('ばらばら: 種ごとに並びが変わる', boards.size >= 55, `${boards.size}通り`);
  check('ばらばら: 駒落ち・5五将棋・3人では使わない', !shogi.init({ rules: { mix: 'on', handicap: 'bishop' }, seed: 3 }).mixed
    && !shogi.init({ rules: { mix: 'on', size: 'mini' }, seed: 3 }).mixed && !shogi.init({ rules: { mix: 'on', players: 3 }, seed: 3 }).mixed);
  for (const seed of [11, 12]) {
    let x = shogi.init({ rules: { mix: 'on', try: 'on' }, seed });
    const moves = [];
    let bad = 0;
    while (!x.result) {
      const mv = JSON.parse(JSON.stringify(shogi.cpu(x, x.turn, { cpu: 'weak' })));
      const n = shogi.apply(x, mv);
      if (!n) { bad++; break; }
      moves.push(mv);
      x = n;
    }
    const again = moves.reduce((y, m) => (y ? shogi.apply(y, m) : null), shogi.init({ rules: { mix: 'on', try: 'on' }, seed }));
    check(`ばらばら: CPU どうしで最後まで指せ、当て直すと同じ局面（種 ${seed}）`, !bad && x.mixed && again?.keys.at(-1) === x.keys.at(-1), `${x.ply}手・${x.result?.reason}`);
  }
}

// 王手の知らせ（詳細設定。最初は あり）: 王手をかけた手かを局面から決める。なしのときだけ局面に quiet が付く
{
  const G = _test.gaveCheck;
  check('王手の知らせは最初は「あり」', shogi.settings.some((x) => x.key === 'check' && x.def === 'on'));
  const plain = (r) => JSON.stringify(shogi.init({ rules: r, seed: 3 }));
  check('王手の知らせ: ありは局面に何も足さない', [{}, { size: 'mini' }, { size: 'zoo' }, { players: 3 }].every((r) => plain({ ...r, check: 'on' }) === plain(r)));
  check('王手の知らせ: なしは局面に quiet（本将棋・5五将棋・3×4・3人）', [{}, { size: 'mini' }, { size: 'zoo' }, { players: 3 }].every((r) => shogi.init({ rules: { ...r, check: 'off' } }).quiet === true));
  // 本将棋: 飛を5筋へ回して王手
  const p = position([[8, 8, 8], [0, 4, -8], [5, 0, 7]]);
  const c1 = shogi.apply(p, { f: sq(5, 0), t: sq(5, 4) });
  const c0 = shogi.apply(p, { f: sq(5, 0), t: sq(5, 1) });
  check('王手の知らせ: 王手をかけた手は王手・ほかは違う', G(c1) && !G(c0) && !G(p));
  check('王手の知らせ: 音は王手で「王手！」の読み上げ、ほかは駒の音', shogi.sound(p, c1) === 'oute' && shogi.sound(p, c0) === 'place');
  const q = shogi.apply({ ...p, quiet: true }, { f: sq(5, 0), t: sq(5, 4) });
  check('王手の知らせ: なしでは quiet が続き、読み上げない', q.quiet === true && shogi.sound(p, q) === 'place');
  const { quiet, ...rest } = q;
  check('王手の知らせ: なしでも apply の結果は同じ', JSON.stringify(rest) === JSON.stringify(c1));
  // 詰み（決着）の手では出さない: 1段目を飛で、2段目をもう1枚の飛で押さえる
  const mate = shogi.apply(position([[8, 8, 8], [0, 0, -8], [1, 5, 7], [4, 7, 7]]), { f: sq(4, 7), t: sq(0, 7) });
  check('王手の知らせ: 詰みの手では出さない', mate?.result?.reason === '詰み' && !G(mate));
  // 3×4: ライオンにキリンが利いたら王手
  const zs = shogi.init({ rules: { size: 'zoo' } });
  const zb = Array(12).fill(0);
  zb[3 * 3 + 1] = 4; zb[0 * 3 + 1] = -4; zb[2 * 3 + 1] = 3; zb[3 * 3 + 0] = 2;
  const zp = { ...zs, board: zb, keys: [] };
  const zc = shogi.apply(zp, { f: 2 * 3 + 1, t: 1 * 3 + 1 });
  const zn = shogi.apply(zp, { f: 3 * 3 + 1, t: 3 * 3 + 2 });
  check('王手の知らせ: 3×4 はライオンに利いたら王手', G(zc) && !G(zn) && shogi.sound(zp, zc) === 'oute' && shogi.sound(zp, zn) === 'place');
  check('王手の知らせ: 3×4 のなしでも quiet が続く', shogi.apply({ ...zp, quiet: true }, { f: 2 * 3 + 1, t: 1 * 3 + 1 }).quiet === true);
  // 3人: 当てずっぽうに指して、王手の手（指した人の駒がほかの人の玉に利く）が出ること・なしでも局面は同じこと
  let x3 = shogi.init({ rules: { players: 3 } });
  let y3 = shogi.init({ rules: { players: 3, check: 'off' } });
  let checks3 = 0;
  let same3 = true;
  for (let i = 0; i < 200 && !x3.result; i++) {
    const ms = _test3.legalMoves(x3.board, x3.hands, x3.turn);
    const m = ms[(i * 7919) % ms.length];
    const before = x3;
    x3 = shogi.apply(x3, m);
    y3 = shogi.apply(y3, m);
    if (G(x3)) { checks3++; if (shogi.sound(before, x3) !== 'oute' || shogi.sound(before, y3) !== 'place') same3 = false; }
    const { quiet: qq, ...r3 } = y3;
    if (JSON.stringify(r3) !== JSON.stringify(x3) || qq !== true) same3 = false;
  }
  check('王手の知らせ: 3人でも王手の手が分かり、なしでも局面は同じ', checks3 > 0 && same3, `王手 ${checks3}回`);
}

// 動かす手に d（打つ駒）を付けて送られても、持っていない駒を打たせない（2026-10-10 の Codex の点検で見つかった）
{
  const cases = [
    ['本将棋', shogi.init(), (s) => legalMoves(s.board, s.hands, s.turn)],
    ['3人将棋', shogi.init({ rules: { players: 3 } }), (s) => _test3.legalMoves(s.board, s.hands, s.turn)],
    ['3×4', shogi.init({ rules: { size: 'zoo' } }), (s) => _test34.moves(s.board, s.hands, s.turn)],
  ];
  for (const [name, s, list] of cases) {
    const mv = list(s).find((x) => !x.d);
    check(`${name}: 動かす手は通る`, !!shogi.apply(s, { f: mv.f, t: mv.t, pr: mv.pr }));
    check(`${name}: 動かす手に d を付けた手は反則`, shogi.apply(s, { f: mv.f, t: mv.t, pr: mv.pr, d: 2 }) === null);
  }
}

console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
