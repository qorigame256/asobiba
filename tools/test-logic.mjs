// ゲームのルール（勝敗判定・置ける場所）の自動確認。使い方: node tools/test-logic.mjs
import assert from 'node:assert/strict';
const { GAMES } = await import('../app/js/games/index.js');
const { tictactoe: T, connect4: C, reversi: R } = GAMES;

function play(g, moves) { let s = g.init(); for (const m of moves) { s = g.apply(s, m); assert.ok(s, 'illegal ' + m); } return s; }

// マルバツ
let s = play(T, [0, 3, 1, 4, 2]);
assert.deepEqual(T.result(s), { winner: 0, cells: [0, 1, 2] });
assert.equal(T.apply(s, 5), null, '決着後は打てない');
assert.equal(T.apply(T.init(), 9), null);
assert.equal(T.apply(play(T, [4]), 4), null, '埋まったマス');
s = play(T, [0, 1, 2, 4, 3, 5, 7, 6, 8]);
assert.deepEqual(T.result(s), { winner: null, cells: [] }, '引き分け');

// スーパーマルバツ（詳細設定「盤」= スーパー）
const big = (over = {}) => ({ ...T.init({ rules: { size: 'super' } }), ...over });
s = big();
assert.equal(s.next, 4, '最初は真ん中の盤');
assert.equal(T.apply(s, 0), null, '最初に真ん中以外の盤には置けない');
s = T.apply(s, 4 * 9 + 2);
assert.equal(s.next, 2, '右上のマスに置いたら次は右上の盤');
assert.equal(T.apply(s, 4 * 9 + 0), null, '決められた盤の外には置けない');
// ○ が盤0の 0・1 を持っていて、2 に置くと盤0を取る。2 の位置の盤（右上）が取られていれば次はどこでも
let bd = Array(81).fill(null); bd[0] = 0; bd[1] = 0;
let ow = Array(9).fill(null); ow[2] = 1;
s = T.apply(big({ board: bd, owner: ow, next: 0 }), 2);
assert.equal(s.owner[0], 0, '小さい盤で3つ並べたらその盤を取る');
assert.equal(s.next, null, '送り先が取られた盤ならどこでも置ける');
assert.equal(T.apply(s, 2 * 9 + 5), null, '取られた盤には自由に置けるときも置けない');
assert.ok(T.apply(s, 7 * 9 + 5), '空いている盤なら置ける');
// 盤0が埋まって誰も並ばない → 引き分けの盤
bd = Array(81).fill(null); [0, 1, 0, 0, 1, 1, 1, 0].forEach((v, i) => { bd[i] = v; });
s = T.apply(big({ board: bd, next: 0 }), 8); // ○ が 8 に置く（0・4・8 は ○・1・… で並ばない）
assert.equal(s.owner[0], 'd', '埋まって並ばない盤は引き分けの盤');
s = T.apply(big({ board: Array(81).fill(null), owner: [null, 'd', ...Array(7).fill(null)], next: 4 }), 4 * 9 + 1);
assert.equal(s.next, null, '引き分けの盤へ送られたらどこでも置ける');
assert.deepEqual(T.result(big({ owner: [0, 0, 0, 1, 1, null, null, null, null] })), { winner: 0, cells: [0, 1, 2] }, '取った盤が3つ並んだら勝ち');
assert.equal(T.result(big({ owner: [0, 1, 0, 'd', 1, 0, 1, 0, 1] })).winner, null, '置ける盤が無くなったら引き分け');
assert.equal(T.result(big({ owner: [0, 1, 0, 'd', null, 0, 1, 0, 1] })), null, 'まだ置ける盤があれば続く');

// コネクトフォー
s = play(C, [0, 1, 0, 1, 0, 1, 0]);
assert.equal(C.result(s).winner, 0, 'たて4');
s = play(C, [0, 0, 1, 1, 2, 2, 3]);
assert.equal(C.result(s).winner, 0, 'よこ4');
// ななめ: 赤が (5,0)(4,1)(3,2)(2,3)
s = play(C, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
assert.equal(C.result(s)?.winner, 0, 'ななめ');
assert.equal(C.apply(play(C, [0, 0, 0, 0, 0, 0]), 0), null, '満杯の列');
assert.equal(C.apply(C.init(), 7), null);

// リバーシ
s = R.init();
assert.equal(R.apply(s, 0), null);
s = R.apply(s, 19); // d3（黒）: d4 を返す
assert.ok(s);
assert.equal(s.board[27], 0);
assert.equal(s.turn, 1);
assert.deepEqual(s.flipped, [27]);

// ランダム対局で落ちないこと・必ず終わること
function randomGame(g, legalOf) {
  let st = g.init(); let n = 0;
  while (!g.result(st)) {
    const cands = legalOf(st);
    assert.ok(cands.length, g.id + ' 手が無いのに終わっていない');
    st = g.apply(st, cands[Math.floor(Math.random() * cands.length)]);
    assert.ok(st);
    if (++n > 200) throw new Error('終わらない');
  }
  return g.result(st);
}
const brute = (g, max) => (st) => Array.from({ length: max }, (_, i) => i).filter((i) => g.apply(st, i));
const tally = {};
for (const [g, max] of [[T, 9], [C, 7], [R, 64]]) {
  tally[g.id] = { 0: 0, 1: 0, null: 0 };
  for (let k = 0; k < 300; k++) tally[g.id][randomGame(g, brute(g, max)).winner]++;
}
// リバーシは終局時に盤が埋まっているか、両者とも置けない
console.log('random results', JSON.stringify(tally));

// ---------- いろあわせ（UNO と同じ遊び方） ----------
const U = GAMES.colors;
const total = (st) => st.deck.length + st.discard.length + st.hands.reduce((a, h) => a + h.length, 0);
assert.deepEqual(U.init(4, 12345), U.init(4, 12345), '同じ種なら同じ配り方');
assert.notDeepEqual(U.init(4, 12345).hands, U.init(4, 54321).hands, '種が違えば配り方も違う');
s = U.init(3, 1);
assert.equal(total(s), 108);
assert.ok(s.hands.every((h) => h.length === 7));
assert.match(s.discard[0], /^[rygb]\d$/, '最初の札は数字');

// 決めた局面から試す
const base = (o) => ({ n: 3, seed: 1, shuffles: 0, deck: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], discard: ['r5'], turn: 0, dir: 1, color: 'r', drawn: null, winner: null, step: 0, last: null, ...o });
s = base({ hands: [['r7', 'g5', 'g9', 'W', 'W4'], ['b1', 'b2'], ['y1', 'y2']] });
assert.equal(U.apply(s, { p: 1, t: 'play', i: 0 }), null, '手番でない人は出せない');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 2 }), null, '色も数字も違う札は出せない');
assert.ok(U.apply(s, { p: 0, t: 'play', i: 1 }), '数字が同じなら出せる');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 4, c: 'g' }), null, '場の色を持っているとドロー4は出せない');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 3 }), null, 'ワイルドは色を選ぶ');
let t = U.apply(s, { p: 0, t: 'play', i: 3, c: 'g' });
assert.equal(t.color, 'g');
assert.equal(t.turn, 1);
assert.equal(U.apply(s, { p: 0, t: 'pass' }), null, '引く前に「出さずに次へ」はできない');
t = U.apply(s, { p: 0, t: 'draw' }); // r6 を引く（出せる）
assert.equal(t.drawn, 'r6');
assert.equal(t.turn, 0, '引いた札が出せるならまだ自分の番');
assert.equal(U.apply(t, { p: 0, t: 'play', i: t.hands[0].indexOf('r7') }), null, '引いた後は引いた札しか出せない');
assert.ok(U.apply(t, { p: 0, t: 'play', i: t.hands[0].indexOf('r6') }));
assert.equal(U.apply(t, { p: 0, t: 'pass' }).turn, 1);
// 妨害札
s = base({ hands: [['rS', 'rR', 'rD', 'g1'], ['b1', 'b2'], ['y1', 'y2']] });
assert.equal(U.apply(s, { p: 0, t: 'play', i: s.hands[0].indexOf('rS') }).turn, 2, 'スキップ');
t = U.apply(s, { p: 0, t: 'play', i: s.hands[0].indexOf('rR') });
assert.equal(t.turn, 2, 'リバースで逆回り');
assert.equal(t.dir, -1);
t = U.apply(s, { p: 0, t: 'play', i: s.hands[0].indexOf('rD') });
assert.equal(t.hands[1].length, 4, 'ドロー2で次の人が2枚');
assert.equal(t.turn, 2, 'ドロー2で次の人は休み');
s = base({ n: 2, hands: [['rR', 'g1'], ['b1', 'b2']] });
assert.equal(U.apply(s, { p: 0, t: 'play', i: 0 }).turn, 0, '2人のリバースはスキップ');
s = base({ hands: [['g1', 'W4'], ['b1', 'b2'], ['y1', 'y2']] });
t = U.apply(s, { p: 0, t: 'play', i: 1, c: 'b' });
assert.equal(t.hands[1].length, 6, 'ドロー4');
assert.equal(t.turn, 2);
s = base({ hands: [['r1'], ['b1'], ['y1']] });
assert.equal(U.result(U.apply(s, { p: 0, t: 'play', i: 0 })).winner, 0, '出し切ったら勝ち');
// 山が尽きたら捨て札を切り直す
s = base({ deck: [], discard: ['g1', 'g2', 'g3', 'r5'], hands: [['b9'], ['b1'], ['y1']] });
t = U.apply(s, { p: 0, t: 'draw' });
assert.equal(t.hands[0].length, 2);
assert.deepEqual(t.discard, ['r5'], '一番上だけ残る');
assert.equal(total(t), total(s));

