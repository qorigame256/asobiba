// 後出しじゃんけん早押し。相手の手と「勝て」「負けろ」の指示が同時に出るので、正しい手を早く押す。2〜10人・足りない分は CPU。
// 2026-10-30 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 指示は「勝て」「負けろ」の2つ。詳細設定「あいこ」（なし（最初）・あり）で「あいこにしろ」も混ぜる。
//   - 点は色ちがい早押しと同じ: 10問。正解した速い順に 3・2・1点。まちがえたらその問題はもう押せないが、点は減らない。
//   - 詳細設定「問題の数」（2026-10-30 の31回目の案。本人が選んだ）: 5問・10問（最初）・20問。選び方は色ちがい早押しと同じ（Claude の判断）。
// Claude の判断:
//   - 手のボタンの並びは毎回 グー・チョキ・パー の順（並びが変わると手を探す時間の勝負になるため。色ちがい早押しと同じ考え）。
//   - 指示は問題ごとに種から選ぶ。あいこありでは3つから同じ見込みで選ぶ。同じ手と指示の組が2問続かないようにする。
//   - 1問の制限時間は4秒（色ちがいより1秒短い。3つから選ぶので）。全員が答えたら0.8秒で締め切る。結果を見せる間は2秒。速さは各自の画面に出てから押すまで。
//   - CPU は0.8〜1.8秒で押し、80%（あいこの問題は75%）当てる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, h: 'g' | 'c' | 'p', ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

export const HANDS = ['g', 'c', 'p'];
const FACE = { g: '✊', c: '✌️', p: '✋' };
const HAND_NAME = { g: 'グー', c: 'チョキ', p: 'パー' };
const BEATS = { g: 'c', c: 'p', p: 'g' }; // 左が右に勝つ
const ORDER = { win: ['勝て！', '#d9643a'], lose: ['負けろ！', '#2f6fb3'], draw: ['あいこにしろ！', '#2e9a52'] };
const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const LIMIT = 4000;
const READY_MS = 3000;
const SHOWN_MS = 2000;
const GRACE_MS = 800;

// 相手の手 x と指示 o に対する正しい手
export function answerOf({ x, o }) {
  if (o === 'draw') return x;
  if (o === 'lose') return BEATS[x]; // 相手が勝つ手（相手が負かす手）を出す
  return HANDS.find((h) => BEATS[h] === x); // 相手に勝つ手
}

const qKey = (s, q = s.q) => `atodashi:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'atodashi',
  name: '後出しじゃんけん早押し',
  icon: '✌️',
  desc: '相手の手を見て「勝て」「負けろ」のとおりに、正しい手を早く押す',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'draw', label: 'あいこ', desc: '「あいこにしろ」の指示も混ぜる', def: false },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { draw: false, rounds: 10, ...rules };
    const k = roundsOf(r);
    const rnd = mulberry32(seed);
    const kinds = r.draw ? ['win', 'lose', 'draw'] : ['win', 'lose'];
    const qs = [];
    while (qs.length < k) {
      const q = { x: HANDS[Math.floor(rnd() * 3)], o: kinds[Math.floor(rnd() * kinds.length)] };
      const prev = qs[qs.length - 1];
      if (prev && prev.x === q.x && prev.o === q.o) continue;
      qs.push(q);
    }
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
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
      return { key: 'open' + s.q, ms: LIMIT + 1000, move: { t: 'close' } };
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
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const best = Math.min(...s.solved.filter((v) => v !== null));
        const winners = s.solved.map((v, p) => (v !== null && v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), miss: s.miss.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!HANDS.includes(m.h) || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.h === answerOf(s.qs[s.q])) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const ok = Math.random() < (x.o === 'draw' ? 0.75 : 0.8);
      const wrong = HANDS.filter((h) => h !== answerOf(x));
      plan = { at: 800 + Math.random() * 1000, h: ok ? answerOf(x) : wrong[Math.floor(Math.random() * 2)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at ? { t: 'ans', q: s.q, h: plan.h, ms: Math.round(t) } : null;
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
    root.className = 'board kj ir ad';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">相手の手を見て、指示のとおりの手を押そう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const [word, col] = ORDER[x.o];
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`
      + `<div class="ad-hand">${FACE[x.x]}</div><div class="ad-order" style="background:${col}">${word}</div>`);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `正解は「${HAND_NAME[answerOf(x)]}」${fast ? `・いちばん速かったのは ${fast}` : '・だれも正解できませんでした'}`;
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const pad = document.createElement('div');
    pad.className = 'ad-pad';
    for (const h of HANDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ad-btn' + (s.phase === 'shown' && h === answerOf(x) ? ' ans' : '');
      b.innerHTML = `<span>${FACE[h]}</span><small>${HAND_NAME[h]}</small>`;
      b.disabled = !can;
      const hit = (e) => {
        if (!can || b.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        pad.querySelectorAll('button').forEach((y) => { y.disabled = true; y.dataset.sent = '1'; });
        o.onMove({ t: 'ans', q: s.q, h, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る（指を離すまで待たない）
      b.onclick = hit; // キーボードで押したとき
      pad.append(b);
    }
    wrap.append(pad);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
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
      const qq = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${FACE[qq.x]} ${ORDER[qq.o][0]} → ${FACE[answerOf(qq)]}</span><span>${mine}</span>`;
      const who = document.createElement('span');
      who.className = 'mk-rv-who';
      who.textContent = fast.length ? '⚡' + fast.join('・') : '―';
      li.append(who);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
