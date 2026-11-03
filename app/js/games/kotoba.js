// ことばさがし。ひらがなが並んだ盤に隠れた言葉を、全員同じ盤で早い者勝ちで探す。2〜10人・足りない分は CPU（弱め）。
// 2026-11-03 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - お題（「どうぶつ」など）と、隠れている言葉の一覧を見せる。
//   - 全員同じ盤で早い者勝ち。見つかった言葉は全員の盤で色が付く。
//   - 選び方は最初の字から最後の字までなぞる（最初と最後の字を押すだけでもよい）。
//   - 言葉の字数がそのまま点。全部見つかるか2分たったら次の盤へ進み、3回遊ぶ。盤は 8×8 で、言葉はたてとよこだけ。
//   - 詳細設定「ななめ・逆向き」（なし（最初）・あり）: ななめと、右から左・下から上も混ぜる。
// Claude の判断:
//   - 1つの盤に7つの言葉を隠す（お題は kotoba-data.js から3回とも別のものを種で選ぶ）。言葉どうしは同じ字なら重なってよい。
//     すき間はふつうのひらがなで埋め、隠した言葉がほかの場所にもう1つできてしまったら埋め直す（どの言葉も盤に1か所だけ）。
//   - 見つけた手は { t: 'find', q, w: 言葉の番号, ms }。同じ言葉を2人が見つけたら、各自の画面で測った ms の小さいほうのもの
//     （あとから届いた手のほうが速ければ取り替える。通信の遅れでゲストが不利にならないように）。
//   - 全部見つかったら1.5秒待って締め切る（ほかの人のもっと速い手が届く分を待つ）。結果を見せる間は3秒。
//   - なぞった字の並びが、まだ見つかっていない言葉の場所とぴったり同じなら見つけたことにする（向きはどちらからでもよい）。
//   - CPU は7〜20秒に1つ、まだ見つかっていない言葉を見つける。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'find', q, w, ms }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { KOTOBA } from './kotoba-data.js';

const N = 8;
const WORDS = 7;
const ROUNDS = 3;
const LIMIT = 120000;
const READY_MS = 3000;
const SHOWN_MS = 3000;
const GRACE_MS = 1500;
const FILL = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわんがぎぐげござじずぜぞだでどばびぶべぼ'];
const EASY = [[0, 1], [1, 0]]; // よこ（左から右）・たて（上から下）
const ALL = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]];

