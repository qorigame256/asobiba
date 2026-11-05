// 数字つなぎ早解き（ナンバーリンク風。元のパズルの名前は使わない）。同じ数字どうしを線でつなぎ、全部のマスを線で埋めたら完成。
// 全員に同じ問題を出し、早く解いた人ほど高い点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 名前は「数字つなぎ早解き」（「ナンバーリンク」はニコリのパズルの名前で、商標の登録は調べても分からなかったため）。
//   - 指でなぞってつなぎ、全部のマスを線で埋めたら完成。問題は答えが1つだけのものを前もって作る（tools/make-tsunagi.mjs → tsunagi-data.js）。
//   - 大きさは 5×5・7×7（最初）。全員に同じ3問を出し、速い順に 3点・2点・それ以降は1点（15パズル早解きと同じ）。
// Claude の判断:
//   - 制限時間は 5×5 が90秒・7×7 が180秒。最初に解いた人から20秒で締め切る（制限時間のほうが先なら制限時間で）。あきらめる（この問題をとばす）もできる。
//   - 書き方: 数字のマスからなぞると、その数字の線を引き直す。引いた線の途中からなぞると、そこから先を引き直す。来た道を戻ると消える。
//     ほかの数字の線を横切ると、その線は横切られた所から先が消える。数字のマスを押して離すと、その数字の線を消す。ほかの数字のマスには入れない。
//   - 送るのは、数字ごとの線が通ったマスの並び（paths）。apply で、どの数字の線も2つの数字のマスを結ぶ1本の線で、全部のマスをちょうど1回ずつ通るか確かめる
//     （答えが1つだけの問題なので、正しく解けば必ず用意した答えと同じになるが、比べるのは線になっているかどうかだけ）。
//   - 問題を作るとき、線が自分のとなりを通って折り返す形（同じ線の2マス先以降のマスがとなりにある）は使わない（tools/make-tsunagi.mjs）。
//   - CPU は 5×5 は7割・7×7 は5割5分・9×9 は4割の問題を、制限時間の2.5〜7.5割のころに解く。解かない問題は同じころにあきらめる。
// 2026-11-05 の35回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「問題の数」（鍵は rounds）: 1問・3問（最初）・5問。おまかせでは抽選しない（main.js の KEEP_KEYS の rounds）。
//   - 大きさに 9×9（むずかしい）を足した。制限時間は300秒。数字が9までだと 9×9 の問題が作れなかった（2万回試して0こ）ので、
//     9×9 だけ数字を 10〜13 まで使う（問題の文字列では 'a'〜'd'。numOf で数に直す）。作り方も 9×9 だけ「線が自分のとなりに来そうな所で切る」形（makeCandidate の cut）。
//   - 3問（最初）・7×7 のときの局面と乱数の使い方は前と同じ。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（15パズル早解きと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, paths: { 数字: [マス…] }, ms } / { p, t: 'pass', q }

