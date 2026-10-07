// 記憶リレー。2〜10人が同時に遊ぶ。4色のボタンが順番に光り、全員がその順番を覚えて押す。1回ごとに1つずつ長くなる（3つから）。
// 1回間違えたら脱落（詳細設定で「3回まで」も選べる。2026-10-06 本人の決定）。最後まで残った人の勝ち。
// Claude の判断: 時間内に押し終えなかったら間違いと同じ。残っていた全員が同じ回で脱落したら、その人たちが同点で1位。
//   順番は seed から決めた30個（最長30個まで。そこまで残った人は全員1位）。点は「覚えられた一番長い数」。
//   押した順番そのものを手として送り、正しいかは全員の端末で同じように確かめる。間違えたらその時点で送る。
// 詳細設定「逆から押す」（2026-10-07 の13回目）: なし（最初。今と同じ）・いつも・1回おき（2回目・4回目…だけ）。
//   逆の回は、光った順番の逆（最後に光ったものから）が正解。光り方は同じで、正解の並べ方だけ変える（`want`）。
//   逆の回は押す時間を2秒足す（REV_EXTRA_MS）。画面に「🔁 逆から！」を出す。CPU は逆の回で少し間違えやすい。
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
const SHOWN_MS = 2600;
const GRACE_MS = 1500;
const REV_EXTRA_MS = 2000; // 逆の回に足す押す時間（頭の中で並べ替える分）
const COLORS = ['赤', '青', '黄', '緑'];

const lenOf = (s) => FIRST + s.round;
const showMs = (len) => LEAD_MS + len * STEP_MS;
const inputMs = (len, rev = false) => 4000 + len * 800 + (rev ? REV_EXTRA_MS : 0);
// 今の回が逆から押す回か（いつも: 毎回。1回おき: 2回目・4回目…＝ round が奇数）
const revOf = (s) => s.rules.reverse === 'all' || (s.rules.reverse === 'mix' && s.round % 2 === 1);
// 今の回の正解の押し順
const want = (s) => {
  const keys = s.seq.slice(0, lenOf(s));
  return revOf(s) ? keys.reverse() : keys;
};
const keyOf = (s, part) => `kioku:${s.seed}:${s.round}:${part}`;
const clone = (s) => ({ ...s, lives: s.lives.slice(), done: s.done.slice(), best: s.best.slice(), outAt: s.outAt.slice() });
const aliveOf = (s) => s.lives.map((v, p) => (v > 0 ? p : -1)).filter((p) => p >= 0);

