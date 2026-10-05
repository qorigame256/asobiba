// 七並べ。3〜6人。トランプ52枚（ジョーカーなし）を全部配り、7の札は最初に全部場に並べる。♦7 を持っていた人から始める。
// 自分の番に、場の札のとなり（同じマークで数字が1つ違う所）に1枚出すか、パスする。出せる札があってもパスしてよい。
// パスは詳細設定の回数まで（最初は3回）。それを超えてパスしたら失格で、その人の手札は全部場に並べる（2026-10-05 本人承認）。
// 手札を早くなくした順に順位が付き、失格した人は最後（あとで失格した人ほど上）。
// トンネル（詳細設定・最初はなし）: K と A をつながっているものとみなす（K が出ていれば A を、A が出ていれば K を出せる）。
// 決まりごと（Claude の判断）: 出せるのは「となりの数字がもう場にある」札。失格で並べた札のとなりにも出せる。
// 手: { p, t: 'play', c: 札 } / { p, t: 'pass' }

import { mulberry32, shuffle } from './util.js';
import { makeDeck, suitOf, rankOf, cardEl, cardLabel, SUITS, SUIT_MARK } from './cards.js';

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), field: { ...s.field }, passes: s.passes.slice(), done: s.done.slice(), outs: s.outs.slice() });
const ORDER = (c) => SUITS.indexOf(suitOf(c)) * 13 + rankOf(c);

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
  ],

  init(n, seed, { rules = {} } = {}) {
    const deck = shuffle(makeDeck(0), mulberry32(seed));
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
      n, maxPass: rules.passes === 5 ? 5 : 3, tunnel: rules.tunnel === true,
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
    if (m.t === 'play') {
      const i = s.hands[p].indexOf(m.c);
      if (i < 0 || !canPlace(s, m.c)) return null;
      s.hands[p].splice(i, 1);
      s.field[m.c] = 'play';
      s.last = { t: 'play', p, c: m.c };
      if (!s.hands[p].length) { s.done.push(p); s.last.up = true; }
    } else if (m.t === 'pass') {
      s.passes[p] += 1;
      if (s.passes[p] > s.maxPass) {
        for (const c of s.hands[p]) s.field[c] = 'out';
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
    const ok = hand.filter((c) => canPlace(s, c));
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
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) chip.append(tag('away', 'CPU が代わりに'));
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
        if (s.field[c]) {
          e = cardEl(c);
          if (s.field[c] === 'out') e.classList.add('sv-dumped');
          if (o.fresh && s.last?.t === 'play' && s.last.c === c) e.classList.add('pop');
        } else {
          e = document.createElement('div');
          e.className = 'pcard sv-empty' + (!res && canPlace(s, c) ? ' open' : '');
          e.textContent = r === 1 ? 'A' : r > 10 ? ['J', 'Q', 'K'][r - 11] : String(r);
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
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      const left = s.maxPass - s.passes[me];
      head.innerHTML = s.outs.includes(me) ? 'あなたは失格しました' : s.hands[me].length
        ? `あなたの手札 <small>${s.hands[me].length}枚・パスはあと${left}回${left === 0 ? '（次のパスで失格）' : ''}</small>`
        : 'あなたは上がりました！';
      root.append(head);
      const hand = document.createElement('div');
      hand.className = 'bb-hand sv-hand';
      for (const c of s.hands[me]) {
        const usable = o.canMove && canPlace(s, c);
        const e = cardEl(c, usable ? 'button' : 'div');
        if (usable) {
          e.classList.add('usable');
          e.onclick = () => o.onMove({ t: 'play', c });
        } else if (o.canMove) e.classList.add('dim');
        hand.append(e);
      }
      root.append(hand);
      if (o.canMove) {
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
  if (l.t === 'pass') return `${nameP(l.p)}がパス（${s.passes[l.p]}回目）`;
  return `${nameP(l.p)}がパスしすぎて失格。手札${l.cards.length}枚を場に並べた`;
}
