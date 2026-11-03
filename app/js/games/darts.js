// ダーツ。全員が同時に、自分の画面の的へ3本ずつ投げる。1〜6人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - ボウリングと同じく全員が同時に投げる。
//   - 指（PC はマウス）で狙いを動かすと印が手ぶれのようにゆれ、離した瞬間に刺さる。
//   - 的は本物と同じ（20に分かれ、2倍・3倍の輪と真ん中（ブル））。
//   - 最初は 8ラウンド×3本の合計点（カウントアップ）。詳細設定で「301」も選べる（持ち点 301 をぴったり0にする。減らしすぎたらそのラウンドは無効）。
// Claude の判断:
//   - 的の大きさは本物（mm）: ブル内側 半径6.35・外側15.9、3倍の輪 99〜107、2倍の輪 162〜170。内側のブル50点・外側25点。
//   - 刺さった所の点は投げた人の端末で決めて手に入れる（{ t: 'throw', q, d: 何本目, x, y, s: 点 }。座標は0.1mm 単位の整数）。
//     角度の計算（Math.atan2）が端末で末尾までそろう保証が無いので、受け取った側は数え直さない（ボウリングのピンと同じ考え方）。
//   - ゆれは半径およそ12mm の円を描くように動く。指で押しているときは、指で隠れないよう印を指の少し上に出す。
//   - 1ラウンドの時間は30秒。全員が投げ終えたら1秒で次へ。投げなかった矢は0点。結果を見せる間は2.5秒。
//   - 301 は「ダブルで上がる」決まりは入れない。ぴったり0になった人はそのラウンドで上がり。上がった人がいるラウンドで終わり（同じラウンドで上がった人は同じ1位）。
//     10ラウンドで決まらなければ、残りの少ない人の勝ち。
//   - CPU は 1.2〜2秒に1本、狙う所から上下左右にばらつかせて投げる（カウントアップで1本の平均はおよそ14点。2万本の試算で13.7点）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'throw', q, d, x, y, s }

import { scoreChips, since, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]; // 上から右回り
const R = { bullIn: 6.35, bullOut: 15.9, triIn: 99, triOut: 107, dblIn: 162, dblOut: 170 };
const VIEW = 225; // 画面に出す半径（mm）
const LIMIT = 30000;
const READY_MS = 3000;
const SHOWN_MS = 2500;
const GRACE_MS = 1000;
const MODES = [['count', 'カウントアップ（8ラウンドの合計）'], ['301', '301（ぴったり0にする）']];
const roundsOf = (s) => (s.mode === '301' ? 10 : 8);
const VALID = new Set([0, 25, 50, ...ORDER.flatMap((v) => [v, v * 2, v * 3])]);

// 刺さった所の点と呼び名（x, y は0.1mm 単位。上が −y）
export function scoreAt(x, y) {
  const r = Math.sqrt(x * x + y * y) / 10;
  if (r <= R.bullIn) return { s: 50, label: 'ブル' };
  if (r <= R.bullOut) return { s: 25, label: 'ブル' };
  if (r > R.dblOut) return { s: 0, label: 'はずれ' };
  const ang = ((Math.atan2(x, -y) * 180) / Math.PI + 360 + 9) % 360;
  const num = ORDER[Math.floor(ang / 18) % 20];
  if (r >= R.triIn && r <= R.triOut) return { s: num * 3, label: `${num}の3倍` };
  if (r >= R.dblIn) return { s: num * 2, label: `${num}の2倍` };
  return { s: num, label: String(num) };
}
// 数字 num の区切りの、真ん中の半径 rr（mm）の位置（0.1mm 単位）
export function spotOf(num, rr) {
  const i = ORDER.indexOf(num);
  const a = (i * 18 * Math.PI) / 180;
  return [Math.round(Math.sin(a) * rr * 10), Math.round(-Math.cos(a) * rr * 10)];
}

const qKey = (s, q = s.q) => `darts:${s.seed}:${q}`;
const clone = (s) => ({ ...s, total: s.total.slice(), left: s.left.slice(), darts: s.darts.map((d) => d.slice()), done: s.done.slice(), fin: s.fin.slice(), bust: s.bust.slice() });

// 301 の結果の順位（上がった人 → 残りの少ない人）
function finish(s) {
  if (s.mode !== '301') return { winners: leaders(s.total), scores: s.total };
  const power = (p) => (s.fin[p] !== null ? 100000 - s.fin[p] : -s.left[p]);
  const top = Math.max(...s.left.map((_, p) => power(p)));
  const winners = s.left.map((_, p) => (power(p) === top ? p : -1)).filter((p) => p >= 0);
  const place = s.left.map((_, p) => 1 + s.left.filter((__, x) => power(x) > power(p)).length);
  return { winners, place, left: s.left };
}

const cpuPlan = new Map();
let loc = null; // この端末で投げた記録 { key, thrown }

