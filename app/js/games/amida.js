// あみだくじ陣取り。順番にあみだくじへ横線を足して、自分のスタートから点の高い当たりへ道をつなぐ。2〜4人・足りない分は CPU（弱め）。
// 2026-11-04 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 順番に「見える線」を2本ずつ引き、最後に全員がいっせいに「隠し線」を1本ずつ引く。そのあと光があみだをたどって結果を発表する。
//   - 下に点の違う当たり（5・3・2・1・0点）を並べ、3回戦の合計点で勝負。スタートの位置はくじで決める。
// Claude の判断:
//   - 縦線は5本・横線を引ける段は12段。回ごとに、はじめから黒い線を2本引いておく（どの回も同じ形から始まらないように）。
//   - 横線は、となりの縦線のあいだに引く。同じ段のとなりどうし（1本の縦線の左右）には引けない（あみだくじの決まり）。
//   - 見える線の順番は、1回目は席の1番から、回ごとに1人ずつずらす。1本引くごとに次の人へ回り、全員が2本ずつ引いたら隠し線へ。
//   - 隠し線はほかの人の画面に出さない（手札と同じ簡易の隠し方。全員の端末は知っている）。見える線とぶつかる所には引けない。
//     隠し線どうしがぶつかったら、席の番号の小さい人の線だけ残す（残らなかった線は結果の絵に点線で出す）。20秒で締め切り、引かなかった人は線なし。
//   - 当たりの並びとスタートの位置は種と何回目かから決める（全員同じ）。結果を見せる間は6.5秒（光がたどる絵は3秒）。
//   - 自分の今の道（線をたどった先）は、自分の画面にだけ細く出す（たどるのが苦手な人でも遊べるように）。
//   - CPU は引ける所を全部ためし、自分の点からほかの人のいちばん高い点の4割を引いた値がいちばん大きい所に引く。3割5分は適当な所に引く。
//     隠し線のときもほかの人の隠し線は見ない。
// 2026-11-04 の34回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「隠し線」（鍵は hide）: なし・1本（最初。前と同じ）・2本。2本では1人2本ずつ引き（自分の1本目とぶつかる所には引けない）、
//     ぶつかったときは席の番号の小さい人から、同じ人なら先に引いた線から残す。なしでは見える線を引き終えたら0.8秒で結果へ。
//   - 詳細設定「はずれ」（鍵は minus）: なし（最初）・あり。当たりの 0点を −3点にする（合計が0より下になることもある）。CPU の考え方は同じ。
// 手: { p, t: 'line', r, c } / { p, t: 'hide', r, c } / { p: -1, t: 'reveal' | 'next' }

import { mulberry32, shuffle } from './util.js';
import { scoreChips, leaders, winnersText, SEAT_COLORS } from './party.js';

export const COLS = 5;
export const ROWS = 12;
const ROUNDS = 3;
const PRIZES = [5, 3, 2, 1, 0];
const MINUS = -3; // はずれありのときの 0点の代わり
const HIDES = [[0, 'なし'], [1, '1本'], [2, '2本']];
const hidesOf = (rules) => (HIDES.some(([v]) => v === rules?.hide) ? rules.hide : 1);
const PRE = 2;
const HIDE_MS = 20000;
const SHOWN_MS = 6500;

const at = (lines, r, c) => lines.some((l) => l.r === r && l.c === c);
// r 段の c と c+1 のあいだに引けるか
export const canDraw = (lines, r, c) => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < ROWS && c >= 0 && c < COLS - 1
  && !at(lines, r, c) && !at(lines, r, c - 1) && !at(lines, r, c + 1);
