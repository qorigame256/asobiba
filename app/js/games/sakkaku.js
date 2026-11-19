// 目の錯覚クイズ。錯覚が起きる図を見て「長いのは」「大きいのは」などを、左・右・同じ の3つから早押しで選ぶ。2〜10人・足りない分は CPU（弱め）。
// 2026-11-19 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 答えは「左」「右」に「同じ」を足した3つ。半分ほどは「同じ」が正解の問題にする。
//   - 問題はその場で作る（図の種類を5種類ほど用意し、毎回寸法を変える）。
//   - 点と進め方は多いのはどっちと同じ（正解した速い順に 3・2・1点、まちがえたらその問題はもう押せないが点は減らない。10問（詳細設定で 5・20問））。
// Claude の判断:
//   - 図は6種類: 矢羽根の線（ミュラー・リヤー）・まわりの丸（エビングハウス）・線路の上の棒（ポンゾ）・扇形（ジャストロー）・たてとよこの線（フィック）・
//     まわりの色で明るさが違って見える四角（明るさの対比）。上下に並ぶ図（線路・扇形）は答えを「上」「下」、たてよこの線は「たて」「よこ」と呼ぶ
//     （ボタンの並びは「左（上・たて）・同じ・右（下・よこ）」でいつも同じ）。6種類を1巡ずつ、種でまぜた順に出す。
//   - 同じでない問題（半分）は、大きい方を「大きく見える方」にするか「小さく見える方」にするかを半々にする（見た感じだけでは当たらないように）。
//     差は大きい方に対して 1問目 12%・最後の問題 6%（間は問題の番号で一定の割合で縮める）。
//   - 1問の制限時間は6秒。全員が答えたら0.8秒で締め切る。答えを見せる間は3秒で、まわりの飾りを薄くして本当の大きさを比べやすくし、数を添える。
//   - CPU は1.2〜3.4秒で押し、55% 当てる（まちがえるときは、ほかの2つから1つ）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（多いのはどっちと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 0（左・上・たて）| 1（右・下・よこ）| 2（同じ）, ms }

