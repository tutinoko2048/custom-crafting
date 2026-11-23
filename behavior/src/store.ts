// データ保存。docs/08-data-storage.md
// - 色ごとの設定とレシピのメタ情報：ワールドのダイナミックプロパティ（JSON）
// - アイテム：保管用エンティティのインベントリに入れてストラクチャーに保存（NBT ごと残すため）
import {
  type Dimension,
  type Entity,
  type ItemStack,
  type Player,
  StructureSaveMode,
  system,
  type Vector3,
  world,
} from '@minecraft/server';
import { NAMESPACE, STORE_ENTITY } from './constants';
import { GRID_SIZE } from './layout';
import { isMatchMode, type MatchMode, type Recipe } from './recipe';
import { giveOrDrop } from './util';

export interface RecipeMeta {
  id: string;
  name: string;
  match: MatchMode;
}

export interface StationConfig {
  /** コンテナのタイトル。空なら既定の名前（色名）を使う */
  name: string;
  recipes: RecipeMeta[];
}

const GRID_CELLS = GRID_SIZE * GRID_SIZE;
/** 保管用エンティティのスロット：0〜8 が材料、9 が完成品 */
const RESULT_INDEX = GRID_CELLS;

const stationProperty = (key: string) => `${NAMESPACE}:station.${key}`;
const recipeStructure = (id: string) => `${NAMESPACE}:r_${id}`;
// プレイヤー ID は負の数になることがあり、`-` は識別子に使えない
const stashStructure = (playerId: string) =>
  `${NAMESPACE}:p_${playerId.replace(/[^0-9a-z]/gi, 'n')}`;

// --- 色ごとの設定 ---

export function getStation(key: string): StationConfig {
  const raw = world.getDynamicProperty(stationProperty(key));
  if (typeof raw !== 'string') return { name: '', recipes: [] };
  try {
    const data = JSON.parse(raw) as { name?: unknown; recipes?: unknown };
    const recipes = (Array.isArray(data.recipes) ? data.recipes : []) as Partial<RecipeMeta>[];
    return {
      name: typeof data.name === 'string' ? data.name : '',
      recipes: recipes.flatMap((recipe) =>
        typeof recipe?.id === 'string'
          ? [
              {
                id: recipe.id,
                name: typeof recipe.name === 'string' ? recipe.name : recipe.id,
                match: isMatchMode(recipe.match) ? recipe.match : 'exact',
              },
            ]
          : [],
      ),
    };
  } catch {
    console.warn(`[custom-crafting] broken station data: ${key}`);
    return { name: '', recipes: [] };
  }
}

export function setStation(key: string, config: StationConfig): void {
  world.setDynamicProperty(stationProperty(key), JSON.stringify(config));
}

// --- 保管用エンティティ ---

/**
 * 保管用エンティティを置く場所。
 * プレイヤーの真上（読み込み済みのチャンク）で、ほかのエンティティが紛れ込まない高さの上限近くを使う
 */
function anchorOf(player: Player): { dimension: Dimension; block: Vector3; center: Vector3 } {
  const dimension = player.dimension;
  const block = {
    x: Math.floor(player.location.x),
    y: dimension.heightRange.max - 2,
    z: Math.floor(player.location.z),
  };
  return { dimension, block, center: { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 } };
}

const storesAt = (dimension: Dimension, center: Vector3): Entity[] =>
  dimension.getEntities({ type: STORE_ENTITY, location: center, maxDistance: 2 });

function writeStructure(
  structureId: string,
  player: Player,
  items: readonly (ItemStack | undefined)[],
): void {
  const { dimension, block, center } = anchorOf(player);
  const entity = dimension.spawnEntity<string>(STORE_ENTITY, center);
  try {
    // 読み込むとき、どのストラクチャーのエンティティかを名前で見分ける
    entity.nameTag = structureId;
    const container = entity.getComponent('minecraft:inventory')?.container;
    if (!container) throw new Error(`${STORE_ENTITY} has no inventory`);
    items.forEach((item, slot) => container.setItem(slot, item));

    world.structureManager.delete(structureId);
    world.structureManager.createFromWorld(structureId, dimension, block, block, {
      includeBlocks: false,
      includeEntities: true,
      saveMode: StructureSaveMode.World,
    });
  } finally {
    // kill にすると中身をドロップするので remove で消す
    entity.remove();
  }
}

/**
 * 配置されたエンティティから読み取った中身（ストラクチャー ID ごと）。
 * 同じ場所で複数の読み込みが重なっても互いのエンティティを取りこぼさないよう、いったんここに集める
 */
const arrived = new Map<string, (ItemStack | undefined)[]>();

function collect(dimension: Dimension, center: Vector3): void {
  for (const entity of storesAt(dimension, center)) {
    const container = entity.getComponent('minecraft:inventory')?.container;
    if (container) {
      arrived.set(
        entity.nameTag,
        Array.from({ length: container.size }, (_, slot) => container.getItem(slot)),
      );
    }
    entity.remove();
  }
}

