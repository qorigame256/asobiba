// 金魚すくい。泳ぐ金魚をポイですくう。水に長く入れたり速く動かしたりするとポイが破れる。1〜10人・足りない分は CPU（弱め）。
// 2026-11-04 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 押している間はポイが水の中にあり、指を離すと持ち上がって、上にいた金魚が取れる。ポイは水の中にいる時間と、速く動かすほど早く破れる。
//   - 全員が同時に自分の画面で遊び、金魚の動きは全員同じにする。ポイは3枚、時間は60秒。赤い金魚1点・黒い出目金3点・金色の金魚5点（まれ）。
// Claude の判断:
//   - 水そうは横1・たて0.7の広さ（この単位で書く）。金魚は16匹で、どれもゆっくり8の字のように泳ぐ（動き方は種から決まり、全員同じ）。
//     すくった金魚は自分の水そうからだけ消え、2.5秒後に同じ所から次の金魚が出てくる（その金魚の色と動きも種から決まる）。
//   - 金魚の色は 赤 72%・黒 22%・金 6%。
//   - ポイの丈夫さは1。水の中にいると1秒に0.2減る（ずっと入れていると5秒で破れる）。横幅の0.5倍より速く動かすと、その速さに応じてさらに減る（1秒に横幅ぶん動かし続けると2秒ほどで破れる）。
//     持ち上げるとき、上にいた金魚の重さ（赤0.12・黒0.22・金0.18）だけ減る。足りなければ破れて金魚は逃げる。一度にすくえるのは3匹まで。
//   - 破れたら1秒で次のポイ。3枚とも破れたらおしまい（{ t: 'out' } を送る）。全員おしまいになったら1.2秒で終わる。
//   - すくった点は各自の端末で決め、すくうたびに { t: 'scoop', n: 何回目, v: 点, c: 匹数 } を送る（大縄とびと同じく、各自の画面の時間で決める）。
//     局面の数が端末の中で数えた数より少ないあいだは0.5秒ごとに、届いていない分をまとめて送り直す（2色爆弾サバイバルと同じ。ゲストの手がすれ違って消えることがあるため）。
//   - 指で遊ぶときは、ポイを指の少し上に出す（指で金魚が隠れないように）。
//   - CPU は2.5〜4.5秒に1回すくおうとし、5割5分ですくえる（1匹）。1回ごとに2割2分でポイが破れる。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'scoop', n, v, c } / { p, t: 'out' }

import { mulberry32 } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const LIMIT = 60000;
const GRACE_MS = 1500;
export const TANK_H = 0.7;
export const NF = 16;
const RESPAWN = 2500;
const POIS = 3;
const POI_R = 0.085;
export const DRAIN = 0.2; // 水の中で1秒に減る丈夫さ
export const FAST = 0.5; // これより速く動かすと減る（横幅/秒）
const FAST_K = 0.6;
export const KINDS = [
  { v: 1, w: 0.12, r: 0.034, col: '#e8452c', name: '赤' },
  { v: 3, w: 0.22, r: 0.044, col: '#262626', name: '黒' },
  { v: 5, w: 0.18, r: 0.04, col: '#f2b705', name: '金' },
];

// slot 番目の g 代目の金魚（種から。全員同じ）
export function fishOf(seed, slot, g) {
  const rnd = mulberry32((seed ^ Math.imul(slot * 977 + g * 131 + 3, 0x85ebca6b)) >>> 0);
  const r = rnd();
  const kind = r < 0.06 ? 2 : r < 0.28 ? 1 : 0;
  const ax = 0.08 + rnd() * 0.22, ay = 0.05 + rnd() * 0.12;
  return {
    kind,
    cx: ax + 0.04 + rnd() * (0.92 - 2 * ax), cy: ay + 0.05 + rnd() * (TANK_H - 0.1 - 2 * ay), ax, ay,
    wx: (kind === 1 ? 0.0003 : 0.0004) + rnd() * 0.0005, wy: 0.0006 + rnd() * 0.0007, px: rnd() * 6.283, py: rnd() * 6.283,
  };
}
// t ミリ秒の位置
export const posOf = (f, t) => [f.cx + f.ax * Math.sin(f.wx * t + f.px), f.cy + f.ay * Math.sin(f.wy * t + f.py)];
// 持ち上げたとき: 丈夫さ dur で、乗っている金魚 kinds（KINDS の番号）をすくえるか。返り値は残りの丈夫さ（破れたら null）
export function lift(dur, kinds) {
  const load = kinds.reduce((a, k) => a + KINDS[k].w, 0);
  return dur - load < 0 ? null : dur - load;
}
// 水の中で dt 秒、速さ v（横幅/秒）で動かしたときに減る丈夫さ
export const wear = (dt, v) => dt * DRAIN + Math.max(0, v - FAST) * dt * FAST_K;

