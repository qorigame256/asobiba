// 的の早押し（オリジナル）。決めた時間のあいだ、的がいくつも次々に出ては消える。いちばん速く押した人がその的の点をもらう。
// 的の種類: 大きい的 1点・中くらい 2点・小さい的 3点・金の的 5点（小さくてすぐ消える）・ドクロ（押すと −2点）。
// 的が1つも出ていないときに押すと −1点（あてずっぽうの連打を防ぐ）。
// 的の出る時刻・場所・種類は seed から全員同じに作る。速さは各自の端末で「その的が出てから押すまで」を測る。
// 同じ的を何人も押したら、測った時間がいちばん短い人のもの（通信で遅れて届いても、速ければ取り返せる）。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end
// 詳細設定「動く的」（2026-10-06 本人の決定。最初はなし）: 的が出ている間ゆっくり動き、場のふちで跳ね返る。
//   動く向きと速さも seed から全員同じに作る（的の出方の乱数とは別の乱数にして、なしのときの的の出方は変えない）。
//   見た目だけで、手（どの的を何秒で押したか）は変わらない（Claude の判断）。速さは 1秒に場の幅の 0.12〜0.24。CPU の反応は0.15秒遅くする。
// 詳細設定「小さい的は高い点」（2026-10-07 の11回目。最初はなし）: 赤（1点）と青（2点）の的が3つの大きさで出て、
//   大きい（今と同じ大きさ）は今と同じ点・中くらいは2倍・小さいは3倍（赤 1・2・3点、青 2・4・6点）。的には点を書く。
//   紫・金はもとから小さいので変えない（これより小さいとスマホで押しにくい）。ドクロも変えない（Claude の判断）。
//   大きさも seed から全員同じに作る（的の出方とは別の乱数にして、なしのときの的の出方と点は変えない）。
//   いちばん小さいのは場の幅の 0.11（スマホで直径約38ピクセル）。CPU は小さいほど少し遅く、押しそこねやすい。
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'hit', id: 的の番号, ms } / { p, t: 'miss', n: 何回目か }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText } from './party.js';

const READY_MS = 3000;
const GRACE_MS = 2500;
export const KINDS = {
  big: { pt: 1, size: 0.2, life: 2000, w: 40 },
  mid: { pt: 2, size: 0.15, life: 1700, w: 25 },
  small: { pt: 3, size: 0.1, life: 1400, w: 14 },
  gold: { pt: 5, size: 0.085, life: 1000, w: 4 },
  bomb: { pt: -2, size: 0.16, life: 2000, w: 17 },
};
const MISS_PT = -1;
// 小さい的は高い点（詳細設定）: 大きさの段（sz 1〜3）ごとの場の幅に対する大きさ。点は 的の点 × sz
const SIZES = { big: [0.2, 0.15, 0.11], mid: [0.15, 0.13, 0.11] };
export const sizeOf = (tg) => (tg.sz ? SIZES[tg.kind][tg.sz - 1] : KINDS[tg.kind].size);
export const ptOf = (tg) => KINDS[tg.kind].pt * (tg.sz || 1);

function pickKind(rng, bombs) {
  const list = Object.entries(KINDS).filter(([k]) => bombs || k !== 'bomb');
  let x = rng() * list.reduce((a, [, v]) => a + v.w, 0);
  for (const [k, v] of list) { x -= v.w; if (x < 0) return k; }
  return list[0][0];
}

function makeTargets(rng, durMs, bombs) {
  const list = [];
  let t = 600;
  while (t < durMs - 2100) { // いちばん長く出る的（2秒）も時間内に消える
    const count = rng() < 0.25 ? (rng() < 0.4 ? 3 : 2) : 1; // ときどき同時にいくつも
    const placed = [];
    for (let c = 0; c < count; c++) {
      const kind = pickKind(rng, bombs);
      let x; let y;
      for (let tries = 0; tries < 6; tries++) { // 同時に出る的どうしが重ならないように
        x = 0.1 + rng() * 0.8;
        y = 0.1 + rng() * 0.8;
        if (placed.every((q) => Math.hypot(q.x - x, q.y - y) > 0.25)) break;
      }
      placed.push({ x, y });
      list.push({ id: list.length, at: Math.round(t), kind, x: +x.toFixed(3), y: +y.toFixed(3), life: KINDS[kind].life });
    }
    t += 550 + rng() * 700;
  }
  return list;
}

