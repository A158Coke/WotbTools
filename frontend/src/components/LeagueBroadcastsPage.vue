<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2, Pencil } from 'lucide-vue-next'
import PageHeader from './PageHeader.vue'
import AppButton from './AppButton.vue'
import AppDialog from './AppDialog.vue'
import Banner from './Banner.vue'
import LeagueBroadcastReplayDialog from './LeagueBroadcastReplayDialog.vue'
import { useLeagueBroadcasts } from '../composables/useLeagueBroadcasts.js'
import * as api from '../api/league-broadcasts.js'
import type { BroadcastCategory, BroadcastNode, BroadcastReplay, BroadcastReplaySave, BroadcastSeason } from '../api/league-broadcasts.js'
import { apiErrorLabel } from '../utils/display.js'

const { t, te } = useI18n()
const state = reactive(useLeagueBroadcasts())
const dialog = ref<'' | 'season' | 'category' | 'node'>('')
const editingSeason = ref<BroadcastSeason | null>(null)
const replayEditor = ref<{ node: BroadcastNode; replay: BroadcastReplay | null } | null>(null)
const expanded = ref(new Set<number>()), failedCovers = ref(new Set<string>())
const invalid = ref(false)
const form = reactive({ year: new Date().getFullYear(), name: '', startDate: '', type: 'POINTS' as BroadcastCategory['type'], roundNumber: 1, format: 'ROUND_ROBIN' as NonNullable<BroadcastNode['format']>, expectedVersion: 0 })
const errorText = computed(() => state.error ? apiErrorLabel(t, te, state.error) : '')
const remainingCategories = computed(() => api.BROADCAST_CATEGORIES.filter(type => !state.categories.some(category => category.type === type)))
const remainingRounds = computed(() => [1, 2, 3, 4, 5].filter(round => !state.nodes.some(node => node.roundNumber === round)))
const canAddNode = computed(() => state.category?.type === 'POINTS' ? remainingRounds.value.length > 0 : state.nodes.length === 0)
const dialogTitle = computed(() => t(dialog.value === 'season' ? (editingSeason.value ? 'leagueBroadcasts.editSeason' : 'leagueBroadcasts.newSeason')
  : dialog.value === 'category' ? 'leagueBroadcasts.newCategory' : 'leagueBroadcasts.newNode'))
const pageTitle = computed(() => state.category ? t(`leagueBroadcasts.categories.${state.category.type}`)
  : state.season ? `${state.season.year} ${state.season.name}` : state.server ? t(`leagueBroadcasts.servers.${state.server}`) : t('leagueBroadcasts.title'))

function nodeTitle(node: BroadcastNode) {
  return state.category?.type === 'POINTS' ? t('leagueBroadcasts.roundLabel', { round: node.roundNumber })
    : [t(`leagueBroadcasts.categories.${state.category?.type}`), node.format ? t(`leagueBroadcasts.formats.${node.format}`) : ''].filter(Boolean).join(' · ')
}
const displayNodes = computed(() => state.nodes.map(node => ({ ...node, label: nodeTitle(node),
  records: node.replays.map(replay => ({ ...replay,
    metadata: [replay.matchDate, t('leagueBroadcasts.dayLabel', { day: replay.dayNumber }),
      state.category?.type === 'POINTS' ? t('leagueBroadcasts.roundLabel', { round: node.roundNumber }) : '',
      replay.groupLabel, replay.groupNumber ? t('leagueBroadcasts.groupNumberLabel', { group: replay.groupNumber }) : '',
      replay.bracket ? t(`leagueBroadcasts.brackets.${replay.bracket}`) : '', t(`leagueBroadcasts.perspectives.${replay.perspective}`)].filter(Boolean).join(' · '),
    teamLabel: [t('leagueBroadcasts.following', { team: replay.teams[0] }), ...replay.teams.slice(1)].join(' / '),
    coverUrl: replay.coverId && !failedCovers.value.has(replay.coverId) ? api.broadcastCoverUrl(replay.coverId) : '',
  })) })))

