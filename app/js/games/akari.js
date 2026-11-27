// 灯りの陣取り（2026-11-27 本人が選んだ、Claude が考えた独自ルール。分かれ目は Claude の推奨を本人が承認）。2〜4人（詳細設定「人数」）。
// 9×9 の盤に、順番に灯りを1つずつ置く。どのマスも「いちばん近い灯り」を置いた人の陣地になり、置くたびに境い目が動く。
// 灯りを全部置き終えたとき、陣地（灯りのマスも入る）が広い人の勝ち。いちばん広い人が並んだら引き分け（3〜4人は成績表で順位の点）。
//
// 本人が承認した分かれ目: 盤は 9×9。灯りは1人 6個（2人）・5個（3人）・4個（4人）。近さはまっすぐの距離（マスの中心どうし）で測り、
//   いちばん近い灯りが2人以上（ちがう人）にあるマスはだれの陣地にもしない（同じ人の灯りどうしが同じ近さなら、その人の陣地）。
// Claude の判断: 置けるのは灯りの無いマスならどこでも（ほかの人の陣地の中にも置ける）。順番は席の順に回る（2人なら後手が最後の1つを置く。
//   もう一回では先手と後手が入れ替わる）。距離は2乗のまま整数で比べる（端末ごとに丸めがずれないように）。
//
// 局面: { n, k: 一辺, per: 1人の灯りの数, lamps: マスごとに灯りを置いた人の席（無ければ null）, order: 置いた順のマス, turn, last }。手 = マスの番号（段*k+列）。
//
// 「隠し灯り」（2026-11-27 の49回目の案。本人が選んだ。詳細設定 hide、最初は なし）: 1人1つだけ、置いた場所をほかの人に見せずに灯りを置ける。全部置き終えたら開く。
// Claude の判断: 隠し灯りの手 = マス + HIDE。いつ使うかは自由。隠し灯りもほかの灯りと同じく陣地を作るが、画面（と状態の欄の広さ）では
//   置いた人にだけ見え、ほかの人・観戦の人には空きマスに見える。ほかの人がそのマスを選ぶと、その灯りが「見つかって」全員に見えるようになり、
//   選んだ人はもう一度選ぶ（灯りは減らない）。自分の隠し灯りのマスには置けない（ふつうの灯りと同じ）。
//   簡易の隠し方（全員の端末が場所を知っている）。CPU はほかの人の隠し灯りを見ないで選ぶ（viewOf）。CPU は自分の残りの灯りが2つのときに隠す。
//   隠すときは「相手の迷いを見せる」を使わない（1回目に押した所が見えてしまうため。noPeek）。
//   ありのときだけ局面に hide: [席ごとの隠し灯りのマス か null]・open: [席ごとの見つかったか] を持つ（なしなら今までと同じ局面）。
//   見つかった直後は found: { c, q: 灯りの持ち主, by: 選んだ人 } を持ち、次に灯りを置いたら消す。

import { CPU_SETTING, TAP_PEEK_SETTING, col } from './util.js';

const SIZE = 9;
const PER = { 2: 6, 3: 5, 4: 4 };
export const HIDE = 100; // 隠し灯りの手 = マス + HIDE（盤は 81 マス）

// マス c の灯りが、席 viewer から見えない（ほかの人の、まだ見つかっていない隠し灯り）か。決着の判定・点はいつも全部の灯りで数える
function hiddenFrom(s, c, viewer) {
  if (!s.hide) return false;
  const q = s.hide.indexOf(c);
  return q >= 0 && !s.open[q] && q !== viewer;
}
// 席 viewer から見た局面（見えない灯りを除く）。viewer が null・undefined（同じ画面の対局）なら全部見える。-1 はだれの隠し灯りも見えない（観戦・状態の欄）
export function viewOf(s, viewer) {
  if (!s.hide || viewer === null || viewer === undefined || !s.order.some((c) => hiddenFrom(s, c, viewer))) return s;
  const lamps = s.lamps.slice();
  for (const c of s.order) if (hiddenFrom(s, c, viewer)) lamps[c] = null;
  return { ...s, lamps, order: s.order.filter((c) => lamps[c] !== null) };
}

const dist2 = (k, a, b) => {
  const dr = Math.floor(a / k) - Math.floor(b / k);
  const dc = (a % k) - (b % k);
  return dr * dr + dc * dc;
};

