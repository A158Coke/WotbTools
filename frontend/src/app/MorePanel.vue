<script setup>
// 侧边栏底部的"更多"弹出面板（平板 / 桌面）：低频的显示设置 + 关于与支持。
// 非模态 disclosure：触发按钮 aria-expanded / aria-controls；Esc 关闭并把焦点还给触发按钮，
// 点面板外或焦点移出面板时关闭；选一个链接后关闭。内容与手机"更多"页同源（useMoreMenu）。
// Teleport 到 body：侧边栏是 fixed + z-index 的层叠上下文，面板留在里面会被页面里更高的层
// （如装甲查看器的 3D 浮层）盖住。测试用 DIALOG_INLINE_KEY 原地渲染。
import { inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ExternalLink, MessageSquare } from 'lucide-vue-next'
import { FEEDBACK_URL, LANGUAGES, useMoreMenu } from '../composables/useMoreMenu.js'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import SegmentedControl from '../components/SegmentedControl.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** 触发按钮元素：用于"点外部关闭"时排除它，以及 Esc 后还原焦点 */
  anchor: { type: Object, default: null },
  id: { type: String, required: true },
})
const emit = defineEmits(['close'])

const navigate = inject(NAVIGATE_VIEW_KEY, null)
const inline = inject(DIALOG_INLINE_KEY, false)
const { uiProfilePreference, setUiProfile, uiProfileOptions, setLocale, aboutLinks } = useMoreMenu()
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

/** Tab 出面板（非模态，不锁焦点）：焦点去了面板与触发按钮之外就收起 */
function onFocusOut(event) {
  const next = event.relatedTarget
  if (!next || panel.value?.contains(next) || props.anchor?.contains(next)) return
  close()
}

function onPointerDown(event) {
  const target = event.target
  if (panel.value?.contains(target) || props.anchor?.contains(target)) return
  close()
}

watch(() => props.open, async (open) => {
  if (open) {
    document.addEventListener('pointerdown', onPointerDown, true)
    await nextTick()
    panel.value?.querySelector('button, a, [tabindex="0"]')?.focus()
  } else {
    document.removeEventListener('pointerdown', onPointerDown, true)
  }
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
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
      <div class="more-panel-setting">
        <span class="more-panel-label">{{ $t('uiProfile.title') }}</span>
        <SegmentedControl
          :model-value="uiProfilePreference"
          :options="uiProfileOptions($t)"
          :aria-label="$t('uiProfile.title')"
          data-testid="more-panel-ui-profile"
          @update:model-value="setUiProfile"
        />
      </div>
      <div class="more-panel-setting">
        <span class="more-panel-label">{{ $t('more.language') }}</span>
        <SegmentedControl
          :model-value="$i18n.locale"
          :options="LANGUAGES"
          :aria-label="$t('more.language')"
          data-testid="more-panel-language"
          @update:model-value="setLocale"
        />
      </div>
    </section>

    <section class="more-panel-section" aria-labelledby="more-panel-about">
      <h2 id="more-panel-about" class="more-panel-title">{{ $t('more.sections.about') }}</h2>
      <ul class="more-panel-links">
        <li v-for="link in aboutLinks" :key="link.view">
          <button type="button" class="more-panel-link" :data-testid="`more-link-${link.view}`" @click="go(link.view)">
            <component :is="link.icon" :size="18" aria-hidden="true" />
            <span>{{ $t(link.labelKey) }}</span>
          </button>
        </li>
        <li>
          <a class="more-panel-link" :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer" data-testid="more-link-feedback" @click="close()">
            <MessageSquare :size="18" aria-hidden="true" />
            <span>{{ $t('app.feedback') }}</span>
            <ExternalLink class="more-panel-external" :size="14" aria-hidden="true" />
          </a>
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
.more-panel-external { margin-inline-start: auto; }
.more-panel-link:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }

@media (hover: hover) {
  .more-panel-link:hover { background: var(--color-surface-2); }
}
</style>
