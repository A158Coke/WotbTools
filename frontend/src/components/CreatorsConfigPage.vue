<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCreatorAvailability } from '../composables/useCreatorAvailability.js'
import type { RecommendationType } from '../api/creators.js'
import { useI18n } from 'vue-i18n'
import { useCreatorManagement } from '../composables/useCreatorManagement.js'
import { useAuth } from '../composables/useAuth.js'
import { confirm } from '../composables/useConfirm.js'
import { apiErrorLabel } from '../utils/display.js'
import { creatorNameValid } from '../api/creators.js'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import CreatorForm from './CreatorForm.vue'
import './creators.css'

const route = useRoute(), router = useRouter(), availability = useCreatorAvailability()
const type = computed<RecommendationType>(() => route.query.recommendationType === 'VIDEO' ? 'VIDEO' : 'UP')
const typeSupported = computed(() => availability.typeAvailable(type.value))
const formDirty = ref(false)
const { t, te } = useI18n(), management = useCreatorManagement({ type })
const { network, allowed, categories, levels, avatarUploadsAvailable, metadataLoaded, loading, busy, error, notice, draftEpoch } = management
const categoryName = ref(''), levelName = ref(''), dictionaryInvalid = ref(false)
const { authenticated, tokenParsed } = useAuth()
watch([type, authenticated, () => tokenParsed.value?.sub, allowed], () => { categoryName.value = ''; levelName.value = ''; dictionaryInvalid.value = false; formDirty.value = false })
const removeGuard = router.beforeEach(async (to, from) => {
  if (to.fullPath === from.fullPath || (to.query.view === 'creators-config' && (to.query.recommendationType === 'VIDEO' ? 'VIDEO' : 'UP') === type.value)) return true
  if (busy.value) return false
  if (!formDirty.value && !categoryName.value.trim() && !levelName.value.trim()) return true
  return confirm({ title: t('creators.discardDraft'), confirmLabel: t('creators.discard'), danger: true, signal: management.operationSignal() })
})
onScopeDispose(removeGuard)
function selectType(value: RecommendationType) {
  if (busy.value || value === type.value) return
  return router.push({ path: route.path, query: { ...route.query, recommendationType: value }, hash: route.hash })
}
watch(draftEpoch, () => { formDirty.value = false })
async function add(kind: 'categories' | 'levels') {
  const name = kind === 'categories' ? categoryName : levelName
  dictionaryInvalid.value = !creatorNameValid({ name: name.value.trim() })
  if (dictionaryInvalid.value) return
  if (await management.addDictionary(kind, name.value)) name.value = ''
}
async function remove(kind: 'categories' | 'levels', id: number) {
  const signal = management.operationSignal()
  const accepted = await confirm({ title: t(kind === 'categories' ? 'creators.removeCategoryConfirm' : 'creators.removeLevelConfirm'), confirmLabel: t('creators.remove'), danger: true, signal })
  if (accepted && !signal.aborted) await management.removeDictionary(kind, id)
}
</script>

<template>
  <div class="creators-page layout-content" data-testid="creators-config-page">
    <PageHeader :title="t('creators.configTitle')"><template #actions><AppButton :disabled="loading || busy || !network.available" @click="management.refresh">{{ t('creators.refresh') }}</AppButton></template></PageHeader>
    <nav class="creator-filter-bar" :aria-label="t('creators.recommendationType')">
      <AppButton :aria-pressed="type === 'UP'" :disabled="busy" data-testid="recommendation-type-UP" @click="selectType('UP')">{{ t('creators.addCreator') }}</AppButton>
      <AppButton :aria-pressed="type === 'VIDEO'" :disabled="busy || !availability.typeAvailable('VIDEO')" data-testid="recommendation-type-VIDEO" @click="selectType('VIDEO')">{{ t('creators.addVideo') }}</AppButton>
    </nav>
    <Banner v-if="!typeSupported" data-testid="recommendation-type-unavailable">{{ t('creators.notAvailable') }}</Banner>
    <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
    <Banner v-if="!allowed && typeSupported" tone="danger">{{ t('tournament.adminRequired') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <Banner v-if="dictionaryInvalid" tone="danger">{{ t('creators.invalidName') }}</Banner>
    <Banner v-if="notice" role="status">{{ t('creators.' + notice) }}</Banner>
    <p v-if="loading || network.pending" role="status">{{ t('creators.loading') }}</p>
    <div v-if="allowed && typeSupported" class="creator-config-grid">
      <section class="creator-panel" :aria-labelledby="'creator-new-heading'"><h2 id="creator-new-heading">{{ t(type === 'VIDEO' ? 'creators.addVideo' : 'creators.addCreator') }}</h2>
        <CreatorForm v-if="metadataLoaded" :key="`${type}-${draftEpoch}`" :type="type" @dirty="formDirty = $event" :categories="categories" :levels="levels" :busy="busy || loading || !network.available" :avatar-uploads-available="avatarUploadsAvailable" :save="(value, avatar) => management.save(value, avatar)" @saved="management.finishSave()" />
      </section>
      <div class="creator-config-sections">
        <section class="creator-panel"><h2>{{ t('creators.categories') }}</h2>
          <form class="creator-dictionary-add" @submit.prevent="add('categories')"><label class="creator-field"><span>{{ t('creators.newCategory') }}</span><input v-model="categoryName" required :disabled="busy || loading || !network.available" data-testid="creator-new-category"></label><AppButton type="submit" :disabled="busy || loading || !network.available">{{ t('creators.add') }}</AppButton></form>
          <ul class="creator-dictionary-list"><li v-for="category in categories" :key="category.id"><span>{{ category.name }}</span><AppButton variant="danger" :disabled="busy || loading || !network.available" :aria-label="t('creators.removeNamed', { name: category.name })" @click="remove('categories', category.id)">{{ t('creators.remove') }}</AppButton></li></ul>
        </section>
        <section v-if="type === 'UP'" class="creator-panel"><h2>{{ t('creators.levels') }}</h2>
          <form class="creator-dictionary-add" @submit.prevent="add('levels')"><label class="creator-field"><span>{{ t('creators.newLevel') }}</span><input v-model="levelName" required :disabled="busy || loading || !network.available" data-testid="creator-new-level"></label><AppButton type="submit" :disabled="busy || loading || !network.available">{{ t('creators.add') }}</AppButton></form>
          <ul class="creator-dictionary-list"><li v-for="level in levels" :key="level.id"><span>{{ level.name }}</span><AppButton variant="danger" :disabled="busy || loading || !network.available" :aria-label="t('creators.removeNamed', { name: level.name })" @click="remove('levels', level.id)">{{ t('creators.remove') }}</AppButton></li></ul>
        </section>
      </div>
    </div>
  </div>
</template>
