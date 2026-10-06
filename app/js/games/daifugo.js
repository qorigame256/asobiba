// 大富豪。3〜8人。トランプ52枚＋ジョーカー1枚を全部配り、手札を早く出し切った順に順位が付く。
// 強さ: 3 < 4 < … < K < A < 2。ジョーカーは1枚出しなら何にでも勝ち、組の中ではどの札の代わりにもなる。
// 手: { p, t: 'play', cards: [札…] } / { p, t: 'pass' } / { p, t: 'give', cards }（カード交換で上位が渡す札）
//     { p, t: 'seven', cards }（7渡しで次の人へ渡す札） / { p, t: 'ten', cards }（10捨てで捨てる札）
//
// ルールの細かい決めごと（どれも Claude の判断。変えるなら本人に確認）:
//   - 1回パスした人は、場が流れるまで出せない。全員がパスしたら場が流れ、最後に出した人から（上がっていれば次の人から）。
//   - 1戦目は ♦3 を持っている人から。2戦目からは前の大貧民から。
//   - 階段は同じマーク3枚以上の連番。K-A-2 はつながるが 2-3-4 はつながらない。
//     階段どうしは一番弱い札で比べる（革命中・11バック中は一番強い札で比べる）。
//   - 革命は同じ数字4枚以上（階段では起きない）。8切り・11バックは、出した組に 8・J が入っていれば起きる（階段も含む）。
//   - しばりは、ジョーカーを含まない組で、前の組とマークが全く同じときに掛かる（場が流れるまで続く）。
//   - スペ3返しで ♠3 を出すと場が流れる。反則上がりと都落ちで下位になった人は、先になった人ほど下。
//   - 5飛び（詳細設定。2026-10-06 本人の決定で、5の枚数だけ飛ばす）: 同じ数字の組は枚数（ジョーカーも5として数える）、階段は5が入っていれば1人。
//     飛ばされた人は「パスした」扱い（場が流れるまで出せない）。全員飛ばしたら場が流れて出した人から。8切りなどで場が流れるときは飛ばさない。
//   - 7渡し・10捨て（詳細設定。2026-10-06 本人の決定）: 出した7（10）の枚数ぶん必ず、好きな札を次の人（上がっていない人）へ渡す（捨てる）。
//     数え方は5飛びと同じ（同じ数字の組は枚数、階段は1枚）。手札が足りなければ全部。出した人が渡し終える（捨て終える）まで次へ進まない（s.pend）。
//     階段に7と10が両方入っていたら、渡してから捨てる。渡す・捨てるで手札がなくなったら上がり（反則上がりにしない）。出して上がったときは何もしない。
//     8切りなどで場が流れるときも、渡し終えてから流す。CPU は弱い札から渡す（捨てる）。
//   - 9リバース（詳細設定。2026-10-06 本人の決定）: 9を出すたびに順番の向き（s.dir）が入れ替わり、場が流れてもそのまま。枚数に関係なく1回
//     （階段に9があっても1回）。逆回りでは「次の人」（5飛び・7渡しの相手も）が反対どなりになる。8切りなどで流れるときも向きは変わる。
//   - カード交換: 大貧民の一番強い2枚 → 大富豪、大富豪が選んだ2枚 → 大貧民。4人以上なら貧民と富豪で1枚ずつも。
//     前の対局と顔ぶれが違うときは交換しない。

import { mulberry32, shuffle } from './util.js';
import { JOKER, SUITS, SUIT_MARK, suitOf, rankOf, rankLabel, makeDeck, cardEl, cardLabel } from './cards.js';

const power = (c) => {
  if (c === JOKER) return 16;
  const r = rankOf(c);
  return r <= 2 ? r + 13 : r; // A = 14, 2 = 15
};
const powerLabel = (p) => rankLabel(p > 13 ? p - 13 : p);
const sortHand = (h) => h.sort((a, b) => power(a) - power(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));

export function titles(n) {
  if (n === 3) return ['大富豪', '平民', '大貧民'];
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return '大富豪';
    if (i === n - 1) return '大貧民';
    if (i === 1) return '富豪';
    if (i === n - 2) return '貧民';
    return '平民';
  });
}

/* ---------- 組（場に出す札のまとまり） ---------- */

