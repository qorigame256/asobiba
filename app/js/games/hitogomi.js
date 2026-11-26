// 人ごみさがし。大勢の人の絵から、「赤い帽子・めがね」のように言われた特徴の1人を早く見つけて押す。2〜10人・足りない分は CPU（弱め）。
// 2026-11-24 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 人の絵は Claude が描き、帽子の色・めがね・服の色・髪の長さを組み合わせる（絵文字の人物では組み合わせが足りないため）。
//   - お題は言葉で出す（見本の絵を見せる形は色ちがい早押しに近いので取らない）。前半の問題は特徴2つ、後半は3つ。
//   - 画面の人数は詳細設定「むずかしさ」で やさしい（20人）・ふつう（35人。最初）・むずかしい（50人）。
//   - 正解した速い順に 3・2・1点。まちがえたらその問題はもう押せないが、点は減らない。5問（詳細設定で 3・10問）。
// Claude の判断:
//   - 特徴は 帽子（なし・赤・青・黄）・めがね（なし・あり）・服（赤・青・緑・黄・紫）・髪（短い・長い）。お題には「帽子なし」「めがねなし」のような打ち消しは使わない
//     （お題の人が帽子もめがねも無いときは、服と髪で出す）。
//   - お題に合う人はいつもちょうど1人。ほかの人は、6割を「お題の特徴のうち1つだけがちがう、おしい人」として作り、残りをくじで作る
//     （くじで作った人にもおしい人がまじるので、おしい人は6割より少し多くなる。色や形をちゃんと見ないと当たらないように）。
//   - 人は格子に置いて少しずつずらす（やさしい 5×4・ふつう 7×5・むずかしい 10×5）。並びは種から決める（全員同じ）。
//   - 前半は問題の数の半分（切り上げ）まで。5問なら 1〜3問目が特徴2つ、4〜5問目が3つ。
//   - 1問の制限時間は やさしい20秒・ふつう25秒・むずかしい35秒。だれかが正解したら5秒で締め切る。全員が答えたら1.5秒。答えを見せる間は3.5秒。
//   - CPU は 3秒〜制限時間の7割で押し、6割当てる（まちがえるときは、おしい人を押す）。
// 2026-11-24 の46回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「人が歩く」（鍵 walk。なし（最初）・あり）: 人が自分の段のまま左右に歩き、絵のふちで向きを変える（同じ段の人と重なったり離れたりする）。
//     歩く向きと速さ（1秒にます目の 0.35〜0.8 個ぶん）は問題とは別の乱数で決め、位置は「画面に出てからの時間」だけで決まる（ひよこかぞえと同じ）。
//     問題（人の特徴・お題）は歩かないときと同じ。答えを見せるときは、その場面で最初に描いた時刻で止める。
//   - 詳細設定「〜していない」お題（鍵 neg。なし（最初）・あり）: お題に「帽子をかぶっていない」「めがねをかけていない」を必ず1つ入れる
//     （お題の人に帽子もめがねもあるときは、どちらかを外す）。おしい人の作り方は同じなので、「ない」を読み落とすと、帽子やめがねのあるおしい人を押してしまう。
//     なしのときの問題は前と全く同じ（あり のときだけ乱数の使い方が変わる）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（抜けた数さがしと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 押した人の番号, ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, afterOver, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[3, '3問'], [5, '5問'], [10, '10問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 5);
const LEVELS = [['easy', 'やさしい（20人）'], ['normal', 'ふつう（35人）'], ['hard', 'むずかしい（50人）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
export const GRID = { easy: [5, 4], normal: [7, 5], hard: [10, 5] }; // [横, たて]
export const LIMITS = { easy: 20000, normal: 25000, hard: 35000 };
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;
export const W = 100;
const CELL_H = 1.3; // 1人ぶんの高さ（幅に対して）

// 特徴（値の 0 番目は「なし」のことがある）
export const HATS = [null, ['赤い帽子', '#e23b3b'], ['青い帽子', '#2f6fd6'], ['黄色い帽子', '#f2c21b']];
export const SHIRTS = [['赤い服', '#e23b3b'], ['青い服', '#2f6fd6'], ['緑の服', '#2e9a52'], ['黄色い服', '#f2c21b'], ['紫の服', '#8a4fc0']];
export const HAIRS = ['短い髪', '長い髪'];
const KEYS = ['hat', 'glasses', 'shirt', 'hair'];
const SIZES = { hat: HATS.length, glasses: 2, shirt: SHIRTS.length, hair: 2 };

// お題に使える特徴（打ち消しは使わない）
const OFFON = [['off', 'なし'], ['on', 'あり']];
export const negOn = (r) => r.neg === 'on';
const walkOn = (r) => r.walk === 'on';
const sayable = (m) => KEYS.filter((k) => (k === 'hat' ? m.hat > 0 : k === 'glasses' ? m.glasses === 1 : true));
export const matches = (m, clue) => Object.keys(clue).every((k) => m[k] === clue[k]);
export function clueText(clue) {
  const out = [];
  if ('hat' in clue) out.push(clue.hat ? HATS[clue.hat][0] : '帽子をかぶっていない');
  if ('glasses' in clue) out.push(clue.glasses ? 'めがね' : 'めがねをかけていない');
  if ('shirt' in clue) out.push(SHIRTS[clue.shirt][0]);
  if ('hair' in clue) out.push(HAIRS[clue.hair]);
  return out;
}
export const featureCount = (q, k) => (q < Math.ceil(k / 2) ? 2 : 3);

// 1問を作る。people = [{ hat, glasses, shirt, hair, x, y }]（x・y は人の左上。幅は cw）、target = お題の人の番号、clue = { 特徴: 値 }
export function makeQuestion(seed, q, level, k, neg = false) {
  const rnd = mulberry32((seed * 131 + q * 61 + 7) >>> 0);
  const pick = (n) => Math.floor(rnd() * n);
  const [cols, rows] = GRID[level] ?? GRID.normal;
  const count = cols * rows;
  const want = featureCount(q, k);
  const random = () => ({ hat: pick(SIZES.hat), glasses: pick(2), shirt: pick(SIZES.shirt), hair: pick(2) });
  const t = random();
  const clue = {};
  if (neg) {
    // 「〜していない」を1つ必ず入れる。帽子もめがねもあれば、どちらかを外す。ほかの特徴は「ない」もふくめて4つからくじ
    if (t.hat > 0 && t.glasses === 1) { if (pick(2)) t.hat = 0; else t.glasses = 0; }
    const nots = ['hat', 'glasses'].filter((key) => t[key] === 0);
    const nk = nots[pick(nots.length)];
    clue[nk] = 0;
    const can = KEYS.filter((key) => key !== nk);
    for (let i = can.length - 1; i > 0; i--) { const j = pick(i + 1); [can[i], can[j]] = [can[j], can[i]]; }
    for (const key of can.slice(0, want - 1)) clue[key] = t[key];
  } else {
    // 言える特徴が足りなければ、帽子かめがねを足す
    while (sayable(t).length < want) { if (t.hat === 0) t.hat = 1 + pick(SIZES.hat - 1); else t.glasses = 1; }
    const can = sayable(t);
    for (let i = can.length - 1; i > 0; i--) { const j = pick(i + 1); [can[i], can[j]] = [can[j], can[i]]; }
    for (const key of can.slice(0, want)) clue[key] = t[key];
  }
  const people = [t];
  while (people.length < count) {
    let m;
    if (rnd() < 0.6) {
      // おしい人: お題の特徴のうち1つだけを別の値にする（ほかの特徴はくじ）
      m = random();
      for (const key of Object.keys(clue)) m[key] = clue[key];
      const keys = Object.keys(clue);
      const key = keys[pick(keys.length)];
      m[key] = (clue[key] + 1 + pick(SIZES[key] - 1)) % SIZES[key];
    } else m = random();
    if (!matches(m, clue)) people.push(m);
  }
  // 置き場所をまぜる（お題の人もどこかへ）
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) { const j = pick(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const cw = W / cols;
  const placed = people.map((m, i) => {
    const cell = order[i];
    const x = (cell % cols) * cw + (rnd() - 0.5) * cw * 0.1;
    const y = Math.floor(cell / cols) * cw * CELL_H + (rnd() - 0.5) * cw * 0.06;
    return { ...m, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  });
  return { people: placed, target: 0, clue, cw, h: rows * cw * CELL_H };
}

// 1人の絵（10×14 の箱に描く）
function personSvg(m) {
  const hair = '#4a3222';
  const shirt = SHIRTS[m.shirt][1];
  // 長い髪は、頭の後ろ（顔より幅広く）と、肩にかかる左右の房で描く。あごの下に髪が見えるとひげに見えるので、首と服で隠す
  let g = m.hair === 1 ? `<path d="M2,4.6 Q1.7,9.9 2.6,10.3 L7.4,10.3 Q8.3,9.9 8,4.6 Z" fill="${hair}"/>` : '';
  g += '<rect x="4.3" y="6.8" width="1.4" height="2" fill="#f4cfa6"/>';
  g += `<path d="M1.6,14 L2,9.8 Q2.4,8.3 5,8.3 Q7.6,8.3 8,9.8 L8.4,14 Z" fill="${shirt}" stroke="rgba(0,0,0,.35)" stroke-width=".25"/>`;
  if (m.hair === 1) g += `<path d="M2.15,5 Q1.95,9.6 2.75,10.7 L3.55,10.5 Q3,8.6 3.15,6 Z M7.85,5 Q8.05,9.6 7.25,10.7 L6.45,10.5 Q7,8.6 6.85,6 Z" fill="${hair}"/>`;
  g += '<circle cx="5" cy="5" r="2.5" fill="#f4cfa6" stroke="rgba(0,0,0,.25)" stroke-width=".2"/>';
  g += `<path d="M2.5,5 Q2.4,2.2 5,2.2 Q7.6,2.2 7.5,5 Q6.6,3.7 5,3.8 Q3.4,3.7 2.5,5 Z" fill="${hair}"/>`;
  g += '<circle cx="4.1" cy="5.4" r=".33" fill="#333"/><circle cx="5.9" cy="5.4" r=".33" fill="#333"/>';
  g += '<path d="M4.4,6.6 Q5,7.1 5.6,6.6" stroke="#a55" stroke-width=".28" fill="none" stroke-linecap="round"/>';
  if (m.glasses) g += '<g fill="rgba(255,255,255,.35)" stroke="#111" stroke-width=".38"><circle cx="4.05" cy="5.4" r=".9"/><circle cx="5.95" cy="5.4" r=".9"/><path d="M4.95,5.3 L5.05,5.3"/></g>';
  if (m.hat) {
    const c = HATS[m.hat][1];
    g += `<path d="M2.6,3.6 Q2.6,0.8 5,0.8 Q7.4,0.8 7.4,3.6 Z" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width=".22"/>`;
    g += `<rect x="1.8" y="3.1" width="6.4" height="0.95" rx=".45" fill="${c}" stroke="rgba(0,0,0,.4)" stroke-width=".22"/>`;
  }
  return g;
}

// lo〜hi の間を行き来する（ふちで向きを変える）位置（ひよこかぞえの bounce と同じ形）
function bounce(p, lo, hi) {
  const span = hi - lo;
  let m = (p - lo) % (2 * span);
  if (m < 0) m += 2 * span;
  return m <= span ? lo + m : lo + 2 * span - m;
}
// 歩く向きと速さ・上下にゆれる間（問題とは別の乱数。全員の画面で同じ）
function walkers(seed, q, x) {
  const rnd = mulberry32((seed * 197 + q * 23 + 5) >>> 0);
  return x.people.map(() => ({ v: x.cw * (0.35 + rnd() * 0.45) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * Math.PI * 2 }));
}
export function walkPos(x, m, w, sec) {
  return { x: bounce(m.x + w.v * sec, 0, W - x.cw), y: m.y - Math.abs(Math.sin(sec * 6 + w.ph)) * x.cw * 0.03 };
}

// walk = { ws: 歩き方, key: 問題の鍵, freeze: 止める時刻（ms）か null }。null なら歩かない
function crowdSvg(x, onPick, walk = null) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${x.h}`);
  svg.setAttribute('class', 'hg-fig');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${x.people.length}人の人ごみ`);
  const sc = (x.cw / 10) * 0.9;
  // 押した所に何人かの押す範囲（透明な四角）が重なっていたら、体のまん中がいちばん近い人を選ぶ（人が歩くと重なり、奥の人の見えている所を押しても
  // 手前の人になっていた。2026-11-24 の2回目の Codex の点検のあと本人が推奨を承認）
  const pickAt = (e, i) => {
    let best = i, bd = Infinity;
    for (const el of document.elementsFromPoint?.(e.clientX, e.clientY) ?? []) {
      const g = el.closest?.('.hg-p');
      if (!g || !svg.contains(g)) continue;
      const r = g.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = Number(g.dataset.i); }
    }
    return best;
  };
  const gs = x.people.map((m, i) => {
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'hg-p');
    g.dataset.i = i;
    g.setAttribute('transform', `translate(${m.x + x.cw * 0.05} ${m.y}) scale(${sc})`);
    g.innerHTML = `<rect class="hg-hit" x="0.6" y="0.2" width="8.8" height="13.8" rx="1.5"/>${personSvg(m)}`;
    if (onPick) g.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); onPick(pickAt(e, i)); });
    svg.append(g);
    return g;
  });
  if (!walk) return svg;
  const place = (sec) => {
    x.people.forEach((m, i) => {
      const p = walkPos(x, m, walk.ws[i], sec);
      gs[i].setAttribute('transform', `translate(${(p.x + x.cw * 0.05).toFixed(2)} ${p.y.toFixed(2)}) scale(${sc})`);
    });
  };
  if (walk.freeze !== null) { place(walk.freeze / 1000); return svg; }
  const tick = () => {
    if (!svg.isConnected && svg.dataset.on) return;
    svg.dataset.on = '1';
    place(since(walk.key) / 1000);
    requestAnimationFrame(tick);
  };
  tick();
  return svg;
}

