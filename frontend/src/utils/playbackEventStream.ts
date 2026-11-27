
import type { AgentPlaybackFacet, AgentPlaybackShot } from '../api/agent-replay-facets'
import { SHOT_RESULT, shotResultClass } from './shotResultClass.js'
import { createEventIdentity } from './playbackEventStreamIdentity.js'
import { collectCaptureRows, collectChatRows, collectCombatRows, collectStatusRows } from './playbackEventStreamSources.js'

export type EventKind =
  | 'shot'
  | 'kill'
  | 'chat'
  | 'command'
  | 'marker'
  | 'presence'
  | 'notice'
  | 'module'
  | 'moduleDamage'
  | 'damage'
  | 'capture'
  | 'observed'
  | 'destructible'
  | 'consumable'
  | 'death'
  | 'revive'

export type EventFilterKey =
  | 'all'
  | 'shot'
  | 'damage'
  | 'kill'
  | 'capture'
  | 'observed'
  | 'marker'
  | 'chat'
  | 'module'
  | 'consumable'
  | 'other'

export type ShotVerdict = 'kill' | 'ricochet' | 'blocked' | 'penetrated' | 'he'

export interface PlaybackEventRow {
  kind: EventKind
  filter: EventFilterKey
  t: number
  eid?: number
  targetEid?: number
  victimEid?: number
  cause?: number
  verdict?: ShotVerdict | null
  isAuthor?: boolean
  shot?: AgentPlaybackShot
  text?: string
  code?: number
  state?: number | string
  slot?: number
  component?: string
  command?: number
  commandTarget?: number
  rawType?: number
  damage?: number
  sourceEid?: number
  baseId?: number
  team?: number
  captureState?: 'captured' | 'invading' | 'neutralized'
  progress?: number
  actor?: ActorInfo
  target?: ActorInfo
  shotDamage?: number
  shotKill?: boolean
  channelName?: string
  otherDomain?: boolean
  action?: 'join' | 'leave' | 'channel_created'
  commandName?: string
  cell?: number
  cellLabel?: string
  markerType?: number
  sender?: string
  subject?: number
  faction?: 'friendly' | 'enemy'
}

export interface EventStreamOptions {
  tankNames?: Readonly<Record<number, string>>
}

export interface ActorInfo {
  eid: number
  name?: string
  tank?: string
  team?: number | null
}

export const EVENT_FILTERS: ReadonlyArray<{ key: EventFilterKey; labelKey: string }> = [
  { key: 'all', labelKey: 'eventStream.filter_all' },
  { key: 'shot', labelKey: 'eventStream.filter_shot' },
  { key: 'damage', labelKey: 'eventStream.filter_damage' },
  { key: 'capture', labelKey: 'eventStream.filter_capture' },
  { key: 'observed', labelKey: 'eventStream.filter_observed' },
  { key: 'marker', labelKey: 'eventStream.filter_marker' },
  { key: 'chat', labelKey: 'eventStream.filter_chat' },
  { key: 'module', labelKey: 'eventStream.filter_module' },
  { key: 'consumable', labelKey: 'eventStream.filter_consumable' },
  { key: 'other', labelKey: 'eventStream.filter_other' },
]

const FILTER_OF_KIND: Record<EventKind, EventFilterKey> = {
  shot: 'shot',
  kill: 'shot',
  chat: 'chat',
  command: 'chat',
  marker: 'marker',
  presence: 'chat',
  module: 'module',
  moduleDamage: 'module',
  damage: 'damage',
  capture: 'capture',
  observed: 'observed',
  destructible: 'other',
  consumable: 'consumable',
  notice: 'other',
  death: 'other',
  revive: 'other',
}

