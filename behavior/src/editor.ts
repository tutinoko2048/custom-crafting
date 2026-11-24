// 実物登録エディタ。docs/06-admin-ui.md
// クラフト画面と同じレイアウトに材料と完成品を実物で置き、閉じたときに取り込む
import { type Player } from '@minecraft/server';
import { CRAFTING_LAYOUT, GRID_SLOTS, RESULT_SLOT } from './layout';
import { ContainerScreen } from './screen';
import { getRecipeItems, getStation, newRecipeId, saveRecipeItems, setStation } from './store';
import { type LangKey, tr } from './util';

/**
 * エディタを開き、閉じて保存し終わったら解決する（その後に管理画面へ戻る）。
 * @param recipeId 編集するレシピ。省略すると新しいレシピを作る
 */
export async function openEditor(
  player: Player,
  key: string,
  recipeId: string | undefined,
): Promise<void> {
  const existing = recipeId === undefined ? undefined : getRecipeItems(recipeId);

  const screen = ContainerScreen.open(player, {
    title: 'craft.editor.title' satisfies LangKey,
    layout: CRAFTING_LAYOUT,

    fill(container) {
      if (!existing) return;
      existing.grid.forEach((item, i) => container.setItem(GRID_SLOTS[i]!, item?.clone()));
      container.setItem(RESULT_SLOT, existing.result.clone());
    },

    onClose(screen) {
      const { container } = screen;
      const grid = GRID_SLOTS.map((slot) => container.getItem(slot));
      const result = container.getItem(RESULT_SLOT);

      if (player.isValid) {
        if (result && grid.some((item) => item !== undefined)) {
          const id = recipeId ?? newRecipeId();
          try {
            saveRecipeItems(player, id, grid, result);
            const station = getStation(key);
            let meta = station.recipes.find((recipe) => recipe.id === id);
            if (!meta) {
              meta = { id, name: `Recipe ${station.recipes.length + 1}`, match: 'exact' };
              station.recipes.push(meta);
              setStation(key, station);
            }
            player.sendMessage(tr('craft.msg.saved', meta.name));
          } catch (error) {
            console.warn(`[custom-crafting] failed to save recipe: ${String(error)}`);
            player.sendMessage(tr('craft.msg.save_failed'));
          }
        } else {
          player.sendMessage(tr('craft.msg.not_saved'));
        }
      }

      // 置いたアイテムは管理者に返す（登録しただけでアイテムを失わない）
      for (const item of [...grid, result]) {
        if (item) screen.give(item);
      }
    },
  });
  await screen?.closed;
}
