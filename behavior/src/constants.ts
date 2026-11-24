export const NAMESPACE = 'craft';

/** バニラの染料と同じ16色。作業台ブロックとステーションはこの色で区別する */
export const COLORS = [
  'white',
  'orange',
  'magenta',
  'light_blue',
  'yellow',
  'lime',
  'pink',
  'gray',
  'light_gray',
  'cyan',
  'purple',
  'blue',
  'brown',
  'green',
  'red',
  'black',
] as const;

export type Color = (typeof COLORS)[number];

export const isColor = (value: string): value is Color =>
  (COLORS as readonly string[]).includes(value);

const BLOCK_PREFIX = `${NAMESPACE}:workbench_`;

/**
 * ステーションのキー。形違いの作業台を後から足せるよう `<形>_<色>` にしておく
 * （docs/02-station.md）
 */
export const stationKey = (color: Color): string => `table_${color}`;

export const stationColor = (key: string): Color | undefined => {
  const color = key.slice(key.indexOf('_') + 1);
  return isColor(color) ? color : undefined;
};

export const stationKeyOfBlock = (typeId: string): string | undefined => {
  if (!typeId.startsWith(BLOCK_PREFIX)) return undefined;
  const color = typeId.slice(BLOCK_PREFIX.length);
  return isColor(color) ? stationKey(color) : undefined;
};

export const WORKBENCH_COMPONENT = `${NAMESPACE}:workbench`;
export const STORE_ENTITY = `${NAMESPACE}:recipe_store`;
export const UI_PREFIX = `${NAMESPACE}:ui_`;
export const UI_FILLER = `${UI_PREFIX}filler`;
export const UI_ARROW = `${UI_PREFIX}arrow`;
/** まとめて作るボタン。表示名があるのでツールチップが出る */
export const UI_CRAFT_ALL = `${UI_PREFIX}craft_all`;