export function shotVerdict(shot: AgentPlaybackShot | null | undefined): ShotVerdict | null {
  if (!shot) return null
  if (shot.is_kill === true) return 'kill'
  if (shot.ricochet === true) return 'ricochet'
  switch (shotResultClass(shot)) {
    case SHOT_RESULT.PENETRATION: return 'penetrated'
    case SHOT_RESULT.RICOCHET: return 'ricochet'
    case SHOT_RESULT.NO_PENETRATION: return 'blocked'
    case SHOT_RESULT.HE_BLAST: return 'he'
    default: return null
  }
}

export function sectorLabel(cell: number | null | undefined): string | undefined {
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 1 || cell > 9) {
    return undefined
  }
  return String.fromCharCode(65 + Math.floor((cell - 1) / 3)) + ((cell - 1) % 3 + 1)
}

export function buildEventStream(
  facet: AgentPlaybackFacet | null | undefined,
  options: EventStreamOptions = {},
): PlaybackEventRow[] {
  if (!facet || typeof facet !== 'object') return []
  const out: PlaybackEventRow[] = []
  const push = (
    kind: EventKind,
    t: unknown,
    extra: Omit<Partial<PlaybackEventRow>, 'kind' | 'filter' | 't'> = {},
    filterOverride?: EventFilterKey,
  ): void => {
    const time = Number(t)
    if (!Number.isFinite(time)) return
    out.push({ kind, filter: filterOverride ?? FILTER_OF_KIND[kind], t: time, ...extra })
  }
  const identity = createEventIdentity(facet, options)
  const ctx = { ...identity, push }
  collectCombatRows(facet, ctx)
  collectChatRows(facet, ctx)
  collectCaptureRows(facet, ctx)
  collectStatusRows(facet, ctx)
  out.sort((a, b) => a.t - b.t || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
  return out
}

export function filterEvents(
  events: ReadonlyArray<PlaybackEventRow>,
  filter: string,
): PlaybackEventRow[] {
  if (filter === 'all') return events.slice()
  if (!EVENT_FILTERS.some((f) => f.key === filter)) return []
  return events.filter((e) => e.filter === filter)
}

export function nearestEventTime(
  events: ReadonlyArray<{ t: number }>,
  t: unknown,
  dir: number,
): number | null {
  const now = Number(t)
  if (!Number.isFinite(now)) return null
  let best: number | null = null
  if (dir >= 0) {
    for (const e of events) if (e.t > now + 1e-6 && (best == null || e.t < best)) best = e.t
    return best
  }
  for (const e of events) if (e.t < now - 1e-6 && (best == null || e.t > best)) best = e.t
  return best
}


export type EventRowTranslate = (key: string, params?: Record<string, unknown>) => string

function eventActorText(a?: { eid: number; name?: string; tank?: string }, t?: EventRowTranslate): string {
  if (!a) return '-'
  const parts = [a.name || '', a.tank || ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : (t ? t('eventStream.unknown_actor') : '-')
}

function eventVerdictText(ev: PlaybackEventRow, t: EventRowTranslate): string {
  switch (ev.verdict) {
    case 'penetrated': return t('eventStream.verdict_penetrated')
    case 'blocked': return t('eventStream.verdict_blocked')
    case 'ricochet': return t('eventStream.verdict_ricochet')
    case 'he': return t('eventStream.verdict_he')
    case 'kill': return t('eventStream.verdict_kill')
    default: return ''
  }
}

export function eventRowTitle(ev: PlaybackEventRow, t: EventRowTranslate): string {
  const actorText = (a?: { eid: number; name?: string; tank?: string }) => eventActorText(a, t)
  switch (ev.kind) {
    case 'shot': {
      const head = t('eventStream.shot_line', {
        from: actorText(ev.actor),
        to: ev.target ? actorText(ev.target) : t('eventStream.no_target'),
      })
      const parts = [head]
      const v = eventVerdictText(ev, t)
      if (v) parts.push(v)
      if (ev.shotDamage) parts.push(t('eventStream.damage_part', { n: ev.shotDamage }))
      if (ev.shotKill) parts.push(t('eventStream.kill_part'))
      return parts.join(' · ')
    }
    case 'chat': {
      const ch = ev.channelName ? `[${ev.channelName}] ` : ''
      const who = ev.actor ? `${actorText(ev.actor)}: ` : ev.sender ? `${ev.sender}: ` : ''
      return `${ch}${who}${ev.text || ''}`
    }
    case 'command': {
      const who = ev.actor ? actorText(ev.actor) : (ev.sender || '?')
      if (ev.commandName) {
        return t(`eventStream.cmd_${ev.commandName}`, {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
          cell: ev.cell ?? '?',
        })
      }
      return t('eventStream.command_line', { sender: who, code: ev.command ?? '?' })
    }
    case 'marker': {
      const who = ev.actor ? actorText(ev.actor) : (ev.sender || '?')
      if (ev.commandName === 'attention_to_cell') {
        const cell = ev.cellLabel ?? (ev.cell != null ? `#${ev.cell}` : '?')
        return t('eventStream.marker_cell', { who, cell })
      }
      if (ev.commandName === 'attack') {
        return t('eventStream.marker_attack', {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
        })
      }
      if (ev.commandName === 'ally_retreat') {
        return t('eventStream.marker_retreat', {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
        })
      }
      if (ev.commandName === 'catch_point' || ev.commandName === 'defend_point') {
        return t(`eventStream.cmd_${ev.commandName}_raw`, {
          who,
          target: ev.commandTarget ?? '?',
        })
      }
      if (ev.commandName === 'moving_here') {
        return t('eventStream.marker_moving', { who })
      }
      return t('eventStream.marker_unknown', {
        who,
        type: ev.markerType ?? ev.command ?? '?',
      })
    }
    case 'presence': {
      const key = ev.action ? `eventStream.presence_${ev.action}` : 'eventStream.presence_unknown'
      const who = ev.actor ? actorText(ev.actor) : (ev.sender || '?')
      return t(key, { who, channel: ev.channelName || '-', raw: ev.rawType ?? '?' })
    }
    case 'moduleDamage':
    case 'module':
      return `${actorText(ev.actor)} · ${ev.text || t('eventStream.module_label')}`
    case 'damage': return t('eventStream.damage_label', {
      from: ev.actor ? actorText(ev.actor) : t('eventStream.environment_source'),
      to: ev.target ? actorText(ev.target) : '-',
      n: ev.damage ?? 0,
    })
    case 'capture': {
      if (ev.progress != null) return t('eventStream.capture_progress', { n: ev.progress })
      const base = String.fromCharCode(65 + (ev.baseId ?? 0))
      if (ev.faction) {
        return t(`eventStream.capture_${ev.captureState ?? 'invading'}_faction`, {
          faction: t(`eventStream.faction_${ev.faction}`),
          base,
        })
      }
      return t(`eventStream.capture_${ev.captureState ?? 'invading'}`, {
        base,
        team: ev.team ?? '-',
      })
    }
    case 'observed': return t('eventStream.observed_label', { who: actorText(ev.actor) })
    case 'destructible': return t('eventStream.destructible_label')
    case 'notice': return ev.actor
      ? t('eventStream.notice_label_actor', { who: actorText(ev.actor), code: ev.code ?? '?' })
      : t('eventStream.notice_label', { code: ev.code ?? '?' })
    case 'consumable':
      return `${actorText(ev.actor)} · ${ev.text || t('eventStream.consumable_label')}`
    case 'death': return t('eventStream.death_label_actor', { who: actorText(ev.actor) })
    case 'revive': return t('eventStream.revive_label_actor', { who: actorText(ev.actor) })
    case 'kill': return t('eventStream.kill_label', {
      from: ev.actor ? actorText(ev.actor) : t('eventStream.environment_source'),
      to: ev.target ? actorText(ev.target) : '-',
    })
    default: return t('eventStream.shot_label')
  }
}
