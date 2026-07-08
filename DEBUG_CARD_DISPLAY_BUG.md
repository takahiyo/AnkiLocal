# カード表示バグ 修正記録

## 症状
カードを評価（Again/Hard/Good/Easy）して次カードに遷移したとき、
まれに解答面（裏面）が前面に表示されたままになる。
3～4カード目で再現することが多いが、1枚目でも発生する場合がある。
「ずれている」: カード面がコンテナを正しく満たさず、位置や見た目が崩れる。

---

## 試行履歴

### Trial 1: `inner.style.transition = 'none'` + `container.classList` リセット
- 変更: `showCard()` で `inner.style.transition = 'none'` を設定し、transition を無効化してから CSS クラスを操作
- 結果: 失敗。3～4カード目で裏面が表示される。

### Trial 2: `_animTimeoutId` でタイマー管理
- 変更: 前回の `next-card-anim` 解除タイマーを明示的にキャンセル。合わせて `inner.style.transition = 'none'` を維持。
- 結果: 改善せず。

### Trial 3: `inner.style.transform = 'none'` で inline 上書き
- 変更: inner の inline `transform` を `'none'` にセットし、CSSクラスの `rotateX(180deg)` より優先させる戦略。
- 結果: 3枚目で裏面表示。改善なし。
- 考察: 直後の `next-card-anim` キーフレーム（`rotateY`）が再び transform を設定し、`backface-visibility` との相互作用で崩れる。

### Trial 4: 3D Transform 廃止 → display show/hide
- 変更:
  - CSS: `position: absolute` + `backface-visibility` + `rotateX(180deg)` を廃止
  - CSS: `position: relative` + `display: none/block` で前面・後面を切り替え
  - CSS: キーフレームアニメーションを `rotateY` → `translateY` + `opacity` に変更
  - JS: `inner.style.transform` / `inner.style.transition` の inline 操作を全削除
- 結果: 1枚目から「ずれている」と報告。
- 原因: `position: relative` ではカード面がコンテナを満たさず、レイアウトが崩れる。
  旧実装の `position: absolute` で両面を重ねる方式に戻す必要がある。

### Trial 5 (current): absolute重ね + opacity切替（transform不使用）
- 変更:
  - CSS: 両面とも `position: absolute; top:0; left:0; width:100%; height:100%`（コンテナを満たす）
  - CSS: フリップ切替に `opacity: 0/1` + `pointer-events: none/auto` を使用（transform 不使用）
  - CSS: キーフレーム `fadeInNext` は `opacity` + `translateY` のみ
  - CSS: アニメーションには transition なし（`next-card-anim` のキーフレームのみ）
  - JS: `showCard()` / `flipCard()` では `classList.remove/add` のみ
- 期待: transform 競合ゼロ、両面がコンテナを満たす、キーフレームとフリップ表示が独立
- 結果: 未確認

---

## 設計方針（次回への教訓）

- **transform は使わない** → `opacity` + `pointer-events` で表示切替
- **両面は `position: absolute`** → コンテナを満たす
- **フリップの transition は不要** → 瞬時切替、アニメーション演出は `next-card-anim` のキーフレームに任せる
- **JS はクラス操作のみ** → inline style の出番はゼロ
