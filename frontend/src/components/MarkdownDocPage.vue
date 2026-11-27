<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import { copyText } from '../utils/clipboard.js'
import { showToast } from '../composables/useToast.js'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { ArrowUp, ListTree } from 'lucide-vue-next'
import ShowcaseHero from './ShowcaseHero.vue'

const props = defineProps({
  source: { type: String, required: true },
  sectionHero: { type: Boolean, default: false },
})

const markdown = new MarkdownIt({ html: false, linkify: true })

const doc = computed(() => {
  const tokens = markdown.parse(props.source, {})
  const toc = []
  let title = ''
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'heading_open' && token.tag === 'h1' && !title) {
      title = tokens[index + 1]?.content || ''
      if (props.sectionHero) {
        tokens.splice(index, 3)
        index -= 1
        continue
      }
    }
    if (token.type === 'heading_open' && token.tag === 'h2') {
      const id = `section-${toc.length + 1}`
      token.attrSet('id', id)
      toc.push({ id, title: tokens[index + 1]?.content || '' })
    }
  }
  const html = DOMPurify.sanitize(markdown.renderer.render(tokens, markdown.options, {}), { ADD_ATTR: ['id'] })
  return { html, toc, title }
})

const activeId = ref('')
const activeTitle = computed(() => doc.value.toc.find(item => item.id === activeId.value)?.title || '')
const instance = getCurrentInstance()

function decorateCodeBlocks() {
  body.value?.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.doc-copy')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'doc-copy'
    button.textContent = instance.proxy.$t('doc.copy')
    pre.append(button)
  })
}

async function onBodyClick(event) {
  const button = event.target.closest?.('.doc-copy')
  if (!button) return
  const code = button.closest('pre')?.querySelector('code')?.textContent ?? ''
  if (await copyText(code)) showToast({ id: 'copy', tone: 'success', titleKey: 'toast.copied' })
}
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
  decorateCodeBlocks()
  if (typeof IntersectionObserver !== 'function' || !body.value) return
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
      <summary><ListTree :size="16" aria-hidden="true" />{{ $t('doc.toc') }}<span v-if="activeTitle" class="doc-toc-current"> · {{ activeTitle }}</span></summary>
      <ol class="doc-toc-list" @click="$event.target.closest('a') && ($event.currentTarget.closest('details').open = false)">
        <li v-for="item in doc.toc" :key="item.id"><a :href="`#${item.id}`">{{ item.title }}</a></li>
      </ol>
    </details>

    <ShowcaseHero v-if="sectionHero && doc.title" class="doc-hero" section="docs" :title="doc.title" />

    <div class="doc-main">
      <slot name="header" />
      <article ref="body" class="doc-body surface-glass-1" @click="onBodyClick" v-html="doc.html"></article>
    </div>

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
  --doc-measure: calc(var(--space-12) * 21);
}

/* 有目录时正文列贴左、目录贴右，分区页头横跨两列与全站分区页头同宽 */
.doc-page.has-toc {
  max-width: var(--layout-wide-max);
  grid-template-columns: minmax(0, var(--doc-measure)) calc(var(--space-12) * 5);
  justify-content: space-between;
}

.doc-hero { grid-column: 1 / -1; }
.doc-main { grid-column: 1; min-width: 0; }
.doc-body { min-width: 0; padding: var(--space-6); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-lg); font: var(--type-body); font-size: var(--font-size-doc); line-height: var(--line-height-doc); overflow-wrap: anywhere; }
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
.doc-body :deep(blockquote) { margin: var(--space-4) 0; padding: var(--space-2) var(--space-4); border-inline-start: var(--space-1) solid var(--color-accent); background: var(--color-surface-2); }
.doc-body :deep(pre) { position: relative; max-width: 100%; overflow-x: auto; margin: var(--space-4) 0; padding: var(--space-4); border-radius: var(--radius-md); background: var(--color-surface-2); }
.doc-body :deep(.doc-copy) { position: absolute; inset-block-end: var(--space-2); inset-inline-start: var(--space-2); min-height: var(--control-h-sm); padding: 0 var(--space-2); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-secondary); font: var(--type-caption); cursor: pointer; }
.doc-body :deep(.doc-copy:focus-visible) { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.doc-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; margin: var(--space-4) 0; border-collapse: collapse; background: var(--color-surface-1); }
.doc-body :deep(th), .doc-body :deep(td) { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border-subtle); text-align: start; }
.doc-body :deep(th) { color: var(--color-text-primary); background: var(--color-surface-2); }
.doc-body :deep(img) { max-width: 100%; height: auto; }
.doc-body :deep(code) { font-family: var(--font-family-mono); font-size: var(--font-size-caption); }
.doc-body :deep(hr) { margin: var(--space-6) 0; border: 0; border-top: 1px solid var(--color-border-subtle); }

.doc-toc {
  position: sticky;
  top: calc(var(--header-h) + var(--space-4));
  grid-column: 2;
  align-self: start;
  max-height: calc(100dvh - var(--header-h) - var(--space-8));
  padding-inline-start: var(--space-3);
  overflow-y: auto;
  /* 全页只保留窗口一个可见滚动条；目录超高时滚轮仍可滚动 */
  scrollbar-width: none;
  border-inline-start: 1px solid var(--color-border-strong);
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
  position: sticky;
  inset-block-end: calc(env(safe-area-inset-bottom) + var(--space-4));
  grid-column: 1 / -1;
  justify-self: end;
  margin-inline-end: var(--gutter);
  z-index: var(--z-sticky);
  display: inline-grid;
  place-items: center;
  width: var(--control-h-lg);
  height: var(--control-h-lg);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  corner-shape: round;
  background: var(--color-surface-3);
  box-shadow: var(--elevation-2);
  color: var(--color-text-primary);
  cursor: pointer;
}
.doc-top:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }

@media (hover: hover) {
  .doc-toc-list a:hover { background: var(--color-surface-2); color: var(--color-text-primary); }
}

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
  .doc-toc-current { min-width: 0; overflow: hidden; color: var(--color-text-secondary); font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
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
  .doc-toc-compact .doc-toc-list { max-height: 50dvh; margin-top: var(--space-2); overflow-y: auto; /* 全站滚动条视觉规范：隐藏指示器、保留滚动能力 */ scrollbar-width: none; }
}
@media (width < 768px) { .doc-body { padding: var(--space-4); } }
</style>
