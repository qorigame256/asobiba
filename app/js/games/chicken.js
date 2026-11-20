// チキンレース。崖へ走る車のブレーキを1回だけ押し、崖のふちに近く止めた人が勝ち。落ちたら0点。2〜10人・足りない分は CPU（弱め）。
// 2026-11-19 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 全員が自分の車線で同時に走り、ほかの人の車も見える。ブレーキは1回押すだけで、押してから少しすべって止まる。
//   - 車の速さは毎回ばらばら（速い回ほどよくすべるので、同じ所で押すと覚えるだけでは勝てない）。
//   - 点は崖に近く止めた順に 3・2・1点、落ちたら0点。5回（詳細設定で 3・10回）。
// Claude の判断:
//   - 崖までは100m。崖に着くまでの時間を回ごとに 1.8〜4.2秒から種で決める（全員同じ）。速さは画面に「時速 ◯km」で出す。
//   - ブレーキを押したあとは同じ強さで減速する（すべる長さは速さの2乗に比例。いちばん遅い回で約6m、いちばん速い回で約31m）。
//   - 回の始めに1.2秒止まって「よーい」を出してから走り出す。ブレーキの時刻は走り出してから測る（各自の端末で測って送る。通信の遅れで不利にならない）。
//     止まる位置は時刻から計算する（全員の端末で同じ）。ブレーキを押さないまま崖に着いた車は落ちる。
//   - 崖までの残りが同じ人どうしは同じ順位で、同じ点（ほとんど起きない。残りは 0.1m 単位で比べる）。
//   - CPU は崖の手前0〜8mを狙い、押す時刻が±360msまでぶれる（4回に1回ほど落ちる。落ちなかった回の崖までの残りは平均6mほど）。
//     2026-11-20 本人の決定: 前の「1〜10m・±160ms」は約6%しか落ちず説明と違ったので、4回に1回に合わせた（`cpuBrakeAt`。割合は tools/test-logic.mjs が見ている）。
// 2026-11-19 の45回目の案（本人が選んだ。分かれ目は Claude の判断。action-games.md の「チキンレース」）:
//   - 詳細設定「落ちたらマイナス」（minus）: 落ちた回は −2点（FALL_PTS。なしは今までどおり0点）。合計がマイナスになってもよい。
//     落ちなかった人の 3・2・1点はそのまま。CPU の狙い方は変えない（弱めのまま。4回に1回ほど落ちる）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員押した / 崖に着いて止まるまで）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'brake', q: 何回目, ms: 走り出してからブレーキを押すまで }

import { mulberry32 } from './util.js';
import { since, leaders, winnersText, scoreChips, SEAT_COLORS } from './party.js';
import { play } from '../sound.js';

const ROUND_CHOICES = [[3, '3回'], [5, '5回'], [10, '10回']];
const roundsOf = (r) => (ROUND_CHOICES.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 5);
export const D = 100; // 崖までの距離（m）
export const ACC = 0.00005; // ブレーキの減速（m / ms²）
export const GO = 1200; // 回の始めに止まっている時間
const XMAX = 112; // 画面に描く幅（m）
const READY_MS = 3000;
const SHOWN_MS = 4000;
const PTS = [3, 2, 1];
export const FALL_PTS = -2; // 落ちたらマイナス（minus）のときの、落ちた回の点
const r1 = (v) => Math.round(v * 10) / 10;
// 車線の上の位置（m）→ 画面の left。左の 48px は出発の場所（車の前の端を合わせるので、0m の車がはみ出さないように）
const laneX = (m) => `calc(48px + (100% - 48px) * ${(m / XMAX).toFixed(4)})`;

