// 迷路早抜け。全員に同じ迷路を出し、左上のスタートから右下のゴールへ早く着いた人ほど高い点。2〜10人・足りない分は CPU。
// 2026-10-29 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 画面の矢印ボタン・迷路を指でなぞる・PC の矢印キーのどれでも動ける。
//   - 同じ迷路を3問。早く出た順に 3点・2点・それ以降は1点（15パズル早解きとそろえた）。
//   - 迷路の大きさは詳細設定で 小・中（最初）・大。
//   - ほかの人の位置が見える。
//   - 詳細設定「暗やみ」（なし（最初）・あり。2026-10-29 本人が選んだ案）: 自分のまわりしか見えない。
// Claude の判断:
//   - 暗やみで見えるのは、自分のいるマスから縦横2マスずつ（5×5）と、一度通ったマス。🏁 とほかの人の丸は暗い所でも見える。
//     ゴールしたか・あきらめたか・結果を見せる間は全部見える。観戦の人も全部見える。制限時間は1.5倍、CPU の目安の時間は1.3倍。
//   - 迷路は種から作る（穴掘り法。行き止まりの多い1本道の迷路で、スタートからゴールへの道は1つだけ）。小 7×7・中 10×10・大 14×14。
//   - 制限時間は 小60秒・中90秒・大150秒。最初に着いた人から20秒で締め切る（制限時間のほうが先なら制限時間で）。全員着くかあきらめたら1.5秒（15パズル早解きと同じ）。
//   - 送るのはゴールまでの動き（U・D・L・R の文字列）。apply で壁を抜けずにゴールへ着くかを確かめる。
//   - ほかの人の位置は見た目だけなので手の一覧に入れず、動くたびに送りっぱなしにする（o.stream。0.12秒より短い間は1回にまとめる）。CPU の位置は出さない。
//   - なぞるときは、指のあるマスへ向かって、壁に当たるまで1マスずつ進む。
//   - CPU は大きさごとの目安の時間（小20秒・中35秒・大60秒）の半分〜1.5倍で着く。1割の問題はあきらめる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（15パズル早解きと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, seq, ms } / { p, t: 'pass', q }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, SEAT_COLORS } from './party.js';
import { pointsOf } from './make10.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
const ROUNDS = 3;
const SIZES = { s: 7, m: 10, l: 14 };
const LIMITS = { s: 60000, m: 90000, l: 150000 };
const CPU_BASE = { s: 20000, m: 35000, l: 60000 };
const DIRS = { U: [0, -1, 1], R: [1, 0, 2], D: [0, 1, 4], L: [-1, 0, 8] }; // 動き・その向きに開いている印
const BACK = { U: 'D', D: 'U', L: 'R', R: 'L' };

