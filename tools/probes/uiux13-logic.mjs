// 2026-11-26 の UI・UX の13回目で足した、画面に頼らない部分の確認（node tools/probes/uiux13-logic.mjs。数秒。tools/test-logic.mjs からも流す）。
//   10を作れの mergeSteps（答えの例を2枚ずつ合わせる順）・15パズル／迷路／一筆書きの seqs・paths（答えを見せる間の早送りの元）・将棋の mateWhy（詰みの理由）。
import assert from 'node:assert/strict';
import { PUZZLES, mergeSteps } from '../../app/js/games/make10.js';
import slide, { replay, isSolved, undoPath, routeOf } from '../../app/js/games/slide.js';
import meiro, { walk, solve } from '../../app/js/games/meiro.js';
import hitofude, { isTrail, eulerPath } from '../../app/js/games/hitofude.js';
import { _test as SG } from '../../app/js/games/shogi.js';

// 10を作れ: どの問題の答えの例も、残っている2枚を3回合わせて、最後に10の札が1枚残る
for (const p of PUZZLES) {
  const st = mergeSteps(p.nums, p.ex);
  assert.equal(st.length, 3, `10を作れ: 3回で合わさる（${p.ex}）`);
  const alive = new Set([0, 1, 2, 3]);
  for (const x of st) {
    assert.ok(alive.has(x.a) && alive.has(x.b) && x.a !== x.b, `10を作れ: 残っている2枚を合わせる（${p.ex}）`);
    alive.delete(x.a);
    alive.delete(x.b);
    alive.add(x.id);
  }
  assert.equal(alive.size, 1);
  assert.deepEqual(st[2].v, [10, 1], `10を作れ: 最後は10の札（${p.ex}）`);
}
assert.deepEqual(mergeSteps([1, 1, 9, 9], 'zzz'), [], '10を作れ: 読めない式は合わせない');

// 15パズル: そろえた人の動かし方（seqs）が残り、いちばん速かった人の分をその問題の盤に当て直すとそろう。次の問題では空に戻す
{
  let s = slide.apply(slide.init(3, 2, { rules: {} }), { p: -1, t: 'next' });
  const b = s.qs[0].board;
  const seq = undoPath(s.qs[0].path);
  // 遅かった人は、1手動かして戻すむだの入った別の動かし方（早送りがだれの分かを見分けるため。2026-11-26 の Codex の点検）
  const slow = ['U', 'D', 'L', 'R'].map((d) => d + undoPath(d) + seq).find((x) => { const e = replay(b, 4, x); return e && isSolved(e); });
  assert.ok(slow && slow !== seq);
  s = slide.apply(s, { p: 1, t: 'done', q: 0, seq: slow, ms: 9000 });
  s = slide.apply(s, { p: 2, t: 'done', q: 0, seq, ms: 4000 });
  s = slide.apply(s, { p: 0, t: 'pass', q: 0 });
  assert.deepEqual(s.seqs, [null, slow, seq], '15パズル: そろえた人の動かし方が残る');
  s = slide.apply(s, { p: -1, t: 'close' });
  assert.equal(s.phase, 'shown');
  assert.deepEqual(s.last.winners, [2]);
  assert.equal(routeOf(s), seq, '15パズル: 早送りするのはいちばん速かった人の動かし方');
  assert.ok(isSolved(replay(b, 4, routeOf(s))), '15パズル: 速かった人の動かし方でそろう');
  s = slide.apply(s, { p: -1, t: 'next' });
  assert.deepEqual(s.seqs, [null, null, null], '15パズル: 次の問題で動かし方を空に戻す');
}

// 迷路: ゴールした人の通った道（seqs）が残り、その道でゴールに着く
{
  let s = meiro.apply(meiro.init(2, 31, { rules: { level: 's' } }), { p: -1, t: 'next' });
  const seq = solve(s.qs[0], s.size);
  s = meiro.apply(s, { p: 1, t: 'done', q: 0, seq, ms: 5000 });
  assert.deepEqual(s.seqs, [null, seq], '迷路: ゴールした人の道が残る');
  assert.equal(walk(s.qs[0], s.size, s.seqs[1]), s.size * s.size - 1, '迷路: 残った道でゴールに着く');
  s = meiro.apply(meiro.apply(s, { p: -1, t: 'close' }), { p: -1, t: 'next' });
  assert.deepEqual(s.seqs, [null, null], '迷路: 次の問題で道を空に戻す');
}

// 一筆書き: 描けた人の描き順（paths）が残り、その図の一筆書きになっている。写しなので、送った手の配列を書き換えても変わらない
{
  let s = hitofude.apply(hitofude.init(2, 4, { rules: {} }), { p: -1, t: 'next' });
  const path = eulerPath(s.qs[0]);
  const sent = path.slice();
  s = hitofude.apply(s, { p: 0, t: 'done', q: 0, path: sent, ms: 2000 });
  sent.reverse();
  assert.deepEqual(s.paths[0], path, '一筆書き: 描けた人の描き順が残る（写し）');
  assert.ok(isTrail(s.qs[0], s.paths[0]), '一筆書き: 残った描き順が一筆書き');
  assert.equal(s.paths[1], null);
  s = hitofude.apply(hitofude.apply(s, { p: -1, t: 'close' }), { p: -1, t: 'next' });
  assert.deepEqual(s.paths, [null, null], '一筆書き: 次の問題で描き順を空に戻す');
}

// 将棋の詰みの理由: 頭金（後手玉 5一・先手金 5二・先手歩 5三）。金に利いている歩が「取れない理由」
const hands = () => [Array(8).fill(0), Array(8).fill(0)];
{
  const b = Array(81).fill(0);
  b[4] = -8;
  b[13] = 5;
  b[22] = 1;
  assert.equal(SG.legalMoves(b, hands(), 1).length, 0, '頭金: 詰んでいる');
  const why = SG.mateWhy(b, 4, 1);
  assert.deepEqual(why.lines.map((x) => x.from), [13], '頭金: 王手は金から');
  const nogo = Object.fromEntries(why.nogo.map((x) => [x.sq, x.from]));
  assert.deepEqual(nogo, { 3: [13], 5: [13], 12: [13], 13: [22], 14: [13] }, '頭金: 逃げられないマスと、そこに利いている駒');
}
// 横から飛車で王手（後手玉 5一・先手飛 9一・先手金 5三）: 玉の後ろ（4一）も、玉をどかした盤で飛車が利いているので ×
{
  const b = Array(81).fill(0);
  b[4] = -8;
  b[0] = 7;
  b[22] = 5;
  assert.equal(SG.legalMoves(b, hands(), 1).length, 0, '飛車の王手: 詰んでいる');
  const why = SG.mateWhy(b, 4, 1);
  assert.deepEqual(why.lines, [{ from: 0, between: [3, 2, 1] }], '飛車の王手: 線と間のマス');
  const nogo = Object.fromEntries(why.nogo.map((x) => [x.sq, x.from]));
  assert.deepEqual(nogo, { 3: [0], 5: [0], 12: [22], 13: [22], 14: [22] }, '飛車の王手: 玉の後ろも飛車が利いている');
}
// 自分の駒がいるマスには × を付けない
{
  const b = Array(81).fill(0);
  b[4] = -8;
  b[3] = -5;
  b[13] = 5;
  b[22] = 1;
  const why = SG.mateWhy(b, 4, 1);
  assert.ok(!why.nogo.some((x) => x.sq === 3), '自分の駒のマスは除く');
}

console.log('uiux13 OK');
