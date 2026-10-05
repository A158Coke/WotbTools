<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, CloudUpload, FileText, FolderOpen, Plus, Trash2, X } from 'lucide-vue-next'
import { fileKey, displayName } from '../utils/helpers.js'
import {
  MAX_REPLAY_FILES,
  MAX_REPLAY_TOTAL_BYTES,
  formatReplaySize,
  isReplayFileName,
  validateReplaySelection
} from '../utils/replayUpload.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'

const emit = defineEmits(['update:files', 'preview', 'remove-request'])
const props = defineProps({
  files: Array,
  loading: Boolean,
  disabled: Boolean,
  /** Shared picker supports screenshots without changing the default replay preflight. */
  purpose: { type: String, default: 'replay', validator: v => ['replay', 'image'].includes(v) },
  confirmRemove: Boolean,
  showPreview: { type: Boolean, default: true },
  /** 解析完成后压缩上传区域：隐藏大卡/预览主按钮，只保留细条批次摘要 + 添加/清空。 */
  compact: { type: Boolean, default: false },
  /** AI 复盘 / 战局重建 单文件语义时禁 folder（默认 true 兼容批处理）。 */
  allowFolder: { type: Boolean, default: true }
})
const dragging = ref(false)
const listOpen = ref(false)
/** 解析完成后的「清空」会丢掉已解析结果：先进入确认态（WS-21）。 */
const confirmingClear = ref(false)
/** preflight 拒绝结果（{offending, tooMany, totalTooLarge}；非空时 selection 保持不变）。 */
const validation = ref(null)
const imageError = ref(false)
const { t } = useI18n()
const maxReplayFiles = MAX_REPLAY_FILES
const maxReplayTotal = formatReplaySize(MAX_REPLAY_TOTAL_BYTES)

/** 原生 file input 视觉隐藏，由真正的按钮触发，保证键盘可达（WS-07）。 */
const filesInput = ref(null)
const folderInput = ref(null)
const addFilesInput = ref(null)
const addFolderInput = ref(null)
const compactAddInput = ref(null)
function openPicker(input) {
  input?.click?.()
}

const totalBytes = computed(() => props.files.reduce((sum, f) => sum + (f.size || 0), 0))

// 父级已更新 files（remove/clear/替换）→ 清除过期的 preflight 拒绝信息（被拒的 add
// 不会触发 update:files，因此错误会保留直到下一次成功 add 或 files 变化）。
watch(() => props.files, () => {
  validation.value = null
  confirmingClear.value = false
})

/**
 * 统一的候选入口（选择文件 / 选择文件夹 / add files / drag-drop 全部走这里）：
 * 批量/folder 交互<b>先过滤 .wotbreplay</b>，非回放文件不参与 100 上限 /
 * 200 MiB 总量、不得让合法 replay 整批失败；再对「现有 selection + 过滤后的新候选」
 * 合并集合做 preflight。任一违规 → 不更新 active files、不触发 Processing Job，
 * 保留之前合法 selection，一次展示所有 offending。
 */
function addFiles(list) {
  if (props.loading || props.disabled) return
  const picked = Array.from(list || [])
  if (props.purpose === 'image') {
    if (picked.some(file => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0)) {
      imageError.value = true
      return
    }
    imageError.value = false
    const byKey = new Map(props.files.map(file => [fileKey(file), file]))
    picked.forEach(file => byKey.set(fileKey(file), file))
    emit('update:files', [...byKey.values()])
    return
  }
  const replays = picked.filter(f => isReplayFileName(f?.name))
  if (replays.length === 0) {
    validation.value = { noReplay: true, offending: [], tooMany: false, totalTooLarge: false, singleOnly: false }
    return
  }
  // 单文件模式（AI 复盘 / 战局重建）：一次只接受一个回放——文件选择器已去 multiple；
  // drag/drop 多文件直接拒绝，不静默取第一个。
  if (!props.allowFolder && replays.length > 1) {
    validation.value = { noReplay: false, offending: [], tooMany: false, totalTooLarge: false, singleOnly: true }
    return
  }
  let prospective
  if (props.allowFolder) {
    const byKey = new Map(props.files.map(f => [fileKey(f), f]))
    replays.forEach(f => byKey.set(fileKey(f), f))
    prospective = Array.from(byKey.values()).sort((a, b) => displayName(a).localeCompare(displayName(b)))
  } else {
    // single-file：新选择 replace 当前文件（不合并 → 不会出现先得到 [A,B] 再报 single_replay_required）。
    prospective = [replays[replays.length - 1]]
  }
  const result = validateReplaySelection(prospective)
  if (!result.valid) {
    validation.value = result
    return
  }
  validation.value = null
  emit('update:files', prospective)
}

