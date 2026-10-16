<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { creatorAvatarUrl, uploadCreatorAvatar, removeUnusedCreatorAvatar } from '../api/creators.js'
import type { CreatorCategory, CreatorDetail, CreatorLevel, CreatorSaveRequest } from '../api/creators.js'
import { useAuth, tournamentAdminAllowed } from '../composables/useAuth.js'
import { apiErrorLabel } from '../utils/display.js'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import FileDrop from './FileDrop.vue'

const props = defineProps<{ detail?: CreatorDetail | null; categories: CreatorCategory[]; levels: CreatorLevel[];
  busy: boolean; avatarUploadsAvailable: boolean; save: (value: CreatorSaveRequest) => Promise<boolean> }>()
const emit = defineEmits<{ saved: [] }>()
const { t, te } = useI18n(), auth = useAuth(), formId = `creator-form-${useId()}`
const draft = ref<CreatorSaveRequest>({ name: props.detail?.name ?? '', homepageUrl: props.detail?.homepageUrl ?? '',
  description: props.detail?.description ?? null, categoryIds: [...(props.detail?.categoryIds ?? [])],
  levelId: props.detail?.levelId ?? null, baseStars: props.detail?.baseStars ?? 3, avatarId: props.detail?.avatarId ?? null })
const assessed = ref(props.detail?.levelId != null), categorySearch = ref('')
const visibleCategories = computed(() => props.categories.filter(value => value.name.toLocaleLowerCase().includes(categorySearch.value.trim().toLocaleLowerCase())))
const invalid = ref(false), submitting = ref(false), uploading = ref(false), uploadError = ref<unknown>(null), cleanupFailed = ref(false)
const files = ref<File[]>([]), preview = ref(''), savedAvatarUrl = ref(props.detail?.avatarUrl ?? null)
const reservation = ref<Awaited<ReturnType<typeof uploadCreatorAvatar>> | null>(null)
const allowed = computed(() => tournamentAdminAllowed(auth) && auth.authInitState.value === 'authenticated')
const disabled = computed(() => props.busy || submitting.value || !allowed.value)
const avatarSource = computed(() => preview.value || creatorAvatarUrl(savedAvatarUrl.value))
let mounted = true, uploadGeneration = 0, formGeneration = 0, controller = new AbortController()
function releasePreview() { if (preview.value) URL.revokeObjectURL(preview.value); preview.value = '' }
function cleanup(id: string) { void removeUnusedCreatorAvatar(id).catch(() => { if (mounted) cleanupFailed.value = true }) }
function releaseReservation() { if (reservation.value) cleanup(reservation.value.id); reservation.value = null }
function invalidateUpload() { uploadGeneration++; controller.abort(); controller = new AbortController(); uploading.value = false; releasePreview() }
function clearAvatar() {
  invalidateUpload(); releaseReservation(); files.value = []; uploadError.value = null
  draft.value.avatarId = null; savedAvatarUrl.value = null
}
async function pickAvatar(values: File[]) {
  if (disabled.value || !props.avatarUploadsAvailable) return
  if (!values.length) { if (files.value.length) clearAvatar(); return }
  if (values.length !== 1) { uploadError.value = new Error('CREATOR_INVALID_REQUEST'); return }
  invalidateUpload(); releaseReservation()
  files.value = values; preview.value = URL.createObjectURL(values[0]); uploadError.value = null; cleanupFailed.value = false
  const gen = uploadGeneration, epoch = auth.authEpoch(), signal = controller.signal
  uploading.value = true
  try {
    const value = await uploadCreatorAvatar(values[0], signal)
    if (!mounted || gen !== uploadGeneration || epoch !== auth.authEpoch() || !allowed.value || signal.aborted) { cleanup(value.id); return }
    // The public image endpoint serves attached avatars only; keep the local preview until Save attaches this reservation.
    reservation.value = value; draft.value.avatarId = value.id; savedAvatarUrl.value = null; files.value = []
  } catch (value) {
    if (mounted && gen === uploadGeneration && epoch === auth.authEpoch() && !signal.aborted) uploadError.value = value
  } finally { if (mounted && gen === uploadGeneration && epoch === auth.authEpoch()) uploading.value = false }
}
function setAssessed() { if (!assessed.value) draft.value.levelId = null }
watch(() => props.categories.map(category => category.id), (ids, previousIds) => {
  // Empty initial dictionaries may still be loading; only reconcile a known dictionary snapshot.
  if (ids.length || previousIds.length) draft.value.categoryIds = draft.value.categoryIds.filter(id => ids.includes(id))
})
watch(() => props.levels.map(level => level.id), (ids, previousIds) => {
  if ((ids.length || previousIds.length) && draft.value.levelId != null && !ids.includes(draft.value.levelId)) draft.value.levelId = null
})
async function submit() {
  if (disabled.value || uploading.value || uploadError.value) return
  const value = draft.value
  const homepageValid = /^https:\/\/space\.bilibili\.com\/[1-9][0-9]*\/?(?:\?[^#\s]*)?$/.test(value.homepageUrl.trim()) && value.homepageUrl.trim().length <= 300
  const valid = value.name.trim().length > 0 && value.name.trim().length <= 100 && homepageValid
    && (value.description?.trim().length ?? 0) <= 2000 && value.categoryIds.length > 0
    && value.categoryIds.every(id => props.categories.some(category => category.id === id))
    && Number.isInteger(value.baseStars) && value.baseStars >= 1 && value.baseStars <= 5
    && (!assessed.value || (value.levelId != null && props.levels.some(level => level.id === value.levelId)))
  invalid.value = !valid
  if (!valid) return
  const gen = formGeneration, epoch = auth.authEpoch(), pendingReservation = reservation.value
  const ownsSubmission = () => mounted && gen === formGeneration && epoch === auth.authEpoch() && allowed.value
  // The save attempt owns this reservation until the server confirms attachment or the write fails.
  reservation.value = null
  let attached = false
  submitting.value = true
  try {
    const success = await props.save({ ...value, name: value.name.trim(), homepageUrl: value.homepageUrl.trim(),
      description: value.description?.trim() || null, categoryIds: [...value.categoryIds], levelId: assessed.value ? value.levelId : null })
    attached = success
    if (success && ownsSubmission()) { releasePreview(); emit('saved') }
  } finally {
    if (!attached && pendingReservation) {
      if (ownsSubmission()) reservation.value = pendingReservation
      else cleanup(pendingReservation.id)
    }
    if (ownsSubmission()) submitting.value = false
  }
}
watch([() => auth.tokenParsed.value?.sub, allowed], () => {
  formGeneration++; submitting.value = false
  invalidateUpload(); releaseReservation(); files.value = []; uploadError.value = null
  draft.value = { name: '', homepageUrl: '', description: null, categoryIds: [], levelId: null, baseStars: 3, avatarId: null }
  savedAvatarUrl.value = null; assessed.value = false
})
onScopeDispose(() => { mounted = false; formGeneration++; invalidateUpload(); releaseReservation() })
</script>

<template>
  <form :id="formId" class="creator-form" data-testid="creator-form" @submit.prevent="submit">
    <Banner v-if="invalid" tone="danger">{{ t('creators.invalidForm') }}</Banner>
    <label class="creator-field"><span>{{ t('creators.name') }}</span><input v-model="draft.name" required maxlength="100" :disabled="disabled" data-autofocus data-testid="creator-name"></label>
    <label class="creator-field"><span>{{ t('creators.homepage') }}</span><input v-model="draft.homepageUrl" type="url" required maxlength="300" :disabled="disabled" data-testid="creator-homepage"><small>{{ t('creators.homepageHint') }}</small></label>
    <label class="creator-field"><span>{{ t('creators.description') }}</span><textarea v-model="draft.description" maxlength="2000" rows="3" :disabled="disabled" data-testid="creator-description" /><small>{{ t('creators.descriptionHint') }}</small></label>
    <fieldset class="creator-fieldset"><legend>{{ t('creators.categories') }}</legend>
      <label v-if="categories.length > 15" class="creator-field"><span>{{ t('creators.searchCategories') }}</span><input v-model="categorySearch" type="search" :disabled="disabled"></label>
      <div class="creator-options"><label v-for="category in visibleCategories" :key="category.id" class="creator-check"><input v-model="draft.categoryIds" type="checkbox" :value="category.id" :disabled="disabled" :data-testid="`creator-category-${category.id}`"><span>{{ category.name }}</span></label></div>
      <small>{{ t('creators.categoryRequired') }}</small>
    </fieldset>
    <label class="creator-field"><span>{{ t('creators.baseStars') }}</span><select v-model.number="draft.baseStars" :disabled="disabled" data-testid="creator-stars"><option v-for="stars in 5" :key="stars" :value="stars">{{ t('creators.starOption', { count: stars }) }}</option></select><small>{{ t('creators.baseStarsHint') }}</small></label>
    <label class="creator-check"><input v-model="assessed" type="checkbox" :disabled="disabled" data-testid="creator-assessed" @change="setAssessed"><span>{{ t('creators.assess') }}</span></label>
    <label v-if="assessed" class="creator-field"><span>{{ t('creators.level') }}</span><select v-model.number="draft.levelId" required :disabled="disabled" data-testid="creator-level"><option :value="null" disabled>{{ t('creators.selectLevel') }}</option><option v-for="level in levels" :key="level.id" :value="level.id">{{ level.name }}</option></select></label>
    <section class="creator-avatar-editor" :aria-label="t('creators.avatar')">
      <h3>{{ t('creators.avatar') }}</h3>
      <img v-if="avatarSource" :src="avatarSource" :alt="t('creators.avatarAlt', { name: draft.name })" class="creator-avatar-preview" data-testid="creator-avatar-preview">
      <Banner v-if="!avatarUploadsAvailable">{{ t('creators.avatarUnavailable') }}</Banner>
      <FileDrop :files="files" purpose="image" image-single :image-label="t('creators.chooseAvatar')" :image-hint="t('creators.avatarHint')" :disabled="disabled || !avatarUploadsAvailable" :show-preview="false" :allow-folder="false" @update:files="pickAvatar" />
      <p v-if="uploading" role="status">{{ t('creators.uploading') }}</p>
      <Banner v-if="uploadError" tone="danger">{{ apiErrorLabel(t, te, uploadError) }}</Banner>
      <Banner v-if="cleanupFailed" tone="warning">{{ t('creators.avatarCleanupFailed') }}</Banner>
      <div class="creator-actions"><AppButton v-if="uploadError && files.length" :disabled="disabled || !avatarUploadsAvailable" @click="pickAvatar(files)">{{ t('creators.retryUpload') }}</AppButton><AppButton v-if="avatarSource || files.length" :disabled="disabled" data-testid="creator-avatar-clear" @click="clearAvatar">{{ t('creators.clearAvatar') }}</AppButton></div>
    </section>
    <AppButton variant="primary" type="submit" :disabled="disabled || uploading || !!uploadError" data-testid="creator-save">{{ t(busy || submitting ? 'creators.saving' : 'creators.save') }}</AppButton>
  </form>
</template>
