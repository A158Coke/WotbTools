<script setup>
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { OPEN_NAV_DRAWER_KEY, SHELL_CHROME_KEY } from '../shared/shellChrome.js'
import { useEventListener } from '@vueuse/core'
import { Maximize2, Menu, Minimize2, Pause, Play, PencilRuler, Settings, SlidersHorizontal, Users } from 'lucide-vue-next'
import PlaybackTimeline from './PlaybackTimeline.vue'
import { formatPlaybackClock } from '../utils/playbackClock'
import { PLAYBACK_SPEEDS } from '../composables/usePlaybackTransport.js'

defineOptions({ name: 'PlaybackTransport' })

const props = defineProps({
  playing: Boolean,
  fullscreenSupported: Boolean,
  isFullscreen: Boolean,
  displayOpen: Boolean,
  displayEnabled: Boolean,
  settingsOpen: Boolean,
  settingsEnabled: Boolean,
  /** 标记模式入口：只有需要它的形态才挂（手机横屏没有独立的模式行，入口必须落在控制条里，
      而不是浮在地图上——实测 740×360 的地图只有 96×96，放不下任何合规的常驻控件）。 */
  annotationEnabled: Boolean,
  speed: { type: Number, default: 1 },
  speeds: { type: Array, default: () => PLAYBACK_SPEEDS },
  currentTime: { type: Number, default: 0 },
  startTime: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },
  stepSeconds: { type: Number, default: 5 },
  compact: Boolean,
  floatingFullscreen: Boolean,
  formatClock: { type: Function, default: formatPlaybackClock },
  navEligible: { type: Boolean, default: true },
  rosterEntryVisible: { type: Boolean, default: false },
  rosterOpen: { type: Boolean, default: false },
  shotTicks: { type: Array, default: () => [] },
  killTicks: { type: Array, default: () => [] },
  showEventMarkers: { type: Boolean, default: false },
  shortcutsHint: { type: String, default: '' },
})

const shellChrome = inject(SHELL_CHROME_KEY, null)
const openNav = inject(OPEN_NAV_DRAWER_KEY, null)
const navOwner = Symbol('playback-transport-nav')
const alive = ref(true)
onActivated(() => { alive.value = true })
onDeactivated(() => { alive.value = false })
const hostsNav = computed(() => alive.value && props.navEligible && !!openNav && !!shellChrome?.immersive.value)
watch(hostsNav, (on) => shellChrome?.hostNav(navOwner, on), { immediate: true })
onBeforeUnmount(() => shellChrome?.hostNav(navOwner, false))
const emit = defineEmits(['toggle-play', 'step', 'set-speed', 'seek', 'scrub-start', 'scrub-end', 'toggle-fullscreen', 'toggle-display', 'toggle-settings', 'toggle-annotation', 'toggle-roster'])

const speedOpen = ref(false)
const speedRoot = ref(null)
const gearEl = ref(null)
const settingsEl = ref(null)
function chooseSpeed(option) {
  speedOpen.value = false
  emit('set-speed', option)
}
function onDocPointerDown(event) {
  if (!speedOpen.value) return
  if (!speedRoot.value?.contains(event.target)) speedOpen.value = false
}
useEventListener(() => (typeof document === 'undefined' ? undefined : document), 'pointerdown', onDocPointerDown, { capture: true })

