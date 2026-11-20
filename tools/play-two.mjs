#!/usr/bin/env node
// 人が2人以上いる部屋を、画面に出さないブラウザで動かす台本（2026-11-19。play-shot.mjs は部屋に自分1人と CPU だけなので、
// 紙相撲（人が2人そろわないと始められない）・代打・観戦・退出させられたとき・最低人数を割ったときの「もう一回」などを見られなかった）。
// すること: 確認用サーバー（tools/serve.js）を空いている番号で起こす → 画面に出さないブラウザ1つの中に、人ごとに別の入れ物（保存が別々）でページを開く →
//   1人目（ホスト）が持ち主の印を入れて部屋を作る → 詳細設定を入れる → 2人目から（ゲスト）が部屋コードで入る → 「始める」を押す →
//   --script のファイルの default の関数を呼ぶ → 返した値・コンソールのエラー・ページの例外を result.json に書く → サーバーを止める。
// 1人で足りる確認は play-shot.mjs を使う（操作を JSON で書けて短い）。こちらは Playwright のページをそのまま渡すので、続きは JavaScript で書く。
//
// 使い方（プロジェクトのフォルダで）:
//   node tools/play-two.mjs <ゲームの id か画面の名前> --script <ファイル.mjs> [オプション]
//     --rule <鍵>=<値>    詳細設定を1つ変える（何回でも。鍵と値は node tools/play-shot.mjs --list <ゲーム>）
//     --guests <数>       始める前に入れておくゲストの数（既定 1）。0 にして、続きの関数の中で join() で途中から入れてもよい
//     --cpus <数>         「CPU を増やす」を押す回数（既定 0）
//     --no-start          待合室で止める（「始める」を押さない。席を選ぶ・ゲストを途中で入れるときなど）
//     --app <フォルダ>     見せるフォルダ（既定 app/。本体を触らずに、一部を書き換えた写しで確かめるとき。絶対パスも書ける）
//     --out <フォルダ>     絵と result.json の置き場所（既定は一時フォルダ。場所は最後に出る）
//     --size <幅x高さ>     画面の大きさ（既定 390x844）
//     --timeout <秒>       全体の上限（既定 180）
//
// --script のファイル: export default async function ({ host, guests, join, readyAll, menu, shot, sleep, base, code }) { …; return 値; }
//   host・guests[i] … Playwright のページ（page.click('セレクタ')・page.evaluate(() => …)・page.waitForSelector(…) など）。
//   join(名前)     … もう1人を部屋に入れて、そのページを返す（guests にも足す）。page.context().close() で、その人のタブを閉じたことになる
//   readyAll()     … 待合室で、対局する席のゲスト全員が「準備OK」を押す（押さないとホストの「始める」が押せない。--no-start でないときは台本が先に呼ぶ）
//   menu(page, 文字) … 対局の画面の畳んである「⚙ 部屋のメニュー」（と、その中の「部屋の人」）を開けてから、その文字を含むボタンを押す
//                    （待合室へ・みんなで待合室へ・退出させる など。遊びの操作のほかは全部この中にあり、開けないと押せない）
//   shot(page, 名前, { full }) … <out>/名前.png を撮る
//   sleep(ミリ秒)
//   目印は play-shot.mjs と同じ（盤 #board・下の段 #controls・大きなボタン #dock・上の知らせ #status）。
//   始めた直後は席の紹介の演出が2秒ほど出る。
// 盤のゲームと毎フレーム動くゲーム（紙相撲・エアホッケー）は、待合室でホストが席の人を選ぶ。入ったゲストは空いている席に自動で入る（main.js の決まり）。
// 違う席にしたいときは --no-start にして、続きの関数の中でホストの待合室の選択欄を変えてから「始める」を押す。
// 中継サーバー（公開の MQTT）につながる。音は出ない（ブラウザを --mute-audio で起こす）。
// ブラウザの部品は ../Claudeの使い道/tools/screen-check/node_modules の playwright-core（別の場所なら環境変数 HEADLESS_SHOT_MODULES に node_modules のフォルダ）。
// 終了コード: 0＝全部できた / 1＝使い方の誤り / 2＝操作の失敗か時間切れ（failed-*.png を撮り、result.json は書く）/ 3＝ブラウザか部品が見つからない。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, GAMES, fail, findGame, ruleEvals, ownerMark, startServer } from './play-common.mjs';

