import type { AgentPlaybackFacet } from '../api/agent-replay-facets.js'
import type { EventKind, EventFilterKey, PlaybackEventRow, ActorInfo } from './playbackEventStream.js'
import { shotVerdict, sectorLabel } from './playbackEventStream.js'

type Push = (kind: EventKind, t: unknown, extra?: Omit<Partial<PlaybackEventRow>, 'kind' | 'filter' | 't'>, filterOverride?: EventFilterKey) => void

export function buildCombatRows(
  ctx: { push: Push; actorOf: (eid?: number | null) => ActorInfo | undefined },
  facet: AgentPlaybackFacet | null | undefined,
): void {
  const { push, actorOf } = ctx
  if (!facet) return
  const shotsArr = Array.isArray(facet.shots) ? facet.shots : []
  const impactOf = shotsArr.map((s) => Number(s?.t_fire) + (Number(s?.flight_secs) || 0))
  const damageByShot = new Map<number, number>()
  for (const d of Array.isArray(facet.damage_events) ? facet.damage_events : []) {
    let best = -1
    if (d?.cause !== 0) {
      push('damage', d?.t, {
        eid: d?.victim_eid,
        sourceEid: d?.source_eid,
        damage: typeof d?.damage === 'number' ? d.damage : 0,
        cause: d?.cause,
        actor: actorOf(d?.source_eid),
        target: actorOf(d?.victim_eid),
      })
      continue
    }
    for (let i = 0; i < shotsArr.length; i++) {
      const s = shotsArr[i]
      if (s?.shooter_eid !== d?.source_eid || s?.target_eid !== d?.victim_eid) continue
      const dt = Number(d?.t) - impactOf[i]
      if (dt < -0.15 || dt > 1.0) continue
      if (best < 0 || impactOf[i] > impactOf[best]) best = i
    }
    if (best >= 0) {
      damageByShot.set(best, (damageByShot.get(best) ?? 0) + Math.max(0, Number(d?.damage) || 0))
      continue
    }
    push('damage', d?.t, {
      eid: d?.victim_eid,
      sourceEid: d?.source_eid,
      damage: typeof d?.damage === 'number' ? d.damage : 0,
      cause: d?.cause,
      actor: actorOf(d?.source_eid),
      target: actorOf(d?.victim_eid),
    })
  }
  const killByShot = new Set<number>()
  const killsUnmatched: number[] = []
  const killPool = (Array.isArray(facet.kills) ? facet.kills : [])
    .map((k) => ({ k, consumed: false }))
  for (const [ki, slot] of killPool.entries()) {
    const k = slot.k
    if (k?.cause !== 0) {
      killsUnmatched.push(ki)
      continue
    }
    let best = -1
    for (let i = 0; i < shotsArr.length; i++) {
      const s = shotsArr[i]
      if (s?.shooter_eid !== k?.killer_eid || s?.target_eid !== k?.victim_eid) continue
      const dt = Number(k?.t) - impactOf[i]
      if (dt < -0.15 || dt > 2.0) continue
      if (best < 0 || impactOf[i] > impactOf[best]) best = i
    }
    if (best >= 0) {
      killByShot.add(best)
      slot.consumed = true
    } else {
      killsUnmatched.push(ki)
    }
  }
  for (const ki of killsUnmatched) {
    const k = killPool[ki].k
    push('kill', k?.t, {
      eid: k?.killer_eid,
      victimEid: k?.victim_eid,
      cause: k?.cause,
      actor: actorOf(k?.killer_eid),
      target: actorOf(k?.victim_eid),
    }, 'other')
  }
  for (const [idx, s] of shotsArr.entries()) {
    const killed = killByShot.has(idx) || s?.is_kill === true
    const dmg = damageByShot.get(idx) ?? 0
    push('shot', s?.t_fire, {
      eid: s?.shooter_eid,
      targetEid: s?.target_eid,
      verdict: shotVerdict(s),
      isAuthor: s?.is_author === true,
      shot: s,
      actor: actorOf(s?.shooter_eid),
      target: actorOf(s?.target_eid),
      shotDamage: dmg > 0 ? dmg : undefined,
      shotKill: killed || undefined,
    })
  }
}

