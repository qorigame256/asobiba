// 効果音。音は app/sounds/<名前>.wav。CC0（著作権を放棄した素材）・OtoLogic（CC BY 4.0）・効果音ラボの素材を片耳・22050Hz の WAV にしたもの
// （iPhone の Safari が ogg を鳴らせないことがあるため）。元の素材（素材集 / ファイル名）:
//   Kenney（https://kenney.nl/）の casino-audio・impact-sounds・interface-sounds・music-jingles・digital-audio・rpg-audio、
//   Juhani Junkala「512 Sound Effects (8-bit style)」（https://opengameart.org/content/512-sound-effects-8-bit-style）、
//   rubberduck の「75 CC0 breaking / falling / hit sfx」「80 CC0 RPG SFX」（https://opengameart.org/users/rubberduck）、
//   OtoLogic（https://otologic.jp/。CC BY 4.0 なので作者の表示が要る。main.js の LICENSES に出している）、
//   効果音ラボ（https://soundeffect-lab.info/。作者の表示は要らない。音のファイルが見える形で GitHub に置くのも同サイトの FAQ で許されている。
//   音を自由に鳴らすだけの作り（効果音集のようなもの）にするのは再配布として禁止）。
// どの音も前後の無音を切り、役割ごとの目標の大きさにそろえてある（tools/level-sound.mjs。何度も鳴る手の音は小さめ・勝ち負けや正解は大きめ）。
// 2026-10-31 の見直しで、全部の音を本人が試聴ページで聞いて選び直した（4回に分けた。★）:
//   ★place impact-sounds / impactGeneric_light_002   ★card casino-audio / card-place-2   ★draw casino-audio / card-slide-8
//   ★shuffle casino-audio / card-fan-1               ★flip casino-audio / chip-lay-2（リバーシ）   ★drop casino-audio / chips-collide-1（四目並べ）
//   ★dice casino-audio / dice-throw-3                ★smack impact-sounds / impactPlate_medium_000   ★wall impact-sounds / impactWood_heavy_002
//   ★boom 512 / Explosions / sfx_exp_short_hard2     ★stab rpg-audio / drawKnife1（海賊のたる）
//   ★tile rubberduck 75 breaking / bfh1_rock_hit_01（麻雀）   ★stone rubberduck 80 RPG / stones_04
//   ★line Claude がプログラムで作った「シュッ」（帯域を絞ったノイズ。点と線）
//   ★pop OtoLogic / 弾ける Onoma-Pop04-2(Mid-Dry)   ★punch OtoLogic / 叩く Motion-Slam05-1(Strong)
//   ★pins 効果音ラボ / bowling-pin1（ボウリングのピンを倒す・ストライク。ボウリング）   ★wrong 効果音ラボ / beep4（ビープ音「ブブー」）
//   次の10個は前と同じ音を選んだ（大きさだけそろえた）:
//   ★correct interface-sounds / confirmation_002   ★goal 512 / Coins / sfx_coin_cluster3   ★chip casino-audio / chips-stack-1
//   ★hit interface-sounds / glass_001              ★turn 512 / Pause Sounds / sfx_sounds_pause1_in   ★question interface-sounds / question_002
//   ★call interface-sounds / maximize_006          ★win interface-sounds / confirmation_004   ★lose digital-audio / phaserDown1
//   ★draw_game music-jingles / jingles_PIZZI08
// 勝ち・負け・正解・番が来た・ゴールは、2026-10-03 にも本人が試聴ページで聞いて選んでいた。
// 和了は効果音でなく声で「ロン！」「ツモ！」と言う（SAY）。リーチも声で「リーチ！」（2026-10-04 本人の決定。前は鐘の音 impact-sounds / impactBell_heavy_000）。
// 将棋の王手も声で「王手！」と言う（2026-10-07 詳細設定「王手の知らせ」。ありのときだけ）。
//
// 声（2026-11-08 から）: 決まった言葉は VOICEVOX（雨晴はう・猫使ビィ。どちらも「ノーマル」）で前もって作った app/voice/<hau|bee>/<voiceId>.mp3 を鳴らし、
// 読むたびに2人のどちらかをくじで選ぶ（本人の決定）。作るのは tools/make-voice.mjs（言葉の一覧は tools/voice-texts.mjs、作った言葉の一覧は voice-list.js）。
// 一覧に無い言葉（「○○さんのたーん」）と、ファイルが読めなかったときは、今までどおりブラウザの読み上げ（say）で言う。
// mp3 にしたのは数が多い（2人 × 約170）ため。WAV だと1つ 30〜60KB になる。mp3 は iPhone の Safari でも鳴らせる（ogg は鳴らないことがある）。
//
// 鳴らすのは Web Audio（ブラウザの音の仕組み）。スマホは画面に触れるまで音を出せないので、最初に触れたときに準備する。
// iPhone はマナーモード（消音スイッチ）のときは鳴らない。オン・オフはこの端末に覚える（localStorage）。

