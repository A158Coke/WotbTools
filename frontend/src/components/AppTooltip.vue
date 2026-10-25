<script setup lang="ts">
// 图标按钮的 tooltip（design-language：icon-only 按钮必须 aria-label + tooltip）。
// 延迟 / portal / 碰撞由 Reka Tooltip 提供；这里统一延迟、层级（--z-tooltip）与 token 样式。
// 触屏不依赖 tooltip 传达信息：可访问名称仍由触发元素自己的 aria-label 提供。
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}>(), { side: 'bottom' })
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="app-tooltip" :side="side" :side-offset="6">{{ label }}</TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style scoped>
/* Popper 内容有外层 wrapper：scoped 属性落在 wrapper 上，面板元素本身要用 :deep 命中 */
:deep(.app-tooltip) {
  z-index: var(--z-tooltip);
  max-width: 320px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
  pointer-events: none;
}

:deep(.app-tooltip[data-state="delayed-open"]),
:deep(.app-tooltip[data-state="instant-open"]) { animation: wotb-tooltip-in var(--duration-fast) var(--ease-standard); }
</style>

<!-- Popper 内容的进场 keyframes：scoped 会改写名字而 :deep 规则里的引用不会 -->
<style>
@keyframes wotb-tooltip-in { from { opacity: 0; } }
</style>

