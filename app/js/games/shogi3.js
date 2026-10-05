// 3人将棋（三人チェス式の盤）。shogi.js が詳細設定の人数 3 のときにこちらへ任せる。
// 決まり（本人の決定と Claude の決めた作り）は .claude/rules/shogi.md の「3人将棋」。
//
// マスの番号 = 陣地 * 40 + 段 * 8 + 筋。陣地 = その陣地の持ち主（0〜2）。段0 が持ち主の一段目（奥）、段4 が真ん中寄り。
//   筋0〜7 は持ち主から見て左から。段4 の先は、筋0〜3（左半分）なら左どなり（(陣地+2)%3）の段4・筋7〜4、
//   筋4〜7（右半分）なら右どなり（(陣地+1)%3）の段4・筋3〜0 へ続く。線をまたぐと向きが反転する（段は減る向きに、筋は鏡写し）。
//   筋3と筋4の間の段4の先は真ん中の点で、斜めには通れない。
// 盤の値: 0 = 空、それ以外 = 持ち主 * 16 + 駒の番号（shogi.js と同じ。1歩 2香 3桂 4銀 5金 6角 7飛 8玉、成ると +8）。
// 持ち駒 hands[p][駒の番号] = 枚数。手は shogi.js と同じ形（{ f, t, pr } / { d, t } / { resign: true }）。
// 王を取られた人・投了した人・指せる手が無くなった人は脱落し、その人の駒（持ち駒も）は消える。

const PAWN = 1;
const LANCE = 2;
const KNIGHT = 3;
const GOLD = 5;
const KING = 8;
const MAX_PLY = 450;
const CELLS = 120;

export const NAMES = ['☗先手', '☖後手', '三番手'];
const KANJI = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉', 9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '龍' };
const NOTE_NAME = { ...KANJI, 10: '成香', 11: '成桂', 12: '成銀' };

// 動き（駒の持ち主から見た向き。[段の向き, 筋の向き]、前が -1。shogi.js と同じ書き方）。桂は別に扱う
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const GOLD_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
const STEPS = {
  1: [[-1, 0]], 4: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], 5: GOLD_STEPS,
  8: [...ORTHO, ...DIAG], 9: GOLD_STEPS, 10: GOLD_STEPS, 11: GOLD_STEPS, 12: GOLD_STEPS, 14: ORTHO, 15: DIAG,
};
const SLIDES = { 2: [[-1, 0]], 6: DIAG, 7: ORTHO, 14: DIAG, 15: ORTHO };

const regionOf = (i) => Math.floor(i / 40);
const rowOf = (i) => Math.floor((i % 40) / 8);
const colOf = (i) => i % 8;
const ownerOf = (v) => v >> 4;
const typeOf = (v) => v & 15;
const base = (t) => (t > 8 ? t - 8 : t);
const canPromote = (t) => t <= 7 && t !== GOLD;
// 駒の「前」: 自分の陣地では段が増える向き（真ん中へ）、ほかの人の陣地では段が減る向き（その人の奥へ）
const fwd = (i, owner) => (regionOf(i) === owner ? 1 : -1);
// 敵陣 = ほかの人の陣地の奥3段
const inZone = (side, i) => regionOf(i) !== side && rowOf(i) <= 2;
function mustPromote(t, side, i) {
  if (regionOf(i) === side) return false;
  const r = rowOf(i);
  return ((t === PAWN || t === LANCE) && r === 0) || (t === KNIGHT && r <= 1);
}
// 二歩を数える「筋」。左半分の筋は、左どなりの右半分へ続く同じ線
const lineOf = (i) => {
  const c = colOf(i);
  return c < 4 ? regionOf(i) * 4 + c : ((regionOf(i) + 1) % 3) * 4 + (7 - c);
};