// 動く的（詳細設定）: 向きと速さを足す（的の出方とは別の乱数）
function addMotion(list, seed) {
  const rng = mulberry32(seed ^ 0x6d07e);
  for (const tg of list) {
    const a = rng() * Math.PI * 2;
    const v = 0.12 + rng() * 0.12;
    tg.vx = +(Math.cos(a) * v).toFixed(3);
    tg.vy = +(Math.sin(a) * v).toFixed(3);
  }
  return list;
}

// 小さい的は高い点（詳細設定）: 赤と青の的に大きさの段を足す（的の出方とは別の乱数）。大 4割・中 3割・小 3割
function addSizes(list, seed) {
  const rng = mulberry32(seed ^ 0x51a35);
  for (const tg of list) {
    const x = rng();
    if (SIZES[tg.kind]) tg.sz = x < 0.4 ? 1 : x < 0.7 ? 2 : 3;
  }
  return list;
}

// 出てから ms たった的の真ん中の位置。動く的は場のふち（0.05〜0.95）で跳ね返る
export function posOf(tg, ms) {
  if (!tg.vx && !tg.vy) return { x: tg.x, y: tg.y };
  const lo = 0.05;
  const span = 0.9;
  const bounce = (p, v) => {
    let q = (((p - lo + v * ms / 1000) % (2 * span)) + 2 * span) % (2 * span); // 0〜2*span を行って戻る
    if (q > span) q = 2 * span - q;
    return lo + q;
  };
  return { x: bounce(tg.x, tg.vx), y: bounce(tg.y, tg.vy) };
}

export function scoresOf(s) {
  const sc = Array(s.n).fill(0);
  for (const [id, b] of Object.entries(s.best)) sc[b.p] += ptOf(s.targets[id]);
  s.hits.forEach((ids, p) => { for (const id of ids) if (s.targets[id].kind === 'bomb') sc[p] += KINDS.bomb.pt; });
  s.misses.forEach((k, p) => { sc[p] += k * MISS_PT; });
  return sc;
}

const durOf = (s) => Number(s.rules.time) * 1000;
const goKey = (s) => `targets:${s.seed}:go`;
const clone = (s) => ({ ...s, best: { ...s.best }, hits: s.hits.map((h) => h.slice()), misses: s.misses.slice() });

/* ---------- 画面 ---------- */

let ui = null; // { mount, field, chips, els: Map(id → 要素), tapped: Set, n, cur: { s, o } }
const cpuPlan = new Map();

function float(field, x, y, text, cls) {
  const f = document.createElement('div');
  f.className = 'tg-float ' + cls;
  f.textContent = text;
  f.style.left = (x * 100) + '%';
  f.style.top = (y * 100) + '%';
  field.append(f);
  setTimeout(() => f.remove(), 700);
}

// 的の場を、ページを動かさずに全部見える大きさにする（上の表示と下の説明を除いた高さに収める）
function fit() {
  const field = ui?.field;
  if (!field?.isConnected) return;
  const legend = field.nextElementSibling;
  const top = field.getBoundingClientRect().top + window.scrollY;
  const room = window.innerHeight - top - (legend?.offsetHeight ?? 0) - 20;
  field.style.width = `min(100%, ${Math.max(220, Math.floor(room))}px)`;
}
if (typeof window !== 'undefined') window.addEventListener('resize', fit);

