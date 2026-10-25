---
paths:
  - "native/**"
  - "app/js/platform.js"
  - "tools/build-native.mjs"
  - "app/js/ads.js"
  - "app/js/native.js"
  - "app/privacy.html"
---

# App Store 版（`native/`）の作りと注意

何を作るかの本人の決定は CLAUDE.md の「本人が決めたこと」の「App Store 版」（2026-10-17）。広告・課金・プライバシーポリシーの細かい決定は下の「本人が決めたことの細部」。
ここには作りと、Apple・Google の決まりのうち作るときに効くものも書く。
**App Store 版の話になったら、ファイルを触る前でも先にここを読む。**

## 本人が決めたことの細部（2026-10-22 に CLAUDE.md の「App Store 版」の 3 と 11 から移した）

CLAUDE.md が目安の大きさを超えたため（Claude の推奨を本人が承認）。CLAUDE.md には決定の骨組みと、全体に効く決まり（「送る情報を変えたら `privacy.html` も直す」など）を残した。下は移す前の文のまま。

- 広告と課金（CLAUDE.md の 3。広告と課金を入れると本人が決めた。Claude は無しを推した）:
  - 広告は Google の AdMob。**対局の結果を見せたあとの全画面広告（数回に1回まで）**と、**ホーム画面と待合室の一番下の帯広告**。対局の画面には帯広告を出さない（Google の決まりで、遊んでいる画面とボタンのすぐ横は不可）。
  - **追跡を付ける**（ATT＝「ほかのアプリでの行動の追跡を許可しますか」の画面を出し、許可した人には個人に合わせた広告）。「許可したら特典」「断ったら使えない」は Apple の決まりで作れない。
  - 課金は**「広告を消す」の買い切り1つだけ**（勝ち負けに関わらず、ウェブ版の人と同じ部屋で不公平にならないため）。**値段は保留**（審査に出す前に決める）。
    → 2026-10-22 に本人が**買う色（スキン）**を足した（勝ち負けに関わらない見た目なので上の理由は崩れない。決定は CLAUDE.md の「ランキング・スキン」）。
  - 細かい所（2026-10-22 本人の決定。Claude が問いを出した）: 全画面広告は**決着した対局を3回数えるごとに1回、しかも前の広告から3分以上あける**（推奨を承認）。
    出すのは**結果の画面で、その人が自分で「もう一回」「メンバーを変える」「← ホーム」を押したとき**で、広告を閉じてから押した動きが進む（推奨を承認。勝手に出すと、全員が同時に動くゲームで次の対局の始まりに重なるため）。
    追跡の許可は**アプリを初めて開いたときに iPhone の画面だけ**を出す（Claude は先に短い説明を出す形を推したが、本人が説明なしを選んだ）。
- プライバシーポリシー（CLAUDE.md の 11。2026-10-21。Claude の推奨を7つとも承認）:
  運営者はクイズアプリと同じ形（氏名は審査に出す直前に入れる。公開のページなので、入れた時点で GitHub にも載る）。開示などの請求の窓口はクイズアプリと同じメールアドレス。
  独自の利用規約は作らず Apple の標準の規約を使う。最初に開いたときの同意の画面は作らない。13歳未満は対象にしない。

## 作り（Claude が決めた。変えるなら本人に確認）

- **中身は `app/` の1か所。** アプリ版との違いは `app/js/platform.js` の `IS_APP`（Capacitor の殻が先に用意する `window.Capacitor` で見分ける）だけで持つ。
  いまの違い: 合言葉なしで部屋を作れる（`main.js` の `canHost`）・持ち主の欄を出さない・招待リンクはウェブ版の住所（`WEB_URL`）。ウェブ版の動きは変えない。
- `tools/build-native.mjs` が `app/` を `native/www/` へ写し、外から読む道具（mqtt.js・qrcode-generator）を `native/node_modules` の同梱の版に替える（審査 2.5.2）。
  替える前の住所がちょうど1か所でなければ止まる。**`app/` 側で道具の版を上げたら、この台本の `VENDOR` と `native/package.json` も同じ版に上げる。**
