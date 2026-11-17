// マッチ棒パズル早解き。マッチ棒で作ったまちがった式を、1本だけ動かして正しい式にする。早く解いた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-17 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおり」）:
//   - いつも1本だけ動かす。動かし方は、抜く棒を押してから置く場所を押す（スマホで細い棒を運ぶのは難しいため）。
//   - 式に使う記号は ＋・−・＝ だけ（×は使わない）。
//   - 10問、1問ごとに解いた速い順に 3点・2点・それ以降は1点（時計あわせと同じ形）。
// Claude の判断:
//   - 数字はデジタル時計と同じ7本の形（0〜9。1 は右の2本）。＝ と − の横の棒は動かせない。＋ のたての棒は動かせ、− にたての棒を置くと ＋ になる。
//   - 2けた以上の数の先頭に 0 は置けない（「07」は数字にならない）。答えの数がマイナスになる式も正しくない。
//   - 問題はその場で種から作る: 正しい式から1本動かして、数字の形がどれも正しいまちがった式にする。正しい式に戻す動かし方が3通り以上ある問題は出さない。
//     正しい式になれば、作ったときと別の動かし方でも正解（apply が式を確かめる）。
//   - 1〜4問目は 1けた＋1けた＝1けた、5〜7問目は どこか1つが2けた、8〜10問目は 2つが2けた（だんだん長くする）。
//   - 1本動かして正しくなかったら、その場で「ちがう」と出すだけ（点は減らない。もう一度ほかの棒を押すと、動かした棒は元に戻る）。
//   - 制限時間は1問 45秒。最初に解いた人が出てから10秒で締め切る（制限時間のほうが先なら制限時間で）。全員解いたら1.5秒。
//   - CPU は 1問 7〜20秒（2けたの入る問題は＋4秒）で解き、5回に1回ほど解けない。どちらも種から決める。
//   - 結果の間は、正しい式にする動かし方を1つ見せる（抜いた所を赤い点線、置いた所を緑で光らせる）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（時計あわせと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, ms, mv: [抜いた場所, 置いた場所] }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 10000;
const LIMIT = 45000;
const MIN_MS = 800;
const ROUNDS = 10;

// 7本の棒（a 上・b 右上・c 右下・d 下・e 左下・f 左上・g まん中）の並びの印。bit i が i 番目の棒
export const DIGITS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg']
  .map((w) => [...w].reduce((m, ch) => m | (1 << 'abcdefg'.indexOf(ch)), 0));
const digitOf = (mask) => { const d = DIGITS.indexOf(mask); return d >= 0 ? d : null; };

// 式の並び（d = 数字、o = ＋か−、= = 等号）。例 'do d=d'（空白なし）
// 棒の場所の番号: 数字ごとに7つ（並びの順）、＋−の所にたての棒1つ
export function slotsOf(lay) {
  const out = [];
  [...lay].forEach((ch, t) => {
    if (ch === 'd') for (let k = 0; k < 7; k++) out.push({ t, k });
    else if (ch === 'o') out.push({ t, k: 7 });
  });
  return out;
}

// 棒の有る無し（0/1 の配列）から式を読む → { nums: [a, b, c] | null（読めない数字がある）, op: '+' | '-', text: 画面の文字 }
export function readEq(lay, on) {
  const slots = slotsOf(lay);
  const masks = {};
  let op = '-';
  slots.forEach((x, i) => {
    if (!on[i]) return;
    if (x.k === 7) op = '+';
    else masks[x.t] = (masks[x.t] ?? 0) | (1 << x.k);
  });
  const groups = [[]];
  let text = '';
  let ok = true;
  [...lay].forEach((ch, t) => {
    if (ch === 'd') {
      const d = digitOf(masks[t] ?? 0);
      if (d === null) ok = false;
      groups[groups.length - 1].push(d);
      text += d === null ? '？' : String(d);
    } else {
      groups.push([]);
      text += ch === 'o' ? (op === '+' ? '＋' : '−') : '＝';
    }
  });
  if (!ok) return { nums: null, op, text };
  // 2けた以上の先頭の 0 は数字にならない
  if (groups.some((g) => g.length > 1 && g[0] === 0)) return { nums: null, op, text };
  return { nums: groups.map((g) => g.reduce((a, d) => a * 10 + d, 0)), op, text };
}
export function isTrue(lay, on) {
  const { nums, op } = readEq(lay, on);
  if (!nums) return false;
  const [a, b, c] = nums;
  return op === '+' ? a + b === c : a - b === c;
}
// 1本動かした後の棒（動かせないときは null）
export function moved(on, mv) {
  if (!Array.isArray(mv) || mv.length !== 2) return null;
  const [f, t] = mv;
  if (!Number.isInteger(f) || !Number.isInteger(t) || f === t || !on[f] || on[t] !== 0) return null;
  const x = on.slice();
  x[f] = 0;
  x[t] = 1;
  return x;
}
// 正しい式にする動かし方の一覧（同じ式になるものは1つにまとめる）
export function solutions(lay, on) {
  const seen = new Map();
  for (let f = 0; f < on.length; f++) {
    if (!on[f]) continue;
    for (let t = 0; t < on.length; t++) {
      const x = moved(on, [f, t]);
      if (!x || !isTrue(lay, x)) continue;
      const key = x.join('');
      if (!seen.has(key)) seen.set(key, [f, t]);
    }
  }
  return [...seen.values()];
}