function loop(token) {
  if (ui !== token || !ui.field.isConnected) return; // 描き直しで作り直したら古い繰り返しは止める
  const { s, o } = ui.cur;
  const me = o.me >= 0 ? o.me : null;
  const t = since(goKey(s));
  const dur = durOf(s);
  let visible = 0;
  for (const tg of s.targets) {
    const mineGone = ui.tapped.has(tg.id);
    const best = s.best[tg.id];
    const live = t >= tg.at && t < tg.at + tg.life && !best && !mineGone && s.phase === 'play';
    let e = ui.els.get(tg.id);
    if (live) {
      visible += 1;
      const pos = posOf(tg, t - tg.at);
      if (!e) {
        e = document.createElement('button');
        e.type = 'button';
        e.className = `tg-target ${tg.kind}`;
        const pt = ptOf(tg);
        e.style.width = e.style.height = (sizeOf(tg) * 100) + '%';
        e.style.left = (tg.x * 100) + '%';
        e.style.top = (tg.y * 100) + '%';
        e.innerHTML = tg.kind === 'bomb' ? '<span>☠</span>' : `<span>${pt}</span>`;
        if (me !== null && o.canMove) {
          e.onpointerdown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const ms = Math.round(since(goKey(s)) - tg.at);
            if (ui.tapped.has(tg.id) || ms > tg.life + 200) return;
            ui.tapped.add(tg.id);
            e.remove();
            ui.els.delete(tg.id);
            const at = posOf(tg, ms);
            float(ui.field, at.x, at.y, tg.kind === 'bomb' ? '−2' : '+' + pt, tg.kind === 'bomb' ? 'bad' : 'good');
            o.onMove({ t: 'hit', id: tg.id, ms });
          };
        }
        ui.field.append(e);
        ui.els.set(tg.id, e);
      }
      if (tg.vx || tg.vy) { e.style.left = (pos.x * 100) + '%'; e.style.top = (pos.y * 100) + '%'; } // 動く的
    } else if (e) {
      e.remove();
      ui.els.delete(tg.id);
      const end = posOf(tg, Math.min(t - tg.at, tg.life));
      if (best && best.p !== me) float(ui.field, end.x, end.y, o.names[best.p], 'other');
    }
  }
  ui.visible = visible;
  const left = Math.max(0, Math.ceil((dur - t) / 1000));
  if (ui.clock) ui.clock.textContent = s.phase === 'play' ? (t < dur ? `残り ${left}秒` : 'そこまで！') : '';
  requestAnimationFrame(() => loop(token));
}

