// かぶったら0点。全員がこっそり数字を1つ選び、そろって見せる。ほかの人とかぶらなかった数字だけが、その数の点になる。3〜10人・足りない分は CPU。
// 2026-11-02 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 使う数字は人数で自動で決める: 5人までは1〜5、6人以上は1〜人数（10人で1〜5だとほとんどかぶるため）。
//   - 決まった回数を遊んで合計点で勝負（最初は8回。詳細設定で5・8・12回）。
//   - 1回15秒。選ばなかった人はその回0点。
// Claude の判断:
//   - 数字を押すと選んだだけ（何度でも選び直せる）で、「これで決める」を押すと決まる（決めたら変えられない）。読み合いのゲームなので押し間違いで決まらないように。
//     決めた数字は全員の端末が知っている（手札と同じ簡易の隠し方）。画面には「✔ 決めた」だけを出す。
//   - 全員が決めたら0.8秒で見せる。見せる間は3.5秒（だれが何を出したかを読む時間）。
//   - 同じ点の人は同じ順位（成績表は合計点で並べる）。
//   - CPU は 1.5〜7秒で決める。大きい数ほど少し選びやすい（大きい数は点が多いがかぶりやすい、を人がやりがちなまね）。読み合いはしない。
// 2026-11-02 の32回目の案（本人がおすすめどおり選んだ。分かれ目は Claude の判断）: 詳細設定「前と同じ数字」（出せる（最初）・出せない。鍵は norepeat）。
//   出せないでは、前の回に自分が決めた数字をその回は選べない（ボタンを押せなくして 🚫 を付ける。前の回に決めなかった人は全部選べる）。CPU もよける。
//   前の回の数字は局面の log から取るので、局面の形は「出せる」のときと同じ。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'pick', r: 何回目（0 から）, v: 数字 }
//   r が今の回と同じで、その人がまだ決めていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { since, scoreChips, leaders, winnersText, timeBar } from './party.js';

const ROUNDS = [[5, '5回'], [8, '8回'], [12, '12回']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 8);
export const maxOf = (n) => Math.max(5, n);
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 800;

// 1回ぶんの点: かぶらなかった数字だけがその数の点。決めなかった人（null）は0点
export function scoreRound(picks) {
  return picks.map((v) => (v !== null && picks.filter((w) => w === v).length === 1 ? v : 0));
}

// その回に選べない数字（「前と同じ数字」が出せないのときの、前の回に自分が決めた数字）。無ければ null
export function banOf(s, p) {
  if (!s.rules.norepeat || s.r < 1) return null;
  return s.log[s.r - 1]?.picks[p] ?? null;
}

