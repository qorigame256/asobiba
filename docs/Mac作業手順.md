# Mac で組み立てて iPhone に入れる手順（App Store 版）

App Store 版（`native/`。Capacitor 8.5.2）を Mac で組み立て、本人の iPhone に入れて確かめるための手順。
読むのは **本人** と **Mac の Claude**。Mac の Claude には Windows 側の Claude の決まり（`~/.claude`）が無いので、要ることは 8章に書いた。

- 作りと Apple の決まりの注意は `.claude/rules/appstore.md`、何を作るかの本人の決定は `CLAUDE.md` の「App Store 版」。**Mac の Claude は先にこの2つを読む。**
- この手順は 2026-10-17 に書いた。**まだ一度も Mac で通していない。** Xcode や macOS の画面の名前が違っていたら画面が正で、この手順書を直す。
- Apple Developer Program（有料）にはまだ入っていない。**無料の Apple ID で自分の iPhone に入れる段階**（App Store への提出・TestFlight はできない）。

## 0. 全体の流れ

| 章 | だれが | 何をする |
|---|---|---|
| 1 | Windows の Claude | GitHub へ送ってあることを確かめる |
| 2 | 本人（初回だけ） | Mac に Node.js を入れ、リポジトリを取ってきて、Mac の Claude を起こす |
| 3 | Mac の Claude | 道具を入れて組み立て、署名なしでコンパイルが通るか見る |
| 4 | 本人 | Xcode で署名して iPhone に入れる |
| 5 | 本人（Mac の Claude と） | iPhone で確かめる |
| 6 | 本人・Mac の Claude | 結果（と Mac で直した分）を Windows へ持ち帰る |
| 7 | — | 2回目以降・7日の期限 |

## 1. Windows 側で先に済ませること（Windows の Claude）

Mac は GitHub の公開リポジトリ `qorigame256/asobiba` から取ってくる（2026-10-17 本人の決定。zip は使わない）。
**この手順書と `native/` が入ったコミットが GitHub に届いていること**を確かめる。Windows のこのフォルダで:

```bash
git fetch origin
git status -sb
```

`## main...origin/main` の後ろに `[ahead …]` が付いていなければ届いている。付いていたら、本人に送ってよいか聞いてから `timeout 60 git push origin main`。
（送ると公開サイトも更新される。公開されるのは `app/` だけ）

## 2. Mac で1回だけの準備（本人）

Mac の「ターミナル」（Launchpad の「その他」の中、または Spotlight で「ターミナル」）に、下の枠の中を1行ずつ貼って Return を押す。

### 2.1 Xcode が使える状態か

```bash
xcode-select -p
```

- `/Applications/Xcode.app/Contents/Developer` と出れば正しい。
- `/Library/Developer/CommandLineTools` と出たら、次を貼る（Mac のログインのパスワードを聞かれる。打っても画面に出ないのは正常）:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

- Xcode を入れてから一度も開いていなければ、先に Xcode を1回開き、「追加の部品を入れますか」「使用許諾に同意しますか」が出たら進める（出なければそのままでよい）。

### 2.2 Node.js を入れる

組み立ての道具（Capacitor）が Node.js の **22 以上**を求める（`native/node_modules/@capacitor/cli/package.json` の `engines`）。Windows と同じ **24 の系列**を入れる。

1. Safari で https://nodejs.org/ja/download を開く。
2. 版を **v24.x.x（LTS）**、OS を **macOS** にして、**macOS インストーラー（.pkg）** を落とす（画面の作りが違っていたら「v24」「macOS」「.pkg」の3つがそろうものを選ぶ）。
3. 落とした `.pkg` をダブルクリックし、「続ける」で最後まで進める。
4. ターミナルを**一度閉じて開き直し**、次を貼る:

```bash
node -v
```

`v24.` で始まる版が出れば成功。`command not found` ならターミナルを開き直していないか、入れるのが途中で止まっている。

### 2.3 リポジトリを取ってくる

置き場所は `~/asobiba`（`~` は自分のホームのフォルダ。**日本語と空白の入らない場所にする**。Xcode の組み立てが日本語の場所でつまずくことがあるため）。

