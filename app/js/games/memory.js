// 神経衰弱。2〜8人。トランプを裏向きに並べ、順番に2枚ずつめくる。
// 同じ数字の2枚ならもらえて、続けてもう1回めくれる。違えば次の人へ（その2枚は次の人が1枚めくるまで表のまま見える）。
// 全部取り終わったとき、組の数が一番多い人の勝ち（同数なら同着）。
// 枚数（詳細設定）: 48 … A〜Q / 36 … A〜9 / 24 … A〜6（どれも4マーク分。ジョーカーなし）。
//   すき間のない長方形に並べるため、並べやすい枚数にした（本人の決定・2026-10-03。前は 52枚・26枚）。並べ方は SIZES の cols 列。
// 詳細設定「続けて取れる組」（2026-10-06 本人の決定）: 組を取って続けてめくれるのは決めた組の数まで。そこまで取ったら次の人へ。
// 詳細設定「見た札のヒント」（2026-10-06 本人の決定。子ども向けに簡単にする）: 一度めくった札は、伏せたあとも真ん中に小さく数字が残る（マークは出さない）。
// 手: { p, t: 'flip', i: 何枚目の札か }。めくった札がもう表なら反則なので、同じ手が2回来ても2回目は弾かれる。

import { mulberry32, shuffle } from './util.js';
import { makeDeck, rankOf, rankLabel, cardEl, backEl, cardLabel } from './cards.js';

const SIZES = { 48: { top: 12, cols: 8 }, 36: { top: 9, cols: 6 }, 24: { top: 6, cols: 6 } };

const clone = (s) => ({ ...s, taken: s.taken.slice(), open: s.open.slice(), scores: s.scores.slice(), seen: s.seen.slice() });

/* ---------- 画面 ---------- */