watch(() => state.contextKey, () => { expanded.value = new Set(); failedCovers.value = new Set() })
watch(() => state.editorEpoch, () => { dialog.value = ''; replayEditor.value = null; invalid.value = false })
function toggle(id: number) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expanded.value = next
}
function openSeason(value: BroadcastSeason | null = null) {
  editingSeason.value = value
  Object.assign(form, { year: value?.year ?? new Date().getFullYear(), name: value?.name ?? '', startDate: value?.startDate ?? '', expectedVersion: value?.version ?? 0 })
  invalid.value = false; dialog.value = 'season'
}
function openStructure(kind: 'category' | 'node') {
  form.expectedVersion = state.season?.version ?? 0
  form.type = remainingCategories.value[0] ?? 'POINTS'
  form.roundNumber = remainingRounds.value[0] ?? 1
  form.format = 'ROUND_ROBIN'
  invalid.value = false; dialog.value = kind
}
async function saveStructure() {
  if (!state.allowed || !state.server) return
  if (dialog.value === 'season') {
    if (!Number.isInteger(form.year) || form.year < 1 || form.year > 9999 || !form.name.trim()) { invalid.value = true; return }
    const value = { year: form.year, name: form.name.trim(), startDate: form.startDate || null }
    const existing = editingSeason.value
    await state.mutate(signal => existing ? api.updateBroadcastSeason(existing.id, { ...value, expectedVersion: form.expectedVersion }, signal)
      : api.createBroadcastSeason({ ...value, server: state.server! }, signal))
  } else if (dialog.value === 'category' && state.season) {
    await state.mutate(signal => api.createBroadcastCategory(state.season!.id, { expectedVersion: form.expectedVersion, type: form.type }, signal))
  } else if (dialog.value === 'node' && state.category) {
    const value = { expectedVersion: form.expectedVersion, roundNumber: state.category.type === 'POINTS' ? form.roundNumber : null,
      format: state.category.type === 'QUARTER_FINALS' ? form.format : null }
    await state.mutate(signal => api.createBroadcastNode(state.category!.id, value, signal))
  }
}
async function saveReplay(value: BroadcastReplaySave, cover: File | null) {
  const editor = replayEditor.value
  if (!editor) return
  expanded.value = new Set([...expanded.value, editor.node.id])
  await state.mutate(signal => api.saveBroadcastReplay({ nodeId: editor.node.id, replayId: editor.replay?.id }, value, cover, signal))
}
async function reloadEditor() {
  const editor = replayEditor.value, kind = dialog.value, seasonId = editingSeason.value?.id, context = state.contextKey
  await state.refresh()
  if (!state.allowed || state.readFailed || context !== state.contextKey) return
  if (editor) {
    const node = state.nodes.find(value => value.id === editor.node.id)
    const replay = editor.replay ? node?.replays.find(value => value.id === editor.replay!.id) : null
    if (node && (!editor.replay || replay)) replayEditor.value = { node, replay: replay ?? null }
  } else if (kind === 'season') {
    const latest = seasonId ? state.seasons.find(value => value.id === seasonId) : null
    if (!seasonId || latest) openSeason(latest ?? null)
  } else if (kind === 'category' || kind === 'node') openStructure(kind)
}
function goBack() {
  void state.navigate(state.categoryId ? { server: state.server, season: state.seasonId }
    : state.seasonId ? { server: state.server } : {})
}
function coverFailed(id: string | null) { if (id) failedCovers.value = new Set([...failedCovers.value, id]) }
async function refreshPage() {
  failedCovers.value = new Set()
  await state.refresh()
}
</script>

