// リズムまね。お手本のリズム（音と光）を聞いて、同じ間隔でボタンをたたく。ずれの小さい人ほど上。2〜10人・足りない分は CPU（弱め）。
// 2026-11-13 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ）: 案のとおり「お手本のリズムを聞いて同じ間隔でたたく。ずれの小さい人が勝ち」。
// Claude の判断:
//   - 5回。たたく数は 4・5・5・6・7。間隔は 0.3秒の倍数で、1・2回目は 0.3秒・0.6秒、3回目からは 0.9秒も混ぜる。お手本は種から作る（全員同じ）。
//   - お手本は1回だけ流す（音と、まん中の丸が光る。音を消している人も光で分かる）。流し終わって 0.8秒で「どうぞ」になり、7秒のうちにたたく。
//   - 比べるのは「1つ目をたたいてから」の間隔だけ（たたき始める時刻は問わない）。ずれ = 2つ目からの各音の、お手本とのずれ（ms）の平均。
//     音の出るまでの遅れ（Bluetooth のイヤホンなど）は1つ目にも同じだけ乗るので、ずれに入らない。
//   - 毎回、ずれの小さい順に 3・2・1点（同じずれは同じ点。数がそろわなかった人は0点）。5回の合計で勝負（ぴったりストップと同じ）。
//   - たたいた時刻は各自の端末で測って手に入れる（通信の遅れで不利にならない）。ほかの人のたたいた様子は、その回の結果まで見せない（札に ✔ だけ）。
//   - CPU は各音を 40〜150ms の幅でずらしてたたく。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員たたいた / 締め切り）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'tap', q: 何回目, d: [2つ目からの、1つ目からの時刻 ms]（たたく数 − 1 個の整数） }

import { mulberry32 } from './util.js';
import { since, leaders, winnersText, scoreChips } from './party.js';
import { play } from '../sound.js';

const U = 300; // 間隔のもと（ms）
const BEATS = [4, 5, 5, 6, 7];
export const LEAD = 1500; // 回が始まってから、お手本の1つ目まで
const WAIT = 800; // お手本の最後から「どうぞ」まで
const LIMIT = 7000; // 「どうぞ」からたたける時間
const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;

// 5回分のお手本。at = 1つ目からの各音の時刻（ms。at[0] = 0）
export function makePatterns(seed) {
  const rnd = mulberry32(seed);
  return BEATS.map((n, q) => {
    const steps = q < 2 ? [1, 2] : [1, 2, 3];
    const at = [0];
    for (let i = 1; i < n; i++) at.push(at[i - 1] + steps[Math.floor(rnd() * steps.length)] * U);
    // 同じ間隔ばかりにならないように: 全部同じなら最後の1つを変える
    const gaps = at.slice(1).map((v, i) => v - at[i]);
    if (gaps.every((g) => g === gaps[0])) at[n - 1] += gaps[0] === U ? U : -U;
    return at;
  });
}
export const openAt = (at) => LEAD + at.at(-1) + WAIT; // 「どうぞ」になる時刻（回が始まってから）

// ずれ（ms の平均。整数）。数が合わなければ null
export function errorOf(at, d) {
  if (!Array.isArray(d) || d.length !== at.length - 1) return null;
  let sum = 0;
  d.forEach((v, i) => { sum += Math.abs(v - at[i + 1]); });
  return Math.round(sum / d.length);
}
// ずれの小さい順の点（1位3点・2位2点・3位1点。同じずれは同じ順位。たたけなかった人は0点）
export function pointsOf(errs) {
  return errs.map((v) => (v === null ? 0 : Math.max(0, 3 - errs.filter((e) => e !== null && e < v).length)));
}

