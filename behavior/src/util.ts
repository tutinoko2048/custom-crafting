import { type ItemStack, type Player, type RawMessage } from '@minecraft/server';
import type { LangArgs, LangKey } from '../../resource/texts/en_US.lang';
import { UI_PREFIX } from './constants';

export type { LangKey };

/** 言語ファイル（resource/texts）のキーで翻訳するメッセージ */
export function tr<K extends LangKey>(key: K, ...args: LangArgs[K]): RawMessage {
  return args.length > 0 ? { translate: key, with: args } : { translate: key };
}

export const isUiItem = (item: ItemStack | undefined): boolean =>
  item !== undefined && item.typeId.startsWith(UI_PREFIX);

/** インベントリに入れる。入りきらない分は足元にドロップする */
export function giveOrDrop(player: Player, item: ItemStack): void {
  const container = player.getComponent('minecraft:inventory')?.container;
  const rest = container ? container.addItem(item) : item;
  if (rest) player.dimension.spawnItem(rest, player.location);
}