<template>
  <div class="broadcast-page layout-wide" data-testid="league-broadcasts-page">
    <PageHeader :title="pageTitle"><template #actions>
      <AppButton v-if="state.server" :disabled="state.busy" data-testid="broadcast-back" @click="goBack">{{ t('leagueBroadcasts.back') }}</AppButton>
      <AppButton :disabled="state.loading || state.busy || !state.network.available" data-testid="broadcast-refresh" @click="refreshPage">{{ t('leagueBroadcasts.refresh') }}</AppButton>
      <template v-if="state.allowed && state.network.available && !state.loading">
        <AppButton v-if="state.server && !state.seasonId" variant="primary" :disabled="state.busy" data-testid="broadcast-new-season" @click="openSeason()"><Plus :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.newSeason') }}</AppButton>
        <AppButton v-else-if="state.season && !state.categoryId" variant="primary" :disabled="state.busy || !remainingCategories.length" data-testid="broadcast-new-category" @click="openStructure('category')">{{ t('leagueBroadcasts.newCategory') }}</AppButton>
        <AppButton v-else-if="state.category" variant="primary" :disabled="state.busy || !canAddNode" data-testid="broadcast-new-node" @click="openStructure('node')">{{ t('leagueBroadcasts.newNode') }}</AppButton>
      </template>
    </template></PageHeader>
    <nav v-if="state.server" class="broadcast-breadcrumbs" :aria-label="t('leagueBroadcasts.title')">
      <button type="button" @click="state.navigate({})">{{ t('leagueBroadcasts.title') }}</button>
      <button type="button" @click="state.navigate({ server: state.server })">{{ t(`leagueBroadcasts.servers.${state.server}`) }}</button>
      <button v-if="state.season" type="button" @click="state.navigate({ server: state.server, season: state.season.id })">{{ state.season.year }} · {{ state.season.name }}</button>
      <span v-if="state.category" aria-current="page">{{ t(`leagueBroadcasts.categories.${state.category.type}`) }}</span>
    </nav>
    <Banner v-if="!state.network.available && !state.network.pending">{{ t(state.network.messageKey || 'featureOffline.leagueBroadcasts') }}</Banner>
    <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner>
    <Banner v-if="state.notice">{{ t(`leagueBroadcasts.${state.notice}`) }}</Banner>
    <p v-if="state.loading || state.network.pending" role="status">{{ t('leagueBroadcasts.loading') }}</p>
    <template v-else-if="state.network.available && !state.readFailed">
      <div v-if="!state.server" class="broadcast-card-grid broadcast-servers" data-testid="broadcast-servers">
        <button v-for="server in state.servers" :key="server" type="button" class="broadcast-choice" :data-testid="`broadcast-server-${server}`" @click="state.navigate({ server })"><span>{{ t(`leagueBroadcasts.servers.${server}`) }}</span><ChevronRight :size="20" aria-hidden="true" /></button>
      </div>
      <section v-else-if="!state.seasonId" class="broadcast-list" data-testid="broadcast-seasons">
        <p v-if="!state.seasons.length">{{ t('leagueBroadcasts.noSeasons') }}</p>
        <article v-for="season in state.seasons" :key="season.id" class="broadcast-season-row" :data-testid="`broadcast-season-${season.id}`">
          <div class="broadcast-row-title"><h2>{{ season.year }} · {{ season.name }}</h2><span v-if="season.startDate">{{ season.startDate }}</span></div>
          <div v-if="state.allowed" class="broadcast-actions"><AppButton :disabled="state.busy" :aria-label="t('leagueBroadcasts.editSeason')" :data-testid="`broadcast-edit-season-${season.id}`" @click="openSeason(season)"><Pencil :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.edit') }}</AppButton><AppButton variant="danger" :disabled="state.busy" :data-testid="`broadcast-delete-season-${season.id}`" @click="state.remove('seasons', season.id, season.name, t)"><Trash2 :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.delete') }}</AppButton></div>
          <AppButton class="broadcast-enter" :aria-label="t('leagueBroadcasts.enter', { name: `${season.year} ${season.name}` })" :data-testid="`broadcast-enter-season-${season.id}`" @click="state.navigate({ server: state.server, season: season.id })"><ChevronRight :size="20" aria-hidden="true" /></AppButton>
        </article>
      </section>
      <section v-else-if="!state.categoryId" data-testid="broadcast-categories">
        <p v-if="!state.categories.length">{{ t('leagueBroadcasts.noCategories') }}</p>
        <div class="broadcast-card-grid"><button v-for="category in state.categories" :key="category.id" type="button" class="broadcast-choice" :data-testid="`broadcast-category-${category.id}`" @click="state.navigate({ server: state.server, season: state.seasonId, category: category.id })"><span>{{ t(`leagueBroadcasts.categories.${category.type}`) }}</span><ChevronRight :size="20" aria-hidden="true" /></button></div>
      </section>
      <section v-else class="broadcast-list" data-testid="broadcast-nodes">
        <p v-if="!displayNodes.length">{{ t('leagueBroadcasts.noNodes') }}</p>
        <article v-for="node in displayNodes" :key="node.id" class="broadcast-node">
          <header class="broadcast-node-header">
            <button type="button" class="broadcast-disclosure" :aria-expanded="expanded.has(node.id)" :aria-controls="`broadcast-records-${node.id}`" :data-testid="`broadcast-node-toggle-${node.id}`" @click="toggle(node.id)"><component :is="expanded.has(node.id) ? ChevronDown : ChevronRight" :size="20" aria-hidden="true" /><span>{{ node.label }}</span><small>{{ t('leagueBroadcasts.replayCount', { count: node.replays.length }) }}</small></button>
            <div v-if="state.allowed" class="broadcast-actions">
              <AppButton :disabled="state.busy" :aria-label="t('leagueBroadcasts.newReplay')" :title="t('leagueBroadcasts.newReplay')" :data-testid="`broadcast-new-replay-${node.id}`" @click="replayEditor = { node, replay: null }"><Plus :size="20" aria-hidden="true" /></AppButton>
              <AppButton variant="danger" :disabled="state.busy" :aria-label="t('leagueBroadcasts.nodeDeleteTitle')" :title="t('leagueBroadcasts.nodeDeleteTitle')" :data-testid="`broadcast-delete-node-${node.id}`" @click="state.remove('nodes', node.id, node.label, t)"><Trash2 :size="18" aria-hidden="true" /></AppButton>
            </div>
          </header>
          <div v-if="expanded.has(node.id)" :id="`broadcast-records-${node.id}`" class="broadcast-records">
            <p v-if="!node.records.length">{{ t('leagueBroadcasts.noReplays') }}</p>
            <article v-for="replay in node.records" :key="replay.id" class="broadcast-record" :data-testid="`broadcast-replay-${replay.id}`">
              <img v-if="replay.coverUrl" :src="replay.coverUrl" :alt="t('leagueBroadcasts.coverAlt', { title: replay.title })" class="broadcast-thumbnail" loading="lazy" @error="coverFailed(replay.coverId)">
              <div class="broadcast-record-text"><h3>{{ replay.title }}</h3><p>{{ replay.metadata }}</p><p>{{ replay.teamLabel }}</p></div>
              <div class="broadcast-actions"><AppButton :href="replay.url" target="_blank" rel="noopener noreferrer">{{ t('leagueBroadcasts.open') }}<ExternalLink :size="16" aria-hidden="true" /></AppButton><template v-if="state.allowed"><AppButton :disabled="state.busy" :data-testid="`broadcast-edit-replay-${replay.id}`" @click="replayEditor = { node, replay }">{{ t('leagueBroadcasts.edit') }}</AppButton><AppButton variant="danger" :disabled="state.busy" :data-testid="`broadcast-delete-replay-${replay.id}`" @click="state.remove('replays', replay.id, replay.title, t)">{{ t('leagueBroadcasts.delete') }}</AppButton></template></div>
            </article>
          </div>
        </article>
      </section>
    </template>

    <AppDialog :open="!!dialog && state.allowed" :title="dialogTitle" :close-on-scrim="false" data-testid="broadcast-structure-dialog" @close="!state.busy && (dialog = '')">
      <form id="broadcast-structure-form" class="broadcast-form" @submit.prevent="saveStructure">
        <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner><Banner v-if="invalid" tone="danger">{{ t('leagueBroadcasts.invalidForm') }}</Banner>
        <template v-if="dialog === 'season'">
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.year') }}</span><input v-model.number="form.year" type="number" min="1" max="9999" step="1" required :disabled="state.busy" data-testid="broadcast-season-year"></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.seasonName') }}</span><input v-model="form.name" required maxlength="100" :disabled="state.busy" data-testid="broadcast-season-name"></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.startDate') }}</span><input v-model="form.startDate" type="date" :disabled="state.busy" data-testid="broadcast-season-start-date"></label>
        </template>
        <label v-else-if="dialog === 'category'" class="broadcast-field"><span>{{ t('leagueBroadcasts.category') }}</span><select v-model="form.type" :disabled="state.busy" data-testid="broadcast-category-type"><option v-for="type in remainingCategories" :key="type" :value="type">{{ t(`leagueBroadcasts.categories.${type}`) }}</option></select></label>
        <template v-else-if="dialog === 'node'">
          <p>{{ t(`leagueBroadcasts.categories.${state.category?.type}`) }}</p>
          <label v-if="state.category?.type === 'POINTS'" class="broadcast-field"><span>{{ t('leagueBroadcasts.round') }}</span><select v-model.number="form.roundNumber" :disabled="state.busy" data-testid="broadcast-node-round"><option v-for="round in remainingRounds" :key="round" :value="round">{{ round }}</option></select></label>
          <label v-if="state.category?.type === 'QUARTER_FINALS'" class="broadcast-field"><span>{{ t('leagueBroadcasts.format') }}</span><select v-model="form.format" :disabled="state.busy" data-testid="broadcast-node-format"><option v-for="format in ['ROUND_ROBIN', 'KNOCKOUT']" :key="format" :value="format">{{ t(`leagueBroadcasts.formats.${format}`) }}</option></select></label>
          <p>{{ t('leagueBroadcasts.immutable') }}</p>
        </template>
      </form>
      <template #actions><AppButton :disabled="state.busy" @click="dialog = ''">{{ t('leagueBroadcasts.cancel') }}</AppButton><AppButton v-if="errorText" :disabled="state.busy" data-testid="broadcast-editor-reload" @click="reloadEditor">{{ t('leagueBroadcasts.reloadEditor') }}</AppButton><AppButton type="submit" form="broadcast-structure-form" variant="primary" :disabled="state.busy" data-testid="broadcast-structure-save">{{ t(state.busy ? 'leagueBroadcasts.saving' : 'leagueBroadcasts.save') }}</AppButton></template>
    </AppDialog>
    <LeagueBroadcastReplayDialog v-if="replayEditor && state.season && state.category && state.allowed" :open="true" :season="state.season" :category="state.category" :node="replayEditor.node" :replay="replayEditor.replay" :busy="state.busy" :cover-upload-available="state.coverUploadAvailable" :error-text="errorText" @close="replayEditor = null" @reload="reloadEditor" @save="saveReplay" />
  </div>