// ---------- 引数 ----------
const argv = process.argv.slice(2);
const opt = { rules: [], guests: 1, cpus: 0, start: true, script: null, app: null, out: null, size: '390x844', timeout: 180 };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const need = () => { if (i + 1 >= argv.length) fail(`${a} の値がありません`); return argv[++i]; };
  if (a === '--rule') opt.rules.push(need());
  else if (a === '--guests') opt.guests = Number(need());
  else if (a === '--cpus') opt.cpus = Number(need());
  else if (a === '--no-start') opt.start = false;
  else if (a === '--script') opt.script = need();
  else if (a === '--app') opt.app = need();
  else if (a === '--out') opt.out = need();
  else if (a === '--size') opt.size = need();
  else if (a === '--timeout') opt.timeout = Number(need());
  else if (a.startsWith('--')) fail(`知らないオプションです: ${a}`);
  else rest.push(a);
}
if (rest.length !== 1 || !opt.script) fail('使い方: node tools/play-two.mjs <ゲームの id か画面の名前> --script <ファイル.mjs> [オプション]（くわしくはこの台本の冒頭）');
for (const k of ['guests', 'cpus']) if (!Number.isInteger(opt[k]) || opt[k] < 0) fail(`--${k} は 0 以上の整数で書きます`);
if (!(opt.timeout > 0)) fail('--timeout は秒数で書きます');
const size = /^(\d+)x(\d+)$/.exec(opt.size);
if (!size) fail(`大きさは 幅x高さ（例 390x844）で書きます: ${opt.size}`);
if (!fs.existsSync(opt.script)) fail(`--script のファイルがありません: ${opt.script}`);
const gameId = findGame(rest[0]);
const game = GAMES[gameId];
const rules = ruleEvals(gameId, opt.rules);
const { ownerKey, storeKey } = ownerMark();

// ---------- ブラウザの部品 ----------
const require = createRequire(import.meta.url);
const modDirs = [process.env.HEADLESS_SHOT_MODULES, path.resolve(ROOT, '..', 'Claudeの使い道', 'tools', 'screen-check', 'node_modules')].filter(Boolean);
let pw = null;
for (const d of modDirs) { try { pw = require(path.join(d, 'playwright-core')); break; } catch { /* 次を試す */ } }
if (!pw) { console.error(`playwright-core が見つかりません（探した場所: ${modDirs.join(' / ')}）`); process.exit(3); }

const out = path.resolve(opt.out ?? fs.mkdtempSync(path.join(os.tmpdir(), 'play-two-')));
fs.mkdirSync(out, { recursive: true });
const result = { ok: false, game: gameId, code: null, value: null, error: null, console: [], pageErrors: [], shots: [] };
const { base, stop: stopServer } = await startServer(opt.app ? path.resolve(opt.app) : null);

let browser = null;
for (const channel of ['chrome', 'msedge']) {
  // --disable-gpu-compositing: 無いと、この PC（GPU あり）の画面に出さない Chrome では canvas に描き続けるページの描き替えが1秒に約4.5回に落ちる
  // （2026-11-20 に測った。白紙のページに canvas を1枚置いただけでも同じ。この設定で約61回）。エアホッケー・紙相撲などの動きが本物の端末の12分の1ほどの速さになっていた
  try { browser = await pw.chromium.launch({ channel, headless: true, args: ['--mute-audio', '--disable-gpu-compositing'] }); break; } catch { /* 次を試す */ }
}
if (!browser) { stopServer(); console.error('Chrome も Edge も起こせません'); process.exit(3); }

const pages = []; // [名前, ページ]
async function openPage(name) {
  const ctx = await browser.newContext({ viewport: { width: Number(size[1]), height: Number(size[2]) }, deviceScaleFactor: 2, locale: 'ja-JP' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && result.console.length < 100) result.console.push({ who: name, type: m.type(), text: m.text().slice(0, 500) }); });
  page.on('pageerror', (e) => { if (result.pageErrors.length < 50) result.pageErrors.push({ who: name, text: String(e.message).slice(0, 500) }); });
  page.on('dialog', (d) => { result.console.push({ who: name, type: 'dialog', text: `${d.type()}: ${d.message()}`.slice(0, 500) }); d.accept().catch(() => {}); });
  pages.push([name, page]);
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name, { full = false } = {}) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  result.shots.push(file);
  return file;
};

