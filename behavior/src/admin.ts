// 管理画面（ActionForm / ModalForm）。docs/06-admin-ui.md
//   色一覧 → 色の設定（表示名・レシピ一覧）→ レシピの詳細 → 項目ごとの設定 / 実物エディタ
// 一覧と目次は ActionForm（ボタンに改行と色コードが使える）、入力は ModalForm にする
import { type Player, type RawMessage, system } from '@minecraft/server';
import {
  ActionFormData,
  FormCancelationReason,
  type FormResponse,
  MessageFormData,
  ModalFormData,
} from '@minecraft/server-ui';
import { type Color, COLORS, stationColor, stationKey } from './constants';
import { openEditor } from './editor';
import { MATCH_MODES, RECIPE_SHAPES, type RecipeMeta, toCount } from './recipe';
import { deleteRecipeItems, ensureLoaded, getRecipeItems, getStation, setStation } from './store';
import { tr } from './util';

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;
/** コンテナのタイトルは 256 バイトまで。日本語（1文字3バイト）でも収まる長さにする */
const MAX_NAME_LENGTH = 60;
const NONE = tr('craft.admin.summary.none');

type Message = string | RawMessage;

const text = (...parts: Message[]): RawMessage => ({
  rawtext: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
});

/** ボタンのラベル。2行目に今の設定などを灰色で添える */
const twoLines = (label: Message, detail: Message): RawMessage => text(label, '\n§8', detail);

type Screen = () => Promise<void>;

/**
 * フォームを表示する。ほかの画面が開いていて表示できなかった（UserBusy）ときは、少し待ってやり直す。
 * 閉じられたら undefined
 */
async function ask<R extends FormResponse>(
  player: Player,
  form: { show(player: Player): Promise<R> },
): Promise<R | undefined> {
  for (let attempt = 0; attempt < MAX_RETRIES && player.isValid; attempt++) {
    const response = await form.show(player);
    if (response.cancelationReason === FormCancelationReason.UserBusy) {
      await system.waitTicks(RETRY_TICKS);
      continue;
    }
    return response.canceled ? undefined : response;
  }
  return undefined;
}

/** ボタンのアイコン（バニラのテクスチャ） */
const ICON = {
  name: 'textures/items/name_tag',
  recipe: 'textures/items/paper',
  add: 'textures/items/book_writable',
  back: 'textures/items/arrow',
  basics: 'textures/items/sign',
  cost: 'textures/items/experience_bottle',
  conditions: 'textures/blocks/barrier',
  reward: 'textures/items/nether_star',
  edit: 'textures/blocks/crafting_table_front',
  delete: 'textures/blocks/tnt_side',
} as const;

/** 色の羊毛。ライトグレーだけテクスチャ名が silver */
const woolIcon = (color: Color): string =>
  `textures/blocks/wool_colored_${color === 'light_gray' ? 'silver' : color}`;

/** ActionForm の1行。ボタンか、区切り・ラベル（header は文字が大きすぎるので使わない） */
type Entry = { button: Message; icon?: string; next: Screen } | { label: Message } | 'divider';

/** ボタンの一覧を表示し、押されたボタンの画面を開く。閉じられたら何もしない */
async function menu(
  player: Player,
  title: Message,
  entries: Entry[],
  body?: Message,
): Promise<void> {
  const form = new ActionFormData().title(title);
  if (body !== undefined) form.body(body);
  const screens: Screen[] = [];
  for (const entry of entries) {
    if (entry === 'divider') form.divider();
    else if ('label' in entry) form.label(entry.label);
    else {
      form.button(entry.button, entry.icon);
      screens.push(entry.next);
    }
  }
  const response = await ask(player, form);
  // selection はボタンだけを数えた番号
  const next = response?.selection === undefined ? undefined : screens[response.selection];
  return next?.();
}

const run = (screen: Promise<void>): void => {
  screen.catch((error: unknown) => console.warn(`[custom-crafting] admin form: ${String(error)}`));
};

/** 実物エディタを開き、閉じたら `back` に進む。`back` には保存したレシピの ID（保存しなかったら undefined）を渡す */
const editThen =
  (
    player: Player,
    key: string,
    recipeId: string | undefined,
    back: (saved: string | undefined) => Promise<void>,
  ): Screen =>
  () =>
    openEditor(player, key, recipeId).then(back);

export function openAdmin(player: Player, key?: string): void {
  run(
    ensureLoaded(player).then(() =>
      key === undefined ? colorList(player) : stationSettings(player, key),
    ),
  );
}

const colorName = (key: string): RawMessage => tr(`craft.color.${stationColor(key) ?? 'white'}`);

/** 16色の設定状況 */
function colorList(player: Player): Promise<void> {
  const entries: Entry[] = COLORS.map((color) => {
    const key = stationKey(color);
    const station = getStation(key);
    const count = ` (${station.recipes.length})`;
    return {
      button: station.name
        ? twoLines(text(colorName(key), count), station.name)
        : text(colorName(key), count),
      icon: woolIcon(color),
      next: () => stationSettings(player, key),
    };
  });
  return menu(player, tr('craft.admin.title'), entries, tr('craft.admin.colors.body'));
}

