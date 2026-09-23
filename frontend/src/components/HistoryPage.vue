<script setup>
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import historySource from '../../../HISTORY.md?raw'

const markdown = new MarkdownIt({ html: false, linkify: true })
const renderedHistory = DOMPurify.sanitize(markdown.render(historySource))
</script>

<template>
  <article class="history-page">
    <div class="history-markdown" v-html="renderedHistory"></div>
  </article>
</template>

<style scoped>
.history-page { max-width: 1120px; margin: 0 auto; padding: 22px 24px 56px; }
.history-markdown { color: var(--text-muted); line-height: 1.72; }
.history-markdown :deep(h1),
.history-markdown :deep(h2),
.history-markdown :deep(h3) { color: var(--text-heading); line-height: 1.3; }
.history-markdown :deep(h1) { font-size: 1.55rem; margin: 8px 0 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.history-markdown :deep(h2) { font-size: 1.15rem; margin: 30px 0 12px; }
.history-markdown :deep(h3) { font-size: 1rem; margin: 24px 0 10px; }
.history-markdown :deep(p),
.history-markdown :deep(ul) { margin: 10px 0; }
.history-markdown :deep(code) { font-size: .88em; }
.history-markdown :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
@media (width < 768px) {
  .history-page { padding: 14px 12px 44px; }
  .history-markdown :deep(h1) { font-size: 1.35rem; }
}
</style>
