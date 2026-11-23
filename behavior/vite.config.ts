import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: 'src/main.ts',
    outDir: 'scripts',
    target: 'ES2024',
    platform: 'neutral',
    deps: {
      neverBundle: /^@minecraft\/(?!vanilla-data|math)/,
      alwaysBundle: ['**/*'],
      onlyBundle: false,
    },
    sourcemap: true,
  },
  run: {
    tasks: {
      build: {
        command: 'vp pack',
        // 出力先を入力に含めるとキャッシュが毎回無効になる
        cache: { input: [{ auto: true }, '!scripts/**'] },
      },
    },
  },
});
