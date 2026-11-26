// 金魚すくい。泳ぐ金魚をポイですくう。水に長く入れたり速く動かしたりするとポイが破れる。1〜10人・足りない分は CPU（弱め）。
// 2026-11-04 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 押している間はポイが水の中にあり、指を離すと持ち上がって、上にいた金魚が取れる。ポイは水の中にいる時間と、速く動かすほど早く破れる。
//   - 全員が同時に自分の画面で遊び、金魚の動きは全員同じにする。ポイは3枚、時間は60秒。赤い金魚1点・黒い出目金3点・金色の金魚5点（まれ）。
// Claude の判断:
//   - 水そうは横1・たて0.7の広さ（この単位で書く）。金魚は16匹で、どれもゆっくり8の字のように泳ぐ（動き方は種から決まり、全員同じ）。
//     すくった金魚は自分の水そうからだけ消え、2.5秒後に同じ所から次の金魚が出てくる（その金魚の色と動きも種から決まる）。
//   - 金魚の色は 赤 72%・黒 22%・金 6%。
//   - ポイの丈夫さは1。水の中にいると1秒に0.2減る（ずっと入れていると5秒で破れる）。横幅の0.5倍より速く動かすと、その速さに応じてさらに減る（1秒に横幅ぶん動かし続けると2秒ほどで破れる）。
//     持ち上げるとき、上にいた金魚の重さ（赤0.12・黒0.22・金0.18）だけ減る。足りなければ破れて金魚は逃げる。一度にすくえるのは3匹まで。
//   - 破れたら1秒で次のポイ。3枚とも破れたらおしまい（{ t: 'out' } を送る）。全員おしまいになったら1.2秒で終わる。
//   - ポイが破れるたびに { t: 'break', n: 何枚目 } も送り、局面に破れた枚数（broke。破れるまで局面に持たない）を数える。ポイの数だけ破れたらおしまい（out）。
//     端末の中だけで数えていたので、読み込み直すとポイがそろい直し、部屋を出た人の代わりの CPU も最初の枚数から始めていた（2026-11-04 Codex の点検の指摘）。
//   - すくった点は各自の端末で決め、すくうたびに { t: 'scoop', n: 何回目, v: 点, c: 匹数 } を送る（大縄とびと同じく、各自の画面の時間で決める）。
//     局面の数が端末の中で数えた数より少ないあいだは0.5秒ごとに、届いていない分をまとめて送り直す（2色爆弾サバイバルと同じ。ゲストの手がすれ違って消えることがあるため）。
//   - 指で遊ぶときは、ポイを指の少し上に出す（指で金魚が隠れないように）。
//   - CPU は2.5〜4.5秒に1回すくおうとし、5割5分ですくえる（1匹）。1回ごとに2割2分でポイが破れる（局面の破れた枚数から続ける）。
// 2026-11-04 の34回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「ポイの数」（鍵は poi）: 1枚・3枚（最初。前と同じ）・5枚。CPU のポイの数も同じ。
//   - 詳細設定「時間」（2026-11-06 の36回目の案。鍵は time）: 30秒・60秒（最初）・90秒。60秒のときは局面に time を持たない（前と全く同じ形）。
//     CPU の腕前（すくう間・入る見込み・破れる見込み）は変えない。おまかせでは抽選しない（main.js の KEEP_KEYS の time）。
//   - 詳細設定「ぬし」（鍵は nushi）: なし（最初）・あり。生まれる金魚の4%が大きな「ぬし」（10点・重さ0.85）になる。
//     重いので、水に入れてすぐ（およそ0.75秒のうちに）持ち上げないとポイが破れて逃げる。ほかの金魚と一緒にはすくいにくい。
//     ぬしかどうかは金魚の色と動きを決めたあとの乱数で決める（なしのときの金魚は前と全く同じ）。ぬしはゆっくり泳ぐ。CPU はすくおうとした回の1%でぬし（10点）をすくう。
// 2026-11-26 の48回目の案（本人が選んだ。案の名前は「同じ水そう」。分かれ目は Claude の判断）: 詳細設定「水そう」（1人ずつ（最初）・みんなで1つ。鍵は share）。
//   みんなで1つでは、だれかがすくった金魚はみんなの水そうから消え、2.5秒後にその場所から次の金魚が出る（1人ずつのときの「自分の水そうからだけ消える」の代わり）。
//   - 局面に、金魚の場所（slot）ごとの今の代（gen）・次の金魚が出る時刻（at）と、すくわれた金魚ごとの [すくった席, ms]（own。鍵は「場所:代」）を持つ。
//   - すくう手に、すくった金魚（f: [[場所, 代], …]）と、各自の画面で遊び始めてからの時刻（ms）を入れる。点は手の v でなく、局面が金魚の種類から数える。
//   - 同じ金魚を2人がすくったら、ms の小さい人のもの（同じなら席の番号の小さい人）。あとから早い手が届いたら、点と匹数をその人へ移す。
//     届いた順で決めない（流しそうめんと同じ。通信の遅い人が不利にならず、手を足し直しても全員の端末で同じになる）。取られた金魚の手も回の数（cnt）は進める（手が止まらないように）。
//   - ほかの人がすくった所には、その人の色の輪を0.7秒出す。自分がすくった金魚が先に取られていたら「先を越された…」を1.2秒出す。
//   - CPU は、その時に見えている金魚から1匹をくじで選んですくう（すくえる見込み・間は1人ずつのときと同じ）。
//   1人ずつのときは局面に gen・at・own を持たず、手も前と全く同じ形（tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'scoop', n, v, c（みんなで1つのときは f, ms も） } / { p, t: 'break', n } / { p, t: 'out' }

