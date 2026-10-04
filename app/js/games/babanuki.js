// ババ抜き（詳細設定でジジ抜きにもできる）。2〜10人。
// ババ抜き: トランプ52枚＋ジョーカー1枚を全部配る。ジジ抜き: ジョーカーを入れず、52枚から1枚を誰にも見せずに抜いて配る（抜いた札は最後に見せる）。
// 最初に、手札の同じ数字の2枚を全部捨てる。自分の番に、次の人（手札が残っている人）の札を裏のまま1枚引き、
// 同じ数字がそろえば2枚捨てる。手札がなくなった人から上がり。最後まで札を持っていた1人の負け。
// 引いた札は手札の中の決まらない位置に入る（ほかの人がどこにジョーカーが入ったか追えないように。位置は種から作るので全員同じ）。
// 手: { p, t: 'draw', i: 引く相手の手札の何枚目か }。番の決まったゲームなので、位置で表してよい。

import { mulberry32, shuffle } from './util.js';
import { makeDeck, rankOf, cardEl, backEl, cardLabel, JOKER } from './cards.js';

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), out: s.out.slice() });

// 手札から同じ数字の2枚を全部抜く。抜いた札の一覧を返す
function dropPairs(hand) {
  const gone = [];
  const keep = [];
  for (const c of hand) {
    const j = c === JOKER ? -1 : keep.findIndex((x) => x !== JOKER && rankOf(x) === rankOf(c));
    if (j >= 0) gone.push(keep.splice(j, 1)[0], c);
    else keep.push(c);
  }
  return { keep, gone };
}

// p の次で、手札が残っている人（いなければ -1）
function nextActive(s, p) {
  for (let k = 1; k < s.n; k++) {
    const q = (p + k) % s.n;
    if (s.hands[q].length) return q;
  }
  return -1;
}

