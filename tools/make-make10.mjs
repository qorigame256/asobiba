// 10を作れ（make10.js）の問題の一覧 app/js/games/make10-data.js を作り直す（node tools/make-make10.mjs）。
// 画面で毎回計算すると0.5秒ほど止まるため、前もって書き出しておく。計算の決まり（make10.js の solveAll・trim）を変えたら作り直すこと
// （tools/test-logic.mjs が、書き出したものと計算し直したものが同じかを見ている）。
import { writeFileSync } from 'node:fs';
import { buildPuzzles } from '../app/js/games/make10.js';

const rows = buildPuzzles().map((p) => `${p.nums.join('')}:${p.count}:${p.ex}`);
const lines = [];
for (let i = 0; i < rows.length; i += 6) lines.push(rows.slice(i, i + 6).join(' '));
writeFileSync(new URL('../app/js/games/make10-data.js', import.meta.url),
  `// 10を作れの問題の一覧（tools/make-make10.mjs が作る。手で直さない）。1つが「4つの数字（小さい順）:解き方の数:答えの例」\n`
  + `export const MAKE10 = \`\n${lines.join('\n')}\n\`;\n`);
console.log(rows.length + ' 組を書き出しました');
