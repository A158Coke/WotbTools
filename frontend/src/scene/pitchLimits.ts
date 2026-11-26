import { assetProvider } from './assetProvider.js'

export interface PitchRange {
  dep: number
  ele: number
  front?: number[]
  back?: number[]
  transition?: number
}

export interface TankPitchConfig {
  pitch_limits?: { max?: number; min?: number; front?: number[]; back?: number[]; transition?: number } | null
}

export interface PitchLimitVehicle {
  nickname: string
  tank_id: number
}

export async function buildPitchLimits(vehicles: readonly PitchLimitVehicle[] | null | undefined): Promise<Record<string, PitchRange>> {
  const limits: Record<string, PitchRange> = {}
  const byTank = new Map<number, string[]>()
  for (const v of vehicles || []) {
    if (v.nickname && v.tank_id) {
      let names = byTank.get(v.tank_id)
      if (!names) { names = []; byTank.set(v.tank_id, names) }
      names.push(v.nickname)
    }
  }
  if (!byTank.size) return limits
  const tankRange = new Map<number, PitchRange>()
  await Promise.all([...byTank.keys()].map(async (tid) => {
    try {
      const data = await assetProvider.json<{ configs?: TankPitchConfig[] | null }>(`/tank/${tid}.json`)
      const cfgs = data.configs || []
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
    } catch { /* 数据缺失：该玩家保持空锚定 */ }
  }))
  for (const [tid, names] of byTank) {
    const range = tankRange.get(tid)
    if (!range) continue
    for (const nick of names) limits[nick] = range
  }
  return limits
}
