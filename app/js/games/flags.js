// 旗揚げ。お題（「赤上げて」「白下げないで赤下げない」など）が出たら、全員同時に赤と白の旗を正しい形にする。
// 毎問、旗は「前のお題の正しい形」から始まる（前の問題で間違えても引きずらない）。
// 正解した人には、形を作り終えた（最後に旗を動かした）速さの順に 1位3点・2位2点・ほか1点。旗を動かさないのが正解なら全員同着。
// 15問で点の多い人の勝ち。5問ごとに3段階で難しくなる（STAGES）:
//   1〜5問目はそのまま / 6〜10問目は制限時間8割・点2倍 / 11〜15問目は制限時間65%・点3倍で、命令を3つつなげた長いお題も出る
//   （長いお題は読む分として LONG_EXTRA だけ時間を足す）。
//
// 進行（ホストが時間を計って p = -1 の手を足す。main.js の scheduleReferee）:
//   ready →(3秒)→ next → open（お題を出す）→(制限時間＋通信の待ち)→ close → shown（答え合わせ）→(2.6秒)→ next …
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'pose', q: 問題番号, r: 赤 0|1, w: 白 0|1, y: 黄色 0|1, ms: 画面に出てから最後に動かすまで, n: 通し番号 }
// （1=上げている。y は「黄色い旗」がありのときだけ付ける。n は同じ手が2回届いたときに2回目を弾くため）
//
// 詳細設定「黄色い旗」（yellow。2026-10-06）: ありにすると黄色の旗が増え、お題にも黄色が入る。3本の旗の形で正解を決める。
//   3本ぶん操作が増えるので、制限時間に YELLOW_EXTRA（0.5秒）足す。点・段階・読み上げは同じ。
//   なしのときは乱数の使い方を前と全く同じにしている（旗を選ぶ所で、2本なら余分に乱数を引かない）ので、お題も結果も前と同じ。
//
// 詳細設定「あまのじゃく」（contrary。2026-10-07）: お題と逆の形を正解にする。いつも（all）は全部のお題、ときどき（mix）は
//   「👿 あまのじゃく！」の印の付いたお題（15問のうち MIX_COUNT 問）だけ。逆にするのは「〜て」の命令だけで（赤上げて → 赤を下げる）、
//   「〜ないで・〜ない」はいつもどおり動かさない（readPose）。逆にするお題は cmds に rev: true を付け、pose を逆にした正しい形に作り直す
//   （次の問題もその形から始まる）。お題の文は同じ乱数で作り、印は別の乱数で seed から選ぶので、なしのときはお題も cmds の形も前と同じ。
//   ときどきの印のお題は、印を読む分 MARK_EXTRA（0.7秒）時間を足し、読み上げでは「あまのじゃく」と先に読む。

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';

const TOTAL = 15;
const STAGES = [ // 何問目から・制限時間の倍率・点の倍率・長いお題の出やすさ
  { from: 0, time: 1, mul: 1, long: 0 },
  { from: 5, time: 0.8, mul: 2, long: 0 },
  { from: 10, time: 0.65, mul: 3, long: 0.5 },
];
const LONG_EXTRA = 800;
const YELLOW_EXTRA = 500; // 黄色い旗がありのときに足す時間
const MARK_EXTRA = 700; // あまのじゃく（ときどき）の印が付いたお題に足す時間
const MIX_COUNT = 5; // あまのじゃく（ときどき）で印が付くお題の数（15問のうち。3問に1問）
const READY_MS = 3000;
const SHOWN_MS = 2600;
const GRACE_MS = 1200; // ゲストの答えが届くのを待つ分
const LIMITS = { slow: 4000, normal: 3000, fast: 2000 };
const POINTS = [3, 2];
const FLAG = { r: '赤', w: '白', y: '黄色' };
const VERB = { 1: '上げ', 0: '下げ' };
const YELLOW_CSS = `
.fl-flag.y .fl-cloth { background: #f2c12e; }
.fl-flags.fl3 { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.board .fl-flags.fl3 .fl-btn { padding: 10px 2px; }
.fl-flags.fl3 .fl-flag { transform: scale(.75); transform-origin: 0 0; margin: 0 -25px -42px 0; }
.fl-flags.fl3 .fl-label { font-size: .95rem; white-space: nowrap; }
`; // 黄色い旗の見た目（3本並べるときは旗を4分の3に縮める。style.css には入れず、使うときに足す）
const CONTRARY_CSS = `
.fl-card.ama { border-color: #6b3fa0; box-shadow: 0 0 0 3px rgba(107, 63, 160, .3); }
.fl-ama { display: inline-block; margin: 4px 0 2px; padding: 3px 14px; border-radius: 999px; background: #6b3fa0; color: #fff; font-weight: 800; font-size: 1.1rem; animation: flAma .45s ease-out; }
.fl-stage.ama { background: #6b3fa0; }
.fl-plain { font-size: .8rem; }
@keyframes flAma { from { transform: scale(1.5); } }
@media (prefers-reduced-motion: reduce) { .fl-ama { animation: none; } }
`; // あまのじゃくの印の見た目（使うときに足す）
const FLAG_KEY = { 赤: 'r', 白: 'w', 黄色: 'y' };

