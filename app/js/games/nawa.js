// 大縄とび。回ってくる縄が足元に来る瞬間に押して跳ぶ。ひっかかるとライフが減り、0で脱落。最後に残った人の勝ち。2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 縄が足元に来た瞬間に押す（PC はスペースキーでも）。縄はだんだん速くなる。
//   - ひっかかったらライフが1つ減り、0で脱落。最後に残った人の勝ち。詳細設定「ライフ」は 1・3（最初）・5。
//   - 見た目は、横から見た縄と、全員の人形が並んで跳ぶ。
// Claude の判断:
//   - 縄が足元に来る時刻は全員同じ表から決める（始まって2.5秒が1回目。1回の間は1.5秒から 0.98倍ずつ縮み、いちばん短くて0.55秒。200回まで）。
//   - 押すと「跳んでいる間」になり、その間に縄が足元に来れば跳べた。跳んでいる長さは 0.4秒（間が短くなったら間の6割）。
//     縄が来てから0.08秒までに押しても間に合ったことにする。跳んでいる間は押しても何もしない。
//   - 跳べたかどうかは各自の端末で決め、ひっかかったときだけ { t: 'miss', k: 何回目の縄 } を送る（だるまさんがころんだと同じく、各自の画面の時間で決める）。
//   - 残りが1人になったら（2人以上で始めたとき）1.5秒待って終わる（同じ縄でひっかかった人の手が遅れて届く分を待つ）。
//     全員いなくなったら、いちばんあとまで残った人たちが同じ1位。200回跳びきったら、残った人のうちライフの多い人が1位。
//   - CPU は1回ごとに 3%（いちばん速いときは 28%）でひっかかる（ライフ3で脱落するのは、2000回の試算の真ん中で34回目・始まって約40秒）。
//   - ほかの人の人形は縄に合わせて自動で跳ぶ（見た目だけ）。ひっかかった知らせが届いたら赤くする。
// 詳細設定「はじめの速さ」（2026-11-03 の33回目の案。分かれ目は Claude の推奨を本人が承認）:
//   - 縄の1回目の間だけを変える（ゆっくり 2.0秒・ふつう 1.5秒（最初。前と全く同じ表）・はやい 1.0秒）。縮み方（0.98倍）といちばん短い 0.55秒はどれも同じ。
//   Claude の判断: 鍵は speed（main.js の KEEP_KEYS にあるので、おまかせで抽選しない）。CPU のひっかかりやすさは縄の間で決まるので、そのまま。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'miss', k }

import { scoreChips, since, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const FIRST = 2500;
const START = 1500;
const MIN = 550;
const DECAY = 0.98;
const BEATS = 200;
const LATE = 80;
const LIVES = [[1, '1'], [3, '3'], [5, '5']];
const SPEEDS = [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']];
const STARTS = { slow: 2000, normal: START, fast: 1000 };
const livesOf = (r) => (LIVES.some(([v]) => v === r.lives) ? r.lives : 3);

// 縄が足元に来る時刻（始まってからの ms）の表。start は1回目の間
const makeTimes = (start) => {
  const out = [];
  let t = FIRST, per = start;
  for (let k = 0; k < BEATS; k++) { out.push(Math.round(t)); t += per; per = Math.max(MIN, per * DECAY); }
  return out;
};
export const TIMES = makeTimes(START); // ふつう
const TABLES = { slow: makeTimes(STARTS.slow), normal: TIMES, fast: makeTimes(STARTS.fast) };
export const timesOf = (r) => TABLES[r?.speed] ?? TIMES;
const periodOf = (k, T = TIMES) => (k + 1 < BEATS ? T[k + 1] - T[k] : MIN);
export const airOf = (k, T = TIMES) => Math.min(400, Math.round(periodOf(Math.max(0, k - 1), T) * 0.6));
// 押した時刻の一覧で、k 回目の縄を跳べたか
export const cleared = (presses, k, T = TIMES) => presses.some((t) => t >= T[k] - airOf(k, T) && t <= T[k] + LATE);
export const cpuMissRate = (k, T = TIMES) => 0.03 + 0.25 * Math.min(1, Math.max(0, (1100 - periodOf(k, T)) / 550));

const key = (s) => `nawa:${s.seed}`;
const clone = (s) => ({ ...s, lives: s.lives.slice(), out: s.out.slice(), missed: s.missed.map((m) => m.slice()) });
const alive = (s, p) => s.out[p] === null;

function finish(s) {
  const live = [...Array(s.n).keys()].filter((p) => alive(s, p));
  let winners;
  if (live.length) { const top = Math.max(...live.map((p) => s.lives[p])); winners = live.filter((p) => s.lives[p] === top); }
  else { const last = Math.max(...s.out); winners = s.out.map((k, p) => (k === last ? p : -1)).filter((p) => p >= 0); }
  const power = (p) => (alive(s, p) ? 1000 + s.lives[p] : s.out[p]);
  const place = [...Array(s.n).keys()].map((p) => 1 + [...Array(s.n).keys()].filter((x) => power(x) > power(p)).length);
  return { winners, place, lives: s.lives };
}

const cpuPlan = new Map();
let loc = null; // この端末の跳んだ記録 { key, presses, judged, missSent }
let ui = null;
let keysBound = false;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !ui?.jump || !ui.wrap.isConnected || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    if (!e.repeat) ui.jump();
  });
}

