// 麻雀の役・符・点数・向聴数の計算。
// 本人が別に作っている麻雀アプリ（以下「元のアプリ」）のルール判定エンジンを JavaScript へ写したもの。
// 正しさは、あちらの対照表と tools/test-mahjong.mjs で突き合わせて確かめる。
// **計算の中身を変えるときは、あちらのエンジンと対照表を正とする**（このゲームだけの都合で変えない）。
//
// 牌の種類（kind）は 0〜33: 0〜8 萬子、9〜17 筒子、18〜26 索子、27〜33 東南西北白發中。
// 手牌は「種類ごとの枚数」の配列（長さ34）で持つ。
// 面子 meld = { type: SHUNTSU|KOUTSU|KANTSU, first: 先頭の種類, open: 鳴いたか }（暗槓は KANTSU で open: false）。
// あちらから写した決めごと（統合仕様書 C.3）: 役満は13翻（2倍役満の4役は26翻）で数え、役満にもドラが乗る。
//   13翻ごとに1倍上がり上限は無い。切り上げ満貫はロン・ツモとも。連風牌の雀頭は4符。七対子に4枚使いは認めない。

export const KINDS = 34;
export const EAST = 27;
export const NORTH = 30;
export const WHITE = 31;
export const GREEN = 32;
export const RED = 33;

export const SHUNTSU = 0;
export const KOUTSU = 1;
export const KANTSU = 2;

export const isHonor = (k) => k >= EAST;
export const isWind = (k) => k >= EAST && k <= NORTH;
export const isDragon = (k) => k >= WHITE;
export const numberOf = (k) => (k >= EAST ? k - EAST + 1 : (k % 9) + 1);
export const suitOf = (k) => (k >= EAST ? 3 : Math.floor(k / 9));
export const isTerminal = (k) => !isHonor(k) && (numberOf(k) === 1 || numberOf(k) === 9);
export const isOrphan = (k) => isHonor(k) || isTerminal(k);
const total = (c) => c.reduce((a, b) => a + b, 0);

// "123m456p11z" → 枚数の配列
export function parseCounts(s) {
  const c = Array(KINDS).fill(0);
  let pending = [];
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') pending.push(Number(ch));
    else if ('mpsz'.includes(ch)) {
      const suit = 'mpsz'.indexOf(ch);
      for (const n of pending) c[suit === 3 ? EAST + n - 1 : suit * 9 + n - 1]++;
      pending = [];
    }
  }
  return c;
}
export const kindOf = (s) => parseCounts(s).findIndex((n) => n > 0);
export const kindName = (k) => `${numberOf(k)}${'mpsz'[suitOf(k)]}`;

/* ---------- 和了形の分解（shape.go） ---------- */

export const STANDARD = 0;
export const CHIITOI = 1;
export const KOKUSHI = 2;

// 分解をすべて返す（高点法で一番高い形を選ぶため。1つ見つけて終わりにしない）
export function decompose(concealed, open = []) {
  const out = [];
  const need = 4 - open.length;
  if (need >= 0 && total(concealed) === need * 3 + 2) {
    for (let p = 0; p < KINDS; p++) {
      if (concealed[p] < 2) continue;
      const rest = concealed.slice();
      rest[p] -= 2;
      collectMelds(rest, need, [], (m) => out.push({ type: STANDARD, melds: [...open, ...m], pairs: [p] }));
    }
  }
  if (open.length === 0 && total(concealed) === 14) {
    const pairs = [];
    let ok = true;
    for (let i = 0; i < KINDS; i++) {
      if (concealed[i] === 2) pairs.push(i);
      else if (concealed[i] !== 0) ok = false;
    }
    if (ok && pairs.length === 7) out.push({ type: CHIITOI, melds: [], pairs });
    let doubled = -1;
    ok = true;
    for (let i = 0; i < KINDS; i++) {
      if (!isOrphan(i)) { if (concealed[i]) ok = false; continue; }
      if (concealed[i] === 2) { if (doubled >= 0) ok = false; doubled = i; } else if (concealed[i] !== 1) ok = false;
    }
    if (ok && doubled >= 0) out.push({ type: KOKUSHI, melds: [], pairs: [doubled] });
  }
  return out;
}