// i から（その陣地の向きで）dx 筋・dy 段 動いた先。[行き先, 線をまたいだか] か null
function step(i, dx, dy) {
  const P = regionOf(i);
  const x = colOf(i) + dx;
  const y = rowOf(i) + dy;
  if (x < 0 || x > 7 || y < 0) return null;
  if (y <= 4) return [P * 40 + y * 8 + x, false];
  if ((colOf(i) < 4) !== (x < 4)) return null; // 真ん中の点を斜めに抜ける
  const Q = x < 4 ? (P + 2) % 3 : (P + 1) % 3;
  return [Q * 40 + 4 * 8 + (7 - x), true];
}

// 決まった向きの並びをたどる（線をまたぐたびに残りの向きを反転する）
function walk(i, path) {
  let j = i;
  let k = 1;
  for (const [dx, dy] of path) {
    const r = step(j, dx * k, dy * k);
    if (!r) return -1;
    j = r[0];
    if (r[1]) k = -k;
  }
  return j;
}

// i の駒が動ける（利いている）マス。own が真なら自分の駒がいるマスも入れる（守りの数え方）
function reach(board, i, own = false) {
  const v = board[i];
  const owner = ownerOf(v);
  const t = typeOf(v);
  const f = fwd(i, owner);
  const out = [];
  const ok = (j) => j >= 0 && (own || !board[j] || ownerOf(board[j]) !== owner);
  if (t === KNIGHT) {
    const seen = new Set();
    for (const s of [-1, 1]) {
      for (const path of [[[0, f], [s * f, f]], [[s * f, f], [0, f]]]) {
        const j = walk(i, path);
        if (ok(j) && !seen.has(j)) { seen.add(j); out.push(j); }
      }
    }
    return out;
  }
  for (const [dr, dc] of STEPS[t] ?? []) {
    const j = walk(i, [[dc * f, -dr * f]]);
    if (ok(j)) out.push(j);
  }
  for (const [dr, dc] of SLIDES[t] ?? []) {
    let dx = dc * f;
    let dy = -dr * f;
    let j = i;
    for (;;) {
      const r = step(j, dx, dy);
      if (!r) break;
      j = r[0];
      if (r[1]) { dx = -dx; dy = -dy; }
      const x = board[j];
      if (x && ownerOf(x) === owner) { if (own) out.push(j); break; }
      out.push(j);
      if (x) break;
    }
  }
  return out;
}

// side の駒が利いているマスの集まり
function attackSet(board, side, own = false) {
  const set = new Set();
  for (let i = 0; i < CELLS; i++) if (board[i] && ownerOf(board[i]) === side) for (const j of reach(board, i, own)) set.add(j);
  return set;
}

const kingSq = (board, side) => board.indexOf(side * 16 + KING);

function pawnOnLine(board, side, line) {
  for (let i = 0; i < CELLS; i++) if (board[i] === side * 16 + PAWN && lineOf(i) === line) return true;
  return false;
}

// 指せる手（王手の放置も、王を取る手も含む。3人将棋では王手を放っておいてよい）
function legalMoves(board, hands, side) {
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (!v || ownerOf(v) !== side) continue;
    const t = typeOf(v);
    for (const j of reach(board, i)) {
      if (canPromote(t) && (inZone(side, i) || inZone(side, j))) {
        out.push({ f: i, t: j, pr: true });
        if (!mustPromote(t, side, j)) out.push({ f: i, t: j, pr: false });
      } else {
        out.push({ f: i, t: j, pr: false });
      }
    }
  }
  for (let d = 1; d <= 7; d++) {
    if (!hands[side][d]) continue;
    for (let j = 0; j < CELLS; j++) {
      if (board[j]) continue;
      if (mustPromote(d, side, j)) continue; // 行き所のない駒
      if (d === PAWN && pawnOnLine(board, side, lineOf(j))) continue; // 二歩
      out.push({ d, t: j });
    }
  }
  return out;
}

