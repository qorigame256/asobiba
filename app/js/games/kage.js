// シルエットクイズ。絵文字を真っ黒の影にして出し、何の影かを4つの名前から早押しで選ぶ。2〜10人・足りない分は CPU（弱め）。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 答えは4択の早押し。4つの答えは同じ仲間（動物なら動物）から選ぶ。
//   - 点と回数は難読漢字と同じ: 正解した速い順に 3点・2点・それ以降は1点。10問（詳細設定で15・20問）。
//   - 絵は絵文字（kage-data.js）。端末ごとに絵の形は違うが、影と答えは同じ端末の絵なので食い違わない。
// Claude の判断:
//   - 1問の制限時間は15秒。だれかが正解したら4秒で締め切る。全員が答えたら1.5秒。1問に1回だけ答えられる。
//   - 問題は種で全部の絵から選ぶ（同じ対局で同じ絵は出さない）。まちがいの3つも種で選ぶので全員同じ。
//   - 影は CSS の filter（brightness(0)）で作る。答えを見せるときに色の付いた絵に戻す。
//   - CPU は2.5〜9秒で答え、6割5分当てる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（まんなかの漢字と同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ名前, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';
import { KAGE, KINDS } from './kage-data.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 3000;
const GRACE_MS = 1500;
const AFTER_MS = 4000;

const qKey = (s, q = s.q) => `kage:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
// 4つの答えの札（正しい名前と、同じ仲間のほかの名前3つ）。種と何問目かから作るので全員同じ
export function choicesOf(seed, q, i) {
  const [, name, kind] = KAGE[i];
  const rnd = mulberry32((seed * 151 + q * 23 + 5) >>> 0);
  const pool = shuffle(KAGE.filter(([, n, k]) => k === kind && n !== name).map(([, n]) => n), rnd).slice(0, 3);
  return shuffle([name, ...pool], rnd);
}
const cpuPlan = new Map();

export default {
  id: 'kage',
  name: 'シルエットクイズ',
  icon: '👤',
  desc: '真っ黒な影を見て、何の影かを4つから早押しで当てる',
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
    const order = shuffle([...KAGE.keys()], rnd).slice(0, roundsOf(r));
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
    if (m.c === KAGE[x.i][1]) s.solved[m.p] = Math.round(m.ms);
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
      const right = KAGE[x.i][1];
      const ok = Math.random() < 0.65;
      const wrong = x.opts.filter((c) => c !== right);
      plan = { at: 2500 + Math.random() * 6500, c: ok ? right : wrong[Math.floor(Math.random() * wrong.length)] };
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
    root.className = 'board kj kg2';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">真っ黒な影は何の影？ 4つから選ぼう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const [emoji, name, kind] = KAGE[x.i];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}　仲間: ${esc(KINDS[kind])}</div>`);
    const pic = document.createElement('div');
    pic.className = 'sk-pic' + (shown ? ' show' : '');
    pic.textContent = emoji;
    pic.setAttribute('aria-hidden', 'true');
    card.append(pic);
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが正解！ 4秒で締め切り</div>');
      card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `答えは「${name}」${fast ? ` ／ いちばん速かったのは ${fast}` : ' ／ だれも正解できませんでした'}`;
      card.append(t);
    }
    if (document.activeElement?.classList?.contains('kj-choice')) document.activeElement.blur(); // 前の問題で押した札に残った focus を外す（難読漢字と同じ）
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const grid = document.createElement('div');
    grid.className = 'kj-choices sk-choices';
    const mine = me !== null ? s.said[me] : null;
    const btns = x.opts.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = c === name && (shown || mine === c);
      const ng = c === mine && c !== name;
      b.className = 'btn secondary kj-choice sk-choice' + (ok ? ' ok' : ng ? ' ng' : !can ? ' off' : '');
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
      const [emoji, name] = KAGE[s.qs[q].i];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(emoji)}</span><span class="mk-rv-ex">${esc(name)}</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