import { mulberry32 } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const READY_MS = 3000;
const LIMIT = 60000;
const TIMES = [[60, '60秒'], [30, '30秒'], [90, '90秒']];
export const limitOf = (s) => (TIMES.some(([v]) => v === s.time) ? s.time * 1000 : LIMIT);
const GRACE_MS = 1500;
export const TANK_H = 0.7;
export const NF = 16;
const RESPAWN = 2500;
const POIS = [[1, '1枚'], [3, '3枚'], [5, '5枚']];
export const poisOf = (s) => (POIS.some(([v]) => v === s.poi) ? s.poi : 3);
const NUSHI_RATE = 0.04;
const POI_R = 0.085;
export const DRAIN = 0.2; // 水の中で1秒に減る丈夫さ
export const FAST = 0.5; // これより速く動かすと減る（横幅/秒）
const FAST_K = 0.6;
export const KINDS = [
  { v: 1, w: 0.12, r: 0.034, col: '#e8452c', name: '赤' },
  { v: 3, w: 0.22, r: 0.044, col: '#262626', name: '黒' },
  { v: 5, w: 0.18, r: 0.04, col: '#f2b705', name: '金' },
  { v: 10, w: 0.85, r: 0.075, col: '#d8322a', name: 'ぬし' }, // ぬしありのときだけ
];
const maxV = (s) => (s.nushi ? 10 : 5); // 1匹の点のいちばん大きい数

