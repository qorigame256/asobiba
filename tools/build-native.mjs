// App Store 版の中身を組み立てる（node tools/build-native.mjs。native/ で npm run build でも同じ）。
// app/ を native/www/ へまるごと写し、外から読んでいる道具（mqtt.js・QR コードの道具）を同梱のファイルに替える。
// Apple の審査はコードをネットから読むことを認めない（決まり 2.5.2）ので、アプリ版では必ず同梱にする。ウェブ版（app/）は替えない。
// 替える前の文字は「ちょうど1か所」あることを確かめ、無ければ止まる（app/ 側で版を上げたら、ここと native/package.json も上げる）。
// 道具の本体は native/node_modules から写すので、先に native/ で npm install しておく。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'app');
const out = path.join(root, 'native', 'www');
const mods = path.join(root, 'native', 'node_modules');

// [app/ の中で替える所, 替える前の住所, 同梱の住所, node_modules の中の本体, 一緒に写すライセンス（本体の先頭に書いてあれば null）]
// どちらも MIT ライセンスで、本文を一緒に配る必要がある。qrcode-generator はライセンスのファイルが無く、本体の先頭に書いてある。
const VENDOR = [
  ['index.html', 'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js', 'vendor/mqtt.min.js', 'mqtt/dist/mqtt.min.js', 'mqtt/LICENSE.md'],
  ['js/main.js', 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js', 'vendor/qrcode.js', 'qrcode-generator/qrcode.js', null],
];

function fail(msg) {
  console.error('止めました: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(mods)) fail('native/node_modules がありません。native/ で npm install を先に走らせてください');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const vendorDir = path.join(out, 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });
for (const [file, from, to, body, license] of VENDOR) {
  const target = path.join(out, file);
  const text = fs.readFileSync(target, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) fail(`${file} の中の ${from} が ${count} か所（1か所のはず）`);
  fs.writeFileSync(target, text.replace(from, to));
  const copies = [[body, path.basename(to)]];
  if (license) copies.push([license, license.split('/')[0] + '-LICENSE.txt']);
  for (const [p, name] of copies) {
    const f = path.join(mods, p);
    if (!fs.existsSync(f)) fail(`${p} がありません（native/package.json の版と app/ の版が合っているか）`);
    fs.copyFileSync(f, path.join(vendorDir, name));
  }
}

// Capacitor の道具（registerPlugin。広告の部品を呼ぶのに使う。app/js/ads.js）を main.js より先に読む。
// 殻が先に用意する window.Capacitor には registerPlugin が無く、組み立ての道具（バンドラー）を使わないアプリはこのファイルで足す。
{
  const target = path.join(out, 'index.html');
  const from = '<script type="module" src="js/main.js"></script>';
  const text = fs.readFileSync(target, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== 1) fail(`index.html の中の ${from} が ${count} か所（1か所のはず）`);
  fs.writeFileSync(target, text.replace(from, '<script src="vendor/capacitor.js"></script>\n  ' + from));
  for (const [p, name] of [['@capacitor/core/dist/capacitor.js', 'capacitor.js'], ['@capacitor/core/LICENSE', 'capacitor-LICENSE.txt']]) {
    const f = path.join(mods, p);
    if (!fs.existsSync(f)) fail(`${p} がありません（native/ で npm install を走らせたか）`);
    fs.copyFileSync(f, path.join(vendorDir, name));
  }
}

// 外から読む所が残っていないか（説明の中の住所は除くため、src= と '...' の形だけ見る）
const left = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js|css)$/.test(e.name) && !p.startsWith(vendorDir)) {
      const t = fs.readFileSync(p, 'utf8');
      if (/(src=|href=|['"`])https?:\/\/(unpkg|cdn|cdnjs)/.test(t)) left.push(path.relative(out, p));
    }
  }
})(out);
if (left.length) fail('まだ外から読んでいる所があります: ' + left.join(', '));

console.log('native/www/ を作りました（外から読む道具 ' + VENDOR.length + ' 個を同梱に替え、Capacitor の道具を足した）');
