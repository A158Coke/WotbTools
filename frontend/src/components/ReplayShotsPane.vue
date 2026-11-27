<script setup>
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ONBOARDING_KEY } from '../shared/onboarding.js'
import { isOfficialDemo, OFFICIAL_DEMO } from '../replay-local/demo.js'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import {
  parseAgentShotsFromBytes, parseAgentPlaybackFromBytes, enrichShotsFromRoster, isShotHit,
} from '../api/agent-replay-facets.js'
import { shotResultBadge } from '../utils/shotPresentation.js'
import { storeShotsForViewer, fetchShotTankData, shotViewerQuery } from '../scene/agentData.js'
import { usePlaybackFullscreen } from '../composables/usePlaybackFullscreen.js'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'
import { useShotsDecode } from './replay-shots/useShotsDecode.ts'
import { useShotsPresenters } from './replay-shots/useShotsPresenters.ts'
import { useShotsDetail } from './replay-shots/useShotsDetail.ts'
import SceneFullscreenButton from './SceneFullscreenButton.vue'
import Scene3DStatus from './Scene3DStatus.vue'
import Badge from './Badge.vue'
import StatStrip from './StatStrip.vue'
import TankClassIcon from './TankClassIcon.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EquipmentBadges from './EquipmentBadges.vue'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayShotsPane' })

const props = defineProps({
  file: { type: Object, default: null },
  active: { type: Boolean, default: false },
  blockedReason: { type: String, default: '' },
  navigate: { type: Function, default: null },
  autoFullscreenToken: { type: Number, default: 0 },
})
const { t } = useI18n()
const onboarding = inject(ONBOARDING_KEY, null)
const selectedIndex = ref(null)
const shooter = ref('own')
const decodeApi = useShotsDecode({
  t,
  resetSelection: () => { selectedIndex.value = null },
  resetScope: () => { shooter.value = 'own' },
})
const {
  shots, parsing, err, authorError, othersError, authorEid, recorderTankName, battleStartRaw,
  beginDecode, dispose: disposeDecode, parseSeqNow, parsedFileNow, decodingNow,
} = decodeApi

onMounted(() => onboarding?.registerSurface('shots', {
  ready: () => props.active && selectedShot.value != null,
  prepare: () => { closeDetail(); shooter.value = 'own'; return decodingNow() },
  setGuideInset: pixels => { guideInset.value = Math.max(0, pixels) },
  cleanup: () => { guideInset.value = 0 },
  failed: () => !!err.value || !!props.blockedReason || (!parsing.value && parsedFileNow() === props.file && !filteredShots.value.some(rowHas3d)),
}))
onBeforeUnmount(() => onboarding?.registerSurface('shots', null))
onBeforeUnmount(() => {
  disposeDecode()
})
const { requireFeature, availability } = useFeatureGate()

const {
  shotClock, shellBadge, resultBadge, qualityIssues, playerName,
  isOwnShot, tankName, targetName,
  shooterOptions, shooterGroups, selectedShooter,
  ownShots, filteredShots, scopeTitle, scopeSubtitle,
  shotSummary, summaryStats, selectedShot,
  trajectoryLength, rowHas3d, hasEquipment,
} = useShotsPresenters({
  shots, authorEid, recorderTankName, battleStartRaw, shooter, selectedIndex, props, t,
})

const guideShot = computed(() => (isOfficialDemo(props.file)
  ? filteredShots.value.find(shot => shot.shot_id === OFFICIAL_DEMO.cue.shotId)
  : null) || filteredShots.value.find(rowHas3d))


const paneRoot = ref(null)
const lifecycleVisible = ref(true)
const viewerActive = () => props.active && lifecycleVisible.value
const { isPhone } = usePlaybackPhoneForm()
const { isFullscreen, fullscreenSupported, toggleFullscreen, unlockOrientation, exitOwnedFullscreen } = usePlaybackFullscreen({
  target: () => paneRoot.value,
  isPhone,
  isActive: viewerActive,
  auto: () => ({ token: props.autoFullscreenToken, key: props.file, active: viewerActive(), ready: !!props.file && !props.blockedReason && !parsing.value && !err.value && parsedFileNow() === props.file && shots.value.length > 0 }),
})
const releaseFullscreen = () => { unlockOrientation(); exitOwnedFullscreen() }
watch(() => props.active, (active) => { if (!active) releaseFullscreen() })
onDeactivated(() => { lifecycleVisible.value = false; releaseFullscreen() })
onActivated(() => { lifecycleVisible.value = true })



