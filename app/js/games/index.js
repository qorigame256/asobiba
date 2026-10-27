// 遊べるゲームの一覧。新しいゲームはここに足す。
//
// 盤のゲーム（2人用。マルバツ・コネクトフォー・リバーシ・点と線は詳細設定で3〜4人、将棋は3人）が持つもの: id / name / icon / desc / ready / players（[先手の呼び名, 後手の呼び名]）
//   init({ rules, seed }) → 最初の局面（rules = 詳細設定の値。使わないゲームは無視してよい。seed = 対局ごとの種。始めの盤をばらばらにするときだけ使う（コネクトフォーのじゃま石））, turn(局面) → 0|1, apply(局面, 手) → 次の局面（反則なら null）,
//   result(局面) → null（続行中）| { winner: 0|1|null(引き分け), cells: [光らせるマス] },
//   render(要素, 局面, { canMove, onMove, fresh, me: 自分のプレイヤー番号（観戦は -1、同じ画面の対局は null） }),
//   info(局面)（任意。状態表示に足す HTML）,
//   noLocal: true（任意。相手に見せない情報があるので「この画面で2人で」を出さない。海戦ゲーム）,
//   noUndo: true（任意。オンラインの「待った」を出さない。海戦ゲーム）,
//   seatCount(rules)（任意。詳細設定で人数が決まる盤のゲーム（マルバツ・コネクトフォー・リバーシ・点と線の3〜4人、将棋・マンカラの3人）。待合室の席の数・turn と winner の番号が 0〜人数-1 になる。
//     players はその人数ぶんの呼び名を持つ。無ければ2人）
//
// カードゲーム（multi: true。オンラインのみ・足りない席は CPU）が持つもの: id / name / icon / desc / ready /
//   minPlayers / maxPlayers,
//   init(人数, seed, { rules, prev }) → 最初の局面（シャッフルは seed から作る。Math.random を使わない）。
//     rules = 詳細設定の値、prev = 前の対局の carry をこの対局のプレイヤー番号順に並べたもの（無ければ null）,
//   turn(局面) → 手番のプレイヤー番号（同時に動けるゲームなどで決まらないときは null）,
//   canAct(局面, p) → p がいま手を打てるか,
//   apply(局面, 手) → 次の局面 | null。手には打った人の番号 p が入っている（本体が足す）,
//   result(局面) → null | { winner: p, …ゲームが使う情報 }（3人以上で順位が付くゲームは、成績表の順位で点のため順位が分かる欄も持つ。下の seatPoints）,
//   cpu(局面, p) → p の手（p は付けなくてよい。いまは何もしないなら null）。ホストの端末だけで動く,
//   render(要素, 局面, { me: 自分の番号（観戦は -1）, names: 各プレイヤーの名前, cpu: CPU が操作中か, sub: 部屋を出た人の席を CPU が代わりに打っているか,
//     away: 応答が無いか, canMove, onMove, fresh })。names は外から来た文字なので textContent で出すか esc() を通す。
//   任意: settings（詳細設定 [{ key, label, desc, def, choices?: [[値, 表示名]…] }]。choices が無ければ はい/いいえ）, carry(局面, p)（次の対局へ持ち越す値。終局後に呼ばれる）,
//     resultText(result, 自分の番号, 名前→HTML) / phaseText(局面, 自分の番号, 名前→HTML)（手番が null のときの状態表示）,
//     cpuDelay(局面, p)（CPU が打つまでの待ち時間 ms。結果を見せたいときに長くする）,
//     seats(rules) → 人数（詳細設定で人数が決まるゲーム。待合室の足りない席はすべて CPU）,
//     noCpu: true（CPU を入れないゲーム。人が minPlayers そろうまで始められない。部屋を出た人の席だけ cpu() が動く）,
//     referee(局面) → null | { key, ms, move }（時間で進むゲーム。ホストが key ごとに ms 計って move を p = -1 として足す。
//     締め切りや次の問題へ進むのに使う。apply は p = -1 の手をこの進行役の手として受け付ける）,
//     realtime: true（全員が同時に動くゲーム。手がぶつかったらホストが後ろに足し直すので、手は「どの札を」で表し、
//     同じ手が2回来ても2回目は反則になるように作る）,
//     concurrent(局面)（realtime でないゲームで、みんなが同時に押す場面なら true。その間だけホストが手を足し直す。ポーカーの結果の OK）,
//     onStream(中身, 送った人の番号)（見た目だけの中身を受け取る。render の opts.stream(中身) で送ったものが、手の一覧に入らずに届く。
//     届いたか確かめずに送る。弾幕回避のほかの人の位置・玉入れの仲間の玉）,
//     evenTeams: true（チームで分かれるゲーム。待合室で全員の数を偶数にそろえ、CPU を2人ずつ増減する。玉入れ）,
//     record（自己ベストのランキングに入れるゲーム。2026-10-22 本人の決定。main.js と records.js が使う）:
//       { label: 何の数字か, of(終局の局面, p) → その席の数字（整数・大きいほど良い）| null, fmt(数字) → 表示の文字,
//         keys: 記録を分ける詳細設定の key の一覧, gc: そのうち Game Center のランキングも分ける key（ほかの key が最初の値のときだけ送る）,
//         norm(rules)（任意。使われない設定を最初の値にそろえる） }
//
// 効果音（盤のゲーム・カードゲームとも任意。名前は sound.js の先頭の一覧）:
//   sound(前の局面, 今の局面, 手, 自分の番号) → 新しい手が届いたときに鳴らす音の名前 | null（鳴らさない）。
//     無ければ盤のゲームは place、カードゲームは card。対局が終わった手では呼ばれず、勝ち負けの音が鳴る（main.js の moveSound）,
//   startSound（対局の始めに鳴らす音の名前。カードゲームの shuffle）
//
// 毎フレーム動くゲーム（live: true。エアホッケー）が持つもの: id / name / icon / desc / ready / players（席の呼び名）/ settings / seatCount（任意。上と同じ）,
//   mount(要素, { mode: 'cpu' | 'two' | 'online', status: 状態表示の要素, me（オンライン: 席の番号、観戦は -1）, names, rules,
//     send(中身, 大事か), isHost, cpuSeats()（CPU が動かす席の番号。部屋を出た人の席も入る） }) → { receive(中身, 送った人の番号), destroy() }。
//   手の一覧は使わず、ゲームが自分で描いて自分で進める。オンラインでは send で送った中身が相手の receive に届く
//   （大事でないものは届いたか確かめずに送る）。待合室は盤のゲームと同じで、CPU は liveCpu(rules) が true のとき（エアホッケーの3人）だけ選べる。