// 全部の回の「崖に着くまでの時間」（ms の整数）
export function makeRounds(seed, n) {
  const rnd = mulberry32((seed * 173 + 41) >>> 0);
  return Array.from({ length: n }, () => ({ T: 1800 + Math.floor(rnd() * 2401) }));
}
export const vOf = (x) => D / x.T;
export const slideOf = (x) => (vOf(x) ** 2) / (2 * ACC);
// ブレーキの時刻から止まる位置: { pos, fell }
export function finalOf(x, tb) {
  if (tb === null || tb === undefined || tb >= x.T) return { pos: null, fell: true };
  const raw = vOf(x) * tb + slideOf(x);
  // 落ちたかは丸める前の位置で決める（丸めてから比べると、崖を 0.05m 未満越えた車が生き残る。画面の車は越えて見える。2026-11-19 Codex の点検）
  return { pos: r1(raw), fell: raw > D };
}
// 走り出してから t ms のときの位置（tb = ブレーキの時刻 | null）
export function posAt(x, tb, t) {
  const v = vOf(x);
  if (t <= 0) return 0;
  if (tb === null || tb === undefined || t < tb || tb >= x.T) return v * t;
  const dt = Math.min(t - tb, v / ACC);
  return v * tb + v * dt - (ACC * dt * dt) / 2;
}
// 1回ぶんの点。res[p] = { pos, fell }。fall = 落ちた人の点（ふつうは0、落ちたらマイナスでは FALL_PTS）
export function racePoints(res, fall = 0) {
  const left = res.map((r) => (r.fell ? null : r1(D - r.pos)));
  return left.map((d) => {
    if (d === null) return fall;
    const rank = left.filter((e) => e !== null && e < d).length;
    return PTS[rank] ?? 0;
  });
}
// CPU がブレーキを押す時刻（rnd = 0〜1 の乱数を返す関数）
export function cpuBrakeAt(x, rnd = Math.random) {
  const aim = rnd() * 8;
  const noise = (rnd() + rnd() - 1) * 360;
  return Math.max(300, Math.round((D - slideOf(x) - aim) / vOf(x) + noise));
}
const kmh = (x) => Math.round((D / x.T) * 3600); // m/ms → km/h

