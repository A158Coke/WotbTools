<script setup lang="ts">
import { inject } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import MarkdownDocPage from './MarkdownDocPage.vue'
// 构建期把 canonical Markdown 作为 raw 资源纳入独立 chunk（懒加载），
// 不维护第二份人工副本；文档正文唯一事实源始终是 docs/WotBTools_League_Rating_V6.md。
// 与项目历史 / 技术演进同一文档模板（目录 + 阅读排版）；正文按 CommonMark 渲染，源文件的硬换行不再变成 <br>。
import leagueRatingV6 from '../../../docs/WotBTools_League_Rating_V6.md?raw'

const navigate = inject<((view: string) => void) | null>(NAVIGATE_VIEW_KEY, null)

function goBack() {
  navigate?.('replay')
}
</script>

<template>
  <MarkdownDocPage class="rating-docs-page" :source="leagueRatingV6">
    <template #header>
      <header class="rating-docs-header">
        <button type="button" class="rating-docs-back" data-testid="docs-back-btn" @click="goBack">
          <ArrowLeft :size="16" aria-hidden="true" />{{ $t('league.docs_back') }}
        </button>
        <p class="rating-docs-sub">{{ $t('league.docs_page_sub') }}</p>
      </header>
    </template>
  </MarkdownDocPage>
</template>

<style scoped>
.rating-docs-header { display: grid; gap: var(--space-2); margin-block-end: var(--space-4); }
.rating-docs-back {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: var(--space-1);
  min-height: var(--control-h-md);
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-1);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  cursor: pointer;
}
.rating-docs-back:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.rating-docs-sub { margin: 0; color: var(--color-text-secondary); font: var(--type-caption); }

@media (hover: hover) {
  .rating-docs-back:hover { color: var(--color-text-primary); background: var(--color-surface-2); }
}
</style>
