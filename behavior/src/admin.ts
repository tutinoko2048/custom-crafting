// 管理画面（CustomForm / DDUI）。docs/06-admin-ui.md
//   色一覧 → 色の設定（レシピ一覧）→ レシピの詳細 / 実物エディタ
import { type Player, system } from '@minecraft/server';
import {
  CustomForm,
  DataDrivenScreenClosedReason,
  MessageBox,
  ObservableBoolean,
  ObservableNumber,
  ObservableString,
  type UIRawMessage,
} from '@minecraft/server-ui';
import { COLORS, stationColor, stationKey } from './constants';
import { openEditor } from './editor';
import { MATCH_MODES, RECIPE_SHAPES, toCount } from './recipe';
import { deleteRecipeItems, ensureLoaded, getRecipeItems, getStation, setStation } from './store';
import { tr } from './util';

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;
/** コンテナのタイトルは 256 バイトまで。日本語（1文字3バイト）でも収まる長さにする */
const MAX_NAME_LENGTH = 60;

const text = (...parts: (string | UIRawMessage)[]): UIRawMessage => ({
  rawtext: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
});

type Screen = () => Promise<void>;
/** ボタンの onClick。今のフォームを閉じて `screen` を開く */
type Link = (screen: Screen) => () => void;

/**
 * フォームを表示する。
 * - `link(screen)` は「今のフォームを閉じて screen を開く」ボタン処理を返す。
 *   `close()` の直後でも次のフォームは表示できる
 * - ほかの画面が開いていて表示できなかった（UserBusy）ときは、少し待ってやり直す
 */
async function present(
  player: Player,
  title: UIRawMessage,
  build: (form: CustomForm, link: Link) => void,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES && player.isValid; attempt++) {
    const form = new CustomForm(player, title);
    build(form, (screen) => () => {
      form.close();
      run(screen());
    });
    if ((await form.show()) !== DataDrivenScreenClosedReason.UserBusy) return;
    await system.waitTicks(RETRY_TICKS);
  }
}

const run = (screen: Promise<void>): void => {
  screen.catch((error: unknown) => console.warn(`[custom-crafting] admin form: ${String(error)}`));
};

/** 実物エディタを開き、閉じたら `back` に戻る */
const editThen =
  (player: Player, key: string, recipeId: string | undefined, back: Screen): Screen =>
  () =>
    openEditor(player, key, recipeId).then(back);

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
  return present(player, tr('craft.admin.title'), (form, link) => {
    form.label(tr('craft.admin.colors.body'));
    for (const color of COLORS) {
      const key = stationKey(color);
      const station = getStation(key);
      const label = station.name
        ? text(colorName(key), ` - ${station.name} (${station.recipes.length})`)
        : text(colorName(key), ` (${station.recipes.length})`);
      form.button(
        label,
        link(() => stationSettings(player, key)),
      );
    }
  });
}

/** 色の設定とレシピ一覧 */
function stationSettings(player: Player, key: string): Promise<void> {
  const station = getStation(key);
  const name = new ObservableString(station.name, { clientWritable: true });
  const status = new ObservableString('');
  const self: Screen = () => stationSettings(player, key);

  // フォームを開いたまま保存し、結果をその場に表示する
  const saveName = (): void => {
    const current = getStation(key);
    current.name = name.getData().trim().slice(0, MAX_NAME_LENGTH);
    setStation(key, current);
    status.setData(`§a✔ ${current.name}`);
  };

  return present(player, text(tr('craft.admin.title'), ' - ', colorName(key)), (form, link) => {
    form
      .textField(tr('craft.admin.station.name'), name)
      .button(tr('craft.admin.station.save'), saveName)
      .label(status)
      .divider()
      .header(tr('craft.admin.recipes'));

    for (const recipe of station.recipes) {
      // アイテムを読み込めなかったレシピは使えないので、印を付ける
      const label = getRecipeItems(recipe.id) ? recipe.name : `§c${recipe.name} (!)`;
      form.button(
        label,
        link(() => recipeDetail(player, key, recipe.id)),
      );
    }

    form
      .button(tr('craft.admin.recipes.add'), link(editThen(player, key, undefined, self)))
      .divider()
      .button(
        tr('craft.admin.back'),
        link(() => colorList(player)),
      );
  });
}