function removeFile(f) {
  validation.value = null
  if (props.confirmRemove) {
    emit('remove-request', f)
    return
  }
  const k = fileKey(f)
  emit('update:files', props.files.filter(x => fileKey(x) !== k))
}

function clearFiles() {
  validation.value = null
  confirmingClear.value = false
  emit('update:files', [])
}

function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function onDrop(e) {
  dragging.value = false
  addFiles(e.dataTransfer.files)
}

</script>

<template>
  <section class="uploadwrap" :class="{ 'is-dragging': dragging }"
           @dragover.prevent="dragging = true"
           @dragleave.prevent="dragging = false"
           @drop.prevent="onDrop">
    <template v-if="purpose === 'image'">
      <Banner v-if="imageError" tone="danger">{{ $t('tournament.imageInvalid') }}</Banner>
      <input ref="filesInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" multiple accept="image/png,image/jpeg" :disabled="disabled || loading" data-testid="tournament-image-input" @change="onPick" />
      <div class="filebar">
        <p class="dropzone-hint">{{ $t('tournament.imageHint') }}</p>
        <div class="fb-actions">
          <AppButton :disabled="disabled || loading" @click="openPicker(filesInput)"><CloudUpload :size="18" aria-hidden="true" />{{ $t('tournament.selectImages') }}</AppButton>
          <AppButton variant="ghost" :disabled="disabled || loading || !files.length" @click="clearFiles">{{ $t('upload.clear') }}</AppButton>
        </div>
        <div v-if="files.length" class="fb-list">
          <span v-for="file in files" :key="fileKey(file)" class="chip">
            <span class="chip-name">{{ displayName(file) }}</span>
            <button class="chipx" type="button" :disabled="disabled || loading" :aria-label="$t('upload.remove_title')" @click="removeFile(file)"><X :size="16" aria-hidden="true" /></button>
          </span>
        </div>
      </div>
    </template>
    <template v-else>
    <Banner v-if="validation" tone="danger" data-testid="upload-validation-error">
      <p v-if="validation.noReplay">{{ $t('upload.reject_no_replay') }}</p>
      <p v-if="validation.singleOnly">{{ $t('upload.single_only') }}</p>
      <p v-if="validation.offending.length" class="upload-errors-title">{{ $t('upload.reject_offending_title') }}</p>
      <ul v-if="validation.offending.length" class="upload-errors-list">
        <li v-for="off in validation.offending" :key="fileKey(off.file)">
          <span v-if="off.reason === 'INVALID_TYPE'">{{ $t('upload.reject_invalid_type', { name: displayName(off.file) }) }}</span>
          <span v-else>{{ $t('upload.reject_too_large_file', { name: displayName(off.file), size: formatReplaySize(off.file.size) }) }}</span>
        </li>
      </ul>
      <p v-if="validation.offending.some(o => o.reason === 'FILE_TOO_LARGE')">{{ $t('upload.reject_size_hint') }}</p>
      <p v-if="validation.tooMany">{{ $t('upload.reject_count', { max: maxReplayFiles, current: validation.count }) }}</p>
      <p v-if="validation.totalTooLarge">{{ $t('upload.reject_total', { size: formatReplaySize(validation.totalBytes), max: maxReplayTotal }) }}</p>
    </Banner>

    <!-- 原生 input：视觉隐藏、不进 Tab 序列，由下方按钮触发 -->
    <input ref="filesInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" :multiple="allowFolder" accept=".wotbreplay" data-testid="select-files-input" @change="onPick" />
    <input v-if="allowFolder" ref="folderInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" multiple webkitdirectory data-testid="select-folder-input" @change="onPick" />
    <input ref="addFilesInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" :multiple="allowFolder" accept=".wotbreplay" data-testid="add-files-input" @change="onPick" />
    <input v-if="allowFolder" ref="addFolderInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" multiple webkitdirectory data-testid="add-folder-input" @change="onPick" />
    <input ref="compactAddInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" :multiple="allowFolder" accept=".wotbreplay" data-testid="compact-add-files-input" @change="onPick" />

    <!-- 状态 1：空 —— 全宽拖放区 -->
    <div v-if="!files.length" class="dropzone" data-testid="file-uploader-empty">
      <CloudUpload class="dropzone-icon" :size="40" aria-hidden="true" />
      <p class="dropzone-title">{{ $t('upload.drop_hint') }}</p>
      <p class="dropzone-hint">{{ $t(allowFolder ? 'upload.sub_hint' : 'upload.sub_hint_single') }}</p>
      <div class="dropzone-actions">
        <AppButton variant="primary" @click="openPicker(filesInput)"><FileText :size="18" aria-hidden="true" />{{ $t('upload.select_files') }}</AppButton>
        <AppButton v-if="allowFolder" @click="openPicker(folderInput)"><FolderOpen :size="18" aria-hidden="true" />{{ $t('upload.select_folder') }}</AppButton>
      </div>
      <p class="dropzone-meta">{{ $t(allowFolder ? 'upload.multi' : 'upload.multi_single') }} · {{ $t('upload.excel') }} · {{ $t('upload.privacy') }}</p>
    </div>

    <!-- 状态 2：已选择、未解析 —— 批次条 + 解析主操作 -->
    <div v-else-if="!compact" class="filebar">
      <div class="filebar-row">
        <div class="fb-summary">
          <FileText :size="20" aria-hidden="true" />
          <span><strong>{{ $t('upload.selected_title') }}</strong> <span class="fb-count">{{ $t('upload.files_size', { count: files.length, size: formatReplaySize(totalBytes) }) }}</span></span>
        </div>
        <div class="fb-actions">
          <AppButton variant="ghost" size="sm" :aria-expanded="listOpen" @click="listOpen = !listOpen">
            {{ listOpen ? $t('upload.hide_list') : $t('upload.view_list', { count: files.length }) }}
          </AppButton>
          <AppButton variant="ghost" size="sm" :title="$t('upload.add_files_title')" @click="openPicker(addFilesInput)"><Plus :size="16" aria-hidden="true" />{{ $t('upload.add') }}</AppButton>
          <AppButton v-if="allowFolder" variant="ghost" size="sm" :title="$t('upload.add_folder_title')" @click="openPicker(addFolderInput)"><FolderOpen :size="16" aria-hidden="true" />{{ $t('upload.folder') }}</AppButton>
          <AppButton variant="ghost" size="sm" :disabled="loading" @click="clearFiles"><Trash2 :size="16" aria-hidden="true" />{{ $t('upload.clear') }}</AppButton>
        </div>
      </div>
      <div v-if="listOpen" class="fb-list" data-testid="file-list">
        <span v-for="f in files" :key="fileKey(f)" class="chip" :title="displayName(f)">
          <span class="chip-name">{{ displayName(f) }}</span>
          <span class="chip-size">{{ formatReplaySize(f.size) }}</span>
          <button type="button" class="chipx" :title="$t('upload.remove_title')" :aria-label="$t('upload.remove_title')" @click.stop="removeFile(f)"><X :size="16" aria-hidden="true" /></button>
        </span>
      </div>
      <div v-if="showPreview" class="replay-primary-actions">
        <AppButton variant="primary" size="lg" :disabled="loading" @click="$emit('preview')">
          {{ $t('action.preview') }}<ArrowRight :size="18" aria-hidden="true" />
        </AppButton>
        <span v-if="loading" class="fb-count" role="status">{{ $t('action.processing') }}</span>
      </div>
    </div>

    <!-- 状态 3：解析完成 —— 一行批次条，把空间让给结果 -->
    <div v-else class="compactbar" data-testid="file-uploader-compact">
      <div class="fb-summary">
        <FileText :size="18" aria-hidden="true" />
        <span class="fb-count">{{ $t('upload.files_size', { count: files.length, size: formatReplaySize(totalBytes) }) }}</span>
      </div>
      <div v-if="!confirmingClear" class="fb-actions">
        <AppButton variant="ghost" size="sm" :title="$t('upload.add_files_title')" @click="openPicker(compactAddInput)"><Plus :size="16" aria-hidden="true" />{{ $t('upload.add') }}</AppButton>
        <AppButton variant="ghost" size="sm" :disabled="loading" data-testid="compact-clear" @click="confirmingClear = true"><Trash2 :size="16" aria-hidden="true" />{{ $t('upload.clear') }}</AppButton>
      </div>
      <div v-else class="fb-actions" role="group" :aria-label="$t('upload.clear_confirm')">
        <span class="fb-confirm">{{ $t('upload.clear_confirm') }}</span>
        <AppButton variant="danger" size="sm" data-testid="compact-clear-confirm" @click="clearFiles">{{ $t('upload.clear') }}</AppButton>
        <AppButton variant="ghost" size="sm" data-testid="compact-clear-cancel" @click="confirmingClear = false">{{ $t('upload.cancel') }}</AppButton>
      </div>
    </div>
    </template>
  </section>
