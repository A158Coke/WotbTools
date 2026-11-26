<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import GunMarksBadge from './GunMarksBadge.vue'
import PlaybackConsumableBadge from './PlaybackConsumableBadge.vue'

const props = defineProps({
  playerName: { type: String, default: '' },
  tankName: { type: String, default: '' },
  gunMarks: { default: null },
  friendly: { default: null },
  destroyed: Boolean,
  lastKnown: Boolean,
  showPlayerName: Boolean,
  showTankName: { type: Boolean, default: true },
  showHp: { type: Boolean, default: true },
  showReload: { type: Boolean, default: true },
  hp: { type: Object, default: null },
  reload: { type: Array, default: null },
  consumables: { type: Array, default: () => [] },
  hpGhost: { type: Object, default: null },
  hpFlash: Boolean,
  hpNoTransition: Boolean,
  hpTitle: { type: String, default: '' },
  nameTooltips: Boolean,
  lastKnownLabel: { type: String, default: '' },
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
const ghostStyle = computed(() => ({
  left: `${props.hpGhost.nextPct}%`,
  width: `${ghostWidth.value}%`,
  animationDuration: props.hpGhost.durationMs ? `${props.hpGhost.durationMs}ms` : undefined,
}))
const activeConsumables = computed(() => (Array.isArray(props.consumables) ? props.consumables : [])
  .filter((c) => c && typeof c.logicalItemId === 'string' && c.logicalItemId.length > 0
    && Number.isFinite(c.remainingSec) && c.remainingSec > 0
    && Number.isFinite(c.durationSec) && c.durationSec > 0))
const classes = computed(() => ({
  'label-friendly': props.friendly === true,
  'label-enemy': props.friendly === false,
  'label-destroyed': props.destroyed,
  'label-last-known': props.lastKnown && !props.destroyed,
}))
</script>

<template>
  <div class="vehicle-label" :class="classes" data-test="playback-vehicle-label" aria-hidden="true">
    <div v-if="(showPlayerName && playerName) || showTankName" class="pb-labels">
      <span v-if="showPlayerName && playerName" ref="playerLine" class="pb-label-player" data-test="pb-label-player"
        :class="{ 'name-tooltip': nameTooltips }" :title="nameTooltips && playerTruncated ? playerName : undefined">{{ playerName }}</span>
      <span v-if="showTankName" class="pb-label-tank pb-name" data-test="pb-label-tank">{{ tankName }} <GunMarksBadge :marks="gunMarks" /></span>
      <span v-if="lastKnown && lastKnownLabel" class="pb-last-known-tag" data-test="pb-last-known">{{ lastKnownLabel }}</span>
    </div>
    <div v-if="!destroyed && ((showHp && hp) || (showReload && friendly === true && reload?.length))" class="pb-combat-state">
      <div v-if="showHp && hp && !destroyed" class="pb-hp-hud" data-test="pb-hp-hud"
        :class="{ 'pb-hp-lastknown': hp.state === 'LAST_KNOWN', 'pb-hp-flash': hpFlash, 'pb-hp-no-transition': hpNoTransition, 'pb-hp-full-spawn': hp.state === 'RELATIVE_FULL' }"
        :title="hpTitle">
        <span class="pb-hp-row">
          <span v-if="activeConsumables.length" class="pb-consumables" data-test="pb-consumables">
            <PlaybackConsumableBadge v-for="c in activeConsumables" :key="c.slot"
              :logical-item-id="c.logicalItemId"
              :remaining-sec="c.remainingSec" :duration-sec="c.durationSec" />
          </span>
          <span class="pb-hp-bar" :class="{ 'pb-hp-unknown-track': hpFillUnknown }">
            <span class="pb-hp-fill" :class="{ 'pb-hp-fill-unknown': hpFillUnknown }" :style="{ width: hpFillWidth }"></span>
            <span v-if="ghostWidth != null" :key="hpGhost.nextPct" class="pb-hp-ghost" data-test="pb-hp-ghost"
              :data-born-ms="hpGhost.bornMs" :style="ghostStyle"></span>
            <span class="pb-hp-num" data-test="pb-hp-num">{{ hp.current ?? '—' }}</span>
          </span>
        </span>
      </div>
      <span v-if="showReload && !destroyed && friendly === true && reload?.length" class="reload-bar" data-test="pb-reload">
        <span v-for="(shell, index) in reload" :key="index" class="reload-shell" :data-state="shell.state">
          <span class="reload-fill" :style="{ width: (shell.state === 'full' ? 100 : shell.state === 'loading' ? Math.max(0, Math.min(1, shell.progress)) * 100 : 0) + '%' }"></span>
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vehicle-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(var(--space-1) * 2);
  color: var(--color-team-neutral);
  font: var(--type-caption);
  font-weight: 600;
  text-shadow: var(--text-shadow-playback-label);
  pointer-events: none;
}
.label-friendly { color: var(--pb-team-text, var(--color-team-ally)); }
.label-enemy { color: var(--pb-enemy-text, var(--color-team-enemy)); }
.pb-combat-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.pb-labels { display: flex; flex-direction: column; align-items: center; padding: calc(var(--space-1) / 2) var(--space-1); border-radius: var(--radius-sm); background: color-mix(in oklab, var(--color-canvas) 45%, transparent); backdrop-filter: blur(var(--space-1)); }
.pb-label-tank { white-space: nowrap; --gun-marks-width: var(--space-3); --gun-marks-height: var(--space-4); }
.pb-label-player { max-width: var(--pb-label-player-width); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.name-tooltip { pointer-events: auto; }
.label-destroyed .pb-labels { color: var(--color-playback-label-destroyed); text-decoration: line-through; }
.label-last-known .pb-label-tank,
.label-last-known .pb-label-player { opacity: .65; }
.label-last-known .pb-hp-hud { opacity: .55; }
.pb-last-known-tag { color: var(--color-playback-label-destroyed); font-weight: 600; }
.pb-hp-hud { display: flex; flex-direction: column; align-items: center; gap: var(--space-0); }
.pb-hp-row { position: relative; display: flex; justify-content: center; align-items: center; }
.pb-consumables {
  position: absolute;
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-right: var(--space-1);
}
.pb-hp-num { position: absolute; inset: 0; display: grid; place-items: center; color: var(--color-playback-label-text); font-variant-numeric: tabular-nums; }
.pb-hp-bar, .reload-bar { border-radius: 0; background: var(--color-playback-label-track); overflow: hidden; }
.pb-hp-bar { position: relative; width: var(--pb-label-hp-bar-width); height: var(--space-4); }
.pb-hp-fill, .pb-hp-ghost { position: absolute; inset-block: 0; left: 0; background: currentColor; }
.pb-hp-fill { transition: width var(--duration-base) linear; }
.pb-hp-fill-unknown { background: var(--color-playback-label-destroyed); opacity: .5; }
.pb-hp-ghost { background: color-mix(in oklab, currentColor 55%, var(--color-canvas)); animation: label-ghost var(--duration-slow) linear forwards; }
.pb-hp-flash .pb-hp-fill { filter: brightness(1.5); }
.pb-hp-no-transition .pb-hp-fill { transition: none; }
.reload-bar {
  display: flex;
  width: var(--pb-label-hp-bar-width);
  height: var(--pb-label-reload-bar-height);
  gap: calc(var(--space-1) / 2);
  box-shadow: var(--pb-label-reload-outline);
}
.reload-shell { flex: 1; background: var(--color-playback-label-track); }
.reload-shell[data-state="locked"] { background: var(--color-playback-label-locked); }
.reload-fill { display: block; height: 100%; background: var(--color-playback-label-text); }
@keyframes label-ghost { 0%, 20% { opacity: 1; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .pb-hp-ghost { animation: none; } }
</style>
