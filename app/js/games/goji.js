// まちがい字さがし。文の中に1つだけある、まちがった字を早く押す。2〜10人・足りない分は CPU（弱め）。
// 2026-11-18 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 正解した速い順に 3点・2点・1点。まちがえたらその問題はもう押せないが、点は減らない（色ちがい早押しと同じ形）。
//   - 10問（詳細設定で 5・20問）。
//   - 問題の文は、正しい字も含めて Claude が1問ずつ書く（goji-data.js。120問ほど）。後半の問題ほど文を長くする。
// Claude の判断:
//   - 出す問題は種でまぜて選び、選んだ中で文の短い順に並べる（後半ほど長い）。
//   - 文の字はどれも押せる（ひらがなや「、」も押せる。押せない字があると、まちがいの場所の見当がつくため）。
//   - 1問の制限時間は20秒。だれかが正解したら5秒で締め切る（まんなかの漢字と同じ）。全員が答えたら1.5秒。答えを見せる間は3.5秒。
//   - CPU は3〜11秒で押し、6割5分当てる（外すときは、まちがいの字ではない漢字を押す）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（まんなかの漢字と同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, i: 押した字の位置（0から）, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';
import { GOJI } from './goji-data.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 20000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;

// '駅で電車を{待:持}つ。' → { shown: 画面に出す文（字の配列）, right: 正しい文（字の配列）, pos: まちがいの位置, ok: 正しい字, ng: まちがいの字 }
export function parseGoji(src) {
  const m = src.match(/^(.*)\{(.):(.)\}(.*)$/u);
  if (!m) return null;
  const head = [...m[1]];
  const tail = [...m[4]];
  return { shown: [...head, m[3], ...tail], right: [...head, m[2], ...tail], pos: head.length, ok: m[2], ng: m[3] };
}
const PARSED = GOJI.map(parseGoji);
const isKanji = (c) => /\p{Script=Han}/u.test(c);

// 出す問題: 種でまぜて k 問選び、文の短い順に並べる（同じ長さはまぜた順）
export function pickGoji(seed, k) {
  const picked = shuffle([...GOJI.keys()], mulberry32(seed)).slice(0, k);
  return picked.map((i, j) => [i, j]).sort((a, b) => PARSED[a[0]].shown.length - PARSED[b[0]].shown.length || a[1] - b[1]).map(([i]) => i);
}

const qKey = (s, q = s.q) => `goji:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'goji',
  name: 'まちがい字さがし',
  icon: '🔍',
  desc: '文の中に1つだけある、まちがった字を早く見つけて押す',
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
    return {
      n, seed, rules: r, qs: pickGoji(seed, roundsOf(r)), q: -1, phase: 'ready',
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
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), LIMIT, AFTER_MS, GRACE_MS), move: { t: 'close' } }; // 1問の残りより長く待たない（一筆書きと同じ）
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
    const x = PARSED[s0.qs[s0.q]];
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= x.shown.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.i;
    if (m.i === x.pos) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = PARSED[s.qs[s.q]];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const others = x.shown.map((c, i) => (i !== x.pos && isKanji(c) ? i : -1)).filter((i) => i >= 0);
      const ok = Math.random() < 0.65 || !others.length;
      plan = { at: 3000 + Math.random() * 8000, i: ok ? x.pos : others[Math.floor(Math.random() * others.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, i: plan.i, ms: Math.round(t) } : null;
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
    root.className = 'board kj gj';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true, log: s.log }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">文の中のまちがった字を1つ見つけて押そう・全${s.qs.length}問</div>`;
      return;
    }
    const x = PARSED[s.qs[s.q]];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const mine = me !== null ? s.said[me] : null;
    const line = document.createElement('div');
    line.className = 'gj-line';
    const btns = x.shown.map((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ans = shown && i === x.pos;
      const ok = i === x.pos && (shown || mine === i);
      const ng = i === mine && i !== x.pos;
      b.className = 'gj-ch' + (/[、。「」・]/.test(c) ? ' pn' : '') + (ok ? ' ok' : '') + (ng ? ' ng' : ''); // pn = 句読点（細い札にして、「。」だけが次の行にこぼれにくくする）
      b.textContent = c;
      if (ans) b.dataset.fix = x.ok; // 答えを見せるとき、正しい字を上に出す（style.css の ::before）
      b.disabled = !can;
      const hit = (e) => {
        if (!can || line.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        line.dataset.sent = '1';
        btns.forEach((y) => { y.disabled = true; });
        b.classList.add('picked');
        o.onMove({ t: 'ans', q: s.q, i, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したとき
      return b;
    });
    line.append(...btns);
    card.append(line);
    if (!shown) {
      since(key);
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`); // 行の場所はいつも空けておく（出たときに下の札がずれて押しまちがえないように。2026-11-18 の Codex の点検）
      card.append(anySolved ? afterBar(key, LIMIT, AFTER_MS) : timeBar(key, LIMIT, { secs: true }));
    } else {
      const a = document.createElement('div');
      a.className = 'ox-ans';
      a.textContent = `「${x.ng}」ではなく「${x.ok}」　${x.right.join('')}`;
      card.append(a);
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも見つけられませんでした';
      card.append(t);
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = 'まちがった字を押してください（押せるのは1回だけ）';
    wrap.append(note);
    if (s.phase === 'shown') wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (can) {
      setTimeout(() => {
        if (!line.isConnected || line.dataset.sent) return;
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
      const g = PARSED[s.qs[q]];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(g.ng)}→${esc(g.ok)}</span><span class="ox-rv">${esc(g.right.join(''))}</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
