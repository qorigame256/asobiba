// 画面の切り替え・部屋の管理・対局の同期。
//
// 同期の考え方: 盤面そのものは送らず「これまでの手の一覧」を送る。受け取った側は最初の局面から
// 手を順に当て直して盤面を作る。手の一覧は短いので毎回まるごと送り、取りこぼしがあっても次の送信で追いつく。
// 部屋を作った人（ホスト）が正。食い違ったらホストの状態に合わせる。
//
// 部屋: members = いま部屋にいる人の id（先頭がホスト）。人数の上限は MAX_MEMBERS。names = id → 表示名。
// 対局の参加者（ゲームの中のプレイヤー番号 → 人の id）:
//   盤のゲーム: 待合室でホストが先手と後手を選ぶ（pick。人か 'cpu'）。もう一回では先手と後手を入れ替える。
//     席は2つ。詳細設定で人数が決まるゲーム（seatCount を持つマルバツ・コネクトフォー・リバーシ・点と線・将棋・マンカラ・エアホッケー）は人数ぶん選び、もう一回では打つ順番を1つずつ回す。
//     ほかの人は観戦。手には p を付けない（どちらの番かは局面で決まる）。
//   カードゲーム（multi）: 対局を始めるときにホストが order を決める。
//   オンラインでは、どちらも order が null の間は待合室。
//     'cpu1' のような id は CPU。シャッフルは seed（対局ごとにホストが決める数）から作るので全員同じ山になる。
// CPU の手はホストの端末が考えて、ふつうの手と同じように手の一覧へ足す。部屋を出た人の席も CPU が代わる。
// 時間で進むゲーム（referee を持つもの）は、ホストの端末が時間を計って「次の問題へ」「締め切り」などの手（p = -1）を足す。
// (gameId, round) が同じなら order と seed も同じ。order や seed を変えるときは必ず round を進める。
// rules = ゲームごとの詳細設定（待合室でホストだけが変えられる）。prev = 前の対局の順位（大富豪のカード交換など）。
//   carry = 次の対局へ持ち越す前の結果（人の id → 順位）。ホストが対局を始めるときに prev へ並べ替える。
// 部屋を作る・同じ画面で遊ぶのは持ち主の端末だけ（owner.js）。ほかの人は招待された部屋に入るだけ。
// banned = ホストが退出させた人の id。あいさつが来ても入れず、もう一度「退出」を送る。
// streak = 連勝（2026-10-06 本人の決定）。{ key: ゲームと顔ぶれ, counted: 数え終えた対局, wins: 人の id → 連勝の数 }。ホストだけが数えて全員へ送る。
// tally = 部屋の成績表（2026-10-06 本人の決定）。{ games: 決着した対局の数, wins: 人の id → 勝った回数, preds: 人の id → 勝敗予想が当たった回数（10回目に足した。無いこともある）,
//   played: 人の id → 対局した回数（勝率のため。24回目に足した。無いこともある） }。ゲームをまたいで数える。ホストが数えて全員へ送る。
// preds = 勝敗予想（2026-10-06 本人の決定）。{ key: どの対局か, by: 人の id → 勝つと予想したプレイヤー番号 }。各自が全員へ送りっぱなしにし、受け取った端末がそれぞれ覚える。
// beg = 初心者マークを付けている人の id の一覧（各自が自分の端末で付け外しし、ホストが集めて全員へ送る）。
// undo = この対局で「待った」をした回数（盤のゲームのオンライン）。待ったをすると手の一覧が短くなり、ふつうの同期（長い方が正）では
//   戻せないので、ホストだけが手を削って undo を1つ進め、受け手は undo が大きい一覧をそのまま受け入れる。対局が替わると 0 に戻る。
// stay = 勝ち残り（2026-10-06 本人の決定。盤のゲームのオンライン）。オンなら、もう一回で負けた人が観戦の人と交代する。line = 交代を待つ人の順番。
//   どちらもホストが決めて全員へ送る（ほかの人の画面にも「次に入る人」を出すため）。

import { GAMES, GAME_ORDER } from './games/index.js';
import { connectRoom } from './net.js';
import { esc } from './games/util.js';
import { isOwner, unlockOwner, forgetOwner } from './owner.js';
import { play, endSound, isMuted, setMuted, isVoice, speak } from './sound.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違えやすい I O 0 1 を除く
const CODE_LEN = 5;
const HEARTBEAT_MS = 5000;
const LOST_MS = 20000;
const MAX_MEMBERS = 10; // 部屋に入れる人数の上限（観戦を含む）
const CPU_DELAY_MS = 600; // CPU が手を打つまでの間（速すぎると何が起きたか追えない）
const NAME_KEY = 'bg-name';
const SPECTATOR = -1;
const TURN_PING_MS = 5000; // これより長く待ったあとで自分の番が来たら、知らせる音を鳴らす（すぐ返ってきた番では鳴らさない）

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
  try { return cleanName(localStorage.getItem(NAME_KEY)); } catch { return ''; }
}

/* ---------- 再読み込みしても部屋に戻れるよう、タブごとに覚えておく ---------- */

const SAVED_FIELDS = ['myId', 'isHost', 'gameId', 'round', 'first', 'seed', 'order', 'cpus', 'moves', 'members', 'names', 'rules', 'prev', 'carry', 'pick', 'banned', 'clock', 'undo', 'streak', 'beg', 'tally', 'preds', 'stay', 'line', 'marks', 'timer', 'history', 'ready', 'votes', 'roomName', 'cpuAuto', 'rps'];
const roomKey = (code) => 'bg2-room-' + code;
function loadRoom(code) {
  try { return JSON.parse(sessionStorage.getItem(roomKey(code))); } catch { return null; }
}
function saveRoom() {
  if (S?.mode !== 'online') return;
  const data = Object.fromEntries(SAVED_FIELDS.map((k) => [k, S[k]]));
  try { sessionStorage.setItem(roomKey(S.code), JSON.stringify(data)); } catch { /* 保存できなくても遊べる */ }
}
function forgetRoom(code) {
  try { sessionStorage.removeItem(roomKey(code)); } catch { /* 無視 */ }
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
  const n = Number(id.slice(3)) || 1;
  if (!S?.seed) return 'CPU' + id.slice(3);
  return '🤖' + CPU_NAMES[((S.seed % CPU_NAMES.length) + (n - 1) * 5) % CPU_NAMES.length];
}

