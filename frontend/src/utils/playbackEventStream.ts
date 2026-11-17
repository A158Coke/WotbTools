// 统一事件流（借鉴 blitzinfo 的战斗日志）：把 Playback facet 的各事件源合并成
// 单一时间轴流。**纯函数、无场景依赖**——合并/过滤/排序全部可单测；
// 判别器一律是 facet 字段语义（t_fire/t/clock/时刻数组），禁止按内容统计推断
// （上游 AGENTS.md 禁令）。
//
// 事件源与 kind（过滤器 chip 按此分组）：
//   shot        shots[].t_fire            炮击（含命中/未命中/跳弹，verdict 取 game_hit_result 位图）
//   kill        kills[].t                 击毁（killfeed 同源）
//   chat        chat_messages[].t         聊天文本（v0.5.0；tag/seq 不上 UI）
//   notice      notifications[].t         单发通知（v0.5.0；语义未定 → 「通知 #code」）
//   module      module_crew_states[].?    模块/乘员状态（recorder-only 数据）
//   consumable  consumables[].clock       消耗品生命周期
//   death       vehicles[].death_times    死亡（≥2 次死亡的车才有数组；单次死亡用 kills/death_t）
//   revive      vehicles[].resurrection_times  复活
//
// 字段命名与 agent-replay-facets.ts 的 TS 类型一一对应；新增事件源在这里追加并同步 filter 组。

import type { AgentPlaybackFacet, AgentPlaybackShot } from '../api/agent-replay-facets'
import { SHOT_RESULT, shotResultClass } from './shotResultClass.js'

export type EventKind =
  | 'shot'
  | 'kill'
  | 'chat'
  | 'command'
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
  /** 指令扇区号（attention_to_cell） */
  cell?: number
  /** 聊天/指令/在场的发送者昵称（0x2f 前缀名；旧 0x2b 聊天无署名） */
  sender?: string
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
  { key: 'capture', labelKey: 'eventStream.filter_capture' },
  { key: 'observed', labelKey: 'eventStream.filter_observed' },
  { key: 'chat', labelKey: 'eventStream.filter_chat' },
  { key: 'module', labelKey: 'eventStream.filter_module' },
  { key: 'consumable', labelKey: 'eventStream.filter_consumable' },
  { key: 'other', labelKey: 'eventStream.filter_other' },
]

