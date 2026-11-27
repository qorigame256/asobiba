// 重さの手番（2026-11-27 本人が選んだ、Claude が考えた独自ルール。分かれ目は Claude の推奨を本人が承認）。2人。
// 駒で相手の王を取り合う。手番は交互でなく、動かした駒の重さだけ自分の時計が進み、時計が遅れている人が動く（続けて何手も動けることがある）。
//
// 本人が承認した分かれ目: 6×6 の盤。駒は各自 王1（周り1マス・重さ2）・兵4（前と斜め前へ1マス・重さ1）・槍1（たて・よこへ何マスでも・重さ3）・
//   騎1（ななめへ何マスでも・重さ3）。取った駒は使えない。王を取ったら勝ち（王手の決まりは無し）。時計が同じになったら、直前に動かなかった人が動く。
// Claude の判断: 並べ方は 1番手が下の2段（兵は2段目の列1・3・4・6、1段目は列2から 騎・王・槍）、2番手はそれを180度回した形。最初は 1番手から（時計はどちらも0）。
//   並べ方はつよいどうしの先手・後手の勝ち数で選んだ（2026-11-27）。兵を列2〜5に並べた形は先に動く側が不利すぎた（つよいどうし 1番手 4勝・2番手 25勝・引き分け 11）。
//   いまの形は 1番手 33勝・2番手 19勝・引き分け 8（60局）、ふつうどうし 46・54・0、よわいどうし 48・52・0（各100局）。
//   どの駒も、行き先が空きか相手の駒なら動ける（兵も前・斜め前のどれでも取れる）。槍・騎はほかの駒を飛び越えられない。
//   兵は成らない（向こうの端まで行くと動けなくなる）。番が来たのに動かせる駒が無い人の負け。200手で決まらなければ引き分け。
//   時計の差はいつも3以内（遅れている人か同じ時計の人だけが動き、1回で進むのは3まで）。動く人の時計がいつも小さい方なので、
//   動かしたあとの時計も小さい方から3先まで。盤の上の物差しは小さい方の時計から4目盛りだけ見せる。
//
// 局面: { board: マスごとの駒（null か 席*4+種類。種類 0 王・1 兵・2 槍・3 騎）, t: [席ごとの時計], mv: 直前に動いた席（始めは -1）, turn,
//   taken: [席ごとの取った駒の種類], last: { f, d, cap: 取った駒の種類か null }, ply, won }。
// 手 = 動かす駒のマス * 36 + 行き先のマス（マス = 段*6+列。段0が一番上）。

import { CPU_SETTING, PEEK_SETTING, peekMark, boardCpu, boardJudge, grabbable, justDragged } from './util.js';

const N = 6;
const CELLS = N * N;
const KING = 0;
const PAWN = 1;
const LANCE = 2;
const KNIGHT = 3;
const KIND = ['王', '兵', '槍', '騎'];
export const WEIGHT = [2, 1, 3, 3];
const MAX_PLY = 200;
const SPAN = 4; // 物差しの目盛りの数（小さい方の時計から3先まで）

const owner = (v) => v >> 2;
const kindOf = (v) => v & 3;
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const AROUND = [...ORTH, ...DIAG];

// 時計が遅れている人が動く。同じなら直前に動かなかった人（始めは 1番手）
export function nextTurn(t, mv) {
  if (t[0] !== t[1]) return t[0] < t[1] ? 0 : 1;
  return mv === 0 ? 1 : 0;
}

function startBoard() {
  const b = Array(CELLS).fill(null);
  const put = (r, c, p, k) => { b[r * N + c] = p * 4 + k; };
  for (const c of [0, 2, 3, 5]) { put(4, c, 0, PAWN); put(1, N - 1 - c, 1, PAWN); }
  put(5, 1, 0, KNIGHT); put(5, 2, 0, KING); put(5, 3, 0, LANCE);
  put(0, 4, 1, KNIGHT); put(0, 3, 1, KING); put(0, 2, 1, LANCE);
  return b;
}

