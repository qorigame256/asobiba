// ポーカー（5カードドロー）。2〜6人。お金は賭けず、チップの点数だけ。
// 1回の勝負（ハンド）: 参加料（ブラインド）を出す → 5枚配る → 1回目の賭け → 好きな枚数を1回交換 → 2回目の賭け → 役の強さで勝負。
// これを繰り返し、詳細設定の終わり方（最後の1人まで / 決めた回数）で順位を決める。
// 手: { p, t: 'fold' | 'check' | 'call' | 'raise' } / { p, t: 'draw', idx: [捨てる札の位置…] } / { p, t: 'next' }（次の勝負へ）
//
// 細かい決めごと（どれも Claude の判断。変えるなら本人に確認）:
//   - 持ち点は全員 1000。ブラインドは 10/20 から始まり、5回ごとに倍になる。
//   - 賭け方は決まった額ずつ（フィックスドリミット）: 1回目の賭けは大きい方のブラインドと同じ額、2回目はその倍。
//     1回の賭けで上乗せできるのは4回まで。額を打ち込まなくてよいので、初めての人でも迷わない。
//   - 足りない人は持ち点全部（オールイン）で参加できる。分け前は普通のポーカーと同じく、出した額ごとに分ける（サイドポット）。
//     端数は親（D）の次の人から順に配る。オールインに届かない上乗せでも、ほかの人はもう一度動ける（本式より少し緩い）。
//   - 2人のときは親が小さい方のブラインドを出し、1回目の賭けは親から、2回目は親でない方から。
//   - 山札が足りなくなったら、捨てられた札を切り直して使う。

import { mulberry32, shuffle } from './util.js';
import { SUITS, suitOf, rankOf, makeDeck, cardEl, backEl } from './cards.js';

const START_CHIPS = 1000;
const LEVEL_HANDS = 5;
const CAP = 4;
const HAND_NAMES = ['役なし', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ'];
const HAND_HELP = [
  ['ロイヤルストレートフラッシュ', '同じマークの 10・J・Q・K・A'],
  ['ストレートフラッシュ', '同じマークで5枚の連番'],
  ['フォーカード', '同じ数字4枚'],
  ['フルハウス', '同じ数字3枚＋同じ数字2枚'],
  ['フラッシュ', '5枚とも同じマーク'],
  ['ストレート', '5枚の連番（マークはばらばらでよい）'],
  ['スリーカード', '同じ数字3枚'],
  ['ツーペア', '同じ数字2枚が2組'],
  ['ワンペア', '同じ数字2枚'],
  ['役なし', '一番強い札で比べる'],
];

const pr = (c) => (rankOf(c) === 1 ? 14 : rankOf(c)); // A が一番強い
const sortCards = (h) => h.sort((a, b) => pr(a) - pr(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));

// 役の強さを [役の番号, 比べる数字…] で返す。大きい方が強い
export function evaluate(cards) {
  const rs = cards.map(pr).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const count = new Map();
  for (const r of rs) count.set(r, (count.get(r) ?? 0) + 1);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let straight = 0;
  if (count.size === 5) {
    if (rs[0] - rs[4] === 4) straight = rs[0];
    else if (rs.join() === '14,5,4,3,2') straight = 5; // A-2-3-4-5
  }
  const g = groups.map((x) => x[0]);
  if (straight && flush) return [8, straight];
  if (groups[0][1] === 4) return [7, ...g];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...g];
  if (flush) return [5, ...rs];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, ...g];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...g];
  if (groups[0][1] === 2) return [1, ...g];
  return [0, ...rs];
}

