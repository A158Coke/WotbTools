<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Feature } from '../app/featureCapabilities.js'
import { useFeatureGate } from '../composables/useFeatureGate.js'
import { useTankNames } from '../composables/useTankNames.js'
import { enrichShotsFromRoster, parseAgentShotsFromBytes } from '../api/agent-replay-facets.js'
import { resolveReplayClock } from '../replay-local/canonical/facts'
import { annotateMountedConfigs, buildPitchLimits } from '../scene/shotHandoff.ts'
import { storeShotsForViewer, shotViewerQuery } from '../scene/agentData.js'
import type { ShotViewerInput } from '../scene/agentData.js'
import {
  buildEventStream, eventRowTitle, filterEvents, EVENT_FILTERS,
} from '../utils/playbackEventStream.ts'
import type { AgentPlaybackFacet, AgentPlaybackShot } from '../api/agent-replay-facets'
import type { PlaybackEventRow } from '../utils/playbackEventStream'
import type { EventFilterKey } from '../utils/playbackEventStream'

interface PlaybackSessionLike {
  loadScene?: (file: File) => Promise<AgentPlaybackFacet>
}
type ShotReplayRow = ShotViewerInput & {
  time_s?: number
  shooter_eid?: number
  target_eid?: number | null
}
type NavigateFn = (payload: { query: Record<string, string> }) => void

const props = withDefaults(defineProps<{
  file?: File | null
  active?: boolean
  playbackSession?: PlaybackSessionLike | null
  navigate?: NavigateFn | null
  pageActive?: boolean
  embedded?: boolean
}>(), { file: null, active: false, playbackSession: null, navigate: null, pageActive: true, embedded: false })
const emit = defineEmits(['seek'])

const { t } = useI18n()
const { requireFeature } = useFeatureGate()

const loading = ref(false)
const err = ref('')
const facet = ref<AgentPlaybackFacet | null>(null)
const parsedFile = ref<File | null>(null)
let loadGen = 0
let handoffSeq = 0
const filter = ref<EventFilterKey>('all')
const RenderCap = 800
const showCount = ref(RenderCap)

const tankNames = useTankNames()

const events = computed(() => buildEventStream(facet.value, { tankNames: tankNames.value }))
const filtered = computed(() => filterEvents(events.value, filter.value))
const shown = computed(() => filtered.value.slice(0, showCount.value))
const overflow = computed(() => Math.max(0, filtered.value.length - shown.value.length))
watch(filter, () => { showCount.value = RenderCap })
function showMore() { showCount.value += RenderCap }
const counts = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {}
  for (const e of events.value) out[e.filter] = (out[e.filter] || 0) + 1
  return out
})

async function ensureFacet() {
  const file = props.file
  if (!file || !props.playbackSession?.loadScene) return
  if (parsedFile.value === file) return
  void useTankNames()
  const gen = ++loadGen
  loading.value = true
  err.value = ''
  try {
    const loaded = await props.playbackSession.loadScene(file)
    if (gen !== loadGen) return
    facet.value = loaded
    parsedFile.value = file
    shotsCache = { file: null, rows: [] }
  } catch (e) {
    if (gen !== loadGen) return
    err.value = String((e as Error)?.message || e)
  } finally {
    if (gen === loadGen) loading.value = false
  }
}

watch(
  () => props.file,
  () => {
    loadGen++
    facet.value = null
    parsedFile.value = null
    err.value = ''
    loading.value = false
    shotsCache = { file: null, rows: [] }
    handoffSeq++
    if (props.active) void ensureFacet()
  },
)
watch(
  () => props.active,
  (active) => {
    if (!active) handoffSeq++
    if (active) {
      void useTankNames()
      if (!facet.value) void ensureFacet()
    }
  },
  { immediate: true },
)
watch(() => props.pageActive, (on) => { if (!on) handoffSeq++ })
onDeactivated(() => { handoffSeq++ })
onBeforeUnmount(() => { handoffSeq++ })

function onClick(ev: PlaybackEventRow | null) {
  if (ev == null) return
  emit('seek', ev.t)
}

const shotsBusy = ref(false)
let shotsCache: { file: File | null; rows: ShotReplayRow[] } = { file: null, rows: [] }

function rowHas3d(s: ShotReplayRow): boolean {
  return s.target_eid != null
}

