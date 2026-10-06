// マルバツ（三目並べ）。手 = マスの番号 0〜8（左上から右へ）。
// 詳細設定「盤」でスーパーマルバツ（9×9）にできる（2026-10-04 本人の決定。決まりは Claude の推奨を本人が承認）:
//   3×3 の小さい盤が 3×3 に並ぶ。手 = 小さい盤の番号×9 ＋ その中のマスの番号（0〜80）。最初は真ん中の小さい盤に置く。
//   小さい盤の中で置いたマスの位置と同じ位置の小さい盤に、次の人が置く。小さい盤で3つ並べたらその盤は並べた人のもの。
//   取られた盤・埋まって誰も並ばなかった盤（引き分けの盤。誰のものでもない）にはもう置けず、そこへ送られたら空いている盤のどこにでも置ける。
//   取った盤が3つ並んだら勝ち。並ばずに置ける所が無くなったら引き分け。
//   同じ画面の2人対戦は詳細設定が無いので、ふつうのマルバツだけ（将棋の駒落ちと同じ）。
// 詳細設定「人数」で3人・4人にもできる（2026-10-04 本人の決定。盤の大きさは詳細設定で選ぶ）:
//   ○×△□ で順番に、広い盤（5×5〜9×9）に置く。3つ並べたら勝ち。手 = マスの番号（左上から右へ）。
//   スーパーは2人のときだけ（3人以上では「盤」の設定を見ない）。待合室では人数ぶんの席に人か CPU を選ぶ。
// 詳細設定「盤」で消えるマルバツにもできる（2026-10-05 本人の決定。決まりは Claude の推奨を本人が承認）:
//   3×3・2人だけ。自分の印は3つまで。4つ目を置くと、自分の一番古い印が消える（消える印は薄く見せる）。60手で引き分け。
//   置けるのは空いているマスだけ（Claude の判断: 消える印のマスにはその手では置けない。置いたあとで古い印が消える）。
// 詳細設定「盤」でかぶせマルバツにもできる（2026-10-06 本人の決定。決まりは Claude の推奨を本人が承認）:
//   3×3・2人だけ。大・中・小の駒を2つずつ持ち、空いたマスか、自分より小さい駒（どちらの駒でも）の上に置ける。
//   盤の上の自分の一番上の駒を動かしてもよい。並びは各マスの一番上の駒で見る。動かしたあと相手の3つ並びが見えていたら、
//   自分も並んでいても相手の勝ち。60手で引き分け。手 = 行き先のマス + 9 × 出どころ（0〜2 = 手元の小・中・大、3〜11 = 盤のマス + 3）。
//   Claude の判断: 動かす駒は元のマスへ戻せない・打てる手が無ければ引き分け・下に隠れた駒の数は画面に小さく出す。

import { CPU_SETTING, boardCpu, hintIs, TEAM_SETTING, teamOn, isMate, teamResult } from './util.js';

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARKS = [
  '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="28"/></svg>',
  '<svg viewBox="0 0 100 100"><path d="M26 26 L74 74 M74 26 L26 74"/></svg>',
  '<svg viewBox="0 0 100 100"><path d="M50 22 L78 72 L22 72 Z"/></svg>',
  '<svg viewBox="0 0 100 100"><rect x="26" y="26" width="48" height="48"/></svg>',
];
const DRAWN = 'd'; // 引き分けの小さい盤

// 3つ並んだ列（無ければ null）。v は9つの値
function lineOf(v) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if ((v[a] === 0 || v[a] === 1) && v[a] === v[b] && v[a] === v[c]) return line;
  }
  return null;
}

/* ---------- スーパーマルバツ ---------- */

const sub = (board, b) => board.slice(b * 9, b * 9 + 9);

// 打てる手の一覧
function bigLegal(s) {
  if (bigResult(s)) return [];
  const out = [];
  for (let b = 0; b < 9; b++) {
    if (s.owner[b] !== null || (s.next !== null && s.next !== b)) continue;
    for (let c = 0; c < 9; c++) if (s.board[b * 9 + c] === null) out.push(b * 9 + c);
  }
  return out;
}