const qKey = (s, q = s.q) => `hitogomi:${s.seed}:${levelOf(s.rules)}:${s.qs.length}:${q}${negOn(s.rules) ? ':neg' : ''}`; // むずかしさと問題の数・「〜していない」お題も入れる（どれでも問題が変わるため。数のきまり当てと同じ理由）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const limitOf = (s) => LIMITS[levelOf(s.rules)];
const cpuPlan = new Map();
const frozen = new Map(); // 問題の鍵 → 答えを見せるときに止めた時刻（ms。人が歩くとき。ひよこかぞえと同じ）

export default {
  id: 'hitogomi',
  name: '人ごみさがし',
  icon: '👥',
  desc: '大勢の人の中から、言われた特徴の1人を早く見つけて押す',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '画面に出る人の数', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 5, choices: ROUNDS },
    { key: 'walk', label: '人が歩く', desc: '人がゆっくり左右に歩き回り、重なったり離れたりする', def: 'off', choices: OFFON },
    { key: 'neg', label: '「〜していない」お題', desc: '「めがねをかけていない」「帽子をかぶっていない」のような、ないことを言うお題が必ず入る', def: 'off', choices: OFFON },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, level: 'normal', ...rules };
    const k = roundsOf(r);
    const qs = Array.from({ length: k }, (_, q) => makeQuestion(seed, q, levelOf(r), k, negOn(r)));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), said: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が答えた音は鳴らさない（色ちがい早押しと同じ）
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      const limit = limitOf(s);
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limit, AFTER_MS, GRACE_MS), move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limit + GRACE_MS, move: { t: 'close' } };
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
        s.miss = Array(s.n).fill(false);
        s.said = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), said: s.said.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    const x = s0.qs[s0.q];
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= x.people.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === x.target) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (afterOver(qKey(s), AFTER_MS)) return null; // だれかが解いたあとの短い帯が0になったら答えない（締め切りの猶予の間に答えていた。2026-11-26 の Codex の点検）
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const limit = limitOf(s);
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      // まちがえるときは、お題の特徴のうち1つだけちがう「おしい人」を押す（いなければだれか）
      const near = x.people.map((m, i) => i).filter((i) => i !== x.target && Object.keys(x.clue).filter((k) => x.people[i][k] !== x.clue[k]).length === 1);
      const others = near.length ? near : x.people.map((m, i) => i).filter((i) => i !== x.target);
      plan = { at: 3000 + Math.random() * (limit * 0.7 - 3000), c: Math.random() < 0.6 ? x.target : others[Math.floor(Math.random() * others.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limit ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? '<span class="pt-ng">×</span>' : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj hg';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true, log: s.log }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      const [c, r] = GRID[levelOf(s.rules)];
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${c * r}人の中から、言われた1人を早く押そう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    const shown = s.phase !== 'open';
    const mine = me !== null ? s.said[me] : null;
    const head = document.createElement('div');
    head.className = 'hg-clue';
    head.append(Object.assign(document.createElement('span'), { className: 'hg-q', textContent: '🎯' }));
    for (const w of clueText(x.clue)) head.append(Object.assign(document.createElement('span'), { className: 'hg-tag', textContent: w }));
    head.append(Object.assign(document.createElement('span'), { className: 'hg-q', textContent: 'の人は？' }));
    card.append(head);
    let walk = null;
    if (walkOn(s.rules)) {
      let freeze = null;
      if (shown) {
        if (!frozen.has(key)) frozen.set(key, Math.min(since(key), limit));
        if (frozen.size > 50) frozen.delete(frozen.keys().next().value);
        freeze = frozen.get(key);
      }
      walk = { ws: walkers(s.seed, s.q, x), key, freeze };
    }
    let sent = false;
    const canNow = () => !shown && me !== null && o.canMove && !doneOf(s, me) && !sent && since(key) < limit;
    const fig = crowdSvg(x, shown ? null : (i) => {
      if (!canNow()) return;
      const ms = Math.round(since(key));
      if (ms >= limit || afterOver(key, AFTER_MS)) return;
      sent = true;
      fig.querySelector(`.hg-p[data-i="${i}"]`)?.classList.add('picked');
      fig.classList.add('locked');
      o.onMove({ t: 'ans', q: s.q, c: i, ms });
    }, walk);
    // 自分が押した人・答え合わせ
    if (mine !== null) fig.querySelector(`.hg-p[data-i="${mine}"]`)?.classList.add(mine === x.target ? 'ok' : 'ng');
    if (shown) fig.querySelector(`.hg-p[data-i="${x.target}"]`)?.classList.add('ans');
    if (!canNow()) fig.classList.add('locked');
    card.append(fig);
    if (!shown) {
      since(key);
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`); // 行の場所はいつも空けておく（数のきまり当てと同じ）
      card.append(anySolved ? afterBar(key, limit, AFTER_MS) : timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも見つけられませんでした';
      card.append(t);
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (shown) note.textContent = mine !== null ? (s.solved[me] !== null ? 'あなたの答え ⭕' : 'あなたの答え ❌（緑の枠が正解）') : '緑の枠が正解';
    else if (s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else note.textContent = 'お題に合う人を押そう（答えられるのは1回だけ）';
    wrap.append(note);
    if (shown) wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (canNow()) {
      setTimeout(() => {
        if (!fig.isConnected || sent) return;
        fig.classList.add('locked');
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const g = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.said[me] !== null ? '❌' : '―';
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(clueText(g.clue).join('・')), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
