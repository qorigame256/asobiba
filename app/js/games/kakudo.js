// 角度あわせ。「135°」のように言われた角度に、2本の棒を目分量で開く。いちばん近い人が点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-19 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 棒の1本を指で回して合わせ、「決定」を押す。土台の棒の向きは毎回変える（画面のふちを目安にできないように）。
//   - 点はニアピンクイズと同じ: いちばん近い人から 3・2・1点、ぴったり（1度以内）ならさらに +2点。10問（詳細設定で 5・20問）。
//   - 詳細設定「むずかしさ」: やさしい（30・45・60・90・120・135・150度のようなきりのいい角度だけ）・ふつう（5度きざみ。最初）・
//     むずかしい（1度きざみで、180度を超える角度も出る）。
// Claude の判断:
//   - 開いた角度は、やさしい・ふつうでは2本の棒の間の小さい方（0〜180度。どちら回りに開いてもよい）。むずかしいだけは、180度を超える角度を表すため
//     土台の棒から動かす棒まで「左回り」に測る。どちらも、数える側の間を色で塗るので見て分かる。いまの角度の数は出さない（目分量の遊びのため）。
//     手には動かした棒の向き（土台から左回りの角度）をそのまま入れ、点を数えるときに effOf で開いた角度にする（答えのときに、開いたとおりの向きで棒を出すため）。
//   - ふつうは 10〜170度、むずかしいは 5〜355度（180度ちょうどは出さない）。動かす棒は、問題ごとに種で決めた角度から始める（0度から始めると土台と重なって見えないため）。
//   - 指（マウス）で図のどこを押しても、その向きに棒が回る。細かく合わせる「◀ 1°」「1° ▶」のボタンも置く（PC は ← → キー、決定は Enter）。
//   - 近さは2つの角度の差（360度の回りを考え、小さい方）。同じ近さの人どうしは先に決めた人を上にする。4番目より遠い人は0点（ぴったりの +2点だけはもらえる）。
//   - 1問の制限時間は15秒。全員が決めたら1.5秒で締め切る。答えを見せる間は4.5秒で、全員の棒を色ごとに重ねて出し、正解を ★ の点線で出す。
//   - CPU は4〜10秒で決め、正解からおよそ ±20度の幅でずれる（ずれの平均は7度ほど）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（ニアピンクイズと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, a: 開いた角度（0〜359 の整数）, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, SEAT_COLORS } from './party.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 10);
const LEVELS = [['easy', 'やさしい'], ['normal', 'ふつう'], ['hard', 'むずかしい']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;
const PTS = [3, 2, 1];
export const EXACT = 1; // この差までは「ぴったり」
export const EXACT_BONUS = 2;
export const EASY = [30, 45, 60, 90, 120, 135, 150];

// 2つの角度の差（0〜180）
export const angDiff = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return Math.min(d, 360 - d); };
// 動かした棒の向き a（土台から左回り）→ 開いた角度。むずかしい（hard）は左回りのまま、ほかは小さい方
export const effOf = (a, hard) => (hard ? a : Math.min(a, 360 - a));
// 言われた角度 t からのずれ
export const missOf = (a, t, hard) => angDiff(effOf(a, hard), t);

// 全部の問題（種・むずかしさから決まるので全員同じ）。t = 開く角度、base = 土台の棒の向き、a0 = 動かす棒の始まりの角度
export function makeQuestions(k, seed, level) {
  const rnd = mulberry32((seed * 211 + 23) >>> 0);
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pool = level === 'easy' ? EASY : level === 'hard' ? null : Array.from({ length: 33 }, (_, i) => 10 + i * 5);
  let bag = [];
  return Array.from({ length: k }, () => {
    let t;
    if (!pool) { do t = int(5, 355); while (t === 180); }
    else { if (!bag.length) bag = shuffle(pool, rnd); t = bag.pop(); }
    const base = int(0, 359);
    let a0;
    do a0 = int(15, 345); while (missOf(a0, t, level === 'hard') < 25);
    return { t, base, a0 };
  });
}

// 1問ぶんの点。ans[p] = { a, ms } | null
export function anglePoints(ans, t, hard = false) {
  return ans.map((x) => {
    if (!x) return 0;
    const d = missOf(x.a, t, hard);
    const rank = ans.filter((y) => y && (missOf(y.a, t, hard) < d || (missOf(y.a, t, hard) === d && y.ms < x.ms))).length;
    return (PTS[rank] ?? 0) + (d <= EXACT ? EXACT_BONUS : 0);
  });
}
// いちばん近かった人たち（近さも速さも同じなら全員）
export function closestOf(ans, t, hard = false) {
  const got = ans.map((x, p) => (x ? { p, d: missOf(x.a, t, hard), ms: x.ms } : null)).filter(Boolean);
  if (!got.length) return [];
  const best = got.reduce((x, y) => (y.d < x.d || (y.d === x.d && y.ms < x.ms) ? y : x));
  return got.filter((x) => x.d === best.d && x.ms === best.ms).map((x) => x.p);
}

