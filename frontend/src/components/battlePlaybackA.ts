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

/** 地图底图条目（mapImages 的运行时形状；只依赖 src 与透传字段）。 */
interface MapImageLike {
  src: string
  [key: string]: unknown
}

/** A 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
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

  /**
   * 呈现元数据（Battle Playback PRIMARY 核心输入）：V2 canonical dataset 为权威源
   * （mapCode / friendlyTeam / recorderAccountId / arenaBonusType），MapOverview 仅提供可选 overlay
   * 事实（gridCells / spawnPoints / routes / playableBounds）。V2 metadata 缺失保持 null；不从 overview 推导。
   * 副要求：Battle Playback 不依赖 MapOverview artifact 存在才能渲染。
   */
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
  /** 底图 URL：包内兜底，Android 上若 COS 有更新且校验通过则换成 blob URL（见 map2dOverlay.js）。 */
  const imageSrc = computed(() => {
    const layer = image.value
    return layer ? map2dSrc(pbOverview.value.mapCode ?? '', layer.src) : null
  })
  const mapView = computed(() => createMapView(image.value, pbOverview.value))

  // 自适应配色（与热力覆盖层使用同一色板）
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

  // V2 canonical dataset 是唯一 playback 事实源（cleanup：移除 legacy overview.playback）。
  const playback = computed(() => props.playbackV2 || null)
  const duration = computed(() => (playback.value ? Math.max(0, playback.value.durationSec) : 0))
  const friendlyTeam = computed(() => pbOverview.value.friendlyTeam)

  // 双方总血量（实时剩余；争霸赛附终局点数）：relativeFull 是 presentation-safe fact，前端只按 t 查询。
  const hpVehicles = computed<VehiclePlaybackTrack[]>(() => playback.value?.vehicles || [])
  const friendlyHp = computed(() => friendlyHealthAt(hpVehicles.value, true, S.currentTime.value))
  const enemyHp = computed(() => friendlyHealthAt(hpVehicles.value, false, S.currentTime.value))
  // 争霸赛实时点数：来自回放广播 pointsSamples（随 currentTime 变化）；非争霸赛/无广播 → null 不显示
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
      // 取时间上最新的一条，而不是数组里最后出现的一条：wire 契约没有保证 baseStates
      // 按 timeSec 排序，靠数组顺序会显示已经过期的状态（例如车早已离开、占领已清空，
      // 却仍然画着占领进度）。
      const kept = latest.get(state.baseId)
      if (!kept || state.timeSec >= kept.timeSec) latest.set(state.baseId, state)
    }
    return [...latest.values()].sort((a, b) => a.baseId.localeCompare(b.baseId))
  })

  // ---- 播放状态：clock owner = usePlaybackClock；transient 基准 = wall clock（播放帧刷新，暂停走轻量 RAF）。
  const nowMs = ref(typeof performance !== 'undefined' ? performance.now() : 0)
  // Playback presentation preferences have one persistence owner. BattlePlayback only consumes refs.
  const { labelPrefs, hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter } = usePlaybackPreferences()
  const hpModeOptions = computed(() => ['bar', 'ring'].map(mode => ({
    value: mode, label: t(`recon.map.playback.hp_mode_${mode}`), testid: `pb-hp-mode-${mode}`,
  })))

  // ---- PR5（§1.3/§10/§16/§20）：deterministic state 与 transient feedback 分层；owner = usePlaybackTransients。
  // transient 全部 wall-clock 驱动，播放帧消费新跨过的事件；seek 清空不补播、pause 自然完成、resume 不重复。
  // 本组件只保留 playback clock（frame/pause RAF）与地图投影（markerScreen → visibleFloats/Bursts）。
  // Blocker 1：consumption 源 = authoritativeEvents（原始 playback events），
  // 不受 Event Panel 折叠状态影响。

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
    // 与 kill feed 模板消费条件（!uiHidden && uiPrefs.showKillfeed）同口径：隐藏时不驱动暂停时钟。
    feedVisible: () => !S.uiHidden.value && !!uiPrefs.showKillfeed,
  } satisfies Partial<TransientDeps>)

  // ---- transient 渲染视图（wall-clock 过滤 + 屏幕定位；状态 owner = usePlaybackTransients）----
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
      // §10.1：连续快速受击纵向 stack/stagger，每条独立生命周期
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
  // visibleFeed 由 usePlaybackTransients 提供（activeFeed 权威队列投影）。

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