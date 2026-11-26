// 水はかり。決まった大きさの入れ物だけを使って、言われた量の水をちょうど作る。2〜10人・足りない分は CPU（弱め）。
// 2026-11-18 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 名前は「水はかり」（「早解き」は付けない）。作れた人のうち、手数（操作の回数）の少ない順に 3点・2点・それ以降は1点。手数が同じなら早く作れた人が上。
//     1問60秒で5問（てんびん当てと同じ形）。
//   - できることは「水を入れる（いっぱいまで）・捨てる（全部）・別の入れ物へ移す（相手がいっぱいになるか、こちらが空になるまで）」の3つ。
//   - 詳細設定「むずかしさ」で入れ物の数を選ぶ: やさしい・ふつう（最初）は2つ、むずかしいは3つ。問題はその場で作り、どれも必ず作れることを確かめる。
//     答えのあとに「最少◯手」を見せる。
// Claude の判断:
//   - やさしいとふつうの違いは、いちばん少ない手数: やさしい 2〜4手・ふつう 5〜8手。むずかしい（3つ）は 4〜8手。
//   - 作る量は、どの入れ物の大きさとも違う量にする（入れるだけで終わらないように）。どれか1つの入れ物にちょうどその量が入ったら完成。
//   - 手数は、完成までに押した操作をすべて数える（やり直しのボタンは置かない。むだな操作も1手）。
//   - 操作は自分の画面だけで進め、完成したときに操作の一覧をまとめて送る（apply が一覧を最初から当て直して、本当に完成しているか確かめる）。
//   - ほかの人には、完成したかどうかと手数だけを見せる（途中の水の量は見せない）。全員が完成したら1.5秒で締め切る。
//   - CPU は12〜40秒で完成させ、2割は時間内に作れない。手数はいちばん少ない手数に 0・2・4 手のむだを足す。
// 2026-11-18 の44回目の案（本人が選んだ。分かれ目は Claude が決めた）:
//   - 問題の数: 3・5（最初）・8問（鍵は rounds）。
//   - 順位の決め方: 手数（最初）・早さ（鍵は race）。早さでは、作れた人のうち早く作れた順に 3点・2点・それ以降は1点（手数は見せるが順位に使わない）。
//     ほかの作り（1問60秒・全員が作れたら締め切り・むだな手も数える）は手数のときと同じ。
// 2026-11-26 の UI・UX の13回目（本人が全部採用）: 答えを見せる間に、いちばん少ない手順を1手ずつ注いで見せる（前は最後の形だけ。作りは render の「答えを見せる間」のコメント）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, ops: ['f0' | 'e1' | 'p01' …], ms }
//   f = 入れる・e = 捨てる・p = 移す（p01 は 0 番から 1 番へ）。数字は入れ物の番号（左から 0）

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, replaySteps } from './party.js';
import { pointsOf } from './make10.js';

