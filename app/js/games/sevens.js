// 七並べ。3〜6人。トランプ52枚（ジョーカーなし）を全部配り、7の札は最初に全部場に並べる。♦7 を持っていた人から始める。
// 自分の番に、場の札のとなり（同じマークで数字が1つ違う所）に1枚出すか、パスする。出せる札があってもパスしてよい。
// パスは詳細設定の回数まで（最初は3回）。それを超えてパスしたら失格で、その人の手札は全部場に並べる（2026-10-05 本人承認）。
// 手札を早くなくした順に順位が付き、失格した人は最後（あとで失格した人ほど上）。
// トンネル（詳細設定・最初はなし）: K と A をつながっているものとみなす（K が出ていれば A を、A が出ていれば K を出せる）。
// 決まりごと（Claude の判断）: 出せるのは「となりの数字がもう場にある」札。失格で並べた札のとなりにも出せる。
// ジョーカー（詳細設定・最初はなし。2026-10-06 本人承認）: 1枚入れて53枚を配る。出せる場所（空いていて、となりが場にある所）に本物の札の代わりに置ける。
//   その本物の札を持っている人は、次の自分の番に必ずその札を出し（パスもほかの札も出せない）、ジョーカーを受け取る。
//   作り（Claude の判断）: 自分が持っている札の場所には置けない。ジョーカーが最後の1枚なら置いて上がってよい。失格した人のジョーカーは場に並べず捨てる。
//   置いたジョーカーは field[置いた所] = 'joker'、出さなければいけない人は jk = { at: 置いた所, owner }。
// 手: { p, t: 'play', c: 札 } / { p, t: 'play', c: 'JK', at: 置く所 } / { p, t: 'pass' }

import { mulberry32, shuffle } from './util.js';
import { makeDeck, suitOf, rankOf, cardEl, cardLabel, SUITS, SUIT_MARK, JOKER } from './cards.js';

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), field: { ...s.field }, passes: s.passes.slice(), done: s.done.slice(), outs: s.outs.slice() });
const ORDER = (c) => (c === JOKER ? 99 : SUITS.indexOf(suitOf(c)) * 13 + rankOf(c));
const ALL = SUITS.flatMap((su) => Array.from({ length: 13 }, (_, k) => su + (k + 1)));

// ジョーカーを置ける所（出せる所のうち、自分が本物の札を持っていない所）
export function jokerSpots(s, p) {
  return ALL.filter((c) => canPlace(s, c) && !s.hands[p].includes(c));
}
// p が出せる札（ジョーカーの所の札を出さなければいけないときは、その札だけ）
export function playable(s, p) {
  if (s.jk && s.jk.owner === p) return [s.jk.at];
  return s.hands[p].filter((c) => (c === JOKER ? jokerSpots(s, p).length > 0 : canPlace(s, c)));
}

// 札 c を出せるか（場にまだ無く、となりの数字が場にある）
function canPlace(s, c) {
  if (s.field[c]) return false;
  const su = suitOf(c);
  const r = rankOf(c);
  const near = [r - 1, r + 1].filter((x) => x >= 1 && x <= 13);
  if (s.tunnel && r === 1) near.push(13);
  if (s.tunnel && r === 13) near.push(1);
  return near.some((x) => s.field[su + x]);
}

const playing = (s, p) => s.hands[p].length > 0 && !s.outs.includes(p);

function nextPlayer(s, p) {
  for (let k = 1; k <= s.n; k++) {
    const q = (p + k) % s.n;
    if (playing(s, q)) return q;
  }
  return -1;
}