// マスごとの { best: いちばん近い灯りまでの距離の2乗, who: 陣地の人の席（-1 はだれのものでもない） }
function field(s, lamps = s.order) {
  const N = s.k * s.k;
  const best = new Array(N).fill(Infinity);
  const who = new Array(N).fill(-1);
  for (const c of lamps) {
    const p = s.lamps[c] ?? s.turn;
    for (let x = 0; x < N; x++) {
      const d = dist2(s.k, c, x);
      if (d < best[x]) { best[x] = d; who[x] = p; } else if (d === best[x] && who[x] !== p) who[x] = -1;
    }
  }
  return { best, who };
}

// 陣地の広さ（席ごと）
function countOf(n, who) {
  const sc = new Array(n).fill(0);
  for (const p of who) if (p >= 0) sc[p]++;
  return sc;
}
export const scoresOf = (s) => countOf(s.n, field(s).who);

// 席 p がマス c に灯りを置いたあとの陣地の持ち主（f = 置く前の field）
function whoAfter(s, f, c, p) {
  const N = s.k * s.k;
  const who = f.who.slice();
  for (let x = 0; x < N; x++) {
    const d = dist2(s.k, c, x);
    if (d < f.best[x]) who[x] = p;
    else if (d === f.best[x] && who[x] !== p) who[x] = -1;
  }
  return who;
}
function bestAfter(s, f, c) {
  const best = f.best.slice();
  for (let x = 0; x < best.length; x++) best[x] = Math.min(best[x], dist2(s.k, c, x));
  return best;
}

/* ---------- CPU ---------- */

// 席 p から見た差（自分の広さ − ほかの人でいちばん広い人の広さ）
const margin = (sc, p) => sc[p] - Math.max(...sc.filter((_, q) => q !== p));

// 置いたあとの値打ちは、2人なら差、3〜4人なら自分の広さ（3〜4人で差を見ると、かえって弱くなった）。
// よわい: 5割は空いたマスから適当に置き、ほかは自分の広さだけを見て一番広がる所。
// ふつう: 値打ちの良い方から5か所について、次の人がその人にいちばん良い所へ置き返したあとの値打ちで選ぶ（15% は良い方から5つのどれか）。
// つよい: 同じ読みを良い方から14か所で行う（適当なし）。最後の1つは読まずに一番良い所。
// 120局の実測（強い方の勝ち・負け・引き分け。2026-11-27）: 2人 ふつう-よわい 107・11・2、つよい-ふつう 93・15・12、
//   3人 ふつう-よわい 76・36・8、つよい-よわい 89・25・6、4人 49・61・10、70・40・10。1手の最長 5ms
const LEVEL = { weak: { slip: 0.5, own: true }, normal: { slip: 0.15, top: 5, look: 5 }, strong: { slip: 0, look: 14 } };
function akariCpu(s, rules) {
  const lv = LEVEL[rules?.cpu] ?? LEVEL.weak;
  const p = s.turn;
  const free = s.lamps.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  if (Math.random() < lv.slip && !lv.top) return pick(free);
  const f = field(s);
  const rated = free.map((c) => {
    const sc = countOf(s.n, whoAfter(s, f, c, p));
    return { c, v: lv.own || s.n > 2 ? sc[p] : margin(sc, p) };
  }).sort((a, b) => b.v - a.v);
  if (lv.top && Math.random() < lv.slip) return pick(rated.slice(0, lv.top)).c;
  const left = s.n * s.per - s.order.length; // 自分の分を入れた残りの灯りの数
  if (lv.look && left > 1) {
    const q = (p + 1) % s.n;
    let bestV = -Infinity;
    let top = [];
    for (const { c } of rated.slice(0, lv.look)) {
      const t = { ...s, lamps: s.lamps.slice() };
      t.lamps[c] = p;
      const f2 = { who: whoAfter(s, f, c, p), best: bestAfter(s, f, c) };
      // 次の人（q）は、2人なら自分の差、3〜4人なら自分の広さがいちばん良くなる所に置き返す。そのあとの自分の差（3〜4人は広さ）で比べる
      let qBest = -Infinity;
      let mine = 0;
      for (let x = 0; x < t.lamps.length; x++) {
        if (t.lamps[x] !== null) continue;
        const sc = countOf(s.n, whoAfter(t, f2, x, q));
        const qv = s.n === 2 ? margin(sc, q) : sc[q];
        const v = s.n === 2 ? margin(sc, p) : sc[p];
        if (qv > qBest || (qv === qBest && v < mine)) { qBest = qv; mine = v; }
      }
      if (mine > bestV) { bestV = mine; top = [c]; } else if (mine === bestV) top.push(c);
    }
    return pick(top);
  }
  const topV = rated[0].v;
  return pick(rated.filter((r) => r.v === topV)).c;
}

