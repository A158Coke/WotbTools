<script setup>
// 回放集合管理：回答「加载了哪些回放」，只增删，不切场。切场只归 BattlePicker，
// 两者共用 battlePickerOptions() 的文案，状态都由工作台的 session 持有。
// 列表行要放移除按钮，不能是 BattlePicker 的 Listbox option，所以这里是普通列表。
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createReusableTemplate } from '@vueuse/core'
import { FileText, Files, FolderOpen, Play, Search, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import AppSheet from './AppSheet.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  /** replayCollectionRows() 的返回值。 */
  rows: { type: Array, required: true },
  /** 后台加载新回放时的进度 { done, total }；没有则为 null。 */
  progress: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
  folderAvailable: { type: Boolean, default: false },
  demoDisabled: { type: Boolean, default: false },
})
const emit = defineEmits(['add-files', 'add-folder', 'open-demo', 'remove', 'clear'])
const { t } = useI18n()
const { isCompact } = useBreakpoint()
const [DefineBody, ReuseBody] = createReusableTemplate()

const SEARCH_THRESHOLD = 6
const STATUS_KEYS = {
  loading: 'upload.row_loading',
  failed: 'upload.row_failed',
  duplicate: 'upload.row_duplicate',
  excluded: 'upload.row_excluded',
}

const isOpen = ref(false)
const query = ref('')
const confirmingClear = ref(false)

const count = computed(() => props.rows.length)
const failedCount = computed(() => props.rows.filter(row => row.status === 'failed').length)
const triggerLabel = computed(() => (failedCount.value
  ? t('upload.manage_failed', { count: count.value, failed: failedCount.value })
  : t('upload.manage', { count: count.value })))
const searchable = computed(() => count.value > SEARCH_THRESHOLD)
const visibleRows = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.rows
  return props.rows.filter(row => row.search.toLowerCase().includes(needle))
})

function metaOf(row) {
  return row.status === 'ready' ? row.meta : t(STATUS_KEYS[row.status])
}

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
  query.value = ''
  confirmingClear.value = false
}

function openDemo() {
  close()
  emit('open-demo')
}

/** 确认框不叠在模态弹层上：先关，焦点回到触发按钮，再由工作台询问。 */
function removeRow(row) {
  close()
  emit('remove', row.file)
}

function clearAll() {
  close()
  emit('clear')
}

defineExpose({ open })
</script>

<template>
  <DefineBody>
    <div class="collection" data-testid="replay-collection">
      <label v-if="searchable" class="collection-search">
        <Search :size="16" aria-hidden="true" />
        <input v-model="query" type="search" :aria-label="t('workspace.battle_search')" :placeholder="t('workspace.battle_search')" data-testid="collection-search" />
      </label>
      <ul class="collection-list">
        <li
          v-for="row in visibleRows"
          :key="row.key"
          class="collection-row"
          :class="{ 'is-problem': row.status === 'failed' }"
          :title="row.fileName"
          data-testid="collection-row"
          :data-status="row.status"
        >
          <span class="collection-text">
            <span class="collection-title">{{ row.title }}</span>
            <span class="collection-meta">{{ metaOf(row) }}</span>
          </span>
          <span v-if="row.current" class="collection-current" data-testid="collection-current">{{ t('upload.row_current') }}</span>
          <button
            type="button"
            class="collection-remove"
            :aria-label="t('upload.remove_file_aria', { name: row.title })"
            data-testid="collection-remove"
            @click="removeRow(row)"
          ><X :size="16" aria-hidden="true" /></button>
        </li>
        <li v-if="!visibleRows.length" class="collection-empty">{{ t('workspace.battle_search_empty') }}</li>
      </ul>
      <div class="collection-actions">
        <AppButton size="sm" data-testid="collection-add-files" @click="emit('add-files')"><FileText :size="16" aria-hidden="true" />{{ t('upload.add_files_title') }}</AppButton>
        <AppButton v-if="folderAvailable" size="sm" data-testid="collection-add-folder" @click="emit('add-folder')"><FolderOpen :size="16" aria-hidden="true" />{{ t('upload.add_folder_title') }}</AppButton>
        <AppButton variant="ghost" size="sm" :disabled="demoDisabled" data-testid="collection-demo" @click="openDemo"><Play :size="16" aria-hidden="true" />{{ t('onboarding.demo_action') }}</AppButton>
      </div>
      <div v-if="!confirmingClear" class="collection-clear">
        <AppButton variant="ghost" size="sm" data-testid="collection-clear" @click="confirmingClear = true"><Trash2 :size="16" aria-hidden="true" />{{ t('upload.clear_all') }}</AppButton>
      </div>
      <div v-else class="collection-clear" role="group" :aria-label="t('upload.clear_confirm')">
        <span class="collection-confirm">{{ t('upload.clear_confirm') }}</span>
        <AppButton variant="danger" size="sm" data-testid="collection-clear-confirm" @click="clearAll">{{ t('upload.clear') }}</AppButton>
        <AppButton variant="ghost" size="sm" data-testid="collection-clear-cancel" @click="confirmingClear = false">{{ t('upload.cancel') }}</AppButton>
      </div>
    </div>
  </DefineBody>

  <AppButton variant="ghost" size="sm" :disabled="disabled" :aria-busy="!!progress" v-bind="$attrs" data-testid="collection-trigger" @click="open">
    <component :is="failedCount ? TriangleAlert : Files" :size="16" aria-hidden="true" />{{ triggerLabel }}
  </AppButton>
  <span v-if="progress" class="collection-progress" role="status" data-testid="collection-progress">{{ t('upload.adding_progress', progress) }}</span>

  <AppSheet v-if="isCompact" :open="isOpen" :title="t('upload.list_title', { count })" visible-title data-testid="collection-panel" @close="close">
    <ReuseBody />
  </AppSheet>
  <AppDialog v-else :open="isOpen" :title="t('upload.list_title', { count })" size="md" data-testid="collection-panel" @close="close">
    <ReuseBody />
  </AppDialog>
</template>

<style scoped>
.collection { display: grid; gap: var(--space-3); }

.collection-search {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-h-md);
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
}
.collection-search:focus-within { outline: var(--focus-outline); outline-offset: calc(var(--focus-outline-offset) * -1); }
.collection-search input { flex: 1 1 auto; min-width: 0; border: 0; background: transparent; color: var(--color-text-primary); font: var(--type-body); outline: 0; }

.collection-list { display: grid; gap: var(--space-1); max-height: 360px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }

.collection-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--row-h);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
}
.collection-row.is-problem .collection-meta { color: var(--color-danger); }

.collection-text { display: grid; flex: 1; gap: var(--space-0); min-width: 0; }
.collection-title,
.collection-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collection-title { color: var(--color-text-primary); font: var(--type-body); font-weight: 600; }
.collection-meta { color: var(--color-text-secondary); font: var(--type-caption); }
.collection-current { flex: none; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; }

.collection-remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--hit-min);
  height: var(--hit-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}
.collection-remove:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.collection-empty { padding: var(--space-4) var(--space-3); color: var(--color-text-secondary); font: var(--type-body); }
.collection-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--color-border-subtle); }
.collection-clear { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.collection-confirm { color: var(--color-text-primary); font: var(--type-body); }
.collection-progress { color: var(--color-text-secondary); font: var(--type-caption); }

@media (hover: hover) {
  .collection-remove:hover { background: var(--color-surface-3); color: var(--color-text-primary); }
}
</style>
