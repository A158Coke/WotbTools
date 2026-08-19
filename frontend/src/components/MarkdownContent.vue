<script setup>
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { normalizeHeadings } from '../utils/markdownHeadingNormalize'
import { parseAiTime } from '../utils/battlePlayback'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

// Custom render for links: target="_blank" rel="noopener noreferrer"
const defaultRender = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options, env, self))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return defaultRender(tokens, idx, options, env, self)
}

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
})
const emit = defineEmits(['seek'])

/**
 * 把 AI 报告中的明确时间文本（03:20 / 3分20秒 / 3m 20s / 3 мин 20 с）转为
 * `#seek=<秒>` 链接，供战局回放跳转；普通数字（如比分 854:275）不会被误识别。
 */
function linkifyTimes(text) {
  return text.replace(
    /(^|[^a-zA-Z0-9])(\d{1,2}:\d{2}|\d{1,2}分\d{1,2}秒|\d{1,2}m ?\d{1,2}s|\d{1,2} ?мин\.? ?\d{1,2} ?с\.?)(?![a-zA-Z0-9])/gi,
    (match, prefix, time) => {
      const sec = parseAiTime(time)
      return sec == null ? match : `${prefix}[${time}](#seek=${sec})`
    }
  )
}

const sanitizedHtml = computed(() => {
  if (!props.content) return ''
  const normalized = normalizeHeadings(props.content)
  const raw = md.render(linkifyTimes(normalized))
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br',
      'ul', 'ol', 'li',
      'strong', 'em', 'b', 'i', 'u', 's',
      'blockquote',
      'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr',
      'a'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel']
  })
})

function onClick(event) {
  const anchor = event.target.closest && event.target.closest('a[href^="#seek="]')
  if (!anchor) return
  event.preventDefault()
  const sec = Number(anchor.getAttribute('href').slice('#seek='.length))
  if (Number.isFinite(sec)) {
    emit('seek', sec)
  }
}
</script>

<template>
  <div class="markdown-content" v-html="sanitizedHtml" @click="onClick" />
</template>

<style scoped>
.markdown-content {
  line-height: 1.7;
  font-size: .9rem;
  color: var(--text);
  word-wrap: break-word;
}
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3) {
  margin: 1em 0 .5em;
  color: var(--text-heading);
  font-weight: 700;
}
.markdown-content :deep(h1) { font-size: 1.15rem; }
.markdown-content :deep(h2) { font-size: 1.05rem; }
.markdown-content :deep(h3) { font-size: .95rem; }
.markdown-content :deep(p) { margin: 0 0 .6em; }
.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: .4em 0;
  padding-left: 1.5em;
}
.markdown-content :deep(li) { margin: .2em 0; }
.markdown-content :deep(strong) { font-weight: 700; color: var(--text-heading); }
.markdown-content :deep(em) { font-style: italic; }
.markdown-content :deep(blockquote) {
  margin: .6em 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent);
  background: var(--bg-card2);
  color: var(--text-label);
  font-size: .85rem;
}
.markdown-content :deep(code) {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: .82rem;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--bg-card2);
  color: var(--text-code);
}
.markdown-content :deep(pre) {
  margin: .6em 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-card2);
  border: 1px solid var(--border-light);
  overflow-x: auto;
}
.markdown-content :deep(pre code) {
  background: none;
  padding: 0;
  font-size: .8rem;
}
.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: .6em 0;
  font-size: .82rem;
}
.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 5px 8px;
  border: 1px solid var(--border);
  text-align: left;
}
.markdown-content :deep(th) {
  background: var(--bg-card2);
  color: var(--text-heading);
  font-weight: 700;
}
.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}
.markdown-content :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.markdown-content :deep(a:hover) {
  text-decoration: underline;
  color: var(--accent-hover);
}
</style>
