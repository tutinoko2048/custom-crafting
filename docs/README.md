# カスタム作業台アドオン 仕様書

ワールド製作者がアドオンを入れるだけで使える、VirtualContainer ベースのカスタム作業台。作業台は16色のブロックで区別し、レシピはゲーム内の管理画面と実物登録エディタで作る。Script API の beta（ベータ API 実験トグル）が前提。

## 目次

| #   | ファイル                                       | 内容                                                         |
| --- | ---------------------------------------------- | ------------------------------------------------------------ |
| 1   | [01-overview.md](01-overview.md)               | 概要と前提、バニラ作業台との違い                             |
| 2   | [02-station.md](02-station.md)                 | ステーション（16色の作業台）                                 |
| 3   | [03-commands.md](03-commands.md)               | スラッシュコマンド                                           |
| 4   | [04-crafting-screen.md](04-crafting-screen.md) | クラフト画面と挙動、穴埋め用アイテム、完成品スロットのルール |
| 5   | [05-item-monitoring.md](05-item-monitoring.md) | アイテム監視（持ち出し・複製対策）                           |
| 6   | [06-admin-ui.md](06-admin-ui.md)               | 管理画面とレシピエディタ、画面遷移                           |
| 7   | [07-recipe.md](07-recipe.md)                   | レシピ仕様（照合・コスト・条件・報酬）                       |
| 8   | [08-data-storage.md](08-data-storage.md)       | データ保存                                                   |
| 9   | [09-constraints.md](09-constraints.md)         | 制約・要検証事項                                             |
| 10  | [10-mvp.md](10-mvp.md)                         | MVP の範囲                                                   |
| -   | [references.md](references.md)                 | 参考資料                                                     |
