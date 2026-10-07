// いろあわせ（UNO と同じ遊び方のカードゲーム。UNO は Mattel 社の商標なので名前を変えている）。
// 2〜10人。手札を最初に出し切った人の勝ち（1回勝負・点数計算なし）。
//
// 札: 色1文字 + 中身。色 r赤 y黄 g緑 b青。中身 0〜9 / S（スキップ）/ R（リバース）/ D（ドロー2）。
//     色の無い札は 'W'（ワイルド）と 'W4'（ワイルドドロー4）。全108枚。
// 手: { p, t: 'play', i: 手札の何枚目か（手札は常に並べ替え済み）, c: ワイルドで選ぶ色, to: 「7で交換」の相手（3人以上のときだけ） }
//     { p, t: 'draw' }（山から1枚引く。重ね返し・チャレンジの返事待ちの途中なら、たまった枚数を全部引く） / { p, t: 'pass' }（引いた札を出さずに次へ）
//     { p, t: 'challenge' }（詳細設定「チャレンジ」で、ワイルドドロー4を出された人がチャレンジする）
//
// 公式ルールから変えた所（ネット対戦向けに簡単にした。変えるなら本人に確認）:
//   - 最初にめくる札は、数字の札が出るまでめくり直す。
//   - 出せる札があっても山から引いてよい。引いた札が出せるなら、その札だけ続けて出せる（出さずに次へも可）。
//   - ワイルドドロー4は、場の色と同じ色の札を持っていないときだけ出せる（公式の「チャレンジ」の代わり。チャレンジのある遊び方は詳細設定「チャレンジ」（下））。
//   - ドロー2・ドロー4は重ねて返せない（詳細設定「重ねて返す」で返せる。下）。2人のときリバースはスキップと同じ。
//   - 残り1枚の宣言は省略（自動で「ラスト1枚」と表示）。宣言をする遊び方は詳細設定「最後の1枚の宣言」（下）。
//   - 山が尽きたら、捨て札の一番上を残して切り直す。
// 詳細設定「重ねて返す」（2026-10-06 本人の決定。最初はなし）: ドロー2を出された人はドロー2を、ドロー4を出された人はドロー4を
//   重ねて次の人へ回せる（同じ種類どうしだけ。色は問わない）。重ねなかった人（山をタップ）は、たまった枚数を全部引いて1回休み。
//   返すときのドロー4は、場の色の札を持っていても出せる（本人の決定）。重ね返しの途中（s.pend）は、ほかの札は出せない。
// 詳細設定「7で交換・0で回す」（2026-10-06 本人の決定。最初はなし）: 7を出した人は、選んだ1人と手札をまるごと交換する（2人なら相手と）。
//   0を出したら、全員が手札をいま回っている向きの次の人へ渡す。出してちょうど手札がなくなったときは交換も回しもせず上がり（Claude の判断）。
//   CPU は手札がいちばん少ない人と交換する。
// 詳細設定「同じ数字まとめ出し」（2026-10-06 本人の決定。最初はなし）: 数字の札は、同じ数字の札を何枚でもまとめて出せる（記号の札は1枚ずつ）。
//   手の more に、いっしょに出す札の位置を出す順に入れる。最後に置いた札の色が場の色になる。Claude の判断: 引いた札は1枚だけ・
//   7・0 をまとめて出しても交換・回しは1回。CPU は同じ数字を全部出し、手元に多く残る色を一番上にする。
// 詳細設定「出せるまで引く」（2026-10-06 本人の決定。決まりは Claude の推奨を本人が承認。最初はなし）: 山を1回押すと、出せる札が来るまでまとめて引く。
//   来た札は「出す」か「出さずに次へ」を選べる（今までと同じ）。出せる札を持っていても引いてよい。山と捨て札が尽きたらそこでやめて次の人へ。
//   重ね返しの途中（s.pend）で引くときは、今までどおりたまった枚数だけ引く。
// 詳細設定「最後の1枚の宣言」（2026-10-06 本人の決定。最初はなし）: 出したあと手札が1枚になるときは、出す前に「いろあわせ！」ボタンを押しておく
//   （手の call: true）。押さずに1枚になったら、その場で山から2枚引く。Claude の判断: ボタンは自分の番の間ずっと出す（1枚になるときだけ出すと
//   覚えていなくても気づけてしまうため）。手札が何枚でも押してよい（1枚にならなければ何も起きない）。7で交換・0で回すのあとは、
//   出し終わった時点で自分が持っている手札で数える。上がり（0枚）のときは要らない。CPU は1割5分の見込みで宣言を忘れる。
// 詳細設定「手札の上限」（2026-10-06 本人の決定。最初はなし）: 手札が25枚を超えたら（26枚になったら）脱落。脱落した人の手札は山の下に戻し、
//   その人を飛ばして続ける。残りが1人になったらその人の勝ち（Claude の判断）。2人が残っているときのリバースはスキップと同じ（今までの2人と同じ）。
//   7で交換・0で回すは、脱落していない人の間だけで行う。
// 詳細設定「チャレンジ」（2026-10-06 本人の決定。最初はなし）: ワイルドドロー4はいつでも出せる。出された次の人は「チャレンジ」か
//   「受ける」（山をタップ。4枚引いて1回休み。今までと同じ）を選ぶ。チャレンジしたとき、出した人がそのとき場の色（出す前の色）の札を
//   持っていたら（うそ）出した人が4枚引き、チャレンジした人は引かずにふつうに自分の番をする。持っていなかったら、チャレンジした人が6枚引いて1回休み。
//   結果は「持っていた／持っていなかった」だけを全員に出す（手札そのものは見せない）。
//   作り: 返事を待つ間は重ね返しと同じ s.pend（{ k: 'W4', n: 4, ch: { p: 出した人, color: 出す前の色, bluff: 持っていたか } }）。
//   bluff は apply の中で出す前の局面から求めるので、手の一覧から必ず同じ結果になる。Claude の判断: 「重ねて返す」と一緒のときは、
//   たまった枚数がちょうど4（最初のドロー4）のときだけチャレンジでき（重ねて返す・チャレンジ・受けるの3つ）、重ねられたらできない。
//   CPU は場の色を持っていても3割ほどドロー4を出し（うそ）、チャレンジは3割前後（出した人の手札が少ない・自分の手札が多いと少し増える）。
//   CPU は全員の札を見られる作りだが、bluff や出した人の手札は見ずに決める。
// 詳細設定「最初の手札」（2026-10-07 本人の決定。5枚・7枚（最初。今までと同じ）・10枚）: 配る枚数だけを変える。配り方（山の後ろから
//   1人ずつまとめて取る）は今までと同じなので、7枚なら今までと全く同じ配り方になる。Claude の判断:
//   - 配ったあとの山は、今までのいちばん少ない場合（10人×7枚のあとの38枚）より少なくしない。足りなければ配る枚数を減らす
//     （10枚なら 8人で8枚、9〜10人で7枚。5枚・7枚は何人でも減らない）。最初にめくる札は数字の札が出るまでめくり直すので、
//     山に数字でない札（32枚）より多く残っていないと終わらなくなるため。減らしたときは最初の説明に「手札は○枚ずつ」と出す。
//   - 「手札の上限」は、最初の手札＋15枚と25枚の大きい方（capOf）。今選べる枚数（10枚まで）ではいつも25枚のまま。
//     上限が最初の手札に近すぎる（少なすぎる）ことが無いように、の守りとして書いておく。
// 詳細設定「点数で勝負」（2026-10-07 の18回目の案。なし（最初。1回勝負）・3回戦・5回戦）: 決めた回数だけ続けて遊ぶ。上がった人が、
//   ほかの人の残りの札の点（数字はその数・スキップ／リバース／ドロー2は20点・ワイルド／ワイルドドロー4は50点。本家と同じ）をもらい、
//   全部の回の合計点がいちばん多い人の勝ち（同じ点なら全員の勝ち）。Claude の判断:
//   - 1回が終わると、残りの札と点を見せる（局面の match.gap）。だれか（対局している人）が「次の回へ」（手 { p, t: 'next' }）を押すと配り直す。
//     CPU は3秒待ってから押す（ポーカーの「次の勝負へ」と同じ形）。最後の回は「次の回へ」なしで、そのまま結果。
//   - 配り直しの種は対局の種と回の数から作る（hseed）。最初に出す人は回ごとに1つずつ回す（2回目は2番目の人から）。
//   - 手札の上限で脱落した人の札は、脱落したときの点を覚えておき（lost）、その回に上がった人がもらう。
//   - なしのときは局面に何も足さない（今までと全く同じ形）。


