#!/usr/bin/env node
// 対局中にホームへ戻った画面が、同じ画面のまま同じ対局・同じ席へ戻ったときに、盤が描き直されるかを、ゲームごとに確かめる台本（2026-11-19）。
// なぜ要るか: ホームへ戻ると盤を空にする（main.js の showScreen）。ゲームのファイルは「同じ対局・同じ席なら盤を作り直さない」判定を持つものが多く、
//   その判定が「盤がページにあるか」を見ていないと、戻ったときに空の盤のままになる。新しいゲームを足したとき・作り直しを止める判定を触ったときに流す。
// すること（1つのゲームにつき1つの部屋。tools/play-two.mjs を呼ぶ）: ホストとゲストで対局を始める → ゲストの画面で「別のタブがこの部屋を持っていった」印を端末の保存に書く
//   → ゲストの画面は部屋を譲ってホームへ戻る（bye を送らないので、席も id もそのまま。盤は空になる）→ ホームの「↩ さっきの部屋へ」を押す → 同じ対局・同じ席に戻る
//   → 盤の中の要素の数・高さ・canvas の数を、出る前と比べる。
//   本物の流れ（前のタブが裏で止まり、別のタブが戻り、そのタブを閉じる）は印が古くなるのを2回待つので1分かかる。ここでは印を直に書き換え、
//   ホームの「印が古くなったら確かめ直す」待ち（最大15秒）の1回だけを 0.8 秒に縮める（ページの setTimeout を包む。ゲームと main.js は書き換えない）。
//
// 使い方（プロジェクトのフォルダで）:
//   node tools/sweep-rejoin.mjs [ゲームの id …] [--jobs <同時に流す数。既定 4>] [--app <フォルダ>] [--out <フォルダ>]
//   id を書かなければ全部のゲーム（118個で10分ほど。1分を超えるので、共通ルールのメモリ上限の道具を通す）。--app は play-two.mjs と同じ（一部を書き換えた写しを見せる）。
//   1行に1ゲーム出す。★ = 盤が空・出る前より低い・canvas が無い・ページの例外・途中で止まった。★ が1つでもあれば終了コード 1。
// 見られないもの: 戻ったあとの盤の中身が正しいか（数と高さしか見ない）。時間で進むゲームは、戻るまでに場面が進んで数が変わる（★ にはしない）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const LAST_AT_KEY = 'bg-last-room-at'; // app/js/main.js の LAST_AT_KEY と同じ

const snap = (page) => page.evaluate(() => {
  const b = document.querySelector('#board');
  return {
    cls: (b?.className ?? '').replace('board ', ''), all: b?.querySelectorAll('*').length ?? -1, canvas: b?.querySelectorAll('canvas').length ?? -1,
    h: Math.round(b?.getBoundingClientRect().height ?? -1),
    status: document.querySelector('#status')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '',
    // 自分が観戦の側か（main.js の状態の欄の「観戦中です…」「観戦中: …」と、観戦の人の行「👀 …観戦中（…あなた…）」）。
    // 席でなく観戦に戻っても盤は描けるので、盤の数だけでは見分けられない（2026-11-20 の Codex の点検）。エアホッケーなど状態の欄を描かないゲームでは見分けられない
    spec: /観戦中です|観戦中: |観戦中（[^）]*あなた/.test(document.querySelector('#status')?.textContent ?? ''),
  };
});

// ---------- play-two.mjs から --script で呼ばれる側 ----------
export default async function ({ guests, sleep }) {
  const a = guests[0];
  await sleep(3500); // 席の紹介の演出が終わるまで
  const before = await snap(a);
  // 「別のタブがこの部屋を持っていった」印を書く。ホームの確かめ直しの待ちだけ縮める
  await a.evaluate((key) => {
    // 縮めるのは、ホームが出たあとの最初の1回（checkLastRoom の確かめ直し。15.5秒 − 印の古さ＝10.4〜15.5秒）だけ。
    // 広く縮めると、通信の接続の待ち（10秒）まで縮んで、問い合わせがつながる前に切れる（雪合戦・エアホッケーで起きた）
    const st = window.setTimeout.bind(window);
    let used = false;
    window.setTimeout = (cb, ms, ...rest) => {
      const hit = !used && ms > 10100 && ms <= 15600 && !document.querySelector('#screen-home')?.hidden;
      if (hit) used = true;
      return st(cb, hit ? 800 : ms, ...rest);
    };
    const cur = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...cur, at: Date.now(), tab: 'sweep-rejoin' }));
  }, LAST_AT_KEY);
  await a.waitForSelector('#screen-home:not([hidden])', { timeout: 9000 }); // 合図（5秒おき）のときに譲る
  const homeAll = (await snap(a)).all;
  // 持っていったタブはもう無い（印が古い）ことにする → 0.8 秒後に部屋へ問い合わせ、ホストが返事をするとボタンが出る
  await a.evaluate((key) => {
    const cur = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...cur, at: Date.now() - 60000 }));
  }, LAST_AT_KEY);
  try { await a.click('#last-room button', { timeout: 12000 }); } catch {
    // ボタンが出なかった理由の手がかり: 部屋の覚えが消えていれば、問い合わせに返事が無かった（main.js が部屋は閉じたと見た）
    const kept = await a.evaluate(() => !!localStorage.getItem('bg-last-room'));
    throw new Error(`「さっきの部屋へ」が12秒待っても出ない（部屋の覚えは${kept ? '残っている＝問い合わせの途中か、確かめ直しの待ちが縮んでいない' : '消えた＝問い合わせに返事が無かった'}）`);
  }
  await a.waitForSelector('#screen-play:not([hidden])');
  await a.waitForFunction(() => document.querySelector('#board')?.childElementCount > 0, null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  return { before, homeAll, back: await snap(a) };
}

