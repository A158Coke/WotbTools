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
  annotateMountedConfigs: vi.fn(async () => {}),
}))
vi.mock('../scene/shotHandoff.ts', () => handoff)

const i18n = vi.hoisted(() => ({ t: vi.fn((key, params) => {
  if (!params || typeof params !== 'object') return key
  // 简单插值：{name} → 参数值（与 vue-i18n 同语义，够本测试断言身份文本）
  return `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})`
}) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t }) }))

import ReplayEventStreamPane from './ReplayEventStreamPane.vue'
import { parseAgentShotsFromBytes, enrichShotsFromRoster } from '../api/agent-replay-facets.js'

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

  it('emits view-3d with event time on click (seek 由工作台/3D pane 执行)', async () => {
    const w = mountPane()
    await flushPromises()
    await w.find('[data-kind="chat"]').trigger('click')
    expect(w.emitted('view-3d')).toEqual([[22]])
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
    expect(shotViewerQuery).toHaveBeenCalledTimes(1)
    // query 未返回时切到 B 场：旧请求不得把用户带进 A 的装甲检视
    await w.setProps({ file: new File(['y'], 'b.wotbreplay'), playbackSession: makeSession() })
    await flushPromises()
    resolveQuery({ shooter: '10005', shot: '0' })
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })
})
