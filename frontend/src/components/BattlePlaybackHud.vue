<script setup>
import { computed, nextTick, reactive, watch } from 'vue'
import BaseStatusBar from './BaseStatusBar.vue'
import { baseView } from '../utils/baseStatus.js'
defineOptions({ name: 'BattlePlaybackHud' })

const props = defineProps({
  mapTitle: { type: String, default: '' },
  battleTime: { type: String, default: '' },
  showSummary: { type: Boolean, default: true },
  scoreLabelKey: { type: String, default: 'recon.map.playback.points' },
  friendlyHp: { type: Object, required: true },
  enemyHp: { type: Object, required: true },
  friendlyPoints: { type: Number, default: null },
  enemyPoints: { type: Number, default: null },
  baseStates: { type: Array, default: () => [] },
  friendlyTeam: { type: Number, default: null },
  // §13：seek/恢复帧不补播 HP 伤害动画（与单车 hpNoTransition 同源，父组件传入）。
  hpNoTransition: { type: Boolean, default: false },
})

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function compactNumber(value) {
  const n = finiteNumber(value)
  if (n === null) return '—'
  // §11：HUD 禁止缩写（1k / 22.3k），必须显示完整整数（1000 / 22305）；
  // 空间不足时靠 responsive layout 调整，不牺牲 authoritative value 精度。
  return String(Math.round(n))
}

function hpText(hp) {
  if (!hp || hp.state === 'UNKNOWN') return '—'
  if (hp.state === 'FULL_RELATIVE') return '100%'
  if (hp.state === 'EXACT') return compactNumber(hp.knownRemaining) + ' / ' + compactNumber(hp.totalMax)
  return compactNumber(hp.knownRemaining)
}

function barFill(hp, kind) {
  if (!hp || typeof hp !== 'object') return '0%'
  if (hp.state === 'FULL_RELATIVE') return kind === 'known' ? '100%' : '0%'
  const totalValue = finiteNumber(hp.totalMax)
  const total = totalValue === null ? 0 : Math.max(0, totalValue)
  const knownRemaining = finiteNumber(hp.knownRemaining)
  if (total <= 0) return kind === 'known' && hp.state === 'PARTIAL' && knownRemaining !== null && knownRemaining > 0 ? '100%' : '0%'
  const rawValue = kind === 'known' ? hp.knownRemaining : hp.unknownMax
  const value = finiteNumber(rawValue) ?? 0
  return (Math.max(0, Math.min(100, (value / total) * 100))).toFixed(1) + '%'
}

function hasPoints() {
  return props.friendlyPoints != null || props.enemyPoints != null
}

// ---- §13：Team HP delayed-damage bar ----
// authoritative current HP 立即更新；delayed bar 短暂停留在旧值，随后追赶当前值
//（150–250ms 克制过渡）；seek/恢复（hpNoTransition）直接同步，不补播伤害动画。
function fillPctNum(hp) {
  if (!hp || typeof hp !== 'object') return 0
  // §13 aggregated states only：FULL_RELATIVE / EXACT / PARTIAL / UNKNOWN
  // （TEAM HUD 用 friendlyHealthAt 聚合态，不用单车 RELATIVE_FULL/CURRENT/LAST_KNOWN/DESTROYED）。
  if (hp.state === 'UNKNOWN') return 0
  if (hp.state === 'FULL_RELATIVE') return 100
  const totalValue = finiteNumber(hp.totalMax)
  const total = totalValue === null ? 0 : Math.max(0, totalValue)
  const knownRemaining = finiteNumber(hp.knownRemaining)
  if (total <= 0) return hp.state === 'PARTIAL' && knownRemaining != null && knownRemaining > 0 ? 100 : 0
  const value = finiteNumber(knownRemaining) ?? 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}
const lagPct = reactive({ friendly: 0, enemy: 0 })
const lastPct = reactive({ friendly: null, enemy: null })
function trackHp(team, hp) {
  const cur = fillPctNum(hp)
  const prev = lastPct[team]
  if (prev != null && cur < prev - 0.01 && !props.hpNoTransition) {
    const drop = prev - cur
    lagPct[team] = drop
    nextTick(() => { if (!props.hpNoTransition) lagPct[team] = 0 })
  } else {
    lagPct[team] = 0
  }
  lastPct[team] = cur
}
watch(() => props.friendlyHp, (hp) => trackHp('friendly', hp), { immediate: true })
watch(() => props.enemyHp, (hp) => trackHp('enemy', hp), { immediate: true })

// 基地状态条与 3D 共用（BaseStatusBar + utils/baseStatus.js 同一口径）
const baseViews = computed(() => props.baseStates.map((state) => baseView(state, props.friendlyTeam)))

</script>

