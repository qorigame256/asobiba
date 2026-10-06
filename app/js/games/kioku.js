// 記憶リレー。2〜10人が同時に遊ぶ。4色のボタンが順番に光り、全員がその順番を覚えて押す。1回ごとに1つずつ長くなる（3つから）。
// 1回間違えたら脱落（詳細設定で「3回まで」も選べる。2026-10-06 本人の決定）。最後まで残った人の勝ち。
// Claude の判断: 時間内に押し終えなかったら間違いと同じ。残っていた全員が同じ回で脱落したら、その人たちが同点で1位。
//   順番は seed から決めた30個（最長30個まで。そこまで残った人は全員1位）。点は「覚えられた一番長い数」。
//   押した順番そのものを手として送り、正しいかは全員の端末で同じように確かめる。間違えたらその時点で送る。
// 詳細設定「だんだん速く」（2026-10-06 本人の決定。最初はなし）: 光る間隔を、3個の 0.7秒から1個長くなるごとに 0.035秒ずつ縮め、0.35秒で止める
//   （13個で一番速くなる。光っている長さも同じ割合で縮める。Claude の判断）。押す時間は今までと同じ。CPU の間違えやすさも同じ。
//
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → go → show（光る）→ open → input →（全員押した / 時間切れ）→ close → shown → go …
// 手: { p: -1, t: 'go' | 'open' | 'close' } / { p, t: 'in', r: 何回目, keys: [押したボタン 0〜3 …] }（1回に1人1度だけ）

import { mulberry32 } from './util.js';
import { since, scoreChips, timeBar } from './party.js';
import { play } from '../sound.js';

const MAX = 30;
const FIRST = 3;
const READY_MS = 2500;
const LEAD_MS = 700; // 光り始めるまでの間
const STEP_MS = 700; // 1つ光る間隔（光っているのは ON_MS）
const ON_MS = 450;
const FAST_MIN = 350; // だんだん速く（詳細設定）の一番短い間隔
const FAST_STEP = 35; // 1個長くなるごとに縮める分
const SHOWN_MS = 2600;
const GRACE_MS = 1500;
const COLORS = ['赤', '青', '黄', '緑'];

const lenOf = (s) => FIRST + s.round;
// 1つ光る間隔と光っている長さ（だんだん速くなら長いほど短い）
const stepOf = (s, len) => (s.rules.fast ? Math.max(FAST_MIN, STEP_MS - (len - FIRST) * FAST_STEP) : STEP_MS);
const onOf = (s, len) => Math.round((stepOf(s, len) * ON_MS) / STEP_MS);
const showMs = (s, len) => LEAD_MS + len * stepOf(s, len);
const inputMs = (len) => 4000 + len * 800;
const keyOf = (s, part) => `kioku:${s.seed}:${s.round}:${part}`;
const clone = (s) => ({ ...s, lives: s.lives.slice(), done: s.done.slice(), best: s.best.slice(), outAt: s.outAt.slice() });
const aliveOf = (s) => s.lives.map((v, p) => (v > 0 ? p : -1)).filter((p) => p >= 0);

// 押した順番が正しいか。正しくて途中までなら undefined（まだ送れない）
function judge(s, keys) {
  const len = lenOf(s);
  if (!Array.isArray(keys) || !keys.length || keys.length > len || !keys.every((k) => Number.isInteger(k) && k >= 0 && k < 4)) return null;
  const miss = keys.findIndex((k, i) => k !== s.seq[i]);
  if (miss >= 0) return miss === keys.length - 1 ? false : null; // 間違えたらそこで送る決まり
  return keys.length === len ? true : undefined;
}

function winnersOf(s) {
  const alive = aliveOf(s);
  if (alive.length) return alive;
  const top = Math.max(...s.outAt);
  return s.outAt.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
}

const cpuPlan = new Map();
let ui = null; // { mount, wrap, chips, keys }

