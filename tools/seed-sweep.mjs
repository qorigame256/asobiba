// 乱数の種を変えて自動確認を何回も流し、運で落ちる確認を洗い出す（2026-11-20）。
//
// 使い方（重いので共通ルールの mem-limit.js を通す）:
//   node "<Claudeの使い道>/tools/mem-limit.js" node tools/seed-sweep.mjs [回数=20] [同時に流す数=6] [最初の種=1]
//   環境変数 QUICK=1 を付けると軽い流し方で流す（子にそのまま渡す）。
// 種は「最初の種」から 1 ずつ増やす（同じ引数なら同じ結果になり、落ちた種を SEED=<種> node tools/test-logic.mjs で流し直せる）。
// 出力: 落ちた回ごとに種と、落ちた確認の行（AssertionError の前後）。最後に「落ちた数/回数」。終了コードは落ちた回があれば 1。

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const [count = 20, para = 6, first = 1] = process.argv.slice(2).map(Number);
const test = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-logic.mjs');

function runOne(seed) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [test], { env: { ...process.env, SEED: String(seed) } });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.stderr.on('data', (d) => (out += d));
    ch.on('close', (code) => resolve({ seed, code, out }));
  });
}

const seeds = Array.from({ length: count }, (_, i) => first + i);
const fails = [];
let next = 0;
async function worker() {
  while (next < seeds.length) {
    const r = await runOne(seeds[next++]);
    if (r.code !== 0) {
      fails.push(r);
      const lines = r.out.split('\n');
      const i = lines.findIndex((l) => /Error|assert/i.test(l));
      console.log(`--- 落ちた: seed ${r.seed}\n` + lines.slice(Math.max(0, i - 3), i + 12).join('\n'));
    } else {
      console.log(`ok seed ${r.seed}`);
    }
  }
}
await Promise.all(Array.from({ length: para }, worker));
console.log(`落ちた数 ${fails.length}/${count}（seed: ${fails.map((f) => f.seed).join(', ') || 'なし'}）`);
process.exit(fails.length ? 1 : 0);
