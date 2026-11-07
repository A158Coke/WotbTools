<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Clock3, ExternalLink, Plus, Trash2, Pencil } from 'lucide-vue-next'
import ShowcaseHero from './ShowcaseHero.vue'
import SegmentedControl from './SegmentedControl.vue'
import AppButton from './AppButton.vue'
import MenuButton from './MenuButton.vue'
import AppDialog from './AppDialog.vue'
import Banner from './Banner.vue'
import LeagueBroadcastReplayDialog from './LeagueBroadcastReplayDialog.vue'
import { useLeagueBroadcasts } from '../composables/useLeagueBroadcasts.js'
import * as api from '../api/league-broadcasts.js'
import type { BroadcastCategory, BroadcastNode, BroadcastReplay, BroadcastTimedReplaySave, BroadcastSeason } from '../api/league-broadcasts.js'
import { apiErrorLabel, broadcastSeasonName } from '../utils/display.js'
import { BROADCAST_DISPLAY_ZONES, formatBroadcastDate } from '../utils/broadcastTime.js'

const { t, te, locale } = useI18n()
const state = reactive(useLeagueBroadcasts())
const dialog = ref<'' | 'season' | 'category' | 'node'>('')
const editingSeason = ref<BroadcastSeason | null>(null)
const structureCategory = ref<BroadcastCategory | null>(null)
const replayCategory = computed(() => state.categories.find(category => category.id === replayEditor.value?.node.categoryId) ?? null)
const replayEditor = ref<{ node: BroadcastNode; replay: BroadcastReplay | null } | null>(null)
const failedCovers = ref(new Set<string>())
/** 当前选中的轮次（本页视图状态，不进 URL）；赛段由 URL 的 lbCategory 决定，缺省为第一个。 */
const selectedNodeId = ref<number | null>(null)
const invalid = ref(false)
const form = reactive({ year: new Date().getFullYear(), nameZh: '', nameEn: '', nameRu: '', startDate: '', type: 'POINTS' as BroadcastCategory['type'], roundNumber: 1, format: 'ROUND_ROBIN' as NonNullable<BroadcastNode['format']>, expectedVersion: 0 })
const errorText = computed(() => state.error ? apiErrorLabel(t, te, state.error) : '')
const remainingCategories = computed(() => api.BROADCAST_CATEGORIES.filter(type => !state.categories.some(category => category.type === type)))
const remainingRounds = computed(() => [1, 2, 3, 4, 5].filter(round => !state.nodes.some(node => node.categoryId === structureCategory.value?.id && node.roundNumber === round)))
function canAddNode(category: BroadcastCategory) {
  const nodes = state.nodes.filter(node => node.categoryId === category.id)
  return category.type === 'POINTS' ? nodes.length < 5 : nodes.length === 0
}
const dialogTitle = computed(() => t(dialog.value === 'season' ? (editingSeason.value ? 'leagueBroadcasts.editSeason' : 'leagueBroadcasts.newSeason')
  : dialog.value === 'category' ? 'leagueBroadcasts.newCategory' : 'leagueBroadcasts.newNode'))

function nodeTitle(node: BroadcastNode) {
  const category = state.categories.find(value => value.id === node.categoryId)
  return category?.type === 'POINTS' ? t('leagueBroadcasts.roundLabel', { round: node.roundNumber })
    : [t(`leagueBroadcasts.categories.${category?.type}`), node.format ? t(`leagueBroadcasts.formats.${node.format}`) : ''].filter(Boolean).join(' · ')
}
const displayNodes = computed(() => state.nodes.map(node => ({ ...node, label: nodeTitle(node),
  records: node.replays.map(replay => ({ ...replay,
    metadata: [state.displayTimeZone ? formatBroadcastDate(replay.matchDate, replay.startsAt, state.displayTimeZone, locale.value) : replay.matchDate, t('leagueBroadcasts.dayLabel', { day: replay.dayNumber }),
      state.categories.find(category => category.id === node.categoryId)?.type === 'POINTS' ? t('leagueBroadcasts.roundLabel', { round: node.roundNumber }) : '',
      replay.groupNumber ? t('leagueBroadcasts.groupNumberLabel', { number: replay.groupNumber }) : '',
      replay.bracket ? t(`leagueBroadcasts.brackets.${replay.bracket}`) : '', t(`leagueBroadcasts.perspectives.${replay.perspective}`)].filter(Boolean).join(' · '),
    teamLabel: [t('leagueBroadcasts.following', { team: replay.teams[0] }), ...replay.teams.slice(1)].join(' / '),
    coverUrl: replay.coverId && !failedCovers.value.has(replay.coverId) ? api.broadcastCoverUrl(replay.coverId) : '',
  })) })))

