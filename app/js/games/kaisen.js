// 海戦ゲーム（バトルシップ）。2人。10×10 の自分の海に、5・4・3・3・2マスの船5隻をたてかよこに並べる（2026-10-05 本人承認）。
// 先手が並べ終えたら後手が並べ、そのあと交代で相手の海のマスを1つずつ撃つ。当たっても外れても次は相手の番（本人承認）。
// 詳細設定「当たったらもう一度」（2026-10-06 本人の決定。最初はなし）: 当たったら（沈めたときも）続けてもう1回撃てる。外れたら相手の番。
// 船のマスを全部撃たれたら、その船は沈む。相手の船を先に全部沈めた方の勝ち。
// 決まりごと（Claude の判断）: 船どうしは となり合ってもよい（重なるのはだめ）。どの船を沈めたかは相手にも知らせる。
// 相手の船は画面に出さないが、手札と同じ簡易の隠し方（全員の端末が全部の配置を知っている）。同じ画面の2人では隠せないので、オンラインだけ（noLocal）。
// マスの番号 = 段*10+列（段0が一番上）。
// 手: 並べる { t: 'place', ships: [[段, 列, たてか], …]（SHIPS の順） } / 撃つ = マスの番号

import { CPU_SETTING } from './util.js';

export const N = 10;
export const SHIPS = [5, 4, 3, 3, 2];
const SHIP_NAMES = ['5マスの船', '4マスの船', '3マスの船', '3マスの船', '2マスの船'];
const TOTAL = SHIPS.reduce((a, b) => a + b, 0);

// 並べ方 → 各マスの船の番号（-1 は海）。並べられなければ null
export function layout(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length) return null;
  const grid = Array(N * N).fill(-1);
  for (let k = 0; k < SHIPS.length; k++) {
    const x = ships[k];
    if (!Array.isArray(x) || x.length !== 3) return null;
    const [r, c, v] = x;
    if (!Number.isInteger(r) || !Number.isInteger(c) || typeof v !== 'boolean') return null;
    for (let j = 0; j < SHIPS[k]; j++) {
      const rr = r + (v ? j : 0);
      const cc = c + (v ? 0 : j);
      if (rr < 0 || rr >= N || cc < 0 || cc >= N || grid[rr * N + cc] !== -1) return null;
      grid[rr * N + cc] = k;
    }
  }
  return grid;
}

// おまかせの並べ方（CPU と「おまかせ」ボタン。ホストか自分の端末だけで動くので Math.random を使ってよい）
export function randomShips() {
  for (;;) {
    const ships = [];
    const grid = Array(N * N).fill(-1);
    let ok = true;
    for (let k = 0; k < SHIPS.length && ok; k++) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const v = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (v ? N - SHIPS[k] + 1 : N));
        const c = Math.floor(Math.random() * (v ? N : N - SHIPS[k] + 1));
        const cells = Array.from({ length: SHIPS[k] }, (_, j) => (r + (v ? j : 0)) * N + c + (v ? 0 : j));
        if (cells.every((i) => grid[i] === -1)) {
          cells.forEach((i) => { grid[i] = k; });
          ships.push([r, c, v]);
          placed = true;
        }
      }
      ok = placed;
    }
    if (ok) return ships;
  }
}

// p が撃った結果から、沈めた船の番号の一覧
const sunkList = (s, p) => SHIPS.map((_, k) => k).filter((k) => s.grid[1 - p].every((g, i) => g !== k || s.shots[p][i]));
const hitsOf = (s, p) => s.shots[p].filter((x, i) => x && s.grid[1 - p][i] >= 0).length;

/* ---------- CPU ---------- */

