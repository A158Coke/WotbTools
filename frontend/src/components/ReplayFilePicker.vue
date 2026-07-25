<script setup>
defineProps({
  files: {
    type: Array,
    required: true
  }
})

defineEmits(['add-file', 'clear'])
</script>

<template>
  <div class="up-actions">
    <label class="filebtn">
      {{ $t('recon.select_file') }}
      <input type="file" accept=".wotbreplay" multiple @change="$emit('add-file', $event)">
    </label>
    <button v-if="files.length" class="ghost" @click="$emit('clear')">
      {{ $t('upload.clear') }}
    </button>
  </div>

  <div v-if="files.length" class="fb-chips">
    <span
      v-for="selectedFile in files"
      :key="`${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`"
      class="chip"
    >
      {{ selectedFile.name }}
    </span>
  </div>
</template>
