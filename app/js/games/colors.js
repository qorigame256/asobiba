// いろあわせ（UNO と同じ遊び方のカードゲーム。UNO は Mattel 社の商標なので名前を変えている）。
// 2〜10人。手札を最初に出し切った人の勝ち（1回勝負・点数計算なし）。
//
// 札: 色1文字 + 中身。色 r赤 y黄 g緑 b青。中身 0〜9 / S（スキップ）/ R（リバース）/ D（ドロー2）。
//     色の無い札は 'W'（ワイルド）と 'W4'（ワイルドドロー4）。全108枚。
// 手: { p, t: 'play', i: 手札の何枚目か（手札は常に並べ替え済み）, c: ワイルドで選ぶ色, to: 「7で交換」の相手（3人以上のときだけ） }
//     { p, t: 'draw' }（山から1枚引く。重ね返しの途中なら、たまった枚数を全部引く） / { p, t: 'pass' }（引いた札を出さずに次へ）
//
// 公式ルールから変えた所（ネット対戦向けに簡単にした。変えるなら本人に確認）:
//   - 最初にめくる札は、数字の札が出るまでめくり直す。
//   - 出せる札があっても山から引いてよい。引いた札が出せるなら、その札だけ続けて出せる（出さずに次へも可）。
//   - ワイルドドロー4は、場の色と同じ色の札を持っていないときだけ出せる（公式の「チャレンジ」の代わり）。
//   - ドロー2・ドロー4は重ねて返せない（詳細設定「重ねて返す」で返せる。下）。2人のときリバースはスキップと同じ。
//   - 残り1枚の宣言は省略（自動で「ラスト1枚」と表示）。
//   - 山が尽きたら、捨て札の一番上を残して切り直す。
// 詳細設定「重ねて返す」（2026-10-06 本人の決定。最初はなし）: ドロー2を出された人はドロー2を、ドロー4を出された人はドロー4を
//   重ねて次の人へ回せる（同じ種類どうしだけ。色は問わない）。重ねなかった人（山をタップ）は、たまった枚数を全部引いて1回休み。
//   返すときのドロー4は、場の色の札を持っていても出せる（本人の決定）。重ね返しの途中（s.pend）は、ほかの札は出せない。
// 詳細設定「7で交換・0で回す」（2026-10-06 本人の決定。最初はなし）: 7を出した人は、選んだ1人と手札をまるごと交換する（2人なら相手と）。
//   0を出したら、全員が手札をいま回っている向きの次の人へ渡す。出してちょうど手札がなくなったときは交換も回しもせず上がり（Claude の判断）。
//   CPU は手札がいちばん少ない人と交換する。
// 詳細設定「同じ数字まとめ出し」（2026-10-06 本人の決定。最初はなし）: 数字の札は、同じ数字の札を何枚でもまとめて出せる（記号の札は1枚ずつ）。
//   手の more に、いっしょに出す札の位置を出す順に入れる。最後に置いた札の色が場の色になる。Claude の判断: 引いた札は1枚だけ・
//   7・0 をまとめて出しても交換・回しは1回。CPU は同じ数字を全部出し、手元に多く残る色を一番上にする。

import { mulberry32, shuffle } from './util.js';

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAME = { r: '赤', y: '黄', g: '緑', b: '青' };
const KINDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D'];
const KIND_LABEL = { S: '⊘', R: '⇄', D: '+2', W: '', W4: '+4' };
const KIND_NAME = { S: 'スキップ', R: 'リバース', D: 'ドロー2' };
const HAND_SIZE = 7;

const colorOf = (c) => (c[0] === 'W' ? null : c[0]);
const kindOf = (c) => (c[0] === 'W' ? c : c.slice(1));
const isNumber = (c) => /^[rygb]\d$/.test(c);

function sortKey(c) {
  if (c === 'W') return 100;
  if (c === 'W4') return 101;
  return COLORS.indexOf(c[0]) * 20 + KINDS.indexOf(c.slice(1));
}
const sortHand = (h) => h.sort((a, b) => sortKey(a) - sortKey(b));

export function makeDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push(c + '0');
    for (const k of KINDS.slice(1)) d.push(c + k, c + k);
  }
  for (let i = 0; i < 4; i++) d.push('W', 'W4');
  return d;
}

