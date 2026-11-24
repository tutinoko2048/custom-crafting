import { describe, expect, test } from 'vite-plus/test';
import { UI_FILLER } from './constants';
import { craftingLayout, GRID_SIZES } from './layout';

describe('craftingLayout', () => {
  test('3×3 は今までと同じ配置', () => {
    const layout = craftingLayout(3);
    expect(layout.size).toBe(27);
    expect(layout.gridSlots).toEqual([1, 2, 3, 10, 11, 12, 19, 20, 21]);
    expect(layout.resultSlot).toBe(16);
  });

  test.each(GRID_SIZES)(
    '%i マス四方：グリッドと完成品が重ならず、行からはみ出さない',
    (gridSize) => {
      const layout = craftingLayout(gridSize);
      const { gridSlots, resultSlot, size, locked } = layout;
      expect(gridSlots).toHaveLength(gridSize * gridSize);
      expect(new Set([...gridSlots, resultSlot]).size).toBe(gridSlots.length + 1);
      expect(size).toBeLessThanOrEqual(54);

      // 各行のマスが同じ行に並んでいる（折り返していない）
      for (let row = 0; row < gridSize; row++) {
        const cells = gridSlots.slice(row * gridSize, (row + 1) * gridSize);
        const line = Math.floor(cells[0]! / 9);
        expect(
          cells.every((slot, i) => slot === cells[0]! + i && Math.floor(slot / 9) === line),
        ).toBe(true);
      }
      // 完成品はグリッドより右
      expect(resultSlot % 9).toBeGreaterThan(Math.max(...gridSlots.map((slot) => slot % 9)));
      // グリッドと完成品以外はすべて動かせない
      expect(locked.size).toBe(size - gridSlots.length - 1);
    },
  );

  test.each(GRID_SIZES)(
    '%i マス四方：まとめて作るボタンの場所は完成品のすぐ下で、最初は穴埋め',
    (gridSize) => {
      const layout = craftingLayout(gridSize);
      expect(layout.craftAllSlot).toBe(layout.resultSlot + 9);
      expect(layout.craftAllSlot).toBeLessThan(layout.size);
      expect(layout.locked.get(layout.craftAllSlot)).toBe(UI_FILLER);
    },
  );
});
