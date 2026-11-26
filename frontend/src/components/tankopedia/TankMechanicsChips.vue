<script setup lang="ts">
/**
 * 详情头卡（坦克等级/国籍/种类 + 研发入口）里的车级机制标签。
 * 默认只显示游戏内机制名（客户端 TankMechanics 标题）；点击打开小窗口显示原文说明。
 * 文案来源与占位符替换见 scene/tankMechanics.ts（缺文案时显式提示，不显示裸 key）。
 */
import { ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '../AppDialog.vue'

type MechanicRow = { name: string; title?: string | null; description?: string | null }

defineProps({
  mechanics: { type: Array as PropType<MechanicRow[]>, default: () => [] },
})
const { t } = useI18n()

const open = ref(false)
const selected = ref<MechanicRow | null>(null)

function show(mechanic: MechanicRow) {
  selected.value = mechanic
  open.value = true
}
</script>

<template>
  <div v-if="mechanics.length" class="tp-mechanics" data-testid="tank-mechanics">
    <span class="tp-mechanics-label">{{ t('agentTanks.mechanics.title') }}</span>
    <button
      v-for="mechanic in mechanics"
      :key="mechanic.name"
      type="button"
      class="tp-mechanic-chip"
      :data-testid="`tank-mechanic-${mechanic.name}`"
      @click="show(mechanic)"
    >
      {{ mechanic.title || mechanic.name }}
    </button>
  </div>
  <AppDialog
    :open="open"
    :title="selected?.title || selected?.name || t('agentTanks.mechanics.title')"
    size="sm"
    data-testid="tank-mechanic-dialog"
    @close="open = false"
  >
    <p v-if="selected?.description" class="tp-mechanic-desc">{{ selected.description }}</p>
    <p v-else class="tp-muted">{{ t('agentTanks.mechanics.description_unavailable') }}</p>
  </AppDialog>
</template>

<style scoped>
.tp-mechanics { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-inline-size: 0; }
.tp-mechanics-label { color: var(--color-text-secondary); font: var(--type-caption); }
.tp-mechanic-chip {
  min-block-size: var(--control-h-sm);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: color-mix(in oklab, var(--color-accent) 10%, var(--color-surface-1));
  color: var(--color-accent-text);
  font: var(--type-caption);
  font-weight: 600;
  cursor: pointer;
}
.tp-mechanic-chip:hover { border-color: var(--color-accent); }
.tp-mechanic-chip:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.tp-mechanic-desc { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
</style>