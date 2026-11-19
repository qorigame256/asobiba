#!/usr/bin/env node
// 手元の確認の「始め方」を1回の命令にする台本（2026-11-19 本人の決定。無駄探しで、ブラウザで確かめる会話40本のうち31本が
// 「手元で持ち主として部屋を作る方法」をコードから調べ直していたため）。
// すること: 確認用サーバー（tools/serve.js。音は出ない）を空いている番号で起こす → 画面に出さないブラウザで開く → 持ち主の印を入れる →
//   ゲームを選んで部屋を作る → 詳細設定と CPU の数を入れる → 「始める」を押す → 続きの操作（--steps）を動かす → サーバーを止める。
// ブラウザを動かすのは ../Claudeの使い道/tools/headless-shot.js（絵 *.png と result.json を --out に書く。操作の JSON の書き方もそちらの冒頭）。
// 別の場所の headless-shot.js を使うときは環境変数 HEADLESS_SHOT にそのパスを入れる。
//
// 使い方（プロジェクトのフォルダで）:
//   node tools/play-shot.mjs <ゲームの id か画面の名前> [オプション]
//     --rule <鍵>=<値>    詳細設定を1つ変える（何回でも書ける）。値は true / false / 数 / 文字。例: --rule revolution=false --rule match=3
//                         鍵と選べる値は --list <ゲーム> で出る（違う鍵を書くと、その一覧を出して止まる）
//     --cpus <数>         「CPU を増やす」を押す回数（カードなど人数の決まらないゲーム。既定 0＝足りない分だけ自動で入る）
//     --local             部屋を作らず「この画面で2人で」で始める（そのボタンがあるゲームだけ。--rule・--cpus は使えない）。
//                         エアホッケーは「CPU と対戦」で始める（部屋は人が2人そろうまで始められないため）
//     --no-start          待合室で止める（「始める」を押さない）
//     --steps <ファイル>   始めたあとに続ける操作（headless-shot.js の操作の JSON。Write で作ったファイルで渡す）。無ければ2.5秒待って start.png を1枚撮って終わる
//                         （始めた直後は席の紹介の演出が2秒ほど出るので、続きの操作の頭に {"wait": 2500} を入れる）
//     --out <フォルダ>     絵と result.json の置き場所（既定は headless-shot.js の既定＝一時フォルダ。場所は最後に出る）
//     --size <幅x高さ>     画面の大きさ（既定 390x844）
//     --timeout <秒>       全体の上限（既定 120）
//     --name <名前>        部屋で名乗る名前（既定「かくにん」）
//   node tools/play-shot.mjs --list [ゲーム]   ゲームの id と名前を出す。ゲームを付けると、そのゲームの詳細設定の鍵と選べる値を出す
//
// 続きの操作で使える目印: 盤は #board、下の段は #controls、「始める」「もう一回」などの大きなボタンは #dock、上の知らせは #status。
//   ゲームの中の部品の名前は app/js/games/<ゲーム>.js の render を見る。局面を数で確かめるときは {"eval": "…", "as": "名前"}（結果は result.json の evals）。
// 中継サーバー（公開の MQTT）につながる。部屋にいるのは自分1人と CPU だけ（2人目の人は入れられない）。
// 持ち主の印は app/js/owner.js の STORE_KEY・OWNER_KEY をその場で読む（ここには写さない）。
// 終了コード: headless-shot.js のものをそのまま返す（0＝全部できた / 2＝操作の失敗か時間切れ）。使い方の誤りは 1。

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HS = process.env.HEADLESS_SHOT || path.resolve(ROOT, '..', 'Claudeの使い道', 'tools', 'headless-shot.js');

function fail(msg) { console.error(msg); process.exit(1); }

// ---------- 引数 ----------
const argv = process.argv.slice(2);
const opt = { rules: [], cpus: 0, local: false, start: true, steps: null, out: null, size: null, timeout: null, name: 'かくにん', list: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const need = () => { if (i + 1 >= argv.length) fail(`${a} の値がありません`); return argv[++i]; };
  if (a === '--rule') opt.rules.push(need());
  else if (a === '--cpus') opt.cpus = Number(need());
  else if (a === '--local') opt.local = true;
  else if (a === '--no-start') opt.start = false;
  else if (a === '--steps') opt.steps = need();
  else if (a === '--out') opt.out = need();
  else if (a === '--size') opt.size = need();
  else if (a === '--timeout') opt.timeout = need();
  else if (a === '--name') opt.name = need();
  else if (a === '--list') opt.list = true;
  else if (a.startsWith('--')) fail(`知らないオプションです: ${a}`);
  else rest.push(a);
}
if (!Number.isInteger(opt.cpus) || opt.cpus < 0) fail('--cpus は 0 以上の整数で書きます');

