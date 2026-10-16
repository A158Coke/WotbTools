<script setup lang="ts">
import { ref, watch } from 'vue'
import { ExternalLink, Pencil, Star, Trash2, UserRound } from 'lucide-vue-next'
import { creatorAvatarUrl } from '../api/creators.js'
import type { CreatorCard } from '../api/creators.js'
import AppButton from './AppButton.vue'

const props = defineProps<{ creator: CreatorCard; admin: boolean; adminDisabled: boolean }>()
defineEmits<{ edit: []; remove: [] }>()
const imageFailed = ref(false)
watch(() => props.creator.avatarUrl, () => { imageFailed.value = false })
</script>

<template>
  <article class="creator-card" :data-testid="`creator-card-${creator.id}`">
    <header class="creator-card-heading">
      <img v-if="creator.avatarUrl && !imageFailed" class="creator-avatar" :src="creatorAvatarUrl(creator.avatarUrl)" :alt="$t('creators.avatarAlt', { name: creator.name })" loading="lazy" @error="imageFailed = true">
      <UserRound v-else class="creator-avatar creator-avatar-fallback" :size="32" aria-hidden="true" />
      <h2>{{ creator.name }}</h2>
    </header>
    <p v-if="creator.description" class="creator-description">{{ creator.description }}</p>
    <ul class="creator-tags" :aria-label="$t('creators.categories')"><li v-for="category in creator.categories" :key="category.id">{{ category.name }}</li></ul>
    <div class="creator-rating" :aria-label="$t('creators.scoreLabel', { score: creator.score })">
      <span class="creator-stars" aria-hidden="true"><template v-for="index in 5" :key="index"><Star v-if="creator.score >= index * 2" :size="20" class="is-filled" /><Star v-else :size="20" /></template></span>
      <strong>{{ creator.score }}/10</strong>
    </div>
    <p v-if="creator.level" class="creator-strength"><span>{{ $t('creators.level') }}: {{ creator.level.name }}</span><small>{{ $t('creators.assessmentDisclaimer') }}</small></p>
    <div class="creator-actions">
      <AppButton :href="creator.homepageUrl" target="_blank" rel="noopener noreferrer">{{ $t('creators.visitHomepage') }}<ExternalLink :size="16" aria-hidden="true" /></AppButton>
    </div>
    <div v-if="admin" class="creator-actions creator-admin-actions">
      <AppButton :disabled="adminDisabled" :data-testid="`creator-edit-${creator.id}`" @click="$emit('edit')"><Pencil :size="16" aria-hidden="true" />{{ $t('creators.edit') }}</AppButton>
      <AppButton variant="danger" :disabled="adminDisabled" :data-testid="`creator-remove-${creator.id}`" @click="$emit('remove')"><Trash2 :size="16" aria-hidden="true" />{{ $t('creators.remove') }}</AppButton>
    </div>
  </article>
</template>
