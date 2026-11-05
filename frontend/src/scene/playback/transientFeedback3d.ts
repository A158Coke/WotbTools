// 3D 战斗反馈 transient（#820 Wave B6B 自 playbackScene.js 出仓）。
//
// 单一职责：回放时钟上的伤害/击毁事件源 + 游标，以及壁钟寿命的 HP 幽灵段/受击闪状态。
// 语义与 2D（usePlaybackTransients / battlePlayback.ts）对齐：
// - **壁钟（真实 ms）寿命**，不是回放时钟——任意倍速下可读时长相近；暂停时自然走完，
//   seek 清空且不补播历史动画。
// - 伤害来自血量链下降（hp[i-1][1] - hp[i][1] > 0）；击毁特效与模型共用生命事实，
//   不要求 killer/kill 归属。
// - 每车只有一段 HP 幽灵：存活期内连续受击 = 向下延伸同一段并重启寿命，不叠第二根 bar。
//
// 不拥有：canvas/DOM 渲染（覆盖层与 battleFx 各自负责）、击杀 feed/计分（hudFeed）、
// 车模可见性判定（caller 的 getVehicles 提供 group.visible）。
import { firstIndexAfter } from '../seekPointer.js'

/** 伤害事件（回放时钟，升序）。 */
export interface DamageEvent {
  t: number
  eid: number
  hpLoss: number
  hpBefore: number
  hpAfter: number
}

/** 击毁事件（回放时钟，升序）。 */
export interface BurstEvent {
  t: number
  eid: number
}

/** HP 幽灵段：from = 掉血后的比例，to = 掉血前的比例（向下延伸）。 */
export interface HpGhost {
  fromFrac: number
  toFrac: number
  bornMs: number
  untilMs: number
}

/** 本模块用到的车辆面（playbackScene 的 V 元素）。 */
export interface TransientVehicle {
  def: { eid: number; max_hp: number; hp?: Array<[number, number]> }
  group: { visible: boolean }
}

/** 血量链数据面（DATA.vehicles[].hp 与 DATA.kills）。 */
export interface TransientData {
  vehicles?: Array<{ eid: number; hp?: Array<[number, number]> }>
  kills?: Array<{ t: number }>
}

export interface TransientLabelOverlay {
  spawnDamage?: (eid: number, hpLoss: number, durationMs: number) => void
  clearDamages?: () => void
}

export interface TransientBattleFx {
  clearTransients?: () => void
}

export interface TransientFeedback3dDeps {
  /** DATA（会话数据；rebuildSources 时读取血量链与 kills）。 */
  getData: () => TransientData | null
  /** 运行时车辆（含 def.max_hp 与 group.visible）。 */
  getVehicles: () => TransientVehicle[]
  /** 每次死亡的场景时刻（复活模式同一 eid 可多次），实现留在场景内核（canonical 生命链）。 */
  deathTimesOf: (v: TransientVehicle) => number[]
  getLabelOverlay: () => TransientLabelOverlay | null
  getBattleFx: () => TransientBattleFx | null
  /** 标签快照失效（壁钟寿命到期 / 伤害事件到达都要重画 HP 条）。 */
  invalidateLabels: () => void
  /** 请求重绘（幽灵段/闪光到期后清残影）。 */
  invalidate: () => void
  /** 壁钟（默认 performance.now；单测注入假钟）。 */
  now?: () => number
  /** 3D 显示时长倍率（只在 3D 使用点乘，2D SSOT 常量不动）。 */
  scale: number
  floatDmgMs: number
  ghostMs: number
  flashMs: number
  /** 击毁事件到达时的副作用（spawnBurst 需要 battleFx 与场景位置）。 */
  onBurst: (eid: number) => void
}

export interface TransientFeedback3d {
  /** 重建伤害/击毁事件源并把游标归零（会话装载 / 时钟重建）。 */
  rebuildSources: () => void
  /** 只重建击毁事件源，并把击毁游标放到 t 之后（canonical 时钟晚到）。 */
  resyncBursts: (t: number) => void
  /** 两个游标都放到 t 之后（seek；不补播历史动画）。 */
  rewind: (t: number) => void
  /** 只把击毁游标放到 t 之后（会话从开战时刻开始；与 rebuildSources 的伤害游标归零语义分开）。 */
  rewindBursts: (t: number) => void
  /** 推进到回放时刻 t：触发到期伤害反馈与击毁特效。 */
  advanceTo: (t: number) => void
  /** 壁钟推进：清理到期的幽灵段/受击闪（返回是否有清理）。 */
  updateNow: () => boolean
  clear: () => void
  ghostOf: (eid: number) => HpGhost | undefined
  hasFlash: (eid: number) => boolean
  /** 是否有尚未到期的壁钟反馈（空闲跳帧判定用）。 */
  hasActive: () => boolean
}