```bash
cd ~
git clone https://github.com/qorigame256/asobiba.git
cd asobiba
git config user.name qorigame256
git config user.email 328730295+qorigame256@users.noreply.github.com
```

- 公開リポジトリなので、取ってくるだけならログインは要らない。
- 最後の2行は、Mac で直したものを記録するときの作者名。公開リポジトリに Apple のメールアドレスを出さないため（Windows と同じ設定）。
- `git` を打ったときに「コマンドライン・デベロッパ・ツールをインストールしますか」と出たら、2.1 が終わっていない。2.1 に戻る。

### 2.4 Mac の Claude を起こす

```bash
cd ~/asobiba
claude
```

最初にこう頼む: **「docs/Mac作業手順.md を読んで、3章から進めて」**

## 3. 組み立て（Mac の Claude が進める）

### 3.1 道具を入れて中身を作る

```bash
cd ~/asobiba/native
npm ci
node ../tools/build-native.mjs
npx cap sync ios
```

- `npm ci` は `package-lock.json` に書かれた版のとおりに道具を入れる（`npm install` と違い、版を勝手に上げない）。
- `build-native.mjs` は `app/`（ゲームの中身）を `native/www/` へ写し、ネットから読んでいる道具2つを同梱の版に替える。
  成功すると `native/www/ を作りました（外から読む道具 2 個を同梱に替えた）` と出る。`止めました:` で始まったら、その文が原因（台本の先頭のコメントに意味がある）。
- `npx cap sync ios` は `native/www/` を Xcode のプロジェクトの中（`native/ios/App/App/public/`）へ写す。
  このプロジェクトは CocoaPods ではなく Swift Package Manager（Xcode が部品を自分で取ってくる仕組み）なので、`pod` は要らない。

### 3.2 切り分け: 署名なしでコンパイルだけ通す

iPhone も Apple ID も使わずに「道具の側の問題」か「このアプリの側の問題」かを分ける段（スキル mac-device-check の §2.2）。初回は部品（capacitor-swift-pm 8.5.2）を GitHub から取ってくるのでネットが要り、数分かかる。

