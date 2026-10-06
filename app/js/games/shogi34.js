// 将棋の詳細設定「盤」の 3×4（動物の駒）。子ども向けの「どうぶつしょうぎ」と同じ遊び（名前は商品名なので使わない。2026-10-06 本人の決定）。
// ルールは元の遊びどおり（本人承認）: 3列×4段。ライオン（8方向に1つ）・キリン（たて横に1つ）・ゾウ（ななめに1つ）・ヒヨコ（前に1つ）。
//   ヒヨコは相手の一番奥の段に入ると必ずニワトリ（金と同じ動き）になる。取った駒は持ち駒になり、空いたマスならどこにでも打てる
//   （取ったニワトリはヒヨコに戻る。奥の段に打ったヒヨコは成らず、動けない）。二歩も打ち歩詰めも無い。王手を放っておいてもよい。
//   勝ち: 相手のライオンを取る／自分のライオンが相手の一番奥の段に入り、そこを相手が取れない（トライ）。
//   取れるのにライオンが奥の段へ入ったときは、相手が取らなければ（次の相手の手のあとで）トライの勝ち。
//   引き分け: 同じ局面が4回・200手（本将棋と同じ考え。連続王手の千日手の決まりは無い）。
// Claude の判断: 並べ方は ☗先手（下）が左からゾウ・ライオン・キリン、その前の真ん中にヒヨコ。☖後手はその点対称。
// 盤の値: 0 = 空、正の数 = 先手の駒、負の数 = 後手の駒。駒の番号: 1ヒヨコ 2ゾウ 3キリン 4ライオン 5ニワトリ。
// マスの番号 = 段 * 3 + 列（段0 が一番上、列0 が左）。持ち駒 hands[p][駒の番号] = 枚数（1〜3 だけ使う）。
// 手: { f: 動かす駒のマス, t: 行き先 } / { d: 打つ駒（1〜3）, t: 打つマス } / { resign: true }（投了。手番の人）

const W = 3;
const H = 4;
const CHICK = 1;
const LION = 4;
const HEN = 5;
const MAX_PLY = 200;

export const NAME = { 1: 'ヒヨコ', 2: 'ゾウ', 3: 'キリン', 4: 'ライオン', 5: 'ニワトリ' };
const ICON = { 1: '🐤', 2: '🐘', 3: '🦒', 4: '🦁', 5: '🐔' };
const FILES = '321';
const RANKS = '一二三四';

// 動き（先手から見た向き。上が -1）
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const STEPS = {
  1: [[-1, 0]], 2: DIAG, 3: ORTHO, 4: [...ORTHO, ...DIAG],
  5: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]],
};

const sgnOf = (side) => (side === 0 ? 1 : -1);
const farRow = (side) => (side === 0 ? 0 : H - 1);
const rowOf = (i) => Math.floor(i / W);

function initialBoard() {
  const b = Array(W * H).fill(0);
  [2, LION, 3].forEach((v, c) => { b[(H - 1) * W + c] = v; b[W - 1 - c] = -v; });
  b[2 * W + 1] = CHICK;
  b[W + 1] = -CHICK;
  return b;
}

// side の駒が sq に動けるか
function attacked(board, sq, side) {
  const sgn = sgnOf(side);
  const r = rowOf(sq);
  const c = sq % W;
  for (let i = 0; i < W * H; i++) {
    const v = board[i];
    if (v * sgn <= 0) continue;
    const dr = (r - rowOf(i)) * sgn;
    const dc = (c - (i % W)) * sgn;
    if (STEPS[Math.abs(v)].some(([a, b]) => a === dr && b === dc)) return true;
  }
  return false;
}

const lionSq = (board, side) => board.indexOf(LION * sgnOf(side));

function moves(board, hands, side) {
  const out = [];
  const sgn = sgnOf(side);
  for (let i = 0; i < W * H; i++) {
    const v = board[i];
    if (v * sgn <= 0) continue;
    const r = rowOf(i);
    const c = i % W;
    for (const [dr, dc] of STEPS[Math.abs(v)]) {
      const rr = r + dr * sgn;
      const cc = c + dc * sgn;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W || board[rr * W + cc] * sgn > 0) continue;
      out.push({ f: i, t: rr * W + cc });
    }
  }
  for (let d = 1; d <= 3; d++) {
    if (!hands[side][d]) continue;
    for (let j = 0; j < W * H; j++) if (board[j] === 0) out.push({ d, t: j });
  }
  return out;
}

