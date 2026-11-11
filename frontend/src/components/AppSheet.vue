<script setup lang="ts">
// 手机 sheet（design-language §7 Sheet）：模态、焦点陷阱、Esc / 点遮罩 / 滑动关闭、portal 由 Reka Drawer 提供；
// 默认从底部出现；side="start" 是左侧抽屉形态（小屏导航，§9 L1），左滑关闭、铺满高度、四边让出安全区；
// side="end" 是右侧详情抽屉（管理列表模板：大屏约 400px，手机铺满宽度），右滑关闭，内容区由调用方分出头 / 体 / 底。
// 这里统一 WotbTools 的层级（--z-sheet）、遮罩（--color-scrim）、安全区、紧凑尺寸与 reduced-motion。
// 不启用 snap points（目前没有产品场景）。
import { computed, inject, nextTick, ref, watch } from 'vue'
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
  /** 出现方向：bottom（默认）、start（左侧抽屉）或 end（右侧详情抽屉） */
  side?: 'bottom' | 'start' | 'end'
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

const SWIPE = { bottom: 'down', start: 'left', end: 'right' } as const
const swipeDirection = computed(() => SWIPE[props.side ?? 'bottom'])

function onUpdateOpen(value: boolean) {
  if (!value) emit('close')
}

// swipe 释放 dismiss 后 Reka 保留位移变量与 data-swipe-dismissed（在退出动画期间持有当前位置）；
// 若在退出动画结束前重新打开，同一元素复用会带着半拖位置的残留，需要按 restore() 同口径清掉
const contentEl = ref<{ $el?: HTMLElement } | null>(null)
watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  const el = contentEl.value?.$el
  if (!el) return
  el.style.setProperty('--drawer-swipe-movement-x', '0px')
  el.style.setProperty('--drawer-swipe-movement-y', '0px')
  el.removeAttribute('data-swipe-dismissed')
})
</script>

<template>
  <DrawerRoot :open="open" :swipe-direction="swipeDirection" @update:open="onUpdateOpen">
    <DrawerPortal :to="portalTo ?? undefined" :disabled="inline" force-mount>
      <DrawerOverlay class="sheet-scrim" data-testid="sheet-scrim" />
      <DrawerContent ref="contentEl" class="sheet" :class="{ 'is-start': side === 'start', 'is-end': side === 'end' }" :final-focus="finalFocus" v-bind="$attrs">
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
/* 左侧抽屉：铺满高度，顶 / 底 / 左让出安全区；左滑关闭的位移由 Reka 写入 x 变量 */
.sheet.is-start {
  top: 0;
  right: auto;
  width: var(--nav-drawer-w);
  max-height: none;
  padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
  border-inline-end: 1px solid var(--color-border-subtle);
  border-radius: 0;
  background: var(--color-surface-1);
  box-sizing: content-box;
  transform: translateX(var(--drawer-swipe-movement-x, 0px));
}
.sheet.is-start .sheet-body { padding-inline-end: 0; overflow-y: auto; }
/* 右侧详情抽屉：铺满高度，顶 / 底 / 右让出安全区；内容区不滚动，由调用方的头 / 体 / 底自己分配（体内滚动） */
.sheet.is-end {
  top: 0;
  left: auto;
  width: var(--detail-drawer-w);
  max-height: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) 0;
  border-inline-start: 1px solid var(--color-border-subtle);
  border-radius: 0;
  background: var(--color-surface-1);
  transform: translateX(var(--drawer-swipe-movement-x, 0px));
}
.sheet.is-end .sheet-body { display: flex; flex-direction: column; padding-inline-end: 0; overflow: hidden; }
/* 进场动画只挂在 open 态；退场动画挂在 closed 态：Reka Presence 靠 closed 态的 animation-name
   判断「正在退场」并等它的 animationend 再卸载，因此两者各占一个 data-state，互不遮蔽。
   退场 from 省略 = 从当前 computed transform 起手：swipe 释放后位移变量仍持有实时位置，
   退出动画从那里继续滑出（不跳回初始位）；非 swipe 关闭位移变量为 0，从原位滑出。
   swipe dismiss 时 Reka 写入 --drawer-swipe-strength（0.1~1，甩得越快越小）以匹配释放速度。 */
.sheet[data-state="open"] { animation: sheet-in var(--duration-slow) var(--ease-standard); }
.sheet[data-state="closed"] { animation: sheet-out calc(var(--duration-slow) / var(--drawer-swipe-strength, 1)) var(--ease-standard) forwards; }
.sheet.is-start[data-state="closed"] { animation-name: sheet-out-start; }
.sheet.is-end[data-state="closed"] { animation-name: sheet-out-end; }
/* forwards 托住终点态，animationend 与卸载之间不回跳 */
.sheet-scrim[data-state="closed"] { animation: sheet-scrim-out var(--duration-slow) var(--ease-standard) forwards; }

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
/* 退场：底部下滑 / start 左滑 / end 右滑，都从位移变量的当前位置继续 */
@keyframes sheet-out { to { transform: translateY(calc(var(--drawer-swipe-movement-y, 0px) + 100%)); } }
@keyframes sheet-out-start { to { transform: translateX(calc(var(--drawer-swipe-movement-x, 0px) - 100%)); } }
@keyframes sheet-out-end { to { transform: translateX(calc(var(--drawer-swipe-movement-x, 0px) + 100%)); } }
@keyframes sheet-scrim-out { to { opacity: 0; } }

/* reduced-motion：不做空间位移退场，动画名归 none → Presence 立即卸载，不留动画等待 */
@media (prefers-reduced-motion: reduce) {
  .sheet[data-state="closed"],
  .sheet-scrim[data-state="closed"] { animation: none; }
}
</style>
