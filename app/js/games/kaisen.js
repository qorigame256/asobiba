// 海戦ゲーム（バトルシップ）。2人。10×10 の自分の海に、5・4・3・3・2マスの船5隻をたてかよこに並べる（2026-10-05 本人承認）。
// 先手が並べ終えたら後手が並べ、そのあと交代で相手の海のマスを1つずつ撃つ。当たっても外れても次は相手の番（本人承認）。
// 詳細設定「当たったらもう一度」（2026-10-06 本人の決定。最初はなし）: 当たったら（沈めたときも）続けてもう1回撃てる。外れたら相手の番。
// 詳細設定「ソナー」（2026-10-06 本人の決定。最初はなし）: 撃つ代わりに1回だけ、相手の海の 3×3（盤の端では欠ける）を調べて、
//   まだ撃っていないマスのうち船のマスがいくつあるかが分かる（Claude の判断: 数まで出す・使ったら相手の番・相手にも場所と数が見える）。
// 船のマスを全部撃たれたら、その船は沈む。相手の船を先に全部沈めた方の勝ち。
// 決まりごと（Claude の判断）: 船どうしは となり合ってもよい（重なるのはだめ。下の「船をくっつけない」で禁止にできる）。どの船を沈めたかは相手にも知らせる。
// 相手の船は画面に出さないが、手札と同じ簡易の隠し方（全員の端末が全部の配置を知っている）。同じ画面の2人では隠せないので、オンラインだけ（noLocal）。
// 詳細設定「海の広さ」（2026-10-06 の8回目）: 10×10（最初。船 5・4・3・3・2）か 8×8（船 4・3・3・2）。一辺は局面の size に持つ。
//   ソナー（3×3）・当たったらもう一度・CPU の考え方は、どちらの広さでも同じ（Claude の判断）。
// 詳細設定「船をくっつけない」（2026-10-07 の12回目。最初はなし）: 船どうしを上下左右・ななめのどれでもとなりに置けない（1マス以上あける）。
//   局面の apart。並べる手がこれに反していたら反則。おまかせ・CPU の並べ方も守る。CPU は、沈めた船のまわりなど船がないと分かるマスを撃たない（Claude の判断）。
//   なしのときは前と全く同じ（おまかせの乱数の使い方も同じ）。
// マスの番号 = 段*一辺+列（段0が一番上。10×10 なら 段*10+列 で、前と同じ）。
// 手: 並べる { t: 'place', ships: [[段, 列, たてか], …]（FLEETS のその広さの船の順） } / 撃つ = マスの番号 / ソナー { t: 'sonar', c: 真ん中のマスの番号 }

import { CPU_SETTING } from './util.js';

export const N = 10; // 最初の一辺
export const SHIPS = [5, 4, 3, 3, 2]; // 10×10 の船
export const FLEETS = { 10: SHIPS, 8: [4, 3, 3, 2] }; // 一辺 → 船の長さの一覧
export const fleetOf = (n) => FLEETS[n] ?? SHIPS;
const sizeOf = (s) => s.size ?? N;
const shipName = (len) => `${len}マスの船`;

// まわり8マス（盤の外は除く）。n は一辺
function around(i, n) {
  const r0 = Math.floor(i / n);
  const c0 = i % n;
  const out = [];
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let c = c0 - 1; c <= c0 + 1; c++) if ((r !== r0 || c !== c0) && r >= 0 && r < n && c >= 0 && c < n) out.push(r * n + c);
  return out;
}
// 別の船どうしが（ななめも含めて）となり合っているか。grid は各マスの船の番号（-1 は海）
const touching = (grid, n) => grid.some((k, i) => k >= 0 && around(i, n).some((j) => grid[j] >= 0 && grid[j] !== k));

// 並べ方 → 各マスの船の番号（-1 は海）。並べられなければ null。n は一辺。apart は「船をくっつけない」
export function layout(ships, n = N, apart = false) {
  const SHIPS = fleetOf(n);
  const N = n;
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
  if (apart && touching(grid, N)) return null;
  return grid;
}