// CPU どうしで最後まで遊んで、札の枚数が変わらず必ず終わること
const wins = {};
for (let k = 0; k < 400; k++) {
  const n = 2 + (k % 9);
  let st = U.init(n, k * 7919 + 1);
  let steps = 0;
  while (!U.result(st)) {
    const p = U.turn(st);
    const next = U.apply(st, { ...U.cpu(st, p), p });
    assert.ok(next, 'CPU が反則の手を出した');
    assert.equal(total(next), 108, '札の枚数が変わった');
    st = next;
    if (++steps > 5000) throw new Error('いろあわせが終わらない');
  }
  wins[n] = (wins[n] ?? 0) + 1;
}
console.log('colors games by players', JSON.stringify(wins));

// ---------- 大富豪 ----------
const D = GAMES.daifugo;
const ALL = Object.fromEntries(D.settings.map((x) => [x.key, true]));
const NONE = Object.fromEntries(D.settings.map((x) => [x.key, false]));
const DEF = Object.fromEntries(D.settings.map((x) => [x.key, x.def]));
const dcount = (st) => st.hands.reduce((a, h) => a + h.length, 0);
s = D.init(4, 99, { rules: DEF });
assert.deepEqual(s, D.init(4, 99, { rules: DEF }), '同じ種なら同じ配り方');
assert.equal(dcount(s), 53, '52枚＋ジョーカー1枚を全部配る');
assert.ok(s.hands[s.turn].includes('d3'), '1戦目は ♦3 を持っている人から');
assert.equal(s.phase, 'play');

const dbase = (hands, o = {}) => ({
  n: hands.length, rules: { ...ALL }, hands, field: null, by: null, passed: hands.map(() => false), out: [], fouls: [],
  rev: false, back: false, lock: null, turn: 0, phase: 'play', gives: [], swaps: [], prevRank: null, ranking: null, step: 0, last: null, ...o,
});
const dplay = (st, p, cards) => D.apply(st, { p, t: 'play', cards });
const dpass = (st, p) => D.apply(st, { p, t: 'pass' });
s = dbase([['s4', 'h4', 's5', 'h9', 'c10'], ['s6', 'h6', 'd7', 'JK'], ['c3', 'd12', 's13']]);
assert.equal(dpass(s, 0), null, '場が空のときはパスできない');
assert.equal(dplay(s, 1, ['s6']), null, '手番でない人は出せない');
assert.equal(dplay(s, 0, ['s4', 's5']), null, '数字の違う2枚は組にならない');
t = dplay(s, 0, ['s4', 'h4']);
assert.equal(t.turn, 1);
assert.equal(dplay(t, 1, ['d7']), null, '2枚の場に1枚は出せない');
assert.ok(dplay(t, 1, ['d7', 'JK']), 'ジョーカーで2枚組にできる');
t = dplay(t, 1, ['s6', 'h6']);
assert.deepEqual(t.lock, ['h', 's'], 'しばり（同じマークの組が続いた）');
assert.equal(dpass(t, 2).turn, 0, 'パスすると次の人');
t = dpass(dpass(t, 2), 0);
assert.equal(t.field, null, '全員パスで場が流れる');
assert.equal(t.turn, 1, '最後に出した人から');
assert.equal(t.lock, null, '流れるとしばりも解ける');
// 階段・8切り・革命・ジョーカー
s = dbase([['s3', 's4', 's5', 'h8', 'c8', 'd8', 's8', 'c2'], ['h6', 'h7', 'JK', 'd2'], ['c9', 'c10']]);
t = dplay(s, 0, ['s3', 's4', 's5']);
assert.equal(t.field.kind, 'seq', '階段');
t = dplay(t, 1, ['h6', 'h7', 'JK']);
assert.ok(t, 'ジョーカー入りの階段で返せる');
s = dbase([['h8', 'c3'], ['h6'], ['c9']]);
t = dplay(s, 0, ['h8']);
assert.equal(t.field, null, '8切りで場が流れる');
assert.equal(t.turn, 0, '8切りした人から');
t = dplay(dbase([['h8', 'c3'], ['h6'], ['c9']], { rules: { ...ALL, eight: false } }), 0, ['h8']);
assert.equal(t.turn, 1, '8切りを切ると流れない');
s = dbase([['s5', 'h5', 'd5', 'c5', 'c4'], ['s3', 'd2'], ['c9']]);
t = dplay(s, 0, ['s5', 'h5', 'd5', 'c5']);
assert.equal(t.rev, true, '革命');
t = dpass(dpass(t, 1), 2);
t = dplay(t, 0, ['c4']);
assert.ok(dplay(t, 1, ['s3']), '革命中は3が4より強い');
assert.equal(dplay(t, 1, ['d2']), null, '革命中は2が4より弱い');
s = dbase([['c2', 'c4'], ['JK', 's6'], ['s3', 'c9']]);
t = dplay(s, 0, ['c2']);
t = dplay(t, 1, ['JK']);
assert.ok(t, 'ジョーカー1枚は2に勝つ');
t = dplay(t, 2, ['s3']);
assert.ok(t, 'スペ3返し');
assert.equal(t.field, null, 'スペ3返しで流れる');
s = dbase([['c2', 'c4'], ['JK', 's6'], ['s3', 'c9']], { rules: { ...ALL, spe3: false } });
assert.equal(dplay(dplay(dplay(s, 0, ['c2']), 1, ['JK']), 2, ['s3']), null, 'スペ3返しを切ると出せない');
// 上がり・反則上がり・都落ち
s = dbase([['c2'], ['s6', 's7'], ['c9', 'c10']]);
t = dplay(s, 0, ['c2']);
assert.deepEqual(t.fouls, [0], '2で上がると反則');
s = dbase([['c2'], ['s6', 's7'], ['c9', 'c10']], { rules: { ...ALL, foul: false } });
t = dplay(s, 0, ['c2']);
assert.deepEqual(t.out, [0], '反則上がりを切ると普通に上がり');
assert.equal(t.turn, 1, '上がった人の次の人へ');
s = dbase([['c5'], ['s6', 's7'], ['c9', 'c10']], { prevRank: [2, 0, 1] });
t = dplay(s, 0, ['c5']);
assert.deepEqual(t.fouls, [1], '大富豪が1番に上がれず都落ち');
assert.deepEqual(D.result(t).ranking, [0, 2, 1], '残り1人になったら終わり');
// カード交換
s = D.init(4, 7, { rules: DEF, prev: [3, 0, 2, 1] });
assert.equal(s.phase, 'exchange');
assert.equal(dcount(s), 53);
assert.equal(D.turn(s), null, '交換中は手番なし');
assert.ok(D.canAct(s, 1) && !D.canAct(s, 3), '大富豪から先に渡す');
assert.equal(D.apply(s, { p: 1, t: 'give', cards: [s.hands[1][0]] }), null, '大富豪は2枚渡す');
t = D.apply(s, { p: 1, t: 'give', cards: s.hands[1].slice(0, 2) });
t = D.apply(t, { p: 3, t: 'give', cards: t.hands[3].slice(0, 1) });
assert.equal(t.phase, 'play');
assert.equal(t.turn, 0, '大貧民から始める');
assert.deepEqual(t.hands.map((h) => h.length), D.init(4, 7, { rules: DEF }).hands.map((h) => h.length), '交換しても枚数は元どおり');
assert.equal(D.init(4, 7, { rules: { ...DEF, exchange: false }, prev: [3, 0, 2, 1] }).phase, 'play', 'カード交換を切ると交換しない');

