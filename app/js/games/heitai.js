// 兵の振り分け。各自 100人の兵を5つの戦場に同時に配り、一斉に見せる。戦場ごとに一番多く置いた人がその戦場の点を取る。2〜6人・足りない分は CPU。
// 2026-11-11 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認。extra-games.md の「兵の振り分け」）:
//   - 戦場の点は 1〜5点で、回ごとにくじで変わり、配る前に見える。
//   - 5回の合計点で勝負し、前の回にみんながどう配ったかが見える。
//   - 一番多い人が並んだ戦場は、だれも取らない。
// Claude の判断:
//   - 1回60秒。時間内に決めなかった人は、5つの戦場に20人ずつ配ったことにする（0点にすると、遅れた人がその回まるごと置いていかれるため）。
//   - 配り方を作る間は何度でも直せて、ちょうど100人配ったときだけ「これで決める」を押せる（決めたら変えられない）。決めた配り方は全員の端末が知っている
//     （手札と同じ簡易の隠し方）。画面には「✔ 決めた」だけを出す。
//   - 全員が決めたら0.8秒で見せる。見せる間は7秒（だれがどこに何人置いたかを読む時間）。
//   - 戦場の点は対局の種から作る（全員の端末で同じ）。5つとも同じ点になる回は作り直す（どこに置いても同じになり、読み合いが無くなるため）。
//   - 同じ合計点の人は同じ順位。
//   - CPU は、点の高い戦場を多めに選んで3〜4か所に寄せ、残りは捨てる。3割は適当に配って弱める。読み合い（ほかの人のくせを読む）はしない。3〜12秒で決める。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'pick', r: 何回目（0 から）, a: [5つの戦場の人数] }
//   r が今の回と同じで、その人がまだ決めていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { since, scoreChips, leaders, winnersText, timeBar } from './party.js';
import { mulberry32 } from './util.js';

export const FIELDS = 5;
export const TROOPS = 100;
const ROUNDS = 5;
const LIMIT = 60000;
const READY_MS = 3000;
const SHOWN_MS = 7000;
const GRACE_MS = 800;
const EVEN = Array(FIELDS).fill(TROOPS / FIELDS);
const FIELD_NAMES = ['北の丘', '西の森', '中央の砦', '東の川', '南の港'];

// 回ごとの戦場の点（1〜5点）。種から作り、5つとも同じ点の回は作り直す
export function valuesOf(seed, r) {
  const rng = mulberry32((seed ^ Math.imul(r + 1, 0x9e3779b1)) >>> 0);
  for (;;) {
    const v = [...Array(FIELDS)].map(() => 1 + Math.floor(rng() * 5));
    if (new Set(v).size > 1) return v;
  }
}

export const okAlloc = (a) => Array.isArray(a) && a.length === FIELDS && a.every((x) => Number.isInteger(x) && x >= 0 && x <= TROOPS)
  && a.reduce((x, y) => x + y, 0) === TROOPS;

// 1回ぶんの結果: 戦場ごとに取った人（並んだら・だれも置かなければ null）と、席ごとの点
export function scoreRound(allocs, values) {
  const owner = values.map((_, f) => {
    const top = Math.max(...allocs.map((a) => a[f]));
    if (top <= 0) return null;
    const who = allocs.map((a, p) => (a[f] === top ? p : -1)).filter((p) => p >= 0);
    return who.length === 1 ? who[0] : null;
  });
  const pts = allocs.map((_, p) => owner.reduce((t, o, f) => t + (o === p ? values[f] : 0), 0));
  return { owner, pts };
}

