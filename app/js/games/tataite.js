// たたいてかぶってじゃんけん。2人ずつ組になってじゃんけんをし、勝った人は「たたく」、負けた人は「かぶる」を早く押す。2〜10人（偶数）・足りない分は CPU（弱め）。
// 2026-11-18 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 毎回、全員を2人ずつの組に分けて同時に戦う。人数が奇数のときは CPU が入る（evenTeams で全員の数を偶数にそろえる）。組は毎回変える
//     （4人以上なら前の回と同じ相手にしない。2026-11-18 本人の決定。pairsOf）。
//     10回戦って、勝った回数（点）の多い人の勝ち。
//   - 流れ: 手を選ぶ（3秒）→ 手が一斉に出る → 勝った人は 🔨、負けた人は ⛑️ を押す。勝った人が先にたたけたら1点、負けた人が先にかぶれたらどちらも0点。
//     手を選ばなかったときは、おまかせの手になる。
//   - 押しまちがい（勝ったのにかぶる・負けたのにたたく）と、あいこのときに押してしまうのはお手つきで、相手に1点。
//   - 速さは、ほかの早押しと同じく、各自の画面に手が出てから押すまでの時間（ms）で比べる。
// Claude の判断:
//   - 1つの組の勝ち負けは「先に押した人のボタン」で決める（届いた順でなく ms の小さい順）。先に押したのが正しい「たたく」なら勝った人に1点、
//     正しい「かぶる」ならどちらも0点、お手つきなら相手に1点。ms が同じなら「かぶる」を先にする（本物の遊びでも、かぶっていればたたかれても負けない）。
//     1回押したら、その回はもう押せない。
//   - 手が出てから押せるのは2.5秒。組の全員が押したら0.8秒で締め切る。あいこの組は2.5秒待つ（押さないのが正しいため）。
//   - 画面には「たたけ」「かぶれ」の指示は出さない（自分と相手の手を見て、どちらを押すか決めるのが遊びの中身のため）。
//   - CPU は手を0.5〜2秒で選ぶ。押すのは0.5〜1.1秒で、9割は正しいボタン。あいこでは1割お手つきする。
//   - 人数が奇数になってしまったとき（自動確認などで直に始めたとき）は、組に入れなかった1人がその回は休み。
// 2026-11-18 の44回目の案（本人が選んだ。分かれ目は Claude が決めた）:
//   - 回数: 5・10（最初）・15回（鍵は rounds）。
//   - 手が出るまでの間: いつも同じ（最初）・ばらばら（鍵は wait）。ばらばらでは、手が一斉に出る合図（reveal）のあと、手を ❔ で伏せたまま
//     0.5〜2秒待ってから見せる（待つ長さは種と何回目かから決まるので全員同じ。waitOf）。待っている間はボタンを押せない（何を押すか分からないため）。
//     速さ（ms）は、各自の画面で手が見えてから測る（showKey）。手を選ぶ3秒の帯で「そろそろ」と読めてしまうのを崩すための設定。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → pick → reveal → act → close → shown → next …
// 手: { p: -1, t: 'next' | 'reveal' | 'close' } / { p, t: 'hand', r, h: 'g' | 'c' | 'p' } / { p, t: 'act', r, a: 'hit' | 'cover', ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';

const ROUNDS = [[5, '5回'], [10, '10回'], [15, '15回']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const PICK_MS = 3000;
const ACT_MS = 2500;
const READY_MS = 3000;
const SHOWN_MS = 3200;
const GRACE_MS = 500;
const ALL_MS = 800;
const HANDS = ['g', 'c', 'p'];
const FACE = { g: '✊', c: '✌️', p: '✋' };
const BEATS = { g: 'c', c: 'p', p: 'g' }; // 左が右に勝つ

const actKey = (s, r = s.r) => `tataite:${s.seed}:${r}:act`;
const pickKey = (s, r = s.r) => `tataite:${s.seed}:${r}:pick`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), hands: s.hands.slice(), acts: s.acts.slice() });

