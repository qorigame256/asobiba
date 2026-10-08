// ヨット（サイコロ5個で役を作る。「ヤッツィー」は商標なので、元の遊びの名前を使う）。2〜10人。
// 全員が同時に自分のサイコロを振る（2026-10-05 本人の決定）。1回の番で3回まで振れ、2回目と3回目は残したいサイコロを選んで、ほかを振り直す。
// 振り終えたら、まだ使っていない役を1つ選んで点を書く（0点でも書く）。全員が書いたら次の回へ。12回で全部の役が埋まって終わり。
// 役と点（よくある「ヨット」の形。Claude の判断）:
//   1〜6 … その目の合計 / チョイス … 5個の合計 / フォーダイス … 同じ目が4個以上なら5個の合計 / フルハウス … 3個と2個（5個同じも可）なら5個の合計
//   Sストレート … 4つ続いた目なら 15点 / Bストレート … 5つ続いた目なら 30点 / ヨット … 5個同じなら 50点
//   1〜6 の合計が 63点以上なら、ボーナス 35点。
// 詳細設定「2回目のヨット」（2026-10-06 本人の決定。最初はなし）: ヨットの役に50点を書いたあとで、もう一度5個そろえて
//   ほかの役に書いたら、そのたびに +100点（よくあるヤッツィーのボーナスと同じ。好きな役に書ける特別な決まり（ジョーカー）は別の詳細設定）。
// 詳細設定「ジョーカー」（2026-10-07 本人の決定。20回目の案。最初はなし）: ヨットの役がもう埋まっている（50点でも0点でも）ときに5個そろえたら、
//   Sストレート・Bストレートにも満点（15点・30点）で書ける（フルハウス・フォーダイスは5個そろいでもともと合計が入る）。
//   Claude の判断: 本家のような「先に同じ目の 1〜6 の役に書く」順番の決まりは付けない（分かりやすさのため。どの役に書いてもよい）。
//   2回目のヨットと一緒なら、+100点とどちらも付く。ありのときだけ局面に joker: true を持つ（なしでは今までと全く同じ形）。
// 点数の表の「ボーナス」の欄に、あと何点でボーナスか・獲得・無理を出す（2026-10-07 本人の承認。見せるだけで、手も点の付け方も変えない）。
//   無理は、まだ空いている 1〜6 の役を全部いちばん高い点（5個そろい）で埋めても 63点に届かないとき（bonusInfo）。
//   自分が振ったあとは、1〜6 の役のボタンに、そこに書いたあとの見込み（あと◯・獲得・無理）を小さく出す（まだ届くかどうかの途中のときだけ）。
// サイコロの目は、対局の種・人・回・何回目の振りから作る（apply が乱数を使わず全員の端末で同じになるように）。
// 手: { p, t: 'roll', r: 何回目, k: 何振り目(1〜3), keep: [残す5つの真偽] } / { p, t: 'score', r: 何回目, cat: 役の番号 }。
// r と k を入れているので、同じ手が2回届いても2回目は弾かれる（realtime）。

import { mulberry32, esc } from './util.js';
import { leaders, ranks, winnersText } from './party.js';

export const CATS = ['1', '2', '3', '4', '5', '6', 'チョイス', 'フォーダイス', 'フルハウス', 'Sストレート', 'Bストレート', 'ヨット'];
const ROUNDS = CATS.length;
const BONUS_AT = 63;
const BONUS = 35;
const YACHT_BONUS = 100; // 2回目からのヨット（詳細設定）

const counts = (d) => { const c = Array(7).fill(0); for (const x of d) c[x]++; return c; };
const sum = (d) => d.reduce((a, b) => a + b, 0);
const run = (c) => { let best = 0; let cur = 0; for (let v = 1; v <= 6; v++) { cur = c[v] ? cur + 1 : 0; best = Math.max(best, cur); } return best; };

// 役 cat に出目 d を書いたときの点
export function scoreOf(cat, d) {
  const c = counts(d);
  if (cat < 6) return c[cat + 1] * (cat + 1);
  if (cat === 6) return sum(d);
  if (cat === 7) return c.some((x) => x >= 4) ? sum(d) : 0;
  if (cat === 8) return c.some((x) => x === 5) || (c.includes(3) && c.includes(2)) ? sum(d) : 0;
  if (cat === 9) return run(c) >= 4 ? 15 : 0;
  if (cat === 10) return run(c) >= 5 ? 30 : 0;
  return c.some((x) => x === 5) ? 50 : 0;
}

