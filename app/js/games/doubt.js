// ダウト。3〜8人。トランプ52枚（ジョーカーなし）を全部配る。
// 出す数字は A → 2 → … → K → A と順番に決まっている。自分の番に、その数字だと言って手札を1〜4枚、裏向きで出す（うそでもよい）。
// 出したら決まった秒数（詳細設定）の間、ほかの人は誰でも「ダウト！」を押せる（2026-10-05 本人の決定）。
//   いちばん速く押した人（各自の画面に出てから押すまでの時間で比べる。届いた順ではない）の「ダウト」になり、出した札を表にする。
//   1枚でもうそなら出した人が、全部本当なら「ダウト」と言った人が、場の札を全部引き取る。
// 手札がなくなった人の勝ち（最後の札がダウトでうそと分かれば引き取るので、まだ続く）。
// 決まりごと（Claude の判断）: 全員が「ダウト」か「通す」を押したら秒数を待たずに締め切る。誰かがダウトを押したら、ほかの人の分を待つため1秒後に締め切る。
//   同じ速さなら、出した人の次の席から近い人。決着しないまま手が 400回を超えたら、手札がいちばん少ない人の勝ち。
// 詳細設定「前後どれでもよい」（free。2026-10-06 本人の決定）: 出す数字を、前の人が言った数字と同じ・1つ上・1つ下の3つから選べる（K の上は A、A の下は K）。
//   最初の1回は A だけ。ダウトで札を引き取ったあとも、直前に言った数字から続ける（局面の last）。手の n が言った数字で、選べない数字なら反則。
// 手: { p, t: 'play', cards: [札…], n: 言った数字（free のときだけ） } / { p, t: 'doubt', w: 何回目の出し札か, ms } / { p, t: 'pass', w } / { p: -1, t: 'close', w }（ホストの締め切り）
// 全員が同時に動く（realtime）。同じ手が2回来ても、札はもう手札に無い・同じ回には1回しか押せないので2回目は弾かれる。

import { mulberry32, shuffle, esc } from './util.js';
import { makeDeck, rankOf, rankLabel, cardEl, backEl, cardLabel } from './cards.js';
import { since, timeBar } from './party.js';

const MAX_PLAYS = 400;
const WINDOWS = { 3: 3000, 4: 4000, 6: 6000 };

const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), pile: s.pile.slice(), calls: { ...s.calls }, passed: s.passed.slice() });
const numOf = (s) => (s.plays % 13) + 1; // 次に出す数字（前後どれでもよい、がなしのとき）
// いま言える数字の一覧。なしなら1つ、ありなら「1つ下・同じ・1つ上」の3つ（最初の1回は A だけ）
const choicesOf = (s) => {
  if (!s.free) return [numOf(s)];
  if (!s.last) return [1];
  return [((s.last + 11) % 13) + 1, s.last, (s.last % 13) + 1];
};
const winKey = (s) => `dt:${s.seed}:${s.plays}`;