export function compareEval(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

export const handName = (ev) => (ev[0] === 8 && ev[1] === 14 ? 'ロイヤルストレートフラッシュ' : HAND_NAMES[ev[0]]);

const blinds = (no) => {
  const k = Math.floor((no - 1) / LEVEL_HANDS);
  return [10 * 2 ** k, 20 * 2 ** k];
};

/* ---------- 進行 ---------- */

const range = (n) => Array.from({ length: n }, (_, i) => i);
const isAlive = (s, p) => s.outAt[p] === null;
const inHand = (s, p) => s.h.cards[p] !== null && !s.h.folded[p];
const canBet = (s, p) => inHand(s, p) && s.chips[p] > 0;
const live = (s) => range(s.n).filter((p) => inHand(s, p));

function nextAlive(s, from) {
  for (let k = 1; k <= s.n; k++) {
    const q = (((from + k) % s.n) + s.n) % s.n;
    if (isAlive(s, q)) return q;
  }
  return from;
}

function pay(s, p, amount) {
  const x = Math.min(amount, s.chips[p]);
  s.chips[p] -= x;
  s.h.bet[p] += x;
  s.h.total[p] += x;
  return x;
}

function nextToAct(s, from) {
  const h = s.h;
  for (let k = 1; k <= s.n; k++) {
    const q = (from + k) % s.n;
    if (canBet(s, q) && (!h.acted[q] || h.bet[q] < h.maxBet)) return q;
  }
  return null;
}

function startHand(s) {
  s.handNo += 1;
  s.dealer = nextAlive(s, s.dealer);
  const players = range(s.n).filter((p) => isAlive(s, p));
  const [small, big] = blinds(s.handNo);
  const sb = players.length === 2 ? s.dealer : nextAlive(s, s.dealer);
  const bb = nextAlive(s, sb);
  const deck = shuffle(makeDeck(), mulberry32(s.seed + s.handNo * 7919));
  const cards = Array(s.n).fill(null);
  for (const p of players) cards[p] = sortCards(deck.splice(-5));
  s.h = {
    no: s.handNo, dealer: s.dealer, sb, bb, small, big, deck, muck: [], shuffles: 0, cards,
    folded: Array(s.n).fill(false), bet: Array(s.n).fill(0), total: Array(s.n).fill(0), acted: Array(s.n).fill(false),
    drew: Array(s.n).fill(null), maxBet: 0, raises: 1, unit: big, phase: 'bet1', toAct: null, result: null,
    startChips: s.chips.slice(),
  };
  pay(s, sb, small);
  pay(s, bb, big);
  s.h.maxBet = Math.max(...s.h.bet);
  s.h.toAct = nextToAct(s, bb);
  if (s.h.toAct === null) endBetting(s);
}

function nextDrawer(s, from) {
  for (let k = 1; k <= s.n; k++) {
    const q = (from + k) % s.n;
    if (inHand(s, q) && s.h.drew[q] === null) return q;
  }
  return null;
}

function startBet2(s) {
  const h = s.h;
  h.phase = 'bet2';
  h.bet = h.bet.map(() => 0);
  h.acted = h.acted.map(() => false);
  h.maxBet = 0;
  h.raises = 0;
  h.unit = h.big * 2;
  h.toAct = live(s).filter((p) => canBet(s, p)).length >= 2 ? nextToAct(s, h.dealer) : null;
  if (h.toAct === null) showdown(s);
}

function endBetting(s) {
  const h = s.h;
  if (h.phase === 'bet1') {
    h.phase = 'draw';
    h.toAct = nextDrawer(s, h.dealer);
  } else {
    showdown(s);
  }
}

// 出した額ごとに分け前（ポット）を作り、それぞれ一番強い人が取る
function showdown(s) {
  const h = s.h;
  const ps = live(s);
  const ev = {};
  for (const p of ps) ev[p] = evaluate(h.cards[p]);
  const order = range(s.n).map((k) => (h.dealer + 1 + k) % s.n); // 端数を配る順
  const got = Array(s.n).fill(0);
  const levels = [...new Set(h.total.filter((x) => x > 0))].sort((a, b) => a - b);
  let prev = 0;
  let dead = 0;
  let lastWinners = ps;
  for (const lv of levels) {
    let amount = dead;
    for (let i = 0; i < s.n; i++) amount += Math.min(h.total[i], lv) - Math.min(h.total[i], prev);
    prev = lv;
    const elig = ps.filter((p) => h.total[p] >= lv);
    if (!elig.length) { dead = amount; continue; }
    dead = 0;
    const best = elig.reduce((a, b) => (compareEval(ev[b], ev[a]) > 0 ? b : a));
    const winners = order.filter((p) => elig.includes(p) && compareEval(ev[p], ev[best]) === 0);
    split(got, winners, amount);
    lastWinners = winners;
  }
  if (dead) split(got, lastWinners, dead);
  got.forEach((x, p) => { s.chips[p] += x; });
  h.result = { kind: 'show', ev, got };
  finishHand(s);
}

function split(got, winners, amount) {
  const each = Math.floor(amount / winners.length);
  winners.forEach((p, i) => { got[p] += each + (i < amount - each * winners.length ? 1 : 0); });
}

function winByFold(s, p) {
  const got = Array(s.n).fill(0);
  got[p] = s.h.total.reduce((a, b) => a + b, 0);
  s.chips[p] += got[p];
  s.h.result = { kind: 'fold', got };
  finishHand(s);
}

function finishHand(s) {
  const h = s.h;
  h.phase = 'end';
  h.toAct = null;
  const busted = range(s.n).filter((p) => isAlive(s, p) && s.chips[p] === 0).sort((a, b) => h.startChips[a] - h.startChips[b]);
  for (const p of busted) { s.outAt[p] = s.handNo; s.outOrder.push(p); }
  const alive = range(s.n).filter((p) => isAlive(s, p));
  if (alive.length <= 1 || (s.rules.end === 'hands' && s.handNo >= s.rules.hands)) {
    s.over = true;
    const byChips = alive.slice().sort((a, b) => s.chips[b] - s.chips[a]);
    s.ranking = [...byChips, ...s.outOrder.slice().reverse()];
  }
}

function drawCards(s, k) {
  const h = s.h;
  const got = [];
  while (got.length < k) {
    if (!h.deck.length) {
      if (!h.muck.length) break;
      h.shuffles += 1;
      h.deck = shuffle(h.muck, mulberry32(s.seed + h.no * 7919 + h.shuffles * 104729));
      h.muck = [];
    }
    got.push(h.deck.pop());
  }
  return got;
}

const clone = (s) => ({
  ...s, chips: s.chips.slice(), outAt: s.outAt.slice(), outOrder: s.outOrder.slice(),
  h: s.h && {
    ...s.h, deck: s.h.deck.slice(), muck: s.h.muck.slice(), cards: s.h.cards.map((c) => c && c.slice()),
    folded: s.h.folded.slice(), bet: s.h.bet.slice(), total: s.h.total.slice(), acted: s.h.acted.slice(), drew: s.h.drew.slice(),
  },
});

/* ---------- CPU ---------- */

function chooseDiscards(cards, ev) {
  const all = [0, 1, 2, 3, 4];
  if (ev[0] >= 4) return []; // ストレート以上は交換しない
  if (ev[0] >= 1) { // 組になっている数字は残す
    const keep = new Set(ev.slice(1, ev[0] === 2 ? 3 : 2));
    return all.filter((i) => !keep.has(pr(cards[i])));
  }
  for (const i of all) { // あと1枚でフラッシュ・ストレート
    const rest = cards.filter((_, j) => j !== i);
    if (rest.every((c) => suitOf(c) === suitOf(rest[0]))) return [i];
    const rs = rest.map(pr).sort((a, b) => a - b);
    if (new Set(rs).size === 4 && rs[3] - rs[0] <= 4) return [i];
  }
  const top = all.reduce((a, b) => (pr(cards[b]) > pr(cards[a]) ? b : a));
  return all.filter((i) => i !== top || pr(cards[top]) < 13);
}

function strength(s, p) {
  const cards = s.h.cards[p];
  const ev = evaluate(cards);
  const pre = s.h.phase === 'bet1';
  if (ev[0] >= 3) return pre ? 3.2 : 3.6;
  if (ev[0] === 2) return pre ? 2.8 : 2.8;
  if (ev[0] === 1) return ev[1] >= 11 ? (pre ? 2.2 : 2) : 1.4;
  if (pre && chooseDiscards(cards, ev).length === 1) return 1.3; // あと1枚の見込み
  return pr(cards[4]) === 14 ? 0.8 : 0.3;
}

/* ---------- 画面 ---------- */

let pick = { key: null, idx: [] }; // 交換で捨てる札（通信で描き直されても消えないよう外に持つ）
let helpOpen = false;

function logText(s, nameP) {
  const L = s.last;
  if (!L) return '';
  const name = nameP(L.p);
  switch (L.t) {
    case 'fold': return `${name}は降りた（フォールド）`;
    case 'check': return `${name}はチェック（賭けずに回す）`;
    case 'call': return `${name}がコール（${L.amount}出して合わせた）${L.allin ? '・オールイン' : ''}`;
    case 'raise': return `${name}がレイズ（${L.to}まで上乗せ）${L.allin ? '・オールイン' : ''}`;
    case 'draw': return L.n ? `${name}が${L.n}枚交換した` : `${name}は交換しなかった`;
    case 'next': return `第${s.handNo}回の勝負を始めます`;
    default: return '';
  }
}

export default {
  id: 'poker',
  name: 'ポーカー',
  icon: '♠',
  desc: '5枚配って1回だけ交換し、役の強さでチップを取り合う（5カードドロー）',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'end', label: '終わり方', desc: '「最後の1人まで」はチップが無くなった人から抜ける。「決めた回数で」はその回数でチップが一番多い人の勝ち', def: 'last', choices: [['last', '最後の1人まで'], ['hands', '決めた回数で']] },
    { key: 'hands', label: '回数', desc: '「決めた回数で」のときに勝負する回数', def: 10, choices: [[5, '5回'], [10, '10回'], [20, '20回']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = {
      n, seed, rules: { end: 'last', hands: 10, ...rules }, chips: Array(n).fill(START_CHIPS), outAt: Array(n).fill(null), outOrder: [],
      handNo: 0, dealer: -1, h: null, over: false, ranking: null, step: 0, last: null,
    };
    startHand(s);
    return s;
  },

  turn(s) { return s.over || s.h.phase === 'end' ? null : s.h.toAct; },
  canAct(s, p) {
    if (s.over) return false;
    if (s.h.phase === 'end') return isAlive(s, p);
    return s.h.toAct === p;
  },
  result(s) { return s.over ? { winner: s.ranking[0], ranking: s.ranking } : null; },
  cpuDelay(s) { return s.h?.phase === 'end' ? 4000 : 900; }, // 勝負の結果は少し長めに見せる

  resultText(res, me, pn) {
    if (me >= 0) {
      const i = res.ranking.indexOf(me);
      return i === 0 ? 'あなたの優勝！🎉' : `あなたは${i + 1}位`;
    }
    return `${pn(res.winner)}の優勝！`;
  },
  phaseText(s) { return s.h.phase === 'end' ? `第${s.handNo}回の勝負がつきました` : ''; },

  apply(s0, m) {
    if (!m || !Number.isInteger(m.p) || !this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    const h = s.h;
    const p = m.p;
    s.step += 1;

    if (h.phase === 'end') {
      if (m.t !== 'next') return null;
      startHand(s);
      s.last = { p, t: 'next' };
      return s;
    }

    if (h.phase === 'draw') {
      const idx = m.idx;
      if (m.t !== 'draw' || !Array.isArray(idx) || idx.length > 5 || new Set(idx).size !== idx.length
        || !idx.every((i) => Number.isInteger(i) && i >= 0 && i < 5)) return null;
      const keep = h.cards[p].filter((_, i) => !idx.includes(i));
      h.muck.push(...h.cards[p].filter((_, i) => idx.includes(i)));
      h.cards[p] = sortCards([...keep, ...drawCards(s, idx.length)]);
      h.drew[p] = idx.length;
      s.last = { p, t: 'draw', n: idx.length };
      h.toAct = nextDrawer(s, p);
      if (h.toAct === null) startBet2(s);
      return s;
    }

    const need = h.maxBet - h.bet[p];
    if (m.t === 'fold') {
      if (need <= 0) return null; // 只で回せるときは降りない
      h.folded[p] = true;
      h.muck.push(...h.cards[p]);
      s.last = { p, t: 'fold' };
    } else if (m.t === 'check') {
      if (need !== 0) return null;
      s.last = { p, t: 'check' };
    } else if (m.t === 'call') {
      if (need <= 0) return null;
      const x = pay(s, p, need);
      s.last = { p, t: 'call', amount: x, allin: s.chips[p] === 0 };
    } else if (m.t === 'raise') {
      const others = live(s).some((q) => q !== p && s.chips[q] > 0);
      if (h.raises >= CAP || s.chips[p] <= need || !others) return null;
      pay(s, p, h.maxBet + h.unit - h.bet[p]);
      h.maxBet = Math.max(h.maxBet, h.bet[p]);
      h.raises += 1;
      h.acted = h.acted.map(() => false);
      s.last = { p, t: 'raise', to: h.bet[p], allin: s.chips[p] === 0 };
    } else {
      return null;
    }
    h.acted[p] = true;

    const left = live(s);
    if (left.length === 1) { winByFold(s, left[0]); return s; }
    const next = nextToAct(s, p);
    if (next === null) endBetting(s);
    else h.toAct = next;
    return s;
  },

  // CPU: 役の強さに少しのゆらぎを足して、上乗せ・合わせる・降りるを決める。読み合いはしない
  cpu(s, p) {
    const h = s.h;
    if (h.phase === 'end') return { t: 'next' };
    if (h.phase === 'draw') return { t: 'draw', idx: chooseDiscards(h.cards[p], evaluate(h.cards[p])) };
    const need = h.maxBet - h.bet[p];
    const canRaise = h.raises < CAP && s.chips[p] > need && live(s).some((q) => q !== p && s.chips[q] > 0);
    const str = strength(s, p) + Math.random() * 0.8 - 0.4;
    if (need === 0) return canRaise && (str >= 2.4 || Math.random() < 0.08) ? { t: 'raise' } : { t: 'check' };
    if (canRaise && str >= 2.7) return { t: 'raise' };
    if (str >= 1.2 || (need <= h.unit && str >= 0.7) || Math.random() < 0.1) return { t: 'call' };
    return { t: 'fold' };
  },

  render(root, s, o) {
    const h = s.h;
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const key = `${s.handNo}:${me}`;
    if (pick.key !== key) pick = { key, idx: [] };
    const draw = () => this.render(root, s, o);
    const shown = h.phase === 'end' && h.result.kind === 'show';
    const potTotal = h.total.reduce((a, b) => a + b, 0);

    root.innerHTML = '';
    root.className = 'board pk';

    const opps = document.createElement('div');
    opps.className = 'cc-opps pk-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (this.turn(s) === p ? ' turn' : '') + (s.ranking?.[0] === p ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = (h.dealer === p ? 'Ⓓ ' : '') + o.names[p];
      const info = document.createElement('div');
      info.className = 'cc-opp-count';
      info.textContent = isAlive(s, p) || h.cards[p] ? `持ち点 ${s.chips[p]}` : '脱落';
      chip.append(name, info);
      if (h.cards[p] && (h.bet[p] || h.phase !== 'end')) {
        const b = document.createElement('div');
        b.className = 'pk-bet';
        b.textContent = h.phase === 'end' ? '' : `賭け ${h.bet[p]}`;
        if (b.textContent) chip.append(b);
      }
      if (h.cards[p]) {
        const row = document.createElement('div');
        row.className = 'pk-mini';
        const open = shown && !h.folded[p];
        for (const c of h.cards[p]) row.append(open ? cardEl(c) : backEl());
        if (!h.folded[p]) chip.append(row);
      }
      const tags = [];
      if (h.result?.got[p]) tags.push(['rank', `+${h.result.got[p]}`]);
      if (shown && !h.folded[p]) tags.push(['prev', handName(h.result.ev[p])]);
      if (h.folded[p]) tags.push(['away', '降りた']);
      else if (h.cards[p] && s.chips[p] === 0 && h.phase !== 'end') tags.push(['last', 'オールイン']);
      if (h.drew[p] !== null && h.phase !== 'end') tags.push(['away', `${h.drew[p]}枚交換`]);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        chip.append(t);
      }
      opps.append(chip);
    }
    root.append(opps);

    const table = document.createElement('div');
    table.className = 'pk-table';
    const phaseName = { bet1: '1回目の賭け', draw: '札の交換', bet2: '2回目の賭け', end: '勝負' }[h.phase];
    const limit = s.rules.end === 'hands' ? ` / ${s.rules.hands}回` : '';
    table.innerHTML = `<div class="pk-pot">場のチップ <b>${potTotal}</b></div>`
      + `<div class="pk-meta">第${s.handNo}回${limit}・${phaseName}・ブラインド ${h.small}/${h.big}</div>`;
    root.append(table);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    if (s.ranking) {
      const list = document.createElement('ol');
      list.className = 'df-ranking';
      for (const p of s.ranking) {
        const li = document.createElement('li');
        li.textContent = `${nameP(p)}（持ち点 ${s.chips[p]}）`;
        list.append(li);
      }
      root.append(list);
    }

    if (me !== null && h.cards[me]) {
      const myTurn = o.canMove;
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      const ev = evaluate(h.cards[me]);
      head.textContent = `あなた（${h.dealer === me ? 'Ⓓ 親・' : ''}持ち点 ${s.chips[me]}・賭け ${h.bet[me]}）`;
      const now = document.createElement('small');
      now.textContent = (h.folded[me] ? 'この勝負は降りました' : `いまの役: ${handName(ev)}`)
        + (h.result?.got[me] ? `／ +${h.result.got[me]} 獲得` : '');
      head.append(now);
      root.append(head);

      const hand = document.createElement('div');
      hand.className = 'pk-hand';
      const drawing = myTurn && h.phase === 'draw';
      h.cards[me].forEach((c, i) => {
        const e = cardEl(c, drawing ? 'button' : 'div');
        if (h.folded[me]) e.classList.add('folded');
        if (drawing) {
          if (pick.idx.includes(i)) e.classList.add('selected');
          e.onclick = () => {
            pick.idx = pick.idx.includes(i) ? pick.idx.filter((x) => x !== i) : [...pick.idx, i];
            draw();
          };
        }
        hand.append(e);
      });
      root.append(hand);

      if (myTurn && h.phase !== 'end') {
        const actions = document.createElement('div');
        actions.className = 'cc-actions';
        const btn = (text, variant, move) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn ' + variant;
          b.textContent = text;
          b.onclick = () => o.onMove(move);
          actions.append(b);
        };
        const hint = document.createElement('p');
        hint.className = 'pk-hint';
        if (drawing) {
          hint.textContent = '捨てる札をタップして選び、交換します（何枚でも・0枚でもよい）';
          btn(pick.idx.length ? `選んだ${pick.idx.length}枚を交換` : '交換しない', 'primary', { t: 'draw', idx: pick.idx.slice().sort() });
        } else {
          const need = h.maxBet - h.bet[me];
          const canRaise = h.raises < CAP && s.chips[me] > need && live(s).some((q) => q !== me && s.chips[q] > 0);
          const raiseTo = Math.min(h.maxBet + h.unit, h.bet[me] + s.chips[me]);
          if (need > 0) {
            hint.textContent = `${need}出せば勝負を続けられます。降りると、ここまで賭けた分はもどりません`;
            btn('降りる（フォールド）', 'secondary', { t: 'fold' });
            btn(s.chips[me] <= need ? `合わせる（オールイン ${s.chips[me]}）` : `合わせる（コール ${need}）`, 'primary', { t: 'call' });
          } else {
            hint.textContent = 'チップを出さずに次の人へ回すか、上乗せできます';
            btn('そのまま（チェック）', 'primary', { t: 'check' });
          }
          if (canRaise) btn(`上乗せ（${h.maxBet ? 'レイズ' : 'ベット'} ${raiseTo}まで）`, 'secondary', { t: 'raise' });
        }
        root.append(hint, actions);
      }
    }

    if (h.phase === 'end' && !s.over && o.canMove) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary';
      b.textContent = '次の勝負へ';
      b.onclick = () => o.onMove({ t: 'next' });
      actions.append(b);
      root.append(actions);
    }

    const help = document.createElement('details');
    help.className = 'pk-help';
    help.open = helpOpen;
    help.ontoggle = () => { helpOpen = help.open; };
    help.innerHTML = '<summary>役の強さ（上ほど強い）</summary>';
    const ol = document.createElement('ol');
    for (const [n, d] of HAND_HELP) {
      const li = document.createElement('li');
      li.innerHTML = `<b>${n}</b> ${d}`;
      ol.append(li);
    }
    help.append(ol);
    root.append(help);
  },
};

