// まんなかの漢字（テレビの「和同開珎」風）。上と左の字から「まんなか」へ、まんなかから右と下の字へ読むと4つとも熟語になる、まんなかの1字を当てる。
// 2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 答えは4つの漢字から選ぶ（1問に1回だけ。打ち込みはしない）。
//   - 点と進め方は難読漢字と同じ: 正解した速い順に 3点・2点・それ以降は1点。10問・15問・20問（最初は10問）。
//   - 問題は Claude が書く（mannaka-data.js）。誤りに気づいたら本人が知らせる。
// Claude の判断:
//   - 1問の制限時間は20秒。だれかが正解したら5秒で締め切る（難読漢字と同じ）。全員が答えたら1.5秒。
//   - まちがいの3つは、ほかの問題のまんなかの字から種で選ぶ（この問題のまわりの4字は選ばない）。全員同じ。
//   - CPU は3〜10秒で答え、6割当てる。
//   - 答えを見せるときは、まんなかに正しい字を入れ、4つの熟語も並べる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（色ちがい早押しと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ字, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';
import { MANNAKA } from './mannaka-data.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 20000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;

const qKey = (s, q = s.q) => `mannaka:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
// まわりの4字（上・左・右・下）
export const sidesOf = ([c, top, left, right, bottom]) => [top[0], left[0], right[1], bottom[1]];
// 4つの答えの札（正しい字と、ほかの問題のまんなかの字3つ）。種と何問目かから作るので全員同じ
export function choicesOf(seed, q, i) {
  const x = MANNAKA[i];
  const rnd = mulberry32((seed * 131 + q * 17 + 7) >>> 0);
  const bad = new Set([x[0], ...sidesOf(x)]);
  const pool = shuffle(MANNAKA.map((y) => y[0]).filter((c) => !bad.has(c)), rnd).slice(0, 3);
  return shuffle([x[0], ...pool], rnd);
}
const cpuPlan = new Map();

export default {
  id: 'mannaka',
  name: 'まんなかの漢字',
  icon: '🀄',
  desc: 'まわりの4つの漢字とつながって熟語になる、まんなかの1字を早く当てる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, ...rules };
    const rnd = mulberry32(seed);
    const order = shuffle([...MANNAKA.keys()], rnd).slice(0, roundsOf(r));
    const qs = order.map((i, q) => ({ i, opts: choicesOf(seed, q, i) }));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), said: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が押した音は鳴らさない（色ちがい早押しと同じ）
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: AFTER_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + GRACE_MS, move: { t: 'close' } };
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
        s.miss = Array(s.n).fill(false);
        s.said = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    const x = s0.qs[s0.q];
    if (!x.opts.includes(m.c) || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said = s0.said.slice();
    s.said[m.p] = m.c;
    if (m.c === MANNAKA[x.i][0]) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const right = MANNAKA[x.i][0];
      const ok = Math.random() < 0.6;
      const wrong = x.opts.filter((c) => c !== right);
      plan = { at: 3000 + Math.random() * 7000, c: ok ? right : wrong[Math.floor(Math.random() * wrong.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj mn';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">矢印の向きに読むと熟語になる、まんなかの字を当てよう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const data = MANNAKA[x.i];
    const [top, left, right, bottom] = sidesOf(data);
    const key = qKey(s);
    const shown = s.phase !== 'open';
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`);
    const cross = document.createElement('div');
    cross.className = 'mn-cross';
    const cell = (t, cls = '') => `<div class="mn-c ${cls}">${t}</div>`;
    const blank = '<div></div>';
    cross.innerHTML = [
      blank, blank, cell(esc(top)), blank, blank,
      blank, blank, cell('↓', 'arw'), blank, blank,
      cell(esc(left)), cell('→', 'arw'), cell(shown ? esc(data[0]) : '？', 'mid' + (shown ? ' ans' : '')), cell('→', 'arw'), cell(esc(right)),
      blank, blank, cell('↓', 'arw'), blank, blank,
      blank, blank, cell(esc(bottom)), blank, blank,
    ].join('');
    card.append(cross);
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが正解！ 5秒で締め切り</div>');
      card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `${data.slice(1).join('・')}${fast ? ` ／ いちばん速かったのは ${fast}` : ' ／ だれも正解できませんでした'}`;
      card.append(t);
    }
    if (document.activeElement?.classList?.contains('kj-choice')) document.activeElement.blur(); // 前の問題で押した札に残った focus を外す（難読漢字と同じ）
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const grid = document.createElement('div');
    grid.className = 'kj-choices mn-choices';
    const mine = me !== null ? s.said[me] : null;
    const btns = x.opts.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = c === data[0] && (shown || mine === c);
      const ng = c === mine && c !== data[0];
      b.className = 'btn secondary kj-choice mn-choice' + (ok ? ' ok' : ng ? ' ng' : !can ? ' off' : '');
      b.textContent = c;
      b.disabled = !can;
      const hit = (e) => {
        if (!can || grid.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        grid.dataset.sent = '1';
        btns.forEach((y) => { y.disabled = true; });
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したとき
      return b;
    });
    grid.append(...btns);
    wrap.append(grid);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = '4つから1つ選んでください（答えられるのは1回だけ）';
    wrap.append(note);
    if (can) {
      setTimeout(() => {
        if (!grid.isConnected || grid.dataset.sent) return;
        btns.forEach((y) => { y.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
    }
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const data = MANNAKA[s.qs[q].i];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(data[0])}</span><span class="mk-rv-ex">${esc(data.slice(1).join('・'))}</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
