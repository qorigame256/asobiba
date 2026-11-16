// てんびん当て。見た目が同じ玉の中に1つだけ少し重い偽物がある。てんびんで比べて偽物を当てる。2〜10人・足りない分は CPU（弱め）。
// 2026-11-16 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 名前は「てんびん当て」。
//   - 偽物を当てた人のうち、てんびんを使った回数が少ない順に 3点・2点・それ以降は1点。回数が同じなら早く答えた人が上。外れたらその回は0点。
//     （1回はかって3つに1つまで絞ったところで当てずっぽうで答えるか、もう1回はかって確かめるか、の賭けが生まれるように）
//   - 玉は9個（最初）。詳細設定「玉の数」で やさしい（4個）・むずかしい（27個）。
// Claude の判断:
//   - 5回戦。偽物の場所は種から決め、全員同じ。答えられるのは1回に1度だけ（言い直しなし）。
//   - 玉を押すたびに「外 → 左の皿 → 右の皿 → 外」と移る。はかれるのは左右の数が同じで1個以上のときだけ（数がちがうと多いほうが下がるだけで、何も分からないため）。
//   - はかった結果は自分の画面だけで、手の一覧に入れない。送るのは答え（{ t: 'ans', q, b: 玉の番号, w: はかった回数, ms }）だけ。
//     はかった回数は見た目だけ送りっぱなしにして（o.stream）、ほかの人の名前の札に「⚖️2」と出す。だれが当たったかは締め切りまで出さない。
//   - 「どれが本物と分かったか」の印は付けない（推理そのものが遊びなので）。はかった結果の一覧だけ残す。
//   - 制限時間は 4個 30秒・9個 60秒・27個 90秒。全員答えたら1.5秒で締め切る（先に答えた人が出ても早めない。急がせると回数の勝負にならないため）。
//   - CPU は、3つに分けてはかる（3回に1回ほど半分ずつに分けてしまう）。残りが3個以下になると3回に1回ほど当てずっぽうで答える。
//     1回はかるのに 2.5〜5秒（27個は 3.5〜6秒）。どれも種から決めるので、全員の端末で同じ。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数字タッチと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, b, w, ms }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;
const WEIGH_MS = 800; // てんびんが傾くまで（その間は玉を動かせない）
const ROUNDS = 5;
const PTS = [3, 2];
const SIZES = [[4, 'やさしい（4個）'], [9, 'ふつう（9個）'], [27, 'むずかしい（27個）']];
const LIMITS = { 4: 30000, 9: 60000, 27: 90000 };
const sizeOf = (r) => (SIZES.some(([v]) => v === r.size) ? r.size : 9);
const limitOf = (s) => LIMITS[s.size];
const qKey = (s, q = s.q) => `tenbin:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.slice() });
const doneOf = (s, p) => s.ans[p] !== null;

// 左右の皿にのせた玉の番号から結果: 'L'（左が重い）| 'R' | '='
export const weigh = (fake, left, right) => (left.includes(fake) ? 'L' : right.includes(fake) ? 'R' : '=');

// 締め切りのときの点。当たった人のうち（回数, 時間）の小さい順に 3・2・それ以降は1点。まったく同じなら同じ点
export function pointsOf(ans, fake) {
  const ok = (a) => a && a.b === fake;
  return ans.map((a) => {
    if (!ok(a)) return 0;
    const rank = ans.filter((x) => ok(x) && (x.w < a.w || (x.w === a.w && x.ms < a.ms))).length;
    return PTS[rank] ?? 1;
  });
}

// CPU のふるまい（はかる時刻の一覧・答える時刻・答える玉）。種・何回目・席から決める
export function cpuPlan(s, q, p) {
  const rnd = mulberry32((s.seed * 41 + q * 13 + p * 1019 + 5557) >>> 0);
  const fake = s.qs[q];
  const [lo, hi] = s.size === 27 ? [3500, 6000] : [2500, 5000];
  let cand = Array.from({ length: s.size }, (_, i) => i);
  const weighs = [];
  let t = 1000 + rnd() * 1500;
  let b = null;
  for (let guard = 0; guard < 10 && b === null; guard++) {
    if (cand.length === 1) { b = cand[0]; break; }
    if (cand.length <= 3 && rnd() < 0.33) { b = cand[Math.floor(rnd() * cand.length)]; break; }
    const k = rnd() < 0.33 ? Math.floor(cand.length / 2) : Math.ceil(cand.length / 3);
    const left = cand.slice(0, k), right = cand.slice(k, 2 * k);
    const r = weigh(fake, left, right);
    cand = r === 'L' ? left : r === 'R' ? right : cand.slice(2 * k);
    t += lo + rnd() * (hi - lo);
    weighs.push(Math.round(t));
  }
  t += 800 + rnd() * 1500;
  return { weighs, at: Math.round(t), b, w: weighs.length };
}

let loc = null; // この端末の様子 { key, at: 玉ごとの置き場所 0 外・1 左・2 右, w, hist, pick, busy, tilt, sent }
let ui = null;
const others = new Map(); // 席 → { key, w }（ほかの人のはかった回数）

export default {
  id: 'tenbin',
  name: 'てんびん当て',
  icon: '⚖️',
  desc: '1つだけ重い偽物の玉を、てんびんで比べて当てる。はかった回数が少ないほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '玉の数', desc: '多いほどはかる回数が増える', def: 9, choices: SIZES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: 9, ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const qs = Array.from({ length: ROUNDS }, () => Math.floor(rnd() * size));
    return { n, seed, rules: r, size, qs, q: -1, phase: 'ready', ans: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.pts[me] > 0 ? 'correct' : me >= 0 && b.last && a.ans[me] ? 'wrong' : 'pop';
    return null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}回 / ${s.qs.length}`;
    return `第${s.q + 1}回の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
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
        s.ans = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const fake = s.qs[s.q];
        const pts = pointsOf(s.ans, fake);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const winners = pts.map((v, p) => (v > 0 && v === Math.max(...pts) ? p : -1)).filter((p) => p >= 0);
        s.last = { winners, pts };
        s.log = [...s0.log, { ans: s.ans.slice(), fake, pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.b) || m.b < 0 || m.b >= s0.size || !Number.isInteger(m.w) || m.w < 0 || m.w > 99) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 300) || m.ms > limitOf(s0) + 500) return null;
    const s = clone(s0);
    s.step += 1;
    s.ans[m.p] = { b: m.b, w: m.w, ms: Math.round(m.ms) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const plan = cpuPlan(s, s.q, p);
    if (plan.b === null || plan.at >= limitOf(s)) return null;
    const t = since(qKey(s));
    return t >= plan.at ? { t: 'ans', q: s.q, b: plan.b, w: plan.w, ms: Math.max(plan.at, Math.round(t)) } : null;
  },

  // ほかの人のはかった回数（見た目だけ）
  onStream(d, from) {
    if (!d || !Number.isInteger(d.w) || typeof d.key !== 'string' || from < 0) return;
    others.set(from, { key: d.key, w: d.w });
    ui?.paintChips?.();
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${!!o.canMove}`;
    const key = qKey(s);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const count = (p) => {
      if (p === me && loc?.key === key) return loc.w;
      if (o.cpu?.[p]) { const t = since(key); return cpuPlan(s, s.q, p).weighs.filter((x) => x <= t).length; }
      const v = others.get(p);
      return v?.key === key ? v.w : 0;
    };
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? `<span class="pt-ok">答えた（⚖️${s.ans[p].w}）</span>` : `<span class="nt-prog">⚖️${count(p)}</span>`;
      if (s.phase !== 'shown' || !s.last) return '';
      const a = s.ans[p];
      if (!a) return '<span class="pt-ng">―</span>';
      return a.b === s.qs[s.q] ? `<span class="pt-ok">○ ⚖️${a.w} +${s.last.pts[p]}</span>` : '<span class="pt-ng">× はずれ</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj tb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    ui.paintChips = () => {
      if (s.phase !== 'open') return;
      ui.chips.querySelectorAll('.cc-opp').forEach((chip, p) => {
        const e = chip.querySelector('.pt-extra');
        if (e) e.innerHTML = extra(p);
      });
    };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const limit = limitOf(s);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}個の玉の中に、1つだけ少し重い偽物がある・全${s.qs.length}回・1回 ${limit / 1000}秒まで</div>`;
      return;
    }
    const fake = s.qs[s.q];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub">${s.size}個のうち1つだけ重い偽物を当てよう。はかる回数が少ないほど高い点</div>`);
      card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const names = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p]));
      t.textContent = `偽物は ${fake + 1}番。` + (names.length ? `いちばんは ${names.join('・')}` : 'だれも当てられませんでした');
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, at: Array(s.size).fill(0), w: 0, hist: [], pick: false, busy: false, tilt: '', sent: false };
    const playing = () => s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;

    const scale = drawScale();
    const btnBox = document.createElement('div');
    btnBox.className = 'tb-btns';
    const weighBtn = mkBtn('⚖️ はかる', 'primary');
    const clearBtn = mkBtn('ぜんぶ下ろす', 'secondary');
    const pickBtn = mkBtn('🔍 これが偽物！', 'secondary');
    btnBox.append(weighBtn, clearBtn, pickBtn);
    const tray = document.createElement('div');
    tray.className = 'tb-tray' + (s.size === 27 ? ' many' : '');
    const cols = s.size === 4 ? 4 : s.size === 9 ? 5 : 9; // 9個は 5と4 の2段（7と2 に分かれると見づらいため）
    tray.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    tray.style.width = `min(100%, ${cols * 66}px)`;
    const balls = Array.from({ length: s.size }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-ball';
      b.innerHTML = `<span>${i + 1}</span><small></small>`;
      tray.append(b);
      return b;
    });
    const hist = document.createElement('ol');
    hist.className = 'tb-hist';
    const note = document.createElement('p');
    note.className = 'cc-log';

    const side = (k) => loc.at.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0);
    const paint = () => {
      const on = playing();
      const L = side(1), R = side(2);
      const mine = me !== null ? s.ans[me] : null;
      balls.forEach((b, i) => {
        const at = s.phase === 'open' ? loc.at[i] : 0;
        b.classList.toggle('tb-l', at === 1);
        b.classList.toggle('tb-r', at === 2);
        b.classList.toggle('tb-fake', s.phase === 'shown' && i === fake);
        b.classList.toggle('tb-mine', s.phase === 'shown' && mine?.b === i);
        b.classList.toggle('tb-pick', on && loc.pick);
        b.querySelector('small').textContent = s.phase === 'shown' ? (i === fake ? '偽物' : '') : at === 1 ? '左' : at === 2 ? '右' : '';
        b.disabled = !on || loc.busy;
      });
      scale.set(s.phase === 'open' ? L : [], s.phase === 'open' ? R : [], s.phase === 'open' ? loc.tilt : '');
      weighBtn.disabled = !on || loc.busy || loc.pick || !L.length || L.length !== R.length;
      clearBtn.disabled = !on || loc.busy || loc.pick || (!L.length && !R.length);
      pickBtn.disabled = !on || loc.busy;
      pickBtn.textContent = loc.pick ? 'やめる' : '🔍 これが偽物！';
      pickBtn.classList.toggle('primary', loc.pick);
      pickBtn.classList.toggle('secondary', !loc.pick);
      btnBox.hidden = s.phase !== 'open' || me === null || doneOf(s, me) || loc.sent;
      hist.innerHTML = '';
      loc.hist.forEach((h, n) => {
        const li = document.createElement('li');
        li.innerHTML = `<b>${n + 1}回目</b> ${h.L.map((i) => i + 1).join('・')} と ${h.R.map((i) => i + 1).join('・')} → ${h.r === '=' ? 'つりあった' : h.r === 'L' ? '左が重い' : '右が重い'}`;
        hist.append(li);
      });
      hist.hidden = s.phase !== 'open' || !loc.hist.length;
      note.textContent = s.phase !== 'open'
        ? (me === null ? '' : !mine ? 'この回は答えませんでした' : mine.b === fake ? `当たり！（はかった回数 ${mine.w}回・${secText(mine.ms)}）` : `はずれ（あなたは ${mine.b + 1}番と答えた）`)
        : me === null ? '観戦中'
        : doneOf(s, me) || loc.sent ? `${(mine ?? loc.sent).b + 1}番と答えました（はかった回数 ${mine?.w ?? loc.w}回）。ほかの人を待っています`
        : loc.pick ? '偽物だと思う玉を押してください（答えは1回だけ）'
        : '玉を押すと左の皿 → 右の皿 → 外 と移ります。左右同じ数にして「はかる」';
    };
    balls.forEach((b, i) => {
      b.onclick = () => {
        if (!playing() || loc.busy) return;
        if (loc.pick) {
          const ms = Math.round(since(key));
          if (ms >= limit) return;
          loc.sent = { b: i };
          loc.pick = false;
          play('place', 0.5);
          o.onMove({ t: 'ans', q: s.q, b: i, w: loc.w, ms: Math.max(ms, 300) });
          paint();
          return;
        }
        loc.at[i] = (loc.at[i] + 1) % 3;
        loc.tilt = '';
        play('stone', 0.3);
        paint();
      };
    });
    weighBtn.onclick = () => {
      const L = side(1), R = side(2);
      if (!playing() || loc.busy || !L.length || L.length !== R.length) return;
      loc.busy = true;
      loc.w += 1;
      const r = weigh(fake, L, R);
      o.stream?.({ key, w: loc.w });
      ui.paintChips();
      loc.tilt = r;
      paint();
      setTimeout(() => {
        if (loc?.key !== key) return;
        loc.busy = false;
        loc.hist.push({ L, R, r });
        play(r === '=' ? 'pop' : 'smack', 0.4);
        if (wrap.isConnected) paint();
      }, WEIGH_MS);
    };
    clearBtn.onclick = () => { if (!playing() || loc.busy) return; loc.at.fill(0); loc.tilt = ''; paint(); };
    pickBtn.onclick = () => { if (!playing() || loc.busy) return; loc.pick = !loc.pick; paint(); };

    wrap.append(scale.box, btnBox, tray, note, hist);
    paint();
    if (s.phase === 'open') {
      const tick = () => {
        if (!wrap.isConnected || ui?.wrap !== wrap) return;
        ui.paintChips();
        setTimeout(tick, 400);
      };
      setTimeout(tick, 400);
    }
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const top = Math.max(...x.pts);
      const best = top > 0 ? x.pts.map((v, p) => (v === top ? (p === me ? 'あなた' : o.names?.[p] ?? '') : null)).filter((v) => v !== null) : [];
      const a = me === null ? null : x.ans[me];
      const mine = me === null ? '' : !a ? '―' : a.b === x.fake ? `⭕ ⚖️${a.w}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>偽物 ${x.fake + 1}番</span><span>${mine}</span><span class="mk-rv-who">${best.length ? '👑' + esc(best.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

function mkBtn(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  return b;
}

// てんびんの絵（SVG）。set(左の玉, 右の玉, 'L' | 'R' | '=' | '') で皿の玉と傾きを描く
function drawScale() {
  const box = document.createElement('div');
  box.className = 'tb-box';
  box.innerHTML = `<svg viewBox="0 0 240 132" class="tb-scale" role="img" aria-label="てんびん">
    <path d="M104 126 L136 126 L124 34 L116 34 Z" class="tb-stand"/>
    <g class="tb-beam"><rect x="22" y="30" width="196" height="7" rx="3.5"/></g>
    <g class="tb-pan tb-pan-l"><line x1="40" y1="34" x2="18" y2="86"/><line x1="40" y1="34" x2="62" y2="86"/><g class="tb-pan-balls"></g><path d="M10 86 Q40 102 70 86 Z" class="tb-dish"/></g>
    <g class="tb-pan tb-pan-r"><line x1="200" y1="34" x2="178" y2="86"/><line x1="200" y1="34" x2="222" y2="86"/><g class="tb-pan-balls"></g><path d="M170 86 Q200 102 230 86 Z" class="tb-dish"/></g>
    <circle cx="120" cy="33" r="6" class="tb-pivot"/>
    <text x="40" y="118" class="tb-lbl">左</text><text x="200" y="118" class="tb-lbl">右</text></svg>`;
  const svg = box.querySelector('svg');
  const beam = svg.querySelector('.tb-beam'), pl = svg.querySelector('.tb-pan-l'), pr = svg.querySelector('.tb-pan-r');
  // 皿の上に玉を小さく積む（多いときは段にする）
  const fill = (g, list, cx) => {
    const box2 = g.querySelector('.tb-pan-balls');
    const per = 5, r = list.length > 10 ? 3.6 : 5;
    box2.innerHTML = list.map((b, k) => {
      const row = Math.floor(k / per), col = k % per, inRow = Math.min(per, list.length - row * per);
      const x = cx + (col - (inRow - 1) / 2) * r * 2.1, y = 86 - r - row * r * 1.9;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" class="tb-mini"/>`;
    }).join('');
  };
  return {
    box, svg,
    set(L, R, tilt) {
      fill(pl, L, 40);
      fill(pr, R, 200);
      const a = tilt === 'L' ? -9 : tilt === 'R' ? 9 : 0;
      const dy = Math.sin(a * Math.PI / 180) * 80; // 端が下がる量
      beam.style.transform = `rotate(${a}deg)`;
      pl.style.transform = `translateY(${(-dy).toFixed(1)}px)`;
      pr.style.transform = `translateY(${dy.toFixed(1)}px)`;
      svg.classList.toggle('even', tilt === '=');
    },
  };
}