export function buildSocialRows(
  ctx: { push: Push; actorByName: (name?: string | null) => ActorInfo | undefined; actorByRef: (ref?: number | null) => ActorInfo | undefined; actorOfMarkerEid: (ref?: number | null) => ActorInfo | undefined; actorOfMarkerAccount: (ref?: number | null) => ActorInfo | undefined; channelLabel: Map<number, string> },
  facet: AgentPlaybackFacet | null | undefined,
): void {
  const { push, actorByName, actorByRef, actorOfMarkerEid, actorOfMarkerAccount, channelLabel } = ctx
  if (!facet) return
  const chatEvents = Array.isArray(facet.chat_events) ? facet.chat_events : []
  for (const ev of chatEvents) {
    switch (ev?.kind) {
      case 'message':
        push('chat', ev?.t, {
          text: typeof ev?.text === 'string' ? ev.text : '',
          sender: ev?.sender || undefined,
          actor: actorByName(ev?.sender),
          rawType: ev?.raw_type,
          channelName: channelLabel.get(ev?.channel),
        })
        break
      case 'command':
        {
          const name = ev?.command_name
          const payload = typeof ev?.target === 'number' ? ev.target : undefined
          const marker = name === 'attention_to_cell' || name === 'moving_here'
            || name === 'catch_point' || name === 'defend_point'
          const playerTarget = name === 'attack_enemy' || name === 'help_me_ex'
            || name === 'support_me_with_fire'
          push(marker ? 'marker' : 'command', ev?.t, {
            command: typeof ev?.command === 'number' ? ev.command : undefined,
            commandName: name,
            commandTarget: payload,
            target: playerTarget ? actorByRef(payload) : undefined,
            cell: name === 'attention_to_cell' ? payload : undefined,
            cellLabel: name === 'attention_to_cell' ? sectorLabel(payload) : undefined,
            sender: ev?.sender || undefined,
            actor: actorByName(ev?.sender),
            rawType: ev?.raw_type,
            channelName: channelLabel.get(ev?.channel),
          })
        }
        break
      case 'join':
      case 'leave':
      case 'channel_created':
        push('presence', ev?.t, {
          action: ev?.kind,
          sender: ev?.sender || undefined,
          actor: actorByName(ev?.sender),
          rawType: ev?.raw_type,
          channelName: channelLabel.get(ev?.channel),
        })
        break
      default:
        push('presence', ev?.t, {
          sender: ev?.sender || undefined,
          actor: actorByName(ev?.sender),
          rawType: ev?.raw_type,
        })
        break
    }
  }
  const markerNameOf = (type: number | undefined): string | undefined => {
    switch (type) {
      case 1: return 'moving_here'
      case 4: return 'attack'
      case 5: return 'ally_retreat'
      default: return undefined
    }
  }
  for (const m of Array.isArray(facet.markers) ? facet.markers : []) {
    const type = typeof m?.marker_type === 'number' ? m.marker_type : undefined
    const targetRef = typeof m?.target_eid === 'number' ? m.target_eid : undefined
    push('marker', m?.t, {
      markerType: type,
      commandName: markerNameOf(type),
      commandTarget: targetRef,
      target: type === 4 || type === 5 ? actorOfMarkerEid(targetRef) : undefined,
      actor: actorOfMarkerEid(m?.entity_id) ?? actorOfMarkerAccount(m?.account_id),
    })
  }
  for (const m of Array.isArray(facet.chat_messages) ? facet.chat_messages : []) {
    const text = typeof m?.text === 'string' ? m.text : ''
    if (!text) continue
    push('chat', m?.t, { text, otherDomain: true })
  }
}