// 撃ったマスの結果だけを見て選ぶ（相手の船の位置はのぞかない）。
// よわい: 適当に撃ち、当たったあとは半分だけそのまわりを狙う。ふつう: 当たったらまわりを狙う。
// つよい: それに加えて、残っている船が入れるマスの数で狙いを決める（市松模様に近い撃ち方になる）
function kaisenCpu(s, p, rules) {
  const level = rules?.cpu === 'strong' ? 'strong' : rules?.cpu === 'normal' ? 'normal' : 'weak';
  const shot = s.shots[p];
  const opp = s.grid[1 - p];
  const sunk = new Set(sunkList(s, p));
  // 沈んでいない船に当たったマス（CPU が知っている情報: 当たったか・どの船が沈んだか）
  const open = [];
  for (let i = 0; i < N * N; i++) if (shot[i] && opp[i] >= 0 && !sunk.has(opp[i])) open.push(i);
  const free = (r, c) => r >= 0 && r < N && c >= 0 && c < N && !shot[r * N + c];
  const untried = Array.from({ length: N * N }, (_, i) => i).filter((i) => !shot[i]);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const target = () => {
    const cand = new Map();
    const add = (r, c, w) => { if (free(r, c)) cand.set(r * N + c, (cand.get(r * N + c) ?? 0) + w); };
    for (const i of open) {
      const r = Math.floor(i / N);
      const c = i % N;
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        add(r + dr, c + dc, 1);
        // 当たりが2つ並んでいたら、その向きの先を強く狙う
        if (open.includes((r - dr) * N + (c - dc)) && r - dr >= 0 && r - dr < N && c - dc >= 0 && c - dc < N) add(r + dr, c + dc, 4);
      }
    }
    if (!cand.size) return null;
    const best = Math.max(...cand.values());
    return pick([...cand].filter(([, w]) => w === best).map(([i]) => i));
  };

  if (open.length && (level !== 'weak' || Math.random() < 0.5)) {
    const t = target();
    if (t !== null) return t;
  }
  if (level !== 'strong') return pick(untried);
  // つよい: 残っている船が置ける並び方の数が多いマスを撃つ
  const left = SHIPS.filter((_, k) => !sunk.has(k));
  const score = Array(N * N).fill(0);
  for (const len of left) {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (const v of [false, true]) {
          const cells = Array.from({ length: len }, (_, j) => (r + (v ? j : 0)) * N + c + (v ? 0 : j));
          if (v ? r + len > N : c + len > N) continue;
          if (cells.some((i) => shot[i])) continue;
          for (const i of cells) score[i] += 1;
        }
      }
    }
  }
  const best = Math.max(...untried.map((i) => score[i]));
  return pick(untried.filter((i) => score[i] === best));
}

/* ---------- 画面 ---------- */

let plc = { key: null, ships: [], sel: 0, vert: false }; // 並べている途中（描き直しで消えないよう外に持つ）