const LEVELS = [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']];
const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
const ROUNDS = [[3, '3問'], [5, '5問'], [8, '8問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 5);
const LIMIT = 60000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const MOVE_W = 1e6; // 速さの比べ方: 手数 × 1e6 + ms（ms は LIMIT より小さいので、手数が先に効く）。順位の決め方が「早さ」なら ms だけ

const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

// 1手を当てる。できない操作（いっぱいの入れ物に入れる・空を捨てる・移せない）は null
export function stepOf(caps, a, op) {
  if (typeof op !== 'string') return null;
  const m = op.match(/^(f|e)(\d)$|^p(\d)(\d)$/);
  if (!m) return null;
  const b = a.slice();
  if (m[1]) {
    const i = +m[2];
    if (i >= caps.length) return null;
    if (m[1] === 'f') { if (b[i] === caps[i]) return null; b[i] = caps[i]; }
    else { if (b[i] === 0) return null; b[i] = 0; }
    return b;
  }
  const i = +m[3];
  const j = +m[4];
  if (i === j || i >= caps.length || j >= caps.length || b[i] === 0 || b[j] === caps[j]) return null;
  const v = Math.min(b[i], caps[j] - b[j]);
  b[i] -= v;
  b[j] += v;
  return b;
}
const opsOf = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push('f' + i, 'e' + i);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) out.push(`p${i}${j}`);
  return out;
};
// いちばん少ない手数と、その手順（全部空から始める）。作れなければ null
export function solveMizu(caps, goal) {
  const start = caps.map(() => 0);
  const seen = new Map([[start.join(','), null]]);
  let line = [start];
  const all = opsOf(caps.length);
  for (let d = 0; line.length; d++) {
    const next = [];
    for (const a of line) {
      if (a.includes(goal)) {
        const path = [];
        for (let k = a.join(','); seen.get(k); k = seen.get(k).from) path.unshift(seen.get(k).op);
        return { min: d, path };
      }
      for (const op of all) {
        const b = stepOf(caps, a, op);
        if (!b) continue;
        const k = b.join(',');
        if (seen.has(k)) continue;
        seen.set(k, { from: a.join(','), op });
        next.push(b);
      }
    }
    line = next;
  }
  return null;
}
const RANGE = { easy: [2, 4], normal: [5, 8], hard: [4, 8] };
// 1問を作る（種・何問目か・むずかしさから決まるので全員同じ）
export function makeMizu(seed, q, level) {
  const rnd = mulberry32((seed * 211 + q * 37 + 3) >>> 0);
  const [lo, hi] = RANGE[level] ?? RANGE.normal;
  for (let tries = 0; ; tries++) {
    let caps;
    if (level === 'hard') {
      const a = int(rnd, 2, 6);
      const b = int(rnd, a + 1, 9);
      caps = [a, b, int(rnd, b + 1, 13)];
    } else {
      const a = int(rnd, 2, 7);
      caps = [a, int(rnd, a + 1, 11)];
    }
    const goal = int(rnd, 1, Math.max(...caps) - 1);
    if (caps.includes(goal)) continue;
    const sol = solveMizu(caps, goal);
    if (!sol) continue;
    if ((sol.min >= lo && sol.min <= hi) || (tries > 400 && sol.min >= 2)) return { caps, goal, min: sol.min, path: sol.path };
  }
}
// 操作の一覧を最初から当てて、完成しているか（途中にできない操作があれば false）
export function checkOps(x, ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 200) return false;
  let a = x.caps.map(() => 0);
  for (const op of ops) {
    a = stepOf(x.caps, a, op);
    if (!a) return false;
  }
  return a.includes(x.goal);
}

const qKey = (s, q = s.q) => `mizu:${s.seed}:${levelOf(s.rules)}:${q}`; // むずかしさも入れる（同じ種でむずかしさだけ変えたとき、CPU が前の問題の手順を送らないように）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), moves: s.moves.slice() });
const doneOf = (s, p) => s.solved[p] !== null;
const cpuPlan = new Map();
const local = new Map(); // 自分の画面の水の量と操作（qKey + 席 → { a, ops, sel }）。送らない

