// ペンギンの氷割り。交代で氷を1〜2枚たたき落とし、まん中のペンギンを落とした人の負け。2〜10人・足りない分は CPU（弱め）。
// 2026-11-20 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 盤は 5×5 の氷。まん中の氷にペンギンが乗っていて、まん中はたたけない。
//   - まわりの枠とつながりが切れた氷は、まとめて落ちる。ペンギンの氷が落ちたら、最後にたたいた人の負け。
//     どこが落ちるかは全員に見える（本物のおもちゃのような「どこまでもつか分からない運」は入れない）。
//   - 自分の番に、1枚か2枚を選んでたたく（2枚は離れていてもよい）。
//   - 落とした人が負けで、ほかの人は全員勝ち。1回で決着（シーソーにのせると同じ形）。
// Claude の判断:
//   - 「つながっている」は上下左右のとなりで数える（ななめは数えない）。いちばん外の列の氷は枠に乗っているので、それだけで落ちない。
//   - 氷を押すと選び（もう一度押すと外す。2枚まで）、選んだらどこが落ちるかを薄く見せる。「たたく」で決める。ペンギンが落ちる選び方でもたたける。
//   - 先にたたくのは席0の人から順番。
//   - CPU は、ペンギンが落ちないたたき方の中からでたらめに選ぶ。ただし2割はどのたたき方からでもでたらめに選ぶ（落とすこともある）。
// 手: { p, t: 'hit', c: [たたくマスの番号（0〜24。小さい順・1〜2個）] }

import { SEAT_COLORS, winnersText } from './party.js';

