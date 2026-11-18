// 数のきまり当て。「2・4・8・16・？」のように並んだ数のきまりを見つけて、次の数を4つから早押しで選ぶ。2〜10人・足りない分は CPU（弱め）。
// 2026-11-18 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 4つから選ぶ（1問に1回だけ）。正解した速い順に 3点・2点・それ以降は1点。10問（詳細設定で15・20問）。（なぞなぞ早押しと同じ形）
//   - 問題はその場で作る。詳細設定「むずかしさ」: やさしい（同じ数ずつ増える・減る）・ふつう（かけ算で増える・増え方が増える。最初）・
//     むずかしい（前の2つをたす・2つのきまりが交互に来る）。答えのあとに「＋3ずつ」のようにきまりを見せる。
// Claude の判断:
//   - 見せる数は5つで、6つ目を当てる。きまりの種類は、そのむずかしさの中から同じ見込みで選ぶ。
//     むずかしいの「交互」は、1つおきに2つの数の並び（例: 2・20・4・18・6・？）と、＋k と ×2 をくり返す並びの2つ。
//   - まちがいの3つは、答えの近くの数（±1・±2・±いまの増え方）と、「最後の2つの差でそのまま進めた数」から選ぶ（0より小さい数は出さない）。
//   - 1問の制限時間は15秒。だれかが正解したら5秒で締め切る。全員が答えたら1.5秒。答えときまりを見せる間は3.5秒。
//   - CPU は3〜10秒で答え、6割当てる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（なぞなぞ早押しと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 選んだ数, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[10, '10問'], [15, '15問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LEVELS = [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']];
const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;
const SHOW = 5; // 見せる数の数

const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const signed = (d) => (d >= 0 ? `＋${d}` : `−${-d}`);

// きまりの種類ごとに、6つの数ときまりの説明を作る
const KINDS = {
  add(rnd) { // 同じ数ずつ増える・減る
    const d = int(rnd, 1, 9) * (rnd() < 0.3 ? -1 : 1);
    const a = d < 0 ? int(rnd, -d * 5, -d * 5 + 20) : int(rnd, 1, 20);
    return { nums: Array.from({ length: SHOW + 1 }, (_, k) => a + d * k), rule: `${signed(d)}ずつ` };
  },
  mul(rnd) { // かけ算で増える
    const r = rnd() < 0.7 ? 2 : 3;
    const a = r === 2 ? int(rnd, 1, 5) : int(rnd, 1, 2);
    return { nums: Array.from({ length: SHOW + 1 }, (_, k) => a * r ** k), rule: `×${r}ずつ` };
  },
  grow(rnd) { // 増え方が増える
    const a = int(rnd, 1, 10);
    const d0 = int(rnd, 1, 4);
    const dd = int(rnd, 1, 3);
    const nums = [a];
    for (let k = 0; k < SHOW; k++) nums.push(nums[k] + d0 + dd * k);
    const steps = [0, 1, 2].map((k) => `＋${d0 + dd * k}`).join('・');
    return { nums, rule: `増え方が ${dd} ずつ増える（${steps}…）` };
  },
  fib(rnd) { // 前の2つをたす
    const nums = [int(rnd, 1, 5), int(rnd, 1, 5)];
    while (nums.length < SHOW + 1) nums.push(nums.at(-1) + nums.at(-2));
    return { nums, rule: '前の2つをたした数' };
  },
  zigzag(rnd) { // 1つおきに2つの並び
    const a = int(rnd, 1, 9);
    const d = int(rnd, 1, 5);
    const e = int(rnd, 1, 4) * (rnd() < 0.5 ? -1 : 1);
    const b = int(rnd, 10, 30);
    const nums = [];
    for (let k = 0; nums.length < SHOW + 1; k++) nums.push(a + d * k, b + e * k);
    return { nums: nums.slice(0, SHOW + 1), rule: `1つおきに見ると ${signed(d)}ずつ と ${signed(e)}ずつ` };
  },
  mix(rnd) { // ＋k と ×2 をくり返す
    const k = int(rnd, 1, 4);
    const nums = [int(rnd, 1, 5)];
    for (let i = 0; nums.length < SHOW + 1; i++) nums.push(i % 2 ? nums.at(-1) * 2 : nums.at(-1) + k);
    return { nums, rule: `＋${k} と ×2 をくり返す` };
  },
};
const KINDS_OF = { easy: ['add'], normal: ['mul', 'grow'], hard: ['fib', 'zigzag', 'mix'] };