import { mulberry32, shuffle, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText } from './party.js';
import { pointsOf } from './make10.js';
import { TSUNAGI } from './tsunagi-data.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
export const QUESTIONS = 3;
const ROUNDS = [[3, '3問'], [1, '1問'], [5, '5問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : QUESTIONS);
const LIMITS = { 5: 90000, 7: 180000, 9: 300000 };
const sizeOf = (r) => (String(r.size) === '5' ? 5 : String(r.size) === '9' ? 9 : 7);
// 問題の文字（'1'〜'9'・'a'〜'd'）を数（1〜13）に直す
export const numOf = (ch) => parseInt(ch, 36);
const limitOf = (s) => LIMITS[s.size];
const qKey = (s, q = s.q) => `tsunagi:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
// 線の色（数字ごと。1〜13。10〜13 は 9×9 だけ）。どのスキンでも変えない
export const LINE_COLORS = ['#e74c3c', '#2f6fb3', '#2e9a52', '#d4a20c', '#8a4fc0', '#e67e22', '#1a9aa0', '#d24a8c', '#7a5a3a', '#3f3fa0', '#8fb339', '#22a7e0', '#666666'];
const colorOf = (k) => LINE_COLORS[(numOf(k) - 1) % LINE_COLORS.length];

/* ---------- 盤の道具（問題を作る台本 tools/make-tsunagi.mjs と自動確認も使う） ---------- */

const nbCache = new Map();
// となりのマスの一覧（上下左右）
export function neighbors(N) {
  if (nbCache.has(N)) return nbCache.get(N);
  const out = [];
  for (let i = 0; i < N * N; i++) {
    const r = Math.floor(i / N), c = i % N;
    const a = [];
    if (r > 0) a.push(i - N);
    if (r < N - 1) a.push(i + N);
    if (c > 0) a.push(i - 1);
    if (c < N - 1) a.push(i + 1);
    out.push(a);
  }
  nbCache.set(N, out);
  return out;
}
// 問題の文字列（'0' = 空き、'1'〜'9' = 数字）から、数字ごとの2つのマス
export function endsOf(puzzle) {
  const ends = {};
  [...puzzle].forEach((ch, i) => { if (ch !== '0') (ends[ch] ??= []).push(i); });
  return ends;
}
// paths（数字 → 線が通るマスの並び）が、どの数字も2つの数字のマスを結ぶ1本の線になっていて、全部のマスをちょうど1回ずつ通っているか。
// マスの色分けでなく通った順番で確かめる（線が自分のとなりを通って折り返すと、色分けからは道が1本に決まらないため）
export function isSolution(puzzle, paths, N) {
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return false;
  const nb = neighbors(N);
  const ends = endsOf(puzzle);
  const keys = Object.keys(ends);
  if (Object.keys(paths).length !== keys.length) return false;
  const used = new Uint8Array(N * N);
  for (const k of keys) {
    const path = paths[k];
    if (!Array.isArray(path) || path.length < 2 || path.length > N * N) return false;
    const [a, b] = ends[k];
    if (!((path[0] === a && path[path.length - 1] === b) || (path[0] === b && path[path.length - 1] === a))) return false;
    for (let i = 0; i < path.length; i++) {
      const c = path[i];
      if (!Number.isInteger(c) || c < 0 || c >= N * N || used[c]) return false;
      if (puzzle[c] !== '0' && puzzle[c] !== k) return false;
      if (i > 0 && !nb[path[i - 1]].includes(c)) return false;
      used[c] = 1;
    }
  }
  return used.every(Boolean);
}
// 答えの色分け（全部のマスに何番の線が通るか）から、数字ごとの線の並びを作る（どの線も自分のとなりを通らない問題だけを作っているので1つに決まる）
export function pathsOf(puzzle, sol, N) {
  const nb = neighbors(N);
  const paths = {};
  for (const [k, [a]] of Object.entries(endsOf(puzzle))) {
    const path = [a];
    const seen = new Set([a]);
    for (;;) {
      const nx = nb[path[path.length - 1]].find((j) => sol[j] === k && !seen.has(j));
      if (nx === undefined) break;
      seen.add(nx);
      path.push(nx);
    }
    paths[k] = path;
  }
  return paths;
}
// 解の数を数える（limit まで）。全部のマスを埋める決まりで数える
export function countSolutions(puzzle, N, limit = 2) {
  const cells = N * N;
  const nb = neighbors(N);
  const color = new Int8Array(cells);
  const ends = {};
  for (const [ch, v] of Object.entries(endsOf(puzzle))) ends[numOf(ch)] = v; // 色は数で持つ（'a' などの文字も 10〜 に直す）
  const ks = Object.keys(ends).map(Number);
  const head = {}, tail = {}, done = {};
  let filled = 0;
  for (const k of ks) {
    if (ends[k].length !== 2) return 0;
    [head[k], tail[k]] = ends[k];
    color[head[k]] = k;
    color[tail[k]] = k;
    done[k] = false;
    filled += 2;
  }
  let count = 0;
  const comp = new Int16Array(cells);
  const ok = () => {
    // 空きマスは、空き・まだつながっていない線の先・相手の数字のどれかが2つ以上となりにないと埋まらない
    for (let c = 0; c < cells; c++) {
      if (color[c]) continue;
      let av = 0;
      for (const d of nb[c]) {
        if (!color[d]) av++;
        else { const k = color[d]; if (!done[k] && (d === head[k] || d === tail[k])) av++; }
      }
      if (av < 2) return false;
    }
    // 空きマスのかたまりごとに、線の先と相手の数字の両方にとなる数字がないと、そのかたまりは埋まらない
    comp.fill(-1);
    let nc = 0;
    const touchH = [], touchT = [];
    for (let c = 0; c < cells; c++) {
      if (color[c] || comp[c] !== -1) continue;
      const h = new Set(), t = new Set();
      const st = [c];
      comp[c] = nc;
      while (st.length) {
        const x = st.pop();
        for (const d of nb[x]) {
          if (!color[d]) { if (comp[d] === -1) { comp[d] = nc; st.push(d); } continue; }
          const k = color[d];
          if (done[k]) continue;
          if (d === head[k]) h.add(k);
          if (d === tail[k]) t.add(k);
        }
      }
      if (![...h].some((k) => t.has(k))) return false;
      touchH.push(h); touchT.push(t);
      nc++;
    }
    // まだつながっていない線は、相手の数字にとなりにいるか、同じかたまりにとなっていないとつながらない
    for (const k of ks) {
      if (done[k]) continue;
      if (nb[head[k]].includes(tail[k])) continue;
      let reach = false;
      for (let i = 0; i < nc && !reach; i++) if (touchH[i].has(k) && touchT[i].has(k)) reach = true;
      if (!reach) return false;
    }
    return true;
  };
  const dfs = () => {
    if (count >= limit) return;
    let best = null, opts = null;
    for (const k of ks) {
      if (done[k]) continue;
      const o = nb[head[k]].filter((d) => d === tail[k] || !color[d]);
      if (!o.length) return;
      if (!opts || o.length < opts.length) { best = k; opts = o; }
    }
    if (best === null) { if (filled === cells) count++; return; }
    for (const d of opts) {
      if (d === tail[best]) {
        done[best] = true;
        if (ok()) dfs();
        done[best] = false;
      } else {
        const prev = head[best];
        color[d] = best;
        head[best] = d;
        filled++;
        if (ok()) dfs();
        filled--;
        head[best] = prev;
        color[d] = 0;
      }
      if (count >= limit) return;
    }
  };
  if (ok()) dfs();
  return count;
}
// 問題を1つ作る（答えが1つだけかはまだ見ない）。全部のマスを通る1本の道をでたらめに曲げてから、3〜maxLen マスずつに切る。
// cut（9×9 で使う）: 切る長さを決めたあと、線が自分のとなりに来るマスの手前でも切る（どこかが3マスより短くなったら使わない）。maxSegs = 線の数の上限
export function makeCandidate(N, rnd, maxLen, { cut = false, maxSegs = 9 } = {}) {
  const nb = neighbors(N);
  const path = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) path.push(r * N + (r % 2 ? N - 1 - c : c));
  for (let it = 0; it < N * N * 80; it++) {
    if (rnd() < 0.5) path.reverse();
    const end = path[path.length - 1];
    const d = nb[end][Math.floor(rnd() * nb[end].length)];
    const idx = path.indexOf(d);
    if (idx === path.length - 2) continue;
    path.push(...path.splice(idx + 1).reverse());
  }
  const segs = [];
  let i = 0;
  if (cut) {
    while (i < path.length) {
      const want = 3 + Math.floor(rnd() * (maxLen - 2));
      const seg = [path[i++]];
      while (i < path.length && seg.length < want && !seg.slice(0, -1).some((x) => nb[x].includes(path[i]))) seg.push(path[i++]);
      if (seg.length < 3) return null;
      segs.push(seg);
    }
  } else {
    while (i < path.length) {
      let len = 3 + Math.floor(rnd() * (maxLen - 2));
      if (path.length - (i + len) < 3) len = path.length - i;
      segs.push(path.slice(i, i + len));
      i += len;
    }
  }
  if (segs.length > maxSegs) return null;
  // 線が自分のとなりを通って折り返す形（2マス先以降の自分のマスがとなりにある）は使わない（見た目が分かりにくく、色分けから線が1本に決まらないため）
  for (const seg of segs) for (let a = 0; a < seg.length; a++) for (let b = a + 2; b < seg.length; b++) if (nb[seg[a]].includes(seg[b])) return null;
  const order = shuffle([...segs.keys()], rnd);
  const p = Array(N * N).fill('0');
  const sol = Array(N * N).fill('0');
  order.forEach((si, k) => {
    const seg = segs[si];
    const ch = (k + 1).toString(36); // 1〜9 は '1'〜'9'、10〜 は 'a'〜
    for (const c of seg) sol[c] = ch;
    p[seg[0]] = ch;
    p[seg[seg.length - 1]] = ch;
  });
  return { p: p.join(''), s: sol.join('') };
}

/* ---------- ゲーム ---------- */

let loc = null; // この端末で引いている線 { key, paths: { 数字: [マス…] }, sent }
let ui = null;
const cpuPlan = new Map();

export default {
  id: 'tsunagi',
  name: '数字つなぎ早解き',
  icon: '〰️',
  desc: '同じ数字どうしを線でつなぎ、全部のマスを埋める。早く解いた人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'size', label: '大きさ', desc: '5×5 はかんたん・7×7 はふつう・9×9 はむずかしい', def: '7', choices: [['7', '7×7'], ['5', '5×5（かんたん）'], ['9', '9×9（むずかしい）']] },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で解く問題の数', def: 3, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: '7', ...rules };
    const size = sizeOf(r);
    const qs = shuffle([...TSUNAGI[size].keys()], mulberry32(seed)).slice(0, roundsOf(r)).map((i) => TSUNAGI[size][i]);
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
    if (!isSolution(s0.qs[s0.q].p, m.paths, s0.size)) return null;
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
      plan = { at: limitOf(s) * (0.25 + Math.random() * 0.5), ok: Math.random() < (s.size === 5 ? 0.7 : s.size === 9 ? 0.4 : 0.55), done: false };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    if (plan.done || t < plan.at) return null;
    plan.done = true;
    if (!plan.ok) return { t: 'pass', q: s.q };
    return { t: 'done', q: s.q, paths: pathsOf(s.qs[s.q].p, s.qs[s.q].s, s.size), ms: Math.round(t) };
  },

  render(root, s, o) {
    // 観戦の人が「見る画面」でほかの人を選んでいても、自分の席として扱わない（前は答えが出ず空の盤になった。2026-11-05 の Codex の点検）
    const me = o.me >= 0 && !o.watching ? o.me : null;
    // だれかが解いたかどうかは盤を作り直す条件に入れない（作り直すと、なぞっている途中の指が切れた。2026-11-05 の Codex の点検）。残り時間の帯だけ替える
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && doneOf(s, me)}:${!!o.canMove}`;
    const anySolved = s.solved.some((v) => v !== null);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.solved[p] !== null ? '<span class="pt-ok">解けた！</span>' : s.passed[p] ? '<span class="pt-ng">あきらめ</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra });
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      if (ui.bar && ui.anySolved !== anySolved) { ui.anySolved = anySolved; ui.bar(); }
      return;
    }

    root.innerHTML = '';
    root.className = 'board kj tg';
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
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}×${s.size}・全${s.qs.length}問・同じ数字を線でつなぎ、全部のマスを埋めよう</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`;
    if (s.phase === 'open') {
      since(key);
      const box = document.createElement('div');
      card.append(box);
      ui.anySolved = anySolved;
      ui.bar = () => {
        box.innerHTML = '';
        if (ui.anySolved) {
          box.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかが解いた！ もうすぐ締め切り</div>');
          box.append(afterBar(key, limit, AFTER_MS));
        } else box.append(timeBar(key, limit, { secs: true }));
      };
      ui.bar();
    } else {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}` : 'だれも解けませんでした';
      card.append(t);
    }

    const N = s.size;
    const { p: puzzle, s: answer } = s.qs[s.q];
    const ends = endsOf(puzzle);
    const nb = neighbors(N);
    if (loc?.key !== key) loc = { key, paths: {}, sent: false };
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${N} ${N}`);
    svg.setAttribute('class', 'tg-board' + (playing ? ' live' : ''));
    const note = document.createElement('p');
    note.className = 'cc-log';
    const owner = () => {
      const own = Array(N * N).fill(0);
      for (const [k, path] of Object.entries(loc.paths)) for (const c of path) own[c] = numOf(k); // Number('a') は NaN で「埋まっていない」に見えるので numOf で直す
      return own;
    };
    const complete = (k) => { const path = loc.paths[k]; return !!path && path.length >= 2 && ends[k].includes(path[path.length - 1]) && path[path.length - 1] !== path[0]; };
    const center = (c) => [(c % N) + 0.5, Math.floor(c / N) + 0.5];
    const draw = () => {
      // 答えを見せる場面と観戦の人は、用意した答えの線を描く
      const showAns = s.phase !== 'open' || me === null;
      let paths = loc.paths;
      if (showAns) paths = pathsOf(puzzle, answer, N);
      let html = '';
      for (let i = 0; i < N * N; i++) html += `<rect x="${i % N + 0.03}" y="${Math.floor(i / N) + 0.03}" width=".94" height=".94" rx=".12" class="tg-cell"/>`;
      for (const [k, path] of Object.entries(paths)) {
        const col = colorOf(k);
        for (const c of path) html += `<rect x="${c % N + 0.03}" y="${Math.floor(c / N) + 0.03}" width=".94" height=".94" rx=".12" fill="${col}" opacity=".18"/>`;
        if (path.length > 1) html += `<polyline points="${path.map((c) => center(c).join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width=".32" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      for (const [k, [a, b]] of Object.entries(ends)) {
        const col = colorOf(k);
        const label = numOf(k);
        for (const c of [a, b]) {
          const [x, y] = center(c);
          html += `<circle cx="${x}" cy="${y}" r=".38" fill="${col}"/><text x="${x}" y="${y + 0.15}" text-anchor="middle" font-size="${label >= 10 ? 0.36 : 0.42}" font-weight="800" fill="#fff">${label}</text>`;
        }
      }
      svg.innerHTML = html;
      const filled = owner().filter(Boolean).length;
      const linked = Object.keys(ends).filter(complete).length;
      note.textContent = s.phase !== 'open' ? '' : me === null ? '観戦中（答えを見ています）' : s.solved[me] !== null ? `解けた！（${secText(s.solved[me])}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています' : `つないだ数字 ${linked} / ${Object.keys(ends).length}・埋めたマス ${filled} / ${N * N}`;
    };
    const finish = () => {
      if (loc.sent || !playing) return;
      const own = owner();
      if (own.some((v) => !v) || !Object.keys(ends).every(complete)) return;
      const paths = Object.fromEntries(Object.entries(loc.paths).map(([k, path]) => [k, path.slice()]));
      if (!isSolution(puzzle, paths, N)) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      o.onMove({ t: 'done', q: s.q, paths, ms });
    };
    // なぞり
    let cur = null; // { k, id }
    const cellAt = (e) => {
      const r = svg.getBoundingClientRect();
      const c = Math.floor(((e.clientX - r.left) / r.width) * N), rr = Math.floor(((e.clientY - r.top) / r.height) * N);
      return c >= 0 && c < N && rr >= 0 && rr < N ? rr * N + c : -1;
    };
    const endOwner = (c) => (puzzle[c] !== '0' ? puzzle[c] : null);
    const stepTo = (c) => {
      if (!cur) return;
      const path = loc.paths[cur.k];
      const tip = path[path.length - 1];
      if (c === tip) return;
      if (!nb[tip].includes(c)) return;
      const back = path.indexOf(c);
      if (back >= 0) { path.length = back + 1; return; } // 来た道を戻ると消える
      if (complete(cur.k)) return; // もうつながっている
      const eo = endOwner(c);
      if (eo !== null && eo !== cur.k) return; // ほかの数字のマスには入れない
      // ほかの線を横切ったら、その線は横切られた所から先を消す
      for (const [k, other] of Object.entries(loc.paths)) {
        if (k === cur.k) continue;
        const j = other.indexOf(c);
        if (j >= 0) other.length = j;
        if (!other.length) delete loc.paths[k];
      }
      path.push(c);
    };
    svg.onpointerdown = (e) => {
      if (!playing || e.isPrimary === false) return;
      const c = cellAt(e);
      if (c < 0) return;
      const eo = endOwner(c);
      if (eo !== null) {
        loc.paths[eo] = [c];
        cur = { k: eo, id: e.pointerId, start: c, moved: false };
      } else {
        const hit = Object.entries(loc.paths).find(([, path]) => path.includes(c));
        if (!hit) return;
        hit[1].length = hit[1].indexOf(c) + 1;
        cur = { k: hit[0], id: e.pointerId, start: c, moved: true };
      }
      try { svg.setPointerCapture?.(e.pointerId); } catch { /* 取り込めなくても動く */ }
      e.preventDefault();
      draw();
    };
    svg.onpointermove = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      const c = cellAt(e);
      if (c < 0) return;
      const path = loc.paths[cur.k];
      if (!path) return;
      const tip = path[path.length - 1];
      if (c === tip) return;
      // 速くなぞってマスを飛ばしたときは、同じ段・列なら間のマスを順にたどる
      const [tr, tc, r, cc] = [Math.floor(tip / N), tip % N, Math.floor(c / N), c % N];
      if (tr === r || tc === cc) {
        const dr = Math.sign(r - tr), dc = Math.sign(cc - tc);
        let x = tip;
        while (x !== c) {
          const nx = x + dr * N + dc;
          stepTo(nx);
          if (loc.paths[cur.k]?.[loc.paths[cur.k].length - 1] !== nx) break;
          x = nx;
        }
      } else stepTo(c);
      cur.moved = true;
      draw();
    };
    const up = (e) => {
      if (!cur || e.pointerId !== cur.id) return;
      // 数字のマスを押して離しただけなら、その数字の線を消す
      if (!cur.moved && loc.paths[cur.k]?.length === 1) delete loc.paths[cur.k];
      cur = null;
      draw();
      finish();
    };
    svg.onpointerup = up;
    svg.onpointercancel = up;
    draw();
    wrap.append(svg, note);
    if (playing) {
      const row = document.createElement('div');
      row.className = 'tg-btns';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'btn ghost';
      clear.textContent = '全部消す';
      clear.onclick = () => { loc.paths = {}; draw(); };
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q }); };
      row.append(clear, pass);
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
