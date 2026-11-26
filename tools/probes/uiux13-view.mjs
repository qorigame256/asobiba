// 2026-11-26 の UI・UX の13回目の動きを、手で作った局面で描かせて撮るための台本（uiux13-view.html から読む。公開しない）。
// 使い方: プロジェクトのフォルダを確認用サーバーで出し（node ../Claudeの使い道/tools/quiet-serve.js . <port>）、
//   http://127.0.0.1:<port>/tools/probes/uiux13-view.html?case=<名前> を開く。開いた瞬間に「新しく届いた手」（o.fresh）として描くので、動きが始まる。
//   名前は下の CASES の鍵。&again=<ms> を付けると、その時間のあとに同じ局面を描き直す（途中で描き直しても続きから動くかを見る）。
import yubisuma from '../../app/js/games/yubisuma.js';
import sensou from '../../app/js/games/sensou.js';
import acchi from '../../app/js/games/acchi.js';
import kaidan from '../../app/js/games/kaidan.js';
import tamebeam from '../../app/js/games/tamebeam.js';
import make10 from '../../app/js/games/make10.js';
import mizu from '../../app/js/games/mizu.js';
import slide, { undoPath } from '../../app/js/games/slide.js';
import meiro, { solve } from '../../app/js/games/meiro.js';
import hitofude, { eulerPath } from '../../app/js/games/hitofude.js';
import shogi from '../../app/js/games/shogi.js';

const NAMES = ['あなた', 'ピコ', 'ハナ', 'ゴロ'];
const seq = (G, s, moves) => moves.reduce((a, m) => { const b = G.apply(a, m); if (!b) throw new Error('手が通らない: ' + JSON.stringify(m)); return b; }, s);

