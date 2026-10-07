// ババ抜き（詳細設定でジジ抜きにもできる）。2〜10人。
// ババ抜き: トランプ52枚＋ジョーカー1枚を全部配る。ジジ抜き: ジョーカーを入れず、52枚から1枚を誰にも見せずに抜いて配る（抜いた札は最後に見せる）。
// 最初に、手札の同じ数字の2枚を全部捨てる。自分の番に、次の人（手札が残っている人）の札を裏のまま1枚引き、
// 同じ数字がそろえば2枚捨てる。手札がなくなった人から上がり。最後まで札を持っていた1人の負け。
// 引いた札は手札の中の決まらない位置に入る（ほかの人がどこにジョーカーが入ったか追えないように。位置は種から作るので全員同じ）。
// 手: { p, t: 'draw', i: 引く相手の手札の何枚目か }。番の決まったゲームなので、位置で表してよい。
// 詳細設定「同じ色でそろえる」（あり）: 同じ数字で同じ色（赤の♥♦どうし・黒の♠♣どうし）の2枚だけがそろう（最初に捨てる組も、引いたときも）。
//   どの数字も赤2枚・黒2枚なので、どの札にも相方がちょうど1枚ある。ジジ抜きでは抜いた札の相方（同じ数字・同じ色）が最後の1枚になる。
//   ありのときだけ局面に color: true を持つ（なしでは今までと全く同じ形）。
// 詳細設定「引く札を見せる」（あり。2026-10-07 の18回目の案）: 引く人は札を1回押して選び（つまむ）、もう一度押して引く。
//   つまんだ札は全員の画面で少し持ち上がり、引かれる人の画面では自分の手札のどの札か（表）が分かる（通話しながら駆け引きする）。
//   つまんだ位置は手の一覧に入れず、送りっぱなし（o.stream → onStream）。勝ち負けに関わらないので、届かなくても困らない。
//   CPU はつままずにすぐ引く。ありのときだけ局面に peek: true を持つ。

import { mulberry32, shuffle } from './util.js';
import { makeDeck, rankOf, suitOf, cardEl, backEl, cardLabel, JOKER } from './cards.js';

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), out: s.out.slice() });

// 引く札を見せる: いまつまんでいる札（{ key: 対局の種と何手目か, i: 引く相手の手札の何枚目か }）と、描き直し用の最後の画面
let peek = null;
let view = null;
const peekKey = (s) => `${s.seed}:${s.step}`;

const isRed = (c) => suitOf(c) === 'h' || suitOf(c) === 'd';
// a と b がそろうか（ジョーカーはそろわない。color なら色も同じでないとそろわない）
const pairs = (a, b, color) => a !== JOKER && b !== JOKER && rankOf(a) === rankOf(b) && (!color || isRed(a) === isRed(b));

// 手札からそろう2枚を全部抜く。抜いた札の一覧を返す
function dropPairs(hand, color) {
  const gone = [];
  const keep = [];
  for (const c of hand) {
    const j = keep.findIndex((x) => pairs(x, c, color));
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
    { key: 'color', label: '同じ色でそろえる', desc: '同じ数字でも、赤どうし（♥♦）・黒どうし（♠♣）でないと捨てられない', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'peek', label: '引く札を見せる', desc: '引く人は札を1回押してつまみ、もう一度押して引く。つまんだ札はみんなに見え、引かれる人には自分のどの札かが分かる（通話しながら駆け引き）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const jiji = rules.mode === 'jiji';
    const color = rules.color === 'on';
    let deck = shuffle(makeDeck(jiji ? 0 : 1), mulberry32(seed));
    let hidden = null;
    if (jiji) { hidden = deck[0]; deck = deck.slice(1); }
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, k) => hands[k % n].push(c));
    const first = hands.map((h) => dropPairs(h, color));
    const s = { n, seed, jiji, hidden, hands: first.map((x) => x.keep), out: [], turn: 0, step: 0, last: null, start: first.map((x) => x.gone.length / 2) };
    if (color) s.color = true; // なしのときは局面に何も足さない（今までと同じ形）
    if (rules.peek === 'on') s.peek = true;
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
    const j = mine.findIndex((x) => pairs(x, card, s.color));
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

  // 引く札を見せる: 引く人がつまんだ位置が届いたら、ゲームの画面だけ描き直す
  onStream(d, from) {
    const s = view?.s;
    if (!s?.peek || this.done(s) || from !== s.turn || d?.k !== s.step) return;
    const n = s.hands[this.victim(s)]?.length ?? 0;
    const i = d.i === null ? null : Number(d.i);
    if (i !== null && !(Number.isInteger(i) && i >= 0 && i < n)) return;
    peek = i === null ? null : { key: peekKey(s), i };
    if (view.root.isConnected) this.render(view.root, s, { ...view.o, fresh: false });
  },

  render(root, s, o) {
    view = { root, s, o };
    const me = o.me >= 0 ? o.me : null;
    const held = s.peek && peek?.key === peekKey(s) ? peek.i : null; // つままれている札の位置
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
      else if (o.sub?.[p]) chip.append(tag('away', 'CPU が代わりに'));
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
      head.textContent = o.canMove
        ? (s.peek ? `${nameP(from)}の札を押してつまみ、もう一度押して引く（つまんだ札はみんなに見えます）` : `${nameP(from)}の札から1枚えらんで引く`)
        : `${nameP(s.turn)}が ${nameP(from)}の札から引きます`;
      const row = document.createElement('div');
      row.className = 'bb-backs';
      s.hands[from].forEach((_, i) => {
        let e;
        if (o.canMove) {
          e = document.createElement('button');
          e.type = 'button';
          e.className = 'pcard back usable';
          e.setAttribute('aria-label', s.peek && held !== i ? `${i + 1}枚目をつまむ` : `${i + 1}枚目を引く`);
          e.onclick = () => {
            if (!s.peek || held === i) { peek = null; o.onMove({ t: 'draw', i }); return; }
            peek = { key: peekKey(s), i };
            o.stream?.({ k: s.step, i });
            this.render(root, s, { ...o, fresh: false });
          };
        } else {
          e = backEl();
        }
        if (held === i) e.classList.add('bb-held');
        row.append(e);
      });
      box.append(head, row);
      if (held !== null && me === from && s.hands[from][held] !== undefined) {
        const note = document.createElement('div');
        note.className = 'bb-head bb-held-note';
        note.textContent = `${nameP(s.turn)}がつまんでいるのは あなたの ${cardLabel(s.hands[from][held])}`;
        box.append(note);
      }
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
      head.innerHTML = `あなたの手札 <small>${s.hands[me].length ? s.hands[me].length + '枚' : '上がり！'}</small>`
        + (s.color ? ' <small>同じ数字・同じ色でそろいます</small>' : '');
      const hand = document.createElement('div');
      hand.className = 'bb-hand';
      // 同じ色でそろえるときは、同じ数字の中で黒・赤の順に並べる
      const order = (c) => (c === JOKER ? 99 : s.color ? rankOf(c) + (isRed(c) ? 0.5 : 0) : rankOf(c));
      for (const c of s.hands[me].slice().sort((a, b) => order(a) - order(b))) {
        const e = cardEl(c);
        if (o.fresh && s.last?.p === me && !s.last.pair && s.last.card === c) e.classList.add('pop');
        if (held !== null && me === from && s.hands[me][held] === c) e.classList.add('bb-held');
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
