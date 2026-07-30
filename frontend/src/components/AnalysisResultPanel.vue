<script setup>
import MarkdownContent from './MarkdownContent.vue'

// 普通用户页面只展示 AI 复盘正文。
// 后端仍然返回 mode / analyses / limitations / keyEvents 等字段（日志与内部诊断继续使用），
// 这里刻意不渲染，避免把内部统计、错误码和 reconstruction 派生的结构化细节暴露给玩家。
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
