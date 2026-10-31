import { damageLogAtV2, victimFeedbackAllowedV2 } from './battlePlaybackV2.ts'

/** 数据集 → 账号索引缓存（WeakMap，随数据集回收）：回放数据解析后不可变，
 * 详情面板在 HUD 节流频率（~10Hz）重建伤害日志，逐调用重建 Map 是纯浪费。 */
const byAccountCache = new WeakMap()

function vehiclesByAccount(dataset) {
  let byAccount = byAccountCache.get(dataset)
  if (!byAccount) {
    byAccount = new Map(dataset.vehicles.map(vehicle => [vehicle.accountId, vehicle]))
    byAccountCache.set(dataset, byAccount)
  }
  return byAccount
}

/** Details labels share canonical attribution and event-time visibility in both renderers. */
export function detailsDamageLogAtV2(dataset, track, time, unknownLabel) {
  if (!dataset || !track) return []
  const byAccount = vehiclesByAccount(dataset)
  return damageLogAtV2(dataset.events, track, time, 8, dataset.vehicles).map(damage => {
    if (damage.dir === 'in') {
      const attacker = damage.attackerReliable ? byAccount.get(damage.attackerAccountId) : null
      return { ...damage, label: attacker && victimFeedbackAllowedV2(attacker, damage.timeSec)
        ? (attacker.playerName || '#' + attacker.accountId) : unknownLabel }
    }
    const victim = byAccount.get(damage.victimAccountId)
    return { ...damage, label: victim ? (victim.tankName || '#' + victim.accountId) : '#' + damage.victimAccountId }
  })
}
