---
paths:
  - "native/**"
  - "app/js/platform.js"
  - "tools/build-native.mjs"
---

# App Store 版（`native/`）の作りと注意

何を作るかの本人の決定は CLAUDE.md の「本人が決めたこと」の「App Store 版」（2026-10-17）。ここには作りと、Apple・Google の決まりのうち作るときに効くものを書く。
**App Store 版の話になったら、ファイルを触る前でも先にここを読む。**

## 作り（Claude が決めた。変えるなら本人に確認）

- **中身は `app/` の1か所。** アプリ版との違いは `app/js/platform.js` の `IS_APP`（Capacitor の殻が先に用意する `window.Capacitor` で見分ける）だけで持つ。
  いまの違い: 合言葉なしで部屋を作れる（`main.js` の `canHost`）・持ち主の欄を出さない・招待リンクはウェブ版の住所（`WEB_URL`）。ウェブ版の動きは変えない。
- `tools/build-native.mjs` が `app/` を `native/www/` へ写し、外から読む道具（mqtt.js・qrcode-generator）を `native/node_modules` の同梱の版に替える（審査 2.5.2）。
  替える前の住所がちょうど1か所でなければ止まる。**`app/` 側で道具の版を上げたら、この台本の `VENDOR` と `native/package.json` も同じ版に上げる。**
- `native/www/` と `native/node_modules/` は Git に入れない（作り直せる）。`native/ios/` は入れる（Windows で `npx cap add ios` を走らせて作った。Windows でも作れた）。
  `native/ios/App/App/public/` は殻が中身を写す所で、`ios/.gitignore` が外している。
- 版は Capacitor 8.5.2 に固定（2026-10-17 時点の最新は 8.5.3 だが出て10日だったので、1つ前）。iOS 15 以上（Capacitor の既定）。
- アプリの識別子（Bundle ID）は `io.github.qorigame256.asobiba`（Claude の判断。App Store Connect にアプリを登録するまでは変えられる）。表示名は「みんなの対戦」（商標は未確認）。
- 手元で見る: `node tools/build-native.mjs` → `.claude/launch.json` の `native-www`（http://localhost:8090/）。
  アプリ版として見るには、存在しない住所（/app-check など）を開き、`index.html` の頭に `<base href="http://localhost:8090/">` と `window.Capacitor={isNativePlatform:()=>true}` を足したものを `document.write` する。
  iframe の srcdoc で真似ると住所が about:srcdoc になり、部屋を作るところで `history.replaceState` が止まる（本物のアプリでは起きない）。
- **Mac で組み立てて iPhone に入れる手順は `docs/Mac作業手順.md`**（Mac の Claude もこれを読んで進める）。2026-10-17 の本人の決定（Claude が問いを出した）:
  Mac へは GitHub から `git clone` で持っていく（Claude の推奨どおり。zip は使わない）。**Mac の Claude はその場で何を直してもよい**（Claude は Windows を正にした一方通行を推したが、本人が選んだ）。
  直した分はその日のうちにパッチの束で Windows へ戻し、Windows の Claude が中身を確かめてから取り込んで GitHub へ送る（Mac からは送らない。戻し方は Claude の判断）。
- `npm audit` は `@capacitor/cli` の中の uuid を指摘する（組み立ての道具の中だけで、アプリには入らない。直すと版が下がるので触っていない）。

## Apple・Google の決まりで効くもの（2026-10-17 に調べた。審査ガイドラインは 2026-06-08 版）

- 4.2: ウェブを包んだだけのアプリは断られやすい。アプリならではの良さを足す。
- 2.1・2.3.1: 審査の人がすべての機能を試せるように（合言葉を外したのはこのため）。機能は審査メモに具体的に書く。
- 1.2: 文字・絵を送れる所に、ふるい・通報・締め出し・連絡先が要る（本人の決定 7）。
- 5.1.1(i): プライバシーポリシーへのリンクを App Store Connect とアプリの中の両方に。
- 5.1.2(i): 追跡の許可と引き換えに特典を出したり、断った人の機能を止めたりしない。ATT の画面の前に説明を出すのはよい。Info.plist に `NSUserTrackingUsageDescription`、AdMob の `SKAdNetworkItems` が要る。
- 3.1.1: アプリの中で売るものは Apple の課金だけ。課金には有料アプリの契約・口座・税の書類（本人の作業）が要る。特定商取引法の表記が要るかは未確認。
- 年齢区分: 模擬ギャンブル（ポーカー・ブラックジャック）は「まれ」13+・「頻繁」18+（Apple の表の写しを二次情報で見た）。
- 提出は Xcode 26 以降・iOS 26 SDK 以降（2026-04-28 から）。
- AdMob: 帯広告は遊んでいる画面とボタンのすぐ横に置かない・中身に重ねない（守らないと広告を止められる）。日本以外（特にヨーロッパ）に配るなら Google の同意の画面が要る。
- 公開ブローカー broker.emqx.io は運営元が「試作・学習・テスト向け」と書いている。

## まだ作っていないもの（順番は未定）

広告（AdMob・ATT）・「広告を消す」の課金・汚い言葉のふるいと通報と連絡先・コネクトフォーの改名・プライバシーポリシーのページ・アプリならではの良さ（4.2）・アイコンと起動画面・
商標の確認（ワードウルフ・ヨット・みんなの対戦）。
