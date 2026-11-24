// 16色ぶんのブロック定義・言語ファイルの色ごとの行を書き出す。
// 何を出すかは tools/assets/definitions.ts にある。
// 生成物はコミットする。定義を変えたら `pnpm gen` で作り直す。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'bedrock-lang';
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

// 型を作る content mapper と同じパーサーでキーを読む（手書きの行も含む）
const keysByLang = Object.entries(assets.lang).map(([path, lines]) => {
  const content = replaceGenerated(readFileSync(new URL(path, root), 'utf8'), lines);
  const { entries, errors } = parse(content);
  if (errors.length > 0) {
    throw new Error(`${path}: ${errors.map((e) => e.message).join(' ')}`);
  }
  write(path, content);
  return { path, keys: entries.map((entry) => entry.key) };
});

// キーの型は bedrock-lang が en_US.lang から作る（behavior/src/util.ts）。
// ほかの言語にキーの過不足があっても型では分からないので、ここで止める
const [base, ...others] = keysByLang;
for (const other of others) {
  const diff = [...new Set(base?.keys).symmetricDifference(new Set(other.keys))];
  if (diff.length > 0) {
    throw new Error(`lang keys differ between ${base?.path} and ${other.path}: ${diff.join(', ')}`);
  }
}

const count = Object.values(assets).reduce((sum, files) => sum + Object.keys(files).length, 0);
console.log(`generated ${count} files`);
