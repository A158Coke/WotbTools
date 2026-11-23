<script setup>
defineOptions({ name: 'Replay3DPane' })

import PlaybackChatFeed from './PlaybackChatFeed.vue'
import { ref, watch } from 'vue'
import { shadowQualityEligible } from '../scene/playback/quality.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import Scene3DStatus from './Scene3DStatus.vue'
import PlaybackTransport from './PlaybackTransport.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import SceneDistanceSlider from './SceneDistanceSlider.vue'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'
import RecorderReticle from './RecorderReticle.vue'
import ReplayCameraTools from './ReplayCameraTools.vue'
import PlaybackVehicleLabels3D from './PlaybackVehicleLabels3D.vue'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'
import PlaybackRoster from './PlaybackRoster.vue'
import BaseStatusBar from './BaseStatusBar.vue'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import { PLAYBACK_SPEEDS, PLAYBACK_STEP_SECONDS } from '../composables/usePlaybackTransport.js'
import { formatPlaybackClock } from '../utils/playbackClock'
import { teamCssVars } from '../data/mapTeamColors.js'
import { ChevronDown, ChevronUp, PencilRuler, ScanEye, TriangleAlert } from 'lucide-vue-next'
import { r3dA } from './replay3dPaneA.js'
import { r3dB } from './replay3dPaneB.js'
import { r3dC } from './replay3dPaneC.js'

const props = defineProps({
  /** 工作台派生的目标回放文件；null = 还没选（面板只显示提示，不自己开文件选择器） */
  file: { type: Object, default: null },
  playbackSession: { type: Object, default: null },
  /** 当前能力是否激活：false 时停帧、停键盘，但不销毁会话 */
  active: { type: Boolean, default: false },
  /** 工作台给出的不可用原因（多文件未选场次等）；非空时不解析 */
  blockedReason: { type: String, default: '' }, autoFullscreenToken: { type: Number, default: 0 },
  /** 事件流「跳到此刻」的一次性请求 `{ id, sec }`：按 id 只消费一次（切回 3D 不重放） */
  pendingSeek: { type: Object, default: null },
})

// Playback root 角色色（SSOT = data/mapTeamColors.js）：3D 无地图差异，setup 期解析一次，
// 不做逐帧 getComputedStyle / 每次渲染重建内联 style 对象。
const playbackTeamCssVars = teamCssVars('')

// 各段按原脚本顺序执行一次（setup 期间同步），跨段引用统一走 S。
const S = {}
let guideOpenedDisplay = false
let sceneApi = null
let jumpBase = null
let lastFile = null
let portraitGeneration = 0
let parseController = null
let loadedFile = null
let laneBoundsObserver = null
Object.defineProperty(S, 'guideOpenedDisplay', { get: () => guideOpenedDisplay, set: (v) => { guideOpenedDisplay = v }, configurable: true })
Object.defineProperty(S, 'sceneApi', { get: () => sceneApi, set: (v) => { sceneApi = v }, configurable: true })
Object.defineProperty(S, 'jumpBase', { get: () => jumpBase, set: (v) => { jumpBase = v }, configurable: true })
Object.defineProperty(S, 'lastFile', { get: () => lastFile, set: (v) => { lastFile = v }, configurable: true })
Object.defineProperty(S, 'portraitGeneration', { get: () => portraitGeneration, set: (v) => { portraitGeneration = v }, configurable: true })
Object.defineProperty(S, 'parseController', { get: () => parseController, set: (v) => { parseController = v }, configurable: true })
Object.defineProperty(S, 'loadedFile', { get: () => loadedFile, set: (v) => { loadedFile = v }, configurable: true })
Object.defineProperty(S, 'laneBoundsObserver', { get: () => laneBoundsObserver, set: (v) => { laneBoundsObserver = v }, configurable: true })
r3dA(S, props)
r3dB(S, props)
r3dC(S, props)