export default {
  id: 'nawa',
  name: '大縄とび',
  icon: '🪢',
  desc: '縄が足元に来た瞬間に押して跳ぶ。だんだん速くなる縄で、最後まで残った人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'lives', label: 'ライフ', desc: 'ひっかかってもいい回数（0になったら脱落）', def: 3, choices: LIVES },
    { key: 'speed', label: 'はじめの速さ', desc: '縄の1回目の速さ（ゆっくり 2秒・ふつう 1.5秒・はやい 1秒に1回）。だんだん速くなり、いちばん速いところはどれも同じ', def: 'normal', choices: SPEEDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { lives: 3, ...rules };
    return { n, seed, rules: r, phase: 'ready', lives: Array(n).fill(livesOf(r)), out: Array(n).fill(null), missed: Array.from({ length: n }, () => []), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && (p === undefined || alive(s, p)); },
  result(s) { return s.phase === 'end' ? finish(s) : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'start' ? 'question' : null;
    if (m.p !== me) return null;
    return b.out[me] !== null ? 'lose' : 'wrong';
  },
  resultText(res, me, pn) {
    if (res.winners.length === 1) return res.winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(res.winners[0])}の勝ち！`;
    return `${res.winners.map(pn).join('・')}が同じ1位！${res.winners.includes(me) ? '🎉' : ''}`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '縄が足元に来たら跳ぼう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') {
      const live = s.out.filter((k) => k === null).length;
      if (live <= 1) return { key: 'fin' + live, ms: 1500, move: { t: 'end' } };
      return { key: 'play', ms: timesOf(s.rules)[BEATS - 1] + 1500, move: { t: 'end' } };
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
    if (m.t !== 'miss' || s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !alive(s0, m.p)) return null;
    if (!Number.isInteger(m.k) || m.k < 0 || m.k >= BEATS || s0.missed[m.p].includes(m.k)) return null;
    const s = clone(s0);
    s.step += 1;
    s.missed[m.p].push(m.k);
    s.lives[m.p] -= 1;
    if (s.lives[m.p] <= 0) s.out[m.p] = m.k;
    return s;
  },

  cpuDelay(s) { return s.phase === 'play' ? 100 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || !alive(s, p)) return null;
    const pk = key(s) + ':' + p;
    let plan = cpuPlan.get(pk);
    if (!plan) { plan = { next: 0 }; cpuPlan.set(pk, plan); if (cpuPlan.size > 100) cpuPlan.delete(cpuPlan.keys().next().value); }
    const t = since(key(s) + ':play');
    const T = timesOf(s.rules);
    while (plan.next < BEATS && t >= T[plan.next] + LATE + 30) {
      const k = plan.next++;
      if (Math.random() < cpuMissRate(k, T)) return { t: 'miss', k };
    }
    return null;
  },

  render(root, s, o) {
    bindKeys();
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const tk = key(s) + ':play';
    const T = timesOf(s.rules);
    const extra = (p) => {
      if (!alive(s, p)) return '<span class="pt-ng">脱落</span>';
      return `<span class="nw-life">${'❤️'.repeat(Math.max(0, s.lives[p]))}</span>`;
    };
    const chips = scoreChips(o, s.lives.map(() => 0), { won: s.phase === 'end' ? finish(s).winners : [], extra, steady: true });
    chips.querySelectorAll('.pt-score').forEach((e) => e.remove()); // 点は無いので、名前とライフだけ
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
    root.className = 'board kj nw';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    ui = { mount, wrap, chips, state: s };
    const card = document.createElement('div');
    card.className = 'kj-card nw-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">縄が足元に来た瞬間に「ジャンプ」を押そう（PC はスペースキーでも）・ライフ ${livesOf(s.rules)}${s.rules.speed && s.rules.speed !== 'normal' ? `・はじめの速さ ${SPEEDS.find(([v]) => v === s.rules.speed)?.[1] ?? ''}` : ''}</div>`;
      return;
    }
    if (s.phase === 'play') since(tk);
    const cv = document.createElement('canvas');
    cv.className = 'nw-canvas';
    card.append(cv);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (loc?.key !== tk) loc = { key: tk, presses: [], judged: 0, airUntil: 0 };
    const hurt = new Map(); // 席 → 赤くする終わりの時刻
    const lastLives = s.lives.slice();
    ui.update = () => {
      const st = ui.state;
      st.lives.forEach((v, p) => { if (v < lastLives[p]) { hurt.set(p, performance.now() + 700); lastLives[p] = v; } });
      note.textContent = me === null ? '観戦中' : st.phase === 'end' ? '' : !alive(st, me) ? '脱落しました。最後まで見守ろう' : `縄が足元に来たら跳ぼう！（${loc.judged}回目）`;
      if (btn) btn.disabled = !(st.phase === 'play' && me !== null && alive(st, me) && o.canMove);
    };
    let btn = null;
    const playing = () => ui.state.phase === 'play' && me !== null && alive(ui.state, me) && o.canMove;
    ui.jump = () => {
      if (!playing()) return;
      const t = since(tk);
      if (t < loc.airUntil + 120) return; // 跳んでいる間（と着地の直後）は押しても何もしない
      const k = T.findIndex((x) => x + LATE >= t);
      loc.airUntil = t + airOf(Math.max(0, k), T);
      loc.presses.push(t);
      if (loc.presses.length > 40) loc.presses.shift();
    };
    if (me !== null && s.phase === 'play') {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary nw-btn';
      btn.textContent = 'ジャンプ！';
      btn.onpointerdown = (e) => { e.preventDefault(); ui.jump(); };
      btn.onclick = (e) => { if (e.detail === 0) ui.jump(); };
      wrap.append(btn);
    }
    wrap.append(note);
    ui.update();

    // 跳べたかを決める（各自の端末で）
    const judge = () => {
      if (!wrap.isConnected || ui?.wrap !== wrap) return;
      if (playing()) {
        const t = since(tk);
        while (loc.judged < BEATS && t >= T[loc.judged] + LATE + 30) {
          const k = loc.judged++;
          if (!cleared(loc.presses, k, T)) { o.onMove({ t: 'miss', k }); break; }
        }
      }
      setTimeout(judge, 30);
    };
    // 跳べなかった回を後から送らないよう、始めは今の時刻までを済みにする（描き直しで途中から入ったとき）
    if (s.phase === 'play') {
      const t0 = since(tk);
      while (loc.judged < BEATS && T[loc.judged] + LATE + 30 < t0 - 1000) loc.judged++;
      judge();
    }

    // 描く
    const draw = () => {
      if (!cv.isConnected || ui?.wrap !== wrap) return;
      const st = ui.state;
      const W = Math.min(560, (root.clientWidth || 360) - 4), H = Math.round(W * 0.42);
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const ground = H * 0.86, hand = H * 0.5, x0 = W * 0.06, x1 = W * 0.94;
      g.fillStyle = '#cfe8c4';
      g.fillRect(0, ground, W, H - ground);
      const t = st.phase === 'play' ? since(tk) : 0;
      // 縄の位置: 足元の時刻で一番下、その間で一番上
      let k = T.findIndex((x) => x > t);
      if (k < 0) k = BEATS - 1;
      const prev = k > 0 ? T[k - 1] : T[0] - (T[1] - T[0]);
      const ph = st.phase === 'play' && t > prev ? Math.min(1, (t - prev) / (T[k] - prev)) : 0.5;
      const ang = ph * Math.PI * 2;
      const amp = ground - hand + 6;
      const cy = hand + Math.cos(ang) * amp;
      const front = Math.sin(ang) < 0;
      const rope = () => {
        g.strokeStyle = '#b5532a';
        g.lineWidth = front ? 5 : 3;
        g.beginPath();
        g.moveTo(x0, hand);
        g.quadraticCurveTo(W / 2, cy * 2 - hand, x1, hand);
        g.stroke();
      };
      // 回す人
      for (const x of [x0, x1]) {
        g.fillStyle = '#6b6b6b';
        g.fillRect(x - 4, hand, 8, ground - hand);
        g.beginPath(); g.arc(x, hand - 12, 11, 0, Math.PI * 2); g.fill();
      }
      if (!front) rope();
      // 人形
      const n = st.n;
      const gap = (x1 - x0) / (n + 1);
      const now = performance.now();
      for (let p = 0; p < n; p++) {
        const x = x0 + gap * (p + 1);
        let up = 0;
        if (alive(st, p) && st.phase === 'play') {
          if (p === me) { const air = loc.airUntil - t; if (air > 0) up = Math.sin(Math.min(1, 1 - air / airOf(k, T)) * Math.PI); }
          else { const d = T[k] - t; const a = airOf(k, T); if (d >= 0 && d <= a) up = Math.sin((1 - d / a) * Math.PI); }
        }
        const y = ground - up * H * 0.22;
        const col = !alive(st, p) ? '#aaaaaa' : (hurt.get(p) ?? 0) > now ? '#e0322a' : SEAT_COLORS[p % SEAT_COLORS.length];
        g.globalAlpha = alive(st, p) ? 1 : 0.4;
        g.strokeStyle = col;
        g.fillStyle = col;
        g.lineWidth = 4;
        g.beginPath(); g.arc(x, y - 44, 9, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x, y - 35); g.lineTo(x, y - 14); g.moveTo(x, y - 14); g.lineTo(x - 7, y); g.moveTo(x, y - 14); g.lineTo(x + 7, y);
        g.moveTo(x - 10, y - 30); g.lineTo(x + 10, y - 30); g.stroke();
        if (p === me) { g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('あなた', x, y - 58); }
        g.globalAlpha = 1;
      }
      if (front) rope();
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  },
};