// 一番小さい牌を1回で使い切る取り出し方（同じ分解を二重に数えない）
function collectMelds(c, need, acc, emit) {
  if (need === 0) {
    if (total(c) === 0) emit(acc.slice());
    return;
  }
  const i = c.findIndex((n) => n > 0);
  if (i < 0) return;
  let maxRun = 0;
  if (!isHonor(i) && numberOf(i) <= 7) maxRun = Math.min(c[i], c[i + 1], c[i + 2]);
  for (let runs = 0; runs <= maxRun; runs++) {
    const rest = c[i] - runs;
    if (rest !== 0 && rest !== 3) continue;
    const used = runs + (rest === 3 ? 1 : 0);
    if (used === 0 || used > need) continue;
    c[i] -= runs;
    if (runs) { c[i + 1] -= runs; c[i + 2] -= runs; }
    if (rest === 3) c[i] -= 3;
    const next = acc.slice();
    for (let t = 0; t < runs; t++) next.push({ type: SHUNTSU, first: i, open: false });
    if (rest === 3) next.push({ type: KOUTSU, first: i, open: false });
    collectMelds(c, need - used, next, emit);
    if (rest === 3) c[i] += 3;
    c[i] += runs;
    if (runs) { c[i + 1] += runs; c[i + 2] += runs; }
  }
}

export function shapeTiles(s) {
  const c = Array(KINDS).fill(0);
  for (const p of s.pairs) c[p] += 2;
  if (s.type === KOKUSHI) {
    for (let i = 0; i < KINDS; i++) if (isOrphan(i) && i !== s.pairs[0]) c[i]++;
    return c;
  }
  for (const m of s.melds) {
    if (m.type === SHUNTSU) { c[m.first]++; c[m.first + 1]++; c[m.first + 2]++; } else c[m.first] += m.type === KANTSU ? 4 : 3;
  }
  return c;
}

/* ---------- 待ち（wait.go） ---------- */

export const RYANMEN = 0;
export const KANCHAN = 1;
export const PENCHAN = 2;
export const TANKI = 3;
export const SHANPON = 4;
export const KOKUSHI13 = 5;
export const WAIT_NAMES = ['両面', '嵌張', '辺張', '単騎', '双碰', '国士十三面'];

export function placementsOf(s, win) {
  const out = [];
  if (s.type === CHIITOI) {
    if (s.pairs.includes(win)) out.push({ wait: TANKI, meld: -1 });
  } else if (s.type === KOKUSHI) {
    if (s.pairs[0] === win) out.push({ wait: KOKUSHI13, meld: -1 });
    else if (isOrphan(win)) out.push({ wait: TANKI, meld: -1 });
  } else {
    s.melds.forEach((m, i) => {
      if (m.open) return;
      if (m.type === KOUTSU && m.first === win) out.push({ wait: SHANPON, meld: i });
      if (m.type === SHUNTSU) {
        const f = m.first;
        if (win === f) out.push({ wait: numberOf(f) === 7 ? PENCHAN : RYANMEN, meld: i });
        else if (win === f + 1) out.push({ wait: KANCHAN, meld: i });
        else if (win === f + 2) out.push({ wait: numberOf(f) === 1 ? PENCHAN : RYANMEN, meld: i });
      }
    });
    if (s.pairs[0] === win) out.push({ wait: TANKI, meld: -1 });
  }
  return out;
}

/* ---------- 役（yaku.go） ---------- */

// 番号は元のアプリの役の番号と同じ並び
export const YAKU_NAMES = [
  '立直', 'ダブル立直', '一発', '門前清自摸和', '平和', '断幺九', '一盃口',
  '役牌 白', '役牌 發', '役牌 中', '役牌 場風', '役牌 自風',
  '嶺上開花', '槍槓', '海底摸月', '河底撈魚',
  '七対子', '対々和', '三暗刻', '三色同刻', '三色同順', '一気通貫',
  '混全帯幺九', '三槓子', '小三元', '混老頭', '二盃口', '純全帯幺九',
  '混一色', '清一色',
  '国士無双', '四暗刻', '大三元', '字一色', '小四喜', '大四喜',
  '緑一色', '清老頭', '九蓮宝燈', '四槓子', '天和', '地和', '人和',
  '役牌 北',
];
const Y = Object.fromEntries(['riichi', 'double', 'ippatsu', 'tsumo', 'pinfu', 'tanyao', 'iipeiko', 'haku', 'hatsu', 'chun', 'round', 'seat',
  'rinshan', 'chankan', 'haitei', 'houtei', 'chiitoi', 'toitoi', 'sanankou', 'doukou', 'doujun', 'ittsu', 'chanta', 'sankantsu',
  'shousangen', 'honroutou', 'ryanpeiko', 'junchan', 'honitsu', 'chinitsu', 'kokushi', 'suuankou', 'daisangen', 'tsuuiisou',
  'shousuushii', 'daisuushii', 'ryuuiisou', 'chinroutou', 'chuuren', 'suukantsu', 'tenho', 'chiho', 'renho', 'north'].map((k, i) => [k, i]));
