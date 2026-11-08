<script setup lang="ts">
// 审核队列（左栏）：状态色徽标、当前条左边框高亮；复选框保留批量删除入口。纯展示，选中与翻页由 HoFAdminPage 持有。
interface QueueItem { id: number; title: string; status: string; statusLabel: string; sub: string; time: string; checked: boolean }
defineProps<{ items: QueueItem[]; currentId: number | null; allSelected: boolean; label: string }>()
const emit = defineEmits<{ open: [id: number]; toggle: [id: number, checked: boolean]; toggleAll: [checked: boolean] }>()
</script>

<template>
  <div class="hof-queue" role="region" :aria-label="label" data-testid="hof-review-queue">
    <label class="hof-queue-all"><input type="checkbox" :checked="allSelected" @change="emit('toggleAll', ($event.target as HTMLInputElement).checked)" /><span>{{ $t('hofAdmin.selectAllPage') }}</span></label>
    <ul class="hof-queue-list">
      <li v-for="item in items" :key="item.id" class="hof-queue-item" :class="{ 'is-current': item.id === currentId }">
        <input type="checkbox" :checked="item.checked" :aria-label="$t('hofAdmin.selectRow', { id: item.id })" @change="emit('toggle', item.id, ($event.target as HTMLInputElement).checked)" />
        <button type="button" class="hof-queue-main" :aria-current="item.id === currentId ? 'true' : undefined" data-testid="hof-queue-open" @click="emit('open', item.id)">
          <strong class="hof-queue-title">{{ item.title }}</strong>
          <span class="hundred-status" :class="'hundred-status-' + item.status.toLowerCase()">{{ item.statusLabel }}</span>
          <span class="hof-queue-sub">{{ item.sub }}</span>
          <span class="hof-queue-time">{{ item.time }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hof-queue { min-width: 0; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); overflow: hidden; }
.hof-queue-all { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font: var(--type-caption); }
.hof-queue-list { margin: 0; padding: 0; list-style: none; }
.hof-queue-item { display: flex; align-items: stretch; border-bottom: 1px solid var(--color-border-subtle); border-inline-start: calc(var(--border-width) * 3) solid transparent; }
.hof-queue-item:last-child { border-bottom: 0; }
.hof-queue-item.is-current { border-inline-start-color: var(--color-accent); background: var(--color-surface-2); }
.hof-queue input[type='checkbox'] { flex: none; inline-size: var(--control-check); block-size: var(--control-check); margin: var(--space-3); accent-color: var(--color-accent); cursor: pointer; }
.hof-queue-main { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-1) var(--space-3); min-width: 0; min-height: var(--hit-min); padding: var(--space-3) var(--space-3) var(--space-3) 0; border: 0; background: transparent; color: var(--color-text-primary); font: var(--type-body); text-align: start; cursor: pointer; }
.hof-queue-main:focus-visible { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.hof-queue-title, .hof-queue-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hof-queue-sub { color: var(--color-text-secondary); }
.hof-queue-time { color: var(--color-text-tertiary); font: var(--type-caption); text-align: end; white-space: nowrap; }
.hundred-status { align-self: start; justify-self: end; padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-3); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 600; white-space: nowrap; }
.hundred-status-current { background: color-mix(in oklab, var(--color-success) 14%, var(--color-surface-1)); color: var(--color-success); }
.hundred-status-pending { background: color-mix(in oklab, var(--color-warning) 14%, var(--color-surface-1)); color: var(--color-warning); }
.hundred-status-rejected, .hundred-status-deleted { background: color-mix(in oklab, var(--color-danger) 14%, var(--color-surface-1)); color: var(--color-danger); }
@media (hover: hover) { .hof-queue-item:not(.is-current):hover { background: var(--color-surface-2); } }
</style>