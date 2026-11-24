// クラフト画面（チェスト画面・1行9マス）のスロット割り当て。docs/04-crafting-screen.md
// グリッドサイズ（3×3 か 5×5）から作る。3×3 の場合：
//
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■
//  ■  [ ][ ][ ]  ■  →  ■  [完成] ■
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■
//
// 5×5 は横幅が足りないので、グリッドを左端に寄せ、矢印と完成品を右端に置く

import { UI_ARROW, UI_FILLER } from './constants';
import type { ScreenLayout } from './screen';

/** 選べるグリッドサイズ */
export const GRID_SIZES = [3, 5] as const;
export const DEFAULT_GRID_SIZE = 3;

export const isGridSize = (value: unknown): value is number =>
  (GRID_SIZES as readonly unknown[]).includes(value);

const COLUMNS = 9;

export interface CraftingLayout extends ScreenLayout {
  gridSize: number;
  /** 材料グリッドのスロット番号（左上から行ごと） */
  gridSlots: readonly number[];
  resultSlot: number;
  /**
   * まとめて作るボタンの場所（完成品のすぐ下）。最初は穴埋めにしておき、
   * クラフト画面が作れるときだけボタンに差し替える（crafting.ts）
   */
  craftAllSlot: number;
}

const cache = new Map<number, CraftingLayout>();

/** クラフト画面とエディタで共通の画面構成。グリッド・完成品以外は動かせない UI アイテムで埋める */
export function craftingLayout(gridSize: number): CraftingLayout {
  const cached = cache.get(gridSize);
  if (cached) return cached;

  const rows = Math.max(3, gridSize);
  const top = Math.floor((rows - gridSize) / 2);
  const middle = Math.floor((rows - 1) / 2);
  // 余白を空けて並べられるなら左に1マス空ける。足りなければ左端に寄せ、矢印と完成品を右端に置く
  const roomy = gridSize + 5 <= COLUMNS;
  const left = roomy ? 1 : 0;
  const arrowColumn = roomy ? left + gridSize + 1 : COLUMNS - 3;
  const resultColumn = roomy ? arrowColumn + 2 : COLUMNS - 1;

  const gridSlots = Array.from(
    { length: gridSize * gridSize },
    (_, i) => (top + Math.floor(i / gridSize)) * COLUMNS + left + (i % gridSize),
  );
  const resultSlot = middle * COLUMNS + resultColumn;
  const arrowSlot = middle * COLUMNS + arrowColumn;
  const craftAllSlot = resultSlot + COLUMNS;
  const size = rows * COLUMNS;

  const layout: CraftingLayout = {
    gridSize,
    gridSlots,
    resultSlot,
    craftAllSlot,
    size,
    locked: new Map(
      Array.from({ length: size }, (_, slot) => slot)
        .filter((slot) => slot !== resultSlot && !gridSlots.includes(slot))
        .map((slot) => [slot, slot === arrowSlot ? UI_ARROW : UI_FILLER]),
    ),
  };
  cache.set(gridSize, layout);
  return layout;
}
