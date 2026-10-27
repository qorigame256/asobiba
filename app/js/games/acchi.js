// あっち向いてホイ。2〜6人。全員でじゃんけんし、勝った人は指を差す向き、負けた人は顔を向ける向きを同時に選ぶ。
// 2026-10-28 本人の決定（Claude が出した案から本人が選んだ。分かれ目は Claude の推奨を本人が承認）:
//   勝った人の指と同じ向きを負けた人が向いたら、指した人に1点。先に3点取った人の勝ち。向きは上・下・左・右の4つ。
// Claude の判断:
//   - じゃんけんがあいこ（全員同じ・3種類とも出た）なら、じゃんけんをやり直す。
//   - 勝った人が2人以上なら、それぞれの指ごとに数える（同じ負けた人を2人が当てたら2人とも1点）。
//   - 同じ回に目標の点に届いた人が2人以上なら、点の多い人（同じなら同点で両方）の勝ち。詳細設定で目標を 3点（最初）・5点。
//   - 全員が選び終わったら一斉に開く（指スマと同じ。通信の遅れで「ホイ」の瞬間は画面どうしで合わせられないため）。
// 手: { p, t: 'pick', r: 何回目か, v: 'g' | 'c' | 'p'（じゃんけん）| 'u' | 'd' | 'l' | 'r'（向き） }
//   r と「この回はもう選んだか」で、同じ手が2回来ても2回目は反則になる。

const HANDS = { g: '✊', c: '✌️', p: '✋' };
const HAND_NAME = { g: 'グー', c: 'チョキ', p: 'パー' };
const DIRS = ['u', 'd', 'l', 'r'];
const FINGER = { u: '👆', d: '👇', l: '👈', r: '👉' };
const FACE = { u: '⬆️', d: '⬇️', l: '⬅️', r: '➡️' };
const DIR_NAME = { u: '上', d: '下', l: '左', r: '右' };
const BEATS = { g: 'c', c: 'p', p: 'g' };

const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice() });
const goalOf = (s) => (s.rules.goal === 5 ? 5 : 3);
// いまの回に選ぶ人（じゃんけんは全員、ホイは勝った人と負けた人の全員＝じゃんけんに出た人全員）
const choosers = (s) => [...Array(s.n).keys()];
const ended = (s) => Math.max(...s.scores) >= goalOf(s);

// じゃんけんの勝ち負け。あいこなら null、そうでなければ勝った手
export function jankenWinner(hands) {
  const kinds = new Set(hands);
  if (kinds.size !== 2) return null;
  const [a, b] = [...kinds];
  return BEATS[a] === b ? a : b;
}

let sel = { key: null, v: null };

