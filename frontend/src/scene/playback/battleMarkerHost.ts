// 战场快捷标记宿主接线（playbackScene.js 标记段出仓；源码行预算回归 1500）。
// 语义/生命周期/fail-closed 判据见 markerRuntime 模块头：**回放时钟窗口状态**
// （update(T) 幂等重算，暂停冻结、倒带重现、播过窗口消失）。
// 数据面 = markers（0x2e，上游 v0.5.4）+ attention_to_cell 指令（0x2f，v0.5.3）。
import type { Scene } from 'three'
import type { RuntimeVehicle, VehicleRuntimeHandle } from './vehicleRuntime.js'
import { tankNamesStatic } from '../replaySource.js'
import { createMarkerRuntime, type MarkerData, type MarkerRuntimeHandle } from './markerRuntime.js'

export interface BattleMarkerHostDeps {
  getScene: () => Scene
  /** 世界事实（贴地高度 groundY + 语义档案 key mapKey，扇区 join 用）。 */
  mapWorld: { groundY(x: number, z: number): number; mapKey(): string | null }
  /** 车辆运行时句柄面（目标可见位姿 + 名册 def 来源标注）。 */
  vehicles: VehicleRuntimeHandle
  /** 历史在场事实（AoI 在场段语义；help ping 发令时刻采样 gate 用）。 */
  visibleAt: (v: RuntimeVehicle, t: number) => boolean
  /** 身份接管判据（同账号换 eid：旧实体在接管时刻后不再代表该玩家）。 */
  replacedAt: (eid: number, t: number) => boolean
  getT: () => number
  /** 会话回放数据（markers + chat_events；sessionLifecycle.buildMarkers 经它重建事件源）。 */
  getData: () => MarkerData | null
  invalidate: () => void
}

export type BattleMarkerHost = MarkerRuntimeHandle & { buildMarkers(): void }

export function createBattleMarkerHost(deps: BattleMarkerHostDeps): BattleMarkerHost {
  const { mapWorld, vehicles } = deps
  // 车型名表（tank_cache，与 replaySource.enrichPlayback 同源）：标注侧占位名纪律与
  // 事件流同一套（tank_<id> 不得上 UI，回落昵称）——异步装载，迟到只影响其到达前
  // spawn 的标注文案。
  const tankNames = new Map<number, string>()
  tankNamesStatic().then((m) => { for (const [id, name] of m) tankNames.set(id, name); }).catch(() => {})
  const runtime = createMarkerRuntime({
    getScene: deps.getScene,
    groundY: (x, z) => mapWorld.groundY(x, z),
    getVehiclePose: (eid, t, out) => {
      const v = vehicles.getVehicles().find((x) => x.def.eid === eid);
      if (!v || !v.group.visible) return false;
      vehicles.posAt(v, t, out);
      return true;
    },
    // help ping 的发令时刻采样：历史位姿 + 历史在场判断（当前帧 group.visible 不参与——
    // 评审 P2：播放/跳转/倒带必须画出同一位置）
    getPoseAt: (eid, t, out) => {
      const v = vehicles.getVehicles().find((x) => x.def.eid === eid);
      if (!v || !deps.visibleAt(v, t)) return false;
      vehicles.posAt(v, t, out);
      return true;
    },
    // 来源标注（0x2e 的 entity_id/account_id → 名册 def；eid 优先、account 兜底；
    // def 的 nickname 已由解析管线富化，tank_name 占位名纪律见 markerSourceCard）
    describeSource: (eid, accountId, t) => {
      const vs = vehicles.getVehicles();
      const exact = eid ? vs.find((x) => x.def.eid === eid) : undefined;
      if (exact) return exact.def;
      if (!accountId) return null;
      // 账号兜底：指令/事件时刻的活动实体（同名多实体由 replacedAt + visibleAt 收口；
      // 缺时间证据时保持旧行为——取首个账号实体）
      if (t == null) return vs.find((x) => x.def.account_id === accountId)?.def ?? null;
      return resolveActiveAccount(vs, accountId, t, deps.visibleAt, deps.replacedAt)?.def ?? null;
    },
    // 0x2f 指令 sender 昵称联名册（attention_to_cell 卡片的玩家+坦克行）。
    // 同名多实体（AoI 重入 / 复活换 eid）按**指令时刻在场**解析（评审 P2）；不在场 fail-closed 出 null。
    findByNickname: (nickname, t) => resolveActiveSender(vehicles.getVehicles(), deps.visibleAt, (x) => x.def.nickname, nickname, t ?? Number.NEGATIVE_INFINITY)?.def ?? null,
    tankNameOf: (tankId) => tankNames.get(tankId),
    getT: deps.getT,
    invalidate: deps.invalidate,
  })

  return { ...runtime, buildMarkers: () => runtime.buildSession(deps.getData(), mapWorld.mapKey()) }
}

/**
 * 账号兜底的活动实体解析（指令时刻）：同账号在 AoI 重入/复活后换 eid 时名册同时保留
 * 新旧实体。先排除已被后继接管的旧实体（canonical 身份证据 / coverage 段序回退，
 * 见 playback/identity.ts），再取该时刻在场的那一个；接管前倒带仍解析旧实体，
 * 全部不可用 → null（fail-closed，不把旧 eid 固定到事件上）。
 */
export function resolveActiveAccount<V extends { def: { eid: number; account_id?: number | null } }>(
  vehicles: readonly V[],
  accountId: number,
  t: number,
  visibleAt: (v: V, t: number) => boolean,
  replacedAt: (eid: number, t: number) => boolean,
): V | null {
  const same = vehicles.filter((v) => v.def.account_id === accountId)
  if (same.length === 0) return null
  const active = same.filter((v) => !replacedAt(v.def.eid, t))
  const visible = active.filter((v) => visibleAt(v, t))
  return visible[0] ?? active[0] ?? null
}

/**
 * 指令 sender 的活动实体解析（评审 P2）：同一玩家 AoI 重入 / 复活后名册会同时保留新旧
 * eid（昵称相同），按**指令时刻在场**取实体——播放、跳转、倒带都落在同一辆车上；
 * 指令时刻不在场 fail-closed 出 null（该指令仅进滚动流，不出卡）。
 */
/** 指令 sender 的活动实体解析（评审 P2）：同一玩家 AoI 重入 / 复活后名册会同时保留新旧
 *  eid（昵称相同），按**指令时刻在场**取实体——播放、跳转、倒带都落在同一辆车上；
 *  指令时刻不在场 fail-closed 出 null（该指令仅进滚动流，不出卡）。 */
export function resolveActiveSender<V>(
  vehicles: readonly V[],
  visibleAt: (vehicle: V, t: number) => boolean,
  nicknameOf: (vehicle: V) => string | undefined,
  nickname: string,
  t: number,
): V | null {
  return vehicles.filter((v) => nicknameOf(v) === nickname).find((v) => visibleAt(v, t)) ?? null
}
