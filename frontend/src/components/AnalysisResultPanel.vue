<script setup>
import MarkdownContent from './MarkdownContent.vue'

// 普通用户页面只展示 AI 复盘正文。
// 后端 /api/replay/analyze 仅返回 { analysis }；不渲染任何内部统计/结构化细节。
defineProps({
  result: {
    type: Object,
    required: true
  }
})
</script>

<template>
  <div class="panel analysis-panel">
    <div class="panel-head">
      <h2>{{ $t('recon.analysis_title_player') }}</h2>
    </div>
    <MarkdownContent class="analysis-text" :content="result.analysis" />
  </div>
</template>

<style scoped>
.analysis-panel {
  margin-top: 16px;
}
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-head h2 { margin: 0 0 12px; }
.analysis-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  margin: 0 0 8px;
}
</style>
