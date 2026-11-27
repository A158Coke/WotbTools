<script setup>
import { inject, nextTick, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { BookOpen, Download, MessageSquare } from 'lucide-vue-next'
import { LANGUAGES, useMoreMenu } from '../composables/useMoreMenu.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import SegmentedControl from '../components/SegmentedControl.vue'
import ThemePicker from '../components/ThemePicker.vue'
import AppSwitch from '../components/AppSwitch.vue'
import { feedbackPrefs, setFeedbackPref } from '../composables/useFeedbackPrefs.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  anchor: { type: Object, default: null },
  id: { type: String, required: true },
})
const emit = defineEmits(['close'])

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const inline = inject(DIALOG_INLINE_KEY, false)
const { setLocale, aboutLinks, openGuide, openFeedback, openAndroidUpdate } = useMoreMenu()
const panel = ref(null)

function close({ restoreFocus = false } = {}) {
  emit('close')
  if (restoreFocus) props.anchor?.focus()
}

function go(view) {
  close()
  navigate?.(view)
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close({ restoreFocus: true })
  }
}

function onFocusOut(event) {
  const next = event.relatedTarget
  if (!next || panel.value?.contains(next) || props.anchor?.contains(next)) return
  close()
}

function onPointerDown(event) {
  if (!props.open) return
  const target = event.target
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  close()
}

useEventListener(() => document, 'pointerdown', onPointerDown, { capture: true })

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  panel.value?.querySelector('button, a, [tabindex="0"]')?.focus()
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
  <div
    v-if="open"
    :id="id"
    ref="panel"
    class="more-panel"
    role="dialog"
    :aria-label="$t('nav.more')"
    data-testid="more-panel"
    @keydown="onKeydown"
    @focusout="onFocusOut"
  >
    <section class="more-panel-section" aria-labelledby="more-panel-display">
      <h2 id="more-panel-display" class="more-panel-title">{{ $t('more.sections.display') }}</h2>
      <div class="more-panel-setting" data-tour="settings-theme">
        <span class="more-panel-label">{{ $t('uiProfile.title') }}</span>
        <ThemePicker :aria-label="$t('uiProfile.title')" data-testid="more-panel-ui-profile" />
      </div>
      <div class="more-panel-setting" data-tour="settings-language">
        <span class="more-panel-label">{{ $t('more.language') }}</span>
        <SegmentedControl
          :model-value="$i18n.locale"
          :options="LANGUAGES"
          :aria-label="$t('more.language')"
          data-testid="more-panel-language"
          @update:model-value="setLocale"
        />
      </div>
      <div class="more-panel-setting" data-testid="more-panel-feedback">
        <AppSwitch :model-value="feedbackPrefs.haptics" :label="$t('feedbackPrefs.haptics')" @update:model-value="value => setFeedbackPref('haptics', value)" />
        <AppSwitch :model-value="feedbackPrefs.sound" :label="$t('feedbackPrefs.sound')" @update:model-value="value => setFeedbackPref('sound', value)" />
        <AppSwitch :model-value="feedbackPrefs.battleSound" :label="$t('feedbackPrefs.battleSound')" :description="$t('feedbackPrefs.battleSoundHint')" @update:model-value="value => setFeedbackPref('battleSound', value)" />
      </div>
    </section>

    <section class="more-panel-section" aria-labelledby="more-panel-about">
      <h2 id="more-panel-about" class="more-panel-title">{{ $t('more.sections.about') }}</h2>
      <ul class="more-panel-links">
        <li v-if="openAndroidUpdate">
          <button type="button" class="more-panel-link" data-testid="more-link-app-update" @click="close(); openAndroidUpdate(anchor)"><Download :size="18" aria-hidden="true" /><span>{{ $t('androidUpdate.title') }}</span></button>
        </li>
        <li v-if="openGuide">
          <button type="button" class="more-panel-link" data-testid="more-link-guide" @click="close(); openGuide()"><BookOpen :size="18" aria-hidden="true" /><span>{{ $t('onboarding.directory') }}</span></button>
        </li>
        <li v-for="link in aboutLinks" :key="link.view">
          <button type="button" class="more-panel-link" :data-testid="`more-link-${link.view}`" @click="go(link.view)">
            <component :is="link.icon" :size="18" aria-hidden="true" />
            <span>{{ $t(link.labelKey) }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="more-panel-link" data-testid="more-link-feedback" @click="close(); openFeedback?.()">
            <MessageSquare :size="18" aria-hidden="true" />
            <span>{{ $t('app.feedback') }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
  </Teleport>
</template>

<style scoped>
.more-panel {
  position: fixed;
  inset-block-end: var(--space-3);
  inset-inline-start: calc(var(--sidebar-w) + var(--space-2));
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: min(340px, calc(100dvw - var(--sidebar-w) - var(--space-6)));
  max-height: calc(100dvh - var(--space-6));
  overflow-y: auto;
  /* 全站滚动条视觉规范：隐藏指示器、保留滚动能力 */
  scrollbar-width: none;
  padding: var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-3);
}

.more-panel-section { display: flex; flex-direction: column; gap: var(--space-2); }

.more-panel-title {
  margin: 0;
  color: var(--color-text-secondary);
  font: var(--type-caption);
  font-weight: 600;
}

.more-panel-setting {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.more-panel-label { color: var(--color-text-primary); font: var(--type-caption); }

.more-panel-links { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }

.more-panel-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.more-panel-link > svg { flex: none; color: var(--color-text-secondary); }
.more-panel-link:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

@media (hover: hover) {
  .more-panel-link:hover { background: var(--color-surface-2); }
}
</style>
