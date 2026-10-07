// 麻雀の自動確認（node tools/test-mahjong.mjs）。
// 1. 役・符・点数・向聴数の計算を、元にした麻雀アプリ（元のアプリ）の対照表（*.json）と全件突き合わせる。
//    対照表のフォルダの場所は Git に入れない tools/local-paths.json の mahjongTestdata に書く（公開リポジトリに場所を出さないため）。
//    対照表はこのリポジトリへ写さない（公開リポジトリのため、あちらの書類を持ち込まない）。あちらのフォルダが無ければ飛ばす。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../app/js/games/mahjong-engine.js';

const TESTDATA = (() => {
  try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL('./local-paths.json', import.meta.url)), 'utf8')).mahjongTestdata || ''; }
  catch { return ''; }
})();
let failed = 0;
let passed = 0;
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else { failed++; console.log(`NG  ${name}${extra ? ' ' + extra : ''}`); }
};
const section = (name) => console.log(`--- ${name}`);

function parseMelds(specs = []) {
  return specs.map((spec) => {
    const [type, k] = spec.split(':');
    const first = E.kindOf(k);
    if (type === 'pon') return { type: E.KOUTSU, first, open: true };
    if (type === 'chi') return { type: E.SHUNTSU, first, open: true };
    if (type === 'kan') return { type: E.KANTSU, first, open: true };
    if (type === 'ankan') return { type: E.KANTSU, first, open: false };
    throw new Error('副露を読めない: ' + spec);
  });
}
const wind = (s, fallback) => (s ? E.kindOf(s) : fallback);
function toCtx(c = {}) {
  return {
    tsumo: !!c.tsumo, riichi: !!c.riichi, doubleRiichi: !!c.double_riichi, ippatsu: !!c.ippatsu, rinshan: !!c.rinshan,
    chankan: !!c.chankan, haitei: !!c.haitei, houtei: !!c.houtei, tenho: !!c.tenho, chiho: !!c.chiho, renho: !!c.renho,
    northYakuhai: !!c.north_yakuhai, roundWind: wind(c.round, E.EAST), seatWind: wind(c.seat, E.EAST + 1),
  };
}
const formatHits = (hits) => hits.map((h) => (h.yakuman === 1 ? `${E.YAKU_NAMES[h.id]}:役満`
  : h.yakuman > 1 ? `${E.YAKU_NAMES[h.id]}:${h.yakuman}倍役満` : `${E.YAKU_NAMES[h.id]}:${h.han}`)).join('・');
const load = (name) => JSON.parse(fs.readFileSync(`${TESTDATA}/${name}.json`, 'utf8'));