const YAKU_COUNT = YAKU_NAMES.length;
// 並べる順: 役牌 北 は 役牌 自風 のすぐ後ろ
const YAKU_ORDER = (() => {
  const out = [];
  for (let i = 0; i < YAKU_COUNT; i++) {
    if (i === Y.north) continue;
    out.push(i);
    if (i === Y.seat) out.push(Y.north);
  }
  return out;
})();
const DOUBLE_NAMES = { [Y.suuankou]: '四暗刻単騎', [Y.kokushi]: '国士無双十三面待ち', [Y.chuuren]: '純正九蓮宝燈' };
export const yakuName = (h) => (h.yakuman >= 2 && DOUBLE_NAMES[h.id]) || YAKU_NAMES[h.id];
export const YAKUMAN_HAN = 13;

// ctx = { tsumo, roundWind, seatWind, riichi, doubleRiichi, ippatsu, rinshan, chankan, haitei, houtei, tenho, chiho, renho, northYakuhai }
export function evaluateYaku(s, p, win, ctx) {
  const f = facts(s, p, win, ctx);
  const ym = evaluateYakuman(f);
  return ym.length ? ym : evaluateNormal(f);
}

function facts(s, p, win, ctx) {
  const f = {
    s, p, win, ctx, tiles: shapeTiles(s), menzen: true, kans: 0, setLike: 0, concealedSets: 0, dragonSets: 0, windSets: 0,
    shuntsu: Array(KINDS).fill(0), setKind: Array(KINDS).fill(false),
    hasHonor: false, allSimple: true, allOrphan: true, allHonor: true, allTerminal: true, numberSuits: 0, numberSuit: 0,
    pairIsWind: false, pairIsDragon: false,
  };
  const seen = [false, false, false];
  for (let i = 0; i < KINDS; i++) {
    if (!f.tiles[i]) continue;
    if (isHonor(i)) { f.hasHonor = true; f.allSimple = false; f.allTerminal = false; continue; }
    f.allHonor = false;
    seen[suitOf(i)] = true;
    if (isTerminal(i)) f.allSimple = false;
    else { f.allOrphan = false; f.allTerminal = false; }
  }
  for (let su = 0; su < 3; su++) if (seen[su]) { f.numberSuits++; f.numberSuit = su; }
  s.melds.forEach((m, i) => {
    if (m.open) f.menzen = false;
    if (m.type === SHUNTSU) { f.shuntsu[m.first]++; return; }
    f.setLike++;
    f.setKind[m.first] = true;
    if (m.type === KANTSU) f.kans++;
    if (!m.open && !(p.meld === i && !ctx.tsumo)) f.concealedSets++; // ロンで完成した刻子は明刻
    if (isDragon(m.first)) f.dragonSets++;
    if (isWind(m.first)) f.windSets++;
  });
  if (s.type === STANDARD) {
    f.pairIsWind = isWind(s.pairs[0]);
    f.pairIsDragon = isDragon(s.pairs[0]);
  }
  return f;
}

const GREEN_KINDS = new Set([19, 20, 21, 23, 25, GREEN]);

