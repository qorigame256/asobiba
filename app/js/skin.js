// スキン（アプリ全体の色。2026-10-22 本人の決定。CLAUDE.md の「ランキング・スキン」）。色の値は css/style.css の :root[data-skin="…"]。
// - はじめから選べる色・遊んで解放する色（records.js の記録で決める）・アプリ版で買う色（1色ずつの買い切り。ウェブ版には出さない）
// - 選んだ色は localStorage の bg-skin（端末ごと。部屋の人には送らない）。index.html の頭の小さな台本が、画面を描く前に同じ値を当てる（ちらつかないように）
// - 買う色を選んでいても、買った記録が iPhone に無いと分かったら（返金など）いつもの色に戻す。聞けるまでは戻さない
// 人ごとの色（--p0〜--p3）は替えない（友だちと「オレンジの方」と話すとき画面ごとに違うと困るため）。

import { IS_APP } from './platform.js';
import { readRecords } from './records.js';
import { owns, ownedChecked, canBuy } from './ads.js';

const KEY = 'bg-skin';
// 買う色の商品の番号（App Store Connect に「非消耗型」で同じ番号を登録する。本人の作業。登録したら変えられない）
export const SKIN_PREFIX = 'io.github.qorigame256.asobiba.skin.';

// kind: free（はじめから）・unlock（遊んで解放。need の数に届いたら）・buy（アプリ版で買う）。sw: 色見本の [地, 差し色]（模様の色は css のまま）
export const SKINS = [
  { id: 'std', name: 'いつもの（橙）', kind: 'free', sw: ['#f7f2e9', '#d9643a'] },
  { id: 'sora', name: '空色', kind: 'free', sw: ['#eef4fb', '#2f7fd0'] },
  { id: 'wakaba', name: '若葉', kind: 'free', sw: ['#eef6ec', '#3c9a5a'] },
  { id: 'sakura', name: '桜', kind: 'free', sw: ['#fbf0f3', '#d9577f'] },
  { id: 'yoru', name: '夜', kind: 'free', sw: ['#1d2230', '#5b9cf0'] },
  { id: 'sumi', name: '墨と朱', kind: 'free', sw: ['#1f1c1a', '#e0663c'] },
  { id: 'budou', name: 'ぶどう', kind: 'unlock', need: { played: 10 }, sw: ['#f2eff9', '#7d58c8'] },
  { id: 'lemon', name: 'レモン', kind: 'unlock', need: { played: 30 }, sw: ['#fbf7e2', '#b7860f'] },
  { id: 'mono', name: 'モノクロ', kind: 'unlock', need: { hwins: 5 }, sw: ['#f1f1f1', '#333333'] },
  { id: 'kin', name: '金', kind: 'buy', sw: ['#fbf6e8', '#a87b1f'] },
  { id: 'yuyake', name: '夕焼け', kind: 'buy', sw: ['linear-gradient(170deg,#ffe3c9,#f6d3e4 55%,#ddd4f3)', '#e0603f'] },
  { id: 'hoshi', name: '星空', kind: 'buy', sw: ['linear-gradient(#141a3a,#2a2457)', '#f2c14e'] },
  { id: 'matcha', name: '抹茶', kind: 'buy', sw: ['#e6eddc', '#5d7a32'] },
  { id: 'umi', name: '海', kind: 'buy', sw: ['linear-gradient(180deg,#e3f7fb,#bfe3f2)', '#1690a8'] },
  { id: 'mokume', name: '木目', kind: 'buy', sw: ['repeating-linear-gradient(92deg,#e7d2b0 0 14px,#e2cba6 14px 22px,#ead7b7 22px 37px)', '#8a5a2b'] },
];
const byId = (id) => SKINS.find((s) => s.id === id);
export const productOf = (s) => SKIN_PREFIX + s.id;

// 選べる色の一覧に出すか（買う色はアプリ版で課金の部品があるときだけ）
export const shownSkins = () => SKINS.filter((s) => s.kind !== 'buy' || (IS_APP && canBuy()));

// 解放の条件の文字と、届いたか
export function needText(s, rec = readRecords()) {
  if (s.need?.played) return { ok: rec.played >= s.need.played, text: `遊んだ対局 ${s.need.played}局（いま ${Math.min(rec.played, s.need.played)}局）` };
  if (s.need?.hwins) return { ok: rec.hwins >= s.need.hwins, text: `人がいた対局で ${s.need.hwins}勝（いま ${Math.min(rec.hwins, s.need.hwins)}勝）` };
  return { ok: true, text: '' };
}

// いま使えるか
export function usable(s, rec) {
  if (!s) return false;
  if (s.kind === 'free') return true;
  if (s.kind === 'unlock') return needText(s, rec).ok;
  return IS_APP && owns(productOf(s));
}

function stored() { try { return localStorage.getItem(KEY); } catch { return null; } }

export function currentSkin() {
  const s = byId(stored());
  return s ?? SKINS[0];
}

function apply(s) {
  if (s.id === 'std') delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = s.id;
  // ブラウザの上の帯の色（ホーム画面に追加したとき）も地の色にそろえる
  const meta = document.querySelector('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (meta && bg) meta.setAttribute('content', bg);
}

export function setSkin(id) {
  const s = byId(id);
  if (!usable(s)) return false;
  try { localStorage.setItem(KEY, s.id); } catch { /* 覚えられなくても、いまの画面だけ替える */ }
  apply(s);
  return true;
}

// 起動のときと、買ってあるものが分かったとき。使えない色（解放の条件に届いていない・買っていない）を選んでいたら、いつもの色に戻す。
// 買う色は、iPhone に聞けるまで（ownedChecked）は戻さない（起動のたびに一瞬いつもの色になるのを避ける）
export function checkSkin() {
  const s = currentSkin();
  const waiting = s.kind === 'buy' && IS_APP && !ownedChecked();
  if (!waiting && !usable(s)) {
    try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
    apply(SKINS[0]);
    return;
  }
  apply(s);
}

// 記録が増えて新しく使えるようになった色（遊んで解放の分）
export function newlyUnlocked(before, after) {
  return SKINS.filter((s) => s.kind === 'unlock' && !needText(s, before).ok && needText(s, after).ok);
}
