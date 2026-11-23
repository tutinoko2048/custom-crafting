// 生成するファイルの定義（何を・どこに出すか）。書き出しは gen-assets.ts が行う。
// テクスチャ（resource/textures）は生成せず、PNG をそのまま置いている
import { NAMESPACE, stationKey, WORKBENCH_COMPONENT } from '@behavior/constants';
import { COLOR_DEFINITIONS, type ColorDefinition } from './colors';

const FORMAT_VERSION = '1.26.60';
/** クリエイティブ画面で16色を1つに折りたたむグループ */
const GROUP = `${NAMESPACE}:itemGroup.name.workbench`;
const BLOCK_TEXTURES = 'textures/craft/blocks';

const blockName = (color: ColorDefinition) => `workbench_${color.id}`;
const blockId = (color: ColorDefinition) => `${NAMESPACE}:${blockName(color)}`;

/** behavior/blocks/workbench_<color>.json */
const workbenchBlock = (color: ColorDefinition) => ({
  format_version: FORMAT_VERSION,
  'minecraft:block': {
    description: {
      identifier: blockId(color),
      menu_category: { category: 'items', group: GROUP },
    },
    components: {
      // 右クリックの処理（behavior/src/main.ts で登録する共通のカスタムコンポーネント）
      [WORKBENCH_COMPONENT]: {},
      'minecraft:geometry': 'minecraft:geometry.full_block',
      'minecraft:material_instances': {
        // バニラの作業台と同じく、南北が道具の掛かった正面
        '*': { texture: `${blockId(color)}_side` },
        north: { texture: `${blockId(color)}_front` },
        south: { texture: `${blockId(color)}_front` },
        up: { texture: `${blockId(color)}_top` },
        down: { texture: `${NAMESPACE}:workbench_bottom` },
      },
      'minecraft:destructible_by_mining': { seconds_to_destroy: 2.5 },
      'minecraft:destructible_by_explosion': { explosion_resistance: 2.5 },
      'minecraft:flammable': { catch_chance_modifier: 5, destroy_chance_modifier: 20 },
    },
  },
});

/** behavior/item_catalog/crafting_item_catalog.json */
const itemCatalog = () => ({
  format_version: FORMAT_VERSION,
  'minecraft:crafting_items_catalog': {
    categories: [
      {
        category_name: 'items',
        groups: [
          {
            group_identifier: { icon: `${NAMESPACE}:workbench_white`, name: GROUP },
            items: COLOR_DEFINITIONS.map(blockId),
          },
        ],
      },
    ],
  },
});

/** resource/textures/terrain_texture.json：material_instances の短い名前 → 画像のパス */
const terrainTexture = () => ({
  resource_pack_name: 'custom-crafting',
  texture_name: 'atlas.terrain',
  texture_data: Object.fromEntries([
    [`${NAMESPACE}:workbench_bottom`, { textures: `${BLOCK_TEXTURES}/workbench_bottom` }],
    ...COLOR_DEFINITIONS.flatMap((color) =>
      ['top', 'side', 'front'].map((face) => [
        `${blockId(color)}_${face}`,
        { textures: `${BLOCK_TEXTURES}/${blockName(color)}_${face}` },
      ]),
    ),
  ]),
});

/** resource/blocks.json：ブロックの音 */
const blockSounds = () => ({
  format_version: '1.21.40',
  ...Object.fromEntries(COLOR_DEFINITIONS.map((color) => [blockId(color), { sound: 'wood' }])),
});

/** 言語ファイルに入れる色ごとの行 */
const langLines = (locale: 'ja' | 'en'): string[] =>
  COLOR_DEFINITIONS.flatMap((color) => {
    const workbench =
      locale === 'ja' ? `${color.ja}のカスタム作業台` : `${color.en} Custom Workbench`;
    return [
      `tile.${blockId(color)}.name=${workbench}`,
      // 表示名が未設定のときのコンテナのタイトル
      `craft.station.${stationKey(color.id)}=${workbench}`,
      // 管理画面の色一覧
      `craft.color.${color.id}=${color[locale]}`,
    ];
  });

export interface AssetDefinitions {
  /** パス → JSON の中身 */
  json: Record<string, unknown>;
  /** パス → 言語ファイルの生成範囲（マーカーで挟んだ部分）に入れる行 */
  lang: Record<string, string[]>;
}

/** パスはリポジトリのルートからの相対パス */
export const defineAssets = (): AssetDefinitions => ({
  json: {
    ...Object.fromEntries(
      COLOR_DEFINITIONS.map((color) => [
        `behavior/blocks/${blockName(color)}.json`,
        workbenchBlock(color),
      ]),
    ),
    'behavior/item_catalog/crafting_item_catalog.json': itemCatalog(),
    'resource/textures/terrain_texture.json': terrainTexture(),
    'resource/blocks.json': blockSounds(),
  },
  lang: {
    'resource/texts/ja_JP.lang': langLines('ja'),
    'resource/texts/en_US.lang': langLines('en'),
  },
});
