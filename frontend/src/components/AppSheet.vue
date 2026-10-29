<script setup lang="ts">
// 手机底部 sheet（design-language §7 Sheet）：模态、焦点陷阱、Esc / 点遮罩 / 下滑关闭、portal 由 Reka Drawer 提供；
// 这里统一 WotbTools 的层级（--z-sheet）、遮罩（--color-scrim）、安全区、紧凑尺寸与 reduced-motion。
// 不启用 snap points（目前没有产品场景）。
import { computed, inject, ref, watch } from 'vue'
import { DrawerContent, DrawerOverlay, DrawerPortal, DrawerRoot, DrawerTitle } from 'reka-ui'
import { DIALOG_INLINE_KEY } from '../shared/dialog'

const props = defineProps<{
  open: boolean
  /** 关闭后焦点回到的元素；缺省回到打开前的焦点元素（Drawer 没有 DrawerTrigger 时 Reka 不会自己恢复） */
  returnFocusTo?: HTMLElement | null
  /** portal 目标（默认 body）。内容的样式依赖某个祖先作用域时，把 sheet 放回该作用域元素里 */
  portalTo?: HTMLElement | null
  /** 可访问名称；默认只给辅助技术，页面用自己的表头时不会出现两个标题 */
  title: string
  /** 同时显示 AppSheet 自己的标题行 */
  visibleTitle?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
defineOptions({ inheritAttrs: false })

// 与 AppDialog 同口径：组件测试 / fullscreen 宿主内原地渲染
const inline = inject(DIALOG_INLINE_KEY, false)

const opener = ref<HTMLElement | null>(null)
watch(() => props.open, (open) => {
  if (open) opener.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
}, { immediate: true, flush: 'sync' })
const finalFocus = computed(() => props.returnFocusTo ?? opener.value ?? undefined)

function onUpdateOpen(value: boolean) {
  if (!value) emit('close')
}
</script>

<template>
  <DrawerRoot :open="open" @update:open="onUpdateOpen">
    <DrawerPortal :to="portalTo ?? undefined" :disabled="inline" force-mount>
      <DrawerOverlay class="sheet-scrim" data-testid="sheet-scrim" />
      <DrawerContent class="sheet" :final-focus="finalFocus" v-bind="$attrs">
        <DrawerTitle class="sheet-title" :class="{ 'is-hidden': !visibleTitle }">{{ title }}</DrawerTitle>
        <div class="sheet-body"><slot /></div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>

<style scoped>
.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--color-scrim);
}
.sheet-scrim[data-state="open"] { animation: sheet-scrim-in var(--duration-slow) var(--ease-standard); }

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
}
/* 进场动画只挂在 open 态：Reka Presence 看到退场仍有 animation 会等一个不会再来的 animationend，sheet 就卸不掉 */
.sheet[data-state="open"] { animation: sheet-in var(--duration-slow) var(--ease-standard); }

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
/* overlay scrollbar 不占布局宽度；为右对齐控件留出命中空间，不能只依赖 scrollbar-gutter。 */
.sheet-body { min-height: 0; overflow-y: auto; padding-inline-end: var(--space-3); }

@keyframes sheet-scrim-in { from { opacity: 0; } }
/* 只淡入、不位移：命中目标在进场期间不漂移 */
@keyframes sheet-in { from { opacity: 0; } }
</style>