let ui = { key: null, hide: false }; // 「隠して置く」を押しているか（通信で描き直されても消えないよう外に持つ）

export default {
  id: 'akari',
  name: '灯りの陣取り',
  icon: '🏮',
  desc: '交代で灯りを置き、いちばん近い灯りの人の陣地になる。陣地が広い人の勝ち。2〜4人',
  ready: true,
  keepColor: true, // 続けて遊ぶ間は、その人の色を変えない（util.js の col）
  players: ['赤', '青', '緑', '紫'],
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    { key: 'players', label: '人数', desc: '順番に灯りを置く人数（灯りは 2人 6個・3人 5個・4人 4個ずつ）', def: 2, choices: [[2, '2人'], [3, '3人'], [4, '4人']] },
    { key: 'hide', label: '隠し灯り', desc: '1人1つだけ、置いた場所をほかの人に見せずに灯りを置ける（全部置き終えたら開く）。ほかの人の隠し灯りのマスを選ぶと、その灯りが見つかって表になり、選んだ人はもう一度選ぶ', def: false, choices: [[false, 'なし'], [true, 'あり']] },
    TAP_PEEK_SETTING,
    CPU_SETTING,
  ],
  noPeek(rules) { return rules?.hide === true; }, // 隠し灯りがあるときは「相手の迷いを見せる」を使わない（main.js の peekOn）
  // 2回押して置くの薄い灯り（main.js の ghostOne）を、最後の1つでは出さない（当てた局面は決着で、まだ見えない隠し灯りが開くため）
  noGhost(s) { return !!s.hide && s.order.length + 1 >= s.n * s.per && s.hide.some((c, q) => c !== null && !s.open[q]); },

  cpu(s, p, rules) {
    const c = akariCpu(viewOf(s, s.turn), rules); // ほかの人の隠し灯りは見ないで選ぶ
    const mine = s.order.filter((x) => s.lamps[x] === s.turn).length;
    return s.hide && s.hide[s.turn] === null && s.per - mine === 2 ? c + HIDE : c;
  },

  init({ rules = {} } = {}) {
    const n = [2, 3, 4].includes(rules.players) ? rules.players : 2;
    const s = { n, k: SIZE, per: PER[n], lamps: new Array(SIZE * SIZE).fill(null), order: [], turn: 0, last: null };
    return rules.hide === true ? { ...s, hide: new Array(n).fill(null), open: new Array(n).fill(false) } : s;
  },

  turn(s) { return s.turn; },

  apply(s0, m) {
    if (!Number.isInteger(m)) return null;
    const hide = m >= HIDE;
    const c = hide ? m - HIDE : m;
    if (c < 0 || c >= s0.lamps.length || s0.order.length >= s0.n * s0.per) return null;
    if (hide && (!s0.hide || s0.hide[s0.turn] !== null)) return null;
    if (s0.lamps[c] !== null) {
      // ほかの人の、まだ見つかっていない隠し灯りのマス: その灯りが見つかって表になり、選んだ人はもう一度選ぶ
      if (!hiddenFrom(s0, c, s0.turn)) return null;
      const q = s0.hide.indexOf(c);
      return { ...s0, open: s0.open.map((v, i) => v || i === q), found: { c, q, by: s0.turn } };
    }
    const s = { ...s0, lamps: s0.lamps.slice(), order: [...s0.order, c], last: c };
    delete s.found;
    s.lamps[c] = s0.turn;
    if (hide) s.hide = s0.hide.map((v, i) => (i === s0.turn ? c : v));
    s.turn = (s0.turn + 1) % s0.n;
    return s;
  },

  result(s) {
    if (s.order.length < s.n * s.per) return null;
    const sc = scoresOf(s);
    const top = Math.max(...sc);
    const winners = sc.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
    return { winner: winners.length === 1 ? winners[0] : null, cells: [], scores: sc }; // scores: 成績表の順位で点・表彰台（3〜4人）
  },

  info(s) {
    const over = !!this.result(s);
    const v = over ? s : viewOf(s, -1); // 広さは、だれの隠し灯りも入れずに数える（決着したら全部）
    const sc = scoresOf(v);
    const left = (p) => s.per - s.order.filter((c) => s.lamps[c] === p).length;
    let html = sc.map((x, p) => `<b class="pl p${col(p)}">${this.players[col(p)]} ${x}</b><small class="ak-left">🏮${left(p)}</small>`).join('　');
    if (s.found) html += `<br>${this.players[col(s.found.q)]}の隠し灯りが見つかった`;
    else if (!over && v !== s) html += '<br><small>隠し灯りは数えていない（終わったら開く）</small>';
    return html;
  },

  render(root, s, o) {
    root.innerHTML = '';
    root.className = 'board ak';
    root.style.setProperty('--n', s.k);
    const res = this.result(s);
    const me = Number.isInteger(o.me) ? o.me : null;
    const v = res ? s : viewOf(s, me); // この画面から見える灯り（ほかの人の隠し灯りを除く。決着したら全部）
    const f = field(v);
    const sc = res ? countOf(s.n, f.who) : null;
    const top = res ? Math.max(...sc) : null;
    const key = `${s.order.length}:${me}`;
    if (ui.key !== key) ui = { key, hide: false };
    const canHide = o.canMove && !res && !!s.hide && s.hide[s.turn] === null;
    const hiding = canHide && ui.hide;
    // さっき置いた灯りで持ち主が変わったマス（ふわっと塗り直す）。見えない灯りなら何も変わらない
    const before = o.fresh && s.last !== null && v.order[v.order.length - 1] === s.last ? field(v, v.order.slice(0, -1)).who : null;
    const grid = document.createElement('div');
    grid.className = 'ak-grid' + (hiding ? ' hiding' : '');
    grid.style.setProperty('--pt', `var(--p${col(s.turn)})`); // のせたマスの見せ方に使う、番の人の色
    const cells = [];
    const clearPv = () => { for (const e of cells) e.classList.remove('pv', 'pv-lose'); };
    for (let c = 0; c < s.k * s.k; c++) {
      const e = document.createElement('button');
      e.type = 'button';
      const w = f.who[c];
      e.className = 'ak-cell' + (w >= 0 ? ' own p' + col(w) : v.order.length ? ' tie' : '')
        + (before && before[c] !== w ? ' chg' : '') + (res && w >= 0 && sc[w] === top ? ' win' : '');
      const lp = v.lamps[c];
      if (lp !== null) {
        const l = document.createElement('span');
        const hid = s.hide && s.hide[lp] === c; // 隠し灯り（置いた人の画面と、見つかったあと・決着のあと）
        const shown = hid && (res || s.open[lp]); // 開いた隠し灯り
        l.className = 'ak-lamp p' + col(lp) + (c === s.last ? ' last' : '') + (o.fresh && c === s.last ? ' pop' : '')
          + (hid && !shown ? ' hid' : '') + (o.fresh && shown && (res || s.found?.c === c) ? ' pop open' : '');
        if (c === s.last) l.dataset.last = '';
        e.append(l);
        e.tabIndex = -1;
        e.setAttribute('aria-label', `${this.players[col(lp)]}の${hid ? '隠し' : ''}灯り`);
      } else if (o.canMove) {
        e.classList.add('playable', 'p' + col(s.turn));
        e.setAttribute('aria-label', hiding ? '隠し灯りを置く' : '灯りを置く');
        e.onclick = () => o.onMove(hiding ? c + HIDE : c);
        // PC でマスにのせたら、置いたときに自分の陣地になる所（と、ほかの人から取れる所）を明るく見せる
        e.addEventListener('pointerenter', (ev) => {
          if (ev.pointerType !== 'mouse') return;
          clearPv();
          const after = whoAfter(v, f, c, s.turn);
          after.forEach((v, x) => {
            if (v === s.turn && f.who[x] !== s.turn) cells[x].classList.add('pv');
            else if (v !== f.who[x] && f.who[x] >= 0) cells[x].classList.add('pv-lose'); // 並んでだれのものでもなくなる所
          });
        });
        e.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') clearPv(); });
      } else {
        e.tabIndex = -1;
      }
      cells.push(e);
      grid.append(e);
    }
    root.append(grid);
    // 隠し灯り（詳細設定 hide）: 押すと次に置く灯りが隠し灯りになる。もう一度押すとやめる
    if (canHide) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary ak-hide' + (hiding ? ' on' : '');
      b.textContent = hiding ? '🙈 隠して置く（やめる）' : '🙈 隠して置く（1回だけ）';
      b.setAttribute('aria-pressed', hiding ? 'true' : 'false');
      b.onclick = () => { ui = { ...ui, hide: !ui.hide }; this.render(root, s, o); };
      root.append(b);
    }
  },
};
