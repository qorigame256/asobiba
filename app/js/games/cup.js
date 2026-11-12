// コップのどれ？ 玉を入れたコップが目の前でまざる。玉の入ったコップを当てる。2〜10人・足りない分は CPU。
// 2026-11-12 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 当てた人全員に1点（速さは点に関係しない）。まざり終わったら全員が同時に1つ選ぶ。
//   - 全部で5回。回が進むほど難しく（コップは3個から始めて最後は5個、まぜる速さも上げる）。
// 詳細設定（2026-11-12 の40回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - 「回数」3回・5回（最初）・8回（鍵は rounds）: 3回は ROUNDS の1・3・5回目、8回は LONG（同じく3個から5個へ、まぜる回数と速さを上げていく）。
//   - 「難しさ」やさしい・ふつう（最初）・むずかしい（鍵は level）: やさしいはコップを最大4個に、むずかしいは最初から5個にする（まぜる回数と速さは回数の表のまま）。
//   - 「はずれたら脱落」なし（最初）・あり（鍵は drop）: 外したか選ばなかった人はそこで脱落し、最後まで残った人の勝ち（点は今までどおり数える）。
//     残っている全員が外した回は、だれも脱落しない。残りが1人になったら（2人以上で始めたとき）その人の勝ちで終わる。○×クイズの脱落と同じ形。
//   - 3つとも最初の値のときの問題は前と全く同じ（makeRounds の乱数の使い方を変えていない）。
// Claude の判断:
//   - 回ごとのコップの数・入れ替えの回数・1回の入れ替えの長さは ROUNDS（5回のとき）。
//   - 最初にコップを持ち上げて玉を1秒見せ、下ろしてからまぜる。入れ替えは2つのコップが弧を描いて場所を交換する（1つが奥、1つが手前を通る）。
//   - 選べるのは自分の画面でまざり終わってから6秒。全員が選んだら0.7秒で締め切る。結果は全部のコップを持ち上げて2.5秒見せ、だれがどれを選んだかを並べる。
//   - ほかの人が選んだコップは結果まで見せない（まねできないように。札に ✔ だけ出す）。
//   - CPU はまざり終わって0.5〜1.7秒で選び、当たる割合は 1回目9割から最後は5割まで下げる（回数が違っても最初と最後は同じ。まちがえるときはほかのコップから1つ）。
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
// 8回のとき
const LONG = [
  { cups: 3, swaps: 4, dur: 600 },
  { cups: 3, swaps: 5, dur: 560 },
  { cups: 3, swaps: 7, dur: 460 },
  { cups: 4, swaps: 8, dur: 400 },
  { cups: 4, swaps: 10, dur: 330 },
  { cups: 5, swaps: 11, dur: 300 },
  { cups: 5, swaps: 12, dur: 280 },
  { cups: 5, swaps: 14, dur: 250 },
];
const ROUND_CHOICES = [[3, '3回'], [5, '5回'], [8, '8回']];
const LEVELS = [['mid', 'ふつう'], ['easy', 'やさしい（コップは4個まで）'], ['hard', 'むずかしい（最初から5個）']];
// 詳細設定から回ごとの難しさの表を作る
export function planOf(rules = {}) {
  let plan = rules.rounds === 3 ? [ROUNDS[0], ROUNDS[2], ROUNDS[4]] : rules.rounds === 8 ? LONG : ROUNDS;
  if (rules.level === 'easy') plan = plan.map((r) => ({ ...r, cups: Math.min(r.cups, 4) }));
  if (rules.level === 'hard') plan = plan.map((r) => ({ ...r, cups: 5 }));
  return plan;
}
const cpuOk = (q, total) => (total <= 1 ? 0.9 : 0.9 - (0.4 * q) / (total - 1));
const LIFT = 350; // 持ち上げる・下ろす長さ
const HOLD = 1000; // 玉を見せる長さ
const GAP = 250; // 下ろしてからまぜ始めるまで
export const START = LIFT + HOLD + LIFT + GAP; // まぜ始める時刻
export const LIMIT = 6000; // まざり終わってから選べる時間
const READY_MS = 3000;
const SHOWN_MS = 2500;
const GRACE_MS = 700;
// 締め切りの余裕: ゲストの画面は回の始まりが通信の分だけ遅れ、答えも通信の分だけ遅れて届く。往復でこれより遅いと、自分の画面では間に合った答えが時間切れになる
// （0.8秒だった。2026-11-12 の Codex の点検。○×クイズは1秒・風船ふくらましは1.5秒）
const LATE_MS = 1500;

export const animMs = (x) => START + x.swaps.length * x.dur; // まざり終わる時刻

