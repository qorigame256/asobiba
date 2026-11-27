// 2026-11-27 の UI・UX の14回目で足した、画面に頼らない部分の確認（node tools/probes/uiux14-logic.mjs。数秒。tools/test-logic.mjs からも流す）。
//   重さの手番の hist（動いた順の帯の元）・色うつり四目の runAt（崩した並び）とあぶない所の知らせの数え方。
import assert from 'node:assert/strict';
import omosa, { WAIT } from '../../app/js/games/omosa.js';
import utsuri, { runAt, dangerCells } from '../../app/js/games/utsuri.js';

// 重さの手番: hist は1手に1つ増え、席（÷5）と動かした駒の種類（%5。待つは4）を正しく持つ。同じ人が続けた手も1つずつ数える
{
  let s = omosa.init({ rules: { wait: true } });
  const want = [];
  for (let k = 0; k < 12 && !s.won; k++) {
    let m = null;
    if (k === 5) m = WAIT; // 途中で1回待つ
    else for (let x = 0; x < 36 * 36 && m === null; x++) if (omosa.apply(s, x)) m = x;
    const p = s.turn;
    const kind = m === WAIT ? 4 : s.board[Math.floor(m / 36)] % 4;
    s = omosa.apply(s, m);
    want.push(p * 5 + kind);
    assert.deepEqual(s.hist, want, `重さの手番: ${k + 1}手目の hist`);
  }
  assert.ok(want.some((v, i) => i > 0 && Math.floor(v / 5) === Math.floor(want[i - 1] / 5)), '重さの手番: 確かめた手の中に、同じ人が続けて動いた所がある');
}

// 色うつり四目: runAt は、マスを通る色の3つ以上の並びのうち、いちばん長いものを端から順に返す
{
  const b = (rows) => rows.join('').split('').map((ch) => (ch === '.' ? null : ch === 'X' ? -1 : Number(ch)));
  const row3 = b(['......', '......', '.111..', '......', '......', '......']);
  assert.deepEqual(runAt(row3, 15, 1), [13, 14, 15], '色うつり四目: 横の3つ（右端から）');
  assert.deepEqual(runAt(row3, 14, 1), [13, 14, 15], '色うつり四目: 横の3つ（まんなかから）');
  assert.equal(runAt(row3, 15, 0), null, '色うつり四目: ほかの色の並びは返さない');
  const two = b(['......', '......', '.11...', '......', '......', '......']);
  assert.equal(runAt(two, 14, 1), null, '色うつり四目: 2つだけの並びは返さない');
  const diag = b(['1.....', '.1....', '..111.', '...1..', '......', '......']);
  assert.deepEqual(runAt(diag, 14, 1), [0, 7, 14, 21], '色うつり四目: 先に見る横の3つより長い斜めの4つを返す');

  // あぶない所の知らせ: 青（席1）が右下の色の無い駒を左へ動かすと斜めに4つ。相手の直前の駒の縛りは外して数える
  const s = { ...utsuri.init({ rules: {} }), board: b(['......', '.1..0.', '..1.0.', '...1..', '.0...X', '......']), turn: 0 };
  const cells = (st) => dangerCells(utsuri, st);
  assert.deepEqual([...cells(s)], [4 * 6 + 4], '色うつり四目: 4つ並べられる行き先は (4,4) だけ');
  // 青が直前にその駒を動かしていても（いまの縛りでは動かせなくても）、相手の次の番には動かせるので知らせる
  const locked = { ...s, last: { f: 4 * 6 + 4, d: 4 * 6 + 5, was: -1 } };
  assert.deepEqual([...cells(locked)], [4 * 6 + 4], '色うつり四目: 相手の直前の駒の縛りは外して数える');
}

console.log('uiux14 OK');
