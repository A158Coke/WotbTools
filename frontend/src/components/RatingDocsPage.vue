<script setup>
import { inject } from 'vue'
import MarkdownContent from './MarkdownContent.vue'
// 构建期把 canonical Markdown 作为 raw 资源纳入独立 chunk（懒加载），
// 不维护第二份人工副本；文档正文唯一事实源始终是 docs/WotBTools_League_Rating_V5.md。
import leagueRatingV5 from '../../../docs/WotBTools_League_Rating_V5.md?raw'

const navigate = inject('navigate', null)

function goBack() {
  navigate && navigate('replay')
}
</script>

<template>
  <div class="rating-docs-page">
    <header class="rating-docs-header">
      <div class="rating-docs-heading">
        <h1 class="rating-docs-title">{{ $t('league.docs_page_title') }}</h1>
        <p class="rating-docs-sub">{{ $t('league.docs_page_sub') }}</p>
      </div>
      <button class="ghost sm rating-docs-back" data-testid="docs-back-btn" @click="goBack">
        &larr; {{ $t('league.docs_back') }}
      </button>
    </header>

    <article class="rating-docs-card">
      <MarkdownContent :content="leagueRatingV5" />
    </article>
  </div>
</template>

<style scoped>
.rating-docs-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 0 2px 14px;
  margin-bottom: 18px;
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
}
.rating-docs-heading { min-width: 0; }
.rating-docs-title {
  margin: 0 0 6px;
  font-size: 1.55rem;
  line-height: 1.15;
  letter-spacing: -.02em;
  color: #f2ede3;
}
.rating-docs-sub {
  margin: 0;
  font-size: .86rem;
  color: #a4a9a3;
  line-height: 1.55;
}
.rating-docs-back { flex: 0 0 auto; white-space: nowrap; }
.rating-docs-card {
  padding: 22px 26px 30px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  box-shadow: var(--surface-shadow);
  overflow-x: auto;
}

@media (max-width: 767px) {
  .rating-docs-header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .rating-docs-back { align-self: flex-start; }
  .rating-docs-card { padding: 14px 14px 22px; }
}
</style>
