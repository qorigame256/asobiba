// 麻雀（リーチ麻雀）。4人・3人・5人。役・符・点数・向聴数は mahjong-engine.js（本人が別に作っている麻雀アプリ＝元のアプリのエンジンを写したもの）。
//
// 決めごと（本人の判断・2026-10-03）: 元のアプリの通常ルールを流用し、作りはシンプルに。
//   長さは東風戦・半荘戦を詳細設定で選ぶ。3人麻雀も詳細設定で選ぶ。鳴き・ロンはできる人だけに聞き、答えるまで待つ
//   （2026-10-04 本人の決定で、前の「10秒で自動で見送る」をやめた。古い手の一覧の timeout は当て直しのため受け付ける）。
//   省いたもの: 途中流局（九種九牌・四風連打）・流し満貫・責任払い・延長戦・ウマとオカ・ダブロン（打った人に近い1人だけ和了）。
// 元のアプリから写した決めごと: 喰いタン・後付けあり、一発・裏ドラ（リーチした人だけ）・カンドラ（カンしたその場でめくる）、
//   赤ドラ（4人は五萬・五筒・五索を1枚ずつ、3人は五筒・五索）、喰い替え禁止（ポンは現物、チーは現物と筋）、
//   フリテン（捨て牌・同巡・リーチ後。ツモ和了は止めない）、形式聴牌・空聴も聴牌、リーチは聴牌のときだけ・海底ではできない、
//   リーチ後はツモ切りだけ（待ちが変わらない暗槓はできる・加槓はできない）、カンは1局4回まで、山が0枚なら鳴けない（ロンだけ）、
//   人和は役満、オーラスの親がトップで和了したら終わり（アガリやめ）、0点未満でトビ終了、ノーテン罰符は4人3000点・3人2000点、
//   本場は1本300点（3人は200点）、持ち点は4人25000点・3人35000点。
//   3人麻雀: 二萬〜八萬を抜いた108枚、チーなし、北は抜きドラ（抜いた北1枚で1翻）と役牌、ツモ損（いない北家の分は誰も払わない）、
//   ドラ表示牌が一萬なら九萬・九萬なら一萬がドラ。
// 5人麻雀（2026-10-05 本人の決定）: 5人が同時に1つの卓を囲む。親から数えて5人目は自風なし。ツモは4人麻雀と同じ1人あたりの額を
//   ほかの4人が払う。卓は五角形（5人を72度ずつ回して置く）。Claude の推奨を本人が承認したもの: 持ち点25000点・東風戦は5局・
//   チーは上家からだけ・ノーテン罰符3000点・136枚で王牌14枚。
// 詳細設定（2026-10-06 本人の決定）: 「赤ドラ」なしでは赤い五も普通の五として描き、ドラに数えない。「喰いタン」なしでは鳴いた手（暗槓だけは鳴いていない扱い）の断幺九を付けない。
//   どちらも最初は「あり」。喰いタンなしは mahjong-engine.js を変えずに、ここで候補からタンヤオを外して一番高い形を選び直す（noKuitanBest）。
// 詳細設定「待ち牌の表示」（2026-10-07 本人の決定。最初は「なし」）: 聴牌している間、自分の手牌の上の段に待ちの牌（フリテンなら「フリテン」も）を出す。
//   自分の番で切る前は、選んだ牌を切ったときの待ちを出す（Claude の判断）。見せるだけで、手の一覧・apply は変えない（waitView・waitsEl）。
// Claude の判断: 暗槓への国士無双のロンは作らない（ごくまれなため）。抜いた北へのロンはできる（槍槓は付かない）。
//   リーチ中で和了れない・カンできないときは1秒で自動でツモ切りする。局の結果は全員が「次へ」を押すか30秒で次の局へ。
//
// 牌は 0〜135 の番号（種類 = 番号 ÷ 4。赤ドラは 16・52・88）。手は必ず「いまの手順番号 n」を持ち、古い手は弾く
// （同時に動くゲームなので、ぶつかった手をホストが後ろに足し直しても2回目は反則になる）。

import { mulberry32, shuffle } from './util.js';
import * as E from './mahjong-engine.js';

const RED_IDS = new Set([16, 52, 88]);
const isRed = (s, id) => s.rules.red !== false && RED_IDS.has(id);
const TANYAO = E.YAKU_NAMES.indexOf('断幺九');
const kindOf = (id) => id >> 2;
const END_MS = 30000;
const AUTO_MS = 1000;

/* ---------- 局の始まりと山 ---------- */

function startHand(s) {
  const rng = mulberry32((s.seed ^ Math.imul(s.handNo + 1, 0x9e3779b1)) >>> 0);
  const ids = [];
  for (let id = 0; id < 136; id++) if (!(s.n === 3 && kindOf(id) >= 1 && kindOf(id) <= 7)) ids.push(id);
  const wall = shuffle(ids, rng);
  const n = s.n;
  const dealer = s.kyoku % n;
  const h = {
    wall, L: wall.length, draw: 0, rinshan: 0, kans: 0,
    hands: Array.from({ length: n }, () => []), melds: Array.from({ length: n }, () => []), nuki: Array.from({ length: n }, () => []),
    rivers: Array.from({ length: n }, () => []), riichi: Array(n).fill(0), ippatsu: Array(n).fill(false),
    furitenTemp: Array(n).fill(false), furitenRiichi: Array(n).fill(false), waits: Array(n).fill(null),
    discards: Array(n).fill(0), draws: Array(n).fill(0), noCalls: true,
    turn: dealer, phase: 'turn', drawn: null, afterKan: false, kuikae: [], claim: null, riichiPending: null,
    end: null, acks: [],
  };
  for (let r = 0; r < 13; r++) for (let i = 0; i < n; i++) h.hands[(dealer + i) % n].push(wall[h.draw++]);
  s.h = h;
  for (let p = 0; p < n; p++) h.waits[p] = waitsOf(s, p);
  beginTurn(s, dealer, false);
}

const liveLeft = (h) => h.L - 14 - h.rinshan - h.draw;
// ドラ表示牌（i 番目）と裏ドラ表示牌。山の末尾から並べる
const doraInd = (h, i) => h.wall[h.L - 1 - 2 * i];
const uraInd = (h, i) => h.wall[h.L - 2 - 2 * i];

function drawTile(h, rinshan) {
  if (rinshan) return h.wall[h.L - 11 - h.rinshan++];
  if (liveLeft(h) <= 0) return null;
  return h.wall[h.draw++];
}

function beginTurn(s, p, rinshan) {
  const h = s.h;
  const t = drawTile(h, rinshan);
  if (t === null) { exhaustiveDraw(s); return; }
  h.hands[p].push(t);
  h.draws[p]++;
  h.turn = p;
  h.phase = 'turn';
  h.drawn = t;
  h.afterKan = rinshan;
  h.kuikae = [];
  h.claim = null;
  h.furitenTemp[p] = false; // 同巡フリテンは自分のツモ番で解ける
  s.seq++;
}

/* ---------- 手の形 ---------- */

const countsOf = (ids) => {
  const c = Array(E.KINDS).fill(0);
  for (const id of ids) c[kindOf(id)]++;
  return c;
};
function engineMelds(melds) {
  return melds.map((m) => {
    const k = Math.min(...m.tiles.map(kindOf));
    if (m.type === 'chi') return { type: E.SHUNTSU, first: k, open: true };
    if (m.type === 'pon') return { type: E.KOUTSU, first: k, open: true };
    return { type: E.KANTSU, first: k, open: m.type !== 'ankan' };
  });
}
const isMenzen = (h, p) => h.melds[p].every((m) => m.type === 'ankan');