/**
 * ストラクチャーを配置し、保管用エンティティの中身を読み取ってから消す。
 * 配置したエンティティが同じ tick では取得できない場合に備えて、数 tick 待ちながら探す
 */
async function readStructures(
  player: Player,
  structureIds: readonly string[],
): Promise<Map<string, (ItemStack | undefined)[]>> {
  const found = new Map<string, (ItemStack | undefined)[]>();
  const wanted = structureIds.filter((id) => world.structureManager.get(id) !== undefined);
  if (wanted.length === 0) return found;

  const { dimension, block, center } = anchorOf(player);
  for (const id of wanted) {
    world.structureManager.place(id, dimension, block, {
      includeBlocks: false,
      includeEntities: true,
    });
  }

  for (let attempt = 0; attempt < 20 && found.size < wanted.length; attempt++) {
    if (attempt > 0) await system.waitTicks(1);
    collect(dimension, center);
    for (const id of wanted) {
      const items = arrived.get(id);
      if (!items) continue;
      found.set(id, items);
      arrived.delete(id);
    }
  }
  return found;
}

// --- レシピのアイテム ---

interface RecipeItems {
  grid: (ItemStack | undefined)[];
  result: ItemStack;
}

/** 読み込んだアイテムのキャッシュ。読み込み後はこれだけを使う */
const cache = new Map<string, RecipeItems>();
let loading: Promise<void> | undefined;

function allRecipeIds(): string[] {
  const prefix = stationProperty('');
  return world
    .getDynamicPropertyIds()
    .filter((id) => id.startsWith(prefix))
    .flatMap((id) => getStation(id.slice(prefix.length)).recipes.map((recipe) => recipe.id));
}

async function load(player: Player): Promise<void> {
  const missing = allRecipeIds().filter((id) => !cache.has(id));
  const read = await readStructures(player, missing.map(recipeStructure));
  for (const id of missing) {
    const items = read.get(recipeStructure(id));
    const result = items?.[RESULT_INDEX];
    if (!items || !result) {
      console.warn(`[custom-crafting] recipe items not found: ${id}`);
      continue;
    }
    cache.set(id, { grid: items.slice(0, GRID_CELLS), result });
  }
}

/**
 * レシピのアイテムをワールドから読み込む（ワールド起動後に1回）。
 * ストラクチャーを配置できる読み込み済みのチャンクが必要なので、プレイヤーを基準にする
 */
export function ensureLoaded(player: Player): Promise<void> {
  loading ??= load(player).catch((error: unknown) => {
    // 失敗したら次の呼び出しでやり直す
    loading = undefined;
    console.warn(`[custom-crafting] failed to load recipes: ${String(error)}`);
  });
  return loading;
}

/** 材料は1個ずつ消費するので、個数は 1 にそろえて保存する */
export function saveRecipeItems(
  player: Player,
  id: string,
  grid: readonly (ItemStack | undefined)[],
  result: ItemStack,
): void {
  const items: RecipeItems = {
    grid: grid.map((item) => {
      const copy = item?.clone();
      if (copy) copy.amount = 1;
      return copy;
    }),
    result: result.clone(),
  };
  writeStructure(recipeStructure(id), player, [...items.grid, items.result]);
  cache.set(id, items);
}

export function deleteRecipeItems(id: string): void {
  cache.delete(id);
  world.structureManager.delete(recipeStructure(id));
}

export const getRecipeItems = (id: string): RecipeItems | undefined => cache.get(id);

/** アイテムまで読み込めているレシピ */
export function getRecipes(key: string): Recipe[] {
  return getStation(key).recipes.flatMap((meta) => {
    const items = cache.get(meta.id);
    return items ? [{ ...meta, ...items }] : [];
  });
}

export const newRecipeId = (): string =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')}`;

// --- 退出時の退避 ---

/** 退出したプレイヤーに返せなかったアイテム。次に参加したときに返す */
const stashes = new Map<string, ItemStack[]>();

export function stashItems(playerId: string, items: readonly ItemStack[]): void {
  if (items.length === 0) return;
  const all = [...(stashes.get(playerId) ?? []), ...items];
  stashes.set(playerId, all);

  // ワールドを閉じても残るよう、ほかのプレイヤーがいればストラクチャーにも保存する
  const anchor = world.getAllPlayers().find((player) => player.id !== playerId);
  if (!anchor) return;
  try {
    writeStructure(stashStructure(playerId), anchor, all);
  } catch (error) {
    console.warn(`[custom-crafting] failed to save stash: ${String(error)}`);
  }
}

/** 退避していたアイテムを返す。返した数を返す */
export async function restoreStash(player: Player): Promise<number> {
  const structureId = stashStructure(player.id);
  let items = stashes.get(player.id);
  stashes.delete(player.id);
  if (!items && world.structureManager.get(structureId)) {
    const read = await readStructures(player, [structureId]);
    items = (read.get(structureId) ?? []).filter((item) => item !== undefined);
  }
  world.structureManager.delete(structureId);
  if (!items || !player.isValid) return 0;
  for (const item of items) giveOrDrop(player, item);
  return items.length;
}