function removeSide(b, h, side) {
  for (let i = 0; i < CELLS; i++) if (b[i] && ownerOf(b[i]) === side) b[i] = 0;
  h[side] = Array(8).fill(0);
}

// 手を指した後の盤と持ち駒（元は変えない）。取った駒（盤の値）と、王を取って脱落させた人も返す
function make(board, hands, side, m) {
  const b = board.slice();
  const h = hands.map((x) => x.slice());
  let captured = 0;
  let killed = -1;
  if (m.d) {
    b[m.t] = side * 16 + m.d;
    h[side][m.d]--;
  } else {
    captured = b[m.t];
    if (captured) {
      if (typeOf(captured) === KING) killed = ownerOf(captured);
      else h[side][base(typeOf(captured))]++;
    }
    const t = typeOf(b[m.f]);
    b[m.t] = side * 16 + (m.pr ? t + 8 : t);
    b[m.f] = 0;
    if (killed >= 0) removeSide(b, h, killed);
  }
  return { b, h, captured, killed };
}

const sameMove = (a, b) => a.t === b.t && (a.d ? a.d === b.d : a.f === b.f && !!a.pr === !!b.pr);
const posKey = (board, hands, turn) => `${board.join(',')}|${hands.map((x) => x.join('')).join('|')}|${turn}`;
const nextAlive = (turn, alive) => {
  for (let k = 1; k <= 3; k++) if (alive[(turn + k) % 3]) return (turn + k) % 3;
  return turn;
};
// side の玉に誰かが利いているか
const inCheck = (board, alive, side) => {
  const k = kingSq(board, side);
  return k >= 0 && [0, 1, 2].some((q) => q !== side && alive[q] && attackSet(board, q).has(k));
};

function initialBoard() {
  const b = Array(CELLS).fill(0);
  const back = [LANCE, KNIGHT, 4, GOLD, KING, GOLD, 4, KNIGHT]; // 香桂銀金玉金銀桂
  for (let P = 0; P < 3; P++) {
    for (let x = 0; x < 8; x++) {
      b[P * 40 + x] = P * 16 + back[x];
      b[P * 40 + 16 + x] = P * 16 + PAWN;
    }
    b[P * 40 + 8 + 1] = P * 16 + 6; // 角
    b[P * 40 + 8 + 6] = P * 16 + 7; // 飛
  }
  return b;
}

/* ---------- CPU ---------- */

const VALUE = { 1: 100, 2: 300, 3: 350, 4: 500, 5: 600, 6: 800, 7: 1000, 8: 0, 9: 600, 10: 600, 11: 600, 12: 600, 14: 1100, 15: 1300 };
const KING_LOSS = 1e5;

// p の駒の点数（持ち駒は少し高め）。歩と銀は前へ進むほど少し加点
function material(board, hands, p) {
  let v = 0;
  for (let i = 0; i < CELLS; i++) {
    const x = board[i];
    if (!x || ownerOf(x) !== p) continue;
    const t = typeOf(x);
    v += VALUE[t];
    if (t === PAWN || t === 4) v += (regionOf(i) === p ? rowOf(i) : 9 - rowOf(i)) * 3;
  }
  for (let d = 1; d <= 7; d++) v += hands[p][d] * VALUE[d] * 1.1;
  return v;
}

// 指したあとに、ほかの人が取れるいちばん大きな得（取り返せるなら取った駒の値を引く）。玉が取られるなら KING_LOSS
function threat(b, alive, me) {
  const mine = attackSet(b, me, true);
  let worst = 0;
  for (let q = 0; q < 3; q++) {
    if (q === me || !alive[q]) continue;
    for (let i = 0; i < CELLS; i++) {
      if (!b[i] || ownerOf(b[i]) !== q) continue;
      for (const j of reach(b, i)) {
        const x = b[j];
        if (!x || ownerOf(x) !== me) continue;
        const t = typeOf(x);
        const gain = t === KING ? KING_LOSS : VALUE[t] - (mine.has(j) ? VALUE[typeOf(b[i])] : 0);
        if (gain > worst) worst = gain;
      }
    }
  }
  return worst;
}