const key = (s) => `kingyo:${s.seed}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), cnt: s.cnt.slice(), fish: s.fish.slice(), out: s.out.slice() });

const cpuPlan = new Map();
let loc = null; // この端末の記録 { key, gen, back, dur, left, brokeAt, scoops: [{ v, c }], out }
let ui = null;

export default {
  id: 'kingyo',
  name: '金魚すくい',
  icon: '🐠',
  desc: '泳ぐ金魚をポイですくう。水に長く入れるとポイが破れる。60秒で多くすくった人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, phase: 'ready', scores: Array(n).fill(0), cnt: Array(n).fill(0), fish: Array(n).fill(0), out: Array(n).fill(false), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && (p === undefined || !s.out[p]); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'start' ? 'question' : null;
    return null; // 自分の音は端末の中で鳴らす（手が戻るのを待たない）
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '金魚をすくおう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') {
      if (s.out.every((x) => x)) return { key: 'allout', ms: 1200, move: { t: 'end' } };
      return { key: 'play', ms: LIMIT + GRACE_MS, move: { t: 'end' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'start' && s0.phase === 'ready') { const s = clone(s0); s.step += 1; s.phase = 'play'; return s; }
      if (m.t === 'end' && s0.phase === 'play') { const s = clone(s0); s.step += 1; s.phase = 'end'; return s; }
      return null;
    }
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (m.t === 'out') {
      if (s0.out[m.p]) return null;
      const s = clone(s0); s.step += 1; s.out[m.p] = true; return s;
    }
    if (m.t !== 'scoop' || m.n !== s0.cnt[m.p] || !Number.isInteger(m.c) || m.c < 1 || m.c > 3 || !Number.isInteger(m.v) || m.v < m.c || m.v > m.c * 5) return null;
    const s = clone(s0);
    s.step += 1;
    s.cnt[m.p] += 1;
    s.scores[m.p] += m.v;
    s.fish[m.p] += m.c;
    return s;
  },

  cpuDelay(s) { return s.phase === 'play' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.out[p]) return null;
    const pk = key(s) + ':' + p;
    let plan = cpuPlan.get(pk);
    if (!plan) { plan = { next: 2500 + Math.random() * 2000, left: POIS }; cpuPlan.set(pk, plan); if (cpuPlan.size > 100) cpuPlan.delete(cpuPlan.keys().next().value); }
    const t = since(key(s) + ':play');
    if (t < plan.next || t >= LIMIT) return null;
    plan.next = t + 2500 + Math.random() * 2000;
    if (Math.random() < 0.22) {
      plan.left -= 1;
      return plan.left <= 0 ? { t: 'out' } : null;
    }
    if (Math.random() >= 0.55) return null;
    const r = Math.random();
    return { t: 'scoop', n: s.cnt[p], v: r < 0.05 ? 5 : r < 0.25 ? 3 : 1, c: 1 };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const tk = key(s) + ':play';
    const extra = (p) => (s.out[p] ? '<span class="pt-ng">ポイなし</span>' : `<span class="pt-ok">🐟${s.fish[p]}</span>`);
    const chips = scoreChips(o, s.scores, { won: s.phase === 'end' ? leaders(s.scores) : [], extra, steady: true });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    const mount = `${s.seed}:${s.phase}:${me}`;
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.state = s;
      ui.update?.();
      return;
    }
    root.innerHTML = '';
    root.className = 'board kj kg';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    ui = { mount, wrap, chips, state: s };
    if (s.phase === 'ready') {
      wrap.insertAdjacentHTML('beforeend', '<div class="kj-card"><div class="kj-word small">よーい…</div><div class="kj-sub">押している間ポイが水の中に入り、離すとすくえる・赤1点 黒3点 金5点・ポイは3枚・60秒</div></div>');
      return;
    }
    if (s.phase === 'end') return;
    since(tk);
    if (loc?.key !== tk) loc = { key: tk, gen: Array(NF).fill(0), back: Array(NF).fill(0), dur: 1, left: POIS, brokeAt: -1e9, scoops: [], out: false };
    const card = document.createElement('div');
    card.className = 'kj-card kg-card';
    card.append(timeBar(tk, LIMIT));
    const cv = document.createElement('canvas');
    cv.className = 'kg-canvas';
    card.append(cv);
    const note = document.createElement('p');
    note.className = 'cc-log';
    wrap.append(card, note);

    const playing = () => ui.state.phase === 'play' && me !== null && o.canMove && !loc.out && since(tk) < LIMIT;
    const sendOwn = () => {
      const st = ui.state;
      if (me === null || st.phase !== 'play') return;
      for (let n = st.cnt[me]; n < loc.scoops.length; n++) o.onMove({ t: 'scoop', n, ...loc.scoops[n] }); // 届いていない分をまとめて（2回目に届いた手は弾かれる）
      if (loc.out && !st.out[me]) o.onMove({ t: 'out' });
    };
    ui.update = () => {
      const st = ui.state;
      const mine = me !== null ? loc.scoops.reduce((a, x) => a + x.v, 0) : 0;
      note.textContent = me === null ? '観戦中'
        : loc.out ? `ポイがなくなりました（${mine}点）。ほかの人を待っています`
        : since(tk) >= LIMIT ? `時間です（${mine}点）`
        : `ポイ ${'🥅'.repeat(loc.left)}（のこり${loc.left}枚）・赤1点 黒3点 金5点`;
      if (st.phase === 'play' && me !== null && st.cnt[me] > loc.scoops.length) { // 開き直したとき: 局面の数から続ける
        while (loc.scoops.length < st.cnt[me]) loc.scoops.push({ v: 1, c: 1 });
      }
    };
    ui.update();
    // 送り直し（0.5秒ごと）
    const resend = () => {
      if (!wrap.isConnected || ui?.wrap !== wrap) return;
      sendOwn();
      setTimeout(resend, 500);
    };
    setTimeout(resend, 500);

    // ポイの操作
    let poi = null; // { x, y, t, lift } 水の中にあるとき
    let aim = null; // 水の外にあるときの位置（見せるだけ）
    const toXY = (e, lift) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width - lift]; };
    const tNow = () => since(tk);
    const ready = () => tNow() - loc.brokeAt >= 1000;
    const broke = () => {
      poi = null;
      loc.left -= 1;
      loc.brokeAt = tNow();
      loc.dur = 1;
      play('wrong', 0.5);
      if (loc.left <= 0) { loc.out = true; sendOwn(); }
      ui.update();
    };
    const under = (x, y, t) => {
      const got = [];
      for (let i = 0; i < NF; i++) {
        if (loc.back[i] > t) continue;
        const f = fishOf(s.seed, i, loc.gen[i]);
        const [fx, fy] = posOf(f, t);
        if (Math.sqrt((fx - x) ** 2 + (fy - y) ** 2) <= POI_R - KINDS[f.kind].r * 0.3) got.push([i, f.kind]);
      }
      return got.slice(0, 3);
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!playing() || !ready()) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const lift = e.pointerType === 'touch' ? 0.1 : 0;
      const [x, y] = toXY(e, lift);
      poi = { x, y, t: tNow(), lift };
      play('pop', 0.3);
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = toXY(e, poi?.lift ?? (e.pointerType === 'touch' ? 0.1 : 0));
      if (!poi) { aim = [x, y]; return; }
      const t = tNow();
      const dt = Math.max(0.001, (t - poi.t) / 1000);
      const v = Math.sqrt((x - poi.x) ** 2 + (y - poi.y) ** 2) / dt;
      loc.dur -= Math.max(0, v - FAST) * dt * FAST_K; // 速く動かした分（水の中にいる時間の分は描くときに減らす）
      Object.assign(poi, { x, y, t });
      if (loc.dur <= 0) broke();
    });
    const up = () => {
      if (!poi) return;
      const t = tNow();
      const got = t < LIMIT ? under(poi.x, poi.y, t) : [];
      poi = null;
      if (!got.length || !playing()) return;
      const left = lift(loc.dur, got.map(([, k]) => k));
      if (left === null) { broke(); return; }
      loc.dur = left;
      for (const [i] of got) { loc.gen[i] += 1; loc.back[i] = t + RESPAWN; }
      const v = got.reduce((a, [, k]) => a + KINDS[k].v, 0);
      loc.scoops.push({ v, c: got.length });
      play(got.some(([, k]) => k > 0) ? 'correct' : 'hit', 0.7);
      sendOwn();
      ui.update();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { poi = null; });
    cv.addEventListener('pointerleave', () => { aim = null; });

    // 描く
    let lastT = tNow();
    const draw = () => {
      if (!cv.isConnected || ui?.wrap !== wrap) return;
      const t = tNow();
      // 水の中にいる時間で減る
      if (poi && playing()) { loc.dur -= ((t - lastT) / 1000) * DRAIN; if (loc.dur <= 0) broke(); }
      if (poi && !playing()) poi = null;
      lastT = t;
      const W = Math.min(560, (root.clientWidth || 360) - 16), H = Math.round(W * TANK_H);
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const g = cv.getContext('2d');
      g.setTransform(W * dpr, 0, 0, W * dpr, 0, 0); // 1単位 = 水そうの横幅
      const bg = g.createLinearGradient(0, 0, 0, TANK_H);
      bg.addColorStop(0, '#7cc8ef'); bg.addColorStop(1, '#3d8fc4');
      g.fillStyle = bg;
      g.fillRect(0, 0, 1, TANK_H);
      // 金魚
      for (let i = 0; i < NF; i++) {
        if (loc.back[i] > t) continue;
        const f = fishOf(s.seed, i, loc.gen[i]);
        const [x, y] = posOf(f, t);
        const [x2, y2] = posOf(f, t + 60);
        const ang = Math.atan2(y2 - y, x2 - x);
        const k = KINDS[f.kind];
        const fade = loc.back[i] > 0 && t - loc.back[i] < 600 ? (t - loc.back[i]) / 600 : 1;
        g.save();
        g.globalAlpha = fade;
        g.translate(x, y);
        g.rotate(ang);
        g.fillStyle = k.col;
        const wag = Math.sin(t / 120 + i) * 0.25;
        g.beginPath(); g.moveTo(-k.r * 0.8, 0); g.lineTo(-k.r * 1.9, -k.r * (0.7 + wag)); g.lineTo(-k.r * 1.9, k.r * (0.7 - wag)); g.closePath(); g.fill();
        g.beginPath(); g.ellipse(0, 0, k.r, k.r * 0.6, 0, 0, Math.PI * 2); g.fill();
        if (f.kind === 2) { g.strokeStyle = '#fff6c0'; g.lineWidth = 0.004; g.stroke(); }
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(k.r * 0.5, -k.r * 0.25, k.r * (f.kind === 1 ? 0.28 : 0.16), 0, Math.PI * 2); g.fill();
        g.fillStyle = '#000';
        g.beginPath(); g.arc(k.r * 0.55, -k.r * 0.25, k.r * 0.09, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      // ポイ
      const p = poi ? [poi.x, poi.y] : aim;
      if (p && me !== null && !loc.out) {
        const torn = !ready();
        g.save();
        g.strokeStyle = '#d23b3b'; g.lineWidth = 0.012;
        g.beginPath(); g.moveTo(p[0] + POI_R * 0.7, p[1] + POI_R * 0.7); g.lineTo(p[0] + POI_R * 1.9, p[1] + POI_R * 1.9); g.stroke();
        g.beginPath(); g.arc(p[0], p[1], POI_R, 0, Math.PI * 2);
        g.fillStyle = torn ? 'rgba(255,255,255,0)' : poi ? `rgba(255,255,255,${0.15 + 0.35 * Math.max(0, loc.dur)})` : 'rgba(255,255,255,.75)';
        g.fill();
        g.stroke();
        if (torn) { g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(p[0] - POI_R, p[1]); g.arc(p[0], p[1], POI_R, Math.PI, Math.PI * 1.35); g.closePath(); g.fill(); }
        g.restore();
      }
      // 丈夫さの帯（水の中にあるとき）
      if (poi) {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0.02, 0.02, 0.3, 0.025);
        g.fillStyle = loc.dur > 0.4 ? '#7dff9a' : '#ff6b5a'; g.fillRect(0.02, 0.02, 0.3 * Math.max(0, loc.dur), 0.025);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    setTimeout(() => { if (ui?.wrap === wrap) ui.update(); }, Math.max(0, LIMIT - since(tk)) + 50);
  },
};