// 選んだ札をどういう組として読めるか。ジョーカー入りの階段は読み方が2通りになることがある
function readMeld(cards, rules) {
  const n = cards.length;
  const jokers = cards.filter((c) => c === JOKER).length;
  const plain = cards.filter((c) => c !== JOKER);
  const base = { n, cards: cards.slice(), jokers };
  if (!plain.length) return n === 1 ? [{ ...base, kind: 'set', lo: 16, hi: 16, solo: true, suits: [] }] : [];
  const pw = plain.map(power);
  const out = [];
  if (pw.every((p) => p === pw[0])) out.push({ ...base, kind: 'set', lo: pw[0], hi: pw[0], suits: plain.map(suitOf) });
  if (rules.stairs && n >= 3 && plain.every((c) => suitOf(c) === suitOf(plain[0])) && new Set(pw).size === pw.length) {
    const lo = Math.min(...pw);
    const hi = Math.max(...pw);
    const gaps = hi - lo + 1 - plain.length;
    if (gaps <= jokers) {
      const extra = jokers - gaps; // あまったジョーカーを上か下に付ける
      for (let below = 0; below <= extra; below++) {
        const L = lo - below;
        const H = hi + extra - below;
        if (L >= 3 && H <= 15) out.push({ ...base, kind: 'seq', lo: L, hi: H, suits: [suitOf(plain[0])] });
      }
    }
  }
  return out;
}

const contains = (m, p) => !m.solo && m.lo <= p && p <= m.hi;
const lockKey = (m) => (m.kind === 'seq' ? m.suits.slice() : m.suits.slice().sort());

