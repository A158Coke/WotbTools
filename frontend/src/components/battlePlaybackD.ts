import { computed, watch } from 'vue'
import type { Ref } from 'vue'
import { usePlaybackClock } from '../composables/usePlaybackClock.js'
import { publishViewerClock } from '../scene/playback/viewerClockSync.js'
import { usePlaybackVehicleProjection } from '../composables/usePlaybackVehicleProjection.js'
import type { PlaybackReplayData } from '../composables/usePlaybackReplayData.js'
import type { PlaybackMapViewLike } from '../composables/usePlaybackCamera.js'
import type { BattleEvent, BattlePlaybackDataset, VehiclePlaybackTrack } from '../types/playback-v2.js'

type ClockDeps = Parameters<typeof usePlaybackClock>[0]
type ProjectionArgs = Parameters<typeof usePlaybackVehicleProjection>
type ProjectionCamera = ProjectionArgs[1]
type ProjectionReplayData = ProjectionArgs[2]
type ProjectionDeps = ProjectionArgs[3]

/** D 段读取的跨段共享状态（结构性最小集；运行时实体在 SFC 里逐个赋值）。 */
export interface BpDParts {
  hpPrefs: { showHp: boolean }
  markerPrefs: { classIcons: boolean; showStatus: boolean }
  uiHidden: Ref<boolean>
  uiPrefs: { showKillfeed: boolean }
  t: (key: string) => string
  vehiclesByAccount: PlaybackReplayData['vehiclesByAccount']
  duration: Ref<number>
  nowMs: ClockDeps['nowMs']
  realNowMs: ClockDeps['realNowMs']
  consumeEvents: ClockDeps['consumeEvents']
  resetTransients: ClockDeps['resetTransients']
  hasPendingTransients: ClockDeps['hasPendingTransients']
  pruneTransients: ClockDeps['pruneTransients']
  eventCursor: Ref<number>
  annotationOpen: Ref<boolean>
  closeAnnotation: () => void
  mapView: Ref<PlaybackMapViewLike>
  view: ProjectionCamera['view']
  mapWidth: ProjectionCamera['mapWidth']
  mapHeight: ProjectionCamera['mapHeight']
  mapRenderRect: ProjectionCamera['mapRenderRect']
  markerTransform: ProjectionCamera['markerTransform']
  overlayInverse: ProjectionCamera['overlayInverse']
  overlayInverseScale: ProjectionCamera['overlayInverseScale']
  poseAtTime: ProjectionReplayData['poseAtTime']
  poseSource: ProjectionReplayData['poseSource']
  vehicleReloadAt: ProjectionReplayData['vehicleReloadAt']
  vehicleConsumablesAt: ProjectionReplayData['vehicleConsumablesAt']
  routesByAccount: ProjectionReplayData['routesByAccount']
  projectedSemanticNorm: ProjectionReplayData['projectedSemanticNorm']
  pbOverview: Ref<{ recorderAccountId: number | null }>
  authoritativeEvents: Ref<BattleEvent[]>
  hpVehicles: Ref<VehiclePlaybackTrack[]>
  gunMarks: Ref<Map<number, number> | null>
  isMobileDevice: Ref<boolean>
  trailPrefs: ProjectionDeps['trailPrefs']
}

export interface BpDProps {
  loop: boolean
  seekTo: number | null
  clockOffset: number | null
  playbackV2: BattlePlaybackDataset | null
}

/** 回放事件行：canonical 事件 + host 侧补的掉血观测（§11 只展示可证明的掉血）。 */
type PlaybackEventRow = BattleEvent & { observedHpLoss?: number | null }

