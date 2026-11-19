// tools/play-shot.mjs（1人と CPU）と tools/play-two.mjs（人が2人）が共に使う部品。単独では動かさない。
// ゲームの一覧と詳細設定・持ち主の印・確認用サーバーの起こし方を1か所に置く（2026-11-19。play-two.mjs を足したときに play-shot.mjs から分けた）。

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function fail(msg) { console.error(msg); process.exit(1); }

// ---------- ゲームと詳細設定 ----------
export const { GAMES } = await import(pathToFileURL(path.join(ROOT, 'app', 'js', 'games', 'index.js')).href);
export const findGame = (word) => {
  if (GAMES[word]) return word;
  const byName = Object.keys(GAMES).filter((id) => GAMES[id].name === word);
  if (byName.length === 1) return byName[0];
  const near = Object.keys(GAMES).filter((id) => id.includes(word) || String(GAMES[id].name).includes(word));
  fail(`ゲームが見つかりません: ${word}${near.length ? `\n近いもの: ${near.map((id) => `${id}（${GAMES[id].name}）`).join('・')}` : '\n一覧は node tools/play-shot.mjs --list'}`);
};
export const showSettings = (id) => {
  const g = GAMES[id];
  console.log(`${id}（${g.name}）`);
  for (const x of g.settings ?? []) {
    const vals = x.choices ? x.choices.map(([v, n]) => `${JSON.stringify(v)}＝${n}`).join(' / ') : 'true / false';
    console.log(`  --rule ${x.key}=…  ${x.label}（最初は ${JSON.stringify(x.def)}）: ${vals}`);
  }
  if (!g.settings?.length) console.log('  詳細設定はありません');
};

// --rule 鍵=値 の一覧を、待合室の詳細設定を変える操作（{ eval: ページの中で動かす式, as: 'rule_鍵' }）の一覧に直す。
// 鍵か値が違えば、そのゲームの詳細設定の一覧を出して止まる
const parseValue = (s) => (s === 'true' ? true : s === 'false' ? false : /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
export const ruleEvals = (gameId, pairs) => pairs.map((pair) => {
  const game = GAMES[gameId];
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

// ---------- 持ち主の印（owner.js から読む。ここには写さない） ----------
export function ownerMark() {
  const ownerSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'owner.js'), 'utf8');
  const ownerKey = ownerSrc.match(/const OWNER_KEY = '([0-9a-f]+)'/)?.[1];
  const storeKey = ownerSrc.match(/const STORE_KEY = '([^']+)'/)?.[1];
  if (!ownerKey || !storeKey) fail('app/js/owner.js から OWNER_KEY・STORE_KEY を読めません（書き方が変わったら、tools/play-common.mjs の読み方を直す）');
  return { ownerKey, storeKey };
}

// ---------- 確認用サーバー（tools/serve.js）を空いている番号で起こす ----------
// appDir = 見せるフォルダ（無ければ app/。絶対パスも書ける。app/ と native/www のほかは serve.js が無音にしないが、画面に出さないブラウザは音を消して起こす）。
// 返すのは { base: 'http://localhost:番号/', stop() }。この台本が終わるときにも止める
export async function startServer(appDir = null) {
  const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
  const port = await freePort();
  const base = `http://localhost:${port}/`;
  const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.js'), String(port), ...(appDir ? [appDir] : [])], { stdio: 'ignore' });
  const stop = () => { try { server.kill(); } catch { /* もう止まっている */ } };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try { up = (await fetch(base)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) { stop(); fail(`確認用サーバーが起きません（${base}）`); }
  return { base, stop };
}
