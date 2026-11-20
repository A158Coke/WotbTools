// 统一事件流（借鉴 blitzinfo 的战斗日志）：把 Playback facet 的各事件源合并成
// 单一时间轴流。**纯函数、无场景依赖**——合并/过滤/排序全部可单测；
// 判别器一律是 facet 字段语义（t_fire/t/clock/时刻数组），禁止按内容统计推断
// （上游 AGENTS.md 禁令）。
//
// 事件源与 kind（过滤器 chip 按此分组）：
//   shot        shots[].t_fire            炮击（含命中/未命中/跳弹，verdict 取 game_hit_result 位图）
//   kill        kills[].t                 击毁（killfeed 同源）
//   chat        chat_events[].kind=message（0x2f 战斗聊天）/ chat_messages[]（0x2b 另域）
//   command     chat_events[].kind=command 非地图类快捷指令
//   marker      chat_events[].kind=command 的地图标记（attention_to_cell / moving_here /
//               catch_point / defend_point）；独立过滤片，避免与聊天文本混在一起
//   presence    chat_events[].kind=join/leave/channel_created
//   notice      notifications[].t         单发通知（语义未定；subject 仅按名册联表）
//   module      module_crew_states[].?    模块/乘员状态（recorder-only 数据）
//   consumable  consumables[].clock       消耗品生命周期
//   death       vehicles[].death_times    死亡（≥2 次死亡的车才有数组；单次死亡用 kills/death_t）
//   revive      vehicles[].resurrection_times  复活
// 身份：vehicles[] 是唯一 eid 名册；tankNames 选项（tank_cache）补真实车型名；
// 指令 target / 通知 subject 同时接受 eid 与 accountId 两域。
//
// 字段命名与 agent-replay-facets.ts 的 TS 类型一一对应；新增事件源在这里追加并同步 filter 组。

import type { AgentPlaybackFacet, AgentPlaybackShot } from '../api/agent-replay-facets'
import { SHOT_RESULT, shotResultClass } from './shotResultClass.js'

import { buildCombatRows, buildSocialRows, buildStatusRows } from './playbackEventStreamRows.js'

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

/** 一行归一化事件（可选字段按 kind 填充；shot 事件附 raw facet 行供装甲检视交接）。 */
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
  /** 快捷指令码（kind=command；语义未闭合原样透传） */
  command?: number
  /** 指令目标（kind=command；语义未闭合原样透传） */
  commandTarget?: number
  /** 原始事件码（kind=presence/chat 的 0x2f 类别证据） */
  rawType?: number
  /** 掉血量（kind=damage；0 = 未掉血事件） */
  damage?: number
  /** 伤害来源（kind=damage；0 = 未归属/环境） */
  sourceEid?: number
  /** 基地编号（kind=capture；0..3 = A..D / 单基地） */
  baseId?: number
  /** 占领阵营（kind=capture：owner 或正在占领的队伍） */
  team?: number
  /** 占领状态（kind=capture：'captured' | 'invading' | 'neutralized'） */
  captureState?: 'captured' | 'invading' | 'neutralized'
  /** 占领进度 0..100（kind=capture；单基地 assault 时有效） */
  progress?: number
  /** 行为者身份（炮击射手 / 掉血来源 / 击杀者 / 被点亮车 / 模块受击者 / 消耗品使用者） */
  actor?: ActorInfo
  /** 受害者/目标身份（炮击目标 / 掉血受害 / 被击杀者） */
  target?: ActorInfo
  /** 合并后的事实行（炮击/掉血/击毁合并为一条时）：本发总伤害 */
  shotDamage?: number
  /** 合并后的事实行：本发是否造成击毁 */
  shotKill?: boolean
  /** 聊天/指令的频道名（common/team；来自 chat_channels） */
  channelName?: string
  /** true = 来自 0x2b 另域（与 0x2f 战斗聊天无协议等价证据，呈现时如实区分） */
  otherDomain?: boolean
  /** 在场事件的具体动作（join/leave/channel_created；保留上游已给的方向区别） */
  action?: 'join' | 'leave' | 'channel_created'
  /** 指令语义名（客户端权威表；缺省 = 未映射） */
  commandName?: string
  /** 指令扇区号（attention_to_cell；1..9） */
  cell?: number
  /** 扇区显示标签（1..9 → A1..C3；域外不生成，保留 cell 原值） */
  cellLabel?: string
  /** 0x2e 标记类型（kind=marker；1/4/5 语义已证，其余原样保留） */
  markerType?: number
  /** 聊天/指令/在场的发送者昵称（0x2f 前缀名；旧 0x2b 聊天无署名） */
  sender?: string
  /** 通知主体原始 id（kind=notice；上游语义未定，仅作名册联表证据） */
  subject?: number
  /** 占领阵营的玩家视角（kind=capture；friendly/enemy 由 meta.friendly_team 判定） */
  faction?: 'friendly' | 'enemy'
}

