// クラフト画面。docs/04-crafting-screen.md
// 完成品スロットには本物を置き、量が減ったことをクラフト確定とみなす
import {
  type Container,
  type ItemStack,
  type Player,
  PlayerPermissionLevel,
} from '@minecraft/server';
import { type CraftingLayout, craftingLayout } from './layout';
import { findRecipe, itemMatches, type Recipe } from './recipe';
import { blockedReason, completeCraft } from './requirements';
import { ContainerScreen } from './screen';
import { ensureLoaded, getRecipes, getStation } from './store';
import { tr } from './util';

export const stationTitle = (key: string, name: string): string => name || `craft.station.${key}`;

const readGrid = (container: Container, layout: CraftingLayout): (ItemStack | undefined)[] =>
  layout.gridSlots.map((slot) => container.getItem(slot));

/** 材料を1回分消費する */
function consume(container: Container, layout: CraftingLayout): void {
  for (const slot of layout.gridSlots) {
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
  /** 材料は当てはまったが、コストや条件を満たさなかったレシピ */
  let blocked: Recipe | undefined;

  const station = getStation(key);
  const layout = craftingLayout(station.gridSize);
  const { gridSize, resultSlot } = layout;
  const grid = (container: Container) => readGrid(container, layout);

  ContainerScreen.open(player, {
    title: stationTitle(key, station.name),
    layout,
    // 完成品スロットの中身はまだクラフトしていないので、材料だけを守る
    stash: layout.gridSlots,

    onChange(screen, touched) {
      const { container } = screen;

      if (touched.has(resultSlot)) {
        const now = container.getItem(resultSlot);
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
            const crafted = shown.recipe;
            const { player } = screen;
            // 表示してから取られるまでにコストや条件が変わっていることもあるので、もう一度確かめる。
            // 同じ tick に退出したプレイヤーからはコストを取れないが、材料は消費する（複製を防ぐ方を優先）
            const allowed = !player.isValid || blockedReason(player, crafted) === undefined;
            if (allowed && findRecipe([crafted], grid(container), gridSize)) {
              consume(container, layout);
              if (player.isValid) completeCraft(player, crafted);
              // 一部だけ取られたときの残り、入れ替えで置かれたアイテムはプレイヤーへ
              if (now) screen.give(now);
            } else {
              if (now && !same) screen.give(now);
              if (screen.player.isValid) reclaim(screen.player, expected, taken);
            }
          }
        }
      }

      // 再判定して、完成品スロットに本物を置く（一致しない・条件を満たさないなら空にする）
      const recipe = findRecipe(recipes, grid(container), gridSize);
      const reason =
        recipe && screen.player.isValid ? blockedReason(screen.player, recipe) : undefined;
      // 条件を満たさない理由は、そのレシピに初めて当てはまったときに1回だけ伝える
      if (reason && recipe !== blocked) screen.player.sendMessage(reason);
      blocked = reason ? recipe : undefined;
      shown = recipe && !reason ? { recipe, item: recipe.result.clone() } : undefined;
      container.setItem(resultSlot, shown?.item);
    },

    onClose(screen) {
      // グリッドに残ったアイテムを返す。完成品スロットの中身は未クラフトなので返さない
      for (const item of grid(screen.container)) {
        if (item) screen.give(item);
      }
    },
  });
}
