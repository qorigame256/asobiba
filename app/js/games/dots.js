// 点と線（ドット＆ボックス）。2〜4人（詳細設定「人数」）。順番に、となりあう2つの点を線でつなぐ。
// 四角の4辺目を引いた人がその四角をもらい、続けてもう1本引く。線を全部引いたら、四角がいちばん多い人の勝ち（同数なら引き分け）。
// 詳細設定「四角を取っても交代」（2026-10-06 本人の決定）: 四角を取っても続けて引けず、次の人の番になる。
// 詳細設定「金の四角」（2026-10-07。10回目の案）: ありにすると、取ると2点になる金の四角が（一辺の数 - 2）個ある（3×3 で1つ〜6×6 で4つ）。
//   置き場所は対局の種から（局面の gold = 四角の番号の一覧）。勝ち負けは四角の数でなく点（金は2点・ふつうは1点）で決める。
// 盤の大きさ（四角の数）は詳細設定で選ぶ。「おまかせ」は 2人 4×4・3人 5×5・4人 6×6（Claude の判断。人が多いほど1人あたりの四角が減るため）。
//
// 線の番号: 横線が先で (段 0〜h) × (列 0〜w-1) → 段*w+列。そのあとに縦線 (段 0〜h-1) × (列 0〜w) → 横線の数 + 段*(w+1)+列。
// 四角の番号: 段*w+列。手 = 線の番号。

import { CPU_SETTING, mulberry32 } from './util.js';

const AUTO = { 2: 4, 3: 5, 4: 6 };
const SIZE_CHOICES = [['auto', 'おまかせ（2人 4×4・3人 5×5・4人 6×6）'], [3, '3×3'], [4, '4×4'], [5, '5×5'], [6, '6×6']];

const hCount = (s) => (s.h + 1) * s.w;

// 四角 b の4辺の線の番号
function sides(s, b) {
  const r = Math.floor(b / s.w);
  const c = b % s.w;
  const H = hCount(s);
  return [r * s.w + c, (r + 1) * s.w + c, H + r * (s.w + 1) + c, H + r * (s.w + 1) + c + 1];
}

// 線 i に接する四角（1つか2つ）
function boxesOf(s, i) {
  const H = hCount(s);
  const out = [];
  if (i < H) {
    const r = Math.floor(i / s.w);
    const c = i % s.w;
    if (r > 0) out.push((r - 1) * s.w + c);
    if (r < s.h) out.push(r * s.w + c);
  } else {
    const k = i - H;
    const r = Math.floor(k / (s.w + 1));
    const c = k % (s.w + 1);
    if (c > 0) out.push(r * s.w + c - 1);
    if (c < s.w) out.push(r * s.w + c);
  }
  return out;
}

const drawn = (s, b) => sides(s, b).filter((x) => s.lines[x] !== null).length;
const valueOf = (s, b) => (s.gold?.includes(b) ? 2 : 1); // 金の四角は2点

export function scoresOf(s) {
  const sc = Array(s.n).fill(0);
  s.boxes.forEach((o, b) => { if (o !== null) sc[o] += valueOf(s, b); });
  return sc;
}

// 金の四角の置き場所（一辺 k の盤に k - 2 個。種から決める）
function makeGold(k, seed) {
  const rnd = mulberry32(seed ^ 0x601d);
  const cand = Array.from({ length: k * k }, (_, b) => b);
  const out = [];
  while (out.length < k - 2 && cand.length) out.push(cand.splice(Math.floor(rnd() * cand.length), 1)[0]);
  return out.sort((a, b) => a - b);
}

/* ---------- CPU ---------- */

// 線 i を引いたあと、次の人が続けて取れる四角の数（取れる四角を順に取っていく）
// 「四角を取っても交代」では続けて取れないので、3辺目になる四角の数だけを数える
function giveaway(s, i) {
  const lines = s.lines.slice();
  lines[i] = -1;
  const t = { ...s, lines };
  if (s.swap) return boxesOf(t, i).filter((b) => drawn(t, b) === 3).reduce((a, b) => a + valueOf(s, b), 0);
  let got = 0;
  for (;;) {
    let took = false;
    for (let b = 0; b < s.w * s.h; b++) {
      const sd = sides(t, b);
      const open = sd.filter((x) => lines[x] === null);
      if (open.length === 1) { lines[open[0]] = -1; got += valueOf(s, b); took = true; }
    }
    if (!took) return got;
  }
}

