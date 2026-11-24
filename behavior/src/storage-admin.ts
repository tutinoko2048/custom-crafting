// 管理画面：ストレージの管理。docs/08-data-storage.md
//   使用状況の表示、使われていないデータの掃除、作業台の中身の退避の確認
import { type Player, world } from '@minecraft/server';
import { MessageFormData, ModalFormData } from '@minecraft/server-ui';
import { ask, type Entry, ICON, lines, menu, type Screen, text, twoLines } from './forms';
import { ContainerScreen } from './screen';
import { cleanUpStorage, deleteStash, stashStructure, storageReport } from './store';
import { tr } from './util';

/** ストレージの管理。`back` は管理画面のトップ */
export function storageMenu(player: Player, back: Screen): Promise<void> {
  const report = storageReport();
  const self: Screen = () => storageMenu(player, back);
  const count = (value: number) => String(value);

  return menu(
    player,
    tr('craft.admin.storage'),
    [
      {
        button: twoLines(
          tr('craft.admin.storage.cleanup'),
          tr(
            'craft.admin.storage.cleanup.summary',
            count(report.orphans.length),
            count(report.broken.length),
          ),
        ),
        icon: ICON.cleanup,
        next: () => cleanUp(player, self),
      },
      {
        button: twoLines(
          tr('craft.admin.storage.stashes'),
          tr('craft.admin.storage.count', count(report.stashes.length)),
        ),
        icon: ICON.stash,
        next: () => stashList(player, self),
      },
      'divider',
      { button: tr('craft.admin.back'), icon: ICON.back, next: back },
    ],
    lines(
      tr('craft.admin.storage.usage.stations', count(report.stations)),
      tr('craft.admin.storage.usage.recipes', count(report.recipes), count(report.broken.length)),
      tr(
        'craft.admin.storage.usage.structures',
        count(report.recipeStructures),
        count(report.orphans.length),
      ),
      tr('craft.admin.storage.usage.stashes', count(report.stashes.length)),
      tr('craft.admin.storage.usage.bytes', count(report.propertyBytes)),
    ),
  );
}

/** 使われていないデータの掃除。消すものをトグルで選ぶ */
async function cleanUp(player: Player, back: Screen): Promise<void> {
  const report = storageReport();
  const form = new ModalFormData()
    .title(tr('craft.admin.storage.cleanup'))
    .toggle(tr('craft.admin.storage.cleanup.orphans', String(report.orphans.length)), {
      defaultValue: report.orphans.length > 0,
      tooltip: tr('craft.admin.storage.cleanup.orphans.tooltip'),
    })
    .toggle(tr('craft.admin.storage.cleanup.broken', String(report.broken.length)), {
      // 一時的に読めなかっただけのこともあるので、既定では消さない
      defaultValue: false,
      tooltip: tr('craft.admin.storage.cleanup.broken.tooltip'),
    })
    .submitButton(tr('craft.admin.storage.cleanup.run'));

  const values = (await ask(player, form))?.formValues;
  if (values) {
    const done = cleanUpStorage({ orphans: values[0] === true, broken: values[1] === true });
    player.sendMessage(
      tr('craft.admin.storage.cleanup.done', String(done.structures), String(done.recipes)),
    );
  }
  return back();
}

/** 退避の一覧。オンラインのプレイヤーの分は名前で出す */
function stashList(player: Player, back: Screen): Promise<void> {
  const self: Screen = () => stashList(player, back);
  const owners = new Map(
    world.getAllPlayers().map((online) => [stashStructure(online.id), online]),
  );

  const entries: Entry[] = storageReport().stashes.map((structureId) => {
    const owner = owners.get(structureId);
    const name = owner?.name ?? structureId;
    // 作業台を開いている間は、中身を保存し続けている（使用中）
    const status = !owner
      ? tr('craft.admin.storage.stash.offline')
      : ContainerScreen.isOpen(owner)
        ? tr('craft.admin.storage.stash.in_use')
        : tr('craft.admin.storage.stash.online');
    return {
      button: twoLines(name, status),
      icon: ICON.player,
      next: () => stashDetail(player, structureId, name, owner, self),
    };
  });
  if (entries.length === 0) entries.push({ label: tr('craft.admin.storage.stashes.empty') });
  entries.push('divider', { button: tr('craft.admin.back'), icon: ICON.back, next: back });

  return menu(
    player,
    tr('craft.admin.storage.stashes'),
    entries,
    tr('craft.admin.storage.stashes.body'),
  );
}

async function stashDetail(
  player: Player,
  structureId: string,
  name: string,
  owner: Player | undefined,
  back: Screen,
): Promise<void> {
  if (owner?.isValid && ContainerScreen.isOpen(owner)) {
    player.sendMessage(tr('craft.admin.storage.stash.in_use.message'));
    return back();
  }
  const form = new MessageFormData()
    .title(tr('craft.admin.storage.stash.delete'))
    .body(tr('craft.admin.storage.stash.delete.confirm', name))
    .button1(text('§c', tr('craft.admin.storage.stash.delete')))
    .button2(tr('craft.admin.cancel'));
  const response = await ask(player, form);
  if (response?.selection === 0) deleteStash(structureId);
  return back();
}