const speedTrigger = ref(null)
function onSpeedKeydown(event) {
  if (event.key !== 'Escape' || !speedOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  speedOpen.value = false
  speedTrigger.value?.focus()
}

const timelineUsable = computed(() => Number(props.duration) > Number(props.startTime))
const elapsed = computed(() => Number(props.currentTime) - Number(props.startTime))
const total = computed(() => Number(props.duration) - Number(props.startTime))
</script>

<template>
  <PlaybackTimeline
    :current-time="props.currentTime"
    :start-time="props.startTime"
    :duration="props.duration"
    :disabled="!timelineUsable"
    :shot-ticks="props.shotTicks"
    :kill-ticks="props.killTicks"
    :show-event-markers="props.showEventMarkers"
    :hint="props.shortcutsHint"
    @drag-start="emit('scrub-start')"
    @drag-end="emit('scrub-end')"
    @seek="emit('seek', $event)"
  />
  <div class="pb-controls" :class="{ 'phone-form': props.compact }" data-test="pb-controls" data-tour="playback-transport" @pointerdown.stop @click.stop>
    <button v-if="hostsNav" type="button" class="pb-btn" data-testid="nav-menu" :aria-label="$t('nav.openDrawer')" aria-haspopup="dialog" @click="openNav($event.currentTarget)"><Menu :size="18" aria-hidden="true" /></button>
    <button v-if="props.stepSeconds > 0" type="button" class="pb-btn" data-test="pb-back5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.back_seconds', { seconds: props.stepSeconds })" @click="emit('step', -props.stepSeconds)">−{{ props.stepSeconds }}</button>
    <button
      type="button"
      class="pb-btn pb-play-btn"
      data-test="pb-play"
      :disabled="!timelineUsable"
      :aria-disabled="!timelineUsable"
      :title="timelineUsable ? undefined : $t('recon.map.playback.timeline_unavailable')"
      :aria-label="$t(props.playing ? 'recon.map.playback.pause' : 'recon.map.playback.play')"
      @click="emit('toggle-play')"
    >
      <component :is="props.playing ? Pause : Play" class="pb-icon" :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.stepSeconds > 0" type="button" class="pb-btn" data-test="pb-fwd5" :disabled="!timelineUsable" :aria-label="$t('recon.map.playback.forward_seconds', { seconds: props.stepSeconds })" @click="emit('step', props.stepSeconds)">+{{ props.stepSeconds }}</button>
    <div ref="speedRoot" class="pb-speed-picker" @keydown="onSpeedKeydown">
      <button
        ref="speedTrigger" type="button" class="pb-btn pb-speed-current" :aria-expanded="speedOpen"
        aria-haspopup="menu" data-test="pb-speed-current"
        :aria-label="$t('recon.map.playback.speed_option', { speed: props.speed })"
        @click="speedOpen = !speedOpen"
      >{{ props.speed }}×</button>
      <div v-if="speedOpen" class="pb-speed-menu" role="menu" :aria-label="$t('recon.map.playback.speed')" data-test="pb-speed-menu">
        <button
          v-for="option in props.speeds"
          :key="option"
          type="button" role="menuitemradio"
          class="pb-btn pb-speed-item"
          :class="{ active: props.speed === option }"
          :aria-checked="props.speed === option ? 'true' : 'false'"
          :data-test="'pb-speed-' + option"
          :aria-label="$t('recon.map.playback.speed_option', { speed: option })"
          @click="chooseSpeed(option)"
        >{{ option }}×</button>
      </div>
    </div>
    <button v-if="props.fullscreenSupported && !props.floatingFullscreen" type="button" class="pb-btn pb-fullscreen-btn" data-test="pb-fullscreen" data-testid="playback-fullscreen" :aria-pressed="props.isFullscreen" :aria-label="$t(props.isFullscreen ? 'recon.map.playback.exit_fullscreen' : 'recon.map.playback.enter_fullscreen')" @click="emit('toggle-fullscreen')">
      <component :is="props.isFullscreen ? Minimize2 : Maximize2" :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.annotationEnabled" type="button" class="pb-btn" data-test="pb-annotation-entry" data-tour="playback-annotation-entry" :aria-label="$t('recon.map.playback.annot.mode')" :title="$t('recon.map.playback.annot.mode')" @click="emit('toggle-annotation')">
      <PencilRuler :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.rosterEntryVisible" type="button" class="pb-btn" data-test="pb-roster-entry" :aria-pressed="props.rosterOpen" :aria-label="$t(props.rosterOpen ? 'agentReplay.roster_hide' : 'agentReplay.roster_show')" :title="$t(props.rosterOpen ? 'agentReplay.roster_hide' : 'agentReplay.roster_show')" @click="emit('toggle-roster')">
      <Users :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.displayEnabled" ref="gearEl" type="button" class="pb-btn pb-secondary-entry" data-test="pb-secondary-entry" data-testid="display-toggle" data-tour="playback-display" :aria-expanded="props.displayOpen" aria-haspopup="dialog" :aria-label="$t('recon.map.playback.panel_display')" @click="emit('toggle-display', gearEl)">
      <SlidersHorizontal :size="16" aria-hidden="true" />
    </button>
    <button v-if="props.settingsEnabled" ref="settingsEl" type="button" class="pb-btn pb-secondary-entry" data-test="pb-settings-entry" data-testid="replay3d-settings-toggle" data-tour="playback-settings" :aria-expanded="props.settingsOpen" aria-haspopup="dialog" :aria-label="$t('agentReplay.settings_title')" @click="emit('toggle-settings', settingsEl)">
      <Settings :size="16" aria-hidden="true" />
    </button>
    <span class="pb-time" data-test="pb-time">{{ props.formatClock(elapsed) }} / {{ props.formatClock(total) }}</span>
    <span v-if="!timelineUsable" class="pb-unavailable" data-test="pb-play-unavailable" role="status">{{ $t('recon.map.playback.timeline_unavailable') }}</span>
  </div>

</template>

<style scoped>
.pb-controls { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }

.pb-speed-picker { position: relative; display: inline-flex; }
.pb-speed-menu {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-end: 0;
  z-index: var(--pb-z-hud);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
  box-shadow: var(--elevation-3);
}
.pb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: var(--control-h-md);
  min-width: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}

@media (pointer: coarse) and (orientation: landscape) and (height <= 520px) {
  .pb-speed-item { min-inline-size: calc(var(--hit-min) + var(--space-4)); }
}

.pb-btn.active {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
}

.pb-play-btn { min-inline-size: calc(var(--control-h-md) + var(--space-3)); border-color: var(--color-accent); background: var(--color-accent); color: var(--color-on-accent); }
.pb-controls.phone-form .pb-play-btn { min-inline-size: var(--control-h-md); }
.pb-btn:hover:not(:disabled) { border-color: var(--color-border-strong); }
.pb-play-btn:hover:not(:disabled) { filter: brightness(1.08); }

.pb-btn:disabled { opacity: .45; cursor: not-allowed; }

.pb-btn:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.pb-icon { flex: none; }
.pb-unavailable { flex-basis: 100%; color: var(--color-text-tertiary); font: var(--type-caption); }
.pb-time { margin-inline: auto; color: var(--color-text-secondary); font: var(--type-caption); font-variant-numeric: tabular-nums; white-space: nowrap; }

.pb-controls.phone-form { justify-content: center; }
.phone-form .pb-btn { padding: 0 var(--space-1); }
.phone-form .pb-time {
  flex-basis: 100%;
  margin-inline: 0;
  text-align: center;
  order: -1;
}
</style>
