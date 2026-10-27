// 10を作れ（テンパズル）。全員に同じ4つの数字（1〜9）が出て、＋−×÷とかっこで4つを1回ずつ使って10を作る。
// 2026-10-27 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の問いに本人が答えた）:
//   答え方は画面のボタンで式を組む（数字のボタンは1回ずつしか押せない）。点と進め方は難読漢字と同じ
//   （正解した人は速い順に 3点・2点・それ以降は1点、パスあり、10問・1問60秒。答えがある組だけ出す）。
// Claude の判断:
//   - 送るのは正しい式だけ（まちがった式は自分の画面で「10になりません」と出すだけ）。apply でも式を計算し直し、4つを1回ずつ使って10かを確かめる。
//   - 割り算の途中は分数のまま正しく計算する（8÷3 などもよい。1・1・9・9 は (1＋1÷9)×9）。数字をつなげて 12 のようにはできない。−を数の前に付ける（−3）のもなし。
//   - 誰かが正解したら10秒待って締め切る（難読漢字は5秒。式を組むのは読みを打つより時間がかかるため）。全員が正解かパスなら1.5秒で締め切る。
//   - 詳細設定「難しさ」: ふつう（解き方が多い組）・むずかしい（解き方が少ない組）・ぜんぶまぜる。解き方の数は SOLVE で数えた式の数（同じ形の言い換えも数えるので目安）。
//   - 答えを見せる場面と、終わったあとのふりかえりで「答えの例」を出す。
// 進行は難読漢字と同じ（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（正解が出たら10秒 / 全員済み1.5秒 / 制限時間）→ close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'try', q: 問題番号, text: 式（数字と + - * / ( ) だけ）, ms } / { p, t: 'pass', q }

import { mulberry32, shuffle, esc } from './util.js';
import { MAKE10 } from './make10-data.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';

const ROUNDS = [[5, '5問'], [10, '10問'], [15, '15問']];
const READY_MS = 3000;
const SHOWN_MS = 4500;
const GRACE_MS = 1500;
const AFTER_MS = 10000; // 誰かが正解してから締め切るまで
const PTS = [3, 2]; // 速い順の点。それより後ろは1点
const LEVELS = { easy: 'ふつう', hard: 'むずかしい', mix: 'ぜんぶまぜる' };
const CPU_RATE = { easy: 0.55, hard: 0.3, mix: 0.45 };
const HARD_MAX = 12; // 解き方（SOLVE で数えた式）がこれ以下の組を「むずかしい」にする
const GOAL = 10;

/* ---------- 計算（画面に依存しない） ---------- */

const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const frac = (n, d) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; };
const OPS = {
  '+': ([a, b], [c, d]) => frac(a * d + c * b, b * d),
  '-': ([a, b], [c, d]) => frac(a * d - c * b, b * d),
  '*': ([a, b], [c, d]) => frac(a * c, b * d),
  '/': ([a, b], [c, d]) => (c === 0 ? null : frac(a * d, b * c)),
};

// 4つの数字で10になる式を全部（同じ式の文字は1つに）。式は外側にもかっこを付けた形（例: ((1+3)*(6-4))）
export function solveAll(nums) {
  const out = new Set();
  const rec = (items) => {
    if (items.length === 1) {
      if (items[0].v[0] === GOAL && items[0].v[1] === 1) out.add(items[0].e);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const rest = items.filter((_, k) => k !== i && k !== j);
        for (const op of Object.keys(OPS)) {
          if ((op === '+' || op === '*') && j < i) continue; // 入れかえても同じ
          const v = OPS[op](items[i].v, items[j].v);
          if (v) rec([...rest, { v, e: `(${items[i].e}${op}${items[j].e})` }]);
        }
      }
    }
  };
  rec(nums.map((n) => ({ v: [n, 1], e: String(n) })));
  return [...out];
}

// 答えのある組（1〜9 の4つ。小さい順）と、その解き方の数・答えの例を作る。PC でも0.5秒ほどかかるので画面では計算せず、
// tools/make-make10.mjs が前もって make10-data.js に書き出したものを使う（tools/test-logic.mjs が、書き出したものと計算し直したものが同じかを見ている）
export function buildPuzzles() {
  const list = [];
  for (let a = 1; a <= 9; a++) for (let b = a; b <= 9; b++) for (let c = b; c <= 9; c++) for (let d = c; d <= 9; d++) {
    const sols = solveAll([a, b, c, d]);
    if (!sols.length) continue;
    // 答えの例は、かっこを外して短くなった式のうち一番短いもの（同じ長さなら文字の順）。全部を短くすると読み込みが遅いので最初の30個から
    const ex = sols.slice(0, 30).map(trim).sort((x, y) => x.length - y.length || (x < y ? -1 : 1))[0];
    list.push({ nums: [a, b, c, d], count: sols.length, ex });
  }
  return list;
}
// make10-data.js の1行（「1199:1:9*(1+1/9)」）を { nums, count, ex } に
export const PUZZLES = MAKE10.trim().split(/\s+/).map((row) => {
  const [d, c, ex] = row.split(':');
  return { nums: [...d].map(Number), count: Number(c), ex };
});

