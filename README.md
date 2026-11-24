# custom-crafting

VirtualContainer ベースのカスタム作業台アドオン。仕様は [docs/](docs/README.md) を参照。

## 構成

pnpm workspace の monorepo。ツールチェーンは [Vite+](https://viteplus.dev/)（`vp`）。

| パス        | 内容                                                              |
| ----------- | ----------------------------------------------------------------- |
| `behavior/` | ビヘイビアパック（Script API / TypeScript、`vp pack` でバンドル） |
| `resource/` | リソースパック                                                    |
| `docs/`     | 仕様書                                                            |

## 環境構築

- パッケージマネージャーには [pnpm](https://pnpm.io/) を使う
- `pnpm i`
- `vp build` ではなく `pnpm build`（= `vp run -r build`）で全パッケージをビルド（`behavior/scripts/` に出力。キャッシュあり）
- `pnpm watch` で監視ビルド
- `pnpm gen` で16色ぶんのブロック定義・言語ファイルの色ごとの行を作り直す（`tools/gen-assets.ts`。生成物はコミットする）
- `vp check` で format・lint・型チェック（`vp check --fix` で自動修正）。言語ファイルのキーの型は [bedrock-lang](https://github.com/tutinoko2048/bedrock-lang) が `.lang` から作る（`vite.config.ts` で content mapper の実行を許可している）
- コミット時に pre-commit フックで `vp staged`（ステージしたファイルに `vp check --fix`）が走る
- 個別に動かすときは `vp run @custom-crafting/behavior#build` のように指定する

## 使い方（MVP）

Minecraft Preview 26.70 以降で、ワールドの「ベータ API」実験トグルを ON にして使う。

1. `/craft:admin` で管理画面を開き、色を選んで「新しいレシピを登録」を押す
2. 開いた画面の左の3×3に材料、右のスロットに完成品を実物で置いて閉じると保存される
3. その色の作業台ブロック（クリエイティブの「アイテム」タブ）を置いて右クリックするか、`/craft:open <color> [target]` で開く

## その他

- 依存のバージョンは `pnpm-workspace.yaml` の `catalog` でまとめて管理する
- mcpack に含めるファイルは各パッケージの `package.json` の `files` で定義する
- Script API の型定義には [`@bedrock-apis/env-types`](https://github.com/bedrock-apis/env-types) を使う

## CI / リリース

- push と PR で `vp check`（format・lint・型）と `vp test` を実行する（`.github/workflows/ci.yml`）
- バージョンの SSOT は root の `package.json` の `version`。manifest.json のバージョンとパック名はリリース時に `tools/sync-version.ts`で書き換える
- リリース手順：
  1. root の `package.json` の `version` を上げてコミットする
  2. `v<version>` のタグ（例：`v0.2.0`）を push する
  3. Actions がタグとバージョンの一致を確認してからビルドし、BP / RP 単体の mcpack と mcaddon を添付した**下書き**のリリースを作る。内容を確認して公開する
