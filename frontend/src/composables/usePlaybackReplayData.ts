import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { createReloadStateResolver, magazineSizeForVehicle } from '../scene/reloadBar.js'
import { assetProvider } from '../scene/assetProvider.js'
import { consumableRuntimeAt } from '../utils/consumableRuntime.js'
import { observedFreezeTimeAt } from '../utils/battlePlaybackV2.js'
import { poseCoveredAt, selectActiveDef, sampleVehiclePoseGame } from '../replay-local/pose/vehiclePose.js'
import { activeTerrainRelief, projectTerrainPoint, unprojectTerrainPoint } from '../utils/terrainReliefProjection.js'
import type { BattlePlaybackDataset, PlaybackReloadTelemetry, VehiclePlaybackTrack } from '../types/playback-v2.js'
import type { PlaybackMapViewLike } from './usePlaybackCamera.js'
import type { PoseFacet, PoseFacetVehicle } from '../replay-local/pose/vehiclePose.js'

/** 位姿通道查询面：canonical `poseFacet` + 回放时钟偏移的宿主消费形状。 */
interface PoseSource {
  grid: { tStart: number; samples: number }
  offset: number
  defFor: (accountId: number, t: number) => PoseFacet['vehicles'][number] | null
}

/**
 * 2D 回放数据源与位姿/弹药投影（#820 Agent C 拆分）：
 * canonical track 索引、位姿通道（与 3D 同源同插值）、reload/consumable resolver、
 * 地形起伏语义投影的唯一 owner。不持有播放时间（currentTime 由调用方注入查询）。
 */
