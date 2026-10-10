<script setup>
/**
 * 回放工作台的能力切换：**极薄 adapter**，只把能力定义翻译成 `SegmentedControl` 的选项。
 *
 * 视觉与键盘行为（选中态、focus ring、方向键 / Home / End、coarse 点击区域、自适应换行）
 * 全部由 canonical `SegmentedControl` 拥有——这里不再有第二套选项样式或键盘状态机。
 *
 * 语义：能力切换 = 同一工作台内的模式切换，按 design-language §7 用 SegmentedControl
 * 的 radiogroup 模型（不是 Tabs：Tabs 切换的是内容区域）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from './SegmentedControl.vue'

defineOptions({ name: 'ReplayCapabilityTabs' })

const props = defineProps({
  options: { type: Array, default: () => [] }, // [{ key, labelKey }]
  activeCapability: { type: String, default: 'data' },
})

const emit = defineEmits(['select'])
const { t } = useI18n()

/**
 * 统一契约：data-testid="ws-tab" + data-cap=<能力>（深链、浏览器 gate 与测试共用）。
 * 用 computed 而不是模板内联，语言切换时标签跟着重算。
 */
const segmentedOptions = computed(() => props.options.map(option => ({
  value: option.key,
  label: t(option.labelKey),
  testid: 'ws-tab',
  data: { 'data-cap': option.key },
})))
</script>

<template>
  <SegmentedControl
    :model-value="activeCapability"
    :options="segmentedOptions"
    :aria-label="$t('workspace.title')"
    wrap
    @update:model-value="emit('select', $event)"
  />
</template>
