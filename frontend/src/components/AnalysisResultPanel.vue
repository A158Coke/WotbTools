<script setup>
import { showToast } from '../composables/useToast.js'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownContent from './MarkdownContent.vue'
import AiReviewFeedbackDialog from './AiReviewFeedbackDialog.vue'
import { copyText } from '../utils/clipboard.js'
import { buildAiReviewReplyText, teamIdentityLabel as identityLabel } from '../utils/aiReviewReplyText.js'

// 普通用户页面只展示 AI 复盘正文/Team 结构化结果 + 可折叠的「赛前预测」区块。
// 后端 SSE `done` 载荷返回个人 { analysis, preBattleSection? } 或团队 { teamReview, preBattleSection? }；
// preBattleSection 为 null/空（Call #1 失败/降级）时整个区块不渲染。
// 地图鸟瞰（热力/路线/战局回放）已拆为页面级独立区块（ReplayPage Workspace / BattlePlaybackPanel 加载），
// 不随 AI 复盘结果渲染。4.0：团队复盘的关键回合可以「在 2D 中查看」——本面板只发出 `view-2d(startSec)`，
// 跳转与 seek 由工作台（ReplayWorkspace → BattlePlaybackPanel.seekTo）负责；AI episode 的 startSec 与
// 2D 回放共用开战为 0 的战斗时钟（docs/features/battle-playback.md「同一战斗时钟」）。
const props = defineProps({
  result: {
    type: Object,
    required: true
  },
  /** 宿主能把用户带到 2D 回放时为 true（工作台内）；独立渲染时不显示「在 2D 中查看」。 */
  canViewIn2d: { type: Boolean, default: false },
})
const emit = defineEmits(['view-2d'])

// 默认展开，用户可折叠收起
const preBattleOpen = ref(true)
// 复盘正文（call2）折叠状态，默认展开
const analysisOpen = ref(true)
const copied = ref(false)
const feedbackOpen = ref(false)
const feedbackSnapshot = ref('')
const feedbackSent = ref(false)
let copyTimer
const { t, locale } = useI18n()
/** 战斗时钟 mm:ss（与 2D 回放顶栏同一格式：开战为 0 的已过时间）。 */
function formatClock(sec) {
  const total = Math.max(0, Math.round(sec))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

watch([() => props.result, () => locale?.value], () => {
  feedbackOpen.value = false
  feedbackSent.value = false
})

function togglePreBattle() {
  preBattleOpen.value = !preBattleOpen.value
}

function toggleAnalysis() {
  analysisOpen.value = !analysisOpen.value
}

function openFeedback() {
  feedbackSnapshot.value = buildAiReviewReplyText(props.result, t)
  if (!feedbackSnapshot.value) return
  feedbackSent.value = false
  feedbackOpen.value = true
}

function feedbackSuccess() {
  feedbackOpen.value = false
  feedbackSent.value = true
}

/** 一键复制最终复盘正文（团队结果使用 authoritative display identity；不含独立的赛前预测与地图鸟瞰）。
 * 末尾附带一行网站宣传（recon.copy_footer，三语随界面语言）。 */
function teamIdentityLabel(playerKey) {
  return identityLabel(props.result, playerKey, t)
}

async function copyAnalysis() {
  const text = buildAiReviewReplyText(props.result, t)
  if (!text) return
  if (!(await copyText(text))) return
  showToast({ id: 'copy', tone: 'success', titleKey: 'toast.copied' })
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
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
        <button v-if="buildAiReviewReplyText(result, t)" type="button" class="copy-btn" data-test="feedback-btn" @click="openFeedback">{{ $t('aiFeedback.button') }}</button>
      </div>
    </div>
    <p v-if="feedbackSent" role="status">{{ $t('aiFeedback.success') }}</p>
    <AiReviewFeedbackDialog :open="feedbackOpen" :snapshot="feedbackSnapshot" @close="feedbackOpen = false" @success="feedbackSuccess" />
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
      v-if="analysisOpen && !result.teamReview && result.analysis"
      class="analysis-text"
      :content="result.analysis"
    />
    <div v-if="analysisOpen && result.teamReview" class="team-review-content">
      <section class="team-verdict" data-testid="team-verdict">
        <p class="team-verdict-kicker">{{ $t('recon.team.verdict') }}</p>
        <MarkdownContent class="analysis-text team-verdict-text" :content="result.teamReview.summary.verdict" />
        <ul class="team-verdict-tags">
          <li>{{ $t('recon.team.episodesCount', { count: result.teamReview.episodes.length }) }}</li>
          <li>{{ $t('recon.team.trainingCount', { count: result.teamReview.trainingSuggestions.length }) }}</li>
        </ul>
        <div class="team-diagnosis">
          <h3>{{ $t('recon.team.diagnosis') }}</h3>
          <MarkdownContent class="analysis-text" :content="result.teamReview.summary.primaryDiagnosis" />
        </div>
      </section>

      <section v-if="result.teamReview.episodes.length" class="team-section">
        <h3>{{ $t('recon.team.episodes') }}</h3>
        <ol class="team-timeline" data-testid="team-timeline">
          <li v-for="episode in result.teamReview.episodes" :key="episode.id" class="team-timeline-item">
            <span class="team-time" :class="{ 'is-unknown': episode.startSec === null }">
              <template v-if="episode.startSec !== null && episode.endSec !== null">{{ formatClock(episode.startSec) }}–{{ formatClock(episode.endSec) }}</template>
              <template v-else>—</template>
            </span>
            <div class="team-timeline-body">
              <h4>{{ episode.title }}</h4>
              <MarkdownContent class="analysis-text" :content="episode.analysis" />
              <button
                v-if="canViewIn2d && episode.startSec !== null"
                type="button"
                class="team-view-2d"
                data-testid="team-view-2d"
                @click="emit('view-2d', episode.startSec)"
              >{{ $t('recon.team.viewIn2d') }}</button>
            </div>
          </li>
        </ol>
      </section>

      <section v-if="result.teamReview.trainingSuggestions.length" class="team-section">
        <h3>{{ $t('recon.team.training') }}</h3>
        <article v-for="suggestion in result.teamReview.trainingSuggestions" :key="suggestion.title" class="team-card">
          <h4>{{ suggestion.title }}</h4>
          <MarkdownContent class="analysis-text" :content="suggestion.content" />
        </article>
      </section>

      <section v-if="result.teamReview.reviewFocus.length" class="team-section">
        <h3>{{ $t('recon.team.reviewFocus') }}</h3>
        <article v-for="item in result.teamReview.reviewFocus" :key="`${item.playerKey}-${item.episodeId}`" class="team-card">
          <strong>{{ teamIdentityLabel(item.playerKey) }}</strong>
          <MarkdownContent class="analysis-text" :content="item.reason" />
        </article>
      </section>

      <section v-if="result.teamReview.highContributors.length" class="team-section">
        <h3>{{ $t('recon.team.highContributors') }}</h3>
        <article v-for="item in result.teamReview.highContributors" :key="`${item.playerKey}-${item.episodeId}`" class="team-card">
          <strong>{{ teamIdentityLabel(item.playerKey) }}</strong>
          <MarkdownContent class="analysis-text" :content="item.reason" />
        </article>
      </section>
    </div>
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
  /* 长报告滚动时头部吸顶：top 使用全局顶栏高度 token（--topbar-h 是 --header-h 的 deprecated 别名），
     禁止硬编码重复事实源。 */
  position: sticky;
  top: var(--topbar-h);
  z-index: 20;
  background: var(--bg-card2);
}
@media (max-width: 1080px) {
  /* 窄屏回退普通流式头部：复制按钮随面板滚动（不重叠、可操作、滚出面板后消失）。 */
  .panel-head {
    position: static;
    top: auto;
  }
}
.panel-head h2 { margin: 0; }
.panel-head-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin: 0; }
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
  /* 超宽表格（MarkdownContent :deep(table) width:100%）在正文区域内横向滚动，
     不再被 .analysis-panel 的 overflow:hidden（圆角裁切所需，保留）切断。 */
  overflow-x: auto;
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
@media (pointer: coarse) {
  .toggle-btn, .copy-btn, .prebattle-toggle {
    min-width: var(--hit-min);
    min-height: var(--hit-min);
  }
}
.team-review-content { padding: 0 14px 14px; }
.team-section { border-bottom: 1px solid var(--border); padding: 12px 0; }
.team-section:last-child { border-bottom: 0; }
.team-review-content h3 { margin: 0 0 8px; color: var(--text-heading); }
.team-card { margin-top: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-card); }
.team-card h4 { display: inline; margin: 0; color: var(--text-heading); }
.team-card .analysis-text, .team-verdict .analysis-text, .team-timeline .analysis-text { padding: 0; }

