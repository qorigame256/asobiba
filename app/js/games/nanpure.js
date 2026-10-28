// ナンプレ早解き。全員に同じナンプレ（ナンバープレース）を1問出し、早く解いた順に順位を付ける。「数独」はニコリの登録商標なので使わない。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   名前は「ナンプレ早解き」。1問で早く解いた順に順位。大きさは 9×9（最初）・6×6（短い版）。
//   まちがえた数字を入れても知らせず、全部埋まって正しいときに完成。ほかの人が何マス埋めたかは割合で見える。
// Claude の判断:
//   - 問題は tools/make-nanpure.mjs が前もって作って nanpure-data.js に書き出したもの（答えが1つだけになる問題。画面で作ると時間がかかるため）。
//     9×9 は最初から34マス、6×6 は14マス埋まっている。
//   - 制限時間は 9×9 が20分、6×6 が8分。全員が解くかあきらめたら1.5秒で締め切る。解けなかった人は同じ最下位。
//   - 送るのは解いた盤（数字の文字列）。apply で答えと同じかを確かめる。進み具合は見た目だけ送りっぱなし（o.stream）。
//   - 同じ数字・選んだマスの段と列と枠を薄く光らせる（まちがいの場所は光らせない）。PC は数字キー・矢印キー・Backspace でも入れられる。
// 2026-10-28 の29回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 「まちがいの知らせ」（鍵は hint。なし（最初）・あり）: 答えとちがう数字を入れたら赤く出す（たて・よこのぶつかりではなく、答えとちがうか）。
//     手伝いの好みなので、待合室のおまかせでは抽選しない（main.js の KEEP_KEYS の hint）。
//   - 「問題の数」（鍵は rounds。1問（最初）・3問）: 3問は 6×6 のときだけ（9×9 は1問で10分以上かかるため、9×9 では1問のまま）。
//     全員に同じ3問を同じ順で出し、各自が解いたらすぐ次の問題へ進む（ほかの人を待たない）。3問ぜんぶ解くまでの時間で順位。制限時間は15分。
//     1問のときの局面の形と問題の選び方は前と同じ（3問のときも puzzle・answer は1問目）。
// 進行: ready →（3秒）open →（全員済み1.5秒 / 制限時間）end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', grid, ms, k?（3問のとき何問目か。0 から） } / { p, t: 'pass' }

import { mulberry32, shuffle } from './util.js';
import { NANPURE } from './nanpure-data.js';
import { since, scoreChips, timeBar, secText } from './party.js';

const READY_MS = 3000;
const GRACE_MS = 1500;
export const SHAPES = { 9: { n: 9, br: 3, bc: 3, givens: 34 }, 6: { n: 6, br: 2, bc: 3, givens: 14 } };

/* ---------- 作る・解く（画面に依存しない。tools/make-nanpure.mjs と自動確認も使う） ---------- */

const peersCache = {};
function peersOf(sh) {
  if (peersCache[sh.n]) return peersCache[sh.n];
  const { n, br, bc } = sh;
  const out = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n), c = i % n, set = new Set();
    for (let k = 0; k < n; k++) { set.add(r * n + k); set.add(k * n + c); }
    const r0 = r - (r % br), c0 = c - (c % bc);
    for (let y = 0; y < br; y++) for (let x = 0; x < bc; x++) set.add((r0 + y) * n + c0 + x);
    set.delete(i);
    out.push([...set]);
  }
  return (peersCache[n] = out);
}
// 解の数を limit まで数える（g は 0 が空き。書き換えずに使う）。rnd を渡すと最初の解を無作為な順で探し、first に入れる
export function countSolutions(g0, sh, limit = 2, rnd = null, first = null) {
  const g = g0.slice();
  const peers = peersOf(sh);
  let count = 0;
  const rec = () => {
    let best = -1, bestOpts = null;
    for (let i = 0; i < g.length; i++) {
      if (g[i]) continue;
      const used = new Set(peers[i].map((j) => g[j]));
      const opts = [];
      for (let v = 1; v <= sh.n; v++) if (!used.has(v)) opts.push(v);
      if (!opts.length) return;
      if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; if (opts.length === 1) break; }
    }
    if (best < 0) { count++; if (first && count === 1) first.push(...g); return; }
    for (const v of rnd ? shuffle(bestOpts, rnd) : bestOpts) {
      g[best] = v;
      rec();
      if (count >= limit) return;
    }
    g[best] = 0;
  };
  rec();
  return count;
}
// 種から1問作る。{ puzzle, answer }（どちらも数字の並び。puzzle の 0 が空き）
export function makePuzzle(size, seed) {
  const sh = SHAPES[size];
  const rnd = mulberry32(seed);
  const answer = [];
  countSolutions(Array(sh.n * sh.n).fill(0), sh, 1, rnd, answer);
  const g = answer.slice();
  let left = g.length;
  for (const i of shuffle([...g.keys()], rnd)) {
    if (left <= sh.givens) break;
    const keep = g[i];
    g[i] = 0;
    if (countSolutions(g, sh, 2) === 1) left--;
    else g[i] = keep;
  }
  return { puzzle: g, answer };
}
// nanpure-data.js の1行（「9:問題:答え」）
export const PUZZLES = NANPURE.trim().split(/\s+/).map((row) => {
  const [n, p, a] = row.split(':');
  return { size: Number(n), puzzle: [...p].map(Number), answer: [...a].map(Number) };
});