import { VOICE_IDS } from './voice-list.js';

const NAMES = ['place', 'card', 'draw', 'shuffle', 'chip', 'pop', 'punch', 'stone', 'turn', 'correct', 'wrong', 'question', 'hit',
  'win', 'lose', 'draw_game', 'call', 'smack', 'wall', 'goal', 'flip', 'drop', 'dice', 'boom', 'stab', 'line', 'tile', 'pins'];
// 声で出す音（名前 → 言う言葉）
export const SAY = { ron: 'ロン！', tsumo: 'ツモ！', riichi: 'リーチ！', oute: '王手！' }; // oute は将棋の「王手の知らせ」
export const isVoice = (name) => name in SAY;
// 対局の始めと終わりのあいさつ（main.js の greet が出す）
export const GREET = { start: 'よろしくお願いします', end: 'ありがとうございました' };
const VOICES = ['hau', 'bee']; // app/voice/ の下のフォルダの名前（雨晴はう・猫使ビィ）
const PART_GAP = 0.06; // 言葉を部品でつないで読むときの間（秒。旗揚げのお題）
const MASTER = 0.6; // 音ごとの大きさはファイルの中でそろえてあるので、ここでは全部に同じ倍率を掛けるだけ（前は音ごとの GAIN で下げていた）
// 読み上げの大きさ（0〜1）。2026-10-26 本人の声「あなたの番ですの声が大きすぎる」で 0.9 から下げた。
// iPhone の Safari は読み上げの大きさの指定を聞かないことがあり、その端末では本体の音量で決まる（未確認）
const VOICE_VOL = 0.45;
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
    preloadVoice([...Object.values(SAY), ...Object.values(GREET)]);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // iPhone は、画面に触れた流れの中で一度読み上げておかないと、あとから読み上げられない。
  // 空の文だと読み上げが始まらず準備にならない端末があるので、音を0にした短い文にし、本当に始まった（onstart）と分かるまで触れるたびにやり直す（2026-10-26）
  if (!spoke && typeof speechSynthesis !== 'undefined') {
    try {
      const u = new SpeechSynthesisUtterance('あ');
      u.volume = 0;
      u.onstart = () => { spoke = true; };
      keep(u);
      speechSynthesis.speak(u);
    } catch { spoke = true; /* 読み上げが使えない端末 */ }
  }
}
let spoke = false;
// Chrome は読み上げ中の文を手放すと、終わりの知らせが来ないまま後の読み上げが詰まって止まることがあるので、終わるまで持っておく
const held = new Set();
function keep(u) {
  held.add(u);
  const drop = () => held.delete(u);
  u.addEventListener('end', drop);
  u.addEventListener('error', drop);
  setTimeout(drop, 15000);
}

// ブラウザの読み上げ。rate は速さ（旗揚げは 1.15）、cut なら言いかけの読み上げを止めてから言う
function say(text, { rate, cut } = {}) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('ja'));
    if (v) u.voice = v;
    u.volume = VOICE_VOL;
    if (rate) u.rate = rate;
    keep(u);
    if (cut) speechSynthesis.cancel();
    if (speechSynthesis.paused) speechSynthesis.resume(); // 他のアプリへ移って戻ったあと、止まったままになる端末がある
    speechSynthesis.speak(u);
  } catch { /* 読み上げが使えない端末 */ }
}

