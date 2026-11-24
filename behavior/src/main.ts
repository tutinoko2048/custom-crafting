import {
  CommandPermissionLevel,
  type CustomCommandOrigin,
  CustomCommandParamType,
  type CustomCommandResult,
  CustomCommandStatus,
  Player,
  system,
  world,
} from '@minecraft/server';
import { openAdmin } from './admin';
import {
  COLORS,
  isColor,
  NAMESPACE,
  stationKey,
  stationKeyOfBlock,
  WORKBENCH_COMPONENT,
} from './constants';
import { openStation } from './crafting';
import { ContainerScreen } from './screen';
import { ensureLoaded, restoreStash } from './store';
import { type LangKey, tr } from './util';

const COLOR_ENUM = `${NAMESPACE}:color`;

const failure = (key: LangKey): CustomCommandResult => ({
  status: CustomCommandStatus.Failure,
  message: tr(key),
});

const report = (error: unknown): void => console.warn(`[custom-crafting] ${String(error)}`);

/** `/craft:open <color> [target]`：指定した色の作業台を開く。docs/03-commands.md */
function openCommand(
  origin: CustomCommandOrigin,
  color: string,
  targets?: Player[],
): CustomCommandResult {
  if (!isColor(color)) return failure('craft.cmd.unknown_color');
  // NPC からは会話を始めたプレイヤー、それ以外は実行者自身を既定の対象にする
  const source = origin.initiator ?? origin.sourceEntity;
  const players = targets ?? (source instanceof Player ? [source] : []);
  if (players.length === 0) return failure('craft.cmd.no_target');

  // callback は制限付き実行モードで動くので、画面を開くのは次の tick に回す
  system.run(() => {
    for (const player of players) {
      if (player.isValid) openStation(player, stationKey(color)).catch(report);
    }
  });
  return { status: CustomCommandStatus.Success };
}

/** `/craft:admin [color]`：管理画面を開く */
function adminCommand(origin: CustomCommandOrigin, color?: string): CustomCommandResult {
  const player = origin.sourceEntity;
  if (!(player instanceof Player)) return failure('craft.cmd.player_only');
  if (color !== undefined && !isColor(color)) return failure('craft.cmd.unknown_color');

  system.run(() => {
    if (player.isValid) openAdmin(player, color === undefined ? undefined : stationKey(color));
  });
  return { status: CustomCommandStatus.Success };
}

system.beforeEvents.startup.subscribe(({ blockComponentRegistry, customCommandRegistry }) => {
  // 16色の作業台ブロックに共通の右クリック処理
  blockComponentRegistry.registerCustomComponent(WORKBENCH_COMPONENT, {
    onPlayerInteract({ block, player }) {
      const key = stationKeyOfBlock(block.typeId);
      if (player && key !== undefined) openStation(player, key).catch(report);
    },
  });

  customCommandRegistry.registerEnum(COLOR_ENUM, [...COLORS]);

  customCommandRegistry.registerCommand(
    {
      name: `${NAMESPACE}:open`,
      description: 'craft.cmd.open.description' satisfies LangKey,
      permissionLevel: CommandPermissionLevel.GameDirectors,
      // チート OFF の配布マップでも、コマンドブロックや NPC から開けるようにする
      cheatsRequired: false,
      mandatoryParameters: [
        { name: 'color', type: CustomCommandParamType.Enum, enumName: COLOR_ENUM },
      ],
      optionalParameters: [{ name: 'target', type: CustomCommandParamType.PlayerSelector }],
    },
    openCommand,
  );

  customCommandRegistry.registerCommand(
    {
      name: `${NAMESPACE}:admin`,
      description: 'craft.cmd.admin.description' satisfies LangKey,
      // Admin はBDSではサーバーコンソールしか持たず、OP でも実行できないので GameDirectors にする。
      // コマンドブロックからも呼べるが、callback 側でプレイヤー以外を弾く
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [
        { name: 'color', type: CustomCommandParamType.Enum, enumName: COLOR_ENUM },
      ],
    },
    adminCommand,
  );
});

world.afterEvents.worldLoad.subscribe(() => {
  ContainerScreen.registerEvents();
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  // レシピのアイテムは、最初のプレイヤーが参加したときにワールドから読み込む
  ensureLoaded(player)
    // 前回、画面を開いたまま退出したときに退避したアイテムを返す
    .then(() => (player.isValid ? restoreStash(player) : 0))
    .then((count) => {
      if (count > 0 && player.isValid) player.sendMessage(tr('craft.msg.stash_returned'));
    })
    .catch(report);
});