const sizeOf = (r) => (Number(r.size) === 6 ? 6 : 9);
const countOf = (s) => s.qs?.length ?? 1;
const limitOf = (s) => (s.size === 6 ? (countOf(s) > 1 ? 15 : 8) : 20) * 60000;
const KEY = (s) => `nanpure:${s.seed}`;
const clone = (s) => ({ ...s, solved: s.solved.slice(), passed: s.passed.slice(), ...(s.qs ? { prog: s.prog.slice() } : {}) });
const progOf = (s, p) => (s.qs ? s.prog[p] : s.solved[p] !== null ? 1 : 0); // 解いた問題の数
const qOf = (s, k) => (s.qs ? s.qs[k] : s); // k 問目の { puzzle, answer }
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
// 順位（1 から）。解いた人は速い順、解けなかった人は全員同じ最下位
export function placesOf(solved) {
  const ok = solved.filter((v) => v !== null);
  return solved.map((v) => (v === null ? ok.length + 1 : 1 + ok.filter((x) => x < v).length));
}

let loc = null; // { key, cells, sel, sent }
let ui = null;
const progress = new Map(); // 席 → 埋めたマスの数（見た目だけ）
const cpuPlan = new Map();
let keysBound = false;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (!ui?.press || !ui.wrap.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    if (ui.press(e.key)) e.preventDefault();
  });
}

