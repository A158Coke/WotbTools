<script setup>
// 同一内容的呈现方式切换（design-language §7）：单选组，方向键在选项间移动并选中。
// Home / End 跳首尾（WAI-ARIA 单选组的标准键盘模型）；超宽时横向滚动，窄屏不换行。
const props = defineProps({
  modelValue: { type: String, required: true },
  /** [{ value, label, testid?, data? }]；data 是附加到按钮上的 data-* 键值（如 data-cap） */
  options: { type: Array, required: true },
  ariaLabel: { type: String, required: true },
  /** 撑满可用宽度并按需横向滚动（工作台能力切换这类选项较多、可能溢出的场景） */
  scrollable: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const optionEl = (value) => `[data-value="${CSS.escape(value)}"]`

function select(value) {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function moveTo(value, event) {
  select(value)
  event.currentTarget.querySelector(optionEl(value))?.focus()
}

function onKeydown(event) {
  const keys = props.options.map(option => option.value)
  const index = keys.indexOf(props.modelValue)
  const target = {
    ArrowRight: keys[(index + 1) % keys.length],
    ArrowDown: keys[(index + 1) % keys.length],
    ArrowLeft: keys[(index - 1 + keys.length) % keys.length],
    ArrowUp: keys[(index - 1 + keys.length) % keys.length],
    Home: keys[0],
    End: keys[keys.length - 1],
  }[event.key]
  if (!target) return
  event.preventDefault()
  moveTo(target, event)
}
</script>

<template>
  <div
    class="segmented"
    :class="{ 'is-scrollable': scrollable }"
    role="radiogroup"
    :aria-label="ariaLabel"
    @keydown="onKeydown"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      class="segmented-option"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :tabindex="option.value === modelValue ? 0 : -1"
      :data-value="option.value"
      :data-testid="option.testid"
      v-bind="option.data"
      @click="select(option.value)"
    >{{ option.label }}</button>
  </div>
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

.segmented-option {
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
  background: var(--color-surface-1);
  box-shadow: var(--elevation-1);
  color: var(--color-text-primary);
  font-weight: 600;
}

.segmented-option:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .segmented-option:not(.is-active):hover { color: var(--color-text-primary); }
}

/* 触屏：点击区域抬到 44×44（design-language §5，WCAG 2.5.8 下限）。
   这里用 44px 字面量而不是 --hit-min：该 token 定义在 :root 的 (pointer: coarse) 块里，
   经由构建后的 chunk 继承时在 CI 的 Chromium 上实测未生效（data 按钮停在 42px）。
   触屏下限本身就是设计语言的常量，直接写死不引入第二个事实源。 */
@media (pointer: coarse) {
  .segmented-option { min-height: 44px; min-width: 44px; }
}
</style>
