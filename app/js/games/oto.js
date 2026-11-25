// 音当て。鳴った音が ド・レ・ミ・ファ・ソ・ラ・シ のどれかを、7つの鍵盤から早押しで当てる。2〜10人・足りない分は CPU（弱め）。
// 2026-11-20 本人の決定（Claude が出した案「音の高さくらべ」を、本人が「ドレミファソラシからどの音かあてる」に変えて選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 7つのボタン（ド〜シ）から1つ押す。1問に1回だけ。正解した速い順に 3・2・1点。10問（詳細設定で 5・20問）。
//   - 問題の音の前に、手がかりの「ド」を鳴らす。詳細設定「手がかり」で「ドを鳴らさない（むずかしい）」も選べる（鍵は level）。
//   - 音は白い鍵盤の1オクターブ（ド=C4〜シ=B4）だけ。黒い鍵盤の音は出さない（2026-11-24 から詳細設定「黒い鍵盤も」で出せる。下）。問題の音は2回続けて鳴らす。
//   - 音色は Claude がプログラムで作る（tools/make-notes.mjs → app/sounds/o_<do|re|mi|fa|so|ra|si>.wav）。音色はピアノ風（`node tools/make-notes.mjs piano`。2026-11-23 に本人が試聴して選んだ）。
// Claude の判断:
//   - 鳴らす時刻（問題が出てからの ms）: 手がかりありは ド 0.3秒 → 問題の音 1.5秒・2.5秒、なしは問題の音 0.3秒・1.3秒。
//     押せるのは1回目の問題の音が鳴ってから（ASK）。速さ（ms）はほかの早押しと同じく、各自の端末で問題が出てから測る（全員に同じだけ足されるので比べるのに差は出ない）。
//   - 1問の制限時間は押せるようになってから10秒。だれかが正解したら5秒で締め切る。全員が答えたら1.5秒。答えを見せる間は3.5秒で、そのとき正しい音をもう一度鳴らす。
//   - 問題の音は種と何問目かからくじで決める（全員同じ）。前の問題と同じ音は続けない。
//   - CPU は押せるようになってから 1.5〜6秒で答え、5割当てる。外すときは正しい音のとなりの音を押す（聞きまちがいらしく）。
//   - 音を消している人には「🔇 音が消えています」と出す（リズムまねの「耳だけ」と同じ）。
// 2026-11-24 の46回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「黒い鍵盤も」（鍵 black。なし（最初）・あり）: ド♯・レ♯・ファ♯・ソ♯・ラ♯（C#4〜A#4）も問題に出て、12の音から当てる。
//     鍵盤は本物と同じく白い鍵盤の間の上に黒い鍵盤を重ねる。音は `node tools/make-notes.mjs piano app/sounds --black` で作ったピアノ風（白い鍵盤と同じ式）。
//     音の番号は 0〜6 が ド〜シ のまま、7〜11 が ド♯〜ラ♯（なしのときの問題と手は前と全く同じ）。ありのときは12の音から同じくじ（前と同じ音は続けない）で、別の乱数を使う。
//     手がかりの「ド」はそのまま。CPU の外し方は、鍵盤で となりの音（黒い鍵盤もふくめて半音となり）。
// 2026-11-25 の47回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「和音」（鍵 chord。なし（最初）・あり）: 問題は高さの違う2つの音を同時に鳴らし、2つとも当てたら正解。鍵盤を2つ押すと答えになる
//     （1つ目は選んだだけで、同じ鍵盤をもう一度押すと取り消せる。2つ目を押した時刻で速さを測る）。1問に1回だけ・点は今までと同じ（2つとも合っていたときだけ）。
//     2つの音は、なしは ド〜シ の7つ、黒い鍵盤もありなら12の音から選ぶ（どの2つでもよい。前の問題と同じ組は続けない）。和音のときは別の乱数を使い、なしのときの問題は前と全く同じ。
//     手がかりの「ド」はそのまま。2つの音はそれぞれ 0.75 の大きさで鳴らす（重なって大きくなりすぎないように）。
//     CPU は5割当て、外すときは2つのうち1つを鍵盤でとなりの音にずらす。難しさなので、おまかせでは抽選しない（`KEEP_KEYS` の chord）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（なぞなぞ早押しと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 0〜6（ド〜シ）・7〜11（ド♯〜ラ♯。黒い鍵盤もありのとき）か、和音のときは2つの違う音の配列, ms }

