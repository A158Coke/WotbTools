import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { mapImages } from '../data/mapImages'
import { map2dSrc } from '../data/map2dOverlay'
import { createMapView } from '../utils/mapView'
import { darkMapPalette, luminanceOfImage, paletteForLuminance } from '../utils/mapPalette'
import { friendlyHealthAt } from '../utils/battlePlaybackV2.js'
import { teamPointsAt, transientsActive } from '../utils/battlePlayback.js'
import { usePlaybackPreferences } from '../composables/usePlaybackPreferences.js'
import { usePlaybackTransients } from '../composables/usePlaybackTransients.js'
import type { BattleEvent, BattlePlaybackDataset, VehiclePlaybackTrack, BaseStateTransition } from '../types/playback-v2.js'
import type { PlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import type { PlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'

type Prefs = ReturnType<typeof usePlaybackPreferences>
type TransientDeps = Parameters<typeof usePlaybackTransients>[0]

interface MapImageLike {
  src: string
  [key: string]: unknown
}

export interface BpAParts {
  currentTime: Ref<number>
  authoritativeEvents: Ref<BattleEvent[]>
  vehiclesByAccount: PlaybackReplayData['vehiclesByAccount']
  vehicleStates: PlaybackVehicleProjection['vehicleStates']
  markerScreen: PlaybackVehicleProjection['markerScreen']
  uiHidden: Ref<boolean>
  uiPrefs: Prefs['uiPrefs']
}

export interface BpAProps {
  overview: Record<string, unknown> | null
  playbackV2: BattlePlaybackDataset | null
  result: unknown
}

const MAP_IMAGES: Record<string, MapImageLike> = mapImages

export function bpA(S: BpAParts, props: BpAProps): void {
  const mapSemantics: unknown[] = Object.values(import.meta.glob('../../../common/map-semantics/*.semantic.json', {
    eager: true, import: 'default',
  }))

  const { t, locale } = useI18n()
  const gunMarks = computed(() => gunMarksByAccount(props.result))

  const pbOverview = computed(() => {
    const v2 = props.playbackV2
    const ov = props.overview || {}
    if (!v2) return { ...ov, mapCode: null as string | null, friendlyTeam: null as number | null, recorderAccountId: null as number | null, arenaBonusType: null as unknown }
    return {
      ...ov,
      mapCode: v2.mapCode ?? null,
      friendlyTeam: v2.friendlyTeam ?? null,
      recorderAccountId: v2.recorderAccountId ?? null,
      arenaBonusType: v2.arenaBonusType ?? null,
    }
  })

  const image = computed(() => {
    const code = pbOverview.value.mapCode
    return code ? MAP_IMAGES[code] || null : null
  })
  const imageSrc = computed(() => {
    const layer = image.value
    return layer ? map2dSrc(pbOverview.value.mapCode ?? '', layer.src) : null
  })
  const mapView = computed(() => createMapView(image.value, pbOverview.value))

  type Palette = typeof darkMapPalette
  const palette = ref<Palette>(darkMapPalette)
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

  const hpVehicles = computed<VehiclePlaybackTrack[]>(() => playback.value?.vehicles || [])
  const friendlyHp = computed(() => friendlyHealthAt(hpVehicles.value, true, S.currentTime.value))
  const enemyHp = computed(() => friendlyHealthAt(hpVehicles.value, false, S.currentTime.value))
  const friendlyPoints = computed(() => {
    const team = friendlyTeam.value
    if (team == null) return null
    return teamPointsAt(playback.value?.pointsSamples, team, S.currentTime.value)
  })
  const enemyTeam = computed(() => {
    const teams = [...new Set(hpVehicles.value
      .filter(vehicle => vehicle.friendly === false && Number.isFinite(vehicle.team))
      .map(vehicle => vehicle.team))]
    return teams.length === 1 ? teams[0] : null
  })
  const enemyPoints = computed(() =>
    enemyTeam.value == null
      ? null
      : teamPointsAt(playback.value?.pointsSamples, enemyTeam.value, S.currentTime.value))
  const baseStatesAt = computed<BaseStateTransition[]>(() => {
    const latest = new Map<string, BaseStateTransition>()
    for (const state of playback.value?.baseStates || []) {
      if (!state || !Number.isFinite(state.timeSec) || state.timeSec > S.currentTime.value + 1e-6) continue
      if (!['A', 'B', 'C', 'D', 'BASE'].includes(state.baseId)) continue
      const kept = latest.get(state.baseId)
      if (!kept || state.timeSec >= kept.timeSec) latest.set(state.baseId, state)
    }
    return [...latest.values()].sort((a, b) => a.baseId.localeCompare(b.baseId))
  })

  const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)
  const { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()
  const hpModeOptions = computed(() => ['bar', 'ring'].map(mode => ({
    value: mode, label: t(`recon.map.playback.hp_mode_${mode}`), testid: `pb-hp-mode-${mode}`,
  })))


  function realNowMs(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now()
  }

  const {
    eventCursor,
    floatItems,
    burstItems,
    resetTransients,
    consumeEvents,
    hasPendingTransients,
    pruneTransients,
    ghostFor,
    flashFor,
    visibleFeed,
  } = usePlaybackTransients({
    nowMs,
    authoritativeEvents: () => S.authoritativeEvents.value,
    hpVehicles: () => hpVehicles.value,
    vehiclesByAccount: () => S.vehiclesByAccount.value,
    feedVisible: () => !S.uiHidden.value && !!uiPrefs.showKillfeed,
  } satisfies Partial<TransientDeps>)

  const visibleFloats = computed(() => {
    const now = nowMs.value
    const active = transientsActive(floatItems.value, now)
    if (active.length === 0) return []
    const byVictim = new Map<number, typeof active>()
    for (const item of active) {
      const list = byVictim.get(item.victimAccountId) || []
      list.push(item)
      byVictim.set(item.victimAccountId, list)
    }
    const out: Array<Record<string, unknown>> = []
    for (const [victimId, list] of byVictim) {
      const st = S.vehicleStates.value.find(s => s.vehicle.accountId === victimId)
      if (!st) continue
      const p = S.markerScreen(st)
      if (!p) continue
      list.forEach((item, idx) => {
        out.push({ ...item, x: p.x, y: p.y - 34 - idx * 16, friendly: st.friendly })
      })
    }
    return out
  })
  const visibleBursts = computed(() => {
    const now = nowMs.value
    const active = transientsActive(burstItems.value, now)
    if (active.length === 0) return []
    return active.map(item => {
      const st = S.vehicleStates.value.find(s => s.vehicle.accountId === item.victimAccountId)
      if (!st) return null
      const p = S.markerScreen(st)
      if (!p) return null
      return { ...item, x: p.x, y: p.y, friendly: st.friendly }
    }).filter(Boolean)
  })

  Object.assign(S, {
    mapSemantics,
    t,
    locale,
    gunMarks,
    pbOverview,
    image,
    imageSrc,
    mapView,
    palette,
    playback,
    duration,
    friendlyTeam,
    hpVehicles,
    friendlyHp,
    enemyHp,
    friendlyPoints,
    enemyTeam,
    enemyPoints,
    baseStatesAt,
    nowMs,
    labelPrefs,
    hpPrefs,
    trailPrefs,
    markerPrefs,
    uiPrefs,
    declutterActive,
    toggleDeclutter,
    hpModeOptions,
    realNowMs,
    eventCursor,
    floatItems,
    burstItems,
    resetTransients,
    consumeEvents,
    hasPendingTransients,
    pruneTransients,
    ghostFor,
    flashFor,
    visibleFeed,
    visibleFloats,
    visibleBursts,
  })
  Object.defineProperty(S, 'paletteRequestToken', { get: () => paletteRequestToken, set: (v: number) => { paletteRequestToken = v }, configurable: true })
}