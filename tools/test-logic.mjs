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

// 3〜4人のマルバツ（詳細設定「人数」）
const wide = (rules, moves) => { let x = T.init({ rules }); for (const m of moves) { x = T.apply(x, m); assert.ok(x, 'illegal ' + m); } return x; };
s = T.init({ rules: { players: 3 } });
assert.equal(s.w * 100 + s.k, 503, '3人のおまかせは 5×5 で3つ');
assert.equal(T.init({ rules: { players: 4 } }).w, 8, '4人のおまかせは 8×8');
assert.equal(T.init({ rules: { players: 3, wide: '7-3' } }).w, 7, '盤の大きさを選べる');
assert.equal(T.init({ rules: { players: 2, wide: '7-3' } }).board.length, 9, '2人なら3人以上の盤の設定は見ない');
assert.equal(T.init({ rules: { players: 3, size: 'super' } }).big, undefined, '3人ではスーパーにならない');
assert.equal(T.seatCount({ players: 4 }), 4);
s = wide({ players: 3 }, [0, 1, 2]);
assert.equal(T.turn(s), 0, '3人目の次は1人目');
assert.equal(s.board[2], 2, '3人目の印');
// ○ が右上から左下へ ななめ（4・8・12）に並べる。× と △ はほかへ
s = wide({ players: 3 }, [4, 0, 1, 8, 5, 6]);
assert.equal(T.result(s), null);
s = T.apply(s, 12);
assert.deepEqual([T.result(s).winner, T.result(s).cells.slice().sort((a, b) => a - b)], [0, [4, 8, 12]], '右上から左下へのななめ');
assert.equal(T.apply(s, 20), null, '決着後は打てない');
s = wide({ players: 4 }, [0, 10, 20, 30, 1, 11, 21, 31, 40, 12]);
assert.deepEqual(T.result(s), { winner: 1, cells: [10, 11, 12] }, '4人で2人目が横に3つ');
assert.equal(T.apply(wide({ players: 3 }, [7]), 7), null, '埋まったマス');
assert.equal(T.apply(T.init({ rules: { players: 3 } }), 25), null, '盤の外');
// 5×5 を誰も3つ並べずに埋める（○9・×8・△8 個。並ばない埋め方を機械で探したもの）
const fill = [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 2, 1, 1, 2, 1, 2, 1, 2, 2, 2, 0, 2, 2];
const order = [[], [], []];
fill.forEach((p, i) => order[p].push(i));
const seq = [];
for (let k = 0; seq.length < 25; k++) for (const p of [0, 1, 2]) if (order[p][k] !== undefined) seq.push(order[p][k]);
s = wide({ players: 3 }, seq);
assert.deepEqual(T.result(s), { winner: null, cells: [] }, '3人で埋まったら引き分け');
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
// 3〜4人のコネクトフォー
const c4 = (rules, moves) => { let x = C.init({ rules }); for (const m of moves) { x = C.apply(x, m); assert.ok(x, 'illegal ' + m); } return x; };
assert.deepEqual([C.init({ rules: { players: 3 } }).w, C.init({ rules: { players: 3 } }).h], [9, 7], '3人のおまかせは 9×7');
assert.equal(C.init({ rules: { players: 4 } }).w, 11, '4人のおまかせは 11×9');
assert.equal(C.init({ rules: { players: 3, wide: '8-7' } }).w, 8, '盤の大きさを選べる');
assert.equal(C.init({ rules: { players: 2, wide: '11-9' } }).grid.length, 42, '2人なら3人以上の盤の設定は見ない');
assert.equal(C.seatCount({ players: 3 }), 3);
s = c4({ players: 3 }, [0, 1, 2]);
assert.deepEqual([s.grid[54], s.grid[55], s.grid[56], s.turn], [0, 1, 2, 0], '3人で順番に回る');
s = c4({ players: 3 }, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
assert.equal(C.result(s)?.winner, 0, '3人で たて4');
assert.equal(C.apply(s, 3), null, '決着後は打てない');
// 4人目（紫）が下の段に よこ4。ほかの3人は並ばない所に置く
s = c4({ players: 4 }, [6, 8, 10, 1, 7, 9, 10, 2, 6, 8, 10, 3, 7, 9, 0, 4]);
assert.deepEqual(C.result(s), { winner: 3, cells: [89, 90, 91, 92] }, '4人目の よこ4');
assert.equal(C.apply(c4({ players: 3 }, [8, 8, 8, 8, 8, 8, 8]), 8), null, '満杯の列（7段）');
assert.equal(C.apply(C.init({ rules: { players: 3 } }), 9), null, '盤の外');

// 消えるマルバツ: 4つ目で一番古い印が消える・消えたマスにまた置ける・60手で引き分け・2人のときだけ
{
  const V = (moves) => { let x = T.init({ rules: { size: 'vanish' } }); for (const m of moves) { x = T.apply(x, m); assert.ok(x, 'illegal ' + m); } return x; };
  assert.equal(T.init({ rules: { size: 'vanish', players: 3 } }).vanish, undefined, '3人では消えるにならない');
  s = V([0, 3, 1, 4, 8, 6]); // ○ 0・1・8、× 3・4・6
  assert.equal(T.result(s), null);
  assert.equal(T.apply(s, 0), null, 'まだ消えていない印のマスには置けない');
  s = T.apply(s, 2); // ○ の4つ目: 一番古い 0 が消える。○ は 1・8・2 で並ばない
  assert.deepEqual([s.board[0], s.board[2], T.result(s)], [null, 0, null], '4つ目で一番古い印が消え、消えた印では並ばない');
  assert.deepEqual(s.hist, [[1, 8, 2], [3, 4, 6]]);
  s = T.apply(s, 5); // × の4つ目: 3 が消え、× は 4・6・5
  assert.equal(s.board[3], null);
  assert.equal(T.result(s), null, '× の 4・5 と消えた 3 では並ばない');
  s = T.apply(s, 0); // ○ 8・2・0 → 1 が消える
  assert.deepEqual([s.board[1], s.board[0]], [null, 0], '消えたマスにまた置ける');
  s = V([0, 3, 1, 4, 2]);
  assert.deepEqual(T.result(s), { winner: 0, cells: [0, 1, 2] }, '3つ並べたら勝ち');
  assert.equal(T.apply(s, 5), null, '決着後は打てない');
  // 並ばないように60手打つと引き分け（○ と × が 0〜8 を順に回るだけの手順は並んでしまうので、局面ごとに並ばない手を選ぶ）
  let x = T.init({ rules: { size: 'vanish' } });
  let n = 0;
  while (!T.result(x)) {
    const ok = x.board.map((v, i) => i).filter((i) => x.board[i] === null).find((i) => { const y = T.apply(x, i); return !T.result(y) || T.result(y).winner === null; });
    assert.ok(ok !== undefined, '並ばない手が見つかる');
    x = T.apply(x, ok);
    n++;
  }
  assert.deepEqual([n, T.result(x)], [60, { winner: null, cells: [] }], '60手で引き分け');
}

// かぶせマルバツ: 小さい駒にかぶせる・同じ大きさにはかぶせられない・盤の駒を動かせる・動かして相手の並びが見えたら相手の勝ち（自分も並んでいても）
{
  const G = (moves) => { let x = T.init({ rules: { size: 'gobble' } }); for (const m of moves) { x = T.apply(x, m); assert.ok(x, 'illegal ' + m); } return x; };
  const at = (to, src) => to + 9 * src; // src: 0〜2 手元の小・中・大、3〜11 盤のマス+3
  assert.equal(T.init({ rules: { size: 'gobble', players: 3 } }).gob, undefined, '3人ではかぶせるにならない');
  s = G([at(0, 0), at(0, 1)]); // ○ 小を 0、× 中を 0 にかぶせる
  assert.deepEqual([s.stacks[0].length, s.stacks[0][1], s.hand], [2, { p: 1, z: 1 }, [[1, 2, 2], [2, 1, 2]]], '小さい駒にかぶせる');
  assert.equal(T.apply(s, at(0, 0)), null, '小は中にかぶせられない');
  assert.equal(T.apply(s, at(0, 1)), null, '同じ大きさにはかぶせられない');
  assert.equal(T.apply(s, at(1, 3)), null, '一番上が相手の駒のマスからは動かせない');
  s = T.apply(s, at(0, 2)); // ○ 大を 0 へ
  s = T.apply(s, at(4, 0)); // × 小
  assert.equal(T.apply(s, at(0, 3)), null, '同じマスへは動かせない');
  s = T.apply(s, at(2, 3)); // ○ 大を 0 から 2 へ。0 には × 中が見える
  assert.deepEqual([s.stacks[0].at(-1), s.stacks[2].at(-1), s.from], [{ p: 1, z: 1 }, { p: 0, z: 2 }, 0], '盤の駒を動かすと下の駒が見える');
  // × 0・1・2 の上に ○ 大がかぶさっている形から、○ が大を動かして 6・7・8 を並べる → × の並びも見えるので × の勝ち
  s = G([at(8, 0), at(2, 0), at(2, 2), at(0, 0), at(7, 0), at(1, 1)]);
  assert.equal(T.result(s), null);
  s = T.apply(s, at(6, 2 + 3));
  assert.deepEqual(T.result(s), { winner: 1, cells: [0, 1, 2] }, '動かして相手の並びが見えたら、自分も並んでいても相手の勝ち');
  s = G([at(0, 0), at(3, 0), at(1, 0), at(4, 0)]);
  assert.deepEqual(T.result(T.apply(s, at(2, 1))), { winner: 0, cells: [0, 1, 2] }, '一番上の駒で3つ並べたら勝ち');
  assert.equal(T.cpu(s, 0, { cpu: 'strong' }) % 9, 2, 'CPU は並べられる所に置く');
}

// ポップアウト: 自分のコマだけ抜ける・抜くと上が下がる・相手の並びができたら相手の勝ち・同じ盤面3回で引き分け
{
  const P = () => C.init({ rules: { pop: 'on' } });
  assert.equal(C.init({ rules: { pop: 'on', players: 3 } }).pop, undefined, '3人ではポップアウトにならない');
  s = play(C, [0, 1]);
  assert.equal(s.pop, undefined, '最初はポップアウトなし');
  let x = P();
  for (const m of [0, 0]) x = C.apply(x, m); // 赤が 0列の一番下、黄がその上。赤の番
  assert.ok(C.apply(x, { pop: 0 }), '一番下が自分のコマなら抜ける');
  const y = C.apply(x, { pop: 0 });
  assert.deepEqual([y.grid[35], y.grid[28], y.turn], [1, null, 1], '抜くと上のコマが1段下がり、番が替わる');
  assert.equal(C.apply(C.apply(y, 3), { pop: 0 }), null, '一番下が相手のコマなら抜けない');
  assert.equal(C.apply(y, { pop: 1 }), null, '空の列は抜けない');
  assert.equal(C.apply(y, { pop: 9 }), null, '盤の外');
  // 抜いて相手（黄）の よこ4 ができる。自分（赤）の並びは無い → 黄の勝ち
  const g = Array(42).fill(null);
  Object.assign(g, { 35: 0, 28: 1, 36: 1, 37: 1, 38: 1, 39: 0, 40: 0, 29: 0, 30: 0 });
  x = { ...P(), grid: g, turn: 0 };
  assert.deepEqual(C.result(C.apply(x, { pop: 0 })), { winner: 1, cells: [35, 36, 37, 38] }, '抜いて相手の4つ並びができたら相手の勝ち');
  // 抜いて自分と相手の両方が並ぶ → 相手の勝ち
  const g2 = Array(42).fill(null);
  // 0列: 下から 赤・黄・赤。1〜3列の下の段に黄、2段目に赤。抜くと 0列の黄が下の段へ（黄の よこ4）、赤が2段目へ（赤の よこ4）
  Object.assign(g2, { 35: 0, 28: 1, 21: 0, 36: 1, 37: 1, 38: 1, 29: 0, 30: 0, 31: 0 });
  x = { ...P(), grid: g2, turn: 0 };
  assert.equal(C.result(C.apply(x, { pop: 0 })).winner, 1, '両方並んでも、抜いた側の相手の勝ち');
  // 抜いて自分だけ並ぶ → 自分の勝ち
  const g3 = Array(42).fill(null);
  Object.assign(g3, { 35: 0, 28: 0, 36: 0, 37: 0, 38: 0, 29: 1, 39: 1 });
  x = { ...P(), grid: g3, turn: 0 };
  assert.equal(C.result(C.apply(x, { pop: 0 }))?.winner, 0, '抜いて自分だけ並べば自分の勝ち');
  // 同じ盤面が3回: 赤が落とす→黄が落とす→赤が抜く→黄が抜く で、赤 0列・黄 6列の1枚ずつの盤面（赤の番）に4手ごとに戻る
  x = P();
  for (const m of [0, 6]) x = C.apply(x, m);
  const loop = [0, 6, { pop: 0 }, { pop: 6 }];
  let steps = 0;
  while (!C.result(x) && steps < 20) { x = C.apply(x, loop[steps % 4]); assert.ok(x, 'くり返しの手順が打てる'); steps++; }
  assert.deepEqual([C.result(x), steps], [{ winner: null, cells: [] }, 8], '同じ盤面（次の番も同じ）が3回出たら引き分け');
}

// じゃま石: 種で置き場所が決まる・誰のものでもない・じゃま石をはさんだ並びでは勝てない・CPU が反則を出さない
{
  const { NEUTRAL } = await import('../app/js/games/connect4.js');
  assert.equal(C.init().grid.some((v) => v === NEUTRAL), false, '最初はじゃま石なし');
  const B = (seed, rules = {}) => C.init({ rules: { block: 'on', ...rules }, seed });
  assert.deepEqual(B(7).grid, B(7).grid, '同じ種なら同じ置き場所');
  let differ = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const x = B(seed);
    if (JSON.stringify(x.grid) !== JSON.stringify(B(1).grid)) differ++;
    assert.equal(x.grid.filter((v) => v === NEUTRAL).length, 3, '2人は3個');
    for (let c = 0; c < 7; c++) {
      const col = [0, 1, 2, 3, 4, 5].map((r) => x.grid[r * 7 + c]);
      assert.ok(col.filter((v) => v === NEUTRAL).length <= 2, '1列に2個まで');
      const top = col.findIndex((v) => v !== null);
      if (top >= 0) assert.ok(col.slice(top).every((v) => v === NEUTRAL), '下から積む');
    }
  }
  assert.ok(differ > 30, '種で置き場所が変わる');
  assert.equal(B(3, { players: 4 }).grid.filter((v) => v === NEUTRAL).length, 5, '3人以上は列の数の半分（11列なら5個）');
  // 一番下の段: 0〜2列に赤、3列にじゃま石 → 赤は 0〜3 で並ばない
  const g = Array(42).fill(null);
  g[38] = NEUTRAL;
  let x = { ...C.init({ rules: { block: 'on' } }), grid: g };
  for (const m of [0, 0, 1, 1, 2, 2]) x = C.apply(x, m);
  assert.equal(C.result(x), null, 'じゃま石の手前で3つ');
  x = C.apply(x, 3); // 赤は 3列（じゃま石の上）へ
  assert.equal(C.result(x), null, 'じゃま石をはさんだ並びでは勝てない');
  // ポップアウトでじゃま石は抜けない
  x = { ...C.init({ rules: { block: 'on', pop: 'on' } }), grid: g.slice() };
  assert.equal(C.apply(x, { pop: 3 }), null, 'じゃま石は抜けない');
  for (const rules of [{}, { players: 3 }, { players: 4 }, { pop: 'on' }]) {
    for (let k = 0; k < 6; k++) {
      let st = C.init({ rules: { block: 'on', ...rules }, seed: 100 + k });
      let guard = 0;
      while (!C.result(st)) {
        const m = C.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][k % 3] });
        st = C.apply(st, m);
        assert.ok(st, 'じゃま石ありで CPU が反則を出した');
        assert.ok(++guard < 250);
      }
    }
  }
}