import { mulberry32, esc } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';
import { play, isMuted, wantSounds } from '../sound.js';

export const NOTE_NAMES = ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ', 'ド♯', 'レ♯', 'ファ♯', 'ソ♯', 'ラ♯'];
export const NOTE_FILES = ['o_do', 'o_re', 'o_mi', 'o_fa', 'o_so', 'o_ra', 'o_si'];
export const BLACK_FILES = ['o_dos', 'o_res', 'o_fas', 'o_sos', 'o_ras'];
const ALL_FILES = [...NOTE_FILES, ...BLACK_FILES];
export const CHROMA = [0, 7, 1, 8, 2, 3, 9, 4, 10, 5, 11, 6]; // 低い順（ド ド♯ レ レ♯ ミ ファ ファ♯ ソ ソ♯ ラ ラ♯ シ）の音の番号
const BLACK_AT = [1, 2, 4, 5, 6]; // 黒い鍵盤（7〜11）が、左から何番目の白い鍵盤の左ふちに乗るか
export const blackOn = (r) => r.black === 'on';
export const chordOn = (r) => r.chord === 'on';
// 答え・問題は、和音のときは2つの音の配列（低い順）。1つの音でも配列でも同じに扱う
const keysOf = (x) => (Array.isArray(x) ? x : [x]);
const nameOf = (x) => keysOf(x).map((c) => NOTE_NAMES[c]).join('・');
const byPitch = (a, b) => CHROMA.indexOf(a) - CHROMA.indexOf(b);
export const sameAns = (a, b) => keysOf(a).length === keysOf(b).length && keysOf(a).every((c) => keysOf(b).includes(c));
const ROUNDS = [[10, '10問'], [5, '5問'], [20, '20問']];
const LEVELS = [['mid', 'ドを鳴らしてから'], ['hard', 'ドを鳴らさない（むずかしい）']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 5000;
const ANSWER_MS = 10000; // 押せるようになってからの制限時間
// 鳴らす時刻（問題が出てからの ms）。ref = 手がかりのド
export const timesOf = (level) => (level === 'hard' ? { ref: null, q: [300, 1300] } : { ref: 300, q: [1500, 2500] });
export const askOf = (s) => timesOf(s.rules.level).q[0]; // 押せるようになる時刻
const limitOf = (s) => askOf(s) + ANSWER_MS;

const qKey = (s, q = s.q) => `oto:${s.seed}:${s.rules.level}:${q}${blackOn(s.rules) ? ':b' : ''}${chordOn(s.rules) ? ':c' : ''}`; // 手がかりの有無で鳴らす時刻が変わるので鍵に入れる（数のきまり当ての qKey と同じ理由）。黒い鍵盤も・和音では問題が変わるので入れる
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];

// 全部の問題の音（0〜6）。種から作るので全員同じ。前の問題と同じ音は続けない
export function notesOf(seed, n, black = false, chord = false) {
  if (chord) {
    // 和音: 2つの違う音（低い順）。なし・黒い鍵盤もとは別の乱数。前の問題と同じ組は続けない
    const pool = black ? CHROMA : [0, 1, 2, 3, 4, 5, 6];
    const rnd = mulberry32((seed * 157 + (black ? 29 : 23)) >>> 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let pair;
      do {
        const a = Math.floor(rnd() * pool.length);
        let b = Math.floor(rnd() * (pool.length - 1));
        if (b >= a) b++;
        pair = [pool[Math.min(a, b)], pool[Math.max(a, b)]];
      } while (i > 0 && sameAns(pair, out[i - 1]));
      out.push(pair);
    }
    return out;
  }
  if (black) {
    // 12の音から（なしのときとは別の乱数）
    const rnd = mulberry32((seed * 149 + 19) >>> 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let x = Math.floor(rnd() * 12);
      if (i > 0 && CHROMA[x] === out[i - 1]) x = (x + 1 + Math.floor(rnd() * 11)) % 12;
      out.push(CHROMA[x]);
    }
    return out;
  }
  const rnd = mulberry32((seed * 131 + 7) >>> 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let x = Math.floor(rnd() * 7);
    if (i > 0 && x === out[i - 1]) x = (x + 1 + Math.floor(rnd() * 6)) % 7;
    out.push(x);
  }
  return out;
}

