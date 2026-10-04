// 盤のゲームの CPU の自動確認。使い方: node tools/test-cpu.mjs
// 反則の手を出さない・強さの順番どおりに勝ち越す・「つよい」のマルバツは負けない・1手にかかる時間 を確かめる。
import assert from 'node:assert/strict';
const { GAMES } = await import('../app/js/games/index.js');
const { tictactoe: T, connect4: C, reversi: R } = GAMES;
const lv = (cpu) => ({ cpu });

// a（先手）と b（後手）の強さで1局打って、勝った側（0 / 1 / null）を返す。1手の最長時間も記録する
let slowest = { ms: 0, id: '' };
function duel(g, a, b) {
  let s = g.init();
  let n = 0;
  while (!g.result(s)) {
    const p = g.turn(s);
    const t0 = performance.now();
    const m = g.cpu(s, p, lv(p === 0 ? a : b));
    const ms = performance.now() - t0;
    if (ms > slowest.ms) slowest = { ms, id: `${g.id}:${p === 0 ? a : b}` };
    const next = g.apply(s, m);
    assert.ok(next, `${g.id} の CPU（${p === 0 ? a : b}）が反則の手 ${m} を出した`);
    s = next;
    if (++n > 100) throw new Error(g.id + ' が終わらない');
  }
  return g.result(s).winner;
}

// 決まった局面での判断
let s = T.init();
for (const m of [0, 3, 1, 4]) s = T.apply(s, m); // ○ が 0・1、× が 3・4。○ の番
for (let k = 0; k < 20; k++) assert.equal(T.cpu(s, 0, lv('strong')), 2, 'マルバツ: 勝てる手があれば打つ');
s = T.init();
for (const m of [0, 3, 8, 4]) s = T.apply(s, m); // × が 3・4 で、5 に打たれると負け
for (let k = 0; k < 20; k++) assert.equal(T.cpu(s, 0, lv('strong')), 5, 'マルバツ: 負けそうなら止める');
s = C.init();
for (const m of [0, 6, 0, 6, 0]) s = C.apply(s, m); // 赤が0列に3つ。黄の番
for (let k = 0; k < 10; k++) assert.equal(C.cpu(s, 1, lv('strong')), 0, 'コネクトフォー: 縦4を止める');
s = C.init();
for (const m of [3, 0, 3, 0, 3, 6]) s = C.apply(s, m); // 赤が3列に3つ。赤の番
for (let k = 0; k < 10; k++) assert.equal(C.cpu(s, 0, lv('strong')), 3,'コネクトフォー: 勝てる手は打つ');

// マルバツの「つよい」は負けない
const tally = (g, a, b, n) => {
  const r = { win: 0, lose: 0, draw: 0 };
  for (let k = 0; k < n; k++) {
    // 先手と後手を交互に入れ替える
    const w = k % 2 ? duel(g, b, a) : duel(g, a, b);
    const aSide = k % 2 ? 1 : 0;
    if (w === null) r.draw++; else if (w === aSide) r.win++; else r.lose++;
  }
  return r;
};
let r = tally(T, 'strong', 'weak', 60);
assert.equal(r.lose, 0, 'マルバツ: つよいは よわい に負けない');
r = tally(T, 'strong', 'strong', 10);
assert.equal(r.draw, 10, 'マルバツ: つよい同士は必ず引き分け');
const results = { tictactoe: tally(T, 'normal', 'weak', 60) };

// スーパーマルバツ: 反則を出さない・強さの順に勝ち越す・1手の時間
const TS = { ...T, id: 'tictactoe9', init: () => T.init({ rules: { size: 'super' } }) };
s = TS.init();
s = { ...s, board: Object.assign(Array(81).fill(null), { 36: 0, 37: 0 }), next: 4 };
for (let k = 0; k < 10; k++) assert.equal(TS.cpu(s, 0, lv('strong')), 38, 'スーパーマルバツ: 小さい盤を取れる手を打つ');

