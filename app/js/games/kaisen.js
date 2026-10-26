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
// 詳細設定「サルボ」（2026-10-07 の15回目。最初はなし）: 1回の番で、自分のまだ沈んでいない船の数（最初は 10×10 で5発・8×8 で4発）だけ
//   マスを選んで一度に撃つ。結果は全部撃ってから一度に出る。決まりごと（Claude の判断）: ありのときは「当たったらもう一度」は効かない（局面の again を false にする）・
//   まだ撃っていないマスが船の数より少なければ、その数だけ撃つ（salvoCount）・ソナーは「その番に撃つ代わり」のまま・
//   選んでいる途中のマスはこの端末だけで覚える（salvoSel。手の一覧に入れない）。
// マスの番号 = 段*一辺+列（段0が一番上。10×10 なら 段*10+列 で、前と同じ）。
// 手: 並べる { t: 'place', ships: [[段, 列, たてか], …]（FLEETS のその広さの船の順） } / 撃つ = マスの番号 / ソナー { t: 'sonar', c: 真ん中のマスの番号 }
//   / サルボ { t: 'salvo', cells: [マスの番号, …], n: 何手目か（局面の count） }。n があるので、同じ手が2回届いても2回目は反則になる。

// 詳細設定「人数」（2026-10-26 本人の依頼。key は players）: 2人（最初）・3人。3人では、1回撃つと残っている2人の海の同じマスに同時に当たる（本人の選択）。
//   作り（Claude の判断）: 3人のときだけ局面に np: 3 と out（脱落したか）・outAt（何手目で脱落したか）を持ち、2人の局面は前と全く同じ形。
//   並べる順は 0 → 1 → 2、撃つ番は脱落していない人を順に回る。shots[p] は「p がそのマスを撃ったか」で、残っている相手みんなの海に効く。
//   ある人の海のマスは、ほかのだれかが撃っていれば撃たれたと見る（だれの弾でも当たり・沈むは同じ）。船を全部沈められた人は脱落し、最後に残った人の勝ち。
//   1発で2人とも脱落させたら撃った人の勝ち（2人は同じ順位）。ソナー・当たったらもう一度・サルボは3人では使わない（盤が2つあって分かりにくいため）。
//   CPU は、当たりを追っている相手（いなければくじ）を1人決め、その人の海で2人のときと同じ考え方で選ぶ（ほかの人が撃ったあとも見る）。
//   手は2人のときと同じ（並べる { t: 'place', ships } / 撃つ = マスの番号）。

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

// サルボで p がこの番に撃つ数: p のまだ沈んでいない船の数（まだ撃っていないマスがそれより少なければ、その数）
export function salvoCount(s, p) {
  const left = fleetOf(sizeOf(s)).length - sunkList(s, 1 - p).length;
  return Math.min(left, s.shots[p].filter((x) => !x).length);
}

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
// pending（サルボで、この番にもう選んだマスの Set）: 撃ったマスと同じに扱って選ばない。当たったかどうかはまだ分からないので、当たりとしては見ない
function kaisenCpu(s, p, rules, pending = null) {
  const level = rules?.cpu === 'strong' ? 'strong' : rules?.cpu === 'normal' ? 'normal' : 'weak';
  const N = sizeOf(s);
  const SHIPS = fleetOf(N);
  const opp = s.grid[1 - p];
  const sunk = new Set(sunkList(s, p));
  // 船をくっつけない: 船がないと分かるマスは、撃ったマスと同じに扱う（撃たない）
  let shot = s.apart ? noShipCells(s.shots[p], opp, sunk, N) : s.shots[p];
  if (pending?.size) { shot = shot.slice(); for (const i of pending) shot[i] = true; }
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
  if (s.sonarOn && !s.sonar[p] && !pending?.size && shots >= 6 && (level !== 'weak' || Math.random() < 0.3)) {
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
    const rest = sn.n - sn.cells.filter((i) => s.shots[p][i] && opp[i] >= 0).length; // 実際に撃ったマスだけ（pending の当たり外れは見ない）
    if (rest > 0 && zone.length) untried = zone;
    else if (zone.length && zone.length < untried.length) untried = untried.filter((i) => !zone.includes(i));
  }
  if (!untried.length) return null; // サルボで選べるマスが残っていない（下の salvoCpu が残りから選ぶ）
  if (level !== 'strong') return pick(untried);
  // つよい: 残っている船が置ける並び方の数が多いマスを撃つ
  const score = scoreMap();
  const best = Math.max(...untried.map((i) => score[i]));
  return pick(untried.filter((i) => score[i] === best));
}

