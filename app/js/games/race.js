// 方眼紙レース。毎回、速さと向きを前の手から縦横1マス分ずつしか変えられない（急に止まれず、急に曲がれない）。先にゴールした人の勝ち。2〜4人・足りない分は CPU。
// 2026-11-11 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認。board-games.md の「方眼紙レース」）:
//   - 全員が同時に次の位置を選び、一斉に動く。
//   - コースは3つの決まったコースと「おまかせ」から選ぶ（ミニゴルフと同じ形）。
//   - コースからはみ出したら、はみ出す手前の位置に戻り、速さ0で1回休み。
//   - ほかの車がいるマスには止まれない（選べない）。
// Claude の判断:
//   - 動き方: 次の位置 ＝ 今の位置 ＋ 今の速さ ＋ 足す分（横・縦それぞれ −1・0・+1 の9通り）。動いたあとの速さは「次の位置 − 今の位置」。
//     動いた道すじ（線分）を細かく区切って調べ、途中で1マスでもコースの外へ出たらはみ出し。ゴールのマスに道すじが入ったらゴール。
//   - はみ出して戻る「手前の位置」にほかの車が止まっていたら、道すじをさらに戻って空いているマスに置く（どこも空いていなければ動く前の位置）。
//     はみ出さなかった車を先に置き、はみ出した車どうしは席の順に置く（Codex の点検の指摘。前は2台が同じマスに重なった）。
//   - 同じ手のうちに2台以上がゴールしたら、道すじのより手前でゴールに入った車が上（まったく同じなら同着）。
//     だれもゴールしていない人は、ゴールまでの残りのマス数が少ない順に並べる（成績表の順位で点のため）。
//   - ほかの車がいるマスは、動く前に車がいるマス（そのマスの車がこの手で動いても選べない）。同じ手で2台が同じマスを選んだら、ぶつかって2台とも元の位置で速さ0（休みなし）。
//   - 1手20秒（2026-11-11 の39回目の案で、詳細設定「1手の時間」（time）10・20（最初）・30秒。20秒以外のときだけ局面に limit を持つ）。時間内に選ばなかった人は「そのまま」（足す分なし）。そのままで止まれないマスなら、選べる中から遠くへ行かない手。
//   - 80手でだれもゴールしなければ、ゴールに近い人の勝ち。
//   - コースは手で作った3つ（U字・S字・ジグザグ）。おまかせは種で3つから選ぶ。おまかせで抽選してよい（遊び方なので）。
//   - CPU は3手先まで読み、はみ出さずにゴールへ近づく手を選ぶ。5回に1回は、はみ出さない手から適当に選んで弱める。ほかの車はよけない（止まれないマスだけ避ける）。
//     前の手でぶつかった CPU は、半分は適当な手にする（CPU どうしが同じマスを選び続けて動けなくなったのをブラウザで見たため）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → open … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'go', k: 何手目（0 から）, a: [横, 縦]（それぞれ −1・0・1） }
//   k が今と同じで、その人がまだ選んでいないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { since, timeBar, SEAT_COLORS } from './party.js';
import { mulberry32, shuffle } from './util.js';

const LIMIT = 20000;
const limitOf = (s) => s.limit ?? LIMIT;
const READY_MS = 3000;
const GRACE_MS = 500;
export const MAX_TURNS = 80;