async function openInArmorViewer(ev: PlaybackEventRow | null) {
  if (!requireFeature(Feature.PLAYBACK_3D)) return
  const s: AgentPlaybackShot | undefined = ev?.shot
  if (!s || !rowHas3d(s as ShotReplayRow)) return
  if (!props.navigate || !props.file) return
  const file = props.file
  const facetSnap = facet.value
  const seq = ++handoffSeq
  const stillCurrent = () => seq === handoffSeq && file === props.file && props.active && props.pageActive
  shotsBusy.value = true
  try {
    if (shotsCache.file !== file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let pitchLimits: Awaited<ReturnType<typeof buildPitchLimits>> | null = null
      try {
        pitchLimits = await buildPitchLimits(facetSnap?.vehicles || [])
      } catch { /* 资产不可用：如实降级 */ }
      if (!stillCurrent()) return
      const outcome = await parseAgentShotsFromBytes(bytes, pitchLimits ?? undefined).catch(async () => {
        return parseAgentShotsFromBytes(bytes)
      })
      if (!stillCurrent()) return
      const vehicles = facetSnap?.vehicles
      const parsedRows = (outcome.shots || []) as ShotReplayRow[]
      if (Array.isArray(vehicles)) enrichShotsFromRoster(parsedRows as never[], vehicles)
      shotsCache = { file, rows: parsedRows.filter(rowHas3d) }
    }
    const row = shotsCache.rows.find(
      (r) => r.shooter_eid === s.shooter_eid && r.target_eid === s.target_eid
        && Math.abs((r.time_s ?? 0) - ev!.t) <= 0.05,
    )
    if (!row) return
    const vehicles = facetSnap?.vehicles
    const ordered = [row, ...shotsCache.rows.filter((r) => r !== row)]
    await Promise.race([
      annotateMountedConfigs(ordered as never[], vehicles),
      new Promise((r) => setTimeout(r, 1500)),
    ])
    if (!stillCurrent()) return
    const snapshot = JSON.parse(JSON.stringify(row)) as ShotReplayRow
    const battleStartRaw = resolveReplayClock(
      facetSnap?.periods || [], null, facetSnap?.meta?.duration,
    )?.startRaw ?? 0
    storeShotsForViewer(JSON.parse(JSON.stringify(shotsCache.rows)), { battleStartRaw })
    const query = await shotViewerQuery(snapshot)
    if (!query) return
    if (!stillCurrent()) return
    props.navigate({ query: query as Record<string, string> })
  } finally {
    shotsBusy.value = false
  }
}

const KIND_ICON: Record<string, string> = {
  shot: '◎', damage: '✦', kill: '☠', capture: '🚩', observed: '👁',
  chat: '💬', command: '📣', marker: '📍', presence: '·',
  notice: 'ℹ', module: '⚙', moduleDamage: '⚙', destructible: '🌳',
  consumable: '⏱', death: '☠', revive: '✚',
}

function verdictClass(ev: PlaybackEventRow): string {
  return ev.verdict ? `ev-${ev.verdict}` : ''
}

function eventTitle(ev: PlaybackEventRow): string {
  return eventRowTitle(ev, t)
}

function canOpenShot(ev: PlaybackEventRow): boolean {
  return ev.kind === 'shot' && ev.shot != null && ev.targetEid != null
}

function rowTitle(ev: PlaybackEventRow): string {
  if (canOpenShot(ev)) return t('eventStream.open_shot_hint')
  if (ev.kind === 'marker' && ev.commandTarget
    && (ev.commandName === 'catch_point' || ev.commandName === 'defend_point')) {
    return t('eventStream.marker_raw_target', { target: ev.commandTarget })
  }
  return ''
}

function onRowClick(ev: PlaybackEventRow) {
  if (canOpenShot(ev)) {
    void openInArmorViewer(ev)
    return
  }
  onClick(ev)
}

function filterCount(key: EventFilterKey): number {
  if (key === 'all') return events.value.length
  return counts.value[key] || 0
}
</script>

