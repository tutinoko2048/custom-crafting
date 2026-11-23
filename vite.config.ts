import { defineConfig } from 'vite-plus';

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
