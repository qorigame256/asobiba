// 間違い探し。全員に同じ2枚の絵が出て、違いを早く見つけた人に点（2026-10-05 本人承認）。
// 絵は毎回プログラムが作る（makeScene。対局の種と何枚目かから、全員同じ絵になる）。空と地面の上に、絵文字と色の付いた図形を並べ、
// 右の絵だけ何か所か変える（消す・別の絵文字に替える・大きくする・ずらす・図形の色を変える）。
// 速さは各自の端末で「その絵が出てから押すまで」を測って送り、同じ違いはいちばん短い人の点（通信の遅れで不利にならないように）。
// 違いでない所を押すと、その端末だけ1.5秒押せなくなる（でたらめな連打で見つけられないように。点は減らない）。
// 詳細設定「左右反転」（2026-10-07）: ありのとき、右の絵を鏡に映したように左右反転して描くだけ（絵の作り方・答えは同じ）。
//   右の絵で押した所は toScene で元の絵の位置に直して確かめる。印も反転した絵の中に描くので、正しい所に出る。
// 詳細設定「じわじわ変わる」（2026-10-08 の24回目の案。細かい所は Claude の判断）: ありのとき、右の絵は始めは左と同じで、違いが1つずつ
//   時間をかけて（MORPH_MS）変わっていく（大きさ・位置は少しずつ動き、消える・替わる・色は薄れて入れ替わる）。変わり始める時刻は slowPlan
//   （種と何枚目かから決める。全員同じ）。変わり始めてから MORPH_MS の SEEN_AT 割を過ぎるまでは、その違いを押しても外れ（apply も ms で弾く）。
//   変わり方は各自の端末の時計（その絵が出てから）で描く。答えの画面では全部変わり終えた絵を出す。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play（1枚目）→ 全部見つかるか時間切れ → next → show（答えを3秒見せる）
//   → go → play（2枚目）… 最後の show のあとは end。
// 手: { p: -1, t: 'go' | 'next' } / { p, t: 'find', r: 何枚目か, i: 何番目の違いか, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText } from './party.js';

const READY_MS = 3000;
const SHOW_MS = 3000;
const GRACE_MS = 1500;
const ALL_FOUND_MS = 1200;
const LOCK_MS = 1500;
const MORPH_MS = 10000; // じわじわ変わる: 1つの違いが変わり終えるまで
const SEEN_AT = 0.3; // じわじわ変わる: 変わり始めてからこの割合を過ぎると見つけられる
export const VW = 1000;
export const VH = 750;

const EMOJI = ['🍎', '🍌', '🍇', '🍓', '🍒', '🍉', '🥕', '🌽', '🍄', '🌸', '🌻', '🌷', '🌲', '🌵', '🐶', '🐱', '🐭', '🐰', '🐻', '🐼',
  '🐸', '🐵', '🐔', '🐧', '🐟', '🐢', '🐞', '🦋', '🚗', '🚲', '🚀', '⚽', '🏀', '🎈', '🎁', '⭐', '🌙', '🎸', '🔔', '📚', '🍩', '🍦', '🍰', '🎩', '👟'];
const SHAPE_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff7eb6'];
const SHAPES = ['circle', 'square', 'tri'];
const SKY = ['#bfe6ff', '#ffe3c2', '#d8ccff', '#c9f2e4'];
const GROUND = ['#9ed27a', '#e6cf9a', '#a7d8c9', '#c8b79c'];
const DIFF_TYPES = ['remove', 'swap', 'size', 'move', 'color'];

