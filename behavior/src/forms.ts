// 管理画面で使うフォームの部品（ActionForm / ModalForm / MessageForm）。docs/06-admin-ui.md
import { type Player, type RawMessage, system } from '@minecraft/server';
import { ActionFormData, FormCancelationReason, type FormResponse } from '@minecraft/server-ui';

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;

export type Message = string | RawMessage;
export type Screen = () => Promise<void>;

export const text = (...parts: Message[]): RawMessage => ({
  rawtext: parts.map((part) => (typeof part === 'string' ? { text: part } : part)),
});

/** ボタンのラベル。2行目に今の設定などを灰色で添える */
export const twoLines = (label: Message, detail: Message): RawMessage =>
  text(label, '\n§8', detail);

/** 行を改行でつなぐ（ActionForm の本文など） */
export const lines = (...parts: Message[]): RawMessage =>
  text(...parts.flatMap((part, i) => (i > 0 ? ['\n', part] : [part])));

/** ボタンのアイコン（バニラのテクスチャ） */
export const ICON = {
  name: 'textures/items/name_tag',
  gridSize: 'textures/blocks/crafting_table_top',
  recipe: 'textures/items/paper',
  add: 'textures/items/book_writable',
  back: 'textures/items/arrow',
  basics: 'textures/items/sign',
  cost: 'textures/items/experience_bottle',
  conditions: 'textures/blocks/barrier',
  reward: 'textures/items/nether_star',
  edit: 'textures/blocks/crafting_table_front',
  delete: 'textures/blocks/tnt_side',
  storage: 'textures/blocks/barrel_side',
  cleanup: 'textures/items/bucket_empty',
  stash: 'textures/items/bundle',
  player: 'textures/items/totem',
} as const;

/**
 * フォームを表示する。ほかの画面が開いていて表示できなかった（UserBusy）ときは、少し待ってやり直す。
 * 閉じられたら undefined
 */
export async function ask<R extends FormResponse>(
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

/** ActionForm の1行。ボタンか、区切り・ラベル（header は文字が大きすぎるので使わない） */
export type Entry =
  | { button: Message; icon?: string; next: Screen }
  | { label: Message }
  | 'divider';

/** ボタンの一覧を表示し、押されたボタンの画面を開く。閉じられたら何もしない */
export async function menu(
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

export const run = (screen: Promise<void>): void => {
  screen.catch((error: unknown) => console.warn(`[custom-crafting] admin form: ${String(error)}`));
};
