// 多数決の陣地（2026-11-27 本人が選んだ、Claude が考えた独自ルール。分かれ目は Claude の推奨を本人が承認）。2〜4人（詳細設定「人数」）。
// 点の付いた5つの陣地に、順番に石を1つずつ置く。陣地が埋まったら、そこにいちばん多く置いた人がその点を取る。全部の陣地が埋まったら、点の多い人の勝ち。
//
// 本人が承認した分かれ目: 陣地は5つで、点の 2〜6 を対局ごとに並べ替える（対局の種 seed から。全員の端末で同じ並び）。1つの陣地に石は5つまで。
//   いちばん多い人が並んだら、その陣地はだれも取らない。全部の陣地が埋まったら終わり。
// Claude の判断: 置けるのは埋まっていない陣地ならどこでも。順番は席の順に回る（石は全部で25個なので、2人なら1番手が13個・2番手が12個置く。
//   3人は 9・8・8、4人は 7・6・6・6。もう一回では順番が回る）。陣地は5つ目の石が置かれたその場で決まる。
//   点のいちばん多い人が並んだら引き分け（3〜4人は成績表で順位の点）。2人では1つの陣地で並ぶことは無い（5つは奇数）。
// おまけ点（本人の選択「後の席におまけ点」。2026-11-27）: 2人は2番手に4点（本人が承認した数）。2人を読み切ると、点の並び120通りのすべてで
//   最善どうしなら1番手が4点差で勝つため（おまけ4点で最善どうしは引き分け。つよいどうし20局が全部引き分け）。
//   3〜4人の数は Claude の判断: つよいどうし（試し打ち）で、並んだら頭数で分けた席ごとの取り分を比べて決めた。
//   3人 0・1・2点 → 36%・36%・27%（並んだ局 53%）。なし 43%・29%・28%、0・1・1 は 40%・44%・15%、0・0.5・1 は 50%・41%・10%。
//   4人 0・1・2・2点 → 32%・23%・30%・15%（並んだ局 49%）。なし 81%・8%・9%・1%、0・1・2・3 は 27%・15%・25%・33%、0・2・2・2 は 8%・55%・22%・14%。
//   CPU は「自分の点 − いちばん多い人の点」で打つので、おまけ点を持った席がほかの CPU に狙われ、数を変えると取り分が大きく入れ替わる（人どうしの釣り合いは未確認）。
//
// 局面: { n, pts: 陣地ごとの点, bonus: 席ごとのおまけ点, zones: 陣地ごとに置いた人の席を置いた順に並べた配列, turn, last: 直前に置いた陣地（無ければ null）, moves: 置いた数 }。
// 手 = 陣地の番号 0〜4。
//
// 「一斉に置く」（2026-11-27 の49回目の案。本人が選んだ。詳細設定 together、最初は なし）: 1回ごとに全員がこっそり陣地を選び、そろったら同時に開いて置く。
// Claude の判断: 盤のゲームは番の人が1人ずつ打つ作りなので、選ぶのは席の順だが、全員が選び終わるまでほかの人の選びは画面に出さない（自分の選びだけ薄く出す）。
//   簡易の隠し方（全員の端末が知っている）。CPU はほかの人の選びを見ないで選ぶ。「相手の迷いを見せる」は使わない（noPeek）。
//   1つの陣地に空きより多くの石が来たら、その陣地を選んだ石は全部はじかれ（置かれない）、その陣地はその場で締め切り、いまの石で決まる（石が5つ無くても）。
//   はじめは「先に入る人から入れる」にしたが、最後の1つの空きを毎回同じ席が取り、2人のつよいどうしで 1番手 74勝・2番手 24勝（100局）と偏ったため、席で差の出ないこの形にした。
//   全部の陣地が埋まるか締め切られたら終わり。おまけ点は付けない（実測は BONUS の下）。
//   ありのときだけ局面に tog: true・pend: [席ごとのこの回の選び か null]・shut: [陣地ごとの締め切りか]・rev: 直前に開いた回 { picks: 選び, got: 入ったか } を持つ（なしなら今までと同じ局面）。
//   turn はまだ選んでいない人のうち席の番号の小さい人。

import { CPU_SETTING, TAP_PEEK_SETTING, col, mulberry32, shuffle, judgeOf } from './util.js';