// サルボの CPU: 撃つ数だけ、いつもの考え方で1マスずつ選ぶ（選んだマスは結果が分からないまま、もう選ばない）。
// 1つ目でソナーを選んだら、その番はソナーだけ
function salvoCpu(s, p, rules) {
  const want = salvoCount(s, p);
  const pending = new Set();
  while (pending.size < want) {
    let c = kaisenCpu(s, p, rules, pending);
    if (c && c.t === 'sonar') return c;
    if (!Number.isInteger(c) || pending.has(c) || s.shots[p][c]) {
      // 船がないと分かるマスしか残っていないときなど: まだ撃っていないマスから適当に
      const rest = s.shots[p].map((x, i) => i).filter((i) => !s.shots[p][i] && !pending.has(i));
      c = rest[Math.floor(Math.random() * rest.length)];
    }
    pending.add(c);
  }
  return { t: 'salvo', cells: [...pending], n: s.count };
}

/* ---------- 3人（np: 3） ---------- */

const np = (s) => s.np ?? 2;
const aliveList = (s) => Array.from({ length: np(s) }, (_, q) => q).filter((q) => !s.out?.[q]);
// q の海のマス i を、q 以外のだれかが撃ったか
const shotOn = (s, q, i) => s.shots.some((sh, r) => r !== q && sh[i]);
// q の沈んだ船の番号（だれの弾でも）
const sunk3 = (s, q) => fleetOf(sizeOf(s)).map((_, k) => k).filter((k) => s.grid[q].every((g, i) => g !== k || shotOn(s, q, i)));
const nextAlive = (s, p) => { for (let k = 1; k <= np(s); k++) { const q = (p + k) % np(s); if (!s.out[q]) return q; } return p; };

function apply3(s, m) {
  const N = sizeOf(s);
  if (s.phase === 'place') {
    if (!m || m.t !== 'place') return null;
    const grid = layout(m.ships, N, !!s.apart);
    if (!grid) return null;
    const g = s.grid.slice();
    g[s.turn] = grid;
    const t = { ...s, grid: g, count: s.count + 1, last: { p: s.turn, placed: true } };
    if (s.turn < np(s) - 1) t.turn = s.turn + 1;
    else { t.phase = 'fire'; t.turn = 0; }
    return t;
  }
  const p = s.turn;
  if (!Number.isInteger(m) || m < 0 || m >= N * N || s.shots[p][m]) return null;
  const shots = s.shots.slice();
  shots[p] = shots[p].slice();
  shots[p][m] = true;
  const t = { ...s, shots, out: s.out.slice(), outAt: s.outAt.slice(), count: s.count + 1 };
  const hits = [];
  const sunks = [];
  const outs = [];
  for (const q of aliveList(s)) {
    if (q === p) continue;
    if (s.grid[q][m] < 0) continue;
    hits.push(q);
    const before = sunk3(s, q);
    const after = sunk3(t, q);
    for (const k of after) if (!before.includes(k)) sunks.push([q, k]);
    if (after.length === fleetOf(N).length) { t.out[q] = true; t.outAt[q] = t.count; outs.push(q); }
  }
  t.last = { p, cell: m, hits, sunks, outs };
  const left = aliveList(t);
  if (left.length === 1) t.won = left[0];
  else t.turn = nextAlive(t, p);
  return t;
}

