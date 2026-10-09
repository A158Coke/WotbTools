<script setup>
// 长文档页（项目历史 / 技术演进，审计 PG-14：手机上约 26 屏、没有目录）。
// 从 Markdown 的二级标题生成目录：桌面为右侧吸顶目录并高亮当前章节；平板 / 手机为顶部可折叠目录；附「回到顶部」。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { ArrowUp, ListTree } from 'lucide-vue-next'

const props = defineProps({
  source: { type: String, required: true },
})

const markdown = new MarkdownIt({ html: false, linkify: true })

/** 渲染并给每个二级标题编号锚点（标题多为中文，用序号比 slug 稳定） */
const doc = computed(() => {
  const tokens = markdown.parse(props.source, {})
  const toc = []
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open' && token.tag === 'h2') {
      const id = `section-${toc.length + 1}`
      token.attrSet('id', id)
      toc.push({ id, title: tokens[index + 1]?.content || '' })
    }
  })
  const html = DOMPurify.sanitize(markdown.renderer.render(tokens, markdown.options, {}), { ADD_ATTR: ['id'] })
  return { html, toc }
})

const activeId = ref('')
const showBackToTop = ref(false)
let observer = null
const body = ref(null)

function onScroll() {
  showBackToTop.value = window.scrollY > window.innerHeight
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  if (typeof IntersectionObserver !== 'function' || !body.value) return
  // 视口上部 30% 内最靠上的章节标题 = 当前章节
  observer = new IntersectionObserver((entries) => {
    const visible = entries.filter(entry => entry.isIntersecting).map(entry => entry.target.id)
    if (visible.length) activeId.value = visible[0]
  }, { rootMargin: '0px 0px -70% 0px' })
  body.value.querySelectorAll('h2[id]').forEach(heading => observer.observe(heading))
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  observer?.disconnect()
})
</script>

<template>
  <div class="doc-page layout-wide" :class="{ 'has-toc': doc.toc.length > 1 }">
    <details v-if="doc.toc.length > 1" class="doc-toc-compact" data-testid="doc-toc-compact">
      <summary><ListTree :size="16" aria-hidden="true" />{{ $t('doc.toc') }}</summary>
      <!-- 点了某一章就收起目录，让正文回到视野 -->
      <ol class="doc-toc-list" @click="$event.target.closest('a') && ($event.currentTarget.closest('details').open = false)">
        <li v-for="item in doc.toc" :key="item.id"><a :href="`#${item.id}`">{{ item.title }}</a></li>
      </ol>
    </details>

    <article ref="body" class="doc-body" v-html="doc.html"></article>

    <nav v-if="doc.toc.length > 1" class="doc-toc" :aria-label="$t('doc.toc')" data-testid="doc-toc">
      <p class="doc-toc-title">{{ $t('doc.toc') }}</p>
      <ol class="doc-toc-list">
        <li v-for="item in doc.toc" :key="item.id">
          <a :href="`#${item.id}`" :class="{ 'is-active': activeId === item.id }" :aria-current="activeId === item.id ? 'location' : undefined">{{ item.title }}</a>
        </li>
      </ol>
    </nav>

    <button v-if="showBackToTop" type="button" class="doc-top" data-testid="doc-back-to-top" :aria-label="$t('doc.back_to_top')" :title="$t('doc.back_to_top')" @click="scrollToTop">
      <ArrowUp :size="20" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.doc-page {
  display: grid;
  max-width: calc(var(--reading-measure) * 4 / 3 + var(--gutter) * 2);
  gap: var(--space-6);
  color: var(--color-text-secondary);
}

.doc-page.has-toc { grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); }

.doc-body { min-width: 0; padding: var(--space-6); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); font: var(--type-body); line-height: var(--line-height-prose); overflow-wrap: anywhere; }
.doc-body :deep(h1),
.doc-body :deep(h2),
.doc-body :deep(h3) { color: var(--color-text-primary); scroll-margin-top: calc(var(--header-h) + var(--space-4)); }
.doc-body :deep(h1) { margin: var(--space-2) 0 var(--space-5); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border-subtle); font: var(--type-h1); }
.doc-body :deep(h2) { margin: var(--space-8) 0 var(--space-3); font: var(--type-h2); }
.doc-body :deep(h3) { margin: var(--space-6) 0 var(--space-2); font: var(--type-h3); }
.doc-body :deep(p),
.doc-body :deep(ul),
.doc-body :deep(ol) { margin: var(--space-2) 0; }
.doc-body :deep(a) { color: var(--color-accent-text); }
.doc-body :deep(ul), .doc-body :deep(ol) { padding-inline-start: var(--space-6); }
.doc-body :deep(blockquote) { margin: var(--space-4) 0; padding: var(--space-2) var(--space-4); border-inline-start: var(--space-1) solid var(--color-border-strong); background: var(--color-surface-2); }
.doc-body :deep(pre) { max-width: 100%; overflow-x: auto; margin: var(--space-4) 0; padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-2); }
.doc-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; margin: var(--space-4) 0; border-collapse: collapse; }
.doc-body :deep(th), .doc-body :deep(td) { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border-subtle); text-align: start; }
.doc-body :deep(th) { color: var(--color-text-primary); background: var(--color-surface-2); }
.doc-body :deep(img) { max-width: 100%; height: auto; }
.doc-body :deep(code) { font-family: var(--font-family-mono); font-size: var(--font-size-caption); }
.doc-body :deep(hr) { margin: var(--space-6) 0; border: 0; border-top: 1px solid var(--color-border-subtle); }

.doc-toc {
  position: sticky;
  top: calc(var(--header-h) + var(--space-4));
  align-self: start;
  max-height: calc(100dvh - var(--header-h) - var(--space-8));
  padding-inline-start: var(--space-3);
  overflow-y: auto;
  border-inline-start: 1px solid var(--color-border-subtle);
}

.doc-toc-title { margin: 0 0 var(--space-2); color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
.doc-toc-list { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.doc-toc-list a {
  display: block;
  padding: var(--space-2);
  min-height: var(--control-h-md);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font: var(--type-caption);
  text-decoration: none;
}
.doc-toc-list a.is-active { background: var(--color-surface-2); color: var(--color-accent-text); font-weight: 600; }
.doc-toc-list a:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

.doc-toc-compact { display: none; }

.doc-top {
  position: fixed;
  right: var(--gutter);
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--space-4));
  z-index: var(--z-sticky);
  display: inline-grid;
  place-items: center;
  width: var(--control-h-lg);
  height: var(--control-h-lg);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
  color: var(--color-text-primary);
  cursor: pointer;
}
.doc-top:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .doc-toc-list a:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}

/* 平板 / 手机：目录收进顶部可折叠块，正文占满 */
@media (width < 1200px) {
  .doc-page.has-toc { grid-template-columns: minmax(0, 1fr); }
  .doc-toc { display: none; }
  .doc-toc-compact {
    display: block;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .doc-toc-compact summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h-md);
    color: var(--color-text-primary);
    font: var(--type-body);
    font-weight: 600;
    cursor: pointer;
  }
  .doc-toc-compact .doc-toc-list { max-height: 50dvh; margin-top: var(--space-2); overflow-y: auto; }
}
@media (width < 768px) { .doc-body { padding: var(--space-4); } }
</style>
