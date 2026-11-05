// 羽根つき。2〜6人で順番に羽根を打ち回す。羽根が自分の所の輪に入った瞬間に押すと打ち返せる。落とした人は顔に墨で落書きが1つ増える。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 2〜6人で順番に打ち回す（席の順に次の人へ飛ぶ）。足りない分は CPU（弱め）。
//   - 操作は「羽根が輪の中に入った瞬間に押す」だけ。ずれは各自の端末で測る（羽根が画面に出てから押すまで）。
//   - ぴったりで押すほど速い羽根が返り、次の人が難しくなる。
//   - だれかが5回落としたら終わり。落書きの少ない人ほど上の順位。
// Claude の判断:
//   - 羽根が届くまでの時間 D は、打ち始め（サーブ）が1.6秒。打ち返すと D × (1.02 − 0.16 × ぴったり度) になる（0.6〜1.8秒）。
//     ぴったり度 = 1 − |ずれ| ÷ 輪の幅。輪の幅（受け付けるずれ）W は D の17%（いちばん狭くて0.13秒）。
//     ぴったりで返し続けると7回ほどでいちばん速くなり、ずれが大きいと少しずつゆっくりに戻る。
//   - 押さなかった人の端末は、輪を過ぎたら「落とした」を送る。届かなかったときのため、ホストは輪を過ぎて2.5秒たったら落とした扱いにする。
//   - 落としたら2.2秒、落書きを見せてから、落とした人がサーブする（席の順に次の人へ）。最初のサーブは席の1番目の人。
//   - 落書きは 1:目のまわりの丸 2:ほっぺのばつ 3:ひげ 4:太いまゆ 5:おでこのうずまき の順に増える。
//   - CPU は羽根が遅いほど上手（1.6秒で9割、0.6秒で5割5分ほど返す）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → serve → fly → (hit → fly …) → drop → serve … → end
// 手: { p: -1, t: 'serve' | 'drop', n } / { p, t: 'hit', n: 何本目の羽根か, ms: 羽根が出てから押すまで } / { p, t: 'miss', n }
//   n が今の羽根と同じで、p がいま受ける人のときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { since, scoreChips, SEAT_COLORS } from './party.js';

export const INK_MAX = 5;
export const START_D = 1600;
export const MIN_D = 600;
export const MAX_D = 1800;
const READY_MS = 2500;
const DROP_MS = 2200;
const LATE_MS = 2500;

export const windowOf = (d) => Math.max(130, Math.round(d * 0.17));
// 押した時刻 ms の、ぴったり度（0〜1）。輪の外なら null
export function qualityOf(d, ms) {
  const w = windowOf(d);
  const off = Math.abs(ms - d);
  return off <= w ? 1 - off / w : null;
}
export const nextD = (d, q) => Math.max(MIN_D, Math.min(MAX_D, Math.round(d * (1.02 - 0.16 * q))));
const nextSeat = (s, p) => (p + 1) % s.n;
export const fKey = (s, n = s.k) => `hane:${s.seed}:${n}`; // n = 何本目の羽根か（s.n は人数なので取りちがえないこと）
const clone = (s) => ({ ...s, ink: s.ink.slice() });
export const placeOf = (ink) => ink.map((v) => 1 + ink.filter((w) => w < v).length);
const cpuPlan = new Map();
const pressed = new Map(); // この端末で押した羽根（描き直しても2回押さないように）
const ui = {}; // いま画面に出している絵（同じ局面なら作り直さない）

function dropAt(s0, p) {
  const s = clone(s0);
  s.step += 1;
  s.ink[p] += 1;
  s.dropped = p;
  s.phase = s.ink[p] >= INK_MAX ? 'end' : 'drop';
  s.last = { p, ok: false };
  return s;
}

