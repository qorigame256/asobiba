// 都道府県タッチ。言われた都道府県を日本地図の上で押す。正しい場所に近い人ほど上。2〜10人・足りない分は CPU（弱め）。
// 2026-11-13 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   - 点は近い順に 3・2・1点（その県の中を押したら近さ0。ぴったりストップと同じ点の付け方）。
//   - 地図は Natural Earth（パブリックドメイン）から tools/make-japan-map.mjs で作る（todofuken-data.js）。
// Claude の判断:
//   - 10問。47都道府県から種でくじを引き、同じ県は1回の対局で2回出さない。1問10秒。押せるのは1問に1回だけ（指を離したときに決まる。地図をなぞって動かしたときは押したことにしない）。
//   - 近さは、押した点がその県の中なら0、外なら県の形のふちまでのいちばん近い長さ（地図の座標。四捨五入した整数で比べる）。同じ近さは同じ点。押さなかった人は0点。
//   - 速さは点に関係しない。ほかの人の押した場所は、その問題の結果まで見せない（札に ✔ だけ）。結果では正しい県を光らせ、全員の押した場所を色の点で出す。
//   - 地図に県の名前は出さない（それが問題なので）。地方ごとの色分けもしない（ヒントになるため）。沖縄県と奄美（鹿児島県）は左上の枠に寄せて描く（todofuken-data.js の作り）。
//   - 「あと約◯km」は地図の座標1つを約1.83km として出す目安（枠に寄せた沖縄・奄美との間は本当の距離ではない）。
//   - CPU は 4割はその県の中を、残りはその県から 20〜160（地図の座標。約40〜290km）ずれた所を押す。
// 詳細設定（2026-11-13 の41回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - 出し方（capital）: 都道府県の名前（最初）・県庁所在地。県庁所在地では「札幌市」のように市の名前を出し、その市のある都道府県を押す（近さと点は同じ）。
//     出すのは県と名前が違う17の市だけ（CAPITALS。さいたま市と東京（新宿区）は名前で分かるので出さない）。問題の数がそれより多いときは17問。結果とふりかえりでは県の名前も出す。
//   - 速さのおまけ（fast）: なし（最初）・あり。その県の中（◎）を押した人のうち、いちばん速い人に +1点（同じ ms は全員）。
//     速さは各自の端末で問題が出てから押すまでの ms（手の `ms`。ほかの早押しと同じ。届いた順では比べない）。`ms` の無い手はおまけの対象にしない。
//   - 問題の数（rounds）: 5問・10問（最初）・20問。
//   最初の値のときの問題は前と全く同じ（同じ乱数の使い方。tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員押した / 10秒）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'tap', q: 何問目, x, y, ms }（x, y は地図の座標の整数。ms は問題が出てから押すまで）

import { mulberry32, shuffle } from './util.js';
import { since, leaders, winnersText, scoreChips, SEAT_COLORS } from './party.js';
import { PREFS, BOX, OKI_BOX } from './todofuken-data.js';

const ROUND_CHOICES = [[5, '5問'], [10, '10問'], [20, '20問']];
const ASK_CHOICES = [['pref', '都道府県の名前'], ['city', '県庁所在地（札幌市 → 北海道 など）']];
// 県と名前が違う県庁所在地（都道府県の名前 → [市の名前, よみ]）
export const CAPITALS = {
  北海道: ['札幌市', 'さっぽろし'], 岩手県: ['盛岡市', 'もりおかし'], 宮城県: ['仙台市', 'せんだいし'], 茨城県: ['水戸市', 'みとし'],
  栃木県: ['宇都宮市', 'うつのみやし'], 群馬県: ['前橋市', 'まえばしし'], 神奈川県: ['横浜市', 'よこはまし'], 石川県: ['金沢市', 'かなざわし'],
  山梨県: ['甲府市', 'こうふし'], 愛知県: ['名古屋市', 'なごやし'], 三重県: ['津市', 'つし'], 滋賀県: ['大津市', 'おおつし'],
  兵庫県: ['神戸市', 'こうべし'], 島根県: ['松江市', 'まつえし'], 香川県: ['高松市', 'たかまつし'], 愛媛県: ['松山市', 'まつやまし'], 沖縄県: ['那覇市', 'なはし'],
};
const CITY_PREFS = PREFS.map((p, i) => (CAPITALS[p.n] ? i : -1)).filter((i) => i >= 0);
const LIMIT = 10000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;
const KM = 1.83; // 地図の座標1つのおよその km
const M = 20; // 地図のまわりの余白（押せる範囲）
const VIEW = [BOX[0] - M, BOX[1] - M, BOX[2] - BOX[0] + 2 * M, BOX[3] - BOX[1] + 2 * M];

