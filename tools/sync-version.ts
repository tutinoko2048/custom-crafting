// root package.json の version を各パックの manifest.json に反映する。
// リリース時に CI（release.yml）から実行する。
import { readFileSync, writeFileSync } from 'node:fs';

interface Manifest {
  header: { name: string; uuid: string; version: string };
  dependencies?: { uuid?: string; module_name?: string; version: string }[];
}

const root = new URL('../', import.meta.url);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), 'utf8')) as T;
const writeJson = (path: string, data: unknown) =>
  writeFileSync(new URL(path, root), `${JSON.stringify(data, null, 2)}\n`);

const { version } = readJson<{ version: string }>('package.json');
const packs = ['behavior/manifest.json', 'resource/manifest.json'];
const manifests = packs.map((path) => readJson<Manifest>(path));
const ownUuids = new Set(manifests.map((m) => m.header.uuid));

for (const [i, manifest] of manifests.entries()) {
  manifest.header.version = version;
  // リポジトリでは素の名前で管理し、末尾に ` vX.Y.Z` を付ける
  manifest.header.name = `${manifest.header.name} v${version}`;
  // BP → RP のように同じアドオン内のパックへの依存もバージョンを合わせる
  for (const dep of manifest.dependencies ?? []) {
    if (dep.uuid && ownUuids.has(dep.uuid)) dep.version = version;
  }
  writeJson(packs[i]!, manifest);
  console.log(`${packs[i]}: ${manifest.header.name}`);
}
