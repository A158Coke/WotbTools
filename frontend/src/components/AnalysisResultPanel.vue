<script setup>
import { ref } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import MapOverview from './MapOverview.vue'
import { mapImages } from '../data/mapImages'

// 普通用户页面只展示 AI 复盘正文 + 可折叠的「赛前预测」区块。
// 后端 /api/replay/analyze 返回 { analysis, preBattleSection?, mapOverview? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
defineProps({
  result: {
    type: Object,
    required: true
  }
})

// 默认展开，用户可折叠收起
const preBattleOpen = ref(true)
const mapOpen = ref(false)

function togglePreBattle() {
  preBattleOpen.value = !preBattleOpen.value
}

function toggleMap() {
  mapOpen.value = !mapOpen.value
}

// 素材开关：mapOverview 非 null 且该地图在 mapImages 中有素材时才渲染（无素材整块跳过）
function hasMapAsset(overview) {
  return !!(overview && overview.mapCode && mapImages[overview.mapCode])
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
    <div
      v-if="hasMapAsset(result.mapOverview)"
      class="prebattle-block"
      data-test="map-block"
    >
      <button
        type="button"
        class="prebattle-toggle"
        :aria-expanded="mapOpen"
        @click="toggleMap"
      >
        <span class="prebattle-title">{{ $t('recon.map.title') }}</span>
        <span class="prebattle-state">
          {{ $t(mapOpen ? 'recon.prebattle.collapse' : 'recon.prebattle.expand') }}
        </span>
      </button>
      <MapOverview
        v-if="mapOpen"
        class="map-overview-content"
        :overview="result.mapOverview"
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
.map-overview-content { margin: 8px 0 0; }
</style>