// 手を指した後の盤と持ち駒（元は変えない）。取った駒の番号と、成ったかも返す
function make(board, hands, side, m) {
  const b = board.slice();
  const h = [hands[0].slice(), hands[1].slice()];
  const sgn = sgnOf(side);
  let captured = 0;
  let promoted = false;
  if (m.d) {
    b[m.t] = m.d * sgn;
    h[side][m.d]--;
  } else {
    captured = Math.abs(b[m.t]);
    if (captured && captured !== LION) h[side][captured === HEN ? CHICK : captured]++;
    let t = Math.abs(b[m.f]);
    if (t === CHICK && rowOf(m.t) === farRow(side)) { t = HEN; promoted = true; }
    b[m.t] = t * sgn;
    b[m.f] = 0;
  }
  return { b, h, captured, promoted };
}

// side が指した直後の決着（勝った側の番号と理由）。無ければ null
function judge(b, side, captured) {
  if (captured === LION) return { winner: side, reason: 'ライオンを取った' };
  const them = 1 - side;
  const theirs = lionSq(b, them);
  if (theirs >= 0 && rowOf(theirs) === farRow(them)) return { winner: them, reason: 'トライ（ライオンが奥まで入った）' };
  const mine = lionSq(b, side);
  if (rowOf(mine) === farRow(side) && !attacked(b, mine, them)) return { winner: side, reason: 'トライ（ライオンが奥まで入った）' };
  return null;
}

const sameMove = (a, b) => a.t === b.t && (a.d ? a.d === b.d : a.f === b.f);
const posKey = (board, hands, turn) => `${board.join(',')}|${hands[0].join('')}|${hands[1].join('')}|${turn}`;

/* ---------- CPU ---------- */

const VALUE = { 1: 100, 2: 300, 3: 350, 4: 0, 5: 450 };
const MATE = 1e6;

// side から見た形勢: 駒の点数（持ち駒は少し高め）
function evaluate(board, hands, side) {
  let v = 0;
  for (const x of board) if (x) v += x > 0 ? VALUE[x] : -VALUE[-x];
  for (let d = 1; d <= 3; d++) v += (hands[0][d] - hands[1][d]) * VALUE[d] * 1.1;
  return side === 0 ? v : -v;
}

function searchRoot(board, hands, side, list, depth, deadline) {
  let nodes = 0;
  let aborted = false;
  const nega = (b, h, s, d, alpha, beta) => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) aborted = true;
    if (aborted) return 0;
    // 相手のライオンが取れるなら勝ち
    const enemy = lionSq(b, 1 - s);
    if (attacked(b, enemy, s)) return MATE + d;
    if (d === 0) return evaluate(b, h, s);
    let best = -Infinity;
    for (const m of moves(b, h, s)) {
      const n = make(b, h, s, m);
      const j = judge(n.b, s, n.captured);
      const v = j ? (j.winner === s ? MATE + d : -MATE - d) : -nega(n.b, n.h, 1 - s, d - 1, -beta, -alpha);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  };
  const scores = [];
  for (const m of list) {
    const n = make(board, hands, side, m);
    const j = judge(n.b, side, n.captured);
    const v = j ? (j.winner === side ? MATE + depth : -MATE - depth) : -nega(n.b, n.h, 1 - side, depth - 1, -Infinity, Infinity);
    if (aborted) return null;
    scores.push([m, v]);
  }
  return scores;
}

