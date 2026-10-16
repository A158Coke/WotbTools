<script setup lang="ts">
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

const { t, te } = useI18n()
const { categoryId, categories, creators, favoriteIds, pendingIds, favoritesReady, signedIn, adminAllowed,
  network, loading, error, favoriteError, refresh, refreshFavorites, toggleFavorite, selectCategory } = useCreators()
const management = useCreatorManagement({ onChanged: refresh })
const { detail, editorOpen, editorLoading, editorError, busy, error: adminError, categories: adminCategories, levels, settings, notice } = management
async function remove(id: number) {
  const signal = management.operationSignal()
  const accepted = await confirm({ title: t('creators.removeConfirm'), confirmLabel: t('creators.remove'), danger: true, signal })
  if (accepted && !signal.aborted) await management.remove(id)
}
</script>

<template>
  <div class="creators-page layout-content" data-testid="creators-page">
    <PageHeader :title="t('creators.title')"><template #actions><AppButton :disabled="loading || busy || !network.available" @click="refresh">{{ t('creators.refresh') }}</AppButton></template></PageHeader>
    <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <Banner v-if="favoriteError" tone="danger">{{ apiErrorLabel(t, te, favoriteError) }} <AppButton :disabled="!network.available" @click="refreshFavorites">{{ t('creators.retry') }}</AppButton></Banner>
    <Banner v-if="adminError" tone="danger">{{ apiErrorLabel(t, te, adminError) }}</Banner>
    <Banner v-if="notice" role="status">{{ t('creators.' + notice) }}</Banner>
    <nav class="creator-category-grid" :aria-label="t('creators.categories')">
      <AppButton :aria-pressed="categoryId === null" data-testid="creator-category-all" @click="selectCategory(null)">{{ t('creators.allCategories') }}</AppButton>
      <AppButton v-for="category in categories" :key="category.id" :aria-pressed="categoryId === category.id" :data-testid="`creator-filter-${category.id}`" @click="selectCategory(category.id)">{{ category.name }}</AppButton>
    </nav>
    <p v-if="loading || network.pending" role="status">{{ t('creators.loading') }}</p>
    <p v-else-if="!error && network.available && !creators.length" class="creator-muted">{{ t('creators.empty') }}</p>
    <div class="creator-grid"><CreatorCard v-for="creator in creators" :key="creator.id" :creator="creator" :favorite="favoriteIds.has(creator.id)" :pending="pendingIds.has(creator.id)" :favorite-disabled="!network.available || (signedIn && !favoritesReady)" :admin="adminAllowed" :admin-disabled="busy || !network.available" @favorite="toggleFavorite(creator.id)" @edit="management.editCreator(creator.id)" @remove="remove(creator.id)" /></div>
    <AppDialog :open="editorOpen" :title="t('creators.edit')" size="lg" :close-on-scrim="false" data-testid="creator-editor-dialog" @close="management.closeEditor">
      <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
      <p v-if="editorLoading" role="status">{{ t('creators.loading') }}</p>
      <Banner v-if="editorError" tone="danger">{{ apiErrorLabel(t, te, editorError) }}</Banner>
      <CreatorForm v-if="detail && !editorLoading" :key="detail.id" :detail="detail" :categories="adminCategories" :levels="levels" :busy="busy || !network.available" :avatar-uploads-available="settings?.avatarUploadsAvailable ?? false" :save="value => management.save(value, true)" @saved="management.finishSave(true)" />
      <template #actions><AppButton v-if="editorError && !detail" :disabled="busy || editorLoading || !network.available" data-testid="creator-editor-retry" @click="management.retryEditor">{{ t('creators.retry') }}</AppButton><AppButton :disabled="busy" @click="management.closeEditor">{{ t('creators.cancel') }}</AppButton></template>
    </AppDialog>
  </div>
</template>
