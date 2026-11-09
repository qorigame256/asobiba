// 見出しの字体に入れる字の一覧（tools/make-fonts.mjs が切り出しに使い、tools/test-logic.mjs が抜けを見る）。
// コードから集めるので、ゲームの名前・仲間の名前・技の名前を足したら make-fonts.mjs で作り直す。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAMES, CATEGORIES } from '../app/js/games/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const range = (a, b) => String.fromCodePoint(...Array.from({ length: b - a + 1 }, (_, i) => a + i));
const HIRA = range(0x3041, 0x3096) + '゛゜ゝゞ';
const KATA = range(0x30a1, 0x30fc); // ・ ー まで
const ASCII = range(0x21, 0x7e);
const PUNCT = '、。「」『』（）！？〜…・○×★☆♪：＆％＋－＝／０１２３４５６７８９';
const uniq = (s) => [...new Set([...s])].filter((c) => c.trim()).join('');

// ソースの中の文字の literal（'…' と `…`）から字を集める
const literals = (code) => [...code.matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2]).join('');
const read = (f) => readFileSync(join(root, 'app/js', f), 'utf8');
const block = (code, start) => {
  const i = code.indexOf(start);
  if (i < 0) throw new Error(`見つからない: ${start}`);
  return code.slice(i, code.indexOf('\n  },', i));
};

// 技の名前: いろあわせ・麻雀の cutin と、大富豪の effects（cutin が「・」でつないで出す）
const dfCode = read('games/daifugo.js');
const cutinText = literals(block(read('games/colors.js'), 'cutin(a, b, m)')) + literals(block(read('games/mahjong.js'), 'cutin(a, b, m)'))
  + literals(dfCode.split('\n').filter((l) => l.includes('effects.push')).join('\n')) + '♠♥♦♣♤♡♢♧';

const names = Object.values(GAMES).map((g) => g.name).join('') + CATEGORIES.map((c) => c.name).join('');

export const FONT_TEXT = {
  // タイトル・画面の見出し・ゲームの名前（index.html の h1・h2、main.js の play-title・待合室のいまのゲーム）
  zenmaru: uniq(HIRA + KATA + ASCII + PUNCT + names + 'みんなの遊び場ゲームを選ぶ部屋に参加いま選んでいる'),
  // 決着の判子の決まった字（main.js の stampOf。名前は入れない）
  yuji: uniq(HIRA + '勝負引分位' + '0123456789！・…'),
  // あなたのターンの帯・技の名前
  dela: uniq(HIRA + KATA + ASCII + PUNCT + 'あなたのターン' + cutinText),
};
// 見る側（test-logic）が使う: 技の名前の文字と名前
export const FONT_SOURCES = { names, cutinText };