- `native/www/` と `native/node_modules/` は Git に入れない（作り直せる）。`native/ios/` は入れる（Windows で `npx cap add ios` を走らせて作った。Windows でも作れた）。
  `native/ios/App/App/public/` は殻が中身を写す所で、`ios/.gitignore` が外している。
- 版は Capacitor 8.5.2 に固定（2026-10-17 時点の最新は 8.5.3 だが出て10日だったので、1つ前）。iOS 15 以上（Capacitor の既定）。
- アプリの識別子（Bundle ID）は `io.github.qorigame256.asobiba`（Claude の判断。App Store Connect にアプリを登録するまでは変えられる）。表示名は「みんなの遊び場」（2026-10-26 本人の決定で「みんなの対戦」から変えた）。
- 手元で見る: `node tools/build-native.mjs` → `.claude/launch.json` の `native-www`（http://localhost:8090/）。
  アプリ版として見るには、存在しない住所（/app-check など）を開き、`index.html` の頭に `<base href="http://localhost:8090/">` と `window.Capacitor={isNativePlatform:()=>true}` を足したものを `document.write` する。
  iframe の srcdoc で真似ると住所が about:srcdoc になり、部屋を作るところで `history.replaceState` が止まる（本物のアプリでは起きない）。
- **Mac で組み立てて iPhone に入れる手順は `docs/Mac作業手順.md`**（Mac の Claude もこれを読んで進める）。2026-10-17 の本人の決定（Claude が問いを出した）:
  Mac へは GitHub から `git clone` で持っていく（Claude の推奨どおり。zip は使わない）。**Mac の Claude はその場で何を直してもよい**（Claude は Windows を正にした一方通行を推したが、本人が選んだ）。
  直した分はその日のうちにパッチの束で Windows へ戻し、Windows の Claude が中身を確かめてから取り込んで GitHub へ送る（Mac からは送らない。戻し方は Claude の判断）。
- **広告と追跡の作り（2026-10-22。本人の決定は上の「本人が決めたことの細部」（CLAUDE.md の「App Store 版」の 3））**: 部品は `@capacitor-community/admob` 8.2.1（MIT。Google Mobile Ads SDK 13.11.0 を中に持つ。版は Capacitor と同じく固定）。
  中身は `app/js/ads.js` の1か所（帯の出し入れ・数える・全画面広告・追跡の許可）。`main.js` は画面が替わるときに `setBanner`、結果の画面で `countFinished`、結果のボタンで `afterAd` を呼ぶだけ。
  部品は `window.Capacitor.registerPlugin('AdMob')` で呼ぶ。殻の用意する `window.Capacitor` には `registerPlugin` が無いので、`build-native.mjs` が `@capacitor/core` の `capacitor.js` を `vendor/` に写して `main.js` より先に読ませる。
  広告の番号は `ads.js` の `AD_UNITS` と `Info.plist` の `GADApplicationIdentifier`（いまは Google の試験用。本物の番号は本人の AdMob 登録のあと）。`Info.plist` の `SKAdNetworkItems` は Google の一覧（2026-10-22 に50件を写した。Google が足したら写し直す）。
  帯は殻の本物の画面に描かれウェブの画面を押し下げないので、知らされた高さを `--ad-h` に入れて `main` の下の余白とお知らせ（toast）の位置に足す（**画面の下に貼り付くものを足したら `--ad-h` も足す**）。
  部品は帯を隠すと高さ0、戻すと高さを知らせ、読み込みに失敗すると帯を消す（戻すときに断られたら作り直す）。同意の画面（UMP）は、配信が日本だけなので AdMob に文面を作っていないが、配る国を増やしたときのために起動のときに聞いている。
  ブラウザで確かめるときは、上の「アプリ版として見る」の `<base>` のあとに、`window.webkit.messageHandlers.bridge` と `window.Capacitor` の `PluginHeaders`・`nativePromise`・`nativeCallback` を真似た偽物を置く（本物の `capacitor.js` がそれを通して呼ぶので、つなぎ方まで確かめられる）。