export default {
  id: 'doubt',
  name: 'ダウト',
  icon: '🤥',
  desc: '決まった数字だと言って札を伏せて出す。うそだと思ったら「ダウト！」。手札を先になくした人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 3,
  maxPlayers: 8,
  settings: [
    { key: 'window', label: 'ダウトの受付', desc: '札が出てから「ダウト！」を押せる秒数', def: 4, choices: [[3, '3秒'], [4, '4秒'], [6, '6秒']] },
    { key: 'free', label: '前後どれでもよい', desc: '出す数字を、前の人が言った数字と同じ・1つ上・1つ下から選べる（K の上は A。最初は A だけ）', def: false, choices: [[false, 'なし'], [true, 'あり']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const deck = shuffle(makeDeck(), mulberry32(seed));
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, k) => hands[k % n].push(c));
    return {
      n, seed, hands, pile: [], turn: 0, plays: 0, phase: 'play', played: null, calls: {}, passed: [],
      reveal: null, winner: null, limit: WINDOWS[rules.window] ?? 4000, step: 0, free: rules.free === true, last: 0,
    };
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) {
    if (s.phase === 'play') return p === s.turn;
    if (s.phase === 'doubt') return p >= 0 && p !== s.played.p && !(p in s.calls) && !s.passed.includes(p);
    return false;
  },
  phaseText(s, me) {
    if (s.phase !== 'doubt') return '';
    return me === s.played.p ? 'ダウトされるか…' : 'うそだと思ったら「ダウト！」';
  },
  startSound: 'shuffle',
  sound(a, b, m) {
    if (m.t === 'doubt') return 'call';
    if (m.t === 'close' && b.reveal?.by !== null) return b.reveal.lie ? 'correct' : 'wrong';
    if (m.t === 'play') return 'card';
    return null;
  },

  result(s) {
    if (s.phase !== 'end') return null;
    return { winner: s.winner };
  },
  // 札を表にしたあとは、見せるために少し長く待つ
  cpuDelay(s) {
    if (s.phase === 'doubt') return 900 + Math.floor(Math.random() * 1600);
    return s.reveal && s.reveal.by !== null ? 1800 : 700;
  },

  // 締め切りの合図。全員が決めたらすぐ、誰かがダウトしたら1秒後、それ以外は受付の秒数のあと
  referee(s) {
    if (s.phase !== 'doubt') return null;
    const others = s.n - 1;
    const decided = Object.keys(s.calls).length + s.passed.length;
    const move = { t: 'close', w: s.plays };
    if (decided >= others) return { key: `${s.plays}:all`, ms: 300, move };
    if (Object.keys(s.calls).length) return { key: `${s.plays}:call`, ms: 1000, move };
    return { key: `${s.plays}:wait`, ms: s.limit, move };
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.t === 'close') {
      if (m.p !== -1 || s0.phase !== 'doubt' || m.w !== s0.plays) return null;
      return close(s0);
    }
    if (!this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    s.step += 1;
    if (m.t === 'play') {
      if (s.phase !== 'play' || !Array.isArray(m.cards) || m.cards.length < 1 || m.cards.length > 4) return null;
      if (new Set(m.cards).size !== m.cards.length || !m.cards.every((c) => s.hands[m.p].includes(c))) return null;
      // 言った数字。なしのときは n を付けない今までの手でよい（付けるなら決まった数字だけ）
      const num = s.free ? m.n : m.n === undefined ? numOf(s) : m.n;
      if (!choicesOf(s).includes(num)) return null;
      s.hands[m.p] = s.hands[m.p].filter((c) => !m.cards.includes(c));
      s.pile.push(...m.cards);
      s.played = { p: m.p, cards: m.cards.slice(), num };
      s.last = num;
      s.phase = 'doubt';
      s.calls = {};
      s.passed = [];
      return s; // 前のダウトの結果（reveal）は、次の締め切りまで見せておく
    }
    if (m.t === 'doubt' || m.t === 'pass') {
      if (s.phase !== 'doubt' || m.w !== s.plays) return null;
      if (m.t === 'pass') { s.passed.push(m.p); return s; }
      if (typeof m.ms !== 'number' || !(m.ms >= 0)) return null;
      s.calls[m.p] = m.ms;
      return s;
    }
    return null;
  },

  cpu(s, p) {
    if (s.phase === 'doubt') {
      const pl = s.played;
      const have = s.hands[p].filter((c) => rankOf(c) === pl.num).length;
      const left = s.hands[pl.p].length;
      let chance = 0.06 + 0.06 * (pl.cards.length - 1);
      if (have + pl.cards.length > 4) chance = 0.9; // 自分の手札と合わせて5枚以上になる＝うそ
      else if (left === 0) chance = 0.6; // これで上がられてしまう
      else if (have === 3) chance = 0.5;
      if (Math.random() < chance) return { t: 'doubt', w: s.plays, ms: Math.round(since(winKey(s))) };
      return { t: 'pass', w: s.plays };
    }
    // 出す番: 本当の札があれば全部出し、ときどき1枚うそを混ぜる。無ければ、しばらく出番の来ない数字の札を1枚（ときどき2枚）
    // 前後どれでもよい、のときは、言える数字のうち手札に一番多い数字を選ぶ（2割は適当に選ぶ）
    const hand = s.hands[p];
    const opts = choicesOf(s);
    const count = (r) => hand.filter((c) => rankOf(c) === r).length;
    let num = opts[0];
    if (opts.length > 1) {
      if (Math.random() < 0.2) num = opts[Math.floor(Math.random() * opts.length)];
      else num = opts.reduce((a, b) => (count(b) > count(a) ? b : a));
    }
    const real = hand.filter((c) => rankOf(c) === num);
    // その数字の出番まであと何回（前後どれでもよい、のときは前にも後ろにも進めるので近い方）
    const wait = (c) => {
      const d = (rankOf(c) - num + 13) % 13;
      return s.free ? Math.min(d, 13 - d) : d;
    };
    const fake = hand.filter((c) => rankOf(c) !== num).sort((a, b) => wait(b) - wait(a));
    const said = s.free ? { n: num } : {};
    if (real.length) {
      const cards = real.slice(0, 4);
      if (cards.length < 4 && fake.length && Math.random() < 0.2) cards.push(fake[0]);
      return { t: 'play', cards, ...said };
    }
    const k = fake.length >= 2 && Math.random() < 0.25 ? 2 : 1;
    return { t: 'play', cards: fake.slice(0, k), ...said };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board db';

    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    for (const p of seats) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.phase === 'play' && s.turn === p ? ' turn' : '') + (res?.winner === p ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      const cnt = document.createElement('div');
      cnt.className = 'bb-count';
      cnt.textContent = `${s.hands[p].length}枚`;
      chip.append(name, cnt);
      if (s.phase === 'doubt' && p in s.calls) chip.append(tag('last', 'ダウト！'));
      else if (s.phase === 'doubt' && s.passed.includes(p)) chip.append(tag('away', '通す'));
      if (o.away[p]) chip.append(tag('away', '応答なし'));
      else if (o.sub?.[p]) chip.append(tag('away', 'CPU が代わりに'));
      opps.append(chip);
    }
    root.append(opps);

    // 場（出された札・次の数字）
    const field = document.createElement('div');
    field.className = 'db-field';
    const info = document.createElement('div');
    info.className = 'db-info';
    if (s.phase === 'doubt') {
      info.innerHTML = `<b>${esc(nameP(s.played.p))}</b>が「<span class="db-num">${rankLabel(s.played.num)}</span>」を <b>${s.played.cards.length}枚</b> 出した`;
    } else if (s.phase === 'play') {
      const opts = choicesOf(s).map((r) => `<span class="db-num">${rankLabel(r)}</span>`).join('・');
      const tail = s.free && s.last ? 'のどれか' : '';
      info.innerHTML = `次は「${opts}」${tail}　<small>場の札 ${s.pile.length}枚</small>`;
    } else {
      info.innerHTML = `<small>場の札 ${s.pile.length}枚</small>`;
    }
    field.append(info);
    const cards = document.createElement('div');
    cards.className = 'db-cards';
    if (s.phase === 'doubt') {
      for (const _ of s.played.cards) cards.append(backEl());
      if (o.fresh) cards.classList.add('pop');
    } else if (s.reveal && s.reveal.by !== null) {
      for (const c of s.reveal.cards) {
        const e = cardEl(c);
        if (rankOf(c) !== s.reveal.num) e.classList.add('lie');
        cards.append(e);
      }
    }
    if (cards.childElementCount) field.append(cards);
    root.append(field);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.innerHTML = logHtml(s, nameP);
    root.append(log);

    // ダウトの受付
    if (s.phase === 'doubt') {
      const key = winKey(s);
      root.append(timeBar(key, s.limit));
      if (o.canMove) {
        const row = document.createElement('div');
        row.className = 'cc-actions db-actions';
        row.append(
          button('通す', 'secondary', () => o.onMove({ t: 'pass', w: s.plays })),
          button('ダウト！', 'primary db-call', () => o.onMove({ t: 'doubt', w: s.plays, ms: Math.round(since(key)) })),
        );
        root.append(row);
      }
    }

    // 自分の手札
    if (me !== null) {
      const hand = s.hands[me];
      const can = o.canMove && s.phase === 'play';
      const opts = choicesOf(s);
      if (!can) { picked.clear(); pick.num = 0; }
      for (const c of [...picked]) if (!hand.includes(c)) picked.delete(c);
      // 言う数字。選べるのが1つだけならそれ。前の局面で選んだ数字が今は選べなければ選び直し
      if (opts.length === 1) pick.num = opts[0];
      else if (!opts.includes(pick.num)) pick.num = 0;
      const num = pick.num;
      const head = document.createElement('div');
      head.className = 'cc-hand-head';
      const guide = opts.length > 1 ? '・言う数字と、出す札を1〜4枚えらぶ' : `・「${rankLabel(opts[0])}」として出す札を1〜4枚えらぶ`;
      head.innerHTML = `あなたの手札 <small>${hand.length}枚${can ? guide : ''}</small>`;
      // 前後どれでもよい: 言う数字のボタン（1つ下・同じ・1つ上）
      let say = null;
      if (can && opts.length > 1) {
        say = document.createElement('div');
        say.className = 'cc-actions db-say';
        say.style.cssText = 'gap: 10px; margin-bottom: 8px;'; // 選んで浮いた札とくっつかないように
        for (const r of opts) {
          const b = button(rankLabel(r), num === r ? 'primary' : 'secondary', () => {
            pick.num = r;
            this.render(root, s, o);
          });
          b.style.cssText = 'min-width: 64px; min-height: 48px; font-size: 1.3rem;';
          b.setAttribute('aria-pressed', String(num === r));
          b.setAttribute('aria-label', `「${rankLabel(r)}」と言う`);
          say.append(b);
        }
      }
      const row = document.createElement('div');
      row.className = 'df-hand db-hand';
      // 光らせる（初心者マーク）のは、言う数字を選んでいればその数字、まだならどれかの数字の札
      const lit = num ? [num] : opts;
      for (const c of hand.slice().sort((a, b) => rankOf(a) - rankOf(b))) {
        const e = cardEl(c, can ? 'button' : 'div');
        if (lit.includes(rankOf(c)) && s.phase === 'play') e.classList.add('usable');
        if (picked.has(c)) e.classList.add('selected');
        if (can) {
          e.onclick = () => {
            if (picked.has(c)) picked.delete(c);
            else if (picked.size < 4) picked.add(c);
            this.render(root, s, o);
          };
        }
        row.append(e);
      }
      root.append(head);
      if (say) root.append(say);
      root.append(row);
      if (can) {
        const act = document.createElement('div');
        act.className = 'cc-actions';
        const text = !num ? '言う数字をえらんでください' : picked.size ? `「${rankLabel(num)}」として ${picked.size}枚 出す` : '札をえらんでください';
        const go = button(text, 'primary', () => {
          const cards = [...picked];
          picked.clear();
          pick.num = 0;
          o.onMove(s.free ? { t: 'play', cards, n: num } : { t: 'play', cards });
        });
        go.disabled = !picked.size || !num;
        act.append(go);
        root.append(act);
      }
    }
  },
};