// 正しい式の棒を作る
function barsOf(lay, nums, op) {
  const ds = nums.flatMap((v, i) => String(v).padStart(lay.split(/[o=]/)[i].length, '0').split('').map(Number));
  const on = [];
  let di = 0;
  for (const ch of lay) {
    if (ch === 'd') { const m = DIGITS[ds[di++]]; for (let k = 0; k < 7; k++) on.push((m >> k) & 1); }
    else if (ch === 'o') on.push(op === '+' ? 1 : 0);
  }
  return on;
}
const LAYS = [['dod=d'], ['ddod=dd', 'dod=dd', 'ddod=d'], ['ddodd=dd', 'ddod=dd', 'ddodd=d']];
const layFor = (q, rnd) => { const g = LAYS[q < 4 ? 0 : q < 7 ? 1 : 2]; return g[Math.floor(rnd() * g.length)]; };
const lens = (lay) => lay.split(/[o=]/).map((x) => x.length);
const fits = (v, n) => String(v).length === n;

// 1問作る。作れなければ null（種を進めてやり直す）
function makeOne(lay, rnd, used) {
  const [la, lb, lc] = lens(lay);
  const rand = (n) => (n === 1 ? Math.floor(rnd() * 10) : 10 + Math.floor(rnd() * 90));
  for (let k = 0; k < 60; k++) {
    const op = rnd() < 0.5 ? '+' : '-';
    const a = rand(la), b = rand(lb);
    const c = op === '+' ? a + b : a - b;
    if (c < 0 || !fits(c, lc)) continue;
    const good = barsOf(lay, [a, b, c], op);
    // 1本動かして、数字の形は正しいのに式がまちがっているもの
    const cands = [];
    for (let f = 0; f < good.length; f++) {
      if (!good[f]) continue;
      for (let t = 0; t < good.length; t++) {
        const x = moved(good, [f, t]);
        if (!x || !readEq(lay, x).nums || isTrue(lay, x)) continue;
        cands.push(x);
      }
    }
    while (cands.length) {
      const x = cands.splice(Math.floor(rnd() * cands.length), 1)[0];
      const sol = solutions(lay, x);
      const key = lay + x.join('');
      if (!sol.length || sol.length > 2 || used.has(key)) continue;
      used.add(key);
      return { lay, on: x, sol: sol[0], ans: readEq(lay, moved(x, sol[0])).text };
    }
  }
  return null;
}
export function makeQuestions(seed, n = ROUNDS) {
  const rnd = mulberry32(seed);
  const used = new Set();
  const qs = [];
  for (let q = 0; q < n; q++) {
    let x = null;
    for (let k = 0; !x && k < 20; k++) x = makeOne(layFor(q, rnd), rnd, used);
    qs.push(x ?? makeOne('dod=d', rnd, used));
  }
  return qs;
}

