import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { cumulativeStatsAtV2, healthDisplayAt } from '../utils/battlePlaybackV2.js'
import { detailsDamageLogAtV2 } from '../utils/playbackDetails.js'
import { healthRingDiameter } from '../utils/vehicleMarkerSizing.js'
import type { PlaybackCamera } from './usePlaybackCamera.js'
import type { VehicleRenderState } from './usePlaybackVehicleProjection.js'
import type { BattleEvent, BattlePlaybackDataset, VehiclePlaybackTrack } from '../types/playback-v2.js'

type VehicleRenderStateLike = VehicleRenderState

export function usePlaybackVehicleSelection<T extends VehicleRenderStateLike>(
  camera: Pick<PlaybackCamera, 'view' | 'mapEl' | 'mapRenderRect' | 'mapWidth'>,
  deps: {
    vehicleStates: Ref<T[]>
    playback: Ref<BattlePlaybackDataset | null>
    currentTime: Ref<number>
    authoritativeEvents: Ref<BattleEvent[]>
    hpVehicles: Ref<VehiclePlaybackTrack[]>
    uiHidden: Ref<boolean>
    hpPrefs: { showHp: boolean; mode: string }
    markerPrefs: { classIcons: boolean }
    battlefieldWorkspaceEl: Ref<HTMLElement | null>
    markerScreen: (st: T) => { x: number; y: number } | null
    projectedSemanticNorm: (x: number, y: number) => { xNorm: number; yNorm: number }
    mobileOverlay: Ref<{ reveal?: () => void } | null>
    t: (key: string) => string
  },
) {
  const selectedAccountId = ref<number | null>(null)
  const detailsOpen = ref(false)
  const detailsSide = ref('right')

  const { view } = camera

  function openDetails(accountId: number | null, side: string | null = null) {
    selectedAccountId.value = accountId
    if (side) detailsSide.value = side
    detailsOpen.value = true
  }
  function sideAwayFromClientX(clientX?: number) {
    const host = deps.battlefieldWorkspaceEl.value
    if (!host || !Number.isFinite(clientX)) return null
    const rect = host.getBoundingClientRect()
    return clientX! > rect.left + rect.width / 2 ? 'left' : 'right'
  }

  const selectedState = computed(() => {
    if (selectedAccountId.value == null) return null
    return deps.vehicleStates.value.find(st => st.vehicle.accountId === selectedAccountId.value) || null
  })
  const detailsState = computed(() => (detailsOpen.value ? selectedState.value : null))

  const selectedTrack = computed(() => {
    if (!deps.playback.value || !selectedState.value) return null
    const accountId = selectedState.value.vehicle.accountId
    const tracks = deps.playback.value.vehicles || []
    return tracks.find(t => t.accountId === accountId) || null
  })

  const selectedHealth = computed(() => {
    const health = healthDisplayAt(selectedTrack.value, deps.currentTime.value)
    return health ? { currentHp: health.currentHp, maxHp: health.displayCapacityHp, state: health.state } : null
  })

  const selectedPortraitUrl = ref<string | null>(null)
  let portraitLoadToken = 0
  watch(
    () => selectedState.value?.vehicle?.tankId,
    async (tankId) => {
      const token = ++portraitLoadToken
      selectedPortraitUrl.value = null
      if (tankId == null) return
      try {
        const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
        const url = await loadVehiclePortrait(tankId)
        if (token === portraitLoadToken) selectedPortraitUrl.value = url
      } catch {
        if (token === portraitLoadToken) selectedPortraitUrl.value = null
      }
    },
  )

  function closeSidebar() {
    detailsOpen.value = false
  }

  const selLastKnownSec = computed(() => {
    const st = selectedState.value
    return st && st.lastKnown && Number.isFinite(st.pos.timeSec) ? st.pos.timeSec : null
  })
  const selCurStats = computed(() => {
    const st = selectedState.value
    if (!st) return { dealt: 0, received: 0, kills: 0 }
    return cumulativeStatsAtV2(deps.authoritativeEvents.value, st.vehicle, deps.currentTime.value, deps.hpVehicles.value)
  })
  const selDamageLog = computed(() => {
    const st = selectedState.value
    if (!st) return []
    return detailsDamageLogAtV2(deps.playback.value, st.vehicle, deps.currentTime.value, deps.t('recon.map.playback.source_unknown'))
  })

  function onMarkerSelect(vehicle: { accountId: number | null }, event?: { target?: EventTarget | null; clientX?: number; clientY?: number }) {
    const target = event && event.target
    if (target && typeof (target as HTMLElement).closest === 'function' && (target as HTMLElement).closest('.pb-labels')) return
    selectAt(vehicle.accountId, event ? event.clientX : undefined, event ? event.clientY : undefined)
  }

  function selectAt(accountId: number | null, clientX?: number, clientY?: number) {
    const states = deps.vehicleStates.value
    const hasPoint = Number.isFinite(clientX) && camera.mapEl.value && camera.mapWidth() > 0
    const rect = camera.mapEl.value ? camera.mapEl.value.getBoundingClientRect() : { left: 0, top: 0 }
    const px = hasPoint ? clientX! - rect.left : NaN
    const py = hasPoint ? clientY! - rect.top : NaN
    const hitTest = (s: T) => {
      const cx = (px - view.tx) / view.scale
      const cy = (py - view.ty) / view.scale
      const mapRect = camera.mapRenderRect()
      const projected = deps.projectedSemanticNorm(s.pos.x, s.pos.y)
      const x = projected.xNorm * mapRect.width
      const y = projected.yNorm * mapRect.height
      const hitTarget = s.hitTargetSize || s.markerSize?.hitTarget
      const ringSize = !deps.uiHidden.value && deps.hpPrefs.showHp && deps.hpPrefs.mode === 'ring' && !s.destroyed
        ? healthRingDiameter(s, deps.markerPrefs.classIcons) / view.scale : 0
      const hw = Math.max(hitTarget?.width || 20, ringSize) / 2
      const hh = Math.max(hitTarget?.height || 20, ringSize) / 2
      return Math.abs(cx - x) <= hw && Math.abs(cy - y) <= hh
    }
    let candidates
    if (hasPoint) {
      candidates = states.filter(hitTest)
      if (candidates.length === 0) {
        const target = states.find(s => s.vehicle.accountId === accountId)
        candidates = target ? [target] : []
      }
    } else {
      const target = states.find(s => s.vehicle.accountId === accountId)
      candidates = target ? [target] : []
    }
    if (candidates.length === 0) return
    let best = candidates[0]
    if (candidates.length > 1) {
      const dist = (s: T) => {
        const p = deps.markerScreen(s)
        return p ? Math.hypot(p.x - px, p.y - py) : Infinity
      }
      candidates.sort((a, b) => (dist(a) - dist(b)) || (states.indexOf(a) - states.indexOf(b)))
      best = candidates[0]
      if (selectedAccountId.value != null && candidates.length > 1
          && Math.abs(dist(best) - dist(candidates[1])) < 1) {
        const sel = candidates.find(s => s.vehicle.accountId === selectedAccountId.value)
        if (sel) { openDetails(selectedAccountId.value, sideAwayFromClientX(clientX)); return }
      }
    }
    openDetails(best.vehicle.accountId, sideAwayFromClientX(clientX))
    deps.mobileOverlay.value?.reveal?.()
  }

  function selectFromRoster(accountId: number, event?: { target?: EventTarget | null }) {
    const row = (event?.target as HTMLElement | null)?.closest?.('[data-test="pb-roster-row"]')
    let side: string | null = null
    if (row?.closest?.('.pb-team-lane-left')) side = 'right'
    else if (row?.closest?.('.pb-team-lane-right')) side = 'left'
    else if (row) side = sideAwayFromClientX(row.getBoundingClientRect().left)
    openDetails(accountId, side)
  }

  return {
    selectedAccountId,
    detailsOpen,
    detailsSide,
    selectedState,
    detailsState,
    selectedTrack,
    selectedHealth,
    selectedPortraitUrl,
    selLastKnownSec,
    selCurStats,
    selDamageLog,
    openDetails,
    closeSidebar,
    sideAwayFromClientX,
    onMarkerSelect,
    selectAt,
    selectFromRoster,
  }
}

export type PlaybackVehicleSelection = ReturnType<typeof usePlaybackVehicleSelection>
