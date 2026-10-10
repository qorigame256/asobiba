// ひたいカード（インディアンポーカー風）。2〜8人。毎回1人1枚ずつ配り、自分の札だけ見えない（ほかの人の札は見える）。
// チップ制（2026-10-06 本人承認）: 持ち点20。毎回の始めに全員が1点を場に出し、親から順番に「勝負（さらに2点）」か「降りる」を1回ずつ選ぶ。
// 勝負した人の中で一番強い札の人が、場の点を全部もらう。決めた回数（詳細設定）で持ち点が一番多い人の勝ち。
// Claude の判断: 強さは 2 < 3 < … < K < A（マークは関係ない）。いちばん強い札が2人以上なら山分けし、割り切れない分は次の回へ。
//   全員が降りたら、場の点は次の回へ持ち越す。持ち点が2点に足りない人は、残り全部で勝負できる。持ち点が0になった人は脱落。
//   親は毎回となりへ回る。札は毎回52枚から配り直す（seed と回の番号から）。
// 手: { p, t: 'bet' | 'fold' | 'next', r: 何回目か }。r が今の回と違う手は反則（同じ「次へ」が2回届いても1回だけ進む）。

import { mulberry32, shuffle } from './util.js';
import { rankOf, makeDeck, cardEl, backEl, cardLabel } from './cards.js';

const START = 20;
const ANTE = 1;
const BET = 2;
const power = (c) => (rankOf(c) === 1 ? 14 : rankOf(c)); // A が一番強い

const clone = (s) => ({ ...s, chips: s.chips.slice(), outOrder: s.outOrder.slice(), cards: s.cards.slice(), act: s.act.slice(), paid: s.paid.slice(), got: s.got.slice() });
const alive = (s) => Array.from({ length: s.n }, (_, p) => p).filter((p) => !s.outOrder.includes(p));
// 終わったときの順位（1から）。残った人は持ち点が同じなら同じ順位（同点優勝。2026-10-10 本人の決定）、脱落した人は後に脱落した人ほど上
const placeOf = (s, p) => (s.outOrder.includes(p) ? s.ranking.indexOf(p) + 1 : 1 + alive(s).filter((q) => s.chips[q] > s.chips[p]).length);

// 次の回を始める（親を回し、参加料を集めて配る）
function startRound(s) {
  s.round += 1;
  const live = alive(s);
  const order = Array.from({ length: s.n }, (_, k) => (s.dealer + 1 + k) % s.n).filter((p) => live.includes(p));
  s.dealer = order[0];
  const deck = shuffle(makeDeck(), mulberry32((s.seed ^ (s.round * 0x9e3779b9)) >>> 0));
  s.cards = Array(s.n).fill(null);
  s.act = Array(s.n).fill(null);
  s.paid = Array(s.n).fill(0);
  s.got = Array(s.n).fill(0);
  live.forEach((p, k) => {
    s.cards[p] = deck[k];
    const a = Math.min(ANTE, s.chips[p]);
    s.chips[p] -= a;
    s.paid[p] = a;
  });
  s.pot = s.carry + live.reduce((a, p) => a + s.paid[p], 0);
  s.carry = 0;
  s.phase = 'bet';
  s.toAct = s.dealer;
}

// 全員が選び終えたら勝負
function resolve(s) {
  const bettors = alive(s).filter((p) => s.act[p] === 'bet');
  s.phase = 'end';
  s.toAct = null;
  if (!bettors.length) {
    s.carry = s.pot;
    s.winners = [];
  } else {
    const top = Math.max(...bettors.map((p) => power(s.cards[p])));
    s.winners = bettors.filter((p) => power(s.cards[p]) === top);
    const share = Math.floor(s.pot / s.winners.length);
    for (const p of s.winners) { s.chips[p] += share; s.got[p] = share; }
    s.carry = s.pot - share * s.winners.length;
  }
  for (const p of alive(s)) if (s.chips[p] <= 0) s.outOrder.push(p);
  const live = alive(s);
  if (live.length <= 1 || s.round >= s.rules.rounds) {
    s.over = true;
    // 持ち点の多い順（同じなら席順に並べるが、順位は同じ。placeOf）。脱落した人は後に脱落した人ほど上
    const ranked = live.slice().sort((a, b) => s.chips[b] - s.chips[a] || a - b);
    s.ranking = [...ranked, ...s.outOrder.slice().reverse()];
  }
}

function nextToAct(s, from) {
  const live = alive(s);
  for (let k = 1; k <= s.n; k++) {
    const q = (from + k) % s.n;
    if (live.includes(q) && s.act[q] === null) return q;
  }
  return null;
}