// ---------- 直に動かした側（ゲームごとに play-two.mjs を呼ぶ） ----------
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { ROOT, GAMES, fail, findGame } = await import('./play-common.mjs');
  const argv = process.argv.slice(2);
  const opt = { jobs: 4, app: null, out: null };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const need = () => { if (i + 1 >= argv.length) fail(`${argv[i]} の値がありません`); return argv[++i]; };
    if (argv[i] === '--jobs') opt.jobs = Number(need());
    else if (argv[i] === '--app') opt.app = need();
    else if (argv[i] === '--out') opt.out = need();
    else if (argv[i].startsWith('--')) fail(`知らないオプションです: ${argv[i]}`);
    else words.push(argv[i]);
  }
  if (!Number.isInteger(opt.jobs) || opt.jobs < 1) fail('--jobs は 1 以上の整数で書きます');
  const ids = words.length ? words.map(findGame) : Object.keys(GAMES);
  const outRoot = path.resolve(opt.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-rejoin-')));
  let bad = 0;
  const one = (id) => new Promise((resolve) => {
    const g = GAMES[id];
    const guests = g.noCpu && (g.minPlayers ?? 2) > 2 ? g.minPlayers - 1 : 1; // CPU を入れられないゲームは、人だけで最低人数にする
    const out = path.join(outRoot, id);
    // 同じ --out で前に流した結果を読まないよう、先に消す（play-two.mjs が結果を書けずに終わると、前の回の成功を読んで通っていた。2026-11-20 の Codex の点検）
    fs.rmSync(path.join(out, 'result.json'), { force: true });
    const args = ['tools/play-two.mjs', id, '--script', SELF, '--out', out, '--timeout', '80', '--guests', String(guests), ...(opt.app ? ['--app', path.resolve(opt.app)] : [])];
    spawn(process.execPath, args, { cwd: ROOT, stdio: 'ignore' }).on('exit', () => {
      let r = null;
      try { r = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')); } catch { /* 結果が無い */ }
      const v = r?.ok ? r.value : null;
      const flags = [];
      if (!v) flags.push('止まった: ' + String(r?.error ?? '結果が無い').split('\n')[0].slice(0, 140));
      else {
        if (v.homeAll !== 0) flags.push('ホームで盤が空になっていない');
        if (v.back.spec && !v.before.spec) flags.push('観戦の側に戻った');
        if (v.back.all <= 0) flags.push('戻った盤が空');
        else if (v.before.h >= 40 && v.back.h < 40) flags.push('戻った盤が低い');
        if (v.before.canvas > 0 && v.back.canvas === 0 && v.back.cls === v.before.cls) flags.push('戻った盤に canvas が無い');
      }
      if (r?.pageErrors?.length) flags.push(`ページの例外 ${r.pageErrors.length} 件: ${r.pageErrors[0].text.slice(0, 100)}`);
      if (flags.length) bad++;
      const sh = (x) => `${x.cls}/${x.all}個/高さ${x.h}${x.canvas ? '/canvas' + x.canvas : ''}`;
      console.log(`${flags.length ? '★' : '　'} ${id}（${g.name}）${v ? ` 前 ${sh(v.before)} → 戻り ${sh(v.back)}［${v.back.status.slice(0, 24)}］` : ''} ${flags.join('・')}`);
      resolve();
    });
  });
  const queue = ids.slice();
  await Promise.all(Array.from({ length: Math.min(opt.jobs, ids.length) }, async () => { while (queue.length) await one(queue.shift()); }));
  console.log(`終わり ${ids.length} 個・★ ${bad} 個（結果と絵: ${outRoot.replaceAll('\\', '/')}）`);
  process.exit(bad ? 1 : 0);
}
