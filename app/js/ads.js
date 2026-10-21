// 広告と追跡（App Store 版だけ。2026-10-17・10-22 本人の決定。CLAUDE.md の「App Store 版」の 3）。ウェブ版では何もしない。
// 広告は Google の AdMob を、Capacitor の部品 @capacitor-community/admob（native/package.json）で出す。
// 部品は殻の中の本物の画面（ウェブの画面の上）に描くので、帯広告の高さだけウェブの画面の下をあける（CSS の --ad-h）。
// - 帯広告: ホーム画面と待合室の一番下だけ（対局の画面には出さない。Google の決まりで、遊んでいる画面とボタンのすぐ横は不可）。
// - 全画面広告: 決着した対局を AD_EVERY 回数えるごとに1回、前の広告から AD_GAP_MS 以上あける。結果の画面でその人が自分で
//   「もう一回」「メンバーを変える」「← ホーム」を押したときに出し、閉じてから押した動きを進める（beforeLeaveResult）。
// - 追跡の許可（ATT）: 初めて開いたときに iPhone の画面だけを出す（先に説明を出さない。本人の選択）。2回目からは iPhone が聞かない。
// 数えた回数・時刻は覚えない（アプリを閉じると0から。端末に残す情報を増やさないため。Claude の判断）。

import { IS_APP } from './platform.js';

// いまは Google の試験用の番号（https://developers.google.com/admob/ios/test-ads）。本物の番号は本人の AdMob 登録のあとに替える。
// アプリの番号（~ の付いたほう）は native/ios/App/App/Info.plist の GADApplicationIdentifier にある。
export const AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/2435281174', // 試験用（帯・幅に合わせる形）
  interstitial: 'ca-app-pub-3940256099942544/4411468910', // 試験用（全画面）
};
const AD_EVERY = 3;
const AD_GAP_MS = 3 * 60 * 1000;
const SHOW_WAIT_MS = 120 * 1000; // 全画面広告が閉じた知らせが来なくても、この時間がたったら先へ進める（止まったままにしない）

let admob = null; // 部品（使えないときは null のまま。ウェブ版・部品の無い殻）
let ready = false; // 広告を頼んでよい
let wantBanner = false;
let bannerOn = false; // 帯広告を出している（隠しているときは false）
let bannerMade = false; // showBanner で作った（2回目からは resumeBanner で戻す）
let loaded = false; // 全画面広告を用意できている
let loading = false;
let counted = 0; // 前の全画面広告のあとに決着した対局の数
let lastShown = -Infinity; // 前の全画面広告を出した時刻（performance.now）
const seen = new Set(); // 数えた対局（同じ対局の描き直しで2回数えない）

const setInset = (px) => document.documentElement.style.setProperty('--ad-h', px > 0 ? px + 'px' : '0px');

// 起動のときに1回。帯広告を出したい状態なら、用意ができしだい出す
export async function initAds({ muted }) {
  if (!IS_APP) return;
  admob = window.Capacitor?.registerPlugin?.('AdMob') ?? null;
  if (!admob || !window.Capacitor?.isPluginAvailable?.('AdMob')) { admob = null; return; }
  try {
    // 部品は、帯を出す・戻すと高さを、隠す・読み込みに失敗すると0を知らせる。隠したあとの0は、こちらで先に0にしてあるので見なくてよい
    await admob.addListener('bannerAdSizeChanged', (s) => { if (bannerOn) setInset(Math.ceil(s?.height ?? 0)); });
    // 読み込みに失敗すると部品が帯を消すので、次に出すときは作り直す
    await admob.addListener('bannerAdFailedToLoad', () => { bannerMade = false; });
    await admob.addListener('interstitialAdLoaded', () => { loaded = true; loading = false; });
    await admob.addListener('interstitialAdFailedToLoad', () => { loaded = false; loading = false; });
    // ヨーロッパなどで要る同意の画面（Google の UMP）。配信は日本だけなので AdMob に文面は作っていないが、配る国を増やしたときのために聞いておく
    let consent = null;
    try { consent = await admob.requestConsentInfo(); } catch { /* 聞けなくても日本では広告を頼める */ }
    if (consent?.isConsentFormAvailable && consent.status === 'REQUIRED') consent = await admob.showConsentForm();
    if (consent && consent.canRequestAds === false) return;
    // 追跡の許可は、広告の仕組みを動かす前に聞く（許可した人には最初の広告から個人に合わせた広告になる）
    try {
      const t = await admob.trackingAuthorizationStatus();
      if (t?.status === 'notDetermined') await admob.requestTrackingAuthorization();
    } catch { /* 聞けなくても広告は出せる */ }
    await admob.initialize();
    await admob.setApplicationMuted({ muted: !!muted });
    ready = true;
    prepare();
    syncBanner();
  } catch (e) {
    console.warn('広告を用意できませんでした', e);
  }
}

// 🔇 のときは広告の音も消す
export function setAdsMuted(muted) {
  if (ready) admob.setApplicationMuted({ muted: !!muted }).catch(() => {});
}

// 帯広告を出す画面（ホーム・待合室）かどうか。画面が替わるたびに呼ぶ
export function setBanner(on) {
  wantBanner = !!on;
  syncBanner();
}

let syncing = Promise.resolve();
function syncBanner() {
  if (!ready) return;
  syncing = syncing.then(async () => {
    if (wantBanner === bannerOn) return;
    try {
      if (wantBanner) {
        bannerOn = true;
        let shown = false;
        if (bannerMade) shown = await admob.resumeBanner().then(() => true, () => false); // 帯が無くなっていると断られる
        if (!shown) { await admob.showBanner({ adId: AD_UNITS.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0 }); bannerMade = true; }
      } else {
        bannerOn = false;
        setInset(0); // 先に下をあけるのをやめる（隠したあとで中身が下に寄るのを待たない）
        await admob.hideBanner();
      }
    } catch (e) {
      console.warn('帯広告', e);
    }
  });
}

function prepare() {
  if (!ready || loaded || loading) return;
  loading = true;
  admob.prepareInterstitial({ adId: AD_UNITS.interstitial }).catch(() => { loading = false; });
}

// 結果の画面に出た対局を数える（key はその対局を見分ける文字。同じ対局は1回だけ）
export function countFinished(key) {
  if (!IS_APP || seen.has(key)) return;
  seen.add(key);
  counted++;
}

let showing = false;
// 結果の画面のボタン（もう一回など）を押したとき、押した動きの前に呼ぶ。出すときは広告が閉じるまで待つ。
// 出している間にもう一度押されたら、その押した分は捨てる（false を返す）。
export async function beforeLeaveResult() {
  if (showing) return false;
  if (!ready || !loaded || counted < AD_EVERY || performance.now() - lastShown < AD_GAP_MS) {
    prepare();
    return true;
  }
  showing = true;
  loaded = false;
  try {
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); handles.forEach((h) => h.then((x) => x.remove()).catch(() => {})); resolve(); };
      const timer = setTimeout(done, SHOW_WAIT_MS);
      const handles = [admob.addListener('interstitialAdDismissed', done), admob.addListener('interstitialAdFailedToShow', done)];
      admob.showInterstitial().then(() => { counted = 0; lastShown = performance.now(); }, done);
    });
  } finally {
    showing = false;
    prepare();
  }
  return true;
}