// リバーシ
s = R.init();
assert.equal(R.apply(s, 0), null);
s = R.apply(s, 19); // d3（黒）: d4 を返す
assert.ok(s);
assert.equal(s.board[27], 0);
assert.equal(s.turn, 1);
assert.deepEqual(s.flipped, [27]);
// 盤の大きさ（2人だけ。3〜4人はいつも 8×8）
for (const [size, cells] of [[6, [14, 15, 20, 21]], [10, [44, 45, 54, 55]]]) {
  const r6 = R.init({ rules: { size } });
  assert.equal(r6.board.length, size * size, size + '×' + size + ' の盤');
  assert.deepEqual(cells.map((i) => r6.board[i]), [1, 0, 0, 1], size + '×' + size + ' の最初の石は真ん中');
  let g = r6; let k = 0;
  while (!R.result(g) && k++ < 200) {
    const c = Array.from({ length: size * size }, (_, i) => i).filter((i) => R.apply(g, i));
    g = R.apply(g, c[Math.floor(Math.random() * c.length)]);
    assert.ok(g, size + '×' + size + ' を最後まで打てる');
  }
  assert.ok(R.result(g), size + '×' + size + ' が終わる');
}
assert.equal(R.init({ rules: { players: 3, size: 6 } }).board.length, 64, '3人は盤の大きさを選んでも 8×8');
assert.equal(R.apply(R.init({ rules: { size: 6 } }), 36), null, '盤の外の番号は打てない');
// 3〜4人のリバーシ
assert.equal(R.seatCount({ players: 3 }), 3);
let rv;
s = R.init({ rules: { players: 3 } });
assert.deepEqual([s.board[27], s.board[28], s.board[35], s.board[36]], [0, 1, 2, 2], '3人の最初の石');
assert.equal(R.init({ rules: { players: 4 } }).board.filter((v) => v !== null).length, 4, '4人の最初の石');
// 黒が 0 に置くと、白(1)と赤(2)をまとめて挟む
s = { ...R.init({ rules: { players: 3 } }), board: Object.assign(Array(64).fill(null), { 1: 1, 2: 2, 3: 0, 20: 1 }), turn: 0 };
rv = R.apply(s, 0);
assert.ok(rv, '白と赤が混ざっていても挟める');
assert.deepEqual([rv.board[1], rv.board[2], rv.turn], [0, 0, 1], '挟んだ石は全部自分の色・次は白');
assert.equal(R.apply(s, 21), null, '挟める所があるときは、となりでも挟めない所には置けない');
// 黒が挟める所が無い: 石のとなりならどこでも置ける（パスにしない）
s = { ...s, board: Object.assign(Array(64).fill(null), { 27: 1, 28: 2 }), turn: 0 };
assert.ok(R.apply(s, 19), '挟めないときは石のとなりに置ける');
assert.equal(R.apply(s, 0), null, '石から離れた所には置けない');
assert.equal(R.apply(s, 19).turn, 1, 'パスにならず次の人へ');
assert.equal(R.apply({ ...s, turn: 1 }, 29).turn, 2, '白の次は赤（3人で回る）');
// 赤が最後の1マスを埋めて終局。いちばん多い人の勝ち・同点は引き分け
s = { ...R.init({ rules: { players: 3 } }), board: Array.from({ length: 64 }, (_, i) => (i === 63 ? null : i < 30 ? 0 : i < 45 ? 1 : 2)), turn: 2 };
rv = R.apply(s, 63);
assert.ok(rv.over, '盤が埋まったら終わり');
assert.equal(R.result(rv).winner, 0, 'いちばん多い人の勝ち');
s = { ...s, board: Array.from({ length: 64 }, (_, i) => (i === 63 ? null : i < 24 ? 0 : i < 48 ? 1 : 2)), turn: 2 };
assert.equal(R.result(R.apply(s, 63)).winner, null, 'いちばん多い人が2人なら引き分け');
// 四隅封印: 隅には置けない（はさめても）。2人でも3人でも最後まで打てて終わる（3人は隅を残して埋まったら終わり）
s = { ...R.init({ rules: { corners: true } }), board: Object.assign(Array(64).fill(null), { 1: 1, 2: 0 }), turn: 0 };
assert.equal(R.apply(s, 0), null, '四隅封印では隅に置けない');
assert.ok(R.apply({ ...s, shut: false }, 0), '封印なしなら隅に置ける');
for (const players of [2, 3]) {
  let g = R.init({ rules: { corners: true, players } }); let k = 0;
  while (!R.result(g) && k++ < 100) {
    const c = Array.from({ length: 64 }, (_, i) => i).filter((i) => R.apply(g, i));
    assert.ok(c.length && !c.some((i) => [0, 7, 56, 63].includes(i)), `四隅封印の${players}人で隅以外に打てる`);
    g = R.apply(g, c[Math.floor(Math.random() * c.length)]);
  }
  assert.ok(R.result(g) && [0, 7, 56, 63].every((i) => g.board[i] === null), `四隅封印の${players}人が隅を空けたまま終わる`);
}

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
// 同じ数字まとめ出し: 同じ数字を何枚でも。最後に置いた札の色が場の色。記号の札・違う数字・引いた札は不可
s = base({ rules: { multi: true }, hands: [['b5', 'g5', 'y5', 'r7', 'rS', 'gS'], ['b1', 'b2'], ['y1', 'y2']] });
t = U.apply(s, { p: 0, t: 'play', i: 0, more: [2, 1] });
assert.deepEqual([t.hands[0], t.discard.slice(-3), t.color, t.turn, t.last.n], [['r7', 'rS', 'gS'], ['b5', 'y5', 'g5'], 'g', 1, 3], '同じ数字を3枚まとめて出し、最後の札の色が場の色');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 0, more: [3] }), null, '違う数字はまとめられない');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 0, more: [1, 1] }), null, '同じ札を2回は入れられない');
assert.equal(U.apply(s, { p: 0, t: 'play', i: 0, more: [0] }), null, '出す札そのものは入れられない');
assert.equal(U.apply({ ...s, discard: ['r3'] }, { p: 0, t: 'play', i: 4, more: [5] }), null, '記号の札はまとめられない');
assert.equal(U.apply({ ...s, rules: {} }, { p: 0, t: 'play', i: 0, more: [1] }), null, '詳細設定がなければまとめられない');
assert.equal(U.apply({ ...s, discard: ['r3'] }, { p: 0, t: 'play', i: 1, more: [0] }), null, '最初の札は出せる札でないとだめ');
assert.equal(U.result(U.apply(base({ rules: { multi: true }, hands: [['b5', 'g5'], ['b1'], ['y1']] }), { p: 0, t: 'play', i: 0, more: [1] })).winner, 0, 'まとめて出し切ったら勝ち');
t = U.apply({ ...s, drawn: 'b5' }, { p: 0, t: 'play', i: 0, more: [1] });
assert.equal(t, null, '引いた札はまとめて出せない');
assert.deepEqual(U.cpu({ ...s, discard: ['b3'], color: 'b' }, 0).more?.length, 2, 'CPU は同じ数字を全部出す');
s = base({ n: 3, rules: { multi: true, sevenZero: true }, hands: [['r7', 'g7', 'b1'], ['b1', 'b2', 'b3'], ['y1']] });
t = U.apply(s, { p: 0, t: 'play', i: 0, more: [1], to: 2 });
assert.deepEqual([t.hands[0], t.hands[2], t.color], [['y1'], ['b1'], 'g'], '7をまとめて出しても交換は1回');
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

// 重ねて返す（詳細設定）
const stk = (o) => base({ rules: { stack: true }, pend: null, ...o });
s = stk({ hands: [['rD', 'g1'], ['bD', 'yD', 'r9', 'W4'], ['gD', 'y2']] });
t = U.apply(s, { p: 0, t: 'play', i: 0 });
assert.deepEqual([t.pend, t.turn, t.hands[1].length], [{ k: 'D', n: 2 }, 1, 4], 'ドロー2はすぐ引かせず、次の人へ');
assert.equal(U.apply(t, { p: 1, t: 'play', i: t.hands[1].indexOf('r9') }), null, '重ね返しの途中は色が同じでも数字の札は出せない');
assert.equal(U.apply(t, { p: 1, t: 'play', i: t.hands[1].indexOf('W4'), c: 'r' }), null, 'ドロー2にドロー4は重ねられない');
let cs2 = U.apply(t, { p: 1, t: 'play', i: t.hands[1].indexOf('yD') });
assert.deepEqual([cs2.pend.n, cs2.turn, cs2.color], [4, 2, 'y'], '色が違ってもドロー2なら重ねられる');
const cs3 = U.apply(cs2, { p: 2, t: 'play', i: cs2.hands[2].indexOf('gD') });
assert.deepEqual([cs3.pend.n, cs3.turn], [6, 0]);
const cs4 = U.apply(cs3, { p: 0, t: 'draw' });
assert.deepEqual([cs4.hands[0].length, cs4.turn, cs4.pend, cs4.drawn], [7, 1, null, null], '重ねなければ、たまった枚数を全部引いて1回休み');
assert.equal(total(cs4), total(s));
s = stk({ hands: [['W4', 'g1'], ['W4', 'r9'], ['y1', 'y2']] });
t = U.apply(s, { p: 0, t: 'play', i: 0, c: 'g' });
assert.equal(t.pend.n, 4);
cs2 = U.apply(t, { p: 1, t: 'play', i: 0, c: 'r' });
assert.ok(cs2, '返すときのドロー4は、場の色の札を持っていても出せる');
assert.deepEqual([cs2.pend.n, cs2.turn], [8, 2]);
s = base({ hands: [['rD', 'g1'], ['bD', 'b2'], ['y1', 'y2']] });
assert.equal(U.apply(s, { p: 0, t: 'play', i: 0 }).hands[1].length, 4, '設定なし（rules が無い局面）は今までどおりすぐ引かせる');
assert.equal(U.init(3, 1).rules.stack, false, '最初は重ねて返せない');
// 重ねて返すありで、CPU どうしで最後まで
for (let k = 0; k < 200; k++) {
  const n = 2 + (k % 9);
  let st = U.init(n, k * 104729 + 3, { rules: { stack: true } });
  let steps = 0;
  while (!U.result(st)) {
    const p = U.turn(st);
    const next = U.apply(st, { ...U.cpu(st, p), p });
    assert.ok(next, '重ね返しで CPU が反則の手を出した');
    assert.equal(total(next), 108, '重ね返しで札の枚数が変わった');
    st = next;
    if (++steps > 5000) throw new Error('重ね返しのいろあわせが終わらない');
  }
}
console.log('colors stack OK');
// 7で交換・0で回す（詳細設定）
{
  const sz = (o) => base({ rules: { sevenZero: true }, ...o });
  s = sz({ hands: [['r7', 'g1', 'g2'], ['b1'], ['y1', 'y2', 'y3', 'y4']] });
  assert.equal(U.apply(s, { p: 0, t: 'play', i: 0 }), null, '3人以上は交換の相手を選ぶ');
  assert.equal(U.apply(s, { p: 0, t: 'play', i: 0, to: 0 }), null, '自分とは交換できない');
  t = U.apply(s, { p: 0, t: 'play', i: 0, to: 1 });
  assert.deepEqual([t.hands[0], t.hands[1], t.turn], [['b1'], ['g1', 'g2'], 1], '7で選んだ人と手札を交換');
  assert.equal(total(t), total(s));
  assert.equal(U.apply(base({ hands: s.hands }), { p: 0, t: 'play', i: 0, to: 1 }), null, '設定なしでは相手を付けられない');
  assert.deepEqual(U.apply(base({ hands: s.hands }), { p: 0, t: 'play', i: 0 }).hands[1], ['b1'], '設定なしでは7は交換しない');
  const two = sz({ n: 2, hands: [['r7', 'g1'], ['b1', 'b2', 'b3']] });
  assert.deepEqual(U.apply(two, { p: 0, t: 'play', i: 0 }).hands[0], ['b1', 'b2', 'b3'], '2人は相手を選ばずに交換');
  s = sz({ hands: [['r0', 'g1'], ['b1'], ['y1', 'y2']] });
  t = U.apply(s, { p: 0, t: 'play', i: 0 });
  assert.deepEqual(t.hands, [['y1', 'y2'], ['g1'], ['b1']], '0で全員が次の人へ渡す');
  t = U.apply({ ...s, dir: -1 }, { p: 0, t: 'play', i: 0 });
  assert.deepEqual(t.hands, [['b1'], ['y1', 'y2'], ['g1']], '左回りなら逆へ渡す');
  s = sz({ hands: [['r7'], ['b1'], ['y1']] });
  t = U.apply(s, { p: 0, t: 'play', i: 0, to: 1 });
  assert.deepEqual([t.winner, t.hands[0], t.hands[1]], [0, [], ['b1']], '最後の1枚の7は交換せず上がり');
  s = sz({ hands: [['r7', 'g1', 'g2', 'g3'], ['b1', 'b2', 'b3'], ['y1']] });
  for (let k = 0; k < 20; k++) {
    const m = U.cpu(s, 0);
    if (m.i === 0) assert.equal(m.to, 2, 'CPU は手札がいちばん少ない人と交換');
  }
  for (let k = 0; k < 200; k++) {
    const n = 2 + (k % 9);
    let st = U.init(n, k * 7907 + 5, { rules: { sevenZero: true, stack: k % 2 === 1, multi: k % 3 > 0 } });
    let steps = 0;
    while (!U.result(st)) {
      const p = U.turn(st);
      const next = U.apply(st, { ...U.cpu(st, p), p });
      assert.ok(next, '7・0で CPU が反則の手を出した');
      assert.equal(total(next), 108, '7・0で札の枚数が変わった');
      st = next;
      if (++steps > 5000) throw new Error('7・0のいろあわせが終わらない');
    }
  }
  console.log('colors seven-zero OK');
}

