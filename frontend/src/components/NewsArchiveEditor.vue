<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NewsArticle, NewsCategory, NewsCreateRequest, NewsDraft } from '../api/game-announcements.js'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import Banner from './Banner.vue'
import NewsContent from './NewsContent.vue'
import NewsArticleContent from './NewsArticleContent.vue'

const props = withDefaults(defineProps<{ articles: NewsArticle[]; categories: NewsCategory[]; busy: boolean; errorText: string; available?: boolean; unavailableMessage?: string }>(), { available: true, unavailableMessage: '' })
const emit = defineEmits<{ close: []; save: [value: NewsCreateRequest] }>()
const defaults = () => props.categories.filter(value => value.type === 'GENERAL' && value.name === '版本更新').map(value => value.id)
const mode = ref<'merge' | 'separate'>('merge'), version = ref(''), title = ref(props.articles[0]?.title ?? '')
const categoryIds = ref<number[]>(defaults())
const entries = ref(props.articles.map(article => ({ article, title: article.title, version: '', categoryIds: defaults(), blockIds: article.blocks.map(block => block.id) })))
const preview = ref(false), invalid = ref(false), pending = ref<NewsCreateRequest | null>(null)
const locked = computed(() => props.busy || pending.value !== null)
const selection = (entry: typeof entries.value[number]) => ({ sourceKey: entry.article.sourceKey, revision: entry.article.revision, blockIds: entry.article.blocks.filter(block => entry.blockIds.includes(block.id)).map(block => block.id) })
const drafts = computed<NewsDraft[]>(() => mode.value === 'merge'
  ? [{ version: version.value.trim(), title: title.value.trim(), categoryIds: [...categoryIds.value], articles: entries.value.map(selection) }]
  : entries.value.map(entry => ({ version: entry.version.trim(), title: entry.title.trim(), categoryIds: [...entry.categoryIds], articles: [selection(entry)] })))
const valid = computed(() => drafts.value.length > 0 && drafts.value.length <= 10 && drafts.value.every(draft => draft.version && draft.title
  && draft.categoryIds.length <= 30
  && draft.articles.every(article => article.blockIds.length > 0)
  && props.categories.filter(category => category.type === 'SPECIALIZED' && draft.categoryIds.includes(category.id)).length <= 1))
const signature = computed(() => JSON.stringify(drafts.value))
watch(signature, () => { preview.value = false; invalid.value = false })
function move(index: number, delta: number) {
  const target = index + delta
  if (locked.value || target < 0 || target >= entries.value.length) return
  const [entry] = entries.value.splice(index, 1); entries.value.splice(target, 0, entry)
}
function selectedArticle(entry: typeof entries.value[number]) {
  return { ...entry.article, blocks: entry.article.blocks.filter(block => entry.blockIds.includes(block.id)) }
}
function showPreview() { invalid.value = !valid.value; if (valid.value) preview.value = true }
function submit() {
  if (!valid.value || props.busy || !props.available || !preview.value) return
  pending.value ??= { idempotencyKey: crypto.randomUUID(), archives: JSON.parse(signature.value) as NewsDraft[] }
  emit('save', pending.value)
}
</script>

