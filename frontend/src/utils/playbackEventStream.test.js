// 统一事件流纯函数测试：合并/排序/过滤/最近邻 + verdict 枚举语义 + fail-closed 边界。
import { describe, it, expect } from 'vitest'
import {
  buildEventStream, filterEvents, nearestEventTime, shotVerdict, EVENT_FILTERS,
} from './playbackEventStream.ts'

const FACET = {
  shots: [
    // 真实枚举形状（game_hit_result 是结果枚举，不是 hit_flags 位图）
    { t_fire: 30, shooter_eid: 1, target_eid: 2, game_hit_result: 3, hit_flags: 0, ricochet: false, is_kill: false, is_author: true },
    { t_fire: 10, shooter_eid: 2, target_eid: 3, game_hit_result: 0, hit_flags: 0, ricochet: true, is_kill: false },
  ],
  kills: [{ t: 32, killer_eid: 1, victim_eid: 2, cause: 0 }],
  notifications: [{ t: 21, subject: 9, code: 11515 }],
  chat_events: [
    { t: 22, kind: 'message', raw_type: 1, channel: 1549648, sender: 'BLACK_TROOP_sniper', text: 'how do get that tank?' },
    { t: 23, kind: 'command', raw_type: 20, channel: 1549648, sender: 'Pratama_Gerald', command: 29, command_name: 'attack_enemy', target: 2002 },
    { t: 24, kind: 'join', raw_type: 0, channel: 1549648, sender: 'Near996' },
  ],
  module_damage_events: [
    { clock: 31, victim_eid: 2, component_code: 35, component: 'left_track', state_code: 1, state: 'damaged' },
  ],
  damage_events: [
    { t: 12, victim_eid: 2, damage: 320, hp: 680, source_eid: 1, cause: 0 }, // 未匹配炮击（环境/未记录射击）
    { t: 30.3, victim_eid: 2, damage: 250, hp: 430, source_eid: 1, cause: 0 }, // 并入 t=30 的炮击行
  ],
  supremacy_bases: [
    { clock: 5, base_id: 0, owner_team: null, capturing_team: null },
    { clock: 26, base_id: 0, owner_team: null, capturing_team: 1 },
    { clock: 28, base_id: 0, owner_team: 1, capturing_team: null },
  ],
  visibility: [
    { eid: 1, t_in: 3, t_out: 10 },
    { eid: 2, t_in: 4, t_out: 8 },
    { eid: 2, t_in: 11, t_out: 20 },
  ],
  assault_bases: [
    { clock: 29, progress: 0 },
    { clock: 34, progress: 40 },
    { clock: 35, progress: 100 },
  ],
  destructible_events: [
    { clock: 33, area_eid: 77, prop: 3, slot: 2, fall_dir: 90, body_len: 5, args: [] },
  ],
  module_crew_states: [{ clock: 40, vehicle_eid: 2, component: 'engine', state: 'damaged_degraded' }],
  consumables: [{ clock: 15, eid: 1, logical_item_id: 'large_repairkit', state: 2 }],
  vehicles: [
    { eid: 1, nickname: 'Alpha', tank_name: 'T-62A', team: 1, account_id: 2002 },
    { eid: 2, nickname: 'Bravo', tank_name: 'E 100', team: 2, death_times: [32, 60], resurrection_times: [45] },
    { eid: 3, nickname: 'Charlie', tank_name: 'Maus', team: 2 },
  ],
}