import { mulberry32, shuffle } from './util.js';

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAME = { r: '赤', y: '黄', g: '緑', b: '青' };
const KINDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D'];
const KIND_LABEL = { S: '⊘', R: '⇄', D: '+2', W: '', W4: '+4' };
const KIND_NAME = { S: 'スキップ', R: 'リバース', D: 'ドロー2' };
const HAND_SIZE = 7; // 最初の手札（詳細設定「最初の手札」の最初の値）
const DEALS = [5, 7, 10]; // 最初の手札で選べる枚数
const DECK_MIN = 108 - 10 * HAND_SIZE; // 配ったあとの山に残す枚数（今までのいちばん少ない場合。38枚）
const CAP = 25; // 手札の上限（詳細設定）。これを超えたら脱落

// 最初の手札（詳細設定）で配る枚数。山が DECK_MIN より少なくなるときは減らす
const dealOf = (n, rules) => Math.min(DEALS.includes(rules?.deal) ? rules.deal : HAND_SIZE, Math.floor((108 - DECK_MIN) / n));
// 手札の上限。最初の手札＋15枚より少なくしない（今選べる枚数ではいつも25枚）
const capOf = (s) => Math.max(CAP, dealOf(s.n, s.rules) + 15);

// 点数で勝負（詳細設定）: 札の点と、手札の点の合計
const MATCHES = [3, 5];
const cardPts = (c) => (c[0] === 'W' ? 50 : isNumber(c) ? Number(c[1]) : 20);
const handPts = (h) => h.reduce((a, c) => a + cardPts(c), 0);
// n 回目の配りの種（1回目は対局の種そのまま＝今までと同じ配り）
const handSeed = (seed, no) => (no === 1 ? seed : (seed ^ Math.imul(no, 0x9e3779b1)) >>> 0);

const isOut = (s, q) => !!s.out?.[q];
const aliveCount = (s) => s.hands.filter((_, q) => !isOut(s, q)).length;
// from から dir の向きに、脱落していない人を k 人進んだ席
const stepAlive = (s, from, k, dir = s.dir) => {
  let q = from;
  for (let i = 0; i < k;) { q = (((q + dir) % s.n) + s.n) % s.n; if (!isOut(s, q)) i++; }
  return q;
};
// 手札の上限（詳細設定）を超えたら脱落させる（手札は山の下へ）。残りが1人ならその人の勝ち
function checkCap(s, q) {
  if (!s.rules?.cap || isOut(s, q) || s.hands[q].length <= capOf(s)) return;
  s.out = (s.out ?? Array(s.n).fill(false)).slice();
  s.out[q] = true;
  if (s.match) { s.lost = (s.lost ?? Array(s.n).fill(0)).slice(); s.lost[q] = handPts(s.hands[q]); } // 点数で勝負: 脱落したときの点
  s.deck = [...s.hands[q], ...s.deck];
  s.hands[q] = [];
  if (s.last) s.last.out = [...(s.last.out ?? []), q];
  if (aliveCount(s) === 1) s.winner = s.hands.findIndex((_, r) => !isOut(s, r));
}

const colorOf = (c) => (c[0] === 'W' ? null : c[0]);
const kindOf = (c) => (c[0] === 'W' ? c : c.slice(1));
const isNumber = (c) => /^[rygb]\d$/.test(c);

function sortKey(c) {
  if (c === 'W') return 100;
  if (c === 'W4') return 101;
  return COLORS.indexOf(c[0]) * 20 + KINDS.indexOf(c.slice(1));
}
const sortHand = (h) => h.sort((a, b) => sortKey(a) - sortKey(b));

export function makeDeck() {
  const d = [];
  for (const c of COLORS) {
    d.push(c + '0');
    for (const k of KINDS.slice(1)) d.push(c + k, c + k);
  }
  for (let i = 0; i < 4; i++) d.push('W', 'W4');
  return d;
}

