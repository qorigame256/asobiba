// 見えない鬼ごっこ。鬼が1人、ほかの人は全員逃げる側。逃げる人の位置は鬼に見えず、3手に1回だけ見える。2〜6人・足りない分は CPU。
// 2026-11-11 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認。board-games.md の「見えない鬼ごっこ」）:
//   - 鬼が1人、ほかの人は全員逃げる側（2人なら1対1）。もう一回のたびに鬼を交代する。
//   - 9×9 のマスに通れない木がいくつかある。逃げる人は1手に1マス、鬼は2マス動ける。
//   - 逃げる人の位置は3手に1回だけ鬼に見え、それ以外は動いた向きも分からない。
//   - 15手のあいだに1人でも逃げ切れば逃げる側の勝ち、全員捕まえたら鬼の勝ち。捕まえる＝同じマスに入る。
//   - 逃げる人が3人以上のときは、半分以上（切り上げ）捕まえたら鬼の勝ち（同日、CPU どうしの実測で鬼の勝ちが 4人 5%・6人 0% だったため。推奨を本人が承認）。
//     鬼の勝ちが決まったら、15手を待たずにすぐ終わる。
// Claude の判断:
//   - 1手は「逃げる人が全員同時に動く → 鬼が動く」。逃げる人は上下左右に1マスか、その場にとどまる（鬼のいるマスには入れない。逃げる人どうしは重なってよい）。
//     鬼は上下左右に1〜2マス先のマス（木はよけて回り道の数で数える）を選ぶ。捕まえるのは鬼が止まったマスにいる人だけ（通り道は数えない。どの道を通ったかで変わらないように）。
//   - 鬼に見えるのは、3手目・6手目…に逃げる人が動き終えた位置（と始めの位置）。見えた位置は次に見えるまで「◯手前にここ」と印を残す。
//     逃げる人どうしと観戦の人には全部見える（逃げる側は仲間なので。手札と同じ簡易の隠し方で、全員の端末は全部の位置を知っている）。
//   - 鬼の交代: 前の対局と同じ顔ぶれなら、鬼になった回数がいちばん少ない人（並んだら種で選ぶ）。顔ぶれが変わったら種で選ぶ。
//   - 木は10本。種で置き、木のないマスがすべてつながる形だけを使う。鬼は真ん中から、逃げる人は真ん中から5マス以上離れた所から始める。
//   - 押し間違えないように、マスを押すと選ぶだけで、もう一度押すか「決める」で動く。時間の制限はない（盤のゲームと同じ）。
//   - 勝ち負けはチームで決まる（逃げる側が勝てば、捕まった人も勝ち）。
//   - CPU の鬼は、見えた位置から逃げる人がいそうなマスを数え（自分が止まって捕まえられなかったマスは消す）、いちばん当たりそうなマスへ動く。4回に1回は適当に動く。
//     CPU の逃げる人は、鬼から離れるマスを選ぶ。5回に1回は適当に動く。どちらも見えないものはのぞかない（CPU の鬼は逃げる人の今の位置を使わない）。
// 2026-11-11 の39回目の案（本人が選んだ。分かれ目は Claude の判断。board-games.md の「見えない鬼ごっこ」）:
//   - 詳細設定「見える間隔」（every）2・3（最初）・4手ごと。3以外のときだけ局面に every を持つ。
//   - 詳細設定「草むら」（grass）: 木とは別に7マス。見える手にそこにいる逃げる人は、鬼に見えない（印は前に見えた位置のまま）。
//     草むらの場所は鬼にも見える。草むらはだれでも通れて、止まれる。置き場所は種から作るが、木と始めの位置は草むらなしと同じ（別の乱数で置く）。
//     鬼は「見える手に姿が見えなかった人は、そのとき草むらのどれかにいた」と分かる（CPU の鬼もこれを使って数える）。
//     ありのときだけ局面に grass（マスごとの真偽）と seen.ks（人ごとに最後に見えた手）を持つ。
//   - 詳細設定「鬼の数」（onis）1人（最初）・2人。2人は5人以上で遊ぶときだけ（4人以下では1人のまま）。
//     2人の鬼は2人とも真ん中から始め、逃げる人が動いたあと、2人が同時に選び、そろったら一斉に動く。どちらかが止まったマスにいる人を捕まえる。
//     鬼が2人のときは、3人つかまえたら鬼の勝ち（下の NEED2）。鬼の交代は、鬼になった回数が少ない順に2人。
//     2人のときだけ局面に oni2・O2・trail2・ogo（その手に鬼が選んだマス）を持つ。CPU の鬼どうしは、相方が選んだマスを避ける。
// 手: { p, t: 'run', k: 何手目（1 から）, to: マスの番号 } / { p, t: 'chase', k, to }
//   k が今と同じで、その人がまだ動いていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32, shuffle } from './util.js';
import { SEAT_COLORS } from './party.js';