export function bpD(S: BpDParts, props: BpDProps): void {
  const hpPrefsForMap = computed(() => ({ ...S.hpPrefs, showHp: !S.uiHidden.value && S.hpPrefs.showHp }))
  const markerPrefsForMap = computed(() => ({
    classIcons: !S.uiHidden.value && S.markerPrefs.classIcons,
    showStatus: !S.uiHidden.value && S.markerPrefs.showStatus,
  }))

  function playerName(accountId: number | null): string {
    const vehicle = accountId == null ? undefined : S.vehiclesByAccount.value.get(accountId)
    return vehicle ? (vehicle.playerName || `#${accountId}`) : (accountId == null ? S.t('recon.map.playback.unknown') : `#${accountId}`)
  }

  function eventLabel(event: PlaybackEventRow): string {
    const type = S.t(`recon.map.playback.event_${event.type}`)
    switch (event.type) {
      case 'DAMAGE':
        // §11：raw Type-8 协议值语义未证明，不得作为精确伤害展示；只显示可证明的掉血
        return event.observedHpLoss != null
          ? `${playerName(event.accountId)} → ${playerName(event.targetAccountId)} −${event.observedHpLoss}`
          : `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
      case 'KILL':
        return `${playerName(event.accountId)} → ${playerName(event.targetAccountId)}`
      case 'DESTROYED':
        return playerName(event.accountId)
      default:
        return type
    }
  }

  // ---- PR4 §36/§37：hull hitbox 点击选中（重叠时取指针最近车辆；tie 保持 selected / render order）----
  const {
    currentTime,
    playing,
    speed,
    hpNoTransition,
    play,
    pause,
    seek,
    step,
    setSpeed,
    seekToEvent,
    disposeClock,
  } = usePlaybackClock({
    duration: () => S.duration.value,
    loop: () => props.loop,
    nowMs: S.nowMs,
    realNowMs: S.realNowMs,
    consumeEvents: (fromSec, toSec) => S.consumeEvents(fromSec, toSec),
    resetTransients: (sec) => S.resetTransients(sec),
    hasPendingTransients: (now) => S.hasPendingTransients(now),
    pruneTransients: (now) => S.pruneTransients(now),
    rewindTransientCursor: () => { S.eventCursor.value = 0 },
    feedVisible: () => !S.uiHidden.value && !!S.uiPrefs.showKillfeed,
    onPlayStart: () => { if (S.annotationOpen.value) S.closeAnnotation() },
    seekTo: () => props.seekTo,
  })
  // 统一回放面板：把 2D 时钟发布到跨视图镜像，切到 3D 时按同一位置 seek。
  watch([currentTime, playing, () => props.clockOffset, speed], ([t, p, off, s]) => publishViewerClock('2d', t, p, true, off ?? 0, s), { immediate: true })

  // ---- 车辆呈现投影：preload/vehicleStates/着色/轨迹/炮线/marker 屏幕定位的唯一 owner
  // = usePlaybackVehicleProjection（#820 Agent C Step 3，时间来自 playback clock）。
  const {
    vehicleStates,
    visibleTracers,
    tracerColor,
    visibleTrails,
    canonicalMarkerScreen,
    markerScreen,
    hpFor,
    hpDisplayNumText,
  } = usePlaybackVehicleProjection(
    S.mapView,
    {
      view: S.view,
      mapWidth: S.mapWidth,
      mapHeight: S.mapHeight,
      mapRenderRect: S.mapRenderRect,
      markerTransform: S.markerTransform,
      overlayInverse: S.overlayInverse,
      overlayInverseScale: S.overlayInverseScale,
    },
    {
      poseAtTime: S.poseAtTime,
      poseSource: S.poseSource,
      vehicleReloadAt: S.vehicleReloadAt,
      vehicleConsumablesAt: S.vehicleConsumablesAt,
      routesByAccount: S.routesByAccount,
      vehiclesByAccount: S.vehiclesByAccount,
      projectedSemanticNorm: S.projectedSemanticNorm,
    },
    {
      playbackV2: () => props.playbackV2,
      recorderAccountId: () => S.pbOverview.value.recorderAccountId,
      currentTime,
      speed,
      authoritativeEvents: () => S.authoritativeEvents.value,
      hpVehicles: () => S.hpVehicles.value,
      gunMarks: () => S.gunMarks.value,
      isMobileDevice: S.isMobileDevice,
      trailPrefs: S.trailPrefs,
      t: S.t,
    },
  )

  // The workspace's guide requests real actions; drawing and clock state stay here.

  Object.assign(S, {
    hpPrefsForMap,
    markerPrefsForMap,
    playerName,
    eventLabel,
    currentTime,
    playing,
    speed,
    hpNoTransition,
    play,
    pause,
    seek,
    step,
    setSpeed,
    seekToEvent,
    disposeClock,
    vehicleStates,
    visibleTracers,
    tracerColor,
    visibleTrails,
    canonicalMarkerScreen,
    markerScreen,
    hpFor,
    hpDisplayNumText,
  })
}