let code = null;
const guests = [];
// もう1人を部屋に入れる（部屋コードの付いた URL を開き、名前を入れる）
async function join(name = `ゲスト${guests.length + 1}`) {
  const page = await openPage(name);
  await page.goto(`${base}?room=${code}`);
  await page.fill('#ask-name', name);
  await page.press('#ask-name', 'Enter');
  await page.waitForSelector('#screen-play:not([hidden])');
  guests.push(page);
  return page;
}
// 待合室で、対局する席にいるゲストが「準備OK」を押す（押さないとホストは始められない。観戦の席の人にはボタンが出ないので飛ばす）
async function readyAll() {
  for (const page of guests) {
    const b = page.locator('#dock button:has-text("準備OK")');
    try { await b.waitFor({ timeout: 1500 }); } catch { continue; }
    await b.click();
  }
}

// 畳んである「⚙ 部屋のメニュー」と、その中の「部屋の人」を開けてから、その文字を含むボタンを押す
async function menu(page, text) {
  await page.evaluate(() => {
    for (const sel of ['details.play-menu', 'details.member-panel']) { const d = document.querySelector(sel); if (d && !d.open) d.querySelector('summary').click(); }
  });
  await page.locator('button', { hasText: text }).first().click();
}

// 終わり方は1回だけ（全体の上限の時計が先に走ったあとで続きの関数が返っても、成功として書き直して終了コード 0 で出ないように。2026-11-20 の Codex の点検）
let finishing = false;
const finish = async (exitCode) => {
  if (finishing) return;
  finishing = true;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 1));
  console.log(`${result.ok ? 'できた' : '止まった'}  ${game.name}（${gameId}）・部屋 ${result.code ?? '—'}・人 ${pages.length}人`);
  if (result.error) console.log(`  理由: ${result.error}`);
  if (result.value !== null) console.log(`  返した値 = ${JSON.stringify(result.value).slice(0, 300)}`);
  if (result.console.length || result.pageErrors.length) console.log(`  コンソールのエラー・警告 ${result.console.length} 件・ページの例外 ${result.pageErrors.length} 件`);
  for (const f of result.shots) console.log(`絵: ${f.replaceAll('\\', '/')}`);
  console.log(`結果: ${path.join(out, 'result.json').replaceAll('\\', '/')}`);
  try { await browser.close(); } catch { /* もう閉じている */ }
  stopServer();
  process.exit(exitCode);
};
const timer = setTimeout(async () => {
  result.error = `全体の上限（${opt.timeout} 秒）を超えた`;
  for (const [name, page] of pages) { try { await shot(page, `failed-${name}`); } catch { /* 撮れなくても続ける */ } }
  finish(2);
}, opt.timeout * 1000);

try {
  // ---------- ホストが部屋を作る ----------
  const host = await openPage('ホスト');
  await host.goto(base);
  await host.evaluate(([k, v]) => localStorage.setItem(k, v), [storeKey, ownerKey]);
  await host.goto(base);
  await host.waitForSelector('#game-list .tile');
  await host.click(`.game-cat:not([data-cat="fav"]) .tile[data-id="${gameId}"]`);
  await host.click('button:has-text("部屋を作る")');
  await host.fill('#ask-name', 'ホスト');
  await host.press('#ask-name', 'Enter');
  await host.waitForSelector('#dock button:has-text("始める")');
  code = new URL(host.url()).searchParams.get('room');
  if (!code) throw new Error('部屋コードを URL から読めない');
  result.code = code;
  for (const r of rules) await host.evaluate(r.eval);
  for (let i = 0; i < opt.cpus; i++) await host.click('[data-keep="cpu-plus"]');
  // ---------- ゲストが入る ----------
  for (let i = 0; i < opt.guests; i++) {
    const name = `ゲスト${i + 1}`;
    await join(name);
    await host.waitForFunction((n) => document.querySelector('#board')?.textContent.includes(n), name);
  }
  if (opt.start) {
    await readyAll();
    await host.click('#dock button:has-text("始める"):not([disabled])');
    await sleep(600);
  }
  // ---------- 続きの関数 ----------
  const mod = await import(pathToFileURL(path.resolve(opt.script)).href);
  if (typeof mod.default !== 'function') throw new Error('--script のファイルに export default の関数が無い');
  result.value = (await mod.default({ host, guests, join, readyAll, menu, shot, sleep, base, code })) ?? null;
  result.ok = true;
  clearTimeout(timer);
  await finish(0);
} catch (e) {
  clearTimeout(timer);
  result.error = String(e?.stack ?? e).slice(0, 1500);
  for (const [name, page] of pages) { try { await shot(page, `failed-${name}`); } catch { /* 撮れなくても続ける */ } }
  await finish(2);
}
