<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { recommendationImageUrl, recommendationInputValid } from '../api/creators.js'
import type { RecommendationCategory, RecommendationDetail, CreatorLevel, RecommendationSaveRequest, RecommendationType } from '../api/creators.js'
import { useAuth, contentAdminAllowed } from '../composables/useAuth.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import FileDrop from './FileDrop.vue'

const props = defineProps<{ type?: RecommendationType; detail?: RecommendationDetail | null; categories: RecommendationCategory[]; levels: CreatorLevel[];
  busy: boolean; avatarUploadsAvailable: boolean; save: (value: RecommendationSaveRequest, avatar: File | null) => Promise<boolean> }>()
const emit = defineEmits<{ saved: []; dirty: [value: boolean] }>()
const video = computed(() => props.type === 'VIDEO')
const { t } = useI18n(), auth = useAuth(), formId = `creator-form-${useId()}`
const draft = ref<RecommendationSaveRequest>({ type: props.type ?? 'UP', externalId: props.detail?.externalId ?? '', name: props.detail?.name ?? '', description: props.detail?.description ?? null,
  categoryIds: [...(props.detail?.categoryIds ?? [])], levelId: props.detail?.levelId ?? null, stars: props.detail?.stars ?? 3, imageAction: 'KEEP', expectedVersion: props.detail?.version ?? null })
const assessed = ref(props.detail?.levelId != null), categorySearch = ref('')
const visibleCategories = computed(() => props.categories.filter(value => value.name.toLocaleLowerCase().includes(categorySearch.value.trim().toLocaleLowerCase())))
const invalid = ref(false), submitting = ref(false), files = ref<File[]>([]), preview = ref('')
const allowed = computed(() => contentAdminAllowed(auth) && auth.authInitState.value === 'authenticated')
const disabled = computed(() => props.busy || submitting.value || !allowed.value)
const normalizedUid = computed(() => video.value ? draft.value.externalId.trim() : draft.value.externalId.trim().replace(/^0+/, ''))
const uidValid = computed(() => video.value ? /^BV[0-9A-Za-z]{10}$/.test(normalizedUid.value) : /^[0-9]{1,20}$/.test(draft.value.externalId.trim()) && normalizedUid.value.length > 0)
const homepage = computed(() => uidValid.value ? (video.value ? `https://www.bilibili.com/video/${normalizedUid.value}` : `https://space.bilibili.com/${normalizedUid.value}`) : '')
const avatarSource = computed(() => preview.value || (draft.value.imageAction === 'KEEP' ? recommendationImageUrl(props.detail?.imageUrl ?? null) : ''))
const initialDraft = JSON.stringify(draft.value)
watch([draft, files, assessed], () => emit('dirty', JSON.stringify(draft.value) !== initialDraft || files.value.length > 0 || assessed.value !== (props.detail?.levelId != null)), { deep: true, flush: 'sync' })
let mounted = true, formGeneration = 0
function releasePreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
function clearAvatar() { releasePreview(); files.value = []; draft.value.imageAction = props.detail?.imageUrl ? 'REMOVE' : 'KEEP' }
function restoreAvatar() { releasePreview(); files.value = []; draft.value.imageAction = 'KEEP' }
function pickAvatar(values: File[]) {
  if (disabled.value || !props.avatarUploadsAvailable) return
  if (!values.length) { clearAvatar(); return }
  if (values.length !== 1) return
  releasePreview(); files.value = values; preview.value = URL.createObjectURL(values[0]); draft.value.imageAction = 'REPLACE'
}
function setAssessed() { if (!assessed.value) draft.value.levelId = null }
watch(() => props.categories.map(category => category.id), (ids, previousIds) => {
  if (ids.length || previousIds.length) draft.value.categoryIds = draft.value.categoryIds.filter(id => ids.includes(id))
})
watch(() => props.levels.map(level => level.id), (ids, previousIds) => {
  if ((ids.length || previousIds.length) && draft.value.levelId != null && !ids.includes(draft.value.levelId)) draft.value.levelId = null
})
async function submit() {
  if (disabled.value || (draft.value.imageAction === 'REPLACE' && !props.avatarUploadsAvailable)) return
  const value = draft.value
  const request: RecommendationSaveRequest = { ...value, externalId: normalizedUid.value, name: value.name.trim(),
    description: value.description?.trim() || null, categoryIds: [...value.categoryIds], levelId: !video.value && assessed.value ? value.levelId : null }
  const valid = uidValid.value && recommendationInputValid(request)
    && value.categoryIds.every(id => props.categories.some(category => category.id === id))
    && (video.value || !assessed.value || (value.levelId != null && props.levels.some(level => level.id === value.levelId)))
  invalid.value = !valid
  if (!valid) return
  const gen = formGeneration, epoch = auth.authEpoch()
  const ownsSubmission = () => mounted && gen === formGeneration && epoch === auth.authEpoch() && allowed.value
  submitting.value = true
  try {
    const success = await props.save(request, files.value[0] ?? null)
    if (success && ownsSubmission()) { releasePreview(); files.value = []; emit('dirty', false); emit('saved') }
  } finally { if (ownsSubmission()) submitting.value = false }
}
watch([() => auth.tokenParsed.value?.sub, allowed], () => {
  formGeneration++; submitting.value = false; releasePreview(); files.value = []; invalid.value = false
  draft.value = { type: props.type ?? 'UP', externalId: '', name: '', description: null, categoryIds: [], levelId: null, stars: 3, imageAction: 'KEEP', expectedVersion: null }; assessed.value = false
})
onScopeDispose(() => { mounted = false; formGeneration++; releasePreview() })
</script>

