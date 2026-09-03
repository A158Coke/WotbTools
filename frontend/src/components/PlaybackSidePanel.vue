<script setup>
import { nextTick, ref, watch } from 'vue'

defineOptions({ name: 'PlaybackSidePanel' })

const props = defineProps({
  panel: { type: String, default: null },
  groups: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:panel', 'close'])
const closeButton = ref(null)
const lastTrigger = ref(null)

function selectPanel(name, event) {
  if (event?.currentTarget) lastTrigger.value = event.currentTarget
  emit('update:panel', props.panel === name ? null : name)
}

function close() {
  emit('close')
  emit('update:panel', null)
  nextTick(() => lastTrigger.value?.focus?.())
}

function onKeydown(event) {
  if (event.key === 'Escape' && props.panel) {
    event.preventDefault()
    close()
  }
}

watch(() => props.panel, (panel, previousPanel) => {
  if (panel) nextTick(() => closeButton.value?.focus?.())
  else if (previousPanel) nextTick(() => lastTrigger.value?.focus?.())
})
</script>

<template>
  <div class="pb-side-panel-shell" data-test="pb-side-panel-shell" @keydown="onKeydown">
    <nav class="pb-panel-launcher" :aria-label="$t('recon.map.playback.panels')">
      <button
        v-for="group in props.groups"
        :key="group.name"
        type="button"
        class="pb-panel-tab"
        :class="{ active: props.panel === group.name }"
        :data-test="'pb-panel-' + group.name"
        :aria-expanded="props.panel === group.name"
        @click="selectPanel(group.name, $event)"
      >{{ group.label }}</button>
    </nav>
    <aside v-if="props.panel" class="pb-side-panel" role="dialog" aria-modal="true" :aria-label="$t('recon.map.playback.panel')">
      <div class="pb-side-panel-head">
        <strong>{{ props.groups.find((group) => group.name === props.panel)?.label }}</strong>
        <button ref="closeButton" type="button" class="pb-panel-close" data-test="pb-panel-close" :aria-label="$t('recon.map.playback.close')" @click="close">×</button>
      </div>
      <section v-if="props.panel === 'battle'" data-test="pb-panel-content-battle"><slot name="battle" /></section>
      <section v-else-if="props.panel === 'vehicle'" data-test="pb-panel-content-vehicle"><slot name="vehicle" /></section>
      <section v-else-if="props.panel === 'display'" data-test="pb-panel-content-display"><slot name="display" /></section>
      <section v-else-if="props.panel === 'events'" data-test="pb-panel-content-events"><slot name="events" /></section>
    </aside>
  </div>
</template>

<style scoped>
.pb-side-panel-shell { position: relative; z-index: 40; }
.pb-panel-launcher { display: flex; flex-wrap: wrap; gap: 4px; }
.pb-panel-tab, .pb-panel-close { min-height: 30px; border: 1px solid var(--border-ghost); border-radius: 5px; background: var(--bg-card2); color: var(--text-label); cursor: pointer; font: inherit; font-size: .76rem; padding: 3px 8px; }
.pb-panel-tab.active { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.pb-side-panel { position: absolute; top: calc(100% + 6px); right: 0; width: min(340px, calc(100vw - 16px)); max-height: min(68vh, 560px); overflow: auto; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-card2); box-shadow: var(--surface-shadow); }
.pb-side-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--text-heading); }
.pb-panel-close { min-width: 30px; padding: 0; font-size: 1.2rem; line-height: 1; }
@media (768px <= width < 1200px) {
  .pb-side-panel { top: calc(100% + 6px); right: 0; width: min(340px, calc(100vw - 16px)); max-height: min(68vh, 560px); z-index: var(--z-modal); }
}
@media (width < 768px) {
  .pb-panel-launcher { display: none; position: absolute; top: 8px; right: 8px; justify-content: flex-end; max-width: calc(100% - 16px); }
  .pb-side-panel-shell:has(.pb-side-panel) .pb-panel-launcher { display: flex; }
  .pb-panel-tab { min-height: 36px; }
  .pb-side-panel { position: fixed; top: auto; right: 0; bottom: 0; left: 0; width: auto; max-height: min(75dvh, 620px); padding: 12px 12px calc(12px + env(safe-area-inset-bottom)); border-radius: 12px 12px 0 0; z-index: var(--z-modal); }
  .pb-side-panel-shell:has(.pb-side-panel)::after { position: fixed; inset: 0; z-index: -1; content: ''; background: color-mix(in srgb, var(--bg) 35%, transparent); }
}
</style>
