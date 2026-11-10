// 色水づくり。赤・黄・青・白の絵の具を1滴ずつ水に落として、お手本の色を作る。いちばん近い色を作った人が高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-10 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   - 絵の具は1滴ずつ足す（色が混ざっていく様子を見せる。足しすぎたら戻せない）。戻せないが「水を捨てて最初から」はできる。
//   - 制限時間のうちに、いちばん近い色を作った人が点。5回戦。
// Claude の判断:
//   - 混ぜ方: 赤・黄・青の滴の数の割合を、絵の具の混ざり方に近い表（RYB の8つの角の色。Gossett と Chen の値）で色にし、白の滴の割合だけ白へ寄せる。
//     数ではなく割合で決まる（赤2・黄1 と 赤4・黄2 は同じ色）。何も落としていないときは「水」の色。
//   - 近さは、人の目の感じ方に近い色の差（CIE Lab の ΔE76）で比べ、100 − 差 を「近さ ◯%」で見せる（0% より下は 0%）。
//     比べるときは差を 0.01 に丸める（端末で末尾が違っても順位が変わらないように）。
//   - 点は近い順に 3・2・1点（同じ近さは同じ点。1滴も落としていない人は0点）。
//   - 1回の制限時間は30秒。「これで決定」を押すとそれ以上落とせない。全員が決めたら0.8秒で締め切る。結果を見せる間は4秒。
//   - お手本は種から「作れる色」を作る（1回目は2色、2回目からは2〜3色、ときどき白も入る。1色は1〜4滴）。1人30滴まで。
//   - 詳細設定「回数」（鍵は rounds）: 3・5（最初）・8回。おまかせでは抽選しない（KEEP_KEYS の rounds）。
//   - ほかの人の色は、その回の結果まで見せない（まねできないように）。決めたかどうか（✔）だけ見せる。
//   - CPU はお手本の作り方を少しずらした作り方（色ごとに半分の見込みで ±1滴）を、1.5秒から0.5〜0.9秒おきに1滴ずつ落として決める。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'drop', r: 何回目, c: 絵の具（0 赤・1 黄・2 青・3 白）, k: その人のその回の何手目 } /
//     { p, t: 'reset', r, k } / { p, t: 'ok', r, k }（k は同じ手が2回届いたときに2回目を弾くため）

import { mulberry32, shuffle } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar } from './party.js';

export const PAINTS = [['赤', '#d8312f'], ['黄', '#f2c81c'], ['青', '#2861b8'], ['白', '#ffffff']];
const ROUNDS = [[3, '3回'], [5, '5回'], [8, '8回']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r?.rounds)) ? Number(r.rounds) : 5);
export const LIMIT = 30000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 800;
export const MAX_DROPS = 30;
const PTS = [3, 2, 1];
const WATER = [0.88, 0.94, 1];