// 強さ: よわい＝玉を取られる手だけ避ける（3割は適当）、ふつう＝取られそうな駒も見る（1割弱は適当）、つよい＝適当に指さない
export function cpuMove(s, rules) {
  const level = { weak: 1, normal: 1, strong: 1 }[rules?.cpu] ? rules.cpu : 'weak';
  const me = s.turn;
  const moves = legalMoves(s.board, s.hands, me);
  const kill = moves.find((m) => !m.d && s.board[m.t] && typeOf(s.board[m.t]) === KING);
  if (kill) return kill;
  if (Math.random() < { weak: 0.3, normal: 0.08, strong: 0 }[level]) return moves[Math.floor(Math.random() * moves.length)];
  let best = -Infinity;
  let top = [];
  for (const m of moves) {
    const { b, h, killed } = make(s.board, s.hands, me, m);
    const alive = s.alive.map((a, q) => a && q !== killed);
    let v = material(b, h, me);
    for (let q = 0; q < 3; q++) if (q !== me && alive[q]) v -= 0.5 * material(b, h, q);
    const th = threat(b, alive, me);
    v -= level === 'weak' ? (th >= KING_LOSS ? th : 0) : th * (level === 'strong' ? 1 : 0.8);
    v += Math.random() * (level === 'strong' ? 1 : 20);
    if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
  }
  return top[0];
}

/* ---------- 進行 ---------- */

export function init() {
  const board = initialBoard();
  const hands = [0, 1, 2].map(() => Array(8).fill(0));
  return { n: 3, board, hands, turn: 0, ply: 0, alive: [true, true, true], out: [], last: null, keys: [posKey(board, hands, 0)], result: null };
}

function finish(n) {
  const left = [0, 1, 2].filter((q) => n.alive[q]);
  if (left.length === 1) {
    n.result = { winner: left[0], cells: [], ranking: [left[0], ...n.out.slice().reverse()], reason: `${NAMES[left[0]]}が最後まで残った` };
  }
  return n;
}

export function apply(s, m) {
  if (s.result || !m || typeof m !== 'object') return null;
  const alive = s.alive.slice();
  const out = s.out.slice();
  let b;
  let h;
  let last;
  if (m.resign === true) {
    b = s.board.slice();
    h = s.hands.map((x) => x.slice());
    removeSide(b, h, s.turn);
    alive[s.turn] = false;
    out.push(s.turn);
    last = { resign: true, side: s.turn, note: `${NAMES[s.turn]}が投了して脱落` };
  } else {
    const legal = legalMoves(s.board, s.hands, s.turn);
    if (!legal.some((x) => sameMove(x, m))) return null;
    const mv = m.d ? { d: m.d, t: m.t } : { f: m.f, t: m.t, pr: !!m.pr };
    const r = make(s.board, s.hands, s.turn, mv);
    b = r.b;
    h = r.h;
    if (r.killed >= 0) { alive[r.killed] = false; out.push(r.killed); }
    last = { ...mv, side: s.turn, note: notation(s, mv, r) };
  }
  let next = nextAlive(s.turn, alive);
  // 指せる手が無い人も脱落（ほぼ起きない）
  while (alive.filter(Boolean).length > 1 && !legalMoves(b, h, next).length) {
    removeSide(b, h, next);
    alive[next] = false;
    out.push(next);
    next = nextAlive(next, alive);
  }
  const key = posKey(b, h, next);
  const keys = [...s.keys, key];
  const ply = s.ply + 1;
  const n = { ...s, board: b, hands: h, turn: next, ply, alive, out, keys, last, result: null };
  finish(n);
  if (!n.result && keys.filter((k) => k === key).length >= 4) n.result = { winner: null, cells: [], reason: '同じ局面が4回（千日手）' };
  else if (!n.result && ply >= MAX_PLY) n.result = { winner: null, cells: [], reason: `${MAX_PLY}手に達した` };
  return n;
}

