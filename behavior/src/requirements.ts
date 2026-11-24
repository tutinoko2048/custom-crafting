// レシピのコスト・条件・報酬。docs/07-recipe.md
import { type Player, type RawMessage, world } from '@minecraft/server';
import { NAMESPACE } from './constants';
import type { RecipeMeta } from './recipe';
import { tr } from './util';

/** 1人1回のレシピをクラフト済みかどうか（プレイヤーのダイナミックプロパティ） */
const doneProperty = (recipeId: string) => `${NAMESPACE}:done.${recipeId}`;

const objectiveOf = (recipe: RecipeMeta) =>
  recipe.scoreObjective ? world.scoreboard.getObjective(recipe.scoreObjective) : undefined;

function scoreOf(player: Player, recipe: RecipeMeta): number {
  try {
    return objectiveOf(recipe)?.getScore(player) ?? 0;
  } catch {
    // まだスコアを持っていないプレイヤー
    return 0;
  }
}

/** クラフトできない理由。できるなら undefined */
export function blockedReason(player: Player, recipe: RecipeMeta): RawMessage | undefined {
  if (recipe.tag && !player.hasTag(recipe.tag)) return tr('craft.msg.blocked.tag');
  if (recipe.once && player.getDynamicProperty(doneProperty(recipe.id)) === true) {
    return tr('craft.msg.blocked.once');
  }
  if (recipe.levels > 0 && player.level < recipe.levels) {
    return tr('craft.msg.blocked.levels', String(recipe.levels));
  }
  if (recipe.scoreObjective && recipe.scoreAmount > 0) {
    const objective = objectiveOf(recipe);
    if (!objective) {
      console.warn(`[custom-crafting] scoreboard objective not found: ${recipe.scoreObjective}`);
      return tr('craft.msg.blocked.unavailable');
    }
    if (scoreOf(player, recipe) < recipe.scoreAmount) {
      return tr('craft.msg.blocked.score', String(recipe.scoreAmount), objective.displayName);
    }
  }
  return undefined;
}

/** クラフトが確定したときに呼ぶ。コストを払い、1回目を記録し、報酬のコマンドを実行する */
export function completeCraft(player: Player, recipe: RecipeMeta): void {
  if (recipe.levels > 0) player.addLevels(-recipe.levels);
  if (recipe.scoreAmount > 0) objectiveOf(recipe)?.addScore(player, -recipe.scoreAmount);
  if (recipe.once) player.setDynamicProperty(doneProperty(recipe.id), true);

  const command = recipe.command.trim().replace(/^\//, '');
  if (!command) return;
  try {
    player.runCommand(command);
  } catch (error) {
    console.warn(`[custom-crafting] reward command failed (${recipe.id}): ${String(error)}`);
  }
}
