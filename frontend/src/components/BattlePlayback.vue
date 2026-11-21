<script setup>
import { mapLabel } from '../utils/helpers.js'
import { formatClock } from '../utils/battlePlayback.js'
import { ChevronDown, ChevronUp, PencilRuler, ScanEye } from 'lucide-vue-next'
import { ANNOT_COLORS, ANNOT_FONT_SIZE, ANNOT_WIDTH_MAX, ANNOT_WIDTH_MIN, canRedo, canUndo } from '../utils/annotation.js'
import BattleMap from './BattleMap.vue'
import AnnotationToolbar from './AnnotationToolbar.vue'
import BattlePlaybackHud from './BattlePlaybackHud.vue'
import PlaybackControls from './PlaybackControls.vue'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import PlaybackDisplaySurface from './PlaybackDisplaySurface.vue'
import SegmentedControl from './SegmentedControl.vue'
import PlaybackMobileOverlay from './PlaybackMobileOverlay.vue'
import VehicleDetailsPanel from './VehicleDetailsPanel.vue'
import PlaybackRoster from './PlaybackRoster.vue'
import { useBattlePlaybackModel } from './useBattlePlaybackModel.ts'

/**
 * 战局回放（Battle Playback）：地图鸟瞰中的主播放视图。
 * 复用 mapImages 素材、coordinateBounds 坐标映射、自适应色板与响应式布局；
 * RAF 只推进 battle-relative 时间，坐标查询遵循 canonical positionSegments。
 */
const props = defineProps({
  /**
   * MapOverview（heatmap/secondary 鸟瞰）overlay 数据。仅提供可选 overlay 事实
   * （gridCells/spawnPoints/routes/playableBounds）；必选战局回放元数据以 {@code playbackV2} 为权威。
   * 可空：Battle Playback PRIMARY 以 V2 dataset 为核心输入，不再被 map-overview artifact 锁死。
   */
  overview: { type: Object, default: null },
  seekTo: { type: Number, default: null },
  /** QA 场景循环播放（PR4 §49：时间线到末尾自动回到 0 继续） */
  loop: { type: Boolean, default: false },
  /** V2 canonical battle-playback-dataset；未加载时为空。 */
  playbackV2: { type: Object, default: null },
  /**
   * 位姿通道（`LocalPlayback.poseFacet` = playback facet 的位姿列投影）：2D 俯视与 3D 场景
   * 同源同插值（`replay-local/pose/vehiclePose.ts`）。缺失 = 回退 canonical 原始观测。
   */
  poseFacet: { type: Object, default: null },
  /** battle-relative → 回放时钟域的偏移（canonical `clock.startRaw`）；与 poseFacet 同时给出。 */
  clockOffset: { type: Number, default: null },
  result: { type: Object, default: null },
  /** Raw Playback reload evidence stays outside the generic canonical/HTTP dataset. */
  reloadTelemetry: { type: Object, default: null },
  /**
   * 是否为当前可见的模式（审计 PB-05）。false 时暂停播放、不响应快捷键——
   * 工作台用 v-show 保留实例，隐藏的回放不能再抢空格 / 方向键。
   */
  active: { type: Boolean, default: true },
  /** 工作台的自动全屏事件 { token, key }（Android 手机 App；组件挂载即 V2 成功就绪）。 */
  autoFullscreen: { type: Object, default: null },
})