export default {
  id: 'sevens',
  name: '七並べ',
  icon: '7️⃣',
  desc: '7から順に、場の札のとなりへ出していく。出せないときはパス（回数に限りあり）。手札を早くなくした人の勝ち',
  ready: true,
  multi: true,
  minPlayers: 3,
  maxPlayers: 6,
  settings: [
    { key: 'passes', label: 'パスできる回数', desc: 'これを超えてパスすると失格（手札は全部場に並べる）', def: 3, choices: [[3, '3回'], [5, '5回']] },
    { key: 'tunnel', label: 'トンネル', desc: 'K と A をつながっているとみなす（K が出ていれば A を、A が出ていれば K を出せる）', def: false },
    { key: 'joker', label: 'ジョーカー', desc: '1枚入れる。出せる所に本物の札の代わりに置ける。その札を持っている人は、次の番に必ずその札を出してジョーカーを受け取る', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const joker = rules.joker === true;
    const deck = shuffle(makeDeck(joker ? 1 : 0), mulberry32(seed));
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, k) => hands[k % n].push(c));
    const field = {};
    let turn = 0;
    hands.forEach((h, p) => {
      if (h.includes('d7')) turn = p;
      for (const c of h.filter((x) => rankOf(x) === 7)) field[c] = 'start';
      hands[p] = h.filter((x) => rankOf(x) !== 7).sort((a, b) => ORDER(a) - ORDER(b));
    });
    const s = {
      n, maxPass: rules.passes === 5 ? 5 : 3, tunnel: rules.tunnel === true, joker, jk: null,
      hands, field, turn, passes: Array(n).fill(0), done: [], outs: [], last: null, step: 0,
    };
    // 7 しか持っていなかった人は配った時点で上がり
    for (let p = 0; p < n; p++) if (!s.hands[p].length) s.done.push(p);
    if (!playing(s, s.turn)) s.turn = nextPlayer(s, s.turn);
    return s;
  },

  canPlace,
  ended(s) { return Array.from({ length: s.n }, (_, p) => p).filter((p) => playing(s, p)).length <= 1; },
  turn(s) { return this.ended(s) ? null : s.turn; },
  canAct(s, p) { return !this.ended(s) && s.turn === p; },
  startSound: 'shuffle',
  sound(a, b) { return b.last?.t === 'out' ? 'wrong' : b.last?.t === 'pass' ? 'pop' : 'card'; },

  result(s) {
    if (!this.ended(s)) return null;
    const rest = Array.from({ length: s.n }, (_, p) => p).filter((p) => playing(s, p));
    const ranking = [...s.done, ...rest, ...s.outs.slice().reverse()];
    return { winner: ranking[0], ranking };
  },
  resultText(res, me, pn) {
    const head = res.winner === me ? 'あなたが1位！🎉' : `${pn(res.winner)}が1位！`;
    return head;
  },

  apply(s0, m) {
    if (!m || !this.canAct(s0, m.p)) return null;
    const p = m.p;
    const s = clone(s0);
    s.step += 1;
    if (s0.jk && s0.jk.owner === p) {
      // ジョーカーの所の本物の札を出して、ジョーカーを受け取る
      if (m.t !== 'play' || m.c !== s0.jk.at) return null;
      s.hands[p].splice(s.hands[p].indexOf(m.c), 1);
      s.hands[p].push(JOKER);
      s.field[m.c] = 'play';
      s.jk = null;
      s.last = { t: 'swap', p, c: m.c };
    } else if (m.t === 'play' && m.c === JOKER) {
      const i = s.hands[p].indexOf(JOKER);
      if (i < 0 || typeof m.at !== 'string' || !jokerSpots(s0, p).includes(m.at)) return null;
      s.hands[p].splice(i, 1);
      s.field[m.at] = 'joker';
      s.jk = { at: m.at, owner: s.hands.findIndex((h) => h.includes(m.at)) };
      s.last = { t: 'joker', p, c: m.at, owner: s.jk.owner };
      if (!s.hands[p].length) { s.done.push(p); s.last.up = true; }
    } else if (m.t === 'play') {
      const i = s.hands[p].indexOf(m.c);
      if (i < 0 || !canPlace(s, m.c)) return null;
      s.hands[p].splice(i, 1);
      s.field[m.c] = 'play';
      s.last = { t: 'play', p, c: m.c };
      if (!s.hands[p].length) { s.done.push(p); s.last.up = true; }
    } else if (m.t === 'pass') {
      s.passes[p] += 1;
      if (s.passes[p] > s.maxPass) {
        for (const c of s.hands[p]) if (c !== JOKER) s.field[c] = 'out';
        s.last = { t: 'out', p, cards: s.hands[p].slice() };
        s.hands[p] = [];
        s.outs.push(p);
      } else {
        s.last = { t: 'pass', p };
      }
    } else {
      return null;
    }
    if (!this.ended(s)) s.turn = nextPlayer(s, p);
    return s;
  },

  // CPU: 出せる札があればたいてい出す。自分が続きの札を持っているマークを優先し、持っていない所を開けるのは後回し。
  // 手札が多くパスに余裕があるときは、相手を助けるだけの札しか無ければ ときどきパスする。2割は適当に出して弱めている
  cpu(s, p) {
    const hand = s.hands[p];
    if (s.jk && s.jk.owner === p) return { t: 'play', c: s.jk.at };
    const ok = hand.filter((c) => c !== JOKER && canPlace(s, c));
    // ジョーカーは、ほかに出せる札が無いとき（か最後の1枚のとき）に使う。置く所は、その先の札を自分が持っている所（無ければ適当）
    if (hand.includes(JOKER) && (!ok.length || hand.length === 1)) {
      const spots = jokerSpots(s, p);
      if (spots.length) {
        const good = spots.filter((c) => [rankOf(c) - 1, rankOf(c) + 1].some((x) => hand.includes(suitOf(c) + x)));
        const pool = good.length && Math.random() >= 0.2 ? good : spots;
        return { t: 'play', c: JOKER, at: pool[Math.floor(Math.random() * pool.length)] };
      }
    }
    if (!ok.length) return { t: 'pass' };
    if (Math.random() < 0.2) return { t: 'play', c: ok[Math.floor(Math.random() * ok.length)] };
    // その札を出したあと、同じ向きの続きを自分が何枚持っているか
    const follow = (c) => {
      const su = suitOf(c);
      const r = rankOf(c);
      const dir = r < 7 ? -1 : 1;
      let k = 0;
      for (let x = r + dir; x >= 1 && x <= 13; x += dir) if (hand.includes(su + x)) k++;
      return k;
    };
    const scored = ok.map((c) => ({ c, v: follow(c) * 2 + (rankOf(c) === 1 || rankOf(c) === 13 ? 3 : 0) + Math.random() }));
    scored.sort((a, b) => b.v - a.v);
    const left = s.maxPass - s.passes[p];
    if (scored[0].v < 1 && left >= 2 && hand.length > 4 && Math.random() < 0.35) return { t: 'pass' };
    return { t: 'play', c: scored[0].c };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    // ジョーカーを押したら、置く所を場から選ぶ（同じ局面の間だけ覚えておく）
    const picking = pickJoker === `${s.step}:${me}` && o.canMove;
    const redraw = () => this.render(root, s, o);
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board sv';

    // 参加者
    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    for (const p of seats) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (!res && s.turn === p ? ' turn' : '') + (s.done[0] === p ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      const cnt = document.createElement('div');
      cnt.className = 'bb-count';
      cnt.textContent = s.outs.includes(p) ? '失格' : s.hands[p].length ? `${s.hands[p].length}枚` : '上がり';
      const pass = document.createElement('div');
      pass.className = 'sv-pass';
      pass.textContent = s.outs.includes(p) ? 'パスしすぎ' : `パス ${s.passes[p]}/${s.maxPass}`;
      chip.append(name, cnt, pass);
      if (res) chip.append(tag('rank', `${res.ranking.indexOf(p) + 1}位`));
      else if (s.done.includes(p)) chip.append(tag('rank', `${s.done.indexOf(p) + 1}位`));
      if (o.away[p]) chip.append(tag('away', '応答なし'));
      else if (o.sub?.[p]) chip.append(tag('away', 'CPU が代わりに'));
      opps.append(chip);
    }
    root.append(opps);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    // 場（マークごとに A〜K の13マス）
    const field = document.createElement('div');
    field.className = 'sv-field';
    for (const su of SUITS) {
      const row = document.createElement('div');
      row.className = 'sv-row';
      for (let r = 1; r <= 13; r++) {
        const c = su + r;
        let e;
        if (s.field[c] === 'joker') {
          e = cardEl(JOKER);
          e.classList.add('sv-joker');
          e.title = `${cardLabel(c)} の代わり`;
          if (o.fresh && s.last?.t === 'joker') e.classList.add('pop');
        } else if (s.field[c]) {
          e = cardEl(c);
          if (s.field[c] === 'out') e.classList.add('sv-dumped');
          if (o.fresh && s.last?.t === 'play' && s.last.c === c) e.classList.add('pop');
        } else {
          const spot = picking && jokerSpots(s, me).includes(c);
          e = document.createElement(spot ? 'button' : 'div');
          e.className = 'pcard sv-empty' + (!res && canPlace(s, c) ? ' open' : '') + (spot ? ' sv-spot' : '');
          e.textContent = r === 1 ? 'A' : r > 10 ? ['J', 'Q', 'K'][r - 11] : String(r);
          if (spot) {
            e.type = 'button';
            e.onclick = () => { pickJoker = null; o.onMove({ t: 'play', c: JOKER, at: c }); };
          }
        }
        row.append(e);
      }
      const mark = document.createElement('div');
      mark.className = 'sv-mark' + (su === 'h' || su === 'd' ? ' red' : '');
      mark.textContent = SUIT_MARK[su];
      row.prepend(mark);
      field.append(row);
    }
    root.append(field);

    // 自分の手札
    if (me !== null && !res) {
      const forced = s.jk && s.jk.owner === me;
      if (forced || picking) {
        const note = document.createElement('p');
        note.className = 'sv-jnote';
        note.textContent = forced
          ? `ジョーカーが ${cardLabel(s.jk.at)} の所に置かれました。${o.canMove ? 'その札を出して、ジョーカーを受け取ってください' : '次の番にその札を出します'}`
          : 'ジョーカーを置く所を、場の光っているマスから選んでください';
        root.insertBefore(note, field);
      }
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      const left = s.maxPass - s.passes[me];
      head.innerHTML = s.outs.includes(me) ? 'あなたは失格しました' : s.hands[me].length
        ? `あなたの手札 <small>${s.hands[me].length}枚・パスはあと${left}回${left === 0 ? '（次のパスで失格）' : ''}</small>`
        : 'あなたは上がりました！';
      root.append(head);
      const hand = document.createElement('div');
      hand.className = 'bb-hand sv-hand';
      const can = o.canMove ? playable(s, me) : [];
      for (const c of s.hands[me]) {
        const usable = can.includes(c);
        const e = cardEl(c, usable ? 'button' : 'div');
        if (usable) {
          e.classList.add('usable');
          if (c === JOKER && picking) e.classList.add('picked');
          e.onclick = c === JOKER
            ? () => { pickJoker = picking ? null : `${s.step}:${me}`; redraw(); }
            : () => { pickJoker = null; o.onMove({ t: 'play', c }); };
        } else if (o.canMove) e.classList.add('dim');
        hand.append(e);
      }
      root.append(hand);
      if (o.canMove && !forced) {
        const act = document.createElement('div');
        act.className = 'cc-actions';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.textContent = left > 0 ? `パス（あと${left}回）` : 'パス（失格になります）';
        b.onclick = () => { if (left > 0 || confirm('パスすると失格になり、手札を全部場に並べます。よろしいですか？')) o.onMove({ t: 'pass' }); };
        act.append(b);
        root.append(act);
      }
    }
  },
};

let pickJoker = null;

function tag(cls, text) {
  const t = document.createElement('span');
  t.className = 'cc-tag ' + cls;
  t.textContent = text;
  return t;
}

function logText(s, nameP) {
  const l = s.last;
  if (!l) return `7の札を並べました。${nameP(s.turn)}から始めます`;
  if (l.t === 'play') return `${nameP(l.p)}が ${cardLabel(l.c)} を出した${l.up ? '。上がり！' : ''}`;
  if (l.t === 'joker') return `${nameP(l.p)}が ${cardLabel(l.c)} の所にジョーカーを置いた${l.up ? '。上がり！' : `（${nameP(l.owner)}は次にその札を出す）`}`;
  if (l.t === 'swap') return `${nameP(l.p)}が ${cardLabel(l.c)} を出してジョーカーを受け取った`;
  if (l.t === 'pass') return `${nameP(l.p)}がパス（${s.passes[l.p]}回目）`;
  return `${nameP(l.p)}がパスしすぎて失格。手札${l.cards.length}枚を場に並べた`;
}