watch([() => props.active, () => props.file, () => props.blockedReason], ([active, file, blocked]) => {
  beginDecode(active, file, blocked)
}, { immediate: true })


const {
  layout, guideLayout, directOpening, detailOpen, isOverlay,
  detailPane, guideInset, setGuideInset,
  applyLayout, selectShot, showDetail, closeDetail,
  selectedPosition, hasPreviousShot, hasNextShot, goToAdjacentShot,
  onDetailKeydown, onDetailPointerDown, onDetailPointerUp, onDetailPointerCancel,
} = useShotsDetail({
  shots, filteredShots, selectedIndex, paneRoot, onboarding,
  availability3d: () => availability(Feature.PLAYBACK_3D), openInViewer, rowHas3d,
})

async function openInViewer(s) {
  if (!requireFeature(Feature.PLAYBACK_3D)) return false
  if (!rowHas3d(s)) return false
  const shooterTank = s.shooter_tank_id || 0
  const tank = s.target_tank_id || shooterTank || 0
  if (!tank) return false
  s = JSON.parse(JSON.stringify(s))
  const sequence = parseSeqNow()
  storeShotsForViewer(JSON.parse(JSON.stringify(filteredShots.value.filter(rowHas3d))), { battleStartRaw: battleStartRaw.value })
  const query = await shotViewerQuery(s)
  if (sequence !== parseSeqNow() || selectedIndex.value !== s.index || !props.active || !query || !requireFeature(Feature.PLAYBACK_3D)) return false
  if (!props.navigate) return false
  props.navigate({ query })
  return true
}
</script>

