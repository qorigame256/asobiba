// 声のファイルを作る（2026-11-08）。決まった言葉（tools/voice-texts.mjs）を VOICEVOX で読ませ、app/voice/<声>/<voiceId>.mp3 と app/js/voice-list.js を書く。
// 使い方: VOICEVOX を起動しておき（中の読み上げの仕組みが http://127.0.0.1:50021 で待つ）、node tools/make-voice.mjs
//   すでにあるファイルは作り直さない。--force で全部作り直す。--prune で、一覧に無くなった言葉のファイルを消す（消す前に名前を出す）。
// 1つずつ: VOICEVOX で WAV → tools/level-sound.mjs で前後の無音を切って大きさをそろえる（LEVEL）→ ffmpeg で mp3（片耳・22050Hz・48kbps）。
// 声と規約は sound.js の先頭と CLAUDE.md（「読み上げの声を VOICEVOX に」）。声を足す・替えるときは sound.js の VOICES と main.js の LICENSES も直す。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { voiceId } from '../app/js/sound.js';
import { VOICE_TEXTS } from './voice-texts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:50021';
const VOICES = { hau: ['雨晴はう', 'ノーマル'], bee: ['猫使ビィ', 'ノーマル'] }; // フォルダの名前 → [キャラクター, 話し方]
const LEVEL = '-18'; // 大きさの目標（dB。level-sound.mjs の normal と同じ。番が来た・正解など big の音より少し小さい）
const MAX_SEC = '8';
const force = process.argv.includes('--force');
const prune = process.argv.includes('--prune');

const ids = new Map();
for (const { text } of VOICE_TEXTS) {
  const id = voiceId(text);
  if (ids.has(id) && ids.get(id) !== text) throw new Error(`名前がぶつかった: ${text} と ${ids.get(id)}`);
  ids.set(id, text);
}

let speakers;
try { speakers = await (await fetch(`${API}/speakers`)).json(); } catch { console.error('VOICEVOX につながらない。VOICEVOX を起動してからもう一度'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'make-voice-'));
let made = 0;
try {
  for (const [dir, [name, style]] of Object.entries(VOICES)) {
    const sp = speakers.find((s) => s.name === name)?.styles.find((t) => t.name === style);
    if (!sp) throw new Error(`VOICEVOX に ${name}（${style}）が無い`);
    const outDir = path.join(ROOT, 'app', 'voice', dir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const { text, speed } of VOICE_TEXTS) {
      const out = path.join(outDir, `${voiceId(text)}.mp3`);
      if (!force && fs.existsSync(out)) continue;
      const q = await (await fetch(`${API}/audio_query?text=${encodeURIComponent(text)}&speaker=${sp.id}`, { method: 'POST' })).json();
      q.speedScale = speed;
      const r = await fetch(`${API}/synthesis?speaker=${sp.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
      if (!r.ok) throw new Error(`${name} ${text}: ${r.status}`);
      const raw = path.join(tmp, 'raw.wav'), lev = path.join(tmp, 'lev.wav');
      fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
      execFileSync('node', [path.join(ROOT, 'tools', 'level-sound.mjs'), raw, lev, LEVEL, MAX_SEC], { stdio: 'pipe' });
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', lev, '-ac', '1', '-ar', '22050', '-b:a', '48k', out]);
      made++;
      if (made % 20 === 0) console.log(`${made} 個作った（${name}: ${text}）`);
    }
    const stale = fs.readdirSync(outDir).filter((f) => f.endsWith('.mp3') && !ids.has(f.slice(0, -4)));
    for (const f of stale) {
      console.log(`${prune ? '消す' : '一覧に無い（--prune で消す）'}: ${dir}/${f}`);
      if (prune) fs.unlinkSync(path.join(outDir, f));
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 全部の声でファイルがそろった言葉だけを一覧に入れる（欠けた言葉はブラウザの読み上げで言う）
const ready = [...ids.keys()].filter((id) => Object.keys(VOICES).every((d) => fs.existsSync(path.join(ROOT, 'app', 'voice', d, `${id}.mp3`)))).sort();
fs.writeFileSync(path.join(ROOT, 'app', 'js', 'voice-list.js'),
  `// tools/make-voice.mjs が作る。手で直さない。声のファイル（app/voice/<声>/<名前>.mp3）がそろっている言葉の名前（sound.js の voiceId）\n`
  + `export const VOICE_IDS = new Set([\n${ready.map((id) => `  '${id}',`).join('\n')}\n]);\n`);
console.log(`作った: ${made} 個 / 一覧: ${ready.length} / ${ids.size} 語`);
