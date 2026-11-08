// 声のファイルにする言葉の一覧（tools/make-voice.mjs が作るのに、tools/test-logic.mjs が全部そろっているかを見るのに使う）。
// 言葉は鳴らす側のファイルから集める（ここに写さない）。speed は VOICEVOX の話す速さ（1 がふつう）
const { SAY, GREET } = await import('../app/js/sound.js');
const { VOICE_TEXTS: FLAGS } = await import('../app/js/games/flags.js');
const { VOICE_TEXTS: BINGO } = await import('../app/js/games/bingo.js');
const { VOICE_TEXTS: KARUTA } = await import('../app/js/games/karuta.js');

export const VOICE_TEXTS = [
  ...[...Object.values(SAY), ...Object.values(GREET)].map((text) => ({ text, speed: 1 })),
  ...FLAGS.map((text) => ({ text, speed: 1.15 })), // 旗揚げは急ぐのでブラウザの読み上げのときと同じく少し速く
  ...BINGO.map((text) => ({ text, speed: 1 })),
  ...KARUTA.map((text) => ({ text, speed: 1 })),
];
