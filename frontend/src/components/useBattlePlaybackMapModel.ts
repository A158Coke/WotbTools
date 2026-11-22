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
/** 底图 URL：包内兜底，Android 上若 COS 有更新且校验通过则换成 blob URL（见 map2dOverlay.js）。 */
const imageSrc = computed(() => (image.value ? map2dSrc(pbOverview.value.mapCode!, image.value.src) : null))
const mapView = computed(() => createMapView(image.value, pbOverview.value))

// 自适应配色（与热力覆盖层使用同一色板）
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

// V2 canonical dataset 是唯一 playback 事实源（cleanup：移除 legacy overview.playback）。
const playback = computed(() => props.playbackV2 || null)
const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
const friendlyTeam = computed(() => pbOverview.value.friendlyTeam)

// 双方总血量（实时剩余，随播放时间/进度条变化；争霸赛附终局点数）。
// relativeFull 是后端投影的 presentation-safe fact；前端只按 t 查询 transition、做聚合与绘制，
// 不扫描 HP/life history 重新判断开局状态，也不把 tankopedia base 当已知血量。
const hpVehicles = computed(() => playback.value?.vehicles || [])
const friendlyHp = computed(() => friendlyHealthAt(hpVehicles.value, true, getCurrentTime()))
const enemyHp = computed(() => friendlyHealthAt(hpVehicles.value, false, getCurrentTime()))
// 争霸赛实时点数：来自回放广播 pointsSamples（随 currentTime 变化）；非争霸赛/无广播 → null 不显示
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
    // 取时间上最新的一条，而不是数组里最后出现的一条：wire 契约没有保证 baseStates
    // 按 timeSec 排序，靠数组顺序会显示已经过期的状态（例如车早已离开、占领已清空，
    // 却仍然画着占领进度）。
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