export default {
  id: 'hane',
  name: '羽根つき',
  icon: '🏸',
  desc: '順番に羽根を打ち回す。輪に入った瞬間に押そう。落とすと顔に墨で落書き',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,

  init(n, seed) {
    return { n, seed, phase: 'ready', ink: Array(n).fill(0), from: n - 1, to: 0, d: START_D, k: 0, hits: 0, dropped: null, last: null, step: 0, best: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'fly' && s.to === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    const place = placeOf(s.ink);
    return { winners: place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0), place, ink: s.ink.slice(), loser: s.dropped };
  },
  sound(a, b, m, me) {
    if (b.ink.some((v, p) => v !== a.ink[p])) return b.dropped === me ? 'wrong' : 'pop'; // 落とした
    if (m.t === 'hit' && b.last?.ok) return 'smack'; // 打ち返した
    return null;
  },
  resultText(res, me, pn) {
    const w = res.winners;
    const ink = w.length ? res.ink[w[0]] : 0;
    if (w.length === 1) return w[0] === me ? `あなたの勝ち！🎉（落書き ${ink}こ）` : `${pn(w[0])}の勝ち！（落書き ${ink}こ）`;
    return `${w.map(pn).join('・')}が落書き ${ink}こで1位！${w.includes(me) ? '🎉' : ''}`;
  },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.hits}回続いています`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'serve', n: s.k } };
    if (s.phase === 'drop') return { key: 'drop' + s.k, ms: DROP_MS, move: { t: 'serve', n: s.k } };
    if (s.phase === 'fly') return { key: 'fly' + s.k, ms: s.d + windowOf(s.d) + LATE_MS, move: { t: 'drop', n: s.k } };
    return null;
  },

  apply(s0, m) {
    if (!m || m.n !== s0.k) return null;
    if (m.p === -1) {
      if (m.t === 'serve' && (s0.phase === 'ready' || s0.phase === 'drop')) {
        const s = clone(s0);
        s.step += 1;
        const server = s0.dropped ?? 0;
        s.from = server;
        s.to = nextSeat(s, server);
        s.d = START_D;
        s.k += 1;
        s.hits = 0;
        s.phase = 'fly';
        s.last = null;
        return s;
      }
      if (m.t === 'drop' && s0.phase === 'fly') return dropAt(s0, s0.to);
      return null;
    }
    if (s0.phase !== 'fly' || !Number.isInteger(m.p) || m.p !== s0.to) return null;
    if (m.t === 'miss') return dropAt(s0, m.p);
    if (m.t !== 'hit' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > s0.d + windowOf(s0.d) + LATE_MS + 1000) return null;
    const q = qualityOf(s0.d, Math.round(m.ms));
    if (q === null) return dropAt(s0, m.p);
    const s = clone(s0);
    s.step += 1;
    s.from = m.p;
    s.to = nextSeat(s, m.p);
    s.d = nextD(s0.d, q);
    s.k += 1;
    s.hits += 1;
    s.best = Math.max(s0.best, s.hits);
    s.last = { p: m.p, ok: true, q: Math.round(q * 100) / 100 };
    return s;
  },

  cpuDelay(s) { return s.phase === 'fly' ? 80 : 500; }, // CPU は決めておいた時刻（plan.ms）を手に入れるので、見る間が粗くてもずれは変わらない
  cpu(s, p) {
    if (s.phase !== 'fly' || s.to !== p) return null;
    const key = fKey(s, s.k) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const w = windowOf(s.d);
      const good = Math.random() < Math.max(0.5, Math.min(0.92, 0.55 + 0.37 * (s.d - MIN_D) / (START_D - MIN_D)));
      const off = good ? (Math.random() * 2 - 1) * w * 0.9 : (Math.random() < 0.5 ? -1 : 1) * w * (1.1 + Math.random() * 0.6);
      plan = { ms: Math.max(0, Math.round(s.d + off)) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(fKey(s, s.k)) >= plan.ms ? { t: 'hit', n: s.k, ms: plan.ms } : null;
  },

  render(root, s, o) {
    // CPU が動けない間、ホストの端末は CPU の予約のたびに描き直しを呼ぶ（main.js の scheduleCpu）。局面も見る人も変わっていなければ、
    // 絵（canvas）を作り直さずにそのまま残す（作り直すと0.03秒ごとに canvas ができ直して重い）
    const same = `${s.seed}:${s.step}:${o.me}:${o.canMove}:${o.watching}:${o.names.join('|')}:${JSON.stringify(o.away)}:${JSON.stringify(o.sub ?? null)}`;
    if (ui.root === root && ui.same === same && ui.wrap && root.contains(ui.wrap)) return;
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? placeOf(s.ink).map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0) : [];
    const extra = (p) => {
      const dots = '●'.repeat(s.ink[p]) + '○'.repeat(Math.max(0, INK_MAX - s.ink[p]));
      const tag = s.last?.ok && s.last.p === p && s.last.q >= 0.7 && s.phase === 'fly' ? ' <b class="hn-good">ぴったり！</b>' : '';
      return `<span class="hn-ink">${dots}</span>${tag}`;
    };
    root.innerHTML = '';
    root.className = 'board kj hn';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.ink, { won, extra, steady: true }));
    wrap.querySelectorAll('.pt-score').forEach((x) => { x.innerHTML = x.innerHTML.replace('<small>点</small>', '<small>墨</small>'); });
    root.append(wrap);
    Object.assign(ui, { root, same, wrap });
    const card = document.createElement('div');
    card.className = 'kj-card hn-card';
    wrap.append(card);
    const W = 360;
    const H = 330;
    const cv = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.className = 'hn-canvas';
    card.append(cv);
    const msg = document.createElement('div');
    msg.className = 'kj-sub hn-msg';
    card.append(msg);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    // 席の位置: 自分（観戦なら席0）を下のまんなかに、ほかの人を上の弧に並べる
    const base = me ?? 0;
    const pos = [];
    for (let i = 0; i < s.n; i++) {
      const k = (i - base + s.n) % s.n;
      if (k === 0) { pos[i] = [W / 2, H - 62]; continue; }
      const a = Math.PI * (1 - k / s.n) - Math.PI; // 下から時計回りに
      pos[i] = [W / 2 + Math.cos(a) * 140, 150 + Math.sin(a) * 105];
    }
    const key = s.phase === 'fly' ? fKey(s) : null;
    if (key) since(key);
    const myTurn = s.phase === 'fly' && me !== null && s.to === me && o.canMove;
    const pk = key + ':' + me;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary hn-hit';
    btn.textContent = '🏸 カン！（打つ）';
    btn.disabled = !myTurn || pressed.has(pk);
    wrap.append(btn);
    const note = document.createElement('p');
    note.className = 'cc-log';
    wrap.append(note);
    if (s.phase === 'ready') note.textContent = 'まもなく1本目。羽根が自分の輪に入った瞬間に押そう';
    else if (s.phase === 'drop') note.textContent = s.dropped === me ? '落としてしまった…墨で落書き！' : `${o.names[s.dropped]} が落とした！`;
    else if (s.phase === 'end') note.textContent = 'おしまい！ 落書きの少ない人ほど上の順位';
    else if (me === null) note.textContent = '観戦中';
    else if (myTurn) note.textContent = '羽根が輪に入ったら押す！（画面のどこを押してもよい）';
    else note.textContent = `${o.names[s.to]} が受ける番`;
    msg.textContent = s.phase === 'fly' ? `${s.hits}回続いています` : '';

    const face = (p, x, y, r) => {
      g.save();
      g.fillStyle = '#ffe9d6';
      g.strokeStyle = SEAT_COLORS[p % SEAT_COLORS.length];
      g.lineWidth = 4;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#333';
      g.beginPath(); g.arc(x - r * 0.35, y - r * 0.1, r * 0.09, 0, Math.PI * 2); g.arc(x + r * 0.35, y - r * 0.1, r * 0.09, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#333'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y + r * 0.25, r * 0.25, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      // 墨の落書き
      g.strokeStyle = '#111'; g.lineWidth = Math.max(2.5, r * 0.09); g.lineCap = 'round';
      const k = s.ink[p];
      if (k >= 1) { g.beginPath(); g.arc(x - r * 0.35, y - r * 0.1, r * 0.24, 0, Math.PI * 2); g.stroke(); }
      if (k >= 2) { g.beginPath(); g.moveTo(x + r * 0.42, y + r * 0.2); g.lineTo(x + r * 0.7, y + r * 0.45); g.moveTo(x + r * 0.7, y + r * 0.2); g.lineTo(x + r * 0.42, y + r * 0.45); g.stroke(); }
      if (k >= 3) { for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(x + sd * r * 0.12, y + r * 0.12); g.quadraticCurveTo(x + sd * r * 0.5, y + r * 0.02, x + sd * r * 0.8, y + r * 0.18); g.stroke(); } }
      if (k >= 4) { g.lineWidth = r * 0.16; g.beginPath(); g.moveTo(x - r * 0.55, y - r * 0.4); g.lineTo(x - r * 0.15, y - r * 0.45); g.moveTo(x + r * 0.15, y - r * 0.45); g.lineTo(x + r * 0.55, y - r * 0.4); g.stroke(); }
      if (k >= 5) { g.lineWidth = Math.max(2.5, r * 0.07); g.beginPath(); for (let t = 0; t < 14; t++) { const a = t * 0.9; const rr = 2 + t * r * 0.022; const px = x + Math.cos(a) * rr; const py = y - r * 0.68 + Math.sin(a) * rr * 0.6; if (t) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); }
      g.restore();
    };
    const draw = () => {
      if (!cv.isConnected) return;
      g.clearRect(0, 0, W, H);
      for (let p = 0; p < s.n; p++) {
        const [x, y] = pos[p];
        const r = p === base ? 38 : 26;
        face(p, x, y, r);
        g.fillStyle = '#555';
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        const nm = p === me ? 'あなた' : String(o.names[p] ?? '');
        g.fillText(nm.length > 7 ? nm.slice(0, 7) + '…' : nm, x, y + r + 15);
      }
      if (s.phase === 'fly') {
        const t = since(key);
        const [x0, y0] = pos[s.from];
        const [x1, y1] = pos[s.to];
        const len = Math.hypot(x1 - x0, y1 - y0); // 見た目だけ（ゲームの決まりには使わない）
        const w = windowOf(s.d);
        // 輪: 羽根がこの中にいる間に押せば打ち返せる
        g.strokeStyle = s.to === me ? '#e0a100' : 'rgba(224,161,0,.55)';
        g.lineWidth = 3;
        g.setLineDash([6, 5]);
        g.beginPath(); g.arc(x1, y1, Math.max(18, (w / s.d) * len), 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        const u = t / s.d;
        let x;
        let y;
        if (u <= 1 + w / s.d) {
          x = x0 + (x1 - x0) * u;
          y = y0 + (y1 - y0) * u - Math.sin(Math.min(1, u) * Math.PI) * 40;
        } else {
          const fall = (t - s.d - w) / 400;
          x = x0 + (x1 - x0) * (1 + w / s.d);
          y = y0 + (y1 - y0) * (1 + w / s.d) + fall * fall * 60;
        }
        g.font = '30px "Apple Color Emoji","Segoe UI Emoji",sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🏸', x, y);
        g.textBaseline = 'alphabetic';
      }
      if (s.phase === 'drop' && s.dropped !== null) {
        const [x, y] = pos[s.dropped];
        g.font = 'bold 22px sans-serif';
        g.fillStyle = '#c0392b';
        g.textAlign = 'center';
        g.fillText('ポトッ…', x, y - 46);
      }
      if (s.phase === 'fly') requestAnimationFrame(draw);
    };
    draw();
    if (s.phase !== 'fly' || me === null || s.to !== me) return;
    const n = s.k;
    const again = (mv) => {
      if (!cv.isConnected) return; // 届けば描き直しで画面から外れて止まる
      o.onMove(mv);
      setTimeout(() => again(mv), 500);
    };
    if (pressed.has(pk)) { setTimeout(() => again(pressed.get(pk)), 500); return; }
    const press = (mv) => {
      if (pressed.has(pk)) return;
      pressed.set(pk, mv);
      if (pressed.size > 200) pressed.delete(pressed.keys().next().value);
      btn.disabled = true;
      o.onMove(mv);
      setTimeout(() => again(mv), 500);
    };
    const hit = (e) => {
      if (!myTurn || pressed.has(pk)) return;
      e.preventDefault();
      press({ t: 'hit', n, ms: Math.round(since(key)) });
    };
    btn.onpointerdown = hit;
    btn.onclick = (e) => { if (e.detail === 0) hit(e); };
    cv.onpointerdown = hit;
    // 押さないまま輪を過ぎたら「落とした」を送る
    setTimeout(() => {
      if (!cv.isConnected || pressed.has(pk) || !o.canMove) return;
      press({ t: 'miss', n });
    }, Math.max(0, s.d + windowOf(s.d) + 100 - since(key)));
  },
};
