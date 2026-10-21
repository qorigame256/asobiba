// 汚い言葉のふるい（2026-10-21 本人の決定。App Store の審査 1.2 のため。ウェブ版にも入れる）。
// 送る前に止める（isBad）のと、受け取った側で当たった所を「＊」で隠す（mask）の両方に使う（サーバーが無く、改造した端末から来たものは受け手でしか止められないため）。
// 一覧は ngwords.js（tools/make-ngwords.mjs が作る）。判定の手順は一覧のもとのアプリ（クイズアプリ）と同じ:
//   ①表記をそろえる → ②例外の語を判定から外す → ③一覧の語と照らす（語ごとに部分一致か完全一致）
// ①でそろえるもの: 目に見えない文字を除く・NFKC（半角カナ→全角・全角英数→半角・濁点の合成）・カタカナ→ひらがな・英字を小文字に。
// 目に見える記号や空白を挟んだ形（「ば・か」）は、もとのアプリと同じく塞がない（塞ぐと誤検知が全員に当たる。通報と「この人を隠す」で対処する）。
// 当たった所を隠せるよう、そろえた後の1文字ずつに「もとの何文字目から何文字目か」を覚えておく。

import { SHORT, SENTENCE } from './ngwords.js';

// 目に見えない文字（もとのアプリと同じ集合。絵文字の組み立てに使う U+200D は除かない）
const INVISIBLE = new Set([0x200B, 0x200C, 0x00AD, 0x061C, 0x180E, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xFEFF, 0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800,
  0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]);
const MARKS = new Set(['゙', '゚']); // 結合の濁点・半濁点

const toHira = (c) => { const x = c.codePointAt(0); return x >= 0x30A1 && x <= 0x30F6 ? String.fromCodePoint(x - 0x60) : c; };

// そろえた文字列と、その1文字ずつの「もとの文字の位置の範囲」（[始め, 終わり]。もとの文字列は Array.from で数える）
function normalize(text) {
  const src = Array.from(String(text ?? ''));
  const out = [];
  const from = [];
  src.forEach((ch, i) => {
    if (INVISIBLE.has(ch.codePointAt(0))) return;
    let n = ch.normalize('NFKC');
    if (n.length > 1 && n.trim().length === 1 && MARKS.has(n.trim())) n = n.trim(); // 「゛」（U+309B）は NFKC で「空白＋結合の濁点」になる
    for (const c of Array.from(n)) {
      if (MARKS.has(c)) { // 直前の字と合成する。合成できなければ落とす
        if (out.length) {
          const composed = (out[out.length - 1] + c).normalize('NFC');
          if (Array.from(composed).length === 1) { out[out.length - 1] = composed; from[from.length - 1][1] = i; }
        }
        continue;
      }
      out.push(c);
      from.push([i, i]);
    }
  });
  return { chars: out.map((c) => toHira(c).toLowerCase()), from, src };
}

const prepared = new Map();
function listOf(kind) {
  if (prepared.has(kind)) return prepared.get(kind);
  const raw = kind === 'sentence' ? SENTENCE : SHORT;
  const norm = (w) => normalize(w).chars.join('');
  const list = {
    words: raw.words.map(([w, exact]) => ({ w: norm(w), exact: !!exact })).filter((x) => x.w),
    except: raw.except.map(norm).filter(Boolean),
  };
  prepared.set(kind, list);
  return list;
}

// 当たった所（もとの文字の位置の範囲）の一覧。kind = 'short'（名前・答え）| 'sentence'（文）
function hits(text, kind) {
  const { chars, from } = normalize(text);
  const s = chars.join('');
  if (!s) return [];
  // そろえた後の chars は1文字ずつ（NFKC で1文字が2文字以上になることがあるので、文字列の位置から chars の位置へ直す）
  const startAt = [];
  let pos = 0;
  chars.forEach((c, i) => { for (let k = 0; k < c.length; k++) startAt[pos + k] = i; pos += c.length; });
  const idx = (p) => startAt[p];
  const list = listOf(kind);
  const blocked = new Array(chars.length).fill(false); // 例外の語に入っている文字には当てない
  for (const ex of list.except) {
    for (let p = s.indexOf(ex); p !== -1; p = s.indexOf(ex, p + 1)) {
      for (let q = p; q < p + ex.length; q++) blocked[idx(q)] = true;
    }
  }
  const found = [];
  for (const { w, exact } of list.words) {
    if (exact) {
      if (s === w && !blocked.some(Boolean)) found.push([0, chars.length - 1]);
      continue;
    }
    for (let p = s.indexOf(w); p !== -1; p = s.indexOf(w, p + 1)) {
      const a = idx(p);
      const b = idx(p + w.length - 1);
      let free = true;
      for (let q = a; q <= b; q++) if (blocked[q]) { free = false; break; }
      if (free) found.push([a, b]);
    }
  }
  return found.map(([a, b]) => [from[a][0], from[b][1]]);
}

export const isBad = (text, kind = 'short') => hits(text, kind).length > 0;

// 当たった所を「＊」にした文字列（当たらなければそのまま）
export function mask(text, kind = 'short') {
  const h = hits(text, kind);
  if (!h.length) return String(text ?? '');
  const src = Array.from(String(text ?? ''));
  for (const [a, b] of h) for (let i = a; i <= b; i++) src[i] = '＊';
  return src.join('');
}

export const BAD_TEXT_NOTE = '使えない言葉が入っています。言いかえてください';

// 「この人を隠す」（2026-10-21 本人の決定）を押した人の言葉は出さない。ほかの人の言葉は当たった所を隠して出す
export const HIDDEN_TEXT = '（隠している人の言葉）';
export const shown = (text, hidden, kind = 'short') => (hidden ? HIDDEN_TEXT : mask(text, kind));
