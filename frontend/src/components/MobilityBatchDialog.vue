<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import { previewBatch, type BatchGroup, type BatchSetup } from '../composables/mobilityBatch'
import type { ComparisonEntry } from '../composables/tankMobility'

const props = defineProps<{
  group: BatchGroup; source: ComparisonEntry; dataset: string | null
  entries: ComparisonEntry[]; contexts: Map<string, BatchSetup>
}>()
const emit = defineEmits<{ close: []; apply: [Map<string, ComparisonEntry>] }>()
const { t, locale } = useI18n()
const search = ref('')
const shown = ref(48)
const excluded = ref(new Set<string>())
const targets = computed(() => props.entries.filter(e => e.id !== props.source.id))
const groupLabel = computed(() => t('agentTanks.configurator.' + (props.group === 'devices' ? 'equipment' : props.group)))
const sourceSetup = computed(() => {
  const context = props.contexts.get(props.source.id)
  return context?.entry && context.entry !== props.source ? undefined : context
})
const rows = computed(() => targets.value.map(entry => ({
  entry, preview: previewBatch(props.group, props.dataset, props.source.dataset === props.dataset ? sourceSetup.value : undefined,
    entry, props.contexts.get(entry.id)),
})))
const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  return term ? rows.value.filter(({ entry }) =>
    String(entry.alias || props.contexts.get(entry.id)?.name || entry.tank).toLocaleLowerCase().includes(term)) : rows.value
})
const warnings = computed(() => rows.value.filter(({ entry, preview }) => !excluded.value.has(entry.id) &&
  preview.differences.some(diff => diff.reason && diff.reason !== 'equivalent')).length)
const updates = computed(() => {
  const changes = new Map<string, ComparisonEntry>()
  for (const { entry, preview } of rows.value) if (!excluded.value.has(entry.id) && preview.next) changes.set(entry.id, preview.next)
  return changes
})
function toggle(id: string) {
  if (excluded.value.has(id)) excluded.value.delete(id)
  else excluded.value.add(id)
}
function list(stems: string[], id: string) {
  const pool = props.contexts.get(id)?.[props.group] || []
  return stems.map(stem => {
    const item = pool.find(v => v.stem === stem) ?? sourceSetup.value?.[props.group].find(v => v.stem === stem)
    return item?.[locale.value === 'zh' ? 'name_zh-Hans' : 'name_en'] || item?.name_en || stem
  }).join(', ') || '—'
}
</script>
<template>
  <AppDialog open :title="t('mobBulk.preview', { group: groupLabel })" size="lg" @close="emit('close')">
    <p>{{ t('mobBulk.from', { name: source.alias || sourceSetup?.name || source.tank }) }}</p>
    <p v-if="group === 'consumables'">{{ t('mobBulk.carryOnly') }}</p>
    <div class="mb-target-tools">
      <AppButton size="sm" @click="excluded.clear()">{{ t('mobBulk.allTargets') }}</AppButton>
      <AppButton size="sm" @click="excluded = new Set(targets.map(e => e.id))">{{ t('mobBulk.noTargets') }}</AppButton>
      <span aria-live="polite">{{ t('mobBulk.targetCount', { count: targets.length - excluded.size, changed: updates.size }) }}</span>
    </div>
    <p v-if="!targets.length">{{ t('mobBulk.noOther') }}</p>
    <p v-if="warnings" role="status">{{ t('mobBulk.warnings', { count: warnings }) }}</p>
    <input v-if="targets.length > 48" v-model="search" class="mob-field" type="search" :aria-label="t('mobBulk.searchTarget')" :placeholder="t('mobBulk.searchTarget')" @input="shown = 48" />
    <ul class="mb-targets">
      <li v-for="{ entry, preview } in filtered.slice(0, shown)" :key="entry.id">
        <label><input type="checkbox" :checked="!excluded.has(entry.id)" @change="toggle(entry.id)" /> {{ entry.alias || contexts.get(entry.id)?.name || entry.tank }}</label>
        <small v-if="!preview.next">{{ t('mobBulk.retained') }}</small>
        <ul v-if="preview.differences.length">
          <li v-for="(diff, i) in preview.differences" :key="i">
            <template v-if="diff.slot">{{ t('mobBulk.slot', { level: diff.slot.level + 1, group: t('agentTanks.configurator.groups.' + diff.slot.group) }) }} · </template>
            <template v-if="diff.before.length || diff.after.length">{{ list(diff.before, entry.id) }} → {{ list(diff.after, entry.id) }}</template>
            <span v-if="diff.reason">{{ t('mobBulk.' + diff.reason) }}</span>
          </li>
        </ul>
      </li>
    </ul>
    <AppButton v-if="filtered.length > shown" size="sm" @click="shown += 48">{{ t('mobBulk.moreTargets', { count: filtered.length - shown }) }}</AppButton>
    <template #actions>
      <AppButton @click="emit('close')">{{ t('mobBulk.cancel') }}</AppButton>
      <AppButton variant="primary" :disabled="!updates.size" @click="emit('apply', updates)">{{ t('mobBulk.applyN', { count: updates.size }) }}</AppButton>
    </template>
  </AppDialog>
</template>
<style scoped>
.mb-target-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-block: var(--space-3); }
.mb-targets { list-style: none; padding: 0; }
.mb-targets > li { padding: var(--space-3); border-top: 1px solid var(--color-border-subtle); }
.mb-targets label { display: flex; align-items: center; gap: var(--space-2); min-inline-size: var(--hit-min); min-block-size: var(--hit-min); font-weight: 600; cursor: pointer; overflow-wrap: anywhere; }
.mb-targets label input { flex: none; accent-color: var(--color-accent); }
.mb-targets small, .mb-targets li span { margin-inline-start: var(--space-2); color: var(--color-text-secondary); }
.mb-targets ul { padding-inline-start: var(--space-5); overflow-wrap: anywhere; }
</style>
