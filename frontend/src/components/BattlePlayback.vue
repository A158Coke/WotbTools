<script setup>

import { ref } from 'vue'
import { mapLabel } from '../utils/helpers.js'
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
import { formatClock } from '../utils/battlePlayback.js'
import { bpA } from './battlePlaybackA.js'
import { bpB } from './battlePlaybackB.js'
import { bpC } from './battlePlaybackC.js'
import { bpD } from './battlePlaybackD.js'
import { bpE } from './battlePlaybackE.js'

const props = defineProps({
  overview: { type: Object, default: null },
  seekTo: { type: Number, default: null },
  loop: { type: Boolean, default: false },
  playbackV2: { type: Object, default: null },
  poseFacet: { type: Object, default: null },
  clockOffset: { type: Number, default: null },
  facetShots: { type: Array, default: null },
  facetKills: { type: Array, default: null },
  showEventMarkers: { type: Boolean, default: false },
  result: { type: Object, default: null },
  reloadTelemetry: { type: Object, default: null },
  active: { type: Boolean, default: true },
  autoFullscreen: { type: Object, default: null },
})


const S = {}
bpA(S, props)
bpB(S, props)
bpC(S, props)
bpD(S, props)
bpE(S, props)

const {
  mapSemantics, t, locale, gunMarks, pbOverview, image, imageSrc, mapView,
  palette, paletteRequestToken, playback, duration, friendlyTeam, hpVehicles, friendlyHp, enemyHp,
  friendlyPoints, enemyTeam, enemyPoints, baseStatesAt, nowMs, labelPrefs, hpPrefs, trailPrefs,
  markerPrefs, uiPrefs, declutterActive, toggleDeclutter, hpModeOptions, realNowMs, eventCursor, floatItems,
  burstItems, resetTransients, consumeEvents, hasPendingTransients, pruneTransients, ghostFor, flashFor, visibleFeed,
  visibleFloats, visibleBursts, uiHidden, setUiHidden, showRosterPresentation, mobileOverlay, transportEl, displayOpen,
  displaySection, displayAnchor, toggleDisplay, battlefieldWorkspaceEl, mapComponent, mapStageEl, pbRoot, wideLayout,
  formFactor, isMobileDevice, isPhonePortrait, phoneLandscape, compactAnnotation, controlsCollapsed, controlsContentId, toggleControlsCollapsed,
  rosterLanesOpen, toggleRosterLanes, transportToggleEl, transportContentEl, freezeTransportHeight, startTransportEnter, openTransportHeight, closeTransportHeight,
  clearTransportHeight, toggleTransport, playbackLifecycleActive, lifecycleVisible, wideLayoutQuery, onWideLayoutChange, isFullscreen, pseudoFullscreen,
  fullscreenSupported, toggleFullscreen, exitOwnedFullscreen, floatingFullscreenRow, mapEl, mapWidth, mapHeight, mapRenderRect,
  view, applyView, viewportStyle, markerTransform, overlayInverse, overlayInverseScale, screenPoint, fitScale,
  resetView, fitViewIfReady, disposeCamera, mapEngaged, wheelHintVisible, mapTouchPan, onWheel, onPointerDown,
  onPointerMove, onPointerUp, onViewportClick, resetGestureState, stageResizeObserver, writeSquareAvailHeight, shellChrome, vehicleReloadAt,
  vehicleConsumablesAt, routesByAccount, vehiclesByAccount, poseSource, poseAtTime, reliefModelForPlayback, projectedSemanticNorm, reliefUnproject,
  annotationOpen, activeTool, routePoints, annotColor, annotVisible, annotWidthSlider, semPerSvgX, semPerSvgY,
  textSession, textInputStyle, renderedAnnotations, history, historyIndex, annotations, draft, selectedAnnotationIndex,
  selectedAnnotation, getDrawingPointerId, getDrawingStartScreen, resetAnnotations, cancelDrawing, cancelRoute, toggleTool, toggleAnnotation,
  closeAnnotation, undoAnnot, redoAnnot, clearAll, setAnnotColor, toggleAnnotations, finishRoute, startDrawing,
  moveDrawing, endDrawing, commitSession, cancelSession, deleteSelected, renameSelected, dragStart, dragEnd,
  transport, onKeydown, hpPrefsForMap, markerPrefsForMap, playerName, eventLabel, currentTime, playing,
  speed, hpNoTransition, play, pause, seek, step, setSpeed, seekToEvent,
  disposeClock, vehicleStates, visibleTracers, tracerColor, visibleTrails, canonicalMarkerScreen, markerScreen, hpFor,
  hpDisplayNumText, authoritativeEvents, shotTicks, killTicks, userVisibleEvents, selectedAccountId, detailsOpen, detailsSide,
  selectedState, detailsState, selectedTrack, selectedHealth, selectedPortraitUrl, selLastKnownSec, selCurStats, selDamageLog,
  openDetails, closeSidebar, onMarkerSelect, selectAt, selectFromRoster, teamVehicles, rosterTeams, destroyedNow,
  rosterLanes, rosterEntryVisible, hudClockVisible, inlineStack, detailsFloating, rosterHealth, rosterReload, floatTeamClass,
  labelLayout, markerLabel, baseStatus, capturedBy, hudBaseStates, ASSAULT_BASE_RADIUS_FALLBACK_M, basesAt, mapStyle,
} = S