// 押した順番が正しいか。正しくて途中までなら undefined（まだ送れない）
function judge(s, keys) {
  const len = lenOf(s);
  if (!Array.isArray(keys) || !keys.length || keys.length > len || !keys.every((k) => Number.isInteger(k) && k >= 0 && k < 4)) return null;
  const goal = want(s);
  const miss = keys.findIndex((k, i) => k !== goal[i]);
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
    { key: 'lives', label: '間違えられる回数', desc: '何回間違えたら脱落か', def: 1, choices: [[1, '1回で脱落'], [3, '3回まで']] },
    { key: 'reverse', label: '逆から押す', desc: '光った順番を、最後から逆に押す', def: 'off', choices: [['off', 'なし'], ['all', 'いつも'], ['mix', '1回おき']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const lives = rules.lives === 3 ? 3 : 1;
    const rnd = mulberry32(seed);
    const seq = Array.from({ length: MAX }, () => Math.floor(rnd() * 4));
    // なしのときは局面の形も前と同じにする（reverse を持たない）
    const r = { lives };
    if (rules.reverse === 'all' || rules.reverse === 'mix') r.reverse = rules.reverse;
    return {
      n, seed, rules: r, seq, round: -1, phase: 'ready', lives: Array(n).fill(lives), done: Array(n).fill(null),
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
    if (s.phase === 'show') return `${s.round + 1}回目（${lenOf(s)}個）: 光る順番を覚えて！${revOf(s) ? '（🔁 逆から押す回）' : ''}`;
    if (s.phase === 'input') return `${s.round + 1}回目（${lenOf(s)}個）: ${revOf(s) ? '🔁 逆の順番で押して！' : '同じ順番で押して！'}`;
    return `${s.round + 1}回目の結果`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'show') return { key: 'show' + s.round, ms: showMs(lenOf(s)), move: { t: 'open' } };
    if (s.phase === 'input') {
      if (aliveOf(s).every((p) => s.done[p] !== null)) return { key: 'all' + s.round, ms: 500, move: { t: 'close' } };
      return { key: 'in' + s.round, ms: inputMs(lenOf(s), revOf(s)) + GRACE_MS, move: { t: 'close' } };
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
  // 逆の回は1つ長いのと同じだけ間違えやすく（3個で10%、5個で24%、7個で40%）、押し始めも0.8秒遅い
  cpuDelay(s) { return s.phase === 'input' ? 150 : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const len = lenOf(s);
    const rev = revOf(s);
    const key = keyOf(s, 'in') + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const miss = Math.random() < Math.min(0.9, Math.max(rev ? 0.1 : 0.03, (len - (rev ? 2 : 3)) * 0.08));
      const keys = want(s);
      if (miss) {
        const at = Math.floor(Math.random() * len);
        keys.length = at + 1;
        keys[at] = (keys[at] + 1 + Math.floor(Math.random() * 3)) % 4;
      }
      plan = { at: 1000 + keys.length * 450 + (rev ? 800 : 0), keys };
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
      const how = s.rules.reverse === 'all' ? '光る順番を覚えて、逆から押してください' : s.rules.reverse === 'mix' ? '光る順番を覚えてください（2回目・4回目…は逆から押します）' : '光る順番を覚えてください';
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${how}</div>`;
      return;
    }
    const len = lenOf(s);
    const head = document.createElement('div');
    head.className = 'kj-num';
    head.textContent = `${s.round + 1}回目（${len}個）`;
    const rev = revOf(s);
    // 逆から押す回の印（見せている間も押す間もはっきり出す。見た目は style.css に入れず、ここで付ける）
    const revTag = document.createElement('div');
    if (rev && s.phase !== 'shown' && !ended) {
      revTag.className = 'km-rev';
      revTag.textContent = '🔁 逆から！';
      revTag.style.cssText = 'display:inline-block;margin-top:6px;padding:4px 14px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:1.1rem;';
    }
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
    card.append(head);
    if (revTag.className) card.append(revTag);
    card.append(pad, msg);
    const flash = (k, ms = 220) => { btns[k].classList.add('lit'); setTimeout(() => btns[k].classList.remove('lit'), ms); };

    // 光る順番を見せる（自分の画面に出てからの時間で。入力の番になっていても、見せ終わるまでは押せない）
    const showKey = keyOf(s, 'show');
    if (s.phase === 'show' || s.phase === 'input') {
      since(showKey);
      const total = showMs(len);
      const tick = () => {
        if (!pad.isConnected) return;
        const t = since(showKey) - LEAD_MS;
        const i = Math.floor(t / STEP_MS);
        btns.forEach((b, k) => b.classList.toggle('lit', t >= 0 && i < len && t - i * STEP_MS < ON_MS && s.seq[i] === k));
        if (since(showKey) < total) requestAnimationFrame(tick);
        else btns.forEach((b) => b.classList.remove('lit'));
      };
      tick();
    }

    if (s.phase === 'show') {
      msg.textContent = rev ? '光る順番を覚えて！押すときは最後に光ったものから' : '光る順番を覚えて！';
    } else if (s.phase === 'input') {
      if (me === null) msg.textContent = '観戦中';
      else if (s.lives[me] <= 0) msg.textContent = '脱落しました。ほかの人を見守りましょう';
      else if (mine !== null) msg.textContent = mine ? 'せいかい！ほかの人を待っています' : 'まちがい…';
      else {
        const inKey = keyOf(s, 'in');
        const wait = Math.max(0, showMs(len) - since(showKey));
        const prog = document.createElement('div');
        prog.className = 'km-prog';
        const update = () => { prog.textContent = `${keys.length} / ${len}`; };
        update();
        msg.textContent = rev ? '最後に光ったものから、逆の順番で押して！' : '同じ順番で押して！';
        card.append(prog);
        const enable = () => {
          if (!pad.isConnected) return;
          since(inKey); // 押せるようになった時刻を覚える（CPU の速さもこの時計）
          card.append(timeBar(inKey, inputMs(len, rev)));
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
          }, inputMs(len, rev));
        };
        if (wait) setTimeout(enable, wait); else enable();
      }
    } else {
      const r = me !== null ? s.last?.res[me] : null;
      const right = `${rev ? '正しい押し順（逆から）' : '正しい順番'}: ${want(s).map((k) => COLORS[k]).join('→')}`;
      // 1回おきでは、次の回が逆かどうかも先に知らせる
      const next = s.rules.reverse === 'mix' ? (rev ? '（次は前から）' : '（次は🔁 逆から！）') : '';
      msg.textContent = ended ? '' : r === 'ok' ? `せいかい！次は1つ長くなります${next}` : r ? `${r === 'late' ? '時間切れ' : 'まちがい'}…（${right}）` : `次は1つ長くなります${next}`;
      if (ended) msg.textContent = right;
    }
  },
};