const CASES = {
  // 指スマ: 4人、上げる親指 2・1・2・0＝5本、親が「5」→ 当たり
  yubisuma() {
    let s = yubisuma.init(4, 1, { rules: {} });
    const par = s.parent;
    const ups = [2, 1, 2, 0];
    for (let p = 0; p < 4; p++) s = seq(yubisuma, s, [{ p, t: 'pick', r: s.round, up: ups[p], ...(p === par ? { call: 5 } : {}) }]);
    return [yubisuma, s];
  },
  // 指スマ: はずれ（親が「2」、5本 → 3〜5本目は赤い番号）
  yubisuma2() {
    let s = yubisuma.init(4, 1, { rules: {} });
    const par = s.parent;
    const ups = [2, 1, 2, 0];
    for (let p = 0; p < 4; p++) s = seq(yubisuma, s, [{ p, t: 'pick', r: s.round, up: ups[p], ...(p === par ? { call: 2 } : {}) }]);
    return [yubisuma, s];
  },
  // 戦争: 1本で4本の手をタッチ → ちょうど5本ではじける
  sensou() {
    const s = { ...sensou.init(2, 1, { rules: {} }), hands: [[1, 1], [4, 1]], turn: 0 };
    return [sensou, seq(sensou, s, [{ p: 0, t: 'atk', from: 0, to: 1, hand: 0 }])];
  },
  // 戦争: 3本で4本の手をタッチ → 7本 → 超えた分の2本が残る
  sensou2() {
    const s = { ...sensou.init(2, 1, { rules: {} }), hands: [[3, 1], [4, 1]], turn: 0 };
    return [sensou, seq(sensou, s, [{ p: 0, t: 'atk', from: 0, to: 1, hand: 0 }])];
  },
  // あっち向いてホイ: あなたがグーで勝ち、2人とも左 → 当たり
  acchi() {
    let s = acchi.init(3, 1, { rules: {} });
    s = seq(acchi, s, [{ p: 0, t: 'pick', r: s.r, v: 'g' }, { p: 1, t: 'pick', r: s.r, v: 'c' }, { p: 2, t: 'pick', r: s.r, v: 'c' }]);
    s = seq(acchi, s, [{ p: 0, t: 'pick', r: s.r, v: 'l' }, { p: 1, t: 'pick', r: s.r, v: 'l' }, { p: 2, t: 'pick', r: s.r, v: 'u' }]);
    return [acchi, s];
  },
  // じゃんけん階段: パーで2人勝ち → 6段（パイナツプル）
  kaidan() {
    let s = kaidan.init(3, 1, { rules: {} });
    s = seq(kaidan, s, [{ p: 0, t: 'pick', r: s.r, v: 'p' }, { p: 1, t: 'pick', r: s.r, v: 'p' }, { p: 2, t: 'pick', r: s.r, v: 'g' }]);
    return [kaidan, s];
  },
  // ためてビーム: 4人で3回ためてから、0と1が撃ち合い（相殺）、2が大ビームで3のガードを破る
  tamebeam() {
    let s = tamebeam.init(4, 1, { rules: {} });
    for (let k = 0; k < 3; k++) s = seq(tamebeam, s, [0, 1, 2, 3].map((p) => ({ p, t: 'act', r: s.round, a: 'charge' })));
    s = seq(tamebeam, s, [
      { p: 0, t: 'act', r: s.round, a: 'beam', to: 1 },
      { p: 1, t: 'act', r: s.round, a: 'beam', to: 0 },
      { p: 2, t: 'act', r: s.round, a: 'big', to: 3 },
      { p: 3, t: 'act', r: s.round, a: 'guard' },
    ]);
    return [tamebeam, s];
  },
  // ためてビーム: 0がビーム → 1がガードで防ぐ、2がビーム → 0に当たる
  tamebeam2() {
    let s = tamebeam.init(3, 1, { rules: {} });
    s = seq(tamebeam, s, [0, 1, 2].map((p) => ({ p, t: 'act', r: s.round, a: 'charge' })));
    s = seq(tamebeam, s, [
      { p: 0, t: 'act', r: s.round, a: 'beam', to: 1 },
      { p: 1, t: 'act', r: s.round, a: 'guard' },
      { p: 2, t: 'act', r: s.round, a: 'beam', to: 0 },
    ]);
    return [tamebeam, s];
  },
  // 10を作れ: だれも解かずに締め切り → 答えの例が合わさる
  make10() {
    let s = make10.init(2, 3, { rules: {} });
    s = seq(make10, s, [{ p: -1, t: 'next' }, { p: -1, t: 'close' }]);
    return [make10, s];
  },
  // 水はかり: 締め切り → 最少の手順を1手ずつ
  mizu() {
    let s = mizu.init(2, 3, { rules: {} });
    s = seq(mizu, s, [{ p: -1, t: 'next' }, { p: -1, t: 'close' }]);
    return [mizu, s];
  },
  // 15パズル: ピコがそろえて締め切り → ピコの動かし方を早送り
  slide() {
    let s = seq(slide, slide.init(2, 2, { rules: {} }), [{ p: -1, t: 'next' }]);
    s = seq(slide, s, [{ p: 1, t: 'done', q: 0, seq: undoPath(s.qs[0].path), ms: 8000 }, { p: -1, t: 'close' }]);
    return [slide, s];
  },
  // 迷路: ピコがゴールして締め切り → 通った道を早送り
  meiro() {
    let s = seq(meiro, meiro.init(2, 31, { rules: { level: 's' } }), [{ p: -1, t: 'next' }]);
    s = seq(meiro, s, [{ p: 1, t: 'done', q: 0, seq: solve(s.qs[0], s.size), ms: 8000 }, { p: -1, t: 'close' }]);
    return [meiro, s];
  },
  // 一筆書き: ピコが描けて締め切り → 描き順を早送り
  hitofude() {
    let s = seq(hitofude, hitofude.init(2, 4, { rules: {} }), [{ p: -1, t: 'next' }]);
    s = seq(hitofude, s, [{ p: 1, t: 'done', q: 0, path: eulerPath(s.qs[0]), ms: 8000 }, { p: -1, t: 'close' }]);
    return [hitofude, s];
  },
  // 将棋: 9四の歩が9三へ成る → と
  promote() {
    const b = Array(81).fill(0);
    b[76] = 8; b[4] = -8; b[27] = 1;
    const s = { ...shogi.init({ rules: {}, seed: 1 }), board: b, turn: 0 };
    return [shogi, seq(shogi, s, [{ f: 27, t: 18, pr: true }])];
  },
  // 将棋: 頭金（5三の歩に守られた金を5二に打つ）→ 詰みの理由
  mate() {
    const b = Array(81).fill(0);
    b[76] = 8; b[4] = -8; b[22] = 1;
    const s0 = shogi.init({ rules: {}, seed: 1 });
    const hands = [s0.hands[0].slice(), s0.hands[1].slice()];
    hands[0][5] = 1;
    const s = { ...s0, board: b, hands, turn: 0 };
    return [shogi, seq(shogi, s, [{ d: 5, t: 13 }])];
  },
  // 将棋: 横から飛車で詰み（5三の金が上の3マスを押さえる）→ 玉の後ろの4一にも ×
  mate2() {
    const b = Array(81).fill(0);
    b[76] = 8; b[4] = -8; b[22] = 5; b[9 * 8 + 0] = 7;
    const s = { ...shogi.init({ rules: {}, seed: 1 }), board: b, turn: 0 };
    return [shogi, seq(shogi, s, [{ f: 72, t: 0 }])];
  },
  // 3×4: ヒヨコが奥の段へ → ニワトリ
  zoo() {
    const b = Array(12).fill(0);
    b[4] = 1; b[10] = 4; b[2] = -4;
    const s = { ...shogi.init({ rules: { size: 'zoo' }, seed: 1 }), board: b, turn: 0 };
    return [shogi, seq(shogi, s, [{ f: 4, t: 1 }])];
  },
  // 3人・4人将棋: いま盤にある先手の歩を「成った手で来た」ことにして描く（裏返しの見た目だけを見る）
  three() { return multi(3); },
  four() { return multi(4); },
};
function multi(n) {
  const s = shogi.init({ rules: { players: n }, seed: 1 });
  const i = s.board.indexOf(1); // 先手（持ち主0）の歩
  const board = s.board.slice();
  board[i] = 9;
  return [shogi, { ...s, board, last: { f: i, t: i, pr: true, side: 0, note: '' } }];
}

const q = new URLSearchParams(location.search);
const name = q.get('case');
const root = document.getElementById('board');
document.getElementById('title').textContent = name;
const [G, s] = CASES[name]();
window.__state = s;
const o = (fresh) => ({
  me: 0, fresh, canMove: false, names: NAMES, away: [], sub: null, hidden: null, onMove() {},
});
G.render(root, s, o(true));
const again = Number(q.get('again'));
if (again > 0) setTimeout(() => G.render(root, s, o(false)), again);
