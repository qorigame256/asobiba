// 椅子取りゲーム。椅子のまわりを光が回り「ピッピッ」と鳴る。光と音が止まったら押す。いちばん遅かった人が抜け、最後の1人の勝ち。3〜10人・足りない分は CPU。
// 2026-10-30 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 合図は光と今ある音（音楽の素材はダウンロードしない。音を消している人も光で分かる）。
//   - どの椅子を押してもよく、いちばん遅かった1人が抜ける（椅子は見た目だけ。取り合いはしない）。
//   - 止まる前に押したら1秒押せない（脱落にはしない）。毎回椅子が1つ減り、最後の1人まで続ける。
// 公平にするための作り（見切りと同じ）:
//   - 止まる時刻は対局の種と回の番号から全員同じに作る。各端末は、その回の局面を受け取ってから自分の時計で数えて止め、
//     「自分の画面で止まってから押すまで」を測って送る（ms）。通信の遅れは「止まるのが遅れる」だけなので、順位に響かない。
//   - ほかの人が押したかどうかは、その回の結果が出るまで見せず、音も鳴らさない（遅れて受け取った人に「もうすぐ止まる」と分かってしまうため）。
// Claude の判断:
//   - 止まるのは回り始めてから 3〜8秒後。前の回の結果を見せる間（最初の回は1.5秒・それ以降は3秒）は回らない。
//   - 止まる前に押したとき（と、止まって0.1秒より速いとき。合図を見てからでは間に合わないので）は、手を送らず、自分の画面で1秒押せなくするだけ。
//     押せるようになったらまた押せる（止まったあとならそこで測る）。
//   - 止まってから4秒押さなければ「押さなかった」。ホストはその4秒後からさらに2.5秒待って締め切る（遅れて届く手を待つ）。全員が押せばすぐ次へ。
//   - 抜けるのは: 押さなかった人がいればその人たち（応答の無い人を待ち続けないように）。全員押したらいちばん遅い人。
//     いちばん遅いのが同じ速さで2人以上、または全員が抜ける形（全員押さなかった）なら、だれも抜けずにやり直し。
//   - 60回で決着が付かなければ（だれも押さない回が続いたとき）、残っている人の同点。
//   - CPU の反応は 0.35〜0.9秒。5%で止まる前に押してしまい、1秒遅れる。
// 手: { p, t: 'sit', r: 何回目か, ms } / { p: -1, t: 'close', r }（ホストの締め切り）
//   r と「その回はもう押したか」で、同じ手が2回届いても2回目は反則になる。
// 詳細設定「椅子の取り合い」（chair。2026-11-19 の45回目の案。本人が選んだ。上の「取り合いはしない」を設定で外すものだと伝えて選ばれた。分かれ目は Claude の判断）:
//   - 押した椅子の番号も送る（手に c。椅子は 0〜残りの人数−2）。1つの椅子には1人だけ座れ、同じ椅子を押した人どうしは ms の小さい（速かった）人のもの（同じ ms なら席の番号の小さい人）。
//     届いた順では決めない（通信の遅れで不利にならないように）。先に座っていた人より速い手が後から届いたら、座っていた人ははじき出される。
//   - はじき出された人・取られた椅子を押した人は、その回のうちに別の椅子を押し直せる（ms はその人の画面で止まってから押し直すまで）。
//     押し直しの ms は、その人が前に押した ms より大きくないと受け付けない（tried。同じ手が2回届いても2回目は反則になる）。
//   - 座れなかった人が抜ける（押さなかった人も）。だれも座れなかったときだけやり直し。速さの順で抜ける人は決めない。
//   - 椅子が全部ふさがり、座れていない人が全員1回は押していたら、ホストは1.5秒待って締める（FULL_WAIT。押し直しの間に合う人を待つ）。そうでなければ今までどおりの締め切り。
//   - ほかの人が座った椅子は、自分の画面で止まったあとにだけ見せる（止まる前に見せると「もうすぐ止まる」と分かってしまうため）。
//   - 椅子の外（場のほか）を押したときと PC のスペースキーは、光が止まった椅子を押したことにする。
//   - CPU は空いている椅子から選ぶ（自分の画面のホストの局面で空いている所。ほかの CPU と同じ椅子を選ぶこともある）。はじかれたら 0.3〜0.8秒後に押し直す。
//   ありのときだけ局面に chair・seat（席ごとの椅子）・tried・bump（はじかれた椅子・だれに・何回目）を持つ（なしでは今までと全く同じ局面）。

