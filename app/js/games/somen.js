// 流しそうめん。竹のといを流れてくるそうめんを、全員が同時に箸でつまむ早取り。2〜10人・足りない分は CPU（弱め）。
// 2026-11-10 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   - 全員が同じ1本のといを見て、流れてきたものを一番早く押した人が取る（早い者勝ち）。
//   - そうめん1点・さくらんぼ3点・唐辛子は取ると減点。
//   - 速さは各自の画面で、その品が流れ始めてから押すまでの時間（ms）で比べる（通信の遅れで不利にならない。早押しのゲームと同じ考え方）。
// Claude の判断:
//   - 1回の対局は60秒（詳細設定「時間」で 45・60・90秒。鍵は time。おまかせで抽選しない）。品がといの左から右へ流れ切るのは2.6秒。
//   - 流れてくる品と時刻は種から決める（全員同じ）。間は0.65〜1.55秒で、時間がたつほど少し詰まる（最後は7割）。
//     品は そうめん 82%・さくらんぼ 10%・唐辛子 8%。唐辛子は −2点。
//   - 取ったかどうか: 押した人のうち ms の一番小さい人が取る（同じなら席の番号の小さい人）。手が届く順番には関わらないので、全員の端末で同じ。
//     自分の画面では、自分が押した品と、ほかの人が「自分の画面でのその品の時間」より早く押した品を消す（的の早押しと同じ。ゲストが不利にならないように）。
//   - 1つの品に1人1回だけ押せる（2回目は弾く。realtime の決まり）。
//   - CPU は品ごとに、そうめん45%・さくらんぼ60%・唐辛子5% で取りに行き、0.45〜1.4秒で押す。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'grab', i: 品の番号, ms }

import { mulberry32 } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar } from './party.js';

const READY_MS = 3000;
export const FLOW_MS = 2600;
const TIMES = [[60, '60秒'], [45, '45秒'], [90, '90秒']];
export const limitOf = (r) => (TIMES.some(([v]) => v === Number(r?.time)) ? Number(r.time) * 1000 : 60000);
export const KINDS = { somen: { v: 1, label: 'そうめん' }, cherry: { v: 3, label: 'さくらんぼ' }, chili: { v: -2, label: '唐辛子' } };

// 流れてくる品の一覧 [{ at: 流れ始める時刻（ms。play の始めから）, k: 種類, y: といの中の高さのずれ（-1〜1） }]
export function itemsOf(seed, limit) {
  const rnd = mulberry32((seed ^ 0x5f3759df) >>> 0);
  const out = [];
  let t = 700;
  while (t < limit - 600) {
    const r = rnd();
    out.push({ at: Math.round(t), k: r < 0.1 ? 'cherry' : r < 0.18 ? 'chili' : 'somen', y: +(rnd() * 2 - 1).toFixed(2) });
    t += (650 + rnd() * 900) * (1 - (0.3 * t) / limit);
  }
  return out;
}

// 品ごとの取った人（押した人のうち ms が一番小さい人）
export function ownerOf(claims) {
  let best = null;
  for (const [p, ms] of claims) if (!best || ms < best[1] || (ms === best[1] && p < best[0])) best = [p, ms];
  return best;
}
function scoresOf(s) {
  const sc = Array(s.n).fill(0);
  s.claims.forEach((c, i) => { const b = c.length ? ownerOf(c) : null; if (b) sc[b[0]] += KINDS[s.items[i].k].v; });
  return sc;
}

const clone = (s) => ({ ...s, claims: s.claims.slice() });
const cpuPlan = new Map();
const myTaps = new Set(); // この端末で押した品（返ってくる前に消すため）

function itemEl(k) {
  const d = document.createElement('div');
  d.className = 'sm-item ' + k;
  if (k === 'somen') {
    d.innerHTML = '<svg viewBox="0 0 60 30" aria-hidden="true"><path d="M2 15 C10 5,18 25,26 15 S42 5,50 15 S58 22,58 18"/><path d="M4 19 C12 9,20 29,28 19 S44 9,52 19"/><path d="M3 11 C11 1,19 21,27 11 S43 1,51 11 S57 16,58 13"/><path d="M6 23 C14 14,22 31,30 22 S44 14,52 22"/></svg>';
  } else d.textContent = k === 'cherry' ? '🍒' : '🌶️';
  d.setAttribute('aria-label', KINDS[k].label);
  return d;
}