// 1枚の絵。返り値 { sky, ground, horizon, left: [部品], right: [部品], diffs: [{ type, hit: [[x, y, 半径]…] }] }
// 部品 = { k: 'e', e: 絵文字, x, y, s: 大きさ } | { k: 's', shape, c: 色, x, y, s }
export function makeScene(seed, r, ndiff) {
  const rng = mulberry32((seed ^ (0x9e3779b9 * (r + 1))) >>> 0);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const cols = 6; const rows = 4;
  const cells = shuffle(Array.from({ length: cols * rows }, (_, i) => i), rng).slice(0, 21);
  const emojis = shuffle(EMOJI, rng);
  const left = cells.map((c, i) => {
    const cx = ((c % cols) + 0.5) * (VW / cols) + (rng() - 0.5) * 50;
    const cy = (Math.floor(c / cols) + 0.5) * (VH / rows) + (rng() - 0.5) * 40;
    if (i < 5) return { k: 's', shape: pick(SHAPES), c: pick(SHAPE_COLORS), x: cx, y: cy, s: 60 + rng() * 30 };
    return { k: 'e', e: emojis[i], x: cx, y: cy, s: 70 + rng() * 25 };
  });
  const right = left.map((it) => ({ ...it }));
  const diffs = [];
  const order = shuffle(left.map((_, i) => i), rng);
  const types = shuffle(DIFF_TYPES, rng);
  for (const i of order) {
    if (diffs.length >= ndiff) break;
    const it = left[i];
    // 種類はなるべくばらけさせる。図形にしかできない「色」、絵文字にしかできない「替える」を合わせる
    let type = types[diffs.length % types.length];
    if (type === 'color' && it.k !== 's') type = 'swap';
    if (type === 'swap' && it.k !== 'e') type = 'color';
    const R = it.s * 0.6 + 28;
    const d = { type, item: i, hit: [[it.x, it.y, R]] };
    if (type === 'remove') right[i] = null;
    else if (type === 'swap') right[i] = { ...it, e: emojis[21 + diffs.length] };
    else if (type === 'size') right[i] = { ...it, s: it.s * 1.55 };
    else if (type === 'color') right[i] = { ...it, c: SHAPE_COLORS[(SHAPE_COLORS.indexOf(it.c) + 2 + Math.floor(rng() * 5)) % SHAPE_COLORS.length] };
    else { // ずらす（絵の外へ出ない向きへ）
      const a = rng() * Math.PI * 2;
      const nx = Math.min(VW - 50, Math.max(50, it.x + Math.cos(a) * 85));
      const ny = Math.min(VH - 50, Math.max(50, it.y + Math.sin(a) * 85));
      right[i] = { ...it, x: nx, y: ny };
      d.hit.push([nx, ny, R]);
    }
    diffs.push(d);
  }
  return { sky: pick(SKY), ground: pick(GROUND), horizon: 0.55 + rng() * 0.15, left, right, diffs };
}

// 画面の絵の上で押した位置を、元の絵（makeScene の座標）の位置に直す。反転した右の絵では左右を入れ替える
export function toScene(x, y, flipped) {
  return { x: flipped ? VW - x : x, y };
}

// 押した点（元の絵の座標）がどの違いに当たるか。無ければ -1
export function diffAt(scene, x, y, skip = () => false) {
  for (let i = 0; i < scene.diffs.length; i++) {
    if (skip(i)) continue;
    if (scene.diffs[i].hit.some(([hx, hy, hr]) => Math.hypot(hx - x, hy - y) <= hr)) return i;
  }
  return -1;
}