const qKey = (s, q = s.q) => `kotoba:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice() });
const lenOf = (w) => [...w].length;
const cellsKey = (cells) => cells.slice().sort((a, b) => a - b).join(',');

// 盤を作る。返り値 { grid: 64字, words: [{ w, cells }] }
export function makeBoard(rnd, theme, hard) {
  const dirs = hard ? ALL : EASY;
  for (let tries = 0; tries < 200; tries++) {
    const grid = Array(N * N).fill('');
    const pick = shuffle(theme[1].slice(), rnd).slice(0, WORDS + 3).sort((a, b) => lenOf(b) - lenOf(a));
    const words = [];
    for (const w of pick) {
      if (words.length >= WORDS) break;
      const ch = [...w];
      for (let k = 0; k < 60; k++) {
        const [dr, dc] = dirs[Math.floor(rnd() * dirs.length)];
        const r0 = Math.floor(rnd() * N), c0 = Math.floor(rnd() * N);
        const cells = ch.map((_, i) => [r0 + dr * i, c0 + dc * i]);
        if (cells.some(([r, c]) => r < 0 || c < 0 || r >= N || c >= N)) continue;
        if (cells.some(([r, c], i) => grid[r * N + c] && grid[r * N + c] !== ch[i])) continue;
        const idx = cells.map(([r, c]) => r * N + c);
        if (words.some((x) => cellsKey(x.cells) === cellsKey(idx))) continue;
        idx.forEach((v, i) => { grid[v] = ch[i]; });
        words.push({ w, cells: idx });
        break;
      }
    }
    if (words.length < WORDS) continue;
    for (let fill = 0; fill < 30; fill++) {
      const g = grid.map((x) => x || FILL[Math.floor(rnd() * FILL.length)]);
      if (words.every((x) => countOf(g, x.w) === 1)) return { grid: g.join(''), words };
    }
  }
  throw new Error('ことばさがし: 盤が作れなかった');
}

// 盤の中に言葉が何か所あるか（8方向。逆から読んで同じ場所になるものは1か所と数える）
export function countOf(grid, w) {
  const g = typeof grid === 'string' ? [...grid] : grid;
  const ch = [...w];
  const seen = new Set();
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of ALL) {
    const cells = ch.map((_, i) => [r + dr * i, c + dc * i]);
    if (cells.some(([y, x]) => y < 0 || x < 0 || y >= N || x >= N)) continue;
    if (cells.every(([y, x], i) => g[y * N + x] === ch[i])) seen.add(cellsKey(cells.map(([y, x]) => y * N + x)));
  }
  return seen.size;
}

// a から b までのまっすぐな並び（たて・よこ・ななめ45度でなければ null）
export function lineOf(a, b) {
  const ra = Math.floor(a / N), ca = a % N, rb = Math.floor(b / N), cb = b % N;
  const dr = Math.sign(rb - ra), dc = Math.sign(cb - ca);
  const len = Math.max(Math.abs(rb - ra), Math.abs(cb - ca));
  if (!(ra === rb || ca === cb || Math.abs(rb - ra) === Math.abs(cb - ca))) return null;
  return Array.from({ length: len + 1 }, (_, i) => (ra + dr * i) * N + ca + dc * i);
}

const cpuPlan = new Map();
let ui = null;

export default {
  id: 'kotoba',
  name: 'ことばさがし',
  icon: '🔍',
  desc: 'ひらがなの盤に隠れた言葉を、早い者勝ちで探す。長い言葉ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'hard', label: 'ななめ・逆向き', desc: 'ななめに並んだ言葉や、右から左・下から上に並んだ言葉も混ぜる', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { hard: false, ...rules };
    const rnd = mulberry32(seed);
    const themes = shuffle([...KOTOBA.keys()], rnd).slice(0, ROUNDS);
    const qs = themes.map((t) => ({ theme: t, ...makeBoard(rnd, KOTOBA[t], r.hard) }));
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', found: [], scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    return m.p === me ? 'correct' : 'pop';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}回 / ${s.qs.length}`;
    return `第${s.q + 1}回の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.found.every((f) => f)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + GRACE_MS, move: { t: 'close' } };
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
        s.found = s.qs[s.q].words.map(() => null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const got = Array(s.n).fill(0);
        s.found.forEach((f, w) => { if (f) got[f.p] += lenOf(s.qs[s.q].words[w].w); });
        got.forEach((v, p) => { s.scores[p] += v; });
        s.last = { got };
        s.log = [...s0.log, { found: s.found.slice(), got }];
        return s;
      }
      return null;
    }
    if (m.t !== 'find' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!Number.isInteger(m.w) || m.w < 0 || m.w >= s0.found.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT + 300) return null;
    const f = s0.found[m.w];
    if (f && (f.p === m.p || f.ms <= m.ms)) return null; // もう見つかっている（あとから届いた手のほうが速いときだけ取り替える）
    const s = clone(s0);
    s.step += 1;
    s.found = s0.found.slice();
    s.found[m.w] = { p: m.p, ms: Math.round(m.ms) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open') return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { at: 7000 + Math.random() * 13000 };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (t < plan.at || t >= LIMIT) return null;
    const left = s.found.map((f, w) => (f ? -1 : w)).filter((w) => w >= 0);
    if (!left.length) return null;
    plan.at = t + 7000 + Math.random() * 13000;
    return { t: 'find', q: s.q, w: left[Math.floor(Math.random() * left.length)], ms: Math.round(t) };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const color = (p) => SEAT_COLORS[p % SEAT_COLORS.length];
    const extra = (p) => {
      if (s.phase === 'shown' && s.last) return s.last.got[p] ? `<span class="pt-ok">+${s.last.got[p]}</span>` : '<span class="pt-ng">―</span>';
      if (s.phase !== 'open') return '';
      const k = s.found.filter((f) => f?.p === p).length;
      return k ? `<span class="pt-ok">${k}こ</span>` : '';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${color(p)}`; });
    const key = qKey(s);
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${!!o.canMove}`;
    // 同じ盤のうちは盤を作り直さない（なぞっている途中の指が切れないように）。色と一覧だけ塗り直す
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.paint(s);
      return;
    }
    root.innerHTML = '';
    root.className = 'board kj kt';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    ui = { mount, wrap, chips, paint: () => {} };
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">隠れた言葉を早い者勝ちで探そう・全${s.qs.length}回・1回 ${LIMIT / 1000}秒まで${s.rules.hard ? '・ななめ・逆向きあり' : ''}</div>`;
      return;
    }
    const x = s.qs[s.q];
    card.innerHTML = `<div class="kj-num">第${s.q + 1}回 / ${s.qs.length}</div><div class="kt-theme">お題: ${esc(KOTOBA[x.theme][0])}</div>`;
    if (s.phase === 'open') { since(key); card.append(timeBar(key, LIMIT, { secs: true })); }
    const list = document.createElement('div');
    list.className = 'kt-list';
    const grid = document.createElement('div');
    grid.className = 'kt-grid';
    const cells = [...x.grid].map((ch, i) => {
      const d = document.createElement('div');
      d.className = 'kt-cell';
      d.textContent = ch;
      d.dataset.i = i;
      return d;
    });
    grid.append(...cells);
    const note = document.createElement('p');
    note.className = 'cc-log';
    wrap.append(list, grid, note);
    const playing = s.phase === 'open' && me !== null && o.canMove;

    let cur = s;
    let sel = null; // { a: 始めのマス, b: 今のマス, moved }
    let pending = null; // 押すだけで選ぶときの、最初に押したマス
    const paint = (st) => {
      cur = st;
      const marks = Array(N * N).fill(null);
      st.found.forEach((f, w) => { if (f) for (const c of x.words[w].cells) marks[c] = f.p; });
      const line = sel ? lineOf(sel.a, sel.b) ?? [sel.a] : pending !== null ? [pending] : [];
      cells.forEach((d, i) => {
        const p = marks[i];
        d.style.background = p === null ? '' : color(p) + '55';
        d.classList.toggle('sel', line.includes(i));
      });
      list.innerHTML = '';
      x.words.forEach((wd, w) => {
        const f = st.found[w];
        const t = document.createElement('span');
        t.className = 'kt-word' + (f ? ' done' : '');
        t.textContent = wd.w + ` (${lenOf(wd.w)})`;
        if (f) { t.style.borderColor = color(f.p); t.title = f.p === me ? 'あなた' : o.names[f.p] ?? ''; }
        list.append(t);
      });
      const mineN = st.found.filter((f) => f && f.p === me).length;
      note.textContent = st.phase !== 'open' ? `${st.found.filter((f) => f).length} / ${x.words.length} 見つかりました`
        : me === null ? '観戦中' : `最初の字から最後の字までなぞってね（最初と最後の字を押すだけでもOK）${mineN ? `・あなたは ${mineN}こ` : ''}`;
    };
    ui.paint = paint;
    const tryFind = (a, b) => {
      const line = lineOf(a, b);
      if (!line || line.length < 2) return false;
      const k = cellsKey(line);
      const w = x.words.findIndex((wd, i) => !cur.found[i] && cellsKey(wd.cells) === k);
      if (w < 0) return false;
      const ms = Math.round(since(key));
      if (ms >= LIMIT) return false;
      o.onMove({ t: 'find', q: s.q, w, ms });
      return true;
    };
    const cellAt = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el?.classList?.contains('kt-cell') && grid.contains(el) ? Number(el.dataset.i) : null;
    };
    if (playing) {
      grid.addEventListener('pointerdown', (e) => {
        const i = cellAt(e);
        if (i === null) return;
        e.preventDefault();
        grid.setPointerCapture?.(e.pointerId);
        sel = { a: i, b: i, moved: false };
        paint(cur);
      });
      grid.addEventListener('pointermove', (e) => {
        if (!sel) return;
        const i = cellAt(e);
        if (i === null || i === sel.b) return;
        sel.b = i;
        sel.moved = true;
        paint(cur);
      });
      const up = () => {
        if (!sel) return;
        const { a, b, moved } = sel;
        sel = null;
        if (moved) { pending = null; if (!tryFind(a, b)) play0(); }
        else if (pending === null || pending === a) pending = pending === a ? null : a; // 1回目に押したマスを覚える（同じマスならやめる）
        else { const p0 = pending; pending = null; if (!tryFind(p0, a)) play0(); }
        paint(cur);
      };
      grid.addEventListener('pointerup', up);
      grid.addEventListener('pointercancel', () => { sel = null; paint(cur); });
    }
    function play0() { grid.classList.remove('miss'); void grid.offsetWidth; grid.classList.add('miss'); }
    paint(s);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const b = s.qs[q];
      const li = document.createElement('li');
      const words = b.words.map((wd, w) => {
        const f = x.found[w];
        const who = f ? (f.p === me ? 'あなた' : o.names?.[f.p] ?? '') : '―';
        return `${esc(wd.w)}<small>（${esc(who)}）</small>`;
      }).join('・');
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="mk-rv-nums">${esc(KOTOBA[b.theme][0])}</span><span class="ox-rv">${words}</span>`
        + (me === null ? '' : `<span>あなた +${x.got[me]}</span>`);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