// 要らないかっこを外す（答えの例を見せるときだけ）。外しても使う数字は同じなので、10のままなら正しい答えのまま
function trim(e) {
  let s = e;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== '(') continue;
      let depth = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
      const t = s.slice(0, i) + s.slice(i + 1, j) + s.slice(j + 1);
      const b = evalExpr(t);
      if (b && b.v[0] === GOAL && b.v[1] === 1) { s = t; changed = true; break; }
    }
  }
  return s;
}

// 式（数字1けたと + - * / ( ) だけ）を計算する。文法が違う・0で割る は null。
// 返り値 { v: [分子, 分母], nums: 使った数字（小さい順） }
export function evalExpr(text) {
  if (typeof text !== 'string' || text.length > 40 || !/^[1-9+\-*/()]+$/.test(text)) return null;
  let i = 0;
  const nums = [];
  const factor = () => {
    const c = text[i];
    if (c === '(') {
      i++;
      const v = expr();
      if (!v || text[i] !== ')') return null;
      i++;
      return v;
    }
    if (c >= '1' && c <= '9') { i++; nums.push(Number(c)); return [Number(c), 1]; }
    return null;
  };
  const chain = (next, ops) => {
    let v = next();
    if (!v) return null;
    while (ops.includes(text[i])) {
      const op = text[i++];
      const w = next();
      if (!w) return null;
      const r = OPS[op](v, w);
      if (!r) return null;
      v = r;
    }
    return v;
  };
  const term = () => chain(factor, '*/');
  const expr = () => chain(term, '+-');
  const v = expr();
  if (!v || i !== text.length) return null;
  return { v, nums: nums.sort((a, b) => a - b) };
}

// 式がその問題の正解か（4つの数字をちょうど1回ずつ使って10）
export function isRight(nums, text) {
  const r = evalExpr(text);
  if (!r || r.v[0] !== GOAL || r.v[1] !== 1) return false;
  const want = nums.slice().sort((a, b) => a - b);
  return r.nums.length === 4 && r.nums.every((n, k) => n === want[k]);
}

export const poolOf = (level) => (level === 'hard' ? PUZZLES.filter((p) => p.count <= HARD_MAX) : level === 'mix' ? PUZZLES : PUZZLES.filter((p) => p.count > HARD_MAX));
// 見せる形（* → ×、/ → ÷、- → −）
export const pretty = (text) => String(text).replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