// CPU どうしで最後まで遊んで、札が増減せず、順位が全員分つくこと（ルールの組み合わせを変えて）
const ruleSets = [DEF, ALL, NONE];
let dgames = 0;
for (let k = 0; k < 300; k++) {
  const n = 3 + (k % 6);
  const rules = ruleSets[k % 3];
  let prev = null;
  for (let g = 0; g < 2; g++) {
    let st = D.init(n, k * 104729 + g, { rules, prev });
    let steps = 0;
    let played = 0;
    while (!D.result(st)) {
      const p = st.phase === 'exchange' ? st.gives[0].from : D.turn(st);
      const move = { ...D.cpu(st, p), p };
      const next = D.apply(st, move);
      assert.ok(next, `大富豪の CPU が反則の手を出した（${n}人）`);
      if (move.t === 'play') played += move.cards.length;
      assert.equal(dcount(next) + played, 53, '札の枚数が合わない');
      st = next;
      if (++steps > 3000) throw new Error('大富豪が終わらない');
    }
    const r = D.result(st).ranking;
    assert.deepEqual(r.slice().sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i), '順位が全員分');
    prev = Array.from({ length: n }, (_, p) => D.carry(st, p));
    dgames++;
  }
}
console.log('daifugo games', dgames);

// ---------- ポーカー（5カードドロー） ----------
const P = GAMES.poker;
const { evaluate, compareEval, handName } = await import('../app/js/games/poker.js');
const ev = (str) => evaluate(str.split(' '));
const stronger = (a, b, label) => assert.ok(compareEval(ev(a), ev(b)) > 0, label);
assert.equal(handName(ev('s10 s11 s12 s13 s1')), 'ロイヤルストレートフラッシュ');
assert.equal(handName(ev('h1 d2 c3 s4 h5')), 'ストレート', 'A-2-3-4-5 もストレート');
assert.equal(handName(ev('h12 d13 c1 s2 h3')), '役なし', 'Q-K-A-2-3 はつながらない');
stronger('h2 d3 c4 s5 h6', 'h1 d2 c3 s4 h5', '6が上のストレートは A-5 より強い');
stronger('s9 h9 d9 c9 h2', 's8 h8 d8 c13 h13', 'フォーカード > フルハウス');
stronger('s2 s5 s7 s9 s11', 'h10 d11 c12 s13 h1', 'フラッシュ > ストレート');
stronger('s13 h13 d4 c4 h2', 's12 h12 d11 c11 h1', 'ツーペアは上のペアで比べる');
stronger('s13 h13 d4 c4 h3', 's13 c13 h4 s4 d2', 'ツーペアが同じなら残りの札');
stronger('s1 h1 d4 c7 h9', 's1 c1 h4 s7 d8', 'ワンペアが同じなら残りの札');
assert.equal(compareEval(ev('s1 h13 d4 c7 h9'), ev('c1 s13 h4 s7 d9')), 0, 'マーク違いは引き分け');

s = P.init(3, 5, { rules: { end: 'last', hands: 10 } });
assert.deepEqual(s, P.init(3, 5, { rules: { end: 'last', hands: 10 } }), '同じ種なら同じ配り方');
assert.deepEqual(s.h.bet.filter((x) => x).sort((a, b) => a - b), [10, 20], 'ブラインドを出す');
assert.equal(s.h.toAct, (s.h.bb + 1) % 3, 'ブラインドの次の人から');
assert.equal(P.apply(s, { p: s.h.toAct, t: 'check' }), null, '賭けがあるときはチェックできない');
t = P.init(2, 5, { rules: {} });
assert.equal(t.h.sb, t.h.dealer, '2人のときは親が小さいブラインド');
assert.equal(t.h.toAct, t.h.dealer, '2人のとき1回目の賭けは親から');

const pstate = (o, h) => ({
  n: 3, seed: 1, rules: { end: 'last', hands: 10 }, outAt: [null, null, null], outOrder: [], handNo: 1, dealer: 0,
  over: false, ranking: null, step: 0, last: null, ...o,
  h: {
    no: 1, dealer: 0, sb: 1, bb: 2, small: 10, big: 20, deck: [], muck: [], shuffles: 0, folded: [false, false, false],
    bet: [0, 0, 0], drew: [0, 0, 0], maxBet: 0, raises: 0, unit: 40, phase: 'bet2', result: null, ...h,
  },
});
// 0 はオールイン（100）、1 と 2 は 300 ずつ。0 が一番強く、1 が2番目
const sideCards = [['s9', 'h9', 'd9', 'c9', 'h2'], ['s8', 'h8', 'd8', 'c13', 'h13'], ['s2', 'h5', 'd7', 'c11', 'h12']];
s = pstate({ chips: [0, 500, 500] }, { cards: sideCards, total: [100, 300, 300], acted: [false, true, false], toAct: 2, startChips: [100, 800, 800] });
t = P.apply(s, { p: 2, t: 'check' });
assert.equal(t.h.phase, 'end', '全員そろったら勝負');
assert.deepEqual(t.chips, [300, 900, 500], 'オールインの人は自分が出した額の分だけ取れる（サイドポット）');
s = pstate({ chips: [0, 500, 500] }, { cards: [sideCards[2], sideCards[1], sideCards[0]], total: [100, 300, 300], acted: [false, true, false], toAct: 2, startChips: [100, 800, 800] });
t = P.apply(s, { p: 2, t: 'check' });
assert.deepEqual(t.chips, [0, 500, 1200], '一番強い人が全部取る');
assert.deepEqual(t.outAt, [1, null, null], '持ち点が無くなったら脱落');
assert.equal(t.over, false);
s = pstate({ chips: [0, 500, 500], rules: { end: 'hands', hands: 1 } }, { cards: sideCards, total: [100, 300, 300], acted: [false, true, false], toAct: 2, startChips: [100, 800, 800] });
t = P.apply(s, { p: 2, t: 'check' });
assert.deepEqual(P.result(t).ranking, [1, 2, 0], '決めた回数で終わり、持ち点の多い順');
s = pstate({ chips: [500, 500, 500] }, { cards: [['s10', 'h11', 'd12', 'c13', 'h1'], ['h10', 'c11', 's12', 'd13', 's1'], sideCards[2]], total: [101, 101, 101], acted: [true, true, false], toAct: 2, startChips: [601, 601, 601] });
t = P.apply(s, { p: 2, t: 'check' });
assert.deepEqual(t.chips, [651, 652, 500], '引き分けは山分け。端数は親（0）の次の人（1）から');
// 降りて1人になったら、その人が全部取る
s = P.init(3, 9, { rules: {} });
t = P.apply(s, { p: s.h.toAct, t: 'fold' });
const second = t.h.toAct;
t = P.apply(t, { p: second, t: 'fold' });
assert.equal(t.h.phase, 'end');
assert.equal(t.chips.reduce((a, b) => a + b, 0), 3000, '降りて終わってもチップの合計は同じ');

