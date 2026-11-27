// 2026-11-27 の UI・UX の14回目の動きを、手で作った局面で描かせて撮るための台本（uiux14-view.html から読む。公開しない）。
// 使い方: プロジェクトのフォルダを確認用サーバーで出し（node ../Claudeの使い道/tools/quiet-serve.js . <port>）、
//   http://127.0.0.1:<port>/tools/probes/uiux14-view.html?case=<名前> を開く。開いた瞬間に「新しく届いた手」（o.fresh）として描くので、動きが始まる。
//   名前は下の CASES の鍵。&again=<ms> を付けると、その時間のあとに同じ局面を描き直す（途中で描き直したときの形を見る）。
//   状態の欄（#status）にはゲームの info を出す（灯りの陣取りのはね返り・多数決の陣地の点の札が飛んでいく先）。main.js の rollNums は動かないので「+4」は出ない。
import akari, { HIDE } from '../../app/js/games/akari.js';
import omosa from '../../app/js/games/omosa.js';
import dots from '../../app/js/games/dots.js';
import tasuu from '../../app/js/games/tasuu.js';
import utsuri from '../../app/js/games/utsuri.js';
import kaisen from '../../app/js/games/kaisen.js';

const NAMES = ['あなた', 'ピコ', 'ハナ', 'ゴロ'];
const seq = (G, s, moves) => moves.reduce((a, m) => { const b = G.apply(a, m); if (!b) throw new Error('手が通らない: ' + JSON.stringify(m)); return b; }, s);
// 重さの手番: 番の人の、種類 kind（0 王・1 兵・2 槍・3 騎）の駒を動かす最初の手
function omMove(s, kind) {
  for (let m = 0; m < 36 * 36; m++) {
    const v = s.board[Math.floor(m / 36)];
    if (v === null || v % 4 !== kind) continue;
    if (omosa.apply(s, m)) return m;
  }
  throw new Error('動かせる駒が無い: ' + kind);
}
// 色うつり四目の盤（'.' 空き・'X' 色の無い駒・'0' '1' その席の色）
const utBoard = (rows) => rows.join('').split('').map((ch) => (ch === '.' ? null : ch === 'X' ? -1 : Number(ch)));
const KS_SHIPS = [[0, 0, false], [2, 0, false], [4, 0, false], [6, 0, false], [8, 0, false]]; // 10×10 の船を左から横に（長さ 5・4・3・3・2）
const ksStart = () => seq(kaisen, kaisen.init({ rules: {} }), [{ t: 'place', ships: KS_SHIPS }, { t: 'place', ships: KS_SHIPS }]);

const CASES = {
  // 灯りの陣取り: まんなかに置いた灯りから、波のように陣地が移る
  'akari-wave': () => [akari, seq(akari, akari.init({ rules: {} }), [10, 16, 64, 70, 40])],
  // 灯りの陣取り: 12個置き終えて決着 → 1マスずつ数え上げる
  'akari-count': () => [akari, seq(akari, akari.init({ rules: {} }), [10, 16, 64, 70, 40, 13, 37, 43, 67, 58, 22, 4])],
  // 灯りの陣取り（隠し灯り）: あなた（席0）の隠し灯りのマスを、ピコ（席1）が選んで見つける。ピコの画面で見る
  'akari-found': () => [akari, seq(akari, akari.init({ rules: { hide: true } }), [40 + HIDE, 10, 16, 40]), { me: 1 }],
  // 重さの手番: 1番手が兵（重さ1）を2回続けて動かせる所（1番手 兵 → 2番手 槍 → 1番手 兵 で、まだ1番手の番）
  'omosa-again': () => {
    let s = omosa.init({ rules: {} });
    for (const k of [1, 2, 1]) s = seq(omosa, s, [omMove(s, k)]);
    return [omosa, s];
  },
  // 点と線: 四角を取って同じ人の番が続く手
  'dots-again': () => {
    let s = dots.init({ rules: {} });
    for (let i = 0; i < s.lines.length; i++) {
      if (s.lines[i] !== null) continue;
      const p = s.turn;
      const t = dots.apply(s, i);
      if (t.turn === p && t.boxes.some((b) => b === p)) return [dots, t];
      s = t;
    }
    throw new Error('取れる四角が無い');
  },
  // 多数決の陣地: 1つ目の陣地に石を交互に置き、5つ目（あなた）で決まる → 人ごとの列に並び、点の札が飛ぶ
  'tasuu-done': () => [tasuu, seq(tasuu, tasuu.init({ rules: {}, seed: 1 }), [0, 0, 0, 0, 0])],
  // 多数決の陣地（一斉に置く）: 2人とも1つ目の陣地を3回選び、3回目は空き1つに2つ来て弾ける。その前の回（2人とも別の陣地）は 'tasuu-tog2'
  'tasuu-tog': () => [tasuu, seq(tasuu, tasuu.init({ rules: { together: true }, seed: 1 }), [0, 0, 0, 0, 0, 0])],
  'tasuu-tog2': () => [tasuu, seq(tasuu, tasuu.init({ rules: { together: true }, seed: 1 }), [0, 0, 1, 2])],
  // 色うつり四目（あぶない所の知らせ）: 青（席1）が右下の駒を左へ動かすと斜めに4つ。あなた（席0）の番
  'utsuri-danger': () => {
    const s = { ...utsuri.init({ rules: {} }), board: utBoard(['......', '.1..0.', '..1.0.', '...1..', '.0...X', '......']) };
    return [utsuri, s, { canMove: true, rules: { danger: 'on' } }];
  },
  // 色うつり四目（崩した並びが割れる）: 青（席1）の横の3つの右端を、あなた（席0）が下へ動かす
  'utsuri-crack': () => {
    const s = { ...utsuri.init({ rules: {} }), board: utBoard(['X.....', '....0.', '.111..', 'X.....', '..0.X.', '.X...0']) };
    return [utsuri, seq(utsuri, s, [(2 * 6 + 3) * 36 + 3 * 6 + 3])]; // 手 = 動かす駒のマス * 36 + 行き先のマス
  },
  // 海戦ゲーム（着弾）: はずれ・当たり・沈めた（いちばん下の長さ2の船の2つ目）
  'kaisen-miss': () => [kaisen, seq(kaisen, ksStart(), [15])],
  'kaisen-hit': () => [kaisen, seq(kaisen, ksStart(), [0])],
  'kaisen-sunk': () => [kaisen, seq(kaisen, ksStart(), [80, 99, 81])],
};

const q = new URLSearchParams(location.search);
const name = q.get('case');
const root = document.getElementById('board');
document.getElementById('title').textContent = name;
const [G, s, extra = {}] = CASES[name]();
window.__state = s;
document.getElementById('status').innerHTML = G.info ? G.info(s) : '';
const o = (fresh) => ({
  me: 0, fresh, canMove: false, names: NAMES, away: [], sub: null, hidden: null, onMove() {}, ...extra,
});
G.render(root, s, o(true));
const again = Number(q.get('again'));
if (again > 0) setTimeout(() => G.render(root, s, o(false)), again);