import tictactoe from './tictactoe.js';
import connect4 from './connect4.js';
import reversi from './reversi.js';
import colors from './colors.js';
import daifugo from './daifugo.js';
import poker from './poker.js';
import speed from './speed.js';
import hitblow from './hitblow.js';
import sensou from './sensou.js';
import yubisuma from './yubisuma.js';
import tamebeam from './tamebeam.js';
import memory from './memory.js';
import nim from './nim.js';
import flags from './flags.js';
import kanji from './kanji.js';
import targets from './targets.js';
import umigame from './umigame.js';
import shogi from './shogi.js';
import mahjong from './mahjong.js';
import hockey from './hockey.js';
import gomoku from './gomoku.js';
import dots from './dots.js';
import babanuki from './babanuki.js';
import doubt from './doubt.js';
import yacht from './yacht.js';
import wordwolf from './wordwolf.js';
import jinro from './jinro.js';
import sevens from './sevens.js';
import mancala from './mancala.js';
import oekaki from './oekaki.js';
import seri from './seri.js';
import blackjack from './blackjack.js';
import kaisen from './kaisen.js';
import pittari from './pittari.js';
import typing from './typing.js';
import hasami from './hasami.js';
import hitai from './hitai.js';
import kioku from './kioku.js';
import danmaku from './danmaku.js';
import tamaire from './tamaire.js';
import machigai from './machigai.js';
import bombs from './bombs.js';
import make10 from './make10.js';
import ishin from './ishin.js';
import karuta from './karuta.js';
import acchi from './acchi.js';
import daruma from './daruma.js';
import slide from './slide.js';
import nanpure from './nanpure.js';
import { HOWTO } from './howto.js';
import { FIGS } from './howto-fig.js';

// 準備中のゲームを一覧に出すとき: soon('id', '名前', '絵文字')
export const soon = (id, name, icon) => ({ id, name, icon, desc: 'じゅんび中', ready: false });