function result3(s) {
  // 順位: 勝った人が1位、ほかは脱落が遅い人ほど上（同じ手で脱落した人は同じ順位）
  const place = Array.from({ length: np(s) }, (_, q) => (q === s.won ? 1 : 1 + Array.from({ length: np(s) }, (_, r) => r).filter((r) => r === s.won || (s.outAt[r] ?? 0) > (s.outAt[q] ?? 0)).length));
  return { winner: s.won, cells: [], place, ranking: Array.from({ length: np(s) }, (_, q) => q).sort((a, b) => place[a] - place[b]) };
}

// 3人の CPU: 相手を1人決めて、その人の海を2人のときと同じ考え方で撃つ
function cpu3(s, p, rules) {
  if (s.phase === 'place') return { t: 'place', ships: randomShips(sizeOf(s), !!s.apart) };
  const N = sizeOf(s);
  const foes = aliveList(s).filter((q) => q !== p);
  const chasing = foes.filter((q) => {
    const sk = new Set(sunk3(s, q));
    return s.grid[q].some((k, i) => k >= 0 && !sk.has(k) && shotOn(s, q, i));
  });
  const pool = chasing.length ? chasing : foes;
  const q = pool[Math.floor(Math.random() * pool.length)];
  // 2人の局面に見立てる: 0 = 自分、1 = 相手 q。撃ったマス = 自分が撃ったマス ＋ q の海でほかの人が撃ったマス
  const seen = Array.from({ length: N * N }, (_, i) => s.shots[p][i] || shotOn(s, q, i));
  const v = { size: N, apart: s.apart, sonarOn: false, sonar: [null, null], salvo: false, grid: [s.grid[p], s.grid[q]], shots: [seen, Array(N * N).fill(false)] };
  const c = kaisenCpu(v, 0, rules);
  if (Number.isInteger(c) && !s.shots[p][c]) return c;
  const rest = s.shots[p].map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  return rest[Math.floor(Math.random() * rest.length)];
}

function info3(s) {
  const l = s.last;
  if (!l || l.placed || s.won !== null) return '';
  const name = (q) => `<b class="pl p${q}">${game.players[q]}</b>`;
  const who = name(l.p);
  if (!l.hits.length) return `${who}の弾は どちらの海も はずれ`;
  const sunk = l.sunks.map(([q, k]) => `${name(q)}の${shipName(fleetOf(sizeOf(s))[k])}`).join('と');
  const outs = l.outs.length ? `。${l.outs.map(name).join('と')}は全部の船が沈んだ！` : '';
  return `${who}の弾が${l.hits.map(name).join('と')}の海に<b>命中！</b>${sunk ? `${sunk}を沈めた` : ''}${outs}`;
}

