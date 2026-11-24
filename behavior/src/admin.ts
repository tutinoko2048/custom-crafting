// 管理画面（CustomForm / DDUI）。docs/06-admin-ui.md
//   色一覧 → 色の設定（表示名・レシピ一覧）→ レシピの詳細 → 項目ごとの設定 / 実物エディタ
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
import { MATCH_MODES, RECIPE_SHAPES, type RecipeMeta, toCount } from './recipe';
import { deleteRecipeItems, ensureLoaded, getRecipeItems, getStation, setStation } from './store';
import { tr } from './util';

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;
/** コンテナのタイトルは 256 バイトまで。日本語（1文字3バイト）でも収まる長さにする */
const MAX_NAME_LENGTH = 60;
const WRITABLE = { clientWritable: true };
const NONE = tr('craft.admin.summary.none');

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

// --- 色の設定 ---

/** 色の設定とレシピ一覧。設定は項目ごとのボタンの先で変える（1画面に詰め込まず、スクロールを減らす） */
function stationSettings(player: Player, key: string): Promise<void> {
  const station = getStation(key);
  const self: Screen = () => stationSettings(player, key);

  return present(player, text(tr('craft.admin.title'), ' - ', colorName(key)), (form, link) => {
    form
      .button(
        text(tr('craft.admin.station.name'), '\n§7', station.name || colorName(key)),
        link(() => stationName(player, key)),
      )
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

function stationName(player: Player, key: string): Promise<void> {
  const name = new ObservableString(getStation(key).name, WRITABLE);
  const back: Screen = () => stationSettings(player, key);

  return present(player, tr('craft.admin.station.name'), (form, link) => {
    const goBack = link(back);
    form
      .textField(tr('craft.admin.station.name'), name, {
        description: tr('craft.admin.station.name.description'),
      })
      .divider()
      .button(tr('craft.admin.save'), () => {
        const station = getStation(key);
        station.name = name.getData().trim().slice(0, MAX_NAME_LENGTH);
        setStation(key, station);
        goBack();
      })
      .button(tr('craft.admin.back'), goBack);
  });
}

// --- レシピ ---

const findMeta = (key: string, recipeId: string): RecipeMeta | undefined =>
  getStation(key).recipes.find((entry) => entry.id === recipeId);

/** 一覧のボタンに添える、今の設定の要約 */
function summaries(recipe: RecipeMeta) {
  const join = (parts: (string | UIRawMessage)[]): UIRawMessage =>
    parts.length === 0
      ? NONE
      : text(...parts.flatMap((part, i) => (i > 0 ? [', ', part] : [part])));

  const cost: (string | UIRawMessage)[] = [];
  if (recipe.levels > 0) cost.push(tr('craft.admin.summary.levels', String(recipe.levels)));
  if (recipe.scoreObjective && recipe.scoreAmount > 0) {
    cost.push(`${recipe.scoreObjective} ${recipe.scoreAmount}`);
  }
  const conditions: (string | UIRawMessage)[] = [];
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

  const self: Screen = () => recipeDetail(player, key, recipeId);
  const summary = summaries(recipe);
  const section = (
    label: UIRawMessage,
    value: string | UIRawMessage,
    screen: (player: Player, key: string, recipeId: string) => Promise<void>,
    link: Link,
  ): [UIRawMessage, () => void] => [
    text(label, '\n§7', value),
    link(() => screen(player, key, recipeId)),
  ];

  return present(
    player,
    text(tr('craft.admin.recipe.title'), ` - ${recipe.name}`),
    (form, link) => {
      form
        .button(...section(tr('craft.admin.recipe.basics'), summary.basics, recipeBasics, link))
        .button(...section(tr('craft.admin.recipe.cost'), summary.cost, recipeCost, link))
        .button(
          ...section(
            tr('craft.admin.recipe.conditions'),
            summary.conditions,
            recipeConditions,
            link,
          ),
        )
        .button(...section(tr('craft.admin.recipe.reward'), summary.reward, recipeReward, link))
        .button(tr('craft.admin.recipe.edit'), link(editThen(player, key, recipeId, self)))
        .divider()
        .button(
          tr('craft.admin.recipe.delete'),
          link(() => confirmDelete(player, key, recipeId, recipe.name)),
        )
        .button(
          tr('craft.admin.back'),
          link(() => stationSettings(player, key)),
        );
    },
  );
}

/**
 * レシピの設定を1項目ぶん編集するフォーム。
 * `build` は入力欄を並べ、保存するときに入力をレシピへ書き込む関数を返す。保存しても戻ってもレシピの詳細へ戻る
 */
function recipeSection(
  player: Player,
  key: string,
  recipeId: string,
  title: UIRawMessage,
  build: (form: CustomForm, recipe: RecipeMeta) => (target: RecipeMeta) => void,
): Promise<void> {
  const recipe = findMeta(key, recipeId);
  if (!recipe) return stationSettings(player, key);

  return present(player, text(title, ` - ${recipe.name}`), (form, link) => {
    const apply = build(form, recipe);
    const goBack = link(() => recipeDetail(player, key, recipeId));
    form
      .divider()
      .button(tr('craft.admin.save'), () => {
        const station = getStation(key);
        const target = station.recipes.find((entry) => entry.id === recipeId);
        if (target) {
          apply(target);
          setStation(key, station);
        }
        goBack();
      })
      .button(tr('craft.admin.back'), goBack);
  });
}

const recipeBasics = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.basics'), (form, recipe) => {
    const name = new ObservableString(recipe.name, WRITABLE);
    const shape = new ObservableNumber(RECIPE_SHAPES.indexOf(recipe.shape), WRITABLE);
    const match = new ObservableNumber(MATCH_MODES.indexOf(recipe.match), WRITABLE);
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
        match,
        MATCH_MODES.map((value, index) => ({
          label: tr(`craft.admin.recipe.match.${value}`),
          value: index,
        })),
        { description: tr('craft.admin.recipe.match.description') },
      );
    return (target) => {
      target.name = name.getData().trim().slice(0, MAX_NAME_LENGTH) || target.name;
      target.shape = RECIPE_SHAPES[shape.getData()] ?? target.shape;
      target.match = MATCH_MODES[match.getData()] ?? target.match;
    };
  });

