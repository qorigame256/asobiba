// CLAUDE.md や .claude/rules/ の中身を docs/ へ仕分けたあとの検算。
// 整理前のファイルの空でない行が1行ずつ、整理後のファイルか移し先のどれかに「同じ形の行」として残っているかを数える
// （共通ルール「CLAUDE.md の育て方」の「移した後に、整理前の全行が CLAUDE.md か移し先のどちらかに残っているかを1行ずつ検算する」）。
//
// 使い方:
//   git show HEAD:CLAUDE.md > <一時置き場>/before.md      … 整理前の形をコミットから取り出す
//   node tools/check-moved-lines.mjs <整理前> <整理後> <移し先>... [--show-moved]
//   移し先が大きな書類の一部の節だけのときは、その節だけを一時置き場へ切り出して渡す
//   （書類の別の所に同じ行がたまたまあると、写し忘れを見逃すため）。
//
// 出すもの: 「そのまま残った」「移し先にだけある」「どこにも無い」行の数と、どこにも無い行の中身
//   （--show-moved を付けると、移し先にだけある行の中身も）。移し先にだけある行は、行番号のまとまりも出す。
//   どこにも無い行は、書き換えた行（意図した書き換えかを1つずつ確かめる）か、写し忘れ。
// 終了コード: 0 = どこにも無い行が0 / 1 = どこにも無い行がある / 2 = 使い方の誤り
//
// 比べ方: 行末の空白（CR を含む）と先頭の BOM を除き、字下げも含めて同じ形の行があれば残っていると見る。
//   ほかの行の一部として入っているだけのものは数えない（移すときは行ごとそのまま写す決まりのため）。

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const showMoved = args.includes('--show-moved');
const files = args.filter((a) => a !== '--show-moved');
if (files.length < 3 || files.some((f) => f.startsWith('--'))) {
  console.error('使い方: node tools/check-moved-lines.mjs <整理前> <整理後> <移し先>... [--show-moved]');
  process.exit(2);
}

const readLines = (file) => {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    console.error(`読めません: ${file}（${e.code}）`);
    process.exit(2);
  }
  return text.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\s+$/, ''));
};

const [beforeFile, afterFile, ...destFiles] = files;
const before = readLines(beforeFile);
const after = new Set(readLines(afterFile));
const dest = new Set(destFiles.flatMap(readLines));

let kept = 0;
let empty = 0;
const moved = [];
const missing = [];
before.forEach((line, i) => {
  if (line.trim() === '') { empty++; return; }
  if (after.has(line)) kept++;
  else if (dest.has(line)) moved.push([i + 1, line]);
  else missing.push([i + 1, line]);
});

// 行番号の並びを「208-209, 234-238」の形にまとめる
const ranges = (nums) => {
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
};

console.log(`整理前 ${before.length} 行（空行 ${empty}）: そのまま残った ${kept} 行・移し先にだけある ${moved.length} 行・どこにも無い ${missing.length} 行`);
if (moved.length) {
  console.log(`移し先にだけある行の番号: ${ranges(moved.map(([n]) => n))}`);
  if (showMoved) for (const [n, l] of moved) console.log(`  移した ${n}: ${l}`);
}
for (const [n, l] of missing) console.log(`  どこにも無い ${n}: ${l}`);
process.exit(missing.length ? 1 : 0);
