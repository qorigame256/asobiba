// 多いのはどっち。左右の箱に点が一瞬だけ出るので、点が多かった方の箱を押す。2〜10人・足りない分は CPU。
// 2026-11-09 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 左右の点は約0.7秒で消える（数えさせず、ぱっと見て決める遊び）。
//   - 10問（詳細設定で 5・10・20問）。正解した速い順に 3・2・1点。まちがえたらその問題はもう押せないが、点は減らない（色ちがい早押しと同じ）。
//   - 後半ほど左右の数が近くなる。
// Claude の判断:
//   - 多い方の点は 10〜25個。差は 1問目が多い方の45%、最後の問題が12%（間は問題の番号で一定の割合で縮める。差は少なくとも1個）。
//   - 点の大きさは左右とも同じ幅の中でばらばらにする（大きさの合計で見分けられないように）。点どうしは重ならない。
//   - 1問の制限時間は4秒（点が出てから）。全員が答えたら0.8秒で締め切る。結果を見せる間は2秒（左右の点と数を出し直す）。
//   - 速さは各自の画面に点が出てから押すまで（ms）。
//   - CPU は0.8〜1.8秒で押し、差が大きいほどよく当てる（1問目でおよそ9割、最後の問題でおよそ7割）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 0（左）| 1（右）, ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
export const FLASH_MS = 700;
export const LIMIT = 4000;
const READY_MS = 3000;
const SHOWN_MS = 2000;
const GRACE_MS = 800;
const R_MIN = 0.035;
const R_MAX = 0.06;

// 問題の番号 q（0から）・問題の数 k での、差の割合（多い方に対して）
export const ratioOf = (q, k) => 0.45 - 0.33 * (k > 1 ? q / (k - 1) : 0);

// 箱の中に cnt 個の点を重ならないように置く（箱は 0〜1 の正方形）
function placeDots(cnt, rnd) {
  const dots = [];
  for (let i = 0; i < cnt; i++) {
    let d = null;
    for (let t = 0; t < 400 && !d; t++) {
      const r = R_MIN + rnd() * (R_MAX - R_MIN);
      const x = r + 0.02 + rnd() * (1 - 2 * r - 0.04);
      const y = r + 0.02 + rnd() * (1 - 2 * r - 0.04);
      if (dots.every((e) => Math.hypot(e.x - x, e.y - y) > e.r + r + 0.012)) d = { x, y, r };
    }
    if (!d) d = { x: 0.5, y: 0.5, r: R_MIN }; // まず起きない（置ける場所は十分ある）
    dots.push(d);
  }
  return dots.map((e) => ({ x: +e.x.toFixed(3), y: +e.y.toFixed(3), r: +e.r.toFixed(3) }));
}

export function makeQuestions(k, seed) {
  const rnd = mulberry32(seed);
  return Array.from({ length: k }, (_, q) => {
    const big = 10 + Math.floor(rnd() * 16);
    const diff = Math.max(1, Math.round(big * ratioOf(q, k)));
    const side = rnd() < 0.5 ? 0 : 1; // 多い方（0 = 左・1 = 右）
    const counts = side === 0 ? [big, big - diff] : [big - diff, big];
    return { counts, side, dots: counts.map((c) => placeDots(c, rnd)) };
  });
}

const qKey = (s, q = s.q) => `ooi:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

function dotsSvg(dots) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 1 1');
  svg.setAttribute('class', 'oi-dots');
  for (const d of dots) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', d.x);
    c.setAttribute('cy', d.y);
    c.setAttribute('r', d.r);
    svg.append(c);
  }
  return svg;
}

export default {
  id: 'ooi',
  name: '多いのはどっち',
  icon: '⚖️',
  desc: '左右に点が一瞬だけ出る。多かった方を早く押すほど高い点',
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
      n, seed, rules: r, qs: makeQuestions(roundsOf(r), seed), q: -1, phase: 'ready',
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
    if ((m.c !== 0 && m.c !== 1) || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.c === s.qs[s.q].side) s.solved[m.p] = Math.round(m.ms);
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
      const ok = Math.random() < 0.62 + 0.62 * ratioOf(s.q, s.qs.length);
      plan = { at: 800 + Math.random() * 1000, c: ok ? x.side : 1 - x.side };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
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
    root.className = 'board kj oi';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">点が多かった方を押そう・点は一瞬で消えます・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="ir-ask">点が多いのはどっち？</div>`);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `正解は「${x.side ? '右' : '左'}」（${x.counts[0]} 対 ${x.counts[1]}）${fast ? `・いちばん速かったのは ${fast}` : '・だれも正解できませんでした'}`;
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const showDots = s.phase !== 'open' || since(key) < FLASH_MS;
    const pad = document.createElement('div');
    pad.className = 'oi-pad';
    const boxes = [0, 1].map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'oi-box' + (s.phase === 'shown' && c === x.side ? ' ans' : '');
      b.setAttribute('aria-label', c ? '右の箱' : '左の箱');
      b.disabled = !can;
      if (showDots) b.append(dotsSvg(x.dots[c]));
      else b.insertAdjacentHTML('beforeend', '<span class="oi-q">？</span>');
      if (s.phase === 'shown') { // 答えのときだけ数を添える（問題の間は点に重ならないよう出さない）
        const label = document.createElement('span');
        label.className = 'oi-lab';
        label.textContent = `${x.counts[c]}個`;
        b.append(label);
      }
      const hit = (e) => {
        if (!can || b.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        pad.querySelectorAll('button').forEach((y) => { y.disabled = true; y.dataset.sent = '1'; });
        b.classList.add('picked');
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る（指を離すまで待たない）
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したときだけ（指では pointerdown で数えたので2回目にしない）
      pad.append(b);
      return b;
    });
    wrap.append(pad);
    // 点を約0.7秒で消す（描き直しが無くても消えるように、残りの時間で予約する）
    if (s.phase === 'open' && showDots) {
      setTimeout(() => {
        boxes.forEach((b) => {
          const svg = b.querySelector('.oi-dots');
          if (svg) svg.replaceWith(Object.assign(document.createElement('span'), { className: 'oi-q', textContent: '？' }));
        });
      }, Math.max(0, FLASH_MS - since(key)));
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = 'PC は ← → キーでも押せます';
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
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${qq.counts[0]} 対 ${qq.counts[1]}（${qq.side ? '右' : '左'}）</span><span>${mine}</span>`;
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

// PC の ← → キーで押す（対局の画面に多いのはどっちの箱が出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.target?.closest?.('input, textarea, select')) return;
    const boxes = document.querySelectorAll('.board.oi .oi-box');
    if (boxes.length !== 2) return;
    const b = boxes[e.key === 'ArrowLeft' ? 0 : 1];
    if (b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
