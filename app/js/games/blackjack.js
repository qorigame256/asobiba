// ブラックジャック。1〜6人がそれぞれ親（ディーラー。いつも CPU）と勝負する。お金は賭けず点数だけ。
// 持ち点100から始め、毎回10を賭ける。最初の2枚で21（ブラックジャック）なら1.5倍の15をもらえる。
// ダブル（賭けを倍にして1枚だけ引く）はあり、スプリット（同じ数の2枚を分ける）はなし。決めた回数（最初は5回）で持ち点が多い人の勝ち。
// 親は合計が17以上になったら引くのをやめる（ソフト17でも止まる）。以上は 2026-10-05 本人承認。
// 決まりごと（Claude の判断）: 毎回52枚の新しい山を、対局の種と何回目かから作る。親の最初の2枚がブラックジャックなら、すぐに開いてその回は終わり
// （プレイヤーもブラックジャックなら引き分け）。プレイヤーは全員同時に動く。全員が終えたら親が引き、結果を4.5秒見せて次の回へ。
// 持ち点はマイナスになってもよい（最後まで遊べるように）。A は 1 か 11、J・Q・K は 10。
// 手: { p, t: 'hit', r: 何回目か, k: 引く前の手札の枚数 } / { p, t: 'stand', r } / { p, t: 'double', r } / 進行役（p = -1）: { t: 'next', r }

import { mulberry32, shuffle, esc } from './util.js';
import { makeDeck, rankOf, cardEl, backEl } from './cards.js';
import { scoreChips, leaders, ranks, winnersText, timeBar } from './party.js';

const BET = 10;
const START = 100;
const SHOW_MS = 4500;

export function total(cards) {
  let v = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 1) { aces++; v += 1; } else v += Math.min(10, r);
  }
  const soft = aces > 0 && v + 10 <= 21;
  return { v: soft ? v + 10 : v, soft };
}
const isBJ = (cards) => cards.length === 2 && total(cards).v === 21;

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), dealer: s.dealer.slice(), bets: s.bets.slice(), done: s.done.slice(), points: s.points.slice(), deck: s.deck });

function deal(s) {
  s.deck = shuffle(makeDeck(0), mulberry32((s.seed + s.round * 7919) >>> 0));
  s.pos = 0;
  const draw = () => s.deck[s.pos++];
  s.hands = Array.from({ length: s.n }, () => []);
  s.dealer = [];
  for (let k = 0; k < 2; k++) {
    for (let p = 0; p < s.n; p++) s.hands[p].push(draw());
    s.dealer.push(draw());
  }
  s.bets = Array(s.n).fill(BET);
  s.done = s.hands.map((h) => isBJ(h));
  s.phase = 'play';
  s.out = null;
  if (isBJ(s.dealer) || s.done.every(Boolean)) settle(s);
}

// 全員が終えたら親が引いて、勝ち負けを決める
function settle(s) {
  const live = s.hands.some((h) => total(h).v <= 21 && !isBJ(h));
  if (!isBJ(s.dealer) && live) while (total(s.dealer).v < 17) s.dealer.push(s.deck[s.pos++]);
  const d = total(s.dealer).v;
  const dBJ = isBJ(s.dealer);
  s.out = s.hands.map((h, p) => {
    const v = total(h).v;
    const bet = s.bets[p];
    let gain;
    if (v > 21) gain = -bet;
    else if (isBJ(h)) gain = dBJ ? 0 : Math.round(bet * 1.5);
    else if (dBJ) gain = -bet;
    else if (d > 21 || v > d) gain = bet;
    else if (v === d) gain = 0;
    else gain = -bet;
    return gain;
  });
  s.out.forEach((g, p) => { s.points[p] += g; });
  s.phase = 'result';
}

