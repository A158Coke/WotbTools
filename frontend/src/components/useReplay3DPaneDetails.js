import { computed, ref, watch } from 'vue'
import { gunMarksByAccount } from '../utils/gunMarks.js'
import { cumulativeStatsAtV2, healthDisplayAt, lifeAt, positionAtV2, positionCoveredAtV2 } from '../utils/battlePlaybackV2.ts'
import { detailsDamageLogAtV2 } from '../utils/playbackDetails.js'
import { usePlaybackTransport } from '../composables/usePlaybackTransport.js'
import { buildKillTicks, buildShotTicks, findNextShotTime, findPrevShotTime, rosterRideTarget } from '../utils/playbackShortcuts.ts'
import { mapLabel } from '../utils/helpers.js'
import { formatPlaybackClock } from '../utils/playbackClock'
import { QUALITY_PRESETS } from '../scene/playbackScene.js'
import { uiProfile } from '../composables/useUiProfile.js'

export function useReplay3DPaneDetails(props, core) {
  const {   t, locale, onboarding, guideOpenedDisplay, availability, requireFeature, online, labelPrefs,   hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen,   displayAnchor, toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose,   slideContentShut, clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow, compactBar,   phoneLandscape, selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect, selectVehicle,   detailsSideFor, closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown, showTopbar,   showRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store, stage,   labelOverlay, recorderReticle, sceneApiRef, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,   commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers, playbackFacet,   facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, jumpBase, rideRoster,   rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs, consumedSeekId,   lastFile, lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason, CAMERAS,   QUALITY_ORDER, hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow } = core

const detailPlayback = computed(() => store.hasData ? store.playbackSession?.canonical : null)
const gunMarks = computed(() => gunMarksByAccount(detailPlayback.value?.result))
// Canonical identity may finish after the scene facet. Refresh class symbols
// even when the replay clock is paused at the same frame.
watch(detailPlayback, pushLabelPrefs)
/**
 * 战斗时钟（与 2D 同一口径：0 = 开战）的唯一权威是场景引擎：它持有 [START, END]（发布为 store.startTime /
 * store.duration），seek、自动停止与进度都夹在里面。canonical 就绪 / 失败 / 换会话时把它的 clock 交给引擎
 * （setBattleClock），引擎重定范围并把 T 夹回去；canonical 之前引擎用自己按同一 resolver 推出的时钟。
 * 播放条、顶栏计时与 Details 只读引擎发布的原点：同一时刻在 2D / 3D 显示同一个时间。
 */
const battleTimeLabel = computed(() => formatPlaybackClock(store.time - store.startTime))
// Details 查的是 canonical track：canonical 在时必须按它自己的 clock.startRaw 换算（canonical 数据就按这个原点索引）；
// 引擎接管 canonical clock 后与 store.startTime 是同一个值，canonical 之前才用引擎发布的原点。
const detailTime = computed(() => Math.max(0, store.time - (detailPlayback.value?.clock?.startRaw ?? store.startTime)))
// Refresh life facts too when canonical finishes at an unchanged clock/time.
watch(detailPlayback, (canonical) => sceneApiRef.value?.setBattleClock?.(canonical?.clock ?? null))
const selectedTrack = computed(() => detailPlayback.value?.dataset?.vehicles.find(track =>
  selectedRow.value?.accountId != null && track.accountId === selectedRow.value.accountId) || null)
const selectedLife = computed(() => selectedTrack.value ? lifeAt(selectedTrack.value, detailTime.value) : null)
const selLastKnownSec = computed(() => {
  const track = selectedTrack.value
  if (!track || positionCoveredAtV2(track.positionSegments, detailTime.value)) return null
  return positionAtV2(track.positionSegments, detailTime.value)?.timeSec ?? null
})
const selCurStats = computed(() => selectedTrack.value
  ? cumulativeStatsAtV2(detailPlayback.value.dataset.events, selectedTrack.value, detailTime.value, detailPlayback.value.dataset.vehicles)
  : null)
const selDamageLog = computed(() => detailsDamageLogAtV2(detailPlayback.value?.dataset,
  selectedTrack.value, detailTime.value, t('recon.map.playback.source_unknown')))
const selectedPortraitUrl = ref(null)
const portraitGeneration = ref(0)
watch(() => selectedTrack.value?.tankId ?? selectedRow.value?.tankId, async tankId => {
  const generation = ++portraitGeneration.value
  selectedPortraitUrl.value = null
  if (tankId == null) return
  try {
    const { loadVehiclePortrait } = await import('../vehicle-portraits/runtime.js')
    const url = await loadVehiclePortrait(tankId)
    if (generation === portraitGeneration.value) selectedPortraitUrl.value = url
  } catch { /* Missing assets keep the panel without a portrait. */ }
})

const selectedDetailState = computed(() => selectedRow.value ? {
  vehicle: selectedTrack.value || { tankName: selectedRow.value.tank, playerName: selectedRow.value.nick,
    tankId: selectedRow.value.tankId, accountId: selectedRow.value.accountId,
    team: selectedRow.value.team, friendly: [1, 2].includes(store.friendlyTeam) && [1, 2].includes(selectedRow.value.team) ? selectedRow.value.team === store.friendlyTeam : null },
  destroyed: selectedLife.value ? selectedLife.value.lifeState === 'DESTROYED' : selectedRow.value.dead,
  destroyedKnownAtSec: selectedLife.value?.destroyedKnownAtSec ?? null,
} : null)
const selectedHealth = computed(() => {
  if (selectedTrack.value) {
    const health = healthDisplayAt(selectedTrack.value, detailTime.value)
    return { currentHp: health?.currentHp ?? null, maxHp: health?.displayCapacityHp ?? null }
  }
  return selectedRow.value ? {
    currentHp: Number.isFinite(selectedRow.value.hp) ? selectedRow.value.hp : null,
    maxHp: Number.isFinite(selectedRow.value.maxHp) && selectedRow.value.maxHp > 0 ? selectedRow.value.maxHp : null,
  } : null
})

const bannerColor = computed(() => {
  const outcome = store.banner?.outcome
  if (outcome === 'win') return teamColors.value.ally
  if (outcome === 'lose') return teamColors.value.enemy
  return teamColors.value.unknown
})

/**
 * 把目标文件交给场景内核。
 *
 * **加载状态不属于组件层**：`playbackScene.loadData()` 自己持有代数 guard 与
 * `loading` / `err` / `assetStage` / `assetProgress` 的唯一写入权（见其 finally 的
 * `gen === sessionGen || gen + 1 === sessionGen` 判定）。组件层若也写 `store.loading`，
 * 就会出现「旧场景的迟到完成把新场景的 loading 清掉」——两边代数不同步，且组件层没有
 * 任何 guard。所以这里只发命令与记录最近文件（重试用）。
 */
/**
 * 解析任务的 session 所有权（P0：replay parser lifecycle is session-owned）：
 * 清空 / 换文件 / 销毁时**真正 abort 在途解析**，不只是丢弃结果——否则旧解析继续占着
 * Worker 队列，极端情况下（Worker 不回包）新文件永远排队、面板卡在「解析中」。
 * 工作台 session 路径由 owner 在 selection 变化 / 工作台销毁时取消共享解析；
 * 独立场景路径的 signal 经 source 透传给 replaySource；被 abort 的旧加载其错误
 * 由内核的代数 guard 吞掉（新加载已接管归属），不会写成用户可见错误。
 */
return {
  t, locale, onboarding, guideOpenedDisplay, availability, requireFeature, online, labelPrefs,
  hpPrefs, markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen,
  displayAnchor, toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose,
  slideContentShut, clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow, compactBar,
  phoneLandscape, selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect, selectVehicle,
  detailsSideFor, closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown, showTopbar,
  showRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store, stage,
  labelOverlay, recorderReticle, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers, playbackFacet,
  facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, jumpBase, rideRoster,
  rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs, consumedSeekId,
  lastFile, lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason, CAMERAS,
  QUALITY_ORDER, hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow, detailPlayback,
  gunMarks, battleTimeLabel, detailTime, selectedTrack, selectedLife, selLastKnownSec, selCurStats, selDamageLog,
  selectedPortraitUrl, portraitGeneration, selectedDetailState, selectedHealth, bannerColor
}
}