// おまかせの並べ方（CPU と「おまかせ」ボタン。ホストか自分の端末だけで動くので Math.random を使ってよい）
// apart（船をくっつけない）のときは、まわり8マスにほかの船が無い所にだけ置く（なしのときは前と全く同じ）
export function randomShips(n = N, apart = false) {
  const SHIPS = fleetOf(n);
  const N = n;
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
        if (cells.every((i) => grid[i] === -1 && (!apart || around(i, N).every((j) => grid[j] === -1)))) {
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

// マス c を真ん中にした 3×3（盤の外は除く）。n は一辺
export function sonarArea(c, n = N) {
  const N = n;
  const r0 = Math.floor(c / N);
  const c0 = c % N;
  const out = [];
  for (let r = r0 - 1; r <= r0 + 1; r++) for (let k = c0 - 1; k <= c0 + 1; k++) if (r >= 0 && r < N && k >= 0 && k < N) out.push(r * N + k);
  return out;
}

// p が撃った結果から、沈めた船の番号の一覧
const sunkList = (s, p) => fleetOf(sizeOf(s)).map((_, k) => k).filter((k) => s.grid[1 - p].every((g, i) => g !== k || s.shots[p][i]));
const hitsOf = (s, p) => s.shots[p].filter((x, i) => x && s.grid[1 - p][i] >= 0).length;

/* ---------- CPU ---------- */

// 船をくっつけないときに、船がないと分かるマスも true にした「撃ったマス」の写し（CPU が見てよい情報だけを使う）:
// 沈めた船のまわり8マス・沈んでいない船の当たりのななめ・当たりが2つ並んでいたらその横（船はまっすぐなので）
function noShipCells(shot, opp, sunk, N) {
  const out = shot.slice();
  const hit = (i) => shot[i] && opp[i] >= 0;
  for (let i = 0; i < N * N; i++) {
    if (!hit(i)) continue;
    const r = Math.floor(i / N);
    const c = i % N;
    if (sunk.has(opp[i])) { for (const j of around(i, N)) if (!hit(j)) out[j] = true; continue; }
    for (const j of around(i, N)) if (Math.floor(j / N) !== r && j % N !== c) out[j] = true; // ななめ
    const side = (rr, cc) => rr >= 0 && rr < N && cc >= 0 && cc < N && hit(rr * N + cc);
    if (side(r, c - 1) || side(r, c + 1)) { if (r > 0) out[i - N] = true; if (r < N - 1) out[i + N] = true; } // よこに並ぶ → 上下は海
    if (side(r - 1, c) || side(r + 1, c)) { if (c > 0) out[i - 1] = true; if (c < N - 1) out[i + 1] = true; } // たてに並ぶ → 左右は海
  }
  return out;
}

// 撃ったマスの結果だけを見て選ぶ（相手の船の位置はのぞかない）。
// よわい: 適当に撃ち、当たったあとは半分だけそのまわりを狙う。ふつう: 当たったらまわりを狙う。
// つよい: それに加えて、残っている船が入れるマスの数で狙いを決める（市松模様に近い撃ち方になる）
function kaisenCpu(s, p, rules) {
  const level = rules?.cpu === 'strong' ? 'strong' : rules?.cpu === 'normal' ? 'normal' : 'weak';
  const N = sizeOf(s);
  const SHIPS = fleetOf(N);
  const opp = s.grid[1 - p];
  const sunk = new Set(sunkList(s, p));
  // 船をくっつけない: 船がないと分かるマスは、撃ったマスと同じに扱う（撃たない）
  const shot = s.apart ? noShipCells(s.shots[p], opp, sunk, N) : s.shots[p];
  // 沈んでいない船に当たったマス（CPU が知っている情報: 当たったか・どの船が沈んだか）
  const open = [];
  for (let i = 0; i < N * N; i++) if (s.shots[p][i] && opp[i] >= 0 && !sunk.has(opp[i])) open.push(i);
  const free = (r, c) => r >= 0 && r < N && c >= 0 && c < N && !shot[r * N + c];
  let untried = Array.from({ length: N * N }, (_, i) => i).filter((i) => !shot[i]);
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
  // 残っている船が置ける並び方の数（つよいが使う。ソナーの場所選びにも使う）
  const scoreMap = () => {
    const left = SHIPS.filter((_, k) => !sunk.has(k));
    const score = Array(N * N).fill(0);
    for (const len of left) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          for (const v of [false, true]) {
            if (v ? r + len > N : c + len > N) continue;
            const cells = Array.from({ length: len }, (_, j) => (r + (v ? j : 0)) * N + c + (v ? 0 : j));
            if (cells.some((i) => shot[i])) continue;
            for (const i of cells) score[i] += 1;
          }
        }
      }
    }
    return score;
  };
  // ソナー: 当たりを追っていないときに使う（6発撃ったあと。よわいは毎回3割の見込みで）。
  // 場所は よわい 適当・ふつう まだ撃っていないマスが多い所・つよい 船が入れる見込みが大きい所。どれも盤の端に寄らない
  const shots = s.shots[p].filter(Boolean).length; // 実際に撃った数（船がないと分かるマスは数えない）
  if (s.sonarOn && !s.sonar[p] && shots >= 6 && (level !== 'weak' || Math.random() < 0.3)) {
    const centers = [];
    for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) centers.push(r * N + c);
    if (level === 'weak') return { t: 'sonar', c: pick(centers) };
    const sc = level === 'strong' ? scoreMap() : null;
    const val = (c) => sonarArea(c, N).reduce((a, i) => a + (shot[i] ? 0 : sc ? sc[i] : 1), 0);
    const top = Math.max(...centers.map(val));
    return { t: 'sonar', c: pick(centers.filter((c) => val(c) === top)) };
  }
  // ソナーの結果を使う: まだ見つけていない船のマスが残っていればその中を撃ち、残っていなければその中は撃たない
  const sn = s.sonar?.[p];
  if (sn) {
    const zone = sn.cells.filter((i) => !shot[i]);
    const rest = sn.n - sn.cells.filter((i) => shot[i] && opp[i] >= 0).length;
    if (rest > 0 && zone.length) untried = zone;
    else if (zone.length && zone.length < untried.length) untried = untried.filter((i) => !zone.includes(i));
  }
  if (level !== 'strong') return pick(untried);
  // つよい: 残っている船が置ける並び方の数が多いマスを撃つ
  const score = scoreMap();
  const best = Math.max(...untried.map((i) => score[i]));
  return pick(untried.filter((i) => score[i] === best));
}

