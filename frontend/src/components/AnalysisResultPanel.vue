<script setup>
import { ref } from 'vue'
import MarkdownContent from './MarkdownContent.vue'

// 普通用户页面只展示 AI 复盘正文 + 可折叠的「赛前预测」区块。
// 后端 /api/replay/analyze 返回 { analysis, preBattleSection? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
defineProps({
  result: {
    type: Object,
    required: true
  }
})

// 默认展开，用户可折叠收起
const preBattleOpen = ref(true)

function togglePreBattle() {
  preBattleOpen.value = !preBattleOpen.value
}
</script>

<template>
  <div class="panel analysis-panel">
    <div class="panel-head">
      <h2>{{ $t('recon.analysis_title_player') }}</h2>
    </div>
    <div v-if="result.preBattleSection" class="prebattle-block">
      <button
        type="button"
        class="prebattle-toggle"
        :aria-expanded="preBattleOpen"
        @click="togglePreBattle"
      >
        <span class="prebattle-title">{{ $t('recon.prebattle.title') }}</span>
        <span class="prebattle-state">
          {{ $t(preBattleOpen ? 'recon.prebattle.collapse' : 'recon.prebattle.expand') }}
        </span>
      </button>
      <MarkdownContent
        v-if="preBattleOpen"
        class="analysis-text prebattle-content"
        :content="result.preBattleSection"
      />
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
.prebattle-block {
  margin: 0 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card2);
  padding: 8px 12px;
}
.prebattle-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 4px 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: .9rem;
  color: var(--text-heading);
}
.prebattle-title { font-weight: 700; }
.prebattle-state { font-size: .78rem; color: var(--text-label); }
.prebattle-content { margin: 8px 0 0; }
</style>
