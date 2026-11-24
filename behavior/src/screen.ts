// VirtualContainer の画面（クラフト画面・エディタ）を包むクラス。
// - 画面を開く。開けなかったら少し待ってやり直す
// - 動かせないスロット（穴埋め・矢印などの UI アイテム）を守る。docs/05-item-monitoring.md
// - プレイヤーの操作を 1 tick 分まとめて渡す
// 画面ごとの処理（レシピ判定・保存など）は ScreenSpec のコールバックで受け取る
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
import { clearStash, saveStash } from './store';
import { giveOrDrop, isUiItem, tr } from './util';

export type ScreenCloseReason = VirtualContainerCloseReason | 'failed';

export interface ScreenLayout {
  /** スロット数（9 の倍数、最大 54） */
  readonly size: number;
  /** 動かせないスロットと、そこに置く UI アイテムの ID */
  readonly locked: ReadonlyMap<number, string>;
}

export interface ScreenSpec {
  /** コンテナのタイトル。言語ファイルのキーでもよい */
  title: string;
  layout: ScreenLayout;
  /** 開く前に中身を並べる（動かせないスロットは並べ済み） */
  fill?(container: Container): void;
  /**
   * プレイヤーがスロットを変えた（1 tick 分をまとめて呼ぶ）。
   * 動かせないスロットは元に戻した後だが、触られたことは touched に残る（ボタンに使える）。
   * 画面を閉じた tick に残っていた変更も、onClose の前にここへ届く
   */
  onChange?(screen: ContainerScreen, touched: ReadonlySet<number>): void;
  /** 画面が閉じた。コンテナの中身はまだ読める */
  onClose?(screen: ContainerScreen, reason: ScreenCloseReason): void;
  /**
   * 退出やシャットダウンで閉じても失わないスロット。中身が変わるたびにストラクチャーへ保存し、
   * 正常に閉じたら消す。残っていれば次に参加したときに返す（store.ts の restoreStash）
   */
  stash?: readonly number[];
}

const MAX_RETRIES = 20;
const RETRY_TICKS = 5;

export class ContainerScreen {
  /**
   * プレイヤーごとに1つ。コンテナは共有しない。
   * Player はエンティティごとに同じオブジェクトが返るので、退出して無効になった後も引ける
   */
  private static readonly screens = new WeakMap<Player, ContainerScreen>();
  /** WeakMap は数えられないので、開いている画面の数を別に持つ */
  private static openCount = 0;

  static isOpen(player: Player): boolean {
    return ContainerScreen.screens.has(player);
  }

  /** 画面を開く。すでに開いているときは何もせず undefined を返す */
  static open(player: Player, spec: ScreenSpec): ContainerScreen | undefined {
    if (ContainerScreen.isOpen(player)) return undefined;
    const screen = new ContainerScreen(player, spec);
    ContainerScreen.screens.set(player, screen);
    ContainerScreen.openCount++;
    screen.show();
    return screen;
  }

  readonly container: VirtualContainer;
  /** 画面が閉じ、onClose が終わったら解決する。次の画面へ切り替えるときに待つ */
  readonly closed: Promise<ScreenCloseReason>;

  /** 退出後は player.id を読めないので、開いたときに控えておく */
  private readonly playerId: string;
  private resolveClosed!: (reason: ScreenCloseReason) => void;
  private touched = new Set<number>();
  private scheduled = false;
  private retries = 0;
  /** 動かせないスロットと、今そこに置く UI アイテム。setLocked で画面ごとに差し替えられる */
  private readonly locked: Map<number, string>;

  private constructor(
    readonly player: Player,
    private readonly spec: ScreenSpec,
  ) {
    this.playerId = player.id;
    this.closed = new Promise((resolve) => (this.resolveClosed = resolve));

    const { size } = spec.layout;
    this.locked = new Map(spec.layout.locked);
    this.container = world.virtualContainerManager.create({ size, title: spec.title });
    for (const [slot, typeId] of this.locked) this.container.setItem(slot, new ItemStack(typeId));
    spec.fill?.(this.container);
  }

  /**
   * プレイヤーにアイテムを渡す。
   * 退出済みなら何もしない。stash のスロットの中身は、保存しておいた分を次に参加したときに返す
   */
  give(item: ItemStack): void {
    if (this.player.isValid) giveOrDrop(this.player, item);
  }

