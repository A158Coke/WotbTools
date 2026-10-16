<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreatorManagement } from '../composables/useCreatorManagement.js'
import { useAuth } from '../composables/useAuth.js'
import { confirm } from '../composables/useConfirm.js'
import { apiErrorLabel } from '../utils/display.js'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import CreatorForm from './CreatorForm.vue'
import './creators.css'

const { t, te } = useI18n(), management = useCreatorManagement()
const { network, allowed, categories, levels, avatarUploadsAvailable, metadataLoaded, loading, busy, error, notice, draftEpoch } = management
const categoryName = ref(''), levelName = ref('')
const { authenticated, tokenParsed } = useAuth()
watch([authenticated, () => tokenParsed.value?.sub, allowed], () => { categoryName.value = ''; levelName.value = '' })
async function add(kind: 'categories' | 'levels') {
  const name = kind === 'categories' ? categoryName : levelName
  if (!name.value.trim() || name.value.trim().length > 100) return
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
    <Banner v-if="!network.available && !network.pending">{{ t(network.messageKey || 'featureOffline.creators') }}</Banner>
    <Banner v-if="!allowed" tone="danger">{{ t('tournament.adminRequired') }}</Banner>
    <Banner v-if="error" tone="danger">{{ apiErrorLabel(t, te, error) }}</Banner>
    <Banner v-if="notice" role="status">{{ t('creators.' + notice) }}</Banner>
    <p v-if="loading || network.pending" role="status">{{ t('creators.loading') }}</p>
    <div v-if="allowed" class="creator-config-grid">
      <section class="creator-panel" :aria-labelledby="'creator-new-heading'"><h2 id="creator-new-heading">{{ t('creators.addCreator') }}</h2>
        <CreatorForm v-if="metadataLoaded" :key="draftEpoch" :categories="categories" :levels="levels" :busy="busy || loading || !network.available" :avatar-uploads-available="avatarUploadsAvailable" :save="(value, avatar) => management.save(value, avatar)" @saved="management.finishSave()" />
      </section>
      <div class="creator-config-sections">
        <section class="creator-panel"><h2>{{ t('creators.categories') }}</h2>
          <form class="creator-dictionary-add" @submit.prevent="add('categories')"><label class="creator-field"><span>{{ t('creators.newCategory') }}</span><input v-model="categoryName" required maxlength="100" :disabled="busy || loading || !network.available" data-testid="creator-new-category"></label><AppButton type="submit" :disabled="busy || loading || !network.available">{{ t('creators.add') }}</AppButton></form>
          <ul class="creator-dictionary-list"><li v-for="category in categories" :key="category.id"><span>{{ category.name }}</span><AppButton variant="danger" :disabled="busy || loading || !network.available" :aria-label="t('creators.removeNamed', { name: category.name })" @click="remove('categories', category.id)">{{ t('creators.remove') }}</AppButton></li></ul>
        </section>
        <section class="creator-panel"><h2>{{ t('creators.levels') }}</h2>
          <form class="creator-dictionary-add" @submit.prevent="add('levels')"><label class="creator-field"><span>{{ t('creators.newLevel') }}</span><input v-model="levelName" required maxlength="100" :disabled="busy || loading || !network.available" data-testid="creator-new-level"></label><AppButton type="submit" :disabled="busy || loading || !network.available">{{ t('creators.add') }}</AppButton></form>
          <ul class="creator-dictionary-list"><li v-for="level in levels" :key="level.id"><span>{{ level.name }}</span><AppButton variant="danger" :disabled="busy || loading || !network.available" :aria-label="t('creators.removeNamed', { name: level.name })" @click="remove('levels', level.id)">{{ t('creators.remove') }}</AppButton></li></ul>
        </section>
      </div>
    </div>
  </div>
</template>
