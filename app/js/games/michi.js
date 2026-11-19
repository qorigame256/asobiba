// 道案内早押し。町の地図に「北へ2つ・東へ3つ」のような指示が出て、その通りに進んだ先の建物を早押しで押す。2〜10人・足りない分は CPU（弱め）。
// 2026-11-19 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 着いた先の建物を押す（1問に1回だけ）。速い順に 3・2・1点。10問（詳細設定で 5・20問）。
//   - 詳細設定「むずかしさ」: やさしい（指示2つ）・ふつう（指示3つ。最初）・むずかしい（「まっすぐ2つ・右へ曲がって1つ」のように、進んでいる向きから見た左右で出す）。
// Claude の判断:
//   - 地図は 6×6 のます目で、北が上（地図の角に「北↑」）。1つのますに建物を1つ置き、★ のますから歩き始める。指示1つで 1〜3 ます進む。
//   - 指示どうしはいつも直角に曲がる（同じ向きが続いたり、引き返したりしない）。地図の外へ出る道と、同じますを2回通る道（★ に戻るのも）は作らない。
//   - むずかしいは「北を向いて ★ に立っています」と最初の向きを出し、「まっすぐ」のあと2回曲がる（指示3つ）。
//   - 1問の制限時間は15秒。だれかが正解したら5秒で締め切る。全員が答えたら1.5秒。答えを見せる間は3.5秒で、通った道に印を付ける。
//   - CPU は2.5〜8.5秒で押し、6割当てる（まちがえるときは、着いた先のとなりのます）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数のきまり当てと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: ますの番号（左上から 0〜35）, ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 10);
const LEVELS = [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
export const N = 6;
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;

// 向き: 0 北・1 東・2 南・3 西（右回り）
export const DIRS = [[0, -1, '北'], [1, 0, '東'], [0, 1, '南'], [-1, 0, '西']];
const BLD = ['🏠', '🏫', '🏥', '🏪', '🏢', '🏦', '🏤', '⛩️', '🏯', '🌳', '⛲', '🏨', '🏭', '🗼', '⛪', '🏬', '🍜', '☕', '🌸', '🎡', '🚒', '🌲'];

// 1問を作る（種・何問目か・むずかしさから決まるので全員同じ）
export function makeQuestion(seed, q, level) {
  const rnd = mulberry32((seed * 197 + q * 31 + 11) >>> 0);
  const int = (n) => Math.floor(rnd() * n);
  const b = Array.from({ length: N * N }, () => BLD[int(BLD.length)]);
  const count = level === 'easy' ? 2 : 3;
  for (let t = 0; t < 500; t++) {
    const start = int(N * N);
    let x = start % N;
    let y = Math.floor(start / N);
    const facing = int(4);
    const steps = [];
    const path = [start];
    let ok = true;
    for (let i = 0; i < count && ok; i++) {
      const d = i === 0 ? (level === 'hard' ? facing : int(4)) : (steps[i - 1].d + (rnd() < 0.5 ? 1 : 3)) % 4;
      const n = 1 + int(3);
      for (let k = 0; k < n; k++) {
        x += DIRS[d][0];
        y += DIRS[d][1];
        if (x < 0 || y < 0 || x >= N || y >= N || path.includes(y * N + x)) { ok = false; break; } // 外へ出る・同じますを2回通る道は作らない
        path.push(y * N + x);
      }
      steps.push({ d, n });
    }
    const end = y * N + x;
    if (!ok || end === start) continue;
    return { b, start, facing, steps, path, end };
  }
  // まず起きない（6×6 なら道はいくらでもある）。念のため決まった道を返す
  return { b, start: 0, facing: 1, steps: [{ d: 1, n: 2 }, { d: 2, n: 2 }, { d: 1, n: 1 }].slice(0, count), path: [0, 1, 2, 8, 14, 15].slice(0, count === 2 ? 5 : 6), end: count === 2 ? 14 : 15 };
}

// 指示の文の一覧
export function stepTexts(x, level) {
  if (level !== 'hard') return x.steps.map((st) => `${DIRS[st.d][2]}へ${st.n}つ`);
  return x.steps.map((st, i) => {
    if (i === 0) return `まっすぐ${st.n}つ`;
    const turn = (st.d - x.steps[i - 1].d + 4) % 4 === 1 ? '右' : '左';
    return `${turn}へ曲がって${st.n}つ`;
  });
}

const qKey = (s, q = s.q) => `michi:${s.seed}:${levelOf(s.rules)}:${q}`; // むずかしさも入れる（同じ種でむずかしさだけ変えたとき、CPU が前の問題の答えを押さないように。数のきまり当てと同じ）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'michi',
  name: '道案内早押し',
  icon: '🧭',
  desc: '「北へ2つ・東へ3つ」の通りに地図を進んで、着いた建物を早押し',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: 'やさしい: 指示2つ／ふつう: 指示3つ／むずかしい: 「右へ曲がって」のように、進む向きから見た左右で出る', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, level: 'normal', ...rules };
    const qs = Array.from({ length: roundsOf(r) }, (_, q) => makeQuestion(seed, q, levelOf(r)));
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
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), LIMIT, AFTER_MS, GRACE_MS), move: { t: 'close' } };
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
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= N * N || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === s.qs[s.q].end) s.solved[m.p] = Math.round(m.ms);
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
      const ex = x.end % N;
      const ey = Math.floor(x.end / N);
      const near = DIRS.map(([dx, dy]) => [ex + dx, ey + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N).map(([a, b]) => b * N + a);
      plan = { at: 2500 + Math.random() * 6000, c: Math.random() < 0.6 ? x.end : near[Math.floor(Math.random() * near.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const level = levelOf(s.rules);
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj mch';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">★ から指示の通りに進んで、着いた建物を押そう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    if (level === 'hard') card.insertAdjacentHTML('beforeend', `<div class="kj-sub mch-face">🧍 ${DIRS[x.facing][2]}を向いて ★ に立っています</div>`);
    const steps = document.createElement('div');
    steps.className = 'mch-steps';
    stepTexts(x, level).forEach((t, i) => {
      if (i) steps.insertAdjacentHTML('beforeend', '<span class="mch-arrow">→</span>');
      const e = document.createElement('span');
      e.className = 'mch-step';
      e.textContent = t;
      steps.append(e);
    });
    card.append(steps);
    if (!shown) {
      since(key);
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`); // 行の場所はいつも空けておく（数のきまり当てと同じ）
      card.append(anySolved ? afterBar(key, LIMIT, AFTER_MS) : timeBar(key, LIMIT, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `着くのは ${x.b[x.end]}${fast ? `・いちばん速かったのは ${fast}` : '・だれも正解できませんでした'}`;
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const mine = me !== null ? s.said[me] : null;
    const map = document.createElement('div');
    map.className = 'mch-map';
    map.insertAdjacentHTML('beforeend', '<span class="mch-north" aria-hidden="true">北↑</span>');
    const onPath = new Set(shown ? x.path : []);
    const cells = x.b.map((bld, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const isStart = c === x.start;
      b.className = 'mch-cell' + (isStart ? ' start' : '') + (onPath.has(c) ? ' path' : '')
        + (c === x.end && (shown || mine === c) ? ' ans' : '') + (c === mine && c !== x.end ? ' ng' : '');
      b.textContent = isStart ? '★' : bld;
      b.disabled = !can;
      if (shown && onPath.has(c) && !isStart) b.dataset.n = String(x.path.indexOf(c));
      const hit = (e) => {
        if (!can || map.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        map.dataset.sent = '1';
        b.classList.add('picked');
        cells.forEach((y) => { y.disabled = true; });
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る
      b.onclick = (e) => { if (e.detail === 0) hit(e); };
      map.append(b);
      return b;
    });
    wrap.append(map);
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
        if (!map.isConnected || map.dataset.sent) return;
        cells.forEach((y) => { y.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
    }
  },

  review(s, me, o) {
    const level = levelOf(s.rules);
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const g = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(`${stepTexts(g, level).join('→')} → ${g.b[g.end]}`), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
