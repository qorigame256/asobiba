// スピード。2〜3人で同時に札を出し合う早い者勝ちのゲーム。
// 2人: プレイヤー0 は赤（♥♦）、プレイヤー1 は黒（♠♣）の26枚ずつ。
// 3人: 52枚をまぜて17枚ずつ配り、余った1枚は使わない（2026-10-05 本人の決定）。
// 手元に4枚を表向きに並べ、残りは自分の山。真ん中の台札は1人1か所（2人なら2か所、3人なら3か所）。
// どの台札の一番上とも、数字が1つ違う札（K と A もつながる）なら出せる。
// 手元が空いたら自分の山から自動で補充。まだ上がっていない全員が出せなくなったら「スピード！」で、それぞれ自分の山の一番上を
// 自分の台札に出し直す（山が無ければ手元の札から出す）。札を全部出し切った順に順位が付く。
// 2人なら先に出し切った方の勝ち。3人なら2人が出し切るまで続ける（本人の決定）。同時に出し切ったら同じ順位。
// 詳細設定「ジョーカー」（2026-10-06 本人の決定。最初はなし）: 2枚入れる。ジョーカーはどの台札にも出せて、ジョーカーの上にはどの札でも出せる。
//   2人なら1枚ずつ自分の山に入れて27枚ずつ、3人なら54枚を18枚ずつ配って余りが出ない（Claude の判断）。2枚目は 'JK2'（同じ札が2枚あると手で見分けられないため）。
// 手: { p, t: 'play', card: 出す札, pile: 台札の番号 } / { p, t: 'flip' }（スピード！）
// 札そのもので手を表すので、通信で同じ手が2回届いても2回目は反則として弾かれる（main.js の rebase が頼りにしている）。

import { mulberry32, shuffle } from './util.js';
import { rankOf, cardEl, cardLabel, isJoker, JOKER, JOKER2 } from './cards.js';

const SLOTS = 4;
const DELAYS = { slow: 2400, normal: 1500, fast: 900 };

function makeHalf(suits) {
  const d = [];
  for (const s of suits) for (let r = 1; r <= 13; r++) d.push(s + r);
  return d;
}

const fits = (card, top) => {
  if (isJoker(card) || isJoker(top)) return true; // ジョーカーはどこにでも出せ、ジョーカーの上にはどれでも出せる
  const d = Math.abs(rankOf(card) - rankOf(top));
  return d === 1 || d === 12; // K と A もつながる
};
const tops = (s) => s.piles.map((pl) => pl[pl.length - 1]);
const seats = (s) => s.piles.map((_, i) => i);
const active = (s) => seats(s).filter((p) => s.place[p] === null); // まだ上がっていない人

function movesOf(s, p) {
  const list = [];
  const t = tops(s);
  for (const card of s.fields[p]) {
    if (!card) continue;
    for (const pile of seats(s)) if (fits(card, t[pile])) list.push({ t: 'play', card, pile });
  }
  return list;
}

const stuck = (s) => active(s).every((p) => !movesOf(s, p).length);
const cardsLeft = (s, p) => s.decks[p].length + s.fields[p].filter(Boolean).length;
const over = (s) => active(s).length <= 1;

const clone = (s) => ({
  ...s, decks: s.decks.map((d) => d.slice()), fields: s.fields.map((f) => f.slice()), piles: s.piles.map((pl) => pl.slice()),
  place: s.place.slice(),
});

// 出し切った人に順位を付ける。同時に出し切った人は同じ順位。残りが1人になったら、その人が最下位
function checkEnd(s) {
  const done = active(s).filter((p) => cardsLeft(s, p) === 0);
  const rank = seats(s).length - active(s).length + 1;
  for (const p of done) s.place[p] = rank;
  const rest = active(s);
  if (done.length && rest.length === 1) s.place[rest[0]] = rank + done.length;
}

/* ---------- 画面 ---------- */

let chosen = null; // 両方の台札に出せる札を選んだとき { step, card }