// CPU（よわい・ふつう・つよい）: 何手先まで読むか（2・4・6）と、ときどき適当に指す割合（3割・1割弱・0）。読みは1.5秒で打ち切る
export function cpuMove(s, rules) {
  const level = { weak: 1, normal: 1, strong: 1 }[rules?.cpu] ? rules.cpu : 'weak';
  const list = moves(s.board, s.hands, s.turn);
  const mistake = { weak: 0.3, normal: 0.08, strong: 0 }[level];
  if (Math.random() < mistake) return list[Math.floor(Math.random() * list.length)];
  const maxDepth = { weak: 2, normal: 4, strong: 6 }[level];
  const deadline = Date.now() + 1500;
  let scores = null;
  for (let d = 1; d <= maxDepth; d++) {
    const r = searchRoot(s.board, s.hands, s.turn, list, d, deadline);
    if (!r) break;
    scores = r;
  }
  const best = Math.max(...scores.map((x) => x[1]));
  const top = scores.filter((x) => x[1] >= best - (level === 'strong' ? 0 : 10)).map((x) => x[0]);
  return top[Math.floor(Math.random() * top.length)];
}

/* ---------- 進行 ---------- */

export function init() {
  const board = initialBoard();
  const hands = [Array(4).fill(0), Array(4).fill(0)];
  return { zoo: true, board, hands, turn: 0, ply: 0, last: null, keys: [posKey(board, hands, 0)], result: null };
}

export function apply(s, m) {
  if (s.result || !m || typeof m !== 'object') return null;
  if (m.resign === true) {
    return { ...s, result: { winner: 1 - s.turn, cells: [], reason: `${s.turn === 0 ? '先手' : '後手'}の投了` }, last: { resign: true, side: s.turn } };
  }
  if (!moves(s.board, s.hands, s.turn).some((x) => sameMove(x, m))) return null;
  const mv = m.d ? { d: m.d, t: m.t } : { f: m.f, t: m.t };
  const piece = m.d ? m.d : Math.abs(s.board[m.f]);
  const { b, h, captured, promoted } = make(s.board, s.hands, s.turn, mv);
  const next = 1 - s.turn;
  const key = posKey(b, h, next);
  const keys = [...s.keys, key];
  const ply = s.ply + 1;
  const mark = s.turn === 0 ? '▲' : '△';
  const note = `${mark}${FILES[mv.t % W]}${RANKS[rowOf(mv.t)]}${NAME[piece]}${m.d ? '打' : ''}${promoted ? '成' : ''}`;
  const n = { zoo: true, board: b, hands: h, turn: next, ply, keys, result: null, last: { ...mv, side: s.turn, note } };
  const j = judge(b, s.turn, captured);
  if (j) n.result = { ...j, cells: [] };
  else if (keys.filter((k) => k === key).length >= 4) n.result = { winner: null, cells: [], reason: '千日手' };
  else if (ply >= MAX_PLY) n.result = { winner: null, cells: [], reason: `${ply}手に達した` };
  return n;
}

export function info(s) {
  const parts = ['3×4（動物の駒）'];
  if (s.last?.note) parts.push(`${s.ply}手目 ${s.last.note}`);
  if (s.result) parts.push(s.result.reason);
  else if (attacked(s.board, lionSq(s.board, s.turn), 1 - s.turn)) parts.push('<b class="sg-check-text">ライオンがねらわれている！</b>');
  return parts.join('　');
}

/* ---------- 画面 ---------- */

let ui = { key: null, from: null, drop: null }; // 選んでいる駒（描き直しで消えないよう外に持つ）