const qKey = (s, q = s.q) => `kakudo:${s.seed}:${levelOf(s.rules)}:${q}`; // むずかしさも入れる（数のきまり当てと同じ理由）
const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.slice() });
const cur = new Map(); // いま合わせている角度（qKey + 席 → 角度）。送らない
const cpuPlan = new Map();
let keyHandler = null;
let keysHooked = false;
let ui = null; // { mount, chips }

/* ---------- 図 ---------- */
const C = 150; // 回る中心
const ARM = 128;
// 画面の向き（左回りの角度）→ 座標（SVG は下向きが +y）
const pt = (deg, r) => [C + r * Math.cos((deg * Math.PI) / 180), C - r * Math.sin((deg * Math.PI) / 180)];
const f1 = (v) => Math.round(v * 10) / 10;
function arcPath(from, a, r) {
  if (a <= 0) return '';
  const [x0, y0] = pt(from, r);
  const [x1, y1] = pt(from + a, r);
  return `M${C} ${C} L${f1(x0)} ${f1(y0)} A${r} ${r} 0 ${a > 180 ? 1 : 0} 0 ${f1(x1)} ${f1(y1)} Z`;
}
const bar = (deg, cls, color = '') => {
  const [x, y] = pt(deg, ARM);
  return `<line class="${cls}" x1="${C}" y1="${C}" x2="${f1(x)}" y2="${f1(y)}"${color ? ` style="stroke:${color}"` : ''}/>`;
};

