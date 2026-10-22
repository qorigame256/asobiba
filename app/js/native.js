// アプリならではの良さ（App Store 版だけ。2026-10-22 本人の決定。審査 4.2。.claude/rules/appstore.md）。ウェブ版では何もしない。
// - 振動: 番が来たとき・決着したとき（勝ちは強め・負けは弱め）・自分の手が受け付けられたとき（軽く）。部品は @capacitor/haptics。
//   ホームの下の段の「📳 振動」で付け外しする（端末ごとに覚える。最初はオン。本人の決定）。
// - 実績（Game Center）: 下の ACHIEVEMENTS の10個。数は端末ごとに数え、ログインしていれば Game Center へ送る。
//   ログインの画面を出すのは、初めて実績を取ったときと、ホームの「🏅 実績」を押したときだけ（初めて開いたときは追跡の許可の画面が出るので重ねない）。
//   一度ログインできた端末は、次の起動からは画面を出さずにつなぐ（iPhone が「おかえりなさい」の帯を出すだけ）。
// - ランキング（Game Center）: records.js が決めた記録を送り、ランキングの画面で順位を読む（ログインの画面を出すのは、ランキングの画面で順位を見るときだけ）。
// - 画像で保存・共有: いまの画面を画像にして iPhone の共有の画面を開く（画像を保存・LINE など）。結果の画面とお絵描き当ての答えの場面に出す。
// iPhone 側は native/plugins/asobiba-native（Game Center と画像。自前の部品）と @capacitor/haptics（振動）。

import { IS_APP } from './platform.js';

const HAPTICS_KEY = 'bg-haptics';
const ACH_KEY = 'bg-achv';
const GC_KEY = 'bg-gc'; // 一度 Game Center にログインできた端末
// 実績の番号は App Store Connect の Game Center にも同じ番号で登録する（本人の作業。登録したら変えられない。Claude の判断）
const ACH_PREFIX = 'io.github.qorigame256.asobiba.ach.';
// [番号の後ろ, 名前（登録するときの目安）, 進み具合 0〜1]。kinds は遊んだゲームの種類の数、total は全部のゲームの数
const ACHIEVEMENTS = [
  ['firstwin', '初めて勝った', (a) => a.wins / 1],
  ['win10', '10勝', (a) => a.wins / 10],
  ['win50', '50勝', (a) => a.wins / 50],
  ['streak3', '3連勝', (a) => a.best / 3],
  ['kinds5', '5種類のゲームで遊んだ', (a) => a.played.length / 5],
  ['kinds20', '20種類のゲームで遊んだ', (a) => a.played.length / 20],
  ['kindsall', 'すべてのゲームで遊んだ', (a, total) => a.played.length / total],
  ['cpuhard', 'CPU の「つよい」に勝った', (a) => (a.cpuhard ? 1 : 0)],
  ['human', '人と対局した', (a) => (a.human ? 1 : 0)],
  ['room5', '部屋に5人そろった', (a) => (a.room5 ? 1 : 0)],
];

const cap = () => (IS_APP ? window.Capacitor : null);
const plugin = (name) => (cap()?.isPluginAvailable?.(name) ? cap().registerPlugin?.(name) ?? null : null);
let haptics; // 振動の部品（使えないときは null）
let gc; // 自前の部品（使えないときは null）
const getHaptics = () => (haptics === undefined ? (haptics = plugin('Haptics')) : haptics);
const getGc = () => (gc === undefined ? (gc = plugin('AsobibaNative')) : gc);

function load(key) { try { return localStorage.getItem(key); } catch { return null; } }
function store(key, v) { try { localStorage.setItem(key, v); } catch { /* 覚えられなくても動く */ } }

/* ---------- 振動 ---------- */

export const canHaptic = () => !!getHaptics();
export const hapticsOn = () => load(HAPTICS_KEY) !== '0';
export function setHapticsOn(on) { store(HAPTICS_KEY, on ? '1' : '0'); }

// kind: 'turn'（番が来た）・'win'・'lose'・'tap'（自分の手が受け付けられた）
export function haptic(kind) {
  const h = getHaptics();
  if (!h || !hapticsOn()) return;
  const p = kind === 'turn' ? h.notification({ type: 'WARNING' })
    : kind === 'win' ? h.notification({ type: 'SUCCESS' })
      : kind === 'lose' ? h.impact({ style: 'MEDIUM' })
        : h.impact({ style: 'LIGHT' });
  p?.catch?.(() => {});
}

/* ---------- 実績 ---------- */

let total = 1; // 全部のゲームの数（main.js が initNative で渡す）
let signedIn = false;
let asking = null; // ログインの途中（重ねて聞かない）

function readAch() {
  let a = null;
  try { a = JSON.parse(load(ACH_KEY) ?? 'null'); } catch { /* 壊れていたら0から */ }
  return {
    wins: Number.isInteger(a?.wins) ? a.wins : 0,
    streak: Number.isInteger(a?.streak) ? a.streak : 0,
    best: Number.isInteger(a?.best) ? a.best : 0,
    played: Array.isArray(a?.played) ? a.played.filter((x) => typeof x === 'string') : [],
    cpuhard: !!a?.cpuhard, human: !!a?.human, room5: !!a?.room5,
    seen: Array.isArray(a?.seen) ? a.seen.slice(-20) : [], // 数えた対局（描き直しで2回数えない）
  };
}
const done = (a) => ACHIEVEMENTS.filter(([, , f]) => f(a, total) >= 1).length;

