<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Newspaper } from 'lucide-vue-next'
import { useGameAnnouncements } from '../composables/useGameAnnouncements.js'
import * as api from '../api/game-announcements.js'
import { apiErrorLabel } from '../utils/display.js'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import EmptyState from './EmptyState.vue'
import SegmentedControl from './SegmentedControl.vue'
import NewsArticleContent from './NewsArticleContent.vue'
import NewsArchiveEditor from './NewsArchiveEditor.vue'

const { t, te } = useI18n(), state = reactive(useGameAnnouncements())
const editor = ref(false), categoryName = ref(''), categoryType = ref<api.NewsCategory['type']>('GENERAL'), filterVersion = ref(state.version)
const errorText = computed(() => state.error ? apiErrorLabel(t, te, state.error) : '')
const sync = computed(() => state.article?.sync ?? state.articlePage?.sync)
const unavailable = computed(() => !state.network.available)
const actionDisabled = computed(() => state.busy || state.loading || unavailable.value)
watch(() => state.editorEpoch, () => { editor.value = false })
watch(() => state.version, value => { filterVersion.value = value })
async function addCategory() {
  if (!categoryName.value.trim()) return
  if (await state.mutate(signal => api.createNewsCategory(categoryName.value.trim(), categoryType.value, signal))) categoryName.value = ''
}
function filter() { void state.navigate({ newsVersion: filterVersion.value.trim(), newsPage: null, newsArchive: null }) }
function manage(value: boolean) { void state.navigate({ newsManage: value ? '1' : null, newsArchive: null, newsPage: null }) }
</script>

