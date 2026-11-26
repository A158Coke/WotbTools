import { assetProvider, fetchShotTankData } from './agentData.js'
import { resolveMountedConfig } from './reloadBar.js'
import type { MountedConfigEvidence, TankJsonLike } from './reloadBar.js'

export const PITCH_ANCHOR_WAIT_MS = 1500

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
        injectTank(tid)
      }
    } catch { /* 数据缺失：该车不注入 */ }
  }))
}
