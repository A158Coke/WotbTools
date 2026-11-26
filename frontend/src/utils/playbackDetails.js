import { damageLogAtV2, victimFeedbackAllowedV2 } from './battlePlaybackV2.ts'

const byAccountCache = new WeakMap()

function vehiclesByAccount(dataset) {
  let byAccount = byAccountCache.get(dataset)
  if (!byAccount) {
    byAccount = new Map(dataset.vehicles.map(vehicle => [vehicle.accountId, vehicle]))
    byAccountCache.set(dataset, byAccount)
  }
  return byAccount
}

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