export function cardName(c) {
  if (c === 'W') return 'ワイルド';
  if (c === 'W4') return 'ワイルドドロー4';
  const k = kindOf(c);
  return COLOR_NAME[c[0]] + 'の' + (KIND_NAME[k] ?? k);
}

function canPlay(s, p, card) {
  if (s.pend) return kindOf(card) === s.pend.k; // 重ね返しの途中は同じ種類だけ
  if (card === 'W') return true;
  if (card === 'W4') return !s.hands[p].some((c) => colorOf(c) === s.color);
  const top = s.discard[s.discard.length - 1];
  return colorOf(card) === s.color || kindOf(card) === kindOf(top);
}

const clone = (s) => ({ ...s, deck: s.deck.slice(), discard: s.discard.slice(), hands: s.hands.map((h) => h.slice()) });

// 山から k 枚引いて手札に入れる（s を書き換える）。引けた札を返す
function drawInto(s, p, k) {
  const got = [];
  while (got.length < k) {
    if (!s.deck.length) {
      if (s.discard.length < 2) break; // 山も捨て札も無い
      const top = s.discard.pop();
      s.shuffles += 1;
      s.deck = shuffle(s.discard, mulberry32(s.seed + s.shuffles * 0x9e3779b9));
      s.discard = [top];
    }
    const c = s.deck.pop();
    got.push(c);
    s.hands[p].push(c);
  }
  sortHand(s.hands[p]);
  return got;
}

function pickColor(hand, skip) {
  const count = { r: 0, y: 0, g: 0, b: 0 };
  hand.forEach((c, i) => { if (i !== skip && colorOf(c)) count[c[0]]++; });
  const best = Math.max(...Object.values(count));
  const cands = COLORS.filter((c) => count[c] === best);
  return cands[Math.floor(Math.random() * cands.length)];
}

/* ---------- 画面 ---------- */

let picking = null; // ワイルドの色（7で交換なら相手、まとめ出しならいっしょに出す札）を選んでいる途中 { step, i, seven, multi: [位置…], more }（通信で描き直されても閉じないよう外に持つ）

// 札の絵（2026-10-04 本人の希望で本家風に。ロゴや本家の絵は写さず、形だけ似せて自分で描いた）。
// 色の札は「色の地・斜めの白い楕円・縁取りした大きな数字や記号・左上と右下に小さく同じもの」。6 と 9 は下線で見分ける。
const OUTLINE = '#2d2a26';
const svg = (body) => `<svg class="ccard-sym" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
// 縁取り: 太い黒の線の上に、札の色の線を重ねる
const stroked = (d, w) => `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="${w + 7}" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="${d}" fill="none" stroke="var(--cc)" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const smallCard = (x, y, rot, fill) => `<rect x="${x}" y="${y}" width="30" height="44" rx="5" transform="rotate(${rot} ${x + 15} ${y + 22})" fill="${fill}" stroke="${OUTLINE}" stroke-width="4"/>`;
const SYMBOL = {
  S: svg(stroked('M50 22 A28 28 0 1 1 49.9 22 Z M30 70 L70 30', 11)),
  R: svg(stroked('M16 54 L48 22 M48 22 L32 22 M48 22 L48 38', 9) + stroked('M84 46 L52 78 M52 78 L68 78 M52 78 L52 62', 9)),
  D: svg(smallCard(24, 34, -12, 'var(--cc)') + smallCard(44, 20, -12, 'var(--cc)')),
  W4: svg(smallCard(12, 40, -12, '#2f6fb3') + smallCard(28, 26, -12, '#3a9d55') + smallCard(42, 34, -12, '#e8a913') + smallCard(58, 20, -12, '#e04b3c')),
};

function cardEl(card, tag = 'div') {
  const e = document.createElement(tag);
  const k = kindOf(card);
  const corner = KIND_LABEL[k] ?? k;
  const big = SYMBOL[k] ?? (k === 'W' ? '' : `<span class="ccard-num${k === '6' || k === '9' ? ' ul' : ''}">${k}</span>`);
  const small = k === 'S' || k === 'R' ? SYMBOL[k] : k === '6' || k === '9' ? `<span class="ul">${k}</span>` : corner;
  e.className = `ccard c-${colorOf(card) ?? 'w'} k-${k}`;
  e.innerHTML = `<span class="ccard-oval"></span><span class="ccard-face">${big}</span>`
    + `<span class="ccard-corner">${small}</span><span class="ccard-corner br">${small}</span>`;
  e.setAttribute('aria-label', cardName(card));
  return e;
}