- **「広告を消す」の課金の作り（2026-10-22。本人の決定は上の「本人が決めたことの細部」（CLAUDE.md の「App Store 版」の 3）。部品・置き場所・消すものは同日に本人が選んだ）**: 部品は `@capgo/native-purchases` 8.8.2
  （MPL-2.0。Apple の StoreKit 2 と直接やり取りし、外のサーバーへ送らない（iOS 用のコードに外への通信が無いのを確かめた）。改版がとても頻繁なので、2週間以上前の版に固定した。Claude の推奨を本人が承認。
  比べた RevenueCat は外の会社に記録を渡す・自前は落とし穴を自分で埋めることになる、で外した）。中身は `ads.js` の下の節（買う・復元・買ったかの確認）と `main.js` の「広告を消す」の節（ホームの下の段のボタンと小窓）。
  商品の番号は `ads.js` の `NO_ADS_ID`（`io.github.qorigame256.asobiba.removeads`。Claude の判断）。**App Store Connect に「非消耗型」で同じ番号を登録する（本人の作業。登録したら番号は変えられない）。値段もそこで決め、アプリは Apple が返す値段の文字をそのまま出す。**
  買ったかどうかは起動のたびに iPhone に聞く（`getPurchases` の `onlyCurrentEntitlements`。返金されたものは入らない）。端末には覚えない。**起動のときに買ってあれば、広告の部品も追跡の許可の画面も動かさない。**
  家族の承認待ちが通ったとき・返金のときは部品の `transactionUpdated` で聞き直す（返金で戻ったら、そこで広告の仕組みを動かし始める）。部品は届いた買い物を自分で片付ける（`finish`）。
  ライセンスの欄には MPL-2.0 の条件どおり部品のソースの置き場所を出す（`main.js` の `LICENSES` の3つ目の項目）。
  ブラウザで確かめるときは、広告と同じく偽物を置く（`window.Capacitor` の `registerPlugin('NativePurchases')` が偽物を返す形でも見られる。`main.js` はモジュールなので、同じページに `document.write` し直すと読み直されない。毎回存在しない住所を開き直してから書く）。
- **アプリならではの良さの作り（2026-10-22。審査 4.2。本人の決定は下の「まだ作っていないもの」の 5。細かい所は本人が推奨どおりに承認し、振動の付け外しだけ本人が足した）**:
  中身は `app/js/native.js` の1か所。振動は `@capacitor/haptics` 8.0.2（公式・MIT）。**Game Center と画像の保存・共有は自前の部品 `native/plugins/asobiba-native`**
  （Capacitor 8 で使える Game Center の部品が無く、いちばん近い @openforge/capacitor-game-connect は Capacitor 5 まで。画像もここに入れて外の部品を増やさない。Claude の判断）。
  自前の部品は `native/package.json` に `file:plugins/asobiba-native` で入れ、`npx cap sync ios` が `CapApp-SPM/Package.swift` に足す（Xcode のプロジェクトを手で書き換えない）。**Swift は Windows で組み立てられないので、直したら Mac で確かめる。**
  - 振動: 番が来たとき（`turn`）・決着（勝ち `win` は強め、負け `lose` は弱め。勝ちの音と同じ見方）・自分の手が受け付けられたとき（`tap`。`onBoardMove`）。ホームの下の段の「📳 振動」で付け外し（localStorage の `bg-haptics`。最初はオン）。エアホッケーは `hockey.js` が自分で音を鳴らすので振動しない。
  - 実績: `native.js` の `ACHIEVEMENTS`（10個。番号は `io.github.qorigame256.asobiba.ach.<語>`。App Store Connect に同じ番号で登録する）。数は localStorage の `bg-achv`（端末ごと。送るのは Game Center へだけ）。
    数え方は `main.js` の `noteAchievements` の上のコメント。ログインの画面は初めて実績を取ったときと「🏅 実績」を押したときだけ出し、一度ログインできた端末（`bg-gc`）は起動のときに画面を出さずにつなぐ。
    **Xcode で「Game Center」の Capability を付けるのは有料の登録のあと**（無料の Apple ID では付けられない見込み。付いていなくても signIn が失敗するだけでアプリは動く）。
  - 画像で保存・共有: 結果の画面と、お絵描き当ての答えの場面（`phase === 'show'`）の下の段に「📷 画像で保存・共有」。画面の画像は殻の WKWebView の `takeSnapshot` で作る（外の道具で画面を描き直さない）。
    写真に保存するので `Info.plist` に `NSPhotoLibraryAddUsageDescription` を足した。
  - ブラウザで確かめるときは、広告と同じ偽物の `PluginHeaders` に `Haptics`（impact・notification）と `AsobibaNative`（signIn・reportAchievements・showAchievements・shareScreen・reportScores・loadScores）を足す。