function fitsLock(m, lock) {
  if (m.kind === 'seq') return lock.length === 1 && m.suits[0] === lock[0];
  const rest = lock.slice();
  for (const s of m.suits) {
    const i = rest.indexOf(s);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true; // 足りない分はジョーカーが埋める
}

const reversed = (s) => s.rev !== s.back;

function beats(m, s) {
  const f = s.field;
  if (!f) return true;
  if (m.kind !== f.kind || m.n !== f.n) return false;
  if (f.solo) return !!s.rules.spe3 && m.cards[0] === 's3';
  if (m.solo) return true;
  if (s.lock && !fitsLock(m, s.lock)) return false;
  if (m.kind === 'set') return reversed(s) ? m.lo < f.lo : m.lo > f.lo;
  return reversed(s) ? m.hi < f.hi : m.lo > f.lo;
}

// 出せる読み方のうち、いまの向きで一番強いもの（無ければ null）
function pickMeld(cards, s) {
  const ok = readMeld(cards, s.rules).filter((m) => beats(m, s));
  if (!ok.length) return null;
  return ok.sort((a, b) => (reversed(s) ? a.hi - b.hi : b.lo - a.lo))[0];
}

function combos(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [x, ...rest] = arr;
  return [...combos(rest, k - 1).map((c) => [x, ...c]), ...combos(rest, k)];
}

// 手札から作れる組の候補（場に出せるかは見ていない）
function candidates(hand, rules) {
  const out = [];
  const jk = hand.includes(JOKER);
  const byPow = new Map();
  for (const c of hand) if (c !== JOKER) byPow.set(power(c), [...(byPow.get(power(c)) ?? []), c]);
  for (const cs of byPow.values()) {
    for (let k = 1; k <= cs.length; k++) {
      for (const pick of combos(cs, k)) {
        out.push(pick);
        if (jk) out.push([...pick, JOKER]);
      }
    }
  }
  if (jk) out.push([JOKER]);
  if (rules.stairs) {
    for (const suit of SUITS) {
      const have = new Map(hand.filter((c) => suitOf(c) === suit).map((c) => [power(c), c]));
      for (let lo = 3; lo <= 13; lo++) {
        for (let hi = lo + 2; hi <= 15; hi++) {
          const cards = [];
          let miss = 0;
          for (let p = lo; p <= hi; p++) if (have.has(p)) cards.push(have.get(p)); else miss++;
          if (miss > (jk ? 1 : 0)) break;
          if (miss) cards.push(JOKER);
          if (cards.length >= 3) out.push(cards);
        }
      }
    }
  }
  return out;
}

function legalPlays(s, p) {
  const seen = new Set();
  const list = [];
  for (const cards of candidates(s.hands[p], s.rules)) {
    const key = cards.slice().sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    const m = pickMeld(cards, s);
    if (m) list.push(m);
  }
  return list;
}

/* ---------- 進行 ---------- */

const isActive = (s, p) => !s.out.includes(p) && !s.fouls.includes(p);

// from から k 人先の席（いまの向きで）
const seatAt = (s, from, k) => (((from + k * (s.dir ?? 1)) % s.n) + s.n) % s.n;

function nextActive(s, from) {
  for (let k = 1; k <= s.n; k++) {
    const q = seatAt(s, from, k);
    if (isActive(s, q)) return q;
  }
  return from;
}

function clearField(s) {
  s.field = null;
  s.by = null;
  s.passed = s.passed.map(() => false);
  s.lock = null;
  s.back = false;
}

// 次に出す人へ。パスしていない人がもう居なければ場を流す
function advance(s, from) {
  for (let k = 1; k <= s.n; k++) {
    const q = seatAt(s, from, k);
    if (!isActive(s, q) || s.passed[q]) continue;
    if (q === s.by) break;
    s.turn = q;
    return;
  }
  const leader = isActive(s, s.by) ? s.by : nextActive(s, s.by);
  clearField(s);
  s.turn = leader;
  s.last = { ...s.last, flowed: true };
}

function finishIfOver(s) {
  const rest = Array.from({ length: s.n }, (_, i) => i).filter((p) => isActive(s, p));
  if (rest.length > 1) return false;
  s.ranking = [...s.out, ...rest, ...s.fouls.slice().reverse()];
  s.phase = 'done';
  return true;
}

function validCards(cards, hand) {
  if (!Array.isArray(cards) || !cards.length) return false;
  const rest = hand.slice();
  for (const c of cards) {
    const i = rest.indexOf(c);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

const removeCards = (hand, cards) => hand.filter((c) => !cards.includes(c));

// p が上がる（都落ちも見る）
function goOut(s, p, last) {
  s.out.push(p);
  last.done = true;
  if (s.rules.miyako && s.prevRank && s.out.length === 1) {
    const king = s.prevRank.indexOf(0);
    if (king !== p && isActive(s, king)) { s.fouls.push(king); last.miyako = king; }
  }
}

// 場に出したあとの「流す」か「次の人へ」
function afterPlay(s, p, flow) {
  if (flow) {
    clearField(s);
    s.turn = isActive(s, p) ? p : nextActive(s, p);
  } else {
    advance(s, p);
  }
}

const clone = (s) => ({
  ...s, hands: s.hands.map((h) => h.slice()), passed: s.passed.slice(), out: s.out.slice(), fouls: s.fouls.slice(),
  gives: s.gives.slice(), swaps: s.swaps.slice(),
});

/* ---------- 画面 ---------- */

let sel = { key: null, cards: [] }; // 選んでいる札（通信で描き直されても消えないよう外に持つ）

const RULE_LIST = [
  { key: 'revolution', label: '革命', desc: '同じ数字4枚で、強さの順番が逆になる', def: true },
  { key: 'eight', label: '8切り', desc: '8を出すと場が流れ、出した人から始める', def: true },
  { key: 'stairs', label: '階段', desc: '同じマークで3枚以上の連番を出せる', def: true },
  { key: 'shibari', label: 'しばり', desc: '前と同じマークを出すと、場が流れるまでそのマークしか出せない', def: true },
  { key: 'exchange', label: 'カード交換', desc: '2戦目から、大富豪と大貧民（4人以上なら富豪と貧民も）が札を交換', def: true },
  { key: 'five', label: '5飛び', desc: '5を出すと、出した5の枚数だけ次の人を飛ばす（飛ばされた人はパスと同じ）', def: false },
  { key: 'seven', label: '7渡し', desc: '7を出すと、出した7の枚数だけ好きな札を次の人に渡す（必ず）', def: false },
  { key: 'ten', label: '10捨て', desc: '10を出すと、出した10の枚数だけ好きな札を捨てる（必ず）', def: false },
  { key: 'nine', label: '9リバース', desc: '9を出すと順番の向きが逆になる（次に9が出るまでそのまま）', def: false },
  { key: 'elevenBack', label: '11バック', desc: 'J を出すと、場が流れるまで強さの順番が逆になる', def: false },
  { key: 'spe3', label: 'スペ3返し', desc: 'ジョーカー1枚には ♠3 で勝てる', def: false },
  { key: 'miyako', label: '都落ち', desc: '大富豪が1番に上がれないと、その時点で大貧民になる', def: false },
  { key: 'foul', label: '反則上がり', desc: '2・ジョーカー・8（革命中は3）で上がると最下位', def: false },
];

function logText(s, nameP) {
  const L = s.last;
  if (!L) {
    if (s.phase === 'exchange') return 'カード交換: 下位の人の強い札は、上位の人へ自動で渡りました';
    return s.prevRank ? '前の大貧民から始めます' : '♦3 を持っている人から始めます';
  }
  let t;
  if (L.t === 'give' || L.t === 'seven') t = `${nameP(L.p)}が${nameP(L.to)}に${L.n}枚渡した${L.t === 'seven' ? '（7渡し）' : ''}`;
  else if (L.t === 'ten') t = `${nameP(L.p)}が${L.n}枚捨てた（10捨て）`;
  else if (L.t === 'pass') t = `${nameP(L.p)}はパス`;
  else t = `${nameP(L.p)}が ${L.cards.map(cardLabel).join(' ')} を出した`;
  if (L.effects?.length) t += `（${L.effects.join('・')}）`;
  if (L.foul) t += ' → 反則上がりで最下位';
  else if (L.done) t += ' → 上がり！';
  if (L.miyako !== undefined) t += ` → ${nameP(L.miyako)}は都落ち`;
  if (L.flowed) t += ' → 場が流れた';
  return t;
}

export default {
  id: 'daifugo',
  name: '大富豪',
  icon: '👑',
  desc: '強い札を出して手札を早くなくす。革命・8切りなどのルールは待合室で選べる',
  ready: true,
  multi: true,
  minPlayers: 3,
  maxPlayers: 8,
  settings: RULE_LIST,

  init(n, seed, { rules = {}, prev = null } = {}) {
    const deck = shuffle(makeDeck(1), mulberry32(seed));
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, i) => hands[i % n].push(c));
    hands.forEach(sortHand);
    const ok = Array.isArray(prev) && prev.length === n && prev.every(Number.isInteger) && new Set(prev).size === n;
    const s = {
      n, rules: { ...rules }, hands, field: null, by: null, passed: Array(n).fill(false), out: [], fouls: [],
      rev: false, back: false, lock: null, turn: 0, phase: 'play', gives: [], swaps: [],
      prevRank: ok ? prev.slice() : null, ranking: null, step: 0, last: null,
    };
    if (s.prevRank && rules.exchange) {
      const who = (r) => s.prevRank.indexOf(r);
      const pairs = [[who(0), who(n - 1), 2]];
      if (n >= 4) pairs.push([who(1), who(n - 2), 1]);
      for (const [hi, lo, k] of pairs) {
        const strong = hands[lo].slice(-k);
        hands[lo] = hands[lo].slice(0, -k);
        hands[hi] = sortHand([...hands[hi], ...strong]);
        s.swaps.push({ from: lo, to: hi, cards: strong });
        s.gives.push({ from: hi, to: lo, k });
      }
      s.phase = 'exchange';
    }
    s.turn = s.prevRank ? s.prevRank.indexOf(n - 1) : hands.findIndex((h) => h.includes('d3'));
    return s;
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) {
    if (s.phase === 'exchange') return s.gives[0].from === p;
    return s.phase === 'play' && s.turn === p;
  },
  result(s) { return s.phase === 'done' ? { winner: s.ranking[0], ranking: s.ranking } : null; },
  startSound: 'shuffle',
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) { return m.t === 'pass' ? 'pop' : m.t === 'play' && b.last?.effects?.length ? 'call' : 'card'; },
  carry(s, p) { return s.ranking.indexOf(p); },

  resultText(res, me, pn) {
    const t = titles(res.ranking.length);
    if (me >= 0) {
      const i = res.ranking.indexOf(me);
      return `あなたは${t[i]}（${i + 1}位）${i === 0 ? '🎉' : ''}`;
    }
    return `${pn(res.winner)}が大富豪！`;
  },
  phaseText(s, me, pn) {
    if (s.phase !== 'exchange') return '';
    const g = s.gives[0];
    return g.from === me ? 'カード交換: 渡す札を選んでください' : `カード交換中: ${pn(g.from)}が渡す札を選んでいます…`;
  },

  apply(s0, m) {
    if (!m || !Number.isInteger(m.p) || !this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    const p = m.p;
    s.step += 1;

    if (s.phase === 'exchange') {
      const g = s.gives[0];
      if (m.t !== 'give' || !validCards(m.cards, s.hands[p]) || m.cards.length !== g.k) return null;
      s.hands[p] = removeCards(s.hands[p], m.cards);
      s.hands[g.to] = sortHand([...s.hands[g.to], ...m.cards]);
      s.swaps.push({ from: p, to: g.to, cards: m.cards.slice() });
      s.gives.shift();
      if (!s.gives.length) s.phase = 'play';
      s.last = { p, t: 'give', to: g.to, n: g.k };
      return s;
    }

    if (s.pend) {
      // 7渡し・10捨て: 出した人が札を選ぶまで次へ進まない
      const pd = s.pend[0];
      const k = Math.min(pd.k, s.hands[p].length);
      if (m.t !== pd.t || !validCards(m.cards, s.hands[p]) || m.cards.length !== k) return null;
      s.hands[p] = removeCards(s.hands[p], m.cards);
      const last = { p, t: pd.t, n: k };
      if (pd.t === 'seven') {
        last.to = nextActive(s, p);
        s.hands[last.to] = sortHand([...s.hands[last.to], ...m.cards]);
      }
      s.last = last;
      s.pend = s.pend.slice(1);
      if (!s.hands[p].length) {
        s.pend = [];
        goOut(s, p, last);
        if (finishIfOver(s)) return s;
      }
      if (s.pend.length) return s;
      const flow = s.after;
      s.pend = null;
      s.after = null;
      afterPlay(s, p, flow);
      return s;
    }

    if (m.t === 'pass') {
      if (!s.field) return null; // 場が空のときは何か出す
      s.passed[p] = true;
      s.last = { p, t: 'pass' };
      advance(s, p);
      return s;
    }

    if (m.t !== 'play' || !validCards(m.cards, s.hands[p])) return null;
    const meld = pickMeld(m.cards, s);
    if (!meld) return null;
    const f = s.field;
    const effects = [];
    const last = { p, t: 'play', cards: meld.cards, effects };
    s.last = last;
    const foul = s.rules.foul && s.hands[p].length === meld.n
      && (meld.jokers > 0 || contains(meld, s.rev ? 3 : 15) || (s.rules.eight && contains(meld, 8)));

    s.hands[p] = removeCards(s.hands[p], meld.cards);
    if (s.rules.shibari && f && !f.solo && !s.lock && (meld.kind === 'seq' || (!meld.jokers && !f.jokers))
      && lockKey(meld).join() === lockKey(f).join()) {
      s.lock = lockKey(meld);
      effects.push('しばり ' + s.lock.map((x) => SUIT_MARK[x]).join(''));
    }
    s.field = meld;
    s.by = p;
    if (s.rules.revolution && meld.kind === 'set' && meld.n >= 4) { s.rev = !s.rev; effects.push(s.rev ? '革命' : '革命返し'); }
    if (s.rules.elevenBack && contains(meld, 11)) { s.back = !s.back; effects.push('11バック'); }
    if (s.rules.nine && contains(meld, 9)) { s.dir = -(s.dir ?? 1); effects.push('9リバース'); }
    let flow = false;
    if (s.rules.eight && contains(meld, 8)) { flow = true; effects.push('8切り'); }
    if (f?.solo && meld.cards[0] === 's3') { flow = true; effects.push('スペ3返し'); }

    if (!s.hands[p].length) {
      if (foul) { s.fouls.push(p); last.foul = true; } else goOut(s, p, last);
      if (finishIfOver(s)) return s;
    }
    if (!flow && s.rules.five && contains(meld, 5)) {
      const k = meld.kind === 'set' ? meld.n : 1;
      let done = 0;
      for (let j = 1; j < s.n && done < k; j++) {
        const q = seatAt(s, p, j);
        if (!isActive(s, q) || s.passed[q]) continue;
        s.passed[q] = true;
        done++;
      }
      if (done) effects.push(`5飛び（${done}人）`);
    }
    // 7渡し・10捨て: 上がっていなければ、札を選ぶまで出した人の番のまま
    const pend = [];
    const count = meld.kind === 'set' ? meld.n : 1;
    if (s.rules.seven && contains(meld, 7)) pend.push({ t: 'seven', k: count });
    if (s.rules.ten && contains(meld, 10)) pend.push({ t: 'ten', k: count });
    if (pend.length && s.hands[p].length) {
      for (const x of pend) effects.push(x.t === 'seven' ? '7渡し' : '10捨て');
      s.pend = pend;
      s.after = flow;
      return s;
    }
    afterPlay(s, p, flow);
    return s;
  },

  // CPU: 場が空なら弱い札から（なるべく枚数の多い組で）。場があれば勝てる中で一番弱い組。
  // 2・ジョーカーなど強い札は手札が多いうちは温存しがち。強くなりすぎないよう、ときどき適当に選ぶ。
  cpu(s, p) {
    const hand = s.hands[p];
    if (s.phase === 'exchange') return { t: 'give', cards: hand.slice(0, s.gives[0].k) };
    if (s.pend) {
      // 弱い札から（革命中は強さが逆。ジョーカーは最後まで残す）
      const k = Math.min(s.pend[0].k, hand.length);
      const plain = hand.filter((c) => c !== JOKER);
      const order = [...(reversed(s) ? plain.slice().reverse() : plain), ...hand.filter((c) => c === JOKER)];
      return { t: s.pend[0].t, cards: order.slice(0, k) };
    }
    const plays = legalPlays(s, p);
    if (!plays.length) return { t: 'pass' };
    const rev = reversed(s);
    const strength = (m) => (m.solo ? 99 : rev ? 18 - m.hi : m.lo);
    const precious = (m) => m.jokers > 0 || strength(m) >= 14;
    const pick = (m) => ({ t: 'play', cards: m.cards });
    const cheap = plays.filter((m) => !precious(m));
    if (Math.random() < 0.25) {
      const pool = cheap.length ? cheap : plays;
      return pick(pool[Math.floor(Math.random() * pool.length)]);
    }
    if (!s.field) {
      const pool = cheap.length ? cheap : plays;
      return pick(pool.reduce((a, b) => (strength(b) * 10 - b.n * 6 < strength(a) * 10 - a.n * 6 ? b : a)));
    }
    if (!cheap.length && hand.length > 4 && Math.random() < 0.6) return { t: 'pass' };
    const pool = cheap.length ? cheap : plays;
    return pick(pool.reduce((a, b) => (strength(b) < strength(a) ? b : a)));
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const prevTitles = s.prevRank ? titles(s.n) : null;
    const endTitles = titles(s.n);
    const key = `${s.step}:${me}`;
    if (sel.key !== key) sel = { key, cards: [] };
    const draw = () => this.render(root, s, o);

    root.innerHTML = '';
    root.className = 'board df';

    // ほかの人
    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (this.canAct(s, p) ? ' turn' : '') + (s.ranking?.[0] === p ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = o.names[p];
      const count = document.createElement('div');
      count.className = 'cc-opp-count';
      count.innerHTML = `<span class="ccard mini back"></span>×${s.hands[p].length}`;
      chip.append(name, count);
      const tags = [];
      if (s.ranking) tags.push(['rank', `${s.ranking.indexOf(p) + 1}位 ${endTitles[s.ranking.indexOf(p)]}`]);
      else if (s.out.includes(p)) tags.push(['rank', `${s.out.indexOf(p) + 1}位で上がり`]);
      else if (s.fouls.includes(p)) tags.push(['away', '最下位']);
      else if (s.passed[p]) tags.push(['away', 'パス']);
      if (prevTitles && !s.ranking) tags.push(['prev', '前回 ' + prevTitles[s.prevRank[p]]]);
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

    // 場
    const field = document.createElement('div');
    field.className = 'df-field';
    const badges = [];
    if (s.rev) badges.push('革命中');
    if (s.back) badges.push('11バック中');
    if (s.dir === -1) badges.push('逆回り');
    if (s.lock) badges.push('しばり ' + s.lock.map((x) => SUIT_MARK[x]).join(''));
    if (badges.length) {
      const b = document.createElement('div');
      b.className = 'df-badges';
      for (const t of badges) {
        const e = document.createElement('span');
        e.textContent = t;
        b.append(e);
      }
      field.append(b);
    }
    const cards = document.createElement('div');
    cards.className = 'df-cards' + (o.fresh && s.last?.t === 'play' ? ' pop' : '');
    if (s.field) for (const c of s.field.cards) cards.append(cardEl(c));
    else cards.innerHTML = `<span class="df-empty">${s.phase === 'play' ? '場は空です（好きな組を出せます）' : ''}</span>`;
    field.append(cards);
    root.append(field);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    if (s.ranking) {
      const list = document.createElement('ol');
      list.className = 'df-ranking';
      s.ranking.forEach((p, i) => {
        const li = document.createElement('li');
        li.textContent = `${endTitles[i]}: ${nameP(p)}${s.fouls.includes(p) ? '（反則・都落ち）' : ''}`;
        list.append(li);
      });
      root.append(list);
    }

    if (me !== null) {
      const myTurn = o.canMove;
      const giving = myTurn && s.phase === 'exchange';
      const pd = myTurn && s.pend ? { ...s.pend[0], k: Math.min(s.pend[0].k, s.hands[me].length) } : null; // 7渡し・10捨て
      const legal = myTurn && s.phase === 'play' && !pd ? legalPlays(s, me) : [];
      const usable = new Set(legal.flatMap((m) => m.cards));
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      const myTitle = prevTitles && !s.ranking ? `・前回 ${prevTitles[s.prevRank[me]]}` : '';
      head.textContent = `あなたの手札（${s.hands[me].length}枚${myTitle}）`;
      const got = s.swaps.filter((x) => x.to === me);
      if (s.phase !== 'done' && got.length) {
        const g = document.createElement('small');
        g.textContent = '交換でもらった札: ' + got.flatMap((x) => x.cards).map(cardLabel).join(' ');
        head.append(g);
      }
      if (myTurn) {
        const hint = document.createElement('small');
        hint.textContent = giving
          ? `${nameP(s.gives[0].to)}に渡す札を${s.gives[0].k}枚選んで「渡す」`
          : pd ? (pd.t === 'seven' ? `7渡し: ${nameP(nextActive(s, me))}に渡す札を${pd.k}枚選んで「渡す」` : `10捨て: 捨てる札を${pd.k}枚選んで「捨てる」`)
          : legal.length ? '出す札を選んで「出す」。光っている札が使えます' : '出せる札がありません。「パス」を押してください';
        head.append(hint);
      }
      root.append(head);

      const hand = document.createElement('div');
      hand.className = 'df-hand';
      for (const c of s.hands[me]) {
        const can = giving || !!pd || usable.has(c);
        const e = cardEl(c, myTurn ? 'button' : 'div');
        if (can) e.classList.add('usable');
        if (sel.cards.includes(c)) e.classList.add('selected');
        if (myTurn) {
          e.onclick = () => {
            sel.cards = sel.cards.includes(c) ? sel.cards.filter((x) => x !== c) : [...sel.cards, c];
            draw();
          };
        }
        hand.append(e);
      }
      root.append(hand);

      if (myTurn) {
        const actions = document.createElement('div');
        actions.className = 'cc-actions';
        const btn = (text, variant, enabled, fn) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn ' + variant;
          b.textContent = text;
          b.disabled = !enabled;
          b.onclick = fn;
          actions.append(b);
        };
        if (giving) {
          btn('渡す', 'primary', sel.cards.length === s.gives[0].k, () => o.onMove({ t: 'give', cards: sel.cards }));
        } else if (pd) {
          btn(pd.t === 'seven' ? '渡す' : '捨てる', 'primary', sel.cards.length === pd.k, () => o.onMove({ t: pd.t, cards: sel.cards }));
        } else {
          const ok = sel.cards.length > 0 && !!pickMeld(sel.cards, s);
          btn('出す', 'primary', ok, () => o.onMove({ t: 'play', cards: sel.cards }));
          if (s.field) btn('パス', 'secondary', true, () => o.onMove({ t: 'pass' }));
        }
        if (sel.cards.length) btn('選び直す', 'ghost', true, () => { sel.cards = []; draw(); });
        root.append(actions);
      }
    }

    const rules = document.createElement('p');
    rules.className = 'df-rules';
    rules.textContent = 'ルール: ' + (RULE_LIST.filter((r) => s.rules[r.key]).map((r) => r.label).join('・') || 'なし');
    root.append(rules);
  },
};