function logText(s, nameP) {
  const L = s.last;
  if (!L) return `最初の札は「${cardName(s.discard[0])}」`;
  if (L.t === 'draw') return L.got ? `${nameP(L.p)}が山から1枚引いた` : '山札が無いので引けなかった';
  if (L.t === 'pass') return `${nameP(L.p)}は引いた札を出さずに次へ`;
  if (L.t === 'take') return `${nameP(L.p)}が${L.got}枚引いて1回休み`;
  let t = L.n > 1 ? `${nameP(L.p)}が「${kindOf(L.card)}」を${L.n}枚まとめて出した（一番上は${COLOR_NAME[L.color]}）` : `${nameP(L.p)}が「${cardName(L.card)}」を出した`;
  if (L.card[0] === 'W') t += `（次の色: ${COLOR_NAME[L.color]}）`;
  const k = kindOf(L.card);
  if (L.swap !== undefined) t += ` → ${nameP(L.p)}と${nameP(L.swap)}が手札を交換`;
  else if (L.rotate) t += ' → 全員が手札を次の人へ渡した';
  else if (L.victim !== undefined && (k === 'S' || k === 'R')) t += ` → ${nameP(L.victim)}は1回休み`;
  else if (k === 'R') t += ' → 回る向きが反対に';
  else if (L.pend) t += ` → たまって${L.pend}枚。次の人は重ねて返すか、${L.pend}枚引く`;
  else if (L.victim !== undefined) t += ` → ${nameP(L.victim)}が${L.got}枚引いて1回休み`;
  return t;
}

