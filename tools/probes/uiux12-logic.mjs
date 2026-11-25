// 2026-11-25 の UI・UX の12回目で足した、画面に頼らない部分の確認（node tools/probes/uiux12-logic.mjs。数秒）。
//   ヨットの cutin（役の名前を大きく出す）・見えない鬼ごっこの hist（通った道）・お絵描き当ての history の strokes（絵のふりかえり）。
import assert from 'node:assert/strict';
import yacht from '../../app/js/games/yacht.js';
import oni from '../../app/js/games/oni.js';
import oekaki, { encode } from '../../app/js/games/oekaki.js';

// ヨット: 出目を直に置いた局面で score の手を当て、cutin の返す字を見る
{
  const s0 = yacht.init(2, 1, {});
  const withDice = (dice) => { const s = structuredClone(s0); s.pl[0].dice = dice; s.pl[0].rolls = 1; return s; };
  const cut = (dice, cat) => { const a = withDice(dice); const m = { p: 0, t: 'score', r: a.round, cat }; const b = yacht.apply(a, m); assert.ok(b, '手が通る'); return yacht.cutin(a, b, m, 0); };
  assert.equal(cut([4, 4, 4, 4, 4], 11).text, 'ヨット！ 50点');
  assert.equal(cut([1, 2, 3, 4, 5], 10).text, 'Bストレート！ 30点');
  assert.equal(cut([2, 2, 3, 3, 3], 8).text, 'フルハウス！ 13点');
  assert.equal(cut([1, 2, 3, 4, 6], 10), null, '0点の役は出さない');
  assert.equal(cut([6, 6, 6, 1, 2], 5), null, '1〜6 は出さない');
  assert.equal(cut([6, 6, 6, 1, 2], 6), null, 'チョイスは出さない');
}

// 見えない鬼ごっこ: CPU どうしで最後まで打たせ、hist が trail と同じ長さで、最後の hist がつかまる前の位置になっている
{
  let s = oni.init(3, 7, {});
  for (let i = 0; i < 400 && s.phase !== 'end'; i++) {
    let moved = false;
    for (let p = 0; p < s.n && !moved; p++) {
      const m = oni.cpu(s, p);
      if (!m) continue;
      const t = oni.apply(s, { ...m, p });
      if (t) { s = t; moved = true; }
    }
    assert.ok(moved, '手が進む');
  }
  assert.equal(s.phase, 'end');
  assert.equal(s.hist.length, s.trail.length);
  for (const x of s.caught) assert.equal(s.hist[x.k][x.p], x.at, 'つかまった手の位置が hist にある');
  for (const h of s.hist) assert.equal(h.length, s.n);
}

// お絵描き当て: 1回描いてあきらめると、history にその回の線が残り、次の回の線と混ざらない
{
  let s = oekaki.init(2, 3, {});
  const d = encode([[100, 100], [500, 500]]);
  const drawer = s.turn;
  s = oekaki.apply(s, { p: drawer, t: 'line', g: 0, c: 0, w: 1, d, k: s.dn });
  assert.ok(s, '線が通る');
  const s1 = oekaki.apply(s, { p: drawer, t: 'giveup', k: s.dn });
  assert.equal(s1.history.length, 1);
  assert.equal(s1.history[0].strokes.length, 1);
  assert.equal(s.history.length, 0, '前の局面の history を書き換えない');
  const s2 = oekaki.apply(s1, { p: -1, t: 'next', turn: s1.turn });
  assert.ok(s2, '次の回へ進む');
  assert.equal(s2.strokes.length, 0);
  assert.equal(s2.history[0].strokes.length, 1, '次の回になっても前の絵が残る');
}
console.log('uiux12 logic OK');
