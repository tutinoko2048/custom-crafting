// .agents/skills を SSOT として、各 skill を .claude/skills/<name> にリンクする（skills CLI と同じ構成）。
// `pnpm install` の prepare で実行される。手動では `pnpm link-skills`。
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = join(root, '.agents/skills');
const targets = [join(root, '.claude/skills')];

const skills = existsSync(source)
  ? readdirSync(source, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      // パッケージを外して壊れたリンクは対象にしない
      .filter((entry) => existsSync(join(source, entry.name)))
      .map((entry) => entry.name)
  : [];

for (const target of targets) {
  mkdirSync(target, { recursive: true });

  // 消えた skill へのリンクを片付ける（リンク以外のファイルは触らない）
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink() && !skills.includes(entry.name)) {
      rmSync(join(target, entry.name));
    }
  }

  for (const name of skills) {
    const link = join(target, name);
    if (existsSync(link)) continue;
    // リンク先が無い（壊れた）リンクは作り直す
    if (isLink(link)) rmSync(link);
    const dest = join(source, name);
    try {
      symlinkSync(relative(target, dest), link, 'dir');
    } catch (error) {
      // Windows で開発者モードが無効だとシンボリックリンクを作れない。
      // 権限不要の junction で代用する（junction はリンクを辿れないので実体の絶対パスを指す）
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      symlinkSync(realpathSync(dest), link, 'junction');
    }
    console.log(`linked ${relative(root, link)} -> ${relative(root, dest)}`);
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
