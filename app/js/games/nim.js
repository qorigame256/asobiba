// 石取りゲーム。2〜6人が順番に、1つの山から石を取る。
// 山は1つで15〜30個。1回に取れるのは1個から最大数まで。最大数は3〜5個のどれかを対局の始めに決め、その対局の間は変わらない
// （どちらも seed から作るので全員同じ。本人の決定・2026-10-03。前は「山いくつか」も選べたが、山1つだけにした）。
// 詳細設定「1回に取れる数」（2026-10-06 本人の決定）: おまかせ（最初。上のとおり3〜5個のどれか）／3個まで／4個まで／5個まで。
// 最後の1個を取った人の負け（詳細設定で「勝ち」にもできる）。3人以上のときも負けは1人だけ。
// 詳細設定「勝ち負け」の「取った数で勝負」（rules.last = 'count'。2026-10-07 本人の決定）: 山がなくなったとき、取った石の合計がいちばん多い人の勝ち
// （同じ数なら同着。最後の1個は関係ない）。取った数は局面の got（プレイヤー番号 → 個数）。got は取った数で勝負のときだけ持つ
// （負け・勝ちのときの局面は前と全く同じ）。
// 手: { p, t: 'take', pile: 0, k: 取る数 }（pile は山の番号。山は1つなので常に 0）

import { mulberry32 } from './util.js';

function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }

const maxOf = (s) => Math.min(s.max, s.piles[0]);

function legalMoves(s) {
  return Array.from({ length: maxOf(s) }, (_, i) => ({ pile: 0, k: i + 1 }));
}

// 筋の良い手（2人のときの必勝法。3人以上でも同じ考えで打つ）。残りを「最大数＋1」の倍数（負けルールは倍数＋1）にする。無ければ null
export function goodMove(s) {
  const size = s.piles[0];
  const k = s.rules.last === 'lose' ? (size - 1) % (s.max + 1) : size % (s.max + 1);
  return k >= 1 && k <= maxOf(s) ? { pile: 0, k } : null;
}

const counting = (s) => s.rules.last === 'count';
const clone = (s) => ({ ...s, piles: s.piles.slice(), ...(s.got ? { got: s.got.slice() } : {}) });

let picked = null; // { step, pile, k } 取る石を選んでいるところ