export default {
  id: 'targets',
  name: '的の早押し',
  icon: '🎯',
  desc: '次々に出てくる的を早い者勝ちで押す。小さい的ほど高い点、ドクロは押すと減点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: '1回の勝負の長さ', def: '30', choices: [['20', '20秒'], ['30', '30秒'], ['45', '45秒']] },
    { key: 'bombs', label: 'ドクロの的を混ぜる', desc: '押すと2点減る的', def: true },
    { key: 'move', label: '動く的', desc: '的が出ている間ゆっくり動き、ふちで跳ね返る', def: false },
    { key: 'sizes', label: '小さい的は高い点', desc: '赤と青の的が小さく出ると、点が2倍・3倍', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '30', bombs: true, move: false, sizes: false, ...rules };
    const targets = makeTargets(mulberry32(seed), Number(r.time) * 1000, r.bombs);
    if (r.move) addMotion(targets, seed);
    if (r.sizes) addSizes(targets, seed);
    return { n, seed, rules: r, targets, phase: 'ready', best: {}, hits: Array.from({ length: n }, () => []), misses: Array(n).fill(0), step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'play'; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  // ほかの人が押した音は鳴らさない（にぎやかすぎるため）
  sound(a, b, m, me) {
    if (m.p === -1) return 'question';
    if (m.p !== me) return null;
    return m.t === 'miss' || b.targets[m.id].kind === 'bomb' ? 'wrong' : 'hit';
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const scores = scoresOf(s);
    return { winners: leaders(scores), scores };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '的をどんどん押そう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'play') return { key: 'play', ms: durOf(s) + GRACE_MS, move: { t: 'end' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if ((m.t === 'go' && s0.phase === 'ready') || (m.t === 'end' && s0.phase === 'play')) {
        const s = clone(s0);
        s.step += 1;
        s.phase = m.t === 'go' ? 'play' : 'end';
        return s;
      }
      return null;
    }
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (m.t === 'miss') {
      if (m.n !== s0.misses[m.p] + 1) return null;
      const s = clone(s0);
      s.step += 1;
      s.misses[m.p] = m.n;
      return s;
    }
    if (m.t !== 'hit') return null;
    const tg = s0.targets[m.id];
    if (!tg || !Number.isInteger(m.id) || s0.hits[m.p].includes(m.id)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > tg.life + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.hits[m.p].push(m.id);
    if (tg.kind !== 'bomb') {
      const b = s.best[m.id];
      if (!b || m.ms < b.ms) s.best[m.id] = { p: m.p, ms: m.ms };
    }
    return s;
  },

  // CPU: 出ている的ごとに、押すかどうかと反応の速さ（0.45〜1.1秒）を1回だけ決める。ドクロはたまにうっかり押す
  // 小さい的は高い点（詳細設定）: 中くらいは押す割合 0.85倍・0.12秒遅れ、小さいは 0.7倍・0.24秒遅れ
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play') return null;
    const t = since(goKey(s));
    for (const tg of s.targets) {
      if (t < tg.at || t >= tg.at + tg.life || s.hits[p].includes(tg.id)) continue;
      const key = `${s.seed}:${tg.id}:${p}`;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const sz = tg.sz || 1;
        const rate = (tg.kind === 'bomb' ? 0.08 : tg.kind === 'gold' ? 0.4 : 0.6) * [1, 0.85, 0.7][sz - 1];
        plan = { hit: Math.random() < rate, react: 450 + Math.random() * 650 + (tg.vx || tg.vy ? 150 : 0) + (sz - 1) * 120 }; // 動く的・小さい的は少し遅れる
        cpuPlan.set(key, plan);
        if (cpuPlan.size > 2000) cpuPlan.delete(cpuPlan.keys().next().value);
      }
      const b = s.best[tg.id];
      if (!plan.hit || t - tg.at < plan.react || (b && b.ms <= plan.react)) continue;
      return { t: 'hit', id: tg.id, ms: Math.round(Math.min(t - tg.at, tg.life)) };
    }
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const scores = scoresOf(s);
    const won = s.phase === 'end' ? leaders(scores) : [];
    const chips = scoreChips(o, scores, { won });
    const mount = `${s.seed}:${s.phase}:${me}`;

    if (ui?.mount === mount && root.contains(ui.field)) {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      return;
    }

    root.innerHTML = '';
    root.className = 'board tg';
    const top = document.createElement('div');
    top.className = 'tg-top';
    const clock = document.createElement('div');
    clock.className = 'tg-clock';
    const field = document.createElement('div');
    field.className = 'tg-field' + (s.phase === 'play' && me !== null ? ' live' : '');
    const legend = document.createElement('div');
    legend.className = 'tg-legend';
    legend.innerHTML = '<span class="tg-dot big"></span>1点 <span class="tg-dot mid"></span>2点 <span class="tg-dot small"></span>3点 <span class="tg-dot gold"></span>5点'
      + (s.rules.bombs ? ' <span class="tg-dot bomb">☠</span>−2点' : '')
      + (s.rules.sizes ? '<br>赤と青の的は小さく出ると点が2倍・3倍' : '') + '<br>的が無いときに押すと −1点';

    ui = { mount, field, chips, clock, els: new Map(), tapped: new Set(), n: 0, visible: 0, cur: { s, o } };
    top.append(chips, clock);
    root.append(top, field, legend);
    if (s.phase !== 'end') window.scrollTo(0, 0); // 始まる前に上へ戻す（遊んでいる間はページを動かさない）
    fit();

    if (s.phase === 'ready') {
      const key = `targets:${s.seed}:ready`;
      since(key);
      const cd = document.createElement('div');
      cd.className = 'tg-count';
      field.append(cd);
      const tick = () => {
        if (!cd.isConnected) return;
        const left = Math.ceil((READY_MS - since(key)) / 1000);
        cd.textContent = left > 0 ? String(left) : 'スタート！';
        requestAnimationFrame(tick);
      };
      tick();
      return;
    }
    if (s.phase === 'end') {
      const sum = document.createElement('div');
      sum.className = 'tg-count small';
      sum.textContent = 'おしまい！';
      field.append(sum);
      return;
    }

    since(goKey(s)); // 始まった時刻を覚える
    if (me !== null && o.canMove) {
      // 的が1つも出ていないときに押したら −1点
      field.onpointerdown = (ev) => {
        if (ev.target !== field || ui.visible > 0 || since(goKey(s)) >= durOf(s)) return;
        const { s: cur } = ui.cur;
        ui.n = Math.max(ui.n, cur.misses[me]) + 1;
        const r = field.getBoundingClientRect();
        float(field, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, '−1', 'bad');
        o.onMove({ t: 'miss', n: ui.n });
      };
    }
    loop(ui);
  },
};
