// 自分の記録とランキング（2026-10-22 本人の決定。CLAUDE.md の「ランキング・スキン」）。
// 端末ごとに localStorage の bg-records に覚える（部屋の人には送らない。アプリ版は Game Center へだけ送る）。
// - 遊んだ対局（played）: 対局者として決着を見た対局の数（同じ画面の対局も・CPU 相手も）。色の解放に使う
// - 人がいた対局の勝ち（hwins）: オンラインで、自分のほかに人が1人以上いた対局で勝った数。ランキングと色の解放に使う
// - 自己ベスト（best）: ゲームの record があるもの（ヨット・玉入れ・弾幕回避・記憶リレー・ブラックジャック）。詳細設定の組み合わせ（record.keys）ごとに、いちばん大きい数字。
//   オンラインで自分の席の分だけ（同じ画面の対局は、どの席が自分か分からないので入れない）
// Game Center のランキングは「勝った回数」と、record.gc の設定ごとの自己ベスト（ほかの設定が最初の値の対局だけ。本人の決定）。
// 番号は LB_PREFIX ＋ ゲーム ＋ gc の設定（App Store Connect に同じ番号で、「いちばん大きい数字を残す」形で登録する。本人の作業。登録したら変えられない）。
// エアホッケーは結果が main.js を通らないので数えない。

import { reportScores, onGcSignedIn } from './native.js';

const KEY = 'bg-records';
export const LB_PREFIX = 'io.github.qorigame256.asobiba.lb.';
export const WINS_LB = LB_PREFIX + 'wins';

function load() {
  let a = null;
  try { a = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* 壊れていたら0から */ }
  const best = {};
  if (a?.best && typeof a.best === 'object') {
    for (const [k, v] of Object.entries(a.best)) if (typeof k === 'string' && Number.isInteger(v?.v)) best[k] = { v: v.v, d: typeof v.d === 'string' ? v.d.slice(0, 10) : '' };
  }
  return {
    played: Number.isInteger(a?.played) ? a.played : 0,
    hwins: Number.isInteger(a?.hwins) ? a.hwins : 0,
    best,
    seen: Array.isArray(a?.seen) ? a.seen.filter((x) => typeof x === 'string').slice(-20) : [], // 数えた対局（描き直しで2回数えない）
  };
}
function save(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* 覚えられなくても遊べる */ }
}
export const readRecords = load;

const val = (v) => (v === true ? 'on' : v === false ? 'off' : String(v));
const normOf = (rec, rules) => (rec.norm ? rec.norm(rules) : rules);
const defsOf = (game) => Object.fromEntries((game.settings ?? []).map((x) => [x.key, x.def]));

// 記録を分ける鍵（ゲーム＋詳細設定の組み合わせ）。rules は main.js の rulesOf で整えた値
export function recordKey(game, rules) {
  const r = normOf(game.record, rules);
  return [game.id, ...game.record.keys.map((k) => `${k}=${val(r[k])}`)].join('|');
}

// Game Center のランキングの番号。gc に入っていない設定が最初の値でなければ null（送らない）
export function boardId(game, rules) {
  const rec = game.record;
  const r = normOf(rec, rules);
  const def = defsOf(game);
  if (rec.keys.some((k) => !rec.gc.includes(k) && r[k] !== def[k])) return null;
  return LB_PREFIX + [game.id, ...rec.gc.map((k) => k + val(r[k]))].join('.');
}

// 鍵（recordKey）から、最初の設定と違う所を「短い版: あり・60秒」のような文字にする。全部最初なら「最初の設定」
export function rulesText(game, key) {
  const parts = [];
  for (const kv of key.split('|').slice(1)) {
    const [k, v] = kv.split('=');
    const x = game.settings?.find((s) => s.key === k);
    if (!x || val(x.def) === v) continue;
    const choice = x.choices?.find(([c]) => val(c) === v);
    parts.push(choice ? `${x.label}: ${choice[1]}` : `${x.label}: ${v === 'on' ? 'あり' : 'なし'}`);
  }
  return parts.length ? parts.join('・') : '最初の設定';
}

// Game Center のランキングの一覧（ランキングの画面で選ぶ）。[{ id, label }]
export function allBoards(games) {
  const list = [{ id: WINS_LB, label: '🏆 人がいた対局で勝った回数' }];
  for (const game of Object.values(games)) {
    const rec = game.record;
    if (!rec) continue;
    let combos = [{}];
    for (const k of rec.gc) {
      const x = game.settings.find((s) => s.key === k);
      const vs = x.choices ? x.choices.map(([c]) => c) : [false, true];
      combos = combos.flatMap((c) => vs.map((v) => ({ ...c, [k]: v })));
    }
    for (const c of combos) {
      const rules = { ...defsOf(game), ...c };
      const id = boardId(game, rules);
      if (!id || list.some((b) => b.id === id)) continue;
      const t = rulesText(game, recordKey(game, rules));
      list.push({ id, gameId: game.id, label: `${game.icon ?? ''} ${game.name}（${rec.label}）${t === '最初の設定' ? '' : '・' + t}`.trim() });
    }
  }
  return list;
}

const watchers = new Set();
// 記録が変わったときに呼ぶ（色の解放の知らせのため）。fn(前の記録, 今の記録)
export function onRecords(fn) { watchers.add(fn); }

// 対局者として決着を見た。key は対局ごとに1つ（同じ対局を2回数えない）。
// won: 自分が勝った・withHuman: 自分のほかに人がいた（オンライン）・best: { game, rules, value }（自己ベストを取るゲームの、自分の席の数字）
// 新しい自己ベストなら true を返す
export function noteGame(key, { won, withHuman, best }) {
  const before = load();
  if (before.seen.includes(key)) return false;
  const a = { ...before, best: { ...before.best }, seen: [...before.seen, key].slice(-20) };
  a.played++;
  if (won && withHuman) a.hwins++;
  let isNew = false;
  const out = [];
  if (best && Number.isInteger(best.value)) {
    const k = recordKey(best.game, best.rules);
    if (!a.best[k] || best.value > a.best[k].v) {
      isNew = !!a.best[k]; // 初めての記録は「自己ベスト更新」と言わない
      a.best[k] = { v: best.value, d: new Date().toISOString().slice(0, 10) };
    }
    const id = boardId(best.game, best.rules);
    if (id) out.push({ id, value: a.best[k].v });
  }
  if (a.hwins !== before.hwins) out.push({ id: WINS_LB, value: a.hwins });
  save(a);
  if (out.length) reportScores(out);
  watchers.forEach((fn) => fn(before, a));
  return isNew;
}

// Game Center にログインできたら、いままでの記録をまとめて送る（Game Center はいちばん大きい数字を残すので、何度送ってもよい）
export function initRecords(games) {
  onGcSignedIn(() => {
    const a = load();
    const out = [{ id: WINS_LB, value: a.hwins }];
    for (const [k, b] of Object.entries(a.best)) {
      const [gameId, ...kvs] = k.split('|');
      const game = games[gameId];
      if (!game?.record) continue;
      const rules = { ...defsOf(game) };
      for (const kv of kvs) {
        const [kk, v] = kv.split('=');
        const x = game.settings.find((s) => s.key === kk);
        if (!x) continue;
        const c = x.choices ? x.choices.find(([cv]) => val(cv) === v)?.[0] : v === 'on';
        if (c !== undefined) rules[kk] = c;
      }
      const id = boardId(game, rules);
      if (id) out.push({ id, value: b.v });
    }
    reportScores(out);
  });
}
