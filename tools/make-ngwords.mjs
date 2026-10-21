// 汚い言葉の一覧（app/js/ngwords.js）を作り直す（node tools/make-ngwords.mjs）。
// 一覧は別のアプリ（クイズアプリ）で手を入れたものをそのまま使う（2026-10-21 本人の決定）。元の CSV の場所は Git に入れない
// tools/local-paths.json の ngwordsDir。あちらの一覧が変わったら、これを走らせて app/js/ngwords.js を作り直す。
// 写すのは「状態」が「有効」の語だけ。「判定」が「完全一致」の語は、言葉の全体がその語と同じときだけ当てる（filter.js）。
//   SHORT    = 名前・部屋の名前・短い答え用（NGワード一覧_本体_v0.csv と NGワード一覧_例外_v0.csv）
//   SENTENCE = 文（ウミガメのスープの質問など）用（NGワード一覧_問題文用_本体_v0.csv と NGワード一覧_問題文用_例外_v0.csv）
// 一覧のもとは MosasoM/inappropriate-words-ja（MIT。Copyright (c) 2020 K Hashimoto）。ライセンスの本文は main.js の「このアプリについて」で出す。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error('止めました: ' + m); process.exit(1); };
let dir;
try { dir = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'local-paths.json'), 'utf8')).ngwordsDir; } catch { /* 下で止める */ }
if (!dir || !fs.existsSync(dir)) fail('tools/local-paths.json の ngwordsDir に一覧のフォルダがありません');

function rows(file) {
  // 先頭に BOM と、BOM を文字で書いたもの（\xEF\xBB\xBF の12文字）が付いているファイルがある
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '').replace(/^\\xEF\\xBB\\xBF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(',');
  if (head[0] !== '語') fail(`${file} の1行目が「語,…」ではありません`);
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
}
function words(file) {
  const out = [];
  for (const r of rows(file)) {
    if (r['状態'] !== '有効') continue;
    if (r['判定'] !== '部分一致' && r['判定'] !== '完全一致') fail(`${file} の「${r['語']}」の判定が「${r['判定']}」`);
    out.push(r['判定'] === '完全一致' ? [r['語'], 1] : [r['語']]);
  }
  return out;
}
const except = (file) => rows(file).map((r) => r['語']).filter(Boolean);

const data = {
  SHORT: { words: words('NGワード一覧_本体_v0.csv'), except: except('NGワード一覧_例外_v0.csv') },
  SENTENCE: { words: words('NGワード一覧_問題文用_本体_v0.csv'), except: except('NGワード一覧_問題文用_例外_v0.csv') },
};
const out = `// 汚い言葉の一覧。tools/make-ngwords.mjs が作ったもの（手で直さない）。
// もとは MosasoM/inappropriate-words-ja（MIT。Copyright (c) 2020 K Hashimoto）。語ごとの [語] は部分一致、[語, 1] は完全一致。except は判定から外す語。
export const SHORT = ${JSON.stringify(data.SHORT)};
export const SENTENCE = ${JSON.stringify(data.SENTENCE)};
`;
fs.writeFileSync(path.join(root, 'app', 'js', 'ngwords.js'), out);
console.log(`app/js/ngwords.js を作りました（SHORT ${data.SHORT.words.length}語・例外${data.SHORT.except.length}／SENTENCE ${data.SENTENCE.words.length}語・例外${data.SENTENCE.except.length}）`);