<template>
  <div class="news-page layout-wide" data-testid="game-announcements-page">
    <PageHeader :title="$t('news.title')" :description="$t('news.description')" :icon="Newspaper" />
    <div class="news-toolbar">
      <AppButton disabled aria-current="true">{{ $t('news.wg') }}</AppButton>
      <AppButton disabled data-testid="news-lesta">{{ $t('news.lesta') }} · {{ $t('news.notAvailable') }}</AppButton>
    </div>
    <SegmentedControl :model-value="state.tab" :options="[{ value: 'latest', label: t('news.latest') }, { value: 'history', label: t('news.history') }]" :ariaLabel="$t('news.contentTabs')" wrap @update:model-value="state.switchTab" />
    <Banner v-if="unavailable" tone="warning">{{ $t(state.network.messageKey || 'featureOffline.news') }}</Banner>
    <Banner v-if="state.denied" tone="danger">{{ $t('news.adminRequired') }}</Banner>
    <Banner v-if="errorText && !editor" tone="danger">{{ errorText }}</Banner>
    <Banner v-if="state.notice" tone="info" role="status">{{ $t(`news.${state.notice}`) }}</Banner>
    <div class="news-toolbar">
      <AppButton :disabled="state.loading || state.busy || unavailable" @click="state.refresh">{{ $t('news.refresh') }}</AppButton>
      <span v-if="state.loading" role="status">{{ $t('news.loading') }}</span>
      <label v-if="state.allowed && state.tab === 'history'"><input type="checkbox" :checked="state.managed" :disabled="state.busy" @change="manage(($event.target as HTMLInputElement).checked)"> {{ $t('news.manageArchives') }}</label>
    </div>
    <section v-if="state.tab === 'latest' && sync" class="news-sync" aria-live="polite">
      <span>{{ $t(sync.stale ? 'news.syncStale' : 'news.syncCurrent') }}</span>
      <span v-if="sync.lastSuccessfulFetchAt">{{ $t('news.lastSync') }}: {{ sync.lastSuccessfulFetchAt }}</span>
      <span v-if="sync.nextRefreshAt">{{ $t('news.nextSync') }}: {{ sync.nextRefreshAt }}</span>
    </section>
    <form v-if="state.tab === 'history'" class="news-toolbar" @submit.prevent="filter">
      <label for="news-version-filter">{{ $t('news.version') }}</label>
      <input id="news-version-filter" v-model="filterVersion" maxlength="80" :placeholder="$t('news.allVersions')">
      <AppButton type="submit" :disabled="state.busy">{{ $t('news.search') }}</AppButton>
    </form>
    <div v-if="state.allowed && state.tab === 'latest'" class="news-selection">
      <strong>{{ $t('news.selectedCount', { count: state.selected.length }) }}</strong>
      <span v-for="item in state.selected" :key="item.sourceKey">{{ item.title }}</span>
      <AppButton variant="primary" :disabled="!state.selected.length || actionDisabled" data-testid="news-open-editor" @click="editor = true">{{ $t('news.reviewTitle') }}</AppButton>
    </div>
    <template v-if="!state.denied">
      <template v-if="state.article || state.archive">
        <AppButton :disabled="state.busy" @click="state.navigate({ newsArticle: null, newsArchive: null })">{{ $t('news.backToList') }}</AppButton>
        <NewsArticleContent v-if="state.article" :article="state.article" />
        <section v-if="state.archive" class="news-archive" data-testid="news-archive-detail">
          <h2>{{ state.archive.title }}</h2>
          <div class="news-toolbar">
            <span>{{ $t('news.version') }}: {{ state.archive.version }}</span>
            <span>{{ $t(`news.status.${state.archive.status}`) }}</span>
            <span v-for="category in state.archive.categories" :key="category.id" class="news-tag">{{ category.name }}</span>
          </div>
          <p>{{ $t('news.reviewedBy') }}: {{ state.archive.reviewedBy }} · {{ state.archive.createdAt }}</p>
          <Banner v-if="state.archive.errorCode" tone="danger">{{ te(`api_errors.${state.archive.errorCode}`) ? t(`api_errors.${state.archive.errorCode}`) : t('news.preparationFailed') }}</Banner>
          <div v-if="state.allowed && state.managed" class="news-toolbar">
            <AppButton v-if="state.archive.status === 'FAILED'" :disabled="actionDisabled" @click="state.act(state.archive, 'retry', t('news.retryConfirm'))">{{ $t('news.retry') }}</AppButton>
            <AppButton v-if="state.archive.status === 'PUBLISHED'" :disabled="actionDisabled" @click="state.act(state.archive, 'withdraw', t('news.withdrawConfirm'))">{{ $t('news.withdraw') }}</AppButton>
            <AppButton v-if="state.archive.status === 'WITHDRAWN'" :disabled="actionDisabled" @click="state.act(state.archive, 'restore', t('news.restoreConfirm'))">{{ $t('news.restore') }}</AppButton>
            <AppButton v-if="['WITHDRAWN', 'FAILED'].includes(state.archive.status)" variant="danger" :disabled="actionDisabled" @click="state.act(state.archive, 'delete', t('news.deleteConfirm'))">{{ $t('news.delete') }}</AppButton>
            <p v-if="state.archive.status === 'PREPARING'" role="status">{{ $t('news.preparingHelp') }}</p>
          </div>
          <NewsArticleContent v-for="item in state.archive.articles" :key="item.sourceKey" :article="item" archived :managed="state.managed" :archive-id="state.archive.id" :preparing="['PREPARING', 'FAILED'].includes(state.archive.status)" />
        </section>
      </template>
      <template v-else>
        <div v-if="state.tab === 'latest'" class="news-list">
          <article v-for="item in state.articlePage?.items ?? []" :key="item.sourceKey" class="news-card">
            <h2><button class="news-title-link" @click="state.navigate({ newsArticle: item.sourceKey })">{{ item.title }}</button></h2>
            <p>{{ item.language }} <span v-if="item.publishedAtRaw">· {{ item.publishedAtRaw }}</span></p>
            <AppButton v-if="state.allowed" :disabled="actionDisabled" :aria-pressed="state.selected.some(selected => selected.sourceKey === item.sourceKey)" @click="state.selectArticle(item.sourceKey)">{{ $t(state.selected.some(selected => selected.sourceKey === item.sourceKey) ? 'news.unselectArticle' : 'news.selectArticle') }}</AppButton>
          </article>
        </div>
        <div v-else class="news-list">
          <article v-for="item in state.archivePage?.items ?? []" :key="item.id" class="news-card">
            <h2><button class="news-title-link" @click="state.navigate({ newsArchive: item.id })">{{ item.title }}</button></h2>
            <p>{{ $t('news.version') }}: {{ item.version }} · {{ $t(`news.status.${item.status}`) }}</p>
            <div class="news-toolbar"><span v-for="category in item.categories" :key="category.id" class="news-tag">{{ category.name }}</span></div>
          </article>
        </div>
        <EmptyState v-if="!state.loading && !state.error && !state.total && !unavailable" :title="$t('news.empty')" :icon="Newspaper" />
        <nav class="news-toolbar" :aria-label="$t('news.pagination')">
          <AppButton :disabled="state.page <= 1 || actionDisabled" @click="state.navigate({ newsPage: state.page - 1 })">{{ $t('news.previous') }}</AppButton>
          <span>{{ $t('news.pageNumber', { number: state.page }) }}</span>
          <AppButton :disabled="state.page * 20 >= state.total || actionDisabled" @click="state.navigate({ newsPage: state.page + 1 })">{{ $t('news.next') }}</AppButton>
        </nav>
      </template>
    </template>
    <details v-if="state.allowed" class="news-category-manager">
      <summary>{{ $t('news.manageCategories') }}</summary>
      <p>{{ $t('news.categoryRules') }}</p>
      <form class="news-toolbar" @submit.prevent="addCategory">
        <label>{{ $t('news.categoryName') }}<input v-model="categoryName" maxlength="100" required></label>
        <label>{{ $t('news.categoryKind') }}<select v-model="categoryType"><option value="GENERAL">{{ $t('news.categoryType.GENERAL') }}</option><option value="SPECIALIZED">{{ $t('news.categoryType.SPECIALIZED') }}</option></select></label>
        <AppButton type="submit" :disabled="actionDisabled || !categoryName.trim()">{{ $t('news.addCategory') }}</AppButton>
      </form>
      <ul class="news-category-list">
        <li v-for="category in state.categories" :key="category.id"><span>{{ category.name }} · {{ $t(`news.categoryType.${category.type}`) }}</span><AppButton variant="danger" :disabled="actionDisabled" :aria-label="$t('news.deleteCategoryNamed', { name: category.name })" @click="state.removeCategory(category, t('news.deleteCategoryConfirm'))">{{ $t('news.delete') }}</AppButton></li>
      </ul>
    </details>
    <NewsArchiveEditor v-if="editor && state.allowed" :articles="state.selected" :categories="state.categories" :busy="state.busy" :available="state.network.available" :unavailable-message="$t(state.network.messageKey || 'featureOffline.news')" :error-text="errorText" @close="editor = false" @save="state.save" />
  </div>
