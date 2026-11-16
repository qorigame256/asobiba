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
// 2026-11-16 の42回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 回数（rounds）: 3・5（最初）・8回。
//   - 偽物（fake）: 重い（最初）・重いか軽いか分からない（回ごとに種から半々。答えるのは玉だけ。結果の画面で「軽い」「重い」を見せる）。
//   - はかれる回数の上限（cap。はい/いいえ）: うまくはかれば必ず当てられる最少の回数まで。
//     重い: 4個 2回・9個 2回・27個 3回。重いか軽いか分からない: 4個 2回・9個 3回・27個 4回（本物と分かった玉を次にのせてよいので (3^回数 − 1) / 2 個まで当てられる）。
//     上限まではかったら、あとは答えるだけ。みんなで1台では、みんなではかった回数の合計に上限がかかる。
//   - 答え直し（retry。はい/いいえ。ひとりずつのときだけ）: 1回目が外れたらその場で「はずれ」と分かり、もう1回だけ答えられる。2回目で当たっても1点で、ほかの人の 3点・2点の順位には数えない。
//     外れたことはほかの人の画面には出さない。手は { t: 'ans', …, k: 1 | 2 }（同じ手が2回届いても2回目は弾かれる）。
//   - 遊び方（mode）: ひとりずつ（最初）・みんなで1台。みんなで1台は、1台のてんびんを順番に使う:
//     自分の番には「はかる」か「答える」のどちらか1つ。はかった結果も答え（はずれの玉）も全員に見える。当てた人がその回の1点で、次の回へ。外したらその回は抜ける。
//     1回の番は20秒（27個は25秒）で、過ぎたら次の人へ（パス）。番の続く人が全員パスしたら、その回はだれも当てずに終わり。
//     回ごとに最初の人を1つずつずらす（第1回は席0から）。手は { t: 'weigh', q, tn, L, R } / { t: 'ans', q, tn, b } / { p: -1, t: 'pass', tn }（tn は番の通し番号。古い番の手は弾く）。
//     CPU は自分の番に、それまでの結果から考えられる偽物を絞り、3回に1回ほど筋の悪いのせ方をする。残り3個以下なら4割ほど当てずっぽうで答える。考える時間は 1.8〜4秒。
//   - 重いか軽いか分からないときの CPU は、考えられる「玉と重い・軽い」の組をいちばん細かく分けるのせ方を、決まった形と種から作ったばらばらの形の中から選ぶ。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数字タッチと同じ）
// 手: { p: -1, t: 'next' | 'close' | 'pass' } / { p, t: 'ans', q, b, w, ms, k } / みんなで1台は上のとおり

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;
const WIN_MS = 1200; // みんなで1台で当たってから締め切るまで
const WEIGH_MS = 800; // てんびんが傾くまで（その間は玉を動かせない）
const ROUNDS = [[3, '3回'], [5, '5回'], [8, '8回']];
const PTS = [3, 2];
const SIZES = [[4, 'やさしい（4個）'], [9, 'ふつう（9個）'], [27, 'むずかしい（27個）']];
const FAKES = [['heavy', '重い'], ['any', '重いか軽いか分からない']];
const MODES = [['solo', 'ひとりずつ'], ['share', 'みんなで1台']];
const LIMITS = { 4: 30000, 9: 60000, 27: 90000 };
const TURN_MS = { 4: 20000, 9: 20000, 27: 25000 };
const CAPS = { heavy: { 4: 2, 9: 2, 27: 3 }, any: { 4: 2, 9: 3, 27: 4 } };
const sizeOf = (r) => (SIZES.some(([v]) => v === r.size) ? r.size : 9);
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 5);
const limitOf = (s) => LIMITS[s.size];
const turnMs = (s) => TURN_MS[s.size];
export const capOf = (s) => (s.cap ? CAPS[s.fake][s.size] : Infinity);
const qKey = (s, q = s.q) => `tenbin:${s.seed}:${q}`;
const turnKey = (s) => `tenbin:${s.seed}:${s.q}:t${s.tn}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.slice(), miss: s.miss.slice(), out: s.out.slice() });
const doneOf = (s, p) => s.ans[p] !== null;
const weighCount = (hist) => hist.filter((h) => h.L).length;
const fakeText = (s) => (s.fake === 'any' ? '1つだけ重さのちがう偽物（重いか軽いかは分からない）' : '1つだけ少し重い偽物');

// 左右の皿にのせた玉の番号から結果: 'L'（左が重い）| 'R' | '='。light は偽物が軽いとき
export const weigh = (fake, left, right, light = false) => {
  const r = left.includes(fake) ? 'L' : right.includes(fake) ? 'R' : '=';
  return !light || r === '=' ? r : r === 'L' ? 'R' : 'L';
};

// 締め切りのときの点。当たった人のうち（回数, 時間）の小さい順に 3・2・それ以降は1点。まったく同じなら同じ点。
// 答え直しで当たった人（re）は1点で、順位には数えない
export function pointsOf(ans, fake) {
  const ok = (a) => a && a.b === fake && !a.re;
  return ans.map((a) => {
    if (a && a.re) return a.b === fake ? 1 : 0;
    if (!ok(a)) return 0;
    const rank = ans.filter((x) => ok(x) && (x.w < a.w || (x.w === a.w && x.ms < a.ms))).length;
    return PTS[rank] ?? 1;
  });
}

// 考えられる偽物の組（玉 b, 向き d: 1 重い・−1 軽い）
const allHyps = (size, fake) => Array.from({ length: size }, (_, b) => (fake === 'any' ? [{ b, d: 1 }, { b, d: -1 }] : [{ b, d: 1 }])).flat();
const predict = (h, L, R) => (L.includes(h.b) ? (h.d > 0 ? 'L' : 'R') : R.includes(h.b) ? (h.d > 0 ? 'R' : 'L') : '=');
const ballsOf = (H) => [...new Set(H.map((h) => h.b))];
// これまでの結果（はかった結果・はずれの答え）から、考えられる組を絞る
export function narrow(size, fake, hist) {
  let H = allHyps(size, fake);
  for (const h of hist) {
    if (h.L) H = H.filter((x) => predict(x, h.L, h.R) === h.r);
    else if (!h.ok) H = H.filter((x) => x.b !== h.b);
  }
  return H;
}
// のせ方を選ぶ。結果で分かれた組のうちいちばん多いものが少ないほど良い。good でなければ最初に試した形（筋の悪いことが多い）
export function chooseSplit(H, size, rnd, good) {
  const balls = ballsOf(H);
  const sure = Array.from({ length: size }, (_, i) => i).filter((i) => !balls.includes(i)); // 本物と分かっている玉
  const tries = [];
  // ばらばらの形（種から）
  for (let i = 0; i < 24; i++) {
    const idx = Array.from({ length: size }, (_, k) => k);
    for (let k = idx.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [idx[k], idx[j]] = [idx[j], idx[k]]; }
    const k = 1 + Math.floor(rnd() * Math.floor(size / 2));
    tries.push([idx.slice(0, k), idx.slice(k, 2 * k)]);
  }
  // 決まった形: 候補を3つに分け、右の皿の足りない分は本物の玉で埋める
  for (const k of [Math.ceil(balls.length / 3), Math.floor(balls.length / 2)]) {
    for (const fill of [0, 1, 2]) {
      const L = balls.slice(0, k);
      const R = balls.slice(k, 2 * k - fill);
      const pad = sure.slice(0, L.length - R.length);
      if (L.length && R.length + pad.length === L.length) tries.push([L, [...R, ...pad]]);
    }
  }
  const worst = ([L, R]) => {
    const c = { L: 0, R: 0, '=': 0 };
    for (const h of H) c[predict(h, L, R)] += 1;
    return Math.max(c.L, c.R, c['=']);
  };
  if (!good) return { L: tries[0][0], R: tries[0][1] };
  let best = null, bv = Infinity;
  for (const t of tries) { const v = worst(t); if (v < bv) { bv = v; best = t; } }
  if (!best || bv >= H.length) return null; // どうはかっても分からない
  return { L: best[0], R: best[1] };
}

// CPU のふるまい（はかる時刻の一覧・答える時刻・答える玉・答え直し）。種・何回目・席から決める
export function cpuPlan(s, q, p) {
  const rnd = mulberry32((s.seed * 41 + q * 13 + p * 1019 + 5557) >>> 0);
  const fake = s.qs[q], light = !!s.light?.[q];
  const cap = capOf(s);
  const [lo, hi] = s.size === 27 ? [3500, 6000] : [2500, 5000];
  const weighs = [];
  let t = 1000 + rnd() * 1500;
  let b = null;
  let left = [];
  if (s.fake !== 'any') {
    let cand = Array.from({ length: s.size }, (_, i) => i);
    for (let guard = 0; guard < 10 && b === null; guard++) {
      if (cand.length === 1) { b = cand[0]; break; }
      if (cand.length <= 3 && rnd() < 0.33) { b = cand[Math.floor(rnd() * cand.length)]; break; }
      if (weighs.length >= cap) { b = cand[Math.floor(rnd() * cand.length)]; break; }
      const k = rnd() < 0.33 ? Math.floor(cand.length / 2) : Math.ceil(cand.length / 3);
      const L = cand.slice(0, k), R = cand.slice(k, 2 * k);
      const r = weigh(fake, L, R);
      cand = r === 'L' ? L : r === 'R' ? R : cand.slice(2 * k);
      t += lo + rnd() * (hi - lo);
      weighs.push(Math.round(t));
    }
    left = cand;
  } else {
    let H = allHyps(s.size, 'any');
    for (let guard = 0; guard < 10 && b === null; guard++) {
      const balls = ballsOf(H);
      if (balls.length === 1) { b = balls[0]; break; }
      if ((balls.length <= 3 && rnd() < 0.33) || weighs.length >= cap) { b = balls[Math.floor(rnd() * balls.length)]; break; }
      const sp = chooseSplit(H, s.size, rnd, rnd() >= 0.33);
      if (!sp) { b = balls[Math.floor(rnd() * balls.length)]; break; }
      const r = weigh(fake, sp.L, sp.R, light);
      H = H.filter((h) => predict(h, sp.L, sp.R) === r);
      t += lo + rnd() * (hi - lo);
      weighs.push(Math.round(t));
    }
    left = ballsOf(H);
    if (b === null) b = left[Math.floor(rnd() * left.length)];
  }
  t += 800 + rnd() * 1500;
  const plan = { weighs, at: Math.round(t), b, w: weighs.length };
  // 答え直し: 外れたら、残りの候補からもう1つ選ぶ
  if (s.retry && b !== null && b !== fake) {
    const rest = left.filter((x) => x !== b);
    plan.b2 = rest.length ? rest[Math.floor(rnd() * rest.length)] : (b + 1) % s.size;
    plan.at2 = Math.round(t + 1500 + rnd() * 1500);
  }
  return plan;
}

// みんなで1台: 次の人へ番を回す
function nextTurn(s) {
  for (let k = 1; k <= s.n; k++) {
    const p = (s.turnP + k) % s.n;
    if (!s.out[p]) { s.turnP = p; break; }
  }
  s.tn += 1;
}
const activeCount = (s) => s.out.filter((v) => !v).length;
const shareOver = (s) => s.win !== null || activeCount(s) === 0 || s.pass >= activeCount(s);
const validSide = (a, size) => Array.isArray(a) && a.length >= 1 && a.every((x) => Number.isInteger(x) && x >= 0 && x < size) && new Set(a).size === a.length;

let loc = null; // この端末の様子 { key, at: 玉ごとの置き場所 0 外・1 左・2 右, w, hist, pick, busy, tilt, sent, miss }
let ui = null;
let tiltedKey = ''; // みんなで1台: 傾けて見せ終えた結果（何回目のはかり）
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
    { key: 'rounds', label: '回数', desc: '全部で何回遊ぶか', def: 5, choices: ROUNDS },
    { key: 'fake', label: '偽物', desc: '重いか軽いか分からない: 偽物が軽いこともある（答えるのは玉だけ）', def: 'heavy', choices: FAKES },
    { key: 'cap', label: 'はかれる回数の上限', desc: 'うまくはかれば必ず当てられる、ぎりぎりの回数までしかはかれない', def: false },
    { key: 'retry', label: '答え直し', desc: '外れても1回だけ答え直せる（当たっても1点。ひとりずつのときだけ）', def: false },
    { key: 'mode', label: '遊び方', desc: 'みんなで1台: 1台のてんびんを順番に使い、結果は全員に見える。自分の番に答えてもよく、当てた人の1点', def: 'solo', choices: MODES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: 9, rounds: 5, fake: 'heavy', cap: false, retry: false, mode: 'solo', ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const qs = Array.from({ length: roundsOf(r) }, () => Math.floor(rnd() * size));
    const fake = r.fake === 'any' ? 'any' : 'heavy';
    const rnd2 = mulberry32((seed * 11 + 70001) >>> 0); // 軽い偽物（偽物の場所とは別の種）
    const light = qs.map(() => fake === 'any' && rnd2() < 0.5);
    const share = r.mode === 'share';
    return {
      n, seed, rules: r, size, fake, light, cap: !!r.cap, retry: !!r.retry && !share, share, qs, q: -1, phase: 'ready',
      ans: Array(n).fill(null), miss: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
      turnP: 0, tn: 0, hist: [], out: Array(n).fill(false), win: null, pass: 0,
    };
  },

  turn(s) { return s.share && s.phase === 'open' && !shareOver(s) ? s.turnP : null; },
  canAct(s, p) { return s.share ? s.phase === 'open' && !shareOver(s) && p === s.turnP : s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return 'question';
      if (m.t === 'pass') return null;
      if (b.share) return null; // 当たり・はずれは答えたときに鳴らした
      return b.last.pts[me] > 0 ? 'correct' : me >= 0 && b.last && (a.ans[me] || a.miss[me] !== null) ? 'wrong' : 'pop';
    }
    if (!b.share) return null;
    const h = b.hist[b.hist.length - 1];
    if (m.t === 'weigh') return h.r === '=' ? 'pop' : 'smack';
    return h.ok ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}回 / ${s.qs.length}`;
    return `第${s.q + 1}回の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open' && s.share) {
      if (shareOver(s)) return { key: 'over' + s.q, ms: s.win !== null ? WIN_MS : GRACE_MS, move: { t: 'close' } };
      return { key: `turn${s.q}:${s.tn}`, ms: turnMs(s) + 500, move: { t: 'pass', tn: s.tn } };
    }
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
        s.miss = Array(s.n).fill(null);
        s.turnP = s.q % s.n;
        s.tn = 0;
        s.hist = [];
        s.out = Array(s.n).fill(false);
        s.win = null;
        s.pass = 0;
        return s;
      }
      if (m.t === 'pass' && s0.share && s0.phase === 'open' && m.tn === s0.tn && !shareOver(s0)) {
        const s = clone(s0);
        s.step += 1;
        s.pass += 1;
        nextTurn(s);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const fake = s.qs[s.q];
        let pts;
        if (s.share) {
          pts = Array(s.n).fill(0);
          if (s.win !== null) pts[s.win] = 1;
        } else pts = pointsOf(s.ans, fake);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const winners = pts.map((v, p) => (v > 0 && v === Math.max(...pts) ? p : -1)).filter((p) => p >= 0);
        s.last = { winners, pts };
        s.log = [...s0.log, s.share
          ? { share: true, fake, light: s.light[s.q], win: s.win, w: weighCount(s.hist), pts }
          : { ans: s.ans.slice(), miss: s.miss.slice(), fake, light: s.light[s.q], pts }];
        return s;
      }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.phase !== 'open' || m.q !== s0.q) return null;
    const fake = s0.qs[s0.q];
    // みんなで1台
    if (s0.share) {
      if (m.p !== s0.turnP || m.tn !== s0.tn || shareOver(s0)) return null;
      if (m.t === 'weigh') {
        if (!validSide(m.L, s0.size) || !validSide(m.R, s0.size) || m.L.length !== m.R.length || m.L.some((x) => m.R.includes(x))) return null;
        if (weighCount(s0.hist) >= capOf(s0)) return null;
        const s = clone(s0);
        s.step += 1;
        const L = m.L.slice(), R = m.R.slice();
        s.hist = [...s0.hist, { p: m.p, L, R, r: weigh(fake, L, R, s0.light[s0.q]) }];
        s.pass = 0;
        nextTurn(s);
        return s;
      }
      if (m.t === 'ans') {
        if (!Number.isInteger(m.b) || m.b < 0 || m.b >= s0.size) return null;
        const s = clone(s0);
        s.step += 1;
        const ok = m.b === fake;
        s.hist = [...s0.hist, { p: m.p, b: m.b, ok }];
        s.pass = 0;
        if (ok) s.win = m.p;
        else { s.out[m.p] = true; nextTurn(s); }
        return s;
      }
      return null;
    }
    // ひとりずつ
    if (m.t !== 'ans' || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.b) || m.b < 0 || m.b >= s0.size || !Number.isInteger(m.w) || m.w < 0 || m.w > 99 || m.w > capOf(s0)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 300) || m.ms > limitOf(s0) + 500) return null;
    const k = m.k === 2 ? 2 : 1;
    if (k === 2 && (!s0.retry || s0.miss[m.p] === null || m.b === s0.miss[m.p])) return null;
    if (k === 1 && s0.miss[m.p] !== null) return null;
    const s = clone(s0);
    s.step += 1;
    if (k === 1 && s0.retry && m.b !== fake) { s.miss[m.p] = m.b; return s; }
    s.ans[m.p] = { b: m.b, w: m.w, ms: Math.round(m.ms), ...(k === 2 ? { re: true } : {}) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? (s.share ? 300 : 200) : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    if (s.share) {
      const rnd = mulberry32((s.seed * 43 + s.q * 17 + s.tn * 101 + p * 1031 + 3331) >>> 0);
      if (since(turnKey(s)) < 1800 + rnd() * 2200) return null;
      const H = narrow(s.size, s.fake, s.hist);
      const balls = ballsOf(H);
      const guess = () => ({ t: 'ans', q: s.q, tn: s.tn, b: balls[Math.floor(rnd() * balls.length)] });
      if (balls.length === 1) return { t: 'ans', q: s.q, tn: s.tn, b: balls[0] };
      if ((balls.length <= 3 && rnd() < 0.4) || weighCount(s.hist) >= capOf(s)) return guess();
      const sp = chooseSplit(H, s.size, rnd, rnd() >= 0.33);
      return sp ? { t: 'weigh', q: s.q, tn: s.tn, L: sp.L, R: sp.R } : guess();
    }
    if (doneOf(s, p)) return null;
    const plan = cpuPlan(s, s.q, p);
    const t = since(qKey(s));
    if (s.miss[p] !== null) {
      if (plan.b2 === undefined || plan.at2 >= limitOf(s)) return null;
      return t >= plan.at2 ? { t: 'ans', q: s.q, b: plan.b2, w: plan.w, ms: Math.max(plan.at2, Math.round(t)), k: 2 } : null;
    }
    if (plan.b === null || plan.at >= limitOf(s)) return null;
    return t >= plan.at ? { t: 'ans', q: s.q, b: plan.b, w: plan.w, ms: Math.max(plan.at, Math.round(t)), k: 1 } : null;
  },

  // ほかの人のはかった回数（見た目だけ）
  onStream(d, from) {
    if (!d || !Number.isInteger(d.w) || typeof d.key !== 'string' || from < 0) return;
    others.set(from, { key: d.key, w: d.w });
    ui?.paintChips?.();
  },

  render(root, s, o) {
    if (s.share) { this.renderShare(root, s, o); return; }
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${me !== null && s.miss[me]}:${!!o.canMove}`;
    const key = qKey(s);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const cap = capOf(s);
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
      if (!a) return s.miss[p] !== null ? '<span class="pt-ng">× はずれ</span>' : '<span class="pt-ng">―</span>';
      if (a.b !== s.qs[s.q]) return '<span class="pt-ng">× はずれ</span>';
      return a.re ? `<span class="pt-ok">○ 答え直し +${s.last.pts[p]}</span>` : `<span class="pt-ok">○ ⚖️${a.w} +${s.last.pts[p]}</span>`;
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}個の玉の中に、${fakeText(s)}がある・全${s.qs.length}回・1回 ${limit / 1000}秒まで</div>`;
      return;
    }
    const fake = s.qs[s.q];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub">${s.size}個のうち${fakeText(s)}を当てよう。はかる回数が少ないほど高い点</div>`);
      card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const names = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p]));
      t.textContent = `偽物は ${fake + 1}番${s.fake === 'any' ? (s.light[s.q] ? '（軽い）' : '（重い）') : ''}。` + (names.length ? `いちばんは ${names.join('・')}` : 'だれも当てられませんでした');
      card.append(t);
    }

    if (loc?.key !== key) loc = { key, at: Array(s.size).fill(0), w: 0, hist: [], pick: false, busy: false, tilt: '', sent: false, miss: null };
    if (me !== null && s.miss[me] !== null) { loc.miss = s.miss[me]; if (loc.sent && !doneOf(s, me) && loc.sent.k === 1) loc.sent = false; }
    const playing = () => s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;

    const scale = drawScale();
    const btnBox = document.createElement('div');
    btnBox.className = 'tb-btns';
    const weighBtn = mkBtn('⚖️ はかる', 'primary');
    const clearBtn = mkBtn('ぜんぶ下ろす', 'secondary');
    const pickBtn = mkBtn('🔍 これが偽物！', 'secondary');
    btnBox.append(weighBtn, clearBtn, pickBtn);
    const { tray, balls } = drawTray(s.size);
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
        const no = s.phase === 'open' && loc.miss === i;
        b.classList.toggle('tb-l', at === 1);
        b.classList.toggle('tb-r', at === 2);
        b.classList.toggle('tb-no', no);
        b.classList.toggle('tb-fake', s.phase === 'shown' && i === fake);
        b.classList.toggle('tb-mine', s.phase === 'shown' && mine?.b === i);
        b.classList.toggle('tb-choose', on && loc.pick && !no);
        b.querySelector('small').textContent = s.phase === 'shown' ? (i === fake ? '偽物' : '') : no ? '×' : at === 1 ? '左' : at === 2 ? '右' : '';
        b.disabled = !on || loc.busy || (loc.pick && no);
      });
      scale.set(s.phase === 'open' ? L : [], s.phase === 'open' ? R : [], s.phase === 'open' ? loc.tilt : '');
      weighBtn.disabled = !on || loc.busy || loc.pick || !L.length || L.length !== R.length || loc.w >= cap;
      clearBtn.disabled = !on || loc.busy || loc.pick || (!L.length && !R.length);
      pickBtn.disabled = !on || loc.busy;
      pickBtn.textContent = loc.pick ? 'やめる' : '🔍 これが偽物！';
      pickBtn.classList.toggle('primary', loc.pick);
      pickBtn.classList.toggle('secondary', !loc.pick);
      btnBox.hidden = s.phase !== 'open' || me === null || doneOf(s, me) || !!loc.sent;
      hist.innerHTML = '';
      loc.hist.forEach((h, n) => {
        const li = document.createElement('li');
        li.innerHTML = `<b>${n + 1}回目</b> ${weighText(h)}`;
        hist.append(li);
      });
      hist.hidden = s.phase !== 'open' || !loc.hist.length;
      const left = Number.isFinite(cap) ? `（はかれるのは あと${Math.max(0, cap - loc.w)}回）` : '';
      note.textContent = s.phase !== 'open'
        ? (me === null ? '' : !mine ? (s.miss[me] !== null ? `はずれ（あなたは ${s.miss[me] + 1}番と答えた）` : 'この回は答えませんでした')
          : mine.b === fake ? (mine.re ? '答え直しで当たり！（1点）' : `当たり！（はかった回数 ${mine.w}回・${secText(mine.ms)}）`) : `はずれ（あなたは ${mine.b + 1}番と答えた）`)
        : me === null ? '観戦中'
        : doneOf(s, me) || loc.sent ? `${(mine ?? loc.sent).b + 1}番と答えました（はかった回数 ${mine?.w ?? loc.w}回）。ほかの人を待っています`
        : loc.pick ? `偽物だと思う玉を押してください（${loc.miss !== null ? '最後の1回。当たっても1点' : s.retry ? '外れたら1回だけ答え直せます' : '答えは1回だけ'}）`
        : loc.miss !== null ? `はずれ！ ${loc.miss + 1}番は本物でした。もう1回だけ答えられます（当たっても1点）${left}`
        : `玉を押すと左の皿 → 右の皿 → 外 と移ります。左右同じ数にして「はかる」${left}`;
    };
    balls.forEach((b, i) => {
      b.onclick = () => {
        if (!playing() || loc.busy) return;
        if (loc.pick) {
          if (loc.miss === i) return;
          const ms = Math.round(since(key));
          if (ms >= limit) return;
          const k = loc.miss !== null ? 2 : 1;
          loc.sent = { b: i, k };
          loc.pick = false;
          play('place', 0.5);
          o.onMove({ t: 'ans', q: s.q, b: i, w: loc.w, ms: Math.max(ms, 300), k });
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
      if (!playing() || loc.busy || !L.length || L.length !== R.length || loc.w >= cap) return;
      loc.busy = true;
      loc.w += 1;
      const r = weigh(fake, L, R, s.light[s.q]);
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

  // みんなで1台
  renderShare(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const over = s.phase !== 'open' || shareOver(s);
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${s.tn}:${s.win}:${s.hist.length}:${!!o.canMove}`;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const cap = capOf(s);
    const nameOf = (p) => (p === me ? 'あなた' : o.names[p]);
    const extra = (p) => {
      if (s.phase === 'open') return s.win === p ? '<span class="pt-ok">当たり！</span>' : s.out[p] ? '<span class="pt-ng">× はずれ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      return s.last.pts[p] > 0 ? `<span class="pt-ok">○ +${s.last.pts[p]}</span>` : s.out[p] ? '<span class="pt-ng">× はずれ</span>' : '';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true, turn: over ? null : s.turnP });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj tb';
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}個の玉の中に、${fakeText(s)}がある・1台のてんびんを順番に使う・全${s.qs.length}回</div>`;
      return;
    }
    const fake = s.qs[s.q];
    const myTurn = !over && me !== null && o.canMove && s.turnP === me;
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div>`;
    const sub = document.createElement('div');
    sub.className = 'kj-sub';
    if (s.phase === 'shown') sub.textContent = `偽物は ${fake + 1}番${s.fake === 'any' ? (s.light[s.q] ? '（軽い）' : '（重い）') : ''}。` + (s.win !== null ? `当てたのは ${nameOf(s.win)}` : 'だれも当てられませんでした');
    else if (s.win !== null) sub.textContent = `${nameOf(s.win)}が当てた！`;
    else if (over) sub.textContent = 'だれも当てられませんでした';
    else sub.textContent = myTurn ? 'はかるか、答えるか' : ''; // だれの番かは上の帯（○○のターン）が出す
    if (sub.textContent) card.append(sub);
    const tk = turnKey(s);
    if (!over) { since(tk); card.append(timeBar(tk, turnMs(s), { secs: true })); }

    if (loc?.key !== tk) loc = { key: tk, at: Array(s.size).fill(0), pick: false, busy: false };
    const playing = () => myTurn && !loc.busy;
    const wrong = s.hist.filter((h) => h.b !== undefined && !h.ok).map((h) => h.b);
    const lastW = [...s.hist].reverse().find((h) => h.L) ?? null;
    const used = weighCount(s.hist);
    const wKey = `${qKey(s)}:${used}`;

    const scale = drawScale();
    const btnBox = document.createElement('div');
    btnBox.className = 'tb-btns';
    const weighBtn = mkBtn('⚖️ はかる', 'primary');
    const clearBtn = mkBtn('ぜんぶ下ろす', 'secondary');
    const pickBtn = mkBtn('🔍 これが偽物！', 'secondary');
    btnBox.append(weighBtn, clearBtn, pickBtn);
    const { tray, balls } = drawTray(s.size);
    const hist = document.createElement('ol');
    hist.className = 'tb-hist';
    const note = document.createElement('p');
    note.className = 'cc-log';

    const side = (k) => loc.at.map((v, i) => (v === k ? i : -1)).filter((i) => i >= 0);
    // 自分の番で玉を動かし始めたら自分の並べ方、それまでは最後にはかった形を見せる
    const arranging = () => myTurn && loc.at.some((v) => v);
    const paint = () => {
      const on = playing();
      const mine = arranging();
      const L = mine ? side(1) : lastW?.L ?? [], R = mine ? side(2) : lastW?.R ?? [];
      balls.forEach((b, i) => {
        const no = wrong.includes(i);
        const at = s.phase !== 'open' ? 0 : L.includes(i) ? 1 : R.includes(i) ? 2 : 0;
        b.classList.toggle('tb-l', at === 1);
        b.classList.toggle('tb-r', at === 2);
        b.classList.toggle('tb-no', no && s.phase === 'open');
        b.classList.toggle('tb-fake', s.phase === 'shown' && i === fake);
        b.classList.toggle('tb-choose', on && loc.pick && !no);
        b.querySelector('small').textContent = s.phase === 'shown' ? (i === fake ? '偽物' : '') : no ? '×' : at === 1 ? '左' : at === 2 ? '右' : '';
        b.disabled = !on || (loc.pick && no);
      });
      if (s.phase === 'open') scale.set(L, R, mine || tiltedKey !== wKey ? '' : lastW?.r ?? '');
      else scale.set([], [], '');
      weighBtn.disabled = !on || loc.pick || !side(1).length || side(1).length !== side(2).length || used >= cap;
      clearBtn.disabled = !on || loc.pick || !loc.at.some((v) => v);
      pickBtn.disabled = !on;
      pickBtn.textContent = loc.pick ? 'やめる' : '🔍 これが偽物！';
      pickBtn.classList.toggle('primary', loc.pick);
      pickBtn.classList.toggle('secondary', !loc.pick);
      btnBox.hidden = !myTurn;
      const left = Number.isFinite(cap) ? `（みんなで はかれるのは あと${Math.max(0, cap - used)}回）` : '';
      note.textContent = s.phase !== 'open' || over ? ''
        : myTurn ? (loc.pick ? '偽物だと思う玉を押してください（外したらこの回は抜けます）' : used >= cap ? `もうはかれません。答えてください${left}` : `玉を左右の皿に同じ数のせて「はかる」か、答える${left}`)
        : me === null ? '観戦中' : s.out[me] ? 'この回は抜けました。ほかの人を見ていましょう' : `はかった結果はみんなに見えます${left}`;
    };
    hist.innerHTML = '';
    let k = 0;
    s.hist.forEach((h) => {
      const li = document.createElement('li');
      if (h.L) { k += 1; li.innerHTML = `<b>${k}回目</b>（${esc(nameOf(h.p))}） ${weighText(h)}`; }
      else li.innerHTML = `${esc(nameOf(h.p))}: ${h.b + 1}番と答えた → ${h.ok ? '<b>当たり！</b>' : 'はずれ'}`;
      hist.append(li);
    });
    hist.hidden = s.phase !== 'open' || !s.hist.length;

    balls.forEach((b, i) => {
      b.onclick = () => {
        if (!playing()) return;
        if (loc.pick) {
          if (wrong.includes(i)) return;
          loc.busy = true;
          loc.pick = false;
          play('place', 0.5);
          o.onMove({ t: 'ans', q: s.q, tn: s.tn, b: i });
          paint();
          return;
        }
        loc.at[i] = (loc.at[i] + 1) % 3;
        play('stone', 0.3);
        paint();
      };
    });
    weighBtn.onclick = () => {
      const L = side(1), R = side(2);
      if (!playing() || !L.length || L.length !== R.length || used >= cap) return;
      loc.busy = true;
      o.onMove({ t: 'weigh', q: s.q, tn: s.tn, L, R });
      paint();
    };
    clearBtn.onclick = () => { if (!playing()) return; loc.at.fill(0); paint(); };
    pickBtn.onclick = () => { if (!playing()) return; loc.pick = !loc.pick; paint(); };

    wrap.append(scale.box, btnBox, tray, note, hist);
    paint();
    // 新しい結果は、まっすぐの状態から傾ける（同じ結果を描き直すときは傾けたまま）
    if (s.phase === 'open' && lastW && tiltedKey !== wKey) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        tiltedKey = wKey;
        if (wrap.isConnected) paint();
      }));
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
      const name = (p) => (p === me ? 'あなた' : o.names?.[p] ?? '');
      const what = `偽物 ${x.fake + 1}番${s.fake === 'any' ? (x.light ? '（軽い）' : '（重い）') : ''}`;
      if (x.share) {
        li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${what}</span><span>⚖️${x.w}</span><span class="mk-rv-who">${x.win !== null ? '👑' + esc(name(x.win)) : '―'}</span>`;
      } else {
        const top = Math.max(...x.pts);
        const best = top > 0 ? x.pts.map((v, p) => (v === top ? name(p) : null)).filter((v) => v !== null) : [];
        const a = me === null ? null : x.ans[me];
        const mine = me === null ? '' : !a ? (x.miss?.[me] != null ? '❌' : '―') : a.b !== x.fake ? '❌' : a.re ? '⭕ 答え直し' : `⭕ ⚖️${a.w}`;
        li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${what}</span><span>${mine}</span><span class="mk-rv-who">${best.length ? '👑' + esc(best.join('・')) : '―'}</span>`;
      }
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

const weighText = (h) => `${h.L.map((i) => i + 1).join('・')} と ${h.R.map((i) => i + 1).join('・')} → ${h.r === '=' ? 'つりあった' : h.r === 'L' ? '左が重い' : '右が重い'}`;

function mkBtn(text, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  return b;
}

// 玉の並ぶ台
function drawTray(size) {
  const tray = document.createElement('div');
  tray.className = 'tb-tray' + (size === 27 ? ' many' : '');
  const cols = size === 4 ? 4 : size === 9 ? 5 : 9; // 9個は 5と4 の2段（7と2 に分かれると見づらいため）
  tray.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  tray.style.width = `min(100%, ${cols * 66}px)`;
  const balls = Array.from({ length: size }, (_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-ball';
    b.innerHTML = `<span>${i + 1}</span><small></small>`;
    tray.append(b);
    return b;
  });
  return { tray, balls };
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
