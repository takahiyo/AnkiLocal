# Cloudflare Pages プレビューサイト デバッグ記録

## 1. 発生していた問題
Cloudflare Pagesでテスト運用を予定しているが、プレビューサイトにアクセスできない（404エラーなどになる）。

## 2. 原因調査と判明した事象
- リモートの `dev` ブランチをプルしてコードを確認。
- `worker/index.ts`（Honoアプリケーション）が `_worker.js` としてビルドされ、Cloudflare PagesのFunctionsとして全てのリクエストを処理する構成になっていた。
- しかし、Honoアプリ内で `/api/*` のルート定義しかなく、`index.html` やCSS、JSなどの静的アセットへのリクエストが来た際にCloudflare Pagesの静的アセット配信へフォールスルー（委譲）する処理が記述されていなかった。

## 3. 行った修正工程
1. `worker/index.ts` の `Bindings` に `ASSETS: Fetcher` を追加。
2. Honoのインスタンスに `app.notFound` ハンドラを追加し、未定義ルート（静的アセットへのアクセス）を `c.env.ASSETS.fetch(c.req.raw)` でフォールスルーするように修正。
3. `tsconfig.json` の `include` パスが誤っていたため（`functions` -> `worker`）修正。
4. `npm install` および `npm run build` を実行して `frontend/_worker.js` を再生成。
5. 以上の変更を `fix: route fallback to static assets in worker` としてコミットし、リモートの `dev` ブランチへプッシュ完了。

## 4. ユーザーテストと結果記録
*以下はCloudflare側の環境構築後、ユーザーにて結果を記入してください。*

- [ ] ローカル環境 (`npm run dev`) での静的アセット表示とAPI通信のテスト
  - 結果: 
- [ ] Cloudflare Pages (PreviewまたはProduction) でのサイト表示テスト
  - 結果: 

※テストが完了し、問題が解決したと確認できた時点で、このファイルは削除してください。