export default {
  id: 'darts',
  name: 'ダーツ',
  icon: '🎯',
  desc: 'ゆれる狙いを止めて的へ投げる。全員同時に3本ずつ',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 6,
  settings: [
    { key: 'mode', label: '遊び方', desc: 'カウントアップは合計点、301 は持ち点をぴったり0にした人の勝ち（減らしすぎたらそのラウンドは無効）', def: 'count', choices: MODES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { mode: 'count', ...rules };
    const mode = r.mode === '301' ? '301' : 'count';
    return {
      n, seed, rules: r, mode, q: -1, phase: 'ready', total: Array(n).fill(0), left: Array(n).fill(301), start: Array(n).fill(301),
      darts: Array.from({ length: n }, () => []), done: Array(n).fill(false), fin: Array(n).fill(null), bust: Array(n).fill(false), last: null, step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || !s.done[p]); },
  result(s) { return s.phase === 'end' ? finish(s) : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null;
    return m.s >= 50 || (m.s >= 20 && m.s % 3 === 0 && m.s > 20) ? 'correct' : m.s === 0 ? 'wrong' : 'hit';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `ラウンド ${s.q + 1} / ${roundsOf(s)}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.done.every((d) => d)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= roundsOf(s) || (s.mode === '301' && s.fin.some((f) => f !== null))) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.darts = s.darts.map(() => []);
        s.done = Array(s.n).fill(false);
        s.bust = Array(s.n).fill(false);
        s.start = s.left.slice();
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        s.last = { got: s.darts.map((d) => d.reduce((a, x) => a + x.s, 0)), bust: s.bust.slice() };
        return s;
      }
      return null;
    }
    if (m.t !== 'throw' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.done[m.p]) return null;
    if (m.d !== s0.darts[m.p].length || !Number.isInteger(m.x) || !Number.isInteger(m.y) || Math.abs(m.x) > 4000 || Math.abs(m.y) > 4000 || !VALID.has(m.s)) return null;
    const s = clone(s0);
    s.step += 1;
    const p = m.p;
    s.darts[p].push({ x: m.x, y: m.y, s: m.s });
    if (s.mode === '301') {
      const left = s.left[p] - m.s;
      if (left < 0) { s.left[p] = s.start[p]; s.bust[p] = true; s.done[p] = true; } // 減らしすぎ: このラウンドは無効
      else {
        s.left[p] = left;
        if (left === 0) { s.fin[p] = s.q; s.done[p] = true; }
      }
    } else s.total[p] += m.s;
    if (s.darts[p].length >= 3) s.done[p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.done[p]) return null;
    const key = qKey(s) + ':' + p + ':' + s.darts[p].length;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: (cpuPlan.get(qKey(s) + ':' + p + ':' + (s.darts[p].length - 1))?.at ?? 0) + 1200 + Math.random() * 800 };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (since(qKey(s)) < plan.at) return null;
    let aim = spotOf(20, 103);
    if (s.mode === '301') {
      const left = s.left[p];
      if (left === 50 || left === 25) aim = [0, 0];
      else if (left <= 20) aim = spotOf(left, 130);
      else if (left <= 60) aim = spotOf(20, 130);
    }
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 560;
    const x = Math.round(aim[0] + g()), y = Math.round(aim[1] + g());
    return { t: 'throw', q: s.q, d: s.darts[p].length, x, y, s: scoreAt(x, y).s };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const is301 = s.mode === '301';
    const vals = is301 ? s.left : s.total;
    const won = s.phase === 'end' ? finish(s).winners : [];
    const extra = (p) => {
      const ds = s.darts[p] ?? [];
      if (s.phase === 'shown' && s.last) return s.last.bust[p] ? '<span class="pt-ng">減らしすぎ</span>' : `<span class="pt-ok">${is301 ? '−' : '+'}${s.last.got[p]}</span>`;
      if (s.phase !== 'open') return s.fin[p] !== null ? '<span class="pt-ok">上がり！</span>' : '';
      if (s.fin[p] !== null) return '<span class="pt-ok">上がり！</span>';
      if (s.bust[p]) return '<span class="pt-ng">減らしすぎ</span>';
      return `<span class="pt-ok">${'🎯'.repeat(ds.length)}${'・'.repeat(3 - ds.length)}</span>`;
    };
    const chips = scoreChips(o, vals, { won, extra, steady: true });
    if (is301) chips.querySelectorAll('.pt-score small').forEach((e) => { e.textContent = 'のこり'; e.parentElement.prepend(e); });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    root.innerHTML = '';
    root.className = 'board kj dt';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'ready') {
      wrap.insertAdjacentHTML('beforeend', `<div class="kj-card"><div class="kj-word small">よーい…</div><div class="kj-sub">${is301 ? '301: 持ち点をぴったり0にしよう' : `カウントアップ: ${roundsOf(s)}ラウンド×3本の合計点`}</div></div>`);
      return;
    }
    if (s.phase === 'end') return;
    const key = qKey(s);
    const head = document.createElement('div');
    head.className = 'kj-card dt-head';
    head.innerHTML = `<div class="kj-num">ラウンド ${s.q + 1} / ${roundsOf(s)}</div>`;
    wrap.append(head);
    if (s.phase === 'open') { since(key); head.append(timeBar(key, LIMIT)); }

    if (loc?.key !== key) loc = { key, thrown: 0 };
    const mine = me !== null ? s.darts[me] : [];
    const playing = s.phase === 'open' && me !== null && o.canMove && !s.done[me] && loc.thrown <= mine.length;
    const cv = document.createElement('canvas');
    cv.className = 'dt-canvas';
    const note = document.createElement('p');
    note.className = 'cc-log';
    const last = mine.at(-1);
    note.textContent = me === null ? '観戦中'
      : s.phase === 'shown' ? (s.last.bust[me] ? 'このラウンドは減らしすぎで無効' : `このラウンド ${s.last.got[me]}点`)
      : s.fin[me] !== null ? '上がり！ ほかの人を待っています'
      : s.bust[me] ? '減らしすぎ！ このラウンドは無効です'
      : s.done[me] ? `投げ終えました（このラウンド ${mine.reduce((a, x) => a + x.s, 0)}点）`
      : `${mine.length + 1}本目: 的を押したまま狙い、離すと刺さる${last ? `（前の矢: ${scoreAt(last.x, last.y).label}）` : ''}`;
    wrap.append(cv, note);

    let aim = null; // 指の位置（mm）。押している間だけ
    let lift = 0; // 指で隠れないよう印を上にずらす量（mm）
    const t0 = performance.now();
    const wob = (t) => [12 * Math.sin(t / 380 + 1.3) + 5 * Math.sin(t / 170), 12 * Math.cos(t / 450) + 5 * Math.sin(t / 210 + 0.7)];
    const markOf = () => { const [wx, wy] = wob(performance.now() - t0); return [aim[0] + wx, aim[1] - lift + wy]; };
    const toMm = (e) => { const r = cv.getBoundingClientRect(); const k = r.width / (VIEW * 2); return [(e.clientX - r.left) / k - VIEW, (e.clientY - r.top) / k - VIEW]; };
    const draw = () => {
      if (!cv.isConnected) return;
      const W = Math.min(440, (root.clientWidth || 360) - 4);
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = cv.height = Math.round(W * dpr); cv.style.width = cv.style.height = W + 'px'; }
      const g = cv.getContext('2d');
      const k = (W / (VIEW * 2)) * dpr;
      g.setTransform(k, 0, 0, k, (W * dpr) / 2, (W * dpr) / 2); // 1単位 = 1mm、真ん中が 0,0
      g.clearRect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);
      g.fillStyle = '#1d1d1d';
      g.beginPath(); g.arc(0, 0, 222, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 20; i++) {
        const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180, a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
        const dark = i % 2 === 0;
        const ring = (r0, r1, col) => { g.fillStyle = col; g.beginPath(); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath(); g.fill(); };
        ring(R.bullOut, R.dblOut, dark ? '#222' : '#f1e3c4');
        ring(R.triIn, R.triOut, dark ? '#d2342c' : '#2c8a4a');
        ring(R.dblIn, R.dblOut, dark ? '#d2342c' : '#2c8a4a');
        const am = (i * 18 - 90) * Math.PI / 180;
        g.fillStyle = '#fff';
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(ORDER[i]), Math.cos(am) * 196, Math.sin(am) * 196);
      }
      g.fillStyle = '#2c8a4a'; g.beginPath(); g.arc(0, 0, R.bullOut, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d2342c'; g.beginPath(); g.arc(0, 0, R.bullIn, 0, Math.PI * 2); g.fill();
      // 刺さった矢
      for (const d of mine) {
        g.fillStyle = '#ffd400'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(d.x / 10, d.y / 10, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
      // 狙いの印
      if (aim && playing) {
        const [mx, my] = markOf();
        g.strokeStyle = '#00e5ff'; g.lineWidth = 3;
        g.beginPath(); g.arc(mx, my, 9, 0, Math.PI * 2); g.moveTo(mx - 15, my); g.lineTo(mx + 15, my); g.moveTo(mx, my - 15); g.lineTo(mx, my + 15); g.stroke();
      }
      if (aim) requestAnimationFrame(draw);
    };
    if (playing) {
      cv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        cv.setPointerCapture?.(e.pointerId);
        lift = e.pointerType === 'touch' ? 40 : 0; // 指のときは 40mm 上に出す
        aim = toMm(e);
        requestAnimationFrame(draw);
      });
      cv.addEventListener('pointermove', (e) => { if (aim) aim = toMm(e); });
      const release = () => {
        if (!aim) return;
        const [mx, my] = markOf();
        aim = null;
        if (loc.thrown > mine.length || since(key) >= LIMIT) { draw(); return; }
        const x = Math.round(mx * 10), y = Math.round(my * 10);
        const sc = scoreAt(x, y);
        loc.thrown = mine.length + 1;
        play('smack', 0.6);
        o.onMove({ t: 'throw', q: s.q, d: mine.length, x, y, s: sc.s });
      };
      cv.addEventListener('pointerup', release);
      cv.addEventListener('pointercancel', () => { aim = null; draw(); });
    }
    requestAnimationFrame(draw);
    draw();
  },
};