// 数を変えて覚える。新しく取った実績があれば、まだログインしていない端末ではここで初めてログインの画面を出す
function update(fn) {
  if (!IS_APP) return;
  const a = readAch();
  const before = done(a);
  fn(a);
  store(ACH_KEY, JSON.stringify(a));
  if (signedIn) report(a);
  else if (done(a) > before) signIn().then((ok) => { if (ok) report(readAch()); });
}

function report(a) {
  const list = ACHIEVEMENTS.map(([id, , f]) => ({ id: ACH_PREFIX + id, percent: Math.round(Math.min(1, f(a, total)) * 1000) / 10 })).filter((x) => x.percent > 0);
  getGc()?.reportAchievements({ list })?.catch?.(() => {});
}

async function signIn() {
  const g = getGc();
  if (!g) return false;
  if (signedIn) return true;
  asking ??= g.signIn().then((r) => !!r?.ok, () => false).finally(() => { asking = null; });
  const was = signedIn;
  signedIn = await asking;
  if (signedIn) store(GC_KEY, '1');
  if (signedIn && !was) signedInWatchers.forEach((fn) => fn());
  return signedIn;
}
const signedInWatchers = new Set();
// Game Center にログインできたときに1回呼ぶ（records.js がたまっている記録を送る）
export function onGcSignedIn(fn) { signedInWatchers.add(fn); }

// 起動のときに1回。前にログインできた端末なら、画面を出さずにつないで、たまっている分を送る
export function initNative({ games }) {
  total = Math.max(1, games);
  if (!IS_APP || load(GC_KEY) !== '1') return;
  signIn().then((ok) => { if (ok) report(readAch()); });
}

export const canAchieve = () => !!getGc();

// ホームの「🏅 実績」: ログインして（まだなら画面を出して）Game Center の実績の画面を開く。開けなければ false
export async function openAchievements() {
  if (!(await signIn())) return false;
  report(readAch());
  const r = await getGc().showAchievements().catch(() => null);
  return !!r?.ok;
}

// 対局者として対局を始めた（同じ画面の対局も。遊んだゲームの種類を数える）
export function notePlayed(gameId) {
  if (!IS_APP || readAch().played.includes(gameId)) return;
  update((a) => { if (!a.played.includes(gameId)) a.played.push(gameId); });
}

// オンラインで対局者として決着を見た。key は対局ごとに1つ（同じ対局を2回数えない）
// won: 自分が勝った（同点の1位も）・beatHardCpu: CPU の「つよい」がいる対局で勝った・withHuman: ほかの人と対局した
export function noteResult(key, { won, beatHardCpu, withHuman }) {
  if (!IS_APP || readAch().seen.includes(key)) return;
  update((a) => {
    a.seen = [...a.seen, key].slice(-20);
    if (won) { a.wins++; a.streak++; a.best = Math.max(a.best, a.streak); } else a.streak = 0;
    if (beatHardCpu) a.cpuhard = true;
    if (withHuman) a.human = true;
  });
}

// 部屋に5人以上そろった
export function noteRoomSize(n) {
  if (!IS_APP || n < 5 || readAch().room5) return;
  update((a) => { a.room5 = true; });
}

/* ---------- ランキング（Game Center。2026-10-22 本人の決定。何を送るかは records.js） ---------- */

// 記録を送る（ログインしているときだけ。ここではログインの画面を出さない）。list: [{ id, value }]
export function reportScores(list) {
  if (!IS_APP || !signedIn || !list.length) return;
  getGc()?.reportScores({ list })?.catch?.(() => {});
}

// ランキングを読む（まだならログインの画面を出す）。scope: 'global'（全国）| 'friends'（Game Center の友だち）。
// { entries: [{ rank, name, value, me }], mine: { rank, value } | null, total } か、読めなければ null。name は外から来た文字（出すときは esc を通す）
export async function loadBoard(id, scope) {
  if (!(await signIn())) return null;
  const r = await getGc().loadScores({ id, scope, count: 10 }).catch(() => null);
  if (!r?.ok) return null;
  const num = (x) => (Number.isFinite(x) ? Math.trunc(x) : null);
  const entries = (Array.isArray(r.entries) ? r.entries : []).slice(0, 10)
    .map((e) => ({ rank: num(e?.rank), name: String(e?.name ?? '').slice(0, 40), value: num(e?.value), me: !!e?.me }))
    .filter((e) => e.rank !== null && e.value !== null);
  const mine = r.mine && num(r.mine.rank) !== null ? { rank: num(r.mine.rank), value: num(r.mine.value) } : null;
  return { entries, mine, total: num(r.total) ?? entries.length };
}
export const canRank = () => !!getGc();

/* ---------- 画像で保存・共有 ---------- */

export const canShare = () => !!getGc();
export async function shareScreen() {
  const r = await getGc()?.shareScreen().catch(() => null);
  return !!r?.ok;
}