<template>
  <AppDialog :open="true" :title="$t('news.reviewTitle')" size="lg" :close-on-scrim="false" @close="!busy && emit('close')">
    <div class="news-editor">
      <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner>
      <Banner v-if="!available" tone="warning">{{ unavailableMessage }}</Banner>
      <Banner v-if="invalid" tone="danger">{{ $t('news.reviewInvalid') }}</Banner>
      <Banner v-if="pending" tone="info">{{ $t('news.submissionLocked') }}</Banner>
      <p>{{ $t('news.selectionHelp') }}</p>
      <fieldset :disabled="locked" class="news-fields">
        <legend>{{ $t('news.archiveMode') }}</legend>
        <label><input v-model="mode" type="radio" value="merge"> {{ $t('news.merge') }}</label>
        <label><input v-model="mode" type="radio" value="separate"> {{ $t('news.separate') }}</label>
        <template v-if="mode === 'merge'">
          <label>{{ $t('news.version') }}<input v-model="version" maxlength="80" data-testid="news-merge-version"></label>
          <label>{{ $t('news.archiveTitle') }}<input v-model="title" maxlength="300" data-testid="news-merge-title"></label>
          <fieldset class="news-categories">
            <legend>{{ $t('news.categories') }}</legend>
            <label v-for="category in categories" :key="category.id"><input v-model="categoryIds" type="checkbox" :value="category.id"> {{ category.name }} · {{ $t(`news.categoryType.${category.type}`) }}</label>
          </fieldset>
        </template>
      </fieldset>
      <p>{{ $t('news.categoryRules') }}</p>
      <section v-for="(entry, index) in entries" :key="entry.article.sourceKey" class="news-entry">
        <header class="news-entry-heading">
          <h3>{{ index + 1 }}. {{ entry.article.title }}</h3>
          <div v-if="mode === 'merge'" class="news-actions">
            <AppButton :disabled="locked || index === 0" :aria-label="$t('news.moveUpArticle', { title: entry.article.title })" @click="move(index, -1)">{{ $t('news.moveUp') }}</AppButton>
            <AppButton :disabled="locked || index === entries.length - 1" :aria-label="$t('news.moveDownArticle', { title: entry.article.title })" @click="move(index, 1)">{{ $t('news.moveDown') }}</AppButton>
          </div>
        </header>
        <fieldset :disabled="locked" class="news-fields">
          <legend>{{ $t('news.articleSelection') }}</legend>
          <template v-if="mode === 'separate'">
            <label>{{ $t('news.version') }}<input v-model="entry.version" maxlength="80"></label>
            <label>{{ $t('news.archiveTitle') }}<input v-model="entry.title" maxlength="300"></label>
            <fieldset class="news-categories"><legend>{{ $t('news.categories') }}</legend>
              <label v-for="category in categories" :key="category.id"><input v-model="entry.categoryIds" type="checkbox" :value="category.id"> {{ category.name }} · {{ $t(`news.categoryType.${category.type}`) }}</label>
            </fieldset>
          </template>
          <div class="news-actions">
            <AppButton :disabled="locked" @click="entry.blockIds = entry.article.blocks.map(block => block.id)">{{ $t('news.selectAll') }}</AppButton>
            <AppButton :disabled="locked" @click="entry.blockIds = []">{{ $t('news.clearSelection') }}</AppButton>
          </div>
          <div v-for="(block, blockIndex) in entry.article.blocks" :key="block.id" class="news-block">
            <label><input v-model="entry.blockIds" type="checkbox" :value="block.id" :data-testid="`news-block-${index}-${blockIndex}`"> {{ $t('news.blockNumber', { number: blockIndex + 1 }) }}</label>
            <NewsContent :html="block.html" />
          </div>
        </fieldset>
      </section>
      <AppButton v-if="!preview" :disabled="busy" @click="showPreview">{{ $t('news.preview') }}</AppButton>
      <section v-if="preview" class="news-preview" data-testid="news-final-preview">
        <h2>{{ $t('news.finalPreview') }}</h2>
        <p>{{ $t('news.freezeNotice') }}</p>
        <template v-if="mode === 'merge'">
          <h3>{{ title }} · {{ version }}</h3>
          <p>{{ categories.filter(category => categoryIds.includes(category.id)).map(category => category.name).join(' · ') }}</p>
        </template>
        <div v-for="entry in entries" :key="entry.article.sourceKey">
          <template v-if="mode === 'separate'">
            <h3>{{ entry.title }} · {{ entry.version }}</h3>
            <p>{{ categories.filter(category => entry.categoryIds.includes(category.id)).map(category => category.name).join(' · ') }}</p>
          </template>
          <NewsArticleContent :article="selectedArticle(entry)" />
        </div>
      </section>
    </div>
    <template #actions>
      <AppButton :disabled="busy" @click="emit('close')">{{ $t('news.close') }}</AppButton>
      <AppButton v-if="preview" variant="primary" :disabled="busy || !available || !valid" data-testid="news-submit" @click="submit">{{ pending ? $t('news.retrySubmission') : $t('news.confirmArchive') }}</AppButton>
    </template>
  </AppDialog>
</template>

<style scoped>
.news-editor, .news-fields, .news-entry, .news-preview { display: grid; gap: var(--space-4); min-width: 0; }
.news-fields, .news-categories { border: var(--border-width) solid var(--color-border-subtle); padding: var(--space-3); border-radius: var(--radius-md); }
.news-fields label, .news-categories label { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-height: var(--control-h-lg); }
.news-fields input:not([type="checkbox"], [type="radio"]) { flex: 1; min-width: 0; min-height: var(--control-h-lg); padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); }
.news-fields input[type="checkbox"], .news-fields input[type="radio"] { width: var(--control-check); height: var(--control-check); }
.news-entry-heading, .news-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.news-entry-heading h3 { flex: 1; font: var(--type-h3); }
.news-block { border-top: var(--border-width) solid var(--color-border-subtle); padding-top: var(--space-3); min-width: 0; }
.news-preview { border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md); padding: var(--space-4); }
</style>