// マス f の駒が行けるマスの一覧
export function targetsOf(b, f) {
  const v = b[f];
  if (v === null || v === undefined) return [];
  const p = owner(v);
  const k = kindOf(v);
  const r0 = Math.floor(f / N);
  const c0 = f % N;
  const out = [];
  const step = (dr, dc) => {
    const r = r0 + dr;
    const c = c0 + dc;
    if (r < 0 || r >= N || c < 0 || c >= N) return;
    const w = b[r * N + c];
    if (w === null || owner(w) !== p) out.push(r * N + c);
  };
  const ray = (dr, dc) => {
    for (let r = r0 + dr, c = c0 + dc; r >= 0 && r < N && c >= 0 && c < N; r += dr, c += dc) {
      const w = b[r * N + c];
      if (w === null) { out.push(r * N + c); continue; }
      if (owner(w) !== p) out.push(r * N + c);
      break;
    }
  };
  if (k === KING) for (const [dr, dc] of AROUND) step(dr, dc);
  else if (k === PAWN) { const fw = p === 0 ? -1 : 1; step(fw, -1); step(fw, 0); step(fw, 1); }
  else for (const [dr, dc] of k === LANCE ? ORTH : DIAG) ray(dr, dc);
  return out;
}

// p が打てる手の一覧（取る手を先に。CPU の読みが早く切れるように）
function movesOf(b, p) {
  const cap = [];
  const quiet = [];
  for (let f = 0; f < CELLS; f++) {
    if (b[f] === null || owner(b[f]) !== p) continue;
    for (const d of targetsOf(b, f)) (b[d] === null ? quiet : cap).push(f * CELLS + d);
  }
  return cap.concat(quiet);
}
const hasMove = (b, p) => b.some((v, f) => v !== null && owner(v) === p && targetsOf(b, f).length > 0);

/* ---------- CPU ---------- */

// p から見た点数: 駒の値打ち（兵1・騎4・槍5）＋ 兵の進み ＋ 時計の遅れ（遅れているほど先に動ける）
const VALUE = [0, 1, 5, 4];
function score(s, p) {
  let v = 0;
  for (let i = 0; i < CELLS; i++) {
    const x = s.board[i];
    if (x === null) continue;
    const q = owner(x);
    const k = kindOf(x);
    let a = VALUE[k];
    if (k === PAWN) a += 0.12 * (q === 0 ? 4 - Math.floor(i / N) : Math.floor(i / N) - 1);
    v += q === p ? a : -a;
  }
  return v + 0.35 * (s.t[1 - p] - s.t[p]);
}

let ui = { key: null, from: null }; // 選んでいる駒（通信で描き直されても消えないよう外に持つ）

