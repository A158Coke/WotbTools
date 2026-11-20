// @vitest-environment happy-dom
// ReplayEventStreamPane 组件测试：数据装载（缓存通道）、过滤 chips、seek 转发、
// 装甲检视交接（现有射击复现入口，不自建 viewer 契约）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { storeShotsForViewer, shotViewerQuery } = vi.hoisted(() => ({
  storeShotsForViewer: vi.fn(),
  shotViewerQuery: vi.fn(),
}))
vi.mock('../scene/agentData.js', () => ({
  storeShotsForViewer,
  shotViewerQuery,
  // 事件流车型名表（tank_cache）与真实 annotateMountedConfigs 读取的资产面。
  fetchTankEncyclopedia: vi.fn(async () => ({})),
  assetProvider: { json: vi.fn() },
  fetchShotTankData: vi.fn(),
}))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  const state = ref('online')
  const settled = ref(true)
  return { useConnectivity: () => ({ connectivity: state, settled, isSettled: () => settled.value, whenSettled: () => Promise.resolve() }) }
})
vi.mock('../api/agent-replay-facets.js', () => ({
  parseAgentShotsFromBytes: vi.fn(),
  enrichShotsFromRoster: vi.fn(),
}))
vi.mock('../replay-local/canonical/facts', () => ({
  resolveReplayClock: vi.fn(() => ({ startRaw: 14 })),
}))
const handoff = vi.hoisted(() => ({
  buildPitchLimits: vi.fn(async () => ({ Alpha: { dep: 15, ele: 7 } })),
  annotateMountedConfigs: vi.fn(),
}))
// 只替换俯仰锚定（避免真实资产请求）；搭载配置富化走真实实现，让交接快照的
// config_idx 由生产代码写入，而不是被 mock 掉（评审 4597024398）。
vi.mock('../scene/shotHandoff.ts', async (importOriginal) => {
  const actual = await importOriginal()
  handoff.annotateMountedConfigs.mockImplementation(actual.annotateMountedConfigs)
  return {
    ...actual,
    buildPitchLimits: handoff.buildPitchLimits,
    annotateMountedConfigs: handoff.annotateMountedConfigs,
  }
})

