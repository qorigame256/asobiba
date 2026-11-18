// なぞなぞ早押し。「パンはパンでも食べられないパンは？」のようななぞなぞに、4つの答えから早押しで答える。2〜10人・足りない分は CPU（弱め）。
// 2026-11-18 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 答えは4つから選ぶ（1問に1回だけ）。正解した速い順に 3点・2点・それ以降は1点。10問（詳細設定で15・20問）。
//   - 答えのあとに「なぜそうなるか」を1行で出す。問題は Claude が書く（nazo-data.js。90問ほど）。誤りに気づいたら本人が知らせる。
// Claude の判断:
//   - 1問の制限時間は15秒。だれかが正解したら5秒で締め切る（まんなかの漢字と同じ）。全員が答えたら1.5秒。答えと説明を見せる間は4秒。
//   - 4つの札の並びは、種と何問目かからまぜる（全員同じ）。
//   - CPU は2.5〜10秒で答え、6割当てる。
// 2026-11-18 の44回目の案（本人が選んだ。分かれ目は Claude が決めた）:
//   - 問題の出し方: いっぺんに（最初）・1文字ずつ（鍵は drip）。1文字ずつでは、問題文が 0.18秒に1文字ずつ出て、読み終わる前でも押せる。
//     制限時間は、問題文が出きるまでの時間（字数 × 0.18秒）を15秒に足した長さ（limitOf）。速さ（ms）は今までどおり問題が出始めてから測る。
//     まだ出ていない字は見えない形で置いておき、行の折り返しが途中で変わらないようにした（.nz-rest）。
//     CPU は、問題文が半分ほど出るまでは答えない（いつもの 2.5〜10秒に、出きるまでの時間の半分を足す）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（まんなかの漢字と同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ答えの文字, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';
import { NAZO } from './nazo-data.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 5000;
const CHAR_MS = 180; // 「1文字ずつ」で1文字を出す間

const qKey = (s, q = s.q) => `nazo:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const fullOf = (s) => (s.rules.drip ? [...NAZO[s.qs[s.q].i][0]].length * CHAR_MS : 0); // 問題文が出きるまでの時間（いっぺんになら0）
const limitOf = (s) => LIMIT + fullOf(s);
// 4つの札（正しい答えと、その問題に書いたまちがいの3つ）。種と何問目かから並べるので全員同じ
export function choicesOf(seed, q, i) {
  const [, right, wrong] = NAZO[i];
  return shuffle([right, ...wrong], mulberry32((seed * 197 + q * 31 + 11) >>> 0));
}
const cpuPlan = new Map();

export default {
  id: 'nazo',
  name: 'なぞなぞ早押し',
  icon: '🤔',
  desc: 'なぞなぞの答えを4つから選ぶ。早く正解した人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
    { key: 'drip', label: '問題の出し方', desc: '1文字ずつ: 問題文が少しずつ出て、読み終わる前でも押せる', def: false, choices: [[false, 'いっぺんに'], [true, '1文字ずつ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, ...rules };
    const order = shuffle([...NAZO.keys()], mulberry32(seed)).slice(0, roundsOf(r));
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
    if (!x.opts.includes(m.c) || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === NAZO[x.i][1]) s.solved[m.p] = Math.round(m.ms);
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
      const right = NAZO[x.i][1];
      const wrong = x.opts.filter((c) => c !== right);
      plan = { at: 2500 + Math.random() * 7500 + fullOf(s) * 0.5, c: Math.random() < 0.6 ? right : wrong[Math.floor(Math.random() * wrong.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limitOf(s) ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
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
    root.className = 'board kj nz';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">なぞなぞの答えを4つから選ぼう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const [text, right, , why] = NAZO[x.i];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    const q = document.createElement('div');
    q.className = 'ox-q nz-q';
    if (!shown && s.rules.drip) {
      // 1文字ずつ（描き直しても、問題が出てからの時間で同じところから続く。まだの字は見えない形で置き、折り返しを変えない）
      const chars = [...text];
      const head = document.createElement('span');
      const rest = document.createElement('span');
      rest.className = 'nz-rest';
      q.append(head, rest);
      const tick = () => {
        if (!q.isConnected && q.dataset.on) return;
        q.dataset.on = '1';
        const t = since(key);
        const k = Math.min(chars.length, Math.floor(t / CHAR_MS) + 1);
        head.textContent = chars.slice(0, k).join('');
        rest.textContent = chars.slice(k).join('');
        if (k < chars.length) setTimeout(tick, CHAR_MS - (t % CHAR_MS));
      };
      tick();
    } else q.textContent = text;
    card.append(q);
    if (!shown) {
      since(key);
      if (s.solved.some((v) => v !== null)) card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが正解！ 5秒で締め切り</div>');
      card.append(timeBar(key, limitOf(s), { secs: true }));
    } else {
      const a = document.createElement('div');
      a.className = 'ox-ans';
      a.textContent = `答えは「${right}」　${why}`;
      card.append(a);
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(t);
    }
    if (document.activeElement?.classList?.contains('kj-choice')) document.activeElement.blur(); // 前の問題で押した札に残った focus を外す（難読漢字と同じ）
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < limitOf(s);
    const grid = document.createElement('div');
    grid.className = 'kj-choices nz-choices';
    const mine = me !== null ? s.said[me] : null;
    const btns = x.opts.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = c === right && (shown || mine === c);
      const ng = c === mine && c !== right;
      b.className = 'btn secondary kj-choice nz-choice' + (ok ? ' ok' : ng ? ' ng' : !can ? ' off' : '');
      b.textContent = c;
      b.disabled = !can;
      const hit = (e) => {
        if (!can || grid.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= limitOf(s)) return;
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
    else if (s.phase === 'open') note.textContent = '答えられるのは1回だけ';
    wrap.append(note);
    if (s.phase === 'shown') wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (can) {
      setTimeout(() => {
        if (!grid.isConnected || grid.dataset.sent) return;
        btns.forEach((y) => { y.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, limitOf(s) - since(key)));
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
      const [text, right] = NAZO[s.qs[q].i];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="ox-rv">${esc(text)} → <b>${esc(right)}</b></span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