import { mulberry32 } from './util.js';
import { since } from './party.js';
import { play } from '../sound.js';

const LIMIT = 4000; // 止まってから押せる時間
const GRACE = 2500; // 締め切りの前に、遅れて届く手を待つ時間
const MIN_MS = 100; // これより速いのは止まる前に押したのと同じ
const LOCK_MS = 1000; // 早すぎたとき押せない時間
const STEP_MS = 220; // 光が次の椅子へ移る間
const MAX_R = 60;
const FULL_WAIT = 1500; // 椅子の取り合い: 椅子が全部ふさがってから締めるまで

const introOf = (r) => (r === 1 ? 1500 : 3000);
const keyOf = (s) => `isutori:${s.seed}:${s.r}`;
const alives = (s) => [...Array(s.n).keys()].filter((p) => s.alive[p]);
const seatOf = (o) => (o.me >= 0 && !o.watching ? o.me : null);
const clone = (s) => ({ ...s, alive: s.alive.slice(), acts: s.acts.slice(), outAt: s.outAt.slice(), ...(s.chair ? { seat: s.seat.slice(), tried: s.tried.slice(), bump: s.bump.slice() } : {}) });
const chairCount = (s) => Math.max(1, alives(s).length - 1);
const bumpsOf = (s, p) => (s.chair ? s.bump[p]?.k ?? 0 : 0);
// 椅子の取り合いで、椅子が全部ふさがり、座れていない人が全員1回は押したか
const fullOf = (s) => s.chair && s.seat.filter((c) => c !== null).length >= chairCount(s)
  && alives(s).every((p) => s.acts[p] !== null || s.tried[p] > 0);

// その回の止まる時刻（回り始めてからの ms）
export function timing(s, r = s.r) {
  const rng = mulberry32(((s.seed ^ Math.imul(r, 0x85ebca6b)) >>> 0));
  return { intro: introOf(r), wait: 3000 + Math.round(rng() * 5000) };
}

// その回をしめくくる（s は clone 済み）
export function resolve(s) {
  const A = alives(s);
  const acts = s.acts.slice();
  const L = { r: s.r, acts, out: [], redo: false, players: A };
  let out;
  const none = A.filter((p) => acts[p] === null);
  if (s.chair) {
    L.chair = true;
    out = none; // 座れなかった人（押さなかった人も）
    s.seat = Array(s.n).fill(null);
    s.tried = Array(s.n).fill(0);
    s.bump = Array(s.n).fill(null);
  } else if (none.length) out = none;
  else {
    const slow = Math.max(...A.map((p) => acts[p]));
    out = A.filter((p) => acts[p] === slow);
    if (out.length > 1) out = [];
  }
  if (out.length === A.length) out = [];
  if (!out.length) L.redo = true;
  for (const p of out) { s.alive[p] = false; s.outAt[p] = s.r; }
  L.out = out;
  s.last = L;
  s.acts = Array(s.n).fill(null);
  if (alives(s).length <= 1 || s.r >= MAX_R) s.phase = 'end';
  else s.r += 1;
  return s;
}

/* ---------- 画面 ---------- */

let ui = null; // { mount, rk, field, ring, sign, msg, chairs, stopAt, lockUntil, sent, lastStep, cur: { s, o } }
const cpuPlan = new Map();