export default {
  id: 'nanpure',
  name: 'ナンプレ早解き',
  icon: '🧮',
  desc: 'たて・よこ・枠に同じ数字が入らないように埋める。早く解いた人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '大きさ', desc: '9×9 は1問10分前後。6×6 は数分で解ける短い版', def: '9', choices: [['9', '9×9'], ['6', '6×6（短い版）']] },
    { key: 'rounds', label: '問題の数', desc: '3問は 6×6 のときだけ。続けて解き、3問ぜんぶ解くまでの時間で順位', def: 1, choices: [[1, '1問'], [3, '3問（6×6 のとき）']] },
    { key: 'hint', label: 'まちがいの知らせ', desc: '答えとちがう数字を入れたら赤く出す', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: '9', ...rules };
    const size = sizeOf(r);
    const pool = PUZZLES.filter((x) => x.size === size);
    const base = { n, seed, rules: r, size, phase: 'ready', solved: Array(n).fill(null), passed: Array(n).fill(false), step: 0 };
    if (size === 6 && Number(r.rounds) === 3) {
      const qs = shuffle(pool, mulberry32(seed)).slice(0, 3).map((x) => ({ puzzle: x.puzzle, answer: x.answer }));
      return { ...base, puzzle: qs[0].puzzle, answer: qs[0].answer, qs, prog: Array(n).fill(0) };
    }
    const pz = pool[mulberry32(seed)() * pool.length | 0];
    return { ...base, puzzle: pz.puzzle, answer: pz.answer };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) {
    if (s.phase !== 'end') return null;
    const place = placesOf(s.solved);
    const any = s.solved.some((v) => v !== null);
    return { winners: any ? place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0) : [], place, times: s.solved, draw: !any };
  },
  sound(a, b, m, me) { return m.p === me && m.t === 'done' ? 'correct' : m.p === -1 && m.t === 'next' ? 'question' : 'pop'; },
  resultText(res, me, pn) {
    if (!res.winners.length) return 'だれも解けませんでした';
    const who = res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・');
    return `${who}がいちばん速く解いた！${res.winners.includes(me) ? '🎉' : ''}（${secText(res.times[res.winners[0]])}）`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : `${s.size}×${s.size}`; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all', ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open', ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && s0.phase === 'ready') return { ...clone(s0), phase: 'open', step: s0.step + 1 };
      if (m.t === 'close' && s0.phase === 'open') return { ...clone(s0), phase: 'end', step: s0.step + 1 };
      return null;
    }
    if (s0.phase !== 'open' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (m.t === 'pass') { const s = clone(s0); s.step += 1; s.passed[m.p] = true; return s; }
    if (m.t !== 'done' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    const k = progOf(s0, m.p);
    if ((m.k ?? 0) !== k || m.grid !== qOf(s0, k).answer.join('')) return null;
    const s = clone(s0);
    s.step += 1;
    if (s.qs) { s.prog[m.p] += 1; if (s.prog[m.p] < s.qs.length) return s; }
    s.solved[m.p] = Math.round(m.ms);
    return s;
  },

  // CPU: 9×9 は6割・6×6 は7割の確率で、制限時間の35〜85%のころに解く。解かないときは同じころにあきらめる
  cpuDelay() { return 1000; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = KEY(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: limitOf(s) * (0.35 + Math.random() * 0.5), ok: Math.random() < (s.size === 6 ? 0.7 : 0.6), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 100) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(KEY(s));
    const k = progOf(s, p), cnt = countOf(s);
    // 3問のときは、決めたころまでに等しい間を空けて1問ずつ解く（あきらめるときは決めたころに）
    if (plan.done || t < (plan.ok ? (plan.at * (k + 1)) / cnt : plan.at)) return null;
    if (!plan.ok) { plan.done = true; return { t: 'pass' }; }
    if (k + 1 >= cnt) plan.done = true;
    return { t: 'done', grid: qOf(s, k).answer.join(''), ms: Math.round(t), ...(s.qs ? { k } : {}) };
  },

  onStream(d, from) { if (d && Number.isInteger(d.f)) { progress.set(from, d.f); if (ui?.refresh) ui.refresh(); } },

  render(root, s, o) {
    bindKeys();
    const s0 = s;
    const me = o.me >= 0 ? o.me : null;
    const sh = SHAPES[s.size];
    const N = sh.n;
    const key = KEY(s);
    const blanks = s.puzzle.filter((v) => !v).length; // 1問ぶん（同じ大きさならどの問題も同じ）
    const cnt = countOf(s);
    const res = this.result(s);
    const chipsOf = () => {
      const s = ui?.s ?? s0;
      const res = this.result(s);
      const extra = (p) => {
        if (res) return s.solved[p] !== null ? `<span class="pt-ok">${res.place[p]}位 ${secText(s.solved[p])}</span>` : '<span class="pt-ng">―</span>';
        if (s.solved[p] !== null) return `<span class="pt-ok">解いた！ ${secText(s.solved[p])}</span>`;
        if (s.passed[p]) return '<span class="pt-ng">あきらめ</span>';
        const done = cnt > 1 ? `${progOf(s, p)}/${cnt}問` : '';
        if (p === me || !progress.has(p)) return done ? `<span>${done}</span>` : '';
        return `<span>${done ? done + ' ' : ''}${Math.floor((Math.max(0, progress.get(p) - progOf(s, p) * blanks) / blanks) * 100)}%</span>`;
      };
      const c = scoreChips(o, s.solved.map(() => 0), { won: res?.winners ?? [], extra });
      c.querySelectorAll('.pt-score').forEach((x) => x.remove());
      return c;
    };
    const mine = me !== null ? Math.min(progOf(s, me), cnt - 1) : 0; // この端末が解いている問題
    const mount = `${s.seed}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${mine}`;
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.s = s; ui.refresh(); return; }

    root.innerHTML = '';
    root.className = 'board kj np';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, s };
    let chips = chipsOf();
    Object.assign(ui, { refresh: () => { const c = chipsOf(); chips.replaceWith(c); chips = c; } });
    wrap.append(chips);
    root.append(wrap);
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      progress.clear();
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${N}×${N}${cnt > 1 ? `・${cnt}問続けて` : ''}・${limitOf(s) / 60000}分まで。たて・よこ・太い枠のどれにも 1〜${N} が1つずつ入るように埋める</div>`;
      return;
    }
    if (s.phase === 'open') {
      since(key);
      if (cnt > 1) card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${mine + 1}問 / ${cnt}</div>`);
      card.append(timeBar(key, limitOf(s), { secs: true }));
    } else card.innerHTML = `<div class="kj-sub">答え${cnt > 1 ? `（第${mine + 1}問）` : ''}</div>`;

    const q = qOf(s, mine);
    const lkey = key + ':' + mine;
    if (loc?.key !== lkey) loc = { key: lkey, cells: q.puzzle.slice(), sel: -1, sent: false };
    const playing = s.phase === 'open' && me !== null && !doneOf(s, me) && !loc.sent;
    const showCells = s.phase === 'end' ? q.answer : me === null ? q.puzzle : loc.cells;
    const grid = document.createElement('div');
    grid.className = 'np-grid';
    grid.style.setProperty('--n', N);
    const note = document.createElement('p');
    note.className = 'cc-log';
    const tiles = [];
    const draw = () => {
      const sel = loc.sel;
      const sv = sel >= 0 ? showCells[sel] : 0;
      const sr = Math.floor(sel / N), sc = sel % N;
      tiles.forEach((t, i) => {
        const r = Math.floor(i / N), c = i % N;
        const v = showCells[i];
        t.textContent = v || '';
        const same = sel >= 0 && (r === sr || c === sc || (Math.floor(r / sh.br) === Math.floor(sr / sh.br) && Math.floor(c / sh.bc) === Math.floor(sc / sh.bc)));
        t.className = 'np-cell' + (q.puzzle[i] ? ' given' : '') + (i === sel ? ' sel' : same ? ' near' : '') + (v && v === sv && i !== sel ? ' same' : '')
          + (s.rules.hint && s.phase === 'open' && me !== null && v && !q.puzzle[i] && v !== q.answer[i] ? ' bad' : '')
          + (c % sh.bc === sh.bc - 1 && c < N - 1 ? ' br' : '') + (r % sh.br === sh.br - 1 && r < N - 1 ? ' bb' : '');
      });
      const filled = loc.cells.filter((v, i) => v && !q.puzzle[i]).length;
      if (s.phase !== 'open') note.textContent = '';
      else if (me === null) note.textContent = '観戦中';
      else if (s.solved[me] !== null) note.textContent = `解けた！（${secText(s.solved[me])}）ほかの人を待っています`;
      else if (s.passed[me]) note.textContent = 'あきらめました。ほかの人を待っています';
      else if (filled === blanks) note.textContent = s.rules.hint ? '全部埋まったけれど、赤い数字がちがいます' : '全部埋まったけれど、どこかがちがいます（まちがいの場所は教えません）';
      else note.textContent = `マスを選んで下の数字を押す（${filled} / ${blanks}マス）`;
    };
    for (let i = 0; i < N * N; i++) {
      const t = document.createElement('button');
      t.type = 'button';
      t.disabled = !playing;
      t.onclick = () => { loc.sel = i; draw(); };
      tiles.push(t);
      grid.append(t);
    }
    let lastSend = -1e9;
    const put = (v) => {
      if (!playing || loc.sent || loc.sel < 0 || q.puzzle[loc.sel]) return;
      loc.cells[loc.sel] = v;
      const filled = loc.cells.filter((x, i) => x && !q.puzzle[i]).length;
      const now = performance.now();
      if (o.stream && (now - lastSend > 400 || filled === blanks)) { lastSend = now; o.stream({ f: mine * blanks + filled }); }
      draw();
      if (loc.cells.join('') === q.answer.join('')) {
        const ms = Math.round(since(key));
        if (ms < limitOf(s)) { loc.sent = true; o.onMove({ t: 'done', grid: loc.cells.join(''), ms, ...(s.qs ? { k: mine } : {}) }); }
      }
    };
    wrap.append(grid, note);
    if (playing) {
      const pad = document.createElement('div');
      pad.className = 'np-pad';
      pad.style.setProperty('--n', N + 1);
      for (let v = 1; v <= N; v++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary np-key';
        b.textContent = v;
        b.onclick = () => put(v);
        pad.append(b);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn ghost np-key';
      del.textContent = '⌫';
      del.setAttribute('aria-label', '消す');
      del.onclick = () => put(0);
      pad.append(del);
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる';
      pass.onclick = () => { if (confirm('あきらめますか？（このあとは解けません）')) { pass.disabled = true; o.onMove({ t: 'pass' }); } };
      wrap.append(pad, pass);
      ui.press = (k) => {
        const MOV = { ArrowUp: -N, ArrowDown: N, ArrowLeft: -1, ArrowRight: 1 };
        if (MOV[k] !== undefined) { loc.sel = loc.sel < 0 ? 0 : Math.max(0, Math.min(N * N - 1, loc.sel + MOV[k])); draw(); return true; }
        if (/^[1-9]$/.test(k) && Number(k) <= N) { put(Number(k)); return true; }
        if (k === 'Backspace' || k === 'Delete' || k === '0') { put(0); return true; }
        return false;
      };
    } else ui.press = null;
    draw();
  },
};
