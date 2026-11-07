<script setup lang="ts">
// 四季主题选择（design-language §2）：SegmentedControl 的 tiles 呈现，每项是该主题的主视觉缩略图 +
// 强调色点 + 名称。预览色板来自 tokens/color.css 的 --theme-preview-*，与当前主题无关。
import SegmentedControl from './SegmentedControl.vue'
import { UI_PROFILES, setUiProfile, useUiProfile } from '../composables/useUiProfile.js'

defineProps<{ ariaLabel: string }>()
const { uiProfile } = useUiProfile()
type ThemeOption = { value: string, label: string }
/** SegmentedControl 是 JS SFC，插槽参数在类型上是 unknown；选项由本组件构造，形状确定。 */
const themeOption = (option: unknown) => option as ThemeOption
const tileStyle = ({ value }: ThemeOption) => ({
  '--tile-canvas': `var(--theme-preview-${value}-canvas)`,
  '--tile-accent': `var(--theme-preview-${value}-accent)`,
  '--tile-image': `var(--theme-preview-${value}-image)`,
})
</script>

<template>
  <SegmentedControl
    class="theme-picker"
    presentation="tiles"
    :model-value="uiProfile"
    :options="UI_PROFILES.map(value => ({ value, label: $t(`uiProfile.${value}`), testid: `theme-${value}` }))"
    :ariaLabel="ariaLabel"
    @update:model-value="setUiProfile"
  >
    <template #option="{ option }">
      <span class="theme-tile" :style="tileStyle(themeOption(option))">
        <span class="theme-thumb" aria-hidden="true" />
        <span class="theme-name"><span class="theme-dot" aria-hidden="true" />{{ themeOption(option).label }}</span>
      </span>
    </template>
  </SegmentedControl>
</template>

<style scoped>
.theme-tile { display: grid; gap: var(--space-1); justify-items: stretch; width: 100%; }

.theme-thumb {
  display: block;
  aspect-ratio: 5 / 2;
  border: var(--border-width) solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--tile-image) right center / cover, var(--tile-canvas);
}

.theme-name { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-1); font: var(--type-caption); font-weight: 600; }

.theme-dot { flex: none; width: var(--space-2); height: var(--space-2); border-radius: var(--radius-full); background: var(--tile-accent); }

.theme-picker :deep(.segmented-option.is-active) .theme-thumb { border-color: var(--color-accent); outline: var(--border-width) solid var(--color-accent); }
</style>
