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

// はね返った灯り（render の ak-hit）を、状態の欄のその人の残りの灯りの数（info の data-left）へ飛ばす。見つからなければその場で消す
function bounceBack(hit, p) {
  if (!hit.isConnected) return;
  const to = document.querySelector(`.ak-left[data-left="${p}"]`);
  const a = hit.getBoundingClientRect();
  const b = to?.getBoundingClientRect();
  if (!b?.width || !a.width) { hit.remove(); return; }
  const fly = hit.cloneNode(true);
  fly.classList.remove('ak-hit');
  Object.assign(fly.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: '0', zIndex: '60', pointerEvents: 'none' });
  document.body.append(fly);
  hit.remove();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = fly.animate([
    { transform: 'none', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(1.1)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0.2 },
  ], { duration: 620, easing: 'ease-in-out' });
  anim.onfinish = () => { fly.remove(); to.classList.remove('ak-got'); void to.offsetWidth; to.classList.add('ak-got'); };
  anim.oncancel = () => fly.remove();
}

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
    // data-roll: 置いて広さが変わったら数字が回り「+4」「−1」が浮かぶ（main.js の rollNums）。data-left: はね返った灯りが飛んでいく先（render）
    let html = sc.map((x, p) => `<b class="pl p${col(p)}">${this.players[col(p)]} <span data-roll="ak${p}" data-v="${x}">${x}</span></b><small class="ak-left" data-left="${p}">🏮${left(p)}</small>`).join('　');
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
    const quiet = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 光が広がって陣地が移る（2026-11-27 の UI・UX の14回目）: さっき置いた灯り（src）から近い順に、持ち主が変わったマスを波のように塗り替える。
    // 見えない灯りなら何も変わらない。隠し灯りが見つかった手では、見つかった灯りから（その灯りが今まで見えていなかった人の画面だけ）。
    // 決着の手では塗り替えず、下の数え上げにする（2つの動きを同じマスに重ねないため。Claude の判断）
    let src = null;
    let before = null;
    if (o.fresh && !res) {
      if (s.found) {
        if (me !== null && me !== s.found.q && v.lamps[s.found.c] !== null) { src = s.found.c; before = field(v, v.order.filter((c) => c !== src)).who; }
      } else if (s.last !== null && v.order[v.order.length - 1] === s.last) { src = s.last; before = field(v, v.order.slice(0, -1)).who; }
    }
    const fromBg = (p) => (p >= 0 ? `color-mix(in srgb, var(--p${col(p)}) 42%, #262d45)` : v.order.length > 1 ? '#33395a' : '#262d45');
    // 終わったら陣地を数え上げる（同じ14回目）: 決着の手が届いたとき、1人ずつ自分の陣地が1マスずつ灯り、盤の下の数が0から数え上がる。
    // 判子と勝ち負けの音は数え終わるまで待たせる（grid の data-end-hold。main.js の render が見る）
    const counting = !!res && !!o.fresh && !quiet;
    const cntAt = new Array(s.k * s.k).fill(null); // マスが灯る時刻（ms）
    let cntEnd = 0;
    if (counting) {
      const total = sc.reduce((a, b) => a + b, 0);
      const step = Math.min(60, 1500 / Math.max(1, total));
      let t = 500; // 開いた隠し灯りの「ポン」を見てから
      for (let p = 0; p < s.n; p++) {
        for (let c = 0; c < f.who.length; c++) if (f.who[c] === p) { cntAt[c] = t; t += step; }
        t += 260;
      }
      cntEnd = t;
    }
    const grid = document.createElement('div');
    grid.className = 'ak-grid' + (hiding ? ' hiding' : '');
    if (counting) grid.dataset.endHold = String(Math.round(cntEnd + 200));
    grid.style.setProperty('--pt', `var(--p${col(s.turn)})`); // のせたマスの見せ方に使う、番の人の色
    const cells = [];
    const clearPv = () => { for (const e of cells) e.classList.remove('pv', 'pv-lose'); };
    for (let c = 0; c < s.k * s.k; c++) {
      const e = document.createElement('button');
      e.type = 'button';
      const w = f.who[c];
      e.className = 'ak-cell' + (w >= 0 ? ' own p' + col(w) : v.order.length ? ' tie' : '') + (res && w >= 0 && sc[w] === top ? ' win' : '');
      if (before && before[c] !== w) {
        e.classList.add('wave');
        e.style.setProperty('--from', fromBg(before[c]));
        e.style.setProperty('--wd', Math.round(Math.sqrt(dist2(s.k, src, c)) * 90) + 'ms');
      }
      if (counting) {
        e.classList.add(cntAt[c] === null ? 'cnt-wait' : 'cnt');
        e.style.setProperty('--cd', Math.round(cntAt[c] ?? cntEnd) + 'ms');
      }
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
    // 決着のあとの盤の下の数（数え上げの間は0から増える）
    if (res) {
      const row = document.createElement('div');
      row.className = 'ak-count';
      const nums = sc.map((x, p) => {
        const b = document.createElement('b');
        b.className = 'pl p' + col(p);
        b.textContent = this.players[col(p)] + ' ';
        const n = document.createElement('span');
        n.textContent = counting ? '0' : String(x);
        b.append(n);
        row.append(b);
        return n;
      });
      root.append(row);
      if (counting) {
        cntAt.forEach((t, c) => {
          if (t === null) return;
          const p = f.who[c];
          setTimeout(() => { if (nums[p].isConnected) nums[p].textContent = String(Number(nums[p].textContent) + 1); }, t);
        });
      }
    }
    // 見つけた灯りがはね返る（同じ14回目）: ほかの人の隠し灯りのマスを選んだ人の灯りが、落ちてきて当たり、その人の残りの灯りの数（状態の欄）へはね返る
    if (o.fresh && s.found && !res && !quiet) {
      const hit = document.createElement('span');
      hit.className = 'ak-lamp ak-hit p' + col(s.found.by);
      hit.setAttribute('aria-hidden', 'true');
      cells[s.found.c].append(hit);
      setTimeout(() => bounceBack(hit, s.found.by), 420); // 測るのは描き直しが済んでから（CLAUDE.md の「描き直しの途中で測らない」）
    }
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
