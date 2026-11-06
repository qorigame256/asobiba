// ニアピンクイズ。数で答える問題（高さ・長さ・年・数など）を出し、答えに一番近い人が点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-06 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 答えは数字のボタン（0〜9）で打つ（PC はキーボードでも）。
//   - 点は近い順に 3・2・1点、答えとぴったり同じならさらに +2点。同じ近さの人どうしは先に答えた人を上にする。
//   - 答えを見せるときは、数の目盛りの上に全員の答えと正解を並べる。
//   - 問題は Claude が書く（nearpin-data.js。100問ほど）。誤りに気づいたら本人が知らせる。10問。
// Claude の判断:
//   - 全員が答えられる（早い者勝ちではない）。答えは1問に1回だけ。答える時間は20秒。全員が答えたら1.5秒で締め切る。答えを見せる間は6秒。
//   - 4番目より遠い人は0点（ぴったりなら +2点だけはもらえる）。近さも速さも同じ人どうしは同じ順位で、同じ点。
//   - 打てるのは7桁まで（1から10までをかけた 3628800 が入るように）。
//   - 目盛りは、正解と全員の答えのいちばん小さい数からいちばん大きい数まで（同じなら正解の前後）。名前の札は重ならないよう段を分ける。
//   - CPU は4〜14秒で答える。年の問題は正解から最大140年ずれ、12以下の答えは最大3ずれ、ほかは正解の半分〜2倍くらいを、上から2桁の切りのよい数にする。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end（フラッシュ暗算と同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q: 何問目（0 から）, v: 答え, ms: 問題が出てから答えるまで }
//   q が今の問題と同じで、その人がまだ答えていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, SEAT_COLORS } from './party.js';
import { NEARPIN } from './nearpin-data.js';

export const ROUNDS = 10;
const LIMIT = 20000;
const READY_MS = 3000;
const SHOWN_MS = 6000;
const GRACE_MS = 1500;
const MAXLEN = 7;
const PTS = [3, 2, 1];
export const EXACT_BONUS = 2;

