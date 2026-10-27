// ナンプレ早解き（nanpure.js）の問題の一覧 app/js/games/nanpure-data.js を作り直す（node tools/make-nanpure.mjs）。
// 答えが1つだけになる問題を種から作る（9×9 と 6×6 を40問ずつ）。画面で作ると時間がかかるため、前もって書き出しておく
// （tools/test-logic.mjs が、どの問題も答えが1つだけで、書いてある答えと同じかを見ている）。
import { writeFileSync } from 'node:fs';
import { makePuzzle } from '../app/js/games/nanpure.js';

const rows = [];
for (const size of [9, 6]) {
  for (let k = 0; k < 40; k++) {
    const { puzzle, answer } = makePuzzle(size, 1000 * size + k);
    rows.push(`${size}:${puzzle.join('')}:${answer.join('')}`);
  }
}
writeFileSync(new URL('../app/js/games/nanpure-data.js', import.meta.url),
  `// ナンプレ早解きの問題の一覧（tools/make-nanpure.mjs が作る。手で直さない）。1行が「大きさ:問題（0 が空き）:答え」\n`
  + `export const NANPURE = \`\n${rows.join('\n')}\n\`;\n`);
console.log(rows.length + ' 問を書き出しました');
