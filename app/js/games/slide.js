// 15パズル早解き。全員に同じ並びのスライドパズルを出し、早くそろえた人ほど高い点。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   4×4（1〜15）を全員に同じ並びで3問。早くそろえた順に 3点・2点・それ以降は1点。詳細設定で 3×3（かんたん）と、混ぜ方の強さ（最初は軽め）。
// Claude の判断:
//   - 混ぜ方はそろった形から空きマスを無作為に動かす回数（戻る動きはしない）。軽め: 4×4 は40回・3×3 は20回、しっかり: 150回・60回。
//   - 送るのはそろえるまでの空きマスの動き（U・D・L・R の文字列）。apply で最初の並びから動かし直し、本当にそろうかを確かめる。
//   - 札は指でなでて（スワイプ）動かす（2026-10-30 本人の依頼で、押して動かすのから替えた）。なで始めた札と空きマスが同じ段・列で、なでた向きに空きがあれば
//     空きマスまでの札をまとめて動かす。そうでなければ、空きマスのとなりの札を1つなでた向きへ動かす（どこをなでても動く）。動きは1マスずつ数える。
//     マウスでも引っぱれば同じ。PC は矢印キーでも動かせる。
//   - 制限時間は 3×3 が90秒、4×4 は軽め180秒・しっかり300秒。最初にそろった人から20秒で締め切る（制限時間のほうが先なら制限時間で）。全員そろうかあきらめたら1.5秒。
//   - 問題の数は 1・3（最初）・5問。
//   - 5×5（1〜24。2026-10-29 本人が選んだ案）: 混ぜる回数は軽め70回・しっかり250回。CPU がそろえる割合は4×4 より1割低い。
// 2026-11-14 本人の依頼（「ほかの人の盤面を小さく見たい」「友人の動作がとても重くてまともに動かせない」）:
//   - 自分の盤の下に、ほかの人（CPU を除く）がいま動かしている盤を小さく並べる（送り方は下の others の所）。
//   - 重さの対策（原因は本人の端末で確かめられていない。Claude の判断）: 札を動くたびに作り直さず字だけ替える・なでた長さが足りたら指を離す前に動かす・
//     残り時間の帯（party.js の timeBar）は値が変わったときだけ書く。
// 2026-11-22 本人の依頼6件（分かれ目の2つは Claude が出した形から本人が選んだ。ほかは Claude の判断）:
//   - 部分点（本人の選択「合っている札を全部数える」）: そろわなかった人は、正しい場所にある札1枚につき1点。そろえた人は「札の数（4×4 なら15）＋速さの 3・2・1点」
//     なので、必ずそろえた人が上。合っている枚数は、動かして枚数が変わったら1秒おいて手（part）で送る（あきらめる手にも入れる）。届いていない人は最初の並びの枚数。
//   - ヒント（本人の選択「次に動かす札を光らせる」）: 詳細設定「ヒント」（鍵は hint。あり（最初）・なし）。問題が出て60秒たつと、自分の画面だけで、
//     そろうまでの近道（hintPath。手数の少ない道を数え切りで探す）の次の1手の札を光らせる。見つからないとき（調べる数の上限を越えたとき）は、
//     まだ正しい場所にない札のうちいちばん小さい数の札と、その置き場所を光らせる。
//   - 5×5 の制限時間を延ばす: 軽め 300秒→480秒・しっかり 480秒→720秒。
//   - 空きマスが2つのルール: 詳細設定「空きマス」（鍵は blanks。1つ（最初）・2つ）。そろった形は右下の2マスが空き（4×4 なら 1〜14）。
//     送る動きは、そのときの番号の小さいほうの空きマスの動きを大文字（U・D・L・R）、大きいほうを小文字（u・d・l・r）で書く。空きどうしは入れ替えない。
//     混ぜ方は2つの空きのどちらかを無作為に動かす（回数は1つのときと同じ）。なでたときは、なでた向きの先にある空きへすべらせる。
//   - あきらめた人の小さな盤に「あきらめ」の札を重ねる（前は薄くするだけで分かりにくかった）。
//   - CPU は、人がだれかそろえるまでは最初にそろえない（だれかがそろえてから 1.5〜8秒あとより前にはそろえない）。CPU は最初にそろえないので、
//     だれかがそろえていれば、それは人。人が全員あきらめた・そろえられないまま終わるときは、CPU もあきらめる（部分点は手で送る）。
//     どの席が CPU かは、ホストの端末で cpu() がこの2秒の間に呼ばれた席で見分ける（cpuSeats。代打から人が戻った席は呼ばれなくなるので人に戻る）。
// 2026-11-26 の UI・UX の13回目（本人が全部採用。puzzle-games.md）: 答えを見せる間（4秒）に、いちばん速かった人の動かし方を早送りで見せる。
//   動かし方はそろえた手の seq を局面の seqs に覚える（席ごと。次の問題で空に戻す）。0.3秒おいて1手0.09秒、全体を0.9〜2.8秒に収める（party.js の replaySteps）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（10を作れと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'done', q, seq, ms } / { p, t: 'pass', q, c? } / { p, t: 'part', q, c, n }
//   part の n はその人のその問題の何回目の知らせか（1から）。前に受け取った n 以下は弾く（通信の行き違いで同じ・古い知らせが後から当たっても、古い枚数に戻らないように。
//   2026-11-24 の Codex の点検のあと本人が推奨を承認。局面の partN に人ごとの最後の n を持つ）

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, afterOver, secText, replaySteps } from './party.js';
import { pointsOf } from './make10.js';

