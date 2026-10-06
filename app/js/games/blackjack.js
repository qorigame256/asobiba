// ブラックジャック。1〜6人がそれぞれ親（ディーラー。いつも CPU）と勝負する。お金は賭けず点数だけ。
// 持ち点100から始め、毎回10を賭ける。最初の2枚で21（ブラックジャック）なら1.5倍の15をもらえる。
// ダブル（賭けを倍にして1枚だけ引く）はあり。決めた回数（最初は5回）で持ち点が多い人の勝ち。
// 親は合計が17以上になったら引くのをやめる（ソフト17でも止まる）。以上は 2026-10-05 本人承認。
// スプリット（詳細設定。最初はなし。2026-10-06 本人承認）: 最初の2枚が同じ数字なら2つの手に分け、賭けもそれぞれ10。分けるのは1回だけ・
//   分けたあとのダブルはあり・A を分けたら1枚ずつ引いて終わり・分けたあとの21はブラックジャック扱いにしない。
//   作り（Claude の判断）: 1つ目の手を hands[p] で遊び、2つ目の手の最初の1枚は wait[p] で待たせる。1つ目が終わったら fin[p] へ移し、
//   2つ目の手に2枚目を配って hands[p] で遊ぶ。どちらの手の番かを手の h（0 / 1）に入れ、1つ目への手が2回届いても2つ目に効かないようにする。
// 決まりごと（Claude の判断）: 毎回52枚の新しい山を、対局の種と何回目かから作る。親の最初の2枚がブラックジャックなら、すぐに開いてその回は終わり
// （プレイヤーもブラックジャックなら引き分け）。プレイヤーは全員同時に動く。全員が終えたら親が引き、結果を4.5秒見せて次の回へ。
// 持ち点はマイナスになってもよい（最後まで遊べるように）。A は 1 か 11、J・Q・K は 10。
// 手: { p, t: 'hit', r: 何回目か, k: 引く前の手札の枚数, h } / { p, t: 'stand', r, h } / { p, t: 'double', r, h } / { p, t: 'split', r }
//   （h はスプリットした2つ目の手なら 1。無ければ 0）/ 進行役（p = -1）: { t: 'next', r }

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
// スプリットした手の21はブラックジャックにしない
const bjOf = (s, p, cards) => !s.sp?.[p] && isBJ(cards);
const handNo = (s, p) => (s.fin?.[p] ? 1 : 0);
export const canSplit = (s, p) => !!s.splitOn && !s.sp[p] && s.hands[p].length === 2 && rankOf(s.hands[p][0]) === rankOf(s.hands[p][1]);

const clone = (s) => ({
  ...s, hands: s.hands.map((h) => h.slice()), dealer: s.dealer.slice(), bets: s.bets.slice(), done: s.done.slice(), points: s.points.slice(), deck: s.deck,
  sp: s.sp.slice(), wait: s.wait.slice(), fin: s.fin.slice(),
});

// いまの手が終わった。スプリットの2つ目が待っていれば、そちらに2枚目を配って続ける
function handDone(s, p) {
  s.done[p] = true;
  if (!s.wait[p]) return;
  s.fin[p] = { c: s.hands[p], bet: s.bets[p] };
  s.hands[p] = [...s.wait[p], s.deck[s.pos++]];
  s.wait[p] = null;
  s.bets[p] = BET;
  s.done[p] = s.sp[p] === 'A' || total(s.hands[p]).v >= 21;
}

// 1つの手の勝ち負け（増えた点。負けはマイナス）
function gainOf(s, p, cards, bet) {
  const v = total(cards).v;
  const d = total(s.dealer).v;
  const dBJ = isBJ(s.dealer);
  if (v > 21) return -bet;
  if (bjOf(s, p, cards)) return dBJ ? 0 : Math.round(bet * 1.5);
  if (dBJ) return -bet;
  if (d > 21 || v > d) return bet;
  if (v === d) return 0;
  return -bet;
}

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
  s.sp = Array(s.n).fill(false);
  s.wait = Array(s.n).fill(null);
  s.fin = Array(s.n).fill(null);
  s.done = s.hands.map((h) => isBJ(h));
  s.phase = 'play';
  s.out = null;
  s.outFin = null;
  if (isBJ(s.dealer) || s.done.every(Boolean)) settle(s);
}