// いろあわせの出せるまで引く: 出せる札が来るまでまとめて引く・来た札は出すか次へ・設定なしなら1枚だけ
{
  const U = GAMES.colors;
  const base = (deck, rules) => ({ ...U.init(2, 1, { rules }), deck, discard: ['r5'], hands: [['b1'], ['g2', 'g3']], color: 'r', turn: 0, drawn: null });
  // 山は後ろから引く: y7 → b9 → r2 の順に出る
  let c = U.apply(base(['g8', 'r2', 'b9', 'y7'], { untilPlay: true }), { p: 0, t: 'draw' });
  assert.deepEqual([c.last.got, c.drawn, c.turn, c.hands[0].length], [3, 'r2', 0, 4], '出せる札（r2）が来るまで3枚引き、番はそのまま');
  assert.ok(U.apply(c, { p: 0, t: 'pass' }), '来た札を出さずに次へも選べる');
  assert.equal(U.apply(c, { p: 0, t: 'play', i: c.hands[0].indexOf('r2') }).color, 'r', '来た札を出せる');
  c = U.apply(base(['g8', 'r2', 'b9', 'y7'], {}), { p: 0, t: 'draw' });
  assert.deepEqual([c.last.got, c.drawn, c.turn], [1, null, 1], '設定なしなら1枚だけ引いて次へ');
  c = U.apply({ ...base(['b9', 'y7'], { untilPlay: true }), discard: ['r5'] }, { p: 0, t: 'draw' });
  assert.deepEqual([c.last.got, c.drawn, c.turn], [2, null, 1], '山と捨て札が尽きたらやめて次へ');
}

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
  n: hands.length, rules: { ...ALL, five: false, seven: false, ten: false }, hands, field: null, by: null, passed: hands.map(() => false), out: [], fouls: [],
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
// 5飛び: 5の枚数だけ飛ばす（飛ばされた人はパス扱い）。階段は1人。全員飛ばしたら場が流れて出した人から
s = dbase([['s5', 'h5', 'c9'], ['s6', 'c6', 'd13'], ['h7', 'd7', 'c13'], ['s8', 'c3', 'd3']], { rules: { ...ALL } });
t = dplay(s, 0, ['s5', 'h5']);
assert.deepEqual([t.turn, t.passed, t.last.effects], [3, [false, true, true, false], ['5飛び（2人）']], '5を2枚で2人飛ばす');
assert.equal(dplay(t, 1, ['s6', 'c6']), null, '飛ばされた人は場が流れるまで出せない');
t = dpass(t, 3);
assert.deepEqual([t.field, t.turn], [null, 0], '飛ばされた人はパスと同じなので、残りがパスすれば場が流れる');
s = dbase([['s5', 'c9'], ['s6', 'c6'], ['h7', 'd7']], { rules: { ...ALL } });
t = dplay(s, 0, ['s5']);
assert.equal(t.turn, 2, '5を1枚で1人飛ばす');
s = dbase([['s5', 'h5', 'c9'], ['s6', 'c6'], ['h7', 'd7']], { rules: { ...ALL } });
t = dplay(s, 0, ['s5', 'h5']);
assert.deepEqual([t.field, t.turn], [null, 0], '全員飛ばしたら場が流れて出した人から');
s = dbase([['s3', 's4', 's5', 'c9'], ['s6', 'c6'], ['h7', 'd7'], ['c10', 'c11']], { rules: { ...ALL } });
assert.equal(dplay(s, 0, ['s3', 's4', 's5']).turn, 2, '階段に5が入っていれば1人飛ばす');
s = dbase([['s5', 'c9'], ['s6', 'c6'], ['h7', 'd7']], { rules: { ...ALL, five: false } });
assert.equal(dplay(s, 0, ['s5']).turn, 1, '5飛びなしなら飛ばさない');
// 7渡し・10捨て: 枚数ぶん必ず・次の人へ渡す・選ぶまで番が進まない・渡して手札がなくなれば上がり・8切りは渡してから流す
{
  const R7 = { ...ALL, five: false, seven: true, ten: true };
  s = dbase([['s7', 'h7', 'c3', 'd4', 'c9'], ['s6', 'c6', 'd13'], ['h8', 'd8', 'c13']], { rules: R7 });
  t = dplay(s, 0, ['s7', 'h7']);
  assert.deepEqual([t.turn, t.pend, t.last.effects], [0, [{ t: 'seven', k: 2 }], ['7渡し']], '7を2枚出したら2枚渡すまで番が進まない');
  assert.equal(dpass(t, 0), null, '渡す前にパスはできない');
  assert.equal(dplay(t, 1, ['s6', 'c6']), null, '渡す前にほかの人は出せない');
  assert.equal(D.apply(t, { p: 0, t: 'seven', cards: ['c3'] }), null, '枚数が足りない');
  assert.equal(D.apply(t, { p: 0, t: 'ten', cards: ['c3', 'd4'] }), null, '7では捨てられない');
  assert.deepEqual(D.cpu(t, 0), { t: 'seven', cards: ['c3', 'd4'] }, 'CPU は弱い札から渡す');
  const u = D.apply(t, { p: 0, t: 'seven', cards: ['c3', 'c9'] });
  assert.deepEqual([u.hands[0], u.hands[1].includes('c3') && u.hands[1].includes('c9'), u.turn, u.pend], [['d4'], true, 1, null], '次の人に渡して番が進む');
  s = dbase([['s10', 'c3', 'd4'], ['s6', 'c6'], ['h8', 'd8']], { rules: R7 });
  t = D.apply(dplay(s, 0, ['s10']), { p: 0, t: 'ten', cards: ['d4'] });
  assert.deepEqual([t.hands[0], dcount(t), t.last.t], [['c3'], 5, 'ten'], '10捨てで1枚捨てる');
  s = dbase([['s7', 'c3'], ['s6', 'c6'], ['h8', 'd8']], { rules: R7 });
  t = D.apply(dplay(s, 0, ['s7']), { p: 0, t: 'seven', cards: ['c3'] });
  assert.deepEqual([t.out, t.last.done, t.last.foul], [[0], true, undefined], '渡して手札がなくなったら上がり');
  s = dbase([['s7', 's8', 's9', 's10', 'c3', 'd4', 'c5'], ['s6', 'c6'], ['h8', 'd8']], { rules: R7 });
  t = dplay(s, 0, ['s7', 's8', 's9', 's10']);
  assert.deepEqual([t.pend.map((x) => x.t + x.k), t.field !== null], [['seven1', 'ten1'], true], '階段は7と10を1枚ずつ。8切りでもまだ流さない');
  t = D.apply(D.apply(t, { p: 0, t: 'seven', cards: ['c3'] }), { p: 0, t: 'ten', cards: ['d4'] });
  assert.deepEqual([t.field, t.turn, t.hands[0]], [null, 0, ['c5']], '渡して捨てたあとに8切りで流れて出した人から');
  s = dbase([['s7', 'h7'], ['s6', 'c6'], ['h8', 'd8']], { rules: R7 });
  assert.equal(dplay(s, 0, ['s7', 'h7']).pend, undefined, '出して上がったら渡さない');
  s = dbase([['s7', 'h7', 'c3'], ['s6', 'c6'], ['h8', 'd8']], { rules: R7 });
  t = dplay(s, 0, ['s7', 'h7']);
  assert.ok(D.apply(t, { p: 0, t: 'seven', cards: ['c3'] }), '手札が足りなければ全部渡す');
  s = dbase([['s7', 'c3'], ['s6', 'c6'], ['h8', 'd8']]);
  assert.equal(dplay(s, 0, ['s7']).turn, 1, '7渡しなしなら渡さない');
}
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
      if (move.t === 'play' || move.t === 'ten') played += move.cards.length; // 10捨てで捨てた札も場から消える
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
{
  const nine = (hands, o = {}) => dbase(hands, { rules: { ...NONE, nine: true }, ...o });
  let x = dplay(nine([['s9', 'h3'], ['s10', 'h4'], ['s11', 'h5'], ['s12', 'h6']]), 0, ['s9']);
  assert.deepEqual([x.dir, x.turn], [-1, 3], '9を出すと逆回りで、前の席の人の番');
  assert.ok(x.last.effects.includes('9リバース'));
  x = dpass(x, 3);
  assert.equal(x.turn, 2, '逆回りのまま次へ');
  x = dpass(dpass(x, 2), 1);
  assert.deepEqual([x.field, x.turn, x.dir], [null, 0, -1], '場が流れても逆回りのまま');
  x = dplay(x, 0, ['h3']);
  assert.equal(x.turn, 3, '流れたあとも逆回り');
  const two = dplay(nine([['s9', 'h9', 'd3'], ['s10', 'h4'], ['s11', 'h5']]), 0, ['s9', 'h9']);
  assert.deepEqual([two.dir, two.turn], [-1, 2], '9を2枚出しても向きが変わるのは1回');
  const back = dplay({ ...nine([['s9', 'h3'], ['s10', 'h4'], ['s11', 'h5']]), dir: -1 }, 0, ['s9']);
  assert.deepEqual([back.dir, back.turn], [1, 1], 'もう一度9を出すと元の向き');
  const off = dplay(dbase([['s9', 'h3'], ['s10', 'h4'], ['s11', 'h5']], { rules: { ...NONE } }), 0, ['s9']);
  assert.deepEqual([off.dir, off.turn], [undefined, 1], '9リバースがオフなら向きは変わらない');
  // 5飛びも逆回りの向きで飛ばす
  const fv = dplay(dbase([['s5', 'h3'], ['s10', 'h4'], ['s11', 'h6'], ['s12', 'h7']], { rules: { ...NONE, nine: true, five: true }, dir: -1 }), 0, ['s5']);
  assert.deepEqual([fv.passed, fv.turn], [[false, false, false, true], 2], '逆回りの5飛びは前の席の人を飛ばす');
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
const spCount = (st) => st.piles.map((_, i) => i).reduce((a, p) => a + st.decks[p].length + st.fields[p].filter(Boolean).length + st.piles[p].length, 0);
s = SP.init(2, 42, { rules: {} });
assert.deepEqual(s, SP.init(2, 42, { rules: {} }), '同じ種なら同じ配り方');
assert.equal(spCount(s), 52);
assert.ok([...s.decks[0], ...s.fields[0], ...s.piles[0]].every((c) => 'hd'.includes(c[0])), 'プレイヤー0は赤');
assert.ok([...s.decks[1], ...s.fields[1], ...s.piles[1]].every((c) => 'sc'.includes(c[0])), 'プレイヤー1は黒');
const spBase = (o) => ({ n: 2, rules: { cpu: 'slow' }, decks: [['h9'], ['s9']], fields: [['h5', 'h1', 'd12', null], ['s7', 's2', 'c3', 'c4']], piles: [['d6'], ['c13']], aside: null, place: [null, null], step: 0, last: null, flips: 0, ...o });
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
// 3人: 17枚ずつ・余り1枚・台札3つ
s = SP.init(3, 42, { rules: {} });
assert.equal(s.piles.length, 3);
assert.deepEqual(s.decks.map((d, p) => d.length + s.fields[p].length + s.piles[p].length), [17, 17, 17], '17枚ずつ');
assert.match(s.aside, /^[hdsc][0-9]+$/, '余りの1枚がある');
assert.equal(new Set([...s.decks.flat(), ...s.fields.flat(), ...s.piles.flat(), s.aside]).size, 52, '余りの1枚と合わせて52枚・重なりなし');
const sp3 = (o) => ({ n: 3, rules: { cpu: 'slow' }, decks: [[], [], []], aside: 'h1', place: [null, null, null], step: 0, last: null, flips: 0, ...o });
s = sp3({ fields: [['h5', null, null, null], ['s9', 's2', null, null], ['c11', null, null, null]], piles: [['d1'], ['c13'], ['d6']] });
assert.ok(SP.apply(s, { p: 1, t: 'play', card: 's2', pile: 0 }), '3つ目以外の台札にも出せる');
assert.ok(SP.apply(s, { p: 0, t: 'play', card: 'h5', pile: 2 }), 'ほかの人の台札にも出せる');
t = SP.apply(s, { p: 0, t: 'play', card: 'h5', pile: 2 });
assert.equal(SP.result(t), null, '3人では1人上がっても続く');
assert.deepEqual(t.place, [1, null, null], '出し切った人が1位');
assert.equal(SP.apply(t, { p: 0, t: 'flip' }), null, '上がった人は手を打てない');
assert.equal(SP.canAct(t, 0), false);
assert.equal(SP.cpu(t, 0), null, '上がった CPU は何もしない');
s = sp3({ decks: [[], ['h8'], ['c8']], fields: [[null, null, null, null], ['s9', null, null, null], ['c11', null, null, null]], piles: [['d1'], ['c13'], ['d6']], place: [1, null, null] });
t = SP.apply(s, { p: 2, t: 'flip' });
assert.ok(t, '残りの2人とも出せないとスピード！（上がった人の札は見ない）');
assert.deepEqual(t.piles.map((pl) => pl[pl.length - 1]), ['d1', 'h8', 'c8'], '上がった人の台札はそのまま');
t = SP.apply(t, { p: 1, t: 'play', card: 's9', pile: 1 });
assert.deepEqual(SP.result(t).ranking, [0, 1, 2], '2人上がったら終わり・残りが3位');
assert.equal(SP.result(t).winner, 0);
s = sp3({ fields: [['h5', null, null, null], ['s9', null, null, null], ['c11', null, null, null]], piles: [['d1'], ['c13'], ['d1']] });
t = SP.apply(s, { p: 0, t: 'flip' });
assert.deepEqual(t.place, [1, 1, 1], '全員同時に出し切ったら同じ順位');
assert.equal(SP.result(t).draw, true);
assert.deepEqual(SP.result(sp3({ fields: [[null], [null], ['h2']], piles: [['d1'], ['c13'], ['d6']], place: [1, 1, 3] })).winners, [0, 1], '1位が同着なら2人とも勝ちの音');
assert.equal(SP.result(sp3({ fields: [[null], ['h2'], [null]], piles: [['d1'], ['c13'], ['d6']], place: [1, 3, 2] })).winners, undefined, '同着が無ければ順位の音');
// CPU どうしで最後まで（だれが先に動くかは毎回ばらばら）
let spGames = 0;
for (let k = 0; k < 600; k++) {
  const np = k % 2 ? 3 : 2;
  let st = SP.init(np, k * 7 + 3, { rules: {} });
  let steps = 0;
  while (!SP.result(st)) {
    const p = Math.floor(Math.random() * np);
    const m = SP.cpu(st, p);
    if (!m) { assert.ok([...Array(np).keys()].some((q) => SP.cpu(st, q)), '全員何もしないと止まる'); continue; }
    const next = SP.apply(st, { ...m, p });
    assert.ok(next, 'スピードの CPU が反則の手を出した');
    assert.equal(spCount(next) + (np === 3 ? 1 : 0), 52, '札の枚数が変わった');
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
// 同じ数字を使ってよい遊び方
{
  const HBM = await import('../app/js/games/hitblow.js');
  assert.deepEqual(HBM.score('1111', '1123'), { hit: 2, blow: 0 }, '答えにある個数までしか数えない');
  assert.deepEqual(HBM.score('3211', '1123'), { hit: 0, blow: 4 });
  assert.deepEqual(HBM.score('1312', '1123'), { hit: 1, blow: 3 });
  assert.deepEqual(HBM.score('1325', '1234'), { hit: 1, blow: 2 }, '重ならない数でも前と同じ');
  assert.equal(HB.init(2, 99, { rules: { digits: 4 } }).answer, HB.init(2, 99, { rules: { digits: 4, dup: 'off' } }).answer, '使わないときの答えは前と同じ');
  const answers = Array.from({ length: 200 }, (_, k) => HB.init(2, k, { rules: { dup: 'on' } }).answer);
  assert.ok(answers.every((a) => /^\d{4}$/.test(a)), '4桁');
  assert.ok(answers.some((a) => new Set(a).size < 4), '同じ数字が出る答えもある');
  s = { ...HB.init(2, 1, { rules: { dup: 'on' } }), answer: '1123' };
  t = HB.apply(s, { p: 0, t: 'guess', g: '1111', r: 1 });
  assert.deepEqual(t.log[0], { p: 0, g: '1111', hit: 2, blow: 0 }, '同じ数字の予想を出せる');
  assert.equal(HB.apply(t, { p: 1, t: 'guess', g: '112', r: 2 }), null, '桁数は同じ');
  for (let k = 0; k < 20; k++) {
    let st = HB.init(3, k * 7 + 1, { rules: { dup: 'on', digits: k % 2 ? 3 : 4, mode: k % 4 < 2 ? 'race' : 'turn' } });
    while (!HB.result(st)) {
      const ps = [0, 1, 2].filter((p) => HB.canAct(st, p));
      st = HB.apply(st, { ...HB.cpu(st, ps[0]), p: ps[0] });
      assert.ok(st, '同じ数字ありで CPU が反則の手を出した');
      if (st.round > 80) throw new Error('同じ数字ありのヒット＆ブローが終わらない');
    }
  }
}

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
// 続けて取れる組: 2組まで。2組取ったら次の人へ（はずしたら数え直し）
s = { ...MM.init(2, 0, { rules: { size: 24, streak: 2 } }), cards: ['s1', 'h1', 's2', 'h2', 's3', 'h3', 's4', 'd5'], taken: Array(8).fill(null), seen: Array(8).fill(false) };
const mmFlip = (st, p, ...is) => is.reduce((x, i) => MM.apply(x, { p, t: 'flip', i }), st);
t = mmFlip(s, 0, 0, 1);
assert.equal(t.turn, 0, '1組目ではまだ続けられる');
t = mmFlip(t, 0, 2, 3);
assert.deepEqual([t.turn, t.scores[0], t.last.stop], [1, 2, true], '2組取ったら次の人へ');
t = mmFlip(t, 1, 6, 7);
t = mmFlip(t, 0, 4, 5);
assert.equal(t.turn, 0, '番が変わったら数え直す');
s = { ...MM.init(2, 0, { rules: { size: 24, streak: 2 } }), cards: ['s1', 'h1', 's2', 'h2', 's3', 'd4', 's6', 'h6'], taken: Array(8).fill(null), seen: Array(8).fill(false) };
t = mmFlip(mmFlip(s, 0, 0, 1), 0, 4, 5); // 1組取ってからはずす
t = mmFlip(t, 1, 2, 3);
assert.equal(t.turn, 1, 'はずして番が変わったら、次の人の数は0から');
assert.equal(MM.init(2, 0, { rules: { streak: 5 } }).limit, 0, '選べない数なら何組でも');
let mmGames = 0;
for (let k = 0; k < 200; k++) {
  const n = 2 + (k % 7);
  let st = MM.init(n, k * 31 + 1, { rules: { size: [48, 36, 24][k % 3], streak: [0, 2, 3, 0][k % 4] } });
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
for (const mx of [3, 4, 5]) {
  for (let k = 0; k < 20; k++) assert.equal(NIM.init(2, k, { rules: { max: mx } }).max, mx, `「1回に取れる数」${mx}個までならいつも${mx}`);
}
assert.equal(NIM.init(2, 7, { rules: { max: 0 } }).max, NIM.init(2, 7, { rules: {} }).max, 'おまかせは今までと同じ決め方');
assert.equal(NIM.init(2, 7, { rules: { max: 4 } }).piles[0], NIM.init(2, 7, { rules: {} }).piles[0], '最大数を決めても山の大きさは同じ');
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

// ---------- ぴったりストップ ----------
const PZ = GAMES.pittari;
const { pointsOf: pzPoints } = await import('../app/js/games/pittari.js');
assert.deepEqual(pzPoints([300, 100, Infinity, 100, 900]), [1, 3, 0, 3, 0], '近い順に 3・2・1点、同じずれは同じ点、押さないと0点');
for (let k = 0; k < 50; k++) {
  const st = PZ.init(2, k, { rules: {} });
  assert.ok(st.targets.length === 5 && st.targets.every((x) => Number.isInteger(x) && x >= 5 && x <= 15), '秒数は5〜15');
  assert.deepEqual(st.targets, PZ.init(2, k, { rules: {} }).targets, '秒数は seed から毎回同じ');
}
assert.ok(PZ.init(2, 1, { rules: { fixed: true } }).targets.every((x) => x === 10), 'いつも10秒の設定');
s = PZ.init(3, 5, { rules: {} });
assert.equal(PZ.apply(s, { p: 0, t: 'stop', q: 0, ms: 5000 }), null, '始まる前は押せない');
s = ref(PZ, s, 'next');
const pzT = s.targets[0] * 1000;
s = PZ.apply(s, { p: 0, t: 'stop', q: 0, ms: pzT + 400 });
assert.equal(PZ.apply(s, { p: 0, t: 'stop', q: 0, ms: pzT }), null, '1回に1度だけ');
assert.equal(PZ.apply(s, { p: 1, t: 'stop', q: 0, ms: pzT + 6000 }), null, '時間切れのあとは押せない');
s = PZ.apply(s, { p: 1, t: 'stop', q: 0, ms: pzT - 100 });
assert.equal(PZ.referee(s).key, 'open0', 'まだ押していない人がいれば待つ');
s = PZ.apply(s, { p: 2, t: 'stop', q: 0, ms: pzT + 100 });
assert.equal(PZ.referee(s).key, 'all0', '全員押したらすぐ締め切る');
s = ref(PZ, s, 'close');
assert.deepEqual(s.scores, [1, 3, 3], '前後どちらにずれても、近い順');
for (let i = 1; i < 5; i++) s = ref(PZ, ref(PZ, s, 'next'), 'close');
s = ref(PZ, s, 'next');
assert.ok(PZ.result(s), '5回で終わる');
console.log('pittari OK');

// ---------- タイピング早打ち ----------
const TY = GAMES.typing;
const { TYPING } = await import('../app/js/games/typing-data.js');
const { isRight: tyRight, pointsOf: tyPoints, limitOf: tyLimit } = await import('../app/js/games/typing.js');
const tyAll = [...TYPING.short, ...TYPING.mid, ...TYPING.long];
assert.ok(tyAll.length >= 90, 'お題は90個以上');
assert.equal(new Set(tyAll.map(([w]) => w)).size, tyAll.length, '同じお題が2回入っている');
for (const [w, ys] of tyAll) for (const y of ys) assert.match(y, /^[ぁ-ゖー]+$/, '読みはひらがなだけ: ' + w);
assert.ok(tyRight(['花より団子', ['はなよりだんご']], 'ハナヨリダンゴ'), 'カタカナでも正解');
assert.ok(tyRight(['花より団子', ['はなよりだんご']], '花より団子'), '表示どおりの漢字でも正解');
assert.ok(tyRight(['花より団子', ['はなよりだんご']], 'はなより だんご'), '空白は無視');
assert.ok(!tyRight(['花より団子', ['はなよりだんご']], 'はなよりだんごう'), '多すぎるのは不正解');
assert.ok(!tyRight(['花より団子', ['はなよりだんご']], ''), '空は不正解');
assert.deepEqual(tyPoints([5000, null, 3000, 3000, 9000]), [1, 0, 3, 3, 0], '速い順に 3・2・1点');
for (let k = 0; k < 30; k++) {
  const st = TY.init(2, k, { rules: {} });
  assert.equal(new Set(st.qs.map(([w]) => w)).size, 10, '10問とも違うお題');
  assert.ok(st.qs.slice(0, 3).every((x) => TYPING.short.includes(x)) && st.qs.slice(7).every((x) => TYPING.long.includes(x)), '後半ほど長い');
}
s = TY.init(4, 3, { rules: {} });
s = ref(TY, s, 'next');
const tyYomi = s.qs[0][1][0];
assert.equal(TY.apply(s, { p: 0, t: 'type', q: 0, text: 'ちがう', ms: 3000 }), null, 'まちがいは送れない');
s = TY.apply(s, { p: 0, t: 'type', q: 0, text: tyYomi, ms: 4000 });
assert.equal(TY.apply(s, { p: 0, t: 'type', q: 0, text: tyYomi, ms: 3000 }), null, '正解は1人1度だけ');
assert.equal(TY.apply(s, { p: 1, t: 'type', q: 0, text: tyYomi, ms: tyLimit(s) + 1000 }), null, '時間切れのあとは送れない');
s = TY.apply(s, { p: 3, t: 'type', q: 0, text: tyYomi, ms: 2500 });
assert.equal(TY.referee(s).key, 'open0', '2人ではまだ締め切らない');
s = TY.apply(s, { p: 2, t: 'type', q: 0, text: s.qs[0][0], ms: 6000 });
assert.equal(TY.referee(s).key, 'done0', '3人正解したら締め切る');
s = ref(TY, s, 'close');
assert.deepEqual(s.scores, [2, 0, 1, 3], '届いた順ではなく速い順');
console.log('typing OK');

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

// ---------- 五目並べ ----------
const GM = GAMES.gomoku;
s = GM.init();
assert.equal(s.size, 15, '最初は15路');
assert.equal(GM.init({ rules: { size: 13 } }).grid.length, 169);
// 黒が 7段目に横へ 5つ（列 3〜7）。白はその下の段
for (const m of [7 * 15 + 3, 8 * 15 + 3, 7 * 15 + 4, 8 * 15 + 4, 7 * 15 + 5, 8 * 15 + 5, 7 * 15 + 6, 8 * 15 + 6]) s = GM.apply(s, m);
assert.equal(GM.result(s), null, '4つではまだ');
assert.equal(GM.apply(s, 7 * 15 + 3), null, '石のある点には置けない');
s = GM.apply(s, 7 * 15 + 7);
assert.deepEqual([GM.result(s).winner, GM.result(s).cells.slice().sort((a, b) => a - b)], [0, [108, 109, 110, 111, 112]], '横に5つで勝ち');
assert.equal(GM.apply(s, 0), null, '決着後は置けない');
// ななめ（右上から左下）に白が5つ。黒は離れた所
s = GM.init();
for (let k = 0; k < 5; k++) { s = GM.apply(s, 14 * 15 + k * 2); s = GM.apply(s, (2 + k) * 15 + (10 - k)); }
assert.equal(GM.result(s).winner, 1, 'ななめに5つで白の勝ち');
// 6つ並んでも勝ち: 黒が 0〜2 と 4〜5 を持っていて 3 に置く
s = GM.init();
for (const m of [0, 30, 1, 31, 2, 32, 4, 33, 5, 60]) s = GM.apply(s, m);
s = GM.apply(s, 3);
assert.equal(GM.result(s).cells.length, 6, '6つ並んでも勝ち（禁じ手なし）');
// ぴったり五目: 同じ並べ方で6つは勝ちにならない（置くことはできる）。ちょうど5つなら勝ち
s = GM.init({ rules: { exact: true } });
for (const m of [0, 30, 1, 31, 2, 32, 4, 33, 5, 60]) s = GM.apply(s, m);
s = GM.apply(s, 3);
assert.ok(s && GM.result(s) === null, 'ぴったり五目では6つ並んでも勝ちにならない');
s = GM.init({ rules: { exact: true } });
for (const m of [0, 30, 1, 31, 2, 32, 3, 60]) s = GM.apply(s, m);
assert.equal(GM.result(GM.apply(s, 4)).winner, 0, 'ぴったり五目でもちょうど5つなら勝ち');
assert.equal(GM.cpu(s, 0, { cpu: 'strong' }), 4, 'ぴったり五目の CPU も5つを作って勝つ');
s = GM.init({ rules: { exact: true } });
for (const m of [0, 30, 1, 31, 2, 32, 4, 33, 5, 61]) s = GM.apply(s, m);
assert.notEqual(GM.cpu(s, 0, { cpu: 'strong' }), 3, 'ぴったり五目の CPU は勝てない6つを作りに行かない');
// はさみ取り: ちょうど2つをはさむと取れる・3つは取れない・自分から入っても取られない・5組で勝ち
{
  const cap = { rules: { capture: true } };
  let g = GM.init(cap);
  for (const m of [109, 110, 0, 111]) g = GM.apply(g, m); // 黒 (7,4)、白 (7,5)(7,6)
  g = GM.apply(g, 112);
  assert.deepEqual([g.grid[110], g.grid[111], g.caps, g.taken.slice().sort((x, y) => x - y)], [null, null, [1, 0], [110, 111]], 'はさみ取り: 2つをはさんで取る');
  assert.ok(GM.apply(g, 110), '取られた点にはまた置ける');
  g = GM.init(); for (const m of [109, 110, 0, 111]) g = GM.apply(g, m);
  assert.equal(GM.apply(g, 112).grid[110], 1, 'はさみ取りなしでは取らない');
  g = GM.init(cap); for (const m of [109, 110, 0, 111, 1, 112]) g = GM.apply(g, m);
  assert.equal(GM.apply(g, 113).grid[110], 1, '3つ並んだ石は取れない');
  g = GM.init(cap); for (const m of [110, 109, 0, 112]) g = GM.apply(g, m);
  g = GM.apply(g, 111);
  assert.deepEqual([g.grid[110], g.grid[111], g.caps], [0, 0, [0, 0]], '自分から、はさまれる形に置いても取られない');
  g = GM.init(cap); for (const m of [109, 110, 0, 111]) g = GM.apply(g, m);
  g = { ...g, caps: [4, 0] };
  assert.equal(GM.cpu(g, 0, { cpu: 'weak' }), 112, 'CPU は5組目を取って勝つ');
  g = GM.apply(g, 112);
  assert.deepEqual([GM.result(g).winner, g.won.byCap], [0, true], '5組取ったら勝ち');
  assert.match(GM.info(g), /5組取った/);
  // ななめにも取れる・ぴったり五目と同時に使える
  g = GM.init({ rules: { capture: true, exact: true } });
  for (const m of [0, 16, 100, 32]) g = GM.apply(g, m);
  g = GM.apply(g, 48);
  assert.deepEqual([g.grid[16], g.grid[32], g.caps[0]], [null, null, 1], 'ななめにも取れる');
}

// ---------- 記憶リレー ----------
{
  const KM = GAMES.kioku;
  const ref = (st, t) => KM.apply(st, { p: -1, t });
  let k = KM.init(3, 77, { rules: {} });
  assert.deepEqual(k.seq, KM.init(3, 77, { rules: {} }).seq, '順番は seed から同じ');
  assert.equal(k.seq.length, 30);
  k = ref(ref(k, 'go'), 'open');
  const seq3 = k.seq.slice(0, 3);
  const wrong = (i) => [...k.seq.slice(0, i), (k.seq[i] + 1) % 4];
  assert.equal(KM.apply(k, { p: 0, t: 'in', r: 0, keys: seq3.slice(0, 2) }), null, '途中までの順番は送れない');
  assert.equal(KM.apply(k, { p: 0, t: 'in', r: 0, keys: [...wrong(0), 0] }), null, '間違えたらそこで送る（後ろに続けない）');
  assert.equal(KM.apply(k, { p: 0, t: 'in', r: 1, keys: seq3 }), null, '回の番号が違う手は反則');
  let t = KM.apply(k, { p: 0, t: 'in', r: 0, keys: seq3 });
  assert.equal(KM.apply(t, { p: 0, t: 'in', r: 0, keys: seq3 }), null, '同じ手が2回届いても2回目は反則');
  t = KM.apply(t, { p: 1, t: 'in', r: 0, keys: wrong(1) });
  assert.equal(KM.referee(t).key, 'in0', 'まだ押していない人がいれば時間切れまで待つ');
  t = ref(t, 'close'); // 2 は時間切れ
  assert.deepEqual([t.last.res, t.lives, t.best, t.phase], [['ok', 'ng', 'late'], [1, 0, 0], [3, 0, 0], 'end'], '間違い・時間切れは脱落。1人残れば終わり');
  assert.deepEqual(KM.result(t).winners, [0], '残った人の勝ち');
  // 全員が同じ回で脱落したら同点。3回まで間違えられる
  k = ref(ref(KM.init(2, 5, { rules: {} }), 'go'), 'open');
  t = ref(KM.apply(KM.apply(k, { p: 0, t: 'in', r: 0, keys: [(k.seq[0] + 1) % 4] }), { p: 1, t: 'in', r: 0, keys: [(k.seq[0] + 2) % 4] }), 'close');
  assert.deepEqual(KM.result(t).winners, [0, 1], '全員が同じ回で脱落したら同点');
  k = ref(ref(KM.init(2, 5, { rules: { lives: 3 } }), 'go'), 'open');
  t = ref(KM.apply(k, { p: 0, t: 'in', r: 0, keys: k.seq.slice(0, 3) }), 'close');
  assert.deepEqual([t.lives, t.phase], [[3, 2], 'shown'], '3回までなら続く');
  t = ref(ref(t, 'go'), 'open');
  assert.equal(t.seq.slice(0, 4).length, 4);
  assert.ok(KM.apply(t, { p: 1, t: 'in', r: 1, keys: t.seq.slice(0, 4) }), '次の回は1つ長い');
  // CPU だけで最後まで（反則を出さない・必ず終わる）。CPU は画面に出てからの時間で押すので、時計（performance.now）を進めて試す
  const realNow = performance.now.bind(performance);
  let fake = realNow();
  performance.now = () => fake;
  try {
    const lens = [];
    for (let g = 0; g < 40; g++) {
      const n = 2 + (g % 5);
      let st = KM.init(n, g * 131 + 7, { rules: { lives: g % 2 ? 3 : 1 } });
      let guard = 0;
      while (!KM.result(st)) {
        const r = KM.referee(st);
        let moved = false;
        for (let p = 0; p < n; p++) {
          const m = KM.cpu(st, p);
          if (m) { st = KM.apply(st, { ...m, p }); assert.ok(st, '記憶リレーの CPU が反則'); moved = true; }
        }
        if (!moved) {
          fake += 600;
          if (st.phase !== 'input' || r.key.startsWith('all') || ++guard % 60 === 0) st = KM.apply(st, { ...r.move, p: -1 });
        }
        assert.ok(guard < 100000);
      }
      lens.push(Math.max(...st.best));
    }
    console.log('kioku CPU longest (avg)', (lens.reduce((x, y) => x + y, 0) / lens.length).toFixed(1));
  } finally { performance.now = realNow; }
  console.log('kioku OK');
}

// ---------- ひたいカード ----------
{
  const HT = GAMES.hitai;
  let h = HT.init(3, 42, { rules: {} });
  assert.deepEqual(h, HT.init(3, 42, { rules: {} }), '同じ種なら同じ配り方');
  assert.deepEqual([h.chips, h.pot, h.dealer, h.toAct, h.rules.rounds], [[19, 19, 19], 3, 0, 0, 10], '全員が1点出して、親から');
  assert.equal(HT.apply(h, { p: 1, t: 'bet', r: 1 }), null, '番でない人は選べない');
  assert.equal(HT.apply(h, { p: 0, t: 'bet', r: 2 }), null, '回の番号が違う手は反則');
  // 札を決めて試す: 0 が K、1 が A、2 が 5
  h = { ...h, cards: ['s13', 'h1', 'd5'] };
  let t = HT.apply(h, { p: 0, t: 'bet', r: 1 });
  t = HT.apply(t, { p: 1, t: 'bet', r: 1 });
  assert.equal(t.phase, 'bet');
  t = HT.apply(t, { p: 2, t: 'fold', r: 1 });
  assert.deepEqual([t.phase, t.winners, t.chips, t.pot], ['end', [1], [17, 17 + 7, 19], 7], 'A が一番強く、場の点（3＋2＋2）を全部もらう');
  assert.equal(HT.apply(t, { p: 0, t: 'next', r: 1 }).round, 2, '次の回へ');
  const t2 = HT.apply(HT.apply(t, { p: 0, t: 'next', r: 1 }), { p: 2, t: 'next', r: 1 });
  assert.equal(t2, null, '「次へ」が2回届いても1回だけ進む');
  assert.equal(HT.apply(t, { p: 0, t: 'next', r: 1 }).dealer, 1, '親がとなりへ回る');
  // 同じ強さは山分け・割り切れない分は持ち越し。全員降りたら持ち越し
  h = { ...HT.init(3, 1, { rules: {} }), cards: ['s9', 'h9', 'd2'] };
  t = HT.apply(HT.apply(HT.apply(h, { p: 0, t: 'bet', r: 1 }), { p: 1, t: 'bet', r: 1 }), { p: 2, t: 'bet', r: 1 });
  assert.deepEqual([t.winners, t.got, t.carry], [[0, 1], [4, 4, 0], 1], '同じ強さは山分け（9点を4点ずつ、1点は次へ）');
  t = HT.apply(t, { p: 0, t: 'next', r: 1 });
  assert.equal(t.pot, 4, '持ち越した点が次の場に入る');
  h = HT.init(2, 5, { rules: {} });
  t = HT.apply(HT.apply(h, { p: 0, t: 'fold', r: 1 }), { p: 1, t: 'fold', r: 1 });
  assert.deepEqual([t.winners, t.carry], [[], 2], '全員降りたら次の回へ持ち越し');
  // 持ち点が0になったら脱落・決めた回数で終わる
  h = { ...HT.init(2, 5, { rules: { rounds: 5 } }), cards: ['s1', 'h2'], chips: [10, 1] };
  t = HT.apply(HT.apply(h, { p: 0, t: 'bet', r: 1 }), { p: 1, t: 'bet', r: 1 });
  assert.deepEqual([t.over, t.ranking], [true, [0, 1]], '持ち点が0になったら脱落し、1人残れば終わり');
  // CPU どうしで最後まで（反則を出さない・持ち点の合計は変わらない）
  for (let g = 0; g < 100; g++) {
    const n = 2 + (g % 7);
    let st = HT.init(n, g * 977 + 3, { rules: { rounds: [5, 10, 15][g % 3] } });
    let guard = 0;
    while (!HT.result(st)) {
      const p = st.phase === 'end' ? (g % n) % n : st.toAct;
      const q = HT.canAct(st, p) ? p : HT.turn(st) ?? st.cards.findIndex((c) => c);
      st = HT.apply(st, { ...HT.cpu(st, q), p: q });
      assert.ok(st, 'ひたいカードの CPU が反則');
      assert.equal(st.chips.reduce((a, b) => a + b, 0) + (st.phase === 'end' ? st.carry : st.pot), n * 20, '持ち点と場の点の合計は変わらない');
      assert.ok(++guard < 1000);
    }
  }
  console.log('hitai OK');
}

// ---------- はさみ将棋 ----------
{
  const HS = GAMES.hasami;
  const { hashOf } = await import('../app/js/games/hasami.js');
  const at = (r, c) => r * 9 + c;
  const mv = (f, t) => f * 81 + t;
  const hs = (cells, o = {}) => {
    const board = Object.assign(Array(81).fill(null), cells);
    const [ha, hb] = hashOf(board, o.turn ?? 0);
    return { ...HS.init({ rules: o.rules ?? {} }), board, hist: { a: ha, b: hb, prev: null, cap: true }, ...o };
  };
  let h = HS.init({});
  assert.equal(h.board.filter((v) => v === 0).length, 9, '先手は9個');
  assert.ok(HS.apply(h, mv(at(8, 0), at(3, 0))), 'たてに何マスでも');
  assert.equal(HS.apply(h, mv(at(8, 0), at(7, 1))), null, 'ななめには動けない');
  assert.equal(HS.apply(h, mv(at(8, 0), at(0, 0))), null, '相手の駒のあるマスには動けない');
  assert.equal(HS.apply({ ...h, board: Object.assign(h.board.slice(), { [at(5, 0)]: 1 }) }, mv(at(8, 0), at(3, 0))), null, '駒を飛び越えられない');
  assert.equal(HS.apply(h, mv(at(0, 0), at(3, 0))), null, '相手の駒は動かせない');
  // 先手が (4,5) へ動いて (4,3)(4,4) の2個をまとめてはさむ
  h = hs({ [at(4, 2)]: 0, [at(4, 3)]: 1, [at(4, 4)]: 1, [at(8, 5)]: 0, [at(0, 8)]: 1 });
  let t = HS.apply(h, mv(at(8, 5), at(4, 5)));
  assert.deepEqual([t.board[at(4, 3)], t.board[at(4, 4)], t.taken[0], t.last.cap.length], [null, null, 2, 2], '一列に並んだ2個をまとめて取る');
  // 自分から間に入っても取られない
  h = hs({ [at(4, 2)]: 0, [at(4, 4)]: 0, [at(0, 3)]: 1, [at(8, 8)]: 0 }, { turn: 1 });
  t = HS.apply(h, mv(at(0, 3), at(4, 3)));
  assert.equal(t.board[at(4, 3)], 1, '自分から間に入っても取られない');
  // 隅の駒はとなりの2マスで取る
  h = hs({ [at(0, 0)]: 1, [at(0, 1)]: 0, [at(5, 0)]: 0, [at(3, 3)]: 1 });
  t = HS.apply(h, mv(at(5, 0), at(1, 0)));
  assert.deepEqual([t.board[at(0, 0)], t.taken[0]], [null, 1], '隅の駒はとなりの2マスをふさげば取れる');
  // 5個取ったら勝ち・「全部」なら続く
  h = hs({ [at(4, 2)]: 0, [at(4, 3)]: 1, [at(8, 4)]: 0, [at(0, 8)]: 1 }, { taken: [4, 0] });
  assert.equal(HS.result(HS.apply(h, mv(at(8, 4), at(4, 4)))).winner, 0, '5個取ったら勝ち');
  h = { ...h, goal: 9 };
  assert.equal(HS.result(HS.apply(h, mv(at(8, 4), at(4, 4)))), null, '全部取るまで続く');
  assert.equal(HS.init({ rules: { goal: 'all' } }).goal, 9);
  // 同じ局面が3回で引き分け
  h = hs({ [at(8, 0)]: 0, [at(0, 8)]: 1 });
  const loop = [mv(at(8, 0), at(7, 0)), mv(at(0, 8), at(1, 8)), mv(at(7, 0), at(8, 0)), mv(at(1, 8), at(0, 8))];
  for (let k = 0; !HS.result(h); k++) h = HS.apply(h, loop[k % 4]);
  assert.deepEqual([HS.result(h).winner, h.won.repeat, h.ply], [null, true, 8], '同じ局面が3回出たら引き分け（最初の局面が 0・4・8手目）');
  // CPU どうしで最後まで（反則を出さない・必ず終わる）
  for (let g = 0; g < 6; g++) {
    let st = HS.init({ rules: { goal: g % 2 ? 'all' : 5 } });
    while (!HS.result(st)) {
      st = HS.apply(st, HS.cpu(st, st.turn, { cpu: ['weak', 'normal'][g % 2] }));
      assert.ok(st, 'はさみ将棋の CPU が反則');
      assert.deepEqual([st.hist.a, st.hist.b], hashOf(st.board, st.turn), 'はさみ将棋: 足し引きで作った局面の目印が、盤から作り直したものと同じ');
    }
  }
  console.log('hasami OK');
}

// ---------- 点と線 ----------
const DT = GAMES.dots;
const { scoresOf: dotScores } = await import('../app/js/games/dots.js');
s = DT.init();
assert.equal(s.w, 4, '2人のおまかせは 4×4');
assert.equal(s.lines.length, 5 * 4 + 4 * 5, '線の数');
assert.equal(DT.init({ rules: { players: 4 } }).w, 6, '4人のおまかせは 6×6');
assert.equal(DT.init({ rules: { players: 3, size: 3 } }).w, 3, '盤の大きさを選べる');
assert.equal(DT.seatCount({ players: 3 }), 3);
// 左上の四角（上 0・下 4・左 20・右 21）。赤 0、青 4、赤 20 と引き、青が 21 で四角を取って続けて青の番
s = DT.init();
for (const m of [0, 4, 20]) s = DT.apply(s, m);
assert.equal(DT.turn(s), 1);
s = DT.apply(s, 21);
assert.deepEqual([s.boxes[0], DT.turn(s)], [1, 1], '4辺目を引いたら四角をもらい、もう1本');
t = DT.init({ rules: { swap: true } });
for (const m of [0, 4, 20, 21]) t = DT.apply(t, m);
assert.deepEqual([t.boxes[0], DT.turn(t)], [1, 0], '四角を取っても交代: 四角はもらうが次の人の番');
for (let g = 0; g < 20; g++) {
  let st = DT.init({ rules: { swap: true, players: 2 + (g % 3) } });
  while (!DT.result(st)) { st = DT.apply(st, DT.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][g % 3] })); assert.ok(st, '四角を取っても交代の CPU が打てる'); }
}
assert.equal(DT.apply(s, 21), null, '引いた線には引けない');
s = DT.apply(s, 9);
assert.equal(DT.turn(s), 0, '四角を取らなければ次の人');
// 2つの四角を一度に閉じる: 四角0と1の間の線（22）を最後に引く
s = DT.init();
for (const m of [0, 1, 4, 5, 20, 22]) s = DT.apply(s, m);
const who = DT.turn(s);
s = DT.apply(s, 21);
assert.deepEqual([s.boxes[0], s.boxes[1]], [who, who], '1本で2つの四角を閉じる');
// 全部引いたら四角の多い人の勝ち。3人でも回る
s = DT.init({ rules: { players: 3, size: 3 } });
while (!DT.result(s)) s = DT.apply(s, s.lines.indexOf(null));
assert.equal(dotScores(s).reduce((a, b) => a + b), 9, '四角は全部だれかのもの');
const top = Math.max(...dotScores(s));
assert.equal(DT.result(s).winner, dotScores(s).filter((v) => v === top).length === 1 ? dotScores(s).indexOf(top) : null);
{
  const RJ = { rules: { renju: true } };
  const pos = (blacks, whites, turn = 0) => {
    const x = GM.init(RJ);
    const grid = x.grid.slice();
    for (const [r, c] of blacks) grid[r * 15 + c] = 0;
    for (const [r, c] of whites) grid[r * 15 + c] = 1;
    return { ...x, grid, turn };
  };
  const at = (r, c) => r * 15 + c;
  assert.equal(GM.apply(pos([[7, 5], [7, 6], [5, 8], [6, 8]], []), at(7, 8)), null, '禁じ手: 黒の三三は置けない');
  assert.ok(GM.apply(pos([[7, 5], [7, 6], [5, 8], [6, 8]], [[7, 4]]), at(7, 8)), '片方が止まった三は三三にならない');
  assert.ok(GM.apply(pos([[7, 5], [7, 6], [5, 8], [6, 8]], [], 1), at(7, 8)), '白には禁じ手がない');
  assert.ok(GM.apply({ ...pos([[7, 5], [7, 6], [5, 8], [6, 8]], []), renju: false }, at(7, 8)), '禁じ手がオフなら置ける');
  assert.equal(GM.apply(pos([[7, 4], [7, 5], [7, 6], [4, 8], [5, 8], [6, 8]], [[7, 3], [3, 8]]), at(7, 8)), null, '禁じ手: 四四');
  assert.equal(GM.apply(pos([[7, 2], [7, 4], [7, 5], [7, 8]], []), at(7, 6)), null, '禁じ手: 同じ線の四四');
  assert.ok(GM.apply(pos([[7, 2], [7, 3], [7, 4], [7, 5]], [[7, 1]]), at(7, 6)), '止まった四を五にするのは置ける');
  assert.equal(GM.apply(pos([[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]], []), at(7, 5)), null, '禁じ手: 長連（6つ以上）');
  const five = GM.apply(pos([[7, 3], [7, 4], [7, 5], [7, 6], [5, 7], [6, 7], [5, 9], [6, 8]], []), at(7, 7));
  assert.equal(five && GM.result(five).winner, 0, 'ちょうど5つになるなら三三と同時でも置けて勝ち');
  // CPU の黒は禁じ手に置かない（禁じ手の点が一番よい点でも）
  const bait = pos([[7, 5], [7, 6], [5, 8], [6, 8]], [[0, 0]]);
  for (let i = 0; i < 30; i++) assert.notEqual(GM.cpu(bait, 0, { cpu: 'strong' }), at(7, 8), 'CPU の黒は禁じ手に置かない');
  // 置ける点が禁じ手しか無ければ引き分け（空いているのは長連になる1点だけ。ほかは白で埋める）
  const stuckSt = pos([[7, 2], [7, 3], [7, 4], [7, 6], [7, 7]], []);
  stuckSt.grid = stuckSt.grid.map((v, i) => (v === null && i !== at(7, 5) ? 1 : v));
  assert.equal(GM.apply(stuckSt, at(7, 5)), null);
  assert.deepEqual(GM.result(stuckSt), { winner: null, cells: [] }, '黒が禁じ手しか置けないときは引き分け');
  assert.equal(GM.result({ ...stuckSt, turn: 1 }), null, '白の番なら引き分けにしない');
}
console.log('gomoku / dots OK');

// ---------- ババ抜き ----------
const BB = GAMES.babanuki;
const { rankOf: rk } = await import('../app/js/games/cards.js');
for (const n of [2, 3, 5, 10]) {
  for (const mode of ['baba', 'jiji']) {
    let st = BB.init(n, n * 7 + 1, { rules: { mode } });
    assert.deepEqual(st, BB.init(n, n * 7 + 1, { rules: { mode } }), '同じ種なら同じ配り');
    const all = st.hands.flat();
    assert.equal(all.filter((c) => c === 'JK').length, mode === 'baba' ? 1 : 0, mode + ' のジョーカー');
    for (const h of st.hands) {
      const ranks = h.filter((c) => c !== 'JK').map(rk);
      assert.equal(new Set(ranks).size, ranks.length, '最初にそろった2枚は捨ててある');
    }
    let guard = 0;
    while (!BB.result(st)) {
      const p = BB.turn(st);
      assert.ok(st.hands[p].length > 0, '上がった人の番は来ない');
      const from = BB.victim(st);
      assert.ok(from !== p && st.hands[from].length > 0, '引く相手は手札のある別の人');
      st = BB.apply(st, { p, ...BB.cpu(st, p) });
      assert.ok(st);
      assert.ok(++guard < 2000, '終わる');
    }
    const res = BB.result(st);
    assert.equal(res.ranking.length, n, '全員に順位');
    if (mode === 'baba') assert.deepEqual(st.hands[res.loser], ['JK'], '負けた人はジョーカーを持っている');
    else assert.equal(rk(st.hands[res.loser][0]), rk(st.hidden), 'ジジ抜きの負けの札は抜いた札と同じ数字');
  }
}
s = BB.init(3, 5, {});
assert.equal(BB.apply(s, { p: 1, t: 'draw', i: 0 }), null, '番でない人は引けない');
assert.equal(BB.apply(s, { p: 0, t: 'draw', i: 99 }), null, '無い位置は引けない');

// ---------- ダウト ----------
const DB = GAMES.doubt;
s = DB.init(3, 11, {});
assert.equal(s.hands.flat().length, 52);
assert.ok(DB.realtime);
const num1 = (st) => st.hands[st.turn].filter((c) => rk(c) === (st.plays % 13) + 1);
const lie1 = (st) => st.hands[st.turn].filter((c) => rk(c) !== (st.plays % 13) + 1);
assert.equal(DB.apply(s, { p: 1, t: 'play', cards: [s.hands[1][0]] }), null, '番でない人は出せない');
assert.equal(DB.apply(s, { p: 0, t: 'play', cards: s.hands[0].slice(0, 5) }), null, '5枚は出せない');
assert.equal(DB.apply(s, { p: 0, t: 'play', cards: [s.hands[1][0]] }), null, '持っていない札は出せない');
// うそを出してダウトされる → 出した人が引き取る
let lie = lie1(s)[0];
s = DB.apply(s, { p: 0, t: 'play', cards: [lie] });
assert.equal(DB.turn(s), null, '受付の間は番が無い');
assert.equal(DB.apply(s, { p: 0, t: 'doubt', w: 0, ms: 100 }), null, '出した人はダウトできない');
assert.equal(DB.referee(s).ms, s.limit, '最初は受付の秒数');
s = DB.apply(s, { p: 1, t: 'doubt', w: 0, ms: 900 });
assert.equal(DB.apply(s, { p: 1, t: 'doubt', w: 0, ms: 800 }), null, '同じ人は2回押せない');
assert.equal(DB.referee(s).ms, 1000, 'ダウトが出たら1秒で締め切る');
s = DB.apply(s, { p: 2, t: 'doubt', w: 0, ms: 400 }); // あとから届いたが速い（番号も大きい）
assert.equal(DB.referee(s).ms, 300, '全員決めたらすぐ締め切る');
assert.equal(DB.apply(s, { p: 1, t: 'close', w: 0 }), null, '締め切りはホストだけ');
let before = s.hands[0].length;
s = DB.apply(s, { p: -1, t: 'close', w: 0 });
assert.deepEqual([s.reveal.by, s.reveal.lie, s.reveal.taker], [2, true, 0], '届いた順でなく速い人のダウト・うそなら出した人が引き取る');
assert.equal(s.hands[0].length, before + 1);
assert.equal(DB.apply(s, { p: -1, t: 'close', w: 0 }), null, '締め切りは1回だけ');
assert.deepEqual([DB.turn(s), s.plays], [1, 1], '次の人が次の数字（2）');
// 本当の札でダウトされる → ダウトした人が引き取る
s = DB.init(3, 12, {});
while (!num1(s).length) s = DB.apply(DB.apply(s, { p: s.turn, t: 'play', cards: [lie1(s)[0]] }), { p: -1, t: 'close', w: s.plays });
const prevPlays = s.plays;
const pl = s.turn;
s = DB.apply(s, { p: pl, t: 'play', cards: num1(s) });
const dbr = (pl + 1) % 3;
const pile = s.pile.length;
before = s.hands[dbr].length;
s = DB.apply(s, { p: dbr, t: 'doubt', w: prevPlays, ms: 500 });
s = DB.apply(s, { p: -1, t: 'close', w: prevPlays });
assert.equal(s.reveal.lie, false);
assert.equal(s.hands[dbr].length, before + pile, '本当ならダウトした人が場の札を全部引き取る');
assert.equal(s.pile.length, 0);
// 最後の札が通れば上がり
s = DB.init(3, 13, {});
s = { ...s, hands: [[s.hands[0][0]], s.hands[1], s.hands[2]] };
s = DB.apply(s, { p: 0, t: 'play', cards: s.hands[0] });
s = DB.apply(s, { p: 1, t: 'pass', w: 0 });
s = DB.apply(s, { p: 2, t: 'pass', w: 0 });
s = DB.apply(s, { p: -1, t: 'close', w: 0 });
assert.equal(DB.result(s).winner, 0, '最後の札が通れば上がり');
// CPU どうしで最後まで（反則を出さない・必ず終わる）
for (let g = 0; g < 30; g++) {
  let st = DB.init(3 + (g % 6), g, {});
  let guard = 0;
  while (!DB.result(st)) {
    let moved = false;
    for (let p = 0; p < st.n; p++) {
      if (!DB.canAct(st, p)) continue;
      st = DB.apply(st, { p, ...DB.cpu(st, p) });
      assert.ok(st, 'ダウトの CPU が反則を出した');
      moved = true;
    }
    if (!moved) { const r = DB.referee(st); st = DB.apply(st, { ...r.move, p: -1 }); }
    assert.ok(++guard < 5000, 'ダウトが終わらない');
    assert.equal(st.hands.flat().length + st.pile.length, 52, '札の数は52のまま');
  }
}

// ---------- ヨット ----------
const YT = GAMES.yacht;
const { scoreOf, totalOf } = await import('../app/js/games/yacht.js');
assert.equal(scoreOf(0, [1, 1, 3, 4, 1]), 3, '1の目の合計');
assert.equal(scoreOf(5, [6, 6, 6, 2, 1]), 18);
assert.equal(scoreOf(6, [1, 2, 3, 4, 6]), 16, 'チョイス');
assert.equal(scoreOf(7, [5, 5, 5, 5, 2]), 22, 'フォーダイスは5個の合計');
assert.equal(scoreOf(7, [5, 5, 5, 2, 2]), 0);
assert.equal(scoreOf(8, [3, 3, 3, 2, 2]), 13, 'フルハウス');
assert.equal(scoreOf(8, [4, 4, 4, 4, 4]), 20, '5個同じもフルハウス');
assert.equal(scoreOf(8, [3, 3, 3, 3, 2]), 0);
assert.equal(scoreOf(9, [3, 4, 5, 6, 6]), 15, 'Sストレート');
assert.equal(scoreOf(9, [1, 2, 3, 5, 6]), 0);
assert.equal(scoreOf(10, [2, 3, 4, 5, 6]), 30, 'Bストレート');
assert.equal(scoreOf(10, [1, 2, 3, 4, 6]), 0);
assert.equal(scoreOf(11, [2, 2, 2, 2, 2]), 50, 'ヨット');
assert.deepEqual(totalOf([3, 6, 9, 12, 15, 18, null, null, null, null, null, 50]), { upper: 63, bonus: 35, total: 148 }, '63点でボーナス');
assert.equal(totalOf([3, 6, 9, 12, 15, 17, 0, 0, 0, 0, 0, 0]).bonus, 0);
s = YT.init(3, 21);
assert.equal(YT.apply(s, { p: 0, t: 'score', r: 0, cat: 0 }), null, '振る前は書けない');
assert.equal(YT.apply(s, { p: 0, t: 'roll', r: 0, k: 1, keep: [true, false, false, false, false] }), null, '1振り目は残せない');
s = YT.apply(s, { p: 0, t: 'roll', r: 0, k: 1, keep: [false, false, false, false, false] });
assert.equal(YT.apply(s, { p: 0, t: 'roll', r: 0, k: 1, keep: [false, false, false, false, false] }), null, '同じ振りは2回届いても1回');
const d1 = s.pl[0].dice.slice();
s = YT.apply(s, { p: 0, t: 'roll', r: 0, k: 2, keep: [true, true, false, false, false] });
assert.deepEqual(s.pl[0].dice.slice(0, 2), d1.slice(0, 2), '残したサイコロはそのまま');
s = YT.apply(s, { p: 0, t: 'roll', r: 0, k: 3, keep: [true, true, true, false, false] });
assert.equal(YT.apply(s, { p: 0, t: 'roll', r: 0, k: 4, keep: [true, true, true, true, false] }), null, '4回目は振れない');
s = YT.apply(s, { p: 0, t: 'score', r: 0, cat: 6 });
assert.equal(s.pl[0].sheet[6], s.pl[0].dice.reduce((a, b) => a + b), 'チョイスを書いた');
assert.equal(YT.canAct(s, 0), false, '書いたらほかの人を待つ');
assert.equal(s.round, 0, '全員が書くまで次の回へ進まない');
for (const p of [1, 2]) { s = YT.apply(s, { p, t: 'roll', r: 0, k: 1, keep: [false, false, false, false, false] }); s = YT.apply(s, { p, t: 'score', r: 0, cat: 6 }); }
assert.equal(s.round, 1, '全員書いたら次の回');
assert.equal(YT.apply(s, { p: 0, t: 'roll', r: 0, k: 1, keep: [false, false, false, false, false] }), null, '前の回の手は弾く');
s = YT.apply(s, { p: 0, t: 'roll', r: 1, k: 1, keep: [false, false, false, false, false] });
assert.equal(YT.apply(s, { p: 0, t: 'score', r: 1, cat: 6 }), null, '書いた役には書けない');
assert.deepEqual(YT.init(3, 21), YT.init(3, 21));
// 2回目のヨット（詳細設定）: ヨットに50点を書いたあと、5個そろえてほかの役に書くと +100
{
  const five = (on, yachtCol) => {
    const st = YT.init(2, 5, { rules: { bonusYacht: on } });
    st.pl[0] = { ...st.pl[0], dice: [4, 4, 4, 4, 4], rolls: 1, sheet: [null, null, null, null, null, null, null, null, null, null, null, yachtCol] };
    st.round = yachtCol === null ? 0 : 1; // 書いた役の数が回の数
    return st;
  };
  let y = YT.apply(five(true, 50), { p: 0, t: 'score', r: 1, cat: 3 });
  assert.deepEqual([y.pl[0].sheet[3], y.pl[0].extra, totalOf(y.pl[0].sheet, y.pl[0].extra).total], [20, 100, 170], '2回目のヨットで +100');
  assert.equal(YT.apply(five(false, 50), { p: 0, t: 'score', r: 1, cat: 3 }).pl[0].extra, 0, '設定がなしなら付かない');
  assert.equal(YT.apply(five(true, 0), { p: 0, t: 'score', r: 1, cat: 3 }).pl[0].extra, 0, 'ヨットが0点なら付かない');
  const first = five(true, null);
  assert.equal(YT.apply(first, { p: 0, t: 'score', r: 0, cat: 11 }).pl[0].extra, 0, '1回目のヨットには付かない');
  y = { ...y, round: 12, pl: y.pl.map((x) => ({ ...x, sheet: x.sheet.map((v) => v ?? 0) })) };
  assert.equal(YT.result(y).winner, 0, 'ボーナスも合計に入って勝ち負けを決める');
}
// CPU どうしで最後まで
for (let g = 0; g < 20; g++) {
  let st = YT.init(2 + (g % 4), 100 + g);
  let guard = 0;
  while (!YT.result(st)) {
    for (let p = 0; p < st.n; p++) if (YT.canAct(st, p)) { st = YT.apply(st, { p, ...YT.cpu(st, p) }); assert.ok(st, 'ヨットの CPU が反則を出した'); }
    assert.ok(++guard < 200);
  }
  assert.ok(st.pl.every((x) => x.sheet.every((v) => v !== null)), '全部の役が埋まる');
  const tot = st.pl.map((x) => totalOf(x.sheet).total);
  assert.ok(tot.every((v) => v > 60 && v < 400), 'CPU の点がふつうの範囲 ' + tot);
}

// ---------- ワードウルフ ----------
const WW = GAMES.wordwolf;
const { PAIRS } = await import('../app/js/games/wordwolf-data.js');
assert.ok(WW.noCpu && WW.minPlayers === 3);
assert.ok(PAIRS.every((x) => x.length === 2 && x[0] !== x[1]), 'お題は違う2つの言葉');
assert.equal(new Set(PAIRS.flat()).size, PAIRS.length * 2, 'お題の言葉が重ならない');
s = WW.init(4, 31, {});
const wolf = s.wolves[0];
assert.equal(s.wolves.length, 1, 'ウルフは最初1人');
const town = [0, 1, 2, 3].filter((p) => p !== wolf);
assert.notEqual(WW.wordOf(s, wolf), WW.wordOf(s, town[0]), 'ウルフだけ違うお題');
assert.equal(WW.wordOf(s, town[0]), WW.wordOf(s, town[1]));
assert.equal(WW.referee(s).ms, 3 * 60000, '話し合いは最初3分');
{
  // お題なし: ウルフだけ白紙・多数派のお題と配り方は同じ種なら似た言葉のときと同じ
  const b = WW.init(4, 31, { rules: { wolfWord: 'blank' } });
  assert.deepEqual([b.wolves, b.words[0], WW.wordOf(b, b.wolves[0]), b.blank], [s.wolves, s.words[0], 'お題なし', true], 'お題なしではウルフに白紙を配る');
  const b2 = WW.init(8, 5, { rules: { wolfWord: 'blank', wolves: 2 } });
  assert.deepEqual(b2.wolves.map((p) => WW.wordOf(b2, p)), ['お題なし', 'お題なし'], 'ウルフ2人なら2人とも白紙');
}
assert.equal(WW.apply(s, { p: 0, t: 'vote', to: 1, v: 1 }), null, '話し合いの間は投票できない');
s = WW.apply(s, { p: -1, t: 'tovote' });
assert.equal(s.phase, 'vote', '時間が来たら投票');
assert.equal(WW.apply(s, { p: 0, t: 'vote', to: 0, v: 1 }), null, '自分には投票できない');
const voteAll = (st, to) => { for (let p = 0; p < st.n; p++) st = WW.apply(st, { p, t: 'vote', to: to(p), v: st.vote }); return st; };
let t1 = voteAll(s, (p) => (p === wolf ? town[0] : wolf));
assert.equal(t1.phase, 'guess', 'ウルフが選ばれたらお題を当てる番');
assert.equal(WW.apply(t1, { p: town[0], t: 'guess', text: 'x' }), null, 'ウルフ以外は答えられない');
let t2 = WW.apply(t1, { p: wolf, t: 'guess', text: ` ${WW.wordOf(s, town[0])} ` });
assert.deepEqual(WW.result(t2).winners, [wolf], '同じ言葉なら自動で逆転');
t2 = WW.apply(t1, { p: wolf, t: 'guess', text: 'ぜんぜんちがう' });
assert.equal(t2.phase, 'judge', '違う言葉なら多数派が判定');
assert.equal(WW.apply(t2, { p: wolf, t: 'judge', ok: true }), null, 'ウルフは判定できない');
assert.deepEqual(WW.result(WW.apply(t2, { p: town[1], t: 'judge', ok: false })).winners, town, 'はずれならウルフ以外の勝ち');
assert.deepEqual(WW.result(WW.apply(t2, { p: town[1], t: 'judge', ok: true })).winners, [wolf], '正解ならウルフの勝ち');
t1 = voteAll(s, (p) => (p === town[0] ? town[1] : town[0]));
assert.deepEqual(WW.result(t1).winners, [wolf], 'ウルフ以外が選ばれたらウルフの勝ち');
// 2対2で並ぶ → 並んだ2人でやり直し → また並べばウルフの勝ち
// 0 と 1 が2票ずつ → 2人だけでやり直し。1回目の投票（v: 1）はもう受け付けない
t1 = voteAll(s, (p) => [1, 0, 0, 1][p]);
assert.deepEqual([t1.vote, t1.cands], [2, [0, 1]], '並んだ人だけでやり直し');
assert.equal(WW.apply(t1, { p: 2, t: 'vote', to: 3, v: 2 }), null, '候補でない人には入れられない');
assert.equal(WW.apply(t1, { p: 2, t: 'vote', to: 0, v: 1 }), null, '前の投票の手は弾く');
let tie = WW.apply(WW.init(4, 31, {}), { p: 0, t: 'tovote' });
tie = voteAll(tie, (p) => (p < 2 ? (p === 0 ? 1 : 0) : (p === 2 ? 3 : 2)));
assert.deepEqual([tie.vote, tie.cands.length], [2, 4], '4人が1票ずつで並んだらやり直し');
tie = voteAll(tie, (p) => (p < 2 ? (p === 0 ? 1 : 0) : (p === 2 ? 3 : 2)));
assert.deepEqual([tie.phase, WW.result(tie).winners], ['end', tie.wolves], 'やり直しでも並んだらウルフの勝ち');
// ウルフ2人: 7人以上のときだけ。2人は同じお題。どちらかが選ばれたら、そのウルフが答える。勝てば2人とも勝ち
assert.equal(WW.init(6, 5, { rules: { wolves: 2 } }).wolves.length, 1, '6人ではウルフ2人を選んでも1人');
for (let seed = 1; seed <= 30; seed++) {
  const w = WW.init(7, seed, { rules: { wolves: 2 } });
  assert.ok(w.wolves.length === 2 && w.wolves[0] !== w.wolves[1], '7人ならウルフは別々の2人');
}
{
  let w = WW.init(8, 9, { rules: { wolves: 2 } });
  const [a, b] = w.wolves;
  const town2 = [...Array(8).keys()].filter((p) => !w.wolves.includes(p));
  assert.equal(WW.wordOf(w, a), WW.wordOf(w, b), '2人のウルフは同じお題');
  assert.notEqual(WW.wordOf(w, a), WW.wordOf(w, town2[0]));
  w = WW.apply(w, { p: -1, t: 'tovote' });
  const v = voteAll(w, (p) => (p === b ? town2[0] : b));
  assert.equal(v.phase, 'guess', '2人目のウルフが選ばれても答える番');
  assert.equal(WW.apply(v, { p: a, t: 'guess', text: 'x' }), null, '選ばれていないウルフは答えられない');
  const j = WW.apply(v, { p: b, t: 'guess', text: 'ぜんぜんちがう' });
  assert.equal(WW.apply(j, { p: a, t: 'judge', ok: true }), null, 'もう1人のウルフも判定できない');
  assert.deepEqual(WW.result(WW.apply(j, { p: town2[0], t: 'judge', ok: true })).winners, w.wolves, '逆転したらウルフ2人とも勝ち');
  assert.deepEqual(WW.result(WW.apply(j, { p: town2[0], t: 'judge', ok: false })).winners, town2, 'はずれならウルフ以外の勝ち');
  assert.deepEqual(WW.result(voteAll(w, (p) => (p === town2[0] ? town2[1] : town2[0]))).winners, w.wolves, 'ウルフ以外が選ばれたらウルフ2人の勝ち');
}
console.log('babanuki / doubt / yacht / wordwolf OK');

// ---------- 七並べ ----------
const SV = GAMES.sevens;
s = SV.init(4, 7, {});
assert.equal(Object.keys(s.field).length, 4, '7の札4枚が最初に場にある');
assert.ok(s.hands.every((h) => h.every((c) => !/^[shdc]7$/.test(c))), '手札に7は無い');
assert.equal(s.hands.reduce((a, h) => a + h.length, 0), 48);
{
  // ♦7 を持っていた人から始める（手札の数から、♦7 を含む7を何枚抜いたかは分からないので、配り直して確かめる）
  const { mulberry32, shuffle } = await import('../app/js/games/util.js');
  const { makeDeck } = await import('../app/js/games/cards.js');
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const holder = shuffle(makeDeck(0), mulberry32(seed)).indexOf('d7') % 4;
    if (holder) seen++;
    assert.equal(SV.init(4, seed, {}).turn, holder, '♦7 を持っていた人から始める');
  }
  assert.ok(seen >= 3, '最初の人以外が ♦7 を持つ配り方も確かめる');
}
assert.ok(SV.canPlace(s, 'h6') && SV.canPlace(s, 'h8'), '7のとなりに出せる');
assert.ok(!SV.canPlace(s, 'h5') && !SV.canPlace(s, 'h7'), '離れた札・出ている札は出せない');
const sv = { ...s, field: { ...s.field, h8: 1, h9: 1, h10: 1, h11: 1, h12: 1, h13: 1 } };
assert.ok(!SV.canPlace(sv, 'h1'), 'トンネルなしでは K のあと A は出せない');
assert.ok(SV.canPlace({ ...sv, tunnel: true }, 'h1'), 'トンネルなら K のあと A を出せる');
{
  const p = s.turn;
  const bad = s.hands[p].find((c) => !SV.canPlace(s, c));
  assert.equal(SV.apply(s, { p, t: 'play', c: bad }), null, '出せない札は反則');
  assert.equal(SV.apply(s, { p: (p + 1) % 4, t: 'pass' }), null, '番でない人は動けない');
  let t = s;
  for (let k = 0; k < 3; k++) {
    t = SV.apply(t, { p, t: 'pass' });
    assert.equal(t.outs.length, 0, '3回まではパスできる');
    while (t.turn !== p) t = SV.apply(t, { p: t.turn, t: 'pass' });
  }
  const before = t.hands[p].length;
  t = SV.apply(t, { p, t: 'pass' });
  assert.ok(t.outs.includes(p) && t.hands[p].length === 0, '4回目のパスで失格');
  assert.equal(Object.keys(t.field).length, 4 + before, '失格した人の札は場に並ぶ');
}
for (let g = 0; g < 30; g++) {
  const n = 3 + (g % 4);
  let st = SV.init(n, 500 + g, { rules: { tunnel: g % 2 === 0, passes: g % 3 ? 3 : 5 } });
  let guard = 0;
  while (!SV.result(st)) {
    st = SV.apply(st, { p: st.turn, ...SV.cpu(st, st.turn) });
    assert.ok(st, '七並べの CPU が反則を出した');
    assert.ok(++guard < 500);
  }
  assert.equal(Object.keys(st.field).length + st.hands.reduce((a, h) => a + h.length, 0), 52, '札の数が崩れない');
  assert.equal(new Set(SV.result(st).ranking).size, n, '全員に順位');
}
// ジョーカー（詳細設定）
{
  const { jokerSpots, playable } = await import('../app/js/games/sevens.js');
  let t = SV.init(4, 7, { rules: { joker: true } });
  assert.equal(t.hands.reduce((a, h) => a + h.length, 0), 49, 'ジョーカー入りは手札が1枚多い');
  const jp = t.hands.findIndex((h) => h.includes('JK'));
  t = { ...t, turn: jp };
  const own = SV.canPlace(t, 'h6') && t.hands[jp].includes('h6') ? 'h6' : ['h6', 'h8', 's6', 's8', 'd6', 'd8', 'c6', 'c8'].find((c) => t.hands[jp].includes(c));
  if (own) assert.equal(SV.apply(t, { p: jp, t: 'play', c: 'JK', at: own }), null, '自分が持っている札の所にはジョーカーを置けない');
  assert.equal(SV.apply(t, { p: jp, t: 'play', c: 'JK', at: 'h3' }), null, '出せない所にはジョーカーを置けない');
  const at = jokerSpots(t, jp).find((c) => /^[shdc][68]$/.test(c));
  const owner = t.hands.findIndex((h) => h.includes(at));
  t = SV.apply(t, { p: jp, t: 'play', c: 'JK', at });
  assert.deepEqual([t.field[at], t.jk, t.hands[jp].includes('JK')], ['joker', { at, owner }, false], 'ジョーカーを本物の札の代わりに置く');
  const beyond = at[0] + (at.endsWith('6') ? 5 : 9);
  assert.ok(SV.canPlace(t, beyond), 'ジョーカーの先にも出せる');
  while (t.turn !== owner) t = SV.apply(t, { p: t.turn, t: 'pass' });
  assert.equal(SV.apply(t, { p: owner, t: 'pass' }), null, '本物の札を持っている人はパスできない');
  const other = t.hands[owner].find((c) => c !== at && SV.canPlace(t, c));
  if (other) assert.equal(SV.apply(t, { p: owner, t: 'play', c: other }), null, 'ほかの札も出せない');
  assert.deepEqual(playable(t, owner), [at]);
  const n0 = t.hands[owner].length;
  t = SV.apply(t, { p: owner, t: 'play', c: at });
  assert.deepEqual([t.field[at], t.jk, t.hands[owner].includes('JK'), t.hands[owner].length], ['play', null, true, n0], '本物の札を出してジョーカーを受け取る');
  {
    let u = SV.init(4, 7, { rules: { joker: true } });
    const hp = u.hands.findIndex((h) => h.includes('JK'));
    while (!u.outs.includes(hp)) u = SV.apply(u, { p: u.turn, t: 'pass' });
    assert.ok(!('JK' in u.field), '失格した人のジョーカーは場に並べない');
  }
  let used = 0;
  for (let g = 0; g < 30; g++) {
    const n = 3 + (g % 4);
    let st = SV.init(n, 700 + g, { rules: { joker: true, tunnel: g % 2 === 0 } });
    let guard = 0;
    while (!SV.result(st)) {
      st = SV.apply(st, { p: st.turn, ...SV.cpu(st, st.turn) });
      assert.ok(st, '七並べ（ジョーカー）の CPU が反則を出した');
      if (st.last?.t === 'joker') used++;
      assert.ok(++guard < 600);
    }
    const onField = Object.values(st.field).filter((v) => v !== 'joker').length;
    assert.equal(onField + st.hands.reduce((a, h) => a + h.filter((c) => c !== 'JK').length, 0), 52, '札の数が崩れない（ジョーカー）');
  }
  assert.ok(used >= 10, 'CPU もジョーカーを使う');
  console.log('sevens joker uses', used);
}
console.log('sevens OK');

