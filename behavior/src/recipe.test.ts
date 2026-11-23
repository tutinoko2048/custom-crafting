import type { ItemStack } from '@minecraft/server';
import { describe, expect, test } from 'vite-plus/test';
import { findRecipe, itemMatches, type Recipe, shapeMatches, trimGrid } from './recipe';

interface FakeOptions {
  nameTag?: string;
  lore?: string[];
  stackable?: boolean;
  damage?: number;
  enchantments?: Record<string, number>;
}

/** 照合で使う部分だけを持つ ItemStack の代用品 */
function item(typeId: string, options: FakeOptions = {}): ItemStack {
  const { nameTag, lore = [], stackable = true, damage = 0, enchantments = {} } = options;
  const key = JSON.stringify([typeId, nameTag, lore]);
  const fake = {
    typeId,
    nameTag,
    amount: 1,
    isStackable: stackable,
    key,
    isStackableWith: (other: { key: string }) => stackable && other.key === key,
    getLore: () => lore,
    getDynamicPropertyIds: () => [],
    getDynamicProperty: () => undefined,
    getComponent: (id: string) => {
      if (id === 'minecraft:durability') return { damage };
      if (id === 'minecraft:enchantable') {
        return {
          getEnchantments: () =>
            Object.entries(enchantments).map(([type, level]) => ({ type: { id: type }, level })),
        };
      }
      return undefined;
    },
  };
  return fake as unknown as ItemStack;
}

const _ = undefined;
const stick = () => item('minecraft:stick');
const plank = () => item('minecraft:planks');

const recipe = (id: string, grid: (ItemStack | undefined)[], match: Recipe['match']): Recipe => ({
  id,
  name: id,
  match,
  grid,
  result: item(`result:${id}`),
});

describe('trimGrid', () => {
  test('空のグリッドは undefined', () => {
    expect(trimGrid([_, _, _, _, _, _, _, _, _], 3)).toBeUndefined();
  });

  test('アイテムのある範囲だけを切り出す', () => {
    expect(trimGrid([_, _, _, _, 'a', 'b', _, 'c', _], 3)).toEqual({
      width: 2,
      height: 2,
      cells: ['a', 'b', 'c', _],
    });
  });
});

describe('shapeMatches', () => {
  const same = (a: string, b: string) => a === b;
  const shape = (grid: (string | undefined)[]) => trimGrid(grid, 3)!;

  test('平行移動した配置は一致する', () => {
    const a = shape(['x', _, _, 'y', _, _, _, _, _]);
    const b = shape([_, _, _, _, _, 'x', _, _, 'y']);
    expect(shapeMatches(a, b, same)).toBe(true);
  });

  test('向きや隙間が違えば一致しない', () => {
    const a = shape(['x', _, _, 'y', _, _, _, _, _]);
    expect(shapeMatches(a, shape(['x', 'y', _, _, _, _, _, _, _]), same)).toBe(false);
    expect(shapeMatches(a, shape(['x', _, _, _, _, _, 'y', _, _]), same)).toBe(false);
    expect(shapeMatches(a, shape(['y', _, _, 'x', _, _, _, _, _]), same)).toBe(false);
  });

  test('左右反転は一致しない', () => {
    const a = shape(['x', 'y', _, 'x', _, _, _, _, _]);
    const b = shape(['y', 'x', _, _, 'x', _, _, _, _]);
    expect(shapeMatches(a, b, same)).toBe(false);
  });
});

describe('itemMatches', () => {
  const key = item('minecraft:tripwire_hook', { nameTag: '金の鍵', lore: ['宝物庫の鍵'] });

  test('id：種類だけを見る', () => {
    expect(itemMatches(key, item('minecraft:tripwire_hook'), 'id')).toBe(true);
    expect(itemMatches(key, item('minecraft:stick'), 'id')).toBe(false);
  });

  test('name：名前も見る', () => {
    expect(itemMatches(key, item('minecraft:tripwire_hook', { nameTag: '金の鍵' }), 'name')).toBe(
      true,
    );
    expect(itemMatches(key, item('minecraft:tripwire_hook'), 'name')).toBe(false);
  });

  test('lore：説明文も見る', () => {
    const noLore = item('minecraft:tripwire_hook', { nameTag: '金の鍵' });
    expect(itemMatches(key, noLore, 'lore')).toBe(false);
    expect(
      itemMatches(
        key,
        item('minecraft:tripwire_hook', { nameTag: '金の鍵', lore: ['宝物庫の鍵'] }),
        'lore',
      ),
    ).toBe(true);
  });

  test('exact：重ねられないアイテムはエンチャントと耐久値まで比べる', () => {
    const sword = (options: FakeOptions = {}) =>
      item('minecraft:iron_sword', { stackable: false, ...options });
    const sharp = sword({ enchantments: { sharpness: 3 } });
    expect(itemMatches(sharp, sword({ enchantments: { sharpness: 3 } }), 'exact')).toBe(true);
    expect(itemMatches(sharp, sword({ enchantments: { sharpness: 2 } }), 'exact')).toBe(false);
    expect(itemMatches(sharp, sword(), 'exact')).toBe(false);
    expect(itemMatches(sword(), sword({ damage: 10 }), 'exact')).toBe(false);
  });
});

describe('findRecipe', () => {
  const pickaxe = recipe(
    'pickaxe',
    [plank(), plank(), plank(), _, stick(), _, _, stick(), _],
    'id',
  );

  test('配置が一致するレシピを返す', () => {
    const grid = [plank(), plank(), plank(), _, stick(), _, _, stick(), _];
    expect(findRecipe([pickaxe], grid, 3)).toBe(pickaxe);
  });

  test('一致しなければ undefined', () => {
    expect(findRecipe([pickaxe], [plank(), _, _, _, _, _, _, _, _], 3)).toBeUndefined();
    expect(findRecipe([pickaxe], [_, _, _, _, _, _, _, _, _], 3)).toBeUndefined();
  });

  test('複数当てはまるときは照合が厳しい方を優先する', () => {
    const named = () => item('minecraft:tripwire_hook', { nameTag: '金の鍵' });
    const plain = recipe('plain', [item('minecraft:tripwire_hook'), _, _, _, _, _, _, _, _], 'id');
    const special = recipe('special', [named(), _, _, _, _, _, _, _, _], 'name');

    for (const recipes of [
      [plain, special],
      [special, plain],
    ]) {
      expect(findRecipe(recipes, [_, _, _, _, named(), _, _, _, _], 3)).toBe(special);
      expect(
        findRecipe(recipes, [_, _, _, _, item('minecraft:tripwire_hook'), _, _, _, _], 3),
      ).toBe(plain);
    }
  });
});