```bash
cd ~/asobiba/native/ios/App
xcodebuild -project App.xcodeproj -scheme App -sdk iphoneos -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

- 最後に `** BUILD SUCCEEDED **` が出れば通過。
- `does not contain a scheme named "App"` と出たら、本人に Xcode で一度プロジェクトを開いてもらう（4.1）か、`xcodebuild -list -project App.xcodeproj` で名前を見る。
  **この Xcode（27.0）でこのコマンドが通るかは未確認。**
- 失敗したら 6章の決まりどおり、Mac の Claude がその場で直してよい。

## 4. Xcode で署名して iPhone に入れる（本人）

### 4.1 開く

```bash
open ~/asobiba/native/ios/App/App.xcodeproj
```

開いた直後、ウィンドウの下や左に「Resolving Package Graph」「Fetching…」などが出ている間は待つ（部品を取ってきている）。

### 4.2 署名（無料の Apple ID）

1. 左の一覧の一番上の青いアイコン **App** を押す → 真ん中の **TARGETS** の **App** → 上の **Signing & Capabilities**。
2. **Automatically manage signing** にチェック → **Team** で自分の Apple ID（`（Personal Team）` と付いたもの）を選ぶ。
   一覧に無ければ **Xcode > Settings > Apple Accounts**（版によっては「Accounts」）で自分の Apple ID を足す。
3. **Bundle Identifier** は `io.github.qorigame256.asobiba`。「使えない」と赤字が出たら、末尾に自分だけの語を足す（例 `io.github.qorigame256.asobiba.test`）。
   **一度決めたら使い回す**（無料の Apple ID は識別子を7日で10個までしか作れない）。足した場合は 6章の「持ち帰らないもの」になる。

### 4.3 iPhone に入れる

1. iPhone を**ケーブルで** Mac につなぐ。iPhone に「このコンピュータを信頼しますか」と出たら「信頼」。
2. Xcode のウィンドウの上の真ん中（`App >` の右）で、**つないだ iPhone の名前**を選ぶ（`iPhone 17 Pro` のような機種名だけの項目はシミュレータなので選ばない）。
3. 左上の **▶** を押す。iPhone のロックは解いたままにしておく。

初回は iPhone 側で次の3つがこの順に出る（スキル mac-device-check の §2.5）:

1. **デベロッパモード**: iPhone の 設定 > プライバシーとセキュリティ > デベロッパモード をオン → 再起動 → 再起動後に「オンにする」。この項目は ▶ を一度押すまで出てこない。
2. **デバイスの準備**: Xcode に `Preparing iPhone for development...`。数分〜十数分。ケーブルを抜かない。
3. **デベロッパを信頼**: アプリを開くと「信頼されていないデベロッパ」と出たら、設定 > 一般 > VPNとデバイス管理 > 自分の Apple ID > 信頼（ネットにつながっている必要がある）。
   前にほかのアプリで信頼していても、署名に使う Apple ID が違うともう一度出る。

ホーム画面に「みんなの対戦」が出て、開いてゲームの一覧が出れば入った。

## 5. iPhone で確かめること

確かめる項目は `docs/未確認のもの.md` の「App Store 版」の行と同じ。始める前に iPhone の**マナーモードを外し、音量を上げる**（マナーモードでは効果音は鳴らない作り）。
結果は 6章の `結果.md` に、項目ごとに **OK / NG / 見ていない** と、気づいたことを書く。

| # | 確かめること | やり方 | OK の形 |
|---|---|---|---|
| 1 | アプリ版として動くか | アプリを開いてホーム画面を見る | 「持ち主の方はこちら」（合言葉を入れる所）が**無い**。説明が「部屋を作って、友だちに招待リンクを送れば対戦できます。」で、ゲームが並び「部屋を作る」が押せる |
| 2 | 画面の端 | ホーム画面と対局の画面の一番上・一番下を見る | 字やボタンが iPhone の時計・電池の表示やカメラの黒い所、下の横棒に**隠れていない** |
| 3 | 通信 | どれかのゲームで「部屋を作る」 | 待合室の部屋の欄が「接続中」になり、遅れの秒数が出る |
| 4 | 共有と QR コード | 待合室の上の「招待する」→ 小窓に QR コードが出るか見る →「リンクを送る」 | QR コードが出る。iPhone の共有の画面が出る（出ずに「招待リンクをコピーしました」と出たら、共有の画面が使えていないので NG と書く）。共有先に「メモ」を選んだとき、住所が `https://qorigame256.github.io/asobiba/?room=` で始まる |
| 5 | ほかの端末と遊べるか（できれば） | 4 のリンクを Windows の PC のブラウザで開いて部屋に入り、マルバツを1局打つ | 両方の画面で同じように進む |
| 6 | 効果音 | マルバツの「この画面で2人で」で1局打つ | 置いたとき・決着したときに音が鳴る。上の 🔊 を押して 🔇 にすると鳴らない |
| 7 | 読み上げ | 6 と同じ対局の始めと終わり | 始めに「よろしくお願いします」、終わりに「ありがとうございました」と声が出る |
| 8 | 画面を暗くしない | iPhone の 設定 > 画面表示と明るさ > 自動ロック を **30秒** にする（終わったら元に戻す）。低電力モードは切る。部屋を作って待合室のまま触らず1分待つ。比べるためにホーム画面でも1分待つ | 待合室では画面が消えない。ホーム画面では30秒で暗くなる |

うまく動かなかったときに中を覗く道具（任意。画面の名前は版で違うことがある）: iPhone の 設定 > アプリ > Safari > 詳細 > Web インスペクタ をオン、
Mac の Safari の 設定 > 詳細 >「Web デベロッパ用の機能を表示」をオン → Safari のメニュー「開発」> iPhone の名前 > アプリの画面。
Xcode の ▶ で入れた版（Debug）なら見られるはず（Capacitor の既定。このアプリでは未確認）。赤い字のエラーがあれば全文を持ち帰る。

## 6. 結果の持ち帰りと、Mac で直してよいか

