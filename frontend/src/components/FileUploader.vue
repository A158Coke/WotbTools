<script setup>
import { ref } from 'vue'
import { fileKey, displayName } from '../utils/helpers.js'

const emit = defineEmits(['update:files', 'preview'])
const props = defineProps({ files: Array, loading: Boolean })
const dragging = ref(false)

function addFiles(list) {
  const picked = Array.from(list || []).filter(f => f.name.toLowerCase().endsWith('.wotbreplay'))
  const byKey = new Map(props.files.map(f => [fileKey(f), f]))
  picked.forEach(f => byKey.set(fileKey(f), f))
  const next = Array.from(byKey.values()).sort((a, b) => displayName(a).localeCompare(displayName(b)))
  emit('update:files', next)
}

function removeFile(f) {
  const k = fileKey(f)
  emit('update:files', props.files.filter(x => fileKey(x) !== k))
}

function clearFiles() {
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

    <div v-if="!files.length" class="uploadcard" :class="{ dragging }">
      <span class="up-icon"><svg class="ic" viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M8 9l4-4 4 4M12 5v12" /></svg></span>
      <div class="up-title">{{ $t('upload.drop_hint') }}</div>
      <div class="up-sub">{{ $t('upload.sub_hint') }}</div>
      <div class="up-actions">
        <label class="filebtn">
          <svg class="ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>{{ $t('upload.select_files') }}
          <input type="file" multiple accept=".wotbreplay" @change="onPick" />
        </label>
        <label class="filebtn ghost">
          <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.select_folder') }}
          <input type="file" multiple webkitdirectory @change="onPick" />
        </label>
      </div>
    </div>

    <div v-else class="filebar" :class="{ dragging }">
      <div class="fb-summary">
        <svg class="ic fb-ic" viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
        <div>
          <strong>{{ $t('upload.selected_title') }}</strong>
          <span class="fb-count">{{ $t('upload.files_count', { count: files.length }) }}</span>
        </div>
      </div>
      <div class="fb-chips">
        <span v-for="f in files" :key="fileKey(f)" class="chip">
          {{ displayName(f) }}
          <button class="chipx" :title="$t('upload.remove_title')" @click="removeFile(f)">&times;</button>
        </span>
      </div>
      <label class="filebtn ghost sm" :title="$t('upload.add_files_title')">
        <svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>{{ $t('upload.add') }}
        <input type="file" multiple accept=".wotbreplay" @change="onPick" />
      </label>
      <label class="filebtn ghost sm" :title="$t('upload.add_folder_title')">
        <svg class="ic" viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>{{ $t('upload.folder') }}
        <input type="file" multiple webkitdirectory @change="onPick" />
      </label>
      <button class="ghost sm" :disabled="loading" @click="clearFiles">
        <svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></svg>{{ $t('upload.clear') }}
      </button>
    </div>

    <div v-if="files.length" class="actionrow">
      <button class="lg" :disabled="loading" @click="$emit('preview')">
        {{ $t('action.preview') }}<svg class="ic" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </button>
      <span v-if="loading" class="muted">{{ $t('action.processing') }}</span>
      <span v-else class="muted">{{ $t('action.preview_hint') }}</span>
    </div>
  </section>
</template>
