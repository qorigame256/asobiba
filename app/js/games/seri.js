// せりあい（「ハゲタカのえじき」風。元の商品名は使わない）。2〜6人。
// 点数の札は -5〜-1 と 1〜10 の15枚。毎回1枚ずつ表にし、全員が手持ちの数字の札（1〜15。各1回ずつ使える）を同時に1枚出す。
// 同じ数字を出した人どうしは打ち消し合い、残った人の中で、点数の札がプラスなら一番大きい数を出した人が、
// マイナスなら一番小さい数を出した人が取る。全員が打ち消し合ったら、その点数の札は次の回に持ち越す（2026-10-05 本人承認）。
// 15回で終わり、取った点数の合計が多い人の勝ち。
// 決まりごと（Claude の判断）: 持ち越した札がたまったときは、いちばん新しく表にした札の向き（プラスかマイナスか）で決め、
// たまった札は全部まとめて取る。最後の回で持ち越しになった札は誰も取らない。
// 手: { p, t: 'bid', r: 何回目か（0から）, v: 出す数 }。r と「この回はもう出したか」で、同じ手が2回来ても2回目は反則になる。

import { mulberry32, shuffle, esc } from './util.js';
import { scoreChips, leaders, winnersText, ranks } from './party.js';

const POINTS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const BIDS = 15;
const clone = (s) => ({ ...s, bids: s.bids.slice(), hands: s.hands.map((h) => h.slice()), scores: s.scores.slice(), pot: s.pot.slice(), taken: s.taken.map((t) => t.slice()) });
const sum = (a) => a.reduce((x, y) => x + y, 0);

let sel = { key: null, v: null }; // 選び中の札（通信で描き直されても消えないように外に持つ）

