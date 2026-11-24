// 実物登録エディタ。docs/06-admin-ui.md
// クラフト画面と同じレイアウトに材料と完成品を実物で置き、閉じたときに取り込む
import { type Player } from '@minecraft/server';
import { craftingLayout } from './layout';
import { newRecipeMeta } from './recipe';
import { ContainerScreen } from './screen';
import { getRecipeItems, getStation, newRecipeId, saveRecipeItems, setStation } from './store';
import { type LangKey, tr } from './util';

/**
 * エディタを開き、閉じて保存し終わったら解決する（その後に管理画面へ戻る）。
 * @param recipeId 編集するレシピ。省略すると新しいレシピを作る
 * @returns 保存したレシピの ID。保存しなかった・できなかったときは undefined
 */
export async function openEditor(
  player: Player,
  key: string,
  recipeId: string | undefined,
): Promise<string | undefined> {
  const existing = recipeId === undefined ? undefined : getRecipeItems(recipeId);
  // 色のグリッドサイズで開く。登録済みのレシピの方が大きければ、材料を欠かさないようそちらに合わせる
  const gridSize = Math.max(getStation(key).gridSize, existing?.gridSize ?? 0);
  const layout = craftingLayout(gridSize, false);
  const { gridSlots, resultSlot } = layout;

  let saved: string | undefined;
  const screen = ContainerScreen.open(player, {
    title: 'craft.editor.title' satisfies LangKey,
    layout,
    // 閉じたときと同じく、置いたアイテムは材料も完成品も管理者に返す
    stash: [...gridSlots, resultSlot],

    fill(container) {
      if (!existing) return;
      // 登録したときのグリッドが小さければ、左上に詰めて並べる
      existing.grid.forEach((item, i) => {
        const x = i % existing.gridSize;
        const y = Math.floor(i / existing.gridSize);
        container.setItem(gridSlots[y * gridSize + x]!, item?.clone());
      });
      container.setItem(resultSlot, existing.result.clone());
    },

    onClose(screen) {
      const { container } = screen;
      const grid = gridSlots.map((slot) => container.getItem(slot));
      const result = container.getItem(resultSlot);

      if (player.isValid) {
        if (result && grid.some((item) => item !== undefined)) {
          const id = recipeId ?? newRecipeId();
          try {
            saveRecipeItems(player, id, grid, result);
            const station = getStation(key);
            let meta = station.recipes.find((recipe) => recipe.id === id);
            if (!meta) {
              meta = newRecipeMeta(id, `Recipe ${station.recipes.length + 1}`, gridSize);
              station.recipes.push(meta);
            }
            meta.gridSize = gridSize;
            setStation(key, station);
            saved = id;
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
  return saved;
}