export default {
  id: 'acchi',
  name: 'あっち向いてホイ',
  icon: '👉',
  desc: 'じゃんけんで勝ったら指を差す。同じ向きを向かせたら1点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'goal', label: '目標の点', desc: '先にこの点を取った人の勝ち', def: 3, choices: [[3, '3点'], [5, '5点']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    return { n, rules: { goal: 3, ...rules }, phase: 'janken', r: 1, win: null, hands: null, picks: Array(n).fill(null), scores: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !ended(s) && s.picks[p] === null; },
  result(s) {
    if (!ended(s)) return null;
    const top = Math.max(...s.scores);
    return { winners: s.scores.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0), scores: s.scores };
  },
  sound(a, b, m, me) {
    if (b.r === a.r) return 'pop';
    const L = b.last;
    if (L.kind === 'janken') return L.win === null ? 'pop' : 'question';
    if (L.hits.some(([w]) => w === me)) return 'correct';
    if (L.hits.some(([, l]) => l === me)) return 'wrong';
    return 'pop';
  },
  cpuDelay() { return 900; },
  resultText(res, me, pn) {
    if (res.winners.length === 1) return res.winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(res.winners[0])}の勝ち！`;
    return `${res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同点で勝ち！`;
  },
  phaseText(s, me) {
    const done = s.picks.filter((x) => x !== null).length;
    const what = s.phase === 'janken' ? 'じゃんけん…' : 'あっち向いて…';
    if (me >= 0 && s.picks[me] !== null) return `${what} ほかの人を待っています（${done}/${s.n}人）`;
    return `<b>${what}</b> 選んでください（${done}/${s.n}人が選んだ）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'pick' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!this.canAct(s0, m.p) || m.r !== s0.r) return null;
    const ok = s0.phase === 'janken' ? Object.hasOwn(HANDS, m.v) : DIRS.includes(m.v);
    if (!ok) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.v;
    if (!choosers(s).every((p) => s.picks[p] !== null)) return s;
    // 全員そろったので開く
    const picks = s.picks.slice();
    if (s.phase === 'janken') {
      const win = jankenWinner(picks);
      s.last = { kind: 'janken', r: s.r, picks, win };
      if (win !== null) { s.phase = 'hoi'; s.win = win; s.hands = picks; }
    } else {
      const winners = [], losers = [];
      s.hands.forEach((h, p) => (h === s.win ? winners : losers).push(p));
      const hits = [];
      for (const w of winners) for (const l of losers) if (picks[w] === picks[l]) { hits.push([w, l]); s.scores[w] += 1; }
      s.last = { kind: 'hoi', r: s.r, picks, hands: s.hands, win: s.win, winners, hits };
      s.phase = 'janken';
      s.win = null;
      s.hands = null;
    }
    s.r += 1;
    s.picks = Array(s.n).fill(null);
    return s;
  },

  // CPU: どれも適当に選ぶ
  cpu(s) {
    const list = s.phase === 'janken' ? Object.keys(HANDS) : DIRS;
    return { t: 'pick', r: s.r, v: list[Math.floor(Math.random() * list.length)] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const key = `${s.n}:${s.r}`;
    if (sel.key !== key) sel = { key, v: null };
    const res = this.result(s);
    const L = s.last;
    const anim = o.fresh && s.picks.every((x) => x === null);
    root.innerHTML = '';
    root.className = 'board ys ac';

    if (L) {
      const banner = document.createElement('div');
      banner.className = 'ys-last' + (L.kind === 'hoi' && L.hits.length ? ' hit' : '') + (anim ? ' pop' : '');
      if (L.kind === 'janken') banner.textContent = L.win === null ? 'あいこ！ もう一度じゃんけん' : `${HAND_NAME[L.win]}の勝ち！ あっち向いて…`;
      else if (!L.hits.length) banner.textContent = 'ホイ！ だれも同じ向きを向かなかった';
      else banner.textContent = 'ホイ！ ' + L.hits.map(([w, l]) => `${nameP(w)}が${nameP(l)}を${DIR_NAME[L.picks[w]]}に向かせた（+1点）`).join('、');
      root.append(banner);
    }

    // 全員（前の回に出したものを出す）
    const grid = document.createElement('div');
    grid.className = 'ys-players';
    const seats = me === null ? [...Array(s.n).keys()] : [...Array(s.n).keys()].map((k) => (me + k) % s.n);
    const top = Math.max(...s.scores);
    for (const p of seats) {
      const box = document.createElement('div');
      const winSide = s.phase === 'hoi' && s.hands[p] === s.win;
      box.className = 'ys-player' + (p === me ? ' mine' : '') + (winSide ? ' parent' : '');
      const head = document.createElement('div');
      head.className = 'ys-name';
      head.textContent = nameP(p);
      const tags = [];
      if (res) { if (res.winners.includes(p)) tags.push(['rank', '勝ち']); }
      else {
        if (s.phase === 'hoi') tags.push(winSide ? ['last', '指す'] : ['away', '向く']);
        tags.push(s.picks[p] !== null ? ['ok', '選んだ✓'] : ['away', '考え中…']);
      }
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        head.append(t);
      }
      const show = document.createElement('div');
      show.className = 'ys-thumbs' + (anim ? ' pop' : '');
      if (L?.kind === 'janken') show.textContent = HANDS[L.picks[p]];
      else if (L?.kind === 'hoi') show.textContent = L.hands[p] === L.win ? FINGER[L.picks[p]] : '🙂' + FACE[L.picks[p]];
      else show.textContent = '❔';
      const pts = document.createElement('div');
      pts.className = 'ys-left';
      pts.textContent = `${s.scores[p]}点` + (s.scores[p] === top && top > 0 && !res ? ' 👑' : '');
      box.append(head, show, pts);
      grid.append(box);
    }
    root.append(grid);

    const note = (t) => { const x = document.createElement('p'); x.className = 'cc-log'; x.textContent = t; root.append(x); };
    if (res) return;
    if (me === null) { note(`観戦中（${goalOf(s)}点先取）`); return; }
    if (!o.canMove) {
      const v = s.picks[me];
      note(`${s.phase === 'janken' ? HAND_NAME[v] : DIR_NAME[v] + 'を'}で決めました。ほかの人を待っています…`);
      return;
    }

    const box = document.createElement('div');
    box.className = 'ys-pick';
    const h = document.createElement('div');
    h.className = 'cc-hand-head';
    const iWon = s.phase === 'hoi' && s.hands[me] === s.win;
    h.textContent = s.phase === 'janken' ? `じゃんけん…（${goalOf(s)}点先取）` : iWon ? 'あなたの勝ち！ 指を差す向きを選ぶ' : '負けた… 顔を向ける向きを選ぶ（指と同じ向きなら相手に1点）';
    const row = document.createElement('div');
    row.className = 'ys-choices ac-choices';
    const opts = s.phase === 'janken' ? Object.keys(HANDS) : DIRS;
    for (const v of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ys-choice ac-choice' + (sel.v === v ? ' on' : '');
      b.textContent = s.phase === 'janken' ? HANDS[v] : iWon ? FINGER[v] : FACE[v];
      b.title = s.phase === 'janken' ? HAND_NAME[v] : DIR_NAME[v];
      b.setAttribute('aria-label', b.title);
      b.onclick = () => { sel.v = v; o.onMove({ t: 'pick', r: s.r, v }); };
      row.append(b);
    }
    box.append(h, row);
    root.append(box);
  },
};
