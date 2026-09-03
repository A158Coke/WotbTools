<script setup>
defineOptions({ name: 'BattlePlaybackHud' })

const props = defineProps({
  friendlyHp: { type: Object, required: true },
  enemyHp: { type: Object, required: true },
  friendlyPoints: { type: Number, default: null },
  enemyPoints: { type: Number, default: null },
})

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function compactNumber(value) {
  const n = finiteNumber(value)
  if (n === null) return '—'
  if (Math.abs(n) < 1000) return String(Math.round(n))
  return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
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
  return (props.friendlyPoints == null ? '—' : compactNumber(props.friendlyPoints))
    + ' : ' + (props.enemyPoints == null ? '—' : compactNumber(props.enemyPoints))
}
</script>

<template>
  <section class="pb-hud pb-hp-bars" data-test="pb-hud" :aria-label="$t('recon.map.playback.hud')">
    <div class="pb-hud-team pb-hud-friendly pb-hp-row" data-test="pb-hud-friendly">
      <span class="pb-hud-label">{{ $t('recon.map.playback.team_friendly') }}</span>
      <span class="pb-hud-value pb-hp-value pb-hud-wide" data-test="pb-hp-value-friendly">{{ hpText(props.friendlyHp, 'wide') }}</span>
      <span class="pb-hud-value pb-hud-medium">{{ hpText(props.friendlyHp, 'medium') }}</span>
      <span class="pb-hud-value pb-hud-compact">{{ hpText(props.friendlyHp, 'compact') }}</span>
      <span class="pb-hud-track pb-hp-track" aria-hidden="true">
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-friendly" :class="{ 'pb-hud-partial': props.friendlyHp?.state === 'PARTIAL' }" :style="{ width: barFill(props.friendlyHp, 'known') }" data-test="pb-hp-fill-friendly"></span>
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-unknown" :style="{ width: barFill(props.friendlyHp, 'unknown') }"></span>
      </span>
    </div>

    <div class="pb-hud-center" data-test="pb-hud-center">
      <strong data-test="pb-hud-score">{{ scoreText() }}</strong>
      <span class="pb-hud-objective" data-test="pb-hud-objective" aria-hidden="true"></span>
    </div>

    <div class="pb-hud-team pb-hud-enemy pb-hp-row" data-test="pb-hud-enemy">
      <span class="pb-hud-label">{{ $t('recon.map.playback.team_enemy') }}</span>
      <span class="pb-hud-value pb-hp-value pb-hud-wide" data-test="pb-hp-value-enemy">{{ hpText(props.enemyHp, 'wide') }}</span>
      <span class="pb-hud-value pb-hud-medium">{{ hpText(props.enemyHp, 'medium') }}</span>
      <span class="pb-hud-value pb-hud-compact">{{ hpText(props.enemyHp, 'compact') }}</span>
      <span class="pb-hud-track pb-hp-track" aria-hidden="true">
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-enemy" :class="{ 'pb-hud-partial': props.enemyHp?.state === 'PARTIAL' }" :style="{ width: barFill(props.enemyHp, 'known') }" data-test="pb-hp-fill-enemy"></span>
        <span class="pb-hud-fill pb-hp-fill pb-hud-fill-unknown" :style="{ width: barFill(props.enemyHp, 'unknown') }"></span>
      </span>
    </div>
  </section>
</template>

<style scoped>
.pb-hud { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: clamp(8px, 2vw, 28px); padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-card2) 86%, transparent); color: var(--text-label); }
.pb-hud-team { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 9px; min-width: 0; }
.pb-hud-enemy { text-align: right; grid-template-columns: auto minmax(0, 1fr); }
.pb-hud-label { grid-column: 1; grid-row: 1; color: var(--text-muted); font-size: .68rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.pb-hud-enemy .pb-hud-label { grid-column: 2; }
.pb-hud-value { grid-row: 1; grid-column: 2; white-space: nowrap; font-variant-numeric: tabular-nums; font-size: clamp(.72rem, 1.2vw, .9rem); font-weight: 800; }
.pb-hud-enemy .pb-hud-value { grid-column: 1; }
.pb-hud-track { grid-column: 1 / -1; grid-row: 2; display: flex; min-width: 0; height: 8px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--text-muted) 18%, transparent); }
.pb-hud-fill { height: 100%; transition: width .15s linear; }
.pb-hud-fill-friendly { background: var(--map-spawn-friendly); }
.pb-hud-fill-enemy { background: var(--map-spawn-enemy); }
.pb-hud-fill-unknown { background: color-mix(in srgb, var(--text-muted) 42%, transparent); }
.pb-hud-partial { background-image: repeating-linear-gradient(45deg, color-mix(in srgb, var(--text) 28%, transparent) 0 3px, transparent 3px 6px); }
.pb-hud-center { display: grid; justify-items: center; gap: 3px; min-width: 7ch; color: var(--text-heading); font-variant-numeric: tabular-nums; }
.pb-hud-center strong { font-size: clamp(.9rem, 2vw, 1.2rem); white-space: nowrap; }
.pb-hud-objective { min-height: 1em; }
.pb-hud-medium, .pb-hud-compact { display: none; }
@media (768px <= width < 1200px) {
  .pb-hud-wide { display: none; }
  .pb-hud-medium { display: inline; }
}
@media (width < 768px) {
  .pb-hud { gap: 5px; padding: 6px 7px; border-radius: 6px; }
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
}
</style>
