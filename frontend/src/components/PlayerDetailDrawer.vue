<script setup>
import GunMarksBadge from './GunMarksBadge.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDrawerResize } from './player-detail/useDrawerResize.ts'
import { useRadarMetricSelection } from './player-detail/useRadarMetricSelection.ts'
import { useRatingProfileExport } from './player-detail/useRatingProfileExport.ts'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import PlayerRatingRadar from './PlayerRatingRadar.vue'
import { CW_DIM_KEYS } from '../utils/playerSummaryMerge.js'
import { leagueMaxByKey, ratingTotalText } from '../utils/helpers.js'
import { battleAverage, globalAverage } from '../utils/radarReference.js'
import {
  RADAR_METRIC_DEFS, RADAR_AVAILABLE_KEYS, RADAR_MIN_AXES, RADAR_MAX_AXES,
  loadRadarPreference, saveRadarPreference, resolveRadarMetric,
} from '../utils/radarMetrics.js'
import { formatRadarVisualScore, scaleBoundedRadarSeries } from '../utils/radarScale.js'
import {
  RADAR, axisPoint, axisRay, polygonPoints, radarGridPolygons, radarScaleTicks,
  radarScoreLabelLayout,
} from '../utils/radarGeometry.js'
import { sanitizeFilename, downloadBlob } from '../utils/exportReplayPng.js'

const props = defineProps({
  context: { type: Object, default: null },
  player: { type: Object, default: null },
  leagueColumns: { type: Array, default: () => [] },
  scopePlayers: { type: Array, default: () => [] },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'prev', 'next'])
const { t } = useI18n()



const open = computed(() => !!props.context && !!props.player)
const closeBtn = ref(null)
const isSummary = computed(() => props.context?.scope === 'summary')
const {
  isMobile, isDesktop,
  drawerWidth, drawerMinWidth, isResizing, resizeHandle, drawerMaxWidth,
  loadDrawerWidth, setDrawerWidth, bindMobile,
  onResizeStart, onResizeMove, onResizeEnd, onResizeKey,
  panelWidth,
} = useDrawerResize({ open })

const {
  radarOrder, showRadarPicker, radarHint,
  toggleRadarMetric, moveRadarMetric,
} = useRadarMetricSelection({ t })



function num(v) {
  return (v == null || v === '' || !Number.isFinite(Number(v))) ? '--' : String(Math.round(Number(v) * 10) / 10)
}

function ratingLine() {
  const p = props.player
  if (!p) return { rating: '--' }
  return { rating: ratingTotalText(p.rating) }
}

const maxByKey = computed(() => leagueMaxByKey(props.leagueColumns))

const rawRadarMetrics = computed(() => {
  const p = props.player
  if (!p) return []
  return radarOrder.value
    .map((key) => {
      const def = RADAR_METRIC_DEFS[key]
      if (!def) return null
      const idx = CW_DIM_KEYS.indexOf(key)
      const raw = isSummary.value ? p.dimensionMeans?.[idx] : p.dimensionScores?.[idx]
      const resolved = resolveRadarMetric(key, raw, maxByKey.value)
      return { ...resolved, label: t(resolved.label), tip: def.tipKey ? t(def.tipKey) : '' }
    })
    .filter(Boolean)
})

const rawReferenceSeries = computed(() => {
  const ref = isSummary.value
    ? globalAverage(props.scopePlayers, { dimKeys: radarOrder.value })
    : battleAverage(props.scopePlayers, { dimKeys: radarOrder.value })
  return ref.axes.map((a) => {
    const r = resolveRadarMetric(a.key, a.rawValue, maxByKey.value)
    const def = RADAR_METRIC_DEFS[a.key]
    return { ...r, label: t(r.label), tip: def.tipKey ? t(def.tipKey) : '' }
  })
})

const scaledRadarSeries = computed(() =>
  scaleBoundedRadarSeries(rawRadarMetrics.value, rawReferenceSeries.value, maxByKey.value))

const radarMetrics = computed(() => scaledRadarSeries.value.metrics)
const referenceSeries = computed(() => scaledRadarSeries.value.reference)

const referenceLabel = computed(() =>
  isSummary.value ? t('league.drawer.global_average') : t('league.drawer.battle_average'))

const playerUnavailable = computed(() =>
  radarMetrics.value.length > 0 && radarMetrics.value.some(m => !m.available))