</template>

<style scoped>
.news-page { display: grid; gap: var(--space-5); padding-block: var(--space-5); color: var(--color-text-primary); min-width: 0; }
.news-toolbar, .news-selection, .news-sync { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-width: 0; }
.news-toolbar label { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-height: var(--control-h-lg); }
.news-toolbar input:not([type="checkbox"]), .news-toolbar select { min-width: 0; max-width: 100%; min-height: var(--control-h-lg); padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); }
.news-toolbar input[type="checkbox"] { width: var(--control-check); height: var(--control-check); }
.news-sync { color: var(--color-text-secondary); font: var(--type-caption); }
.news-selection, .news-category-manager { padding: var(--space-4); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-2); }
.news-selection span { overflow-wrap: anywhere; }
.news-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.news-card { border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); padding: var(--space-4); min-width: 0; }
.news-card h2 { margin: 0; font: var(--type-h3); }
.news-title-link { padding: var(--space-2) 0; border: 0; background: transparent; color: var(--color-accent-text); font: inherit; text-align: start; overflow-wrap: anywhere; cursor: pointer; min-height: var(--control-h-lg); }
.news-title-link:focus-visible, .news-category-manager summary:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.news-tag { padding: var(--space-1) var(--space-2); background: var(--color-surface-3); border-radius: var(--radius-sm); font: var(--type-caption); }
.news-archive { display: grid; gap: var(--space-4); min-width: 0; }
.news-archive > h2 { font: var(--type-h2); }
.news-category-manager summary { cursor: pointer; min-height: var(--control-h-lg); font: var(--type-h3); }
.news-category-list { list-style: none; padding: 0; display: grid; gap: var(--space-2); }
.news-category-list li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
@media (width < 768px) { .news-list { grid-template-columns: minmax(0, 1fr); } }
</style>
