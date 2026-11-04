// ならべかえ言葉（アナグラム早解き）。ばらばらのひらがなを並べ替えて言葉にする。2〜10人・足りない分は CPU（弱め）。
// 2026-11-04 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - ばらばらの字の札を順に押して並べる（字を打ち込まない）。
//   - 点と進め方は難読漢字と同じ: 正解した速い順に 3点・2点・それ以降は1点。パスあり。10問・15問・20問（最初は10問）。
//   - お題の種類（「たべもの」など）を添える。3字から始めて後半ほど長くする。言葉は Claude が書く（narabe-data.js）。
//   - 並べ方の答えが2つ以上ある言葉は入れない。
// Claude の判断:
//   - 1問の制限時間は30秒。だれかが正解したら6秒で締め切る。全員が正解かパスなら1.5秒。
//   - はじめの3割は3字、次の4割は4字、残りは5〜6字の言葉から出す（同じ対局で同じ言葉は出さない）。字の並べ方は種から決め、答えと同じ並びにはしない（全員同じ）。
//   - 全部の札を並べた時点で、その端末で答え合わせをする。ちがっていたら知らせるだけで、何度でも並べ直せる（送るのは正解のときだけ）。
//     並べた札を押すと、その札が下に戻る。「ぜんぶ戻す」もある。
//   - CPU は字の数に合わせて 4〜14秒ほどで答え、3字は7割5分・4字は6割・5〜6字は4割5分当てる。当てられない問題は15〜25秒でパスする。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（まんなかの漢字と同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ok', q, w: 並べた言葉, ms } / { p, t: 'pass', q }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';
import { NARABE } from './narabe-data.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 30000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 6000;