const {
  t, locale, onboarding, availability, requireFeature, online, labelPrefs, hpPrefs,
  markerPrefs, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen, displayAnchor,
  toggleDisplay, controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose, slideContentShut,
  clearSlideHeight, dockControls, toggleControls, isPhone, isPortrait, portraitFlow, compactBar, phoneLandscape,
  selectedEid, detailsOpen, detailsSide, followFromRoster, followUnlessRecorder, handleSceneSelect, selectVehicle, detailsSideFor,
  closeDetails, cameraTools, chooseCamera, setUiHidden, toggleUiHidden, onUiToggleKeydown, showTopbar, showRoster,
  rosterEntryVisible, toggleRoster, showKillfeed, showBaseStatus, showFps, fpsText, fpsJanky, store,
  stage, labelOverlay, recorderReticle, annotationOpen, annotationTool, pushAnnotationProjection, pushAnnotationInteraction, pushAnnotationVisibility,
  commitAnnotationFromScene, eraseFromScene, openAnnotation, closeAnnotation, resetAnnotationState, annotationToolbarProps, annotationToolbarHandlers, playbackFacet,
  markerKindLabels, facetShots, facetKills, timelineHighlightEid, shotTicks, killTicks, jumpShot, rideRoster,
  rideAllyTeam, rideVehicle, transport, renderActive, fly, webgl, pushLabelPrefs, consumedSeekId,
  lastFileName, loadingMessage, paneReady, qualityBadge, mapTitle, recorderUnavailableReason, CAMERAS, QUALITY_ORDER,
  hudFriendlyHp, hudEnemyHp, hudHealth, teamColors, rosterLanes, selectedRow, detailPlayback, gunMarks,
  battleTimeLabel, detailTime, selectedTrack, selectedLife, selLastKnownSec, selCurStats, selDamageLog, selectedPortraitUrl,
  selectedDetailState, selectedHealth, bannerColor, abortParse, loadFile, retryLoad, bannerText, killfeedVerb,
  destroyScene, shouldHaveScene, ensureScene, startedFile, qualityOptions, startReplay, reconcileScene, rootEl,
  hudEl, controlsEl, SHORT_WORKSPACE_MAX_H, KILLFEED_MAX_LINES, KILLFEED_ROW_BORDER_PX, killfeedMaxLines, visibleKillfeed, shortWorkspace,
  measurePresentationBounds, observeLaneBounds, isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen, onViewportResize,
  shellChrome,
} = S
</script>

