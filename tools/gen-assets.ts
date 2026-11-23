// 16色ぶんのブロック定義・言語ファイルの色ごとの行を書き出す。
// 何を出すかは tools/assets/definitions.ts にある。
// 生成物はコミットする。定義を変えたら `pnpm gen` で作り直す。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineAssets } from './assets/definitions';

const root = new URL('../', import.meta.url);

function write(path: string, data: string): void {
  const file = fileURLToPath(new URL(path, root));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
}

// 言語ファイルは手書きの行と同居するので、このマーカーで挟んだ範囲だけを書き換える
const LANG_START = '## generated:start (tools/gen-assets.ts)';
const LANG_END = '## generated:end';

function replaceGenerated(current: string, lines: string[]): string {
  const start = current.indexOf(LANG_START);
  const end = current.indexOf(LANG_END);
  const head = start >= 0 ? current.slice(0, start) : current;
  const tail = end >= 0 ? current.slice(end + LANG_END.length) : '\n';
  return [`${head}${LANG_START}`, ...lines, `${LANG_END}${tail}`].join('\n');
}

const assets = defineAssets();

for (const [path, data] of Object.entries(assets.json)) {
  write(path, `${JSON.stringify(data, null, 2)}\n`);
}
for (const [path, lines] of Object.entries(assets.lang)) {
  write(path, replaceGenerated(readFileSync(new URL(path, root), 'utf8'), lines));
}

const count = Object.values(assets).reduce((sum, files) => sum + Object.keys(files).length, 0);
console.log(`generated ${count} files`);