// slot 番目の g 代目の金魚（種から。全員同じ）
export function fishOf(seed, slot, g, nushi = false) {
  const rnd = mulberry32((seed ^ Math.imul(slot * 977 + g * 131 + 3, 0x85ebca6b)) >>> 0);
  const r = rnd();
  const kind = r < 0.06 ? 2 : r < 0.28 ? 1 : 0;
  const ax = 0.08 + rnd() * 0.22, ay = 0.05 + rnd() * 0.12;
  const f = {
    kind,
    cx: ax + 0.04 + rnd() * (0.92 - 2 * ax), cy: ay + 0.05 + rnd() * (TANK_H - 0.1 - 2 * ay), ax, ay,
    wx: (kind === 1 ? 0.0003 : 0.0004) + rnd() * 0.0005, wy: 0.0006 + rnd() * 0.0007, px: rnd() * 6.283, py: rnd() * 6.283,
  };
  if (nushi && rnd() < NUSHI_RATE) Object.assign(f, { kind: 3, wx: f.wx * 0.6, wy: f.wy * 0.6 });
  return f;
}
// t ミリ秒の位置
export const posOf = (f, t) => [f.cx + f.ax * Math.sin(f.wx * t + f.px), f.cy + f.ay * Math.sin(f.wy * t + f.py)];
// 持ち上げたとき: 丈夫さ dur で、乗っている金魚 kinds（KINDS の番号）をすくえるか。返り値は残りの丈夫さ（破れたら null）
export function lift(dur, kinds) {
  const load = kinds.reduce((a, k) => a + KINDS[k].w, 0);
  return dur - load < 0 ? null : dur - load;
}
// 水の中で dt 秒、速さ v（横幅/秒）で動かしたときに減る丈夫さ
export const wear = (dt, v) => dt * DRAIN + Math.max(0, v - FAST) * dt * FAST_K;

const key = (s) => `kingyo:${s.seed}`;
const pointsText = (s) => (s.nushi ? '赤1点 黒3点 金5点 ぬし10点' : '赤1点 黒3点 金5点');
const clone = (s) => ({
  ...s, scores: s.scores.slice(), cnt: s.cnt.slice(), fish: s.fish.slice(), out: s.out.slice(), ...(s.broke ? { broke: s.broke.slice() } : {}),
  ...(s.share ? { gen: s.gen.slice(), at: s.at.slice(), own: { ...s.own } } : {}),
});
const brokeOf = (s, p) => s.broke?.[p] ?? 0; // 破れたポイの枚数
const RING_MS = 700;
const LOST_MS = 1200;

// みんなで1つの水そうで、すくう手を当てる（s は写したもの。書き換える）
function shareScoop(s, p, f, ms) {
  for (const x of f) {
    if (!Array.isArray(x) || x.length !== 2) continue;
    const [i, g] = x;
    if (!Number.isInteger(i) || i < 0 || i >= NF || !Number.isInteger(g) || g < 0 || g > s.gen[i]) continue;
    const k = `${i}:${g}`;
    const prev = s.own[k];
    const v = KINDS[fishOf(s.seed, i, g, s.nushi).kind].v;
    if (!prev) { // まだだれもすくっていない（g は今の代）
      s.own[k] = [p, ms];
      s.gen[i] += 1;
      s.at[i] = ms + RESPAWN;
      s.scores[p] += v;
      s.fish[p] += 1;
    } else if (ms < prev[1] || (ms === prev[1] && p < prev[0])) { // あとから届いたが、こちらが先にすくっていた
      s.own[k] = [p, ms];
      s.scores[prev[0]] -= v;
      s.fish[prev[0]] -= 1;
      s.scores[p] += v;
      s.fish[p] += 1;
      if (g === s.gen[i] - 1) s.at[i] = ms + RESPAWN;
    }
  }
}

const cpuPlan = new Map();
let loc = null; // この端末の記録 { key, gen, back, dur, left, broke, brokeAt, scoops: [{ v, c }], out }
let ui = null;

