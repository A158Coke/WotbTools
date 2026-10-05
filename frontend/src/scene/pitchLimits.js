// 俯仰锚定表构建（3D 回放与射击复现共用）：
// playback 名册 → tank_id → tank/{id}.json 的顶级 pitch_limits → GunPitchRange 形状。
// 注入 WASM parsePlayback 的 limitsJson 后，prop2 俯仰按车型极限解码
// （缺省空表时 gun_pitch 走 hull_pitch 兜底——坡上炮管俯仰不正确的根因）。
import { assetProvider } from './assetProvider.js'

/**
 * @param {Array<{nickname:string, tank_id:number}>} vehicles
 * @returns {Promise<Record<string, {dep:number, ele:number, front?:number[], back?:number[], transition?:number}>>}
 */
export async function buildPitchLimits(vehicles) {
  const limits = {}
  const byTank = new Map()
  for (const v of vehicles || []) {
    if (v.nickname && v.tank_id && !byTank.has(v.tank_id)) byTank.set(v.tank_id, [])
    if (v.nickname && v.tank_id) byTank.get(v.tank_id).push(v.nickname)
  }
  if (!byTank.size) return limits
  const tankRange = new Map()
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