function planOf(s, p) {
  const k = bumpsOf(s, p); // はじかれたら押し直しの予定を作り直す
  const key = `${s.seed}:${s.r}:${p}:${k}`;
  let plan = cpuPlan.get(key);
  if (!plan) {
    const tm = timing(s);
    const react = k ? s.tried[p] + 300 + Math.round(Math.random() * 500)
      : 350 + Math.round(Math.random() * 550) + (Math.random() < 0.05 ? LOCK_MS : 0);
    plan = { react, at: tm.intro + tm.wait + react, u: Math.random() };
    cpuPlan.set(key, plan);
    if (cpuPlan.size > 500) cpuPlan.delete(cpuPlan.keys().next().value);
  }
  return plan;
}

const secs = (ms) => (ms / 1000).toFixed(3) + '秒';

// 押した（椅子・場を押した・スペースキー）。chair = 押した椅子の番号（椅子の取り合いのとき。null なら光が止まった椅子）
function press(chair = null) {
  if (!ui || ui.sent || !ui.field.isConnected) return;
  const { s, o } = ui.cur;
  const me = seatOf(o);
  if (s.phase !== 'wait' || !o.canMove || me === null || !s.alive[me]) return;
  const tm = timing(s);
  if (since(keyOf(s)) < tm.intro) return; // 前の回の結果を見せている間は数えない
  const now = performance.now();
  if (now < ui.lockUntil) return;
  const ms = ui.stopAt === null ? -1 : Math.round(now - ui.stopAt);
  if (ms < MIN_MS) {
    ui.lockUntil = now + LOCK_MS;
    play('wrong');
    draw();
    return;
  }
  if (ms > LIMIT) return;
  if (s.chair) {
    const c = chair ?? ui.stopLit;
    if (!Number.isInteger(c) || c < 0 || c >= ui.chairs.length) return;
    if (ms <= s.tried[me]) return;
    ui.sent = { ms, c, k: bumpsOf(s, me) };
    ui.bumped = '';
    play('place');
    o.onMove({ t: 'sit', r: s.r, ms, c });
    draw();
    return;
  }
  ui.sent = { ms };
  play('place');
  o.onMove({ t: 'sit', r: s.r, ms });
  draw();
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat || (ev.key !== ' ' && ev.key !== 'Enter')) return;
    if (!ui?.field.isConnected || ui.cur.s.phase !== 'wait') return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select')) return;
    // キーボードで椅子を選んで（Tab で focus して）押したら、その椅子（取り合いのとき。2026-11-19 Codex の点検）。椅子の focus は外さない（押し直しで続けて選べるように）
    const c = ev.target instanceof Element ? ui.chairs.indexOf(ev.target.closest('.it-chair')) : -1;
    if (c < 0 && ev.target instanceof HTMLElement && ev.target.closest('button')) ev.target.blur();
    ev.preventDefault();
    press(c >= 0 ? c : null);
  });
}