// 締め切り。ダウトがあれば札を表にして、引き取る人を決める
function close(s0) {
  const s = clone(s0);
  s.step += 1;
  const pl = s.played;
  const callers = Object.keys(s.calls).map(Number);
  const dist = (q) => (q - pl.p + s.n) % s.n; // 出した人の次の席から近い順
  callers.sort((a, b) => s.calls[a] - s.calls[b] || dist(a) - dist(b));
  const by = callers.length ? callers[0] : null;
  const lie = pl.cards.some((c) => rankOf(c) !== pl.num);
  let taker = null;
  if (by !== null) {
    taker = lie ? pl.p : by;
    s.hands[taker].push(...s.pile);
    s.reveal = { by, p: pl.p, cards: pl.cards, num: pl.num, lie, taker, got: s.pile.length };
    s.pile = [];
  } else {
    s.reveal = { by: null, p: pl.p };
  }
  s.plays += 1;
  s.calls = {};
  s.passed = [];
  if (!s.hands[pl.p].length) {
    s.phase = 'end';
    s.winner = pl.p;
  } else if (s.plays >= MAX_PLAYS) {
    s.phase = 'end';
    const fewest = Math.min(...s.hands.map((h) => h.length));
    s.winner = s.hands.findIndex((h) => h.length === fewest);
  } else {
    s.phase = 'play';
    s.turn = (pl.p + 1) % s.n;
  }
  return s;
}

const picked = new Set(); // 出す札としてえらんでいる札（この端末だけ）
const pick = { num: 0 }; // 前後どれでもよい、で言う数字としてえらんでいる数字（この端末だけ。0 はまだ）

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function tag(cls, text) {
  const t = document.createElement('span');
  t.className = 'cc-tag ' + cls;
  t.textContent = text;
  return t;
}

function logHtml(s, nameP) {
  const r = s.reveal;
  const b = (p) => `<b>${esc(nameP(p))}</b>`;
  if (!r) return 'Aから順番に、言った数字の札を伏せて出します（うそでもよい）';
  if (r.by === null) return `ダウトなし。${b(r.p)}の札は通りました`;
  const what = r.cards.map(cardLabel).join(' ');
  if (r.lie) return `${b(r.by)}のダウト！ 中身は ${what}… <span class="pt-ng">うそ</span>でした。${b(r.taker)}が ${r.got}枚 引き取り`;
  return `${b(r.by)}のダウト！ 中身は ${what}… <span class="pt-ok">本当</span>でした。${b(r.taker)}が ${r.got}枚 引き取り`;
}
