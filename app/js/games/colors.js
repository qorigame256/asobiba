// いろあわせ（UNO と同じ遊び方のカードゲーム。UNO は Mattel 社の商標なので名前を変えている）。
// 2〜10人。手札を最初に出し切った人の勝ち（1回勝負・点数計算なし）。
//
// 札: 色1文字 + 中身。色 r赤 y黄 g緑 b青。中身 0〜9 / S（スキップ）/ R（リバース）/ D（ドロー2）。
//     色の無い札は 'W'（ワイルド）と 'W4'（ワイルドドロー4）。全108枚。
// 手: { p, t: 'play', i: 手札の何枚目か（手札は常に並べ替え済み）, c: ワイルドで選ぶ色 }
//     { p, t: 'draw' }（山から1枚引く） / { p, t: 'pass' }（引いた札を出さずに次へ）
//
// 公式ルールから変えた所（ネット対戦向けに簡単にした。変えるなら本人に確認）:
//   - 最初にめくる札は、数字の札が出るまでめくり直す。
//   - 出せる札があっても山から引いてよい。引いた札が出せるなら、その札だけ続けて出せる（出さずに次へも可）。
//   - ワイルドドロー4は、場の色と同じ色の札を持っていないときだけ出せる（公式の「チャレンジ」の代わり）。
//   - ドロー2・ドロー4は重ねて返せない。2人のときリバースはスキップと同じ。
//   - 残り1枚の宣言は省略（自動で「ラスト1枚」と表示）。
//   - 山が尽きたら、捨て札の一番上を残して切り直す。

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

let picking = null; // ワイルドの色を選んでいる途中 { step, i }（通信で描き直されても閉じないよう外に持つ）

function cardEl(card, tag = 'div') {
  const e = document.createElement(tag);
  const k = kindOf(card);
  const label = KIND_LABEL[k] ?? k;
  e.className = `ccard c-${colorOf(card) ?? 'w'}`;
  e.innerHTML = `<span class="ccard-oval"><span>${label}</span></span><span class="ccard-corner">${label}</span>`;
  e.setAttribute('aria-label', cardName(card));
  return e;
}

function logText(s, nameP) {
  const L = s.last;
  if (!L) return `最初の札は「${cardName(s.discard[0])}」`;
  if (L.t === 'draw') return L.got ? `${nameP(L.p)}が山から1枚引いた` : '山札が無いので引けなかった';
  if (L.t === 'pass') return `${nameP(L.p)}は引いた札を出さずに次へ`;
  let t = `${nameP(L.p)}が「${cardName(L.card)}」を出した`;
  if (L.card[0] === 'W') t += `（次の色: ${COLOR_NAME[L.color]}）`;
  const k = kindOf(L.card);
  if (L.victim !== undefined && (k === 'S' || k === 'R')) t += ` → ${nameP(L.victim)}は1回休み`;
  else if (k === 'R') t += ' → 回る向きが反対に';
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

  init(n, seed) {
    const deck = shuffle(makeDeck(), mulberry32(seed));
    const hands = Array.from({ length: n }, () => sortHand(deck.splice(-HAND_SIZE)));
    let top = deck.pop();
    while (!isNumber(top)) { deck.unshift(top); top = deck.pop(); }
    return { n, seed, shuffles: 0, deck, discard: [top], hands, turn: 0, dir: 1, color: top[0], drawn: null, winner: null, step: 0, last: null };
  },

  turn(s) { return s.winner === null ? s.turn : null; },
  canAct(s, p) { return s.winner === null && s.turn === p; },
  result(s) { return s.winner === null ? null : { winner: s.winner }; },

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
      s.hands[p].splice(m.i, 1);
      s.discard.push(card);
      s.color = wild ? m.c : card[0];
      s.drawn = null;
      const last = { p, t: 'play', card, color: s.color };
      s.last = last;
      if (!s.hands[p].length) { s.winner = p; return s; }
      const k = kindOf(card);
      if (k === 'S') {
        last.victim = next(1);
        s.turn = next(2);
      } else if (k === 'R') {
        s.dir = -s.dir;
        if (s.n === 2) { last.victim = 1 - p; s.turn = p; } else s.turn = next(1);
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
    const play = (i) => (hand[i][0] === 'W' ? { t: 'play', i, c: pickColor(hand, i) } : { t: 'play', i });
    if (s.drawn !== null) return Math.random() < 0.15 ? { t: 'pass' } : play(hand.indexOf(s.drawn));
    const legal = hand.map((_, i) => i).filter((i) => canPlay(s, p, hand[i]));
    if (!legal.length) return { t: 'draw' };
    if (Math.random() < 0.3) return play(legal[Math.floor(Math.random() * legal.length)]);
    const nextLeft = s.hands[(((p + s.dir) % s.n) + s.n) % s.n].length;
    const sameColor = (c) => hand.filter((x) => colorOf(x) === colorOf(c)).length;
    const score = (c) => {
      if (c === 'W4') return nextLeft <= 2 ? 60 : -20;
      if (c === 'W') return -10;
      const k = kindOf(c);
      if (k === 'S' || k === 'R' || k === 'D') return (nextLeft <= 2 ? 50 : 8) + sameColor(c);
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
    deck.innerHTML = `<span class="ccard-deck">山札<br><small>${s.deck.length}枚</small></span>`;
    if (canDraw) {
      deck.type = 'button';
      deck.setAttribute('aria-label', '山札から1枚引く');
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
        : '光っている札が出せます。出さないときは山札をタップ';
      head.append(hint);
    }
    root.append(head);

    const hand = document.createElement('div');
    hand.className = 'cc-hand';
    s.hands[me].forEach((card, i) => {
      const ok = myTurn && (s.drawn === null || card === s.drawn) && canPlay(s, me, card);
      const e = cardEl(card, ok ? 'button' : 'div');
      if (ok) {
        e.type = 'button';
        e.classList.add('playable');
        e.onclick = () => {
          if (card[0] === 'W') { picking = { step: s.step, i }; draw(); } else o.onMove({ t: 'play', i });
        };
      }
      if (picking?.i === i) e.classList.add('picked');
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

    if (picking) {
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