function evaluateYakuman(f) {
  const times = Array(YAKU_COUNT).fill(0);
  const { ctx } = f;
  if (f.s.type === KOKUSHI) times[Y.kokushi] = f.p.wait === KOKUSHI13 ? 2 : 1;
  if (ctx.tenho) times[Y.tenho] = 1;
  if (ctx.chiho) times[Y.chiho] = 1;
  if (ctx.renho) times[Y.renho] = 1;
  if (f.concealedSets === 4) times[Y.suuankou] = f.p.wait === TANKI ? 2 : 1;
  if (f.dragonSets === 3) times[Y.daisangen] = 1;
  if (f.allHonor) times[Y.tsuuiisou] = 1;
  if (f.windSets === 3 && f.pairIsWind) times[Y.shousuushii] = 1;
  if (f.windSets === 4) times[Y.daisuushii] = 2;
  if (f.tiles.every((n, i) => !n || GREEN_KINDS.has(i))) times[Y.ryuuiisou] = 1;
  if (f.allTerminal) times[Y.chinroutou] = 1;
  if (f.s.type === STANDARD && f.menzen && f.numberSuits === 1 && !f.hasHonor && isChuuren(f.tiles, f.numberSuit)) {
    times[Y.chuuren] = isJunseiChuuren(f.tiles, f.numberSuit, f.win) ? 2 : 1;
  }
  if (f.kans === 4) times[Y.suukantsu] = 1;
  const out = [];
  for (let i = 0; i < YAKU_COUNT; i++) if (times[i]) out.push({ id: i, han: YAKUMAN_HAN * times[i], yakuman: times[i] });
  return out;
}

function isChuuren(tiles, su) {
  const b = su * 9;
  if (tiles[b] < 3 || tiles[b + 8] < 3) return false;
  for (let n = 1; n <= 7; n++) if (tiles[b + n] < 1) return false;
  return total(tiles) === 14;
}

function isJunseiChuuren(tiles, su, win) {
  const b = su * 9;
  if (win < b || win >= b + 9 || !tiles[win]) return false;
  const t = tiles.slice();
  t[win]--;
  const want = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  return want.every((n, i) => t[b + i] === n);
}

function evaluateNormal(f) {
  const han = Array(YAKU_COUNT).fill(0);
  const { ctx } = f;
  const standard = f.s.type === STANDARD;
  if (f.menzen) {
    if (ctx.doubleRiichi) han[Y.double] = 2;
    else if (ctx.riichi) han[Y.riichi] = 1;
    if ((ctx.riichi || ctx.doubleRiichi) && ctx.ippatsu) han[Y.ippatsu] = 1;
    if (ctx.tsumo) han[Y.tsumo] = 1;
  }
  if (ctx.rinshan && ctx.tsumo) han[Y.rinshan] = 1;
  if (ctx.chankan && !ctx.tsumo) han[Y.chankan] = 1;
  if (ctx.haitei && ctx.tsumo) han[Y.haitei] = 1;
  if (ctx.houtei && !ctx.tsumo) han[Y.houtei] = 1;

  if (standard && f.menzen && f.setLike === 0 && f.kans === 0 && !f.pairIsDragon
    && !(f.pairIsWind && (f.s.pairs[0] === ctx.roundWind || f.s.pairs[0] === ctx.seatWind))
    && !(ctx.northYakuhai && f.s.pairs[0] === NORTH) && f.p.wait === RYANMEN) han[Y.pinfu] = 1;
  if (f.allSimple) han[Y.tanyao] = 1;
  if (standard && f.menzen) {
    const pairs = f.shuntsu.reduce((a, n) => a + Math.floor(n / 2), 0);
    if (pairs === 1) han[Y.iipeiko] = 1;
    if (pairs === 2) han[Y.ryanpeiko] = 3;
  }
  if (f.setKind[WHITE]) han[Y.haku] = 1;
  if (f.setKind[GREEN]) han[Y.hatsu] = 1;
  if (f.setKind[RED]) han[Y.chun] = 1;
  if (isWind(ctx.roundWind) && f.setKind[ctx.roundWind]) han[Y.round] = 1;
  if (isWind(ctx.seatWind) && f.setKind[ctx.seatWind]) han[Y.seat] = 1;
  if (ctx.northYakuhai && f.setKind[NORTH]) han[Y.north] = 1;
  if (f.s.type === CHIITOI) han[Y.chiitoi] = 2;
  if (standard && f.setLike === 4) han[Y.toitoi] = 2;
  if (f.concealedSets === 3) han[Y.sanankou] = 2;
  for (let n = 0; n < 9; n++) if (f.setKind[n] && f.setKind[9 + n] && f.setKind[18 + n]) { han[Y.doukou] = 2; break; }
  for (let n = 0; n < 7; n++) if (f.shuntsu[n] && f.shuntsu[9 + n] && f.shuntsu[18 + n]) { han[Y.doujun] = f.menzen ? 2 : 1; break; }
  for (let su = 0; su < 3; su++) {
    const b = su * 9;
    if (f.shuntsu[b] && f.shuntsu[b + 3] && f.shuntsu[b + 6]) { han[Y.ittsu] = f.menzen ? 2 : 1; break; }
  }
  if (f.kans === 3) han[Y.sankantsu] = 2;
  if (f.dragonSets === 2 && f.pairIsDragon) han[Y.shousangen] = 2;
  if (f.allOrphan && f.hasHonor) han[Y.honroutou] = 2;
  else if (standard && allSetsHaveOrphan(f)) {
    if (f.hasHonor) han[Y.chanta] = f.menzen ? 2 : 1;
    else han[Y.junchan] = f.menzen ? 3 : 2;
  }
  if (f.numberSuits === 1) {
    if (f.hasHonor) han[Y.honitsu] = f.menzen ? 3 : 2;
    else han[Y.chinitsu] = f.menzen ? 6 : 5;
  }
  return YAKU_ORDER.filter((id) => han[id] > 0).map((id) => ({ id, han: han[id], yakuman: 0 }));
}