let helpOpen = false;

function logText(s, nameP) {
  const L = s.last;
  if (!L) return `第${s.round}回。自分の札は見えません。ほかの人の札を見て、勝負するか決めてください`;
  if (L.t === 'bet') return `${nameP(L.p)}は勝負！（${L.amount}点）`;
  if (L.t === 'fold') return `${nameP(L.p)}は降りた`;
  if (L.t === 'next') return `第${s.round}回を始めます`;
  return '';
}

export default {
  id: 'hitai',
  name: 'ひたいカード',
  icon: '🤔',
  desc: '自分の札だけ見えない。ほかの人の札を見て、勝負するか降りるかを決める（インディアンポーカー風）',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 8,
  settings: [
    { key: 'rounds', label: '回数', desc: 'この回数で持ち点が一番多い人の勝ち（持ち点が0になった人は抜ける）', def: 10, choices: [[5, '5回'], [10, '10回'], [15, '15回']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = {
      n, seed, rules: { rounds: [5, 10, 15].includes(rules.rounds) ? rules.rounds : 10 }, chips: Array(n).fill(START), outOrder: [],
      round: 0, dealer: n - 1, carry: 0, pot: 0, cards: [], act: [], paid: [], got: [], winners: [],
      phase: 'bet', toAct: null, over: false, ranking: null, step: 0, last: null,
    };
    startRound(s);
    return s;
  },

  turn(s) { return s.over || s.phase === 'end' ? null : s.toAct; },
  canAct(s, p) {
    if (s.over) return false;
    if (s.phase === 'end') return alive(s).includes(p);
    return s.toAct === p;
  },
  result(s) {
    if (!s.over) return null;
    const places = s.ranking.map((p) => placeOf(s, p));
    const top = s.ranking.filter((p, i) => places[i] === 1);
    return top.length > 1 ? { winners: top, ranking: s.ranking, places } : { winner: top[0], ranking: s.ranking, places };
  },
  startSound: 'shuffle',
  sound(a, b, m) {
    if (m.t === 'next') return 'shuffle';
    if (b.phase === 'end' && a.phase !== 'end') return 'chip';
    return m.t === 'bet' ? 'chip' : 'pop';
  },
  cpuDelay(s) { return s.phase === 'end' ? 3200 : 700; }, // 札を見せる間は長めに

  resultText(res, me, pn) {
    const top = res.winners ?? [res.winner];
    if (me >= 0 && !top.includes(me)) return `あなたは${res.places[res.ranking.indexOf(me)]}位`;
    if (top.length > 1) return `${top.map(pn).join('・')}が同点で優勝！${top.includes(me) ? '🎉' : ''}`;
    return me >= 0 ? 'あなたの優勝！🎉' : `${pn(top[0])}の優勝！`;
  },
  phaseText(s) { return s.phase === 'end' ? `第${s.round}回の勝負がつきました` : ''; },

  apply(s0, m) {
    if (!m || !Number.isInteger(m.p) || m.r !== s0.round || !this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    const p = m.p;
    s.step += 1;
    if (s.phase === 'end') {
      if (m.t !== 'next') return null;
      s.last = { p, t: 'next' };
      startRound(s);
      return s;
    }
    if (m.t === 'bet') {
      const amount = Math.min(BET, s.chips[p]);
      s.chips[p] -= amount;
      s.paid[p] += amount;
      s.pot += amount;
      s.act[p] = 'bet';
      s.last = { p, t: 'bet', amount };
    } else if (m.t === 'fold') {
      s.act[p] = 'fold';
      s.last = { p, t: 'fold' };
    } else return null;
    const q = nextToAct(s, p);
    if (q === null) resolve(s); else s.toAct = q;
    return s;
  },

  // CPU: 自分の札は見ずに（見えない決まりなので）、まだ降りていない人の中で一番強い札より強い札を引いている見込みで決める。
  // 見込みが4割を超えれば勝負。弱めるため、2割は逆を選ぶ。勝負の後の「次へ」もここで出す。
  cpu(s, p) {
    if (s.phase === 'end') return { t: 'next', r: s.round };
    const others = alive(s).filter((q) => q !== p && s.act[q] !== 'fold');
    const seen = alive(s).filter((q) => q !== p).map((q) => s.cards[q]);
    const pool = makeDeck().filter((c) => !seen.includes(c)); // 自分の札の候補（見えていない札）
    const best = others.length ? Math.max(...others.map((q) => power(s.cards[q]))) : 0;
    const chance = pool.reduce((a, c) => a + (power(c) > best ? 1 : power(c) === best ? 0.5 : 0), 0) / pool.length;
    let bet = chance > 0.4;
    if (Math.random() < 0.2) bet = !bet;
    return { t: bet ? 'bet' : 'fold', r: s.round };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const shown = s.phase === 'end';
    root.innerHTML = '';
    root.className = 'board pk ht';

    const opps = document.createElement('div');
    opps.className = 'cc-opps pk-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (this.turn(s) === p ? ' turn' : '') + (s.ranking && placeOf(s, p) === 1 ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = (s.dealer === p ? 'Ⓓ ' : '') + o.names[p];
      const info = document.createElement('div');
      info.className = 'cc-opp-count';
      info.textContent = s.cards[p] ? `持ち点 ${s.chips[p]}` : '脱落';
      chip.append(name, info);
      if (s.cards[p]) {
        const row = document.createElement('div');
        row.className = 'pk-mini ht-card';
        row.append(cardEl(s.cards[p])); // ほかの人の札は見える
        chip.append(row);
      }
      const tags = [];
      if (s.got[p]) tags.push(['rank', `+${s.got[p]}`]);
      if (s.act[p] === 'bet') tags.push(['last', '勝負']);
      else if (s.act[p] === 'fold') tags.push(['away', '降りた']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
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
    table.innerHTML = `<div class="pk-pot">場の点 <b>${s.pot}</b>${s.carry && shown ? `（次の回へ ${s.carry}）` : ''}</div>`
      + `<div class="pk-meta">第${s.round}回 / ${s.rules.rounds}回・参加料 ${ANTE}・勝負 ${BET}</div>`;
    root.append(table);

    const log = document.createElement('p');
    log.className = 'cc-log';
    if (shown) {
      log.textContent = s.winners.length
        ? `${s.winners.map((p) => `${nameP(p)}（${cardLabel(s.cards[p])}）`).join('・')}の勝ち！ ${s.winners.length > 1 ? '山分け' : `${s.got[s.winners[0]]}点もらった`}`
        : '全員が降りたので、場の点は次の回へ持ち越し';
    } else log.textContent = logText(s, nameP);
    root.append(log);

    if (s.ranking) {
      const list = document.createElement('ol');
      list.className = 'df-ranking';
      for (const p of s.ranking) {
        const li = document.createElement('li');
        li.value = placeOf(s, p); // 同点は同じ番号
        li.textContent = `${nameP(p)}（持ち点 ${s.chips[p]}）`;
        list.append(li);
      }
      root.append(list);
    }

    if (me === null || !s.cards[me]) return;
    const head = document.createElement('div');
    head.className = 'cc-hand-head';
    head.textContent = `あなた（${s.dealer === me ? 'Ⓓ 親・' : ''}持ち点 ${s.chips[me]}）`;
    const now = document.createElement('small');
    now.textContent = shown ? `あなたの札は ${cardLabel(s.cards[me])} でした${s.got[me] ? `／ +${s.got[me]}` : ''}`
      : s.act[me] === 'bet' ? '勝負しました' : s.act[me] === 'fold' ? '降りました' : 'あなたの札は見えません（おでこに貼ってあるつもり）';
    head.append(now);
    root.append(head);

    const mine = document.createElement('div');
    mine.className = 'pk-hand ht-mine';
    if (shown) mine.append(cardEl(s.cards[me]));
    else { const b = backEl(); b.classList.add('ht-hidden'); b.textContent = '？'; mine.append(b); }
    root.append(mine);

    if (o.canMove && s.phase === 'bet') {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const amount = Math.min(BET, s.chips[me]);
      const bet = document.createElement('button');
      bet.type = 'button';
      bet.className = 'btn';
      bet.textContent = `勝負する（${amount}点）`;
      bet.onclick = () => o.onMove({ t: 'bet', r: s.round });
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'btn secondary';
      fold.textContent = '降りる';
      fold.onclick = () => o.onMove({ t: 'fold', r: s.round });
      actions.append(bet, fold);
      root.append(actions);
    } else if (o.canMove && shown) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'btn';
      next.textContent = '次の回へ';
      next.onclick = () => o.onMove({ t: 'next', r: s.round });
      actions.append(next);
      root.append(actions);
    }

    const help = document.createElement('details');
    help.className = 'pk-help';
    help.open = helpOpen;
    help.ontoggle = () => { helpOpen = help.open; };
    help.innerHTML = '<summary>札の強さ</summary><p>2 がいちばん弱く、3・4…10・J・Q・K、A がいちばん強い。マークは関係ありません。</p>';
    root.append(help);
  },
};
