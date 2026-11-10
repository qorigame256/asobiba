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
//   - 押した手が局面に入っていなければ、0.5秒ごとに同じ ms で送り直す（lostGrabs。ゲストの手はホストの一覧とすれ違って消えることがあり、
//     消えると自分の画面では取れたように消えるのに点が入らなかった。2026-11-10 の Codex の点検。金魚すくいと同じ）。
//   - CPU は品ごとに、そうめん45%・さくらんぼ60%・唐辛子5%・金のそうめん70% で取りに行き、0.45〜1.4秒で押す（金のそうめんは流れ切る0.5秒前まで）。
// 2026-11-10 の38回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「流れの速さ」（鍵は speed）: ゆっくり 3.4秒・ふつう 2.6秒（最初。前と同じ）・急流 1.9秒（といを流れ切るまでの時間）。品の間と数は変えない。
//     難しさなので、おまかせでは抽選しない（main.js の KEEP_KEYS の speed）。
//   - 詳細設定「金のそうめん」（鍵は gold）: あり（最初）・なし。ありでは品の4%が金色に光るそうめん（5点）になり、ほかの品の6割の時間で流れ切る。
//     品を決める乱数の順は前と同じで、金はそうめんの分（0.18〜0.22）から取る（なしのときの品の並びは前と全く同じ）。
//   - 詳細設定「季節」（鍵は season）: 今の季節（最初）・春・夏・秋・冬。3点の品と減点の品の見た目だけが変わる（点・動きは同じ）:
//     春 花見だんご・はち／夏 さくらんぼ・唐辛子／秋 栗・毒きのこ／冬 みかん・氷。といの水にその季節の飾り（花びら・葉・もみじ・雪）が浮かぶ。
//     「今の季節」は各端末の日付で決める（seasonOf。正月は冬）。見た目だけなので apply は季節を見ない（端末で食い違っても勝ち負けは割れない）。
//     好みなので、おまかせでは抽選しない（KEEP_KEYS の season）。中の名前は季節に関わらず cherry（3点）・chili（減点）のまま。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → start → play → end
// 手: { p: -1, t: 'start' | 'end' } / { p, t: 'grab', i: 品の番号, ms }

import { mulberry32 } from './util.js';
import { scoreChips, since, leaders, winnersText, timeBar } from './party.js';
import { seasonOf } from '../season.js';

const READY_MS = 3000;
const TIMES = [[60, '60秒'], [45, '45秒'], [90, '90秒']];
export const limitOf = (r) => (TIMES.some(([v]) => v === Number(r?.time)) ? Number(r.time) * 1000 : 60000);
const SPEEDS = [['normal', 'ふつう'], ['slow', 'ゆっくり'], ['fast', '急流']];
const FLOWS = { slow: 3400, normal: 2600, fast: 1900 };
export const flowOf = (r) => FLOWS[r?.speed] ?? FLOWS.normal;
const GOLDS = [['on', 'あり'], ['off', 'なし']];
const SEASONS = [['now', '今の季節'], ['spring', '春'], ['summer', '夏'], ['autumn', '秋'], ['winter', '冬']];
export const KINDS = { somen: { v: 1, label: 'そうめん' }, cherry: { v: 3, label: 'さくらんぼ' }, chili: { v: -2, label: '唐辛子' }, gold: { v: 5, label: '金のそうめん' } };
// 季節ごとの 3点の品・減点の品・水に浮かぶ飾り
export const SEASON_ITEMS = {
  spring: { cherry: ['🍡', '花見だんご'], chili: ['🐝', 'はち'], deco: '🌸' },
  summer: { cherry: ['🍒', 'さくらんぼ'], chili: ['🌶️', '唐辛子'], deco: '🍃' },
  autumn: { cherry: ['🌰', '栗'], chili: ['🍄', '毒きのこ'], deco: '🍁' },
  winter: { cherry: ['🍊', 'みかん'], chili: ['🧊', '氷'], deco: '❄️' },
};
export const seasonIn = (r, d) => {
  if (SEASON_ITEMS[r?.season]) return r.season;
  const s = seasonOf(d);
  return s === 'newyear' ? 'winter' : s;
};
const labelOf = (k, sea) => (k === 'cherry' || k === 'chili' ? SEASON_ITEMS[sea][k][1] : KINDS[k].label);

