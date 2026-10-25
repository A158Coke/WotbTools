<script setup lang="ts">
// 手机底部 sheet（design-language §7 Sheet）：模态、焦点陷阱、Esc / 点遮罩 / 下滑关闭、portal 由 Reka Drawer 提供；
// 这里统一 WotbTools 的层级（--z-sheet）、遮罩（--color-scrim）、安全区、紧凑尺寸与 reduced-motion。
// 不启用 snap points（目前没有产品场景）。
import { inject } from 'vue'
import { DrawerContent, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'reka-ui'
import { DIALOG_INLINE_KEY } from '../shared/dialog'

defineProps<{
  open: boolean
  /** 可访问名称；默认只给辅助技术，页面用自己的表头时不会出现两个标题 */
  title: string
  /** 同时显示 AppSheet 自己的标题行 */
  visibleTitle?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
defineOptions({ inheritAttrs: false })

// 与 AppDialog 同口径：组件测试 / fullscreen 宿主内原地渲染
const inline = inject(DIALOG_INLINE_KEY, false)

function onUpdateOpen(value: boolean) {
  if (!value) emit('close')
}
</script>

<template>
  <DrawerRoot :open="open" @update:open="onUpdateOpen">
    <DrawerPortal :disabled="inline" force-mount>
      <template v-if="open">
        <DrawerOverlay class="sheet-scrim" data-testid="sheet-scrim" />
        <DrawerContent class="sheet" v-bind="$attrs">
          <DrawerTitle class="sheet-title" :class="{ 'is-hidden': !visibleTitle }">{{ title }}</DrawerTitle>
          <div class="sheet-body"><slot /></div>
        </DrawerContent>
      </template>
    </DrawerPortal>
  </DrawerRoot>
</template>

<style scoped>
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--color-scrim);
  animation: sheet-scrim-in var(--duration-slow) var(--ease-standard);
}

.sheet {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-sheet);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: 80dvh;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface-3);
  box-shadow: var(--elevation-3);
  color: var(--color-text-primary);
  outline: 0;
  /* 下滑关闭手势由 Reka 写入位移变量 */
  transform: translateY(var(--drawer-swipe-movement-y, 0px));
  animation: sheet-in var(--duration-slow) var(--ease-standard);
}

.sheet-title { margin: 0 0 var(--space-3); font: var(--type-h3); }
/* 仅辅助技术可见（页面自带可见表头时） */
.sheet-title.is-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.sheet-body { min-height: 0; overflow-y: auto; }

@keyframes sheet-scrim-in { from { opacity: 0; } }
@keyframes sheet-in { from { transform: translateY(100%); } }
</style>