// ---------- マンカラ ----------
const MC = GAMES.mancala;
s = MC.init({});
assert.deepEqual(s.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
s = MC.apply(s, 2);
assert.deepEqual(s.pits, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0], '反時計回りに1個ずつ');
assert.equal(s.turn, 0, 'ゴールで止まったらもう1回');
s = MC.apply(s, 5);
assert.equal(s.turn, 1, 'ゴールで止まらなければ交代');
assert.equal(MC.apply(MC.init({}), 6), null, '0〜5 だけ');
const mc = { pits: [], turn: 0, last: null, over: false, count: 0 };
assert.equal(MC.apply({ ...mc, pits: [1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 5, 0, 0] }, 0).last.capture.got, 6, '空いた穴で止まったら向かいの石と合わせて取る');
assert.equal(MC.apply({ ...mc, pits: [1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0] }, 0).last.capture, null, '向かいが空なら取らない');
t = MC.apply({ ...mc, nocap: true, pits: [1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 5, 0, 0] }, 0);
assert.deepEqual([t.last.capture, t.pits[1], t.pits[11], t.nocap], [null, 1, 5, true], '捕獲なしでは空いた穴で止まっても取らない（設定は次の局面へ続く）');
t = MC.apply({ ...mc, n: 3, nocap: true, pits: [1, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0] }, 0);
assert.equal(t.last.capture, null, '3人でも捕獲なし');
assert.equal(MC.init({ rules: { nocap: true } }).nocap, true);
const sk = MC.apply({ ...mc, pits: [0, 0, 0, 0, 0, 9, 0, 1, 0, 0, 0, 0, 0, 0] }, 5);
assert.equal(sk.pits[13], 0, '相手のゴールは飛ばす');
assert.equal(sk.pits[0], 1, '飛ばした分は自分の側へ回る');
const end = MC.apply({ ...mc, pits: [0, 0, 0, 0, 0, 1, 10, 2, 3, 0, 0, 0, 0, 5] }, 5);
assert.ok(end.over && end.pits[13] === 10 && end.pits[6] === 11, '片側が空になったら残りは持ち主のゴールへ');
assert.deepEqual(MC.result(end), { winner: 0, cells: [] });
for (let g = 0; g < 20; g++) {
  let st = MC.init({ rules: { stones: 3 + (g % 4) } });
  const total = st.pits.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (!MC.result(st)) {
    st = MC.apply(st, MC.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][g % 3] }));
    assert.ok(st, 'マンカラの CPU が反則を出した');
    assert.ok(++guard < 400);
  }
  assert.equal(st.pits[6] + st.pits[13], total, '石の数が崩れない');
}
// 3人
s = MC.init({ rules: { players: 3 } });
assert.equal(MC.seatCount({ players: 3 }), 3);
assert.equal(s.pits.length, 21);
const mc3 = { n: 3, pits: [], turn: 0, last: null, over: false, count: 0 };
const p3 = (a) => { const x = Array(21).fill(0); for (const [i, v] of Object.entries(a)) x[i] = v; return x; };
const sk3 = MC.apply({ ...mc3, turn: 1, pits: p3({ 12: 16, 0: 1, 7: 1, 14: 1 }) }, 5);
assert.ok(sk3.pits[20] === 0 && sk3.pits[6] === 0 && sk3.pits[9] === 0 && sk3.last.capture?.got === 3, '3人: ほかの2人のゴールは飛ばす（1周近く配る）');
assert.equal(sk3.turn, 2, '3人: 次の人へ');
assert.equal(MC.apply({ ...mc3, pits: p3({ 0: 1, 1: 1, 8: 3, 15: 4, 7: 1, 14: 1 }) }, 0).last.capture, null, '3人: 石のある穴で止まったらとらない');
const cap3b = MC.apply({ ...mc3, pits: p3({ 1: 1, 4: 1, 9: 3, 16: 4, 7: 1, 14: 1 }) }, 1).pits;
assert.ok(cap3b[6] === 8 && cap3b[9] === 0 && cap3b[16] === 0 && cap3b[2] === 0, '3人: ほかの2人の同じ番目の石を両方とる');
const one3 = MC.apply({ ...mc3, pits: p3({ 0: 1, 4: 1, 8: 3, 7: 1, 14: 1 }) }, 0).last.capture;
assert.ok(one3 && one3.got === 4, '3人: 片方だけに石があってもとる');
const end3 = MC.apply({ ...mc3, pits: p3({ 5: 1, 7: 2, 15: 3, 20: 4 }) }, 5);
assert.ok(end3.over && end3.pits[6] === 1 && end3.pits[13] === 2 && end3.pits[20] === 7, '3人: 誰かの側が空になったら全員終わり');
assert.deepEqual(MC.result(end3), { winner: 2, cells: [] });
assert.equal(MC.result({ ...end3, pits: p3({ 6: 5, 13: 5, 20: 1 }) }).winner, null, '3人: 一番が2人なら引き分け');
for (let g = 0; g < 12; g++) {
  let st = MC.init({ rules: { players: 3, stones: 3 + (g % 4) } });
  const total = st.pits.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (!MC.result(st)) {
    st = MC.apply(st, MC.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][g % 3] }));
    assert.ok(st, '3人のマンカラの CPU が反則を出した');
    assert.ok(++guard < 600);
  }
  assert.equal(st.pits[6] + st.pits[13] + st.pits[20], total, '3人: 石の数が崩れない');
}
console.log('mancala OK');

