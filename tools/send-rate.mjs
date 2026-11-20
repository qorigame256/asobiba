#!/usr/bin/env node
// 位置を続けて送るゲーム（live・stream）で、端末ごとに1秒に何通送ろうとし、net.js の送る数の見張り（sendBudget）が何通捨てたかを測る台本（2026-11-20）。
// なぜ要るか: 中継サーバーは1つの接続から1秒に10通までしか配らず、net.js は直近1秒に8通送ったあとの qos 0 を捨てる（CLAUDE.md の「壊しやすい所・注意」）。
//   続けて送るゲームは、自分の間隔で1人あたり1秒に8通より下に収める決まり。送る間隔・描き替えの回数・送る中身を変えたら、これで数え直す。
//   中継サーバーとの間（WebSocket）を見るだけでは見張りが捨てた分が見えないので、net.js の send に数える1行を足した写しで動かす（本体は変えない）。
// 使い方（プロジェクトのフォルダで）:
//   node tools/send-rate.mjs <ゲームの id か画面の名前> [play-two.mjs のオプション（--rule・--guests・--cpus・--out・--timeout など）]
//   環境変数: MEASURE_MS 測る長さ（既定 12000）/ WARM_MS 始めてから測り始めるまで（既定 3000。始まりの顔合わせの間）/
//            TAP_HZ 紙相撲で1秒にトンを押す回数（既定 6）/ NO_INPUT=1 で操作しない
// すること: app/ を一時フォルダへ写し、net.js の send に数える1行を足す → その写しで play-two.mjs を動かし、この台本の default を続きの関数として呼ばせる
//   → 人ごとに、測った間の「送ろうとした数・送った数（1秒あたりと、直近1秒の最多）・見張りが捨てた数（qos ごと）・種類ごとの1秒あたり・ほかの人から届いた数（種類ごと）・
//   描き替えの回数」を出す。種類の名前は、live はゲームの中の種類（live:s など）、stream は中身の鍵（雪合戦の stream:a,t など）まで付ける。
// 操作（人の端末ごと。NO_INPUT でなければ）: エアホッケー・弾幕回避はマウスを自分の側で回し続ける（弾幕回避は押したまま）/ 紙相撲は TAP_HZ でトン /
//   雪合戦は 0.35秒ごとに盤の上の側と下の側を交互に押す（歩く・投げる）/ ミニゴルフは盤のまんなかから向きをばらばらに引いて離す（打てるたびに打つ）。ほかのゲームは操作しない。
// 見方: 「直近1秒の最多」が 8 以下なら見張りは1通も捨てない（9通目の qos 0 から捨てる）。捨てた数が 0 でなければ、そのゲームの送る間隔を見直す。
// 終了コード: play-two.mjs と同じ（0＝測れた）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const direct = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

// ---------- 測る（play-two.mjs から続きの関数として呼ばれる） ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drive(game, page, stopAt, tapHz) {
  const box = await page.locator('#board canvas').first().boundingBox().catch(() => null);
  if (!box) return 'canvas が無い';
  const cx = box.x + box.width / 2;
  if (game === 'hockey' || game === 'danmaku') {
    const cy = box.y + box.height * (game === 'hockey' ? 0.75 : 0.5);
    const r = Math.min(box.width, box.height) * 0.18;
    if (game === 'danmaku') { await page.mouse.move(cx, cy); await page.mouse.down(); }
    let a = 0;
    while (Date.now() < stopAt) { a += 0.25; await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6); await sleep(33); }
    if (game === 'danmaku') await page.mouse.up();
  } else if (game === 'sumo') {
    while (Date.now() < stopAt) { await page.mouse.click(cx, box.y + box.height / 2); await sleep(1000 / tapHz); }
  } else if (game === 'golf') {
    // 盤のまんなかを押して向きをばらばらに引いて離す（打てない間の引っ張りはゲームが無視する）。転がる間の位置の送り（golf.js の loop）を起こすため。2026-11-20 の Codex の点検
    const cy = box.y + box.height / 2;
    while (Date.now() < stopAt) {
      const a = Math.random() * Math.PI * 2, r = Math.min(box.width, box.height) * (0.15 + Math.random() * 0.15);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(cx + (Math.cos(a) * r * i) / 6, cy + (Math.sin(a) * r * i) / 6); await sleep(16); }
      await page.mouse.up();
      await sleep(400);
    }
  } else if (game === 'yuki') {
    let i = 0;
    while (Date.now() < stopAt) {
      const y = i++ % 2 ? 0.15 + Math.random() * 0.25 : 0.6 + Math.random() * 0.25;
      await page.mouse.click(box.x + box.width * (0.15 + Math.random() * 0.7), box.y + box.height * y);
      await sleep(350);
    }
  }
  return null;
}