const rKey = (s, r = s.r) => `kaburi:${s.seed}:${r}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice() });
const cpuPlan = new Map();
const chosen = new Map(); // この端末で選んだ（まだ決めていない）数字。描き直しても消えないように回ごとに覚える

export default {
  id: 'kaburi',
  name: 'かぶったら0点',
  icon: '🙅',
  desc: 'こっそり数字を選ぶ。ほかの人とかぶらなければ、その数が点になる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で数字を出す回数', def: 8, choices: ROUNDS },
    { key: 'norepeat', label: '前と同じ数字', desc: '出せないにすると、前の回に自分が出した数字はその回に選べない', def: false, choices: [[false, '出せる'], [true, '出せない']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 8, ...rules };
    return {
      n, seed, rules: r, total: roundsOf(r), max: maxOf(n), r: -1, phase: 'ready',
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
        s.picks = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = scoreRound(s.picks);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { picks: s.picks.slice(), pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'pick' || s0.phase !== 'open' || m.r !== s0.r || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.picks[m.p] !== null) return null;
    if (!Number.isInteger(m.v) || m.v < 1 || m.v > s0.max || m.v === banOf(s0, m.p)) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.v;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.picks[p] !== null) return null;
    const key = rKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const ban = banOf(s, p);
      const w = [...Array(s.max)].map((_, i) => (i + 1 === ban ? 0 : Math.sqrt(i + 1))); // 大きい数ほど少し選びやすい
      let x = Math.random() * w.reduce((a, b) => a + b, 0);
      let v = 1;
      while (v < s.max && (x > w[v - 1] || w[v - 1] === 0)) { x -= w[v - 1]; v += 1; }
      plan = { at: 1500 + Math.random() * 5500, v };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(rKey(s)) >= plan.at ? { t: 'pick', r: s.r, v: plan.v } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.picks[p] !== null ? '<span class="pt-ok">✔ 決めた</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const v = s.picks[p];
      if (v === null) return '<span class="pt-ng">―</span>';
      return s.last.pts[p] ? `<span class="pt-ok">${v} → +${v}</span>` : `<span class="pt-ng">${v} かぶり</span>`;
    };
    root.innerHTML = '';
    root.className = 'board kj kb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">1〜${s.max} から1つ選ぼう。ほかの人とかぶらなければ、その数が点・全${s.total}回${s.rules.norepeat ? '・前の回と同じ数字は出せない' : ''}</div>`;
      return;
    }
    const key = rKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">${s.r + 1}回目 / ${s.total}</div>`);
    if (s.phase === 'shown') {
      card.append(this.reveal(s, me, o));
      return;
    }
    since(key);
    card.append(timeBar(key, LIMIT, { secs: true }));
    const mine = me !== null ? s.picks[me] : null;
    const can = me !== null && o.canMove && mine === null && since(key) < LIMIT;
    const ck = key + ':' + me;
    const ban = me !== null ? banOf(s, me) : null;
    const sel = mine ?? (chosen.get(ck) === ban ? null : chosen.get(ck)) ?? null;
    const pad = document.createElement('div');
    pad.className = 'kb-pad' + (s.max > 5 ? ' many' : '');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn primary kb-go';
    const paint = (v) => {
      pad.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', Number(b.dataset.v) === v));
      go.disabled = !can || v === null;
      go.textContent = mine !== null ? `「${mine}」で決めた` : v === null ? '数字を選んでね' : `「${v}」で決める`;
    };
    for (let v = 1; v <= s.max; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kb-num';
      b.dataset.v = String(v);
      b.textContent = v === ban ? `🚫${v}` : String(v);
      if (v === ban) b.title = '前の回に出した数字';
      b.disabled = !can || v === ban;
      // 指が触れた瞬間に選ぶ（click を待つと、ほかの人や CPU の手で作り直されたときに押したのが消える。ビンゴと同じ）
      b.onpointerdown = b.onclick = (e) => {
        if (!can || v === ban) return;
        e.preventDefault();
        chosen.set(ck, v);
        if (chosen.size > 100) chosen.delete(chosen.keys().next().value);
        paint(v);
      };
      pad.append(b);
    }
    go.onpointerdown = go.onclick = (e) => {
      const v = chosen.get(ck);
      if (!can || !v || go.dataset.sent || since(key) >= LIMIT) return;
      e.preventDefault();
      go.dataset.sent = '1';
      go.disabled = true;
      o.onMove({ t: 'pick', r: s.r, v });
    };
    paint(sel);
    wrap.append(pad, go);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (mine !== null) note.textContent = 'ほかの人が決めるのを待っています…';
    wrap.append(note);
  },

  // 見せる場面: 数字ごとに出した人を並べ、かぶった数字は打ち消す
  reveal(s, me, o) {
    const box = document.createElement('div');
    box.className = 'kb-reveal';
    for (let v = s.max; v >= 1; v--) {
      const who = s.picks.map((x, p) => (x === v ? p : -1)).filter((p) => p >= 0);
      if (!who.length) continue;
      const row = document.createElement('div');
      row.className = 'kb-row' + (who.length > 1 ? ' hit' : ' ok');
      const num = document.createElement('span');
      num.className = 'kb-v';
      num.textContent = String(v);
      const names = document.createElement('span');
      names.className = 'kb-who';
      names.textContent = who.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      const tag = document.createElement('span');
      tag.className = 'kb-tag';
      tag.textContent = who.length > 1 ? 'かぶり 0点' : `+${v}点`;
      row.append(num, names, tag);
      box.append(row);
    }
    const none = s.picks.map((x, p) => (x === null ? p : -1)).filter((p) => p >= 0);
    if (none.length) {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = `決めなかった人: ${none.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}（0点）`;
      box.append(t);
    }
    return box;
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, r) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'mk-rv-n';
      n.textContent = String(r + 1);
      const body = document.createElement('span');
      body.className = 'kb-rv';
      body.textContent = x.picks.map((v, p) => `${p === me ? 'あなた' : o.names?.[p] ?? ''} ${v ?? '―'}${x.pts[p] ? '⭕' : ''}`).join('　');
      li.append(n, body);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