const qKey = (s, q = s.q) => `matchbo:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice() });
const doneOf = (s, p) => s.solved[p] !== null;
const longOf = (Q) => Q.lay.length > 5;

// CPU が解き終える時刻（ms）。null は解けない回。種・何問目・席から決めるので全員の端末で同じ
export function cpuTime(s, q, p) {
  const rnd = mulberry32((s.seed * 41 + q * 13 + p * 1019 + 5531) >>> 0);
  if (rnd() < 0.2) return null;
  return Math.round(7000 + rnd() * 13000 + (longOf(s.qs[q]) ? 4000 : 0));
}

let loc = null; // この端末の盤 { key, mv: [抜いた, 置いた] | null, sel: 選んでいる棒 | null, sent, bad }

export default {
  id: 'matchbo',
  name: 'マッチ棒パズル早解き',
  icon: '🔥',
  desc: 'マッチ棒を1本だけ動かして、まちがった式を正しくする。早く解くほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, rules: {}, qs: makeQuestions(seed), q: -1, phase: 'ready', solved: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.pts[me] > 0 ? 'correct' : 'pop';
    return m.p === me ? 'goal' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), LIMIT, AFTER_MS, GRACE_MS), move: { t: 'close' } };
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
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'done' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= MIN_MS) || m.ms > LIMIT + 500) return null;
    const Q = s0.qs[s0.q];
    const x = moved(Q.on, m.mv);
    if (!x || !isTrue(Q.lay, x)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const end = cpuTime(s, s.q, p);
    if (end === null || end >= LIMIT) return null;
    const t = since(qKey(s));
    return t >= end ? { t: 'done', q: s.q, ms: Math.max(end, Math.round(t)), mv: s.qs[s.q].sol } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const key = qKey(s);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">とけた！</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj mb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">マッチ棒を1本だけ動かして、正しい式にしよう・全${s.qs.length}問・1問 ${LIMIT / 1000}秒まで</div>`;
      return;
    }
    const Q = s.qs[s.q];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが解いた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, LIMIT, AFTER_MS));
      } else card.append(timeBar(key, LIMIT, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも解けませんでした';
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, mv: null, sel: null, sent: false, bad: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const board = document.createElement('div');
    board.className = 'mb-board';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'mb-undo';
    undo.textContent = '↩ もとに戻す';
    const paint = () => {
      const shown = s.phase === 'shown';
      const mv = shown ? Q.sol : me === null ? null : loc.mv;
      const on = mv ? moved(Q.on, mv) : Q.on;
      board.replaceChildren(drawEq(Q.lay, on, {
        sel: playing ? loc.sel : null, from: mv?.[0] ?? null, to: mv?.[1] ?? null, answer: shown, live: playing,
        onTap: playing ? tap : null,
      }));
      board.classList.toggle('bad', playing && loc.bad);
      undo.hidden = !playing;
      undo.disabled = !loc.mv && loc.sel === null;
      note.textContent = shown ? `正解の一例: ${Q.ans}` : me === null ? '観戦中'
        : doneOf(s, me) || loc.sent ? `とけた！（${doneOf(s, me) ? secText(s.solved[me]) : '…'}）ほかの人を待っています`
        : loc.bad ? 'ちがう… ほかの棒を押すと、動かした棒は元に戻ります'
        : loc.sel !== null ? '置く場所（点線）を押そう'
        : '動かす棒を1本押そう（＝ は動かせない）';
    };
    const tap = (i, isOn) => {
      if (!playing || loc.sent) return;
      const home = loc.mv ? moved(Q.on, loc.mv) : Q.on;
      if (isOn) {
        if (loc.sel === i) { loc.sel = null; paint(); return; }
        // 動かした棒でない棒を選んだら、動かした棒は元に戻す（いつも1本だけ）
        if (loc.mv && i !== loc.mv[1]) loc.mv = null;
        if (!(loc.mv ? moved(Q.on, loc.mv) : Q.on)[i]) return;
        loc.sel = i;
        loc.bad = false;
        play('chip', 0.15);
        paint();
        return;
      }
      if (loc.sel === null || home[i]) return;
      const from = loc.mv && loc.sel === loc.mv[1] ? loc.mv[0] : loc.sel;
      loc.sel = null;
      loc.mv = from === i ? null : [from, i];
      loc.bad = false;
      if (loc.mv && isTrue(Q.lay, moved(Q.on, loc.mv))) {
        const ms = Math.round(since(key));
        if (ms < LIMIT) {
          loc.sent = true;
          o.onMove({ t: 'done', q: s.q, ms: Math.max(ms, MIN_MS), mv: loc.mv });
        }
      } else if (loc.mv) {
        loc.bad = true;
        play('wrong', 0.5);
      } else play('chip', 0.15);
      paint();
    };
    undo.onclick = () => { if (!playing) return; loc.mv = null; loc.sel = null; loc.bad = false; paint(); };
    wrap.append(board, undo, note);
    paint();
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      const Q = s.qs[q];
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${readEq(Q.lay, Q.on).text} → ${Q.ans}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

/* ---------- 絵 ---------- */
const NS = 'http://www.w3.org/2000/svg';
const DW = 44; // 数字の幅
const OW = 40; // 記号の幅
const H = 80;
// 数字の7本の両端（数字の左上からの位置）
const SEG = [
  [[9, 6], [35, 6]], [[38, 9], [38, 37]], [[38, 43], [38, 71]], [[9, 74], [35, 74]],
  [[6, 43], [6, 71]], [[6, 9], [6, 37]], [[9, 40], [35, 40]],
];
// 棒の場所ごとの両端（全体の中の位置）と、動かせない棒（＝ と − の横の棒）
function geometry(lay) {
  const sticks = [];
  const fixed = [];
  let x = 0;
  [...lay].forEach((ch, t) => {
    if (ch === 'd') {
      for (let k = 0; k < 7; k++) sticks.push(SEG[k].map(([a, b]) => [x + a, b]));
      x += DW;
    } else if (ch === 'o') {
      fixed.push([[x + 7, 40], [x + 33, 40]]);
      sticks.push([[x + 20, 27], [x + 20, 53]]);
      x += OW;
    } else {
      fixed.push([[x + 7, 33], [x + 33, 33]], [[x + 7, 47], [x + 33, 47]]);
      x += OW;
    }
  });
  return { sticks, fixed, w: x };
}
function stickEl([[x1, y1], [x2, y2]], cls) {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', cls);
  const ln = (c, w) => { const e = document.createElementNS(NS, 'line'); e.setAttribute('x1', x1); e.setAttribute('y1', y1); e.setAttribute('x2', x2); e.setAttribute('y2', y2); e.setAttribute('class', c); if (w) e.setAttribute('stroke-width', w); return e; };
  g.append(ln('mb-stick'));
  const head = document.createElementNS(NS, 'circle');
  // 頭はたての棒は上、横の棒は左
  const hx = x1 === x2 ? x1 : Math.min(x1, x2), hy = x1 === x2 ? Math.min(y1, y2) : y1;
  head.setAttribute('cx', hx);
  head.setAttribute('cy', hy);
  head.setAttribute('r', 3.6);
  head.setAttribute('class', 'mb-head');
  g.append(head);
  return { g, ln };
}
// 式の絵。opts: { sel, from, to, answer, live, onTap(場所, 棒があるか) }
function drawEq(lay, on, opts) {
  const { sticks, fixed, w } = geometry(lay);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `-4 -2 ${w + 8} ${H + 4}`);
  svg.setAttribute('class', 'mb-eq' + (opts.live ? ' live' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', readEq(lay, on).text);
  for (const f of fixed) svg.append(stickEl(f, 'mb-fixed').g);
  sticks.forEach((st, i) => {
    const has = !!on[i];
    let cls = has ? 'mb-on' : 'mb-off';
    if (has && i === opts.sel) cls += ' sel';
    if (opts.answer && i === opts.to) cls += ' ans-to';
    if (opts.answer && i === opts.from) cls += ' ans-from';
    if (!has && opts.sel !== null && opts.sel !== undefined && opts.live) cls += ' drop';
    let el;
    if (has) el = stickEl(st, cls).g;
    else {
      el = document.createElementNS(NS, 'g');
      el.setAttribute('class', cls);
      const [[x1, y1], [x2, y2]] = st;
      const ghost = document.createElementNS(NS, 'line');
      Object.entries({ x1, y1, x2, y2, class: 'mb-ghost' }).forEach(([k, v]) => ghost.setAttribute(k, v));
      el.append(ghost);
    }
    if (opts.onTap) {
      const [[x1, y1], [x2, y2]] = st;
      const hit = document.createElementNS(NS, 'line');
      Object.entries({ x1, y1, x2, y2, class: 'mb-hit' }).forEach(([k, v]) => hit.setAttribute(k, v));
      hit.addEventListener('pointerdown', (e) => { e.preventDefault(); opts.onTap(i, has); });
      el.append(hit);
    }
    svg.append(el);
  });
  return svg;
}