  /**
   * 動かせないスロットの UI アイテムを差し替える（条件を満たしたときだけボタンを出す、など）。
   * レイアウトで動かせないスロットにしたものだけが対象
   */
  setLocked(slot: number, typeId: string): void {
    if (!this.locked.has(slot) || this.locked.get(slot) === typeId) return;
    this.locked.set(slot, typeId);
    this.container.setItem(slot, new ItemStack(typeId));
  }

  private get active(): boolean {
    return ContainerScreen.screens.get(this.player) === this;
  }

  private show(): void {
    if (!this.active) return;
    if (!this.player.isValid) return this.finish('failed');
    try {
      this.container.open(this.player);
    } catch (error) {
      // ほかの画面が閉じきっていないだけなら、少し待ってやり直す
      const retryable =
        error instanceof VirtualContainerOpenError &&
        (error.reason === VirtualContainerOpenErrorReason.ContainerScreenOpen ||
          error.reason === VirtualContainerOpenErrorReason.PlayerNotReady);
      if (retryable && this.retry()) return;
      this.player.sendMessage(tr('craft.msg.open_failed'));
      this.finish('failed');
    }
  }

  private retry(): boolean {
    if (this.retries >= MAX_RETRIES) return false;
    this.retries++;
    system.runTimeout(() => this.show(), RETRY_TICKS);
    return true;
  }

  private finish(reason: ScreenCloseReason): void {
    if (ContainerScreen.screens.delete(this.player)) ContainerScreen.openCount--;
    // 閉じた tick に行われた操作（完成品を取ってすぐ閉じた、など）を先に片付ける
    if (this.touched.size > 0) this.flush();
    try {
      this.spec.onClose?.(this, reason);
    } finally {
      this.container.clearAll();
      // 中身をプレイヤーに返したので、保存していた分は要らない。
      // 退出したプレイヤーには返せていないので、保存した分を残して次の参加時に返す
      if (this.spec.stash && this.player.isValid) clearStash(this.playerId);
      this.resolveClosed(reason);
    }

    // 取りこぼした UI アイテムがないか、閉じた後にもう一度だけ見る
    const { player } = this;
    system.run(() => {
      if (player.isValid) purge(player);
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    system.run(() => {
      this.scheduled = false;
      if (this.active) this.flush();
    });
  }

  private flush(): void {
    const { touched } = this;
    this.touched = new Set();
    this.restoreLocked();
    this.spec.onChange?.(this, touched);
    if (!this.player.isValid) return;
    purge(this.player);
    this.saveStash();
  }

  /** stash のスロットの今の中身を保存する。完成品を取って材料が減ったときも、ここで反映される */
  private saveStash(): void {
    const { stash } = this.spec;
    if (stash)
      saveStash(
        this.player,
        stash.map((slot) => this.container.getItem(slot)),
      );
  }

  /** 動かせないスロットを元に戻す。そこに置かれたアイテムはプレイヤーに返す */
  private restoreLocked(): void {
    const { container, locked } = this;
    for (let slot = 0; slot < container.size; slot++) {
      const item = container.getItem(slot);
      const expected = locked.get(slot);
      if (expected === undefined) {
        if (isUiItem(item)) container.setItem(slot, undefined);
      } else if (item?.typeId !== expected) {
        if (item && !isUiItem(item)) this.give(item);
        container.setItem(slot, new ItemStack(expected));
      }
    }
  }

  static registerEvents(): void {
    const { screens } = ContainerScreen;

    world.afterEvents.virtualContainerItemChange.subscribe((event) => {
      const screen = screens.get(event.player);
      if (!screen) return;
      screen.touched.add(event.slot);
      screen.schedule();
    });

    // PlayerLeft ではプレイヤーが無効になっているが、オブジェクトで引くので見つかる
    world.afterEvents.virtualContainerClose.subscribe((event) => {
      const screen = screens.get(event.player);
      if (!screen) return;
      // クライアントが画面を出せなかっただけ（ほかの画面を閉じた直後など）。少し待ってやり直す
      if (event.reason === VirtualContainerCloseReason.UserBusy && screen.retry()) return;
      screen.finish(event.reason);
    });

    // スロット → カーソル
    world.afterEvents.playerCursorItemGrab.subscribe((event) => {
      const screen = screens.get(event.player);
      if (screen && isUiItem(event.item)) screen.schedule();
    });

    // 画面の外へドラッグしてドロップされた UI アイテム
    world.afterEvents.entitySpawn.subscribe(({ entity }) => {
      if (ContainerScreen.openCount === 0) return;
      if (!entity.isValid || entity.typeId !== 'minecraft:item') return;
      if (isUiItem(entity.getComponent('minecraft:item')?.itemStack)) entity.remove();
    });
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