/* ---------- 画面 ---------- */

let plc = { key: null, ships: [], sel: 0, vert: false }; // 並べている途中（描き直しで消えないよう外に持つ）
let sonarMode = null; // ソナーで調べる所を選んでいる途中なら「手の数:自分の番号」（描き直しで消えないよう外に持つ）

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
    { key: 'sonar', label: 'ソナー', desc: '撃つ代わりに1回だけ、相手の海の 3×3 に船のマスがいくつあるか調べられる（使ったら相手の番）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'again', label: '当たったらもう一度', desc: '当たったら（沈めたときも）続けてもう1回撃てる。外れたら相手の番', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'size', label: '海の広さ', desc: '8×8 は船が4隻（4・3・3・2マス）で、早く終わる', def: 10, choices: [[10, '10×10（船5隻）'], [8, '8×8（船4隻）']] },
    { key: 'apart', label: '船をくっつけない', desc: '船どうしを、ななめも含めてとなりに置けない（よくある決まり）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init({ rules = {} } = {}) {
    const n = Number(rules.size) === 8 ? 8 : N;
    return { size: n, again: rules.again === 'on', apart: rules.apart === 'on', sonarOn: rules.sonar === 'on', sonar: [null, null], phase: 'place', turn: 0, grid: [null, null], shots: [Array(n * n).fill(false), Array(n * n).fill(false)], last: null, won: null, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.won !== null) return null;
    const N = sizeOf(s);
    if (s.phase === 'place') {
      if (!m || m.t !== 'place') return null;
      const grid = layout(m.ships, N, !!s.apart);
      if (!grid) return null;
      const g = s.grid.slice();
      g[s.turn] = grid;
      const t = { ...s, grid: g, count: s.count + 1, last: { p: s.turn, placed: true } };
      if (s.turn === 0) t.turn = 1;
      else { t.phase = 'fire'; t.turn = 0; }
      return t;
    }
    const p = s.turn;
    if (m && m.t === 'sonar') {
      if (!s.sonarOn || s.sonar?.[p] || !Number.isInteger(m.c) || m.c < 0 || m.c >= N * N) return null;
      const cells = sonarArea(m.c, N).filter((i) => !s.shots[p][i]);
      const n = cells.filter((i) => s.grid[1 - p][i] >= 0).length;
      const sonar = s.sonar.slice();
      sonar[p] = { c: m.c, n, cells };
      return { ...s, sonar, turn: 1 - p, count: s.count + 1, last: { p, sonar: m.c, n } };
    }
    if (!Number.isInteger(m) || m < 0 || m >= N * N) return null;
    if (s.shots[p][m]) return null;
    const shots = s.shots.slice();
    shots[p] = shots[p].slice();
    shots[p][m] = true;
    const k = s.grid[1 - p][m];
    const t = { ...s, shots, turn: s.again && k >= 0 ? p : 1 - p, count: s.count + 1 };
    const before = sunkList(s, p);
    const after = k >= 0 ? sunkList(t, p) : before;
    t.last = { p, cell: m, hit: k >= 0, sunk: after.length > before.length ? k : null };
    if (hitsOf(t, p) === fleetOf(N).reduce((a, b) => a + b, 0)) t.won = p;
    return t;
  },

  result(s) {
    if (s.won === null) return null;
    return { winner: s.won, cells: [] };
  },

  cpu(s, p, rules) {
    if (s.phase === 'place') return { t: 'place', ships: randomShips(sizeOf(s), !!s.apart) };
    return kaisenCpu(s, p, rules);
  },

  sound(a, b) {
    const l = b.last;
    if (!l || l.placed) return 'place';
    if (l.sonar !== undefined) return 'question';
    return l.sunk !== null ? 'punch' : l.hit ? 'hit' : 'pop';
  },

  info(s) {
    const l = s.last;
    if (!l || l.placed || s.won !== null) return '';
    const who = `<b class="pl p${l.p}">${game.players[l.p]}</b>`;
    if (l.sonar !== undefined) return `${who}がソナーを使った: まだ撃っていないマスのうち、船のマスが<b>${l.n}つ</b>`;
    const more = s.again && l.hit ? '（もう一度撃てる）' : '';
    if (l.sunk !== null) return `${who}が${shipName(fleetOf(sizeOf(s))[l.sunk])}を沈めた！${more}`;
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
      const left = (p) => fleetOf(sizeOf(s)).length - sunkList(s, p).length;
      status.textContent = `残りの船: あなた ${left(1 - me)}隻 ／ 相手 ${left(me)}隻`;
    }
    root.append(status);

    if (me === null) {
      // 観戦: 両方の海の撃たれたあとだけ（終わったら船も）
      root.append(sea(s, 1, { title: `${game.players[1]}の海（${game.players[0]}が撃つ）`, showShips: over, small: true }));
      root.append(sea(s, 0, { title: `${game.players[0]}の海（${game.players[1]}が撃つ）`, showShips: over, small: true }));
      return;
    }
    const canSonar = o.canMove && s.sonarOn && !s.sonar[me];
    const aiming = canSonar && sonarMode === `${s.count}:${me}`;
    const title = aiming ? '相手の海 — ソナーで調べる所（3×3の真ん中）を選ぶ' : o.canMove ? '相手の海 — 撃つマスを選ぶ' : '相手の海';
    const shoot = aiming ? (i) => { sonarMode = null; o.onMove({ t: 'sonar', c: i }); } : o.canMove ? (i) => o.onMove(i) : null;
    root.append(sea(s, 1 - me, { title, showShips: over, onShoot: shoot, aiming }));
    if (canSonar) {
      const acts = document.createElement('div');
      acts.className = 'cc-actions ks-acts';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small ' + (aiming ? 'ghost' : 'secondary');
      b.textContent = aiming ? 'ソナーをやめて撃つ' : '📡 ソナーを使う（1回だけ）';
      b.onclick = () => { sonarMode = aiming ? null : `${s.count}:${me}`; game.render(root, s, o); };
      acts.append(b);
      root.append(acts);
    }
    root.append(sea(s, me, { title: 'あなたの海', showShips: true, small: true }));
  },
};