function notation(s, m, r) {
  const who = NAMES[s.turn];
  if (m.d) return `${who} ${KANJI[m.d]}打`;
  const t = typeOf(s.board[m.f]);
  let text = `${who} ${NOTE_NAME[t]}${m.pr ? '成' : canPromote(t) && (inZone(s.turn, m.f) || inZone(s.turn, m.t)) ? '不成' : ''}`;
  if (r.captured) {
    const q = ownerOf(r.captured);
    text += r.killed >= 0 ? `で${NAMES[q]}の玉を取った！ ${NAMES[q]}は脱落` : `で${NAMES[q]}の${KANJI[typeOf(r.captured)]}を取った`;
  }
  return text;
}

export function info(s) {
  const parts = [];
  if (s.out.length) parts.push(`脱落: ${s.out.map((q) => `<b class="pl p${q}">${NAMES[q]}</b>`).join('、')}`);
  if (s.last?.note) parts.push(`${s.ply}手目 ${s.last.note}`);
  if (s.result) parts.push(s.result.reason);
  else if (inCheck(s.board, s.alive, s.turn)) parts.push('<b class="sg-check-text">王手！（玉が取られそう）</b>');
  return parts.join('　');
}

/* ---------- 盤の形 ---------- */

// 六角形の盤。真ん中が (0, 0)、上が y の正。bottom の人の陣地が下に来るように回す
const APO = 6; // 真ん中から奥の辺までの長さ
const HALF = APO / Math.sqrt(3); // 奥の辺の半分の長さ
const geoCache = {};
function geometry(bottom) {
  if (geoCache[bottom]) return geoCache[bottom];
  const rad = (d) => (d * Math.PI) / 180;
  const pol = (r, d) => [r * Math.cos(rad(d)), r * Math.sin(rad(d))];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const regions = [];
  for (let P = 0; P < 3; P++) {
    const phi = 270 + 120 * ((P - bottom + 3) % 3);
    const M = pol(APO, phi);
    const right = pol(1, phi + 90); // 持ち主から見て右（真ん中を向いたとき）
    const VL = [M[0] - HALF * right[0], M[1] - HALF * right[1]];
    const VR = [M[0] + HALF * right[0], M[1] + HALF * right[1]];
    const SL = pol(APO, phi - 60);
    const SR = pol(APO, phi + 60);
    const C = [0, 0];
    // 筋 X（0〜8）・段 Y（0〜5）の格子の点
    const point = (X, Y) => {
      const back = X <= 4 ? lerp(VL, M, X / 4) : lerp(M, VR, (X - 4) / 4);
      const top = X <= 4 ? lerp(SL, C, X / 4) : lerp(C, SR, (X - 4) / 4);
      const p = lerp(back, top, Y / 5);
      return [p[0], -p[1]]; // 画面は下が y の正
    };
    regions.push({ point, M, VL, VR, SL, SR });
  }
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const { point } = regions[regionOf(i)];
    const x = colOf(i);
    const y = rowOf(i);
    const pts = [point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1)];
    const c = [(pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4];
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const w = (d(pts[0], pts[1]) + d(pts[3], pts[2])) / 2;
    const hgt = (d(pts[0], pts[3]) + d(pts[1], pts[2])) / 2;
    // 段が増える向き（画面の上で）
    const lo = lerp(pts[0], pts[1], 0.5);
    const hi = lerp(pts[3], pts[2], 0.5);
    cells.push({ pts, c, size: Math.min(w, hgt), up: [hi[0] - lo[0], hi[1] - lo[1]] });
  }
  geoCache[bottom] = { regions, cells };
  return geoCache[bottom];
}

const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const fix = (n) => Math.round(n * 1000) / 1000;
const ptsText = (pts) => pts.map((p) => `${fix(p[0])},${fix(p[1])}`).join(' ');