export default {
  id: 'seri',
  name: 'せりあい',
  icon: '🦅',
  desc: '表になった点数の札を、数字の札を同時に出して競り落とす。同じ数字を出した人どうしは打ち消し合う',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,

  init(n, seed) {
    const deck = shuffle(POINTS, mulberry32(seed));
    return {
      n, deck, round: 0, pot: [deck[0]], bids: Array(n).fill(null),
      hands: Array.from({ length: n }, () => Array.from({ length: BIDS }, (_, i) => i + 1)),
      scores: Array(n).fill(0), taken: Array.from({ length: n }, () => []), last: null, step: 0,
    };
  },

  ended(s) { return s.round >= POINTS.length; },
  turn() { return null; },
  canAct(s, p) { return !this.ended(s) && p >= 0 && p < s.n && s.bids[p] === null; },
  cpuDelay() { return 1000; },
  startSound: 'shuffle',
  sound(a, b, m, me) {
    if (b.round > a.round) return 'chip';
    return m.p === me ? 'pop' : null;
  },

  result(s) {
    if (!this.ended(s)) return null;
    const winners = leaders(s.scores);
    const rk = ranks(s.scores);
    const ranking = Array.from({ length: s.n }, (_, p) => p).sort((a, b) => rk[a] - rk[b]);
    return { winner: winners[0], winners, ranking };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s, me) {
    const done = s.bids.filter((x) => x !== null).length;
    if (me >= 0 && s.bids[me] !== null) return `ほかの人を待っています…（${done}/${s.n}人）`;
    return `出す札を選んでください（${done}/${s.n}人が出した）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'bid' || !Number.isInteger(m.p) || !this.canAct(s0, m.p) || m.r !== s0.round) return null;
    if (!s0.hands[m.p].includes(m.v)) return null;
    const s = clone(s0);
    s.step += 1;
    s.bids[m.p] = m.v;
    s.hands[m.p] = s.hands[m.p].filter((x) => x !== m.v);
    if (s.bids.some((x) => x === null)) return s;

    // 全員出したら開く
    const counts = {};
    for (const v of s.bids) counts[v] = (counts[v] ?? 0) + 1;
    const alive = s.bids.map((v, p) => (counts[v] === 1 ? p : -1)).filter((p) => p >= 0);
    const card = s.pot[s.pot.length - 1];
    let who = -1;
    if (alive.length) {
      const pick = card > 0 ? Math.max(...alive.map((p) => s.bids[p])) : Math.min(...alive.map((p) => s.bids[p]));
      who = s.bids.indexOf(pick);
    }
    s.last = { round: s.round, bids: s.bids.slice(), pot: s.pot.slice(), who, cancel: s.bids.map((v) => counts[v] > 1) };
    if (who >= 0) {
      s.scores[who] += sum(s.pot);
      s.taken[who].push(...s.pot);
      s.pot = [];
    }
    s.round += 1;
    s.bids = Array(s.n).fill(null);
    if (!this.ended(s)) s.pot.push(s.deck[s.round]);
    else s.last.lost = s.pot.slice(); // 最後に持ち越した札は誰も取らない
    return s;
  },

  // CPU: 点数の札の大きさ（の絶対値）に見合う強さの札を、手持ちの中からぶれを足して選ぶ
  cpu(s, p) {
    const hand = s.hands[p];
    const val = Math.abs(sum(s.pot));
    // みんなが一番強い札に集まると打ち消し合うので、大きい札のときも上の方で散らす
    const want = Math.min(0.85, val / 12) * (hand.length - 1) + (Math.random() * 2 - 1) * Math.max(1, hand.length / 3);
    const i = Math.max(0, Math.min(hand.length - 1, Math.round(want)));
    return { t: 'bid', r: s.round, v: hand[i] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const draw = () => this.render(root, s, o);
    const key = `${s.round}:${s.n}`;
    if (sel.key !== key) sel = { key, v: null };
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board sr';

    root.append(scoreChips({ ...o, me }, s.scores, {
      won: res ? res.winners : [],
      extra: (p) => (res ? '' : s.bids[p] !== null ? '<span class="pt-ok">出した✓</span>' : '考え中…'),
    }));

    // 前の回の結果
    const L = s.last;
    if (L) {
      const box = document.createElement('div');
      box.className = 'sr-last' + (o.fresh ? ' pop' : '');
      const pot = L.pot.map(potText).join('・');
      const head = document.createElement('div');
      head.innerHTML = `${L.round + 1}回目（${pot}）: ` + (L.who >= 0 ? `<b>${esc(nameP(L.who))}</b>が取った` : '全員打ち消し合って、次の回に持ち越し');
      const row = document.createElement('div');
      row.className = 'sr-bids';
      L.bids.forEach((v, p) => {
        const e = document.createElement('span');
        e.className = 'sr-bid' + (L.cancel[p] ? ' cancel' : '') + (p === L.who ? ' win' : '');
        e.innerHTML = `${esc(nameP(p))} <b>${v}</b>`;
        row.append(e);
      });
      box.append(head, row);
      if (L.lost?.length) {
        const x = document.createElement('div');
        x.textContent = `最後に持ち越した ${L.lost.map(potText).join('・')} は誰も取れませんでした`;
        box.append(x);
      }
      root.append(box);
    }

    if (res) return;

    // いまの点数の札
    const now = document.createElement('div');
    now.className = 'sr-now';
    const card = s.pot[s.pot.length - 1];
    now.innerHTML = `<div class="um-label">${s.round + 1}回目 / ${POINTS.length}</div>`
      + `<div class="sr-pots">${s.pot.map((v) => `<span class="sr-point${v < 0 ? ' minus' : ''}">${potText(v)}</span>`).join('')}</div>`
      + `<small>${s.pot.length > 1 ? `持ち越し込みで合計 ${potText(sum(s.pot))}。` : ''}${card > 0 ? '一番<b>大きい</b>数を出した人が取る' : '一番<b>小さい</b>数を出した人が取る（取りたくない札）'}</small>`;
    root.append(now);

    if (me === null) return;
    const head = document.createElement('div');
    head.className = 'cc-hand-head';
    head.textContent = o.canMove ? '出す数字の札を選ぶ（同じ数字を出した人とは打ち消し合います）' : `${s.bids[me]} を出しました。ほかの人を待っています…`;
    root.append(head);
    const row = document.createElement('div');
    row.className = 'sr-hand';
    for (let v = 1; v <= BIDS; v++) {
      const has = s.hands[me].includes(v);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sr-card' + (sel.v === v ? ' on' : '') + (!has ? ' used' : '') + (s.bids[me] === v ? ' sent' : '');
      b.textContent = String(v);
      b.disabled = !has || !o.canMove;
      b.onclick = () => { sel.v = v; draw(); };
      row.append(b);
    }
    root.append(row);
    if (o.canMove) {
      const act = document.createElement('div');
      act.className = 'cc-actions';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn primary';
      ok.textContent = sel.v === null ? '札を選んでください' : `${sel.v} を出す`;
      ok.disabled = sel.v === null;
      ok.onclick = () => o.onMove({ t: 'bid', r: s.round, v: sel.v });
      act.append(ok);
      root.append(act);
    }
  },
};

const potText = (v) => (v > 0 ? '+' + v : String(v));