// ---------- ゲームと詳細設定 ----------
const { GAMES } = await import(pathToFileURL(path.join(ROOT, 'app', 'js', 'games', 'index.js')).href);
const findGame = (word) => {
  if (GAMES[word]) return word;
  const byName = Object.keys(GAMES).filter((id) => GAMES[id].name === word);
  if (byName.length === 1) return byName[0];
  const near = Object.keys(GAMES).filter((id) => id.includes(word) || String(GAMES[id].name).includes(word));
  fail(`ゲームが見つかりません: ${word}${near.length ? `\n近いもの: ${near.map((id) => `${id}（${GAMES[id].name}）`).join('・')}` : '\n一覧は node tools/play-shot.mjs --list'}`);
};
const showSettings = (id) => {
  const g = GAMES[id];
  console.log(`${id}（${g.name}）`);
  for (const x of g.settings ?? []) {
    const vals = x.choices ? x.choices.map(([v, n]) => `${JSON.stringify(v)}＝${n}`).join(' / ') : 'true / false';
    console.log(`  --rule ${x.key}=…  ${x.label}（最初は ${JSON.stringify(x.def)}）: ${vals}`);
  }
  if (!g.settings?.length) console.log('  詳細設定はありません');
};
if (opt.list) {
  if (rest[0]) showSettings(findGame(rest[0]));
  else console.log(Object.keys(GAMES).filter((id) => GAMES[id].ready).map((id) => `${id}（${GAMES[id].name}）`).join('\n'));
  process.exit(0);
}
if (rest.length !== 1) fail('使い方: node tools/play-shot.mjs <ゲームの id か画面の名前> [オプション]（くわしくはこの台本の冒頭）');
const gameId = findGame(rest[0]);
const game = GAMES[gameId];
if (opt.local && (opt.rules.length || opt.cpus)) fail('--local では --rule と --cpus は使えません（待合室を通らないため）');
// ホームの小窓に出るボタンは main.js の「部屋を作る」の所と同じ分け方（live＝毎フレーム動くゲーム。エアホッケー・紙相撲）
if (opt.local && game.live && game.onlineOnly) fail(`${game.name} はオンラインだけのゲームです（--local は使えません。待合室までなら --no-start）`);
if (opt.local && !game.live && (game.multi || game.noLocal)) fail(`${game.name} には「この画面で2人で」がありません（--local を外して部屋を作ります）`);
if (!opt.local && game.live && opt.start) fail(`${game.name} の部屋は、人が2人そろうまで始められません。1人で確かめるなら --local（CPU と対戦）、待合室までなら --no-start を付けます`);
const localButton = game.live ? 'CPU と対戦' : 'この画面で2人で';

