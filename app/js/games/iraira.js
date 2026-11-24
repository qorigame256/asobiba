// イライラ棒。くねくねした道を、玉を壁にさわらせずにゴールまで運ぶ早さを競う。2〜10人・足りない分は CPU（弱め）。
// 2026-11-24 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 指かマウスで玉を引っぱって動かす。指を離すと玉はその場で止まり、続きは玉に触れてから動かす（離れた所に指を置いて玉を飛ばせないように）。
//   - 壁にさわったら、最後に通った途中の旗まで戻る（スマホは指で道が隠れるので、毎回スタートまで戻ると厳しすぎるため）。
//   - 3問。早くゴールした順に 3・2・1点（迷路早抜けと同じ）。詳細設定「むずかしさ」で道の太さを やさしい・ふつう（最初）・むずかしい から選ぶ。
//   - ほかの人の玉を自分の画面に薄く出す。送るのは1秒に5回まで（通信の上限より下に収める。CLAUDE.md の「中継サーバーは…1秒ごとに10通まで」）。
// Claude の判断:
//   - 道は種から作る。n×n のます目に迷路（穴掘り法）を作り、左上から右下への道を道筋にする（くねくねと長くなる）。1問目 4×4・2問目 5×5・3問目 6×6。
//     道の中心の折れ線から（道の太さの半分 − 玉の半径）より離れたら壁にさわったことにする（画面の道も同じ折れ線を丸い角で太く描くので、見た目と判定がそろう）。
//   - 道の太さ（ます1つの幅に対する割合）は やさしい 0.62・ふつう 0.5・むずかしい 0.38。玉の半径はます1つの幅の 0.09。
//   - 途中の旗は道筋の3分の1と3分の2のますに置く。旗のますの中心に玉が近づいたら（道の太さの半分以内）通ったことにする。ゴールも同じ。
//   - 指を動かしたら、玉は指の位置へ 0.4（画面の幅 100 に対して）ずつ進み、そのたびに壁を確かめる（速く動かしても壁を抜けないように）。
//   - 指を置いて玉をつかめるのは、玉の中心から ます1つの幅の 0.45 以内（スマホの指でもつかめるように）。
//   - 壁にさわったら、玉は最後の旗（無ければスタート）へ戻り、もう一度玉に触れるまで動かない。さわった回数は自分の画面にだけ出す（点には入れない）。
//   - 1問の制限時間は 1問目45秒・2問目60秒・3問目75秒（むずかしいは1.3倍）。最初にゴールした人から20秒で締め切る（迷路早抜けと同じ）。全員がゴールかあきらめたら1.5秒。
//   - 送るのはゴールした時間だけ（道筋を通ったかは確かめない。ほかの早押しと同じく各自の端末で測った ms を信じる）。
//   - ほかの人の玉の位置は手の一覧に入れず、送りっぱなし（o.stream）。0.2秒より短い間は1回にまとめる。CPU の玉は出さない。
//   - CPU は 1問目12秒・2問目18秒・3問目25秒を目安に（やさしい0.8倍・むずかしい1.4倍）、その0.6〜1.5倍でゴールする。1割の問題はあきらめる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（迷路早抜けと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, ms } / { p, t: 'pass', q }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, SEAT_COLORS } from './party.js';
import { pointsOf } from './make10.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
export const GRIDS = [4, 5, 6];
const LIMITS = [45000, 60000, 75000];
const CPU_BASE = [12000, 18000, 25000];
const LEVELS = [['easy', 'やさしい（道が太い）'], ['normal', 'ふつう'], ['hard', 'むずかしい（道が細い）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
export const WIDTH = { easy: 0.62, normal: 0.5, hard: 0.38 };
export const BALL = 0.09;
const GRAB = 0.45;
const STEP = 0.4;
export const W = 100;
const SEND_MS = 200;

// 迷路の左上から右下への道筋（ますの番号の並び）
function pathOf(n, rnd) {
  const seen = new Set([0]);
  const prev = new Map();
  const stack = [0];
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % n, y = Math.floor(c / n);
    const nb = [];
    if (x > 0) nb.push(c - 1);
    if (x < n - 1) nb.push(c + 1);
    if (y > 0) nb.push(c - n);
    if (y < n - 1) nb.push(c + n);
    const open = nb.filter((t) => !seen.has(t));
    if (!open.length) { stack.pop(); continue; }
    const t = open[Math.floor(rnd() * open.length)];
    seen.add(t);
    prev.set(t, c);
    stack.push(t);
  }
  const out = [n * n - 1];
  while (out[0] !== 0) out.unshift(prev.get(out[0]));
  return out;
}

// 1問の道。pts = 道の中心の折れ線（ますの中心）、cps = 途中の旗の点の番号、u = ます1つの幅、w = 道の太さ、r = 玉の半径
export function makeCourse(seed, q, level) {
  const n = GRIDS[q] ?? GRIDS[GRIDS.length - 1];
  const rnd = mulberry32((seed * 97 + q * 389 + 5) >>> 0);
  const cells = pathOf(n, rnd);
  const u = W / n;
  const pts = cells.map((c) => [(c % n + 0.5) * u, (Math.floor(c / n) + 0.5) * u]);
  const len = pts.length;
  return { n, u, w: u * (WIDTH[level] ?? WIDTH.normal), r: u * BALL, pts, cps: [Math.floor(len / 3), Math.floor((2 * len) / 3)] };
}

// 点から折れ線までのいちばん近い距離
export function distTo(c, x, y) {
  let best = Infinity;
  for (let i = 0; i + 1 < c.pts.length; i++) {
    const [ax, ay] = c.pts[i], [bx, by] = c.pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
export const hitsWall = (c, x, y) => distTo(c, x, y) > c.w / 2 - c.r;

const qKey = (s, q = s.q) => `iraira:${s.seed}:${levelOf(s.rules)}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
const limitOf = (s, q = s.q) => LIMITS[q] * (levelOf(s.rules) === 'hard' ? 1.3 : 1);

let loc = null; // この端末で動かしている玉 { key, x, y, cp, hits, grab, sent }
let ui = null;
const others = new Map(); // 席 → { key, x, y }（ほかの人の玉）
const cpuPlan = new Map();
let lastSend = 0, sendTimer = null;

export default {
  id: 'iraira',
  name: 'イライラ棒',
  icon: '⚡',
  desc: 'くねくね道を、玉を壁にさわらせずにゴールまで運ぶ早さを競う',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '道の太さ。細いほど壁にさわりやすい', def: 'normal', choices: LEVELS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', ...rules };
    const qs = GRIDS.map((_, q) => makeCourse(seed, q, levelOf(r)));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last?.winners.includes(me) ? 'correct' : 'pop';
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
      const lv = { easy: 0.8, normal: 1, hard: 1.4 }[levelOf(s.rules)];
      plan = { at: Math.min(limitOf(s) * 0.9, CPU_BASE[s.q] * lv * (0.6 + Math.random() * 0.9)), ok: Math.random() < 0.9, done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    return plan.ok ? { t: 'done', q: s.q, ms: Math.round(t) } : { t: 'pass', q: s.q };
  },

  // ほかの人の玉の位置（見た目だけ）
  onStream(d, from) {
    if (!d || typeof d.key !== 'string' || typeof d.x !== 'number' || typeof d.y !== 'number' || from < 0) return;
    others.set(from, { key: d.key, x: d.x, y: d.y });
    ui?.paintOthers?.();
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    // 同じ場面のうちは道と玉を作り直さず、点数の札だけ差し替える（引っぱっている指を切らないため。迷路早抜けと同じ）
    // だれかがゴールしたかは入れない（入れると、引っぱっている途中で道が作り直されて指が切れる。数字つなぎ早解きと同じ。残り時間の帯だけ替える）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${!!o.canMove}`;
    const anySolved = s.solved.some((v) => v !== null);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">ゴール！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; ui.bar?.(anySolved); return; }

    root.innerHTML = '';
    root.className = 'board kj irb';
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">玉を引っぱって 🏁 へ。壁にさわったら 🚩 まで戻る・全${s.qs.length}問</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    if (s.phase === 'open') {
      since(key);
      const slot = document.createElement('div');
      card.append(slot);
      let was = null;
      ui.bar = (any) => {
        if (any === was) return;
        was = any;
        slot.innerHTML = '';
        if (any) {
          slot.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかがゴール！ もうすぐ締め切り</div>');
          slot.append(afterBar(key, limit, AFTER_MS));
        } else slot.append(timeBar(key, limit, { secs: true }));
      };
      ui.bar(anySolved);
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれもゴールできませんでした';
      card.append(t);
    }

    const c = s.qs[s.q];
    const [sx, sy] = c.pts[0];
    const [gx, gy] = c.pts[c.pts.length - 1];
    if (loc?.key !== key) loc = { key, x: sx, y: sy, cp: -1, hits: 0, grab: false, sent: false };
    loc.grab = false; // 作り直した道では、もう一度玉に触れてから動かす
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    svg.setAttribute('class', 'irb-fig' + (playing ? ' live' : ''));
    const d = 'M' + c.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L');
    const flag = (x, y, t, cls) => `<text class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${(c.u * 0.42).toFixed(2)}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
    svg.innerHTML = `<rect class="irb-wall" x="0" y="0" width="${W}" height="${W}" rx="3"/>`
      + `<path class="irb-edge" d="${d}" stroke-width="${(c.w + 1.2).toFixed(2)}"/>`
      + `<path class="irb-road" d="${d}" stroke-width="${c.w.toFixed(2)}"/>`
      + `<circle class="irb-start" cx="${sx}" cy="${sy}" r="${(c.w * 0.42).toFixed(2)}"/>`
      + c.cps.map((i) => flag(c.pts[i][0], c.pts[i][1], '🚩', 'irb-cp')).join('')
      + flag(gx, gy, '🏁', 'irb-goal')
      + '<g class="irb-others"></g>'
      + `<circle class="irb-ball" r="${c.r.toFixed(2)}"/>`;
    const ball = svg.querySelector('.irb-ball');
    const othersG = svg.querySelector('.irb-others');
    if (me !== null) ball.setAttribute('fill', SEAT_COLORS[me % SEAT_COLORS.length]);
    else ball.style.display = 'none';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const says = () => {
      if (s.phase !== 'open') return '';
      if (me === null) return '観戦中';
      if (s.solved[me] !== null) return `ゴール！（${secText(s.solved[me])}）ほかの人を待っています`;
      if (s.passed[me]) return 'あきらめました。ほかの人を待っています';
      const h = loc.hits ? `　💥 さわった回数 ${loc.hits}` : '';
      return (loc.grab ? '🏁 まで運ぼう' : '玉に触れて、引っぱって動かす') + h;
    };
    const paintBall = () => {
      const done = me !== null && s.solved[me] !== null;
      ball.setAttribute('cx', (done ? gx : loc.x).toFixed(2));
      ball.setAttribute('cy', (done ? gy : loc.y).toFixed(2));
      ball.classList.toggle('grab', loc.grab);
      note.textContent = says();
    };
    const paintOthers = () => {
      if (!othersG.isConnected && othersG.dataset.on) return;
      othersG.dataset.on = '1';
      othersG.innerHTML = '';
      for (const [p, v] of others) {
        if (v.key !== key || p === me || p >= s.n || doneOf(s, p)) continue;
        const e = document.createElementNS(ns, 'circle');
        e.setAttribute('cx', v.x.toFixed(2));
        e.setAttribute('cy', v.y.toFixed(2));
        e.setAttribute('r', (c.r * 0.85).toFixed(2));
        e.setAttribute('fill', SEAT_COLORS[p % SEAT_COLORS.length]);
        othersG.append(e);
      }
    };
    ui.paintOthers = paintOthers;
    const sendPos = () => {
      const go = () => { lastSend = performance.now(); sendTimer = null; o.stream?.({ key, x: Math.round(loc.x * 10) / 10, y: Math.round(loc.y * 10) / 10 }); };
      if (sendTimer) return;
      const wait = SEND_MS - (performance.now() - lastSend);
      if (wait <= 0) go(); else sendTimer = setTimeout(go, wait);
    };
    const near = (x, y, px, py) => Math.hypot(x - px, y - py) <= c.w / 2;
    const finish = () => {
      if (loc.sent) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      loc.grab = false;
      o.onMove({ t: 'done', q: s.q, ms });
    };
    const crash = () => {
      loc.hits += 1;
      loc.grab = false;
      const back = loc.cp >= 0 ? c.pts[c.cps[loc.cp]] : c.pts[0];
      loc.x = back[0];
      loc.y = back[1];
      svg.classList.remove('crash');
      void svg.getBoundingClientRect(); // 光らせる動きを最初からやり直す
      svg.classList.add('crash');
      play('wrong', 0.5);
    };
    // 玉を指の位置へ少しずつ進め、そのたびに壁と旗とゴールを確かめる
    const moveTo = (tx, ty) => {
      const dist = Math.hypot(tx - loc.x, ty - loc.y);
      const k = Math.max(1, Math.ceil(dist / STEP));
      const x0 = loc.x, y0 = loc.y;
      for (let i = 1; i <= k; i++) {
        const x = x0 + ((tx - x0) * i) / k, y = y0 + ((ty - y0) * i) / k;
        if (hitsWall(c, x, y)) { crash(); return; }
        loc.x = x;
        loc.y = y;
        c.cps.forEach((pi, j) => { if (j > loc.cp && near(x, y, ...c.pts[pi])) loc.cp = j; });
        if (near(x, y, gx, gy)) { finish(); return; }
      }
    };
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * W];
    };
    if (playing) {
      svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || loc.sent || since(key) >= limit) return;
        const [x, y] = at(e);
        if (Math.hypot(x - loc.x, y - loc.y) > c.u * GRAB) return;
        e.preventDefault();
        loc.grab = true;
        try { svg.setPointerCapture?.(e.pointerId); } catch { /* 指の番号が古いときは捕まえずに続ける */ }
        paintBall();
      });
      svg.addEventListener('pointermove', (e) => {
        if (!loc.grab || loc.sent) return;
        if (since(key) >= limit) { loc.grab = false; paintBall(); return; }
        moveTo(...at(e));
        paintBall();
        sendPos();
      });
      const stop = () => { if (loc.grab) { loc.grab = false; paintBall(); } };
      svg.addEventListener('pointerup', stop);
      svg.addEventListener('pointercancel', stop);
    }
    card.append(svg);
    wrap.append(note);
    if (playing) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; loc.grab = false; o.onMove({ t: 'pass', q: s.q }); };
      wrap.append(pass);
    }
    paintBall();
    paintOthers();
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
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(`${GRIDS[q]}×${GRIDS[q]} の道`), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
