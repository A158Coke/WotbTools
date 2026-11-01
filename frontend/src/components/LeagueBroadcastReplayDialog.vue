<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from './AppDialog.vue'
import AppButton from './AppButton.vue'
import Banner from './Banner.vue'
import FileDrop from './FileDrop.vue'
import { broadcastSeasonName } from '../utils/display.js'
import { BROADCAST_ADMIN_OFFSET, BROADCAST_INPUT_OFFSETS, broadcastInputFields, broadcastInputInstant, broadcastMatchDate } from '../utils/broadcastTime.js'
import { broadcastCoverUrl } from '../api/league-broadcasts.js'
import type { BroadcastCategory, BroadcastNode, BroadcastReplay, BroadcastReplaySave, BroadcastTimedReplaySave, BroadcastSeason } from '../api/league-broadcasts.js'

const props = defineProps<{
  open: boolean; season: BroadcastSeason; category: BroadcastCategory; node: BroadcastNode;
  replay?: BroadcastReplay | null; busy: boolean; coverUploadAvailable: boolean; errorText?: string; defaultTimeZone: string
}>()
const emit = defineEmits<{ close: []; reload: []; save: [value: BroadcastTimedReplaySave, cover: File | null] }>()
const { t, locale } = useI18n()
const formId = `broadcast-replay-${useId()}`
const draft = ref({ title: '', url: '', matchDate: '', time: '', dayNumber: 1, groupNumber: '' as number | string,
  bracket: 'DEFAULT' as NonNullable<BroadcastReplaySave['bracket']>, teams: ['', '', '', ''], perspective: 'POV' as BroadcastReplaySave['perspective'] })
const files = ref<File[]>([]), preview = ref(''), removeCover = ref(false), invalid = ref(false)
const inputOffset = ref<number>(BROADCAST_ADMIN_OFFSET)
let originalInstant: string | null = null
const matchDateEdited = ref(false)
let expectedVersion = 0
const points = computed(() => props.category.type === 'POINTS')
const grouped = computed(() => props.category.type === 'SEMI_FINALS'
  || (props.category.type === 'QUARTER_FINALS' && props.node.format === 'KNOCKOUT'))
const context = computed(() => [t(`leagueBroadcasts.servers.${props.season.server}`),
  `${props.season.year} ${broadcastSeasonName(props.season, locale.value)}`, t(`leagueBroadcasts.categories.${props.category.type}`),
  ...(points.value ? [t('leagueBroadcasts.roundLabel', { round: props.node.roundNumber })] : []),
  t('leagueBroadcasts.dayLabel', { day: draft.value.dayNumber })].join(' · '))
const coverSource = computed(() => preview.value || (!removeCover.value && props.replay?.coverId ? broadcastCoverUrl(props.replay.coverId) : ''))

function releasePreview() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
}
watch(files, values => {
  releasePreview()
  if (values[0]) preview.value = URL.createObjectURL(values[0])
})
watch(() => props.open, open => {
  files.value = []; removeCover.value = false; invalid.value = false
  releasePreview()
  if (!open) return
  expectedVersion = props.season.version
  const value = props.replay
  inputOffset.value = BROADCAST_ADMIN_OFFSET
  originalInstant = value?.startsAt ?? null
  matchDateEdited.value = false
  draft.value = {
    title: value?.title ?? '', url: value?.url ?? '', ...broadcastInputFields(value?.matchDate ?? '', originalInstant), dayNumber: value?.dayNumber ?? 1,
    groupNumber: value?.groupNumber ?? '', bracket: value?.bracket ?? 'DEFAULT',
    teams: Array.from({ length: 4 }, (_, index) => value?.teams[index] ?? ''), perspective: value?.perspective ?? 'POV',
  }
}, { immediate: true })
watch(() => draft.value.time, (time, previous) => {
  if (!time && previous && originalInstant && !matchDateEdited.value && props.replay) {
    draft.value.matchDate = props.replay.matchDate
  }
})
onScopeDispose(releasePreview)

function inputInstant() {
  if (originalInstant) {
    const original = broadcastInputFields('', originalInstant, inputOffset.value)
    if (original.matchDate === draft.value.matchDate && original.time === draft.value.time) return originalInstant
  }
  return broadcastInputInstant(draft.value.matchDate, draft.value.time, inputOffset.value)
}
function changeInputOffset(event: Event) {
  const next = Number((event.target as HTMLSelectElement).value)
  const instant = inputInstant()
  if (instant) Object.assign(draft.value, broadcastInputFields(draft.value.matchDate, instant, next))
  inputOffset.value = next
}

