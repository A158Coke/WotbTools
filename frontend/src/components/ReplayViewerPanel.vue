<script setup lang="ts">
// 统一回放面板（2026-11-19 用户要求，仿照地图预览排版）：2D/3D 两个回放 pane 同处
// 一个窗口，用头部 SegmentedControl 切换（两个 pane 都挂载，仅 v-show 显示切换，
// 与 MapPreviewPage 同款）；事件流始终在面板下方展示。
//
// 2026-11-19 二次调整（用户要求）：信息流默认就是展开状态、不提供关闭；它是面板下方的
// 自然流列表（页面滚动，不设固定高度、不做内部滚动），因此播放窗口可以吃满视口。
// 高度契约：本面板只把「头部 + 与 pane 的间距」量成 `--pb-viewer-reserve` 写回根元素；
// 2D/3D pane 在自己的 workspace 高度计算里扣除它。信息流在 pane 之后，永不回缩窗口。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'
import { usePlaybackPhoneForm } from '../composables/usePlaybackPhoneForm.js'

const props = defineProps<{
  /** 当前回放视图：2D / 3D。 */
  mode: '2d' | '3d'
}>()

const emit = defineEmits<{
  (e: 'update:mode', mode: '2d' | '3d'): void
}>()

const { t } = useI18n()
const { isPhone } = usePlaybackPhoneForm()

const rootEl = ref<HTMLElement | null>(null)
const headEl = ref<HTMLElement | null>(null)

/** 窄屏（手机形态）：沿用既有视口预算，不扣面板头高度，保持地图最小尺寸。 */
const narrow = computed(() => isPhone.value)

const modeOptions = computed(() => [
  { value: '3d', label: t('workspace.tab_3d'), testid: 'viewer-mode-3d' },
  { value: '2d', label: t('workspace.tab_playback'), testid: 'viewer-mode-2d' },
])
function onModeChange(value: string) {
  if (value === '2d' || value === '3d') emit('update:mode', value)
}

/**
 * 面板头部 + 与 pane 的一个 row-gap → `--pb-viewer-reserve`。
 * pane 从自身 computed style 读同一个继承变量，扣在自己的 workspace 高度里。
 * 信息流始终在 pane 之后、不参与预算：它只让页面变长，播放窗口保持满高。
 */
function measureReserve() {
  const root = rootEl.value
  if (!root) return
  // 窄屏：播放器保持既有视口预算与地图最小尺寸；面板头在 pane 之前，需要时页面滚动。
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
    </header>

    <!-- 两个 pane 都保持挂载（v-show）：切 2D/3D 不重新解析、不丢时间/相机。 -->
    <div v-show="mode === '2d'" class="viewer-mode" data-testid="ws-playback">
      <slot name="viewer-2d" />
    </div>
    <div v-show="mode === '3d'" class="viewer-mode" data-testid="ws-3d">
      <slot name="viewer-3d" />
    </div>

    <!-- 信息流：始终展开，面板下方的自然流列表（页面滚动，不挤压播放窗口）。 -->
    <section class="viewer-events" data-testid="ws-events">
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
.viewer-mode { min-inline-size: 0; }
/* 展开态：自然高度、无内部滚动；列表随内容向下延伸，页面负责滚动。 */
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