// 点が輪の中か（偶奇の数え方）
function inRing(r, x, y) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// 点から線分までの長さの2乗
function segD2(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx - x, py = ay + t * dy - y;
  return px * px + py * py;
}
// 押した点 (x, y) から県 i までの近さ（中なら0。整数）
export function distTo(i, x, y) {
  const rings = PREFS[i].r;
  if (rings.some((r) => inRing(r, x, y))) return 0;
  let best = Infinity;
  for (const r of rings) {
    for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) best = Math.min(best, segD2(x, y, r[j], r[j + 1], r[k], r[k + 1]));
  }
  return Math.max(1, Math.round(Math.sqrt(best))); // 外は1以上（丸めて0になると「県の中」と同じ扱いで速さのおまけまで付いた。2026-11-13 Codex の点検）
}
// 近い順の点（1位3点・2位2点・3位1点。同じ近さは同じ順位。押さなかった人は0点）
export function pointsOf(ds) {
  return ds.map((v) => (v === null ? 0 : Math.max(0, 3 - ds.filter((e) => e !== null && e < v).length)));
}
// 速さのおまけをもらう人（県の中を押した人のうち ms のいちばん小さい人。同じ ms は全員）
export function fastestOf(ds, ms) {
  const ok = ds.map((d, p) => (d === 0 && Number.isInteger(ms[p]) ? p : -1)).filter((p) => p >= 0);
  if (!ok.length) return [];
  const best = Math.min(...ok.map((p) => ms[p]));
  return ok.filter((p) => ms[p] === best);
}

// 県の中の1点（CPU が押す所。いちばん大きい輪の外枠の中を細かく探して、ふちからいちばん遠い点）
const inner = new Map();
export function innerPoint(i) {
  if (inner.has(i)) return inner.get(i);
  const r = PREFS[i].r[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); }
  let best = null;
  let bestD = -1;
  const st = Math.max(1, Math.min(x1 - x0, y1 - y0) / 12);
  for (let x = x0; x <= x1; x += st) {
    for (let y = y0; y <= y1; y += st) {
      if (!inRing(r, x, y)) continue;
      let d = Infinity;
      for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) d = Math.min(d, segD2(x, y, r[j], r[j + 1], r[k], r[k + 1]));
      if (d > bestD) { bestD = d; best = [Math.round(x), Math.round(y)]; }
    }
  }
  best ??= [r[0], r[1]];
  inner.set(i, best);
  return best;
}

