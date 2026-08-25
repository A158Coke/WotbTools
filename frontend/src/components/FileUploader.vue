<script setup>
import { ref, computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fileKey, displayName } from '../utils/helpers.js'
import {
  MAX_REPLAY_FILES,
  MAX_REPLAY_TOTAL_BYTES,
  formatReplaySize,
  isReplayFileName,
  validateReplaySelection
} from '../utils/replayUpload.js'

const emit = defineEmits(['update:files', 'preview', 'remove-request', 'workspace-action'])
const props = defineProps({ files: Array, loading: Boolean, confirmRemove: Boolean })
const dragging = ref(false)
const listOpen = ref(false)
const actionFileKey = ref('')
/** preflight 拒绝结果（{offending, tooMany, totalTooLarge}；非空时 selection 保持不变）。 */
const validation = ref(null)
const isAuthenticated = inject('isAuthenticated', () => false)
const login = inject('login', null)
const { t } = useI18n()
const maxReplayFiles = MAX_REPLAY_FILES
const maxReplayTotal = formatReplaySize(MAX_REPLAY_TOTAL_BYTES)

const totalBytes = computed(() => props.files.reduce((sum, f) => sum + (f.size || 0), 0))
const actionFile = computed(() => {
  if (props.files.length === 1) return props.files[0]
  if (!actionFileKey.value) return null
  return props.files.find(f => fileKey(f) === actionFileKey.value) || null
})
const directActionDisabled = computed(() => props.loading || !actionFile.value)

watch(() => props.files.map(fileKey), (keys) => {
  // Multi-file AI/playback must always target an explicitly selected file.
  // If the chosen replay was removed/replaced, invalidate the selection instead
  // of silently falling back to another replay.
  if (props.files.length !== 1 && (!actionFileKey.value || !keys.includes(actionFileKey.value))) {
    actionFileKey.value = ''
  }
}, { deep: true })

// 父级已更新 files（remove/clear/替换）→ 清除过期的 preflight 拒绝信息（被拒的 add
// 不会触发 update:files，因此错误会保留直到下一次成功 add 或 files 变化）。
watch(() => props.files, () => {
  validation.value = null
})

/**
 * 统一的候选入口（选择文件 / 选择文件夹 / add files / drag-drop 全部走这里）：
 * BLOCKER 3：批量/folder 交互<b>先过滤 .wotbreplay</b>，非回放文件不参与 100 上限 /
 * 200 MiB 总量、不得让合法 replay 整批失败；再对「现有 selection + 过滤后的新候选」
 * 合并集合做 preflight。任一违规 → 不更新 active files、不触发 Processing Job，
 * 保留之前合法 selection，一次展示所有 offending。
 */
