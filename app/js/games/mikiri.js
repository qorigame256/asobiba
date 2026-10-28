// 見切り（カービィのミニゲーム「刹那の見切り」風。元の名前は任天堂のものなので使わない）。2〜10人・足りない分は CPU。
// 「かまえ…」のあと、いつか画面に「！」が出る。出てから押すまでがいちばん速い人が勝ち。「！」より前に押すとフライング。
// 2026-10-28 本人の決定（Claude の問いに本人が答えた）:
//   - 詳細設定「遊び方」で 点数戦（最初）・勝ち抜き戦 を選ぶ。
//   - 点数戦: 毎回、速い順に 3・2・1点。決まった回数（5回）で点の多い人の勝ち。フライングはその回だけ失格（点は減らない）。
//   - 勝ち抜き戦: 毎回いちばん遅い人が抜け、最後の1人の勝ち。残り2人になったら先に2勝した方が残る。
//     フライングは2回目で脱落。1回目のフライングの回はだれも抜けずにやり直し（フライングした人に警告が1つ付く）。
//   - 詳細設定「フェイント」（最初はなし）: ときどき「！」の前に似た合図「？」が出る。それで押すとフライング。
// 公平にするための作り（本人の依頼「ホストが有利にならないように」）:
//   - 「！」が出るまでの時間は対局の種と回の番号から全員同じに作る。各端末は、その回の局面を受け取ってから自分の時計で数えて「！」を出し、
//     「自分の画面に！が出てから押すまで」を測って送る（ms）。通信の遅れは「！が出るのが遅れる」だけなので、順位に響かない（的の早押しと同じ考え方）。
//   - ほかの人が押したかどうかは、その回の結果が出るまで見せず、音も鳴らさない（遅れて受け取った人が「もうすぐ！が出る」と分かってしまうため）。
// Claude の判断:
//   - 「！」が出るのは「かまえ」から 2〜6秒後。前の回の結果を見せる間（最初の回は1.5秒・それ以降は3秒）と、かまえの最初の0.4秒の押しは数えない（前の回の押し残りで失格にならないように）。
//   - 0.1秒より速いのは合図を見てからでは間に合わないので、フライングと同じに扱う（あてずっぽうと、作りかえた端末からの細工を防ぐ）。
//   - 「！」が出て3秒押さなければ「押さなかった」。ホストは「！」の3秒後からさらに2.5秒待って締め切る（遅れて届く手を待つ）。全員が押せばすぐ次へ。
//   - 点数戦で同じ速さ（ミリ秒まで同じ）は同じ順位で同じ点。押さなかった人は0点。
//   - 勝ち抜き戦（3人以上）: フライングが無ければ、押さなかった人がいればその人たちが抜ける。全員押したらいちばん遅い人（同じ速さなら全員）が抜ける。
//     全員が抜ける形（全員押さなかった・全員同じ速さ・全員2回目のフライング）ならだれも抜けずにやり直し。2回目のフライングがあれば、抜けるのはその人だけ。
//     決勝（2人）: 速い方が1勝。片方だけ押したら押した方の1勝。どちらも押さないか同じ速さならやり直し。決勝の勝ちは2人になってから数える。
//     60回で決着が付かなければ（だれも押さない回が続いたとき）、残っている人の同点。
//   - フェイントありでは、半分ほどの回で「？」が 0.45秒だけ出る。
//   - CPU の反応は 0.3〜0.7秒（ふつうの人とだいたい同じか少し遅い）。フェイントの回は15%、ふだんは2%フライングする。
// 手: { p, t: 'hit', r: 何回目か, ms } / { p, t: 'fly', r } / { p: -1, t: 'close', r }（ホストの締め切り）
//   r と「その回はもう押したか」で、同じ手が2回届いても2回目は反則になる。

import { mulberry32 } from './util.js';
import { since, leaders, winnersText } from './party.js';
import { play } from '../sound.js';

const LIMIT = 3000; // 「！」が出てから押せる時間
const GRACE = 2500; // 締め切りの前に、遅れて届く手を待つ時間
const MIN_MS = 100; // これより速いのはフライング
const IGNORE_MS = 400; // かまえの最初のこの時間の押しは数えない
const FAKE_MS = 450; // フェイントの「？」が出ている時間
const MAX_R = 60; // 勝ち抜き戦でこの回を過ぎたら残りの人の同点
const PTS = [3, 2, 1];