const qKey = (s, q = s.q) => `rhythm:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), taps: s.taps.slice(), errs: s.errs.slice() });
const cpuPlan = new Map();
let ui = null; // { mount, chips }
const played = new Set(); // お手本の音を予約した回（描き直しで2回鳴らさない）
const sec = (ms) => (ms / 1000).toFixed(2);

// まん中の丸を一瞬光らせる（描き直しても今の画面の丸を光らせる）
function flash(cls) {
  const lamp = typeof document !== 'undefined' && document.querySelector('.board.rz .rz-lamp');
  if (!lamp) return;
  lamp.classList.remove('on', 'mine');
  void lamp.offsetWidth;
  lamp.classList.add(cls);
}

export default {
  id: 'rhythm',
  name: 'リズムまね',
  icon: '🥁',
  desc: 'お手本のリズムを聞いて、同じ間隔でたたく',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, pats: makePatterns(seed), q: -1, phase: 'ready', taps: Array(n).fill(null), errs: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || s.taps[p] === null); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p !== -1) return null; // 自分のたたく音はたたいたときに鳴らしている。ほかの人の音は鳴らさない（お手本と混ざるため）
    if (m.t === 'close' && me !== null && me >= 0 && me < b.n) return (b.last?.pts[me] ?? 0) >= 3 ? 'correct' : 'pop';
    return null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}回目 / ${s.pats.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.taps.every((v) => v !== null)) return { key: 'all' + s.q, ms: 600, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: openAt(s.pats[s.q]) + LIMIT + GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.pats.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.taps = Array(s.n).fill(null);
        s.errs = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.errs);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { errs: s.errs.slice() }];
        return s;
      }
      return null;
    }
    if (m.t !== 'tap' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.taps[m.p] !== null) return null;
    const at = s0.pats[s0.q];
    const d = m.d;
    if (!Array.isArray(d) || d.length !== at.length - 1 || !d.every((v, i) => Number.isInteger(v) && v > (i ? d[i - 1] : 0) && v <= LIMIT)) return null;
    const s = clone(s0);
    s.step += 1;
    s.taps[m.p] = d.slice();
    s.errs[m.p] = errorOf(at, d);
    return s;
  },

  // CPU: 「どうぞ」から 0.5〜1.5秒でたたき始め、各音を 40〜150ms の幅でずらす
  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.taps[p] !== null) return null;
    const at = s.pats[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const w = 40 + Math.random() * 110;
      const d = [];
      for (let i = 1; i < at.length; i++) {
        let v = Math.round(at[i] + (Math.random() * 2 - 1) * w);
        v = Math.max(v, (i > 1 ? d[i - 2] : 0) + 60);
        d.push(v);
      }
      plan = { at: openAt(at) + 500 + Math.random() * 1000 + at.at(-1), d };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'tap', q: s.q, d: plan.d } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.taps[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.errs[p] === null) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">±${sec(s.errs[p])}${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替える（ほかの人の手が届くたびに作り直すと、描きかけ・押しかけが消えるため）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.taps[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    ui = { mount, chips };
    root.innerHTML = '';
    root.className = 'board rz';
    root.append(chips);
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const head = document.createElement('p');
    head.className = 'cp-head';
    root.append(head);
    if (s.phase === 'ready') {
      head.textContent = `よーい… お手本のリズムを聞いて、同じ間隔でたたこう（全${s.pats.length}回・ずれの小さい順に 3・2・1点）`;
      return;
    }
    const at = s.pats[s.q];
    const key = qKey(s);
    const t0 = since(key);
    const open = openAt(at);
    head.textContent = `${at.length}回たたくリズム`;

    const lamp = document.createElement('div');
    lamp.className = 'rz-lamp';
    const dots = document.createElement('div');
    dots.className = 'rz-dots';
    const dot = at.map(() => { const d = document.createElement('i'); dots.append(d); return d; });
    root.append(lamp, dots);
    const note = document.createElement('p');
    note.className = 'cc-log';
    root.append(note);

    const mine = me !== null ? s.taps[me] : null;
    if (s.phase === 'shown') {
      dot.forEach((d) => d.classList.add('lit'));
      root.append(this.timeline(at, mine));
      note.textContent = mine ? `ずれ ±${sec(s.errs[me])}秒${s.last.pts[me] ? `（+${s.last.pts[me]}点）` : ''}　上がお手本、下があなた` : me === null ? '上がお手本' : 'たたけませんでした…';
      return;
    }

    // お手本を流す（各自の画面で回が始まった時刻から。描き直しても2回は鳴らさない）
    if (!played.has(key)) {
      played.add(key);
      if (played.size > 50) played.delete(played.values().next().value);
      at.forEach((v) => {
        const wait = LEAD + v - t0;
        if (wait < -50) return;
        setTimeout(() => {
          if (!document.querySelector('.board.rz')) return; // 対局の画面を離れていたら鳴らさない
          play('hit');
          flash('on');
        }, Math.max(0, wait));
      });
    }
    // お手本の進み具合の点
    const showDots = () => { at.forEach((v, i) => dot[i].classList.toggle('lit', since(key) >= LEAD + v)); };
    showDots();

    if (mine) {
      note.textContent = 'たたけた！ ほかの人を待っています';
      return;
    }
    if (me === null) { note.textContent = '観戦中'; return; }
    const btn = document.createElement('button');
    btn.className = 'btn primary rz-tap';
    btn.textContent = 'たたく';
    btn.disabled = true;
    root.append(btn);
    const taps = [];
    let sent = false;
    const noteText = () => {
      const t = since(key);
      if (t < open) return '👂 よく聞いて…';
      if (t >= open + LIMIT) return '時間切れ…';
      return taps.length ? `${taps.length} / ${at.length}` : `どうぞ！ ${at.length}回たたこう（PC はスペースキーでも）`;
    };
    note.textContent = noteText();
    const hit = (e) => {
      e?.preventDefault?.();
      if (sent || btn.disabled || !o.canMove) return;
      const t = since(key);
      if (t < open || t >= open + LIMIT) return;
      play('pop');
      flash('mine');
      taps.push(t);
      dot.forEach((d, i) => d.classList.toggle('mine', i < taps.length));
      note.textContent = noteText();
      if (taps.length < at.length) return;
      sent = true;
      btn.disabled = true;
      const d = taps.slice(1).map((v) => Math.round(v - taps[0]));
      for (let i = 0; i < d.length; i++) d[i] = Math.max(d[i], (i ? d[i - 1] : 0) + 1); // 同じ時刻に2回届いたときも並びを保つ
      o.onMove({ t: 'tap', q: s.q, d });
    };
    btn.onpointerdown = hit;
    btn.onclick = (e) => { if (e.detail === 0) hit(e); };
    const tick = () => {
      if (!btn.isConnected || sent) return;
      showDots();
      const t = since(key);
      btn.disabled = t < open || t >= open + LIMIT;
      if (!taps.length || t >= open + LIMIT) note.textContent = noteText();
      if (t < open + LIMIT) setTimeout(tick, t < open ? 50 : 200);
    };
    tick();
  },

  // お手本（上）と自分のたたいた時刻（下）を並べた線
  timeline(at, d) {
    const box = document.createElement('div');
    box.className = 'rz-line';
    const mine = d ? [0, ...d] : [];
    const end = Math.max(at.at(-1), mine.at(-1) ?? 0) || 1;
    const pos = (v) => `${4 + (v / end) * 92}%`;
    box.innerHTML = '<div class="rz-track rz-ref"></div><div class="rz-track rz-me"></div>';
    at.forEach((v) => { const i = document.createElement('i'); i.style.left = pos(v); box.firstChild.append(i); });
    mine.forEach((v) => { const i = document.createElement('i'); i.style.left = pos(v); box.lastChild.append(i); });
    return box;
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const ok = x.errs.filter((v) => v !== null);
      const best = ok.length ? Math.min(...ok) : null;
      const mine = me === null ? '' : x.errs[me] === null ? '―' : '±' + sec(x.errs[me]);
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${s.pats[q].length}回たたく</span><span>${mine}</span><span class="mk-rv-who">いちばん ${best === null ? '―' : '±' + sec(best)}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// PC のスペースキーでたたく（対局の画面にボタンが出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.repeat) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    const b = document.querySelector('.board.rz .rz-tap');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
