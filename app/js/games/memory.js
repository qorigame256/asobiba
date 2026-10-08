// 神経衰弱。2〜8人。トランプを裏向きに並べ、順番に2枚ずつめくる。
// 同じ数字の2枚ならもらえて、続けてもう1回めくれる。違えば次の人へ（その2枚は次の人が1枚めくるまで表のまま見える）。
// 全部取り終わったとき、組の数が一番多い人の勝ち（同数なら同着）。
// 枚数（詳細設定）: 48 … A〜Q / 36 … A〜9 / 24 … A〜6（どれも4マーク分。ジョーカーなし）。
//   すき間のない長方形に並べるため、並べやすい枚数にした（本人の決定・2026-10-03。前は 52枚・26枚）。並べ方は SIZES の cols 列。
// 詳細設定「続けて取れる組」（2026-10-06 本人の決定）: 組を取って続けてめくれるのは決めた組の数まで。そこまで取ったら次の人へ。
// 詳細設定「見た札のヒント」（2026-10-06 本人の決定。子ども向けに簡単にする）: 一度めくった札は、伏せたあとも真ん中に小さく数字が残る（マークは出さない）。
// 詳細設定「色もそろえる」（2026-10-07 本人の決定。最初は なし）: 同じ数字でも、色（黒の♠♣・赤の♥♦）が同じ2枚でないと組にならない。
//   どの数字も黒2枚・赤2枚なので、組の数は同じ（枚数の半分）。ありのときだけ局面に color: true を持つ（なしでは今までと全く同じ形）。
//   見た札のヒントは、ありのとき数字を札の色で出す。CPU も同じ決まり（isPair）で組を探す。
// 詳細設定「13ならべ」（2026-10-07 本人の決定。最初は なし）: 同じ数字でなく、足して13になる2枚（A=1・J=11・Q=12）が組になる。
//   A〜Q のときだけ どの札にも相方があるので、ありのときは枚数の設定を見ず いつも48枚にする。数 r の札と 13−r の札は4枚ずつで、
//   1組取るとどちらも1枚ずつ減るので、必ず全部取り切れる。色もそろえると一緒なら「足して13で、色も同じ」（黒2枚・赤2枚ずつなので、これも取り切れる）。
//   ありのときだけ局面に thirteen: true を持つ（なしでは今までと全く同じ形）。画面には、めくった2枚の合計を「7＋6＝13 ⭕」のように出す。
// 詳細設定「札が見える時間」（2026-10-07 本人の決定。20回目の案。最初は「次の人がめくるまで」＝今まで）: 短い（1秒）では、はずれた2枚が
//   1秒たつと画面の上で裏に戻る（局面は今までどおり次の人がめくるまで open のまま。見せ方だけ変える。apply は時刻を使わない決まりのため）。
//   Claude の判断: 1枚目をめくって2枚目を選んでいる間は表のまま（自分でめくった札が消えると分かりにくいので）。0.5秒ではスマホで数字を読み切れないので1秒にした。
//   1秒は各端末が局面を画面に出したときから数える。ありのときだけ局面に short: true を持つ（なしでは今までと全く同じ形）。
// 手: { p, t: 'flip', i: 何枚目の札か }。めくった札がもう表なら反則なので、同じ手が2回来ても2回目は弾かれる。

import { mulberry32, shuffle } from './util.js';
import { makeDeck, rankOf, suitOf, rankLabel, cardEl, backEl, cardLabel } from './cards.js';

const SIZES = { 48: { top: 12, cols: 8 }, 36: { top: 9, cols: 6 }, 24: { top: 6, cols: 6 } };