// コース: 横 W・縦 H。track = コースの四角の集まり、start = 並ぶ位置、goal = ゴールの四角（どれも [左, 上, 右, 下] のマスの番号。両端を含む）
const COURSES = {
  u: { name: 'U字', W: 24, H: 16, track: [[1, 1, 5, 14], [1, 1, 22, 5], [18, 1, 22, 14]], goal: [18, 14, 22, 14], start: [[1, 14], [3, 14], [5, 14], [2, 12]] },
  s: { name: 'S字', W: 24, H: 16, track: [[1, 11, 17, 14], [14, 6, 17, 14], [5, 6, 17, 9], [5, 1, 8, 9], [5, 1, 22, 4]], goal: [22, 1, 22, 4], start: [[1, 11], [1, 13], [2, 12], [2, 14]] },
  z: { name: 'ジグザグ', W: 24, H: 16, track: [[1, 1, 22, 3], [20, 1, 22, 9], [5, 7, 22, 9], [5, 7, 7, 14], [5, 12, 22, 14]], goal: [22, 12, 22, 14], start: [[1, 1], [1, 3], [2, 2], [3, 1]] },
};
export const COURSE_IDS = ['u', 's', 'z'];
const inRect = ([l, t, r, b], x, y) => x >= l && x <= r && y >= t && y <= b;

const built = new Map();
// コースの形を作る（マスごとにコースか・ゴールか、ゴールまでの残りマス数）
export function courseOf(id) {
  if (built.has(id)) return built.get(id);
  const c = COURSES[id];
  const on = (x, y) => x >= 0 && y >= 0 && x < c.W && y < c.H && c.track.some((r) => inRect(r, x, y));
  const goal = (x, y) => inRect(c.goal, x, y);
  // ゴールまでの残り（ななめも1つと数える）
  const d = Array(c.W * c.H).fill(Infinity);
  const q = [];
  for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) if (goal(x, y)) { d[y * c.W + x] = 0; q.push([x, y]); }
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (on(nx, ny) && d[ny * c.W + nx] === Infinity) { d[ny * c.W + nx] = d[y * c.W + x] + 1; q.push([nx, ny]); }
    }
  }
  const out = { ...c, id, on, goal, left: (x, y) => d[y * c.W + x] ?? Infinity };
  built.set(id, out);
  return out;
}

// 道すじを調べる: { x, y, crash, fin（ゴールに入った道すじの割合 0〜1。入らなければ null） }
export function trace(c, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4;
  let lx = x0, ly = y0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    if (!c.on(x, y)) return { x: lx, y: ly, crash: true, fin: null };
    if (c.goal(x, y)) return { x, y, crash: false, fin: t };
    lx = x; ly = y;
  }
  return { x: x1, y: y1, crash: false, fin: null };
}

// はみ出す手前までに通ったコースの上のマス（はみ出す手前 → 動く前の位置 の順。先頭は trace のはみ出しの位置と同じ）
function pathBack(c, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4;
  const cells = [[x0, y0]];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
    if (!c.on(x, y)) break;
    const [lx, ly] = cells[cells.length - 1];
    if (x !== lx || y !== ly) cells.push([x, y]);
  }
  return cells.reverse();
}

const ACCELS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const okA = (a) => Array.isArray(a) && a.length === 2 && a.every((v) => v === -1 || v === 0 || v === 1);
const dest = (car, a) => [car.x + car.vx + a[0], car.y + car.vy + a[1]];
const racing = (car) => !car.fin;
// p が選べる足す分（ほかの車が今いるマスには止まれない）
export function choices(s, p) {
  const car = s.cars[p];
  return ACCELS.filter((a) => {
    const [x, y] = dest(car, a);
    return !s.cars.some((o, q) => q !== p && racing(o) && o.x === x && o.y === y);
  });
}
const sameA = (a, b) => a[0] === b[0] && a[1] === b[1];

const clone = (s) => ({ ...s, cars: s.cars.map((c) => ({ ...c })), picks: s.picks.slice(), trails: s.trails.map((t) => t.slice()) });

// 順位（1 から）: ゴールした人は手と割合の早い順、ほかはゴールまでの残りが少ない順
export function placeOf(s) {
  const c = courseOf(s.course);
  const key = (car) => (car.fin ? [0, car.fin.k, car.fin.t] : [1, c.left(car.x, car.y), 0]);
  const ks = s.cars.map(key);
  const less = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return ks.map((k) => 1 + ks.filter((o) => less(o, k) < 0).length);
}