export const N = 5;
export const CENTER = 12;
const isEdge = (i) => i < N || i >= N * (N - 1) || i % N === 0 || i % N === N - 1;
const nbrs = (i) => {
  const r = Math.floor(i / N);
  const c = i % N;
  return [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(([y, x]) => y >= 0 && y < N && x >= 0 && x < N).map(([y, x]) => y * N + x);
};
// 氷 ice（25個の true/false）から、枠とつながっていない氷（落ちるもの）の番号の一覧
export function falling(ice) {
  const keep = new Set();
  const st = [];
  for (let i = 0; i < N * N; i++) if (ice[i] && isEdge(i)) { keep.add(i); st.push(i); }
  while (st.length) {
    const i = st.pop();
    for (const j of nbrs(i)) if (ice[j] && !keep.has(j)) { keep.add(j); st.push(j); }
  }
  return [...Array(N * N).keys()].filter((i) => ice[i] && !keep.has(i));
}
// たたいたあとの氷と、落ちる氷
export function hitResult(ice, cells) {
  const next = ice.slice();
  for (const i of cells) next[i] = false;
  const fell = falling(next);
  for (const i of fell) next[i] = false;
  return { ice: next, fell, drop: fell.includes(CENTER) };
}
const validCells = (ice, c) => Array.isArray(c) && c.length >= 1 && c.length <= 2 && c.every((i) => Number.isInteger(i) && i >= 0 && i < N * N && i !== CENTER && ice[i])
  && (c.length === 1 || c[0] < c[1]);
// たたける組み合わせの全部（1枚と2枚）
export function movesOf(ice) {
  const one = [...Array(N * N).keys()].filter((i) => i !== CENTER && ice[i]);
  const out = one.map((i) => [i]);
  for (let a = 0; a < one.length; a++) for (let b = a + 1; b < one.length; b++) out.push([one[a], one[b]]);
  return out;
}

let picked = null; // 選びかけ { key, cells: [] }

export default {
  id: 'koori',
  name: 'ペンギンの氷割り',
  icon: '🐧',
  desc: '交代で氷を1〜2枚たたき落とす。ペンギンを落とした人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,

  init(n, seed) {
    return { n, seed, ice: Array(N * N).fill(true), turn: 0, phase: 'play', last: null, step: 0, hits: 0 };
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) { return s.phase === 'play' && s.turn === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    const all = [...Array(s.n).keys()];
    return { winners: all.filter((p) => p !== s.last.p), loser: s.last.p };
  },
  resultText(res, me, pn) {
    if (res.loser === me) return '🐧💦 ペンギンが落ちた！あなたの負け…';
    return `🐧💦 ${pn(res.loser)}がペンギンを落とした！${me !== null && me >= 0 ? 'セーフ！あなたの勝ち🎉' : ''}`;
  },
  sound() { return 'hit'; },

  apply(s0, m) {
    if (!m || m.t !== 'hit' || !this.canAct(s0, m.p) || !validCells(s0.ice, m.c)) return null;
    const r = hitResult(s0.ice, m.c);
    const s = { ...s0, ice: r.ice, step: s0.step + 1, hits: s0.hits + 1 };
    s.last = { p: m.p, c: m.c.slice(), fell: r.fell, drop: r.drop };
    if (r.drop) s.phase = 'end';
    else s.turn = (s0.turn + 1) % s.n;
    return s;
  },

  cpuDelay() { return 900; },
  cpu(s) {
    const all = movesOf(s.ice);
    const safe = all.filter((c) => !hitResult(s.ice, c).drop);
    const pool = safe.length && Math.random() >= 0.2 ? safe : all;
    return { t: 'hit', c: pool[Math.floor(Math.random() * pool.length)] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const key = `${s.seed}:${s.step}`;
    const can = o.canMove && s.phase === 'play';
    if (picked?.key !== key || !can) picked = null;
    const sel = picked?.cells ?? [];
    const pre = sel.length ? hitResult(s.ice, sel) : null;
    const draw = () => this.render(root, s, { ...o, fresh: false }); // 選び直しで描き直すときは、さっき落ちた氷の動きを流し直さない
    root.innerHTML = '';
    root.className = 'board koori';

    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.phase === 'play' && s.turn === p ? ' turn' : '') + (res?.winners?.includes(p) ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      if (res && res.loser === p) chip.append(Object.assign(document.createElement('div'), { className: 'pt-extra', innerHTML: '<span class="pt-ng">💦 落とした</span>' }));
      if (o.away[p] || o.sub?.[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag away', textContent: o.away[p] ? '応答なし' : 'CPU が代わりに' }));
      chips.append(chip);
    }
    root.append(chips);

    const pond = document.createElement('div');
    pond.className = 'koori-pond' + (s.phase === 'end' ? ' over' : '');
    const grid = document.createElement('div');
    grid.className = 'koori-grid';
    const fresh = o.fresh && s.last;
    for (let i = 0; i < N * N; i++) {
      const cell = document.createElement(can && i !== CENTER && s.ice[i] ? 'button' : 'div');
      const gone = !s.ice[i];
      const justHit = fresh && s.last.c.includes(i);
      const justFell = fresh && s.last.fell.includes(i);
      let cls = 'koori-cell';
      if (gone) cls += ' gone';
      if (justHit) cls += ' hit';
      else if (justFell) cls += ' fell';
      if (sel.includes(i)) cls += ' sel';
      else if (pre?.fell.includes(i)) cls += ' warn';
      if (i === CENTER) cls += ' mid';
      cell.className = cls;
      if (i === CENTER) {
        const pg = document.createElement('span');
        pg.className = 'koori-peng' + (s.phase === 'end' ? ' sink' : '');
        pg.textContent = '🐧';
        cell.append(pg);
      }
      if (justHit && !gone) cell.style.setProperty('--hit', SEAT_COLORS[s.last.p % SEAT_COLORS.length]);
      if (cell.tagName === 'BUTTON') {
        cell.type = 'button';
        cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}行${(i % N) + 1}列の氷`);
        cell.addEventListener('click', () => {
          const cur = picked?.cells ?? [];
          let next;
          if (cur.includes(i)) next = cur.filter((x) => x !== i);
          else next = cur.length >= 2 ? [cur[1], i] : [...cur, i];
          picked = { key, cells: next.sort((a, b) => a - b) };
          draw();
        });
      }
      grid.append(cell);
    }
    pond.append(grid);
    root.append(pond);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    const lastText = () => {
      if (!s.last) return '';
      const more = s.last.fell.filter((i) => i !== CENTER).length;
      return `${nameP(s.last.p)}が${s.last.c.length}枚たたいた${more ? `（${more}枚いっしょに落ちた）` : ''}。`;
    };
    if (s.phase === 'end') msg.textContent = `${lastText()}ペンギンが落ちた！`;
    else if (pre) {
      const more = pre.fell.filter((i) => i !== CENTER).length;
      msg.textContent = pre.drop ? '💦 これをたたくとペンギンが落ちる！' : `${sel.length}枚えらんだ${more ? `（ほかに${more}枚落ちる）` : ''}。「たたく」で決める`;
    } else msg.textContent = `${lastText()}${can ? '氷を1〜2枚えらぶ' : ''}`; // だれのターンかは上の見出しと順番の帯に出ている
    root.append(msg);

    if (can) {
      const act = document.createElement('div');
      act.className = 'cc-actions';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary';
      go.textContent = sel.length ? (pre.drop ? `たたく（${sel.length}枚・落ちる）` : `たたく（${sel.length}枚）`) : '氷をえらぼう';
      go.disabled = !sel.length;
      go.onclick = () => { const c = sel.slice(); picked = null; o.onMove({ t: 'hit', c }); };
      act.append(go);
      root.append(act);
    }
  },
};