export default {
  id: 'babanuki',
  name: 'ババ抜き',
  icon: '🤡',
  desc: 'となりの人の札を1枚ずつ引いて、そろった2枚を捨てる。最後にジョーカーを持っていた人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'mode', label: '遊び方', desc: 'ジジ抜きは、ジョーカーの代わりに誰も知らない1枚を抜いておく（どれが負けの札か最後まで分からない）', def: 'baba', choices: [['baba', 'ババ抜き'], ['jiji', 'ジジ抜き']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const jiji = rules.mode === 'jiji';
    let deck = shuffle(makeDeck(jiji ? 0 : 1), mulberry32(seed));
    let hidden = null;
    if (jiji) { hidden = deck[0]; deck = deck.slice(1); }
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, k) => hands[k % n].push(c));
    const first = hands.map((h) => dropPairs(h));
    const s = { n, seed, jiji, hidden, hands: first.map((x) => x.keep), out: [], turn: 0, step: 0, last: null, start: first.map((x) => x.gone.length / 2) };
    for (let p = 0; p < n; p++) if (!s.hands[p].length) s.out.push(p); // 配った時点で上がった人
    if (!s.hands[0].length) s.turn = nextActive(s, 0);
    return s;
  },

  // 手札が残っているのが1人になったら終わり
  done(s) { return s.hands.filter((h) => h.length).length <= 1; },
  turn(s) { return this.done(s) ? null : s.turn; },
  canAct(s, p) { return !this.done(s) && s.turn === p; },
  victim(s) { return nextActive(s, s.turn); },
  startSound: 'shuffle',
  sound(a, b) { return b.last?.pair ? 'card' : 'draw'; },

  result(s) {
    if (!this.done(s)) return null;
    const loser = s.hands.findIndex((h) => h.length);
    const ranking = [...s.out, ...(loser >= 0 ? [loser] : [])];
    return { winner: ranking[0], loser: loser >= 0 ? loser : null, ranking };
  },
  resultText(res, me, pn) {
    if (res.loser === null) return '全員上がり！';
    return res.loser === me ? 'あなたの負け…' : `${pn(res.loser)}の負け！`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'draw' || !this.canAct(s0, m.p)) return null;
    const from = this.victim(s0);
    if (from < 0 || !Number.isInteger(m.i) || m.i < 0 || m.i >= s0.hands[from].length) return null;
    const s = clone(s0);
    s.step += 1;
    const card = s.hands[from].splice(m.i, 1)[0];
    const mine = s.hands[m.p];
    const j = card === JOKER ? -1 : mine.findIndex((x) => x !== JOKER && rankOf(x) === rankOf(card));
    let pair = null;
    if (j >= 0) {
      pair = [mine.splice(j, 1)[0], card];
    } else {
      const rng = mulberry32((s.seed ^ (s.step * 2654435761)) >>> 0);
      mine.splice(Math.floor(rng() * (mine.length + 1)), 0, card);
    }
    s.last = { p: m.p, from, card, pair };
    if (!s.hands[from].length) s.out.push(from);
    if (!mine.length) s.out.push(m.p);
    if (!this.done(s)) s.turn = nextActive(s, m.p); // 次は引かれた人（上がっていればその次）
    return s;
  },

  cpu(s) { return { t: 'draw', i: Math.floor(Math.random() * s.hands[this.victim(s)].length) }; },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const from = res ? -1 : this.victim(s);
    root.innerHTML = '';
    root.className = 'board bb';

    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    for (const p of seats) {
      const chip = document.createElement('div');
      const rank = s.out.indexOf(p);
      chip.className = 'cc-opp' + (!res && s.turn === p ? ' turn' : '') + (rank === 0 ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      const cnt = document.createElement('div');
      cnt.className = 'bb-count';
      cnt.textContent = s.hands[p].length ? `${s.hands[p].length}枚` : '上がり';
      chip.append(name, cnt);
      if (rank >= 0) chip.append(tag('rank', `${rank + 1}抜け`));
      if (res?.loser === p) chip.append(tag('last', '負け'));
      if (!res && p === from) chip.append(tag('prev', '引かれる人'));
      if (o.away[p]) chip.append(tag('away', '応答なし'));
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) chip.append(tag('away', 'CPU が代わりに'));
      opps.append(chip);
    }
    root.append(opps);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP, me);
    root.append(log);

    // 引く相手の札（裏向き）。自分の番なら押して引く
    if (!res && from >= 0) {
      const box = document.createElement('div');
      box.className = 'bb-field';
      const head = document.createElement('div');
      head.className = 'bb-head';
      head.textContent = o.canMove ? `${nameP(from)}の札から1枚えらんで引く` : `${nameP(s.turn)}が ${nameP(from)}の札から引きます`;
      const row = document.createElement('div');
      row.className = 'bb-backs';
      s.hands[from].forEach((_, i) => {
        let e;
        if (o.canMove) {
          e = document.createElement('button');
          e.type = 'button';
          e.className = 'pcard back usable';
          e.setAttribute('aria-label', `${i + 1}枚目を引く`);
          e.onclick = () => o.onMove({ t: 'draw', i });
        } else {
          e = backEl();
        }
        row.append(e);
      });
      box.append(head, row);
      root.append(box);
    }

    if (res && s.jiji) {
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = `抜いておいた札は ${cardLabel(s.hidden)} でした`;
      root.append(p);
    }

    // 自分の手札（数字の順に並べて見せる。引かれる順番は見せている並びとは別）
    if (me !== null) {
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      head.innerHTML = `あなたの手札 <small>${s.hands[me].length ? s.hands[me].length + '枚' : '上がり！'}</small>`;
      const hand = document.createElement('div');
      hand.className = 'bb-hand';
      const order = (c) => (c === JOKER ? 99 : rankOf(c));
      for (const c of s.hands[me].slice().sort((a, b) => order(a) - order(b))) {
        const e = cardEl(c);
        if (o.fresh && s.last?.p === me && !s.last.pair && s.last.card === c) e.classList.add('pop');
        hand.append(e);
      }
      root.append(head, hand);
    }
  },
};

function tag(cls, text) {
  const t = document.createElement('span');
  t.className = 'cc-tag ' + cls;
  t.textContent = text;
  return t;
}

function logText(s, nameP, me) {
  const l = s.last;
  if (!l) {
    const n = me !== null ? s.start[me] : 0;
    return me !== null ? `配られた札のうち、そろっていた ${n}組を捨てました` : '配られた札のそろっていた組を捨てました';
  }
  const who = `${nameP(l.p)}が${nameP(l.from)}から1枚引いた`;
  if (l.pair) return `${who}。${cardLabel(l.pair[0])} と ${cardLabel(l.pair[1])} がそろって捨てた`;
  if (l.p === me) return `${who}。引いたのは ${cardLabel(l.card)}（そろわず）`;
  if (l.from === me) return `${who}。引かれたのは ${cardLabel(l.card)}`;
  return `${who}（そろわず）`;
}
