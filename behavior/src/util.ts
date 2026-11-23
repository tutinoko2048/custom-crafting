import { type ItemStack, type Player, type RawMessage } from '@minecraft/server';
import { UI_PREFIX } from './constants';

/** 言語ファイル（resource/texts）のキーで翻訳するメッセージ */
export const tr = (key: string, ...args: string[]): RawMessage & { translate: string } =>
  args.length > 0 ? { translate: key, with: args } : { translate: key };

export const isUiItem = (item: ItemStack | undefined): boolean =>
  item !== undefined && item.typeId.startsWith(UI_PREFIX);

/** インベントリに入れる。入りきらない分は足元にドロップする */
export function giveOrDrop(player: Player, item: ItemStack): void {
  const container = player.getComponent('minecraft:inventory')?.container;
  const rest = container ? container.addItem(item) : item;
  if (rest) player.dimension.spawnItem(rest, player.location);
}
