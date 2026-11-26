import { computed, ref, watch } from 'vue'
import type { BattlePlaybackDataset } from '../types/playback-v2'
import { mapImages } from '../data/mapImages.js'
import { map2dSrc } from '../data/map2dOverlay.js'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette.js'
import { createMapView } from '../utils/mapView.js'
import { teamPointsAt } from '../utils/battlePlayback.js'
import { friendlyHealthAt } from '../utils/battlePlaybackV2.js'

type MapOverview = {
  mapCode?: string | null
  friendlyTeam?: number | null
  recorderAccountId?: number | null
  arenaBonusType?: number | null
  playableBounds?: { xMin: number; xMax: number; yMin: number; yMax: number } | null
}

export function useBattlePlaybackMapModel(props: { playbackV2: BattlePlaybackDataset | null; overview: MapOverview | null }, getCurrentTime: () => number) {
const pbOverview = computed(() => {
  const v2 = props.playbackV2
  const ov = props.overview || {}
  if (!v2) return ov
  return {
    ...ov,
    mapCode: v2.mapCode ?? null,
    friendlyTeam: v2.friendlyTeam ?? null,
    recorderAccountId: v2.recorderAccountId ?? null,
    arenaBonusType: v2.arenaBonusType ?? null,
  }
})

const image = computed(() => (mapImages as Record<string, (typeof mapImages)[keyof typeof mapImages]>)[pbOverview.value.mapCode ?? ''] || null)
const imageSrc = computed(() => (image.value ? map2dSrc(pbOverview.value.mapCode!, image.value.src) : null))
const mapView = computed(() => createMapView(image.value, pbOverview.value))

const palette = ref(darkMapPalette)
let paletteRequestToken = 0
watch(imageSrc, async (src) => {
  const token = ++paletteRequestToken
  if (!src) {
    palette.value = darkMapPalette
    return
  }
  try {
    const luminance = await luminanceOfImage({ src })
    if (token === paletteRequestToken) palette.value = paletteForLuminance(luminance)
  } catch {
    if (token === paletteRequestToken) palette.value = darkMapPalette
  }
}, { immediate: true })

const playback = computed(() => props.playbackV2 || null)
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => pbOverview.value.friendlyTeam)

const hpVehicles = computed(() => playback.value?.vehicles || [])
const friendlyHp = computed(() => friendlyHealthAt(hpVehicles.value, true, getCurrentTime()))
const enemyHp = computed(() => friendlyHealthAt(hpVehicles.value, false, getCurrentTime()))
const friendlyPoints = computed(() =>
  teamPointsAt(playback.value?.pointsSamples, friendlyTeam.value, getCurrentTime()))
const enemyTeam = computed(() => {
  const teams = [...new Set(hpVehicles.value
    .filter(vehicle => vehicle.friendly === false && Number.isFinite(vehicle.team))
    .map(vehicle => vehicle.team))]
  return teams.length === 1 ? teams[0] : null
})
const enemyPoints = computed(() =>
  enemyTeam.value == null
    ? null
    : teamPointsAt(playback.value?.pointsSamples, enemyTeam.value, getCurrentTime()))
const baseStatesAt = computed(() => {
  const latest = new Map<string, NonNullable<BattlePlaybackDataset['baseStates']>[number]>()
  for (const state of playback.value?.baseStates || []) {
    if (!state || !Number.isFinite(state.timeSec) || state.timeSec > getCurrentTime() + 1e-6) continue
    if (!['A', 'B', 'C', 'D', 'BASE'].includes(state.baseId)) continue
    const kept = latest.get(state.baseId)
    if (!kept || state.timeSec >= kept.timeSec) latest.set(state.baseId, state)
  }
  return [...latest.values()].sort((a, b) => a.baseId.localeCompare(b.baseId))
})


  return {
    pbOverview, image, imageSrc, mapView, palette, playback, duration, friendlyTeam,
    hpVehicles, friendlyHp, enemyHp, friendlyPoints, enemyTeam, enemyPoints, baseStatesAt,
    disposeMapPresentation: () => { paletteRequestToken += 1 },
  }
}