const recipeCost = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.cost'), (form, recipe) => {
    const levels = new ObservableString(String(recipe.levels), WRITABLE);
    const objective = new ObservableString(recipe.scoreObjective, WRITABLE);
    const amount = new ObservableString(String(recipe.scoreAmount), WRITABLE);
    form
      .textField(tr('craft.admin.recipe.levels'), levels)
      .textField(tr('craft.admin.recipe.score'), objective)
      .textField(tr('craft.admin.recipe.score.amount'), amount);
    return (target) => {
      target.levels = toCount(levels.getData());
      target.scoreObjective = objective.getData().trim();
      target.scoreAmount = toCount(amount.getData());
    };
  });

const recipeConditions = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.conditions'), (form, recipe) => {
    const tag = new ObservableString(recipe.tag, WRITABLE);
    const once = new ObservableBoolean(recipe.once, WRITABLE);
    form.textField(tr('craft.admin.recipe.tag'), tag).toggle(tr('craft.admin.recipe.once'), once);
    return (target) => {
      target.tag = tag.getData().trim();
      target.once = once.getData();
    };
  });

const recipeReward = (player: Player, key: string, recipeId: string) =>
  recipeSection(player, key, recipeId, tr('craft.admin.recipe.reward'), (form, recipe) => {
    const command = new ObservableString(recipe.command, WRITABLE);
    form.textField(tr('craft.admin.recipe.command'), command, {
      description: tr('craft.admin.recipe.command.description'),
    });
    return (target) => {
      target.command = command.getData().trim();
    };
  });

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