// 13枚（と副露）の待ちの種類。聴牌でなければ []
function waitsOf(s, p) {
  const h = s.h;
  const c = countsOf(h.hands[p]);
  if (E.shanten(c, h.melds[p].length) !== 0) return [];
  const fixed = engineMelds(h.melds[p]);
  const out = [];
  for (let k = 0; k < E.KINDS; k++) {
    if (s.n === 3 && k >= 1 && k <= 7) continue;
    c[k]++;
    if (E.decompose(c, fixed).length) out.push(k);
    c[k]--;
  }
  return out;
}

const roundWind = (s) => E.EAST + Math.floor(s.kyoku / s.n);
const dealerOf = (s) => s.kyoku % s.n;
// 5人麻雀の5人目は自風なし（-1 はどの牌の種類とも一致しないので、自風の役も雀頭の符も付かない）
const seatWind = (s, p) => { const i = (p - dealerOf(s) + s.n) % s.n; return i < 4 ? E.EAST + i : -1; };

// 和了れるなら点数の結果、和了れないなら null。tile = ロンの牌（ツモなら null。手にもう入っている）
function winResult(s, p, tile, { tsumo = false, chankan = false } = {}) {
  const h = s.h;
  const ids = tile === null ? h.hands[p] : [...h.hands[p], tile];
  const win = tile === null ? h.drawn : tile;
  if (win === null || win === undefined) return null;
  const c = countsOf(ids);
  const fixed = engineMelds(h.melds[p]);
  const last = liveLeft(h) <= 0;
  const first = h.noCalls && h.discards[p] === 0;
  const dealer = p === dealerOf(s);
  const ctx = {
    tsumo, roundWind: roundWind(s), seatWind: seatWind(s, p), riichi: h.riichi[p] === 1, doubleRiichi: h.riichi[p] === 2,
    ippatsu: h.ippatsu[p], rinshan: tsumo && h.afterKan, chankan, haitei: tsumo && last && !h.afterKan, houtei: !tsumo && !chankan && last,
    tenho: tsumo && dealer && first, chiho: tsumo && !dealer && first, renho: !tsumo && !dealer && first && h.draws[p] === 0,
    northYakuhai: s.n === 3,
  };
  const all = [...ids, ...h.melds[p].flatMap((m) => m.tiles), ...h.nuki[p]];
  const sanma = s.n === 3;
  const count = (indicators) => indicators.reduce((a, ind) => a + all.filter((id) => kindOf(id) === E.doraKind(kindOf(ind), sanma)).length, 0);
  const inds = Array.from({ length: 1 + h.kans }, (_, i) => doraInd(h, i));
  const uras = h.riichi[p] ? Array.from({ length: 1 + h.kans }, (_, i) => uraInd(h, i)) : [];
  const dora = { dora: count(inds), ura: count(uras), red: all.filter((id) => isRed(s, id)).length, nuki: h.nuki[p].length };
  const doraHan = dora.dora + dora.ura + dora.red + dora.nuki;
  const open = h.melds[p].some((m) => m.type !== 'ankan');
  const r = s.rules.kuitan === false && open ? noKuitanBest(c, fixed, kindOf(win), ctx, doraHan) : E.bestHand(c, fixed, kindOf(win), ctx, doraHan);
  return r ? { ...r, dora, ura: uras, ctx } : null;
}

// 喰いタンなしの和了の形: E.bestHand と同じ選び方で、役の一覧から断幺九を外したもの
function noKuitanBest(concealed, fixed, win, ctx, doraHan) {
  let best = null;
  for (const c of E.candidates(concealed, fixed, win, ctx)) {
    const yaku = c.yaku.filter((y) => y.id !== TANYAO);
    if (!yaku.length) continue;
    const r = { shape: c.shape, placement: c.placement, yaku, han: 0, fu: 0, base: 0, yakumanCount: 0 };
    let ymHan = 0;
    for (const y of yaku) { if (y.yakuman) ymHan += y.han; else r.han += y.han; }
    if (ymHan) { r.han = ymHan + doraHan; } else { r.han += doraHan; r.fu = E.evaluateFu(c.shape, c.placement, ctx, yaku); }
    r.base = E.basePoints(r.han, r.fu);
    if (r.han >= E.YAKUMAN_HAN) r.yakumanCount = Math.floor(r.han / E.YAKUMAN_HAN);
    if (!best || r.base > best.base || (r.base === best.base && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))) best = r;
  }
  return best;
}

const furiten = (s, p) => {
  const h = s.h;
  return h.furitenTemp[p] || h.furitenRiichi[p] || h.rivers[p].some((x) => h.waits[p].includes(kindOf(x.id)));
};

// 詳細設定「待ち牌の表示」で自分の画面に出す中身（見せるだけ。局面は変えない）。
// 13枚の形（打ったあと・ほかの人の番）は局面に入っている待ち（h.waits）。リーチ中も切る牌が決まっているので同じ。
// 14枚の形（自分の番で切る前）は、選んだ牌 sel を切ったときの待ちを waitsOf で数え直す（選んでいなければ出さない）。
// 戻り値は { kinds: 待ちの牌の種類（聴牌でなければ []）, furiten, after: 選んだ牌を切ったときの待ちか }
function waitView(s, p, sel = null) {
  const h = s.h;
  if (h.hands[p].length % 3 === 1 || h.riichi[p]) {
    const kinds = h.waits[p].slice();
    return { kinds, furiten: kinds.length > 0 && furiten(s, p), after: false };
  }
  if (sel === null || !h.hands[p].includes(sel)) return { kinds: [], furiten: false, after: false };
  const t = { ...s, h: { ...h, hands: h.hands.slice() } };
  t.h.hands[p] = h.hands[p].filter((id) => id !== sel);
  const kinds = waitsOf(t, p);
  // 切った牌も河に入る。同巡フリテンは自分のツモ（か鳴き）で解けているので、河と切る牌だけを見る
  const gone = [...h.rivers[p].map((x) => kindOf(x.id)), kindOf(sel)];
  return { kinds, furiten: kinds.some((k) => gone.includes(k)), after: true };
}

/* ---------- できること ---------- */

function turnOptions(s) {
  const h = s.h;
  const p = h.turn;
  const c = countsOf(h.hands[p]);
  const o = { tsumo: false, ankan: [], kakan: [], nuki: false, riichi: [] };
  if (h.drawn !== null && winResult(s, p, null, { tsumo: true })) o.tsumo = true;
  const canKan = h.drawn !== null && liveLeft(h) > 0 && h.kans < 4;
  for (let k = 0; k < E.KINDS; k++) {
    if (canKan && c[k] === 4) {
      if (!h.riichi[p]) o.ankan.push(k);
      else if (kindOf(h.drawn) === k) {
        // リーチ後は、ツモった牌で待ちが変わらないときだけ
        const t = { ...s, h: { ...h, hands: h.hands.slice(), melds: h.melds.slice() } };
        t.h.hands[p] = h.hands[p].filter((id) => kindOf(id) !== k);
        t.h.melds[p] = [...h.melds[p], { type: 'ankan', tiles: h.hands[p].filter((id) => kindOf(id) === k) }];
        const before = h.waits[p].join();
        if (before && waitsOf(t, p).join() === before) o.ankan.push(k);
      }
    }
    if (canKan && !h.riichi[p] && c[k] >= 1 && h.melds[p].some((m) => m.type === 'pon' && kindOf(m.tiles[0]) === k)) o.kakan.push(k);
  }
  if (s.n === 3 && h.drawn !== null && liveLeft(h) > 0 && c[E.NORTH] > 0 && (!h.riichi[p] || kindOf(h.drawn) === E.NORTH)) o.nuki = true;
  const seen = new Set();
  for (const id of h.hands[p]) {
    if (seen.has(kindOf(id))) continue;
    seen.add(kindOf(id));
    if (canRiichi(s, id)) o.riichi.push(kindOf(id));
  }
  return o;
}