function bigApply(s, m) {
  if (!Number.isInteger(m) || m < 0 || m > 80 || s.board[m] !== null || bigResult(s)) return null;
  const b = Math.floor(m / 9);
  const c = m % 9;
  if (s.owner[b] !== null || (s.next !== null && s.next !== b)) return null;
  const board = s.board.slice();
  board[m] = s.turn;
  const owner = s.owner.slice();
  const small = sub(board, b);
  if (lineOf(small)) owner[b] = s.turn;
  else if (small.every((v) => v !== null)) owner[b] = DRAWN;
  return { big: true, board, owner, next: owner[c] === null ? c : null, turn: 1 - s.turn, last: m };
}

// cells は光らせる小さい盤の番号
function bigResult(s) {
  const line = lineOf(s.owner);
  if (line) return { winner: s.owner[line[0]], cells: line };
  if (s.owner.every((v) => v !== null)) return { winner: null, cells: [] };
  return null;
}

// CPU の形勢の見積もり（p から見た点数）: 取った盤とその並び、小さい盤の中の2つ並び
function bigScore(s, p) {
  const q = 1 - p;
  let v = 0;
  for (const line of LINES) {
    const o = line.map((i) => s.owner[i]);
    const mine = o.filter((x) => x === p).length;
    const theirs = o.filter((x) => x === q).length;
    if (o.includes(DRAWN) || (mine && theirs)) continue;
    v += [0, 15, 80][mine] - [0, 15, 80][theirs];
  }
  for (let b = 0; b < 9; b++) {
    if (s.owner[b] === p) v += b === 4 ? 40 : 30;
    else if (s.owner[b] === q) v -= b === 4 ? 40 : 30;
    if (s.owner[b] !== null) continue;
    const small = sub(s.board, b);
    for (const line of LINES) {
      const o = line.map((i) => small[i]);
      const mine = o.filter((x) => x === p).length;
      const theirs = o.filter((x) => x === q).length;
      if (mine && theirs) continue;
      v += [0, 0.5, 4][mine] - [0, 0.5, 4][theirs];
    }
  }
  // 相手をどこにでも置ける形にするのは損
  if (s.next === null) v += s.turn === p ? 6 : -6;
  return v;
}

/* ---------- 消えるマルバツ ---------- */

const VANISH_KEEP = 3;
const VANISH_LIMIT = 60;

function vanishApply(s, m) {
  if (!Number.isInteger(m) || m < 0 || m > 8 || s.board[m] !== null || vanishResult(s)) return null;
  const board = s.board.slice();
  const hist = s.hist.map((h) => h.slice());
  const mine = hist[s.turn];
  mine.push(m);
  board[m] = s.turn;
  if (mine.length > VANISH_KEEP) board[mine.shift()] = null;
  const line = lineOf(board);
  return { ...s, board, hist, turn: 1 - s.turn, last: m, n: s.n + 1, won: line ? { winner: s.turn, cells: line } : null };
}

function vanishResult(s) {
  if (s.won) return s.won;
  if (s.n >= VANISH_LIMIT) return { winner: null, cells: [] };
  return null;
}

// 次に消える印（印が3つある人の一番古い印）
const fading = (s) => s.hist.filter((h) => h.length >= VANISH_KEEP).map((h) => h[0]);

// CPU の形勢の見積もり: 2つ並んで残り1マスが空いている列。ただし次に消える印を含む列は数えない
function vanishScore(s, p) {
  const fade = new Set(fading(s));
  let v = 0;
  for (const line of LINES) {
    const o = line.map((i) => s.board[i]);
    if (line.some((i) => fade.has(i))) continue;
    const mine = o.filter((x) => x === p).length;
    const theirs = o.filter((x) => x === 1 - p).length;
    if (mine === 2 && theirs === 0) v += 10;
    if (theirs === 2 && mine === 0) v -= 10;
  }
  if (s.board[4] === p) v += 3; else if (s.board[4] === 1 - p) v -= 3;
  return v;
}

/* ---------- かぶせマルバツ ---------- */

const GOB_LIMIT = 60;
const GOB_SIZE = ['小', '中', '大'];
const gobTop = (st) => (st.length ? st[st.length - 1] : null);
// 各マスの一番上の駒の持ち主（無ければ null）
const gobOwners = (stacks) => stacks.map((st) => gobTop(st)?.p ?? null);