// CPU どうしで最後まで遊んで、チップの合計が変わらず、必ず終わること
let pgames = 0;
let hands = 0;
for (let k = 0; k < 60; k++) {
  const n = 2 + (k % 5);
  const rules = k % 2 ? { end: 'last', hands: 10 } : { end: 'hands', hands: 5 };
  let st = P.init(n, k * 31337 + 7, { rules });
  let steps = 0;
  while (!P.result(st)) {
    const p = st.h.phase === 'end' ? st.outAt.indexOf(null) : P.turn(st);
    const next = P.apply(st, { ...P.cpu(st, p), p });
    assert.ok(next, `ポーカーの CPU が反則の手を出した（${n}人）`);
    st = next;
    const inPot = st.h.phase === 'end' ? 0 : st.h.total.reduce((a, b) => a + b, 0);
    assert.equal(st.chips.reduce((a, b) => a + b, 0) + inPot, n * 1000, 'チップの合計が変わった');
    assert.ok(st.chips.every((c) => c >= 0));
    if (++steps > 30000) throw new Error('ポーカーが終わらない');
  }
  const r = P.result(st).ranking;
  assert.deepEqual(r.slice().sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i), '順位が全員分');
  if (rules.end === 'hands') assert.equal(st.handNo, 5, '決めた回数で終わる');
  pgames++;
  hands += st.handNo;
}
console.log('poker games', pgames, 'hands', hands);

// ---------- スピード ----------
const SP = GAMES.speed;
const spCount = (st) => [0, 1].reduce((a, p) => a + st.decks[p].length + st.fields[p].filter(Boolean).length + st.piles[p].length, 0);
s = SP.init(2, 42, { rules: {} });
assert.deepEqual(s, SP.init(2, 42, { rules: {} }), '同じ種なら同じ配り方');
assert.equal(spCount(s), 52);
assert.ok([...s.decks[0], ...s.fields[0], ...s.piles[0]].every((c) => 'hd'.includes(c[0])), 'プレイヤー0は赤');
assert.ok([...s.decks[1], ...s.fields[1], ...s.piles[1]].every((c) => 'sc'.includes(c[0])), 'プレイヤー1は黒');
const spBase = (o) => ({ n: 2, rules: { cpu: 'slow' }, decks: [['h9'], ['s9']], fields: [['h5', 'h1', 'd12', null], ['s7', 's2', 'c3', 'c4']], piles: [['d6'], ['c13']], winner: null, draw: false, step: 0, last: null, flips: 0, ...o });
s = spBase();
t = SP.apply(s, { p: 0, t: 'play', card: 'h5', pile: 0 });
assert.ok(t, '6 の上に 5');
assert.deepEqual(t.fields[0], ['h9', 'h1', 'd12', null], '空いた所に山から補充');
assert.equal(SP.apply(t, { p: 0, t: 'play', card: 'h5', pile: 0 }), null, '同じ手が2回来ても2回目は弾く');
assert.ok(SP.apply(s, { p: 0, t: 'play', card: 'h1', pile: 1 }), 'K の上に A（つながる）');
assert.ok(SP.apply(s, { p: 0, t: 'play', card: 'd12', pile: 1 }), 'K の上に Q');
assert.equal(SP.apply(s, { p: 1, t: 'play', card: 'h5', pile: 0 }), null, '相手の札は出せない');
assert.equal(SP.apply(s, { p: 1, t: 'play', card: 's2', pile: 0 }), null, '数字が1つ違わないと出せない');
assert.equal(SP.apply(s, { p: 0, t: 'flip' }), null, '出せる札があるうちはスピード！できない');
s = spBase({ fields: [['h3', null, null, null], ['s9', null, null, null]], piles: [['d6'], ['c13']] });
t = SP.apply(s, { p: 1, t: 'flip' });
assert.ok(t, '2人とも出せないとスピード！');
assert.deepEqual(t.piles.map((pl) => pl[pl.length - 1]), ['h9', 's9'], 'それぞれ自分の山の一番上を自分の側へ');
s = spBase({ decks: [[], []], fields: [['h3', null, null, null], ['s9', 's10', null, null]], piles: [['d6'], ['c13']] });
t = SP.apply(s, { p: 0, t: 'flip' });
assert.equal(SP.result(t).winner, 0, '山が無ければ手元の札を出し、出し切ったら勝ち');
s = spBase({ decks: [[], []], fields: [['h3', null, null, null], ['s9', null, null, null]], piles: [['d6'], ['c13']] });
assert.equal(SP.result(SP.apply(s, { p: 0, t: 'flip' })).draw, true, '同時に出し切ったら引き分け');
// CPU どうしで最後まで（どちらが先に動くかは毎回ばらばら）
let spGames = 0;
for (let k = 0; k < 300; k++) {
  let st = SP.init(2, k * 7 + 3, { rules: {} });
  let steps = 0;
  while (!SP.result(st)) {
    const p = Math.random() < 0.5 ? 0 : 1;
    const m = SP.cpu(st, p);
    if (!m) { assert.ok(SP.cpu(st, 1 - p), '2人とも何もしないと止まる'); continue; }
    const next = SP.apply(st, { ...m, p });
    assert.ok(next, 'スピードの CPU が反則の手を出した');
    assert.equal(spCount(next), 52, '札の枚数が変わった');
    st = next;
    if (++steps > 2000) throw new Error('スピードが終わらない');
  }
  spGames++;
}
console.log('speed games', spGames);