function submit() {
  if (props.busy) return
  const value = draft.value
  let validUrl = false
  try { validUrl = ['http:', 'https:'].includes(new URL(value.url.trim()).protocol) } catch { /* Report with the other fields. */ }
  const groupNumber = value.groupNumber === '' ? null : Number(value.groupNumber)
  const startsAt = inputInstant()
  const valid = value.title.trim() && value.title.trim().length <= 200 && validUrl && value.url.trim().length <= 2048
    && /^\d{4}-\d{2}-\d{2}$/.test(value.matchDate) && Number.isInteger(value.dayNumber) && value.dayNumber > 0
    && startsAt !== undefined
    && value.teams[0].trim() && value.teams[1].trim() && value.teams.every(team => team.trim().length <= 100)
    && (!(points.value || grouped.value) || groupNumber === null || (Number.isInteger(groupNumber) && groupNumber >= 1 && groupNumber <= (points.value ? 2147483647 : 4)))
    && (!files.value.length || props.coverUploadAvailable)
  invalid.value = !valid
  if (!valid) return
  emit('save', { startsAt: startsAt ?? null, replay: {
    expectedVersion, title: value.title.trim(), url: value.url.trim(), matchDate: startsAt ? broadcastMatchDate(startsAt, props.defaultTimeZone) : value.matchDate, dayNumber: value.dayNumber,
    groupNumber: points.value || grouped.value ? groupNumber : null,
    bracket: grouped.value ? value.bracket : null, teams: value.teams.map(team => team.trim()).filter(Boolean), perspective: value.perspective,
    coverAction: files.value.length ? 'REPLACE' : removeCover.value ? 'REMOVE' : 'KEEP',
  } }, files.value[0] ?? null)
}
</script>