// RYB の角の色（0〜1 の RGB）。順は [赤][黄][青] の 0/1
const RYB = {
  '000': [1, 1, 1], '100': [1, 0, 0], '010': [1, 1, 0], '001': [0.163, 0.373, 0.6],
  '110': [1, 0.5, 0], '101': [0.5, 0, 0.5], '011': [0, 0.66, 0.2], '111': [0.2, 0.094, 0],
};
// 滴の数 [赤, 黄, 青, 白] → 色（0〜1 の RGB）
export function mixColor(m) {
  const [r, y, b, w] = m;
  const pig = Math.max(r, y, b);
  if (pig === 0) return w > 0 ? [1, 1, 1] : WATER.slice();
  const t = [r / pig, y / pig, b / pig];
  const out = [0, 0, 0];
  for (const key of Object.keys(RYB)) {
    const wt = [...key].reduce((a, ch, i) => a * (ch === '1' ? t[i] : 1 - t[i]), 1);
    for (let k = 0; k < 3; k++) out[k] += RYB[key][k] * wt;
  }
  const wf = w / (r + y + b + w);
  return out.map((v) => v + (1 - v) * wf * 0.85);
}
function lab([R, G, B]) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(R), lin(G), lin(B)];
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
// 色の差（0.01 に丸めた ΔE76 を100倍した整数）
export function gapOf(a, b) {
  const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100);
}
export const closeness = (gap) => Math.max(0, Math.round(100 - gap / 100));
const css = (c) => `rgb(${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;

// お手本の作り方（何回目か q から）
export function makeTargets(k, seed) {
  const rnd = mulberry32((seed ^ 0x1b873593) >>> 0);
  return Array.from({ length: k }, (_, q) => {
    for (;;) {
      const use = shuffle([0, 1, 2], rnd).slice(0, q === 0 ? 2 : 2 + Math.floor(rnd() * 2));
      const m = [0, 0, 0, 0];
      for (const c of use) m[c] = 1 + Math.floor(rnd() * 4);
      if (q > 0 && rnd() < 0.4) m[3] = 1 + Math.floor(rnd() * 3);
      // 1色だけと見分けにくい色・暗すぎる色は作り直す
      const col = mixColor(m);
      if (lab(col)[0] < 22) continue;
      if ([0, 1, 2].some((c) => gapOf(col, mixColor([0, 1, 2, 3].map((i) => (i === c ? 1 : 0)))) < 2200)) continue;
      return m;
    }
  });
}

const clone = (s) => ({ ...s, mix: s.mix.map((m) => m.slice()), acts: s.acts.slice(), done: s.done.slice(), scores: s.scores.slice() });
const cpuPlan = new Map();
const shown = new Map(); // 色が変わる動きのため、前に描いた色を覚える
const drops = new Map(); // 自分が落とした滴（描き直しても落ちる動きを続ける）

function beaker(color, total, { label = '', cls = '', from = null, drop = null } = {}) {
  const b = document.createElement('div');
  b.className = 'im-glass ' + cls;
  const liq = document.createElement('div');
  liq.className = 'im-liquid';
  liq.style.height = `${Math.min(92, 34 + total * 2)}%`;
  liq.style.background = from ?? color;
  if (from && from !== color) requestAnimationFrame(() => requestAnimationFrame(() => { liq.style.background = color; }));
  b.append(liq);
  if (drop) {
    const d = document.createElement('div');
    d.className = 'im-drop';
    d.style.background = drop.color;
    d.style.animationDelay = `-${drop.t}ms`;
    b.append(d);
  }
  const wrap = document.createElement('div');
  wrap.className = 'im-cup';
  wrap.append(b);
  if (label) wrap.append(Object.assign(document.createElement('div'), { className: 'im-label', innerHTML: label }));
  return wrap;
}

export default {
  id: 'iromizu',
  name: '色水づくり',
  icon: '🧪',
  desc: '絵の具を1滴ずつ落として、お手本の色を作る。いちばん近い色を作った人が点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で作る色の数', def: 5, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, ...rules };
    return {
      n, seed, rules: r, targets: makeTargets(roundsOf(r), seed), q: -1, phase: 'ready',
      mix: Array.from({ length: n }, () => [0, 0, 0, 0]), acts: Array(n).fill(0), done: Array(n).fill(false),
      scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && !s.done[p]; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : `${s.q + 1}回目 / ${s.targets.length}`; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'call' : null;
    if (m.p !== me) return null;
    return m.t === 'drop' ? 'pop' : m.t === 'ok' ? 'chip' : null;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.done.every(Boolean)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + 800, move: { t: 'close' } };
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
        if (s.q + 1 >= s.targets.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.mix = Array.from({ length: s.n }, () => [0, 0, 0, 0]);
        s.acts = Array(s.n).fill(0);
        s.done = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const goal = mixColor(s.targets[s.q]);
        const gaps = s.mix.map((x) => (x.some((v) => v > 0) ? gapOf(mixColor(x), goal) : null));
        // 自分より近い人の数が順位（同じ近さは同じ順位）
        const pts = gaps.map((g) => (g === null ? 0 : PTS[gaps.filter((h) => h !== null && h < g).length] ?? 0));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { gaps, pts, mix: s.mix.map((x) => x.slice()) };
        s.log = [...s0.log, s.last];
        return s;
      }
      return null;
    }
    if (!['drop', 'reset', 'ok'].includes(m.t) || m.r !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p) || m.k !== s0.acts[m.p]) return null;
    const cur = s0.mix[m.p];
    if (m.t === 'drop' && (!Number.isInteger(m.c) || m.c < 0 || m.c > 3 || cur.reduce((a, v) => a + v, 0) >= MAX_DROPS)) return null;
    const s = clone(s0);
    s.step += 1;
    s.acts[m.p] += 1;
    if (m.t === 'drop') s.mix[m.p][m.c] += 1;
    else if (m.t === 'reset') s.mix[m.p] = [0, 0, 0, 0];
    else s.done[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 150 : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const key = `iromizu:${s.seed}:${s.q}`;
    let plan = cpuPlan.get(key + ':' + p);
    if (!plan) {
      const want = s.targets[s.q].map((v) => Math.max(0, v + (Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0)));
      if (want.every((v, i) => i === 3 || v === 0)) want[0] = 1;
      const seq = shuffle(want.flatMap((v, c) => Array(v).fill(c)), Math.random);
      let at = 1500;
      plan = { steps: seq.map((c) => ({ c, at: (at += 500 + Math.random() * 400) })), okAt: at + 600 };
      cpuPlan.set(key + ':' + p, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(key);
    const k = s.acts[p];
    if (k < plan.steps.length) return t >= plan.steps[k].at ? { t: 'drop', r: s.q, c: plan.steps[k].c, k } : null;
    return t >= plan.okAt ? { t: 'ok', r: s.q, k } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.done[p] ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const g = s.last.gaps[p];
      return g === null ? '<span class="pt-ng">―</span>' : `<span class="pt-ok">${closeness(g)}% +${s.last.pts[p]}</span>`;
    };
    root.innerHTML = '';
    root.className = 'board im';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    root.append(wrap);
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    if (s.phase === 'ready') {
      wrap.insertAdjacentHTML('beforeend', `<div class="kj-card"><div class="kj-word small">よーい…</div><div class="kj-sub">絵の具を1滴ずつ落として、お手本と同じ色を作ろう・全${s.targets.length}回</div></div>`);
      return;
    }
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const goal = css(mixColor(s.targets[s.q]));
    const key = `iromizu:${s.seed}:${s.q}`;
    const row = document.createElement('div');
    row.className = 'im-row';
    row.append(beaker(goal, s.targets[s.q].reduce((a, v) => a + v, 0), { label: 'お手本', cls: 'goal' }));
    if (s.phase === 'open') {
      since(key);
      wrap.append(timeBar(key, LIMIT));
      if (me !== null) {
        const m = s.mix[me];
        const col = css(mixColor(m));
        const mk = `${key}:${me}`;
        const from = shown.get(mk) ?? col;
        shown.set(mk, col);
        if (shown.size > 60) shown.delete(shown.keys().next().value);
        const dr = drops.get(mk);
        const dt = dr ? performance.now() - dr.at : Infinity;
        row.append(beaker(col, m.reduce((a, v) => a + v, 0), {
          label: m.some((v) => v > 0) ? PAINTS.map(([n], c) => (m[c] ? `${n}${m[c]}` : '')).filter(Boolean).join('・') : '水だけ',
          cls: 'mine', from, drop: dt < 500 ? { color: dr.color, t: Math.round(dt) } : null,
        }));
      }
      wrap.append(row);
      if (me !== null && o.canMove && !s.done[me]) {
        const pad = document.createElement('div');
        pad.className = 'im-pad';
        const total = s.mix[me].reduce((a, v) => a + v, 0);
        const send = (mv) => { if (pad.dataset.sent) return; pad.dataset.sent = '1'; pad.querySelectorAll('button').forEach((b) => { b.disabled = true; }); o.onMove({ ...mv, r: s.q, k: s.acts[me] }); };
        PAINTS.forEach(([name, color], c) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'im-paint';
          b.style.setProperty('--paint', color);
          b.innerHTML = `<span class="im-blob"></span><span>${name}</span>`;
          b.disabled = total >= MAX_DROPS;
          b.onclick = () => { drops.set(`${key}:${me}`, { color, at: performance.now() }); send({ t: 'drop', c }); };
          pad.append(b);
        });
        wrap.append(pad);
        const act = document.createElement('div');
        act.className = 'cc-actions';
        const reset = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: '🗑 水を捨てて最初から' });
        reset.disabled = total === 0;
        reset.onclick = () => send({ t: 'reset' });
        const ok = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary', textContent: 'これで決定' });
        ok.disabled = total === 0;
        ok.onclick = () => send({ t: 'ok' });
        act.append(reset, ok);
        wrap.append(act);
      }
      const note = document.createElement('p');
      note.className = 'cc-log';
      note.textContent = me === null ? '観戦中' : s.done[me] ? '決定しました。みんなを待っています…' : '1滴ずつ落として混ぜよう（落とした滴は戻せません）';
      wrap.append(note);
      return;
    }
    // 結果: 全員のコップを近い順に並べる
    wrap.append(row);
    const list = document.createElement('div');
    list.className = 'im-all';
    const order = [...Array(s.n).keys()].sort((a, b) => (s.last.gaps[a] ?? 1e9) - (s.last.gaps[b] ?? 1e9) || a - b);
    for (const p of order) {
      const g = s.last.gaps[p];
      const m = s.last.mix[p];
      const who = p === me ? 'あなた' : o.names[p];
      const cup = beaker(css(mixColor(m)), m.reduce((a, v) => a + v, 0), { cls: p === me ? 'mine' : '' });
      const lab = document.createElement('div');
      lab.className = 'im-label';
      lab.textContent = `${who}・${g === null ? '―' : closeness(g) + '%'}`;
      cup.append(lab);
      list.append(cup);
    }
    wrap.append(list);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    list.className = 'im-review';
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const t = s.targets[q];
      li.append(beaker(css(mixColor(t)), 10, { cls: 'small goal' }));
      const best = Math.min(...x.gaps.filter((g) => g !== null));
      const top = x.gaps.map((g, p) => (g !== null && g === best ? p : -1)).filter((p) => p >= 0);
      const info = document.createElement('span');
      info.className = 'mk-rv-who';
      info.textContent = `作り方 ${PAINTS.map(([n], c) => (t[c] ? `${n}${t[c]}` : '')).filter(Boolean).join('・')}`
        + (me !== null && x.gaps[me] !== null ? `・あなた ${closeness(x.gaps[me])}%` : '')
        + (top.length ? `・🥇${top.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? '')).join('・')}` : '');
      li.append(info);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