// 海の盤。owner の海に、相手（1 - owner）が撃ったあとを出す
function sea(s, owner, { title, showShips, onShoot = null, small = false, aiming = false }) {
  const box = document.createElement('div');
  box.className = 'ks-sea' + (small ? ' small' : '');
  const head = document.createElement('div');
  head.className = 'ks-title';
  head.textContent = title;
  const N = sizeOf(s);
  const grid = document.createElement('div');
  grid.className = 'ks-grid';
  grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`; // 見た目の列の数は style.css では10の決め打ちなので、ここで一辺に合わせる
  const shooter = 1 - owner;
  const ships = s.grid[owner];
  const sunk = ships ? new Set(sunkList(s, shooter)) : new Set();
  const sn = s.sonar?.[shooter] ?? null; // この海を調べたソナー
  const zone = sn ? new Set(sonarArea(sn.c, N)) : null;
  for (let i = 0; i < N * N; i++) {
    const shot = s.shots[shooter][i];
    const k = ships ? ships[i] : -1;
    const can = onShoot && (aiming || !shot);
    const cell = document.createElement(can ? 'button' : 'div');
    let cls = 'ks-cell';
    if (k >= 0 && (showShips || sunk.has(k))) cls += ' ship' + (sunk.has(k) ? ' sunk' : '');
    if (shot) cls += k >= 0 ? ' hit' : ' miss';
    if (s.last && !s.last.placed && (s.last.cell === i || s.last.sonar === i) && s.last.p === shooter) cls += ' last';
    if (zone?.has(i)) cls += ' sonar';
    if (can) {
      cell.type = 'button';
      cls += ' playable';
      cell.onclick = () => onShoot(i);
      cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${(i % N) + 1}列目`);
    }
    if (sn && sn.c === i) {
      const b = document.createElement('span');
      b.className = 'ks-sonar-n';
      b.textContent = sn.n;
      b.title = `ソナー: 船のマスが${sn.n}つ`;
      cell.append(b);
    }
    cell.className = cls;
    grid.append(cell);
  }
  if (aiming) grid.classList.add('aiming');
  box.append(head, grid);
  return box;
}