// この牌を切ってリーチできるか（門前・山が残っている・切ったあと聴牌）
function canRiichi(s, id) {
  const h = s.h;
  const p = h.turn;
  if (h.riichi[p] || !isMenzen(h, p) || liveLeft(h) <= 0 || !canDiscard(s, id)) return false;
  return E.shanten(countsOf(h.hands[p].filter((x) => x !== id)), h.melds[p].length) === 0;
}

// 局面の写し。山は変えないので共有する。ほかの配列は手を受け付けるたびに書き換えるので写す
function clone(s) {
  const h = s.h;
  return {
    ...s, scores: s.scores.slice(),
    h: {
      ...h, hands: h.hands.map((x) => x.slice()), melds: h.melds.map((x) => x.slice()), nuki: h.nuki.map((x) => x.slice()),
      rivers: h.rivers.map((x) => x.slice()), riichi: h.riichi.slice(), ippatsu: h.ippatsu.slice(), furitenTemp: h.furitenTemp.slice(),
      furitenRiichi: h.furitenRiichi.slice(), waits: h.waits.slice(), discards: h.discards.slice(), draws: h.draws.slice(),
      acks: h.acks.slice(), claim: h.claim && { ...h.claim, responses: { ...h.claim.responses } },
    },
  };
}

// 打てる牌か（リーチ後のツモ切り・喰い替え）
function canDiscard(s, id) {
  const h = s.h;
  const p = h.turn;
  if (!h.hands[p].includes(id)) return false;
  if (h.riichi[p]) return id === h.drawn;
  return !h.kuikae.includes(kindOf(id));
}

// 捨て牌（と加槓・抜き）に誰が何をできるか。{ 席: ['ron', 'pon', 'kan', 'chi'] }、チーの組み合わせは chiOptions
function claimOptions(s, from, id, src) {
  const h = s.h;
  const k = kindOf(id);
  const out = {};
  for (let i = 1; i < s.n; i++) {
    const q = (from + i) % s.n;
    const acts = [];
    if (h.waits[q].includes(k)) {
      if (!furiten(s, q) && winResult(s, q, id, { chankan: src === 'kakan' })) acts.push('ron');
    }
    if (src === 'discard' && !h.riichi[q] && liveLeft(h) > 0) {
      const c = countsOf(h.hands[q]);
      if (c[k] >= 2) acts.push('pon');
      if (c[k] >= 3 && h.kans < 4) acts.push('kan');
      if (s.n !== 3 && i === 1 && chiOptions(s, q, id).length) acts.push('chi');
    }
    if (acts.length) out[q] = acts;
  }
  return out;
}

// チーに使う手の2枚の組（赤でない牌から先に使う）。喰い替えで打てる牌が無くなる組は出さない
function chiOptions(s, q, id) {
  const h = s.h;
  const k = kindOf(id);
  if (E.isHonor(k)) return [];
  const num = E.numberOf(k);
  const out = [];
  for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
    if (num + a < 1 || num + b > 9) continue;
    const ta = pickTile(h.hands[q], k + a);
    const tb = pickTile(h.hands[q], k + b);
    if (ta === null || tb === null) continue;
    const ban = kuikaeKinds('chi', k, [k + a, k + b]);
    const rest = h.hands[q].filter((x) => x !== ta && x !== tb);
    if (rest.some((x) => !ban.includes(kindOf(x)))) out.push([ta, tb]);
  }
  return out;
}
const pickTile = (hand, k) => {
  const xs = hand.filter((id) => kindOf(id) === k);
  return xs.find((id) => !RED_IDS.has(id)) ?? xs[0] ?? null;
};
function kuikaeKinds(type, k, uses) {
  if (type !== 'chi') return [k];
  const lo = Math.min(...uses);
  const hi = Math.max(...uses);
  const ban = [k];
  if (k < lo && hi + 1 <= Math.floor(k / 9) * 9 + 8) ban.push(hi + 1); // 6 を 45 で → 3 も（下の筋）
  if (k > hi && lo - 1 >= Math.floor(k / 9) * 9) ban.push(lo - 1);
  return ban;
}

/* ---------- 進行 ---------- */

function discard(s, id, riichi) {
  const h = s.h;
  const p = h.turn;
  h.hands[p] = h.hands[p].filter((x) => x !== id);
  h.rivers[p].push({ id, riichi: !!riichi, taken: false, tsumogiri: id === h.drawn });
  if (h.riichi[p]) h.ippatsu[p] = false; // 一発はリーチ後の1巡だけ
  if (riichi) h.riichiPending = { p, double: h.noCalls && h.discards[p] === 0 };
  h.discards[p]++;
  h.drawn = null;
  h.afterKan = false;
  h.waits[p] = waitsOf(s, p);
  openClaim(s, p, id, 'discard');
}

function openClaim(s, from, id, src) {
  const h = s.h;
  const options = claimOptions(s, from, id, src);
  // 待ちの牌を見送った人はフリテン（役が無くてロンできなかったときも）
  for (let q = 0; q < s.n; q++) {
    if (q === from || !h.waits[q].includes(kindOf(id))) continue;
    h.furitenTemp[q] = true;
    if (h.riichi[q]) h.furitenRiichi[q] = true;
  }
  if (!Object.keys(options).length) { afterClaim(s, from, id, src); return; }
  h.phase = 'claim';
  h.claim = { from, id, src, options, responses: {} };
  s.seq++;
}

function finishRiichi(s) {
  const h = s.h;
  const r = h.riichiPending;
  if (!r) return;
  h.riichiPending = null;
  h.riichi[r.p] = r.double ? 2 : 1;
  h.ippatsu[r.p] = true;
  s.scores[r.p] -= 1000;
  s.kyotaku++;
}

const callMade = (h) => { h.ippatsu.fill(false); h.noCalls = false; };

// 誰も鳴かなかった・ロンしなかったとき
function afterClaim(s, from, id, src) {
  const h = s.h;
  h.claim = null;
  finishRiichi(s);
  if (src === 'kakan') { h.kans++; beginTurn(s, from, true); return; }
  if (src === 'nuki') { beginTurn(s, from, true); return; }
  if (liveLeft(h) <= 0) { exhaustiveDraw(s); return; }
  beginTurn(s, (from + 1) % s.n, false);
}