<template>
  <form :id="formId" class="creator-form" data-testid="creator-form" @submit.prevent="submit">
    <Banner v-if="invalid" tone="danger">{{ t(video ? 'creators.invalidVideoForm' : 'creators.invalidForm') }}</Banner>
    <label class="creator-field"><span>{{ t(video ? 'creators.videoName' : 'creators.name') }}</span><input v-model="draft.name" required :disabled="disabled" data-autofocus data-testid="creator-name"></label>
    <label class="creator-field"><span>{{ t(video ? 'creators.bv' : 'creators.uid') }}</span><input v-model="draft.externalId" type="text" :inputmode="video ? 'text' : 'numeric'" autocomplete="off" required maxlength="40" :disabled="disabled" data-testid="creator-uid"><small>{{ t(video ? 'creators.bvHint' : 'creators.uidHint') }}</small></label>
    <div v-if="homepage" class="creator-field"><span>{{ t(video ? 'creators.videoLink' : 'creators.homepage') }}</span><a class="creator-homepage" :href="homepage" target="_blank" rel="noopener noreferrer" data-testid="creator-homepage">{{ homepage }}</a></div>
    <label class="creator-field"><span>{{ t('creators.description') }}</span><textarea v-model="draft.description" rows="3" :disabled="disabled" data-testid="creator-description" /><small>{{ t(video ? 'creators.videoDescriptionHint' : 'creators.descriptionHint') }}</small></label>
    <fieldset class="creator-fieldset"><legend>{{ t('creators.categories') }}</legend>
      <label v-if="categories.length > 15" class="creator-field"><span>{{ t('creators.searchCategories') }}</span><input v-model="categorySearch" type="search" :disabled="disabled"></label>
      <div class="creator-options"><label v-for="category in visibleCategories" :key="category.id" class="creator-check"><input v-model="draft.categoryIds" type="checkbox" :value="category.id" :disabled="disabled" :data-testid="`creator-category-${category.id}`"><span>{{ category.name }}</span></label></div>
      <small>{{ t(categories.length ? 'creators.categoryRequired' : 'creators.noCategories') }}</small>
    </fieldset>
    <label class="creator-field"><span>{{ t('creators.stars') }}</span><select v-model.number="draft.stars" :disabled="disabled" data-testid="creator-stars"><option v-for="stars in 5" :key="stars" :value="stars">{{ t('creators.starOption', { count: stars }) }}</option></select><small>{{ t('creators.starsHint') }}</small></label>
    <label v-if="!video" class="creator-check"><input v-model="assessed" type="checkbox" :disabled="disabled" data-testid="creator-assessed" @change="setAssessed"><span>{{ t('creators.assess') }}</span></label>
    <label v-if="!video && assessed" class="creator-field"><span>{{ t('creators.level') }}</span><select v-model.number="draft.levelId" required :disabled="disabled" data-testid="creator-level"><option :value="null" disabled>{{ t('creators.selectLevel') }}</option><option v-for="level in levels" :key="level.id" :value="level.id">{{ level.name }}</option></select></label>
    <section class="creator-avatar-editor" :aria-label="t(video ? 'creators.cover' : 'creators.avatar')">
      <h3>{{ t(video ? 'creators.cover' : 'creators.avatar') }}</h3>
      <img v-if="avatarSource" :src="avatarSource" :alt="t(video ? 'creators.coverAlt' : 'creators.avatarAlt', { name: draft.name })" class="creator-avatar-preview" :class="{ 'recommendation-cover': video }" data-testid="creator-avatar-preview">
      <Banner v-if="!avatarUploadsAvailable">{{ t(video ? 'creators.coverUnavailable' : 'creators.avatarUnavailable') }}</Banner>
      <FileDrop :files="files" purpose="image" image-single :image-label="t(video ? 'creators.chooseCover' : 'creators.chooseAvatar')" :image-hint="t('creators.avatarHint')" :disabled="disabled || !avatarUploadsAvailable" @update:files="pickAvatar" />
      <div class="creator-actions"><AppButton v-if="avatarSource || files.length" :disabled="disabled" data-testid="creator-avatar-clear" @click="clearAvatar">{{ t(video ? 'creators.clearCover' : 'creators.clearAvatar') }}</AppButton><AppButton v-if="detail?.imageUrl && draft.imageAction !== 'KEEP'" :disabled="disabled" data-testid="creator-avatar-restore" @click="restoreAvatar">{{ t(video ? 'creators.restoreCover' : 'creators.restoreAvatar') }}</AppButton></div>
    </section>
    <AppButton variant="primary" type="submit" :disabled="disabled || (draft.imageAction === 'REPLACE' && !avatarUploadsAvailable)" data-testid="creator-save">{{ t(busy || submitting ? 'creators.saving' : 'creators.save') }}</AppButton>
  </form>
</template>