function allSetsHaveOrphan(f) {
  for (const m of f.s.melds) {
    if (m.type === SHUNTSU) { const n = numberOf(m.first); if (n !== 1 && n !== 7) return false; } else if (!isOrphan(m.first)) return false;
  }
  return f.s.pairs.length === 1 && isOrphan(f.s.pairs[0]);
}

export function candidates(concealed, fixed, win, ctx) {
  const out = [];
  for (const s of decompose(concealed, fixed)) {
    for (const p of placementsOf(s, win)) out.push({ shape: s, placement: p, yaku: evaluateYaku(s, p, win, ctx) });
  }
  return out;
}

/* ---------- 符（fu.go） ---------- */

export function evaluateFu(s, p, ctx, yaku) {
  if (s.type === KOKUSHI) return 0;
  if (s.type === CHIITOI) return 25;
  const pinfu = yaku.some((h) => h.id === Y.pinfu);
  const menzen = s.melds.every((m) => !m.open);
  let fu = 20;
  if (menzen && !ctx.tsumo) fu += 10;
  if (ctx.tsumo && !pinfu) fu += 2;
  s.melds.forEach((m, i) => {
    if (m.type === KOUTSU) {
      let b = !m.open && !(p.meld === i && !ctx.tsumo) ? 4 : 2;
      if (isOrphan(m.first)) b *= 2;
      fu += b;
    } else if (m.type === KANTSU) {
      let b = m.open ? 8 : 16;
      if (isOrphan(m.first)) b *= 2;
      fu += b;
    }
  });
  const pair = s.pairs[0];
  if (isDragon(pair)) fu += 2;
  if (ctx.northYakuhai && pair === NORTH) fu += 2;
  if (pair === ctx.roundWind) fu += 2;
  if (pair === ctx.seatWind) fu += 2;
  if (p.wait === KANCHAN || p.wait === PENCHAN || p.wait === TANKI) fu += 2;
  if (!menzen && fu === 20) fu = 30;
  return Math.ceil(fu / 10) * 10;
}

/* ---------- 点数（score.go） ---------- */

export function basePoints(han, fu) {
  if ((han === 4 && fu === 30) || (han === 3 && fu === 60)) return 2000; // 切り上げ満貫
  if (han >= YAKUMAN_HAN) return 8000 * Math.floor(han / YAKUMAN_HAN);
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han === 5) return 2000;
  return Math.min(2000, fu * 2 ** (2 + han));
}

// 高点法: 基本点 → 翻 → 符 の順に高いもの。役なしは和了れない（ドラは役ではない）。null なら和了れない
export function bestHand(concealed, fixed, win, ctx, doraHan = 0) {
  let best = null;
  for (const c of candidates(concealed, fixed, win, ctx)) {
    if (!c.yaku.length) continue;
    const r = { shape: c.shape, placement: c.placement, yaku: c.yaku, han: 0, fu: 0, base: 0, yakumanCount: 0 };
    let ymHan = 0;
    for (const h of c.yaku) { if (h.yakuman) ymHan += h.han; else r.han += h.han; }
    if (ymHan) { r.han = ymHan + doraHan; r.fu = 0; } else { r.han += doraHan; r.fu = evaluateFu(c.shape, c.placement, ctx, c.yaku); }
    r.base = basePoints(r.han, r.fu);
    if (r.han >= YAKUMAN_HAN) r.yakumanCount = Math.floor(r.han / YAKUMAN_HAN);
    if (!best || r.base > best.base || (r.base === best.base && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))) best = r;
  }
  return best;
}