// --rule 鍵=値 を「欄の見出し・選ぶ番号（選択肢）か はい/いいえ」に直す
const parseValue = (s) => (s === 'true' ? true : s === 'false' ? false : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
const ruleSteps = opt.rules.map((pair) => {
  const eq = pair.indexOf('=');
  if (eq < 1) fail(`--rule は 鍵=値 で書きます: ${pair}`);
  const key = pair.slice(0, eq); const raw = pair.slice(eq + 1);
  const x = (game.settings ?? []).find((s) => s.key === key);
  if (!x) { showSettings(gameId); fail(`${game.name} に詳細設定「${key}」はありません`); }
  let want;
  if (x.choices) {
    const idx = x.choices.findIndex(([v]) => v === parseValue(raw) || String(v) === raw);
    if (idx < 0) { showSettings(gameId); fail(`${x.label}（${key}）に「${raw}」はありません`); }
    want = { idx };
  } else {
    const v = parseValue(raw);
    if (typeof v !== 'boolean') fail(`${x.label}（${key}）は true か false です: ${raw}`);
    want = { on: v };
  }
  // 待合室は設定を1つ変えるたびに描き直すので、毎回 欄を探し直す。見つからなければ例外にして、そこで止める
  const js = `(() => {
    const det = [...document.querySelectorAll('#board details.lobby-rules')].find((d) => (d.querySelector('summary')?.textContent ?? '').startsWith('詳細設定'));
    if (!det) throw new Error('待合室に詳細設定が無い');
    const lab = [...det.querySelectorAll('label')].find((l) => l.querySelector('b')?.textContent === ${JSON.stringify(x.label)});
    if (!lab) throw new Error('詳細設定の欄が無い: ' + ${JSON.stringify(x.label)});
    const sel = lab.querySelector('select'); const cb = lab.querySelector('input[type=checkbox]');
    if (sel) { sel.value = ${JSON.stringify(String(want.idx ?? 0))}; sel.dispatchEvent(new Event('change')); return sel.options[sel.selectedIndex].textContent; }
    if (cb) { if (cb.checked !== ${JSON.stringify(want.on ?? false)}) cb.click(); return cb.checked; }
    throw new Error('欄に選ぶ部品が無い: ' + ${JSON.stringify(x.label)});
  })()`;
  return { eval: js, as: `rule_${key}` };
});

// ---------- 持ち主の印（owner.js から読む） ----------
const ownerSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'owner.js'), 'utf8');
const ownerKey = ownerSrc.match(/const OWNER_KEY = '([0-9a-f]+)'/)?.[1];
const storeKey = ownerSrc.match(/const STORE_KEY = '([^']+)'/)?.[1];
if (!ownerKey || !storeKey) fail('app/js/owner.js から OWNER_KEY・STORE_KEY を読めません（書き方が変わったら、この台本の読み方を直す）');
if (!fs.existsSync(HS)) { console.error(`headless-shot.js がありません: ${HS}\n別の場所にあるときは環境変数 HEADLESS_SHOT に入れます`); process.exit(3); }

// ---------- 確認用サーバーを空いている番号で起こす ----------
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const port = await freePort();
const base = `http://localhost:${port}/`;
const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), String(port)], { stdio: 'ignore' });
const stopServer = () => { try { server.kill(); } catch { /* もう止まっている */ } };
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
let up = false;
for (let i = 0; i < 50 && !up; i++) {
  try { up = (await fetch(base)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
if (!up) { stopServer(); fail(`確認用サーバーが起きません（${base}）`); }

// ---------- 操作を組み立てる ----------
const steps = [
  { eval: `localStorage.setItem(${JSON.stringify(storeKey)}, ${JSON.stringify(ownerKey)}); 'ok'`, as: 'owner' },
  { goto: base },
  { waitFor: '#game-list .tile' },
  { click: `.game-cat:not([data-cat="fav"]) .tile[data-id="${gameId}"]` },
];
if (opt.local) {
  steps.push({ click: `button:has-text("${localButton}")` }, { waitFor: '#screen-play:not([hidden])' }, { wait: 400 });
} else {
  steps.push(
    { click: 'button:has-text("部屋を作る")' },
    { waitFor: '#ask-name' },
    { fill: '#ask-name', value: opt.name },
    { press: 'Enter' },
    { waitFor: '#dock button:has-text("始める")' },
    ...ruleSteps,
    ...Array.from({ length: opt.cpus }, () => ({ click: '[data-keep="cpu-plus"]' })),
  );
  if (opt.start) steps.push({ click: '#dock button:has-text("始める")' }, { wait: 600 });
}
if (opt.steps) {
  let extra;
  try { extra = JSON.parse(fs.readFileSync(opt.steps, 'utf8').replace(/^﻿/, '')); } catch (e) { stopServer(); fail(`--steps を読めません: ${opt.steps}\n${e.message}`); }
  if (!Array.isArray(extra)) { stopServer(); fail('--steps の中身は操作の配列で書きます'); }
  steps.push(...extra);
} else steps.push({ wait: opt.start || opt.local ? 2500 : 0 }, { shot: opt.start || opt.local ? 'start' : 'lobby' }); // 始めた直後は席の紹介の演出が2秒ほど出る

const stepsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'play-shot-')), 'steps.json');
fs.writeFileSync(stepsFile, JSON.stringify(steps, null, 1));

// ---------- headless-shot.js に渡す ----------
const args = [HS, base, '--steps', stepsFile];
if (opt.out) args.push('--out', opt.out);
if (opt.size) args.push('--size', opt.size);
if (opt.timeout) args.push('--timeout', opt.timeout);
console.log(`${game.name}（${gameId}）・${opt.local ? localButton : '部屋を作る'}  ${base}`);
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => {
  stopServer();
  try { fs.rmSync(path.dirname(stepsFile), { recursive: true, force: true }); } catch { /* 残っても一時フォルダ */ }
  process.exit(code ?? 2);
});