// その回の組（種と何回目かでまぜる。全員同じ）。
// 2026-11-18 本人の決定（Codex の点検の問いに推奨どおり）: 4人以上なら、前の回と同じ相手の組を作らない。
// Claude の判断: 同じ乱数でまぜ直し、前の回と重なる組が無いものを使う（1回目のまぜ方は前と同じなので、重ならない回は前の版と同じ組）。
// 30回まぜても見つからなければ、重なりのいちばん少ないもの。2〜3人は相手を替えられないのでそのまま。前の回の組は同じ決め方で順にさかのぼって作る（memo に覚える）。
const pairMemo = new Map();
export function pairsOf(n, seed, r) {
  const key = `${n}:${seed}:${r}`;
  if (pairMemo.has(key)) return pairMemo.get(key);
  const rnd = mulberry32((seed * 151 + r * 43 + 9) >>> 0);
  const cut = (order) => { const out = []; for (let i = 0; i + 1 < order.length; i += 2) out.push([order[i], order[i + 1]]); return out; };
  let best = cut(shuffle([...Array(n).keys()], rnd));
  if (r > 0 && n >= 4) {
    const seen = new Set(pairsOf(n, seed, r - 1).map(([a, b]) => Math.min(a, b) + '-' + Math.max(a, b)));
    const dup = (ps) => ps.filter(([a, b]) => seen.has(Math.min(a, b) + '-' + Math.max(a, b))).length;
    let bestDup = dup(best);
    for (let t = 0; t < 30 && bestDup > 0; t++) {
      const ps = cut(shuffle([...Array(n).keys()], rnd));
      const d = dup(ps);
      if (d < bestDup) { best = ps; bestDup = d; }
    }
  }
  pairMemo.set(key, best);
  if (pairMemo.size > 500) pairMemo.delete(pairMemo.keys().next().value);
  return best;
}
// 手を選ばなかった人のおまかせの手（種・回・席から決まる）
// 「ばらばら」のとき、手が出る合図から手を見せるまでの間（ms）。いつも同じなら0
export const waitOf = (s) => (s.rules?.wait ? 500 + Math.floor(mulberry32((s.seed * 97 + s.r * 61 + 5) >>> 0)() * 1500) : 0);
const showKey = (s) => (waitOf(s) ? actKey(s) + ':show' : actKey(s)); // 手が見えた時刻の鍵（いつも同じなら合図の時刻と同じ）
const autoHand = (seed, r, p) => HANDS[Math.floor(mulberry32((seed * 89 + r * 13 + p * 7 + 1) >>> 0)() * 3)];
// 組の勝ち負け: { win: 勝った席 | null（あいこ）, lose }
export function duelOf(hands, [x, y]) {
  if (hands[x] === hands[y]) return { win: null, lose: null };
  return BEATS[hands[x]] === hands[y] ? { win: x, lose: y } : { win: y, lose: x };
}
// 組の結果: { kind: 'hit' | 'guard' | 'foul' | 'none' | 'aiko', by: 決め手を押した席, pts: { 席: 点 } }
export function judgePair(hands, acts, pair) {
  const { win, lose } = duelOf(hands, pair);
  const okOf = (p, a) => (win !== null && ((p === win && a === 'hit') || (p === lose && a === 'cover')));
  const rankOf = (p, a) => (!okOf(p, a) ? 2 : a === 'cover' ? 0 : 1);
  const presses = pair.filter((p) => acts[p]).map((p) => ({ p, a: acts[p].a, ms: acts[p].ms }))
    .sort((u, v) => u.ms - v.ms || rankOf(u.p, u.a) - rankOf(v.p, v.a));
  const first = presses[0];
  if (!first) return { kind: win === null ? 'aiko' : 'none', by: null, pts: {} };
  const other = pair.find((p) => p !== first.p);
  if (!okOf(first.p, first.a)) return { kind: 'foul', by: first.p, pts: { [other]: 1 } };
  if (first.a === 'hit') return { kind: 'hit', by: first.p, pts: { [first.p]: 1 } };
  return { kind: 'guard', by: first.p, pts: {} };
}
const inPair = (s, p) => s.pairs.some((x) => x.includes(p));
const cpuPlan = new Map();

