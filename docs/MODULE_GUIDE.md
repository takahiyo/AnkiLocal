# モジュール化・依存注入ガイド

## モジュール化の目的
単一責任の原則に従い、特定の機能だけを持つモジュールを作る。

## 依存注入パターン: `init(config)`
外部モジュールへの依存は、直接 `import` してグローバルに使用するのではなく、`init()` 関数を通じて注入（Dependency Injection）することを基本とする。これによりファイルの独立性が高まり、順序依存やテストの難しさを解消する。

```javascript
// my-module.js
let _storage = null;

export function init(config) {
    _storage = config.storage;
}

export function doWork() {
    if(!_storage) throw new Error("Not initialized");
    _storage.save("data");
}
```

## 循環依存の禁止
AがBを呼び、BがAを呼ぶような状態を避ける。
共通処理を抽出するか、コールバック関数を利用すること。
