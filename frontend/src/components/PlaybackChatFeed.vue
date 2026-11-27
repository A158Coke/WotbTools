<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import { buildEventStream, eventRowTitle, type PlaybackEventRow } from '../utils/playbackEventStream.ts'
import { useTankNames } from '../composables/useTankNames.js'

const props = defineProps<{
  facet: AgentPlaybackFacet | null
  time: number
  hidden: boolean
}>()

const { t } = useI18n()
const feedTankNames = useTankNames()

const feedRows = computed(() => {
  if (!props.facet) return []
  return buildEventStream(props.facet, { tankNames: feedTankNames.value })
    .filter((ev) => ev.kind === 'chat' || ev.kind === 'command' || ev.kind === 'marker')
})
const feed = computed(() => feedRows.value.filter((ev) => ev.t <= props.time).slice(-6))

function factionOf(ev: PlaybackEventRow): 'friendly' | 'enemy' | undefined {
  const friendly = props.facet?.meta?.friendly_team
  const team = ev.actor?.team
  if ((friendly !== 1 && friendly !== 2) || (team !== 1 && team !== 2)) return undefined
  return team === friendly ? 'friendly' : 'enemy'
}
</script>

<template>
  <div class="pb-chat-feed" data-testid="pb-chat-feed" :hidden="hidden" aria-live="polite">
    <p v-for="(ev, i) in feed" :key="`${ev.t}-${ev.kind}-${i}`" class="pb-chat-feed-row" :data-kind="ev.kind" :data-faction="factionOf(ev)">{{ eventRowTitle(ev, t) }}</p>
  </div>
</template>

<style scoped>
.pb-chat-feed {
  position: absolute;
  left: var(--space-4, 16px);
  bottom: calc(var(--space-4, 16px) + 56px);
  max-width: min(46ch, 60%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
  z-index: var(--pb-z-canvas);
}
.pb-chat-feed[hidden] { display: none; }
.pb-chat-feed-row {
  margin: 0;
  padding: 2px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--color-canvas) 58%, transparent);
  color: var(--color-text-primary);
  font: var(--type-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pb-chat-feed-row[data-faction='friendly'] { color: var(--color-team-ally); }
.pb-chat-feed-row[data-faction='enemy'] { color: var(--color-team-enemy); }
.pb-chat-feed-row:nth-last-child(n + 4) { opacity: .55; }
.pb-chat-feed-row[data-kind='marker'] { color: var(--color-objective); }
</style>