// 使う旗（なしなら赤・白、ありなら赤・白・黄色）
const flagsOf = (yellow) => (yellow ? ['r', 'w', 'y'] : ['r', 'w']);
// 旗を1つ選ぶ。2本のときは「rng() < 0.5 なら赤」と同じ結果になる
const pickFlag = (rng, keys) => keys[Math.floor(rng() * keys.length)];
// f 以外の旗を1つ選ぶ。2本のときは乱数を引かない（なしのときのお題を前と同じにするため）
function otherFlag(rng, keys, f) {
  const o = keys.filter((k) => k !== f);
  return o.length === 1 ? o[0] : o[Math.floor(rng() * o.length)];
}

// 命令を3つつなげた長いお題（例「赤上げて、白下げないで、赤下げて」）。後ろの命令ほど後で効く
function makeLong(rng, pose, keys) {
  const next = { ...pose };
  let f = pickFlag(rng, keys);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0 && rng() < 0.6) f = otherFlag(rng, keys, f);
    const a = rng() < 0.5 ? 1 : 0;
    const not = rng() < 0.35;
    if (!not) next[f] = a;
    parts.push(`${FLAG[f]}${VERB[a]}${not ? (i < 2 ? 'ないで' : 'ない') : 'て'}`);
  }
  return { text: parts.join('、'), pose: next, long: true };
}

// お題を1つ作る。pose = この問題を始める前の正しい形。返すのは { text, pose: 正しい形, long: 長いお題か }
// keys = 使う旗（flagsOf）
function makeCommand(rng, pose, stage, keys) {
  if (stage.long && rng() < stage.long) return makeLong(rng, pose, keys);
  const f = pickFlag(rng, keys);
  const g = otherFlag(rng, keys, f);
  const v = () => (rng() < 0.5 ? 1 : 0);
  const next = { ...pose };
  const x = rng();
  let text;
  if (x < 0.35) { // 赤上げて
    const a = v(); next[f] = a; text = `${FLAG[f]}${VERB[a]}て`;
  } else if (x < 0.6) { // 赤上げないで、白下げて
    const a = v(); const b = v(); next[g] = b; text = `${FLAG[f]}${VERB[a]}ないで、${FLAG[g]}${VERB[b]}て`;
  } else if (x < 0.85) { // 赤上げて、白下げて
    const a = v(); const b = v(); next[f] = a; next[g] = b; text = `${FLAG[f]}${VERB[a]}て、${FLAG[g]}${VERB[b]}て`;
  } else if (x < 0.93) { // 赤上げない
    text = `${FLAG[f]}${VERB[v()]}ない`;
  } else { // 赤上げないで、白下げない
    text = `${FLAG[f]}${VERB[v()]}ないで、${FLAG[g]}${VERB[v()]}ない`;
  }
  return { text, pose: next };
}

// お題の文を読み直して、start から作る正しい形を返す。rev（あまのじゃく）なら「〜て」の命令を逆にする（上げて → 下げる）。
// 「〜ないで・〜ない」は、逆でも逆でなくても動かさない
function readPose(text, start, rev) {
  const next = { ...start };
  for (const part of text.split('、')) {
    const m = part.match(/^(赤|白|黄色)(上げ|下げ)(て|ないで|ない)$/);
    if (m && m[3] === 'て') next[FLAG_KEY[m[1]]] = (m[2] === '上げ') !== rev ? 1 : 0;
  }
  return next;
}

// あまのじゃく（ときどき）で印を付けるお題の番号。お題を作る乱数とは別の乱数で seed から選ぶ（全員の端末で同じ）
function markedOf(seed) {
  const rng = mulberry32(seed ^ 0xa3a70);
  const idx = Array.from({ length: TOTAL }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, MIX_COUNT));
}

