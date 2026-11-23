// VirtualContainer の画面（クラフト画面・エディタ）に共通する処理。
// - 画面を開く。開けなかったら少し待ってやり直す
// - UI アイテム（穴埋め・矢印）の持ち出しを監視して元に戻す。docs/05-item-monitoring.md
// - プレイヤーの操作を 1 tick 分まとめて処理する
import {
  type Container,
  ItemStack,
  type Player,
  system,
  type VirtualContainer,
  VirtualContainerCloseReason,
  VirtualContainerOpenError,
  VirtualContainerOpenErrorReason,
  world,
} from '@minecraft/server';
import { UI_ARROW, UI_FILLER } from './constants';
import { ARROW_SLOT, CONTAINER_SIZE, FILLER_SLOTS } from './layout';
import { stashItems } from './store';
import { giveOrDrop, isUiItem, tr } from './util';

export interface SessionSpec {
  /** コンテナのタイトル。言語ファイルのキーでもよい */
  title: string;
  /** 開く前に中身を並べる（UI アイテムは並べ済み） */
  fill?(container: Container): void;
  /**
   * プレイヤーがスロットを変えた（1 tick 分をまとめて呼ぶ）。
   * 画面を閉じた tick に残っていた変更も、onClose の前にここへ届く
   */
  onChange?(session: Session, touched: ReadonlySet<number>): void;
  /** 画面が閉じた。コンテナの中身はまだ読める */
  onClose(session: Session, reason: VirtualContainerCloseReason | 'failed'): void;
}

export interface Session {
  readonly player: Player;
  readonly playerId: string;
  readonly container: VirtualContainer;
  /** プレイヤーにアイテムを渡す。退出済みなら退避して、次に参加したときに返す */
  give(item: ItemStack): void;
}

interface ActiveSession extends Session {
  readonly spec: SessionSpec;
  touched: Set<number>;
  scheduled: boolean;
  retries: number;
  orphans: ItemStack[];
}

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;

/** プレイヤー ID ごとに1つ。コンテナは共有しない */
const sessions = new Map<string, ActiveSession>();

export const hasSession = (player: Player): boolean => sessions.has(player.id);

export function startSession(player: Player, spec: SessionSpec): boolean {
  if (sessions.has(player.id)) return false;

  const container = world.virtualContainerManager.create({
    size: CONTAINER_SIZE,
    title: spec.title,
  });
  for (const slot of FILLER_SLOTS) container.setItem(slot, new ItemStack(UI_FILLER));
  container.setItem(ARROW_SLOT, new ItemStack(UI_ARROW));
  spec.fill?.(container);

  const session: ActiveSession = {
    player,
    playerId: player.id,
    container,
    spec,
    touched: new Set(),
    scheduled: false,
    retries: 0,
    orphans: [],
    give(item) {
      if (player.isValid) giveOrDrop(player, item);
      else this.orphans.push(item);
    },
  };
  sessions.set(session.playerId, session);
  open(session);
  return true;
}

function open(session: ActiveSession): void {
  if (sessions.get(session.playerId) !== session) return;
  if (!session.player.isValid) return finish(session, 'failed');
  try {
    session.container.open(session.player);
  } catch (error) {
    // ほかの画面が閉じきっていないだけなら、少し待ってやり直す
    const retryable =
      error instanceof VirtualContainerOpenError &&
      (error.reason === VirtualContainerOpenErrorReason.ContainerScreenOpen ||
        error.reason === VirtualContainerOpenErrorReason.PlayerNotReady);
    if (retryable && retry(session)) return;
    session.player.sendMessage(tr('craft.msg.open_failed'));
    finish(session, 'failed');
  }
}

function retry(session: ActiveSession): boolean {
  if (session.retries >= MAX_RETRIES) return false;
  session.retries++;
  system.runTimeout(() => open(session), RETRY_TICKS);
  return true;
}

function finish(session: ActiveSession, reason: VirtualContainerCloseReason | 'failed'): void {
  sessions.delete(session.playerId);
  // 閉じた tick に行われた操作（完成品を取ってすぐ閉じた、など）を先に片付ける
  if (session.touched.size > 0) process(session);
  session.spec.onClose(session, reason);
  session.container.clearAll();
  stashItems(session.playerId, session.orphans);

  // 取りこぼした UI アイテムがないか、閉じた後にもう一度だけ見る
  const { player } = session;
  system.run(() => {
    if (player.isValid) purge(player);
  });
}

function schedule(session: ActiveSession): void {
  if (session.scheduled) return;
  session.scheduled = true;
  system.run(() => {
    session.scheduled = false;
    if (sessions.get(session.playerId) === session) process(session);
  });
}

function process(session: ActiveSession): void {
  const touched = session.touched;
  session.touched = new Set();
  restoreUi(session);
  session.spec.onChange?.(session, touched);
  if (session.player.isValid) purge(session.player);
}

/** UI アイテムを元のスロットに戻す。UI スロットに置かれたアイテムはプレイヤーに返す */
function restoreUi(session: ActiveSession): void {
  const { container } = session;
  for (let slot = 0; slot < container.size; slot++) {
    const item = container.getItem(slot);
    const expected = slot === ARROW_SLOT ? UI_ARROW : FILLER_SLOTS.includes(slot) ? UI_FILLER : '';
    if (expected === '') {
      if (isUiItem(item)) container.setItem(slot, undefined);
    } else if (item?.typeId !== expected) {
      if (item && !isUiItem(item)) session.give(item);
      container.setItem(slot, new ItemStack(expected));
    }
  }
}

/** カーソルとインベントリに出た UI アイテムを消す */
function purge(player: Player): void {
  const cursor = player.getComponent('minecraft:cursor_inventory');
  if (isUiItem(cursor?.item)) cursor?.clear();

  // タッチ操作ではカーソルを使わないので、インベントリの走査が唯一の検知手段になる
  const inventory = player.getComponent('minecraft:inventory')?.container;
  if (!inventory) return;
  for (let slot = 0; slot < inventory.size; slot++) {
    if (isUiItem(inventory.getItem(slot))) inventory.setItem(slot, undefined);
  }
}

function sessionOfClosed(player: Player): ActiveSession | undefined {
  try {
    return sessions.get(player.id);
  } catch {
    // PlayerLeft ではプレイヤーが無効になっている
    return [...sessions.values()].find((session) => !session.player.isValid);
  }
}

export function registerSessionEvents(): void {
  world.afterEvents.virtualContainerItemChange.subscribe((event) => {
    const session = sessions.get(event.player.id);
    if (!session) return;
    session.touched.add(event.slot);
    schedule(session);
  });

  world.afterEvents.virtualContainerClose.subscribe((event) => {
    const session = sessionOfClosed(event.player);
    if (!session) return;
    // クライアントが画面を出せなかっただけ（ほかの画面を閉じた直後など）。少し待ってやり直す
    if (event.reason === VirtualContainerCloseReason.UserBusy && retry(session)) return;
    finish(session, event.reason);
  });

  // スロット → カーソル
  world.afterEvents.playerCursorItemGrab.subscribe((event) => {
    const session = sessions.get(event.player.id);
    if (session && isUiItem(event.item)) schedule(session);
  });

  // 画面の外へドラッグしてドロップされた UI アイテム
  world.afterEvents.entitySpawn.subscribe(({ entity }) => {
    if (sessions.size === 0 || !entity.isValid || entity.typeId !== 'minecraft:item') return;
    if (isUiItem(entity.getComponent('minecraft:item')?.itemStack)) entity.remove();
  });
}
