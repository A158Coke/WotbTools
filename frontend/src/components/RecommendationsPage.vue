<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import { useRoute, useRouter } from 'vue-router'
import { UserRound, Clapperboard, ChevronRight } from 'lucide-vue-next'
import { useCreatorAvailability } from '../composables/useCreatorAvailability.js'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import './creators.css'
const availability = useCreatorAvailability(), route = useRoute(), router = useRouter()
function open(view: string) {
  const query: LocationQueryRaw = { ...route.query, view }
  delete query.creatorCategory
  return router.push({ path: route.path, query, hash: route.hash })
}
</script>

<template>
  <div class="creators-page layout-content" data-testid="recommendations-page">
    <PageHeader :title="$t('creators.directoryTitle')"><template #actions><AppButton :disabled="availability.loading.value" data-testid="recommendations-refresh" @click="availability.refresh">{{ $t('creators.refresh') }}</AppButton></template></PageHeader>
    <Banner v-if="availability.error.value">{{ $t('creators.availabilityFailed') }}</Banner>
    <div class="creator-grid">
      <AppButton v-if="availability.typeVisible('UP')" class="recommendation-type-card" data-testid="recommendation-card-UP" @click="open('creators')">
        <UserRound :size="32" aria-hidden="true" /><span><strong>{{ $t('creators.upType') }}</strong><small>{{ $t('creators.upTypeHint') }}</small></span><ChevronRight :size="20" aria-hidden="true" />
      </AppButton>
      <AppButton v-if="availability.typeVisible('VIDEO')" class="recommendation-type-card" data-testid="recommendation-card-VIDEO" @click="open('recommended-videos')">
        <Clapperboard :size="32" aria-hidden="true" /><span><strong>{{ $t('creators.videosTitle') }}</strong><small>{{ $t('creators.videoTypeHint') }}</small></span><ChevronRight :size="20" aria-hidden="true" />
      </AppButton>
    </div>
  </div>
</template>