<template>
  <AppDialog :open="open" :title="t(replay ? 'leagueBroadcasts.editReplay' : 'leagueBroadcasts.newReplay')" size="lg" :close-on-scrim="false" data-testid="broadcast-replay-dialog" @close="!busy && emit('close')">
    <form :id="formId" class="broadcast-form" @submit.prevent="submit">
      <p class="broadcast-context" data-testid="broadcast-replay-context">{{ context }}</p>
      <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner>
      <Banner v-if="invalid" tone="danger">{{ t('leagueBroadcasts.invalidForm') }}</Banner>
      <label class="broadcast-field"><span>{{ t('leagueBroadcasts.titleField') }}</span><input v-model="draft.title" required maxlength="200" :disabled="busy" data-autofocus data-testid="broadcast-title"><small>{{ t('leagueBroadcasts.shortTitle') }}</small></label>
      <label class="broadcast-field"><span>{{ t('leagueBroadcasts.link') }}</span><input v-model="draft.url" type="url" required maxlength="2048" :disabled="busy" data-testid="broadcast-url"></label>
      <div class="broadcast-form-grid">
        <label class="broadcast-field"><span>{{ t('leagueBroadcasts.day') }}</span><input v-model.number="draft.dayNumber" type="number" min="1" max="2147483647" step="1" required :disabled="busy" data-testid="broadcast-day"></label>
        <label class="broadcast-field"><span>{{ t('leagueBroadcasts.matchDate') }}</span><input v-model="draft.matchDate" type="date" required :disabled="busy" data-testid="broadcast-date" @input="matchDateEdited = true"></label>
        <label class="broadcast-field"><span>{{ t('leagueBroadcasts.matchTime') }} · {{ t('leagueBroadcasts.optional') }}</span><input v-model="draft.time" type="time" step="0.001" :disabled="busy" data-testid="broadcast-time"><small>{{ t('leagueBroadcasts.matchTimeHint') }}</small></label>
        <label class="broadcast-field"><span>{{ t('leagueBroadcasts.inputTimeZone') }}</span><select :value="inputOffset" :disabled="busy" data-testid="broadcast-input-time-zone" @change="changeInputOffset"><option v-for="offset in BROADCAST_INPUT_OFFSETS" :key="offset" :value="offset">{{ t(`leagueBroadcasts.inputOffsets.${offset}`) }}</option></select><small>{{ t('leagueBroadcasts.inputTimeZoneHint') }}</small></label>
        <label v-if="points" class="broadcast-field"><span>{{ t('leagueBroadcasts.groupNumber') }} · {{ t('leagueBroadcasts.optional') }}</span><input v-model.number="draft.groupNumber" type="number" min="1" max="2147483647" step="1" :disabled="busy" data-testid="broadcast-group-number"></label>
        <template v-if="grouped">
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.groupNumber') }} · {{ t('leagueBroadcasts.optional') }}</span><select v-model.number="draft.groupNumber" :disabled="busy" data-testid="broadcast-group-number"><option value="">{{ t('leagueBroadcasts.noGroup') }}</option><option v-for="value in 4" :key="value" :value="value">{{ value }}</option></select></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.bracket') }}</span><select v-model="draft.bracket" :disabled="busy" data-testid="broadcast-bracket"><option v-for="value in ['DEFAULT', 'WINNERS', 'LOSERS']" :key="value" :value="value">{{ t(`leagueBroadcasts.brackets.${value}`) }}</option></select></label>
        </template>
      </div>
      <fieldset class="broadcast-teams"><legend>{{ t('leagueBroadcasts.teams') }}</legend>
        <div class="broadcast-form-grid"><label v-for="(_, index) in draft.teams" :key="index" class="broadcast-field"><span>{{ index === 0 ? t('leagueBroadcasts.followedTeam') : t('leagueBroadcasts.otherTeam', { number: index + 1 }) }}<small v-if="index > 1"> · {{ t('leagueBroadcasts.optional') }}</small></span><input v-model="draft.teams[index]" :required="index < 2" maxlength="100" :disabled="busy" :data-testid="`broadcast-team-${index}`"></label></div>
      </fieldset>
      <label class="broadcast-field"><span>{{ t('leagueBroadcasts.perspective') }}</span><select v-model="draft.perspective" :disabled="busy" data-testid="broadcast-perspective"><option v-for="value in ['POV', 'OBSERVER']" :key="value" :value="value">{{ t(`leagueBroadcasts.perspectives.${value}`) }}</option></select></label>
      <section class="broadcast-cover">
        <h3>{{ t('leagueBroadcasts.cover') }}</h3>
        <Banner v-if="!coverUploadAvailable">{{ t('api_errors.BROADCAST_STORAGE_UNAVAILABLE') }}</Banner>
        <FileDrop :files="files" purpose="image" image-single :image-label="t('leagueBroadcasts.chooseCover')" :image-hint="t('leagueBroadcasts.coverHint')" :disabled="busy || !coverUploadAvailable" @update:files="files = $event" />
        <img v-if="coverSource" :src="coverSource" :alt="t('leagueBroadcasts.coverAlt', { title: draft.title })" class="broadcast-cover-preview" data-testid="broadcast-cover-preview">
        <AppButton v-if="replay?.coverId && !files.length" :disabled="busy" data-testid="broadcast-remove-cover" @click="removeCover = !removeCover">{{ t(removeCover ? 'leagueBroadcasts.restoreCover' : 'leagueBroadcasts.removeCover') }}</AppButton>
      </section>
    </form>
    <template #actions><AppButton :disabled="busy" @click="emit('close')">{{ t('leagueBroadcasts.cancel') }}</AppButton><AppButton v-if="errorText" :disabled="busy" data-testid="broadcast-editor-reload" @click="emit('reload')">{{ t('leagueBroadcasts.reloadEditor') }}</AppButton><AppButton variant="primary" type="submit" :form="formId" :disabled="busy" data-testid="broadcast-replay-save">{{ t(busy ? 'leagueBroadcasts.saving' : 'leagueBroadcasts.save') }}</AppButton></template>
  </AppDialog>
</template>

<style scoped>
.broadcast-form, .broadcast-cover { display: grid; gap: var(--space-4); }
.broadcast-context { overflow-wrap: anywhere; }
.broadcast-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.broadcast-field { display: grid; gap: var(--space-1); min-width: 0; font: var(--type-body); color: var(--color-text-primary); }
.broadcast-field input, .broadcast-field select { width: 100%; min-width: 0; min-height: var(--control-h-md); padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); font: inherit; }
.broadcast-field input:focus-visible, .broadcast-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.broadcast-field small { color: var(--color-text-secondary); font: var(--type-caption); }
.broadcast-teams { min-width: 0; margin: 0; padding: var(--space-3); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); }
.broadcast-teams legend, .broadcast-cover h3 { margin: 0; color: var(--color-text-primary); font: var(--type-body); }
.broadcast-cover-preview { display: block; width: 100%; max-height: var(--broadcast-cover-max-h); object-fit: contain; }
@media (width < 768px) { .broadcast-form-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