const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const AFTER_MS = 20000;
const HINT_MS = 60000;
const PART_MS = 1000; // 合っている枚数が変わってから送るまで（まとめて送る）
const HINT_NODES = 250000; // 近道を探すときに調べる局面の数の上限
const ROUNDS = [[1, '1問'], [3, '3問'], [5, '5問']];
const STEP = { U: -1, D: 1, L: 0, R: 0 }; // 段の動き（列の動きは下の DX）
const DX = { U: 0, D: 0, L: -1, R: 1 };
const BACK = { U: 'D', D: 'U', L: 'R', R: 'L' };
// 答えを見せる間に早送りする動かし方: いちばん速かった人（同じ速さなら席の番号の小さい人）の分。tools/probes/uiux13-logic.mjs が見ている
export const routeOf = (s) => (s.phase === 'shown' && s.last.winners.length ? s.seqs?.[s.last.winners[0]] : null);
const SWIPE_MIN = 18; // これ（画面の点）より短い動きは、なでたことにしない

const sizeOf = (r) => ([3, 5].includes(Number(r.size)) ? Number(r.size) : 4);
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 3);
const LIMITS = { 3: [90000, 90000], 4: [180000, 300000], 5: [480000, 720000] }; // 大きさごとの [軽め, しっかり]
const MOVES = { 3: [20, 60], 4: [40, 150], 5: [70, 250] };
const full = (s) => (s.rules.level === 'full' ? 1 : 0);
const limitOf = (s) => LIMITS[s.size][full(s)];
export const blanksOfRules = (r) => (Number(r?.blanks) === 2 ? 2 : 1);
const qKey = (s, q = s.q) => `slide:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), passed: s.passed.slice(), parts: s.parts.slice(), partN: s.partN.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.passed[p];
export const solvedBoard = (n, z = 1) => [...Array(n * n - z).keys()].map((i) => i + 1).concat(Array(z).fill(0));
const zerosOf = (b) => b.reduce((a, v) => a + (v === 0 ? 1 : 0), 0);
export const isSolved = (b) => { const z = zerosOf(b); return b.every((v, i) => v === (i >= b.length - z ? 0 : i + 1)); };
// 正しい場所にある札の数（部分点）
export const countOk = (b) => b.reduce((a, v, i) => a + (v !== 0 && v === i + 1 ? 1 : 0), 0);
const blanksAt = (b) => b.reduce((a, v, i) => (v === 0 ? (a.push(i), a) : a), []);
// 空きマス i を向き D に動かす手の字（番号の小さいほうの空きは大文字、大きいほうは小文字）
export const letterFor = (b, i, D) => (blanksAt(b).indexOf(i) === 1 ? D.toLowerCase() : D);

// 空きマスを dir に動かす（となりの札が空きへ入る）。動けなければ null（となりが空きのときも動かない）
export function moveBlank(b, n, dir) {
  const D = dir.toUpperCase();
  if (!(D in STEP)) return null;
  const i = blanksAt(b)[dir === D ? 0 : 1];
  if (i === undefined) return null;
  const r = Math.floor(i / n) + STEP[D], c = (i % n) + DX[D];
  if (r < 0 || r >= n || c < 0 || c >= n) return null;
  const j = r * n + c;
  if (b[j] === 0) return null;
  const out = b.slice();
  [out[i], out[j]] = [out[j], 0];
  return out;
}
// 動きの文字列をまとめて当てる。途中で動けない・文字がちがうなら null
export function replay(b, n, seq) {
  if (typeof seq !== 'string' || seq.length > 12000 || !/^[UDLRudlr]*$/.test(seq)) return null;
  let cur = b;
  for (const d of seq) { cur = moveBlank(cur, n, d); if (!cur) return null; }
  return cur;
}
// 混ぜる。返り値 { board, path }（path は混ぜた動き。undoOf で逆にたどればそろう）。空きマス1つのときの乱数の使い方は前と同じ
export function scramble(n, moves, rnd, z = 1) {
  for (;;) {
    let b = solvedBoard(n, z);
    let path = '';
    let prev = null; // 前の動き { at: 動いたあとの空きの場所, D }
    while (path.length < moves) {
      const opts = [];
      for (const i of blanksAt(b)) {
        for (const D of 'UDLR') {
          if (prev && i === prev.at && D === BACK[prev.D]) continue;
          const d = letterFor(b, i, D);
          if (moveBlank(b, n, d)) opts.push({ d, i, D });
        }
      }
      const o = opts[Math.floor(rnd() * opts.length)];
      prev = { at: o.i + STEP[o.D] * n + DX[o.D], D: o.D };
      b = moveBlank(b, n, o.d);
      path += o.d;
    }
    if (!isSolved(b)) return { board: b, path };
  }
}
// 空きマス1つのときの、混ぜた動きを逆にたどる動き
export const undoPath = (path) => [...path].reverse().map((d) => BACK[d]).join('');
// 混ぜた動きを逆にたどる動き（空きマスが2つでも使える。そろった形から動かし直して、空きの場所から字を決める）
export function undoOf(n, path, z = 1) {
  let b = solvedBoard(n, z);
  const steps = [];
  for (const d of path) {
    const D = d.toUpperCase();
    const i = blanksAt(b)[d === D ? 0 : 1];
    steps.push({ at: i + STEP[D] * n + DX[D], D: BACK[D] });
    b = moveBlank(b, n, d);
  }
  let out = '';
  for (const st of steps.reverse()) {
    const d = letterFor(b, st.at, st.D);
    b = moveBlank(b, n, d);
    out += d;
  }
  return out;
}
// そろうまでの近道（手数のいちばん少ない動き）を探す。各札の正しい場所までの縦横の距離の合計を目安に、深さを1つずつ広げて調べる（IDA*）。
// 調べた局面が limit を越えたら null（見つからない）
export function solvePath(b0, n, limit = HINT_NODES, w = 1) {
  const b = b0.slice();
  const dist = (v, i) => Math.abs(Math.floor(i / n) - Math.floor((v - 1) / n)) + Math.abs((i % n) - ((v - 1) % n));
  let h0 = 0;
  b.forEach((v, i) => { if (v) h0 += dist(v, i); });
  if (h0 === 0) return isSolved(b) ? '' : null;
  const path = [];
  let nodes = 0;
  let bound = w * h0;
  let next = Infinity;
  const STOP = {};
  const dfs = (g, h, prevAt, prevD) => {
    if (h === 0) return true;
    const f = g + w * h;
    if (f > bound) { if (f < next) next = f; return false; }
    if (++nodes > limit) throw STOP;
    const bl = blanksAt(b);
    for (let k = 0; k < bl.length; k++) {
      const i = bl[k];
      const r0 = Math.floor(i / n), c0 = i % n;
      for (const D of 'UDLR') {
        if (i === prevAt && D === BACK[prevD]) continue;
        const r = r0 + STEP[D], c = c0 + DX[D];
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const j = r * n + c;
        const v = b[j];
        if (v === 0) continue;
        const dh = dist(v, i) - dist(v, j);
        b[i] = v; b[j] = 0;
        path.push(k === 1 ? D.toLowerCase() : D);
        if (dfs(g + 1, h + dh, j, D)) return true;
        path.pop();
        b[j] = v; b[i] = 0;
      }
    }
    return false;
  };
  try {
    for (;;) {
      next = Infinity;
      if (dfs(0, h0, -1, '')) return path.join('');
      if (next === Infinity) return null;
      bound = next;
    }
  } catch (e) {
    if (e === STOP) return null;
    throw e;
  }
}
// ヒントの道: まず手数のいちばん少ない道を少しだけ探し、見つからなければ目安を2倍に重く見て（手数は少し増えるが早く見つかる）探す。
// 2026-11-22 に Claude の PC で測った見つかる割合（各20問・1回 0.13秒まで）: 4×4 軽め 19/20・4×4 空き2つ 16/20・4×4 しっかり 17/20・5×5 軽め 13/20。見つからなければ置き場所のヒント
export const hintPath = (b, n) => solvePath(b, n, 40000, 1) ?? solvePath(b, n, 120000, 2);

let loc = null; // この端末で動かしている盤 { key, board, seq, sent, part, hint }
let ui = null;
// ほかの人の盤を小さく見る（2026-11-14 本人の依頼）: 動かしている盤は見た目だけなので手の一覧に入れず、動くたびに送りっぱなしにする（o.stream。0.25秒より短い間は1回にまとめる）。
// 札の数は1文字ずつ36進（0〜24 → 0〜o）で送る。CPU の盤は出さない（CPU は札を動かさず、時間でそろえるため）。Claude の判断
const others = new Map(); // 席 → { key, b: 盤 }
const SEND_MS = 250;
let lastSend = 0;
let sendTimer = null;
const packBoard = (b) => b.map((v) => v.toString(36)).join('');
const unpackBoard = (t, n) => (typeof t === 'string' && t.length === n * n && /^[0-9a-o]+$/.test(t) ? [...t].map((c) => parseInt(c, 36)) : null);
const cpuPlan = new Map();
const cpuSeats = new Map(); // 種 → (cpu() が呼ばれた席 → 最後に呼ばれた時刻)（ホストの端末でだけ使う。どの席が CPU か）
// しばらく cpu() が呼ばれていない席は人と見る（代打の CPU から人が戻った席。CPU の席は 0.3秒ごとに呼ばれる。2026-11-24 の Codex の点検）
const CPU_SEEN_MS = 2000;
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
    { key: 'hint', label: 'ヒント', desc: '問題が出て60秒たつと、次に動かす札が光る（自分の画面だけ）', def: true },
    { key: 'blanks', label: '空きマス', desc: '2つ: 空きマスが2つあり、どちらへも札をすべらせられる（右下の2マスを空けたらそろう）', def: 1, choices: [[1, '1つ'], [2, '2つ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { size: '4', level: 'light', rounds: 3, hint: true, blanks: 1, ...rules };
    const size = sizeOf(r);
    const rnd = mulberry32(seed);
    const moves = MOVES[size][r.level === 'full' ? 1 : 0];
    const qs = Array.from({ length: roundsOf(r) }, () => scramble(size, moves, rnd, blanksOfRules(r)));
    return {
      n, seed, rules: r, size, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), passed: Array(n).fill(false), parts: Array(n).fill(null), partN: Array(n).fill(0), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.t === 'part') return null;
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
        s.parts = Array(s.n).fill(null);
        s.partN = Array(s.n).fill(0);
        s.seqs = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        // そろえた人は「札の数＋速さの点」、そろわなかった人は合っている札の数（2026-11-22 本人の依頼）
        const start = s.qs[s.q].board;
        const tiles = start.length - zerosOf(start);
        const speed = pointsOf(s.solved);
        const pts = s.solved.map((v, p) => (v !== null ? tiles + speed[p] : s.parts[p] ?? countOk(start)));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { winners, pts };
        s.log = [...s0.log, { solved: s.solved.slice(), winners, pts }];
        return s;
      }
      return null;
    }
    if (s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    const start = s0.qs[s0.q].board;
    const okCount = (c) => Number.isInteger(c) && c >= 0 && c < start.length - zerosOf(start);
    if (m.t === 'part') {
      if (!okCount(m.c) || !Number.isInteger(m.n) || m.n <= s0.partN[m.p]) return null;
      const s = clone(s0);
      s.step += 1;
      s.parts[m.p] = m.c;
      s.partN[m.p] = m.n;
      return s;
    }
    if (m.t === 'pass') {
      const s = clone(s0);
      s.step += 1;
      s.passed[m.p] = true;
      if (okCount(m.c)) s.parts[m.p] = m.c;
      return s;
    }
    if (m.t !== 'done' || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    const end = replay(start, s0.size, m.seq);
    if (!end || !isSolved(end)) return null;
    const s = clone(s0);
    s.step += 1;
    s.solved[m.p] = Math.round(m.ms);
    // そろえた動かし方を覚える（答えを見せる間に、いちばん速かった人の分を早送りで見せる。2026-11-26 の UI・UX の13回目）
    s.seqs = (s0.seqs ?? Array(s0.n).fill(null)).slice();
    s.seqs[m.p] = m.seq;
    return s;
  },

  // CPU: 軽めは6割・しっかりは4割の問題を、制限時間の2〜7割のころにそろえる（混ぜた動きを逆にたどる）。ただし人がだれかそろえるまではそろえない（2026-11-22）。
  // そろえない問題は同じころにあきらめる。部分点のため、制限時間の15〜40%のころに合っている枚数（最初の枚数から残りの3〜8割ぶん進めた数）を送る
  cpuDelay(s) { return s.phase === 'open' ? 300 : 500; },
  cpu(s, p) {
    if (afterOver(qKey(s), AFTER_MS)) return null; // だれかが解いたあとの短い帯が0になったら答えない（締め切りの猶予の間に答えていた。2026-11-26 の Codex の点検）
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    let seen = cpuSeats.get(s.seed);
    if (!seen) { seen = new Map(); cpuSeats.set(s.seed, seen); if (cpuSeats.size > 20) cpuSeats.delete(cpuSeats.keys().next().value); }
    const nowT = performance.now();
    seen.set(p, nowT);
    const key = qKey(s) + ':' + p;
    const lim = limitOf(s);
    let plan = cpuPlan.get(key);
    if (!plan) {
      const at = (s.size === 3 ? 90000 : lim) * (0.2 + Math.random() * 0.5);
      plan = {
        at, ok: Math.random() < (s.rules.level === 'full' ? 0.4 : 0.6) - (s.size === 5 ? 0.1 : 0),
        lag: 1500 + Math.random() * 6500, partAt: lim * (0.15 + Math.random() * 0.25), frac: 0.3 + Math.random() * 0.5, part: false,
      };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    const q = s.qs[s.q];
    const tiles = q.board.length - zerosOf(q.board);
    const start = countOk(q.board);
    const c = Math.min(tiles - 1, start + Math.round((tiles - start) * plan.frac));
    const times = s.solved.filter((v) => v !== null);
    const first = times.length ? Math.min(...times) : null;
    if (plan.ok && first !== null && t >= Math.max(plan.at, first + plan.lag) && t < lim) {
      return { t: 'done', q: s.q, seq: undoOf(s.size, q.path, zerosOf(q.board)), ms: Math.round(t) };
    }
    // 人（cpu() が呼ばれていない席）が全員終わり、だれもそろえていなければ、CPU もあきらめる（だれかがそろえるのを待ち続けないように）
    // 人が全員終わってだれもそろえていなければ、予定の時刻を待たずにあきらめる（2026-11-24 の Codex の点検。前は予定の時刻まで待っていた）
    const humansDone = [...Array(s.n).keys()].every((x) => nowT - (seen.get(x) ?? -Infinity) < CPU_SEEN_MS || doneOf(s, x));
    if ((first === null && humansDone) || (t >= plan.at && !plan.ok)) return { t: 'pass', q: s.q, c };
    if (!plan.part && t >= plan.partAt) { plan.part = true; return { t: 'part', q: s.q, c, n: s.partN[p] + 1 }; }
    return null;
  },

  // ほかの人の盤（見た目だけ）
  onStream(d, from) {
    if (!d || typeof d.key !== 'string' || typeof d.b !== 'string' || !Number.isInteger(from) || from < 0) return;
    others.set(from, { key: d.key, b: d.b });
    ui?.paintOthers?.();
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
      return s.last.pts[p] ? `<span class="pt-extra">△ +${s.last.pts[p]}</span>` : '<span class="pt-ng">―</span>';
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    if (ui?.mount === mount && root.contains(ui.wrap)) { ui.chips.replaceWith(chips); ui.chips = chips; ui.s = s; ui.paintOthers?.(); return; }

    root.innerHTML = '';
    root.className = 'board kj sl';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips, s };
    wrap.append(chips);
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const two = blanksOfRules(s.rules) === 2;
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${s.size}×${s.size}${two ? '・空きマス2つ' : ''}・全${s.qs.length}問・1問 ${limitOf(s) / 1000}秒まで</div>`;
      return;
    }
    const key = qKey(s);
    const limit = limitOf(s);
    card.innerHTML = '';
    if (s.phase === 'open') {
      since(key);
      // だれかがそろえたら、ホストが締め切るまでの20秒（制限時間のほうが先ならそちら）を出す（前は締め切られるまで「残り130秒」などのままだった。2026-10-28 Codex の点検の指摘）
      if (s.solved.some((v) => v !== null)) {
        card.insertAdjacentHTML('beforeend', '<div class="kj-sub">だれかがそろえた！ もうすぐ締め切り</div>');
        card.append(afterBar(key, limit, AFTER_MS));
      } else card.append(timeBar(key, limit, { secs: true }));
    }
    const n = s.size;
    const start = s.qs[s.q].board;
    const z = zerosOf(start);
    // いちばん速かった人の動かし方を、答えを見せる間に早送りで見せる（2026-11-26 の UI・UX の13回目。puzzle-games.md）。同じ速さが2人なら席の番号の小さい人
    const route = routeOf(s);
    const rp = route ? { board: start.slice(), i: 0 } : null;
    if (s.phase !== 'open') {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = s.last.winners.length ? `いちばん速かったのは ${s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}${route ? `（${route.length}手を早送り）` : ''}` : 'だれもそろえられませんでした（合っている札の数が点）';
      card.append(t);
    }
    if (loc?.key !== key) loc = { key, board: start.slice(), seq: '', sent: false, part: countOk(start), partN: 0, partTimer: null, hint: null };
    // o.canMove も見る: 観戦の人がほかの人の画面を選ぶと me にその席が来るので、見ているだけで動かせて「送った」が残り、
    // あとでその席に入るとそろえても送れなかった（2026-10-28 Codex の点検の指摘）
    const playing = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && !loc.sent;
    const grid = document.createElement('div');
    grid.className = 'sl-grid';
    grid.style.setProperty('--n', n);
    const note = document.createElement('p');
    note.className = 'cc-log';
    // 札は最初に1度だけ作り、動くたびに字と印だけ書き替える（毎回作り直すと遅いスマホで重いため。2026-11-14 本人の報告から。Claude の判断）
    const tiles = [];
    // 観戦の人がほかの人の画面を選んだ（o.watching。me はその人の席）: 大きな盤には、その人から届いた盤を出す
    // （前は観戦の人の端末の loc＝問題の最初の形のまま動かず、その人は小さな盤からも外れて見えなくなった。2026-11-14 Codex の点検の指摘）
    const watched = () => (ui.s.solved[me] !== null ? solvedBoard(n, z) : (others.get(me)?.key === key && unpackBoard(others.get(me).b, n)) || start);
    const useHint = playing && s.rules.hint !== false;
    const draw = () => {
      const b = s.phase === 'open' && me !== null ? (o.watching ? watched() : loc.board) : rp ? rp.board : solvedBoard(n, z);
      if (!tiles.length) for (let i = 0; i < b.length; i++) { const t = document.createElement('div'); tiles.push(t); grid.append(t); }
      const h = useHint && !loc.sent && loc.hint?.board === loc.board.join() ? loc.hint : null;
      b.forEach((v, i) => {
        const t = tiles[i];
        const cls = 'sl-tile' + (v === 0 ? ' blank' : '') + (v !== 0 && v === i + 1 ? ' ok' : '') + (h && h.tile === i ? ' hint' : '') + (h && h.goal === i ? ' goal' : '');
        if (t.className !== cls) t.className = cls;
        const txt = v ? String(v) : '';
        if (t.textContent !== txt) t.textContent = txt;
      });
      note.textContent = s.phase !== 'open' ? '' : me === null || o.watching ? '観戦中' : s.solved[me] !== null ? `そろった！（${secText(s.solved[me])}）ほかの人を待っています`
        : s.passed[me] ? 'あきらめました。ほかの人を待っています' : `動かした回数 ${loc.seq.length}・合っている札 ${countOk(loc.board)}枚${h ? (h.goal === undefined ? '・💡 光った札を動かそう' : '・💡 光った札を点線の場所へ') : ''}`;
    };
    // ヒント（2026-11-22 本人の依頼）: 60秒たったら、近道の次の1手の札を光らせる。近道は1手ごとに探し直さず、その通りに動いている間は続きを使う
    let hintTimer = null;
    const findHint = () => {
      hintTimer = null;
      if (!useHint || loc.sent || !grid.isConnected || since(key) < HINT_MS) return;
      const bs = loc.board.join();
      const h0 = loc.hint;
      if (h0?.board === bs) return;
      let path = h0?.next === bs ? h0.rest : null;
      if (path === null) path = hintPath(loc.board, n);
      // 見つからず、ヒントとちがう1手を動かしただけなら「その1手を戻す ＋ 前の道」を使う（いったん見つけた道を手放さない）
      const last = loc.seq.at(-1);
      if (path === null && h0?.full && last && moveBlank(h0.arr, n, last)?.join() === bs) {
        const L = last.toUpperCase();
        const at = blanksAt(h0.arr)[last === L ? 0 : 1] + STEP[L] * n + DX[L];
        path = letterFor(loc.board, at, BACK[L]) + h0.full;
      }
      if (path) {
        const d = path[0];
        const D = d.toUpperCase();
        const i = blanksAt(loc.board)[d === D ? 0 : 1];
        const tile = i + STEP[D] * n + DX[D];
        loc.hint = { board: bs, arr: loc.board.slice(), full: path, tile, rest: path.slice(1), next: moveBlank(loc.board, n, d).join() };
      } else {
        // 近道が見つからない: まだ正しい場所にない札のうち、いちばん小さい数の札と置き場所
        const v = loc.board.reduce((a, x, i) => (x !== 0 && x !== i + 1 && (a === 0 || x < a) ? x : a), 0);
        loc.hint = { board: bs, tile: loc.board.indexOf(v), goal: v - 1 };
      }
      draw();
    };
    const askHint = () => { if (useHint && !hintTimer && since(key) >= HINT_MS) hintTimer = setTimeout(findHint, 30); };
    if (useHint && since(key) < HINT_MS) setTimeout(askHint, HINT_MS - since(key) + 50);
    const sendBoard = () => {
      if (!o.stream) return;
      const go = () => { lastSend = performance.now(); sendTimer = null; if (loc?.key === key) o.stream({ key, b: packBoard(loc.board) }); };
      if (sendTimer) return;
      const wait = SEND_MS - (performance.now() - lastSend);
      if (wait <= 0) go(); else sendTimer = setTimeout(go, wait);
    };
    // 合っている枚数が変わったら、1秒おいて送る（部分点。2026-11-22）
    const sendPart = () => {
      if (loc.partTimer) return;
      loc.partTimer = setTimeout(() => {
        loc.partTimer = null;
        const c = countOk(loc.board);
        if (loc.key !== key || loc.sent || c === loc.part || !ui?.wrap?.isConnected || ui.s.phase !== 'open' || doneOf(ui.s, me) || isSolved(loc.board)) return;
        loc.part = c;
        loc.partN = Math.max(loc.partN, ui.s.partN[me]) + 1; // 再読み込みで loc が作り直されても、届いている番号より大きくする
        o.onMove({ t: 'part', q: s.q, c, n: loc.partN });
      }, PART_MS);
    };
    // 空きマス i を向き D へ動かす（i の となりの札が空きへ入る）
    const step = (i, D) => {
      // 制限時間を過ぎたら動かさない（締め切りまでの間に動かした札が部分点に入っていた。2026-11-24 の Codex の点検）。
      // だれかがそろえたあとは、短くなった残り時間の帯（afterBar の ':after'）が0になったら動かさない（同日の2回目の点検）
      if (!playing || loc.sent || i < 0 || since(key) >= limit) return false;
      if (s.solved.some((v) => v !== null) && since(key + ':after') >= AFTER_MS) return false;
      const d = letterFor(loc.board, i, D);
      const nb = moveBlank(loc.board, n, d);
      if (!nb) return false;
      loc.board = nb;
      loc.seq += d;
      sendBoard();
      return true;
    };
    const finish = () => {
      if (!isSolved(loc.board) || loc.sent) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      loc.sent = true;
      o.onMove({ t: 'done', q: s.q, seq: loc.seq, ms });
    };
    const after = () => { draw(); finish(); if (!loc.sent) { sendPart(); askHint(); } };
    // 動ける空きマス（向き D に札がある）のうち、near に近いもの。near が無ければ番号の小さいほう
    const blankFor = (D, near = -1) => {
      const can = blanksAt(loc.board).filter((i) => moveBlank(loc.board, n, letterFor(loc.board, i, D)));
      if (near >= 0) can.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
      return can[0] ?? -1;
    };
    ui.press = (D) => { if (step(blankFor(D), D)) after(); };
    // なでて動かす。札の向き（tile）は U・D・L・R、空きマスはその逆へ動く
    let swipe = null;
    grid.classList.toggle('live', playing);
    grid.onpointerdown = (e) => {
      if (!playing || e.isPrimary === false) return;
      const r = grid.getBoundingClientRect();
      const c = Math.floor(((e.clientX - r.left) / r.width) * n), rr = Math.floor(((e.clientY - r.top) / r.height) * n);
      swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, i: c >= 0 && c < n && rr >= 0 && rr < n ? rr * n + c : -1 };
      try { grid.setPointerCapture?.(e.pointerId); } catch { /* 取り込めなくても、指を離した所で決める */ }
    };
    grid.onpointercancel = () => { swipe = null; };
    // 指を離すのを待たず、なでた長さが SWIPE_MIN を超えたところで動かす（離すまで動かないと、遅いスマホで「動かない」と感じるため。2026-11-14。Claude の判断）。
    // 1回なでて動かすのは1回だけ（続けて動かすときは、指を離してもう一度なでる。前と同じ）
    grid.onpointermove = (e) => {
      if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
      if (Math.hypot(e.clientX - swipe.x, e.clientY - swipe.y) < SWIPE_MIN) return;
      swipe.done = true;
      act(swipe, e);
    };
    grid.onpointerup = (e) => {
      const sw = swipe;
      swipe = null;
      if (!sw || sw.id !== e.pointerId || sw.done) return;
      act(sw, e);
    };
    const act = (sw, e) => {
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      if (Math.hypot(dx, dy) < SWIPE_MIN) return;
      const tile = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U';
      const D = BACK[tile];
      // なで始めた札から、なでた向きへたどって最初にある空きマスまでの札を、まとめてすべらせる
      if (sw.i >= 0 && loc.board[sw.i] !== 0) {
        let r = Math.floor(sw.i / n), c = sw.i % n, k = 0, z0 = -1;
        for (;;) {
          r += STEP[tile]; c += DX[tile]; k += 1;
          if (r < 0 || r >= n || c < 0 || c >= n) break;
          if (loc.board[r * n + c] === 0) { z0 = r * n + c; break; }
        }
        if (z0 >= 0) {
          let at = z0;
          for (; k > 0; k--) { if (!step(at, D)) break; at += STEP[D] * n + DX[D]; }
          after();
          return;
        }
      }
      if (step(blankFor(D, sw.i), D)) after();
    };
    draw();
    askHint();
    if (rp) {
      replaySteps(key, grid, route.length, Math.min(2800, Math.max(900, route.length * 90)), (k) => {
        if (k < rp.i) Object.assign(rp, { board: start.slice(), i: 0 });
        for (; rp.i < k; rp.i++) rp.board = moveBlank(rp.board, n, route[rp.i]) ?? rp.board;
        draw();
      });
    }
    wrap.append(grid, note);
    // ほかの人の盤を小さく並べる（2026-11-14 本人の依頼。並べ方は Claude の判断: 自分の盤の下に名前つきで。そろった人は ✓、あきらめた人は「あきらめ」の札（2026-11-22 本人の依頼））
    // 部屋を出た人・待合室へ行った人の席（o.sub。CPU が代わりに打つ）も並べる。o.cpu だけで外すと、そのあいだに描き直した端末では
    // その人が戻っても誰かがそろえるまで出てこなかった（2026-11-14 Codex の点検の指摘。席の顔ぶれは1問の間変わらないので作り直さなくてよい）
    const seats = s.phase === 'open' ? [...Array(s.scores.length).keys()].filter((p) => p !== me && (!o.cpu?.[p] || o.sub?.[p])) : [];
    ui.paintOthers = () => { if (o.watching && s.phase === 'open') draw(); };
    if (seats.length) {
      const row = document.createElement('div');
      row.className = 'sl-others';
      const minis = seats.map((p) => {
        const box = document.createElement('div');
        box.className = 'sl-mini';
        const g = document.createElement('div');
        g.className = 'sl-mini-grid';
        g.style.setProperty('--n', n);
        const cells = [...Array(n * n)].map(() => g.appendChild(document.createElement('span')));
        const cap = document.createElement('div');
        cap.className = 'sl-mini-cap';
        cap.textContent = o.names?.[p] ?? '';
        box.append(g, cap);
        row.append(box);
        return { p, box, cells };
      });
      const paintBig = ui.paintOthers;
      ui.paintOthers = () => {
        paintBig();
        const st = ui.s; // 同じ場面のうちの描き直しでは作り直さないので、いまの局面は ui.s で見る
        for (const m of minis) {
          const got = others.get(m.p);
          const b = st.solved[m.p] !== null ? solvedBoard(n, z) : (got?.key === key && unpackBoard(got.b, n)) || start;
          m.box.classList.toggle('done', st.solved[m.p] !== null);
          m.box.classList.toggle('gave', !!st.passed[m.p]);
          b.forEach((v, i) => {
            const c = m.cells[i];
            const cls = v === 0 ? 'blank' : v === i + 1 ? 'ok' : '';
            if (c.className !== cls) c.className = cls;
            const txt = v ? String(v) : '';
            if (c.textContent !== txt) c.textContent = txt;
          });
        }
      };
      ui.paintOthers();
      wrap.append(row);
    }
    if (playing) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn ghost kj-pass';
      pass.textContent = 'あきらめる（この問題をとばす）';
      pass.onclick = () => { pass.disabled = true; o.onMove({ t: 'pass', q: s.q, c: countOk(loc.board) }); };
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
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.pts?.[me] ? `△ ${x.pts[me]}点` : '❌';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${mine}</span><span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
