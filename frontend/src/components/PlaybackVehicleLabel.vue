<script setup>
import { computed, nextTick, ref, watch } from 'vue'

// One presentation for map-positioned and camera-projected vehicles. Facts and
// reload interpretation belong to the callers; this component only presents them.
const props = defineProps({
  playerName: { type: String, default: '' },
  tankName: { type: String, default: '' },
  friendly: { default: null },
  destroyed: Boolean,
  lastKnown: Boolean,
  showPlayerName: Boolean,
  showTankName: { type: Boolean, default: true },
  showHp: { type: Boolean, default: true },
  showReload: { type: Boolean, default: true },
  hp: { type: Object, default: null },
  reload: { type: Array, default: null },
  hpGhost: { type: Object, default: null },
  hpFlash: Boolean,
  hpNoTransition: Boolean,
  hpTitle: { type: String, default: '' },
  nameTooltips: Boolean,
})
const playerLine = ref(null)
const playerTruncated = ref(false)
watch(() => [props.playerName, props.showPlayerName], async () => {
  await nextTick()
  const el = playerLine.value
  playerTruncated.value = !!el && el.scrollWidth > el.clientWidth + 1
}, { immediate: true })
const hpPct = computed(() => Number.isFinite(props.hp?.pct) ? Math.max(0, Math.min(100, props.hp.pct)) : null)
const hpFillUnknown = computed(() => ['CURRENT', 'LAST_KNOWN'].includes(props.hp?.state)
  && props.hp?.current != null && hpPct.value == null)
const hpFillWidth = computed(() => {
  if (['UNKNOWN', 'DESTROYED'].includes(props.hp?.state)) return '0%'
  if (props.hp?.state === 'RELATIVE_FULL') return '100%'
  return hpPct.value != null ? `${hpPct.value}%` : hpFillUnknown.value ? '100%' : '0%'
})
const ghostWidth = computed(() => {
  const g = props.hpGhost
  return g && Number.isFinite(g.prevPct) && Number.isFinite(g.nextPct)
    && g.prevPct - g.nextPct > 0.5 ? g.prevPct - g.nextPct : null
})
const classes = computed(() => ({
  'label-friendly': props.friendly === true,
  'label-enemy': props.friendly === false,
  'label-destroyed': props.destroyed,
  'label-last-known': props.lastKnown && !props.destroyed,
}))
</script>

<template>
  <div class="vehicle-label" :class="classes" data-test="playback-vehicle-label" aria-hidden="true">
    <div v-if="showHp && hp && !destroyed" class="pb-hp-hud" data-test="pb-hp-hud"
      :class="{ 'pb-hp-lastknown': hp.state === 'LAST_KNOWN', 'pb-hp-flash': hpFlash, 'pb-hp-no-transition': hpNoTransition, 'pb-hp-full-spawn': hp.state === 'RELATIVE_FULL' }"
      :title="hpTitle">
      <div class="hp-values">
        <span class="pb-hp-num" data-test="pb-hp-num">{{ hp.current ?? '—' }}</span>
        <span class="pb-hp-pct" data-test="pb-hp-pct">{{ hpPct == null ? '—' : `${Math.round(hpPct)}%` }}</span>
      </div>
      <span class="pb-hp-bar" :class="{ 'pb-hp-unknown-track': hpFillUnknown }">
        <span class="pb-hp-fill" :class="{ 'pb-hp-fill-unknown': hpFillUnknown }" :style="{ width: hpFillWidth }"></span>
        <span v-if="ghostWidth != null" class="pb-hp-ghost" :style="{ left: hpGhost.nextPct + '%', width: ghostWidth + '%' }"></span>
      </span>
    </div>
    <div v-if="showPlayerName || showTankName" class="pb-labels">
      <span v-if="showPlayerName && playerName" ref="playerLine" class="pb-label-player" data-test="pb-label-player"
        :class="{ 'name-tooltip': nameTooltips }" :title="nameTooltips && playerTruncated ? playerName : undefined">{{ playerName }}</span>
      <span v-if="showTankName" class="pb-label-tank pb-name" data-test="pb-label-tank">{{ tankName }}</span>
    </div>
    <span v-if="showReload && !destroyed && friendly === true && reload?.length" class="reload-bar" data-test="pb-reload">
      <span v-for="(shell, index) in reload" :key="index" class="reload-shell" :data-state="shell.state">
        <span class="reload-fill" :style="{ width: (shell.state === 'full' ? 100 : shell.state === 'loading' ? Math.max(0, Math.min(1, shell.progress)) * 100 : 0) + '%' }"></span>
      </span>
    </span>
  </div>
</template>

<style scoped>
.vehicle-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-team-neutral);
  font: var(--type-caption);
  font-weight: 600;
  text-shadow: var(--text-shadow-playback-label);
  pointer-events: none;
}
.label-friendly { color: var(--pb-team-text, var(--color-team-ally)); }
.label-enemy { color: var(--pb-enemy-text, var(--color-team-enemy)); }
.pb-labels { display: flex; flex-direction: column; align-items: center; }
.pb-label-tank { white-space: nowrap; }
.pb-label-player { max-width: var(--pb-label-player-width); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name-tooltip { pointer-events: auto; }
.label-destroyed .pb-labels { color: var(--color-playback-label-destroyed); text-decoration: line-through; }
/* §25 last-known：**只弱化文字两行**（.65），HP HUD / 血条等背景块保持正常强度。
   不要写成整块 opacity（那会把背景一起淡化，是重构时丢过一次的契约）。 */
.label-last-known .pb-label-tank,
.label-last-known .pb-label-player { opacity: .65; }
.label-last-known .pb-hp-hud { opacity: .55; }
.pb-hp-hud { display: flex; flex-direction: column; align-items: center; gap: var(--space-0); }
.hp-values { display: flex; gap: var(--space-1); font-variant-numeric: tabular-nums; }
.pb-hp-num { color: var(--color-playback-label-text); }
.pb-hp-bar, .reload-bar { width: var(--pb-label-bar-width); height: var(--space-1); border-radius: var(--radius-full); background: var(--color-playback-label-track); overflow: hidden; }
.pb-hp-bar { position: relative; }
.pb-hp-fill, .pb-hp-ghost { position: absolute; inset-block: 0; left: 0; background: currentColor; }
.pb-hp-fill { transition: width var(--duration-base) linear; }
.pb-hp-fill-unknown { background: var(--color-playback-label-destroyed); opacity: .5; }
.pb-hp-ghost { opacity: .55; animation: label-ghost var(--duration-slow) linear forwards; }
.pb-hp-flash .pb-hp-fill { filter: brightness(1.5); }
.pb-hp-no-transition .pb-hp-fill { transition: none; }
.reload-bar { display: flex; gap: calc(var(--space-1) / 2); height: calc(var(--space-1) * 1.5); }
.reload-shell { flex: 1; background: var(--color-playback-label-track); }
.reload-shell[data-state="locked"] { background: var(--color-playback-label-locked); }
.reload-fill { display: block; height: 100%; background: var(--color-playback-label-text); }
@keyframes label-ghost { to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .pb-hp-ghost { animation: none; } }
</style>