// 並んだ時刻のうち、1秒（t - 前 < 1000。net.js の見張りと同じ数え方）に入る数の最多
function maxIn1s(ts) {
  let m = 0;
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] >= 1000) j++;
    m = Math.max(m, i - j + 1);
  }
  return m;
}

function summarize(log, recvLog, t0, t1, fps, note) {
  const w = log.filter(([t]) => t >= t0 && t <= t1);
  const sec = (t1 - t0) / 1000;
  const per = (n) => +(n / sec).toFixed(2);
  const recv = {};
  for (const [t, self, k] of recvLog) if (t >= t0 && t <= t1 && !self) recv[k] = (recv[k] ?? 0) + 1;
  const tried = w.map((x) => x[0]);
  const sent = w.filter((x) => x[2]).map((x) => x[0]);
  const types = {};
  for (const [, q, ok, k] of w) {
    const key = `${k}/q${q}`;
    types[key] ??= { n: 0, dropped: 0 };
    types[key].n++;
    if (!ok) types[key].dropped++;
  }
  return {
    sec: +sec.toFixed(1),
    fps: +fps.toFixed(1),
    tried: per(tried.length), triedMax1s: maxIn1s(tried),
    sent: per(sent.length), sentMax1s: maxIn1s(sent),
    droppedQ0: w.filter((x) => !x[2] && x[1] === 0).length,
    droppedQ1: w.filter((x) => !x[2] && x[1] !== 0).length,
    types: Object.fromEntries(Object.entries(types).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, `${per(v.n)}/秒${v.dropped ? `（捨て ${v.dropped}）` : ''}`])),
    recv: Object.fromEntries(Object.entries(recv).sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, `${n}通`])), // ほかの人から届いた数（測った間）
    ...(note ? { note } : {}),
  };
}

export default async function ({ host, guests }) {
  const game = process.env.SEND_RATE_GAME;
  const warm = Number(process.env.WARM_MS ?? 3000);
  const span = Number(process.env.MEASURE_MS ?? 12000);
  const tapHz = Number(process.env.TAP_HZ ?? 6);
  const people = [['ホスト', host], ...guests.map((g, i) => [`ゲスト${i + 1}`, g])];
  await sleep(warm);
  const t0 = await Promise.all(people.map(([, p]) => p.evaluate(() => performance.now())));
  // 描き替えの回数（測り始めの2秒）
  const fpsP = Promise.all(people.map(([, p]) => p.evaluate(() => new Promise((res) => {
    let n = 0;
    const s = performance.now();
    const f = (t) => { n++; if (t - s < 2000) requestAnimationFrame(f); else res(n / ((t - s) / 1000)); };
    requestAnimationFrame(f);
  }))));
  const stopAt = Date.now() + span;
  const notes = process.env.NO_INPUT ? people.map(() => null) : await Promise.all(people.map(([, p]) => drive(game, p, stopAt, tapHz)));
  const rest = stopAt - Date.now();
  if (rest > 0) await sleep(rest);
  const fps = await fpsP;
  const t1 = await Promise.all(people.map(([, p]) => p.evaluate(() => performance.now())));
  const logs = await Promise.all(people.map(([, p]) => p.evaluate(() => [globalThis.__sendLog ?? [], globalThis.__recvLog ?? []])));
  return Object.fromEntries(people.map(([name], i) => [name, summarize(logs[i][0], logs[i][1], t0[i], t1[i], fps[i], notes[i])]));
}