// ---------- せりあい ----------
const SR = GAMES.seri;
s = SR.init(3, 11);
assert.equal(s.pot.length, 1);
const bidAll = (st, vs) => vs.reduce((t, v, p) => SR.apply(t, { p, t: 'bid', r: t.round, v }), st);
{
  const pos = { ...s, pot: [5] };
  let t = SR.apply(pos, { p: 0, t: 'bid', r: 0, v: 15 });
  assert.equal(SR.apply(t, { p: 0, t: 'bid', r: 0, v: 14 }), null, '1回に1枚');
  t = bidAll(pos, [15, 15, 3]);
  assert.equal(t.last.who, 2, '同じ数は打ち消し合い、残った人が取る');
  assert.equal(t.scores[2], 5);
  assert.ok(!t.hands[0].includes(15), '出した札は使えなくなる');
  t = bidAll(pos, [12, 9, 3]);
  assert.equal(t.last.who, 0, 'プラスは一番大きい数の人');
  t = bidAll({ ...s, pot: [-4] }, [1, 2, 9]);
  assert.equal(t.last.who, 0, 'マイナスは一番小さい数の人');
  assert.equal(t.scores[0], -4);
  t = bidAll({ ...s, pot: [6] }, [4, 4, 4]);
  assert.equal(t.last.who, -1, '全員打ち消したら誰も取らない');
  assert.deepEqual([t.pot.length, t.pot[0]], [2, 6], '次の回に持ち越す');
  assert.equal(SR.apply(t, { p: 0, t: 'bid', r: 0, v: 5 }), null, '前の回の手は弾く');
  const t2 = bidAll(t, [10, 2, 1]);
  assert.equal(t2.scores[t2.last.who], 6 + t.pot[1], '持ち越した札はまとめて取る');
}
for (let g = 0; g < 20; g++) {
  let st = SR.init(2 + (g % 5), 900 + g);
  let guard = 0;
  while (!SR.result(st)) {
    for (let p = 0; p < st.n; p++) if (SR.canAct(st, p)) { st = SR.apply(st, { p, ...SR.cpu(st, p) }); assert.ok(st, 'せりあいの CPU が反則を出した'); }
    assert.ok(++guard < 100);
  }
  assert.equal(st.round, 15);
  assert.ok(st.hands.every((h) => h.length === 0), '15回で全部の札を使い切る');
  const lost = st.last.lost ?? [];
  assert.equal(st.scores.reduce((a, b) => a + b, 0) + lost.reduce((a, b) => a + b, 0), 40, '点数の合計（+55 −15）が崩れない');
}
console.log('seri OK');