// 黄色が無い形（なしのとき）は y を 0 とみなす
const samePose = (a, b) => a.r === b.r && a.w === b.w && (a.y ?? 0) === (b.y ?? 0);
const hasYellow = (s) => s.rules.yellow === 'on';
const firstPose = (yellow) => (yellow ? { r: 0, w: 0, y: 0 } : { r: 0, w: 0 });
const stageOf = (q) => STAGES.findLast((x) => q >= x.from);
const contraryOf = (s) => (['all', 'mix'].includes(s.rules.contrary) ? s.rules.contrary : 'off');
const isMarked = (s, q = s.q) => contraryOf(s) === 'mix' && !!s.cmds[q]?.rev; // 「👿 あまのじゃく！」の印が付いたお題
const limitOf = (s, q = s.q) => Math.round((LIMITS[s.rules.speed] ?? LIMITS.normal) * stageOf(q).time) + (s.cmds[q]?.long ? LONG_EXTRA : 0) + (hasYellow(s) ? YELLOW_EXTRA : 0) + (isMarked(s, q) ? MARK_EXTRA : 0);
const qKey = (s, q = s.q) => `flags:${s.seed}:${q}`;
const startPose = (s, q = s.q) => (q > 0 ? s.cmds[q - 1].pose : firstPose(hasYellow(s)));
// 形を言葉にする（「赤↑上・白↓下」）
const poseText = (keys, pose) => keys.map((c) => `${FLAG[c]}${pose[c] ? '↑上' : '↓下'}`).join('・');

const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.map((a) => (a ? { ...a } : null)) });

/* ---------- 画面（描き直しても旗の形と押した時刻を失わないように、問題ごとに覚えておく） ---------- */

let local = null; // { key, pose, ms, n } この端末で動かしている旗
let spoken = '';
const cpuPlan = new Map(); // ホストだけ: 'qKey:p' → { at, pose }

function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.15;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* 読み上げが使えない端末 */ }
}

function flagEl(color, up) {
  const e = document.createElement('div');
  e.className = `fl-flag ${color}${up ? ' up' : ''}`;
  e.innerHTML = '<span class="fl-arm"><span class="fl-pole"></span><span class="fl-cloth"></span></span>';
  return e;
}

