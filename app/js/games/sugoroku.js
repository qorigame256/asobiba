// すごろく。順番にさいころを振ってコマを進め、30マス目のゴールを目指す。2〜6人・足りない分は CPU。
// 2026-10-29 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 30マス。「進む・戻る・1回休み・もう1回振る・だれかと入れ替え」のマスを、毎回ばらばらに置く。
//   - ちょうどでなくてもゴール。詳細設定「ゴール」で「ぴったりでないと戻る」も選べる（多すぎた分だけゴールから戻る）。
//   - 1位が決まったら終わり。ほかの人はゴールに近い順に順位（同じマスなら同じ順位）。
// Claude の判断:
//   - マスの置き方（種から）: 2〜28マス目のうち12マスに、進む（2か3）・戻る（2か3）を3つずつ、1回休み・もう1回振る・入れ替えを2つずつ。
//     進むマスはその先が29マス目を超えない所だけに置く（進むだけでゴールしないように）。
//   - 進む・戻る・入れ替えで動いた先のマスは働かない（続けて飛ばされて分かりにくくならないように）。ぴったりで戻ったときも、戻った先のマスは働く。
//   - 入れ替えのマスに止まったら、だれと入れ替えるかを自分で選ぶ（CPU はいちばん先にいる人を選ぶ）。
//   - さいころの目は種と振った回数から決める（全員の端末で同じ目になる。手には目を入れない）。
//   - 1回休みは、次に自分の番が来たときに飛ばす。
// 手: { p, t: 'roll' } / { p, t: 'swap', to: 入れ替える相手の番号 }

import { mulberry32, shuffle } from './util.js';
import { SEAT_COLORS } from './party.js';

export const GOAL = 30;
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const EV = {
  fwd: (v) => ({ icon: '⏩', label: `${v}マス進む` }),
  back: (v) => ({ icon: '⏪', label: `${v}マス戻る` }),
  skip: () => ({ icon: '💤', label: '1回休み' }),
  again: () => ({ icon: '🔁', label: 'もう1回振る' }),
  swap: () => ({ icon: '🔄', label: 'だれかと入れ替え' }),
};
export const evOf = (cell) => (cell ? EV[cell.t](cell.v) : null);

