# 家計簿アプリ（PWA）

iPhoneのホーム画面から使う家計簿アプリ（「シンプル家計簿」参考）。**修正指示を受けたら、必ず下の「修正フロー」を上から順に全部実行すること。**編集だけして終わるのは作業未完了。

- 公開URL: https://prkxfzmfx-pixel.github.io/kakeibo/
- リポジトリ: https://github.com/prkxfzmfx-pixel/kakeibo （公開。このフォルダが作業コピー）
- 姉妹アプリ: 筋トレ記録 `..\_workout_app\`。**タブ構成・レイアウト・操作感は両アプリで統一する方針**。片方のUIを変えるときは、もう片方にも同じ変更が必要か必ず検討する。**「あれば対応します」と仮定形で済ませず、もう片方のindex.htmlをgrepして同種のUIの有無を事実確認し、結果（ある/ない）を報告する**。あれば両方に適用するかユーザーに一言確認

## 構成

| ファイル | 内容 |
|---|---|
| index.html | アプリ本体。CSS/JSすべてこの1ファイルに入っている（外部ライブラリ・CDN禁止） |
| sw.js | Service Worker（ネットワーク優先・オフラインキャッシュ） |
| test/smoke.test.js | スモークテスト（DOMスタブ + eval方式） |

## 絶対に守ること

1. **データ本体はユーザーのiPhoneのlocalStorage**（キー `kakeibo.v1`）にあり、サーバーにバックアップはない。保存データの構造（categories/entries/budgets/recurring）を変えるときは、**必ず `normalize()`（＋必要ならバージョン付き移行）に旧形式→新形式の変換を追加**し、テストにケースを足す。既存データを壊すと復元不能
2. レイアウトの根幹を壊さない: `fitViewport()`（スタンドアロン時はscreen.height採用）、body/main/navのflex構造、セーフエリア対応。**`position: fixed` や `100vh/100dvh` を新たに使わない**（iOSスタンドアロンで高さがバグる。過去に実証済み）
3. 公開リポジトリなので、個人情報・トークン・APIキーを絶対に置かない。**例外（ユーザー了承済み・2026-07-07）**: クラウドトークンを6桁コードでAES-GCM暗号化した暗号文（index.htmlの`PIN_BLOB`）のみ置いてよい。**平文トークン・6桁コード本体はコード/コミットメッセージ/テストに絶対に書かない**。再生成は `node tools\make-pin-blob.js <コード> <トークン>`（ローカル実行のみ）
4. 新しいファイルを追加したら `sw.js` の `ASSETS` に追記し、`CACHE` 名の数字を+1する（例: kakeibo-v2 → v3）
5. 既存仕様（固定費の自動記帳＝重複なし・31日は月末クランプ・過去月に遡らない、入力タブ離脱時の初期化、カテゴリ別予算、CSVはBOM付き）はテストが守っている。仕様を変えるならテストも同じコミットで更新する。**機能の削除も仕様変更**であり、「出ないこと・動かないこと」を守るテストを同コミットで追加する
6. 機能を削除・置き換えたら、呼び出し元がなくなった関数・CSSクラス・変数をgrepで探し、同コミットで消す（デッドコードを残さない）

## 修正フロー（この順で必ず全部やる）

1. `index.html` を編集する
2. テスト実行: `node test\smoke.test.js` → **全項目PASSするまで次に進まない**。新機能を足したらテストケースも追加
3. コミット & push（コミットメッセージは日本語で内容を書く）:
   ```powershell
   git add -A; git commit -m "変更内容"; git push
   ```
   （gitが見つからないシェルでは `C:\Program Files\Git\cmd\git.exe` を絶対パスで）
4. 配信確認（push後1〜2分かかる）。今回の変更にしか含まれない文字列で判定する:
   ```powershell
   (Invoke-WebRequest "https://prkxfzmfx-pixel.github.io/kakeibo/?v=$(Get-Random)" -UseBasicParsing).Content -match "新コード固有の文字列"
   ```
   **削除だけの変更**（新規文字列がない場合）は、**同一レスポンス**で「消した文字列が含まれない」＋「既存の固有文字列が含まれる」の両方を確認する（別々にfetchすると別バージョンを見る可能性がある）:
   ```powershell
   $c = (Invoke-WebRequest "https://prkxfzmfx-pixel.github.io/kakeibo/?v=$(Get-Random)" -UseBasicParsing).Content; ($c -notmatch "消した文字列") -and ($c -match "既存の固有文字列")
   ```
5. **5分待っても旧版のままなら GitHub Pages のビルド詰まり**（このリポジトリで頻発）。再ビルドを蹴る:
   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/kakeibo/pages/builds -X POST
   # 状態確認（building→builtになるのを待つ）:
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/kakeibo/pages/builds/latest --jq .status
   ```
   （ghはこのPCで認証済み。認証エラーなら `gh auth status` を確認してユーザーに報告）
