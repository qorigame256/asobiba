// 音当て（oto.js）の「ド〜シ」の音をプログラムで作り、app/sounds/o_<音>.wav に置く（2026-11-20。素材をダウンロードせずに作るのは本人の承認）。
// 使い方: node tools/make-notes.mjs <piano|musicbox|marimba> [出す先のフォルダ（既定 app/sounds）]
//   1. 音色の式で 44.1kHz の WAV を一時フォルダに作る → 2. tools/level-sound.mjs で片耳・22050Hz・目標の大きさ（normal -18）にそろえて出す先に置く。
//   ffmpeg が要る（level-sound.mjs と同じ）。どの音色にしたかは oto.js の先頭に書く（本人が試聴して選ぶ）。
// 音の高さは ド=C4（261.63Hz）〜 シ=B4 の白い鍵盤の7つ（平均律）。
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const NOTES = [['do', 261.63], ['re', 293.66], ['mi', 329.63], ['fa', 349.23], ['so', 392.0], ['ra', 440.0], ['si', 493.88]];
const RATE = 44100;
const LEN = 1.4; // 秒

// 音色ごとの式: t（秒）と高さ f から、その瞬間の値（だいたい −1〜1）
const TIMBRES = {
  // ピアノ風: 倍音8つ（高い倍音ほど早く消える・少しずつ高めにずれる弦の性質）を、わずかに違う高さの2本の弦で重ね、打った瞬間の「コツ」を少し足す
  piano(t, f, noise) {
    let v = 0;
    for (const det of [-0.0005, 0.0005]) {
      for (let k = 1; k <= 8; k++) {
        const fk = f * k * Math.sqrt(1 + 0.0004 * k * k) * (1 + det);
        const a = (k === 1 ? 1 : 0.7 / k ** 1.2) * Math.exp(-t * (0.9 + 0.7 * k));
        v += a * Math.sin(2 * Math.PI * fk * t);
      }
    }
    v *= 0.5;
    v += noise * Math.exp(-t * 180) * 0.25;
    return v * Math.min(1, t / 0.003);
  },
  // オルゴール風: 基音と、くし歯の高い響き（5.4倍・11倍）。高い響きはすぐ消える
  musicbox(t, f) {
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 2.2)
      + 0.35 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 7)
      + 0.12 * Math.sin(2 * Math.PI * f * 11 * t) * Math.exp(-t * 16);
    return v * Math.min(1, t / 0.001);
  },
  // 木琴（マリンバ）風: 基音と4倍・10倍の響き。全体に早く消える
  marimba(t, f) {
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3)
      + 0.35 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t * 10)
      + 0.08 * Math.sin(2 * Math.PI * f * 10 * t) * Math.exp(-t * 24);
    return v * Math.min(1, t / 0.002);
  },
};

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return buf;
}

function render(kind, f) {
  const fn = TIMBRES[kind];
  const n = Math.round(LEN * RATE);
  const out = new Float32Array(n);
  let seed = 12345;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    lp += ((seed / 2 ** 32) * 2 - 1 - lp) * 0.3; // こもった雑音（打った音）
    const t = i / RATE;
    out[i] = fn(t, f, lp);
  }
  const fade = Math.round(0.15 * RATE);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  const peak = Math.max(...out.map(Math.abs));
  return out.map((v) => (v / peak) * 0.8);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('make-notes.mjs')) {
  const kind = process.argv[2];
  const dest = process.argv[3] ?? 'app/sounds';
  if (!TIMBRES[kind]) { console.error(`音色は ${Object.keys(TIMBRES).join(' / ')} のどれか`); process.exit(1); }
  const tmp = mkdtempSync(join(tmpdir(), 'notes-'));
  try {
    for (const [name, f] of NOTES) {
      const raw = join(tmp, `${name}.wav`);
      writeFileSync(raw, wav(render(kind, f)));
      execFileSync('node', ['tools/level-sound.mjs', raw, join(dest, `o_${name}.wav`), 'normal', String(LEN)], { stdio: 'inherit' });
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
