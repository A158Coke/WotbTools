<script setup>
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import technicalEvolutionSource from '../../../docs/architecture/TECHNICAL_EVOLUTION.md?raw'

const markdown = new MarkdownIt({ html: false, linkify: true })
const renderedTechnicalEvolution = DOMPurify.sanitize(markdown.render(technicalEvolutionSource))
</script>

<template>
  <article class="technical-evolution-page">
    <div class="technical-evolution-markdown" v-html="renderedTechnicalEvolution"></div>
  </article>
</template>

<style scoped>
.technical-evolution-page { max-width: 1120px; margin: 0 auto; padding: 22px 24px 56px; }
.technical-evolution-markdown { color: var(--text-muted); line-height: 1.72; }
.technical-evolution-markdown :deep(h1),
.technical-evolution-markdown :deep(h2),
.technical-evolution-markdown :deep(h3) { color: var(--text-heading); line-height: 1.3; }
.technical-evolution-markdown :deep(h1) { font-size: 1.55rem; margin: 8px 0 20px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.technical-evolution-markdown :deep(h2) { font-size: 1.15rem; margin: 30px 0 12px; }
.technical-evolution-markdown :deep(h3) { font-size: 1rem; margin: 24px 0 10px; }
.technical-evolution-markdown :deep(p),
.technical-evolution-markdown :deep(ul),
.technical-evolution-markdown :deep(ol),
.technical-evolution-markdown :deep(table),
.technical-evolution-markdown :deep(pre) { margin: 10px 0; }
.technical-evolution-markdown :deep(table) { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
.technical-evolution-markdown :deep(th),
.technical-evolution-markdown :deep(td) { padding: 8px 10px; border: 1px solid var(--border); text-align: left; }
.technical-evolution-markdown :deep(code) { font-size: .88em; }
.technical-evolution-markdown :deep(pre) { overflow-x: auto; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
.technical-evolution-markdown :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 28px 0; }
@media (width < 768px) {
  .technical-evolution-page { padding: 14px 12px 44px; }
  .technical-evolution-markdown :deep(h1) { font-size: 1.35rem; }
}
</style>