// 上の start からたどって着く縦線の番号
export function trace(lines, start) {
  let c = start;
  for (let r = 0; r < ROWS; r++) {
    if (at(lines, r, c - 1)) c -= 1;
    else if (at(lines, r, c)) c += 1;
  }
  return c;
}
// たどった道（[縦線, 段] の折れ目の一覧。絵に使う）
function pathOf(lines, start) {
  const pts = [[start, -1]];
  let c = start;
  for (let r = 0; r < ROWS; r++) {
    const to = at(lines, r, c - 1) ? c - 1 : at(lines, r, c) ? c + 1 : c;
    if (to !== c) { pts.push([c, r], [to, r]); c = to; }
  }
  pts.push([c, ROWS]);
  return pts;
}
// その回のスタート・当たり・はじめの線（種と何回目かから。全員同じ）
export function setup(seed, round, n, minus = false) {
  const rnd = mulberry32((seed ^ Math.imul(round + 11, 0x9e3779b1)) >>> 0);
  const starts = shuffle([...Array(COLS).keys()], rnd).slice(0, n);
  const prizes = shuffle(PRIZES.slice(), rnd).map((v) => (minus && v === 0 ? MINUS : v));
  const lines = [];
  while (lines.length < PRE) {
    const r = 1 + Math.floor(rnd() * (ROWS - 2)), c = Math.floor(rnd() * (COLS - 1));
    if (canDraw(lines, r, c)) lines.push({ r, c, p: -1 });
  }
  return { starts, prizes, lines };
}
const clone = (s) => ({ ...s, lines: s.lines.slice(), hidden: s.hidden.slice(), scores: s.scores.slice() });
// 隠し線: 1本のときは { r, c } | null（前と同じ形）、2本のときは [{ r, c }…]。どちらもこれで一覧にする
const hidList = (h) => (h === null ? [] : Array.isArray(h) ? h : [h]);
const hidCount = (s) => s.hides ?? 1;
const hidDone = (s, p) => hidList(s.hidden[p]).length >= hidCount(s);
const signed = (v) => (v < 0 ? `−${-v}` : `+${v}`);
const pt = (v) => (v < 0 ? `−${-v}` : `${v}`);
const slots = (lines) => {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 1; c++) if (canDraw(lines, r, c)) out.push([r, c]);
  return out;
};
const prizeOf = (s, lines, p) => s.prizes[trace(lines, s.starts[p])];

let animated = ''; // 光がたどる絵を見せ終えた回（描き直しのたびに最初から光らせないように）

