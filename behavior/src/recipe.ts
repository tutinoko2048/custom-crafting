// レシピの照合。docs/07-recipe.md
// ゲームの外（vitest）でも動かせるよう、@minecraft/server は型だけを参照する
import type { ItemStack } from '@minecraft/server';

/** 照合モード。後ろほど厳しい */
export const MATCH_MODES = ['id', 'name', 'lore', 'exact'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const isMatchMode = (value: unknown): value is MatchMode =>
  (MATCH_MODES as readonly unknown[]).includes(value);

/** 空の行・列を取り除いた配置 */
export interface Shape<T> {
  width: number;
  height: number;
  cells: (T | undefined)[];
}

/**
 * グリッドから、アイテムが置かれた範囲だけを切り出す。
 * 固定形状のレシピは、これ同士を比べることで上下左右の平行移動を許す
 */
export function trimGrid<T>(grid: readonly (T | undefined)[], size: number): Shape<T> | undefined {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y * size + x] === undefined) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return undefined;

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cells: (T | undefined)[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cells.push(grid[(minY + y) * size + minX + x]);
  }
  return { width, height, cells };
}

export function shapeMatches<A, B>(
  recipe: Shape<A>,
  input: Shape<B>,
  matches: (recipe: A, input: B) => boolean,
): boolean {
  if (recipe.width !== input.width || recipe.height !== input.height) return false;
  return recipe.cells.every((cell, i) => {
    const other = input.cells[i];
    if (cell === undefined || other === undefined) return cell === undefined && other === undefined;
    return matches(cell, other);
  });
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

const enchantments = (item: ItemStack): string[] =>
  (item.getComponent('minecraft:enchantable')?.getEnchantments() ?? [])
    .map((enchantment) => `${enchantment.type.id}:${enchantment.level}`)
    .sort();

const dynamicProperties = (item: ItemStack): string[] =>
  item
    .getDynamicPropertyIds()
    .sort()
    .map((id) => `${id}=${JSON.stringify(item.getDynamicProperty(id))}`);

/**
 * 完全一致。重ねられるアイテムは `isStackableWith` に任せる。
 * 剣や防具など重ねられないアイテムでは常に false になるので、自前で比べる
 */
function exactlyMatches(a: ItemStack, b: ItemStack): boolean {
  if (a.typeId !== b.typeId) return false;
  if (a.isStackable) return a.isStackableWith(b);
  return (
    a.nameTag === b.nameTag &&
    sameList(a.getLore(), b.getLore()) &&
    sameList(enchantments(a), enchantments(b)) &&
    a.getComponent('minecraft:durability')?.damage ===
      b.getComponent('minecraft:durability')?.damage &&
    sameList(dynamicProperties(a), dynamicProperties(b))
  );
}

export function itemMatches(recipe: ItemStack, input: ItemStack, mode: MatchMode): boolean {
  if (recipe.typeId !== input.typeId) return false;
  switch (mode) {
    case 'id':
      return true;
    case 'name':
      return recipe.nameTag === input.nameTag;
    case 'lore':
      return recipe.nameTag === input.nameTag && sameList(recipe.getLore(), input.getLore());
    case 'exact':
      return exactlyMatches(recipe, input);
  }
}

export interface Recipe {
  id: string;
  name: string;
  match: MatchMode;
  /** 3×3 の材料（左上から行ごと）。各マス1個ずつ消費する */
  grid: (ItemStack | undefined)[];
  result: ItemStack;
}

/**
 * グリッドに当てはまるレシピを探す。
 * 複数当てはまるときは照合が厳しい方を優先する（名前付きの鍵のレシピが、普通のレシピに食われないように）
 */
export function findRecipe(
  recipes: readonly Recipe[],
  grid: readonly (ItemStack | undefined)[],
  size: number,
): Recipe | undefined {
  const input = trimGrid(grid, size);
  if (!input) return undefined;

  let best: Recipe | undefined;
  for (const recipe of recipes) {
    const shape = trimGrid(recipe.grid, size);
    if (!shape) continue;
    if (!shapeMatches(shape, input, (a, b) => itemMatches(a, b, recipe.match))) continue;
    if (!best || MATCH_MODES.indexOf(recipe.match) > MATCH_MODES.indexOf(best.match)) {
      best = recipe;
    }
  }
  return best;
}