// 5回分の問題。ball = 玉の入ったコップ（最初の場所の番号）、swaps = 入れ替える2つの場所、ans = まざり終わったときの玉の場所
export function makeRounds(seed, plan = ROUNDS) {
  const rnd = mulberry32(seed);
  return plan.map((r) => {
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
const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice(), out: s.out.slice() });
const alive = (s, p) => s.out[p] === null;
const doneOf = (s, p) => !alive(s, p) || s.picks[p] !== null;
const cpuPlan = new Map();

// 結果（脱落ありの順位を含む。○×クイズと同じ形）
function finish(s) {
  if (!s.rules.drop) return { winners: leaders(s.scores), scores: s.scores };
  const all = [...Array(s.n).keys()];
  const live = all.filter((p) => alive(s, p));
  const top = live.length ? Math.max(...live.map((p) => s.scores[p])) : 0;
  const winners = live.filter((p) => s.scores[p] === top);
  // 強さ: 残った人は点で、脱落した人は脱落した回が後ろほど上
  const power = (p) => (alive(s, p) ? 1e6 + s.scores[p] : s.out[p]);
  const place = all.map((p) => 1 + all.filter((x) => power(x) > power(p)).length);
  return { winners, scores: s.scores, place };
}

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
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で当てる回数（回が進むほどコップが増えて速くなる）', def: 5, choices: ROUND_CHOICES },
    { key: 'level', label: '難しさ', desc: 'コップの数。やさしいは4個まで、むずかしいは最初から5個', def: 'mid', choices: LEVELS },
    { key: 'drop', label: 'はずれたら脱落', desc: '外したか選ばなかった人は脱落。最後まで残った人の勝ち（全員外した回はだれも脱落しない）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, level: 'mid', drop: false, ...rules };
    return { n, seed, rules: r, rs: makeRounds(seed, planOf(r)), q: -1, phase: 'ready', picks: Array(n).fill(null), out: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || alive(s, p)); },
  result(s) { return s.phase === 'end' ? finish(s) : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return 'question';
      if (m.t === 'close' && me !== null && me >= 0 && me < b.n && alive(a, me)) return b.last?.ok[me] ? 'correct' : 'wrong';
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
      return { key: 'open' + s.q, ms: animMs(s.rs[s.q]) + LIMIT + LATE_MS, move: { t: 'close' } };
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
        const live = [...Array(s.n).keys()].filter((p) => alive(s, p)).length;
        if (s.q + 1 >= s.rs.length || (s.rules.drop && s.n >= 2 && live <= 1)) { s.phase = 'end'; return s; }
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
        const live = [...Array(s.n).keys()].filter((p) => alive(s, p));
        let dropped = [];
        if (s.rules.drop) {
          dropped = live.filter((p) => !ok[p]);
          if (dropped.length === live.length) dropped = []; // 全員外したら、だれも脱落しない
          for (const p of dropped) s.out[p] = s.q;
        }
        s.last = { ok, dropped };
        s.log = [...s0.log, { picks: s.picks.slice(), ok, live: live.length }];
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
      const ok = Math.random() < cpuOk(s.q, s.rs.length);
      plan = { at: animMs(x) + 500 + Math.random() * 1200, c: ok ? x.ans : others[Math.floor(Math.random() * others.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'ans', q: s.q, c: plan.c } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? finish(s).winners : [];
    const justOut = (p) => s.phase === 'shown' && s.last?.dropped?.includes(p);
    const extra = (p) => {
      if (!alive(s, p) && !justOut(p)) return '<span class="pt-ng">脱落</span>';
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.last.ok[p]) return '<span class="pt-ok">○ +1</span>';
      return `<span class="pt-ng">${s.picks[p] === null ? '―' : '×'}${justOut(p) ? ' 脱落' : ''}</span>`;
    };
    root.innerHTML = '';
    root.className = 'board cp';
    root.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const head = document.createElement('p');
    head.className = 'cp-head';
    root.append(head);
    if (s.phase === 'ready') {
      head.textContent = `よーい… 玉の入ったコップをよく見て当てよう（全${s.rs.length}回・当てたら1点${s.rules.drop ? '・はずれたら脱落' : ''}）`;
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
    const can = () => s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && alive(s, me) && since(key) >= total && since(key) < total + LIMIT;
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
      if (!alive(s, me) && !justOut(me)) return '脱落しました。最後まで見守ろう';
      if (s.phase === 'shown') return s.last?.ok[me] ? '⭕ 当たり！ +1点' : (s.picks[me] === null ? '時間切れ…' : '❌ はずれ…') + (justOut(me) ? ' 脱落' : '');
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
      const mine = me === null ? '' : s.out[me] !== null && q > s.out[me] ? '―' : x.ok[me] ? '⭕' : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>コップ${r.cups}個・${r.swaps.length}回まぜる</span><span>${mine}</span><span class="mk-rv-who">当てた人 ${hits}/${x.live ?? s.n}</span>`;
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