const {   t, locale, gunMarks, uiHidden, pbOverview, image, imageSrc, mapView,   playback, duration, friendlyTeam, friendlyHp, enemyHp, friendlyPoints, enemyPoints, labelPrefs,   hpPrefs, trailPrefs, markerPrefs, uiPrefs, declutterActive, toggleDeclutter, hpModeOptions, ghostFor,   flashFor, visibleFeed, mobileOverlay, transportEl, displayOpen, displaySection, displayAnchor, toggleDisplay,   battlefieldWorkspaceEl, mapComponent, mapStageEl, pbRoot, formFactor, isMobileDevice, phoneLandscape, compactAnnotation,   controlsCollapsed, controlsContentId, rosterLanesOpen, toggleRosterLanes, transportToggleEl, transportContentEl, freezeTransportHeight, startTransportEnter,   openTransportHeight, closeTransportHeight, clearTransportHeight, toggleTransport, lifecycleVisible, isFullscreen, pseudoFullscreen, fullscreenSupported,   toggleFullscreen, floatingFullscreenRow, view, viewportStyle, resetView, wheelHintVisible, mapTouchPan, onWheel,   onPointerDown, onPointerMove, onPointerUp, onViewportClick, annotationOpen, activeTool, routePoints, annotColor,   annotVisible, annotWidthSlider, textSession, textInputStyle, renderedAnnotations, history, historyIndex, annotations,   selectedAnnotation, cancelRoute, toggleTool, toggleAnnotation, closeAnnotation, undoAnnot, redoAnnot, clearAll,   setAnnotColor, toggleAnnotations, finishRoute, commitSession, cancelSession, deleteSelected, renameSelected, currentTime,   playing, speed, hpNoTransition, play, seek, step, setSpeed, seekToEvent,   vehicleStates, visibleTracers, tracerColor, visibleTrails, hpFor, userVisibleEvents, selectedAccountId, detailsSide,   detailsState, selectedTrack, selectedHealth, selectedPortraitUrl, selLastKnownSec, selCurStats, selDamageLog, closeSidebar,   onMarkerSelect, selectFromRoster, setUiHidden, hpPrefsForMap, markerPrefsForMap, visibleFloats, visibleBursts, eventLabel,   showRosterPresentation, transport, dragStart, dragEnd, teamVehicles, rosterTeams, destroyedNow, rosterLanes,   rosterEntryVisible, hudClockVisible, inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass, markerLabel,   hudBaseStates, basesAt, mapStyle, exposed } = useBattlePlaybackModel(props)
defineExpose(exposed)



</script>

