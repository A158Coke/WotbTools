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
import Replay3DSettingsEntry from './Replay3DSettingsEntry.vue'
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
  file: { type: Object, default: null },
  playbackSession: { type: Object, default: null },
  active: { type: Boolean, default: false },
  blockedReason: { type: String, default: '' }, autoFullscreenToken: { type: Number, default: 0 },
  pendingSeek: { type: Object, default: null },
  showEventMarkers: { type: Boolean, default: false },
  autoStartUserId: { type: String, default: '' },
  demo: { type: Boolean, default: false },
  replayFiles: { type: Array, default: () => [] },
  selectionRevision: { type: Number, default: 0 },
  shadowRequest: { type: Object, default: null },
  resumeRequest: { type: Object, default: null },
  settingsRequest: { type: Object, default: null },
})
const emit = defineEmits(['resume-consumed', 'settings-open'])

const playbackTeamCssVars = teamCssVars('')

const S = {}
S.emitResumeConsumed = () => emit('resume-consumed')
let sceneApi = null
let jumpBase = null
let lastFile = null
let portraitGeneration = 0
let parseController = null
let loadedFile = null
let laneBoundsObserver = null
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
  markerPrefs, markerPrefs3d, uiPrefs, lastKnownPrefs, declutterActive, toggleDeclutter, uiHidden, displayOpen, displayAnchor,
  toggleDisplay, settingsOpen, settingsAnchor, settingsDraft, toggleSettings, closeSettings, setDraftQuality, saveSettings,
  controlsCollapsed, controlsContentId, controlsDocked, slideContentFrom, slideContentOpen, slideContentClose, slideContentShut,
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

watch(settingsOpen, (open) => emit('settings-open', Boolean(open)))
watch(() => props.settingsRequest, (request) => {
  if (!request) return
  if (request.open) toggleSettings(request.anchor ?? null)
  else closeSettings()
}, { immediate: true })
</script>

