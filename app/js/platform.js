// App Store 版（2026-10-17 本人の決定）かどうかの切り替え。ゲームの中身は app/ の1か所のままにし、アプリ版との違いはここで見分ける。
// アプリ版は Capacitor（ウェブの中身を iPhone アプリの殻に入れる道具）の中で動き、殻が window.Capacitor を先に用意する。
// アプリ版用の組み立て（tools/build-native.mjs）は外から読む道具（mqtt.js・QR コード）を同梱に替えるだけで、ほかは同じファイルを使う。

export const IS_APP = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// 招待リンクの行き先。アプリの中の住所（capacitor://localhost）は友だちの端末で開けないので、アプリ版はウェブ版の住所を送る。
export const WEB_URL = 'https://qorigame256.github.io/asobiba/';
