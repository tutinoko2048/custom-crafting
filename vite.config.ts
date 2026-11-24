import { defineConfig } from 'vite-plus';

// 型チェックで resource/texts/*.lang の content mapper（bedrock-lang）を動かす。
// oxlint は型チェックのバックエンド（tsrs）にフラグを渡せないので環境変数で許可する。
// エディタの拡張もこの設定を読むので、ここで入れておく
process.env.TSRS_LINT_RUN_EXTERNAL_CODE ??= '1';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    singleQuote: true,
    sortPackageJson: true,
    ignorePatterns: ['behavior/scripts/**', 'pnpm-lock.yaml'],
  },
  lint: {
    ignorePatterns: ['behavior/scripts/**'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    // テストを書くまでは CI を落とさない
    passWithNoTests: true,
  },
  run: {
    cache: true,
  },
});