function resolveClaim(s) {
  const h = s.h;
  const { from, id, src, responses } = h.claim;
  for (let i = 1; i < s.n; i++) { // ロンは打った人に近い1人だけ（ダブロンなし）
    const q = (from + i) % s.n;
    if (responses[q]?.a === 'ron') {
      settleWin(s, q, from, winResult(s, q, id, { chankan: src === 'kakan' }));
      return;
    }
  }
  const caller = Object.keys(responses).map(Number).find((q) => ['pon', 'kan'].includes(responses[q].a))
    ?? Object.keys(responses).map(Number).find((q) => responses[q].a === 'chi');
  if (caller === undefined) { afterClaim(s, from, id, src); return; }
  finishRiichi(s);
  const r = responses[caller];
  const k = kindOf(id);
  let uses;
  if (r.a === 'chi') uses = r.c;
  else {
    const mine = h.hands[caller].filter((x) => kindOf(x) === k).sort((a, b) => RED_IDS.has(a) - RED_IDS.has(b));
    uses = mine.slice(0, r.a === 'kan' ? 3 : 2);
  }
  h.hands[caller] = h.hands[caller].filter((x) => !uses.includes(x));
  const river = h.rivers[from];
  river[river.length - 1] = { ...river[river.length - 1], taken: true };
  h.melds[caller].push({ type: r.a === 'kan' ? 'minkan' : r.a, tiles: [...uses, id], called: id, from });
  callMade(h);
  h.furitenTemp[caller] = false;
  h.claim = null;
  if (r.a === 'kan') { h.kans++; beginTurn(s, caller, true); return; }
  h.turn = caller;
  h.phase = 'turn';
  h.drawn = null;
  h.afterKan = false;
  h.kuikae = kuikaeKinds(r.a, k, uses.map(kindOf));
  s.seq++;
}

/* ---------- 局の終わり ---------- */

function settleWin(s, w, from, r) {
  const h = s.h;
  const dealer = dealerOf(s);
  const deltas = Array(s.n).fill(0);
  const tsumo = from === null;
  if (tsumo) {
    const [fd, fo] = E.tsumoPayment(r, w === dealer, s.honba);
    for (let q = 0; q < s.n; q++) if (q !== w) { const pay = q === dealer ? fd : fo; deltas[q] -= pay; deltas[w] += pay; }
  } else {
    const pay = E.ronPayment(r, w === dealer, s.honba, s.n);
    deltas[from] -= pay;
    deltas[w] += pay;
  }
  deltas[w] += s.kyotaku * 1000;
  s.kyotaku = 0;
  const yaku = r.yaku.map((y) => ({ name: E.yakuName(y), han: y.han, yakuman: y.yakuman }));
  // 役満にもドラは乗る（元のアプリの決まり）
  if (r.dora.dora) yaku.push({ name: 'ドラ', han: r.dora.dora });
  if (r.dora.red) yaku.push({ name: '赤ドラ', han: r.dora.red });
  if (r.dora.ura) yaku.push({ name: '裏ドラ', han: r.dora.ura });
  if (r.dora.nuki) yaku.push({ name: '抜きドラ', han: r.dora.nuki });
  finishHand(s, {
    type: tsumo ? 'tsumo' : 'ron', winner: w, from, deltas, yaku, han: r.han, fu: r.fu, limit: E.limitName(r),
    hand: h.hands[w].slice(), melds: h.melds[w].map((m) => m.tiles.slice()), win: tsumo ? h.drawn : h.claim.id,
    ura: r.ura.slice(), points: deltas[w],
  }, w === dealer, w);
}

function exhaustiveDraw(s) {
  const h = s.h;
  finishRiichi(s);
  const tenpai = Array.from({ length: s.n }, (_, p) => E.shanten(countsOf(h.hands[p]), h.melds[p].length) <= 0);
  const k = tenpai.filter(Boolean).length;
  const deltas = Array(s.n).fill(0);
  const pot = s.n === 3 ? 2000 : 3000;
  if (k > 0 && k < s.n) for (let p = 0; p < s.n; p++) deltas[p] = tenpai[p] ? pot / k : -pot / (s.n - k);
  finishHand(s, { type: 'draw', tenpai, deltas, hands: h.hands.map((x, p) => (tenpai[p] ? x.slice() : null)) }, tenpai[dealerOf(s)], null);
}

function finishHand(s, end, renchan, winner) {
  const h = s.h;
  end.deltas.forEach((d, p) => { s.scores[p] += d; });
  const last = s.rules.length === 'south' ? 2 * s.n - 1 : s.n - 1;
  const dealer = dealerOf(s);
  let over = s.scores.some((x) => x < 0); // トビ
  if (!over && s.kyoku === last && winner === dealer && s.scores[dealer] >= Math.max(...s.scores)) over = true; // アガリやめ
  const next = { kyoku: renchan ? s.kyoku : s.kyoku + 1, honba: end.type === 'draw' || renchan ? s.honba + 1 : 0 };
  if (!over && next.kyoku > last) over = true;
  end.over = over;
  end.next = next;
  end.title = handTitle(s);
  h.end = end;
  h.phase = 'end';
  h.claim = null;
  h.acks = [];
  s.seq++;
}

function proceed(s) {
  const end = s.h.end;
  s.handNo++;
  if (end.over) {
    s.over = true;
    // 順位: 持ち点の高い順。同点なら最後の局の親から数えた席順が前の人が上
    const dealer = dealerOf(s);
    s.ranking = [...Array(s.n).keys()].sort((a, b) => s.scores[b] - s.scores[a] || ((a - dealer + s.n) % s.n) - ((b - dealer + s.n) % s.n));
    s.seq++;
    return;
  }
  s.kyoku = end.next.kyoku;
  s.honba = end.next.honba;
  startHand(s);
}

const WIND_NAMES = ['東', '南', '西', '北', '－']; // 最後は5人麻雀の5人目（自風なし）
const handTitle = (s) => `${WIND_NAMES[Math.floor(s.kyoku / s.n)]}${(s.kyoku % s.n) + 1}局${s.honba ? ` ${s.honba}本場` : ''}`;

/* ---------- 手を受け付ける ---------- */

