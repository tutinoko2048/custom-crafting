// クラフト画面（チェスト画面・1行9マス×3行）のスロット割り当て。docs/04-crafting-screen.md
//
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■
//  ■  [ ][ ][ ]  ■  →  ■  [完成] ■
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■

import { UI_ARROW, UI_FILLER } from './constants';
import type { ScreenLayout } from './screen';

export const GRID_SIZE = 3;

const CONTAINER_SIZE = 27;
const COLUMNS = 9;
const GRID_LEFT = 1;
const ARROW_SLOT = 14;

/** 材料グリッドのスロット番号（左上から行ごと） */
export const GRID_SLOTS: readonly number[] = Array.from(
  { length: GRID_SIZE * GRID_SIZE },
  (_, i) => Math.floor(i / GRID_SIZE) * COLUMNS + GRID_LEFT + (i % GRID_SIZE),
);

export const RESULT_SLOT = 16;

/**
 * クラフト画面とエディタで共通の画面構成。グリッド・完成品以外は動かせない UI アイテムで埋める。
 * グリッドサイズを色ごとに変えるときは、これをサイズから作る関数にする
 */
export const CRAFTING_LAYOUT: ScreenLayout = {
  size: CONTAINER_SIZE,
  locked: new Map(
    Array.from({ length: CONTAINER_SIZE }, (_, slot) => slot)
      .filter((slot) => slot !== RESULT_SLOT && !GRID_SLOTS.includes(slot))
      .map((slot) => [slot, slot === ARROW_SLOT ? UI_ARROW : UI_FILLER]),
  ),
};
