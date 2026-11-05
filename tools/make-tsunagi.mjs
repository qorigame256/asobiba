// 数字つなぎ早解き（tsunagi.js）の問題の一覧 app/js/games/tsunagi-data.js を作り直す（node tools/make-tsunagi.mjs）。
// 全部のマスを通る道をでたらめに作って切り分け（makeCandidate）、答えが1つだけのもの（countSolutions）だけを残す。
// 5×5 と 7×7 を30問ずつ。種は決めてあるので、何度走らせても同じ一覧になる
// （tools/test-logic.mjs が、どの問題も答えが1つだけで、書いてある答えが正しいかを見ている）。
import { writeFileSync } from 'node:fs';
import { mulberry32 } from '../app/js/games/util.js';
import { makeCandidate, countSolutions } from '../app/js/games/tsunagi.js';

const WANT = 30;
const MAXLEN = { 5: 7, 7: 9 }; // 1本の線のいちばん長いマス数（長いと答えが1つに決まりにくい）
const out = { 5: [], 7: [] };
for (const N of [5, 7]) {
  const rnd = mulberry32(5000 + N);
  let tried = 0;
  const seen = new Set();
  while (out[N].length < WANT) {
    tried++;
    const c = makeCandidate(N, rnd, MAXLEN[N]);
    if (!c || seen.has(c.p)) continue;
    // 数字が少なすぎる問題（5×5 で4組より少ない・7×7 で6組より少ない）は、長い線ばかりで答えが決まりにくいので使わない
    const pairs = new Set(c.p.replace(/0/g, '')).size;
    if (pairs < (N === 5 ? 4 : 6)) continue;
    if (countSolutions(c.p, N, 2) !== 1) continue;
    seen.add(c.p);
    out[N].push(c);
  }
  console.log(`${N}×${N}: ${WANT}問（候補 ${tried}こから）`);
}
const fmt = (list) => list.map((x) => `    { p: '${x.p}', s: '${x.s}' },`).join('\n');
writeFileSync(new URL('../app/js/games/tsunagi-data.js', import.meta.url),
  '// 数字つなぎ早解きの問題の一覧（tools/make-tsunagi.mjs が作る。手で直さない）。\n'
  + '// p = 問題（左上から右へ1行ずつ。0 が空き、1〜9 が数字）、s = 答え（全部のマスに何番の線が通るか）。どれも答えが1つだけ\n'
  + `export const TSUNAGI = {\n  5: [\n${fmt(out[5])}\n  ],\n  7: [\n${fmt(out[7])}\n  ],\n};\n`);
