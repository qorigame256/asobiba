// だるまさんがころんだ。2〜10人。鬼は自動。鬼が「だるまさんがころんだ」と言っている間だけ、ボタンを押して前に進める。
// 鬼が振り向いている間に動いていたら見つかって、スタートに戻る。先に鬼の所まで着いた人の勝ち。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   鬼は人ではなく自動にし、振り向くまでの時間を毎回ばらばらにする。ボタンを押している間だけ進む（PC はスペースキーでも）。
//   見つかったらスタートに戻る（脱落しない）。
// Claude の判断:
//   - 1回（鬼が言う → 振り向く）の長さは種から決める（言うのは1.8〜5秒、振り向いているのは1.5〜3秒）。全員の端末で同じ。
//   - 振り向いてから0.35秒は止まるのが間に合ったことにする。それより後に押していたら見つかる（押しっぱなしも、振り向いてから押しても）。
//   - 進んだ長さと見つかったかは、各自の端末で測って、その回の終わりに1つの手で送る（難読漢字の ms と同じく、通信の遅れで不利にならない）。
//     ホストはその回の終わりから1.2秒待って締め、手が届かなかった人はその回は進まなかったことにする。
//   - 同じ回に2人以上が着いたら全員の勝ち。ほかの人の順位は進んだ長さで決める。
//   - ほかの人がいま進んでいる様子は見た目だけ送りっぱなしにする（o.stream。勝ち負けは手で決める）。
//   - 詳細設定「コースの長さ」: ふつう（最初）・みじかい・ながい。
// 2026-11-26 の48回目の案（本人が選んだ。案の名前は「人が鬼」。上の「鬼は人ではなく自動」を詳細設定で外す案だと伝えたうえで選ばれた。分かれ目は Claude の判断）:
//   詳細設定「鬼」（自動（最初）・人が交代で。鍵は oni）。人が交代でのときは:
//   - 1回（言う → 振り向く）ごとに鬼が席順に1人ずつ代わる（最初の鬼は種で決める。oniOf）。鬼の回はその人は進まない（全員がほぼ同じ回数ずつ鬼になる）。
//     鬼の点は無く、見つけた人がスタートに戻ることが鬼の得（先を行く人を戻せる）。CPU の席も鬼になる（1.8〜5.3秒で振り向く）。
//   - 鬼は「👀 ふりむく」（PC はスペースキーでも）を、回が始まって1秒たってから押せる。8秒たっても押さなければ、ホストが代わりに振り向かせる（{ p: -1, t: 'turn' }）。
//   - 走る人の「振り向いた時刻」は、各自の端末で振り向きの手を受け取った時刻にする（鬼の端末の時刻にすると、通信の遅れのぶん走る人が不利になる）。
//     振り向いている間は2秒で、そこから0.35秒は止まるのが間に合ったことにする（自動と同じ）。振り向いたのが見えないまま10秒たったら、その端末では進めなくする。
//   - 鬼が言う言葉は時間で1文字ずつ出すだけで、振り向くときの手がかりにはならない。
//   自動のときは局面に turn を持たない（前と全く同じ形。tools/test-logic.mjs が見ている）。
// 手: { p: -1, t: 'next' } / { p, t: 'cyc', k: 何回目か, d: 進んだ長さ（整数）, out: 見つかったか }
//    人が交代でのときは { p: 鬼の席 か -1, t: 'turn', k: 何回目か } も

import { mulberry32 } from './util.js';
import { since, scoreChips } from './party.js';
import { play } from '../sound.js';

const SPEED = 10; // 1秒押して進む長さ
const REACT_MS = 350;
const READY_MS = 3000;
const SEND_MS = 1200;
const LENGTHS = { short: 60, normal: 100, long: 150 };
const WORDS = 'だるまさんがころんだ';
const HUMAN_MIN = 1000; // 人の鬼が振り向けるようになるまで
const HUMAN_MAX = 8000; // これまでに振り向かなければホストが振り向かせる
const HUMAN_LOOK = 2000; // 人の鬼が振り向いている長さ
const WALK_CAP = HUMAN_MAX + 2000; // 振り向いたのが届かないまま進める長さの上限（ms）

