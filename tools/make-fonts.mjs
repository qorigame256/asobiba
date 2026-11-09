// 見出しの字体（2026-11-09 本人の選択。room.md「演出・アニメーションの2回目」の「見出しの字体」）を、使う字だけ切り出して app/fonts/ に置く。
//   node tools/make-fonts.mjs [元の字体のフォルダ]
// 元の字体（Google Fonts の ttf。どれも SIL Open Font License 1.1）はアプリに入れない。フォルダは引数か、Git に入れない tools/fonts-src/（ttf と OFL の文を置いてある）。
//   ZenMaruGothic-Bold.ttf → app/fonts/zenmaru.woff … タイトル・画面の見出し・ゲームの名前
//   YujiSyuku-Regular.ttf  → app/fonts/yuji.woff    … 決着の判子（名前の部分は今の字のまま。main.js の endStamp）
//   DelaGothicOne-Regular.ttf → app/fonts/dela.woff … あなたのターンの帯・技の名前
// 切り出しは Python の fontTools（python -m fontTools.subset）。woff2 は brotli が要るので、標準で作れる woff にした（Claude の判断）。
// 使う字はコードから集める（ゲームの名前・仲間の名前・技の名前）ので、ゲームや技の名前を足したら作り直す。入っていない字は、ほかの字体で出る（崩れはしない）。
// 切り出した字は tools/font-chars.json に覚え、tools/test-logic.mjs が「今のコードの名前・技の名前の字が全部入っているか」を見る（入っていなければ作り直しを知らせる）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_TEXT } from './font-texts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, 'tools/fonts-src');
if (!src || !existsSync(src)) {
  console.error('元の字体のフォルダが見つかりません（引数か tools/fonts-src/。Google Fonts の Zen Maru Gothic・Yuji Syuku・Dela Gothic One）');
  process.exit(1);
}
const out = join(root, 'app/fonts');
mkdirSync(out, { recursive: true });
const chars = {};
const FILES = { zenmaru: 'ZenMaruGothic-Bold.ttf', yuji: 'YujiSyuku-Regular.ttf', dela: 'DelaGothicOne-Regular.ttf' };
for (const [name, file] of Object.entries(FILES)) {
  const text = FONT_TEXT[name];
  const tmp = join(out, `.${name}.txt`);
  writeFileSync(tmp, text, 'utf8');
  try {
    execFileSync('python', ['-I', '-m', 'fontTools.subset', join(src, file), `--text-file=${tmp}`, '--flavor=woff', `--output-file=${join(out, name + '.woff')}`,
      '--layout-features=*', '--name-IDs=*', '--no-hinting', '--desubroutinize'], { stdio: 'inherit' });
  } finally {
    rmSync(tmp, { force: true });
  }
  chars[name] = text;
  console.log(`${name}.woff: ${[...text].length}字 ${readFileSync(join(out, name + '.woff')).length}バイト`);
}
writeFileSync(join(root, 'tools/font-chars.json'), JSON.stringify(chars, null, 1) + '\n', 'utf8');