/** レシピの詳細 */
function recipeDetail(player: Player, key: string, recipeId: string): Promise<void> {
  const recipe = getStation(key).recipes.find((entry) => entry.id === recipeId);
  if (!recipe) return stationSettings(player, key);

  const name = new ObservableString(recipe.name, { clientWritable: true });
  const mode = new ObservableNumber(MATCH_MODES.indexOf(recipe.match), { clientWritable: true });
  const shape = new ObservableNumber(RECIPE_SHAPES.indexOf(recipe.shape), {
    clientWritable: true,
  });
  // コスト・条件・報酬。上級者向けなので、何も設定していなければ折りたたんでおく
  const writable = { clientWritable: true };
  const levels = new ObservableString(String(recipe.levels), writable);
  const scoreObjective = new ObservableString(recipe.scoreObjective, writable);
  const scoreAmount = new ObservableString(String(recipe.scoreAmount), writable);
  const tag = new ObservableString(recipe.tag, writable);
  const once = new ObservableBoolean(recipe.once, writable);
  const command = new ObservableString(recipe.command, writable);
  const configured =
    recipe.levels > 0 ||
    recipe.scoreObjective !== '' ||
    recipe.tag !== '' ||
    recipe.once ||
    recipe.command !== '';
  const advanced = new ObservableBoolean(configured, writable);
  const visible = { visible: advanced };

  const self: Screen = () => recipeDetail(player, key, recipeId);
  const back: Screen = () => stationSettings(player, key);

  const save = (): void => {
    const station = getStation(key);
    const target = station.recipes.find((entry) => entry.id === recipeId);
    if (!target) return;
    target.name = name.getData().trim().slice(0, MAX_NAME_LENGTH) || target.name;
    target.match = MATCH_MODES[mode.getData()] ?? target.match;
    target.shape = RECIPE_SHAPES[shape.getData()] ?? target.shape;
    target.levels = toCount(levels.getData());
    target.scoreObjective = scoreObjective.getData().trim();
    target.scoreAmount = toCount(scoreAmount.getData());
    target.tag = tag.getData().trim();
    target.once = once.getData();
    target.command = command.getData().trim();
    setStation(key, station);
  };

  return present(
    player,
    text(tr('craft.admin.recipe.title'), ` - ${recipe.name}`),
    (form, link) => {
      const goBack = link(back);
      form
        .textField(tr('craft.admin.recipe.name'), name)
        .dropdown(
          tr('craft.admin.recipe.shape'),
          shape,
          RECIPE_SHAPES.map((value, index) => ({
            label: tr(`craft.admin.recipe.shape.${value}`),
            value: index,
          })),
        )
        .dropdown(
          tr('craft.admin.recipe.match'),
          mode,
          MATCH_MODES.map((value, index) => ({
            label: tr(`craft.admin.recipe.match.${value}`),
            value: index,
          })),
          { description: tr('craft.admin.recipe.match.description') },
        )
        .toggle(tr('craft.admin.recipe.advanced'), advanced)
        .header(tr('craft.admin.recipe.cost'), visible)
        .textField(tr('craft.admin.recipe.levels'), levels, visible)
        .textField(tr('craft.admin.recipe.score'), scoreObjective, visible)
        .textField(tr('craft.admin.recipe.score.amount'), scoreAmount, visible)
        .header(tr('craft.admin.recipe.conditions'), visible)
        .textField(tr('craft.admin.recipe.tag'), tag, visible)
        .toggle(tr('craft.admin.recipe.once'), once, visible)
        .header(tr('craft.admin.recipe.reward'), visible)
        .textField(tr('craft.admin.recipe.command'), command, {
          ...visible,
          description: tr('craft.admin.recipe.command.description'),
        })
        .divider()
        .button(tr('craft.admin.recipe.save'), () => {
          save();
          goBack();
        })
        .button(tr('craft.admin.recipe.edit'), link(editThen(player, key, recipeId, self)))
        .divider()
        .button(
          tr('craft.admin.recipe.delete'),
          link(() => confirmDelete(player, key, recipeId, recipe.name)),
        )
        .button(tr('craft.admin.back'), goBack);
    },
  );
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