export default {
  id: 'kingyo',
  name: '金魚すくい',
  icon: '🐠',
  desc: '泳ぐ金魚をポイですくう。水に長く入れるとポイが破れる。60秒で多くすくった人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 10,
  settings: [
    { key: 'poi', label: 'ポイの数', desc: '1人が使えるポイの枚数', def: 3, choices: POIS },
    { key: 'time', label: '時間', desc: '金魚をすくえる時間', def: 60, choices: TIMES },
    { key: 'nushi', label: 'ぬし', desc: 'ごくまれに大きな「ぬし」（10点）が出る。重いので、水に入れてすぐ持ち上げないとポイが破れる', def: false },
    { key: 'share', label: '水そう', desc: 'みんなで1つにすると、だれかがすくった金魚はみんなの水そうから消える（同じ金魚は先にすくった人のもの）', def: false, choices: [[false, '1人ずつ'], [true, 'みんなで1つ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, phase: 'ready', scores: Array(n).fill(0), cnt: Array(n).fill(0), fish: Array(n).fill(0), out: Array(n).fill(false), step: 0 };
    // 最初の値（3枚・ぬしなし）のときは前と全く同じ形にする
    if (POIS.some(([v]) => v === rules.poi) && rules.poi !== 3) s.poi = rules.poi;
    if (rules.nushi === true) s.nushi = true;
    if (TIMES.some(([v]) => v === rules.time) && rules.time !== 60) s.time = rules.time;
    if (rules.share === true) Object.assign(s, { share: true, gen: Array(NF).fill(0), at: Array(NF).fill(0), own: {} });
    return s;
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && (p === undefined || !s.out[p]); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'start' ? 'question' : null;
    return null; // 自分の音は端末の中で鳴らす（手が戻るのを待たない）
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '金魚をすくおう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') {
      if (s.out.every((x) => x)) return { key: 'allout', ms: 1200, move: { t: 'end' } };
      return { key: 'play', ms: limitOf(s) + GRACE_MS, move: { t: 'end' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'start' && s0.phase === 'ready') { const s = clone(s0); s.step += 1; s.phase = 'play'; return s; }
      if (m.t === 'end' && s0.phase === 'play') { const s = clone(s0); s.step += 1; s.phase = 'end'; return s; }
      return null;
    }
    if (s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (m.t === 'out') {
      if (s0.out[m.p]) return null;
      const s = clone(s0); s.step += 1; s.out[m.p] = true; return s;
    }
    if (m.t === 'break') { // 同じ手が2回届いても n がずれるので1回だけ数える
      if (s0.out[m.p] || m.n !== brokeOf(s0, m.p)) return null;
      const s = clone(s0); s.step += 1;
      s.broke ??= Array(s.n).fill(0);
      s.broke[m.p] += 1;
      if (s.broke[m.p] >= poisOf(s)) s.out[m.p] = true;
      return s;
    }
    if (m.t === 'scoop' && s0.share) {
      if (m.n !== s0.cnt[m.p] || !Array.isArray(m.f) || m.f.length < 1 || m.f.length > 3 || !Number.isInteger(m.ms) || m.ms < 0 || m.ms > limitOf(s0) + GRACE_MS) return null;
      const s = clone(s0);
      s.step += 1;
      s.cnt[m.p] += 1;
      shareScoop(s, m.p, m.f, m.ms);
      return s;
    }
    if (m.t !== 'scoop' || m.n !== s0.cnt[m.p] || !Number.isInteger(m.c) || m.c < 1 || m.c > 3 || !Number.isInteger(m.v) || m.v < m.c || m.v > m.c * maxV(s0)) return null;
    const s = clone(s0);
    s.step += 1;
    s.cnt[m.p] += 1;
    s.scores[m.p] += m.v;
    s.fish[m.p] += m.c;
    return s;
  },

  cpuDelay(s) { return s.phase === 'play' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.out[p]) return null;
    const pk = key(s) + ':' + p;
    let plan = cpuPlan.get(pk);
    if (!plan) { plan = { next: 2500 + Math.random() * 2000 }; cpuPlan.set(pk, plan); if (cpuPlan.size > 100) cpuPlan.delete(cpuPlan.keys().next().value); }
    const t = since(key(s) + ':play');
    if (t < plan.next || t >= limitOf(s)) return null;
    plan.next = t + 2500 + Math.random() * 2000;
    if (Math.random() < 0.22) return { t: 'break', n: brokeOf(s, p) }; // ポイの数だけ破れたら局面がおしまいにする
    if (Math.random() >= 0.55) return null;
    if (s.share) { // 見えている金魚から1匹
      const seen = [...Array(NF).keys()].filter((i) => s.at[i] <= t);
      if (!seen.length) return null;
      const i = seen[Math.floor(Math.random() * seen.length)];
      return { t: 'scoop', n: s.cnt[p], v: KINDS[fishOf(s.seed, i, s.gen[i], s.nushi).kind].v, c: 1, f: [[i, s.gen[i]]], ms: Math.round(t) };
    }
    const r = Math.random();
    if (s.nushi && r < 0.01) return { t: 'scoop', n: s.cnt[p], v: 10, c: 1 };
    return { t: 'scoop', n: s.cnt[p], v: r < 0.05 ? 5 : r < 0.25 ? 3 : 1, c: 1 };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const tk = key(s) + ':play';
    const extra = (p) => (s.out[p] ? '<span class="pt-ng">ポイなし</span>' : `<span class="pt-ok">🐟${s.fish[p]}</span>`);
    const chips = scoreChips(o, s.scores, { won: s.phase === 'end' ? leaders(s.scores) : [], extra, steady: true });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    const mount = `${s.seed}:${s.phase}:${me}`;
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.state = s;
      ui.update?.();
      return;
    }
    root.innerHTML = '';
    root.className = 'board kj kg';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    root.append(wrap);
    ui = { mount, wrap, chips, state: s };
    if (s.phase === 'ready') {
      wrap.insertAdjacentHTML('beforeend', `<div class="kj-card"><div class="kj-word small">よーい…</div><div class="kj-sub">押している間ポイが水の中に入り、離すとすくえる・${pointsText(s)}・ポイは${poisOf(s)}枚・${limitOf(s) / 1000}秒${s.share ? '・水そうはみんなで1つ（すくった金魚はみんなの水そうから消える）' : ''}</div></div>`);
      return;
    }
    if (s.phase === 'end') return;
    since(tk);
    if (loc?.key !== tk) {
      loc = { key: tk, gen: Array(NF).fill(0), back: Array(NF).fill(0), dur: 1, left: poisOf(s), broke: 0, brokeAt: -1e9, scoops: [], out: false };
      // みんなで1つ: 局面で知っている代（ほかの人がすくったのを見分ける）・確かめた自分の手の数・輪・先を越された時刻。開き直したときは今の局面から始める（輪を出し直さない）
      if (s.share) Object.assign(loc, { sgen: s.gen.slice(), checked: me !== null ? s.cnt[me] : 0, rings: [], lostAt: -1e9 });
    }
    const card = document.createElement('div');
    card.className = 'kj-card kg-card';
    card.append(timeBar(tk, limitOf(s)));
    const cv = document.createElement('canvas');
    cv.className = 'kg-canvas';
    card.append(cv);
    const note = document.createElement('p');
    note.className = 'cc-log';
    wrap.append(card, note);

    const playing = () => ui.state.phase === 'play' && me !== null && o.canMove && !loc.out && since(tk) < limitOf(s);
    const sendOwn = () => {
      const st = ui.state;
      if (me === null || st.phase !== 'play') return;
      for (let n = st.cnt[me]; n < loc.scoops.length; n++) o.onMove({ t: 'scoop', n, ...loc.scoops[n] }); // 届いていない分をまとめて（2回目に届いた手は弾かれる）
      for (let n = brokeOf(st, me); n < loc.broke; n++) o.onMove({ t: 'break', n });
      if (loc.out && !st.out[me]) o.onMove({ t: 'out' });
    };
    ui.update = () => {
      const st = ui.state;
      if (st.share && loc.sgen) { // みんなで1つ: 局面の金魚に合わせる
        const t = since(tk);
        for (let i = 0; i < NF; i++) {
          for (let g = loc.sgen[i]; g < st.gen[i]; g++) { // ほかの人がすくった所に、その人の色の輪
            const own = st.own[`${i}:${g}`];
            if (own && own[0] !== me) loc.rings.push({ xy: posOf(fishOf(st.seed, i, g, st.nushi), own[1]), at: t, col: SEAT_COLORS[own[0] % SEAT_COLORS.length] });
          }
          loc.sgen[i] = st.gen[i];
          if (st.gen[i] >= loc.gen[i]) { loc.gen[i] = st.gen[i]; loc.back[i] = st.at[i]; } // まだ届いていない自分の分は端末の中のまま
        }
        if (loc.rings.length > 30) loc.rings.splice(0, loc.rings.length - 30);
        if (me !== null) { // 届いた自分の手のうち、先を越された金魚があったか
          for (; loc.checked < Math.min(st.cnt[me], loc.scoops.length); loc.checked++) {
            const f = loc.scoops[loc.checked].f ?? [];
            if (f.some(([i, g]) => st.own[`${i}:${g}`]?.[0] !== me)) { loc.lostAt = t; play('wrong', 0.4); }
          }
        }
      }
      if (st.phase === 'play' && me !== null) { // 開き直したとき: 局面の破れた枚数から続ける
        if (brokeOf(st, me) > loc.broke) { loc.broke = brokeOf(st, me); loc.left = Math.max(0, poisOf(st) - loc.broke); }
        if (st.out[me]) loc.out = true;
      }
      // 点は局面の点に、まだ届いていない分を足す（開き直したときに局面の数から埋めた記録は点が分からないので使わない）
      const mine = me !== null ? st.scores[me] + loc.scoops.slice(st.cnt[me]).reduce((a, x) => a + x.v, 0) : 0;
      note.textContent = me === null ? '観戦中'
        : loc.out ? `ポイがなくなりました（${mine}点）。ほかの人を待っています`
        : since(tk) >= limitOf(s) ? `時間です（${mine}点）`
        : `ポイ ${'🥅'.repeat(loc.left)}（のこり${loc.left}枚）・${pointsText(st)}`;
      if (st.phase === 'play' && me !== null && st.cnt[me] > loc.scoops.length) { // 開き直したとき: 局面の数から続ける
        while (loc.scoops.length < st.cnt[me]) loc.scoops.push({ v: 1, c: 1 });
      }
    };
    ui.update();
    // 送り直し（0.5秒ごと）
    const resend = () => {
      if (!wrap.isConnected || ui?.wrap !== wrap) return;
      sendOwn();
      setTimeout(resend, 500);
    };
    setTimeout(resend, 500);

    // ポイの操作
    let poi = null; // { x, y, t, lift } 水の中にあるとき
    let aim = null; // 水の外にあるときの位置（見せるだけ）
    const toXY = (e, lift) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width - lift]; };
    const tNow = () => since(tk);
    const ready = () => tNow() - loc.brokeAt >= 1000;
    const broke = () => {
      poi = null;
      loc.left -= 1;
      loc.broke += 1;
      loc.brokeAt = tNow();
      loc.dur = 1;
      play('wrong', 0.5);
      if (loc.left <= 0) loc.out = true;
      sendOwn(); // 最後の1枚でなくてもすぐ送る（0.5秒ごとの送り直しまで待つと、その間に読み込み直したポイが戻った。2026-11-04 Codex の点検の指摘）
      ui.update();
    };
    const under = (x, y, t) => {
      const got = [];
      for (let i = 0; i < NF; i++) {
        if (loc.back[i] > t) continue;
        const f = fishOf(s.seed, i, loc.gen[i], s.nushi);
        const [fx, fy] = posOf(f, t);
        if (Math.sqrt((fx - x) ** 2 + (fy - y) ** 2) <= POI_R - KINDS[f.kind].r * 0.3) got.push([i, f.kind]);
      }
      return got.slice(0, 3);
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!playing() || !ready()) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const lift = e.pointerType === 'touch' ? 0.1 : 0;
      const [x, y] = toXY(e, lift);
      poi = { x, y, t: tNow(), lift };
      play('pop', 0.3);
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = toXY(e, poi?.lift ?? (e.pointerType === 'touch' ? 0.1 : 0));
      if (!poi) { aim = [x, y]; return; }
      const t = tNow();
      const dt = Math.max(0.001, (t - poi.t) / 1000);
      const v = Math.sqrt((x - poi.x) ** 2 + (y - poi.y) ** 2) / dt;
      loc.dur -= Math.max(0, v - FAST) * dt * FAST_K; // 速く動かした分（水の中にいる時間の分は描くときに減らす）
      Object.assign(poi, { x, y, t });
      if (loc.dur <= 0) broke();
    });
    const up = () => {
      if (!poi) return;
      const t = tNow();
      const got = t < limitOf(s) ? under(poi.x, poi.y, t) : [];
      poi = null;
      if (!got.length || !playing()) return;
      const left = lift(loc.dur, got.map(([, k]) => k));
      if (left === null) { broke(); return; }
      loc.dur = left;
      const f = got.map(([i]) => [i, loc.gen[i]]); // みんなで1つのとき送る、すくった金魚（場所と代）
      for (const [i] of got) { loc.gen[i] += 1; loc.back[i] = t + RESPAWN; }
      const v = got.reduce((a, [, k]) => a + KINDS[k].v, 0);
      loc.scoops.push(s.share ? { v, c: got.length, f, ms: Math.round(t) } : { v, c: got.length });
      play(got.some(([, k]) => k > 0) ? 'correct' : 'hit', 0.7);
      sendOwn();
      ui.update();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => { poi = null; });
    cv.addEventListener('pointerleave', () => { aim = null; });

    // 描く
    let lastT = tNow();
    const draw = () => {
      if (!cv.isConnected || ui?.wrap !== wrap) return;
      const t = tNow();
      // 水の中にいる時間で減る
      if (poi && playing()) { loc.dur -= ((t - lastT) / 1000) * DRAIN; if (loc.dur <= 0) broke(); }
      if (poi && !playing()) poi = null;
      lastT = t;
      const W = Math.min(560, (root.clientWidth || 360) - 31), H = Math.round(W * TANK_H); // 31: カード（kg-card）の左右の余白14と枠1.5を両側ぶん引く（2026-11-17 見た目の点検。引かずに枠の外へはみ出していた）。
      // 余白14は、水そうのまわりの灰色の輪（style.css の .kg-canvas の box-shadow 6px）とカードの縁のあいだを8あけるため（2026-11-20 の点検。余白8では2しかなかった）
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const g = cv.getContext('2d');
      g.setTransform(W * dpr, 0, 0, W * dpr, 0, 0); // 1単位 = 水そうの横幅
      const bg = g.createLinearGradient(0, 0, 0, TANK_H);
      bg.addColorStop(0, '#7cc8ef'); bg.addColorStop(1, '#3d8fc4');
      g.fillStyle = bg;
      g.fillRect(0, 0, 1, TANK_H);
      // 金魚
      for (let i = 0; i < NF; i++) {
        if (loc.back[i] > t) continue;
        const f = fishOf(s.seed, i, loc.gen[i], s.nushi);
        const [x, y] = posOf(f, t);
        const [x2, y2] = posOf(f, t + 60);
        const ang = Math.atan2(y2 - y, x2 - x);
        const k = KINDS[f.kind];
        const fade = loc.back[i] > 0 && t - loc.back[i] < 600 ? (t - loc.back[i]) / 600 : 1;
        g.save();
        g.globalAlpha = fade;
        g.translate(x, y);
        g.rotate(ang);
        g.fillStyle = k.col;
        const wag = Math.sin(t / 120 + i) * 0.25;
        g.beginPath(); g.moveTo(-k.r * 0.8, 0); g.lineTo(-k.r * 1.9, -k.r * (0.7 + wag)); g.lineTo(-k.r * 1.9, k.r * (0.7 - wag)); g.closePath(); g.fill();
        g.beginPath(); g.ellipse(0, 0, k.r, k.r * 0.6, 0, 0, Math.PI * 2); g.fill();
        if (f.kind === 2) { g.strokeStyle = '#fff6c0'; g.lineWidth = 0.004; g.stroke(); }
        if (f.kind === 3) { // ぬし: 白いまだらと金のふち
          g.fillStyle = '#fff';
          g.beginPath(); g.ellipse(-k.r * 0.25, k.r * 0.1, k.r * 0.35, k.r * 0.22, 0.4, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#f2b705'; g.lineWidth = 0.005;
          g.beginPath(); g.ellipse(0, 0, k.r, k.r * 0.6, 0, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(k.r * 0.5, -k.r * 0.25, k.r * (f.kind === 1 ? 0.28 : 0.16), 0, Math.PI * 2); g.fill();
        g.fillStyle = '#000';
        g.beginPath(); g.arc(k.r * 0.55, -k.r * 0.25, k.r * 0.09, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      // みんなで1つ: ほかの人がすくった所の輪
      if (loc.rings) {
        for (const r of loc.rings) {
          const a = 1 - (t - r.at) / RING_MS;
          if (a <= 0 || t < r.at) continue;
          g.save();
          g.globalAlpha = a;
          g.beginPath(); g.arc(r.xy[0], r.xy[1], POI_R * (1 + (1 - a) * 0.6), 0, Math.PI * 2);
          g.strokeStyle = 'rgba(255,255,255,.9)'; // 白いふち（青い席の色が水に埋もれないように）
          g.lineWidth = 0.016;
          g.stroke();
          g.strokeStyle = r.col;
          g.lineWidth = 0.008;
          g.stroke();
          g.restore();
        }
        loc.rings = loc.rings.filter((r) => t - r.at < RING_MS);
      }
      // ポイ
      const p = poi ? [poi.x, poi.y] : aim;
      if (p && me !== null && !loc.out) {
        const torn = !ready();
        g.save();
        g.strokeStyle = '#d23b3b'; g.lineWidth = 0.012;
        g.beginPath(); g.moveTo(p[0] + POI_R * 0.7, p[1] + POI_R * 0.7); g.lineTo(p[0] + POI_R * 1.9, p[1] + POI_R * 1.9); g.stroke();
        g.beginPath(); g.arc(p[0], p[1], POI_R, 0, Math.PI * 2);
        g.fillStyle = torn ? 'rgba(255,255,255,0)' : poi ? `rgba(255,255,255,${0.15 + 0.35 * Math.max(0, loc.dur)})` : 'rgba(255,255,255,.75)';
        g.fill();
        g.stroke();
        if (torn) { g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.moveTo(p[0] - POI_R, p[1]); g.arc(p[0], p[1], POI_R, Math.PI, Math.PI * 1.35); g.closePath(); g.fill(); }
        g.restore();
      }
      // 丈夫さの帯（水の中にあるとき）
      if (poi) {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0.02, 0.02, 0.3, 0.025);
        g.fillStyle = loc.dur > 0.4 ? '#7dff9a' : '#ff6b5a'; g.fillRect(0.02, 0.02, 0.3 * Math.max(0, loc.dur), 0.025);
      }
      // みんなで1つ: 自分がすくった金魚が先に取られていた（字は画面の点の単位で描く。水そうの単位のままだと字が小さすぎて崩れる端末があるため）
      if (loc.lostAt !== undefined && t - loc.lostAt < LOST_MS) {
        g.save();
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.globalAlpha = Math.min(1, 2 * (1 - (t - loc.lostAt) / LOST_MS));
        g.font = `bold ${Math.round(W * 0.06)}px sans-serif`;
        g.textAlign = 'center';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(0,0,0,.55)';
        g.strokeText('先を越された…', W / 2, H * 0.18);
        g.fillStyle = '#fff';
        g.fillText('先を越された…', W / 2, H * 0.18);
        g.restore();
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    setTimeout(() => { if (ui?.wrap === wrap) ui.update(); }, Math.max(0, limitOf(s) - since(tk)) + 50);
  },
};