// 言葉 → 声のファイルの名前（FNV-1a の32ビットを16進8けた）。tools/make-voice.mjs も同じものでファイルを作る
export function voiceId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
const hasVoice = (text) => VOICE_IDS.has(voiceId(text));

// 声のファイルは、届いたままの形（mp3 のバイト列）で覚えておき、鳴らすたびに音の形に直す（直したものを全部持つと、ビンゴ・かるたで数十 MB になるため）
const voiceBytes = new Map(); // 'hau/xxxxxxxx' → Promise<ArrayBuffer>
function voiceFile(voice, text) {
  const k = `${voice}/${voiceId(text)}`;
  if (!voiceBytes.has(k)) {
    const p = fetch(`voice/${k}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)));
    p.catch(() => voiceBytes.delete(k)); // 読めなかったら次はもう一度取りに行く
    voiceBytes.set(k, p);
  }
  return voiceBytes.get(k);
}
// これから言う言葉の声のファイルを前もって取っておく（ビンゴ・かるた・旗揚げは対局の始めに呼ぶ）。🔇 のときは取らない
export function preloadVoice(texts) {
  if (muted || typeof fetch === 'undefined') return;
  for (const t of texts) if (hasVoice(t)) for (const v of VOICES) voiceFile(v, t).catch(() => {});
}
const voicing = {}; // key → いま鳴らしている声の音源（cut で止めるため）
// parts を声のファイルでつないで言う。全部の部品にファイルがあれば true（鳴らすのは読み込んでから）。読めなかったらブラウザの読み上げで言い直す
function playVoice(parts, key, opts) {
  if (!parts.every(hasVoice)) return false;
  const voice = VOICES[Math.floor(Math.random() * VOICES.length)];
  const asked = performance.now();
  Promise.all(parts.map((t) => voiceFile(voice, t).then((b) => ctx.decodeAudioData(b.slice(0)))))
    .then((bufs) => {
      if (muted) return;
      if (performance.now() - asked > 3000) return; // 遅れすぎた声は言わない（次の問題が出ていることがある）
      if (opts.cut) for (const src of voicing[key] ?? []) try { src.stop(); } catch { /* もう止まっている */ }
      const g = ctx.createGain();
      g.gain.value = MASTER;
      g.connect(ctx.destination);
      let t = ctx.currentTime + 0.02;
      voicing[key] = bufs.map((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.start(t);
        t += buf.duration + PART_GAP;
        return src;
      });
    })
    .catch(() => say(parts.join('、'), opts));
  return true;
}
if (typeof window !== 'undefined') { // tools/ の自動確認（Node）から読まれたときは何もしない
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });
}

// name の音を鳴らす。vol は 0〜1 の倍率（エアホッケーの当たりの強さなど）
export function play(name, vol = 1) {
  if (muted || !ctx) return;
  const now = performance.now();
  if (now - (lastAt[name] ?? -1e9) < GAP_MS) return;
  if (isVoice(name)) { lastAt[name] = now; talk([SAY[name]], name, {}); return; }
  if (ctx.state !== 'running' || !buffers[name]) return;
  lastAt[name] = now;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  const g = ctx.createGain();
  g.gain.value = MASTER * Math.max(0, Math.min(1, vol));
  src.connect(g).connect(ctx.destination);
  src.start();
}

// 文を声で言う（番が来たときの「○○さんのターン」・あいさつ・ビンゴ・かるた・旗揚げ）。text は文か、つないで読む部品の配列（旗揚げのお題）。
// opts.cut なら同じ key で言いかけの声を止めてから言う。opts.rate はブラウザの読み上げで言うときの速さ。
// 音と同じく 🔇 のときと、まだ画面に触れていないときは言わない。key ごとに GAP_MS より短い間の重なりは1回だけ
export function speak(text, key = 'speak', opts = {}) {
  const parts = (Array.isArray(text) ? text : [text]).filter(Boolean);
  if (muted || !ctx || !parts.length) return;
  const now = performance.now();
  if (now - (lastAt[key] ?? -1e9) < GAP_MS) return;
  lastAt[key] = now;
  talk(parts, key, opts);
}
function talk(parts, key, opts) {
  if (!playVoice(parts, key, opts)) say(parts.join('、'), opts);
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
