import type { AgentPlaybackFacet } from '../api/agent-replay-facets'
import type { ActorInfo, EventStreamOptions } from './playbackEventStream.js'


export interface EventIdentity {
  actorOf(eid?: number | null): ActorInfo | undefined
  actorByName(name?: string | null): ActorInfo | undefined
  actorByRef(ref?: number | null): ActorInfo | undefined
  actorOfMarkerEid(ref?: number | null): ActorInfo | undefined
  actorOfMarkerAccount(ref?: number | null): ActorInfo | undefined
  actorBySubject(ref?: number | null): ActorInfo | undefined
  factionOf(team?: number | null): 'friendly' | 'enemy' | undefined
  channelLabel: Map<number, string>
}

export function createEventIdentity(
  facet: AgentPlaybackFacet,
  options: EventStreamOptions,
): EventIdentity {
  const tankNameOf = (v: { tank_id?: number; tank_name?: string }): string | undefined => {
    const fromTable = typeof v?.tank_id === 'number' ? options.tankNames?.[v.tank_id] : undefined
    if (typeof fromTable === 'string' && fromTable) return fromTable
    const raw = typeof v?.tank_name === 'string' ? v.tank_name : ''
    return raw && !/^tank_\d+$/.test(raw) ? raw : undefined
  }
  const actors = new Map<number, ActorInfo>()
  const byName = new Map<string, ActorInfo[]>()
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    if (typeof v?.eid !== 'number') continue
    const name = typeof v.nickname === 'string' && v.nickname ? v.nickname : undefined
    const tank = tankNameOf(v)
    const actor: ActorInfo = {
      eid: v.eid,
      ...(name ? { name } : {}),
      ...(tank ? { tank } : {}),
      team: typeof v.team === 'number' ? v.team : null,
    }
    actors.set(v.eid, actor)
    if (name) {
      const list = byName.get(name) ?? []
      list.push(actor)
      byName.set(name, list)
    }
  }
  const actorOf = (eid?: number | null): ActorInfo | undefined => {
    if (typeof eid !== 'number' || eid <= 0) return undefined
    return actors.get(eid) ?? { eid }
  }
  const actorByName = (name?: string | null): ActorInfo | undefined => {
    if (!name) return undefined
    const list = byName.get(name)
    return list && list.length === 1 ? list[0] : undefined
  }
  const byAccount = new Map<number, ActorInfo>()
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    if (typeof v?.account_id !== 'number' || !actors.has(v.eid)) continue
    byAccount.set(v.account_id, actors.get(v.eid) as ActorInfo)
  }
  const actorByRef = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return actors.get(ref) ?? byAccount.get(ref)
  }
  const actorOfMarkerEid = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return actors.get(ref)
  }
  const actorOfMarkerAccount = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return byAccount.get(ref)
  }
  const actorBySubject = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    const byEid = actors.get(ref)
    const byAcct = byAccount.get(ref)
    if (byEid && byAcct && byEid.eid !== byAcct.eid) return undefined
    return byEid ?? byAcct
  }
  const friendlyTeam = facet.meta?.friendly_team
  const factionOf = (team?: number | null): 'friendly' | 'enemy' | undefined => {
    if (team !== 1 && team !== 2) return undefined
    if (friendlyTeam !== 1 && friendlyTeam !== 2) return undefined
    return team === friendlyTeam ? 'friendly' : 'enemy'
  }
  const channelLabel = new Map<number, string>()
  for (const ch of Array.isArray(facet.chat_channels) ? facet.chat_channels : []) {
    if (typeof ch?.id !== 'number' || typeof ch?.channel_name !== 'string') continue
    const parts = ch.channel_name.split('/')
    channelLabel.set(ch.id, parts[parts.length - 1] || ch.channel_name)
  }
  return {
    actorOf,
    actorByName,
    actorByRef,
    actorOfMarkerEid,
    actorOfMarkerAccount,
    actorBySubject,
    factionOf,
    channelLabel,
  }
}