export default {
  id: 'flags',
  name: '旗揚げ',
  icon: '🚩',
  desc: '「赤上げて、白下げないで…」のお題どおりに、みんなで同時に旗を動かす',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'speed', label: '制限時間', desc: '1問あたりの時間', def: 'normal', choices: [['slow', 'ゆっくり（4秒）'], ['normal', 'ふつう（3秒）'], ['fast', 'はやい（2秒）']] },
    { key: 'voice', label: 'お題を読み上げる', desc: '各自の端末から声が出ます（iPhone は一度画面に触れてから）', def: false },
    { key: 'yellow', label: '黄色い旗', desc: '赤・白に黄色の旗が増え、お題にも「黄色上げて」などが入る（時間は0.5秒長め）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'contrary', label: 'あまのじゃく', desc: 'お題と逆の形にする（「赤上げて」なら赤を下げる）。ときどきは 👿 の付いたお題だけ', def: 'off', choices: [['off', 'なし'], ['all', 'いつも'], ['mix', 'ときどき']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    const yellow = rules.yellow === 'on';
    const keys = flagsOf(yellow);
    const cmds = [];
    let pose = firstPose(yellow);
    for (let i = 0; i < TOTAL; i++) {
      const c = makeCommand(rng, pose, stageOf(i), keys);
      cmds.push(c);
      pose = c.pose;
    }
    // あまのじゃく: 逆にするお題に rev を付け、正しい形を最初から作り直す（お題の文と乱数はそのまま）
    if (rules.contrary === 'all' || rules.contrary === 'mix') {
      const marked = rules.contrary === 'mix' ? markedOf(seed) : null;
      pose = firstPose(yellow);
      cmds.forEach((c, i) => {
        if (!marked || marked.has(i)) c.rev = true;
        c.pose = readPose(c.text, pose, !!c.rev);
        pose = c.pose;
      });
    }
    return {
      n, seed, rules: { speed: 'normal', voice: false, yellow: 'off', contrary: 'off', ...rules }, cmds, q: -1, phase: 'ready',
      ans: Array(n).fill(null), scores: Array(n).fill(0), last: null, step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  // ほかの人が旗を動かした音は鳴らさない（にぎやかすぎるため）
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : me >= 0 ? (b.last[me].ok ? 'correct' : 'wrong') : 'pop';
    return m.p === me ? 'pop' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'open') return `第${s.q + 1}問 / ${TOTAL}`;
    return `第${s.q + 1}問の答え合わせ`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') return { key: 'open' + s.q, ms: limitOf(s) + GRACE_MS, move: { t: 'close' } };
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= TOTAL) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.ans = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const want = s.cmds[s.q].pose;
        const from = startPose(s);
        // 答えていない人は旗を動かさなかった扱い（ms = 0）
        const res = s.ans.map((a) => {
          const pose = a ?? from;
          const ms = a && !samePose(a, from) ? a.ms : 0;
          return { ok: samePose(pose, want), ms };
        });
        const times = res.filter((r) => r.ok).map((r) => r.ms);
        s.last = res.map((r) => {
          if (!r.ok) return { ok: false, pt: 0 };
          const rank = 1 + times.filter((t) => t < r.ms).length;
          return { ok: true, ms: r.ms, rank, pt: (POINTS[rank - 1] ?? 1) * stageOf(s.q).mul };
        });
        s.last.forEach((r, p) => { s.scores[p] += r.pt; });
        return s;
      }
      return null;
    }
    if (m.t !== 'pose' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (![0, 1].includes(m.r) || ![0, 1].includes(m.w) || !Number.isInteger(m.n)) return null;
    const yellow = hasYellow(s0);
    if (yellow ? ![0, 1].includes(m.y) : m.y !== undefined) return null; // 黄色はありのときだけ
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 500) return null;
    const prev = s0.ans[m.p];
    if (prev && m.n <= prev.n) return null;
    const s = clone(s0);
    s.step += 1;
    s.ans[m.p] = yellow ? { r: m.r, w: m.w, y: m.y, ms: m.ms, n: m.n } : { r: m.r, w: m.w, ms: m.ms, n: m.n };
    return s;
  },

  // CPU: 8割は正しい形、2割は間違った形（黄色い旗がありなら3本の形から選ぶ）。速さは 0.8〜2.2 秒（制限時間に収まる分だけ）
  // あまのじゃくで逆にするお題は7割だけ正しい形にし、間違えるときは半分ほど「お題どおりの形」にひっかかる
  cpuDelay(s) { return s.phase === 'open' ? 150 : 400; },
  cpu(s, p) {
    if (s.phase !== 'open') return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const limit = limitOf(s);
      const want = s.cmds[s.q].pose;
      const all = [{ r: 0, w: 0 }, { r: 1, w: 0 }, { r: 0, w: 1 }, { r: 1, w: 1 }];
      const poses = hasYellow(s) ? [...all.map((x) => ({ ...x, y: 0 })), ...all.map((x) => ({ ...x, y: 1 }))] : all;
      const wrong = poses.filter((x) => !samePose(x, want));
      const rev = !!s.cmds[s.q].rev;
      const plain = rev ? readPose(s.cmds[s.q].text, startPose(s), false) : null; // お題どおりの形（ひっかかったとき）
      let pick = wrong[Math.floor(Math.random() * wrong.length)];
      if (plain && !samePose(plain, want) && Math.random() < 0.5) pick = plain;
      plan = {
        at: Math.min(limit * 0.9, 800 + Math.random() * 1400),
        pose: Math.random() < (rev ? 0.7 : 0.8) ? want : pick,
        done: false,
      };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (plan.done) return null;
    const t = since(qKey(s));
    if (t < plan.at) return null;
    plan.done = true;
    if (samePose(plan.pose, startPose(s))) return null; // 動かさないのが答え
    return { t: 'pose', q: s.q, r: plan.pose.r, w: plan.pose.w, ...(hasYellow(s) ? { y: plan.pose.y } : {}), ms: Math.round(t), n: 1 };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    root.innerHTML = '';
    root.className = 'board fl';
    const yellow = hasYellow(s);
    const keys = flagsOf(yellow);
    if (yellow && !document.getElementById('fl-yellow-css')) {
      const st = document.createElement('style');
      st.id = 'fl-yellow-css';
      st.textContent = YELLOW_CSS;
      document.head.append(st);
    }
    const contrary = contraryOf(s);
    if (contrary !== 'off' && !document.getElementById('fl-contrary-css')) {
      const st = document.createElement('style');
      st.id = 'fl-contrary-css';
      st.textContent = CONTRARY_CSS;
      document.head.append(st);
    }

    const shown = s.phase === 'shown' || s.phase === 'end';
    const extra = (p) => {
      if (!shown || !s.last) return '';
      const r = s.last[p];
      return r.ok ? `<span class="pt-ok">○ ${r.rank}位 +${r.pt}</span>` : '<span class="pt-ng">×</span>';
    };
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    root.append(scoreChips(o, s.scores, { won, extra }));

    const card = document.createElement('div');
    card.className = 'fl-card';
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="fl-q">よーい…</div><div class="fl-sub">${yellow ? '赤・白・黄色' : '赤と白'}の旗をお題どおりに動かしてください</div>`
        + (contrary === 'all' ? '<div class="fl-sub">👿 あまのじゃく: どのお題も逆に動かします（「赤上げて」なら赤を下げる。「〜ないで」は動かさない）</div>'
          : contrary === 'mix' ? '<div class="fl-sub">👿 の印が付いたお題だけ逆に動かします（「赤上げて」なら赤を下げる。「〜ないで」は動かさない）</div>' : '');
      root.append(card);
      return;
    }
    const cmd = s.cmds[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    const elapsed = since(key);
    const open = s.phase === 'open' && o.canMove && me !== null && elapsed < limit;

    if (local?.key !== key) local = { key, pose: { ...startPose(s) }, ms: 0, n: 0 };
    const marked = isMarked(s);
    if (s.phase === 'open' && s.rules.voice && spoken !== key) { spoken = key; speak(marked ? `あまのじゃく！ ${cmd.text}` : cmd.text); }

    const mul = stageOf(s.q).mul;
    card.innerHTML = `<div class="fl-num">第${s.q + 1}問 / ${TOTAL}${mul > 1 ? `<span class="fl-stage">点数×${mul}</span>` : ''}`
      + `${contrary === 'all' ? '<span class="fl-stage ama">👿 逆に</span>' : ''}</div>`
      + `${marked ? '<div class="fl-ama">👿 あまのじゃく！</div>' : ''}<div class="fl-q"></div>`;
    if (marked) card.classList.add('ama');
    if (cmd.long) card.querySelector('.fl-q').classList.add('long');
    card.querySelector('.fl-q').textContent = cmd.text;
    if (s.phase === 'open') card.append(timeBar(key, limit));
    else {
      const ans = document.createElement('div');
      ans.className = 'fl-sub';
      ans.textContent = `${cmd.rev ? '正解（逆）' : '正解'}: ${poseText(keys, cmd.pose)}`;
      card.append(ans);
      // 逆にしたお題は、お題どおりならどうなるかも小さく添える（形が同じときは出さない）
      const plain = cmd.rev ? readPose(cmd.text, startPose(s), false) : null;
      if (plain && !samePose(plain, cmd.pose)) {
        const p = document.createElement('div');
        p.className = 'fl-sub fl-plain';
        p.textContent = `（お題どおりなら ${poseText(keys, plain)}）`;
        card.append(p);
      }
    }
    root.append(card);

    // 自分の旗（観戦は正解の形を見せる）
    const pose = me === null || shown ? (shown && me !== null ? (s.ans[me] ?? startPose(s)) : cmd.pose) : local.pose;
    const flags = document.createElement('div');
    flags.className = 'fl-flags' + (yellow ? ' fl3' : '');
    for (const c of keys) {
      const b = document.createElement(open ? 'button' : 'div');
      b.className = 'fl-btn ' + c + (open ? ' playable' : '');
      b.append(flagEl(c, pose[c] === 1));
      const label = document.createElement('span');
      label.className = 'fl-label';
      label.textContent = `${FLAG[c]} ${pose[c] ? '↑上' : '↓下'}`;
      b.append(label);
      if (open) {
        b.type = 'button';
        b.onpointerdown = (e) => {
          e.preventDefault();
          if (since(key) >= limit) return;
          local.pose = { ...local.pose, [c]: 1 - local.pose[c] };
          local.ms = Math.round(since(key));
          local.n += 1;
          o.onMove({ t: 'pose', q: s.q, r: local.pose.r, w: local.pose.w, ...(yellow ? { y: local.pose.y } : {}), ms: local.ms, n: local.n });
        };
      }
      flags.append(b);
    }
    root.append(flags);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (shown && me !== null && s.last) {
      const r = s.last[me];
      msg.textContent = r.ok ? `正解！ ${r.rank}位（${secText(r.ms)}）` : 'ざんねん、まちがい';
    } else if (s.phase === 'open' && me !== null) {
      msg.textContent = open ? '旗をタップすると上げ下げできます' : 'そこまで！';
    }
    root.append(msg);

    // 制限時間が来たら押せなくする（描き直しが来なくても）
    if (open) {
      setTimeout(() => {
        if (local?.key !== key || !root.contains(flags)) return;
        for (const b of flags.querySelectorAll('button')) { b.onpointerdown = null; b.classList.remove('playable'); }
        msg.textContent = 'そこまで！';
      }, Math.max(0, limit - elapsed));
    }
  },
};