const isSurvive = (s) => s.rules.mode === 'survive';
const roundsOf = (s) => Number(s.rules.rounds) || 5;
const introOf = (r) => (r === 1 ? 1500 : 3000);
const keyOf = (s) => `mikiri:${s.seed}:${s.r}`;
const alives = (s) => [...Array(s.n).keys()].filter((p) => s.alive[p]);
// 自分の席（観戦の人が「見る画面」でほかの人を選んでいるときは、その人の席として扱わない。結果の前にその人のタイムが見えてしまうため）
const seatOf = (o) => (o.me >= 0 && !o.watching ? o.me : null);
const clone = (s) => ({ ...s, alive: s.alive.slice(), acts: s.acts.slice(), pts: s.pts.slice(), warn: s.warn.slice(), wins: s.wins.slice(), outAt: s.outAt.slice() });

// その回の「！」の時刻（かまえからの ms）とフェイント。乱数を使う数はフェイントの有無で変えない（あり・なしで「！」の時刻を同じにする）
export function timing(s, r = s.r) {
  const rng = mulberry32(((s.seed ^ Math.imul(r, 0x9e3779b1)) >>> 0));
  const wait = 2000 + Math.round(rng() * 4000);
  const hasFake = rng() < 0.5;
  const fakeAt = 900 + Math.round(rng() * (wait - 1700));
  return { intro: introOf(r), wait, fake: s.rules.feint && hasFake ? fakeAt : null };
}

// その回をしめくくる（s は clone 済み）
function resolve(s) {
  const A = alives(s);
  const acts = s.acts.slice();
  const L = { r: s.r, acts, gain: Array(s.n).fill(0), out: [], redo: false, flyers: [], duelWin: null, players: A };
  if (!isSurvive(s)) {
    const ok = A.filter((p) => acts[p] !== null && acts[p] >= 0);
    for (const p of ok) {
      const g = PTS[ok.filter((q) => acts[q] < acts[p]).length] ?? 0;
      L.gain[p] = g;
      s.pts[p] += g;
    }
    L.flyers = A.filter((p) => acts[p] === -1);
  } else {
    const F = A.filter((p) => acts[p] === -1);
    L.flyers = F;
    for (const p of F) s.warn[p] += 1;
    let out = [];
    if (F.length) {
      out = F.filter((p) => s.warn[p] >= 2);
      if (out.length === A.length) out = [];
      if (!out.length) L.redo = true;
    } else if (A.length === 2) {
      const [a, b] = A;
      const va = acts[a], vb = acts[b];
      if (va === vb) L.redo = true; // どちらも押さない・同じ速さ
      else {
        const w = vb === null || (va !== null && va < vb) ? a : b;
        L.duelWin = w;
        s.wins[w] += 1;
        if (s.wins[w] >= 2) out = [w === a ? b : a];
      }
    } else {
      const none = A.filter((p) => acts[p] === null);
      if (none.length) out = none;
      else {
        const slow = Math.max(...A.map((p) => acts[p]));
        out = A.filter((p) => acts[p] === slow);
      }
      if (out.length === A.length) { out = []; L.redo = true; }
    }
    for (const p of out) { s.alive[p] = false; s.outAt[p] = s.r; }
    L.out = out;
  }
  s.last = L;
  s.acts = Array(s.n).fill(null);
  const over = isSurvive(s) ? alives(s).length <= 1 || s.r >= MAX_R : s.r >= roundsOf(s);
  if (over) s.phase = 'end';
  else s.r += 1;
  return s;
}

/* ---------- 画面 ---------- */

let ui = null; // { mount, rk: その回の鍵, field, sign, msg, shownAt, sent, cur: { s, o } }
const cpuPlan = new Map();

function planOf(s, p) {
  const key = `${s.seed}:${s.r}:${p}`;
  let plan = cpuPlan.get(key);
  if (!plan) {
    const tm = timing(s);
    const fly = Math.random() < (tm.fake !== null ? 0.15 : 0.02);
    const react = 300 + Math.round(Math.random() * 400);
    const at = fly ? (tm.fake !== null ? tm.intro + tm.fake + 150 : tm.intro + Math.round(tm.wait * (0.5 + Math.random() * 0.4))) : tm.intro + tm.wait + react;
    plan = { fly, react, at };
    cpuPlan.set(key, plan);
    if (cpuPlan.size > 500) cpuPlan.delete(cpuPlan.keys().next().value);
  }
  return plan;
}

