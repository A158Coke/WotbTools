<script setup>
import { computed, inject, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, MousePointer2 } from 'lucide-vue-next'
import { formatShotBattleClock } from '../utils/playbackClock.js'
import { initTankViewer } from '../scene/tankViewer.js'
import { recordedTargetMatchesShot } from '../replay-local/compute/tankSetup'
import { detectWebGL } from '../scene/webglSupport.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { usePlaybackPortraitViewport } from '../composables/usePlaybackPortraitViewport.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useForcedLandscape } from '../composables/useForcedLandscape.js'
import { usePointer } from '../composables/useBreakpoint.js'
import Scene3DStatus from './Scene3DStatus.vue'
import RotatePrompt from './RotatePrompt.vue'
import TankCatalogMenu from './TankCatalogMenu.vue'
import ArmorShotHud from './ArmorShotHud.vue'
import ArmorToolsPanel from './agent-armor/ArmorToolsPanel.vue'
import { useArmorShotPage } from './agent-armor/useArmorShotPage.ts'
import { useArmorSetupQuery } from './agent-armor/useArmorSetupQuery.ts'
import { useArmorPitchAvailability } from './agent-armor/useArmorPitchAvailability.ts'
import { armorViewerLabels } from './agent-armor/armorViewerLabels.ts'
import { shellLabel } from '../scene/tankMeta.js'
import './agent-armor-view.css'
import './agent-armor-view-responsive.css'
import './agent-armor-view-hud-responsive.css'
const { t, te } = useI18n()
const route = useRoute()
const {
    isShotPage, armorUpgrade, shotSnapshot, battleStartRaw, activeShot, shotPosition,
    recordedResult, navigating, navigationError, readShotSnapshot, shotTankName,
    backToShots, backOrTankopedia, adjacentShot, hint, shotGestures,
    bumpNavSeq, currentNavSeq, requestSeqNext, dispose: disposeShots,
} = useArmorShotPage()
const { coarse } = usePointer()

const pickerOpen = ref(false)
const pickerMode = ref('target')
const tankList = ref([])
const tankListState = ref('loading')
const selectedShooterId = ref(null)
const selectedTargetId = ref(null)
const pickerFilters = ref({ q: '', tier: '', nation: '', type: '', category: '', sort: 'name' })
const toolsOpen = ref(false)
const shooterReady = ref(false)
const targetReady = ref(false)
const hudReady = ref(false)
const shooterOpen = ref(false)
const targetOpen = ref(false)
const editorsReady = computed(() => shooterReady.value && targetReady.value)

const SCENE_QUERY_KEYS = [
  'tank', 'shooter', 'shot', 'world', 'heatmap', 'az', 'h', 'd', 'quality', 'move', 'rel', 'clean', 'debug',
  'upgrade', 'abilities', 'supgrade', 'sabilities',
]
const sceneSignature = () => SCENE_QUERY_KEYS.map(key => `${key}=${route.query[key] ?? ''}`).join('&')
let lastSceneSignature = null
let preserveToolsOnRebuild = false
const loadoutActive = ref(false)
watch(toolsOpen, (open) => { if (open) loadoutActive.value = true }, { immediate: true })
watch([editorsReady, hudReady], ([editors, hud]) => {
  viewer?.setConfigUiVisible?.(!editors)
  viewer?.setShellUiVisible?.(!hud)
}, { flush: 'sync' })
const loadoutTankId = computed(() => selectedTargetId.value ?? (Number(route.query.tank) || null))
const cleanQuery = computed(() => route.query.clean === '1')
const shooterSetupId = computed(() => (selectedShooterId.value ?? Number(route.query.shooter)) || loadoutTankId.value)
const targetSetupId = computed(() => selectedTargetId.value ?? loadoutTankId.value)
const isXiTank = id => Number(tankList.value.find(tank => Number(tank.id) === Number(id))?.tier) === 11
const { pitchFromModules, pitchFromModulesKnown, pitchDeviceBonusValue } = useArmorPitchAvailability(targetSetupId)
const recordedPitchDevice = computed(
  () => recordedTargetMatchesShot(activeShot.value, targetSetupId.value)
    && !!activeShot.value?.target_equipment?.improved_pitch_limits,
)
const pitchDeviceAvailable = computed(() => pitchFromModules.value || recordedPitchDevice.value)
const shooterConfigValue = computed(() => {
  const scfg = route.query.scfg
  return scfg != null && scfg !== '' ? scfg : null
})
const {
  replaceArmorSetupQuery, syncNativeTargetConfig, syncNativeShell, syncNativeEquipment, applyShotSetup, applySide,
} = useArmorSetupQuery({
  viewer: () => viewer,
  targetSetupId: () => targetSetupId.value,
  shooterSetupId: () => shooterSetupId.value,
  onUpgradesChanged: () => { preserveToolsOnRebuild = true },
})

