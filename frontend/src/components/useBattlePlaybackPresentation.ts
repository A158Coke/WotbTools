import { computed, ref, type Ref } from 'vue'
import type { usePlaybackTransients } from '../composables/usePlaybackTransients'
import type { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection'
import type { PlaybackReplayData } from '../composables/usePlaybackReplayData'
import type { usePlaybackPreferences } from '../composables/usePlaybackPreferences'
import type { BattleEvent } from '../types/playback-v2'
import { transientsActive } from '../utils/battlePlayback.js'

type PresentationDeps = {
  computed?: typeof computed
  uiHidden?: Ref<boolean>
  t: (key: string) => string
  nowMs: Ref<number>
  floatItems: ReturnType<typeof usePlaybackTransients>['floatItems']
  burstItems: ReturnType<typeof usePlaybackTransients>['burstItems']
  vehicleStates: ReturnType<typeof usePlaybackVehicleProjection>['vehicleStates']
  markerScreen: ReturnType<typeof usePlaybackVehicleProjection>['markerScreen']
  hpPrefs: ReturnType<typeof usePlaybackPreferences>['hpPrefs']
  markerPrefs: ReturnType<typeof usePlaybackPreferences>['markerPrefs']
  vehiclesByAccount: PlaybackReplayData['vehiclesByAccount']
  closeAnnotation: () => void
  displayOpen: Ref<boolean>
  uiPrefs: ReturnType<typeof usePlaybackPreferences>['uiPrefs']
}

export function useBattlePlaybackPresentation({ computed: derive = computed, uiHidden: hiddenState, t, nowMs,
  floatItems, burstItems, vehicleStates, markerScreen, hpPrefs, markerPrefs, vehiclesByAccount, closeAnnotation,
  displayOpen, uiPrefs }: PresentationDeps) {
  const uiHidden = hiddenState || ref(false)
  const setUiHidden = (hidden: boolean) => {
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
    const byVictim = new Map<number, typeof active>()
    for (const item of active) {
      const list = byVictim.get(item.victimAccountId) || []
      list.push(item)
      byVictim.set(item.victimAccountId, list)
    }
    const out: Array<(typeof active)[number] & { x: number; y: number; friendly: boolean | null | undefined }> = []
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
  const playerName = (accountId: number | null | undefined) => {
    const vehicle = accountId == null ? undefined : vehiclesByAccount.value.get(accountId)
    return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? t('recon.map.playback.unknown') : `#${accountId}`)
  }
  const eventLabel = (event: BattleEvent) => {
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