### 6.1 Mac で直してよい（2026-10-17 本人の決定）

**Mac の Claude はその場で何を直してもよい**（`app/` のゲームの中身も、`native/` も、`tools/` も）。決まりの置き場所は `.claude/rules/appstore.md`。
直した分は**その日のうちに** Windows へ戻す。GitHub へは Mac から送らない（Mac には GitHub のログインが無い。Windows の Claude が中身を確かめてから送る）。

Mac の Claude の進め方:

1. 直し始める前に、日付の枝を作る: `git switch -c mac-2026MMDD`（`MMDD` はその日の月日）。`main` には記録しない。
2. 直したら、名前を挙げて記録する: `git add <ファイル名>` → `git commit`。メッセージには、何を直したか・本人が決めたことと Claude が決めたことの書き分け・確かめたこと（実機で何を見たか）を書く。
3. **記録に入れないもの**（公開リポジトリのため。記録の前に `git diff --cached` で見る）:
   - Xcode で Team を選んだときに `project.pbxproj` に入る **`DEVELOPMENT_TEAM` の行**（`git diff --cached | grep DEVELOPMENT_TEAM` が何も出さないこと）。
   - 4.2 で Bundle Identifier に足した語。
   - Mac のユーザー名・`/Users/…` で始まるパス・Apple ID・端末の名前。
   `project.pbxproj` を直す必要があるときは、上の行を手で戻してから記録し、記録のあとで Xcode の Team を選び直す。
4. 戻す束を作る:

```bash
mkdir -p ~/asobiba-mac-back
cd ~/asobiba
git format-patch main -o ~/asobiba-mac-back
```

`0001-….patch` のようなファイルが、直した記録1つにつき1つできる（直していなければできない）。

### 6.2 戻しの束

`~/asobiba-mac-back/` に次を入れ、フォルダごと圧縮して（Finder で右クリック >「圧縮」）`asobiba_2026MMDD_Mac戻し.zip` にする:

- `結果.md`（下の形。Mac の Claude が書く）
- 6.1 の `.patch`（あれば）
- 画面の写真やエラーの画面写し（あれば。iPhone で撮ったものは AirDrop で Mac へ）

```markdown
# Mac での結果（2026-MM-DD）
- Xcode: （Xcode > About Xcode の Version と Build）
- macOS: 
- iPhone: （機種）／ iOS: （設定 > 一般 > 情報 > iOS バージョン）
- 3.2 署名なしのコンパイル: 通った／通らなかった（エラー全文）
- iPhone に入ったか: 入った／入らなかった（エラー全文）
- 5章の確かめ: 1〜8 を OK / NG / 見ていない と、気づいたこと
- Mac で直したこと: なし／パッチの数と、それぞれ何を直したか（一言）
- Windows で続きにやってほしいこと: 
```

**エラーは全文**（文字をコピーするか、画面写し）。「なんとなく失敗した」では Windows で直せない。

束は USB メモリ・クラウドドライブ・自分あてのメールのどれで運んでもよい。Windows では「ダウンロード」フォルダに置き、Windows の Claude に
**「Mac の戻しの束をダウンロードに置いた」** と伝える（リポジトリのフォルダの中には置かない）。

### 6.3 Windows の Claude がすること

1. `結果.md` を読み、`.patch` の中身を全部読む（上の「記録に入れないもの」が入っていないか、ほかの会話の変更とぶつからないか）。
2. 問題なければ `git am <束の中の .patch>` で取り込む。`node tools/test-logic.mjs` を走らせる。
3. 確かめられた項目の行を `docs/未確認のもの.md` から消し、NG や新しく分かった未確認は同じファイルに足す。結果はコミットのメッセージに書く（`結果.md` そのものはリポジトリに入れない）。
4. GitHub へ送る前に本人に聞く。送ったら本人に「Mac で 7章の更新をしてよい」と伝える。

## 7. 2回目以降・7日の期限

新しい版を Mac に持っていくとき（Windows で GitHub へ送ったあと）:

