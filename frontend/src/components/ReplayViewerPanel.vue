<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppSwitch from './AppSwitch.vue'
import SegmentedControl from './SegmentedControl.vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'

const props = withDefaults(defineProps<{
  mode: '2d' | '3d'
  eventsFocused?: boolean
}>(), { eventsFocused: false })

const emit = defineEmits<{
  (e: 'update:mode', mode: '2d' | '3d'): void
}>()

const { t } = useI18n()
const { isPhone } = usePlaybackPhoneForm()

const rootEl = ref<HTMLElement | null>(null)
const headEl = ref<HTMLElement | null>(null)

const narrow = computed(() => isPhone.value)

const modeOptions = computed(() => [
  { value: '3d', label: t('workspace.tab_3d'), testid: 'viewer-mode-3d' },
  { value: '2d', label: t('workspace.tab_playback'), testid: 'viewer-mode-2d' },
])
function onModeChange(value: string) {
  if (value === '2d' || value === '3d') emit('update:mode', value)
}

const showEventDetails = ref(props.eventsFocused)
watch(() => props.eventsFocused, (focused) => {
  if (focused) showEventDetails.value = true
})

function measureReserve() {
  const root = rootEl.value
  if (!root) return
  if (narrow.value) {
    root.style.setProperty('--pb-viewer-reserve', '0px')
    return
  }
  const head = headEl.value?.getBoundingClientRect().height || 0
  const gap = parseFloat(getComputedStyle(root).rowGap) || 0
  root.style.setProperty('--pb-viewer-reserve', `${Math.ceil(head + gap)}px`)
}

let observer: ResizeObserver | null = null
onMounted(() => {
  measureReserve()
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(measureReserve)
    for (const el of [rootEl.value, headEl.value]) if (el) observer.observe(el)
  }
  window.addEventListener('resize', measureReserve)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  window.removeEventListener('resize', measureReserve)
})
watch([() => props.mode, narrow], () => nextTick(measureReserve), { flush: 'post' })
</script>

<template>
  <section
    ref="rootEl"
    class="replay-viewer-panel"
    data-testid="ws-replay-viewer"
  >
    <header ref="headEl" class="viewer-head">
      <h2 class="viewer-title">{{ t('workspace.tab_replay') }}</h2>
      <SegmentedControl
        class="viewer-mode-switch"
        :model-value="mode"
        :options="modeOptions"
        :ariaLabel="t('workspace.tab_replay')"
        @update:model-value="onModeChange"
      />
      <div class="viewer-actions">
        <slot name="viewer-actions" />
      </div>
      <div class="viewer-events-toggle">
        <AppSwitch
          v-model="showEventDetails"
          :label="t('workspace.show_event_details')"
          data-testid="viewer-events-toggle"
        />
      </div>
    </header>

    <div v-show="mode === '2d'" class="viewer-mode" data-testid="ws-playback">
      <slot name="viewer-2d" :show-event-markers="showEventDetails" />
    </div>
    <div v-show="mode === '3d'" class="viewer-mode" data-testid="ws-3d">
      <slot name="viewer-3d" :show-event-markers="showEventDetails" />
    </div>

    <section v-show="showEventDetails" class="viewer-events" data-testid="ws-events">
      <header class="viewer-events-head">
        <h3 class="viewer-events-title">{{ t('workspace.tab_events') }}</h3>
      </header>
      <div class="viewer-events-body">
        <slot name="events" />
      </div>
    </section>
  </section>
</template>

<style scoped>
.replay-viewer-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-inline-size: 0;
}
.viewer-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
}
.viewer-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.viewer-actions { margin-inline-start: auto; display: flex; align-items: center; gap: var(--space-2); min-inline-size: 0; }
.viewer-events-toggle { min-inline-size: 0; flex: none; }
.viewer-actions :deep(.viewer-settings-entry) { max-inline-size: 100%; white-space: normal; }
.viewer-events-toggle :deep(.app-switch) { inline-size: auto; gap: var(--space-2); }
.viewer-mode { min-inline-size: 0; }
.viewer-events {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}
.viewer-events-head { display: flex; align-items: center; gap: var(--space-2); }
.viewer-events-title { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); font-weight: 800; }
.viewer-events-body { min-inline-size: 0; }
</style>