export default {
  id: 'nim',
  name: '石取りゲーム',
  icon: '🪨',
  desc: '順番に山から石を取る（1回に取れる数は3〜5個のどれかまで）。最後の1個を取らされた人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'max', label: '1回に取れる数', desc: 'おまかせは対局ごとに3〜5個のどれか', def: 0, choices: [[0, 'おまかせ'], [3, '3個まで'], [4, '4個まで'], [5, '5個まで']] },
    // 鍵と値（last・lose・win）は前のまま（前の部屋の設定がそのまま使えるように）。count は 2026-10-07 に足した
    { key: 'last', label: '勝ち負け', desc: '最後の1個を取った人が負け・勝ち、または取った石の数で勝負', def: 'lose', choices: [['lose', '最後の1個で負け'], ['win', '最後の1個で勝ち'], ['count', '取った数で勝負']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    const r = { last: 'lose', ...rules };
    const piles = [int(rng, 15, 30)];
    const max = [3, 4, 5].includes(rules.max) ? rules.max : int(rng, 3, 5);
    const s = { n, rules: r, piles, start: piles.slice(), max, turn: 0, ender: null, step: 0, last: null };
    if (counting(s)) s.got = Array(n).fill(0);
    return s;
  },

  turn(s) { return s.ender === null ? s.turn : null; },
  canAct(s, p) { return s.ender === null && s.turn === p; },

  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound() { return 'stone'; },
  result(s) {
    if (s.ender === null) return null;
    if (counting(s)) {
      // 取った数で勝負: いちばん多い人の勝ち（同じ数なら全員）
      const best = Math.max(...s.got);
      const winners = s.got.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
      const ranking = Array.from({ length: s.n }, (_, p) => p).sort((a, b) => s.got[b] - s.got[a]);
      return { winner: winners[0], winners, ranking, got: s.got.slice(), ender: s.ender };
    }
    const lose = s.rules.last === 'lose';
    // 最後を取った人が負けのとき、2人なら相手の勝ち。3人以上は「負けが1人」として表す
    const winner = lose ? (s.n === 2 ? 1 - s.ender : null) : s.ender;
    return { winner, loser: lose ? s.ender : null, ender: s.ender };
  },

  resultText(res, me, pn) {
    if (res.winners) {
      const best = res.got[res.winners[0]];
      if (res.winners.includes(me)) {
        const others = res.winners.filter((p) => p !== me);
        return `${best}個取って、あなたの勝ち！🎉${others.length ? `（${others.map(pn).join('・')}と同点）` : ''}`;
      }
      return `${res.winners.map(pn).join('・')}が${best}個取って勝ち！`;
    }
    if (res.loser === null) return res.winner === me ? '最後の1個を取って、あなたの勝ち！🎉' : `${pn(res.winner)}が最後の1個を取って勝ち！`;
    if (res.loser === me) return '最後の1個を取ってしまった…あなたの負け';
    if (res.winner === me) return '相手が最後の1個を取った！あなたの勝ち！🎉';
    return `${pn(res.loser)}が最後の1個を取って負け！`;
  },

  info(s) {
    const base = `この対局は1回に1〜${s.max}個まで取れます`;
    return counting(s) ? `${base}。山がなくなったとき、取った石がいちばん多い人の勝ち` : base;
  },

  apply(s0, m) {
    if (!m || m.t !== 'take' || !this.canAct(s0, m.p)) return null;
    if (m.pile !== 0 || !Number.isInteger(m.k) || m.k < 1 || m.k > maxOf(s0)) return null;
    const s = clone(s0);
    s.piles[m.pile] -= m.k;
    s.step += 1;
    s.last = { p: m.p, pile: m.pile, k: m.k };
    if (counting(s)) s.got[m.p] += m.k;
    if (s.piles.every((v) => v === 0)) s.ender = m.p;
    else s.turn = (s.turn + 1) % s.n;
    return s;
  },

  // CPU: 3割は取れる手から適当に、残りは筋の良い手（無ければ1個だけ取って様子を見る）。
  // 取った数で勝負のときは、残りの7割は取れるだけ取る
  cpu(s) {
    const list = legalMoves(s);
    if (counting(s) && Math.random() > 0.3) return { t: 'take', pile: 0, k: maxOf(s) };
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
      const won = res && (res.winners ? res.winners.includes(p) : res.winner === p || (res.loser !== null && res.loser !== p));
      chip.className = 'cc-opp' + (s.ender === null && s.turn === p ? ' turn' : '') + (won ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      if (counting(s)) { // 取った数で勝負: 取った石の数
        const got = document.createElement('div');
        got.className = 'mm-score nim-got';
        got.textContent = `${s.got[p]}個`;
        chip.append(got);
      }
      if (o.away[p] || (o.sub?.[p])) {
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
      const max = maxOf(s);
      for (let j = 0; j < s.start[pile]; j++) {
        const gone = j >= size;
        const k = size - j; // この石を押すと、ここから右端までを取る
        const ok = can && !gone && k <= max;
        const st = document.createElement(ok ? 'button' : 'span');
        st.className = 'nim-stone' + (gone ? ' gone' : '') + (ok ? ' playable' : '')
          + (picked?.pile === pile && !gone && k <= picked.k ? ' sel' : '')
          + (s.last?.pile === pile && gone && j < size + s.last.k ? ' taken' + (o.fresh ? ' pop' : '') : '');
        if (ok) {
          st.type = 'button';
          st.setAttribute('aria-label', `${k}個取る`);
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