// ---------- 写しを作って play-two.mjs を動かす（直接動かしたとき） ----------
if (direct) {
  const { ROOT, findGame } = await import('./play-common.mjs');
  const argv = process.argv.slice(2);
  const wi = argv.findIndex((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--no-start'));
  if (wi < 0) { console.error('使い方: node tools/send-rate.mjs <ゲームの id か画面の名前> [play-two.mjs のオプション]（くわしくはこの台本の冒頭）'); process.exit(1); }
  const game = findGame(argv[wi]);
  const pass = argv.filter((_, i) => i !== wi);
  let out = null;
  const oi = pass.indexOf('--out');
  if (oi >= 0) out = path.resolve(pass[oi + 1]);
  else { out = fs.mkdtempSync(path.join(os.tmpdir(), 'send-rate-')); pass.push('--out', out); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'send-rate-app-'));
  const app = path.join(tmp, 'app');
  let code = 2;
  try {
    fs.cpSync(path.join(ROOT, 'app'), app, { recursive: true });
    const netFile = path.join(app, 'js', 'net.js');
    const src = fs.readFileSync(netFile, 'utf8');
    const from = 'send(msg, qos = 1) { if (allow(qos)) client.publish(';
    const hits = src.split(from).length - 1;
    if (hits !== 1) throw new Error(`net.js の send の行が ${hits} 件見つかった（1件のはず）。net.js が変わったら、この台本の from を合わせる`);
    // 種類の名前: live はゲームの中の種類（k）、stream は中身の鍵（雪合戦の a・t など）まで付ける
    const kind = '(msg.type === \'live\' ? \'live:\' + (msg.d?.k ?? \'?\') : msg.type === \'stream\' ? \'stream:\' + Object.keys(msg.d ?? {}).join(\',\') : String(msg.type))';
    const to = `send(msg, qos = 1) { const ok = allow(qos); (globalThis.__sendLog ||= []).push([performance.now(), qos, ok ? 1 : 0, ${kind}]); if (ok) client.publish(`;
    // 受け取った分も数える（ほかの人から届いた数。送った側の数より少なければ、中継サーバーか通信で消えている）
    const recvFrom = 'if (msg.from === myId) { onSelf?.(msg); return; }';
    const recvHits = src.split(recvFrom).length - 1;
    if (recvHits !== 1) throw new Error(`net.js の受け取りの行が ${recvHits} 件見つかった（1件のはず）。net.js が変わったら、この台本の recvFrom を合わせる`);
    const recvTo = `(globalThis.__recvLog ||= []).push([performance.now(), msg.from === myId ? 1 : 0, ${kind}]); ${recvFrom}`;
    fs.writeFileSync(netFile, src.replace(from, to).replace(recvFrom, recvTo));
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'play-two.mjs'), game, '--app', app, '--script', SELF, ...pass], {
      stdio: 'inherit', env: { ...process.env, SEND_RATE_GAME: game },
    });
    code = r.status ?? 2;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const file = path.join(out, 'result.json');
  if (fs.existsSync(file)) {
    const res = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (res.value) {
      console.log('');
      for (const [who, v] of Object.entries(res.value)) {
        console.log(`${who}: 描き替え ${v.fps}回/秒・送ろうとした ${v.tried}通/秒（直近1秒の最多 ${v.triedMax1s}）・送った ${v.sent}通/秒（最多 ${v.sentMax1s}）・見張りが捨てた qos0 ${v.droppedQ0}・qos1 ${v.droppedQ1}（${v.sec}秒）${v.note ? `・${v.note}` : ''}`);
        console.log(`  送った: ${Object.entries(v.types).map(([k, s]) => `${k} ${s}`).join(' / ')}`);
        console.log(`  届いた: ${Object.entries(v.recv).map(([k, s]) => `${k} ${s}`).join(' / ') || 'なし'}`);
      }
    }
  }
  process.exit(code);
}
