// 4人将棋（9×9 の盤の4辺に1人ずつ）。shogi.js が詳細設定の人数 4 のときにこちらへ任せる。
// 決まり（本人の決定と Claude の決めた作り）は .claude/rules/shogi.md の「4人将棋」。
//
// マスの番号 = 段 * 9 + 筋（段0 が盤のいちばん上、筋0 がいちばん左。席0 の人から見た向き）。
// 席: 0 = 下（上へ進む）、1 = 右（左へ進む）、2 = 上（下へ進む）、3 = 左（右へ進む）。順番は 0 → 1 → 2 → 3（反時計回り）。
// 「自分から見た段」（rankOf）= 自分の一段目（手前のはし）から何段進んだか（0〜8）。「自分から見た筋」（xOf）= 自分の左から何番目か（0〜8）。
// 最初の並び（1人9枚）: 一段目の真ん中5マスに 銀金玉金銀、二段目に 歩飛歩、三段目に 歩（飛の前）。
// 盤の値: 0 = 空、それ以外 = 持ち主 * 16 + 駒の番号（shogi.js と同じ。1歩 4銀 5金 7飛 8玉、成ると +8。香・桂・角は使わない）。
// 持ち駒 hands[p][駒の番号] = 枚数。手は shogi.js と同じ形（{ f, t, pr } / { d, t } / { resign: true }）。
// 成れるのは自分から見て奥の3段（段6〜8）。歩はいちばん奥の段では必ず成る・いちばん奥の段には打てない。二歩は自分から見た同じ筋で数える。
// 王を取られた人・投了した人・指せる手が無くなった人は脱落し、その人の駒（持ち駒も）は消える（3人将棋と同じ。王手を放っておいてよい）。
// 最後の1人まで続ける。同じ局面が4回・600手で引き分け。
// 詳細設定「いつも成る」があり（局面に auto: true）なら、成れる手の成らない方を作らない（shogi.js と同じ）。

const PAWN = 1;
const SILVER = 4;
const GOLD = 5;
const ROOK = 7;
const KING = 8;
const N = 9;
const CELLS = N * N;
const SEATS = [0, 1, 2, 3];
const MAX_PLY = 600;

export const NAMES = ['☗先手', '☖後手', '三番手', '四番手'];
const KANJI = { 1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉', 9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '龍' };
const NOTE_NAME = { ...KANJI, 12: '成銀' };

// 席ごとの「前」と「右」（[段の向き, 筋の向き]）
const FWD = [[-1, 0], [0, -1], [1, 0], [0, 1]];
const RIGHT = [[0, 1], [-1, 0], [0, -1], [1, 0]];

// 動き（駒の持ち主から見た向き。[段の向き, 筋の向き]、前が -1。shogi.js と同じ書き方）
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const GOLD_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
const STEPS = {
  1: [[-1, 0]], 4: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], 5: GOLD_STEPS,
  8: [...ORTHO, ...DIAG], 9: GOLD_STEPS, 12: GOLD_STEPS, 15: DIAG,
};
const SLIDES = { 7: ORTHO, 15: ORTHO };

const ownerOf = (v) => v >> 4;
const typeOf = (v) => v & 15;
const base = (t) => (t > 8 ? t - 8 : t);
const canPromote = (t) => t <= 7 && t !== GOLD;
const rowOf = (i) => Math.floor(i / N);
const colOf = (i) => i % N;
// 自分から見た段（一段目が 0）と筋（左はしが 0）
const rankOf = (p, i) => 4 + (rowOf(i) - 4) * FWD[p][0] + (colOf(i) - 4) * FWD[p][1];
const xOf = (p, i) => 4 + (rowOf(i) - 4) * RIGHT[p][0] + (colOf(i) - 4) * RIGHT[p][1];
// 自分から見た段・筋 → マスの番号
const sqOf = (p, rank, x) => (4 + (rank - 4) * FWD[p][0] + (x - 4) * RIGHT[p][0]) * N + 4 + (rank - 4) * FWD[p][1] + (x - 4) * RIGHT[p][1];
const inZone = (p, i) => rankOf(p, i) >= 6;
const mustPromote = (t, p, i) => t === PAWN && rankOf(p, i) === 8;
// 持ち主から見た向き [dr, dc] へ1つ進んだマス（盤の外は -1）
function stepFrom(i, p, dr, dc) {
  const r = rowOf(i) - dr * FWD[p][0] + dc * RIGHT[p][0];
  const c = colOf(i) - dr * FWD[p][1] + dc * RIGHT[p][1];
  return r < 0 || r >= N || c < 0 || c >= N ? -1 : r * N + c;
}

