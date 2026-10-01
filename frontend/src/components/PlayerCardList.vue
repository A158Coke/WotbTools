<script setup>
// 玩家卡片列表（design-language §7 DataTable：窄屏自动切换为卡片列表）。
// 三张玩家表（单场 / 普通汇总 / CW 汇总）共用：各表按自己的格式化规则生成 items，这里只负责呈现、排序控件与选中。
import { useI18n } from 'vue-i18n'
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-vue-next'

defineProps({
  /**
   * [{ key, title, subtitle?, team?: 1|2, badge?, primary?: { label, value }, metrics: [{ key, label, value }], selected? }]
   */
  items: { type: Array, required: true },
  /** 可点击（打开玩家详情）。 */
  clickable: { type: Boolean, default: false },
  /** 排序：[{ key, label }]；sortKey 为空 = 原始顺序。 */
  sortOptions: { type: Array, default: () => [] },
  sortKey: { type: String, default: '' },
  sortDesc: { type: Boolean, default: false },
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['select', 'sort'])
const { t } = useI18n()
</script>

<template>
  <div class="player-cards" data-testid="player-cards">
    <div v-if="sortOptions.length" class="cards-sort">
      <label class="cards-sort-label">
        <span>{{ t('workspace.sort_by') }}</span>
        <select
          class="cards-sort-select"
          data-testid="player-cards-sort"
          :value="sortKey"
          @change="emit('sort', { key: $event.target.value, desc: sortDesc })"
        >
          <option value="">{{ t('workspace.sort_default') }}</option>
          <option v-for="option in sortOptions" :key="option.key" :value="option.key">{{ option.label }}</option>
        </select>
      </label>
      <button
        type="button"
        class="cards-sort-dir"
        data-testid="player-cards-sort-dir"
        :disabled="!sortKey"
        :aria-label="sortDesc ? t('workspace.sort_desc') : t('workspace.sort_asc')"
        :title="sortDesc ? t('workspace.sort_desc') : t('workspace.sort_asc')"
        @click="emit('sort', { key: sortKey, desc: !sortDesc })"
      >
        <component :is="sortDesc ? ArrowDownWideNarrow : ArrowUpNarrowWide" :size="18" aria-hidden="true" />
      </button>
    </div>

    <ul class="cards-list" role="list">
      <li v-for="item in items" :key="item.key">
        <component
          :is="clickable ? 'button' : 'div'"
          :type="clickable ? 'button' : undefined"
          class="player-card"
          :class="{ 'is-team1': item.team === 1, 'is-team2': item.team === 2, 'is-selected': item.selected, 'is-clickable': clickable }"
          :aria-pressed="clickable ? !!item.selected : undefined"
          data-testid="player-card"
          :data-key="item.key"
          @click="clickable && emit('select', item.key)"
        >
          <span class="card-head">
            <span class="card-identity">
              <span class="card-title">{{ item.title }}</span>
              <span v-if="item.subtitle" class="card-subtitle">{{ item.subtitle }}</span>
            </span>
            <span v-if="item.primary" class="card-primary">
              <span class="card-primary-value">{{ item.primary.value }}</span>
              <span class="card-primary-label">{{ item.primary.label }}<template v-if="item.badge"> · {{ item.badge }}</template></span>
            </span>
          </span>
          <dl v-if="item.metrics.length" class="card-metrics">
            <div v-for="metric in item.metrics" :key="metric.key" class="card-metric">
              <dt>{{ metric.label }}</dt>
              <dd>{{ metric.value }}</dd>
            </div>
          </dl>
        </component>
      </li>
      <li v-if="!items.length && emptyText" class="cards-empty">{{ emptyText }}</li>
    </ul>
  </div>
</template>

<style scoped>
.player-cards { display: grid; gap: var(--space-2); }

.cards-sort { display: flex; align-items: flex-end; gap: var(--space-2); }
.cards-sort-label { display: grid; flex: 1 1 auto; gap: var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); }

.cards-sort-select,
.cards-sort-dir {
  min-height: var(--control-h-md);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
}

.cards-sort-select { width: 100%; padding: 0 var(--space-2); }
.cards-sort-dir { display: inline-grid; place-items: center; flex: none; min-width: var(--control-h-md); cursor: pointer; }
.cards-sort-dir:disabled { cursor: not-allowed; opacity: .5; }
.cards-sort-select:focus-visible,
.cards-sort-dir:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.cards-list { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }

.player-card {
  display: grid;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-inline-start: 3px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-surface-1);
  color: var(--color-text-primary);
  font: var(--type-body);
  text-align: start;
}

.player-card.is-team1 { border-inline-start-color: var(--color-team-ally); }
.player-card.is-team2 { border-inline-start-color: var(--color-team-enemy); }
.player-card.is-clickable { cursor: pointer; }
.player-card.is-selected { background: color-mix(in oklab, var(--color-accent) 12%, var(--color-surface-1)); border-color: var(--color-accent); }
.player-card:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.card-identity { display: grid; min-width: 0; }
.card-title { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.card-subtitle { overflow: hidden; color: var(--color-text-secondary); font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap; }
.card-primary { display: grid; flex: none; justify-items: end; }
.card-primary-value { font: var(--type-h3); font-variant-numeric: tabular-nums; }
.card-primary-label { color: var(--color-text-secondary); font: var(--type-caption); }

.card-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); margin: 0; }
.card-metric { display: grid; min-width: 0; }
.card-metric dt { overflow: hidden; color: var(--color-text-secondary); font: var(--type-caption); text-overflow: ellipsis; white-space: nowrap; }
.card-metric dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

.cards-empty { padding: var(--space-4); color: var(--color-text-secondary); text-align: center; }

@media (hover: hover) {
  .player-card.is-clickable:hover { background: var(--color-surface-2); }
}
</style>