// extra = 2回目からのヨットのボーナスの合計（詳細設定。無ければ 0）
export function totalOf(sheet, extra = 0) {
  const upper = sheet.slice(0, 6).reduce((a, b) => a + (b ?? 0), 0);
  const rest = sheet.slice(6).reduce((a, b) => a + (b ?? 0), 0);
  const bonus = upper >= BONUS_AT ? BONUS : 0;
  return { upper, bonus, total: upper + bonus + rest + extra };
}
// ボーナスの見込み（点数の表の「ボーナス」の欄に出す）。見るのは 1〜6 の役だけ（2回目のヨットの設定とは関係ない）。
//   state: 'got' … 63点以上で獲得 / 'no' … 空いている 1〜6 の役 k を全部 5k 点で埋めても届かない / 'need' … あと need 点
export function bonusInfo(sheet) {
  let upper = 0;
  let most = 0; // 空いている 1〜6 の役で、まだ取れるいちばん多い点の合計
  for (let cat = 0; cat < 6; cat++) {
    if (sheet[cat] === null || sheet[cat] === undefined) most += 5 * (cat + 1);
    else upper += sheet[cat];
  }
  if (upper >= BONUS_AT) return { state: 'got', upper, need: 0 };
  return { state: upper + most >= BONUS_AT ? 'need' : 'no', upper, need: BONUS_AT - upper };
}
// 見込みの短い書き方（表のせまい欄に入るように）
const bonusShort = (b) => (b.state === 'got' ? '獲得' : b.state === 'no' ? '無理' : `あと${b.need}`);
const bonusLong = (b) => (b.state === 'got' ? `ボーナス獲得 +${BONUS}` : b.state === 'no' ? 'ボーナスは無理' : `ボーナス（${BONUS_AT}点以上で+${BONUS}点）まであと${b.need}点`);
// 欄の中の2行目（小さい字）
function subLine(text, color) {
  const sm = document.createElement('span');
  sm.style.cssText = `display:block;font-size:.58rem;letter-spacing:-.03em;line-height:1.15;font-weight:400;${color ? `color:${color};` : ''}`;
  sm.textContent = text;
  return sm;
}
const totalOfPl = (x) => totalOf(x.sheet, x.extra ?? 0);
// ジョーカー（詳細設定）が効く出目か: ヨットの役がもう埋まっていて、5個そろっている
const jokerOn = (s, x, d = x.dice) => !!s.joker && x.sheet[11] !== null && scoreOf(11, d) === 50;
// 人 x がこの出目 d を役 cat に書いたときの点（ジョーカーならストレートも満点）
export function catScore(s, x, cat, d = x.dice) {
  if (jokerOn(s, x, d) && (cat === 9 || cat === 10)) return cat === 9 ? 15 : 30;
  return scoreOf(cat, d);
}
// この出目を役 cat に書くと 2回目からのヨットのボーナスが付くか
const yachtBonus = (s, x, cat) => !!s.bonusYacht && cat !== 11 && x.sheet[11] === 50 && scoreOf(11, x.dice) === 50;

// 人 p の、回 r の k 振り目のサイコロ5個ぶんの目（残すかどうかに関係なく、毎回同じ5つの数を作る）
function rollDice(seed, p, r, k) {
  const rng = mulberry32((seed ^ Math.imul(p + 1, 0x9e3779b1) ^ Math.imul(r * 4 + k + 1, 0x85ebca6b)) >>> 0);
  return Array.from({ length: 5 }, () => 1 + Math.floor(rng() * 6));
}

const clone = (s) => ({ ...s, pl: s.pl.map((x) => ({ ...x, dice: x.dice.slice(), sheet: x.sheet.slice() })) });
const filled = (x) => x.sheet.filter((v) => v !== null).length;

/* ---------- CPU ---------- */

// それぞれの役の「ふつうに取れる点」。これより高い点が書けるほど得とみなす（0点を書くならいちばん損の少ない役）
const PAR = [2, 5, 8.5, 12, 15.5, 19, 22, 12, 15, 10, 8, 6];

function bestCat(s, x, d) {
  let best = null;
  let bv = -Infinity;
  x.sheet.forEach((v, cat) => {
    if (v !== null) return;
    const sc = catScore(s, x, cat, d);
    const val = sc - PAR[cat] + Math.random() * 3; // 少し気まぐれに（弱めるため）
    if (val > bv) { bv = val; best = cat; }
  });
  return { cat: best, val: bv };
}

