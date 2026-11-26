import { createPlaybackStore } from '../scene/playbackStore.js'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SceneApiLike } from './replay3dPaneA.js'

type I18nT = ReturnType<typeof useI18n>['t']
type Availability = { pending: boolean; available: boolean }

export interface R3dBParts {
  t: I18nT
  locale: Ref<string>
  selectedEid: Ref<number | null>
  jumpBase: number | null
  sceneApi: SceneApiLike | null
  displayOpen: Ref<boolean>
  followFromRoster: (eid: number) => void
  hpPrefs: { showHp: boolean }
  labelPrefs: { showPlayerName: boolean; showTankName: boolean; showReload: boolean }
  lastKnownPrefs: { showLastKnown: boolean }
  markerPrefs: { classIcons: boolean; classIcons3d: boolean; showStatus: boolean; battleMarkers?: boolean }
  online: Ref<Availability>
  startedFile: Ref<unknown>
  uiHidden: Ref<boolean>
  isPhone: Ref<boolean>
}

export interface R3dBProps {
  active: boolean
  blockedReason: string
  file: unknown
  pendingSeek: { id: number; sec: number; speed?: number; playing?: boolean } | null
}
import { computed, ref, watch } from 'vue'
import { publishViewerClock } from '../scene/playback/viewerClockSync.js'
import { useSceneAnnotations } from '../composables/useSceneAnnotations.js'
import { buildKillTicks, buildShotTicks, findNextShotTime, findPrevShotTime, rosterRideTarget } from '../utils/playbackShortcuts.ts'
import { usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import { useSceneActivity } from '../composables/useSceneActivity'
import { useSceneFlyControls } from '../composables/useSceneFlyControls.js'
import { detectWebGL } from '../scene/webglSupport.js'
import { mapLabel } from '../utils/helpers.js'
import { QUALITY_PRESETS } from '../scene/playbackScene.js'
import { PLAYBACK_ROLES } from '../data/mapTeamColors.js'
import { rosterLanesFor } from '../scene/rosterState.js'
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { formatPlaybackClock } from '../utils/playbackClock'

export function r3dB(S: R3dBParts, props: R3dBProps): void {
const store = createPlaybackStore()
watch([() => store.time, () => store.playing, () => store.hasData, () => store.startTime, () => store.speed], ([t, p, ready, startRaw, s]) => publishViewerClock('3d', t - startRaw, p, ready, startRaw, s), { immediate: true })
const stage = ref<HTMLElement | null>(null)
const labelOverlay = ref<HTMLElement | null>(null)
const recorderReticle = ref<HTMLElement | null>(null)

const {
  annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState,
  toolbarProps: annotationToolbarProps, toolbarHandlers: annotationToolbarHandlers,
} = useSceneAnnotations({
  getSceneApi: () => S.sceneApi,
  interactionReady: () => store.hasData,
  canOpen: () => store.cam !== 'recorder',
  onOpen: () => { S.displayOpen.value = false },
})
const playbackFacet = computed(() => store.playbackSession?.scenePlayback ?? null)
const markerKindLabels = computed(() => ({
  ping: S.t('battleMarkers.kind_ping'), help: S.t('battleMarkers.kind_help'),
  attack: S.t('battleMarkers.kind_attack'), retreat: S.t('battleMarkers.kind_retreat'),
  sector: S.t('battleMarkers.kind_sector'),
  target_attack: (target: string, who: string) => S.t('battleMarkers.target_attack', { target, who }), target_retreat: (target: string, who: string) => S.t('battleMarkers.target_retreat', { target, who }),
}))
const facetShots = computed(() => Array.isArray(playbackFacet.value?.shots) ? playbackFacet.value.shots : [])
const facetKills = computed(() => Array.isArray(playbackFacet.value?.kills) ? playbackFacet.value.kills : [])
const timelineHighlightEid = computed(() => (store.cam === 'follow' && S.selectedEid.value != null) ? S.selectedEid.value : null)
const shotTicks = computed(() => buildShotTicks(facetShots.value, store.startTime, store.duration, timelineHighlightEid.value))
const killTicks = computed(() => buildKillTicks(facetKills.value, store.startTime, store.duration))

function jumpShot(direction: -1 | 1): void {
  const shots = facetShots.value
  const base = S.jumpBase ?? store.time
  const target = direction < 0
    ? findPrevShotTime(shots, base)
    : findNextShotTime(shots, base)
  if (target == null) return
  S.jumpBase = target
  const seekTo = Math.max(store.startTime, target - 0.05)
  S.sceneApi?.seekTime(seekTo)
}

watch(() => store.time, (t) => {
  if (S.jumpBase == null) return
  if (Math.abs(t - (S.jumpBase - 0.05)) > 0.11) S.jumpBase = null
})

const rideRoster = computed(() => {
  const groups = store.roster
  return [...(groups.team1 || []), ...(groups.team2 || [])]
})
const rideAllyTeam = computed(() => (store.friendlyTeam === 1 || store.friendlyTeam === 2) ? store.friendlyTeam : null)
function rideVehicle(digit: number, isShift: boolean): void {
  const eid = rosterRideTarget(rideRoster.value, digit, isShift, rideAllyTeam.value)
  if (eid == null) return
  S.followFromRoster(eid)
}

const transport = usePlaybackTransport({
  isPlaying: () => store.playing,
  play: () => S.sceneApi?.setPlaying(true),
  pause: () => S.sceneApi?.setPlaying(false),
  step: (delta) => S.sceneApi?.seekBy(delta),
  isAtEnd: () => store.hasData && store.duration > store.startTime && store.time >= store.duration,
  restart: () => S.sceneApi?.seekTime(store.startTime),
  isReady: () => store.hasData,
  isActive: () => props.active,
  jumpShot,
  rideVehicle,
  isFlyMode: () => store.cam === 'free',
})
const renderActive = useSceneActivity(() => props.active)
const fly = useSceneFlyControls({
  setFlySpeed: (n) => S.sceneApi?.setFlySpeed(n),
  isActive: () => renderActive.value,
  canFly: () => !!S.sceneApi && store.hasData && !props.blockedReason,
  getSceneApi: () => S.sceneApi,
})
const webgl = detectWebGL()

/**
 * 3D 类型图标的独立投影：场景 wire 合同仍是 classIcons，值只取 3D 偏好。
 * 其他字段透传，2D 的 classIcons 不会进入 3D。
 */
const markerPrefs3d = computed(() => ({ ...S.markerPrefs, classIcons: S.markerPrefs.classIcons3d }))

/**
 * 把共享偏好推给场景内核（唯一方向：偏好 → 场景；场景只读，不回写）。
 * 建场景时要补推一次——内核在 initPlayback 之后才有 setLabelPrefs。
 */
function pushLabelPrefs() {
  S.sceneApi?.setLabelPrefs?.({
    enabled: !S.uiHidden.value,
    showPlayerName: S.labelPrefs.showPlayerName,
    showTankName: S.labelPrefs.showTankName,
    showHp: S.hpPrefs.showHp,
    showReload: S.labelPrefs.showReload,
    classIcons: markerPrefs3d.value.classIcons,
    showStatus: S.markerPrefs.showStatus,
    lastKnown: S.lastKnownPrefs.showLastKnown,
  })
}
watch([S.labelPrefs, S.hpPrefs, S.markerPrefs, S.lastKnownPrefs, S.uiHidden], pushLabelPrefs, { deep: true })
watch([() => S.markerPrefs.battleMarkers, S.uiHidden], ([on, hidden]) => S.sceneApi?.setBattleMarkers?.(!!on && !hidden))
watch(S.isPhone, (v) => S.sceneApi?.setMobileTouch?.(v))

const consumedSeekId = ref<number | null>(null)
watch((): [R3dBProps['pendingSeek'], boolean, boolean] => [props.pendingSeek, props.active, store.hasData], ([req]) => {
  const r = req
  if (!r || typeof r.sec !== 'number' || typeof r.id !== 'number') return
  if (r.id === consumedSeekId.value) return
  if (!props.active || !store.hasData || !S.sceneApi?.seekTime) return
  S.sceneApi.seekTime(r.sec)
  if (typeof r.speed === 'number' && Number.isFinite(r.speed)) S.sceneApi.setSpeed(r.speed)
  if (typeof r.playing === 'boolean') S.sceneApi.setPlaying(r.playing)
  consumedSeekId.value = r.id
})


const lastFileName = ref('')
const loadingMessage = computed(() => S.t(store.assetStage ? 'agentReplay.loading_assets' : 'agentReplay.parsing'))
const paneReady = computed(() => !props.file || !!props.blockedReason || !S.online.value.available
  || !webgl.supported || !!store.err || !!store.hasData
  || props.file !== S.startedFile.value)

const qualityBadge = computed(() =>
  S.t('agentReplay.quality') + ' · ' + S.t('agentReplay.q_' + store.qualityKey),
)

const mapTitle = computed(() => {
  const key = store.mapKey
  const byKey = key ? mapLabel(key, S.locale.value) : null
  if (byKey && byKey !== key) return byKey
  return mapLabel(store.mapName, S.locale.value) || store.mapName
})

const recorderUnavailableReason = computed(() => {
  if (store.recorderViewAvailable) return ''
  if (store.recorderCameraStatus === 'loading') return S.t('agentReplay.cam_recorder_loading')
  if (store.recorderCameraStatus === 'ready' && !store.recorderModeUnknown) return S.t('agentReplay.cam_recorder_dead')
  return S.t('agentReplay.cam_recorder_unsupported')
})
const CAMERAS = computed(() => [
  { value: 'free', label: S.t('agentReplay.cam_free') },
  { value: 'top', label: S.t('agentReplay.cam_sandbox') },
  {
    value: 'recorder',
    label: S.t('agentReplay.cam_recorder'),
    disabled: !store.recorderViewAvailable,
    title: recorderUnavailableReason.value,
  },
])
const QUALITY_ORDER = Object.keys(QUALITY_PRESETS)

const hudFriendlyHp = computed(() => hudHealth(store.hpFriend, store.hpFriendMax))
const hudEnemyHp = computed(() => hudHealth(store.hpEnemy, store.hpEnemyMax))
function hudHealth(current: unknown, maximum: unknown): { state: string; knownRemaining: number; totalMax: number; unknownMax: number } {
  return {
    state: 'EXACT',
    knownRemaining: Number.isFinite(Number(current)) ? Math.max(0, Number(current)) : 0,
    totalMax: Number.isFinite(Number(maximum)) ? Math.max(0, Number(maximum)) : 0,
    unknownMax: 0,
  }
}

const teamColors = computed(() => ({
  ally: PLAYBACK_ROLES.friendly.text,
  enemy: PLAYBACK_ROLES.enemy.text,
  unknown: PLAYBACK_ROLES.neutral.base,
}))

const rosterLanes = computed(() => rosterLanesFor(store.roster, store.friendlyTeam))

const selectedRow = computed(() => {
  if (S.selectedEid.value == null) return null
  const g = store.roster
  return g.team1.find((p) => p.eid === S.selectedEid.value)
    || g.team2.find((p) => p.eid === S.selectedEid.value)
    || g.unknown.find((p) => p.eid === S.selectedEid.value)
    || null
})

const detailPlayback = computed(() => store.hasData ? store.playbackSession?.canonical : null)
const gunMarks = computed(() => gunMarksByAccount(detailPlayback.value?.result))
watch(detailPlayback, pushLabelPrefs)
const battleTimeLabel = computed(() => formatPlaybackClock(store.time - store.startTime))
const detailTime = computed(() => Math.max(0, store.time - (detailPlayback.value?.clock?.startRaw ?? store.startTime)))
watch(detailPlayback, (canonical) => S.sceneApi?.setBattleClock?.(canonical?.clock ?? null))

  Object.assign(S, {
    store,
    stage,
    labelOverlay,
    recorderReticle,
    annotationOpen,
    annotationTool,
    pushAnnotationProjection,
    pushAnnotationInteraction,
    pushAnnotationVisibility,
    commitAnnotationFromScene,
    eraseFromScene,
    openAnnotation,
    closeAnnotation,
    resetAnnotationState,
    annotationToolbarProps,
    annotationToolbarHandlers,
    playbackFacet,
    markerKindLabels,
    facetShots,
    facetKills,
    timelineHighlightEid,
    shotTicks,
    killTicks,
    jumpShot,
    rideRoster,
    rideAllyTeam,
    rideVehicle,
    transport,
    renderActive,
    fly,
    webgl,
    pushLabelPrefs,
    markerPrefs3d,
    consumedSeekId,
    lastFileName,
    loadingMessage,
    paneReady,
    qualityBadge,
    mapTitle,
    recorderUnavailableReason,
    CAMERAS,
    QUALITY_ORDER,
    hudFriendlyHp,
    hudEnemyHp,
    hudHealth,
    teamColors,
    rosterLanes,
    selectedRow,
    detailPlayback,
    gunMarks,
    battleTimeLabel,
    detailTime
  })
}
