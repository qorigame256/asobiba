// ビンゴ。2〜10人・足りない分は CPU。数字が自動で出て、カードの縦・横・ななめのどれか1列がそろったら上がり。
// 2026-10-29 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - カードは 1〜75 の 5×5（B 1〜15・I 16〜30・N 31〜45・G 46〜60・O 61〜75）、真ん中は最初から開いている。
//   - 数字は3秒ごとに自動で出し、声でも読み上げる（🔊 に従う。詳細設定「読み上げ」で切れる）。
//   - 穴は自分で押して開ける（2026-10-30 本人の依頼で最初の設定を「自動」から替えた）。詳細設定「穴の開け方」で「自動」も選べる。
//   - 最初にそろった人が出たら終わり。同じ数字で同時にそろったら同じ順位。詳細設定「終わり方」で「3位まで続ける」も選べる。
//   - 詳細設定「真ん中の FREE」（あり（最初）・なし。2026-10-29 本人が選んだ案）: なしは真ん中も N の列の数字になる。
// Claude の判断:
//   - カードと数字の出る順は種から作る（全員同じ）。カードは席ごとにちがう。
//   - 最初の数字は始まってから2秒。そろう人が出たら、最後の数字を見せるため1.5秒おいて終わる。
//   - 自分で押すとき: 出た数字はあとからでも押せる。そろった順位は「何個目の数字が出ていたときに、その列の最後を押したか」で決める
//     （同じ個数のうちに押せば同時）。だれかがそろって終わる形になったら、次の数字を出さずに2.5秒待って終わる（その間に押せば同時の上がり）。
//     75個出きってもそろわない人がいれば8秒待って終わる。CPU は数字が出てから0.8〜2.2秒で押す。
//   - 3位まで続けるのは3人より多いときだけ（2人なら1人、3人なら2人が決まったら終わり）。決まらなかった人は同じ最下位。
//   - リーチ（あと1つでそろう列がある）は名前の札に出す。
// 手: { p: -1, t: 'draw' | 'end' }（ホストの進行）/ { p, t: 'mark', c: マスの番号 0〜24 }（自分で押すときだけ）

import { mulberry32, shuffle } from './util.js';
import { since } from './party.js';
import { speak } from '../sound.js';

const LETTERS = 'BINGO';
const YOMI = { B: 'ビー', I: 'アイ', N: 'エヌ', G: 'ジー', O: 'オー' };
const FIRST_MS = 2000;
const STEP_MS = 3000;
const END_MS = 1500;
const SELF_END_MS = 2500;
const LAST_MS = 8000;
const LINES = (() => {
  const L = [];
  for (let i = 0; i < 5; i++) {
    L.push([0, 1, 2, 3, 4].map((j) => i * 5 + j));
    L.push([0, 1, 2, 3, 4].map((j) => j * 5 + i));
  }
  L.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);
  return L;
})();

export const letterOf = (v) => LETTERS[Math.floor((v - 1) / 15)];
const selfMark = (s) => s.rules.mark === 'self';
const targetOf = (s) => (Number(s.rules.until) === 3 ? Math.max(1, Math.min(3, s.n - 1)) : 1);
const doneCount = (s) => s.at.filter((v) => v !== null).length;
const drawnSet = (s) => new Set(s.order.slice(0, s.k));
const clone = (s) => ({ ...s, at: s.at.slice(), marks: s.marks ? s.marks.map((m) => m.slice()) : null });

// 席 p のカード（25マス。真ん中は 0 ＝ 最初から開いている。free が false なら真ん中も数字）
export function cardOf(seed, p, free = true) {
  const rng = mulberry32((seed ^ Math.imul(p + 1, 0x9e3779b1)) >>> 0);
  const cols = [0, 1, 2, 3, 4].map((c) => shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1), rng).slice(0, 5));
  const card = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) card.push(free && r === 2 && c === 2 ? 0 : cols[c][r]);
  return card;
}

// マスが開いているか（自動ならカードの数字が出ていれば開いている）
function openOf(s, p, drawn = drawnSet(s)) {
  if (selfMark(s)) return s.marks[p];
  return s.cards[p].map((v) => v === 0 || drawn.has(v));
}
export function linesOf(open) { return LINES.filter((l) => l.every((i) => open[i])); }
const reachOf = (open) => LINES.some((l) => l.filter((i) => open[i]).length === 4);

let spoken = null;
const cpuPlan = new Map();