export default {
  id: 'mizu',
  name: '水はかり',
  icon: '🥛',
  desc: '決まった大きさの入れ物だけで、言われた量の水をちょうど作る。少ない手数ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: 'やさしい: 入れ物2つで短い手順／ふつう: 入れ物2つで長めの手順／むずかしい: 入れ物3つ', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 5, choices: ROUNDS },
    { key: 'race', label: '順位の決め方', desc: '手数: 少ない手数で作れた人が上／早さ: 早く作れた人が上', def: false, choices: [[false, '手数'], [true, '早さ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', ...rules };
    const qs = Array.from({ length: roundsOf(r) }, (_, q) => makeMizu(seed, q, levelOf(r)));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), moves: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    return m.p === me ? 'correct' : null;
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
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
        s.moves = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const got = s.solved.filter((v) => v !== null);
        const best = got.length ? Math.min(...got) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { moves: s.moves.slice(), solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'done' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300 || !checkOps(s0.qs[s0.q], m.ops)) return null;
    const s = clone(s0);
    s.step += 1;
    s.moves[m.p] = m.ops.length;
    s.solved[m.p] = (s0.rules.race ? 0 : m.ops.length * MOVE_W) + Math.min(Math.round(m.ms), LIMIT);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const waste = [0, 2, 4][Math.floor(Math.random() * 3)];
      const pre = [];
      for (let k = 0; k < waste; k += 2) { const i = Math.floor(Math.random() * x.caps.length); pre.push('f' + i, 'e' + i); }
      plan = { at: Math.random() < 0.8 ? 12000 + Math.random() * 28000 : Infinity, ops: [...pre, ...x.path] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'done', q: s.q, ops: plan.ops, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? `<span class="pt-ok">✔ ${s.moves[p]}手</span>` : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (doneOf(s, p)) return `<span class="pt-ok">${s.moves[p]}手 ${secText(s.solved[p] % MOVE_W)} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj wq';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">入れる・捨てる・移すだけで、言われた量をちょうど作ろう。${s.rules.race ? '早く作れた人ほど' : '少ない手数ほど'}高い点・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    const lk = key + ':' + me;
    if (me !== null && !local.has(lk)) {
      local.set(lk, { a: x.caps.map(() => 0), ops: [], sel: null });
      if (local.size > 40) local.delete(local.keys().next().value);
    }
    const st = me !== null ? local.get(lk) : null;
    const mineDone = me !== null && doneOf(s, me);
    const can = s.phase === 'open' && me !== null && o.canMove && !mineDone && since(key) < LIMIT;
    const goal = document.createElement('div');
    goal.className = 'wq-goal';
    goal.innerHTML = `<b>${x.goal}L</b> を作ろう`;
    card.append(goal);
    if (!shown) {
      since(key);
      card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const a = document.createElement('div');
      a.className = 'ox-ans';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      a.textContent = `最少 ${x.min}手　${fast ? `いちばんは ${fast}` : 'だれも作れませんでした'}`;
      card.append(a);
    }
    // 入れ物（自分の画面の量。観戦の人は空のまま、締め切りのあとは全員に、いちばん少ない手順を空の形から1手ずつ見せる（2026-11-26 の UI・UX の13回目））
    const states = [x.caps.map(() => 0)];
    for (const op of x.path) states.push(stepOf(x.caps, states.at(-1), op) ?? states.at(-1));
    let fixed = states[0];
    const amountsNow = () => (st && !shown ? st.a : fixed);
    const big = Math.max(...x.caps);
    const row = document.createElement('div');
    row.className = 'wq-row';
    const send = () => {
      o.onMove({ t: 'done', q: s.q, ops: st.ops.slice(), ms: Math.round(since(key)) });
    };
    const act = (op) => {
      if (!can || !st || st.a.includes(x.goal)) return;
      const b = stepOf(x.caps, st.a, op);
      st.sel = null;
      if (!b) { draw(); return; }
      st.a = b;
      st.ops.push(op);
      draw();
      if (b.includes(x.goal)) send();
    };
    const draw = () => {
      row.innerHTML = '';
      const amounts = amountsNow();
      x.caps.forEach((cap, i) => {
        const col = document.createElement('div');
        col.className = 'wq-col';
        const jar = document.createElement('button');
        jar.type = 'button';
        const pick = st && st.sel !== null && st.sel !== i;
        jar.className = 'wq-jar' + (amounts[i] === x.goal ? ' hit' : '') + (pick ? ' pick' : '') + (st && st.sel === i ? ' from' : '');
        jar.style.height = `${Math.round(60 + 120 * (cap / big))}px`;
        // 入れ物を押して、別の入れ物を押しても移せる（2026-11-22 本人の依頼）。1つ目に押した入れ物が「移す元」（もう一度押すとやめる）。
        // 移せない組（元が空・先がいっぱい）は act の stepOf が null を返し、手数に数えずに選びを解く（「➡️ 移す」ボタンと同じ）
        const canFrom = st && amounts[i] > 0;
        jar.disabled = !can || !(pick || canFrom || st.sel === i);
        jar.setAttribute('aria-label', `${cap}Lの入れ物（いま${amounts[i]}L）`);
        jar.innerHTML = `<span class="wq-water" style="height:${(amounts[i] / cap) * 100}%"></span><span class="wq-amt">${amounts[i]}L</span>`;
        jar.onclick = () => {
          if (!can || !st) return;
          if (pick) { act(`p${st.sel}${i}`); return; }
          if (st.sel === i) { st.sel = null; draw(); return; }
          if (canFrom) { st.sel = i; draw(); }
        };
        const cap0 = document.createElement('div');
        cap0.className = 'wq-cap';
        cap0.textContent = `${cap}L`;
        const btns = document.createElement('div');
        btns.className = 'wq-btns';
        const mk = (label, op, ok) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn secondary wq-btn';
          b.textContent = label;
          b.disabled = !can || !ok;
          b.onclick = op;
          return b;
        };
        const a = amounts;
        const canPour = a[i] > 0 && x.caps.some((c, j) => j !== i && a[j] < c);
        btns.append(
          mk('💧 入れる', () => act('f' + i), a[i] < cap),
          mk('🗑️ 捨てる', () => act('e' + i), a[i] > 0),
          mk(st && st.sel === i ? '✖ やめる' : '➡️ 移す', () => {
            if (st.sel === i) { st.sel = null; draw(); return; }
            if (x.caps.length === 2) { act(`p${i}${1 - i}`); return; }
            st.sel = i;
            draw();
          }, canPour),
        );
        col.append(jar, cap0, btns);
        row.append(col);
      });
      count.textContent = st ? `${st.ops.length}手` : '';
      if (st && st.sel !== null) count.textContent += '　移す先の入れ物を押してください';
    };
    const count = document.createElement('div');
    count.className = 'wq-count';
    card.append(row, count);
    draw();
    // 答えを見せる間: いちばん少ない手順を、空の入れ物から1手ずつ動きで見せる（2026-11-26 の UI・UX の13回目。本人が全部採用。puzzle-games.md）。
    // 0.3秒おいて1手0.55秒（全体で3秒まで。party.js の replaySteps）。入れる・捨てる入れ物と移す元は朱、移す先は黄の枠。下の行に「3手目: 3L を捨てる」
    if (shown) {
      const opText = (op) => (op[0] === 'f' ? `${x.caps[op[1]]}L に入れる` : op[0] === 'e' ? `${x.caps[op[1]]}L を捨てる` : `${x.caps[op[1]]}L から ${x.caps[op[2]]}L へ移す`);
      replaySteps(key + ':path', row, x.path.length, Math.min(3000, x.path.length * 550), (k) => {
        fixed = states[k];
        const op = x.path[k - 1] ?? '';
        [...row.children].forEach((col, i) => {
          const jar = col.querySelector('.wq-jar');
          const w = jar?.querySelector('.wq-water'), amt = jar?.querySelector('.wq-amt');
          if (!w || !amt) return;
          w.style.height = `${(fixed[i] / x.caps[i]) * 100}%`;
          amt.textContent = `${fixed[i]}L`;
          jar.classList.toggle('hit', k === x.path.length && fixed[i] === x.goal);
          jar.classList.toggle('from', k < x.path.length && op !== '' && Number(op[1]) === i);
          jar.classList.toggle('pick', k < x.path.length && op[0] === 'p' && Number(op[2]) === i);
        });
        count.textContent = (k ? `${k}手目: ${opText(op)}` : `最少 ${x.min}手の作り方`) + (k === x.path.length ? '　できた！' : '');
      });
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && mineDone) note.textContent = `⭕ できた！（${s.moves[me]}手・${secText(s.solved[me] % MOVE_W)}）ほかの人を待っています…`;
    else if (s.phase === 'open' && st && st.a.includes(x.goal)) note.textContent = '⭕ できた！ 送っています…';
    else if (s.phase === 'open') note.textContent = '入れる・捨てる・移すで、どれかの入れ物にちょうどの量を作ろう';
    wrap.append(note);
    if (can) {
      setTimeout(() => {
        if (!row.isConnected) return;
        row.querySelectorAll('button').forEach((y) => { y.disabled = true; });
        if (!(st && st.a.includes(x.goal))) note.textContent = '時間切れ！';
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
      const mine = me === null ? '' : x.moves[me] !== null ? `⭕ ${x.moves[me]}手` : '―';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="ox-rv">${esc(g.caps.map((c) => c + 'L').join('・'))} で ${g.goal}L（最少${g.min}手）</span><span>${mine}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