function applyMove(s0, m) {
  if (!m || typeof m !== 'object' || s0.over || m.n !== s0.seq) return null;
  const s = clone(s0);
  const h = s.h;
  const p = m.p;
  if (h.phase === 'end') {
    if (m.a === 'next' && p === -1) { proceed(s); return s; }
    if (m.a !== 'ok' || p < 0 || h.acks.includes(p)) return null;
    h.acks.push(p);
    if (h.acks.length === s.n) proceed(s);
    return s;
  }
  if (h.phase === 'claim') {
    const c = h.claim;
    if (m.a === 'timeout' && p === -1) {
      for (const q of Object.keys(c.options)) c.responses[q] ??= { a: 'pass' };
      resolveClaim(s);
      return s;
    }
    const acts = c.options[p];
    if (!acts || c.responses[p]) return null;
    if (m.a === 'chi') {
      if (!acts.includes('chi') || !Array.isArray(m.c) || !chiOptions(s, p, c.id).some(([a, b]) => a === m.c[0] && b === m.c[1])) return null;
    } else if (m.a !== 'pass' && !acts.includes(m.a)) return null;
    c.responses[p] = m.a === 'chi' ? { a: 'chi', c: m.c.slice() } : { a: m.a };
    // ロンが出たら、それより打った人に近い人がロンできる場合だけ待つ。ほかは全員の答えがそろうまで待つ
    const pending = Object.keys(c.options).map(Number).filter((q) => !c.responses[q]);
    const dist = (q) => (q - c.from + s.n) % s.n;
    const ron = Object.keys(c.responses).map(Number).filter((q) => c.responses[q].a === 'ron');
    if (!pending.length || (ron.length && pending.every((q) => !c.options[q].includes('ron') || dist(q) > Math.min(...ron.map(dist))))) resolveClaim(s);
    return s;
  }
  // 手番の手
  const auto = p === -1 && m.a === 'd' && h.riichi[h.turn] && m.t === h.drawn; // リーチ中の自動ツモ切り
  if (p !== h.turn && !auto) return null;
  const me = h.turn;
  if (m.a === 'tsumo') {
    const r = h.drawn !== null ? winResult(s, me, null, { tsumo: true }) : null;
    if (!r) return null;
    settleWin(s, me, null, r);
    return s;
  }
  if (m.a === 'd') {
    if (!canDiscard(s, m.t)) return null;
    if (m.r && !canRiichi(s, m.t)) return null;
    discard(s, m.t, !!m.r);
    return s;
  }
  const o = turnOptions(s);
  if (m.a === 'ankan') {
    if (!o.ankan.includes(m.k)) return null;
    const tiles = h.hands[me].filter((id) => kindOf(id) === m.k);
    h.hands[me] = h.hands[me].filter((id) => kindOf(id) !== m.k);
    h.melds[me].push({ type: 'ankan', tiles, called: null, from: null });
    h.kans++;
    callMade(h);
    h.waits[me] = waitsOf(s, me);
    beginTurn(s, me, true);
    return s;
  }
  if (m.a === 'kakan') {
    if (!o.kakan.includes(m.k)) return null;
    const id = h.hands[me].find((x) => kindOf(x) === m.k);
    h.hands[me] = h.hands[me].filter((x) => x !== id);
    const mi = h.melds[me].findIndex((x) => x.type === 'pon' && kindOf(x.tiles[0]) === m.k);
    h.melds[me][mi] = { ...h.melds[me][mi], type: 'kakan', tiles: [...h.melds[me][mi].tiles, id] };
    callMade(h);
    h.drawn = null;
    h.waits[me] = waitsOf(s, me);
    openClaim(s, me, id, 'kakan');
    return s;
  }
  if (m.a === 'nuki') {
    if (!o.nuki) return null;
    const id = h.riichi[me] ? h.drawn : h.hands[me].find((x) => kindOf(x) === E.NORTH);
    h.hands[me] = h.hands[me].filter((x) => x !== id);
    h.nuki[me].push(id);
    callMade(h);
    h.drawn = null;
    h.waits[me] = waitsOf(s, me);
    openClaim(s, me, id, 'nuki');
    return s;
  }
  return null;
}

/* ---------- CPU ---------- */

// テンパイに近づく牌を切る。向聴数が同じなら受け入れ（向聴数が下がる牌の残り枚数）が多いほう、その次に字牌・端の牌から切る。
// テンパイしたら門前ならリーチ。リーチした人がいて自分がまだ遠いときは、その人の捨て牌（安全な牌）を優先して切る。
function cpuTurn(s) {
  const h = s.h;
  const p = h.turn;
  const n = s.seq;
  const o = turnOptions(s);
  if (o.tsumo) return { a: 'tsumo', n };
  if (o.nuki && countsOf(h.hands[p])[E.NORTH] === 1) return { a: 'nuki', n };
  if (h.riichi[p]) return { a: 'd', t: h.drawn, n };
  const fixed = h.melds[p].length;
  const visible = countsOf([...h.hands[p], ...h.rivers.flat().map((x) => x.id), ...h.melds.flat().flatMap((m) => m.tiles), doraInd(h, 0)]);
  const choices = [];
  const seen = new Set();
  for (const id of h.hands[p]) {
    const k = kindOf(id);
    if (seen.has(k) || !canDiscard(s, id)) continue;
    seen.add(k);
    const rest = countsOf(h.hands[p].filter((x) => x !== id));
    const sh = E.shanten(rest, fixed);
    let ukeire = 0;
    for (let t = 0; t < E.KINDS; t++) {
      if (s.n === 3 && t >= 1 && t <= 7) continue;
      if (rest[t] >= 4) continue;
      rest[t]++;
      if (E.shanten(rest, fixed) < sh) ukeire += 4 - visible[t];
      rest[t]--;
    }
    const isolated = E.isHonor(k) ? 2 : E.isTerminal(k) ? 1 : 0;
    choices.push({ id: pickDiscardId(h.hands[p], k), k, sh, ukeire, isolated });
  }
  // 降り: 他家がリーチしていて自分が2向聴以上なら、その人の捨て牌を切る
  const threat = [...Array(s.n).keys()].find((q) => q !== p && h.riichi[q]);
  const best = Math.min(...choices.map((c) => c.sh));
  if (threat !== undefined && best >= 2) {
    const safe = choices.filter((c) => h.rivers[threat].some((x) => kindOf(x.id) === c.k));
    if (safe.length) return { a: 'd', t: safe[0].id, n };
  }
  choices.sort((a, b) => a.sh - b.sh || b.ukeire - a.ukeire || b.isolated - a.isolated);
  const pick = choices[0];
  const riichi = o.riichi.includes(pick.k) && pick.sh === 0;
  return { a: 'd', t: pick.id, n, ...(riichi ? { r: true } : {}) };
}
// 同じ種類なら赤でない牌から切る
const pickDiscardId = (hand, k) => pickTile(hand, k);

function cpuClaim(s, p) {
  const h = s.h;
  const c = h.claim;
  const acts = c.options[p];
  if (acts.includes('ron')) return { a: 'ron', n: s.seq };
  const k = kindOf(c.id);
  const yakuhai = E.isDragon(k) || k === roundWind(s) || k === seatWind(s, p) || (s.n === 3 && k === E.NORTH);
  if (acts.includes('pon') && yakuhai) return { a: 'pon', n: s.seq };
  return { a: 'pass', n: s.seq };
}

/* ---------- 画面 ---------- */

const SUIT_CHAR = ['萬', '筒', '索'];
const HONOR_CHAR = ['東', '南', '西', '北', '白', '發', '中'];
function tileEl(id, { small = false, back = false, side = false } = {}) {
  const e = document.createElement('span');
  e.className = 'mj-tile' + (small ? ' small' : '') + (side ? ' side' : '');
  if (back) { e.classList.add('back'); return e; }
  // 牌の絵は img/mj/（FluffyStuff の riichi-mahjong-tiles。CC0）。土台（Front）の上に模様を重ねる
  const k = kindOf(id);
  const face = E.isHonor(k) ? TILE_HONOR[k - E.EAST] : TILE_SUIT[E.suitOf(k)] + E.numberOf(k) + (showRed && RED_IDS.has(id) ? '-Dora' : '');
  // ドラの牌は土台を薄い黄色にして目立たせる（本人の希望。赤ドラは絵が赤いので、表示牌から決まるドラだけ）
  const dora = doraKinds.has(k);
  e.style.backgroundImage = `url(img/mj/${face}.svg), url(img/mj/${dora ? 'Front-Dora' : 'Front'}.svg)`;
  e.setAttribute('role', 'img');
  e.setAttribute('aria-label', tileText(k) + (showRed && RED_IDS.has(id) ? '（赤）' : '') + (dora ? '（ドラ）' : ''));
  return e;
}
let doraKinds = new Set(); // いま描いている局のドラの種類（render の始めに決める）
let showRed = true; // 赤ドラを赤く描くか（render の始めに決める）
const TILE_SUIT = ['Man', 'Pin', 'Sou'];
const TILE_HONOR = ['Ton', 'Nan', 'Shaa', 'Pei', 'Haku', 'Hatsu', 'Chun'];
const sortHand = (ids) => ids.slice().sort((a, b) => kindOf(a) - kindOf(b) || RED_IDS.has(b) - RED_IDS.has(a));
const tileText = (k) => (E.isHonor(k) ? HONOR_CHAR[k - E.EAST] : `${E.numberOf(k)}${SUIT_CHAR[E.suitOf(k)]}`);