function gobLegal(s) {
  if (gobResult(s)) return [];
  const out = [];
  const p = s.turn;
  const fits = (to, z) => { const t = gobTop(s.stacks[to]); return !t || t.z < z; };
  for (let z = 0; z < 3; z++) {
    if (!s.hand[p][z]) continue;
    for (let to = 0; to < 9; to++) if (fits(to, z)) out.push(to + 9 * z);
  }
  for (let from = 0; from < 9; from++) {
    const t = gobTop(s.stacks[from]);
    if (!t || t.p !== p) continue;
    for (let to = 0; to < 9; to++) if (to !== from && fits(to, t.z)) out.push(to + 9 * (from + 3));
  }
  return out;
}

function gobApply(s, m) {
  if (!Number.isInteger(m) || m < 0 || m >= 108 || gobResult(s)) return null;
  const to = m % 9;
  const src = Math.floor(m / 9);
  const p = s.turn;
  const stacks = s.stacks.map((st) => st.slice());
  const hand = s.hand.map((h) => h.slice());
  let piece;
  if (src < 3) {
    if (!hand[p][src]) return null;
    hand[p][src]--;
    piece = { p, z: src };
  } else {
    const from = src - 3;
    piece = gobTop(stacks[from]);
    if (from === to || !piece || piece.p !== p) return null;
    stacks[from].pop();
  }
  const under = gobTop(stacks[to]);
  if (under && under.z >= piece.z) return null;
  stacks[to].push(piece);
  const owners = gobOwners(stacks);
  const lineFor = (q) => LINES.find((l) => l.every((i) => owners[i] === q)) ?? null;
  const theirs = lineFor(1 - p);
  const mine = lineFor(p);
  const won = theirs ? { winner: 1 - p, cells: theirs } : mine ? { winner: p, cells: mine } : null;
  const t = { ...s, stacks, hand, turn: 1 - p, last: to, from: src < 3 ? null : src - 3, n: s.n + 1, won };
  if (!won && !gobLegal(t).length) t.stuck = true;
  return t;
}

function gobResult(s) {
  if (s.won) return s.won;
  if (s.n >= GOB_LIMIT || s.stuck) return { winner: null, cells: [] };
  return null;
}

// CPU の形勢の見積もり: 一番上の駒で2つ並んで、残り1マスが空いている（か、その人の手元の一番大きい駒でかぶせられる）列。手元の大きい駒も少し得
function gobScore(s, p) {
  const owners = gobOwners(s.stacks);
  const biggest = (q) => (s.hand[q][2] ? 2 : s.hand[q][1] ? 1 : s.hand[q][0] ? 0 : -1);
  let v = 0;
  for (const line of LINES) {
    for (const q of [p, 1 - p]) {
      const own = line.filter((i) => owners[i] === q).length;
      if (own !== 2) continue;
      const rest = line.find((i) => owners[i] !== q);
      const top = gobTop(s.stacks[rest]);
      if (!top || top.z < biggest(q)) v += q === p ? 10 : -10;
    }
  }
  if (owners[4] === p) v += 3; else if (owners[4] === 1 - p) v -= 3;
  v += 2 * (s.hand[p][2] - s.hand[1 - p][2]);
  return v;
}

// 画面で選んでいる駒（この端末だけ。手の一覧には入れない）。局面が変わったら選び直し
let gobSel = null; // { n: 何手目の局面か, src: 出どころ（手の src と同じ） }

function gobPiece(piece) {
  const el = document.createElement('span');
  el.className = `gob-pc z${piece.z} p${piece.p}`;
  el.innerHTML = MARKS[piece.p];
  return el;
}