export default {
  id: 'kioku',
  name: '記憶リレー',
  icon: '🧠',
  desc: '光ったボタンの順番を覚えて押す。1回ごとに長くなる。最後まで残った人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'fast', label: 'だんだん速く', desc: '長くなるほど光る間が短くなる（0.7秒から、13個で0.35秒まで）', def: false },
    { key: 'lives', label: '間違えられる回数', desc: '何回間違えたら脱落か', def: 1, choices: [[1, '1回で脱落'], [3, '3回まで']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const lives = rules.lives === 3 ? 3 : 1;
    const rnd = mulberry32(seed);
    const seq = Array.from({ length: MAX }, () => Math.floor(rnd() * 4));
    return {
      n, seed, rules: { lives, fast: rules.fast === true }, seq, round: -1, phase: 'ready', lives: Array(n).fill(lives), done: Array(n).fill(null),
      best: Array(n).fill(0), outAt: Array(n).fill(-1), last: null, step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'input' && s.lives[p] > 0 && s.done[p] === null; },
  result(s) { return s.phase === 'end' ? { winners: winnersOf(s), scores: s.best } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'go') return 'question';
      if (m.t === 'close') return b.last?.res[me] === 'ok' ? 'correct' : b.last?.res[me] ? 'wrong' : 'pop';
      return null;
    }
    return null;
  },
  resultText(res, me, pn) {
    const w = res.winners;
    if (w.length === 1) return w[0] === me ? 'あなたの勝ち！🎉' : `${pn(w[0])}の勝ち！`;
    return `${w.map(pn).join('・')}が同点で1位！${w.includes(me) ? '🎉' : ''}`;
  },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    if (s.phase === 'show') return `${s.round + 1}回目（${lenOf(s)}個）: 光る順番を覚えて！`;
    if (s.phase === 'input') return `${s.round + 1}回目（${lenOf(s)}個）: 同じ順番で押して！`;
    return `${s.round + 1}回目の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'show') return { key: 'show' + s.round, ms: showMs(s, lenOf(s)), move: { t: 'open' } };
    if (s.phase === 'input') {
      if (aliveOf(s).every((p) => s.done[p] !== null)) return { key: 'all' + s.round, ms: 500, move: { t: 'close' } };
      return { key: 'in' + s.round, ms: inputMs(lenOf(s)) + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.round, ms: SHOWN_MS, move: { t: 'go' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      const s = clone(s0);
      s.step += 1;
      if (m.t === 'go' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        s.round += 1;
        s.phase = 'show';
        s.done = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'open' && s0.phase === 'show') { s.phase = 'input'; return s; }
      if (m.t === 'close' && s0.phase === 'input') {
        const res = Array(s.n).fill(null);
        for (const p of aliveOf(s0)) {
          if (s.done[p] === true) { res[p] = 'ok'; s.best[p] = lenOf(s); continue; }
          res[p] = s.done[p] === false ? 'ng' : 'late';
          s.lives[p] -= 1;
          if (!s.lives[p]) s.outAt[p] = s.round;
        }
        s.last = { res };
        s.phase = aliveOf(s).length <= 1 || lenOf(s) >= MAX ? 'end' : 'shown';
        return s;
      }
      return null;
    }
    if (m.t !== 'in' || m.r !== s0.round || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p)) return null;
    const ok = judge(s0, m.keys);
    if (ok !== true && ok !== false) return null;
    const s = clone(s0);
    s.step += 1;
    s.done[m.p] = ok;
    return s;
  },

  // CPU: 長くなるほど間違えやすい（3個で3%、5個で16%、7個で32%、9個で48%）。押し終えるまでの時間は 1個 0.45秒＋1秒
  cpuDelay(s) { return s.phase === 'input' ? 150 : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const len = lenOf(s);
    const key = keyOf(s, 'in') + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const miss = Math.random() < Math.min(0.9, Math.max(0.03, (len - 3) * 0.08));
      const keys = s.seq.slice(0, len);
      if (miss) {
        const at = Math.floor(Math.random() * len);
        keys.length = at + 1;
        keys[at] = (keys[at] + 1 + Math.floor(Math.random() * 3)) % 4;
      }
      plan = { at: 1000 + keys.length * 450, keys };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    if (since(keyOf(s, 'in')) < plan.at) return null;
    return { t: 'in', r: s.round, keys: plan.keys };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const ended = s.phase === 'end';
    const won = ended ? winnersOf(s) : [];
    const heart = (p) => (s.rules.lives > 1 ? `<span class="km-life">${'♥'.repeat(Math.max(0, s.lives[p]))}</span>` : '');
    const extra = (p) => {
      if (s.lives[p] <= 0 && !(s.last && s.outAt[p] === s.round && (s.phase === 'shown' || ended))) return '<span class="pt-ng">脱落</span>';
      if (s.phase === 'input') return heart(p) + (s.done[p] !== null ? '<span class="pt-ok">押した</span>' : '');
      if ((s.phase === 'shown' || ended) && s.last?.res[p]) {
        const r = s.last.res[p];
        return heart(p) + (r === 'ok' ? '<span class="pt-ok">せいかい</span>' : `<span class="pt-ng">${r === 'late' ? '時間切れ' : 'まちがい'}</span>`);
      }
      return heart(p);
    };
    const chips = scoreChips(o, s.best, { won, extra });
    const mine = me !== null && s.phase === 'input' ? s.done[me] : null;
    const mount = `${s.seed}:${s.round}:${s.phase}:${me}:${mine}`;
    if (ui?.mount === mount && root.contains(ui.wrap)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    const keys = ui?.round === `${s.seed}:${s.round}` ? ui.keys : [];
    root.innerHTML = '';
    root.className = 'board km';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(chips);
    ui = { mount, wrap, chips, keys, round: `${s.seed}:${s.round}` };
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    root.append(wrap);

    if (s.phase === 'ready') {
      card.innerHTML = '<div class="kj-word small">よーい…</div><div class="kj-sub">光る順番を覚えてください</div>';
      return;
    }
    const len = lenOf(s);
    const head = document.createElement('div');
    head.className = 'kj-num';
    head.textContent = `${s.round + 1}回目（${len}個）`;
    const msg = document.createElement('div');
    msg.className = 'kj-sub km-msg';
    const pad = document.createElement('div');
    pad.className = 'km-pad';
    const btns = COLORS.map((name, k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `km-btn c${k}`;
      b.setAttribute('aria-label', name);
      b.disabled = true;
      pad.append(b);
      return b;
    });
    card.append(head, pad, msg);
    const flash = (k, ms = 220) => { btns[k].classList.add('lit'); setTimeout(() => btns[k].classList.remove('lit'), ms); };

    // 光る順番を見せる（自分の画面に出てからの時間で。入力の番になっていても、見せ終わるまでは押せない）
    const showKey = keyOf(s, 'show');
    if (s.phase === 'show' || s.phase === 'input') {
      since(showKey);
      const total = showMs(s, len);
      const step = stepOf(s, len);
      const on = onOf(s, len);
      const tick = () => {
        if (!pad.isConnected) return;
        const t = since(showKey) - LEAD_MS;
        const i = Math.floor(t / step);
        btns.forEach((b, k) => b.classList.toggle('lit', t >= 0 && i < len && t - i * step < on && s.seq[i] === k));
        if (since(showKey) < total) requestAnimationFrame(tick);
        else btns.forEach((b) => b.classList.remove('lit'));
      };
      tick();
    }

    if (s.phase === 'show') {
      msg.textContent = '光る順番を覚えて！';
    } else if (s.phase === 'input') {
      if (me === null) msg.textContent = '観戦中';
      else if (s.lives[me] <= 0) msg.textContent = '脱落しました。ほかの人を見守りましょう';
      else if (mine !== null) msg.textContent = mine ? 'せいかい！ほかの人を待っています' : 'まちがい…';
      else {
        const inKey = keyOf(s, 'in');
        const wait = Math.max(0, showMs(s, len) - since(showKey));
        const prog = document.createElement('div');
        prog.className = 'km-prog';
        const update = () => { prog.textContent = `${keys.length} / ${len}`; };
        update();
        msg.textContent = '同じ順番で押して！';
        card.append(prog);
        const enable = () => {
          if (!pad.isConnected) return;
          since(inKey); // 押せるようになった時刻を覚える（CPU の速さもこの時計）
          card.append(timeBar(inKey, inputMs(len)));
          btns.forEach((b, k) => {
            b.disabled = false;
            b.onpointerdown = (e) => {
              e.preventDefault();
              if (b.disabled) return;
              keys.push(k);
              flash(k);
              play('pop');
              update();
              const ok = judge(s, keys);
              if (ok === true || ok === false) {
                btns.forEach((x) => { x.disabled = true; });
                o.onMove({ t: 'in', r: s.round, keys: keys.slice() });
              }
            };
          });
          setTimeout(() => {
            if (!pad.isConnected || btns[0].disabled) return;
            btns.forEach((x) => { x.disabled = true; });
            msg.textContent = '時間切れ！';
          }, inputMs(len));
        };
        if (wait) setTimeout(enable, wait); else enable();
      }
    } else {
      const r = me !== null ? s.last?.res[me] : null;
      msg.textContent = ended ? '' : r === 'ok' ? 'せいかい！次は1つ長くなります' : r ? `${r === 'late' ? '時間切れ' : 'まちがい'}…（正しい順番: ${s.seq.slice(0, len).map((k) => COLORS[k]).join('→')}）` : '次は1つ長くなります';
      if (ended) msg.textContent = `正しい順番: ${s.seq.slice(0, len).map((k) => COLORS[k]).join('→')}`;
    }
  },
};
