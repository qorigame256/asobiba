// コップのどれ？ 玉を入れたコップが目の前でまざる。玉の入ったコップを当てる。2〜10人・足りない分は CPU。
// 2026-11-12 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 当てた人全員に1点（速さは点に関係しない）。まざり終わったら全員が同時に1つ選ぶ。
//   - 全部で5回。回が進むほど難しく（コップは3個から始めて最後は5個、まぜる速さも上げる）。
// Claude の判断:
//   - 回ごとのコップの数・入れ替えの回数・1回の入れ替えの長さは ROUNDS。詳細設定は置かない（回数も難しさも本人の決定で決まっているため）。
//   - 最初にコップを持ち上げて玉を1秒見せ、下ろしてからまぜる。入れ替えは2つのコップが弧を描いて場所を交換する（1つが奥、1つが手前を通る）。
//   - 選べるのは自分の画面でまざり終わってから6秒。全員が選んだら0.7秒で締め切る。結果は全部のコップを持ち上げて2.5秒見せ、だれがどれを選んだかを並べる。
//   - ほかの人が選んだコップは結果まで見せない（まねできないように。札に ✔ だけ出す）。
//   - CPU はまざり終わって0.5〜1.7秒で選び、当たる割合は 1回目9割から最後は5割まで下げる（まちがえるときはほかのコップから1つ）。
//   - 玉の場所と入れ替えは種から作る（全員の端末で同じ動き）。動きは各自の画面で回が始まった時刻から計る。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ場所（左から 0〜） }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, SEAT_COLORS } from './party.js';

// 回ごとの難しさ: cups = コップの数、swaps = 入れ替えの回数、dur = 1回の入れ替えの長さ（ms）
export const ROUNDS = [
  { cups: 3, swaps: 5, dur: 560 },
  { cups: 3, swaps: 7, dur: 460 },
  { cups: 4, swaps: 8, dur: 400 },
  { cups: 4, swaps: 10, dur: 330 },
  { cups: 5, swaps: 12, dur: 280 },
];
const CPU_OK = [0.9, 0.8, 0.7, 0.6, 0.5];
const LIFT = 350; // 持ち上げる・下ろす長さ
const HOLD = 1000; // 玉を見せる長さ
const GAP = 250; // 下ろしてからまぜ始めるまで
export const START = LIFT + HOLD + LIFT + GAP; // まぜ始める時刻
export const LIMIT = 6000; // まざり終わってから選べる時間
const READY_MS = 3000;
const SHOWN_MS = 2500;
const GRACE_MS = 700;

export const animMs = (x) => START + x.swaps.length * x.dur; // まざり終わる時刻

// 5回分の問題。ball = 玉の入ったコップ（最初の場所の番号）、swaps = 入れ替える2つの場所、ans = まざり終わったときの玉の場所
export function makeRounds(seed) {
  const rnd = mulberry32(seed);
  return ROUNDS.map((r) => {
    const ball = Math.floor(rnd() * r.cups);
    const swaps = [];
    for (let i = 0; i < r.swaps; i++) {
      let a;
      let b;
      do {
        a = Math.floor(rnd() * r.cups);
        b = Math.floor(rnd() * r.cups);
      } while (a === b || (swaps.length && sameSwap(swaps.at(-1), a, b)));
      swaps.push(a < b ? [a, b] : [b, a]);
    }
    const slot = slotsAfter(r.cups, swaps, swaps.length);
    return { cups: r.cups, dur: r.dur, ball, swaps, ans: slot[ball] };
  });
}
const sameSwap = (s, a, b) => (s[0] === a && s[1] === b) || (s[0] === b && s[1] === a);

// k 回入れ替えたあとの、コップごとの場所（slot[コップ] = 場所）
export function slotsAfter(cups, swaps, k) {
  const slot = [...Array(cups).keys()];
  for (let i = 0; i < k; i++) {
    const [a, b] = swaps[i];
    const ca = slot.indexOf(a);
    const cb = slot.indexOf(b);
    slot[ca] = b;
    slot[cb] = a;
  }
  return slot;
}

