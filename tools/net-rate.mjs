#!/usr/bin/env node
// 中継サーバー（公開の MQTT ブローカー）が、1つの接続からの送りを1秒に何通まで配るかを測る台本（2026-11-19）。
// なぜ要るか: 中継サーバーは1つの接続が送れる数に上限を持ち、超えた分は qos 1 でも黙って捨てる（MQTT 3.1.1 では PUBACK は返る）。
//   2026-11-19 の実測: 1秒に約10通まで（数で決まり、長さには関係しない。送り手の接続ごと）。エアホッケー・紙相撲の対局中に here・state・ping が消えていた原因。
//   毎フレーム送るゲームの送る間隔を変えるとき・中継サーバーを替えるときに流して、上限を確かめる。
// すること: ゲームと同じ mqtt.js（app/index.html が読む版）を画面に出さないブラウザで動かし、でたらめな名前のトピックに送る側と受ける側を1つずつつなぐ。
//   決めた速さで送り（1秒に1通だけ qos 1、ほかは qos 0）、受ける側に届いた数・送る側に戻った数・qos 1 の PUBACK の中身・1秒ごとの届いた数を1行の JSON で出す。
// 使い方（プロジェクトのフォルダで）: node tools/net-rate.mjs [4|5]   … MQTT の版（既定 4＝ゲームと同じ。5 だと捨てられた qos 1 の PUBACK に Quota exceeded が返る）
//   環境変数: PLANS='[[25,6]]'（[1秒あたりの通数, 秒] の並び。既定は 5・9・12・15・25・50 通を6秒ずつ）・TWO=1（送る側を2つにして、上限が接続ごとかを見る）・PAD=<字数>（中身の長さ。既定 150）・BURST=<通数>（等しい間でなく、その通数ずつまとめて送る）
// ブラウザの部品は play-two.mjs と同じ場所（別の場所なら環境変数 HEADLESS_SHOT_MODULES）。
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, startServer } from './play-common.mjs';
import { BROKER_URL } from '../app/js/net.js'; // 測る先はアプリと同じ中継サーバー（別々に書くと、替えたときに古い方を測る。2026-11-20 の Codex の点検）
const ver = Number(process.argv[2] ?? 4);
const require = createRequire(import.meta.url);
const modDirs = [process.env.HEADLESS_SHOT_MODULES, path.resolve(ROOT, '..', 'Claudeの使い道', 'tools', 'screen-check', 'node_modules')].filter(Boolean);
let pw = null;
for (const d of modDirs) { try { pw = require(path.join(d, 'playwright-core')); break; } catch { /* 次を試す */ } }
if (!pw) { console.error(`playwright-core が見つかりません（探した場所: ${modDirs.join(' / ')}）`); process.exit(3); }
const { base, stop } = await startServer(null);
let browser = null;
for (const channel of ['chrome', 'msedge']) { try { browser = await pw.chromium.launch({ channel, headless: true, args: ['--mute-audio'] }); break; } catch { /* 次 */ } }
const page = await (await browser.newContext()).newPage();
await page.goto(base);
await page.waitForFunction(() => typeof mqtt !== 'undefined');
const plans = JSON.parse(process.env.PLANS ?? '[[5,6],[9,6],[12,6],[15,6],[25,6],[50,6]]'); // [1秒あたりの通数, 秒]
try {
  const out = await page.evaluate(async ({ plans, ver, two, padLen, burst, URL }) => {
    const topic = 'asobiba-q7m/ratetest/' + Math.random().toString(36).slice(2, 10);
    const mk = (name) => new Promise((res, rej) => {
      const c = mqtt.connect(URL, { clientId: 'rt_' + name + '_' + Math.random().toString(36).slice(2, 8), clean: true, keepalive: 30, reconnectPeriod: 0, connectTimeout: 10000, protocolVersion: ver });
      c.on('connect', () => res(c));
      c.on('error', rej);
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pub = await mk('pub');
    const sub = await mk('sub');
    await new Promise((r) => sub.subscribe(topic, { qos: 1 }, r));
    await new Promise((r) => pub.subscribe(topic, { qos: 1 }, r)); // ゲームと同じく、送る側も同じトピックを聞く
    const got = new Map(); // 通し番号 → 受けた時刻
    const gotSelf = new Set();
    sub.on('message', (t, p) => { const m = JSON.parse(p.toString()); got.set(m.n, performance.now()); });
    pub.on('message', (t, p) => { const m = JSON.parse(p.toString()); gotSelf.add(m.n); });
    const pub2 = two ? await mk('pub2') : null;
    let got2 = 0;
    sub.on('message', (t, p) => { if (JSON.parse(p.toString()).n < 0) got2++; });
    const res = [];
    let n = 0;
    for (const [rate, secs] of plans) {
      await sleep(3000); // 前の回の影響を抜く
      const sent = []; // [通し番号, 時刻, qos, PUBACK の理由]
      const start = performance.now();
      const total = rate * secs;
      const pad = 'x'.repeat(padLen); // 既定 150＝エアホッケーの位置の知らせと同じくらいの長さ
      let sent2 = 0; got2 = 0;
      for (let i = 0; i < total; i++) {
        const due = start + (Math.floor(i / burst) * burst * 1000) / rate; // burst 通ずつまとめて送る（1 なら等しい間）
        const w = due - performance.now();
        if (w > 0) await sleep(w);
        const q = i % rate === 0 ? 1 : 0; // 1秒に1通だけ qos 1（here・ping・state の役）
        const rec = [++n, performance.now(), q, null];
        sent.push(rec);
        if (pub2) { sent2++; pub2.publish(topic, JSON.stringify({ n: -n, pad }), { qos: 0 }); }
        pub.publish(topic, JSON.stringify({ n, pad }), { qos: q }, (err, pkt) => { if (q) rec[3] = err ? 'err:' + err.message : (pkt?.reasonCode ?? 'ack'); });
      }
      await sleep(2500);
      const q0 = sent.filter((s) => s[2] === 0), q1 = sent.filter((s) => s[2] === 1);
      const lags = sent.filter((s) => got.has(s[0])).map((s) => Math.round(got.get(s[0]) - s[1])).sort((a, b) => a - b);
      // 何通目から落ち始めたか
      const firstLost = sent.findIndex((s) => !got.has(s[0]));
      res.push({
        rate, secs, sent: sent.length, pub2: two ? got2 + '/' + sent2 : undefined,
        got: sent.filter((s) => got.has(s[0])).length,
        gotSelf: sent.filter((s) => gotSelf.has(s[0])).length,
        q0: `${q0.filter((s) => got.has(s[0])).length}/${q0.length}`,
        q1: `${q1.filter((s) => got.has(s[0])).length}/${q1.length}`,
        q1ack: q1.map((s) => s[3]).join(','),
        firstLostIndex: firstLost,
        lag: lags.length ? { min: lags[0], med: lags[lags.length >> 1], max: lags[lags.length - 1] } : null,
        perSec: Array.from({ length: secs }, (_, k) => sent.filter((s) => got.has(s[0]) && s[1] - start >= k * 1000 && s[1] - start < (k + 1) * 1000).length).join(' '),
      });
    }
    pub.end(true); sub.end(true);
    return res;
  }, { plans, ver, two: !!process.env.TWO, padLen: Number(process.env.PAD ?? 150), burst: Math.max(1, Number(process.env.BURST ?? 1)), URL: BROKER_URL });
  for (const r of out) console.log(JSON.stringify(r));
} finally {
  await browser.close();
  stop();
}