// ---------- ヒット＆ブロー ----------
const HB = GAMES.hitblow;
s = HB.init(3, 99, { rules: { digits: 4 } });
assert.deepEqual(s, HB.init(3, 99, { rules: { digits: 4 } }), '同じ種なら同じ答え');
assert.equal(new Set(s.answer).size, 4, '答えの数字は重ならない');
assert.equal(HB.init(2, 99, { rules: { digits: 3 } }).answer.length, 3);
s = { ...HB.init(3, 1, { rules: { mode: 'race' } }), answer: '1234' };
assert.equal(HB.apply(s, { p: 0, t: 'guess', g: '1123', r: 1 }), null, '同じ数字は使えない');
assert.equal(HB.apply(s, { p: 0, t: 'guess', g: '123', r: 1 }), null, '桁数が違う');
assert.equal(HB.apply(s, { p: 0, t: 'guess', g: '1243', r: 2 }), null, '回が違う');
t = HB.apply(s, { p: 0, t: 'guess', g: '1243', r: 1 });
assert.ok(t);
assert.equal(HB.apply(t, { p: 0, t: 'guess', g: '5678', r: 1 }), null, '同じ回に2回は出せない');
assert.deepEqual(t.hist[0], [], '全員そろうまで結果は出ない');
t = HB.apply(t, { p: 1, t: 'guess', g: '5678', r: 1 });
t = HB.apply(t, { p: 2, t: 'guess', g: '4321', r: 1 });
assert.deepEqual(t.hist[0][0], { g: '1243', hit: 2, blow: 2 }, 'ヒット2・ブロー2');
assert.deepEqual(t.hist[1][0], { g: '5678', hit: 0, blow: 0 });
assert.deepEqual(t.hist[2][0], { g: '4321', hit: 0, blow: 4 });
assert.equal(t.round, 2);
assert.equal(HB.result(t), null);
for (const [p, g] of [[0, '1234'], [1, '9870'], [2, '1234']]) t = HB.apply(t, { p, t: 'guess', g, r: 2 });
assert.deepEqual(HB.result(t).winners, [0, 2], '同じ回に当てたら同着');
assert.equal(HB.apply(t, { p: 1, t: 'guess', g: '1234', r: 3 }), null, '終わったら出せない');
// 順番に当てる（最初の遊び方）
s = { ...HB.init(3, 1, { rules: {} }), answer: '1234' };
assert.equal(s.mode, 'turn', '最初は「順番に当てる」');
assert.equal(HB.turn(s), 0);
assert.equal(HB.apply(s, { p: 1, t: 'guess', g: '5678', r: 1 }), null, '番でない人は出せない');
t = HB.apply(s, { p: 0, t: 'guess', g: '1243', r: 1 });
assert.deepEqual(t.log, [{ p: 0, g: '1243', hit: 2, blow: 2 }], '結果はすぐ全員に見える');
assert.equal(HB.turn(t), 1, '次の人の番');
assert.equal(HB.apply(t, { p: 0, t: 'guess', g: '1243', r: 1 }), null, '同じ手が2回届いても2回目は弾く');
t = HB.apply(t, { p: 1, t: 'guess', g: '5678', r: 2 });
t = HB.apply(t, { p: 2, t: 'guess', g: '1234', r: 3 });
assert.deepEqual(HB.result(t).winners, [2], '最初に当てた人だけの勝ち');
assert.equal(HB.turn(t), null);
let hbRounds = 0;
for (let k = 0; k < 100; k++) {
  const n = 2 + (k % 4);
  let st = HB.init(n, k * 13 + 5, { rules: { digits: k % 2 ? 3 : 4, mode: k % 4 < 2 ? 'race' : 'turn' } });
  while (!HB.result(st)) {
    const ps = Array.from({ length: n }, (_, p) => p).filter((p) => HB.canAct(st, p));
    const p = ps[Math.floor(Math.random() * ps.length)];
    st = HB.apply(st, { ...HB.cpu(st, p), p });
    assert.ok(st, 'ヒット＆ブローの CPU が反則の手を出した');
    if (st.round > 60) throw new Error('ヒット＆ブローが終わらない');
  }
  hbRounds += st.round;
}
console.log('hitblow games 100, avg rounds', (hbRounds / 100).toFixed(1));

// ---------- 戦争（指の遊び） ----------
const SS = GAMES.sensou;
const ssBase = (hands, o = {}) => ({ ...SS.init(hands.length, 0, { rules: o.rules ?? {} }), hands, ...o });
s = ssBase([[3, 1], [2, 1]]);
assert.equal(SS.apply(s, { p: 1, t: 'atk', from: 0, to: 0, hand: 0 }), null, '手番でない人は動けない');
assert.equal(SS.apply(s, { p: 0, t: 'atk', from: 0, to: 0, hand: 1 }), null, '自分の手はタッチできない');
t = SS.apply(s, { p: 0, t: 'atk', from: 0, to: 1, hand: 0 });
assert.deepEqual(t.hands[1], [0, 1], '3＋2 でちょうど5本 → 消える');
assert.equal(t.turn, 1);
assert.equal(SS.apply(t, { p: 1, t: 'atk', from: 0, to: 0, hand: 0 }), null, '消えた手ではタッチできない');
s = ssBase([[4, 1], [2, 1]]);
assert.deepEqual(SS.apply(s, { p: 0, t: 'atk', from: 0, to: 1, hand: 0 }).hands[1], [1, 1], '5を超えたら超えた分: 4＋2 → 1本');
s = ssBase([[4, 1], [4, 1]]);
assert.deepEqual(SS.apply(s, { p: 0, t: 'atk', from: 0, to: 1, hand: 0 }).hands[1], [3, 1], '5を超えたら超えた分: 4＋4 → 3本');
s = ssBase([[1, 3], [1, 1]]);
assert.equal(SS.apply(s, { p: 0, t: 'split', h: [3, 1] }), null, '入れ替えただけの形にはできない');
assert.equal(SS.apply(s, { p: 0, t: 'split', h: [2, 3] }), null, '合計は変えられない');
assert.deepEqual(SS.apply(s, { p: 0, t: 'split', h: [2, 2] }).hands[0], [2, 2]);
assert.equal(SS.apply(s, { p: 0, t: 'split', h: [0, 4] }), null, '分けて手を0本にはできない');
assert.deepEqual(SS.apply(ssBase([[0, 2], [1, 1]]), { p: 0, t: 'split', h: [1, 1] }).hands[0], [1, 1], '消えた手にも配れる');
assert.equal(SS.apply(ssBase([[1, 3], [1, 1]], { rules: { split: false } }), { p: 0, t: 'split', h: [2, 2] }), null, '「分ける」なしなら分けられない');
// 3人: 1人が抜けると、その人の番は飛ばす。最後の1人で勝ち
s = ssBase([[4, 0], [1, 0], [2, 2]]);
t = SS.apply(s, { p: 0, t: 'atk', from: 0, to: 1, hand: 0 });
assert.deepEqual(t.out, [1], '両手とも消えたら抜ける');
assert.equal(t.turn, 2, '抜けた人の番は飛ばす');
t = SS.apply({ ...t, hands: [[1, 0], [0, 0], [4, 0]] }, { p: 2, t: 'atk', from: 0, to: 0, hand: 0 });
assert.equal(SS.result(t).winner, 2);
assert.deepEqual(SS.result(t).ranking, [2, 0, 1], '順位は抜けた順の逆');
let ssDraws = 0;
for (let k = 0; k < 300; k++) {
  const n = 2 + (k % 5);
  const rules = { split: k % 3 !== 0 };
  let st = SS.init(n, 0, { rules });
  while (!SS.result(st)) {
    const m = SS.cpu(st, st.turn);
    st = SS.apply(st, { ...m, p: st.turn });
    assert.ok(st, '戦争の CPU が反則の手を出した');
    assert.ok(st.hands.every((h) => h.every((v) => v >= 0 && v <= 4)), '指は0〜4本');
  }
  if (SS.result(st).draw) ssDraws++;
  else assert.equal(SS.result(st).ranking.length, n, '順位が全員分');
}
console.log('sensou games 300, draws', ssDraws);