let viewer = null
const viewerReady = ref(false)
const distanceState = ref(null)
const shotState = ref(null)
const webgl = detectWebGL()
const load = ref({ state: 'loading', progress: null, message: '' })
const shellChrome = inject(SHELL_CHROME_KEY, null)
const shellOwner = Symbol('agent-armor')
const { isPhone } = usePlaybackPhoneForm()
const { isPortrait } = usePlaybackPortraitViewport()
const wantsImmersive = computed(() => coarse.value && isPhone.value && !isPortrait.value && webgl.supported)
watch(wantsImmersive, (on) => shellChrome?.request(shellOwner, on), { immediate: true })
onBeforeUnmount(() => shellChrome?.request(shellOwner, false))
const forcedLandscape = useForcedLandscape(computed(() => webgl.supported))
const resultExpanded = ref(!isShotPage.value)
watch(isShotPage, shot => { resultExpanded.value = !shot })
watch(resultExpanded, () => nextTick(() => viewer?.repositionResultCard?.()))
const onboarding = inject(ONBOARDING_KEY, null)
onMounted(() => onboarding?.registerSurface('armor', {
    ready: () => load.value.state === 'ready',
    failed: () => !webgl.supported || load.value.state === 'error',
}))
onBeforeUnmount(() => onboarding?.registerSurface('armor', null))
const attempt = ref(0)

function onLoadState(next) {
    load.value = { state: next.state, progress: next.progress ?? null, message: next.message || '' }
}

const pickerTitle = computed(() => pickerMode.value === 'shooter' ? t('armor.select_shooter') : t('armor.select_target'))
const pickerSelectedId = computed(() => pickerMode.value === 'shooter' ? selectedShooterId.value : selectedTargetId.value)
watch(shooterSetupId, () => { shooterReady.value = false; hudReady.value = false })
watch(targetSetupId, () => { targetReady.value = false })

watch([pitchDeviceAvailable, pitchFromModulesKnown], ([available, known]) => {
  viewer?.setPitchDeviceAvailable?.(available)
  if (!available && known && route.query.eqpitch != null) {
    replaceArmorSetupQuery(query => { delete query.eqpitch })
    viewer?.setEquipmentOverride?.('pitch', null)
  }
})

