<script setup lang="ts">
// 强制横屏页面在竖屏时的整块提示（design-language §9「强制横屏」）：只在 useForcedLandscape().blocked 时渲染。
// iPhone Safari 无法锁定方向，靠这里引导旋转；Android 手机 App 会自动锁横屏，提示只在切换瞬间出现。
// 可选的退出动作（如「看赛后数据」）由页面给出，保证竖屏时主要数据能力仍可达。
import type { ForcedLandscapeDevice } from '../platform/screenForm.js'

defineProps<{ device: ForcedLandscapeDevice, actionLabel?: string }>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <section class="rotate-prompt" role="status" data-testid="rotate-prompt">
    <div class="rotate-figure" aria-hidden="true">
      <span class="rotate-phone is-portrait" />
      <span class="rotate-phone is-landscape" />
    </div>
    <h2 class="rotate-title">{{ $t('rotate.title') }}</h2>
    <p class="rotate-body">{{ $t('rotate.body') }}</p>
    <p class="rotate-hint">{{ $t(device === 'android-phone-app' ? 'rotate.hintApp' : 'rotate.hintBrowser') }}</p>
    <button v-if="actionLabel" type="button" class="rotate-action" data-testid="rotate-prompt-action" @click="emit('action')">{{ actionLabel }}</button>
  </section>
</template>

<style scoped>
.rotate-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  min-block-size: calc(100dvh - var(--header-block) - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  padding: var(--space-6) var(--gutter);
  text-align: center;
}

.rotate-figure { position: relative; width: calc(var(--space-12) * 2); height: calc(var(--space-12) * 2); }
.rotate-phone { position: absolute; border-radius: var(--radius-md); }
.rotate-phone.is-portrait { left: 30%; top: 4%; width: 36%; height: 66%; border: var(--space-1) solid var(--color-border-strong); }
.rotate-phone.is-landscape {
  left: 14%;
  top: 28%;
  width: 66%;
  height: 36%;
  border: var(--space-1) solid var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
}

.rotate-title { margin: 0; color: var(--color-text-primary); font: var(--type-h2); }
.rotate-body { max-width: var(--reading-measure); margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.rotate-hint { margin: 0; color: var(--color-text-tertiary); font: var(--type-caption); }

.rotate-action {
  min-height: var(--hit-min-comfortable);
  padding: 0 var(--space-5);
  border: var(--border-width) solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
  cursor: pointer;
}
.rotate-action:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (prefers-reduced-motion: no-preference) {
  .rotate-phone.is-landscape { animation: rotate-hint var(--duration-slow) var(--ease-standard) both; }
}

@keyframes rotate-hint { from { opacity: 0; } }
</style>