const DARK_SEE = 2; // 暗やみで見える、自分のまわりのマスの数
const levelOf = (r) => (SIZES[r.level] ? r.level : 'm');
const limitOf = (s) => LIMITS[s.level] * (s.rules.dark ? 1.5 : 1);
const qKey = (s, q = s.q) => `meiro:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];

// 種から迷路を作る。返り値はマスごとの開いている向きの印（上1・右2・下4・左8）の配列
export function makeMaze(n, rnd) {
  const open = Array(n * n).fill(0);
  const seen = Array(n * n).fill(false);
  const stack = [0];
  seen[0] = true;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % n, y = Math.floor(c / n);
    const next = Object.entries(DIRS).filter(([, [dx, dy]]) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < n && ny < n && !seen[ny * n + nx];
    });
    if (!next.length) { stack.pop(); continue; }
    const [d, [dx, dy, bit]] = next[Math.floor(rnd() * next.length)];
    const to = (y + dy) * n + x + dx;
    open[c] |= bit;
    open[to] |= DIRS[BACK[d]][2];
    seen[to] = true;
    stack.push(to);
  }
  return open;
}
// c から d へ動けるなら動いた先、動けなければ -1
export function stepOf(maze, n, c, d) {
  if (!DIRS[d] || !(maze[c] & DIRS[d][2])) return -1;
  return c + DIRS[d][0] + DIRS[d][1] * n;
}
export function walk(maze, n, seq) {
  if (typeof seq !== 'string' || seq.length > 4000 || !/^[UDLR]*$/.test(seq)) return -1;
  let c = 0;
  for (const d of seq) { c = stepOf(maze, n, c, d); if (c < 0) return -1; }
  return c;
}
// スタートからゴールまでの道（CPU が使う）
export function solve(maze, n) {
  const prev = Array(n * n).fill(null);
  prev[0] = '';
  const q = [0];
  while (q.length) {
    const c = q.shift();
    if (c === n * n - 1) break;
    for (const d of 'UDLR') {
      const t = stepOf(maze, n, c, d);
      if (t >= 0 && prev[t] === null) { prev[t] = prev[c] + d; q.push(t); }
    }
  }
  return prev[n * n - 1];
}

let loc = null; // この端末で動かしているコマ { key, c, seq, sent, trail }
let ui = null;
const others = new Map(); // 席 → { key, c }（ほかの人の位置）
const cpuPlan = new Map();
let keysBound = false;
let lastSend = 0, sendTimer = null;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  const KEY = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R', w: 'U', s: 'D', a: 'L', d: 'R' };
  document.addEventListener('keydown', (e) => {
    if (!KEY[e.key] || !ui?.press || !ui.wrap.isConnected || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    ui.press(KEY[e.key]);
  });
}

export default {
  id: 'meiro',
  name: '迷路早抜け',
  icon: '🌀',
  desc: '同じ迷路をみんなで同時に解く。早くゴールに着くほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '迷路の大きさ', desc: '大きいほど時間がかかる', def: 'm', choices: [['s', '小（7×7）'], ['m', '中（10×10）'], ['l', '大（14×14）']] },
    { key: 'dark', label: '暗やみ', desc: '自分のまわり（と通った所）しか見えない。制限時間は1.5倍', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'm', dark: false, ...rules };
    const level = levelOf(r);
    const size = SIZES[level];
    const rnd = mulberry32(seed);
    const qs = Array.from({ length: ROUNDS }, () => makeMaze(size, rnd));
    return {
      n, seed, rules: r, level, size, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    return m.p === me && m.t === 'done' ? 'goal' : 'pop';
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
    if (walk(s0.qs[s0.q], s0.size, m.seq) !== s0.size * s0.size - 1) return null;
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
      const at = Math.min(limitOf(s) * 0.9, CPU_BASE[s.level] * (s.rules.dark ? 1.3 : 1) * (0.5 + Math.random()));
      plan = { at, ok: Math.random() < 0.9, done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'done', q: s.q, seq: solve(s.qs[s.q], s.size), ms: Math.round(t) };
  },

  // ほかの人の位置（見た目だけ）
  onStream(d, from) {
    if (!d || !Number.isInteger(d.c) || typeof d.key !== 'string' || from < 0) return;
    others.set(from, { key: d.key, c: d.c });
    ui?.paint?.();
  },

  render(root, s, o) {
    bindKeys();
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${s.solved.some((v) => v !== null)}:${!!o.canMove}`;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">ゴール！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj mz';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const sizeText = `${s.size}×${s.size}`;
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${sizeText}${s.rules.dark ? '・🔦 暗やみ' : ''}・全${s.qs.length}問・1問 ${limitOf(s) / 1000}秒まで</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかがゴール！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれもゴールできませんでした';
      card.append(t);
    }

    const n = s.size;
    const maze = s.qs[s.q];
    const goal = n * n - 1;
    if (loc?.key !== key) loc = { key, c: 0, seq: '', sent: false, trail: new Set([0]) };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const cv = document.createElement('canvas');
    cv.className = 'mz-canvas';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const paint = () => {
      if (!cv.isConnected && cv.dataset.done) return;
      cv.dataset.done = '1';
      const px = Math.min(420, (root.clientWidth || 360) - 4);
      const dpr = window.devicePixelRatio || 1;
      cv.width = px * dpr;
      cv.height = px * dpr;
      cv.style.width = cv.style.height = px + 'px';
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const u = px / n;
      const css = getComputedStyle(cv);
      g.fillStyle = css.getPropertyValue('--field').trim() || '#fff';
      g.fillRect(0, 0, px, px);
      const at = (c) => [(c % n + 0.5) * u, (Math.floor(c / n) + 0.5) * u];
      // 自分の通った所・ゴール
      if (me !== null) {
        g.fillStyle = SEAT_COLORS[me % SEAT_COLORS.length] + '22';
        for (const c of loc.trail) g.fillRect((c % n) * u, Math.floor(c / n) * u, u, u);
      }
      g.font = `${Math.floor(u * 0.7)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('🏁', ...at(goal));
      // 壁
      g.strokeStyle = css.getPropertyValue('--ink').trim() || '#333';
      g.lineWidth = Math.max(2, u * 0.09);
      g.lineCap = 'round';
      g.beginPath();
      for (let c = 0; c < n * n; c++) {
        const x = (c % n) * u, y = Math.floor(c / n) * u;
        if (!(maze[c] & 1)) { g.moveTo(x, y); g.lineTo(x + u, y); }
        if (!(maze[c] & 8)) { g.moveTo(x, y); g.lineTo(x, y + u); }
        if (c % n === n - 1 && !(maze[c] & 2)) { g.moveTo(x + u, y); g.lineTo(x + u, y + u); }
        if (Math.floor(c / n) === n - 1 && !(maze[c] & 4)) { g.moveTo(x, y + u); g.lineTo(x + u, y + u); }
      }
      g.stroke();
      // 暗やみ: 自分のまわりと通った所のほかを塗りつぶし、🏁 だけ描き直す
      if (s.rules.dark && s.phase === 'open' && me !== null && !doneOf(s, me)) {
        const x0 = loc.c % n, y0 = Math.floor(loc.c / n);
        g.fillStyle = css.getPropertyValue('--ink').trim() || '#333'; // 透けると暗い所の壁が読めてしまうので不透明に塗る
        for (let c = 0; c < n * n; c++) {
          const x = c % n, y = Math.floor(c / n);
          if (loc.trail.has(c) || (Math.abs(x - x0) <= DARK_SEE && Math.abs(y - y0) <= DARK_SEE)) continue;
          g.fillRect(x * u - 0.5, y * u - 0.5, u + 1, u + 1);
        }
        g.fillText('🏁', ...at(goal));
      }
      // ほかの人（小さい丸）と自分（大きい丸）
      for (const [p, v] of others) {
        if (v.key !== key || p === me || p >= s.n || s.solved[p] !== null) continue;
        g.fillStyle = SEAT_COLORS[p % SEAT_COLORS.length];
        g.globalAlpha = 0.75;
        g.beginPath();
        g.arc(...at(v.c), u * 0.2, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
      if (me !== null) {
        g.fillStyle = SEAT_COLORS[me % SEAT_COLORS.length];
        g.beginPath();
        g.arc(...at(s.phase === 'open' && !doneOf(s, me) ? loc.c : s.solved[me] !== null ? goal : loc.c), u * 0.33, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.stroke();
      }
      note.textContent = s.phase !== 'open' ? '' : me === null ? '観戦中' : s.solved[me] !== null ? `ゴール！（${secText(s.solved[me])}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています' : '矢印・なぞる・矢印キーで動かす。🏁 を目指そう';
    };
    ui.paint = paint;
    const sendPos = () => {
      const go = () => { lastSend = performance.now(); sendTimer = null; o.stream?.({ key, c: loc.c }); };
      if (sendTimer) return;
      const wait = 120 - (performance.now() - lastSend);
      if (wait <= 0) go(); else sendTimer = setTimeout(go, wait);
    };
    const step = (d) => {
      if (!playing || loc.sent) return false;
      const t = stepOf(maze, n, loc.c, d);
      if (t < 0) return false;
      loc.c = t;
      loc.seq += d;
      loc.trail.add(t);
      return true;
    };
    const finish = () => {
      if (loc.c !== goal || loc.sent) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      o.onMove({ t: 'done', q: s.q, seq: loc.seq, ms });
    };
    const moved = () => { paint(); sendPos(); finish(); };
    ui.press = (d) => { if (step(d)) moved(); };
    // なぞる: 指のあるマスへ向かって、壁に当たるまで1マスずつ進む
    const toward = (e) => {
      if (!playing) return;
      const r = cv.getBoundingClientRect();
      const tx = Math.floor(((e.clientX - r.left) / r.width) * n), ty = Math.floor(((e.clientY - r.top) / r.height) * n);
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) return;
      let any = false;
      for (let k = 0; k < 2 * n; k++) {
        const x = loc.c % n, y = Math.floor(loc.c / n);
        if (x === tx && y === ty) break;
        const opts = [];
        if (tx !== x) opts.push(tx > x ? 'R' : 'L');
        if (ty !== y) opts.push(ty > y ? 'D' : 'U');
        if (Math.abs(ty - y) > Math.abs(tx - x)) opts.reverse();
        const d = opts.find((dd) => stepOf(maze, n, loc.c, dd) >= 0);
        if (!d || !step(d)) break;
        any = true;
      }
      if (any) moved();
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => { dragging = true; cv.setPointerCapture?.(e.pointerId); toward(e); });
    cv.addEventListener('pointermove', (e) => { if (dragging) toward(e); });
    const stop = () => { dragging = false; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    wrap.append(cv, note);
    if (playing) {
      const pad = document.createElement('div');
      pad.className = 'mz-pad';
      for (const [d, label] of [['U', '▲'], ['L', '◀'], ['R', '▶'], ['D', '▼']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary mz-' + d;
        b.textContent = label;
        b.setAttribute('aria-label', { U: '上へ', D: '下へ', L: '左へ', R: '右へ' }[d]);
        b.onclick = () => ui.press(d);
        pad.append(b);
      }
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
      wrap.append(pad, pass);
    }
    requestAnimationFrame(paint);
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
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