export default {
  id: 'kakudo',
  name: '角度あわせ',
  icon: '📐',
  desc: '言われた角度に棒を開く。目分量でいちばん近い人が点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: 'やさしい: 30°・45°・90° などきりのいい角度／ふつう: 5°きざみ／むずかしい: 1°きざみで、180°を超える角度も出る', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, level: 'normal', ...rules };
    return { n, seed, rules: r, qs: makeQuestions(roundsOf(r), seed, levelOf(r)), q: -1, phase: 'ready', ans: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return b.phase === 'end' ? null : 'question';
      return me >= 0 && b.last?.pts[me] > 0 ? 'correct' : null;
    }
    return m.p === me ? 'pop' : null; // ほかの人が決めた音は鳴らさない（ニアピンクイズと同じ）
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.ans.every((a) => a !== null)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
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
        const t = s.qs[s.q].t;
        const hard = levelOf(s.rules) === 'hard';
        const pts = anglePoints(s.ans, t, hard);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const near = closestOf(s.ans, t, hard);
        s.last = { pts, near };
        s.log = [...s0.log, { ans: s.ans.slice(), pts, near }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.ans[m.p] !== null) return null;
    if (!Number.isInteger(m.a) || m.a < 0 || m.a > 359) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.ans[m.p] = { a: m.a, ms: Math.round(m.ms) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.ans[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const err = Math.round((Math.random() + Math.random() - 1) * 20);
      plan = { at: 4000 + Math.random() * 6000, a: (((s.qs[s.q].t + err) % 360) + 360) % 360 };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, a: plan.a, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const hard = levelOf(s.rules) === 'hard';
    const extra = (p) => {
      if (s.phase === 'open') return s.ans[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const a = s.ans[p];
      if (!a) return '<span class="pt-ng">―</span>';
      const d = missOf(a.a, s.qs[s.q].t, hard);
      const pt0 = s.last.pts[p];
      return `<span class="${pt0 > 0 ? 'pt-ok' : 'pt-ng'}">${d === 0 ? 'ぴったり' : `ずれ ${d}°`}${pt0 > 0 ? ` +${pt0}` : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替える（ほかの人が決めるたびに作り直すと、棒を回している指が外れるため。目押しそろえと同じ）
    const mount = `${s.seed}:${levelOf(s.rules)}:${s.q}:${s.phase}:${me}:${me !== null && s.ans[me] !== null}:${o.canMove}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    ui = { mount, chips };
    keyHandler = null;
    root.innerHTML = '';
    root.className = 'board kj kdo';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">言われた角度に棒を開こう。いちばん近い人が3点、ぴったりなら +2点・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    card.insertAdjacentHTML('beforeend', `<div class="kdo-t">${x.t}°</div>`);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('class', 'kdo-fig');
    const mine = me !== null ? s.ans[me] : null;
    const tk = key + ':' + me;
    if (shown) {
      // 全員の棒（色ごと）と正解（★ の点線）。やさしい・ふつうで自分が右回りに開いていたら、正解も右回りの側に出す（見比べやすいように）
      const cw = !hard && mine && mine.a > 180;
      const right = cw ? x.base - x.t : x.base + x.t;
      let body = `<path class="kdo-arc ans" d="${cw ? arcPath(right, x.t, 46) : arcPath(x.base, x.t, 46)}"/>` + bar(x.base, 'kdo-base');
      // やさしい・ふつうは、ほかの人の棒も正解と同じ側にそろえて出す（どちら回りに開いたかは点に関わらないため）
      const dirOf = (a) => (hard ? x.base + a : cw ? x.base - effOf(a, false) : x.base + effOf(a, false));
      s.ans.forEach((a, p) => { if (a) body += bar(dirOf(a.a), 'kdo-other' + (p === me ? ' me' : ''), SEAT_COLORS[p % SEAT_COLORS.length]); });
      body += bar(right, 'kdo-right');
      const [sx, sy] = pt(right, ARM + 12);
      body += `<text class="kdo-star" x="${f1(sx)}" y="${f1(sy)}">★</text><circle class="kdo-pivot" cx="${C}" cy="${C}" r="6"/>`;
      svg.innerHTML = body;
      card.append(svg);
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const near = s.last.near.map((p) => (p === me ? 'あなた' : o.names[p]));
      t.textContent = near.length ? `いちばん近かったのは ${near.join('・')}${mine ? `・あなたの角度 ${effOf(mine.a, hard)}°` : ''}` : 'だれも決めませんでした';
      card.append(t);
      return;
    }
    since(key);
    const canNow = () => me !== null && o.canMove && mine === null && since(key) < LIMIT && !svg.dataset.sent;
    let a = mine ? mine.a : cur.get(tk) ?? x.a0;
    const draw = () => {
      const [kx, ky] = pt(x.base + a, ARM);
      const arc = !hard && a > 180 ? arcPath(x.base + a, 360 - a, 46) : arcPath(x.base, a, 46); // やさしい・ふつうは小さい方の間を塗る
      svg.innerHTML = `<path class="kdo-arc" d="${arc}"/>` + bar(x.base, 'kdo-base') + bar(x.base + a, 'kdo-move')
        + `<circle class="kdo-knob" cx="${f1(kx)}" cy="${f1(ky)}" r="13"/><circle class="kdo-pivot" cx="${C}" cy="${C}" r="6"/>`;
    };
    const setA = (v) => {
      if (!canNow()) return;
      a = ((Math.round(v) % 360) + 360) % 360;
      cur.set(tk, a);
      if (cur.size > 100) cur.delete(cur.keys().next().value);
      draw();
    };
    // 押した場所の向きに棒を回す
    const toward = (e) => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const dx = ((e.clientX - r.left) / r.width) * 300 - C;
      const dy = ((e.clientY - r.top) / r.height) * 300 - C;
      if (Math.hypot(dx, dy) < 12) return;
      setA((Math.atan2(-dy, dx) * 180) / Math.PI - x.base);
    };
    let drag = false;
    svg.onpointerdown = (e) => { if (!canNow()) return; e.preventDefault(); drag = true; svg.setPointerCapture?.(e.pointerId); toward(e); };
    svg.onpointermove = (e) => { if (drag) toward(e); };
    svg.onpointerup = svg.onpointercancel = () => { drag = false; };
    draw();
    card.append(svg);
    card.append(timeBar(key, LIMIT, { secs: true }));
    const row = document.createElement('div');
    row.className = 'kdo-btns';
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = (e) => { e.preventDefault(); fn(); };
      row.append(b);
      return b;
    };
    const send = () => {
      if (!canNow()) return;
      const ms = Math.round(since(key));
      if (ms >= LIMIT) return;
      svg.dataset.sent = '1';
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      o.onMove({ t: 'ans', q: s.q, a, ms });
    };
    btn('◀ 1°', 'secondary', () => setA(a + 1)); // 左回りに開く（数が増える）
    btn('決定', 'kdo-ok', send);
    btn('1° ▶', 'secondary', () => setA(a - 1));
    if (!canNow()) row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    wrap.append(row);
    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (me === null) msg.textContent = '観戦中';
    else if (mine) msg.textContent = `✔ 決めました（${secText(mine.ms)}）。ほかの人を待っています`;
    else msg.textContent = '棒を回して「決定」（決められるのは1回だけ）';
    wrap.append(msg);
    if (canNow()) {
      keyHandler = (e) => {
        if (!svg.isConnected) return;
        if (e.key === 'ArrowLeft') setA(a + 1);
        else if (e.key === 'ArrowRight') setA(a - 1);
        else if (e.key === 'Enter') send();
        else return;
        e.preventDefault();
      };
      // 読み込んだときでなく最初に描くときに1回だけ付ける（tools/test-logic.mjs は Node で読むので window が無い）
      if (!keysHooked) {
        keysHooked = true;
        window.addEventListener('keydown', (e) => {
          if (!keyHandler || e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
          keyHandler(e);
        });
      }
      setTimeout(() => {
        if (!svg.isConnected || svg.dataset.sent) return;
        row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        msg.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
    }
  },

  review(s, me, o) {
    const hard = levelOf(s.rules) === 'hard';
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const smy = document.createElement('summary');
    smy.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const g = s.qs[q];
      const li = document.createElement('li');
      const a = me === null ? null : x.ans[me];
      const mine = me === null ? '' : a ? `${effOf(a.a, hard)}°（ずれ ${missOf(a.a, g.t, hard)}°）${x.pts[me] ? ` +${x.pts[me]}` : ''}` : '―';
      const near = x.near.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span><b>${g.t}°</b></span><span>${esc(mine)}</span>`;
      const who = document.createElement('span');
      who.className = 'mk-rv-who';
      who.textContent = near.length ? '🎯' + near.join('・') : '―';
      li.append(who);
      list.append(li);
    });
    box.append(smy, list);
    return box;
  },
};