// --- 色の設定 ---

/** 色の設定とレシピ一覧。設定は項目ごとのボタンの先で変える */
function stationSettings(player: Player, key: string): Promise<void> {
  const station = getStation(key);
  const self: Screen = () => stationSettings(player, key);

  return menu(player, text(tr('craft.admin.title'), ' - ', colorName(key)), [
    {
      button: twoLines(tr('craft.admin.station.name'), station.name || colorName(key)),
      icon: ICON.name,
      next: () => stationName(player, key),
    },
    'divider',
    { label: tr('craft.admin.recipes') },
    ...station.recipes.map((recipe) => ({
      // アイテムを読み込めなかったレシピは使えないので、印を付ける
      button: getRecipeItems(recipe.id) ? recipe.name : `§c${recipe.name} (!)`,
      icon: ICON.recipe,
      next: () => recipeDetail(player, key, recipe.id),
    })),
    {
      button: tr('craft.admin.recipes.add'),
      icon: ICON.add,
      // 登録できたら、そのままそのレシピの設定へ進む
      next: editThen(player, key, undefined, (saved) =>
        saved === undefined ? self() : recipeDetail(player, key, saved),
      ),
    },
    'divider',
    { button: tr('craft.admin.back'), icon: ICON.back, next: () => colorList(player) },
  ]);
}

async function stationName(player: Player, key: string): Promise<void> {
  const form = new ModalFormData()
    .title(tr('craft.admin.station.name'))
    .textField(tr('craft.admin.station.name'), colorName(key), {
      defaultValue: getStation(key).name,
      tooltip: tr('craft.admin.station.name.description'),
    })
    .submitButton(tr('craft.admin.save'));
  const values = (await ask(player, form))?.formValues;
  if (values) {
    const station = getStation(key);
    station.name = String(values[0] ?? '')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    setStation(key, station);
  }
  return stationSettings(player, key);
}

// --- レシピ ---

const findMeta = (key: string, recipeId: string): RecipeMeta | undefined =>
  getStation(key).recipes.find((entry) => entry.id === recipeId);

/** 目次のボタンに添える、今の設定の要約 */
function summaries(recipe: RecipeMeta) {
  const join = (parts: Message[]): RawMessage =>
    parts.length === 0
      ? NONE
      : text(...parts.flatMap((part, i) => (i > 0 ? [', ', part] : [part])));

  const cost: Message[] = [];
  if (recipe.levels > 0) cost.push(tr('craft.admin.summary.levels', String(recipe.levels)));
  if (recipe.scoreObjective && recipe.scoreAmount > 0) {
    cost.push(`${recipe.scoreObjective} ${recipe.scoreAmount}`);
  }
  const conditions: Message[] = [];
  if (recipe.tag) conditions.push(tr('craft.admin.summary.tag', recipe.tag));
  if (recipe.once) conditions.push(tr('craft.admin.recipe.once'));
  const command = recipe.command.length > 40 ? `${recipe.command.slice(0, 40)}…` : recipe.command;

  return {
    basics: text(
      tr(`craft.admin.recipe.shape.${recipe.shape}`),
      ' / ',
      tr(`craft.admin.recipe.match.${recipe.match}`),
    ),
    cost: join(cost),
    conditions: join(conditions),
    reward: command || NONE,
  };
}

/** レシピの詳細。項目ごとのボタンに今の設定を添え、押すとその項目だけのフォームを開く */
function recipeDetail(player: Player, key: string, recipeId: string): Promise<void> {
  const recipe = findMeta(key, recipeId);
  if (!recipe) return stationSettings(player, key);

  const summary = summaries(recipe);
  const section = (
    label: Message,
    value: Message,
    icon: string,
    screen: (player: Player, key: string, recipeId: string) => Promise<void>,
  ): Entry => ({ button: twoLines(label, value), icon, next: () => screen(player, key, recipeId) });

  return menu(player, text(tr('craft.admin.recipe.title'), ` - ${recipe.name}`), [
    section(tr('craft.admin.recipe.basics'), summary.basics, ICON.basics, recipeBasics),
    section(tr('craft.admin.recipe.cost'), summary.cost, ICON.cost, recipeCost),
    section(
      tr('craft.admin.recipe.conditions'),
      summary.conditions,
      ICON.conditions,
      recipeConditions,
    ),
    section(tr('craft.admin.recipe.reward'), summary.reward, ICON.reward, recipeReward),
    {
      button: tr('craft.admin.recipe.edit'),
      icon: ICON.edit,
      next: editThen(player, key, recipeId, () => recipeDetail(player, key, recipeId)),
    },
    'divider',
    {
      button: tr('craft.admin.recipe.delete'),
      icon: ICON.delete,
      next: () => confirmDelete(player, key, recipeId, recipe.name),
    },
    { button: tr('craft.admin.back'), icon: ICON.back, next: () => stationSettings(player, key) },
  ]);
}