<template>
  <div ref="paneRoot" class="shots-pane" data-testid="replay-shots-pane" :data-pane-ready="parsing ? undefined : 'true'" @keydown="onDetailKeydown">
    <Scene3DStatus v-if="parsing" mode="loading" :message="$t('agentShots.parsing')" />
    <p v-else-if="blockedReason" class="shots-note" data-testid="shots-blocked">{{ blockedReason }}</p>
    <p v-else-if="!file" class="shots-note" data-testid="shots-empty">{{ $t('workspace.capability_upload_hint') }}</p>
    <Banner v-else-if="err" tone="danger" data-testid="shots-error">
      <p>{{ err }}</p>
    </Banner>
    <template v-else>
      <Banner v-if="authorError" tone="warning" data-testid="shots-author-error">
        <p>{{ $t('agentShots.author_path_error') }}</p>
        <p class="shots-cause">{{ authorError.slice(0, 160) }}</p>
      </Banner>
      <Banner v-if="othersError" tone="warning" data-testid="shots-others-error">
        <p>{{ $t('agentShots.others_error') }}</p>
        <p class="shots-cause">{{ othersError.slice(0, 160) }}</p>
      </Banner>

      <header class="shots-overview">
        <div class="shots-scope">
          <h2>{{ scopeTitle }}</h2>
          <p>{{ scopeSubtitle }}</p>
        </div>
        <SceneFullscreenButton
          v-if="isPhone && fullscreenSupported"
          class="shots-fullscreen"
          :is-fullscreen="isFullscreen"
          :floating="false"
          data-testid="shots-fullscreen"
          @toggle="toggleFullscreen()"
        />
        <SegmentedControl
          v-if="layout === 'compact'"
          class="shots-scope-switch"
          presentation="tiles"
          :model-value="shooter === 'own' || shooter === 'all' ? shooter : ''"
          :options="[
            { value: 'own', label: `${$t('agentShots.my_shots')} · ${ownShots.length}`, testid: 'shots-scope-own' },
            { value: 'all', label: `${$t('agentShots.all_shooters')} · ${shots.length}`, testid: 'shots-scope-all' },
          ]"
          :ariaLabel="$t('agentShots.shooter')"
          @update:model-value="value => shooter = value"
        />
        <div class="shots-filter">
          <label class="shots-filter-label" for="shots-shooter-select">{{ $t('agentShots.shooter') }}</label>
          <select id="shots-shooter-select" v-model="shooter" class="shots-select" data-testid="shots-shooter-select">
            <option value="own">{{ $t('agentShots.my_shots') }} ({{ ownShots.length }})</option>
            <option value="all">{{ $t('agentShots.all_shooters') }} ({{ shots.length }})</option>
            <template v-for="(options, group) in shooterGroups" :key="group">
              <optgroup v-if="options.length" :label="$t(`agentShots.${group === 'unknown' ? 'unknown_side' : group}`)">
                <option v-for="option in options" :key="option.key" :value="option.value">{{ option.tankName }} · {{ option.name }} ({{ option.n }})</option>
              </optgroup>
            </template>
          </select>
        </div>
      </header>
      <StatStrip :stats="summaryStats" />
      <p class="shots-recording-hint">{{ $t('agentShots.recording_hint') }}</p>
      <div v-if="!filteredShots.length" class="shots-empty-state" data-testid="shots-no-shots">
        <strong>{{ $t('agentShots.no_shots') }}</strong>
        <p>{{ $t(shooter === 'own' ? 'agentShots.no_own_shots' : 'agentShots.no_filtered_shots') }}</p>
        <AppButton v-if="shooter === 'own' && shots.length" @click="shooter = 'all'">{{ $t('agentShots.browse_all_shots') }}</AppButton>
      </div>
      <div v-else class="shots-split" :class="[`is-${guideLayout}`, { 'has-detail': detailOpen }]">
        <div class="shot-master">
          <div class="shot-list-heading"><h3>{{ $t('agentShots.shot_sequence') }}</h3><span>{{ $t('agentShots.shot_count', { count: filteredShots.length }) }}</span></div>
        <ul class="shot-list" :aria-label="$t('agentShots.title')">
          <li v-for="(s, position) in filteredShots" :key="s.index">
            <button
              type="button"
              class="shot-row"
              :class="{ 'is-selected': selectedIndex === s.index }"
              :aria-current="selectedIndex === s.index ? 'true' : undefined"
              :data-testid="`shot-row-${s.index}`"
              :data-tour="s === guideShot ? 'shots-first-shot' : undefined"
              @click="selectShot(s.index, $event)"
            >
              <span class="shot-time"><span class="shot-ordinal">{{ position + 1 }}</span><span class="shot-clock">{{ shotClock(s) }}</span></span>
              <span class="shot-path">
                <span class="shot-names">
                  <span class="shot-vehicle"><span class="shot-name"><TankClassIcon :tank-class="s.shooter_tank_class" />{{ tankName(s, 'shooter') }}</span><span class="shot-player">{{ playerName(s.shooter_name) }}</span></span>
                  <span class="shot-arrow" aria-hidden="true">→</span>
                  <span class="shot-vehicle"><span class="shot-name"><TankClassIcon v-if="s.target_eid != null" :tank-class="s.target_tank_class" />{{ targetName(s) }}</span><span v-if="s.target_eid != null" class="shot-player">{{ playerName(s.target_name) }}</span></span>
                </span>
                <span class="shot-meta">
                  <Badge :text="resultBadge(s).text" :tone="resultBadge(s).tone" />
                  <Badge v-if="shellBadge(s).label" :text="shellBadge(s).label" :tone="shellBadge(s).tone" />
                  <span v-if="shellBadge(s).pen" class="shot-dim">{{ shellBadge(s).pen }} mm</span>
                  <span v-if="s.damage" class="shot-dmg">{{ $t('agentShots.damage_value', { damage: s.damage }) }}</span>
                  <span v-if="s.is_kill" class="shot-kill">{{ $t('agentShots.stat_kills') }}</span>
                  <span v-if="qualityIssues(s).length" class="shot-flag" :title="qualityIssues(s).join('; ')">!</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
        </div>

        <aside
          v-if="detailOpen"
          ref="detailPane"
          class="shot-detail"
          tabindex="-1"
          data-testid="shot-inspector"
          data-tour="shots-inspector"
          :style="guideInset > 0 ? { insetBlockEnd: `${guideInset}px` } : undefined"
          :role="isOverlay ? 'dialog' : undefined"
          :aria-modal="isOverlay ? 'true' : undefined"
          :aria-label="$t('agentShots.inspector_title')"
          @pointerdown="onDetailPointerDown"
          @pointerup="onDetailPointerUp"
          @pointercancel="onDetailPointerCancel"
        >
          <header class="shot-detail-head">
            <div><h3 class="shot-detail-title">{{ $t('agentShots.inspector_title') }}</h3><p class="shot-detail-position">{{ $t('agentShots.shot_position', { current: selectedPosition + 1, total: filteredShots.length }) }} · {{ shotClock(selectedShot) }}</p></div>
            <div class="shot-detail-nav">
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-prev"
                :disabled="!hasPreviousShot"
                :title="$t('agentShots.prev_shot')"
                :aria-label="$t('agentShots.prev_shot')"
                @click="goToAdjacentShot(-1)"
              ><ChevronLeft :size="16" aria-hidden="true" /></button>
              <button
                type="button"
                class="shot-nav-btn"
                data-testid="shot-next"
                :disabled="!hasNextShot"
                :title="$t('agentShots.next_shot')"
                :aria-label="$t('agentShots.next_shot')"
                @click="goToAdjacentShot(1)"
              ><ChevronRight :size="16" aria-hidden="true" /></button>
              <AppButton size="sm" data-testid="shot-detail-close" @click="closeDetail">{{ $t('agentShots.close') }}</AppButton>
            </div>
          </header>
          <div class="shot-matchup">
            <div><span class="shot-player">{{ $t('agentShots.col_shooter') }}</span><strong><TankClassIcon :tank-class="selectedShot.shooter_tank_class" />{{ tankName(selectedShot, 'shooter') }}</strong><span class="shot-player">{{ playerName(selectedShot.shooter_name) }}</span></div>
            <span class="shot-arrow" aria-hidden="true">→</span>
            <div><span class="shot-player">{{ $t('agentShots.col_target') }}</span><strong><TankClassIcon v-if="selectedShot.target_eid != null" :tank-class="selectedShot.target_tank_class" />{{ targetName(selectedShot) }}</strong><span v-if="selectedShot.target_eid != null" class="shot-player">{{ playerName(selectedShot.target_name) }}</span></div>
          </div>
          <AppButton
            v-if="rowHas3d(selectedShot)"
            variant="primary"
            data-testid="shot-open-viewer"
            data-tour="shot-open-viewer"
            @click="openInViewer(selectedShot)"
          >{{ $t('agentShots.open_viewer') }}</AppButton>
          <dl class="shot-detail-grid">
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_time') }}</dt><dd>{{ shotClock(selectedShot) }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_shell') }}</dt><dd>
              <Badge v-if="shellBadge(selectedShot).label" :text="shellBadge(selectedShot).label" :tone="shellBadge(selectedShot).tone" />
              <span v-else class="shot-dim">{{ $t('agentShots.shell_unknown') }}</span>
              <span v-if="shellBadge(selectedShot).pen" class="shot-dim">{{ shellBadge(selectedShot).pen }} mm</span>
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_result') }}</dt><dd>
              <Badge :text="resultBadge(selectedShot).text" :tone="resultBadge(selectedShot).tone" />
            </dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.col_dmg') }}</dt><dd>{{ selectedShot.damage || 0 }}</dd></div>
            <div class="shot-detail-row"><dt>{{ $t('agentShots.detail_impact') }}</dt><dd>
              {{ selectedShot.target_eid != null ? $t('agentShots.impact_hit') : $t('agentShots.impact_miss') }}
            </dd></div>
            <div v-if="trajectoryLength(selectedShot) != null" class="shot-detail-row">
              <dt>{{ $t('agentShots.detail_trajectory') }}</dt>
              <dd>{{ trajectoryLength(selectedShot).toFixed(1) }} m</dd>
            </div>
            <div v-if="hasEquipment(selectedShot)" class="shot-detail-row">
              <dt>{{ $t('agentShots.col_equipment') }}</dt>
              <dd>
                <EquipmentBadges :ids="selectedShot.shooter_equipment?.raw ?? null" />
              </dd>
            </div>
          </dl>

          <details v-if="qualityIssues(selectedShot).length" class="shot-detail-quality">
            <summary>{{ $t('agentShots.detail_quality') }} · {{ qualityIssues(selectedShot).length }}</summary>
            <ul>
              <li v-for="issue in qualityIssues(selectedShot)" :key="issue">{{ issue }}</li>
            </ul>
          </details>

          <p class="shot-detail-hint">{{ $t('agentShots.inspector_hint') }}</p>
        </aside>
        <div v-else-if="layout === 'expanded'" class="shot-detail-placeholder"><h3>{{ $t('agentShots.select_shot') }}</h3><p>{{ $t('agentShots.select_shot_hint') }}</p></div>
      </div>
    </template>
  </div>
</template>

<style scoped src="./replay-shots.css"></style>