// CPU: 3手先まで読む
function plan(c, car, depth) {
  let best = Infinity;
  for (const a of ACCELS) {
    const nx = car.x + car.vx + a[0], ny = car.y + car.vy + a[1];
    const tr = trace(c, car.x, car.y, nx, ny);
    let v;
    if (tr.crash) v = 1000 + c.left(tr.x, tr.y);
    else if (tr.fin !== null) v = -1000 + tr.fin;
    else if (depth <= 1) v = c.left(nx, ny) - Math.max(Math.abs(nx - car.x), Math.abs(ny - car.y)) * 0.3;
    else v = plan(c, { x: nx, y: ny, vx: nx - car.x, vy: ny - car.y }, depth - 1) + 0.01;
    if (v < best) best = v;
  }
  return best;
}

export default {
  id: 'race',
  name: '方眼紙レース',
  icon: '🏎️',
  desc: '速さと向きは1マスずつしか変えられない。曲がり角の手前で止まれるかが勝負のレース',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 4,
  settings: [
    { key: 'time', label: '1手の時間', desc: '次の位置を選ぶ時間。時間内に選ばなかった人は、速さを変えずにそのまま進む', def: '20', choices: [['10', '10秒'], ['20', '20秒'], ['30', '30秒']] },
    { key: 'course', label: 'コース', desc: 'U字・S字・ジグザグ（細い道が続く）から選ぶ。おまかせは毎回くじで選ぶ', def: 'u', choices: [['u', 'U字'], ['s', 'S字'], ['z', 'ジグザグ'], ['random', 'おまかせ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const course = COURSE_IDS.includes(rules.course) ? rules.course : rules.course === 'random' ? COURSE_IDS[mulberry32(seed ^ 0x7ace)() * 3 | 0] : 'u';
    const c = courseOf(course);
    const st = shuffle(c.start.slice(), mulberry32(seed));
    const cars = [...Array(n)].map((_, p) => ({ x: st[p][0], y: st[p][1], vx: 0, vy: 0, rest: 0, fin: null, crash: false, bump: false }));
    const s = { n, seed, course, k: -1, phase: 'ready', cars, picks: Array(n).fill(null), trails: cars.map((car) => [[car.x, car.y]]), step: 0 };
    if (['10', '30'].includes(String(rules.time))) s.limit = Number(rules.time) * 1000;
    return s;
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.picks[p] === null && racing(s.cars[p]) && !s.cars[p].rest && choices(s, p).length > 0; },
  result(s) {
    if (s.phase !== 'end') return null;
    const place = placeOf(s);
    return { winners: place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0), place, finished: s.cars.some((c) => c.fin) };
  },
  resultText(res, me, pn) {
    const w = res.winners;
    const head = res.finished ? '' : `${MAX_TURNS}手で決着せず、ゴールにいちばん近い`;
    if (w.length === 1) return w[0] === me ? `${head}あなたの勝ち！🏁` : `${head}${pn(w[0])}の勝ち！`;
    return `${w.map(pn).join('・')}が同着！${w.includes(me) ? '🏁' : ''}`;
  },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.k + 1}手目`;
  },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t !== 'close') return null;
      if (b.cars.some((c, p) => c.crash && !a.cars[p].crash)) return 'wall';
      return 'place';
    }
    return m.p === me ? 'chip' : null;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.cars.every((_, p) => !this.canAct(s, p))) return { key: 'all' + s.k, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.k, ms: limitOf(s) + 1000, move: { t: 'close' } };
    }
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && s0.phase === 'ready') {
        const s = clone(s0);
        s.step += 1;
        s.k = 0;
        s.phase = 'open';
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') return this.resolve(s0);
      return null;
    }
    if (m.t !== 'go' || s0.phase !== 'open' || m.k !== s0.k || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p) || !okA(m.a)) return null;
    if (!choices(s0, m.p).some((a) => sameA(a, m.a))) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.a.slice();
    return s;
  },

  // 一斉に動かす
  resolve(s0) {
    const s = clone(s0);
    s.step += 1;
    const c = courseOf(s.course);
    const moves = s.cars.map((car, p) => {
      car.crash = false;
      car.bump = false;
      if (!racing(car)) return null;
      if (car.rest) return null;
      let a = s.picks[p];
      if (!a) {
        const ch = choices(s0, p);
        if (!ch.length) return null;
        a = ch.find((x) => sameA(x, [0, 0])) ?? ch.slice().sort((x, y) => { const [ax, ay] = dest(car, x), [bx, by] = dest(car, y); return Math.hypot(ax - car.x, ay - car.y) - Math.hypot(bx - car.x, by - car.y); })[0];
      }
      return dest(car, a);
    });
    // 同じマスを選んだ車はぶつかる
    const bumped = moves.map((d, p) => d !== null && moves.some((e, q) => q !== p && e && e[0] === d[0] && e[1] === d[1]));
    const crashes = [];
    s.cars.forEach((car, p) => {
      if (!racing(car)) return;
      if (car.rest) { car.rest -= 1; return; }
      const d = moves[p];
      if (!d) return;
      if (bumped[p]) { car.vx = 0; car.vy = 0; car.bump = true; return; }
      const tr = trace(c, car.x, car.y, d[0], d[1]);
      if (tr.crash) { crashes.push([p, d]); return; }
      Object.assign(car, { vx: d[0] - car.x, vy: d[1] - car.y, x: tr.fin !== null ? tr.x : d[0], y: tr.fin !== null ? tr.y : d[1] });
      if (tr.fin !== null) car.fin = { k: s.k, t: tr.fin };
      s.trails[p].push([car.x, car.y]);
    });
    // はみ出した車は、ほかの車が止まっていない手前のマスへ戻す（ファイルの先頭のコメント）
    for (const [p, d] of crashes) {
      const car = s.cars[p];
      const taken = ([x, y]) => s.cars.some((o, q) => q !== p && racing(o) && o.x === x && o.y === y);
      const [x, y] = pathBack(c, car.x, car.y, d[0], d[1]).find((xy) => !taken(xy)) ?? [car.x, car.y];
      Object.assign(car, { x, y, vx: 0, vy: 0, rest: 1, crash: true });
      s.trails[p].push([x, y]);
    }
    s.picks = Array(s.n).fill(null);
    if (s.cars.some((car) => car.fin) || s.k + 1 >= MAX_TURNS) { s.phase = 'end'; return s; }
    s.k += 1;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 700 : 500; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const c = courseOf(s.course);
    const car = s.cars[p];
    const ch = choices(s, p);
    const scored = ch.map((a) => {
      const [x, y] = dest(car, a);
      const tr = trace(c, car.x, car.y, x, y);
      if (tr.crash) return [1000 + c.left(tr.x, tr.y), a];
      if (tr.fin !== null) return [-1000 + tr.fin, a];
      return [plan(c, { x, y, vx: x - car.x, vy: y - car.y }, 2), a];
    }).sort((x, y) => x[0] - y[0]);
    const safe = scored.filter(([v]) => v < 500);
    // 前の手でぶつかった CPU は、同じ手でまたぶつからないように半分は別の手にする（CPU どうしが同じマスを選び続けて動けなくなるため）
    if (safe.length && Math.random() < (car.bump ? 0.6 : 0.2)) return { t: 'go', k: s.k, a: safe[Math.floor(Math.random() * safe.length)][1] };
    return { t: 'go', k: s.k, a: scored[0][1] };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : -1;
    const c = courseOf(s.course);
    root.innerHTML = '';
    root.className = 'board rc';
    const wrap = document.createElement('div');
    wrap.className = 'rc-wrap';
    root.append(wrap);
    // 上の札: 名前と速さ
    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    const place = s.phase === 'end' ? placeOf(s) : null;
    s.cars.forEach((car, p) => {
      const ch = document.createElement('div');
      ch.className = 'cc-opp' + (p === o.me ? ' me' : '') + (place?.[p] === 1 ? ' won' : '');
      const nm = document.createElement('div');
      nm.className = 'cc-opp-name';
      nm.textContent = p === o.me && !o.watching ? 'あなた' : o.names[p];
      const ex = document.createElement('div');
      ex.className = 'pt-extra';
      const dot = document.createElement('span');
      dot.className = 'on-dot';
      dot.style.background = SEAT_COLORS[p];
      const sp = Math.max(Math.abs(car.vx), Math.abs(car.vy));
      const st = car.fin ? ' 🏁 ゴール' : car.rest ? ' 💥 休み' : car.bump ? ' 💢 ぶつかった' : s.phase === 'open' && s.picks[p] ? ' ✔ 決めた' : ` 速さ ${sp}`;
      ex.append(dot, document.createTextNode(st));
      ch.append(nm, ex);
      if (o.away?.[p]) ch.insertAdjacentHTML('beforeend', '<span class="cc-tag away">応答なし</span>');
      else if (o.sub?.[p]) ch.insertAdjacentHTML('beforeend', '<span class="cc-tag away">CPU が代わりに</span>');
      chips.append(ch);
    });
    wrap.append(chips);
    const key = `race:${s.seed}:${s.k}`;
    if (s.phase === 'open') { since(key); wrap.append(timeBar(key, limitOf(s))); }
    // 盤（SVG）
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${c.W} ${c.H}`);
    svg.setAttribute('class', 'rc-svg');
    const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.append(e); return e; };
    el('rect', { x: 0, y: 0, width: c.W, height: c.H, class: 'rc-grass' });
    for (let y = 0; y < c.H; y++) for (let x = 0; x < c.W; x++) {
      if (!c.on(x, y)) continue;
      el('rect', { x: x - 0.0, y, width: 1.02, height: 1.02, class: c.goal(x, y) ? ((x + y) % 2 ? 'rc-goal a' : 'rc-goal b') : 'rc-road' });
    }
    // 方眼の線（点の位置はマスの真ん中）
    const grid = el('g', { class: 'rc-grid' });
    for (let x = 0; x <= c.W; x++) el('line', { x1: x, y1: 0, x2: x, y2: c.H }, grid);
    for (let y = 0; y <= c.H; y++) el('line', { x1: 0, y1: y, x2: c.W, y2: y }, grid);
    // 走った跡
    s.trails.forEach((t, p) => {
      if (t.length < 2) return;
      el('polyline', { points: t.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(' '), class: 'rc-trail', stroke: SEAT_COLORS[p] });
      for (const [x, y] of t.slice(0, -1)) el('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.12, fill: SEAT_COLORS[p], class: 'rc-step' });
    });
    // 自分の選べる所
    const mine = me >= 0 && o.canMove && this.canAct(s, me);
    const selKey = key + ':' + me;
    if (mine) {
      const car = s.cars[me];
      const sel = this._sel?.get(selKey);
      // 今の速さのまま進んだときの向き
      el('line', { x1: car.x + 0.5, y1: car.y + 0.5, x2: car.x + car.vx + 0.5, y2: car.y + car.vy + 0.5, class: 'rc-aim' });
      for (const a of ACCELS) {
        const [x, y] = dest(car, a);
        const ok = choices(s, me).some((b) => sameA(a, b));
        if (!ok) continue;
        const tr = trace(c, car.x, car.y, x, y);
        const isSel = sel && sameA(sel, a);
        const dot = el('circle', { cx: x + 0.5, cy: y + 0.5, r: isSel ? 0.42 : 0.3, class: 'rc-opt' + (tr.crash ? ' crash' : '') + (tr.fin !== null ? ' fin' : '') + (isSel ? ' sel' : '') });
        dot.addEventListener('click', () => this.pick(root, s, o, selKey, a));
        if (isSel) el('line', { x1: car.x + 0.5, y1: car.y + 0.5, x2: x + 0.5, y2: y + 0.5, class: 'rc-path' + (tr.crash ? ' crash' : '') });
      }
    }
    // 車
    s.cars.forEach((car, p) => {
      if (car.fin && s.phase !== 'end') return;
      const g = el('circle', { cx: car.x + 0.5, cy: car.y + 0.5, r: 0.4, fill: SEAT_COLORS[p], class: 'rc-car' + (p === me ? ' me' : '') + (car.crash ? ' crash' : '') });
      const t = s.trails[p];
      if (o.fresh && t.length >= 2 && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        const [px, py] = t[t.length - 2];
        for (const [attr, from, to] of [['cx', px + 0.5, car.x + 0.5], ['cy', py + 0.5, car.y + 0.5]]) {
          if (from === to) continue;
          el('animate', { attributeName: attr, from, to, dur: '0.45s', fill: 'freeze' }, g);
        }
      }
      if (car.crash) el('text', { x: car.x + 0.5, y: car.y + 0.2, class: 'rc-boom' }).textContent = '💥';
    });
    const board = document.createElement('div');
    board.className = 'rc-board';
    board.append(svg);
    wrap.append(board);
    // 下の段: 3×3 のボタンと決めるボタン
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (mine) {
      const car = s.cars[me];
      const sel = this._sel?.get(selKey);
      const pad = document.createElement('div');
      pad.className = 'rc-pad';
      const arrows = ['↖', '↑', '↗', '←', '・', '→', '↙', '↓', '↘'];
      const ch = choices(s, me);
      ACCELS.forEach((a, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rc-key' + (sel && sameA(sel, a) ? ' sel' : '');
        const [x, y] = dest(car, a);
        const ok = ch.some((z) => sameA(z, a));
        const tr = ok ? trace(c, car.x, car.y, x, y) : null;
        if (tr?.crash) b.classList.add('crash');
        b.textContent = arrows[i];
        b.title = i === 4 ? '速さを変えない' : '';
        b.disabled = !ok;
        b.onclick = () => this.pick(root, s, o, selKey, a);
        pad.append(b);
      });
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary rc-go';
      const [sx, sy] = sel ? dest(car, sel) : [0, 0];
      const selTr = sel ? trace(c, car.x, car.y, sx, sy) : null;
      go.disabled = !sel;
      go.textContent = !sel ? '進む先を選んでね' : selTr.crash ? 'はみ出すけど進む' : selTr.fin !== null ? 'ゴールへ！' : 'ここへ進む';
      go.onclick = () => {
        if (!sel || go.dataset.sent) return;
        go.dataset.sent = '1';
        this._sel.delete(selKey);
        o.onMove({ t: 'go', k: s.k, a: sel });
      };
      const row = document.createElement('div');
      row.className = 'rc-ctl';
      row.append(pad, go);
      wrap.append(row);
      note.textContent = '矢印で、今の速さに足す向きを選ぶ（・は速さを変えない）。赤い点ははみ出す所';
    } else if (s.phase === 'ready') note.textContent = 'よーい…　速さと向きは1マスずつしか変えられない。先にゴールした人の勝ち';
    else if (s.phase === 'end') note.textContent = '';
    else if (me < 0) note.textContent = '観戦中';
    else if (s.cars[me].rest) note.textContent = '💥 はみ出したので、この手は休み';
    else note.textContent = 'ほかの人が選ぶのを待っています…';
    wrap.append(note);
  },

  pick(root, s, o, selKey, a) {
    if (!this._sel) this._sel = new Map();
    const cur = this._sel.get(selKey);
    if (cur && sameA(cur, a)) return; // もう一度押しても決めない（ボタンで決める）
    this._sel.set(selKey, a);
    if (this._sel.size > 50) this._sel.delete(this._sel.keys().next().value);
    this.render(root, s, { ...o, fresh: false }); // 選び直しで車の動きを出し直さない
  },
};
