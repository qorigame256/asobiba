// 手元の確認用の簡易サーバー。公開するフォルダ app/ を http://localhost:8080/ で見せる。
// 使い方: node tools/serve.js   （ポートを変えるなら node tools/serve.js 3000）
// App Store 版の組み立てた中身を見るなら node tools/serve.js 8090 native/www （先に node tools/build-native.mjs）
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', process.argv[3] || 'app');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080; // PORT は起動設定 game-auto が空いている番号を渡す
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
};

// ゲーム（app/ と native/www）の index.html には、音と読み上げを無音にする台本を頭に足して返す（2026-11-03 本人の依頼
// 「Claude が裏で動作確認しているときに効果音が聞こえる」）。Claude のブラウザは画面が隠れていても音がスピーカーから出るため。
// 公開サイト（GitHub Pages は app/ をそのまま出す）とアプリ版（build-native.mjs がファイルを写す）はこのサーバーを通らないので影響しない。
// 鳴らす処理そのもの（AudioBufferSourceNode の start・speechSynthesis.speak）は今までどおり呼ばれ、出口の大きさを0にするだけなので、
// start を包んで鳴ったかを見る確かめ方はそのまま使える（読み上げの volume だけは0に書き換わる）。
// 音を出したいとき（本人に聞かせる・大きさを確かめる）は ?sound を付けて開く（そのタブの間は覚える）。試聴ページなどほかのフォルダは無音にしない。
const QUIET = ['app', 'native/www'].some((r) => ROOT === path.resolve(__dirname, '..', r));
const MUTE_SCRIPT = `<script>/* tools/serve.js が足した無音の仕掛け（公開サイトには無い） */(() => {
  try { if (new URLSearchParams(location.search).has('sound')) sessionStorage.setItem('serve-sound', '1'); if (sessionStorage.getItem('serve-sound')) return; } catch {}
  const B = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
  const d = B && Object.getOwnPropertyDescriptor(B.prototype, 'destination');
  if (d) {
    const m = new WeakMap();
    Object.defineProperty(B.prototype, 'destination', { configurable: true, get() {
      let g = m.get(this);
      if (!g) { g = this.createGain(); g.gain.value = 0; g.connect(d.get.call(this)); m.set(this, g); }
      return g;
    } });
  }
  if (window.speechSynthesis) { const s = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = (u) => { u.volume = 0; s(u); }; }
})();</script>`;

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (QUIET && file === path.join(ROOT, 'index.html')) data = String(data).replace('<head>', `<head>${MUTE_SCRIPT}`);
    res.end(data);
  });
}).listen(PORT, () => console.log(`http://localhost:${PORT}/`));