export default {
  id: 'tataite',
  name: 'たたいてかぶってじゃんけん',
  icon: '🔨',
  desc: '2人ずつじゃんけん。勝ったら🔨たたく、負けたら⛑️かぶる。先に押した方が勝ち',
  ready: true,
  multi: true,
  realtime: true,
  evenTeams: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局でじゃんけんをする回数', def: 10, choices: ROUNDS },
    { key: 'wait', label: '手が出るまでの間', desc: '手が出るまでの間を毎回変える（0.5〜2秒）。待ち構えて押せなくなる', def: false, choices: [[false, 'いつも同じ'], [true, 'ばらばら']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    return {
      n, seed, rules: { ...rules }, r: -1, rounds: roundsOf(rules), phase: 'ready', pairs: [],
      hands: Array(n).fill(null), acts: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return (s.phase === 'pick' || s.phase === 'act') && (p === undefined || inPair(s, p)); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next' && b.phase === 'pick') return 'question';
      if (m.t === 'reveal') return 'call';
      if (m.t === 'close' && me >= 0 && b.last) {
        const mine = b.last.find((x) => x.pair.includes(me));
        if (mine?.pts[me]) return 'correct';
        if (mine?.kind === 'foul' && mine.by === me) return 'wrong';
      }
      return null;
    }
    if (m.p !== me) return null;
    if (m.t === 'act') return m.a === 'hit' ? 'punch' : 'wall';
    return null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.r + 1}回 / ${s.rounds}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    const ins = [...Array(s.n).keys()].filter((p) => inPair(s, p));
    if (s.phase === 'pick') {
      if (ins.every((p) => s.hands[p] !== null)) return { key: 'pickall' + s.r, ms: GRACE_MS, move: { t: 'reveal' } };
      return { key: 'pick' + s.r, ms: PICK_MS + GRACE_MS, move: { t: 'reveal' } };
    }
    if (s.phase === 'act') {
      if (ins.every((p) => s.acts[p] !== null)) return { key: 'actall' + s.r, ms: ALL_MS, move: { t: 'close' } };
      return { key: 'act' + s.r, ms: waitOf(s) + ACT_MS + GRACE_MS, move: { t: 'close' } };
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
        if (s.r + 1 >= s.rounds) { s.phase = 'end'; return s; }
        s.r += 1;
        s.phase = 'pick';
        s.pairs = pairsOf(s.n, s.seed, s.r);
        s.hands = Array(s.n).fill(null);
        s.acts = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'reveal' && s0.phase === 'pick') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'act';
        s.auto = [];
        for (let p = 0; p < s.n; p++) {
          if (s.hands[p] === null && inPair(s, p)) { s.hands[p] = autoHand(s.seed, s.r, p); s.auto.push(p); }
        }
        return s;
      }
      if (m.t === 'close' && s0.phase === 'act') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        s.last = s.pairs.map((pair) => ({ pair, hands: pair.map((p) => s.hands[p]), acts: pair.map((p) => s.acts[p]), ...judgePair(s.hands, s.acts, pair) }));
        for (const x of s.last) for (const [p, v] of Object.entries(x.pts)) s.scores[+p] += v;
        s.log = [...s0.log, s.last];
        return s;
      }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || m.r !== s0.r || !inPair(s0, m.p)) return null;
    if (m.t === 'hand') {
      if (s0.phase !== 'pick' || s0.hands[m.p] !== null || !HANDS.includes(m.h)) return null;
      const s = clone(s0);
      s.step += 1;
      s.hands[m.p] = m.h;
      return s;
    }
    if (m.t === 'act') {
      if (s0.phase !== 'act' || s0.acts[m.p] !== null || !['hit', 'cover'].includes(m.a)) return null;
      if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > ACT_MS + 300) return null;
      const s = clone(s0);
      s.step += 1;
      s.acts[m.p] = { a: m.a, ms: Math.round(m.ms) };
      return s;
    }
    return null;
  },

  cpuDelay(s) { return s.phase === 'act' ? 80 : s.phase === 'pick' ? 200 : 500; },
  cpu(s, p) {
    if (!inPair(s, p)) return null;
    if (s.phase === 'pick') {
      if (s.hands[p] !== null) return null;
      const key = pickKey(s) + ':' + p;
      let plan = cpuPlan.get(key);
      if (!plan) { plan = { at: 500 + Math.random() * 1500, h: HANDS[Math.floor(Math.random() * 3)] }; cpuPlan.set(key, plan); }
      return since(pickKey(s)) >= plan.at ? { t: 'hand', r: s.r, h: plan.h } : null;
    }
    if (s.phase === 'act') {
      if (s.acts[p] !== null) return null;
      const key = actKey(s) + ':' + p;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const pair = s.pairs.find((x) => x.includes(p));
        const { win } = duelOf(s.hands, pair);
        const right = win === null ? null : win === p ? 'hit' : 'cover';
        const wrongOf = (a) => (a === 'hit' ? 'cover' : 'hit');
        if (right === null) plan = Math.random() < 0.1 ? { at: 400 + Math.random() * 500, a: Math.random() < 0.5 ? 'hit' : 'cover' } : { at: Infinity };
        else plan = { at: 500 + Math.random() * 600, a: Math.random() < 0.9 ? right : wrongOf(right) };
        cpuPlan.set(key, plan);
      }
      if (cpuPlan.size > 400) cpuPlan.delete(cpuPlan.keys().next().value);
      const t = since(actKey(s)) - waitOf(s); // 手が見えてからの時間
      return t >= plan.at && t < ACT_MS ? { t: 'act', r: s.r, a: plan.a, ms: Math.round(t) } : null;
    }
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const name = (p) => (p === me ? 'あなた' : o.names[p]);
    const myRes = s.phase === 'shown' && s.last ? s.last : null;
    const extra = (p) => {
      if (s.phase === 'pick') return s.hands[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase === 'act') return s.acts[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (!myRes) return '';
      const x = myRes.find((y) => y.pair.includes(p));
      if (!x) return '<span class="pt-ng">休み</span>';
      return x.pts[p] ? `<span class="pt-ok">+${x.pts[p]}</span>` : '';
    };
    root.innerHTML = '';
    root.className = 'board kj tt';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">勝ったら 🔨 たたく、負けたら ⛑️ かぶる。あいこは押さない・全${s.rounds}回</div>`;
      return;
    }
    const pair = me !== null ? s.pairs.find((x) => x.includes(me)) : null;
    const foe = pair ? pair.find((p) => p !== me) : null;
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (s.phase === 'pick') {
      const key = pickKey(s);
      since(key);
      if (!pair) {
        card.innerHTML = `<div class="kj-word small">${me === null ? 'じゃんけん…' : 'この回はお休み'}</div>`;
      } else {
        card.innerHTML = `<div class="kj-sub">あいては <b>${esc(name(foe))}</b></div><div class="kj-word small">じゃんけん…</div>`;
        card.append(timeBar(key, PICK_MS));
        const can = o.canMove && s.hands[me] === null;
        const pad = document.createElement('div');
        pad.className = 'tt-hands';
        const btns = HANDS.map((h) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tt-hand' + (s.hands[me] === h ? ' mine' : '');
          b.textContent = FACE[h];
          b.disabled = !can;
          b.onclick = () => {
            if (!can || pad.dataset.sent) return;
            pad.dataset.sent = '1';
            btns.forEach((y) => { y.disabled = true; });
            b.classList.add('mine');
            o.onMove({ t: 'hand', r: s.r, h });
          };
          return b;
        });
        pad.append(...btns);
        wrap.append(pad);
        note.textContent = s.hands[me] !== null ? '出す手を決めました。手が出たらすぐ押そう！' : '出す手を選んでください（選ばないとおまかせ）';
      }
      wrap.append(note);
      return;
    }
    // 手が出たあと（act と shown）
    const wait = s.phase === 'act' ? waitOf(s) : 0;
    if (s.phase === 'act') since(actKey(s));
    const hidden = s.phase === 'act' && since(actKey(s)) < wait; // 「ばらばら」で、まだ手を伏せている間
    const key = s.phase === 'act' && !hidden ? showKey(s) : actKey(s);
    if (s.phase === 'act' && !hidden) since(key);
    if (hidden) setTimeout(() => { if (wrap.isConnected) this.render(root, s, o); }, Math.max(0, wait - since(actKey(s))) + 5);
    const face = (p) => (hidden ? '❔' : FACE[s.hands[p]]);
    const vs = (x) => {
      const box = document.createElement('div');
      box.className = 'tt-vs';
      const [a, b] = me !== null && x.includes(me) ? [me, x.find((p) => p !== me)] : x;
      box.innerHTML = `<div class="tt-side"><span class="tt-face">${face(a)}</span><span class="tt-name">${esc(name(a))}</span></div>`
        + '<span class="tt-x">vs</span>'
        + `<div class="tt-side"><span class="tt-face">${face(b)}</span><span class="tt-name">${esc(name(b))}</span></div>`;
      return box;
    };
    const resText = (x) => {
      const [a, b] = x.pair;
      if (x.kind === 'hit') return `🔨 ${name(x.by)} が ${name(x.pair.find((p) => p !== x.by))} をたたいた！ +1`;
      if (x.kind === 'guard') return `⛑️ ${name(x.by)} がかぶって守った`;
      if (x.kind === 'foul') return `💥 ${name(x.by)} のお手つき！ ${name(x.pair.find((p) => p !== x.by))} に +1`;
      if (x.kind === 'aiko') return `あいこ（${name(a)}・${name(b)}）`;
      return `だれも押さなかった（${name(a)}・${name(b)}）`;
    };
    if (pair) card.append(vs(pair));
    else if (me !== null) card.insertAdjacentHTML('beforeend', '<div class="kj-word small">この回はお休み</div>');
    if (s.phase === 'act') {
      if (!pair) for (const x of s.pairs) card.append(vs(x));
      if (hidden) card.insertAdjacentHTML('beforeend', '<div class="kj-word small">ぽん…</div>');
      else card.append(timeBar(key, ACT_MS));
    } else {
      const list = document.createElement('div');
      list.className = 'tt-results';
      const order = pair ? [s.last.find((x) => x.pair.includes(me)), ...s.last.filter((x) => !x.pair.includes(me))] : s.last;
      for (const x of order) {
        const row = document.createElement('div');
        row.className = 'tt-res' + (pair && x.pair.includes(me) ? ' me' : '');
        const times = x.pair.map((p, i) => (x.acts[i] ? `${name(p)} ${x.acts[i].a === 'hit' ? '🔨' : '⛑️'} ${secText(x.acts[i].ms)}` : null)).filter(Boolean).join('　');
        row.textContent = resText(x);
        if (times) { const t = document.createElement('small'); t.textContent = times; row.append(t); }
        list.append(row);
      }
      card.append(list);
    }
    if (pair) {
      const can = s.phase === 'act' && !hidden && o.canMove && s.acts[me] === null && since(key) < ACT_MS;
      const pad = document.createElement('div');
      pad.className = 'tt-pad';
      const mine = s.acts[me];
      const btns = [['hit', '🔨', 'たたく'], ['cover', '⛑️', 'かぶる']].map(([a, icon, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `tt-act ${a}` + (mine?.a === a ? ' mine' : '');
        b.innerHTML = `<span>${icon}</span><small>${label}</small>`;
        b.disabled = !can;
        const hit = (e) => {
          if (!can || pad.dataset.sent) return;
          e.preventDefault();
          const ms = Math.round(since(key));
          if (ms >= ACT_MS) return;
          pad.dataset.sent = '1';
          btns.forEach((y) => { y.disabled = true; });
          b.classList.add('mine');
          o.onMove({ t: 'act', r: s.r, a, ms });
        };
        b.onpointerdown = hit; // 押した瞬間に測る
        b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したとき
        return b;
      });
      pad.append(...btns);
      wrap.append(pad);
      if (s.phase === 'act') {
        note.textContent = mine ? `押しました（${secText(mine.ms)}）` : (s.auto?.includes(me) ? '手はおまかせになりました。' : '') + '勝ったら たたく・負けたら かぶる・あいこは押さない';
        if (can) {
          setTimeout(() => {
            if (!pad.isConnected || pad.dataset.sent) return;
            btns.forEach((y) => { y.disabled = true; });
          }, Math.max(0, ACT_MS - since(key)));
        }
      }
    } else if (me === null) note.textContent = '観戦中';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    const name = (p) => (p === me ? 'あなた' : o.names?.[p] ?? '');
    s.log.forEach((rows, r) => {
      const x = (me !== null && rows.find((y) => y.pair.includes(me))) || rows[0];
      if (!x) return;
      const li = document.createElement('li');
      const [a, b] = x.pair;
      const mark = { hit: `🔨 ${name(x.by)}`, guard: `⛑️ ${name(x.by)}`, foul: `💥 ${name(x.by)} お手つき`, aiko: 'あいこ', none: '―' }[x.kind];
      li.innerHTML = `<span class="mk-rv-n">${r + 1}</span><span class="ox-rv">${esc(name(a))} ${FACE[x.hands[0]]} vs ${FACE[x.hands[1]]} ${esc(name(b))}</span><span class="mk-rv-who">${esc(mark)}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
