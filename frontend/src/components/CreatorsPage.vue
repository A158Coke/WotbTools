<script setup lang="ts">
import { computed, ref, useId, watch, onScopeDispose } from 'vue'
import type { LocationQueryRaw } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import type { RecommendationType } from '../api/creators.js'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCreators } from '../composables/useCreators.js'
import { useCreatorManagement } from '../composables/useCreatorManagement.js'
import { confirm } from '../composables/useConfirm.js'
import { apiErrorLabel } from '../utils/display.js'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import Banner from './Banner.vue'
import CreatorCard from './CreatorCard.vue'
import CreatorForm from './CreatorForm.vue'
import './creators.css'

const props = withDefaults(defineProps<{ type?: RecommendationType }>(), { type: 'UP' })
const video = computed(() => props.type === 'VIDEO')
const route = useRoute(), router = useRouter(), editorDirty = ref(false)
const { t, te } = useI18n()
const { categoryId, categories: publicCategories, creators, adminAllowed,
  network, loading, error, refresh, selectCategory } = useCreators({ type: () => props.type })
const categoriesExpanded = ref(categoryId.value !== null)
const categoryPanelId = `creator-categories-${useId()}`
const selectedCategoryLabel = computed(() => {
  const category = categories.value.find(value => value.id === categoryId.value)
  return category ? t('creators.selectedCategory', { name: category.name }) : t('creators.currentFilter')
})
watch(() => props.type, () => { categoriesExpanded.value = categoryId.value !== null })
watch(categoryId, id => { if (id !== null) categoriesExpanded.value = true })
function toggleCategories(event: MouseEvent) {
  categoriesExpanded.value = !categoriesExpanded.value
  if (!categoriesExpanded.value) (event.currentTarget as HTMLButtonElement).focus()
}
const management = useCreatorManagement({ type: () => props.type, onChanged: refresh })
const { detail, editorOpen, editorLoading, editorError, busy, loading: adminLoading, error: adminError, categories: adminCategories, levels, avatarUploadsAvailable, notice } = management
watch([editorOpen, detail], () => { editorDirty.value = false })
async function closeEditor() {
  if (busy.value) return
  if (editorDirty.value && !await confirm({ title: t('creators.discardDraft'), confirmLabel: t('creators.discard'), danger: true, signal: management.operationSignal() })) return
  editorDirty.value = false; management.closeEditor()
}
const removeGuard = router.beforeEach(async (to, from) => {
  if (to.query.view === from.query.view || !editorOpen.value) return true
  if (busy.value) return false
  if (!editorDirty.value) return true
  return confirm({ title: t('creators.discardDraft'), confirmLabel: t('creators.discard'), danger: true, signal: management.operationSignal() })
})
onScopeDispose(removeGuard)
function backToTypes() { const query: LocationQueryRaw = { ...route.query, view: 'recommendations' }; delete query.creatorCategory; return router.push({ path: route.path, query, hash: route.hash }) }
const categories = computed(() => adminAllowed.value ? adminCategories.value : publicCategories.value)
async function refreshPage() {
  await Promise.all([refresh(), management.refresh()])
}
async function remove(id: number, expectedVersion: number) {
  const signal = management.operationSignal()
  const accepted = await confirm({ title: t(video.value ? 'creators.removeVideoConfirm' : 'creators.removeConfirm'), confirmLabel: t('creators.remove'), danger: true, signal })
  if (accepted && !signal.aborted) await management.remove(id, expectedVersion)
}
</script>

<template>
  <div class="creators-page layout-content" data-testid="creators-page">
    <PageHeader :title="t(video ? 'creators.videosTitle' : 'creators.title')"><template #actions><AppButton data-testid="recommendations-back" @click="backToTypes">{{ t('creators.backToTypes') }}</AppButton><AppButton :disabled="loading || adminLoading || editorLoading || busy || !network.available" data-testid="creator-refresh" @click="refreshPage">{{ t('creators.refresh') }}</AppButton></template></PageHeader>
    <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <Banner v-if="adminError" tone="danger">{{ apiErrorLabel(t, te, adminError) }}</Banner>
    <Banner v-if="notice" role="status">{{ t('creators.' + notice) }}</Banner>
    <nav class="creator-filters" :aria-label="t('creators.categories')">
      <div class="creator-filter-bar">
        <AppButton :aria-pressed="categoryId === null" data-testid="creator-category-all" @click="selectCategory(null)">{{ t('creators.allCategories') }}</AppButton>
        <AppButton v-if="categories.length" :aria-expanded="categoriesExpanded" :aria-controls="categoryPanelId" data-testid="creator-categories-toggle" @click="toggleCategories">
          {{ t(categoriesExpanded ? 'creators.collapseCategories' : 'creators.expandCategories') }}
          <component :is="categoriesExpanded ? ChevronDown : ChevronRight" :size="16" aria-hidden="true" />
        </AppButton>
        <span v-if="categoryId !== null && (!categoriesExpanded || !categories.length)" class="creator-filter-summary" data-testid="creator-selected-category">{{ selectedCategoryLabel }}</span>
      </div>
      <div v-if="categories.length" v-show="categoriesExpanded" :id="categoryPanelId" class="creator-category-grid" data-testid="creator-category-options">
        <AppButton v-for="category in categories" :key="category.id" :aria-pressed="categoryId === category.id" :data-testid="`creator-filter-${category.id}`" @click="selectCategory(category.id)">{{ category.name }}</AppButton>
      </div>
    </nav>
    <p v-if="loading || network.pending" role="status">{{ t('creators.loading') }}</p>
    <p v-else-if="!error && network.available && !creators.length" class="creator-muted">{{ t(video ? 'creators.videosEmpty' : 'creators.empty') }}</p>
    <div class="creator-grid"><CreatorCard v-for="creator in creators" :key="creator.id" :creator="creator" :admin="adminAllowed" :admin-disabled="busy || adminLoading || !network.available" @edit="management.editCreator(creator.id)" @remove="remove(creator.id, creator.version)" /></div>
    <AppDialog :open="editorOpen" :title="t(video ? 'creators.editVideo' : 'creators.edit')" size="lg" :close-on-scrim="false" data-testid="creator-editor-dialog" @close="closeEditor">
      <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
      <p v-if="editorLoading" role="status">{{ t('creators.loading') }}</p>
      <Banner v-if="editorError" tone="danger">{{ apiErrorLabel(t, te, editorError) }}</Banner>
      <CreatorForm v-if="detail && !editorLoading" :key="`${props.type}-${detail.id}`" :type="props.type" @dirty="editorDirty = $event" :detail="detail" :categories="adminCategories" :levels="levels" :busy="busy || adminLoading || !network.available" :avatar-uploads-available="avatarUploadsAvailable" :save="(value, avatar) => management.save(value, avatar, true)" @saved="management.finishSave(true)" />
      <template #actions><AppButton v-if="editorError" :disabled="busy || editorLoading || !network.available" :data-testid="detail ? 'creator-editor-reload' : 'creator-editor-retry'" @click="management.retryEditor">{{ t(detail ? 'creators.reloadEditor' : 'creators.retry') }}</AppButton><AppButton :disabled="busy" @click="closeEditor">{{ t('creators.cancel') }}</AppButton></template>
    </AppDialog>
  </div>
</template>