export default {
  id: 'speed',
  name: 'スピード',
  icon: '⚡',
  desc: '2〜3人で同時に、真ん中の札と数字が1つ違う札をどんどん出す早い者勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 3,
  settings: [
    { key: 'joker', label: 'ジョーカー', desc: '2枚入れる。どの台札にも出せて、ジョーカーの上にはどの札でも出せる', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'cpu', label: 'CPU の速さ', desc: 'CPU が1枚出すまでの間。速いほど強い', def: 'slow', choices: [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    let decks;
    let aside = null;
    const jk = rules.joker === 'on';
    if (n === 3) {
      const all = shuffle([...makeHalf(['h', 'd', 's', 'c']), ...(jk ? [JOKER, JOKER2] : [])], rng);
      const per = jk ? 18 : 17;
      if (!jk) aside = all.pop();
      decks = [0, 1, 2].map((i) => all.slice(i * per, i * per + per));
    } else {
      decks = [shuffle([...makeHalf(['h', 'd']), ...(jk ? [JOKER] : [])], rng), shuffle([...makeHalf(['s', 'c']), ...(jk ? [JOKER2] : [])], rng)];
    }
    const fields = decks.map((d) => d.splice(-SLOTS));
    const piles = decks.map((d) => [d.pop()]);
    return { n, rules: { cpu: 'slow', ...rules }, decks, fields, piles, aside, place: decks.map(() => null), step: 0, last: null, flips: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !over(s) && (p === undefined || p < 0 || s.place[p] === null); },
  // ranking は順位の順。winner は1位が1人だけのときその人、draw は全員が同じ順位
  result(s) {
    if (!over(s)) return null;
    const ranking = seats(s).sort((a, b) => s.place[a] - s.place[b]);
    const firsts = ranking.filter((p) => s.place[p] === 1);
    const res = { winner: firsts.length === 1 ? firsts[0] : null, draw: firsts.length === ranking.length, ranking, place: s.place.slice() };
    // 3人で同じ順位がいるときの音（sound.js の endSound）: 1位は勝ち、ほかは負け。同着が無ければ 1位 勝ち・2位 引き分け・3位 負け
    if (ranking.length > 2 && !res.draw && new Set(s.place).size < ranking.length) res.winners = firsts;
    return res;
  },
  startSound: 'shuffle',
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) { return m.t === 'flip' ? 'draw' : 'card'; },
  cpuDelay(s) { return stuck(s) ? 1200 : DELAYS[s.rules.cpu] ?? DELAYS.slow; },

  resultText(res, me, pn) {
    if (res.draw) return '引き分け！';
    if (res.ranking.length > 2) {
      const order = res.ranking.map((p) => `${res.place[p]}位 ${pn(p)}`).join('・');
      if (me >= 0) return `あなたは${res.place[me]}位${res.place[me] === 1 ? '！🎉' : ''}（${order}）`;
      return order;
    }
    if (me >= 0) return res.winner === me ? 'あなたの勝ち！🎉' : 'あなたの負け…';
    return `${pn(res.winner)}の勝ち！`;
  },
  phaseText(s, me) {
    if (stuck(s)) return `${s.piles.length > 2 ? 'だれ' : 'どちら'}も出せません。「スピード！」を押してください`;
    if (me >= 0 && s.place[me] !== null) return `あなたは${s.place[me]}位で上がりました。ほかの人の勝負を見守ろう`;
    return '早い者勝ち！ 出せる札をどんどん出そう';
  },

  apply(s0, m) {
    if (!m || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.piles.length || !this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    const p = m.p;
    s.step += 1;
    if (m.t === 'play') {
      const slot = s.fields[p].indexOf(m.card);
      if (slot < 0 || !Number.isInteger(m.pile) || !s.piles[m.pile] || !fits(m.card, tops(s)[m.pile])) return null;
      s.piles[m.pile].push(m.card);
      s.fields[p][slot] = s.decks[p].length ? s.decks[p].pop() : null;
      s.last = { p, t: 'play', card: m.card, pile: m.pile };
    } else if (m.t === 'flip') {
      if (!stuck(s)) return null;
      for (const q of active(s)) {
        let card = s.decks[q].pop();
        if (!card) {
          const slot = s.fields[q].findIndex(Boolean);
          card = s.fields[q][slot];
          s.fields[q][slot] = null;
        }
        if (card) s.piles[q].push(card);
      }
      s.flips += 1;
      s.last = { p, t: 'flip' };
    } else {
      return null;
    }
    checkEnd(s);
    return s;
  },

  // CPU: 出せる札から適当に1枚（ジョーカーはほかに出せないときだけ）。速さは詳細設定の cpuDelay で決まる。自分だけ出せないときは待つ（null）
  cpu(s, p) {
    if (s.place[p] !== null) return null;
    const all = movesOf(s, p);
    const plain = all.filter((m) => !isJoker(m.card));
    const list = plain.length ? plain : all;
    if (!list.length) return stuck(s) ? { t: 'flip' } : null;
    const { card, pile } = list[Math.floor(Math.random() * list.length)];
    return { t: 'play', card, pile };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const n = s.piles.length;
    const bottom = me ?? 0;
    const others = seats(s).filter((p) => p !== bottom).sort((a, b) => ((a - bottom + n) % n) - ((b - bottom + n) % n));
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const can = o.canMove;
    if (!can || chosen?.step !== s.step) chosen = null;
    const draw = () => this.render(root, s, o);
    const t = tops(s);

    root.innerHTML = '';
    root.className = 'board sp';

    const side = (p, mine) => {
      const box = document.createElement('div');
      box.className = 'sp-side' + (mine ? ' mine' : '') + (n > 2 ? ' sp3' : '') + (s.place[p] === 1 ? ' won' : '');
      const head = document.createElement('div');
      head.className = 'sp-head';
      const left = cardsLeft(s, p);
      head.textContent = `${nameP(p)}${n === 2 ? (p === 0 ? '（赤）' : '（黒）') : ''}・残り${left}枚（山 ${s.decks[p].length}）`;
      if (s.place[p] !== null && n > 2) head.textContent = `${nameP(p)}・${s.place[p]}位${left ? `（残り${left}枚）` : 'で上がり'}`;
      if (o.away[p]) head.textContent += '・応答なし';
      else if (o.sub?.[p]) head.textContent += '・CPU が代わりに';
      const row = document.createElement('div');
      row.className = 'sp-row';
      for (const card of s.fields[p]) {
        if (!card) {
          const empty = document.createElement('div');
          empty.className = 'pcard sp-empty';
          row.append(empty);
          continue;
        }
        const piles = seats(s).filter((i) => fits(card, t[i]));
        const ok = mine && can && piles.length > 0;
        const e = cardEl(card, ok ? 'button' : 'div');
        if (ok) {
          e.classList.add('usable');
          e.onclick = () => {
            if (piles.length === 1) o.onMove({ t: 'play', card, pile: piles[0] });
            else { chosen = { step: s.step, card }; draw(); }
          };
        }
        if (chosen?.card === card) e.classList.add('selected');
        row.append(e);
      }
      box.append(head, row);
      return box;
    };

    for (const p of others) root.append(side(p, false));

    const center = document.createElement('div');
    center.className = 'sp-center';
    seats(s).forEach((i) => {
      const target = chosen && fits(chosen.card, t[i]);
      const e = cardEl(t[i], target ? 'button' : 'div');
      e.classList.add('sp-pile');
      if (target) {
        e.classList.add('target');
        e.onclick = () => { const card = chosen.card; chosen = null; o.onMove({ t: 'play', card, pile: i }); };
      }
      if (o.fresh && s.last?.pile === i && s.last.t === 'play') e.classList.add('pop');
      if (n > 2) {
        const slot = document.createElement('div');
        slot.className = 'sp-slot';
        const cap = document.createElement('span');
        cap.textContent = nameP(i); // 「スピード！」で札を出し直す人
        slot.append(e, cap);
        center.append(slot);
      } else center.append(e);
    });
    root.append(center);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (chosen) msg.textContent = `${cardLabel(chosen.card)} を${n > 2 ? 'どれ' : 'どちら'}に出しますか？ 光っている台札をタップ`;
    else if (s.last?.t === 'flip') msg.textContent = `${nameP(s.last.p)}が「スピード！」`;
    else if (s.last) msg.textContent = `${nameP(s.last.p)}が ${cardLabel(s.last.card)} を出した`;
    else msg.textContent = '光っている札をタップすると出せます';
    root.append(msg);

    if (can && stuck(s)) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary sp-flip';
      b.textContent = 'スピード！';
      b.onclick = () => o.onMove({ t: 'flip' });
      actions.append(b);
      root.append(actions);
    }

    root.append(side(bottom, me !== null));
  },
};