const sections = computed(() => state.categories.map(category => ({ ...category,
  nodes: displayNodes.value.filter(node => node.categoryId === category.id),
})).filter(section => state.allowed || section.nodes.some(node => node.replays.length > 0)))
// 4.0 版式：区服 · 赛季 · 时区在同一顶栏；赛段是页签；左侧轮次、右侧视频网格。
// 缺省选择用 replace 写进 URL（不新增历史记录）：区服缺省第一个，赛季缺省最新一届（年份最大，同年取 id 最大）。
const sortedSeasons = computed(() => [...state.seasons].sort((a, b) => b.year - a.year || b.id - a.id))
watch(() => [state.loading, state.readFailed, state.network.available, state.server, state.seasonId, state.servers.length, state.seasons.length] as const, () => {
  if (state.loading || state.readFailed || !state.network.available) return
  if (!state.server && state.servers.length) void state.select({ server: state.servers[0] })
  else if (state.server && !state.seasonId && sortedSeasons.value.length) void state.select({ server: state.server, season: sortedSeasons.value[0].id })
}, { flush: 'post', immediate: true })
const activeSection = computed(() => sections.value.find(section => section.id === state.categoryId) ?? sections.value[0] ?? null)
const stageTabs = computed(() => sections.value.map(section => ({ value: String(section.id), testid: `broadcast-stage-${section.id}`,
  label: [t(`leagueBroadcasts.categories.${section.type}`), section.type === 'POINTS' ? t('leagueBroadcasts.roundCount', { count: section.nodes.length }) : '',
    t('leagueBroadcasts.replayCount', { count: section.nodes.reduce((sum, node) => sum + node.replays.length, 0) })].filter(Boolean).join(' · ') })))
const activeNode = computed(() => activeSection.value?.nodes.find(node => node.id === selectedNodeId.value)
  ?? activeSection.value?.nodes.find(node => node.replays.length) ?? activeSection.value?.nodes[0] ?? null)
