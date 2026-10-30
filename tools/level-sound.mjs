// 効果音の大きさをそろえて app/sounds 用の WAV（片耳・22050Hz・16bit）にする（2026-10-31 の効果音の見直しで作った）。
// 使い方（ffmpeg が要る。素材の ogg・wav・mp3 を読む）:
//   node tools/level-sound.mjs <素材> <出力.wav> <small|normal|big|目標のdB> [最長の秒]
//   node tools/level-sound.mjs --measure <wav…>     いまの大きさを測るだけ
// すること: 前後の無音を切る（頭が遅れて鳴ると押した感じが鈍るため）→ 長すぎれば切って消す → 目標の大きさにそろえる。
// 音の山が上限（0.89）を超える分は、先読みのリミッターで頭の一瞬だけ丸める（最大 8dB まで。それでも足りない音はその分小さく残り、そう表示する）。
// 大きさの測り方: 放送の音量の測り方（BS.1770）と同じ重み付けをして、0.3秒の窓で一番大きいところの平均の強さ（dB）。0.3秒より短い音は小さく出る（耳も短い音を小さく感じる）。
// 役割ごとの目標（app/sounds の今の音はこれでそろえてある。本人が試聴ページで聞いて承認したつり合い）:
//   small  -24  何度も鳴る手の音: place card draw chip flip drop line tile stone
//               （pop と wall は -26、shuffle と dice は -21 にした。よく鳴る・長いため）
//   normal -18  合図・当たり: question call hit punch smack boom stab pins
//   big    -13  結果と知らせ: turn correct wrong win lose draw_game goal
// sound.js は全部の音に同じ倍率（MASTER）を掛けるだけなので、音を足すときもこの道具でそろえてから置く。
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const TARGET = { small: -24, normal: -18, big: -13 };
const CEIL = 0.89;
const MAX_LIMIT_DB = 8;

function decode(path) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function trim(x, max) {
  let s = 0;
  while (s < x.length && Math.abs(x[s]) < 0.004) s++;
  s = Math.max(0, s - Math.round(0.003 * RATE));
  let e = x.length - 1;
  while (e > s && Math.abs(x[e]) < 0.0015) e--;
  e = Math.min(x.length, e + Math.round(0.02 * RATE));
  let y = x.slice(s, e);
  const fade = (n) => { for (let i = 0; i < n && i < y.length; i++) y[y.length - 1 - i] *= i / n; };
  if (y.length > max * RATE) { y = y.slice(0, Math.round(max * RATE)); fade(Math.round(0.08 * RATE)); } else fade(Math.round(0.01 * RATE));
  return y;
}

function biquad(x, [b0, b1, b2, a0, a1, a2]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function shelf(f0, G, Q) {
  const A = 10 ** (G / 40), w = 2 * Math.PI * f0 / RATE, c = Math.cos(w), al = Math.sin(w) / (2 * Q), r = 2 * Math.sqrt(A) * al;
  return [A * ((A + 1) + (A - 1) * c + r), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - r),
    (A + 1) - (A - 1) * c + r, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - r];
}
function hpf(f0, Q) {
  const w = 2 * Math.PI * f0 / RATE, c = Math.cos(w), al = Math.sin(w) / (2 * Q);
  return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
}

function loudness(x) {
  const k = biquad(biquad(x, shelf(1681.97, 3.99984, 0.7071752)), hpf(38.135, 0.5003));
  const B = Math.round(0.05 * RATE), W = 6;
  const blocks = [];
  for (let i = 0; i < k.length; i += B) {
    let e = 0;
    for (let j = i; j < Math.min(k.length, i + B); j++) e += k[j] * k[j];
    blocks.push(e / B);
  }
  let best = 1e-12;
  for (let i = 0; i < blocks.length; i++) {
    let e = 0;
    for (let j = i; j < i + W; j++) e += blocks[j] ?? 0;
    best = Math.max(best, e / W);
  }
  return 10 * Math.log10(best);
}

const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function limit(x, ceil) {
  const L = Math.round(0.0015 * RATE), rel = 1 / (0.06 * RATE);
  const need = x.map((v) => Math.min(1, ceil / Math.max(1e-9, Math.abs(v))));
  const y = new Float32Array(x.length);
  let g = 1;
  for (let i = 0; i < x.length; i++) {
    let m = 1;
    for (let j = i; j < Math.min(x.length, i + L); j++) m = Math.min(m, need[j]);
    g = Math.min(m, g + rel);
    y[i] = x[i] * Math.min(g, need[i]);
  }
  return y;
}

function level(x, target) {
  let gdb = target - loudness(x);
  let y = x;
  for (let it = 0; it < 6; it++) {
    const lim = 20 * Math.log10(peak(x) * 10 ** (gdb / 20) / CEIL);
    if (lim > MAX_LIMIT_DB) gdb -= lim - MAX_LIMIT_DB;
    const g = 10 ** (gdb / 20);
    y = limit(x.map((v) => v * g), CEIL);
    const d = target - loudness(y);
    if (Math.abs(d) < 0.2 || lim >= MAX_LIMIT_DB) break;
    gdb += d;
  }
  return y;
}

function writeWav(path, x) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(path, buf);
}

const args = process.argv.slice(2);
if (args[0] === '--measure') {
  for (const f of args.slice(1)) {
    const x = decode(f);
    console.log(`${f}  ${loudness(x).toFixed(1)}dB  山 ${peak(x).toFixed(2)}  ${(x.length / RATE).toFixed(2)}秒`);
  }
} else {
  const [src, out, role, max = '1.5'] = args;
  const target = TARGET[role] ?? Number(role);
  if (!src || !out || !Number.isFinite(target)) {
    console.log('使い方: node tools/level-sound.mjs <素材> <出力.wav> <small|normal|big|目標のdB> [最長の秒]');
    process.exit(1);
  }
  const y = level(trim(decode(src), Number(max)), target);
  writeWav(out, y);
  const got = loudness(y);
  console.log(`${out}  ${got.toFixed(1)}dB（目標 ${target}）  ${(y.length / RATE).toFixed(2)}秒${target - got > 0.5 ? `  ※山が上限に当たり ${(target - got).toFixed(1)}dB 小さい` : ''}`);
}
