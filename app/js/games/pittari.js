// ぴったりストップ。決められた秒数（5〜15秒）ちょうどで「ストップ」を押し、近い人ほど高い点。5回。
// 時計は最初の3秒だけ見えて、あとは消える（詳細設定「時計の見える時間」で 0秒・5秒にもできる。2026-10-06 本人の決定）。毎回、近い順に 3・2・1点（同じずれは同じ点。押さなかった人は0点）。
// 時間は各自の端末で「画面に出てから押すまで」を測る（party.js の since）ので、通信の遅れで不利にならない。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員押した / 秒数＋5秒）→ close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'stop', q: 何回目, ms }（1回に1人1度だけ。2回目は反則）

import { mulberry32 } from './util.js';
import { since, leaders, winnersText, scoreChips } from './party.js';

const TOTAL = 5;
const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;
const PEEK_CHOICES = [[3, '3秒'], [0, '見えない'], [5, '5秒']]; // 時計が見えている秒数（詳細設定）
const peekMs = (s) => (PEEK_CHOICES.some(([v]) => v === s.rules.peek) ? s.rules.peek : 3) * 1000;
const EXTRA_MS = 5000; // 目標の秒数を過ぎても押せる時間

const qKey = (s, q = s.q) => `pittari:${s.seed}:${q}`;
const limitOf = (s) => s.targets[s.q] * 1000 + EXTRA_MS;
const diffOf = (s, p) => (s.stops[p] === null ? Infinity : Math.abs(s.stops[p] - s.targets[s.q] * 1000));
const clone = (s) => ({ ...s, scores: s.scores.slice(), stops: s.stops.slice() });

// 近い順の点（1位3点・2位2点・3位1点。同じずれは同じ順位）
export function pointsOf(diffs) {
  return diffs.map((d) => (d === Infinity ? 0 : Math.max(0, 3 - diffs.filter((e) => e < d).length)));
}

const sec = (ms) => (ms / 1000).toFixed(2);
const signed = (ms) => (ms >= 0 ? '+' : '−') + sec(Math.abs(ms));

const cpuPlan = new Map();
let ui = null; // { mount, wrap, chips, note, btn }

export default {
  id: 'pittari',
  name: 'ぴったりストップ',
  icon: '⏱️',
  desc: '時計を見ずに、決められた秒数ちょうどでストップ',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'fixed', label: 'いつも10秒', desc: '止める秒数を毎回10秒にする（いいえ なら5〜15秒で毎回変わる）', def: false },
    { key: 'peek', label: '時計の見える時間', desc: '始めに時計が見えている時間。「見えない」は最初から自分の感覚だけで数える', def: 3, choices: PEEK_CHOICES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { fixed: false, ...rules };
    const rnd = mulberry32(seed);
    const targets = Array.from({ length: TOTAL }, () => (r.fixed ? 10 : 5 + Math.floor(rnd() * 11)));
    return { n, seed, rules: r, targets, q: -1, phase: 'ready', stops: Array(n).fill(null), scores: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.stops[p] === null; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : (b.last.pts[me] ?? 0) === 3 ? 'correct' : 'pop';
    return m.p === me ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `${s.q + 1}回目 / ${TOTAL}`;
    return `${s.q + 1}回目の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.stops.every((v) => v !== null)) return { key: 'all' + s.q, ms: 600, move: { t: 'close' } };
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
        if (s.q + 1 >= TOTAL) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.stops = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.stops.map((v, p) => diffOf(s, p)));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        return s;
      }
      return null;
    }
    if (m.t !== 'stop' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (typeof m.ms !== 'number' || !(m.ms > 0) || m.ms > limitOf(s0) + 500 || s0.stops[m.p] !== null) return null;
    const s = clone(s0);
    s.step += 1;
    s.stops[m.p] = Math.round(m.ms);
    return s;
  },

  // CPU: 目標から 0.2〜1秒ずれたところで押す（早いか遅いかは半々）。押す時刻はあらかじめ決めて、その値を送る
  cpuDelay(s) { return s.phase === 'open' ? 100 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.stops[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const off = (200 + Math.random() * 800) * (Math.random() < 0.5 ? -1 : 1);
      plan = { at: s.targets[s.q] * 1000 + off };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (since(qKey(s)) < plan.at) return null;
    return { t: 'stop', q: s.q, ms: Math.round(plan.at) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.stops[p] !== null ? '<span class="pt-ok">ストップ</span>' : '';
      if (!shown || !s.last || s.q < 0) return '';
      if (s.stops[p] === null) return '<span class="pt-ng">―</span>';
      const d = s.stops[p] - s.targets[s.q] * 1000;
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">${sec(s.stops[p])}秒（${signed(d)}）${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.stops[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }

    root.innerHTML = '';
    root.className = 'board pz';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    ui = { mount, wrap, chips };
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    root.append(wrap);

    if (s.phase === 'ready') {
      const peek = peekMs(s);
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${peek ? `時計は最初の${peek / 1000}秒だけ見えます` : '時計は見えません'}</div>`;
      return;
    }
    const q = s.q;
    const target = s.targets[q];
    card.innerHTML = `<div class="kj-num">${q + 1}回目 / ${TOTAL}</div><div class="pz-target"><b>${target}</b>秒で止めて！</div><div class="pz-clock"></div>`;
    const clock = card.querySelector('.pz-clock');
    const note = document.createElement('p');
    note.className = 'cc-log';

    if (s.phase === 'open') {
      const key = qKey(s);
      since(key); // 画面に出た時刻を覚える
      const mine = me !== null ? s.stops[me] : null;
      if (mine !== null) {
        clock.textContent = sec(mine);
        clock.classList.add('done');
        note.textContent = `${sec(mine)}秒でストップ（${signed(mine - target * 1000)}）。ほかの人を待っています`;
      } else {
        const tick = () => {
          if (!clock.isConnected) return;
          const t = since(key);
          if (t < peekMs(s)) {
            clock.textContent = sec(t);
            requestAnimationFrame(tick);
          } else {
            clock.textContent = '?.??';
            clock.classList.add('hidden');
          }
        };
        tick();
        if (me !== null) {
          const btn = document.createElement('button');
          btn.className = 'btn primary pz-stop';
          btn.textContent = 'ストップ';
          btn.onpointerdown = (e) => {
            e.preventDefault();
            const ms = Math.round(since(key));
            if (btn.disabled || ms > limitOf(s)) return;
            btn.disabled = true;
            o.onMove({ t: 'stop', q: s.q, ms });
          };
          wrap.append(btn);
          setTimeout(() => {
            if (!btn.isConnected) return;
            btn.disabled = true;
            note.textContent = '時間切れ！';
          }, Math.max(0, limitOf(s) - since(key)));
        } else {
          note.textContent = '観戦中';
        }
      }
    } else {
      clock.textContent = '';
      const best = s.last ? s.last.pts.indexOf(3) : -1;
      note.textContent = best < 0 ? 'だれも押しませんでした' : '';
    }
    wrap.append(note);
  },
};