/** 构建选项：车型名表（tank_cache `{id: name}`）；缺省时回退 facet `tank_name`（可能为 tank_<id> 占位）。 */
export interface EventStreamOptions {
  tankNames?: Readonly<Record<number, string>>
}

/** eid → 名册身份（昵称/车名/队伍；缺失字段省略） */
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
  kill: 'shot', // 击毁与炮击合并呈现（同一条战斗行）
  chat: 'chat',
  command: 'chat', // 非地图类快捷指令与聊天同一过滤片（blitzinfo 同族）
  marker: 'marker', // 地图标记（attention_to_cell / moving_here / catch_point / defend_point）
  presence: 'chat', // 成员进出
  module: 'module',
  moduleDamage: 'module', // method38 逐模块损伤与 method16 状态同片
  damage: 'damage', // 未并入炮击的掉血单独成片（撞击/火焰/环境/未记录射击）
  capture: 'capture',
  observed: 'observed',
  destructible: 'other',
  consumable: 'consumable',
  notice: 'other',
  death: 'other',
  revive: 'other',
}

/**
 * 炮击呈现语义：**不是**位图分类。
 *
 * `game_hit_result` 是结果枚举（0=无 1=未穿 2=间隙止 3=有伤害 4=raw 255=未获取），
 * 不是 method38 的 hit_flags 位图——位运算会把未穿(1)/有伤害(3)/未知(255) 全判成击杀。
 * 击杀与跳弹取 shot 的显式布尔 `is_kill` / `ricochet`；其余复用仓库既有权威语义
 * `shotResultClass`（作者 hit_flags 位图优先，否则枚举降级；4 保持未定不猜）。
 */
export function shotVerdict(shot: AgentPlaybackShot | null | undefined): ShotVerdict | null {
  if (!shot) return null
  if (shot.is_kill === true) return 'kill'
  // 显式布尔优先于枚举派生（枚举 0/255 时 shotResultClass 只能给 HIT，跳弹事实在布尔上）
  if (shot.ricochet === true) return 'ricochet'
  switch (shotResultClass(shot)) {
    case SHOT_RESULT.PENETRATION: return 'penetrated'
    case SHOT_RESULT.RICOCHET: return 'ricochet'
    case SHOT_RESULT.NO_PENETRATION: return 'blocked'
    case SHOT_RESULT.HE_BLAST: return 'he'
    default: return null // MISS / HIT / UNVERIFIED：不伪造语义
  }
}

/**
 * 客户端 3×3 扇区编号 → 地图格标签（1..9 → A1..C3）。
 *
 * 权威证据：`attention_to_cell` 的载荷是 1..9 的扇区号（客户端
 * `chatCommand/attention_to_cell` 的 `%(cell)` 参数）；同一场 BZT-70 回放
 * payload=6 与战斗日志「Attention to sector B3」逐条对应。列优先：
 * `A1,A2,A3,B1,...,C3` 不是此编码；客户端/BlitzInfo 的既有映射为
 * `letter = 65 + floor((n-1)/3)`、`number = (n-1)%3 + 1`（6 → B3）。
 * 域外值不生成标签（调用方保留原始 cell，禁猜）。
 */
export function sectorLabel(cell: number | null | undefined): string | undefined {
  if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 1 || cell > 9) {
    return undefined
  }
  return String.fromCharCode(65 + Math.floor((cell - 1) / 3)) + ((cell - 1) % 3 + 1)
}

