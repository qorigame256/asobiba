// 石取りゲーム。2〜6人が順番に石を取る。
// 「山いくつか」: 山は3〜5つ、1つの山に5〜15個（毎回ばらばら）。自分の番に、1つの山から好きな数だけ取る。
// 「山1つ」: 山は1つで15〜30個（毎回ばらばら）。1回に1〜3個取る。
// 最後の1個を取った人の負け（詳細設定で「勝ち」にもできる）。3人以上のときも負けは1人だけ。
// 手: { p, t: 'take', pile: 山の番号, k: 取る数 }

import { mulberry32 } from './util.js';

const MAX_SINGLE = 3;

function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

function legalMoves(s) {
  const list = [];
  s.piles.forEach((size, pile) => {
    const max = s.rules.mode === 'single' ? Math.min(MAX_SINGLE, size) : size;
    for (let k = 1; k <= max; k++) list.push({ pile, k });
  });
  return list;
}

// 筋の良い手（2人のときの必勝法。3人以上でも同じ考えで打つ）。見つからなければ null
export function goodMove(s) {
  const lose = s.rules.last === 'lose';
  if (s.rules.mode === 'single') {
    const size = s.piles[0];
    const k = lose ? (size - 1) % (MAX_SINGLE + 1) : size % (MAX_SINGLE + 1);
    return k >= 1 && k <= Math.min(MAX_SINGLE, size) ? { pile: 0, k } : null;
  }
  // ニム: 取ったあとの山の大きさの xor（排他的論理和）を 0 にする。最後を取ると負けのときは、
  // 2個以上の山が無くなる場面だけ「1個の山を奇数個残す」に変える
  for (const { pile, k } of legalMoves(s)) {
    const after = s.piles.map((v, i) => (i === pile ? v - k : v));
    const big = after.filter((v) => v > 1).length;
    const ones = after.filter((v) => v === 1).length;
    if (lose && big === 0) {
      if (ones % 2 === 1) return { pile, k };
    } else if (after.reduce((a, v) => a ^ v, 0) === 0) {
      return { pile, k };
    }
  }
  return null;
}

const clone = (s) => ({ ...s, piles: s.piles.slice() });

let picked = null; // { step, pile, k } 取る石を選んでいるところ