// 流れてくる品の一覧 [{ at: 流れ始める時刻（ms。play の始めから）, k: 種類, y: といの中の高さのずれ（-1〜1）, d: 流れ切るまでの時間 }]
export function itemsOf(seed, limit, { flow = FLOWS.normal, gold = false } = {}) {
  const rnd = mulberry32((seed ^ 0x5f3759df) >>> 0);
  const out = [];
  let t = 700;
  while (t < limit - 600) {
    const r = rnd();
    const k = r < 0.1 ? 'cherry' : r < 0.18 ? 'chili' : gold && r < 0.22 ? 'gold' : 'somen';
    out.push({ at: Math.round(t), k, y: +(rnd() * 2 - 1).toFixed(2), d: k === 'gold' ? Math.round(flow * 0.6) : flow });
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
// この端末で押した品（`${seed}:${i}` → { seed, i, ms }）。返ってくる前に消すためと、手が消えたときに同じ ms で送り直すため
const myTaps = new Map();
const RESEND_MS = 500;
// 自分が押したのに局面に入っていない品の手（ゲストの手はホストの一覧とすれ違って消えることがある。金魚すくい・2色爆弾と同じわけ）。
// 同じ手が2回届いても apply が「1つの品に1人1回」で弾くので、二重には数えない
export function lostGrabs(s, me, taps = [...myTaps.values()]) {
  if (s.phase !== 'play' || me === null) return [];
  return taps.filter((x) => x.seed === s.seed && x.i < s.claims.length && !s.claims[x.i].some(([p]) => p === me)).map(({ i, ms }) => ({ t: 'grab', i, ms }));
}

function itemEl(k, sea) {
  const d = document.createElement('div');
  d.className = 'sm-item ' + k;
  if (k === 'somen' || k === 'gold') {
    d.innerHTML = '<svg viewBox="0 0 60 30" aria-hidden="true"><path d="M2 15 C10 5,18 25,26 15 S42 5,50 15 S58 22,58 18"/><path d="M4 19 C12 9,20 29,28 19 S44 9,52 19"/><path d="M3 11 C11 1,19 21,27 11 S43 1,51 11 S57 16,58 13"/><path d="M6 23 C14 14,22 31,30 22 S44 14,52 22"/></svg>';
  } else d.textContent = SEASON_ITEMS[sea][k][0];
  d.setAttribute('aria-label', labelOf(k, sea));
  return d;
}

export default {
  id: 'somen',
  name: '流しそうめん',
  icon: '🎋',
  desc: '竹のといを流れるそうめんを早い者勝ちでつまむ。季節のごちそうは3点、はずれは減点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'time', label: '時間', desc: '1回の対局の長さ', def: 60, choices: TIMES },
    { key: 'speed', label: '流れの速さ', desc: 'そうめんがといを流れ切るまでの速さ', def: 'normal', choices: SPEEDS },
    { key: 'gold', label: '金のそうめん', desc: 'ときどき金色に光るそうめん（5点）が速く流れてくる', def: 'on', choices: GOLDS },
    { key: 'season', label: '季節', desc: '流れてくるごちそう・はずれと、水に浮かぶ飾りが季節で変わる（点は同じ）', def: 'now', choices: SEASONS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { time: 60, speed: 'normal', gold: 'on', season: 'now', ...rules };
    const items = itemsOf(seed, limitOf(r), { flow: flowOf(r), gold: r.gold !== 'off' });
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
    return b.items[m.i].k === 'chili' ? 'wrong' : b.items[m.i].k === 'gold' ? 'correct' : 'pop';
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'start' } };
    if (s.phase === 'play') return { key: 'play', ms: limitOf(s.rules) + flowOf(s.rules) + 600, move: { t: 'end' } };
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
    if (!Number.isInteger(m.i) || m.i < 0 || m.i >= s0.items.length || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > s0.items[m.i].d + 100) return null;
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
      if (t - it.at > it.d) continue;
      const key = `${s.seed}:${i}:${p}`;
      let plan = cpuPlan.get(key);
      if (!plan) {
        const want = Math.random() < ({ somen: 0.45, cherry: 0.6, chili: 0.05, gold: 0.7 }[it.k]);
        plan = { want, rt: 450 + Math.random() * Math.min(950, it.d - 950) };
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
    const sea = seasonIn(s.rules);
    const SI = SEASON_ITEMS[sea];
    trough.className = 'sm-trough sm-' + sea;
    trough.innerHTML = '<div class="sm-water"></div>'
      + `<div class="sm-deco" aria-hidden="true">${[0, 1, 2, 3].map((k) => `<span style="--k:${k}">${SI.deco}</span>`).join('')}</div>`
      + '<div class="sm-node" style="left:30%"></div><div class="sm-node" style="left:68%"></div>';
    const lane = document.createElement('div');
    lane.className = 'sm-lane';
    trough.append(lane);
    wrap.append(trough);

    const bowl = document.createElement('div');
    bowl.className = 'sm-bowl';
    wrap.append(bowl);
    const mine = me === null ? null : (() => {
      const c = { somen: 0, cherry: 0, chili: 0, gold: 0 };
      s.claims.forEach((cl, i) => { const b = cl.length ? ownerOf(cl) : null; if (b && b[0] === me) c[s.items[i].k] += 1; });
      return c;
    })();
    bowl.innerHTML = mine
      ? `<div class="sm-bowl-in"><span>🍜 ×${mine.somen}</span>${s.rules.gold !== 'off' ? `<span class="sm-gold-n">✨ ×${mine.gold}</span>` : ''}<span>${SI.cherry[0]} ×${mine.cherry}</span><span>${SI.chili[0]} ×${mine.chili}</span></div><div class="sm-bowl-cap">あなたのおわん</div>`
      : '<div class="sm-bowl-cap">観戦中</div>';

    const note = document.createElement('p');
    note.className = 'cc-log';
    note.textContent = s.phase === 'ready' ? `まもなく流れてきます。そうめん（1点）と${SI.cherry[1]}（3点）${s.rules.gold !== 'off' ? '、金のそうめん（5点）' : ''}を押してつまもう。${SI.chili[1]}（−2点）に注意！`
      : s.phase === 'play' ? (me === null ? '観戦中' : '流れてくるものを押してつまもう（早い者勝ち）') : '';
    wrap.append(note);
    if (s.phase !== 'play') return;

    // 流れる品を、画面の描き替えに合わせて動かす
    const els = new Map();
    const can = me !== null && o.canMove;
    const gone = (i, age) => myTaps.has(`${s.seed}:${i}`) || s.claims[i].some(([p, ms]) => p === me || ms <= age);
    let resendAt = performance.now() + RESEND_MS;
    const loop = () => {
      if (!lane.isConnected && lane.dataset.on) { els.clear(); return; }
      lane.dataset.on = '1';
      const t = since(startKey);
      if (can && performance.now() >= resendAt) { // 消えた手の送り直し（0.5秒ごと）
        resendAt = performance.now() + RESEND_MS;
        for (const mv of lostGrabs(s, me)) o.onMove(mv);
        if (!lane.isConnected) return; // 送り直しで描き直された（新しい描き替えが続きを受け持つ）
      }
      s.items.forEach((it, i) => {
        const age = t - it.at;
        let el = els.get(i);
        if (age < 0 || age > it.d || gone(i, age)) {
          if (el && !el.classList.contains('took')) {
            if (age >= 0 && age <= it.d && myTaps.has(`${s.seed}:${i}`)) { el.classList.add('took'); setTimeout(() => el.remove(), 260); }
            else el.remove();
            if (!el.classList.contains('took')) els.delete(i);
          }
          return;
        }
        if (!el) {
          el = itemEl(it.k, sea);
          el.style.top = `${50 + it.y * 18}%`;
          el.onpointerdown = (e) => {
            e.preventDefault();
            const a = since(startKey) - it.at;
            if (!can || a < 0 || a > it.d || gone(i, a)) return;
            const ms = Math.round(a);
            myTaps.set(`${s.seed}:${i}`, { seed: s.seed, i, ms });
            if (myTaps.size > 500) myTaps.delete(myTaps.keys().next().value);
            o.onMove({ t: 'grab', i, ms });
          };
          lane.append(el);
          els.set(i, el);
        }
        el.style.left = `${(age / it.d) * 112 - 6}%`;
      });
      requestAnimationFrame(loop);
    };
    loop();
  },
};
