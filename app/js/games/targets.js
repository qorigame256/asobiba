// 的の早押し（オリジナル）。決めた時間のあいだ、的がいくつも次々に出ては消える。いちばん速く押した人がその的の点をもらう。
// 的の種類: 大きい的 1点・中くらい 2点・小さい的 3点・金の的 5点（小さくてすぐ消える）・ドクロ（押すと −2点）。
// 的が1つも出ていないときに押すと −1点（あてずっぽうの連打を防ぐ）。
// 的の出る時刻・場所・種類は seed から全員同じに作る。速さは各自の端末で「その的が出てから押すまで」を測る。
// 同じ的を何人も押したら、測った時間がいちばん短い人のもの（通信で遅れて届いても、速ければ取り返せる）。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end
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

export function scoresOf(s) {
  const sc = Array(s.n).fill(0);
  for (const [id, b] of Object.entries(s.best)) sc[b.p] += KINDS[s.targets[id].kind].pt;
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
      if (!e) {
        e = document.createElement('button');
        e.type = 'button';
        e.className = `tg-target ${tg.kind}`;
        const k = KINDS[tg.kind];
        e.style.width = e.style.height = (k.size * 100) + '%';
        e.style.left = (tg.x * 100) + '%';
        e.style.top = (tg.y * 100) + '%';
        e.innerHTML = tg.kind === 'bomb' ? '<span>☠</span>' : `<span>${k.pt}</span>`;
        if (me !== null && o.canMove) {
          e.onpointerdown = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const ms = Math.round(since(goKey(s)) - tg.at);
            if (ui.tapped.has(tg.id) || ms > tg.life + 200) return;
            ui.tapped.add(tg.id);
            e.remove();
            ui.els.delete(tg.id);
            float(ui.field, tg.x, tg.y, tg.kind === 'bomb' ? '−2' : '+' + k.pt, tg.kind === 'bomb' ? 'bad' : 'good');
            o.onMove({ t: 'hit', id: tg.id, ms });
          };
        }
        ui.field.append(e);
        ui.els.set(tg.id, e);
      }
    } else if (e) {
      e.remove();
      ui.els.delete(tg.id);
      if (best && best.p !== me) float(ui.field, tg.x, tg.y, o.names[best.p], 'other');
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
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: '30', bombs: true, ...rules };
    const targets = makeTargets(mulberry32(seed), Number(r.time) * 1000, r.bombs);
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
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play') return null;
    const t = since(goKey(s));
    for (const tg of s.targets) {
      if (t < tg.at || t >= tg.at + tg.life || s.hits[p].includes(tg.id)) continue;
      const key = `${s.seed}:${tg.id}:${p}`;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const rate = tg.kind === 'bomb' ? 0.08 : tg.kind === 'gold' ? 0.4 : 0.6;
        plan = { hit: Math.random() < rate, react: 450 + Math.random() * 650 };
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
      + (s.rules.bombs ? ' <span class="tg-dot bomb">☠</span>−2点' : '') + '<br>的が無いときに押すと −1点';

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