let ui = { key: null, from: null, drop: null, promo: null };

export function render(root, s, o) {
  const draw = () => render(root, s, o);
  const bottom = o.me >= 0 && o.me <= 2 ? o.me : 0;
  const key = `${s.ply}:${o.me}`;
  if (ui.key !== key) ui = { key, from: null, drop: null, promo: null };
  const can = o.canMove && !s.result;
  const legal = can ? legalMoves(s.board, s.hands, s.turn) : [];
  const targets = new Set();
  if (ui.from !== null) for (const m of legal) if (m.f === ui.from) targets.add(m.t);
  if (ui.drop !== null) for (const m of legal) if (m.d === ui.drop) targets.add(m.t);
  const movable = new Set(legal.filter((m) => !m.d).map((m) => m.f));
  const droppable = new Set(legal.filter((m) => m.d).map((m) => m.d));
  const checked = new Set();
  if (!s.result) for (let q = 0; q < 3; q++) if (s.alive[q] && inCheck(s.board, s.alive, q)) checked.add(kingSq(s.board, q));

  root.innerHTML = '';
  root.className = 'board sg sg3';

  const pick = (t) => {
    const opts = legal.filter((m) => m.t === t && (ui.drop !== null ? m.d === ui.drop : m.f === ui.from));
    if (!opts.length) return;
    if (opts.length === 2) { ui.promo = { f: ui.from, t }; draw(); return; }
    o.onMove(opts[0]);
  };

  const handRow = (side) => {
    const row = document.createElement('div');
    row.className = 'sg-hand' + (side === o.me ? ' mine' : '') + (s.alive[side] ? '' : ' out');
    const label = document.createElement('span');
    label.className = `sg-hand-label pl p${side}`;
    label.textContent = `${NAMES[side]}の持ち駒`;
    row.append(label);
    if (!s.alive[side]) {
      const none = document.createElement('span');
      none.className = 'sg-hand-none';
      none.textContent = '脱落';
      row.append(none);
      return row;
    }
    let any = false;
    for (const d of [7, 6, 5, 4, 3, 2, 1]) {
      const n = s.hands[side][d];
      if (!n) continue;
      any = true;
      const ok = can && side === s.turn && droppable.has(d);
      const e = document.createElement(ok ? 'button' : 'span');
      e.className = 'sg-hand-piece' + (ok ? ' playable' : '') + (ui.drop === d && side === s.turn ? ' selected' : '');
      e.innerHTML = `<span class="sg-piece">${KANJI[d]}</span>${n > 1 ? `<small>${n}</small>` : ''}`;
      if (ok) {
        e.type = 'button';
        e.onclick = () => {
          ui = { ...ui, from: null, promo: null, drop: ui.drop === d ? null : d };
          draw();
        };
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

  // 自分（観戦では☗先手）の持ち駒を下に、ほかの2人を上に
  const others = [1, 2].map((k) => (bottom + k) % 3);
  for (const q of others) root.append(handRow(q));

  const { regions, cells } = geometry(bottom);
  const R = APO / Math.cos(Math.PI / 6) + 0.25;
  const svg = svgEl('svg', { viewBox: `${fix(-R)} ${fix(-APO - 0.25)} ${fix(2 * R)} ${fix(2 * APO + 0.5)}`, class: 'sg3-board', role: 'img' });
  svg.setAttribute('aria-label', '3人将棋の盤');
  const outline = [];
  for (const g of regions) outline.push(g.VL, g.VR);
  // 外形（各陣地の奥の辺の両端を順に結ぶ）。画面は y が下向き
  svg.append(svgEl('polygon', { points: ptsText(outline.map((p) => [p[0], -p[1]])), class: 'sg3-frame' }));
  for (let i = 0; i < CELLS; i++) {
    const g = cells[i];
    const v = s.board[i];
    const isTarget = targets.has(i);
    const mineToMove = can && v && ownerOf(v) === s.turn && movable.has(i);
    const cls = ['sg3-cell', `r${regionOf(i)}`];
    if (s.last && !s.last.resign && s.last.t === i) cls.push('last');
    if (i === ui.from) cls.push('selected');
    if (checked.has(i)) cls.push('checked');
    if (isTarget || mineToMove) cls.push('active');
    const poly = svgEl('polygon', { points: ptsText(g.pts), class: cls.join(' ') });
    svg.append(poly);
    if (v) {
      const t = typeOf(v);
      const owner = ownerOf(v);
      const f = fwd(i, owner);
      const ang = (Math.atan2(g.up[0] * f, -g.up[1] * f) * 180) / Math.PI;
      const z = g.size * 0.9;
      const grp = svgEl('g', { transform: `translate(${fix(g.c[0])} ${fix(g.c[1])}) rotate(${fix(ang)}) scale(${fix(z)})`, class: `sg3-piece o${owner}${t > 8 ? ' promoted' : ''}` });
      grp.append(svgEl('polygon', { points: '0,-0.5 0.34,-0.34 0.42,0.48 -0.42,0.48 -0.34,-0.34' }));
      const text = svgEl('text', { x: 0, y: 0.1, 'font-size': 0.56 });
      text.textContent = KANJI[t];
      grp.append(text);
      svg.append(grp);
    }
    if (isTarget) {
      svg.append(svgEl('circle', { cx: fix(g.c[0]), cy: fix(g.c[1]), r: fix(g.size * (v ? 0.46 : 0.16)), class: v ? 'sg3-target take' : 'sg3-target' }));
    }
    if (isTarget || mineToMove) {
      // 押す所は駒や印の上にかぶせた透明な形（駒の絵が押すのを邪魔しないように）
      const hit = svgEl('polygon', { points: ptsText(g.pts), class: 'sg3-hit' });
      hit.addEventListener('click', () => {
        if (isTarget) { pick(i); return; }
        ui = { ...ui, drop: null, promo: null, from: ui.from === i ? null : i };
        draw();
      });
      svg.append(hit);
    }
  }
  // 陣地の境目（真ん中から各辺の中点へ）を太く
  for (const g of regions) {
    for (const p of [g.SL, g.SR]) svg.append(svgEl('line', { x1: 0, y1: 0, x2: fix(p[0]), y2: fix(-p[1]), class: 'sg3-border' }));
  }
  root.append(svg);

  root.append(handRow(bottom));

  if (ui.promo) {
    const box = document.createElement('div');
    box.className = 'cc-picker sg-promo';
    box.innerHTML = '<p>成りますか？</p>';
    const row = document.createElement('div');
    for (const [text, pr] of [['成る', true], ['成らない', false]]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (pr ? 'primary' : 'secondary');
      b.textContent = text;
      b.onclick = () => { const { f, t } = ui.promo; ui.promo = null; o.onMove({ f, t, pr }); };
      row.append(b);
    }
    box.append(row);
    root.append(box);
  }

  if (can) {
    const actions = document.createElement('div');
    actions.className = 'cc-actions';
    const hint = document.createElement('p');
    hint.className = 'pk-hint';
    hint.textContent = ui.from !== null || ui.drop !== null ? '印の付いたマスをタップすると指せます' : '動かす駒か持ち駒をタップしてください（枠の色が自分の駒）';
    const resign = document.createElement('button');
    resign.type = 'button';
    resign.className = 'btn ghost';
    resign.textContent = '投了する';
    resign.onclick = () => { if (confirm('投了しますか？（脱落して、駒は盤から消えます）')) o.onMove({ resign: true }); };
    actions.append(resign);
    root.append(hint, actions);
  }
}

// テスト用
export const _test3 = { legalMoves, reach, step, lineOf, initialBoard, attackSet, make, kingSq };