- **ランキング（Game Center）と買う色の作り（2026-10-22。本人の決定は CLAUDE.md の「ランキング・スキン」。番号の付け方・何を送るかは Claude の判断）**:
  - ランキングは自前の部品の `reportScores`（`GKLeaderboard.submitScore`）と `loadScores`（上位10人と自分の順位。全国か Game Center の友だち）。何を送るかは `records.js` の先頭。
    番号は `io.github.qorigame256.asobiba.lb.` ＋ `wins`、またはゲーム＋分ける設定（`lb.danmaku.levelhard.time60` など）。**24個**（一覧は `records.js` の `allBoards`。`tools/test-records.mjs` が数と形を見ている）。
    **App Store Connect に同じ番号で「いちばん大きい数字を残す」形で登録する（本人の作業。有料の登録のあと）。** 弾幕回避はミリ秒で送るので、表示の形は「時間（100分の1秒）」などを選ぶ（アプリの中の画面は自分で書き方を決めて出す）。
    ログインの画面を出すのは、ランキングの画面で「順位を見る」を押したときだけ。ログインできたら、端末にたまっている記録をまとめて送る（`onGcSignedIn`）。
  - 買う色は「広告を消す」と同じ部品で、商品の番号は `skin.js` の `SKIN_PREFIX` ＋ 色の id（`io.github.qorigame256.asobiba.skin.kin` など6つ）。**App Store Connect に「非消耗型」で6つ登録する（本人の作業）。**
    買ってあるかは起動のたびに iPhone に聞き（`ads.js` の `checkOwned`。「広告を消す」と一緒）、買う色を選んでいたのに記録が無いと分かったらいつもの色に戻す（聞けるまでは戻さない）。
- **アイコンと起動画面の作り（2026-10-22。Claude の判断）**: アイコンはウェブ版のホーム画面に追加のアイコンと同じ絵（橙の地にマルバツの盤）。起動画面はクリーム色（`--bg`）の地の真ん中に角を丸めたアイコンを置くだけで、字は入れない（Apple の勧め）。
  どちらも `tools/make-icons.py` が `native/ios/App/App/Assets.xcassets/` に書く（`AppIcon.appiconset` の 1024 四方1枚と、`Splash.imageset` の 2732 四方3枚。ファイル名は Capacitor の雛形のまま）。
  起動画面の絵は `LaunchScreen.storyboard` が画面いっぱいに広げて端を切るので、真ん中の幅およそ 1260 の外に物を置かない。storyboard の背景の色も同じクリーム色にした（**地の色を変えたら両方を直す**）。
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

## 商標の確認（2026-10-21 に Claude が J-PlatPat で調べた。法的な判断ではない）

