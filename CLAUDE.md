# 家計簿アプリ（PWA）

iPhoneのホーム画面から使う家計簿アプリ（「シンプル家計簿」参考）。**修正指示を受けたら、必ず下の「修正フロー」を上から順に全部実行すること。**編集だけして終わるのは作業未完了。

- 公開URL: https://prkxfzmfx-pixel.github.io/kakeibo/
- リポジトリ: https://github.com/prkxfzmfx-pixel/kakeibo （公開。このフォルダが作業コピー）
- 姉妹アプリ: 筋トレ記録 `..\_workout_app\`。**タブ構成・レイアウト・操作感は両アプリで統一する方針**。片方のUIを変えるときは、もう片方にも同じ変更が必要か必ず検討し、ユーザーに一言確認するか両方に適用する

## 構成

| ファイル | 内容 |
|---|---|
| index.html | アプリ本体。CSS/JSすべてこの1ファイルに入っている（外部ライブラリ・CDN禁止） |
| sw.js | Service Worker（ネットワーク優先・オフラインキャッシュ） |
| test/smoke.test.js | スモークテスト（DOMスタブ + eval方式） |

## 絶対に守ること

1. **データ本体はユーザーのiPhoneのlocalStorage**（キー `kakeibo.v1`）にあり、サーバーにバックアップはない。保存データの構造（categories/entries/budgets/recurring）を変えるときは、**必ず `normalize()`（＋必要ならバージョン付き移行）に旧形式→新形式の変換を追加**し、テストにケースを足す。既存データを壊すと復元不能
2. レイアウトの根幹を壊さない: `fitViewport()`（スタンドアロン時はscreen.height採用）、body/main/navのflex構造、セーフエリア対応。**`position: fixed` や `100vh/100dvh` を新たに使わない**（iOSスタンドアロンで高さがバグる。過去に実証済み）
3. 公開リポジトリなので、個人情報・トークン・APIキーを絶対に置かない
4. 新しいファイルを追加したら `sw.js` の `ASSETS` に追記し、`CACHE` 名の数字を+1する（例: kakeibo-v2 → v3）
5. 既存仕様（固定費の自動記帳＝重複なし・31日は月末クランプ・過去月に遡らない、入力タブ離脱時の初期化、カテゴリ別予算、CSVはBOM付き）はテストが守っている。仕様を変えるならテストも同じコミットで更新する

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
5. **5分待っても旧版のままなら GitHub Pages のビルド詰まり**（このリポジトリで頻発）。再ビルドを蹴る:
   ```powershell
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/kakeibo/pages/builds -X POST
   # 状態確認（building→builtになるのを待つ）:
   & "C:\Program Files\GitHub CLI\gh.exe" api repos/prkxfzmfx-pixel/kakeibo/pages/builds/latest --jq .status
   ```
   （ghはこのPCで認証済み。認証エラーなら `gh auth status` を確認してユーザーに報告）
6. ユーザーへの完了報告に必ず含めること: **「iPhoneでアプリを完全終了（アプリスイッチャーから上スワイプ）→開き直しで反映。1回で変わらなければもう一度終了→起動」**

## 実装メモ

- 画面はタブ5つ: 入力 / カレンダー / 一覧 / レポート / 設定（この名前・順序は筋トレアプリと統一。変えない）
- 入力: 支出/収入切替→カテゴリタップ→テンキー→保存。編集は一覧・カレンダー詳細の行タップ（editIdモード）
- カレンダー: 日タップ→選択ハイライト＋下部に明細→行タップで編集、「＋この日に入力」
- 描画は `render()` が state.tab に応じて main.innerHTML を丸ごと書き換える方式。イベントはHTML属性のonclick
- カテゴリ色は `COLOR_POOL`（先頭8色は検証済みパレット）。レポートのドーナツは上位7＋「その他まとめ」に折りたたむ（9スライス以上にしない）。金額表示は `yen()`（¥+3桁区切り）