function partSvg(it) {
  if (!it) return '';
  if (it.k === 'e') return `<text x="${it.x.toFixed(1)}" y="${it.y.toFixed(1)}" font-size="${it.s.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${it.e}</text>`;
  const h = it.s / 2;
  if (it.shape === 'circle') return `<circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="${h.toFixed(1)}" fill="${it.c}" stroke="#0003" stroke-width="3"/>`;
  if (it.shape === 'square') return `<rect x="${(it.x - h).toFixed(1)}" y="${(it.y - h).toFixed(1)}" width="${it.s.toFixed(1)}" height="${it.s.toFixed(1)}" rx="8" fill="${it.c}" stroke="#0003" stroke-width="3"/>`;
  const pts = [[it.x, it.y - h], [it.x - h, it.y + h * 0.8], [it.x + h, it.y + h * 0.8]].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  return `<polygon points="${pts}" fill="${it.c}" stroke="#0003" stroke-width="3"/>`;
}
function pictureSvg(scene, parts) {
  const hy = (scene.horizon * VH).toFixed(1);
  return `<rect width="${VW}" height="${VH}" fill="${scene.sky}"/><rect y="${hy}" width="${VW}" height="${VH}" fill="${scene.ground}"/>`
    + parts.map(partSvg).join('');
}
const flippedSide = (side, mirror) => mirror && side === 'right';
// 片方の絵の中身。反転する絵は、絵と印をまとめて鏡に映す（印も元の絵の座標で描けば、反転した絵の正しい所に出る）
// slow（じわじわ変わる）のときは、右の絵の違いの部品を mg-d の入れ物に入れ、始めは左の絵と同じに描く（morphSvg で変えていく）
export function sideSvg(scene, side, mirror, slow = false) {
  const pic = slow && side === 'right' ? morphPicture(scene) : pictureSvg(scene, scene[side]);
  const inner = pic + '<g class="mg-marks"></g><g class="mg-miss"></g>';
  return flippedSide(side, mirror) ? `<g transform="translate(${VW} 0) scale(-1 1)">${inner}</g>` : inner;
}

// じわじわ変わる: 違い d を、変わり具合 a（0 = 左の絵のまま 〜 1 = 右の絵）で描く
export function morphSvg(scene, d, a) {
  const from = scene.left[d.item];
  const to = scene.right[d.item];
  if (a <= 0) return partSvg(from);
  if (a >= 1) return partSvg(to);
  if (d.type === 'size' || d.type === 'move') {
    const mix = (k) => from[k] + (to[k] - from[k]) * a;
    return partSvg({ ...from, x: mix('x'), y: mix('y'), s: mix('s') });
  }
  // 消える・替わる・色: 前の部品が薄れ、あとの部品が濃くなる
  const fade = (it, op) => (it ? `<g opacity="${op.toFixed(2)}">${partSvg(it)}</g>` : '');
  return fade(from, 1 - a) + fade(to, a);
}
function morphPicture(scene) {
  const hy = (scene.horizon * VH).toFixed(1);
  const di = new Map(scene.diffs.map((d, i) => [d.item, i]));
  return `<rect width="${VW}" height="${VH}" fill="${scene.sky}"/><rect y="${hy}" width="${VW}" height="${VH}" fill="${scene.ground}"/>`
    + scene.left.map((it, k) => (di.has(k) ? `<g class="mg-d" data-d="${di.get(k)}">${partSvg(it)}</g>` : partSvg(it))).join('');
}
// じわじわ変わる: 違いごとの変わり始める時刻（その絵が出てからの ms）。種と何枚目かから決めるので全員同じ。
// 順番はばらばらにし、2秒から「1枚の時間」の55%までの間に等しい間で並べる（最後の違いも、見つけられるようになってから時間が残る）
const planCache = new Map();
export function slowPlan(seed, r, ndiff, limit) {
  const key = `${seed}:${r}:${ndiff}:${limit}`;
  if (!planCache.has(key)) {
    const rng = mulberry32((seed ^ (0x5bd1e995 * (r + 7))) >>> 0);
    const order = shuffle(Array.from({ length: ndiff }, (_, i) => i), rng);
    const at = Array(ndiff);
    order.forEach((i, j) => { at[i] = Math.round(2000 + (limit * 0.55 * j) / ndiff); });
    planCache.set(key, at);
    if (planCache.size > 20) planCache.delete(planCache.keys().next().value);
  }
  return planCache.get(key);
}
// じわじわ変わる: 違い i を見つけられるようになる時刻（ms）・ms のときの変わり具合
export const seenAt = (plan, i) => plan[i] + MORPH_MS * SEEN_AT;
export const morphAt = (plan, i, ms) => Math.min(1, Math.max(0, (ms - plan[i]) / MORPH_MS));