const secs = (ms) => (ms / 1000).toFixed(3) + '秒';

// 押した（画面を押した・スペースキー）
function press() {
  if (!ui || ui.sent || !ui.field.isConnected) return;
  const { s, o } = ui.cur;
  if (s.phase !== 'wait' || !o.canMove || seatOf(o) === null) return;
  const tm = timing(s);
  const t = since(keyOf(s));
  if (t < tm.intro + IGNORE_MS) return;
  if (ui.shownAt === null) {
    ui.sent = { fly: true };
    play('wrong');
    o.onMove({ t: 'fly', r: s.r });
  } else {
    const ms = Math.round(performance.now() - ui.shownAt);
    if (ms > LIMIT) return;
    ui.sent = { ms };
    o.onMove({ t: 'hit', r: s.r, ms });
  }
  draw();
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    if (!ui?.field.isConnected || ui.cur.s.phase !== 'wait') return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select')) return;
    if (ev.target instanceof HTMLElement && ev.target.closest('button')) ev.target.blur(); // 押したままのボタンが一緒に押されないように
    ev.preventDefault();
    press();
  });
}

// 合図の場の中身を、いまの時刻に合わせて描く
function draw() {
  const { s, o } = ui.cur;
  const me = seatOf(o);
  const tm = timing(s);
  const t = since(keyOf(s));
  const f = ui.field;
  let sign = '', cls = '', msg = '';
  if (!ui.sent && me !== null && s.acts[me] !== null) ui.sent = s.acts[me] === -1 ? { fly: true } : { ms: s.acts[me] }; // 読み込み直したとき
  if (t < tm.intro) {
    msg = s.r === 1 ? 'まもなく始まります…' : '';
    f.classList.toggle('result', s.r > 1);
  } else {
    f.classList.remove('result');
    const into = t - tm.intro;
    if (ui.shownAt === null && into >= tm.wait) {
      ui.shownAt = performance.now();
      play('smack');
    }
    if (ui.shownAt !== null) { sign = '！'; cls = 'go'; }
    else if (tm.fake !== null && into >= tm.fake && into < tm.fake + FAKE_MS) { sign = '？'; cls = 'fake'; }
    else sign = '';
    const mine = me !== null && s.alive[me];
    if (ui.sent?.fly) { sign = '✖'; cls = 'fly'; msg = 'フライング！ この回は失格'; }
    else if (ui.sent) msg = `${secs(ui.sent.ms)}！ ほかの人を待っています…`;
    else if (!mine) msg = me === null ? '観戦中' : '見ています（脱落）';
    else if (ui.shownAt !== null) msg = 'いま！';
    else msg = 'かまえ…「！」が出たら押す';
  }
  if (ui.sign.textContent !== sign) ui.sign.textContent = sign;
  ui.sign.className = 'mq-sign ' + cls;
  if (ui.msg.textContent !== msg) ui.msg.textContent = msg;
}

function loop(token) {
  if (ui !== token || !ui.field.isConnected || ui.cur.s.phase !== 'wait') return;
  draw();
  requestAnimationFrame(() => loop(token));
}

// 前の回の結果の表
function resultBox(s, o, L) {
  const me = seatOf(o);
  const name = (p) => (p === me ? 'あなた' : o.names[p]);
  const box = document.createElement('div');
  box.className = 'mq-result';
  const head = document.createElement('div');
  head.className = 'mq-result-head';
  let title = `${L.r}回目`;
  if (L.redo) title += ' … やり直し！';
  else if (L.duelWin !== null) title += ` … ${name(L.duelWin)}の1勝`;
  head.textContent = title;
  box.append(head);
  const order = L.players.slice().sort((a, b) => {
    const v = (p) => (L.acts[p] === null ? 1e9 : L.acts[p] === -1 ? 1e8 : L.acts[p]);
    return v(a) - v(b);
  });
  for (const p of order) {
    const row = document.createElement('div');
    const v = L.acts[p];
    row.className = 'mq-line' + (p === me ? ' me' : '') + (L.out.includes(p) ? ' out' : '');
    const n = document.createElement('span');
    n.className = 'mq-name';
    n.textContent = name(p);
    const tm = document.createElement('span');
    tm.className = 'mq-time';
    tm.textContent = v === null ? '押さず' : v === -1 ? 'フライング' : secs(v);
    const tag = document.createElement('span');
    tag.className = 'mq-tag';
    if (!isSurvive(s)) tag.textContent = L.gain[p] ? `+${L.gain[p]}点` : '';
    else if (L.out.includes(p)) tag.textContent = '脱落';
    else if (v === -1) tag.textContent = `警告${s.warn[p] >= 2 ? 2 : s.warn[p]}`;
    row.append(n, tm, tag);
    box.append(row);
  }
  return box;
}

