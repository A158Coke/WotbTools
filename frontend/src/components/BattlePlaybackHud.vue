<script setup>
import { computed, nextTick, reactive, watch } from 'vue'
defineOptions({ name: 'BattlePlaybackHud' })

const props = defineProps({
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

function wideNumber(value) {
  const n = finiteNumber(value)
  if (n === null) return '—'
  return String(Math.round(n))
}

function hpText(hp, density) {
  if (!hp || hp.state === 'UNKNOWN') return '—'
  if (hp.state === 'FULL_RELATIVE') return '100%'
  if (hp.state === 'EXACT') {
    if (density === 'wide') return wideNumber(hp.knownRemaining) + ' / ' + wideNumber(hp.totalMax)
    if (density === 'medium') return compactNumber(hp.knownRemaining) + ' / ' + compactNumber(hp.totalMax)
    return compactNumber(hp.knownRemaining)
  }
  return density === 'wide' ? wideNumber(hp.knownRemaining) : compactNumber(hp.knownRemaining)
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

function scoreText() {
  return [props.friendlyPoints, props.enemyPoints]
    .filter(value => value != null)
    .map(compactNumber)
    .join(' : ')
}

function hasPoints() {
  return props.friendlyPoints != null || props.enemyPoints != null
}

function hasCenterData() {
  return hasPoints() || props.baseStates.length > 0
}

// ---- §13：Team HP delayed-damage bar ----
// authoritative current HP 立即更新；delayed bar 短暂停留在旧值，随后追赶当前值
//（150–250ms 克制过渡）；seek/恢复（hpNoTransition）直接同步，不补播伤害动画。
function fillPctNum(hp) {
  if (!hp || typeof hp !== 'object') return 0
  if (hp.state === 'DESTROYED' || hp.state === 'UNKNOWN') return 0
  if (hp.state === 'RELATIVE_FULL') return 100
  if ((hp.state === 'CURRENT' || hp.state === 'LAST_KNOWN') && hp.pct != null) return hp.pct
  const totalValue = finiteNumber(hp.totalMax)
  const total = totalValue === null ? 0 : Math.max(0, totalValue)
  const knownRemaining = finiteNumber(hp.knownRemaining)
  if (total <= 0) return (hp.state === 'CURRENT' || hp.state === 'LAST_KNOWN') && knownRemaining != null && knownRemaining > 0 ? 100 : 0
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

function baseStatus(state) {
  if (state.capturingTeam != null) return 'capturing'
  if (state.ownerTeam == null) return 'neutral'
  if (props.friendlyTeam == null) return 'controlled'
  return state.ownerTeam === props.friendlyTeam ? 'friendly_controlled' : 'enemy_controlled'
}

</script>

<template>
  <section class="pb-hud" data-test="pb-hud" :aria-label="$t('recon.map.playback.hud')">
    <div class="pb-hud-grid" data-test="pb-hp-bars">
    <div class="pb-hud-team pb-hud-friendly pb-hud-column-friendly pb-hp-row" data-test="pb-hud-friendly">
      <span class="pb-hud-label" data-test="pb-hud-points-label-friendly">{{ $t('recon.map.playback.hud_friendly_hp') }}</span>
      <span class="pb-hud-value pb-hp-value pb-hud-wide" data-test="pb-hp-value-friendly">{{ hpText(props.friendlyHp, 'wide') }}</span>
      <span class="pb-hud-value pb-hud-medium">{{ hpText(props.friendlyHp, 'medium') }}</span>
      <span class="pb-hud-value pb-hud-compact">{{ hpText(props.friendlyHp, 'compact') }}</span>
      <span class="pb-hud-track pb-hp-track" aria-hidden="true">
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-friendly" :class="{ 'pb-hud-partial': props.friendlyHp?.state === 'PARTIAL' }" :style="{ width: barFill(props.friendlyHp, 'known') }" data-test="pb-hp-fill-friendly"></span>
        <span class="pb-hud-lag" data-test="pb-hud-lag-friendly" :style="{ left: barFill(props.friendlyHp, 'known'), width: lagPct.friendly + '%' }"></span>
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-unknown" :style="{ width: barFill(props.friendlyHp, 'unknown') }"></span>
      </span>
    </div>

    <div v-if="hasCenterData()" class="pb-hud-center pb-hud-column-center" data-test="pb-hud-center">
      <div v-if="hasPoints()" class="pb-hud-points" data-test="pb-hud-points">
        <span class="pb-hud-label" data-test="pb-hud-points-label">{{ $t('recon.map.playback.points') }}</span>
        <strong data-test="pb-hud-score">
          <span v-if="props.friendlyPoints != null" data-test="pb-points-friendly">{{ compactNumber(props.friendlyPoints) }}</span>
          <span v-if="props.friendlyPoints != null && props.enemyPoints != null"> : </span>
          <span v-if="props.enemyPoints != null" data-test="pb-points-enemy">{{ compactNumber(props.enemyPoints) }}</span>
        </strong>
      </div>
      <div v-if="props.baseStates.length" class="pb-hud-bases" data-test="pb-hud-bases">
        <span v-for="state in props.baseStates" :key="state.baseId" class="pb-hud-base" :class="`pb-hud-base-${baseStatus(state)}`" :title="$t(`recon.map.playback.base_status_${baseStatus(state)}`)">
          <b>{{ state.baseId }}</b>
          <span class="pb-hud-base-status">{{ $t(`recon.map.playback.base_status_${baseStatus(state)}`) }}</span>
          <i v-if="state.captureProgress != null" class="pb-hud-base-progress" :style="{ '--pb-base-progress': `${state.captureProgress}%` }" :aria-label="$t('recon.map.playback.base_progress', { progress: state.captureProgress })"></i>
        </span>
      </div>
    </div>
    <div class="pb-hud-team pb-hud-enemy pb-hud-column-enemy pb-hp-row" data-test="pb-hud-enemy">
      <span class="pb-hud-label" data-test="pb-hud-points-label-enemy">{{ $t('recon.map.playback.hud_enemy_hp') }}</span>
      <span class="pb-hud-value pb-hp-value pb-hud-wide" data-test="pb-hp-value-enemy">{{ hpText(props.enemyHp, 'wide') }}</span>
      <span class="pb-hud-value pb-hud-medium">{{ hpText(props.enemyHp, 'medium') }}</span>
      <span class="pb-hud-value pb-hud-compact">{{ hpText(props.enemyHp, 'compact') }}</span>
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
.pb-hud { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-card2) 86%, transparent); color: var(--text-label); }
.pb-hud-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: clamp(8px, 2vw, 28px); }
.pb-hud-column-friendly { grid-column: 1; }
.pb-hud-column-center { grid-column: 2; }
.pb-hud-points { display: flex; align-items: center; gap: 8px; justify-content: center; }
.pb-hud-column-enemy { grid-column: 3; }
.pb-hud-team { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 9px; min-width: 0; }
.pb-hud-enemy { text-align: right; grid-template-columns: auto minmax(0, 1fr); }
.pb-hud-label { grid-column: 1; grid-row: 1; color: var(--text-muted); font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.pb-hud-enemy .pb-hud-label { grid-column: 2; }
.pb-hud-value { grid-row: 1; grid-column: 2; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: clamp(.72rem, 1.2vw, .9rem); font-weight: 800; }
.pb-hud-enemy .pb-hud-value { grid-column: 1; }
.pb-hud-track { position: relative; grid-column: 1 / -1; grid-row: 2; display: flex; min-width: 0; height: 8px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--text-muted) 18%, transparent); }
.pb-hud-fill { height: 100%; transition: width .15s linear; }
.pb-hud-fill-friendly { background: var(--map-spawn-friendly); }
.pb-hud-fill-enemy { background: var(--map-spawn-enemy); }
.pb-hud-fill-unknown { background: color-mix(in srgb, var(--text-muted) 42%, transparent); }
/* §13.2：delayed-damage chip —— HP 下降时短暂停留在旧值，随后 0.42s 追赶当前值 */
.pb-hud-lag { position: absolute; top: 0; height: 100%; background: color-mix(in srgb, var(--error) 45%, transparent); transition: width .42s ease-out; pointer-events: none; }
.pb-hud-partial { background-image: repeating-linear-gradient(45deg, color-mix(in srgb, var(--text) 28%, transparent) 0 3px, transparent 3px 6px); }
.pb-hud-center { display: grid; justify-items: center; gap: 3px; min-width: 7ch; color: var(--text-heading); font-variant-numeric: tabular-nums; }
.pb-hud-center strong { font-size: clamp(.9rem, 2vw, 1.2rem); white-space: nowrap; }
.pb-hud-bases { display: flex; justify-content: center; gap: 4px; flex-wrap: wrap; }
.pb-hud-base { display: inline-flex; align-items: center; gap: 3px; min-width: 2.2em; padding: 2px 4px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 4px; font-size: .68rem; }
.pb-hud-base b { font-size: .78rem; }
.pb-hud-base-status { color: var(--text-muted); }
.pb-hud-base-friendly_controlled { color: var(--map-spawn-friendly); }
.pb-hud-base-enemy_controlled { color: var(--map-spawn-enemy); }
.pb-hud-base-capturing { color: var(--accent); }
.pb-hud-base-neutral { color: var(--text-muted); }
.pb-hud-base-controlled { color: var(--text-label); }
.pb-hud-base-progress { display: inline-block; width: 22px; height: 4px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--text-muted) 22%, transparent); }
.pb-hud-base-progress::before { display: block; width: var(--pb-base-progress); height: 100%; background: currentColor; content: ''; }
.pb-hud-medium, .pb-hud-compact { display: none; }
@media (768px <= width < 1200px) {
  .pb-hud-wide { display: none; }
  .pb-hud-medium { display: inline; }
}
@media (width < 768px) {
  .pb-hud { padding: 6px 7px; border-radius: 6px; }
  .pb-hud-grid { gap: 5px; }
  .pb-hud-label { display: none; }
  .pb-hud-wide, .pb-hud-medium { display: none; }
  .pb-hud-compact { display: inline; }
  .pb-hud-team { grid-template-columns: minmax(0, 1fr); gap: 3px; }
  .pb-hud-friendly .pb-hud-value { grid-column: 1; }
  .pb-hud-enemy .pb-hud-label, .pb-hud-enemy .pb-hud-value { grid-column: 1; }
  .pb-hud-enemy .pb-hud-value { grid-row: 1; }
  .pb-hud-enemy .pb-hud-track { grid-column: 1; grid-row: 2; }
  .pb-hud-center { min-width: 6ch; }
  .pb-hud-center strong { font-size: .82rem; }
  .pb-hud-base-status { display: none; }
  .pb-hud-base { min-width: 1.8em; justify-content: center; }
}
@media (prefers-reduced-motion: reduce) {
  .pb-hud-fill, .pb-hud-lag { transition: none; }
}
</style>