// 強い方が勝ち越す
for (const [g, n] of [[C, 20], [R, 12], [TS, 12]]) {
  const sw = tally(g, 'strong', 'weak', n);
  const nw = tally(g, 'normal', 'weak', n);
  results[g.id] = { strongVsWeak: sw, normalVsWeak: nw };
  assert.ok(sw.win > sw.lose * 2, `${g.id}: つよいが よわい に大きく勝ち越す ${JSON.stringify(sw)}`);
  assert.ok(nw.win > nw.lose, `${g.id}: ふつうが よわい に勝ち越す ${JSON.stringify(nw)}`);
}
// 3〜4人のマルバツ: 勝てる手を打つ・次の人の勝ちをふさぐ・つよい1人が よわい2人より多く勝つ
{
  const rules3 = { players: 3 };
  let w = { ...T.init({ rules: rules3 }) };
  w = { ...w, board: Object.assign(Array(25).fill(null), { 0: 0, 1: 0, 10: 1, 11: 1 }), turn: 0 };
  for (let k = 0; k < 10; k++) assert.equal(T.cpu(w, 0, lv('strong')), 2, '3人マルバツ: 並べられる所に置く');
  // × が 6・18 にあり、真ん中の 12 に置かれると ななめに3つ。点数の計算だけでは別のマスを選ぶ局面（機械で探した）
  w = { ...w, board: Object.assign(Array(25).fill(null), { 3: 0, 5: 0, 6: 1, 18: 1, 0: 2, 8: 2 }), turn: 0 };
  for (let k = 0; k < 10; k++) assert.equal(T.cpu(w, 0, lv('strong')), 12, '3人マルバツ: 次の人の3つ目をふさぐ');
  for (const [n, wide] of [[3, 'auto'], [4, 'auto'], [3, '9-3']]) {
    const G = 150;
    let strongWins = 0;
    for (let g = 0; g < G; g++) {
      const seat = g % n; // つよいの席を回す
      let x = T.init({ rules: { players: n, wide } });
      let guard = 0;
      while (!T.result(x)) {
        const m = T.cpu(x, x.turn, { players: n, wide, cpu: x.turn === seat ? 'strong' : 'weak' });
        x = T.apply(x, m);
        assert.ok(x, '3人マルバツ: 反則を出さない');
        assert.ok(++guard <= 81);
      }
      if (T.result(x).winner === seat) strongWins++;
    }
    results['tictactoe' + n + ':' + wide] = { strongWinRate: Math.round(strongWins / G * 100) + '%' };
    assert.ok(strongWins / G > 1.5 / n, `${n}人マルバツ(${wide}): つよいが よわい より多く勝つ ${strongWins}/${G}`);
  }
}
// 3〜4人のコネクトフォー: 勝てる手を打つ・次の人の4つ目をふさぐ・上に乗せられて負ける所へ落とさない・つよい1人が よわい2人より多く勝つ
{
  const base = C.init({ rules: { players: 3 } }); // 9列×7段。下の段はマス 54〜62
  const at = (o) => ({ ...base, grid: Object.assign(Array(63).fill(null), o), turn: 0 });
  let w = at({ 54: 0, 55: 0, 56: 0, 60: 1, 61: 2 });
  for (let k = 0; k < 10; k++) assert.equal(C.cpu(w, 0, lv('strong')), 3, '3人コネクトフォー: 並べられる所に落とす');
  // 次の人（黄）が 3列目、その次（緑）が 8列目で並べられる。先に番が来る黄をふさぐ
  w = at({ 54: 1, 55: 1, 56: 1, 62: 2, 53: 2, 44: 2, 58: 0, 59: 0 });
  for (let k = 0; k < 10; k++) assert.equal(C.cpu(w, 0, lv('strong')), 3, '3人コネクトフォー: 次の人の4つ目をふさぐ');
  // 5列目に落とすと、その上に黄が乗せて並ぶ。点数の計算だけでは5列目を選ぶ局面（機械で探した）
  w = at({ 39: 0, 40: 1, 43: 2, 48: 1, 49: 0, 50: 2, 52: 1, 53: 2, 54: 1, 56: 1, 57: 0, 58: 2, 59: 2, 61: 0, 62: 0 });
  for (let k = 0; k < 20; k++) assert.notEqual(C.cpu(w, 0, lv('strong')), 5, '3人コネクトフォー: 上に乗せられて負ける所へ落とさない');
  for (const n of [3, 4]) {
    const G = 150;
    let strongWins = 0;
    for (let g = 0; g < G; g++) {
      const seat = g % n; // つよいの席を回す
      let x = C.init({ rules: { players: n } });
      let guard = 0;
      while (!C.result(x)) {
        const t0 = performance.now();
        const m = C.cpu(x, x.turn, { players: n, cpu: x.turn === seat ? 'strong' : 'weak' });
        const ms = performance.now() - t0;
        if (ms > slowest.ms) slowest = { ms, id: 'connect4-' + n };
        x = C.apply(x, m);
        assert.ok(x, n + '人コネクトフォー: 反則を出さない');
        assert.ok(++guard <= 99);
      }
      if (C.result(x).winner === seat) strongWins++;
    }
    results['connect4-' + n] = { strongWinRate: Math.round(strongWins / G * 100) + '%' };
    assert.ok(strongWins / G > 1.5 / n, `${n}人コネクトフォー: つよいが よわい より多く勝つ ${strongWins}/${G}`);
  }
}

assert.ok(slowest.ms < 2000, `CPU の1手が遅すぎる（${slowest.id} ${Math.round(slowest.ms)}ms）`);
console.log('results', JSON.stringify(results));
console.log('slowest move', slowest.id, Math.round(slowest.ms) + 'ms');
console.log('ALL OK');