describe('buildEventStream', () => {
  it('merges all sources sorted by t with filter groups', () => {
    const evs = buildEventStream(FACET)
    // chat_events 在场 → 0x2b 旧 chat_messages(t=20) 不参与（另域兜底只在缺失时）
    // 新增：damage(t=12)、spotted(3,4)、capture(26,28)、destructible(33)
    expect(evs.map((e) => e.t)).toEqual([
      3, 4, 10, 12, 15, 21, 22, 23, 24, 26, 28, 30, 31, 32, 33, 34, 35, 40, 45, 60,
    ])
    const byKind = Object.groupBy ? null : null
    expect(evs[0].kind).toBe('observed') // t=3 最早（录制端首次观测）
    expect(evs.find((e) => e.kind === 'shot')?.t).toBe(10)
    expect(evs.find((e) => e.kind === 'shot' && e.t === 10)?.verdict).toBe('ricochet') // 显式 ricochet 布尔
    expect(evs.find((e) => e.kind === 'consumable')?.t).toBe(15)
    expect(evs.find((e) => e.t === 21)?.kind).toBe('notice') // 0x2b 旧 chat(t=20) 被 chat_events 取代
    expect(evs.find((e) => e.t === 22)?.kind).toBe('chat')
    const pen = evs.find((e) => e.kind === 'shot' && e.t === 30)
    expect(pen.verdict).toBe('penetrated')
    expect(pen.isAuthor).toBe(true)
    expect(evs.filter((e) => e.kind === 'death').length).toBe(2) // 击杀事件已并入炮击行，死亡轨道独立
    expect(evs.find((e) => e.kind === 'revive').t).toBe(45)
    // 过滤组映射：notice/death/revive → other
    expect(evs.find((e) => e.kind === 'notice').filter).toBe('other')
    expect(evs.find((e) => e.kind === 'revive').filter).toBe('other')
  })

  it('炮击/掉血/击毁合并且带双方身份（用户口径）', () => {
    const evs = buildEventStream(FACET)
    const shot = evs.find((e) => e.kind === 'shot' && e.t === 30)
    expect(shot.shotDamage).toBe(250) // damage(30.3) 并入
    expect(shot.shotKill).toBe(true) // kill(32) 并入
    expect(shot.actor).toMatchObject({ eid: 1, name: 'Alpha', tank: 'T-62A' })
    expect(shot.target).toMatchObject({ eid: 2, name: 'Bravo', tank: 'E 100' })
    // 未匹配的掉血仍单列（环境/未记录射击），归「炮击」片并带来源/受害身份
    const dmg = evs.find((e) => e.kind === 'damage')
    expect(dmg.damage).toBe(320)
    expect(dmg.filter).toBe('shot')
    expect(dmg.actor).toMatchObject({ eid: 1, name: 'Alpha' })
    expect(dmg.target).toMatchObject({ eid: 2, name: 'Bravo' })
    // 击杀不再是独立行（已并入炮击）
    expect(evs.filter((e) => e.kind === 'kill')).toHaveLength(0)

    const caps = evs.filter((e) => e.kind === 'capture')
    // 顺序：supremacy invading(26) → supremacy captured(28) → assault 进度上升(34/35)
    expect(caps.map((e) => e.captureState)).toEqual(['invading', 'captured', 'invading', 'captured'])
    expect(caps[1].team).toBe(1)
    expect(caps[1].baseId).toBe(0)
    expect(caps[2].progress).toBe(40)
    expect(caps[3].progress).toBe(100)

    // 同车重入只报首次点亮（spotted 语义）；身份带昵称/车名
    const spotted = evs.filter((e) => e.kind === 'observed')
    expect(spotted.map((e) => e.t)).toEqual([3, 4])
    expect(spotted[0].actor).toMatchObject({ eid: 1, name: 'Alpha', tank: 'T-62A' })

    const dest = evs.find((e) => e.kind === 'destructible')
    expect(dest.filter).toBe('other')
  })

  it('0x2f chat_events: message/command/presence 归类与过滤片', () => {
    const evs = buildEventStream(FACET)
    const chat = evs.find((e) => e.kind === 'chat')
    expect(chat.text).toBe('how do get that tank?')
    expect(chat.rawType).toBe(1)
    expect(chat.sender).toBe('BLACK_TROOP_sniper')
    const cmd = evs.find((e) => e.kind === 'command')
    expect(cmd.command).toBe(29)
    expect(cmd.sender).toBe('Pratama_Gerald')
    expect(cmd.commandName).toBe('attack_enemy')
    // attack_enemy 的载荷是 accountId → 解析到目标玩家身份
    expect(cmd.target).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(cmd.filter).toBe('chat')
    const presence = evs.filter((e) => e.kind === 'presence').map((e) => e.sender)
    expect(presence).toContain('Near996')
    // 0x2b 与 0x2f 双域同时出现时都要展示（跨域无协议等价证据，不去重——评审 4596693945）
    const both = buildEventStream({
      chat_events: [{ t: 10, kind: 'message', raw_type: 1, channel: 1, sender: 'A', text: 'hi' }],
      chat_messages: [{ t: 12, tag: 1, seq: 2, text: 'other-domain' }],
    })
    expect(both.filter((e) => e.kind === 'chat').map((e) => e.text)).toEqual(['hi', 'other-domain'])
    // 近邻同文也不去重（不能凭文字+时间推定同一消息）
    const dup = buildEventStream({
      chat_events: [{ t: 10, kind: 'message', raw_type: 1, channel: 1, sender: 'A', text: 'hi' }],
      chat_messages: [{ t: 10.2, tag: 1, seq: 2, text: 'hi' }],
    })
    expect(dup.filter((e) => e.kind === 'chat')).toHaveLength(2)
  })

  it('连发逐发归属：窗口内伤害不会被第一发吞掉（评审 4595459443）', () => {
    const facet = {
      shots: [
        { t_fire: 10, flight_secs: 0, shooter_eid: 1, target_eid: 2, hit: true, ricochet: false, is_kill: false, game_hit_result: 3 },
        { t_fire: 10.5, flight_secs: 0, shooter_eid: 1, target_eid: 2, hit: true, ricochet: false, is_kill: false, game_hit_result: 3 },
      ],
      damage_events: [
        { t: 10.3, victim_eid: 2, source_eid: 1, damage: 300, hp: 700, cause: 0 },
        { t: 10.7, victim_eid: 2, source_eid: 1, damage: 200, hp: 500, cause: 0 },
      ],
      kills: [],
      vehicles: [{ eid: 1, nickname: 'A', tank_name: 'T' }, { eid: 2, nickname: 'B', tank_name: 'U' }],
    }
    const evs = buildEventStream(facet)
    const shots = evs.filter((e) => e.kind === 'shot')
    expect(shots.map((s) => s.shotDamage)).toEqual([300, 200])
  })

  it('非炮弹原因（撞击/火焰/环境）不并入射击行（评审 4595466596）', () => {
    const facet = {
      shots: [{ t_fire: 10, flight_secs: 0.1, shooter_eid: 1, target_eid: 2, hit: true, ricochet: false, is_kill: false, game_hit_result: 3 }],
      damage_events: [{ t: 10.5, victim_eid: 2, source_eid: 1, damage: 900, hp: 100, cause: 2 }],
      kills: [{ t: 10.5, killer_eid: 1, victim_eid: 2, cause: 2 }],
      vehicles: [{ eid: 1, nickname: 'A', tank_name: 'T' }, { eid: 2, nickname: 'B', tank_name: 'U' }],
    }
    const evs = buildEventStream(facet)
    const shot = evs.find((e) => e.kind === 'shot')
    expect(shot.shotDamage).toBeUndefined() // 撞击伤害不冒充炮弹
    expect(shot.shotKill).toBeUndefined()
    const ram = evs.find((e) => e.kind === 'damage')
    expect(ram.damage).toBe(900)
    expect(ram.cause).toBe(2)
    const kill = evs.find((e) => e.kind === 'kill')
    expect(kill.filter).toBe('other') // 非射击击杀留在其他片
  })

  it('连发击毁按最近弹着归属（不是窗口第一发）', () => {
    const facet = {
      shots: [
        { t_fire: 10, flight_secs: 0.1, shooter_eid: 1, target_eid: 2, hit: true, ricochet: false, is_kill: false, game_hit_result: 3 },
        { t_fire: 10.5, flight_secs: 0.1, shooter_eid: 1, target_eid: 2, hit: true, ricochet: false, is_kill: false, game_hit_result: 3 },
      ],
      damage_events: [
        { t: 10.1, victim_eid: 2, source_eid: 1, damage: 40, hp: 60, cause: 0 },
        { t: 10.6, victim_eid: 2, source_eid: 1, damage: 50, hp: 10, cause: 0 },
      ],
      kills: [{ t: 10.6, killer_eid: 1, victim_eid: 2, cause: 0 }],
      vehicles: [],
    }
    const shots = buildEventStream(facet).filter((e) => e.kind === 'shot')
    expect(shots.map((s) => s.shotDamage)).toEqual([40, 50])
    expect(shots.map((s) => s.shotKill)).toEqual([undefined, true]) // 击毁归第二发
  })

  it('module_damage_events 并入 module 过滤片', () => {
    const evs = buildEventStream(FACET)
    const dmg = evs.find((e) => e.kind === 'moduleDamage')
    expect(dmg.eid).toBe(2)
    expect(dmg.component).toBe('left_track')
    expect(dmg.filter).toBe('module')
  })

  it('verdict follows enum + explicit booleans (never bitmap-shifts the enum)', () => {
    const shot = (patch) => ({ t_fire: 1, shooter_eid: 1, target_eid: 2, game_hit_result: 0, hit_flags: 0, ricochet: false, is_kill: false, ...patch })
    expect(shotVerdict(shot({ is_kill: true }))).toBe('kill')
    expect(shotVerdict(shot({ game_hit_result: 1 }))).toBe('blocked') // 未穿 ≠ 击杀
    expect(shotVerdict(shot({ game_hit_result: 3 }))).toBe('penetrated') // 有伤害
    expect(shotVerdict(shot({ game_hit_result: 2 }))).toBe('blocked') // 间隙止
    expect(shotVerdict(shot({ game_hit_result: 4 }))).toBe(null) // raw：不猜
    expect(shotVerdict(shot({ game_hit_result: 255 }))).toBe(null) // 未获取
    expect(shotVerdict(shot({ ricochet: true }))).toBe('ricochet')
    // 作者位图优先（hit_flags 是位图；与枚举分工不同）
    expect(shotVerdict(shot({ hit_flags: 0x0010 }))).toBe('penetrated')
    expect(shotVerdict(shot({ hit_flags: 0x1000 }))).toBe('he')
    expect(shotVerdict(shot({}))).toBe(null)
    expect(shotVerdict(undefined)).toBe(null)
  })

  it('drops entries with non-finite time (fail-closed)', () => {
    const evs = buildEventStream({ kills: [{ t: Number.NaN, killer_eid: 1, victim_eid: 2 }] })
    expect(evs).toEqual([])
  })

  it('tolerates empty / missing facet', () => {
    expect(buildEventStream(null)).toEqual([])
    expect(buildEventStream({})).toEqual([])
    expect(buildEventStream({ shots: 'bad' })).toEqual([])
  })
})