export default {
  id: 'nim',
  name: '石取りゲーム',
  icon: '🪨',
  desc: '順番に山から石を取る。最後の1個を取らされた人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'mode', label: '山の形', desc: '山の数と石の数は毎回ばらばら', def: 'multi', choices: [['multi', '山いくつか・1つの山から好きな数'], ['single', '山1つ・1回に1〜3個']] },
    { key: 'last', label: '最後の1個', desc: '最後の1個を取った人が', def: 'lose', choices: [['lose', '負け'], ['win', '勝ち']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    const r = { mode: 'multi', last: 'lose', ...rules };
    const piles = r.mode === 'single'
      ? [int(rng, 15, 30)]
      : Array.from({ length: int(rng, 3, 5) }, () => int(rng, 5, 15));
    return { n, rules: r, piles, start: piles.slice(), turn: 0, ender: null, step: 0, last: null };
  },

  turn(s) { return s.ender === null ? s.turn : null; },
  canAct(s, p) { return s.ender === null && s.turn === p; },

  result(s) {
    if (s.ender === null) return null;
    const lose = s.rules.last === 'lose';
    // 最後を取った人が負けのとき、2人なら相手の勝ち。3人以上は「負けが1人」として表す
    const winner = lose ? (s.n === 2 ? 1 - s.ender : null) : s.ender;
    return { winner, loser: lose ? s.ender : null, ender: s.ender };
  },

  resultText(res, me, pn) {
    if (res.loser === null) return res.winner === me ? '最後の1個を取って、あなたの勝ち！🎉' : `${pn(res.winner)}が最後の1個を取って勝ち！`;
    if (res.loser === me) return '最後の1個を取ってしまった…あなたの負け';
    if (res.winner === me) return '相手が最後の1個を取った！あなたの勝ち！🎉';
    return `${pn(res.loser)}が最後の1個を取って負け！`;
  },

  info(s) {
    return s.rules.mode === 'single' ? '1回に1〜3個まで取れます' : '1つの山から好きな数だけ取れます';
  },

  apply(s0, m) {
    if (!m || m.t !== 'take' || !this.canAct(s0, m.p)) return null;
    const size = s0.piles[m.pile];
    const max = s0.rules.mode === 'single' ? Math.min(MAX_SINGLE, size) : size;
    if (!Number.isInteger(m.pile) || size === undefined || !Number.isInteger(m.k) || m.k < 1 || m.k > max) return null;
    const s = clone(s0);
    s.piles[m.pile] -= m.k;
    s.step += 1;
    s.last = { p: m.p, pile: m.pile, k: m.k };
    if (s.piles.every((v) => v === 0)) s.ender = m.p;
    else s.turn = (s.turn + 1) % s.n;
    return s;
  },

  // CPU: 3割は取れる手から適当に、残りは筋の良い手（無ければ1個だけ取って様子を見る）
  cpu(s) {
    const list = legalMoves(s);
    const good = goodMove(s);
    if (good && Math.random() > 0.3) return { t: 'take', ...good };
    if (!good && Math.random() > 0.3) {
      const pile = s.piles.findIndex((v) => v > 0);
      return { t: 'take', pile, k: 1 };
    }
    const { pile, k } = list[Math.floor(Math.random() * list.length)];
    return { t: 'take', pile, k };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const can = o.canMove;
    if (!can || picked?.step !== s.step) picked = null;
    const draw = () => this.render(root, s, o);

    root.innerHTML = '';
    root.className = 'board nim';

    // 参加者（手番の人を光らせる）
    const res = this.result(s);
    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.ender === null && s.turn === p ? ' turn' : '') + (res && (res.winner === p || (res.loser !== null && res.loser !== p)) ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      if (o.away[p] || (o.cpu[p] && !o.names[p].startsWith('CPU'))) {
        const t = document.createElement('span');
        t.className = 'cc-tag away';
        t.textContent = o.away[p] ? '応答なし' : 'CPU が代わりに';
        chip.append(t);
      }
      chips.append(chip);
    }
    root.append(chips);

    const total = s.piles.reduce((a, v) => a + v, 0);
    const field = document.createElement('div');
    field.className = 'nim-field';
    s.piles.forEach((size, pile) => {
      const row = document.createElement('div');
      row.className = 'nim-pile' + (picked?.pile === pile ? ' picking' : '');
      const label = document.createElement('div');
      label.className = 'nim-label';
      label.textContent = s.piles.length > 1 ? `山${pile + 1}・${size}個` : `残り${size}個`;
      const stones = document.createElement('div');
      stones.className = 'nim-stones';
      const max = s.rules.mode === 'single' ? Math.min(MAX_SINGLE, size) : size;
      for (let j = 0; j < s.start[pile]; j++) {
        const gone = j >= size;
        const k = size - j; // この石を押すと、ここから右端までを取る
        const ok = can && !gone && k <= max;
        const st = document.createElement(ok ? 'button' : 'span');
        st.className = 'nim-stone' + (gone ? ' gone' : '') + (ok ? ' playable' : '')
          + (picked?.pile === pile && !gone && k <= picked.k ? ' sel' : '')
          + (o.fresh && s.last?.pile === pile && gone && j < size + s.last.k ? ' taken' : '');
        if (ok) {
          st.type = 'button';
          st.setAttribute('aria-label', `山${pile + 1}から${k}個取る`);
          st.onclick = () => { picked = { step: s.step, pile, k }; draw(); };
        }
        stones.append(st);
      }
      row.append(label, stones);
      field.append(row);
    });
    root.append(field);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (picked) msg.textContent = `${s.piles.length > 1 ? `山${picked.pile + 1}から` : ''}${picked.k}個取ります`;
    else if (s.last) msg.textContent = `${nameP(s.last.p)}が${s.piles.length > 1 ? `山${s.last.pile + 1}から` : ''}${s.last.k}個取った（残り${total}個）`;
    else if (can) msg.textContent = '取りたい石をタップ（その石から右の石を全部取ります）';
    else msg.textContent = `全部で${total}個`;
    root.append(msg);

    if (picked) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions nim-actions';
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'btn primary';
      take.textContent = `${picked.k}個取る`;
      take.onclick = () => { const { pile, k } = picked; picked = null; o.onMove({ t: 'take', pile, k }); };
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn secondary';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picked = null; draw(); };
      actions.append(cancel, take);
      root.append(actions);
    }
  },
};