const FILTER_OF_KIND: Record<EventKind, EventFilterKey> = {
  shot: 'shot',
  kill: 'shot', // 击毁与炮击合并呈现（同一条战斗行）
  chat: 'chat',
  command: 'chat', // 快捷指令与聊天同一过滤片（blitzinfo 同族）
  presence: 'chat', // 成员进出
  module: 'module',
  moduleDamage: 'module', // method38 逐模块损伤与 method16 状态同片
  damage: 'shot', // 掉血并入炮击行（未匹配到炮击时仍在此片）
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

/** 归一化事件行：{ kind, filter, t, … }。t 升序稳定排序。 */
export function buildEventStream(
  facet: AgentPlaybackFacet | null | undefined,
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
  // 名册身份索引：所有事件行据此带出「谁 / 哪辆车」（eid 元数据只来自 vehicles[]）
  const actors = new Map<number, ActorInfo>()
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    if (typeof v?.eid !== 'number') continue
    const name = typeof v.nickname === 'string' && v.nickname ? v.nickname : undefined
    const tank = typeof v.tank_name === 'string' && v.tank_name ? v.tank_name : undefined
    actors.set(v.eid, {
      eid: v.eid,
      ...(name ? { name } : {}),
      ...(tank ? { tank } : {}),
      team: typeof v.team === 'number' ? v.team : null,
    })
  }
  const actorOf = (eid?: number | null): ActorInfo | undefined => {
    if (typeof eid !== 'number') return undefined
    return actors.get(eid) ?? { eid }
  }
  // accountId → 身份（指令目标 attack_enemy 携带的是 accountId，不是 eid）
  const byAccount = new Map<number, ActorInfo>()
  for (const v of Array.isArray(facet.vehicles) ? facet.vehicles : []) {
    if (typeof v?.account_id !== 'number' || !actors.has(v.eid)) continue
    byAccount.set(v.account_id, actors.get(v.eid) as ActorInfo)
  }
  const actorByAccount = (account?: number | null): ActorInfo | undefined => {
    if (typeof account !== 'number' || account <= 0) return undefined
    return byAccount.get(account) ?? { eid: 0, name: `#${account}` }
  }
  // 频道句柄 → 频道名（common/team），来自 chat_channels 的 channelName 末段
  const channelLabel = new Map<number, string>()
  for (const ch of Array.isArray(facet.chat_channels) ? facet.chat_channels : []) {
    if (typeof ch?.id !== 'number' || typeof ch?.channel_name !== 'string') continue
    const parts = ch.channel_name.split('/')
    channelLabel.set(ch.id, parts[parts.length - 1] || ch.channel_name)
  }
  // —— 炮击 / 掉血 / 击毁合并为一条战斗行（用户口径：不再分开展示）——
  // 掉血归属 = 逐发最近匹配：每条掉血事件只归给「同 (source,victim) 且弹着时刻不晚于它」
  // 的最近一发（窗口 [-0.15, +1.0]s）。同一射手对同一目标连发时，第二发的伤害不会被
  // 第一发按窗口吞掉（评审 4595459443）。
  const shotsArr = Array.isArray(facet.shots) ? facet.shots : []
  const impactOf = shotsArr.map((s) => Number(s?.t_fire) + (Number(s?.flight_secs) || 0))
  const damageByShot = new Map<number, number>()
  for (const d of Array.isArray(facet.damage_events) ? facet.damage_events : []) {
    let best = -1
    // 只把**炮弹**伤害并入炮击行：撞击/火焰/环境（cause != 0）另有语义，不得冒充射击
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
    // 未匹配到炮击的掉血：环境/非射击伤害（仍归「炮击」片，保持战斗面完整）
    push('damage', d?.t, {
      eid: d?.victim_eid,
      sourceEid: d?.source_eid,
      damage: typeof d?.damage === 'number' ? d.damage : 0,
      cause: d?.cause,
      actor: actorOf(d?.source_eid),
      target: actorOf(d?.victim_eid),
    })
  }
  // 击毁同样逐发归属（最近弹着 ≤ 击杀时刻，窗口 [-0.15,+2.0]s），且只认炮弹击杀；
  // 撞击/火灾/环境击杀保留为独立事件（不冒充射击结果）。
  const killByShot = new Set<number>()
  const killsUnmatched: number[] = [] // killPool 下标
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
  // 未归属的击杀：环境/非炮弹（进「其他」片，不冒充射击）
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
  // 战斗聊天正文 = 0x2f code 1（chat_events.message）；快捷指令/成员进出同流。
  // 0x2b 的 chat_messages 是另域（u64=频道句柄）——仅旧产物/无 chat_events 时兜底展示。
  const chatEvents = Array.isArray(facet.chat_events) ? facet.chat_events : []
  for (const ev of chatEvents) {
    switch (ev?.kind) {
      case 'message':
        push('chat', ev?.t, {
          text: typeof ev?.text === 'string' ? ev.text : '',
          sender: ev?.sender || undefined,
          rawType: ev?.raw_type,
          channelName: channelLabel.get(ev?.channel),
        })
        break
      case 'command':
        {
          const name = ev?.command_name
          const payload = typeof ev?.target === 'number' ? ev.target : undefined
          push('command', ev?.t, {
            command: typeof ev?.command === 'number' ? ev.command : undefined,
            commandName: name,
            commandTarget: payload,
            // attack_enemy / help_me_ex / support_me_with_fire 的载荷是目标 accountId
            target: name === 'attack_enemy' || name === 'help_me_ex' || name === 'support_me_with_fire'
              ? actorByAccount(payload)
              : undefined,
            // attention_to_cell 的载荷是扇区号
            // cell 仅对 attention_to_cell（payload=扇区号，上游契约已闭合）；
            // catch_point/defend_point 的 payload 域未取证 → 保留原始目标不映射（禁猜）
            cell: name === 'attention_to_cell' ? payload : undefined,
            sender: ev?.sender || undefined,
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
          rawType: ev?.raw_type,
          channelName: channelLabel.get(ev?.channel),
        })
        break
      default:
        push('presence', ev?.t, { sender: ev?.sender || undefined, rawType: ev?.raw_type })
        break
    }
  }
  // 0x2b 是另域文本（u64 = 频道句柄；上游契约未给出与 0x2f 的等价关系）——
  // 两条记录都保留展示，不做基于正文+时间的去重（不同域的近邻同文不可推定为同一消息）
  for (const m of Array.isArray(facet.chat_messages) ? facet.chat_messages : []) {
    const text = typeof m?.text === 'string' ? m.text : ''
    if (!text) continue
    push('chat', m?.t, { text, otherDomain: true })
  }
  // 逐模块损伤（method38 作者路径）：与 module_crew_states 合并到「模块/乘员」过滤片
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
    push('notice', n?.t, { code: n?.code })
  }
  for (const mc of Array.isArray(facet.module_crew_states) ? facet.module_crew_states : []) {
    // AgentModuleCrewState：clock/vehicle_eid/component/state（snake_case 语义名）
    push('module', mc?.clock, {
      eid: mc?.vehicle_eid,
      text: mc?.component && mc?.state ? `${mc.component} ${mc.state}` : mc?.state || '',
      component: mc?.component,
      state: mc?.state,
      actor: actorOf(mc?.vehicle_eid),
    })
  }
  // 基地占领（supremacy owner/capturing 变化；单基地 assault 只有进度 → 仅 owner 类事件）
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
          captureState: owner == null ? 'neutralized' : 'captured',
        })
      }
      prevOwner.set(base, owner)
      const cap = tr?.capturing_team ?? null
      if (prevCapturing.has(base) && prevCapturing.get(base) !== cap && cap != null) {
        push('capture', tr?.clock, { baseId: base, team: cap, captureState: 'invading' })
      }
      prevCapturing.set(base, cap)
    }
  }
  // 攻防战单基地进度（assault_bases 只有进度 0..=100）：进度上升 = 正在占领；
  // 到达 100 = 占领完成（字段定义即「占领进度」，非统计推断）。推进进度原样带出。
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
  // 首次进入观察集（**录制端 AoI 观测**，不是游戏侦察/点亮事实：回放里没有
  // 点亮归属证据。措辞必须如实——「首次观测」，不得命名为 spotted）。
  const seenSpotted = new Set<number>()
  for (const vis of Array.isArray(facet.visibility) ? facet.visibility : []) {
    const eid = vis?.eid
    if (typeof eid !== 'number' || seenSpotted.has(eid)) continue
    seenSpotted.add(eid)
    push('observed', vis?.t_in, { eid, actor: actorOf(eid) })
  }
  // 场景破坏（区域可破坏物事件；进「其他」片）
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