export default {
  id: 'memory',
  name: '神経衰弱',
  icon: '🎴',
  desc: '裏向きのトランプを2枚ずつめくり、同じ数字をそろえる。覚えた人が勝つ',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 8,
  settings: [
    { key: 'size', label: '枚数', desc: 'すき間のない長方形に並べる', def: 48, choices: [[48, '48枚（A〜Q・8×6）'], [36, '36枚（A〜9・6×6）'], [24, '24枚（A〜6・6×4）']] },
    { key: 'hint', label: '見た札のヒント', desc: '一度めくった札は、伏せたあとも小さく数字が残る（覚えなくても取れるので、小さい子と遊ぶとき向け）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'streak', label: '続けて取れる組', desc: '組を取ったあと続けてめくれるのは、この数の組まで。覚えるのが得意な人の独走を防ぐ', def: 0, choices: [[0, '何組でも'], [2, '2組まで'], [3, '3組まで']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const { top } = SIZES[rules.size] ?? SIZES[48];
    const deck = makeDeck().filter((c) => rankOf(c) <= top);
    const cards = shuffle(deck, mulberry32(seed));
    return {
      n, cards, hint: rules.hint === 'on', limit: [2, 3].includes(rules.streak) ? rules.streak : 0, streak: 0, taken: Array(cards.length).fill(null), open: [], turn: 0, scores: Array(n).fill(0),
      seen: Array(cards.length).fill(false), done: false, step: 0, last: null,
    };
  },

  turn(s) { return s.done ? null : s.turn; },
  canAct(s, p) { return !s.done && s.turn === p; },
  startSound: 'shuffle',
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b) { return b.last?.t === 'pair' ? (b.last.match ? 'correct' : 'wrong') : 'card'; },
  result(s) {
    if (!s.done) return null;
    const best = Math.max(...s.scores);
    const winners = s.scores.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
    const ranking = Array.from({ length: s.n }, (_, p) => p).sort((a, b) => s.scores[b] - s.scores[a]);
    return { winner: winners[0], winners, ranking };
  },
  // はずれた2枚を見せる間は少し長く待つ
  cpuDelay(s) { return s.open.length === 2 ? 1300 : 650; },

  resultText(res, me, pn) {
    if (res.winners.includes(me)) {
      const others = res.winners.filter((p) => p !== me);
      return `あなたの勝ち！🎉${others.length ? `（${others.map(pn).join('・')}と同点）` : ''}`;
    }
    return `${res.winners.map(pn).join('・')}の勝ち！`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'flip' || !this.canAct(s0, m.p)) return null;
    const i = m.i;
    if (!Number.isInteger(i) || i < 0 || i >= s0.cards.length || s0.taken[i] !== null) return null;
    const s = clone(s0);
    if (s.open.length === 2) s.open = []; // 前の人がはずした2枚を伏せる
    if (s.open.includes(i)) return null;
    s.step += 1;
    s.open.push(i);
    s.seen[i] = true;
    s.last = { p: m.p, t: 'flip', i };
    if (s.open.length === 2) {
      const [a, b] = s.open;
      const match = rankOf(s.cards[a]) === rankOf(s.cards[b]);
      s.last = { p: m.p, t: 'pair', a, b, match };
      if (match) {
        s.taken[a] = m.p;
        s.taken[b] = m.p;
        s.scores[m.p] += 1;
        s.open = [];
        if (s.taken.every((x) => x !== null)) s.done = true;
        s.streak = (s.streak ?? 0) + 1;
        if (!s.done && s.limit && s.streak >= s.limit) { s.turn = (s.turn + 1) % s.n; s.streak = 0; s.last.stop = true; }
      } else {
        s.turn = (s.turn + 1) % s.n;
        s.streak = 0;
      }
    }
    return s;
  },

  // CPU: 見た札を覚えているが、1枚ごとに4割の見込みで忘れる（弱めるため）
  cpu(s, p) {
    const fresh = s.open.length === 2 ? [] : s.open; // この番にめくった札
    const left = s.cards.map((_, i) => i).filter((i) => s.taken[i] === null && !fresh.includes(i));
    const memory = left.filter((i) => s.seen[i] && Math.random() < 0.6);
    const unseen = left.filter((i) => !s.seen[i]);
    const pickAny = () => {
      const pool = unseen.length ? unseen : left;
      return pool[Math.floor(Math.random() * pool.length)];
    };
    if (fresh.length === 1) {
      const r = rankOf(s.cards[fresh[0]]);
      const j = memory.find((i) => rankOf(s.cards[i]) === r);
      return { t: 'flip', i: j ?? pickAny() };
    }
    for (const i of memory) {
      if (memory.some((j) => j !== i && rankOf(s.cards[j]) === rankOf(s.cards[i]))) return { t: 'flip', i };
    }
    return { t: 'flip', i: pickAny() };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const can = o.canMove;

    root.innerHTML = '';
    root.className = 'board mm';

    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    const res = this.result(s);
    for (const p of seats) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (!s.done && s.turn === p ? ' turn' : '') + (res?.winners.includes(p) ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      const score = document.createElement('div');
      score.className = 'mm-score';
      score.textContent = `${s.scores[p]}組`;
      chip.append(name, score);
      if (o.away[p]) chip.append(tag('away', '応答なし'));
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) chip.append(tag('away', 'CPU が代わりに'));
      opps.append(chip);
    }
    root.append(opps);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    const grid = document.createElement('div');
    const cols = SIZES[s.cards.length]?.cols ?? 8;
    grid.className = 'mm-grid' + (cols > 6 ? ' many' : '');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.maxWidth = `${cols * 60}px`;
    const fresh = s.open.length === 2 ? [] : s.open;
    s.cards.forEach((card, i) => {
      let e;
      if (s.taken[i] !== null) {
        e = cardEl(card);
        e.classList.add('taken');
      } else if (s.open.includes(i)) {
        // 前の人がはずした2枚は、次の人がめくり直してもよい
        const again = can && s.open.length === 2;
        e = cardEl(card, again ? 'button' : 'div');
        e.classList.add('open');
        if (again) {
          e.classList.add('usable');
          e.onclick = () => o.onMove({ t: 'flip', i });
        }
        if (o.fresh && s.last && (s.last.i === i || s.last.b === i)) e.classList.add('pop');
      } else if (can && !fresh.includes(i)) {
        e = document.createElement('button');
        e.type = 'button';
        e.className = 'pcard back usable';
        e.setAttribute('aria-label', `${i + 1}枚目をめくる`);
        e.onclick = () => o.onMove({ t: 'flip', i });
      } else {
        e = backEl();
      }
      if (s.hint && s.seen[i] && s.taken[i] === null && !s.open.includes(i)) {
        const h = document.createElement('span');
        h.className = 'mm-hint';
        h.textContent = rankLabel(rankOf(card));
        e.append(h);
      }
      if (o.fresh && s.last?.t === 'pair' && s.last.match && (s.last.a === i || s.last.b === i)) e.classList.add('got');
      grid.append(e);
    });
    root.append(grid);
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
  if (!l) return '裏向きの札を2枚めくって、同じ数字ならもらえます';
  if (l.t === 'flip') return `${nameP(l.p)}が ${cardLabel(s.cards[l.i])} をめくった。もう1枚…`;
  const pair = `${cardLabel(s.cards[l.a])} と ${cardLabel(s.cards[l.b])}`;
  if (l.match) return s.done ? `${nameP(l.p)}が ${pair} をそろえた！ これで全部です` : `${nameP(l.p)}が ${pair} をそろえた！ ${l.stop ? `${s.limit}組続けて取ったので次の人へ` : 'もう1回'}`;
  return `${nameP(l.p)}は ${pair}… はずれ`;
}