const i18n = vi.hoisted(() => ({ t: vi.fn((key, params) => {
  if (!params || typeof params !== 'object') return key
  // 简单插值：{name} → 参数值（与 vue-i18n 同语义，够本测试断言身份文本）
  return `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
}) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t }) }))

import ReplayEventStreamPane from './ReplayEventStreamPane.vue'
import { parseAgentShotsFromBytes, enrichShotsFromRoster } from '../api/agent-replay-facets.js'
import { assetProvider, fetchTankEncyclopedia } from '../scene/agentData.js'

const FACET = {
  shots: [
    { t_fire: 30, shooter_eid: 1, target_eid: 2, flight_secs: 0, hit: true, ricochet: false, is_kill: false, game_hit_result: 3, is_author: true },
  ],
  damage_events: [{ t: 30.2, victim_eid: 2, damage: 250, hp: 430, source_eid: 1, cause: 0 }],
  chat_channels: [{ id: 1549648, channel_name: '#chat:channels/battle/team' }],
  kills: [{ t: 32, killer_eid: 1, victim_eid: 2, cause: 0 }],
  chat_events: [{ t: 22, kind: 'message', raw_type: 1, channel: 1549648, sender: 'Alpha', text: 'gg' }],
  notifications: [{ t: 21, subject: 9, code: 11515 }],
  vehicles: [
    { eid: 1, nickname: 'Alpha', tank_name: 'T-62A', team: 1 },
    { eid: 2, nickname: 'Bravo', tank_name: 'E 100', team: 2 },
  ],
}

function makeSession(facet = FACET) {
  return { loadScene: vi.fn().mockResolvedValue(facet) }
}

function mountPane({ session = makeSession(), navigate = vi.fn(), active = true } = {}) {
  return mount(ReplayEventStreamPane, {
    props: { file: new File(['x'], 'a.wotbreplay'), active, playbackSession: session, navigate },
    global: { mocks: { $t: i18n.t } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // 逐车资产/车型名实现只属于设置它的用例，避免跨用例残留。
  assetProvider.json.mockReset()
  fetchTankEncyclopedia.mockReset()
  fetchTankEncyclopedia.mockResolvedValue({})
})

describe('ReplayEventStreamPane', () => {
  it('loads facet via playbackSession cache channel and renders merged stream', async () => {
    const session = makeSession()
    const w = mountPane({ session })
    await flushPromises()
    expect(session.loadScene).toHaveBeenCalledTimes(1)
    const rows = w.findAll('.es-row')
    expect(rows.length).toBe(3) // merged shot 30 / chat 22 / notice 21（kill 已并入炮击行）
    expect(w.find('[data-testid="event-list"]').exists()).toBe(true)
  })

  it('renders merged shot row with both identities and damage', async () => {
    const w = mountPane()
    await flushPromises()
    const body = w.find('[data-kind="shot"]')
    const text = body.text()
    expect(text).toContain('Alpha')
    expect(text).toContain('T-62A')
    expect(text).toContain('Bravo')
    expect(text).toContain('E 100')
    expect(text).toContain('250')
  })

  it('filters via chips without re-parsing', async () => {
    const session = makeSession()
    const w = mountPane({ session })
    await flushPromises()
    await w.find('[data-filter="chat"]').trigger('click')
    expect(w.findAll('.es-row')).toHaveLength(1)
    expect(w.find('[data-kind="chat"]').exists()).toBe(true)
    expect(w.find('[data-kind="chat"]').text()).toContain('[team]')
    expect(session.loadScene).toHaveBeenCalledTimes(1) // 不重复解析
  })

  it('emits seek with event time on click（由统一回放面板转交给当前 2D/3D 视图）', async () => {
    const w = mountPane()
    await flushPromises()
    await w.find('[data-kind="chat"]').trigger('click')
    expect(w.emitted('seek')).toEqual([[22]])
  })

  it('armor button hands off through the existing shot-replay entry', async () => {
    const navigate = vi.fn()
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }],
    })
    shotViewerQuery.mockResolvedValue({ shooter: '10005', shot: '0' })
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    // 交接 = storeShotsForViewer（本地点对点通道）+ shotViewerQuery + navigate（路由归工作台）
    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    expect(shotViewerQuery).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith({ query: { shooter: '10005', shot: '0' } })
  })

  it('armor hand-off skips when no matching shots-facet row (identity miss)', async () => {
    const navigate = vi.fn()
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [] })
    shotViewerQuery.mockResolvedValue(null)
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not parse while inactive', async () => {
    const session = makeSession()
    mountPane({ session, active: false })
    await flushPromises()
    expect(session.loadScene).not.toHaveBeenCalled()
  })

  it('逐模块损伤行带受损组件名（不同组件不混淆）', async () => {
    const facet = {
      ...FACET,
      module_damage_events: [
        { clock: 33, victim_eid: 2, component_code: 31, component: 'engine', state_code: 1, state: 'damaged' },
        { clock: 34, victim_eid: 2, component_code: 35, component: 'left_track', state_code: 1, state: 'damaged' },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const texts = w.findAll('[data-kind="moduleDamage"]').map((n) => n.text())
    expect(texts.some((x) => x.includes('engine'))).toBe(true)
    expect(texts.some((x) => x.includes('left_track'))).toBe(true)
  })

  it('超过单次渲染上限可「显示更多」继续到达（评审 4595548573）', async () => {
    const facet = { ...FACET, notifications: Array.from({ length: 810 }, (_, i) => ({ t: 1 + i * 0.01, subject: 1, code: 11515 })) }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    await w.find('[data-filter="all"]').trigger('click')
    expect(w.findAll('.es-row').length).toBe(800)
    await w.find('[data-testid="es-more"]').trigger('click')
    expect(w.findAll('.es-row').length).toBeGreaterThan(800)
  })

  it('死亡/复活行带车辆身份（评审 4595548578）', async () => {
    const facet = {
      ...FACET,
      vehicles: [
        { eid: 1, nickname: 'Alpha', tank_name: 'T-62A', team: 1 },
        { eid: 2, nickname: 'Bravo', tank_name: 'E 100', team: 2, death_times: [32, 60], resurrection_times: [45] },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const death = w.find('[data-kind="death"]')
    expect(death.text()).toContain('Bravo')
    expect(death.text()).toContain('E 100')
    const revive = w.find('[data-kind="revive"]')
    expect(revive.text()).toContain('Bravo')
  })

  it('离页（pageActive=false）后迟到 query 不导航（评审 4595575111）', async () => {
    const navigate = vi.fn()
    let resolveQuery
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }] })
    shotViewerQuery.mockImplementation(() => new Promise((res) => { resolveQuery = res }))
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 1600))
    await flushPromises()
    await w.setProps({ pageActive: false })
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('卸载后迟到 query 不导航（评审 4595575111）', async () => {
    const navigate = vi.fn()
    let resolveQuery
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }] })
    shotViewerQuery.mockImplementation(() => new Promise((res) => { resolveQuery = res }))
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 1600))
    await flushPromises()
    w.unmount()
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('catch/defend 主文本显示原始目标，不猜据点编号；tooltip 保留', async () => {
    const facet = {
      ...FACET,
      chat_events: [
        { t: 15, kind: 'command', raw_type: 20, channel: 1549648, sender: 'A', command: 57, command_name: 'catch_point', target: 2 },
        { t: 16, kind: 'command', raw_type: 20, channel: 1549648, sender: 'A', command: 58, command_name: 'defend_point', target: 3 },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const rows = w.findAll('[data-kind="marker"]')
    expect(rows).toHaveLength(2)
    const titles = rows.map((n) => n.text())
    expect(titles.some((x) => x.includes('cmd_catch_point_raw') && x.includes('who=A') && x.includes('target=2'))).toBe(true)
    expect(titles.some((x) => x.includes('cmd_defend_point_raw') && x.includes('who=A') && x.includes('target=3'))).toBe(true)
    expect(titles.some((x) => x.includes('cell='))).toBe(false)
    expect(rows[0].attributes('title')).toContain('marker_raw_target')
    expect(rows[0].attributes('title')).toContain('target=2')
    expect(rows[1].attributes('title')).toContain('target=3')
    expect(w.find('[data-filter="marker"]').exists()).toBe(true)
  })

  it('attention_to_cell 显示地图格 B3；0x2e 标记带玩家/坦克身份', async () => {
    const facet = {
      ...FACET,
      chat_events: [{
        t: 24, kind: 'command', raw_type: 20, channel: 1549648, sender: 'Alpha',
        command: 28, command_name: 'attention_to_cell', target: 6,
      }],
      markers: [
        { t: 26, entity_id: 1, account_id: 1001, marker_type: 1, at: [1, 2, 3] },
        { t: 27, entity_id: 1, account_id: 1001, marker_type: 5, target_eid: 2 },
        { t: 28, entity_id: 1, account_id: 1001, marker_type: 4, target_eid: 2 },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const rows = w.findAll('[data-kind="marker"]')
    expect(rows).toHaveLength(4)
    const titles = rows.map((n) => n.text())
    expect(titles.some((x) => x.includes('marker_cell') && x.includes('cell=B3'))).toBe(true)
    expect(titles.some((x) => x.includes('marker_moving') && x.includes('who=Alpha · T-62A'))).toBe(true)
    expect(titles.some((x) => x.includes('marker_retreat') && x.includes('who=Alpha · T-62A') && x.includes('target=Bravo · E 100'))).toBe(true)
    expect(titles.some((x) => x.includes('marker_attack') && x.includes('target=Bravo · E 100'))).toBe(true)
    // 未知 markerType 显示原始类型号（不伪造语义）
    const facetUnknown = {
      ...FACET,
      markers: [{ t: 29, entity_id: 1, account_id: 1001, marker_type: 6 }],
    }
    const w2 = mountPane({ session: makeSession(facetUnknown) })
    await flushPromises()
    expect(w2.find('[data-kind="marker"]').text()).toContain('marker_unknown')
    expect(w2.find('[data-kind="marker"]').text()).toContain('type=6')
  })

  it('指令目标按 eid 联表，不再显示 #数字', async () => {
    const facet = {
      ...FACET,
      chat_events: [{
        t: 22, kind: 'command', raw_type: 20, channel: 1549648, sender: 'Alpha',
        command: 29, command_name: 'attack_enemy', target: 2, // 车辆 eid（真实语料形状）
      }],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const text = w.find('[data-kind="command"]').text()
    expect(text).toContain('who=Alpha · T-62A')
    expect(text).toContain('target=Bravo · E 100')
    expect(text).not.toContain('#2')
  })

  it('车型名取 tank_cache，占位 tank_<id> 不上 UI', async () => {
    fetchTankEncyclopedia.mockResolvedValue({ 100: { name: 'T-62A' }, 200: { name: 'E 100' } })
    const facet = {
      ...FACET,
      vehicles: [
        { eid: 1, nickname: 'Alpha', tank_id: 100, tank_name: 'tank_100', team: 1 },
        { eid: 2, nickname: 'Bravo', tank_id: 200, tank_name: 'tank_200', team: 2 },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const text = w.find('[data-kind="shot"]').text()
    expect(text).toContain('Alpha · T-62A')
    expect(text).toContain('Bravo · E 100')
    expect(text).not.toContain('tank_100')
    expect(text).not.toContain('tank_200')
  })

  it('通知主体按名册解析到玩家/坦克（code 保持原始）', async () => {
    const facet = { ...FACET, notifications: [{ t: 21, subject: 2, code: 11515 }] }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const text = w.find('[data-kind="notice"]').text()
    expect(text).toContain('notice_label_actor')
    expect(text).toContain('who=Bravo · E 100')
    expect(text).toContain('code=11515')
  })

  it('未知在场动作显示中性提示 + 原始码（不冒充进入频道）', async () => {
    const facet = {
      ...FACET,
      chat_events: [{ t: 10, kind: 'other', raw_type: 22, channel: 1549648, sender: 'Alpha' }],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const row = w.find('[data-kind="presence"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('raw=22')
    expect(row.text()).not.toContain('presence_join')
  })

  it('搭载配置富化覆盖全部可导航行（下一发也有证据，评审 4597024398）', async () => {
    const navigate = vi.fn()
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 10005, target_tank_id: 10017 },
        { time_s: 45, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 10005, target_tank_id: 10017 },
      ],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 10005, target_tank_id: 10017 },
        { time_s: 45, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 10005, target_tank_id: 10017 },
      ],
    })
    shotViewerQuery.mockResolvedValue({ shooter: '10005', shot: '0' })
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    // 交接数组包含全部两行（都带 config 证据），而非只有选中行
    expect(handoff.annotateMountedConfigs.mock.calls[0][0]).toHaveLength(2)
  })

  it('有界等待到期时，已返回车型的配置证据保留在交接快照（评审 4597024398 回归）', async () => {
    const navigate = vi.fn()
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 100, target_tank_id: 200 },
        { time_s: 45, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0], shooter_tank_id: 100, target_tank_id: 200 },
        { time_s: 60, shooter_eid: 1, target_eid: 3, ball_a: [0, 0, 0], shooter_tank_id: 100, target_tank_id: 300 },
      ],
    })
    shotViewerQuery.mockResolvedValue({ shooter: '100', shot: '0' })
    const facet = {
      ...FACET,
      vehicles: [
        { eid: 1, nickname: 'Alpha', tank_id: 100, turret_local: 5, gun_local: 'gun_a' },
        { eid: 2, nickname: 'Bravo', tank_id: 200, turret_local: 6, gun_local: 'gun_b' },
        { eid: 3, nickname: 'Charlie', tank_id: 300, turret_local: 7, gun_local: 'gun_c' },
      ],
    }
    assetProvider.json.mockImplementation((url) => {
      if (url === '/tank/100.json') return Promise.resolve({ configs: [{ turret_local: 5, gun_local: 'gun_a' }] })
      if (url === '/tank/200.json') return Promise.resolve({ configs: [{ turret_local: 6, gun_local: 'gun_b' }] })
      // 无关车型永久挂起：不得抹掉 100/200 已就绪的证据
      if (url === '/tank/300.json') return new Promise(() => {})
      return Promise.resolve(null)
    })
    const w = mountPane({ session: makeSession(facet), navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await new Promise((r) => setTimeout(r, 1600))
    await flushPromises()
    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    const rows = storeShotsForViewer.mock.calls[0][0]
    expect(rows).toHaveLength(3)
    // 逐车增量提交：首发/下一发拿到 100→200 的实际配置，300 只影响它自己的目标字段
    expect([rows[0].shooter_config_idx, rows[0].target_config_idx]).toEqual([0, 0])
    expect([rows[1].shooter_config_idx, rows[1].target_config_idx]).toEqual([0, 0])
    expect(rows[2].shooter_config_idx).toBe(0)
    expect(rows[2].target_config_idx).toBeUndefined()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('join/leave/channel_created 保留动作区别（评审 4595675895）', async () => {
    const facet = {
      ...FACET,
      chat_events: [
        { t: 10, kind: 'join', raw_type: 0, channel: 1549648, sender: 'Alpha' },
        { t: 11, kind: 'leave', raw_type: 2, channel: 1549648, sender: 'Alpha' },
        { t: 12, kind: 'channel_created', raw_type: 7, channel: 1549648, sender: 'Alpha' },
      ],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const titles = w.findAll('[data-kind="presence"]').map((n) => n.text())
    expect(titles.some((x) => x.includes('presence_join'))).toBe(true)
    expect(titles.some((x) => x.includes('presence_leave'))).toBe(true)
    expect(titles.some((x) => x.includes('presence_channel_created'))).toBe(true)
  })

  it('0x2b 另域文本与 0x2f 正文都保留（不做跨域去重，评审 4596693945）', async () => {
    const facet = {
      ...FACET,
      chat_events: [{ t: 10, kind: 'message', raw_type: 1, channel: 11, sender: 'A', text: '?' }],
      chat_messages: [{ t: 10.2, tag: 1, seq: 22, text: '?' }],
    }
    const w = mountPane({ session: makeSession(facet) })
    await flushPromises()
    const chats = w.findAll('[data-kind="chat"]')
    expect(chats).toHaveLength(2) // 两条来源明确的原始记录都保留
  })

  it('无关车型慢请求不阻塞所选射击的导航（评审 4595675888）', async () => {
    const navigate = vi.fn()
    let resolveQuery
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }] })
    shotViewerQuery.mockImplementation(() => new Promise((res) => { resolveQuery = res }))
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    // 不等待 annotate 的有界 race（1500ms）自然结束——这里只验证导航在超时后发生
    await new Promise((r) => setTimeout(r, 1700))
    await flushPromises()
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).toHaveBeenCalled()
  })

  it('switching file reloads and cleared stale facet (review P1)', async () => {
    const sessions = []
    const makeSession2 = (facet) => {
      let resolveFn
      const p = new Promise((res) => { resolveFn = res })
      sessions.push({ facet, resolveFn })
      return { loadScene: vi.fn(() => p) }
    }
    const sessionA = makeSession2(FACET)
    const w = mountPane({ session: sessionA })
    // A 尚未返回时切到 B：旧结果必须被丢弃
    const fileB = new File(['y'], 'b.wotbreplay')
    sessions[0].resolveFn(FACET)
    await flushPromises()
    expect(w.findAll('.es-row').length).toBe(3)
    const sessionB = makeSession2({ shots: [{ t_fire: 5, shooter_eid: 9 }] })
    await w.setProps({ file: fileB, playbackSession: sessionB })
    await flushPromises()
    // 切文件即清空（不得继续展示 A 的事件）
    expect(w.findAll('.es-row').length).toBe(0)
    expect(sessionB.loadScene).toHaveBeenCalledTimes(1)
    sessions[1].resolveFn({ shots: [{ t_fire: 5, shooter_eid: 9 }] })
    await flushPromises()
    expect(w.findAll('.es-row').length).toBe(1)
  })

  it('hand-off enriches shots with roster and passes derived battle clock', async () => {
    const navigate = vi.fn()
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }],
    })
    shotViewerQuery.mockResolvedValue({ shooter: '10005', shot: '0' })
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    expect(handoff.buildPitchLimits).toHaveBeenCalledTimes(1)
    expect(handoff.annotateMountedConfigs).toHaveBeenCalledTimes(1)
    // 俯仰锚定表作为第二参数传入解析（与射击分析入口同一实现，不再永久降级）
    expect(parseAgentShotsFromBytes.mock.calls[0][1]).toEqual({ Alpha: { dep: 15, ele: 7 } })
    expect(enrichShotsFromRoster).toHaveBeenCalledTimes(1)
    // 开战原点来自 playback facet 的 resolveReplayClock（不再是固定 0）
    expect(storeShotsForViewer.mock.calls[0][1]).toEqual({ battleStartRaw: 14 })
    expect(navigate).toHaveBeenCalled()
  })

  it('hand-off aborts when the pane went inactive during the async query (review P2)', async () => {
    const navigate = vi.fn()
    let resolveQuery
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }],
    })
    shotViewerQuery.mockImplementation(() => new Promise((res) => { resolveQuery = res }))
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 1600))
    await flushPromises()
    expect(shotViewerQuery).toHaveBeenCalledTimes(1)
    // 用户离开事件流（切到其他能力）：在途交接作废
    await w.setProps({ active: false })
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('hand-off aborts when the file changed during the async query (review P2)', async () => {
    const navigate = vi.fn()
    let resolveQuery
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ time_s: 30, shooter_eid: 1, target_eid: 2, ball_a: [0, 0, 0] }],
    })
    shotViewerQuery.mockImplementation(() => new Promise((res) => { resolveQuery = res }))
    const w = mountPane({ navigate })
    await flushPromises()
    await w.find('[data-kind="shot"]').trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 1600))
    await flushPromises()
    expect(shotViewerQuery).toHaveBeenCalledTimes(1)
    // query 未返回时切到 B 场：旧请求不得把用户带进 A 的装甲检视
    await w.setProps({ file: new File(['y'], 'b.wotbreplay'), playbackSession: makeSession() })
    await flushPromises()
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })
})