const qKey = (s, q = s.q) => `chicken:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), brakes: s.brakes.slice() });
const cpuPlan = new Map();
let ui = null; // { mount, chips }

// 車の絵（右向き）
const carSvg = (color) => `<svg viewBox="0 0 48 24" class="ck-car-svg" aria-hidden="true"><path d="M4 16 L8 9 Q10 6 15 6 L30 6 Q34 6 37 10 L42 12 Q46 13 46 17 L46 19 L4 19 Z" fill="${color}"/>`
  + '<path d="M14 8 L22 8 L22 12 L11 12 Z M24 8 L30 8 Q33 8 35 12 L24 12 Z" fill="#dff1ff"/><circle cx="13" cy="19" r="4" fill="#222"/><circle cx="37" cy="19" r="4" fill="#222"/></svg>';

export default {
  id: 'chicken',
  name: 'チキンレース',
  icon: '🚗',
  desc: '崖へ走る車にブレーキ。いちばん崖のふちに近く止めた人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で走る回数', def: 5, choices: ROUND_CHOICES },
    { key: 'minus', label: '落ちたらマイナス', desc: `崖から落ちたら ${FALL_PTS}点（なしは0点）。攻めるか守るかの勝負になる`, def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, ...rules };
    return { n, seed, rules: r, rs: makeRounds(seed, roundsOf(r)), q: -1, phase: 'ready', brakes: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || s.brakes[p] === null); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return b.phase === 'end' ? null : 'question';
      if (m.t === 'close' && me !== null && me >= 0 && me < b.n) {
        const pt = b.last?.pts[me] ?? 0;
        return pt >= 3 ? 'correct' : pt > 0 ? 'pop' : 'wrong';
      }
      return null;
    }
    return null; // 自分のブレーキの音は押したときに鳴らしている
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}回目 / ${s.rs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      const x = s.rs[s.q];
      const stopMs = Math.ceil(vOf(x) / ACC); // ブレーキから止まるまで
      if (s.brakes.every((v) => v !== null)) return { key: 'all' + s.q, ms: stopMs + 900, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: GO + x.T + stopMs + 900, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.rs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.brakes = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const x = s.rs[s.q];
        const res = s.brakes.map((tb) => finalOf(x, tb));
        const pts = racePoints(res, s.rules.minus === true ? FALL_PTS : 0);
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts, res };
        s.log = [...s0.log, { res, pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'brake' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.brakes[m.p] !== null) return null;
    if (!Number.isInteger(m.ms) || m.ms < 0 || m.ms > s0.rs[s0.q].T + 3000) return null;
    const s = clone(s0);
    s.step += 1;
    s.brakes[m.p] = m.ms;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 80 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.brakes[p] !== null) return null;
    const x = s.rs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      plan = { tb: cpuBrakeAt(x) };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) - GO >= plan.tb ? { t: 'brake', q: s.q, ms: plan.tb } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.brakes[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const r = s.last.res[p];
      if (r.fell) return `<span class="pt-ng">落ちた${s.last.pts[p] < 0 ? ' ' + s.last.pts[p] : ''}</span>`;
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">あと ${r1(D - r.pos)}m${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替え、車線は描き直さない（ほかの人のブレーキで車の絵を作り直すと、動きがちらつくため）。
    // ほかの人のブレーキは、車線の動きが s を毎回見直して拾う（ui.s）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.brakes[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.s = s;
      return;
    }
    ui = { mount, chips, s };
    root.innerHTML = '';
    root.className = 'board ck';
    root.append(chips);
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    if (s.phase === 'ready') {
      const head = document.createElement('p');
      head.className = 'cp-head';
      head.textContent = `よーい… 崖のふちのぎりぎりで止めよう。落ちたら${s.rules.minus === true ? FALL_PTS : 0}点（全${s.rs.length}回）`;
      root.append(head);
      return;
    }
    const x = s.rs[s.q];
    const key = qKey(s);
    since(key);
    const head = document.createElement('p');
    head.className = 'cp-head ck-head';
    head.textContent = `🚗 時速 ${kmh(x)}km`;
    root.append(head);

    // 車線（自分の車線を先頭に）
    const road = document.createElement('div');
    road.className = 'ck-road';
    road.style.setProperty('--cliff', laneX(D));
    const order = [...Array(s.n).keys()];
    if (me !== null) { order.splice(order.indexOf(me), 1); order.unshift(me); }
    const lanes = order.map((p) => {
      const lane = document.createElement('div');
      lane.className = 'ck-lane' + (p === me ? ' me' : '');
      const name = document.createElement('span');
      name.className = 'ck-name';
      name.textContent = p === me ? 'あなた' : o.names[p];
      const car = document.createElement('div');
      car.className = 'ck-car';
      car.innerHTML = carSvg(SEAT_COLORS[p % SEAT_COLORS.length]);
      const tag = document.createElement('span');
      tag.className = 'ck-tag';
      lane.append(name, car, tag);
      road.append(lane);
      return { p, car, tag };
    });
    road.insertAdjacentHTML('beforeend', '<div class="ck-edge" aria-hidden="true"></div>');
    root.append(road);
    const note = document.createElement('p');
    note.className = 'cc-log';
    root.append(note);

    const shown = s.phase === 'shown';
    let myTb = me !== null ? s.brakes[me] : null;
    // 車を置く。t = 走り出してからの時刻
    const place = (t) => {
      const cur = ui?.s && ui.mount === mount ? ui.s : s;
      for (const l of lanes) {
        const tb = l.p === me && myTb !== null ? myTb : cur.brakes[l.p];
        const pos = shown ? (s.last.res[l.p].fell ? posAt(x, tb, x.T + 2000) : s.last.res[l.p].pos) : posAt(x, tb, t);
        const over = Math.max(0, pos - D);
        const at = Math.min(pos, D + 3);
        l.car.style.left = laneX(at);
        l.car.style.transform = over > 0 ? `translate(-100%, ${Math.min(60, over * 3)}px) rotate(${Math.min(80, over * 6)}deg)` : 'translate(-100%, 0)';
        l.car.style.opacity = over > 0 ? String(Math.max(0, 1 - over / 18)) : '1';
        l.car.classList.toggle('braked', tb !== null && tb !== undefined && t >= tb);
        if (shown) {
          const r = s.last.res[l.p];
          l.tag.textContent = r.fell ? '💥 落ちた' : `あと ${r1(D - r.pos)}m`;
          l.tag.classList.toggle('best', !r.fell && s.last.pts[l.p] === 3);
        }
      }
    };

    if (shown) {
      place(0);
      const r = me !== null ? s.last.res[me] : null;
      note.textContent = me === null ? '' : r.fell ? `💥 落ちてしまった…${s.last.pts[me] < 0 ? ` ${s.last.pts[me]}点` : ''}` :`あと ${r1(D - r.pos)}m で止まった${s.last.pts[me] ? `！ +${s.last.pts[me]}点` : ''}`;
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ck-brake';
    btn.textContent = 'ブレーキ！';
    const canPress = () => me !== null && o.canMove && myTb === null;
    btn.disabled = !canPress();
    const press = (e) => {
      e?.preventDefault?.();
      if (!canPress()) return;
      const t = Math.round(since(key) - GO);
      if (t < 0 || t >= x.T) return;
      myTb = t;
      btn.disabled = true;
      play('chip');
      o.onMove({ t: 'brake', q: s.q, ms: t });
    };
    btn.onpointerdown = press;
    btn.onclick = (e) => { if (e.detail === 0) press(e); };
    if (me !== null) root.append(btn);
    let sentAt = 0;
    const loop = () => {
      if (!road.isConnected) return;
      const t = since(key) - GO;
      // 押したブレーキが局面に入っていなければ、0.5秒ごとに同じ時刻で送り直す（手の一覧とすれ違って消えたときのため。流しそうめんと同じわけ。同じ手が2回届いても2回目は弾かれる）
      if (myTb !== null && ui?.mount === mount && ui.s.phase === 'open' && ui.s.brakes[me] === null && performance.now() - sentAt > 500) {
        if (sentAt) o.onMove({ t: 'brake', q: s.q, ms: myTb });
        sentAt = performance.now();
      }
      place(Math.max(0, t));
      if (me === null) note.textContent = '観戦中';
      else if (t < 0) note.textContent = 'よーい…';
      else if (myTb !== null) note.textContent = 'ブレーキ！ どこで止まるかな';
      else if (t >= x.T) { note.textContent = '💥 落ちた！'; btn.disabled = true; }
      else note.textContent = '崖のぎりぎりで止めよう（PC はスペースキー）';
      requestAnimationFrame(loop);
    };
    loop();
    // 画面が隠れて requestAnimationFrame が止まっても、崖に着いたらボタンを止める
    setTimeout(() => { if (road.isConnected && myTb === null) { btn.disabled = true; place(x.T); } }, Math.max(0, GO + x.T - since(key) + 30));
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const r = me === null ? null : x.res[me];
      const mine = r === null ? '' : r.fell ? `💥 落ちた${x.pts[me] < 0 ? ` ${x.pts[me]}` : ''}` :`あと ${r1(D - r.pos)}m${x.pts[me] ? ` +${x.pts[me]}` : ''}`;
      const best = x.res.filter((e) => !e.fell).map((e) => r1(D - e.pos));
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>時速 ${kmh(s.rs[q])}km</span><span>${mine}</span><span class="mk-rv-who">${best.length ? `いちばん あと ${Math.min(...best)}m` : '全員落ちた'}</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// PC のスペースキー・Enter でブレーキ（対局の画面にチキンレースのブレーキが出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter') || e.target?.closest?.('input, textarea, select, button')) return;
    const b = document.querySelector('.board.ck .ck-brake');
    if (!b || b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
