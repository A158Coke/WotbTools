<script setup>
// 同一内容的呈现方式切换（design-language §7）：单选组，方向键在选项间移动并选中。
// roving focus 与 radiogroup 语义由 Reka RadioGroup 提供；「方向键 / Home / End 移动焦点即选中」由这里保证，
// 不依赖 Reka 对 keydown / keyup 时序的判断。只有这些导航键引起的焦点移动才提交选择：
// Tab / 鼠标 / 程序性的重新聚焦（包括聚焦到外部值变化后仍带旧 tab stop 的选项）不能改写受控值。
// 选中指示器用 motion shared layout 在选项间平滑移动；溢出策略由 scrollable / wrap 显式选择。
import { useId } from 'vue'
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { Motion } from 'motion-v'
import { motionTransition } from '../shared/motion/motionPolicy'

const props = defineProps({
  modelValue: { type: String, required: true },
  /** [{ value, label, testid?, data?, disabled?, title? }]；data 是附加到按钮上的 data-* 键值（如 data-cap） */
  options: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
  /** 撑满可用宽度并按需横向滚动，保持单行。 */
  scrollable: { type: Boolean, default: false },
  /** 按可用宽度换行，窄屏各行填满宽度，长标签仍完整可见。 */
  wrap: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const indicatorId = `segmented-indicator-${useId()}`

function select(value) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
// 导航键 keydown 之后、同一轮 microtask 内发生的 focus 才算「由方向键移动」
let navigating = false
function markNavigation(event) {
  if (!NAVIGATION_KEYS.includes(event.key)) return
  navigating = true
  setTimeout(() => { navigating = false }, 0)
}
function selectOnNavigationFocus(value) {
  if (navigating) select(value)
}

function onKeydown(event) {
  const enabled = props.options.filter((option) => !option.disabled)
  const target = { Home: enabled[0], End: enabled[enabled.length - 1] }[event.key]
  if (!target) return
  event.preventDefault()
  select(target.value)
  event.currentTarget.querySelector(`[data-value="${CSS.escape(target.value)}"]`)?.focus()
}
</script>

<template>
  <RadioGroupRoot
    class="segmented"
    :class="{ 'is-scrollable': scrollable && !wrap, 'is-wrapping': wrap }"
    :model-value="modelValue"
    :aria-label="ariaLabel"
    :required="false"
    @update:model-value="select"
    @keydown.capture="markNavigation"
    @keydown="onKeydown"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      as="button"
      :value="option.value"
      class="segmented-option"
      :class="{ 'is-active': option.value === modelValue }"
      :data-value="option.value"
      :data-testid="option.testid"
      :disabled="option.disabled"
      :title="option.title"
      v-bind="option.data"
      @focus="selectOnNavigationFocus(option.value)"
    >
      <Motion
        v-if="option.value === modelValue"
        tag="span"
        class="segmented-indicator"
        :layout-id="indicatorId"
        :transition="motionTransition('base')"
        aria-hidden="true"
      />
      <span class="segmented-label">{{ option.label }}</span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-surface-2);
}

/* 选项多 / 容器窄：横向滚动、不换行、**选项不得被压缩**
   （flex-shrink 会把触屏 44px 点击区域压到 42px，CI 在 375px coarse 实测到过） */
.segmented.is-scrollable {
  display: flex;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

.segmented.is-scrollable::-webkit-scrollbar { display: none; }

.segmented.is-wrapping {
  display: flex;
  flex-wrap: wrap;
  max-width: 100%;
}

.segmented-option {
  position: relative;
  flex: none;
  min-height: var(--control-h-sm);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: var(--type-body);
  white-space: nowrap;
  cursor: pointer;
}

.segmented-option.is-active {
  color: var(--color-text-primary);
  font-weight: 600;
}

/* 选中底板：shared layout 元素在选项之间移动；label 叠在它上面 */
.segmented-indicator {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
}

.segmented-label { position: relative; }

.segmented-option:disabled { opacity: .5; cursor: not-allowed; }
.segmented-option:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.segmented.is-wrapping .segmented-option {
  flex-shrink: 1;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (width < 768px) {
  .segmented.is-wrapping .segmented-option {
    flex-grow: 1;
    padding: var(--space-2) var(--space-3);
  }
}

@media (hover: hover) {
  .segmented-option:not(.is-active):hover { color: var(--color-text-primary); }
}

/* 触屏：点击区域抬到 --hit-min（design-language §5；coarse 档 token = 44px）。
   单行滚动模式禁止收缩；换行模式的长标签可收缩，但仍守住触控下限。 */
@media (pointer: coarse) {
  .segmented-option { min-height: var(--hit-min); min-width: var(--hit-min); }
}
</style>
