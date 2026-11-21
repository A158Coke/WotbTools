import { computed, ref } from 'vue'
import { transientsActive } from '../utils/battlePlayback.js'

export function useBattlePlaybackPresentation({ computed: derive = computed, uiHidden: hiddenState, t, nowMs,
  floatItems, burstItems, vehicleStates, markerScreen, hpPrefs, markerPrefs, vehiclesByAccount, closeAnnotation,
  displayOpen, uiPrefs }) {
  const uiHidden = hiddenState || ref(false)
  const setUiHidden = (hidden) => {
    uiHidden.value = hidden
    if (hidden) { displayOpen.value = false; closeAnnotation() }
  }
  const hpPrefsForMap = derive(() => ({ ...hpPrefs, showHp: !uiHidden.value && hpPrefs.showHp }))
  const markerPrefsForMap = derive(() => ({
    classIcons: !uiHidden.value && markerPrefs.classIcons,
    showStatus: !uiHidden.value && markerPrefs.showStatus,
  }))
  const visibleFloats = derive(() => {
    const active = transientsActive(floatItems.value, nowMs.value)
    if (!active.length) return []
    const byVictim = new Map()
    for (const item of active) {
      const list = byVictim.get(item.victimAccountId) || []
      list.push(item)
      byVictim.set(item.victimAccountId, list)
    }
    const out = []
    for (const [victimId, list] of byVictim) {
      const vehicle = vehicleStates.value.find((entry) => entry.vehicle.accountId === victimId)
      if (!vehicle) continue
      const point = markerScreen(vehicle)
      if (!point) continue
      list.forEach((item, index) => out.push({ ...item, x: point.x, y: point.y - 34 - index * 16, friendly: vehicle.vehicle.friendly }))
    }
    return out
  })
  const visibleBursts = derive(() => transientsActive(burstItems.value, nowMs.value).map((item) => {
    const vehicle = vehicleStates.value.find((entry) => entry.vehicle.accountId === item.victimAccountId)
    if (!vehicle) return null
    const point = markerScreen(vehicle)
    return point ? { ...item, x: point.x, y: point.y, friendly: vehicle.vehicle.friendly } : null
  }).filter(Boolean))
  const playerName = (accountId) => {
    const vehicle = vehiclesByAccount.value.get(accountId)
    return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? t('recon.map.playback.unknown') : `#${accountId}`)
  }
  const eventLabel = (event) => {
    const type = t(`recon.map.playback.event_${event.type}`)
    switch (event.type) {
      case 'DAMAGE': return event.observedHpLoss != null
        ? `${playerName(event.accountId)} → ${playerName(event.targetAccountId)} −${event.observedHpLoss}`
        : `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
      case 'KILL': return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
      case 'DESTROYED': return playerName(event.accountId)
      default: return type
    }
  }
  const showRosterPresentation = derive(() => !uiHidden.value && uiPrefs.showRoster !== false)
  return { uiHidden, setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts, eventLabel, showRosterPresentation }
}