export function cardName(c) {
  if (c === 'W') return 'ワイルド';
  if (c === 'W4') return 'ワイルドドロー4';
  const k = kindOf(c);
  return COLOR_NAME[c[0]] + 'の' + (KIND_NAME[k] ?? k);
}

function canPlay(s, p, card) {
  // 重ね返しの途中は同じ種類だけ（チャレンジの返事待ちで「重ねて返す」がなしなら、札は出せない）
  if (s.pend) return !!s.rules?.stack && kindOf(card) === s.pend.k;
  if (card === 'W') return true;
  if (card === 'W4') return !!s.rules?.challenge || !hasColor(s, p, s.color);
  const top = s.discard[s.discard.length - 1];
  return colorOf(card) === s.color || kindOf(card) === kindOf(top);
}

// p が色 color の札を持っているか（ワイルドは数えない）
const hasColor = (s, p, color) => s.hands[p].some((c) => colorOf(c) === color);

const clone = (s) => ({ ...s, deck: s.deck.slice(), discard: s.discard.slice(), hands: s.hands.map((h) => h.slice()) });

// 山から k 枚引いて手札に入れる（s を書き換える）。引けた札を返す
function drawInto(s, p, k) {
  const got = [];
  while (got.length < k) {
    if (!s.deck.length) {
      if (s.discard.length < 2) break; // 山も捨て札も無い
      const top = s.discard.pop();
      s.shuffles += 1;
      s.deck = shuffle(s.discard, mulberry32((s.hseed ?? s.seed) + s.shuffles * 0x9e3779b9));
      s.discard = [top];
    }
    const c = s.deck.pop();
    got.push(c);
    s.hands[p].push(c);
  }
  sortHand(s.hands[p]);
  return got;
}

function pickColor(hand, skip) {
  const count = { r: 0, y: 0, g: 0, b: 0 };
  hand.forEach((c, i) => { if (i !== skip && colorOf(c)) count[c[0]]++; });
  const best = Math.max(...Object.values(count));
  const cands = COLORS.filter((c) => count[c] === best);
  return cands[Math.floor(Math.random() * cands.length)];
}

/* ---------- 画面 ---------- */

let called = false; // 最後の1枚の宣言（詳細設定）を、この番で押したか（この端末だけ。出す手に call として付ける）
let picking = null; // ワイルドの色（7で交換なら相手、まとめ出しならいっしょに出す札）を選んでいる途中 { step, i, seven, multi: [位置…], more }（通信で描き直されても閉じないよう外に持つ）