// ---------- 指スマ ----------
const YS = GAMES.yubisuma;
s = YS.init(3, 0, { rules: {} });
assert.equal(YS.apply(s, { p: 1, t: 'pick', r: 1, up: 1, call: 2 }), null, '親でない人は数を言えない');
assert.equal(YS.apply(s, { p: 0, t: 'pick', r: 1, up: 1 }), null, '親は数を言う');
assert.equal(YS.apply(s, { p: 0, t: 'pick', r: 1, up: 3, call: 3 }), null, '手の数より多くは上げられない');
assert.equal(YS.apply(s, { p: 0, t: 'pick', r: 1, up: 1, call: 7 }), null, '全員の手の数より大きい数は言えない');
t = YS.apply(s, { p: 0, t: 'pick', r: 1, up: 1, call: 3 });
assert.equal(YS.apply(t, { p: 0, t: 'pick', r: 1, up: 1, call: 3 }), null, '同じ回に2回は選べない');
t = YS.apply(t, { p: 1, t: 'pick', r: 1, up: 2 });
t = YS.apply(t, { p: 2, t: 'pick', r: 1, up: 0 });
assert.equal(t.last.total, 3);
assert.equal(t.last.hit, true, '合計が言った数なら当たり');
assert.deepEqual(t.hands, [1, 2, 2], '当たった親は片手を下ろす');
assert.equal(t.parent, 1, '親は次の人へ');
for (const [p, up, call] of [[1, 0, 4], [0, 1], [2, 1]]) t = YS.apply(t, { p, t: 'pick', r: 2, up, ...(call !== undefined ? { call } : {}) });
assert.equal(t.last.hit, false);
assert.deepEqual(t.hands, [1, 2, 2], 'はずれなら変わらない');
assert.equal(t.parent, 2);
// 抜けた人は選ばない・親にならない
s = { ...YS.init(3, 0, { rules: {} }), hands: [1, 2, 1], parent: 0 };
for (const [p, up, call] of [[0, 1, 2], [1, 1], [2, 0]]) s = YS.apply(s, { p, t: 'pick', r: 1, up, ...(call !== undefined ? { call } : {}) });
assert.deepEqual(s.out, [0], '両手を下ろしたら抜ける');
assert.equal(s.parent, 1);
assert.equal(YS.canAct(s, 0), false, '抜けた人は選ばない');
assert.equal(YS.result(s), null, '最後の1人までなら続く');
s = { ...YS.init(3, 0, { rules: { end: 'first' } }), hands: [1, 2, 1], parent: 0 };
for (const [p, up, call] of [[0, 1, 2], [1, 1], [2, 0]]) s = YS.apply(s, { p, t: 'pick', r: 1, up, ...(call !== undefined ? { call } : {}) });
assert.equal(YS.result(s).winner, 0, '「最初に抜けた人の勝ち」ならそこで終わり');
let ysRounds = 0;
for (let k = 0; k < 200; k++) {
  const n = 2 + (k % 7);
  let st = YS.init(n, 0, { rules: { end: k % 3 ? 'last' : 'first' } });
  while (!YS.result(st)) {
    const ps = Array.from({ length: n }, (_, p) => p).filter((p) => YS.canAct(st, p));
    const p = ps[Math.floor(Math.random() * ps.length)];
    st = YS.apply(st, { ...YS.cpu(st, p), p });
    assert.ok(st, '指スマの CPU が反則の手を出した');
    if (st.round > 2000) throw new Error('指スマが終わらない');
  }
  assert.equal(YS.result(st).ranking.length, n, '順位が全員分');
  ysRounds += st.round;
}
console.log('yubisuma games 200, avg rounds', (ysRounds / 200).toFixed(1));

// ---------- 神経衰弱 ----------
const MM = GAMES.memory;
assert.equal(MM.init(2, 5, { rules: {} }).cards.length, 48, '最初は48枚');
for (const [size, top] of [[48, 12], [36, 9], [24, 6]]) {
  const m = MM.init(2, 5, { rules: { size } });
  assert.equal(m.cards.length, size);
  assert.equal(new Set(m.cards).size, size, '同じ札が2枚無い');
  assert.ok(m.cards.every((c) => Number(c.slice(1)) <= top), `${size}枚は${top}まで`);
}
s = MM.init(2, 5, { rules: { size: 24 } });
assert.deepEqual(s, MM.init(2, 5, { rules: { size: 24 } }), '同じ種なら同じ並び');
s = { ...MM.init(2, 0, { rules: { size: 24 } }), cards: ['s1', 'h1', 's2', 'h2', 's3', 'h3'], taken: Array(6).fill(null), seen: Array(6).fill(false) };
assert.equal(MM.apply(s, { p: 1, t: 'flip', i: 0 }), null, '手番でない人はめくれない');
t = MM.apply(s, { p: 0, t: 'flip', i: 0 });
assert.equal(MM.apply(t, { p: 0, t: 'flip', i: 0 }), null, '同じ札は2回めくれない');
t = MM.apply(t, { p: 0, t: 'flip', i: 1 });
assert.deepEqual([t.taken[0], t.taken[1], t.scores[0], t.turn], [0, 0, 1, 0], 'そろえたらもらえて、もう1回');
assert.equal(MM.apply(t, { p: 0, t: 'flip', i: 0 }), null, '取った札はめくれない');
t = MM.apply(MM.apply(t, { p: 0, t: 'flip', i: 2 }), { p: 0, t: 'flip', i: 4 });
assert.deepEqual([t.turn, t.open], [1, [2, 4]], 'はずれたら次の人へ。2枚は表のまま');
t = MM.apply(t, { p: 1, t: 'flip', i: 2 });
assert.deepEqual(t.open, [2], '次の人がめくると、前の2枚は伏せる（めくり直してもよい）');
let mmGames = 0;
for (let k = 0; k < 200; k++) {
  const n = 2 + (k % 7);
  let st = MM.init(n, k * 31 + 1, { rules: { size: [48, 36, 24][k % 3] } });
  let steps = 0;
  while (!MM.result(st)) {
    st = MM.apply(st, { ...MM.cpu(st, st.turn), p: st.turn });
    assert.ok(st, '神経衰弱の CPU が反則の手を出した');
    if (++steps > 5000) throw new Error('神経衰弱が終わらない');
  }
  assert.equal(st.scores.reduce((a, b) => a + b, 0), st.cards.length / 2, '組の数の合計');
  mmGames++;
}
console.log('memory games', mmGames);
// ---------- 石取り ----------
const NIM = GAMES.nim;
const { goodMove } = await import('../app/js/games/nim.js');
const nimMaxes = new Set();
for (let k = 0; k < 200; k++) {
  const a = NIM.init(3, k, { rules: {} });
  assert.deepEqual(a, NIM.init(3, k, { rules: {} }), '石取りの山は seed から毎回同じ');
  assert.ok(a.piles.length === 1 && a.piles[0] >= 15 && a.piles[0] <= 30, '山1つ・15〜30個');
  assert.ok(a.max >= 3 && a.max <= 5, '1回の最大は3〜5個');
  nimMaxes.add(a.max);
}
assert.equal(nimMaxes.size, 3, '1回の最大が3・4・5のどれも出る');
const nimBase = (o) => ({ n: 3, rules: { last: 'lose' }, piles: [9], start: [9], max: 3, turn: 0, ender: null, step: 0, last: null, ...o });
s = nimBase();
assert.equal(NIM.apply(s, { p: 1, t: 'take', pile: 0, k: 1 }), null, '手番でない人は取れない');
assert.equal(NIM.apply(s, { p: 0, t: 'take', pile: 0, k: 4 }), null, '最大3個の対局では4個取れない');
assert.equal(NIM.apply(s, { p: 0, t: 'take', pile: 0, k: 0 }), null, '0個は取れない');
assert.ok(NIM.apply(nimBase({ max: 5 }), { p: 0, t: 'take', pile: 0, k: 5 }), '最大5個の対局では5個取れる');
assert.equal(NIM.apply(nimBase({ max: 5 }), { p: 0, t: 'take', pile: 0, k: 6 }), null, '最大5個の対局では6個取れない');
assert.equal(NIM.apply(nimBase({ piles: [2], start: [2] }), { p: 0, t: 'take', pile: 0, k: 3 }), null, '残りより多くは取れない');
t = NIM.apply(NIM.apply(nimBase({ piles: [3] }), { p: 0, t: 'take', pile: 0, k: 2 }), { p: 1, t: 'take', pile: 0, k: 1 });
assert.equal(t.max, 3, '最大数は対局の間変わらない');
assert.equal(NIM.result(t).loser, 1, '最後の1個を取った人の負け');
assert.equal(NIM.result(t).winner, null, '3人以上は負けが1人');
t = NIM.apply(NIM.apply(nimBase({ rules: { last: 'win' }, piles: [3] }), { p: 0, t: 'take', pile: 0, k: 2 }), { p: 1, t: 'take', pile: 0, k: 1 });
assert.equal(NIM.result(t).winner, 1, '「最後を取った人の勝ち」');
assert.equal(t.turn, 1, '終わったら手番は進めない');
// 筋の良い手: 残りを「最大数＋1」の倍数（負けルールは倍数＋1）にする
assert.deepEqual(goodMove(nimBase({ piles: [7] })), { pile: 0, k: 2 }, '最大3・負け: 4の倍数+1を残す');
assert.deepEqual(goodMove(nimBase({ max: 4, rules: { last: 'win' }, piles: [12] })), { pile: 0, k: 2 }, '最大4・勝ち: 5の倍数を残す');
assert.equal(goodMove(nimBase({ max: 5, piles: [7] })), null, '最大5・負けで7個（6の倍数+1）は筋の良い手が無い');
// CPU どうしで最後まで
for (let k = 0; k < 300; k++) {
  const rules = [{}, { last: 'win' }][k % 2];
  const n = 2 + (k % 5);
  let st = NIM.init(n, k, { rules });
  let steps = 0;
  while (!NIM.result(st)) {
    const next = NIM.apply(st, { ...NIM.cpu(st, st.turn), p: st.turn });
    assert.ok(next, '石取りの CPU が反則の手を出した');
    st = next;
    if (++steps > 200) throw new Error('石取りが終わらない');
  }
}