const lenOf = (s) => LENGTHS[s.rules.length] ?? 100;
const humanOni = (s) => s.rules.oni === 'human';
// k 回目の鬼の席（人が交代でのとき）。自動のときは -1
export const oniOf = (s, k = s.k) => (humanOni(s) && k >= 0 ? (k + (s.seed >>> 0)) % s.n : -1);
// k 回目の、鬼が言う長さと振り向いている長さ（ms）
export function cycleOf(seed, k) {
  const rnd = mulberry32((seed * 31 + k * 7919) >>> 0);
  rnd();
  return { walk: Math.round(1800 + rnd() * 3200), look: Math.round(1500 + rnd() * 1500) };
}
const maxD = (walk) => Math.floor((walk * SPEED) / 1000) + 1;
const rKey = (s, k = s.k) => `daruma:${s.seed}:${k}`;
const clone = (s) => ({ ...s, pos: s.pos.slice(), sub: s.sub.slice(), caught: s.caught.slice() });
// 順位（1 から）。着いた人が上、あとは進んだ長さの順
const placeOf = (pos) => pos.map((v) => 1 + pos.filter((w) => w > v).length);
// 走る人の位置。端から 15px は余白にし、0% でも人形が帯の外へはみ出さないようにする（2026-11-17 見た目の点検。0% で人形の半分が帯の左の外に出ていた）
const manLeft = (v, L) => `calc(15px + (100% - 30px) * ${Math.min(L, v) / L})`;

let run = null; // この端末の、いまの回の様子 { key, walked, holding, out, sent }
let live = new Map(); // ほかの人がいまの回で進んだ長さ（見た目だけ）
const cpuPlan = new Map();
let ui = null;
let bound = false;
let spaceHeld = false;

function bindKeys() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  const up = () => { if (run) run.holding = spaceHeld; };
  document.addEventListener('pointerup', () => { if (run) run.press = false; up(); });
  document.addEventListener('pointercancel', () => { if (run) run.press = false; up(); });
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !ui?.wrap.isConnected || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    if (ui.oniKey) { ui.oniKey(); return; } // 人の鬼の回で、自分が鬼のとき
    spaceHeld = true;
    if (run) run.holding = true;
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    if (run) run.holding = !!run.press;
  });
}