const rKey = (s, r = s.r) => `heitai:${s.seed}:${r}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice() });
const cpuPlan = new Map();
const drafts = new Map(); // この端末で作っている（まだ決めていない）配り方。描き直しても消えないように回ごとに覚える

// CPU の配り方。点の高い戦場を選びやすく、3〜4か所に寄せる。3割は適当
export function cpuAlloc(values, rnd = Math.random) {
  const w = rnd() < 0.3 ? values.map(() => rnd()) : values.map((v) => v ** 1.3 * (0.5 + rnd()));
  const keep = rnd() < 0.5 ? 3 : 4;
  const order = w.map((x, f) => [x, f]).sort((a, b) => b[0] - a[0]).map(([, f]) => f);
  const use = new Set(order.slice(0, keep));
  const ws = w.map((x, f) => (use.has(f) ? x + 0.2 : 0));
  const sum = ws.reduce((a, b) => a + b, 0);
  const a = ws.map((x) => Math.floor((x / sum) * TROOPS));
  let left = TROOPS - a.reduce((x, y) => x + y, 0);
  for (let i = 0; left > 0; i++, left--) a[order[i % keep]] += 1;
  return a;
}

export default {
  id: 'heitai',
  name: '兵の振り分け',
  icon: '🏰',
  desc: '100人の兵を5つの戦場にこっそり配る。一番多く置いた人がその戦場の点を取る',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,

  init(n, seed) {
    return {
      n, seed, total: ROUNDS, r: -1, phase: 'ready', values: valuesOf(seed, 0),
      picks: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.picks[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    return { winners: leaders(s.scores), scores: s.scores };
  },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'card' : null;
    return m.p === me ? 'chip' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.r + 1}回目 / ${s.total}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.picks.every((v) => v !== null)) return { key: 'all' + s.r, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.r, ms: LIMIT + 1000, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.r, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.r + 1 >= s.total) { s.phase = 'end'; return s; }
        s.r += 1;
        s.phase = 'open';
        s.values = valuesOf(s.seed, s.r);
        s.picks = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const late = s.picks.map((a) => a === null);
        const allocs = s.picks.map((a) => a ?? EVEN.slice());
        const { owner, pts } = scoreRound(allocs, s.values);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.picks = allocs;
        s.last = { owner, pts, late };
        s.log = [...s0.log, { values: s.values.slice(), picks: allocs, owner, pts, late }];
        return s;
      }
      return null;
    }
    if (m.t !== 'pick' || s0.phase !== 'open' || m.r !== s0.r || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.picks[m.p] !== null) return null;
    if (!okAlloc(m.a)) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.a.slice();
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.picks[p] !== null) return null;
    const key = rKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 3000 + Math.random() * 9000, a: cpuAlloc(s.values) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(rKey(s)) >= plan.at ? { t: 'pick', r: s.r, a: plan.a } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.picks[p] !== null ? '<span class="pt-ok">✔ 決めた</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      return s.last.pts[p] ? `<span class="pt-ok">+${s.last.pts[p]}</span>` : '<span class="pt-ng">0</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj ht';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    if (s.phase === 'ready') {
      const card = document.createElement('div');
      card.className = 'kj-card';
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">100人の兵を5つの戦場に配ろう。一番多く置いた人がその戦場の点を取る・全${s.total}回</div>`;
      wrap.append(card);
      return;
    }
    const key = rKey(s);
    if (s.phase === 'shown') {
      wrap.append(this.table(s.log[s.log.length - 1], me, o, true));
      return;
    }
    since(key);
    wrap.append(timeBar(key, LIMIT, { secs: true }));
    const mine = me !== null ? s.picks[me] : null;
    const can = me !== null && o.canMove && mine === null && since(key) < LIMIT;
    const dk = key + ':' + me;
    if (!drafts.has(dk)) { drafts.set(dk, Array(FIELDS).fill(0)); if (drafts.size > 50) drafts.delete(drafts.keys().next().value); }
    const draft = mine ?? drafts.get(dk);
    const box = document.createElement('div');
    box.className = 'ht-fields';
    const left = document.createElement('div');
    left.className = 'ht-left';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn primary kb-go';
    const rows = [];
    const paint = () => {
      const rest = TROOPS - draft.reduce((a, b) => a + b, 0);
      left.innerHTML = mine !== null ? '配り終えました' : `のこり <b>${rest}</b> 人`;
      left.classList.toggle('done', rest === 0);
      rows.forEach(({ num, bar, btns }, f) => {
        num.textContent = String(draft[f]);
        bar.style.width = draft[f] + '%';
        btns.forEach(([b, d]) => { b.disabled = !can || draft[f] + d < 0 || (d > 0 && rest <= 0); });
      });
      go.disabled = !can || rest !== 0;
      go.textContent = mine !== null ? 'これで決めた' : rest === 0 ? 'これで決める' : `あと ${rest}人 配ろう`;
    };
    s.values.forEach((v, f) => {
      const row = document.createElement('div');
      row.className = 'ht-row';
      const lab = document.createElement('div');
      lab.className = 'ht-lab';
      lab.innerHTML = `<span class="ht-name">${FIELD_NAMES[f]}</span><span class="ht-val">${'★'.repeat(v)}<small>${v}点</small></span>`;
      const meter = document.createElement('div');
      meter.className = 'ht-meter';
      const bar = document.createElement('div');
      bar.className = 'ht-bar';
      const num = document.createElement('span');
      num.className = 'ht-num';
      meter.append(bar, num);
      const ctl = document.createElement('div');
      ctl.className = 'ht-ctl';
      const btns = [];
      for (const d of [-10, -1, 1, 10]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ht-step';
        b.textContent = d > 0 ? `+${d}` : String(d).replace('-', '−');
        b.onclick = () => {
          if (!can) return;
          const rest = TROOPS - draft.reduce((a, c) => a + c, 0);
          draft[f] = Math.max(0, draft[f] + (d > 0 ? Math.min(d, rest) : d));
          paint();
        };
        btns.push([b, d]);
        ctl.append(b);
      }
      row.append(lab, meter, ctl);
      rows.push({ num, bar, btns });
      box.append(row);
    });
    const tools = document.createElement('div');
    tools.className = 'ht-tools';
    const mk = (text, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = text;
      b.disabled = !can;
      b.onclick = () => { if (can) { fn(); paint(); } };
      return b;
    };
    tools.append(
      mk('20人ずつ', () => draft.fill(TROOPS / FIELDS)),
      mk('はじめから', () => draft.fill(0)),
    );
    go.onclick = () => {
      if (!can || go.dataset.sent || since(key) >= LIMIT || !okAlloc(draft)) return;
      go.dataset.sent = '1';
      go.disabled = true;
      o.onMove({ t: 'pick', r: s.r, a: draft.slice() });
    };
    wrap.append(left, box);
    if (mine === null && me !== null) wrap.append(tools);
    wrap.append(go);
    paint();
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (mine !== null) note.textContent = 'ほかの人が決めるのを待っています…';
    else note.textContent = '時間内に決めないと、20人ずつ配ったことになります';
    wrap.append(note);
    if (s.log.length) {
      const prev = document.createElement('details');
      prev.className = 'ht-prev';
      prev.open = true;
      const sum = document.createElement('summary');
      sum.textContent = `前の回（${s.r}回目）の配り方`;
      prev.append(sum, this.table(s.log[s.log.length - 1], me, o, false));
      wrap.append(prev);
    }
  },

  // 1回ぶんの表: 戦場ごとの点と、席ごとの人数。取った人のマスに印
  table(x, me, o, big) {
    const t = document.createElement('table');
    t.className = 'ht-table' + (big ? ' big' : '');
    const head = document.createElement('tr');
    head.innerHTML = '<th></th>' + x.values.map((v, f) => `<th><span class="ht-tn">${FIELD_NAMES[f]}</span><span class="ht-tv">${v}点</span></th>`).join('') + '<th>点</th>';
    t.append(head);
    x.picks.forEach((a, p) => {
      const tr = document.createElement('tr');
      if (p === me) tr.className = 'me';
      const th = document.createElement('th');
      th.textContent = (p === me ? 'あなた' : o.names[p]) + (x.late[p] ? '⏰' : '');
      tr.append(th);
      a.forEach((v, f) => {
        const td = document.createElement('td');
        td.textContent = String(v);
        if (x.owner[f] === p) td.className = 'win';
        else if (x.owner[f] === null && v > 0 && v === Math.max(...x.picks.map((b) => b[f]))) td.className = 'tie';
        tr.append(td);
      });
      const pt = document.createElement('td');
      pt.className = 'ht-pt';
      pt.textContent = '+' + x.pts[p];
      tr.append(pt);
      t.append(tr);
    });
    const box = document.createElement('div');
    box.className = 'ht-tbox';
    box.append(t);
    if (x.late.some(Boolean)) {
      const n = document.createElement('div');
      n.className = 'kj-sub';
      n.textContent = '⏰ = 時間内に決めず、20人ずつ配った';
      box.append(n);
    }
    return box;
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    box.append(sum);
    s.log.forEach((x, r) => {
      const h = document.createElement('div');
      h.className = 'ht-rv';
      h.textContent = `${r + 1}回目`;
      box.append(h, this.table(x, me, o, false));
    });
    return box;
  },
};
