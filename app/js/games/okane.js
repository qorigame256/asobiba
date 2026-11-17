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
const ROUNDS = 10;
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
const limitOf = (s) => LIMIT[s.level];

export const yen = (v) => v.toLocaleString('ja-JP') + '円';
// いちばん少ない枚数の出し方（MONEY の順の枚数）
export const best = (amount, kinds) => kinds.map((v) => { const k = Math.floor(amount / v); amount -= k * v; return k; });
export const total = (c, kinds) => c.reduce((a, k, i) => a + k * kinds[i], 0);
const pieces = (c) => c.reduce((a, k) => a + k, 0);

const qKey = (s, q = s.q) => `okane:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });
const doneOf = (s, p) => s.solved[p] !== null;

export function cpuTime(s, q, p) {
  const rnd = mulberry32((s.seed * 43 + q * 17 + p * 1021 + 3301) >>> 0);
  if (rnd() < 0.15) return null;
  const [lo, hi] = CPU_MS[s.level];
  return Math.round(lo + rnd() * (hi - lo));
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
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', ...rules };
    const level = levelOf(r);
    const rnd = mulberry32(seed);
    const [lo, hi] = RANGE[level];
    const qs = [];
    for (let i = 0; i < ROUNDS; i++) {
      let a = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let k = 0; k < 20 && qs.includes(a); k++) a = lo + Math.floor(rnd() * (hi - lo + 1));
      qs.push(a);
    }
    return { n, seed, rules: r, level, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
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
    const kinds = MONEY[s0.level];
    const want = best(s0.qs[s0.q], kinds);
    if (!Array.isArray(m.c) || m.c.length !== kinds.length || m.c.some((k, i) => k !== want[i])) return null;
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
    return t >= end ? { t: 'pay', q: s.q, ms: Math.max(end, Math.round(t)), c: best(s.qs[s.q], MONEY[s.level]) } : null;
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">いちばん少ない枚数で払おう・全${s.qs.length}問・1問 ${limit / 1000}秒まで</div>`;
      return;
    }
    const amount = s.qs[s.q];
    const kinds = MONEY[s.level];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="kj-word ok-price">${yen(amount)}</div>`;
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
    const paint = () => {
      const shown = s.phase === 'shown';
      const c = shown ? best(amount, kinds) : me === null ? kinds.map(() => 0) : loc.c;
      paid.replaceChildren();
      paid.classList.toggle('answer', shown);
      kinds.forEach((v, i) => {
        if (!c[i]) return;
        const b = moneyEl(v, 'button');
        b.classList.add('ok-stack');
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
      if (!paid.children.length) paid.insertAdjacentHTML('beforeend', `<span class="ok-empty">${shown ? '' : 'ここに出したお金が並びます'}</span>`);
      tray.hidden = !playing;
      payBtn.hidden = !playing;
      payBtn.disabled = !pieces(loc.c) || locked();
      tray.querySelectorAll('button').forEach((b) => { b.disabled = locked(); });
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
        b.onclick = () => {
          if (!playing || loc.sent || locked()) return;
          loc.c[i] += 1;
          loc.msg = '';
          play('chip', 0.15);
          paint();
        };
        tray.append(b);
      });
      payBtn.onclick = () => {
        if (!playing || loc.sent || locked() || !pieces(loc.c)) return;
        const want = best(amount, kinds);
        const sum = total(loc.c, kinds);
        if (sum === amount && loc.c.every((k, i) => k === want[i])) {
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
    wrap.append(paid, payBtn, tray, note);
    paint();
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    const kinds = MONEY[s.level];
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${yen(s.qs[q])}（${pieces(best(s.qs[q], kinds))}枚）</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
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