export default {
  id: 'daruma',
  name: 'だるまさんがころんだ',
  icon: '🧍',
  desc: '鬼が見ていない間だけ進む。動いているのを見られたらスタートへ',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'length', label: 'コースの長さ', desc: 'みじかいはすぐ終わる。ながいは振り向きの回数が増える', def: 'normal', choices: [['normal', 'ふつう'], ['short', 'みじかい'], ['long', 'ながい']] },
    { key: 'oni', label: '鬼', desc: '人が交代でにすると、1回ごとに順番に1人が鬼になり、振り向くときを自分で決める（鬼の回は進めない）', def: 'auto', choices: [['auto', '自動'], ['human', '人が交代で']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, rules: { length: 'normal', ...rules }, phase: 'ready', k: -1, pos: Array(n).fill(0), sub: Array(n).fill(null), caught: Array(n).fill(0), last: null, step: 0 };
    if (humanOni(s)) s.turn = false; // 自動のときは持たない（前と全く同じ形）
    return s;
  },

  turn() { return null; },
  canAct(s, p) {
    if (s.phase !== 'run') return false;
    if (p === oniOf(s)) return !s.turn; // 人の鬼は振り向くまで
    return s.sub[p] === null;
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const L = lenOf(s);
    return { winners: s.pos.map((v, p) => (v >= L ? p : -1)).filter((p) => p >= 0), place: placeOf(s.pos) };
  },
  sound(a, b, m, me) {
    if (m.p !== -1 || m.t === 'turn') return null; // 振り向きの音は各自の画面で振り向いたときに鳴らす
    if (b.last && me >= 0 && b.last.out[me]) return 'wrong';
    return m.t === 'next' && a.phase === 'ready' ? 'question' : 'pop';
  },
  resultText(res, me, pn) {
    const w = res.winners;
    if (w.length === 1) return w[0] === me ? 'あなたが一番に着いた！🎉' : `${pn(w[0])}が一番に着いた！`;
    return `${w.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同時に着いた！`;
  },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.k + 1}回目`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'run' && humanOni(s)) {
      if (!s.turn) return { key: 'hw' + s.k, ms: HUMAN_MAX, move: { t: 'turn', k: s.k } };
      return { key: 'hl' + s.k, ms: HUMAN_LOOK + SEND_MS, move: { t: 'next' } };
    }
    if (s.phase === 'run') {
      const c = cycleOf(s.seed, s.k);
      return { key: 'run' + s.k, ms: c.walk + c.look + SEND_MS, move: { t: 'next' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.t === 'turn') { // 人の鬼が振り向く（8秒たってもまだならホストが代わりに）
      if (!humanOni(s0) || s0.phase !== 'run' || s0.turn || m.k !== s0.k || (m.p !== -1 && m.p !== oniOf(s0))) return null;
      const s = clone(s0);
      s.step += 1;
      s.turn = true;
      return s;
    }
    if (m.p === -1) {
      if (m.t !== 'next' || (s0.phase !== 'ready' && s0.phase !== 'run')) return null;
      const s = clone(s0);
      s.step += 1;
      if (s0.phase === 'run') {
        const L = lenOf(s);
        const d = s.sub.map((x) => (x && !x.out ? x.d : 0));
        const out = s.sub.map((x) => !!x?.out);
        s.pos = s.pos.map((v, p) => (out[p] ? 0 : Math.min(L, v + d[p])));
        out.forEach((x, p) => { if (x) s.caught[p] += 1; });
        s.last = { k: s.k, d, out };
        if (s.pos.some((v) => v >= L)) { s.phase = 'end'; return s; }
      }
      s.phase = 'run';
      s.k += 1;
      s.sub = Array(s.n).fill(null);
      if (humanOni(s)) s.turn = false;
      return s;
    }
    if (m.t !== 'cyc' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p) || m.k !== s0.k || m.p === oniOf(s0)) return null;
    if (!Number.isInteger(m.d) || m.d < 0 || m.d > maxD(humanOni(s0) ? WALK_CAP : cycleOf(s0.seed, s0.k).walk) || typeof m.out !== 'boolean') return null;
    const s = clone(s0);
    s.step += 1;
    s.sub[m.p] = { d: m.d, out: m.out };
    return s;
  },

  // CPU: 鬼が言っている間の5〜8割くらい進む。2割ほどは止まりそこねて見つかる。回の終わりに送る
  cpuDelay() { return 200; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const key = rKey(s) + ':' + p;
    if (humanOni(s)) {
      let plan = cpuPlan.get(key);
      if (!plan) {
        plan = p === oniOf(s) ? { at: 1800 + Math.random() * 3500 } : { out: Math.random() < 0.2, frac: 0.5 + Math.random() * 0.3 };
        cpuPlan.set(key, plan);
        if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
      }
      if (p === oniOf(s)) return since(rKey(s)) >= plan.at ? { t: 'turn', k: s.k } : null;
      if (!s.turn) return null;
      plan.walk ??= Math.min(WALK_CAP, since(rKey(s))); // 振り向いたのを知ったときまで言っていたことにする
      if (since(rKey(s) + ':turn') < HUMAN_LOOK) return null;
      return { t: 'cyc', k: s.k, d: plan.out ? 0 : Math.floor(maxD(plan.walk) * plan.frac), out: plan.out };
    }
    const c = cycleOf(s.seed, s.k);
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { out: Math.random() < 0.2, d: Math.floor(maxD(c.walk) * (0.5 + Math.random() * 0.3)) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (since(rKey(s)) < c.walk + c.look) return null;
    return { t: 'cyc', k: s.k, d: plan.d, out: plan.out };
  },

  onStream(d, from) {
    if (d && Number.isInteger(d.k) && Number.isFinite(d.d)) live.set(from, d);
  },

  render(root, s, o) {
    bindKeys();
    // 観戦の人が「見る画面」でほかの人を選んでいても、その人の席として扱わない（前はボタンが押せて、同じ席に入るとその分まで送っていた。2026-10-28 Codex の点検の指摘）
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const L = lenOf(s);
    const mount = `${s.seed}:${s.k}:${s.phase}:${me}`;
    const oniP = s.phase === 'run' ? oniOf(s) : -1; // 人の鬼の回の鬼（自動のときは -1）
    const oniName = (p) => (p === me ? 'あなた' : o.names[p]);
    const extra = (p) => (p === oniP ? '<span class="pt-ok">👹鬼</span>' : s.phase === 'run' && s.sub[p] ? '<span class="pt-ok">✓</span>' : '');
    const chips = scoreChips(me === null ? { ...o, me: -1 } : o, s.pos.map(() => 0), { won: this.result(s)?.winners ?? [], extra, steady: true });
    chips.querySelectorAll('.pt-score').forEach((x, p) => { x.innerHTML = `${Math.floor((Math.min(L, s.pos[p]) / L) * 100)}<small>%</small>`; });
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.s = s;
      return;
    }
    root.innerHTML = '';
    root.className = 'board kj dr';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    ui = { mount, wrap, chips, s };
    wrap.append(chips);
    root.append(wrap);

    // 鬼
    const oni = document.createElement('div');
    oni.className = 'dr-oni';
    const face = document.createElement('div');
    face.className = 'dr-face';
    const words = document.createElement('div');
    words.className = 'dr-words';
    oni.append(face, words);
    if (oniP >= 0) { // 人の鬼の回: だれが鬼か
      const who = document.createElement('div');
      who.className = 'dr-who';
      who.textContent = `👹 鬼: ${oniName(oniP)}`;
      oni.prepend(who);
      oni.classList.add('human');
    }
    wrap.append(oni);

    // コース（1人1本）
    const lanes = document.createElement('div');
    lanes.className = 'dr-lanes';
    const runners = [];
    const seats = me === null ? [...Array(s.n).keys()] : [me, ...[...Array(s.n).keys()].filter((p) => p !== me)];
    for (const p of seats) {
      const lane = document.createElement('div');
      lane.className = 'dr-lane' + (p === me ? ' mine' : '') + (p === oniP ? ' oni' : '');
      const nm = document.createElement('div');
      nm.className = 'dr-name';
      nm.textContent = (p === me ? 'あなた' : o.names[p]) + (p === oniP ? ' 👹' : '');
      const track = document.createElement('div');
      track.className = 'dr-track';
      const man = document.createElement('span');
      man.className = 'dr-man';
      man.textContent = '🏃';
      track.append(man);
      lane.append(nm, track);
      lanes.append(lane);
      runners[p] = man;
    }
    wrap.append(lanes);

    const note = document.createElement('p');
    note.className = 'cc-log';

    if (s.phase === 'ready' || s.phase === 'end') {
      face.textContent = s.phase === 'end' ? '🧍' : '🧍';
      words.textContent = s.phase === 'end' ? 'おしまい！' : humanOni(s) ? 'よーい…（1回ごとに鬼が交代）' : 'よーい…（ボタンを押している間だけ進む）';
      const st = s;
      runners.forEach((man, p) => { if (man) man.style.left = manLeft(st.pos[p], L); });
      if (s.phase === 'end' && s.last) note.textContent = s.last.out[me] ? '最後の回で見つかってしまった…' : '';
      wrap.append(note);
      return;
    }

    // いまの回
    const key = rKey(s);
    const human = humanOni(s);
    const c = human ? null : cycleOf(s.seed, s.k);
    const iOni = me !== null && me === oniP; // 人の鬼の回で、自分が鬼
    // 席が変わったら（観戦から空いた席に入ったなど）測り直す。鍵だけで見ると、観戦中の「送った」のまま押せなかった（2026-10-28 Codex の点検の指摘）
    if (run?.key !== key || run.me !== me) { run = { key, me, walked: 0, holding: spaceHeld, press: false, out: false, sent: iOni || s.sub[me] !== null, turned: false, turnAt: null, turnSent: false }; live = new Map(); }
    since(key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary dr-btn';
    btn.oncontextmenu = (e) => e.preventDefault();
    // 人の鬼: 振り向く（1秒たってから。届くまで2回は送らない）
    const turnNow = () => {
      const cur = ui?.s ?? s;
      if (!iOni || cur.turn || run.turnSent || since(key) < HUMAN_MIN) return;
      run.turnSent = true;
      o.onMove({ t: 'turn', k: s.k });
    };
    if (iOni) {
      btn.textContent = '👀 ふりむく';
      btn.onpointerdown = (e) => { e.preventDefault(); turnNow(); };
      ui.oniKey = turnNow;
    } else {
      btn.textContent = '🏃 押している間すすむ';
      btn.onpointerdown = (e) => { e.preventDefault(); run.press = true; run.holding = true; };
    }
    if (me !== null) wrap.append(btn);
    wrap.append(note);
    // 前の回に自分が鬼で見つけた人数（人の鬼のとき、次の回の始めに出す）
    const found = human && me !== null && s.k > 0 && oniOf(s, s.k - 1) === me ? (s.last?.out.filter(Boolean).length ?? 0) : 0;

    let lastT = since(key);
    let lastSend = 0;
    const tick = () => {
      if (!wrap.isConnected) return;
      const cur = ui?.s ?? s;
      const t = since(key);
      const dt = Math.max(0, t - lastT);
      lastT = t;
      // 鬼が言い終える時刻と振り向き終える時刻。人の鬼は、この端末で振り向きの手を受け取った時刻から数える
      if (human && cur.turn && run.turnAt === null) run.turnAt = t;
      const walkEnd = human ? (run.turnAt ?? WALK_CAP) : c.walk;
      const lookEnd = human ? (run.turnAt === null ? Infinity : run.turnAt + HUMAN_LOOK) : c.walk + c.look;
      const looking = t >= walkEnd && t < lookEnd;
      if (me !== null && run.key === key && !run.sent) {
        const room = ((L - cur.pos[me]) * 1000) / SPEED; // ゴールまでに押せる長さ（ms）
        if (run.holding && t < walkEnd) run.walked = Math.min(run.walked + Math.min(dt, walkEnd - (t - dt)), room);
        // 鬼の所まで着いたら、押したままでも見つからない（前は着いたあとに押し続けるとスタートに戻された。2026-10-28 Codex の点検の指摘）
        if (run.holding && t >= walkEnd + REACT_MS && looking && run.walked < room) run.out = true;
        if (t >= lookEnd) {
          run.sent = true;
          o.onMove({ t: 'cyc', k: s.k, d: Math.min(maxD(human ? WALK_CAP : c.walk), Math.floor((run.walked * SPEED) / 1000)), out: run.out });
        }
        if (o.stream && t - lastSend > 250 && t < lookEnd) { lastSend = t; o.stream({ k: s.k, d: Math.floor((run.walked * SPEED) / 1000), out: run.out }); }
      }
      if (looking && !run.turned) { run.turned = true; play('turn'); }
      // 鬼
      if (t < walkEnd) {
        face.textContent = '🧍';
        face.classList.remove('look');
        // 人の鬼は言葉を時間で1文字ずつ出してくり返すだけ（振り向く時の手がかりにしない）
        words.textContent = human ? WORDS.slice(0, Math.min(WORDS.length, (Math.floor(t / 250) % (WORDS.length + 3)) + 1)) : WORDS.slice(0, Math.min(WORDS.length, Math.floor((t / c.walk) * WORDS.length) + 1));
      } else if (looking) {
        face.textContent = '👀';
        face.classList.add('look');
        words.textContent = '見てる！ 止まれ！';
      } else {
        face.textContent = '🧍';
        face.classList.remove('look');
        words.textContent = '…';
      }
      // 走る人
      runners.forEach((man, p) => {
        if (!man) return;
        let v = cur.pos[p];
        if (p === me) v += Math.floor((run.walked * SPEED) / 1000);
        else if (live.get(p)?.k === s.k && !live.get(p).out) v += live.get(p).d;
        man.style.left = manLeft(v, L);
        man.classList.toggle('out', (p === me && run.out) || (p !== me && live.get(p)?.k === s.k && live.get(p).out));
      });
      if (iOni) {
        btn.disabled = t < HUMAN_MIN || !!cur.turn || run.turnSent;
        if (!cur.turn && !run.turnSent) note.textContent = t < HUMAN_MIN ? 'あなたが鬼。もうすぐ振り向けます…' : `あなたが鬼。好きなときに「ふりむく」（あと${Math.max(0, Math.ceil((HUMAN_MAX - t) / 1000))}秒で自動）`;
        else if (looking) note.textContent = '見てる！ 動いた人はスタートに戻ります';
        else if (run.turnAt === null) note.textContent = '振り向きます…';
        else note.textContent = 'この回はおしまい。次の回を待っています…';
      } else if (me !== null) {
        btn.classList.toggle('on', !!run.holding);
        btn.disabled = run.sent;
        if (run.out) note.textContent = '見つかった！ この回が終わったらスタートに戻ります';
        else if (run.sent) note.textContent = 'この回はおしまい。次の回を待っています…';
        else if (looking) note.textContent = run.holding ? '動いてる！ 指を離して！' : 'じっとして…';
        else if (found && t < 3000) note.textContent = `前の回、鬼のあなたが${found}人見つけた！ 押して進もう`;
        else note.textContent = cur.last?.out[me] && t < (human ? 3000 : c.walk) ? '前の回で見つかってスタートに戻った… 押して進もう' : '鬼が言っている間に押して進もう';
      } else note.textContent = '観戦中';
      requestAnimationFrame(tick);
    };
    tick();
  },
};