export default {
  id: 'bingo',
  name: 'ビンゴ',
  icon: '🎱',
  desc: '自動で出る数字でカードに穴を開け、縦・横・ななめを1列そろえたら上がり',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'mark', label: '穴の開け方', desc: '自分で押すと、押し忘れると遅れる', def: 'self', choices: [['self', '自分で押す'], ['auto', '自動']] },
    { key: 'until', label: '終わり方', desc: '3位まで続けると、1人上がっても続く', def: 1, choices: [[1, '1人上がったら終わり'], [3, '3位まで続ける']] },
    { key: 'voice', label: '読み上げ', desc: '出た数字を声でも読む（🔇 のときは読まない）', def: true },
    { key: 'free', label: '真ん中の FREE', desc: 'なしにすると真ん中も数字になり、そろいにくくなる', def: true },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { mark: 'self', until: 1, voice: true, free: true, ...rules };
    const cards = Array.from({ length: n }, (_, p) => cardOf(seed, p, r.free !== false));
    const order = shuffle(Array.from({ length: 75 }, (_, i) => i + 1), mulberry32((seed ^ 0x5bd1e995) >>> 0));
    return {
      n, seed, rules: r, cards, order, k: 0, phase: 'play', step: 0,
      at: Array(n).fill(null), // そろったときに出ていた数字の個数（まだなら null）
      marks: r.mark === 'self' ? cards.map((c) => c.map((v) => v === 0)) : null,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && selfMark(s) && s.at[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    const done = doneCount(s);
    const place = s.at.map((v) => (v === null ? done + 1 : 1 + s.at.filter((w) => w !== null && w < v).length));
    return { winners: place.map((v, p) => (v === 1 && s.at[p] !== null ? p : -1)).filter((p) => p >= 0), place, at: s.at.slice() };
  },
  resultText(res, me, pn) {
    const w = res.winners;
    if (!w.length) return 'だれもそろいませんでした';
    if (w.includes(me)) {
      const others = w.filter((p) => p !== me);
      return `ビンゴ！あなたの勝ち！🎉${others.length ? `（${others.map(pn).join('・')}と同時）` : ''}`;
    }
    return `${w.map(pn).join('・')}${w.length > 1 ? 'が同時に' : 'が'}ビンゴ！`;
  },
  phaseText(s) {
    if (!s.k) return 'まもなく最初の数字が出ます…';
    const v = s.order[s.k - 1];
    return `${s.k}個目の数字は ${letterOf(v)}-${v}`;
  },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t !== 'draw') return null;
      const fresh = b.at.map((v, p) => (v !== null && a.at[p] === null ? p : -1)).filter((p) => p >= 0);
      if (fresh.includes(me)) return 'correct';
      if (fresh.length) return 'call';
      return b.rules.voice ? null : 'pop'; // 読み上げがあるときは声だけ
    }
    if (m.p !== me) return null;
    return b.at[me] !== null && a.at[me] === null ? 'correct' : 'pop';
  },

  referee(s) {
    if (s.phase !== 'play') return null;
    if (doneCount(s) >= targetOf(s)) return { key: 'end' + s.k, ms: selfMark(s) ? SELF_END_MS : END_MS, move: { t: 'end' } };
    if (s.k >= 75) return { key: 'last', ms: LAST_MS, move: { t: 'end' } };
    return { key: 'd' + s.k, ms: s.k ? STEP_MS : FIRST_MS, move: { t: 'draw' } };
  },

  apply(s0, m) {
    if (!m || s0.phase !== 'play') return null;
    if (m.p === -1) {
      if (m.t === 'draw') {
        if (s0.k >= 75 || doneCount(s0) >= targetOf(s0)) return null;
        const s = clone(s0);
        s.k += 1;
        s.step += 1;
        if (!selfMark(s)) {
          const drawn = drawnSet(s);
          for (let p = 0; p < s.n; p++) if (s.at[p] === null && linesOf(openOf(s, p, drawn)).length) s.at[p] = s.k;
        }
        return s;
      }
      if (m.t === 'end') {
        if (doneCount(s0) < targetOf(s0) && s0.k < 75) return null;
        const s = clone(s0);
        s.phase = 'end';
        s.step += 1;
        return s;
      }
      return null;
    }
    if (m.t !== 'mark' || !this.canAct(s0, m.p) || !Number.isInteger(m.c) || m.c < 0 || m.c > 24) return null;
    if (s0.marks[m.p][m.c] || !drawnSet(s0).has(s0.cards[m.p][m.c])) return null;
    const s = clone(s0);
    s.step += 1;
    s.marks[m.p][m.c] = true;
    if (linesOf(s.marks[m.p]).length) s.at[m.p] = s.k;
    return s;
  },

  // CPU（自分で押すときだけ動く）: 数字が出てから 0.8〜2.2秒で、出ている数字のマスを1つずつ押す
  cpuDelay() { return 250; },
  cpu(s, p) {
    if (!this.canAct(s, p)) return null;
    const drawn = drawnSet(s);
    const c = s.cards[p].findIndex((v, i) => !s.marks[p][i] && drawn.has(v));
    if (c < 0) return null;
    const key = `bingo:${s.seed}:${s.k}:${p}`;
    let at = cpuPlan.get(key);
    if (at === undefined) {
      at = 800 + Math.random() * 1400;
      cpuPlan.set(key, at);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(key) >= at ? { t: 'mark', c } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const drawn = drawnSet(s);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board bg';

    // 名前の札（リーチ・ビンゴ）
    const chips = document.createElement('div');
    chips.className = 'cc-opps cc-steady'; // 札の高さと段の数を変えない（party.js の scoreChips の steady と同じ）
    for (let p = 0; p < s.n; p++) {
      const open = openOf(s, p, drawn);
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.at[p] !== null ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      const st = document.createElement('div');
      st.className = 'pt-extra';
      if (s.at[p] !== null) st.innerHTML = `<span class="pt-ok">ビンゴ！${res ? `${res.place[p]}位` : ''}</span>`;
      else if (res) st.textContent = `${res.place[p]}位`;
      else if (reachOf(open)) st.innerHTML = '<span class="bg-reach">リーチ</span>';
      chip.append(name, st);
      if (o.away[p] || o.sub?.[p]) {
        const t = document.createElement('span');
        t.className = 'cc-tag away';
        t.textContent = o.away[p] ? '応答なし' : 'CPU が代わりに';
        chip.append(t);
      }
      chips.append(chip);
    }
    root.append(chips);

    // いま出た数字と、その前の数字
    const ball = document.createElement('div');
    ball.className = 'kj-card bg-now';
    if (s.k) {
      const v = s.order[s.k - 1];
      ball.innerHTML = `<div class="bg-ball${o.fresh ? ' pop' : ''}"><small>${letterOf(v)}</small>${v}</div>`
        + `<div class="bg-prev">${s.order.slice(Math.max(0, s.k - 7), s.k - 1).reverse().map((x) => `<span>${x}</span>`).join('')}</div>`
        + `<div class="kj-sub">${s.k}個目 / 75</div>`;
      const key = `${s.seed}:${s.k}`;
      if (s.rules.voice && s.phase === 'play' && spoken !== key) { spoken = key; speak(`${YOMI[letterOf(v)]}、${v}`, 'bingo'); }
    } else ball.innerHTML = '<div class="kj-word small">よーい…</div><div class="kj-sub">まもなく最初の数字が出ます</div>';
    root.append(ball);

    // カード（観戦の人は1人目のカード）
    const seat = me ?? 0;
    const open = openOf(s, seat, drawn);
    const lit = new Set(linesOf(open).flat());
    const canTap = selfMark(s) && me !== null && o.canMove && this.canAct(s, me);
    const card = document.createElement('div');
    card.className = 'bg-card';
    for (const L of LETTERS) {
      const h = document.createElement('div');
      h.className = 'bg-head';
      h.textContent = L;
      card.append(h);
    }
    s.cards[seat].forEach((v, i) => {
      const cell = document.createElement(canTap ? 'button' : 'div');
      cell.className = 'bg-cell' + (open[i] ? ' open' : '') + (v === 0 ? ' free' : '') + (lit.has(i) ? ' line' : '')
        + (s.k && v === s.order[s.k - 1] && open[i] && o.fresh ? ' pop' : '');
      cell.textContent = v === 0 ? 'FREE' : v;
      if (canTap) {
        cell.type = 'button';
        cell.disabled = open[i];
        // 指が触れた瞬間に押したことにする（click を待つと、ほかの人や CPU の手でカードが作り直されたときに押したのが消えていた。2026-10-30 本人の報告）
        const tap = () => {
          if (!drawn.has(v)) { note.textContent = `${v} はまだ出ていません`; return; }
          o.onMove({ t: 'mark', c: i });
        };
        cell.onpointerdown = (e) => { if (e.button === 0) tap(); };
        cell.onclick = (e) => { if (e.detail === 0) tap(); }; // キーボードで押したとき（指やマウスは上の pointerdown で済んでいる）
      }
      card.append(cell);
    });
    root.append(card);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = `観戦中（${o.names[0]}のカード）`;
    else if (o.watching) note.textContent = `${o.names[me]}のカード`;
    else if (s.at[me] !== null) note.textContent = res ? '' : 'ビンゴ！ほかの人を待っています';
    else if (selfMark(s) && s.phase === 'play') note.textContent = '出た数字のマスを自分で押して穴を開けます';
    root.append(note);
  },
};