// 3人の海の盤。owner の海に、ほかのだれかが撃ったあとを出す（いちばん新しい弾には印）
function sea3(s, owner, { title, showShips, onShoot = null, small = false, mine = null }) {
  const box = document.createElement('div');
  box.className = 'ks-sea' + (small ? ' small' : '');
  const head = document.createElement('div');
  head.className = 'ks-title';
  head.textContent = title;
  const N = sizeOf(s);
  const grid = document.createElement('div');
  grid.className = 'ks-grid';
  grid.style.gridTemplateColumns = `repeat(${N}, 1fr)`;
  const ships = s.grid[owner];
  const sunk = ships ? new Set(sunk3(s, owner)) : new Set();
  for (let i = 0; i < N * N; i++) {
    const shot = ships ? shotOn(s, owner, i) : false;
    const k = ships ? ships[i] : -1;
    const can = onShoot && !s.shots[mine][i];
    const cell = document.createElement(can ? 'button' : 'div');
    let cls = 'ks-cell';
    if (k >= 0 && (showShips || sunk.has(k))) cls += ' ship' + (sunk.has(k) ? ' sunk' : '');
    if (shot) cls += k >= 0 ? ' hit' : ' miss';
    else if (mine !== null && s.shots[mine][i]) cls += ' miss'; // 自分が撃ったマス（この海にはまだだれも撃っていない形でも、もう撃てない）
    if (s.last && !s.last.placed && s.last.cell === i && s.last.p !== owner) cls += ' last';
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

function render3(root, s, o) {
  const me = Number.isInteger(o.me) && o.me >= 0 ? o.me : null;
  const over = s.won !== null;
  const status = document.createElement('p');
  status.className = 'cc-log';
  const left = (q) => fleetOf(sizeOf(s)).length - sunk3(s, q).length;
  status.innerHTML = '残りの船: ' + Array.from({ length: np(s) }, (_, q) => `<b class="pl p${q}">${q === me ? 'あなた' : game.players[q]}</b> ${s.out[q] ? '脱落' : `${left(q)}隻`}`).join(' ／ ')
    + (o.canMove ? '<br>どちらかの海のマスを押すと、残っている2人の海の同じマスに撃ちます' : '');
  root.append(status);
  const order = me === null ? [0, 1, 2] : [1, 2].map((d) => (me + d) % 3);
  for (const q of order) {
    const shoot = o.canMove && me !== null && !s.out[q] ? (i) => o.onMove(i) : null;
    root.append(sea3(s, q, { title: `${game.players[q]}の海${s.out[q] ? '（脱落）' : ''}`, showShips: over || s.out[q], onShoot: shoot, mine: me, small: me === null }));
  }
  if (me !== null) root.append(sea3(s, me, { title: 'あなたの海', showShips: true, small: true, mine: me }));
}

/* ---------- 画面 ---------- */

let plc = { key: null, ships: [], sel: 0, vert: false }; // 並べている途中（描き直しで消えないよう外に持つ）
let sonarMode = null; // ソナーで調べる所を選んでいる途中なら「手の数:自分の番号」（描き直しで消えないよう外に持つ）
let salvoSel = { key: null, cells: [] }; // サルボで選んでいる途中のマス（この端末だけ。手の一覧に入れない。key は「手の数:自分の番号」）

const game = {
  id: 'kaisen',
  name: '海戦ゲーム',
  icon: '🚢',
  desc: '自分の海に船を隠して並べ、交代で相手の海を撃つ。相手の船を先に全部沈めた方の勝ち',
  ready: true,
  noLocal: true,
  noUndo: true, // オンラインの「待った」は付けない（外れたマスを知ったまま撃ち直せてしまうため。2026-10-06 本人の決定）
  players: ['先手', '後手', '3番手'],
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  settings: [
    CPU_SETTING,
    { key: 'players', label: '人数', desc: '3人では、1回撃つと残っている2人の海の同じマスに同時に撃ちます（ソナー・当たったらもう一度・サルボは使えません）', def: 2, choices: [[2, '2人'], [3, '3人']] },
    { key: 'sonar', label: 'ソナー', desc: '撃つ代わりに1回だけ、相手の海の 3×3 に船のマスがいくつあるか調べられる（使ったら相手の番）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'again', label: '当たったらもう一度', desc: '当たったら（沈めたときも）続けてもう1回撃てる。外れたら相手の番（サルボありのときは効かない）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'size', label: '海の広さ', desc: '8×8 は船が4隻（4・3・3・2マス）で、早く終わる', def: 10, choices: [[10, '10×10（船5隻）'], [8, '8×8（船4隻）']] },
    { key: 'apart', label: '船をくっつけない', desc: '船どうしを、ななめも含めてとなりに置けない（よくある決まり）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
    { key: 'salvo', label: 'サルボ', desc: '1回の番で、自分の残っている船の数だけマスを選んでまとめて撃つ（「当たったらもう一度」は効かない）', def: 'off', choices: [['off', 'なし'], ['on', 'あり']] },
  ],

  init({ rules = {} } = {}) {
    const n = Number(rules.size) === 8 ? 8 : N;
    if (rules.players === 3) {
      const three = (x) => [x(), x(), x()];
      return { np: 3, size: n, salvo: false, again: false, apart: rules.apart === 'on', sonarOn: false, sonar: [null, null, null], phase: 'place', turn: 0, grid: [null, null, null], shots: three(() => Array(n * n).fill(false)), out: [false, false, false], outAt: [0, 0, 0], last: null, won: null, count: 0 };
    }
    const salvo = rules.salvo === 'on';
    return { size: n, salvo, again: rules.again === 'on' && !salvo, apart: rules.apart === 'on', sonarOn: rules.sonar === 'on', sonar: [null, null], phase: 'place', turn: 0, grid: [null, null], shots: [Array(n * n).fill(false), Array(n * n).fill(false)], last: null, won: null, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, m) {
    if (s.won !== null) return null;
    if (np(s) === 3) return apply3(s, m);
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
    if (m && m.t === 'salvo') {
      // サルボ: 撃つ数ちょうど・重ならない・まだ撃っていないマスだけ。何手目か（n）が合わない手（同じ手が2回届いたときなど）は反則
      if (!s.salvo || m.n !== s.count || !Array.isArray(m.cells) || m.cells.length !== salvoCount(s, p)) return null;
      const seen = new Set();
      for (const c of m.cells) {
        if (!Number.isInteger(c) || c < 0 || c >= N * N || s.shots[p][c] || seen.has(c)) return null;
        seen.add(c);
      }
      const shots = s.shots.slice();
      shots[p] = shots[p].slice();
      for (const c of m.cells) shots[p][c] = true;
      const t = { ...s, shots, turn: 1 - p, count: s.count + 1 };
      const before = sunkList(s, p);
      const sunks = sunkList(t, p).filter((k) => !before.includes(k));
      const hits = m.cells.filter((c) => s.grid[1 - p][c] >= 0).length;
      t.last = { p, salvo: m.cells.slice(), hit: hits > 0, hits, sunk: sunks.length ? sunks[0] : null, sunks };
      if (hitsOf(t, p) === fleetOf(N).reduce((a, b) => a + b, 0)) t.won = p;
      return t;
    }
    if (s.salvo || !Number.isInteger(m) || m < 0 || m >= N * N) return null; // サルボありのときは1マスずつは撃てない
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
    if (np(s) === 3) return result3(s);
    return { winner: s.won, cells: [] };
  },

  cpu(s, p, rules) {
    if (np(s) === 3) return cpu3(s, p, rules);
    if (s.phase === 'place') return { t: 'place', ships: randomShips(sizeOf(s), !!s.apart) };
    return s.salvo ? salvoCpu(s, p, rules) : kaisenCpu(s, p, rules);
  },

  sound(a, b) {
    const l = b.last;
    if (!l || l.placed) return 'place';
    if (l.sonar !== undefined) return 'question';
    if (l.hits) return l.sunks.length ? 'punch' : l.hits.length ? 'hit' : 'pop'; // 3人
    return l.sunk !== null ? 'punch' : l.hit ? 'hit' : 'pop';
  },

  info(s) {
    if (np(s) === 3) return info3(s);
    const l = s.last;
    if (!l || l.placed || s.won !== null) return '';
    const who = `<b class="pl p${l.p}">${game.players[l.p]}</b>`;
    if (l.sonar !== undefined) return `${who}がソナーを使った: まだ撃っていないマスのうち、船のマスが<b>${l.n}つ</b>`;
    if (l.salvo) {
      const n = l.salvo.length;
      const sunk = l.sunks.length ? `。${l.sunks.map((k) => shipName(fleetOf(sizeOf(s))[k])).join('と')}を沈めた！` : '';
      return `${who}のサルボ（${n}発）: ${l.hits ? `<b>命中 ${l.hits}</b>` : '命中 0'}・はずれ ${n - l.hits}${sunk}`;
    }
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
      if (np(s) === 3) {
        const p = document.createElement('p');
        p.className = 'cc-log';
        p.textContent = `${game.players[s.turn]}が船を並べています…`;
        root.append(p);
        if (me !== null && s.grid[me]) root.append(sea3(s, me, { title: 'あなたの海', showShips: true, mine: me }));
        return;
      }
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = me === s.turn ? '' : `${game.players[s.turn]}が船を並べています…`;
      root.append(p);
      if (me !== null && s.grid[me]) root.append(sea(s, me, { title: 'あなたの海', showShips: true }));
      return;
    }

    if (np(s) === 3) { render3(root, s, o); return; }
    const status = document.createElement('p');
    status.className = 'cc-log';
    if (me !== null) {
      const left = (p) => fleetOf(sizeOf(s)).length - sunkList(s, p).length;
      status.textContent = `残りの船: あなた ${left(1 - me)}隻 ／ 相手 ${left(me)}隻` + (s.salvo && !over ? `（サルボ: 1回に ${salvoCount(s, me)}発）` : '');
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
    // サルボ: 押すと選ぶ・もう一度押すと外す。決まった数を選ぶと「撃つ」が押せる
    const salvo = o.canMove && s.salvo;
    const want = salvo ? salvoCount(s, me) : 0;
    if (salvo && salvoSel.key !== `${s.count}:${me}`) salvoSel = { key: `${s.count}:${me}`, cells: [] };
    const picked = salvo ? salvoSel.cells : [];
    const draw = () => game.render(root, s, o);
    const title = aiming ? '相手の海 — ソナーで調べる所（3×3の真ん中）を選ぶ'
      : salvo ? `相手の海 — 撃つマスを${want}つ選ぶ（${picked.length < want ? `あと${want - picked.length}つ` : '「撃つ」を押す'}）`
      : o.canMove ? '相手の海 — 撃つマスを選ぶ' : '相手の海';
    const toggle = (i) => {
      const k = picked.indexOf(i);
      if (k >= 0) picked.splice(k, 1);
      else if (picked.length < want) picked.push(i);
      else return; // もう決まった数を選んでいる（外してから選び直す）
      draw();
    };
    const shoot = aiming ? (i) => { sonarMode = null; o.onMove({ t: 'sonar', c: i }); } : salvo ? toggle : o.canMove ? (i) => o.onMove(i) : null;
    root.append(sea(s, 1 - me, { title, showShips: over, onShoot: shoot, aiming, picked }));
    if (salvo || canSonar) {
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
      if (salvo && !aiming) {
        btn(`🎯 撃つ（${picked.length}/${want}）`, 'primary', () => {
          if (picked.length !== want) return;
          const cells = picked.slice();
          salvoSel = { key: null, cells: [] };
          o.onMove({ t: 'salvo', cells, n: s.count });
        }, picked.length !== want);
        if (picked.length) btn('選び直す', 'ghost', () => { picked.length = 0; draw(); });
      }
      if (canSonar) btn(aiming ? 'ソナーをやめて撃つ' : '📡 ソナーを使う（1回だけ）', aiming ? 'ghost' : 'secondary', () => { sonarMode = aiming ? null : `${s.count}:${me}`; draw(); });
      root.append(acts);
    }
    root.append(sea(s, me, { title: 'あなたの海', showShips: true, small: true }));
  },
};

// 海の盤。owner の海に、相手（1 - owner）が撃ったあとを出す
function sea(s, owner, { title, showShips, onShoot = null, small = false, aiming = false, picked = [] }) {
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
    if (s.last && !s.last.placed && (s.last.cell === i || s.last.sonar === i || s.last.salvo?.includes(i)) && s.last.p === shooter) cls += ' last';
    if (zone?.has(i)) cls += ' sonar';
    if (can) {
      cell.type = 'button';
      cls += ' playable';
      cell.onclick = () => onShoot(i);
      cell.setAttribute('aria-label', `${Math.floor(i / N) + 1}段目 ${(i % N) + 1}列目`);
    }
    const pk = picked.indexOf(i);
    if (pk >= 0) {
      // サルボで選んだマス（style.css には足さず、ここで色を付ける）。選んだ順の番号を出す
      cell.style.background = '#ffe08a';
      cell.setAttribute('aria-pressed', 'true');
      const b = document.createElement('span');
      b.className = 'ks-sonar-n';
      b.style.background = '#e8590c';
      b.style.color = '#fff';
      b.textContent = pk + 1;
      cell.append(b);
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
  const key = `${N}:${s.count}:${s.turn}:${!!s.apart}`; // 一辺と「船をくっつけない」も入れる（変えた次の対局で、前の並べ方を使わないように）
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
