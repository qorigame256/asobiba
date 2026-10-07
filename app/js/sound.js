// 効果音。音は app/sounds/<名前>.wav。どれも CC0（著作権を放棄した素材）を、片耳・22050Hz・最大音量 0.8 にそろえて WAV にしたもの
// （iPhone の Safari が ogg を鳴らせないことがあるため）。元の素材（素材集 / ファイル名）:
//   Kenney（https://kenney.nl/）の casino-audio・impact-sounds・interface-sounds・music-jingles・digital-audio、
//   Juhani Junkala「512 Sound Effects (8-bit style)」（https://opengameart.org/content/512-sound-effects-8-bit-style）の General Sounds。
//   place  impact-sounds / impactWood_medium_000     card   casino-audio / card-place-1     draw  casino-audio / card-slide-1
//   shuffle casino-audio / card-shuffle（1.2秒で切った） chip casino-audio / chips-stack-1   pop   interface-sounds / drop_002
//   punch  impact-sounds / impactPunch_medium_000    stone  impact-sounds / impactGeneric_light_000
//   turn   512 / Pause Sounds / sfx_sounds_pause1_in   correct interface-sounds / confirmation_002   wrong interface-sounds / error_002
//   question interface-sounds / question_002         hit    interface-sounds / glass_001
//   win    interface-sounds / confirmation_004       lose   digital-audio / phaserDown1
//   draw_game music-jingles / jingles_PIZZI08
//   call   interface-sounds / maximize_006
//   smack  impact-sounds / impactPlate_light_000      wall   impact-sounds / impactSoft_medium_000   goal 512 / Coins / sfx_coin_cluster3
// 勝ち・負け・正解・不正解・番が来た・ゴール・和了は、本人が試聴ページで聞いて選んだ（2026-10-03）。
// 和了は音のファイルではなく、ブラウザの読み上げで「ロン！」「ツモ！」と言う（SAY。日本語の声で CC0 の素材が無かったため）。
// リーチも読み上げで「リーチ！」と言う（2026-10-04 本人の決定。前は鐘の音 impact-sounds / impactBell_heavy_000）。
// 将棋の王手も読み上げで「王手！」と言う（2026-10-07 詳細設定「王手の知らせ」。ありのときだけ）。
//
// 鳴らすのは Web Audio（ブラウザの音の仕組み）。スマホは画面に触れるまで音を出せないので、最初に触れたときに準備する。
// iPhone はマナーモード（消音スイッチ）のときは鳴らない。オン・オフはこの端末に覚える（localStorage）。

const NAMES = ['place', 'card', 'draw', 'shuffle', 'chip', 'pop', 'punch', 'stone', 'turn', 'correct', 'wrong', 'question', 'hit',
  'win', 'lose', 'draw_game', 'call', 'smack', 'wall', 'goal'];
// 読み上げで出す音（名前 → 言う言葉）。声は端末ごとに違う
const SAY = { ron: 'ロン！', tsumo: 'ツモ！', riichi: 'リーチ！', oute: '王手！' }; // oute は将棋の「王手の知らせ」
export const isVoice = (name) => name in SAY;
// 音ごとの大きさ（素材の最大音量はそろえてあるので、耳ざわりなものを下げる）
const GAIN = { pop: 0.5, stone: 0.6, wall: 0.4, turn: 0.6, question: 0.6, hit: 0.6, wrong: 0.6, shuffle: 0.7 };
const MASTER = 0.6;
const MUTE_KEY = 'bg-mute';
const GAP_MS = 40; // 同じ音がこれより短い間に重なったら1回だけ鳴らす

let ctx = null;
const buffers = {};
const lastAt = {};
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* 覚えられなくても鳴らせる */ }

export const isMuted = () => muted;
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* 無視 */ }
}

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    for (const name of NAMES) {
      fetch(`sounds/${name}.wav`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => { /* 読めない音は鳴らさないだけ */ });
    }
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // iPhone は、画面に触れた流れの中で一度読み上げておかないと、あとから読み上げられない
  if (!spoke && typeof speechSynthesis !== 'undefined') {
    spoke = true;
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* 読み上げが使えない端末 */ }
  }
}
let spoke = false;

function say(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('ja'));
    if (v) u.voice = v;
    u.volume = MASTER + 0.3;
    speechSynthesis.speak(u);
  } catch { /* 読み上げが使えない端末 */ }
}
if (typeof window !== 'undefined') { // tools/ の自動確認（Node）から読まれたときは何もしない
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

// name の音を鳴らす。vol は 0〜1 の倍率（エアホッケーの当たりの強さなど）
export function play(name, vol = 1) {
  if (muted || !ctx) return;
  const now = performance.now();
  if (now - (lastAt[name] ?? -1e9) < GAP_MS) return;
  if (isVoice(name)) { lastAt[name] = now; say(SAY[name]); return; }
  if (ctx.state !== 'running' || !buffers[name]) return;
  lastAt[name] = now;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  const g = ctx.createGain();
  g.gain.value = MASTER * (GAIN[name] ?? 1) * Math.max(0, Math.min(1, vol));
  src.connect(g).connect(ctx.destination);
  src.start();
}

// 対局が終わったときの音。自分の勝ち → win、負け → lose、引き分け → draw_game。
// 観戦と同じ画面の対局（me が -1 か null）は、決着が付けば win
export function endSound(res, me) {
  const mine = me !== null && me >= 0;
  if (Array.isArray(res.winners)) return !mine || res.winners.includes(me) ? 'win' : 'lose';
  if (res.loser !== null && res.loser !== undefined) return mine && res.loser === me ? 'lose' : 'win';
  if (res.draw || res.winner === null || res.winner === undefined) return 'draw_game';
  if (!mine) return 'win';
  if (Array.isArray(res.ranking) && res.ranking.length > 2) { // 順位のあるゲーム: 1位 win・最下位 lose・ほかは draw_game
    const i = res.ranking.indexOf(me);
    return i === 0 ? 'win' : i === res.ranking.length - 1 ? 'lose' : 'draw_game';
  }
  return res.winner === me ? 'win' : 'lose';
}
