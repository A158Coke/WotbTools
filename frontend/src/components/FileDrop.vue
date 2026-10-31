<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudUpload, FileText, FolderOpen, X } from 'lucide-vue-next'
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
import { isAndroidApp } from '../composables/usePlatformBridge.js'
import { pickNativeReplayFolder, supportsNativeReplayFolder } from '../platform/replayFolderPicker.js'

const emit = defineEmits(['update:files'])
const props = defineProps({
  files: Array,
  loading: Boolean,
  disabled: Boolean,
  /** Shared picker supports screenshots without changing the default replay preflight. */
  purpose: { type: String, default: 'replay', validator: v => ['replay', 'image'].includes(v) },
  imageSingle: { type: Boolean, default: false },
  imageLabel: { type: String, default: '' },
  imageHint: { type: String, default: '' },
})
const dragging = ref(false)
/** preflight 结果（{offending, tooMany, totalTooLarge, alreadyListed}；非空时 selection 保持不变）。 */
const validation = ref(null)
const imageError = ref(false)
const nativeFolderAvailable = ref(false)
const pickingFolder = ref(false)
const folderError = ref('')
let folderReadController = null
let disposed = false
const showFolderPicker = computed(() => !isAndroidApp() || nativeFolderAvailable.value)
onMounted(async () => {
  if (isAndroidApp() && props.purpose === 'replay') {
    const supported = await supportsNativeReplayFolder()
    if (!disposed) nativeFolderAvailable.value = supported
  }
})
onBeforeUnmount(() => {
  disposed = true
  folderReadController?.abort()
})
const { t } = useI18n()
const maxReplayFiles = MAX_REPLAY_FILES
const maxReplayTotal = formatReplaySize(MAX_REPLAY_TOTAL_BYTES)

/** 原生 file input 视觉隐藏，由真正的按钮触发，保证键盘可达（WS-07）。 */
const filesInput = ref(null)
const folderInput = ref(null)
function openPicker(input) {
  if (props.loading || props.disabled || pickingFolder.value) return
  input?.click?.()
}

async function openFolderPicker(input) {
  if (props.loading || props.disabled || pickingFolder.value) return
  if (!isAndroidApp()) return openPicker(input)
  if (!nativeFolderAvailable.value) return
  folderError.value = ''
  pickingFolder.value = true
  const controller = new AbortController()
  folderReadController = controller
  try {
    const files = await pickNativeReplayFolder({
      signal: controller.signal,
      prepareFiles: metadata => prepareReplayFiles(metadata)?.picked || [],
    })
    if (!disposed && !controller.signal.aborted && files) {
      pickingFolder.value = false
      addFiles(files)
    }
  } catch (error) {
    if (!disposed && !controller.signal.aborted) {
      folderError.value = error?.code === 'ambiguous-paths'
        ? 'upload.folder_ambiguous_paths' : 'upload.folder_read_error'
    }
  } finally {
    if (!disposed) pickingFolder.value = false
    if (folderReadController === controller) folderReadController = null
  }
}

// 父级已更新 files（remove/clear/替换）→ 清除过期的 preflight 拒绝信息（被拒的 add
// 不会触发 update:files，因此错误会保留直到下一次成功 add 或 files 变化）。
watch(() => props.files, () => {
  // A newer import owns this selection; a late folder result must not reset its parsed output.
  folderReadController?.abort()
  validation.value = null
  folderError.value = ''
})

/**
 * 统一的候选入口（选择文件 / 选择文件夹 / add files / drag-drop 全部走这里）：
 * 批量/folder 交互<b>先过滤 .wotbreplay</b>，非回放文件不参与 100 上限 /
 * 200 MiB 总量、不得让合法 replay 整批失败；再对「现有 selection + 过滤后的新候选」
 * 合并集合做 preflight。任一违规 → 不更新 active files、不触发 Processing Job，
 * 保留之前合法 selection，一次展示所有 offending。
 */
function addFiles(list) {
  if (props.loading || props.disabled || pickingFolder.value) return
  const picked = Array.from(list || [])
  if (props.purpose === 'image') {
    if ((props.imageSingle && picked.length > 1) || picked.some(file => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0)) {
      imageError.value = true
      return
    }
    imageError.value = false
    if (props.imageSingle) {
      if (picked.length) emit('update:files', picked)
      return
    }
    const byKey = new Map(props.files.map(file => [fileKey(file), file]))
    picked.forEach(file => byKey.set(fileKey(file), file))
    emit('update:files', [...byKey.values()])
    return
  }
  const prepared = prepareReplayFiles(picked)
  if (prepared) emit('update:files', prepared.prospective)
}

/**
 * One preflight for Web files, Native metadata and fully-read Native files.
 * 已在列表里的文件保持原实例与原位置，新文件追加到尾部：sourceId 是 files 下标，
 * 现有结果在后台加载期间必须继续对得上。
 */