defineExpose({
  pause: S.pause,
  seekAndPlay: (sec, playing, speed) => { S.seek(sec); if (Number.isFinite(speed)) S.setSpeed(speed); if (playing) S.play(); else S.pause() },
  displayOpened: () => S.displayOpen.value,
  openDisplay: () => {
    if (S.displayOpen.value) return false
    S.toggleDisplay(S.pbRoot.value?.querySelector('[data-test="pb-secondary-entry"]') || null)
    return true
  },
  closeDisplay: () => { S.displayOpen.value = false },
  annotationsOpen: () => S.annotationOpen.value,
  openAnnotations: () => {
    if (S.annotationOpen.value) return false
    S.toggleAnnotation()
    return true
  },
  closeAnnotations: S.closeAnnotation,
})
</script>

<template>
  <div v-if="image && playback" ref="pbRoot" class="battle-playback playback-workspace" :class="{ 'pb-device-mobile': isMobileDevice, 'pb-phone-landscape': phoneLandscape, 'pb-controls-bottom': true, 'pb-pseudo-fullscreen': pseudoFullscreen, 'pb-fs-reserve': floatingFullscreenRow, 'pb-roster-lanes': rosterLanes, 'pb-hud-clock-off': !hudClockVisible, ['pb-form-' + formFactor]: true }" :style="mapStyle" data-scene-surface data-test="battle-playback">
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
        <div v-if="wheelHintVisible" class="pb-wheel-hint" role="status" data-test="pb-wheel-hint">{{ t('workspace.map_wheel_hint') }}</div>

        <div v-if="rosterLanes" id="pb-roster-lane-left" class="pb-team-lane pb-team-lane-left" data-test="pb-team-lane-left" :aria-label="$t('recon.map.team_friendly')">
          <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.left" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" :dense="phoneLandscape" @select="selectFromRoster" />
        </div>
        <div v-if="rosterLanes" id="pb-roster-lane-right" class="pb-team-lane pb-team-lane-right" data-test="pb-team-lane-right" :aria-label="$t('recon.map.team_enemy')">
          <PlaybackRoster :gun-marks="gunMarks" :teams="rosterTeams.right" :friendly-team="friendlyTeam" :destroyed="destroyedNow" :health="rosterHealth" :reload="rosterReload" :selected-id="selectedAccountId" :compact="formFactor === 'mobile'" :dense="phoneLandscape" @select="selectFromRoster" />
        </div>


      </div>

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
          :shot-ticks="shotTicks"
          :kill-ticks="killTicks"
          :show-event-markers="props.showEventMarkers"
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
        <button ref="transportToggleEl" type="button" class="pb-transport-toggle pb-quick-action" data-test="pb-transport-toggle"
          :aria-expanded="!controlsCollapsed" :aria-controls="controlsContentId"
          :aria-label="$t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          :title="$t(controlsCollapsed ? 'agentReplay.expand_toolbar' : 'agentReplay.collapse_toolbar')"
          @click="toggleTransport"
        >
          <component :is="controlsCollapsed ? ChevronUp : ChevronDown" :size="18" aria-hidden="true" />
        </button>
        </div>
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

      <div v-if="!uiHidden && inlineStack && (detailsState || showRosterPresentation)" class="pb-inline-area" data-test="pb-inline-area">
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
          :shot-ticks="shotTicks"
          :kill-ticks="killTicks"
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


      <div v-if="!uiHidden && uiPrefs.showKillfeed && visibleFeed.length" class="pb-kill-feed" data-test="pb-kill-feed" aria-hidden="true">
        <div v-for="feed in visibleFeed" :key="'feed-' + feed.id" class="pb-feed-item" :class="feed.victimFriendly === true ? 'pb-feed-friendly' : (feed.victimFriendly === false ? 'pb-feed-enemy' : 'pb-feed-neutral')"><span class="pb-feed-skull" aria-hidden="true">☠</span><span class="pb-feed-victim">{{ feed.victimPlayerName ? feed.victimPlayerName + '（' + feed.victimName + '）' : feed.victimName }}</span><span class="pb-feed-destroyed">{{ $t('recon.map.playback.feed_destroyed') }}</span></div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./battlePlayback.css"></style>