function renderGob(root, s, o) {
  const res = gobResult(s);
  const legal = o.canMove ? gobLegal(s) : [];
  if (gobSel && (gobSel.n !== s.n || !o.canMove)) gobSel = null;
  const pick = (src) => { gobSel = gobSel?.src === src ? null : { n: s.n, src }; renderGob(root, s, { ...o, fresh: false }); };
  const targets = new Set(gobSel ? legal.filter((m) => Math.floor(m / 9) === gobSel.src).map((m) => m % 9) : []);
  // おすすめの手（手 = 行き先 + 9 × 動かす元。元は 0〜2 が手元の大きさ、3〜11 が盤のマス + 3）
  const hint = Number.isInteger(o.hint) ? { to: o.hint % 9, src: Math.floor(o.hint / 9) } : null;
  root.innerHTML = '';
  root.className = 'board gob';
  const bottom = o.me === 1 ? 1 : 0; // 自分の手元を下に出す（観戦と同じ画面の対局は ○ が下）
  const handRow = (q) => {
    const row = document.createElement('div');
    row.className = 'gob-hand' + (q === s.turn && !res ? ' turn' : '');
    for (let z = 2; z >= 0; z--) {
      for (let k = 0; k < s.hand[q][z]; k++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gob-slot';
        b.append(gobPiece({ p: q, z }));
        const can = q === s.turn && legal.some((m) => Math.floor(m / 9) === z);
        if (can) {
          b.classList.add('playable');
          if (gobSel?.src === z && k === 0) b.classList.add('sel');
          if (hint?.src === z && k === 0) b.classList.add('hint');
          b.setAttribute('aria-label', `手元の${GOB_SIZE[z]}を選ぶ`);
          b.onclick = () => pick(z);
        } else b.tabIndex = -1;
        row.append(b);
      }
    }
    if (!row.children.length) row.innerHTML = '<span class="gob-empty">手元の駒なし</span>';
    return row;
  };
  const grid = document.createElement('div');
  grid.className = 'ttt';
  s.stacks.forEach((st, i) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'ttt-cell';
    const top = gobTop(st);
    if (top) {
      const pc = gobPiece(top);
      if (i === s.last && o.fresh) pc.classList.add('pop');
      cell.append(pc);
      if (st.length > 1) {
        const hid = document.createElement('span');
        hid.className = 'gob-under';
        hid.textContent = '下に' + (st.length - 1);
        cell.append(hid);
      }
    }
    if (i === s.last && !res) cell.classList.add('last');
    if (s.from === i && !res) cell.classList.add('gob-from');
    if (res?.cells.includes(i)) cell.classList.add('win');
    if (hint && (hint.to === i || hint.src === i + 3)) cell.classList.add('hint');
    if (targets.has(i)) {
      cell.classList.add('playable', 'target');
      cell.setAttribute('aria-label', `${i + 1}番のマスへ`);
      cell.onclick = () => { const src = gobSel.src; gobSel = null; o.onMove(i + 9 * src); };
    } else if (top && legal.some((m) => Math.floor(m / 9) === i + 3)) {
      cell.classList.add('playable');
      if (gobSel?.src === i + 3) cell.classList.add('sel');
      cell.setAttribute('aria-label', `${i + 1}番のマスの駒を動かす`);
      cell.onclick = () => pick(i + 3);
    } else cell.tabIndex = -1;
    grid.append(cell);
  });
  root.append(handRow(1 - bottom), grid, handRow(bottom));
}

/* ---------- 3〜4人のマルバツ（広い盤） ---------- */

// 盤の幅 w で k 個並びになる列（窓）の一覧。マスごとに、そのマスを含む窓の番号も持つ
const WINDOWS = {};
function windowsOf(w, k) {
  const key = w + ':' + k;
  if (WINDOWS[key]) return WINDOWS[key];
  const list = [];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const ex = x + dx * (k - 1);
        const ey = y + dy * (k - 1);
        if (ex < 0 || ex >= w || ey < 0 || ey >= w) continue;
        list.push(Array.from({ length: k }, (_, i) => (y + dy * i) * w + x + dx * i));
      }
    }
  }
  const byCell = Array.from({ length: w * w }, () => []);
  list.forEach((win, i) => { for (const c of win) byCell[c].push(i); });
  WINDOWS[key] = { list, byCell };
  return WINDOWS[key];
}

// 3人以上の盤の選択肢。値は「幅-並べる数」。auto は人数で決める。
// CPU（つよい）どうしで400局ずつ打たせて決めた（2026-10-04）: 4つ並べは、ほかの人が毎回ふさぐのでほぼ全部引き分けになるため出さない。
// 3人は 5×5 がいちばん席順の差が小さい（1〜3番目の勝ち 26%・24%・14%、引き分け 35%）。広い盤ほど早く決着し3番目が不利（9〜13%）。
// 4人は 7×7 以下だと引き分けが4割を超え、8×8 で 2割。もう一回のたびに打つ順番を回すので、席順の差は続けて遊ぶとならされる。
const WIDE_AUTO = { 3: '5-3', 4: '8-3' };
const WIDE_CHOICES = [['auto', 'おまかせ（3人は 5×5・4人は 8×8）'], ['5-3', '5×5'], ['6-3', '6×6'], ['7-3', '7×7'], ['8-3', '8×8'], ['9-3', '9×9']];
function wideSize(v, n) {
  const key = WIDE_CHOICES.some(([c]) => c === v) && v !== 'auto' ? v : WIDE_AUTO[n];
  return key.split('-').map(Number);
}