<template>
  <div v-if="image && playback" ref="pbRoot" class="battle-playback playback-workspace" :class="{ 'pb-device-mobile': isMobileDevice, 'pb-phone-landscape': phoneLandscape, 'pb-controls-bottom': true, 'pb-pseudo-fullscreen': pseudoFullscreen, 'pb-fs-reserve': floatingFullscreenRow, 'pb-roster-lanes': rosterLanes, 'pb-hud-clock-off': !hudClockVisible, ['pb-form-' + formFactor]: true }" :style="mapStyle" data-scene-surface data-test="battle-playback">
    <!-- 移动端全屏入口：竖屏保持右上角浮动（与 Map Preview 3D / Replay 3D 同一位置）；
         手机横屏普通播放并入传输条；标注编辑隐藏传输条时，同一按钮移到标注行右端，
         隐藏全部 UI 时仍作为唯一可达入口留在右上角。三态互斥，DOM 里只有一个入口。 -->
    <SceneFullscreenButton
      v-if="isMobileDevice && fullscreenSupported && (!phoneLandscape || uiHidden || compactAnnotation)"
      floating
      :class="{ 'pb-fs-annotation': compactAnnotation && !uiHidden }"
      :is-fullscreen="isFullscreen"
      data-test="pb-fullscreen"
      data-testid="playback-fullscreen"
      data-tour="playback-floating-fullscreen"
      @toggle="toggleFullscreen"
    />

    <div ref="battlefieldWorkspaceEl" class="pb-main" :class="{ 'pb-roster-lanes': rosterLanes }" data-test="pb-main">
    <BattlePlaybackHud
      v-if="!uiHidden && (uiPrefs.showTopbar || (uiPrefs.showBaseStatus && hudBaseStates.length))"
      :show-summary="uiPrefs.showTopbar"
      :map-title="mapLabel(pbOverview.mapCode, locale) || pbOverview.mapCode || ''"
      :battle-time="formatClock(currentTime)"
      :friendly-hp="friendlyHp"
      :enemy-hp="enemyHp"
      :friendly-points="friendlyPoints"
      :enemy-points="enemyPoints"
      :base-states="uiPrefs.showBaseStatus ? hudBaseStates : []"
      :friendly-team="friendlyTeam"
      :hp-no-transition="hpNoTransition"
      :compact="phoneLandscape"
    />
      <!-- §roster-overlay：名册不再占据固定 Grid 列（地图列始终全宽）。展开时它是锚在
           Stage 内侧左右边缘的浮层，收纳后只剩传输条上的 roster 入口。 -->
      <div class="pb-map-stage" ref="mapStageEl">
        <BattleMap
          data-tour="playback-map"
          ref="mapComponent"
          :image="image"
          :image-src="imageSrc"
          :map-view="mapView"
          :pb-overview="pbOverview"
          :friendly-team="friendlyTeam"
          :bases="basesAt"
          :visible-tracers="visibleTracers"
          :visible-trails="visibleTrails"
          :tracer-color="tracerColor"
          :view-scale="view.scale"
          :viewport-style="viewportStyle"
          :annot-visible="annotVisible"
          :rendered-annotations="renderedAnnotations"
          :annot-font-size="ANNOT_FONT_SIZE"
          :active-tool="activeTool"
          :vehicle-states="vehicleStates"
          :selected-account-id="selectedAccountId"
          :marker-label="markerLabel"
          :hp-for="hpFor"
          :hp-prefs="hpPrefsForMap"
          :marker-prefs="markerPrefsForMap"
          :translate="t"
          :ghost-for="ghostFor"
          :flash-for="flashFor"
          :hp-no-transition="hpNoTransition"
          :text-session="textSession"
          :text-input-style="textInputStyle"
          :visible-floats="markerPrefs.showStatus ? visibleFloats : []"
          :visible-bursts="visibleBursts"
          :float-team-class="floatTeamClass"
          :touch-pan="mapTouchPan"
          @wheel="onWheel"
          @pointer-down="onPointerDown"
          @pointer-move="onPointerMove"
          @pointer-up="onPointerUp"
          @viewport-click="onViewportClick"
          @marker-select="onMarkerSelect"
          @update-text="textSession.text = $event"
          @commit-text="commitSession"
          @cancel-text="cancelSession"
        />
        <!-- 审计 PB-04：未与地图交互时滚轮交给页面，这里短暂提示如何缩放 -->
        <div v-if="wheelHintVisible" class="pb-wheel-hint" role="status" data-test="pb-wheel-hint">{{ t('workspace.map_wheel_hint') }}</div>

        <!-- §roster-overlay 浮层车道：只覆盖 Stage 的侧带，不盖 HUD、传输控件与详情浮窗；
             收纳（rosterLanesOpen=false 或 showRoster=false）时整体移除，地图恢复全宽。 -->
        <div v-if="rosterLanes" id="pb-roster-lane-left" class="pb-team-lane pb-team-lane-left" data-test="pb-team-lane-left" :aria-label="$t('recon.map.team_friendly')">
          <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.left" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" :dense="phoneLandscape" @select="selectFromRoster" />
        </div>
        <div v-if="rosterLanes" id="pb-roster-lane-right" class="pb-team-lane pb-team-lane-right" data-test="pb-team-lane-right" :aria-label="$t('recon.map.team_enemy')">
          <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.right" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" :dense="phoneLandscape" @select="selectFromRoster" />
        </div>


      </div>

      <!-- §details-float：详情是**整个战场 workspace（.pb-main）顶层**的可拖动浮窗，不属于
           Stage、也不属于任何一条名册车道——它可以被拖到 Team 1 / Stage / Team 2 任意一栏之上。
           宿主就是它的定位祖先 `.pb-main`（同一个坐标系）；位置/边界/初始落位由
           usePlaybackDetailsPlacement 独占（含「不得盖住传输控件」的保护边界）。 -->
      <VehicleDetailsPanel
        :gun-marks="gunMarks.get(selectedAccountId) ?? null"
        v-if="!uiHidden && detailsFloating && detailsState"
        presentation="floating"
        :phone-form="false"
        :selected-state="detailsState"
        :selected-portrait-url="selectedPortraitUrl"
        :health="selectedHealth"
        :sel-last-known-sec="selLastKnownSec"
        :sel-cur-stats="selCurStats"
        :selected-track="selectedTrack"
        :current-time="currentTime"
        :sel-damage-log="selDamageLog"
        :format-clock="formatClock"
        :drag-host="battlefieldWorkspaceEl"
        :drag-bounds="transportEl"
        :initial-side="detailsSide"
        :selection-key="selectedAccountId"
        @close="closeSidebar"
      />

      <PlaybackMobileOverlay v-if="!uiHidden" ref="mobileOverlay" :paused="!playing" :fullscreen="isFullscreen">
        <div ref="transportEl" class="pb-transport-slot" data-test="pb-transport-slot">
        <!-- One measured disclosure region; the persistent restore entry stays outside it. -->
        <div v-show="!compactAnnotation" class="pb-transport-row">
        <Transition name="pb-transport-slide"
          @before-enter="startTransportEnter" @enter="openTransportHeight"
          @after-enter="clearTransportHeight" @enter-cancelled="freezeTransportHeight"
          @before-leave="freezeTransportHeight" @leave="closeTransportHeight"
          @after-leave="clearTransportHeight" @leave-cancelled="freezeTransportHeight"
        >
        <div v-show="!compactAnnotation && !controlsCollapsed" ref="transportContentEl" :id="controlsContentId"
          :inert="controlsCollapsed" class="pb-transport-main" data-test="pb-transport-controls">
        <div v-if="!phoneLandscape" class="pb-replay-mode-bar">
          <button type="button" class="pb-annotation-entry" :class="{ active: annotationOpen }" data-test="pb-annotation-entry" data-tour="playback-annotation-entry" :aria-pressed="annotationOpen" @click="toggleAnnotation">
            <PencilRuler :size="18" aria-hidden="true" /> {{ $t('recon.map.playback.annot.mode') }}
          </button>
          <span>{{ $t(annotationOpen ? 'recon.map.playback.annot.mode_hint' : 'recon.map.playback.annot.watch_hint') }}</span>
        </div>
        <PlaybackControls
          :playing="playing"
          :speed="speed"
          :current-time="currentTime"
          :duration="duration"
          :fullscreen-supported="fullscreenSupported"
          :is-fullscreen="isFullscreen"
          :floating-fullscreen="isMobileDevice && !phoneLandscape"
          :display-open="displayOpen"
          :annotation-enabled="phoneLandscape && !annotationOpen"
          :nav-eligible="active && lifecycleVisible && !compactAnnotation && !controlsCollapsed"
          :roster-entry-visible="rosterEntryVisible"
          :roster-open="rosterLanes"
          @toggle-roster="toggleRosterLanes"
          @toggle-annotation="toggleAnnotation"
          :format-clock="formatClock"
          @toggle-play="transport.togglePlay()"
          @step="step"
          @set-speed="setSpeed"
          @toggle-fullscreen="toggleFullscreen"
          @toggle-panels="toggleDisplay"
          @drag-start="dragStart"
          @drag-end="dragEnd"
          @seek="seek"
        />
        </div>
        </Transition>
        <!-- Persistent restore entry, independent of the animated content's height. -->
        <button ref="transportToggleEl" type="button" class="pb-transport-toggle pb-quick-action" data-test="pb-transport-toggle"
          :aria-expanded="!controlsCollapsed" :aria-controls="controlsContentId"
          :aria-label="$t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          :title="$t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          @click="toggleTransport"
        >
          <component :is="controlsCollapsed ? ChevronUp : ChevronDown" :size="18" aria-hidden="true" />
        </button>
        </div>
        <!-- One annotation toolbar in the transport flow in every form. -->
        <div v-if="annotationOpen && !controlsCollapsed" class="pb-annotation-surface">
          <AnnotationToolbar
            :open="annotationOpen"
            :compact="compactAnnotation"
            :active-tool="activeTool"
            :selected-annotation="selectedAnnotation"
            :route-point-count="routePoints.length"
            :annot-colors="ANNOT_COLORS"
            :annot-color="annotColor"
            :annot-visible="annotVisible"
            :annot-width-slider="annotWidthSlider"
            :annot-width-min="ANNOT_WIDTH_MIN"
            :annot-width-max="ANNOT_WIDTH_MAX"
            :history-index="historyIndex"
            :history="history"
            :can-undo="canUndo"
            :can-redo="canRedo"
            @close="closeAnnotation"
            @toggle-tool="toggleTool"
            @set-annot-color="setAnnotColor"
            @rename-selected="renameSelected"
            @delete-selected="deleteSelected"
            @finish-route="finishRoute"
            @cancel-route="cancelRoute"
            @update:annot-width="annotWidthSlider = $event"
            @undo="undoAnnot"
            @redo="redoAnnot"
            @clear-annotations="clearAll"
            @toggle-annotations="toggleAnnotations"
          />
        </div>
        </div>
      </PlaybackMobileOverlay>

      <PlaybackDisplaySurface :open="displayOpen && !uiHidden" :portrait="inlineStack" :anchor="displayAnchor" :host="battlefieldWorkspaceEl" @close="displayOpen = false">
        <template v-if="displaySection === 'events'">
          <button type="button" class="pb-tool-row pb-display-close" data-test="pb-events-back" @click="displaySection = 'display'">{{ $t('recon.map.playback.back') }}</button>
          <div class="pb-event-list" data-test="pb-event-panel">
          <button
            v-for="(event, index) in userVisibleEvents"
            :key="`${event.type}-${event.timeSec}-${index}`"
            type="button"
            class="pb-event-row"
            data-test="pb-event"
            @click="seekToEvent(event.timeSec)"
          >
            <span class="pb-event-time">{{ formatClock(event.timeSec) }}</span>
            <span class="pb-event-type">{{ $t(`recon.map.playback.event_${event.type}`) }}</span>
            <span>{{ eventLabel(event) }}</span>
          </button>
          <p v-if="userVisibleEvents.length === 0" class="pb-event-empty">{{ $t('recon.map.playback.no_events') }}</p>
        </div>

        </template>
        <template v-else>
        <button type="button" class="pb-tool-row pb-display-close" data-testid="display-close" @click="displayOpen = false">{{ $t('app.close') }}</button>
        <p class="pb-display-heading">{{ $t('agentReplay.display_battlefield') }}</p>
        <div class="pb-panel-options" data-test="pb-panel-content-display">
          <label><input data-test="pb-show-hud" type="checkbox" :checked="uiPrefs.showTopbar" @change="uiPrefs.showTopbar = $event.target.checked"> {{ $t('agentReplay.display_topbar') }}</label>
          <label><input data-test="pb-show-base" type="checkbox" :checked="uiPrefs.showBaseStatus" @change="uiPrefs.showBaseStatus = $event.target.checked"> {{ $t('agentReplay.display_base') }}</label>
          <label><input data-test="pb-show-killfeed" type="checkbox" :checked="uiPrefs.showKillfeed" @change="uiPrefs.showKillfeed = $event.target.checked"> {{ $t('agentReplay.display_killfeed') }}</label>
          <label><input data-test="pb-show-roster" type="checkbox" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ $t('agentReplay.display_roster') }}</label>
        </div>
        <p class="pb-display-heading">{{ $t('agentReplay.display_labels') }}</p>
        <div class="pb-panel-options">
          <label><input data-test="pb-class-icons" type="checkbox" :checked="markerPrefs.classIcons" @change="markerPrefs.classIcons = $event.target.checked"> {{ $t('recon.map.playback.class_icons') }}</label>
          <label><input data-test="pb-show-status" type="checkbox" :checked="markerPrefs.showStatus" @change="markerPrefs.showStatus = $event.target.checked"> {{ $t('recon.map.playback.show_status') }}</label>
          <label><input data-test="pb-show-player" type="checkbox" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ $t('recon.map.playback.show_player_name') }}</label>
          <label><input data-test="pb-show-tank" type="checkbox" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ $t('recon.map.playback.show_tank_name') }}</label>
          <label><input data-test="pb-show-hp" type="checkbox" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ $t('recon.map.playback.show_hp') }}</label>
          <label><input data-test="pb-show-trail" type="checkbox" :checked="trailPrefs.showTrail" @change="trailPrefs.showTrail = $event.target.checked"> {{ $t('recon.map.playback.show_trail_2s') }}</label>
          <label><input data-test="pb-show-reload" type="checkbox" :checked="hpPrefs.mode !== 'ring' && labelPrefs.showReload" :disabled="hpPrefs.mode === 'ring'" @change="labelPrefs.showReload = $event.target.checked"> {{ $t('agentReplay.display_reload') }}</label>
        </div>
        <p class="pb-display-heading">{{ $t('recon.map.playback.hp_mode') }}</p>
        <SegmentedControl v-model="hpPrefs.mode" :options="hpModeOptions" :aria-label="$t('recon.map.playback.hp_mode')" />
        <p v-if="hpPrefs.mode === 'ring'" class="pb-display-heading">{{ $t('recon.map.playback.hp_ring_hint') }}</p>
        <div class="pb-panel-tools" data-test="pb-panel-tools">
          <!-- §5 遮挡契约：呈现类开关收在这块已有的瞬态面里，地图上不再放常驻控件。
               实测 740×360 下 `.pb-map` 只有 96×96，任何 44×44 的常驻入口都会占掉 10.7%
               并压进中心保护区，所以这些开关没有"放在地图角上"的合规位置。 -->
          <button type="button" class="pb-tool-row" data-test="pb-declutter" data-tour="playback-declutter" :aria-pressed="declutterActive" :title="$t('recon.map.playback.declutter_hint')" @click="toggleDeclutter()">
            <ScanEye :size="16" aria-hidden="true" /> {{ $t('recon.map.playback.declutter') }}
          </button>
          <button type="button" class="pb-tool-row" data-test="pb-panel-reset" @click="resetView()">
            <span aria-hidden="true">⟲</span> {{ $t('recon.map.playback.reset_view') }}
          </button>
          <button type="button" class="pb-tool-row" data-test="pb-panel-events" @click="displaySection = 'events'">{{ $t('recon.map.playback.panel_events') }}</button>
          <button type="button" class="pb-tool-row" data-test="pb-hide-all-ui" @click="setUiHidden(true)">{{ $t('agentReplay.hide_all_ui') }}</button>
        </div>
        </template>
      </PlaybackDisplaySurface>

      <button v-if="uiHidden" type="button" class="pb-ui-restore" :class="{ 'pb-ui-restore-shifted': isMobileDevice && fullscreenSupported }" data-test="pb-show-all-ui" :title="$t('agentReplay.show_all_ui_hint')" @click="setUiHidden(false)">{{ $t('agentReplay.show_all_ui') }}</button>

      <!-- §square-stage 手机竖屏纵向流：传输控件之后是详情（inline）与 Team 1 / Team 2。
           竖屏利用的是**纵向**空间，所以这一段就是普通流内容，跟着页面滚，不设高度上限。
           详情与名册各自独立：名册关掉时详情照样可以开着，反之亦然。 -->
      <div v-if="!uiHidden && inlineStack && (detailsState || showRosterPresentation)" class="pb-inline-area" data-test="pb-inline-area">
        <!-- 竖屏的详情：同一个组件、同一份 props，只是换成流内呈现（没有拖动柄）。 -->
        <VehicleDetailsPanel
          :gun-marks="gunMarks.get(selectedAccountId) ?? null"
          v-if="detailsState"
          presentation="inline"
          :phone-form="isMobileDevice"
          :selected-state="detailsState"
          :selected-portrait-url="selectedPortraitUrl"
          :health="selectedHealth"
          :sel-last-known-sec="selLastKnownSec"
          :sel-cur-stats="selCurStats"
          :selected-track="selectedTrack"
          :current-time="currentTime"
          :sel-damage-log="selDamageLog"
          :format-clock="formatClock"
          @close="closeSidebar"
        />
        <PlaybackRoster
          :gun-marks="gunMarks"
          v-if="showRosterPresentation"
          :teams="teamVehicles" :friendly-team="friendlyTeam"
          :destroyed="destroyedNow"
          :health="rosterHealth"
          :selected-id="selectedAccountId"
          @select="selectFromRoster"
        />
      </div>

      <!-- 手机名册没有「打开名册」这种独立开关：竖屏在上面的纵向流里，横屏 / 全屏横屏在
           Team 1 | Stage | Team 2 两侧车道里；唯一的呈现偏好是 uiPrefs.showRoster。 -->

      <div v-if="!uiHidden && uiPrefs.showKillfeed && visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
        <div v-for="feed in visibleFeed" :key="'feed-' + feed.id" class="pb-feed-item" :class="feed.victimFriendly === true ? 'pb-feed-friendly' : (feed.victimFriendly === false ? 'pb-feed-enemy' : 'pb-feed-neutral')"><span class="pb-feed-skull" aria-hidden="true">☠</span><span class="pb-feed-victim">{{ feed.victimPlayerName ? feed.victimPlayerName + '（' + feed.victimName + '）' : feed.victimName }}</span><span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./battle-playback.css"></style>
