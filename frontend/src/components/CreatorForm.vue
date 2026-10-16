<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { creatorAvatarUrl } from '../api/creators.js'
import type { CreatorCategory, CreatorDetail, CreatorLevel, CreatorSaveRequest } from '../api/creators.js'
import { useAuth, tournamentAdminAllowed } from '../composables/useAuth.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import FileDrop from './FileDrop.vue'

const props = defineProps<{ detail?: CreatorDetail | null; categories: CreatorCategory[]; levels: CreatorLevel[];
  busy: boolean; avatarUploadsAvailable: boolean; save: (value: CreatorSaveRequest, avatar: File | null) => Promise<boolean> }>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n(), auth = useAuth(), formId = `creator-form-${useId()}`
const draft = ref<CreatorSaveRequest>({ bilibiliUid: props.detail?.bilibiliUid ?? '', name: props.detail?.name ?? '', description: props.detail?.description ?? null,
  categoryIds: [...(props.detail?.categoryIds ?? [])], levelId: props.detail?.levelId ?? null, stars: props.detail?.stars ?? 3, avatarAction: 'KEEP' })
const assessed = ref(props.detail?.levelId != null), categorySearch = ref('')
const visibleCategories = computed(() => props.categories.filter(value => value.name.toLocaleLowerCase().includes(categorySearch.value.trim().toLocaleLowerCase())))
const invalid = ref(false), submitting = ref(false), files = ref<File[]>([]), preview = ref('')
const allowed = computed(() => tournamentAdminAllowed(auth) && auth.authInitState.value === 'authenticated')
const disabled = computed(() => props.busy || submitting.value || !allowed.value)
const normalizedUid = computed(() => draft.value.bilibiliUid.trim().replace(/^0+/, ''))
const uidValid = computed(() => /^[0-9]{1,20}$/.test(draft.value.bilibiliUid.trim()) && normalizedUid.value.length > 0)
const homepage = computed(() => uidValid.value ? `https://space.bilibili.com/${normalizedUid.value}` : '')
const avatarSource = computed(() => preview.value || (draft.value.avatarAction === 'KEEP' ? creatorAvatarUrl(props.detail?.avatarUrl ?? null) : ''))
let mounted = true, formGeneration = 0
function releasePreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
function clearAvatar() { releasePreview(); files.value = []; draft.value.avatarAction = props.detail?.avatarUrl ? 'REMOVE' : 'KEEP' }
function restoreAvatar() { releasePreview(); files.value = []; draft.value.avatarAction = 'KEEP' }
function pickAvatar(values: File[]) {
  if (disabled.value || !props.avatarUploadsAvailable) return
  if (!values.length) { clearAvatar(); return }
  if (values.length !== 1) return
  releasePreview(); files.value = values; preview.value = URL.createObjectURL(values[0]); draft.value.avatarAction = 'REPLACE'
}
function setAssessed() { if (!assessed.value) draft.value.levelId = null }
watch(() => props.categories.map(category => category.id), (ids, previousIds) => {
  if (ids.length || previousIds.length) draft.value.categoryIds = draft.value.categoryIds.filter(id => ids.includes(id))
})
watch(() => props.levels.map(level => level.id), (ids, previousIds) => {
  if ((ids.length || previousIds.length) && draft.value.levelId != null && !ids.includes(draft.value.levelId)) draft.value.levelId = null
})
async function submit() {
  if (disabled.value || (draft.value.avatarAction === 'REPLACE' && !props.avatarUploadsAvailable)) return
  const value = draft.value
  const valid = uidValid.value && value.name.trim().length > 0 && value.name.trim().length <= 100
    && (value.description?.trim().length ?? 0) <= 2000 && value.categoryIds.length > 0
    && value.categoryIds.every(id => props.categories.some(category => category.id === id))
    && Number.isInteger(value.stars) && value.stars >= 1 && value.stars <= 5
    && (!assessed.value || (value.levelId != null && props.levels.some(level => level.id === value.levelId)))
  invalid.value = !valid
  if (!valid) return
  const gen = formGeneration, epoch = auth.authEpoch()
  const ownsSubmission = () => mounted && gen === formGeneration && epoch === auth.authEpoch() && allowed.value
  submitting.value = true
  try {
    const success = await props.save({ ...value, bilibiliUid: normalizedUid.value, name: value.name.trim(),
      description: value.description?.trim() || null, categoryIds: [...value.categoryIds], levelId: assessed.value ? value.levelId : null }, files.value[0] ?? null)
    if (success && ownsSubmission()) { releasePreview(); files.value = []; emit('saved') }
  } finally { if (ownsSubmission()) submitting.value = false }
}
watch([() => auth.tokenParsed.value?.sub, allowed], () => {
  formGeneration++; submitting.value = false; releasePreview(); files.value = []; invalid.value = false
  draft.value = { bilibiliUid: '', name: '', description: null, categoryIds: [], levelId: null, stars: 3, avatarAction: 'KEEP' }; assessed.value = false
})
onScopeDispose(() => { mounted = false; formGeneration++; releasePreview() })
</script>

