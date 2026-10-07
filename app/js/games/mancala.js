// マンカラ（カラハ）。2人（3人は下の段落）。自分の側に穴が6つと、右はしにゴールが1つ。最初は穴1つに石4個（詳細設定で3〜6個）。
// 自分の番に、自分の側の穴を1つ選び、その石を全部取って、反時計回りに1個ずつ配る（相手のゴールは飛ばす）。
// 最後の1個が自分のゴールに入ったら、もう1回。最後の1個が自分の側の空いた穴に入り、向かいの相手の穴に石があれば、
// その両方をとって自分のゴールへ入れる（2026-10-05 本人承認）。
// どちらかの側の穴が全部空になったら終わり。残った石はその側の持ち主のゴールへ入れ、ゴールの石が多いほうの勝ち。
// 穴の番号: 0〜5 = 先手の穴（左から右）、6 = 先手のゴール、7〜12 = 後手の穴（先手から見て右から左）、13 = 後手のゴール。
// 手 = 自分の側の穴の何番目か（0〜5。左から。先手は 0〜5、後手は 7〜12 にあたる）。
// 3人（詳細設定「人数」。2026-10-05 本人の決定）: 三角形の盤。14〜19 = 三番手の穴、20 = 三番手のゴール（p * 7 + k の形はそのまま）。
// 石はほかの2人のゴールを飛ばして配る。自分の空いた k 番目の穴で止まったら、ほかの2人の k 番目の穴の石を両方とる（どちらかに石があれば）。
// 誰か1人の側が空になったら全員終わり。一番多い人が2人以上なら引き分け。
// 詳細設定「捕獲なし」（2026-10-06 本人の決定）: 空いた穴で止まっても石をとらない（2人・3人とも）。
// 詳細設定「穴の数」（鍵は pits。2026-10-07。10回目の案）: 2人のときだけ、片側の穴を 6（最初）・5・4 にできる（局面の holes。3人はいつも 6）。
//   番号の形は同じで、1人ぶんが「穴 holes 個＋ゴール」になる（穴4つなら 0〜3 = 先手の穴、4 = 先手のゴール、5〜8 = 後手の穴、9 = 後手のゴール）。
//   向かいの穴は 2*holes - i（穴6つなら 12 - i で前と同じ）。手は 0〜holes-1。

import { CPU_SETTING, boardCpu } from './util.js';

const nOf = (s) => s.n ?? 2;
const holesOf = (s) => s.holes ?? 6;
const pitOf = (s, p, k) => p * (holesOf(s) + 1) + k;
const storeOf = (s, p) => pitOf(s, p, holesOf(s));
const isStore = (s, i) => i % (holesOf(s) + 1) === holesOf(s);
const stores = (s) => Array.from({ length: nOf(s) }, (_, p) => s.pits[storeOf(s, p)]);
const side = (s, p) => s.pits.slice(pitOf(s, p, 0), storeOf(s, p));
const legal = (s) => Array.from({ length: holesOf(s) }, (_, k) => k).filter((k) => s.pits[pitOf(s, s.turn, k)] > 0);
const HOLES = [6, 5, 4];