export function render(root, s, o, players) {
  const draw = () => render(root, s, o, players);
  const last = W * H - 1;
  const bottom = o.me === 1 ? 1 : 0; // 自分の駒が下。観戦と同じ画面の対局では先手が下
  const key = `${s.ply}:${o.me}`;
  if (ui.key !== key) ui = { key, from: null, drop: null };
  const can = o.canMove && !s.result;
  const legal = can ? moves(s.board, s.hands, s.turn) : [];
  const targets = new Set();
  if (ui.from !== null) for (const m of legal) if (m.f === ui.from) targets.add(m.t);
  if (ui.drop !== null) for (const m of legal) if (m.d === ui.drop) targets.add(m.t);
  const movable = new Set(legal.filter((m) => !m.d).map((m) => m.f));
  const lion = lionSq(s.board, s.turn);
  const danger = !s.result && attacked(s.board, lion, 1 - s.turn) ? lion : -1;

  root.innerHTML = '';
  root.className = 'board sg sg34';
  root.style.setProperty('--n', W);

  const handRow = (side) => {
    const row = document.createElement('div');
    row.className = 'sg-hand' + (side === bottom ? ' mine' : '');
    const label = document.createElement('span');
    label.className = 'sg-hand-label';
    label.textContent = `${players[side]}の持ち駒`;
    row.append(label);
    let any = false;
    for (const d of [3, 2, 1]) {
      const n = s.hands[side][d];
      if (!n) continue;
      any = true;
      const ok = can && side === s.turn;
      const e = document.createElement(ok ? 'button' : 'span');
      e.className = 'sg-hand-piece' + (ok ? ' playable' : '') + (ui.drop === d && side === s.turn ? ' selected' : '');
      e.innerHTML = `<span class="sg-piece p${side}${side === bottom ? '' : ' flip'}">${ICON[d]}</span>${n > 1 ? `<small>${n}</small>` : ''}`;
      e.setAttribute('aria-label', `${NAME[d]}${n}枚`);
      if (ok) {
        e.type = 'button';
        e.onclick = () => { ui = { ...ui, from: null, drop: ui.drop === d ? null : d }; draw(); };
      }
      row.append(e);
    }
    if (!any) {
      const none = document.createElement('span');
      none.className = 'sg-hand-none';
      none.textContent = 'なし';
      row.append(none);
    }
    return row;
  };

  root.append(handRow(1 - bottom));

  const wrap = document.createElement('div');
  wrap.className = 'sg-wrap';
  const files = document.createElement('div');
  files.className = 'sg-files';
  for (let k = 0; k < W; k++) {
    const span = document.createElement('span');
    span.textContent = bottom === 0 ? W - k : k + 1;
    files.append(span);
  }
  const grid = document.createElement('div');
  grid.className = 'sg-grid';
  for (let k = 0; k < W * H; k++) {
    const i = bottom === 0 ? k : last - k;
    const v = s.board[i];
    const mine = v !== 0 && (v > 0 ? 0 : 1) === s.turn;
    const isTarget = targets.has(i);
    const isMovable = can && mine && movable.has(i);
    const cell = document.createElement(isTarget || isMovable ? 'button' : 'div');
    cell.className = 'sg-cell';
    if (s.last && !s.last.resign && s.last.t === i) cell.classList.add('last', ...(o.fresh ? ['pop'] : []));
    if (i === ui.from) cell.classList.add('selected');
    if (isTarget) cell.classList.add('target');
    if (i === danger) cell.classList.add('checked');
    if (v) {
      const t = Math.abs(v);
      const owner = v > 0 ? 0 : 1;
      const p = document.createElement('span');
      p.className = `sg-piece p${owner}` + (owner === bottom ? '' : ' flip');
      p.textContent = ICON[t];
      p.setAttribute('aria-label', `${players[owner]}の${NAME[t]}`);
      cell.append(p);
    }
    if (isTarget || isMovable) {
      cell.type = 'button';
      cell.onclick = () => {
        if (isTarget) {
          const m = legal.find((x) => x.t === i && (ui.drop !== null ? x.d === ui.drop : x.f === ui.from));
          if (m) o.onMove(m);
          return;
        }
        ui = { ...ui, drop: null, from: ui.from === i ? null : i };
        draw();
      };
    }
    grid.append(cell);
  }
  const ranks = document.createElement('div');
  ranks.className = 'sg-ranks';
  for (let k = 0; k < H; k++) {
    const span = document.createElement('span');
    span.textContent = RANKS[bottom === 0 ? k : H - 1 - k];
    ranks.append(span);
  }
  wrap.append(files, grid, ranks);
  root.append(wrap);

  root.append(handRow(bottom));

  if (can) {
    const actions = document.createElement('div');
    actions.className = 'cc-actions';
    const hint = document.createElement('p');
    hint.className = 'pk-hint';
    hint.textContent = ui.from !== null || ui.drop !== null ? '光っているマスをタップすると指せます' : '動かす駒か持ち駒をタップしてください';
    const resign = document.createElement('button');
    resign.type = 'button';
    resign.className = 'btn ghost';
    resign.textContent = '投了する';
    resign.onclick = () => { if (confirm('投了しますか？（負けになります）')) o.onMove({ resign: true }); };
    actions.append(resign);
    root.append(hint, actions);
  }
}

// テスト用
export const _test34 = { moves, attacked, make, judge, initialBoard, evaluate };