</template>

<style scoped>
.broadcast-page { display: grid; gap: var(--space-4); }
.broadcast-breadcrumbs, .broadcast-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.broadcast-breadcrumbs { color: var(--color-text-secondary); font: var(--type-caption); }
.broadcast-breadcrumbs button { min-height: var(--control-h-md); padding: 0 var(--space-2); border: 0; background: transparent; color: var(--color-accent-text); font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.broadcast-card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--form-field-min)), 1fr)); gap: var(--space-4); }
.broadcast-choice { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--control-h-lg); padding: var(--space-6); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-h3); cursor: pointer; text-align: start; }
.broadcast-choice span { min-width: 0; overflow-wrap: anywhere; }
.broadcast-choice svg { flex: none; }
.broadcast-servers { grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--broadcast-server-card-min-w)), 1fr)); }
.broadcast-servers .broadcast-choice { min-height: var(--broadcast-server-card-min-h); padding: var(--space-8); font: var(--type-h2); }
.broadcast-list { display: grid; gap: var(--space-3); }
.broadcast-season-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-md); background: var(--color-surface-1); }
.broadcast-row-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.broadcast-row-title h2 { margin: 0 0 var(--space-1); color: var(--color-text-primary); font: var(--type-h3); }
.broadcast-row-title span { color: var(--color-text-secondary); font: var(--type-caption); }
.broadcast-enter { flex: none; }
.broadcast-node { overflow: hidden; border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.broadcast-node-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); }
.broadcast-disclosure { display: flex; align-items: center; flex: 1; flex-wrap: wrap; gap: var(--space-2); min-width: 0; min-height: var(--control-h-md); padding: var(--space-2); border: 0; background: transparent; color: var(--color-text-primary); font: var(--type-h3); cursor: pointer; text-align: start; }
.broadcast-disclosure small { color: var(--color-text-secondary); font: var(--type-caption); }
.broadcast-disclosure span { overflow-wrap: anywhere; }
.broadcast-records { display: grid; gap: var(--space-3); padding: var(--space-4); border-top: var(--border-width) solid var(--color-border-subtle); }
.broadcast-record { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); padding-block: var(--space-3); }
.broadcast-thumbnail { width: min(100%, var(--broadcast-cover-thumbnail-w)); height: auto; object-fit: contain; border-radius: var(--radius-sm); }
.broadcast-record-text { flex: 1; min-width: min(100%, var(--form-field-min)); overflow-wrap: anywhere; }
.broadcast-record-text h3 { margin: 0 0 var(--space-2); color: var(--color-text-primary); font: var(--type-h3); }
.broadcast-record-text p { margin: var(--space-1) 0; color: var(--color-text-secondary); font: var(--type-body); }
.broadcast-form, .broadcast-field { display: grid; gap: var(--space-2); }
.broadcast-form { gap: var(--space-4); }
.broadcast-field { min-width: 0; color: var(--color-text-primary); font: var(--type-body); }
.broadcast-field input, .broadcast-field select { width: 100%; min-width: 0; min-height: var(--control-h-md); padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); font: inherit; }
.broadcast-choice:focus-visible, .broadcast-disclosure:focus-visible, .broadcast-breadcrumbs button:focus-visible, .broadcast-field input:focus-visible, .broadcast-field select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
@media (hover: hover) { .broadcast-choice:hover { border-color: var(--color-accent); background: var(--color-surface-2); } }
@media (width < 768px) {
  .broadcast-season-row { flex-wrap: wrap; }
  .broadcast-row-title { flex-basis: calc(100% - var(--control-h-lg) - var(--space-3)); }
  .broadcast-season-row > .broadcast-actions { order: 1; flex-basis: 100%; }
  .broadcast-node-header { flex-wrap: wrap; }
  .broadcast-disclosure { flex-basis: 100%; }
  .broadcast-node-header > .broadcast-actions { margin-inline-start: auto; }
  .broadcast-record { align-items: flex-start; flex-direction: column; }
  .broadcast-record-text { min-width: 0; width: 100%; }
}
</style>