<template>
  <form :id="formId" class="creator-form" data-testid="creator-form" @submit.prevent="submit">
    <Banner v-if="invalid" tone="danger">{{ t('creators.invalidForm') }}</Banner>
    <label class="creator-field"><span>{{ t('creators.name') }}</span><input v-model="draft.name" required maxlength="100" :disabled="disabled" data-autofocus data-testid="creator-name"></label>
    <label class="creator-field"><span>{{ t('creators.uid') }}</span><input v-model="draft.bilibiliUid" type="text" inputmode="numeric" autocomplete="off" required maxlength="40" :disabled="disabled" data-testid="creator-uid"><small>{{ t('creators.uidHint') }}</small></label>
    <div v-if="homepage" class="creator-field"><span>{{ t('creators.homepage') }}</span><a class="creator-homepage" :href="homepage" target="_blank" rel="noopener noreferrer" data-testid="creator-homepage">{{ homepage }}</a></div>
    <label class="creator-field"><span>{{ t('creators.description') }}</span><textarea v-model="draft.description" maxlength="2000" rows="3" :disabled="disabled" data-testid="creator-description" /><small>{{ t('creators.descriptionHint') }}</small></label>
    <fieldset class="creator-fieldset"><legend>{{ t('creators.categories') }}</legend>
      <label v-if="categories.length > 15" class="creator-field"><span>{{ t('creators.searchCategories') }}</span><input v-model="categorySearch" type="search" :disabled="disabled"></label>
      <div class="creator-options"><label v-for="category in visibleCategories" :key="category.id" class="creator-check"><input v-model="draft.categoryIds" type="checkbox" :value="category.id" :disabled="disabled" :data-testid="`creator-category-${category.id}`"><span>{{ category.name }}</span></label></div>
      <small>{{ t('creators.categoryRequired') }}</small>
    </fieldset>
    <label class="creator-field"><span>{{ t('creators.stars') }}</span><select v-model.number="draft.stars" :disabled="disabled" data-testid="creator-stars"><option v-for="stars in 5" :key="stars" :value="stars">{{ t('creators.starOption', { count: stars }) }}</option></select><small>{{ t('creators.starsHint') }}</small></label>
    <label class="creator-check"><input v-model="assessed" type="checkbox" :disabled="disabled" data-testid="creator-assessed" @change="setAssessed"><span>{{ t('creators.assess') }}</span></label>
    <label v-if="assessed" class="creator-field"><span>{{ t('creators.level') }}</span><select v-model.number="draft.levelId" required :disabled="disabled" data-testid="creator-level"><option :value="null" disabled>{{ t('creators.selectLevel') }}</option><option v-for="level in levels" :key="level.id" :value="level.id">{{ level.name }}</option></select></label>
    <section class="creator-avatar-editor" :aria-label="t('creators.avatar')">
      <h3>{{ t('creators.avatar') }}</h3>
      <img v-if="avatarSource" :src="avatarSource" :alt="t('creators.avatarAlt', { name: draft.name })" class="creator-avatar-preview" data-testid="creator-avatar-preview">
      <Banner v-if="!avatarUploadsAvailable">{{ t('creators.avatarUnavailable') }}</Banner>
      <FileDrop :files="files" purpose="image" image-single :image-label="t('creators.chooseAvatar')" :image-hint="t('creators.avatarHint')" :disabled="disabled || !avatarUploadsAvailable" :show-preview="false" :allow-folder="false" @update:files="pickAvatar" />
      <div class="creator-actions"><AppButton v-if="avatarSource || files.length" :disabled="disabled" data-testid="creator-avatar-clear" @click="clearAvatar">{{ t('creators.clearAvatar') }}</AppButton><AppButton v-if="detail?.avatarUrl && draft.avatarAction !== 'KEEP'" :disabled="disabled" data-testid="creator-avatar-restore" @click="restoreAvatar">{{ t('creators.restoreAvatar') }}</AppButton></div>
    </section>
    <AppButton variant="primary" type="submit" :disabled="disabled || (draft.avatarAction === 'REPLACE' && !avatarUploadsAvailable)" data-testid="creator-save">{{ t(busy || submitting ? 'creators.saving' : 'creators.save') }}</AppButton>
  </form>
</template>
