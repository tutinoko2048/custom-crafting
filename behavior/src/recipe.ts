// レシピの照合。docs/07-recipe.md
// ゲームの外（vitest）でも動かせるよう、@minecraft/server は型だけを参照する
import type { ItemStack } from '@minecraft/server';

/** 照合モード。後ろほど厳しい */
export const MATCH_MODES = ['id', 'name', 'lore', 'exact'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const isMatchMode = (value: unknown): value is MatchMode =>
  (MATCH_MODES as readonly unknown[]).includes(value);

/** 形状。固定＝配置どおり（平行移動は許す）、不定＝置き場所を問わず材料の数と種類だけを見る */
export const RECIPE_SHAPES = ['shaped', 'shapeless'] as const;
export type RecipeShape = (typeof RECIPE_SHAPES)[number];

export const isRecipeShape = (value: unknown): value is RecipeShape =>
  (RECIPE_SHAPES as readonly unknown[]).includes(value);

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

/**
 * 不定形の照合。レシピの材料それぞれに、置かれたアイテムを重複なく1つずつ割り当てられるかを調べる。
 * 照合モードによっては1つのアイテムが複数の材料に当てはまるので、割り当てを順に試す（最大 9 個）
 */
export function bagMatches<A, B>(
  recipe: readonly A[],
  input: readonly B[],
  matches: (recipe: A, input: B) => boolean,
): boolean {
  if (recipe.length !== input.length) return false;
  const used = input.map(() => false);
  const assign = (i: number): boolean => {
    if (i === recipe.length) return true;
    for (let j = 0; j < input.length; j++) {
      if (used[j] || !matches(recipe[i]!, input[j]!)) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

const present = <T>(cells: readonly (T | undefined)[]): T[] =>
  cells.filter((cell): cell is T => cell !== undefined);

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

/** レシピのうち、ワールドのダイナミックプロパティに JSON で保存する部分（アイテムを含まない） */
export interface RecipeMeta {
  id: string;
  name: string;
  match: MatchMode;
  shape: RecipeShape;
}

export const newRecipeMeta = (id: string, name: string): RecipeMeta => ({
  id,
  name,
  match: 'exact',
  shape: 'shaped',
});

/** 保存された JSON を読む。欠けている項目は既定値で埋める（古いデータもそのまま読める） */
export function parseRecipeMeta(raw: unknown): RecipeMeta | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const data = raw as Record<string, unknown>;
  if (typeof data.id !== 'string') return undefined;
  const meta = newRecipeMeta(data.id, typeof data.name === 'string' ? data.name : data.id);
  if (isMatchMode(data.match)) meta.match = data.match;
  if (isRecipeShape(data.shape)) meta.shape = data.shape;
  return meta;
}

export interface Recipe extends RecipeMeta {
  /** 3×3 の材料（左上から行ごと）。各マス1個ずつ消費する */
  grid: (ItemStack | undefined)[];
  result: ItemStack;
}

/** 優先度。照合が厳しい方、同じなら固定形状の方を優先する */
const priority = (recipe: Recipe): number =>
  MATCH_MODES.indexOf(recipe.match) * 2 + (recipe.shape === 'shaped' ? 1 : 0);

/**
 * グリッドに当てはまるレシピを探す。
 * 複数当てはまるときは照合が厳しい方を優先する（名前付きの鍵のレシピが、普通のレシピに食われないように）。
 * 照合の厳しさが同じなら、配置まで指定している固定形状の方を優先する
 */
export function findRecipe(
  recipes: readonly Recipe[],
  grid: readonly (ItemStack | undefined)[],
  size: number,
): Recipe | undefined {
  const input = trimGrid(grid, size);
  if (!input) return undefined;
  const items = present(input.cells);

  let best: Recipe | undefined;
  for (const recipe of recipes) {
    const matches = (a: ItemStack, b: ItemStack) => itemMatches(a, b, recipe.match);
    let ok: boolean;
    if (recipe.shape === 'shapeless') {
      ok = bagMatches(present(recipe.grid), items, matches);
    } else {
      const shape = trimGrid(recipe.grid, size);
      ok = shape !== undefined && shapeMatches(shape, input, matches);
    }
    if (ok && (!best || priority(recipe) > priority(best))) best = recipe;
  }
  return best;
}