function addFiles(list) {
  const picked = Array.from(list || [])
  const replays = picked.filter(f => isReplayFileName(f?.name))
  if (replays.length === 0) {
    validation.value = { noReplay: true, offending: [], tooMany: false, totalTooLarge: false }
    return
  }
  const byKey = new Map(props.files.map(f => [fileKey(f), f]))
  replays.forEach(f => byKey.set(fileKey(f), f))
  const prospective = Array.from(byKey.values()).sort((a, b) => displayName(a).localeCompare(displayName(b)))
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

function requireLoginForReplayAction() {
  if (isAuthenticated()) return true
  const ok = window.confirm(t('replay.login_required_for_battle'))
  if (ok && login) login('replay')
  return false
}

/**
 * 直接进入 AI 复盘 / 战局回放（单页 Workspace）：不跨视图跳转、不重新上传——
 * 目标文件已在 ReplayPage 内存中，上抛给页面切到对应 Workspace 面板。
 * 多文件必须经选择器显式指定目标（actionFile），禁止 fallback 第一场。
 */
function openReplayAction(mode) {
  const f = actionFile.value
  if (!f || !requireLoginForReplayAction()) return
  emit('workspace-action', { file: f, mode })
}
</script>

<template>
  <section class="uploadwrap"
           @dragover.prevent="dragging = true"
           @dragleave.prevent="dragging = false"
           @drop.prevent="onDrop">
    <div class="uploadhead">
      <span class="upload-kicker">{{ $t('upload.kicker') }}</span>
      <h1>{{ $t('upload.title') }}</h1>
      <p>{{ $t('upload.description') }}</p>
      <div class="upload-points">
        <span>{{ $t('upload.multi') }}</span>
        <span>{{ $t('upload.excel') }}</span>
        <span>{{ $t('upload.privacy') }}</span>
      </div>
    </div>

    <div v-if="validation" class="upload-errors" data-testid="upload-validation-error">
      <p v-if="validation.noReplay" class="upload-errors-hint">{{ $t('upload.reject_no_replay') }}</p>
      <p v-if="validation.offending.length" class="upload-errors-title">{{ $t('upload.reject_offending_title') }}</p>
      <ul v-if="validation.offending.length" class="upload-errors-list">
        <li v-for="off in validation.offending" :key="fileKey(off.file)">
          <span v-if="off.reason === 'INVALID_TYPE'">{{ $t('upload.reject_invalid_type', { name: displayName(off.file) }) }}</span>
          <span v-else>{{ $t('upload.reject_too_large_file', { name: displayName(off.file), size: formatReplaySize(off.file.size) }) }}</span>
        </li>
      </ul>
      <p v-if="validation.offending.some(o => o.reason === 'FILE_TOO_LARGE')" class="upload-errors-hint">{{ $t('upload.reject_size_hint') }}</p>
      <p v-if="validation.tooMany" class="upload-errors-hint">{{ $t('upload.reject_count', { max: maxReplayFiles, current: validation.count }) }}</p>
      <p v-if="validation.totalTooLarge" class="upload-errors-hint">{{ $t('upload.reject_total', { size: formatReplaySize(validation.totalBytes), max: maxReplayTotal }) }}</p>
    </div>

    <div v-if="!files.length" class="uploadcard" :class="{ dragging }">
      <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
      <div class="up-title">{{ $t('upload.drop_hint') }}</div>
          <div class="up-sub">{{ $t('upload.sub_hint') }}</div>
          <div class="up-actions">
            <label class="filebtn">
              <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>{{ $t('upload.select_files') }}
              <input type="file" multiple accept=".wotbreplay" data-testid="select-files-input" @change="onPick" />
            </label>
            <label class="filebtn ghost">
              <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.select_folder') }}
              <input type="file" multiple webkitdirectory data-testid="select-folder-input" @change="onPick" />
            </label>
          </div>
    </div>

    <div v-else class="filebar" :class="{ dragging }">
      <div class="fb-summary">
        <svg class="ic fb-ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
        <div>
          <strong>{{ $t('upload.selected_title') }}</strong>
          <span class="fb-count">{{ $t('upload.files_size', { count: files.length, size: formatReplaySize(totalBytes) }) }}</span>
        </div>
      </div>

      <button class="ghost sm" :class="{ active: listOpen }" :aria-expanded="listOpen" @click="listOpen = !listOpen">
        {{ listOpen ? $t('upload.hide_list') : $t('upload.view_list', { count: files.length }) }}
      </button>
      <div v-if="listOpen" class="fb-list" data-testid="file-list">
        <span v-for="f in files" :key="fileKey(f)" class="chip" :title="displayName(f)">
          <span class="chip-name">{{ displayName(f) }}</span>
          <span class="chip-size">{{ formatReplaySize(f.size) }}</span>
          <button type="button" class="chipx" :title="$t('upload.remove_title')" :aria-label="$t('upload.remove_title')" @click.stop="removeFile(f)">&times;</button>
        </span>
      </div>

      <div class="fb-actions">
        <label class="filebtn ghost sm" :title="$t('upload.add_files_title')">
          <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{{ $t('upload.add') }}
          <input type="file" multiple accept=".wotbreplay" data-testid="add-files-input" @change="onPick" />
        </label>
        <label class="filebtn ghost sm" :title="$t('upload.add_folder_title')">
          <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.folder') }}
          <input type="file" multiple webkitdirectory data-testid="add-folder-input" @change="onPick" />
        </label>
        <button class="ghost sm" :disabled="loading" @click="clearFiles">
          <svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>{{ $t('upload.clear') }}
        </button>
      </div>
    </div>

    <div v-if="files.length" class="replay-workspace-actions">
      <select v-if="files.length > 1" v-model="actionFileKey" class="replay-action-file" :aria-label="$t('upload.action_replay_selector')">
        <option value="" disabled>{{ $t('upload.action_replay_placeholder') }}</option>
        <option v-for="f in files" :key="fileKey(f)" :value="fileKey(f)">{{ displayName(f) }}</option>
      </select>
      <div class="actionrow">
        <button class="lg" :disabled="loading" @click="$emit('preview')">
          {{ $t('action.preview') }}<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
        <button class="battle-action" :disabled="directActionDisabled" data-testid="direct-playback-btn" @click="openReplayAction('playback')">{{ $t('action.battle_playback') }}</button>
        <button class="battle-action primary" :disabled="directActionDisabled" data-testid="direct-ai-btn" @click="openReplayAction('ai')">{{ $t('action.ai_review') }}</button>
        <span v-if="loading" class="muted">{{ $t('action.processing') }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fb-list { display:flex; flex-wrap:wrap; gap:6px; max-height:180px; overflow-y:auto; padding:4px 2px; border-top:1px solid var(--border,#dee2e6); }
.fb-list .chip { display:inline-flex; align-items:center; gap:6px; max-width:320px; min-width:0; }
.chip-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.chip-size { flex:0 0 auto; color:var(--text-sub,#6c757d); font-size:12px; }
.fb-list .chipx { flex:0 0 auto; display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border-radius:6px; line-height:1; cursor:pointer; }
.fb-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.upload-errors { margin:10px 0; padding:10px 12px; border:1px solid var(--danger-border,#f5c2c7); border-radius:7px; background:var(--danger-bg,#fff5f5); color:var(--danger,#b02a37); font-size:.9rem; }
.upload-errors-title { font-weight:700; margin:0 0 6px; }
.upload-errors-list { margin:0 0 4px; padding-left:18px; display:flex; flex-direction:column; gap:2px; }
.upload-errors-hint { margin:2px 0 0; opacity:.9; }
.replay-workspace-actions { margin-top:14px; padding-top:14px; border-top:1px solid var(--border-ghost); }
.replay-action-file { width:min(100%,560px); margin-bottom:10px; min-height:36px; padding:6px 10px; border:1px solid var(--border-ghost); border-radius:7px; background:var(--bg-card); color:var(--text); }
.actionrow { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.battle-action { display:inline-flex; align-items:center; min-height:40px; padding:8px 16px; border:1px solid var(--border-ghost); border-radius:7px; background:var(--bg-card); color:var(--text-label); cursor:pointer; font:inherit; font-weight:700; }
.battle-action.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-text); }
.battle-action:disabled { opacity:.48; cursor:not-allowed; }
</style>