const isRed = (c) => suitOf(c) === 'h' || suitOf(c) === 'd';
// 数字が合っているか（13ならべなら足して13、なしなら同じ数字）
const numOk = (s, a, b) => (s.thirteen ? rankOf(a) + rankOf(b) === 13 : rankOf(a) === rankOf(b));
// 組になる2枚か（色もそろえるなら、数字に加えて色も同じ2枚だけ）
const isPair = (s, a, b) => numOk(s, a, b) && (!s.color || isRed(a) === isRed(b));

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
    { key: 'color', label: '色もそろえる', desc: '同じ数字でも、色（黒の♠♣・赤の♥♦）が同じ2枚でないと取れない。覚えることが増えてむずかしくなる', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'thirteen', label: '13ならべ', desc: '同じ数字でなく、足して13になる2枚を取る（A=1・J=11・Q=12）。ありのときは枚数はいつも48枚（A〜Q）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'show', label: '札が見える時間', desc: 'はずれた2枚が表のまま見えている時間。短いと覚えるのがむずかしくなる', def: 'long', choices: [['long', '次の人がめくるまで'], ['short', '短い（1秒）']] },
    { key: 'streak', label: '続けて取れる組', desc: '組を取ったあと続けてめくれるのは、この数の組まで。覚えるのが得意な人の独走を防ぐ', def: 0, choices: [[0, '何組でも'], [2, '2組まで'], [3, '3組まで']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const thirteen = rules.thirteen === 'on';
    const { top } = SIZES[thirteen ? 48 : rules.size] ?? SIZES[48]; // 13ならべは A〜Q でないと相方の無い札が出るので48枚だけ
    const deck = makeDeck().filter((c) => rankOf(c) <= top);
    const cards = shuffle(deck, mulberry32(seed));
    const s = {
      n, cards, hint: rules.hint === 'on', limit: [2, 3].includes(rules.streak) ? rules.streak : 0, streak: 0, taken: Array(cards.length).fill(null), open: [], turn: 0, scores: Array(n).fill(0),
      seen: Array(cards.length).fill(false), done: false, step: 0, last: null,
    };
    if (rules.color === 'on') s.color = true; // なしのときは局面に何も足さない（今までと同じ形）
    if (thirteen) s.thirteen = true; // 13ならべも同じ
    if (rules.show === 'short') s.short = true; // 札が見える時間も同じ
    return s;
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
      const match = isPair(s, s.cards[a], s.cards[b]);
      s.last = { p: m.p, t: 'pair', a, b, match };
      if (!match && s.color && numOk(s, s.cards[a], s.cards[b])) s.last.hue = true; // 数字は合っているが色が違う
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

  // CPU: 見た札を覚えているが、1枚ごとに4割の見込みで忘れる（弱めるため）。覚えている札の中から組になる2枚を探す（13ならべなら足して13）
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
      const c = s.cards[fresh[0]];
      const j = memory.find((i) => isPair(s, c, s.cards[i]));
      return { t: 'flip', i: j ?? pickAny() };
    }
    for (const i of memory) {
      if (memory.some((j) => j !== i && isPair(s, s.cards[i], s.cards[j]))) return { t: 'flip', i };
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
      else if (o.sub?.[p]) chip.append(tag('away', 'CPU が代わりに'));
      opps.append(chip);
    }
    root.append(opps);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);
    if (s.thirteen) {
      // 13ならべ: めくった2枚の合計を小さく出す（「7＋6＝13 ⭕」）
      const sum = document.createElement('p');
      sum.className = 'cc-log mm-sum';
      sum.style.fontWeight = '800';
      sum.style.margin = '-6px 0 0';
      sum.textContent = sumText(s);
      root.append(sum);
    }

    const grid = document.createElement('div');
    const cols = SIZES[s.cards.length]?.cols ?? 8;
    grid.className = 'mm-grid' + (cols > 6 ? ' many' : '');
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.maxWidth = `${cols * 60}px`;
    const fresh = s.open.length === 2 ? [] : s.open;
    // 札が見える時間（短い）: はずれた2枚は、この端末で出してから SHORT_MS たったら裏に戻して描く
    let hidden = false;
    clearTimeout(missTimer); // 前に描いた局面の予約は捨てる（新しい局面で古い局面を描き直さないように）
    if (s.short && s.open.length === 2) {
      const key = `${s.step}:${s.open.join(',')}:${s.cards.join('')}`;
      if (missShown.key !== key) missShown = { key, at: Date.now() };
      const left = SHORT_MS - (Date.now() - missShown.at);
      hidden = left <= 0;
      if (!hidden) missTimer = setTimeout(() => { if (root.isConnected && missShown.key === key) this.render(root, s, o); }, left + 20);
    }
    s.cards.forEach((card, i) => {
      let e;
      if (s.taken[i] !== null) {
        e = cardEl(card);
        e.classList.add('taken');
      } else if (s.open.includes(i) && !hidden) {
        // 前の人がはずした2枚は、次の人がめくり直してもよい
        const again = can && s.open.length === 2;
        e = cardEl(card, again ? 'button' : 'div');
        e.classList.add('open');
        if (again) {
          e.classList.add('usable');
          e.onclick = () => o.onMove({ t: 'flip', i });
        }
        if (o.fresh && s.last && (s.last.i === i || s.last.b === i)) e.classList.add('pop');
      } else if (can && !fresh.includes(i)) { // 裏に戻したはずれの2枚も、ほかの裏の札と同じにめくれる
        e = document.createElement('button');
        e.type = 'button';
        e.className = 'pcard back usable';
        e.setAttribute('aria-label', `${i + 1}枚目をめくる`);
        e.onclick = () => o.onMove({ t: 'flip', i });
      } else {
        e = backEl();
      }
      if (s.hint && s.seen[i] && s.taken[i] === null && (!s.open.includes(i) || hidden)) {
        const h = document.createElement('span');
        h.className = 'mm-hint' + (s.color && isRed(card) ? ' red' : ''); // 色もそろえるなら色も分かるように
        h.textContent = rankLabel(rankOf(card));
        e.append(h);
      }
      if (o.fresh && s.last?.t === 'pair' && s.last.match && (s.last.a === i || s.last.b === i)) e.classList.add('got');
      grid.append(e);
    });
    root.append(grid);
  },
};