const qKey = (s, q = s.q) => `nearpin:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.slice() });
const fmt = (v) => Number(v).toLocaleString('ja-JP');
const unitOf = (i) => NEARPIN[i][2];
const withUnit = (v, i) => fmt(v) + (unitOf(i) ? ' ' + unitOf(i) : '');

// 1問ぶんの点。ans[p] = { v, ms } | null。近い順（同じ近さは速い順）に 3・2・1点、ぴったりなら +2点
export function nearPoints(ans, right) {
  return ans.map((a) => {
    if (!a) return 0;
    const d = Math.abs(a.v - right);
    const rank = ans.filter((b) => b && (Math.abs(b.v - right) < d || (Math.abs(b.v - right) === d && b.ms < a.ms))).length;
    return (PTS[rank] ?? 0) + (d === 0 ? EXACT_BONUS : 0);
  });
}
// いちばん近かった人たち（近さも速さも同じなら全員）
export function closestOf(ans, right) {
  const got = ans.map((a, p) => (a ? { p, d: Math.abs(a.v - right), ms: a.ms } : null)).filter(Boolean);
  if (!got.length) return [];
  const best = got.reduce((x, y) => (y.d < x.d || (y.d === x.d && y.ms < x.ms) ? y : x));
  return got.filter((x) => x.d === best.d && x.ms === best.ms).map((x) => x.p);
}

let keyHandler = null;
let keysHooked = false;
const typed = new Map(); // 打ちかけの答え（描き直しで消えないように）
const cpuPlan = new Map();

// CPU の答え（right の近くの切りのよい数）
function cpuGuess(i) {
  const [, right, unit] = NEARPIN[i];
  const r = Math.random;
  if (r() < 0.06) return right;
  let v;
  if (unit === '年') v = right + (r() * 2 - 1) * (10 + r() * 130);
  else if (right <= 12) v = right + Math.round((r() * 2 - 1) * 3);
  else v = right * Math.exp((r() + r() + r() - 1.5) * 0.7);
  v = Math.max(0, Math.round(v));
  if (unit !== '年' && v >= 100) { const k = 10 ** (Math.floor(Math.log10(v)) - 1); v = Math.round(v / k) * k; }
  return Math.min(v, 10 ** MAXLEN - 1);
}

export default {
  id: 'nearpin',
  name: 'ニアピンクイズ',
  icon: '📏',
  desc: '「富士山の高さは何m？」数で答えて、いちばん近い人が点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    const qs = shuffle([...NEARPIN.keys()], mulberry32(seed)).slice(0, ROUNDS);
    return { n, seed, qs, q: -1, phase: 'ready', ans: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return b.phase === 'end' ? null : 'question';
      return me >= 0 && b.last?.pts[me] > 0 ? 'correct' : null;
    }
    return m.p === me ? 'pop' : null; // ほかの人が答えた音は鳴らさない
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.ans.every((a) => a !== null)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
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
        s.ans = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const right = NEARPIN[s.qs[s.q]][1];
        const pts = nearPoints(s.ans, right);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const near = closestOf(s.ans, right);
        s.last = { pts, near };
        s.log = [...s0.log, { ans: s.ans.slice(), pts, near }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.ans[m.p] !== null) return null;
    if (!Number.isInteger(m.v) || m.v < 0 || m.v >= 10 ** MAXLEN) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.ans[m.p] = { v: m.v, ms: Math.round(m.ms) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.ans[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 4000 + Math.random() * 10000, v: cpuGuess(s.qs[s.q]) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, v: plan.v, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const i = s.q >= 0 && s.q < s.qs.length ? s.qs[s.q] : null;
    const extra = (p) => {
      if (s.phase === 'open') return s.ans[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const a = s.ans[p];
      if (!a) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return pt > 0 ? `<span class="pt-ok">${esc(fmt(a.v))} +${pt}</span>` : `<span class="pt-ng">${esc(fmt(a.v))}</span>`;
    };
    keyHandler = null;
    root.innerHTML = '';
    root.className = 'board kj nq';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">数で答える問題です。いちばん近い人が3点、ぴったりなら +2点・全${s.qs.length}問</div>`;
      return;
    }
    const [text, right, , note] = NEARPIN[i];
    const key = qKey(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="nq-q">${esc(text)}</div>`);
    if (s.phase === 'shown') {
      card.insertAdjacentHTML('beforeend', `<div class="nq-right">答え <b>${esc(withUnit(right, i))}</b></div>` + (note ? `<div class="kj-sub">${esc(note)}</div>` : ''));
      wrap.append(this.line(s, me, o));
      const t = document.createElement('p');
      t.className = 'cc-log';
      const near = s.last.near.map((p) => (p === me ? 'あなた' : o.names[p]));
      t.textContent = near.length ? `いちばん近かったのは ${near.join('・')}` : 'だれも答えませんでした';
      wrap.append(t);
      return;
    }
    since(key);
    const mine = me !== null ? s.ans[me] : null;
    const tk = key + ':' + me;
    const big = document.createElement('div');
    big.className = 'nq-big';
    card.append(big);
    card.append(timeBar(key, LIMIT, { secs: true }));
    const pad = document.createElement('div');
    pad.className = 'az-pad';
    const canNow = () => me !== null && o.canMove && mine === null && since(key) < LIMIT;
    const show = () => {
      const v = mine ? String(mine.v) : typed.get(tk) || '';
      big.innerHTML = v ? `${esc(fmt(v))}<small>${esc(unitOf(i))}</small>` : `？<small>${esc(unitOf(i))}</small>`;
      big.classList.toggle('ask', !v);
      pad.querySelectorAll('button').forEach((b) => { b.disabled = !canNow(); });
    };
    const send = () => {
      const t = typed.get(tk);
      if (!canNow() || !t || pad.dataset.sent) return;
      pad.dataset.sent = '1';
      pad.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      o.onMove({ t: 'ans', q: s.q, v: Number(t), ms: Math.round(since(key)) });
    };
    const press = (k) => {
      if (!canNow() || pad.dataset.sent) return;
      const t = typed.get(tk) || '';
      if (k === 'del') typed.set(tk, t.slice(0, -1));
      else if (k === 'ok') { send(); return; }
      else if (t.length < MAXLEN) typed.set(tk, t === '0' ? k : t + k);
      if (typed.size > 100) typed.delete(typed.keys().next().value);
      show();
    };
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
    if (me !== null && mine === null) {
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
    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (me === null) msg.textContent = '観戦中';
    else if (mine) msg.textContent = `✔ 答えました（${secText(mine.ms)}）。ほかの人を待っています`;
    else msg.textContent = '数字を打って「答える」（答えられるのは1回だけ）';
    wrap.append(msg);
    if (canNow()) {
      setTimeout(() => {
        if (!pad.isConnected || pad.dataset.sent) return;
        pad.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        msg.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
    }
  },

  // 数の目盛り: 正解と全員の答えを並べる
  line(s, me, o) {
    const i = s.qs[s.q];
    const right = NEARPIN[i][1];
    const got = s.ans.map((a, p) => (a ? { p, v: a.v } : null)).filter(Boolean);
    const vals = [right, ...got.map((x) => x.v)];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { const d = Math.max(1, Math.round(Math.abs(right) * 0.1)); lo = Math.max(0, right - d); hi = right + d; }
    const pct = (v) => 4 + (92 * (v - lo)) / (hi - lo);
    const box = document.createElement('div');
    box.className = 'nq-line';
    const axis = document.createElement('div');
    axis.className = 'nq-axis';
    axis.innerHTML = `<span class="nq-end l">${esc(fmt(lo))}</span><span class="nq-end r">${esc(fmt(hi))}</span>`;
    const star = document.createElement('div');
    star.className = 'nq-star';
    star.style.left = pct(right) + '%';
    star.style.setProperty('--t', `-${pct(right)}%`);
    star.innerHTML = `<span>★ ${esc(fmt(right))}</span>`;
    axis.append(star);
    box.append(axis);
    // 名前の札: 左から順に、前の札と近すぎない段へ置く
    const rows = [];
    const marks = document.createElement('div');
    marks.className = 'nq-marks';
    got.sort((a, b) => a.v - b.v || a.p - b.p).forEach((x) => {
      const at = pct(x.v);
      let row = rows.findIndex((last) => at - last >= 24);
      if (row < 0) { rows.push(at); row = rows.length - 1; } else rows[row] = at;
      const m = document.createElement('div');
      m.className = 'nq-mark' + (x.p === me ? ' me' : '') + (s.last.near.includes(x.p) ? ' near' : '');
      m.style.left = at + '%';
      m.style.top = row * 2.6 + 'rem';
      m.style.setProperty('--t', `-${at}%`);
      m.style.setProperty('--c', SEAT_COLORS[x.p % SEAT_COLORS.length]);
      const name = document.createElement('span');
      name.className = 'nq-name';
      name.textContent = x.p === me ? 'あなた' : o.names[x.p];
      const val = document.createElement('b');
      val.textContent = fmt(x.v);
      m.append(name, val);
      marks.append(m);
      // 目盛りの上の点
      const dot = document.createElement('i');
      dot.className = 'nq-dot';
      dot.style.left = at + '%';
      dot.style.setProperty('--c', SEAT_COLORS[x.p % SEAT_COLORS.length]);
      axis.append(dot);
    });
    marks.style.height = Math.max(1, rows.length) * 2.6 + 'rem';
    box.append(marks);
    return box;
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const smy = document.createElement('summary');
    smy.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const i = s.qs[q];
      const li = document.createElement('li');
      const mine = me === null ? '' : x.ans[me] ? `${fmt(x.ans[me].v)}${x.pts[me] ? ` +${x.pts[me]}` : ''}` : '―';
      const near = x.near.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="nq-rv">${esc(NEARPIN[i][0])} <b>${esc(withUnit(NEARPIN[i][1], i))}</b></span><span>${esc(mine)}</span>`;
      const who = document.createElement('span');
      who.className = 'mk-rv-who';
      who.textContent = near.length ? '🎯' + near.join('・') : '―';
      li.append(who);
      list.append(li);
    });
    box.append(smy, list);
    return box;
  },
};
