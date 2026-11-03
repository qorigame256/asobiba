// ○×クイズ。出された文が正しいか間違いかを、全員いっせいに ⭕ か ❌ で答える。2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 1問に1回だけ答えられる。正解した速い順に 3・2・1点。答えのあとに1行の短い説明を出す。
//   - 詳細設定「まちがえたら脱落」（なし（最初）・あり）: まちがえるか時間内に押さなかった人が脱落し、最後まで残った人の勝ち（点は今までどおり数える）。
//   - 問題の数は 5・10（最初）・20問。問題は Claude が書く雑学（oxquiz-data.js）。誤りに気づいたら本人が知らせる。
// Claude の判断:
//   - 1問の制限時間は10秒。全員が答えたら1.5秒で締め切る。結果と説明を見せる間は4秒。
//   - 正しい文とまちがいの文がかたよらないよう、まぜた問題の中から ○ と × を交互に近い形で選ぶ（種から作るので全員同じ）。
//   - 脱落ありでは、残っている全員がその問題をまちがえたら、だれも脱落しない（全員いなくなると決着がつかないため）。
//     残りが1人になったら（2人以上で始めたとき）その人の勝ちで終わる。問題が尽きたら、残った人の中で点の多い人の勝ち。
//     順位は、残った人（点の多い順）→ あとまで残った人 の順（result の place）。
//   - CPU は1.5〜6秒で答え、7割当てる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（色ちがい早押しと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: true(⭕) | false(❌), ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';
import { OXQUIZ } from './oxquiz-data.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 10000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;

const qKey = (s, q = s.q) => `oxquiz:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), said: s.said.slice(), out: s.out.slice() });
const alive = (s, p) => s.out[p] === null;
const doneOf = (s, p) => !alive(s, p) || s.said[p] !== null;
export const answerOf = (s, q = s.q) => OXQUIZ[s.qs[q]][1];

// 問題を選ぶ: ○ の文と × の文をそれぞれまぜ、交互に近い形で並べる（どちらが先かも種で決める）
export function pickQuestions(seed, k) {
  const rnd = mulberry32(seed);
  const yes = shuffle(OXQUIZ.map((x, i) => (x[1] ? i : -1)).filter((i) => i >= 0), rnd);
  const no = shuffle(OXQUIZ.map((x, i) => (x[1] ? -1 : i)).filter((i) => i >= 0), rnd);
  const out = [];
  let flip = rnd() < 0.5;
  while (out.length < k && (yes.length || no.length)) {
    const from = (flip && yes.length) || !no.length ? yes : no;
    out.push(from.shift());
    if (rnd() < 0.7) flip = !flip; // ときどき同じほうが続く（交互だと読まれるため）
  }
  return out;
}

// 結果（脱落ありの順位を含む）
function finish(s) {
  if (!s.rules.drop) return { winners: leaders(s.scores), scores: s.scores };
  const live = [...Array(s.n).keys()].filter((p) => alive(s, p));
  const top = live.length ? Math.max(...live.map((p) => s.scores[p])) : 0;
  const winners = live.filter((p) => s.scores[p] === top);
  // 強さ: 残った人は点で、脱落した人は脱落した問題が後ろほど上
  const power = (p) => (alive(s, p) ? 1e6 + s.scores[p] : s.out[p]);
  const place = [...Array(s.n).keys()].map((p) => 1 + [...Array(s.n).keys()].filter((x) => power(x) > power(p)).length);
  return { winners, scores: s.scores, place };
}

const cpuPlan = new Map();

export default {
  id: 'oxquiz',
  name: '○×クイズ',
  icon: '⭕',
  desc: '出された文は正しい？まちがい？ ⭕ か ❌ を早く押した人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
    { key: 'drop', label: 'まちがえたら脱落', desc: 'まちがえるか時間内に押さなかった人は脱落。最後まで残った人の勝ち', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, drop: false, ...rules };
    return {
      n, seed, rules: r, qs: pickQuestions(seed, roundsOf(r)), q: -1, phase: 'ready',
      solved: Array(n).fill(null), said: Array(n).fill(null), out: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || alive(s, p)); },
  result(s) { return s.phase === 'end' ? finish(s) : null; },
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
        const live = [...Array(s.n).keys()].filter((p) => alive(s, p)).length;
        if (s.q + 1 >= s.qs.length || (s.rules.drop && s.n >= 2 && live <= 1)) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
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
        let dropped = [];
        if (s.rules.drop) {
          const live = [...Array(s.n).keys()].filter((p) => alive(s, p));
          dropped = live.filter((p) => s.solved[p] === null);
          if (dropped.length === live.length) dropped = []; // 全員まちがえたら、だれも脱落しない
          for (const p of dropped) s.out[p] = s.q;
        }
        s.last = { pts, winners, dropped };
        s.log = [...s0.log, { solved: s.solved.slice(), said: s.said.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (typeof m.c !== 'boolean' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === answerOf(s)) s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 1500 + Math.random() * 4500, c: Math.random() < 0.7 ? answerOf(s) : !answerOf(s) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? finish(s).winners : [];
    const extra = (p) => {
      if (!alive(s, p) && !(s.phase === 'shown' && s.last?.dropped.includes(p))) return '<span class="pt-ng">脱落</span>';
      if (s.phase === 'open') return s.said[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return `<span class="pt-ng">${s.said[p] === null ? '―' : '×'}${s.last.dropped.includes(p) ? ' 脱落' : ''}</span>`;
    };
    root.innerHTML = '';
    root.className = 'board kj ox';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">正しければ ⭕、まちがいなら ❌・全${s.qs.length}問${s.rules.drop ? '・まちがえたら脱落' : ''}</div>`;
      return;
    }
    const [text, right, note0] = OXQUIZ[s.qs[s.q]];
    const key = qKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`);
    const q = document.createElement('div');
    q.className = 'ox-q';
    q.textContent = text;
    card.append(q);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const a = document.createElement('div');
      a.className = 'ox-ans';
      a.textContent = `正解は ${right ? '⭕' : '❌'}　${note0}`;
      card.append(a);
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      const drop = s.last.dropped.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = (fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした') + (drop ? ` ／ 脱落: ${drop}` : '');
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const pad = document.createElement('div');
    pad.className = 'ox-pad';
    const btns = [true, false].map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const mine = me !== null && s.said[me] === c;
      b.className = 'ox-btn ' + (c ? 'yes' : 'no') + (mine ? ' mine' : '') + (s.phase === 'shown' && c === right ? ' ans' : '');
      b.textContent = c ? '⭕' : '❌';
      b.setAttribute('aria-label', c ? '正しい' : 'まちがい');
      b.disabled = !can;
      const hit = (e) => {
        if (!can || pad.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        pad.dataset.sent = '1';
        btns.forEach((y) => { y.disabled = true; });
        b.classList.add('mine');
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したとき
      return b;
    });
    pad.append(...btns);
    wrap.append(pad);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (!alive(s, me) && !(s.phase === 'shown' && s.last?.dropped.includes(me))) note.textContent = '脱落しました。最後まで見守ろう';
    else if (s.phase === 'open' && s.said[me] !== null) note.textContent = 'ほかの人を待っています…';
    else if (s.phase === 'open') note.textContent = '答えられるのは1回だけ';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const [text, right] = OXQUIZ[s.qs[q]];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${right ? '⭕' : '❌'}</span><span class="ox-rv">${esc(text)}</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
