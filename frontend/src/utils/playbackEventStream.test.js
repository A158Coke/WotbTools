import { describe, it, expect } from 'vitest'
import {
  buildEventStream, eventRowTitle, filterEvents, nearestEventTime, sectorLabel, shotVerdict, EVENT_FILTERS,
} from './playbackEventStream.ts'

const FACET = {
  shots: [
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
    { t: 12, victim_eid: 2, damage: 320, hp: 680, source_eid: 1, cause: 0 },
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
  meta: { friendly_team: 1 },
}

describe('buildEventStream', () => {
  it('merges all sources sorted by t with filter groups', () => {
    const evs = buildEventStream(FACET)
    expect(evs.map((e) => e.t)).toEqual([
      3, 4, 10, 12, 15, 21, 22, 23, 24, 26, 28, 30, 31, 32, 33, 34, 35, 40, 45, 60,
    ])
    const byKind = Object.groupBy ? null : null
    expect(evs[0].kind).toBe('observed')
    expect(evs.find((e) => e.kind === 'shot')?.t).toBe(10)
    expect(evs.find((e) => e.kind === 'shot' && e.t === 10)?.verdict).toBe('ricochet')
    expect(evs.find((e) => e.kind === 'consumable')?.t).toBe(15)
    expect(evs.find((e) => e.t === 21)?.kind).toBe('notice')
    expect(evs.find((e) => e.t === 22)?.kind).toBe('chat')
    const pen = evs.find((e) => e.kind === 'shot' && e.t === 30)
    expect(pen.verdict).toBe('penetrated')
    expect(pen.isAuthor).toBe(true)
    expect(evs.filter((e) => e.kind === 'death').length).toBe(2)
    expect(evs.find((e) => e.kind === 'revive').t).toBe(45)
    expect(evs.find((e) => e.kind === 'notice').filter).toBe('other')
    expect(evs.find((e) => e.kind === 'revive').filter).toBe('other')
  })

  it('炮击/掉血/击毁合并且带双方身份（用户口径）', () => {
    const evs = buildEventStream(FACET)
    const shot = evs.find((e) => e.kind === 'shot' && e.t === 30)
    expect(shot.shotDamage).toBe(250)
    expect(shot.shotKill).toBe(true)
    expect(shot.actor).toMatchObject({ eid: 1, name: 'Alpha', tank: 'T-62A' })
    expect(shot.target).toMatchObject({ eid: 2, name: 'Bravo', tank: 'E 100' })
    const dmg = evs.find((e) => e.kind === 'damage')
    expect(dmg.damage).toBe(320)
    expect(dmg.filter).toBe('damage')
    expect(dmg.actor).toMatchObject({ eid: 1, name: 'Alpha' })
    expect(dmg.target).toMatchObject({ eid: 2, name: 'Bravo' })
    expect(evs.filter((e) => e.kind === 'kill')).toHaveLength(0)

    const caps = evs.filter((e) => e.kind === 'capture')
    expect(caps.map((e) => e.captureState)).toEqual(['invading', 'captured', 'invading', 'captured'])
    expect(caps[1].team).toBe(1)
    expect(caps[1].faction).toBe('friendly')
    expect(caps[0].faction).toBe('friendly')
    expect(caps[1].baseId).toBe(0)
    expect(caps[2].progress).toBe(40)
    expect(caps[3].progress).toBe(100)

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
    expect(cmd.target).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(cmd.filter).toBe('chat')
    const presence = evs.filter((e) => e.kind === 'presence').map((e) => e.sender)
    expect(presence).toContain('Near996')
    const both = buildEventStream({
      chat_events: [{ t: 10, kind: 'message', raw_type: 1, channel: 1, sender: 'A', text: 'hi' }],
      chat_messages: [{ t: 12, tag: 1, seq: 2, text: 'other-domain' }],
    })
    expect(both.filter((e) => e.kind === 'chat').map((e) => e.text)).toEqual(['hi', 'other-domain'])
    const dup = buildEventStream({
      chat_events: [{ t: 10, kind: 'message', raw_type: 1, channel: 1, sender: 'A', text: 'hi' }],
      chat_messages: [{ t: 10.2, tag: 1, seq: 2, text: 'hi' }],
    })
    expect(dup.filter((e) => e.kind === 'chat')).toHaveLength(2)
  })

  it('command/marker 标题不再拼接内部频道名', () => {
    const facet = {
      ...FACET,
      chat_channels: [{ id: 1549648, channel_name: '#chat:channels/battle/team' }],
    }
    const evs = buildEventStream(facet)
    const cmd = evs.find((e) => e.kind === 'command' && e.t === 23)
    expect(cmd.channelName).toBe('team')
    expect(eventRowTitle(cmd, (key) => key)).toBe('eventStream.cmd_attack_enemy')
  })

  it('指令目标/通知主体/发送者按 eid 或 accountId 联表到玩家与坦克', () => {
    const facet = {
      vehicles: [
        { eid: 1, account_id: 2002, nickname: 'Alpha', tank_id: 100, tank_name: 'tank_100', team: 1 },
        { eid: 2, account_id: 3003, nickname: 'Bravo', tank_id: 200, tank_name: 'tank_200', team: 2 },
      ],
      chat_events: [
        { t: 1, kind: 'command', raw_type: 20, sender: 'Alpha', command: 29, command_name: 'attack_enemy', target: 2 },
        { t: 2, kind: 'command', raw_type: 20, sender: 'Bravo', command: 29, command_name: 'attack_enemy', target: 2002 },
        { t: 3, kind: 'message', raw_type: 1, sender: 'Alpha', text: 'hi' },
        { t: 4, kind: 'join', raw_type: 0, sender: 'Bravo' },
      ],
      notifications: [
        { t: 5, subject: 2, code: 11515 },
        { t: 6, subject: 2002, code: 11515 },
        { t: 7, subject: 99999, code: 1 },
      ],
    }
    const evs = buildEventStream(facet, { tankNames: { 100: 'T-62A', 200: 'E 100' } })
    const cmds = evs.filter((e) => e.kind === 'command')
    expect(cmds[0].actor).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(cmds[0].target).toMatchObject({ name: 'Bravo', tank: 'E 100' })
    expect(cmds[1].target).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(evs.find((e) => e.kind === 'chat').actor).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(evs.find((e) => e.kind === 'presence').actor).toMatchObject({ name: 'Bravo', tank: 'E 100' })
    const notices = evs.filter((e) => e.kind === 'notice')
    expect(notices[0].actor).toMatchObject({ name: 'Bravo', tank: 'E 100' })
    expect(notices[1].actor).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(notices[2].actor).toBeUndefined()
  })

  it('tank_<id> 占位名不上 UI；tankNames 注入真实车型名', () => {
    const facet = {
      vehicles: [{ eid: 1, nickname: 'Alpha', tank_id: 100, tank_name: 'tank_100', team: 1 }],
      visibility: [{ eid: 1, t_in: 0 }],
    }
    expect(buildEventStream(facet)[0].actor.tank).toBeUndefined()
    expect(buildEventStream(facet, { tankNames: { 100: 'T-62A' } })[0].actor.tank).toBe('T-62A')
  })

  it('地图类指令进入 marker 片；扇区保留、据点目标不猜', () => {
    const facet = {
      vehicles: [{ eid: 1, nickname: 'Alpha', tank_name: 'T-62A', team: 1 }],
      chat_events: [
        { t: 1, kind: 'command', raw_type: 20, sender: 'Alpha', command: 28, command_name: 'attention_to_cell', target: 6 },
        { t: 2, kind: 'command', raw_type: 20, sender: 'Alpha', command: 60, command_name: 'moving_here', target: 0 },
        { t: 3, kind: 'command', raw_type: 20, sender: 'Alpha', command: 57, command_name: 'catch_point', target: 9 },
        { t: 4, kind: 'command', raw_type: 20, sender: 'Alpha', command: 58, command_name: 'defend_point', target: 9 },
      ],
    }
    const evs = buildEventStream(facet)
    const markers = evs.filter((e) => e.kind === 'marker')
    expect(markers).toHaveLength(4)
    expect(markers.every((e) => e.filter === 'marker')).toBe(true)
    expect(markers[0]).toMatchObject({ commandName: 'attention_to_cell', cell: 6, cellLabel: 'B3' })
    expect(markers[0].actor).toMatchObject({ name: 'Alpha', tank: 'T-62A' })
    expect(markers[2].target).toBeUndefined()
    expect(markers[2].cell).toBeUndefined()
    expect(markers[2].commandTarget).toBe(9)
    expect(filterEvents(evs, 'marker')).toHaveLength(4)
  })

  it('扇区号 1..9 → A1..C3；域外不生成标签', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(sectorLabel))
      .toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'])
    expect(sectorLabel(0)).toBeUndefined()
    expect(sectorLabel(10)).toBeUndefined()
    expect(sectorLabel(6.5)).toBeUndefined()
    expect(sectorLabel(undefined)).toBeUndefined()
  })

  it('0x2e 战场标记：moving_here/attack/ally_retreat 带玩家与坦克身份', () => {
    const facet = {
      vehicles: [
        { eid: 136106019, account_id: 2033684170, nickname: 'Anonyme', tank_id: 14129, tank_name: 'tank_14129', team: 1 },
        { eid: 136106020, account_id: 2028526399, nickname: 'BBA9', tank_id: 18001, tank_name: 'tank_18001', team: 1 },
        { eid: 136106027, account_id: 2047518170, nickname: 'Karsonkarthik', tank_id: 13857, tank_name: 'tank_13857', team: 2 },
      ],
      markers: [
        { t: 47.72, entity_id: 136106019, account_id: 2033684170, marker_type: 1, at: [176, 62, 60] },
        { t: 71.83, entity_id: 136106019, account_id: 2033684170, marker_type: 5, target_eid: 136106020 },
        { t: 26.9, entity_id: 136106019, account_id: 2033684170, marker_type: 4, target_eid: 136106027 },
        { t: 90, entity_id: 136106019, account_id: 2033684170, marker_type: 6 },
      ],
    }
    const evs = buildEventStream(facet, { tankNames: { 14129: 'BZT-70', 18001: 'BZT-70', 13857: 'Rinoceronte' } })
    const markers = evs.filter((e) => e.kind === 'marker')
    expect(markers.map((e) => e.commandName)).toEqual(['attack', 'moving_here', 'ally_retreat', undefined])
    const moving = markers.find((e) => e.t === 47.72)
    expect(moving.actor).toMatchObject({ name: 'Anonyme', tank: 'BZT-70' })
    const retreat = markers.find((e) => e.t === 71.83)
    expect(retreat.commandName).toBe('ally_retreat')
    expect(retreat.target).toMatchObject({ name: 'BBA9', tank: 'BZT-70' })
    const attack = markers.find((e) => e.t === 26.9)
    expect(attack.commandName).toBe('attack')
    expect(attack.target).toMatchObject({ name: 'Karsonkarthik', tank: 'Rinoceronte' })
    const unknown = markers.find((e) => e.t === 90)
    expect(unknown.markerType).toBe(6)
    expect(unknown.target).toBeUndefined()
    expect(filterEvents(evs, 'marker')).toHaveLength(4)
  })

  it('0x2e 身份域固定：eid 未命中不得误吃同号 accountId（评审 4614554391）', () => {
    const facet = {
      vehicles: [
        { eid: 10, account_id: 20, nickname: 'Wrong', tank_name: 'T1', team: 2 },
        { eid: 30, account_id: 40, nickname: 'Sender', tank_name: 'T2', team: 1 },
      ],
      markers: [
        { t: 1, entity_id: 20, account_id: 40, marker_type: 1, at: [0, 0, 0] },
        { t: 2, entity_id: 30, account_id: 40, marker_type: 4, target_eid: 40 },
      ],
    }
    const evs = buildEventStream(facet).filter((e) => e.kind === 'marker')
    expect(evs[0].actor).toMatchObject({ name: 'Sender', tank: 'T2' })
    expect(evs[1].target).toBeUndefined()
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
    expect(shot.shotDamage).toBeUndefined()
    expect(shot.shotKill).toBeUndefined()
    const ram = evs.find((e) => e.kind === 'damage')
    expect(ram.damage).toBe(900)
    expect(ram.cause).toBe(2)
    const kill = evs.find((e) => e.kind === 'kill')
    expect(kill.filter).toBe('other')
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
    expect(shots.map((s) => s.shotKill)).toEqual([undefined, true])
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
    expect(shotVerdict(shot({ game_hit_result: 1 }))).toBe('blocked')
    expect(shotVerdict(shot({ game_hit_result: 3 }))).toBe('penetrated')
    expect(shotVerdict(shot({ game_hit_result: 2 }))).toBe('blocked')
    expect(shotVerdict(shot({ game_hit_result: 4 }))).toBe(null)
    expect(shotVerdict(shot({ game_hit_result: 255 }))).toBe(null)
    expect(shotVerdict(shot({ ricochet: true }))).toBe('ricochet')
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
    expect(filterEvents(evs, 'shot').every((e) => e.kind === 'shot')).toBe(true)
    expect(filterEvents(evs, 'damage').map((e) => e.kind)).toEqual(['damage'])
    const cons = evs.find((e) => e.kind === 'consumable')
    expect(cons.actor).toMatchObject({ eid: 1, name: 'Alpha' })
  })
  it('filter keys are all known groups', () => {
    for (const f of EVENT_FILTERS) expect(f.key).toMatch(/^(all|shot|damage|kill|capture|observed|marker|chat|module|consumable|other)$/)
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