const limitOf = (s) => Number(s.rules.time) * 1000;
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const qKey = (s, q = s.q) => `make10:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), said: s.said.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
// 締め切りのとき、正解した人の点（速い順に PTS、それより後ろは1点。同じ速さは同じ点）
export function pointsOf(solved) {
  return solved.map((v) => {
    if (v === null) return 0;
    const rank = solved.filter((x) => x !== null && x < v).length;
    return PTS[rank] ?? 1;
  });
}

/* ---------- 画面 ---------- */

// 式を組んでいる途中に描き直しが来ても作り直さない（組みかけの式が消えないように）
let ui = null; // { mount, wrap, chips, note, toks, draw, submit, key }
const cpuPlan = new Map();

// PC のキーボードでも組めるように（数字・+ - * / ( )・Backspace・Enter）。入力欄を打っているときは使わない
let keysBound = false;
function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  document.addEventListener('keydown', (e) => {
    if (!ui?.press || !ui.wrap.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable) return;
    const k = e.key === 'x' || e.key === 'X' ? '*' : e.key;
    if (ui.press(k)) e.preventDefault();
  });
}

export default {
  id: 'make10',
  name: '10を作れ',
  icon: '🔟',
  desc: '4つの数字と ＋−×÷ で10を作る。早く作るほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '難しさ', desc: 'ふつうは解き方が多い組、むずかしいは解き方が少ない組（1・1・9・9 など）', def: 'easy', choices: Object.entries(LEVELS) },
    { key: 'time', label: '制限時間', desc: '1問あたりの時間', def: '60', choices: [['30', '30秒'], ['60', '60秒'], ['90', '90秒']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'easy', time: '60', rounds: 10, ...rules };
    const rnd = mulberry32(seed);
    // 数字の並びも種からまぜる（小さい順のままだと答えが見えやすい）
    const qs = shuffle(poolOf(r.level), rnd).slice(0, roundsOf(r)).map((p) => ({ nums: shuffle(p.nums, rnd), ex: p.ex }));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), said: Array(n).fill(''), passed: Array(n).fill(false), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : b.last.winners.includes(me) ? 'correct' : 'pop';
    if (m.t === 'pass') return m.p === me ? 'pop' : null;
    return m.p === me ? 'correct' : 'pop';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${s.qs.length}`;
    return `第${s.q + 1}問の答え`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: AFTER_MS, move: { t: 'close' } };
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
        s.said = Array(s.n).fill('');
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
        s.last = { winners, best, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners }]; // ふりかえり用
        return s;
      }
      return null;
    }
    if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (m.t === 'pass') {
      const s = clone(s0);
      s.step += 1;
      s.passed[m.p] = true;
      return s;
    }
    if (m.t !== 'try' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    if (!isRight(s0.qs[s0.q].nums, m.text)) return null; // 送るのは正しい式だけ（改造した端末から来たものもここで弾く）
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = m.ms;
    s.said[m.p] = m.text;
    return s;
  },

  // CPU: 難しさに応じた確率で、8秒〜制限時間の7割のあいだに答えの例で正解する。正解しない問題は同じころにパスする
  cpuDelay(s) { return s.phase === 'open' ? 250 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 8000 + Math.random() * Math.max(0, limitOf(s) * 0.7 - 8000), ok: Math.random() < (CPU_RATE[s.rules.level] ?? 0.45), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'try', q: s.q, text: s.qs[s.q].ex, ms: Math.round(t) };
  },

  render(root, s, o) {
    bindKeys();
    const me = o.me >= 0 ? o.me : null;
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}`;
    const shown = s.phase === 'shown' || s.phase === 'end';
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">正解！</span>' : s.passed[p] ? '<span class="pt-ng">パス</span>' : '';
      if (!shown || !s.last || s.q < 0) return '';
      const got = s.last.pts[p];
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])}${got ? ` +${got}` : ''}</span>`;
      return s.passed[p] ? '<span class="pt-ng">パス</span>' : '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });

    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      this.note(s, me);
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj mk';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips };
    wrap.append(chips);
    if (s.phase === 'end') {
      wrap.append(this.review(s, me, o));
      root.append(wrap);
      return;
    }

    const card = document.createElement('div');
    card.className = 'kj-card';
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">難しさ: ${LEVELS[s.rules.level] ?? ''}・全${s.qs.length}問・1問 ${s.rules.time}秒</div>`;
      wrap.append(card);
      root.append(wrap);
      return;
    }
    const { nums, ex } = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div><div class="mk-nums">${nums.map((n) => `<span class="mk-num">${n}</span>`).join('')}</div>`;
    if (s.phase === 'open') {
      since(key);
      card.append(timeBar(key, limit, { secs: true }));
    } else {
      const ans = document.createElement('div');
      ans.className = 'kj-answer';
      ans.textContent = `答えの例: ${pretty(ex)} = 10`;
      card.append(ans);
      // 正解した人の式（自分で組んだ式なので外から来た文字ではないが、数字と記号以外は apply で弾いている）
      const who = s.solved.map((v, p) => (v === null ? null : p)).filter((p) => p !== null);
      if (who.length) {
        const list = document.createElement('div');
        list.className = 'mk-who';
        list.innerHTML = who.map((p) => `<div>${esc(p === me ? 'あなた' : o.names?.[p] ?? '')}: ${esc(pretty(s.said[p]))}</div>`).join('');
        card.append(list);
      }
    }
    wrap.append(card);

    const note = document.createElement('p');
    note.className = 'cc-log';
    ui.note = note;
    if (s.phase === 'open' && me !== null && !doneOf(s, me)) wrap.append(this.pad(s, o, nums, key, limit, note));
    wrap.append(note);
    root.append(wrap);
    this.note(s, me);
  },

  // 式を組むボタン。数字のボタンは押したら使えなくなり、⌫ で戻ると使えるようになる
  pad(s, o, nums, key, limit, note) {
    const box = document.createElement('div');
    box.className = 'mk-pad';
    const line = document.createElement('div');
    line.className = 'mk-line';
    const toks = []; // { k: 'n', i: 何番目の数字 } か { k: 'o', v: '+' など }
    const numBtns = [];
    const textOf = () => toks.map((t) => (t.k === 'n' ? nums[t.i] : t.v)).join('');
    const draw = () => {
      const t = textOf();
      line.textContent = t ? pretty(t) : '数字と記号を押して式を作る';
      line.classList.toggle('empty', !t);
      numBtns.forEach((b, i) => { b.disabled = toks.some((x) => x.k === 'n' && x.i === i); });
    };
    const mk = (label, cls, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    let sent = false;
    const submit = () => {
      if (sent) return;
      const text = textOf();
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      if (!text) return;
      if (toks.filter((t) => t.k === 'n').length < 4) { note.textContent = '4つの数字を全部使ってください'; return; }
      const r = evalExpr(text);
      if (!r) { note.textContent = '式の形がちがいます（かっこや記号を見直してください）'; return; }
      if (!isRight(nums, text)) {
        const v = r.v[1] === 1 ? String(r.v[0]) : `${r.v[0]}/${r.v[1]}`;
        note.textContent = `10になりません（いまは ${pretty(v)}）`;
        return;
      }
      sent = true;
      o.onMove({ t: 'try', q: s.q, text, ms });
    };
    const push = (t) => { if (sent) return; toks.push(t); note.textContent = ''; draw(); };
    const row1 = document.createElement('div');
    row1.className = 'mk-row nums';
    nums.forEach((n, i) => {
      const b = mk(String(n), 'secondary mk-key mk-n', () => push({ k: 'n', i }));
      numBtns.push(b);
      row1.append(b);
    });
    const row2 = document.createElement('div');
    row2.className = 'mk-row';
    for (const v of ['+', '-', '*', '/', '(', ')']) row2.append(mk(pretty(v), 'secondary mk-key mk-op', () => push({ k: 'o', v })));
    const row3 = document.createElement('div');
    row3.className = 'mk-row';
    const back = () => { if (sent || !toks.length) return; toks.pop(); draw(); };
    row3.append(mk('⌫ 消す', 'ghost mk-key', back), mk('全部消す', 'ghost mk-key', () => { if (sent) return; toks.length = 0; draw(); }), mk('＝ 答える', 'primary mk-key', submit));
    const pass = mk('パス（この問題をとばす）', 'ghost kj-pass', () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); });
    box.append(line, row1, row2, row3, pass);
    draw();
    // キーボードの数字は、まだ使っていない同じ数字のボタンに当てる
    ui.press = (k) => {
      if (/^[1-9]$/.test(k)) {
        const i = nums.findIndex((n, j) => String(n) === k && !toks.some((x) => x.k === 'n' && x.i === j));
        if (i >= 0) push({ k: 'n', i });
        return true;
      }
      if ('+-*/()'.includes(k) && k.length === 1) { push({ k: 'o', v: k }); return true; }
      if (k === 'Backspace') { back(); return true; }
      if (k === 'Enter' || k === '=') { submit(); return true; }
      return false;
    };
    setTimeout(() => {
      if (!box.isConnected) return;
      box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      sent = true;
      note.textContent = '時間切れ！';
    }, Math.max(0, limit - since(key)));
    return box;
  },

  // ふりかえり: 出た数字と答えの例・自分が正解したか・いちばん速く正解した人
  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const rows = s.log.map((x, q) => ({ x, q: s.qs[q] }));
    const right = me === null ? 0 : rows.filter((r) => r.x.solved[me] !== null).length;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${rows.length}問${me !== null ? `・あなたの正解 ${right}問` : ''}）`;
    const list = document.createElement('ol');
    rows.forEach((r, k) => {
      const li = document.createElement('li');
      const fast = r.x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? `プレイヤー${p + 1}`));
      li.innerHTML = `<span class="mk-rv-n">${k + 1}</span>`
        + (me !== null ? `<span>${r.x.solved[me] !== null ? '⭕' : '❌'}</span>` : '')
        + `<span class="mk-rv-nums">${r.q.nums.join(' ')}</span><span class="mk-rv-ex">${esc(pretty(r.q.ex))}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },

  note(s, me) {
    const note = ui?.note;
    if (!note) return;
    if (s.phase === 'open') {
      const someone = s.solved.some((v) => v !== null);
      if (me !== null && s.solved[me] !== null) note.textContent = `正解！（${secText(s.solved[me])}）ほかの人を待っています`;
      else if (me !== null && s.passed[me]) note.textContent = 'パスしました。ほかの人を待っています';
      else if (me === null) note.textContent = '観戦中';
      else if (someone) note.textContent = 'ほかの人が正解しました。10秒で締め切り！ 正解すれば点がもらえます';
      else if (!note.textContent) note.textContent = '4つの数字を1回ずつ使って10を作ろう';
    } else if (s.phase === 'shown' && s.last) {
      note.textContent = s.last.winners.length ? '' : '正解した人はいませんでした';
    } else {
      note.textContent = '';
    }
  },
};