<template>
  <div class="pb-pane" :data-pane-ready="paneReady ? 'true' : undefined">
    <template v-if="!online.available">
      <p v-if="!online.pending" class="pb-note" data-testid="replay3d-connectivity">{{ $t(online.messageKey) }}</p>
    </template>
    <Scene3DStatus v-else-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <p v-else-if="blockedReason" class="pb-note" data-testid="replay3d-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="pb-note" data-testid="replay3d-empty">{{ $t('agentReplay.no_file') }}</p>
    <div v-else class="pb-root playback-workspace transport-docked" ref="rootEl" :class="{ 'phone-form': isPhone, 'portrait-flow': portraitFlow, 'roster-side': showRoster && !portraitFlow, 'compact-bar': compactBar }" :style="playbackTeamCssVars" data-testid="replay3d-root" data-scene-surface data-tour="replay3d-workspace">
      <SceneFullscreenButton
        v-if="isPhone && fullscreenSupported && (uiHidden || isPortrait)"
        floating
        :is-fullscreen="isFullscreen"
        data-test="pb-fullscreen"
        data-testid="playback-fullscreen"
        @toggle="toggleFullscreen()"
      />
      <SceneDistanceSlider
        :get-scene-api="() => sceneApi"
        :visible="isPhone && !isPortrait && !uiHidden && (store.cam === 'free' || store.cam === 'top')"
      />
      <div class="pb-stage" data-testid="replay3d-stage" :data-quality="store.qualityKey" :data-camera="store.cam">
        <div class="stage-square">
          <div ref="stage" class="scene"></div>
          <PlaybackChatFeed :facet="playbackFacet" :time="store.time" :hidden="uiHidden || !store.hasData" />
          <PlaybackVehicleLabels3D :gun-marks="gunMarks" ref="labelOverlay"  :label-prefs="labelPrefs" :hp-prefs="hpPrefs" :marker-prefs="markerPrefs3d" :last-known-label="t('agentReplay.label_last_known')" :marker-kind-labels="markerKindLabels" :selected-eid="selectedEid" :hidden="uiHidden || !store.hasData" :interactive="!annotationTool" @select="handleSceneSelect" />
          <RecorderReticle ref="recorderReticle" :suppressed="uiHidden" />
          <div v-if="showFps" class="pb-fps" :class="{ 'pb-fps-low': fpsJanky }" data-testid="replay3d-fps" aria-hidden="true">{{ fpsText }}</div>
        </div>
      </div>

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

      <div v-if="store.hasData && showRoster" class="roster-surface" data-testid="roster-surface">
        <div class="team-lane side-left" data-testid="replay3d-lane-left">
          <PlaybackRoster :gun-marks="gunMarks" variant="3d" :compact="!portraitFlow" :dense="phoneLandscape" :teams="rosterLanes.left" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="followFromRoster" />
        </div>
        <div class="team-lane side-right" data-testid="replay3d-lane-right">
          <PlaybackRoster :gun-marks="gunMarks" variant="3d" :compact="!portraitFlow" :dense="phoneLandscape" :teams="rosterLanes.right" :friendly-team="store.friendlyTeam" :selected-id="selectedEid" @select="followFromRoster" />
        </div>
      </div>

      <div v-if="!uiHidden && store.banner" class="banner" :style="{ color: bannerColor }">{{ bannerText() }}</div>

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
          <ReplayCameraTools v-if="!annotationOpen" v-bind="cameraTools" :hint="recorderUnavailableReason" @update:cam="chooseCamera($event)" @update:glb="sceneApi.setGlb($event)">
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
            <Replay3DSettingsEntry v-if="isFullscreen" compact :open="settingsOpen" @toggle="toggleSettings($event.currentTarget)"
              data-testid="replay3d-settings-entry-fullscreen" data-test="pb-settings-entry-fullscreen" />
          </ReplayCameraTools>
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
            :show-event-markers="props.showEventMarkers"
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
      </div>

      <PlaybackDisplaySurface :open="displayOpen && !uiHidden" :portrait="portraitFlow" :anchor="displayAnchor" :host="rootEl" @close="displayOpen = false">
          <p class="dp-title">{{ t('agentReplay.display_battlefield') }}</p>
        <label class="toggle" :title="store.treadAllowed ? '' : t('agentReplay.tread_gate_hint')">
          <input type="checkbox" data-testid="disp-tread" :checked="store.treadOn" :disabled="!store.treadAllowed" @change="sceneApi.setTreadMarks($event.target.checked)"> {{ t('agentReplay.tread_marks') }}
        </label>
        <label class="toggle">
          <input type="checkbox" data-testid="disp-last-known" :checked="lastKnownPrefs.showLastKnown" @change="lastKnownPrefs.showLastKnown = $event.target.checked"> {{ t('agentReplay.display_last_known') }}
        </label>
        <p class="dp-note" data-testid="replay3d-visibility-note">{{ t('agentReplay.visibility_note') }}</p>
        <label class="toggle">
          <input type="checkbox" data-testid="disp-battle-markers" :checked="markerPrefs.battleMarkers" @change="markerPrefs.battleMarkers = $event.target.checked"> {{ t('agentReplay.display_battle_markers') }}
        </label>
        <label class="toggle"><input type="checkbox" data-testid="disp-topbar" :checked="uiPrefs.showTopbar" @change="uiPrefs.showTopbar = $event.target.checked"> {{ t('agentReplay.display_topbar') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-roster" :checked="uiPrefs.showRoster" @change="uiPrefs.showRoster = $event.target.checked"> {{ t('agentReplay.display_roster') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-killfeed" :checked="uiPrefs.showKillfeed" @change="uiPrefs.showKillfeed = $event.target.checked"> {{ t('agentReplay.display_killfeed') }}</label>
        <button type="button" class="tool-btn dp-declutter" data-test="pb-declutter" :aria-pressed="declutterActive" :title="t('recon.map.playback.declutter_hint_3d')" @click="toggleDeclutter('hidden', '3d')">
          <ScanEye :size="18" aria-hidden="true" /> {{ t('recon.map.playback.declutter') }}
        </button>
        <label class="toggle"><input type="checkbox" data-testid="disp-base" :checked="uiPrefs.showBaseStatus" @change="uiPrefs.showBaseStatus = $event.target.checked"> {{ t('agentReplay.display_base') }}</label>
        <p class="dp-title">{{ t('agentReplay.display_labels') }}</p>
        <label class="toggle"><input type="checkbox" data-testid="disp-class-icons" :checked="markerPrefs.classIcons3d" @change="markerPrefs.classIcons3d = $event.target.checked"> {{ t('recon.map.playback.class_icons') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-status" :checked="markerPrefs.showStatus" @change="markerPrefs.showStatus = $event.target.checked"> {{ t('recon.map.playback.show_status_3d') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-player" :checked="labelPrefs.showPlayerName" @change="labelPrefs.showPlayerName = $event.target.checked"> {{ t('recon.map.playback.show_player_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-tank" :checked="labelPrefs.showTankName" @change="labelPrefs.showTankName = $event.target.checked"> {{ t('recon.map.playback.show_tank_name') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-hp" :checked="hpPrefs.showHp" @change="hpPrefs.showHp = $event.target.checked"> {{ t('recon.map.playback.show_hp') }}</label>
        <label class="toggle"><input type="checkbox" data-testid="disp-reload" :checked="labelPrefs.showReload" @change="labelPrefs.showReload = $event.target.checked"> {{ t('agentReplay.display_reload') }}</label>
        <p class="q-badge dp-quality" :title="t('agentReplay.q_title')">{{ qualityBadge }}</p>
        <p class="dp-shortcuts" data-testid="replay3d-shortcuts">{{ t('agentReplay.shortcuts_hint') }}</p>
        <button
          type="button" class="tool-btn dp-hide" data-testid="hide-all-ui"
          @click="setUiHidden(true)"
        >{{ t('agentReplay.hide_all_ui') }}</button>
        <button
          type="button" class="tool-btn dp-close"
          data-testid="display-close" @click="displayOpen = false"
        >{{ t('app.close') }}</button>
      </PlaybackDisplaySurface>

      <PlaybackDisplaySurface
        :open="settingsOpen && !uiHidden"
        :portrait="portraitFlow"
        :anchor="settingsAnchor"
        :host="rootEl"
        panel-testid="replay3d-settings"
        aria-label-key="agentReplay.settings_title"
        close-testid="replay3d-settings-cancel"
        tour-id="playback-settings"
        @close="closeSettings"
      >
        <p class="dp-title">{{ t('agentReplay.settings_title') }}</p>
        <SegmentedControl
          :model-value="settingsDraft.qualityKey"
          :options="qualityOptions"
          :aria-label="t('agentReplay.quality')"
          data-testid="replay3d-settings-quality"
          @update:model-value="setDraftQuality($event)"
        />
        <div class="settings-group" role="group" :aria-label="t('agentReplay.performance_options')">
          <label class="toggle" :title="t('agentReplay.perf_logdepth_hint')">
            <input type="checkbox" data-testid="settings-logdepth" :checked="settingsDraft.logdepth" @change="settingsDraft.logdepth = $event.target.checked"> {{ t('agentReplay.perf_logdepth') }}
          </label>
          <label class="toggle" :title="t('agentReplay.perf_dynres_hint')">
            <input type="checkbox" data-testid="settings-dynres" :checked="settingsDraft.dynres" @change="settingsDraft.dynres = $event.target.checked"> {{ t('agentReplay.perf_dynres') }}
          </label>
          <label class="toggle" :title="t('agentReplay.perf_armor_highlight_hint')">
            <input type="checkbox" data-testid="settings-armor-highlight" :checked="settingsDraft.armorHighlight" @change="settingsDraft.armorHighlight = $event.target.checked"> {{ t('agentReplay.perf_armor_highlight') }}
          </label>
          <label class="toggle" :title="t('agentReplay.perf_contact_shadows_hint')">
            <input type="checkbox" data-testid="settings-contact-shadows" :disabled="!shadowQualityEligible(settingsDraft.qualityKey)" :checked="settingsDraft.contactShadows" @change="settingsDraft.contactShadows = $event.target.checked"> {{ t('agentReplay.perf_contact_shadows') }}
          </label>
        </div>
        <label class="toggle" :title="t('agentReplay.settings_sound_hint')">
          <input type="checkbox" data-testid="settings-battle-sound" :checked="settingsDraft.battleSound" @change="settingsDraft.battleSound = $event.target.checked"> {{ t('agentReplay.settings_sound') }}
        </label>
        <p class="dp-note" data-testid="replay3d-settings-reload-note">{{ t('agentReplay.settings_reload_note') }}</p>
        <div class="settings-actions">
          <button type="button" class="tool-btn" data-testid="replay3d-settings-cancel" @click="closeSettings">{{ t('app.close') }}</button>
          <button type="button" class="tool-btn settings-save" data-testid="replay3d-settings-save" @click="saveSettings">{{ t('agentReplay.settings_save') }}</button>
        </div>
      </PlaybackDisplaySurface>

      <button
        v-if="uiHidden" type="button" class="ui-restore tool-btn panel"
        :class="{ 'ui-restore-shifted': isPhone && fullscreenSupported }"
        data-testid="show-all-ui" :title="t('agentReplay.show_all_ui_hint')"
        @click="setUiHidden(false)"
      >{{ t('agentReplay.show_all_ui') }}</button>

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
              <input type="checkbox" data-testid="perf-contact-shadows" :disabled="!shadowQualityEligible(store.qualityKey)" :checked="store.contactShadowsPref" @change="sceneApi.setContactShadows($event.target.checked)"> {{ t('agentReplay.perf_contact_shadows') }}
            </label>
            </div>
            <p class="pre-start-perf-note">{{ t('agentReplay.perf_load_note') }}</p>
          </div>
          <AppButton variant="primary" data-test="replay3d-start" @click="startReplay">{{ t('agentReplay.start') }}</AppButton>
        </div>
      </div>

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