const game = {
  id: 'mancala',
  name: 'マンカラ',
  icon: '🫘',
  desc: '穴の石を1個ずつ配っていき、自分のゴールに多く集めた方の勝ち',
  ready: true,
  players: ['先手', '後手', '三番手'],
  // 詳細設定の人数（2〜3人）。待合室の席の数になる
  seatCount(rules) { return rules?.players === 3 ? 3 : 2; },
  settings: [
    { key: 'players', label: '人数', desc: '3人では三角形の盤で、ほかの2人のゴールを飛ばして配る', def: 2, choices: [[2, '2人'], [3, '3人']] },
    { key: 'stones', label: '最初の石の数', desc: '穴1つあたり。多いほど長くなる', def: 4, choices: [[3, '3個'], [4, '4個'], [5, '5個'], [6, '6個']] },
    { key: 'pits', label: '穴の数', desc: '片側の穴の数（2人のときだけ。3人はいつも6つ）。少ないほど早く終わる', def: 6, choices: [[6, '6つ'], [5, '5つ'], [4, '4つ']] },
    { key: 'nocap', label: '捕獲なし', desc: '自分の空いた穴で止まっても、向かいの石をとらない。ゴールに入れた石だけで勝負', def: false },
    CPU_SETTING,
  ],

  init({ rules = {} } = {}) {
    const n = [3, 4, 5, 6].includes(rules.stones) ? rules.stones : 4;
    const np = rules.players === 3 ? 3 : 2;
    const holes = np === 2 && HOLES.includes(rules.pits) ? rules.pits : 6;
    const pits = Array(np * (holes + 1)).fill(n);
    const s = { n: np, holes, nocap: !!rules.nocap, pits, turn: 0, last: null, over: false, count: 0 };
    for (let p = 0; p < np; p++) pits[storeOf(s, p)] = 0;
    return s;
  },

  turn(s) { return s.turn; },

  apply(s, k) {
    const H = holesOf(s);
    if (s.over || !Number.isInteger(k) || k < 0 || k >= H) return null;
    const p = s.turn;
    const np = nOf(s);
    const from = pitOf(s, p, k);
    const mine = storeOf(s, p);
    if (!s.pits[from]) return null;
    const pits = s.pits.slice();
    let hand = pits[from];
    pits[from] = 0;
    let i = from;
    const sown = [];
    while (hand > 0) {
      i = (i + 1) % pits.length;
      if (isStore(s, i) && i !== mine) continue; // ほかの人のゴールは飛ばす
      pits[i] += 1;
      hand -= 1;
      sown.push(i);
    }
    const last = { p, from, sown, extra: false, capture: null };
    let turn = (p + 1) % np;
    // とる相手の穴: 2人は向かい・3人はほかの2人の同じ番目
    const opp = np === 2 ? [2 * H - i] : [0, 1, 2].filter((q) => q !== p).map((q) => pitOf(s, q, i % (H + 1)));
    if (i === mine) {
      last.extra = true;
      turn = p;
    } else if (!s.nocap && i >= pitOf(s, p, 0) && i < mine && pits[i] === 1 && opp.some((j) => pits[j] > 0)) {
      const got = opp.reduce((a, j) => a + pits[j], 1);
      last.capture = { at: i, opp, got };
      pits[mine] += got;
      pits[i] = 0;
      for (const j of opp) pits[j] = 0;
    }
    const t = { n: np, holes: H, nocap: s.nocap, pits, turn, last, over: false, count: s.count + 1 };
    // 誰かの側が空になったら、残りをそれぞれのゴールへ
    if (Array.from({ length: np }, (_, q) => side(t, q).every((x) => !x)).some(Boolean)) {
      for (let q = 0; q < np; q++) {
        for (let j = 0; j < H; j++) {
          pits[storeOf(t, q)] += pits[pitOf(t, q, j)];
          pits[pitOf(t, q, j)] = 0;
        }
      }
      t.over = true;
    }
    return t;
  },

  result(s) {
    if (!s.over) return null;
    const sc = stores(s);
    const top = Math.max(...sc);
    const winners = sc.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
    return { winner: winners.length === 1 ? winners[0] : null, cells: [] };
  },

  // CPU: 何手か先まで読む（ゴールの石の差で点を付ける）。よわいは浅く、ときどき適当に打つ
  cpu(s, p, rules) {
    const depth = { weak: 1, normal: 3, strong: 6 };
    const mistake = { weak: 0.3, normal: 0.12, strong: 0 };
    if (nOf(s) === 2) {
      const score = (t, who) => t.pits[storeOf(t, who)] - t.pits[storeOf(t, 1 - who)];
      return boardCpu(game, s, rules, legal, score, { depth, mistake });
    }
    // 3人: boardCpu は2人用（相手の得 = 自分の損）なので使えない。ほかの2人が自分の点を下げにくると考えて読む
    const level = depth[rules?.cpu] !== undefined ? rules.cpu : 'weak';
    const moves = legal(s);
    if (moves.length === 1) return moves[0];
    if (Math.random() < mistake[level]) return moves[Math.floor(Math.random() * moves.length)];
    const me = s.turn;
    const score = (t) => t.pits[storeOf(t, me)] - Math.max(...stores(t).filter((_, q) => q !== me)); // 一番多い相手との差
    const search = (t, d, alpha, beta) => {
      if (t.over) return score(t) * 1000;
      if (d === 0) return score(t);
      const mine = t.turn === me;
      let best = mine ? -Infinity : Infinity;
      for (const m of legal(t)) {
        const v = search(game.apply(t, m), d - 1, alpha, beta);
        if (mine) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
        if (alpha >= beta) break;
      }
      return best;
    };
    let best = -Infinity;
    let top = [];
    for (const m of moves) {
      const v = search(game.apply(s, m), depth[level] - 1, -Infinity, Infinity);
      if (v > best) { best = v; top = [m]; } else if (v === best) top.push(m);
    }
    return top[Math.floor(Math.random() * top.length)];
  },

  info(s) {
    const l = s.last;
    if (!l || s.over) return '';
    const name = game.players[l.p];
    if (l.extra) return `<b class="pl p${l.p}">${name}</b>はゴールで止まったので、もう1回！`;
    if (l.capture) return `<b class="pl p${l.p}">${name}</b>が向かいの石をとった（${l.capture.got}個）`;
    return '';
  },

  render(root, s, o) {
    const res = this.result(s);
    const np = nOf(s);
    const bottom = Number.isInteger(o.me) && o.me > 0 && o.me < np ? o.me : 0; // 自分の側を下に
    const top = 1 - bottom;
    root.innerHTML = '';
    root.className = 'board mc';
    const sown = new Set(o.fresh && s.last ? s.last.sown : []);

    const H = holesOf(s);
    const pitEl = (i, owner) => {
      const store = i === storeOf(s, owner);
      const k = i - pitOf(s, owner, 0);
      const can = !store && !res && o.canMove && owner === s.turn && s.pits[i] > 0;
      const e = document.createElement(can ? 'button' : 'div');
      if (can) {
        e.type = 'button';
        e.onclick = () => o.onMove(k);
        e.setAttribute('aria-label', `${k + 1}番目の穴（石${s.pits[i]}個）`);
      }
      e.className = 'mc-pit p' + owner + (store ? ' store' : '') + (can ? ' playable' : '') + (sown.has(i) ? ' sown' : '')
        + (s.last?.from === i ? ' from' : '') + (s.last?.capture && (s.last.capture.at === i || [s.last.capture.opp].flat().includes(i)) ? ' cap' : '');
      const stones = document.createElement('div');
      stones.className = 'mc-stones';
      const shown = Math.min(s.pits[i], store ? 0 : 12);
      for (let j = 0; j < shown; j++) {
        const d = document.createElement('i');
        d.style.setProperty('--h', ((i * 7 + j * 53) % 360) + 'deg');
        stones.append(d);
      }
      const num = document.createElement('div');
      num.className = 'mc-num';
      num.textContent = s.pits[i];
      e.append(stones, num);
      if (store) {
        const who = document.createElement('div');
        who.className = 'mc-who';
        who.textContent = game.players[owner];
        e.append(who);
      }
      return e;
    };

    const note = document.createElement('p');
    note.className = 'cc-log';
    const meName = Number.isInteger(o.me) && o.me >= 0 ? 'あなた' : game.players[bottom];
    if (res) note.textContent = 'ゴールの石: ' + stores(s).map((v, p) => `${game.players[p]} ${v}個`).join(' ／ ');

    if (np === 3) {
      // 三角形: 下の辺 = 自分（左→右、右下の角にゴール）、右の辺 = 次の人（下→上、てっぺんにゴール）、左の辺 = その次（上→下、左下にゴール）
      const W = 100;
      const H = 90;
      const A = [7, 83];
      const B = [93, 83];
      const C = [50, 83 - 86 * Math.sqrt(3) / 2];
      const tri = document.createElement('div');
      tri.className = 'mc-tri';
      tri.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><polygon points="${[A, B, C].map((q) => q.join(',')).join(' ')}"/></svg>`;
      const put = (e, [x, y], size) => {
        e.style.left = `${x - size / 2}%`;
        e.style.top = `${((y - size / 2) / H) * 100}%`;
        e.style.width = `${size}%`;
        tri.append(e);
      };
      [[A, B], [B, C], [C, A]].forEach(([from, to], side) => {
        const owner = (bottom + side) % 3;
        for (let k = 0; k < 6; k++) {
          const t = (k + 1) / 7;
          put(pitEl(pitOf(s, owner, k), owner), [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t], 10.5);
        }
        put(pitEl(storeOf(s, owner), owner), to, 13.5);
      });
      root.append(tri);
      if (!res) note.textContent = `下の辺が${meName}の穴、右下の角がゴール。石は反時計回りに配ります（ほかの人のゴールは飛ばす）`;
      root.append(note);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'mc-wrap';
    wrap.append(pitEl(storeOf(s, top), top)); // 左はし = 上の人のゴール
    const mid = document.createElement('div');
    mid.className = 'mc-mid';
    const rowTop = document.createElement('div');
    rowTop.className = 'mc-row';
    for (let k = H - 1; k >= 0; k--) rowTop.append(pitEl(pitOf(s, top, k), top)); // 上の人の穴は右から左へ進む
    const rowBottom = document.createElement('div');
    rowBottom.className = 'mc-row';
    for (let k = 0; k < H; k++) rowBottom.append(pitEl(pitOf(s, bottom, k), bottom));
    if (H !== 6) for (const r of [rowTop, rowBottom]) r.style.gridTemplateColumns = `repeat(${H}, 1fr)`;
    mid.append(rowTop, rowBottom);
    wrap.append(mid, pitEl(storeOf(s, bottom), bottom)); // 右はし = 下の人のゴール
    root.append(wrap);
    if (!res) note.textContent = `下の列が${meName}の穴、右はしがゴール。石は反時計回りに配ります`;
    root.append(note);
  },
};

export default game;
