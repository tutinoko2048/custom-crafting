# スラッシュコマンド

コマンドは2つだけにする。管理はすべて `/craft:admin` から開く管理画面で行う。

| コマンド                       | 権限          | 用途                                                                                 |
| ------------------------------ | ------------- | ------------------------------------------------------------------------------------ |
| `/craft:open <color> [target]` | GameDirectors | 指定した色の作業台を開く。コマンドブロックや NPC から `@p` / `@initiator` 付きで使う |
| `/craft:admin [color]`         | GameDirectors | 管理画面を開く。色を指定するとその色のレシピ一覧から始める                           |

## 実装上の注意

- 登録は `system.beforeEvents.startup` の中で `customCommandRegistry.registerCommand` を使う。コマンド名には名前空間が必須
- 16色は固定なので、`registerEnum` で enum 登録して補完を効かせる
- callback は制限付き実行モードで動く。`VirtualContainer.open` やフォーム表示は `system.run` で次の tick に回す
- `cheatsRequired` は既定で true。チート OFF の配布マップでもコマンドブロックから動かしたいので、`/craft:open` は false にするかどうかを検証して決める
- `/craft:admin` に `Admin` を使ってはいけない。BDS では `Admin` 以上を持つのはサーバーコンソールだけで、OP のプレイヤーも `GameDirectors` 止まりのため、誰も実行できなくなる。管理画面の判定（`PlayerPermissionLevel.Operator` 以上）とも揃う
- プレイヤーは通常、作業台ブロックを右クリックして開く。コマンドは「ブロックを置かずに開かせたい」場合（NPC・ボタン・イベント）のために用意する