本人の決定 8 で「調べてから決める」とした名前の結果。スマホのゲームは第9類（類似群 11C01）で、紙の札・おもちゃ（第28類 24A01・24B01）とは
特許庁の類似の基準で別の群（J-PlatPat の商品・役務名検索で「電子計算機・携帯電話機・スマートフォン又は携帯情報端末用ゲームプログラム」が 11C01 だけなのを確かめた）。
- **みんなの遊び場**（2026-10-26。アプリ名を変えたとき）: 文字でも読み（ミンナノアソビバ、似た読みも）でも登録なし。前の名前「みんなの対戦」も登録なしだった。
- **ワードウルフ**: 2件。第28類「カードゲーム」（株式会社幻冬舎。登録6351574）と第35類（広告業など。個人。登録6025190）。第9類・第41類には無い。
- **ヨット**: 5件。ゲームに関わりうるのは第9類のセイコーエプソンの1件（登録5754738）だが、指定商品はプリンターだけ。ほかは菓子・服など。
- **コネクトフォー**: 日本では文字でも読み（コネクトフォー・コネクトヨン、似た読み）でも登録なし。米国では Hasbro の登録商標（2026-10-17 に調べた）。
- **いろあわせ**（UNO の言い換え）: 5件。第41類の1件（株式会社いろあわせ。登録5916477）は教授・セミナー・興行などで、オンラインのゲームの提供は入っていない。ほかは菓子・種苗など。
- 言い換えの候補: よんもくならべ・よっつならべ・よんならべは読みで登録なし（似た読みで「SANMOKU NARABE」の服が1件）。

## まだ作っていないもの（この順に作る。2026-10-21 本人の決定。Claude の推奨を承認）

（汚い言葉のふるい・通報・連絡先は 2026-10-21 に作った。作りは CLAUDE.md の「汚い言葉のふるいの作り」と room.md。窓口の Google フォームは本人が作り、できたら `main.js` の `CONTACT_URL` に入れる）
2. ~~プライバシーポリシーのページ（5.1.1）~~ 2026-10-21 に作った（`app/privacy.html`。決定は CLAUDE.md の「App Store 版」の 11 と、上の「本人が決めたことの細部」）。審査に出す前に、第1条の【要決定：氏名】を本名にし、App Store Connect のプライバシーの欄（どの情報を集めるかの申告）をこのページと食い違わないように書く
3. ~~広告と追跡~~ 2026-10-22 に試験用の広告の番号で作った（上の「広告と追跡の作り」）。本物の番号は本人の AdMob 登録のあとに `ads.js` の `AD_UNITS` と `Info.plist` へ入れる
4. ~~「広告を消す」の課金~~ 2026-10-22 に作った（上の「「広告を消す」の課金の作り」）。値段は保留のまま（審査に出す前に本人が決め、App Store Connect に商品を登録する）
5. ~~アプリならではの良さ（4.2）~~ 2026-10-22 に作った: **振動で知らせる・実績（Game Center）・写真に保存と共有の3つ**（本人の決定。Claude が出した6つの案から推奨どおり。選ばなかった案は `docs/出した案の一覧.md`。作りは上の「アプリならではの良さの作り」）。
   細かい所（同日。Claude の推奨を承認）: 振動は番・決着・自分の手の3つの場面／実績は10個で端末ごとに数える／ログインの画面は初めて実績を取ったときと「🏅 実績」のときだけ／画像は結果の画面のボタンで画面ごと。
   **振動はアプリの中でも付け外しできるようにする**（本人の決定。Claude は iPhone の設定に任せる案を推した）。Game Center の Capability と実績の登録は、有料の登録のあとの本人の作業。
6. ~~アイコンと起動画面~~ 2026-10-22 に作った（上の「アイコンと起動画面の作り」）。
（2026-10-22 に本人の依頼でランキングと買う色を足した。上の「ランキング（Game Center）と買う色の作り」）
