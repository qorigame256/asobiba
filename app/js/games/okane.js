// お金ぴったり払い。言われた金額を、お札と小銭のいちばん少ない枚数で早く払う。早く払えた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-17 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおり」）:
//   - ちょうどの金額で、しかもいちばん少ない枚数のときだけ払える（多い枚数で出すと「もっと少なくできる」と出てやり直し）。
//   - まちがえて出したら1秒止まってからやり直せる。
//   - 詳細設定「むずかしさ」: やさしい（999円まで・硬貨だけ）・ふつう（9,999円まで・千円札まで。最初）・むずかしい（99,999円まで・一万円札まで）。
//   - 10問、1問ごとに払えた速い順に 3点・2点・それ以降は1点（時計あわせと同じ形）。
// Claude の判断:
//   - 使うお金: やさしい 1・5・10・50・100・500円、ふつう それに千円札、むずかしい それに五千円札・一万円札（二千円札は使わない）。
//     日本のお金は大きいものから順に取れば、いちばん少ない枚数になる（答えは1通り）。
//   - 金額は種から選ぶ: やさしい 11〜999円、ふつう 1,001〜9,999円、むずかしい 10,001〜99,999円。全員同じ。
//   - 出したお金の合計は画面に出さない（出すと数字を合わせるだけになり、お金を数える遊びでなくなるため。時計あわせで針の時刻を出さないのと同じ）。
//     種類ごとの枚数は「×3」のように出す。出したお金を押すと1枚戻せる。
//   - 「払う」を押して、合計がちがう・枚数が多いときは、その場で理由を出して1秒押せない（送らないので点は減らない）。
//   - お金の絵は色と大きさで見分ける丸と四角に金額の数字を書いたもの（本物の図柄はまねない）。
//   - 制限時間は1問 やさしい20秒・ふつう30秒・むずかしい35秒。最初に払えた人が出てから8秒で締め切る（制限時間のほうが先なら制限時間で）。全員払ったら1.5秒。
//   - CPU は 1問 やさしい5〜12秒・ふつう8〜18秒・むずかしい10〜22秒で払い、7回に1回ほど払えない。どちらも種から決める。
// 2026-11-17 の43回目の案（本人が選んだ。分かれ目は Claude が決めた）:
//   - 「問題の数」5・10（最初）・20問（鍵は rounds）。
//   - 「さいふの中身に限り」なし（最初）・あり（鍵は wallet）: 問題ごとに、さいふにある枚数が決まっている（全員同じ）。お金のボタンに残りの枚数を出し、0枚は押せない。
//     さいふは、大きい順に取るいちばん少ない出し方から、どれか1種類（いちばん小さいお金を除く）を1枚足りなくし、ほかは0〜2枚多めに入れる。
//     払えないときは、足りなくしたお金のすぐ下のお金を払えるまで足す（日本のお金はとなりどうしが割り切れるので必ず払える）。
//     正解は、さいふの中で払える、いちばん少ない枚数の出し方（同じ枚数の出し方が2つ以上あればどれでもよい）。
//   - 「お会計」なし（最初）・あり（鍵は shop）: 金額の代わりに、品物2〜3個と値段を出す（合計が問題の金額）。合計は自分で出す。
//     品物の名前は値段に合うものを一覧から選ぶ。制限時間は10秒長く、CPU は5秒遅くなる。結果では合計を見せる。
//   - さいふ・お会計を決める乱数は別に持つ（最初の値のときの金額は前と全く同じ。tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（時計あわせと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'pay', q, ms, c: [お金の種類ごとの枚数（MONEY の順）] }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 8000;
const LOCK_MS = 1000;
const MIN_MS = 800;
const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
export const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r?.rounds)) ? Number(r.rounds) : 10);
const LEVELS = [['easy', 'やさしい（999円まで・硬貨だけ）'], ['normal', 'ふつう（9,999円まで・千円札まで）'], ['hard', 'むずかしい（99,999円まで・一万円札まで）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r?.level) ? r.level : 'normal');
// 使うお金（大きい順）
export const MONEY = {
  easy: [500, 100, 50, 10, 5, 1],
  normal: [1000, 500, 100, 50, 10, 5, 1],
  hard: [10000, 5000, 1000, 500, 100, 50, 10, 5, 1],
};
const RANGE = { easy: [11, 999], normal: [1001, 9999], hard: [10001, 99999] };
const LIMIT = { easy: 20000, normal: 30000, hard: 35000 };
const CPU_MS = { easy: [5000, 12000], normal: [8000, 18000], hard: [10000, 22000] };
const SHOP_MS = 10000; // お会計の分だけ長くする
const limitOf = (s) => LIMIT[s.level] + (s.items ? SHOP_MS : 0);

export const yen = (v) => v.toLocaleString('ja-JP') + '円';
// いちばん少ない枚数の出し方（MONEY の順の枚数）
export const best = (amount, kinds) => kinds.map((v) => { const k = Math.floor(amount / v); amount -= k * v; return k; });
export const total = (c, kinds) => c.reduce((a, k, i) => a + k * kinds[i], 0);
const pieces = (c) => c.reduce((a, k) => a + k, 0);
// さいふの中（種類ごとの枚数 w）で払える、いちばん少ない枚数の出し方。払えなければ null
export function payFrom(amount, kinds, w) {
  let top = null, topN = Infinity;
  const c = kinds.map(() => 0);
  const rec = (i, rest, n) => {
    if (n >= topN) return;
    if (rest === 0) { topN = n; top = c.slice(); return; }
    if (i >= kinds.length) return;
    for (let k = Math.min(w[i], Math.floor(rest / kinds[i])); k >= 0; k--) { c[i] = k; rec(i + 1, rest - k * kinds[i], n + k); }
    c[i] = 0;
  };
  rec(0, amount, 0);
  return top;
}
// さいふを作る: 大きい順に取る出し方のどれか1種類を1枚足りなくし、ほかは0〜2枚多め。払えるまで、すぐ下のお金を足す
export function makeWallet(amount, kinds, rnd) {
  const g = best(amount, kinds);
  const w = g.map((k) => k + Math.floor(rnd() * 3));
  const can = g.map((k, i) => (k > 0 && i < kinds.length - 1 ? i : -1)).filter((i) => i >= 0);
  if (!can.length) return w;
  const i = can[Math.floor(rnd() * can.length)];
  w[i] = g[i] - 1;
  for (let k = 0; k < 20 && !payFrom(amount, kinds, w); k++) w[i + 1] += 1;
  return w;
}
// お会計の品物（値段の上限 → 名前の一覧）
const GOODS = [
  [200, ['🍬 あめ', '🍫 チョコ', '🥤 ジュース', '🍙 おにぎり', '✏️ えんぴつ', '🧻 ティッシュ', '🥚 たまご', '🍌 バナナ']],
  [1000, ['🍞 パン', '📓 ノート', '🍱 おべんとう', '🍦 ソフトクリーム', '🧦 くつした', '🥛 ぎゅうにゅう', '🖊️ ボールペン', '🍎 りんごの袋']],
  [5000, ['📚 本', '🧢 ぼうし', '☂️ かさ', '👕 Tシャツ', '🍰 ケーキ', '🧸 ぬいぐるみ', '🎲 ボードゲーム', '🍉 すいか']],
  [20000, ['👟 くつ', '🎒 リュック', '🧥 上着', '⌚ うでどけい', '🎮 ゲーム', '🍣 おすし', '🎧 ヘッドホン', '🍳 フライパン']],
  [Infinity, ['🚲 じてんしゃ', '🎸 ギター', '📺 テレビ', '🏕️ テント', '🛋️ ソファ', '🧳 スーツケース', '💍 ゆびわ', '🔭 ぼうえんきょう']],
];
// 金額を品物2〜3個に分ける（どの品物も金額の15%以上）→ [[名前, 値段], …]
export function makeItems(amount, rnd) {
  const k = rnd() < 0.5 ? 2 : 3;
  let cuts = null;
  for (let t = 0; t < 30 && !cuts; t++) {
    const c = Array.from({ length: k - 1 }, () => 1 + Math.floor(rnd() * (amount - 1))).sort((a, b) => a - b);
    const parts = [...c, amount].map((v, i, a) => v - (i ? a[i - 1] : 0));
    if (parts.every((v) => v >= amount * 0.15)) cuts = parts;
  }
  if (!cuts) { const v = Math.floor(amount / k); cuts = [...Array(k - 1).fill(v), amount - v * (k - 1)]; }
  const used = new Set();
  return cuts.map((price) => {
    const names = GOODS.find(([hi]) => price < hi)[1].filter((x) => !used.has(x));
    const name = names[Math.floor(rnd() * names.length)];
    used.add(name);
    return [name, price];
  });
}
// この問題の正解の出し方（さいふありは、さいふの中でいちばん少ない出し方の1つ）
export const wanted = (s, q) => (s.wallets ? payFrom(s.qs[q], MONEY[s.level], s.wallets[q]) : best(s.qs[q], MONEY[s.level]));
// 払える出し方か（さいふありは、さいふの中で金額ぴったり・いちばん少ない枚数ならどれでもよい）
export function canPay(s, q, c) {
  const kinds = MONEY[s.level];
  if (!Array.isArray(c) || c.length !== kinds.length || c.some((k) => !Number.isInteger(k) || k < 0)) return false;
  const want = wanted(s, q);
  if (!s.wallets) return c.every((k, i) => k === want[i]);
  return c.every((k, i) => k <= s.wallets[q][i]) && total(c, kinds) === s.qs[q] && pieces(c) === pieces(want);
}

const qKey = (s, q = s.q) => `okane:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });
const doneOf = (s, p) => s.solved[p] !== null;

export function cpuTime(s, q, p) {
  const rnd = mulberry32((s.seed * 43 + q * 17 + p * 1021 + 3301) >>> 0);
  if (rnd() < 0.15) return null;
  const [lo, hi] = CPU_MS[s.level];
  return Math.round(lo + rnd() * (hi - lo) + (s.items ? SHOP_MS / 2 : 0));
}

let loc = null; // この端末で出したお金 { key, c: 枚数, sent, lock: 押せるようになる時刻, msg }

export default {
  id: 'okane',
  name: 'お金ぴったり払い',
  icon: '💴',
  desc: '言われた金額を、いちばん少ない枚数のお金で早く払う。早く払うほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '金額の大きさと、使えるお金', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
    { key: 'wallet', label: 'さいふの中身に限り', desc: 'さいふにあるお金の枚数が決まっている。その中でいちばん少ない枚数で払う', def: false },
    { key: 'shop', label: 'お会計', desc: '品物2〜3個の値段が出る。合計を自分で出して払う', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', rounds: 10, wallet: false, shop: false, ...rules };
    const level = levelOf(r);
    const rnd = mulberry32(seed);
    const [lo, hi] = RANGE[level];
    const qs = [];
    for (let i = 0; i < roundsOf(r); i++) {
      let a = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let k = 0; k < 20 && qs.includes(a); k++) a = lo + Math.floor(rnd() * (hi - lo + 1));
      qs.push(a);
    }
    // さいふ・お会計は別の乱数で決める（最初の値のときの金額を前と同じにするため）
    const rw = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const rs = mulberry32((seed ^ 0x85ebca6b) >>> 0);
    const wallets = r.wallet ? qs.map((a) => makeWallet(a, MONEY[level], rw)) : null;
    const items = r.shop ? qs.map((a) => makeItems(a, rs)) : null;
    return { n, seed, rules: r, level, qs, wallets, items, q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.pts[me] > 0 ? 'correct' : 'pop';
    return m.p === me ? 'goal' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limitOf(s), AFTER_MS, GRACE_MS), move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const fast = times.length ? Math.min(...times) : null;
        const winners = fast === null ? [] : s.solved.map((v, p) => (v === fast ? p : -1)).filter((p) => p >= 0);
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'pay' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= MIN_MS) || m.ms > limitOf(s0) + 500) return null;
    if (!canPay(s0, s0.q, m.c)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const end = cpuTime(s, s.q, p);
    if (end === null || end >= limitOf(s)) return null;
    const t = since(qKey(s));
    return t >= end ? { t: 'pay', q: s.q, ms: Math.max(end, Math.round(t)), c: wanted(s, s.q) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const key = qKey(s);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">はらった！</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj okn';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const limit = limitOf(s);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">いちばん少ない枚数で払おう・全${s.qs.length}問・1問 ${limit / 1000}秒まで${s.wallets ? '・👛 さいふのお金には限りがある' : ''}${s.items ? '・🛒 品物の合計を払う' : ''}</div>`;
      return;
    }
    const amount = s.qs[s.q];
    const kinds = MONEY[s.level];
    const items = s.items?.[s.q];
    const priceHtml = items
      ? `<ul class="ok-items">${items.map(([name, v]) => `<li><span>${esc(name)}</span><b>${yen(v)}</b></li>`).join('')}</ul>${s.phase === 'shown' ? `<div class="ok-sum">合計 ${yen(amount)}</div>` : ''}`
      : `<div class="kj-word ok-price">${yen(amount)}</div>`;
    card.innerHTML = `${priceHtml}`;
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが払った！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも払えませんでした';
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, c: kinds.map(() => 0), sent: false, lock: 0, msg: '' };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const tray = document.createElement('div');
    tray.className = 'ok-tray';
    const paid = document.createElement('div');
    paid.className = 'ok-paid';
    const payBtn = document.createElement('button');
    payBtn.type = 'button';
    payBtn.className = 'ok-pay';
    payBtn.textContent = '払う';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const locked = () => performance.now() < loc.lock;
    let waitT = 0;
    const wallet = s.wallets?.[s.q] ?? null;
    const purse = document.createElement('div');
    purse.className = 'ok-purse';
    purse.textContent = '👛 さいふの中（数字は残りの枚数）';
    const paint = () => {
      const shown = s.phase === 'shown';
      const c = shown ? wanted(s, s.q) : me === null ? kinds.map(() => 0) : loc.c;
      paid.replaceChildren();
      paid.classList.toggle('answer', shown);
      // 出したお金の欄は、お金の種類ごとに置き場所を決めておき、出していない種類は見えない形で場所だけ取る（2026-11-22 本人の依頼
      // 「出したお金が多くなると改行されて、お金を選ぶボタンの位置がずれる」）。欄の高さは問題の間ずっと同じになる
      kinds.forEach((v, i) => {
        const b = moneyEl(v, 'button');
        b.classList.add('ok-stack');
        if (!c[i]) {
          b.classList.add('ok-ghost');
          b.disabled = true;
          b.tabIndex = -1;
          b.setAttribute('aria-hidden', 'true');
          paid.append(b);
          return;
        }
        b.insertAdjacentHTML('beforeend', `<span class="ok-n">×${c[i]}</span>`);
        b.setAttribute('aria-label', `${yen(v)} ${c[i]}枚（押すと1枚戻す）`);
        b.disabled = !playing;
        b.onclick = () => {
          if (!playing || loc.sent || locked() || !loc.c[i]) return;
          loc.c[i] -= 1;
          loc.msg = '';
          play('chip', 0.15);
          paint();
        };
        paid.append(b);
      });
      if (!pieces(c) && !shown) paid.insertAdjacentHTML('beforeend', '<span class="ok-empty">ここに出したお金が並びます</span>');
      tray.hidden = !playing;
      purse.hidden = !playing || !wallet;
      payBtn.hidden = !playing;
      payBtn.disabled = !pieces(loc.c) || locked();
      // さいふありは、残りの枚数を出し、0枚のお金は押せない
      tray.querySelectorAll('button').forEach((b, i) => {
        const left = wallet ? wallet[i] - loc.c[i] : 1;
        b.disabled = locked() || left <= 0;
        if (wallet) b.querySelector('.ok-left').textContent = left;
      });
      note.textContent = shown ? `正解: ${pieces(c)}枚` : me === null ? '観戦中'
        : doneOf(s, me) || loc.sent ? `はらった！（${doneOf(s, me) ? secText(s.solved[me]) : '…'}）ほかの人を待っています`
        : loc.msg || 'お金を押して出し、「払う」を押そう（出したお金を押すと1枚戻る）';
      // 1秒止まった後に押せるように戻す
      if (playing && locked() && !waitT) waitT = setTimeout(() => { waitT = 0; if (paid.isConnected) paint(); }, loc.lock - performance.now() + 30);
    };
    if (playing) {
      kinds.forEach((v, i) => {
        const b = moneyEl(v, 'button');
        b.setAttribute('aria-label', `${yen(v)}を1枚出す`);
        if (wallet) b.insertAdjacentHTML('beforeend', '<span class="ok-n ok-left"></span>');
        b.onclick = () => {
          if (!playing || loc.sent || locked() || (wallet && loc.c[i] >= wallet[i])) return;
          loc.c[i] += 1;
          loc.msg = '';
          play('chip', 0.15);
          paint();
        };
        tray.append(b);
      });
      payBtn.onclick = () => {
        if (!playing || loc.sent || locked() || !pieces(loc.c)) return;
        const sum = total(loc.c, kinds);
        if (canPay(s, s.q, loc.c)) {
          const ms = Math.round(since(key));
          if (ms >= limit) return;
          loc.sent = true;
          o.onMove({ t: 'pay', q: s.q, ms: Math.max(ms, MIN_MS), c: loc.c.slice() });
          paint();
          return;
        }
        loc.msg = sum !== amount ? `❌ 金額がちがう（${sum < amount ? '足りない' : '多すぎる'}）` : '❌ もっと少ない枚数で払える';
        loc.lock = performance.now() + LOCK_MS;
        play('wrong', 0.5);
        paint();
      };
    }
    wrap.append(paid, payBtn, purse, tray, note);
    paint();
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${yen(s.qs[q])}（${pieces(wanted(s, q))}枚）</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// お金の絵（硬貨は丸、お札は四角。色と大きさで見分ける）
function moneyEl(v, tag = 'span') {
  const e = document.createElement(tag);
  if (tag === 'button') e.type = 'button';
  e.className = `ok-m ok-${v >= 1000 ? 'bill' : 'coin'} ok-v${v}`;
  e.innerHTML = `<span class="ok-face">${v >= 1000 ? v.toLocaleString('ja-JP') : v}</span>`;
  return e;
}
