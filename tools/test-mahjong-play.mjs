// 麻雀の進行の自動確認（node tools/test-mahjong-play.mjs）。
// CPU と「できることから無作為に選ぶ打ち手」で対局を最後まで何局も進め、毎手のあとに決まりごとが崩れていないかを見る。
import mahjong, { _test } from '../app/js/games/mahjong.js';
import { mulberry32 } from '../app/js/games/util.js';

const { turnOptions, liveLeft, kindOf, chiOptions } = _test;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? ' ' + extra : ''}`);
  if (!ok) failed++;
};

// 毎手のあとに確かめること。おかしければ説明の文字列を返す
function invariant(s, start) {
  const h = s.h;
  const total = s.scores.reduce((a, b) => a + b, 0) + s.kyotaku * 1000;
  if (total !== start * s.n) return `点数の合計が合わない ${total}`;
  const all = [...h.hands.flat(), ...h.melds.flat().flatMap((m) => m.tiles), ...h.rivers.flat().filter((x) => !x.taken).map((x) => x.id), ...h.nuki.flat()];
  if (new Set(all).size !== all.length) return '同じ牌が2か所にある';
  const used = h.draw + h.rinshan + 0;
  if (all.length !== used + 13 * s.n - 13 * s.n + 13 * s.n - (0)) { /* 配牌も draw に数えている */ }
  if (all.length !== h.draw + h.rinshan) return `牌の数が合わない 場${all.length} 引いた${h.draw + h.rinshan}`;
  for (let p = 0; p < s.n; p++) {
    const size = h.hands[p].length + 3 * h.melds[p].length;
    const want = h.phase === 'turn' && h.turn === p ? 14 : 13;
    if (h.phase !== 'end' && size !== want) return `${p}の手の枚数 ${size}（${want}のはず）`;
  }
  if (liveLeft(h) < 0) return '山の残りがマイナス';
  return null;
}

function play(n, length, seed, style, more = {}) {
  const rng = mulberry32(seed * 7 + 1);
  let s = mahjong.init(n, seed, { rules: { length, players: n, ...more } });
  const start = s.scores[0];
  const stats = { negGo: 0, moves: 0, hands: 0, ron: 0, tsumo: 0, draw: 0, calls: 0, riichi: 0, kans: 0, nuki: 0, tg: 0 };
  // ツモ切りの見分け（河の tsumogiri）: 最後に手牌へ入った牌（ツモ・嶺上・抜いたあとの補充）をそのまま捨てたらツモ切り。
  // 鳴いたあとの打牌は手出し。局の始めの配牌は数えない（その人が1枚引くまでは確かめない）
  let lastIn = [];
  for (let step = 0; step < 20000 && !mahjong.result(s); step++) {
    const actors = [...Array(n).keys()].filter((p) => mahjong.canAct(s, p));
    let m;
    let p = -1;
    if (actors.length) {
      p = actors[Math.floor(rng() * actors.length)];
      m = style === 'cpu' ? mahjong.cpu(s, p) : randomMove(s, p, rng);
    } else {
      m = mahjong.referee(s)?.move;
      if (!m) return { error: `だれも動けず進行役も無い（${s.h.phase}）` };
    }
    const prevPhase = s.h.phase;
    const who = s.h.turn;
    const next = mahjong.apply(s, { ...m, p });
    if (next && m.a === 'd' && lastIn[who] !== undefined) {
      const want = lastIn[who] === m.t;
      const got = next.h.rivers[who].at(-1);
      if (got?.id !== m.t || got.tsumogiri !== want) return { error: `ツモ切りの見分けが違う ${JSON.stringify(got)}（${want} のはず）` };
      if (want) stats.tg++;
    }
    if (next && next.h !== s.h && next.h.hands.length === s.h.hands.length && next.handNo === s.handNo && next.kyoku === s.kyoku && next.honba === s.honba) {
      for (let q = 0; q < n; q++) {
        const before = new Set(s.h.hands[q]);
        const added = next.h.hands[q].filter((x) => !before.has(x));
        if (added.length === 1) lastIn[q] = added[0];
        else if (!added.length && q === p && ['pon', 'chi', 'kan'].includes(m.a)) lastIn[q] = null;
      }
    } else if (next) {
      lastIn = [];
    }
    if (!next) return { error: `手が反則になった ${JSON.stringify(m)} p=${p} phase=${s.h.phase}` };
    if (next.h.phase === 'claim' && prevPhase !== 'claim') {
      const c = next.h.claim;
      const bad = Object.keys(c.options).map(Number).find((q) => c.options[q].includes('chi') && q !== (c.from + 1) % n);
      if (bad !== undefined) return { error: `上家でない人がチーできる ${bad}` };
    }
    if (next.h.phase === 'end' && prevPhase !== 'end' && next.h.end.type === 'tsumo') {
      const d = next.h.end.deltas;
      if (d.filter((x) => x < 0).length !== n - 1) return { error: `ツモで払った人数が ${n - 1} 人でない ${JSON.stringify(d)}` };
    }
    if (m.a === 'ron') stats.ron++;
    if (m.a === 'tsumo') stats.tsumo++;
    if (['pon', 'chi', 'kan'].includes(m.a)) stats.calls++;
    if (m.r) stats.riichi++;
    if (m.a === 'ankan' || m.a === 'kakan') stats.kans++;
    if (m.a === 'nuki') stats.nuki++;
    if (next.h.phase === 'end' && prevPhase !== 'end') {
      stats.hands++;
      if (next.h.end.type === 'draw') stats.draw++;
      // トビ（詳細設定）: ありならマイナスの人が出た局で終わる。なしならマイナスでも、最後の局まで続く
      const neg = next.scores.some((x) => x < 0);
      const last = length === 'south' ? 2 * n - 1 : n - 1;
      if (more.tobi === false) {
        if (neg && !next.h.end.over) stats.negGo++;
        if (next.h.end.over && next.kyoku !== last && next.h.end.next.kyoku <= last) return { error: 'トビなしなのに最後の局より前で終わった' };
      } else if (neg && !next.h.end.over) return { error: 'マイナスの人がいるのに続いた（トビ）' };
    }
    s = next;
    stats.moves++;
    const bad = invariant(s, start);
    if (bad) return { error: bad, s };
  }
  const res = mahjong.result(s);
  if (!res) return { error: '終わらない' };
  return { stats, s, res };
}

// できることから無作為に選ぶ（鳴き・カン・抜き・リーチを多めに通すため）
function randomMove(s, p, rng) {
  const h = s.h;
  const n = s.seq;
  if (h.phase === 'end') return { a: 'ok', n };
  if (h.phase === 'claim') {
    const acts = h.claim.options[p];
    if (acts.includes('ron') && rng() < 0.8) return { a: 'ron', n };
    const a = [...acts.filter((x) => x !== 'ron'), 'pass', 'pass'][Math.floor(rng() * (acts.length + 1))] ?? 'pass';
    if (a === 'chi') { const c = chiOptions(s, p, h.claim.id); return { a: 'chi', c: c[Math.floor(rng() * c.length)], n }; }
    return { a, n };
  }
  const o = turnOptions(s);
  if (o.tsumo && rng() < 0.9) return { a: 'tsumo', n };
  if (o.ankan.length && rng() < 0.5) return { a: 'ankan', k: o.ankan[0], n };
  if (o.kakan.length && rng() < 0.5) return { a: 'kakan', k: o.kakan[0], n };
  if (o.nuki && rng() < 0.7) return { a: 'nuki', n };
  const m = mahjong.cpu(s, p);
  if (m.a !== 'd') return m;
  if (o.riichi.length && !m.r && rng() < 0.5) {
    const id = h.hands[p].find((x) => o.riichi.includes(kindOf(x)) && (!h.kuikae.includes(kindOf(x))));
    if (id !== undefined) return { a: 'd', t: id, r: true, n };
  }
  return m;
}

const sum = { ron: 0, tsumo: 0, draw: 0, calls: 0, riichi: 0, kans: 0, nuki: 0, hands: 0, tg: 0 };
let worstReplay = 0;
let games = 0;
for (const n of [4, 3, 5]) {
  for (const length of ['east', 'south']) {
    for (let seed = 1; seed <= 4; seed++) {
      for (const style of ['cpu', 'random']) {
        const r = play(n, length, seed, style);
        games++;
        if (r.error) { check(`${n}人 ${length} 種${seed} ${style}`, false, r.error); continue; }
        for (const k of Object.keys(sum)) sum[k] += r.stats[k];
        if (seed === 1 && style === 'cpu') {
          // 当て直しの時間（毎回の描き直しで全部の手を当て直すため）。手の一覧を記録して測る
          const t0 = Date.now();
          let x = mahjong.init(n, seed, { rules: { length, players: n } });
          const moves = [];
          // 同じ対局をもう一度進めて手を集める
          const rng = mulberry32(seed * 7 + 1);
          while (!mahjong.result(x)) {
            const actors = [...Array(n).keys()].filter((p) => mahjong.canAct(x, p));
            const p = actors.length ? actors[Math.floor(rng() * actors.length)] : -1;
            const m = p >= 0 ? mahjong.cpu(x, p) : mahjong.referee(x).move;
            moves.push({ ...m, p });
            x = mahjong.apply(x, { ...m, p });
          }
          const t1 = Date.now();
          let y = mahjong.init(n, seed, { rules: { length, players: n } });
          for (const m of JSON.parse(JSON.stringify(moves))) y = mahjong.apply(y, m);
          const ms = Date.now() - t1;
          worstReplay = Math.max(worstReplay, ms);
          check(`${n}人 ${length === 'east' ? '東風' : '半荘'}: 手の一覧の当て直しで同じ結果`, y && JSON.stringify(y.scores) === JSON.stringify(x.scores),
            `${moves.length}手・当て直し${ms}ms（対局${t1 - t0}ms）`);
        }
      }
    }
  }
}
// トビなし（詳細設定）: マイナスのまま続き、最後の局まで打つ。無作為の手は点が大きく動くので、マイナスになる局がよく出る
{
  let go = 0;
  for (const n of [4, 3]) {
    for (let seed = 11; seed <= 16; seed++) {
      const r = play(n, 'east', seed, 'random', { tobi: false });
      games++;
      if (r.error) { check(`トビなし ${n}人 種${seed}`, false, r.error); continue; }
      go += r.stats.negGo;
    }
  }
  check('トビなし: マイナスになっても対局が続いた局がある', go > 0, `${go}局`);
}
// 1局だけ（長さ）: 親が和了っても流局でも、1局で終わる
{
  let ok = 0;
  for (const n of [4, 3, 5]) {
    for (let seed = 21; seed <= 24; seed++) {
      const r = play(n, 'one', seed, seed % 2 ? 'random' : 'cpu');
      games++;
      if (r.error) { check(`1局だけ ${n}人 種${seed}`, false, r.error); continue; }
      if (r.stats.hands === 1 && r.res.ranking.length === n) ok++;
      else check(`1局だけ ${n}人 種${seed}`, false, `${r.stats.hands}局打った`);
    }
  }
  check('1局だけ: どれも1局で終わり、順位が付く', ok === 12, `${ok}/12`);
}
// 5人麻雀の自風: 親から数えて東南西北、5人目は無し（-1）
{
  const s = mahjong.init(5, 1, { rules: { players: 5 } });
  const winds = [0, 1, 2].map((kyoku) => [...Array(5).keys()].map((p) => _test.seatWind({ ...s, kyoku }, p)));
  check('5人麻雀: 親から数えて東南西北、5人目は自風なし', JSON.stringify(winds) === JSON.stringify([[27, 28, 29, 30, -1], [-1, 27, 28, 29, 30], [30, -1, 27, 28, 29]]), JSON.stringify(winds));
  check('5人麻雀: 東風戦は東1〜東5局、持ち点25000点', s.scores.every((x) => x === 25000) && s.scores.length === 5);
}
check(`${games}局を最後まで進めて決まりごとが崩れない`, failed === 0, JSON.stringify(sum));
check('ロン・ツモ・流局・鳴き・リーチ・カン・抜き・ツモ切りがどれも起きた', Object.values(sum).every((v) => v > 0));
console.log(failed ? `\n${failed} 件の失敗` : '\nすべて OK');
process.exit(failed ? 1 : 0);