function selectStage(id: string) { void state.select({ server: state.server, season: state.seasonId, category: Number(id) }) }
function selectSeason(event: Event) { void state.navigate({ server: state.server, season: Number((event.target as HTMLSelectElement).value) }) }
watch(() => state.contextKey, () => { failedCovers.value = new Set() })
watch(() => activeSection.value?.id, () => { selectedNodeId.value = null })
watch(() => state.editorEpoch, () => { dialog.value = ''; replayEditor.value = null; invalid.value = false })
function openSeason(value: BroadcastSeason | null = null) {
  editingSeason.value = value
  Object.assign(form, { year: value?.year ?? new Date().getFullYear(), nameZh: value?.nameZh ?? '', nameEn: value?.nameEn ?? '', nameRu: value?.nameRu ?? '', startDate: value?.startDate ?? '', expectedVersion: value?.version ?? 0 })
  invalid.value = false; dialog.value = 'season'
}
function openStructure(kind: 'category' | 'node', category: BroadcastCategory | null = null) {
  structureCategory.value = category
  form.expectedVersion = state.season?.version ?? 0
  form.type = remainingCategories.value[0] ?? 'POINTS'
  form.roundNumber = remainingRounds.value[0] ?? 1
  form.format = 'ROUND_ROBIN'
  invalid.value = false; dialog.value = kind
}
async function saveStructure() {
  if (!state.allowed || !state.server) return
  if (dialog.value === 'season') {
    if (!Number.isInteger(form.year) || form.year < 1 || form.year > 9999 || !form.nameZh.trim() || !form.nameEn.trim()
      || [form.nameZh, form.nameEn, form.nameRu].some(name => name.trim().length > 100)) { invalid.value = true; return }
    const value = { year: form.year, nameZh: form.nameZh.trim(), nameEn: form.nameEn.trim(), nameRu: form.nameRu.trim() || null, startDate: form.startDate || null }
    const existing = editingSeason.value
    await state.mutate(signal => existing ? api.updateBroadcastSeason(existing.id, { ...value, expectedVersion: form.expectedVersion }, signal)
      : api.createBroadcastSeason({ ...value, server: state.server! }, signal))
  } else if (dialog.value === 'category' && state.season) {
    await state.mutate(signal => api.createBroadcastCategory(state.season!.id, { expectedVersion: form.expectedVersion, type: form.type }, signal))
  } else if (dialog.value === 'node' && structureCategory.value) {
    const value = { expectedVersion: form.expectedVersion, roundNumber: structureCategory.value.type === 'POINTS' ? form.roundNumber : null,
      format: structureCategory.value.type === 'QUARTER_FINALS' ? form.format : null }
    await state.mutate(signal => api.createBroadcastNode(structureCategory.value!.id, value, signal))
  }
}
async function saveReplay(value: BroadcastTimedReplaySave, cover: File | null) {
  const editor = replayEditor.value
  if (!editor) return
  selectedNodeId.value = editor.node.id
  await state.mutate(signal => api.saveBroadcastReplay({ nodeId: editor.node.id, replayId: editor.replay?.id }, value, cover, signal))
}
async function reloadEditor() {
  const editor = replayEditor.value, kind = dialog.value, categoryId = structureCategory.value?.id, seasonId = editingSeason.value?.id, context = state.contextKey
  await state.refresh()
  if (!state.allowed || state.readFailed || context !== state.contextKey) return
  if (editor) {
    const node = state.nodes.find(value => value.id === editor.node.id)
    const replay = editor.replay ? node?.replays.find(value => value.id === editor.replay!.id) : null
    if (node && (!editor.replay || replay)) replayEditor.value = { node, replay: replay ?? null }
  } else if (kind === 'season') {
    const latest = seasonId ? state.seasons.find(value => value.id === seasonId) : null
    if (!seasonId || latest) openSeason(latest ?? null)
  } else if (kind === 'category') openStructure(kind)
  else if (kind === 'node') {
    const category = state.categories.find(value => value.id === categoryId)
    if (category) openStructure(kind, category)
  }
}
function coverFailed(id: string | null) { if (id) failedCovers.value = new Set([...failedCovers.value, id]) }
async function refreshPage() {
  failedCovers.value = new Set()
  await state.refresh()
}
</script>