function wideApply(s, m) {
  if (!Number.isInteger(m) || m < 0 || m >= s.board.length || s.board[m] !== null || s.won) return null;
  const board = s.board.slice();
  board[m] = s.turn;
  const { list, byCell } = windowsOf(s.w, s.k);
  const line = byCell[m].map((i) => list[i]).find((win) => win.every((c) => board[c] === s.turn));
  return { ...s, board, turn: (s.turn + 1) % s.n, last: m, won: line ? { winner: s.turn, cells: line } : null };
}

function wideResult(s) {
  if (s.won) return s.won;
  if (s.board.every((v) => v !== null)) return { winner: null, cells: [] };
  return null;
}

// p がそこに置けば勝てるマス
function winningCells(s, p) {
  const { list } = windowsOf(s.w, s.k);
  const out = new Set();
  for (const win of list) {
    let mine = 0;
    let empty = -1;
    for (const c of win) {
      if (s.board[c] === p) mine++;
      else if (s.board[c] === null) empty = c;
    }
    if (mine === s.k - 1 && empty >= 0) out.add(empty);
  }
  return [...out];
}

// CPU（よわい・ふつう・つよい）。読みはせず、マスごとの点数で選ぶ。
//   1. 置けば勝てるなら置く  2. ほかの人が次に勝てるマスをふさぐ（先に番が来る人から）
//   3. マスの点数: そのマスを含む窓のうち、自分の印だけの窓は攻め、1人の相手の印だけの窓は守りとして足す
//   よわい: 半分は適当に打ち、ふさぐのも半分だけ。ふつう: 1割は適当。つよい: 適当に打たず、2つの窓で同時に勝ちに迫る手を重く見る
function wideCpu(s, rules) {
  const level = ['weak', 'normal', 'strong'].includes(rules?.cpu) ? rules.cpu : 'weak';
  const p = s.turn;
  const empty = s.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const any = () => empty[Math.floor(Math.random() * empty.length)];
  const mine = winningCells(s, p);
  if (mine.length && (level !== 'weak' || Math.random() < 0.8)) return mine[0];
  if (Math.random() < { weak: 0.5, normal: 0.1, strong: 0 }[level]) return any();
  if (level !== 'weak' || Math.random() < 0.5) {
    for (let d = 1; d < s.n; d++) {
      if (isMate(s, p, (p + d) % s.n)) continue; // チーム戦: 味方はふさがない
      const threat = winningCells(s, (p + d) % s.n);
      if (threat.length) return threat[Math.floor(Math.random() * threat.length)];
    }
  }
  const { list, byCell } = windowsOf(s.w, s.k);
  const ATTACK = [1, 4, 20, 120, 600];
  const GUARD = [0, 3, 14, 80, 400];
  let best = -Infinity;
  let top = [];
  for (const c of empty) {
    let v = 0;
    let near = 0; // 勝ちまであと1つになる窓の数（つよいだけが使う）
    for (const wi of byCell[c]) {
      let owner = null;
      let count = 0;
      let mixed = false;
      for (const x of list[wi]) {
        const b = s.board[x];
        if (b === null) continue;
        if (owner === null) owner = b;
        else if (owner !== b) mixed = true;
        count++;
      }
      if (mixed) continue;
      if (owner === null) v += ATTACK[0];
      else if (owner === p) {
        v += ATTACK[count];
        if (count === s.k - 2) near++;
      } else if (!isMate(s, p, owner)) {
        const soon = (owner - p + s.n) % s.n; // 1 = 次の番の人
        v += GUARD[count] * (soon === 1 ? 1 : 0.7);
      }
    }
    if (level === 'strong' && near >= 2) v += 500;
    v += Math.random() * 0.5; // 同じ点数なら毎回違う手に
    if (v > best) { best = v; top = [c]; } else if (v === best) top.push(c);
  }
  return top[0];
}