let ui = { key: null, sel: null, riichi: false };
let keepH = { key: null, h: 0 }; // 1局の間の盤の一番高いところ（render の先頭のコメント）

function meldsEl(h, p, small) {
  const box = document.createElement('div');
  box.className = 'mj-melds';
  for (const m of h.melds[p]) {
    const g = document.createElement('span');
    g.className = 'mj-meld';
    m.tiles.forEach((id, i) => g.append(tileEl(id, { small, back: m.type === 'ankan' && (i === 0 || i === 3), side: id === m.called })));
    box.append(g);
  }
  if (h.nuki[p].length) {
    const g = document.createElement('span');
    g.className = 'mj-meld';
    h.nuki[p].forEach((id) => g.append(tileEl(id, { small })));
    box.append(g);
  }
  return box;
}

// 河。実際の卓と同じく6枚ごとに折り返し、自分の方へ段を重ねる
function riverEl(h, p) {
  const box = document.createElement('div');
  box.className = 'mj-river';
  let row = null;
  h.rivers[p].forEach((x, i) => {
    if (i % 6 === 0) { row = document.createElement('div'); row.className = 'mj-river-row'; box.append(row); }
    const t = tileEl(x.id, { side: x.riichi });
    if (x.taken) t.classList.add('taken');
    row.append(t);
  });
  if (h.claim && h.claim.from === p && h.claim.src === 'discard') row?.lastChild?.classList.add('latest');
  return box;
}

// 卓。真ん中に場の情報と各人の風・点数、そのまわりに4人の河、いちばん外に手牌（自分以外は裏向き）と副露。
// 各人の席は「自分の席（下）」と同じ形に作り、正方形ごと回して置く（下家は右・対面は上・上家は左）。
// 自分の手牌は卓の下に大きく出すので、卓の中の自分の席には副露だけを置く
function tableEl(s, o, me, watching) {
  const h = s.h;
  const table = document.createElement('div');
  table.className = 'mj-table' + (s.n === 5 ? ' five' : '');
  const turns = s.n === 3 ? [0, -90, 90] : s.n === 5 ? [0, -72, -144, 144, 72] : [0, -90, 180, 90];
  const center = document.createElement('div');
  center.className = 'mj-center';
  const mid = document.createElement('div');
  mid.className = 'mj-center-mid';
  mid.innerHTML = `<b></b><span></span>`;
  mid.firstChild.textContent = handTitle(s);
  mid.lastChild.textContent = `残り${Math.max(0, liveLeft(h))}${s.kyotaku ? `・供託${s.kyotaku}` : ''}`;
  center.append(mid);
  for (let i = 0; i < s.n; i++) {
    const p = (me + i) % s.n;
    const seat = document.createElement('div');
    seat.className = 'mj-zone' + (i === 0 ? ' mine' : '');
    seat.style.transform = `rotate(${turns[i]}deg)`;
    seat.append(riverEl(h, p));
    const edge = document.createElement('div');
    edge.className = 'mj-edge';
    const name = document.createElement('span');
    name.className = 'mj-name';
    name.textContent = (i === 0 && !watching ? 'あなた' : o.names[p]) + (o.cpu[p] ? '（CPU）' : '') + (o.away[p] ? '（応答なし）' : '');
    if (i > 0 || watching) {
      const hidden = document.createElement('span');
      hidden.className = 'mj-hidden';
      const drew = h.turn === p && h.drawn !== null && h.hands[p].includes(h.drawn);
      h.hands[p].forEach((_, j) => {
        const t = tileEl(0, { back: true });
        if (drew && j === h.hands[p].length - 1) t.classList.add('drawn');
        hidden.append(t);
      });
      edge.append(hidden);
    }
    edge.append(meldsEl(h, p, false));
    seat.append(edge);
    table.append(seat);
    // 名前は回さずに、その人に近い卓の角へ（逆さや縦の文字にしない）
    // 5人は 右下・右上・左上・左下 の角へ順に。観戦で自分の席の名前も左下に出すときは、左の人を少し上へずらす
    const tag = s.n === 5 ? ['bl', 'br', 'tr', 'tl', watching ? 'bl2' : 'bl'][i] : ['bl', 'br', 'tr', 'tl'][[0, -90, 180, 90].indexOf(turns[i])];
    name.classList.add('mj-tag', tag);
    if (h.phase === 'turn' && h.turn === p) name.classList.add('active');
    if (i > 0 || watching) table.append(name);

    // 真ん中の、その人の側の風と点数（その人の方へ向ける）
    const side = document.createElement('div');
    side.className = 'mj-side' + (h.phase === 'turn' && h.turn === p ? ' active' : '');
    side.style.transform = `rotate(${turns[i]}deg)`;
    const wind = WIND_NAMES[(p - dealerOf(s) + s.n) % s.n];
    side.innerHTML = `<span class="mj-wind${p === dealerOf(s) ? ' dealer' : ''}">${wind}</span><span class="mj-score">${s.scores[p].toLocaleString()}</span>`
      + (h.riichi[p] ? '<span class="mj-stick" title="リーチ"></span>' : '');
    center.append(side);
  }
  table.append(center);
  return table;
}

// 待ち牌の表示（詳細設定）。手牌の上の段（ツモった牌を出す所。いつも空けてある）の左側に重ねて置くので、
// 出たり消えたりしても盤の高さは変わらない（keepH を壊さない）。style.css は使わず、ここで見た目を付ける
function waitsEl(v) {
  const box = document.createElement('div');
  box.className = 'mj-waits';
  Object.assign(box.style, {
    position: 'absolute', left: '0', right: 'calc(var(--hw) + 8px)', bottom: 'calc(100% + 12px)', width: 'auto', minWidth: '0',
    display: 'flex', alignItems: 'center', gap: '2px', overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none',
    fontSize: 'clamp(11px, calc(var(--hw) * .4), 15px)', color: 'var(--muted)', transition: 'none',
  });
  const label = document.createElement('span');
  label.textContent = v.after ? '切ると待ち:' : '待ち:';
  label.style.cssText = 'flex: none; margin-right: 2px;';
  box.append(label);
  for (const k of v.kinds) {
    const t = tileEl(k * 4 + 1); // 赤でない牌の番号で描く
    t.style.cssText += 'width: min(calc(var(--hw) * .6), 28px); flex: 0 1 auto; min-width: 0;';
    box.append(t);
  }
  if (v.furiten) {
    const f = document.createElement('span');
    f.textContent = 'フリテン';
    f.title = '自分の捨て牌に待ちの牌がある・見送った などで、ロンでは和了れません（ツモはできます）';
    f.style.cssText = 'flex: none; margin-left: 4px; padding: 0 4px; border: 1px solid #c62d1f; border-radius: 4px; color: #c62d1f; font-weight: 700;';
    box.append(f);
  }
  return box;
}

function button(text, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  b.onclick = fn;
  return b;
}