const up100 = (x) => Math.ceil(x / 100) * 100;
export const honbaStick = (players) => (players === 3 ? 200 : 300);
export const ronPayment = (r, dealer, honba, players = 4) => up100(r.base * (dealer ? 6 : 4)) + honbaStick(players) * honba;
// ツモ: [親が払う額, 子が1人あたり払う額]（3人麻雀でも同じ表のまま。いない北家の分は誰も払わない＝ツモ損）
export function tsumoPayment(r, dealer, honba) {
  if (dealer) return [0, up100(r.base * 2) + 100 * honba];
  return [up100(r.base * 2) + 100 * honba, up100(r.base) + 100 * honba];
}

export function limitName(r) {
  if (r.yakumanCount >= 2) return `${r.yakumanCount}倍役満`;
  if (r.yakumanCount === 1) return '役満';
  return { 6000: '三倍満', 4000: '倍満', 3000: '跳満', 2000: '満貫' }[r.base] ?? '';
}

// ドラ表示牌 → ドラ。sanma108 なら一萬→九萬、九萬→一萬（二〜八萬が無いため）
export function doraKind(ind, sanma108 = false) {
  if (sanma108 && ind === 0) return 8;
  if (sanma108 && ind === 8) return 0;
  if (isWind(ind)) return ind === NORTH ? EAST : ind + 1;
  if (isDragon(ind)) return ind === RED ? WHITE : ind + 1;
  return numberOf(ind) === 9 ? ind - 8 : ind + 1;
}

/* ---------- 向聴数（shanten.go） ---------- */

// -1 = 和了形、0 = 聴牌。fixedMelds = 副露（暗槓も）の数
export function shanten(concealed, fixedMelds = 0) {
  let best = stdShanten(concealed, fixedMelds);
  if (fixedMelds === 0) best = Math.min(best, chiitoiShanten(concealed), kokushiShanten(concealed));
  return best;
}

function stdShanten(c0, fixed) {
  const c = c0.slice();
  let best = 8;
  const walk = (start, melds, partials, hasPair) => {
    const sh = 8 - 2 * (melds + fixed) - partials - (hasPair ? 1 : 0);
    if (sh < best) best = sh;
    if (best === -1) return;
    let i = start;
    while (i < KINDS && c[i] === 0) i++;
    if (i >= KINDS) return;
    const blocks = melds + fixed;
    if (blocks + partials < 4) {
      if (c[i] >= 3) { c[i] -= 3; walk(i, melds + 1, partials, hasPair); c[i] += 3; }
      if (!isHonor(i) && numberOf(i) <= 7 && c[i + 1] && c[i + 2]) {
        c[i]--; c[i + 1]--; c[i + 2]--;
        walk(i, melds + 1, partials, hasPair);
        c[i]++; c[i + 1]++; c[i + 2]++;
      }
    }
    if (!hasPair && c[i] >= 2) { c[i] -= 2; walk(i, melds, partials, true); c[i] += 2; }
    if (blocks + partials < 4) {
      if (c[i] >= 2) { c[i] -= 2; walk(i, melds, partials + 1, hasPair); c[i] += 2; }
      if (!isHonor(i)) {
        const n = numberOf(i);
        if (n <= 8 && c[i + 1]) { c[i]--; c[i + 1]--; walk(i, melds, partials + 1, hasPair); c[i]++; c[i + 1]++; }
        if (n <= 7 && c[i + 2]) { c[i]--; c[i + 2]--; walk(i, melds, partials + 1, hasPair); c[i]++; c[i + 2]++; }
      }
    }
    const saved = c[i];
    c[i] = 0;
    walk(i + 1, melds, partials, hasPair);
    c[i] = saved;
  };
  walk(0, 0, 0, false);
  return best;
}

function chiitoiShanten(c) {
  let pairs = 0;
  let kinds = 0;
  for (const n of c) { if (n > 0) kinds++; if (n >= 2) pairs++; }
  return 6 - pairs + (kinds < 7 ? 7 - kinds : 0);
}

function kokushiShanten(c) {
  let types = 0;
  let pair = 0;
  for (let i = 0; i < KINDS; i++) {
    if (!isOrphan(i)) continue;
    if (c[i] > 0) types++;
    if (c[i] >= 2) pair = 1;
  }
  return 13 - types - pair;
}
