// 積み上げタワー。左右に動くブロックを押して落とし、はみ出た分は切り落とす。いちばん高く積んだ人の勝ち。1〜10人・足りない分は CPU（弱め）。
// 2026-11-04 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 左右に動くブロックを押して落とし、はみ出た分は切り落とす。ぴったり重ねたら幅が少し戻る。全部はみ出たら終わりで、いちばん高く積んだ人の勝ち。
//   - 全員同時に遊び、ブロックの動き方は全員同じ。段が上がるほど速くなる。
// Claude の判断:
//   - 横の広さは −1〜1。いちばん下の台とはじめのブロックの幅は 0.6。ブロックは −0.9〜0.9 を行ったり来たりする（偶数の段は左から、奇数の段は右から出る）。
//   - 速さは 1秒に 0.7 から1段ごとに 0.04 ずつ上がり、いちばん速くて 2.4。
//   - ずれが 0.015 以下なら「ぴったり」で、真上にそろえて幅を 0.02 戻す（0.6 まで）。
//   - 次のブロックは前のを落としてから 0.35秒で出る。100段積んだらそこで上がり（それ以上は積まない）。
//   - 積めたかは各自の端末で決め、1段ごとに { t: 'up', k: 何段目 } を、おしまいに { t: 'over', k } を送る（大縄とびと同じく、各自の画面の時間で決める）。
//     局面の数が端末の中で数えた数より少ないあいだは0.5秒ごとに、届いていない分をまとめて送り直す（金魚すくいと同じ）。
//   - 全員おしまいになったら1.2秒で終わる。念のため始まって5分でも終わる。同じ高さの人は同じ順位。
//   - CPU は1段ごとに 0.8〜1.6秒で落とし、ずれは真ん中から ±(0.035 + 段の数×0.003) くらい（ふつうの分かれ方）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'up', k } / { p, t: 'over', k }

import { scoreChips, since, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const LIMIT = 300000;
export const BASE = 0.6;
const RANGE = 0.9;
export const PERFECT = 0.015;
const GROW = 0.02;
const GAP = 350;
export const MAX = 100;
export const speedOf = (k) => Math.min(2.4, 0.7 + 0.04 * k);
// k 段目のブロックの真ん中の位置（出てから t ミリ秒）
export function xOf(k, t) {
  const d = (speedOf(k) * t / 1000) % (RANGE * 4);
  const x = d <= RANGE * 2 ? -RANGE + d : RANGE - (d - RANGE * 2);
  return k % 2 === 0 ? x : -x;
}
// 前の段（真ん中 px・幅 pw）の上に、真ん中 x で落としたときの次の段 { x, w, perfect }（全部はみ出たら null）
export function stack(px, pw, x) {
  const dx = x - px;
  if (Math.abs(dx) <= PERFECT) return { x: px, w: Math.min(BASE, pw + GROW), perfect: true };
  const w = pw - Math.abs(dx);
  if (w <= 0.0005) return null;
  return { x: px + dx / 2, w, perfect: false };
}

const key = (s) => `tower:${s.seed}`;
const clone = (s) => ({ ...s, h: s.h.slice(), over: s.over.slice() });

function finish(s) {
  const top = Math.max(...s.h);
  const winners = s.h.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
  const place = s.h.map((v) => 1 + s.h.filter((x) => x > v).length);
  return { winners, place, heights: s.h.slice() };
}

const cpuPlan = new Map();
let loc = null; // この端末の記録 { key, blocks: [{ x, w }], at: 今の段が出た時刻, over, cut: 切り落とした所の絵 }
let ui = null;
let keysBound = false;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !ui?.drop || !ui.wrap.isConnected || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    if (!e.repeat) ui.drop();
  });
}

