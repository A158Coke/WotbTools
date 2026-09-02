<script setup>
defineOptions({ name: 'ReplayWorkspaceHeader' })

defineProps({
  hasFiles: { type: Boolean, default: false },
})

const emit = defineEmits(['clear'])
</script>

<template>
  <header class="workspace-header">
    <div class="ws-title">
      <span class="upload-kicker">WOTBTOOLS · REPLAY WORKSPACE</span>
      <h1>{{ $t('workspace.title') }}</h1>
    </div>
    <div class="ws-actions">
      <button v-if="hasFiles" class="ghost sm" @click="emit('clear')">{{ $t('workspace.clear') }}</button>
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ws-title h1 { margin: 2px 0 0; font-size: 1.5rem; }
.ws-actions { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; }
@media (width < 768px) {
  .workspace-header { gap: 8px; }
  .ws-actions { margin-left: 0; width: 100%; justify-content: space-between; }
}
</style>