// この端末で、その問題の音を鳴らす予約をしたか（描き直しのたびに鳴らさないように）
const rung = new Set();
// いま画面に出ている音当ての盤（描き直すたびに入れ替わる）と、その問題の鍵。鳴らす時刻に、まだその問題の盤が出ているときだけ鳴らす
// （問題が出てから音が鳴るまでの間に待合室やホームへ移ると、予約した音がそちらで鳴っていた。2026-11-24 の Codex の点検）
let live = { wrap: null, key: null };
function ring(key, plan, qkey = key) {
  if (rung.has(key)) return;
  rung.add(key);
  if (rung.size > 200) rung.delete(rung.keys().next().value);
  const t0 = since(key);
  for (const [at, note, vol = 1] of plan) {
    if (at < t0 - 50) continue;
    setTimeout(() => { if (live.wrap?.isConnected && live.key === qkey) play(ALL_FILES[note], vol); }, Math.max(0, at - t0));
  }
}
// 問題の音を鳴らす予定（和音は2つの音を同じ時刻に、少し小さく）
const notePlan = (times, right) => times.flatMap((at) => keysOf(right).map((c) => [at, c, Array.isArray(right) ? 0.75 : 1]));
let pick = { key: null, c: null }; // 和音で1つ目に選んだ鍵盤（描き直しで消えないよう外に持つ）
const cpuPlan = new Map();