<template>
  <div class="broadcast-page layout-wide" data-testid="league-broadcasts-page">
    <ShowcaseHero :kicker="t('nav.groups.events')" :title="t('leagueBroadcasts.title')" :description="state.season ? `${state.season.year} · ${broadcastSeasonName(state.season, locale)}` : undefined" />

    <!-- 顶栏：区服（分段）· 赛季（下拉）· 显示时区 · 刷新 · 管理操作 -->
    <div class="broadcast-toolbar" data-testid="broadcast-toolbar">
      <SegmentedControl
        v-if="state.servers.length"
        scrollable
        :model-value="state.server ?? ''"
        :options="state.servers.map(server => ({ value: server, label: t(`leagueBroadcasts.servers.${server}`), testid: `broadcast-server-${server}` }))"
        :ariaLabel="t('leagueBroadcasts.server')"
        data-testid="broadcast-servers"
        @update:model-value="server => state.navigate({ server })"
      />
      <label v-if="state.server && sortedSeasons.length" class="broadcast-select">
        <span class="visually-hidden">{{ t('leagueBroadcasts.season') }}</span>
        <select :value="state.seasonId ?? ''" :disabled="state.busy" data-testid="broadcast-season-select" @change="selectSeason">
          <option v-for="season in sortedSeasons" :key="season.id" :value="season.id">{{ season.year }} · {{ broadcastSeasonName(season, locale) }}</option>
        </select>
        <ChevronDown class="broadcast-select-chevron" :size="16" aria-hidden="true" />
      </label>
      <label v-if="state.season && state.defaultTimeZone" class="broadcast-time-zone">
        <Clock3 class="broadcast-time-zone-icon" :size="16" aria-hidden="true" />
        <select v-model="state.displayTimeZonePreference" :aria-label="t('leagueBroadcasts.displayTimeZone')" :title="`${t('leagueBroadcasts.displayTimeZone')} · ${t(`leagueBroadcasts.timeZones.${state.displayTimeZone}`)}`" data-testid="broadcast-display-time-zone">
          <option value="server">{{ t('leagueBroadcasts.serverTimeZone', { zone: t(`leagueBroadcasts.timeZones.${state.defaultTimeZone}`) }) }}</option>
          <option v-for="zone in BROADCAST_DISPLAY_ZONES" :key="zone" :value="zone">{{ t(`leagueBroadcasts.timeZones.${zone}`) }}</option>
        </select>
        <ChevronDown class="broadcast-time-zone-chevron" :size="16" aria-hidden="true" />
      </label>
      <div class="broadcast-actions broadcast-toolbar-actions">
        <AppButton :disabled="state.loading || state.busy || !state.network.available" data-testid="broadcast-refresh" @click="refreshPage">{{ t('leagueBroadcasts.refresh') }}</AppButton>
        <template v-if="state.allowed && state.network.available && !state.loading && state.server">
          <template v-if="state.season">
            <AppButton :disabled="state.busy" :aria-label="t('leagueBroadcasts.editSeason')" :data-testid="`broadcast-edit-season-${state.season.id}`" @click="openSeason(state.season)"><Pencil :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.edit') }}</AppButton>
            <AppButton variant="danger" :disabled="state.busy" :data-testid="`broadcast-delete-season-${state.season.id}`" @click="state.remove('seasons', state.season.id, broadcastSeasonName(state.season, locale), t)"><Trash2 :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.delete') }}</AppButton>
            <AppButton :disabled="state.busy || !remainingCategories.length" data-testid="broadcast-new-category" @click="openStructure('category')">{{ t('leagueBroadcasts.newCategory') }}</AppButton>
          </template>
          <AppButton variant="primary" :disabled="state.busy" data-testid="broadcast-new-season" @click="openSeason()"><Plus :size="18" aria-hidden="true" />{{ t('leagueBroadcasts.newSeason') }}</AppButton>
        </template>
      </div>
    </div>

    <Banner v-if="!state.network.available && !state.network.pending">{{ t(state.network.messageKey || 'featureOffline.leagueBroadcasts') }}</Banner>
    <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner>
    <Banner v-if="state.notice">{{ t(`leagueBroadcasts.${state.notice}`) }}</Banner>
    <p v-if="state.loading || state.network.pending" role="status">{{ t('leagueBroadcasts.loading') }}</p>
    <template v-else-if="state.network.available && !state.readFailed && state.server">
      <p v-if="!sortedSeasons.length" class="broadcast-empty" data-testid="broadcast-no-seasons">{{ t('leagueBroadcasts.noSeasons') }}</p>
      <template v-else-if="state.season">
        <p v-if="!sections.length" class="broadcast-empty">{{ t('leagueBroadcasts.noCategories') }}</p>
        <template v-else>
          <SegmentedControl
            v-if="sections.length > 1"
            scrollable
            :model-value="String(activeSection?.id ?? '')"
            :options="stageTabs"
            :ariaLabel="t('leagueBroadcasts.category')"
            data-testid="broadcast-stages"
            @update:model-value="selectStage"
          />
          <section v-if="activeSection" :key="activeSection.id" class="broadcast-stage" :data-testid="`broadcast-category-${activeSection.id}`">
            <header class="broadcast-stage-header">
              <h2>{{ t(`leagueBroadcasts.categories.${activeSection.type}`) }}</h2>
              <div v-if="state.allowed" class="broadcast-actions">
                <AppButton v-if="canAddNode(activeSection)" variant="ghost" :disabled="state.busy" :data-testid="`broadcast-new-node-${activeSection.id}`" @click="openStructure('node', activeSection)"><Plus :size="18" aria-hidden="true" />{{ t(activeSection.type === 'POINTS' ? 'leagueBroadcasts.newRound' : 'leagueBroadcasts.newNode') }}</AppButton>
                <MenuButton :label="t('leagueBroadcasts.manage')" variant="ghost" :aria-label="`${t('leagueBroadcasts.manage')} · ${t(`leagueBroadcasts.categories.${activeSection.type}`)}`" :disabled="state.busy" :data-testid="`broadcast-category-menu-${activeSection.id}`" :items="[{ key: 'delete', label: t('leagueBroadcasts.deleteCategory'), testid: `broadcast-delete-category-${activeSection.id}` }]" @select="state.remove('categories', activeSection.id, t(`leagueBroadcasts.categories.${activeSection.type}`), t)" />
              </div>
            </header>
            <p v-if="!activeSection.nodes.length" class="broadcast-empty">{{ t('leagueBroadcasts.noNodes') }}</p>
            <div v-else class="broadcast-stage-body" :class="{ 'has-rounds': activeSection.nodes.length > 1 || activeSection.type === 'POINTS' }">
              <nav v-if="activeSection.nodes.length > 1 || activeSection.type === 'POINTS'" class="broadcast-rounds" :aria-label="t('leagueBroadcasts.round')">
                <button
                  v-for="node in activeSection.nodes"
                  :key="node.id"
                  type="button"
                  class="broadcast-round"
                  :aria-pressed="activeNode?.id === node.id"
                  :data-testid="`broadcast-round-${node.id}`"
                  @click="selectedNodeId = node.id"
                >
                  <span>{{ activeSection.type === 'POINTS' ? t('leagueBroadcasts.roundShortLabel', { round: node.roundNumber }) : node.label }}</span>
                  <small>{{ t('leagueBroadcasts.replayCount', { count: node.replays.length }) }}</small>
                </button>
              </nav>
              <div v-if="activeNode" class="broadcast-round-panel" :data-testid="`broadcast-round-panel-${activeNode.id}`">
                <header class="broadcast-round-header">
                  <h3>{{ activeNode.label }}</h3>
                  <div v-if="state.allowed" class="broadcast-actions broadcast-node-actions">
                    <AppButton variant="ghost" class="broadcast-icon-action" :disabled="state.busy" :aria-label="t('leagueBroadcasts.newReplay')" :title="t('leagueBroadcasts.newReplay')" :data-testid="`broadcast-new-replay-${activeNode.id}`" @click="replayEditor = { node: activeNode, replay: null }"><Plus :size="20" aria-hidden="true" /></AppButton>
                    <MenuButton :label="t('leagueBroadcasts.manage')" variant="ghost" :aria-label="`${t('leagueBroadcasts.manage')} · ${activeNode.label}`" :disabled="state.busy" :data-testid="`broadcast-node-menu-${activeNode.id}`"
                      :items="[{ key: 'node', label: t('leagueBroadcasts.nodeDeleteTitle'), testid: `broadcast-delete-node-${activeNode.id}` }]"
                      @select="state.remove('nodes', activeNode.id, activeNode.label, t)" />
                  </div>
                </header>
                <p v-if="!activeNode.records.length" class="broadcast-empty">{{ t('leagueBroadcasts.noReplays') }}</p>
                <div v-else class="broadcast-records">
                  <article v-for="replay in activeNode.records" :key="replay.id" class="broadcast-record" :data-testid="`broadcast-replay-${replay.id}`">
                    <a class="broadcast-cover" :href="replay.url" target="_blank" rel="noopener noreferrer" :aria-label="`${t('leagueBroadcasts.open')} · ${replay.title}`">
                      <img v-if="replay.coverUrl" :src="replay.coverUrl" :alt="t('leagueBroadcasts.coverAlt', { title: replay.title })" class="broadcast-thumbnail" loading="lazy" @error="coverFailed(replay.coverId)">
                      <span v-else class="broadcast-thumbnail is-placeholder" aria-hidden="true"><ExternalLink :size="24" /></span>
                      <span class="broadcast-perspective">{{ t(`leagueBroadcasts.perspectives.${replay.perspective}`) }}</span>
                    </a>
                    <div class="broadcast-record-text"><h4>{{ replay.title }}</h4><p>{{ replay.metadata }}</p><p>{{ replay.teamLabel }}</p></div>
                    <div v-if="state.allowed" class="broadcast-actions"><AppButton size="sm" :disabled="state.busy" :data-testid="`broadcast-edit-replay-${replay.id}`" @click="replayEditor = { node: activeNode, replay }">{{ t('leagueBroadcasts.edit') }}</AppButton><AppButton size="sm" variant="danger" :disabled="state.busy" :data-testid="`broadcast-delete-replay-${replay.id}`" @click="state.remove('replays', replay.id, replay.title, t)">{{ t('leagueBroadcasts.delete') }}</AppButton></div>
                  </article>
                </div>
              </div>
            </div>
          </section>
        </template>
      </template>
    </template>

    <AppDialog :open="!!dialog && state.allowed" :title="dialogTitle" :close-on-scrim="false" data-testid="broadcast-structure-dialog" @close="!state.busy && (dialog = '')">
      <form id="broadcast-structure-form" class="broadcast-form" @submit.prevent="saveStructure">
        <Banner v-if="errorText" tone="danger">{{ errorText }}</Banner><Banner v-if="invalid" tone="danger">{{ t('leagueBroadcasts.invalidForm') }}</Banner>
        <template v-if="dialog === 'season'">
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.year') }}</span><input v-model.number="form.year" type="number" min="1" max="9999" step="1" required :disabled="state.busy" data-testid="broadcast-season-year"></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.seasonNameZh') }}</span><input v-model="form.nameZh" required maxlength="100" :disabled="state.busy" data-testid="broadcast-season-name-zh"></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.seasonNameEn') }}</span><input v-model="form.nameEn" required maxlength="100" :disabled="state.busy" data-testid="broadcast-season-name-en"></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.seasonNameRu') }} · {{ t('leagueBroadcasts.optional') }}</span><input v-model="form.nameRu" maxlength="100" :disabled="state.busy" data-testid="broadcast-season-name-ru"><small>{{ t('leagueBroadcasts.seasonNameRuFallback') }}</small></label>
          <label class="broadcast-field"><span>{{ t('leagueBroadcasts.startDate') }}</span><input v-model="form.startDate" type="date" :disabled="state.busy" data-testid="broadcast-season-start-date"></label>
        </template>
        <label v-else-if="dialog === 'category'" class="broadcast-field"><span>{{ t('leagueBroadcasts.category') }}</span><select v-model="form.type" :disabled="state.busy" data-testid="broadcast-category-type"><option v-for="type in remainingCategories" :key="type" :value="type">{{ t(`leagueBroadcasts.categories.${type}`) }}</option></select></label>
        <template v-else-if="dialog === 'node'">
          <p>{{ t(`leagueBroadcasts.categories.${structureCategory?.type}`) }}</p>
          <label v-if="structureCategory?.type === 'POINTS'" class="broadcast-field"><span>{{ t('leagueBroadcasts.round') }}</span><select v-model.number="form.roundNumber" :disabled="state.busy" data-testid="broadcast-node-round"><option v-for="round in remainingRounds" :key="round" :value="round">{{ round }}</option></select></label>
          <label v-if="structureCategory?.type === 'QUARTER_FINALS'" class="broadcast-field"><span>{{ t('leagueBroadcasts.format') }}</span><select v-model="form.format" :disabled="state.busy" data-testid="broadcast-node-format"><option v-for="format in ['ROUND_ROBIN', 'KNOCKOUT']" :key="format" :value="format">{{ t(`leagueBroadcasts.formats.${format}`) }}</option></select></label>
          <p>{{ t('leagueBroadcasts.immutable') }}</p>
        </template>
      </form>
      <template #actions><AppButton :disabled="state.busy" @click="dialog = ''">{{ t('leagueBroadcasts.cancel') }}</AppButton><AppButton v-if="errorText" :disabled="state.busy" data-testid="broadcast-editor-reload" @click="reloadEditor">{{ t('leagueBroadcasts.reloadEditor') }}</AppButton><AppButton type="submit" form="broadcast-structure-form" variant="primary" :disabled="state.busy" data-testid="broadcast-structure-save">{{ t(state.busy ? 'leagueBroadcasts.saving' : 'leagueBroadcasts.save') }}</AppButton></template>
    </AppDialog>
    <LeagueBroadcastReplayDialog v-if="replayEditor && state.season && replayCategory && state.defaultTimeZone && state.allowed" :open="true" :season="state.season" :category="replayCategory" :default-time-zone="state.defaultTimeZone" :node="replayEditor.node" :replay="replayEditor.replay" :busy="state.busy" :cover-upload-available="state.coverUploadAvailable" :error-text="errorText" @close="replayEditor = null" @reload="reloadEditor" @save="saveReplay" />
  </div>