// ---------- 旗揚げ ----------
const FL = GAMES.flags;
const ref = (g, st, t) => { const r = g.apply(st, { p: -1, t }); assert.ok(r, '進行役の手 ' + t); return r; };
// お題の文と正しい形が合っているか（文を自分で読み直して確かめる）
function readCommand(text, pose) {
  const next = { ...pose };
  for (const part of text.split('、')) {
    const m = part.match(/^(赤|白)(上げ|下げ)(て|ないで|ない)$/);
    assert.ok(m, 'お題の形 ' + text);
    if (m[3] === 'て') next[m[1] === '赤' ? 'r' : 'w'] = m[2] === '上げ' ? 1 : 0;
  }
  return next;
}
for (let k = 0; k < 300; k++) {
  const st = FL.init(3, k, { rules: {} });
  let pose = { r: 0, w: 0 };
  for (const c of st.cmds) {
    assert.deepEqual(c.pose, readCommand(c.text, pose), 'お題と正しい形が食い違う: ' + c.text);
    pose = c.pose;
  }
}
s = ref(FL, FL.init(3, 5, { rules: {} }), 'next');
assert.equal(s.phase, 'open');
assert.equal(FL.apply(s, { p: 0, t: 'next' }), null, '進行役の手はプレイヤーには打てない');
const want = s.cmds[0].pose;
const wrong = { r: 1 - want.r, w: want.w };
s = FL.apply(s, { p: 0, t: 'pose', q: 0, ...want, ms: 900, n: 1 });
assert.ok(s);
assert.equal(FL.apply(s, { p: 0, t: 'pose', q: 0, ...want, ms: 900, n: 1 }), null, '同じ手が2回届いても2回目は弾く');
s = FL.apply(s, { p: 1, t: 'pose', q: 0, ...want, ms: 400, n: 1 });
s = FL.apply(s, { p: 2, t: 'pose', q: 0, ...wrong, ms: 100, n: 1 });
s = ref(FL, s, 'close');
assert.deepEqual(s.scores, [2, 3, 0], '速い順に3点・2点、間違いは0点');
assert.equal(FL.apply(s, { p: 0, t: 'pose', q: 0, ...want, ms: 50, n: 2 }), null, '締め切ったあとは受け付けない');
// 動かさないのが正解のお題では、動かさなかった人が全員同着
s = FL.init(2, 1, { rules: {} });
s.cmds = [{ text: '赤上げない', pose: { r: 0, w: 0 } }, ...s.cmds.slice(1)];
s = ref(FL, ref(FL, s, 'next'), 'close');
assert.deepEqual(s.scores, [3, 3], '動かさないのが正解なら全員1位');
// 最後まで進む
s = FL.init(2, 9, { rules: {} });
for (let q = 0; q < 15; q++) s = ref(FL, ref(FL, s, 'next'), 'close');
s = ref(FL, s, 'next');
assert.ok(FL.result(s), '15問で終わる');
// 後半ほど点が増え、長いお題は11問目から
{
  let longs = 0;
  for (let k = 0; k < 200; k++) {
    const st = FL.init(2, k, { rules: {} });
    st.cmds.forEach((c, q) => {
      if (c.long) { longs++; assert.ok(q >= 10, '長いお題は11問目から'); assert.equal(c.text.split('、').length, 3, '長いお題は命令3つ'); }
    });
  }
  assert.ok(longs > 300, '長いお題がちゃんと出る');
  const pointsAt = (q) => {
    let st = FL.init(2, 3, { rules: {} });
    st.cmds = st.cmds.map(() => ({ text: '赤上げて', pose: { r: 1, w: 0 } }));
    for (let i = 0; i < q; i++) st = ref(FL, ref(FL, st, 'next'), 'close');
    st = ref(FL, st, 'next');
    st = FL.apply(st, { p: 0, t: 'pose', q, r: 1, w: 0, ms: 300, n: 1 });
    return ref(FL, st, 'close').last[0].pt;
  };
  assert.deepEqual([pointsAt(0), pointsAt(5), pointsAt(10)], [3, 6, 9], '1位の点は 3・6・9');
}