export function usePlaybackReplayData(
  mapView: Ref<PlaybackMapViewLike>,
  deps: {
    playback: ComputedRef<BattlePlaybackDataset | null>
    /** V2 canonical dataset（reload/pose 消费源）。 */
    playbackV2: () => BattlePlaybackDataset | null
    reloadTelemetry: () => PlaybackReloadTelemetry | null
    poseFacet: () => PoseFacet | null
    clockOffset: () => number | null
    /** 当前地图元数据（mapCode 用于地形模型匹配）。 */
    mapCode: () => unknown
  },
) {
  const reloadStateAt = computed(() => createReloadStateResolver(deps.reloadTelemetry()))
  const reloadVehiclesByAccount = computed(() => {
    const byAccount = new Map<number, PlaybackReloadTelemetry['vehicles'][number] | null>()
    for (const vehicle of deps.reloadTelemetry()?.vehicles || []) {
      // Ambiguous entity identity is unknown; do not combine two independent gun timelines.
      if (byAccount.has(vehicle.account_id)) byAccount.set(vehicle.account_id, null)
      else byAccount.set(vehicle.account_id, vehicle)
    }
    return byAccount
  })

  // 弹容 N 的配置联表源（tank_id → tank/{id}.json）：实际搭载配置三级证据链
  // （comp locals → 发射弹种 → 初始血量，见 reloadBar.resolveMountedConfig）消费；
  // 异步就绪后整体替换触发响应式重算。竞态令牌：快速切换战局时过期完成不得覆盖。
  const tankConfigs = ref(new Map())
  let tankConfigsToken = 0
  watch(() => deps.reloadTelemetry(), async (telemetry) => {
    const token = ++tankConfigsToken
    tankConfigs.value = new Map()
    if (!telemetry || !assetProvider.configured()) return
    const ids = new Set<number>(telemetry.vehicles
      .filter(v => v.team === telemetry.friendlyTeam && v.tank_id > 0)
      .map(v => v.tank_id))
    const entries = await Promise.all([...ids].map(async (tid): Promise<[number, unknown]> => {
      try { return [tid, await assetProvider.json(`/tank/${tid}.json`)] }
      catch { return [tid, null] }
    }))
    if (token !== tankConfigsToken) return
    tankConfigs.value = new Map(entries)
  }, { immediate: true })

  function vehicleReloadAt(accountId: number, time: number) {
    const telemetry = deps.reloadTelemetry()
    const vehicle = reloadVehiclesByAccount.value.get(accountId)
    if (!telemetry || !vehicle) return null
    // 弹容 N 随实际搭载主炮走——多炮坦克各炮弹容不同，禁止跨配置取最大 /
    // 剩余弹数+1 推断（上游 docs/wotbtools-cross-reference.md §六 裁决）；
    // configs 未就绪时回退 facet burst_size → 单发，就绪后本组件响应式重算。
    const size = magazineSizeForVehicle(vehicle, tankConfigs.value.get(vehicle.tank_id))
    return reloadStateAt.value(vehicle.eid, time + telemetry.timeOrigin, size)
  }

  /** 2D 名牌：当前定时消耗品（canonical transitions 的 timeSec 已是回放相对秒）。 */
  function vehicleConsumablesAt(track: VehiclePlaybackTrack, time: number) {
    return consumableRuntimeAt(track?.consumableTransitions, time)
  }

  // ---- 数据 ----
  const routesByAccount = computed(() => {
    const map = new Map()
    for (const track of deps.playback.value?.vehicles || []) map.set(track.accountId, track)
    return map
  })

  const vehiclesByAccount = computed(() => {
    const map = new Map()
    for (const vehicle of (deps.playback.value ? deps.playback.value.vehicles : [])) {
      map.set(vehicle.accountId, vehicle)
    }
    return map
  })

  /**
   * 位姿通道（与 3D 场景同源同插值）：`poseFacet` = playback facet 的位姿列投影，
   * `clockOffset` = canonical `clock.startRaw`（battle-relative → 回放时钟域）。
   * 两者缺一即 null → 全链路回退 canonical 原始观测（与既往行为逐值一致）。
   */
  const poseSource = computed<PoseSource | null>(() => {
    const facet = deps.poseFacet()
    const offset = deps.clockOffset()
    if (!facet || offset == null || !Number.isFinite(offset)) return null
    const byAccount = new Map<number, PoseFacetVehicle[]>()
    for (const def of facet.vehicles || []) {
      const list = byAccount.get(def.account_id)
      if (list) list.push(def)
      else byAccount.set(def.account_id, [def])
    }
    return {
      grid: { tStart: Number(facet.tStart) || 0, samples: Number(facet.samples) || 0 },
      offset,
      /**
       * 活跃实体选择（`t` = 采样时刻，战斗相对秒）。多实体账号（AoI 重入 / 复活换实体）按
       * canonical 身份证据判定——不能"后写覆盖"：那会在重入之前就采样到后一个实体，
       * 而轨迹端点外钳位会把该实体的首帧位姿泄漏到过去。证据缺失/歧义 → null（回退 canonical）。
       */
      defFor: (accountId: number, t: number) => selectActiveDef(
        byAccount.get(accountId) || [], facet.entityStartsByAccount?.get(accountId), t,
      ),
    }
  })
  /** 位姿采样复用对象（每帧多车 + 尾迹回溯采样，零分配热路径） */
  const _poseScratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, turretAbs: 0, turretRel: 0, gunPitch: 0 }
  /**
   * 该车在战斗相对时刻 t 的 game 系位姿（`y` = 游戏 z；2D 地图纵向翻转由 mapView 负责）。
   * 无 facet / 该账号不在位姿切面 → null（调用方回退 canonical）。
   */
  function poseAtTime(track: VehiclePlaybackTrack, t: number) {
    const source = poseSource.value
    if (!source) return null
    // **失察即冻结**（2026-10-16 用户裁定）：车离开我方视野后图标停在最后观测点，不再跟随客户端
    // 滤波器的预测延续（3D 里该车模型直接不显示，两侧语义一致：2D 变灰停住 / 3D 消失）。
    const freezeAt = observedFreezeTimeAt(track.positionSegments, t)
    if (freezeAt == null) return null
    // 活跃实体按**采样时刻**（冻结后的 freezeAt）选择：与"这个位姿属于谁"的时间域一致。
    const rawAt = freezeAt + source.offset
    const def = source.defFor(track.accountId, freezeAt)
    // 采样时刻还必须落在该实体的 **coverage 证据**内：覆盖外的端点钳位会把该实体未来的首帧位姿
    // 泄漏到过去（新实体的身份证据可能早于其首个位姿样本）→ 不覆盖即回落 canonical（fail-closed）。
    if (!def || !poseCoveredAt(def, rawAt)) return null
    const pose = sampleVehiclePoseGame(def, source.grid, rawAt, _poseScratch, def.visibility ?? def.coverage)
    return { x: pose.x, y: pose.z, yawRad: pose.yaw, turretRelRad: pose.turretRel }
  }

  function reliefModelForPlayback() {
    // activeTerrainRelief 是 JS 模块的 reactive 值：窄化到消费的唯一字段。
    const model = activeTerrainRelief.value as { mapCode: string } | null
    return model && model.mapCode === String(deps.mapCode() || '') ? model : null
  }

  function projectedSemanticNorm(x: number, y: number) {
    const model = reliefModelForPlayback()
    if (model) {
      const point = projectTerrainPoint(model, Number(x), Number(y))
      if (point) return { xNorm: point.xNorm, yNorm: point.yNorm }
    }
    return {
      xNorm: mapView.value.toX(x) / mapView.value.W,
      yNorm: mapView.value.toY(y) / mapView.value.H,
    }
  }

  function reliefUnproject(xNorm: number, yNorm: number) {
    const model = reliefModelForPlayback()
    if (!model) return null
    return unprojectTerrainPoint(model, xNorm, yNorm)
  }

  return {
    tankConfigs,
    vehicleReloadAt,
    vehicleConsumablesAt,
    routesByAccount,
    vehiclesByAccount,
    poseSource,
    poseAtTime,
    reliefModelForPlayback,
    projectedSemanticNorm,
    reliefUnproject,
  }
}

export type PlaybackReplayData = ReturnType<typeof usePlaybackReplayData>