export default {
  id: 'colors',
  name: 'いろあわせ',
  icon: '🃏',
  desc: '色か数字が同じ札を出していく。手札を最初に出し切った人の勝ち（UNO と同じ遊び方）',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,

  settings: [
    { key: 'stack', label: '重ねて返す', desc: 'ドロー2にはドロー2、ドロー4にはドロー4を重ねて次の人へ回せる。重ねなかった人が、たまった枚数を全部引く', def: false },
    { key: 'multi', label: '同じ数字まとめ出し', desc: '同じ数字の札を何枚でもまとめて出せる（数字の札だけ）。最後に置いた札の色が場の色になる', def: false },
    { key: 'sevenZero', label: '7で交換・0で回す', desc: '7を出したら、選んだ1人と手札を交換する。0を出したら、全員が手札を次の人へ渡す（回っている向き）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const deck = shuffle(makeDeck(), mulberry32(seed));
    const hands = Array.from({ length: n }, () => sortHand(deck.splice(-HAND_SIZE)));
    let top = deck.pop();
    while (!isNumber(top)) { deck.unshift(top); top = deck.pop(); }
    return { n, seed, rules: { stack: false, sevenZero: false, ...rules }, pend: null, shuffles: 0, deck, discard: [top], hands, turn: 0, dir: 1, color: top[0], drawn: null, winner: null, step: 0, last: null };
  },

  turn(s) { return s.winner === null ? s.turn : null; },
  canAct(s, p) { return s.winner === null && s.turn === p; },
  result(s) { return s.winner === null ? null : { winner: s.winner }; },
  startSound: 'shuffle',
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) { return m.t === 'draw' ? 'draw' : m.t === 'pass' ? 'pop' : 'card'; },

  apply(s0, m) {
    if (!m || s0.winner !== null || m.p !== s0.turn) return null;
    const s = clone(s0);
    const p = m.p;
    const next = (k) => (((p + s.dir * k) % s.n) + s.n) % s.n;
    s.step += 1;

    if (m.t === 'play') {
      if (!Number.isInteger(m.i)) return null;
      const card = s.hands[p][m.i];
      if (card === undefined || (s.drawn !== null && card !== s.drawn) || !canPlay(s0, p, card)) return null;
      const wild = card[0] === 'W';
      if (wild ? !COLORS.includes(m.c) : m.c !== undefined) return null;
      const swap = s.rules?.sevenZero && kindOf(card) === '7'; // 7で交換（詳細設定）
      if (swap && s.n > 2 ? !Number.isInteger(m.to) || m.to < 0 || m.to >= s.n || m.to === p : m.to !== undefined) return null;
      let more = [];
      if (m.more !== undefined) { // 同じ数字まとめ出し（詳細設定）
        const hand = s.hands[p];
        if (!s.rules?.multi || !isNumber(card) || s0.drawn !== null || !Array.isArray(m.more) || !m.more.length) return null;
        if (new Set([m.i, ...m.more]).size !== m.more.length + 1) return null;
        if (!m.more.every((j) => Number.isInteger(j) && isNumber(hand[j] ?? '') && kindOf(hand[j]) === kindOf(card))) return null;
        more = m.more.map((j) => hand[j]);
      }
      for (const j of [m.i, ...(m.more ?? [])].sort((a, b) => b - a)) s.hands[p].splice(j, 1);
      s.discard.push(card, ...more);
      const topCard = more.length ? more[more.length - 1] : card;
      s.color = wild ? m.c : topCard[0];
      s.drawn = null;
      const last = { p, t: 'play', card: topCard, color: s.color, n: 1 + more.length };
      s.last = last;
      if (!s.hands[p].length) { s.winner = p; return s; }
      const k = kindOf(card);
      if (swap) {
        const to = s.n > 2 ? m.to : 1 - p;
        [s.hands[p], s.hands[to]] = [s.hands[to], s.hands[p]];
        last.swap = to;
      } else if (k === '0' && s.rules?.sevenZero) { // 0で回す（詳細設定）: 全員が次の人へ渡す
        const old = s.hands;
        s.hands = old.map((_, q) => old[(((q - s.dir) % s.n) + s.n) % s.n]);
        last.rotate = true;
      }
      if (k === 'S') {
        last.victim = next(1);
        s.turn = next(2);
      } else if (k === 'R') {
        s.dir = -s.dir;
        if (s.n === 2) { last.victim = 1 - p; s.turn = p; } else s.turn = next(1);
      } else if ((k === 'D' || k === 'W4') && s.rules?.stack) {
        // 重ねて返す: 引かせるのは、重ねなかった人が決まってから
        s.pend = { k, n: (s0.pend?.n ?? 0) + (k === 'D' ? 2 : 4) };
        last.pend = s.pend.n;
        s.turn = next(1);
      } else if (k === 'D' || k === 'W4') {
        last.victim = next(1);
        last.got = drawInto(s, last.victim, k === 'D' ? 2 : 4).length;
        s.turn = next(2);
      } else {
        s.turn = next(1);
      }
      return s;
    }

    if (m.t === 'draw') {
      if (s.drawn !== null) return null;
      if (s.pend) {
        // 重ねなかった: たまった枚数を全部引いて1回休み
        s.last = { p, t: 'take', got: drawInto(s, p, s.pend.n).length };
        s.pend = null;
        s.turn = next(1);
        return s;
      }
      const got = drawInto(s, p, 1);
      s.last = { p, t: 'draw', got: got.length };
      if (got.length && canPlay(s, p, got[0])) s.drawn = got[0];
      else s.turn = next(1);
      return s;
    }

    if (m.t === 'pass') {
      if (s.drawn === null) return null;
      s.drawn = null;
      s.last = { p, t: 'pass' };
      s.turn = next(1);
      return s;
    }
    return null;
  },

  // CPU: 出せる札の中から「数字の大きい札を先に・ワイルドは取っておく・次の人が残り少ないなら妨害札」で選ぶ。
  // 強くなりすぎないよう、3回に1回くらいは出せる札から適当に選ぶ。
  cpu(s, p) {
    const hand = s.hands[p];
    // 7で交換の相手は、手札がいちばん少ない人（同じなら近い席）
    const fewest = () => {
      let best = null;
      for (let k = 1; k < s.n; k++) { const q = (p + k) % s.n; if (best === null || s.hands[q].length < s.hands[best].length) best = q; }
      return best;
    };
    const play = (i) => {
      if (hand[i][0] === 'W') return { t: 'play', i, c: pickColor(hand, i) };
      const m = { t: 'play', i };
      if (s.rules?.multi && isNumber(hand[i]) && s.drawn === null) {
        // 同じ数字を全部出す。一番上は、出したあと手元に多く残る色の札
        const same = hand.map((_, j) => j).filter((j) => j !== i && isNumber(hand[j]) && kindOf(hand[j]) === kindOf(hand[i]));
        if (same.length) {
          const rest = hand.filter((c, j) => j !== i && !same.includes(j));
          const left = (j) => rest.filter((c) => colorOf(c) === colorOf(hand[j])).length;
          const top = same.reduce((a, b) => (left(b) > left(a) ? b : a));
          m.more = [...same.filter((j) => j !== top), top];
        }
      }
      if (s.rules?.sevenZero && kindOf(hand[i]) === '7' && s.n > 2) m.to = fewest();
      return m;
    };
    if (s.drawn !== null) return Math.random() < 0.15 ? { t: 'pass' } : play(hand.indexOf(s.drawn));
    const legal = hand.map((_, i) => i).filter((i) => canPlay(s, p, hand[i]));
    if (!legal.length) return { t: 'draw' };
    if (s.pend) return Math.random() < 0.2 ? { t: 'draw' } : play(legal[0]); // 重ね返し: たいていは返す
    if (Math.random() < 0.3) return play(legal[Math.floor(Math.random() * legal.length)]);
    const nextLeft = s.hands[(((p + s.dir) % s.n) + s.n) % s.n].length;
    const sameColor = (c) => hand.filter((x) => colorOf(x) === colorOf(c)).length;
    const score = (c) => {
      if (c === 'W4') return nextLeft <= 2 ? 60 : -20;
      if (c === 'W') return -10;
      const k = kindOf(c);
      if (k === 'S' || k === 'R' || k === 'D') return (nextLeft <= 2 ? 50 : 8) + sameColor(c);
      // 7で交換: 自分より手札の少ない人がいれば出したい
      if (k === '7' && s.rules?.sevenZero && s.hands[fewest()].length < hand.length - 1) return 40 + sameColor(c);
      return 10 + Number(k) + sameColor(c);
    };
    return play(legal.reduce((a, b) => (score(hand[b]) > score(hand[a]) ? b : a)));
  },

  render(root, s, o) {
    const draw = () => this.render(root, s, o);
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const myTurn = o.canMove;
    if (!myTurn || picking?.step !== s.step) picking = null;

    root.innerHTML = '';
    root.className = 'board cc';

    // ほかの人（自分の次の席から順に）
    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.winner === null && s.turn === p ? ' turn' : '') + (s.winner === p ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = o.names[p];
      const count = document.createElement('div');
      count.className = 'cc-opp-count';
      count.innerHTML = `<span class="ccard mini back"></span>×${s.hands[p].length}`;
      chip.append(name, count);
      const tags = [];
      if (s.hands[p].length === 1) tags.push(['last', 'ラスト1枚']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        chip.append(t);
      }
      opps.append(chip);
    }
    root.append(opps);

    // 場（山札・捨て札・いまの色と回る向き）
    const table = document.createElement('div');
    table.className = 'cc-table';
    const canDraw = myTurn && s.drawn === null;
    const deck = document.createElement(canDraw ? 'button' : 'div');
    deck.className = 'ccard big back' + (canDraw ? ' playable' : '');
    deck.innerHTML = s.pend
      ? `<span class="ccard-deck">${s.pend.n}枚<br>引く</span>`
      : `<span class="ccard-deck">山札<br><small>${s.deck.length}枚</small></span>`;
    if (canDraw) {
      deck.type = 'button';
      deck.setAttribute('aria-label', s.pend ? `山札から${s.pend.n}枚引く` : '山札から1枚引く');
      deck.onclick = () => o.onMove({ t: 'draw' });
    }
    const top = cardEl(s.discard[s.discard.length - 1]);
    top.classList.add('big');
    if (o.fresh && s.last?.t === 'play') top.classList.add('pop');
    const state = document.createElement('div');
    state.className = 'cc-state';
    state.innerHTML = `<span class="cc-color c-${s.color}">${COLOR_NAME[s.color]}</span><span class="cc-dir">${s.dir === 1 ? '↻ 右回り' : '↺ 左回り'}</span>`;
    table.append(deck, top, state);
    root.append(table);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    if (me === null) return; // 観戦中は手札を出さない

    const head = document.createElement('div');
    head.className = 'cc-hand-head';
    head.textContent = `あなたの手札（${s.hands[me].length}枚）`;
    if (myTurn) {
      const hint = document.createElement('small');
      hint.textContent = s.drawn !== null
        ? '引いた札を出すか、「出さずに次へ」を押してください'
        : s.pend
          ? `${s.pend.k === 'D' ? 'ドロー2' : 'ドロー4'}を重ねて返すか、山札をタップして${s.pend.n}枚引いてください`
          : '光っている札が出せます。出さないときは山札をタップ';
      head.append(hint);
    }
    root.append(head);

    const hand = document.createElement('div');
    hand.className = 'cc-hand';
    const mine = s.hands[me];
    // 同じ数字まとめ出し: 押した札と同じ数字の札がほかにもあれば、いっしょに出す札を選ばせる
    const sameAs = (i) => (s.rules?.multi && s.drawn === null && !s.pend && isNumber(mine[i])
      ? mine.map((_, j) => j).filter((j) => j !== i && isNumber(mine[j]) && kindOf(mine[j]) === kindOf(mine[i])) : []);
    const send = (i, more) => {
      if (s.rules?.sevenZero && kindOf(mine[i]) === '7' && s.n > 2) { picking = { step: s.step, i, seven: true, more }; draw(); }
      else { picking = null; o.onMove(more?.length ? { t: 'play', i, more } : { t: 'play', i }); }
    };
    mine.forEach((card, i) => {
      const multi = picking?.multi;
      const ok = multi ? i !== picking.i && sameAs(picking.i).includes(i)
        : myTurn && (s.drawn === null || card === s.drawn) && canPlay(s, me, card);
      const e = cardEl(card, ok ? 'button' : 'div');
      if (ok) {
        e.type = 'button';
        e.classList.add('playable');
        e.onclick = () => {
          if (multi) { const k = multi.indexOf(i); if (k >= 0) multi.splice(k, 1); else multi.push(i); draw(); }
          else if (card[0] === 'W') { picking = { step: s.step, i }; draw(); }
          else if (sameAs(i).length) { picking = { step: s.step, i, multi: [] }; draw(); }
          else send(i);
        };
      }
      if (picking?.i === i) e.classList.add('picked');
      const order = multi ? multi.indexOf(i) : -1;
      if (order >= 0) { e.classList.add('picked'); e.dataset.order = order + 2; } else if (multi && i === picking.i) e.dataset.order = 1;
      hand.append(e);
    });
    root.append(hand);

    if (myTurn && s.drawn !== null) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn secondary';
      pass.textContent = '出さずに次へ';
      pass.onclick = () => o.onMove({ t: 'pass' });
      actions.append(pass);
      root.append(actions);
    }

    if (picking?.multi) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>同じ数字の札をいっしょに出せます。出す札を順に押してください（最後に置いた札の色が場の色になります）</p>';
      const row = document.createElement('div');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn';
      go.textContent = picking.multi.length ? `${picking.multi.length + 1}枚まとめて出す` : '1枚だけ出す';
      go.onclick = () => send(picking.i, picking.multi.slice());
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      row.append(go);
      pick.append(row, cancel);
      root.append(pick);
    } else if (picking?.seven) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>手札を交換する人を選んでください</p>';
      const row = document.createElement('div');
      for (let k = 1; k < s.n; k++) {
        const q = (me + k) % s.n;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.textContent = `${o.names[q]}（${s.hands[q].length}枚）`;
        b.onclick = () => { const { i, more } = picking; picking = null; o.onMove(more?.length ? { t: 'play', i, more, to: q } : { t: 'play', i, to: q }); };
        row.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      pick.append(row, cancel);
      root.append(pick);
    } else if (picking) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>次の色を選んでください</p>';
      const row = document.createElement('div');
      for (const c of COLORS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cc-pick c-${c}`;
        b.textContent = COLOR_NAME[c];
        b.onclick = () => { const i = picking.i; picking = null; o.onMove({ t: 'play', i, c }); };
        row.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      pick.append(row, cancel);
      root.append(pick);
    }
  },
};