</template>

<style scoped>
.broadcast-page { display: grid; gap: var(--space-4); }
.broadcast-page > :deep(.showcase-hero) { margin-block-end: 0; }
.broadcast-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.broadcast-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); min-width: 0; }
.broadcast-toolbar-actions { margin-inline-start: auto; }
.broadcast-empty { margin: 0; padding: var(--space-4); color: var(--color-text-secondary); font: var(--type-body); }
.broadcast-select, .broadcast-time-zone { position: relative; display: inline-flex; min-width: 0; max-width: 100%; color: var(--color-text-secondary); }
.broadcast-select select, .broadcast-time-zone select { appearance: none; min-width: 0; max-width: 100%; min-height: var(--control-h-md); padding-block: 0; border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-md); background: var(--color-surface-1); color: var(--color-text-primary); font: var(--type-body); text-overflow: ellipsis; cursor: pointer; transition: border-color var(--duration-fast) var(--ease-standard), background-color var(--duration-fast) var(--ease-standard); }
.broadcast-select select { padding-inline: var(--space-3) calc(var(--space-3) + var(--space-4) + var(--space-2)); }
.broadcast-time-zone select { padding-inline: calc(var(--space-3) + var(--space-4) + var(--space-2)); }
.broadcast-time-zone-icon, .broadcast-time-zone-chevron, .broadcast-select-chevron { position: absolute; top: 50%; transform: translateY(-50%); pointer-events: none; }
.broadcast-time-zone-icon { inset-inline-start: var(--space-3); color: var(--color-accent-text); }
.broadcast-time-zone-chevron, .broadcast-select-chevron { inset-inline-end: var(--space-3); }