export default {
  id: 'omosa',
  name: '重さの手番',
  icon: '⚖️',
  flip: true, // 盤の向きを変える（⇅）ボタンを出す（main.js）
  desc: '重い駒を動かすほど自分の時計が進み、時計が遅れている人が続けて動ける。相手の王を取ったら勝ち',
  ready: true,
  players: ['1番手（黒）', '2番手（赤）'],
  settings: [
    PEEK_SETTING,
    CPU_SETTING,
  ],

  // CPU: 何手先まで読むかで強さを変える（手番が続くこともあるので、読みの「手」は動く人に関係なく1手ずつ数える）。
  //   よわい も2手読む（1手だと、次に王を取られる手を平気で打ち、抵抗にならなかった）。そのぶん適当に打つ割合を4割にした。
  //   40局の実測（強い方の勝ち・負け・引き分け。2026-11-27）: ふつう-よわい 37・3・0、つよい-ふつう 39・0・1。1手の最長 35ms
  cpu(s, p, rules) {
    return boardCpu(this, s, rules, (x) => movesOf(x.board, x.turn), score, {
      depth: { weak: 2, normal: 3, strong: 4 }, mistake: { weak: 0.4, normal: 0.1, strong: 0 },
    });
  },

  // 形勢（util.js の boardJudge）: 駒の値打ちと時計の遅れを2手先まで読む
  judge(s) { return boardJudge(this, s, (x) => movesOf(x.board, x.turn), score, 2, 4); },

  init() {
    return { board: startBoard(), t: [0, 0], mv: -1, turn: 0, taken: [[], []], last: null, ply: 0, won: null };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.won || !Number.isInteger(m) || m < 0 || m >= CELLS * CELLS) return null;
    const f = Math.floor(m / CELLS);
    const d = m % CELLS;
    const v = s.board[f];
    if (v === null || owner(v) !== s.turn || !targetsOf(s.board, f).includes(d)) return null;
    const p = s.turn;
    const board = s.board.slice();
    const capV = board[d];
    board[d] = v;
    board[f] = null;
    const t = s.t.slice();
    t[p] += WEIGHT[kindOf(v)];
    const cap = capV === null ? null : kindOf(capV);
    const taken = cap === null ? s.taken : s.taken.map((a, q) => (q === p ? [...a, cap] : a));
    const turn = nextTurn(t, p);
    const ply = s.ply + 1;
    let won = null;
    if (cap === KING) won = { winner: p, king: d };
    else if (!hasMove(board, turn)) won = { winner: 1 - turn, stuck: true };
    else if (ply >= MAX_PLY) won = { winner: null, long: true };
    return { ...s, board, t, mv: p, turn, taken, last: { f, d, cap }, ply, won };
  },

  result(s) { return s.won ? { ...s.won, cells: [] } : null; },

  sound(a, b) { return b.last?.cap !== null && b.last?.cap !== undefined ? 'punch' : 'place'; },

  info(s) {
    const tk = (p) => (s.taken[p].length ? s.taken[p].map((k) => KIND[k]).join('') : 'なし');
    let html = `取った駒　<b>1番手 ${tk(0)}</b>　−　<b class="om-red">2番手 ${tk(1)}</b>`;
    if (s.won?.long) html += `<br>${MAX_PLY}手になったので引き分け`;
    else if (s.won?.stuck) html += `<br>${this.players[1 - s.won.winner]}は動かせる駒が無くなった`;
    return html;
  },

  render(root, s, o) {
    const draw = () => this.render(root, s, o);
    const bottom = Number.isInteger(o.view) ? o.view : o.me === 1 ? 1 : 0; // 自分の駒が下に来るように。観戦と同じ画面の対局では 1番手が下。盤の向きを変えた（⇅）ときは o.view の人が下
    const cellAt = (k) => (bottom === 0 ? k : CELLS - 1 - k);
    const over = !!s.won || s.gave !== undefined;
    const key = `${s.ply}:${o.me}`;
    if (ui.key !== key) ui = { key, from: null };
    const can = o.canMove && !over;
    const legal = can ? movesOf(s.board, s.turn) : [];
    const movable = new Set(legal.map((m) => Math.floor(m / CELLS)));
    const targets = new Set(ui.from === null ? [] : legal.filter((m) => Math.floor(m / CELLS) === ui.from).map((m) => m % CELLS));

    root.innerHTML = '';
    root.className = 'board sg om';
    root.style.setProperty('--n', N);

    // 時計の物差し: 上が相手・下が自分（下に来る人）。いま選んでいる駒（相手の迷いが見えるときは、番の人がつまんでいる駒）を動かしたあとの時計を薄く出す
    const peekF = Number.isInteger(o.peekIn?.f) && s.board[o.peekIn.f] !== null && s.board[o.peekIn.f] !== undefined && owner(s.board[o.peekIn.f]) === s.turn ? o.peekIn.f : null;
    const sel = ui.from ?? peekF;
    const add = sel !== null && !over ? WEIGHT[kindOf(s.board[sel])] : 0;
    const base = Math.min(s.t[0], s.t[1]);
    const clock = document.createElement('div');
    clock.className = 'om-clock';
    for (const p of [1 - bottom, bottom]) {
      const row = document.createElement('div');
      row.className = `om-row p${p}` + (s.turn === p && !over ? ' turn' : '');
      const name = document.createElement('span');
      name.className = 'om-name';
      name.textContent = p === 0 ? '1番手' : '2番手';
      const track = document.createElement('div');
      track.className = 'om-track';
      track.style.setProperty('--span', SPAN);
      const tok = (val, cls) => {
        const e = document.createElement('span');
        e.className = 'om-tok ' + cls;
        e.style.setProperty('--x', Math.min(val - base, SPAN - 1));
        return e;
      };
      const mine = tok(s.t[p], 'p' + p);
      mine.textContent = s.t[p];
      if (o.fresh && s.mv === p && s.last) { mine.classList.add('step'); mine.style.setProperty('--dx', -WEIGHT[kindOf(s.board[s.last.d])]); }
      track.append(mine);
      row.append(name, track);
      if (add && p === s.turn) {
        const after = s.t.slice();
        after[p] += add;
        const g = tok(after[p], 'ghost p' + p);
        g.textContent = `+${add}`;
        track.append(g);
        const tag = document.createElement('span');
        tag.className = 'om-tag';
        tag.textContent = nextTurn(after, p) === p ? 'もう1手' : '相手へ';
        row.append(tag);
      }
      clock.append(row);
    }
    root.append(clock);

    const grid = document.createElement('div');
    grid.className = 'sg-grid';
    const caught = o.fresh && s.last?.cap !== null && s.last?.cap !== undefined ? s.last.d : null;
    for (let k = 0; k < CELLS; k++) {
      const i = cellAt(k);
      const v = s.board[i];
      const isTarget = targets.has(i);
      const isMovable = movable.has(i);
      const cell = document.createElement(isTarget || isMovable ? 'button' : 'div');
      cell.className = 'sg-cell';
      if (s.last && (s.last.d === i || s.last.f === i)) cell.classList.add('last');
      if (s.last?.d === i && o.fresh) cell.classList.add('pop');
      if (s.last?.d === i) cell.dataset.last = 'still'; // 決め手のスロー（main.js の slowFinish）: 駒は滑ってくるので寄せるだけ
      if (caught === i) cell.classList.add('caught');
      if (s.won?.king === i) cell.classList.add('om-king');
      if (i === ui.from) cell.classList.add('selected');
      if (isTarget) { cell.classList.add('target'); cell.dataset.drop = i; } // data-drop: つまんだ駒を離せる所
      peekMark(cell, i, o, isTarget, () => ({ f: ui.from, d: null })); // 相手の迷いが見える（main.js の o.peek・o.peekIn）: 相手の選び・PC のねらい
      if (v !== null) {
        const p = owner(v);
        const piece = document.createElement('span');
        piece.className = 'sg-piece' + (p === bottom ? '' : ' flip') + (p === 1 ? ' promoted' : '');
        piece.textContent = KIND[kindOf(v)];
        // 選んだ駒が浮く（main.js の flyPlay）: 動かした駒は元のマスから浮いたまま滑ってきて置かれる（はさみ将棋と同じ形）
        const moved = s.last && s.last.d === i;
        piece.dataset.fly = moved ? `mv:${s.ply}` : `sq:${i}`;
        if (moved) Object.assign(piece.dataset, { flyFrom: `sq:${s.last.f}`, flySlide: '', flyLift: '' });
        if (piece.classList.contains('flip')) piece.dataset.flyBase = 'rotate(180deg)';
        const w = document.createElement('span');
        w.className = 'om-w';
        w.textContent = WEIGHT[kindOf(v)];
        cell.append(piece, w);
      }
      if (isTarget || isMovable) {
        cell.type = 'button';
        cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${i % N + 1}列目`);
        cell.onclick = () => {
          if (justDragged()) return;
          if (isTarget) { const f = ui.from; ui = { ...ui, from: null }; o.onMove(f * CELLS + i); return; }
          ui = { ...ui, from: ui.from === i ? null : i };
          draw();
        };
        // 指でつまんで動かす（util.js の grabbable）: 自分の駒を行き先まで引っぱって動かせる
        if (isMovable) grabbable(cell, { piece: () => cell.querySelector('.sg-piece'), pick: () => { ui = { ...ui, from: i }; draw(); }, drop: (t) => { if (t !== null && ui.from === i) { ui = { ...ui, from: null }; o.onMove(i * CELLS + Number(t)); } } });
      }
      grid.append(cell);
    }
    root.append(grid);
    o.peek?.({ f: ui.from, d: null, a: null }); // 相手の迷いが見える: いまの選びを知らせる
  },
};