export const W = 9;
export const TURNS = 15;
export const EVERY = 3;
const TREES = 10;
const GRASS = 7;
const CENTER = (W >> 1) * W + (W >> 1);
const xy = (c) => [c % W, Math.floor(c / W)];
const dist = (a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.abs(ax - bx) + Math.abs(ay - by); };
export function nbrs(c, trees) {
  const [x, y] = xy(c);
  const out = [];
  if (x > 0) out.push(c - 1);
  if (x < W - 1) out.push(c + 1);
  if (y > 0) out.push(c - W);
  if (y < W - 1) out.push(c + W);
  return out.filter((d) => !trees[d]);
}
// 木をよけて数えた道のり（届かなければ Infinity）
function bfs(from, trees) {
  const d = Array(W * W).fill(Infinity);
  d[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) for (const n of nbrs(q[i], trees)) if (d[n] === Infinity) { d[n] = d[q[i]] + 1; q.push(n); }
  return d;
}

// 盤（木）と始めの位置。種から作る（onis = 鬼の席の一覧）
export function setup(n, onis, seed) {
  if (!Array.isArray(onis)) onis = [onis];
  const rng = mulberry32(seed ^ 0x5eed0a1);
  let trees;
  for (;;) {
    trees = Array(W * W).fill(false);
    const cand = shuffle([...Array(W * W).keys()].filter((c) => dist(c, CENTER) >= 2), rng);
    for (const c of cand.slice(0, TREES)) trees[c] = true;
    const d = bfs(CENTER, trees);
    if (trees.every((t, c) => t || d[c] < Infinity)) break;
  }
  const far = shuffle([...Array(W * W).keys()].filter((c) => !trees[c] && dist(c, CENTER) >= 5), rng);
  const pos = Array(n).fill(null);
  const used = [];
  for (let p = 0; p < n; p++) {
    if (onis.includes(p)) continue;
    const c = far.find((x) => used.every((u) => dist(u, x) >= 4)) ?? far.find((x) => !used.includes(x));
    used.push(c);
    pos[p] = c;
  }
  return { trees, pos };
}
// 草むら: 木・真ん中・始めの位置でない、真ん中から2マス以上のマスに7つ。木と始めの位置を変えないよう、別の乱数で置く
export function grassOf(trees, pos, seed) {
  const rng = mulberry32((seed ^ 0x9a55e5) >>> 0);
  const g = Array(W * W).fill(false);
  const cand = shuffle([...Array(W * W).keys()].filter((c) => !trees[c] && dist(c, CENTER) >= 2 && !pos.includes(c)), rng);
  for (const c of cand.slice(0, GRASS)) g[c] = true;
  return g;
}
export const everyOf = (s) => s.every ?? EVERY;
const isOni = (s, p) => p === s.oni || (s.oni2 !== undefined && p === s.oni2);
const onisOf = (s) => (s.oni2 !== undefined ? [s.oni, s.oni2] : [s.oni]);
const seenK = (s, p) => (s.seen.ks ? s.seen.ks[p] : s.seen.k);

