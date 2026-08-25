<script setup>
import { formatReplaySize } from '../utils/replayUpload.js'

defineProps({
  files: {
    type: Array,
    required: true
  }
})

defineEmits(['add-file', 'remove-file', 'clear'])
</script>

<template>
  <div class="up-actions">
    <label class="filebtn">
      {{ $t('recon.select_file') }}
      <input type="file" accept=".wotbreplay" @change="$emit('add-file', $event)">
    </label>
    <button v-if="files.length" class="ghost" @click="$emit('clear')">
      {{ $t('upload.clear') }}
    </button>
  </div>

  <div v-if="files.length" class="fb-chips">
    <span
      v-for="(selectedFile, index) in files"
      :key="`${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`"
      class="chip"
    >
      <span class="chip-name">{{ selectedFile.name }}</span>
      <span class="chip-size">{{ formatReplaySize(selectedFile.size) }}</span>
      <button type="button" class="chipx" :aria-label="$t('upload.remove_file_aria', { name: selectedFile.name })" @click="$emit('remove-file', index)">&times;</button>
    </span>
  </div>
</template>

<style scoped>
.fb-chips :deep(.chip) { display: inline-flex; align-items: center; gap: 6px; }
.chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip-size { flex: 0 0 auto; color: var(--text-sub, #6c757d); font-size: 12px; }
</style>