const facts = computed(() => {
  const p = props.player
  if (!p) return []
  const rows = []
  if (isSummary.value) {
    rows.push([t('league.drawer.battles'), p.cells?.battles ?? '--'])
    rows.push([t('league.drawer.wins'), p.cells?.wins ?? '--'])
    if (p.cells?.win_rate != null) rows.push([t('league.drawer.win_rate'), num(p.cells.win_rate) + '%'])
    if (p.mvpCount != null) rows.push([t('league.drawer.mvp'), p.mvpCount])
    rows.push([t('league.drawer.damage_avg'), num(p.cells?.damage_avg)])
    rows.push([t('league.drawer.assist_avg'), num(p.cells?.assisted_avg)])
    rows.push([t('league.drawer.kills_avg'), num(p.cells?.kills_avg)])
    rows.push([t('league.drawer.earned_avg'), num(p.cells?.earned_avg)])
  } else {
    rows.push([t('player_labels.gun_marks'), p.cells?.gun_marks == null ? '—' : t('player_labels.gun_marks_count', { count: p.cells.gun_marks })])
    rows.push([t('league.drawer.damage'), num(p.cells?.damage_dealt)])
    rows.push([t('league.drawer.assist'), num(p.cells?.damage_assisted)])
    rows.push([t('league.drawer.kills'), p.cells?.kills ?? '--'])
    rows.push([t('league.drawer.blocked'), num(p.cells?.damage_blocked)])
    rows.push([t('league.drawer.shots'), p.cells?.n_shots ?? '--'])
    rows.push([t('league.drawer.hits'), p.cells?.n_hits_dealt ?? '--'])
    rows.push([t('league.drawer.pens'), p.cells?.n_penetrations_dealt ?? '--'])
    rows.push([t('league.drawer.survived'),
      p.cells?.survived_label === 'SURVIVED' ? t('survived.alive')
        : p.cells?.survived_label === 'DESTROYED' ? t('survived.dead') : '--'])
    rows.push([t('league.drawer.points_earned'), p.cells?.victory_points_earned ?? '--'])
  }
  return rows
})

const isReliableTankName = (name) => {
  const s = (name || '').trim()
  return !!s && !s.startsWith('#')
}
const vehicle = computed(() => {
  const p = props.player
  if (!p) return null
  if (isSummary.value) {
    const muv = p.mostUsedVehicle
    if (!muv || muv.tankId == null || !isReliableTankName(muv.tankName)) return null
    const rate = (p.ratedBattles && p.ratedBattles > 0) ? (muv.battles / p.ratedBattles) : null
    return {
      label: t('league.drawer.most_used_vehicle'),
      tankName: (muv.tankName || '').trim(),
      battleText: t('league.drawer.vehicle_battles', { n: muv.battles }),
      rateText: rate != null ? (Math.round(rate * 1000) / 10) + '%' : '',
      tankId: muv.tankId,
    }
  }
  const tankId = Number(p.tankId)
  if (!Number.isFinite(tankId) || tankId <= 0 || !isReliableTankName(p.tankName)) return null
  return {
    label: t('league.drawer.battle_vehicle'),
    tankName: (p.tankName || '').trim(),
    battleText: '',
    rateText: '',
    tankId,
  }
})

const vehiclePortrait = ref(null)
const vehiclePortraitToken = ref(0)
let portraitRuntimePromise = null
function loadPortrait(tankId) {
  if (tankId == null) return Promise.resolve(null)
  if (!portraitRuntimePromise) {
    portraitRuntimePromise = import('../vehicle-portraits/runtime.js')
  }
  return portraitRuntimePromise
    .then((m) => m.loadVehiclePortrait(tankId))
    .catch(() => null)
}
watch(vehicle, async (v) => {
  const token = ++vehiclePortraitToken.value
  vehiclePortrait.value = null
  if (!v || v.tankId == null) return
  const url = await loadPortrait(v.tankId)
  if (token !== vehiclePortraitToken.value) return
  vehiclePortrait.value = url
}, { immediate: true })

const navDir = ref('next')
function onPrev() { navDir.value = 'prev'; emit('prev') }
function onNext() { navDir.value = 'next'; emit('next') }

const closing = ref(false)
function requestClose() {
  if (closing.value) return
  closing.value = true
  setTimeout(() => { closing.value = false; emit('close') }, 170)
}

