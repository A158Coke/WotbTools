<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import DOMPurify from 'dompurify'
import { getManagedNewsImage, newsImageUrl } from '../api/game-announcements.js'
import { useAuth } from '../composables/useAuth.js'

const props = withDefaults(defineProps<{ html: string; managed?: boolean; archiveId?: number }>(), { managed: false })
const auth = useAuth(), rendered = ref(''), imageFailed = ref(false)
let generation = 0, controller = new AbortController(), urls: string[] = []
function clear() {
  generation++; controller.abort(); controller = new AbortController()
  for (const url of urls) URL.revokeObjectURL(url)
  urls = []; rendered.value = ''; imageFailed.value = false
}
watch([() => props.html, () => props.managed, () => props.archiveId, () => auth.tokenParsed.value?.sub, () => auth.isNewsAdmin.value], async () => {
  clear()
  const gen = generation, signal = controller.signal
  if (props.managed && !auth.isNewsAdmin.value) return
  const fragment = DOMPurify.sanitize(props.html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'figure', 'figcaption', 'img', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'sup', 'sub', 'blockquote', 'pre', 'code', 'hr', 'span', 'div'],
    ALLOWED_ATTR: ['src', 'alt', 'title', 'href', 'colspan', 'rowspan', 'scope', 'start'],
  })
  for (const link of fragment.querySelectorAll('a')) {
    if (!/^https?:\/\//i.test(link.getAttribute('href') || '')) link.removeAttribute('href')
    link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer')
  }
  const images = [...fragment.querySelectorAll('img')]
  const tasks = images.map(async image => {
    const path = image.getAttribute('src') || '', safe = newsImageUrl(path)
    image.removeAttribute('src')
    if (!safe) { image.remove(); return }
    image.setAttribute('loading', 'lazy')
    if (props.managed) {
      try {
        const sourceImage = path.startsWith('/api/news/source-images/')
        if (sourceImage && !props.archiveId) { imageFailed.value = true; return }
        const blob = await getManagedNewsImage(path.split('/').at(-1)!, signal, sourceImage ? props.archiveId : undefined)
        if (gen !== generation) return
        const url = URL.createObjectURL(blob); urls.push(url); image.setAttribute('src', url)
      } catch { if (gen === generation && !signal.aborted) imageFailed.value = true }
    } else image.setAttribute('src', safe)
  })
  // Publish only a fully sanitized fragment; managed images never expose a public fallback URL.
  await Promise.all(tasks)
  if (gen !== generation) return
  const container = document.createElement('div'); container.append(fragment); rendered.value = container.innerHTML
}, { immediate: true })
onScopeDispose(clear)
</script>

<template>
  <div class="news-content" v-html="rendered" />
  <p v-if="imageFailed" role="status" class="news-image-error">{{ $t('news.imageFailed') }}</p>
</template>

<style scoped>
.news-content { color: var(--color-text-primary); line-height: var(--line-height-prose); overflow-wrap: anywhere; min-width: 0; }
.news-content :deep(img) { max-width: 100%; height: auto; object-fit: contain; }
.news-content :deep(figure) { margin: var(--space-4) 0; }
.news-content :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.news-content :deep(th), .news-content :deep(td) { padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); }
.news-content :deep(a) { color: var(--color-accent-text); }
.news-content :deep(pre) { white-space: pre-wrap; }
.news-image-error { color: var(--color-danger); }
</style>