export function createTransientFeedback3d(deps: TransientFeedback3dDeps): TransientFeedback3d {
  const now = deps.now ?? (() => performance.now())
  const ghostByEid = new Map<number, HpGhost>()
  const flashByEid = new Map<number, number>()
  let dmgEvents: DamageEvent[] = []
  let burstEvents: BurstEvent[] = []
  let dmgPtr = 0
  let burstPtr = 0

  function vehicleByEid(eid: number): TransientVehicle | undefined {
    return deps.getVehicles().find((x) => x.def.eid === eid)
  }

  function buildBurstSources(): void {
    burstEvents = []
    for (const v of deps.getVehicles()) {
      // 每次死亡各一次爆焰；普通战斗每车至多一次死亡——单条行为与既往逐位一致。
      for (const t of deps.deathTimesOf(v)) burstEvents.push({ t, eid: v.def.eid })
    }
    burstEvents.sort((a, b) => a.t - b.t)
  }

  function rebuildSources(): void {
    dmgEvents = []
    for (const def of deps.getData()?.vehicles || []) {
      const hp = def.hp || []
      for (let i = 1; i < hp.length; i++) {
        const loss = hp[i - 1][1] - hp[i][1]
        if (loss > 0) dmgEvents.push({ t: hp[i][0], eid: def.eid, hpLoss: loss, hpBefore: hp[i - 1][1], hpAfter: hp[i][1] })
      }
    }
    dmgEvents.sort((a, b) => a.t - b.t)
    // 击杀流和比分需要升序输入；爆炸独立按生命事实生成，不要求击杀归属。
    const kills = deps.getData()?.kills
    if (kills) kills.sort((a, b) => a.t - b.t)
    buildBurstSources()
    dmgPtr = 0
    burstPtr = 0
  }

  /** 掉血反馈：伤害数字 + HP 幽灵段 + 受击闪（与 2D 三件套同源）。 */
  function emitDamageFeedback(event: DamageEvent): void {
    const v = vehicleByEid(event.eid)
    if (!v || !v.group.visible) return
    deps.getLabelOverlay()?.spawnDamage?.(event.eid, event.hpLoss, deps.floatDmgMs * deps.scale)
    const nowMs = now()
    const maxHp = v.def.max_hp > 0 ? v.def.max_hp : 0
    if (maxHp > 0) {
      const fromFrac = Math.max(0, Math.min(1, event.hpAfter / maxHp))
      // 每车只有一段幽灵：存活期内连续受击 = 向下延伸同一段并重启寿命，不叠第二根 bar
      const prev = ghostByEid.get(event.eid)
      const carriedFrac = prev && nowMs < prev.untilMs ? prev.toFrac : 0
      const toFrac = Math.max(carriedFrac, Math.min(1, event.hpBefore / maxHp))
      ghostByEid.set(event.eid, { fromFrac, toFrac, bornMs: nowMs, untilMs: nowMs + deps.ghostMs * deps.scale })
    }
    flashByEid.set(event.eid, nowMs + deps.flashMs * deps.scale)
    deps.invalidateLabels()   // feedback expires independently of playback time
  }

  function advanceTo(t: number): void {
    while (dmgPtr < dmgEvents.length && dmgEvents[dmgPtr].t <= t) {
      emitDamageFeedback(dmgEvents[dmgPtr++])
    }
    while (burstPtr < burstEvents.length && burstEvents[burstPtr].t <= t) {
      deps.onBurst(burstEvents[burstPtr++].eid)
    }
  }

  function updateNow(): boolean {
    const nowMs = now()
    let changed = false
    // HP 条反馈过期清理（过期后再刷一次标签以擦除残影/闪光）
    for (const [eid, g] of ghostByEid) {
      if (nowMs >= g.untilMs) {
        ghostByEid.delete(eid)
        deps.invalidateLabels()
        deps.invalidate()   // 到期要重画标签（清幽灵段），否则脏帧会停在这一帧
        changed = true
      }
    }
    for (const [eid, until] of flashByEid) {
      if (nowMs >= until) {
        flashByEid.delete(eid)
        deps.invalidateLabels()
        deps.invalidate()
        changed = true
      }
    }
    return changed
  }

  function clear(): void {
    deps.getLabelOverlay()?.clearDamages?.()   // 伤害数字：seek 后不补播（到期由覆盖层自己的定时器负责）
    deps.getBattleFx()?.clearTransients?.()   // 爆炸 / 开火 / 命中：seek 后不补播
    ghostByEid.clear()
    flashByEid.clear()   // 2D seek 同语义：清空且不补播
    dmgPtr = 0
    burstPtr = 0         // 游标重置：seek 后不补播历史动画
  }

  function resyncBursts(t: number): void {
    buildBurstSources()
    burstPtr = firstIndexAfter(burstEvents, t)   // late canonical never replays past explosions
  }

  function rewind(t: number): void {
    dmgPtr = firstIndexAfter(dmgEvents, t)
    burstPtr = firstIndexAfter(burstEvents, t)
  }

  function rewindBursts(t: number): void {
    burstPtr = firstIndexAfter(burstEvents, t)
  }

  return {
    rebuildSources,
    resyncBursts,
    rewind,
    rewindBursts,
    advanceTo,
    updateNow,
    clear,
    ghostOf: (eid) => ghostByEid.get(eid),
    hasFlash: (eid) => flashByEid.has(eid),
    hasActive: () => ghostByEid.size > 0 || flashByEid.size > 0,
  }
}