<template>
  <!-- data-pane-ready：加载中（解析 / 资产阶段）不置位；终态与就绪态均置位。 -->
  <div class="pb-pane" :data-pane-ready="paneReady ? 'true' : undefined">
    <!-- pending（首次检测未完成）：不下结论、不初始化 3D 场景，保持中性空白。 -->
    <template v-if="!online.available">
      <p v-if="!online.pending" class="pb-note" data-testid="replay3d-connectivity">{{ $t(online.messageKey) }}</p>
    </template>
    <Scene3DStatus v-else-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <!-- 两种呈现（与 2D 同一个契约）：
           `roster-side`  = 全幅场景 + 名册左上/右上悬浮 + HUD 顶中 + 传输底部居中；
                            宽档、平板、手机横屏、手机全屏横屏都是这一条；
           `portrait-flow` = 手机竖屏纵向流：HUD / Stage / 传输控件 / 详情 / Team 1 / Team 2。
         名册关闭时两者都没有车道，横屏场景铺满整个根，竖屏仍为正方形。 -->
    <div v-else class="pb-root playback-workspace transport-docked" ref="rootEl" :class="{ 'phone-form': isPhone, 'portrait-flow': portraitFlow, 'roster-side': showRoster && !portraitFlow, 'compact-bar': compactBar }" :style="playbackTeamCssVars" data-testid="replay3d-root" data-scene-surface data-tour="replay3d-workspace">
      <!-- 名牌覆盖层与 canvas 共用**同一个画布盒子**：场景内核按 canvas（.scene）尺寸算锚点，
           覆盖层必须与它同原点，否则三段式下名牌会整体偏一条车道宽。 -->
      <!-- 手机全屏入口：竖屏浮动、横屏内联；隐藏全部 UI 时保留唯一浮动入口，三态互斥。 -->
      <SceneFullscreenButton
        v-if="isPhone && fullscreenSupported && (uiHidden || isPortrait)"
        floating
        :is-fullscreen="isFullscreen"
        data-test="pb-fullscreen"
        data-testid="playback-fullscreen"
        @toggle="toggleFullscreen()"
      />
      <!-- 移动端竖向距离滑条：仅手机横屏显示（竖屏隐藏，判据与布局同一
           usePlaybackPortraitViewport）；停右下角，传输条右侧预留同宽空槽；Follow/Recorder
           相机所有权不动（free/top 才可用），Hide All UI 时随控件一起隐藏。 -->
      <SceneDistanceSlider
        :get-scene-api="() => sceneApi"
        :visible="isPhone && !isPortrait && !uiHidden && (store.cam === 'free' || store.cam === 'top')"
      />
      <div class="pb-stage" data-testid="replay3d-stage" :data-quality="store.qualityKey" :data-camera="store.cam">
        <div class="stage-square">
          <div ref="stage" class="scene"></div>
          <!-- 快捷指令 / 聊天 / 地图标记滚动流（左下）：与事件流同一行文案事实源（子组件） -->
          <PlaybackChatFeed :facet="playbackFacet" :time="store.time" :hidden="uiHidden || !store.hasData" />
          <PlaybackVehicleLabels3D :gun-marks="gunMarks" ref="labelOverlay"  :label-prefs="labelPrefs" :hp-prefs="hpPrefs" :marker-prefs="markerPrefs" :last-known-label="t('agentReplay.label_last_known')" :marker-kind-labels="markerKindLabels" :selected-eid="selectedEid" :hidden="uiHidden || !store.hasData" :interactive="!annotationTool" @select="handleSceneSelect" />
          <RecorderReticle ref="recorderReticle" :suppressed="uiHidden" />
          <div v-if="showFps" class="pb-fps" :class="{ 'pb-fps-low': fpsJanky }" data-testid="replay3d-fps" aria-hidden="true">{{ fpsText }}</div>
        </div>
      </div>

      <!-- Only persistent state contributes to measured HUD height. Kill events stay in a bounded overlay. -->
      <div v-if="store.hasData && (showTopbar || showBaseStatus || showKillfeed)" ref="hudEl" class="hud">
        <BattlePlaybackHud
          v-if="showTopbar || (showBaseStatus && store.baseViews.length)"
          :class="{ topbar: showTopbar }"
          :show-summary="showTopbar"
          score-label-key="recon.map.playback.kills"
          :map-title="mapTitle"
          :battle-time="battleTimeLabel"
          :friendly-hp="hudFriendlyHp"
          :enemy-hp="hudEnemyHp"
          :friendly-points="store.scoreFriend"
          :enemy-points="store.scoreEnemy"
          :hp-no-transition="!store.playing"
          :compact="phoneLandscape"
        >
          <template v-if="showBaseStatus && store.baseViews.length" #bases>
            <BaseStatusBar compact class="base-status" :bases="store.baseViews" :friendly-points="store.pointsFriend" :enemy-points="store.pointsEnemy" />
          </template>
        </BattlePlaybackHud>
        <div v-if="showKillfeed && store.killfeed.length" class="killfeed" data-test="replay3d-killfeed" aria-hidden="true">
          <div v-for="kf in visibleKillfeed" :key="kf.id" class="kf">
            <template v-if="kf.kill">
              <span class="kf-name" :class="kf.killerSide && 'kf-' + kf.killerSide">{{ kf.killer }}</span>
              <span v-if="kf.killerTank" class="kf-tank">{{ kf.killerTank }}</span>
              <span class="kf-verb">{{ killfeedVerb(kf) }}</span>
            </template>
            <span class="kf-name" :class="kf.victimSide && 'kf-' + kf.victimSide">{{ kf.victim }}</span>
            <span v-if="kf.victimTank" class="kf-tank">{{ kf.victimTank }}</span>
            <span v-if="!kf.kill" class="kf-verb">{{ killfeedVerb(kf) }}</span>
          </div>
        </div>
      </div>

      <!-- 详情是**整个 3D 战场 workspace（.pb-root）顶层**的可拖动浮窗（与 2D 同一个组件、
           同一份位置所有权）：它是 .pb-root 的直接子级，不属于 Stage、也不属于任何一条名册
           车道，可以拖到 Team 1 / Stage / Team 2 任意一栏之上。下缘不得越过传输控件
           （drag-bounds）。竖屏换成纵向流里的 inline 内容块（同一个组件）。
           与名册**互不影响**：名册开着时详情照样在，换选 Team 2 的车只是更新同一个窗。 -->
      <VehicleDetailsPanel
        v-if="!uiHidden && detailsOpen && selectedRow"
        class="vehicle-details" data-testid="replay3d-details"
        :presentation="portraitFlow ? 'inline' : 'floating'"
        :gun-marks="gunMarks.get(selectedRow.accountId) ?? null"
        :selected-state="selectedDetailState" :health="selectedHealth" :phone-form="portraitFlow"
        :selected-portrait-url="selectedPortraitUrl" :sel-last-known-sec="selLastKnownSec"
        :sel-cur-stats="selCurStats" :selected-track="selectedTrack" :sel-damage-log="selDamageLog"
        :current-time="detailTime" :format-clock="formatPlaybackClock"
        :drag-host="rootEl" :drag-bounds="controlsEl"
        :initial-side="detailsSide" :initial-vertical="'bottom'" :selection-key="selectedEid"
        @close="closeDetails"
      />

      <!-- 阵容车道：Recorder 己方左 / 敌方右，未知阵营列在左车道底部；竖屏是纵向流两段。
           名册唯一开关 = uiPrefs.showRoster；行渲染与 2D 共用同一个 `PlaybackRoster`。 -->
      <div v-if="store.hasData && showRoster" class="roster-surface" data-testid="roster-surface">
        <div class="team-lane side-left" data-testid="replay3d-lane-left">
          <PlaybackRoster :gun-marks="gunMarks" variant="3d" :compact="!portraitFlow" :dense="phoneLandscape" :teams="rosterLanes.left" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="followFromRoster" />
        </div>
        <div class="team-lane side-right" data-testid="replay3d-lane-right">
          <PlaybackRoster :gun-marks="gunMarks" variant="3d" :compact="!portraitFlow" :dense="phoneLandscape" :teams="rosterLanes.right" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="followFromRoster" />
        </div>
      </div>

      <div v-if="!uiHidden && store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

      <!-- 隐藏全部 UI：连底部播放控件一起让位（这是「只看战场」的语义）；
           `H` 键或右上角常驻按钮随时恢复。resize 观测对 null 元素是安全的（watch(controlsEl)）。 -->
      <div v-if="store.hasData && !uiHidden" ref="controlsEl" class="controls panel" :class="{ 'controls-collapsed': controlsCollapsed, 'controls-docked': controlsDocked }">
        <button type="button" class="controls-toggle pb-quick-action" data-testid="replay3d-controls-toggle"
          :aria-expanded="!controlsCollapsed" :aria-controls="controlsContentId"
          :aria-label="t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          :title="t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          @click="toggleControls">
          <component :is="controlsCollapsed ? ChevronUp : ChevronDown" :size="18" aria-hidden="true" />
        </button>
        <Transition
          name="controls-slide"
          @before-enter="slideContentFrom"
          @enter="slideContentOpen"
          @after-enter="clearSlideHeight"
          @enter-cancelled="clearSlideHeight"
          @before-leave="slideContentClose"
          @leave="slideContentShut"
          @after-leave="dockControls"
          @leave-cancelled="clearSlideHeight"
        >
        <div v-show="!controlsCollapsed" :id="controlsContentId" class="controls-content">
          <div v-if="annotationOpen" class="replay3d-annotations" data-test="replay3d-annotations">
            <AnnotationToolbar v-bind="annotationToolbarProps" compact v-on="annotationToolbarHandlers" />
          </div>
          <!-- 高频查看动作直接陈列（2026-10-05 从 Display 移出）：镜头 + GLB + Drawing 入口；
               紧凑条放不下时进 Display 面；Drawing 打开时本行让位给 AnnotationToolbar。 -->
          <ReplayCameraTools v-if="!compactBar && !annotationOpen" v-bind="cameraTools" @update:cam="chooseCamera($event)" @update:glb="sceneApi.setGlb($event)">
            <button
              type="button" class="tool-btn drawing-entry"
              data-testid="replay3d-drawing-entry"
              :disabled="store.cam === 'recorder'"
              data-tour="playback-annotation-entry"
              :aria-label="t('recon.map.playback.annot.mode')"
              :title="t('recon.map.playback.annot.mode')"
              @click="openAnnotation()"
            >
              <PencilRuler :size="16" aria-hidden="true" /> {{ t('recon.map.playback.annot.mode') }}
            </button>
          </ReplayCameraTools>
          <!-- 与 2D 回放同一套传输控件（时间轴 / 倍速 / mm:ss 一致），次级行统一在主进度条上方 -->
          <PlaybackTransport
            :fullscreen-supported="fullscreenSupported"
            :is-fullscreen="isFullscreen"
            :floating-fullscreen="isPhone && isPortrait"
            :display-open="displayOpen"
            display-enabled
            @toggle-fullscreen="toggleFullscreen()"
            @toggle-display="toggleDisplay"
            :playing="store.playing"
            :speed="store.speed"
            :speeds="PLAYBACK_SPEEDS"
            :current-time="store.time"
            :start-time="store.startTime"
            :duration="store.duration"
            :step-seconds="PLAYBACK_STEP_SECONDS"
            :compact="isPhone"
            :nav-eligible="active && !controlsCollapsed"
            :roster-entry-visible="rosterEntryVisible"
            :roster-open="showRoster"
            @toggle-roster="toggleRoster"
            :shot-ticks="shotTicks"
            :kill-ticks="killTicks"
            :shortcuts-hint="t('agentReplay.shortcuts_hint')"
            @toggle-play="transport.togglePlay()"
            @step="sceneApi.seekBy($event)"
            @set-speed="sceneApi.setSpeed($event)"
            @seek="sceneApi.seekTime($event)"
            @scrub-start="store.seeking = true; transport.scrubStart()"
            @scrub-end="store.seeking = false; transport.scrubEnd()"
          >
          </PlaybackTransport>
        </div>
        </Transition>
        <!-- Drawing 是创作工具，不是 Display 里的偏好：紧凑控制条也常驻入口，但仍不进 shared transport。 -->
        <button
          v-if="compactBar && !annotationOpen && !controlsCollapsed"
          type="button" class="pb-quick-action drawing-entry"
          data-testid="replay3d-drawing-entry"
          :disabled="store.cam === 'recorder'"
          data-tour="playback-annotation-entry"
          :aria-label="t('recon.map.playback.annot.mode')"
          :title="t('recon.map.playback.annot.mode')"
          @click="openAnnotation()"
        >
          <PencilRuler :size="16" aria-hidden="true" />
        </button>
      </div>

      <PlaybackDisplaySurface :open="displayOpen && !uiHidden" :portrait="portraitFlow" :anchor="displayAnchor" :host="rootEl" @close="displayOpen = false">
        <!-- 查看 / 显示开关都在这里（同一份 store.cam / uiPrefs / labelPrefs / hpPrefs / store.glbOn，
             没有第二套状态）：高频动作之外的设置不该永久占着战场高度。
             场景上不放常驻开关（design-language §5），名册与防遮都只在这里。 -->
          <ReplayCameraTools v-if="compactBar" v-bind="cameraTools" :hint="recorderUnavailableReason" @update:cam="chooseCamera($event)" @update:glb="sceneApi.setGlb($event)" />
          <p class="dp-title">{{ t('agentReplay.display_battlefield') }}</p>
        <label class="toggle" :title="store.treadAllowed ? '' : t('agentReplay.tread_gate_hint')">
          <input type="checkbox" data-testid="disp-tread" :checked="store.treadOn" :disabled="!store.treadAllowed" @change="sceneApi.setTreadMarks($event.target.checked)"> {{ t('agentReplay.tread_marks') }}
        </label>
        <!-- 可视性诚实呈现（默认开）：离场坦克显示最后已知位置（幽灵名牌 + 半透明代理） -->
        <label class="toggle">
          <input type="checkbox" data-testid="disp-last-known" :checked="lastKnownPrefs.showLastKnown" @change="lastKnownPrefs.showLastKnown = $event.target.checked"> {{ t('agentReplay.display_last_known') }}
        </label>
        <!-- 回放事实边界的一行固定说明（帮助区）：紧跟该开关，语义可循 -->
        <p class="dp-note" data-testid="replay3d-visibility-note">{{ t('agentReplay.visibility_note') }}</p>
        <!-- 战场快捷标记（0x2e / attention_to_cell）：移动 ping / 目标光环 / 注意扇区高亮（持久化偏好） -->
        <label class="toggle">
          <input type="checkbox" data-testid="disp-battle-markers" :checked="markerPrefs.battleMarkers" @change="markerPrefs.battleMarkers = $event.target.checked"> {{ t('agentReplay.display_battle_markers') }}
        </label>
        <label class="toggle"><input type="checkbox" data-testid="disp-topbar" :checked="uiPrefs.showTopbar" @change="uiPrefs.showTopbar = $event.target.checked"> {{ t('agentReplay.display_topbar') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-roster" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ t('agentReplay.display_roster') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-killfeed" :checked="uiPrefs.showKillfeed" @change="uiPrefs.showKillfeed = $event.target.checked"> {{ t('agentReplay.display_killfeed') }}</label>
        <button type="button" class="tool-btn dp-declutter" data-test="pb-declutter" :aria-pressed="declutterActive" :title="t('recon.map.playback.declutter_hint_3d')" @click="toggleDeclutter('hidden')">
          <ScanEye :size="18" aria-hidden="true" /> {{ t('recon.map.playback.declutter') }}
        </button>
        <label class="toggle"><input type="checkbox" data-testid="disp-base" :checked="uiPrefs.showBaseStatus" @change="uiPrefs.showBaseStatus = $event.target.checked"> {{ t('agentReplay.display_base') }}</label>
        <p class="dp-title">{{ t('agentReplay.display_labels') }}</p>
        <label class="toggle"><input type="checkbox" data-testid="disp-class-icons" :checked="markerPrefs.classIcons" @change="markerPrefs.classIcons = $event.target.checked"> {{ t('recon.map.playback.class_icons') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-status" :checked="markerPrefs.showStatus" @change="markerPrefs.showStatus = $event.target.checked"> {{ t('recon.map.playback.show_status_3d') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-player" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ t('recon.map.playback.show_player_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-tank" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ t('recon.map.playback.show_tank_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-hp" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ t('recon.map.playback.show_hp') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-reload" :checked="labelPrefs.showReload" @change="labelPrefs.showReload = $event.target.checked"> {{ t('agentReplay.display_reload') }}</label>
        <!-- 画质在紧凑档是只读徽标（档位在播放前定型，运行中不可改），宽档同样只在工具条展示 -->
        <p class="q-badge dp-quality" :title="t('agentReplay.q_title')">{{ qualityBadge }}</p>
        <!-- 快捷键速查（帮助区；触屏没有 tooltip，可见帮助区兜底）：与时间轴 tooltip 同一份文案 -->
        <p class="dp-shortcuts" data-testid="replay3d-shortcuts">{{ t('agentReplay.shortcuts_hint') }}</p>
        <button
          type="button" class="tool-btn dp-hide" data-testid="hide-all-ui"
          @click="setUiHidden(true)"
        >{{ t('agentReplay.hide_all_ui') }}</button>
        <!-- 紧凑档面板是覆盖战场的浮层，必须有明确关闭入口（宽档点触发按钮即可，这里要能一眼看到） -->
        <button
          type="button" class="tool-btn dp-close"
          data-testid="display-close" @click="displayOpen = false"
        >{{ t('app.close') }}</button>
      </PlaybackDisplaySurface>

      <!-- 隐藏全部 UI 后唯一的恢复入口：常驻、极简、不遮场景中心；`H` 键等效。
           不得做成不可逆状态（该状态也不写入持久化偏好）。 -->
      <button
        v-if="uiHidden" type="button" class="ui-restore tool-btn panel"
        :class="{ 'ui-restore-shifted': isPhone && fullscreenSupported }"
        data-testid="show-all-ui" :title="t('agentReplay.show_all_ui_hint')"
        @click="setUiHidden(false)"
      >{{ t('agentReplay.show_all_ui') }}</button>

      <!-- 待开播：画质先定型再解析 + 拉资产（内核在 startPlayback 惰性建渲染器、首帧按当前档位） -->
      <div v-if="!uiHidden && file !== startedFile" class="pre-start" data-test="replay3d-pending">
        <div class="pre-start-card" data-tour="replay3d-start">
          <h3>{{ t('agentReplay.title') }}</h3>
          <p class="pre-start-file">{{ t('agentReplay.ready_file', { name: file.name || 'replay' }) }}</p>
          <SegmentedControl
            :model-value="store.qualityKey"
            :options="qualityOptions"
            :aria-label="t('agentReplay.quality')"
            data-testid="replay3d-quality"
            @update:model-value="sceneApi.setQuality($event)"
          />
          <!-- 渲染性能偏好与画质一同定型（同为此处的一次性选择；渲染上下文级
               参数，切换会重载会话——放在待开播阶段让「开始」总是按所选偏好起播） -->
          <div class="pre-start-advanced" role="group" :aria-label="t('agentReplay.performance_options')" data-test="replay3d-perf-options">
            <div class="pre-start-perf">
            <label class="toggle" :title="t('agentReplay.perf_logdepth_hint')">
              <input type="checkbox" data-testid="perf-logdepth" :checked="store.logdepth" @change="sceneApi.setLogdepth($event.target.checked)"> {{ t('agentReplay.perf_logdepth') }}
            </label>
            <label class="toggle" :title="t('agentReplay.perf_dynres_hint')">
              <input type="checkbox" data-testid="perf-dynres" :checked="store.dynres" @change="sceneApi.setDynres($event.target.checked)"> {{ t('agentReplay.perf_dynres') }}
            </label>
            <label class="toggle" :title="t('agentReplay.perf_armor_highlight_hint')">
              <input type="checkbox" data-testid="perf-armor-highlight" :checked="store.armorHighlight" @change="sceneApi.setArmorHighlight($event.target.checked)"> {{ t('agentReplay.perf_armor_highlight') }}
            </label>
            <label class="toggle" :title="t('agentReplay.perf_contact_shadows_hint')">
              <input type="checkbox" data-testid="perf-contact-shadows" :disabled="!shadowQualityEligible(store.qualityKey)" :checked="store.contactShadows" @change="sceneApi.setContactShadows($event.target.checked)"> {{ t('agentReplay.perf_contact_shadows') }}
            </label>
            </div>
            <p class="pre-start-perf-note">{{ t('agentReplay.perf_load_note') }}</p>
          </div>
          <AppButton variant="primary" data-test="replay3d-start" @click="startReplay">{{ t('agentReplay.start') }}</AppButton>
        </div>
      </div>

      <!-- 审计 3D-23：解析为不确定进度，地图资产阶段按段 / 字节推进；失败给出原因与重试 -->
      <Scene3DStatus
        v-if="!uiHidden && store.loading"
        mode="loading"
        :progress="store.assetStage ? store.assetProgress : null"
        :message="loadingMessage"
      />
      <Scene3DStatus
        v-else-if="!uiHidden && store.err"
        mode="error"
        :message="t('agentReplay.error_load', { msg: store.err })"
        :retryable="!!lastFileName"
        dismissible
        @retry="retryLoad"
        @dismiss="store.err = ''"
      />
      <!-- 资产降级是**非阻塞**状态：场景可玩，但地形/建筑/贴图缺失必须让用户看见，
           不能再表现为“健康加载完成”（assetIssues 明细留控制台/诊断）。 -->
      <div
        v-if="!uiHidden && store.hasData && store.assetDegraded"
        class="asset-degraded"
        data-testid="scene3d-asset-degraded"
        role="status"
        aria-live="polite"
      >
        <TriangleAlert :size="16" aria-hidden="true" />
        <span>{{ t('agentReplay.asset_degraded') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="./replay3dPane.css"></style>
