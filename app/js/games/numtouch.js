// 数字タッチ。ばらばらに並んだ数字を 1 から順に押し、早く押し終えた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 全員同じ並び。押しまちがえたら1秒押せない。
//   - 3回勝負。早く押し終えた順に 3点・2点・それ以降は1点（迷路早抜けと同じ）。
//   - 名前の札に、いま何番まで押したかを出す。
//   - 詳細設定「盤の大きさ」: 4×4・5×5（最初。1〜25）・6×6。
// Claude の判断:
//   - 制限時間は 4×4 40秒・5×5 60秒・6×6 90秒。最初に押し終えた人から15秒で締め切る（制限時間のほうが先なら制限時間で）。全員押し終えたら1.5秒。
//   - 送るのは押し終えた時間だけ（{ t: 'done', q, ms }）。1つあたり0.1秒より速いものは弾く。
//   - いま何番かは見た目だけなので手の一覧に入れず、押すたびに送りっぱなしにする（o.stream。0.15秒より短い間は1回にまとめる）。
//   - CPU の押す間は種から決める（1つあたり 4×4 0.95秒・5×5 1.05秒・6×6 1.15秒の 0.6〜1.4倍）。全員の端末で同じ計算をするので、CPU の進み具合もどの画面にも出せる。
//     制限時間に間に合わない回は押し終えない。
//   - 押しまちがえたら盤を少しゆらし、1秒のあいだ灰色にする（その間に押しても数えない）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（迷路早抜けと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 15000;
const LOCK_MS = 1000;
const ROUNDS = 3;
const SIZES = [[4, '4×4（1〜16）'], [5, '5×5（1〜25）'], [6, '6×6（1〜36）']];
const LIMITS = { 4: 40000, 5: 60000, 6: 90000 };
const CPU_STEP = { 4: 950, 5: 1050, 6: 1150 };
const sizeOf = (r) => (SIZES.some(([v]) => v === r.size) ? r.size : 5);
const limitOf = (s) => LIMITS[s.size];
const qKey = (s, q = s.q) => `numtouch:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });
const doneOf = (s, p) => s.solved[p] !== null;

// CPU が k 個目を押し終える時刻（ms）の一覧。種・何回目・席から決めるので全員の端末で同じ
export function cpuTimes(s, q, p) {
  const rnd = mulberry32((s.seed * 31 + q * 7 + p * 1009 + 99991) >>> 0);
  const out = [];
  let t = 0;
  for (let k = 0; k < s.size * s.size; k++) { t += CPU_STEP[s.size] * (0.6 + rnd() * 0.8); out.push(Math.round(t)); }
  return out;
}
const cpuCount = (s, p, t) => cpuTimes(s, s.q, p).filter((x) => x <= t).length;

let loc = null; // この端末の進み具合 { key, next, lockUntil, sent }
let ui = null;
const others = new Map(); // 席 → { key, k }（ほかの人の進み具合）
let lastSend = 0, sendTimer = null;

export default {
  id: 'numtouch',
  name: '数字タッチ',
  icon: '🔢',
  desc: 'ばらばらの数字を 1 から順に押す。早く押し終えるほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '盤の大きさ', desc: '大きいほど数字が多い', def: 5, choices: SIZES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: 5, ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const qs = Array.from({ length: ROUNDS }, () => shuffle(Array.from({ length: size * size }, (_, i) => i + 1), rnd));
    return { n, seed, rules: r, size, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    return m.p === me ? 'goal' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}回 / ${s.qs.length}`;
    return `第${s.q + 1}回の結果`;
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
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'done' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= s0.size * s0.size * 100) || m.ms > limitOf(s0) + 500) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const end = cpuTimes(s, s.q, p).at(-1);
    if (end >= limitOf(s)) return null;
    const t = since(qKey(s));
    return t >= end ? { t: 'done', q: s.q, ms: Math.max(end, Math.round(t)) } : null;
  },

  // ほかの人の進み具合（見た目だけ）
  onStream(d, from) {
    if (!d || !Number.isInteger(d.k) || typeof d.key !== 'string' || from < 0) return;
    others.set(from, { key: d.key, k: d.k });
    ui?.paintChips?.();
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${s.solved.some((v) => v !== null)}:${!!o.canMove}`;
    const key = qKey(s);
    const total = s.size * s.size;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const progress = (p) => {
      if (p === me && loc?.key === key) return loc.next - 1;
      if (o.cpu?.[p]) return cpuCount(s, p, since(key));
      const v = others.get(p);
      return v?.key === key ? v.k : 0;
    };
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? `<span class="pt-ok">クリア！</span>` : `<span class="nt-prog">${Math.min(progress(p), total)}/${total}</span>`;
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj nt';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    // 札の「何番まで」だけを書き直す（CPU の進み具合は時間で進むので、描き直しを待たずに）
    ui.paintChips = () => {
      if (s.phase !== 'open') return;
      ui.chips.querySelectorAll('.cc-opp').forEach((chip, p) => {
        const e = chip.querySelector('.pt-extra');
        if (e) e.innerHTML = extra(p);
      });
    };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const limit = limitOf(s);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">1 から ${total} まで順に押そう・全${s.qs.length}回・1回 ${limit / 1000}秒まで</div>`;
      return;
    }
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div>`;
    const head = document.createElement('div');
    head.className = 'nt-next';
    card.append(head);
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが押し終えた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも押し終えられませんでした';
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, next: 1, lockUntil: 0, sent: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const grid = document.createElement('div');
    grid.className = 'nt-grid';
    grid.style.gridTemplateColumns = `repeat(${s.size}, 1fr)`;
    const note = document.createElement('p');
    note.className = 'cc-log';
    const btns = s.qs[s.q].map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nt-cell';
      b.textContent = v;
      b.dataset.v = v;
      return b;
    });
    const paint = () => {
      const mine = me !== null && (playing || loc.sent || doneOf(s, me));
      for (const b of btns) {
        const v = Number(b.dataset.v);
        b.classList.toggle('done', mine ? v < loc.next || doneOf(s, me) : false);
        b.disabled = !playing;
      }
      grid.classList.toggle('lock', performance.now() < loc.lockUntil);
      head.textContent = s.phase !== 'open' || me === null ? '' : doneOf(s, me) || loc.sent ? 'クリア！' : `つぎは ${loc.next}`;
      note.textContent = s.phase !== 'open' ? '' : me === null ? '観戦中' : doneOf(s, me) ? `クリア！（${secText(s.solved[me])}）ほかの人を待っています`
        : performance.now() < loc.lockUntil ? '❌ まちがい！ 1秒まって' : `1 から ${total} まで順に押そう`;
    };
    const sendProgress = () => {
      const go = () => { lastSend = performance.now(); sendTimer = null; if (loc?.key === key) o.stream?.({ key, k: loc.next - 1 }); };
      if (sendTimer) return;
      const wait = 150 - (performance.now() - lastSend);
      if (wait <= 0) go(); else sendTimer = setTimeout(go, wait);
    };
    const tap = (b, e) => {
      if (!playing || loc.sent) return;
      e.preventDefault();
      if (performance.now() < loc.lockUntil) return;
      const v = Number(b.dataset.v);
      if (v < loc.next) return; // 押したあとの数字をもう一度押しても何もしない
      if (v !== loc.next) {
        loc.lockUntil = performance.now() + LOCK_MS;
        play('wrong', 0.5);
        grid.classList.remove('shake');
        void grid.offsetWidth; // ゆらしをもう一度始めるため
        grid.classList.add('shake');
        setTimeout(() => { if (grid.isConnected) paint(); }, LOCK_MS + 20);
        paint();
        return;
      }
      loc.next += 1;
      sendProgress();
      if (loc.next > total) {
        const ms = Math.round(since(key));
        if (ms < limit) { loc.sent = true; play('place', 0.6); o.onMove({ t: 'done', q: s.q, ms }); }
      } else play('place', 0.35);
      paint();
      ui.paintChips();
    };
    for (const b of btns) {
      b.onpointerdown = (e) => tap(b, e); // 指が触れた瞬間に押したことにする（フラッシュ暗算と同じ）
      b.onclick = (e) => { if (e.detail === 0) tap(b, e); }; // キーボードで押したとき
    }
    grid.append(...btns);
    wrap.append(grid, note);
    paint();
    if (s.phase === 'open') {
      const tick = () => {
        if (!wrap.isConnected || ui?.wrap !== wrap) return;
        ui.paintChips();
        setTimeout(tick, 300);
      };
      setTimeout(tick, 300);
    }
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