export function buildStatusRows(
  ctx: { push: Push; actorOf: (eid?: number | null) => ActorInfo | undefined; actorBySubject: (ref?: number | null) => ActorInfo | undefined; factionOf: (team?: number | null) => 'friendly' | 'enemy' | undefined },
  facet: AgentPlaybackFacet | null | undefined,
): void {
  const { push, actorOf, actorBySubject, factionOf } = ctx
  if (!facet) return
  for (const md of Array.isArray(facet.module_damage_events) ? facet.module_damage_events : []) {
    push('moduleDamage', md?.clock, {
      eid: md?.victim_eid,
      component: md?.component,
      state: md?.state,
      text: md?.component && md?.state ? `${md.component} ${md.state}` : (md?.state || ''),
      actor: actorOf(md?.victim_eid),
    })
  }
  for (const n of Array.isArray(facet.notifications) ? facet.notifications : []) {
    push('notice', n?.t, {
      code: n?.code,
      subject: n?.subject,
      actor: actorBySubject(n?.subject),
    })
  }
  for (const mc of Array.isArray(facet.module_crew_states) ? facet.module_crew_states : []) {
    push('module', mc?.clock, {
      eid: mc?.vehicle_eid,
      text: mc?.component && mc?.state ? `${mc.component} ${mc.state}` : mc?.state || '',
      component: mc?.component,
      state: mc?.state,
      actor: actorOf(mc?.vehicle_eid),
    })
  }
  const sup = Array.isArray(facet.supremacy_bases) ? facet.supremacy_bases : []
  if (sup.length) {
    const prevOwner = new Map<number, number | null | undefined>()
    const prevCapturing = new Map<number, number | null | undefined>()
    for (const tr of sup) {
      const base = typeof tr?.base_id === 'number' ? tr.base_id : -1
      if (base < 0) continue
      const owner = tr?.owner_team ?? null
      if (prevOwner.has(base) && prevOwner.get(base) !== owner) {
        push('capture', tr?.clock, {
          baseId: base,
          team: owner ?? undefined,
          faction: factionOf(owner),
          captureState: owner == null ? 'neutralized' : 'captured',
        })
      }
      prevOwner.set(base, owner)
      const cap = tr?.capturing_team ?? null
      if (prevCapturing.has(base) && prevCapturing.get(base) !== cap && cap != null) {
        push('capture', tr?.clock, {
          baseId: base,
          team: cap,
          faction: factionOf(cap),
          captureState: 'invading',
        })
      }
      prevCapturing.set(base, cap)
    }
  }
  const assault = Array.isArray(facet.assault_bases) ? facet.assault_bases : []
  if (assault.length) {
    let prevProgress: number | null = null
    for (const tr of assault) {
      const progress = typeof tr?.progress === 'number' ? tr.progress : null
      if (progress == null) continue
      if (prevProgress != null && progress > prevProgress) {
        push('capture', tr?.clock, {
          baseId: 0,
          captureState: progress >= 100 ? 'captured' : 'invading',
          progress,
        })
      } else if (prevProgress == null && progress > 0) {
        push('capture', tr?.clock, { baseId: 0, captureState: 'invading', progress })
      }
      prevProgress = progress
    }
  }
  const seenSpotted = new Set<number>()
  for (const vis of Array.isArray(facet.visibility) ? facet.visibility : []) {
    const eid = vis?.eid
    if (typeof eid !== 'number' || seenSpotted.has(eid)) continue
    seenSpotted.add(eid)
    push('observed', vis?.t_in, { eid, actor: actorOf(eid) })
  }
  for (const de of Array.isArray(facet.destructible_events) ? facet.destructible_events : []) {
    push('destructible', de?.clock, { eid: de?.area_eid, state: de?.prop })
  }
  for (const c of Array.isArray(facet.consumables) ? facet.consumables : []) {
    push('consumable', c?.clock, {
      eid: c?.eid,
      text: c?.logical_item_id || c?.state_name || '',
      state: c?.state,
      slot: c?.slot ?? undefined,
      actor: actorOf(c?.eid),
    })
  }
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    for (const dt of Array.isArray(v?.death_times) ? v.death_times : []) {
      push('death', dt, { eid: v?.eid, actor: actorOf(v?.eid) })
    }
    for (const rt of Array.isArray(v?.resurrection_times) ? v.resurrection_times : []) {
      push('revive', rt, { eid: v?.eid, actor: actorOf(v?.eid) })
    }
  }
}
