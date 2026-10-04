import { damageLogAtV2, victimFeedbackAllowedV2 } from './battlePlaybackV2.ts'

/** Details labels share canonical attribution and event-time visibility in both renderers. */
export function detailsDamageLogAtV2(dataset, track, time, unknownLabel) {
  if (!dataset || !track) return []
  const byAccount = new Map(dataset.vehicles.map(vehicle => [vehicle.accountId, vehicle]))
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
