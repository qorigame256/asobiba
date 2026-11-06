// 一筆書き早解き。点と線の図を、同じ線を2回通らずに全部なぞる。全員に同じ問題を出し、早く描けた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-06 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 点から点へ指でなぞる（点を順に押すだけでもよい）。「1つ戻す」「はじめから」のボタンを付ける。描き始めてよい点の印は付けない。
//   - 難しさは やさしい（点6〜8個）・ふつう（最初。10〜12個）・むずかしい（15個前後）。全員に同じ3問を出し、早く描けた順に 3点・2点・それ以降は1点。
// Claude の判断:
//   - 図は種から作る（makeFigure）。点はますめ（やさしい 3×3・ふつう 4×4・むずかしい 5×4）の上に少しずらして置き、
//     となりの点（たて・よこ・ななめ）を結ぶ線だけを使う。同じますの2本のななめは両方は使わない（交わって点に見えるため）。
//     ますめの上をでたらめに歩いて、歩いた線をそのまま図にするので、必ず一筆で描ける。端が2つある図（描き始めを考える必要がある）になりやすい。
//     線の数は やさしい 8〜11本・ふつう 14〜18本・むずかしい 21〜26本。
//   - なぞり: 今の先の点から、まだ通っていない線でつながる点へ指が来たら進む。1つ前の点へ同じ線で戻ると1つ消える。
//     まだ描いていないときは、どの点からでも始められる。今の先と線でつながっていない点を押しても何もしない。
//   - 送るのは通った点の並び（path）。apply で、となりどうしが線で、全部の線をちょうど1回ずつ通っているか確かめる。
//   - 制限時間は やさしい60秒・ふつう90秒・むずかしい150秒。最初に描けた人から20秒で締め切る（制限時間のほうが先なら制限時間で）。あきらめる（この問題をとばす）もできる。
//   - CPU は やさしいは7割5分・ふつうは6割・むずかしいは4割5分の問題を、制限時間の2.5〜7.5割のころに描く。描かない問題は同じころにあきらめる。
//   - 詳細設定「問題の数」（2026-11-06 の36回目の案。鍵は rounds）: 1問・3問（最初）・5問（数字つなぎ早解きと同じ）。おまかせでは抽選しない（main.js の KEEP_KEYS の rounds）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数字つなぎ早解きと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, path: [点…], ms } / { p, t: 'pass', q }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
export const QUESTIONS = 3;
const ROUNDS = [[3, '3問'], [1, '1問'], [5, '5問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : QUESTIONS);
export const LEVELS = {
  easy: { label: 'やさしい', w: 3, h: 3, v: [6, 8], e: [8, 11], limit: 60000, cpu: 0.75 },
  normal: { label: 'ふつう', w: 4, h: 4, v: [10, 12], e: [14, 18], limit: 90000, cpu: 0.6 },
  hard: { label: 'むずかしい', w: 5, h: 4, v: [14, 16], e: [21, 26], limit: 150000, cpu: 0.45 },
};
const levelOf = (r) => LEVELS[r.level] ? r.level : 'normal';
const limitOf = (s) => LEVELS[s.level].limit;
const qKey = (s, q = s.q) => `hitofude:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
const ek = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/* ---------- 図を作る（種から。全員同じ） ---------- */

// ますめの点のとなり（たて・よこ・ななめ）
function gridNb(w, h) {
  const out = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    const a = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) a.push(ny * w + nx);
    }
    out.push(a);
  }
  return out;
}
// ななめの線 a-b と交わるもう1本のななめ（同じます）
function crossOf(a, b, w) {
  const ax = a % w, ay = Math.floor(a / w), bx = b % w, by = Math.floor(b / w);
  if (ax === bx || ay === by) return null;
  return ek(ay * w + bx, by * w + ax);
}
// 図 = { pts: [[x, y]…]（0〜1）, edges: [[a, b]…]（a < b） }。点の番号は使う点だけで 0 から振り直す
export function makeFigure(level, rnd) {
  const L = LEVELS[level] ?? LEVELS.normal;
  const { w, h } = L;
  const nb = gridNb(w, h);
  for (let tries = 0; tries < 500; tries++) {
    const want = L.e[0] + Math.floor(rnd() * (L.e[1] - L.e[0] + 1));
    let cur = Math.floor(rnd() * w * h);
    const used = new Set();
    const seen = new Set([cur]);
    while (used.size < want) {
      const opts = nb[cur].filter((d) => !used.has(ek(cur, d)) && !used.has(crossOf(cur, d, w) ?? '-'));
      if (!opts.length) break;
      // まだ行っていない点へ少し行きやすく（点が散らばるように）
      const fresh = opts.filter((d) => !seen.has(d));
      const pick = fresh.length && rnd() < 0.55 ? fresh : opts;
      const d = pick[Math.floor(rnd() * pick.length)];
      used.add(ek(cur, d));
      seen.add(d);
      cur = d;
    }
    if (used.size < L.e[0] || seen.size < L.v[0] || seen.size > L.v[1]) continue;
    // 番号を振り直し、点を少しずらす
    const ids = [...seen].sort((a, b) => a - b);
    const idx = new Map(ids.map((g, k) => [g, k]));
    const pts = ids.map((g) => {
      const x = g % w, y = Math.floor(g / w);
      const jx = (rnd() - 0.5) * 0.24, jy = (rnd() - 0.5) * 0.24;
      return [round3((x + 0.5 + jx) / w), round3((y + 0.5 + jy) / h)];
    });
    const edges = [...used].map((k) => k.split('-').map((v) => idx.get(Number(v)))).map(([a, b]) => (a < b ? [a, b] : [b, a])).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    return { w, h, pts, edges };
  }
  return null;
}
const round3 = (v) => Math.round(v * 1000) / 1000;

// path（点の並び）が、図の全部の線をちょうど1回ずつ通る一筆書きか
export function isTrail(fig, path) {
  if (!Array.isArray(path) || path.length !== fig.edges.length + 1) return false;
  const left = new Set(fig.edges.map(([a, b]) => ek(a, b)));
  for (let i = 0; i < path.length; i++) {
    if (!Number.isInteger(path[i]) || path[i] < 0 || path[i] >= fig.pts.length) return false;
    if (i > 0) {
      const k = ek(path[i - 1], path[i]);
      if (!left.has(k)) return false;
      left.delete(k);
    }
  }
  return left.size === 0;
}
// 一筆書きの道を1つ作る（CPU と自動確認が使う）。奇数の線が出ている点があればそこから始める
export function eulerPath(fig) {
  const adj = fig.pts.map(() => []);
  fig.edges.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });
  const odd = adj.map((a, v) => (a.length % 2 ? v : -1)).filter((v) => v >= 0);
  const start = odd.length ? odd[0] : fig.edges[0][0];
  const usedE = new Uint8Array(fig.edges.length);
  const ptr = adj.map(() => 0);
  const st = [start], out = [];
  while (st.length) {
    const v = st[st.length - 1];
    while (ptr[v] < adj[v].length && usedE[adj[v][ptr[v]][1]]) ptr[v]++;
    if (ptr[v] === adj[v].length) { out.push(st.pop()); continue; }
    const [u, i] = adj[v][ptr[v]];
    usedE[i] = 1;
    st.push(u);
  }
  return out.reverse();
}
export const degreesOf = (fig) => {
  const d = fig.pts.map(() => 0);
  for (const [a, b] of fig.edges) { d[a]++; d[b]++; }
  return d;
};

/* ---------- ゲーム ---------- */

let loc = null; // この端末で描いている道 { key, path, sent }
let ui = null;
const cpuPlan = new Map();

export default {
  id: 'hitofude',
  name: '一筆書き早解き',
  icon: '✏️',
  desc: '同じ線を2回通らずに、図を一筆でなぞる。早く描けた人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '難しさ', desc: 'やさしい: 点6〜8個／ふつう: 点10〜12個／むずかしい: 点15個くらい', def: 'normal', choices: Object.entries(LEVELS).map(([k, v]) => [k, v.label]) },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で描く問題の数', def: 3, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', ...rules };
    const level = levelOf(r);
    const rnd = mulberry32(seed);
    const qs = [];
    while (qs.length < roundsOf(r)) { const f = makeFigure(level, rnd); if (f) qs.push(f); }
    return { n, seed, rules: r, level, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    return m.p === me ? (m.t === 'done' ? 'correct' : 'pop') : 'pop';
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
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limitOf(s), AFTER_MS, GRACE_MS), move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
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
        s.passed = Array(s.n).fill(false);
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
    if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (m.t === 'pass') { const s = clone(s0); s.step += 1; s.passed[m.p] = true; return s; }
    if (m.t !== 'done' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    if (!isTrail(s0.qs[s0.q], m.path)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: limitOf(s) * (0.25 + Math.random() * 0.5), ok: Math.random() < LEVELS[s.level].cpu, done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'done', q: s.q, path: eulerPath(s.qs[s.q]), ms: Math.round(t) };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    // だれかが描けたかどうかは盤を作り直す条件に入れない（なぞっている途中の指が切れるため。数字つなぎ早解きと同じ）。残り時間の帯だけ替える
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${!!o.canMove}`;
    const anySolved = s.solved.some((v) => v !== null);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">描けた！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      if (ui.bar && ui.anySolved !== anySolved) { ui.anySolved = anySolved; ui.bar(); }
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj ft';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${LEVELS[s.level].label}・全${s.qs.length}問・同じ線を2回通らずに、全部の線を一筆でなぞろう</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      const box = document.createElement('div');
      card.append(box);
      ui.anySolved = anySolved;
      ui.bar = () => {
        box.innerHTML = '';
        if (ui.anySolved) {
          box.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが描けた！ もうすぐ締め切り</div>');
          box.append(afterBar(key, limit, AFTER_MS));
        } else box.append(timeBar(key, limit, { secs: true }));
      };
      ui.bar();
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも描けませんでした';
      card.append(t);
    }

    const fig = s.qs[s.q];
    const W = fig.w, H = fig.h;
    const adj = new Map(); // 'a-b' → 線がある
    for (const [a, b] of fig.edges) adj.set(ek(a, b), true);
    if (loc?.key !== key) loc = { key, path: [], sent: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'ft-board' + (playing ? ' live' : ''));
    const note = document.createElement('p');
    note.className = 'cc-log';
    const P = (v) => [fig.pts[v][0] * W, fig.pts[v][1] * H];
    const usedSet = () => {
      const u = new Set();
      for (let i = 1; i < loc.path.length; i++) u.add(ek(loc.path[i - 1], loc.path[i]));
      return u;
    };
    const draw = () => {
      // 答えを見せる場面と観戦の人は、一筆書きの道の1つを描く
      const showAns = s.phase !== 'open' || me === null;
      const path = showAns ? eulerPath(fig) : loc.path;
      const used = new Set();
      for (let i = 1; i < path.length; i++) used.add(ek(path[i - 1], path[i]));
      let html = '';
      for (const [a, b] of fig.edges) {
        const [x1, y1] = P(a), [x2, y2] = P(b);
        html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ft-edge${used.has(ek(a, b)) ? ' on' : ''}"/>`;
      }
      const tip = path.length ? path[path.length - 1] : -1;
      fig.pts.forEach((_, v) => {
        const [x, y] = P(v);
        html += `<circle cx="${x}" cy="${y}" r=".16" class="ft-pt${v === tip && !showAns ? ' tip' : ''}${showAns && v === path[0] ? ' start' : ''}"/>`;
      });
      svg.innerHTML = html;
      note.textContent = s.phase !== 'open' ? '赤い丸から描き始めると一筆で描けます（答えの一例）' : me === null ? '観戦中（答えの一例を見ています）'
        : s.solved[me] !== null || loc.sent ? `描けた！（${s.solved[me] !== null ? secText(s.solved[me]) : '送っています…'}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています'
        : loc.path.length ? `なぞった線 ${loc.path.length - 1} / ${fig.edges.length}` : `好きな点から描き始めよう（線 ${fig.edges.length} 本）`;
    };
    const finish = () => {
      if (loc.sent || !playing || loc.path.length !== fig.edges.length + 1) return;
      if (!isTrail(fig, loc.path)) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      svg.classList.remove('live');
      o.onMove({ t: 'done', q: s.q, path: loc.path.slice(), ms });
    };
    // なぞり: 指の下の点（近いものだけ）
    const ptAt = (e, reach) => {
      const r = svg.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
      let best = -1, bd = reach;
      fig.pts.forEach((_, v) => { const [px, py] = P(v); const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = v; } });
      return best;
    };
    // v へ進む（進めたら true）。1つ前の点へ同じ線で戻ったら1つ消す
    const stepTo = (v) => {
      const path = loc.path;
      if (v < 0) return false;
      if (!path.length) { path.push(v); return true; }
      const tip = path[path.length - 1];
      if (v === tip) return false;
      if (path.length >= 2 && v === path[path.length - 2]) { path.pop(); return true; }
      const k = ek(tip, v);
      if (!adj.has(k) || usedSet().has(k)) return false;
      path.push(v);
      return true;
    };
    let cur = null;
    svg.onpointerdown = (e) => {
      if (!playing || e.isPrimary === false) return;
      const v = ptAt(e, 0.42);
      if (v < 0) return;
      e.preventDefault();
      cur = { id: e.pointerId };
      try { svg.setPointerCapture?.(e.pointerId); } catch { /* 取り込めなくても動く */ }
      // まだ描いていなければそこから始める。描いている途中なら、今の先から線でつながる点へ進む（押していくだけでも描ける）
      if (!loc.path.length || v !== loc.path[loc.path.length - 1]) stepTo(v);
      draw();
      finish();
    };
    svg.onpointermove = (e) => {
      if (!cur || e.pointerId !== cur.id || !playing) return;
      const v = ptAt(e, 0.3);
      if (v >= 0 && stepTo(v)) { draw(); finish(); }
    };
    const up = (e) => { if (cur && e.pointerId === cur.id) cur = null; };
    svg.onpointerup = up;
    svg.onpointercancel = up;
    draw();
    wrap.append(svg, note);
    if (playing) {
      const row = document.createElement('div');
      row.className = 'tg-btns';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn ghost';
      back.textContent = '↩ 1つ戻す';
      back.onclick = () => { if (!loc.sent) { loc.path.pop(); draw(); } };
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn ghost';
      clear.textContent = 'はじめから';
      clear.onclick = () => { if (!loc.sent) { loc.path = []; draw(); } };
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
      row.append(back, clear, pass);
      wrap.append(row);
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
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
