// 見えない鬼ごっこ。鬼が1人、ほかの人は全員逃げる側。逃げる人の位置は鬼に見えず、3手に1回だけ見える。2〜6人・足りない分は CPU。
// 2026-11-11 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認。board-games.md の「見えない鬼ごっこ」）:
//   - 鬼が1人、ほかの人は全員逃げる側（2人なら1対1）。もう一回のたびに鬼を交代する。
//   - 9×9 のマスに通れない木がいくつかある。逃げる人は1手に1マス、鬼は2マス動ける。
//   - 逃げる人の位置は3手に1回だけ鬼に見え、それ以外は動いた向きも分からない。
//   - 15手のあいだに1人でも逃げ切れば逃げる側の勝ち、全員捕まえたら鬼の勝ち。捕まえる＝同じマスに入る。
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
// 手: { p, t: 'run', k: 何手目（1 から）, to: マスの番号 } / { p, t: 'chase', k, to }
//   k が今と同じで、その人がまだ動いていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32, shuffle } from './util.js';
import { SEAT_COLORS } from './party.js';

export const W = 9;
export const TURNS = 15;
export const EVERY = 3;
const TREES = 10;
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

// 盤（木）と始めの位置。種から作る
export function setup(n, oni, seed) {
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
    if (p === oni) continue;
    const c = far.find((x) => used.every((u) => dist(u, x) >= 4)) ?? far.find((x) => !used.includes(x));
    used.push(c);
    pos[p] = c;
  }
  return { trees, pos };
}

// 逃げる人の行ける所（上下左右とその場。鬼のいるマスは入れない）
export function runMoves(s, p) {
  const c = s.pos[p];
  return [c, ...nbrs(c, s.trees)].filter((d) => d !== s.O);
}
// 鬼の行ける所（1〜2マス先）
export function chaseMoves(s) {
  const d = bfs(s.O, s.trees);
  return d.map((v, c) => (v >= 1 && v <= 2 ? c : -1)).filter((c) => c >= 0);
}

const runners = (s) => [...Array(s.n).keys()].filter((p) => p !== s.oni);
const aliveRunners = (s) => runners(s).filter((p) => s.alive[p]);

// 鬼から見て、逃げる人 p がいまいそうなマス（鬼が知っていることだけで数える）
export function belief(s, p) {
  let set = new Set([s.seen.pos[p]]);
  const now = s.phase === 'chase' ? s.k : s.k - 1; // 逃げる人が動いた回数
  for (let t = s.seen.k + 1; t <= now; t++) {
    const o = s.trail[t - 1];
    set.delete(o);
    const next = new Set();
    for (const c of set) for (const d of [c, ...nbrs(c, s.trees)]) if (d !== o) next.add(d);
    set = next;
  }
  if (s.phase !== 'chase' && now >= s.seen.k) set.delete(s.trail[now]);
  return set;
}

