import type { AgentPlaybackFacet } from '../api/agent-replay-facets'
import { shotVerdict, sectorLabel } from './playbackEventStream.js'
import type { EventIdentity } from './playbackEventStreamIdentity.js'

/**
 * 事件流逐源收集器（shots/kills/chat/markers/module/consumable/capture/…）——
 * 自 playbackEventStream.ts 的 buildEventStream 出仓（2026-11-21 #LOC 结构拆分，
 * 代码与搬移前逐字一致）。每个 collect* 只向 ctx.push 追加行，不做排序。
 */

export type CollectorCtx = EventIdentity & {
  push(
    kind: import('./playbackEventStream.js').EventKind,
    t: unknown,
    extra?: Omit<Partial<import('./playbackEventStream.js').PlaybackEventRow>, 'kind' | 'filter' | 't'>,
    filterOverride?: import('./playbackEventStream.js').EventFilterKey,
  ): void
}

/** —— 炮击 / 掉血 / 击毁合并为一条战斗行（用户口径：不再分开展示）—— */
export function collectCombatRows(facet: AgentPlaybackFacet, ctx: CollectorCtx): void {
  const { push, actorOf } = ctx
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
}

/** 战斗聊天 / 快捷指令 / 成员进出 / 0x2e 战场标记 / 0x2b 另域文本。 */
export function collectChatRows(facet: AgentPlaybackFacet, ctx: CollectorCtx): void {
  const { push, actorByName, actorByRef, actorOfMarkerEid, actorOfMarkerAccount, channelLabel } = ctx
  // 战斗聊天正文 = 0x2f code 1（chat_events.message）；快捷指令/成员进出同流。
  // 0x2b 的 chat_messages 是另域（u64=频道句柄）——仅旧产物/无 chat_events 时兜底展示。
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
          // 地图类指令（扇区/位置标记）单独成 kind，事件流有独立「地图标记」过滤片。
          const marker = name === 'attention_to_cell' || name === 'moving_here'
            || name === 'catch_point' || name === 'defend_point'
          // 只有这三类的载荷是玩家目标（语料实测 attack_enemy 为 eid；见 actorByRef）。
          const playerTarget = name === 'attack_enemy' || name === 'help_me_ex'
            || name === 'support_me_with_fire'
          push(marker ? 'marker' : 'command', ev?.t, {
            command: typeof ev?.command === 'number' ? ev.command : undefined,
            commandName: name,
            commandTarget: payload,
            target: playerTarget ? actorByRef(payload) : undefined,
            // attention_to_cell 的载荷是扇区号；catch_point/defend_point 的 payload 域
            // 上游未取证 → 保留 commandTarget 原值，不映射为 cell/据点编号（禁猜）。
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
  // 战场快捷标记（Avatar method 0x2e）：与 0x2f 聊天指令是两条包路径，不能互相替代。
  // BZT-70 场：type1 t=47.72 → 战斗日志“Moving here”，type5 t=71.83 → “Let's fall back!”。
  // type 4=attack 的目标是车辆 eid；type 1 只有世界坐标（不参与行文本）。
  // 未观测类型只保留 marker_type，UI 显示原始类型号（禁猜语义）。
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
  // 0x2b 是另域文本（u64 = 频道句柄；上游契约未给出与 0x2f 的等价关系）——
  // 两条记录都保留展示，不做基于正文+时间的去重（不同域的近邻同文不可推定为同一消息）
  for (const m of Array.isArray(facet.chat_messages) ? facet.chat_messages : []) {
    const text = typeof m?.text === 'string' ? m.text : ''
    if (!text) continue
    push('chat', m?.t, { text, otherDomain: true })
  }
}

/** 基地占领（supremacy owner/capturing 变化）与攻防战单基地进度。 */
export function collectCaptureRows(facet: AgentPlaybackFacet, ctx: CollectorCtx): void {
  const { push, factionOf } = ctx
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
}

/** 模块/乘员状态、通知、消耗品、观测、场景破坏、死亡/复活等状态类事件。 */
export function collectStatusRows(facet: AgentPlaybackFacet, ctx: CollectorCtx): void {
  const { push, actorOf, actorBySubject } = ctx
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
    // subject 语义上游未定（eid/accountId 量级均观测到）；仅按名册做 id→身份联表，
    // 不据此命名通知含义。code 保持原始值。
    push('notice', n?.t, {
      code: n?.code,
      subject: n?.subject,
      actor: actorBySubject(n?.subject),
    })
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
}