function nameOf(id) {
  if (!id) return '（空席）';
  if (isCpu(id)) return cpuName(id);
  const mark = S.marks?.[id];
  return (MARKS.includes(mark) && mark ? mark + ' ' : '') + (S.names?.[id] || 'ゲスト') + (S.beg?.includes(id) ? ' 🔰' : '');
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
    if (S.isHost) { setBeg(S.myId, on); sendState(); } else send({ type: 'hello', isHost: false, name: myName(), beg: on, mark: myMark() });
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

/* ---------- 部屋の成績表（2026-10-06 本人の決定）: この部屋で決着した対局の数と、だれが何回勝ったか（ゲームをまたいで） ---------- */
// Claude の判断: 人だけを出す（CPU は出さない）。引き分けはだれも勝ちにしない。同点の1位・チームの勝ちは全員を数える。
// 部屋にいる人は0勝でも出し、出た人は勝ちがあれば出す。勝った回数の多い順。待合室と、対局の結果の画面に出す。
function tallyHtml() {
  const t = S.tally;
  if (S.mode !== 'online' || !t?.games) return '';
  const w = (id) => (Number.isInteger(t.wins[id]) ? t.wins[id] : 0); // 届いた数は整数だけ使う（外から来た値なので）
  const ids = [...new Set([...S.members, ...Object.keys(t.wins)])].filter((id) => !isCpu(id) && (S.members.includes(id) || w(id)));
  ids.sort((a, b) => w(b) - w(a));
  const list = ids.map((id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b> ${w(id)}勝${rateText(t, id, w(id))}`).join('・');
  // 勝敗予想の当たり（2026-10-07。10回目の案）: 1回でも当たった人だけ、当たった回数の多い順に出す（観戦だけの人も入る）
  const pr = t.preds && typeof t.preds === 'object' ? t.preds : {};
  const hits = (id) => (Number.isInteger(pr[id]) && pr[id] > 0 ? pr[id] : 0);
  const seers = Object.keys(pr).filter((id) => !isCpu(id) && hits(id) && (S.members.includes(id) || S.names[id])).sort((a, b) => hits(b) - hits(a));
  const seerList = seers.map((id) => `<b>${esc(id === S.myId ? 'あなた' : nameOf(id))}</b> ${hits(id)}回`).join('・');
  return `🏆 この部屋の成績（${t.games}回）: ${list}` + (seers.length ? `<br>🔮 予想の当たり: ${seerList}` : '');
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
  const w = (id) => (Number.isInteger(t?.wins?.[id]) ? t.wins[id] : 0);
  const ids = [...new Set([...S.members, ...Object.keys(t?.wins ?? {})])].filter((id) => !isCpu(id) && w(id) > 0 && (S.members.includes(id) || S.names[id]));
  const counts = [...new Set(ids.map(w))].sort((a, b) => b - a).slice(0, 3);
  return counts.map((n) => ({ n, ids: ids.filter((id) => w(id) === n) })); // 上から順に、同じ勝ち数の人をまとめる
}

function closeAward() { document.querySelector('.award-pop')?.remove(); }

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
    rows.push(`<li class="award-row"><span class="award-medal">${medal[place - 1]}</span><span class="award-place">${place}位</span><span class="award-who">${r.ids.map(who).join('・')}</span><span class="award-n">${r.n}勝</span></li>`);
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
    ${rows.length ? `<ol class="award-list">${rows.join('')}</ol>` : '<p class="award-none">だれも勝たず、みんな引き分けでした</p>'}
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
// 待合室に出す「🗳 遊びたいゲーム: 大富豪 2票・将棋 1票」（票があるときだけ）
function voteLine() {
  const n = voteCounts();
  const ids = Object.keys(n).sort((a, b) => n[b] - n[a] || gameOrder().indexOf(a) - gameOrder().indexOf(b));
  if (!ids.length) return null;
  const p = document.createElement('p');
  p.className = 'lobby-vote';
  p.textContent = '🗳 遊びたいゲーム: ' + ids.map((g) => `${GAMES[g].name} ${n[g]}票`).join('・');
  return p;
}
function voteSelect() {
  const label = document.createElement('label');
  label.className = 'game-select';
  label.textContent = '🗳 次に遊びたいゲーム ';
  const sel = document.createElement('select');
  const mine = S.votes?.[S.myId];
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（えらばない）';
  sel.append(none);
  const favs = favorites();
  for (const id of gameOrder()) {
    if (!GAMES[id].ready || id === S.gameId) continue;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = (favs.includes(id) ? '★ ' : '') + GAMES[id].name;
    opt.selected = id === mine;
    sel.append(opt);
  }
  sel.onblur = () => render(); // 開いている間に止めていた描き直しを追いつかせる（ゲームを変えると同じ）
  sel.onchange = () => {
    sel.onblur = null;
    sel.blur();
    setVote(S.myId, sel.value || null);
    send({ type: 'vote', g: sel.value || null });
    render();
  };
  label.append(sel);
  return label;
}
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
function rememberRules() {
  if (S?.mode !== 'online' || !S.isHost) return;
  try { localStorage.setItem(RULES_KEY, JSON.stringify(S.rules ?? {})); } catch { /* 覚えられなくても、この部屋では使える */ }
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
  const nm = roomNamePanel();
  if (nm) board.append(nm);
  const r = readyLine();
  if (r) board.append(r);
  const v = voteLine();
  if (v) board.append(v);
  board.append(rpsPanel());
}

/* ---------- 待合室でじゃんけん（2026-10-08。24回目の案。本人が選んだ）: 人がそろうのを待つ間のおまけ ---------- */
// Claude の判断: 待合室にいる部屋の人（ホストも観戦の人も）が ✊✌️✋ から1つ出す（出したら変えられない）。全員が出したら手を見せて勝ち負けを出す。
// 部屋に1人のときは CPU が相手（出した瞬間にホストの端末が CPU の手を決める）。勝ち負けはおまけなので、成績表・連勝には入れない。
// 出した手は、全員が出すまで「✓」とだけ見せる（簡易な隠し方。開発用の道具では覗ける）。
// ゲストは type: 'rps'（回の番号 n と手 h）を送り、ホストが S.rps（{ n, hands: 人の id → 手 }）に集めて state で送る。
// 手を見せたあとにだれかが出すと、次の回（n + 1）が始まる。見せた直後に何人かが同時に出しても、1つ前の回の番号で届いた手は次の回に入れる。
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
  const box = document.createElement('div');
  box.className = 'lobby-rps';
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
  box.innerHTML = `<p>✊ じゃんけん（待っている間のおまけ）${mine ? ` <small>あなたは ${RPS[mine]}</small>` : ''}</p><p class="rps-line">${line}</p>`;
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
  const waiting = S.members.filter((id) => !seated.has(id) && alive(id));
  if (!waiting.length) return null;
  const line = S.line ?? [];
  const queue = [...line.filter((id) => waiting.includes(id)), ...waiting.filter((id) => !line.includes(id))];
  const stayers = ids.filter((id, p) => won.has(p) && !gone(id));
  const out = ids.filter((id, p) => !won.has(p) || gone(id));
  queue.push(...out.filter((id) => id !== 'cpu' && !gone(id)));
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

// 結果から勝った人のプレイヤー番号の一覧（引き分けは空）
function winnersOf(res) {
  if (Array.isArray(res.winners)) return res.winners.filter(Number.isInteger);
  return Number.isInteger(res.winner) ? [res.winner] : [];
}

// 対局の結果を見たときに1回だけ、連勝と部屋の成績表を数える（ホストだけ）
function countResult(res) {
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
  S.tally = { games: t.games + 1, wins, preds, ...(old ? {} : { played }) };
  // 対局の履歴: 新しいものから HISTORY_MAX 個。勝った人はそのときの表示名で覚える（CPU の名前は対局ごとに変わるため）
  const names = [...won].map((id) => nameOf(id));
  S.history = [{ g: S.gameId, w: names }, ...(S.history ?? [])].slice(0, HISTORY_MAX);
  saveRoom();
  sendState();
  cpuResultSay(res);
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
// マルバツ・将棋の size は盤の大きさでなく遊び方（スーパー・消える・5五将棋）なので抽選する。
const KEEP_KEYS = new Set(['players', 'wide', 'cpu', 'speed', 'level', 'time', 'rounds', 'hands', 'length', 'points', 'voice', 'handicap', 'window', 'hint', 'goal', 'choice', 'pits', 'deal', 'waits', 'autopromo', 'tsumogiri', 'digits', 'shanten', 'match', 'check', 'mallet', 'stones', 'diffs']);
const luckSettings = (game) => (game.settings ?? []).filter((x) => !KEEP_KEYS.has(x.key) && (x.key !== 'size' || ['tictactoe', 'shogi'].includes(game.id)));

// 盤のゲームの席の数（詳細設定で人数が決まるマルバツ・コネクトフォー・リバーシ・点と線は 2〜4、エアホッケーは 2〜3。ほかは2）
const boardSeats = (gameId, rules) => GAMES[gameId]?.seatCount?.(rulesOf(gameId, rules)) ?? 2;

// 盤のゲームの席の書き添え。呼び名に「先手」「後手」が入っているゲーム（将棋）では重ねて書かない。3人以上は「◯番目」
const seatNote = (game, p, n = 2) => {
  if (n > 2) return `（${p + 1}番目）`;
  return game.players[p].includes(p === 0 ? '先手' : '後手') ? '' : `（${p === 0 ? '先手' : '後手'}）`;
};

// R = { gameId, seed, order, moves, rules, prev }（S でも、届いた state でもよい）
function replay(R) {
  const game = GAMES[R.gameId];
  if (!game?.ready) return null;
  if (game.live) return Array.isArray(R.order) && R.order.length === boardSeats(R.gameId, R.rules) ? {} : null; // 手の一覧を使わないゲーム（局面はゲームが持つ）
  let st;
  if (game.multi) {
    if (!Array.isArray(R.order) || R.order.length < game.minPlayers || R.order.length > game.maxPlayers) return null;
    st = game.init(R.order.length, R.seed, { rules: rulesOf(R.gameId, R.rules), prev: R.prev ?? null });
  } else {
    if (Array.isArray(R.order) && R.order.length !== boardSeats(R.gameId, R.rules)) return null;
    st = game.init({ rules: rulesOf(R.gameId, R.rules), seed: R.seed ?? 0 }); // seed は始めの盤を種で決めるゲーム（コネクトフォーのじゃま石）が使う
  }
  for (const m of R.moves) {
    st = game.apply(st, m);
    if (!st) return null;
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
const cpuControlled = (id) => isCpu(id) || !S.members.includes(id);
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
  const ok = (v) => (v === 'cpu' && cpuPickable(GAMES[S.gameId])) || S.members.includes(v);
  const p = S.pick;
  const people = Array.isArray(p) ? p.filter((v) => v !== 'cpu') : [];
  const q = Array.isArray(p) && p.every(ok) && new Set(people).size === people.length ? p.slice(0, n) : [];
  for (const id of S.members) if (q.length < n && !q.includes(id)) q.push(id);
  while (q.length < n) q.push('cpu');
  return q;
}

// 待合室で決まる顔ぶれ。人がゲームの上限より多ければ、あとから来た人は観戦。
// seats(rules) を持つゲーム（麻雀）は詳細設定で人数が決まり、足りない分はすべて CPU
function lineup(game) {
  const seats = game.seats?.(rulesOf(S.gameId, S.rules)) ?? null;
  const max = seats ?? game.maxPlayers;
  const humans = S.members.slice(0, max);
  const watchers = S.members.slice(max);
  if (game.noCpu) return { humans, watchers, cpus: 0, seats, max };
  let cpus = seats ? seats - humans.length
    : Math.max(0, Math.min(Math.max(S.cpus, game.minPlayers - humans.length), game.maxPlayers - humans.length));
  // チームで分かれるゲーム（玉入れ）は全員の数を偶数にする（足りなければ CPU を1人足す。上限なら1人減らす）
  if (game.evenTeams && (humans.length + cpus) % 2) cpus += humans.length + cpus < game.maxPlayers ? 1 : -1;
  return { humans, watchers, cpus, seats, max };
}

/* ---------- 画面 ---------- */

function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + name;
  window.scrollTo(0, 0);
  keepAwake(name === 'play');
  if (name !== 'play') renderNetBanner();
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

/* ---------- CPU のひとこと（2026-10-07。21回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// CPU が、勝ったとき・負けたとき・引き分けのときと、たまに打ったあとに、リアクションと同じ吹き出しで短く言う（オンラインだけ）。
// Claude の判断: 言うかどうかと言葉はホストの端末だけが決め、type: 'cpusay'（CPU の id・種類・何番目の言葉）を送りっぱなしにする（受け手はホストからの分だけ出す）。
//   決着: CPU が勝てばその CPU が必ず1回。人が勝てば CPU の1人が7割で、引き分けは5割で言う（CPU が何人いても1つだけ。にぎやかすぎないように）。
//   対局の途中: CPU が打ったあとに6%の見込みで、部屋の中で25秒に1回まで。言うのは本物の CPU だけ（部屋を出た人の代わりに打っている CPU は言わない）。
//   エアホッケーは CPU が main.js を通らないので言わない。言葉は下の CPU_LINES だけ（外から来た番号は一覧にあるときだけ使う）。
const CPU_LINES = {
  win: ['やった〜、勝ったよ！', 'よしっ！', 'ふふん、どうだ！', 'うまくいった〜'],
  lose: ['まいった〜', 'つよいね！', 'くやしい…', 'つぎは負けないぞ'],
  draw: ['いい勝負だった！', '引き分けか〜'],
  mid: ['うーん…', 'ここだ！', 'どうしようかな', 'ふむふむ', 'それっ'],
};
const CPU_MID_RATE = 0.06;
const CPU_MID_GAP_MS = 25000;

function cpuSay(id, kind) {
  const list = CPU_LINES[kind];
  if (!list || !isCpu(id)) return;
  const w = Math.floor(Math.random() * list.length);
  send({ type: 'cpusay', gameId: S.gameId, round: S.round, id, kind, w }, 0);
  showBubble(nameOf(id), list[w], 'cpu');
}

// 決着のとき（ホストが countResult で1回だけ呼ぶ）
function cpuResultSay(res) {
  const cpus = S.order.filter(isCpu);
  if (!cpus.length) return;
  const won = winnersOf(res).map((p) => S.order[p]);
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  const wonCpu = won.filter(isCpu);
  if (wonCpu.length) cpuSay(pickOne(wonCpu), 'win');
  else if (won.length && Math.random() < 0.7) cpuSay(pickOne(cpus), 'lose');
  else if (!won.length && Math.random() < 0.5) cpuSay(pickOne(cpus), 'draw');
}

// CPU が打ったあと（ホストの scheduleCpu から）
function cpuMidSay(id) {
  if (!isCpu(id) || Math.random() >= CPU_MID_RATE || Date.now() - (S.cpuSaidAt ?? 0) < CPU_MID_GAP_MS) return;
  S.cpuSaidAt = Date.now();
  cpuSay(id, 'mid');
}

// 受け取った cpusay。ホストから・いまの対局の CPU の分だけ
function onCpuSay(msg) {
  if (S.isHost || !S.members.length || msg.from !== S.members[0]) return;
  if (msg.gameId !== S.gameId || msg.round !== S.round || !isCpu(msg.id) || !S.order?.includes(msg.id)) return;
  const list = Object.hasOwn(CPU_LINES, msg.kind) ? CPU_LINES[msg.kind] : null;
  if (!list || !Number.isInteger(msg.w) || !list[msg.w]) return;
  showBubble(nameOf(msg.id), list[msg.w], 'cpu');
}

const REACTIONS = ['ナイス！', 'おしい！', 'えー！', 'やった！', 'まって！', 'ｗ']; // 言葉は本人が選んだ
const REACT_GAP_MS = 1200; // 1人がこれより短い間に送った分は出さない（連打で画面が埋まらないように）
const reactAt = {}; // 人の id → 最後に出した時刻

function showReaction(id, w) {
  if (!Number.isInteger(w) || !REACTIONS[w]) return;
  const now = Date.now();
  if (now - (reactAt[id] ?? 0) < REACT_GAP_MS) return;
  reactAt[id] = now;
  showBubble(id === S?.myId ? 'あなた' : nameOf(id), REACTIONS[w]);
}

// 画面の上に名前と言葉の吹き出しを2.6秒出す（リアクションと CPU のひとこと）
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

function renderHome() {
  const owner = isOwner();
  el('home-lead').textContent = owner
    ? '部屋を作って、友だちに招待リンクを送れば対戦できます。'
    : '招待された部屋コードを入れて参加してください。部屋を作れるのは、このサイトの持ち主だけです。';
  el('game-list-title').hidden = !owner;
  renderOwnerBox(owner);
  const list = el('game-list');
  list.innerHTML = '';
  if (!owner) return;
  const favs = favorites();
  for (const id of gameOrder()) {
    const g = GAMES[id];
    const card = document.createElement('article');
    card.className = 'game-card' + (g.ready ? '' : ' not-ready') + (favs.includes(id) ? ' fav' : '');
    card.innerHTML = `<div class="game-icon" aria-hidden="true">${g.icon}</div><h3>${g.name}</h3><p>${g.desc}</p>`;
    if (g.ready) {
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'fav-btn';
      star.textContent = favs.includes(id) ? '★' : '☆';
      star.setAttribute('aria-pressed', String(favs.includes(id)));
      star.setAttribute('aria-label', `${g.name}を お気に入り${favs.includes(id) ? 'から外す' : 'にする'}`);
      star.onclick = () => { toggleFavorite(id); renderHome(); };
      card.append(star);
    }
    if (g.ready) {
      if (g.multi) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = `${playersText(g)}・オンライン（${g.noCpu ? 'CPU なし' : '足りない分は CPU'}）`;
        card.append(tag);
      }
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      if (g.live) {
        // 毎フレーム動くゲーム（エアホッケー）: CPU 戦・同じ画面の2人（指で触れる端末だけ）・オンライン（試作）
        actions.append(makeButton('CPU と対戦', () => startLive(id, 'cpu')));
        if (navigator.maxTouchPoints > 0) actions.append(makeButton('この画面で2人で', () => startLive(id, 'two'), 'secondary'));
        actions.append(makeButton('部屋を作る（試作）', () => createRoom(id), 'secondary'));
      } else {
        actions.append(makeButton('部屋を作る', () => createRoom(id)));
        if (!g.multi && !g.noLocal) actions.append(makeButton('この画面で2人で', () => startLocal(id), 'secondary')); // noLocal = 隠す情報があるゲーム（海戦ゲーム）
      }
      card.append(actions);
    } else {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'じゅんび中';
      card.append(tag);
    }
    list.append(card);
  }
}

// 持ち主の合言葉を入れる所。持ち主の端末では「登録を外す」だけ出す（友だちの端末で入れたときに外せるように）
function renderOwnerBox(owner) {
  const box = el('owner-box');
  box.innerHTML = '';
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
  el('room-code').textContent = S.code;
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
  if (msg.type !== 'ping' || !Number.isFinite(msg.t)) return;
  S.rtt = Math.max(0, Date.now() - msg.t);
  S.pingAt = null;
  renderRoomBar();
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
      else if (t === me) main = 'あなたの番です';
      else main = `${pn(t)}の番です…`;
    }
    if (me === SPECTATOR) sub = '観戦中です（次の対局から参加できます）';
  } else {
    const n = roundOrder().length || 2;
    const name = (p) => `<b class="pl p${p}">${game.players[p]}</b>`;
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
      main = `${name(game.turn(st))}の番です`;
    } else if (!seatsFilled()) {
      main = '友だちの参加を待っています。<br>上の「招待する」で部屋のリンクを送ってください。';
    } else if (me === SPECTATOR) {
      main = `${name(game.turn(st))}（${who(game.turn(st))}）の番です`;
    } else {
      const t = game.turn(st);
      main = t === me ? 'あなたの番です' : n > 2 ? `${name(t)}（${who(t)}）の番です…` : '相手の番です…';
    }
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
  const tot = used.map((_, p) => p).map((p) => `<b class="pl p${p}">${game.players[p]}</b> ${clockText(used[p])}`).join(' ／ ');
  if (c.res) return `考えた時間 ${tot}`;
  return `⏱ <b class="pl p${c.turn}">${game.players[c.turn]}</b>が考え中 <b>${clockText(live)}</b>　合計 ${tot}`;
}

setInterval(() => {
  const box = el('think');
  if (!S?.clock || !box?.isConnected || S.clock.res) return;
  box.innerHTML = thinkHtml(GAMES[S.gameId]);
}, 500);

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
    const rules = document.createElement('div');
    rules.className = 'howto-rules';
    const head = document.createElement('b');
    head.textContent = '📋 いまのルール';
    const body = document.createElement('span');
    body.textContent = changed.length ? `（最初と変えたもの）${changed.join('・')}` : '（詳細設定は最初のまま）';
    rules.append(head, ' ', body);
    box.replaceChildren(...lines, ...(game.settings?.length ? [rules] : [])); // 詳細設定の無いゲームには出さない
  }
  btn.setAttribute('aria-expanded', String(!box.hidden));
}

// 下の段（ボタンと「ゲームを変える」）を作る場所。「ゲームを変える」の一覧を開いている間は、作り直さず
// 画面に出ない入れ物へ作って捨てる（作り直すと開いた一覧が閉じる。手が次々に届く難読漢字などで選べなかった）
let controlsEl = null;
const ctl = () => controlsEl;

// 描き直しの間はページの長さを今のまま保つ。作り直しの途中でページが一瞬短くなると、下へスクロールしていた
// 画面が上へ引き戻される（麻雀で牌を押すたびに起きた）
function render() {
  if (!S) return;
  const body = document.body;
  body.style.minHeight = document.documentElement.scrollHeight + 'px';
  S.myTurnNow = false;
  try { renderPage(); } finally { body.style.minHeight = ''; setTurnTitle(S?.myTurnNow); }
}

/* ---------- 番が来たらタブの名前で知らせる（2026-10-07。10回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// オンラインで自分の番のあいだ、タブの名前の頭に「● あなたの番」を付ける（ほかのタブを見ていても気づけるように）。
// Claude の判断: 番が決まるゲームだけ（全員が同時に動く realtime のゲームと、番の決まらない場面（turn が null）では付けない。「番が来た」音と同じ考え方）。
const BASE_TITLE = typeof document !== 'undefined' ? document.title : '';
const TURN_TITLE = '● あなたの番 - ';
function setTurnTitle(on) {
  const want = on ? TURN_TITLE + BASE_TITLE : BASE_TITLE;
  if (document.title !== want) document.title = want;
}
const myTurnNow = (game, st, res) => S.mode === 'online' && !game.realtime && canMove(game, st, res) && (!game.multi || game.turn(st) === myPlayer());

function renderPage() {
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
    else if (S.conn === 'error') waiting = '通信サーバーにつながりませんでした。ネットにつながっているか確かめて、ページを読み込み直してください。';
    else if (!game && S.conn !== 'ready') waiting = '通信サーバーにつないでいます…';
    else if (!game) waiting = '部屋の情報を待っています…<br>しばらく待っても変わらないときは、部屋コードが合っているか確かめてください。';
  }
  if (!waiting && game?.live && (S.mode === 'local' || S.order)) { renderLive(game); return; }
  stopLive();
  if (!waiting && S.mode === 'online' && !S.order) {
    if (game.multi) renderLobby(game); else renderBoardLobby(game);
    appendMemberPanel();
    return;
  }
  const st = waiting ? null : replay(S);
  if (!waiting && !st) waiting = '対局のデータを読み直しています…';
  if (waiting) {
    status.innerHTML = `<div class="status-main small">${waiting}</div>`;
    board.innerHTML = '';
    board.className = 'board';
    return;
  }

  const res = game.result(st);
  S.myTurnNow = myTurnNow(game, st, res);
  if (!game.multi) tickClock(game, st, res);
  trackTime(res);
  greetStart(res);
  if (res) countResult(res);
  if (res) countLocal(game, res);
  status.innerHTML = statusHtml(game, st, res);
  if (res && !game.multi && renderReview(game, st)) return; // ふりかえりで途中の局面を見ている

  // 新しく打たれた手だけ動きを付ける（接続表示の更新などで描き直したときは動かさない）
  const key = S.gameId + ':' + S.round;
  const prevLen = S.shownKey === key ? S.shownLen : null;
  const fresh = prevLen !== null && S.moves.length > prevLen;
  if (S.shownKey !== key && !S.moves.length && game.startSound) play(game.startSound);
  S.shownKey = key;
  S.shownLen = S.moves.length;
  const opts = { canMove: canMove(game, st, res), onMove: onBoardMove, fresh, me: myPlayer(), view: boardView(game) };
  if (game.multi) {
    Object.assign(opts, {
      names: S.order.map(nameOf),
      cpu: S.order.map(cpuControlled),
      sub: S.order.map((id) => !isCpu(id) && cpuControlled(id)), // 部屋を出た人の席を CPU が代わりに打っている
      away: S.order.map((id) => !isCpu(id) && S.members.includes(id) && !alive(id)),
      // 見た目だけの中身（ほかの人の位置など）を送りっぱなしにする。届いた側ではゲームの onStream が受け取る
      stream: (d) => { if (S.mode === 'online') send({ type: 'stream', gameId: S.gameId, round: S.round, d }, 0); },
    });
  }
  game.render(board, st, opts);
  if (beginner && opts.canMove && BEG_GAMES.has(S.gameId) && [...board.querySelectorAll('.playable, .usable, button')].some((e) => getComputedStyle(e).getPropertyValue('--beg').trim() === '1')) {
    status.insertAdjacentHTML('beforeend', '<div class="status-sub beg-hint">🔰 光っている所が、いま選べる所です</div>');
  }
  if (fresh) moveSound(game, st, res, prevLen, opts.canMove);
  if (!opts.canMove && S.couldMove !== false) S.waitFrom = Date.now();
  S.couldMove = opts.canMove;

  if (res) {
    if (!game.multi) appendReview(game);
    controls.append(makeButton('もう一回', rematch));
    if (S.mode === 'online' && S.isHost) controls.append(makeButton('メンバーを変える', () => newRound(S.gameId, { lobby: true }), 'secondary'));
  } else if (S.mode === 'local' && S.moves.length) {
    controls.append(
      makeButton('1手戻す', () => { S.moves.pop(); render(); }, 'secondary'),
      makeButton('最初から', () => { if (confirm('最初からやり直しますか？')) rematch(); }, 'secondary'),
    );
  } else if (S.mode === 'online' && !game.multi) {
    appendUndo(game);
  }
  appendFlip(game);
  appendPredict(game, res);
  appendReactions();
  if (S.mode === 'online' && S.isHost) controls.append(gameSelect());
  appendMemberPanel();
  scheduleCpu(game, st, res);
  scheduleReferee(game, st, res);
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
    + (extra ? `<div class="status-sub">${extra}</div>` : '');
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
}

/* ---------- 勝敗予想（2026-10-06 本人の決定）: 対局の始めに、観戦の人も含めて「だれが勝つか」を1回選べる ---------- */
// Claude の判断: 選べるのは、対局の手が1巡する（打った手の数が対局する人数になる）まで。時間で進むゲームの進行役の手（p = -1）は数えない。
// 1人1回・変えられない・自分を選んでもよい。送りっぱなし（type: 'pred'）で、受け取った端末がそれぞれ覚える（あとから入った人には届かない）。
// 結果の画面に「予想が当たった人」を出す。オンラインの盤のゲームとカードゲームだけ（エアホッケーは結果が main.js を通らないので出さない）。
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
  const bar = document.createElement('div');
  bar.className = 'pred-bar';
  const label = document.createElement('span');
  if (mine !== undefined) {
    label.textContent = `🔮 あなたの予想: ${nameOf(S.order[mine])}`;
    bar.append(label);
  } else {
    label.textContent = '🔮 だれが勝つ？';
    bar.append(label);
    S.order.forEach((id, p) => {
      bar.append(makeButton(id === S.myId ? 'あなた' : nameOf(id), () => {
        if (!predOpen(game, null) || !setPred(S.myId, p)) return;
        send({ type: 'pred', gameId: S.gameId, round: S.round, p });
        render();
      }, 'ghost small'));
    });
  }
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

// 新しく打たれた手の音。何手かまとめて届いたときは最後の手の音だけ。対局が終わったら勝ち負けの音。
// 音はゲームの sound(前の局面, 今の局面, 手, 自分の番号) が名前で返す（無ければ盤のゲームは place、カードゲームは card）
function moveSound(game, st, res, prevLen, mine) {
  const before = replay({ ...S, moves: S.moves.slice(0, prevLen) });
  if (!before) return;
  const me = myPlayer();
  const m = S.moves[S.moves.length - 1];
  if (res) {
    if (game.result(before)) return;
    let said = null; // 麻雀の最後の局の「ロン！」など
    try { said = game.sound?.(before, st, m, me); } catch { /* 終局の手に音の決めごとが合わなくても、勝ち負けの音は鳴らす */ }
    const end = endSound(res, me);
    if (isVoice(said)) { play(said); setTimeout(() => play(end), 700); } else play(end);
    if (end === 'win') confetti(); // 勝ちの音を鳴らす画面には紙吹雪
    greet('end', isVoice(said) ? 1900 : 1200);
    return;
  }
  const name = game.sound ? game.sound(before, st, m, me) : game.multi ? 'card' : 'place';
  if (name) play(name);
  if (mine && S.mode === 'online' && !game.realtime && !canMove(game, before, null) && Date.now() - S.waitFrom > TURN_PING_MS) {
    setTimeout(() => { play('turn'); sayTurn(); }, 300);
  }
}

/* ---------- 番が来たら名前を読み上げ・あいさつ（2026-10-08 の23回目の案。Claude の案から本人が推奨どおり選んだ） ---------- */
// 番が来たら名前を読み上げ: オンラインで5秒より長く待ったあとに自分の番が来たとき（「番が来た」音と同じとき）、音のあとに「○○さんの番です」と言う。
//   読むのは自分の端末に入れた自分の名前（マーク・🔰 は付けない）。名前が空なら「あなたの番です」。
// あいさつ: 対局の始め（手がまだ無い局面を初めて描いたとき）に「よろしくお願いします」、決着した手が届いたときに勝ち負けの音のあとで「ありがとうございました」。
//   画面の下に一言（toast）を出して読み上げる。オンラインも同じ画面の対局も。各自の端末が自分で出す（送らない）。
//   途中から入った・再読み込みで手がある局面を開いたときは、始めのあいさつは出さない。エアホッケーは main.js で描かないので出ない。
// 声は 🔇 なら出さない（一言は出す）。Claude の判断: 「番が来た」音は残し、そのあとに声を足した（声が出ない端末でも気づけるように）。
function sayTurn() {
  const name = myName();
  speak(name ? `${name}さんの番です` : 'あなたの番です', 'turn-voice');
}

const GREET = { start: 'よろしくお願いします', end: 'ありがとうございました' };
function greet(kind, delay = 0) {
  setTimeout(() => {
    toast(`🙇 ${GREET[kind]}`);
    speak(GREET[kind], 'greet');
  }, delay);
}

// render から毎回呼ぶ。対局（ゲーム・回・種）ごとに、手がまだ無いところを初めて描いたときだけ始めのあいさつ
function greetStart(res) {
  const key = timerKey();
  if (S.greetKey === key) return;
  S.greetKey = key;
  if (!S.moves.length && !res) greet('start', 300);
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
  const row = (text, cls = '') => `<li class="${cls}">${text}</li>`;
  const short = game.noCpu && humans.length < game.minPlayers;
  let html = `<p class="lobby-note">${seats ? `${seats}人` : playersText(game)}で遊べます。${game.noCpu ? 'CPU は入れません。' : '足りない分は CPU が入ります。'}</p><ul class="lobby-list">`;
  for (const id of humans) {
    const marks = [id === S.myId ? 'あなた' : '', id === S.members[0] ? '部屋を作った人' : ''].filter(Boolean).join('・');
    html += row(`${esc(nameOf(id))}${marks ? ` <small>（${marks}）</small>` : ''}`);
  }
  for (let i = 1; i <= cpus; i++) html += row(`CPU${i}`, 'cpu');
  html += '</ul>';
  if (watchers.length) html += `<p class="lobby-note">観戦: ${watchers.map((id) => esc(nameOf(id))).join('、')}（${max}人までのため）</p>`;
  html += short
    ? `<p class="lobby-total">あと${game.minPlayers - humans.length}人そろうと始められます</p>`
    : `<p class="lobby-total">${humans.length + cpus}人で遊びます</p>`;
  board.className = 'board lobby';
  board.innerHTML = html;
  const tally = tallyLine();
  if (tally) board.append(tally);
  const hist = historyLine();
  if (hist) board.append(hist);
  appendLobbyExtras(board);
  if (game.settings) board.append(rulesPanel(game));

  if (!S.isHost) { controls.append(readyButton(), voteSelect()); return; }
  const start = makeButton('始める', startRound);
  start.disabled = short;
  if (allReady() && !short) start.classList.add('ready-go');
  if (game.noCpu || seats) { controls.append(start, gameSelect(), rouletteButton()); return; }
  const setCpus = (n) => { S.cpus = n; saveRoom(); sendState(); render(); };
  const step = game.evenTeams ? 2 : 1; // チームの人数をそろえるゲームは2人ずつ
  const minus = makeButton('CPU を減らす', () => setCpus(cpus - step), 'secondary');
  minus.disabled = humans.length + cpus - step < game.minPlayers || cpus < step;
  const plus = makeButton('CPU を増やす', () => setCpus(cpus + step), 'secondary');
  plus.disabled = humans.length + cpus + step > game.maxPlayers;
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
  const pick = boardPick();
  const label = (v) => (v === 'cpu' ? 'CPU' : nameOf(v) + (v === S.myId ? '（あなた）' : ''));
  const list = document.createElement('div');
  list.className = 'lobby-pick';
  pick.forEach((_, i) => {
    const row = document.createElement('label');
    const head = document.createElement('span');
    head.innerHTML = `<b class="pl p${i}">${esc(game.players[i])}</b>${game.live ? '' : seatNote(game, i, n)}`;
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
  if (game.settings) board.append(rulesPanel(game));
  if (!S.isHost) { controls.append(readyButton(), voteSelect()); return; }
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
  const b = makeButton(pick.length > 2 ? '🎲 順番をくじで決める' : `🎲 ${game.players[0]}をくじで決める`, () => {
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
  toast(pick.length > 2 ? '🎲 くじの結果: ' + pick.map(who).join(' → ') : `🎲 くじの結果: ${game.players[0]}は ${who(pick[0])}`);
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

// ホストだけに出す「部屋の人」。知らない人が入ってきたら退出させられる
function appendMemberPanel() {
  if (S.mode !== 'online' || !S.isHost) return;
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
    name.textContent = nameOf(id);
    row.append(name, makeButton('退出させる', () => kick(id), 'ghost small'));
    det.append(row);
  }
  ctl().append(det);
}

function kick(id) {
  if (!confirm(`${nameOf(id)} を部屋から退出させますか？（この部屋には戻れなくなります）`)) return;
  S.banned = [...(S.banned ?? []), id];
  S.members = S.members.filter((m) => m !== id);
  send({ type: 'kick', to: id });
  saveRoom();
  sendState();
  render();
}

// 自分が退出させられたとき
function onKicked() {
  try { localStorage.setItem(kickedKey(S.code), '1'); } catch { /* 無視 */ }
  forgetRoom(S.code);
  const net = S.net;
  setTimeout(() => net?.close(), 300);
  dropBack();
  S = null;
  setTurnTitle(false);
  setUrlRoom(null);
  showScreen('home');
  alert('部屋を作った人によって、部屋から退出させられました。');
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
function rouletteButton() {
  const n = S.members.length;
  const ok = (g) => g.ready && g.id !== S.gameId && (!g.noCpu || n >= g.minPlayers) && (!g.live || n >= 2);
  const ids = GAME_ORDER.filter((id) => ok(GAMES[id]));
  const b = makeButton('🎲 ゲームを抽選', () => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    newRound(id, { lobby: true });
    toast(`🎲 ${GAMES[id].name} になりました。もう一度押すと引き直せます`);
  }, 'secondary');
  b.disabled = !ids.length;
  return b;
}

/* ---------- 操作 ---------- */

function pushMove(move) {
  S.moves.push(move);
  saveRoom();
  if (S.mode === 'online') sendMoves();
  render();
}

function onBoardMove(move) {
  const game = GAMES[S.gameId];
  const st = replay(S);
  if (!st || !canMove(game, st, game.result(st))) return;
  if (game.multi) move = { ...move, p: myPlayer() };
  if (!game.apply(st, move)) return;
  pushMove(move);
}

// ホストの端末だけが CPU（と部屋を出た人の席）の手を考える
function scheduleCpu(game, st, res) {
  if (!S.isHost || S.mode !== 'online' || !S.order || res) return;
  const canAct = (s, i) => (game.multi ? game.canAct(s, i) : game.turn(s) === i);
  // 同時に動くゲーム（realtime）は CPU ごとに別々に予約し、相手が動いても取り消さない
  // （取り消すと相手が速いと CPU が永久に動けない。1人ずつだと、待っている CPU の後ろの CPU が動けない）
  const ps = S.order.map((id, i) => i).filter((i) => cpuControlled(S.order[i]) && canAct(st, i));
  for (const p of game.realtime ? ps : ps.slice(0, 1)) {
    // 待ったで手が減ると同じ長さに戻るので、待ったの回数も鍵に入れる（入れないと「もう予約してある」と見て CPU が止まる）
    const key = game.realtime ? `${S.gameId}:${S.round}:rt:${p}` : `${S.gameId}:${S.round}:${S.undo ?? 0}:${S.moves.length}:${p}`;
    if (S.cpuKeys[p] === key) continue; // もう予約してある
    S.cpuKeys[p] = key;
    const session = S;
    const len = S.moves.length;
    setTimeout(() => {
      if (S !== session || S.cpuKeys[p] !== key || (!game.realtime && S.moves.length !== len)) return;
      S.cpuKeys[p] = null;
      const now = replay(S);
      const m = now && !game.result(now) && canAct(now, p) ? game.cpu(now, p, rulesOf(S.gameId, S.rules)) : null; // null = いまは何もしない
      const move = game.multi && m ? { ...m, p } : m; // 盤のゲームの手には p を付けない（手が 0 のこともある）
      const after = move !== null ? game.apply(now, move) : null;
      if (after) { pushMove(move); if (!game.result(after)) cpuMidSay(S.order[p]); } // 決着した手では、決着のひとことだけにする
      else render(); // 打てなかったら予約し直す
    }, game.cpuDelay?.(st, p) ?? CPU_DELAY_MS);
  }
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
  S.gameId = gameId;
  S.round += 1;
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
  S.round += 1;
  S.order = order;
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
  if (!isOwner()) return;
  S = { mode: 'local', gameId, round: 1, first: 0, seed: randomSeed(), order: null, cpus: 0, moves: [], members: [], names: {}, rules: {}, prev: null, carry: null, pick: null };
  enterPlay();
}

// 毎フレーム動くゲームを同じ画面で（mode = 'cpu' | 'two'）
function startLive(gameId, mode) {
  if (!isOwner()) return;
  S = { mode: 'local', live: mode, gameId, round: 1, first: 0, seed: 0, order: null, cpus: 0, moves: [], members: [], names: {}, rules: {}, prev: null, carry: null, pick: null };
  enterPlay();
}

// 毎フレーム動くゲームの画面。対局ごと（round）に1回だけ作り、描き直しでは作り直さない
function renderLive(game) {
  const key = `${S.gameId}:${S.round}:${S.mode}:${S.live ?? ''}`;
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
  if (S.mode === 'online' && S.isHost) ctl().append(gameSelect());
  if (S.mode === 'online') appendMemberPanel();
}

function stopLive() {
  if (!S?.liveHandle) return;
  S.liveHandle.destroy();
  S.liveHandle = null;
  S.liveKey = null;
}

function createRoom(gameId) {
  if (!isOwner()) return;
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
  return true;
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
  const url = new URL(location.href);
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

function closeInvite() { document.querySelector('.invite-pop')?.remove(); }

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
  </div>`;
  const box = pop.querySelector('.invite-box');
  const row = document.createElement('div');
  row.className = 'invite-actions';
  row.append(makeButton('リンクを送る', shareInvite), makeButton('閉じる', closeInvite, 'secondary'));
  box.append(row);
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

function send(msg, qos) { S?.net?.send(msg, qos); }
function sendState() {
  const { gameId, round, first, seed, order, cpus, moves, members, names, rules, prev, pick, undo, streak, beg } = S;
  send({ type: 'state', gameId, round, first, seed, order, cpus, moves, members, names, rules, prev, pick, u: undo ?? 0, streak: streak ?? null, beg: beg ?? [], tally: S.tally ?? null, stay: !!S.stay, line: S.line ?? [], marks: S.marks ?? {}, timer: S.timer ?? null, history: S.history ?? [], ready: S.ready ?? null, votes: S.votes ?? {}, roomName: S.roomName ?? '', cpuAuto: !!S.cpuAuto, rps: S.rps ?? null });
}
function sendMoves() { send({ type: 'move', gameId: S.gameId, round: S.round, moves: S.moves, u: S.undo ?? 0 }); }
function askState() { send({ type: 'hello', isHost: false, name: myName(), beg: beginner, mark: myMark() }); }

function onConn(status) {
  const back = status === 'ready' && S.everReady && S.conn !== 'ready';
  S.conn = status;
  if (status === 'ready') {
    if (back) toast('通信がもどりました');
    S.everReady = true;
    S.pingAt = null;
    send({ type: 'hello', isHost: S.isHost, name: myName(), beg: beginner, mark: myMark() });
    if (S.isHost) { setBeg(S.myId, beginner); setMark(S.myId, myMark()); sendState(); }
  }
  render();
}

function onMessage(msg) {
  if (msg.to && msg.to !== S.myId) return;
  const wasAlive = alive(msg.from);
  S.seen[msg.from] = Date.now();
  if (msg.type === 'stream') { // 見た目だけの中身。手の一覧には入れず、描き直しもしない
    if (msg.gameId === S.gameId && msg.round === S.round) GAMES[S.gameId]?.onStream?.(msg.d, S.order?.indexOf(msg.from) ?? -1);
    if (!wasAlive) render();
    return;
  }
  if (msg.type === 'cpusay') { // CPU のひとこと。描き直さない
    onCpuSay(msg);
    return;
  }
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
    case 'kick':
      // ホストから（まだ部屋に入れてもらう前なら、届いたもの）だけ受け付ける
      if (!S.isHost && (!S.members.length || msg.from === S.members[0])) { onKicked(); return; }
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
  if (S.banned.includes(msg.from)) { send({ type: 'kick', to: msg.from }); return; }
  const name = cleanName(msg.name);
  if (S.members.includes(msg.from)) {
    if (name && S.names[msg.from] !== name) S.names[msg.from] = name;
  } else if (S.members.length < MAX_MEMBERS) {
    S.members.push(msg.from);
    S.names[msg.from] = name || 'プレイヤー' + (Object.keys(S.names).length + 1);
  } else {
    send({ type: 'full', to: msg.from });
    return;
  }
  setBeg(msg.from, msg.beg === true);
  setMark(msg.from, msg.mark);
  saveRoom();
  sendState();
}

function adoptState(msg) {
  const game = GAMES[msg.gameId];
  if (!game?.ready || !Array.isArray(msg.moves) || !Array.isArray(msg.members)) return;
  if (!msg.members.includes(S.myId)) return; // まだ部屋に入れてもらっていない（hello を送り続ける）
  S.full = false;
  S.hostLeft = false;
  S.members = msg.members.slice();
  S.names = { ...msg.names };
  S.rules = msg.rules && typeof msg.rules === 'object' ? msg.rules : {};
  S.beg = Array.isArray(msg.beg) ? msg.beg.filter((id) => typeof id === 'string') : [];
  S.streak = msg.streak && typeof msg.streak === 'object' && msg.streak.wins && typeof msg.streak.wins === 'object' ? msg.streak : null;
  S.history = Array.isArray(msg.history)
    ? msg.history.filter((h) => GAMES[h?.g] && Array.isArray(h.w)).slice(0, HISTORY_MAX).map((h) => ({ g: h.g, w: h.w.filter((x) => typeof x === 'string').map((x) => x.slice(0, 30)) }))
    : null;
  S.tally = msg.tally && Number.isInteger(msg.tally.games) && msg.tally.wins && typeof msg.tally.wins === 'object' ? msg.tally : null;
  S.stay = msg.stay === true;
  S.cpuAuto = msg.cpuAuto === true;
  S.roomName = cleanRoomName(msg.roomName);
  S.marks = msg.marks && typeof msg.marks === 'object' ? Object.fromEntries(Object.entries(msg.marks).filter(([id, m]) => typeof id === 'string' && MARKS.includes(m) && m)) : {};
  const tm = msg.timer;
  S.timer = tm && typeof tm.key === 'string' && Number.isFinite(tm.start) && (tm.end === null || Number.isFinite(tm.end)) ? { key: tm.key, start: tm.start, end: tm.end } : null;
  S.line = Array.isArray(msg.line) ? msg.line.filter((id) => typeof id === 'string') : [];
  const rd = msg.ready;
  S.ready = rd && Number.isInteger(rd.round) && Array.isArray(rd.ids) ? { round: rd.round, ids: rd.ids.filter((id) => typeof id === 'string') } : null;
  const rp = msg.rps; // 待合室でじゃんけん
  S.rps = rp && Number.isInteger(rp.n) && rp.hands && typeof rp.hands === 'object' ? { n: rp.n, hands: Object.fromEntries(Object.entries(rp.hands).filter(([id, h]) => typeof id === 'string' && RPS[h])) } : null;
  S.votes = msg.votes && typeof msg.votes === 'object' ? Object.fromEntries(Object.entries(msg.votes).filter(([id, g]) => typeof id === 'string' && typeof g === 'string' && GAMES[g]?.ready)) : {};
  for (const id of S.members) S.seen[id] ??= Date.now();
  const sameRound = S.gameId === msg.gameId && S.round === msg.round;
  const mu = Number.isInteger(msg.u) ? msg.u : 0;
  if (sameRound && mu < (S.undo ?? 0)) {
    // 待ったより前の古い知らせ。手の一覧は受け取らない
  } else if (sameRound && mu === (S.undo ?? 0) && S.moves.length > msg.moves.length && isPrefix(msg.moves, S.moves)) {
    sendMoves(); // こちらの方が進んでいる（ホストが取りこぼした）ので教える
  } else if (msg.order === null || replay(msg)) {
    S.gameId = msg.gameId;
    S.round = msg.round;
    S.first = msg.first;
    S.seed = msg.seed;
    S.order = msg.order ? msg.order.slice() : null;
    S.cpus = msg.cpus;
    S.pick = Array.isArray(msg.pick) ? msg.pick.slice() : null;
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
    } else if (S.isHost && GAMES[S.gameId].realtime) {
      rebase(msg);
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
  if (!S.isHost && !S.members.includes(S.myId) && !S.full) askState();
  else { send({ type: 'ping', t: Date.now() }); S.pingAt ??= Date.now(); } // t: 戻ってきたら通信の遅れを測る
  const lostKey = S.members.filter((id) => !alive(id)).join();
  if (lostKey !== S.lostKey) { S.lostKey = lostKey; render(); } else renderRoomBar();
}, HEARTBEAT_MS);

/* ---------- 起動 ---------- */

renderHome();
const nameInput = el('my-name');
nameInput.value = myName();
nameInput.addEventListener('input', () => {
  try { localStorage.setItem(NAME_KEY, cleanName(nameInput.value)); } catch { /* 無視 */ }
});
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
el('btn-leave').onclick = () => leave();
el('btn-invite').onclick = invite;
el('btn-howto').onclick = () => {
  const box = el('howto');
  box.hidden = !box.hidden;
  el('btn-howto').setAttribute('aria-expanded', String(!box.hidden));
};
const soundBtn = el('btn-sound');
function showSoundBtn() {
  soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  soundBtn.title = isMuted() ? '効果音: オフ（押すとオン）' : '効果音: オン（押すとオフ）';
  soundBtn.setAttribute('aria-label', soundBtn.title);
}
soundBtn.onclick = () => {
  setMuted(!isMuted());
  showSoundBtn();
  if (!isMuted()) play('pop');
};
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

const roomParam = new URL(location.href).searchParams.get('room');
if (!(roomParam && joinRoom(roomParam))) {
  setUrlRoom(null);
  showScreen('home');
}