// つよいだけが使う「最後の2つを譲る」手。終盤（取り終えたら安全な線が残らない）で、つながった四角の列を取っていき
// 残りが2つになったとき、2つ目の四角の奥の辺を引いて2つを次の人に渡す。次の人は2つ取ったあと、別の列を開けて渡すしかなくなる。
// 2人のときだけ使う（3人以上では、次の人が開けた列は自分ではなくその次の人のものになるため）。譲る線 i を返す（使わないときは null）
function handout(s, takeLine) {
  const a = boxesOf(s, takeLine).find((b) => drawn(s, b) === 3);
  const b = boxesOf(s, takeLine).find((x) => x !== a);
  if (b === undefined || drawn(s, b) !== 2) return null;
  const m = sides(s, b).find((x) => s.lines[x] === null && x !== takeLine);
  if (m === undefined || boxesOf(s, m).some((x) => x !== b && drawn(s, x) >= 2)) return null;
  // 取れる四角を全部取ったあとに安全な線が残るなら、まだ終盤ではない
  const lines = s.lines.slice();
  for (let more = true; more;) {
    more = false;
    for (let x = 0; x < s.w * s.h; x++) {
      const open = sides(s, x).filter((y) => lines[y] === null);
      if (open.length === 1) { lines[open[0]] = -1; more = true; }
    }
  }
  const t = { ...s, lines };
  const safeLeft = lines.some((v, i) => v === null && boxesOf(t, i).every((x) => drawn(t, x) < 2));
  const rest = s.boxes.filter((o) => o === null).length - 2;
  return !safeLeft && rest >= 3 ? m : null; // 残りが少なければ、譲らずに全部取る
}

// CPU（よわい・ふつう・つよい）。
//   1. 4辺目を引いて四角を取れるなら取る  2. 3辺目を引かない（次の人に四角を渡さない）線を選ぶ
//   3. どれも3辺目になるなら、次の人に取られる四角がいちばん少ない線
// よわい: 取れる四角を2割見落とし、4割は適当に引く。ふつう: 1割は適当に引く。つよい: 適当に引かず、終盤に最後の2つを譲る（上）
const LEVEL = { weak: { miss: 0.2, slip: 0.4 }, normal: { miss: 0, slip: 0.1 }, strong: { miss: 0, slip: 0, deal: true } };
function dotsCpu(s, rules) {
  const lv = LEVEL[rules?.cpu] ?? LEVEL.weak;
  const free = s.lines.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const take = free.filter((i) => boxesOf(s, i).some((b) => drawn(s, b) === 3));
  if (lv.deal && s.n === 2 && !s.swap && take.length === 1) {
    const m = handout(s, take[0]);
    if (m !== null) return m;
  }
  if (take.length && Math.random() >= lv.miss) {
    // 金の四角を取れるなら先に取る（よわいは気にしない）
    const gold = lv.miss ? [] : take.filter((i) => boxesOf(s, i).some((b) => drawn(s, b) === 3 && valueOf(s, b) === 2));
    return pick(gold.length ? gold : take);
  }
  if (Math.random() < lv.slip) return pick(free);
  const safe = free.filter((i) => boxesOf(s, i).every((b) => drawn(s, b) < 2));
  if (safe.length) return pick(safe);
  let best = Infinity;
  let top = [];
  for (const i of free) {
    const g = giveaway(s, i);
    if (g < best) { best = g; top = [i]; } else if (g === best) top.push(i);
  }
  return pick(top);
}