function endPanel(s, o, me) {
  const h = s.h;
  const e = h.end;
  const box = document.createElement('div');
  box.className = 'mj-end';
  const name = (p) => (p === me ? 'あなた' : o.names[p]);
  const title = document.createElement('h3');
  if (e.type === 'draw') title.textContent = `${e.title} 流局`;
  else title.textContent = `${e.title} ${name(e.winner)}の${e.type === 'tsumo' ? 'ツモ' : 'ロン'}和了`;
  box.append(title);
  if (e.type !== 'draw') {
    const hand = document.createElement('div');
    hand.className = 'mj-end-hand';
    sortHand(e.hand.filter((id) => !(e.type === 'tsumo' && id === e.win))).forEach((id) => hand.append(tileEl(id, { small: true })));
    const w = tileEl(e.win, { small: true });
    w.classList.add('win');
    hand.append(w);
    for (const m of e.melds) { const g = document.createElement('span'); g.className = 'mj-meld'; m.forEach((id) => g.append(tileEl(id, { small: true }))); hand.append(g); }
    box.append(hand);
    if (e.ura.length) {
      const u = document.createElement('div');
      u.className = 'mj-end-ura';
      u.append('裏ドラ表示 ');
      e.ura.forEach((id) => u.append(tileEl(id, { small: true })));
      box.append(u);
    }
    const ul = document.createElement('ul');
    ul.className = 'mj-yaku';
    for (const y of e.yaku) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${y.name}</span><span>${y.yakuman ? (y.yakuman > 1 ? `${y.yakuman}倍役満` : '役満') : `${y.han}翻`}</span>`;
      ul.append(li);
    }
    box.append(ul);
    const sum = document.createElement('p');
    sum.className = 'mj-sum';
    sum.textContent = `${e.fu ? `${e.fu}符 ` : ''}${e.han}翻${e.limit ? ` ${e.limit}` : ''}　${e.points.toLocaleString()}点`;
    box.append(sum);
  } else {
    const p = document.createElement('p');
    const ten = e.tenpai.map((t, i) => (t ? name(i) : null)).filter(Boolean);
    p.textContent = ten.length ? `聴牌: ${ten.join('、')}` : '全員ノーテン';
    box.append(p);
  }
  const table = document.createElement('ul');
  table.className = 'mj-deltas';
  for (let p = 0; p < s.n; p++) {
    const li = document.createElement('li');
    const d = e.deltas[p];
    li.innerHTML = `<span></span><span class="${d > 0 ? 'plus' : d < 0 ? 'minus' : ''}">${d > 0 ? '+' : ''}${d.toLocaleString()}</span><span>${s.scores[p].toLocaleString()}</span>`;
    li.firstChild.textContent = name(p);
    table.append(li);
  }
  box.append(table);
  if (e.over) box.insertAdjacentHTML('beforeend', '<p class="mj-note">これで対局は終わりです</p>');
  if (me >= 0 && o.canMove && !h.acks.includes(me)) {
    box.append(button(e.over ? '最終結果へ' : '次の局へ', 'primary', () => o.onMove({ a: 'ok', n: s.seq })));
  } else if (me >= 0) {
    box.insertAdjacentHTML('beforeend', '<p class="mj-note">ほかの人を待っています…（30秒で自動で進みます）</p>');
  }
  return box;
}

function render(root, s, o) {
  const h = s.h;
  const me = o.me >= 0 ? o.me : 0;
  const watching = o.me < 0;
  showRed = s.rules.red !== false;
  doraKinds = new Set(Array.from({ length: 1 + h.kans }, (_, i) => E.doraKind(kindOf(doraInd(h, i)), s.n === 3)));
  // 下へスクロールしているとき、ページが短くなると上へ引き戻される（iPhone で牌を押すと戻された）。
  // 手牌の下のボタンや説明は出たり消えたりするので、1局の間は盤の高さを今までで一番高いところより縮めない
  // （作り直しの途中で縮まないよう、前の高さは root の min-height に残したまま。測るのは作り終えてから）
  root.innerHTML = '';
  root.className = 'board mj';
  const handKey = `${o.me}:${handTitle(s)}:${window.innerWidth}`;
  if (h.phase === 'end' || keepH.key !== handKey) keepH = { key: handKey, h: 0 };
  queueMicrotask(() => {
    if (h.phase === 'end') { root.style.minHeight = ''; return; }
    // min-height を外して測ると、その瞬間にページが縮んで引き戻されるので、中身の下端から測る
    const top = root.getBoundingClientRect().top;
    const bottom = Math.max(0, ...[...root.children].map((c) => c.getBoundingClientRect().bottom - top));
    keepH.h = Math.max(keepH.h, Math.ceil(bottom + parseFloat(getComputedStyle(root).paddingBottom || 0)));
    root.style.minHeight = keepH.h + 'px';
  });
  const key = `${s.seq}:${o.me}`;
  if (ui.key !== key) ui = { key, sel: null, riichi: false };
  const draw = () => render(root, s, o);

  // 場の情報
  const info = document.createElement('div');
  info.className = 'mj-info';
  const title = document.createElement('span');
  title.textContent = `${handTitle(s)}${s.kyotaku ? `・供託${s.kyotaku}` : ''}・残り${Math.max(0, liveLeft(h))}枚`;
  const dora = document.createElement('span');
  dora.className = 'mj-dora';
  dora.append('ドラ表示 ');
  for (let i = 0; i < 1 + h.kans; i++) dora.append(tileEl(doraInd(h, i), { small: true }));
  info.append(title, dora);
  root.append(info);

  root.append(tableEl(s, o, me, watching));

  if (h.phase === 'end') { info.after(endPanel(s, o, watching ? -1 : me)); return; } // 結果はスマホでもすぐ見えるよう上に出す

  const myTurn = !watching && o.canMove && h.phase === 'turn' && h.turn === me;
  const opts = myTurn ? turnOptions(s) : null;
  // 手牌は13枚で横幅いっぱい。ツモった牌は右端の上の段に出す（その分1枚ずつを大きくできる）
  const hand = document.createElement('div');
  hand.className = 'mj-hand';
  const row = document.createElement('div');
  row.className = 'mj-hand-row';
  hand.append(row);
  const ids = sortHand(h.hands[me].filter((id) => !(h.turn === me && id === h.drawn)));
  if (h.turn === me && h.drawn !== null && h.hands[me].includes(h.drawn)) ids.push(h.drawn);
  ids.forEach((id) => {
    const isDrawn = h.turn === me && id === h.drawn;
    if (watching) { row.append(tileEl(id, { back: true })); return; }
    const ok = myTurn && canDiscard(s, id) && (!ui.riichi || opts.riichi.includes(kindOf(id)));
    const b = document.createElement(ok ? 'button' : 'span');
    b.className = 'mj-hand-tile' + (isDrawn ? ' drawn' : '') + (ui.sel === id ? ' selected' : '') + (ok ? ' playable' : '') + (myTurn && !ok ? ' dim' : '');
    b.append(tileEl(id));
    if (ok) {
      b.type = 'button';
      b.onclick = () => {
        if (ui.sel === id) { o.onMove({ a: 'd', t: id, n: s.seq, ...(ui.riichi ? { r: true } : {}) }); return; }
        ui.sel = id;
        draw();
      };
    }
    row.append(b);
  });
  if (s.rules.waits && !watching) {
    const v = waitView(s, me, myTurn ? ui.sel : null);
    if (v.kinds.length) row.append(waitsEl(v));
  }
  root.append(hand);

  const actions = document.createElement('div');
  actions.className = 'mj-actions';
  const hint = document.createElement('p');
  hint.className = 'mj-hint';
  if (myTurn) {
    if (opts.tsumo) actions.append(button('ツモ', 'primary', () => o.onMove({ a: 'tsumo', n: s.seq })));
    if (opts.riichi.length) actions.append(button(ui.riichi ? 'リーチをやめる' : 'リーチ', ui.riichi ? 'secondary' : 'primary', () => { ui.riichi = !ui.riichi; ui.sel = null; draw(); }));
    for (const k of opts.ankan) actions.append(button(`カン（${tileText(k)}）`, 'secondary', () => o.onMove({ a: 'ankan', k, n: s.seq })));
    for (const k of opts.kakan) actions.append(button(`カン（${tileText(k)}）`, 'secondary', () => o.onMove({ a: 'kakan', k, n: s.seq })));
    if (opts.nuki) actions.append(button('北を抜く', 'secondary', () => o.onMove({ a: 'nuki', n: s.seq })));
    hint.textContent = ui.riichi ? 'リーチして切る牌を2回タップ（光っている牌だけ）' : '切る牌を2回タップしてください（1回目で選ぶ）';
  } else if (h.phase === 'claim' && !watching && h.claim.options[me] && !h.claim.responses[me] && o.canMove) {
    const c = h.claim;
    const acts = c.options[me];
    const p = document.createElement('div');
    p.className = 'mj-claim';
    p.append(`${c.from === me ? '' : o.names[c.from]}の${c.src === 'discard' ? '捨て牌' : c.src === 'kakan' ? '加槓' : '抜いた北'} `);
    p.append(tileEl(c.id, { small: true }));
    actions.append(p);
    if (acts.includes('ron')) actions.append(button('ロン', 'primary', () => o.onMove({ a: 'ron', n: s.seq })));
    if (acts.includes('pon')) actions.append(button('ポン', 'secondary', () => o.onMove({ a: 'pon', n: s.seq })));
    if (acts.includes('kan')) actions.append(button('カン', 'secondary', () => o.onMove({ a: 'kan', n: s.seq })));
    if (acts.includes('chi')) {
      for (const pair of chiOptions(s, me, c.id)) {
        const label = [...pair, c.id].map(kindOf).sort((a, b) => a - b).map((k) => E.numberOf(k)).join('');
        actions.append(button(`チー（${label}）`, 'secondary', () => o.onMove({ a: 'chi', c: pair, n: s.seq })));
      }
    }
    actions.append(button('見送る', 'ghost', () => o.onMove({ a: 'pass', n: s.seq })));
  } else if (h.phase === 'claim') {
    hint.textContent = '鳴き・ロンの確認を待っています…';
  } else if (!watching && h.riichi[me]) {
    hint.textContent = 'リーチ中です（和了れない牌は自動でツモ切りします）';
  }
  root.append(actions, hint);
  if (!watching) root.append(meldsEl(h, me, false));
}

/* ---------- ゲームの約束 ---------- */

export default {
  id: 'mahjong',
  name: '麻雀',
  icon: '🀄',
  desc: 'リーチ麻雀。4人・3人・5人、足りない席は CPU',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 3,
  maxPlayers: 5,
  settings: [
    { key: 'length', label: '長さ', desc: '東風戦は親が1周（4人なら4局ほど）、半荘戦は2周', def: 'east', choices: [['east', '東風戦'], ['south', '半荘戦']] },
    { key: 'red', label: '赤ドラ', desc: '赤い五（4人・5人は五萬・五筒・五索、3人は五筒・五索）を1枚ずつ入れ、持っているだけで1翻', def: true },
    { key: 'kuitan', label: '喰いタン', desc: '鳴いた手でも断幺九（2〜8だけの手）が役になる', def: true },
    { key: 'waits', label: '待ち牌の表示', desc: '聴牌したら、何で和了れるか（待ちの牌）を自分の画面に出す。初めての人向け', def: false },
    { key: 'players', label: '人数', desc: '3人麻雀は二萬〜八萬を抜いた108枚・チーなし・北は抜きドラ。5人麻雀は5人目に自風がなく、ツモは4人から受け取る', def: 4, choices: [[4, '4人'], [3, '3人（三人麻雀）'], [5, '5人（五人麻雀）']] },
  ],
  seats(rules) { return rules.players === 3 ? 3 : rules.players === 5 ? 5 : 4; },

  init(n, seed, { rules = {} } = {}) {
    const s = {
      n, seed, rules: { length: rules.length === 'south' ? 'south' : 'east', red: rules.red !== false, kuitan: rules.kuitan !== false, waits: rules.waits === true }, scores: Array(n).fill(n === 3 ? 35000 : 25000),
      kyoku: 0, honba: 0, kyotaku: 0, handNo: 0, seq: 0, over: false, ranking: null, h: null,
    };
    startHand(s);
    return s;
  },

  turn(s) { return !s.over && s.h.phase === 'turn' ? s.h.turn : null; },
  canAct(s, p) {
    if (s.over) return false;
    const h = s.h;
    if (h.phase === 'turn') return h.turn === p;
    if (h.phase === 'claim') return !!h.claim.options[p] && !h.claim.responses[p];
    return !h.acks.includes(p);
  },
  apply: applyMove,
  result(s) { return s.over ? { winner: s.ranking[0], ranking: s.ranking, scores: s.scores.slice() } : null; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) {
    if (b.h.phase === 'end' && a.h.phase !== 'end') return b.h.end.type === 'draw' ? 'question' : b.h.end.type; // 流局か、和了（'ron' | 'tsumo'。読み上げ）
    const melds = (s) => s.h.melds.reduce((n, x) => n + x.length, 0);
    if (m.a === 'ok' || m.a === 'next') return null; // 局の結果の画面での「次の局へ」
    if (melds(b) > melds(a) || m.a === 'nuki') return 'call';
    if (m.a === 'd') return m.r ? 'riichi' : 'place';
    return null; // 鳴きの見送りなど
  },
  cpu(s, p) {
    const h = s.h;
    if (h.phase === 'end') return { a: 'ok', n: s.seq };
    if (h.phase === 'claim') return cpuClaim(s, p);
    return cpuTurn(s);
  },
  cpuDelay(s) { return s.h.phase === 'claim' ? 350 : s.h.phase === 'end' ? 1000 : 450; },
  referee(s) {
    if (s.over) return null;
    const h = s.h;
    if (h.phase === 'end') return { key: `e${s.seq}`, ms: END_MS, move: { a: 'next', n: s.seq } };
    if (h.riichi[h.turn] && h.drawn !== null) {
      const o = turnOptions(s);
      if (!o.tsumo && !o.ankan.length && !o.nuki) return { key: `r${s.seq}`, ms: AUTO_MS, move: { a: 'd', t: h.drawn, n: s.seq } };
    }
    return null;
  },
  phaseText(s, me, pn) {
    const h = s.h;
    if (h.phase === 'claim') return h.claim.options[me] && !h.claim.responses[me] ? '鳴きますか？' : '鳴き・ロンの確認中…';
    if (h.phase === 'end') return h.end.type === 'draw' ? '流局' : `${pn(h.end.winner)}の和了`;
    return '';
  },
  resultText(res, me, pn) {
    const rows = res.ranking.map((p, i) => `${i + 1}位 ${pn(p)} ${res.scores[p].toLocaleString()}点`).join('<br>');
    return `${res.winner === me ? 'あなたの勝ち！🎉' : `${pn(res.winner)}の勝ち！`}<div class="status-sub">${rows}</div>`;
  },
  render,
};

// テスト用
export const _test = { turnOptions, claimOptions, winResult, waitsOf, waitView, liveLeft, kindOf, chiOptions, seatWind };