const ZONES = 5;
const CAP = 5;
const POINTS = [2, 3, 4, 5, 6];
// 後の席のおまけ点（決め方と実測はファイルの先頭）
export const BONUS = { 2: [0, 4], 3: [0, 1, 2], 4: [0, 1, 2, 2] };
// 一斉に置くときは、おまけ点を付けない。席で差が出ないため（つよいどうし、2026-11-27 の実測）:
//   2人 1番手 38勝・2番手 37勝・引き分け 125（200局）、3人 35・29・42・引き分け 14（120局）、4人 13・11・14・10・引き分け 72（120局）。
//   強さの順: ふつう-よわい 90・5・5、つよい-ふつう 75・9・16 と 81・7・12（各100局）。1手の最長 33ms

// 一斉に置く: そろった回の選びを置く。空きより多く来た陣地は全部はじいて締め切る。席ごとに入ったかを返す（zones と shut を書き換える）
function placeRound(zones, shut, picks, n) {
  const got = new Array(n).fill(false);
  for (let z = 0; z < ZONES; z++) {
    const who = [];
    for (let p = 0; p < n; p++) if (picks[p] === z) who.push(p);
    if (!who.length) continue;
    if (who.length > CAP - zones[z].length) { shut[z] = true; continue; }
    zones[z] = [...zones[z], ...who];
    for (const p of who) got[p] = true;
  }
  return got;
}