// ---------- お絵描き当て ----------
const OE = GAMES.oekaki;
const { encode, decode } = await import('../app/js/games/oekaki.js');
const { TOPICS } = await import('../app/js/games/oekaki-data.js');
const { kana } = await import('../app/js/games/party.js');
assert.deepEqual(decode(encode([[0, 0], [999, 500], [64, 63]])), [[0, 0], [999, 500], [64, 63]], '座標の縮め方は元に戻せる');
assert.ok(TOPICS.length >= 100, 'お題は100以上');
assert.equal(new Set(TOPICS.map((t) => kana(t[0]))).size, TOPICS.length, 'お題が重ならない');
assert.ok(TOPICS.every((t) => t.every((x) => kana(x).length > 0)));
assert.ok(OE.noCpu);
s = OE.init(3, 41, { rules: { time: 60 } });
assert.equal(new Set(s.topics).size, 3, '同じ対局で同じお題は出ない');
assert.equal(OE.referee(s).ms, 60000);
const ans = OE.topic(s);
const line = { p: 0, t: 'line', k: 0, g: 0, c: 0, w: 1, d: encode([[10, 10], [200, 300]]) };
let oe = OE.apply(s, line);
assert.equal(oe.strokes.length, 1);
assert.equal(OE.apply(oe, line), null, '同じ線の手が2回届いても2回目は反則');
assert.equal(OE.apply(s, { ...line, p: 1 }), null, '描く人しか描けない');
assert.equal(OE.apply(s, { ...line, d: 'AB' }), null, '壊れた座標は反則');
oe = OE.apply(oe, { p: 0, t: 'line', k: 1, g: 0, c: 0, w: 1, d: encode([[200, 300], [250, 300]]) });
oe = OE.apply(oe, { p: 0, t: 'line', k: 2, g: 2, c: 1, w: 0, d: encode([[5, 5], [6, 6]]) });
const undone = OE.apply(oe, { p: 0, t: 'undo', k: 3 });
assert.equal(undone.strokes.length, 2, '1つ戻すと最後のひと筆だけ消える');
assert.equal(OE.apply(undone, { p: 0, t: 'undo', k: 4 }).strokes.length, 0, 'ひと筆が区切られていてもまとめて消える');
assert.equal(OE.apply(oe, { p: 0, t: 'guess', n: 0, text: ans[0] }), null, '描く人は答えられない');
oe = OE.apply(oe, { p: 1, t: 'guess', n: 0, text: 'ぜったいちがうこたえ' });
assert.deepEqual([oe.chat.length, oe.scores[1]], [1, 0], '外れた答えは記録に残る');
assert.equal(OE.apply(oe, { p: 1, t: 'guess', n: 0, text: ans[0] }), null, '同じ番号の答えは2回目を弾く');
const hira = ans.map(kana).find((x) => /^[ぁ-ゖー]+$/.test(x));
const kata = hira.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
oe = OE.apply(oe, { p: 2, t: 'guess', n: 0, text: ` ${kata} ` });
assert.deepEqual([oe.correct, oe.scores], [[2], [3, 0, 10]], 'カタカナでも正解・1番は10点・描いた人に3点');
assert.equal(OE.canAct(oe, 2), false, '当てた人はもう答えない');
oe = OE.apply(oe, { p: 1, t: 'guess', n: 1, text: ans[0] });
assert.deepEqual([oe.phase, oe.scores], ['show', [6, 8, 10]], '全員当てたら答え合わせへ・2番は8点');
assert.equal(OE.apply(oe, { p: -1, t: 'end', turn: 0 }), null, '答え合わせ中の締め切りは弾く');
oe = OE.apply(oe, { p: -1, t: 'next', turn: 0 });
assert.deepEqual([oe.turn, oe.phase, oe.strokes.length], [1, 'draw', 0], '次の人が描く');
oe = OE.apply(oe, { p: -1, t: 'end', turn: 1 });
assert.equal(oe.why, 'time', '時間切れ');
oe = OE.apply(oe, { p: -1, t: 'next', turn: 1 });
oe = OE.apply(oe, { p: 2, t: 'giveup', k: 0 });
oe = OE.apply(oe, { p: -1, t: 'next', turn: 2 });
assert.ok(OE.result(oe), '全員が1回ずつ描いたら終わり');
assert.deepEqual(OE.result(oe).winners, [2]);
console.log('oekaki OK');

