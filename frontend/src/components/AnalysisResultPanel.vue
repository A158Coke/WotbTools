<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownContent from './MarkdownContent.vue'

// 普通用户页面只展示 AI 复盘正文 + 可折叠的「赛前预测」区块。
// 后端 /api/replay/analyze 返回 { analysis, preBattleSection? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
// 地图鸟瞰（热力/路线/战局回放）已拆为页面级独立区块（ReplayPage Workspace / BattlePlaybackPanel 加载），
// 不随 AI 复盘结果渲染；AI 报告时间链接经 seek 事件上抛给页面。
const props = defineProps({
  result: {
    type: Object,
    required: true
  }
})

defineEmits(['seek'])

// 默认展开，用户可折叠收起
const preBattleOpen = ref(true)
// 复盘正文（call2）折叠状态，默认展开
const analysisOpen = ref(true)
const copied = ref(false)
let copyTimer
const { t } = useI18n()

function togglePreBattle() {
  preBattleOpen.value = !preBattleOpen.value
}

function toggleAnalysis() {
  analysisOpen.value = !analysisOpen.value
}

/** 一键复制最终复盘正文（result.analysis；可能包含团队剖析与免责声明；不含独立的赛前预测与地图鸟瞰）。
 * 末尾附带一行网站宣传（recon.copy_footer，三语随界面语言）。 */
async function copyAnalysis() {
  const text = props.result.analysis
  if (!text) return
  const withFooter = text + '\n' + t('recon.copy_footer')
  if (!(await copyTextWithFallback(withFooter))) return
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
      <div class="panel-head-actions">
        <button
          type="button"
          class="toggle-btn"
          data-test="toggle-analysis"
          :aria-expanded="analysisOpen"
          @click="toggleAnalysis"
        >
          {{ $t(analysisOpen ? 'recon.collapse' : 'recon.expand') }}
        </button>
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
    <MarkdownContent
      v-if="analysisOpen"
      class="analysis-text"
      :content="result.analysis"
      @seek="$emit('seek', $event)"
    />
  </div>
</template>

<style scoped>
/* AI 复盘结果 Card：宽度由父级 .ai-review-panel 拥有（唯一 width owner），
   本组件只负责内部 component styling，不再自行决定页面宽度/居中。 */
.analysis-panel {
  margin-top: 16px;
  width: 100%;
  max-width: none;
  margin-left: 0;
  margin-right: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-card2);
  box-shadow: var(--surface-shadow);
  overflow: hidden;
  color: var(--text);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 10px 14px;
  margin: 0;
  border-bottom: 1px solid var(--border);
  /* 长报告滚动时头部吸顶：top 使用全局 topbar token（App.vue 桌面端 .topbar
     fixed 高 var(--topbar-h)），禁止硬编码重复事实源。 */
  position: sticky;
  top: var(--topbar-h);
  z-index: 20;
  background: var(--bg-card2);
}
@media (max-width: 1080px) {
  /* <=1080px 时 App.vue .topbar 变为 sticky + auto height（可换行、高度不定），
     固定偏移无法对齐；回退普通流式头部——复制按钮随面板滚动（不重叠、可操作、
     滚出面板后消失），满足「不遮挡导航/正文、无横向溢出」。 */
  .panel-head {
    position: static;
    top: auto;
  }
}
.panel-head h2 { margin: 0; }
.panel-head-actions { display: flex; align-items: center; gap: 8px; margin: 0; }
.toggle-btn, .copy-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-card);
  color: var(--text-label);
  font-size: .8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.toggle-btn:hover, .copy-btn:hover { border-color: var(--accent); color: var(--accent-dark); }
.copy-btn.copied { border-color: var(--accent); color: var(--accent-dark); }
/* 正文统一水平 padding；Header 已自带 padding，正文区块不再各自用 margin 修位置 */
.analysis-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: var(--text);
  padding: 12px 14px 14px;
  margin: 0;
}
.prebattle-block {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
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
.prebattle-title { font-weight: 700; color: var(--text-heading); }
.prebattle-state { font-size: .78rem; color: var(--text-muted); }
.prebattle-content { margin: 8px 0 0; padding: 0; }
</style>