export default {
  id: 'blackjack',
  name: 'ブラックジャック',
  icon: '🂡',
  desc: '親（CPU）より21に近づける。21を超えたら負け。点数を賭けて決めた回数で勝負',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 1,
  maxPlayers: 6,
  settings: [
    { key: 'rounds', label: '回数', desc: 'この回数を遊んで、持ち点が多い人の勝ち', def: 5, choices: [[3, '3回'], [5, '5回'], [10, '10回']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, rounds: [3, 5, 10].includes(rules.rounds) ? rules.rounds : 5, round: 0, points: Array(n).fill(START), step: 0 };
    deal(s);
    return s;
  },

  ended(s) { return s.round >= s.rounds; },
  turn() { return null; },
  canAct(s, p) { return !this.ended(s) && s.phase === 'play' && p >= 0 && p < s.n && !s.done[p]; },
  referee(s) {
    if (this.ended(s) || s.phase !== 'result') return null;
    return { key: `res:${s.round}`, ms: SHOW_MS, move: { t: 'next', r: s.round } };
  },
  cpuDelay() { return 800; },
  startSound: 'shuffle',
  sound(a, b, m, me) {
    if (m.t === 'next') return 'shuffle';
    if (b.phase === 'result' && a.phase === 'play') return 'chip';
    return m.p === me ? 'card' : null;
  },

  result(s) {
    if (!this.ended(s)) return null;
    const winners = leaders(s.points);
    const rk = ranks(s.points);
    return { winner: winners[0], winners, ranking: Array.from({ length: s.n }, (_, p) => p).sort((a, b) => rk[a] - rk[b]) };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s, me) {
    if (s.phase === 'result') return `${s.round + 1}回目の結果`;
    if (me >= 0 && !s.done[me]) return `<b>あなたの番</b>です（${s.round + 1}/${s.rounds}回目）`;
    return `ほかの人を待っています…（${s.round + 1}/${s.rounds}回目）`;
  },

  apply(s0, m) {
    if (!m || this.ended(s0) || m.r !== s0.round) return null;
    if (m.p === -1) {
      if (m.t !== 'next' || s0.phase !== 'result') return null;
      const s = clone(s0);
      s.step += 1;
      s.round += 1;
      if (!this.ended(s)) deal(s);
      return s;
    }
    if (!Number.isInteger(m.p) || !this.canAct(s0, m.p)) return null;
    const p = m.p;
    const s = clone(s0);
    s.step += 1;
    const hand = s.hands[p];
    if (m.t === 'hit') {
      if (m.k !== hand.length) return null;
      hand.push(s.deck[s.pos++]);
      if (total(hand).v >= 21) s.done[p] = true;
    } else if (m.t === 'stand') {
      s.done[p] = true;
    } else if (m.t === 'double') {
      if (hand.length !== 2) return null;
      s.bets[p] = BET * 2;
      hand.push(s.deck[s.pos++]);
      s.done[p] = true;
    } else {
      return null;
    }
    if (s.done.every(Boolean)) settle(s);
    return s;
  },

  // CPU: よくある「基本の戦い方」を短くしたもの。15%は気まぐれに逆を選んで弱めている
  cpu(s, p) {
    const hand = s.hands[p];
    const { v, soft } = total(hand);
    const r0 = rankOf(s.dealer[0]); // 親の見えている札
    const upv = r0 === 1 ? 11 : Math.min(10, r0);
    let act;
    if (hand.length === 2 && !soft && (v === 11 || (v === 10 && upv < 10))) act = 'double';
    else if (soft) act = v <= 17 || (v === 18 && upv >= 9) ? 'hit' : 'stand';
    else if (v <= 11) act = 'hit';
    else if (v <= 16) act = upv >= 7 ? 'hit' : 'stand';
    else act = 'stand';
    if (Math.random() < 0.15 && act !== 'double') act = act === 'hit' ? 'stand' : v < 19 ? 'hit' : 'stand';
    return act === 'hit' ? { t: 'hit', r: s.round, k: hand.length } : { t: act, r: s.round };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board bj';

    root.append(scoreChips({ ...o, me }, s.points, { won: res ? res.winners : [] }));
    if (res) return;

    const showDealer = s.phase === 'result';
    const table = document.createElement('div');
    table.className = 'bj-table';
    const dealer = document.createElement('div');
    dealer.className = 'bj-dealer';
    const dHead = document.createElement('div');
    dHead.className = 'bj-head';
    dHead.innerHTML = `親（CPU）${showDealer ? ` <b>${handText(s.dealer)}</b>` : ''}`;
    const dCards = document.createElement('div');
    dCards.className = 'bj-cards';
    s.dealer.forEach((c, i) => dCards.append(showDealer || i === 0 ? cardEl(c) : backEl()));
    dealer.append(dHead, dCards);
    table.append(dealer);

    // プレイヤー（自分を最後に大きく）
    const seats = Array.from({ length: s.n }, (_, p) => p).filter((p) => p !== me);
    if (me !== null) seats.push(me);
    for (const p of seats) {
      const box = document.createElement('div');
      box.className = 'bj-player' + (p === me ? ' mine' : '');
      const head = document.createElement('div');
      head.className = 'bj-head';
      const h = s.hands[p];
      let st = s.done[p] ? (total(h).v > 21 ? 'バースト' : isBJ(h) ? 'ブラックジャック！' : 'スタンド') : '考え中…';
      if (s.phase === 'result') {
        const g = s.out[p];
        st = g > 0 ? `<span class="pt-ok">勝ち +${g}</span>` : g < 0 ? `<span class="pt-ng">負け ${g}</span>` : '引き分け ±0';
        if (total(h).v > 21) st = `バースト <span class="pt-ng">${g}</span>`;
      }
      head.innerHTML = `<span class="bj-name">${esc(nameP(p))}</span> <b>${handText(h)}</b> <small>賭け${s.bets[p]}</small> ${st}`;
      const cards = document.createElement('div');
      cards.className = 'bj-cards';
      h.forEach((c, i) => {
        const e = cardEl(c);
        if (o.fresh && i === h.length - 1 && h.length > 2) e.classList.add('pop');
        cards.append(e);
      });
      box.append(head, cards);
      table.append(box);
    }
    root.append(table);

    if (s.phase === 'result') {
      root.append(timeBar(`bj:${s.seed}:${s.round}`, SHOW_MS));
      return;
    }
    if (me !== null && o.canMove) {
      const acts = document.createElement('div');
      acts.className = 'cc-actions bj-acts';
      const btn = (text, cls, m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + cls;
        b.textContent = text;
        b.onclick = () => o.onMove(m);
        acts.append(b);
      };
      btn('ヒット（1枚引く）', 'primary', { t: 'hit', r: s.round, k: s.hands[me].length });
      btn('スタンド（止める）', 'secondary', { t: 'stand', r: s.round });
      if (s.hands[me].length === 2) btn('ダブル（賭け2倍で1枚だけ）', 'secondary', { t: 'double', r: s.round });
      root.append(acts);
    }
  },
};

function handText(cards) {
  const { v, soft } = total(cards);
  if (isBJ(cards)) return '21';
  return soft && v < 21 ? `${v - 10} / ${v}` : String(v);
}