export default {
  id: 'tower',
  name: '積み上げタワー',
  icon: '🏗️',
  desc: '動くブロックをタイミングよく落として積む。はみ出た分は切れる。いちばん高く積んだ人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, phase: 'ready', h: Array(n).fill(0), over: Array(n).fill(false), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && (p === undefined || !s.over[p]); },
  result(s) { return s.phase === 'end' ? finish(s) : null; },
  sound(a, b, m) { return m.p === -1 && m.t === 'start' ? 'question' : null; }, // 自分の音は端末の中で鳴らす
  resultText(res, me, pn) {
    const h = res.heights[res.winners[0]];
    if (res.winners.length === 1) return res.winners[0] === me ? `${h}段で、あなたの勝ち！🎉` : `${pn(res.winners[0])}の勝ち！（${h}段）`;
    return `${res.winners.map(pn).join('・')}が${h}段で同じ1位！${res.winners.includes(me) ? '🎉' : ''}`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : 'タイミングよく落として積もう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') {
      if (s.over.every((x) => x)) return { key: 'allover', ms: 1200, move: { t: 'end' } };
      return { key: 'play', ms: LIMIT, move: { t: 'end' } };
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
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.over[m.p] || m.k !== s0.h[m.p]) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.t === 'up') {
      s.h[m.p] += 1;
      if (s.h[m.p] >= MAX) s.over[m.p] = true;
      return s;
    }
    if (m.t === 'over') { s.over[m.p] = true; return s; }
    return null;
  },

  cpuDelay(s) { return s.phase === 'play' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.over[p]) return null;
    const pk = key(s) + ':' + p;
    let plan = cpuPlan.get(pk);
    const t = since(key(s) + ':play');
    // ホストが開き直すと覚えが消えるので、局面の高さから続ける（幅は真ん中に積んできたことにする）
    if (!plan || plan.k < s.h[p] || (plan.k > s.h[p] && plan.last?.k !== s.h[p])) {
      plan = { k: s.h[p], x: 0, w: plan?.w ?? BASE, at: t + 800 + Math.random() * 800, last: null };
      cpuPlan.set(pk, plan);
      if (cpuPlan.size > 100) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (plan.k > s.h[p]) return plan.last; // 返した手がまだ局面に入っていない: 同じ手をもう一度（2回目は弾かれる）
    if (t < plan.at) return null;
    const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * (0.035 + plan.k * 0.003);
    const next = stack(plan.x, plan.w, plan.x + g);
    const k = plan.k;
    if (!next) return { t: 'over', k };
    Object.assign(plan, { k: k + 1, x: next.x, w: next.w, at: t + 800 + Math.random() * 800, last: { t: 'up', k } });
    return plan.last;
  },

  render(root, s, o) {
    bindKeys();
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const tk = key(s) + ':play';
    const extra = (p) => (s.over[p] ? `<span class="pt-ng">${s.h[p] >= MAX ? '上がり' : 'おしまい'}</span>` : '<span class="pt-ok">積んでいる</span>');
    const chips = scoreChips(o, s.h, { won: s.phase === 'end' ? finish(s).winners : [], extra, steady: true });
    chips.querySelectorAll('.pt-score small').forEach((e) => { e.textContent = '段'; });
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
    root.className = 'board kj tw';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    ui = { mount, wrap, chips, state: s };
    if (s.phase === 'ready') {
      wrap.insertAdjacentHTML('beforeend', '<div class="kj-card"><div class="kj-word small">よーい…</div><div class="kj-sub">動くブロックが下のブロックに重なる所で「落とす」を押そう（PC はスペースキーでも）。はみ出た分は切れます</div></div>');
      return;
    }
    if (s.phase === 'end') return;
    since(tk);
    if (loc?.key !== tk) loc = { key: tk, blocks: [{ x: 0, w: BASE }], at: 1000, over: false, cut: null, perfect: -1e9 };
    if (me !== null && s.h[me] > loc.blocks.length - 1) { // 開き直したとき: 局面の高さまで真ん中に積んだことにする
      const top = loc.blocks.at(-1);
      while (loc.blocks.length - 1 < s.h[me]) loc.blocks.push({ ...top });
      loc.at = since(tk) + 1000;
    }
    if (me !== null && s.over[me]) loc.over = true;
    const card = document.createElement('div');
    card.className = 'kj-card tw-card';
    const cv = document.createElement('canvas');
    cv.className = 'tw-canvas';
    card.append(cv);
    const note = document.createElement('p');
    note.className = 'cc-log';
    wrap.append(card);
    const height = () => loc.blocks.length - 1;
    const playing = () => ui.state.phase === 'play' && me !== null && o.canMove && !loc.over && height() < MAX;
    let btn = null;
    const sendOwn = () => {
      const st = ui.state;
      if (me === null || st.phase !== 'play' || st.over[me]) return;
      for (let k = st.h[me]; k < height(); k++) o.onMove({ t: 'up', k }); // 届いていない分をまとめて（2回目に届いた手は弾かれる）
      if (loc.over && height() < MAX) o.onMove({ t: 'over', k: height() });
    };
    ui.update = () => {
      note.textContent = me === null ? '観戦中'
        : height() >= MAX ? `${MAX}段！ 上がりです`
        : loc.over ? `${height()}段でおしまい。ほかの人を待っています`
        : `${height()}段 ・ 下のブロックに重なる所で落とそう`;
      if (btn) btn.disabled = !playing();
    };
    ui.drop = () => {
      if (!playing()) return;
      const t = since(tk);
      if (t < loc.at) return; // 次のブロックがまだ出ていない
      const k = height();
      const x = xOf(k, t - loc.at);
      const prev = loc.blocks.at(-1);
      const next = stack(prev.x, prev.w, x);
      if (!next) {
        loc.over = true;
        loc.cut = { x, w: prev.w, y: k + 1, t };
        play('lose', 0.6);
      } else {
        const cutW = Math.abs(x - prev.x) <= PERFECT ? 0 : Math.abs(x - prev.x);
        if (cutW > 0) loc.cut = { x: x > prev.x ? next.x + next.w / 2 + cutW / 2 : next.x - next.w / 2 - cutW / 2, w: cutW, y: k + 1, t };
        loc.blocks.push({ x: next.x, w: next.w });
        loc.at = t + GAP;
        if (next.perfect) { loc.perfect = t; play('correct', 0.5); } else play('place', 0.6);
        if (height() >= MAX) loc.over = true;
      }
      sendOwn();
      ui.update();
    };
    if (me !== null) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary tw-btn';
      btn.textContent = '落とす！';
      btn.onpointerdown = (e) => { e.preventDefault(); ui.drop(); };
      btn.onclick = (e) => { if (e.detail === 0) ui.drop(); };
      cv.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.drop(); });
      wrap.append(btn);
    }
    wrap.append(note);
    ui.update();
    const resend = () => {
      if (!wrap.isConnected || ui?.wrap !== wrap) return;
      sendOwn();
      setTimeout(resend, 500);
    };
    setTimeout(resend, 500);

    // 描く
    const draw = () => {
      if (!cv.isConnected || ui?.wrap !== wrap) return;
      const t = since(tk);
      const W = Math.min(440, (root.clientWidth || 360) - 4), H = Math.round(Math.min(W * 1.05, Math.max(260, (window.innerHeight || 700) * 0.5))); // 下の「落とす」が画面に入るように
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const unit = W / 2.2; // 横の1
      const bh = Math.max(12, H / 16); // 1段の高さ
      const k = height();
      const camTop = Math.max(0, k - 9); // これより下の段は画面の外
      const yOf = (i) => H - 24 - (i - camTop) * bh; // i 段目の下の端
      const X = (x) => W / 2 + x * unit;
      const color = (i) => `hsl(${(i * 23) % 360} 62% 58%)`;
      g.fillStyle = '#d7c6a8';
      if (yOf(0) <= H) g.fillRect(X(-BASE / 2) - 6, yOf(0), BASE * unit + 12, H - yOf(0));
      loc.blocks.forEach((b, i) => {
        if (i === 0 || yOf(i) < -bh || yOf(i - 1) > H + bh) return;
        g.fillStyle = color(i);
        g.fillRect(X(b.x - b.w / 2), yOf(i), b.w * unit, bh - 1);
      });
      // 切れて落ちる所
      if (loc.cut && t - loc.cut.t < 800) {
        const f = (t - loc.cut.t) / 800;
        g.globalAlpha = 1 - f;
        g.fillStyle = color(loc.cut.y);
        g.fillRect(X(loc.cut.x - loc.cut.w / 2), yOf(loc.cut.y) + f * f * H * 0.6, loc.cut.w * unit, bh - 1);
        g.globalAlpha = 1;
      }
      // 動いているブロック
      if (playing() && t >= loc.at) {
        const top = loc.blocks.at(-1);
        const x = xOf(k, t - loc.at);
        g.fillStyle = color(k + 1);
        g.fillRect(X(x - top.w / 2), yOf(k + 1), top.w * unit, bh - 1);
      }
      if (t - loc.perfect < 700) {
        g.fillStyle = '#fff';
        g.strokeStyle = '#c33';
        g.lineWidth = 3;
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
        g.strokeText('ぴったり！', W / 2, 36);
        g.fillText('ぴったり！', W / 2, 36);
      }
      g.fillStyle = '#333';
      g.font = 'bold 18px sans-serif';
      g.textAlign = 'left';
      g.fillText(`${k}段`, 10, 24);
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  },
};