const game = {
  id: 'kaisen',
  name: '海戦ゲーム',
  icon: '🚢',
  desc: '自分の海に船を隠して並べ、交代で相手の海を撃つ。相手の船を先に全部沈めた方の勝ち',
  ready: true,
  noLocal: true,
  noUndo: true, // オンラインの「待った」は付けない（外れたマスを知ったまま撃ち直せてしまうため。2026-10-06 本人の決定）
  players: ['先手', '後手'],
  settings: [
    CPU_SETTING,
    { key: 'again', label: '当たったらもう一度', desc: '当たったら（沈めたときも）続けてもう1回撃てる。外れたら相手の番', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init({ rules = {} } = {}) {
    return { again: rules.again === 'on', phase: 'place', turn: 0, grid: [null, null], shots: [Array(N * N).fill(false), Array(N * N).fill(false)], last: null, won: null, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.won !== null) return null;
    if (s.phase === 'place') {
      if (!m || m.t !== 'place') return null;
      const grid = layout(m.ships);
      if (!grid) return null;
      const g = s.grid.slice();
      g[s.turn] = grid;
      const t = { ...s, grid: g, count: s.count + 1, last: { p: s.turn, placed: true } };
      if (s.turn === 0) t.turn = 1;
      else { t.phase = 'fire'; t.turn = 0; }
      return t;
    }
    if (!Number.isInteger(m) || m < 0 || m >= N * N) return null;
    const p = s.turn;
    if (s.shots[p][m]) return null;
    const shots = s.shots.slice();
    shots[p] = shots[p].slice();
    shots[p][m] = true;
    const k = s.grid[1 - p][m];
    const t = { ...s, shots, turn: s.again && k >= 0 ? p : 1 - p, count: s.count + 1 };
    const before = sunkList(s, p);
    const after = k >= 0 ? sunkList(t, p) : before;
    t.last = { p, cell: m, hit: k >= 0, sunk: after.length > before.length ? k : null };
    if (hitsOf(t, p) === TOTAL) t.won = p;
    return t;
  },

  result(s) {
    if (s.won === null) return null;
    return { winner: s.won, cells: [] };
  },

  cpu(s, p, rules) {
    if (s.phase === 'place') return { t: 'place', ships: randomShips() };
    return kaisenCpu(s, p, rules);
  },

  sound(a, b) {
    const l = b.last;
    if (!l || l.placed) return 'place';
    return l.sunk !== null ? 'punch' : l.hit ? 'hit' : 'pop';
  },

  info(s) {
    const l = s.last;
    if (!l || l.placed || s.won !== null) return '';
    const who = `<b class="pl p${l.p}">${game.players[l.p]}</b>`;
    const more = s.again && l.hit ? '（もう一度撃てる）' : '';
    if (l.sunk !== null) return `${who}が${SHIP_NAMES[l.sunk]}を沈めた！${more}`;
    return `${who}の弾は${l.hit ? '<b>命中！</b>' : 'はずれ'}${more}`;
  },

  render(root, s, o) {
    const me = Number.isInteger(o.me) && o.me >= 0 ? o.me : null; // 観戦（-1）と同じ画面（null）はどちらの船も見せない
    root.innerHTML = '';
    root.className = 'board ks';
    const over = s.won !== null;

    if (s.phase === 'place') {
      if (o.canMove && me !== null) { renderPlace(root, s, o); return; }
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = me === s.turn ? '' : `${game.players[s.turn]}が船を並べています…`;
      root.append(p);
      if (me !== null && s.grid[me]) root.append(sea(s, me, { title: 'あなたの海', showShips: true }));
      return;
    }

    const status = document.createElement('p');
    status.className = 'cc-log';
    if (me !== null) {
      const left = (p) => SHIPS.length - sunkList(s, p).length;
      status.textContent = `残りの船: あなた ${left(1 - me)}隻 ／ 相手 ${left(me)}隻`;
    }
    root.append(status);

    if (me === null) {
      // 観戦: 両方の海の撃たれたあとだけ（終わったら船も）
      root.append(sea(s, 1, { title: `${game.players[1]}の海（${game.players[0]}が撃つ）`, showShips: over, small: true }));
      root.append(sea(s, 0, { title: `${game.players[0]}の海（${game.players[1]}が撃つ）`, showShips: over, small: true }));
      return;
    }
    root.append(sea(s, 1 - me, { title: o.canMove ? '相手の海 — 撃つマスを選ぶ' : '相手の海', showShips: over, onShoot: o.canMove ? (i) => o.onMove(i) : null }));
    root.append(sea(s, me, { title: 'あなたの海', showShips: true, small: true }));
  },
};

// 海の盤。owner の海に、相手（1 - owner）が撃ったあとを出す
function sea(s, owner, { title, showShips, onShoot = null, small = false }) {
  const box = document.createElement('div');
  box.className = 'ks-sea' + (small ? ' small' : '');
  const head = document.createElement('div');
  head.className = 'ks-title';
  head.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'ks-grid';
  const shooter = 1 - owner;
  const ships = s.grid[owner];
  const sunk = ships ? new Set(sunkList(s, shooter)) : new Set();
  for (let i = 0; i < N * N; i++) {
    const shot = s.shots[shooter][i];
    const k = ships ? ships[i] : -1;
    const can = onShoot && !shot;
    const cell = document.createElement(can ? 'button' : 'div');
    let cls = 'ks-cell';
    if (k >= 0 && (showShips || sunk.has(k))) cls += ' ship' + (sunk.has(k) ? ' sunk' : '');
    if (shot) cls += k >= 0 ? ' hit' : ' miss';
    if (s.last && !s.last.placed && s.last.cell === i && s.last.p === shooter) cls += ' last';
    if (can) {
      cell.type = 'button';
      cls += ' playable';
      cell.onclick = () => onShoot(i);
      cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${(i % N) + 1}列目`);
    }
    cell.className = cls;
    grid.append(cell);
  }
  box.append(head, grid);
  return box;
}

// 船を並べる画面
function renderPlace(root, s, o) {
  const key = `${s.count}:${s.turn}`;
  if (plc.key !== key) plc = { key, ships: SHIPS.map(() => null), sel: 0, vert: false };
  const draw = () => game.render(root, s, o);
  const all = () => (plc.ships.every(Boolean) ? plc.ships : null);
  const occupied = () => {
    const g = Array(N * N).fill(-1);
    plc.ships.forEach((x, k) => {
      if (!x) return;
      for (let j = 0; j < SHIPS[k]; j++) g[(x[0] + (x[2] ? j : 0)) * N + x[1] + (x[2] ? 0 : j)] = k;
    });
    return g;
  };
  const occ = occupied();

  const head = document.createElement('p');
  head.className = 'cc-log';
  head.textContent = plc.sel === null ? '全部並べました。よければ「これで決める」' : `${SHIP_NAMES[plc.sel]}を置くマス（左上のはし）を選ぶ。置いた船を押すと持ち上げます`;
  root.append(head);

  const list = document.createElement('div');
  list.className = 'ks-ships';
  SHIPS.forEach((len, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ks-ship' + (plc.sel === k ? ' on' : '') + (plc.ships[k] ? ' done' : '');
    b.innerHTML = '<i></i>'.repeat(len);
    b.setAttribute('aria-label', SHIP_NAMES[k]);
    b.onclick = () => { plc.ships[k] = null; plc.sel = k; draw(); };
    list.append(b);
  });
  root.append(list);

  const grid = document.createElement('div');
  grid.className = 'ks-grid place';
  for (let i = 0; i < N * N; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ks-cell playable' + (occ[i] >= 0 ? ' ship' + (occ[i] === plc.sel ? ' on' : '') : '');
    b.onclick = () => {
      if (occ[i] >= 0) { const k = occ[i]; plc.ships[k] = null; plc.sel = k; draw(); return; }
      if (plc.sel === null) return;
      const trial = plc.ships.slice();
      trial[plc.sel] = [Math.floor(i / N), i % N, plc.vert];
      // ほかの船と重ならず盤に収まるか（まだ置いていない船は確かめない）
      const g = Array(N * N).fill(-1);
      let ok = true;
      trial.forEach((x, k) => {
        if (!x || !ok) return;
        for (let j = 0; j < SHIPS[k]; j++) {
          const r = x[0] + (x[2] ? j : 0);
          const c = x[1] + (x[2] ? 0 : j);
          if (r >= N || c >= N || g[r * N + c] !== -1) { ok = false; return; }
          g[r * N + c] = k;
        }
      });
      if (!ok) return;
      plc.ships = trial;
      const next = plc.ships.findIndex((x) => !x);
      plc.sel = next < 0 ? null : next;
      draw();
    };
    grid.append(b);
  }
  root.append(grid);

  const acts = document.createElement('div');
  acts.className = 'cc-actions ks-acts';
  const btn = (text, cls, fn, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small ' + cls;
    b.textContent = text;
    b.disabled = disabled;
    b.onclick = fn;
    acts.append(b);
  };
  btn(plc.vert ? '向き: たて ↕' : '向き: よこ ↔', 'secondary', () => { plc.vert = !plc.vert; draw(); });
  btn('おまかせ', 'secondary', () => { plc.ships = randomShips(); plc.sel = null; draw(); });
  btn('やり直す', 'ghost', () => { plc.ships = SHIPS.map(() => null); plc.sel = 0; draw(); });
  btn('これで決める', 'primary', () => { if (all()) o.onMove({ t: 'place', ships: all() }); }, !all());
  root.append(acts);
}

export default game;
