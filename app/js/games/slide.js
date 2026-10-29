// 15パズル早解き。全員に同じ並びのスライドパズルを出し、早くそろえた人ほど高い点。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   4×4（1〜15）を全員に同じ並びで3問。早くそろえた順に 3点・2点・それ以降は1点。詳細設定で 3×3（かんたん）と、混ぜ方の強さ（最初は軽め）。
// Claude の判断:
//   - 混ぜ方はそろった形から空きマスを無作為に動かす回数（戻る動きはしない）。軽め: 4×4 は40回・3×3 は20回、しっかり: 150回・60回。
//   - 送るのはそろえるまでの空きマスの動き（U・D・L・R の文字列）。apply で最初の並びから動かし直し、本当にそろうかを確かめる。
//   - 同じ列・同じ段の札を押すと、空きマスまでの札をまとめて動かす（動きは1マスずつ数える）。PC は矢印キーでも動かせる。
//   - 制限時間は 3×3 が90秒、4×4 は軽め180秒・しっかり300秒。最初にそろった人から20秒で締め切る（制限時間のほうが先なら制限時間で）。全員そろうかあきらめたら1.5秒。
//   - 問題の数は 1・3（最初）・5問。
//   - 5×5（1〜24。2026-10-29 本人が選んだ案）: 混ぜる回数は軽め70回・しっかり250回、制限時間は軽め300秒・しっかり480秒。
//     CPU がそろえる割合は4×4 より1割低い。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（10を作れと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, seq, ms } / { p, t: 'pass', q }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
const ROUNDS = [[1, '1問'], [3, '3問'], [5, '5問']];
const STEP = { U: -1, D: 1, L: 0, R: 0 }; // 段の動き（列の動きは下の dx）
const DX = { U: 0, D: 0, L: -1, R: 1 };
const BACK = { U: 'D', D: 'U', L: 'R', R: 'L' };