export default {
  id: 'somen',
  name: '流しそうめん',
  icon: '🎋',
  desc: '竹のといを流れるそうめんを早い者勝ちでつまむ。さくらんぼは3点、唐辛子は減点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: '1回の対局の長さ', def: 60, choices: TIMES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: 60, ...rules };
    const items = itemsOf(seed, limitOf(r));
    return { n, seed, rules: r, phase: 'ready', items, claims: items.map(() => []), scores: Array(n).fill(0), step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'play'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores.slice() } : null; },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく流れてきます…' : ''; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'start' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が取った音は鳴らさない（にぎやかすぎるため）
    return b.items[m.i].k === 'chili' ? 'wrong' : 'pop';
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') return { key: 'play', ms: limitOf(s.rules) + FLOW_MS + 600, move: { t: 'end' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'start' && s0.phase === 'ready') return { ...clone(s0), phase: 'play', step: s0.step + 1 };
      if (m.t === 'end' && s0.phase === 'play') return { ...clone(s0), phase: 'end', step: s0.step + 1 };
      return null;
    }
    if (m.t !== 'grab' || s0.phase !== 'play' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= s0.items.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > FLOW_MS + 100) return null;
    if (s0.claims[m.i].some(([p]) => p === m.p)) return null;
    const s = clone(s0);
    s.step += 1;
    s.claims[m.i] = [...s0.claims[m.i], [m.p, Math.round(m.ms)]];
    s.scores = scoresOf(s);
    return s;
  },

  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play') return null;
    const t = since(`somen:${s.seed}`);
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i];
      if (it.at > t) break;
      if (t - it.at > FLOW_MS) continue;
      const key = `${s.seed}:${i}:${p}`;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const want = Math.random() < (it.k === 'somen' ? 0.45 : it.k === 'cherry' ? 0.6 : 0.05);
        plan = { want, rt: 450 + Math.random() * 950 };
        cpuPlan.set(key, plan);
        if (cpuPlan.size > 600) cpuPlan.delete(cpuPlan.keys().next().value);
      }
      if (!plan.want || t - it.at < plan.rt || s.claims[i].some(([q]) => q === p)) continue;
      const own = ownerOf(s.claims[i]);
      if (own && own[1] < plan.rt) continue; // もう取られている
      return { t: 'grab', i, ms: Math.round(plan.rt) };
    }
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    root.innerHTML = '';
    root.className = 'board sm';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    root.append(wrap);
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    wrap.append(scoreChips(o, s.scores, { won, steady: true }));
    const startKey = `somen:${s.seed}`;
    if (s.phase === 'play') wrap.append(timeBar(startKey, limitOf(s.rules)));

    const trough = document.createElement('div');
    trough.className = 'sm-trough';
    trough.innerHTML = '<div class="sm-water"></div><div class="sm-node" style="left:30%"></div><div class="sm-node" style="left:68%"></div>';
    const lane = document.createElement('div');
    lane.className = 'sm-lane';
    trough.append(lane);
    wrap.append(trough);

    const bowl = document.createElement('div');
    bowl.className = 'sm-bowl';
    wrap.append(bowl);
    const mine = me === null ? null : (() => {
      const c = { somen: 0, cherry: 0, chili: 0 };
      s.claims.forEach((cl, i) => { const b = cl.length ? ownerOf(cl) : null; if (b && b[0] === me) c[s.items[i].k] += 1; });
      return c;
    })();
    bowl.innerHTML = mine
      ? `<div class="sm-bowl-in"><span>🍜 ×${mine.somen}</span><span>🍒 ×${mine.cherry}</span><span>🌶️ ×${mine.chili}</span></div><div class="sm-bowl-cap">あなたのおわん</div>`
      : '<div class="sm-bowl-cap">観戦中</div>';

    const note = document.createElement('p');
    note.className = 'cc-log';
    note.textContent = s.phase === 'ready' ? 'まもなく流れてきます。そうめん（1点）とさくらんぼ（3点）を押してつまもう。唐辛子（−2点）に注意！'
      : s.phase === 'play' ? (me === null ? '観戦中' : '流れてくるものを押してつまもう（早い者勝ち）') : '';
    wrap.append(note);
    if (s.phase !== 'play') return;

    // 流れる品を、画面の描き替えに合わせて動かす
    const els = new Map();
    const can = me !== null && o.canMove;
    const gone = (i, age) => myTaps.has(`${s.seed}:${i}`) || s.claims[i].some(([p, ms]) => p === me || ms <= age);
    const loop = () => {
      if (!lane.isConnected && lane.dataset.on) { els.clear(); return; }
      lane.dataset.on = '1';
      const t = since(startKey);
      s.items.forEach((it, i) => {
        const age = t - it.at;
        let el = els.get(i);
        if (age < 0 || age > FLOW_MS || gone(i, age)) {
          if (el && !el.classList.contains('took')) {
            if (age >= 0 && age <= FLOW_MS && myTaps.has(`${s.seed}:${i}`)) { el.classList.add('took'); setTimeout(() => el.remove(), 260); }
            else el.remove();
            if (!el.classList.contains('took')) els.delete(i);
          }
          return;
        }
        if (!el) {
          el = itemEl(it.k);
          el.style.top = `${50 + it.y * 18}%`;
          el.onpointerdown = (e) => {
            e.preventDefault();
            const a = since(startKey) - it.at;
            if (!can || a < 0 || a > FLOW_MS || gone(i, a)) return;
            myTaps.add(`${s.seed}:${i}`);
            if (myTaps.size > 500) myTaps.delete(myTaps.values().next().value);
            o.onMove({ t: 'grab', i, ms: Math.round(a) });
          };
          lane.append(el);
          els.set(i, el);
        }
        el.style.left = `${(age / FLOW_MS) * 112 - 6}%`;
      });
      requestAnimationFrame(loop);
    };
    loop();
  },
};