<template>
  <section class="event-stream" :class="{ 'event-stream--embedded': embedded }" data-testid="ws-event-stream" data-pane-ready="true">
    <div v-if="!props.file" class="es-empty">{{ $t('eventStream.no_file') }}</div>
    <template v-else>
      <div v-if="loading" class="es-status">{{ $t('eventStream.loading') }}</div>
      <div v-else-if="err" class="es-status es-err">{{ err }}</div>
      <template v-else>
        <div class="es-filters" role="group" :aria-label="$t('eventStream.filters_aria')">
          <button
            v-for="f in EVENT_FILTERS"
            :key="f.key"
            type="button"
            class="es-chip"
            :class="{ on: filter === f.key }"
            :data-filter="f.key"
            :aria-pressed="filter === f.key"
            @click="filter = f.key"
          >
            {{ $t(f.labelKey) }} <output class="es-count">{{ filterCount(f.key) }}</output>
          </button>
        </div>
        <p v-if="overflow > 0" class="es-overflow">
          {{ $t('eventStream.overflow', { n: overflow }) }}
          <button type="button" class="es-more" data-testid="es-more" @click="showMore">
            {{ $t('eventStream.show_more') }}
          </button>
        </p>
        <ul class="es-list" data-testid="event-list">
          <li v-for="(ev, i) in shown" :key="`${ev.t}-${ev.kind}-${i}`" class="es-row">
            <output class="es-time">{{ ev.t.toFixed(1) }}s</output>
            <span class="es-icon" :class="verdictClass(ev)" aria-hidden="true">{{ KIND_ICON[ev.kind] || '•' }}</span>
            <button
              type="button"
              class="es-body"
              :data-kind="ev.kind"
              :class="{ 'es-body-shot': canOpenShot(ev) }"
              :title="rowTitle(ev)"
              @click="onRowClick(ev)"
            >
              <span class="es-text">{{ eventTitle(ev) }}</span>
              <span class="es-kind">{{ $t(`eventStream.kind_${ev.kind}`) }}</span>
            </button>
            <button
              v-if="canOpenShot(ev)"
              type="button"
              class="es-armor"
              data-testid="es-seek"
              :title="$t('eventStream.seek_here')"
              @click.stop="onClick(ev)"
            >
              ⏱
            </button>
          </li>
        </ul>
        <p v-if="!filtered.length" class="es-empty">{{ $t('eventStream.none') }}</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.event-stream { display: flex; flex-direction: column; gap: var(--space-2); block-size: 100%; overflow: auto; }
.event-stream--embedded { gap: var(--space-1); block-size: auto; overflow: visible; }
.event-stream--embedded .es-filters { flex: none; }
.event-stream--embedded .es-list { flex: none; min-block-size: 0; overflow: visible; }
.es-filters { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.es-chip {
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-primary);
  border-radius: var(--radius-full);
  corner-shape: round;
  padding: var(--space-1) var(--space-2);
  font: var(--type-caption);
  cursor: pointer;
}
.es-chip.on { background: var(--color-accent); border-color: transparent; color: var(--color-on-accent); }
.es-count { opacity: .7; margin-inline-start: var(--space-1); }
.es-chip.on .es-count { opacity: 1; }
.es-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.es-row { display: flex; align-items: center; gap: var(--space-2); padding: 2px var(--space-1); border-radius: var(--radius-sm); min-inline-size: 0; }
.es-row:hover { background: color-mix(in srgb, var(--color-text-primary) 5%, transparent); }
.es-time { font-variant-numeric: tabular-nums; font: var(--type-caption); color: var(--color-text-tertiary); min-inline-size: 56px; }
.es-icon { inline-size: 18px; text-align: center; }
.es-icon.ev-kill { color: var(--color-danger); }
.es-icon.ev-penetrated, .es-icon.ev-he { color: var(--color-warning); }
.es-icon.ev-ricochet, .es-icon.ev-blocked { color: var(--color-text-tertiary); }
.es-body {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  background: none;
  border: 0;
  color: inherit;
  text-align: start;
  cursor: pointer;
  padding: 0;
}
.es-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.es-kind { font: var(--type-caption); color: var(--color-text-tertiary); }
.es-armor {
  border: 1px solid var(--color-border-subtle);
  background: none;
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font: var(--type-caption);
  cursor: pointer;
}
.es-armor:disabled { opacity: .5; cursor: wait; }
.es-status, .es-empty { padding: var(--space-3) var(--space-1); color: var(--color-text-secondary); }
.es-err { color: var(--color-danger); }
.es-overflow { font: var(--type-caption); color: var(--color-text-tertiary); margin: 0; }
.es-more { margin-inline-start: var(--space-2); font: var(--type-caption); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); background: none; color: var(--color-text-primary); padding: 0 var(--space-2); cursor: pointer; }
</style>