type FormValues = readonly (boolean | number | string | undefined)[];

/**
 * レシピの設定を1項目ぶん編集するフォーム。
 * `build` は入力欄を並べ（入力欄だけにする。見出しなどを挟むと formValues の番号がずれうる）、
 * 送信された値をレシピへ書き込む関数を返す。送信しても閉じてもレシピの詳細へ戻る
 */
async function recipeSection(
  player: Player,
  key: string,
  recipeId: string,
  title: RawMessage,
  build: (
    form: ModalFormData,
    recipe: RecipeMeta,
  ) => (values: FormValues, target: RecipeMeta) => void,
): Promise<void> {
  const recipe = findMeta(key, recipeId);
  if (!recipe) return stationSettings(player, key);

  const form = new ModalFormData().title(text(title, ` - ${recipe.name}`));
  const apply = build(form, recipe);
  form.submitButton(tr('craft.admin.save'));

  const values = (await ask(player, form))?.formValues;
  if (values) {
    const station = getStation(key);
    const target = station.recipes.find((entry) => entry.id === recipeId);
    if (target) {
      apply(values, target);
      setStation(key, station);
    }
  }
  return recipeDetail(player, key, recipeId);
}

const asString = (value: FormValues[number]): string => (typeof value === 'string' ? value : '');
const asIndex = (value: FormValues[number]): number => (typeof value === 'number' ? value : -1);

const recipeBasics = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.basics'), (form, recipe) => {
    form
      .textField(tr('craft.admin.recipe.name'), recipe.name, { defaultValue: recipe.name })
      .dropdown(
        tr('craft.admin.recipe.shape'),
        RECIPE_SHAPES.map((value) => tr(`craft.admin.recipe.shape.${value}`)),
        { defaultValueIndex: RECIPE_SHAPES.indexOf(recipe.shape) },
      )
      .dropdown(
        tr('craft.admin.recipe.match'),
        MATCH_MODES.map((value) => tr(`craft.admin.recipe.match.${value}`)),
        {
          defaultValueIndex: MATCH_MODES.indexOf(recipe.match),
          tooltip: tr('craft.admin.recipe.match.description'),
        },
      );
    return ([name, shape, match], target) => {
      target.name = asString(name).trim().slice(0, MAX_NAME_LENGTH) || target.name;
      target.shape = RECIPE_SHAPES[asIndex(shape)] ?? target.shape;
      target.match = MATCH_MODES[asIndex(match)] ?? target.match;
    };
  });

const recipeCost = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.cost'), (form, recipe) => {
    form
      .textField(tr('craft.admin.recipe.levels'), '0', { defaultValue: String(recipe.levels) })
      .textField(tr('craft.admin.recipe.score'), 'money', { defaultValue: recipe.scoreObjective })
      .textField(tr('craft.admin.recipe.score.amount'), '0', {
        defaultValue: String(recipe.scoreAmount),
      });
    return ([levels, objective, amount], target) => {
      target.levels = toCount(levels);
      target.scoreObjective = asString(objective).trim();
      target.scoreAmount = toCount(amount);
    };
  });

const recipeConditions = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.conditions'), (form, recipe) => {
    form
      .textField(tr('craft.admin.recipe.tag'), 'quest_2_clear', { defaultValue: recipe.tag })
      .toggle(tr('craft.admin.recipe.once'), { defaultValue: recipe.once });
    return ([tag, once], target) => {
      target.tag = asString(tag).trim();
      target.once = once === true;
    };
  });

const recipeReward = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.reward'), (form, recipe) => {
    form.textField(tr('craft.admin.recipe.command'), 'function quest/stage3', {
      defaultValue: recipe.command,
      tooltip: tr('craft.admin.recipe.command.description'),
    });
    return ([command], target) => {
      target.command = asString(command).trim();
    };
  });

/** 削除の確認。button1（selection 0）を削除、button2 をキャンセルにする */
async function confirmDelete(
  player: Player,
  key: string,
  recipeId: string,
  recipeName: string,
): Promise<void> {
  const form = new MessageFormData()
    .title(tr('craft.admin.recipe.delete'))
    .body(tr('craft.admin.recipe.delete.confirm', recipeName))
    .button1(text('§c', tr('craft.admin.recipe.delete')))
    .button2(tr('craft.admin.cancel'));
  const response = await ask(player, form);
  // 閉じられたときやキャンセルは消さずに詳細へ戻る
  if (response?.selection !== 0) return recipeDetail(player, key, recipeId);

  const station = getStation(key);
  station.recipes = station.recipes.filter((entry) => entry.id !== recipeId);
  setStation(key, station);
  deleteRecipeItems(recipeId);
  return stationSettings(player, key);
}
