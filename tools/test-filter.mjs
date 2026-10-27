// 汚い言葉のふるい（app/js/filter.js）の自動確認（node tools/test-filter.mjs。数秒）。
// ①決まった形が当たる・当たらない ②当たった所だけが「＊」になる ③ゲームのお題・問題のデータが当たらない（当たると、正しく遊んでいる人の言葉が隠れる）
import assert from 'node:assert/strict';
import { isBad, mask } from '../app/js/filter.js';
import { PUZZLES } from '../app/js/games/umigame-data.js';
import { TOPICS } from '../app/js/games/oekaki-data.js';
import { PAIRS } from '../app/js/games/wordwolf-data.js';
import { TOPICS as ISHIN } from '../app/js/games/ishin-data.js';

// ① 表記のゆれをそろえて当てる
assert.ok(isBad('ばか'), 'ひらがな');
assert.ok(isBad('ウザイ'), 'カタカナ → ひらがな（一覧には「うざい」だけがある）');
assert.ok(isBad('ﾊﾞｶ'), '半角カナ（濁点の合成）');
assert.ok(isBad('ばか'), '結合の濁点');
assert.ok(isBad('ば​か'), '目に見えない文字を挟む');
assert.ok(isBad('おまえばかだな'), '部分一致');
assert.ok(isBad('ＳＭ'), '全角英字 → 半角');
assert.ok(isBad('SMAP'), '短い言葉用では SM は部分一致');
assert.ok(isBad('SM', 'sentence') && !isBad('SMAP', 'sentence'), '文用では SM は完全一致（一部に含まれても当てない）');
// ② 例外の語は外す
assert.ok(!isBad('ばかり'), '例外: ばかり');
assert.ok(!isBad('そばかす'), '例外: そばかす');
assert.ok(!isBad('バカンス'), '例外: バカンス');
assert.ok(isBad('ばかりのばか'), '例外の外にある語は当てる');
// 文用の一覧（完全一致の語が文の一部では当たらない）
assert.ok(isBad('ばか', 'sentence'));
// 当たらないもの
for (const s of ['たろう', 'みんなの遊び場', 'Aさんの部屋', '', null]) assert.ok(!isBad(s), String(s));
// 見える記号を挟んだ形は塞がない（もとのアプリと同じ決まり）
assert.ok(!isBad('ば・か'));

// ③ 当たった所だけ「＊」
assert.equal(mask('おまえばかだな'), 'おまえ＊＊だな');
assert.equal(mask('ﾊﾞｶ'), '＊＊＊', '半角の濁点（3文字目）も一緒に隠す');
assert.equal(mask('ば​か'), '＊＊＊', '挟んだ見えない文字も一緒に隠す');
assert.equal(mask('ばかりのばか'), 'ばかりの＊＊');
assert.equal(mask('たろう'), 'たろう');
assert.equal(mask('🐱ばか🐱'), '🐱＊＊🐱', '絵文字（2単位の文字）の位置がずれない');

// ④ ゲームのデータが当たらない
const hit = [];
for (const p of PUZZLES) for (const t of [p.title, p.q, p.a]) if (isBad(t, 'sentence')) hit.push('ウミガメ: ' + t.slice(0, 30));
for (const t of TOPICS.flat()) if (isBad(t)) hit.push('お絵描き: ' + t);
for (const t of PAIRS.flat()) if (isBad(t)) hit.push('ワードウルフ: ' + t);
for (const [q, groups] of ISHIN) for (const t of [q, ...groups.flat()]) if (isBad(t)) hit.push('以心伝心: ' + t);
assert.deepEqual(hit, [], 'お題・問題のデータが一覧に当たる');

console.log('filter OK');