<template>
  <section class="pb-hud" :class="{ 'pb-hud-notransition': props.hpNoTransition }" data-test="pb-hud" :aria-label="$t('recon.map.playback.hud')">
    <div v-if="(props.showSummary && (props.mapTitle || props.battleTime)) || props.baseStates.length || $slots.bases" class="pb-hud-meta" data-test="pb-hud-meta">
      <span v-if="props.showSummary && props.mapTitle" class="pb-hud-map" data-test="pb-hud-map">{{ props.mapTitle }}</span>
      <div v-if="props.baseStates.length || $slots.bases" class="pb-hud-bases" data-test="pb-hud-bases">
        <slot name="bases"><BaseStatusBar :bases="baseViews" compact /></slot>
      </div>
      <span v-if="props.showSummary && props.battleTime" class="pb-hud-time" data-test="pb-hud-time">{{ props.battleTime }}</span>
    </div>
    <div v-if="props.showSummary" class="pb-hud-grid" data-test="pb-hp-bars">
    <div class="pb-hud-team pb-hud-friendly pb-hud-column-friendly pb-hp-row" data-test="pb-hud-friendly">
      <span class="pb-hud-value pb-hp-value" data-test="pb-hp-value-friendly">{{ hpText(props.friendlyHp) }}</span>
      <span class="pb-hud-track pb-hp-track" aria-hidden="true">
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-friendly" :class="{ 'pb-hud-partial': props.friendlyHp?.state === 'PARTIAL' }" :style="{ width: barFill(props.friendlyHp, 'known') }" data-test="pb-hp-fill-friendly"></span>
        <span class="pb-hud-lag" data-test="pb-hud-lag-friendly" :style="{ left: barFill(props.friendlyHp, 'known'), width: lagPct.friendly + '%' }"></span>
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-unknown" :style="{ width: barFill(props.friendlyHp, 'unknown') }"></span>
      </span>
    </div>

    <div v-if="hasPoints()" class="pb-hud-center pb-hud-column-center" data-test="pb-hud-center">
      <div class="pb-hud-points" data-test="pb-hud-points">
        <strong data-test="pb-hud-score">
          <span v-if="props.friendlyPoints != null" data-test="pb-points-friendly">{{ compactNumber(props.friendlyPoints) }}</span>
          <span v-if="props.friendlyPoints != null && props.enemyPoints != null"> : </span>
          <span v-if="props.enemyPoints != null" data-test="pb-points-enemy">{{ compactNumber(props.enemyPoints) }}</span>
        </strong>
      </div>

    </div>
    <div class="pb-hud-team pb-hud-enemy pb-hud-column-enemy pb-hp-row" data-test="pb-hud-enemy">
      <span class="pb-hud-value pb-hp-value" data-test="pb-hp-value-enemy">{{ hpText(props.enemyHp) }}</span>
      <span class="pb-hud-track pb-hp-track" aria-hidden="true">
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-enemy" :class="{ 'pb-hud-partial': props.enemyHp?.state === 'PARTIAL' }" :style="{ width: barFill(props.enemyHp, 'known') }" data-test="pb-hp-fill-enemy"></span>
        <span class="pb-hud-lag" data-test="pb-hud-lag-enemy" :style="{ left: barFill(props.enemyHp, 'known'), width: lagPct.enemy + '%' }"></span>
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-unknown" :style="{ width: barFill(props.enemyHp, 'unknown') }"></span>
      </span>
    </div>
    </div>
  </section>
</template>

<style scoped>
.pb-hud {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
}
.pb-hud-meta { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); min-width: 0; font: var(--type-caption); }
.pb-hud-map { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-hud-time { flex: none; font-variant-numeric: tabular-nums; }
.pb-hud-bases { display: flex; flex: none; justify-content: center; min-width: 0; margin-inline: auto; }
.pb-hud-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--space-2); }
.pb-hud-column-friendly { grid-column: 1; }
.pb-hud-column-center { grid-column: 2; }
.pb-hud-points { display: grid; justify-items: center; }
.pb-hud-column-enemy { grid-column: 3; }
/* 队伍血量：数值居中在血条上方（无标签文字）。 */
.pb-hud-team { display: grid; grid-template-columns: minmax(0, 1fr); align-items: center; gap: var(--space-1); min-width: 0; }
.pb-hud-value { grid-row: 1; grid-column: 1; justify-self: center; white-space: nowrap; font: var(--type-caption); font-weight: 700; font-variant-numeric: tabular-nums; }
.pb-hud-track { position: relative; grid-column: 1 / -1; grid-row: 2; display: flex; min-width: 0; height: var(--space-1); overflow: hidden; border-radius: var(--radius-full); background: var(--color-surface-3); }
.pb-hud-fill { height: 100%; transition: width var(--duration-base) var(--ease-standard); }
.pb-hud-fill-friendly { background: var(--color-team-ally); }
.pb-hud-fill-enemy { background: var(--color-team-enemy); }
.pb-hud-fill-unknown { background: var(--color-text-tertiary); }
.pb-hud-lag { position: absolute; top: 0; height: 100%; background: var(--color-danger); transition: width var(--duration-slow) var(--ease-standard); pointer-events: none; }
.pb-hud-notransition .pb-hud-fill, .pb-hud-notransition .pb-hud-lag { transition: none; }
.pb-hud-partial { background-image: repeating-linear-gradient(45deg, color-mix(in srgb, var(--color-text-primary) 28%, transparent) 0 var(--space-1), transparent var(--space-1) var(--space-2)); }
.pb-hud-center { display: grid; justify-items: center; min-width: 0; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.pb-hud-center strong { font: var(--type-caption); font-weight: 700; white-space: nowrap; }
@media (width >= 1200px) {
  .pb-hud { padding: var(--space-2) var(--space-3); gap: var(--space-2); }
  .pb-hud-meta, .pb-hud-value, .pb-hud-center strong { font: var(--type-h3); }
  .pb-hud-value, .pb-hud-center strong { font-weight: 700; }
  .pb-hud-track { height: var(--space-2); }
}
@media (width < 768px) {
  .pb-hud-grid { gap: var(--space-1); }
  .pb-hud-value { white-space: normal; overflow-wrap: anywhere; }
  .pb-hud-enemy .pb-hud-track { grid-column: 1; grid-row: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-hud-fill, .pb-hud-lag { transition: none; }
}
</style>