// ---------- ブラックジャック ----------
const BJ = GAMES.blackjack;
const { total: bjTotal } = await import('../app/js/games/blackjack.js');
assert.deepEqual(bjTotal(['s1', 'h13']), { v: 21, soft: true }, 'A と K で21');
assert.deepEqual(bjTotal(['s1', 'h1', 'd9']), { v: 21, soft: true }, 'A は1つだけ11');
assert.deepEqual(bjTotal(['s1', 'h5', 'd9']), { v: 15, soft: false }, '超えるなら A は1');
assert.equal(bjTotal(['s12', 'h11', 'd2']).v, 22);
// 札を決めた局面を作る（山は deck の pos から引く）
const bjState = (hands, dealer, rest) => ({ ...BJ.init(hands.length, 1), hands, dealer, deck: rest, pos: 0, done: hands.map(() => false), bets: hands.map(() => 10), phase: 'play', out: null });
s = bjState([['s10', 'h6'], ['d9', 'c9']], ['s9', 'h7'], ['c5', 's2', 'h10', 'd10']);
assert.equal(BJ.apply(s, { p: 0, t: 'hit', r: 1, k: 2 }), null, '前の回の手は弾く');
let bj = BJ.apply(s, { p: 0, t: 'hit', r: 0, k: 2 });
assert.deepEqual([bj.hands[0].length, bj.done[0]], [3, true], '21になったら自動で終わり');
bj = BJ.apply(bj, { p: 1, t: 'stand', r: 0 });
assert.equal(bj.phase, 'result', '全員終えたら親が引いて結果');
assert.deepEqual(bj.dealer, ['s9', 'h7', 's2'], '親は17以上まで引く');
assert.deepEqual(bj.out, [10, 0], '21は勝ち・18どうしは引き分け');
assert.deepEqual(bj.points, [110, 100]);
s = bjState([['s10', 'h2']], ['s10', 'h5'], ['c10']); // ちょうど22
bj = BJ.apply(s, { p: 0, t: 'hit', r: 0, k: 2 });
assert.deepEqual([bj.phase, bj.dealer.length, bj.out[0]], ['result', 2, -10], 'バーストは負け・全員バーストなら親は引かない');
{
  const h1 = BJ.apply(bjState([['s2', 'h3']], ['s10', 'h7'], ['c4', 'd5']), { p: 0, t: 'hit', r: 0, k: 2 });
  assert.equal(BJ.apply(h1, { p: 0, t: 'hit', r: 0, k: 2 }), null, '同じヒットが2回届いても2回目は弾く');
  assert.equal(BJ.apply(h1, { p: 0, t: 'hit', r: 0, k: 3 }).hands[0].length, 4, '次のヒットは引ける');
}
s = bjState([['s5', 'h6']], ['s10', 'h6'], ['c10', 'd10']);
bj = BJ.apply(s, { p: 0, t: 'double', r: 0 });
assert.deepEqual([bj.hands[0].length, bj.bets[0], bj.out[0]], [3, 20, 20], 'ダブルは1枚だけ引いて賭けが倍（親はバースト）');
assert.equal(BJ.apply(BJ.apply(bjState([['s5', 'h6']], ['s10', 'h7'], ['c2', 'c3']), { p: 0, t: 'hit', r: 0, k: 2 }), { p: 0, t: 'double', r: 0 }), null, '3枚目からはダブルできない');
// スプリット（詳細設定）
{
  const sp = (hands, dealer, rest) => ({ ...bjState(hands, dealer, rest), splitOn: true });
  assert.equal(BJ.apply(bjState([['s8', 'h8']], ['s10', 'h7'], ['c3']), { p: 0, t: 'split', r: 0 }), null, '詳細設定がなしならスプリットできない');
  assert.equal(BJ.apply(sp([['s13', 'h12']], ['s10', 'h7'], ['c3']), { p: 0, t: 'split', r: 0 }), null, 'K と Q は同じ数字ではない');
  let t = BJ.apply(sp([['s8', 'h8']], ['s10', 'h7'], ['c3', 'c10', 'd9']), { p: 0, t: 'split', r: 0 });
  assert.deepEqual([t.hands[0], t.wait[0]], [['s8', 'c3'], ['h8']], '1つ目に2枚目を配り、2つ目は待つ');
  t = BJ.apply(t, { p: 0, t: 'double', r: 0, h: 0 });
  assert.deepEqual([t.fin[0].c, t.fin[0].bet, t.hands[0], t.bets[0], t.done[0]], [['s8', 'c3', 'c10'], 20, ['h8', 'd9'], 10, false], '分けたあともダブルでき、終わったら2つ目へ');
  assert.equal(BJ.apply(t, { p: 0, t: 'double', r: 0, h: 0 }), null, '1つ目への手が2回届いても2つ目には効かない');
  assert.equal(BJ.apply(t, { p: 0, t: 'stand', r: 0 }), null, 'h の無い（1つ目の）スタンドも弾く');
  t = BJ.apply(t, { p: 0, t: 'stand', r: 0, h: 1 });
  assert.deepEqual([t.phase, t.outFin[0], t.out[0], t.points[0]], ['result', 20, 20, 120], '2つの手の合計（21で+20・17どうしで±0）');
  t = BJ.apply(sp([['s1', 'h1']], ['s10', 'h9'], ['c13', 'd5']), { p: 0, t: 'split', r: 0 });
  assert.deepEqual([t.phase, t.outFin[0], t.out[0]], ['result', 10, 0], 'A を分けたら1枚ずつで終わり・分けた21はブラックジャックではない（+10）');
  t = BJ.apply(sp([['s8', 'h8']], ['s10', 'h7'], ['c8', 'd2']), { p: 0, t: 'split', r: 0 });
  assert.equal(BJ.apply(t, { p: 0, t: 'split', r: 0 }), null, '分けるのは1回だけ');
}
// 配った時点のブラックジャック
let found = 0;
for (let seed = 1; seed < 400 && found < 2; seed++) {
  const t = BJ.init(1, seed);
  if (bjTotal(t.hands[0]).v === 21 && bjTotal(t.dealer).v !== 21) { found++; assert.deepEqual([t.phase, t.out[0], t.points[0]], ['result', 15, 115], 'ブラックジャックは1.5倍'); }
}
assert.ok(found, 'ブラックジャックの配りを見つけた');
let dealerBJ = 0;
for (let seed = 1; seed < 600 && !dealerBJ; seed++) {
  const t = BJ.init(2, seed);
  if (bjTotal(t.dealer).v === 21 && t.dealer.length === 2) { dealerBJ++; assert.equal(t.phase, 'result', '親がブラックジャックならすぐ終わり'); }
}
assert.ok(dealerBJ);
// CPU どうしで最後まで（進行役の「次へ」も足す）
for (let g = 0; g < 20; g++) {
  let st = BJ.init(1 + (g % 6), 300 + g, { rules: { rounds: [3, 5, 10][g % 3] } });
  let guard = 0;
  while (!BJ.result(st)) {
    const ref = BJ.referee(st);
    if (ref) st = BJ.apply(st, { p: -1, ...ref.move });
    else for (let p = 0; p < st.n; p++) if (BJ.canAct(st, p)) { st = BJ.apply(st, { p, ...BJ.cpu(st, p) }); assert.ok(st, 'ブラックジャックの CPU が反則を出した'); }
    assert.ok(++guard < 300);
  }
  assert.equal(st.round, st.rounds);
}
{
  const sur = (o = {}) => ({ ...bjState([['s10', 'h6'], ['d9', 'c9']], ['s9', 'h7'], ['c5', 's2', 'h10', 'd10']), surOn: true, ...o });
  assert.equal(BJ.apply({ ...sur(), surOn: false }, { p: 0, t: 'surrender', r: 0 }), null, 'サレンダーは詳細設定がオンのときだけ');
  let x = BJ.apply(sur(), { p: 0, t: 'surrender', r: 0 });
  assert.ok(x && x.done[0] && x.sur[0], 'サレンダーするとその回は終わり');
  assert.equal(BJ.apply(x, { p: 0, t: 'hit', r: 0, k: 2 }), null, 'サレンダーした後は引けない');
  x = BJ.apply(x, { p: 1, t: 'stand', r: 0 });
  assert.deepEqual([x.phase, x.out[0], x.points[0]], ['result', -5, 95], 'サレンダーは賭けの半分（5）を失う');
  const hit = BJ.apply(sur(), { p: 0, t: 'hit', r: 0, k: 2 });
  assert.equal(BJ.apply({ ...hit, done: [false, false] }, { p: 0, t: 'surrender', r: 0 }), null, '引いた後はサレンダーできない');
  const pair = { ...bjState([['s8', 'h8']], ['s9', 'h7'], ['c5', 's2', 'h10', 'd10']), surOn: true, splitOn: true };
  const sp = BJ.apply(pair, { p: 0, t: 'split', r: 0 });
  assert.equal(BJ.apply(sp, { p: 0, t: 'surrender', r: 0 }), null, 'スプリットした後はサレンダーできない');
  const onlySur = BJ.apply({ ...bjState([['s10', 'h6']], ['s10', 'h7'], ['c5']), surOn: true }, { p: 0, t: 'surrender', r: 0 });
  assert.deepEqual([onlySur.phase, onlySur.dealer.length], ['result', 2], '全員サレンダーなら親は引かない');
  // CPU: 16 で親が 10 なら（気まぐれの15%を除き）降りる
  let n = 0;
  const cpuSt = { ...bjState([['s10', 'h6']], ['s10', 'h7'], ['c5']), surOn: true };
  for (let i = 0; i < 200; i++) if (BJ.cpu(cpuSt, 0).t === 'surrender') n++;
  assert.ok(n > 140 && n < 200, 'CPU は16で親が10ならたいてい降りる ' + n);
  for (let i = 0; i < 50; i++) assert.notEqual(BJ.cpu({ ...bjState([['s10', 'h3']], ['s10', 'h7'], ['c5']), surOn: true }, 0).t, 'surrender', 'CPU は13では降りない');
}
console.log('blackjack OK');