function renderWide(root, s, o) {
  const res = wideResult(s);
  root.innerHTML = '';
  root.className = 'board tttw';
  root.style.setProperty('--w', s.w);
  s.board.forEach((v, i) => {
    const cell = cellButton(v, i, s, o, v === null && o.canMove);
    if (res?.cells.includes(i)) cell.classList.add('win');
    root.append(cell);
  });
}

/* ---------- 画面 ---------- */

function cellButton(v, i, s, o, playable) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'ttt-cell';
  if (v !== null) {
    cell.innerHTML = MARKS[v];
    cell.classList.add('p' + v);
    if (i === s.last) cell.classList.add('last');
    if (i === s.last && o.fresh) cell.classList.add('pop');
  }
  if (playable) {
    cell.classList.add('playable');
    if (hintIs(o, i)) cell.classList.add('hint');
    cell.onclick = () => o.onMove(i);
  } else {
    cell.tabIndex = -1;
  }
  return cell;
}

function renderBig(root, s, o) {
  const res = bigResult(s);
  root.innerHTML = '';
  root.className = 'board ttt9';
  for (let b = 0; b < 9; b++) {
    const box = document.createElement('div');
    box.className = 'ttt9-sub';
    const open = !res && s.owner[b] === null && (s.next === null || s.next === b);
    if (open) box.classList.add('active');
    if (res?.cells.includes(b)) box.classList.add('win');
    for (let c = 0; c < 9; c++) {
      const i = b * 9 + c;
      box.append(cellButton(s.board[i], i, s, o, open && o.canMove && s.board[i] === null));
    }
    if (s.owner[b] !== null) {
      box.classList.add('closed');
      const cover = document.createElement('div');
      cover.className = 'ttt9-own' + (s.owner[b] === DRAWN ? ' drawn' : ' p' + s.owner[b]);
      cover.innerHTML = s.owner[b] === DRAWN ? '<span>引き分け</span>' : MARKS[s.owner[b]];
      box.append(cover);
    }
    root.append(box);
  }
}

