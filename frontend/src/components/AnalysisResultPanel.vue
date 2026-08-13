<script setup>
import { onBeforeUnmount, ref } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
import MapOverview from './MapOverview.vue'
import { mapImages } from '../data/mapImages'

// 普通用户页面只展示 AI 复盘正文 + 可折叠的「赛前预测」区块。
// 后端 /api/replay/analyze 返回 { analysis, preBattleSection?, mapOverview? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
const props = defineProps({
  result: {
    type: Object,
    required: true
  }
})

// 默认展开，用户可折叠收起
const preBattleOpen = ref(true)
const mapOpen = ref(false)
const mapSeek = ref(null)
const copied = ref(false)
let copyTimer

function togglePreBattle() {
  preBattleOpen.value = !preBattleOpen.value
}

function toggleMap() {
  mapOpen.value = !mapOpen.value
}

/** AI 报告时间跳转：展开地图鸟瞰并让播放器 seek（MapOverview 自动切到战局回放视图）。 */
function onSeek(sec) {
  mapSeek.value = sec
  mapOpen.value = true
}

// 素材开关：mapOverview 非 null 且该地图在 mapImages 中有素材时才渲染（无素材整块跳过）
function hasMapAsset(overview) {
  return !!(overview && overview.mapCode && mapImages[overview.mapCode])
}

/** 一键复制最终复盘正文（result.analysis；可能包含团队剖析与免责声明；不含独立的赛前预测与地图鸟瞰）。 */
async function copyAnalysis() {
  const text = props.result.analysis
  if (!text) return
  if (!(await copyTextWithFallback(text))) return
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}

/** Clipboard API 优先；writeText 缺失或 reject 时降级 execCommand。复制成功返回 true。 */
async function copyTextWithFallback(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // writeText 存在但失败 → 继续尝试 fallback
    }
  }
  return fallbackCopy(text)
}

/**
 * execCommand 降级：textarea 通过 try/finally 保证移除；
 * execCommand 返回 false 或抛异常时视为失败（不显示「已复制」）。
 */
function fallbackCopy(text) {
  let textarea = null
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    if (textarea) {
      textarea.remove()
    }
  }
}

onBeforeUnmount(() => clearTimeout(copyTimer))
</script>

<template>
  <div class="panel analysis-panel">
    <div class="panel-head">
      <h2>{{ $t('recon.analysis_title_player') }}</h2>
      <button
        type="button"
        class="copy-btn"
        :class="{ copied }"
        data-test="copy-analysis-btn"
        :aria-label="$t('recon.copy')"
        @click="copyAnalysis"
      >
        {{ $t(copied ? 'recon.copied' : 'recon.copy') }}
      </button>
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
        :seek-to="mapSeek"
      />
    </div>
    <MarkdownContent class="analysis-text" :content="result.analysis" @seek="onSeek" />
  </div>
</template>

<style scoped>
.analysis-panel {
  margin-top: 16px;
}
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-head h2 { margin: 0 0 12px; }
.copy-btn {
  margin: 0 0 12px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-card2);
  color: var(--text-label);
  font-size: .8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.copy-btn:hover { border-color: var(--accent); color: var(--accent-dark); }
.copy-btn.copied { border-color: var(--accent); color: var(--accent-dark); }
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