// ---------- 海戦ゲーム ----------
const KS = GAMES.kaisen;
const { layout, randomShips, SHIPS: KSHIPS } = await import('../app/js/games/kaisen.js');
const fleet = [[0, 0, false], [2, 0, false], [4, 0, false], [6, 0, false], [8, 0, true]];
assert.ok(layout(fleet), '並べられる');
assert.equal(layout([[0, 6, false], ...fleet.slice(1)]), null, '盤からはみ出す');
assert.equal(layout([[0, 0, false], [0, 2, true], ...fleet.slice(2)]), null, '重なる');
assert.equal(layout(fleet.slice(1)), null, '5隻ぜんぶ');
for (let k = 0; k < 50; k++) assert.ok(layout(randomShips()), 'おまかせは必ず並べられる');
assert.ok(KS.noLocal, '同じ画面の2人は出さない');
s = KS.init();
assert.equal(KS.apply(s, 0), null, '並べる前は撃てない');
s = KS.apply(s, { t: 'place', ships: fleet });
assert.deepEqual([s.phase, s.turn], ['place', 1], '先手が並べたら後手');
s = KS.apply(s, { t: 'place', ships: fleet });
assert.deepEqual([s.phase, s.turn], ['fire', 0], '両方並べたら先手から撃つ');
s = KS.apply(s, 0);
assert.deepEqual([s.last.hit, s.turn], [true, 1], '当たっても相手の番');
assert.equal(KS.apply(s, 0) === null, false, '相手は同じマスを撃てる（自分の海とは別）');
s = KS.apply(s, 99);
assert.equal(KS.apply(s, 0), null, '同じマスは2回撃てない');
// 先手が後手の船を全部沈める（後手は外れのマスを撃ち続ける）
const shipCells = [];
layout(fleet).forEach((k, i) => { if (k >= 0) shipCells.push(i); });
let miss = 98;
let sunkSeen = 0;
for (const i of shipCells.slice(1)) {
  s = KS.apply(s, i);
  assert.ok(s, '撃てる');
  if (s.last.sunk !== null) sunkSeen++;
  if (!KS.result(s)) { while (layout(fleet)[miss] >= 0) miss--; s = KS.apply(s, miss--); }
}
assert.equal(sunkSeen, KSHIPS.length, '5隻とも沈めたことが分かる');
assert.deepEqual(KS.result(s), { winner: 0, cells: [] }, '全部沈めたら勝ち');
// CPU どうしで最後まで
for (let g = 0; g < 12; g++) {
  let st = KS.init();
  let guard = 0;
  const lv = ['weak', 'normal', 'strong'];
  while (!KS.result(st)) {
    st = KS.apply(st, KS.cpu(st, st.turn, { cpu: lv[(g + st.turn) % 3] }));
    assert.ok(st, '海戦ゲームの CPU が反則を出した');
    assert.ok(++guard < 210);
  }
}
// 当たったらもう一度（詳細設定）
assert.equal(KS.init().again, false, '最初は当たっても交代');
s = KS.init({ rules: { again: 'on' } });
s = KS.apply(KS.apply(s, { t: 'place', ships: fleet }), { t: 'place', ships: fleet });
s = KS.apply(s, 0);
assert.deepEqual([s.last.hit, s.turn], [true, 0], '当たったらもう一度');
s = KS.apply(s, 99);
assert.deepEqual([s.last.hit, s.turn], [false, 1], '外れたら相手の番');
s = KS.init({ rules: { again: 'on' } });
s = KS.apply(KS.apply(s, { t: 'place', ships: fleet }), { t: 'place', ships: fleet });
for (const i of shipCells) { assert.equal(s.turn, 0, '当たり続ける間は先手の番'); s = KS.apply(s, i); }
assert.deepEqual(KS.result(s), { winner: 0, cells: [] }, '当たり続けて全部沈めたら勝ち');
for (let g = 0; g < 12; g++) {
  let st = KS.init({ rules: { again: 'on' } });
  let guard = 0;
  while (!KS.result(st)) {
    st = KS.apply(st, KS.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][g % 3] }));
    assert.ok(st, '当たったらもう一度で CPU が反則を出した');
    assert.ok(++guard < 210);
  }
}
// ソナー（詳細設定）
assert.equal(KS.init().sonarOn, false, '最初はソナーなし');
s = KS.init();
s = KS.apply(KS.apply(s, { t: 'place', ships: fleet }), { t: 'place', ships: fleet });
assert.equal(KS.apply(s, { t: 'sonar', c: 11 }), null, 'ソナーなしでは使えない');
s = KS.init({ rules: { sonar: 'on' } });
assert.equal(KS.apply(s, { t: 'sonar', c: 11 }), null, '並べる前は使えない');
s = KS.apply(KS.apply(s, { t: 'place', ships: fleet }), { t: 'place', ships: fleet });
s = KS.apply(s, 0); // 先手が (0,0) を撃って当たり
s = KS.apply(s, 99);
let sn = KS.apply(s, { t: 'sonar', c: 11 }); // (1,1) のまわり 3×3: 0段目 0〜2・1段目 0〜2・2段目 0〜2
assert.ok(sn, 'ソナーを使える');
assert.deepEqual([sn.last.n, sn.turn], [5, 1], '撃ったマスを除いて船のマスを数える（0段目の1・2、2段目の0〜2）・使ったら相手の番');
assert.equal(sn.sonar[0].cells.includes(0), false, '撃ったマスは数えない');
sn = KS.apply(sn, 98);
assert.equal(KS.apply(sn, { t: 'sonar', c: 55 }), null, 'ソナーは1回だけ');
assert.ok(KS.apply(sn, { t: 'sonar', c: 55 }) === null && KS.apply(KS.apply(sn, 50), { t: 'sonar', c: 0 }), '相手は自分のソナーを使える（盤の隅でもよい）');
assert.equal(KS.apply(KS.apply(sn, 50), { t: 'sonar', c: 0 }).last.n, 2, '盤の隅は 2×2 だけ調べる（先手の (0,0) は後手がまだ撃っていない）');
assert.equal(KS.apply(sn, { t: 'sonar', c: 100 }), null, '盤の外は選べない');
s = KS.init({ rules: { sonar: 'on', again: 'on' } });
s = KS.apply(KS.apply(s, { t: 'place', ships: fleet }), { t: 'place', ships: fleet });
assert.equal(KS.apply(s, { t: 'sonar', c: 11 }).turn, 1, '当たったらもう一度でも、ソナーのあとは相手の番');
let sonarUsed = 0;
for (let g = 0; g < 30; g++) {
  let st = KS.init({ rules: { sonar: 'on', again: g % 2 ? 'on' : 'off' } });
  let guard = 0;
  while (!KS.result(st)) {
    const m = KS.cpu(st, st.turn, { cpu: ['weak', 'normal', 'strong'][g % 3] });
    if (m?.t === 'sonar') sonarUsed++;
    st = KS.apply(st, m);
    assert.ok(st, 'ソナーありで CPU が反則を出した');
    assert.ok(++guard < 220);
  }
}
assert.ok(sonarUsed >= 40, 'CPU もソナーを使う: ' + sonarUsed);
console.log('kaisen OK');

// ---------- 弾幕回避 ----------
{
  const D = GAMES.danmaku;
  const DM = await import('../app/js/games/danmaku.js');
  assert.deepEqual(DM.makeBullets(7, 60), DM.makeBullets(7, 60), '弾の出方は種から同じに作る');
  assert.notDeepEqual(DM.makeBullets(7, 60).slice(0, 5), DM.makeBullets(8, 60).slice(0, 5));
  // 難しさ: ふつうは前と同じ弾幕。やさしい < ふつう < むずかしい の順に弾が多い
  assert.deepEqual(DM.makeBullets(7, 60, 'normal'), DM.makeBullets(7, 60), '難しさを書かなければ ふつう');
  assert.equal(DM.makeBullets(7, 90).length, 1606, 'ふつうの弾の数が前と変わった（種 7・90秒）');
  assert.equal(DM.makeBullets(7, 90).reduce((x, b) => x + b.t + b.x + b.y + b.vx + b.vy, 0).toFixed(6), '102059.256123', 'ふつうの弾の出方・速さが前と変わった');
  const cnt = ['easy', 'normal', 'hard'].map((lv) => DM.makeBullets(7, 90, lv).length);
  assert.ok(cnt[0] < cnt[1] && cnt[1] < cnt[2], '難しさの順に弾が多い ' + cnt);
  assert.equal(D.init(2, 1).rules.level, 'normal', '最初は ふつう');
  const run = (st, ms) => ms.reduce((x, m) => { const y = D.apply(x, m); assert.ok(y, JSON.stringify(m)); return y; }, st);
  let d = run(D.init(3, 5, { rules: { time: '60' } }), [{ p: -1, t: 'go' }]);
  assert.equal(D.apply(d, { p: 0, t: 'hit', ms: 61000 }), null, '時間より後には当たれない');
  d = run(d, [{ p: 0, t: 'hit', ms: 12000 }]);
  assert.equal(D.apply(d, { p: 0, t: 'hit', ms: 13000 }), null, '2回は脱落しない');
  assert.equal(D.apply(d, { p: 1, t: 'last', ms: 20000 }), null, 'まだ2人残っているときは last を出せない');
  d = run(d, [{ p: 2, t: 'hit', ms: 30000 }]);
  assert.equal(D.apply(d, { p: 1, t: 'last', ms: 29000 }), null, 'ほかの人より短いうちは last を出せない');
  d = run(d, [{ p: 1, t: 'last', ms: 30500 }]);
  assert.deepEqual(D.result(d).winners, [1], '最後の1人が勝ち');
  let e = run(D.init(2, 5), [{ p: -1, t: 'go' }, { p: 0, t: 'hit', ms: 5000 }, { p: 1, t: 'hit', ms: 9000 }]);
  assert.deepEqual(D.result(e).winners, [1], '全員当たったら長くもった人の勝ち');
  e = run(D.init(3, 5), [{ p: -1, t: 'go' }, { p: 0, t: 'hit', ms: 5000 }, { p: -1, t: 'end' }]);
  assert.deepEqual(D.result(e).winners, [1, 2], '時間まで残った人は全員1位');
}

// ---------- 玉入れ ----------
{
  const T = GAMES.tamaire;
  const run = (st, ms) => ms.reduce((x, m) => { const y = T.apply(x, m); assert.ok(y, JSON.stringify(m)); return y; }, st);
  let t = run(T.init(4, 3), [{ p: -1, t: 'go' }, { p: 0, t: 'in', n: 3 }, { p: 1, t: 'in', n: 2 }, { p: 3, t: 'in', n: 2 }]);
  assert.equal(T.apply(t, { p: 0, t: 'in', n: 3 }), null, '同じ合計は2回受け付けない');
  assert.equal(T.apply(t, { p: 0, t: 'in', n: 2 }), null, '減らない');
  assert.equal(T.apply(t, { p: 0, t: 'in', n: 40 }), null, '一度に増えすぎる数は弾く');
  t = run(t, [{ p: 2, t: 'in', n: 2 }, { p: -1, t: 'end' }]);
  assert.equal(T.apply(t, { p: 0, t: 'in', n: 9 }), null, '終わったあとは入らない');
  const r = T.result(t);
  assert.deepEqual(r.teams, [5, 4], '偶数の席が赤、奇数の席が白');
  assert.deepEqual(r.winners, [0, 2], '赤チームの勝ち');
  t = run(T.init(2, 3), [{ p: -1, t: 'go' }, { p: 0, t: 'in', n: 1 }, { p: 1, t: 'in', n: 1 }, { p: -1, t: 'end' }]);
  assert.equal(T.result(t).draw, true, '同じ数なら引き分け');
  const TM = await import('../app/js/games/tamaire.js');
  const fly = (x, vx, vy) => { const b = { x, y: TM.H - 0.16, ...TM.launch(vx, vy) }; let q = null; for (let i = 0; i < 2400 && !q; i++) q = TM.stepBall(b, 1 / 240); return q; };
  assert.equal(fly(0.15, 0.15, -3.85), 'in', '横から弧を描いて投げると入る');
  assert.notEqual(fly(0.5, 0, -3.5), 'in', 'カゴの真下からは入らない');
  // 動くカゴ
  assert.equal(TM.rimX(false, 1.5), 0.5, '止まっているカゴは真ん中');
  assert.equal(TM.rimX(true, 0), 0.5, '動くカゴも始まりは真ん中');
  assert.ok(Math.abs(TM.rimX(true, 1.5) - 0.7) < 1e-9 && Math.abs(TM.rimX(true, 4.5) - 0.3) < 1e-9, '左右に幅の2割ずつ・6秒で1往復');
  const flyAt = (rx, x, vx, vy) => { const b = { x, y: TM.H - 0.16, ...TM.launch(vx, vy) }; let q = null; for (let i = 0; i < 2400 && !q; i++) q = TM.stepBall(b, 1 / 240, rx); return q; };
  assert.equal(flyAt(0.5, 0.15, 0.15, -3.85), 'in');
  assert.notEqual(flyAt(0.7, 0.15, 0.15, -3.85), 'in', 'カゴが動くと同じ投げ方では入らない');
  assert.equal(flyAt(0.7, 0.35, 0.15, -3.85), 'in', 'カゴと一緒にずらして投げれば入る');
  assert.equal(T.init(2, 1).rules.move, 'stay', '最初は止まっている');
}

// ---------- 間違い探し ----------
{
  const G = GAMES.machigai;
  const MG = await import('../app/js/games/machigai.js');
  const sc = MG.makeScene(11, 0, 5);
  assert.deepEqual(sc, MG.makeScene(11, 0, 5), '絵は種から同じに作る');
  assert.equal(sc.diffs.length, 5);
  assert.equal(new Set(sc.diffs.map((x) => x.item)).size, 5, '違いは別々の部品');
  for (const x of sc.diffs) assert.notDeepEqual(sc.left[x.item], sc.right[x.item], '違いの部品は右の絵で変わっている');
  const same = sc.left.filter((_, i) => !sc.diffs.some((x) => x.item === i));
  assert.ok(same.every((it) => sc.right.some((r) => JSON.stringify(r) === JSON.stringify(it))), 'ほかの部品は同じ');
  const [hx, hy] = sc.diffs[2].hit[0];
  assert.equal(MG.diffAt(sc, hx, hy), 2, '違いの場所を押すと当たる');
  const run = (st, ms) => ms.reduce((x, m) => { const y = G.apply(x, m); assert.ok(y, JSON.stringify(m)); return y; }, st);
  let g = run(G.init(2, 11, { rules: { rounds: '3', diffs: '3', time: '45' } }), [{ p: -1, t: 'go' }, { p: 0, t: 'find', r: 0, i: 1, ms: 5000 }]);
  assert.equal(G.apply(g, { p: 0, t: 'find', r: 0, i: 1, ms: 4000 }), null, '同じ人が同じ違いを2回は押せない');
  assert.equal(G.apply(g, { p: 1, t: 'find', r: 1, i: 0, ms: 4000 }), null, 'まだ出ていない絵は押せない');
  g = run(g, [{ p: 1, t: 'find', r: 0, i: 1, ms: 4500 }]);
  assert.deepEqual(MG.scoresOf(g), [0, 1], '同じ違いは速い人の点（届いた順ではない）');
  const slow = G.apply(g, { p: 1, t: 'find', r: 0, i: 0, ms: 9000 });
  assert.deepEqual(MG.scoresOf(G.apply(slow, { p: 0, t: 'find', r: 0, i: 0, ms: 9500 })), [0, 2], 'あとから遅い記録が届いても取られない');
  assert.equal(G.referee(g).key, 'play0');
  g = run(g, [{ p: 0, t: 'find', r: 0, i: 0, ms: 7000 }, { p: 0, t: 'find', r: 0, i: 2, ms: 8000 }]);
  assert.equal(G.referee(g).key, 'all0', '全部見つかったら早めに次へ');
  for (let r = 0; r < 3; r++) {
    if (r > 0) g = run(g, [{ p: -1, t: 'next' }]);
    else g = run(g, [{ p: -1, t: 'next' }]);
    assert.equal(g.phase, 'show');
    g = run(g, [{ p: -1, t: 'go' }]);
  }
  assert.equal(g.phase, 'end', '3枚目の答えのあとで終わる');
  assert.deepEqual(G.result(g).winners, [0]);
}

// ---------- 2色爆弾サバイバル ----------
{
  const B = GAMES.bombs;
  const BM = await import('../app/js/games/bombs.js');
  const run = (st, ms) => ms.reduce((x, m) => { const y = B.apply(x, m); assert.ok(y, JSON.stringify(m)); return y; }, st);
  let b = run(B.init(3, 21), [{ p: -1, t: 'go' }, { p: 0, t: 'boom', n: 1 }]);
  assert.equal(B.apply(b, { p: 0, t: 'boom', n: 1 }), null, '同じ爆発は2回数えない');
  assert.equal(B.apply(b, { p: 0, t: 'send', n: 1, k: 7 }), null, '送れるのは5か10');
  const to = BM.targetOf(b, 0);
  b = run(b, [{ p: 0, t: 'send', n: 1, k: 10 }]);
  assert.ok(to === 1 || to === 2, '自分には送らない');
  assert.equal(b.inc[to], 10, '選ばれた相手に届く');
  b = run(b, [{ p: 1, t: 'boom', n: 1 }, { p: 1, t: 'boom', n: 2 }, { p: 1, t: 'boom', n: 3 }]);
  assert.equal(b.out[1], 0, '3回で脱落');
  assert.equal(B.apply(b, { p: 1, t: 'send', n: 1, k: 5 }), null, '脱落した人は送れない');
  for (let i = 0; i < 10; i++) assert.equal(BM.targetOf({ ...b, step: b.step + i }, 0), 2, '脱落した人には送らない');
  assert.equal(B.result(b), null);
  b = run(b, [{ p: 2, t: 'boom', n: 1 }, { p: 2, t: 'boom', n: 2 }, { p: 2, t: 'boom', n: 3 }]);
  assert.deepEqual(B.result(b).winners, [0], '最後まで残った人の勝ち');
  assert.deepEqual(B.result(b).ranking, [0, 2, 1], 'あとで脱落した人ほど上');
  // ライフ
  b = run(B.init(2, 5, { rules: { lives: '1' } }), [{ p: -1, t: 'go' }, { p: 0, t: 'boom', n: 1 }]);
  assert.equal(b.out[0], 0, 'ライフ1なら1回で脱落');
  assert.deepEqual(B.result(b).winners, [1]);
  b = run(B.init(2, 5, { rules: { lives: '5' } }), [{ p: -1, t: 'go' }, ...[1, 2, 3, 4].map((n) => ({ p: 0, t: 'boom', n }))]);
  assert.equal(b.out[0], null, 'ライフ5なら4回では残る');
  b = run(b, [{ p: 0, t: 'boom', n: 5 }]);
  assert.equal(b.out[0], 0, 'ライフ5なら5回で脱落');
  assert.equal(B.init(2, 5).lives, 3, '最初はライフ3');
  assert.equal(B.init(2, 5, { rules: { lives: '9' } }).lives, 3, 'おかしな数は3');
  // 速さ: 曲線のどこから始めるかだけが違い、いちばん忙しい所は同じ
  const lv = (speed, t) => BM.levelOf(B.init(2, 5, { rules: { speed } }), t);
  assert.ok(BM.spawnGap(lv('slow', 0)) > BM.spawnGap(lv('normal', 0)) && BM.spawnGap(lv('normal', 0)) > BM.spawnGap(lv('fast', 0)), '始まりの間は ゆっくり > ふつう > はやい');
  assert.equal(BM.spawnGap(lv('normal', 0)), 1.5, 'ふつうの始まりは前と同じ');
  for (const sp of ['slow', 'normal', 'fast']) {
    assert.equal(BM.spawnGap(lv(sp, 600)), 0.55, `${sp}: いちばん短い間は同じ`);
    assert.equal(BM.spawnCount(lv(sp, 600), 0), 3, `${sp}: 一度に出る数の上限は同じ`);
    assert.equal(BM.spawnCount(lv(sp, 600), 0.99), 1);
  }
  assert.equal(BM.spawnCount(lv('normal', 30), 0), 1, 'ふつうの始めは1個ずつ');
  assert.equal(BM.spawnCount(lv('fast', 30), 0), 2, 'はやいは早くから2個がまざる');
  // CPU の盤も同じ出方（はやいほど早くあふれる）
  const { mulberry32 } = await import('../app/js/games/util.js');
  const boomAt = (speed) => {
    const c = { t: 0, nextSpawn: 0, start: lv(speed, 0), q: [], consumed: 0, handleAt: 1, box: [[0, 0], [0, 0]], events: [] };
    const rnd = mulberry32(7);
    for (let t = 1; t <= 400; t++) { BM.cpuAdvance(c, t, 0, rnd); if (c.events.includes('boom')) return t; }
    return 400;
  };
  assert.ok(boomAt('slow') > boomAt('normal') && boomAt('normal') > boomAt('fast'), 'CPU が初めて爆発させるのは はやいほど早い');
  console.log('bombs first CPU boom (s) slow/normal/fast', boomAt('slow'), boomAt('normal'), boomAt('fast'));
}

// 遊び方: どのゲームにもあり、長くしない（1つ4行まで）
const { GAME_ORDER } = await import('../app/js/games/index.js');
for (const id of GAME_ORDER) {
  const h = GAMES[id].howto;
  assert.ok(Array.isArray(h) && h.length >= 1 && h.length <= 4 && h.every((x) => typeof x === 'string' && x), `${id} の遊び方（1〜4行）`);
}

console.log('ALL OK');