export default {
  id: 'oto',
  name: '音当て',
  icon: '🎹',
  desc: '鳴った音がドレミファソラシのどれかを当てる。早く正解した人ほど高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
    { key: 'level', label: '手がかり', desc: '問題の音の前に「ド」を鳴らすか。鳴らさないと、音だけで当てる', def: 'mid', choices: LEVELS },
    { key: 'black', label: '黒い鍵盤も', desc: 'ド♯・レ♯・ファ♯・ソ♯・ラ♯ も出て、12の音から当てる（むずかしい）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'chord', label: '和音', desc: '2つの音が同時に鳴り、鍵盤を2つ押して2つとも当てる（むずかしい）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 10, level: 'mid', ...rules };
    if (!LEVELS.some(([v]) => v === r.level)) r.level = 'mid';
    return {
      n, seed, rules: r, notes: notesOf(seed, roundsOf(r), blackOn(r), chordOn(r)), q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), said: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return null; // 問題が出るときは音を鳴らさない（すぐあとに鳴る問題の音とまざるため）
    if (m.p !== me) return null;
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.notes.length}`;
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
        if (s.q + 1 >= s.notes.length) { s.phase = 'end'; return s; }
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
    const top = blackOn(s0.rules) ? 11 : 6;
    const okKey = (c) => Number.isInteger(c) && c >= 0 && c <= top;
    if (chordOn(s0.rules) ? !(Array.isArray(m.c) && m.c.length === 2 && m.c.every(okKey) && m.c[0] !== m.c[1]) : !okKey(m.c)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= askOf(s0)) || m.ms > limitOf(s0) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = Array.isArray(m.c) ? [...m.c].sort(byPitch) : m.c;
    if (sameAns(m.c, s0.notes[s0.q])) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const right = s.notes[s.q];
      const nearOf = (x) => (blackOn(s.rules)
        ? [CHROMA.indexOf(x) - 1, CHROMA.indexOf(x) + 1].filter((y) => y >= 0 && y < 12).map((y) => CHROMA[y])
        : [x - 1, x + 1].filter((y) => y >= 0 && y <= 6));
      const pickOne = (xs) => xs[Math.floor(Math.random() * xs.length)];
      const at = askOf(s) + 1500 + Math.random() * 4500; // 乱数を引く順は前と同じ（時刻 → 当てるか → 外す音）
      let c;
      if (Math.random() < 0.5) c = right;
      else if (Array.isArray(right)) {
        // 和音: 2つのうち1つを、もう1つと重ならないとなりの音にずらす
        let i = Math.floor(Math.random() * 2);
        // 端の音でとなりがもう1つの音しか無いとき（白い鍵盤の「ド・レ」など）は、もう1つの音をずらす（そのままだと正解を押してしまい、当てる割合が5割を超えた。2026-11-25 の Codex の点検）
        if (!nearOf(right[i]).some((y) => y !== right[1 - i])) i = 1 - i;
        const near = nearOf(right[i]).filter((y) => y !== right[1 - i]);
        c = near.length ? (i === 0 ? [pickOne(near), right[1]] : [right[0], pickOne(near)]) : right;
      } else c = pickOne(nearOf(right));
      plan = { at, c };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limitOf(s) ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    wantSounds(blackOn(s.rules) ? ALL_FILES : NOTE_FILES);
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? `<span class="pt-ng">× ${nameOf(s.said[p])}</span>` : '<span class="pt-ng">―</span>';
    };
    root.innerHTML = '';
    root.className = 'board kj ot';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true, log: s.log }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const chord = chordOn(s.rules);
    if (s.phase === 'ready') {
      const how = chord
        ? (s.rules.level === 'hard' ? '同時に鳴る2つの音を当てよう（鍵盤を2つ押す）' : 'はじめに「ド」、つぎに問題の2つの音が同時に2回鳴ります（鍵盤を2つ押す）')
        : (s.rules.level === 'hard' ? '鳴った音を当てよう' : 'はじめに「ド」、つぎに問題の音が2回鳴ります');
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${how}・全${s.notes.length}問</div>`;
      if (isMuted()) card.insertAdjacentHTML('beforeend', '<div class="kj-sub ot-mute">🔇 音が消えています。上の 🔇 を押して音を出してください</div>');
      return;
    }
    const key = qKey(s);
    const right = s.notes[s.q];
    const shown = s.phase !== 'open';
    const tm = timesOf(s.rules.level);
    live = { wrap, key };
    if (!shown) ring(key, [...(tm.ref !== null ? [[tm.ref, 0]] : []), ...notePlan(tm.q, right)]);
    else ring(key + ':ans', notePlan([300], right), key);
    const t = since(key);
    const head = document.createElement('div');
    head.className = 'ot-head';
    const wave = document.createElement('div');
    wave.className = 'ot-wave';
    wave.textContent = '🎵';
    head.append(wave);
    const line = document.createElement('div');
    line.className = 'ox-q ot-q';
    if (shown) line.innerHTML = `答えは <b>${esc(nameOf(right))}</b>`;
    else line.textContent = chord ? 'この2つの音はどれとどれ？' : 'この音はどれ？';
    head.append(line);
    card.append(head);
    if (!shown) {
      // 何が鳴っているかの字（描き直しても、問題が出てからの時間で同じ所から続く）
      const step = document.createElement('div');
      step.className = 'kj-sub ot-step';
      const what = chord ? '問題の2つの音' : '問題の音';
      const plan = [...(tm.ref !== null ? [[tm.ref, '手がかりの「ド」']] : []), [tm.q[0], `${what}（1回目）`], [tm.q[1], `${what}（2回目）`], [tm.q[1] + 900, 'どれだったかな？']];
      const tick = () => {
        if (!step.isConnected && step.dataset.on) return;
        step.dataset.on = '1';
        const now = since(key);
        const cur = plan.filter(([at]) => now >= at).at(-1);
        step.textContent = cur ? cur[1] : '聞いて…';
        wave.classList.toggle('on', !!cur && cur !== plan.at(-1));
        const nx = plan.find(([at]) => at > now);
        if (nx) setTimeout(tick, nx[0] - now + 10);
      };
      tick();
      card.append(step);
      if (isMuted()) card.insertAdjacentHTML('beforeend', '<div class="kj-sub ot-mute">🔇 音が消えています。上の 🔇 を押して音を出してください</div>');
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`);
      card.append(anySolved ? afterBar(key, limitOf(s), AFTER_MS) : timeBar(key, limitOf(s), { secs: true }));
    } else {
      const sub = document.createElement('div');
      sub.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      sub.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(sub);
    }
    if (document.activeElement?.classList?.contains('ot-key')) document.activeElement.blur();
    const canNow = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && t < limitOf(s);
    const open = canNow && t >= askOf(s);
    const keys = document.createElement('div');
    const black = blackOn(s.rules);
    keys.className = 'ot-keys' + (black ? ' blk' : '');
    const mine = me !== null ? s.said[me] : null;
    const inRight = (c) => keysOf(right).includes(c);
    const inMine = (c) => mine !== null && keysOf(mine).includes(c);
    if (pick.key !== key) pick = { key, c: null };
    const btns = NOTE_NAMES.slice(0, black ? 12 : 7).map((nm, c) => {
      const b = document.createElement('button');
      b.type = 'button';
      const ok = inRight(c) && (shown || inMine(c));
      const ng = inMine(c) && !inRight(c);
      b.className = 'ot-key' + (c >= 7 ? ' bk' : '') + (ok ? ' ok' : ng ? ' ng' : !canNow ? ' off' : '') + (canNow && pick.c === c ? ' sel' : '');
      if (c >= 7) b.style.left = `${(BLACK_AT[c - 7] / 7) * 100}%`; // 白い鍵盤の間の上に重ねる
      b.innerHTML = `<span>${nm}</span>`;
      b.disabled = !open;
      const hit = (e) => {
        if (!canNow || keys.dataset.sent) return;
        e.preventDefault();
        const ms = Math.round(since(key));
        if (ms < askOf(s) || ms >= limitOf(s)) return;
        let ans = c;
        if (chord) {
          // 和音: 1つ目は選ぶだけ（同じ鍵盤をもう一度押すと取り消し）。2つ目で答える
          if (pick.c === null || pick.c === c) {
            pick = { key, c: pick.c === c ? null : c };
            btns.forEach((y, i) => y.classList.toggle('sel', pick.c === i));
            note.textContent = pick.c === null ? '鍵盤を2つ押して答える（1問に1回だけ）' : 'あと1つ押す';
            return;
          }
          ans = [pick.c, c];
        }
        keys.dataset.sent = '1';
        btns.forEach((y) => { y.disabled = true; });
        o.onMove({ t: 'ans', q: s.q, c: ans, ms });
      };
      b.onpointerdown = hit;
      b.onclick = (e) => { if (e.detail === 0) hit(e); };
      return b;
    });
    keys.append(...btns);
    wrap.append(keys);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (s.phase === 'open' && s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.phase === 'open' && s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else if (s.phase === 'open' && chord) note.textContent = pick.c !== null && canNow ? 'あと1つ押す' : '鍵盤を2つ押して答える（1問に1回だけ）';
    else if (s.phase === 'open') note.textContent = '答えられるのは1回だけ';
    wrap.append(note);
    if (s.phase === 'shown') wrap.append(speedLine(o, s.solved, key));
    if (canNow && !open) setTimeout(() => { if (keys.isConnected && !keys.dataset.sent) btns.forEach((y) => { y.disabled = false; }); }, askOf(s) - t);
    if (canNow) {
      setTimeout(() => {
        if (!keys.isConnected || keys.dataset.sent) return;
        btns.forEach((y) => { y.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, limitOf(s) - t));
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
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.said[me] !== null ? `❌ ${nameOf(x.said[me])}` : '―';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="ox-rv"><b>${nameOf(s.notes[q])}</b></span><span>${esc(mine)}</span>`
        + `<span class="mk-rv-who">${fast.length ? '⚡' + esc(fast.join('・')) : '―'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
