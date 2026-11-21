import type { AgentPlaybackFacet } from '../api/agent-replay-facets'
import type { ActorInfo, EventStreamOptions } from './playbackEventStream.js'

/**
 * 事件流的名册身份解析（eid/accountId/昵称/频道/阵营视角）——自 playbackEventStream.ts
 * 出仓（2026-11-21 #LOC 结构拆分，代码与搬移前逐字一致）。仅限同目录事件流模块消费，
 * 不是公共 API。
 */

/** 名册身份解析器（事件行带出「谁 / 哪辆车」的联表面）。 */
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

/** 名册身份索引：所有事件行据此带出「谁 / 哪辆车」（eid 元数据只来自 vehicles[]）。 */
export function createEventIdentity(
  facet: AgentPlaybackFacet,
  options: EventStreamOptions,
): EventIdentity {
  // 车型名优先取注入的 tank_cache 名表；facet 的 tank_<id> 是**占位名**，不得上 UI。
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
  /** 昵称 → 身份。仅唯一命中才解析；同名歧义保持 undefined（fail-closed）。 */
  const actorByName = (name?: string | null): ActorInfo | undefined => {
    if (!name) return undefined
    const list = byName.get(name)
    return list && list.length === 1 ? list[0] : undefined
  }
  // accountId → 身份（指令 target / 通知 subject 的候选 id 域之一）
  const byAccount = new Map<number, ActorInfo>()
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    if (typeof v?.account_id !== 'number' || !actors.has(v.eid)) continue
    byAccount.set(v.account_id, actors.get(v.eid) as ActorInfo)
  }
  /**
   * 指令 target / 通知 subject → 身份。语料实测 `attack_enemy` 的载荷是**车辆 eid**
   * （1549653/1764961/136528020… 均命中 vehicles[].eid），与上游注释的 accountId 不一致；
   * 两域都按名册联表，eid 优先。0/负数 = 无目标。
   */
  const actorByRef = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return actors.get(ref) ?? byAccount.get(ref)
  }
  /**
   * 0x2e marker 的身份域是**固定**的（上游 v0.5.4 契约）：`entity_id`/`target_eid`
   * 是车辆 eid，`account_id` 是账号 id。这里不得复用双域 actorByRef——否则一个
   * 未在 `vehicles[]` 命中的 eid 若恰好等于某玩家 accountId，会误配到别人并阻断
   * 真正 account_id 的回退。只按各自域查表，未命中保持 unknown（fail-closed）。
   */
  const actorOfMarkerEid = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return actors.get(ref)
  }
  const actorOfMarkerAccount = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    return byAccount.get(ref)
  }
  /** 通知 subject：语义未定，若同一 id 同时命中两名不同玩家的 eid/accountId → 歧义，不联表。 */
  const actorBySubject = (ref?: number | null): ActorInfo | undefined => {
    if (typeof ref !== 'number' || ref <= 0) return undefined
    const byEid = actors.get(ref)
    const byAcct = byAccount.get(ref)
    if (byEid && byAcct && byEid.eid !== byAcct.eid) return undefined
    return byEid ?? byAcct
  }
  // 阵营视角：team 1/2 与 meta.friendly_team 相同 = friendly，另一队 = enemy；未知保持 undefined。
  const friendlyTeam = facet.meta?.friendly_team
  const factionOf = (team?: number | null): 'friendly' | 'enemy' | undefined => {
    if (team !== 1 && team !== 2) return undefined
    if (friendlyTeam !== 1 && friendlyTeam !== 2) return undefined
    return team === friendlyTeam ? 'friendly' : 'enemy'
  }
  // 频道句柄 → 频道名（common/team），来自 chat_channels 的 channelName 末段
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
