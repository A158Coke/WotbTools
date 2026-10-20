<script setup lang="ts">
import { ref, watch } from 'vue'
import { ExternalLink, Pencil, Star, Trash2, UserRound, Clapperboard } from 'lucide-vue-next'
import { recommendationImageUrl } from '../api/creators.js'
import type { RecommendationCard } from '../api/creators.js'
import AppButton from './AppButton.vue'

const props = defineProps<{ creator: RecommendationCard; admin: boolean; adminDisabled: boolean }>()
defineEmits<{ edit: []; remove: [] }>()
const imageFailed = ref(false)
watch(() => props.creator.imageUrl, () => { imageFailed.value = false })
</script>

<template>
  <article class="creator-card" :data-testid="`creator-card-${creator.id}`">
    <header class="creator-card-heading">
      <div class="creator-card-media" :class="{ 'is-video': creator.type === 'VIDEO' }">
        <img v-if="creator.imageUrl && !imageFailed" :class="creator.type === 'VIDEO' ? 'recommendation-cover' : 'creator-avatar'" :src="recommendationImageUrl(creator.imageUrl)" :alt="$t(creator.type === 'VIDEO' ? 'creators.coverAlt' : 'creators.avatarAlt', { name: creator.name })" loading="lazy" @error="imageFailed = true">
        <component :is="creator.type === 'VIDEO' ? Clapperboard : UserRound" v-else class="creator-avatar creator-avatar-fallback" :size="32" aria-hidden="true" />
      </div>
      <h2>{{ creator.name }}</h2>
    </header>
    <div class="creator-card-copy">
      <p v-if="creator.description" class="creator-description">{{ creator.description }}</p>
      <p v-if="creator.type === 'UP' && creator.level" class="creator-strength"><span>{{ $t('creators.level') }}: {{ creator.level.name }}</span><small>{{ $t('creators.assessmentDisclaimer') }}</small></p>
    </div>
    <ul class="creator-tags" :aria-label="$t('creators.categories')"><li v-for="category in creator.categories" :key="category.id">{{ category.name }}</li></ul>
    <footer class="creator-card-footer">
      <div class="creator-card-primary">
        <div class="creator-rating" :aria-label="$t('creators.scoreLabel', { score: creator.score })">
          <span class="creator-stars" aria-hidden="true"><template v-for="index in 5" :key="index"><Star v-if="creator.score >= index * 2" :size="20" class="is-filled" /><Star v-else :size="20" /></template></span>
          <strong>{{ creator.score }}/10</strong>
        </div>
        <div class="creator-actions creator-visit">
          <AppButton :href="creator.targetUrl" target="_blank" rel="noopener noreferrer">{{ $t(creator.type === 'VIDEO' ? 'creators.visitVideo' : 'creators.visitHomepage') }}<ExternalLink :size="16" aria-hidden="true" /></AppButton>
        </div>
      </div>
      <div v-if="admin" class="creator-actions creator-admin-actions">
        <AppButton :disabled="adminDisabled" :data-testid="`creator-edit-${creator.id}`" @click="$emit('edit')"><Pencil :size="16" aria-hidden="true" />{{ $t(creator.type === 'VIDEO' ? 'creators.editVideo' : 'creators.edit') }}</AppButton>
        <AppButton variant="danger" :disabled="adminDisabled" :data-testid="`creator-remove-${creator.id}`" @click="$emit('remove')"><Trash2 :size="16" aria-hidden="true" />{{ $t('creators.remove') }}</AppButton>
      </div>
    </footer>
  </article>
</template>