const sizeOf = (r) => ([3, 5].includes(Number(r.size)) ? Number(r.size) : 4);
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 3);
const LIMITS = { 3: [90000, 90000], 4: [180000, 300000], 5: [300000, 480000] }; // 大きさごとの [軽め, しっかり]
const MOVES = { 3: [20, 60], 4: [40, 150], 5: [70, 250] };
const full = (s) => (s.rules.level === 'full' ? 1 : 0);
const limitOf = (s) => LIMITS[s.size][full(s)];
const qKey = (s, q = s.q) => `slide:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
export const solvedBoard = (n) => [...Array(n * n - 1).keys()].map((i) => i + 1).concat(0);
export const isSolved = (b) => b.every((v, i) => v === (i === b.length - 1 ? 0 : i + 1));

// 空きマスを dir に動かす（となりの札が空きへ入る）。動けなければ null
export function moveBlank(b, n, dir) {
  const i = b.indexOf(0);
  const r = Math.floor(i / n) + STEP[dir], c = (i % n) + DX[dir];
  if (r < 0 || r >= n || c < 0 || c >= n) return null;
  const j = r * n + c;
  const out = b.slice();
  [out[i], out[j]] = [out[j], 0];
  return out;
}
// 動きの文字列をまとめて当てる。途中で動けない・文字がちがうなら null
export function replay(b, n, seq) {
  if (typeof seq !== 'string' || seq.length > 5000 || !/^[UDLR]*$/.test(seq)) return null;
  let cur = b;
  for (const d of seq) { cur = moveBlank(cur, n, d); if (!cur) return null; }
  return cur;
}
// 混ぜる。返り値 { board, path }（path は混ぜた動き。逆にたどればそろう）
export function scramble(n, moves, rnd) {
  for (;;) {
    let b = solvedBoard(n);
    let path = '';
    while (path.length < moves) {
      const opts = 'UDLR'.split('').filter((d) => d !== BACK[path.at(-1)] && moveBlank(b, n, d));
      const d = opts[Math.floor(rnd() * opts.length)];
      b = moveBlank(b, n, d);
      path += d;
    }
    if (!isSolved(b)) return { board: b, path };
  }
}
export const undoPath = (path) => [...path].reverse().map((d) => BACK[d]).join('');

let loc = null; // この端末で動かしている盤 { key, board, seq, sent }
let ui = null;
const cpuPlan = new Map();
let keysBound = false;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  // 矢印の向きへ札が動く（空きマスは逆へ動く）
  const KEY = { ArrowUp: 'D', ArrowDown: 'U', ArrowLeft: 'R', ArrowRight: 'L' };
  document.addEventListener('keydown', (e) => {
    if (!KEY[e.key] || !ui?.press || !ui.wrap.isConnected || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    ui.press(KEY[e.key]);
  });
}

export default {
  id: 'slide',
  name: '15パズル早解き',
  icon: '🧩',
  desc: '札をすべらせて 1〜15 を順に並べる。早くそろえるほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '大きさ', desc: '3×3 は 1〜8 でかんたん、5×5 は 1〜24 で上級者向け', def: '4', choices: [['4', '4×4（15パズル）'], ['3', '3×3（8パズル）'], ['5', '5×5（24パズル）']] },
    { key: 'level', label: '混ぜ方', desc: 'しっかり混ぜると時間がかかる', def: 'light', choices: [['light', '軽め'], ['full', 'しっかり']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 3, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: '4', level: 'light', rounds: 3, ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const moves = MOVES[size][r.level === 'full' ? 1 : 0];
    const qs = Array.from({ length: roundsOf(r) }, () => scramble(size, moves, rnd));
    return {
      n, seed, rules: r, size, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
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
    const end = replay(s0.qs[s0.q].board, s0.size, m.seq);
    if (!end || !isSolved(end)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  // CPU: 軽めは6割・しっかりは4割の問題を、制限時間の2〜7割のころにそろえる（混ぜた動きを逆にたどる）。そろえない問題は同じころにあきらめる
  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const lim = s.size === 3 ? 90000 : limitOf(s);
      plan = { at: lim * (0.2 + Math.random() * 0.5), ok: Math.random() < (s.rules.level === 'full' ? 0.4 : 0.6) - (s.size === 5 ? 0.1 : 0), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'done', q: s.q, seq: undoPath(s.qs[s.q].path), ms: Math.round(t) };
  },

  render(root, s, o) {
    bindKeys();
    const me = o.me >= 0 ? o.me : null;
    // だれかがそろえた（締め切りの表示が変わる）・動かせるかが変わったときも作り直す（動かしかけの盤は loc に残る）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${s.solved.some((v) => v !== null)}:${!!o.canMove}`;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">そろった！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; return; }

    root.innerHTML = '';
    root.className = 'board kj sl';
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}×${s.size}・全${s.qs.length}問・1問 ${limitOf(s) / 1000}秒まで</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      // だれかがそろえたら、ホストが締め切るまでの20秒（制限時間のほうが先ならそちら）を出す（前は締め切られるまで「残り130秒」などのままだった。2026-10-28 Codex の点検の指摘）
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかがそろえた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    }
    else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれもそろえられませんでした';
      card.append(t);
    }

    const n = s.size;
    const start = s.qs[s.q].board;
    if (loc?.key !== key) loc = { key, board: start.slice(), seq: '', sent: false };
    // o.canMove も見る: 観戦の人がほかの人の画面を選ぶと me にその席が来るので、見ているだけで動かせて「送った」が残り、
    // あとでその席に入るとそろえても送れなかった（2026-10-28 Codex の点検の指摘）
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const grid = document.createElement('div');
    grid.className = 'sl-grid';
    grid.style.setProperty('--n', n);
    const note = document.createElement('p');
    note.className = 'cc-log';
    const draw = () => {
      grid.innerHTML = '';
      const b = s.phase === 'open' && me !== null ? loc.board : solvedBoard(n);
      b.forEach((v, i) => {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'sl-tile' + (v === 0 ? ' blank' : '') + (v !== 0 && v === i + 1 ? ' ok' : '');
        t.textContent = v || '';
        t.disabled = !playing || v === 0;
        t.onclick = () => slideTo(i);
        grid.append(t);
      });
      note.textContent = s.phase !== 'open' ? '' : me === null ? '観戦中' : s.solved[me] !== null ? `そろった！（${secText(s.solved[me])}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています' : `動かした回数 ${loc.seq.length}`;
    };
    const step = (d) => {
      if (!playing || loc.sent) return false;
      const nb = moveBlank(loc.board, n, d);
      if (!nb) return false;
      loc.board = nb;
      loc.seq += d;
      return true;
    };
    const finish = () => {
      if (!isSolved(loc.board) || loc.sent) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      o.onMove({ t: 'done', q: s.q, seq: loc.seq, ms });
    };
    // 同じ段・同じ列の札を押したら、空きマスまでまとめて動かす
    const slideTo = (i) => {
      const z = loc.board.indexOf(0);
      const [zr, zc, r, c] = [Math.floor(z / n), z % n, Math.floor(i / n), i % n];
      if (zr !== r && zc !== c) return;
      const d = zr === r ? (c > zc ? 'R' : 'L') : r > zr ? 'D' : 'U';
      for (let k = Math.abs(c - zc) + Math.abs(r - zr); k > 0; k--) step(d);
      draw();
      finish();
    };
    ui.press = (d) => { if (step(d)) { draw(); finish(); } };
    draw();
    wrap.append(grid, note);
    if (playing) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
      wrap.append(pass);
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
