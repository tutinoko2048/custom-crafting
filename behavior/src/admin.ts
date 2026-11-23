// 管理画面（CustomForm / DDUI）。docs/06-admin-ui.md
//   色一覧 → 色の設定（レシピ一覧）→ レシピの詳細 / 実物エディタ
import { type Player, system } from '@minecraft/server';
import {
  CustomForm,
  DataDrivenScreenClosedReason,
  MessageBox,
  ObservableNumber,
  ObservableString,
  type UIRawMessage,
} from '@minecraft/server-ui';
import { COLORS, stationColor, stationKey } from './constants';
import { openEditor } from './editor';
import { MATCH_MODES } from './recipe';
import { deleteRecipeItems, ensureLoaded, getRecipeItems, getStation, setStation } from './store';
import { tr } from './util';

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;
/** コンテナのタイトルは 256 バイトまで。日本語（1文字3バイト）でも収まる長さにする */
const MAX_NAME_LENGTH = 60;

const text = (...parts: (string | UIRawMessage)[]): UIRawMessage => ({
  rawtext: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
});

/**
 * フォームを表示する。画面の切り替えはここ1か所にまとめる。
 * - `go(next)` は今のフォームを閉じ、閉じきってから `next` を呼ぶ
 * - ほかの画面が閉じきっていなくて表示できなかった（UserBusy）ときは、少し待ってやり直す
 */
async function present(
  player: Player,
  title: UIRawMessage,
  build: (form: CustomForm, go: (next: () => void) => void) => void,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES && player.isValid; attempt++) {
    const form = new CustomForm(player, title);
    let next: (() => void) | undefined;
    build(form, (target) => {
      next = target;
      form.close();
    });

    const reason = await form.show();
    if (reason === DataDrivenScreenClosedReason.UserBusy) {
      await system.waitTicks(RETRY_TICKS);
      continue;
    }
    next?.();
    return;
  }
}

const run = (screen: Promise<void>): void => {
  screen.catch((error: unknown) => console.warn(`[custom-crafting] admin form: ${String(error)}`));
};

export function openAdmin(player: Player, key?: string): void {
  run(
    ensureLoaded(player).then(() =>
      key === undefined ? colorList(player) : stationSettings(player, key),
    ),
  );
}

const colorName = (key: string): UIRawMessage => tr(`craft.color.${stationColor(key) ?? 'white'}`);

/** 16色の設定状況 */
function colorList(player: Player): Promise<void> {
  return present(player, tr('craft.admin.title'), (form, go) => {
    form.label(tr('craft.admin.colors.body'));
    for (const color of COLORS) {
      const key = stationKey(color);
      const station = getStation(key);
      const label = station.name
        ? text(colorName(key), ` - ${station.name} (${station.recipes.length})`)
        : text(colorName(key), ` (${station.recipes.length})`);
      form.button(label, () => go(() => run(stationSettings(player, key))));
    }
  });
}

/** 色の設定とレシピ一覧 */
function stationSettings(player: Player, key: string): Promise<void> {
  const station = getStation(key);
  const name = new ObservableString(station.name, { clientWritable: true });
  const status = new ObservableString('');

  return present(player, text(tr('craft.admin.title'), ' - ', colorName(key)), (form, go) => {
    form
      .textField(tr('craft.admin.station.name'), name)
      .button(tr('craft.admin.station.save'), () => {
        // フォームを開いたまま保存し、結果をその場に表示する
        const current = getStation(key);
        current.name = name.getData().trim().slice(0, MAX_NAME_LENGTH);
        setStation(key, current);
        status.setData(`§a✔ ${current.name}`);
      })
      .label(status)
      .divider()
      .header(tr('craft.admin.recipes'));

    for (const recipe of station.recipes) {
      // アイテムを読み込めなかったレシピは使えないので、印を付ける
      const label = getRecipeItems(recipe.id) ? recipe.name : `§c${recipe.name} (!)`;
      form.button(label, () => go(() => run(recipeDetail(player, key, recipe.id))));
    }
    form
      .button(tr('craft.admin.recipes.add'), () =>
        go(() => openEditor(player, key, undefined, () => run(stationSettings(player, key)))),
      )
      .divider()
      .button(tr('craft.admin.back'), () => go(() => run(colorList(player))));
  });
}

/** レシピの詳細 */
function recipeDetail(player: Player, key: string, recipeId: string): Promise<void> {
  const back = () => run(stationSettings(player, key));
  const recipe = getStation(key).recipes.find((entry) => entry.id === recipeId);
  if (!recipe) return stationSettings(player, key);

  const name = new ObservableString(recipe.name, { clientWritable: true });
  const mode = new ObservableNumber(MATCH_MODES.indexOf(recipe.match), { clientWritable: true });

  return present(player, text(tr('craft.admin.recipe.title'), ` - ${recipe.name}`), (form, go) => {
    form
      .textField(tr('craft.admin.recipe.name'), name)
      .dropdown(
        tr('craft.admin.recipe.match'),
        mode,
        MATCH_MODES.map((value, index) => ({
          label: tr(`craft.admin.recipe.match.${value}`),
          value: index,
        })),
        { description: tr('craft.admin.recipe.match.description') },
      )
      .button(tr('craft.admin.recipe.save'), () => {
        const station = getStation(key);
        const target = station.recipes.find((entry) => entry.id === recipeId);
        if (target) {
          target.name = name.getData().trim().slice(0, MAX_NAME_LENGTH) || target.name;
          target.match = MATCH_MODES[mode.getData()] ?? target.match;
          setStation(key, station);
        }
        go(back);
      })
      .button(tr('craft.admin.recipe.edit'), () =>
        go(() => openEditor(player, key, recipeId, () => run(recipeDetail(player, key, recipeId)))),
      )
      .divider()
      .button(tr('craft.admin.recipe.delete'), () =>
        go(() => run(confirmDelete(player, key, recipeId, recipe.name))),
      )
      .button(tr('craft.admin.back'), () => go(back));
  });
}

async function confirmDelete(
  player: Player,
  key: string,
  recipeId: string,
  recipeName: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES && player.isValid; attempt++) {
    const result = await new MessageBox(player, tr('craft.admin.recipe.delete'))
      .body(tr('craft.admin.recipe.delete.confirm', recipeName))
      .button1(tr('craft.admin.recipe.delete'))
      .button2(tr('craft.admin.cancel'))
      .show();
    if (result.closeReason === DataDrivenScreenClosedReason.UserBusy) {
      await system.waitTicks(RETRY_TICKS);
      continue;
    }

    if (result.selection !== 0) return recipeDetail(player, key, recipeId);
    const station = getStation(key);
    station.recipes = station.recipes.filter((entry) => entry.id !== recipeId);
    setStation(key, station);
    deleteRecipeItems(recipeId);
    return stationSettings(player, key);
  }
}