const ndiffOf = (s) => Number(s.rules.diffs);
const roundsOf = (s) => Number(s.rules.rounds);
const limitOf = (s) => Number(s.rules.time) * 1000;
const mirrorOf = (s) => s.rules.mirror === 'on';
const slowOf = (s) => s.rules.slow === 'on';
const planOf = (s) => slowPlan(s.seed, s.r, ndiffOf(s), limitOf(s));
const playKey = (s) => `machigai:${s.seed}:${s.r}`;
const clone = (s) => ({ ...s, best: { ...s.best }, got: s.got.map((g) => g.slice()) });
const foundIn = (s, r) => Object.keys(s.best).filter((k) => k.startsWith(r + ':')).length;

export function scoresOf(s) {
  const sc = Array(s.n).fill(0);
  for (const b of Object.values(s.best)) sc[b.p] += 1;
  return sc;
}

const sceneCache = new Map();
function sceneOf(s, r = s.r) {
  const key = `${s.seed}:${r}:${ndiffOf(s)}`;
  if (!sceneCache.has(key)) {
    sceneCache.set(key, makeScene(s.seed, r, ndiffOf(s)));
    if (sceneCache.size > 20) sceneCache.delete(sceneCache.keys().next().value);
  }
  return sceneCache.get(key);
}

/* ---------- 画面 ---------- */

let ui = null;
const cpuPlan = new Map();
const COLORS = ['#e04b3c', '#2f6fb3', '#3a9d55', '#e8a913', '#8e44ad', '#16a3a3', '#d35400', '#c2185b', '#6d7f00', '#5d6d7e'];

function marks(s, scene, me) {
  let html = '';
  scene.diffs.forEach((d, i) => {
    const b = s.best[`${s.r}:${i}`];
    const show = b || s.phase === 'show';
    if (!show) return;
    const col = b ? COLORS[b.p % COLORS.length] : '#ff3b30';
    for (const [x, y, rad] of d.hit) {
      html += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${b ? 9 : 7}"${b ? '' : ' stroke-dasharray="18 12"'}/>`;
      if (b && b.p === me) html += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rad - 10).toFixed(1)}" fill="none" stroke="#fff" stroke-width="3"/>`;
    }
  });
  return html;
}

function clock() {
  if (!ui?.clock.isConnected) return;
  const { s } = ui.cur;
  let text = '';
  if (s.phase === 'play') {
    const left = Math.max(0, Math.ceil((limitOf(s) - since(playKey(s))) / 1000));
    text = `${s.r + 1}/${roundsOf(s)}枚目・残り ${left}秒・見つかった違い ${foundIn(s, s.r)}/${ndiffOf(s)}`;
  } else if (s.phase === 'show') text = `${s.r + 1}/${roundsOf(s)}枚目の答え（点線の丸が見つからなかった違い）`;
  else if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`machigai:${s.seed}:ready`)) / 1000);
    text = left > 0 ? `${left}…` : 'スタート！';
  } else text = 'おしまい！';
  if (ui.clockText !== text) { ui.clock.textContent = text; ui.clockText = text; }
  if (ui.morph) drawMorph(s);
  requestAnimationFrame(clock);
}

// じわじわ変わる: 右の絵の違いの部品を、いまの変わり具合で描き直す（変わったものだけ。答え・おしまいでは変わり終えた絵）
function drawMorph(s) {
  const scene = sceneOf(s);
  const plan = planOf(s);
  const ms = s.phase === 'play' ? since(playKey(s)) : Infinity;
  for (const g of ui.morph) {
    const i = Number(g.dataset.d);
    const a = Math.round(morphAt(plan, i, ms) * 50) / 50;
    if (g._a === a) continue;
    g._a = a;
    g.innerHTML = morphSvg(scene, scene.diffs[i], a);
  }
}