export default {
  id: 'mikiri',
  name: '見切り',
  icon: '❗',
  desc: '「！」が出た瞬間に押す。いちばん速い人の勝ち。早すぎるとフライング',
  ready: true,
  multi: true,
  realtime: true,
  quietCpu: true, // CPU が押したあとの「ここだ！」などのひとことで、結果の前に押したことが分かってしまうため（2026-10-28 Codex の点検の指摘）
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'mode', label: '遊び方', desc: '点数戦: 速い順に3・2・1点／勝ち抜き戦: 毎回いちばん遅い人が抜ける', def: 'score', choices: [['score', '点数戦'], ['survive', '勝ち抜き戦']] },
    { key: 'rounds', label: '回数', desc: '点数戦の回数', def: 5, choices: [[3, '3回'], [5, '5回'], [10, '10回']] },
    { key: 'feint', label: 'フェイント', desc: 'ときどき「！」の前に「？」が出る。それで押すとフライング', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { mode: 'score', rounds: 5, feint: false, ...rules };
    const z = () => Array(n).fill(0);
    return { n, seed, rules: r, r: 1, phase: 'wait', alive: Array(n).fill(true), acts: Array(n).fill(null), pts: z(), warn: z(), wins: z(), outAt: z(), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'wait' && s.alive[p] && s.acts[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    if (!isSurvive(s)) return { winners: leaders(s.pts), scores: s.pts };
    const place = [...Array(s.n).keys()].map((p) => 1 + [...Array(s.n).keys()].filter((q) => q !== p && (s.alive[q] ? !s.alive[p] : !s.alive[p] && s.outAt[q] > s.outAt[p])).length);
    return { winners: alives(s), place };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s, me) {
    const what = isSurvive(s) ? (alives(s).length === 2 ? '決勝（先に2勝）' : `勝ち抜き戦・残り${alives(s).length}人`) : `${s.r}回目／${roundsOf(s)}回`;
    if (me >= 0 && !s.alive[me]) return `${what}　脱落しました。見ています`;
    return `<b>${what}</b>　「！」が出たら押す`;
  },
  // ほかの人が押した音は鳴らさない（押した知らせで「！」が近いと分かってしまうため）。回の結果が出たときだけ鳴らす
  sound(a, b, m, me) {
    if (b.last !== a.last) {
      const L = b.last;
      if (L.out.includes(me)) return 'wrong';
      if (L.gain[me] === 3 || L.duelWin === me) return 'correct';
      return 'pop';
    }
    return null;
  },

  referee(s) {
    if (s.phase !== 'wait') return null;
    const tm = timing(s);
    return { key: `close${s.r}`, ms: tm.intro + tm.wait + LIMIT + GRACE, move: { t: 'close', r: s.r } };
  },

  apply(s0, m) {
    if (!m || s0.phase !== 'wait' || m.r !== s0.r) return null;
    if (m.p === -1) {
      if (m.t !== 'close') return null;
      const s = clone(s0);
      s.step += 1;
      return resolve(s);
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p)) return null;
    let v;
    if (m.t === 'fly') v = -1;
    else if (m.t === 'hit') {
      if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > LIMIT) return null;
      v = m.ms < MIN_MS ? -1 : Math.round(m.ms);
    } else return null;
    const s = clone(s0);
    s.step += 1;
    s.acts[m.p] = v;
    if (alives(s).every((p) => s.acts[p] !== null)) return resolve(s);
    return s;
  },

  // CPU: 回ごとに、押す時刻（かまえから）とフライングするかを1回だけ決める。ホストの画面で「かまえ」からその時間がたったら押す
  cpuDelay(s, p) {
    if (s.phase !== 'wait') return 500;
    return Math.max(30, planOf(s, p).at - since(keyOf(s)));
  },
  cpu(s, p) {
    if (s.phase !== 'wait') return null;
    const plan = planOf(s, p);
    if (since(keyOf(s)) < plan.at - 5) return null;
    return plan.fly ? { t: 'fly', r: s.r } : { t: 'hit', r: s.r, ms: plan.react };
  },

  render(root, s, o) {
    const me = seatOf(o);
    const mount = `${s.seed}:${s.r}:${s.phase}:${me}`;
    const fresh = ui?.mount !== mount || !root.contains(ui.field);
    const sent = fresh ? null : ui.sent;
    // 「！」が出た時刻は、席が変わっても（観戦から空いた席に入った）その回のあいだ覚えておく。席に入った時から測り直すと、
    // 観戦中に「！」を見てから入った人のタイムが短くなっていた（2026-10-28 Codex の点検の指摘）
    const rk = keyOf(s);
    const shownAt = ui?.rk === rk && s.phase === 'wait' ? ui.shownAt : null;

    root.innerHTML = '';
    root.className = 'board mq';
    // 参加者の札（点数戦は点、勝ち抜き戦は残っているか・警告・決勝の勝ち）
    const row = document.createElement('div');
    row.className = 'mq-players';
    const top = Math.max(...s.pts);
    const duel = isSurvive(s) && alives(s).length === 2;
    for (let p = 0; p < s.n; p++) {
      const c = document.createElement('div');
      c.className = 'mq-chip' + (p === me ? ' me' : '') + (s.alive[p] ? '' : ' out');
      const nm = document.createElement('span');
      nm.className = 'mq-chip-name';
      nm.textContent = p === me ? 'あなた' : o.names[p];
      const v = document.createElement('span');
      v.className = 'mq-chip-val';
      if (!isSurvive(s)) v.textContent = `${s.pts[p]}点${s.pts[p] === top && top > 0 ? ' 👑' : ''}`;
      else v.textContent = !s.alive[p] ? '脱落' : (duel ? '★'.repeat(s.wins[p]) + '☆'.repeat(2 - s.wins[p]) : '') + '⚠️'.repeat(s.warn[p]);
      c.append(nm, v);
      const away = o.away[p] ? '応答なし' : o.sub?.[p] ? 'CPU が代わりに' : '';
      if (away) { const tg = document.createElement('span'); tg.className = 'mq-chip-tag'; tg.textContent = away; c.append(tg); }
      row.append(c);
    }
    root.append(row);

    const field = document.createElement('div');
    field.className = 'mq-field' + (s.phase === 'wait' && me !== null && o.canMove ? ' live' : '');
    const sign = document.createElement('div');
    sign.className = 'mq-sign';
    const msg = document.createElement('div');
    msg.className = 'mq-msg';
    field.append(sign, msg);
    root.append(field);
    ui = { mount, rk, field, sign, msg, shownAt, sent, cur: { s, o } };

    // 前の回の結果（次の回のかまえまでの間と、終わったあと）
    if (s.last && (s.phase === 'end' || since(keyOf(s)) < introOf(s.r))) {
      const box = resultBox(s, o, s.last);
      field.append(box);
      if (s.phase === 'wait') setTimeout(() => box.remove(), Math.max(0, introOf(s.r) - since(keyOf(s))));
    }
    const note = document.createElement('p');
    note.className = 'mq-note';
    note.textContent = isSurvive(s)
      ? '毎回いちばん遅い人が抜ける。フライングは2回で脱落（1回目はやり直し）。残り2人は先に2勝'
      : `速い順に3・2・1点。フライングはその回だけ0点。${roundsOf(s)}回で点の多い人の勝ち`;
    root.append(note);

    if (s.phase !== 'wait') { sign.textContent = 'おしまい'; sign.className = 'mq-sign small'; return; }
    since(keyOf(s)); // この回が自分の画面に出た時刻を覚える（ここから「！」までを数える）
    if (me !== null && o.canMove) {
      field.onpointerdown = (ev) => { ev.preventDefault(); press(); };
    }
    loop(ui);
  },
};