// 逃げる人の行ける所（上下左右とその場。鬼のいるマスは入れない）
export function runMoves(s, p) {
  const c = s.pos[p];
  return [c, ...nbrs(c, s.trees)].filter((d) => d !== s.O && d !== s.O2);
}
// 鬼の行ける所（1〜2マス先）。p = どちらの鬼か（省くと1人目）
export function chaseMoves(s, p = s.oni) {
  const d = bfs(p === s.oni2 ? s.O2 : s.O, s.trees);
  return d.map((v, c) => (v >= 1 && v <= 2 ? c : -1)).filter((c) => c >= 0);
}

const runners = (s) => [...Array(s.n).keys()].filter((p) => !isOni(s, p));
// 鬼が勝つのに捕まえる人数: 逃げる人が1〜2人なら全員、3人以上なら半分以上（切り上げ）。needOf は鬼1人のときの人数から
export const needRun = (r) => (r >= 3 ? Math.ceil(r / 2) : r);
export const needOf = (n) => needRun(n - 1);
// 鬼が2人のときは3人つかまえたら鬼の勝ち（5人なら逃げる3人全員・6人なら4人のうち3人）。
// 半分以上のままだと CPU どうしで鬼の勝ちが 5人 79%・6人 86% と強すぎ、3人にすると 42%・53% だった（2026-11-11 の実測。Claude の判断）
export const NEED2 = 3;
const need = (s) => (s.oni2 !== undefined ? NEED2 : needRun(runners(s).length));
const aliveRunners = (s) => runners(s).filter((p) => s.alive[p]);

// 鬼から見て、逃げる人 p がいまいそうなマス（鬼が知っていることだけで数える）
// 草むらがあるときは、見える手に見えなかった人はそのとき草むらにいたので、草むらだけに絞る
export function belief(s, p) {
  let set = new Set([s.seen.pos[p]]);
  const now = s.phase === 'chase' ? s.k : s.k - 1; // 逃げる人が動いた回数
  const k0 = seenK(s, p);
  const ev = everyOf(s);
  const oAt = (t) => (s.trail2 ? [s.trail[t], s.trail2[t]] : [s.trail[t]]);
  for (let t = k0 + 1; t <= now; t++) {
    const os = oAt(t - 1);
    for (const o of os) set.delete(o);
    const next = new Set();
    for (const c of set) for (const d of [c, ...nbrs(c, s.trees)]) if (!os.includes(d)) next.add(d);
    set = next;
    if (s.grass && t % ev === 0) for (const c of [...set]) if (!s.grass[c]) set.delete(c);
  }
  if (s.phase !== 'chase' && now >= k0) for (const o of oAt(now)) set.delete(o);
  return set;
}

const clone = (s) => ({
  ...s, pos: s.pos.slice(), alive: s.alive.slice(), moved: s.moved.slice(), trail: s.trail.slice(), caught: s.caught.slice(),
  ...(s.trail2 ? { trail2: s.trail2.slice(), ogo: s.ogo.slice() } : {}),
});
// 逃げる人が全員動き終えたとき: 見える手なら鬼に見せる（草むらの中の人は見せない）
function reveal(s) {
  if (s.k % everyOf(s) !== 0) return;
  if (!s.grass) { s.seen = { k: s.k, pos: s.pos.slice() }; return; }
  const pos = s.seen.pos.slice(), ks = s.seen.ks.slice();
  for (const p of aliveRunners(s)) if (!s.grass[s.pos[p]]) { pos[p] = s.pos[p]; ks[p] = s.k; }
  s.seen = { k: s.k, pos, ks };
}
const picked = new Map(); // この端末で選んだ（まだ決めていない）マス

