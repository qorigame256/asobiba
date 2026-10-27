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
// 手: { p: -1, t: 'next' } / { p, t: 'cyc', k: 何回目か, d: 進んだ長さ（整数）, out: 見つかったか }

import { mulberry32 } from './util.js';
import { since, scoreChips } from './party.js';
import { play } from '../sound.js';

const SPEED = 10; // 1秒押して進む長さ
const REACT_MS = 350;
const READY_MS = 3000;
const SEND_MS = 1200;
const LENGTHS = { short: 60, normal: 100, long: 150 };
const WORDS = 'だるまさんがころんだ';

const lenOf = (s) => LENGTHS[s.rules.length] ?? 100;
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
  ],

  init(n, seed, { rules = {} } = {}) {
    return { n, seed, rules: { length: 'normal', ...rules }, phase: 'ready', k: -1, pos: Array(n).fill(0), sub: Array(n).fill(null), caught: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'run' && s.sub[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    const L = lenOf(s);
    return { winners: s.pos.map((v, p) => (v >= L ? p : -1)).filter((p) => p >= 0), place: placeOf(s.pos) };
  },
  sound(a, b, m, me) {
    if (m.p !== -1) return null;
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
    if (s.phase === 'run') {
      const c = cycleOf(s.seed, s.k);
      return { key: 'run' + s.k, ms: c.walk + c.look + SEND_MS, move: { t: 'next' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
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
      return s;
    }
    if (m.t !== 'cyc' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p) || m.k !== s0.k) return null;
    if (!Number.isInteger(m.d) || m.d < 0 || m.d > maxD(cycleOf(s0.seed, s0.k).walk) || typeof m.out !== 'boolean') return null;
    const s = clone(s0);
    s.step += 1;
    s.sub[m.p] = { d: m.d, out: m.out };
    return s;
  },

  // CPU: 鬼が言っている間の5〜8割くらい進む。2割ほどは止まりそこねて見つかる。回の終わりに送る
  cpuDelay() { return 200; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const c = cycleOf(s.seed, s.k);
    const key = rKey(s) + ':' + p;
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
    const me = o.me >= 0 ? o.me : null;
    const L = lenOf(s);
    const mount = `${s.seed}:${s.k}:${s.phase}:${me}`;
    const chips = scoreChips(o, s.pos.map(() => 0), { won: this.result(s)?.winners ?? [], extra: (p) => (s.phase === 'run' && s.sub[p] ? '<span class="pt-ok">✓</span>' : '') });
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
    wrap.append(oni);

    // コース（1人1本）
    const lanes = document.createElement('div');
    lanes.className = 'dr-lanes';
    const runners = [];
    const seats = me === null ? [...Array(s.n).keys()] : [me, ...[...Array(s.n).keys()].filter((p) => p !== me)];
    for (const p of seats) {
      const lane = document.createElement('div');
      lane.className = 'dr-lane' + (p === me ? ' mine' : '');
      const nm = document.createElement('div');
      nm.className = 'dr-name';
      nm.textContent = p === me ? 'あなた' : o.names[p];
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
      words.textContent = s.phase === 'end' ? 'おしまい！' : 'よーい…（ボタンを押している間だけ進む）';
      const st = s;
      runners.forEach((man, p) => { if (man) man.style.left = `${(Math.min(L, st.pos[p]) / L) * 100}%`; });
      if (s.phase === 'end' && s.last) note.textContent = s.last.out[me] ? '最後の回で見つかってしまった…' : '';
      wrap.append(note);
      return;
    }

    // いまの回
    const key = rKey(s);
    const c = cycleOf(s.seed, s.k);
    if (run?.key !== key) { run = { key, walked: 0, holding: spaceHeld, press: false, out: false, sent: s.sub[me] !== null, turned: false }; live = new Map(); }
    since(key);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn primary dr-btn';
    btn.textContent = '🏃 押している間すすむ';
    btn.oncontextmenu = (e) => e.preventDefault();
    btn.onpointerdown = (e) => { e.preventDefault(); run.press = true; run.holding = true; };
    if (me !== null) wrap.append(btn);
    wrap.append(note);

    let lastT = since(key);
    let lastSend = 0;
    const tick = () => {
      if (!wrap.isConnected) return;
      const cur = ui?.s ?? s;
      const t = since(key);
      const dt = Math.max(0, t - lastT);
      lastT = t;
      const looking = t >= c.walk && t < c.walk + c.look;
      if (me !== null && run.key === key && !run.sent) {
        const room = ((L - cur.pos[me]) * 1000) / SPEED; // ゴールまでに押せる長さ（ms）
        if (run.holding && t < c.walk) run.walked = Math.min(run.walked + Math.min(dt, c.walk - (t - dt)), room);
        if (run.holding && t >= c.walk + REACT_MS && looking) run.out = true;
        if (t >= c.walk + c.look) {
          run.sent = true;
          o.onMove({ t: 'cyc', k: s.k, d: Math.min(maxD(c.walk), Math.floor((run.walked * SPEED) / 1000)), out: run.out });
        }
        if (o.stream && t - lastSend > 250 && t < c.walk + c.look) { lastSend = t; o.stream({ k: s.k, d: Math.floor((run.walked * SPEED) / 1000), out: run.out }); }
      }
      if (looking && !run.turned) { run.turned = true; play('turn'); }
      // 鬼
      if (t < c.walk) {
        face.textContent = '🧍';
        face.classList.remove('look');
        words.textContent = WORDS.slice(0, Math.min(WORDS.length, Math.floor((t / c.walk) * WORDS.length) + 1));
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
        man.style.left = `${(Math.min(L, v) / L) * 100}%`;
        man.classList.toggle('out', (p === me && run.out) || (p !== me && live.get(p)?.k === s.k && live.get(p).out));
      });
      btn.classList.toggle('on', !!run.holding);
      btn.disabled = me === null || run.sent;
      if (me !== null) {
        if (run.out) note.textContent = '見つかった！ この回が終わったらスタートに戻ります';
        else if (run.sent) note.textContent = 'この回はおしまい。次の回を待っています…';
        else if (looking) note.textContent = run.holding ? '動いてる！ 指を離して！' : 'じっとして…';
        else note.textContent = cur.last?.out[me] && t < c.walk ? '前の回で見つかってスタートに戻った… 押して進もう' : '鬼が言っている間に押して進もう';
      } else note.textContent = '観戦中';
      requestAnimationFrame(tick);
    };
    tick();
  },
};
