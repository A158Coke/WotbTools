<!--
  独立 reconstruction 页的文件选择面板（单页 Workspace 改造后仅此页使用）。
  「AI 战术复盘」发起按钮已随拆分移入 AiReviewPanel（ReplayPage Workspace 与独立页共用同一实现），
  本面板只负责：标题 + 单文件选择/移除/清空。
-->
<script setup>
import ReplayFilePicker from './ReplayFilePicker.vue'

defineProps({
  files: {
    type: Array,
    required: true
  }
})

defineEmits([
  'add-file',
  'remove-file',
  'clear'
])
</script>

<template>
  <div class="uploadwrap">
    <div class="up-icon">
      <svg class="ic" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/></svg>
    </div>
    <h2>{{ $t('recon.title') }}</h2>
    <p class="sub-hint">{{ $t('recon.description') }}</p>

    <ReplayFilePicker
      :files="files"
      @add-file="$emit('add-file', $event)"
      @remove-file="$emit('remove-file', $event)"
      @clear="$emit('clear')"
    />
  </div>
</template>