function prepareReplayFiles(picked) {
  const replays = picked.filter(f => isReplayFileName(f?.name))
  if (replays.length === 0) {
    validation.value = { noReplay: true, offending: [], tooMany: false, totalTooLarge: false }
    return
  }
  const listed = new Set(props.files.map(fileKey))
  const added = [...new Map(replays.filter(f => !listed.has(fileKey(f))).map(f => [fileKey(f), f])).values()]
    .sort((a, b) => displayName(a).localeCompare(displayName(b)))
  if (added.length === 0) {
    validation.value = { alreadyListed: true, offending: [], tooMany: false, totalTooLarge: false }
    return
  }
  const prospective = [...props.files, ...added]
  const result = validateReplaySelection(prospective)
  if (!result.valid) {
    validation.value = result
    return
  }
  validation.value = null
  return { picked: added, prospective }
}

function removeFile(f) {
  if (props.loading || props.disabled) return
  const k = fileKey(f)
  emit('update:files', props.files.filter(x => fileKey(x) !== k))
}

function clearFiles() {
  if (props.loading || props.disabled) return
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

defineExpose({
  chooseFiles: () => openPicker(filesInput.value),
  chooseFolder: () => openFolderPicker(folderInput.value),
  addDropped: addFiles,
  folderAvailable: showFolderPicker,
})

</script>

<template>
  <section class="uploadwrap" :class="{ 'is-dragging': dragging }"
           @dragover.prevent="dragging = true"
           @dragleave.prevent="dragging = false"
           @drop.stop.prevent="onDrop">
    <template v-if="purpose === 'image'">
      <Banner v-if="imageError" tone="danger">{{ $t('tournament.imageInvalid') }}</Banner>
      <input ref="filesInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" :multiple="!imageSingle" accept="image/png,image/jpeg" :disabled="disabled || loading" data-testid="tournament-image-input" @change="onPick" />
      <div class="filebar">
        <p class="dropzone-hint">{{ imageHint || $t('tournament.imageHint') }}</p>
        <div class="fb-actions">
          <AppButton :disabled="disabled || loading" @click="openPicker(filesInput)"><CloudUpload :size="18" aria-hidden="true" />{{ imageLabel || $t('tournament.selectImages') }}</AppButton>
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
    <Banner v-if="validation" :tone="validation.alreadyListed ? 'info' : 'danger'" data-testid="upload-validation-error">
      <p v-if="validation.alreadyListed">{{ $t('upload.already_listed') }}</p>
      <p v-if="validation.noReplay">{{ $t('upload.reject_no_replay') }}</p>
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

    <Banner v-if="folderError" tone="danger" data-testid="folder-read-error">{{ $t(folderError) }}</Banner>

    <!-- 原生 input：视觉隐藏、不进 Tab 序列，由下方按钮触发 -->
    <input ref="filesInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" multiple accept=".wotbreplay" data-testid="select-files-input" @change="onPick" />
    <input v-if="showFolderPicker && !isAndroidApp()" ref="folderInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" multiple webkitdirectory data-testid="select-folder-input" @change="onPick" />

    <!-- 只有空列表才有上传面；有回放后入口在工作台的「管理回放」，这里只留 input 与校验提示 -->
    <div v-if="!files.length" class="dropzone" data-testid="file-uploader-empty">
      <CloudUpload class="dropzone-icon" :size="40" aria-hidden="true" />
      <p class="dropzone-title">{{ $t('upload.drop_hint') }}</p>
      <p class="dropzone-hint">{{ $t(showFolderPicker ? 'upload.sub_hint' : 'upload.files_only_hint') }}</p>
      <div class="dropzone-actions">
        <AppButton variant="primary" :disabled="disabled || loading || pickingFolder" @click="openPicker(filesInput)"><FileText :size="18" aria-hidden="true" />{{ $t('upload.select_files') }}</AppButton>
        <AppButton v-if="showFolderPicker" :disabled="disabled || loading || pickingFolder" :aria-busy="pickingFolder" @click="openFolderPicker(folderInput)"><FolderOpen :size="18" aria-hidden="true" />{{ $t(pickingFolder ? 'upload.reading_folder' : 'upload.select_folder') }}</AppButton>
      </div>
      <p class="dropzone-meta">{{ $t(showFolderPicker ? 'upload.multi' : 'upload.files_only_multi') }} · {{ $t('upload.excel') }} · {{ $t('upload.privacy') }}</p>
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

.is-dragging .dropzone {
  border-color: var(--color-accent);
  background: color-mix(in oklab, var(--color-accent) 8%, var(--color-surface-1));
}

.dropzone-icon { color: var(--color-accent-text); }
.dropzone-title { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.dropzone-hint { margin: 0; color: var(--color-text-secondary); font: var(--type-body); }
.dropzone-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-2); }
.dropzone-meta { margin: var(--space-2) 0 0; color: var(--color-text-tertiary); font: var(--type-caption); }

.filebar {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-surface-1);
}

.fb-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }

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

@media (hover: hover) {
  .chipx:hover { background: var(--color-surface-3); color: var(--color-text-primary); }
}
</style>
