// 俯仰锚定表构建（3D 回放与射击复现共用）：
// playback 名册 → tank_id → tank/{id}.json 的顶级 pitch_limits → GunPitchRange 形状。
// 注入 WASM parsePlayback 的 limitsJson 后，prop2 俯仰按车型极限解码
// （缺省空表时 gun_pitch 走 hull_pitch 兜底——坡上炮管俯仰不正确的根因）。
// **只传基础 models.pb 极限**：实体实际携带的 122 改进型垂直稳定器（+4°仰/+3°俯）
// 由 Agent core 按同 eid 的 Type5 配件串在解码时叠加；在这里预加会双重计算。
import { assetProvider } from './assetProvider.js'

/** 单车俯仰锚定（dep = 俯角下限，ele = 仰角上限；front/back/transition 为火力组扇区，透传资产包原值）。 */
export interface PitchRange {
  dep: number
  ele: number
  front?: number[]
  back?: number[]
  transition?: number
}

/** playback 名册中 buildPitchLimits 需要的字段。 */
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
      const data = await assetProvider.json(`/tank/${tid}.json`)
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