.broadcast-stage { display: grid; gap: var(--space-3); min-width: 0; }
.broadcast-stage-header, .broadcast-round-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
.broadcast-stage-header h2 { margin: 0; padding-inline-start: var(--space-3); border-inline-start: var(--space-1) solid var(--color-accent); color: var(--color-text-primary); font: var(--type-h3); }
.broadcast-round-header h3 { margin: 0; color: var(--color-text-primary); font: var(--type-h3); }
.broadcast-stage-body { display: grid; gap: var(--space-4); min-width: 0; }
.broadcast-stage-body.has-rounds { grid-template-columns: calc(var(--space-12) * 4) minmax(0, 1fr); align-items: start; }
.broadcast-rounds { display: grid; gap: var(--space-1); }
.broadcast-round { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); min-height: var(--control-h-lg); padding: var(--space-2) var(--space-3); border: var(--border-width) solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-text-primary); font: var(--type-body); font-weight: 600; text-align: start; cursor: pointer; }
.broadcast-round small { color: var(--color-text-secondary); font: var(--type-caption); }
.broadcast-round[aria-pressed="true"] { border-color: var(--color-accent); background: var(--color-surface-2); color: var(--color-accent-text); }
.broadcast-round-panel { display: grid; gap: var(--space-3); min-width: 0; }
.broadcast-node-actions { flex: none; flex-wrap: nowrap; gap: var(--space-1); }
.broadcast-icon-action { min-width: var(--control-h-md); padding-inline: var(--space-2); }