// 場の中身を、いまの時刻に合わせて描く
function draw() {
  const { s, o } = ui.cur;
  const me = seatOf(o);
  const tm = timing(s);
  const t = since(keyOf(s));
  const now = performance.now();
  if (!ui.sent && me !== null && s.acts[me] !== null) ui.sent = { ms: s.acts[me], c: s.chair ? s.seat[me] : null, k: bumpsOf(s, me) }; // 読み込み直したとき
  // 椅子の取り合い: 座ったつもりの椅子を取られた（はじき出された・先に座られていた）ら、押し直せるようにする
  if (s.chair && me !== null && ui.sent && s.acts[me] === null && bumpsOf(s, me) > ui.sent.k) {
    const b = s.bump[me];
    ui.sent = null;
    ui.bumped = `${o.names[b.by] ?? 'ほかの人'}に取られた！ ほかの椅子へ`;
    play('wrong');
  }
  let msg = '', sign = '', cls = '';
  let lit = -1;
  if (t < tm.intro) {
    msg = s.r === 1 ? 'まもなく始まります…' : '';
  } else {
    const into = t - tm.intro;
    if (ui.stopAt === null && into >= tm.wait) {
      ui.stopAt = now;
      play('smack');
    }
    const step = Math.floor(Math.min(into, tm.wait) / STEP_MS);
    lit = step % ui.chairs.length;
    if (ui.stopAt !== null) ui.stopLit = lit;
    if (ui.stopAt === null) {
      if (step !== ui.lastStep) { ui.lastStep = step; play('pop', 0.7); }
      sign = '♪'; cls = 'spin';
    } else { sign = '座れ！'; cls = 'stop'; }
    const mine = me !== null && s.alive[me];
    if (ui.sent) msg = `${secs(ui.sent.ms)}で座った！ ほかの人を待っています…`;
    else if (!mine) msg = me === null ? '観戦中' : '見ています（抜けた）';
    else if (now < ui.lockUntil) { msg = '早すぎ！ 1秒待って'; cls += ' lock'; }
    else if (ui.bumped) msg = ui.bumped;
    else if (ui.stopAt !== null) msg = s.chair ? 'いま！ あいている椅子を押す' : 'いま！ どの椅子でもいいから押す';
    else msg = '光と音が止まったら押す';
  }
  ui.chairs.forEach((c, i) => c.classList.toggle('lit', i === lit));
  // 椅子の取り合い: だれが座ったかは、自分の画面で止まったあとにだけ見せる
  if (s.chair) {
    const show = ui.stopAt !== null;
    ui.chairs.forEach((c, i) => {
      const who = show ? s.seat.indexOf(i) : -1;
      const mine = ui.sent?.c === i; // 自分は送った時点で座ったことにして見せる（取られたら上で外す）
      const taken = who >= 0 && who !== me && !mine;
      c.classList.toggle('mine', mine);
      c.classList.toggle('taken', taken);
      const face = mine ? '🧍' : taken ? '🧑' : '🪑';
      if (c.textContent !== face) c.textContent = face;
      c.setAttribute('aria-label', mine ? 'あなたの椅子' : taken ? `${o.names[who]}が座った椅子` : '椅子');
    });
  }
  ui.field.classList.toggle('stopped', ui.stopAt !== null);
  if (ui.sign.textContent !== sign) ui.sign.textContent = sign;
  ui.sign.className = 'it-sign ' + cls;
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
  head.textContent = `${L.r}回目` + (L.redo ? ' … やり直し！' : ` … ${L.out.map(name).join('・')}が座れなかった`);
  box.append(head);
  const order = L.players.slice().sort((a, b) => (L.acts[a] ?? 1e9) - (L.acts[b] ?? 1e9));
  for (const p of order) {
    const row = document.createElement('div');
    const v = L.acts[p];
    row.className = 'mq-line' + (p === me ? ' me' : '') + (L.out.includes(p) ? ' out' : '');
    const n = document.createElement('span');
    n.className = 'mq-name';
    n.textContent = name(p);
    const tm = document.createElement('span');
    tm.className = 'mq-time';
    tm.textContent = v === null ? (L.chair ? '座れず' : '押さず') : secs(v);
    const tag = document.createElement('span');
    tag.className = 'mq-tag';
    tag.textContent = L.out.includes(p) ? '脱落' : '';
    row.append(n, tm, tag);
    box.append(row);
  }
  return box;
}