if (!TESTDATA || !fs.existsSync(TESTDATA)) {
  console.log('元のアプリの対照表が見つからないので、突き合わせを飛ばします（tools/local-paths.json の mahjongTestdata）');
} else {
  section('和了形（shape.json）');
  for (const tc of load('shape').cases) {
    const shapes = E.decompose(E.parseCounts(tc.hand));
    check(tc.id, (shapes.length > 0) === tc.win && (tc.shapes === undefined || shapes.length === tc.shapes), `${shapes.length}通り`);
  }
  section('待ち（wait.json）');
  for (const tc of load('wait').cases) {
    const found = new Set();
    for (const s of E.decompose(E.parseCounts(tc.hand), parseMelds(tc.open))) for (const p of E.placementsOf(s, E.kindOf(tc.win))) found.add(p.wait);
    const got = [...found].sort((a, b) => a - b).map((w) => E.WAIT_NAMES[w]).join(',');
    check(tc.id, got === tc.waits.join(','), `${got} / 正解 ${tc.waits.join(',')}`);
  }
  section('役（yaku.json）');
  for (const tc of load('yaku').cases) {
    const best = E.bestHand(E.parseCounts(tc.concealed), parseMelds(tc.open), E.kindOf(tc.win), toCtx(tc.ctx), 0);
    const got = best ? formatHits(best.yaku) : '役なし';
    check(tc.id, got === tc.yaku.join('・'), `\n    got:  ${got}\n    want: ${tc.yaku.join('・')}`);
  }
  section('符（fu.json）');
  for (const tc of load('fu').cases) {
    const ctx = toCtx(tc.ctx);
    const best = E.bestHand(E.parseCounts(tc.concealed), parseMelds(tc.open), E.kindOf(tc.win), ctx, 0);
    const fu = best ? E.evaluateFu(best.shape, best.placement, ctx, best.yaku) : -1;
    check(tc.id, fu === tc.fu, `${fu}符 / 正解 ${tc.fu}符`);
  }
  section('点数（score.json）');
  const score = load('score');
  for (const tc of score.payments) {
    const r = { base: E.basePoints(tc.han, tc.fu) };
    if (tc.kind === 'ron') {
      const got = E.ronPayment(r, tc.dealer, tc.honba, tc.players || 4);
      check(tc.id, got === tc.ron, `${got} / 正解 ${tc.ron}`);
    } else {
      const [fd, fo] = E.tsumoPayment(r, tc.dealer, tc.honba);
      check(tc.id, fd === tc.from_dealer && fo === tc.from_others, `${fd}/${fo} / 正解 ${tc.from_dealer}/${tc.from_others}`);
    }
  }
  for (const tc of score.hands) {
    const ctx = toCtx({ tsumo: tc.ctx?.tsumo, round: tc.ctx?.round, seat: tc.ctx?.seat });
    const r = E.bestHand(E.parseCounts(tc.concealed), parseMelds(tc.open), E.kindOf(tc.win), ctx, tc.dora);
    if (!!r !== tc.win_ok) { check(tc.id, false, '和了の可否が違う'); continue; }
    if (!r) { check(tc.id, true); continue; }
    let pay;
    let want;
    if (ctx.tsumo) { pay = E.tsumoPayment(r, tc.dealer, tc.honba).join('/'); want = `${tc.from_dealer}/${tc.from_others}`; } else { pay = String(E.ronPayment(r, tc.dealer, tc.honba)); want = String(tc.ron); }
    check(tc.id, r.han === tc.han && E.limitName(r) === tc.limit && pay === want, `${r.han}翻 ${E.limitName(r)} ${pay} / 正解 ${tc.han}翻 ${tc.limit} ${want}`);
  }
  section('向聴数（shanten.json）');
  for (const tc of load('shanten').cases) {
    const got = E.shanten(E.parseCounts(tc.hand), tc.fixed_melds || 0);
    check(tc.id, got === tc.shanten, `${got} / 正解 ${tc.shanten}`);
  }
  // 向聴数と分解の突き合わせ（あちらの shanten_test.go と同じ考え方）: 無作為の14枚で「-1 ⇔ 和了形」
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let mismatch = 0;
  for (let t = 0; t < 3000; t++) {
    const pool = [];
    const kinds = t % 2 ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 28] : [...Array(34).keys()]; // 半分は牌の種類を絞って聴牌の近くを通す
    for (const k of kinds) for (let n = 0; n < 4; n++) pool.push(k);
    const c = Array(34).fill(0);
    for (let n = 0; n < 14; n++) c[pool.splice(Math.floor(rand() * pool.length), 1)[0]]++;
    if ((E.shanten(c) === -1) !== (E.decompose(c).length > 0)) mismatch++;
  }
  check('向聴数 -1 と和了形の一致（3000手）', mismatch === 0, `${mismatch}件の食い違い`);
}