function openPicker(mode) {
    if (!viewer?.canPick?.()) return
    pickerMode.value = mode
    pickerOpen.value = true
}
function closePicker() {
    if (!pickerOpen.value) return
    pickerOpen.value = false
    const id = pickerMode.value === 'shooter' ? 'shooter-select' : 'target-select'
    nextTick(() => document.getElementById(id)?.focus())
}
function onPickerSelect(tank) {
    if (viewer?.selectTank?.(pickerMode.value, tank.id)) closePicker()
}
function setPickerFilters(filters) {
    pickerFilters.value = filters
}
function onPickerKeydown(event) {
    if (!pickerOpen.value) return
    const layer = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null
    if (layer && layer.id !== 'tank-picker') return
    if (event.key === 'Escape') { event.preventDefault(); closePicker(); return }
    if (event.key !== 'Tab') return
    const picker = document.getElementById('tank-picker')
    if (!picker) return
    const focusable = [...picker.querySelectorAll('button, input, select')].filter(el => !el.disabled)
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (!first) return
    if (event.shiftKey && (document.activeElement === first || !picker.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
    } else if (!event.shiftKey && (document.activeElement === last || !picker.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
    }
}
onMounted(() => window.addEventListener('keydown', onPickerKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onPickerKeydown))

watch(pitchDeviceBonusValue, value => { viewer?.setPitchDeviceBonus?.(value) })

function startViewer(preserveSelection = false) {
    distanceState.value = null
    shotState.value = null
    const seq = currentNavSeq()
    const q = new URLSearchParams(window.location.search)
    const tank = Number(q.get('tank')) || 0
    if (!preserveSelection) {
        selectedShooterId.value = null
        selectedTargetId.value = null
    }
    const initialTarget = preserveSelection && selectedTargetId.value != null
        ? selectedTargetId.value
        : (tank || 19281)
    const initialShooter = preserveSelection && selectedShooterId.value != null
        ? selectedShooterId.value
        : (Number(q.get('shooter')) || initialTarget)
    viewer = initTankViewer({
        initialTankId: initialTarget,
        initialShooterId: initialShooter,
        pitchDeviceBonus: pitchDeviceBonusValue.value,
        pitchDeviceAvailable: pitchDeviceAvailable.value,
        labels: armorViewerLabels({ t, te }),
        onLoadState: (next) => { if (isSeqCurrent(seq)) onLoadState(next) },
        onTankList: (list) => {
            if (!isSeqCurrent(seq)) return
            tankList.value = list
            tankListState.value = 'ready'
        },
        onTankSelection: (selection) => {
            if (!isSeqCurrent(seq)) return
            selectedShooterId.value = selection.shooter
            selectedTargetId.value = selection.target
        },
        onDistanceChange: state => { if (isSeqCurrent(seq)) distanceState.value = state },
        onJudgmentDistance: state => { if (isSeqCurrent(seq)) shotState.value = state },
        onConfigSelection: index => syncNativeTargetConfig(index),
        onShellSelection: index => syncNativeShell(index),
        onEquipmentSelection: (kind, value) => syncNativeEquipment(kind, value),
    })
    viewerReady.value = true
    lastSceneSignature = sceneSignature()
    viewer.setConfigUiVisible?.(!editorsReady.value)
    viewer.setShellUiVisible?.(!hudReady.value)
}
function isSeqCurrent(seq) {
    return seq === currentNavSeq()
}

async function retry() {
    load.value = { state: 'loading', progress: null, message: '' }
    const previous = viewer
    if (previous?.retry?.()) return
    const preserveSelection = previous?.isContextLost?.() === true
    const seq = bumpNavSeq()
    requestSeqNext()
    navigating.value = false
    viewerReady.value = false
    previous?.destroy?.()
    viewer = null
    attempt.value += 1
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer(preserveSelection)
}

onMounted(async () => {
    const seq = currentNavSeq()
    await readShotSnapshot(seq)
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer()
})
watch(() => route.fullPath, async () => {
    if (route.query.view !== 'agent-armor') return
    if (viewer && sceneSignature() === lastSceneSignature) return
    requestSeqNext()
    viewerReady.value = false
    viewer?.destroy?.()
    viewer = null
    if (!preserveToolsOnRebuild) toolsOpen.value = false
    preserveToolsOnRebuild = false
    pickerOpen.value = false
    tankList.value = []
    tankListState.value = 'loading'
    load.value = { state: 'loading', progress: null, message: '' }
    attempt.value += 1
    const seq = bumpNavSeq()
    shotSnapshot.value = []
    await readShotSnapshot(seq)
    await nextTick()
    if (isSeqCurrent(seq) && webgl.supported) startViewer()
    if (isSeqCurrent(seq)) navigating.value = false
})

onBeforeUnmount(() => {
    disposeShots()
    if (viewer?.destroy) viewer.destroy()
    viewer = null
})
</script>

<template>
<div class="armor-view" data-scene-surface data-tour="armor-workspace" :class="{ 'is-unsupported': !webgl.supported, 'has-back': !isShotPage, 'is-shot': isShotPage, 'is-clean': cleanQuery }">
    <button v-if="!isShotPage" type="button" class="armor-back" data-testid="armor-back" :aria-label="$t('armor.back')" @click="backOrTankopedia"><ArrowLeft :size="16" aria-hidden="true" /><span class="armor-back-label">{{ $t('armor.back') }}</span></button>
    <header v-if="isShotPage && !cleanQuery" class="armor-shot-header" data-testid="armor-shot-header">
        <button type="button" class="armor-shot-back" :aria-label="$t('armor.back_to_shots')" @click="backToShots"><ArrowLeft :size="18" aria-hidden="true" /><span>{{ $t('armor.back_to_shots') }}</span></button>
        <div class="armor-shot-context">
            <div class="armor-shot-matchup"><strong>{{ shotTankName('shooter') }}</strong><ArrowRight :size="18" aria-hidden="true" /><strong>{{ activeShot?.target_eid == null ? $t('agentShots.no_target') : shotTankName('target') }}</strong></div>
            <div v-if="activeShot" class="armor-shot-meta"><span>{{ $t('armor.recorded_shot') }} · {{ formatShotBattleClock(activeShot.time_s, battleStartRaw) }}</span><span>{{ $t('agentShots.recorded_damage') }} <b>{{ activeShot.damage ?? '—' }}</b></span><span v-if="recordedResult" :class="`armor-shot-result is-${recordedResult.tone}`">{{ recordedResult.text }}</span><span v-if="activeShot.shell_kind">{{ shellLabel({ type: activeShot.shell_kind }) }}</span></div>
        </div>
        <nav class="armor-shot-navigation" :aria-label="$t('armor.shot_navigation')">
            <button type="button" :disabled="navigating || shotPosition <= 0" :aria-label="$t('armor.previous_shot')" :title="$t('armor.previous_shot')" @click="adjacentShot(-1)"><ChevronLeft :size="20" aria-hidden="true" /></button>
            <span>{{ $t('armor.hit_position', { current: shotPosition >= 0 ? shotPosition + 1 : '—', total: shotSnapshot.length }) }}</span>
            <button type="button" :disabled="navigating || shotPosition < 0 || shotPosition >= shotSnapshot.length - 1" :aria-label="$t('armor.next_shot')" :title="$t('armor.next_shot')" @click="adjacentShot(1)"><ChevronRight :size="20" aria-hidden="true" /></button>
        </nav>
        <p v-if="navigationError" class="armor-navigation-error" role="alert">{{ navigationError }}</p>
    </header>
    <section v-if="isShotPage && !cleanQuery && webgl.supported" class="armor-interaction-help" aria-labelledby="armor-help-title" data-testid="armor-interaction-help">
        <h2 id="armor-help-title"><MousePointer2 :size="18" aria-hidden="true" />{{ $t('armor.gestures.title') }}</h2>
        <dl><div v-for="gesture in shotGestures" :key="gesture.action"><dt>{{ gesture.input }}</dt><dd>{{ gesture.action }}</dd></div></dl>
    </section>
    <Scene3DStatus v-if="!webgl.supported" mode="unsupported" :webgl-status="webgl.status" />
    <div v-else :key="attempt" class="armor-stage" :class="{ 'is-tools-open': toolsOpen }" data-testid="armor-stage">
        <div class="armor-legacy-loading" hidden><div id="loading">{{ $t('armor.loading') }}</div></div>
        <div id="canvas-container"></div>
        <ArmorToolsPanel
            :clean-query="cleanQuery"
            :is-shot-page="isShotPage"
            v-model:tools-open="toolsOpen"
            :hud-ready="hudReady"
            :pitch-device-available="pitchDeviceAvailable"
            :is-xi-tank="isXiTank"
            :shooter-setup-id="shooterSetupId"
            :target-setup-id="targetSetupId"
            :shooter-config-value="shooterConfigValue"
            :loadout-active="loadoutActive"
            v-model:shooter-open="shooterOpen"
            v-model:target-open="targetOpen"
            :armor-upgrade="armorUpgrade"
            @open-picker="openPicker"
            @apply-side="applySide"
            @shooter-ready="value => shooterReady = value"
            @target-ready="value => targetReady = value"
        />
        <div id="tank-picker" role="dialog" aria-modal="true" aria-labelledby="tp-title" :class="{ open: pickerOpen }" @click.self="closePicker">
            <TankCatalogMenu
                v-if="pickerOpen"
                layout="dialog"
                autofocus
                :title="pickerTitle"
                :tanks="tankList"
                :state="tankListState"
                :filters="pickerFilters"
                :selected-id="pickerSelectedId"
                @update:filters="setPickerFilters"
                @select="onPickerSelect"
                @close="closePicker"
            />
        </div>
        <div id="click-info">
            <h3 id="click-part">—</h3>
            <div class="row"><span>{{ $t('armor.base_armor') }}</span><span id="click-armor">—</span></div>
            <div class="row"><span>{{ $t('armor.angle') }}</span><span id="click-angle">—</span></div>
            <div class="row"><span>{{ $t('armor.effective') }}</span><span id="click-effective">—</span></div>
            <div class="row"><span>{{ $t('armor.penetration') }}</span><span id="click-pen">—</span></div>
            <div class="row"><span>{{ $t('armor.result') }}</span><span id="click-result">—</span></div>
        </div>
        <div class="armor-bottom-controls">
        <div id="corner-tr">
            <ArmorShotHud
                :shooter-id="shooterSetupId"
                :distance-state="load.state === 'ready' ? distanceState : null"
                :shot-state="load.state === 'ready' ? shotState : null"
                @distance="value => viewer?.setDistance?.(value)"
                :scfg="shooterConfigValue"
                :upgrade="armorUpgrade(route.query.supgrade)"
                :abilities="route.query.sabilities"
                :shell="route.query.shell"
                :eqcal="route.query.eqcal"
                :eqenh="route.query.eqenh"
                :eqpitch="route.query.eqpitch"
                :calibrated-default="!!activeShot?.shooter_equipment?.calibrated_shells"
                :enhanced-default="!!activeShot?.target_equipment?.enhanced_armor"
                :pitch-default="recordedPitchDevice"
                :pitch-available="pitchDeviceAvailable"
                @shell="index => applyShotSetup({ shell: index })"
                @calibrated="value => applyShotSetup({ eqcal: value })"
                @enhanced="value => applyShotSetup({ eqenh: value })"
                @pitch="value => applyShotSetup({ eqpitch: value })"
                @ready="value => hudReady = value"
            />
            <div id="shell-selector" style="display:none;">
                <label for="shell-select">{{ $t('armor.shell') }} </label>
                <select id="shell-select"></select>
            </div>
            <div id="view-toggle">
                <button id="collision-btn" type="button" aria-pressed="false" :title="$t('armor.thickness_scale')" :disabled="!viewerReady">{{ $t('armor.show_collision') }}</button>
                <button id="penetration-btn" type="button" aria-pressed="false" :disabled="!viewerReady">{{ $t('armor.heatmap') }}</button>
                <div id="armor-filters" class="armor-filters" hidden>
                    <button id="filter-primary" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_primary') }}</button>
                    <button id="filter-spaced" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_spaced') }}</button>
                    <button id="filter-external" type="button" class="active" aria-pressed="true">{{ $t('armor.filter_external') }}</button>
                </div>
            </div>
            <div id="armor-result-legend" class="armor-legend" role="list" :aria-label="$t('armor.result_legend')"><span class="armor-legend-item is-pen" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_penetration') }}</span><span class="armor-legend-item is-may" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_may_penetrate') }}</span>
                <span class="armor-legend-item is-rico" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_ricochet') }}</span><span class="armor-legend-item is-blocked" role="listitem"><i aria-hidden="true"></i>{{ $t('armor.legend_blocked') }}</span></div>
        </div>
        <div id="corner-br">
            <div v-if="!isShotPage" id="controls-hint">{{ hint }}</div>
        </div>
        </div>
        <div
            id="traj-info"
            style="display:none;"
            role="button"
            tabindex="0"
            :class="{ 'is-expanded': resultExpanded }"
            :aria-expanded="resultExpanded ? 'true' : 'false'"
            :aria-label="$t('armor.result_details')"
            data-testid="armor-result-pill"
            @click="resultExpanded = !resultExpanded"
            @keydown.enter.prevent="resultExpanded = !resultExpanded"
            @keydown.space.prevent="resultExpanded = !resultExpanded"
        ></div>
        <div id="shot-replay-error" role="alert" aria-live="assertive" style="display:none;"></div>
        <div id="turret-controls">
            <div v-if="!isShotPage && !cleanQuery" class="armor-camera-presets" role="group" :aria-label="$t('armor.camera_presets')">
                <button type="button" class="armor-scene-button" data-testid="armor-camera-front" :disabled="load.state !== 'ready'" @click="viewer?.setCameraPreset?.('front', { preserveView: true })">{{ $t('armor.camera_front') }}</button>
                <button type="button" class="armor-scene-button" data-testid="armor-camera-hull-down" :disabled="load.state !== 'ready'" @click="viewer?.setCameraPreset?.('hull_down', { preserveView: true })">{{ $t('armor.camera_hull_down') }}</button>
            </div>
            <div class="ctrl-row"><label>{{ $t('armor.turret') }}</label><span id="turret-val">0°</span></div>
            <div class="ctrl-row"><label>{{ $t('armor.gun') }}</label><span id="gun-val">0°</span></div>
        </div>
        <Scene3DStatus
            v-if="load.state === 'loading'"
            mode="loading"
            :progress="load.progress"
            :message="$t('armor.loading')"
        />
        <Scene3DStatus
            v-else-if="load.state === 'error'"
            mode="error"
            :message="load.message"
            @retry="retry"
        />
    </div>
    <RotatePrompt
        v-if="forcedLandscape.blocked.value"
        class="armor-rotate-prompt"
        :device="forcedLandscape.device.value"
        :action-label="isShotPage ? $t('armor.back_to_shots') : $t('armor.back')"
        @action="isShotPage ? backToShots() : backOrTankopedia()"
    />
</div>
</template>
