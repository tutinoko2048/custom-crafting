// クラフト画面。docs/04-crafting-screen.md
// 完成品スロットには本物を置き、量が減ったことをクラフト確定とみなす
import {
  type Container,
  type ItemStack,
  type Player,
  PlayerPermissionLevel,
} from '@minecraft/server';
import { CRAFTING_LAYOUT, GRID_SIZE, GRID_SLOTS, RESULT_SLOT } from './layout';
import { findRecipe, itemMatches, type Recipe } from './recipe';
import { ContainerScreen } from './screen';
import { ensureLoaded, getRecipes, getStation } from './store';
import { tr } from './util';

export const stationTitle = (key: string, name: string): string => name || `craft.station.${key}`;

const readGrid = (container: Container): (ItemStack | undefined)[] =>
  GRID_SLOTS.map((slot) => container.getItem(slot));

/** 材料を1回分消費する */
function consume(container: Container): void {
  for (const slot of GRID_SLOTS) {
    const item = container.getItem(slot);
    if (!item) continue;
    if (item.amount > 1) {
      item.amount--;
      container.setItem(slot, item);
    } else {
      container.setItem(slot, undefined);
    }
  }
}

/**
 * 材料を消費できなかったクラフトの完成品を、カーソル・インベントリ・地面から回収する。
 * 完成品を取るのと同じ tick に材料を抜かれた場合の複製対策
 */
function reclaim(player: Player, item: ItemStack, amount: number): void {
  const cursor = player.getComponent('minecraft:cursor_inventory');
  if (cursor?.item && itemMatches(item, cursor.item, 'exact')) {
    cursor.clear();
    return;
  }

  let rest = amount;
  const inventory = player.getComponent('minecraft:inventory')?.container;
  for (let slot = (inventory?.size ?? 0) - 1; inventory && slot >= 0 && rest > 0; slot--) {
    const held = inventory.getItem(slot);
    if (!held || !itemMatches(item, held, 'exact')) continue;
    if (held.amount > rest) {
      held.amount -= rest;
      inventory.setItem(slot, held);
      rest = 0;
    } else {
      rest -= held.amount;
      inventory.setItem(slot, undefined);
    }
  }
  if (rest <= 0) return;

  const dropped = player.dimension.getEntities({
    type: 'minecraft:item',
    location: player.location,
    maxDistance: 8,
  });
  for (const entity of dropped) {
    const stack = entity.getComponent('minecraft:item')?.itemStack;
    if (!stack || !itemMatches(item, stack, 'exact')) continue;
    entity.remove();
    rest -= stack.amount;
    if (rest <= 0) return;
  }
}

export async function openStation(player: Player, key: string): Promise<void> {
  await ensureLoaded(player);
  if (!player.isValid || ContainerScreen.isOpen(player)) return;

  const recipes = getRecipes(key);
  if (recipes.length === 0) {
    const isAdmin = player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
    player.sendMessage(tr(isAdmin ? 'craft.msg.unconfigured.admin' : 'craft.msg.unconfigured'));
    return;
  }

  /** 完成品スロットに置いてある本物と、その元になったレシピ */
  let shown: { recipe: Recipe; item: ItemStack } | undefined;

  ContainerScreen.open(player, {
    title: stationTitle(key, getStation(key).name),
    layout: CRAFTING_LAYOUT,

    onChange(screen, touched) {
      const { container } = screen;

      if (touched.has(RESULT_SLOT)) {
        const now = container.getItem(RESULT_SLOT);
        if (!shown) {
          // 空の完成品スロットに置かれたアイテムは返す
          if (now) screen.give(now);
        } else {
          const expected = shown.item;
          const same = now?.isStackable === true && now.isStackableWith(expected);
          if (same && now.amount >= expected.amount) {
            // 重ねられた分を返す
            if (now.amount > expected.amount) {
              const extra = now.clone();
              extra.amount = now.amount - expected.amount;
              screen.give(extra);
            }
          } else {
            // 量が減った（別のアイテムと入れ替えられた場合も含む）＝1回分のクラフト
            const taken = same ? expected.amount - now.amount : expected.amount;
            if (findRecipe([shown.recipe], readGrid(container), GRID_SIZE)) {
              consume(container);
              // 一部だけ取られたときの残り、入れ替えで置かれたアイテムはプレイヤーへ
              if (now) screen.give(now);
            } else {
              if (now && !same) screen.give(now);
              if (screen.player.isValid) reclaim(screen.player, expected, taken);
            }
          }
        }
      }

      // 再判定して、完成品スロットに本物を置く（一致しなければ空にする）
      const recipe = findRecipe(recipes, readGrid(container), GRID_SIZE);
      shown = recipe ? { recipe, item: recipe.result.clone() } : undefined;
      container.setItem(RESULT_SLOT, shown?.item);
    },

    onClose(screen) {
      // グリッドに残ったアイテムを返す。完成品スロットの中身は未クラフトなので返さない
      for (const item of readGrid(screen.container)) {
        if (item) screen.give(item);
      }
    },
  });
}