function isEditable(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const {
  exportingProfile, exportCardRef, exportPortrait,
  snapIsSummary, snapNickname, snapRating, snapObservedMean, snapRatedBattles,
  snapReferenceLabel, snapVehicle, snapMetrics, snapRefs,
  snapPlayerPoints, snapRefPoints, snapGrids, snapAxes, snapLabels,
  snapScoreLabels, snapScaleTicks, snapDetailRows,
  exportProfile,
} = useRatingProfileExport({
  props, vehicle, radarMetrics, referenceSeries, referenceLabel, isSummary, ratingLine, loadPortrait,
})
function onKeydown(e) {
  if (!open.value) return
  if (e.key === 'Escape') {
    if (!isEditable(e.target)) requestClose()
  } else if (e.key === 'ArrowLeft' && !isEditable(e.target)) {
    onPrev()
  } else if (e.key === 'ArrowRight' && !isEditable(e.target)) {
    onNext()
  }
}

watch(open, (v) => {
  if (v) nextTick(() => closeBtn.value?.focus?.())
})

const SWIPE_MIN_PX = 60
let touchStart = null
function onTouchStart(e) {
  if (!isMobile.value || e.touches.length !== 1 || isEditable(e.target)) { touchStart = null; return }
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }
}
function onTouchEnd(e) {
  if (!touchStart) return
  const end = e.changedTouches[0]
  const dx = end.clientX - touchStart.x
  const dy = end.clientY - touchStart.y
  touchStart = null
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
  if (dx < 0 && props.hasNext) onNext()
  else if (dx > 0 && props.hasPrev) onPrev()
}

onMounted(() => { window.addEventListener('keydown', onKeydown); drawerWidth.value = loadDrawerWidth(); bindMobile() })
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.userSelect = ''
  document.body.classList.remove('pd-resizing')
  if (typeof document !== 'undefined') document.documentElement.style.removeProperty('--pd-drawer-offset')
})

</script>