// 時刻 t（ms）のコップの見た目: pos[コップ] = { x: 場所（小数）, dy: 上下のずれ（-1〜1）}、lift = 持ち上げ（0〜1）
export function poseAt(x, t) {
  let lift = 0;
  if (t < LIFT) lift = t / LIFT;
  else if (t < LIFT + HOLD) lift = 1;
  else if (t < LIFT + HOLD + LIFT) lift = 1 - (t - LIFT - HOLD) / LIFT;
  const k = t < START ? 0 : Math.min(x.swaps.length, Math.floor((t - START) / x.dur));
  const slot = slotsAfter(x.cups, x.swaps, k);
  const pos = slot.map((s) => ({ x: s, dy: 0 }));
  if (t >= START && k < x.swaps.length) {
    const f = (t - START - k * x.dur) / x.dur;
    const e = 0.5 - 0.5 * Math.cos(Math.PI * f);
    const [a, b] = x.swaps[k];
    const ca = slot.indexOf(a);
    const cb = slot.indexOf(b);
    pos[ca] = { x: a + (b - a) * e, dy: -Math.sin(Math.PI * f) };
    pos[cb] = { x: b + (a - b) * e, dy: Math.sin(Math.PI * f) * 0.6 };
  }
  return { pos, lift };
}

const qKey = (s, q = s.q) => `cup:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice() });
const doneOf = (s, p) => s.picks[p] !== null;
const cpuPlan = new Map();

export default {
  id: 'cup',
  name: 'コップのどれ？',
  icon: '🥤',
  desc: '玉の入ったコップがまざる。どのコップに入っているか当てよう',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, rules: {}, rs: makeRounds(seed), q: -1, phase: 'ready', picks: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return 'question';
      if (m.t === 'close' && me !== null && me >= 0 && me < b.n) return b.last?.ok[me] ? 'correct' : 'wrong';
      return null;
    }
    return m.p === me ? 'chip' : null; // ほかの人が選んだ音は鳴らさない（選んだことが分かるとせかされるため）
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}回目 / ${s.rs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: animMs(s.rs[s.q]) + LIMIT + 800, move: { t: 'close' } };
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
        if (s.q + 1 >= s.rs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.picks = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const ans = s.rs[s.q].ans;
        const ok = s.picks.map((c) => c === ans);
        ok.forEach((v, p) => { if (v) s.scores[p] += 1; });
        s.last = { ok };
        s.log = [...s0.log, { picks: s.picks.slice(), ok }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= s0.rs[s0.q].cups) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.c;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.rs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const others = [...Array(x.cups).keys()].filter((c) => c !== x.ans);
      const ok = Math.random() < CPU_OK[s.q];
      plan = { at: animMs(x) + 500 + Math.random() * 1200, c: ok ? x.ans : others[Math.floor(Math.random() * others.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'ans', q: s.q, c: plan.c } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.last.ok[p]) return '<span class="pt-ok">○ +1</span>';
      return s.picks[p] === null ? '<span class="pt-ng">―</span>' : '<span class="pt-ng">×</span>';
    };
    root.innerHTML = '';
    root.className = 'board cp';
    root.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const head = document.createElement('p');
    head.className = 'cp-head';
    root.append(head);
    if (s.phase === 'ready') {
      head.textContent = `よーい… 玉の入ったコップをよく見て当てよう（全${s.rs.length}回・当てたら1点）`;
      return;
    }
    const x = s.rs[s.q];
    const key = qKey(s);
    const total = animMs(x);
    head.textContent = `コップ${x.cups}個・${x.swaps.length}回まぜる`; // 何回目かは上の状態の欄（phaseText）に出ている

    const stage = document.createElement('div');
    stage.className = 'cp-stage';
    const ball = document.createElement('div');
    ball.className = 'cp-ball';
    stage.append(ball);
    const w = `min(84px, ${78 / x.cups}%)`;
    ball.style.width = `calc(${w} * .42)`;
    const cups = [...Array(x.cups).keys()].map((cup) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-cup';
      b.style.width = w;
      b.disabled = true;
      stage.append(b);
      return b;
    });
    const finalSlot = slotsAfter(x.cups, x.swaps, x.swaps.length);
    const ballCup = x.ball;
    const place = (t) => {
      const shown = s.phase === 'shown';
      const { pos, lift } = shown ? { pos: finalSlot.map((v) => ({ x: v, dy: 0 })), lift: 1 } : poseAt(x, t);
      cups.forEach((b, cup) => {
        const p = pos[cup];
        b.style.left = `${((p.x + 0.5) / x.cups) * 100}%`;
        b.style.transform = `translate(-50%, ${-lift * 70 + p.dy * 14}%) scale(${1 + p.dy * -0.06})`;
        b.style.zIndex = p.dy < 0 ? 1 : 3;
      });
      ball.style.left = `${((pos[ballCup].x + 0.5) / x.cups) * 100}%`;
      ball.style.opacity = lift > 0 ? 1 : 0;
    };
    const can = () => s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) >= total && since(key) < total + LIMIT;
    const enable = () => {
      if (!stage.isConnected) return;
      place(total);
      const ok = can();
      cups.forEach((b) => { b.disabled = !ok; });
      note.textContent = noteText();
    };
    cups.forEach((b, cup) => {
      const c = finalSlot[cup];
      b.setAttribute('aria-label', `左から${c + 1}番目のコップ`);
      if (s.phase === 'shown') {
        if (c === x.ans) b.classList.add('ans');
        if (me !== null && s.picks[me] === c) b.classList.add('mine');
      } else if (me !== null && s.picks[me] === c) b.classList.add('mine');
      const hit = (e) => {
        if (!can() || b.dataset.sent) return;
        e.preventDefault();
        cups.forEach((y) => { y.disabled = true; y.dataset.sent = '1'; });
        b.classList.add('mine');
        o.onMove({ t: 'ans', q: s.q, c });
      };
      b.onpointerdown = hit; // 押した瞬間に選ぶ（指を離すまで待たない）
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したときだけ
    });
    root.append(stage);

    // 結果: だれがどのコップを選んだか
    if (s.phase === 'shown') {
      const row = document.createElement('div');
      row.className = 'cp-picks';
      row.style.gridTemplateColumns = `repeat(${x.cups}, 1fr)`;
      for (let c = 0; c < x.cups; c++) {
        const col = document.createElement('div');
        col.className = 'cp-col' + (c === x.ans ? ' ans' : '');
        s.picks.forEach((v, p) => {
          if (v !== c) return;
          const tag = document.createElement('span');
          tag.className = 'cp-who';
          tag.style.borderColor = SEAT_COLORS[p % SEAT_COLORS.length];
          tag.textContent = p === me ? 'あなた' : o.names[p];
          col.append(tag);
        });
        row.append(col);
      }
      root.append(row);
    }

    const note = document.createElement('p');
    note.className = 'cc-log';
    const noteText = () => {
      if (me === null) return '観戦中';
      if (s.phase === 'shown') return s.last?.ok[me] ? '⭕ 当たり！ +1点' : s.picks[me] === null ? '時間切れ…' : '❌ はずれ…';
      if (doneOf(s, me)) return '選びました。みんなを待とう';
      const t = since(key);
      if (t < total) return '👀 よく見て…';
      if (t >= total + LIMIT) return '時間切れ…';
      return `玉はどのコップ？ 押して選ぼう${x.cups <= 9 ? `（PC は 1〜${x.cups} キーでも）` : ''}`;
    };
    note.textContent = noteText();
    root.append(note);

    // 動き: 各自の画面で回が始まった時刻から計る（描き直しても続きから動く）
    if (s.phase === 'shown') { place(0); return; }
    const t0 = since(key);
    if (t0 >= total) { enable(); return; }
    place(t0);
    const tick = () => {
      if (!stage.isConnected) return;
      const t = since(key);
      if (t >= total) { enable(); return; }
      place(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // 画面が隠れていて requestAnimationFrame がほとんど動かないときも、まざり終わったら選べるように
    setTimeout(enable, total - t0 + 30);
    setTimeout(() => { if (stage.isConnected && note) note.textContent = noteText(); }, total - t0 + LIMIT + 30);
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const r = s.rs[q];
      const li = document.createElement('li');
      const hits = x.ok.filter(Boolean).length;
      const mine = me === null ? '' : x.ok[me] ? '⭕' : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>コップ${r.cups}個・${r.swaps.length}回まぜる</span><span>${mine}</span><span class="mk-rv-who">当てた人 ${hits}/${s.n}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// PC の数字キー（1〜コップの数）で選ぶ（対局の画面にコップが出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (!/^[1-9]$/.test(e.key)) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    const cups = [...document.querySelectorAll('.board.cp .cp-cup')];
    if (!cups.length) return;
    const c = Number(e.key) - 1;
    const b = cups.find((y) => y.getAttribute('aria-label') === `左から${c + 1}番目のコップ`);
    if (!b || b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
