// クラフト画面（チェスト画面・1行9マス×3行）のスロット割り当て。docs/04-crafting-screen.md
//
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■
//  ■  [ ][ ][ ]  ■  →  ■  [完成] ■
//  ■  [ ][ ][ ]  ■  ■  ■  ■  ■

export const GRID_SIZE = 3;
export const CONTAINER_SIZE = 27;

const COLUMNS = 9;
const GRID_LEFT = 1;

/** 材料グリッドのスロット番号（左上から行ごと） */
export const GRID_SLOTS: readonly number[] = Array.from(
  { length: GRID_SIZE * GRID_SIZE },
  (_, i) => Math.floor(i / GRID_SIZE) * COLUMNS + GRID_LEFT + (i % GRID_SIZE),
);

export const ARROW_SLOT = 14;
export const RESULT_SLOT = 16;

/** 穴埋め用アイテムを置くスロット */
export const FILLER_SLOTS: readonly number[] = Array.from(
  { length: CONTAINER_SIZE },
  (_, i) => i,
).filter((slot) => slot !== ARROW_SLOT && slot !== RESULT_SLOT && !GRID_SLOTS.includes(slot));
