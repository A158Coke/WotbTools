<script setup lang="ts">
import { computed } from 'vue'
import type { NewsArticle } from '../api/game-announcements.js'
import { newsImagePath } from '../api/game-announcements.js'
import NewsContent from './NewsContent.vue'
const props = withDefaults(defineProps<{ article: NewsArticle; archived?: boolean; managed?: boolean; archiveId?: number; preparing?: boolean }>(), { archived: false, managed: false, preparing: false })
const html = computed(() => (props.article.coverImageId ? `<img src="${newsImagePath(props.article.coverImageId, props.archived && !props.preparing)}" alt="">` : '') + props.article.blocks.map(block => block.html).join('\n'))
const sourceUrl = computed(() => /^https:\/\//i.test(props.article.sourceUrl) ? props.article.sourceUrl : '')
</script>
<template>
  <article class="news-article" :lang="article.language">
    <h2>{{ article.title }}</h2>
    <div class="news-byline">
      <span>{{ $t('news.language') }}: {{ article.language }}</span>
      <span v-if="article.publishedAtRaw">{{ $t('news.originalTime') }}: {{ article.publishedAtRaw }}</span>
      <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer">{{ $t('news.original') }}</a>
    </div>
    <NewsContent :html="html" :managed="managed" :archive-id="archiveId" />
  </article>
</template>
<style scoped>
.news-article { min-width: 0; overflow-wrap: anywhere; }
.news-article h2 { font: var(--type-h2); }
.news-byline { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-4); color: var(--color-text-secondary); font: var(--type-caption); }
.news-byline a { color: var(--color-accent-text); }
</style>