</template>

<style scoped>
.uploadwrap { display: grid; gap: var(--space-3); }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-10) var(--space-4);
  border: 2px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
  text-align: center;
  transition: border-color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard);
}

.is-dragging .dropzone,
.is-dragging .filebar {
  border-color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 8%, var(--color-surface-1));
}

.dropzone-icon { color: var(--color-accent-text); }
.dropzone-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.dropzone-hint { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.dropzone-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-2); }
.dropzone-meta { margin: var(--space-2) 0 0; color: var(--color-text-tertiary); font: var(--type-caption); }

.filebar,
.compactbar {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.filebar { display: grid; gap: var(--space-3); padding: var(--space-3) var(--space-4); }

.filebar-row,
.compactbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.compactbar { padding: var(--space-2) var(--space-3); }

.fb-summary { display: flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--color-text-primary); font: var(--type-body); }
.fb-summary > svg { flex: none; color: var(--color-text-secondary); }
.fb-count { color: var(--color-text-secondary); font: var(--type-body); }
.fb-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.fb-confirm { color: var(--color-text-primary); font: var(--type-body); }

.fb-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  max-height: 180px;
  overflow-y: auto;
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border-subtle);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 320px;
  min-width: 0;
  padding: 2px 2px 2px var(--space-2);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-surface-2);
  color: var(--color-text-primary);
  font: var(--type-caption);
}

.chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-size { flex: none; color: var(--color-text-secondary); }

.chipx {
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
  font: var(--type-body);
  cursor: pointer;
}

.chipx:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.upload-errors-title { font-weight: 600; }
.upload-errors-list { margin: 0; padding-inline-start: var(--space-5); }

.replay-primary-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border-subtle);
}

@media (hover: hover) {
  .chipx:hover { background: var(--color-surface-3); color: var(--color-text-primary); }
}
</style>