// i の駒が動けるマス（own = 自分の駒のあるマスも入れる。利きを数えるとき）
function reach(board, i, own = false) {
  const v = board[i];
  const owner = ownerOf(v);
  const t = typeOf(v);
  const out = [];
  for (const [dr, dc] of STEPS[t] ?? []) {
    const j = stepFrom(i, owner, dr, dc);
    if (j >= 0 && (own || !board[j] || ownerOf(board[j]) !== owner)) out.push(j);
  }
  for (const [dr, dc] of SLIDES[t] ?? []) {
    for (let j = stepFrom(i, owner, dr, dc); j >= 0; j = stepFrom(j, owner, dr, dc)) {
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

function pawnOnFile(board, side, x) {
  for (let i = 0; i < CELLS; i++) if (board[i] === side * 16 + PAWN && xOf(side, i) === x) return true;
  return false;
}

// 指せる手（王手の放置も、王を取る手も含む）。auto は「いつも成る」
function legalMoves(board, hands, side, auto = false) {
  const out = [];
  for (let i = 0; i < CELLS; i++) {
    const v = board[i];
    if (!v || ownerOf(v) !== side) continue;
    const t = typeOf(v);
    for (const j of reach(board, i)) {
      if (canPromote(t) && (inZone(side, i) || inZone(side, j))) {
        out.push({ f: i, t: j, pr: true });
        if (!auto && !mustPromote(t, side, j)) out.push({ f: i, t: j, pr: false });
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
      if (d === PAWN && pawnOnFile(board, side, xOf(side, j))) continue; // 二歩
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

// 打つ手と動かす手は取り違えない（動かす手に d を付けて送られても、持っていない駒を打たせない）
const sameMove = (a, b) => a.t === b.t && !!a.d === !!b.d && (a.d ? a.d === b.d : a.f === b.f && !!a.pr === !!b.pr);
const posKey = (board, hands, turn) => `${board.join(',')}|${hands.map((x) => x.join('')).join('|')}|${turn}`;
const nextAlive = (turn, alive) => {
  for (let k = 1; k <= 4; k++) if (alive[(turn + k) % 4]) return (turn + k) % 4;
  return turn;
};
// side の玉に誰かが利いているか
const inCheck = (board, alive, side) => {
  const k = kingSq(board, side);
  return k >= 0 && SEATS.some((q) => q !== side && alive[q] && attackSet(board, q).has(k));
};

function initialBoard() {
  const b = Array(CELLS).fill(0);
  for (const p of SEATS) {
    [SILVER, GOLD, KING, GOLD, SILVER].forEach((t, k) => { b[sqOf(p, 0, 2 + k)] = p * 16 + t; });
    b[sqOf(p, 1, 3)] = p * 16 + PAWN;
    b[sqOf(p, 1, 4)] = p * 16 + ROOK;
    b[sqOf(p, 1, 5)] = p * 16 + PAWN;
    b[sqOf(p, 2, 4)] = p * 16 + PAWN;
  }
  return b;
}

/* ---------- CPU（3人将棋と同じ考え方） ---------- */

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
    if (t === PAWN || t === SILVER) v += rankOf(p, i) * 3;
  }
  for (let d = 1; d <= 7; d++) v += hands[p][d] * VALUE[d] * 1.1;
  return v;
}

// 指したあとに、ほかの人が取れるいちばん大きな得（取り返せるなら取った駒の値を引く）。玉が取られるなら KING_LOSS
function threat(b, alive, me) {
  const mine = attackSet(b, me, true);
  let worst = 0;
  for (const q of SEATS) {
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
  const moves = legalMoves(s.board, s.hands, me, !!s.auto);
  const kill = moves.find((m) => !m.d && s.board[m.t] && typeOf(s.board[m.t]) === KING);
  if (kill) return kill;
  if (Math.random() < { weak: 0.3, normal: 0.08, strong: 0 }[level]) return moves[Math.floor(Math.random() * moves.length)];
  let best = -Infinity;
  let top = [];
  for (const m of moves) {
    const { b, h, killed } = make(s.board, s.hands, me, m);
    const alive = s.alive.map((a, q) => a && q !== killed);
    let v = material(b, h, me);
    for (const q of SEATS) if (q !== me && alive[q]) v -= 0.35 * material(b, h, q);
    const th = threat(b, alive, me);
    v -= level === 'weak' ? (th >= KING_LOSS ? th : 0) : th * (level === 'strong' ? 1 : 0.8);
    v += Math.random() * (level === 'strong' ? 1 : 20);
    if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
  }
  return top[0];
}

/* ---------- 進行 ---------- */

export function init(auto = false, quiet = false) {
  const board = initialBoard();
  const hands = SEATS.map(() => Array(8).fill(0));
  const s = { n: 4, board, hands, turn: 0, ply: 0, alive: [true, true, true, true], out: [], last: null, keys: [posKey(board, hands, 0)], result: null };
  if (auto) s.auto = true; // いつも成る（なしのときは何も足さない）
  if (quiet) s.quiet = true; // 王手の知らせ「なし」
  return s;
}

// 王手の知らせ（shogi.js が使う）: 最後の手で、指した人の駒がほかの（残っている）人の玉に利いているか。局面だけから決める
export function gaveCheck(s) {
  if (s.result || !s.last || s.last.resign) return false;
  const me = s.last.side;
  const mine = attackSet(s.board, me);
  return SEATS.some((q) => q !== me && s.alive[q] && mine.has(kingSq(s.board, q)));
}

function finish(n) {
  const left = SEATS.filter((q) => n.alive[q]);
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
    const legal = legalMoves(s.board, s.hands, s.turn, !!s.auto);
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
  while (alive.filter(Boolean).length > 1 && !legalMoves(b, h, next, !!s.auto).length) {
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
  if (s.auto) parts.push('いつも成る');
  if (s.out.length) parts.push(`脱落: ${s.out.map((q) => `<b class="pl p${q}">${NAMES[q]}</b>`).join('、')}`);
  if (s.last?.note) parts.push(`${s.ply}手目 ${s.last.note}`);
  if (s.result) parts.push(s.result.reason);
  else if (inCheck(s.board, s.alive, s.turn)) parts.push('<b class="sg-check-text">王手！（玉が取られそう）</b>');
  return parts.join('　');
}

/* ---------- 画面（3人将棋と同じ SVG の部品と見た目を使う。style.css の .sg3-…） ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

let ui = { key: null, from: null, drop: null, promo: null };

export function render(root, s, o) {
  const draw = () => render(root, s, o);
  const bottom = Number.isInteger(o.view) && o.view >= 0 && o.view <= 3 ? o.view : o.me >= 0 && o.me <= 3 ? o.me : 0; // 盤の向きを変えた（⇅）ときは o.view の人が下
  const key = `${s.ply}:${o.me}`;
  if (ui.key !== key) ui = { key, from: null, drop: null, promo: null };
  const can = o.canMove && !s.result;
  const legal = can ? legalMoves(s.board, s.hands, s.turn, !!s.auto) : [];
  const targets = new Set();
  if (ui.from !== null) for (const m of legal) if (m.f === ui.from) targets.add(m.t);
  if (ui.drop !== null) for (const m of legal) if (m.d === ui.drop) targets.add(m.t);
  const movable = new Set(legal.filter((m) => !m.d).map((m) => m.f));
  const droppable = new Set(legal.filter((m) => m.d).map((m) => m.d));
  const checked = new Set();
  if (!s.result) for (const q of SEATS) if (s.alive[q] && inCheck(s.board, s.alive, q)) checked.add(kingSq(s.board, q));

  root.innerHTML = '';
  root.className = 'board sg sg3 sg4';

  const pick = (t) => {
    const opts = legal.filter((m) => m.t === t && (ui.drop !== null ? m.d === ui.drop : m.f === ui.from));
    if (!opts.length) return;
    if (opts.length === 2) { ui.promo = { f: ui.from, t }; draw(); return; }
    o.onMove(opts[0]);
  };

  const WHERE = ['下', '右', '上', '左']; // 下に来る人から見た、その席の場所
  const handRow = (side) => {
    const row = document.createElement('div');
    row.className = 'sg-hand' + (side === o.me ? ' mine' : '') + (s.alive[side] ? '' : ' out');
    const label = document.createElement('span');
    label.className = `sg-hand-label pl p${side}`;
    label.textContent = `${NAMES[side]}（${WHERE[(side - bottom + 4) % 4]}）の持ち駒`;
    row.append(label);
    if (!s.alive[side]) {
      const none = document.createElement('span');
      none.className = 'sg-hand-none';
      none.textContent = '脱落';
      row.append(none);
      return row;
    }
    let any = false;
    for (const d of [7, 5, 4, 1]) {
      const n = s.hands[side][d];
      if (!n) continue;
      any = true;
      const ok = can && side === s.turn && droppable.has(d);
      const e = document.createElement(ok ? 'button' : 'span');
      e.className = 'sg-hand-piece' + (ok ? ' playable' : '') + (ui.drop === d && side === s.turn ? ' selected' : '') + (o.peekIn?.d === d && side === s.turn ? ' peek' : '');
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

  // 自分（観戦では☗先手）の持ち駒を下に、ほかの3人を上に
  for (const k of [1, 2, 3]) root.append(handRow((bottom + k) % 4));

  const svg = svgEl('svg', { viewBox: '-0.3 -0.3 9.6 9.6', class: 'sg3-board', role: 'img' });
  svg.setAttribute('aria-label', '4人将棋の盤');
  svg.append(svgEl('rect', { x: -0.2, y: -0.2, width: 9.4, height: 9.4, rx: 0.15, class: 'sg3-frame' }));
  const ANGLE = [0, -90, 180, 90]; // 下の人から数えて何番目の席か → 駒の向き
  for (let i = 0; i < CELLS; i++) {
    // 画面での場所: 下に来る人から見た段と筋
    const x = xOf(bottom, i);
    const y = 8 - rankOf(bottom, i);
    const v = s.board[i];
    const isTarget = targets.has(i);
    const mineToMove = can && v && ownerOf(v) === s.turn && movable.has(i);
    const cls = ['sg3-cell'];
    if (s.last && !s.last.resign && s.last.t === i) cls.push('last');
    if (i === ui.from) cls.push('selected');
    if (o.peekIn?.f === i) cls.push('peek'); // 相手の迷いが見える（main.js の o.peek・o.peekIn）
    if (o.peekIn?.a === i) cls.push('peek-aim');
    if (checked.has(i)) cls.push('checked');
    if (isTarget || mineToMove) cls.push('active');
    svg.append(svgEl('rect', { x, y, width: 1, height: 1, class: cls.join(' ') }));
    if (v) {
      const t = typeOf(v);
      const owner = ownerOf(v);
      const grp = svgEl('g', { transform: `translate(${x + 0.5} ${y + 0.5}) rotate(${ANGLE[(owner - bottom + 4) % 4]}) scale(0.9)`, class: `sg3-piece o${owner}${t > 8 ? ' promoted' : ''}` });
      grp.append(svgEl('polygon', { points: '0,-0.5 0.34,-0.34 0.42,0.48 -0.42,0.48 -0.34,-0.34' }));
      const text = svgEl('text', { x: 0, y: 0.1, 'font-size': 0.56 });
      text.textContent = KANJI[t];
      grp.append(text);
      svg.append(grp);
    }
    if (isTarget) svg.append(svgEl('circle', { cx: x + 0.5, cy: y + 0.5, r: v ? 0.46 : 0.16, class: v ? 'sg3-target take' : 'sg3-target' }));
    if (isTarget || mineToMove) {
      // 押す所は駒や印の上にかぶせた透明な形（駒の絵が押すのを邪魔しないように）
      const hit = svgEl('rect', { x, y, width: 1, height: 1, class: 'sg3-hit' });
      if (isTarget && o.peek) {
        hit.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') o.peek({ f: ui.from, d: ui.drop, a: i }); });
        hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') o.peek({ f: ui.from, d: ui.drop, a: null }); });
      }
      hit.addEventListener('click', () => {
        if (isTarget) { pick(i); return; }
        ui = { ...ui, drop: null, promo: null, from: ui.from === i ? null : i };
        draw();
      });
      svg.append(hit);
    }
  }
  root.append(svg);

  root.append(handRow(bottom));
  o.peek?.({ f: ui.from, d: ui.drop, a: null }); // 相手の迷いが見える: いまの選びを知らせる

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
export const _test4 = { gaveCheck, legalMoves, reach, initialBoard, attackSet, make, kingSq, rankOf, xOf, sqOf };