// ---------- 難読漢字 ----------
const KJ = GAMES.kanji;
const { KANJI } = await import('../app/js/games/kanji-data.js');
const { isRight } = await import('../app/js/games/kanji.js');
const allWords = [...KANJI.easy, ...KANJI.hard, ...KANJI.expert];
assert.ok(allWords.length >= 200, '問題は200語以上');
assert.equal(new Set(allWords.map(([w]) => w)).size, allWords.length, '同じ漢字が2回入っている');
for (const [w, ys] of allWords) for (const y of ys) assert.match(y, /^[ぁ-ゖー]+$/, '読みはひらがなだけ: ' + w);
assert.ok(isRight(['あじさい'], 'アジサイ'), 'カタカナでも正解');
assert.ok(isRight(['あじさい'], ' あじ さい '), '空白は無視');
assert.ok(isRight(['なす', 'なすび'], 'なすび'), '読みが複数あればどれでも');
assert.ok(!isRight(['あじさい'], 'あじさ'), '足りないのは不正解');
s = ref(KJ, KJ.init(3, 2, { rules: {} }), 'next');
const yomi = s.qs[0][1][0];
s = KJ.apply(s, { p: 0, t: 'try', q: 0, text: 'ちがう', ms: 3000, n: 1 });
assert.equal(s.solved[0], null, 'まちがい');
assert.equal(KJ.apply(s, { p: 0, t: 'try', q: 0, text: yomi, ms: 4000, n: 1 }), null, '同じ番号の答えは2回目を弾く');
s = KJ.apply(s, { p: 0, t: 'try', q: 0, text: yomi, ms: 4000, n: 2 });
assert.equal(s.solved[0], 4000);
assert.equal(KJ.referee(s).key, 'solved0', '誰かが正解したら少し待って締め切る');
s = KJ.apply(s, { p: 2, t: 'try', q: 0, text: yomi, ms: 3500, n: 1 });
assert.equal(KJ.apply(s, { p: 2, t: 'try', q: 0, text: yomi, ms: 100, n: 2 }), null, '正解したあとは答えられない');
s = ref(KJ, s, 'close');
assert.deepEqual(s.scores, [0, 0, 1], '届いた順ではなく、速く正解した人に1点');
for (const level of ['easy', 'hard', 'expert', 'mix']) {
  const st = KJ.init(2, 7, { rules: { level } });
  assert.equal(new Set(st.qs.map(([w]) => w)).size, 10, '10問とも違う漢字: ' + level);
}

// ---------- 的の早押し ----------
const TG = GAMES.targets;
const { scoresOf, KINDS } = await import('../app/js/games/targets.js');
for (let k = 0; k < 100; k++) {
  const st = TG.init(2, k, { rules: { time: '30', bombs: k % 2 === 0 } });
  assert.deepEqual(st.targets, TG.init(2, k, { rules: { time: '30', bombs: k % 2 === 0 } }).targets, '的の出方は seed から毎回同じ');
  assert.ok(st.targets.length > 20, '的がたくさん出る');
  assert.ok(st.targets.every((x, i) => x.id === i && x.at + x.life <= 30000 && x.x > 0 && x.x < 1 && x.y > 0 && x.y < 1));
  if (k % 2) assert.ok(st.targets.every((x) => x.kind !== 'bomb'), 'ドクロなしの設定');
  assert.ok(st.targets.some((x, i) => i > 0 && x.at === st.targets[i - 1].at), '同時に出る的がある');
}
s = TG.init(3, 4, { rules: { time: '30', bombs: true } });
assert.equal(TG.apply(s, { p: 0, t: 'hit', id: 0, ms: 300 }), null, '始まる前は押せない');
s = ref(TG, s, 'go');
const normal = s.targets.find((x) => x.kind !== 'bomb');
const bomb = s.targets.find((x) => x.kind === 'bomb');
s = TG.apply(s, { p: 0, t: 'hit', id: normal.id, ms: 600 });
assert.equal(TG.apply(s, { p: 0, t: 'hit', id: normal.id, ms: 500 }), null, '同じ的は1人1回');
s = TG.apply(s, { p: 1, t: 'hit', id: normal.id, ms: 450 });
assert.equal(s.best[normal.id].p, 1, 'あとから届いても速い人のもの');
s = TG.apply(s, { p: 2, t: 'hit', id: normal.id, ms: 700 });
assert.equal(s.best[normal.id].p, 1, '遅い人には取られない');
s = TG.apply(s, { p: 2, t: 'hit', id: bomb.id, ms: 500 });
s = TG.apply(s, { p: 0, t: 'miss', n: 1 });
assert.equal(TG.apply(s, { p: 0, t: 'miss', n: 1 }), null, '空振りも2回目を弾く');
assert.equal(TG.apply(s, { p: 1, t: 'hit', id: 1, ms: 99999 }), null, '消えたあとの時間では押せない');
assert.deepEqual(scoresOf(s), [-1, KINDS[normal.kind].pt, -2], '取った的の点・ドクロ −2・空振り −1');
s = ref(TG, s, 'end');
assert.deepEqual(TG.result(s).winners, [1]);
assert.equal(TG.apply(s, { p: 0, t: 'hit', id: 0, ms: 100 }), null, '終わったら押せない');

// ---------- ウミガメのスープ ----------
const UM = GAMES.umigame;
assert.ok(UM.noCpu, 'ウミガメは CPU なし');
s = UM.init(3, 1, {});
assert.equal(s.setter, 0);
assert.equal(UM.turn(s), 0, '最初は出題者が問題を選ぶ');
assert.equal(UM.apply(s, { p: 1, t: 'pick', idx: 0 }), null, '出題者でない人は選べない');
assert.equal(UM.apply(s, { p: 0, t: 'custom', q: 'もんだい', a: ' ' }), null, '答えが空の問題は出せない');
s = UM.apply(s, { p: 0, t: 'pick', idx: 3 });
assert.equal(s.phase, 'ask');
assert.equal(UM.turn(s), 1, '出題者の次の人から質問');
assert.equal(UM.apply(s, { p: 2, t: 'ask', text: 'しつもん' }), null, '番でない人は質問できない');
assert.equal(UM.apply(s, { p: 0, t: 'ask', text: 'しつもん' }), null, '出題者は質問できない');
s = UM.apply(s, { p: 1, t: 'ask', text: '男は泣いていましたか？' });
assert.equal(UM.turn(s), 0, '質問したら出題者の番');
assert.equal(UM.apply(s, { p: 0, t: 'judge', ok: true }), null, '質問には正誤ではなく、はい・いいえで答える');
s = UM.apply(s, { p: 0, t: 'reply', r: 'no' });
assert.equal(UM.turn(s), 2);
s = UM.apply(s, { p: 2, t: 'pass' });
assert.equal(UM.turn(s), 1, '出題者を飛ばして次の人へ');
s = UM.apply(s, { p: 1, t: 'guess', text: 'こたえ' });
s = UM.apply(s, { p: 0, t: 'judge', ok: false });
assert.equal(UM.result(s), null, '外しても続く');
s = UM.apply(s, { p: 2, t: 'guess', text: 'こたえ2' });
s = UM.apply(s, { p: 0, t: 'judge', ok: true });
assert.equal(UM.result(s).winner, 2, '先に当てた人の勝ち');
assert.deepEqual([0, 1, 2].map((p) => UM.carry(s, p)), [1, 0, 0], '出題者をした回数を引き継ぐ');
assert.equal(UM.init(3, 2, { prev: [1, 0, 0] }).setter, 1, '次は出題者をしていない人');
assert.equal(UM.result(UM.apply(UM.apply(UM.init(2, 3, {}), { p: 0, t: 'pick', idx: 0 }), { p: 0, t: 'reveal' })).winner, null, '答えを明かして終わる');
assert.equal(UM.apply(UM.init(2, 3, {}), { p: 1, t: 'reveal' }), null, '出題者でない人は明かせない');
console.log('party games OK');

// 遊び方: どのゲームにもあり、長くしない（1つ4行まで）
const { GAME_ORDER } = await import('../app/js/games/index.js');
for (const id of GAME_ORDER) {
  const h = GAMES[id].howto;
  assert.ok(Array.isArray(h) && h.length >= 1 && h.length <= 4 && h.every((x) => typeof x === 'string' && x), `${id} の遊び方（1〜4行）`);
}

console.log('ALL OK');
