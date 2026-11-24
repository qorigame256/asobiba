// ひよこかぞえ。柵の中を動き回るひよこの数を、数字のボタンで打って早く答える。2〜10人・足りない分は CPU（弱め）。
// 2026-11-24 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。多いのはどっちに近いと伝えたうえで選ばれた。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 数字のボタンで数を打って答える（1問に1回だけ）。4つから選ぶ形にしない（当てずっぽうで当たるため）。ぴったり当てた人だけが速い順に 3・2・1点。
//   - ひよこの数は詳細設定「むずかしさ」で やさしい（3〜8羽）・ふつう（6〜15羽。最初）・むずかしい（10〜25羽）。
//   - ひよこは答えるまでずっと見えていて、動き回る（多いのはどっちは一瞬で消えるので、そこで違いを出す）。5問（詳細設定で 3・10問）。
// Claude の判断:
//   - 柵は横 100・縦 70。ひよこはそれぞれ決まった向きと速さでまっすぐ進み、柵で跳ね返る（置き場所・向き・速さは種から決める。位置は「画面に出てからの時間」だけで決まる）。
//     ひよこどうしは通り抜けて重なることがある（重なった所で数えまちがえるのも遊びのうち）。後ろの問題ほど少し速く動く（最後の問題で1.5倍）。
//   - 答えを見せるときは、ひよこを止めて1羽ずつ番号を付ける。
//   - 1問の制限時間は やさしい20秒・ふつう25秒・むずかしい35秒。だれかが正解したら8秒で締め切る（抜けた数さがしと同じ）。全員が答えたら1.5秒。答えを見せる間は3.5秒。
//   - CPU は 4秒〜制限時間の6割で答え、6割当てる（まちがえるときは1つ多いか少ない数）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（抜けた数さがしと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 打った数, ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[3, '3問'], [5, '5問'], [10, '10問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 5);
const LEVELS = [['easy', 'やさしい（3〜8羽）'], ['normal', 'ふつう（6〜15羽）'], ['hard', 'むずかしい（10〜25羽）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
export const RANGE = { easy: [3, 8], normal: [6, 15], hard: [10, 25] };
export const LIMITS = { easy: 20000, normal: 25000, hard: 35000 };
const SIZE = { easy: 10, normal: 9, hard: 7.5 }; // ひよこの大きさ（字の高さ）
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 8000;
const MAXLEN = 2;
const EDGE = 0.62; // 柵のふちから中心までの間（字の高さに対して。絵文字は字の高さより少し幅が広いので、半分より少し大きく）
export const W = 100;
export const H = 70;

// 1問を作る。chicks = [{ x, y, vx, vy }]（x・y は 0 秒の位置、vx・vy は1秒に進む長さ）、count = 羽数、size = 字の高さ
export function makeQuestion(seed, q, level, k) {
  const rnd = mulberry32((seed * 173 + q * 41 + 11) >>> 0);
  const [lo, hi] = RANGE[level] ?? RANGE.normal;
  const count = lo + Math.floor(rnd() * (hi - lo + 1));
  const size = SIZE[level] ?? SIZE.normal;
  const fast = 1 + 0.5 * (k > 1 ? q / (k - 1) : 0);
  const r = size * EDGE;
  const chicks = Array.from({ length: count }, () => {
    const a = rnd() * Math.PI * 2;
    const v = (7 + rnd() * 9) * fast;
    return {
      x: Math.round((r + rnd() * (W - 2 * r)) * 10) / 10,
      y: Math.round((r + rnd() * (H - 2 * r)) * 10) / 10,
      vx: Math.round(Math.cos(a) * v * 100) / 100,
      vy: Math.round(Math.sin(a) * v * 100) / 100,
    };
  });
  return { count, size, chicks };
}

// lo〜hi の間を行き来する（跳ね返る）位置と、いま進んでいる向き（+1 / -1）
function bounce(p, lo, hi) {
  const span = hi - lo;
  let m = (p - lo) % (2 * span);
  if (m < 0) m += 2 * span;
  return m <= span ? [lo + m, 1] : [lo + 2 * span - m, -1];
}
export function posAt(x, c, t) {
  const r = x.size * EDGE;
  const [px, dx] = bounce(c.x + c.vx * t, r, W - r);
  const [py] = bounce(c.y + c.vy * t, r, H - r);
  return { x: px, y: py, left: c.vx * dx < 0 };
}

const typed = new Map(); // 打ちかけ（qKey + 席 → 文字）。送らない
let keyHandler = null;
let keysHooked = false;
const qKey = (s, q = s.q) => `hiyoko:${s.seed}:${levelOf(s.rules)}:${s.qs.length}:${q}`; // むずかしさと問題の数も入れる（数のきまり当てと同じ理由）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const limitOf = (s) => LIMITS[levelOf(s.rules)];
const cpuPlan = new Map();
const frozen = new Map(); // 問題の鍵 → 答えを見せるときに止めた時刻（ms）

// 柵とひよこ。動いている間は画面の描き替えごとに位置を直す（止める時刻 freeze を渡すと、その時刻で止めて番号を付ける）
function fieldSvg(x, key, freeze) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'hy-fig');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', freeze === null ? '動き回るひよこ' : `ひよこ ${x.count}羽`);
  const els = x.chicks.map(() => {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('class', 'hy-c');
    t.setAttribute('font-size', x.size);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.textContent = '🐤';
    svg.append(t);
    return t;
  });
  const place = (sec) => {
    x.chicks.forEach((c, i) => {
      const p = posAt(x, c, sec);
      // 🐤 は左を向いた絵なので（Windows で確かめた。ほかの端末は未確認）、右へ進むときは左右を返す
      els[i].setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})${p.left ? '' : ' scale(-1 1)'}`);
    });
  };
  if (freeze !== null) {
    place(freeze / 1000);
    x.chicks.forEach((c, i) => {
      const p = posAt(x, c, freeze / 1000);
      const n = document.createElementNS(ns, 'text');
      n.setAttribute('class', 'hy-n');
      n.setAttribute('x', p.x.toFixed(2));
      // 番号はひよこの上に出す。柵の上のふちに近いひよこは下に出す（上に出すと柵の外で切れる）
      n.setAttribute('y', (p.y < x.size * 1.2 ? p.y + x.size * 0.85 : p.y - x.size * 0.55).toFixed(2));
      n.setAttribute('text-anchor', 'middle');
      n.textContent = i + 1;
      svg.append(n);
    });
    return svg;
  }
  const tick = () => {
    if (!svg.isConnected && svg.dataset.on) return;
    svg.dataset.on = '1';
    place(since(key) / 1000);
    requestAnimationFrame(tick);
  };
  tick();
  return svg;
}

export default {
  id: 'hiyoko',
  name: 'ひよこかぞえ',
  icon: '🐤',
  desc: '柵の中を動き回るひよこが何羽いるか、早く数えて答える',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: 'ひよこの数', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 5, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, level: 'normal', ...rules };
    const k = roundsOf(r);
    const qs = Array.from({ length: k }, (_, q) => makeQuestion(seed, q, levelOf(r), k));
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
    if (m.p !== me) return null; // ほかの人が答えた音は鳴らさない（色ちがい早押しと同じ）
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
      const limit = limitOf(s);
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limit, AFTER_MS, GRACE_MS), move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limit + GRACE_MS, move: { t: 'close' } };
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
        s.log = [...s0.log, { solved: s.solved.slice(), said: s.said.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= 10 ** MAXLEN || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === s.qs[s.q].count) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const limit = limitOf(s);
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const off = x.count <= 1 ? 1 : Math.random() < 0.5 ? -1 : 1;
      plan = { at: 4000 + Math.random() * (limit * 0.6 - 4000), c: Math.random() < 0.6 ? x.count : x.count + off };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limit ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? `<span class="pt-ng">× ${s.said[p]}</span>` : '<span class="pt-ng">―</span>';
    };
    keyHandler = null;
    root.innerHTML = '';
    root.className = 'board kj hy';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">動き回るひよこが何羽いるか、数を打とう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    const shown = s.phase !== 'open';
    const mine = me !== null ? s.said[me] : null;
    const tk = key + ':' + me;
    const head = document.createElement('div');
    head.className = 'nk-head';
    const ansBox = document.createElement('span');
    ansBox.className = 'sq-n q nk-ans' + (shown ? ' ans' : '');
    head.append(Object.assign(document.createElement('span'), { textContent: 'ひよこは' }), ansBox, Object.assign(document.createElement('span'), { textContent: '羽' }));
    card.append(head);
    // 答えを見せるときは、締め切った時刻あたりで止める（止める時刻は自分の画面に出てからの時間。制限時間より先には進めない）
    // 止める時刻は、答えを見せる場面で最初に描いたときの1回だけ取る（描き直しのたびに取ると、止まったひよこが動いて番号とずれる。2026-11-24 の Codex の点検）
    let freeze = null;
    if (shown) {
      if (!frozen.has(key)) frozen.set(key, Math.min(since(key), limit));
      if (frozen.size > 50) frozen.delete(frozen.keys().next().value);
      freeze = frozen.get(key);
    }
    card.append(fieldSvg(x, key, freeze));
    if (!shown) {
      since(key);
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`); // 行の場所はいつも空けておく（数のきまり当てと同じ）
      card.append(anySolved ? afterBar(key, limit, AFTER_MS) : timeBar(key, limit, { secs: true }));
    } else {
      ansBox.textContent = x.count;
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(t);
    }
    const can0 = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < limit;
    const pad = document.createElement('div');
    pad.className = 'az-pad nk-pad';
    const canNow = () => can0 && !pad.dataset.sent && since(key) < limit;
    const show = () => {
      if (!shown) {
        const v = mine !== null ? String(mine) : typed.get(tk) || '';
        ansBox.textContent = v || '？';
        ansBox.classList.toggle('typed', !!v);
        if (mine !== null) ansBox.classList.add(s.solved[me] !== null ? 'ok' : 'ng');
      }
      pad.querySelectorAll('button').forEach((b) => { b.disabled = !canNow(); });
    };
    const send = () => {
      const t = typed.get(tk);
      if (!canNow() || !t) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      pad.dataset.sent = '1';
      show();
      o.onMove({ t: 'ans', q: s.q, c: Number(t), ms });
    };
    const press = (k) => {
      if (!canNow()) return;
      const t = typed.get(tk) || '';
      if (k === 'del') typed.set(tk, t.slice(0, -1));
      else if (k === 'ok') { send(); return; }
      else if (t.length < MAXLEN) typed.set(tk, t === '0' ? k : t + k);
      if (typed.size > 100) typed.delete(typed.keys().next().value);
      show();
    };
    if (!shown) {
      for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'del', '0', 'ok']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'az-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : '');
        b.textContent = k === 'ok' ? '答える' : k === 'del' ? '⌫' : k;
        // 指が触れた瞬間に押したことにし、click はキーボードで押したとき（detail が 0）だけ使う（フラッシュ暗算と同じ。両方で数えると1回で2つ入る）
        b.onpointerdown = (e) => { if (e.button !== 0) return; e.preventDefault(); press(k); };
        b.onclick = (e) => { e.preventDefault(); if (e.detail === 0) press(k); };
        pad.append(b);
      }
      if (can0) {
        keyHandler = (e) => {
          if (!pad.isConnected) return;
          if (e.key >= '0' && e.key <= '9') press(e.key);
          else if (e.key === 'Backspace') press('del');
          else if (e.key === 'Enter') press('ok');
          else return;
          e.preventDefault();
        };
        // 読み込んだときでなく最初に描くときに1回だけ付ける（tools/test-logic.mjs は Node で読むので window が無い）
        if (!keysHooked) {
          keysHooked = true;
          window.addEventListener('keydown', (e) => {
            if (!keyHandler || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
            keyHandler(e);
          });
        }
      }
      show();
      wrap.append(pad);
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (shown) note.textContent = mine !== null ? `あなたの答え ${mine}羽${s.solved[me] !== null ? ' ⭕' : ' ❌'}` : '';
    else if (s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else note.textContent = '数を打って「答える」（答えられるのは1回だけ）';
    wrap.append(note);
    if (shown) wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (canNow()) {
      setTimeout(() => {
        if (!pad.isConnected || pad.dataset.sent) return;
        pad.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
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
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.said[me] !== null ? `❌ ${x.said[me]}羽` : '―';
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(`ひよこは ${g.count}羽`), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
