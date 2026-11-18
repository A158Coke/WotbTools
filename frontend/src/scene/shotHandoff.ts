/**
 * 射击复现交接的共用准备步骤（事件流入口与射击分析入口**同一实现**，评审要求）：
 *   1. `buildPitchLimits`：车型俯仰极限锚定表（`parseAgentShotsFromBytes` 第二参数）；
 *   2. `annotateMountedConfigs`：实际搭载配置下标（`shooter/target_config_idx`）。
 * 两处入口若各写一份，同一发炮击从不同入口打开会得到不同炮管姿态/弹表/炮塔变体。
 */
import { assetProvider, fetchShotTankData } from './agentData.js'
import { resolveMountedConfig } from './reloadBar.js'
import type { MountedConfigEvidence, TankJsonLike } from './reloadBar.js'

/** 俯仰锚定的有界等待（逐车请求并行，到期即以已到部分返回）。 */
export const PITCH_ANCHOR_WAIT_MS = 1500

/** 交接行（射击 facet 行的最小读取面；其余字段原样透传）。 */
export type HandoffShotRow = Record<string, unknown>

interface VehicleLike extends MountedConfigEvidence {
  eid?: number
  nickname?: string
  tank_id?: number
}

interface PitchRange {
  dep: number
  ele: number
  front?: unknown
  back?: unknown
  transition?: unknown
}

/**
 * 车型俯仰极限锚定表：`{ [nickname]: { dep, ele, front?, back?, transition? } }`。
 * **只传基础极限**：122 改进型垂直稳定器的 +4°仰/+3°俯由 Agent core 按同 eid 的
 * Type5 配件串叠加；在这里预加会双重计算。缺数据的玩家如实降级（空锚定）。
 */
export async function buildPitchLimits(
  vehicles: ReadonlyArray<VehicleLike> | null | undefined,
): Promise<Record<string, PitchRange>> {
  const limits: Record<string, PitchRange> = {}
  const tankNames = new Map<number, string[]>()
  for (const v of vehicles || []) {
    if (v.nickname && v.tank_id) {
      const list = tankNames.get(v.tank_id) ?? []
      list.push(v.nickname)
      tankNames.set(v.tank_id, list)
    }
  }
  const tankRange = new Map<number, PitchRange>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = Promise.all([...tankNames.keys()].map(async (tid) => {
    try {
      const data = await fetchShotTankData(tid)
      const cfgs = data?.configs || []
      const pl = cfgs.length ? cfgs[cfgs.length - 1].pitch_limits : null
      if (pl && pl.max != null && pl.min != null) {
        tankRange.set(tid, {
          dep: pl.max,
          ele: -pl.min,
          ...(pl.front ? { front: pl.front } : {}),
          ...(pl.back ? { back: pl.back } : {}),
          ...(pl.transition != null ? { transition: pl.transition } : {}),
        })
      }
    } catch { /* 数据缺失：该玩家保持空锚定（如实降级） */ }
  })).finally(() => { if (timer) clearTimeout(timer) })
  await Promise.race([
    pending,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, PITCH_ANCHOR_WAIT_MS) }),
  ])
  for (const [tid, names] of tankNames) {
    const range = tankRange.get(tid)
    if (!range) continue
    for (const nick of names) limits[nick] = range
  }
  return limits
}

/**
 * 实际搭载配置下标注入（`shooter_config_idx` / `target_config_idx`）。
 * WASM 产物没有这两个字段：多炮坦克各炮 GLB 节点组、炮口原点、弹表都不同，
 * 缺省会让装甲查看器按顶级配置摆射手炮管/选目标变体/选弹表（&scfg=）。
 * 依据 = 回放 facet 自带的逐车证据（comp locals → `resolveMountedConfig`）；
 * 坦克数据缺失时不注入（消费端回退顶级，与服务器「全无 → 顶级」一致）。
 *
 * **逐车增量提交**：每辆车的 tank JSON 一返回就写入所有引用它的行，而不是等
 * 全部车型的 `Promise.all` 结束。交接调用方带 1500ms 有界等待（`PITCH_ANCHOR_WAIT_MS`），
 * 到期即序列化快照——若先等全场，任何一辆无关慢车都会把已就绪的配置证据一起抹掉
 * （评审 4597024398：选中发与下一发都退化回顶级炮管/弹表）。本函数仍返回「全部请求
 * 都结算」的 Promise；有界等待由调用方按需 race，已到的证据由上面的增量写入保住。
 */
export async function annotateMountedConfigs(
  parsedShots: ReadonlyArray<HandoffShotRow>,
  vehicles: ReadonlyArray<VehicleLike> | null | undefined,
): Promise<void> {
  const byEid = new Map((vehicles || []).map((v) => [v.eid, v]))
  const tankIds = new Set<number>()
  for (const s of parsedShots) {
    const shooterTank = s.shooter_tank_id as number | undefined
    const targetTank = s.target_tank_id as number | undefined
    if (shooterTank) tankIds.add(shooterTank)
    if (targetTank) tankIds.add(targetTank)
  }
  if (!tankIds.size) return
  const configsByTank = new Map<number, TankJsonLike>()
  const idxOf = (vehicle: VehicleLike | undefined, tid: number | undefined): number | null => {
    if (tid == null) return null
    const data = configsByTank.get(tid)
    if (!data || !vehicle) return null
    const cfg = resolveMountedConfig(vehicle, data)
    const idx = cfg && data.configs ? data.configs.indexOf(cfg) : -1
    return idx >= 0 ? idx : null
  }
  /** 该车数据已就绪：立刻写回所有以它为射手/目标的交接行（幂等）。 */
  const injectTank = (tid: number): void => {
    if (!configsByTank.has(tid)) return
    for (const s of parsedShots) {
      if (s.shooter_tank_id === tid) {
        const shooterIdx = idxOf(byEid.get(s.shooter_eid as number), tid)
        if (shooterIdx != null) s.shooter_config_idx = shooterIdx
      }
      if (s.target_tank_id === tid && s.target_eid != null) {
        const targetIdx = idxOf(byEid.get(s.target_eid as number), tid)
        if (targetIdx != null) s.target_config_idx = targetIdx
      }
    }
  }
  await Promise.all([...tankIds].map(async (tid) => {
    try {
      const data = await assetProvider.json(`/tank/${tid}.json`) as TankJsonLike | null
      if (Array.isArray(data?.configs) && data.configs.length) {
        configsByTank.set(tid, data)
        // 增量提交：调用方的有界等待到期时，快照已包含期限内返回的全部证据。
        injectTank(tid)
      }
    } catch { /* 数据缺失：该车不注入 */ }
  }))
}