// 船を並べる画面
function renderPlace(root, s, o) {
  const N = sizeOf(s);
  const SHIPS = fleetOf(N);
  const key = `${N}:${s.count}:${s.turn}`; // 一辺も入れる（海の広さを変えた次の対局で、前の途中の並べ方を使わないように）
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
  head.textContent = plc.sel === null ? '全部並べました。よければ「これで決める」' : `${shipName(SHIPS[plc.sel])}を置くマス（左上のはし）を選ぶ。置いた船を押すと持ち上げます${s.apart ? '（船どうしは、ななめも含めてとなりに置けません）' : ''}`;
  root.append(head);

  const list = document.createElement('div');
  list.className = 'ks-ships';
  SHIPS.forEach((len, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ks-ship' + (plc.sel === k ? ' on' : '') + (plc.ships[k] ? ' done' : '');
    b.innerHTML = '<i></i>'.repeat(len);
    b.setAttribute('aria-label', shipName(len));
    b.onclick = () => { plc.ships[k] = null; plc.sel = k; draw(); };
    list.append(b);
  });
  root.append(list);

  const grid = document.createElement('div');
  grid.className = 'ks-grid place';
  grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  for (let i = 0; i < N * N; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ks-cell playable' + (occ[i] >= 0 ? ' ship' + (occ[i] === plc.sel ? ' on' : '') : '');
    b.onclick = () => {
      if (occ[i] >= 0) { const k = occ[i]; plc.ships[k] = null; plc.sel = k; draw(); return; }
      if (plc.sel === null) return;
      const trial = plc.ships.slice();
      trial[plc.sel] = [Math.floor(i / N), i % N, plc.vert];
      // ほかの船と重ならず盤に収まるか（船をくっつけないときは、となり合わないかも。まだ置いていない船は確かめない）
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
      if (!ok || (s.apart && touching(g, N))) return;
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
  btn('おまかせ', 'secondary', () => { plc.ships = randomShips(N, !!s.apart); plc.sel = null; draw(); });
  btn('やり直す', 'ghost', () => { plc.ships = SHIPS.map(() => null); plc.sel = 0; draw(); });
  btn('これで決める', 'primary', () => { if (all()) o.onMove({ t: 'place', ships: all() }); }, !all());
  root.append(acts);
}

export default game;