const qKey = (s, q = s.q) => `narabe:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
const lenOf = (w) => [...w].length;

// 出す言葉の順（はじめは3字・まんなかは4字・後半は5〜6字）
export function pickWords(seed, count) {
  const rnd = mulberry32(seed);
  const pools = [3, 4, 5].map((n) => shuffle([...NARABE.keys()].filter((i) => (n === 5 ? lenOf(NARABE[i][0]) >= 5 : lenOf(NARABE[i][0]) === n)), rnd));
  const out = [];
  for (let q = 0; q < count; q++) {
    const f = q / count;
    const b = f < 0.3 ? 0 : f < 0.7 ? 1 : 2;
    const pool = pools[b].length ? pools[b] : pools.find((x) => x.length);
    out.push(pool.shift());
  }
  return out;
}
// ばらばらにした字の並び（答えと同じ並びにはしない）
export function scramble(seed, q, word) {
  const chars = [...word];
  const rnd = mulberry32((seed * 197 + q * 31 + 5) >>> 0);
  for (let i = 0; i < 20; i++) {
    const t = shuffle(chars.slice(), rnd);
    if (t.join('') !== word) return t;
  }
  return [...chars.slice(1), chars[0]];
}
const cpuPlan = new Map();
let loc = null; // この端末で並べかけの札 { key, picked: [札の番号…] }

export default {
  id: 'narabe',
  name: 'ならべかえ言葉',
  icon: '🔀',
  desc: 'ばらばらのひらがなを並べ替えて、お題の言葉を早く作る',
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
    const qs = pickWords(seed, roundsOf(r)).map((i, q) => ({ i, tiles: scramble(seed, q, NARABE[i][0]) }));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null;
    return m.t === 'ok' ? 'correct' : null;
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
        s.passed = Array(s.n).fill(false);
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
    if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (m.t === 'pass') { const s = clone(s0); s.step += 1; s.passed[m.p] = true; return s; }
    if (m.t !== 'ok' || m.w !== NARABE[s0.qs[s0.q].i][0] || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const word = NARABE[s.qs[s.q].i][0];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const n = lenOf(word);
      const rate = n <= 3 ? 0.75 : n === 4 ? 0.6 : 0.45;
      plan = Math.random() < rate ? { at: 1000 + n * 1500 + Math.random() * 6000, ok: true } : { at: 15000 + Math.random() * 10000, ok: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (t < plan.at || t >= LIMIT) return null;
    return plan.ok ? { t: 'ok', q: s.q, w: word, ms: Math.round(t) } : { t: 'pass', q: s.q };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">✔</span>' : s.passed[p] ? '<span class="pt-ng">パス</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj nb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">ばらばらの字を押して並べ、お題の言葉を作ろう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const [word, kind] = NARABE[x.i];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="nb-kind">お題: <b>${esc(kind)}</b>（${lenOf(word)}字）</div>`);
    if (loc?.key !== key) loc = { key, picked: [] };
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const solvedMe = me !== null && s.solved[me] !== null;
    // 並べた札の列
    const row = document.createElement('div');
    row.className = 'nb-row';
    const pool = document.createElement('div');
    pool.className = 'nb-pool';
    const note = document.createElement('p');
    note.className = 'cc-log';
    card.append(row);
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが正解！ 6秒で締め切り</div>');
      card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `答え: ${word}${fast ? ` ／ いちばん速かったのは ${fast}` : ' ／ だれも正解できませんでした'}`;
      card.append(t);
    }
    const draw = () => {
      row.innerHTML = '';
      pool.innerHTML = '';
      const chars = shown || solvedMe ? [...word] : loc.picked.map((i) => x.tiles[i]); // 正解したあとは答えの並びで見せる
      for (let k = 0; k < x.tiles.length; k++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'nb-tile' + (k < chars.length ? ' on' : ' empty') + (shown || solvedMe ? ' ans' : '');
        b.textContent = chars[k] ?? '';
        b.disabled = !can || k >= loc.picked.length;
        b.onpointerdown = (e) => { if (!can || k >= loc.picked.length) return; e.preventDefault(); loc.picked.splice(k, 1); draw(); };
        b.onclick = (e) => { if (e.detail === 0 && can && k < loc.picked.length) { loc.picked.splice(k, 1); draw(); } };
        row.append(b);
      }
      x.tiles.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        const used = shown || solvedMe || loc.picked.includes(i);
        b.className = 'nb-tile' + (used ? ' used' : '');
        b.textContent = c;
        b.disabled = !can || used;
        const hit = (e) => {
          if (!can || loc.picked.includes(i)) return;
          e.preventDefault();
          loc.picked.push(i);
          if (loc.picked.length === x.tiles.length) {
            const w = loc.picked.map((j) => x.tiles[j]).join('');
            const ms = Math.round(since(key));
            if (w === word && ms < LIMIT) { o.onMove({ t: 'ok', q: s.q, w, ms }); return; }
            row.classList.remove('shake');
            void row.offsetWidth; // 揺らす動きを最初からやり直す
            row.classList.add('shake');
          }
          draw();
        };
        b.onpointerdown = hit;
        b.onclick = (e) => { if (e.detail === 0) hit(e); };
        pool.append(b);
      });
      const full = loc.picked.length === x.tiles.length;
      if (me === null) note.textContent = '観戦中';
      else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
      else if (s.phase === 'open' && s.passed[me]) note.textContent = 'パスしました。次の問題を待とう';
      else if (s.phase === 'open' && full) note.textContent = '❌ ちがうみたい… 上の札を押すと下に戻せます';
      else if (s.phase === 'open') note.textContent = '下の字を、言葉になる順に押そう';
      else note.textContent = '';
    };
    draw();
    if (!shown) wrap.append(pool);
    if (can) {
      const act = document.createElement('div');
      act.className = 'cc-actions';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn secondary';
      back.textContent = 'ぜんぶ戻す';
      back.onclick = () => { loc.picked = []; draw(); };
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn secondary';
      pass.textContent = 'パス';
      pass.onclick = () => o.onMove({ t: 'pass', q: s.q });
      act.append(back, pass);
      wrap.append(act);
      setTimeout(() => {
        if (!pool.isConnected) return;
        pool.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
    }
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
      const [word, kind] = NARABE[s.qs[q].i];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(s.qs[q].tiles.join(''))} → ${esc(word)}</span><span class="mk-rv-ex">${esc(kind)}</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
