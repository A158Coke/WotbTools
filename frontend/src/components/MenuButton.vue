<script setup>
// 下拉菜单（design-language §7 Menu）：WAI-ARIA menu button。
// 方向键 / Home / End / 字符检索、Esc 关闭并还焦点、点外部关闭、portal 与碰撞定位由 Reka DropdownMenu 提供；
// 这里只拥有 items 数据契约与视觉 token。
import { inject } from 'vue'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { ChevronDown } from 'lucide-vue-next'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

// data-testid 等属性落在触发按钮上，而不是外层容器
defineOptions({ inheritAttrs: false })

defineProps({
  label: { type: String, required: true },
  items: { type: Array, required: true }, // [{ key, label, disabled?, testid? }]
  variant: { type: String, default: 'secondary', validator: v => ['secondary', 'ghost'].includes(v) },
  disabled: { type: Boolean, default: false },
  icon: { type: [Object, Function], default: null },
})
const emit = defineEmits(['select'])
// 菜单默认 portal 到 body（逃出局部层叠上下文）；DIALOG_INLINE_KEY 时原地渲染（组件测试 / fullscreen 宿主）
const inline = inject(DIALOG_INLINE_KEY, false)
</script>

<template>
  <DropdownMenuRoot :modal="false">
    <DropdownMenuTrigger as-child :disabled="disabled">
      <button
        type="button"
        class="menu-trigger"
        :class="`is-${variant}`"
        :disabled="disabled"
        v-bind="$attrs"
      >
        <component :is="icon" v-if="icon" :size="16" aria-hidden="true" />
        <span>{{ label }}</span>
        <ChevronDown :size="16" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal :disabled="inline">
      <DropdownMenuContent class="menu" align="end" :side-offset="4" :aria-label="label">
        <DropdownMenuItem
          v-for="item in items"
          :key="item.key"
          class="menu-item"
          :disabled="item.disabled"
          :data-testid="item.testid"
          @select="emit('select', item.key)"
        >{{ item.label }}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style scoped>
.menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.menu-trigger.is-secondary { border-color: var(--color-border-strong); background: var(--color-surface-1); }
.menu-trigger:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.menu-trigger:disabled { cursor: not-allowed; opacity: .5; }

/* Popper 内容有外层 wrapper：scoped 属性落在 wrapper 上，面板元素本身要用 :deep 命中 */
:deep(.menu) {
  z-index: var(--z-menu);
  display: grid;
  min-width: 200px;
  max-height: var(--reka-dropdown-menu-content-available-height);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
}

:deep(.menu[data-state="open"]) { animation: wotb-menu-in var(--duration-fast) var(--ease-standard); }

.menu-item {
  outline: 0;
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
  white-space: nowrap;
  cursor: pointer;
}

.menu-item[data-highlighted],
.menu-item:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.menu-item[data-disabled] { color: var(--color-text-tertiary); cursor: not-allowed; }

@media (hover: hover) {
  .menu-trigger:not(:disabled):hover { background: var(--color-surface-2); }
  .menu-item:not([data-disabled]):hover { background: var(--color-surface-2); }
}
</style>

<!-- Popper 内容的进场 keyframes：scoped 会改写名字而 :deep 规则里的引用不会；退场不加 CSS 动画——Reka Presence 会等 animationend，没有退场动画时才立即卸载 -->
<style>
@keyframes wotb-menu-in { from { opacity: 0; transform: translateY(calc(var(--space-1) * -1)); } }
</style>