export default {
  id: 'tictactoe',
  name: 'マルバツ',
  icon: '⭕',
  desc: 'たて・よこ・ななめに3つ並べたら勝ち。オンラインでは 9×9 のスーパーマルバツ・印が消えるマルバツや、3〜4人で広い盤も選べる',
  ready: true,
  players: ['○', '×', '△', '□'],
  // 詳細設定の人数（2〜4人）。待合室の席の数になる
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    {
      key: 'size', label: '盤', def: 'normal',
      desc: 'スーパーは小さい盤（3×3）が9つ並んだ 9×9。置いたマスの位置で、次の人が置く小さい盤が決まる。消えるは自分の印が3つまで（4つ目を置くと一番古い印が消える）。かぶせるは大・中・小の駒で、小さい駒の上にかぶせられる。どれも2人のときだけ',
      choices: [['normal', 'ふつう（3×3）'], ['super', 'スーパー（9×9）'], ['vanish', '消える（3×3）'], ['gobble', 'かぶせる（3×3）']],
    },
    {
      key: 'players', label: '人数', def: 2,
      desc: '3人・4人では、広い盤に ○×△□ で順番に置く（下の「3人以上の盤」）',
      choices: [[2, '2人'], [3, '3人'], [4, '4人']],
    },
    {
      key: 'wide', label: '3人以上の盤', def: 'auto',
      desc: '3人・4人で遊ぶときの盤の大きさ。どれも3つ並べたら勝ち',
      choices: WIDE_CHOICES,
    },
    TEAM_SETTING,
    CPU_SETTING,
  ],

  // CPU: よわい＝1手先だけ・ときどき適当、ふつう＝相手の次の手まで読む、つよい＝最後まで読む（負けない）
  // スーパー: よわい＝1手先・4割は適当、ふつう＝2手先・1割は適当、つよい＝4手先（どこにでも置ける局面は3手先。重くなるため）
  cpu(s, p, rules) {
    if (s.wide) return wideCpu(s, rules);
    if (s.gob) {
      return boardCpu(this, s, rules, gobLegal, gobScore, {
        depth: { weak: 1, normal: 2, strong: 3 }, mistake: { weak: 0.4, normal: 0.12, strong: 0 },
      });
    }
    if (s.vanish) {
      const legal = (x) => x.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
      return boardCpu(this, s, rules, legal, vanishScore, {
        depth: { weak: 1, normal: 3, strong: 7 }, mistake: { weak: 0.45, normal: 0.12, strong: 0 },
      });
    }
    if (s.big) {
      const free = s.next === null;
      return boardCpu(this, s, rules, bigLegal, bigScore, {
        depth: { weak: 1, normal: 2, strong: free ? 3 : 4 }, mistake: { weak: 0.4, normal: 0.1, strong: 0 },
      });
    }
    const legal = (x) => x.board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
    return boardCpu(this, s, rules, legal, () => 0, {
      depth: { weak: 1, normal: 2, strong: 9 }, mistake: { weak: 0.5, normal: 0.15, strong: 0 },
    });
  },

  init({ rules = {} } = {}) {
    const n = rules.players ?? 2;
    if (n >= 3) {
      const [w, k] = wideSize(rules.wide, n);
      return { wide: true, n, w, k, board: Array(w * w).fill(null), turn: 0, last: null, won: null, team: teamOn(rules) };
    }
    if (rules.size === 'gobble') return { gob: true, stacks: Array.from({ length: 9 }, () => []), hand: [[2, 2, 2], [2, 2, 2]], turn: 0, last: null, from: null, n: 0, won: null };
    if (rules.size === 'vanish') return { vanish: true, board: Array(9).fill(null), hist: [[], []], turn: 0, last: null, n: 0, won: null };
    if (rules.size === 'super') return { big: true, board: Array(81).fill(null), owner: Array(9).fill(null), next: 4, turn: 0, last: null };
    return { board: Array(9).fill(null), turn: 0, last: null };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.big) return bigApply(s, m);
    if (s.wide) return wideApply(s, m);
    if (s.vanish) return vanishApply(s, m);
    if (s.gob) return gobApply(s, m);
    if (!Number.isInteger(m) || m < 0 || m > 8 || s.board[m] !== null || this.result(s)) return null;
    const board = s.board.slice();
    board[m] = s.turn;
    return { board, turn: 1 - s.turn, last: m };
  },

  result(s) {
    if (s.big) return bigResult(s);
    if (s.wide) return s.team ? teamResult(wideResult(s)) : wideResult(s);
    if (s.vanish) return vanishResult(s);
    if (s.gob) return gobResult(s);
    const line = lineOf(s.board);
    if (line) return { winner: s.board[line[0]], cells: line };
    if (s.board.every((v) => v !== null)) return { winner: null, cells: [] };
    return null;
  },

  info(s) {
    if (s.gob) {
      if (s.won) return '';
      if (s.stuck) return '打てる手が無くなったので引き分け';
      if (s.n >= GOB_LIMIT) return `${GOB_LIMIT}手になったので引き分け`;
      const left = GOB_LIMIT - s.n;
      return '駒を選んでから、置くマスを押します。小さい駒にはかぶせられます' + (left <= 10 ? `・あと${left}手で引き分け` : '');
    }
    if (s.vanish) {
      if (vanishResult(s)) return '';
      const left = VANISH_LIMIT - s.n;
      return '印は3つまで（薄い印が次に消える）' + (left <= 10 ? `・あと${left}手で引き分け` : '');
    }
    if (!s.big || bigResult(s)) return '';
    return s.next === null ? 'どの盤にでも置けます' : '光っている盤に置きます';
  },

  render(root, s, o) {
    if (s.big) { renderBig(root, s, o); return; }
    if (s.wide) { renderWide(root, s, o); return; }
    if (s.gob) { renderGob(root, s, o); return; }
    const res = this.result(s);
    const fade = s.vanish && !res ? fading(s) : [];
    root.innerHTML = '';
    root.className = 'board ttt';
    s.board.forEach((v, i) => {
      const cell = cellButton(v, i, s, o, v === null && o.canMove);
      cell.classList.remove('last');
      if (fade.includes(i)) cell.classList.add('fade');
      if (res?.cells.includes(i)) cell.classList.add('win');
      root.append(cell);
    });
  },
};