export default {
  id: 'isutori',
  name: '椅子取りゲーム',
  icon: '🪑',
  desc: '光と音が止まったら椅子を押す。いちばん遅い人が抜けていく',
  ready: true,
  multi: true,
  realtime: true,
  quietCpu: true, // CPU が押したあとのひとことで、結果の前に押したことが分かってしまうため（見切りと同じ）
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'chair', label: '椅子の取り合い', desc: '1つの椅子には1人だけ。同じ椅子を押したら速かった人のもので、取られた人はほかの椅子を押し直す。座れなかった人が抜ける', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, r: 1, phase: 'wait', alive: Array(n).fill(true), acts: Array(n).fill(null), outAt: Array(n).fill(0), last: null, step: 0 };
    if (rules.chair === true) Object.assign(s, { chair: true, seat: Array(n).fill(null), tried: Array(n).fill(0), bump: Array(n).fill(null) });
    return s;
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'wait' && s.alive[p] && s.acts[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    const all = [...Array(s.n).keys()];
    const place = all.map((p) => 1 + all.filter((q) => q !== p && (s.alive[q] ? !s.alive[p] : !s.alive[p] && s.outAt[q] > s.outAt[p])).length);
    return { winners: alives(s), place };
  },
  resultText(res, me, pn) {
    if (res.winners.length === 1) return res.winners[0] === me ? 'あなたの勝ち！🎉 最後まで座れた' : `${pn(res.winners[0])}の勝ち！`;
    return `${res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同点で勝ち！`;
  },
  phaseText(s, me) {
    const what = `残り${alives(s).length}人・椅子${alives(s).length - 1}つ`;
    if (me >= 0 && !s.alive[me]) return `${what}　抜けました。見ています`;
    return `<b>${what}</b>　止まったら押す`;
  },
  // ほかの人が押した音は鳴らさない（押した知らせで止まったと分かってしまうため）。回の結果が出たときだけ鳴らす
  sound(a, b, m, me) {
    if (b.last !== a.last) return b.last.out.includes(me) ? 'wrong' : 'pop';
    return null;
  },

  referee(s) {
    if (s.phase !== 'wait') return null;
    const tm = timing(s);
    // 椅子の取り合いで椅子が全部ふさがったら、押し直しの間に合う人を少し待って締める（座る人が変わるたびに待ち直す）
    if (fullOf(s)) return { key: `full${s.r}:${s.seat.join(',')}`, ms: FULL_WAIT, move: { t: 'close', r: s.r } };
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
    if (m.t !== 'sit' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p)) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= MIN_MS) || m.ms > LIMIT) return null;
    if (s0.chair) {
      const p = m.p, ms = Math.round(m.ms), c = m.c;
      if (!Number.isInteger(c) || c < 0 || c >= chairCount(s0) || ms <= s0.tried[p]) return null;
      const s = clone(s0);
      s.step += 1;
      s.tried[p] = ms;
      const q = s.seat.indexOf(c); // その椅子に座っている人
      const bump = (x, by) => { s.bump[x] = { c, by, k: (s.bump[x]?.k ?? 0) + 1 }; };
      // 先に（速く）座っていた人のもの。同じ ms なら席の番号の小さい人（届いた順で決めない。2026-11-19 Codex の点検）
      if (q >= 0 && (s.acts[q] < ms || (s.acts[q] === ms && q < p))) bump(p, q);
      else {
        if (q >= 0) { s.acts[q] = null; s.seat[q] = null; bump(q, p); } // 後から届いた速い手が、座っていた人をはじき出す
        s.acts[p] = ms;
        s.seat[p] = c;
      }
      return s;
    }
    const s = clone(s0);
    s.step += 1;
    s.acts[m.p] = Math.round(m.ms);
    if (alives(s).every((p) => s.acts[p] !== null)) return resolve(s);
    return s;
  },

  // CPU: 回ごとに押す時刻（回の始めから）を1回だけ決める。ホストの画面でその時間がたったら押す
  cpuDelay(s, p) {
    if (s.phase !== 'wait') return 500;
    return Math.max(30, planOf(s, p).at - since(keyOf(s)));
  },
  cpu(s, p) {
    if (s.phase !== 'wait') return null;
    const plan = planOf(s, p);
    if (since(keyOf(s)) < plan.at - 5) return null;
    if (!s.chair) return { t: 'sit', r: s.r, ms: plan.react };
    if (plan.react > LIMIT) return null; // 押し直しが間に合わない
    // 椅子の取り合い: 空いている椅子から選ぶ（全部ふさがっていたら、どれかを取りにいく）
    const k = chairCount(s);
    const free = [...Array(k).keys()].filter((c) => !s.seat.includes(c));
    const pool = free.length ? free : [...Array(k).keys()];
    return { t: 'sit', r: s.r, ms: plan.react, c: pool[Math.floor(plan.u * pool.length)] };
  },

  render(root, s, o) {
    const me = seatOf(o);
    const mount = `${s.seed}:${s.r}:${s.phase}:${me}`;
    const fresh = ui?.mount !== mount || !root.contains(ui.field);
    const sent = fresh ? null : ui.sent;
    const lockUntil = fresh ? 0 : ui.lockUntil;
    // 止まった時刻は、席が変わっても（観戦から空いた席に入った）その回のあいだ覚えておく（見切りと同じ）
    const rk = keyOf(s);
    const stopAt = ui?.rk === rk && s.phase === 'wait' ? ui.stopAt : null;

    root.innerHTML = '';
    root.className = 'board mq it';
    // 参加者の札
    const row = document.createElement('div');
    row.className = 'mq-players';
    for (let p = 0; p < s.n; p++) {
      const c = document.createElement('div');
      c.className = 'mq-chip' + (p === me ? ' me' : '') + (s.alive[p] ? '' : ' out');
      const nm = document.createElement('span');
      nm.className = 'mq-chip-name';
      nm.textContent = p === me ? 'あなた' : o.names[p];
      const v = document.createElement('span');
      v.className = 'mq-chip-val';
      v.textContent = s.alive[p] ? '🧍' : '脱落';
      c.append(nm, v);
      const away = o.away[p] ? '応答なし' : o.sub?.[p] ? 'CPU が代わりに' : '';
      if (away) { const tg = document.createElement('span'); tg.className = 'mq-chip-tag'; tg.textContent = away; c.append(tg); }
      row.append(c);
    }
    root.append(row);

    // 椅子の輪（残っている人の数より1つ少ない）
    const field = document.createElement('div');
    field.className = 'it-field' + (s.phase === 'wait' && me !== null && o.canMove && s.alive[me] ? ' live' : '');
    const ring = document.createElement('div');
    ring.className = 'it-ring';
    const k = Math.max(1, alives(s).length - (s.phase === 'end' ? 0 : 1));
    const chairs = [];
    for (let i = 0; i < k; i++) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'it-chair';
      c.textContent = '🪑';
      c.setAttribute('aria-label', '椅子');
      const a = (i / k) * Math.PI * 2 - Math.PI / 2;
      c.style.left = `${50 + Math.cos(a) * 38}%`;
      c.style.top = `${50 + Math.sin(a) * 38}%`;
      ring.append(c);
      chairs.push(c);
    }
    const sign = document.createElement('div');
    sign.className = 'it-sign';
    ring.append(sign);
    const msg = document.createElement('div');
    msg.className = 'mq-msg';
    field.append(ring, msg);
    root.append(field);
    const same = ui?.rk === rk;
    ui = { mount, rk, field, ring, sign, msg, chairs, stopAt, lockUntil, sent, lastStep: same ? ui.lastStep : -1, stopLit: same ? ui.stopLit : null, bumped: !fresh ? ui.bumped : '', cur: { s, o } };

    // 前の回の結果（次の回が回り始めるまでの間と、終わったあと）
    if (s.last && (s.phase === 'end' || since(keyOf(s)) < introOf(s.r))) {
      const box = resultBox(s, o, s.last);
      field.append(box);
      if (s.phase === 'wait') setTimeout(() => box.remove(), Math.max(0, introOf(s.r) - since(keyOf(s))));
    }
    const note = document.createElement('p');
    note.className = 'mq-note';
    note.textContent = s.chair ? '光と音が止まったら、あいている椅子を押す。同じ椅子は速かった人のもの。座れなかった人が抜ける。止まる前に押すと1秒押せない'
      : '光と音が止まったら、どの椅子でも押す。いちばん遅い人が抜ける。止まる前に押すと1秒押せない';
    root.append(note);

    if (s.phase !== 'wait') { sign.textContent = 'おしまい'; sign.className = 'it-sign small'; return; }
    since(keyOf(s)); // この回が自分の画面に出た時刻を覚える（ここから止まるまでを数える）
    if (me !== null && o.canMove && s.alive[me]) {
      field.onpointerdown = (ev) => {
        ev.preventDefault();
        const c = ev.target instanceof Element ? ev.target.closest('.it-chair') : null; // 押した椅子（椅子の外なら光が止まった椅子）
        press(c ? chairs.indexOf(c) : null);
      };
    }
    loop(ui);
  },
};
