// 16色の定義。色の ID 自体は behavior/src/constants.ts が持つ（スクリプトと共有する）
import { type Color, COLORS } from '@behavior/constants';

export interface ColorDefinition {
  id: Color;
  /** 言語ファイルに出す色の名前 */
  ja: string;
  en: string;
}

const DETAILS: Record<Color, Omit<ColorDefinition, 'id'>> = {
  white: { ja: '白色', en: 'White' },
  orange: { ja: '橙色', en: 'Orange' },
  magenta: { ja: '赤紫色', en: 'Magenta' },
  light_blue: { ja: '空色', en: 'Light Blue' },
  yellow: { ja: '黄色', en: 'Yellow' },
  lime: { ja: '黄緑色', en: 'Lime' },
  pink: { ja: '桃色', en: 'Pink' },
  gray: { ja: '灰色', en: 'Gray' },
  light_gray: { ja: '薄灰色', en: 'Light Gray' },
  cyan: { ja: '青緑色', en: 'Cyan' },
  purple: { ja: '紫色', en: 'Purple' },
  blue: { ja: '青色', en: 'Blue' },
  brown: { ja: '茶色', en: 'Brown' },
  green: { ja: '緑色', en: 'Green' },
  red: { ja: '赤色', en: 'Red' },
  black: { ja: '黒色', en: 'Black' },
};

export const COLOR_DEFINITIONS: ColorDefinition[] = COLORS.map((id) => ({ id, ...DETAILS[id] }));
