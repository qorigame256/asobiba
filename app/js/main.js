// 公開のやり直し用の1行（2026-11-13。動きは変わらない）。次に app/ を変えてコミットするとき、この行と CLAUDE.md の「公開のやり直し用の1行」の行を消す
// 画面の切り替え・部屋の管理・対局の同期。
//
// 同期の考え方: 盤面そのものは送らず「これまでの手の一覧」を送る。受け取った側は最初の局面から
// 手を順に当て直して盤面を作る。手の一覧は短いので毎回まるごと送り、取りこぼしがあっても次の送信で追いつく。
// 部屋を作った人（ホスト）が正。食い違ったらホストの状態に合わせる。
//
// 部屋: members = いま部屋にいる人の id（先頭がホスト）。人数の上限は MAX_MEMBERS。names = id → 表示名。
// 対局の参加者（ゲームの中のプレイヤー番号 → 人の id）:
//   盤のゲーム: 待合室でホストが先手と後手を選ぶ（pick。人か 'cpu'）。もう一回では先手と後手を入れ替える。
//     席は2つ。詳細設定で人数が決まるゲーム（seatCount を持つマルバツ・コネクトフォー・リバーシ・点と線・将棋・マンカラ・海戦ゲーム・五目並べ・立体四目並べ・はさみ将棋・エアホッケー）は人数ぶん選び、もう一回では打つ順番を1つずつ回す。
//     ほかの人は観戦。手には p を付けない（どちらの番かは局面で決まる）。
//   カードゲーム（multi）: 対局を始めるときにホストが order を決める。
//   オンラインでは、どちらも order が null の間は待合室。
//     'cpu1' のような id は CPU。シャッフルは seed（対局ごとにホストが決める数）から作るので全員同じ山になる。
// CPU の手はホストの端末が考えて、ふつうの手と同じように手の一覧へ足す。部屋を出た人の席も CPU が代わる。
// 時間で進むゲーム（referee を持つもの）は、ホストの端末が時間を計って「次の問題へ」「締め切り」などの手（p = -1）を足す。
// (gameId, round) が同じなら order と seed も同じ。order や seed を変えるときは必ず round を進める。
// rules = ゲームごとの詳細設定（待合室でホストだけが変えられる）。prev = 前の対局の順位（大富豪のカード交換など）。
//   carry = 次の対局へ持ち越す前の結果（人の id → 順位）。ホストが対局を始めるときに prev へ並べ替える。
// 部屋を作る・同じ画面で遊ぶのは持ち主の端末だけ（owner.js）。ほかの人は招待された部屋に入るだけ。App Store 版はだれでも作れる（canHost）。
// banned = ホストが退出させた人の id。あいさつが来ても入れず、もう一度「退出」を送る。
// streak = 連勝（2026-10-06 本人の決定）。{ key: ゲームと顔ぶれ, counted: 数え終えた対局, wins: 人の id → 連勝の数 }。ホストだけが数えて全員へ送る。
// tally = 部屋の成績表（2026-10-06 本人の決定）。{ games: 決着した対局の数, wins: 人の id → 勝った回数, preds: 人の id → 勝敗予想が当たった回数（10回目に足した。無いこともある）,
//   played: 人の id → 対局した回数（勝率のため。24回目に足した。無いこともある）,
//   pts: 人の id → 順位で点の合計（28回目に足した。無いこともある。ホストが「順位で点」を選んだときだけ表に出す。下の「成績表を順位で点」）,
//   best: 記録の鍵（records.js の recordKey）→ [{ id, n: そのときの表示名, v: 数字 }] 上位3人（部屋の最高記録。2026-10-22 に足した。無いこともある） }。
//   ゲームをまたいで数える。ホストが数えて全員へ送る。
// preds = 勝敗予想（2026-10-06 本人の決定）。{ key: どの対局か, by: 人の id → 勝つと予想したプレイヤー番号 }。各自が全員へ送りっぱなしにし、受け取った端末がそれぞれ覚える。
// beg = 初心者マークを付けている人の id の一覧（各自が自分の端末で付け外しし、ホストが集めて全員へ送る）。
// undo = この対局で「待った」をした回数（盤のゲームのオンライン）。待ったをすると手の一覧が短くなり、ふつうの同期（長い方が正）では
//   戻せないので、ホストだけが手を削って undo を1つ進め、受け手は undo が大きい一覧をそのまま受け入れる。対局が替わると 0 に戻る。
// stay = 勝ち残り（2026-10-06 本人の決定。盤のゲームのオンライン）。オンなら、もう一回で負けた人が観戦の人と交代する。line = 交代を待つ人の順番。
//   どちらもホストが決めて全員へ送る（ほかの人の画面にも「次に入る人」を出すため）。

import { GAMES, GAME_ORDER, winnersOf, seatPoints, CATEGORIES, categoryOf } from './games/index.js';
import { SEAT_COLORS } from './games/party.js';
import { connectRoom } from './net.js';
import { esc, lineHold, finishLine, col, setSeatColors } from './games/util.js';
import { isOwner, unlockOwner, forgetOwner } from './owner.js';
import { IS_APP, WEB_URL } from './platform.js';
import { isBad, mask, BAD_TEXT_NOTE } from './filter.js';
import { play, endSound, isMuted, setMuted, isVoice, speak, GREET, getVolume, setVolume } from './sound.js';
import { initAds, setAdsMuted, setBanner, countFinished, beforeLeaveResult, canBuyNoAds, hasNoAds, onNoAdsChange, noAdsPrice, buyNoAds, restoreNoAds, onOwnedChange, owns, priceOf, buy, restore } from './ads.js';
import { initNative, haptic, canHaptic, hapticsOn, setHapticsOn, canAchieve, openAchievements, notePlayed, noteResult, noteRoomSize, canShare, shareScreen, canRank, loadBoard } from './native.js';
import { readRecords, noteGame, recordKey, rulesText, allBoards, initRecords, onRecords } from './records.js';
import { SKINS, shownSkins, needText, usable, currentSkin, setSkin, checkSkin, newlyUnlocked, productOf } from './skin.js';
import { showSeason } from './season.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違えやすい I O 0 1 を除く
const CODE_LEN = 5;
const HEARTBEAT_MS = 5000;
const LOST_MS = 40000; // 合図がこれより長く途切れたら抜けたと見る（2026-10-30 に20秒から延ばした。スマホで少し裏に回っただけで席が CPU に替わらないように）
const MAX_MEMBERS = 10; // 部屋に入れる人数の上限（観戦を含む）
const CPU_DELAY_MS = 600; // CPU が手を打つまでの間（速すぎると何が起きたか追えない）
const NAME_KEY = 'bg-name';
const SPECTATOR = -1;
// これより長く待ったあとで自分の番が来たら、「番が来た」音・振動・名前の読み上げと「あなたのターン」の帯で知らせる（すぐ返ってきた番では知らせない）。
// 2026-11-06 本人の指示で帯を3秒にし、続けて音・振動・読み上げも5秒から3秒にそろえた（本人の指示）
const TURN_PING_MS = 3000;

const el = (id) => document.getElementById(id);

let S = null; // いま遊んでいる部屋・対局の状態。ホーム画面では null

function randomString(n, chars) {
  const a = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(a, (x) => chars[x % chars.length]).join('');
}
const newId = () => randomString(12, 'abcdefghijklmnopqrstuvwxyz0123456789');
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const sameMove = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isPrefix = (a, b) => a.length <= b.length && a.every((m, i) => sameMove(m, b[i]));
const cleanName = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 10);

function myName() {
  try { const n = cleanName(localStorage.getItem(NAME_KEY)); return isBad(n) ? '' : n; } catch { return ''; } // 前に覚えた名前が一覧に当たるときも使わない
}

// 端末の印（2026-10-26）。人の id は部屋に入るたびに変わるので、抜けた人が入り直すと同じ人が2人並んでいた。
// hello に端末の印を入れ、ホストは同じ印の人が入り直してきたら前の席を引き継がせる（acceptMember）。締め出しも印で見る。
// 同じ端末の別のタブ（試しに2人で入るとき）を1人にまとめないよう、引き継ぐのは名前も同じか、前の人の合図が途切れているときだけ。
const DEV_KEY = 'bg-dev';
function myDev() {
  try {
    let d = localStorage.getItem(DEV_KEY);
    if (!/^[a-z0-9]{12}$/.test(d ?? '')) { d = newId(); localStorage.setItem(DEV_KEY, d); }
    return d;
  } catch { return ''; }
}

/* ---------- 再読み込みしても部屋に戻れるよう、タブごとに覚えておく ---------- */

const SAVED_FIELDS = ['myId', 'isHost', 'gameId', 'round', 'first', 'seed', 'order', 'cpus', 'moves', 'members', 'names', 'rules', 'prev', 'carry', 'pick', 'banned', 'clock', 'undo', 'streak', 'beg', 'tally', 'preds', 'stay', 'line', 'marks', 'timer', 'history', 'ready', 'votes', 'roomName', 'cpuAuto', 'rps', 'hidden', 'ptsMode', 'devs', 'bannedDevs', 'again', 'away', 'bench', 'draw', 'colors', 'colorKeep', 'lockPw', 'pw'];
const roomKey = (code) => 'bg2-room-' + code;
function loadRoom(code) {
  try { return JSON.parse(sessionStorage.getItem(roomKey(code))); } catch { return null; }
}
function saveRoom() {
  if (S?.mode !== 'online') return;
  const data = Object.fromEntries(SAVED_FIELDS.map((k) => [k, S[k]]));
  try { sessionStorage.setItem(roomKey(S.code), JSON.stringify(data)); } catch { /* 保存できなくても遊べる */ }
  saveLastRoom(data);
}
function forgetRoom(code) {
  try { sessionStorage.removeItem(roomKey(code)); } catch { /* 無視 */ }
  forgetLastRoom(code);
}

/* ---------- さっきの部屋へ戻る（2026-11-13 便利機能の1回目。本人の選択。room.md） ---------- */
// 閉じてしまった部屋へ、ホームの「↩ さっきの部屋へ」で戻れる。出すのは、その部屋にまだ誰か（ホストかほかの人）がいる間だけ（本人の決定）。自分で部屋を出たら出さない。
// 仕組み（Claude の判断）: 部屋にいる間、タブごとの保存（sessionStorage）と同じ中身を端末の保存（localStorage の LAST_KEY）にも写し、
// 部屋にいるタブは HEARTBEAT_MS ごとに LAST_AT_KEY（どの部屋に・いつ・どのタブが）を書く。ホームを開いたとき、それが途切れていれば（そのタブはもう無い）
// 中継サーバーで部屋に type: 'probe' を送り、部屋の人のだれかが 'here' を返したらボタンを出す。返事が無ければ部屋は閉じたと見て覚えを消す。
// ボタンを押すと覚えた中身をタブごとの保存へ戻し、再読み込みと同じ形で部屋へ入る（同じ id なので、ホストも席も前のまま）。
// 前のタブが iPhone で裏に止まっていただけで、あとで動き出したときは、LAST_AT_KEY のタブが替わっているのを見て、そのタブは黙って部屋を出る（同じ id が2つ並ばないように）。
const LAST_KEY = 'bg-last-room';
const LAST_AT_KEY = 'bg-last-room-at';
const TAB_ID = newId();
const LAST_PROBE_MS = 6000; // 部屋の人の返事を待つ長さ
const LAST_RECHECK_MS = 15000; // ボタンを出している間、部屋にまだだれかいるかを確かめ直す間（2026-11-13 Codex の点検の指摘。空になった部屋のボタンが残っていた）
const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
// この画面がいま持っている部屋を、別のタブが「さっきの部屋へ」で持っていった（そのタブがいま動いている）
const takenByOther = (at) => !!S && at?.code === S.code && at.id === S.myId && !!at.tab && at.tab !== TAB_ID && Date.now() - at.at < HEARTBEAT_MS * 3;
// この画面（再読み込みすると替わる）が LAST_AT_KEY を書いたことのある部屋。一度書いたあとで別のタブに替わっていたら、もう書かない
// （2026-11-13 Codex の点検の指摘。裏で止まっていた前のタブが動き出して保存すると、戻った新しいタブのほうが部屋を出されていた）。
// 初めて書くとき（部屋に入った・再読み込みした）は、前のタブの印が新しくても書いて持ち主になる
let ownLast = null;
function saveLastRoom(data) {
  if (ownLast === S.code && takenByOther(readJson(LAST_AT_KEY))) return;
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ code: S.code, data }));
    localStorage.setItem(LAST_AT_KEY, JSON.stringify({ code: S.code, id: S.myId, at: Date.now(), tab: TAB_ID }));
    ownLast = S.code;
  } catch { /* 覚えられなくても遊べる */ }
}
function forgetLastRoom(code) {
  try { if (readJson(LAST_KEY)?.code === code) { localStorage.removeItem(LAST_KEY); localStorage.removeItem(LAST_AT_KEY); } } catch { /* 無視 */ }
}
setInterval(() => {
  if (S?.mode !== 'online') return;
  if (takenByOther(readJson(LAST_AT_KEY))) { yieldRoom(); return; }
  try { localStorage.setItem(LAST_AT_KEY, JSON.stringify({ code: S.code, id: S.myId, at: Date.now(), tab: TAB_ID })); ownLast = S.code; } catch { /* 無視 */ }
}, HEARTBEAT_MS);
// 別のタブが「さっきの部屋へ」でこの部屋に戻った: この画面は bye を送らずに部屋を出る（送ると、戻った人まで部屋から外れるため）
function yieldRoom() {
  stopLive();
  closeInvite();
  dropBack();
  const net = S.net;
  try { sessionStorage.removeItem(roomKey(S.code)); } catch { /* 無視 */ }
  setTimeout(() => net?.close(), 0);
  S = null;
  setTurnTitle(false);
  setUrlRoom(null);
  showScreen('home');
  toast('別の画面でこの部屋に戻ったので、この画面は部屋を出ました');
}
// lastProbe = いまの問い合わせ（または次に確かめ直す予約）。close で止める。画面を切り替えるたびに checkLastRoom が止めて始め直す
let lastProbe = null;
function checkLastRoom() {
  const box = el('last-room');
  if (!box) return;
  lastProbe?.close();
  lastProbe = null;
  const hide = () => { box.hidden = true; box.innerHTML = ''; };
  hide();
  if (S) return;
  const last = readJson(LAST_KEY);
  if (!last?.code || !last.data?.myId || wasKicked(last.code)) return;
  const at = readJson(LAST_AT_KEY);
  if (at?.code === last.code && Date.now() - at.at < HEARTBEAT_MS * 3) {
    // 部屋にいるタブがまだ動いている（か、閉じたばかり）。印が古くなったら確かめ直す（2026-11-13 Codex の点検の指摘。閉じてすぐホームを開くと、待ってもボタンが出なかった）
    const t = setTimeout(checkLastRoom, HEARTBEAT_MS * 3 - (Date.now() - at.at) + 500);
    lastProbe = { close: () => clearTimeout(t) };
    return;
  }
  // つないだままにして、返事が来たらボタンを出し、LAST_RECHECK_MS ごとに問い合わせ直す（ボタンを出したまま部屋が空になったら消す）
  const probeId = newId();
  let net = null;
  let ready = false;
  let timer = null;
  let got = false;
  const done = () => { clearTimeout(timer); try { net?.close(); } catch { /* 無視 */ } if (lastProbe === handle) lastProbe = null; };
  const handle = { close: done };
  const probe = () => {
    got = false;
    const sentReady = ready;
    net.send({ type: 'probe' });
    timer = setTimeout(() => {
      if (lastProbe !== handle) return;
      if (!ready || !sentReady) { probe(); return; } // つなぎ直している間に送った問い合わせでは決めない（届かなかっただけかもしれない）
      done(); hide(); forgetLastRoom(last.code); // つながったのに返事が無い = 部屋に誰もいない
    }, LAST_PROBE_MS);
  };
  try {
    net = connectRoom(last.code, probeId, (msg) => {
      if (msg.type !== 'here' || msg.to !== probeId || lastProbe !== handle || got) return;
      got = true;
      clearTimeout(timer);
      if (S) { done(); return; }
      if (box.hidden) showLastRoom(box, last);
      timer = setTimeout(probe, LAST_RECHECK_MS);
    }, (status) => {
      if (lastProbe !== handle) return;
      const first = status === 'ready' && !ready && !timer;
      ready = status === 'ready';
      if (first) probe();
    });
  } catch { return; }
  lastProbe = handle;
}
function showLastRoom(box, last) {
  const g = GAMES[last.data.gameId];
  const label = [last.data.roomName ? '🏷 ' + last.data.roomName : g?.name, `部屋コード ${last.code}`].filter(Boolean).join('・');
  const b = makeButton('', () => {
    try {
      sessionStorage.setItem(roomKey(last.code), JSON.stringify(last.data));
      localStorage.setItem(LAST_AT_KEY, JSON.stringify({ code: last.code, id: last.data.myId, at: Date.now(), tab: TAB_ID }));
    } catch { toast('この端末では前の部屋を思い出せませんでした'); return; }
    lastProbe?.close();
    joinRoom(last.code);
  });
  b.innerHTML = `↩ さっきの部屋へ<small>${esc(label)}</small>`;
  box.append(b);
  box.hidden = false;
}
// 退出させられた部屋は、この端末（別のタブも）から入り直せないよう覚えておく
const kickedKey = (code) => 'bg-kicked-' + code;
function wasKicked(code) {
  try { return localStorage.getItem(kickedKey(code)) === '1'; } catch { return false; }
}
function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
  history.replaceState(history.state, '', url); // うっかり閉じない確認の目印（bgGuard）は残す
}

/* ---------- 参加者と局面 ---------- */

const isCpu = (id) => typeof id === 'string' && id.startsWith('cpu');

// CPU の名前（2026-10-06 本人の決定）: 「CPU1」でなく、対局ごとに変わる名前と 🤖。対局の種（seed）と CPU の番号から決めるので、全員の端末で同じ名前になる。
// 種がまだ無い待合室では「CPU1」のまま。同じ対局の CPU どうしで名前がかぶらないよう、名前の数（16）と互いに素な間（5）ずつずらす。
const CPU_NAMES = ['ロボたろう', 'ピコ', 'ガジェ丸', 'ネジ子', 'ポンコツ号', 'ビット', 'メカ吉', 'ボルト', 'ちびロボ', 'カラクリ', 'デンデン', 'ギア助', 'プログラ', 'キカイ姫', 'ドット', 'テツ丸'];
function cpuName(id) {
  const base = cpuBaseName(id);
  return base ? '🤖' + base : 'CPU' + id.slice(3);
}
// 🤖 を付けない名前（CPU 図鑑の鍵）。種がまだ無ければ null
function cpuBaseName(id) {
  const n = Number(id.slice(3)) || 1;
  if (!S?.seed) return null;
  return CPU_NAMES[((S.seed % CPU_NAMES.length) + (n - 1) * 5) % CPU_NAMES.length];
}

function nameOf(id) {
  if (!id) return '（空席）';
  if (isCpu(id)) return cpuName(id);
  if (S.hidden?.includes(id)) return HIDDEN_NAME; // 「この人を隠す」を押した人
  const mark = S.marks?.[id];
  return (MARKS.includes(mark) && mark ? mark + ' ' : '') + (S.names?.[id] ? mask(S.names[id]) : 'ゲスト') + (S.beg?.includes(id) ? ' 🔰' : '');
}

/* ---------- 自分のマーク（2026-10-07 本人の決定）: ホーム画面で名前の前に付ける絵文字を選び、部屋のみんなにも見せる ---------- */
// Claude の判断: 選べるのは下の一覧だけ（外から来た値はこの一覧にあるときだけ使うので、そのまま HTML に入れてよい）。
// CPU の 🤖 と初心者マークの 🔰 は見分けがつかなくなるので入れない。付けたかどうかは localStorage の bg-mark。
// ゲストは hello の mark で知らせ、ホストが S.marks（人の id → マーク）に集めて state で送る（初心者マークと同じ形）。
const MARK_KEY = 'bg-mark';
const MARKS = ['', '🐱', '🐶', '🐰', '🐻', '🐼', '🦊', '🐸', '🐧', '🦁', '🐯', '🐨', '🐙', '🦄', '🐢', '🚀', '⭐', '🌸', '🍙', '⚽'];
function myMark() {
  try { const m = localStorage.getItem(MARK_KEY) ?? ''; return MARKS.includes(m) ? m : ''; } catch { return ''; }
}
// ホストが、だれがどのマークを付けているかを覚える
function setMark(id, mark) {
  const now = Object.fromEntries(Object.entries(S.marks ?? {}).filter(([x]) => x !== id && S.members.includes(x)));
  if (MARKS.includes(mark) && mark) now[id] = mark;
  S.marks = now;
}

/* ---------- 初心者マーク（2026-10-06 本人の決定）: 付けた人の画面では、いま選べる所（置ける所・出せる札）を強く光らせる ---------- */
// 付け外しは各自の端末で（localStorage）。名前に 🔰 を付けて、部屋のみんなにも見せる（ホストが集めて state の beg で送る）。
// 光らせるのは選べる所が限られるゲームだけ（全部のマスが置けるゲームで全部光ると、かえって分かりにくい。style.css の body.beginner）
const BEG_KEY = 'bg-beginner';
const BEG_GAMES = new Set(['reversi', 'mancala', 'hasami', 'shogi', 'colors', 'daifugo', 'speed', 'doubt', 'sevens']);
let beginner = false;
try { beginner = localStorage.getItem(BEG_KEY) === '1'; } catch { /* 覚えられなくても使える */ }

function setBeginner(on) {
  beginner = on;
  try { localStorage.setItem(BEG_KEY, on ? '1' : '0'); } catch { /* 無視 */ }
  document.body.classList.toggle('beginner', on);
  showBeginnerBtn();
  if (S?.mode === 'online') {
    if (S.isHost) { setBeg(S.myId, on); sendState(); } else send({ type: 'hello', isHost: false, name: myName(), beg: on, mark: myMark(), dev: myDev() });
  }
  if (S) render();
}

// ホストが、だれが初心者マークを付けているかを覚える
function setBeg(id, on) {
  const now = (S.beg ?? []).filter((x) => x !== id && S.members.includes(x));
  if (on) now.push(id);
  S.beg = now;
  saveRoom();
}

/* ---------- 見やすさ（2026-11-11 本人の選択。room.md「UI・UX の4回目」）: 端末ごとの切り替え（2026-11-13 に4つ目の「小さいマスの拡大鏡」を足した） ---------- */
// big = 字の大きさ「大きい」（html の .big-text。状態の欄・ボタン・名前などを style.css の zoom でひと回り大きくする）、
// twoTap = 2回押して置く（TWO_TAP_GAMES。下の「2回押して置く」）、shapes = 色に形を添える（html の .shapes。3〜4人の盤で人ごとの色に ● ▲ ■ ◆ を重ねる）。
// loupe = 小さいマスの拡大鏡（下の「小さいマスの拡大鏡」。最初は指で触る端末で使い、PC で切る。本人の決定。決めていなければ undefined で、loupeDefault で見る）。
// loupe のほかは最初は切る（Claude の判断）。この端末だけ（localStorage。送らない）。ホームの「👓 見やすさ」と対局の画面の下の段の「👓 見やすさ」で開く
// （上の段に置くと、スマホでゲームの名前が1行多く折れたため。2026-11-11 にブラウザで見て移した）。
const VIEW_KEY = 'bg-view';
let viewPref = { big: false, twoTap: false, shapes: false };
try { viewPref = { ...viewPref, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}') }; } catch { /* 覚えられなくても使える */ }
function applyView() {
  document.documentElement.classList.toggle('big-text', !!viewPref.big);
  document.documentElement.classList.toggle('shapes', !!viewPref.shapes);
}
function setView(k, v) {
  viewPref = { ...viewPref, [k]: v };
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewPref)); } catch { /* 無視 */ }
  applyView();
  tapGhost = null;
  if (S && !el('screen-play').hidden) render();
}
applyView();
function openView() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '見やすさ');
  const box = document.createElement('div');
  box.className = 'invite-box view-box';
  pop.append(box);
  const rows = [
    ['big', '字の大きさ', '状態の欄・ボタン・名前などの字をひと回り大きくします', [[false, 'ふつう'], [true, '大きい']]],
    ['twoTap', '2回押して置く', 'マルバツ・四目並べ・リバーシ・五目並べ・立体四目並べ・点と線で、1回目に薄い印が出て、同じ所をもう一度押すと置きます（押し間違いを防ぎます）', [[false, '切る'], [true, '使う']]],
    ['shapes', '色に形を添える', '3〜4人の盤で、人ごとの色の上に ● ▲ ■ ◆ を重ねます（色が見分けにくいときに）', [[false, '切る'], [true, '使う']]],
    ['loupe', '小さいマスの拡大鏡', '五目並べ・リバーシ・点と線・マルバツ・立体四目並べ・海戦ゲームで、指を当てている間は指の上に拡大した丸い窓を出し、指を離した所に置きます（指でずらして合わせられます。指で触る端末だけで働きます）', [[false, '切る'], [true, '使う']]],
  ];
  const now = (k) => (k === 'loupe' ? loupePref() : !!viewPref[k]);
  const draw = () => {
    box.innerHTML = '<div class="invite-title">👓 見やすさ</div><p class="invite-note">この端末だけの設定です（ほかの人には変わりません）。</p>';
    for (const [k, label, note, choices] of rows) {
      const row = document.createElement('div');
      row.className = 'view-row';
      row.innerHTML = '<div class="rank-head"></div><p class="view-note"></p><div class="view-seg" role="radiogroup"></div>';
      row.querySelector('.rank-head').textContent = label;
      row.querySelector('.view-note').textContent = note;
      const seg = row.querySelector('.view-seg');
      seg.setAttribute('aria-label', label);
      for (const [v, t] of choices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'view-opt' + (now(k) === v ? ' on' : '');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(now(k) === v));
        b.textContent = t;
        b.onclick = () => { setView(k, v); draw(); };
        seg.append(b);
      }
      box.append(row);
    }
    const acts = document.createElement('div');
    acts.className = 'invite-actions';
    acts.append(makeButton('閉じる', closeInvite, 'primary'));
    box.append(acts);
  };
  draw();
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  pop.querySelector('.view-opt.on')?.focus();
}

/* ---------- 小さいマスの拡大鏡（2026-11-13 本人の選択。room.md「UI・UX の6回目」） ---------- */
// 指を当てている間、指の少し上に盤を LOUPE_ZOOM 倍にした丸い窓を出し、指を離した所を押したことにする（押したままずらして合わせられる）。端末ごとの設定（上の「見やすさ」の loupe）。
// Claude の判断: 付ける盤は LOUPE_GAMES（盤を大きくするとマスが小さくなる盤と、マスの多い海戦ゲーム）。押せる所（.playable）があり、そのマスが LOUPE_CELL より小さいときだけ働く
// （マルバツの3×3のような大きいマスでは窓が要らないため。2026-11-13 にブラウザで見て足した）。働かないときはふつうに押せて、スクロールもできる。
// 窓の中身は、指を当てたときの盤の写し（cloneNode。#screen-play の中に置くので [data-game] の色もそのまま）。2本指（拡大の操作）になったら・盤の外で離したら何もしない。
// touchstart で preventDefault するので、その間はブラウザのふつうのクリックとスクロールは起きない（指を離したときに1回だけ押したことにする。2回置かれないように）。
// タッチのときだけ動くので、PC のマウスでは「使う」にしても何も変わらない
const LOUPE_GAMES = new Set(['gomoku', 'reversi', 'dots', 'tictactoe', 'cube4', 'kaisen']);
const LOUPE_R = 62; // 窓の半径（px）
const LOUPE_ZOOM = 2.3;
const LOUPE_CELL = 40; // これより小さい（幅か高さ。px）マスの盤だけで出す
const loupeDefault = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const loupePref = () => (typeof viewPref.loupe === 'boolean' ? viewPref.loupe : loupeDefault());
let loupe = null;
function loupeStart(e) {
  if (e.touches.length !== 1) { loupeEnd(null); return; }
  if (!loupePref() || !S || !LOUPE_GAMES.has(S.gameId) || el('screen-play').hidden) return;
  const board = el('board');
  const cell = board.querySelector('.playable')?.getBoundingClientRect();
  if (!cell || Math.min(cell.width, cell.height) >= LOUPE_CELL) return;
  e.preventDefault();
  const rect = board.getBoundingClientRect();
  const wrap = document.createElement('div');
  wrap.className = 'loupe';
  wrap.setAttribute('aria-hidden', 'true');
  const view = board.cloneNode(true);
  view.removeAttribute('id');
  view.classList.add('loupe-view');
  view.style.width = rect.width + 'px';
  view.style.height = rect.height + 'px';
  wrap.append(view);
  el('screen-play').append(wrap);
  loupe = { wrap, view, rect, x: 0, y: 0 };
  loupeMove(e);
}
function loupeMove(e) {
  if (!loupe) return;
  if (e.touches.length !== 1) { loupeEnd(null); return; }
  e.preventDefault();
  const t = e.touches[0];
  loupe.x = t.clientX;
  loupe.y = t.clientY;
  const { wrap, view, rect } = loupe;
  const R = LOUPE_R;
  let top = loupe.y - 2 * R - 44; // 指で隠れないよう指の上に（上が足りなければ下に）
  if (top < 8) top = loupe.y + 44;
  const left = Math.min(Math.max(8, loupe.x - R), window.innerWidth - 2 * R - 8);
  wrap.style.left = left + 'px';
  wrap.style.top = top + 'px';
  view.style.transform = `translate(${R - (loupe.x - rect.left) * LOUPE_ZOOM}px, ${R - (loupe.y - rect.top) * LOUPE_ZOOM}px) scale(${LOUPE_ZOOM})`;
}
function loupeEnd(e) {
  if (!loupe) return;
  const { wrap, x, y } = loupe;
  loupe = null;
  wrap.remove();
  if (!e) return;
  e.preventDefault();
  const board = el('board');
  const r = board.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
  const target = document.elementFromPoint(x, y);
  if (target && board.contains(target)) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
}
{
  const b = el('board');
  b.addEventListener('touchstart', loupeStart, { passive: false });
  b.addEventListener('touchmove', loupeMove, { passive: false });
  b.addEventListener('touchend', loupeEnd, { passive: false });
  b.addEventListener('touchcancel', () => loupeEnd(null));
}

/* ---------- 部屋の成績表（2026-10-06 本人の決定）: この部屋で決着した対局の数と、だれが何回勝ったか（ゲームをまたいで） ---------- */
// Claude の判断: 人だけを出す（CPU は出さない）。引き分けはだれも勝ちにしない。同点の1位・チームの勝ちは全員を数える。
// 部屋にいる人は0勝でも出し、出た人は勝ちがあれば出す。勝った回数の多い順。待合室と、対局の結果の画面に出す。
function tallyHtml() {
  const t = S.tally;
  if (S.mode !== 'online' || !t?.games) return '';
  const w = (id) => (Number.isInteger(t.wins[id]) ? t.wins[id] : 0); // 届いた数は整数だけ使う（外から来た値なので）
  // 順位で点（28回目の案）: ホストが選んだら点の多い順に「12点（4勝・10戦・40%）」。点を数える前の形の成績表なら一言添えて勝った回数のまま
  const usePts = ptsOn(t);
  const pt = (id) => (usePts && Number.isInteger(t.pts[id]) ? t.pts[id] : 0);
  const ids = [...new Set([...S.members, ...Object.keys(t.wins), ...(usePts ? Object.keys(t.pts) : [])])].filter((id) => !isCpu(id) && (S.members.includes(id) || w(id) || pt(id)));
  ids.sort((a, b) => pt(b) - pt(a) || w(b) - w(a));
  const list = ids.map((id) => {
    const who = `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b>`;
    if (!usePts) return `${who} ${w(id)}勝${rateText(t, id, w(id))}`;
    const rate = rateText(t, id, w(id));
    return `${who} ${pt(id)}点（${w(id)}勝${rate ? '・' + rate.slice(1, -1) : ''}）`;
  }).join('・');
  const head = `🏆 この部屋の成績（${t.games}回${usePts ? '・順位で点' : ''}）`
    + (S.ptsMode && !usePts ? '<small>（点は「成績を0に戻す」のあとから数えます）</small>' : '');
  // 勝敗予想の当たり（2026-10-07。10回目の案）: 1回でも当たった人だけ、当たった回数の多い順に出す（観戦だけの人も入る）
  const pr = t.preds && typeof t.preds === 'object' ? t.preds : {};
  const hits = (id) => (Number.isInteger(pr[id]) && pr[id] > 0 ? pr[id] : 0);
  const seers = Object.keys(pr).filter((id) => !isCpu(id) && hits(id) && (S.members.includes(id) || S.names[id])).sort((a, b) => hits(b) - hits(a));
  const seerList = seers.map((id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b> ${hits(id)}回`).join('・');
  return `${head}: ${list}` + (seers.length ? `<br>🔮 予想の当たり: ${seerList}` : '') + roomBestHtml(t);
}

// 成績表を点で並べるか（ホストが「順位で点」を選んでいて、成績表が点を数えている形のとき）
const ptsOn = (t) => !!S.ptsMode && !!t?.pts && typeof t.pts === 'object';

// 部屋の最高記録（2026-10-22 本人の決定。ランキング）: 自己ベストを取るゲームごと・詳細設定の組み合わせごとに上位3人。名前はそのときの表示名（外から来た文字なので esc）
function roomBestHtml(t) {
  const best = t.best && typeof t.best === 'object' ? t.best : {};
  const rows = Object.entries(best).map(([key, list]) => {
    const game = GAMES[key.split('|')[0]];
    if (!game?.record || !Array.isArray(list) || !list.length) return '';
    const rt = rulesText(game, key);
    const who = list.map((x) => `<b>${esc(x.id === S.myId ? 'あなた' : x.n)}</b> ${esc(game.record.fmt(x.v))}`).join('・');
    return `<br>🎯 ${esc(game.name)}の${esc(game.record.label)}${rt === '最初の設定' ? '' : `（${esc(rt)}）`}: ${who}`;
  });
  return rows.join('');
}

// 届いた部屋の最高記録を整える（外から来た値なので、形の合うものだけ使う）
function cleanBest(b) {
  if (!b || typeof b !== 'object') return undefined;
  const out = {};
  for (const [key, list] of Object.entries(b).slice(0, 60)) {
    if (typeof key !== 'string' || key.length > 200 || !GAMES[key.split('|')[0]]?.record || !Array.isArray(list)) continue;
    const ok = list.slice(0, 3).filter((x) => typeof x?.id === 'string' && typeof x.n === 'string' && Number.isInteger(x.v)).map((x) => ({ id: x.id, n: mask(x.n.slice(0, 30)), v: x.v }));
    if (ok.length) out[key] = ok;
  }
  return out;
}

// 成績表の勝率（2026-10-08。24回目の案。本人が選んだ）:「（3戦・67%）」。対局した回数で割る（観戦していた対局は数えない）。
// 対局した回数を数え始める前の成績表（played が無い・勝ちより少ない）や、対局していない人には出さない（Claude の判断）。
function rateText(t, id, wins) {
  const n = t.played && typeof t.played === 'object' ? t.played[id] : undefined;
  if (!Number.isInteger(n) || n <= 0 || n < wins) return '';
  return `（${n}戦・${Math.round((wins / n) * 100)}%）`;
}

/* ---------- 同じ画面の成績（2026-10-07。21回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// 同じ画面の対局でも、結果の画面に「🏆 この画面の成績（3回）: 先手 2勝・後手 1勝・引き分け 0回」を出す。
// Claude の判断: 同じ画面の対局は名前が無く、もう一回でも先手と後手が入れ替わらないので、席（先手・後手）ごとに数える。
// 対局ごとに1回だけ数える（同じ画面の対局は もう一回 で seed を作り直すので、seed で見分ける）。この端末の S の中だけで、ホームに戻ると0に戻る（保存しない）。
function countLocal(game, res) {
  if (S.mode !== 'local' || game.multi) return;
  const t = S.localTally ?? { key: null, games: 0, wins: [], draws: 0 };
  if (t.key === S.seed) return;
  t.key = S.seed;
  t.games += 1;
  if (Number.isInteger(res.winner)) t.wins[res.winner] = (t.wins[res.winner] ?? 0) + 1;
  else t.draws += 1;
  S.localTally = t;
}

function localTallyHtml(game) {
  const t = S.localTally;
  if (S.mode !== 'local' || !t?.games) return '';
  const n = Math.max(2, t.wins.length);
  const list = Array.from({ length: n }, (_, p) => `<b class="pl p${p}">${esc(game.players?.[p] ?? `${p + 1}番目`)}</b> ${t.wins[p] ?? 0}勝`).join('・');
  return `🏆 この画面の成績（${t.games}回）: ${list}${t.draws ? `・引き分け ${t.draws}回` : ''}`;
}

// 待合室に出す成績表の行。ホストには「成績を0に戻す」も付ける（2026-10-06 本人の決定。日をまたいで同じ部屋を使うときのため）
function tallyLine() {
  const html = tallyHtml();
  if (!html) return null;
  const p = document.createElement('p');
  p.className = 'lobby-note tally';
  p.innerHTML = html;
  if (S.isHost) {
    const b = makeButton('成績を0に戻す', () => {
      if (!confirm('この部屋の成績表・連勝・対局の履歴を0に戻しますか？')) return;
      S.tally = null;
      S.history = null;
      S.streak = null;
      saveRoom();
      sendState();
      render();
      toast('成績表を0に戻しました');
    }, 'ghost small');
    b.classList.add('tally-reset');
    const aw = makeButton('🏆 お開きの表彰', () => { send({ type: 'award' }); showAward(); }, 'ghost small');
    aw.classList.add('tally-reset');
    p.append(' ', aw, ' ', b);
  }
  return p;
}

/* ---------- お開きの表彰（2026-10-07。20回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// 待合室でホストが「🏆 お開きの表彰」を押すと、部屋の成績表から1〜3位を表彰する小窓と紙吹雪を全員の画面に出す（オンラインだけ）。
// Claude の判断: 表彰するだけで、部屋も成績表もそのまま（閉じればいつもの待合室。続けて遊んでもよい）。成績表に1回でも対局があるときだけ押せる。
// 送るのは「表彰して」という合図（type: 'award'）だけで、順位は受け取った端末がそれぞれ自分の成績表（state で全員同じ）から作る。
// ホストからの合図だけ受け付け、送りっぱなし（あとから入った人には出ない）。勝った回数が同じ人は同じ順位。だれも勝っていなければ「みんな引き分け」。
// 予想の当たりが1回でもあれば「🔮 予想王」（いちばん多く当てた人。同じ回数なら全員）も添える。紙吹雪は動きを減らす設定の端末では出ない（confetti）。
function awardRanks() {
  const t = S.tally;
  const src = ptsOn(t) ? t.pts : t?.wins ?? {}; // 順位で点なら点で表彰する（28回目の案）
  const w = (id) => (Number.isInteger(src[id]) ? src[id] : 0);
  const ids = [...new Set([...S.members, ...Object.keys(src)])].filter((id) => !isCpu(id) && w(id) > 0 && (S.members.includes(id) || S.names[id]));
  const counts = [...new Set(ids.map(w))].sort((a, b) => b - a).slice(0, 3);
  return counts.map((n) => ({ n, ids: ids.filter((id) => w(id) === n) })); // 上から順に、同じ勝ち数の人をまとめる
}

function closeAward() { dropPop(document.querySelector('.award-pop:not(.closing)')); }

function showAward() {
  const games = S.tally?.games;
  if (S.mode !== 'online' || !Number.isInteger(games) || games < 1) return; // 届いた数は整数だけ使う（外から来た値なので）
  closeAward();
  closeInvite();
  const who = (id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b>`; // 名前は外から来た文字なので esc()
  const medal = ['🥇', '🥈', '🥉'];
  const ranks = awardRanks();
  let place = 1; // 同じ勝ち数の人が2人いたら、次は3位（よくある順位の付け方）。3位までを出す
  const rows = [];
  for (const r of ranks) {
    if (place > 3) break;
    rows.push(`<li class="award-row"><span class="award-medal">${medal[place - 1]}</span><span class="award-place">${place}位</span><span class="award-who">${r.ids.map(who).join('・')}</span><span class="award-n">${r.n}${ptsOn(S.tally) ? '点' : '勝'}</span></li>`);
    place += r.ids.length;
  }
  const pr = S.tally.preds && typeof S.tally.preds === 'object' ? S.tally.preds : {};
  const hit = (id) => (Number.isInteger(pr[id]) && pr[id] > 0 ? pr[id] : 0);
  const seers = Object.keys(pr).filter((id) => !isCpu(id) && hit(id) && (S.members.includes(id) || S.names[id]));
  const best = Math.max(0, ...seers.map(hit));
  const kings = seers.filter((id) => hit(id) === best);
  const pop = document.createElement('div');
  pop.className = 'invite-pop award-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'お開きの表彰');
  pop.innerHTML = `<div class="invite-box award-box">
    <div class="invite-title">🏆 今日の表彰</div>${S.roomName ? `<div class="invite-room">🏷 ${esc(S.roomName)}</div>` : ''}
    <p class="invite-note">この部屋で ${games}回 遊びました。おつかれさま！</p>
    ${rows.length ? `<ol class="award-list">${rows.join('')}</ol>` : `<p class="award-none">${ptsOn(S.tally) ? 'だれも点を取らず、みんな引き分けでした' : 'だれも勝たず、みんな引き分けでした'}</p>`}
    ${kings.length ? `<p class="award-seer">🔮 予想王: ${kings.map(who).join('・')}（${best}回 当てた）</p>` : ''}
  </div>`;
  const row = document.createElement('div');
  row.className = 'invite-actions';
  row.append(makeButton('閉じる', closeAward, 'secondary'));
  pop.querySelector('.award-box').append(row);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeAward(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAward(); });
  document.body.append(pop);
  row.querySelector('button')?.focus();
  play('win');
  confetti();
}

/* ---------- 対局の履歴（2026-10-07 本人の決定）: この部屋で遊んだゲームとだれが勝ったかを、待合室に新しい順で出す ---------- */
// Claude の判断: ホストが成績表と同じ所（countResult）で覚え、state の history で送る。新しい順に20回まで。開け閉めできる欄にして、待合室が長くならないようにする。
// 名前は外から来た文字なので、出すときは esc() を通す。「成績を0に戻す」で一緒に消える。
const HISTORY_MAX = 20;
function historyLine() {
  const list = S.history ?? [];
  if (S.mode !== 'online' || !list.length) return null;
  const row = (h) => `<li>${GAMES[h.g].icon} ${esc(GAMES[h.g].name)} — ${h.w.length ? h.w.map((n) => `<b>${esc(n)}</b>`).join('・') + ' の勝ち' : '引き分け'}</li>`;
  const box = document.createElement('details');
  box.className = 'lobby-history';
  box.open = !!S.historyOpen;
  box.ontoggle = () => { S.historyOpen = box.open; };
  box.innerHTML = `<summary>📜 この部屋の対局（新しい順・${list.length}回${list.length >= HISTORY_MAX ? 'まで' : ''}）</summary><ol>${list.map(row).join('')}</ol>`;
  return box;
}

/* ---------- 準備OK（2026-10-07 本人の決定）: 待合室で、部屋に入った人が「準備OK」を押す。ホストの画面にだれが準備できたかが出る ---------- */
// Claude の判断: ホスト以外の部屋の人（観戦の人も）が押せる。ホストは「始める」を押す人なので数えない。始めなくても押せる（目安だけ）。
// 待合室ごと（S.round）に数え直す: ゲームを変える・対局を始めると round が進むので、前の準備OK は消える。
// ゲストは type: 'ready' を送り、ホストが S.ready（{ round, ids }）に集めて state で送る。全員そろったら、ホストの「始める」が目立つ。
function readyIds() {
  return S.ready?.round === S.round ? S.ready.ids.filter((id) => S.members.includes(id) && id !== S.members[0]) : [];
}
const readyOthers = () => S.members.slice(1);
const allReady = () => readyOthers().length > 0 && readyOthers().every((id) => readyIds().includes(id));
function setReady(id, on) {
  const was = allReady();
  const ids = readyIds().filter((x) => x !== id);
  if (on) ids.push(id);
  S.ready = { round: S.round, ids };
  saveRoom();
  if (S.isHost && !was && allReady()) toast('✋ 全員の準備ができました！');
}
// 待合室に出す「準備OK 2/3人」の一行（ホスト以外がいるときだけ）
function readyLine() {
  const others = readyOthers();
  if (!others.length) return null;
  const ok = readyIds();
  const p = document.createElement('p');
  p.className = 'lobby-ready' + (allReady() ? ' all' : '');
  const wait = others.filter((id) => !ok.includes(id));
  p.innerHTML = `✋ 準備OK ${ok.length}/${others.length}人`
    + (ok.length ? `: ${ok.map((id) => esc(nameOf(id))).join('・')}` : '')
    + (wait.length ? `<small>（まだ: ${wait.map((id) => esc(nameOf(id))).join('・')}）</small>` : '');
  return p;
}
function readyButton() {
  const on = readyIds().includes(S.myId);
  return makeButton(on ? '準備をやめる' : '✋ 準備OK', () => {
    setReady(S.myId, !on);
    send({ type: 'ready', on: !on, round: S.round });
    render();
  }, on ? 'secondary' : 'primary');
}

/* ---------- 自分から観戦に回る（2026-11-13 便利機能の1回目。本人の選択。room.md） ---------- */
// 部屋のだれでも、自分で「👀 次は見るだけ」を付け外しできる。ホストが観戦に回す（S.bench）のと同じ扱いなので、全部のゲームで効き、ホストが席に選び直したら外れる。
// ゲストは type: 'rest' を送り、ホストが S.bench を直して state で送る。いまの対局はそのまま打ち、次の対局から観戦になる。
// Claude の判断: 待合室と結果の画面に出す（部屋に自分しかいないときは出さない）。勝ち残りで勝った人が付けたら、次は待っている人と交代する（stayNext）。
function setRest(id, on) {
  S.bench = on ? [...new Set([...(S.bench ?? []), id])] : (S.bench ?? []).filter((x) => x !== id);
  saveRoom();
  if (S.isHost) sendState();
}
function restButton() {
  const on = !!S.bench?.includes(S.myId);
  const b = makeButton(on ? '🙋 次は遊ぶ' : '👀 次は見るだけ', () => {
    setRest(S.myId, !on);
    if (!S.isHost) send({ type: 'rest', on: !on });
    render();
  }, 'ghost small');
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? '次の対局から遊ぶ側に戻ります' : '次の対局から観戦します（いまの対局はそのまま）';
  return b;
}
const restable = () => S?.mode === 'online' && S.members.length > 1;

/* ---------- 次のゲームの投票（2026-10-07 本人の決定）: 待合室で、遊びたいゲームに1人1票入れる。決めるのは今までどおりホスト ---------- */
// Claude の判断: 投票するのはホスト以外（ホストは「ゲームを変える」で決める人なので）。票は変えられ、「えらばない」で取り消せる。
// ゲストは type: 'vote' を送り、ホストが S.votes（人の id → ゲームの id）に集めて state で送る。部屋を出た人の票は数えない。
// そのゲームに切り替えたら、そのゲームへの票は消す（かなったので）。ほかのゲームへの票は残る。ホストの「ゲームを変える」の一覧に票の数が出る。
function voteCounts() {
  const n = {};
  for (const [id, g] of Object.entries(S.votes ?? {})) {
    if (id !== S.members[0] && S.members.includes(id) && GAMES[g]?.ready) n[g] = (n[g] ?? 0) + 1;
  }
  return n;
}
function setVote(id, g) {
  const now = { ...(S.votes ?? {}) };
  if (GAMES[g]?.ready) now[id] = g; else delete now[id];
  S.votes = now;
  saveRoom();
}
// 2026-11-03 本人の依頼「遊びたいゲーム欄を見やすく。図解など」: 選ぶ欄（select）をやめ、ゲームの絵と名前の札を並べて押す形にした（Claude の判断）。
//   票の入ったゲームは、上に大きめの札で票の数と一緒に並べる（ホストが押すとそのゲームに替わる）。
//   ゲストは「ゲームを選んで投票」を開くと全部のゲームの札が並び、押すと1票（もう一度押すと取り消し）。開け閉めは S.voteOpen（端末ごと・保存しない）。
function votedTiles() {
  const n = voteCounts();
  const ids = Object.keys(n).sort((a, b) => n[b] - n[a] || gameOrder().indexOf(a) - gameOrder().indexOf(b));
  if (!ids.length) return null;
  const box = document.createElement('div');
  box.className = 'vote-top';
  const head = document.createElement('p');
  head.className = 'lobby-vote';
  head.textContent = S.isHost ? '🗳 みんなが遊びたいゲーム（押すとそのゲームに替わります）' : '🗳 みんなが遊びたいゲーム';
  const list = document.createElement('div');
  list.className = 'vote-tiles big';
  for (const g of ids) {
    const t = voteTile(g, n[g]);
    if (S.isHost) t.onclick = () => { if (confirm(`${GAMES[g].name} に替えますか？`)) newRound(g, { lobby: true }); };
    else t.onclick = () => castVote(g);
    list.append(t);
  }
  box.append(head, list);
  return box;
}
function voteTile(g, count = 0) {
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'vote-tile' + (S.votes?.[S.myId] === g && !S.isHost ? ' mine' : '');
  t.innerHTML = `<span class="vote-icon" aria-hidden="true">${GAMES[g].icon ?? ''}</span><span class="vote-name">${esc(GAMES[g].name)}</span>${count ? `<span class="vote-count">${count}票</span>` : ''}`;
  return t;
}
function castVote(g) {
  const v = S.votes?.[S.myId] === g ? null : g; // 同じゲームをもう一度押すと取り消し
  setVote(S.myId, v);
  send({ type: 'vote', g: v });
  toast(v ? `🗳 ${GAMES[v].name} に投票しました` : '投票を取り消しました');
  render();
}
// 待合室の投票の欄（票の入ったゲーム＋ゲストは全部のゲームから選ぶ札）
function votePanel() {
  const wrap = document.createElement('div');
  wrap.className = 'lobby-votes';
  const top = votedTiles();
  if (top) wrap.append(top);
  if (S.isHost) return top ? wrap : null;
  const det = document.createElement('details');
  det.className = 'lobby-rules vote-pick';
  det.open = !!S.voteOpen;
  det.ontoggle = () => { S.voteOpen = det.open; };
  const mine = S.votes?.[S.myId];
  const sum = document.createElement('summary');
  sum.textContent = mine && GAMES[mine] ? `🗳 次に遊びたいゲーム（いまの票: ${GAMES[mine].icon ?? ''} ${GAMES[mine].name}）` : '🗳 次に遊びたいゲームを選んで投票する';
  const list = document.createElement('div');
  list.className = 'vote-tiles';
  const n = voteCounts();
  for (const id of gameOrder()) {
    if (!GAMES[id].ready || id === S.gameId) continue;
    const t = voteTile(id, n[id] ?? 0);
    t.onclick = () => castVote(id);
    list.append(t);
  }
  det.append(sum, list);
  wrap.append(det);
  return wrap;
}

/* ---------- 遊びの抽選（2026-11-04 本人の依頼）: 待合室で、ゲームの候補3つと「ほかの遊び」の4つからみんなで選ぶ ---------- */
// 本人の決定: 部屋のだれでも始められる。候補は、この部屋で直近に遊んだ5種類（📜 この部屋の対局）を除いた全ゲームから3つ。
//   みんなが4つから1つ選び、全員が選ぶか DRAW_MS（20秒）たったら、いちばん多いものに決まる（同じ数ならその中からくじ）。「ほかの遊び」に決まったら自動で引き直す。
// Claude の判断: いまの人数で遊べないゲームも外す（ゲームのルーレットと同じ決まり。いまのゲームは外さない）。引き直しでは、その抽選で前に出たゲームも外す
//   （残りが3つに満たなければ、いま出ていた3つだけ外す）。だれも選ばずに時間切れのときは、3つのゲームからくじ（「ほかの遊び」も入れると、だれもいないまま引き直しが続くため）。
//   決まるまでは選び直せる。CPU は選ばない。「全員」は合図が届いている人だけで数える（抜けたまま部屋に名前が残っている人を20秒待たないように）。
//   抽選するのも数えるのもホストの端末（S.draw = { n, by, re, opts, votes: 人の id → ゲームの id か 'other', seen }。state で送る）。ゲストは type: 'drawStart'・'drawVote' を送る。
//   決まったら、ホストが type: 'drawn' を送りっぱなしにして全員に一言出す。対局が始まる・ゲームが替わる（startRound・newRound）と抽選は消える。
//   残りの秒数は、もう一回の OK と同じく各端末が見たときから数える（端末ごとに少しずれる。決めるのはホストの時計）。
const DRAW_MS = 20000;
const DRAW_RECENT = 5;
const DRAW_OTHER = 'other';
function recentGames() {
  const out = [];
  for (const h of S.history ?? []) {
    if (!out.includes(h.g)) out.push(h.g);
    if (out.length >= DRAW_RECENT) break;
  }
  return out;
}
// 候補を3つまで引く（skip = その抽選で前に出たゲーム）
function drawOpts(skip = []) {
  const recent = recentGames();
  const pool = GAME_ORDER.filter((id) => playableNow(GAMES[id]) && !recent.includes(id));
  let list = pool.filter((id) => !skip.includes(id));
  if (list.length < 3) list = pool.filter((id) => !skip.slice(-3).includes(id));
  if (list.length < 3) list = pool;
  list = list.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, 3);
}
const drawNeed = () => S.members.filter(alive);
const drawValid = (d, c) => c === DRAW_OTHER || d.opts.includes(c);
const drawVotes = () => (S.draw ? Object.fromEntries(Object.entries(S.draw.votes ?? {}).filter(([id, c]) => S.members.includes(id) && drawValid(S.draw, c))) : {});
// ホストだけ。by = 抽選を始めた人。redraw = 「ほかの遊び」に決まって引き直す
function startDraw(by, redraw = false) {
  if (!S.isHost || S.mode !== 'online' || S.order) return;
  const seen = redraw ? S.draw?.seen ?? [] : [];
  const opts = drawOpts(seen);
  if (!opts.length) { S.draw = null; toast('いまの人数で遊べるゲームがありません'); render(); return; }
  S.draw = { n: Date.now(), by, re: redraw, opts, votes: {}, seen: [...seen, ...opts] };
  saveRoom();
  sendState();
  render();
}
function onDrawVote(id, n, c) {
  const d = S.draw;
  if (!S.isHost || !d || d.n !== n || !S.members.includes(id) || !drawValid(d, c)) return;
  S.draw = { ...d, votes: { ...d.votes, [id]: c } };
  saveRoom();
  sendState();
  checkDraw();
}
function chooseDraw(c) {
  const d = S.draw;
  if (!d || drawVotes()[S.myId] === c) return;
  if (S.isHost) { onDrawVote(S.myId, d.n, c); render(); return; }
  S.draw = { ...d, votes: { ...d.votes, [S.myId]: c } }; // 先に自分の画面に出す（ホストからの state で置き換わる）
  send({ type: 'drawVote', n: d.n, c });
  render();
}
// ホストだけ。全員が選んだらすぐ、時間切れなら票で決める（抽選の画面を描くたびと、時間切れのときに見る）
function checkDraw() {
  const d = S?.draw;
  if (!S?.isHost || S.mode !== 'online' || !d || S.order) return;
  if (S.drawKey !== d.n) {
    S.drawKey = d.n;
    S.drawStart = Date.now();
    clearTimeout(S.drawTimer);
    const session = S;
    S.drawTimer = setTimeout(() => { if (S === session) checkDraw(); }, DRAW_MS + 50);
  }
  const votes = drawVotes();
  if (!drawNeed().every((id) => votes[id]) && Date.now() - S.drawStart < DRAW_MS) return;
  setTimeout(() => { if (S?.draw?.n === d.n) finishDraw(); }, 0);
}
function finishDraw() {
  const d = S.draw;
  const votes = Object.values(drawVotes());
  const count = (c) => votes.filter((v) => v === c).length;
  const choices = votes.length ? [...d.opts, DRAW_OTHER] : d.opts;
  const top = Math.max(...choices.map(count));
  const tied = choices.filter((c) => count(c) === top);
  const win = tied[Math.floor(Math.random() * tied.length)];
  const tie = tied.length > 1 && votes.length > 0;
  send({ type: 'drawn', g: win, tie });
  drawnToast(win, tie);
  if (win === DRAW_OTHER) { startDraw(d.by, true); return; }
  if (win !== S.gameId) { newRound(win, { lobby: true }); return; } // 抽選は newRound が消す
  S.draw = null;
  saveRoom();
  sendState();
  render();
}
function drawnToast(g, tie) {
  if (g === DRAW_OTHER) toast(`🔄 「ほかの遊び」に決まったので、引き直しました${tie ? '（同じ票の中からくじ）' : ''}`);
  else toast(`🎰 ${GAMES[g].name} に決まりました${tie ? '（同じ票の中からくじ）' : ''}`);
}
function onDrawn(msg) {
  if (S.isHost || !S.members.length || msg.from !== S.members[0]) return;
  if (msg.g === DRAW_OTHER || GAMES[msg.g]?.ready) drawnToast(msg.g, msg.tie === true);
}
let drawTick = null;
// 待合室の抽選の欄（抽選の前は始めるボタン、抽選の間は4つの札）
function drawPanel() {
  if (S.mode !== 'online' || S.order) return null;
  const d = S.draw;
  if (!d) {
    const box = document.createElement('div');
    box.className = 'draw-start';
    const b = makeButton('🎰 遊びの抽選', () => {
      if (S.isHost) startDraw(S.myId);
      else { send({ type: 'drawStart', round: S.round }); toast('🎰 抽選しています…'); }
    }, 'secondary');
    b.disabled = !drawOpts().length;
    const note = document.createElement('small');
    note.textContent = `最近遊んだ${DRAW_RECENT}種類を除いて3つのゲームを引き、「ほかの遊び」と合わせた4つからみんなで選びます`;
    box.append(b, note);
    return box;
  }
  checkDraw();
  const votes = drawVotes();
  S.drawSeen ??= {};
  S.drawSeen[d.n] ??= Date.now();
  const leftText = () => `残り ${Math.max(0, Math.ceil((DRAW_MS - (Date.now() - (S?.drawSeen?.[d.n] ?? Date.now()))) / 1000))}秒`;
  const who = (id) => esc(id === S.myId ? 'あなた' : nameOf(id));
  const box = document.createElement('div');
  box.className = 'draw-box';
  const head = document.createElement('p');
  head.className = 'draw-head';
  head.innerHTML = `🎰 遊びの抽選${d.re ? '（引き直し）' : S.members.includes(d.by) ? `（${who(d.by)}が引きました）` : ''}　<b class="draw-left">${leftText()}</b>`;
  const note = document.createElement('p');
  note.className = 'lobby-note';
  note.textContent = `遊びたいものを1つ選んでください。全員が選ぶか${DRAW_MS / 1000}秒たつと、いちばん多いものに決まります（同じ数ならくじ）。`;
  const list = document.createElement('div');
  list.className = 'vote-tiles big draw-tiles';
  for (const c of [...d.opts, DRAW_OTHER]) {
    const n = Object.values(votes).filter((v) => v === c).length;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'vote-tile' + (votes[S.myId] === c ? ' mine' : '');
    t.innerHTML = c === DRAW_OTHER
      ? `<span class="vote-icon" aria-hidden="true">🔄</span><span class="vote-name">ほかの遊び</span><span class="vote-desc">引き直す</span>`
      : `<span class="vote-icon" aria-hidden="true">${GAMES[c].icon ?? ''}</span><span class="vote-name">${esc(GAMES[c].name)}</span><span class="vote-desc">${esc(GAMES[c].desc ?? '')}</span>`;
    if (n) t.insertAdjacentHTML('beforeend', `<span class="vote-count">${n}票</span>`);
    t.onclick = () => chooseDraw(c);
    list.append(t);
  }
  const need = drawNeed();
  const waitFor = need.filter((id) => !votes[id]);
  const line = document.createElement('p');
  line.className = 'draw-line';
  line.innerHTML = `選んだ: ${need.length - waitFor.length}/${need.length}人${waitFor.length ? `<small>（まだ: ${waitFor.map(who).join('・')}）</small>` : ''}`;
  box.append(head, note, list, line);
  clearInterval(drawTick);
  drawTick = setInterval(() => {
    const b = document.querySelector('.draw-left');
    if (!b || S?.draw?.n !== d.n) { clearInterval(drawTick); drawTick = null; return; }
    b.textContent = leftText();
  }, 500);
  return box;
}

/* ---------- 待合室の「いま選んでいるゲーム」（2026-11-03 本人の依頼「選択中のゲームをもっとわかりやすく」） ---------- */
// Claude の判断: 待合室の一番上に、ゲームの絵・名前・ひとこと・遊び方の図（2枚まで）を大きく出す。
// ホストがゲームを替えたら、札を2秒ほど光らせて知らせる（描き直しで作り直しても光り方が途中から続くよう、替わった時刻からの経過を animation-delay に入れる）。
function lobbyGameCard(game) {
  if (S.lobbyGame !== game.id) {
    if (S.lobbyGame) S.lobbyGameAt = Date.now();
    S.lobbyGame = game.id;
    S.lobbyFigAt = Date.now(); // 遊び方の図をめくる（lobbyFigs）を1枚目から
  }
  const box = document.createElement('div');
  box.className = 'lobby-game';
  const ago = Date.now() - (S.lobbyGameAt ?? 0);
  if (ago < 2000) { box.classList.add('changed'); box.style.animationDelay = `-${ago}ms`; }
  box.innerHTML = `<div class="lobby-game-head"><span class="lobby-game-icon" aria-hidden="true">${game.icon ?? ''}</span>`
    + `<div><small>いま選んでいるゲーム</small><b class="lobby-game-name">${esc(game.name)}</b><p>${esc(game.desc ?? '')}</p></div></div>`;
  if (game.howtoFigs?.length) box.append(lobbyFigs(game.howtoFigs));
  return box;
}
// 待合室の見本（2026-11-10 本人の選択「遊び方の図をめくる」。room.md「演出・アニメーションの3回目」）: 遊び方の図を1枚ずつ、マスが順に出て
// 光る所が光り一言が出る形で、紙芝居のように繰り返す。待合室は人の出入り・準備OK などで何度も描き直すので、ゲームを選んだ時刻（S.lobbyFigAt）からの
// 経過でいまの1枚と進み具合を決めて animation-delay に入れ、描き直しても続きから動かす。1枚が終わったら下の setInterval が次の1枚に替える（待合室は描き直さない）。
// 図は全部同じ場所に重ね、高さは一番高い図に合わせる（替わるたびに下の欄が動かないように）。Claude の判断: 1枚 3.6秒。
// 動きを減らす設定の端末と図が1枚のゲームでは、今までどおり2枚まで並べて止めて出す
const FLIP_MS = 3600; // style.css の .hf-flip の hf-cycle と同じ長さ
function lobbyFigs(figs) {
  if (lessMotion() || figs.length < 2) return howtoFigs(figs.slice(0, 2));
  const wrap = howtoFigs(figs);
  wrap.classList.add('hf-flip');
  for (const fig of wrap.children) {
    const cells = fig.querySelectorAll('.hf-cell, .hf-card, .hf-text');
    cells.forEach((c, k) => c.style.setProperty('--k', String(k)));
    fig.style.setProperty('--nc', String(cells.length));
  }
  flipSync(wrap, true);
  return wrap;
}
function flipSync(wrap, fresh) {
  const t = Math.max(0, Date.now() - (S?.lobbyFigAt ?? 0));
  const i = Math.floor(t / FLIP_MS) % wrap.children.length;
  if (!fresh && wrap.dataset.i === String(i)) return;
  wrap.dataset.i = String(i);
  [...wrap.children].forEach((fig, j) => {
    fig.classList.toggle('on', j === i);
    fig.style.setProperty('--ph', `${fresh ? -(t % FLIP_MS) : 0}ms`); // 描き直しで作った図は途中から、替わった図は始めから
  });
}
setInterval(() => {
  const w = document.querySelector('.hf-flip');
  if (w?.isConnected) flipSync(w, false);
}, 200);
// 待合室の下に出す、準備OK と投票の欄（ゲストはボタンと投票の一覧、ホストは数だけ）
/* ---------- 部屋の名前（2026-10-07 本人の決定）: ホストが部屋に名前を付け、部屋の欄・招待の小窓に出す ---------- */
// Claude の判断: 16文字まで。外から来た文字なので、出すときは textContent か esc() を通す。state の roomName で送る。空なら出さない。
// 付けるのはホストの待合室だけ（ゲストには部屋の欄に出る）。
const cleanRoomName = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
function roomNamePanel() {
  if (S.mode !== 'online' || !S.isHost) return null;
  const label = document.createElement('label');
  label.className = 'lobby-roomname';
  const text = document.createElement('span');
  text.textContent = '🏷 部屋の名前';
  const input = document.createElement('input');
  input.maxLength = 16;
  input.placeholder = '例: 〇〇家の対戦部屋';
  input.value = S.roomName ?? '';
  input.onchange = () => {
    if (isBad(cleanRoomName(input.value))) { toast(BAD_TEXT_NOTE); input.value = S.roomName ?? ''; return; }
    S.roomName = cleanRoomName(input.value);
    saveRoom();
    sendState();
    render();
  };
  label.append(text, input);
  return label;
}

/* ---------- いまのルール（2026-10-07 本人の決定）: 「？遊び方」の下に、詳細設定で最初と変えたルールの一覧を出す ---------- */
// Claude の判断: 対局中も見られるように「？遊び方」の欄の下に足す（上の段にボタンを増やすとスマホ幅で入りきらないため）。
// 最初の設定と同じものは出さない。人数・CPU の強さ・盤の大きさなども、最初と違えば出す（何で遊んでいるか分かるように）。
/* ---------- 詳細設定を覚える（2026-10-07 本人の決定）: ホストが変えた詳細設定を端末に覚え、次に部屋を作ったときにそのまま使う ---------- */
// Claude の判断: ゲームごとに覚える（localStorage の bg-rules）。部屋を作るときだけ読む（同じ画面の対局は詳細設定を選ぶ所が無いので使わない）。
// おかしな値は rulesOf が最初の値に直すので、読むときは形だけ確かめる。「↺ 最初の設定に戻す」で、そのゲームの分を消せる。
const RULES_KEY = 'bg-rules';
function savedRules() {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_KEY) ?? '{}');
    if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
    return Object.fromEntries(Object.entries(r).filter(([id, v]) => GAMES[id] && v && typeof v === 'object' && !Array.isArray(v)));
  } catch { return {}; }
}
function rememberRules(rules = S?.rules) {
  if (S?.mode !== 'online' || !S.isHost) return;
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules ?? {})); } catch { /* 覚えられなくても、この部屋では使える */ }
}

function changedRules(game) {
  const cur = rulesOf(game.id, S?.rules);
  return (game.settings ?? []).filter((x) => cur[x.key] !== x.def).map((x) => {
    const v = cur[x.key];
    const name = x.choices ? (x.choices.find(([c]) => c === v)?.[1] ?? String(v)) : v ? 'あり' : 'なし';
    return `${x.label}: ${name}`;
  });
}

function appendLobbyExtras(board) {
  board.append(meTools());
  const nm = roomNamePanel();
  if (nm) board.append(nm);
  const r = readyLine();
  if (r) board.append(r);
  const dp = drawPanel();
  const top = board.querySelector('.lobby-game');
  if (dp && S.draw && top) top.after(dp); // 抽選の間は、いまのゲームのすぐ下に大きく出す
  else if (dp) board.append(dp);
  const v = votePanel();
  if (v) board.append(v);
  board.append(rpsPanel());
}

/* ---------- 待合室でじゃんけん（2026-10-08。24回目の案。本人が選んだ）: 人がそろうのを待つ間のおまけ ---------- */
// Claude の判断: 待合室にいる部屋の人（ホストも観戦の人も）が ✊✌️✋ から1つ出す（出したら変えられない）。全員が出したら手を見せて勝ち負けを出す。
// 部屋に1人のときは CPU が相手（出した瞬間にホストの端末が CPU の手を決める）。勝ち負けはおまけなので、成績表・連勝には入れない。
// 出した手は、全員が出すまで「✓」とだけ見せる（簡易な隠し方。開発用の道具では覗ける）。
// ゲストは type: 'rps'（回の番号 n と手 h）を送り、ホストが S.rps（{ n, hands: 人の id → 手 }）に集めて state で送る。
// 手を見せたあとにだれかが出すと、次の回（n + 1）が始まる。見せた直後に何人かが同時に出しても、1つ前の回の番号で届いた手は次の回に入れる。
// 2026-10-30 本人の依頼（目立たないように）: 開け閉めできる欄にし、最初は閉じておく（開けたかは S.rpsOpen。端末ごと）。閉じている間も、だれかが出していれば見出しに人数を添える。
const RPS = { g: '✊', c: '✌️', p: '✋' };
const RPS_NAME = { g: 'グー', c: 'チョキ', p: 'パー' };
const RPS_BEATS = { g: 'c', c: 'p', p: 'g' };
// 1人で CPU とした回が残っているところに、だれかが入ってきた（その回は終わったものとして、次に出した人から新しい回）
const rpsSolo = () => S.members.length >= 2 && !!RPS[S.rps?.hands?.cpu];
const rpsHands = () => (rpsSolo() ? {} : S.rps?.hands ?? {});
const rpsPlayers = () => (S.members.length >= 2 ? S.members : [...S.members, 'cpu']);
const rpsShown = () => rpsPlayers().every((id) => RPS[rpsHands()[id]]);
// 手を入れる（ホストは届いた手も。ゲストは自分の手を先に入れて見せ、ホストからの state で置き換わる）。入れられなければ false
function rpsPut(id, h, n) {
  const cur = S.rps ?? { n: 0, hands: {} };
  if (n === cur.n - 1) n = cur.n; // 見せた直後に、ほかの人と同時に出した
  if (n !== cur.n || !RPS[h]) return false;
  let next;
  if (rpsShown() || rpsSolo()) next = { n: cur.n + 1, hands: { [id]: h } };
  else if (RPS[rpsHands()[id]] && S.members.length >= 2) return false; // 1人（CPU が相手）なら出し直せる（相手が抜けて1人になったときに止まらないように）
  else next = { n: cur.n, hands: { ...cur.hands, [id]: h } };
  if (S.isHost && S.members.length < 2) next.hands.cpu = 'gcp'[Math.floor(Math.random() * 3)];
  S.rps = next;
  saveRoom();
  return true;
}
// 勝った手（あいこなら null）
function rpsWinHand(hands) {
  const kinds = [...new Set(hands)];
  if (kinds.length !== 2) return null;
  return RPS_BEATS[kinds[0]] === kinds[1] ? kinds[0] : kinds[1];
}
function rpsPanel() {
  const box = document.createElement('details');
  box.className = 'lobby-rps';
  box.open = !!S.rpsOpen;
  box.ontoggle = () => { S.rpsOpen = box.open; };
  const hands = rpsHands();
  const players = rpsPlayers();
  const shown = rpsShown();
  const who = (id) => esc(id === 'cpu' ? '🤖 CPU' : id === S.myId ? 'あなた' : nameOf(id));
  let line;
  if (shown) {
    const win = rpsWinHand(players.map((id) => hands[id]));
    const winners = players.filter((id) => hands[id] === win);
    line = 'ぽん！ ' + players.map((id) => `${who(id)} ${RPS[hands[id]]}`).join('・')
      + ` → <b>${win ? `${winners.map(who).join('・')}の勝ち！` : 'あいこ！'}</b>`;
    // 手を見せた回ごとに1回だけ音を鳴らす（勝った人は「正解」の音）
    if (S.rpsHeard !== S.rps.n) {
      if (S.rpsHeard !== undefined && players.includes(S.myId)) play(winners.includes(S.myId) ? 'correct' : 'pop'); // 部屋に入ったときに見せてあった回では鳴らさない
      S.rpsHeard = S.rps.n;
    }
  } else {
    S.rpsHeard ??= null; // これより後に見せた回は鳴らす
    const done = players.filter((id) => RPS[hands[id]]);
    const wait = players.filter((id) => !RPS[hands[id]]);
    line = done.length
      ? `出した: ${done.map((id) => `${who(id)} ✓`).join('・')}<small>（まだ: ${wait.map(who).join('・')}）</small>`
      : (S.members.length < 2 ? 'CPU と勝負できます' : '全員が出したら「ぽん！」');
  }
  const mine = !shown && RPS[hands[S.myId]];
  const put = shown ? 0 : players.filter((id) => RPS[hands[id]]).length;
  box.innerHTML = `<summary>✊ じゃんけん（待っている間のおまけ）${mine ? ` <small>あなたは ${RPS[mine]}</small>` : put ? ` <small>${put}人が出した</small>` : ''}</summary><p class="rps-line">${line}</p>`;
  const row = document.createElement('div');
  row.className = 'rps-btns';
  for (const h of ['g', 'c', 'p']) {
    const b = makeButton(`${RPS[h]} ${RPS_NAME[h]}`, () => {
      const n = S.rps?.n ?? 0;
      if (!rpsPut(S.myId, h, n)) return;
      if (S.isHost) sendState(); else send({ type: 'rps', n, h });
      render();
    }, 'secondary small');
    b.disabled = !!mine && S.members.length >= 2;
    row.append(b);
  }
  box.append(row);
  return box;
}

/* ---------- 対局の時間（2026-10-07 本人の決定）: 結果の画面に「この対局は ◯分◯秒」と出す ---------- */
// Claude の判断: ホストの端末（同じ画面の対局ではその端末）が、対局の画面を最初に描いたときから決着を見たときまでを測り、
// state の timer で全員へ送る（端末ごとの時計のずれが出ないように、始めと終わりを同じ端末で測る）。
// 途中から測り始めた（再読み込みで覚えていなかったなど）ときは出さない。エアホッケーは結果が main.js を通らないので出ない。
const timerKey = () => `${S.gameId}:${S.round}:${S.seed}`;
function trackTime(res) {
  if (S.mode === 'online' && !S.isHost) return;
  if (S.timer?.key !== timerKey()) S.timer = { key: timerKey(), start: S.moves.length ? null : Date.now(), end: null };
  if (res && S.timer.start && !S.timer.end) {
    S.timer.end = Date.now();
    saveRoom();
  }
}
function timeHtml() {
  const t = S.timer;
  if (t?.key !== timerKey() || !t.start || !t.end || t.end < t.start) return '';
  const sec = Math.round((t.end - t.start) / 1000);
  return `⏱ この対局は ${sec >= 60 ? `${Math.floor(sec / 60)}分` : ''}${sec % 60}秒`;
}

/* ---------- 勝ち残り（2026-10-06 本人の決定）: 盤のゲームのもう一回で、負けた人が観戦の人と交代する ---------- */
// Claude の判断: ホストが待合室で付け外しする（部屋の設定。ゲームを変えても残る）。エアホッケーは結果が main.js を通らないので使えない。
// 勝った人は残り、負けた人の席に、待っている人（前から待っている順 → 負けた人の順）が入る。待っている人がいなければ、負けた人がそのまま続ける。
// 負けた CPU は待っている人がいれば抜け、いなければ残る。部屋を出た人の席も、待っている人がいれば埋める。
// 新しく入った人から先に打つ。引き分け・待っている人がいないときは、いつものもう一回（打つ順番を1つ回す）。
const stayOn = () => S.mode === 'online' && !!S.stay && !GAMES[S.gameId]?.multi && !GAMES[S.gameId]?.live;

// 決着した対局のあとの席（pick の形）と、まだ待っている人の順番。いつものもう一回にするときは null
function stayNext(res) {
  if (!stayOn() || !res || !S.order) return null;
  const ids = S.order.map((id) => (isCpu(id) ? 'cpu' : id));
  const won = new Set(winnersOf(res));
  if (!won.size) return null;
  const gone = (id) => id !== 'cpu' && !S.members.includes(id);
  const seated = new Set(ids);
  // 観戦に回した人（S.bench）は順番待ちにも入れない（2026-11-04 Codex の点検の指摘。入れると勝ち残りの交代で席に入っていた）
  const waiting = S.members.filter((id) => !seated.has(id) && alive(id) && !S.bench?.includes(id));
  if (!waiting.length) return null;
  const line = S.line ?? [];
  const queue = [...line.filter((id) => waiting.includes(id)), ...waiting.filter((id) => !line.includes(id))];
  // 「👀 次は見るだけ」を付けた人（S.bench）は、勝っても席を空け、順番待ちにも並ばない（2026-11-13 自分から観戦に回る）
  const rest = (id) => !!S.bench?.includes(id);
  const stayers = ids.filter((id, p) => won.has(p) && !gone(id) && !rest(id));
  const out = ids.filter((id, p) => !won.has(p) || gone(id) || rest(id));
  queue.push(...out.filter((id) => id !== 'cpu' && !gone(id) && !rest(id)));
  const enter = out.map(() => queue.shift() ?? 'cpu');
  return { pick: [...enter, ...stayers], line: queue };
}

// 結果の画面に出す「次に入る人」
function stayHtml(res) {
  const next = stayNext(res);
  if (!next) return '';
  const enter = next.pick.filter((id) => id !== 'cpu' && !S.order.includes(id));
  if (!enter.length) return '';
  return '👑 勝ち残り: 次は ' + enter.map((id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b>`).join('・') + ' が入ります';
}

/* ---------- 連勝（2026-10-06 本人の決定）: 同じゲームを同じ顔ぶれで続けている間、だれが何連勝中かを出す ---------- */
// Claude の判断: ゲームを変えたり顔ぶれ（CPU を含む）が変わったら数え直す。引き分けは全員の連勝が止まる。勝った人が2人以上（同点の1位）なら全員を数える。
// オンラインだけ。ホストの端末が数えて全員へ送る（あとから入った人にも同じ数が見えるように）。

// 勝ち残りでは顔ぶれが毎回変わるので、顔ぶれでなくゲームだけで見る（勝ち続けている人の連勝が続くように）
const streakKey = () => (stayOn() ? `${S.gameId}:stay` : `${S.gameId}:${[...roundOrder()].sort().join(',')}`);

// 対局の結果を見たときに1回だけ、連勝と部屋の成績表を数える（ホストだけ）
function countResult(res, st, game) {
  if (!S.isHost || S.mode !== 'online' || !S.order) return;
  const counted = `${S.gameId}:${S.round}`;
  if (S.streak?.counted === counted) return;
  const key = streakKey();
  const before = S.streak?.key === key ? S.streak.wins : {};
  const won = new Set(winnersOf(res).map((p) => S.order[p]));
  S.streak = { key, counted, wins: Object.fromEntries(S.order.map((id) => [id, won.has(id) ? (before[id] ?? 0) + 1 : 0])) };
  // 部屋の成績表: 人だけを数える（CPU の番号は対局ごとに付け直すので数えない）
  const t = S.tally ?? { games: 0, wins: {} };
  const wins = { ...t.wins };
  for (const id of won) if (!isCpu(id)) wins[id] = (wins[id] ?? 0) + 1;
  // 勝敗予想の当たり: ホストの端末に届いている予想で数える（予想は1巡するまでに締め切るので、決着のときには全部届いている）
  const preds = { ...(t.preds ?? {}) };
  const by = predsNow();
  const wonP = winnersOf(res);
  for (const id of Object.keys(by)) if (!isCpu(id) && wonP.includes(by[id])) preds[id] = (preds[id] ?? 0) + 1;
  // 勝率のため、対局した人（人だけ）の対局の数も数える。前の形の成績表（played が無いまま対局がある）は、勝ちの数と合わなくなるので
  // 「成績を0に戻す」まで数えない
  const old = t.games > 0 && !t.played;
  const played = { ...(t.played ?? {}) };
  if (!old) for (const id of new Set(S.order)) if (id && !isCpu(id)) played[id] = (played[id] ?? 0) + 1;
  // 順位で点（28回目の案）: 表に出すのが勝った回数のときも数えておく（途中で切り替えても点がそろっているように）。
  // 前の形の成績表（pts が無いまま対局がある）は、点が足りなくなるので「成績を0に戻す」まで数えない（勝率と同じ）
  const oldPts = t.games > 0 && !t.pts;
  const pts = { ...(t.pts ?? {}) };
  if (!oldPts) seatPoints(res, S.order.length).forEach((v, p) => { const id = S.order[p]; if (id && !isCpu(id) && v > 0) pts[id] = (pts[id] ?? 0) + v; });
  // 部屋の最高記録: 自己ベストを取るゲームなら、対局した人（人だけ。部屋を出て CPU が代わりに打った人は入れない）の数字で上位3人を入れ替える
  let best = t.best;
  if (game?.record && st) {
    const key = recordKey(game, rulesOf(S.gameId, S.rules));
    let list = [...(best?.[key] ?? [])];
    S.order.forEach((id, p) => {
      if (!id || isCpu(id) || cpuControlled(id)) return;
      const v = game.record.of(st, p, S.moves);
      if (!Number.isInteger(v)) return;
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0 && list[i].v >= v) return;
      if (i >= 0) list.splice(i, 1);
      list.push({ id, n: nameOf(id).slice(0, 30), v });
    });
    list = list.sort((a, b) => b.v - a.v).slice(0, 3);
    if (list.length) best = { ...(best ?? {}), [key]: list };
  }
  S.tally = { games: t.games + 1, wins, preds, ...(old ? {} : { played }), ...(oldPts ? {} : { pts }), ...(best ? { best } : {}) };
  // 対局の履歴: 新しいものから HISTORY_MAX 個。勝った人はそのときの表示名で覚える（CPU の名前は対局ごとに変わるため）
  const names = [...won].map((id) => nameOf(id));
  S.history = [{ g: S.gameId, w: names }, ...(S.history ?? [])].slice(0, HISTORY_MAX);
  saveRoom();
  sendState();
}

// 状態の欄に出す「🔥 ◯◯ 3連勝中」（2連勝から）
function streakHtml() {
  if (S.mode !== 'online' || !S.order || S.streak?.key !== streakKey()) return '';
  const list = S.order
    .map((id) => [id, S.streak.wins?.[id]])
    .filter(([, n]) => Number.isInteger(n) && n >= 2)
    .sort((a, b) => b[1] - a[1]);
  if (!list.length) return '';
  return '🔥 ' + list.map(([id, n]) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b> ${n}連勝中`).join('・');
}

// この対局のプレイヤー番号 → 人の id。盤のゲームで相手がまだいない席は undefined
function roundOrder() {
  return S.mode === 'online' ? S.order ?? [] : [];
}

// ゲームの詳細設定。決めていない項目・おかしな値は既定値。choices があれば選択肢、無ければ はい/いいえ
function rulesOf(gameId, rules) {
  return Object.fromEntries((GAMES[gameId]?.settings ?? []).map((x) => {
    const v = rules?.[gameId]?.[x.key];
    const ok = x.choices ? x.choices.some(([c]) => c === v) : typeof v === 'boolean';
    return [x.key, ok ? v : x.def];
  }));
}

// 「おまかせ」（待合室でホストが押すと詳細設定を抽選する。2026-10-06 本人の決定）で抽選しない項目。本人が決めたのは
// 人数・CPU の強さと速さ・盤の大きさ。時間・回数・長さ・難しさ・読み上げ・駒落ち・ヒント（神経衰弱・難読漢字・お絵描き当て）・
// エアホッケーのゴールの広さ（goal。盤の大きさと同じ）・難読漢字の答え方（choice。難しさと同じ）・マンカラの穴の数（pits。盤の大きさと同じ）・
// いろあわせの最初の手札（deal。長さと同じ）・麻雀の待ち牌の表示（waits。ヒントと同じ）・
// 将棋のいつも成る（autopromo。初めての人向けの手助けなのでヒントと同じ）・麻雀のツモ切りの表示（tsumogiri。待ち牌の表示と同じ）・
// ヒット＆ブローの桁数（digits。難しさと同じ。5桁を足したときに入れた）も好みなので抽選しない（Claude の判断）。
// エアホッケーのマレットの大きさ（mallet。23回目の案。ゴールの広さと同じハンデなので）も抽選しない。
// 将棋の王手の知らせ（check。19回目の案。初めての人向けの手助けなので、いつも成ると同じ）も抽選しない。
// 将棋のトライ（try）・神経衰弱の色もそろえる（color）・お絵描き当てのインクの量（ink）は遊び方なので抽選する。
// マンカラの最初の石の数（stones。長さ）・間違い探しの違いの数（diffs。難しさ）も抽選しない（2026-10-10 の Codex の点検で見つかった。本人承認）。
// タイピング早打ちのお題の種類（kind。長さ）も抽選しない（2026-10-10 の Codex の点検。本人承認）。
// 例外: ぴったりストップの時計の見える時間（peek）・神経衰弱の札が見える時間（show）は、時間でもむずかしさのルールとして抽選する（各 rules で決めた）。
// 弾幕回避の残機・ウミガメの質問の数・2色爆弾と記憶リレーのライフも抽選する（2026-10-10 本人承認）。
// マルバツ・将棋の size は盤の大きさでなく遊び方（スーパー・消える・5五将棋）なので抽選する。
// ビンゴの終わり方（until。長さ）・ことわざかるたの場の札の数（field。難しさ）も抽選しない（2026-10-29 の Codex の点検。本人承認）。
// 綱引き連打の綱の重さ（weight。長さ）・ボウリングのガードレール（bumper。ハンデ）と向きの線（guide。手助け）も抽選しない。立体四目並べの重力なし（free）は遊び方なので抽選する（31回目の案。Claude の判断）。ミニゴルフのホールの数（holes。長さ）も抽選しない（2026-11-02。Claude の判断）。
const KEEP_KEYS = new Set(['players', 'peek', 'danger', 'wide', 'cpu', 'speed', 'season', 'level', 'time', 'rounds', 'hands', 'length', 'points', 'voice', 'handicap', 'window', 'hint', 'goal', 'choice', 'pits', 'deal', 'waits', 'safe', 'autopromo', 'tsumogiri', 'digits', 'shanten', 'match', 'check', 'mallet', 'stones', 'diffs', 'kind', 'tries', 'until', 'field', 'frames', 'weight', 'bumper', 'guide', 'ask', 'holes', 'gap', 'teams', 'judge', 'drops', 'lives', 'flash', 'boxes', 'every', 'onis', 'games']); // danger = あぶない所の知らせ（好み。2026-11-12 の Claude の判断）・games = シーソーにのせるの何回戦（長さ。2026-11-12 の Claude の判断）・peek = 相手の迷いを見せる（好み。2026-11-11 の Claude の判断）・every = 見えない鬼ごっこの見える間隔（難しさ）・onis = 鬼の数（人数）（2026-11-11 の Claude の判断）・drops = 羽根つきの落とせる回数（長さ）・lives = 価値観ならべのライフの数（難しさ）（2026-11-05 の Claude の判断）・gap = ビンゴの数字の間・teams = 綱引きのチームの数（2026-11-03。時間の長さと人数なので抽選しない。Claude の判断）・judge = 大喜利の審査員が選ぶ（回数が人数で決まるので抽選しない。2026-11-03 の Claude の判断）・flash = 多いのはどっちの点の見える時間（難しさ）・boxes = 多いのはどっちの箱の数（答えの数。シルエットクイズの choice と同じ）（2026-11-09 の Claude の判断）・season = 流しそうめんの季節（見た目の好み。2026-11-10 の Claude の判断）
const luckSettings = (game) => (game.settings ?? []).filter((x) => !KEEP_KEYS.has(x.key) && (x.key !== 'size' || ['tictactoe', 'shogi'].includes(game.id)));

// 盤のゲームの席の数（詳細設定で人数が決まるマルバツ・コネクトフォー・リバーシ・点と線は 2〜4、将棋・マンカラ・海戦ゲーム・五目並べ・立体四目並べ・はさみ将棋・エアホッケーは 2〜3。ほかは2）
const boardSeats = (gameId, rules) => GAMES[gameId]?.seatCount?.(rulesOf(gameId, rules)) ?? 2;

// 盤のゲームの席の書き添え。呼び名に「先手」「後手」が入っているゲーム（将棋）では重ねて書かない。3人以上は「◯番目」
const seatNote = (game, p, n = 2) => {
  if (n > 2) return `（${p + 1}番目）`;
  return game.players[p].includes(p === 0 ? '先手' : '後手') ? '' : `（${p === 0 ? '先手' : '後手'}）`;
};

// R = { gameId, seed, order, moves, rules, prev }（S でも、届いた state でもよい）
// each(前の局面, 次の局面, 手, 何番目の手)（任意）: 手を1つ当てるたびに呼ぶ（あなたの番までに起きたこと・さっきの手をもう一度）
function replay(R, each) {
  const game = GAMES[R.gameId];
  if (!game?.ready) return null;
  if (game.live) return Array.isArray(R.order) && R.order.length === boardSeats(R.gameId, R.rules) ? {} : null; // 手の一覧を使わないゲーム（局面はゲームが持つ）
  let st;
  if (game.multi) {
    if (!Array.isArray(R.order) || R.order.length < game.minPlayers || R.order.length > game.maxPlayers) return null;
    // cpus = CPU の席の番号（ウミガメのスープで CPU を出題者にするとき使う。2026-10-26）
    st = game.init(R.order.length, R.seed, { rules: rulesOf(R.gameId, R.rules), prev: R.prev ?? null, cpus: R.order.map((id, i) => (isCpu(id) ? i : -1)).filter((i) => i >= 0) });
  } else {
    if (Array.isArray(R.order) && R.order.length !== boardSeats(R.gameId, R.rules)) return null;
    st = game.init({ rules: rulesOf(R.gameId, R.rules), seed: R.seed ?? 0 }); // seed は始めの盤を種で決めるゲーム（コネクトフォーのじゃま石）が使う
  }
  for (let i = 0; i < R.moves.length; i++) {
    const before = st;
    st = game.apply(st, R.moves[i]);
    if (!st) return null;
    each?.(before, st, R.moves[i], i);
  }
  return st;
}

// オンラインで自分がこの対局の何番目のプレイヤーか。観戦なら SPECTATOR、ローカル対戦では null
function myPlayer() {
  if (S.mode !== 'online') return null;
  const i = roundOrder().indexOf(S.myId);
  return i < 0 ? SPECTATOR : i;
}

const alive = (id) => id === S.myId || Date.now() - (S.seen[id] ?? 0) < LOST_MS;
const cpuControlled = (id) => isCpu(id) || !S.members.includes(id) || !!S.away?.includes(id); // away = 対局の途中で待合室へ行った人（2026-10-26）
// 待合室で CPU を選べるか。毎フレーム動くゲーム（エアホッケー）は、liveCpu が認めたとき（3人）だけ
const cpuPickable = (game) => !game?.live || !!game.liveCpu?.(rulesOf(S.gameId, S.rules));

function seatsFilled() {
  const o = roundOrder();
  return o.length === boardSeats(S.gameId, S.rules) && o.every(Boolean);
}

function canMove(game, st, res) {
  if (res || S.full) return false;
  if (S.mode === 'local') return true;
  const me = myPlayer();
  if (me === SPECTATOR) return false;
  if (game.multi) return game.canAct(st, me);
  return seatsFilled() && game.turn(st) === me;
}

// 盤のゲームの先手・後手（3人以上は打つ順番）。ホストが選んだもの（pick）が使えなければ、先に来た人から（足りなければ CPU）。
// 人数を変えたときは、選んであった席を残して、足りない席に まだ選ばれていない人 → CPU の順で入れる
function boardPick() {
  const n = boardSeats(S.gameId, S.rules);
  // 観戦に回した人（S.bench）は、ホストがその席に選び直さない限り席に入れない（2026-11-03 本人の依頼「ホストが外すまで観戦のまま」）
  const benched = (v) => !!S.bench?.includes(v);
  const ok = (v) => (v === 'cpu' && cpuPickable(GAMES[S.gameId])) || S.members.includes(v);
  const p = S.pick;
  const people = Array.isArray(p) ? p.filter((v) => v !== 'cpu') : [];
  // 前に選んだ席に観戦に回した人がいれば外す（盤のゲームで席を選ぶ → カードのゲームで観戦に回す → 盤のゲームに戻す、で席に戻っていた。2026-11-04 Codex の点検の指摘）
  const q = Array.isArray(p) && p.every(ok) && new Set(people).size === people.length ? p.slice(0, n).filter((v) => !benched(v)) : [];
  for (const id of S.members) if (q.length < n && !q.includes(id) && !benched(id)) q.push(id);
  if (cpuPickable(GAMES[S.gameId])) while (q.length < n) q.push('cpu');
  for (const id of S.members) if (q.length < n && !q.includes(id)) q.push(id); // CPU を選べないゲームで人が足りないときだけ
  while (q.length < n) q.push('cpu');
  return q;
}

// 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13 本人の決定。room.md「UI・UX の6回目」。描くときの直し方は util.js の col）。
// ids = 席ごとの人（pick の 'cpu' でも order の 'cpu1' でもよい）→ 席ごとの色の番号。keepColor のゲームのオンラインだけ。ほかは null（席の番号のまま）。
// 前の対局（S.colorKeep。ホストが startRound で覚える）と同じゲーム・同じ席の数なら、前にいた人は前の色、CPU は前の CPU の色を席の順に、残りの席は空いた色を小さい順に。
// ゲームを替えたら覚えた色は使わない（席の順の色に戻る）。待合室を通って同じゲームを始めたときも続けて遊んでいると見て、色を引き継ぐ（Claude の判断）
function seatColorsFor(gameId, ids) {
  if (S.mode !== 'online' || !GAMES[gameId]?.keepColor || !Array.isArray(ids) || ids.length < 2) return null;
  const n = ids.length;
  const k = S.colorKeep?.game === gameId && S.colorKeep.n === n ? S.colorKeep : null;
  const ok = (c) => Number.isInteger(c) && c >= 0 && c < n;
  const out = Array(n).fill(null);
  const used = new Set();
  const cpuCols = (k?.cpu ?? []).filter(ok);
  ids.forEach((id, i) => {
    const c = isCpu(id) ? cpuCols.shift() : k?.of?.[id];
    if (ok(c) && !used.has(c)) { out[i] = c; used.add(c); }
  });
  const free = [...Array(n).keys()].filter((c) => !used.has(c));
  return out.map((c) => c ?? free.shift());
}
function keepColors(order, colors) {
  if (!colors) { S.colorKeep = null; return; }
  S.colorKeep = {
    game: S.gameId, n: order.length,
    of: Object.fromEntries(order.map((id, i) => [id, colors[i]]).filter(([id]) => !isCpu(id))),
    cpu: order.map((id, i) => (isCpu(id) ? colors[i] : null)).filter((c) => c !== null),
  };
}
// 席の色の名前（○・黒・赤 など）を色付きで。盤のゲームの状態の欄・順番の帯・ふりかえりなどで使う
const seatMark = (game, p, tag = 'b') => `<${tag} class="pl p${col(p)}">${game.players[col(p)]}</${tag}>`;

// 待合室で決まる顔ぶれ。人がゲームの上限より多ければ、あとから来た人は観戦。
// seats(rules) を持つゲーム（麻雀）は詳細設定で人数が決まり、足りない分はすべて CPU
function lineup(game) {
  const seats = game.seats?.(rulesOf(S.gameId, S.rules)) ?? null;
  // チームで分かれるゲーム（玉入れ・綱引き）はチームの数（teamCount。綱引きの三つ巴は3。2026-11-03）の倍数にそろえる。上限もその倍数に切り下げる
  const teams = game.evenTeams ? (game.teamCount?.(rulesOf(S.gameId, S.rules)) ?? 2) : 0;
  const max = seats ?? (teams ? Math.floor(game.maxPlayers / teams) * teams : game.maxPlayers);
  const pool = S.members.filter((id) => !S.bench?.includes(id)); // bench = ホストが観戦に回した人（2026-10-26）
  const humans = pool.slice(0, max);
  const watchers = [...pool.slice(max), ...S.members.filter((id) => S.bench?.includes(id))];
  if (game.noCpu) {
    // CPU を入れないゲームでも、詳細設定で決まった数だけ入ることがある（fixedCpus。ウミガメのスープの CPU の出題者。2026-10-26）
    const c = game.fixedCpus?.(rulesOf(S.gameId, S.rules)) ?? 0;
    if (!c) return { humans, watchers, cpus: 0, seats, max };
    return { humans: pool.slice(0, max - c), watchers: [...pool.slice(max - c), ...S.members.filter((id) => S.bench?.includes(id))], cpus: c, seats, max };
  }
  let cpus = seats ? seats - humans.length
    : Math.max(0, Math.min(Math.max(S.cpus, game.minPlayers - humans.length), max - humans.length));
  // チームで分かれるゲームは全員の数をチームの数の倍数にする（足りなければ CPU を足す。上限を超えるなら減らす）
  const r = teams ? (humans.length + cpus) % teams : 0;
  if (r) cpus = humans.length + cpus + (teams - r) <= max ? cpus + teams - r : Math.max(0, cpus - r);
  return { humans, watchers, cpus, seats, max, teams };
}

/* ---------- 画面 ---------- */

function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) {
    const on = s.id === 'screen-' + name;
    const enter = on && s.hidden;
    s.hidden = !on;
    if (enter) enterFx(s, ENTER_KF); // 画面の切り替え（2026-11-06）: 隠れていた画面を出すときだけ、ふわっと
  }
  window.scrollTo(0, 0);
  keepAwake(name === 'play');
  if (name !== 'play') renderNetBanner();
  resultUp = false;
  if (name === 'home') setBanner(true); // 対局の画面（待合室を含む）は render が決める
  checkLastRoom(); // さっきの部屋へ戻る（ホームのときだけ問い合わせる。ほかの画面では閉じる）
  updateSeason();
}

// 季節の飾り（2026-11-09。season.js）: ホームと待合室にだけ出す（対局の画面では止めて消す）
function updateSeason() {
  const home = !el('screen-home').hidden;
  const lobby = !el('screen-play').hidden && S?.viewKey === 'lobby';
  showSeason(home || lobby);
  updateSky(home || lobby);
}

// 時刻で変わる空気（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: ホームと待合室の上のほうを、端末の時計でうっすら色づける
// （朝 5〜10時・昼 10〜16時・夕方 16〜19時・夜 19〜5時。色は style.css の .sky-tint）。本人の指示で見本の最初の形より控えめ。
// 暗い色の組（color-scheme が dark のスキン。夜・墨と朱・星空）では出さない（本人が推奨を承認）。地の後ろに敷くので、札や欄の上には重ならない。
// 時刻の変わり目は1分ごとに見直す。Claude の判断: 動きを減らす設定の端末でも出す（色が変わるだけで動かないため。替わるときのふわっとした変化だけ止める）
let skyEl = null;
let skyOn = false;
const skyOf = (h) => (h >= 5 && h < 10 ? 'morning' : h >= 10 && h < 16 ? 'noon' : h >= 16 && h < 19 ? 'evening' : 'night');
function updateSky(on = skyOn) {
  skyOn = on;
  if (!skyEl) {
    skyEl = document.createElement('div');
    skyEl.className = 'sky-tint';
    skyEl.setAttribute('aria-hidden', 'true');
    document.body.prepend(skyEl);
  }
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
  skyEl.dataset.t = skyOf(new Date().getHours());
  skyEl.classList.toggle('on', on && !dark);
}
setInterval(() => { if (skyEl) updateSky(); }, 60000);

// 開いたときのタイトル（2026-11-09 本人の選択。出すのはその日に初めて開いたときだけ）: 「みんなの遊び場」の字を1文字ずつめくるように出し、
// 続いてホームの中身をふわっと並べる。1.5秒で終わり、どこかを押せばすぐ終わる。日付は端末に覚える（覚えられない端末では出さない）。
// 動きを減らす設定の端末と、招待リンクで部屋へ直接入ったときは出さない（ホームを通らないため）
function openingTitle() {
  if (lessMotion()) return;
  const day = new Date().toDateString();
  try {
    if (localStorage.getItem('bg-open-day') === day) return;
    localStorage.setItem('bg-open-day', day);
  } catch { return; }
  const home = el('screen-home');
  const h = home.querySelector('.home-header h1');
  const text = h.textContent;
  h.innerHTML = [...text].map((c, i) => `<span class="op-ch" style="--i:${i}">${esc(c)}</span>`).join('');
  const rest = [...home.querySelectorAll('#home-lead, .join-form, .home-tools, #game-list-title, #game-find, #game-list .tile, #game-list .cat-h')];
  rest.forEach((e, i) => { e.classList.add('op-up'); e.style.setProperty('--op', Math.min(i, 12)); });
  home.classList.add('opening');
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    home.classList.remove('opening');
    h.textContent = text;
    rest.forEach((e) => { e.classList.remove('op-up'); e.style.removeProperty('--op'); });
    document.removeEventListener('pointerdown', end, true);
  };
  document.addEventListener('pointerdown', end, true);
  setTimeout(end, 1500);
}

/* ---------- 画面を暗くしない（2026-10-07 の18回目の案）: 対局の画面（待合室も）にいる間は、スマホの画面が勝手に消えないようにする ---------- */
// ブラウザの Screen Wake Lock を使う（iPhone は iOS 16.4 から。使えない端末では何もしない）。
// ほかのタブ・アプリへ移ると自動で外れるので、戻ってきたらかけ直す。
let wakeLock = null;
let wantWake = false;
let wakeAsking = false;
async function keepAwake(on) {
  wantWake = on;
  if (!on) {
    const w = wakeLock;
    wakeLock = null;
    try { await w?.release(); } catch { /* 無視 */ }
    return;
  }
  if (wakeLock || wakeAsking || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  wakeAsking = true;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (!wantWake) { w.release().catch(() => {}); return; }
    wakeLock = w;
    w.addEventListener('release', () => { if (wakeLock === w) wakeLock = null; });
  } catch { /* 電池の節約中などで断られたら、何もしない */ } finally {
    wakeAsking = false;
  }
}
document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') keepAwake(true); });

function makeButton(text, onClick, variant = 'primary') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + variant;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- リアクション（2026-10-06 本人の決定）: 対局中にだれでも短い言葉を送り、みんなの画面に少しだけ出す ---------- */

/* CPU のひとこと（2026-10-07 の21回目の案）は 2026-10-30 本人の依頼でやめた。古い版のホストが送る type: 'cpusay' は受け取っても何もしない。 */

const REACTIONS = ['ナイス！', 'おしい！', 'えー！', 'やった！', 'まって！', 'ｗ']; // 言葉は本人が選んだ
const REACT_GAP_MS = 1200; // 1人がこれより短い間に送った分は出さない（連打で画面が埋まらないように）
const reactAt = {}; // 人の id → 最後に出した時刻

function showReaction(id, w) {
  if (!Number.isInteger(w) || !REACTIONS[w] || S?.hidden?.includes(id)) return;
  const now = Date.now();
  if (now - (reactAt[id] ?? 0) < REACT_GAP_MS) return;
  reactAt[id] = now;
  showBubble(id === S?.myId ? 'あなた' : nameOf(id), REACTIONS[w]);
}

// 画面の上に名前と言葉の吹き出しを2.6秒出す（リアクション）
function showBubble(name, text, cls = '') {
  let box = el('reactions');
  if (!box) {
    box = document.createElement('div');
    box.id = 'reactions';
    box.className = 'reactions';
    box.setAttribute('aria-live', 'polite');
    document.body.append(box);
  }
  const b = document.createElement('div');
  b.className = 'react-bubble' + (cls ? ' ' + cls : '');
  const who = document.createElement('small');
  who.textContent = name; // 名前は外から来た文字なので textContent
  const word = document.createElement('b');
  word.textContent = text;
  b.append(who, word);
  box.append(b);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => b.remove(), 2600);
}

// 対局の画面の下の段に出すリアクションのボタン（オンラインだけ。観戦の人も送れる）
function appendReactions() {
  if (S.mode !== 'online' || !S.order) return;
  const bar = document.createElement('div');
  bar.className = 'react-bar';
  REACTIONS.forEach((t, w) => {
    const b = makeButton(t, () => {
      if (Date.now() - (reactAt[S.myId] ?? 0) < REACT_GAP_MS) return;
      send({ type: 'react', w }, 0);
      showReaction(S.myId, w);
    }, 'ghost small');
    bar.append(b);
  });
  ctl().append(bar);
}

const playersText = (g) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers}人` : `${g.minPlayers}〜${g.maxPlayers}人`);

/* ---------- お気に入り（2026-10-07 本人の決定）: ホーム画面のゲームに ★ を付けると、一覧の先頭に並ぶ ---------- */
// Claude の判断: 端末ごとに覚える（localStorage の bg-favs）。「ゲームを変える」の一覧でも先頭に並べる。付けた順でなく、いつもの並びのまま先頭へ寄せる。
const FAV_KEY = 'bg-favs';
function favorites() {
  try {
    const a = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(a) ? a.filter((id) => GAMES[id]?.ready) : [];
  } catch { return []; }
}
function toggleFavorite(id) {
  const now = favorites();
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
  try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* 覚えられなくても、この画面では使える */ }
}
// お気に入りを先頭に寄せたゲームの並び
function gameOrder() {
  const favs = favorites();
  return [...GAME_ORDER.filter((id) => favs.includes(id)), ...GAME_ORDER.filter((id) => !favs.includes(id))];
}

// 部屋を作る・同じ画面で遊ぶことができる端末か。App Store 版は合言葉なしでだれでも（2026-10-17 本人の決定。外さないと審査の人が試せない）
const canHost = () => IS_APP || isOwner();

/* ---------- ゲームの文字検索（2026-10-26 本人の依頼）: ホーム画面の一覧を、名前・読み・説明で絞り込む ---------- */
// Claude の判断: カタカナはひらがなにそろえ、漢字の名前は READING の読みでも当たるようにした。種類の言葉（かーど・ばん など）も足した。
const CARD_WORDS = 'かーど とらんぷ ふだ';
const READING = {
  tictactoe: 'まるばつ ばん', connect4: 'よんもくならべ ばん', reversi: 'りばーし ばん', gomoku: 'ごもくならべ ばん', dots: 'てんとせん ばん', mancala: 'まんから ばん',
  kaisen: 'かいせんげーむ ばん', colors: 'いろあわせ ' + CARD_WORDS, daifugo: 'だいふごう だいひんみん ' + CARD_WORDS, poker: 'ぽーかー ' + CARD_WORDS, speed: 'すぴーど ' + CARD_WORDS,
  babanuki: 'ばばぬき ' + CARD_WORDS, doubt: 'だうと ' + CARD_WORDS, sevens: 'しちならべ ' + CARD_WORDS, blackjack: 'ぶらっくじゃっく ' + CARD_WORDS, hitai: 'ひたいかーど ' + CARD_WORDS,
  hitblow: 'ひっとあんどぶろー すうじ', sensou: 'せんそう わりばし ゆび てあそび', yubisuma: 'ゆびすま てあそび', tamebeam: 'ためてびーむ てあそび', memory: 'しんけいすいじゃく ' + CARD_WORDS,
  yacht: 'よっと さいころ', seri: 'せりあい ' + CARD_WORDS, nim: 'いしとりげーむ', flags: 'はたあげ', kanji: 'なんどくかんじ くいず', make10: 'てんぱずる めいくてん すうじ けいさん さんすう', targets: 'まとのはやおし まとあて', mikiri: 'みきり はやおし せつなのみきり いあい', iroji: 'いろちがいはやおし いろ はやおし', bingo: 'びんご', sugoroku: 'すごろく さいころ', taru: 'かいぞくのたる たる けん', meiro: 'めいろはやぬけ めいろ',
  heitai: 'へいのふりわけ へいたい せんじょう よみあい', oni: 'みえないおにごっこ おにごっこ おに ばん', race: 'ほうがんしれーす れーす くるま ばん',
  cup: 'こっぷのどれ こっぷ かっぷ たま しゃっふる', seesaw: 'しーそーにのせる しーそー おもり ばらんす',
  katachi: 'かたちかき かたち えかき まる さんかく しかく ほし はーと ひとふで', rhythm: 'りずむまね りずむ たいこ おと たいみんぐ',
  todofuken: 'とどうふけんたっち とどうふけん ちず にほん ちり くいず', meoshi: 'めおしそろえ めおし すろっと そろえる たいみんぐ',
  isutori: 'いすとりげーむ はやおし', cube4: 'りったいよんもくならべ ばん', kaidan: 'じゃんけんかいだん ぐりこ じゃんけん てあそび', atodashi: 'あとだしじゃんけん はやおし じゃんけん', bowling: 'ぼうりんぐ あくしょん', tsuna: 'つなひきれんだ つなひき あくしょん', eitango: 'えいたんごくいず えいご たんご すぺる いみ', kaburi: 'かぶったらぜろてん かぶり すうじ よみあい', anzan: 'ふらっしゅあんざん あんざん けいさん たしざん さんすう すうじ', golf: 'みにごるふ ごるふ ぱたーごるふ あくしょん', billiards: 'びりやーど ないんぼーる たまつき あくしょん', darts: 'だーつ まと なげる あくしょん', nawa: 'おおなわとび なわとび なわ じゃんぷ あくしょん', fukuwarai: 'ふくわらい かお おしょうがつ', oogiri: 'おおぎり おもしろ とうひょう ことば', kotoba: 'ことばさがし わーどさーち もじさがし ことば ひらがな はやおし', oxquiz: 'まるばつくいず まるばつ おーえっくす くいず ざつがく はやおし', mannaka: 'まんなかのかんじ わどうかいちん かんじ くいず じゅくご', numtouch: 'すうじたっち たっちざなんばー すうじ はやおし',
  pittari: 'ぴったりすとっぷ', kioku: 'きおくりれー', typing: 'たいぴんぐはやうち', danmaku: 'だんまくかいひ あくしょん', tamaire: 'たまいれ あくしょん', machigai: 'まちがいさがし',
  bombs: 'にしょくばくだんさばいばる あくしょん', umigame: 'うみがめのすーぷ くいず', wordwolf: 'わーどうるふ', ishin: 'いしんでんしん くいず', karuta: 'ことわざかるた はやとり', acchi: 'あっちむいてほい じゃんけん てあそび', daruma: 'だるまさんがころんだ あくしょん', slide: 'じゅうごぱずる すらいどぱずる すうじ', nanpure: 'なんぷれ なんばーぷれーす すうじ ぱずる', jinro: 'じんろう', oekaki: 'おえかきあて え', hockey: 'えあほっけー あくしょん',
  amida: 'あみだくじじんとり あみだ', narabe: 'ならべかえことば あなぐらむ もじ', kingyo: 'きんぎょすくい まつり あくしょん', tower: 'つみあげたわー ぶろっく あくしょん',
  fusen: 'ふうせんふくらまし ふうせん ばるーん どきょう',
  kage: 'しるえっとくいず かげ しるえっと えもじ はやおし くいず',
  hane: 'はねつき はごいた おしょうがつ たいみんぐ あくしょん',
  kachikan: 'かちかんならべ かちかん きょうりょく すうじ ことば いと',
  tsunagi: 'すうじつなぎはやとき なんばーりんく せん つなぐ ぱずる はやとき',
  sumo: 'かみずもう とんとんずもう すもう あくしょん',
  nearpin: 'にあぴんくいず にあぴん ちかい すうじ くいず',
  kanjiplus: 'かんじたしざん かんじ たしざん ぶしゅ くいず はやおし',
  jigsaw: 'じぐそーはやとき じぐそー ぱずる え はやとき',
  hitofude: 'ひとふでがきはやとき ひとふでがき ひとふで せん ぱずる はやとき',
  hasami: 'はさみしょうぎ ばん', shogi: 'しょうぎ ばん', mahjong: 'まーじゃん',
};
const toHira = (t) => String(t ?? '').toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
const gameHay = (id) => toHira(`${GAMES[id].name}${READING[id] ?? ''}${GAMES[id].desc ?? ''}`);
// 文字検索（2026-10-26）: 名前・読み・説明で札を絞る。当たる札の無い仲間は、見出しも仲間へ飛ぶボタンも隠す
function filterGames() {
  const q = toHira(el('game-search')?.value);
  let shown = 0;
  for (const sec of el('game-list').children) {
    let n = 0;
    for (const t of sec.querySelectorAll('.tile')) {
      const hit = !q || gameHay(t.dataset.id).includes(q);
      t.hidden = !hit;
      if (hit) n++;
    }
    sec.hidden = !n;
    const chip = el('game-cats').querySelector(`[data-cat="${sec.dataset.cat}"]`);
    if (chip) chip.hidden = !n;
    shown += n;
  }
  el('game-search-none').hidden = shown > 0 || !el('game-list').children.length;
}

/* ---------- ホームの一覧（2026-11-06 の UI・演出・アニメーションの案。本人が決めたことは room.md の「演出・アニメーション」） ---------- */
// 絵と名前だけの小さな札を、仲間（games/index.js の CATEGORIES）ごとの見出しで分けて並べる。お気に入りは一番上にまとめ、仲間の中にも残す。
// 上の帯（.home-find。検索の欄と仲間へ飛ぶボタン）は、下へ送っても画面の上に残る。札を押すと、説明と「部屋を作る」などのボタンが下から出る（openGameSheet）
function renderHome() {
  const owner = canHost();
  el('game-find').hidden = !owner;
  el('game-search').oninput = filterGames;
  el('home-lead').textContent = owner
    ? '部屋を作って、友だちに招待リンクを送れば対戦できます。'
    : '招待された部屋コードを入れて参加してください。部屋を作れるのは、このサイトの持ち主だけです。';
  el('game-list-title').hidden = !owner;
  renderOwnerBox(owner);
  const list = el('game-list');
  const cats = el('game-cats');
  list.innerHTML = '';
  cats.innerHTML = '';
  if (!owner) return;
  const favs = favorites();
  const groups = [['fav', '★ お気に入り', GAME_ORDER.filter((id) => favs.includes(id))], ...CATEGORIES.map((c) => [c.key, c.name, GAME_ORDER.filter((id) => c.ids.includes(id))])];
  for (const [key, name, ids] of groups) {
    if (!ids.length) continue;
    const sec = document.createElement('section');
    sec.className = 'game-cat';
    sec.dataset.cat = key;
    const hd = document.createElement('h3');
    hd.className = 'cat-h';
    hd.textContent = `${name}（${ids.length}）`;
    const grid = document.createElement('div');
    grid.className = 'tiles';
    for (const id of ids) grid.append(gameTile(id, favs.includes(id)));
    sec.append(hd, grid);
    list.append(sec);
    if (key === 'fav') continue; // お気に入りは一番上なので、飛ぶボタンは要らない
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-btn';
    b.dataset.cat = key;
    b.textContent = name;
    b.onclick = () => hd.scrollIntoView({ behavior: lessMotion() ? 'auto' : 'smooth', block: 'start' });
    cats.append(b);
  }
  filterGames();
}

// ホームの札（絵と名前だけ）。名前と絵はコードに書いたものなので HTML のまま入れてよい
function gameTile(id, fav) {
  const g = GAMES[id];
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'tile' + (g.ready ? '' : ' not-ready') + (fav ? ' fav' : '');
  t.dataset.id = id;
  t.innerHTML = `<span class="tile-ic" aria-hidden="true">${g.icon}</span><span class="tile-nm">${g.name}</span>`;
  if (fav) t.setAttribute('aria-label', `${g.name}（お気に入り）`);
  t.onclick = () => openGameSheet(id);
  // ホームの札が動く（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: 触る（PC は上にのせる）と、中の絵が仲間ごとに違う動きをする（動きは style.css の .tile[data-cat]）
  t.dataset.cat = categoryOf(id) ?? '';
  const wiggle = () => { const ic = t.firstElementChild; ic.classList.remove('ic-move'); void ic.offsetWidth; ic.classList.add('ic-move'); };
  t.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') wiggle(); });
  t.addEventListener('pointerdown', wiggle);
  return t;
}

// 札を押すと下から出る小窓: 絵・名前・お気に入りの ☆・説明・人数と、前の札にあったボタン（部屋を作る など）。閉じ方は名前を聞く小窓と同じ（closeInvite）
function openGameSheet(id) {
  const g = GAMES[id];
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop sheet-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', g.name);
  const box = document.createElement('div');
  box.className = 'invite-box game-sheet';
  box.innerHTML = `<div class="sheet-head"><span class="sheet-ic" aria-hidden="true">${g.icon}</span><h3>${g.name}</h3></div><p class="sheet-desc">${g.desc}</p>`;
  const tag = (text) => {
    const x = document.createElement('span');
    x.className = 'tag';
    x.textContent = text;
    box.append(x);
  };
  // 押したら小窓を閉じてから始める（部屋を作るは名前を聞く小窓に替わる）
  const go = (fn) => () => { closeInvite(); fn(); };
  if (g.ready) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'fav-btn';
    const showStar = () => {
      const on = favorites().includes(id);
      star.textContent = on ? '★' : '☆';
      star.setAttribute('aria-pressed', String(on));
      star.setAttribute('aria-label', `${g.name}を お気に入り${on ? 'から外す' : 'にする'}`);
    };
    star.onclick = () => {
      // 一番上のお気に入りの段が増え減りしても、後ろの一覧で見ていた所がずれないよう、仲間の中のこの札の位置を合わせ直す
      const anchor = () => el('game-list').querySelector(`.game-cat:not([data-cat="fav"]) .tile[data-id="${id}"]`);
      const before = anchor()?.getBoundingClientRect().top;
      toggleFavorite(id);
      renderHome();
      const after = anchor()?.getBoundingClientRect().top;
      if (before !== undefined && after !== undefined) window.scrollBy(0, after - before);
      showStar();
    };
    showStar();
    box.querySelector('.sheet-head').append(star);
    if (g.multi) tag(`${playersText(g)}・オンライン（${g.noCpu ? 'CPU なし' : '足りない分は CPU'}）`);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (g.live) {
      // 毎フレーム動くゲーム（エアホッケー）: CPU 戦・同じ画面の2人（指で触れる端末だけ）・オンライン（試作）
      // onlineOnly = オンラインだけのゲーム（紙相撲。2026-11-05 本人の決定）。CPU 戦・同じ画面のボタンを出さない
      if (!g.onlineOnly) actions.append(makeButton('CPU と対戦', go(() => startLive(id, 'cpu'))));
      if (!g.onlineOnly && navigator.maxTouchPoints > 0) actions.append(makeButton('この画面で2人で', go(() => startLive(id, 'two')), 'secondary'));
      actions.append(makeButton('部屋を作る（試作）', go(() => createRoom(id)), g.onlineOnly ? undefined : 'secondary'));
    } else {
      actions.append(makeButton('部屋を作る', go(() => createRoom(id))));
      if (!g.multi && !g.noLocal) actions.append(makeButton('この画面で2人で', go(() => startLocal(id)), 'secondary')); // noLocal = 隠す情報があるゲーム（海戦ゲーム）
    }
    box.append(actions);
  } else {
    tag('じゅんび中');
  }
  const row = document.createElement('div');
  row.className = 'invite-actions';
  row.append(makeButton('閉じる', closeInvite, 'ghost small'));
  box.append(row);
  pop.append(box);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  box.querySelector('.card-actions .btn')?.focus({ preventScroll: true });
}

// 持ち主の合言葉を入れる所。持ち主の端末では「登録を外す」だけ出す（友だちの端末で入れたときに外せるように）
function renderOwnerBox(owner) {
  const box = el('owner-box');
  box.innerHTML = '';
  if (IS_APP) return; // アプリ版には合言葉が無い
  if (owner) {
    const p = document.createElement('p');
    p.className = 'owner-note';
    p.textContent = 'この端末は持ち主として登録されています。';
    const off = makeButton('この端末の登録を外す', () => {
      if (!confirm('この端末では部屋を作れなくなります。外しますか？（合言葉を入れれば戻せます）')) return;
      forgetOwner();
      renderHome();
    }, 'ghost small');
    p.append(' ', off);
    box.append(p);
    return;
  }
  const det = document.createElement('details');
  det.className = 'owner-unlock';
  const sum = document.createElement('summary');
  sum.textContent = '持ち主の方はこちら';
  const form = document.createElement('form');
  form.className = 'join-row';
  const input = document.createElement('input');
  // パスワード欄は日本語入力が切られ、ひらがなの合言葉が入れられないので、ふつうの欄にする
  input.type = 'text';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.placeholder = '合言葉';
  input.setAttribute('aria-label', '合言葉');
  const ok = document.createElement('button');
  ok.className = 'btn primary';
  ok.type = 'submit';
  ok.textContent = '確かめる';
  form.append(input, ok);
  form.onsubmit = async (e) => {
    e.preventDefault();
    ok.disabled = true;
    let good = false;
    try { good = await unlockOwner(input.value); } catch { /* 古いブラウザなど */ }
    ok.disabled = false;
    if (!good) { toast('合言葉が違います'); input.select(); return; }
    toast('この端末を持ち主として登録しました');
    renderHome();
  };
  det.append(sum, form);
  box.append(det);
}

function renderRoomBar() {
  const bar = el('room-bar');
  if (!S || S.mode !== 'online') { bar.hidden = true; return; }
  bar.hidden = false;
  el('room-code').textContent = S.code + (S.lockPw || S.locked ? ' 🔒' : '');
  el('room-name').textContent = S.roomName ? '🏷 ' + S.roomName : '';
  el('room-name').hidden = !S.roomName;

  const others = S.members.filter((id) => id !== S.myId);
  const lost = others.filter((id) => !alive(id)).length;
  let cls = 'off';
  let text;
  if (S.conn !== 'ready') {
    text = S.conn === 'error' ? '通信できません' : '通信サーバーに接続中…';
  } else if (!S.isHost && S.hostLeft) {
    text = '部屋を作った人が出ました';
  } else if (!others.length) {
    cls = 'wait'; text = S.isHost ? '友だちを待っています' : '部屋の情報を待っています';
  } else if (lost) {
    cls = 'wait'; text = others.length === 1 ? '相手の応答がありません' : `${lost}人の応答がありません`;
  } else {
    cls = 'on'; text = others.length === 1 ? '相手と接続中' : `あなたを入れて${others.length + 1}人が接続中`;
  }
  // 通信の具合（2026-10-07 の18回目の案）: 自分の合図が中継サーバーから戻るまでの時間（遅れ）を添える。遅いときは黄色
  if (S.conn === 'ready' && S.rtt != null) {
    const stuck = netStuck();
    if ((stuck || S.rtt > SLOW_MS) && cls === 'on') { cls = 'wait'; text = '通信が遅れています'; }
    text += stuck ? '（合図が戻ってきません）' : `（遅れ ${(S.rtt / 1000).toFixed(1)}秒）`;
  }
  el('presence-dot').className = 'dot ' + cls;
  el('presence-text').textContent = text;
  renderNetBanner();
}

/* ---------- 通信の具合（2026-10-07 の18回目の案） ---------- */
// 生存確認の合図（ping）に送った時刻を入れ、自分に戻ってきたときの差を遅れ（S.rtt）にする。
// S.pingAt = まだ戻っていない合図のうち一番古いものを送った時刻（戻ったら null）。
// 一度つながったあとで切れたら、画面の一番上に帯を出す（下へスクロールしていても見えるように）。
const SLOW_MS = 1500; // 遅れがこれより長いと「遅れています」
const STUCK_MS = 12000; // 合図がこれより長く戻らないと「遅れています」（切れたと分かる前）
const netStuck = () => S.pingAt != null && Date.now() - S.pingAt > STUCK_MS;

function onSelf(msg) {
  if (msg.type === 'move' || msg.type === 'state') { sendBack(msg); return; }
  if (msg.type !== 'ping' || !Number.isFinite(msg.t)) return;
  S.rtt = Math.max(0, Date.now() - msg.t);
  S.pingAt = null;
  renderRoomBar();
}

/* ---------- 手が届いたかの印（2026-11-11 本人の選択。room.md「UI・UX の4回目」） ---------- */
// オンラインで自分が打った手（onBoardMove）を送ってから、中継サーバーから自分に戻ってくる（onSelf）までを「送っています…」とし、
// 戻ったら「✓ 届きました」を一瞬出す。待っている間は盤の最後の手の印（.last・[data-last]）を点線にする（board の .sending）。
// Claude の判断: 戻ってきた手の一覧が、送ったときの長さ以上で同じ対局なら届いたとみる（ホストが CPU の手を足して送り直したものでもよい）。
// つながっていない間は「まだ届いていません。つなぎ直しています…」。つなぎ直したときはゲストが手の一覧を送り直す（onConn）ので、それが戻れば届いたになる。
const SENT_SHOW_MS = 1200; // 「✓ 届きました」を出しておく長さ
let sentTimer = 0;
function markSending() {
  if (S.mode !== 'online') return;
  S.sendWait = { key: timerKey(), len: S.moves.length + 1 };
  S.sentAt = 0;
}
function sendBack(msg) {
  const w = S.sendWait;
  if (!w || msg.gameId !== S.gameId || msg.round !== S.round || w.key !== timerKey() || !Array.isArray(msg.moves) || msg.moves.length < w.len) return;
  S.sendWait = null;
  S.sentAt = Date.now();
  showSendMark();
}
function showSendMark() {
  const status = el('status');
  const board = el('board');
  let chip = status.querySelector('.send-chip');
  const waiting = S?.sendWait && S.sendWait.key === timerKey();
  const ok = !waiting && S?.sentAt && Date.now() - S.sentAt < SENT_SHOW_MS;
  board.classList.toggle('sending', !!waiting);
  if (!waiting && !ok) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement('div');
    chip.className = 'send-chip';
    chip.setAttribute('aria-hidden', 'true'); // 目で見る印（読み上げると打つたびにうるさい）
    status.append(chip);
  }
  chip.classList.toggle('ok', !!ok);
  chip.classList.toggle('lost', !!waiting && S.conn !== 'ready');
  chip.textContent = ok ? '✓ 届きました' : S.conn !== 'ready' ? 'まだ届いていません。つなぎ直しています…' : '送っています…';
  clearTimeout(sentTimer);
  if (ok) sentTimer = setTimeout(showSendMark, SENT_SHOW_MS - (Date.now() - S.sentAt) + 20);
}

function renderNetBanner() {
  let bar = document.getElementById('net-banner');
  const show = S?.mode === 'online' && S.everReady && S.conn !== 'ready' && !el('screen-play').hidden;
  if (!show) { if (bar) bar.hidden = true; return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'net-banner';
    bar.className = 'net-banner';
    bar.setAttribute('role', 'status');
    el('screen-play').prepend(bar); // 対局の画面の一番上（上の段を隠さず、下へスクロールしても上に貼り付く）
  }
  bar.hidden = false;
  bar.textContent = navigator.onLine === false
    ? '⚠ ネットにつながっていません。つながったら自動でつなぎ直します'
    : '⚠ 通信が切れました。つなぎ直しています…';
}
window.addEventListener('online', () => { if (S) renderRoomBar(); });
window.addEventListener('offline', () => { if (S) renderRoomBar(); });

/* ---------- 観戦の人数（2026-10-07 の19回目の案）: オンラインの対局の画面に「👀 2人が観戦中（名前）」を出す ---------- */
// 観戦の人 = 部屋にいて、この対局の顔ぶれ（order）に入っていない人（自分も含む）。いなければ出さない。
// エアホッケーは状態の欄を描かないので出ない。名前は外から来た値なので esc() を通す。
function watchHtml() {
  if (S.mode !== 'online' || !S.order) return '';
  const ids = S.members.filter((id) => !S.order.includes(id));
  if (!ids.length) return '';
  return `👀 ${ids.length}人が観戦中（${ids.map((id) => esc(id === S.myId ? 'あなた' : nameOf(id))).join('、')}）`;
}

function statusHtml(game, st, res) {
  const me = myPlayer();
  let main;
  let sub = '';
  if (game.multi) {
    const pn = (p) => `<b>${esc(p === me ? 'あなた' : nameOf(S.order[p]))}</b>`;
    if (res) {
      if (game.resultText) main = game.resultText(res, me, pn);
      else main = res.winner === me ? 'あなたの勝ち！🎉' : `${pn(res.winner)}の勝ち！`;
    } else {
      const t = game.turn(st);
      if (t === null) main = game.phaseText?.(st, me, pn) ?? '';
      else if (t === me) main = 'あなたのターン';
      else main = `${pn(t)}のターン…`;
    }
    if (me === SPECTATOR) sub = vacantSeats().length && !res ? '観戦中です（部屋を出た人の席に、下のボタンで途中から入れます）' : '観戦中です（次の対局から参加できます）';
  } else {
    const n = roundOrder().length || 2;
    const name = (p) => seatMark(game, p);
    // 部屋を出た人の席は CPU が打っているので、そう書き添える
    const who = (p) => {
      const id = roundOrder()[p];
      return esc(nameOf(id)) + (!isCpu(id) && !S.members.includes(id) ? '・CPU が代わりに' : '');
    };
    if (res) {
      if (res.winner === null) main = '引き分け！';
      else if (S.mode === 'local') main = `${name(res.winner)}の勝ち！🎉`;
      else if (me === SPECTATOR) main = `${name(res.winner)}（${who(res.winner)}）の勝ち！`;
      else if (res.winner === me) main = 'あなたの勝ち！🎉';
      else main = n > 2 ? `${name(res.winner)}（${who(res.winner)}）の勝ち…` : 'あなたの負け…';
    } else if (S.mode === 'local') {
      main = `${name(game.turn(st))}のターン`;
    } else if (!seatsFilled()) {
      main = '友だちの参加を待っています。<br>上の「招待する」で部屋のリンクを送ってください。';
    } else if (me === SPECTATOR) {
      main = `${name(game.turn(st))}（${who(game.turn(st))}）のターン`;
    } else {
      const t = game.turn(st);
      main = t === me ? 'あなたのターン' : n > 2 ? `${name(t)}（${who(t)}）のターン…` : '相手のターン…';
    }
    if (res && Number.isInteger(res.gave)) main += `<div class="gave-note">🏳 ${res.gave === me ? 'あなた' : `${name(res.gave)}（${who(res.gave)}）`}が参りました</div>`; // 参りました（2026-11-12）
    if (S.mode === 'online') {
      if (me === SPECTATOR) {
        sub = '観戦中: ' + roundOrder().map((_, p) => `${name(p)} ${who(p)}`).join(' ／ ');
      } else if (n > 2) {
        const others = roundOrder().map((_, p) => p).filter((p) => p !== me);
        sub = `あなたは ${name(me)}${seatNote(game, me, n)}・ほかは ${others.map((p) => `${name(p)} ${who(p)}`).join('、')}`;
      } else {
        sub = `あなたは ${name(me)}${seatNote(game, me)}・相手は ${who(1 - me)}`;
      }
    }
  }
  let html = `<div class="status-main">${main}</div>`;
  if (sub) html += `<div class="status-sub">${sub}</div>`;
  if (!game.multi && S.clock) html += `<div id="think" class="status-sub think">${thinkHtml(game)}</div>`;
  const extra = game.info?.(st);
  if (extra) html += `<div class="status-sub">${extra}</div>`;
  const streak = streakHtml();
  if (streak) html += `<div class="status-sub streak">${streak}</div>`;
  const watch = watchHtml();
  if (watch) html += `<div class="status-sub watch">${watch}</div>`;
  const preds = res ? predHtml(res) : '';
  if (preds) html += `<div class="status-sub pred">${preds}</div>`;
  const tally = res ? tallyHtml() || localTallyHtml(game) : '';
  if (tally) html += `<div class="status-sub tally">${tally}</div>`;
  const took = res ? timeHtml() : '';
  if (took) html += `<div class="status-sub">${took}</div>`;
  const stay = res ? stayHtml(res) : '';
  if (stay) html += `<div class="status-sub stay">${stay}</div>`;
  return html;
}

/* ---------- 盤のゲームの考えた時間（制限はしない。見せるだけ） ---------- */
// この端末で手を受け取った時刻から数える（手の一覧に時刻は入れない。apply は時刻を使わない決まりのため）。
// 端末ごとに通信の遅れの分だけずれるが、見せるだけなので合わせない。
// S.clock = { key: どの対局か, at: 最後に番が替わった時刻, len: 数え終えた手の数, turn: いまの番, res: 決着したか, log: [[打った人, かかった ms], …] }
function tickClock(game, st, res) {
  const key = S.gameId + ':' + S.round;
  const now = Date.now();
  let c = S.clock;
  if (!c || c.key !== key) c = { key, at: now, len: 0, turn: game.turn(st), res: false, log: [] };
  if (S.moves.length < c.len) { // 「1手戻す」
    c = { ...c, len: S.moves.length, log: c.log.slice(0, S.moves.length), at: now };
  }
  if (S.moves.length > c.len) {
    const log = c.log.slice();
    log.push([c.turn, now - c.at]);
    while (log.length < S.moves.length) log.push([null, 0]); // まとめて届いた手は最初の1手に時間を付ける
    c = { ...c, len: S.moves.length, log, at: now };
  }
  c.turn = res ? null : game.turn(st);
  c.res = !!res;
  if (c !== S.clock) { S.clock = c; saveRoom(); }
}

const clockText = (ms) => {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

function thinkHtml(game) {
  const c = S.clock;
  const used = Array(Math.max(2, roundOrder().length)).fill(0);
  const seat = (p) => Number.isInteger(p) && p >= 0 && p < used.length;
  for (const [p, ms] of c.log) if (seat(p)) used[p] += ms;
  const live = !c.res && seat(c.turn) ? Date.now() - c.at : 0;
  if (live) used[c.turn] += live;
  const tot = used.map((_, p) => p).map((p) => `${seatMark(game, p)} ${clockText(used[p])}`).join(' ／ ');
  if (c.res) return `考えた時間 ${tot}`;
  return `⏱ ${seatMark(game, c.turn)}が考え中 <b>${clockText(live)}</b>　合計 ${tot}`;
}

setInterval(() => {
  const box = el('think');
  if (!S?.clock || !box?.isConnected || S.clock.res) return;
  box.innerHTML = thinkHtml(GAMES[S.gameId]);
}, 500);

// 遊び方の図を作る（書き方は howto-fig.js の先頭）
function howtoFigs(figs) {
  const wrap = document.createElement('div');
  wrap.className = 'hf';
  figs.forEach((f, i) => {
    const fig = document.createElement('figure');
    fig.className = 'hf-fig';
    const grid = document.createElement('div');
    grid.className = 'hf-grid';
    for (const line of f.g.split(' / ')) {
      const row = document.createElement('div');
      row.className = 'hf-row';
      for (const tok of line.split(' ').filter(Boolean)) {
        const cell = document.createElement('span');
        let t = tok;
        if (t.startsWith('~')) { cell.className = 'hf-text'; t = t.slice(1); }
        else if (t.startsWith('[') && t.endsWith(']')) { t = t.slice(1, -1); cell.className = 'hf-card' + (/[♥♦]/.test(t) ? ' red' : ''); }
        else {
          cell.className = 'hf-cell';
          if (t.startsWith('!')) { cell.classList.add('hi'); t = t.slice(1); }
          if (/^[♠♣♥♦]/.test(t)) cell.classList.add('hf-card', ...(/[♥♦]/.test(t) ? ['red'] : []));
          if (t === '.') t = '';
        }
        cell.textContent = t;
        row.append(cell);
      }
      grid.append(row);
    }
    const cap = document.createElement('figcaption');
    cap.textContent = `${figs.length > 1 ? `${i + 1}. ` : ''}${f.c}`;
    fig.append(grid, cap);
    wrap.append(fig);
  });
  return wrap;
}

// 「？遊び方」。ゲームが変わったら中身を差し替えて閉じる。開け閉めは描き直しても保つ
let howtoFor = null;
function renderHowto(game) {
  const btn = el('btn-howto');
  const box = el('howto');
  btn.hidden = !game?.howto;
  if (!game?.howto) { box.hidden = true; howtoFor = null; return; }
  const changed = changedRules(game);
  const key = game.id + '\n' + changed.join('\n');
  if (howtoFor !== key) {
    if (howtoFor?.split('\n')[0] !== game.id) box.hidden = true; // ゲームが変わったら閉じる（ルールが変わっただけなら開いたまま）
    howtoFor = key;
    const lines = game.howto.map((t) => { const p = document.createElement('p'); p.textContent = t; return p; });
    // 図があれば図を上に出し、文は「くわしく」に畳む（2026-10-26 本人の依頼「図解を中心に・文は短く」）
    const figs = game.howtoFigs?.length ? [howtoFigs(game.howtoFigs)] : [];
    let detail = lines;
    if (figs.length) {
      const d = document.createElement('details');
      d.className = 'howto-more';
      const sum = document.createElement('summary');
      sum.textContent = 'くわしく（細かいルール・詳細設定）';
      d.append(sum, ...lines);
      detail = [d];
    }
    const rules = document.createElement('div');
    rules.className = 'howto-rules';
    const head = document.createElement('b');
    head.textContent = '📋 いまのルール';
    const body = document.createElement('span');
    body.textContent = changed.length ? `（最初と変えたもの）${changed.join('・')}` : '（詳細設定は最初のまま）';
    rules.append(head, ' ', body);
    box.replaceChildren(...figs, ...detail, ...(game.settings?.length ? [rules] : [])); // 詳細設定の無いゲームには出さない
  }
  btn.setAttribute('aria-expanded', String(!box.hidden));
}

// 下の段（ボタンと「ゲームを変える」）を作る場所。「ゲームを変える」の一覧を開いている間は、作り直さず
// 画面に出ない入れ物へ作って捨てる（作り直すと開いた一覧が閉じる。手が次々に届く難読漢字などで選べなかった）
let controlsEl = null;
const ctl = () => controlsEl;

// 描き直しの間はページの長さを今のまま保つ。作り直しの途中でページが一瞬短くなると、下へスクロールしていた
// 画面が上へ引き戻される（麻雀で牌を押すたびに起きた）
// fn で描き直したあと、data-keep="key" の物が画面の同じ高さに来るようにスクロールを足し引きする（押したボタンが逃げないように）。
// 描き直しが終わってから測るので、render の中で長さを測らない決まり（CLAUDE.md の「壊しやすい所」）には当たらない。
function keepPlace(key, fn) {
  const at = () => document.querySelector(`[data-keep="${key}"]`)?.getBoundingClientRect().top;
  const before = at();
  fn();
  const after = at();
  if (before !== undefined && after !== undefined && Math.abs(after - before) > 1) window.scrollBy(0, after - before);
}

function render() {
  if (!S) return;
  // 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13）: ゲームの描く所（util.js の col）へ、この対局の席の色を渡す
  setSeatColors(S.mode === 'online' && GAMES[S.gameId]?.keepColor && S.colors?.length === S.order?.length ? S.colors : null);
  const flyBefore = flySnap(); // 札や駒がすっと動く（2026-11-06）: 描き直す前の場所（描き直しの途中では測らない）
  const cleanFrom = cleanSnap(); // 片付けの動き（2026-11-10）: 決着した盤から次の対局へ進むなら、いまの石や駒の写しと場所
  const body = document.body;
  body.style.minHeight = document.documentElement.scrollHeight + 'px';
  // 横に送れる名前の札（party.js の scoreChips の steady）は作り直されるので、送った位置を描き直しの前に覚えて後で戻す（並んでいる順で対応させる）
  const chipsX = [...document.querySelectorAll('.cc-steady')].map((x) => x.scrollLeft);
  S.myTurnNow = false;
  try { renderPage(); } finally {
    body.style.minHeight = '';
    setTurnTitle(S?.myTurnNow);
    if (chipsX.some((x) => x > 0)) document.querySelectorAll('.cc-steady').forEach((x, i) => { if (chipsX[i]) x.scrollLeft = chipsX[i]; });
  }
  // 画面の切り替え（2026-11-06）: 待合室と対局が入れ替わったとき・次の対局が始まったときに、状態の欄・盤・下の段をふわっと出す
  if (!S) return;
  const view = S.mode === 'online' && (!S.order || (S.lobbyView && !S.isHost)) ? 'lobby' : 'game:' + timerKey();
  if (S.viewKey && S.viewKey !== view) enterFx([el('status'), el('board'), el('controls')], FADE_KF);
  if (cleanFrom && cleanFrom.next === view) cleanPlay(cleanFrom);
  S.viewKey = view;
  updateSeason();
  // 札や駒がすっと動く（2026-11-06）: 新しく届いた手で描き直したら前の場所から動かし、対局の始めは札を配る。
  // それ以外の描き直しでは、動いている途中の物を続きから動かす
  const deal = flyDealNow;
  flyDealNow = false;
  if (flyBefore || deal) flyPlay(flyBefore ?? new Map(), deal);
  else if (flights.size) flyResume();
}

/* ---------- 番が来たらタブの名前で知らせる（2026-10-07。10回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// オンラインで自分の番のあいだ、タブの名前の頭に「● あなたのターン」を付ける（ほかのタブを見ていても気づけるように）。
// Claude の判断: 番が決まるゲームだけ（全員が同時に動く realtime のゲームと、番の決まらない場面（turn が null）では付けない。「番が来た」音と同じ考え方）。
const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';
const TURN_TITLE = '● あなたのターン - ';
function setTurnTitle(on) {
  const want = on ? TURN_TITLE + BASE_TITLE : BASE_TITLE;
  if (document.title !== want) document.title = want;
}
const myTurnNow = (game, st, res) => S.mode === 'online' && !game.realtime && canMove(game, st, res) && (!game.multi || game.turn(st) === myPlayer());

/* ---------- 人数の詳細設定を部屋の人数に合わせる（2026-10-26 本人の依頼） ---------- */
// 詳細設定「人数」（key players）を持つゲームで、待合室にいる間、部屋の人数（観戦を含む）に合う一番多い人数を選んでおく。
// 合う人数が無い（麻雀で2人など）ときは最初の値。ホストがこの部屋でそのゲームの人数を自分で選んだら、もう合わせない（S.playersSet。送らない）。
// Claude の判断: 合わせた値は「詳細設定を覚える」に入れない（次の部屋は、そのときの人数でまた合わせるため）。
function autoPlayers() {
  const x = GAMES[S.gameId]?.settings?.find((s) => s.key === 'players' && s.choices);
  if (!x || S.playersSet?.[S.gameId]) return;
  const n = S.members.length;
  const fit = x.choices.map(([c]) => c).filter((c) => c <= n);
  const want = n >= 2 && fit.length ? Math.max(...fit) : x.def;
  const cur = rulesOf(S.gameId, S.rules);
  if (cur.players === want) return;
  S.rules = { ...S.rules, [S.gameId]: { ...cur, players: want } };
  saveRoom();
  sendState();
}

function renderPage() {
  if (S.mode === 'online') noteMembers(); // 人が入ったら札が飛び込む（memberFx）
  if (S.mode === 'online' && S.isHost && !S.order) autoPlayers();
  resultUp = false;
  setBanner(false); // 待合室だけ下で出し直す（出し入れは ads.js がまとめるので、続けて呼んでもちらつかない）
  const focused = document.activeElement;
  const keepControls = focused?.tagName === 'SELECT' && el('controls').contains(focused);
  controlsEl = keepControls ? document.createElement('div') : el('controls');
  renderRoomBar();
  const game = S.gameId ? GAMES[S.gameId] : null;
  el('play-title').textContent = game ? game.name : '部屋に参加';
  renderHowto(game);
  el('screen-play').dataset.game = S.gameId ?? '';
  const status = el('status');
  const board = el('board');
  const controls = ctl();
  controls.innerHTML = '';

  let waiting = null;
  if (S.mode === 'online') {
    if (S.full) waiting = `この部屋は満員です（${MAX_MEMBERS}人まで）。`;
    else if (S.lockWait) waiting = '🔒 この部屋には鍵がかかっています。<br>部屋を作った人に聞いたパスワードを入れてください。';
    else if (S.conn === 'error') waiting = '通信サーバーにつながりませんでした。ネットにつながっているか確かめて、ページを読み込み直してください。';
    else if (!game && S.conn !== 'ready') waiting = '通信サーバーにつないでいます…';
    else if (!game) waiting = '部屋の情報を待っています…<br>しばらく待っても変わらないときは、部屋コードが合っているか確かめてください。';
  }
  if (!waiting && game?.live && (S.mode === 'local' || S.order)) { renderLive(game); return; }
  stopLive();
  if (!waiting && S.mode === 'online' && !S.order) {
    if (game.multi) renderLobby(game); else renderBoardLobby(game);
    if (restable()) ctl().append(restButton());
    appendMemberPanel();
    setBanner(true);
    return;
  }
  const st = waiting ? null : replay(S);
  if (!waiting && !st) waiting = '対局のデータを読み直しています…';
  if (waiting) {
    // つながるまでの待ち画面（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: つないでいる間と部屋の情報を待つ間は、
    // これから遊ぶゲームの絵（まだ分からなければ 🎲）を上で跳ねさせる。満員・つながらなかったときは出さない
    const hop = S.mode === 'online' && !S.full && S.conn !== 'error' && !game && !lessMotion()
      ? `<div class="wait-hop" aria-hidden="true"><span class="wh-ic">${GAMES[S.gameId]?.icon ?? '🎲'}</span><span class="wh-sh"></span></div>` : '';
    status.innerHTML = `${hop}<div class="status-main small">${waiting}</div>`;
    board.innerHTML = '';
    board.className = 'board';
    return;
  }
  if (S.lobbyView && S.mode === 'online' && !S.isHost) { renderAwayLobby(game, st); return; }

  const res = game.result(st);
  S.myTurnNow = myTurnNow(game, st, res);
  if (!game.multi) tickClock(game, st, res);
  trackTime(res);
  greetStart(res, game);
  if (res) countResult(res, st, game);
  if (res) countLocal(game, res);
  if (res) countFinished(`${S.code ?? 'local'}:${resultKey()}`);
  noteAchievements(game, res, st);
  resultUp = !!res;
  status.innerHTML = statusHtml(game, st, res);
  const band = turnBand(game, st, res);
  if (band) status.prepend(band);
  if (res && !game.multi && renderReview(game, st)) return; // ふりかえりで途中の局面を見ている
  if (!game.multi && !(res && S.review?.key === reviewKey())) { const jb = judgeBar(game, st); if (jb) status.append(jb); } // 形勢の帯（2026-11-12）
  if (res && !game.multi && S.review?.key === reviewKey()) { const ch = judgeChart(game, S.moves.length); if (ch) status.append(ch); } // ふりかえりを最後まで見たとき
  if (res) appendScenes(game, st, res, status); // 結果に名場面（2026-11-12）

  // 新しく打たれた手だけ動きを付ける（接続表示の更新などで描き直したときは動かさない）
  const key = S.gameId + ':' + S.round;
  const prevLen = S.shownKey === key ? S.shownLen : null;
  const fresh = prevLen !== null && S.moves.length > prevLen;
  if (S.shownKey !== key && !S.moves.length && game.startSound) play(game.startSound);
  if (S.shownKey !== key && !S.moves.length && !lessMotion()) flyDealNow = true; // 対局の始めに札を配る（2026-11-06。flyPlay）
  S.shownKey = key;
  S.shownLen = S.moves.length;
  const opts = { canMove: canMove(game, st, res), onMove: onBoardMove, fresh, me: watchSeat(game), view: boardView(game) };
  if (!game.multi) Object.assign(opts, { peek: opts.canMove ? sendPeek : null, peekIn: peekInNow() }); // 相手の迷いが見える（2026-11-11）
  if (!game.multi) opts.rules = rulesOf(S.gameId, S.rules); // あぶない所の知らせ（2026-11-12）など、描くときに詳細設定を見るゲームのため
  const slow = fresh && res && slowWanted(game, prevLen); // 決め手のスロー（2026-11-10）: 線を引くのを盤を描く前に遅らせておく
  if (slow) lineHold.until = Date.now() + SLOW_LINE - 160; // winLine はこの時刻からいつもの 160ms 待って引く
  if (game.multi) {
    Object.assign(opts, {
      names: S.order.map(nameOf),
      cpu: S.order.map(cpuControlled),
      sub: S.order.map((id) => !isCpu(id) && cpuControlled(id)), // 部屋を出た人の席を CPU が代わりに打っている
      away: S.order.map((id) => !isCpu(id) && S.members.includes(id) && !alive(id)),
      hidden: S.order.map((id) => !!S.hidden?.includes(id)), // 「この人を隠す」を押した人の席（その人の言葉と絵を出さない）
      watching: myPlayer() === SPECTATOR && opts.me !== SPECTATOR, // 観戦の人がほかの人の画面を見ている（me はその人の番号）
      // 見た目だけの中身（ほかの人の位置など）を送りっぱなしにする。届いた側ではゲームの onStream が受け取る
      stream: (d) => { if (S.mode === 'online') send({ type: 'stream', gameId: S.gameId, round: S.round, d }, 0); },
    });
  }
  game.render(board, st, opts);
  if (game.multi) delete board.dataset.seats; else board.dataset.seats = boardSeats(S.gameId, S.rules); // 色に形を添える（2026-11-11。3〜4人の盤だけ）
  drawGhosts(game, st, board); // 2回押して置く・相手の迷い（2026-11-11）
  if (tapGhost && tapGhost.k === ghostKey() && twoTapOn(game) && opts.canMove) status.insertAdjacentHTML('beforeend', '<div class="status-sub tap-hint">👆 同じ所をもう一度押すと置きます</div>');
  lineHold.until = 0;
  const hold = slow ? slowFinish(board) : 0;
  if (hold) status.querySelector('.scenes:not(.still)')?.style.setProperty('--hold', hold + 'ms'); // 名場面は判子のあと（決め手のスローでは判子が遅れるので、その分待つ。2026-11-12 の Codex の点検）
  rollNums(status); // 点の数字が回る（2026-11-10）
  rollNums(board);
  if (beginner && opts.canMove && BEG_GAMES.has(S.gameId) && [...board.querySelectorAll('.playable, .usable, button')].some((e) => getComputedStyle(e).getPropertyValue('--beg').trim() === '1')) {
    status.insertAdjacentHTML('beforeend', '<div class="status-sub beg-hint">🔰 光っている所が、いま選べる所です</div>');
  }
  if (fresh) moveSound(game, st, res, prevLen, opts.canMove, hold);
  if (!opts.canMove && S.couldMove !== false) S.waitFrom = Date.now();
  S.couldMove = opts.canMove;

  if (res) {
    if (!game.multi) appendReview(game);
    if (S.mode === 'online' && againNeed().length) appendAgain();
    else controls.append(makeButton('もう一回', () => afterAd(rematch)));
    appendShare();
    if (restable()) controls.append(restButton());
    if (S.mode === 'online' && S.isHost) controls.append(makeButton('🏠 みんなで待合室へ', () => afterAd(() => newRound(S.gameId, { lobby: true })), 'secondary'));
  } else if (S.mode === 'local' && S.moves.length) {
    controls.append(
      makeButton('1手戻す', () => { S.moves.pop(); render(); }, 'secondary'),
      makeButton('最初から', () => { if (confirm('最初からやり直しますか？')) rematch(); }, 'secondary'),
    );
  } else if (S.mode === 'online' && !game.multi) {
    appendUndo(game);
    appendGiveUp(game, opts.canMove); // 参りました（2026-11-12）
  }
  if (!res && S.gameId === 'oekaki' && st.phase === 'show') appendShare(); // お絵描き当ての答えの場面（描き終わった絵が出ている）
  appendSit(game, res);
  appendFlip(game);
  appendReplayLast(game, res);
  appendPredict(game, res);
  appendReactions();
  appendWatchSelect(game);
  controls.append(makeButton('👓 見やすさ', openView, 'ghost small')); // 見やすさ（2026-11-11）
  if (S.mode === 'online' && !S.isHost) controls.append(makeButton('🏠 待合室へ', () => goAwayLobby(game, st, res), 'ghost small'));
  if (S.mode === 'online' && S.isHost && !res) controls.append(lobbyAllButton());
  if (S.mode === 'online' && S.isHost) controls.append(gameSelect());
  appendMemberPanel();
  showSendMark(); // 手が届いたかの印（2026-11-11）
  scheduleCpu(game, st, res);
  scheduleReferee(game, st, res);
  if (res) checkAgain();
}

/* ---------- 順番の帯（2026-10-26 本人の依頼。本人が絵で示した形）: 番のあるゲームで、対局の画面の上に席を順に並べ、いまの番の人を目立たせる ---------- */
// Claude の判断: 番が決まらない場面（全員が同時に動く・turn が null）と決着のあとは出さない。席の印はゲームの players（○・× など）。
// 色の名前（黒・白・赤…）は色の丸にする。カードゲームは印が無いので席の番号。CPU は名前に 🤖 が付く（nameOf）。逆回り（いろあわせの dir）なら矢印も逆。
const COLOR_DOT = { 黒: '⚫', 白: '⚪', 赤: '🔴', 黄: '🟡', 緑: '🟢', 紫: '🟣', 青: '🔵' };
// 2026-11-10 から、決着のあとも勝った人がいれば帯を出し、勝った人の札に王冠を落とす（下の「前の対局の勝者に王冠」。いまの番の印と「…」は出さない）
function turnBand(game, st, res) {
  if (game.realtime || !game.turn) return null;
  const t = res ? -1 : game.turn(st);
  if (!res && (!Number.isInteger(t) || t < 0)) return null;
  const n = S.mode === 'online' ? S.order?.length ?? 0 : game.multi ? 0 : boardSeats(S.gameId, S.rules);
  if (n < 2 || t >= n) return null;
  const crowned = res ? new Set(winnersOf(res).filter((p) => p < n)) : null;
  if (crowned && !crowned.size) return null; // 引き分けは今までどおり出さない
  const me = myPlayer();
  const said = res ? null : saidBySeat(game, n);
  // あと一歩の人に印（2026-11-13 本人の選択。room.md「UI・UX の6回目」）: ゲームの reach(局面) → 席ごとの短い言葉（「あと1枚」）| null。
  // いまは大富豪・ダウト・七並べ（Claude の判断。いろあわせは「最後の1枚の宣言」の駆け引きを壊すので付けない）。印が付いたばかりの札は印を落として揺らす（動きを減らす設定の端末では揺らさない）
  const reach = res ? null : game.reach?.(st) ?? null;
  const band = document.createElement('div');
  band.className = 'turn-band' + (said ? ' has-said' : '') + (!game.multi && n >= 3 ? ' seats34' : ''); // seats34: 色に形を添える（2026-11-11）
  const back = st?.dir === -1;
  const seats = [...Array(n).keys()];
  if (back) seats.reverse();
  seats.forEach((i, k) => {
    if (k) {
      const arrow = document.createElement('span');
      arrow.className = 'turn-arrow';
      arrow.textContent = '＞';
      band.append(arrow);
    }
    const card = document.createElement('div');
    card.className = 'turn-card' + (i === t ? ' now' : '') + (i === me ? ' mine' : '');
    const label = !game.multi ? game.players?.[col(i)] : null; // 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13）
    const mark = document.createElement('span');
    mark.className = 'turn-mark';
    // 印は色の丸か短い記号（○・× など）。「先手」のような言葉は席の番号にし、同じ画面の対局では名前の所に言葉を出す
    const sym = label ? COLOR_DOT[label] ?? ([...label].length <= 1 ? label : null) : null;
    mark.textContent = sym ?? String(i + 1);
    if (sym && COLOR_DOT[label]) mark.dataset.p = col(i); // 色に形を添える（2026-11-11）: 色の丸に ● ▲ ■ ◆ を添える（style.css の .shapes）
    const who = document.createElement('span');
    who.className = 'turn-name';
    who.textContent = S.mode === 'online' ? (i === me ? 'あなた' : nameOf(S.order[i])) : label && label !== sym ? label : `${i + 1}番`;
    card.append(mark, who);
    // 考え中の「…」（2026-11-06 の UI・演出・アニメーションの案）: オンラインで、いまの番が自分のほかの人（CPU も）なら、その札の下で「…」を動かす。
    // 札の大きさを変えないよう、札の下の縁に重ねる（.turn-dots は position: absolute）。動きを減らす設定の端末では出さない
    if (i === t && i !== me && S.mode === 'online' && !lessMotion()) {
      const dots = document.createElement('span');
      dots.className = 'turn-dots';
      dots.setAttribute('aria-hidden', 'true'); // 状態の欄に「○○のターン…」と出ている
      dots.innerHTML = '<i></i><i></i><i></i>';
      card.append(dots);
    }
    if (said?.[i]) {
      const b = document.createElement('span');
      b.className = 'turn-said';
      b.textContent = said[i];
      card.append(b);
    }
    if (typeof reach?.[i] === 'string') addReach(card, i, reach[i]);
    if (S.mode === 'online') addFlame(card, S.order[i]);
    if (crowned?.has(i)) addCrown(card);
    band.append(card);
  });
  if (S.mode === 'online') flameSeen = { key: S.streak?.key ?? null, n: { ...(S.streak?.wins ?? {}) } };
  return band;
}

const reachSeen = { key: '', on: new Set() }; // 前に描いたとき印が付いていた席（付いたばかりの札だけ揺らすため）
function addReach(card, i, text) {
  const key = `${S.gameId}:${S.round}:${S.seed}`;
  if (reachSeen.key !== key) Object.assign(reachSeen, { key, on: new Set() });
  const b = document.createElement('span');
  b.className = 'turn-reach' + (reachSeen.on.has(i) || lessMotion() ? '' : ' new');
  b.textContent = text;
  card.classList.add('reach');
  card.append(b);
  reachSeen.on.add(i);
}

// あなたの番までに起きたこと（2026-11-11 本人の選択。room.md「UI・UX の4回目」）: 自分が最後に打った手より後に、ほかの人がした手を、
// その人の順番の帯の札の下に短い吹き出しで残す（1人1つ。同じ人が何回か打ったら最後の手）。言葉はゲームの said(前の局面, 次の局面, 手)。
// Claude の判断: オンラインのカードゲームで、自分の席があるとき（観戦の人は、見ている人の席から数える）。まだ1回も打っていなければ対局の始めから。
// 進行役の手（p = -1）と自分の手には出さない。長い言葉は CSS で切る。
function saidBySeat(game, n) {
  if (!game.said || S.mode !== 'online' || !game.multi) return null;
  const me = watchSeat(game);
  if (!Number.isInteger(me) || me < 0) return null;
  let from = -1;
  for (let i = S.moves.length - 1; i >= 0; i--) if (S.moves[i]?.p === me) { from = i; break; }
  const out = {};
  let any = false;
  replay(S, (a, b, m, i) => {
    if (i <= from || !Number.isInteger(m?.p) || m.p < 0 || m.p >= n || m.p === me) return;
    const t = game.said(a, b, m);
    if (t) { out[m.p] = t; any = true; }
  });
  return any ? out : null;
}

// 連勝の炎（2026-11-09 本人の選択。room.md「演出・アニメーションの2回目」）: 2連勝以上の人の順番の帯の札に 🔥 と連勝の数を出し、増えるほど炎を大きくする。
// 連勝は決着のとき（順番の帯が消えているとき）に変わるので、前に帯を描いたときの数（flameSeen）と比べて、次に帯を出したときに
// 増えていれば炎をふくらませ、止まっていれば（2以上 → 2未満）煙を1回出す。顔ぶれやゲームが変わった（連勝の鍵が変わった）ときは比べない（Claude の判断）。
// 順番の帯の無いゲーム（全員が同時に動く早押しなど）には出ない（状態の欄の「🔥 ○○ 3連勝中」は今までどおり）
let flameSeen = { key: null, n: {} };
// 前の対局の勝者に王冠（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: 決着したら、勝った人の順番の帯の札の角に 👑 を落とし、
// 次の対局が始まるまで（結果の画面の間）残す。連勝の炎と両方出す（本人が推奨を承認）。落ちる動きは決着ごとに1回で、描き直しても続きから（落ち始めた時刻を覚える）。
// Claude の判断: 決め手のスロー（slowFinish）の間は落とさず、判子と同じころに落とす
let crownAt = { key: null, t: 0 };
function addCrown(card) {
  const key = `${timerKey()}:${S.moves.length}`;
  if (crownAt.key !== key) crownAt = { key, t: Date.now() };
  const c = document.createElement('span');
  c.className = 'turn-crown';
  c.setAttribute('aria-hidden', 'true'); // 勝った人は状態の欄に出ている
  c.textContent = '👑';
  c.style.animationDelay = `${crownAt.t - Date.now()}ms`;
  card.classList.add('won');
  card.append(c);
}
function addFlame(card, id) {
  const st = S.streak;
  if (!st || st.key !== streakKey() || !id) return;
  const n = st.wins?.[id];
  const was = flameSeen.key === st.key ? flameSeen.n[id] ?? 0 : n;
  if (Number.isInteger(n) && n >= 2) {
    const f = document.createElement('span');
    f.className = 'turn-flame' + (n > was ? ' grow' : '');
    f.setAttribute('aria-hidden', 'true'); // 状態の欄に「🔥 ○○ 3連勝中」と出ている
    f.style.setProperty('--fs', Math.min(2, 1 + (n - 2) * 0.2) + 'rem');
    f.innerHTML = `<span class="tf-f">🔥</span><span class="tf-n">${n}</span>`;
    card.append(f);
  } else if (was >= 2) {
    const s = document.createElement('span');
    s.className = 'turn-smoke';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '💨';
    card.append(s);
  }
}

/* ---------- 観戦の人が、だれの手元を見るか選ぶ（2026-10-26 本人の依頼） ---------- */
// 手札や自分だけの盤があるゲーム（カードゲーム（multi）と、隠す情報のある盤のゲーム（noLocal。海戦ゲーム））で、観戦の人だけに出す。
// 選んだ人の席の番号をゲームの me に渡す（canMove は myPlayer で見るので、見るだけで打てない）。選びは人の id で覚え、この端末だけ（送らない・保存しない）。
const watchable = (game) => S.mode === 'online' && (game.multi || game.noLocal) && !game.live;
function watchSeat(game) {
  const me = myPlayer();
  if (me !== SPECTATOR || !watchable(game) || !S.watchId) return me;
  const i = S.order?.indexOf(S.watchId) ?? -1;
  return i >= 0 ? i : me;
}
function appendWatchSelect(game) {
  if (!watchable(game) || myPlayer() !== SPECTATOR || !S.order) return;
  const label = document.createElement('label');
  label.className = 'game-select';
  label.textContent = '👀 見る画面 ';
  const sel = document.createElement('select');
  sel.append(new Option('みんなの画面（手札は見えない）', ''));
  S.order.forEach((id) => { if (!isCpu(id) || game.multi) sel.append(new Option(`${nameOf(id)} の画面`, id)); });
  sel.value = S.order.includes(S.watchId) ? S.watchId : '';
  sel.onblur = () => render();
  sel.onchange = () => { S.watchId = sel.value || null; sel.onblur = null; sel.blur(); render(); };
  label.append(sel);
  ctl().append(label);
}

/* ---------- 対局から待合室へ（2026-10-26 本人の依頼） ---------- */
// ゲスト（ホスト以外）が対局の画面の「🏠 待合室へ」を押すと、その人の画面だけ待合室の形（成績・対局の履歴・名前の変更・ランキング・次のゲームの投票）になる。
// 対局している人なら、そのあいだ席は CPU が代わりに打つ（type: 'away' をホストが S.away に集めて state で送る。cpuControlled が見る）。「対局の画面に戻る」で戻る。
// Claude の判断: ホストは CPU の手を考える端末なので、自分だけ待合室へ行く形は出さない（代わりに下の「🏠 みんなで待合室へ」で全員を戻す）。
// 2026-10-30 本人の依頼: ホストは対局の途中でも「🏠 みんなで待合室へ」で全員を待合室へ戻せる（自分だけ見に行く形との選択で、推奨を本人が承認）。
// 確かめてから、ゲームを変えるときと同じ newRound(lobby) で戻す。途中の対局は決着していないので成績表・履歴に数えない（countResult は決着のときだけ）。
// エアホッケーは決着が main.js から見えないので、いつも出す（確かめの文はどちらでも通じる形にした）。決着のあとは、広告を挟む前からのボタン（render の res の段）を使う。
function lobbyAllButton() {
  return makeButton('🏠 みんなで待合室へ', () => {
    if (!confirm('みんなで待合室へ戻りますか？（途中の対局は成績に数えません）')) return;
    newRound(S.gameId, { lobby: true });
  }, 'ghost small');
}
function goAwayLobby(game, st, res) {
  const seated = S.order?.includes(S.myId);
  if (seated && !res && !confirm('待合室へ行くと、そのあいだ あなたの席は CPU が代わりに打ちます。行きますか？')) return;
  S.lobbyView = true;
  if (seated && !res) send({ type: 'away', on: true, round: S.round });
  window.scrollTo(0, 0);
  render();
}
function backFromLobby() {
  S.lobbyView = false;
  if (S.away?.includes(S.myId)) send({ type: 'away', on: false, round: S.round });
  render();
}
function renderAwayLobby(game, st) {
  const status = el('status');
  const board = el('board');
  const res = game.result(st);
  status.innerHTML = `<div class="status-main">待合室</div><div class="status-sub">${res ? '対局は終わりました。' : `いまは ${esc(game.name)} の対局が続いています。`}</div>`;
  board.className = 'board lobby';
  board.innerHTML = '';
  const tally = tallyLine();
  if (tally) board.append(tally);
  const hist = historyLine();
  if (hist) board.append(hist);
  board.append(meTools());
  const v = votePanel();
  if (v) board.append(v);
  const controls = ctl();
  controls.append(makeButton('▶ 対局の画面に戻る', backFromLobby));
  appendMemberPanel();
}

// 待合室の「自分のこと」の段: 名前を変える・自分の記録（ランキング）
function meTools() {
  const row = document.createElement('div');
  row.className = 'lobby-me';
  row.append(renameButton(), makeButton('🏆 自分の成績', openRanking, 'secondary small'));
  return row;
}

// 観戦に回す（2026-10-26 本人の依頼）: カードなど人数の決まらないゲームの待合室で、ホストが部屋の人を対局から外して観戦にする（S.bench。state で送る）。
// 盤のゲームは前から席ごとに人を選べるので出さない。外した人は lineup が観戦に入れる。部屋を出た人の分は残っていても数えない。
function benchPanel(game) {
  const det = document.createElement('details');
  det.className = 'lobby-rules';
  det.open = !!S.benchOpen;
  det.ontoggle = () => { S.benchOpen = det.open; };
  det.innerHTML = '<summary>👀 観戦に回す人を選ぶ</summary>';
  for (const id of S.members) {
    const on = !!S.bench?.includes(id);
    const label = document.createElement('label');
    label.className = 'rule-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = on;
    input.onchange = () => {
      S.bench = input.checked ? [...new Set([...(S.bench ?? []), id])] : (S.bench ?? []).filter((x) => x !== id);
      saveRoom();
      sendState();
      render();
    };
    const text = document.createElement('span');
    text.textContent = `${id === S.myId ? 'あなた' : nameOf(id)} は観戦する`;
    label.append(input, text);
    det.append(label);
  }
  return det;
}

// 名前を変える（待合室）。名前を聞く小窓で入れ直し、ゲストは hello で、ホストは自分で直して全員へ送る
function renameButton() {
  return makeButton('✏️ 名前を変える', () => askName('変える', () => {
    if (!S) return;
    if (S.isHost) { S.names = { ...S.names, [S.myId]: myName() || S.names[S.myId] }; saveRoom(); sendState(); } else askState();
    toast('名前を変えました');
    render();
  }), 'secondary small');
}

/* ---------- もう一回は全員の OK で（2026-10-26 本人の依頼） ---------- */
// 決着のあと、対局していた人（部屋にいる人。CPU はいつも OK）が「✅ もう一回」を押す。全員そろえばすぐ次の対局、だれかが「🏠 待合室へ」を選ぶか
// AGAIN_MS（20秒。推奨を本人が承認）たってもそろわなければ、全員で待合室へ。数えるのはホストの端末（S.again = { round, ids }。state で送る）。
// 残りの秒数は各端末が結果を見たときから数える（端末ごとに少しずれる）。決めるのはホストの時計。
// Claude の判断: 対局していた人が1人もいない（CPU どうしを観戦していた）ときは、今までどおりの「もう一回」ボタン。
const AGAIN_MS = 20000;
const againNeed = () => (S.order ?? []).filter((id) => !isCpu(id) && S.members.includes(id));
const againIds = () => (S.again?.round === S.round ? S.again.ids : []);
// 結果の画面でルールを変えた回数（v）。ホストが変えるたびに OK を空にして1つ進め、20秒も数え直す（下の「結果の画面でルールを変えてもう一回」）
const againVer = () => (S.again?.round === S.round && Number.isInteger(S.again.v) ? S.again.v : 0);
// 結果の画面で変えた次の対局のルール（変えた鍵だけ。CPU の強さの自動合わせなど、ほかで変わった鍵を古い値で上書きしないように）。変えていなければ null。
// S.rules に直に入れないこと: replay は S.rules でいま終わった対局を当て直すので、盤の大きさや回数を変えると終わった対局が作り直せなくなる（2026-11-13 Codex の点検）。
// newRound が、前の対局の当て直しを終えてから S.rules へ移す
const againRules = () => (S.again?.round === S.round && S.again.rules && typeof S.again.rules === 'object' ? S.again.rules : null);
const nextRulesOf = () => ({ ...rulesOf(S.gameId, S.rules), ...againRules() });
const againWith = (ids, v = againVer(), rules = againRules()) => ({ round: S.round, ids, v, ...(rules ? { rules } : {}) });
function sayAgain(ok) {
  if (S.isHost) onAgain(S.myId, ok, S.round, againVer());
  else { send({ type: 'again', ok, round: S.round, v: againVer() }); if (ok) { S.again = againWith([...againIds(), S.myId]); render(); } }
}
// v = OK を押した画面で見えていたルールの版。ホストがルールを変えたあとに届いた、変える前の OK は数えない（押し直してもらう）
function onAgain(id, ok, round, v) {
  if (!S.isHost || round !== S.round || !againNeed().includes(id)) return;
  if (ok && Number.isInteger(v) && v !== againVer()) return;
  if (!ok) {
    toast(`${id === S.myId ? 'あなた' : nameOf(id)}が待合室を選んだので、みんなで待合室へ戻ります`);
    newRound(S.gameId, { lobby: true });
    return;
  }
  if (!againIds().includes(id)) S.again = againWith([...againIds(), id]);
  saveRoom();
  sendState();
  checkAgain();
  render();
}
// ホストだけ。全員そろったらすぐ次、時間切れなら待合室（render のたびと、時間切れのときに見る）
function checkAgain() {
  if (!S?.isHost || S.mode !== 'online' || !S.order) return;
  const game = GAMES[S.gameId];
  const st = replay(S);
  if (!st || !game.result(st) || game.live) return;
  const need = againNeed();
  if (!need.length) return;
  const rk = resultKey();
  const key = rk + '#' + againVer(); // ルールを変えたら20秒を数え直す
  if (S.againKey !== key) {
    S.againKey = key;
    S.againStart = Date.now();
    clearTimeout(S.againTimer);
    const session = S;
    S.againTimer = setTimeout(() => { if (S === session) checkAgain(); }, AGAIN_MS + 50);
  }
  const ids = againIds();
  if (need.every((id) => ids.includes(id))) { setTimeout(() => { if (S?.againKey === key && resultKey() === rk) newRound(S.gameId); }, 0); return; }
  if (Date.now() - S.againStart >= AGAIN_MS) {
    setTimeout(() => {
      if (S?.againKey !== key || resultKey() !== rk) return;
      toast('全員の OK がそろわなかったので、待合室へ戻りました');
      newRound(S.gameId, { lobby: true });
    }, 0);
  }
}
let againTick = null;
// 結果の画面でルールを変えてもう一回（2026-11-13 本人の選択。room.md「UI・UX の6回目」）: OK の欄の下に、そのゲームのよく変える詳細設定を3つまで出し、ホストだけが変えられる。
// 変えたら全員の OK を空にして（知らないうちにルールが変わらないように）20秒を数え直し、ゲストの画面には何をどう変えたかを一言出す（onState の againRuleNote）。
// Claude の判断: 出す設定は QUICK_KEYS の順でそのゲームにある選ぶ形のものから3つまで（CPU の強さは CPU が入っている対局だけ）。人数（players）は顔ぶれが変わるので出さない。
// 変えた設定は待合室で変えたときと同じく端末に覚える（rememberRules）
const QUICK_KEYS = ['cpu', 'level', 'size', 'rounds', 'time', 'goal'];
function quickRules(game) {
  const hasCpu = (S.order ?? []).some(isCpu);
  return QUICK_KEYS.map((k) => game.settings?.find((x) => x.key === k && Array.isArray(x.choices)))
    .filter((x) => x && (x.key !== 'cpu' || hasCpu)).slice(0, 3);
}
function againRule(key, value) {
  if (!S.isHost) return;
  const rules = { ...againRules(), [key]: value };
  rememberRules({ ...S.rules, [S.gameId]: { ...rulesOf(S.gameId, S.rules), ...rules } });
  S.again = againWith([], againVer() + 1, rules);
  saveRoom();
  sendState();
  checkAgain();
  render();
  toast('ルールを変えました。みんなの OK は押し直しになります');
}
function againRulesBox(game) {
  const list = quickRules(game);
  if (!list.length) return null;
  const cur = nextRulesOf();
  const box = document.createElement('div');
  box.className = 'again-rules';
  const head = document.createElement('span');
  head.className = 'again-rules-head';
  head.textContent = S.isHost ? '次のルール（変えられます）' : '次のルール（部屋を作った人が変えられます）';
  box.append(head);
  for (const x of list) {
    const label = document.createElement('label');
    if (S.againFlash?.key === x.key && Date.now() < S.againFlash.until) label.classList.add('flash');
    const t = document.createElement('span');
    t.textContent = x.label;
    const sel = document.createElement('select');
    x.choices.forEach(([value, name], i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = name;
      opt.selected = value === cur[x.key];
      sel.append(opt);
    });
    sel.disabled = !S.isHost;
    sel.onchange = () => againRule(x.key, x.choices[Number(sel.value)][0]);
    label.append(t, sel);
    box.append(label);
  }
  return box;
}
// ゲストの画面: 結果の画面でホストがルールを変えたら、何をどう変えたかを一言出し、その設定の行を光らせる
function againRuleNote(oldRules, oldVer) {
  const game = GAMES[S.gameId];
  if (!game || S.isHost || againVer() <= oldVer) return;
  const now = nextRulesOf();
  const changed = quickRules(game).filter((x) => now[x.key] !== oldRules[x.key]);
  if (!changed.length) return;
  const name = (x) => x.choices.find(([v]) => v === now[x.key])?.[1] ?? '';
  toast(`ホストが${changed.map((x) => `${x.label}を「${name(x)}」`).join('、')}に変えました${againNeed().includes(S.myId) ? '。もう一度 OK を押してください' : ''}`); // 観戦の人は OK を押さない
  S.againFlash = { key: changed[0].key, until: Date.now() + 1400 };
}
function appendAgain() {
  const need = againNeed();
  const ids = againIds();
  const rk = resultKey();
  const key = rk + '#' + againVer(); // ルールを変えたら残りの秒数を数え直す
  S.againSeen ??= {};
  S.againSeen[key] ??= Date.now();
  const box = document.createElement('div');
  box.className = 'again-box';
  const waitFor = need.filter((id) => !ids.includes(id));
  const line = document.createElement('p');
  line.className = 'again-line';
  line.innerHTML = `🔁 もう一回: OK ${need.length - waitFor.length}/${need.length}人${waitFor.length ? `（まだ: ${waitFor.map((id) => esc(id === S.myId ? 'あなた' : nameOf(id))).join('・')}）` : ''}　<b class="again-left"></b>`;
  box.append(line);
  const rules = againRulesBox(GAMES[S.gameId]);
  if (rules) box.append(rules);
  const acts = document.createElement('div');
  acts.className = 'again-acts';
  if (need.includes(S.myId) && !ids.includes(S.myId)) {
    acts.append(
      makeButton('✅ もう一回', () => afterAd(() => sayAgain(true))),
      makeButton('🏠 待合室へ（ほかの遊び）', () => afterAd(() => sayAgain(false)), 'secondary'),
      makeButton('やめる（部屋を出る）', () => leave(), 'ghost small'),
    );
  } else if (need.includes(S.myId)) {
    acts.innerHTML = '<span class="again-wait">OK しました。みんなを待っています…</span>';
  }
  box.append(acts);
  ctl().append(box);
  const tick = () => {
    const left = Math.max(0, Math.ceil((AGAIN_MS - (Date.now() - (S?.againSeen?.[key] ?? Date.now()))) / 1000));
    const b = document.querySelector('.again-left');
    if (!b || resultKey() !== rk) { clearInterval(againTick); againTick = null; return; }
    b.textContent = `残り ${left}秒`;
  };
  clearInterval(againTick);
  againTick = setInterval(tick, 500);
  tick();
}

/* ---------- 全画面広告（App Store 版だけ。2026-10-22 本人の決定）: 結果の画面のボタンを押したとき、押した動きの前に出す ---------- */
// 出すかどうか（3局ごと・3分あける）と、帯広告の出し入れは ads.js が決める。ウェブ版ではすぐ押した動きに進む。
// 広告を見ている間にほかの人が次の対局を始めていたら、押した動きはしない（もう一回を2回進めないように）。
// エアホッケーは結果が main.js を通らないので数えない・出さない。
let resultUp = false; // いま結果の画面を出している
const resultKey = () => (S ? `${S.gameId}:${S.round}:${S.seed}` : null);
async function afterAd(action) {
  const key = resultKey();
  if (!(await beforeLeaveResult())) return;
  if (S && resultKey() === key) action();
}

/* ---------- アプリならではの良さ（App Store 版だけ。2026-10-22 本人の決定。中身は native.js） ---------- */
// 実績の数え方（Claude の判断）: 遊んだゲームの種類は、対局者として対局の画面を開いたとき（同じ画面の対局も）。勝ちの数・連勝・「つよい」に勝った・
// 人と対局したは、オンラインで対局者として決着を見たときだけ（同じ画面の対局は、だれが自分か分からないので数えない）。勝ったかは勝ちの音と同じ見方（sound.js の endSound）。
// エアホッケーは結果が main.js を通らないので、遊んだ種類にだけ入る。
function noteAchievements(game, res, st) {
  const me = myPlayer();
  if (S.mode === 'online') noteRoomSize(S.members.length);
  if (S.mode === 'local' || me >= 0) notePlayed(S.gameId);
  if (res && S.mode === 'local') noteGame(`local:${resultKey()}`, { won: false, withHuman: false, best: null, gameId: S.gameId });
  if (!res || S.mode !== 'online' || !(me >= 0)) return;
  const won = endSound(res, me) === 'win';
  const levels = cpuLevels(game);
  const hard = !!levels && rulesOf(S.gameId, S.rules).cpu === levels[levels.length - 1] && S.order.some(isCpu);
  const withHuman = S.order.some((id) => id && id !== S.myId && !isCpu(id));
  noteResult(`${S.code}:${resultKey()}`, { won, beatHardCpu: won && hard, withHuman });
  // 自分の記録（ランキング・色の解放。records.js）。自己ベストは自分の席の数字だけ
  const value = game.record && st ? game.record.of(st, me, S.moves) : null;
  const best = Number.isInteger(value) ? { game, rules: rulesOf(S.gameId, S.rules), value } : null;
  // CPU 図鑑: 勝った対局にいた CPU（いっしょに勝った CPU は除く）
  const wonSeats = new Set(winnersOf(res));
  const beat = won ? S.order.flatMap((id, p) => (isCpu(id) && !wonSeats.has(p) ? [cpuBaseName(id)] : [])).filter(Boolean) : [];
  const { isNew, fresh } = noteGame(`${S.code}:${resultKey()}`, { won, withHuman, best, beat, hard, gameId: S.gameId });
  if (isNew) lateToast(`🎉 自己ベスト更新！ ${game.name} ${game.record.fmt(value)}`);
  if (fresh.length) lateToast(`📖 CPU 図鑑に ${fresh.join('・')} が載った！（${Object.keys(readRecords().cpus).length}/${CPU_NAMES.length}）`);
}

// 決着したときの記録の知らせ（自己ベスト・CPU 図鑑・色の解放）は、決着のあいさつ（greet。最大1.9秒後に出て2.2秒見える）に上書きされないよう、
// そのあとに1つの一言にまとめて出す（前はすぐ出していたので、あいさつで消えていた）
let lateNotes = [];
function lateToast(text) {
  if (!lateNotes.length) setTimeout(() => { toast(lateNotes.join('　')); lateNotes = []; }, 4200);
  lateNotes.push(text);
}

// 「📷 画像で保存・共有」: いまの画面を画像にして iPhone の共有の画面を開く（画像を保存・LINE など）
function appendShare() {
  if (!canShare()) return;
  ctl().append(makeButton('📷 画像で保存・共有', async () => { if (!(await shareScreen())) toast('画像にできませんでした'); }, 'secondary'));
}

/* ---------- 途中から空いた席に入る（2026-10-22。27回目の案。Claude の案から本人が選んだ） ---------- */
// 部屋を出た人の席を CPU が代わりに打っている間、観戦の人が「🪑 ○○ の代わりに入る」を押すと、その席を引き継いで続きを打てる。
// Claude の判断: 入れるのは部屋を出た人の席だけ（もとから CPU の席・人のいる席には入れない）。決着の前だけ。エアホッケー（live）には出さない
// （対局の途中で席の人を替える作りが無いため）。ゲストは type: 'sit'（ゲーム・回・席の番号）を送り、ホストが確かめて S.order のその席の id を入れ替え、
// state で全員へ送る。**round は進めない**（手の一覧も局面もそのままで、席の人が替わるだけ。プレイヤー番号は変わらないので当て直しも同じ）。
// 2人が同時に押したら、ホストに先に届いた方が入る。部屋を出た人が戻ってきても、席がもう埋まっていれば観戦になる。
const vacantSeats = () => (S.mode === 'online' && S.order && !GAMES[S.gameId]?.live
  ? S.order.flatMap((id, p) => (id && !isCpu(id) && !S.members.includes(id) ? [p] : [])) : []);
function appendSit(game, res) {
  if (res || myPlayer() !== SPECTATOR || S.full) return;
  for (const p of vacantSeats()) {
    const seat = game.multi ? '' : `（${game.players[col(p)]}）`;
    ctl().append(makeButton(`🪑 ${nameOf(S.order[p])}${seat}の代わりに入る`, () => askSit(p), 'secondary')); // 名前は textContent で入る
  }
}
function askSit(p) {
  if (S.isHost) { takeSeat(S.myId, p, S.gameId, S.round); return; }
  send({ type: 'sit', gameId: S.gameId, round: S.round, p });
  toast('席に入れるか聞いています…');
}
// ホストだけ: 席 p を id の人に替える（入れなければ何もしない）
function takeSeat(id, p, gameId, round) {
  if (!S.isHost || gameId !== S.gameId || round !== S.round || !Number.isInteger(p) || !S.members.includes(id) || S.order?.includes(id) || !vacantSeats().includes(p)) return false;
  const st = replay(S);
  if (!st || GAMES[S.gameId].result(st)) return false;
  const was = S.order[p];
  S.order = S.order.slice();
  S.order[p] = id;
  S.cpuKeys[p] = null; // CPU の予約は使わない（予約してあった分は、打つときに席が人に替わったのを見て止まる）
  saveRoom();
  sendState();
  toast(`${id === S.myId ? 'あなた' : nameOf(id)}が ${nameOf(was)} の代わりに入りました`);
  render();
  return true;
}

/* ---------- 盤の向きを変える（2026-10-07。20回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// 対局の画面の下の段の「⇅ 盤の向き」で、自分の画面だけ盤を回し、下に来る人を次の人へ替える（観戦の人が応援している人の側から見られる）。
// Claude の判断: 向きに意味のある、陣地の決まったゲーム（game.flip。将棋（5五・3×4・3人も）・はさみ将棋・マンカラ）だけに出す。
// マルバツ・リバーシ・五目並べなどはどちらから見ても同じ盤なので出さない。ほかの人には送らない・保存しない（この端末のこの部屋の間だけ）。
// オンラインでは「下に来る人」を人の id で覚える（もう一回で先手と後手が入れ替わっても、同じ人の側から見続けられるように）。
// 同じ画面の対局では席の番号で覚える。ゲームには、下に来る席の番号を o.view で渡す（替えていなければ渡さず、ゲームのいつもの向き）。
function boardView(game) {
  if (!game?.flip || game.multi) return undefined;
  const n = boardSeats(S.gameId, S.rules);
  if (S.mode === 'online') {
    const i = S.viewId ? roundOrder().indexOf(S.viewId) : -1;
    return i >= 0 && i < n ? i : undefined;
  }
  return Number.isInteger(S.viewLocal) && S.viewLocal < n ? S.viewLocal : undefined;
}

function appendFlip(game) {
  if (!game?.flip || game.multi || (S.mode === 'online' && !S.order)) return;
  const n = boardSeats(S.gameId, S.rules);
  const me = myPlayer();
  const cur = boardView(game) ?? (Number.isInteger(me) && me >= 0 && me < n ? me : 0); // ゲームのいつもの向きと同じ（自分、観戦・同じ画面では先手）
  const who = (p) => {
    if (S.mode !== 'online') return game.players?.[p] ?? `${p + 1}番目`;
    const id = roundOrder()[p];
    return id === S.myId ? 'あなた' : id ? nameOf(id) : `${p + 1}番目`;
  };
  const b = makeButton(`⇅ 盤の向き（下: ${who(cur)}）`, () => {
    const next = (cur + 1) % n;
    if (S.mode === 'online') S.viewId = roundOrder()[next] ?? null; else S.viewLocal = next;
    render();
  }, 'ghost small');
  b.setAttribute('aria-label', `盤の向きを変える。いま下にいるのは ${who(cur)}`);
  ctl().append(b); // 名前は textContent で入る（makeButton）ので、外から来た文字でもそのまま使える
}

/* ---------- さっきの手をもう一度（2026-11-11 本人の選択。room.md「UI・UX の4回目」） ---------- */
// 盤のゲームの対局中に「↺ さっきの手」を押すと、1手前の局面を描いてから、最後の手が新しく届いたときと同じように描き直す
// （石や駒の動き・リバーシの返る石・音がもう一度出る）。そのあと、1手前と変わったマスを金色に縁取る（.was。数秒で消える）。
// Claude の判断: 決着のあとは出さない（ふりかえりがある。判子や紙吹雪をもう一度出さないため）。もう一度の間は「番が来た」の知らせを出さない（replayNow）。
// 変わったマスは、盤の中でいちばん子の多い入れ物の子どうしを、中の字と中の物の種類（動きの印・押せる印などは除く）で比べて見つける。
const REPLAY_WAIT_MS = 550; // 1手前の局面を見せておく長さ
const WAS_SKIP = new Set(['last', 'pop', 'flip', 'playable', 'usable', 'sel', 'picked', 'hint', 'was', 'drop', 'land', 'slide', 'new', 'fresh']);
let replayNow = false;
let replayToken = 0;
function appendReplayLast(game, res) {
  if (game.multi || game.live || res || !S.moves.length || (S.mode === 'online' && !S.order)) return;
  const b = makeButton('↺ さっきの手', () => replayLast(game), 'ghost small');
  b.setAttribute('aria-label', '最後の手をもう一度見る');
  ctl().append(b);
}
function cellsOf(board) {
  let best = board;
  for (const e of board.querySelectorAll('*')) if (e.children.length > best.children.length) best = e;
  return [...best.children];
}
function cellSig(e) {
  const parts = [e.textContent, e.dataset.fill !== undefined ? 'fill' : '']; // 印だけで埋まる物（data-fill。点と線の線）も見る（2026-11-11 Codex の点検）
  for (const d of e.querySelectorAll('*')) parts.push(d.tagName + ':' + [...d.classList].filter((c) => !WAS_SKIP.has(c) && !c.startsWith('fly')).sort().join('.'));
  return parts.join('|');
}
function replayLast(game) {
  const n = S.moves.length;
  const key = timerKey();
  const prev = replay({ ...S, moves: S.moves.slice(0, -1) });
  if (!prev || !n) return;
  const board = el('board');
  const token = ++replayToken;
  game.render(board, prev, { canMove: false, onMove: () => {}, fresh: false, me: watchSeat(game), view: boardView(game) });
  const before = cellsOf(board).map(cellSig);
  setTimeout(() => {
    if (token !== replayToken || !S || timerKey() !== key) return;
    if (S.moves.length !== n) { render(); return; } // 待つ間に新しい手が来た
    S.shownKey = S.gameId + ':' + S.round;
    S.shownLen = n - 1; // 新しく届いた手として描く（render の fresh）
    replayNow = true;
    try { render(); } finally { replayNow = false; }
    const now = cellsOf(el('board'));
    if (now.length !== before.length) return;
    now.forEach((c, i) => { if (cellSig(c) !== before[i]) c.classList.add('was'); });
  }, REPLAY_WAIT_MS);
}

/* ---------- 対局のふりかえり（2026-10-06 本人の決定）: 盤のゲームが終わったあと、最初から1手ずつ見返せる ---------- */
// Claude の判断: 見ている所は各自の端末だけ（ほかの人とは合わせない。S.review = { key: どの対局か, k: 何手目まで }。保存しない）。
// 途中の局面は手の一覧の先頭 k 手を当て直して作る（replay）。見ている間は盤を押せない。最後の手まで進めると、いつもの終わりの画面に戻る。
// カードゲームは出さない（伏せた札が見えてしまうため）。
const reviewKey = () => `${S.gameId}:${S.round}:${S.seed}`;
const reviewing = () => S.review?.key === reviewKey() && S.review.k < S.moves.length;

// 途中の局面を描く。描いたら true
function renderReview(game) {
  if (!reviewing()) return false;
  const k = S.review.k;
  const view = replay({ ...S, moves: S.moves.slice(0, k) });
  if (!view) { S.review = null; return false; }
  const extra = game.info?.(view);
  el('status').innerHTML = `<div class="status-main">ふりかえり</div><div class="status-sub">${k}手目 / ${S.moves.length}手${k ? '' : '（始めの局面）'}</div>`
    + (extra ? `<div class="status-sub">${extra}</div>` : '') + judgeTurnNote(game, k);
  const chart = judgeChart(game, k); // ふりかえりの分かれ目（2026-11-12）
  if (chart) el('status').append(chart);
  game.render(el('board'), view, { canMove: false, onMove: () => {}, fresh: false, me: myPlayer(), view: boardView(game) });
  appendReview(game);
  appendFlip(game);
  ctl().append(makeButton('もう一回', rematch));
  if (S.mode === 'online' && S.isHost) ctl().append(makeButton('メンバーを変える', () => newRound(S.gameId, { lobby: true }), 'secondary'));
  appendReactions();
  if (S.mode === 'online' && S.isHost) ctl().append(gameSelect());
  appendMemberPanel();
  return true;
}

// ふりかえりのボタン（見ていないときは「ふりかえり」1つだけ）
function appendReview() {
  const n = S.moves.length;
  if (!n) return;
  const go = (k) => { S.review = { key: reviewKey(), k: Math.max(0, Math.min(n, k)) }; render(); };
  if (!reviewing()) {
    ctl().append(makeButton('ふりかえり（最初から見る）', () => go(0), 'secondary'));
    const turn = judgeTurn(GAMES[S.gameId]); // ふりかえりの分かれ目（2026-11-12）
    if (turn !== null) ctl().append(makeButton('★ 分かれ目へ', () => go(turn), 'secondary')); // 最後の手が分かれ目のときも出す（2026-11-12 の Codex の点検）
    return;
  }
  const k = S.review.k;
  const bar = document.createElement('div');
  bar.className = 'review-bar';
  const b = (text, label, to, off) => { const x = makeButton(text, () => go(to), 'secondary small'); x.disabled = off; x.setAttribute('aria-label', label); return x; };
  bar.append(
    b('⏮', '最初の局面へ', 0, k === 0),
    b('◀', '1手戻る', k - 1, k === 0),
    b('▶', '1手進む', k + 1, false),
    b('⏭ 終わり', '終わりの局面へ', n, false),
  );
  ctl().append(bar);
  const turn = judgeTurn(GAMES[S.gameId]);
  if (turn !== null && k !== turn) ctl().append(makeButton('★ 分かれ目へ', () => go(turn), 'ghost small'));
}

/* ---------- 形勢（2026-11-12 本人の選択。room.md「UI・UX の5回目」の「形勢の帯」「ふりかえりの分かれ目」） ---------- */
// ゲームの judge(局面) → 席 0 から見た優勢の度合い −100〜100（util.js の boardJudge）。2人の盤のゲームで、judge を持つものだけ。
// Claude の判断: 数は各端末で数える（送らない。読みに Math.random を使わないので、同じ局面ならどの端末でも同じ数）。
// 同じ対局の k 手目の数は覚えておき、描き直しのたびに読み直さない（待った・1手戻すで手が減ったら覚えた数を捨てる）。
const judgeMemo = { key: null, len: 0, at: new Map() };
function judgeSeries(game) {
  if (!game?.judge || game.multi || game.live || boardSeats(S.gameId, S.rules) !== 2) return null;
  const key = `${reviewKey()}:${S.undo ?? 0}`;
  if (judgeMemo.key !== key || S.moves.length < judgeMemo.len) { judgeMemo.key = key; judgeMemo.at = new Map(); }
  judgeMemo.len = S.moves.length;
  const n = S.moves.length;
  if (judgeMemo.at.size < n + 1) {
    const val = (st) => { let v = null; try { v = game.judge(st); } catch { v = null; } return Number.isFinite(v) ? Math.max(-100, Math.min(100, Math.round(v))) : null; };
    const first = replay({ ...S, moves: [] });
    if (!first) return null;
    if (!judgeMemo.at.has(0)) judgeMemo.at.set(0, val(first));
    replay(S, (before, after, m, i) => { if (!judgeMemo.at.has(i + 1)) judgeMemo.at.set(i + 1, val(after)); });
  }
  return Array.from({ length: n + 1 }, (_, k) => judgeMemo.at.get(k) ?? null);
}
// 分かれ目 = 1つ前からの形勢の動きがいちばん大きい手（何手目か）。動きが小さい（20 未満）ときは無し
function judgeTurn(game) {
  const s = judgeSeries(game);
  if (!s) return null;
  let best = null;
  let size = 19;
  for (let k = 1; k < s.length; k++) {
    if (s[k] === null || s[k - 1] === null || S.moves[k - 1]?.give === true) continue; // 参りましたの手は分かれ目にしない（形勢が一気に動くだけなので）
    const d = Math.abs(s[k] - s[k - 1]);
    if (d > size) { size = d; best = k; }
  }
  return best;
}
const judgeWord = (game, v) => {
  const a = Math.abs(v);
  if (a < 10) return '互角';
  const who = seatMark(game, v > 0 ? 0 : 1);
  return `${who} ${a < 40 ? 'やや有利' : a < 90 ? '有利' : '勝ちそう'}`;
};
// 形勢の帯を出すか: 観戦の人だけ（対局している人にはヒントになるため）。
// ただし形勢を見ても手が変わらない対戦（本人の言葉は「形勢がヒントにならない対戦」）では対局している人にも出す。ゲームの judgeOpen(局面) が true のとき（いまのゲームには無い）
function judgeBarShown(game, st) {
  if (S.mode !== 'online' || !S.order || !game.judge || game.multi) return false;
  return myPlayer() === SPECTATOR || game.judgeOpen?.(st) === true;
}
let judgeShown = { key: null, v: 0 }; // 帯の前の長さ（新しい長さへ動かして見せる）
function judgeBar(game, st) {
  if (!judgeBarShown(game, st)) return null;
  const s = judgeSeries(game);
  const v = s?.[S.moves.length];
  if (v === null || v === undefined) return null;
  const key = reviewKey();
  const from = judgeShown.key === key ? judgeShown.v : 0;
  judgeShown = { key, v };
  const d = document.createElement('div');
  d.className = 'judge-bar';
  judgeColors(d);
  d.setAttribute('role', 'img');
  d.setAttribute('aria-label', `形勢: ${judgeWord(game, v).replace(/<[^>]+>/g, '')}`);
  const name = (p) => `<span class="pl p${col(p)}">${game.players[col(p)]} ${esc(nameOf(roundOrder()[p]))}</span>`;
  d.innerHTML = `<div class="jb-lab">${name(0)}<span class="jb-mid">形勢: ${judgeWord(game, v)}</span>${name(1)}</div><div class="jb-track"><div class="jb-fill" style="width:${50 + from / 2}%"></div></div>`;
  if (from !== v) requestAnimationFrame(() => requestAnimationFrame(() => { const f = d.querySelector('.jb-fill'); if (f) f.style.width = `${50 + v / 2}%`; }));
  else d.querySelector('.jb-fill').style.width = `${50 + v / 2}%`;
  return d;
}
// 形勢の帯と線の色を、名前と同じく席の色の直し（col）に合わせる（続けて遊ぶ間に先手と後手が入れ替わった対局で、色と名前が逆にならないように。2026-11-13 Codex の点検）
function judgeColors(e) {
  e.style.setProperty('--jb0', `var(--p${col(0)})`);
  e.style.setProperty('--jb1', `var(--p${col(1)})`);
}
// ふりかえりの上の形勢の線。k = いま見ている手。押すとその手へ飛ぶ
function judgeChart(game, k) {
  const s = judgeSeries(game);
  if (!s || s.filter((v) => v !== null).length < 2) return null;
  const turn = judgeTurn(game);
  const W = 320;
  const H = 84;
  const pad = 8;
  const n = Math.max(1, s.length - 1);
  const x = (i) => pad + ((W - pad * 2) * i) / n;
  const y = (v) => H / 2 - (v / 100) * (H / 2 - 8);
  const pts = s.map((v, i) => (v === null ? null : [x(i), y(v)]));
  const line = pts.filter(Boolean).map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = (sign) => {
    const p = pts.map((q, i) => (q ? [q[0], y(sign > 0 ? Math.max(s[i], 0) : Math.min(s[i], 0))] : null)).filter(Boolean);
    return `M${p[0][0].toFixed(1)},${y(0)} ` + p.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join(' ') + ` L${p.at(-1)[0].toFixed(1)},${y(0)} Z`;
  };
  const box = document.createElement('div');
  box.className = 'judge-chart';
  judgeColors(box);
  const star = turn !== null && s[turn] !== null
    ? `<circle class="jc-turn" cx="${x(turn).toFixed(1)}" cy="${y(s[turn]).toFixed(1)}" r="5"></circle><text class="jc-star" x="${x(turn).toFixed(1)}" y="${(y(s[turn]) + (s[turn] > 0 ? 16 : -9)).toFixed(1)}" text-anchor="middle">★</text>` : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="形勢の移り変わり${turn !== null ? `。${turn}手目が分かれ目` : ''}">
    <path class="jc-p0" d="${area(1)}"></path><path class="jc-p1" d="${area(-1)}"></path>
    <line class="jc-zero" x1="${pad}" x2="${W - pad}" y1="${y(0)}" y2="${y(0)}"></line>
    <polyline class="jc-line" points="${line}"></polyline>
    <line class="jc-now" x1="${x(k).toFixed(1)}" x2="${x(k).toFixed(1)}" y1="2" y2="${H - 2}"></line>${star}
  </svg><div class="jc-lab"><span>${seatMark(game, 0)} 優勢 ↑</span><span>↓ ${seatMark(game, 1)} 優勢</span></div>`;
  box.querySelector('svg').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width * W - pad) / ((W - pad * 2) / n));
    S.review = { key: reviewKey(), k: Math.max(0, Math.min(s.length - 1, i)) };
    render();
  });
  return box;
}
// 分かれ目の手を見ているときの一言（その手を打った人）
function judgeTurnNote(game, k) {
  if (k === 0 || judgeTurn(game) !== k) return '';
  const before = replay({ ...S, moves: S.moves.slice(0, k - 1) });
  const p = before ? game.turn(before) : null;
  return `<div class="status-sub jc-note">★ 分かれ目: ${Number.isInteger(p) && game.players[p] ? `${seatMark(game, p)}の` : ''}この手で形勢が大きく動きました</div>`;
}

/* ---------- 結果に名場面（2026-11-12 本人の選択。room.md「UI・UX の5回目」）: 決着のあと、対局した人1人につき1行ずつ、その人の名場面を出す ---------- */
// ゲームの scenes(steps, 席の数) → 席ごとの一言（文字。名前は付けない）| null。steps = [{ before, after, move }]（手の一覧を最初から当て直したもの）。
// Claude の判断: scenes の無い盤のゲームは、考えた時間（tickClock の S.clock）から「いちばん長く考えた手」（3秒以上のときだけ。CPU の席は出さない）。
// 出せる人が1人もいなければ出さない。同じ対局の結果では作り直さない。判子のあとに1行ずつ出す（style.css の .scenes。2回目からの描き直しでは動かさない。動きを減らす設定ではすぐ）
let sceneMemo = { key: null, lines: null, shown: false };
function thinkScenes(n) {
  const c = S.clock;
  if (!c || c.key !== S.gameId + ':' + S.round) return null;
  const best = Array.from({ length: n }, () => ({ ms: 0, k: 0 }));
  c.log.forEach(([who, ms], i) => { if (best[who] && ms > best[who].ms) best[who] = { ms, k: i + 1 }; });
  return best.map((b, p) => (b.ms >= 3000 && !isCpu(roundOrder()[p]) ? `いちばん長く考えた手 ${Math.round(b.ms / 1000)}秒（${b.k}手目）` : null));
}
function appendScenes(game, st, res, status) {
  if (game.live) return;
  const key = `${resultKey()}:${S.moves.length}`;
  if (sceneMemo.key !== key) {
    const n = game.multi ? S.order?.length ?? 0 : boardSeats(S.gameId, S.rules);
    let lines = null;
    if (game.scenes) {
      const steps = [];
      replay(S, (before, after, move) => steps.push({ before, after, move }));
      try { lines = game.scenes(steps, n); } catch { lines = null; }
    }
    if (!Array.isArray(lines) && !game.multi) lines = thinkScenes(n);
    sceneMemo = { key, lines: Array.isArray(lines) ? lines.slice(0, n) : null, shown: false };
  }
  const lines = sceneMemo.lines;
  if (!lines?.some((t) => typeof t === 'string' && t)) return;
  const me = myPlayer();
  const who = (p) => {
    if (game.multi) return esc(p === me ? 'あなた' : nameOf(S.order[p]));
    const mark = game.players?.[p] ? `${seatMark(game, p)} ` : '';
    if (S.mode !== 'online') return mark.trim();
    return mark + esc(p === me ? 'あなた' : nameOf(roundOrder()[p]));
  };
  const box = document.createElement('div');
  box.className = 'scenes' + (sceneMemo.shown || lessMotion() ? ' still' : '');
  let i = 0;
  lines.forEach((t, p) => {
    if (typeof t !== 'string' || !t) return;
    const row = document.createElement('div');
    row.className = 'scene';
    row.style.setProperty('--i', i++);
    row.innerHTML = `<span class="sc-who">${who(p)}</span><span class="sc-txt"></span>`;
    row.querySelector('.sc-txt').textContent = t;
    box.append(row);
  });
  sceneMemo.shown = true;
  status.append(box);
}

/* ---------- 参りました（2026-11-12 本人の選択。room.md「UI・UX の5回目」）: 2人で打つ盤のゲームのオンラインで、自分の番に負けを認めて終われる ---------- */
// 手は { give: true }（util.js の withGiveUp。index.js の GIVE_UP のゲーム）。押せるのは自分の番だけ（将棋の投了と同じ。Claude の判断）。確かめの窓を1回出す
function appendGiveUp(game, canMoveNow) {
  if (!game.giveUp || S.mode !== 'online' || !canMoveNow || boardSeats(S.gameId, S.rules) !== 2) return;
  ctl().append(makeButton('🏳 参りました', () => {
    if (!confirm('参りましたにしますか？（相手の勝ちになります）')) return;
    onBoardMove({ give: true });
  }, 'ghost small'));
}

/* ---------- 勝敗予想（2026-10-06 本人の決定）: 対局の始めに、観戦の人も含めて「だれが勝つか」を1回選べる ---------- */
// Claude の判断: 選べるのは、対局の手が1巡する（打った手の数が対局する人数になる）まで。時間で進むゲームの進行役の手（p = -1）は数えない。
// 1人1回・変えられない・自分を選んでもよい。送りっぱなし（type: 'pred'）で、受け取った端末がそれぞれ覚える（あとから入った人には届かない）。
// 結果の画面に「予想が当たった人」を出す。オンラインの盤のゲームとカードゲームだけ（エアホッケーは結果が main.js を通らないので出さない）。
// 2026-10-30 本人の依頼（目立たないように）: 押すまでは「🔮 予想」の小さなボタンだけにし、押すと名前が並ぶ（開けたかは S.predShow にその対局の predKey。端末ごと）。
const predKey = () => `${S.gameId}:${S.round}`;
const predsNow = () => (S.preds?.key === predKey() ? S.preds.by : {});
function predOpen(game, res) {
  if (S.mode !== 'online' || !S.order || res || game.live) return false;
  // ヒット＆ブローの「自分で決める答え」の手（t: 'secret'）は当て合いの前の準備なので数えない
  const played = game.multi ? S.moves.filter((m) => Number.isInteger(m?.p) && m.p >= 0 && m.t !== 'secret').length : S.moves.length;
  return played < S.order.length;
}
function setPred(id, p) {
  if (S.preds?.key !== predKey()) S.preds = { key: predKey(), by: {} };
  if (S.preds.by[id] !== undefined) return false;
  S.preds.by[id] = p;
  saveRoom();
  return true;
}
function appendPredict(game, res) {
  if (!predOpen(game, res)) return;
  const mine = predsNow()[S.myId];
  const label = document.createElement('span');
  if (mine !== undefined) {
    label.className = 'pred-mine';
    label.textContent = `🔮 あなたの予想: ${nameOf(S.order[mine])}`;
    ctl().append(label);
    return;
  }
  if (S.predShow !== predKey()) {
    ctl().append(makeButton('🔮 予想', () => { S.predShow = predKey(); render(); }, 'ghost small'));
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'pred-bar';
  label.textContent = '🔮 だれが勝つ？';
  bar.append(label);
  S.order.forEach((id, p) => {
    bar.append(makeButton(id === S.myId ? 'あなた' : nameOf(id), () => {
      if (!predOpen(game, null) || !setPred(S.myId, p)) return;
      send({ type: 'pred', gameId: S.gameId, round: S.round, p });
      render();
    }, 'ghost small'));
  });
  bar.append(makeButton('✕ とじる', () => { S.predShow = null; render(); }, 'ghost small'));
  ctl().append(bar);
}
// 結果の画面に出す「予想が当たった人」。だれも予想していなければ出さない
function predHtml(res) {
  const by = predsNow();
  const ids = Object.keys(by).filter((id) => S.members.includes(id) || S.names[id]);
  if (!ids.length) return '';
  const won = winnersOf(res);
  const hit = ids.filter((id) => won.includes(by[id]));
  if (!hit.length) return `🔮 予想が当たった人はいません（${ids.length}人が予想）`;
  return '🔮 予想が当たった: ' + hit.map((id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b>`).join('・');
}

/* ---------- 勝った人に紙吹雪（2026-10-06 本人の決定） ---------- */
// 対局が決着した手が届いたとき、勝ちの音を鳴らす画面（勝った人・観戦・同じ画面の対局。sound.js の endSound）に3秒ほど降らせる。
// 動きを減らす設定の端末では出さない。画面を押すじゃまをしないよう pointer-events は切る。
const CONFETTI_COLORS = ['#e04b3c', '#f4c430', '#3a9d55', '#2f6fb3', '#8a4fc0', '#ff8fb1'];
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    p.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--rot', `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`);
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3600);
}

/* ---------- 演出（2026-11-06 の UI・演出・アニメーションの案。本人が決めたことは room.md の「演出・アニメーション」） ---------- */
// どれも1秒前後で消え、画面のどこかを押せばすぐ消える。演出そのものは押せない（pointer-events: none）ので、押した所の操作もそのまま効く。
// 動きを減らす設定の端末では出さない（同じ中身は状態の欄に字で出ている）。画面の端からはみ出す帯も横スクロールを生まないよう、.fx-clip で切る。
function lessMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; } // 関数の宣言にしてある（ファイルの上のほうの描き直しからも呼ぶため）
function showFx(node, ms) {
  const clip = document.createElement('div');
  clip.className = 'fx-clip';
  clip.setAttribute('aria-hidden', 'true'); // 中身は状態の欄・読み上げにもあるので、画面の読み上げには重ねない
  clip.append(node);
  document.body.append(clip);
  let gone = false;
  const off = () => {
    if (gone) return;
    gone = true;
    document.removeEventListener('pointerdown', off, true);
    clip.classList.add('out');
    setTimeout(() => clip.remove(), 300);
  };
  document.addEventListener('pointerdown', off, true);
  setTimeout(off, ms);
  return off;
}
const SHAKE_KF = [{ transform: 'none' }, { transform: 'translate(-4px, 2px)' }, { transform: 'translate(4px, -2px)' }, { transform: 'translate(-2px, 1px)' }, { transform: 'none' }];

// 決着の判子: 自分が対局した人は「勝ち！」「負け」「引き分け」（3人以上で順位のあるゲームの間の順位は「2位」など）。
// 勝ち負けは勝ちの音と同じ見方（sound.js の endSound）。観戦の人と同じ画面の対局は「○○の勝ち！」。判子は傾けない（2026-11-06 本人の指示）。
// エアホッケー・紙相撲（live）はここを通らない。
function stampOf(game, res, me, end) {
  if (me !== null && me >= 0) {
    if (end === 'win') return ['勝ち！', 'win'];
    if (end === 'lose') return ['負け', 'lose'];
    const i = Array.isArray(res.ranking) ? res.ranking.indexOf(me) : -1;
    return i > 0 ? [`${i + 1}位`, 'rank'] : ['引き分け', 'draw'];
  }
  // 名前は { n } で返し、判子の筆の字体にしない（人が打った字は今の字のまま。endStamp）
  const nm = (p) => ({ n: game.multi ? nameOf(S.order[p]) : S.mode === 'local' ? game.players[p] : nameOf(roundOrder()[p]) });
  if (Array.isArray(res.winners)) {
    const w = res.winners;
    if (!w.length) return ['引き分け', 'draw'];
    return [[...(w.length === 2 ? [nm(w[0]), '・', nm(w[1])] : [nm(w[0]), w.length > 2 ? 'たち' : '']), 'の勝ち！'], 'watch'];
  }
  if (res.loser !== null && res.loser !== undefined) return [[nm(res.loser), 'の負け'], 'watch'];
  if (res.draw || res.winner === null || res.winner === undefined) return ['引き分け', 'draw'];
  return [[nm(res.winner), 'の勝ち！'], 'watch'];
}
function endStamp(game, res, me, end, delay) {
  if (lessMotion()) return;
  const [text, kind] = stampOf(game, res, me, end);
  const key = timerKey();
  setTimeout(() => {
    if (!S || timerKey() !== key || reviewing()) return; // 待つ間に次の対局へ進んでいた・ふりかえりを見ていたら出さない
    const s = document.createElement('div');
    s.className = 'end-stamp ' + kind;
    for (const x of [text].flat()) { // 名前は外から来た文字なので textContent
      if (typeof x === 'string') s.append(x);
      else { const b = document.createElement('span'); b.className = 'nm'; b.textContent = x.n; s.append(b); }
    }
    showFx(s, 1700);
    if (kind === 'win') setTimeout(() => el('board')?.animate(SHAKE_KF, { duration: 320 }), 200);
    const pod = podiumOf(game, res, me);
    if (pod) setTimeout(() => { if (S && timerKey() === key && !reviewing()) podiumFx(pod); }, 1500); // 判子が消えるころに表彰台
  }, delay);
}

// 決め手のスロー（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: 盤のゲームで勝負が決まった手が新しく届いたとき、
// まわりを暗くして盤をその手へ少し寄せ、石がゆっくり落ちて盤が小さく揺れ、一拍おいてから線（util.js の lineHold）と判子・勝ち負けの音を出す。
// どこかを押すとすぐ最後まで飛ばす。寄せる先はゲームが最後の手の物に付ける data-last（"still" は寄せるだけで落とさない。駒が滑ってくる将棋・はさみ将棋、
// 列を落ちてくる四目並べ・立体四目並べ）。Claude の判断: 付けたのはマルバツ・四目並べ・立体四目並べ・リバーシ・五目並べ・はさみ将棋・将棋
// （点と線・マンカラ・海戦ゲームは決め手が1つの石でないので付けない）。寄せるのは 1.04 倍まで（スマホ幅で盤が画面の外へはみ出さないように）。
// 盤は描き直しで作り直されるので、途中で描き直されたら石の動きはそこで終わる（寄せと暗さは盤の入れ物と body に付けてあるので残る）
const SLOW_GAMES = new Set(['tictactoe', 'connect4', 'cube4', 'reversi', 'gomoku', 'hasami', 'shogi']);
const SLOW_LAND = 560; // 石が着くまで
const SLOW_LINE = 900; // 線を引き始めるまで（winLine のいつもの 160ms を含む）
const SLOW_HOLD = 1250; // 勝ち負けの音・判子まで
let slowNow = null; // 決め手のスローの途中 { key, jobs, clean }
function slowWanted(game, prevLen) {
  if (game.multi || game.live || !SLOW_GAMES.has(game.id) || lessMotion() || S.moves.at(-1)?.give === true) return false; // 参りましたは盤が動かない
  const before = replay({ ...S, moves: S.moves.slice(0, prevLen) });
  return !!before && !game.result(before);
}
function slowFinish(board) {
  slowSkip();
  const target = board.querySelector('[data-last]');
  const r = target?.getBoundingClientRect();
  if (!r?.width) return 0;
  const br = board.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const dim = document.createElement('div');
  dim.className = 'slow-dim';
  dim.setAttribute('aria-hidden', 'true');
  dim.style.setProperty('--x', cx.toFixed(0) + 'px');
  dim.style.setProperty('--y', cy.toFixed(0) + 'px');
  dim.style.setProperty('--r', Math.max(34, r.width * 1.2).toFixed(0) + 'px');
  document.body.append(dim);
  board.style.transformOrigin = `${(cx - br.left).toFixed(0)}px ${(cy - br.top).toFixed(0)}px`;
  board.style.transition = 'transform .45s cubic-bezier(.3, .7, .3, 1)';
  board.style.transform = 'scale(1.04)';
  const drop = target.dataset.last !== 'still';
  let fall = null;
  if (drop) {
    fall = target.animate([
      { transform: 'translateY(-22px) scale(1.6)', opacity: 0 },
      { opacity: 1, offset: 0.6 },
      { transform: 'none', opacity: 1 },
    ], { duration: SLOW_LAND, easing: 'cubic-bezier(.5, 0, .75, 0)', fill: 'backwards' });
  }
  const s = { key: timerKey(), jobs: [] };
  s.clean = () => {
    if (s.cleaned) return;
    s.cleaned = true;
    document.removeEventListener('pointerdown', slowSkip, true);
    dim.classList.add('out');
    setTimeout(() => dim.remove(), 320);
    board.style.transition = 'transform .3s ease';
    board.style.transform = '';
    setTimeout(() => { if (!board.style.transform) { board.style.transition = ''; board.style.transformOrigin = ''; } }, 340);
    if (slowNow === s) slowNow = null;
    try { fall?.finish(); } catch { /* 盤が描き直されて、もう無い */ } // 押して飛ばしたとき、石が落ち続けないように
  };
  slowNow = s;
  document.addEventListener('pointerdown', slowSkip, true);
  if (drop) slowAt(SLOW_LAND, () => board.animate([{ translate: '0 0' }, { translate: '0 2px' }, { translate: '0 -1px' }, { translate: '0 0' }], { duration: 220, easing: 'ease-out' }), false);
  slowAt(SLOW_HOLD, s.clean, true, true);
  crownLater(SLOW_HOLD); // 王冠（addCrown。帯は盤より先に描いてある）も判子と同じころに落とす
  return SLOW_HOLD;
}
function crownLater(ms) {
  crownAt.t = Date.now() + ms;
  for (const c of document.querySelectorAll('.turn-crown')) c.style.animationDelay = `${ms}ms`;
}
// ms 後に fn。決め手のスローの途中でなければすぐ。skip = 押して飛ばしたときも（すぐ）呼ぶか、always = 次の対局へ進んでいても呼ぶか
function slowAt(ms, fn, skip = true, always = false) {
  const s = slowNow;
  if (!ms || !s) { if (skip) fn(); return; }
  const job = { fn, skip, always, done: false };
  job.t = setTimeout(() => {
    job.done = true;
    if (always || (S && timerKey() === s.key)) fn();
  }, ms);
  s.jobs.push(job);
}
function slowSkip() {
  const s = slowNow;
  if (!s) return;
  slowNow = null;
  finishLine();
  crownLater(0);
  for (const job of s.jobs) {
    if (job.done) continue;
    job.done = true;
    clearTimeout(job.t);
    if (job.skip && (job.always || (S && timerKey() === s.key))) setTimeout(job.fn, 0); // 押した手の pointerdown が、出したばかりの判子をすぐ消さないように
  }
  s.clean();
}

// 点の数字が回る（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: ゲームが data-roll（鍵）と data-v（数）を付けた数字は、
// 前に出した数から変わったら、パッと変えずに数え上がる・数え下がる形で変え、増えた分・減った分（+6・−5）を小さく浮かべる。
// 本人の指示で、数え終わりに数字をふくらませる強調はしない。盤や状態の欄は描き直しのたびに作り直されるので、鍵ごとに数え始めた時刻を覚え、
// 描き直した数字も同じ時刻の値から続ける。鍵は対局ごとに分ける（次の対局の始めの数からは数えない）。data-comma があれば 25,000 のように区切る。
// Claude の判断: 付けたのはリバーシの石の数と麻雀の持ち点（パーティーゲームなどの点数の札は前から「+3」で数え上がる）。数える時間は 0.5秒、区切りのある数は 0.9秒
const rolls = new Map(); // 鍵 → { from, to, t, ms }
let rollRaf = 0;
function rollNums(root) {
  const quiet = lessMotion();
  const now = performance.now();
  for (const e of root.querySelectorAll('[data-roll]')) {
    const v = Number(e.dataset.v);
    if (!Number.isFinite(v)) continue;
    const key = `${timerKey()}:${e.dataset.roll}`;
    const r = rolls.get(key);
    if (!r) { rolls.set(key, { from: v, to: v, t: 0, ms: 0 }); continue; }
    if (r.to !== v) {
      const cur = rollAt(r, now);
      Object.assign(r, { from: cur, to: v, t: now, ms: quiet ? 0 : 'comma' in e.dataset ? 900 : 500, d: v - cur, done: quiet });
    }
    if (rollAt(r, now) !== v) {
      e.textContent = rollText(rollAt(r, now), e);
      const age = now - r.t;
      if (age < 1000 && r.d) {
        const d = document.createElement('span');
        d.className = 'roll-d ' + (r.d > 0 ? 'up' : 'dn');
        d.setAttribute('aria-hidden', 'true');
        d.textContent = (r.d > 0 ? '+' : '−') + rollText(Math.abs(r.d), e);
        d.style.animationDelay = `${-age}ms`;
        e.append(d);
      }
    }
  }
  if (rolls.size > 200) rolls.delete(rolls.keys().next().value);
  if (!rollRaf) rollRaf = requestAnimationFrame(rollStep);
}
function rollAt(r, now) {
  if (!r.ms || now - r.t >= r.ms) return r.to;
  const k = (now - r.t) / r.ms;
  return Math.round(r.from + (r.to - r.from) * (1 - (1 - k) ** 3));
}
const rollText = (x, e) => ('comma' in e.dataset ? (Math.round(x / 100) * 100).toLocaleString() : String(x));
function rollStep() {
  rollRaf = 0;
  const now = performance.now();
  let more = false;
  for (const e of document.querySelectorAll('[data-roll]')) {
    const r = S && rolls.get(`${timerKey()}:${e.dataset.roll}`);
    if (!r || r.done) continue;
    if (Number(e.dataset.v) !== r.to) continue; // ふりかえりで前の局面の数を出している数字は書き換えない
    if (now - r.t >= r.ms) r.done = true; else more = true; // 終わりの数を必ず1回書く（画面が隠れていて間が飛んでも）
    const n = e.firstChild;
    const txt = rollText(rollAt(r, now), e);
    if (n?.nodeType === 3) n.nodeValue = txt; else e.prepend(txt);
  }
  if (more) rollRaf = requestAnimationFrame(rollStep);
}

// 結果の表彰台（2026-11-09 本人の選択。room.md「演出・アニメーションの2回目」）: 点数で競うゲームで3人以上のとき、判子のあとに
// 3位→2位→1位の順に台がせり上がり、点数が0から数え上がり、1位に王冠が落ちる。4位からは下に1行で。押せばすぐ消える（showFx）。
// Claude の判断: 「点数で競う」は結果が席ごとの点（scores。ranking があるゲームは pts も）を持つゲーム。チーム戦（teams）と引き分け（draw）は出さない。
// 順位は成績表の「順位で点」と同じ見方（games/index.js の seatPoints）で決め、同じ順位なら点の多い順に並べる。4位からは5人まで出して残りは「ほか○人」
function podiumOf(game, res, me) {
  if (!res || res.teams !== undefined || res.draw === true || !winnersOf(res).length) return null; // 勝った人のいない引き分け（点と線・マンカラの1位の同点など）も出さない
  const okArr = (a) => Array.isArray(a) && a.length >= 3 && a.every(Number.isFinite);
  const val = okArr(res.scores) ? res.scores : okArr(res.pts) && Array.isArray(res.ranking) ? res.pts : null;
  if (!val) return null;
  const n = val.length;
  const sp = seatPoints(res, n);
  const nm = (p) => (game.multi ? nameOf(S.order[p]) : S.mode === 'local' ? game.players?.[p] ?? `${p + 1}番` : nameOf(roundOrder()[p]));
  return [...Array(n).keys()]
    .sort((a, b) => sp[b] - sp[a] || val[b] - val[a])
    .map((p) => ({ rank: 1 + sp.filter((x) => x > sp[p]).length, v: val[p], me: p === me, name: p === me ? 'あなた' : nm(p) }));
}
function podiumFx(list) {
  const box = document.createElement('div');
  box.className = 'podium-fx';
  const stage = document.createElement('div');
  stage.className = 'pd-stage';
  const counts = [];
  // 台の高さ・色と王冠は順位で決める（同点1位が2人なら、2人とも1位の台で王冠を付ける。2026-11-11 本人の決定）。並べる位置（まんなかが先頭）は今までどおり。
  // 台は3つまでなので、4人目からの1位は下の1行で名前の前に 👑 を付ける（台は増やさない。スマホ幅で細くなりすぎるため。Claude の判断を本人が承認）
  [[list[1], 300], [list[0], 600], [list[2], 0]].forEach(([x, at]) => {
    const col = document.createElement('div');
    col.className = `pd-col pd-${Math.min(3, x.rank)}`;
    col.style.setProperty('--at', at + 'ms');
    if (x.rank === 1) {
      const crown = document.createElement('div');
      crown.className = 'pd-crown';
      crown.textContent = '👑';
      col.append(crown);
    }
    const name = document.createElement('div');
    name.className = 'pd-name' + (x.me ? ' me' : '');
    name.textContent = x.name; // 名前は外から来た文字なので textContent
    const block = document.createElement('div');
    block.className = 'pd-block';
    const rk = document.createElement('span');
    rk.className = 'pd-rk';
    rk.textContent = x.rank;
    const sc = document.createElement('span');
    sc.className = 'pd-sc';
    sc.textContent = '0点';
    block.append(rk, sc);
    col.append(name, block);
    stage.append(col);
    counts.push([sc, x.v, at]);
  });
  box.append(stage);
  const rest = list.slice(3);
  if (rest.length) {
    const p = document.createElement('p');
    p.className = 'pd-rest';
    p.textContent = rest.slice(0, 5).map((x) => `${x.rank === 1 ? '👑' : ''}${x.rank}位 ${x.name} ${x.v.toLocaleString()}点`).join('・') + (rest.length > 5 ? `・ほか${rest.length - 5}人` : '');
    box.append(p);
  }
  showFx(box, 3600);
  for (const [sc, v, at] of counts) {
    setTimeout(() => {
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 420);
        sc.textContent = Math.round(v * (1 - (1 - k) ** 3)).toLocaleString() + '点';
        if (k < 1 && sc.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      setTimeout(() => { sc.textContent = v.toLocaleString() + '点'; }, 520); // 裏のタブで描き替えが止まっても、数は必ず正しい値にする
    }, at);
  }
}

// あなたのターンの帯: オンラインで TURN_PING_MS より長く待ったあとで自分の番が来たとき（moveSound の「番が来た」の枝。音・読み上げと同じとき）
function turnFx() {
  if (lessMotion()) return;
  const band = document.createElement('div');
  band.className = 'turn-fx';
  const t = document.createElement('span');
  t.textContent = `${myMark() ? myMark() + ' ' : ''}あなたのターン`;
  band.append(t);
  showFx(band, 1400);
}

// 技の名前: 色の帯に大きな字が右から入って左へ抜ける（ゲームの cutin が返す { text, color, flash }）。color は帯の色（CSS の色か linear-gradient）。
// flash = 'invert' なら盤を一瞬白黒反転する（大富豪の革命）。帯が出ている間（cutUntil まで）は、あなたのターンの帯を待たせる（重なると読めない）
let cutUntil = 0;
function cutInFx({ text, color, flash }) {
  if (lessMotion()) return;
  const box = document.createElement('div');
  box.className = 'cut-fx';
  box.style.setProperty('--c', color ?? 'var(--accent)');
  const t = document.createElement('span');
  t.textContent = text;
  box.append(t);
  showFx(box, 1250);
  cutUntil = Date.now() + 1250;
  if (flash === 'invert') el('board')?.animate([{ filter: 'none' }, { filter: 'invert(1) hue-rotate(180deg)', offset: 0.3 }, { filter: 'none' }], { duration: 750 });
}

// 画面の切り替え: 透明から少し持ち上げて出す（画面）・透明から出す（状態の欄・盤・下の段。盤には動きを付けるゲームがあるので位置は動かさない）。
// 長さは測らない（描き直しの途中で長さを読まない決まり）。動きを減らす設定の端末では出さない
const ENTER_KF = [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }];
const FADE_KF = [{ opacity: 0 }, { opacity: 1 }];
function enterFx(nodes, kf) {
  if (lessMotion()) return;
  for (const n of [nodes].flat()) n?.animate(kf, { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

// 片付けの動き（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: 決着した盤から同じゲームの次の対局へ進んだとき（もう一回・勝ち残りなど）、
// 前の盤の石や駒の写しを同じ場所に重ね、ばらばらの順で盤の右下に出る箱へ吸いこませる（新しい盤はその下でいつもどおり出る）。1秒ほどで、どこかを押せばすぐ消える。
// 写しは画面に固定した入れ物（盤と同じ class を付け、盤の地・枠は style.css の .clean-fx で消す）に入れるので、途中で描き直しても動きは続く。
// Claude の判断: 盤のゲームだけ（カードゲームは次の対局の始めに札を配る動きがあり、重ねるとごちゃつくため付けない）。3人将棋（盤を SVG で描く）と
// 点と線の線・海戦ゲームの船は CLEAN_SEL に入れていないので片付けない。動かすのは個別の translate・scale（駒の向きの transform を崩さないように）。写すのは120個まで
const CLEAN_SEL = '.rv-disc, .gm-stone, .c4-disc, .cb-disc, .ttt-cell > svg, .gob-pc, .sg-piece, .mc-stones > *';
function cleanSnap() {
  if (!resultUp || !S?.viewKey?.startsWith(`game:${S.gameId}:`) || lessMotion()) return null;
  const game = GAMES[S.gameId];
  if (!game || game.multi || game.live) return null;
  const next = S.mode === 'online' && (!S.order || (S.lobbyView && !S.isHost)) ? 'lobby' : 'game:' + timerKey();
  if (next === S.viewKey || !next.startsWith(`game:${S.gameId}:`)) return null;
  const board = el('board');
  const items = [...board.querySelectorAll(CLEAN_SEL)].slice(0, 120)
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.bottom > 0 && r.top < innerHeight)
    .map(({ e, r }) => ({ e: e.cloneNode(true), r }));
  return items.length ? { next, cls: board.className, br: board.getBoundingClientRect(), items } : null;
}
function cleanPlay(c) {
  const fx = document.createElement('div');
  fx.className = c.cls + ' clean-fx';
  fx.setAttribute('aria-hidden', 'true');
  const bx = Math.min(innerWidth - 40, c.br.right - 30);
  const by = Math.min(innerHeight - 30, c.br.bottom - 18);
  const box = document.createElement('div');
  box.className = 'clean-box';
  box.style.left = `${(bx - 29).toFixed(0)}px`;
  box.style.top = `${(by - 23).toFixed(0)}px`;
  const n = c.items.length;
  const gap = Math.min(22, 480 / n);
  const order = c.items.map((x) => [x, Math.random()]).sort((a, b) => a[1] - b[1]).map(([x]) => x);
  order.forEach(({ e, r }, k) => {
    for (const a of ['data-fly', 'data-fly-from', 'data-last', 'id']) e.removeAttribute(a);
    Object.assign(e.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', animation: 'none', transition: 'none' });
    fx.append(e);
    const dx = (bx - (r.left + r.width / 2)).toFixed(1);
    const dy = (by - (r.top + r.height / 2)).toFixed(1);
    e.animate([
      { translate: '0 0', scale: '1', opacity: 1 },
      { translate: `${dx}px ${dy}px`, scale: '.4', opacity: 1, offset: 0.85 },
      { translate: `${dx}px ${dy}px`, scale: '.3', opacity: 0 },
    ], { duration: 460, delay: 120 + k * gap, easing: 'cubic-bezier(.5, 0, .7, .4)', fill: 'both' });
  });
  fx.append(box); // 箱は写しより前に出す（吸いこまれて見えるように）
  document.body.append(fx);
  const total = 120 + n * gap + 460 + 260;
  box.style.setProperty('--clean-ms', `${total.toFixed(0)}ms`);
  let gone = false;
  const off = () => {
    if (gone) return;
    gone = true;
    document.removeEventListener('pointerdown', off, true);
    fx.remove();
  };
  document.addEventListener('pointerdown', off, true);
  setTimeout(off, total);
}

// 始まりの顔合わせ: オンラインの対局の始め（手がまだ無いところを初めて描いたとき）に、顔ぶれを1秒ほど出してから「スタート！」。
// 2人は「あき VS ピコ」、3人以上は名前の札を2列に並べる。早押し・早解きとアクションの仲間（games/index.js の CATEGORIES）と、
// 始まってすぐ速さを競うスピード（NO_INTRO）には出さない（始めを隠すと損をするため）。同じ画面の対局は名前が無いので出さない。
// 札の色は席の色（盤のゲームは [data-game] ごとの --p0 など、5人目からは SEAT_COLORS）。名前は外から来た文字なので textContent
const NO_INTRO = new Set(['speed']);
// 今度はあなたが先手（2026-11-13 本人の選択。room.md「UI・UX の6回目」）: 色と形を人に付けるゲーム（keepColor）で、前の対局と同じ顔ぶれのまま席の順が変わったら、
// 顔合わせで札が前の席から今の席へ入れ替わって入り、自分の席が変わった人には「今度はあなたが先手（○のまま）」を出す。動きを減らす設定の端末では一言だけ出す。
// 前の対局の席は、この端末で前に顔合わせを考えたとき（lastSeats）のもの（読み込み直したあとの最初の対局では出さない）
let lastSeats = null;
function seatSwap(game, ids) {
  const prev = lastSeats;
  lastSeats = { key: S.code + ':' + S.gameId, ids: ids.slice() };
  if (S.mode !== 'online' || !game?.keepColor || prev?.key !== lastSeats.key || prev.ids.length !== ids.length) return null;
  const from = ids.map((id) => (isCpu(id) ? -1 : prev.ids.indexOf(id)));
  if (from.some((j, i) => j < 0 && !isCpu(ids[i])) || from.every((j, i) => j === i || j < 0)) return null; // 顔ぶれが替わった・席が動いていない
  const me = ids.indexOf(S.myId);
  let note = '';
  if (me >= 0 && from[me] !== me) {
    const seat = ids.length > 2 ? `${me + 1}番目` : me === 0 ? '先手' : '後手';
    note = `今度はあなたが${seat}（${game.players[col(me)]}のまま）`;
  }
  return { from, note };
}
function introFx(game) {
  const ids = S.order ?? [];
  const swap = seatSwap(game, ids);
  if (swap?.note && lessMotion()) toast('🔁 ' + swap.note);
  if (lessMotion() || S.mode !== 'online' || !game || game.live || ids.length < 2 || NO_INTRO.has(S.gameId) || ['quick', 'action'].includes(categoryOf(S.gameId))) return;
  const box = document.createElement('div');
  box.className = 'vs-fx';
  box.dataset.game = S.gameId;
  const plate = (id, i) => {
    const p = document.createElement('div');
    p.className = 'vs-plate';
    p.textContent = nameOf(id);
    const c = game.multi ? i : col(i); // 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13）
    p.style.setProperty('--pc', `var(--p${c}, ${SEAT_COLORS[c % SEAT_COLORS.length]})`);
    return p;
  };
  const row = document.createElement('div');
  if (ids.length === 2) {
    row.className = 'vs-row';
    const vs = document.createElement('div');
    vs.className = 'vs-mark';
    vs.textContent = 'VS';
    row.append(plate(ids[0], 0), vs, plate(ids[1], 1));
    row.firstChild.classList.add(swap ? 'sw-l' : 'l'); // 席が入れ替わったら、前の席（反対側）から入れ替わって入る
    row.lastChild.classList.add(swap ? 'sw-r' : 'r');
  } else {
    row.className = 'vs-grid';
    ids.forEach((id, i) => {
      const p = plate(id, i);
      p.style.animationDelay = `${i * 80}ms`;
      row.append(p);
    });
  }
  box.append(row);
  if (swap?.note) {
    const note = document.createElement('div');
    note.className = 'vs-note';
    note.textContent = swap.note;
    box.append(note);
  }
  const t1 = (ids.length === 2 ? 1000 : 1000 + ids.length * 40) + (swap?.note ? 900 : swap ? 300 : 0); // 一言を読む間だけ長く
  showFx(box, t1 + 550);
  introUntil = Date.now() + t1 + 550; // 札を配るのは顔合わせが消えるころから（flyPlay）
  // 顔合わせ・配っている間にどこかを押したら、配る動きもすぐ終える（待っている間の手札の札は山札の所に重なっていて、山札を押すつもりで札を押してしまうため）。
  // 押した指の pointerdown の当たり先はもう決まっていて、指を離す所（本来の山札）と違うので、その1回の押しで札が出ることはない
  const skipDeal = () => {
    document.removeEventListener('pointerdown', skipDeal, true);
    introUntil = 0;
    flights.clear(); // 描き直された札が、配る動きの続きを始めないように
    for (const g of document.querySelectorAll('.fly-ghost')) g.remove(); // ほかの人の席へ飛ぶ札の写し（dealToOthers）も消す
    for (const e of el('board')?.querySelectorAll('[data-fly-deal]') ?? []) {
      for (const a of e.getAnimations()) try { a.finish(); } catch { /* 終わりの無い動き */ }
    }
  };
  document.addEventListener('pointerdown', skipDeal, true);
  setTimeout(() => document.removeEventListener('pointerdown', skipDeal, true), t1 + 550 + 2500); // 配り終わるまで（顔合わせのあとも1〜2秒配っている）
  setTimeout(() => {
    if (!box.isConnected) return; // 押して飛ばした
    const go = document.createElement('div');
    go.className = 'vs-go';
    go.textContent = 'スタート！';
    box.replaceChildren(go);
  }, t1);
}

/* ---------- 札や駒がすっと動く（2026-11-06 の UI・演出・アニメーションの案。本人が決めたことは card-games.md・shogi.md） ---------- */
// ゲームは、動かしたい物に data-fly="鍵" を付けて描く（動く前と後で同じ物に同じ鍵。手札の札なら札の名前、将棋の駒ならマスなど）。
// 新しく届いた手で描き直したとき、前の画面で同じ鍵の物があった所から、今の所へすっと動かす（FLIP: 今の所に描いてから、前の所までずらして戻す）。
// 前の画面に同じ鍵の物が無いときは、data-fly-from="鍵" の所から飛んでくる。出どころの鍵は data-fly（動かす物）か data-fly-src（出どころになるだけの物。
// 山札・ほかの人の席の札の印など）で付け、前の画面に無ければ今の画面の物を使う。"@center" は盤のまん中あたり。
//   data-fly-turn … 飛んでくるとき、裏から表に返りながら来る（裏の模様は style.css の .fly-turn::after）
//   data-fly-spin="180" … 飛んでくるとき、この角度だけ回った向きから始める（取った駒が持ち駒になるとき、向きが変わるため）
//   data-fly-slide … 弧を描かずにまっすぐ滑る（盤の上で指した駒）
//   data-fly-base … その物にふだんから付いている transform（将棋の相手の駒の rotate(180deg)。動きの間も消さないように）
//   data-fly-deal … 対局の始め（まだ手が無い最初の描画）に、data-fly-from の所から配る（手札と最初の場の札）
// 同じ所から何枚も飛ぶときは少しずつずらす。始まりの顔合わせ（introFx）が出ている間は、配るのを待つ（その間は札が山に重なって見える）。
// 前の場所は render の最初（描き直す前）に、今の場所は描き終えてから測る（描き直しの途中で長さを測らない決まり）。動きを減らす設定の端末では動かさない。
// 動いている途中で手の届かない描き直し（つながりの表示など）があったら、作り直された物を続きから動かす（flights に始めた時刻を覚えておく）
let flyDealNow = false; // この描画で配る（renderPage が対局の始めに立てる）
let introUntil = 0; // 始まりの顔合わせが消える時刻（introFx が入れる）
const flights = new Map(); // 鍵 → { from, t0, delay, dur, via, turn, spin, slide }
const flown = new WeakSet(); // 動かしている物（描き直されていない物に続きを重ねないように）
const flyKey = (e) => e.dataset.fly ?? e.dataset.flySrc;
// 盤の左上からの位置。中心は見えている所（動いている途中の物は、途中の所から続けるため）、大きさは transform を含めない大きさ
// （始まったばかりの pop などで縮んだ大きさを測らないように。pop は中心を変えずに大きさだけ変えるので、中心は見えている所のままでよい）
function flyBox(e, B) {
  const r = e.getBoundingClientRect();
  const w = e.offsetWidth ?? r.width;
  const h = e.offsetHeight ?? r.height;
  return { x: r.left + r.width / 2 - w / 2 - B.left, y: r.top + r.height / 2 - h / 2 - B.top, w, h };
}
function flySnap() {
  if (!S || lessMotion() || S.shownKey !== S.gameId + ':' + S.round || !(S.moves.length > S.shownLen)) return null;
  const board = el('board');
  const list = board?.querySelectorAll('[data-fly], [data-fly-src]');
  if (!list?.length) return null;
  const B = board.getBoundingClientRect();
  const m = new Map();
  for (const e of list) {
    const b = flyBox(e, B);
    if (!m.has(flyKey(e)) && (b.w || b.h)) m.set(flyKey(e), b);
  }
  return m;
}
function flyPlay(before, deal) {
  const board = el('board');
  const list = board?.querySelectorAll(deal ? '[data-fly-deal]' : '[data-fly]');
  if (!list?.length) return;
  const B = board.getBoundingClientRect();
  const here = new Map();
  const at = (key) => {
    if (key === '@center') return { x: B.width / 2 - 22, y: Math.min(B.height * 0.4, 260), w: 44, h: 62 };
    if (!here.has(key)) {
      const x = [...board.querySelectorAll('[data-fly], [data-fly-src]')].find((y) => flyKey(y) === key);
      here.set(key, x ? flyBox(x, B) : null);
    }
    return here.get(key);
  };
  const wait = deal ? Math.max(0, introUntil - Date.now() - 250) : 0;
  const count = new Map();
  const t0 = Date.now();
  // 同じ所から飛ぶ札が多いとき（ポーカーを10人で配る など）は間を詰めて、全部で1.1秒ほどに収める（2026-11-09。Claude の判断）
  const total = new Map();
  for (const e of list) {
    const via = !deal && before.get(e.dataset.fly) ? null : e.dataset.flyFrom;
    if (via) total.set(via, (total.get(via) ?? 0) + 1);
  }
  const gap = (via) => Math.min(deal ? 70 : 90, 1100 / Math.max(1, total.get(via) ?? 1));
  for (const e of list) {
    let from = deal ? null : before.get(e.dataset.fly);
    const via = from ? null : e.dataset.flyFrom;
    if (via) from = before.get(via) ?? at(via);
    if (!from) continue;
    const k = via ? (count.get(via) ?? 0) : 0;
    if (via) count.set(via, k + 1);
    const turn = !!via && e.hasAttribute('data-fly-turn');
    const slide = e.hasAttribute('data-fly-slide');
    const f = {
      from, t0, delay: wait + k * gap(via), dur: slide ? 300 : via ? (turn ? 470 : 400) : 280,
      via: !!via, turn, spin: via ? Number(e.dataset.flySpin) || 0 : 0, slide,
    };
    if (flyAnim(e, f, flyBox(e, B))) flights.set(e.dataset.fly, f);
  }
  if (deal) dealToOthers(board, B, list, wait, at, t0);
}

// 札を配る動き（2026-11-09 本人の選択。card-games.md「札を配る動き」。シャッフルの動きは付けない）: 対局の始めに、ほかの人の席
// （data-fly-src="opp:席"。札の枚数を出している所）へも、自分の手札と同じ出どころから裏向きの札を飛ばす。
// ゲームの画面は変えず、裏向きの札の形をした物を画面に重ねて飛ばし、着いたら消す（手の一覧にも局面にも関わらない）。
// Claude の判断: 1人に飛ばすのは自分の手札の枚数（7枚まで）。自分の札と交互に飛ぶよう、自分の札の間（gap）を席の数で割ってずらす。
// 札の見た目は自分の手札がトランプ（pcard）ならトランプの裏、ほかはいろあわせの裏（ccard）
function dealToOthers(board, B, list, wait, at, t0) {
  const hand = [...list].filter((e) => e.hasAttribute('data-fly-turn') && e.dataset.flyFrom);
  if (!hand.length) return;
  const via = hand[0].dataset.flyFrom;
  const from = at(via);
  const seats = [...board.querySelectorAll('[data-fly-src^="opp:"]')].filter((s) => s.getBoundingClientRect().width);
  if (!from || !seats.length) return;
  const per = Math.min(hand.length, 7);
  const step = Math.min(70, 1100 / Math.max(1, hand.length)) / (seats.length + 1);
  const trump = hand[0].classList.contains('pcard');
  seats.forEach((s, j) => {
    const r = s.getBoundingClientRect();
    const w = 24, h = 34;
    const to = { x: r.left - B.left + r.width / 2 - w / 2, y: r.top - B.top + r.height / 2 - h / 2, w, h };
    for (let k = 0; k < per; k++) {
      const g = document.createElement('div');
      g.className = (trump ? 'pcard back' : 'ccard back') + ' fly-ghost';
      g.setAttribute('aria-hidden', 'true');
      Object.assign(g.style, { position: 'fixed', left: B.left + to.x + 'px', top: B.top + to.y + 'px', width: w + 'px', height: h + 'px', margin: '0', pointerEvents: 'none' });
      document.body.append(g);
      const delay = wait + k * Math.min(70, 1100 / Math.max(1, hand.length)) + (j + 1) * step;
      const f = { from, t0, delay, dur: 400, via: true, turn: false, spin: 0, slide: false };
      flyAnim(g, f, to);
      g.style.opacity = '0';
      setTimeout(() => { g.style.opacity = ''; }, delay); // 飛び立つまでは見せない（fill: backwards は始まる前も最初の形を見せるが、念のため）
      setTimeout(() => g.remove(), delay + f.dur + 40);
    }
  });
}
function flyResume() {
  const board = el('board');
  if (!board || lessMotion()) { flights.clear(); return; }
  const B = board.getBoundingClientRect();
  const now = Date.now();
  for (const [key, f] of flights) {
    const ago = now - f.t0;
    if (ago >= f.delay + f.dur) { flights.delete(key); continue; }
    const e = [...board.querySelectorAll('[data-fly]')].find((x) => x.dataset.fly === key);
    if (e && !flown.has(e)) flyAnim(e, { ...f, delay: f.delay - ago }, flyBox(e, B));
  }
}
function flyAnim(e, f, to) {
  let dx = f.from.x + f.from.w / 2 - (to.x + to.w / 2);
  let dy = f.from.y + f.from.h / 2 - (to.y + to.h / 2);
  const near = f.via ? 2 : 3; // 同じ物が2〜3px ずれただけ（上の段の高さが少し変わったなど）では動かさない
  if (Math.abs(dx) < near && Math.abs(dy) < near && !f.spin) return false;
  // 回した入れ物の中の物（麻雀の卓で、ほかの人の席は席ごと回して置いてある）は、ずらす向きもその入れ物の向きに直す。
  // 入れ物に data-fly-rot="回した角度" を付ける（2026-11-09。付けていない物は今までどおり）
  const rot = Number(e.closest?.('[data-fly-rot]')?.dataset.flyRot) || 0;
  if (rot) {
    const a = (-rot * Math.PI) / 180;
    [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }
  // 前の大きさから始める（手札より大きく出る場の札・小さな印から飛ぶ札）。出どころが入れ物（場・山）のときは大きくなりすぎないよう 1.2 倍まで
  const s0 = Math.min(1.2, Math.max(0.4, f.from.w / (to.w || 1)));
  const lift = f.via && !f.slide ? Math.min(28, Math.hypot(dx, dy) * 0.15) : 0;
  const tail = e.dataset.flyBase ? ' ' + e.dataset.flyBase : '';
  const k = (x, y, s, r, sx) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${r}deg) scaleX(${sx})${tail}`;
  if (getComputedStyle(e).position === 'static') e.style.position = 'relative'; // 前に重ねる（z-index を効かせる）ため
  e.style.zIndex = '30';
  if (f.turn) {
    e.classList.add('fly-turn');
    e.style.setProperty('--fly-ms', f.dur + 'ms');
    e.style.setProperty('--fly-at', f.delay + 'ms');
  }
  flown.add(e);
  // 選んだ駒が浮く（2026-11-09。data-fly-lift。将棋・はさみ将棋の盤の駒）: 浮いたまま（少し上で少し大きく）滑ってきて、着いたら沈んで置かれる
  const up = f.slide && e.hasAttribute('data-fly-lift') ? 6 : 0;
  e.animate(up ? [
    { transform: k(dx, dy - up, s0 * 1.12, 0, 1) },
    { transform: k(0, -up, 1.12, 0, 1), offset: 0.7 },
    { transform: k(0, 1, 0.97, 0, 1), offset: 0.88 },
    { transform: k(0, 0, 1, 0, 1) },
  ] : [
    { transform: k(dx, dy, s0, f.spin, 1) },
    { transform: k(dx / 2, dy / 2 - lift, ((s0 + 1) / 2) * (f.via && !f.slide ? 1.06 : 1), f.spin / 2, f.turn ? 0 : 1), offset: 0.5 },
    { transform: k(0, 0, 1, 0, 1) },
  ], { duration: up ? f.dur + 80 : f.dur, delay: f.delay, easing: 'cubic-bezier(.3, .7, .3, 1)', fill: 'backwards' });
  // 終わりは時間で決める（画面が隠れていて動きの終わりの知らせが遅れても、前に重ねたままにならないように）
  setTimeout(() => { e.style.zIndex = ''; e.classList.remove('fly-turn'); }, Math.max(0, f.delay + f.dur) + 60);
  return true;
}

// 新しく打たれた手の音。何手かまとめて届いたときは最後の手の音だけ。対局が終わったら勝ち負けの音。
// 音はゲームの sound(前の局面, 今の局面, 手, 自分の番号) が名前で返す（無ければ盤のゲームは place、カードゲームは card）
function moveSound(game, st, res, prevLen, mine, hold = 0) {
  const before = replay({ ...S, moves: S.moves.slice(0, prevLen) });
  if (!before) return;
  const me = myPlayer();
  const m = S.moves[S.moves.length - 1];
  if (res) {
    if (game.result(before)) return;
    let said = null; // 麻雀の最後の局の「ロン！」など
    try { said = game.sound?.(before, st, m, me); } catch { /* 終局の手に音の決めごとが合わなくても、勝ち負けの音は鳴らす */ }
    const end = endSound(res, me);
    // 決め手のスロー（slowFinish）のときは、石が着いたときに置いた音、一拍おいてから勝ち負けの音・判子（押して飛ばせばすぐ）
    if (hold) slowAt(SLOW_LAND, () => play(said && !isVoice(said) ? said : 'place'), false);
    slowAt(hold, () => {
      if (isVoice(said)) { play(said); setTimeout(() => play(end), 700); } else play(end);
      if (end === 'win' || end === 'lose') haptic(end);
      if (end === 'win') confetti(); // 勝ちの音を鳴らす画面には紙吹雪
      endStamp(game, res, me, end, isVoice(said) ? 700 : 0); // 決着の判子（勝ち負けの音と一緒に）
      greet('end', isVoice(said) ? 1900 : 1200);
    });
    return;
  }
  // 手が2つ以上まとめて届いたとき、前は最後の1手の音だけ鳴らしていたので、最後がほかの人の「鳴らさない」手だと無音になった（2026-10-26 本人の声「効果音がならないゲームがある」）。
  // 新しい手を後ろから見て、最初に音のある手の音を1つ鳴らす（重ねると、うるさいので1つ）
  let name = null;
  const steps = [];
  let cur = before;
  for (let i = prevLen; i < S.moves.length; i++) {
    const nx = game.apply(cur, S.moves[i]);
    if (!nx) break;
    steps.push([cur, nx, S.moves[i]]);
    cur = nx;
  }
  for (let k = steps.length - 1; k >= 0 && !name; k--) {
    const [a, b, mm] = steps[k];
    try { name = game.sound ? game.sound(a, b, mm, me) : game.multi ? 'card' : 'place'; } catch { name = null; }
  }
  if (name) play(name);
  // 技の名前（2026-11-06）: 音と同じく新しい手を後ろから見て、最初に技の名前のある手の名前を1つ出す（ゲームの cutin(前, 後, 手, 自分の番号)）
  for (let k = steps.length - 1; k >= 0 && game.cutin; k--) {
    const [a, b, mm] = steps[k];
    let c = null;
    try { c = game.cutin(a, b, mm, me); } catch { c = null; }
    if (c) { cutInFx(c); break; }
  }
  if (mine && !replayNow && S.mode === 'online' && !game.realtime && !canMove(game, before, null)) {
    const waited = Date.now() - S.waitFrom;
    if (waited > TURN_PING_MS) {
      // 待つ間に自分が打った・部屋を出た・次の対局へ進んだ・待ったで戻ったら出さない。ほかの人の手は数えない（ポーカーの「見た」のように何人も同時に押す場面で、
      // ほかの人が先に押しても自分の番の知らせは出す）。盤のゲームの手には p が無いが、自分の番の間にほかの人は打てないので、増えた手は自分の手と見る
      const at = [S, timerKey(), S.moves.length, myPlayer()];
      const still = () => S === at[0] && timerKey() === at[1] && S.moves.length >= at[2] && !S.moves.slice(at[2]).some((m) => !game.multi || m.p === at[3]);
      setTimeout(() => { if (still()) { play('turn'); haptic('turn'); sayTurn(); } }, 300);
      setTimeout(() => { if (still()) turnFx(); }, Math.max(300, cutUntil - Date.now())); // あなたのターンの帯（2026-11-06）。技の名前が出ていれば、そのあとに
    }
  }
}

/* ---------- 番が来たら名前を読み上げ・あいさつ（2026-10-08 の23回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// 番が来たら名前を読み上げ: オンラインで TURN_PING_MS（3秒。2026-11-06 に5秒から）より長く待ったあとに自分の番が来たとき（「番が来た」音と同じとき）、音のあとに「○○さんのターン」と言う。
//   読むのは自分の端末に入れた自分の名前（マーク・🔰 は付けない）。名前が空なら「あなたのターン」（2026-10-26 本人の依頼で「番です」から替えた）。
// あいさつ: 対局の始め（手がまだ無い局面を初めて描いたとき）に「よろしくお願いします」、決着した手が届いたときに勝ち負けの音のあとで「ありがとうございました」。
//   画面の下に一言（toast）を出して読み上げる。オンラインも同じ画面の対局も。各自の端末が自分で出す（送らない）。
//   途中から入った・再読み込みで手がある局面を開いたときは、始めのあいさつは出さない。エアホッケーは main.js で描かないので出ない。
// 声は 🔇 なら出さない（一言は出す）。Claude の判断: 「番が来た」音は残し、そのあとに声を足した（声が出ない端末でも気づけるように）。
function sayTurn() {
  const name = myName();
  // 読み上げだけ「たーん」とひらがなで書く（カタカナの「ターン」を「トーン」と読む声があった。2026-10-30 本人の報告）
  speak(name ? `${name}さんの たーん` : 'あなたの たーん', 'turn-voice');
}

function greet(kind, delay = 0) {
  setTimeout(() => {
    toast(`🙇 ${GREET[kind]}`);
    speak(GREET[kind], 'greet');
  }, delay);
}

// render から毎回呼ぶ。対局（ゲーム・回・種）ごとに、手がまだ無いところを初めて描いたときだけ始めのあいさつ
function greetStart(res, game) {
  const key = timerKey();
  if (S.greetKey === key) return;
  S.greetKey = key;
  if (!S.moves.length && !res) {
    greet('start', 300);
    introFx(game);
  }
}

function renderLobby(game) {
  const status = el('status');
  const board = el('board');
  const controls = ctl();
  status.innerHTML = S.isHost
    ? (allReady()
      ? '<div class="status-main">待合室</div><div class="status-sub">✋ 全員の準備ができました。「始める」を押してください。</div>'
      : '<div class="status-main">待合室</div><div class="status-sub">友だちがそろったら「始める」を押してください。<br>上の「招待する」で部屋のリンクを送れます。</div>')
    : '<div class="status-main">待合室</div><div class="status-sub">部屋を作った人が始めるのを待っています…<br>準備ができたら「準備OK」を押してください。</div>';

  const { humans, watchers, cpus, seats, max } = lineup(game);
  const row = (text, cls = '', m = '') => `<li class="${cls}"${m ? ` data-m="${esc(m)}"` : ''}>${text}</li>`;
  const short = game.noCpu && humans.length + cpus < game.minPlayers;
  let html = `<p class="lobby-note">${seats ? `${seats}人` : playersText(game)}で遊べます。${game.noCpu ? (cpus ? `CPU は${cpus}人だけ入ります。` : 'CPU は入れません。') : '足りない分は CPU が入ります。'}</p><ul class="lobby-list">`;
  for (const id of humans) {
    const marks = [id === S.myId ? 'あなた' : '', id === S.members[0] ? '部屋を作った人' : ''].filter(Boolean).join('・');
    html += row(`${esc(nameOf(id))}${marks ? ` <small>（${marks}）</small>` : ''}`, '', id);
  }
  for (let i = 1; i <= cpus; i++) html += row(`CPU${i}`, 'cpu');
  html += '</ul>';
  const over = watchers.filter((id) => !S.bench?.includes(id));
  const benched = watchers.filter((id) => S.bench?.includes(id));
  if (over.length) html += `<p class="lobby-note">観戦: ${over.map((id) => esc(nameOf(id))).join('、')}（${max}人までのため）</p>`;
  if (benched.length) html += `<p class="lobby-note">観戦: ${benched.map((id) => esc(nameOf(id))).join('、')}（観戦に回った人）</p>`;
  html += short
    ? `<p class="lobby-total">あと${game.minPlayers - humans.length - cpus}人そろうと始められます</p>`
    : `<p class="lobby-total">${humans.length + cpus}人で遊びます</p>`;
  board.className = 'board lobby';
  board.innerHTML = html;
  memberFx(board.querySelector('.lobby-list'));
  board.prepend(lobbyGameCard(game));
  if (S.isHost && S.members.length > 1) board.append(benchPanel(game));
  const tally = tallyLine();
  if (tally) board.append(tally);
  const hist = historyLine();
  if (hist) board.append(hist);
  appendLobbyExtras(board);
  if (game.settings) board.append(rulesPanel(game));

  if (!S.isHost) { controls.append(readyButton()); return; }
  const start = makeButton('始める', startRound);
  start.disabled = short;
  if (allReady() && !short) start.classList.add('ready-go');
  if (game.noCpu || seats) { controls.append(start, gameSelect(), rouletteButton()); return; }
  // 押したボタンが指の下に残るようにする（一覧が1行のびて、下のボタンがずれていた。2026-10-30 本人の依頼）
  const setCpus = (n, key) => keepPlace(key, () => { S.cpus = n; saveRoom(); sendState(); render(); });
  const step = lineup(game).teams || 1; // チームの人数をそろえるゲームはチームの数ずつ（2人ずつ・三つ巴は3人ずつ）
  const minus = makeButton('CPU を減らす', () => setCpus(cpus - step, 'cpu-minus'), 'secondary');
  minus.dataset.keep = 'cpu-minus';
  minus.disabled = humans.length + cpus - step < game.minPlayers || cpus < step;
  const plus = makeButton('CPU を増やす', () => setCpus(cpus + step, 'cpu-plus'), 'secondary');
  plus.dataset.keep = 'cpu-plus';
  plus.disabled = humans.length + cpus + step > max;
  controls.append(minus, plus, start, gameSelect(), rouletteButton());
}

function renderBoardLobby(game) {
  const n = boardSeats(S.gameId, S.rules);
  const status = el('status');
  const board = el('board');
  const controls = ctl();
  status.innerHTML = S.isHost
    ? (game.live
      ? `<div class="status-main">待合室</div><div class="status-sub">対戦する${n}人を選んで「始める」を押してください。${cpuPickable(game) ? '人が足りなければ CPU を選べます。' : ''}<br>オンラインは試作です。</div>`
      : `<div class="status-main">待合室</div><div class="status-sub">${n > 2 ? '打つ順番に人を選んで' : '先手と後手を選んで'}「始める」を押してください。<br>${allReady() ? '✋ 全員の準備ができました。' : '相手がいなければ CPU と対局できます。'}</div>`)
    : '<div class="status-main">待合室</div><div class="status-sub">部屋を作った人が始めるのを待っています…<br>準備ができたら「準備OK」を押してください。</div>';
  board.className = 'board lobby';
  board.innerHTML = `<p class="lobby-note">${n}人で対局します。ほかの人は観戦します。</p>`;
  // 部屋の人の名前の札（2026-11-10。人が入ったら札が飛び込む（memberFx）ために、盤のゲームの待合室にも並べた）
  const faces = document.createElement('ul');
  faces.className = 'lobby-faces';
  faces.setAttribute('aria-label', '部屋の人');
  for (const id of S.members) {
    const li = document.createElement('li');
    li.dataset.m = id;
    li.textContent = nameOf(id) + (id === S.myId ? '（あなた）' : '');
    faces.append(li);
  }
  board.append(faces);
  memberFx(faces);
  board.prepend(lobbyGameCard(game));
  const pick = boardPick();
  const colsNext = seatColorsFor(S.gameId, pick);
  const label = (v) => (v === 'cpu' ? 'CPU' : nameOf(v) + (v === S.myId ? '（あなた）' : ''));
  const list = document.createElement('div');
  list.className = 'lobby-pick';
  pick.forEach((_, i) => {
    const row = document.createElement('label');
    const head = document.createElement('span');
    const c = colsNext?.[i] ?? i; // 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13）: 次の対局でこの席の人が使う色
    head.innerHTML = `<b class="pl p${c}">${esc(game.players[c])}</b>${game.live ? '' : seatNote(game, i, n)}`;
    row.append(head);
    if (S.isHost) {
      const sel = document.createElement('select');
      for (const v of cpuPickable(game) ? [...S.members, 'cpu'] : S.members) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = label(v);
        opt.selected = v === pick[i];
        sel.append(opt);
      }
      sel.onchange = () => {
        const next = pick.slice();
        next[i] = sel.value;
        const j = next.findIndex((v, k) => k !== i && v === sel.value);
        if (sel.value !== 'cpu' && j >= 0) next[j] = pick[i]; // 同じ人をほかの席にも選んだら入れ替える
        // 席から外した人は観戦に回した人として覚え、ほかのゲームに替えても観戦のまま。席に選び直したら外す（2026-11-03 本人の依頼）
        const out = pick.filter((v) => v !== 'cpu' && !next.includes(v));
        S.bench = [...new Set([...(S.bench ?? []).filter((v) => !next.includes(v)), ...out])];
        S.pick = next;
        saveRoom();
        sendState();
        render();
      };
      row.append(sel);
    } else {
      const name = document.createElement('b');
      name.textContent = label(pick[i]);
      row.append(name);
    }
    list.append(row);
  });
  board.append(list);
  if (S.isHost && !game.live) board.append(lotButton(game, pick));
  const watchers = S.members.filter((id) => !pick.includes(id));
  if (watchers.length) {
    const w = document.createElement('p');
    w.className = 'lobby-note';
    w.textContent = '観戦: ' + watchers.map(nameOf).join('、');
    board.append(w);
  }
  const tally = tallyLine();
  if (tally) board.append(tally);
  const hist = historyLine();
  if (hist) board.append(hist);
  appendLobbyExtras(board);
  if (!game.live) board.append(stayPanel());
  if (cpuLevels(game)) board.append(cpuAutoPanel(game));
  board.append(ptsPanel());
  if (game.settings) board.append(rulesPanel(game));
  if (!S.isHost) { controls.append(readyButton()); return; }
  const start = makeButton('始める', startRound);
  if (allReady()) start.classList.add('ready-go');
  const people = pick.filter((v) => v !== 'cpu');
  if (game.live && ((pick.includes('cpu') && !cpuPickable(game)) || new Set(people).size !== people.length)) { // CPU を選べないときは人がそろうまで始められない
    start.disabled = true;
    board.insertAdjacentHTML('beforeend', '<p class="lobby-total">友だちが部屋に入ると始められます</p>');
  }
  controls.append(start, gameSelect(), rouletteButton());
}

/* ---------- 先手をくじで決める（2026-10-08。22回目の案。Claude が出した15の案から本人が推奨どおり選んだ） ---------- */
// Claude の判断: 盤のゲームの待合室で、ホストが「🎲 先手をくじで決める」（3人以上は「順番を…」）を押すと、いま選んである顔ぶれ（CPU も）はそのままで、
// 席の順番だけをまぜる。何度でも引き直せる。結果はいつもの席の選び方と同じく pick に入れて state で送り、くじの合図（type: 'lot'。まぜた pick 付き）も
// 送りっぱなしにして、全員の画面に結果を一言（toast）で出す。エアホッケーは席が打つ順番でないので出さない。席の顔ぶれが1つ（CPU だけ）なら押せない。
function lotButton(game, pick) {
  const b = makeButton(pick.length > 2 ? '🎲 順番をくじで決める' : `🎲 ${game.keepColor ? '先手' : game.players[0]}をくじで決める`, () => {
    const next = pick.slice();
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    S.pick = next;
    saveRoom();
    sendState();
    send({ type: 'lot', gameId: S.gameId, pick: next });
    render();
    lotToast(game, next);
  }, 'secondary small');
  b.classList.add('lobby-lot');
  b.disabled = new Set(pick).size < 2;
  return b;
}

function lotToast(game, pick) {
  const who = (v) => (v === 'cpu' ? 'CPU' : v === S.myId ? 'あなた' : nameOf(v));
  toast(pick.length > 2 ? '🎲 くじの結果: ' + pick.map(who).join(' → ') : `🎲 くじの結果: ${game.keepColor ? '先手' : game.players[0]}は ${who(pick[0])}`);
}

// くじの合図を受け取った（ホストからだけ・待合室の間だけ。中身は部屋の人か cpu のときだけ使う）
function onLot(msg) {
  const game = GAMES[S.gameId];
  if (S.isHost || !S.members.length || msg.from !== S.members[0] || S.order || msg.gameId !== S.gameId || !game || game.multi || game.live) return;
  if (!Array.isArray(msg.pick) || msg.pick.length !== boardSeats(S.gameId, S.rules) || !msg.pick.every((v) => v === 'cpu' || S.members.includes(v))) return;
  lotToast(game, msg.pick);
}

// 勝ち残りの付け外し（ホストだけ。ほかの人には付いているときだけ出す）
/* ---------- CPU の強さを自動で合わせる（2026-10-07 本人の決定）: 盤のゲームのもう一回で、人が CPU に勝ったら1段強く、負けたら1段弱く ---------- */
// Claude の判断: ホストが待合室で付け外しする（部屋の設定。S.cpuAuto）。詳細設定「CPU の強さ」（key cpu）を持つ盤のゲームだけ。
// 決着の勝った人に人がいて CPU がいなければ1段上げ、CPU がいて人がいなければ1段下げる。引き分け・人どうし・CPU どうしは変えない。
// 変えた強さは詳細設定に入れる（全員の画面と「いまのルール」に出る）。エアホッケーは結果が main.js を通らないので変わらない。
function cpuLevels(game) {
  if (!game || game.multi || game.live) return null;
  const x = (game.settings ?? []).find((t) => t.key === 'cpu');
  return x?.choices ? x.choices.map(([v]) => v) : null;
}
function adjustCpu(game) {
  const levels = cpuLevels(game);
  if (!S.cpuAuto || !levels || S.mode !== 'online' || !S.order) return;
  const st = replay(S);
  const res = st && game.result(st);
  if (!res) return;
  const won = winnersOf(res).map((p) => S.order[p]);
  const humanWon = won.some((id) => !isCpu(id));
  const cpuWon = won.some((id) => isCpu(id));
  if (humanWon === cpuWon || !S.order.some(isCpu) || S.order.every(isCpu)) return;
  const cur = rulesOf(game.id, S.rules).cpu;
  const i = levels.indexOf(cur);
  const j = Math.max(0, Math.min(levels.length - 1, i + (humanWon ? 1 : -1)));
  if (i < 0 || j === i) return;
  S.rules = { ...S.rules, [game.id]: { ...rulesOf(game.id, S.rules), cpu: levels[j] } };
  rememberRules();
  const name = game.settings.find((t) => t.key === 'cpu').choices[j][1];
  toast(`🤖 CPU の強さを「${name}」にしました`);
}
function cpuAutoPanel() {
  const box = document.createElement('div');
  box.className = 'lobby-stay';
  if (!S.isHost) {
    if (S.cpuAuto) box.innerHTML = '<p class="lobby-note">🤖 CPU の強さを自動で合わせます（人が勝つと強く、負けると弱く）</p>';
    return box;
  }
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!S.cpuAuto;
  input.onchange = () => { S.cpuAuto = input.checked; saveRoom(); sendState(); render(); };
  const text = document.createElement('span');
  text.innerHTML = '<b>🤖 CPU の強さを自動で合わせる</b> <small>もう一回のとき、人が CPU に勝ったら1段強く、負けたら1段弱くします</small>';
  label.append(input, text);
  box.append(label);
  return box;
}

/* ---------- 成績表を順位で点（2026-10-24 本人の決定。28回目の案）: ホストが待合室で選ぶと、成績表を点の多い順に並べ、お開きの表彰も点で決める ---------- */
// 点はその対局で自分より下の順位になった人の数（games/index.js の seatPoints）。部屋の設定（S.ptsMode。state の ptsMode で送る）で、最初は勝った回数（今まで）。
// Claude の判断: 点は選んでいなくてもいつも数える（途中で切り替えても点がそろっているように）。ゲームを変えても残る（勝ち残りと同じ）。
function ptsPanel() {
  const box = document.createElement('div');
  box.className = 'lobby-stay';
  const about = '<small>その対局で自分より下になった人の数が点です（4人で1位なら3点・2位なら2点、2人で勝てば1点、引き分けは0点）</small>';
  if (!S.isHost) {
    if (S.ptsMode) box.innerHTML = `<p class="lobby-note">🏅 成績表は順位で点を付けています ${about}</p>`;
    return box;
  }
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!S.ptsMode;
  input.onchange = () => { S.ptsMode = input.checked; saveRoom(); sendState(); render(); };
  const text = document.createElement('span');
  text.innerHTML = `<b>🏅 成績表を順位で点にする</b> ${about}`;
  label.append(input, text);
  box.append(label);
  return box;
}

function stayPanel() {
  const box = document.createElement('div');
  box.className = 'lobby-stay';
  if (!S.isHost) {
    if (S.stay) box.innerHTML = '<p class="lobby-note">👑 勝ち残り: もう一回では、負けた人が観戦の人と交代します</p>';
    return box;
  }
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!S.stay;
  input.onchange = () => { S.stay = input.checked; saveRoom(); sendState(); render(); };
  const text = document.createElement('span');
  text.innerHTML = '<b>👑 勝ち残り</b> <small>もう一回では、負けた人が観戦の人と交代します（勝った人は続けて打てます）</small>';
  label.append(input, text);
  box.append(label);
  return box;
}

function rulesPanel(game) {
  const det = document.createElement('details');
  det.className = 'lobby-rules';
  det.open = !!S.rulesOpen;
  det.ontoggle = () => { S.rulesOpen = det.open; };
  const sum = document.createElement('summary');
  sum.textContent = S.isHost ? '詳細設定（ルールを選ぶ）' : '詳細設定（部屋を作った人が選びます）';
  det.append(sum);
  const cur = rulesOf(S.gameId, S.rules);
  const set = (key, value) => {
    if (key === 'players') S.playersSet = { ...S.playersSet, [S.gameId]: true }; // もう部屋の人数に合わせない（autoPlayers）
    S.rules = { ...S.rules, [S.gameId]: { ...cur, [key]: value } };
    rememberRules();
    saveRoom();
    sendState();
    render();
  };
  const luck = luckSettings(game);
  if (S.isHost && luck.length) {
    const btn = makeButton('🎲 おまかせ（ルールを抽選）', () => {
      const next = { ...cur };
      for (const x of luck) {
        const opts = x.choices ? x.choices.map(([c]) => c) : [true, false];
        next[x.key] = opts[Math.floor(Math.random() * opts.length)];
      }
      S.rules = { ...S.rules, [S.gameId]: next };
      S.rulesOpen = true;
      rememberRules();
      saveRoom();
      sendState();
      render();
      toast('ルールを抽選しました。もう一度押すと引き直せます');
    }, 'secondary small');
    btn.classList.add('luck-btn');
    det.append(btn);
  }
  if (S.isHost && changedRules(game).length) {
    const back = makeButton('↺ 最初の設定に戻す', () => {
      const { [S.gameId]: _, ...rest } = S.rules;
      S.playersSet = { ...S.playersSet, [S.gameId]: false };
      S.rules = rest;
      rememberRules();
      saveRoom();
      sendState();
      render();
      toast('このゲームの詳細設定を最初に戻しました');
    }, 'secondary small');
    back.classList.add('luck-btn');
    det.append(back);
  }
  for (const x of game.settings) {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.innerHTML = `<b>${esc(x.label)}</b> <small>${esc(x.desc)}</small>`;
    if (x.choices) {
      const sel = document.createElement('select');
      x.choices.forEach(([value, name], i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = name;
        opt.selected = value === cur[x.key];
        sel.append(opt);
      });
      sel.disabled = !S.isHost;
      sel.onchange = () => set(x.key, x.choices[Number(sel.value)][0]);
      label.className = 'choice';
      label.append(text, sel);
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cur[x.key];
      cb.disabled = !S.isHost;
      cb.onchange = () => set(x.key, cb.checked);
      label.append(cb, text);
    }
    det.append(label);
  }
  return det;
}

// 人が入ったら札が飛び込む（2026-11-10 本人の選択。room.md「演出・アニメーションの3回目」）: 待合室の人の札（data-m に人の id）のうち、
// 入ったばかりの人の札は上から落ちて収まり、出た人は 👋 と手を振ってから消える（本人の指示で短く。0.55秒）。
// 待合室は何度も描き直すので、入った・出た時刻を覚え（noteMembers。描き直しのたびに部屋の人を見比べる）、経過を animation-delay に入れて続きから動かす。
// 出た人の札は覚えた名前で写しを足し、時間がたったら消す（部屋の人には入っていないので、次の描き直しでは作られない）。
// Claude の判断: 部屋に入った最初の描き直しでは動かさない（もともといた人まで落ちてこないように）。入り直し（replaceMember）も出て入った形で動く
const MEMBER_FX_MS = 550;
const memberSeen = { room: null, ids: [], at: {}, left: [] };
function noteMembers() {
  const now = Date.now();
  if (memberSeen.room !== S.code) Object.assign(memberSeen, { room: S.code, ids: S.members.slice(), at: {}, left: [] });
  for (const id of S.members) if (!memberSeen.ids.includes(id)) memberSeen.at[id] = now;
  for (const id of memberSeen.ids) if (!S.members.includes(id)) memberSeen.left.push({ id, name: nameOf(id), t: now });
  memberSeen.ids = S.members.slice();
  memberSeen.left = memberSeen.left.filter((x) => now - x.t < MEMBER_FX_MS);
}
function memberFx(list) {
  if (!list || lessMotion()) return;
  const now = Date.now();
  for (const li of list.querySelectorAll('[data-m]')) {
    const age = now - (memberSeen.at[li.dataset.m] ?? -Infinity);
    if (age < MEMBER_FX_MS) { li.classList.add('m-enter'); li.style.setProperty('--age', `${age}ms`); }
  }
  for (const x of memberSeen.left) {
    const age = now - x.t;
    const li = document.createElement('li');
    li.className = 'm-leave';
    li.style.setProperty('--age', `${age}ms`);
    li.setAttribute('aria-hidden', 'true');
    const wave = document.createElement('span');
    wave.className = 'm-wave';
    wave.textContent = '👋';
    li.append(wave, ' ', x.name); // 名前は外から来た文字なので textContent
    list.append(li);
    setTimeout(() => li.remove(), Math.max(0, MEMBER_FX_MS - age));
  }
}

// ホストだけに出す「部屋の人」。知らない人が入ってきたら退出させられる
function appendMemberPanel() {
  if (S.mode !== 'online') return;
  const others = S.members.filter((id) => id !== S.myId);
  if (!others.length) return;
  const det = document.createElement('details');
  det.className = 'member-panel';
  det.open = !!S.membersOpen;
  det.ontoggle = () => { S.membersOpen = det.open; };
  const sum = document.createElement('summary');
  sum.textContent = `部屋の人（あなたのほか${others.length}人）`;
  det.append(sum);
  for (const id of others) {
    const row = document.createElement('div');
    row.className = 'member-row';
    const name = document.createElement('span');
    const hidden = !!S.hidden?.includes(id);
    name.textContent = hidden ? `${S.names?.[id] ? mask(S.names[id]) : 'ゲスト'}（隠しています）` : nameOf(id);
    const acts = document.createElement('span');
    acts.className = 'member-acts';
    acts.append(makeButton(hidden ? '隠すのをやめる' : 'この人を隠す', () => toggleHidden(id), 'ghost small'), makeButton('通報', () => openAbout(id), 'ghost small'));
    if (S.isHost) acts.append(makeButton('退出させる', () => kick(id), 'ghost small'));
    row.append(name, acts);
    det.append(row);
  }
  ctl().append(det);
}

// 「この人を隠す」（2026-10-21 本人の決定。App Store の審査 1.2 の締め出し）: 自分の画面だけ、その人の名前を伏せ、言葉・絵・リアクションを出さない。
// Claude の判断: 部屋ごとに覚える（S.hidden。人の id は部屋に入るたびに変わるので、部屋をまたいでは覚えられない）。ほかの人には送らない。
const HIDDEN_NAME = '🙈 隠した人';
function toggleHidden(id) {
  const was = !!S.hidden?.includes(id);
  S.hidden = was ? S.hidden.filter((x) => x !== id) : [...(S.hidden ?? []), id];
  saveRoom();
  toast(was ? '隠すのをやめました' : 'この人の名前・言葉・絵を、あなたの画面だけで隠しました');
  render();
}

// 入り直してきた人（新しい id）に、前の id の席・成績・名前を引き継がせる。前の id の画面がまだ開いていれば、部屋を出てもらう
function replaceMember(old, neu, name) {
  const swap = (id) => (id === old ? neu : id);
  const rekey = (o) => (o && typeof o === 'object' && old in o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [swap(k), v])) : o);
  S.members = S.members.map(swap);
  S.names = rekey(S.names);
  if (name) S.names[neu] = name;
  if (S.order) S.order = S.order.map(swap);
  if (S.pick) S.pick = S.pick.map(swap);
  if (S.line) S.line = S.line.map(swap);
  if (S.bench) S.bench = S.bench.map(swap); // 観戦に回した人が入り直しても観戦のまま（2026-11-03 本人の依頼）
  if (S.away) S.away = S.away.map(swap);
  if (S.tally) {
    S.tally = { ...S.tally, wins: rekey(S.tally.wins), played: rekey(S.tally.played), pts: rekey(S.tally.pts), preds: rekey(S.tally.preds) };
    if (S.tally.best) S.tally.best = Object.fromEntries(Object.entries(S.tally.best).map(([k, list]) => [k, list.map((b) => (b.id === old ? { ...b, id: neu } : b))]));
  }
  S.marks = rekey(S.marks);
  S.votes = rekey(S.votes);
  if (S.draw) S.draw = { ...S.draw, by: swap(S.draw.by), votes: rekey(S.draw.votes) };
  S.devs = rekey(S.devs);
  S.beg = (S.beg ?? []).map(swap);
  if (S.ready) S.ready = { ...S.ready, ids: S.ready.ids.map(swap) };
  if (S.colorKeep?.of) S.colorKeep = { ...S.colorKeep, of: rekey(S.colorKeep.of) }; // 入り直しても次の対局で前の色のまま（seatColorsFor）
  S.seen[neu] = Date.now();
  delete S.seen[old];
  send({ type: 'replaced', to: old });
}

// 退出させる（2026-10-26 本人の依頼で、また入れる形と、この部屋に二度と入れない形を選べるようにした）
function kick(id) {
  askChoice(`${nameOf(id)} を部屋から退出させますか？`, '「締め出す」と、その端末からはこの部屋に二度と入れません。', [
    ['退出させる（また入れる）', () => doKick(id, false)],
    ['締め出す（もう入れない）', () => doKick(id, true), 'danger'],
  ]);
}
function doKick(id, ban) {
  if (!S?.members.includes(id)) return;
  if (ban) {
    S.banned = [...(S.banned ?? []), id];
    if (S.devs?.[id]) S.bannedDevs = [...(S.bannedDevs ?? []), S.devs[id]];
  }
  S.members = S.members.filter((m) => m !== id);
  send({ type: 'kick', to: id, ban });
  saveRoom();
  sendState();
  render();
}

// いくつかのボタンから1つ選ぶ小窓（名前を聞く小窓と同じ見た目）。buttons = [[文字, 押したとき, 見た目], …]。「やめる」はいつも足す
function askChoice(title, note, buttons, cancelText = 'やめる') {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.innerHTML = '<div class="invite-box choice-box"><p class="invite-title"></p><p class="invite-note"></p><div class="invite-actions choice-actions"></div></div>';
  pop.querySelector('.invite-title').textContent = title;
  pop.querySelector('.invite-note').textContent = note;
  const acts = pop.querySelector('.invite-actions');
  for (const [text, fn, cls] of buttons) acts.append(makeButton(text, () => { closeInvite(); fn(); }, cls ?? 'primary'));
  if (cancelText) acts.append(makeButton(cancelText, closeInvite, 'secondary'));
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  document.body.append(pop);
}

// 自分が退出させられたとき。ban = 締め出された（この部屋に二度と入れない）
function onKicked(ban = true) {
  if (ban) try { localStorage.setItem(kickedKey(S.code), '1'); } catch { /* 無視 */ }
  forgetRoom(S.code);
  const net = S.net;
  setTimeout(() => net?.close(), 300);
  dropBack();
  S = null;
  setTurnTitle(false);
  setUrlRoom(null);
  showScreen('home');
  alert(ban ? '部屋を作った人によって、部屋から締め出されました（この部屋にはもう入れません）。' : '部屋を作った人によって、部屋から退出させられました。');
}

function gameSelect() {
  const label = document.createElement('label');
  label.className = 'game-select';
  label.textContent = 'ゲームを変える ';
  const sel = document.createElement('select');
  const favs = favorites();
  const votes = S.mode === 'online' ? voteCounts() : {}; // 次のゲームの投票の数
  for (const id of gameOrder()) {
    if (!GAMES[id].ready) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = (favs.includes(id) ? '★ ' : '') + GAMES[id].name + (votes[id] ? `（🗳${votes[id]}）` : '');
    opt.selected = id === S.gameId;
    sel.append(opt);
  }
  sel.onblur = () => render(); // 開いている間に止めていた描き直しを追いつかせる
  sel.onchange = () => {
    sel.onblur = null;
    sel.blur();
    const st = replay(S);
    const playing = st && S.moves.length && !GAMES[S.gameId].result(st);
    if (playing && !confirm('対局の途中です。ゲームを変えますか？')) { sel.value = S.gameId; render(); return; }
    newRound(sel.value, { lobby: true });
  };
  label.append(sel);
  return label;
}

// ゲームのルーレット（2026-10-06 本人の決定）: 待合室でホストが押すと、いまの部屋の人数で遊べるゲームから1つを抽選して切り替える。
// Claude の判断: いまのゲームは外す。CPU を入れられないゲームは人がそろっているときだけ、エアホッケー（CPU を選べるのは3人のときだけ）は2人以上いるときだけ。
// いまの部屋の人数で遊べるか（遊びの抽選も使う）
const playableNow = (g) => g.ready && (!g.noCpu || S.members.length >= g.minPlayers) && (!g.live || S.members.length >= 2);
function rouletteButton() {
  const ids = GAME_ORDER.filter((id) => playableNow(GAMES[id]) && id !== S.gameId);
  const b = makeButton('🎲 ゲームを抽選', () => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    newRound(id, { lobby: true });
    toast(`🎲 ${GAMES[id].name} になりました。もう一度押すと引き直せます`);
  }, 'secondary');
  b.disabled = !ids.length;
  return b;
}

/* ---------- 2回押して置く・相手の迷いが見える（2026-11-11 本人の選択。room.md「UI・UX の4回目」） ---------- */
// 2回押して置く（見やすさの twoTap。TWO_TAP_GAMES だけ）: onBoardMove に来た手を1回目は置かずに覚え（tapGhost）、同じ手がもう一度来たら置く。
//   覚えた手は、その手を当てた局面を画面に出ない入れ物に描いて、いまの盤で空いていたのに埋まる所の中身を写して薄く出す（.tap-ghost）。
//   埋まる所は、2つの盤を根元から同じ並びで降りて探す（子の数が違えばそこで止める。四目並べの列のような入れ物の中まで見るため）。
//   埋まるマスが見つからないときは、押した物に輪を付ける（.tap-ghost-ring）。新しい手が来たら（ghostKey が変わったら）忘れる。
// 相手の迷いが見える（詳細設定 peek。util.js の PEEK_SETTING）: 番の人の端末が、つまんでいる駒（ゲームが o.peek({ f, d, a }) で知らせる）か
//   2回押しの1回目の手（{ m }）を送りっぱなしで送り、受け取った端末は描き直して、ゲームに o.peekIn で渡す（{ m } は main.js が .peek-ghost で出す）。
//   Claude の判断: 同じ中身は続けて送らない。局面が進んだら（ghostKey が変わったら）出さない。自分が送ったものは出さない。
const TWO_TAP_GAMES = new Set(['tictactoe', 'connect4', 'reversi', 'gomoku', 'cube4', 'dots']);
let tapGhost = null; // { k: どの局面か, sig: 手の JSON, move, at: 押した物の場所 }
let lastTap = null; // 盤の中で最後に押した物（押した手の印を付けるため。onclick より先に捕まえる）
el('board').addEventListener('click', (e) => { lastTap = e.target; }, true);
const ghostKey = () => `${timerKey()}:${S.moves.length}:${S.undo ?? 0}`;
const twoTapOn = (game) => !!viewPref.twoTap && TWO_TAP_GAMES.has(S.gameId) && !game.multi && !game.live;
const peekOn = () => S?.mode === 'online' && !!GAMES[S.gameId]?.settings?.some((x) => x.key === 'peek') && rulesOf(S.gameId, S.rules).peek !== 'off';
function tapFirst(game, move) {
  if (!twoTapOn(game)) return false;
  const sig = JSON.stringify(move);
  if (tapGhost?.k === ghostKey() && tapGhost.sig === sig) { tapGhost = null; return false; }
  const all = [...el('board').querySelectorAll('*')];
  tapGhost = { k: ghostKey(), sig, move, at: lastTap ? all.indexOf(lastTap) : -1 };
  sendPeek({ m: move });
  render();
  return true;
}
let peekSent = '';
function sendPeek(d) {
  if (!peekOn()) return;
  const me = myPlayer();
  if (!Number.isInteger(me) || me < 0) return;
  const sig = ghostKey() + JSON.stringify(d);
  if (sig === peekSent) return;
  peekSent = sig;
  send({ type: 'stream', gameId: S.gameId, round: S.round, d: { peek: d, k: S.moves.length, u: S.undo ?? 0 } }, 0);
}
function onPeek(msg) {
  if (msg.gameId !== S.gameId || msg.round !== S.round || !msg.d || typeof msg.d.peek !== 'object' || !msg.d.peek) return;
  S.peekIn = { k: `${timerKey()}:${msg.d.k}:${msg.d.u}`, d: msg.d.peek, from: msg.from };
  if (S.peekIn.k === ghostKey() && peekOn()) render();
}
const peekInNow = () => (S.peekIn && S.peekIn.k === ghostKey() && S.peekIn.from !== S.myId && peekOn() ? S.peekIn.d : null);
function drawGhosts(game, st, board) {
  if (game.multi || game.live) return;
  if (tapGhost && tapGhost.k === ghostKey() && twoTapOn(game)) ghostOne(game, st, board, tapGhost.move, 'tap-ghost', tapGhost.at);
  const pk = peekInNow();
  if (pk && pk.m !== undefined && TWO_TAP_GAMES.has(S.gameId)) ghostOne(game, st, board, pk.m, 'peek-ghost', -1);
}
function ghostOne(game, st, board, move, cls, at) {
  let next = null;
  try { next = game.apply(st, move); } catch { next = null; }
  if (!next) return;
  const tmp = document.createElement('div');
  try { game.render(tmp, next, { canMove: false, onMove() {}, fresh: false, me: watchSeat(game), view: boardView(game) }); } catch { return; }
  const empty = (c) => !c.textContent.trim() && !c.children.length;
  // 中身を持たず印（class）だけで埋まったと描く物（点と線の線）は、ゲームが data-fill を付けて知らせる（2026-11-11 Codex の点検。前は相手の迷いが何も出なかった）
  const filled = (c) => c.dataset?.fill !== undefined;
  const pairs = [];
  const walk = (x, y) => {
    if (filled(y) && !filled(x)) { pairs.push([x, y]); return; }
    if (empty(x)) { if (!empty(y)) pairs.push([x, y]); return; }
    if (x.children.length !== y.children.length) return;
    for (let i = 0; i < x.children.length; i++) walk(x.children[i], y.children[i]);
  };
  walk(board, tmp);
  for (const [c, y] of pairs) {
    const copy = [...y.childNodes].map((x) => x.cloneNode(true));
    // 写した物から、動きの鍵と「最後の手」「動き」の印を外す（薄い石に最後の手の点が付かないように）
    for (const x of copy) if (x.nodeType === 1) for (const e of [x, ...x.querySelectorAll('*')]) {
      for (const k of ['data-fly', 'data-fly-from', 'data-last', 'id']) e.removeAttribute(k);
      e.classList.remove('last', 'pop', 'flip', 'drop', 'win');
    }
    c.replaceChildren(...copy);
    c.classList.add(cls);
    // 印だけで描く物は、埋まった印を写して薄く出す（.ghost-fill）
    if (filled(y) && !y.childNodes.length) {
      for (const k of y.classList) if (!['last', 'pop', 'flip', 'drop', 'win'].includes(k)) c.classList.add(k);
      c.classList.add('ghost-fill');
    }
  }
  if (!pairs.length && at >= 0) board.querySelectorAll('*')[at]?.classList.add(cls + '-ring');
}

/* ---------- 操作 ---------- */

function pushMove(move) {
  S.moves.push(move);
  saveRoom();
  if (S.mode === 'online') sendMoves();
  render();
}

// 汚い言葉のふるい（2026-10-21 本人の決定）: 人が自由に打った言葉は送る前に確かめる。ゲームの id → [手の中の欄, 一覧の種類]。
// 受け取った側では、各ゲームが filter.js の shown で当たった所を隠す（ゲームを足したら両方に足す）。
const FREE_TEXT = { umigame: [['text', 'sentence'], ['q', 'sentence'], ['a', 'sentence']], oekaki: [['text', 'short']], wordwolf: [['text', 'short']], ishin: [['text', 'short']], jinro: [['text', 'sentence']], oogiri: [['text', 'sentence']], kachikan: [['text', 'short']] };
const badText = (move) => (FREE_TEXT[S.gameId] ?? []).some(([k, kind]) => typeof move?.[k] === 'string' && isBad(move[k], kind));

function onBoardMove(move) {
  if (badText(move)) { toast(BAD_TEXT_NOTE); return; }
  const game = GAMES[S.gameId];
  const st = replay(S);
  if (!st || !canMove(game, st, game.result(st))) return;
  if (game.multi) move = { ...move, p: myPlayer() };
  if (!game.apply(st, move)) return;
  // 2回押して置くの1回目（2026-11-11）。参りましたは確かめの窓を出しているので2回押しにしない（2026-11-12 の Codex の点検）
  if (move.give !== true && tapFirst(game, move)) { haptic('tap'); return; }
  haptic('tap');
  markSending(); // 手が届いたかの印（2026-11-11）
  pushMove(move);
}

// ホストの端末だけが CPU（と部屋を出た人の席）の手を考える
function scheduleCpu(game, st, res) {
  if (!S.isHost || S.mode !== 'online' || !S.order || res) return;
  const canAct = (s, i) => (game.multi ? game.canAct(s, i) : game.turn(s) === i);
  // 同時に動くゲーム（realtime）は CPU ごとに別々に予約し、相手が動いても取り消さない
  // （取り消すと相手が速いと CPU が永久に動けない。1人ずつだと、待っている CPU の後ろの CPU が動けない）
  const ps = S.order.map((id, i) => i).filter((i) => cpuControlled(S.order[i]) && canAct(st, i));
  // みんなが同時に押す場面（concurrent）も CPU ごとに予約する。1人ずつだと、何もしない CPU（null を返す）が前にいると後ろの CPU が動けない
  // （ウミガメの「答えを見る？」で、言い出した人と返事をしていない人が部屋を出ると返事待ちが終わらなかった。2026-11-04 Codex の点検の指摘）
  for (const p of game.realtime || game.concurrent?.(st) ? ps : ps.slice(0, 1)) {
    // 待ったで手が減ると同じ長さに戻るので、待ったの回数も鍵に入れる（入れないと「もう予約してある」と見て CPU が止まる）
    const key = game.realtime ? `${S.gameId}:${S.round}:rt:${p}` : `${S.gameId}:${S.round}:${S.undo ?? 0}:${S.moves.length}:${p}`;
    if (S.cpuKeys[p] === key) continue; // もう予約してある
    S.cpuKeys[p] = key;
    const session = S;
    const len = S.moves.length;
    const gid = S.gameId, round = S.round;
    setTimeout(() => {
      // 予約のあとでゲームか対局が替わったら何もしない（前のゲームの CPU が新しいゲームの局面で考えて例外になっていた。2026-10-30 に見つけた）
      if (S !== session || S.gameId !== gid || S.round !== round) { if (S === session && S.cpuKeys[p] === key) S.cpuKeys[p] = null; return; }
      if (S.cpuKeys[p] !== key || (!game.realtime && S.moves.length !== len)) return;
      S.cpuKeys[p] = null;
      if (!cpuControlled(S.order?.[p])) { render(); return; } // 予約のあとで、観戦の人がこの席に入った（途中から空いた席に入る）
      const now = replay(S);
      const m = now && !game.result(now) && canAct(now, p) ? game.cpu(now, p, rulesOf(S.gameId, S.rules)) : null; // null = いまは何もしない
      const move = game.multi && m ? { ...m, p } : m; // 盤のゲームの手には p を付けない（手が 0 のこともある）
      const after = move !== null ? game.apply(now, move) : null;
      if (after) pushMove(move);
      else render(); // 打てなかったら予約し直す
    }, cpuOnlyLeft(game, st) ? Math.min(FF_DELAY_MS, game.cpuDelay?.(st, p) ?? CPU_DELAY_MS) : game.cpuDelay?.(st, p) ?? CPU_DELAY_MS);
  }
}

/* ---------- CPU だけになったら早送り（2026-11-13 便利機能の1回目。本人の選択。room.md） ---------- */
// 人がみんな上がって CPU だけが残ったら、自動で1手 FF_DELAY_MS の速さで最後まで見せる（本人が推奨を承認）。
// 見分け方（Claude の判断）: ゲームごとに「抜けた人」を知る約束が無いので、ホストの端末でいまの局面から CPU の手を決着まで試しに打ってみて、
// 途中で人の席が一度も動けなければ「CPU だけ」と見る。試しの手は捨て、本物の手はいつもどおり CPU が考える。
// 部屋を出た人・待合室へ行った人の席も「人」と数えるので、その人の席を CPU が代わりに打っている間は早送りしない（本人に伝えた決まり）。
// 試すのはカードなどの番のあるゲーム（multi）だけ。盤のゲームは人が上がって抜けることがない。同時に動くゲーム・時間で進むゲームも試さない。
// 試しの手は乱数で選ぶので、たまたま早く決着して人の番が来ないこともある（いろあわせ・海賊のたる・シーソーで、人がまだ残っているのに「CPU だけ」と見た）。
// そのため FF_TRIES 回試して全部で人の番が来なかったときだけ「CPU だけ」と見、一度そう見ても対局の間ずっととはせず、手が進むたびに見直す（S.ffMemo。試す手数と時間に上限）。
// 見誤っても、その1手が少し速くなるだけ（人の手は速めない）。
const FF_DELAY_MS = 200;
const FF_MAX_STEPS = 400;
const FF_MAX_MS = 60;
const FF_TRIES = 5;
function cpuOnlyLeft(game, st) {
  if (!game.multi || game.realtime || game.referee || game.live || !S.order) return false;
  const key = `${S.gameId}:${S.round}:${S.undo ?? 0}:${S.moves.length}`;
  if (S.ffMemo?.key === key) return S.ffMemo.v;
  const human = S.order.map((id) => !isCpu(id));
  // 人が1人も座っていない対局（観戦だけ）は早送りしない
  const v = human.some(Boolean) && cpuRollouts(game, st, human, rulesOf(S.gameId, S.rules), performance.now());
  S.ffMemo = { key, v };
  return v;
}
// CPU の手だけで決着まで試しに打つのを FF_TRIES 回。全部で人の席が一度も動けなかったら true
function cpuRollouts(game, st, human, rules, t0) {
  try {
    for (let t = 0; t < FF_TRIES; t++) {
      let s = st;
      let ended = false;
      for (let i = 0; i < FF_MAX_STEPS; i++) {
        if (game.result(s)) { ended = true; break; }
        if (game.concurrent?.(s)) return false;
        if (human.some((h, p) => h && game.canAct(s, p))) return false;
        const p = human.findIndex((h, q) => !h && game.canAct(s, q));
        if (p < 0) return false;
        const m = game.cpu(s, p, rules);
        if (m === null || m === undefined) return false;
        const next = game.apply(s, { ...m, p });
        if (!next) return false;
        s = next;
        if (performance.now() - t0 > FF_MAX_MS) return false;
      }
      if (!ended) return false;
    }
  } catch { return false; }
  return true;
}

// 時間で進むゲームの進行役。ホストの端末だけが時間を計り、referee(局面) が返す手を ms 後に足す。
// 同じ key のうちは計り直さない（ほかの人が動くたびに締め切りが延びないように）
function scheduleReferee(game, st, res) {
  if (!S.isHost || S.mode !== 'online' || !game.referee || res) return;
  const r = game.referee(st);
  if (!r) return;
  const key = `${S.gameId}:${S.round}:${r.key}`;
  if (S.refKey === key) return;
  S.refKey = key;
  const session = S;
  setTimeout(() => {
    if (S !== session || S.refKey !== key) return;
    S.refKey = null;
    const now = replay(S);
    const r2 = now && !game.result(now) ? game.referee(now) : null;
    const move = r2 && `${S.gameId}:${S.round}:${r2.key}` === key ? { ...r2.move, p: -1 } : null;
    if (move && game.apply(now, move)) pushMove(move);
    else render();
  }, r.ms);
}

// 新しい対局へ。カードゲームは lobby なら待合室へ、そうでなければ今の顔ぶれですぐ始める
function newRound(gameId, { lobby = false } = {}) {
  const prevGame = GAMES[S.gameId];
  // 盤のゲームのもう一回は、同じ顔ぶれで先手と後手を入れ替える（3人以上は打つ順番を1つずつ回す）
  if (gameId === S.gameId && !prevGame?.multi && S.order?.length >= 2) {
    const st = stayOn() ? replay(S) : null;
    const next = st && stayNext(prevGame.result(st));
    const ids = S.order.map((id) => (isCpu(id) ? 'cpu' : id));
    S.pick = next ? next.pick : [...ids.slice(1), ids[0]];
    if (next) S.line = next.line; // 勝ち残りで負けた人と観戦の人が交代する
    adjustCpu(prevGame); // CPU の強さを自動で合わせる
  }
  if (gameId !== S.gameId) {
    S.carry = null;
    if (S.votes) S.votes = Object.fromEntries(Object.entries(S.votes).filter(([, g]) => g !== gameId)); // 投票がかなった
  }
  else if (prevGame?.carry && S.order) {
    const st = replay(S);
    if (st && prevGame.result(st)) S.carry = Object.fromEntries(S.order.map((id, i) => [id, prevGame.carry(st, i)]));
  }
  // 結果の画面で変えたルールは、前の対局の当て直し（上）が済んでから入れる（againRules）。待合室へ戻るときも次の対局のルールとして残す
  const pend = againRules();
  if (pend && gameId === S.gameId) {
    S.rules = { ...S.rules, [gameId]: { ...rulesOf(gameId, S.rules), ...pend } };
    rememberRules(); // 上の adjustCpu が、結果の画面で変えたルールを入れる前の S.rules で端末の覚えを上書きしているので覚え直す（2026-11-13 Codex の点検の指摘）
  }
  S.gameId = gameId;
  S.round += 1;
  S.away = [];
  S.draw = null; // 遊びの抽選は、ゲームが替わる・待合室に戻ると消える
  S.lobbyView = false;
  S.first = 1 - S.first;
  S.moves = [];
  S.undo = 0;
  S.undoAsk = null;
  S.order = null;
  S.seed = 0;
  S.prev = null;
  if (!lobby && S.mode === 'online') { startRound(); return; }
  saveRoom();
  if (S.mode === 'online') sendState();
  render();
}

function startRound() {
  const game = GAMES[S.gameId];
  let order;
  if (game.multi) {
    const { humans, cpus } = lineup(game);
    order = [...humans, ...Array.from({ length: cpus }, (_, i) => 'cpu' + (i + 1))];
    const r = crypto.getRandomValues(new Uint32Array(order.length));
    for (let i = order.length - 1; i > 0; i--) { // 席順は毎回まぜる
      const j = r[i] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
  } else {
    S.pick = boardPick();
    let n = 0;
    order = S.pick.map((v) => (v === 'cpu' ? 'cpu' + ++n : v));
  }
  S.colors = game.multi ? null : seatColorsFor(S.gameId, order); // 続けて遊ぶ間は、その人の色と形を変えない（2026-11-13）
  keepColors(order, S.colors);
  S.round += 1;
  S.order = order;
  S.away = [];
  S.draw = null;
  S.seed = randomSeed();
  // 前の対局と同じ顔ぶれのときだけ、前の順位を引き継ぐ
  const prev = S.carry ? order.map((id) => S.carry[id]) : null;
  S.prev = prev?.every(Number.isInteger) ? prev : null;
  S.moves = [];
  S.undo = 0;
  S.undoAsk = null;
  saveRoom();
  sendState();
  render();
}

function rematch() {
  if (S.mode === 'local') { S.moves = []; S.seed = randomSeed(); render(); return; }
  if (S.isHost) newRound(S.gameId);
  else send({ type: 'rematch' }); // ホストが受け取って新しい対局を始める
}

function startLocal(gameId) {
  if (!canHost()) return;
  S = { mode: 'local', gameId, round: 1, first: 0, seed: randomSeed(), order: null, cpus: 0, moves: [], members: [], names: {}, rules: {}, prev: null, carry: null, pick: null };
  enterPlay();
}

// 毎フレーム動くゲームを同じ画面で（mode = 'cpu' | 'two'）
function startLive(gameId, mode) {
  if (!canHost()) return;
  S = { mode: 'local', live: mode, gameId, round: 1, first: 0, seed: 0, order: null, cpus: 0, moves: [], members: [], names: {}, rules: {}, prev: null, carry: null, pick: null };
  enterPlay();
}

// 毎フレーム動くゲームの画面。対局ごと（round）に1回だけ作り、描き直しでは作り直さない
function renderLive(game) {
  const key = `${S.gameId}:${S.round}:${S.mode}:${S.live ?? ''}`;
  noteAchievements(game, null);
  if (S.liveKey !== key) {
    stopLive();
    const online = S.mode === 'online';
    const board = el('board');
    el('status').innerHTML = '';
    S.liveKey = key;
    S.liveHandle = game.mount(board, {
      mode: online ? 'online' : S.live, status: el('status'), me: online ? myPlayer() : null,
      names: online ? S.order.map(nameOf) : null, rules: rulesOf(S.gameId, S.rules), isHost: online && S.isHost,
      // CPU が動かす席（部屋を出た人の席も）。ホストの端末が動かし、ほかの端末はその席を待たない
      cpuSeats: () => (S.order ?? []).flatMap((id, i) => (cpuControlled(id) ? [i] : [])),
      send: (d, important) => send({ type: 'live', gameId: S.gameId, round: S.round, d }, important ? 1 : 0),
    });
  }
  appendReactions();
  if (S.mode === 'online' && S.isHost) ctl().append(lobbyAllButton(), gameSelect());
  if (S.mode === 'online') appendMemberPanel();
}

function stopLive() {
  if (!S?.liveHandle) return;
  S.liveHandle.destroy();
  S.liveHandle = null;
  S.liveKey = null;
}

/* ---------- 名前は部屋に入るときに聞く（2026-10-24 本人の決定。前はホーム画面の欄だった） ---------- */
// 招待リンクから来た人はホームを通らずに部屋へ入るので、名前を入れないまま「プレイヤー2」になっていた。
// 部屋を作るとき・部屋コードや招待リンクで入るときに小窓で聞く。前に入れた名前が最初から入っていて「OK」だけで進める。
// 再読み込みで部屋に戻るとき（タブに部屋を覚えているとき）と、名前を使わない同じ画面の対局では聞かない（Claude の判断）。
// 空のままでは進めない（Claude の判断。聞く目的が名前を付けてもらうことなので）。マークはホームで選ぶ（本人の選択）。
function askName(okText, onOk, onCancel = () => {}) {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'あなたの名前');
  pop.innerHTML = `<form class="invite-box name-ask">
    <label class="invite-title" for="ask-name">あなたの名前</label>
    <input id="ask-name" maxlength="10" autocomplete="nickname" placeholder="例: たろう">
    <p class="invite-note">部屋の人の画面に出ます（10文字まで）。</p>
    <div class="invite-actions"></div>
  </form>`;
  const form = pop.querySelector('form');
  const input = pop.querySelector('#ask-name');
  input.value = myName();
  const cancel = () => { closeInvite(); onCancel(); };
  const ok = makeButton(okText, null);
  ok.type = 'submit';
  form.querySelector('.invite-actions').append(ok, makeButton('やめる', cancel, 'secondary'));
  const check = () => {
    const n = cleanName(input.value);
    input.classList.toggle('bad', isBad(n));
    ok.disabled = !n;
  };
  input.addEventListener('input', check);
  check();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = cleanName(input.value);
    if (!n) return;
    if (isBad(n)) { toast(BAD_TEXT_NOTE); input.focus(); return; }
    try { localStorage.setItem(NAME_KEY, n); } catch { /* 無視 */ }
    closeInvite();
    onOk();
  });
  pop.addEventListener('click', (e) => { if (e.target === pop) cancel(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
  document.body.append(pop);
  input.focus();
  input.select();
}

function createRoom(gameId) {
  if (!canHost()) return;
  askName('部屋を作る', () => openRoom(gameId));
}

function openRoom(gameId) {
  const myId = newId();
  S = {
    mode: 'online', code: randomString(CODE_LEN, CODE_CHARS), myId, isHost: true,
    gameId, round: 1, first: crypto.getRandomValues(new Uint8Array(1))[0] & 1, seed: 0, order: null, cpus: 0, moves: [],
    members: [myId], names: { [myId]: myName() || 'プレイヤー1' }, marks: myMark() ? { [myId]: myMark() } : {}, rules: savedRules(), prev: null, carry: null, pick: null, banned: [],
  };
  saveRoom();
  setUrlRoom(S.code);
  enterPlay();
  openNet();
}

function joinRoom(raw) {
  const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LEN) { toast(`部屋コードは${CODE_LEN}文字です`); return false; }
  if (wasKicked(code)) { toast('この部屋には入れません'); return false; }
  const saved = loadRoom(code);
  if (saved) enterRoom(code, saved);
  else {
    showScreen('home'); // 小窓の後ろはホーム（招待リンクから来たときも）
    askName('入る', () => enterRoom(code, null), () => setUrlRoom(null));
  }
  return true;
}

function enterRoom(code, saved) {
  ownLast = null; // 部屋に入ったら（同じ部屋に入り直しても）最初の保存で持ち主になる（saveLastRoom）
  S = saved
    ? { ...saved, mode: 'online', code }
    : {
      mode: 'online', code, myId: newId(), isHost: false,
      gameId: null, round: 0, first: 0, seed: 0, order: null, cpus: 0, moves: [], members: [], names: {}, rules: {}, prev: null, carry: null, pick: null,
    };
  saveRoom();
  setUrlRoom(code);
  enterPlay();
  openNet();
}

function enterPlay() {
  S.banned ??= [];
  S.undo ??= 0;
  Object.assign(S, {
    conn: S.mode === 'online' ? 'connecting' : 'local', seen: {}, full: false, hostLeft: false,
    shownKey: null, shownLen: 0, lostKey: '', cpuKeys: {}, refKey: null, couldMove: null, waitFrom: Date.now(), undoAsk: null,
  });
  showScreen('play');
  armBack();
  render();
}

// ask = false は、もう聞いたあと（ブラウザの「戻る」で聞いた）
function leave(ask = true) {
  if (S?.mode === 'online' && ask && !confirm('部屋を出ますか？')) return;
  stopLive();
  closeInvite();
  dropBack();
  if (S?.mode === 'online') {
    send({ type: 'bye' });
    forgetRoom(S.code);
    const net = S.net;
    setTimeout(() => net?.close(), 500);
  }
  S = null;
  setTurnTitle(false);
  setUrlRoom(null);
  showScreen('home');
}

/* ---------- うっかり閉じない確認（2026-10-08。22回目の案。Claude が出した15の案から本人が推奨どおり選んだ） ---------- */
// Claude の判断: 部屋（同じ画面の対局も）にいる間に、
//  - ブラウザの「戻る」（iPhone の左の端からなぞる操作も）で「部屋を出ますか？」と聞く。出るなら「部屋を出る」ボタンと同じ（ホームへ）。出ないならそのまま。
//    仕組み: 部屋に入ったとき履歴に受け皿を1つ足しておき（history.pushState）、「戻る」でそれが消えたとき（popstate）に聞く。出ないときは足し直す。
//    「部屋を出る」で出たときは受け皿を自分で消す（dropBack）。再読み込みしたときは、もう受け皿の上にいるので足さない（history.state の bgGuard）。
//  - タブを閉じる・再読み込み・ほかのページへ移るときは、ブラウザの確認（beforeunload）を出す。文はブラウザが決める（iPhone の Safari では出ないことがある）。
//    再読み込みでも出るが、そのまま進めば今までどおり部屋に戻れる。
let backArmed = false; // 受け皿がいまの位置にあるか
let backDropping = false; // 自分で受け皿を消している途中（その popstate は聞かない）
function armBack() {
  if (backArmed) return;
  backArmed = true;
  if (history.state?.bgGuard) return;
  history.pushState({ bgGuard: true }, '', location.href);
}
function dropBack() {
  if (!backArmed) return;
  backArmed = false;
  backDropping = true;
  history.back();
}
window.addEventListener('popstate', () => {
  const asking = backArmed && !backDropping;
  backDropping = false;
  backArmed = false;
  if (!S) { setUrlRoom(null); return; } // 前の部屋のリンクのままの履歴に戻ったときも、部屋には入らない
  if (!asking) return;
  if (confirm(S.mode === 'online' ? '部屋を出ますか？' : '対局をやめてホームに戻りますか？')) leave(false);
  else armBack();
});
window.addEventListener('beforeunload', (e) => {
  if (!S) return;
  e.preventDefault();
  e.returnValue = ''; // 古いブラウザ向け
});

// 招待（2026-10-07 の13回目で QR コードを足した）: 「招待する」で小窓を開き、部屋に入るための QR コードと部屋コードを出す。
// 「リンクを送る」で前と同じく共有の画面（無ければリンクのコピー）を出す。
// QR コードを作る道具（qrcode-generator。MIT ライセンス）は mqtt.js と同じく unpkg から版を固定して、初めて開いたときだけ読む。
// 読めないとき（電波が悪いなど）は QR コードを出さず、部屋コードとリンクを送るボタンだけにする（Claude の判断）。
const QR_LIB = 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js';
let qrLoading = null;
function loadQr() {
  if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
  qrLoading ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = QR_LIB;
    sc.onload = () => (typeof window.qrcode === 'function' ? resolve(window.qrcode) : reject(new Error('qrcode')));
    sc.onerror = () => { qrLoading = null; reject(new Error('qrcode')); };
    document.head.append(sc);
  });
  return qrLoading;
}
// 文字から QR コードの SVG を作る（黒いマスを1本の path にまとめる）
function qrSvg(qrcode, text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 4; // まわりの白い余白（4マス）
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="部屋に入るための QR コード"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function inviteUrl() {
  const url = new URL(IS_APP ? WEB_URL : location.href);
  url.search = '?room=' + S.code;
  url.hash = '';
  return url.href;
}

async function shareInvite() {
  const href = inviteUrl();
  const text = `${GAMES[S.gameId]?.name ?? 'ボードゲーム'}で対戦しよう！ 部屋コード: ${S.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: '対戦しよう', text, url: href }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${href}`);
    toast('招待リンクをコピーしました');
  } catch {
    prompt('このリンクを友だちに送ってください', href);
  }
}

function closeInvite() { dropPop(document.querySelector('.invite-pop:not(.closing)')); }
// 小窓を閉じる（2026-11-06 の画面の切り替え）: ふわっと消してから外す。消える間は押せず（.closing）、読み上げにも出さず、id も外す
// （すぐ次の小窓を開くことがあり、同じ id が2つになると「あなたの名前」の字を押したとき消える方の欄へ行くため）
function dropPop(pop) {
  if (!pop) return;
  if (lessMotion()) { pop.remove(); return; }
  if (pop.contains(document.activeElement)) document.activeElement.blur();
  pop.classList.add('closing');
  pop.setAttribute('aria-hidden', 'true');
  for (const x of pop.querySelectorAll('[id]')) x.removeAttribute('id');
  setTimeout(() => pop.remove(), 160);
}

/* ---------- お問い合わせ・通報・ライセンス（2026-10-21 本人の決定。App Store の審査 1.2 の連絡先と通報） ---------- */
// 窓口はこのアプリ用の Google フォーム（本人が作る。作ったら CONTACT_URL に入れる）。メールアドレスは出さない。
// 通報（部屋の人の一覧の「通報」）は、部屋コードと相手の名前を写せる形で出してからフォームを開く（相手の名前をフォームの住所に入れて送らない）。
// フォームに Google へのログインが要る項目（ファイルを付けるなど）を作ったら、app/privacy.html の第2条も直す（いまは「ご記入いただいた内容だけ」と書いている）。
const CONTACT_URL = '';
const OFL_NOTE = 'SIL Open Font License 1.1（https://openfontlicense.org）。使う字だけを切り出して使っています。全文: fonts/OFL.txt';
const LICENSES = [
  ['mqtt.js（通信）', 'Copyright (c) 2015-2016 MQTT.js contributors'],
  ['qrcode-generator（招待の QR コード）', 'Copyright (c) 2009 Kazuhiko Arase'],
  ['inappropriate-words-ja（言葉のふるいの一覧のもと）', 'Copyright (c) 2020 K Hashimoto'],
  // CC BY 4.0 は作者の表示と、手を入れたことの表示が条件（どの音が OtoLogic かは sound.js の先頭）
  ['効果音の一部', 'OtoLogic（https://otologic.jp/）', 'CC BY 4.0（https://creativecommons.org/licenses/by/4.0/deed.ja）。長さと大きさを整えて使っています'],
  // VOICEVOX の規約で、使った声の表記が要る（2026-11-08。声の作りは sound.js の先頭）
  ['声', 'VOICEVOX:雨晴はう ／ VOICEVOX:猫使ビィ', 'VOICEVOX（https://voicevox.hiroshiba.jp/）で作った声を使っています'],
  // 見出しの字体（2026-11-09。app/fonts/。OFL は著作権の表示とライセンスを添えることが条件。全文は app/fonts/OFL.txt）
  ['字体 Zen Maru Gothic（見出し）', 'Copyright 2021 The Zen Maru Gothic Project Authors', OFL_NOTE],
  ['字体 Yuji Syuku（判子）', 'Copyright 2021 The Yuji Project Authors', OFL_NOTE],
  ['字体 Dela Gothic One（帯・技の名前）', 'Copyright 2020 The Dela Gothic Project Authors', OFL_NOTE],
  // アプリ版の殻と広告の部品（native/package.json）。ウェブ版には入っていないので出さない
  ...(IS_APP ? [
    ['Capacitor（アプリの殻）', 'Copyright (c) 2017-present Drifty Co.'],
    ['@capacitor-community/admob（広告）', 'Copyright (c) 2021 Capacitor Community'],
    ['@capacitor/haptics（振動）', 'Copyright 2020-present Ionic'],
    // MPL-2.0 は、使った部品のソースの置き場所を知らせることが条件（ファイル単位のライセンス。部品には手を入れていない）
    ['@capgo/native-purchases（広告を消す）', 'Martin Donadieu（Capgo）', 'Mozilla Public License 2.0（https://mozilla.org/MPL/2.0/）。ソース: https://github.com/Cap-go/capacitor-native-purchases'],
  ] : []),
];
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

function openAbout(reportId = null) {
  closeInvite();
  const report = reportId !== null && S?.mode === 'online';
  const who = report ? (S.names?.[reportId] ? mask(S.names[reportId]) : 'ゲスト') : '';
  const pop = document.createElement('div');
  pop.className = 'invite-pop about-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', report ? '通報する' : 'お問い合わせ・通報');
  const form = CONTACT_URL
    ? `<a class="btn primary about-form" href="${esc(CONTACT_URL)}" target="_blank" rel="noopener">フォームを開く</a>`
    : '<p class="invite-note">（窓口のフォームを準備しています）</p>';
  pop.innerHTML = `<div class="invite-box about-box">
    <div class="invite-title">${report ? '通報する' : 'お問い合わせ・通報'}</div>
    ${report
    ? `<p class="invite-note">いやな名前・言葉・絵があったら、フォームで知らせてください。フォームには、下の部屋コードと名前を書いてください。</p>
      <div class="invite-code">部屋コード <strong>${esc(S.code)}</strong></div>
      <div class="invite-code about-who">名前 <strong>${esc(who)}</strong></div>
      <p class="invite-note">すぐに見えなくしたいときは、部屋の人の一覧の「この人を隠す」を押してください（あなたの画面だけで隠れます）。</p>`
    : '<p class="invite-note">不具合・ご意見と、いやな名前・言葉・絵の通報は、下のフォームで受け付けています。部屋の中からは、部屋の人の一覧の「通報」でも送れます。</p>'}
    ${form}
    ${report ? '' : '<p class="invite-note"><a href="privacy.html">プライバシーポリシー</a></p>'}
    ${report ? '' : `<details class="about-license"><summary>ライセンス</summary>${LICENSES.map(([n, c, lic]) => `<p><b>${esc(n)}</b><br>${esc(lic ?? 'MIT License')}<br>${esc(c)}</p>`).join('')}<pre>${esc(MIT_TEXT)}</pre></details>`}
  </div>`;
  const row = document.createElement('div');
  row.className = 'invite-actions';
  if (report) row.append(makeButton('部屋コードと名前を写す', async () => {
    try { await navigator.clipboard.writeText(`部屋コード: ${S.code} / 名前: ${who}`); toast('写しました。フォームに貼り付けてください'); } catch { toast('写せませんでした。手で書き写してください'); }
  }, 'secondary'));
  row.append(makeButton('閉じる', closeInvite, 'secondary'));
  pop.querySelector('.about-box').append(row);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  row.querySelector('button')?.focus();
}

/* ---------- ランキング（2026-10-22 本人の決定。記録は records.js、Game Center は native.js） ---------- */
// ホームの「🏆 ランキング」で開く小窓。上に自分の記録（遊んだ対局・人がいた対局の勝ち・自己ベスト）、アプリ版は下に Game Center の順位
// （ランキングを選ぶと上位10人と自分の順位。全国と Game Center の友だちを切り替えられる）。名前は外から来た文字なので esc を通す。
function openRanking() {
  closeInvite();
  const rec = readRecords();
  const pop = document.createElement('div');
  pop.className = 'invite-pop rank-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'ランキング');
  const rows = [];
  for (const id of GAME_ORDER) {
    const game = GAMES[id];
    if (!game?.record) continue;
    const keys = Object.keys(rec.best).filter((k) => k.split('|')[0] === id).sort((a, b) => rec.best[b].v - rec.best[a].v);
    const items = keys.length
      ? keys.map((k) => `<li><span class="rank-rule">${esc(rulesText(game, k))}</span><b>${esc(game.record.fmt(rec.best[k].v))}</b></li>`).join('')
      : '<li class="rank-none">まだ記録がありません</li>';
    rows.push(`<div class="rank-game"><div class="rank-game-name">${game.icon ?? ''} ${esc(game.name)}（${esc(game.record.label)}）</div><ul>${items}</ul></div>`);
  }
  // ゲームごとの成績（27回目の案）: 遊んだ数の多い順。数は records.js が整えた整数だけ
  const per = Object.entries(rec.games).filter(([id]) => GAMES[id]).sort((a, b) => b[1].p - a[1].p || b[1].w - a[1].w);
  const perHtml = per.length
    ? `<details class="rank-per"><summary>ゲームごとの成績（${per.length}種類）</summary><ul class="rank-ol">${per.map(([id, g]) => `<li><span>${GAMES[id].icon ?? ''} ${esc(GAMES[id].name)}</span><b>${g.p}局・${g.w}勝</b></li>`).join('')}</ul>
      <p class="invite-note">勝ちはオンラインの対局だけ数えます（CPU だけが相手の対局も入ります）。エアホッケーは数えません。</p></details>`
    : '';
  pop.innerHTML = `<div class="invite-box rank-box">
    <div class="invite-title">🏆 ランキング</div>
    <div class="rank-sum"><div><span>遊んだ対局</span><b>${rec.played}局</b></div><div><span>人がいた対局の勝ち</span><b>${rec.hwins}勝</b></div></div>
    ${perHtml}
    <div class="rank-head">自己ベスト（この端末の記録・詳細設定ごと）</div>
    ${rows.join('')}
    <p class="invite-note">オンラインの対局で、自分が打った分だけ記録します。同じ画面の対局は「遊んだ対局」にだけ数えます。</p>
    <div class="rank-gc"></div>
    <div class="invite-actions"></div>
  </div>`;
  const box = pop.querySelector('.rank-box');
  box.querySelector('.invite-actions').append(makeButton('閉じる', closeInvite, 'secondary'));
  if (canRank()) drawBoards(box.querySelector('.rank-gc'));
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  box.querySelector('.invite-actions button')?.focus();
}

/* ---------- CPU 図鑑（2026-10-22 本人の決定。記録は records.js の cpus） ---------- */
// ホームの「📖 図鑑」で開く小窓（ボタンの名前はスマホ幅で2行に割れないよう短くした）。16体を CPU_NAMES の順に並べ、倒した CPU は名前と倒した回数（強さ「つよい」で倒したら ⭐）、まだの CPU は「？？？」。
function openZukan() {
  closeInvite();
  const { cpus } = readRecords();
  const got = CPU_NAMES.filter((n) => cpus[n]).length;
  const pop = document.createElement('div');
  pop.className = 'invite-pop zukan-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'CPU 図鑑');
  const cards = CPU_NAMES.map((n, i) => {
    const c = cpus[n];
    const no = String(i + 1).padStart(2, '0');
    return c
      ? `<li class="zukan-card got"><span class="zukan-no">No.${no}</span><span class="zukan-face">🤖</span><b>${esc(n)}${c.hard ? ' ⭐' : ''}</b><span class="zukan-n">${c.n}回 倒した</span></li>`
      : `<li class="zukan-card"><span class="zukan-no">No.${no}</span><span class="zukan-face">❔</span><b>？？？</b><span class="zukan-n">まだ</span></li>`;
  }).join('');
  pop.innerHTML = `<div class="invite-box zukan-box">
    <div class="invite-title">📖 CPU 図鑑（${got}/${CPU_NAMES.length}）</div>
    <ul class="zukan-list">${cards}</ul>
    <p class="invite-note">オンラインの対局で、あなたが勝った対局にいた CPU が載ります。⭐ は強さ「つよい」で倒した CPU。${got >= CPU_NAMES.length ? '🎉 ぜんぶそろいました！ 色「ロボ」が使えます（ホームの「🎨 色」）' : `${CPU_NAMES.length}体そろえると、色「ロボ」が使えるようになります。`}</p>
    <div class="invite-actions"></div>
  </div>`;
  const box = pop.querySelector('.zukan-box');
  box.querySelector('.invite-actions').append(makeButton('閉じる', closeInvite, 'secondary'));
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  box.querySelector('.invite-actions button')?.focus();
}

// Game Center の順位（アプリ版だけ）。押すまでは読まない（ログインの画面を勝手に出さないため）
function drawBoards(wrap) {
  const boards = allBoards(GAMES);
  wrap.innerHTML = `<div class="rank-head">全国のランキング（Game Center）</div>
    <div class="rank-pick"><select aria-label="ランキングを選ぶ">${boards.map((b) => `<option value="${esc(b.id)}">${esc(b.label)}</option>`).join('')}</select></div>
    <div class="rank-scope"></div><div class="rank-list"></div>`;
  const sel = wrap.querySelector('select');
  const list = wrap.querySelector('.rank-list');
  let scope = 'global';
  const scopeBox = wrap.querySelector('.rank-scope');
  const fmtOf = (id) => {
    const b = boards.find((x) => x.id === id);
    const g = b?.gameId ? GAMES[b.gameId] : null;
    return g ? (v) => g.record.fmt(v) : (v) => `${v}勝`;
  };
  const load = async () => {
    list.innerHTML = '<p class="invite-note">読み込んでいます…</p>';
    const id = sel.value;
    const r = await loadBoard(id, scope);
    if (!list.isConnected || sel.value !== id) return;
    if (!r) { list.innerHTML = '<p class="invite-note">Game Center にログインできないか、読み込めませんでした（iPhone の「設定」→「Game Center」でログインできます）</p>'; return; }
    const fmt = fmtOf(id);
    const items = r.entries.map((e) => `<li class="${e.me ? 'me' : ''}"><span class="rank-no">${e.rank}位</span><span class="rank-who">${esc(mask(e.name))}</span><b>${esc(fmt(e.value))}</b></li>`).join('');
    const mine = r.mine ? `<p class="rank-mine">あなたは ${r.mine.rank}位（${esc(fmt(r.mine.value))}）${r.total ? ` / ${r.total}人` : ''}</p>` : '<p class="rank-mine">あなたの記録はまだありません</p>';
    list.innerHTML = (items ? `<ol class="rank-ol">${items}</ol>` : '<p class="invite-note">まだだれも記録していません</p>') + mine;
  };
  const drawScope = () => {
    scopeBox.innerHTML = '';
    for (const [v, label] of [['global', '全国'], ['friends', '友だち']]) {
      scopeBox.append(makeButton(label, () => { scope = v; drawScope(); load(); }, v === scope ? 'primary small' : 'secondary small'));
    }
  };
  drawScope();
  list.append(makeButton('順位を見る', load, 'primary'));
  sel.onchange = load;
}

/* ---------- スキン（アプリ全体の色。2026-10-22 本人の決定。色の一覧と使えるかは skin.js） ---------- */
// ホームの「🎨 色」で開く小窓。はじめから・遊んで解放（条件といまの数）・アプリ版で買う（値段・買う・購入を復元）に分けて並べ、押すとすぐその色になる。
function openSkins() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop skin-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '色を選ぶ');
  const box = document.createElement('div');
  box.className = 'invite-box skin-box';
  pop.append(box);
  const prices = {};
  let busy = false;
  const draw = () => {
    const rec = readRecords();
    const cur = currentSkin().id;
    const list = shownSkins();
    box.innerHTML = '<div class="invite-title">🎨 色を選ぶ</div><p class="invite-note">アプリ全体の色が変わります（自分の画面だけ）。</p>';
    for (const [kind, head] of [['free', 'はじめから選べる色'], ['unlock', '遊んで解放する色'], ['buy', '買う色']]) {
      const group = list.filter((s) => s.kind === kind);
      if (!group.length) continue;
      box.insertAdjacentHTML('beforeend', `<div class="rank-head">${head}</div>`);
      const grid = document.createElement('div');
      grid.className = 'skin-grid';
      for (const sk of group) {
        const ok = usable(sk, rec);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin-btn' + (sk.id === cur ? ' on' : '') + (ok ? '' : ' locked');
        b.setAttribute('aria-pressed', String(sk.id === cur));
        b.innerHTML = `<span class="skin-sw" style="background:${sk.sw[0]}"><i style="background:${sk.sw[1]}"></i></span><span class="skin-name">${sk.name}</span>`;
        if (!ok && kind === 'unlock') b.insertAdjacentHTML('beforeend', `<span class="skin-need">🔒 ${esc(needText(sk, rec).text)}</span>`);
        if (!ok && kind === 'buy') b.insertAdjacentHTML('beforeend', `<span class="skin-need">${prices[sk.id] === undefined ? '値段を確かめています…' : prices[sk.id] ? `🛒 ${esc(prices[sk.id])}` : 'いまは買えません'}</span>`);
        b.onclick = async () => {
          if (ok) { setSkin(sk.id); updateSky(); draw(); return; }
          if (kind !== 'buy' || busy || !prices[sk.id]) return;
          busy = true;
          const r = await buy(productOf(sk));
          busy = false;
          if (r === 'bought') { setSkin(sk.id); updateSky(); toast(`「${sk.name}」を買いました。ありがとうございます`); }
          else if (r === 'pending') toast('承認を待っています。承認されると使えるようになります');
          else if (r === 'error') toast('買えませんでした。時間をおいてもう一度お試しください');
          if (pop.isConnected) draw();
        };
        grid.append(b);
      }
      box.append(grid);
    }
    const row = document.createElement('div');
    row.className = 'invite-actions';
    if (list.some((s) => s.kind === 'buy')) {
      row.append(makeButton('購入を復元', async () => {
        if (busy) return;
        busy = true;
        const buys = SKINS.filter((s) => s.kind === 'buy');
        await restore(productOf(buys[0]));
        busy = false;
        const n = buys.filter((s) => owns(productOf(s))).length;
        toast(n ? `買った色を復元しました（${n}色）` : 'この Apple ID で色を買った記録が見つかりませんでした');
        if (pop.isConnected) draw();
      }, 'secondary'));
    }
    row.append(makeButton('閉じる', closeInvite, 'secondary'));
    box.append(row);
  };
  draw();
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  box.querySelector('.skin-btn.on')?.focus();
  // 買う色の値段（Apple が決めた書き方）を読む
  const buys = shownSkins().filter((sk) => sk.kind === 'buy' && !owns(productOf(sk)));
  Promise.all(buys.map(async (sk) => { prices[sk.id] = await priceOf(productOf(sk)); })).then(() => { if (pop.isConnected && buys.length) draw(); });
}

/* ---------- 広告を消す（App Store 版だけ。2026-10-22 本人の決定。買う・復元は ads.js） ---------- */
// ホームの下の段のボタンから開く小窓。値段・「買う」・「購入を復元」（Apple の決まりで必須）を出す。対局の画面には出さない（本人の選択）。
const noAdsBtn = el('btn-noads');
function showNoAdsBtn() {
  noAdsBtn.hidden = !canBuyNoAds();
  noAdsBtn.textContent = hasNoAds() ? '広告なし（購入済み）' : '広告を消す';
}
onNoAdsChange(showNoAdsBtn);

function openNoAds() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop noads-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '広告を消す');
  const box = document.createElement('div');
  box.className = 'invite-box';
  pop.append(box);
  let busy = false;
  const draw = (price) => {
    const owned = hasNoAds();
    box.innerHTML = `<div class="invite-title">広告を消す</div>
      <p class="invite-note">${owned
    ? '購入済みです。ホーム画面・待合室の帯の広告と、対局のあとの全画面の広告は出ません。'
    : '1回の買い切りで、ホーム画面・待合室の帯の広告と、対局のあとの全画面の広告が出なくなります。ゲームの勝ち負けには関わりません。'}</p>`;
    if (!owned) {
      const buy = makeButton(price === undefined ? '値段を確かめています…' : price ? `広告を消す（${price}）` : 'いまは買えません', async () => {
        if (busy) return;
        busy = true;
        buy.disabled = true;
        const r = await buyNoAds();
        busy = false;
        if (r === 'bought') { toast('広告を消しました。ありがとうございます'); draw(price); return; }
        buy.disabled = false;
        if (r === 'pending') toast('承認を待っています。承認されると広告が消えます');
        else if (r === 'error') toast('買えませんでした。時間をおいてもう一度お試しください');
      }, 'primary noads-buy');
      buy.disabled = !price;
      box.append(buy);
      if (price === null) box.insertAdjacentHTML('beforeend', '<p class="invite-note">App Store につながらないか、準備中です。時間をおいてもう一度開いてください。</p>');
    }
    const row = document.createElement('div');
    row.className = 'invite-actions';
    if (!owned) row.append(makeButton('購入を復元', async () => {
      if (busy) return;
      busy = true;
      const ok = await restoreNoAds();
      busy = false;
      toast(ok ? '購入を復元しました。広告は出ません' : 'この Apple ID で「広告を消す」を買った記録が見つかりませんでした');
      if (ok) draw(price);
    }, 'secondary'));
    row.append(makeButton('閉じる', closeInvite, 'secondary'));
    box.append(row);
  };
  draw(undefined);
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  box.querySelector('.invite-actions button')?.focus();
  if (!hasNoAds()) noAdsPrice().then((p) => { if (pop.isConnected) draw(p); });
}

/* ---------- 部屋に鍵をかける（2026-11-13 便利機能の1回目。本人の決定「パスワードで入れる」。room.md） ---------- */
// ホストが「招待する」の小窓で 🔒 を押すときにパスワードを決める（S.lockPw。ホストの端末にだけ持ち、state では「鍵がかかっているか」だけを送る）。
// 鍵がかかっている間、新しく入る人は hello に pw を入れないと入れない（ホストが type: 'locked' を返し、ゲストはパスワードの小窓を出す）。
// いま部屋にいる人と、一度入ったことのある端末（S.devs に印がある）はパスワードなしで入れる（本人の承認）。招待リンクと QR コードにはパスワードを入れない（本人の承認）。
// Claude の判断: パスワードは全角・半角と大文字・小文字をそろえて比べる（口で伝えたとき打ち方が違っても通るように）。20文字まで。
// 入れなかった人の名前をホストに一言で出す（同じ人は20秒に1回まで）。パスワードは公開の中継サーバーを通るので、ほかで使っているパスワードは使わないよう小窓に書いた。
const PW_MAX = 20;
const cleanPw = (t) => String(t ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase().slice(0, PW_MAX);
function lockedOut(msg, dev) {
  if (!S.lockPw || S.members.includes(msg.from)) return false;
  if (dev && Object.values(S.devs ?? {}).includes(dev)) return false; // 一度入ったことのある端末
  return cleanPw(msg.pw) !== S.lockPw;
}
function refuseLocked(msg, name) {
  const bad = !!cleanPw(msg.pw);
  send({ type: 'locked', to: msg.from, bad });
  S.knockAt ??= {};
  if (Date.now() - (S.knockAt[msg.from] ?? 0) < 20000) return;
  S.knockAt[msg.from] = Date.now();
  const who = name ? `${mask(name)}さん` : 'だれか';
  toast(bad ? `🔒 ${who}がパスワードをまちがえました` : `🔒 ${who}が入ろうとしています（パスワードを伝えてください）`);
}
// ゲスト: 鍵がかかっていて入れなかった。bad = 入れたパスワードがちがった
function onLocked(bad) {
  if (S.lockWait && !bad) return; // もう聞いている
  S.lockWait = true;
  render();
  if (bad) toast('パスワードがちがいます');
  if (!document.querySelector('.invite-pop:not(.closing) .pw-ask')) askPassword(); // 閉じかけの小窓は数えない（間違いの返事が速いと、新しい小窓を開かずに消えたままになった。2026-11-13 Codex の点検の指摘）
}
function askPassword() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', 'パスワード');
  pop.innerHTML = `<form class="invite-box name-ask pw-ask">
    <label class="invite-title" for="ask-pw">🔒 パスワード</label>
    <p class="invite-note">この部屋には鍵がかかっています。部屋を作った人に聞いたパスワードを入れてください。</p>
    <input id="ask-pw" maxlength="${PW_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="invite-actions"></div>
  </form>`;
  const form = pop.querySelector('form');
  const input = pop.querySelector('#ask-pw');
  const ok = makeButton('入る', null);
  ok.type = 'submit';
  const session = S;
  const cancel = () => { closeInvite(); if (S === session) leave(false); };
  form.querySelector('.invite-actions').append(ok, makeButton('やめる', cancel, 'secondary'));
  const check = () => { ok.disabled = !cleanPw(input.value); };
  input.addEventListener('input', check);
  check();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = cleanPw(input.value);
    if (!pw || S !== session) return;
    closeInvite();
    S.pw = pw;
    S.lockWait = false;
    saveRoom();
    askState();
    render();
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
  document.body.append(pop);
  input.focus();
}
// ホスト: パスワードを決めて鍵をかける
function askLock() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '部屋に鍵をかける');
  pop.innerHTML = `<form class="invite-box name-ask">
    <label class="invite-title" for="ask-lock">🔒 部屋に鍵をかける</label>
    <p class="invite-note">新しく入る人は、このパスワードを入れないと入れません。いま部屋にいる人と、一度入ったことのある人はそのまま入れます。<br>
    招待リンクと QR コードにはパスワードを入れないので、友だちには別に伝えてください。ほかで使っているパスワードは使わないでください。</p>
    <input id="ask-lock" maxlength="${PW_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="例: 1234">
    <div class="invite-actions"></div>
  </form>`;
  const form = pop.querySelector('form');
  const input = pop.querySelector('#ask-lock');
  const ok = makeButton('鍵をかける', null);
  ok.type = 'submit';
  form.querySelector('.invite-actions').append(ok, makeButton('やめる', invite, 'secondary'));
  const check = () => { ok.disabled = !cleanPw(input.value); };
  input.addEventListener('input', check);
  check();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = cleanPw(input.value);
    if (!pw || !S?.isHost) return;
    S.lockPw = pw;
    saveRoom();
    sendState();
    renderRoomBar();
    toast('🔒 鍵をかけました');
    invite();
  });
  pop.addEventListener('click', (e) => { if (e.target === pop) invite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') invite(); });
  document.body.append(pop);
  input.focus();
}
function unlockRoom() {
  if (!S?.isHost) return;
  S.lockPw = null;
  saveRoom();
  sendState();
  renderRoomBar();
  toast('🔓 鍵を外しました');
  invite();
}

function invite() {
  closeInvite();
  const href = inviteUrl();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '友だちを招待する');
  pop.innerHTML = `<div class="invite-box">
    <div class="invite-title">友だちを招待する</div>${S.roomName ? `<div class="invite-room">🏷 ${esc(S.roomName)}</div>` : ''}
    <div class="invite-qr" aria-live="polite"><span class="invite-wait">QR コードを作っています…</span></div>
    <p class="invite-note">そばにいる友だちは、スマホのカメラでこの QR コードを読み取ると入れます。</p>
    <div class="invite-code">部屋コード <strong>${esc(S.code)}</strong></div>
    ${S.lockPw ? `<div class="invite-code invite-lock">🔒 パスワード <strong>${esc(S.lockPw)}</strong><br><small>リンクと QR コードには入っていません。友だちに伝えてください。</small></div>` : ''}
  </div>`;
  const box = pop.querySelector('.invite-box');
  const row = document.createElement('div');
  row.className = 'invite-actions';
  row.append(makeButton('リンクを送る', shareInvite), makeButton('閉じる', closeInvite, 'secondary'));
  box.append(row);
  if (S.isHost) { // 部屋に鍵をかける（2026-11-13）
    const lock = document.createElement('div');
    lock.className = 'invite-actions';
    lock.append(S.lockPw ? makeButton('🔓 鍵を外す', unlockRoom, 'ghost small') : makeButton('🔒 鍵をかける', askLock, 'ghost small'));
    box.append(lock);
  }
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); }); // 外側を押したら閉じる
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  pop.querySelector('.invite-actions button')?.focus();
  const code = S.code;
  loadQr().then((qrcode) => {
    const slot = pop.querySelector('.invite-qr');
    if (slot && S?.code === code) slot.innerHTML = qrSvg(qrcode, href);
  }).catch(() => {
    const slot = pop.querySelector('.invite-qr');
    if (slot) slot.innerHTML = '<span class="invite-wait">QR コードを作れませんでした（電波を確かめてください）。リンクを送ってください。</span>';
    pop.querySelector('.invite-note')?.remove();
  });
}

/* ---------- 通信 ---------- */

function openNet() {
  const session = S;
  try {
    S.net = connectRoom(
      S.code, S.myId,
      (msg) => { if (S === session) onMessage(msg); },
      (status) => { if (S === session) onConn(status); },
      (msg) => { if (S === session) onSelf(msg); },
    );
  } catch {
    S.conn = 'error';
    render();
  }
}

// 裏に回ったあと戻ったら、すぐつなぎ直す（2026-10-30 本人の依頼「少し裏に回るとすぐ切れる」）。
// iPhone などは裏に回ると通信を黙って止めるが、mqtt.js は keepalive が切れるまで（最長45秒ほど）気づかないので、
// 3秒より長く裏にいたら、古いつなぎ方を捨てて作り直す。つながると onConn('ready') が hello と state を送り直し、抜けていた手も取り戻す。
const HIDDEN_RECONNECT_MS = 3000;
let hiddenAt = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  const long = hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_RECONNECT_MS;
  hiddenAt = null;
  if (S?.mode === 'online' && takenByOther(readJson(LAST_AT_KEY))) { yieldRoom(); return; } // 裏で止まっている間に、別のタブが「さっきの部屋へ」でこの部屋に戻った（つなぎ直して古い中身を送る前に出る）
  if (!long || S?.mode !== 'online' || !S.net) return;
  const old = S.net;
  openNet(); // 赤い帯は出さない（新しいつなぎ方が 'ready' を知らせたら hello を送り直す）
  old.close();
});

function send(msg, qos) { S?.net?.send(msg, qos); }
function sendState() {
  const { gameId, round, first, seed, order, cpus, moves, members, names, rules, prev, pick, undo, streak, beg } = S;
  send({ type: 'state', gameId, round, first, seed, order, cpus, moves, members, names, rules, prev, pick, u: undo ?? 0, streak: streak ?? null, beg: beg ?? [], tally: S.tally ?? null, stay: !!S.stay, line: S.line ?? [], marks: S.marks ?? {}, timer: S.timer ?? null, history: S.history ?? [], ready: S.ready ?? null, votes: S.votes ?? {}, roomName: S.roomName ?? '', cpuAuto: !!S.cpuAuto, rps: S.rps ?? null, ptsMode: !!S.ptsMode, again: S.again ?? null, away: S.away ?? [], bench: S.bench ?? [], draw: S.draw ?? null, colors: S.colors ?? null, colorKeep: S.colorKeep ?? null, locked: !!S.lockPw });
}
function sendMoves() { send({ type: 'move', gameId: S.gameId, round: S.round, moves: S.moves, u: S.undo ?? 0 }); }
function askState() { send({ type: 'hello', isHost: false, name: myName(), beg: beginner, mark: myMark(), dev: myDev(), pw: S.pw || undefined }); }

function onConn(status) {
  const back = status === 'ready' && S.everReady && S.conn !== 'ready';
  S.conn = status;
  if (status === 'ready') {
    if (back) toast('通信がもどりました');
    S.everReady = true;
    S.pingAt = null;
    send({ type: 'hello', isHost: S.isHost, name: myName(), beg: beginner, mark: myMark(), dev: myDev(), pw: S.isHost ? undefined : S.pw || undefined });
    if (S.isHost) { setBeg(S.myId, beginner); setMark(S.myId, myMark()); sendState(); }
    // ゲストは手の一覧も送り直す。裏から戻ってつなぎ方を作り直すと、まだ届いていなかった手は古いつなぎ方と一緒に捨てられるため
    // （ホストが食い違いを見て手を足し直す。ホストのほうが正しければ state が返ってきて合わせる）
    else if (S.order && S.moves.length) sendMoves();
  }
  render();
}

function onMessage(msg) {
  if (msg.to && msg.to !== S.myId) return;
  if (msg.type === 'probe') { if (S.members.includes(S.myId)) send({ type: 'here', to: msg.from }); return; } // さっきの部屋へ戻る（2026-11-13）: 部屋にだれかいるかの問い合わせ
  if (msg.type === 'here') return;
  const wasAlive = alive(msg.from);
  S.seen[msg.from] = Date.now();
  if (msg.type === 'stream') { // 見た目だけの中身。手の一覧には入れず、描き直しもしない（相手の迷い（peek）だけは描き直す）
    if (msg.d?.peek !== undefined && !GAMES[S.gameId]?.multi) onPeek(msg);
    else if (msg.gameId === S.gameId && msg.round === S.round) GAMES[S.gameId]?.onStream?.(msg.d, S.order?.indexOf(msg.from) ?? -1);
    if (!wasAlive) render();
    return;
  }
  if (msg.type === 'cpusay') return; // CPU のひとこと（やめた）
  if (msg.type === 'react') { // リアクション。描き直さない。対局の画面でだけ出す（待合室へ戻った直後に遅れて届いた分は出さない）
    if (S.order) showReaction(msg.from, msg.w);
    if (!wasAlive) render();
    return;
  }
  if (msg.type === 'live') {
    if (msg.gameId === S.gameId && msg.round === S.round) S.liveHandle?.receive(msg.d, S.order?.indexOf(msg.from) ?? -1);
    if (!wasAlive) render();
    return;
  }
  switch (msg.type) {
    case 'hello':
      if (S.isHost && !msg.isHost) acceptMember(msg);
      else if (!S.isHost && msg.isHost) { S.hostLeft = false; askState(); } // ホストが入り直した
      break;
    case 'state':
      if (!S.isHost) adoptState(msg);
      break;
    case 'full':
      S.full = true;
      break;
    case 'locked': // 鍵がかかっていて入れない（ホストからだけ。まだ部屋に入れてもらう前）
      if (!S.isHost && !S.members.includes(S.myId)) onLocked(msg.bad === true);
      return;
    case 'rest': // 自分から観戦に回る・戻る（2026-11-13）
      if (S.isHost && msg.from !== S.myId && S.members.includes(msg.from)) setRest(msg.from, msg.on === true);
      break;
    case 'sit': // 観戦の人が、部屋を出た人の席に入りたい（途中から空いた席に入る）
      if (S.isHost && msg.from !== S.myId) takeSeat(msg.from, msg.p, msg.gameId, msg.round);
      return;
    case 'kick':
      // ホストから（まだ部屋に入れてもらう前なら、届いたもの）だけ受け付ける
      if (!S.isHost && (!S.members.length || msg.from === S.members[0])) { onKicked(msg.ban !== false); return; }
      break;
    case 'again': // もう一回の OK（ok: false は待合室を選んだ）
      if (S.isHost && msg.from !== S.myId) onAgain(msg.from, msg.ok === true, msg.round, msg.v);
      return;
    case 'away': // 対局の途中で待合室へ行った・戻った（その間、席は CPU）
      if (S.isHost && msg.from !== S.myId && msg.round === S.round && S.order?.includes(msg.from)) {
        S.away = msg.on === true ? [...new Set([...(S.away ?? []), msg.from])] : (S.away ?? []).filter((id) => id !== msg.from);
        saveRoom();
        sendState();
      }
      break;
    case 'replaced': // 同じ端末から入り直した別の画面が、この画面の席を引き継いだ
      if (!S.isHost && msg.from === S.members[0]) { leave(false); toast('別の画面でこの部屋に入り直したので、この画面は部屋を出ました'); return; }
      break;
    case 'move':
      onMoves(msg);
      break;
    case 'undo':
      onUndo(msg);
      break;
    case 'pred': // 勝敗予想。対局が同じで、番号が正しく、まだ予想していない人の分だけ覚える
      if (msg.gameId === S.gameId && msg.round === S.round && S.order && Number.isInteger(msg.p) && msg.p >= 0 && msg.p < S.order.length && S.members.includes(msg.from)) setPred(msg.from, msg.p);
      return;
    case 'lot': // 先手をくじで決めた（ホストからだけ）。席は state で届くので、ここでは一言だけ出す
      onLot(msg);
      return;
    case 'award': // お開きの表彰（ホストからだけ）。描き直さない
      if (!S.isHost && S.members.length && msg.from === S.members[0]) showAward();
      return;
    case 'ready': // 準備OK（待合室の間だけ。古い待合室の知らせは捨てる）
      if (S.isHost && msg.from !== S.myId && S.members.includes(msg.from) && msg.round === S.round && !S.order) {
        setReady(msg.from, msg.on === true);
        sendState();
      }
      break;
    case 'rps': // 待合室でじゃんけん
      if (S.isHost && msg.from !== S.myId && S.members.includes(msg.from) && !S.order && Number.isInteger(msg.n) && rpsPut(msg.from, msg.h, msg.n)) {
        sendState();
        render();
      }
      break;
    case 'vote': // 次のゲームの投票
      if (S.isHost && msg.from !== S.myId && S.members.includes(msg.from) && (msg.g === null || typeof msg.g === 'string')) {
        setVote(msg.from, msg.g);
        sendState();
      }
      break;
    case 'drawStart': // 遊びの抽選を始めたい（だれでも）
      if (S.isHost && msg.from !== S.myId && S.members.includes(msg.from) && !S.order && !S.draw) startDraw(msg.from);
      return;
    case 'drawVote': // 遊びの抽選で選んだ
      if (S.isHost && msg.from !== S.myId && Number.isInteger(msg.n) && typeof msg.c === 'string') { onDrawVote(msg.from, msg.n, msg.c); render(); }
      return;
    case 'drawn': // 遊びの抽選で決まった（ホストからだけ）。ゲームは state で届くので、ここでは一言だけ出す
      onDrawn(msg);
      return;
    case 'rematch':
      if (S.isHost) {
        const st = replay(S);
        if (st && GAMES[S.gameId].result(st)) newRound(S.gameId);
      }
      break;
    case 'bye':
      if (S.isHost && S.members.includes(msg.from)) {
        S.members = S.members.filter((id) => id !== msg.from);
        saveRoom();
        sendState();
      } else if (!S.isHost && msg.from === S.members[0]) {
        S.hostLeft = true;
      }
      break;
    case 'ping':
      if (wasAlive) { renderRoomBar(); return; } // 何も変わらないので盤は描き直さない
      break;
    default:
      break;
  }
  render();
}

function acceptMember(msg) {
  const dev = typeof msg.dev === 'string' && /^[a-z0-9]{12}$/.test(msg.dev) ? msg.dev : '';
  if (S.banned.includes(msg.from) || (dev && S.bannedDevs?.includes(dev))) { send({ type: 'kick', to: msg.from }); return; }
  const name = cleanName(msg.name);
  if (lockedOut(msg, dev)) { refuseLocked(msg, name); return; }
  // 同じ端末から入り直してきた人（名前も同じか、前の人の合図が途切れている）は、前の席を引き継ぐ
  const old = dev && !S.members.includes(msg.from) ? S.members.find((id) => id !== S.myId && S.devs?.[id] === dev && (cleanName(S.names[id]) === name || !alive(id))) : null;
  if (old) {
    replaceMember(old, msg.from, name);
  } else if (S.members.includes(msg.from)) {
    if (name && S.names[msg.from] !== name) S.names[msg.from] = name;
  } else if (S.members.length < MAX_MEMBERS) {
    S.members.push(msg.from);
    S.names[msg.from] = name || 'プレイヤー' + (Object.keys(S.names).length + 1);
  } else {
    send({ type: 'full', to: msg.from });
    return;
  }
  // 端末の印は部屋に入れてから覚える（鍵の「一度入ったことのある端末」に使うため。2026-11-13 Codex の点検の指摘: 満員で断った端末も、あとで鍵をパスワードなしで抜けられた）
  if (dev) S.devs = { ...(S.devs ?? {}), [msg.from]: dev };
  setBeg(msg.from, msg.beg === true);
  setMark(msg.from, msg.mark);
  saveRoom();
  sendState();
}

function adoptState(msg) {
  const game = GAMES[msg.gameId];
  if (!game?.ready || !Array.isArray(msg.moves) || !Array.isArray(msg.members)) return;
  if (!msg.members.includes(S.myId)) {
    // まだ部屋に入れてもらっていない（hello を送り続ける）。パスワードを聞いている間にホストが鍵を外したら、小窓を閉じて入り直す（2026-11-13 Codex の点検の指摘。入力待ちのまま止まっていた）
    if (S.lockWait && msg.locked === false) {
      S.lockWait = false;
      dropPop(document.querySelector('.invite-pop:not(.closing) .pw-ask')?.closest('.invite-pop'));
      askState();
      render();
    }
    return;
  }
  S.full = false;
  S.lockWait = false;
  S.locked = msg.locked === true;
  S.hostLeft = false;
  S.members = msg.members.slice();
  S.names = { ...msg.names };
  const oldRules = nextRulesOf(); // 結果の画面でホストがルールを変えたかを見るため（againRuleNote）
  const oldVer = S.round === msg.round && S.gameId === msg.gameId ? againVer() : Infinity;
  S.rules = msg.rules && typeof msg.rules === 'object' ? msg.rules : {};
  S.beg = Array.isArray(msg.beg) ? msg.beg.filter((id) => typeof id === 'string') : [];
  S.streak = msg.streak && typeof msg.streak === 'object' && msg.streak.wins && typeof msg.streak.wins === 'object' ? msg.streak : null;
  S.history = Array.isArray(msg.history)
    ? msg.history.filter((h) => GAMES[h?.g] && Array.isArray(h.w)).slice(0, HISTORY_MAX).map((h) => ({ g: h.g, w: h.w.filter((x) => typeof x === 'string').map((x) => x.slice(0, 30)) }))
    : null;
  S.tally = msg.tally && Number.isInteger(msg.tally.games) && msg.tally.wins && typeof msg.tally.wins === 'object' ? { ...msg.tally, best: cleanBest(msg.tally.best) } : null;
  S.stay = msg.stay === true;
  S.cpuAuto = msg.cpuAuto === true;
  S.ptsMode = msg.ptsMode === true;
  S.roomName = mask(cleanRoomName(msg.roomName));
  S.marks = msg.marks && typeof msg.marks === 'object' ? Object.fromEntries(Object.entries(msg.marks).filter(([id, m]) => typeof id === 'string' && MARKS.includes(m) && m)) : {};
  const tm = msg.timer;
  S.timer = tm && typeof tm.key === 'string' && Number.isFinite(tm.start) && (tm.end === null || Number.isFinite(tm.end)) ? { key: tm.key, start: tm.start, end: tm.end } : null;
  S.line = Array.isArray(msg.line) ? msg.line.filter((id) => typeof id === 'string') : [];
  const rd = msg.ready;
  S.ready = rd && Number.isInteger(rd.round) && Array.isArray(rd.ids) ? { round: rd.round, ids: rd.ids.filter((id) => typeof id === 'string') } : null;
  const rp = msg.rps; // 待合室でじゃんけん
  S.rps = rp && Number.isInteger(rp.n) && rp.hands && typeof rp.hands === 'object' ? { n: rp.n, hands: Object.fromEntries(Object.entries(rp.hands).filter(([id, h]) => typeof id === 'string' && RPS[h])) } : null;
  S.votes = msg.votes && typeof msg.votes === 'object' ? Object.fromEntries(Object.entries(msg.votes).filter(([id, g]) => typeof id === 'string' && typeof g === 'string' && GAMES[g]?.ready)) : {};
  const ag = msg.again; // もう一回の OK
  S.again = ag && Number.isInteger(ag.round) && Array.isArray(ag.ids)
    ? { round: ag.round, ids: ag.ids.filter((id) => typeof id === 'string'), v: Number.isInteger(ag.v) ? ag.v : 0, ...(ag.rules && typeof ag.rules === 'object' && !Array.isArray(ag.rules) ? { rules: ag.rules } : {}) }
    : null;
  againRuleNote(oldRules, oldVer);
  S.away = Array.isArray(msg.away) ? msg.away.filter((id) => typeof id === 'string') : [];
  S.bench = Array.isArray(msg.bench) ? msg.bench.filter((id) => typeof id === 'string') : [];
  const dr = msg.draw; // 遊びの抽選
  S.draw = dr && Number.isInteger(dr.n) && Array.isArray(dr.opts) && dr.opts.length && dr.opts.length <= 3 && dr.opts.every((g) => typeof g === 'string' && GAMES[g]?.ready) && dr.votes && typeof dr.votes === 'object'
    ? { n: dr.n, by: typeof dr.by === 'string' ? dr.by : '', re: dr.re === true, opts: dr.opts.slice(), votes: Object.fromEntries(Object.entries(dr.votes).filter(([id, c]) => typeof id === 'string' && (c === DRAW_OTHER || dr.opts.includes(c)))), seen: [] }
    : null;
  if (S.round !== msg.round || S.gameId !== msg.gameId) S.lobbyView = false; // 次の対局が始まったら、待合室を見ていた人も対局の画面へ
  for (const id of S.members) S.seen[id] ??= Date.now();
  const sameRound = S.gameId === msg.gameId && S.round === msg.round;
  const mu = Number.isInteger(msg.u) ? msg.u : 0;
  if (sameRound && mu < (S.undo ?? 0)) {
    // 待ったより前の古い知らせ。手の一覧は受け取らない
  } else if (sameRound && mu === (S.undo ?? 0) && S.moves.length > msg.moves.length && isPrefix(msg.moves, S.moves)) {
    sendMoves(); // こちらの方が進んでいる（ホストが取りこぼした）ので教える
  } else if (msg.order === null || replay(msg)) {
    // 同じ対局のまま席の人が替わった（途中から空いた席に入る）ら一言
    const took = sameRound && Array.isArray(S.order) && Array.isArray(msg.order) && msg.order.length === S.order.length
      ? msg.order.findIndex((id, i) => id !== S.order[i] && typeof id === 'string' && !isCpu(id)) : -1;
    if (took >= 0) toast(`${msg.order[took] === S.myId ? 'あなた' : nameOf(msg.order[took])}が ${nameOf(S.order[took])} の代わりに入りました`);
    S.gameId = msg.gameId;
    S.round = msg.round;
    S.first = msg.first;
    S.seed = msg.seed;
    S.order = msg.order ? msg.order.slice() : null;
    S.cpus = msg.cpus;
    S.pick = Array.isArray(msg.pick) ? msg.pick.slice() : null;
    // 席の色（2026-11-13）。外から来た値なので、席の数と同じ長さで 0〜席の数−1 がちょうど1つずつのときだけ使う
    const cs = msg.colors, on = S.order?.length ?? 0;
    S.colors = Array.isArray(cs) && cs.length === on && [...cs].sort().every((c, i) => c === i) ? cs.slice() : null;
    const ck = msg.colorKeep; // 待合室で次の対局の色を出すため（seatColorsFor が中の値を1つずつ確かめる）
    S.colorKeep = ck && typeof ck === 'object' && typeof ck.game === 'string' && Number.isInteger(ck.n) && ck.of && typeof ck.of === 'object' && Array.isArray(ck.cpu) ? ck : null;
    S.prev = Array.isArray(msg.prev) ? msg.prev.slice() : null;
    if (sameRound && mu > (S.undo ?? 0)) toast('待ったで戻しました');
    if (!sameRound || mu !== (S.undo ?? 0)) S.undoAsk = null;
    S.moves = msg.moves.slice();
    S.undo = mu;
  }
  saveRoom();
}

function onMoves(msg) {
  if (!Array.isArray(msg.moves)) return;
  if (msg.gameId !== S.gameId || msg.round !== S.round) {
    if (S.isHost) sendState(); else askState();
    return;
  }
  const mu = Number.isInteger(msg.u) ? msg.u : 0;
  if (mu < (S.undo ?? 0)) { // 待ったより前の古い一覧。こちらが正しいので教える
    if (S.isHost) sendMoves();
    return;
  }
  if (mu > (S.undo ?? 0)) { // 待ったで短くなった一覧。ホストが決めたものなので、短くてもそのまま受け入れる
    if (!S.isHost && msg.from === S.members[0] && replay({ ...S, moves: msg.moves })) {
      S.moves = msg.moves.slice();
      S.undo = mu;
      S.undoAsk = null;
      saveRoom();
      toast('待ったで戻しました');
    } else if (!S.isHost) askState();
    return;
  }
  if (msg.moves.length > S.moves.length && isPrefix(S.moves, msg.moves) && replay({ ...S, moves: msg.moves })) {
    S.moves = msg.moves.slice();
    saveRoom();
  } else if (msg.moves.length < S.moves.length && isPrefix(msg.moves, S.moves)) {
    sendMoves(); // 相手が遅れている
  } else if (!isPrefix(msg.moves, S.moves)) {
    // 食い違い。ホストに合わせる
    if (!S.isHost && msg.from === S.members[0] && replay({ ...S, moves: msg.moves })) {
      S.moves = msg.moves.slice();
      saveRoom();
    } else if (S.isHost && (GAMES[S.gameId].realtime || GAMES[S.gameId].concurrent?.(replay(S)))) {
      rebase(msg); // 同時に動くゲームと、みんなが同時に押す場面（concurrent。ポーカーの結果の OK など）は、ホストが手を足し直す
    } else if (S.isHost) sendState(); else askState();
  }
}

/* ---------- 待った（盤のゲームのオンライン） ---------- */
// 2026-10-06 本人の決定: 自分の最後の手の前まで戻す（そのあとのほかの人の手も消える）。対局しているほかの人（CPU の席は数えない）の
// 誰か1人が「いいよ」を押したら戻る。ほかの人が全員 CPU ならすぐ戻る。ほかの人が全員「だめ」なら取り下げ。海戦ゲーム（noUndo）には付けない。
// 戻すのはホストの端末だけ（手を削って undo を進め、一覧を送る）。頼みごとは S.undoAsk = { key, by, len, no: [だめと言った人] }（保存しない）。

// それぞれの手を打った人（手の前の番）。盤のゲームの手には打った人が入っていないので、局面を当て直して調べる
function moversOf(game) {
  let st = replay({ ...S, moves: [] });
  const who = [];
  for (const m of S.moves) {
    if (!st) break;
    who.push(game.turn(st));
    st = game.apply(st, m);
  }
  return who;
}

// 待ったに「いいよ」を言える人（頼んだ人のほかの、対局している人。CPU と部屋を出た人の席は数えない）
const undoApprovers = (by) => roundOrder().filter((id) => id && id !== by && !cpuControlled(id));
const undoKey = (by, len) => `${S.gameId}:${S.round}:${S.undo ?? 0}:${len}:${by}`;

// ホストが戻す
function doUndo(len) {
  if (!S.isHost || !Number.isInteger(len) || len < 0 || len >= S.moves.length) return;
  S.moves = S.moves.slice(0, len);
  S.undo = (S.undo ?? 0) + 1;
  S.undoAsk = null;
  saveRoom();
  sendMoves();
  toast('待ったで戻しました');
}

function askUndo(len) {
  const by = S.myId;
  if (S.isHost && !undoApprovers(by).length) { doUndo(len); render(); return; }
  S.undoAsk = { key: undoKey(by, len), by, len, no: [] };
  send({ type: 'undo', act: 'ask', gameId: S.gameId, round: S.round, u: S.undo ?? 0, len });
  render();
}

function answerUndo(ok) {
  const a = S.undoAsk;
  if (!a) return;
  if (ok && S.isHost) { doUndo(a.len); render(); return; }
  send({ type: 'undo', act: ok ? 'ok' : 'no', key: a.key });
  if (!ok) noUndo(a, S.myId);
  render();
}

// だめと言った人を足す。言える人が全員だめなら取り下げ
function noUndo(a, id) {
  if (!a.no.includes(id)) a.no.push(id);
  if (undoApprovers(a.by).every((x) => a.no.includes(x))) {
    if (a.by === S.myId) toast('待ったは断られました');
    S.undoAsk = null;
  }
}

function onUndo(msg) {
  const a = S.undoAsk;
  if (msg.act === 'ask') {
    if (msg.gameId !== S.gameId || msg.round !== S.round || msg.u !== (S.undo ?? 0)) return;
    if (!Number.isInteger(msg.len) || msg.len < 0 || msg.len >= S.moves.length || !roundOrder().includes(msg.from)) return;
    if (S.isHost && !undoApprovers(msg.from).length) { doUndo(msg.len); return; }
    S.undoAsk = { key: undoKey(msg.from, msg.len), by: msg.from, len: msg.len, no: [] };
  } else if (!a || msg.key !== a.key) {
    // 古い頼みごとへの返事
  } else if (msg.act === 'ok') {
    if (S.isHost && undoApprovers(a.by).includes(msg.from)) doUndo(a.len);
  } else if (msg.act === 'no') {
    if (undoApprovers(a.by).includes(msg.from)) noUndo(a, msg.from);
  } else if (msg.act === 'cancel' && msg.from === a.by) {
    S.undoAsk = null;
  }
}

// 対局の下の段に出す「待った」のボタンか、頼みごとの返事
function appendUndo(game) {
  if (game.noUndo || game.live) return;
  const st = replay(S);
  if (!st || game.result(st)) return;
  const me = myPlayer();
  const a = S.undoAsk;
  if (a && (a.len >= S.moves.length || !roundOrder().includes(a.by))) S.undoAsk = null; // もう戻せない頼みごと
  if (S.undoAsk) {
    const box = document.createElement('div');
    box.className = 'undo-ask';
    const text = document.createElement('span');
    if (a.by === S.myId) {
      text.textContent = '待ったを頼んでいます…';
      box.append(text, makeButton('やめる', () => {
        send({ type: 'undo', act: 'cancel', key: a.key });
        S.undoAsk = null;
        render();
      }, 'ghost small'));
    } else if (undoApprovers(a.by).includes(S.myId) && !a.no.includes(S.myId)) {
      text.textContent = `${nameOf(a.by)}が待ったを頼んでいます（${S.moves.length - a.len}手戻す）`;
      box.append(text, makeButton('いいよ', () => answerUndo(true), 'primary small'), makeButton('だめ', () => answerUndo(false), 'secondary small'));
    } else {
      text.textContent = `${nameOf(a.by)}が待ったを頼んでいます`;
      box.append(text);
    }
    ctl().append(box);
    return;
  }
  if (me === null || me === SPECTATOR || !seatsFilled()) return;
  const mine = moversOf(game).lastIndexOf(me);
  if (mine < 0) return;
  const b = makeButton('待った', () => askUndo(mine), 'secondary');
  b.title = '自分の最後の手の前まで戻します（ほかの人が CPU でなければ、誰か1人の「いいよ」が要ります）';
  ctl().append(b);
}

// 同時に動くゲームで、ゲストの手とホスト側の手がぶつかったとき。ゲストの手がまだ打てるなら後ろに足す
// （手は「どの札を」で表すので、同じ手を2回足しても2回目は反則として弾かれる）
function rebase(msg) {
  const game = GAMES[S.gameId];
  let k = 0;
  while (k < msg.moves.length && k < S.moves.length && sameMove(msg.moves[k], S.moves[k])) k++;
  const sender = S.order?.indexOf(msg.from) ?? -1;
  let st = replay(S);
  for (const m of msg.moves.slice(k)) {
    if (!st || m?.p !== sender) continue;
    const next = game.apply(st, m);
    if (!next) continue;
    st = next;
    S.moves.push(m);
  }
  saveRoom();
  sendMoves();
}

// 生存確認。まだ部屋に入れていないゲストは、ホストに届くまで参加のあいさつを送り続ける
setInterval(() => {
  if (S?.mode !== 'online' || S.conn !== 'ready') return;
  if (!S.isHost && !S.members.includes(S.myId) && !S.full) { if (!S.lockWait) askState(); } // 鍵のパスワードを聞いている間は送らない
  else { send({ type: 'ping', t: Date.now() }); S.pingAt ??= Date.now(); } // t: 戻ってきたら通信の遅れを測る
  const lostKey = S.members.filter((id) => !alive(id)).join();
  if (lostKey !== S.lostKey) { S.lostKey = lostKey; render(); } else renderRoomBar();
}, HEARTBEAT_MS);

/* ---------- 起動 ---------- */

renderHome();
el('btn-about').onclick = () => openAbout();
el('btn-rank').onclick = openRanking;
el('btn-zukan').onclick = openZukan;
el('btn-skin').onclick = openSkins;
el('btn-view').onclick = openView;
noAdsBtn.onclick = openNoAds;
// ホームの下の段の「📳 振動」と「🏅 実績」（App Store 版だけ。2026-10-22 本人の決定。振動の付け外しは本人の希望で足した）
function showAppExtras() {
  const hap = el('btn-haptics');
  hap.hidden = !canHaptic();
  hap.textContent = hapticsOn() ? '📳 振動: オン' : '📳 振動: オフ';
  el('btn-achv').hidden = !canAchieve();
}
el('btn-haptics').onclick = () => {
  setHapticsOn(!hapticsOn());
  showAppExtras();
  if (hapticsOn()) haptic('tap');
};
el('btn-achv').onclick = async () => {
  if (!(await openAchievements())) toast('Game Center にログインできませんでした（iPhone の「設定」→「Game Center」でログインできます）');
};
// 自分のマークを選ぶボタン（ホーム画面）
function renderMarkPick() {
  const box = el('mark-pick');
  box.innerHTML = '';
  const cur = myMark();
  for (const m of MARKS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mark-btn' + (m === cur ? ' on' : '');
    b.textContent = m || 'なし';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(m === cur));
    b.onclick = () => {
      try { localStorage.setItem(MARK_KEY, m); } catch { /* 無視 */ }
      renderMarkPick();
    };
    box.append(b);
  }
}
renderMarkPick();
el('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  joinRoom(el('join-code').value);
});
el('btn-leave').onclick = async () => {
  if (!resultUp) { leave(); return; }
  if (S?.mode === 'online' && !confirm('部屋を出ますか？')) return; // 広告を見たあとで「やめる」にならないよう、先に聞く
  if (await beforeLeaveResult()) leave(false); // 出ると答えたので、広告の間に次の対局が始まっていても出る
};
el('btn-invite').onclick = invite;
el('btn-howto').onclick = () => {
  const box = el('howto');
  box.hidden = !box.hidden;
  el('btn-howto').setAttribute('aria-expanded', String(!box.hidden));
};
/* ---------- 音量（2026-11-13 便利機能の1回目。本人の決定「音量バーにする」） ---------- */
// 🔊 を押すと小窓が開き、効果音と声の大きさを別々の棒で変えられる（推奨を本人が承認）。小窓に「🔇 消す」も置く。
// Claude の判断: 棒は 0〜100 を10刻み。棒を動かしたら 🔇 は外れる。離したときに、効果音は「ポン」、声は短い言葉で大きさを聞かせる。
// 両方0か 🔇 のときはボタンを 🔇 にする。広告の音（アプリ版）は 🔇 か両方0のときだけ止める。
const soundBtn = el('btn-sound');
const silent = () => isMuted() || (!getVolume('se') && !getVolume('voice'));
function showSoundBtn() {
  soundBtn.textContent = silent() ? '🔇' : '🔊';
  soundBtn.title = '音の大きさ（' + (isMuted() ? '消しています' : `効果音 ${Math.round(getVolume('se') * 100)}・声 ${Math.round(getVolume('voice') * 100)}`) + '）';
  soundBtn.setAttribute('aria-label', soundBtn.title);
}
function openVolume() {
  closeInvite();
  const pop = document.createElement('div');
  pop.className = 'invite-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-label', '音の大きさ');
  pop.innerHTML = `<div class="invite-box vol-box">
    <div class="invite-title">音の大きさ</div>
    <label class="vol-row"><span>効果音</span><input type="range" min="0" max="100" step="10" data-k="se"><b></b></label>
    <label class="vol-row"><span>声</span><input type="range" min="0" max="100" step="10" data-k="voice"><b></b></label>
    <div class="invite-actions"></div>
  </div>`;
  const mute = makeButton('', () => {
    setMuted(!isMuted());
    sync();
    if (!isMuted()) play('pop');
  }, 'secondary');
  const sync = () => {
    for (const r of pop.querySelectorAll('input[type=range]')) {
      r.value = String(Math.round(getVolume(r.dataset.k) * 100));
      r.nextElementSibling.textContent = r.value;
      r.classList.toggle('off', isMuted());
    }
    mute.textContent = isMuted() ? '🔊 鳴らす' : '🔇 消す';
    setAdsMuted(silent());
    showSoundBtn();
  };
  for (const r of pop.querySelectorAll('input[type=range]')) {
    r.addEventListener('input', () => {
      if (isMuted()) setMuted(false);
      setVolume(r.dataset.k, Number(r.value) / 100);
      sync();
    });
    r.addEventListener('change', () => {
      if (r.dataset.k === 'se') play('pop');
      else speak(GREET.start, 'vol-test', { cut: true });
    });
  }
  pop.querySelector('.invite-actions').append(mute, makeButton('閉じる', closeInvite, 'secondary'));
  pop.addEventListener('click', (e) => { if (e.target === pop) closeInvite(); });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvite(); });
  document.body.append(pop);
  sync();
  pop.querySelector('input')?.focus();
}
soundBtn.onclick = openVolume;
showSoundBtn();

const begBtn = el('btn-beginner');
function showBeginnerBtn() {
  begBtn.classList.toggle('on', beginner);
  begBtn.title = beginner ? '初心者マーク: オン（押すとオフ）' : '初心者マーク: オフ（押すとオン。いま選べる所を光らせ、名前に 🔰 を付けます）';
  begBtn.setAttribute('aria-label', begBtn.title);
  begBtn.setAttribute('aria-pressed', String(beginner));
}
begBtn.onclick = () => {
  setBeginner(!beginner);
  toast(beginner ? '🔰 初心者マークを付けました（いま選べる所が光ります）' : '初心者マークを外しました');
};
document.body.classList.toggle('beginner', beginner);
showBeginnerBtn();

checkSkin();
onOwnedChange(checkSkin); // 買う色を選んでいたのに買った記録が無い（返金など）と分かったら、いつもの色に戻す
initRecords(GAMES);
// 遊んで解放する色に届いたら知らせる
onRecords((before, after) => {
  for (const sk of newlyUnlocked(before, after)) lateToast(`🎨 新しい色「${sk.name}」が使えるようになりました（ホームの「🎨 色」）`);
});
initAds({ muted: silent() });
initNative({ games: Object.keys(GAMES).length });
showAppExtras();
showNoAdsBtn(); // 課金の部品があるかは initAds の始めで分かる（買ってあるかは分かりしだい onNoAdsChange で直す）

// 判子・帯・技の名前の字体（style.css の「見出しの字体」）は、出すときに読み始めると1秒の動きに間に合わないので先に読んでおく
try { for (const [f, t] of [['asobi-fude', '勝ち'], ['asobi-goku', 'ターン']]) document.fonts?.load(`1em ${f}`, t).catch(() => {}); } catch {}

const roomParam = new URL(location.href).searchParams.get('room');
if (!(roomParam && joinRoom(roomParam))) {
  setUrlRoom(null);
  showScreen('home');
  openingTitle();
}