/** 归一化事件行：{ kind, filter, t, … }。t 升序稳定排序。 */
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
    if (!Number.isFinite(time)) return // 非法时刻 fail-closed 丢弃该条
    out.push({ kind, filter: filterOverride ?? FILTER_OF_KIND[kind], t: time, ...extra })
  }
  // 名册身份索引：所有事件行据此带出「谁 / 哪辆车」（eid 元数据只来自 vehicles[]）。
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
  buildCombatRows({ push, actorOf }, facet)
  buildSocialRows({ push, actorByName, actorByRef, actorOfMarkerEid, actorOfMarkerAccount, channelLabel }, facet)
  buildStatusRows({ push, actorOf, actorBySubject, factionOf }, facet)
  out.sort((a, b) => a.t - b.t || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
  return out
}

/** 过滤（'all' 直通）；未知过滤键 fail-closed 返回空。 */
export function filterEvents(
  events: ReadonlyArray<PlaybackEventRow>,
  filter: string,
): PlaybackEventRow[] {
  if (filter === 'all') return events.slice()
  if (!EVENT_FILTERS.some((f) => f.key === filter)) return []
  return events.filter((e) => e.filter === filter)
}

/**
 * 找当前时刻之后/之前最近的一条（供「下一事件」导航）；
 * dir=1 之后、-1 之前；无更多返回 null。
 */
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


/**
 * 3D 快捷指令/聊天滚动流与事件流 pane 共用的行文案：同一套 i18n 键与身份纪律
 * （玩家 · 车名；缺一回退「未知玩家」，不显示裸 eid）。t 由调用方注入
 * （pane 与 3D 覆盖层各自持有 vue-i18n 实例）。
 */
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

/** 事件行的主文本（ReplayEventStreamPane.eventTitle 的唯一事实源；3D 滚动流同消费）。 */
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
      const ch = ev.channelName ? ` · ${ev.channelName}` : ''
      const who = ev.actor ? actorText(ev.actor) : (ev.sender || '?')
      if (ev.commandName) {
        // 客户端权威语义（未映射 id 保留 raw）；玩家目标按 eid/account 两域联表，
        // 查不到时给「未知目标」而不是裸数字（原始值在 tooltip）。
        return t(`eventStream.cmd_${ev.commandName}`, {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
          cell: ev.cell ?? '?',
        }) + ch
      }
      return t('eventStream.command_line', { sender: who, code: ev.command ?? '?' }) + ch
    }
    case 'marker': {
      const ch = ev.channelName ? ` · ${ev.channelName}` : ''
      const who = ev.actor ? actorText(ev.actor) : (ev.sender || '?')
      if (ev.commandName === 'attention_to_cell') {
        const cell = ev.cellLabel ?? (ev.cell != null ? `#${ev.cell}` : '?')
        return t('eventStream.marker_cell', { who, cell }) + ch
      }
      if (ev.commandName === 'attack') {
        return t('eventStream.marker_attack', {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
        }) + ch
      }
      if (ev.commandName === 'ally_retreat') {
        return t('eventStream.marker_retreat', {
          who,
          target: ev.target ? actorText(ev.target) : t('eventStream.unknown_target'),
        }) + ch
      }
      if (ev.commandName === 'catch_point' || ev.commandName === 'defend_point') {
        // payload 域上游未闭合：不把它写成「据点 N」，只按原始目标值呈现
        // （评审 5935348769 P2；专用 *_raw 文案保留“指令（目标 N）”的中性语义）。
        return t(`eventStream.cmd_${ev.commandName}_raw`, {
          who,
          target: ev.commandTarget ?? '?',
        }) + ch
      }
      if (ev.commandName === 'moving_here') {
        return t('eventStream.marker_moving', { who }) + ch
      }
      return t('eventStream.marker_unknown', {
        who,
        type: ev.markerType ?? ev.command ?? '?',
      }) + ch
    }
    case 'presence': {
      // 未知动作（上游 other/未观测 code）不得冒充进入频道——中性提示 + 原始码
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
