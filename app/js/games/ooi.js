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
// 2026-11-09 の37回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「あまのじゃく」（鍵は rev。色ちがい早押しと同じ名前と数え方）: なし（最初）・あり。ありでは問題の3割（5問で2・10問で3・20問で6。種から選び、1問目はふつう）が
//     「👿 点が少ないのは？」になり、少ない方を押す。おまかせで抽選してよい（色ちがい早押しの rev と同じ）。
//   - 詳細設定「点の見える時間」（鍵は flash）: 0.4秒・0.7秒（最初）・1.0秒。難しさの好みなので、おまかせでは抽選しない（main.js の KEEP_KEYS）。
//   - 詳細設定「箱の数」（鍵は boxes）: 2つ（最初）・3つ。3つでは「いちばん多い（少ない）箱」を押す。答えの数なので抽選しない（シルエットクイズの答えの数と同じ）。
//     3つのとき、答えの箱ととなりの数の箱の差は2つのときと同じ。残りの1箱は、答えから見てとなりの箱と同じ側に、さらに 0〜差 だけ離す
//     （多い方を押す問題なら 3個以上、少ない方を押す問題なら 25個まで）。並びは種でまぜる。
//   - あまのじゃくの選び方・3つ目の箱・並びは、もとの乱数とは別の乱数（種を変えたもの）で決める（設定を変えないときの問題が前と同じになるように）。
//   - CPU は、あまのじゃくの問題で8%、箱が3つで5%当てにくくする（まちがえるときは、ほかの箱から1つ選ぶ）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 箱の番号（左から 0・1・(2)）, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const FLASHES = [[400, '0.4秒'], [700, '0.7秒'], [1000, '1.0秒']];
export const FLASH_MS = 700;
export const flashOf = (r) => (FLASHES.some(([v]) => v === Number(r?.flash)) ? Number(r.flash) : FLASH_MS);
const BOXES = [[2, '2つ'], [3, '3つ']];
export const boxesOf = (r) => (Number(r?.boxes) === 3 ? 3 : 2);
export const revOf = (k) => Math.round((k * 3) / 10); // あまのじゃくの問題の数（色ちがい早押しと同じ）
const SIDE_NAMES = [['左', '右'], ['左', 'まんなか', '右']];
const sideName = (x, c) => SIDE_NAMES[x.counts.length - 2][c];
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

// side = 押す箱の番号。rev = 少ない方を押す問題
export function makeQuestions(k, seed, { rev = false, boxes = 2 } = {}) {
  const rnd = mulberry32(seed);
  const rnd2 = mulberry32((seed ^ 0x2545f491) >>> 0); // 設定で足した分だけに使う
  const revSet = new Set(rev ? shuffle([...Array(k).keys()].slice(1), rnd2).slice(0, revOf(k)) : []); // 1問目はふつう
  return Array.from({ length: k }, (_, q) => {
    const big = 10 + Math.floor(rnd() * 16);
    const diff = Math.max(1, Math.round(big * ratioOf(q, k)));
    const pos = rnd() < 0.5 ? 0 : 1; // 2つのとき、多い方の箱（0 = 左・1 = 右）
    const isRev = revSet.has(q);
    let counts;
    let side;
    if (boxes === 3) {
      const r = Math.floor(rnd2() * (diff + 1));
      const third = isRev ? Math.min(25, big + r) : Math.max(3, big - diff - r);
      const vals = [big, big - diff, third];
      const perm = shuffle([0, 1, 2], rnd2); // perm[箱] = vals の何番目を入れるか
      counts = perm.map((i) => vals[i]);
      side = perm.indexOf(isRev ? 1 : 0);
    } else {
      counts = pos === 0 ? [big, big - diff] : [big - diff, big];
      side = isRev ? 1 - pos : pos;
    }
    return { counts, side, rev: isRev, dots: counts.map((c) => placeDots(c, rnd)) };
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
    { key: 'flash', label: '点の見える時間', desc: '点が出てから消えるまで。長いほどやさしい', def: FLASH_MS, choices: FLASHES },
    { key: 'boxes', label: '箱の数', desc: '3つでは、いちばん多い箱を押す', def: 2, choices: BOXES },
    { key: 'rev', label: 'あまのじゃく', desc: 'ときどき「点が少ない方」を押す問題が混じる', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, flash: FLASH_MS, boxes: 2, rev: false, ...rules };
    return {
      n, seed, rules: r, qs: makeQuestions(roundsOf(r), seed, { rev: !!r.rev, boxes: boxesOf(r) }), q: -1, phase: 'ready',
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
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= s0.qs[s0.q].counts.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
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
      const ok = Math.random() < 0.62 + 0.62 * ratioOf(s.q, s.qs.length) - (x.rev ? 0.08 : 0) - (x.counts.length === 3 ? 0.05 : 0);
      const others = x.counts.map((_, c) => c).filter((c) => c !== x.side);
      plan = { at: 800 + Math.random() * 1000, c: ok ? x.side : others[Math.floor(Math.random() * others.length)] };
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">点が${s.qs[0].counts.length === 3 ? 'いちばん多い箱' : '多かった方'}を押そう・点は一瞬で消えます・全${s.qs.length}問${s.rules.rev ? '・👿 の問題は点が少ない方' : ''}</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="ir-ask${x.rev ? ' rev' : ''}">${x.rev ? '👿 点が「少ない」のは' : '点が多いのは'}${x.counts.length === 3 ? 'どれ' : 'どっち'}？</div>`);
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = `正解は「${sideName(x, x.side)}」（${x.counts.join(' 対 ')}）${fast ? `・いちばん速かったのは ${fast}` : '・だれも正解できませんでした'}`;
      card.append(t);
    }
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const flash = flashOf(s.rules);
    const showDots = s.phase !== 'open' || since(key) < flash;
    const pad = document.createElement('div');
    pad.className = 'oi-pad' + (x.counts.length === 3 ? ' three' : '');
    const boxes = x.counts.map((_, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'oi-box' + (s.phase === 'shown' && c === x.side ? ' ans' : '');
      b.setAttribute('aria-label', `${sideName(x, c)}の箱`);
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
    // 点を「点の見える時間」（最初は約0.7秒）で消す（描き直しが無くても消えるように、残りの時間で予約する）
    if (s.phase === 'open' && showDots) {
      setTimeout(() => {
        boxes.forEach((b) => {
          const svg = b.querySelector('.oi-dots');
          if (svg) svg.replaceWith(Object.assign(document.createElement('span'), { className: 'oi-q', textContent: '？' }));
        });
      }, Math.max(0, flash - since(key)));
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = x.counts.length === 3 ? 'PC は ← ↓ → キーでも押せます' : 'PC は ← → キーでも押せます';
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
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${qq.counts.join(' 対 ')}（${sideName(qq, qq.side)}）${qq.rev ? '👿' : ''}</span><span>${mine}</span>`;
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

// PC の ← → キー（箱が3つのときは ↓ も。↓ がまんなか）で押す（対局の画面に多いのはどっちの箱が出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowDown') return;
    if (e.target?.closest?.('input, textarea, select')) return;
    const boxes = document.querySelectorAll('.board.oi .oi-box');
    if (boxes.length !== 2 && boxes.length !== 3) return;
    if (e.key === 'ArrowDown' && boxes.length !== 3) return;
    const b = boxes[e.key === 'ArrowLeft' ? 0 : e.key === 'ArrowRight' ? boxes.length - 1 : 1];
    if (b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