export default {
  id: 'amida',
  name: 'あみだくじ陣取り',
  icon: '🪜',
  desc: '順番にあみだくじへ線を足して、自分のスタートから高い点の当たりへ道をつなぐ',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 4,
  settings: [
    { key: 'hide', label: '隠し線', desc: '最後に全員がこっそり引く線の本数（なしは全部見えたまま）', def: 1, choices: HIDES },
    { key: 'minus', label: 'はずれ', desc: '当たりの 0点を −3点にする（ほかの人をはずれへ送る駆け引きが増える）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const minus = rules.minus === true, hides = hidesOf(rules);
    const { starts, prizes, lines } = setup(seed, 0, n, minus);
    const s = { n, seed, round: 0, starts, prizes, lines, first: 0, k: 0, hidden: Array(n).fill(null), phase: 'draw', scores: Array(n).fill(0), last: null, step: 0 };
    // 最初の値（1本・はずれなし）のときは前と全く同じ形にする
    if (hides !== 1) s.hides = hides;
    if (minus) s.minus = true;
    return s;
  },

  turn(s) { return s.phase === 'draw' ? (s.first + s.k) % s.n : null; },
  canAct(s, p) {
    if (s.phase === 'draw') return this.turn(s) === p;
    return s.phase === 'hide' && hidCount(s) > 0 && (p === undefined || !hidDone(s, p));
  },
  concurrent(s) { return s.phase === 'hide'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'reveal' ? 'call' : 'question';
    if (m.t === 'hide' && m.p !== me) return null;
    return 'line';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'hide') return hidCount(s) ? `${s.round + 1}回目 / ${ROUNDS}・全員がこっそり隠し線を${hidCount(s)}本` : `${s.round + 1}回目 / ${ROUNDS}・まもなく結果`;
    if (s.phase === 'shown') return `${s.round + 1}回目の結果`;
    return '';
  },

  referee(s) {
    if (s.phase === 'hide') {
      if (s.hidden.every((_, p) => hidDone(s, p))) return { key: 'hall' + s.round, ms: 800, move: { t: 'reveal' } };
      return { key: 'hide' + s.round, ms: HIDE_MS, move: { t: 'reveal' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.round, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'reveal' && s0.phase === 'hide') {
        const s = clone(s0);
        s.step += 1;
        const lost = Array(s.n).fill(false);
        for (let p = 0; p < s.n; p++) {
          for (const h of hidList(s.hidden[p])) {
            if (canDraw(s.lines, h.r, h.c)) s.lines.push({ r: h.r, c: h.c, p, hid: true });
            else lost[p] = true;
          }
        }
        const got = s.starts.map((_, p) => prizeOf(s, s.lines, p));
        got.forEach((v, p) => { s.scores[p] += v; });
        s.last = { got, lost };
        s.phase = 'shown';
        return s;
      }
      if (m.t === 'next' && s0.phase === 'shown') {
        const s = clone(s0);
        s.step += 1;
        if (s.round + 1 >= ROUNDS) { s.phase = 'end'; return s; }
        s.round += 1;
        Object.assign(s, setup(s.seed, s.round, s.n, s.minus === true));
        s.first = s.round % s.n;
        s.k = 0;
        s.hidden = Array(s.n).fill(null);
        s.last = null;
        s.phase = 'draw';
        return s;
      }
      return null;
    }
    if (!Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || !this.canAct(s0, m.p) || !canDraw(s0.lines, m.r, m.c)) return null;
    if (m.t === 'line' && s0.phase === 'draw') {
      const s = clone(s0);
      s.step += 1;
      s.lines.push({ r: m.r, c: m.c, p: m.p });
      s.k += 1;
      if (s.k >= s.n * 2) s.phase = 'hide';
      return s;
    }
    if (m.t === 'hide' && s0.phase === 'hide') {
      const mine = hidList(s0.hidden[m.p]);
      if (!canDraw(mine, m.r, m.c)) return null; // 自分の前の隠し線とぶつかる所
      const s = clone(s0);
      s.step += 1;
      s.hidden[m.p] = hidCount(s0) === 1 ? { r: m.r, c: m.c } : [...mine, { r: m.r, c: m.c }];
      return s;
    }
    return null;
  },

  cpuDelay(s) { return s.phase === 'hide' ? 1500 : 900; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const t = s.phase === 'hide' ? 'hide' : 'line';
    const mine = t === 'hide' ? hidList(s.hidden[p]) : [];
    const base = [...s.lines, ...mine];
    const all = slots(base);
    if (!all.length) return null;
    let pick = all[Math.floor(Math.random() * all.length)];
    if (Math.random() >= 0.35) {
      let best = -Infinity;
      for (const [r, c] of shuffle(all, Math.random)) {
        const ls = [...base, { r, c, p }];
        const others = s.starts.map((_, x) => (x === p ? 0 : prizeOf(s, ls, x)));
        const v = prizeOf(s, ls, p) - 0.4 * Math.max(...others);
        if (v > best) { best = v; pick = [r, c]; }
      }
    }
    return { t, r: pick[0], c: pick[1] };
  },

  render(root, s, o) {
    const self = o.me >= 0 && !o.watching ? o.me : null;
    const nameP = (p) => (p === self ? 'あなた' : o.names[p]);
    const extra = (p) => {
      if (s.phase === 'hide') return hidCount(s) && hidDone(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase === 'shown' && s.last) return s.last.lost[p] ? `<span class="pt-ng">${signed(s.last.got[p])}（隠し線が消えた）</span>` : `<span class="${s.last.got[p] < 0 ? 'pt-ng' : 'pt-ok'}">${signed(s.last.got[p])}</span>`;
      return '';
    };
    const chips = scoreChips(o, s.scores, { turn: this.turn(s), won: s.phase === 'end' ? leaders(s.scores) : [], extra, steady: true });
    chips.querySelectorAll('.cc-opp-name').forEach((el, p) => { el.style.borderBottom = `3px solid ${SEAT_COLORS[p % SEAT_COLORS.length]}`; });
    root.innerHTML = '';
    root.className = 'board am';
    root.append(chips);
    if (s.phase === 'end') return;

    const X = (c) => 50 + c * 100;
    const Y = (r) => 70 + r * 36 + 18; // r = -1 は上の端、ROWS は下の端
    const top = 70, bottom = 70 + ROWS * 36;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 500 ${bottom + 70}`);
    svg.setAttribute('class', 'am-svg');
    const mk = (tag, attrs, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.append(e);
      return e;
    };
    const shown = s.phase === 'shown';
    // 縦線
    for (let c = 0; c < COLS; c++) mk('line', { x1: X(c), y1: top, x2: X(c), y2: bottom, class: 'am-v' });
    // スタート（上）と当たり（下）
    for (let c = 0; c < COLS; c++) {
      const p = s.starts.indexOf(c);
      if (p >= 0) {
        mk('circle', { cx: X(c), cy: 40, r: 17, fill: SEAT_COLORS[p % SEAT_COLORS.length], class: 'am-start' + (p === self ? ' me' : '') });
        const t = mk('text', { x: X(c), y: 14, class: 'am-name' });
        t.textContent = [...nameP(p)].slice(0, 4).join('');
      }
      const winner = shown ? s.starts.findIndex((st) => trace(s.lines, st) === c) : -1;
      mk('rect', { x: X(c) - 30, y: bottom + 12, width: 60, height: 40, rx: 8, class: 'am-prize' + (winner >= 0 ? ' got' : ''), ...(winner >= 0 ? { style: `stroke: ${SEAT_COLORS[winner % SEAT_COLORS.length]}` } : {}) });
      const t = mk('text', { x: X(c), y: bottom + 39, class: 'am-pt' + (s.prizes[c] < 0 ? ' minus' : '') });
      t.textContent = s.prizes[c] < 0 ? `−${-s.prizes[c]}点` : `${s.prizes[c]}点`;
    }
    // 横線
    const mine = self !== null && s.phase === 'hide' ? hidList(s.hidden[self]) : [];
    const linesNow = [...s.lines, ...mine.filter((h) => canDraw(s.lines, h.r, h.c)).map((h) => ({ ...h, p: self, hid: true }))];
    for (const l of s.lines) {
      mk('line', { x1: X(l.c), y1: Y(l.r), x2: X(l.c + 1), y2: Y(l.r), class: 'am-h' + (l.hid ? ' hid' : '') + (l === s.lines.at(-1) && o.fresh && !shown ? ' pop' : ''), stroke: l.p < 0 ? '#555' : SEAT_COLORS[l.p % SEAT_COLORS.length] });
    }
    for (const h of mine) mk('line', { x1: X(h.c), y1: Y(h.r), x2: X(h.c + 1), y2: Y(h.r), class: 'am-h hid mine', stroke: SEAT_COLORS[self % SEAT_COLORS.length] });
    if (shown) {
      for (let p = 0; p < s.n; p++) {
        for (const h of hidList(s.hidden[p])) {
          if (s.lines.some((l) => l.hid && l.p === p && l.r === h.r && l.c === h.c)) continue; // 残った線
          mk('line', { x1: X(h.c), y1: Y(h.r), x2: X(h.c + 1), y2: Y(h.r), class: 'am-h lost', stroke: SEAT_COLORS[p % SEAT_COLORS.length] });
        }
      }
    }
    // 道: 結果のときは全員の道を光でたどる。それ以外は自分の今の道だけ細く
    const drawPath = (p, cls) => {
      const pts = pathOf(linesNow, s.starts[p]).map(([c, r]) => `${X(c)},${r < 0 ? 40 : r >= ROWS ? bottom + 12 : Y(r)}`);
      mk('path', { d: 'M' + pts.join(' L'), class: cls, stroke: SEAT_COLORS[p % SEAT_COLORS.length], pathLength: 1 });
    };
    const roundKey = `${s.seed}:${s.round}`;
    if (shown) {
      const anim = animated !== roundKey;
      animated = roundKey;
      for (let p = 0; p < s.n; p++) drawPath(p, 'am-path' + (anim ? ' anim' : ''));
    } else if (self !== null) drawPath(self, 'am-mine');

    // 引ける所
    const canLine = o.canMove && self !== null && this.canAct(s, self);
    if (canLine) {
      const t = s.phase === 'hide' ? 'hide' : 'line';
      for (const [r, c] of slots([...s.lines, ...mine])) {
        mk('line', { x1: X(c) + 14, y1: Y(r), x2: X(c + 1) - 14, y2: Y(r), class: 'am-slot' });
        const hit = mk('rect', { x: X(c) + 6, y: Y(r) - 17, width: 88, height: 34, class: 'am-hit' });
        hit.addEventListener('click', () => o.onMove({ t, r, c }));
      }
    }
    const box = document.createElement('div');
    box.className = 'am-board';
    box.append(svg);
    root.append(box);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    const now = self !== null ? s.prizes[trace(linesNow, s.starts[self])] : null;
    const head = `${s.round + 1}回目 / ${ROUNDS}・`;
    const H = hidCount(s);
    if (shown) {
      msg.textContent = head + s.starts.map((_, p) => `${nameP(p)} ${s.last.got[p] < 0 ? `−${-s.last.got[p]}` : s.last.got[p]}点`).join('・');
    } else if (s.phase === 'hide' && !H) {
      msg.textContent = head + 'まもなく結果です';
    } else if (s.phase === 'hide') {
      const left = self === null ? 0 : H - mine.length;
      msg.textContent = self === null ? head + 'みんなが隠し線を引いています'
        : !left ? `${head}隠し線を引きました（いまの道なら ${pt(now)}点）。みんなを待っています`
        : `${head}隠し線を${H > 1 ? `あと${left}本` : '1本'}、好きな所に引こう（ほかの人には見えません・20秒）。いまの道なら ${pt(now)}点`;
    } else {
      const left = Math.ceil((s.n * 2 - s.k) / s.n); // 見える線の残りの周回（2 → 1）
      msg.textContent = self === null ? head + `${nameP(this.turn(s))}が線を引いています`
        : canLine ? `${head}あなたのターン。線を引く所を押そう（いまの道なら ${pt(now)}点・見える線はあと${left}本）`
        : `${head}${nameP(this.turn(s))}が線を引いています（いまの道なら ${pt(now)}点）`;
    }
    root.append(msg);
  },
};