export default {
  id: 'machigai',
  name: '間違い探し',
  icon: '🔍',
  desc: '2枚の絵の違いを、みんなで早い者勝ちで見つける。絵は毎回ちがう',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '絵の枚数', desc: '1回の勝負で探す絵の数', def: '3', choices: [['3', '3枚'], ['5', '5枚']] },
    { key: 'diffs', label: '違いの数', desc: '1枚の絵の中の違いの数', def: '5', choices: [['3', '3か所'], ['5', '5か所'], ['7', '7か所']] },
    { key: 'time', label: '1枚の時間', desc: 'この時間が来たら答えを見せて次の絵へ', def: '60', choices: [['45', '45秒'], ['60', '60秒'], ['90', '90秒']] },
    { key: 'mirror', label: '左右反転', desc: '右の絵が、鏡に映したように左右反転して出る（むずかしい）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'slow', label: 'じわじわ変わる', desc: '右の絵は始めは左と同じで、違いが1つずつ時間をかけて少しずつ表れる。変わっていく所に先に気づいた人の点', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: '3', diffs: '5', time: '60', mirror: 'off', ...rules };
    if (r.slow !== 'on') delete r.slow; // なしのときは局面の形を今までと同じにする
    return { n, seed, rules: r, phase: 'ready', r: 0, best: {}, got: Array.from({ length: n }, () => []), step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'play'; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'go' ? 'question' : null;
    return m.p === me ? 'correct' : 'pop';
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const scores = scoresOf(s);
    return { winners: leaders(scores), scores };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'show') return '答え合わせ';
    if (slowOf(s)) return '右の絵がじわじわ変わっていく。変わった所を押そう！' + (mirrorOf(s) ? '（右の絵は左右反転）' : '');
    return mirrorOf(s) ? '右と左の絵の違いを押そう！（右の絵は左右反転）' : '右と左の絵の違いを押そう！';
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'show') return { key: `show${s.r}`, ms: SHOW_MS, move: { t: 'go' } };
    if (s.phase === 'play') {
      if (foundIn(s, s.r) >= ndiffOf(s)) return { key: `all${s.r}`, ms: ALL_FOUND_MS, move: { t: 'next' } };
      return { key: `play${s.r}`, ms: limitOf(s) + GRACE_MS, move: { t: 'next' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      const s = clone(s0);
      s.step += 1;
      if (m.t === 'go' && s0.phase === 'ready') { s.phase = 'play'; return s; }
      if (m.t === 'go' && s0.phase === 'show') {
        if (s0.r + 1 >= roundsOf(s0)) s.phase = 'end';
        else { s.r += 1; s.phase = 'play'; }
        return s;
      }
      if (m.t === 'next' && s0.phase === 'play') { s.phase = 'show'; return s; }
      return null;
    }
    if (s0.phase !== 'play' || m.t !== 'find' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (m.r !== s0.r || !Number.isInteger(m.i) || m.i < 0 || m.i >= ndiffOf(s0)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + GRACE_MS) return null;
    if (slowOf(s0) && m.ms < seenAt(planOf(s0), m.i)) return null; // じわじわ変わる: まだ見えていない違い
    const k = `${m.r}:${m.i}`;
    if (s0.got[m.p].includes(k)) return null;
    const s = clone(s0);
    s.step += 1;
    s.got[m.p].push(k);
    const b = s.best[k];
    if (!b || m.ms < b.ms) s.best[k] = { p: m.p, ms: Math.round(m.ms) };
    return s;
  },

  // CPU: 違いごとに、見つけるかどうか（6割）と、見つける時刻（8〜40秒。左右反転では2割遅く 9.6〜48秒）を1回だけ決める。
  // じわじわ変わるでは、見つけられるようになってから 2〜14秒（左右反転では2割遅く）
  cpuDelay(s) { return s.phase === 'play' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play') return null;
    const t = since(playKey(s));
    for (let i = 0; i < ndiffOf(s); i++) {
      const k = `${s.r}:${i}`;
      if (s.best[k] || s.got[p].includes(k)) continue;
      const key = `${s.seed}:${k}:${p}`;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const slow = slowOf(s);
        const wait = (slow ? 2000 + Math.random() * 12000 : 8000 + Math.random() * 32000) * (mirrorOf(s) ? 1.2 : 1);
        plan = { find: Math.random() < 0.6, at: (slow ? seenAt(planOf(s), i) : 0) + wait };
        cpuPlan.set(key, plan);
        if (cpuPlan.size > 3000) cpuPlan.delete(cpuPlan.keys().next().value);
      }
      if (plan.find && t >= plan.at && t < limitOf(s)) return { t: 'find', r: s.r, i, ms: Math.round(t) };
    }
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const scores = scoresOf(s);
    const chips = scoreChips(o, scores, { won: s.phase === 'end' ? leaders(scores) : [] });
    const key = `${s.seed}:${s.r}:${me}:${s.phase === 'ready' ? 'ready' : 'pic'}`;
    if (!(ui?.key === key && root.contains(ui.pics))) {
      root.innerHTML = '';
      root.className = 'board mg';
      const clockEl = document.createElement('div');
      clockEl.className = 'mg-clock';
      const pics = document.createElement('div');
      pics.className = 'mg-pics';
      ui = { key, pics, chips, clock: clockEl, clockText: null, cur: { s, o }, svgs: [], lockUntil: 0, morph: null };
      root.append(chips, clockEl, pics);
      since(`machigai:${s.seed}:ready`);
      if (s.phase !== 'ready') {
        const scene = sceneOf(s);
        const mirror = mirrorOf(s);
        const slow = slowOf(s);
        for (const side of ['left', 'right']) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
          svg.setAttribute('class', 'mg-pic');
          svg.innerHTML = sideSvg(scene, side, mirror, slow);
          svg.addEventListener('pointerdown', (e) => {
            const { s: cur, o: co } = ui.cur;
            if (me === null || cur.phase !== 'play' || !co.canMove || cur.r !== s.r) return;
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const { x, y } = toScene(((e.clientX - rect.left) / rect.width) * VW, ((e.clientY - rect.top) / rect.height) * VH, flippedSide(side, mirror));
            const now = performance.now();
            if (now < ui.lockUntil) return;
            const ms = since(playKey(cur));
            if (ms > limitOf(cur)) return;
            const i = diffAt(scene, x, y, (j) => !!cur.best[`${cur.r}:${j}`] || cur.got[me].includes(`${cur.r}:${j}`)
              || (slow && ms < seenAt(planOf(cur), j))); // じわじわ変わる: まだ見えていない違いは外れ
            if (i < 0) {
              ui.lockUntil = now + LOCK_MS;
              for (const sv of ui.svgs) {
                const g = sv.querySelector('.mg-miss');
                g.innerHTML = `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" font-size="90" fill="#e74c3c" text-anchor="middle" dominant-baseline="central" font-weight="bold">✕</text>`;
                setTimeout(() => { g.innerHTML = ''; }, LOCK_MS);
              }
              return;
            }
            co.onMove({ t: 'find', r: cur.r, i, ms: Math.round(ms) });
          });
          pics.append(svg);
          ui.svgs.push(svg);
        }
        if (s.phase === 'play') since(playKey(s));
        if (slow) ui.morph = [...ui.svgs[1].querySelectorAll('.mg-d')];
      } else {
        const wait = document.createElement('div');
        wait.className = 'mg-wait';
        wait.textContent = '左と右の絵の違いを探します。違いは右の絵にも左の絵にも押せます。'
          + (mirrorOf(s) ? '右の絵は、鏡に映したように左右反転しています。' : '')
          + (slowOf(s) ? '右の絵は始めは左と同じで、少しずつ変わっていきます。' : '');
        pics.append(wait);
      }
      if (s.phase !== 'end') window.scrollTo(0, 0);
      clock();
    } else {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
    }
    ui.cur = { s, o };
    if (s.phase === 'play') since(playKey(s));
    if (ui.svgs.length) {
      const html = marks(s, sceneOf(s), me);
      for (const svg of ui.svgs) svg.querySelector('.mg-marks').innerHTML = html;
      if (ui.morph) drawMorph(s);
    }
  },
};
