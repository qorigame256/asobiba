// 時計あわせ。「3時40分」と出たら、アナログ時計の針を回してその時刻に合わせる。早く合わせた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-16 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 長い針・短い針を、それぞれ指でつまんで回す（本物の時計のように長い針につられて何周も回す形にはしない）。
//   - 長い針は5分きざみで止まる。詳細設定「むずかしさ」の「むずかしい」だけ1分きざみ。
//   - 1問ごとに、合わせた速い順に 3点・2点・それ以降は1点。全部で10問（難読漢字・10を作れと同じ形）。
// Claude の判断:
//   - 短い針は「何時か」だけを選ぶ。置いた位置は長い針に合わせて本物の時計と同じ所（3時40分なら 3 と 4 の間の 3分の2）へ寄せる。
//     なので短い針を 3 と 4 のどちらに近く置いても、長い針が40分なら「3時」を選んだ位置から近い方の時にそろう（angle/30 − 分/60 を丸める）。
//   - 合っているかは指を離したときに見る（回している途中で正しい時刻を通っても数えない）。合っていれば、問題が出てからの時間を送る。
//   - 今の針の時刻を数字では出さない（出すと数字を合わせるだけになり、時計を読む遊びでなくなるため）。
//   - 針のはじめの位置は問題ごとに種から決め、全員同じ。正しい時刻と同じにはしない。答えの時刻に 0分（「3時ちょうど」）も入る。
//   - 制限時間は1問 20秒（むずかしいは25秒）。最初に合わせた人が出てから8秒で締め切る（制限時間のほうが先なら制限時間で）。全員合わせたら1.5秒。
//   - どちらの針をつかむかは、押した所の向きにいちばん近い針。2本とも近い（20度以内）ときは、まん中寄り（半径60未満）なら短い針、外寄りなら長い針。
//   - CPU は 1問 4〜9秒（むずかしいは 6〜13秒）で合わせ、7回に1回ほど合わせられない。どちらも種から決める。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数字タッチと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, ms }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 8000;
const MIN_MS = 800; // これより速い手は弾く
const ROUNDS = 10;
const LEVELS = [['easy', 'ふつう（5分きざみ）'], ['hard', 'むずかしい（1分きざみ）']];
const levelOf = (r) => (r.level === 'hard' ? 'hard' : 'easy');
const stepOf = (s) => (s.level === 'hard' ? 1 : 5);
const limitOf = (s) => (s.level === 'hard' ? 25000 : 20000);
const qKey = (s, q = s.q) => `tokei:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });
const doneOf = (s, p) => s.solved[p] !== null;

// 「3時40分」「3時ちょうど」
export const timeText = (h, m) => (m === 0 ? `${h}時ちょうど` : `${h}時${m}分`);
// 針の向き（度。12時が0、時計回り）
export const minAngle = (m) => m * 6;
export const hourAngle = (h, m) => ((h % 12) + m / 60) * 30;
// 向きから時刻を選ぶ（step 分きざみ）。短い針は今の分に合わせた位置から一番近い「時」
export const minOf = (deg, step) => (((Math.round(norm(deg) / 6 / step) * step) % 60) + 60) % 60;
export const hourOf = (deg, m) => { const h = ((Math.round(norm(deg) / 30 - m / 60) % 12) + 12) % 12; return h === 0 ? 12 : h; };
const norm = (d) => ((d % 360) + 360) % 360;
const gap = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); };

// CPU が合わせ終える時刻（ms）。null は合わせられない回。種・何問目・席から決めるので全員の端末で同じ
export function cpuTime(s, q, p) {
  const rnd = mulberry32((s.seed * 37 + q * 11 + p * 1013 + 7771) >>> 0);
  if (rnd() < 0.15) return null;
  const [lo, hi] = s.level === 'hard' ? [6000, 13000] : [4000, 9000];
  return Math.round(lo + rnd() * (hi - lo));
}

let loc = null; // この端末の針 { key, h, m, sent }
let ui = null;

export default {
  id: 'tokei',
  name: '時計あわせ',
  icon: '🕰️',
  desc: '言われた時刻に時計の針を合わせる。早く合わせるほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '長い針が止まるきざみ', def: 'easy', choices: LEVELS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'easy', ...rules };
    const level = levelOf(r);
    const step = level === 'hard' ? 1 : 5;
    const rnd = mulberry32(seed);
    const pick = () => ({ h: 1 + Math.floor(rnd() * 12), m: Math.floor(rnd() * (60 / step)) * step });
    const qs = [];
    for (let i = 0; i < ROUNDS; i++) {
      let t = pick();
      // 同じ時刻が続かないように
      for (let k = 0; k < 20 && qs.some((x) => x.h === t.h && x.m === t.m); k++) t = pick();
      let st = pick();
      for (let k = 0; k < 20 && (st.h === t.h || st.m === t.m); k++) st = pick();
      qs.push({ h: t.h, m: t.m, sh: st.h, sm: st.m });
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
    if (typeof m.ms !== 'number' || !(m.ms >= MIN_MS) || m.ms > limitOf(s0) + 500) return null;
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
    return t >= end ? { t: 'done', q: s.q, ms: Math.max(end, Math.round(t)) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${s.solved.some((v) => v !== null)}:${!!o.canMove}`;
    const key = qKey(s);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">あわせた！</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj tk';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const limit = limitOf(s);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">言われた時刻に針を合わせよう・全${s.qs.length}問・1問 ${limit / 1000}秒まで</div>`;
      return;
    }
    const Q = s.qs[s.q];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="kj-word tk-word">${timeText(Q.h, Q.m)}</div>`;
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが合わせた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも合わせられませんでした';
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, h: Q.sh, m: Q.sm, sent: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    // 結果の間は正しい時刻を見せる
    const show = s.phase === 'shown' ? { h: Q.h, m: Q.m } : me === null ? { h: Q.sh, m: Q.sm } : loc;
    const clock = drawClock();
    clock.svg.classList.toggle('live', playing);
    clock.svg.classList.toggle('answer', s.phase === 'shown');
    const note = document.createElement('p');
    note.className = 'cc-log';
    const paint = () => {
      clock.set(show.h, show.m);
      note.textContent = s.phase !== 'open' ? `正解は ${timeText(Q.h, Q.m)}` : me === null ? '観戦中'
        : doneOf(s, me) || loc.sent ? `あわせた！（${doneOf(s, me) ? secText(s.solved[me]) : '…'}）ほかの人を待っています`
        : '針をつまんで回そう（短い針と長い針は別々に動く）';
    };
    if (playing) {
      const step = stepOf(s);
      let grab = null; // 'h' | 'm'
      const angleAt = (e) => {
        const r = clock.svg.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * 200 - 100, y = (e.clientY - r.top) / r.height * 200 - 100;
        return { deg: norm(Math.atan2(x, -y) * 180 / Math.PI), rad: Math.hypot(x, y) };
      };
      const moveTo = (e) => {
        const { deg } = angleAt(e);
        if (grab === 'm') {
          const m = minOf(deg, step);
          if (m !== loc.m) { loc.m = m; play('chip', 0.15); }
        } else {
          const h = hourOf(deg, loc.m);
          if (h !== loc.h) { loc.h = h; play('chip', 0.15); }
        }
        paint();
      };
      clock.svg.onpointerdown = (e) => {
        if (!playing || loc.sent) return;
        e.preventDefault();
        const { deg, rad } = angleAt(e);
        const dh = gap(deg, hourAngle(loc.h, loc.m)), dm = gap(deg, minAngle(loc.m));
        grab = dh < 20 && dm < 20 ? (rad < 60 ? 'h' : 'm') : dh < dm ? 'h' : 'm';
        clock.svg.classList.toggle('grab-h', grab === 'h');
        clock.svg.classList.toggle('grab-m', grab === 'm');
        try { clock.svg.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
        moveTo(e);
      };
      clock.svg.onpointermove = (e) => { if (grab) moveTo(e); };
      const release = () => {
        if (!grab) return;
        grab = null;
        clock.svg.classList.remove('grab-h', 'grab-m');
        if (loc.sent || loc.h !== Q.h || loc.m !== Q.m) return;
        const ms = Math.round(since(key));
        if (ms >= limit) return;
        loc.sent = true;
        o.onMove({ t: 'done', q: s.q, ms: Math.max(ms, MIN_MS) });
        paint();
      };
      clock.svg.onpointerup = release;
      clock.svg.onpointercancel = release;
    }
    wrap.append(clock.box, note);
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
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${timeText(s.qs[q].h, s.qs[q].m)}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// 時計の絵（SVG）。set(時, 分) で針を動かす
function drawClock() {
  const box = document.createElement('div');
  box.className = 'tk-box';
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const big = i % 5 === 0;
    return `<line x1="0" y1="${big ? -84 : -87}" x2="0" y2="-91" class="${big ? 'tk-tick big' : 'tk-tick'}" transform="rotate(${i * 6})"/>`;
  }).join('');
  const nums = Array.from({ length: 12 }, (_, i) => {
    const h = i + 1, a = h * 30 * Math.PI / 180;
    return `<text x="${(Math.sin(a) * 70).toFixed(1)}" y="${(-Math.cos(a) * 70).toFixed(1)}" class="tk-n">${h}</text>`;
  }).join('');
  box.innerHTML = `<svg viewBox="-100 -100 200 200" class="tk-clock" role="img" aria-label="時計">
    <circle r="96" class="tk-rim"/><circle r="92" class="tk-face"/>${ticks}${nums}
    <g class="tk-hour"><line x1="0" y1="10" x2="0" y2="-46"/><circle cy="-46" r="7" class="tk-knob"/></g>
    <g class="tk-min"><line x1="0" y1="14" x2="0" y2="-76"/><circle cy="-76" r="6" class="tk-knob"/></g>
    <circle r="5" class="tk-pin"/></svg>`;
  const svg = box.querySelector('svg');
  const hg = svg.querySelector('.tk-hour'), mg = svg.querySelector('.tk-min');
  return {
    box, svg,
    set(h, m) {
      hg.setAttribute('transform', `rotate(${hourAngle(h, m)})`);
      mg.setAttribute('transform', `rotate(${minAngle(m)})`);
    },
  };
}