const qKey = (s, q = s.q) => `todofuken:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), taps: s.taps.slice(), dists: s.dists.slice() });
const cpuPlan = new Map();
let ui = null; // { mount, chips }
const km = (d) => Math.max(1, Math.round((d * KM) / 10) * 10);
const pathOf = (r) => {
  let d = '';
  for (let i = 0; i < r.length; i += 2) d += `${i ? 'L' : 'M'}${r[i]} ${r[i + 1]}`;
  return d + 'Z';
};
// 地図の線（何度も作らないよう覚えておく）
const mapPaths = PREFS.map((p) => p.r.map(pathOf).join(''));

export default {
  id: 'todofuken',
  name: '都道府県タッチ',
  icon: '🗾',
  desc: '言われた都道府県を地図で押す。近いほど上',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  settings: [
    { key: 'capital', label: '出し方', desc: '県庁所在地では「札幌市」のように市の名前が出て、その市のある都道府県を押す（県と名前が違う17の市だけ）', def: 'pref', choices: ASK_CHOICES },
    { key: 'fast', label: '速さのおまけ', desc: 'その県の中（◎）を押した人のうち、いちばん速い人に +1点', def: false },
    { key: 'rounds', label: '問題の数', desc: '1回の対局の問題の数（県庁所在地は17問まで）', def: 10, choices: ROUND_CHOICES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { capital: 'pref', fast: false, rounds: 10, ...rules };
    const rnd = mulberry32(seed);
    const count = ROUND_CHOICES.some(([v]) => v === r.rounds) ? r.rounds : 10;
    const qs = shuffle(r.capital === 'city' ? CITY_PREFS : [...PREFS.keys()], rnd).slice(0, count);
    return { n, seed, rules: r, qs, q: -1, phase: 'ready', taps: Array(n).fill(null), dists: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || s.taps[p] === null); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return 'question';
      if (m.t === 'close' && me !== null && me >= 0 && me < b.n) return b.dists[me] === 0 ? 'correct' : (b.last?.pts[me] ?? 0) > 0 ? 'pop' : 'wrong';
      return null;
    }
    return m.p === me ? 'chip' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}問目 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.taps.every((v) => v !== null)) return { key: 'all' + s.q, ms: 600, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.taps = Array(s.n).fill(null);
        s.dists = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.dists);
        const fast = s.rules?.fast ? fastestOf(s.dists, s.taps.map((t) => t?.[2] ?? null)) : [];
        fast.forEach((p) => { pts[p] += 1; });
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts, fast };
        s.log = [...s0.log, { pref: s.qs[s.q], dists: s.dists.slice(), fast }];
        return s;
      }
      return null;
    }
    if (m.t !== 'tap' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.taps[m.p] !== null) return null;
    if (!Number.isInteger(m.x) || !Number.isInteger(m.y) || m.x < VIEW[0] || m.y < VIEW[1] || m.x > VIEW[0] + VIEW[2] || m.y > VIEW[1] + VIEW[3]) return null;
    if (m.ms !== undefined && (!Number.isInteger(m.ms) || m.ms < 0 || m.ms > LIMIT + GRACE_MS)) return null;
    const s = clone(s0);
    s.step += 1;
    s.taps[m.p] = [m.x, m.y, m.ms ?? null];
    s.dists[m.p] = distTo(s.qs[s.q], m.x, m.y);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.taps[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      let [x, y] = innerPoint(s.qs[s.q]);
      if (Math.random() >= 0.4) {
        const a = Math.random() * 2 * Math.PI;
        const r = 20 + Math.random() * 140;
        x = Math.round(x + r * Math.cos(a));
        y = Math.round(y + r * Math.sin(a));
      }
      x = Math.max(VIEW[0], Math.min(VIEW[0] + VIEW[2], x));
      y = Math.max(VIEW[1], Math.min(VIEW[1] + VIEW[3], y));
      plan = { at: 2000 + Math.random() * 5000, x, y };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'tap', q: s.q, x: plan.x, y: plan.y, ms: Math.round(plan.at) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.taps[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.dists[p] === null) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">${s.dists[p] === 0 ? '◎' : km(s.dists[p]) + 'km'}${s.last.fast?.includes(p) ? '⚡' : ''}${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替える（ほかの人の手が届くたびに作り直すと、描きかけ・押しかけが消えるため）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.taps[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    ui = { mount, chips };
    root.innerHTML = '';
    root.className = 'board tf';
    root.append(chips);
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const head = document.createElement('p');
    head.className = 'tf-head';
    root.append(head);
    if (s.phase === 'ready') {
      const city = s.rules?.capital === 'city';
      head.textContent = `よーい… ${city ? '出た県庁所在地のある都道府県' : '出た都道府県'}を地図で押そう（全${s.qs.length}問・近い順に 3・2・1点${s.rules?.fast ? '・◎ でいちばん速い人に ⚡+1点' : ''}）`;
      return;
    }
    const target = s.qs[s.q];
    const pref = PREFS[target];
    const cap = s.rules?.capital === 'city' ? CAPITALS[pref.n] : null;
    head.innerHTML = `<b></b><small></small>${s.phase === 'open' ? (cap ? 'はどの都道府県？' : 'はどこ？') : cap ? '<span class="tf-cap"></span>' : ''}`;
    head.querySelector('b').textContent = cap ? cap[0] : pref.n;
    head.querySelector('small').textContent = `（${cap ? cap[1] : pref.k}）`;
    if (cap && s.phase !== 'open') head.querySelector('.tf-cap').textContent = ` → ${pref.n}`;
    const key = qKey(s);
    since(key);

    const svgNS = 'http://www.w3.org/2000/svg';
    const map = document.createElementNS(svgNS, 'svg');
    map.setAttribute('viewBox', VIEW.join(' '));
    map.setAttribute('class', 'tf-map');
    map.setAttribute('role', 'img');
    map.setAttribute('aria-label', '日本地図');
    const shown = s.phase === 'shown';
    let html = `<rect class="tf-oki" x="${OKI_BOX[0]}" y="${OKI_BOX[1]}" width="${OKI_BOX[2] - OKI_BOX[0]}" height="${OKI_BOX[3] - OKI_BOX[1]}" rx="6"/>`;
    mapPaths.forEach((d, i) => { html += `<path class="tf-pref${shown && i === target ? ' ans' : ''}" d="${d}"/>`; });
    if (shown) {
      // 全員の押した場所（自分は大きく）
      s.taps.forEach((t, p) => {
        if (!t || p === me) return;
        html += `<circle class="tf-dot" cx="${t[0]}" cy="${t[1]}" r="9" fill="${SEAT_COLORS[p % SEAT_COLORS.length]}"/>`;
      });
    }
    const mine = me !== null ? s.taps[me] : null;
    if (mine) html += `<circle class="tf-dot mine" cx="${mine[0]}" cy="${mine[1]}" r="13"/>`;
    map.innerHTML = html;
    root.append(map);
    const note = document.createElement('p');
    note.className = 'cc-log';
    root.append(note);

    if (shown) {
      const names = document.createElement('div');
      names.className = 'tf-who';
      s.taps.forEach((t, p) => {
        if (!t) return;
        const tag = document.createElement('span');
        tag.style.borderColor = p === me ? '#111' : SEAT_COLORS[p % SEAT_COLORS.length];
        tag.textContent = `${p === me ? 'あなた' : o.names[p]} ${s.dists[p] === 0 ? '◎' : '約' + km(s.dists[p]) + 'km'}${s.last.fast?.includes(p) ? ' ⚡' + (t[2] / 1000).toFixed(2) + '秒' : ''}`;
        names.append(tag);
      });
      root.append(names);
      const quick = s.last.fast?.includes(me) ? '　⚡ いちばん速い！' : '';
      if (me === null) note.textContent = '';
      else if (!mine) note.textContent = '押せませんでした…';
      else note.textContent = s.dists[me] === 0 ? `◎ ぴったり！${s.last.pts[me] ? ` +${s.last.pts[me]}点` : ''}${quick}` : `あと約${km(s.dists[me])}km${s.last.pts[me] ? `（+${s.last.pts[me]}点）` : ''}`;
      return;
    }
    if (mine) { note.textContent = '押した！ ほかの人を待っています'; return; }
    if (me === null) { note.textContent = '観戦中'; return; }
    const left = () => LIMIT - since(key);
    const noteText = () => (left() > 0 ? `地図を押そう（1回だけ）　のこり ${Math.ceil(left() / 1000)}秒` : '時間切れ！');
    note.textContent = noteText();
    let down = null;
    let sent = false;
    map.classList.add('live');
    map.onpointerdown = (e) => { down = [e.clientX, e.clientY]; };
    map.onpointerup = (e) => {
      if (!down || sent || !o.canMove || left() <= 0) return;
      const moved = Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]);
      down = null;
      if (moved > 12) return; // なぞって動かしたときは押したことにしない
      const ctm = map.getScreenCTM();
      if (!ctm) return;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const x = Math.round(pt.x), y = Math.round(pt.y);
      if (x < VIEW[0] || y < VIEW[1] || x > VIEW[0] + VIEW[2] || y > VIEW[1] + VIEW[3]) return;
      sent = true;
      map.classList.remove('live');
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('class', 'tf-dot mine');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', 13);
      map.append(dot);
      o.onMove({ t: 'tap', q: s.q, x, y, ms: Math.min(LIMIT, Math.round(since(key))) });
    };
    const tick = () => {
      if (!map.isConnected || sent) return;
      note.textContent = noteText();
      if (left() > 0) setTimeout(tick, 250);
      else map.classList.remove('live');
    };
    tick();
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const hits = x.dists.filter((v) => v === 0).length;
      const mine = me === null ? '' : x.dists[me] === null ? '―' : x.dists[me] === 0 ? '◎' : `約${km(x.dists[me])}km`;
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span></span><span>${mine}</span><span class="mk-rv-who">◎ ${hits}人</span>`;
      const cap = s.rules?.capital === 'city' ? CAPITALS[PREFS[x.pref].n] : null;
      li.children[1].textContent = cap ? `${cap[0]}（${PREFS[x.pref].n}）` : PREFS[x.pref].n;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