const SHORT_MS = 1000; // 札が見える時間（短い）
let missShown = { key: '', at: 0 }; // いま見せているはずれの2枚と、出した時刻（この端末だけ）
let missTimer = null;

function tag(cls, text) {
  const t = document.createElement('span');
  t.className = 'cc-tag ' + cls;
  t.textContent = text;
  return t;
}

function logText(s, nameP) {
  const l = s.last;
  if (!l) {
    const num = s.thirteen ? '足して13になる2枚（A=1・J=11・Q=12）' : '同じ数字';
    return s.color ? `裏向きの札を2枚めくって、${num}で同じ色（黒どうし・赤どうし）ならもらえます` : `裏向きの札を2枚めくって、${num}ならもらえます`;
  }
  if (l.t === 'flip') return `${nameP(l.p)}が ${cardLabel(s.cards[l.i])} をめくった。もう1枚…`;
  const pair = `${cardLabel(s.cards[l.a])} と ${cardLabel(s.cards[l.b])}`;
  if (l.match) return s.done ? `${nameP(l.p)}が ${pair} をそろえた！ これで全部です` : `${nameP(l.p)}が ${pair} をそろえた！ ${l.stop ? `${s.limit}組続けて取ったので次の人へ` : 'もう1回'}`;
  if (l.hue) return `${nameP(l.p)}は ${pair}… ${s.thirteen ? '足すと13でも' : '数字は同じでも'}色が違うので、はずれ`;
  return `${nameP(l.p)}は ${pair}… はずれ`;
}

// 13ならべの合計の一行。A・J・Q は数も添える（「Q(12)＋A(1)＝13 ⭕」）
function sumText(s) {
  const l = s.last;
  if (!l) return '';
  const num = (c) => {
    const r = rankOf(c);
    return r === 1 || r > 10 ? `${rankLabel(r)}(${r})` : String(r);
  };
  if (l.t === 'flip') return `${num(s.cards[l.i])}＋？＝13`;
  const a = s.cards[l.a];
  const b = s.cards[l.b];
  return `${num(a)}＋${num(b)}＝${rankOf(a) + rankOf(b)} ${l.match ? '⭕' : '❌'}`;
}