// 残すサイコロ: ストレートが空いていて4つ以上続きそうならそれ、ほかは一番多い目（同じなら大きい目）
function keepFor(x, d) {
  const c = counts(d);
  const open = (cat) => x.sheet[cat] === null;
  if ((open(9) || open(10)) && run(c) >= 3) {
    let from = 1;
    for (let v = 1; v <= 3; v++) if (c[v] && c[v + 1] && c[v + 2]) from = v;
    const want = new Set([from, from + 1, from + 2, from + 3]);
    const used = new Set();
    return d.map((v) => { if (want.has(v) && !used.has(v)) { used.add(v); return true; } return false; });
  }
  let top = 1;
  for (let v = 1; v <= 6; v++) if (c[v] > c[top] || (c[v] === c[top] && v > top)) top = v;
  return d.map((v) => v === top);
}

export default {
  id: 'yacht',
  name: 'ヨット',
  icon: '🎲',
  desc: 'サイコロ5個を3回まで振って役を作る。全員同時に12回。点の合計が多い人の勝ち',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'bonusYacht', label: '2回目のヨット', desc: 'ヨットの役に50点を書いたあとで、もう一度5個そろえたら +100点（そのときも、ほかの役を1つ選んで書く）', def: false },
    { key: 'joker', label: 'ジョーカー', desc: 'ヨットの役を書いたあと（0点でも）にまた5個そろえたら、Sストレート・Bストレートにも満点（15点・30点）で書ける', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = {
      n, seed, round: 0, step: 0, bonusYacht: !!rules.bonusYacht,
      pl: Array.from({ length: n }, () => ({ dice: [1, 2, 3, 4, 5], rolls: 0, keep: [false, false, false, false, false], sheet: Array(ROUNDS).fill(null), extra: 0 })),
    };
    if (rules.joker) s.joker = true; // なしのときは局面に何も足さない（今までと同じ形）
    return s;
  },

  turn() { return null; },
  canAct(s, p) { return s.round < ROUNDS && p >= 0 && p < s.n && filled(s.pl[p]) === s.round; },
  phaseText(s, me) {
    if (me >= 0 && me < s.n && !this.canAct(s, me) && s.round < ROUNDS) return `${s.round + 1}回目（全${ROUNDS}回）: ほかの人を待っています…`;
    return `${s.round + 1}回目（全${ROUNDS}回）: みんな同時に振っています`;
  },
  // 鳴らすのは自分の手と、次の回へ進んだときだけ（ほかの人の分まで鳴らすとにぎやかすぎるため）
  sound(a, b, m, me) {
    if (b.round > a.round) return 'turn';
    if (m.p !== me) return null;
    return m.t === 'roll' ? 'stone' : 'pop';
  },
  cpuDelay() { return 700; },

  result(s) {
    if (s.round < ROUNDS) return null;
    const totals = s.pl.map((x) => totalOfPl(x).total);
    const winners = leaders(totals);
    const rk = ranks(totals);
    const ranking = Array.from({ length: s.n }, (_, p) => p).sort((a, b) => rk[a] - rk[b]);
    return { winner: winners[0], winners, ranking };
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },

  apply(s0, m) {
    if (!m || !this.canAct(s0, m.p) || m.r !== s0.round) return null;
    const x0 = s0.pl[m.p];
    if (m.t === 'roll') {
      if (m.k !== x0.rolls + 1 || m.k > 3) return null;
      const keep = Array.isArray(m.keep) && m.keep.length === 5 ? m.keep.map(Boolean) : null;
      if (!keep || (m.k === 1 && keep.some(Boolean))) return null;
      const s = clone(s0);
      const x = s.pl[m.p];
      const fresh = rollDice(s.seed, m.p, s.round, m.k);
      x.dice = x.dice.map((v, i) => (keep[i] ? v : fresh[i]));
      x.keep = keep;
      x.rolls = m.k;
      s.step += 1;
      return s;
    }
    if (m.t === 'score') {
      if (x0.rolls < 1 || !Number.isInteger(m.cat) || m.cat < 0 || m.cat >= ROUNDS || x0.sheet[m.cat] !== null) return null;
      const s = clone(s0);
      const x = s.pl[m.p];
      if (yachtBonus(s, x, m.cat)) x.extra = (x.extra ?? 0) + YACHT_BONUS;
      x.sheet[m.cat] = catScore(s, x, m.cat);
      x.last = m.cat;
      s.step += 1;
      if (s.pl.every((y) => filled(y) === s.round + 1)) {
        s.round += 1;
        for (const y of s.pl) { y.rolls = 0; y.keep = [false, false, false, false, false]; }
      }
      return s;
    }
    return null;
  },

  cpu(s, p) {
    const x = s.pl[p];
    if (x.rolls === 0) return { t: 'roll', r: s.round, k: 1, keep: [false, false, false, false, false] };
    const { cat, val } = bestCat(s, x, x.dice);
    if (x.rolls >= 3 || val >= 15) return { t: 'score', r: s.round, cat };
    const keep = keepFor(x, x.dice);
    if (keep.every(Boolean)) return { t: 'score', r: s.round, cat };
    return { t: 'roll', r: s.round, k: x.rolls + 1, keep };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board yt';
    const view = me ?? 0; // 観戦中は1人目のサイコロを見せる
    const x = s.pl[view];

    // 自分のサイコロ
    if (!res) {
      const box = document.createElement('div');
      box.className = 'yt-box';
      const can = me !== null && this.canAct(s, me);
      const head = document.createElement('div');
      head.className = 'yt-head';
      if (me === null) head.textContent = `${nameP(view)}のサイコロ`;
      else if (!can) head.textContent = 'ほかの人が書き終わるのを待っています…';
      else if (x.rolls === 0) head.textContent = `${s.round + 1}回目: サイコロを振ってください`;
      else if (x.rolls < 3) head.textContent = `残すサイコロを押してから振り直す（あと${3 - x.rolls}回）か、下の表で役をえらぶ`;
      else head.textContent = '下の表で、点を書く役をえらんでください';
      box.append(head);
      const row = document.createElement('div');
      row.className = 'yt-dice';
      // 残すサイコロの選び方は、振るたびに前の振りで残したものから始める
      const key = `${s.seed}:${s.round}:${x.rolls}`;
      if (!(can && x.rolls > 0 && x.rolls < 3)) keeping = [false, false, false, false, false];
      else if (keepKey !== key) { keepKey = key; keeping = x.keep.slice(); }
      // 新しく振った目だけ転がす（ほかの人が動いて描き直したときは転がさない）
      const rolled = x.rolls > 0 && shownRoll !== `${s.seed}:${view}:${key}`;
      shownRoll = `${s.seed}:${view}:${key}`;
      x.dice.forEach((v, i) => {
        const d = document.createElement(can && x.rolls > 0 && x.rolls < 3 ? 'button' : 'div');
        d.className = 'yt-die' + (x.rolls === 0 ? ' blank' : '') + (keeping[i] ? ' kept' : '');
        if (x.rolls > 0) d.innerHTML = pips(v);
        if (rolled && !x.keep[i]) d.classList.add('roll');
        if (d.tagName === 'BUTTON') {
          d.type = 'button';
          d.setAttribute('aria-label', `${v}の目${keeping[i] ? '（残す）' : ''}`);
          d.onclick = () => { keeping[i] = !keeping[i]; this.render(root, s, o); };
        }
        row.append(d);
      });
      box.append(row);
      if (can && x.rolls < 3) {
        const act = document.createElement('div');
        act.className = 'cc-actions';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn primary';
        b.textContent = x.rolls === 0 ? 'サイコロを振る' : `残りを振り直す（${x.rolls + 1}回目）`;
        b.disabled = keeping.every(Boolean);
        b.onclick = () => o.onMove({ t: 'roll', r: s.round, k: x.rolls + 1, keep: x.rolls === 0 ? [false, false, false, false, false] : keeping.slice() });
        act.append(b);
        box.append(act);
      }
      root.append(box);
    }

    // 点数の表（自分が左。自分の空いた欄には、いま書いたときの点を出して押せるようにする）
    const order = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    const wrap = document.createElement('div');
    wrap.className = 'yt-table';
    const table = document.createElement('table');
    const thead = document.createElement('tr');
    thead.innerHTML = '<th>役</th>' + order.map((p) => {
      const waiting = !res && this.canAct(s, p);
      return `<th class="${p === me ? 'mine' : ''}${res?.winners.includes(p) ? ' won' : ''}"><span class="yt-name">${esc(nameP(p))}</span>${waiting ? '<small>考え中</small>' : res ? '' : '<small>✓</small>'}${o.away[p] ? '<small>応答なし</small>' : ''}</th>`;
    }).join('');
    table.append(thead);
    const canScore = me !== null && this.canAct(s, me) && s.pl[me].rolls > 0;
    const addRow = (label, cell, cls = '') => {
      const tr = document.createElement('tr');
      if (cls) tr.className = cls;
      const th = document.createElement('th');
      th.textContent = label;
      tr.append(th);
      for (const p of order) tr.append(cell(p));
      table.append(tr);
    };
    CATS.forEach((label, cat) => {
      addRow(label, (p) => {
        const td = document.createElement('td');
        const v = s.pl[p].sheet[cat];
        if (p === me) td.className = 'mine';
        if (v !== null) {
          td.textContent = v;
          if (s.pl[p].last === cat && !this.canAct(s, p)) td.classList.add('just');
        } else if (p === me && canScore) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'yt-pick';
          const sc = catScore(s, s.pl[me], cat);
          const joker = jokerOn(s, s.pl[me]) && (cat === 9 || cat === 10);
          const plus = yachtBonus(s, s.pl[me], cat) ? YACHT_BONUS : 0;
          b.textContent = plus ? `${sc}+${plus}` : sc;
          if (!sc && !plus) b.classList.add('zero');
          // 1〜6 の役: ここに書いたあとのボーナスの見込みを小さく出す（まだ届くかどうかの途中のときだけ）
          let ahead = '';
          if (cat < 6 && bonusInfo(s.pl[me].sheet).state === 'need') {
            const after = bonusInfo(s.pl[me].sheet.map((v, c) => (c === cat ? sc : v)));
            ahead = bonusLong(after);
            b.style.padding = '1px 2px';
            b.append(subLine(bonusShort(after), after.state === 'no' ? '#b54a3c' : after.state === 'got' ? 'var(--p2)' : 'var(--muted)'));
          }
          b.setAttribute('aria-label', `${label}に ${sc}点を書く${joker ? '（ジョーカー）' : ''}${plus ? `（ヨットのボーナス +${plus}点）` : ''}${ahead ? `。書くと ${ahead}` : ''}`);
          if (ahead) b.title = `書くと ${ahead}`;
          if (joker) { b.style.padding = '1px 2px'; b.append(subLine('ジョーカー', 'var(--p2)')); b.title = 'ジョーカー: 5個そろいをストレートに満点で書ける'; }
          b.onclick = () => { if (sc || confirm(`${label}に 0点を書きますか？`)) o.onMove({ t: 'score', r: s.round, cat }); };
          td.append(b);
        }
        return td;
      }, cat === 5 ? 'sep' : '');
      if (cat === 5) {
        addRow(`ボーナス`, (p) => { // 1〜6 の合計が63点以上で +35。足りないうちは「いま/63」と、あと何点か（届かなくなったら「無理」）
          const td = document.createElement('td');
          const b = bonusInfo(s.pl[p].sheet);
          td.className = 'yt-sub' + (p === me ? ' mine' : '');
          td.textContent = b.state === 'got' ? `+${BONUS}` : `${b.upper}/${BONUS_AT}`;
          td.append(subLine(bonusShort(b), b.state === 'got' ? 'var(--p2)' : b.state === 'no' ? '#b54a3c' : ''));
          td.title = bonusLong(b);
          return td;
        }, 'bonus');
        table.lastChild.firstChild.append(subLine(`${BONUS_AT}点で+${BONUS}`));
      }
    });
    if (s.bonusYacht) {
      addRow('ヨット追加', (p) => { // 2回目からのヨット（詳細設定）。そろえるたびに +100
        const td = document.createElement('td');
        td.className = 'yt-sub' + (p === me ? ' mine' : '');
        td.textContent = s.pl[p].extra ? `+${s.pl[p].extra}` : '−';
        return td;
      }, 'bonus');
    }
    addRow('合計', (p) => {
      const td = document.createElement('td');
      td.className = 'yt-total' + (p === me ? ' mine' : '');
      td.textContent = totalOfPl(s.pl[p]).total;
      return td;
    }, 'total');
    wrap.append(table);
    root.append(wrap);
  },
};

let keeping = [false, false, false, false, false]; // 残すサイコロ（この端末だけ。振るまで送らない）
let keepKey = '';

let shownRoll = ''; // いちばん最近に転がして見せた振り

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function pips(v) {
  let h = '';
  for (let k = 0; k < 9; k++) h += `<i${PIPS[v].includes(k) ? ' class="on"' : ''}></i>`;
  return h;
}