export default {
  id: 'dots',
  name: '点と線',
  icon: '🔲',
  desc: '点と点を線でつなぎ、四角を閉じたら自分のもの。四角が多い人の勝ち。2〜4人',
  ready: true,
  players: ['赤', '青', '緑', '紫'],
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    { key: 'players', label: '人数', desc: '順番に線を引く人数', def: 2, choices: [[2, '2人'], [3, '3人'], [4, '4人']] },
    { key: 'size', label: '盤', desc: '四角の数（よこ×たて）', def: 'auto', choices: SIZE_CHOICES },
    { key: 'swap', label: '四角を取っても交代', desc: '四角を取っても続けて引けず、次の人の番になる', def: false },
    { key: 'gold', label: '金の四角', desc: '取ると2点になる金の四角が、盤のどこかに数個ある（場所は毎回変わる）。点の多い人の勝ち', def: false, choices: [[false, 'なし'], [true, 'あり']] },
    CPU_SETTING,
  ],

  cpu(s, p, rules) { return dotsCpu(s, rules); },

  init({ rules = {}, seed = 0 } = {}) {
    const n = [2, 3, 4].includes(rules.players) ? rules.players : 2;
    const k = SIZE_CHOICES.some(([c]) => c === rules.size) && rules.size !== 'auto' ? rules.size : AUTO[n];
    const s = { n, w: k, h: k, swap: !!rules.swap, turn: 0, last: null, count: 0 };
    if (rules.gold) s.gold = makeGold(k, seed);
    s.lines = Array(hCount(s) + s.h * (s.w + 1)).fill(null);
    s.boxes = Array(k * k).fill(null);
    return s;
  },

  turn(s) { return s.turn; },

  apply(s0, i) {
    if (!Number.isInteger(i) || i < 0 || i >= s0.lines.length || s0.lines[i] !== null) return null;
    const s = { ...s0, lines: s0.lines.slice(), boxes: s0.boxes.slice(), last: i, count: s0.count + 1 };
    s.lines[i] = s0.turn;
    let got = false;
    for (const b of boxesOf(s, i)) {
      if (drawn(s, b) === 4) { s.boxes[b] = s0.turn; got = true; }
    }
    if (!got || s0.swap) s.turn = (s0.turn + 1) % s0.n; // 四角を取ったら続けてもう1本（「四角を取っても交代」では次の人）
    return s;
  },

  result(s) {
    if (s.count < s.lines.length) return null;
    const sc = scoresOf(s);
    const top = Math.max(...sc);
    const winners = sc.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
    return { winner: winners.length === 1 ? winners[0] : null, cells: [] };
  },

  info(s) {
    const sc = scoresOf(s);
    return sc.map((v, p) => `<b class="pl p${p}">${this.players[p]} ${v}</b>`).join('　');
  },

  render(root, s, o) {
    root.innerHTML = '';
    root.className = 'board dt';
    root.style.setProperty('--w', s.w);
    root.style.setProperty('--h', s.h);
    const H = hCount(s);
    const fresh = o.fresh ? s.last : null;
    const res = this.result(s);
    const top = res ? Math.max(...scoresOf(s)) : null;
    const sc = res ? scoresOf(s) : null;
    for (let gr = 0; gr <= s.h * 2; gr++) {
      for (let gc = 0; gc <= s.w * 2; gc++) {
        const r = gr >> 1;
        const c = gc >> 1;
        let e;
        if (gr % 2 === 0 && gc % 2 === 0) {
          e = document.createElement('span');
          e.className = 'dt-dot';
        } else if (gr % 2 === 1 && gc % 2 === 1) {
          const b = r * s.w + c;
          e = document.createElement('span');
          const owner = s.boxes[b];
          const gold = valueOf(s, b) === 2;
          e.className = 'dt-box' + (owner !== null ? ' p' + owner : '') + (gold ? ' gold' : '') + (owner !== null && fresh !== null && boxesOf(s, fresh).includes(b) ? ' pop' : '')
            + (owner !== null && res && sc[owner] === top ? ' win' : '');
          if (owner !== null) e.textContent = this.players[owner][0] + (gold ? '★' : '');
          else if (gold) { e.textContent = '★'; e.title = '金の四角（2点）'; }
        } else {
          const i = gr % 2 === 0 ? r * s.w + c : H + r * (s.w + 1) + c;
          e = document.createElement('button');
          e.type = 'button';
          e.className = 'dt-line ' + (gr % 2 === 0 ? 'h' : 'v');
          const v = s.lines[i];
          if (v !== null) {
            e.classList.add('on', 'p' + v);
            if (i === s.last) e.classList.add('last');
            e.tabIndex = -1;
          } else if (o.canMove) {
            e.classList.add('playable', 'p' + s.turn);
            e.setAttribute('aria-label', '線を引く');
            e.onclick = () => o.onMove(i);
          } else {
            e.tabIndex = -1;
          }
        }
        root.append(e);
      }
    }
  },
};