6. ユーザーへの完了報告に必ず含めること: **「iPhoneでアプリを完全終了（アプリスイッチャーから上スワイプ）→開き直しで反映。1回で変わらなければもう一度終了→起動」**

## 実装メモ

- 画面はタブ5つ: 入力 / カレンダー / レポート / 予算 / 設定（2026-07-06にMoneyNote風へ改編。一覧タブは廃止しカレンダー下部に統合）
- 入力: フォーム型（支出/収入切替・日付・メモ・金額）。金額ボックスをタップするとテンキーが出る。テンキーは `#padhost`（mainとnavの間のflex要素）に描画し、**fixedは使わない**（iOSでずれるため。過去に実証）。カテゴリはアイコン付きタイル。下部の大ボタンで確定。編集は明細の行タップ（editIdモード）
- カテゴリ: name/kind/color/icon（絵文字）/noInput。設定タブでアイコン・色（input type=color）変更可。カテゴリ管理は「入力タブで表示/非表示」の2セクション構成で、☰ハンドルのポインタドラッグ（dragCat→reorderCats）で並び替え＋セクション跨ぎで表示切替（noInput=trueは入力タブのタイルに出ないが、固定費・予算・レポートでは使える。既存記録の編集中はタイルを出す）。「隠す」機能は廃止済み
- 固定費: startDate〜endDate（endDate=null で無期限）。毎月startDateと同じ日（月末クランプ）に、当日以降アプリを開いた時に記帳。開始日が過去なら過去分も遡って記帳。旧形式（day/endYm）はnormalize()で自動移行。設定タブに「来月の固定費/固定収入」合計を表示（recurringForYm）
- カレンダー: 月グリッド＋下部にその月の明細（日付降順・日ごとにグループ、アンカーid="day-YYYY-MM-DD"）。日タップで該当セクションへscrollIntoView
- レポート: 月間/年間切替→サマリカード（支出/収入/収支）→大ドーナツ（大スライスは白文字で直接ラベル）→ランキング。年間は月別内訳表つき
- 予算: 月送り＋予算合計＋カテゴリ別（残り・バー・予算/支出・%）。編集は予算タブの「予算を設定」→月別編集ビュー。データは `budgets = {'YYYY-MM': {total, cats}}` の月別スナップショットで、保存した月から先の月へ引き継ぎ（budgetForYm。最初の設定より前の月にも最初の設定を適用）。totalが0ならカテゴリ予算合計を予算合計として表示。旧形式（catId→金額の単一マップ）はnormalize()で移行
- 描画は `render()` が state.tab に応じて main.innerHTML を丸ごと書き換える方式。イベントはHTML属性のonclick
- カテゴリ色は `COLOR_POOL`（先頭8色は検証済みパレット）。レポートのドーナツは上位7＋「その他まとめ」に折りたたむ（9スライス以上にしない）。金額表示は `yen()`（¥+3桁区切り）
- クラウド自動バックアップ: 起動時＋前面復帰時に1日1回、非公開リポ `prkxfzmfx-pixel/app-backups` の `kakeibo.json` へGitHub API直接PUT（`cloudBackup()`）。トークン（Fine-grained PAT）はlocalStorage `kakeibo.cloudToken` にのみ保存。**トークンをコードやリポジトリに書かない**
