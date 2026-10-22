// 自分の記録・ランキング（app/js/records.js）と自己ベストの数字（各ゲームの record）の自動確認（node tools/test-records.mjs。数秒）。
// ①Game Center のランキングの番号（本人が App Store Connect に登録する一覧。数と形） ②記録を分ける鍵と、最初の設定と違う所の文字
// ③数え方（同じ対局を2回数えない・人がいた対局の勝ちだけ・自己ベストは大きいときだけ） ④弾幕回避の生き残った時間（最後の1人は last の手の時刻）
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { GAMES } = await import('../app/js/games/index.js');
const { recordKey, boardId, rulesText, allBoards, noteGame, readRecords, WINS_LB, LB_PREFIX } = await import('../app/js/records.js');
const defs = (g) => Object.fromEntries(g.settings.map((x) => [x.key, x.def]));

// ① ランキングの番号: 勝った回数1つ＋ヨット2・玉入れ3・弾幕回避9・記憶リレー6・ブラックジャック3 = 24（変えたら本人の登録の作業が変わる）
const boards = allBoards(GAMES);
assert.equal(boards.length, 24, boards.map((b) => b.id).join('\n'));
assert.equal(boards[0].id, WINS_LB);
for (const b of boards) {
  assert.ok(b.id.startsWith(LB_PREFIX), b.id);
  assert.ok(/^[A-Za-z0-9.]+$/.test(b.id) && b.id.length <= 100, `番号は英数字と点だけ・100文字まで: ${b.id}`);
}
assert.equal(new Set(boards.map((b) => b.id)).size, boards.length, '番号が重ならない');
const yacht = GAMES.yacht;
assert.equal(boardId(yacht, defs(yacht)), LB_PREFIX + 'yacht.shortoff');
assert.equal(boardId(yacht, { ...defs(yacht), bonusYacht: true }), null, 'gc に無い設定が最初の値でなければ送らない');
assert.equal(boardId(yacht, { ...defs(yacht), short: true, bonusYacht: true }), LB_PREFIX + 'yacht.shorton', '短い版では2回目のヨットを使わないので送る');
const dm = GAMES.danmaku;
assert.equal(boardId(dm, { ...defs(dm), level: 'hard', time: '60' }), LB_PREFIX + 'danmaku.levelhard.time60');

// ② 鍵と文字
assert.equal(recordKey(yacht, defs(yacht)), 'yacht|short=off|bonusYacht=off|joker=off');
assert.equal(recordKey(yacht, { ...defs(yacht), short: true, joker: true }), 'yacht|short=on|bonusYacht=off|joker=off');
assert.equal(rulesText(yacht, recordKey(yacht, defs(yacht))), '最初の設定');
assert.equal(rulesText(dm, recordKey(dm, { ...defs(dm), level: 'hard', dark: 'on' })), '難しさ: むずかしい・暗やみ: あり');
assert.equal(rulesText(yacht, recordKey(yacht, { ...defs(yacht), short: true })), '短い版: あり');

// ③ 数え方
const best = (value, rules = defs(yacht)) => ({ game: yacht, rules, value });
noteGame('a', { won: true, withHuman: false, best: best(200) });
noteGame('a', { won: true, withHuman: true, best: best(300) }); // 同じ対局は数えない
let r = readRecords();
assert.equal(r.played, 1);
assert.equal(r.hwins, 0, 'CPU だけ相手の勝ちは数えない');
assert.equal(r.best['yacht|short=off|bonusYacht=off|joker=off'].v, 200);
assert.equal(noteGame('b', { won: true, withHuman: true, best: best(150) }), false, '小さい数字は自己ベストにしない');
assert.equal(noteGame('c', { won: false, withHuman: true, best: best(250) }), true, '大きい数字は自己ベスト更新');
noteGame('d', { won: false, withHuman: false, best: null });
r = readRecords();
assert.deepEqual([r.played, r.hwins, r.best['yacht|short=off|bonusYacht=off|joker=off'].v], [4, 1, 250]);

// ④ 弾幕回避: 当たった人はその時刻、最後の1人は last の手の時刻、時間切れまで残った人は時間いっぱい
const st = { rules: { time: '90' }, dead: [12000, null, null] };
assert.equal(dm.record.of(st, 0, []), 12000);
assert.equal(dm.record.of(st, 1, [{ p: 1, t: 'last', ms: 31000 }]), 31000);
assert.equal(dm.record.of(st, 2, []), 90000);
assert.equal(dm.record.fmt(31049), '31.0秒');

console.log('records OK');