```bash
cd ~/asobiba
git restore native/ios/App/App.xcodeproj/project.pbxproj
git switch main
git pull
cd native
npm ci
node ../tools/build-native.mjs
npx cap sync ios
```

- 1行目は Xcode で Team を選んだときの書き換えを戻す（戻さないと `git pull` が止まることがある）。Xcode を開いたら 4.2 の Team を選び直す。
- 前回の `mac-…` の枝は、Windows で取り込んで GitHub へ送ったのを確かめてから消す: `git branch -D mac-2026MMDD`。
- 道具の版が変わっていなければ `npm ci` は飛ばしてよい。

無料の Apple ID の決まり（スキル mac-device-check の §3）:

- **7日で起動しなくなる。** 故障ではない。Mac につないで Xcode の ▶ を押せば直る（遊んだ記録などは残る）。続けて確かめたいことは1週間以内にまとめる。
- **1台の iPhone に自分で入れたアプリは3本まで。** ほかのアプリ（クイズアプリなど）を同じやり方で入れていると、
  `The maximum number of apps for free development profiles has been reached.` で入らない。使っていない方を iPhone から消す（取り除いたアプリも数に入る）。

## 8. Mac の Claude へ（Windows の決まりのうち、ここで要るもの）

リポジトリの `CLAUDE.md` と `.claude/rules/` は Mac にもある。それに加えて、Windows の Claude が全部のプロジェクトで守っている決まりのうち、この作業で要るもの:

- **日本語で答える。本人はプログラミングの知識がほぼゼロ**として説明する。専門用語は初めて出たときに一言で補う（例: 署名（＝この Apple ID が作ったと iPhone に証明すること））。
  ターミナルに貼ってもらう命令は、1つの枠に1行ずつ書く。
- **確かめていないことを、確かめた形で書かない。** ファイル名・数字・画面の名前は、その場で開いて・動かして確かめる。確かめられなければ「未確認」と書く。
- **消す・上書きする前に中身を読む。** そのファイルにしか無い情報が無いか確かめる。
- **判断を本人に聞くときは、問いごとに推奨と理由を1つ付ける。** 好み・方針に関わることは推測で決めない。
- **公開リポジトリ。** コード・書類・コミットのメッセージに、個人情報（Mac のユーザー名・`/Users/…` のパス・Apple ID・Team ID・端末の名前）を書かない。6.1 の「記録に入れないもの」も守る。
- **GitHub へ送らない**（`git push` しない）。戻し方は 6章。記録は `git add <ファイル名>` で名前を挙げる（`git add .` や `-A` を使わない）。
- 自動の確認は `node tools/test-logic.mjs`（数秒）。麻雀の対照表の突き合わせは Mac には表が無いので飛ばされる（正常）。
- 作業の最後に「次に何をするか」を1〜3行で書く。
- 手順書と画面が食い違ったら画面が正。違っていた所は `結果.md` に書けば、Windows の Claude がこの手順書を直す（Mac で直してもよい。6.1 の決まりどおり記録して戻す）。

## 9. うまくいかないとき

| 症状 | まず見るところ |
|---|---|
| `npm ci` が `engine` や `Unsupported engine` で止まる | Node.js の版が古い（2.2）。`node -v` が v22 以上か |
| `止めました: native/node_modules がありません` | `native/` で `npm ci` を先に走らせていない |
| `npx cap sync ios` が Xcode を見つけられない | 2.1 の `xcode-select -p` |
| Xcode が部品を取ってこられない（`capacitor-swift-pm` の名前が入ったエラー） | ネットにつながっているか。Xcode の File > Packages > Reset Package Caches を試す |
| `requires that Developer Mode be enabled` | 4.3 の1 |
| 入ったが開くとすぐ閉じる・「信頼されていないデベロッパ」 | 4.3 の3 |
| `Failed to create provisioning profile` | 4.2 の3（Bundle Identifier を変える。乱発しない） |
| 開くと真っ白のまま | 3.1 の `build-native.mjs` と `npx cap sync ios` を走らせたか。5章の末尾の道具で赤い字のエラーを見る |
| 7日ほどで開かなくなった | 7章。▶ で入れ直すだけ |