/* 视频网格：16:9 封面 + 标题、时间 / 赛日 / 视角、队伍；点开外链到原地址 */
.broadcast-records { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, calc(var(--space-12) * 6)), 1fr)); gap: var(--space-4); }
.broadcast-record { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: var(--border-width) solid var(--color-border-subtle); border-radius: var(--radius-lg); background: var(--color-surface-1); }
.broadcast-cover { position: relative; display: block; border-radius: var(--radius-md); }
.broadcast-thumbnail { display: block; inline-size: 100%; aspect-ratio: 16 / 9; height: auto; object-fit: cover; border-radius: var(--radius-md); background: var(--color-surface-2); }
.broadcast-thumbnail.is-placeholder { display: grid; place-items: center; color: var(--color-text-secondary); }
.broadcast-perspective { position: absolute; inset-block-start: var(--space-2); inset-inline-start: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-full); background: var(--color-canvas); color: var(--color-text-primary); font: var(--type-caption); font-weight: 600; }
.broadcast-record-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.broadcast-record-text h4 { margin: 0 0 var(--space-1); color: var(--color-text-primary); font: var(--type-h3); }
.broadcast-record-text p { margin: var(--space-1) 0 0; color: var(--color-text-secondary); font: var(--type-caption); }

.broadcast-form, .broadcast-field { display: grid; gap: var(--space-2); }
.broadcast-form { gap: var(--space-4); }
.broadcast-field { min-width: 0; color: var(--color-text-primary); font: var(--type-body); }
.broadcast-field input, .broadcast-field select { width: 100%; min-width: 0; min-height: var(--control-h-md); padding: var(--space-2); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-surface-1); color: var(--color-text-primary); font: inherit; }
.broadcast-round:focus-visible, .broadcast-cover:focus-visible, .broadcast-field input:focus-visible, .broadcast-field select:focus-visible, .broadcast-time-zone select:focus-visible, .broadcast-select select:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-outline-offset); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (hover: hover) {
  .broadcast-time-zone select:hover, .broadcast-select select:hover { border-color: var(--color-accent); background: var(--color-surface-2); }
  .broadcast-round:hover { background: var(--color-surface-2); }
}
@media (width < 768px) {
  .broadcast-select, .broadcast-time-zone { flex: 1 1 100%; }
  .broadcast-select select, .broadcast-time-zone select { width: 100%; }
  .broadcast-toolbar-actions { margin-inline-start: 0; }
  /* 小屏：轮次变横向胶囊，视频变左图右文列表 */
  .broadcast-stage-body.has-rounds { grid-template-columns: minmax(0, 1fr); }
  .broadcast-rounds { display: flex; gap: var(--space-2); overflow-x: auto; padding-block-end: var(--space-1); }
  .broadcast-round { flex: none; border-color: var(--color-border-subtle); border-radius: var(--radius-full); }
  .broadcast-records { grid-template-columns: minmax(0, 1fr); gap: var(--space-2); }
  .broadcast-record { display: grid; grid-template-columns: calc(var(--space-12) * 2.75) minmax(0, 1fr); align-items: start; gap: var(--space-3); }
  .broadcast-record > .broadcast-actions { grid-column: 1 / -1; }
}
</style>