// 2. 進行の決まり（mahjong.js）。局面を手で組んで確かめる
{
  const { default: mj, _test: T } = await import('../app/js/games/mahjong.js');
  // "34m55s" → 牌の番号。赤ドラ（各種類の0枚目）は最後に使う
  const ids = (str, used = new Set()) => {
    const c = E.parseCounts(str);
    const out = [];
    c.forEach((n, k) => { for (let i = 0; i < n; i++) { const id = [1, 2, 3, 0].map((j) => k * 4 + j).find((x) => !used.has(x)); used.add(id); out.push(id); } });
    return out;
  };
  // 4人の局面で、席0の番（14枚目をツモったところ）。hands は席ごとの文字列
  function table(hands, n = 4) {
    const s = mj.init(n, 1, { rules: { players: n } });
    const used = new Set();
    s.h.hands = hands.map((x) => ids(x, used));
    s.h.melds = s.h.hands.map(() => []);
    s.h.rivers = s.h.hands.map(() => []);
    s.h.turn = 0;
    s.h.drawn = s.h.hands[0].at(-1);
    s.h.phase = 'turn';
    s.h.waits = s.h.hands.map((_, p) => (p === 0 ? [] : T.waitsOf(s, p)));
    return s;
  }
  const act = (s, m) => mj.apply(s, { n: s.seq, ...m });
  const tile = (s, p, k) => s.h.hands[p].find((id) => T.kindOf(id) === E.kindOf(k));
  section('進行の決まり');
  const tenpai25m = '34m234p567p678s55s'; // 二萬・五萬待ち（断幺九・平和）

  // 捨て牌フリテン
  {
    const s = table(['2m1112223334z', tenpai25m, '19m19p19s1234567z', '19m19p19s1234567z']);
    let o = T.claimOptions(s, 0, tile(s, 0, '2m'), 'discard');
    check('聴牌の人は待ちの牌でロンできる', o[1]?.includes('ron'));
    s.h.rivers[1] = [{ id: 4 * 4 + 3, riichi: false, taken: false }]; // 自分の河に五萬
    o = T.claimOptions(s, 0, tile(s, 0, '2m'), 'discard');
    check('待ちの牌が自分の河にあるとロンできない（捨て牌フリテン）', !o[1]?.includes('ron'));
  }
  // 同巡フリテン: 見送ったら、自分のツモ番まで別の待ちでもロンできない（聴牌は席2。席1が間に打つ）
  {
    const s = table(['2m1112223334z', '5m19p19s1234567z', tenpai25m, '19m19p19s1234567z']);
    let x = act(s, { a: 'd', t: tile(s, 0, '2m'), p: 0 });
    check('捨て牌で確認が開く', x?.h.phase === 'claim' && x.h.claim.options[2]?.includes('ron'));
    x = act(x, { a: 'pass', p: 2 });
    check('見送ると同巡フリテンが付く', x?.h.furitenTemp[2] === true && x.h.turn === 1, `phase=${x?.h.phase}`);
    const o = T.claimOptions(x, 1, tile(x, 1, '5m'), 'discard');
    check('同じ巡のうちは別の待ち（五萬）でもロンできない', !o[2]?.includes('ron'));
    x = act(x, { a: 'd', t: tile(x, 1, '5m'), p: 1 });
    if (x?.h.phase === 'claim') x = act(x, { a: 'timeout', p: -1 });
    check('自分のツモ番が来たら同巡フリテンが消える', x?.h.turn === 2 && x.h.furitenTemp[2] === false);
  }
  // 詳細設定「赤ドラ」「喰いタン」（2026-10-06）
  {
    const s = table(['2m1112223334z', '34m567p678s55s', '19m19p19s1234567z', '19m19p19s1234567z']);
    s.h.melds[1] = [{ type: 'pon', tiles: ids('222p'), called: null, from: 2 }];
    s.h.noCalls = false; // 1巡目の人和にしない
    const win = tile(s, 0, '2m');
    check('喰いタンありなら鳴いた断幺九で和了れる', !!T.winResult(s, 1, win));
    s.rules = { ...s.rules, kuitan: false };
    check('喰いタンなしなら鳴いた断幺九だけでは和了れない', T.winResult(s, 1, win) === null);
    const c = table(['2m1112223334z', tenpai25m, '19m19p19s1234567z', '19m19p19s1234567z']);
    c.rules = { ...c.rules, kuitan: false };
    c.h.noCalls = false;
    const cr = T.winResult(c, 1, tile(c, 0, '2m'));
    check('喰いタンなしでも門前の断幺九は付く', cr?.yaku.some((y) => E.YAKU_NAMES[y.id] === '断幺九'));
    const r = table(['2m1112223334z', tenpai25m, '19m19p19s1234567z', '19m19p19s1234567z']);
    const i = r.h.hands[1].findIndex((id) => T.kindOf(id) === E.kindOf('5s'));
    r.h.hands[1][i] = 88; // 赤い五索
    r.h.noCalls = false;
    check('赤ドラありなら赤い五は1翻', T.winResult(r, 1, tile(r, 0, '2m'))?.dora.red === 1);
    r.rules = { ...r.rules, red: false };
    check('赤ドラなしなら赤い五を数えない', T.winResult(r, 1, tile(r, 0, '2m'))?.dora.red === 0);
    check('最初は赤ドラ・喰いタンともあり', mj.init(4, 1, { rules: {} }).rules.red === true && mj.init(4, 1, { rules: {} }).rules.kuitan === true);
  }
  // 喰い替え: チーしたあと打てる牌が無くなるチーは出さない
  {
    const s = table(['6m1112223334z55z', '45m36m', '19m19p19s1234567z', '19m19p19s1234567z']);
    s.h.melds[1] = [{ type: 'pon', tiles: ids('111p'), called: null, from: 2 }, { type: 'pon', tiles: ids('222p', new Set(ids('111p'))), called: null, from: 2 }, { type: 'pon', tiles: ids('999p'), called: null, from: 2 }];
    check('現物と筋しか残らないチーは出さない', T.chiOptions(s, 1, tile(s, 0, '6m')).every((c) => c.map(T.kindOf).sort().join() !== '3,4'));
    s.h.hands[1] = ids('45m9p3m');
    check('ほかの牌が残るチーは出す', T.chiOptions(s, 1, tile(s, 0, '6m')).some((c) => c.map(T.kindOf).sort().join() === '3,4'));
    // 反対向き: 3萬を 45萬 でチーすると、3萬と6萬が打てない
    const t2 = table(['3m1112223334z55z', '45m36m', '19m19p19s1234567z', '19m19p19s1234567z']);
    t2.h.melds[1] = s.h.melds[1];
    check('下の端を鳴いたときも筋（6萬）は打てない', T.chiOptions(t2, 1, tile(t2, 0, '3m')).every((c) => c.map(T.kindOf).sort().join() !== '3,4'));
  }
  // リーチは聴牌のときだけ
  {
    const s = table(['234m234p567p678s59s', '', '', '']);
    s.h.hands[0] = ids('234m234p567p678s59s'); // 9索を切れば聴牌（五索単騎）、2萬を切っても聴牌でない
    s.h.drawn = s.h.hands[0].at(-1);
    check('聴牌にならない牌ではリーチできない', act(s, { a: 'd', t: tile(s, 0, '2m'), r: true, p: 0 }) === null);
    const x = act(s, { a: 'd', t: tile(s, 0, '9s'), r: true, p: 0 });
    check('聴牌になる牌でリーチできる', !!x);
  }
  // 頭ハネ: 2人がロンできるとき、打った人に近い人だけが和了る
  {
    const s = table(['2m1112223334z', tenpai25m, tenpai25m.replace('678s', '678p'), '19m19p19s1234567z']);
    let x = act(s, { a: 'd', t: tile(s, 0, '2m'), p: 0 });
    check('2人にロンの確認が出る', x?.h.claim.options[1]?.includes('ron') && x.h.claim.options[2]?.includes('ron'));
    const far = act(x, { a: 'ron', p: 2 });
    check('遠い人のロンだけでは決まらない（近い人を待つ）', far?.h.phase === 'claim');
    const end = act(far, { a: 'ron', p: 1 });
    check('近い人が和了る（ダブロンなし）', end?.h.phase === 'end' && end.h.end.winner === 1 && end.h.end.deltas[2] === 0);
    const near = act(x, { a: 'ron', p: 1 });
    check('近い人がロンしたら、遠い人を待たずに決まる', near?.h.phase === 'end' && near.h.end.winner === 1);
  }
  // 3人麻雀のツモ損: 子のツモは親と子の2人だけが払う
  {
    const s = table(['19m19p19s1234567z9m', '19m19p19s1234567z', '19m19p19s1234567z'], 3);
    s.h.turn = 1; // 席0が親。席1（子）が国士無双をツモ
    s.h.hands[1] = ids('19m19p19s12345677z', new Set(s.h.hands[0]));
    s.h.drawn = s.h.hands[1][0]; // 一萬をツモ（中の対子があるので十三面待ちではない）
    s.h.discards[1] = 1; // 1巡目ではない（地和にしない）
    const x = act(s, { a: 'tsumo', p: 1 });
    const d = x?.h.end.deltas;
    check('3人のツモ損（子の役満: 親16000・子8000の計24000）', d && d[1] === 24000 && d[0] === -16000 && d[2] === -8000, JSON.stringify(d));
  }
  // 荒牌流局のノーテン罰符
  {
    const s = table(['1m258m258p258s1357z', tenpai25m, '19m19p19s1234567z', '19m19p19s1234567z']);
    s.h.hands[2] = s.h.hands[2].slice(0, 12).concat(ids('5s', new Set(s.h.hands.flat()))); // 席2・3はノーテン
    s.h.hands[3] = s.h.hands[3].slice(0, 12).concat(ids('6s', new Set(s.h.hands.flat())));
    s.h.draw = s.h.L - 14; // 山の残り0枚
    const x = act(s, { a: 'd', t: tile(s, 0, '1m'), p: 0 });
    const d = x?.h.end?.deltas;
    check('聴牌1人なら3000点を受け取り、ノーテン3人が1000点ずつ払う', x?.h.end?.type === 'draw' && d[1] === 3000 && d[0] === -1000 && d[3] === -1000, JSON.stringify(d));
    s.h.hands[3] = ids('11m19p19s123456z', new Set(s.h.hands.flat())); // 席3が一萬の対子を持っていても
    check('山が0枚の捨て牌はポンできない（ロンだけ）', !T.claimOptions(s, 0, tile(s, 0, '1m'), 'discard')[3]);
    s.h.draw = s.h.L - 15;
    check('山が残っていればポンできる', T.claimOptions(s, 0, tile(s, 0, '1m'), 'discard')[3]?.includes('pon'));
  }
  // 詳細設定「待ち牌の表示」（2026-10-07）。見せるだけの waitView
  {
    check('待ち牌の表示は最初は「なし」', mj.init(4, 1, { rules: {} }).rules.waits === false && mj.init(4, 1, { rules: { waits: true } }).rules.waits === true);
    const nonTen = '1m258m258p258s1357z';
    const s = table(['234m234p567p678s59s', tenpai25m, nonTen, '19m19p19s1234567z']);
    const k = (str) => E.kindOf(str);
    let v = T.waitView(s, 1);
    check('13枚の聴牌なら待ちが出る（二萬・五萬）', v.kinds.join() === [k('2m'), k('5m')].join() && !v.furiten && !v.after, JSON.stringify(v));
    check('聴牌でなければ待ちは空', T.waitView(s, 2).kinds.length === 0 && !T.waitView(s, 2).furiten);
    check('国士無双の13面待ちも出る', T.waitView(s, 3).kinds.length === 13);
    s.h.rivers[1] = [{ id: 4 * 4 + 3, riichi: false, taken: false }]; // 自分の河に五萬
    check('待ちの牌が自分の河にあればフリテン', T.waitView(s, 1).furiten === true);
    s.h.rivers[1] = [];
    s.h.furitenTemp[1] = true;
    check('見送ったあと（同巡フリテン）もフリテン', T.waitView(s, 1).furiten === true);
    s.h.furitenTemp[1] = false;
    s.h.furitenRiichi[1] = true;
    check('リーチ後に見送ったあともフリテン', T.waitView(s, 1).furiten === true);
    s.h.furitenRiichi[1] = false;
    // 14枚（自分の番で切る前）: 選んでいなければ出さない。選んだ牌を切ったときの待ちを出す
    check('14枚で牌を選ぶ前は出さない', T.waitView(s, 0).kinds.length === 0);
    v = T.waitView(s, 0, tile(s, 0, '9s'));
    check('九索を選ぶと五索の単騎待ち', v.kinds.join() === String(k('5s')) && v.after && !v.furiten, JSON.stringify(v));
    check('二萬を選ぶと聴牌しないので空', T.waitView(s, 0, tile(s, 0, '2m')).kinds.length === 0);
    s.h.rivers[0] = [{ id: tile(s, 0, '5s') ^ 1, riichi: false, taken: false }];
    check('選んだ牌を切ったときの待ちが河にあればフリテン', T.waitView(s, 0, tile(s, 0, '9s')).furiten === true);
    s.h.rivers[0] = [];
    const t2 = table(['234m234p567p678s55s', '', '', '']); // 五索を切ると五索の単騎待ち（切る牌が待ち）
    check('切る牌そのものが待ちならフリテン', T.waitView(t2, 0, tile(t2, 0, '5s')).furiten === true && T.waitView(t2, 0, tile(t2, 0, '5s')).kinds.join() === String(k('5s')));
    // リーチ中は14枚でも今の待ち。局面は変えない
    s.h.riichi[0] = 1;
    s.h.waits[0] = [k('5s')];
    check('リーチ中は切る前でも今の待ち', T.waitView(s, 0).kinds.join() === String(k('5s')) && !T.waitView(s, 0).after);
    check('待ちを数えても手牌は変わらない', s.h.hands[0].length === 14);
  }
}

console.log(failed ? `\n${failed} 件の失敗（${passed} 件は OK）` : `\nすべて OK（${passed} 件）`);
process.exit(failed ? 1 : 0);