/* 4.0：团队结论置顶卡 + 关键回合时间线 */
.team-verdict {
  display: grid;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, color-mix(in oklab, var(--color-accent) 18%, var(--color-surface-1)), var(--color-surface-1));
}
.team-verdict-kicker { margin: 0; color: var(--color-accent-text); font: var(--type-caption); font-weight: 700; letter-spacing: .12em; }
.team-verdict-text { color: var(--color-text-primary); font: var(--type-h3); }
.team-verdict-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.team-diagnosis { padding-top: var(--space-2); border-top: 1px solid var(--color-border-subtle); }
.team-diagnosis h3 { margin: 0 0 var(--space-1); color: var(--color-text-secondary); font: var(--type-caption); font-weight: 700; }
.team-verdict-tags li { padding: var(--space-1) var(--space-2); border-radius: var(--radius-full); background: var(--color-surface-2); color: var(--color-text-secondary); font: var(--type-caption); }
.team-timeline { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.team-timeline-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-3); padding-inline-start: var(--space-3); border-inline-start: 2px solid var(--color-border-subtle); }
.team-timeline .team-time { align-self: start; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-2); color: var(--color-accent-text); font: var(--type-caption); font-variant-numeric: tabular-nums; font-weight: 700; white-space: nowrap; }
.team-timeline .team-time.is-unknown { color: var(--color-text-secondary); }
.team-timeline-body { min-width: 0; }
.team-timeline-body h4 { margin: 0 0 var(--space-1); color: var(--color-text-primary); font: var(--type-h3); }
.team-view-2d { min-height: var(--control-h-sm); margin-top: var(--space-1); padding: 0; border: 0; background: none; color: var(--color-accent-text); font: var(--type-caption); font-weight: 600; cursor: pointer; }
.team-view-2d:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
</style>