const clone = (s) => ({ ...s, pos: s.pos.slice(), alive: s.alive.slice(), moved: s.moved.slice(), trail: s.trail.slice(), caught: s.caught.slice() });
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

  init(n, seed, { prev = null } = {}) {
    const rng = mulberry32(seed ^ 0x0c1);
    let oni;
    const counts = prev && prev.length === n && prev.every((x) => x && Number.isInteger(x.oni)) ? prev.map((x) => x.oni) : null;
    if (counts) {
      const min = Math.min(...counts);
      const cand = counts.map((v, p) => (v === min ? p : -1)).filter((p) => p >= 0);
      oni = cand[Math.floor(rng() * cand.length)];
    } else oni = Math.floor(rng() * n);
    const { trees, pos } = setup(n, oni, seed);
    return {
      n, seed, oni, trees, O: CENTER, pos, alive: pos.map((c) => c !== null), counts: counts ?? Array(n).fill(0),
      k: 1, phase: 'run', moved: Array(n).fill(false), seen: { k: 0, pos: pos.slice() }, trail: [CENTER], caught: [], step: 0,
    };
  },

  turn(s) { return s.phase === 'chase' ? s.oni : null; },
  canAct(s, p) {
    if (s.phase === 'run') return p !== s.oni && s.alive[p] && !s.moved[p];
    return s.phase === 'chase' && p === s.oni;
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const caughtAll = !s.alive.some(Boolean);
    return { winners: caughtAll ? [s.oni] : runners(s), oniWin: caughtAll, oni: s.oni, left: aliveRunners(s).length };
  },
  carry(s, p) { return { oni: s.counts[p] + (p === s.oni ? 1 : 0) }; },
  resultText(res, me, pn) {
    if (res.oniWin) return res.oni === me ? '全員つかまえた！あなた（鬼）の勝ち！🎉' : `全員つかまった…鬼（${pn(res.oni)}）の勝ち！`;
    return me === res.oni ? `${res.left}人に逃げ切られた…逃げる側の勝ち` : `${res.left}人が逃げ切った！逃げる側の勝ち！${me >= 0 ? '🎉' : ''}`;
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
        if (s.k % EVERY === 0) s.seen = { k: s.k, pos: s.pos.slice() };
      }
      return s;
    }
    if (m.t === 'chase') {
      if (s0.phase !== 'chase' || m.p !== s0.oni || !chaseMoves(s0).includes(m.to)) return null;
      const s = clone(s0);
      s.step += 1;
      s.O = m.to;
      s.trail.push(m.to);
      for (const p of aliveRunners(s)) if (s.pos[p] === m.to) { s.alive[p] = false; s.caught.push({ p, k: s.k, at: m.to }); }
      if (!s.alive.some(Boolean) || s.k >= TURNS) { s.phase = 'end'; return s; }
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
        // 鬼が次に届く所（2マス以内）を避け、逃げ道の多いマス（2歩で行ける所の数）を選ぶ。隅に追い込まれないように
        const d = bfs(s.O, s.trees);
        const room = (c) => { const e = bfs(c, s.trees); return e.filter((v, x) => v <= 2 && d[x] > 2).length; };
        to = opts.map((c) => [(d[c] > 2 ? 10 : 0) + Math.min(d[c], 5) + room(c) * 0.4 + Math.random() * 1.5, c]).sort((a, b) => b[0] - a[0])[0][1];
      }
      return { t: 'run', k: s.k, to };
    }
    const opts = chaseMoves(s);
    if (Math.random() < 0.25) return { t: 'chase', k: s.k, to: opts[Math.floor(Math.random() * opts.length)] };
    const sets = aliveRunners(s).map((q) => belief(s, q));
    const score = (c) => sets.reduce((t, st) => t + (st.has(c) ? 1 / st.size : 0), 0);
    let best = opts.map((c) => [score(c) + Math.random() * 1e-3, c]).sort((a, b) => b[0] - a[0])[0];
    if (best[0] < 1e-2) {
      // どこにも当たりそうにない: いちばん小さい候補の集まりへ近づく
      const st = sets.filter((x) => x.size).sort((a, b) => a.size - b.size)[0];
      if (st) {
        const goal = [...st];
        best = opts.map((c) => { const d = bfs(c, s.trees); return [-Math.min(...goal.map((g) => d[g])) + Math.random() * 0.1, c]; }).sort((a, b) => b[0] - a[0])[0];
      }
    }
    return { t: 'chase', k: s.k, to: best[1] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : -1;
    const isOni = me === s.oni && !o.watching;
    const hide = isOni && s.phase !== 'end'; // 鬼の画面だけ、逃げる人の今の位置を出さない
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
      c.className = 'cc-opp' + (p === me && !o.watching ? ' me' : '') + (p === s.oni ? ' on-oni' : '') + (s.alive[p] === false && p !== s.oni ? ' out' : '');
      const nm = document.createElement('div');
      nm.className = 'cc-opp-name';
      nm.textContent = p === me && !o.watching ? 'あなた' : o.names[p];
      const tag = document.createElement('div');
      tag.className = 'pt-extra';
      if (p === s.oni) tag.textContent = '👹 鬼';
      else {
        const dot = document.createElement('span');
        dot.className = 'on-dot';
        dot.style.background = SEAT_COLORS[p];
        tag.append(dot, document.createTextNode(!s.alive[p] ? ' つかまった' : s.phase === 'run' && s.moved[p] ? ' ✔ 動いた' : ' 逃げる'));
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
    const nextSeen = Math.ceil(s.k / EVERY) * EVERY;
    const shownNow = s.phase === 'chase' && s.k % EVERY === 0;
    info.innerHTML = s.phase === 'end' ? `${Math.min(s.k, TURNS)}手で終わり`
      : `<b>${s.k}</b>手目 / ${TURNS}　${shownNow ? '<span class="on-eye">👀 いま鬼に見えている！</span>' : `鬼に見えるのは ${nextSeen}手目`}`;
    wrap.append(info);
    // 盤
    const mine = this.canAct(s, me) && o.canMove && !o.watching;
    const opts = !mine ? [] : s.phase === 'run' ? runMoves(s, me) : chaseMoves(s);
    const key = `oni:${s.seed}:${s.k}:${s.phase}:${me}`;
    const sel = picked.get(key);
    const grid = document.createElement('div');
    grid.className = 'on-grid';
    const ago = (s.phase === 'chase' ? s.k : s.k - 1) - s.seen.k;
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
      if (c === s.O) { const t = document.createElement('span'); t.className = 'on-o'; t.textContent = '👹'; b.append(t); }
      // 鬼に見えた位置の印（鬼の画面では、これだけが手がかり）
      if (s.phase !== 'end') {
        for (const p of aliveRunners(s)) {
          if (s.seen.pos[p] !== c || (!hide && ago === 0)) continue;
          const m = document.createElement('span');
          m.className = 'on-ghost';
          m.style.borderColor = SEAT_COLORS[p];
          m.textContent = ago === 0 ? '👀' : String(ago);
          m.title = ago === 0 ? '鬼にいま見えている' : `${ago}手前にここにいた（鬼に見えた位置）`;
          b.append(m);
        }
      }
      for (const x of s.caught) if (x.at === c && s.O !== c) { const m = document.createElement('span'); m.className = 'on-x'; m.textContent = '✖'; b.append(m); }
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
        : '光っているマスへ動く。止まったマスに逃げる人がいれば捕まえる';
    } else if (s.phase === 'end') note.textContent = '';
    else if (isOni) note.textContent = '逃げる人が動いています…（見えない！）';
    else if (s.phase === 'chase') note.textContent = '鬼が動いています…';
    else if (me >= 0 && !o.watching && s.alive[me] === false) note.textContent = 'つかまってしまった…仲間を応援しよう';
    else note.textContent = 'ほかの人が動くのを待っています…';
    wrap.append(note);
  },
};