export default {
  id: 'oni',
  name: '見えない鬼ごっこ',
  icon: '👹',
  desc: '逃げる人の姿は鬼に見えない。3手に1回だけ見える位置から、鬼は先回りして捕まえる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'every', label: '見える間隔', desc: '逃げる人の位置が鬼に見える間隔。短いほど鬼が有利', def: 3, choices: [[2, '2手ごと'], [3, '3手ごと'], [4, '4手ごと']] },
    { key: 'grass', label: '草むら', desc: '草むらのマス（🌿）を7つ置く。見える手に草むらにいる人は、鬼に見えない（草むらの場所は鬼にも見える）', def: false },
    { key: 'onis', label: '鬼の数', desc: '2人は5人以上で遊ぶときだけ（4人以下では1人）。2人の鬼は同時に動く', def: 1, choices: [[1, '1人'], [2, '2人']] },
  ],

  init(n, seed, { prev = null, rules = {} } = {}) {
    const rng = mulberry32(seed ^ 0x0c1);
    const two = Number(rules.onis) === 2 && n >= 5;
    let oni, oni2;
    // prev は前の対局で鬼になった回数（席ごとの整数）。main.js の newRound は整数の並びだけを prev に渡すので、carry も整数で返す
    const counts = prev && prev.length === n && prev.every(Number.isInteger) ? prev.slice() : null;
    const pickMin = (skip) => {
      const ps = [...Array(n).keys()].filter((p) => p !== skip);
      if (!counts) return ps[Math.floor(rng() * ps.length)];
      const min = Math.min(...ps.map((p) => counts[p]));
      const cand = ps.filter((p) => counts[p] === min);
      return cand[Math.floor(rng() * cand.length)];
    };
    oni = pickMin(-1);
    if (two) oni2 = pickMin(oni);
    const { trees, pos } = setup(n, two ? [oni, oni2] : [oni], seed);
    const s = {
      n, seed, oni, trees, O: CENTER, pos, alive: pos.map((c) => c !== null), counts: counts ?? Array(n).fill(0),
      k: 1, phase: 'run', moved: Array(n).fill(false), seen: { k: 0, pos: pos.slice() }, trail: [CENTER], caught: [], step: 0,
    };
    if ([2, 4].includes(Number(rules.every))) s.every = Number(rules.every);
    if (rules.grass === true) { s.grass = grassOf(trees, pos, seed); s.seen.ks = Array(n).fill(0); }
    if (two) Object.assign(s, { oni2, O2: CENTER, trail2: [CENTER], ogo: [null, null] });
    return s;
  },

  turn(s) { return s.phase === 'chase' && s.oni2 === undefined ? s.oni : null; },
  canAct(s, p) {
    if (s.phase === 'run') return !isOni(s, p) && s.alive[p] && !s.moved[p];
    if (s.phase !== 'chase' || !isOni(s, p)) return false;
    return s.oni2 === undefined || s.ogo[p === s.oni ? 0 : 1] === null;
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const oniWin = s.caught.length >= need(s);
    return { winners: oniWin ? onisOf(s) : runners(s), oniWin, all: !s.alive.some(Boolean), got: s.caught.length, oni: s.oni, onis: onisOf(s), left: aliveRunners(s).length };
  },
  carry(s, p) { return s.counts[p] + (isOni(s, p) ? 1 : 0); },
  resultText(res, me, pn) {
    const what = res.all ? '全員' : `${res.got}人`;
    const onis = res.onis ?? [res.oni];
    if (res.oniWin) return onis.includes(me) ? `${what}つかまえた！あなた（鬼）の勝ち！🎉` : `${what}つかまった…鬼（${onis.map(pn).join('・')}）の勝ち！`;
    return onis.includes(me) ? `${res.left}人に逃げ切られた…逃げる側の勝ち` : `${res.left}人が逃げ切った！逃げる側の勝ち！${me >= 0 ? '🎉' : ''}`;
  },
  phaseText(s, me, pn) {
    if (s.phase === 'run') return `${s.k}手目 / ${TURNS}・逃げる人が動いています`;
    return `${s.k}手目 / ${TURNS}`;
  },
  sound(a, b, m, me) {
    if (b.caught.length > a.caught.length) return 'hit';
    if (m.t === 'chase') return 'place';
    return m.p === me ? 'place' : null;
  },

  apply(s0, m) {
    if (!m || m.k !== s0.k || !Number.isInteger(m.p) || !Number.isInteger(m.to)) return null;
    if (m.t === 'run') {
      if (s0.phase !== 'run' || !this.canAct(s0, m.p) || !runMoves(s0, m.p).includes(m.to)) return null;
      const s = clone(s0);
      s.step += 1;
      s.pos[m.p] = m.to;
      s.moved[m.p] = true;
      if (aliveRunners(s).every((p) => s.moved[p])) {
        s.phase = 'chase';
        reveal(s);
      }
      return s;
    }
    if (m.t === 'chase') {
      if (s0.phase !== 'chase' || !this.canAct(s0, m.p) || !chaseMoves(s0, m.p).includes(m.to)) return null;
      const s = clone(s0);
      s.step += 1;
      if (s.oni2 !== undefined) {
        s.ogo[m.p === s.oni ? 0 : 1] = m.to;
        if (s.ogo.includes(null)) return s; // もう1人の鬼を待つ
        [s.O, s.O2] = s.ogo;
        s.trail2.push(s.O2);
        s.ogo = [null, null];
      } else s.O = m.to;
      s.trail.push(s.O);
      const stops = s.oni2 !== undefined ? [s.O, s.O2] : [s.O];
      for (const p of aliveRunners(s)) if (stops.includes(s.pos[p])) { s.alive[p] = false; s.caught.push({ p, k: s.k, at: s.pos[p] }); }
      if (s.caught.length >= need(s) || s.k >= TURNS) { s.phase = 'end'; return s; }
      s.k += 1;
      s.phase = 'run';
      s.moved = Array(s.n).fill(false);
      return s;
    }
    return null;
  },

  cpuDelay(s) { return s.phase === 'chase' ? 900 : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    if (s.phase === 'run') {
      const opts = runMoves(s, p);
      let to;
      if (Math.random() < 0.2) to = opts[Math.floor(Math.random() * opts.length)];
      else {
        // 鬼が次に届く所（2マス以内）を避け、逃げ道の多いマス（2歩で行ける所の数）を選ぶ。隅に追い込まれないように。
        // 草むらがあれば、見える手には草むらを選びやすく
        const d1 = bfs(s.O, s.trees), d2 = s.oni2 !== undefined ? bfs(s.O2, s.trees) : null;
        const d = d2 ? d1.map((v, x) => Math.min(v, d2[x])) : d1;
        const room = (c) => { const e = bfs(c, s.trees); return e.filter((v, x) => v <= 2 && d[x] > 2).length; };
        const hideNow = s.grass && s.k % everyOf(s) === 0;
        to = opts.map((c) => [(d[c] > 2 ? 10 : 0) + Math.min(d[c], 5) + room(c) * 0.4 + (hideNow && s.grass[c] ? 6 : 0) + Math.random() * 1.5, c]).sort((a, b) => b[0] - a[0])[0][1];
      }
      return { t: 'run', k: s.k, to };
    }
    // 鬼が2人なら、相方がもう選んだマスは避ける（2人で同じマスに行っても1人分しか捕まえられない）
    const two = s.oni2 !== undefined;
    const mate = two ? s.ogo[p === s.oni ? 1 : 0] : null;
    const all = chaseMoves(s, p);
    const opts = all.filter((c) => c !== mate).length ? all.filter((c) => c !== mate) : all;
    if (Math.random() < 0.25) return { t: 'chase', k: s.k, to: opts[Math.floor(Math.random() * opts.length)] };
    const sets = aliveRunners(s).map((q) => belief(s, q));
    const score = (c) => sets.reduce((t, st) => t + (st.has(c) ? 1 / st.size : 0), 0);
    let best = opts.map((c) => [score(c) + Math.random() * 1e-3, c]).sort((a, b) => b[0] - a[0])[0];
    if (best[0] < 1e-2) {
      // どこにも当たりそうにない: いちばん小さい候補の集まりへ近づく（2人目の鬼は2番目に小さい集まりへ。分かれて追う）
      const order = sets.filter((x) => x.size).sort((a, b) => a.size - b.size);
      const st = two && p === s.oni2 && order.length > 1 ? order[1] : order[0];
      if (st) {
        const goal = [...st];
        best = opts.map((c) => { const d = bfs(c, s.trees); return [-Math.min(...goal.map((g) => d[g])) + Math.random() * 0.1, c]; }).sort((a, b) => b[0] - a[0])[0];
      }
    }
    return { t: 'chase', k: s.k, to: best[1] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : -1;
    const meOni = isOni(s, me) && !o.watching;
    const hide = meOni && s.phase !== 'end'; // 鬼の画面だけ、逃げる人の今の位置を出さない
    const ev = everyOf(s);
    const now = s.phase === 'chase' ? s.k : s.k - 1;
    root.innerHTML = '';
    root.className = 'board on';
    const wrap = document.createElement('div');
    wrap.className = 'on-wrap';
    root.append(wrap);
    // 上の札: 鬼と逃げる人
    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const c = document.createElement('div');
      c.className = 'cc-opp' + (p === me && !o.watching ? ' me' : '') + (isOni(s, p) ? ' on-oni' : '') + (s.alive[p] === false && !isOni(s, p) ? ' out' : '');
      const nm = document.createElement('div');
      nm.className = 'cc-opp-name';
      nm.textContent = p === me && !o.watching ? 'あなた' : o.names[p];
      const tag = document.createElement('div');
      tag.className = 'pt-extra';
      if (isOni(s, p)) tag.textContent = '👹 鬼' + (s.oni2 !== undefined && s.phase === 'chase' && !this.canAct(s, p) ? ' ✔ 決めた' : '');
      else {
        const dot = document.createElement('span');
        dot.className = 'on-dot';
        dot.style.background = SEAT_COLORS[p];
        // 草むら: 最後の見える手に見えなかった人に印（だれでも分かること）
        const hid = s.grass && s.alive[p] && s.seen.k > 0 && seenK(s, p) < s.seen.k;
        tag.append(dot, document.createTextNode(!s.alive[p] ? ' つかまった' : s.phase === 'run' && s.moved[p] ? ' ✔ 動いた' : hid ? ' 🌿 草むらに隠れた' : ' 逃げる'));
      }
      c.append(nm, tag);
      if (o.away?.[p]) c.insertAdjacentHTML('beforeend', '<span class="cc-tag away">応答なし</span>');
      else if (o.sub?.[p]) c.insertAdjacentHTML('beforeend', '<span class="cc-tag away">CPU が代わりに</span>');
      chips.append(c);
    }
    wrap.append(chips);
    // 残りの手数と、見える回までのめやす
    const info = document.createElement('div');
    info.className = 'on-info';
    const nextSeen = Math.ceil(s.k / ev) * ev;
    const shownNow = s.phase === 'chase' && s.k % ev === 0;
    info.innerHTML = s.phase === 'end' ? `${Math.min(s.k, TURNS)}手で終わり`
      : `<b>${s.k}</b>手目 / ${TURNS}　鬼の勝ちまで ${need(s) - s.caught.length}人　${shownNow ? `<span class="on-eye">👀 いま鬼に見えている！${s.grass ? '（草むらの中は見えない）' : ''}</span>` : `鬼に見えるのは ${nextSeen}手目`}`;
    wrap.append(info);
    // 盤
    const mine = this.canAct(s, me) && o.canMove && !o.watching;
    const opts = !mine ? [] : s.phase === 'run' ? runMoves(s, me) : chaseMoves(s, me);
    const key = `oni:${s.seed}:${s.k}:${s.phase}:${me}`;
    const sel = picked.get(key);
    const grid = document.createElement('div');
    grid.className = 'on-grid';
    const send = (c) => {
      if (!mine || !opts.includes(c)) return;
      picked.delete(key);
      o.onMove({ t: s.phase === 'run' ? 'run' : 'chase', k: s.k, to: c });
    };
    for (let c = 0; c < W * W; c++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'on-cell';
      if (s.trees[c]) { b.classList.add('tree'); b.textContent = '🌲'; b.disabled = true; grid.append(b); continue; }
      if (s.grass?.[c]) { b.classList.add('grass'); const g = document.createElement('span'); g.className = 'on-g'; g.textContent = '🌿'; b.append(g); }
      if (c === s.O || (s.oni2 !== undefined && c === s.O2)) { const t = document.createElement('span'); t.className = 'on-o'; t.textContent = c === s.O && c === s.O2 ? '👹👹' : '👹'; b.append(t); }
      // 鬼に見えた位置の印（鬼の画面では、これだけが手がかり）
      if (s.phase !== 'end') {
        for (const p of aliveRunners(s)) {
          const ago = now - seenK(s, p);
          if (s.seen.pos[p] !== c || (!hide && ago === 0)) continue;
          const m = document.createElement('span');
          m.className = 'on-ghost';
          m.style.borderColor = SEAT_COLORS[p];
          m.textContent = ago === 0 ? '👀' : String(ago);
          m.title = ago === 0 ? '鬼にいま見えている' : `${ago}手前にここにいた（鬼に見えた位置）`;
          b.append(m);
        }
      }
      for (const x of s.caught) if (x.at === c && s.O !== c && s.O2 !== c) { const m = document.createElement('span'); m.className = 'on-x'; m.textContent = '✖'; b.append(m); }
      if (!hide) {
        for (const p of aliveRunners(s)) {
          if (s.pos[p] !== c) continue;
          const t = document.createElement('span');
          t.className = 'on-r' + (p === me ? ' me' : '');
          t.style.background = SEAT_COLORS[p];
          b.append(t);
        }
      }
      if (opts.includes(c)) {
        b.classList.add('can');
        if (sel === c) b.classList.add('sel');
        b.onclick = () => { if (picked.get(key) === c) send(c); else { picked.set(key, c); this.render(root, s, { ...o, fresh: false }); } };
      } else b.disabled = true;
      grid.append(b);
    }
    wrap.append(grid);
    // 下の段: 決めるボタンと説明
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (mine) {
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary on-go';
      go.disabled = sel === undefined;
      go.textContent = sel === undefined ? (s.phase === 'run' ? '動く先のマスを選んでね' : '1〜2マス先を選んでね') : sel === s.pos[me] && s.phase === 'run' ? 'ここにとどまる' : 'ここへ動く';
      go.onclick = () => { if (sel !== undefined) send(sel); };
      wrap.append(go);
      note.textContent = s.phase === 'run' ? '光っているマスへ1つ動く（自分のマスを選ぶと、とどまる）。もう一度押すか「ここへ動く」で決まる'
        : `光っているマスへ動く。止まったマスに逃げる人がいれば捕まえる${s.oni2 !== undefined ? '（鬼2人は同時に動く）' : ''}`;
    } else if (s.phase === 'end') note.textContent = '';
    else if (meOni && s.phase === 'chase') note.textContent = 'もう1人の鬼が選ぶのを待っています…';
    else if (meOni) note.textContent = '逃げる人が動いています…（見えない！）';
    else if (s.phase === 'chase') note.textContent = '鬼が動いています…';
    else if (me >= 0 && !o.watching && s.alive[me] === false) note.textContent = 'つかまってしまった…仲間を応援しよう';
    else note.textContent = 'ほかの人が動くのを待っています…';
    wrap.append(note);
  },
};