import { mulberry32, shuffle } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [20, '20問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 10);
export const LIMIT = 6000;
const READY_MS = 3000;
const SHOWN_MS = 3000;
const GRACE_MS = 800;
export const SAME = 2;

export const KINDS = ['muller', 'ebbing', 'ponzo', 'jastrow', 'fick', 'bright'];
const ASK = {
  muller: '線が長いのは？', ebbing: 'まん中の丸が大きいのは？', ponzo: '横の棒が長いのは？',
  jastrow: '形が大きいのは？', fick: '線が長いのは？', bright: 'まん中の四角が明るいのは？',
};
export const LABELS = { muller: ['左', '右'], ebbing: ['左', '右'], ponzo: ['上', '下'], jastrow: ['上', '下'], fick: ['たて', 'よこ'], bright: ['左', '右'] };
const UNIT = { muller: '長さ', ebbing: '大きさ', ponzo: '長さ', jastrow: '大きさ', fick: '長さ', bright: '明るさ' };
// 種類ごとの大きさのもとの幅
const BASE = { muller: [80, 100], ebbing: [12, 15], ponzo: [60, 74], jastrow: [80, 92], fick: [95, 112], bright: [45, 58] };

// 問題の番号 q（0から）・問題の数 k での、差の割合（大きい方に対して）
export const diffOf = (q, k) => 0.12 - 0.06 * (k > 1 ? q / (k - 1) : 0);
const r1 = (v) => Math.round(v * 10) / 10;

// look = 大きく見える方（0 か 1）。ans = 正解（0・1・SAME）。v = 2つの本当の大きさ
export function makeQuestions(k, seed) {
  const rnd = mulberry32((seed * 131 + 17) >>> 0);
  let order = [];
  // 「同じ」が正解の問題は、対局ごとに半分（奇数なら切り上げか切り捨てを種で決める）にそろえる（2026-11-19 本人の決定。
  // 前は1問ずつのくじで、5問だと全部「同じ」の回が 1/32 で出て「同じ」を押すだけで勝てた）。どの問題が「同じ」かは種でまぜる
  const half = k % 2 ? (k + (rnd() < 0.5 ? 1 : -1)) / 2 : k / 2;
  const sames = shuffle(Array.from({ length: k }, (_, i) => i < half), rnd);
  return Array.from({ length: k }, (_, q) => {
    if (!order.length) order = shuffle(KINDS, rnd);
    const kind = order.pop();
    const same = sames[q];
    const fool = rnd() < 0.5;
    const flip = rnd() < 0.5;
    const [lo, hi] = BASE[kind];
    const base = r1(lo + rnd() * (hi - lo));
    // 大きく見える方: 線路は上・扇形は下・たてよこはたて（形で決まる）。ほかは種で左右を決める
    const look = kind === 'ponzo' || kind === 'fick' ? 0 : kind === 'jastrow' ? 1 : flip ? 1 : 0;
    let ans = SAME;
    const v = [base, base];
    if (!same) {
      ans = fool ? 1 - look : look;
      v[ans] = r1(base * (1 + diffOf(q, k)));
    }
    return { kind, look, ans, v };
  });
}

/* ---------- 図（SVG の中身の文字。名前は入らない） ---------- */

const line = (x1, y1, x2, y2, cls = 'ind') => `<line class="${cls}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"/>`;
const circ = (cx, cy, r, cls = 'ind') => `<circle class="${cls}" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}"/>`;

// 矢羽根の線: out = 羽根が外へ開く（長く見える）
function muller(cx, cy, len, out) {
  const f = 15;
  const x0 = cx - len / 2;
  const x1 = cx + len / 2;
  const dx = out ? -f * 0.75 : f * 0.75;
  return line(x0, cy, x1, cy, 'tg') + line(x0, cy, x0 + dx, cy - f * 0.75) + line(x0, cy, x0 + dx, cy + f * 0.75)
    + line(x1, cy, x1 - dx, cy - f * 0.75) + line(x1, cy, x1 - dx, cy + f * 0.75);
}
// まわりの丸: small = まわりが小さい丸（まん中が大きく見える）
function ebbing(cx, cy, r, small) {
  const n = small ? 8 : 6;
  const rr = small ? 5 : 19;
  const d = r + (small ? 6 : 8) + rr;
  let s = circ(cx, cy, r, 'tg fill');
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s += circ(cx + d * Math.cos(a), cy + d * Math.sin(a), rr, 'ind fill');
  }
  return s;
}
// 扇形（中心 cx・cy、外の半径 R、内の半径 r、上向き 60度ぶん）
function sector(cx, cy, R, r) {
  const a0 = (-120 * Math.PI) / 180;
  const a1 = (-60 * Math.PI) / 180;
  const p = (rad, a) => `${r1(cx + rad * Math.cos(a))} ${r1(cy + rad * Math.sin(a))}`;
  return `<path class="tg fill" d="M${p(R, a0)} A${r1(R)} ${r1(R)} 0 0 1 ${p(R, a1)} L${p(r, a1)} A${r1(r)} ${r1(r)} 0 0 0 ${p(r, a0)} Z"/>`;
}

// 1問の図: { w, h, body }
export function figure(x) {
  const [a, b] = x.v;
  if (x.kind === 'muller') return { w: 300, h: 150, body: muller(75, 75, a, x.look === 0) + muller(225, 75, b, x.look === 1) };
  if (x.kind === 'ebbing') return { w: 300, h: 150, body: ebbing(75, 75, a, x.look === 0) + ebbing(225, 75, b, x.look === 1) };
  if (x.kind === 'ponzo') {
    return { w: 300, h: 160, body: line(40, 158, 122, 4) + line(260, 158, 178, 4) + line(150 - a / 2, 42, 150 + a / 2, 42, 'tg thick') + line(150 - b / 2, 126, 150 + b / 2, 126, 'tg thick') };
  }
  if (x.kind === 'jastrow') {
    const s = [a / 100, b / 100];
    const R = s.map((v) => 130 * v);
    const r = s.map((v) => 80 * v);
    const cy0 = 8 + R[0];
    const bottom0 = cy0 - 0.866 * r[0];
    const cy1 = bottom0 + 10 + R[1];
    const h = Math.ceil(cy1 - 0.866 * r[1] + 8);
    return { w: 300, h, body: sector(150, cy0, R[0], r[0]) + sector(150, cy1, R[1], r[1]) };
  }
  if (x.kind === 'fick') return { w: 300, h: 160, body: line(150, 150, 150, 150 - a, 'tg') + line(150 - b / 2, 150, 150 + b / 2, 150, 'tg') };
  // bright: 地の色が暗い方の四角が明るく見える
  const bg = (side) => (x.look === side ? '#262626' : '#e2e2e2');
  const sq = (cx, v) => `<rect class="tg-sq" x="${cx - 26}" y="49" width="52" height="52" fill="hsl(0 0% ${v}%)"/>`;
  return {
    w: 300, h: 150,
    body: `<rect class="ind bg" x="4" y="4" width="140" height="142" fill="${bg(0)}"/><rect class="ind bg" x="156" y="4" width="140" height="142" fill="${bg(1)}"/>` + sq(74, a) + sq(226, b),
  };
}

