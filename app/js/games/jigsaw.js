// ジグソー早解き。ばらばらになった絵のかけらを入れ替えて元の絵に戻す。全員に同じ問題を出し、早くそろえた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-06 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 絵は、色のついた背景に大きな絵文字を何個か散らしたもの（ダウンロードしない）。
//   - かけらを2つ順に押すと入れ替わる（どの2つでも）。
//   - 大きさは 3×3（かんたん）・4×4（最初）・5×5。全員に同じ3問を出し、早くそろえた順に 3点・2点・それ以降は1点（15パズル早解きと同じ）。
// Claude の判断:
//   - 絵は種から作る（背景の2色のななめの色の変わり目・大きな丸と帯・絵文字7〜10個の場所と大きさと傾き）。描くのは各自の端末の canvas で、
//     絵文字の形は端末ごとに違うが、自分の画面の絵と見本は同じ端末の絵なので食い違わない（シルエットクイズと同じ考え）。
//   - 混ぜ方は種から。どのかけらも元の場所に無いように混ぜる。正しい場所に入ったかけらは緑の枠になる（15パズル早解きと同じ）。
//   - 見本の絵（小さく）を盤の上に出す（ジグソーの箱の絵の代わり）。
//   - 制限時間は 3×3 が60秒・4×4 が120秒・5×5 が180秒。最初にそろえた人から20秒で締め切る（制限時間のほうが先なら制限時間で）。あきらめる（この問題をとばす）もできる。
//   - 送るのは入れ替えた2か所の並び（swaps）。apply で最初の並びから入れ替え直し、本当にそろうかを確かめる。
//   - CPU は 3×3 は8割・4×4 は6割5分・5×5 は5割の問題を、制限時間の2.5〜7.5割のころにそろえる。そろえない問題は同じころにあきらめる。
//   - 詳細設定「問題の数」（2026-11-06 の36回目の案。鍵は rounds）: 1問・3問（最初）・5問（数字つなぎ早解きと同じ）。おまかせでは抽選しない（main.js の KEEP_KEYS の rounds）。
//     問題は種から順に作るので、3問の対局と5問の対局の初めの3問は同じ絵になる（同じ種なら）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（15パズル早解きと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, swaps: [[a, b]…], ms } / { p, t: 'pass', q }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
export const QUESTIONS = 3;
const ROUNDS = [[3, '3問'], [1, '1問'], [5, '5問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : QUESTIONS);
const LIMITS = { 3: 60000, 4: 120000, 5: 180000 };
const MAX_SWAPS = 400;
const sizeOf = (r) => ([3, 5].includes(Number(r.size)) ? Number(r.size) : 4);
const limitOf = (s) => LIMITS[s.size];
const qKey = (s, q = s.q) => `jigsaw:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];

// 絵に使う絵文字（新しすぎる絵文字は古い端末で出ないので、U+1FA70 より前だけ。tools/test-logic.mjs が見ている）
export const EMOJIS = ['🐶', '🐱', '🐼', '🦁', '🐸', '🐵', '🐧', '🐢', '🐙', '🦋', '🌻', '🌷', '🍎', '🍌', '🍉', '🍓', '🍩', '🍰', '⚽', '🏀',
  '🚗', '🚀', '🚲', '🎈', '🎁', '⭐', '🌙', '🌞', '🌈', '🍄', '🌵', '🐳', '🐟', '🦀', '🐝', '🐞', '🍀', '🎸', '🏠', '🍔', '🍕', '🐘', '🦒', '🐰', '🦊', '🐻', '🍒', '🎃'];
const PALETTE = [['#ffd6a5', '#ff8fab'], ['#a0e7e5', '#5e9bd6'], ['#caffbf', '#4fb37a'], ['#fdffb6', '#f6a03b'], ['#e0c3fc', '#8e7cc3'], ['#ffc8dd', '#bde0fe'], ['#b9fbc0', '#f1c0e8'], ['#ffe5b4', '#c89f6f']];

// 絵の作り方（種から。全員同じ）
export function pictureOf(seed) {
  const rnd = mulberry32((seed * 2654435761) >>> 0);
  const [c1, c2] = PALETTE[Math.floor(rnd() * PALETTE.length)];
  const angle = rnd() * Math.PI;
  const shapes = [];
  for (let k = 0; k < 3; k++) shapes.push({ kind: k === 2 ? 'band' : 'ball', x: rnd(), y: rnd(), r: 0.12 + rnd() * 0.18, a: rnd() * Math.PI, alpha: 0.25 + rnd() * 0.25 });
  const pool = shuffle(EMOJIS.slice(), rnd);
  const count = 7 + Math.floor(rnd() * 4);
  const items = [];
  // 絵文字は 4×4 のますめに1つずつ（かけらに目印が散らばるように）、ますめの中でずらす
  const cells = shuffle([...Array(16).keys()], rnd).slice(0, count);
  cells.forEach((c, k) => {
    const size = 0.13 + rnd() * 0.12;
    items.push({ e: pool[k], x: ((c % 4) + 0.2 + rnd() * 0.6) / 4, y: (Math.floor(c / 4) + 0.2 + rnd() * 0.6) / 4, size, rot: (rnd() - 0.5) * 0.9 });
  });
  return { c1, c2, angle, shapes, items };
}
// どのかけらも元の場所に無いように混ぜた並び（perm[場所] = その場所にあるかけら）
export function scrambleOf(n, rnd) {
  const ids = [...Array(n * n).keys()];
  for (;;) {
    const p = shuffle(ids.slice(), rnd);
    if (p.every((v, i) => v !== i)) return p;
  }
}
export const isDone = (perm) => perm.every((v, i) => v === i);
// 入れ替えをまとめて当てる。おかしな手なら null
export function replaySwaps(perm, swaps) {
  if (!Array.isArray(swaps) || swaps.length > MAX_SWAPS) return null;
  const out = perm.slice();
  for (const sw of swaps) {
    if (!Array.isArray(sw) || sw.length !== 2) return null;
    const [a, b] = sw;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= out.length || b >= out.length) return null;
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}
// そろえる入れ替え（CPU と自動確認が使う）。1回で1つのかけらを正しい場所へ入れる
export function solveSwaps(perm) {
  const p = perm.slice();
  const out = [];
  for (let i = 0; i < p.length; i++) {
    while (p[i] !== i) {
      const j = p[i];
      [p[i], p[j]] = [p[j], p[i]];
      out.push([i, j]);
    }
  }
  return out;
}

// 絵を canvas に描いて画像の URL にする（問題ごとに1回だけ）
const picCache = new Map();
function pictureUrl(seed) {
  if (picCache.has(seed)) return picCache.get(seed);
  const P = pictureOf(seed);
  const S = 600;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const dx = Math.cos(P.angle) * S, dy = Math.sin(P.angle) * S;
  const grad = g.createLinearGradient(S / 2 - dx / 2, S / 2 - dy / 2, S / 2 + dx / 2, S / 2 + dy / 2);
  grad.addColorStop(0, P.c1);
  grad.addColorStop(1, P.c2);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  for (const sh of P.shapes) {
    g.save();
    g.globalAlpha = sh.alpha;
    g.fillStyle = '#ffffff';
    if (sh.kind === 'ball') { g.beginPath(); g.arc(sh.x * S, sh.y * S, sh.r * S, 0, Math.PI * 2); g.fill(); }
    else { g.translate(sh.x * S, sh.y * S); g.rotate(sh.a); g.fillRect(-S, -sh.r * S * 0.4, S * 2, sh.r * S * 0.8); }
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const it of P.items) {
    g.save();
    g.translate(it.x * S, it.y * S);
    g.rotate(it.rot);
    g.font = `${Math.round(it.size * S)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    g.fillText(it.e, 0, 0);
    g.restore();
  }
  const url = cv.toDataURL('image/png');
  picCache.set(seed, url);
  if (picCache.size > 12) picCache.delete(picCache.keys().next().value);
  return url;
}

let loc = null; // この端末で動かしている並び { key, perm, swaps, sel, sent }
const cpuPlan = new Map();

export default {
  id: 'jigsaw',
  name: 'ジグソー早解き',
  icon: '🧩',
  desc: 'ばらばらの絵のかけらを入れ替えて元に戻す。早くそろえた人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '大きさ', desc: '3×3 はかんたん・4×4 はふつう・5×5 はむずかしい', def: 4, choices: [[4, '4×4'], [3, '3×3（かんたん）'], [5, '5×5（むずかしい）']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で解く問題の数', def: 3, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: 4, ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const qs = [];
    for (let q = 0; q < roundsOf(r); q++) qs.push({ pic: Math.floor(rnd() * 2 ** 31), perm: scrambleOf(size, rnd) });
    return { n, seed, rules: r, size, qs, q: -1, phase: 'ready', solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    return m.p === me ? (m.t === 'done' ? 'correct' : 'pop') : 'pop';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limitOf(s), AFTER_MS, GRACE_MS), move: { t: 'close' } };
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
        s.solved = Array(s.n).fill(null);
        s.passed = Array(s.n).fill(false);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }];
        return s;
      }
      return null;
    }
    if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (m.t === 'pass') { const s = clone(s0); s.step += 1; s.passed[m.p] = true; return s; }
    if (m.t !== 'done' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    const end = replaySwaps(s0.qs[s0.q].perm, m.swaps);
    if (!end || !isDone(end)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: limitOf(s) * (0.25 + Math.random() * 0.5), ok: Math.random() < ({ 3: 0.8, 4: 0.65, 5: 0.5 })[s.size], done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'done', q: s.q, swaps: solveSwaps(s.qs[s.q].perm), ms: Math.round(t) };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">そろった！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj jg';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}×${s.size}・全${s.qs.length}問・かけらを2つ押すと入れ替わる。元の絵に戻そう</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    const N = s.size;
    const x = s.qs[s.q];
    const url = pictureUrl(x.pic);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかがそろえた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれもそろえられませんでした';
      card.append(t);
    }
    if (loc?.key !== key) loc = { key, perm: x.perm.slice(), swaps: [], sel: -1, sent: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    // 見本（小さな元の絵）
    if (playing) {
      const peek = document.createElement('img');
      peek.className = 'jg-peek';
      peek.src = url;
      peek.alt = '見本の絵';
      card.append(peek);
    }
    // 盤: 答えを見せる場面・観戦の人・自分が終わったあとは、そろった絵を出す
    const perm = playing ? loc.perm : [...Array(N * N).keys()];
    const grid = document.createElement('div');
    grid.className = 'jg-grid' + (playing ? ' live' : '') + (perm.every((v, i) => v === i) ? ' whole' : '');
    grid.style.setProperty('--n', N);
    const note = document.createElement('p');
    note.className = 'cc-log';
    const tiles = [];
    const paint = () => {
      tiles.forEach((b, i) => {
        const piece = perm[i];
        b.style.backgroundImage = `url("${url}")`;
        b.style.backgroundSize = `${N * 100}% ${N * 100}%`;
        b.style.backgroundPosition = `${N > 1 ? ((piece % N) / (N - 1)) * 100 : 0}% ${N > 1 ? (Math.floor(piece / N) / (N - 1)) * 100 : 0}%`;
        b.classList.toggle('ok', playing && piece === i);
        b.classList.toggle('sel', playing && loc.sel === i);
      });
      const good = perm.filter((v, i) => v === i).length;
      note.textContent = s.phase !== 'open' ? '' : me === null ? '観戦中（元の絵を見ています）' : s.solved[me] !== null || loc.sent ? `そろった！（${s.solved[me] !== null ? secText(s.solved[me]) : '送っています…'}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています' : `正しい場所のかけら ${good} / ${N * N}` + (loc.sel >= 0 ? '・入れ替える相手を押してください' : '');
    };
    const finish = () => {
      if (loc.sent || !playing || !isDone(loc.perm)) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      grid.classList.remove('live');
      grid.classList.add('whole');
      o.onMove({ t: 'done', q: s.q, swaps: loc.swaps.slice(0, MAX_SWAPS), ms });
    };
    const hit = (i) => {
      if (!playing || loc.sent) return;
      if (loc.sel < 0) loc.sel = i;
      else if (loc.sel === i) loc.sel = -1;
      else {
        const a = loc.sel;
        [loc.perm[a], loc.perm[i]] = [loc.perm[i], loc.perm[a]];
        loc.swaps.push([a, i]);
        loc.sel = -1;
      }
      paint();
      finish();
      if (loc.sent) paint();
    };
    for (let i = 0; i < N * N; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jg-tile';
      b.setAttribute('aria-label', `${i + 1}番目のかけら`);
      b.disabled = !playing;
      b.onpointerdown = (e) => { if (e.button !== 0) return; e.preventDefault(); hit(i); }; // 押した瞬間に入れ替える
      b.onclick = (e) => { e.preventDefault(); if (e.detail === 0) hit(i); }; // キーボードで押したとき
      tiles.push(b);
      grid.append(b);
    }
    paint();
    wrap.append(grid, note);
    if (playing) {
      const row = document.createElement('div');
      row.className = 'tg-btns';
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
      row.append(pass);
      wrap.append(row);
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
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