<template>
  <Teleport to="body">
    <div v-if="open || closing" class="drawer-backdrop" :class="{ 'pd-modal': isMobile }" @click.self="isMobile ? requestClose() : null">
      <aside class="player-drawer" :class="{ 'pd-closing': closing }" role="dialog" :aria-modal="isMobile ? 'true' : undefined"
             :aria-labelledby="'pd-title-' + (player?.accountId ?? 'x')"
             :style="{ width: panelWidth ? panelWidth + 'px' : undefined }"
             data-testid="player-drawer"
             @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
        <button ref="closeBtn" class="pd-close pd-close-abs" :aria-label="t('league.drawer.close')"
                @click="requestClose"><X :size="20" aria-hidden="true" /></button>

        <Transition :name="'pd-dir-' + navDir" mode="out-in">
          <div :key="(player?.accountId ?? 'none') + (isSummary ? '-s' : '-b')" class="pd-content">
            <header class="pd-head">
              <h2 class="pd-title" :id="'pd-title-' + (player?.accountId ?? 'x')">{{ player?.nickname || '--' }}</h2>
              <div class="pd-sub">{{ player?.clan || t('league.drawer.no_clan') }}
                <span class="pd-scope">{{ isSummary ? t('league.drawer.scope_summary') : t('league.drawer.scope_battle') }}</span>
              </div>
              <div class="pd-nav">
                <button type="button" class="pd-nav-btn" :disabled="!hasPrev" :aria-label="t('league.drawer.prev_player')"
                        :title="t('league.drawer.prev_player')" data-testid="drawer-prev" @click="onPrev">
                  <ChevronLeft :size="20" aria-hidden="true" />
                </button>
                <button type="button" class="pd-nav-btn" :disabled="!hasNext" :aria-label="t('league.drawer.next_player')"
                        :title="t('league.drawer.next_player')" data-testid="drawer-next" @click="onNext">
                  <ChevronRight :size="20" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div class="pd-rating">
              <span class="pd-rating-label">{{ t('league.drawer.rating_label') }}</span>
              <span class="pd-rating-value" data-testid="drawer-rating">{{ ratingLine().rating }}</span>
            </div>
            <div v-if="isSummary" class="pd-rating-extra">
              <span class="pd-extra">{{ t('league.drawer.observed_mean') }}: <b>{{ num(player?.observedMean) }}</b></span>
              <span class="pd-extra">{{ t('league.drawer.rated_battles') }}: <b>{{ player?.cells?.rated_battles ?? '--' }}</b></span>
            </div>

            <div v-if="vehicle" class="pd-vehicle" data-testid="player-vehicle">
              <div class="pd-vehicle-label">{{ vehicle.label }}</div>
              <div class="pd-vehicle-body">
                <img v-if="vehiclePortrait" :src="vehiclePortrait" :alt="vehicle.tankName"
                     class="pd-vehicle-img" :title="vehicle.tankName" data-testid="player-vehicle-img" />
                <div class="pd-vehicle-meta">
                  <div class="pd-vehicle-name" :title="vehicle.tankName">{{ vehicle.tankName }} <GunMarksBadge v-if="!isSummary" :marks="player?.cells?.gun_marks" /></div>
                  <div v-if="vehicle.battleText || vehicle.rateText" class="pd-vehicle-stats">
                    <span v-if="vehicle.battleText" data-testid="player-vehicle-battles">{{ vehicle.battleText }}</span>
                    <span v-if="vehicle.rateText" data-testid="player-vehicle-rate"
                          :aria-label="t('league.drawer.vehicle_usage_rate') + ': ' + vehicle.rateText">{{ vehicle.rateText }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="pd-section-row">
              <h3 class="pd-section">{{ isSummary ? t('league.drawer.radar_title_summary') : t('league.drawer.radar_title_battle') }}</h3>
              <div class="pd-section-actions">
                <button type="button" class="pd-linkbtn" data-testid="radar-settings" @click="showRadarPicker = !showRadarPicker">
                  {{ showRadarPicker ? t('league.drawer.radar_done') : t('league.drawer.radar_settings') }}
                </button>
                <button type="button" class="pd-linkbtn" data-testid="export-profile" :disabled="playerUnavailable" @click="exportProfile">
                  {{ t('league.drawer.export_profile') }}
                </button>
              </div>
            </div>
            <div v-if="showRadarPicker" class="radar-picker" data-testid="radar-picker">
              <p v-if="radarHint" class="radar-hint">{{ radarHint }}</p>
              <ul class="radar-picker-list">
                <li v-for="key in RADAR_AVAILABLE_KEYS" :key="key"
                    :class="{ checked: radarOrder.includes(key) }">
                  <label class="rp-item">
                    <input type="checkbox" :checked="radarOrder.includes(key)"
                           @change="toggleRadarMetric(key)" />
                    {{ t(RADAR_METRIC_DEFS[key].labelKey) }}
                  </label>
                  <span class="rp-arrows">
                    <button type="button" class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === 0"
                            :aria-label="t('league.drawer.radar_move_up')" :title="t('league.drawer.radar_move_up')"
                            @click="moveRadarMetric(key, -1)"><ArrowUp :size="16" aria-hidden="true" /></button>
                    <button type="button" class="rp-arrow" :disabled="!radarOrder.includes(key) || radarOrder.indexOf(key) === radarOrder.length - 1"
                            :aria-label="t('league.drawer.radar_move_down')" :title="t('league.drawer.radar_move_down')"
                            @click="moveRadarMetric(key, 1)"><ArrowDown :size="16" aria-hidden="true" /></button>
                  </span>
                </li>
              </ul>
            </div>

            <p v-if="playerUnavailable" class="radar-empty" data-testid="radar-unavailable">
              {{ t('league.drawer.radar_dim_unavailable') }}
            </p>
            <PlayerRatingRadar v-else-if="radarMetrics.length" :metrics="radarMetrics" :reference="referenceSeries"
                               :reference-label="referenceLabel" :player-label="player?.nickname || ''" />

            <h3 class="pd-section">{{ isSummary ? t('league.drawer.facts_title_summary') : t('league.drawer.facts_title_battle') }}</h3>
            <dl class="pd-facts" data-testid="player-facts">
              <div v-for="(f, i) in facts" :key="i" class="pd-fact">
                <dt>{{ f[0] }}</dt>
                <dd>{{ f[1] }}</dd>
              </div>
            </dl>
          </div>
        </Transition>
      </aside>
      <div v-if="isDesktop && open" class="pd-resizer" role="separator" aria-orientation="vertical"
           tabindex="0" data-testid="drawer-resizer"
           :aria-label="t('league.drawer.resize_panel')"
           :aria-valuenow="Math.round(drawerWidth)" :aria-valuemin="drawerMinWidth"
           :aria-valuemax="Math.round(drawerMaxWidth())"
           :style="{ right: 'calc(' + drawerWidth + 'px + var(--space-2))' }"
           ref="resizeHandle"
           @pointerdown="onResizeStart" @pointermove="onResizeMove" @pointerup="onResizeEnd"
           @pointercancel="onResizeEnd"
           @keydown.left.stop.prevent="onResizeKey(-20)" @keydown.right.stop.prevent="onResizeKey(20)">
        <span class="pd-resizer-line"></span>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="exportingProfile" class="rp-export" ref="exportCardRef">
      <div class="rp-card">
        <div class="rp-brand">WotBTools · League Rating{{ snapIsSummary ? ' V6' : '' }}</div>
        <div class="rp-player">{{ snapNickname }}<span class="rp-scope">{{ snapReferenceLabel }}</span></div>
        <div class="rp-headline">
          <div class="rp-rating">
            <span class="rp-rating-label">{{ t('league.drawer.rating_label') }}</span>
            <span class="rp-rating-value">{{ snapRating }}</span>
          </div>
          <div v-if="snapIsSummary" class="rp-headline-extra">
            <span class="rp-extra">{{ t('league.drawer.observed_mean') }}: <b>{{ num(snapObservedMean) }}</b></span>
            <span class="rp-extra">{{ t('league.drawer.rated_battles') }}: <b>{{ snapRatedBattles ?? '--' }}</b></span>
          </div>
        </div>
        <div v-if="snapVehicle" class="rp-vehicle">
          <div class="rp-vehicle-label">{{ snapVehicle.label }}</div>
          <div class="rp-vehicle-body">
            <img v-if="exportPortrait" :src="exportPortrait" :alt="snapVehicle.tankName" class="rp-vehicle-img" />
            <div class="rp-vehicle-meta">
              <div class="rp-vehicle-name">{{ snapVehicle.tankName }}</div>
              <div v-if="snapVehicle.battleText || snapVehicle.rateText" class="rp-vehicle-stats">
                <span v-if="snapVehicle.battleText">{{ snapVehicle.battleText }}</span>
                <span v-if="snapVehicle.rateText">{{ snapVehicle.rateText }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="rp-radar">
          <svg :viewBox="'0 0 340 340'" class="rp-radar-svg">
            <polygon v-for="g in snapGrids" :key="'g' + g.value" :points="g.points" class="rp-grid" :class="{ 'rp-grid-strong': g.value === RADAR.STRONG_VALUE }" />
            <line v-for="(r, i) in snapAxes" :key="'a' + i" :x1="RADAR.CENTER" :y1="RADAR.CENTER" :x2="r.x" :y2="r.y" class="rp-axis" />
            <text v-for="t in snapScaleTicks" :key="'t' + t.value" :x="t.p.x" :y="t.p.y" text-anchor="middle" dominant-baseline="middle" font-size="9" class="rp-scale">{{ t.value }}</text>
            <polygon v-if="snapRefs.length" :points="snapRefPoints" class="rp-ref" />
            <polygon :points="snapPlayerPoints" class="rp-data" />
            <template v-for="(m, i) in snapMetrics" :key="'d' + i">
              <circle v-if="m?.available"
                      :cx="axisPoint(i, snapMetrics.length, m.normalized)[0]"
                      :cy="axisPoint(i, snapMetrics.length, m.normalized)[1]" r="3" class="rp-dot" />
            </template>
            <template v-for="(score, i) in snapScoreLabels" :key="'s' + i">
              <g v-if="score" class="rp-score-badge">
                <rect :x="score.x - score.width / 2" :y="score.y - RADAR.SCORE_BADGE_HEIGHT / 2"
                      :width="score.width" :height="RADAR.SCORE_BADGE_HEIGHT" :rx="RADAR.SCORE_BADGE_RADIUS"
                      class="rp-score-bg" />
                <text :x="score.x" :y="score.y" text-anchor="middle" dominant-baseline="middle"
                      font-size="10" class="rp-score">{{ score.value }}</text>
              </g>
            </template>
            <text v-for="(p, i) in snapLabels" :key="'l' + i" :x="p.x" :y="p.y" text-anchor="middle" dominant-baseline="middle" class="rp-label">{{ p.label }}</text>
          </svg>
          <div class="rp-scale-legend">
            <span>{{ t('radarScale.average', { label: snapReferenceLabel }) }}</span>
            <span>{{ t('radarScale.strong') }}</span>
          </div>
          <div class="rp-scale-note">{{ t('radarScale.overflow') }}</div>
        </div>
        <table class="rp-detail">
          <thead><tr><th>{{ t('radar_lbl.dimension') }}</th><th>{{ t('radarScale.playerScore') }}</th><th>{{ t('radarScale.averageScore') }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in snapDetailRows" :key="i">
              <td>{{ row.label }}</td><td>{{ row.player }}</td><td>{{ row.reference }}</td>
            </tr>
          </tbody>
        </table>
        <div class="rp-footer">wotbtools.com</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./player-detail.css"></style>
