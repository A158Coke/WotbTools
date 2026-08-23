<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownContent from './MarkdownContent.vue'

// 普通用户页面只展示 AI 复盘正文 + 可折叠的「赛前预测」区块。
// 后端 /api/replay/analyze 返回 { analysis, preBattleSection? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
// 地图鸟瞰（热力/路线/战局回放）已拆为页面级独立区块（ReconstructionPage 加载），
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
.analysis-panel {
  margin-top: 16px;
  max-width: 1100px;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid #303a40;
  border-radius: 9px;
  background: rgba(13, 18, 22, .94);
  box-shadow: 0 20px 52px rgba(0, 0, 0, .26);
  overflow: hidden;
  color: #d8d5cd;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* 随用户视角固定在右上角：页面滚动时头部吸顶，复制按钮保持在可视区右上角。
     top 必须落在全局 Topbar 下方——App.vue 桌面端 (>1080px) .topbar 为 fixed 高 52px
     (z-index:100)，若 top:0 会被顶栏遮挡；此值须与 App.vue .tb-content padding-top 同步。 */
  position: sticky;
  top: 52px;
  z-index: 20;
  background: rgba(13, 18, 22, .97);
  padding: 8px 0;
  margin: -8px 0 0;
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
.panel-head h2 { margin: 0 0 12px; }
.panel-head-actions { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.panel-head-actions .copy-btn, .panel-head-actions .toggle-btn { margin: 0; }
.toggle-btn {
  padding: 4px 12px;
  border: 1px solid #465159;
  border-radius: 5px;
  background: #151d21;
  color: #c9c5bb;
  font-size: .8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.toggle-btn:hover { border-color: var(--accent); color: #f0aa30; }
.copy-btn {
  margin: 0 0 12px;
  padding: 4px 12px;
  border: 1px solid #465159;
  border-radius: 5px;
  background: #151d21;
  color: #c9c5bb;
  font-size: .8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color .15s, color .15s;
}
.copy-btn:hover { border-color: var(--accent); color: #f0aa30; }
.copy-btn.copied { border-color: var(--accent); color: #f0aa30; }
.analysis-text {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: .9rem;
  color: #d8d5cd;
  margin: 0 0 8px;
}
.prebattle-block {
  margin: 0 0 12px;
  border: 1px solid #303a40;
  border-radius: 6px;
  background: rgba(17, 23, 26, .92);
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
  color: #f2ede3;
}
.prebattle-title { font-weight: 700; color: #f2ede3; }
.prebattle-state { font-size: .78rem; color: #9aa09c; }
.prebattle-content { margin: 8px 0 0; }
</style>