export const GAME_ORDER = ['tictactoe', 'connect4', 'reversi', 'gomoku', 'dots', 'mancala', 'kaisen', 'colors', 'daifugo', 'poker', 'speed', 'babanuki', 'doubt', 'sevens', 'blackjack', 'hitai', 'hitblow', 'sensou', 'yubisuma', 'tamebeam', 'acchi', 'memory', 'yacht', 'seri', 'nim', 'flags', 'kanji', 'karuta', 'make10', 'slide', 'nanpure', 'targets', 'pittari', 'kioku', 'typing', 'danmaku', 'tamaire', 'machigai', 'bombs', 'daruma', 'umigame', 'wordwolf', 'ishin', 'jinro', 'oekaki', 'hockey', 'hasami', 'shogi', 'mahjong'];
export const GAMES = {
  tictactoe, connect4, reversi, colors, daifugo, poker, speed, hitblow, sensou, yubisuma, memory, nim, flags, kanji, targets, umigame, shogi, mahjong, hockey,
  gomoku, dots, babanuki, doubt, yacht, wordwolf, jinro, sevens, mancala, oekaki, seri, blackjack, kaisen, pittari, typing, danmaku, tamaire, machigai, bombs, hasami, hitai, kioku, tamebeam, make10, ishin, karuta, acchi, daruma, slide, nanpure,
};
// 遊び方（howto.js）。対局画面の「？遊び方」で出す（main.js の renderHowto）
for (const [id, lines] of Object.entries(HOWTO)) if (GAMES[id]) GAMES[id].howto = lines;
// 遊び方の図（howto-fig.js）。「？遊び方」の上に出し、howto の文は「くわしく」に畳む
for (const [id, figs] of Object.entries(FIGS)) if (GAMES[id]) GAMES[id].howtoFigs = figs;

// 結果から勝った人のプレイヤー番号の一覧（引き分けは空）
export function winnersOf(res) {
  if (Array.isArray(res.winners)) return res.winners.filter(Number.isInteger);
  return Number.isInteger(res.winner) ? [res.winner] : [];
}

// 部屋の成績表の「順位で点」（2026-10-24 本人の決定。28回目の案）: 席ごとの点 ＝ その対局で自分より下の順位になった人の数
// （4人で1位なら3点・2位なら2点、2人で勝てば1点。同じ順位の人は数えない。引き分けはだれも0点）。n は席の数（CPU も入る）。
// 結果の形はゲームごとに違うので、次の順で「強さ」（大きいほど上）を決める。ゲームの結果に足す欄の約束でもある:
//   place（席ごとの順位。1 が一番上。同じ順位がありうるゲームはこれを持つ）→ ranking と places（ranking の並びごとの順位。ひたいカード）→
//   ranking と pts（席ごとの合計点。点数で勝負する回数制）→ ranking（上から並べた席。同じ順位なし）→ scores（席ごとの点。teams があるチーム戦は使わない）→
//   勝った人だけ（勝った人が上・ほかは同じ）。勝った人がいないときは、負けた人（loser）だけが下（ほかは同じ）、それも無ければ引き分け。draw: true も引き分け。
export function seatPoints(res, n) {
  const w = winnersOf(res);
  const none = Array(n).fill(0);
  if (res.draw === true) return none;
  if (!w.length) return Number.isInteger(res.loser) ? none.map((_, p) => (p === res.loser ? 0 : 1)) : none;
  const okArr = (a) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const rk = Array.isArray(res.ranking) ? res.ranking.filter((p) => Number.isInteger(p) && p >= 0 && p < n) : null;
  let st;
  if (okArr(res.place)) st = res.place.map((v) => -v);
  else if (rk && Array.isArray(res.places) && res.places.length === res.ranking.length) {
    st = Array(n).fill(-Infinity);
    res.ranking.forEach((p, i) => { if (rk.includes(p) && Number.isFinite(res.places[i])) st[p] = -res.places[i]; });
  } else if (rk && okArr(res.pts)) st = res.pts.slice();
  else if (rk) {
    st = Array(n).fill(-Infinity); // 並びに入っていない席は一番下
    rk.forEach((p, i) => { st[p] = n - i; });
  } else if (okArr(res.scores) && res.teams === undefined) st = res.scores.slice();
  else st = none.map((_, p) => (w.includes(p) ? 1 : 0));
  // 勝った人（同点の1位を含む）は同じ一番上にそろえる（並びの都合で勝った人どうしに差が付かないように）
  const top = Math.max(...st.filter(Number.isFinite), 0) + 1;
  for (const p of w) if (p >= 0 && p < n) st[p] = top;
  return st.map((v) => st.filter((x) => x < v).length);
}