// 全員が終えたら親が引いて、勝ち負けを決める（スプリットした人は2つの手の合計）
function settle(s) {
  const alive = (p, h) => total(h).v <= 21 && !bjOf(s, p, h);
  const live = s.hands.some((h, p) => alive(p, h) || (s.fin[p] && alive(p, s.fin[p].c)));
  if (!isBJ(s.dealer) && live) while (total(s.dealer).v < 17) s.dealer.push(s.deck[s.pos++]);
  s.outFin = s.fin.map((f, p) => (f ? gainOf(s, p, f.c, f.bet) : null));
  s.out = s.hands.map((h, p) => gainOf(s, p, h, s.bets[p]) + (s.outFin[p] ?? 0));
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
    { key: 'split', label: 'スプリット', desc: '最初の2枚が同じ数字なら、2つの手に分けて別々に勝負できる（賭けもそれぞれ10。分けるのは1回だけ。A を分けたら1枚ずつで終わり）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, rounds: [3, 5, 10].includes(rules.rounds) ? rules.rounds : 5, splitOn: rules.split === true, round: 0, points: Array(n).fill(START), step: 0 };
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
    if (m.t === 'split') {
      if (!canSplit(s0, p)) return null;
      s.sp[p] = rankOf(hand[0]) === 1 ? 'A' : true;
      s.wait[p] = [hand[1]];
      s.hands[p] = [hand[0], s.deck[s.pos++]];
      if (s.sp[p] === 'A' || total(s.hands[p]).v >= 21) handDone(s, p);
    } else if ((m.h ?? 0) !== handNo(s0, p)) {
      return null;
    } else if (m.t === 'hit') {
      if (m.k !== hand.length) return null;
      hand.push(s.deck[s.pos++]);
      if (total(hand).v >= 21) handDone(s, p);
    } else if (m.t === 'stand') {
      handDone(s, p);
    } else if (m.t === 'double') {
      if (hand.length !== 2) return null;
      s.bets[p] = BET * 2;
      hand.push(s.deck[s.pos++]);
      handDone(s, p);
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
    const pr = rankOf(hand[0]);
    // スプリット: A と 8 はいつも、9 は親が 7・10・A 以外、2・3・6・7 は親が 2〜7 のとき（気まぐれで2割は分けない）
    const wantSplit = pr === 1 || pr === 8 || (pr === 9 && ![7, 10, 11].includes(upv)) || ([2, 3, 6, 7].includes(pr) && upv <= 7);
    if (canSplit(s, p) && wantSplit && Math.random() >= 0.2) return { t: 'split', r: s.round };
    if (hand.length === 2 && !soft && (v === 11 || (v === 10 && upv < 10))) act = 'double';
    else if (soft) act = v <= 17 || (v === 18 && upv >= 9) ? 'hit' : 'stand';
    else if (v <= 11) act = 'hit';
    else if (v <= 16) act = upv >= 7 ? 'hit' : 'stand';
    else act = 'stand';
    if (Math.random() < 0.15 && act !== 'double') act = act === 'hit' ? 'stand' : v < 19 ? 'hit' : 'stand';
    const h = handNo(s, p);
    return act === 'hit' ? { t: 'hit', r: s.round, k: hand.length, h } : { t: act, r: s.round, h };
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
      const stText = (cards, done, g) => {
        if (s.phase === 'result') {
          if (total(cards).v > 21) return `バースト <span class="pt-ng">${g}</span>`;
          return g > 0 ? `<span class="pt-ok">勝ち +${g}</span>` : g < 0 ? `<span class="pt-ng">負け ${g}</span>` : '引き分け ±0';
        }
        return done ? (total(cards).v > 21 ? 'バースト' : bjOf(s, p, cards) ? 'ブラックジャック！' : 'スタンド') : '考え中…';
      };
      const cardsRow = (cards, fresh) => {
        const row = document.createElement('div');
        row.className = 'bj-cards';
        cards.forEach((c, i) => {
          const e = cardEl(c);
          if (fresh && o.fresh && i === cards.length - 1 && cards.length > 2) e.classList.add('pop');
          row.append(e);
        });
        return row;
      };
      if (!s.sp[p]) {
        const g = s.phase === 'result' ? s.out[p] : 0;
        head.innerHTML = `<span class="bj-name">${esc(nameP(p))}</span> <b>${handText(h)}</b> <small>賭け${s.bets[p]}</small> ${stText(h, s.done[p], g)}`;
        box.append(head, cardsRow(h, true));
      } else {
        // スプリットした人: 名前の下に2つの手を並べる（待っている2つ目は1枚だけ）
        const sum = s.phase === 'result' ? ` 合計 ${s.out[p] > 0 ? '+' : ''}${s.out[p]}` : '';
        head.innerHTML = `<span class="bj-name">${esc(nameP(p))}</span> <small>スプリット</small>${sum}`;
        box.append(head);
        const part = (label, cards, bet, st, fresh) => {
          const sub = document.createElement('div');
          sub.className = 'bj-head bj-sub';
          sub.innerHTML = `${label} <b>${handText(cards)}</b> <small>賭け${bet}</small> ${st}`;
          box.append(sub, cardsRow(cards, fresh));
        };
        if (s.fin[p]) {
          const f = s.fin[p];
          part('1つ目', f.c, f.bet, stText(f.c, true, s.outFin?.[p] ?? 0), false);
          part('2つ目', h, s.bets[p], stText(h, s.done[p], s.phase === 'result' ? s.out[p] - (s.outFin[p] ?? 0) : 0), true);
        } else {
          part('1つ目', h, s.bets[p], stText(h, s.done[p], 0), true);
          part('2つ目', s.wait[p], BET, '待ち', false);
        }
      }
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
      const h = handNo(s, me);
      if (s.sp[me]) {
        const note = document.createElement('div');
        note.className = 'bj-note';
        note.textContent = `いま${h ? '2' : '1'}つ目の手`;
        acts.append(note);
      }
      btn('ヒット（1枚引く）', 'primary', { t: 'hit', r: s.round, k: s.hands[me].length, h });
      btn('スタンド（止める）', 'secondary', { t: 'stand', r: s.round, h });
      if (s.hands[me].length === 2) btn('ダブル（賭け2倍で1枚だけ）', 'secondary', { t: 'double', r: s.round, h });
      if (canSplit(s, me)) btn('スプリット（2つに分ける）', 'secondary', { t: 'split', r: s.round });
      root.append(acts);
    }
  },
};

function handText(cards) {
  const { v, soft } = total(cards);
  if (isBJ(cards)) return '21';
  return soft && v < 21 ? `${v - 10} / ${v}` : String(v);
}