describe('filterEvents', () => {
  const evs = buildEventStream(FACET)
  it('all passes through; unknown filter fails closed to empty', () => {
    expect(filterEvents(evs, 'all')).toHaveLength(evs.length)
    expect(filterEvents(evs, 'nonexistent')).toEqual([])
  })
  it('group filters select the right rows', () => {
    expect(filterEvents(evs, 'chat').map((e) => e.kind)).toEqual(['chat', 'command', 'presence'])
    expect(filterEvents(evs, 'other').map((e) => e.kind)).toEqual(['notice', 'death', 'destructible', 'revive', 'death'])
    // 炮击片 = 炮击行 + 未匹配的掉血行（合并呈现口径）
    expect(filterEvents(evs, 'shot').every((e) => e.kind === 'shot' || e.kind === 'damage')).toBe(true)
    const cons = evs.find((e) => e.kind === 'consumable')
    expect(cons.actor).toMatchObject({ eid: 1, name: 'Alpha' })
  })
  it('filter keys are all known groups', () => {
    for (const f of EVENT_FILTERS) expect(f.key).toMatch(/^(all|shot|damage|kill|capture|observed|chat|module|consumable|other)$/)
  })
})

describe('nearestEventTime', () => {
  const evs = [{ t: 10 }, { t: 20 }, { t: 30 }]
  it('finds strictly next/prev', () => {
    expect(nearestEventTime(evs, 15, 1)).toBe(20)
    expect(nearestEventTime(evs, 15, -1)).toBe(10)
    expect(nearestEventTime(evs, 10, 1)).toBe(20)
    expect(nearestEventTime(evs, 10, -1)).toBe(null)
    expect(nearestEventTime(evs, 30, 1)).toBe(null)
    expect(nearestEventTime([], 0, 1)).toBe(null)
  })
})