// 陣地 z の石の数（席ごと）
const countIn = (n, z) => {
  const c = new Array(n).fill(0);
  for (const p of z) c[p]++;
  return c;
};
// 埋まった（shut なら締め切った）陣地を取った人（並んだら -1。石が無いときも -1。埋まっていなければ null）
export function ownerOf(n, z, shut = false) {
  if (z.length < CAP && !shut) return null;
  const c = countIn(n, z);
  const top = Math.max(...c);
  const w = c.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
  return w.length === 1 ? w[0] : -1;
}
// 席ごとの取った点
export function scoresOf(s) {
  const sc = s.bonus.slice();
  s.zones.forEach((z, i) => {
    const w = ownerOf(s.n, z, !!s.shut?.[i]);
    if (w !== null && w >= 0) sc[w] += s.pts[i];
  });
  return sc;
}
// 決まった陣地の石を、人ごとの列に並べた形（2026-11-27 の UI・UX の14回目「数比べ」）。列は席の順、いちばん多い人の列（取った人）に lead。
// stones: 置いた順の石の要素（無ければ作る）。返すのは入れ物
function groupEl(n, z, w, stones) {
  const grp = document.createElement('div');
  grp.className = 'tsu-grp';
  const seats = [...new Set(z)].sort((a, b) => a - b);
  grp.style.setProperty('--nc', seats.length);
  const cols = new Map(seats.map((p) => {
    const c = document.createElement('div');
    c.className = 'tsu-col p' + col(p) + (p === w ? ' lead' : '');
    grp.append(c);
    return [p, c];
  }));
  z.forEach((p, k) => {
    const sl = document.createElement('span');
    sl.className = 'tsu-slot';
    sl.append(stones?.[k] ?? Object.assign(document.createElement('span'), { className: 'tsu-stone p' + col(p) }));
    cols.get(p).append(sl);
  });
  return grp;
}
// 数比べの動き: いまの石の置き場（slots）を、人ごとの列（groupEl）へ滑らせて並べ替え、取った人の列を光らせてから、点の札をその人の点の数字（状態の欄）へ飛ばす。
// 測るのは描き直しが済んでから（setTimeout。CLAUDE.md の「描き直しの途中で測らない」）。途中で描き直されたら（要素が外れたら）やめる
function regroupLater(box, slots, stones, z, n, w, pt, delay) {
  setTimeout(() => {
    if (!box.isConnected || !slots.isConnected) return;
    const first = stones.map((e) => e.getBoundingClientRect());
    const grp = groupEl(n, z, -2, stones.map((e) => { e.classList.remove('pop', 'last', 'drop'); return e; }));
    slots.replaceWith(grp);
    stones.forEach((e, k) => {
      const l = e.getBoundingClientRect();
      e.animate([{ transform: `translate(${first[k].left - l.left}px, ${first[k].top - l.top}px)` }, { transform: 'none' }], { duration: 460, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    });
    setTimeout(() => {
      if (!grp.isConnected) return;
      if (w >= 0) grp.querySelector(`.tsu-col.p${col(w)}`)?.classList.add('lead');
      const to = w >= 0 ? document.querySelector(`[data-roll="tsu${w}"]`) : null;
      const a = pt.getBoundingClientRect();
      const b = to?.getBoundingClientRect();
      if (!b?.width || !a.width) return;
      const fly = pt.cloneNode(true);
      fly.classList.add('tsu-fly');
      Object.assign(fly.style, { position: 'fixed', left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px', margin: '0', zIndex: '60', pointerEvents: 'none' });
      document.body.append(fly);
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const anim = fly.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(.45)`, opacity: 0.25 },
      ], { duration: 650, easing: 'ease-in-out' });
      anim.onfinish = anim.oncancel = () => fly.remove();
    }, 560);
  }, delay);
}

const doneAt = (s, i) => s.zones[i].length >= CAP || !!s.shut?.[i]; // 埋まったか締め切った陣地
const legalOf = (s) => s.zones.map((z, i) => (doneAt(s, i) ? -1 : i)).filter((i) => i >= 0);

/* ---------- CPU ---------- */

// 速く数えるため、CPU の中では陣地ごと・席ごとの石の数（cnt[陣地][席]）と陣地の石の数（len）で持つ
const countsOf = (s) => ({ cnt: s.zones.map((z) => countIn(s.n, z)), len: s.zones.map((z, i) => (s.shut?.[i] ? CAP : z.length)) }); // 締め切った陣地は埋まったと数える
// 埋まった陣地を取った人（並んだら -1）
function winnerOfCnt(c) {
  let top = -1, who = -1;
  for (let p = 0; p < c.length; p++) {
    if (c[p] > top) { top = c[p]; who = p; } else if (c[p] === top) who = -1;
  }
  return who;
}

// 2人の読み切り。手ごとに、手番の人から見た「これから取る点 − 相手がこれから取る点」（両者が最善）を返す。
// 2人の局面の数は始めからでも約55万で、手元の PC で 0.13 秒（2026-11-27 の実測）。陣地ごとの (1番手の数, 2番手の数) を36進で1つの数にして覚える。
// 1つの陣地に5つなので、2人では並ぶことが無い（多い方が取る）
// 同じ局面をまた聞かれたとき（観戦の形勢の帯は描き直すたびに聞く）のために、答えだけを最近の30局面ぶん覚えておく（読みの途中の表は捨てる。始めの局面の表は約44MB）
const solved = new Map();
function solve2(s) {
  const sig = `${s.pts}|${s.turn}|${s.zones.map((z) => z.join('')).join('/')}`;
  const hit = solved.get(sig);
  if (hit) return hit;
  const out = solve2raw(s);
  solved.set(sig, out);
  if (solved.size > 30) solved.delete(solved.keys().next().value);
  return out;
}
function solve2raw(s) {
  const { cnt } = countsOf(s);
  const a = cnt.map((c) => c[0]);
  const b = cnt.map((c) => c[1]);
  const memo = new Map();
  // turn の人がマス i に置いた（mine[i] は置いたあと）ときに取る点
  const gainOf = (i, mine) => (a[i] + b[i] === CAP ? (mine[i] * 2 > CAP ? s.pts[i] : -s.pts[i]) : 0);
  const rec = (turn) => {
    let key = 0;
    for (let i = 0; i < ZONES; i++) key = key * 36 + a[i] * 6 + b[i];
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const mine = turn === 0 ? a : b;
    let best = -Infinity;
    for (let i = 0; i < ZONES; i++) {
      if (a[i] + b[i] >= CAP) continue;
      mine[i]++;
      const v = gainOf(i, mine) - rec(1 - turn);
      mine[i]--;
      if (v > best) best = v;
    }
    if (best === -Infinity) best = 0;
    memo.set(key, best);
    return best;
  };
  const mine = s.turn === 0 ? a : b;
  const moves = legalOf(s).map((i) => {
    mine[i]++;
    const v = gainOf(i, mine) - rec(1 - s.turn);
    mine[i]--;
    return { i, v };
  });
  return { moves, rest: moves.length ? Math.max(...moves.map((x) => x.v)) : 0 };
}
const best2 = (s) => {
  const { moves, rest } = solve2(s);
  return moves.filter((x) => x.v === rest).map((x) => x.i);
};

// 3〜4人: 手ごとに「その手のあと、全員が空いた陣地へ適当に置いて最後まで行く」試しを tries 回して、
// 自分の点 − ほかの人でいちばん多い人の点（おまけ点も入れる）の平均がいちばん良い手
function rollout(s, tries) {
  const { cnt: c0, len: l0 } = countsOf(s);
  const moves = legalOf(s);
  const n = s.n;
  const me = s.turn;
  let bestV = -Infinity;
  let top = [];
  for (const m of moves) {
    let sum = 0;
    for (let t = 0; t < tries; t++) {
      const cnt = c0.map((c) => c.slice());
      const len = l0.slice();
      let turn = me;
      let z = m;
      for (;;) {
        cnt[z][turn]++;
        len[z]++;
        turn = (turn + 1) % n;
        const open = [];
        for (let i = 0; i < ZONES; i++) if (len[i] < CAP) open.push(i);
        if (!open.length) break;
        z = open[Math.floor(Math.random() * open.length)];
      }
      const sc = s.bonus.slice();
      for (let i = 0; i < ZONES; i++) { const w = winnerOfCnt(cnt[i]); if (w >= 0) sc[w] += s.pts[i]; }
      let other = -Infinity;
      for (let p = 0; p < n; p++) if (p !== me && sc[p] > other) other = sc[p];
      sum += sc[me] - other;
    }
    const v = sum / tries;
    if (v > bestV) { bestV = v; top = [m]; } else if (v === bestV) top.push(m);
  }
  return top;
}

// よわい: 4割は適当。ほかは、置いて陣地が埋まり自分が取れるならそこ、なければ埋まって取られる陣地を避けて適当
// ふつう: 2人は読み切りの手を選ぶが 2割は適当。3〜4人は試し40回で選び、1割は適当
// つよい: 2人は読み切り。3〜4人は試し300回
// 120局の実測（強い方の勝ち・負け・引き分け。2026-11-27。おまけ点あり）: 2人 ふつう-よわい 103・12・5、つよい-ふつう（60局）37・0・23、
//   3人 ふつう-よわい 102・11・7、つよい-よわい 107・4・9、4人 93・15・12、102・11・7。1手の最長は 2人の読み切りの始めの手で約0.2〜0.35秒（一時的に約44MB）、3〜4人 28ms
const LEVEL = { weak: { slip: 0.4 }, normal: { slip2: 0.2, slip: 0.1, tries: 40 }, strong: { slip2: 0, slip: 0, tries: 300 } };
function weakPick(s) {
  const moves = legalOf(s);
  const good = [];
  const safe = [];
  for (const i of moves) {
    if (s.zones[i].length === CAP - 1) {
      const w = ownerOf(s.n, [...s.zones[i], s.turn]);
      if (w === s.turn) good.push(i);
    } else safe.push(i);
  }
  return good.length ? good : safe.length ? safe : moves;
}
// 一斉に置く: 手ごとに「この回のほかの人の選びは空いた陣地から適当（実際の選びは見ない）、そのあとも全員が適当に選んで最後まで行く」試しを tries 回して、
// 自分の点 − ほかの人でいちばん多い人の点の平均がいちばん良い手
function rolloutTog(s, tries) {
  const { cnt: c0, len: l0 } = countsOf(s);
  const moves = legalOf(s);
  const n = s.n;
  const me = s.turn;
  let bestV = -Infinity;
  let top = [];
  for (const m of moves) {
    let sum = 0;
    for (let t = 0; t < tries; t++) {
      const cnt = c0.map((c) => c.slice());
      const len = l0.slice();
      const pick = new Array(n);
      const many = new Array(ZONES);
      for (let first = true; ; first = false) {
        const open = [];
        for (let i = 0; i < ZONES; i++) if (len[i] < CAP) open.push(i);
        if (!open.length) break;
        many.fill(0);
        for (let p = 0; p < n; p++) { pick[p] = first && p === me ? m : open[Math.floor(Math.random() * open.length)]; many[pick[p]]++; }
        for (let i = 0; i < ZONES; i++) if (many[i] > CAP - len[i]) { len[i] = CAP; many[i] = -1; } // 空きより多く来たら締め切り（石は入らない）
        for (let p = 0; p < n; p++) { const z = pick[p]; if (many[z] > 0) { cnt[z][p]++; len[z]++; } }
      }
      const sc = s.bonus.slice();
      for (let i = 0; i < ZONES; i++) { const w = winnerOfCnt(cnt[i]); if (w >= 0) sc[w] += s.pts[i]; }
      let other = -Infinity;
      for (let p = 0; p < n; p++) if (p !== me && sc[p] > other) other = sc[p];
      sum += sc[me] - other;
    }
    const v = sum / tries;
    if (v > bestV) { bestV = v; top = [m]; } else if (v === bestV) top.push(m);
  }
  return top;
}
// 一斉に置くの強さ: よわい 4割は適当・ほかは試し6回、ふつう 1割は適当・試し40回、つよい 試し300回
const LEVEL_TOG = { weak: { slip: 0.4, tries: 6 }, normal: { slip: 0.1, tries: 40 }, strong: { slip: 0, tries: 300 } };

function tasuuCpu(s, rules) {
  const moves = legalOf(s);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  if (moves.length === 1) return moves[0];
  if (s.tog) {
    const lt = LEVEL_TOG[rules?.cpu] ?? LEVEL_TOG.weak;
    return Math.random() < lt.slip ? pick(moves) : pick(rolloutTog(s, lt.tries));
  }
  const lv = LEVEL[rules?.cpu] ?? LEVEL.weak;
  if (Math.random() < (s.n === 2 && lv.slip2 !== undefined ? lv.slip2 : lv.slip)) return pick(moves);
  if (!lv.tries) return pick(weakPick(s));
  return pick(s.n === 2 ? best2(s) : rollout(s, lv.tries));
}

// 形勢（2人の観戦の帯・ふりかえり）: 読み切りの点の差（おまけ点を入れる）を、1番手から見た −100〜100 にする（Math.random を使わない）
function judge2(s) {
  if (s.n !== 2 || s.tog) return null; // 一斉に置くは読み切れない（同時に選ぶため）
  const sc = scoresOf(s);
  const res = s.moves >= ZONES * CAP;
  if (res) return sc[0] === sc[1] ? 0 : sc[0] > sc[1] ? 100 : -100;
  const rest = solve2(s).rest * (s.turn === 0 ? 1 : -1); // 1番手から見たこれからの点の差
  const d = sc[0] - sc[1] + rest;
  return d === 0 ? 0 : judgeOf(d, 4);
}

const fullOf = (s) => s.zones.every((_, i) => doneAt(s, i)); // 全部の陣地が埋まるか締め切った

function applyMove(s0, z) {
  if (!Number.isInteger(z) || z < 0 || z >= ZONES || !s0.zones[z] || doneAt(s0, z)) return null;
  if (s0.tog) {
    if (fullOf(s0)) return null;
    const pend = s0.pend.slice();
    pend[s0.turn] = z;
    const next = pend.indexOf(null);
    if (next >= 0) return { ...s0, pend, turn: next };
    // 全員そろった: 同時に開いて置く
    const zones = s0.zones.slice();
    const shut = s0.shut.slice();
    const got = placeRound(zones, shut, pend, s0.n);
    const placed = got.filter(Boolean).length;
    return { ...s0, zones, shut, pend: new Array(s0.n).fill(null), turn: 0, rev: { picks: pend, got }, moves: s0.moves + placed };
  }
  const zones = s0.zones.slice();
  zones[z] = [...zones[z], s0.turn];
  return { ...s0, zones, turn: (s0.turn + 1) % s0.n, last: z, moves: s0.moves + 1 };
}

export default {
  id: 'tasuu',
  name: '多数決の陣地',
  icon: '🗳️',
  desc: '点の付いた陣地に交代で石を置き、埋まったらいちばん多く置いた人が点を取る。2〜4人',
  ready: true,
  keepColor: true, // 続けて遊ぶ間は、その人の色を変えない（util.js の col）
  players: ['赤', '青', '緑', '紫'],
  seatCount(rules) { return rules?.players ?? 2; },
  settings: [
    { key: 'players', label: '人数', desc: '順番に石を置く人数（石は全部で25個）', def: 2, choices: [[2, '2人'], [3, '3人'], [4, '4人']] },
    { key: 'together', label: '一斉に置く', desc: '1回ごとに全員がこっそり陣地を選び、そろったら同時に開いて置く（おまけ点なし）。入りきらない陣地は、その回の「先に入る人」から入れる', def: false, choices: [[false, 'なし'], [true, 'あり']] },
    TAP_PEEK_SETTING,
    CPU_SETTING,
  ],
  noPeek(rules) { return rules?.together === true; }, // 一斉に置くときは「相手の迷いを見せる」を使わない（main.js の peekOn）
  // 2回押して置くの薄い石（main.js の ghostOne）を、回がそろう手では出さない（当てた局面にはほかの人の選びが開いているため）
  noGhost(s) { return !!s.tog && s.pend.filter((x) => x === null).length === 1; },

  cpu(s, p, rules) { return tasuuCpu(s, rules); },
  judge(s) { return judge2(s); },

  init({ rules = {}, seed = 0 } = {}) {
    const n = [2, 3, 4].includes(rules.players) ? rules.players : 2;
    const pts = shuffle(POINTS, mulberry32((seed ^ 0x7a50) >>> 0));
    const s = { n, pts, bonus: BONUS[n].slice(), zones: Array.from({ length: ZONES }, () => []), turn: 0, last: null, moves: 0 };
    return rules.together === true ? { ...s, bonus: new Array(n).fill(0), tog: true, pend: new Array(n).fill(null), shut: new Array(ZONES).fill(false), rev: null } : s;
  },

  turn(s) { return s.turn; },

  apply(s0, z) { return applyMove(s0, z); },

  result(s) {
    if (s.tog ? !fullOf(s) : s.moves < ZONES * CAP) return null;
    const sc = scoresOf(s);
    const top = Math.max(...sc);
    const winners = sc.map((v, p) => (v === top ? p : -1)).filter((p) => p >= 0);
    return { winner: winners.length === 1 ? winners[0] : null, cells: [], scores: sc }; // scores: 成績表の順位で点・表彰台（3〜4人）
  },

  info(s) {
    const sc = scoresOf(s);
    return sc.map((v, p) => `<b class="pl p${col(p)}">${this.players[col(p)]} <span data-roll="tsu${p}" data-v="${v}">${v}</span>点</b>`
      + (s.bonus[p] ? `<small class="tsu-bonus">おまけ${s.bonus[p]}</small>` : '')
      + (s.tog && !this.result(s) ? `<small class="tsu-pick">${s.pend[p] !== null ? '✓' : '…'}</small>` : '')).join('　')
      + (s.tog ? this.bounceText(s) : '');
  },

  // 一斉に置く: 直前に開いた回で、空きより多く来て締め切った陣地（だれの石がはじかれたか）
  bounceText(s) {
    if (!s.rev) return '';
    const out = [];
    for (let i = 0; i < ZONES; i++) {
      const who = s.rev.picks.map((z, p) => (z === i && !s.rev.got[p] ? p : -1)).filter((p) => p >= 0);
      if (who.length) out.push(`${s.pts[i]}点の陣地に ${who.map((p) => this.players[col(p)]).join('・')} が重なって締め切り`);
    }
    return out.length ? `<br><small>${out.join('／')}</small>` : '';
  },

  render(root, s, o) {
    root.innerHTML = '';
    root.className = 'board tsu';
    const quiet = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const res = this.result(s);
    const sc = scoresOf(s);
    const top = res ? Math.max(...sc) : null;
    const row = document.createElement('div');
    row.className = 'tsu-row';
    const me = Number.isInteger(o.me) && o.me >= 0 ? o.me : null;
    const mine = s.tog && me !== null ? s.pend[me] : null; // 一斉に置く: この回の自分の選び（自分の画面にだけ薄く出す）
    s.zones.forEach((z, i) => {
      const w = ownerOf(s.n, z, !!s.shut?.[i]);
      const c = countIn(s.n, z);
      // 一斉に置く: 直前に開いた回で、この陣地に入った石の数・この陣地が開いた回に選ばれたか
      const fresh = s.tog && o.fresh && s.rev ? s.rev.picks.filter((x, p) => x === i && s.rev.got[p]).length : 0;
      const hit = s.tog && o.fresh && !!s.rev && s.rev.picks.includes(i);
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'tsu-zone' + (w !== null ? (w >= 0 ? ` won p${col(w)}` : ' tie') : '')
        + (w !== null && w >= 0 && res && sc[w] === top ? ' win' : '') + ((o.fresh && s.last === i) || hit ? (w !== null ? ' just' : '') : '')
        + (s.shut?.[i] ? ' shut' : '') + (hit && s.shut?.[i] && fresh === 0 && s.rev.picks.filter((x) => x === i).length ? ' bounce' : '');
      // 点の札
      const pt = document.createElement('div');
      pt.className = 'tsu-pt';
      pt.textContent = s.pts[i];
      box.append(pt);
      // 数比べ（2026-11-27 の UI・UX の14回目）: 決まった陣地の石は人ごとの列に並べて出す。いま決まった陣地は、置き場の形で描いてから列へ並べ替える（regroupLater）
      const justDone = w !== null && !quiet && ((o.fresh && s.last === i && !s.tog) || hit);
      if (w !== null && !justDone) box.append(groupEl(s.n, z, w));
      else {
      // 石の置き場（下から順に積む。空きも描く。2回押しの薄い石はこの空きに入る）
      const slots = document.createElement('div');
      slots.className = 'tsu-slots';
      const stoneEls = [];
      for (let k = CAP - 1; k >= 0; k--) {
        const sl = document.createElement('span');
        sl.className = 'tsu-slot';
        if (k < z.length) {
          const st = document.createElement('span');
          const last = s.last === i && k === z.length - 1;
          const isNew = k >= z.length - fresh; // 一斉に置く: この回に入った石（せーので落ちる）
          const pop = (last && o.fresh) || isNew;
          st.className = 'tsu-stone p' + col(z[k]) + (last ? ' last' : '') + (pop ? (isNew && !quiet ? ' drop' : ' pop') : '');
          if (last) st.dataset.last = '';
          sl.append(st);
          stoneEls[k] = st;
        } else if (mine === i && k === z.length) {
          const st = document.createElement('span');
          st.className = 'tsu-stone pend p' + col(me);
          sl.append(st);
        }
        slots.append(sl);
      }
      box.append(slots);
      if (justDone) regroupLater(box, slots, stoneEls, z, s.n, w, pt, hit ? 1250 : 450); // 一斉に置く回は石が落ちてから
      }
      // 一斉に置く: 重なってはじかれた石は、陣地の上に浮かんでから寄ってぶつかり、弾け飛ぶ（せーので落ちる。同じ14回目）
      if (hit && !quiet) {
        const out = s.rev.picks.map((x, p) => (x === i && !s.rev.got[p] ? p : -1)).filter((p) => p >= 0);
        out.forEach((p, k) => {
          const b = document.createElement('span');
          b.className = 'tsu-stone tsu-burst p' + col(p);
          b.setAttribute('aria-hidden', 'true');
          b.style.setProperty('--sx', `${(k - (out.length - 1) / 2) * 26}px`);
          b.style.setProperty('--dir', k < (out.length - 1) / 2 ? -1 : 1);
          box.append(b);
        });
      }
      // 席ごとの数（いちばん多い人が分かるように）と、決まったあとの持ち主
      const tally = document.createElement('div');
      tally.className = 'tsu-tally';
      if (w !== null) tally.textContent = (s.shut?.[i] ? '締め切り・' : '') + (w >= 0 ? `${this.players[col(w)]}の陣地` : 'だれも取らない');
      else if (z.length) {
        const mx = Math.max(...c);
        tally.innerHTML = c.map((v, p) => (v ? `<b class="p${col(p)}${v === mx ? ' lead' : ''}">${v}</b>` : '')).filter(Boolean).join('');
      }
      box.append(tally);
      if (box.classList.contains('bounce') && !quiet) box.style.animationDelay = '.85s'; // はじかれた石がぶつかるときに揺れる
      box.setAttribute('aria-label', `${s.pts[i]}点の陣地（石 ${z.length}/${CAP}）`);
      if (o.canMove && w === null) {
        box.classList.add('playable', 'p' + col(s.turn));
        box.onclick = () => o.onMove(i);
      } else {
        box.tabIndex = -1;
        box.disabled = w !== null;
      }
      row.append(box);
    });
    root.append(row);
  },
};
