// スピード。2人で同時に札を出し合う早い者勝ちのゲーム。
// プレイヤー0 は赤（♥♦）、プレイヤー1 は黒（♠♣）の26枚ずつ。手元に4枚を表向きに並べ、残りは自分の山。
// 真ん中の2か所（台札）の一番上と数字が1つ違う札（K と A もつながる）を、どちらの台札にも出せる。
// 手元が空いたら自分の山から自動で補充。2人とも出せなくなったら「スピード！」で、それぞれ自分の山の一番上を
// 自分の側の台札に出し直す（山が無ければ手元の札から出す）。先に札を全部出し切った方の勝ち。
// 手: { p, t: 'play', card: 出す札, pile: 0|1 } / { p, t: 'flip' }（スピード！）
// 札そのもので手を表すので、通信で同じ手が2回届いても2回目は反則として弾かれる（main.js の rebase が頼りにしている）。

import { mulberry32, shuffle } from './util.js';
import { rankOf, cardEl, cardLabel } from './cards.js';

const SLOTS = 4;
const DELAYS = { slow: 2400, normal: 1500, fast: 900 };

function makeHalf(suits) {
  const d = [];
  for (const s of suits) for (let r = 1; r <= 13; r++) d.push(s + r);
  return d;
}

const fits = (card, top) => {
  const d = Math.abs(rankOf(card) - rankOf(top));
  return d === 1 || d === 12; // K と A もつながる
};
const tops = (s) => s.piles.map((pl) => pl[pl.length - 1]);

function movesOf(s, p) {
  const list = [];
  const t = tops(s);
  for (const card of s.fields[p]) {
    if (!card) continue;
    for (const pile of [0, 1]) if (fits(card, t[pile])) list.push({ t: 'play', card, pile });
  }
  return list;
}

const stuck = (s) => !movesOf(s, 0).length && !movesOf(s, 1).length;
const cardsLeft = (s, p) => s.decks[p].length + s.fields[p].filter(Boolean).length;

const clone = (s) => ({
  ...s, decks: s.decks.map((d) => d.slice()), fields: s.fields.map((f) => f.slice()), piles: s.piles.map((pl) => pl.slice()),
});

function checkEnd(s) {
  const empty = [0, 1].filter((p) => cardsLeft(s, p) === 0);
  if (empty.length === 2) s.draw = true;
  else if (empty.length === 1) s.winner = empty[0];
}

/* ---------- 画面 ---------- */

let chosen = null; // 両方の台札に出せる札を選んだとき { step, card }

export default {
  id: 'speed',
  name: 'スピード',
  icon: '⚡',
  desc: '2人で同時に、真ん中の札と数字が1つ違う札をどんどん出す早い者勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 2,
  settings: [
    { key: 'cpu', label: 'CPU の速さ', desc: 'CPU が1枚出すまでの間。速いほど強い', def: 'slow', choices: [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    const decks = [shuffle(makeHalf(['h', 'd']), rng), shuffle(makeHalf(['s', 'c']), rng)];
    const fields = decks.map((d) => d.splice(-SLOTS));
    const piles = decks.map((d) => [d.pop()]);
    return { n, rules: { cpu: 'slow', ...rules }, decks, fields, piles, winner: null, draw: false, step: 0, last: null, flips: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.winner === null && !s.draw; },
  result(s) { return s.winner !== null || s.draw ? { winner: s.winner, draw: s.draw } : null; },
  cpuDelay(s) { return stuck(s) ? 1200 : DELAYS[s.rules.cpu] ?? DELAYS.slow; },

  resultText(res, me, pn) {
    if (res.draw) return '引き分け！';
    if (me >= 0) return res.winner === me ? 'あなたの勝ち！🎉' : 'あなたの負け…';
    return `${pn(res.winner)}の勝ち！`;
  },
  phaseText(s) {
    return stuck(s) ? 'どちらも出せません。「スピード！」を押してください' : '早い者勝ち！ 出せる札をどんどん出そう';
  },

  apply(s0, m) {
    if (!m || (m.p !== 0 && m.p !== 1) || !this.canAct(s0)) return null;
    const s = clone(s0);
    const p = m.p;
    s.step += 1;
    if (m.t === 'play') {
      const slot = s.fields[p].indexOf(m.card);
      if (slot < 0 || (m.pile !== 0 && m.pile !== 1) || !fits(m.card, tops(s)[m.pile])) return null;
      s.piles[m.pile].push(m.card);
      s.fields[p][slot] = s.decks[p].length ? s.decks[p].pop() : null;
      s.last = { p, t: 'play', card: m.card, pile: m.pile };
    } else if (m.t === 'flip') {
      if (!stuck(s)) return null;
      for (const q of [0, 1]) {
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

  // CPU: 出せる札から適当に1枚。速さは詳細設定の cpuDelay で決まる。自分だけ出せないときは待つ（null）
  cpu(s, p) {
    const list = movesOf(s, p);
    if (!list.length) return stuck(s) ? { t: 'flip' } : null;
    const { card, pile } = list[Math.floor(Math.random() * list.length)];
    return { t: 'play', card, pile };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const bottom = me ?? 0;
    const top = 1 - bottom;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const can = o.canMove;
    if (!can || chosen?.step !== s.step) chosen = null;
    const draw = () => this.render(root, s, o);
    const t = tops(s);

    root.innerHTML = '';
    root.className = 'board sp';

    const side = (p, mine) => {
      const box = document.createElement('div');
      box.className = 'sp-side' + (mine ? ' mine' : '') + (s.winner === p ? ' won' : '');
      const head = document.createElement('div');
      head.className = 'sp-head';
      const left = cardsLeft(s, p);
      head.textContent = `${nameP(p)}（${p === 0 ? '赤' : '黒'}）・残り${left}枚（山 ${s.decks[p].length}）`;
      if (o.away[p]) head.textContent += '・応答なし';
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) head.textContent += '・CPU が代わりに';
      const row = document.createElement('div');
      row.className = 'sp-row';
      for (const card of s.fields[p]) {
        if (!card) {
          const empty = document.createElement('div');
          empty.className = 'pcard sp-empty';
          row.append(empty);
          continue;
        }
        const piles = [0, 1].filter((i) => fits(card, t[i]));
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

    root.append(side(top, false));

    const center = document.createElement('div');
    center.className = 'sp-center';
    [0, 1].forEach((i) => {
      const target = chosen && fits(chosen.card, t[i]);
      const e = cardEl(t[i], target ? 'button' : 'div');
      e.classList.add('sp-pile');
      if (target) {
        e.classList.add('target');
        e.onclick = () => { const card = chosen.card; chosen = null; o.onMove({ t: 'play', card, pile: i }); };
      }
      if (o.fresh && s.last?.pile === i && s.last.t === 'play') e.classList.add('pop');
      center.append(e);
    });
    root.append(center);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (chosen) msg.textContent = `${cardLabel(chosen.card)} をどちらに出しますか？ 光っている台札をタップ`;
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