function figSvg(x, shown) {
  const f = figure(x);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`);
  svg.setAttribute('class', 'sak-fig' + (shown ? ' shown' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ASK[x.kind]);
  svg.innerHTML = f.body;
  return svg;
}

export const answerName = (x, c) => (c === SAME ? '同じ' : LABELS[x.kind][c]);
const qKey = (s, q = s.q) => `sakkaku:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const cpuPlan = new Map();

export default {
  id: 'sakkaku',
  name: '目の錯覚クイズ',
  icon: '👁️',
  desc: '錯覚の図を見て、長いのは左か右か同じかを早押し',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, ...rules };
    return {
      n, seed, rules: r, qs: makeQuestions(roundsOf(r), seed), q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), said: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が押した音は鳴らさない（色ちがい早押しと同じ）
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
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + 1000, move: { t: 'close' } };
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
    if (![0, 1, SAME].includes(m.c) || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === s.qs[s.q].ans) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const others = [0, 1, SAME].filter((c) => c !== x.ans);
      plan = { at: 1200 + Math.random() * 2200, c: Math.random() < 0.55 ? x.ans : others[Math.floor(Math.random() * others.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < LIMIT ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
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
    root.className = 'board kj sak';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">目にだまされないで！ 左・右・同じ から選ぼう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const shown = s.phase !== 'open';
    card.insertAdjacentHTML('beforeend', `<div class="ir-ask">${ASK[x.kind]}</div>`);
    card.append(figSvg(x, shown));
    if (!shown) { since(key); card.append(timeBar(key, LIMIT)); }
    else {
      const [l0, l1] = LABELS[x.kind];
      const t = document.createElement('div');
      t.className = 'ox-ans sak-ans';
      t.textContent = `正解は「${answerName(x, x.ans)}」（${UNIT[x.kind]} ${l0} ${x.v[0]}・${l1} ${x.v[1]}）`;
      card.append(t);
      const f = document.createElement('div');
      f.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      f.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(f);
    }
    if (document.activeElement?.classList?.contains('kj-choice')) document.activeElement.blur(); // 前の問題で押した札に残った focus を外す（難読漢字と同じ）
    const can = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < LIMIT;
    const mine = me !== null ? s.said[me] : null;
    const grid = document.createElement('div');
    grid.className = 'sak-choices';
    const btns = [0, SAME, 1].map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = c === x.ans && (shown || mine === c);
      const ng = c === mine && c !== x.ans;
      b.className = 'btn secondary kj-choice sq-choice sak-choice' + (ok ? ' ok' : ng ? ' ng' : !can ? ' off' : '');
      b.textContent = answerName(x, c);
      b.disabled = !can;
      const hit = (e) => {
        if (!can || grid.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms >= LIMIT) return;
        grid.dataset.sent = '1';
        btns.forEach((y) => { y.disabled = true; });
        o.onMove({ t: 'ans', q: s.q, c, ms });
      };
      b.onpointerdown = hit; // 押した瞬間に測る
      b.onclick = (e) => { if (e.detail === 0) hit(e); }; // キーボードで押したとき
      return b;
    });
    grid.append(...btns);
    wrap.append(grid);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open') note.textContent = '答えられるのは1回だけ';
    wrap.append(note);
    if (s.phase === 'shown') wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (can) {
      setTimeout(() => {
        if (!grid.isConnected || grid.dataset.sent) return;
        btns.forEach((y) => { y.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, LIMIT - since(key)));
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
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.said[me] !== null ? `❌ ${answerName(g, x.said[me])}` : '―';
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(`${ASK[g.kind]} → ${answerName(g, g.ans)}`), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// PC の ← ↓ → キーで押す（← が左の札・↓ が「同じ」・→ が右の札。対局の画面に錯覚クイズの札が出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    const i = { ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 }[e.key];
    if (i === undefined || e.target?.closest?.('input, textarea, select')) return;
    const btns = document.querySelectorAll('.board.sak .sak-choice');
    if (btns.length !== 3 || btns[i].disabled) return;
    e.preventDefault();
    btns[i].onpointerdown?.(e);
  });
}