// 札の絵（2026-10-04 本人の希望で本家風に。ロゴや本家の絵は写さず、形だけ似せて自分で描いた）。
// 色の札は「色の地・斜めの白い楕円・縁取りした大きな数字や記号・左上と右下に小さく同じもの」。6 と 9 は下線で見分ける。
const OUTLINE = '#2d2a26';
const svg = (body) => `<svg class="ccard-sym" viewBox="0 0 100 100" aria-hidden="true">${body}</svg>`;
// 縁取り: 太い黒の線の上に、札の色の線を重ねる
const stroked = (d, w) => `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="${w + 7}" stroke-linecap="round" stroke-linejoin="round"/>`
  + `<path d="${d}" fill="none" stroke="var(--cc)" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const smallCard = (x, y, rot, fill) => `<rect x="${x}" y="${y}" width="30" height="44" rx="5" transform="rotate(${rot} ${x + 15} ${y + 22})" fill="${fill}" stroke="${OUTLINE}" stroke-width="4"/>`;
const SYMBOL = {
  S: svg(stroked('M50 22 A28 28 0 1 1 49.9 22 Z M30 70 L70 30', 11)),
  R: svg(stroked('M16 54 L48 22 M48 22 L32 22 M48 22 L48 38', 9) + stroked('M84 46 L52 78 M52 78 L68 78 M52 78 L52 62', 9)),
  D: svg(smallCard(24, 34, -12, 'var(--cc)') + smallCard(44, 20, -12, 'var(--cc)')),
  W4: svg(smallCard(12, 40, -12, '#2f6fb3') + smallCard(28, 26, -12, '#3a9d55') + smallCard(42, 34, -12, '#e8a913') + smallCard(58, 20, -12, '#e04b3c')),
};

function cardEl(card, tag = 'div') {
  const e = document.createElement(tag);
  const k = kindOf(card);
  const corner = KIND_LABEL[k] ?? k;
  const big = SYMBOL[k] ?? (k === 'W' ? '' : `<span class="ccard-num${k === '6' || k === '9' ? ' ul' : ''}">${k}</span>`);
  const small = k === 'S' || k === 'R' ? SYMBOL[k] : k === '6' || k === '9' ? `<span class="ul">${k}</span>` : corner;
  e.className = `ccard c-${colorOf(card) ?? 'w'} k-${k}`;
  e.innerHTML = `<span class="ccard-oval"></span><span class="ccard-face">${big}</span>`
    + `<span class="ccard-corner">${small}</span><span class="ccard-corner br">${small}</span>`;
  e.setAttribute('aria-label', cardName(card));
  return e;
}

// 手札の上限（詳細設定）で脱落した人
const outText = (s, L, nameP) => (L.out?.length ? `。${L.out.map(nameP).join('・')}は手札が${capOf(s)}枚を超えたので脱落` : '');

function logText(s, nameP) {
  const L = s.last;
  if (!L) {
    // 最初の手札（詳細設定）を人数に合わせて減らしたときは、その枚数も出す
    const k = dealOf(s.n, s.rules);
    const less = DEALS.includes(s.rules?.deal) && k < s.rules.deal ? `（人数が多いので、手札は${k}枚ずつ）` : '';
    const no = s.match && s.match.no > 1 ? `第${s.match.no}回を配りました。` : '';
    return `${no}最初の札は「${cardName(s.discard[0])}」${less}`;
  }
  if (L.t === 'draw') return (L.got ? `${nameP(L.p)}が山から${L.got}枚引いた${L.got > 1 && L.drew ? '（出せる札が来た）' : ''}` : '山札が無いので引けなかった') + outText(s, L, nameP);
  if (L.t === 'pass') return `${nameP(L.p)}は引いた札を出さずに次へ`;
  if (L.t === 'take') return `${nameP(L.p)}が${L.got}枚引いて1回休み` + outText(s, L, nameP);
  if (L.t === 'challenge') { // チャレンジ（詳細設定）の結果。手札そのものは見せない
    const t = `${nameP(L.p)}がチャレンジ → ${nameP(L.by)}は場の色（${COLOR_NAME[L.color]}）の札を`;
    return (L.bluff
      ? t + `持っていた。チャレンジ成功で、${nameP(L.by)}が${L.got}枚引いた`
      : t + `持っていなかった。チャレンジ失敗で、${nameP(L.p)}が${L.got}枚引いて1回休み`) + outText(s, L, nameP);
  }
  let t = L.n > 1 ? `${nameP(L.p)}が「${kindOf(L.card)}」を${L.n}枚まとめて出した（一番上は${COLOR_NAME[L.color]}）` : `${nameP(L.p)}が「${cardName(L.card)}」を出した`;
  if (L.card[0] === 'W') t += `（次の色: ${COLOR_NAME[L.color]}）`;
  const k = kindOf(L.card);
  if (L.swap !== undefined) t += ` → ${nameP(L.p)}と${nameP(L.swap)}が手札を交換`;
  else if (L.rotate) t += ' → 全員が手札を次の人へ渡した';
  else if (L.victim !== undefined && (k === 'S' || k === 'R')) t += ` → ${nameP(L.victim)}は1回休み`;
  else if (k === 'R') t += ' → 回る向きが反対に';
  else if (L.ch) t += ` → 次の人は${s.rules?.stack ? '重ねて返すか、' : ''}チャレンジするか、${L.pend}枚引く`;
  else if (L.pend) t += ` → たまって${L.pend}枚。次の人は重ねて返すか、${L.pend}枚引く`;
  else if (L.victim !== undefined) t += ` → ${nameP(L.victim)}が${L.got}枚引いて1回休み`;
  if (L.call) t += '。「いろあわせ！」';
  else if (L.forgot) t += `。宣言を忘れたので${L.forgot}枚引いた`;
  return t + outText(s, L, nameP);
}

// 札を配って最初の札をめくる（init と、点数で勝負の配り直し）
function deal(n, seed, rules) {
  const deck = shuffle(makeDeck(), mulberry32(seed));
  const k = dealOf(n, rules); // 最初の手札（詳細設定）。7枚なら今までと同じ配り方
  const hands = Array.from({ length: n }, () => sortHand(deck.splice(-k)));
  let top = deck.pop();
  while (!isNumber(top)) { deck.unshift(top); top = deck.pop(); }
  return { deck, discard: [top], hands, color: top[0] };
}

// 点数で勝負: だれかが上がった（s.winner）局面に、点を足して回の結果（gap）を書く。最後の回なら合計点で勝った人を s.winner に入れる
function settle(s) {
  const w = s.winner;
  const left = s.hands.map((h) => h.slice());
  const lost = s.lost ?? Array(s.n).fill(0);
  const gain = left.reduce((a, h, q) => a + (q === w ? 0 : handPts(h) + lost[q]), 0);
  const pts = s.match.pts.slice();
  pts[w] += gain;
  s.match = { ...s.match, pts, gap: { w, gain, left, lost } };
  if (s.match.no < s.match.of) { s.winner = null; return; }
  s.match.final = true;
  s.winner = pts.indexOf(Math.max(...pts));
}

// 点数で勝負: 次の回を配る（最初に出す人は回ごとに1つずつ回す）
function nextHand(s0, p) {
  const no = s0.match.no + 1;
  const hseed = handSeed(s0.seed, no);
  const s = { ...s0, ...deal(s0.n, hseed, s0.rules), hseed, pend: null, shuffles: 0, turn: (no - 1) % s0.n, dir: 1, drawn: null, step: s0.step + 1, last: null };
  delete s.out;
  delete s.lost;
  s.match = { ...s0.match, no, gap: null };
  return s;
}

// 点数で勝負: 回の結果（上がった人・ほかの人の残りの札と点・合計点・「次の回へ」）
function gapEl(s, o, nameP) {
  const M = s.match;
  const g = M.gap;
  const box = document.createElement('div');
  box.className = 'cc-gap';
  const title = document.createElement('p');
  title.className = 'cc-gap-title';
  title.textContent = `第${M.no}回は ${nameP(g.w)} の上がり！ +${g.gain}点`;
  box.append(title);
  const list = document.createElement('div');
  list.className = 'cc-gap-list';
  for (let k = 1; k < s.n; k++) {
    const q = (g.w + k) % s.n;
    const row = document.createElement('div');
    row.className = 'cc-gap-row';
    const nm = document.createElement('span');
    nm.className = 'cc-gap-name';
    nm.textContent = nameP(q);
    const cards = document.createElement('span');
    cards.className = 'cc-gap-cards';
    for (const c of g.left[q]) cards.append(cardEl(c));
    if (g.lost[q]) cards.append(`脱落（${g.lost[q]}点）`);
    const pt = document.createElement('b');
    pt.textContent = `${handPts(g.left[q]) + g.lost[q]}点`;
    row.append(nm, cards, pt);
    list.append(row);
  }
  box.append(list);
  const total = document.createElement('p');
  total.className = 'cc-gap-total';
  const order = M.pts.map((_, p) => p).sort((a, b) => M.pts[b] - M.pts[a] || a - b);
  total.append('合計: ');
  for (const p of order) {
    const one = document.createElement('span'); // 名前と点の途中で折り返さない
    one.textContent = `${nameP(p)} ${M.pts[p]}点`;
    total.append(one);
  }
  box.append(total);
  if (!M.final && o.canMove) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn primary';
    b.textContent = `次の回へ（第${M.no + 1}回）`;
    b.onclick = () => o.onMove({ t: 'next' });
    box.append(b);
  } else if (!M.final) {
    const w = document.createElement('p');
    w.className = 'cc-log';
    w.textContent = '「次の回へ」が押されるのを待っています';
    box.append(w);
  }
  return box;
}

export default {
  id: 'colors',
  name: 'いろあわせ',
  icon: '🃏',
  desc: '色か数字が同じ札を出していく。手札を最初に出し切った人の勝ち（UNO と同じ遊び方）',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,

  settings: [
    { key: 'deal', label: '最初の手札', desc: '最初に配る枚数。5枚は短い勝負、10枚は長い勝負（人数が多いと山が足りるように少し減らす）', def: HAND_SIZE, choices: [[5, '5枚'], [7, '7枚'], [10, '10枚']] },
    { key: 'stack', label: '重ねて返す', desc: 'ドロー2にはドロー2、ドロー4にはドロー4を重ねて次の人へ回せる。重ねなかった人が、たまった枚数を全部引く', def: false },
    { key: 'multi', label: '同じ数字まとめ出し', desc: '同じ数字の札を何枚でもまとめて出せる（数字の札だけ）。最後に置いた札の色が場の色になる', def: false },
    { key: 'untilPlay', label: '出せるまで引く', desc: '山を1回押すと、出せる札が来るまでまとめて引く（来た札は出しても出さなくてもよい）', def: false },
    { key: 'cap', label: '手札の上限', desc: '手札が25枚を超えたら脱落（その人を飛ばして続け、最後に残った1人も勝ち）', def: false },
    { key: 'call', label: '最後の1枚の宣言', desc: '手札が1枚になる札を出すときは、先に「いろあわせ！」を押す。忘れたら2枚引く', def: false },
    { key: 'challenge', label: 'チャレンジ', desc: 'ワイルドドロー4をいつでも出せる。出された人は「チャレンジ」できる。出した人が場の色の札を持っていたら出した人が4枚、持っていなかったらチャレンジした人が6枚引く', def: false },
    { key: 'match', label: '点数で勝負', desc: '決めた回数だけ続けて遊ぶ。上がった人が、ほかの人の残りの札の点（数字はその数・記号は20点・ワイルドは50点）をもらい、合計点がいちばん多い人の勝ち', def: 0, choices: [[0, 'なし（1回勝負）'], [3, '3回戦'], [5, '5回戦']] },
    { key: 'sevenZero', label: '7で交換・0で回す', desc: '7を出したら、選んだ1人と手札を交換する。0を出したら、全員が手札を次の人へ渡す（回っている向き）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const s = { n, seed, rules: { stack: false, sevenZero: false, ...rules }, pend: null, shuffles: 0, ...deal(n, seed, rules), turn: 0, dir: 1, drawn: null, winner: null, step: 0, last: null };
    // 点数で勝負（詳細設定）。なしのときは局面に何も足さない
    if (MATCHES.includes(rules.match)) s.match = { of: rules.match, no: 1, pts: Array(n).fill(0), gap: null };
    return s;
  },

  turn(s) { return s.winner === null && !s.match?.gap ? s.turn : null; },
  // 点数で勝負の回の間は、対局しているだれでも「次の回へ」を押せる
  canAct(s, p) { return s.winner === null && (s.match?.gap ? Number.isInteger(p) && p >= 0 && p < s.n : s.turn === p); },
  result(s) {
    if (s.winner === null) return null;
    if (!s.match) return { winner: s.winner };
    // 点数で勝負: 合計点の多い順（同じ点なら席の順）。いちばん多い人が2人以上なら全員の勝ち
    const pts = s.match.pts;
    const ranking = pts.map((_, p) => p).sort((a, b) => pts[b] - pts[a] || a - b);
    const top = ranking.filter((p) => pts[p] === pts[ranking[0]]);
    return top.length > 1 ? { winner: ranking[0], winners: top, ranking, pts } : { winner: ranking[0], ranking, pts };
  },
  resultText(res, me, pn) {
    if (!res.pts) return res.winner === me ? 'あなたの勝ち！🎉' : `${pn(res.winner)}の勝ち！`;
    const pt = (p) => `${res.pts[p]}点`;
    if (res.winners) {
      const names = res.winners.map(pn).join('・');
      return `${names}が同じ点で優勝！（${pt(res.winners[0])}）${res.winners.includes(me) ? '🎉' : ''}`;
    }
    if (me >= 0) {
      const i = res.ranking.filter((q) => res.pts[q] > res.pts[me]).length; // 同じ点なら同じ順位
      return i === 0 ? `あなたの優勝！🎉（${pt(me)}）` : `あなたは${i + 1}位（${pt(me)}）。優勝は${pn(res.winner)}（${pt(res.winner)}）`;
    }
    return `${pn(res.winner)}の優勝！（${pt(res.winner)}）`;
  },
  phaseText(s, me, pn) {
    const g = s.match?.gap;
    if (!g) return '';
    return `第${s.match.no}回は${pn(g.w)}の上がり（+${g.gain}点）。「次の回へ」で配ります`;
  },
  cpuDelay(s) { return s.match?.gap ? 3000 : undefined; }, // 回の結果は少し長めに見せる
  startSound: 'shuffle',
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) {
    if (m.t === 'next') return 'shuffle';
    if (b.last?.call) return 'call';
    if (b.last?.forgot) return 'wrong';
    if (m.t === 'challenge') return b.last?.bluff ? 'correct' : 'wrong';
    return m.t === 'draw' ? 'draw' : m.t === 'pass' ? 'pop' : 'card';
  },

  apply(s0, m) {
    if (!m) return null;
    if (s0.match?.gap) { // 点数で勝負: 回の間は「次の回へ」だけ
      if (m.t !== 'next' || s0.winner !== null || !this.canAct(s0, m.p)) return null;
      return nextHand(s0, m.p);
    }
    if (m.t === 'next') return null;
    const s = this.applyHand(s0, m);
    if (s && s.winner !== null && s.match) settle(s);
    return s;
  },

  applyHand(s0, m) {
    if (s0.winner !== null || m.p !== s0.turn) return null;
    const s = clone(s0);
    const p = m.p;
    const next = (k) => stepAlive(s, p, k); // 脱落した人（手札の上限）は飛ばす
    s.step += 1;

    if (m.t === 'play') {
      if (!Number.isInteger(m.i)) return null;
      const card = s.hands[p][m.i];
      if (card === undefined || (s.drawn !== null && card !== s.drawn) || !canPlay(s0, p, card)) return null;
      const wild = card[0] === 'W';
      if (wild ? !COLORS.includes(m.c) : m.c !== undefined) return null;
      const swap = s.rules?.sevenZero && kindOf(card) === '7'; // 7で交換（詳細設定）
      if (swap && aliveCount(s) > 2 ? !Number.isInteger(m.to) || m.to < 0 || m.to >= s.n || m.to === p || isOut(s, m.to) : m.to !== undefined) return null;
      let more = [];
      if (m.more !== undefined) { // 同じ数字まとめ出し（詳細設定）
        const hand = s.hands[p];
        if (!s.rules?.multi || !isNumber(card) || s0.drawn !== null || !Array.isArray(m.more) || !m.more.length) return null;
        if (new Set([m.i, ...m.more]).size !== m.more.length + 1) return null;
        if (!m.more.every((j) => Number.isInteger(j) && isNumber(hand[j] ?? '') && kindOf(hand[j]) === kindOf(card))) return null;
        more = m.more.map((j) => hand[j]);
      }
      for (const j of [m.i, ...(m.more ?? [])].sort((a, b) => b - a)) s.hands[p].splice(j, 1);
      s.discard.push(card, ...more);
      const topCard = more.length ? more[more.length - 1] : card;
      s.color = wild ? m.c : topCard[0];
      s.drawn = null;
      const last = { p, t: 'play', card: topCard, color: s.color, n: 1 + more.length };
      s.last = last;
      if (!s.hands[p].length) { s.winner = p; return s; }
      const k = kindOf(card);
      if (swap) {
        const to = aliveCount(s) > 2 ? m.to : next(1);
        [s.hands[p], s.hands[to]] = [s.hands[to], s.hands[p]];
        last.swap = to;
      } else if (k === '0' && s.rules?.sevenZero) { // 0で回す（詳細設定）: 全員が次の人へ渡す
        const old = s.hands;
        s.hands = old.map((h, q) => (isOut(s, q) ? h : old[stepAlive(s, q, 1, -s.dir)]));
        last.rotate = true;
      }
      if (k === 'S') {
        last.victim = next(1);
        s.turn = next(2);
      } else if (k === 'R') {
        s.dir = -s.dir;
        if (aliveCount(s) === 2) { last.victim = next(1); s.turn = p; } else s.turn = next(1);
      } else if (((k === 'D' || k === 'W4') && s.rules?.stack) || (k === 'W4' && s.rules?.challenge)) {
        // 重ねて返す・チャレンジ: 引かせるのは、次の人の返事が決まってから
        s.pend = { k, n: (s0.pend?.n ?? 0) + (k === 'D' ? 2 : 4) };
        // チャレンジできるのは最初のドロー4だけ（重ねられたらできない）。うそかどうかは出す前の局面で決める
        if (k === 'W4' && s.rules?.challenge && !s0.pend) {
          s.pend.ch = { p, color: s0.color, bluff: hasColor(s0, p, s0.color) };
          last.ch = true;
        }
        last.pend = s.pend.n;
        s.turn = next(1);
      } else if (k === 'D' || k === 'W4') {
        last.victim = next(1);
        last.got = drawInto(s, last.victim, k === 'D' ? 2 : 4).length;
        checkCap(s, last.victim);
        s.turn = isOut(s, last.victim) ? next(1) : next(2);
      } else {
        s.turn = next(1);
      }
      // 最後の1枚の宣言（詳細設定）: 宣言せずに1枚になったら2枚引く
      if (s.rules?.call && s.hands[p].length === 1) {
        if (m.call === true) last.call = true;
        else { last.forgot = drawInto(s, p, 2).length; checkCap(s, p); }
      }
      if (s.winner === null && isOut(s, s.turn)) s.turn = stepAlive(s, s.turn, 1);
      return s;
    }

    if (m.t === 'draw') {
      if (s.drawn !== null) return null;
      if (s.pend) {
        // 重ねなかった: たまった枚数を全部引いて1回休み
        s.last = { p, t: 'take', got: drawInto(s, p, s.pend.n).length };
        s.pend = null;
        checkCap(s, p);
        s.turn = next(1);
        return s;
      }
      // 出せるまで引く（詳細設定）: 1枚ずつ引き、出せる札が来るか山と捨て札が尽きたらやめる
      let got = 0;
      let card = null;
      do {
        const one = drawInto(s, p, 1);
        if (!one.length) break;
        got++;
        if (canPlay(s, p, one[0])) card = one[0];
      } while (s.rules?.untilPlay && card === null);
      s.last = { p, t: 'draw', got, drew: card !== null };
      checkCap(s, p);
      if (card !== null && !isOut(s, p)) s.drawn = card;
      else s.turn = next(1);
      return s;
    }

    if (m.t === 'challenge') { // チャレンジ（詳細設定）
      const ch = s.pend?.ch;
      if (!ch) return null;
      const n = s.pend.n;
      s.pend = null;
      const last = { p, t: 'challenge', by: ch.p, color: ch.color, bluff: ch.bluff };
      s.last = last;
      if (ch.bluff) { // うそだった: 出した人が4枚引き、チャレンジした人はふつうに自分の番
        last.got = drawInto(s, ch.p, n).length;
        checkCap(s, ch.p);
        s.turn = p;
      } else { // うそではなかった: チャレンジした人が6枚引いて1回休み
        last.got = drawInto(s, p, n + 2).length;
        checkCap(s, p);
        s.turn = next(1);
      }
      return s;
    }

    if (m.t === 'pass') {
      if (s.drawn === null) return null;
      s.drawn = null;
      s.last = { p, t: 'pass' };
      s.turn = next(1);
      return s;
    }
    return null;
  },

  // CPU: 出せる札の中から「数字の大きい札を先に・ワイルドは取っておく・次の人が残り少ないなら妨害札」で選ぶ。
  // 強くなりすぎないよう、3回に1回くらいは出せる札から適当に選ぶ。
  cpu(s, p) {
    if (s.match?.gap) return { t: 'next' };
    const m = this.cpuMove(s, p);
    // 最後の1枚の宣言（詳細設定）: 出したら1枚になりそうなら宣言する（1割5分は忘れる）
    if (m.t === 'play' && s.rules?.call && s.hands[p].length - 1 - (m.more?.length ?? 0) === 1 && Math.random() >= 0.15) m.call = true;
    return m;
  },

  cpuMove(s, p) {
    const hand = s.hands[p];
    // 7で交換の相手は、手札がいちばん少ない人（同じなら近い席）
    const fewest = () => {
      let best = null;
      for (let k = 1; k < s.n; k++) { const q = (p + k) % s.n; if (!isOut(s, q) && (best === null || s.hands[q].length < s.hands[best].length)) best = q; }
      return best;
    };
    const play = (i) => {
      if (hand[i][0] === 'W') return { t: 'play', i, c: pickColor(hand, i) };
      const m = { t: 'play', i };
      if (s.rules?.multi && isNumber(hand[i]) && s.drawn === null) {
        // 同じ数字を全部出す。一番上は、出したあと手元に多く残る色の札
        const same = hand.map((_, j) => j).filter((j) => j !== i && isNumber(hand[j]) && kindOf(hand[j]) === kindOf(hand[i]));
        if (same.length) {
          const rest = hand.filter((c, j) => j !== i && !same.includes(j));
          const left = (j) => rest.filter((c) => colorOf(c) === colorOf(hand[j])).length;
          const top = same.reduce((a, b) => (left(b) > left(a) ? b : a));
          m.more = [...same.filter((j) => j !== top), top];
        }
      }
      if (s.rules?.sevenZero && kindOf(hand[i]) === '7' && aliveCount(s) > 2) m.to = fewest();
      return m;
    };
    if (s.drawn !== null) return Math.random() < 0.15 ? { t: 'pass' } : play(hand.indexOf(s.drawn));
    const legal = hand.map((_, i) => i).filter((i) => canPlay(s, p, hand[i]));
    if (s.pend) {
      if (legal.length && Math.random() >= 0.2) return play(legal[0]); // 重ね返し: たいていは返す
      // チャレンジ（詳細設定）: うそかどうか（ch.bluff や出した人の手札の中身）は見ずに、
      // 出した人の手札の数と自分の手札の数だけで決める（3割前後）
      if (s.pend.ch) {
        const odds = 0.22 + (s.hands[s.pend.ch.p].length <= 2 ? 0.15 : 0) + (hand.length >= 8 ? 0.1 : 0);
        if (Math.random() < odds) return { t: 'challenge' };
      }
      return { t: 'draw' };
    }
    if (!legal.length) return { t: 'draw' };
    // チャレンジ（詳細設定）: 場の色の札を持っていても、3割ほどドロー4を出す（うそ）
    const w4 = hand.indexOf('W4');
    if (s.rules?.challenge && w4 >= 0 && hasColor(s, p, s.color) && Math.random() < 0.3) return play(w4);
    if (Math.random() < 0.3) return play(legal[Math.floor(Math.random() * legal.length)]);
    const nextLeft = s.hands[stepAlive(s, p, 1)].length;
    const sameColor = (c) => hand.filter((x) => colorOf(x) === colorOf(c)).length;
    const score = (c) => {
      if (c === 'W4') return nextLeft <= 2 ? 60 : -20;
      if (c === 'W') return -10;
      const k = kindOf(c);
      if (k === 'S' || k === 'R' || k === 'D') return (nextLeft <= 2 ? 50 : 8) + sameColor(c);
      // 7で交換: 自分より手札の少ない人がいれば出したい
      if (k === '7' && s.rules?.sevenZero && s.hands[fewest()].length < hand.length - 1) return 40 + sameColor(c);
      return 10 + Number(k) + sameColor(c);
    };
    return play(legal.reduce((a, b) => (score(hand[b]) > score(hand[a]) ? b : a)));
  },

  render(root, s, o) {
    const draw = () => this.render(root, s, o);
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const myTurn = o.canMove;
    if (!myTurn || picking?.step !== s.step) picking = null;
    if (!myTurn) called = false;
    // 出す手。宣言（詳細設定）を押してあれば call を付ける
    const play = (m) => o.onMove(called && s.rules?.call ? { ...m, call: true } : m);

    root.innerHTML = '';
    root.className = 'board cc';
    const M = s.match; // 点数で勝負（詳細設定）
    if (M) {
      const head = document.createElement('p');
      head.className = 'cc-match';
      head.textContent = `点数で勝負　第${M.no}回／全${M.of}回`;
      root.append(head);
    }

    // ほかの人（自分の次の席から順に）
    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.winner === null && s.turn === p ? ' turn' : '') + (s.winner === p ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = o.names[p];
      const count = document.createElement('div');
      count.className = 'cc-opp-count';
      count.innerHTML = `<span class="ccard mini back"></span>×${s.hands[p].length}`;
      chip.append(name, count);
      if (M) {
        const pt = document.createElement('div');
        pt.className = 'cc-opp-pts';
        pt.textContent = `${M.pts[p]}点`;
        chip.append(pt);
      }
      const tags = [];
      if (isOut(s, p)) tags.push(['away', '脱落']);
      else if (s.hands[p].length === 1) tags.push(['last', 'ラスト1枚']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        chip.append(t);
      }
      opps.append(chip);
    }
    root.append(opps);

    if (M?.gap) { root.append(gapEl(s, o, nameP)); return; } // 点数で勝負: 回の結果

    // 場（山札・捨て札・いまの色と回る向き）
    const table = document.createElement('div');
    table.className = 'cc-table';
    const canDraw = myTurn && s.drawn === null;
    const deck = document.createElement(canDraw ? 'button' : 'div');
    deck.className = 'ccard big back' + (canDraw ? ' playable' : '');
    deck.innerHTML = s.pend
      ? `<span class="ccard-deck">${s.pend.n}枚<br>引く</span>`
      : `<span class="ccard-deck">山札<br><small>${s.deck.length}枚</small></span>`;
    if (canDraw) {
      deck.type = 'button';
      deck.setAttribute('aria-label', s.pend ? `山札から${s.pend.n}枚引く` : '山札から1枚引く');
      deck.onclick = () => o.onMove({ t: 'draw' });
    }
    const top = cardEl(s.discard[s.discard.length - 1]);
    top.classList.add('big');
    if (o.fresh && s.last?.t === 'play') top.classList.add('pop');
    const state = document.createElement('div');
    state.className = 'cc-state';
    state.innerHTML = `<span class="cc-color c-${s.color}">${COLOR_NAME[s.color]}</span><span class="cc-dir">${s.dir === 1 ? '↻ 右回り' : '↺ 左回り'}</span>`;
    table.append(deck, top, state);
    root.append(table);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    if (me === null) return; // 観戦中は手札を出さない

    const head = document.createElement('div');
    head.className = 'cc-hand-head';
    head.textContent = isOut(s, me) ? `あなたは手札が${capOf(s)}枚を超えたので脱落しました` : `あなたの手札（${s.hands[me].length}枚）${s.rules?.cap ? `／上限 ${capOf(s)}枚` : ''}`;
    if (M) head.textContent += `／あなたの点 ${M.pts[me]}点`;
    if (myTurn) {
      const hint = document.createElement('small');
      hint.textContent = s.drawn !== null
        ? '引いた札を出すか、「出さずに次へ」を押してください'
        : s.pend?.ch
          ? `${s.rules?.stack && s.hands[me].includes('W4') ? 'ドロー4を重ねて返すか、' : ''}下の「チャレンジ」か「受ける」を選んでください`
          : s.pend
          ? `${s.pend.k === 'D' ? 'ドロー2' : 'ドロー4'}を重ねて返すか、山札をタップして${s.pend.n}枚引いてください`
          : '光っている札が出せます。出さないときは山札をタップ';
      head.append(hint);
    }
    root.append(head);

    const hand = document.createElement('div');
    hand.className = 'cc-hand';
    const mine = s.hands[me];
    // 同じ数字まとめ出し: 押した札と同じ数字の札がほかにもあれば、いっしょに出す札を選ばせる
    const sameAs = (i) => (s.rules?.multi && s.drawn === null && !s.pend && isNumber(mine[i])
      ? mine.map((_, j) => j).filter((j) => j !== i && isNumber(mine[j]) && kindOf(mine[j]) === kindOf(mine[i])) : []);
    const send = (i, more) => {
      if (s.rules?.sevenZero && kindOf(mine[i]) === '7' && aliveCount(s) > 2) { picking = { step: s.step, i, seven: true, more }; draw(); }
      else { picking = null; play(more?.length ? { t: 'play', i, more } : { t: 'play', i }); }
    };
    mine.forEach((card, i) => {
      const multi = picking?.multi;
      const ok = multi ? i !== picking.i && sameAs(picking.i).includes(i)
        : myTurn && (s.drawn === null || card === s.drawn) && canPlay(s, me, card);
      const e = cardEl(card, ok ? 'button' : 'div');
      if (ok) {
        e.type = 'button';
        e.classList.add('playable');
        e.onclick = () => {
          if (multi) { const k = multi.indexOf(i); if (k >= 0) multi.splice(k, 1); else multi.push(i); draw(); }
          else if (card[0] === 'W') { picking = { step: s.step, i }; draw(); }
          else if (sameAs(i).length) { picking = { step: s.step, i, multi: [] }; draw(); }
          else send(i);
        };
      }
      if (picking?.i === i) e.classList.add('picked');
      const order = multi ? multi.indexOf(i) : -1;
      if (order >= 0) { e.classList.add('picked'); e.dataset.order = order + 2; } else if (multi && i === picking.i) e.dataset.order = 1;
      hand.append(e);
    });
    root.append(hand);

    if (myTurn && (s.drawn !== null || s.rules?.call)) {
      const actions = document.createElement('div');
      actions.className = 'cc-actions';
      if (s.rules?.call) {
        // 最後の1枚の宣言: 自分の番の間ずっと出す。押してから札を出す
        const call = document.createElement('button');
        call.type = 'button';
        call.className = 'btn cc-call ' + (called ? 'primary' : 'secondary');
        call.textContent = called ? '📣 いろあわせ！（宣言した）' : '📣 いろあわせ！';
        call.setAttribute('aria-pressed', String(called));
        call.onclick = () => { called = !called; draw(); };
        actions.append(call);
      }
      if (s.drawn !== null) {
        const pass = document.createElement('button');
        pass.type = 'button';
        pass.className = 'btn secondary';
        pass.textContent = '出さずに次へ';
        pass.onclick = () => o.onMove({ t: 'pass' });
        actions.append(pass);
      }
      root.append(actions);
    }

    if (myTurn && s.pend?.ch && !picking) {
      // チャレンジ（詳細設定）: ドロー4を出された人が選ぶ
      const by = s.pend.ch.p;
      const ask = document.createElement('div');
      ask.className = 'cc-picker cc-challenge';
      const p1 = document.createElement('p');
      p1.textContent = `${o.names[by]}のドロー4。出す前の場の色（${COLOR_NAME[s.pend.ch.color]}）の札を持っていたと思うなら「チャレンジ」`
        + `（当たれば${o.names[by]}が${s.pend.n}枚、外れたらあなたが${s.pend.n + 2}枚引いて1回休み）`;
      const row = document.createElement('div');
      row.style.flexWrap = 'wrap';
      const chal = document.createElement('button');
      chal.type = 'button';
      chal.className = 'btn primary';
      chal.textContent = '🔍 チャレンジ';
      chal.onclick = () => o.onMove({ t: 'challenge' });
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'btn secondary';
      take.textContent = `受ける（${s.pend.n}枚引く）`;
      take.onclick = () => o.onMove({ t: 'draw' });
      row.append(chal, take);
      ask.append(p1, row);
      root.append(ask);
    }

    if (picking?.multi) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>同じ数字の札をいっしょに出せます。出す札を順に押してください（最後に置いた札の色が場の色になります）</p>';
      const row = document.createElement('div');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn';
      go.textContent = picking.multi.length ? `${picking.multi.length + 1}枚まとめて出す` : '1枚だけ出す';
      go.onclick = () => send(picking.i, picking.multi.slice());
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      row.append(go);
      pick.append(row, cancel);
      root.append(pick);
    } else if (picking?.seven) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>手札を交換する人を選んでください</p>';
      const row = document.createElement('div');
      for (let k = 1; k < s.n; k++) {
        const q = (me + k) % s.n;
        if (isOut(s, q)) continue; // 脱落した人とは交換できない
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.textContent = `${o.names[q]}（${s.hands[q].length}枚）`;
        b.onclick = () => { const { i, more } = picking; picking = null; play(more?.length ? { t: 'play', i, more, to: q } : { t: 'play', i, to: q }); };
        row.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      pick.append(row, cancel);
      root.append(pick);
    } else if (picking) {
      const pick = document.createElement('div');
      pick.className = 'cc-picker';
      pick.innerHTML = '<p>次の色を選んでください</p>';
      const row = document.createElement('div');
      for (const c of COLORS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `cc-pick c-${c}`;
        b.textContent = COLOR_NAME[c];
        b.onclick = () => { const i = picking.i; picking = null; play({ t: 'play', i, c }); };
        row.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { picking = null; draw(); };
      pick.append(row, cancel);
      root.append(pick);
    }
  },
};