// 種からマスを置く。返り値は 0〜30 マス目の中身（null か { t, v }）
export function makeBoard(seed) {
  const rnd = mulberry32((seed ^ 0x2545f491) >>> 0);
  const board = Array(GOAL + 1).fill(null);
  const kinds = [];
  for (let i = 0; i < 3; i++) kinds.push({ t: 'fwd', v: 2 + Math.floor(rnd() * 2) }, { t: 'back', v: 2 + Math.floor(rnd() * 2) });
  for (let i = 0; i < 2; i++) kinds.push({ t: 'skip' }, { t: 'again' }, { t: 'swap' });
  const spots = shuffle(Array.from({ length: 27 }, (_, i) => i + 2), rnd);
  for (const k of shuffle(kinds, rnd)) {
    const i = spots.findIndex((x) => board[x] === null && (k.t !== 'fwd' || x + k.v <= GOAL - 1));
    board[spots.splice(i, 1)[0]] = k;
  }
  return board;
}
export function diceOf(s, k = s.rolls) {
  const rng = mulberry32((s.seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0);
  return 1 + Math.floor(rng() * 6);
}
const clone = (s) => ({ ...s, pos: s.pos.slice(), rest: s.rest.slice() });

// 次の人へ（1回休みの人は飛ばす）。飛ばした人を返す
function nextTurn(s) {
  const skipped = [];
  let t = (s.turn + 1) % s.n;
  while (s.rest[t]) { s.rest[t] = false; skipped.push(t); t = (t + 1) % s.n; }
  s.turn = t;
  return skipped;
}

export default {
  id: 'sugoroku',
  name: 'すごろく',
  icon: '🎲',
  desc: 'さいころを振ってゴールを目指す。進む・戻る・1回休み・入れ替えのマスあり',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'exact', label: 'ぴったりでゴール', desc: 'ぴったりの目でないと、多すぎた分だけゴールから戻る', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { exact: false, ...rules };
    return { n, seed, rules: r, board: makeBoard(seed), pos: Array(n).fill(0), rest: Array(n).fill(false), turn: 0, phase: 'roll', rolls: 0, last: null, step: 0 };
  },

  turn(s) { return s.phase === 'end' ? null : s.turn; },
  canAct(s, p) { return s.phase !== 'end' && s.turn === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    const w = s.pos.indexOf(GOAL);
    const place = s.pos.map((v) => 1 + s.pos.filter((x) => x > v).length);
    return { winner: w, winners: [w], place };
  },
  resultText(res, me, pn) { return res.winner === me ? 'ゴール！あなたの勝ち！🎉' : `${pn(res.winner)}がゴールして勝ち！`; },
  sound(a, b, m) {
    if (m.t === 'swap') return 'pop';
    const ev = b.last?.ev?.t;
    if (ev === 'fwd' || ev === 'again') return 'correct';
    if (ev === 'back' || ev === 'skip') return 'wrong';
    return 'dice';
  },

  apply(s0, m) {
    if (!m || !this.canAct(s0, m.p)) return null;
    const p = m.p;
    if (m.t === 'swap') {
      if (s0.phase !== 'swap' || !Number.isInteger(m.to) || m.to < 0 || m.to >= s0.n || m.to === p) return null;
      const s = clone(s0);
      s.step += 1;
      [s.pos[p], s.pos[m.to]] = [s.pos[m.to], s.pos[p]];
      s.phase = 'roll';
      s.last = { p, swapWith: m.to, skipped: nextTurn(s) };
      return s;
    }
    if (m.t !== 'roll' || s0.phase !== 'roll') return null;
    const s = clone(s0);
    s.step += 1;
    const d = diceOf(s0);
    s.rolls += 1;
    const from = s.pos[p];
    let land = from + d;
    let bounce = false;
    if (land > GOAL) {
      if (s.rules.exact) { land = GOAL - (land - GOAL); bounce = true; } else land = GOAL;
    }
    const L = { p, d, from, land, bounce, ev: null, to: land, skipped: [] };
    s.pos[p] = land;
    if (land === GOAL) { s.phase = 'end'; s.last = L; return s; }
    const ev = s.board[land];
    L.ev = ev;
    let again = false;
    if (ev?.t === 'fwd') s.pos[p] = Math.min(GOAL - 1, land + ev.v);
    else if (ev?.t === 'back') s.pos[p] = Math.max(0, land - ev.v);
    else if (ev?.t === 'skip') s.rest[p] = true;
    else if (ev?.t === 'again') again = true;
    else if (ev?.t === 'swap') s.phase = 'swap';
    L.to = s.pos[p];
    if (!again && s.phase !== 'swap') L.skipped = nextTurn(s);
    s.last = L;
    return s;
  },

  // CPU: いつも振る。入れ替えは、いちばん先にいる人と（自分より後ろしかいなくても、いちばん前の人と）
  cpuDelay(s) { return s.phase === 'swap' ? 1200 : 900; },
  cpu(s, p) {
    if (s.phase === 'swap') {
      const others = [...Array(s.n).keys()].filter((q) => q !== p);
      const best = Math.max(...others.map((q) => s.pos[q]));
      const top = others.filter((q) => s.pos[q] === best);
      return { t: 'swap', to: top[Math.floor(Math.random() * top.length)] };
    }
    return { t: 'roll' };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const res = this.result(s);
    root.innerHTML = '';
    root.className = 'board sgr';

    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.phase !== 'end' && s.turn === p ? ' turn' : '') + (res?.winner === p ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.innerHTML = `<span class="sgr-dot" style="background:${SEAT_COLORS[p]}">${p + 1}</span>`;
      name.append(nameP(p));
      const st = document.createElement('div');
      st.className = 'pt-extra';
      st.textContent = s.pos[p] === GOAL ? '🏁 ゴール' : `${s.pos[p]}マス目${res ? `・${res.place[p]}位` : ''}`;
      chip.append(name, st);
      if (s.rest[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag', textContent: '💤 1回休み' }));
      if (o.away[p] || o.sub?.[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag away', textContent: o.away[p] ? '応答なし' : 'CPU が代わりに' }));
      chips.append(chip);
    }
    root.append(chips);

    // 盤（8マスずつ、行ごとに向きを変えて並べる）
    const grid = document.createElement('div');
    grid.className = 'sgr-board';
    const COLS = 8;
    const rows = Math.ceil((GOAL + 1) / COLS);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < COLS; k++) {
        const i = r * COLS + (r % 2 ? COLS - 1 - k : k);
        const cell = document.createElement('div');
        if (i > GOAL) { cell.className = 'sgr-cell none'; grid.append(cell); continue; }
        const ev = evOf(s.board[i]);
        cell.className = 'sgr-cell' + (i === 0 ? ' start' : i === GOAL ? ' goal' : '') + (ev ? ' ev ' + s.board[i].t : '')
          + (s.last && i === s.last.to && o.fresh ? ' pop' : '');
        cell.title = ev ? ev.label : '';
        cell.innerHTML = `<span class="sgr-n">${i === 0 ? 'スタート' : i === GOAL ? 'ゴール' : i}</span><span class="sgr-ev">${i === 0 ? '🏠' : i === GOAL ? '🏁' : ev ? ev.icon + (s.board[i].v ?? '') : ''}</span>`;
        const toks = document.createElement('div');
        toks.className = 'sgr-toks';
        for (let p = 0; p < s.n; p++) if (s.pos[p] === i) toks.insertAdjacentHTML('beforeend', `<span class="sgr-dot" style="background:${SEAT_COLORS[p]}">${p + 1}</span>`);
        cell.append(toks);
        grid.append(cell);
      }
    }
    root.append(grid);
    root.insertAdjacentHTML('beforeend', '<p class="sgr-legend">⏩ 進む ⏪ 戻る 💤 1回休み 🔁 もう1回 🔄 入れ替え</p>');

    // さっき起きたこと
    const log = document.createElement('div');
    log.className = 'sgr-log';
    const L = s.last;
    if (L) {
      if (L.swapWith !== undefined) log.textContent = `🔄 ${nameP(L.p)}と${nameP(L.swapWith)}が入れ替わった`;
      else {
        const die = document.createElement('span');
        die.className = 'sgr-die' + (o.fresh ? ' pop' : '');
        die.textContent = DICE[L.d];
        const ev = evOf(L.ev);
        const t = document.createElement('span');
        t.textContent = `${nameP(L.p)}が ${L.d} を出して${L.land === GOAL ? 'ゴール！' : `${L.land}マス目へ`}${L.bounce ? '（多すぎた分だけ戻った）' : ''}`
          + (ev ? `。${ev.icon} ${ev.label}${L.to !== L.land ? ` → ${L.to}マス目` : ''}` : '');
        log.append(die, t);
      }
      if (L.skipped?.length) log.append(Object.assign(document.createElement('div'), { className: 'kj-sub', textContent: `💤 ${L.skipped.map(nameP).join('・')}は1回休み` }));
    } else log.textContent = 'さいころを振って、ゴールを目指そう';
    root.append(log);

    if (!o.canMove || s.phase === 'end') return;
    const act = document.createElement('div');
    act.className = 'cc-actions';
    if (s.phase === 'swap') {
      act.insertAdjacentHTML('beforeend', '<p class="cc-log">🔄 だれと入れ替える？</p>');
      for (let q = 0; q < s.n; q++) {
        if (q === s.turn) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.textContent = `${nameP(q)}（${s.pos[q]}マス目）`;
        b.onclick = () => o.onMove({ t: 'swap', to: q });
        act.append(b);
      }
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn primary sgr-roll';
      b.textContent = '🎲 さいころを振る';
      b.onclick = () => { b.disabled = true; o.onMove({ t: 'roll' }); };
      act.append(b);
    }
    root.append(act);
  },
};