// 1問を作る（種・何問目か・むずかしさから決まるので全員同じ）
export function makeQuestion(seed, q, level) {
  const rnd = mulberry32((seed * 173 + q * 29 + 5) >>> 0);
  const kinds = KINDS_OF[level] ?? KINDS_OF.normal;
  const kind = kinds[Math.floor(rnd() * kinds.length)];
  const { nums, rule } = KINDS[kind](rnd);
  const shown = nums.slice(0, SHOW);
  const ans = nums[SHOW];
  const step = Math.abs(shown[SHOW - 1] - shown[SHOW - 2]) || 1;
  const naive = shown[SHOW - 1] * 2 - shown[SHOW - 2]; // 最後の2つの差でそのまま進めた数
  const near = shuffle([ans + 1, ans - 1, ans + 2, ans - 2, ans + step, ans - step], rnd);
  const wrong = [];
  for (const v of [naive, ...near]) if (v >= 0 && v !== ans && !wrong.includes(v) && wrong.length < 3) wrong.push(v);
  for (let v = ans + 3; wrong.length < 3; v++) if (!wrong.includes(v)) wrong.push(v); // 念のため（足りないことは無い）
  return { kind, shown, ans, rule, opts: shuffle([ans, ...wrong], rnd) };
}

const qKey = (s, q = s.q) => `suretsu:${s.seed}:${levelOf(s.rules)}:${q}`; // むずかしさも入れる（同じ種でむずかしさだけ変えたとき、CPU が前の問題の答えを押さないように）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'suretsu',
  name: '数のきまり当て',
  icon: '🔢',
  desc: '並んだ数のきまりを見つけて、次の数を4つから早く選ぶ',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: 'やさしい: 同じ数ずつ増える・減る／ふつう: かけ算・増え方が増える／むずかしい: 前の2つをたす・交互', def: 'normal', choices: LEVELS },
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
    s.said[m.p] = m.c;
    if (m.c === x.ans) s.solved[m.p] = Math.round(m.ms);
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
      const wrong = x.opts.filter((c) => c !== x.ans);
      plan = { at: 3000 + Math.random() * 7000, c: Math.random() < 0.6 ? x.ans : wrong[Math.floor(Math.random() * wrong.length)] };
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
    root.className = 'board kj sq';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">数のきまりを見つけて、「？」に入る数を選ぼう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    const row = document.createElement('div');
    row.className = 'sq-row';
    for (const v of x.shown) {
      const c = document.createElement('span');
      c.className = 'sq-n';
      c.textContent = v;
      row.append(c);
    }
    const last = document.createElement('span');
    last.className = 'sq-n q' + (shown ? ' ans' : '');
    last.textContent = shown ? x.ans : '？';
    row.append(last);
    card.append(row);
    if (!shown) {
      since(key);
      if (s.solved.some((v) => v !== null)) card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが正解！ 5秒で締め切り</div>');
      card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const a = document.createElement('div');
      a.className = 'ox-ans sq-rule';
      a.textContent = `きまり: ${x.rule}`;
      card.append(a);
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(t);
    }
    if (document.activeElement?.classList?.contains('kj-choice')) document.activeElement.blur(); // 前の問題で押した札に残った focus を外す（難読漢字と同じ）
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const grid = document.createElement('div');
    grid.className = 'kj-choices sq-choices';
    const mine = me !== null ? s.said[me] : null;
    const btns = x.opts.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = c === x.ans && (shown || mine === c);
      const ng = c === mine && c !== x.ans;
      b.className = 'btn secondary kj-choice sq-choice' + (ok ? ' ok' : ng ? ' ng' : !can ? ' off' : '');
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
    else if (s.phase === 'open') note.textContent = '答えられるのは1回だけ';
    wrap.append(note);
    if (s.phase === 'shown') wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
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
      const g = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      const sp = (t) => { const e = document.createElement('span'); e.textContent = t; return e; };
      const n = sp(String(q + 1)); n.className = 'mk-rv-n';
      const nums = sp(`${g.shown.join('・')}・${g.ans}`); nums.className = 'ox-rv';
      const rule = sp(g.rule); rule.className = 'mk-rv-ex';
      const who = sp(fast.length ? '⚡' + fast.join('・') : '―'); who.className = 'mk-rv-who';
      li.append(n, nums, rule, sp(mine), who);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
