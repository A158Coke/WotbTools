// @vitest-environment happy-dom
/**
 * 射击分析面板状态链回归：
 * - author_path="error" 且他人宽松路径 0 发 → 警示必须可见，且与空态并存——
 *   绝不允许只显示"没有射击"把作者链失败伪装成正常空结果（契约 v0.1.9 评审 blocker）；
 * - 射击者筛选三态（未知阵营绝不并入我方）；
 * - Master–Detail：一行一 Shot、选中出检视、窄容器整屏 + 焦点管理；
 * - 术语：界面不得出现内部 id（eid）、WebAssembly / Agent 等实现层词汇。
 */

import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

const i18n = vi.hoisted(() => ({ t: vi.fn((key) => key) }))
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  return { useConnectivity: () => ({ connectivity: connectivityState.state, isSettled: () => true, whenSettled: () => Promise.resolve() }) }
})

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: i18n.t }) }))

const parseAgentShotsFromBytes = vi.hoisted(() => vi.fn())
const parseAgentPlaybackFromBytes = vi.hoisted(() => vi.fn())
vi.mock('../api/agent-replay-facets.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    parseAgentShotsFromBytes,
    parseAgentPlaybackFromBytes,
  }
})

vi.mock('../scene/agentData.js', () => ({
  tankImageUrl: (id) => `img:${id}`,
  storeShotsForViewer: vi.fn(),
  fetchTankData: vi.fn(async () => ({ configs: [] })),
  fetchLocalShotTankData: async () => ({ configs: [] }),
}))

/** happy-dom 没有 ResizeObserver：记录回调以便按容器宽度驱动 Master–Detail 分档 */
const observers = []
class ResizeObserverStub {
  constructor(cb) { this.cb = cb; observers.push(this) }
  observe() {}
  disconnect() {}
  emit(width) { this.cb([{ contentRect: { width } }]) }
}
globalThis.ResizeObserver = ResizeObserverStub

import ReplayShotsPane from './ReplayShotsPane.vue'
import { fetchTankData, storeShotsForViewer } from '../scene/agentData.js'

function mkFile(name = 'cn.wotbreplay') {
  return new File([new Uint8Array([1, 2, 3, 4])], name)
}

const baseOthers = { total_launches: 0, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 }

async function mountPane(props = {}) {
  const wrapper = mount(ReplayShotsPane, {
    props: { file: mkFile(), active: true, ...props },
    global: { mocks: { $t: i18n.t } },
    attachTo: document.body,
  })
  // 只有"应当解码"的场景才等终态（无文件 / 被阻断 / 未激活时不发解码）
  const shouldDecode = props.active !== false && !props.blockedReason && props.file !== null
  if (shouldDecode) {
    await vi.waitFor(() => {
      if (!wrapper.text().includes('agentShots.no_shots') && wrapper.findAll('.shot-row').length === 0) {
        throw new Error('still parsing')
      }
    }, { timeout: 3000 })
  }
  await flushPromises()
  return wrapper
}

beforeEach(() => {
    connectivityState.state.value = 'online'
  observers.length = 0
  parseAgentShotsFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [] })
  storeShotsForViewer.mockClear()
  fetchTankData.mockClear()
})

describe('ReplayShotsPane unmount authorization boundary', () => {
  it('unmount during file read never starts playback or shot parsing', async () => {
    let finishRead
    const file = { name: 'pending.wotbreplay', arrayBuffer: () => new Promise((resolve) => { finishRead = resolve }) }
    const wrapper = mount(ReplayShotsPane, {
      props: { file, active: true },
      global: { mocks: { $t: i18n.t } },
    })
    wrapper.unmount()
    finishRead(new ArrayBuffer(4))
    await flushPromises()
    expect(parseAgentPlaybackFromBytes).not.toHaveBeenCalled()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
  })

  it('unmount during playback parsing never starts pitch assets or shot parsing', async () => {
    let finishPlayback
    parseAgentPlaybackFromBytes.mockImplementationOnce(() => new Promise((resolve) => { finishPlayback = resolve }))
    const wrapper = mount(ReplayShotsPane, {
      props: { file: { name: 'pending.wotbreplay', arrayBuffer: async () => new ArrayBuffer(4) }, active: true },
      global: { mocks: { $t: i18n.t } },
    })
    await flushPromises()
    expect(parseAgentPlaybackFromBytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    finishPlayback({ vehicles: [{ eid: 1, nickname: 'author', tank_id: 1 }] })
    await flushPromises()
    expect(fetchTankData).not.toHaveBeenCalled()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
  })
})
afterEach(() => { document.body.innerHTML = '' })

describe('ReplayShotsPane author_path fail-visible（评审 blocker 回归）', () => {
  it('author_path=error 且 shots=[] → 警示可见并与空态并存（不得只显示 no_shots）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [],
      author_path: 'error',
      author_error: 'shot #1: 受击者实体 0x123 不在 type=5 名册中',
      author_eid: 7,
      others: baseOthers,
    })
    const wrapper = await mountPane()
    const warn = wrapper.get('[data-testid="shots-author-error"]')
    expect(warn.text()).toContain('agentShots.author_path_error')
    expect(warn.text()).toContain('type=5 名册')
    // 与空态并存：no_shots 仍渲染（用户知道确实 0 发），但警示是第一眼信息
    expect(wrapper.get('[data-testid="shots-no-shots"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('author_path=ok → 无警示', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [], author_path: 'ok', author_eid: 7,
      others: { ...baseOthers, total_launches: 12 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-author-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('author_path=error 但他人路径有 shots → 警示与列表并存', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 100, target_name: '林肝美', is_kill: false,
        shooter_eid: 200, target_eid: 101, hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'error',
      author_error: 'boom',
      author_eid: 7,
      others: { ...baseOthers, total_launches: 1 },
    })
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shots-author-error"]').exists()).toBe(true)
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    // 命中在案（target_eid）但结果未知（255）→ "命中·结果未知"，不得伪装成未击穿
    expect(wrapper.text()).toContain('agentShots.res_hit_unknown')
    expect(wrapper.text()).not.toContain('agentShots.res_miss')
    expect(wrapper.text()).not.toContain('agentShots.res_nopen')
    wrapper.unmount()
  })
})

describe('ReplayShotsPane 数据与筛选', () => {
  it('上游已聚合的单个 Shot 只渲染一行，不按 hit_flags 展开', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, shot_id: 45509301, time_s: 110.26, damage: 0,
        target_name: 'target', target_eid: 200, is_kill: false,
        shooter_eid: 100, shooter_name: 'author', is_author: true,
        hit_flags: 0x28, game_hit_result: 0, shell_id: 79242,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('1')
    expect(wrapper.text()).toContain('agentShots.res_ric')
    // 时间走 canonical helper（mm:ss，无十分位）：110.26 → 01:50
    expect(wrapper.text()).toContain('01:50')
    expect(wrapper.text()).not.toContain('01:50.')
    wrapper.unmount()
  })

  it('射击者分组三态：未知阵营绝不并入我方（评审 blocker 回归）', async () => {
    parseAgentPlaybackFromBytes.mockResolvedValue({
      vehicles: [
        { eid: 100, nickname: '名雅山庄', team: 1, tank_id: 30085, is_author: true },
        { eid: 200, nickname: '林肝美', team: 2, tank_id: 40085 },
        { eid: 300, nickname: '观察者', team: 0, tank_id: 0 },
      ],
    })
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 1, time_s: 5, damage: 100, target_name: 'x', is_kill: false, shooter_eid: 100, shooter_name: '名雅山庄', target_eid: 200, hit_flags: 16, game_hit_result: 3, shell_id: 0, shooter_team: 'ally' },
        { index: 2, time_s: 6, damage: 100, target_name: 'y', is_kill: false, shooter_eid: 200, shooter_name: '林肝美', target_eid: 100, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
        { index: 3, time_s: 7, damage: 0, target_name: '', is_kill: false, shooter_eid: 300, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: undefined },
      ],
      author_path: 'ok', author_eid: 100, others: { ...baseOthers, total_launches: 3 },
    })
    const wrapper = await mountPane()
    const labels = wrapper.findAll('optgroup').map(g => g.attributes('label'))
    expect(labels).toEqual(['agentShots.allies', 'agentShots.enemies', 'agentShots.unknown_side'])
    const options = wrapper.findAll('option').map(o => o.text())
    expect(options.some(t => t.startsWith('名雅山庄'))).toBe(true)
    expect(options.some(t => t.startsWith('林肝美'))).toBe(true)
    expect(options.some(t => t.startsWith('观察者'))).toBe(true)
    wrapper.unmount()
  })

  it('昵称不可解析时不暴露内部 id，显示「未知玩家」', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 5, damage: 0, target_name: '', is_kill: false,
        shooter_eid: 300, target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.text()).toContain('agentShots.unknown_player')
    expect(wrapper.text()).not.toContain('eid:')
    expect(wrapper.text()).not.toContain('300')
    wrapper.unmount()
  })

  it('筛选某位射击者后总览随筛选联动', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 1, time_s: 5, damage: 100, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: 200, hit_flags: 16, game_hit_result: 3, shell_id: 0, shooter_team: 'ally' },
        { index: 2, time_s: 6, damage: 0, is_kill: false, shooter_eid: 200, shooter_name: 'B', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
      ],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('2')
    // 选项值用列表序号，DOM 里不出现内部 id
    expect(wrapper.findAll('#shots-shooter-select option').map(o => o.attributes('value'))).toEqual(['all', '0', '1'])
    await wrapper.get('#shots-shooter-select').setValue('0')
    expect(wrapper.get('[data-stat="shots"] .stat-value').text()).toBe('1')
    expect(wrapper.findAll('.shot-row')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('ReplayShotsPane Master–Detail 与可访问性', () => {
  const oneShot = {
    shots: [{
      index: 7, time_s: 32.4, damage: 524, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 1,
      target_name: 'Maus', target_eid: 200, target_tank_id: 2,
      hit_flags: 16, game_hit_result: 3, shell_id: 79242,
      shell_kind: 'APCR', shell: { type: 'APCR', penetration: 245 },
      ball_a: [0, 0, 0], ball_b: [0, 0, 300],
    }],
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  it('点一行 → 出检视面板（弹种 / 穿深 / 命中 / 弹道长度），关闭后回到该行', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    const inspector = wrapper.get('[data-testid="shot-inspector"]')
    expect(inspector.text()).toContain('agentShots.inspector_title')
    expect(inspector.text()).toContain('APCR')
    expect(inspector.text()).toContain('245 mm')
    expect(inspector.text()).toContain('agentShots.impact_hit')
    expect(inspector.text()).toContain('300.0 m')
    await wrapper.get('[data-testid="shot-detail-close"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('容器 < 600px → 检视面板整屏，打开时焦点进入面板，Esc 关闭', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(420)
    await nextTick()
    expect(wrapper.get('.shots-split').classes()).toContain('is-compact')
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="shot-inspector"]').element)
    await wrapper.get('[data-testid="replay-shots-pane"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('容器 ≥ 900px → 常驻右栏（两列）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(1000)
    await nextTick()
    expect(wrapper.get('.shots-split').classes()).toContain('is-expanded')
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.shots-split').classes()).toContain('has-detail')
    wrapper.unmount()
  })

  it('600–899px → 推开式（列表让位，不整屏）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const wrapper = await mountPane()
    observers.at(-1).emit(760)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    const split = wrapper.get('.shots-split')
    expect(split.classes()).toContain('is-medium')
    expect(split.classes()).not.toContain('is-compact')
    wrapper.unmount()
  })
})

/**
 * Master–Detail 的导航（design-language §9）：compact 全屏详情要有上一发 / 下一发，
 * 键盘与滑动等价；**导航只在当前筛选结果内移动**（不是原始 shots），首尾不循环。
 */
describe('ReplayShotsPane compact 上一发 / 下一发', () => {
  const threeShots = {
    shots: [2, 7, 11].map((index) => ({
      index, time_s: index * 5, damage: 100, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 1,
      target_name: 'Maus', target_eid: 200, target_tank_id: 2,
      hit_flags: 16, game_hit_result: 3, shell_id: 79242,
      shell_kind: 'APCR', shell: { type: 'APCR', penetration: 245 },
    })),
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  async function mountCompact() {
    const wrapper = await mountPane()
    observers.at(-1).emit(420)
    await nextTick()
    return wrapper
  }

  /** compact 详情里的真实滑动：pointerdown → pointerup，水平位移压过纵向位移 */
  async function swipe(wrapper, dx, dy = 0) {
    const detail = wrapper.get('[data-testid="shot-inspector"]')
    await detail.trigger('pointerdown', { clientX: 200, clientY: 300 })
    await detail.trigger('pointerup', { clientX: 200 + dx, clientY: 300 + dy })
    await flushPromises()
  }

  it('按钮在筛选结果内前进 / 后退：7 → next 11 → prev 7', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountCompact()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="shot-next"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-11')

    await wrapper.get('[data-testid="shot-prev"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    wrapper.unmount()
  })

  it('左滑 → 下一发，右滑 → 上一发', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountCompact()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()

    await swipe(wrapper, -80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-11')

    await swipe(wrapper, 80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    wrapper.unmount()
  })

  it('首尾不循环：第一发没有上一发、最后一发没有下一发（按钮同时 disabled）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountCompact()

    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-prev"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="shot-next"]').attributes('disabled')).toBeUndefined()
    // 边界上仍按键 / 滑动：停在原地，不回绕到最后一发
    await swipe(wrapper, 80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-2')

    await wrapper.get('[data-testid="shot-row-11"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-next"]').attributes('disabled')).toBeDefined()
    await swipe(wrapper, -80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-11')
    wrapper.unmount()
  })

  it('导航只走 filteredShots：筛选后 [2,7,11] 里 7 的下一发是 11（不是 8）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 2, time_s: 10, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
        { index: 5, time_s: 25, damage: 0, is_kill: false, shooter_eid: 200, shooter_name: 'B', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
        { index: 7, time_s: 35, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
        { index: 11, time_s: 55, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
      ],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountCompact()
    // 只留射击者 A：可见列表变成 [2, 7, 11]
    await wrapper.get('#shots-shooter-select').setValue('0')
    await flushPromises()
    expect(wrapper.findAll('.shot-row').map(r => r.attributes('data-testid')))
      .toEqual(['shot-row-2', 'shot-row-7', 'shot-row-11'])

    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="shot-next"]').trigger('click')
    await flushPromises()
    // 5 被筛掉了，下一发必须是 11 —— 若按原始 shots 走会落到 8/5
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-11')

    await swipe(wrapper, 80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    await swipe(wrapper, 80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-2')
    wrapper.unmount()
  })

  it('键盘方向键与按钮等价；焦点在 select 上时不劫持', async () => {
    // 需要 ≥2 位射击者，筛选下拉才会渲染（这正是"不劫持"的验证对象）
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 2, time_s: 10, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
        { index: 5, time_s: 25, damage: 0, is_kill: false, shooter_eid: 200, shooter_name: 'B', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
        { index: 7, time_s: 35, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
        { index: 11, time_s: 55, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
      ],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountCompact()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    const pane = wrapper.get('[data-testid="replay-shots-pane"]')

    await pane.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-11')

    await pane.trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')

    // 表单控件聚焦时不劫持方向键（原生 select 行为优先）
    const select = wrapper.get('#shots-shooter-select')
    await select.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    wrapper.unmount()
  })

  it('纵向滑动不触发切换（避免与滚动打架）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountCompact()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()

    // 位移不小，但纵向明显压过横向 → 视为滚动，不切换
    await swipe(wrapper, 60, 120)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')

    // 横向位移不足阈值 → 也不切换
    await swipe(wrapper, 20)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    wrapper.unmount()
  })

  it('筛选把当前这一发筛掉时关闭详情（不留"列表里没有、详情还开着"的状态）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [
        { index: 2, time_s: 10, damage: 0, is_kill: false, shooter_eid: 100, shooter_name: 'A', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'ally' },
        { index: 5, time_s: 25, damage: 0, is_kill: false, shooter_eid: 200, shooter_name: 'B', target_eid: null, hit_flags: 0, game_hit_result: 255, shell_id: 0, shooter_team: 'enemy' },
      ],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountCompact()
    // 选中属于 B（下拉里第 1 项）的那一发，再把筛选切到 A
    await wrapper.get('[data-testid="shot-row-5"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)

    await wrapper.get('#shots-shooter-select').setValue('0')
    await flushPromises()
    expect(wrapper.findAll('.shot-row').map(r => r.attributes('data-testid'))).toEqual(['shot-row-2'])
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('expanded 档不响应滑动（详情是常驻右栏，不是全屏 sheet）', async () => {    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountPane()
    observers.at(-1).emit(1000)
    await nextTick()
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()

    await swipe(wrapper, -80)
    expect(wrapper.get('.shot-row.is-selected').attributes('data-testid')).toBe('shot-row-7')
    wrapper.unmount()
  })

  it('关闭详情后焦点回到触发行（导航过后仍回到最初那一行）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(threeShots)
    const wrapper = await mountCompact()
    const row = wrapper.get('[data-testid="shot-row-7"]')
    await row.trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="shot-next"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="shot-detail-close"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(false)
    expect(document.activeElement).toBe(row.element)
    wrapper.unmount()
  })

  it('时间显示走 canonical mm:ss（无十分位）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 1, time_s: 151.4, damage: 0, is_kill: false,
        shooter_eid: 100, shooter_name: 'A', target_eid: null,
        hit_flags: 0, game_hit_result: 255, shell_id: 0,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    expect(wrapper.get('.shot-time').text()).toBe('02:31')
    await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-inspector"]').text()).toContain('02:31')
    wrapper.unmount()
  })
})

describe('ReplayShotsPane 文件与激活契约', () => {
  it('没有文件 → 提示先选回放，不解码', async () => {
    const wrapper = await mountPane({ file: null })
    expect(wrapper.get('[data-testid="shots-empty"]').text()).toBe('workspace.capability_upload_hint')
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('多文件未选场次 → 显示工作台给的阻断原因，不解码', async () => {
    const wrapper = await mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(wrapper.get('[data-testid="shots-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('未激活时不解码；首次激活才解码一次（切走再切回不重新解码）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({ shots: [], author_path: 'ok', author_eid: 1, others: baseOthers })
    const wrapper = await mountPane({ active: false })
    await flushPromises()
    expect(parseAgentShotsFromBytes).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(parseAgentShotsFromBytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})

/**
 * 交接护栏：命中弹的「在装甲查看器里打开」把整份射击数据交出去（本机通道），
 * 并把装甲查看器要读的场景参数**一个不少**地交给 router owner——参数由目的地组件消费，
 * 不能在这里被裁掉（导航层的视图私有 key 清理只作用于"离开场景"方向，见 navigation.test.js）。
 */
describe('ReplayShotsPane → 装甲查看器交接', () => {
  const hitShot = {
    shots: [{
      index: 2, time_s: 41.2, damage: 0, is_kill: false,
      shooter_eid: 100, shooter_name: 'A158', shooter_tank_id: 19969, is_author: true, shell_slot: 3,
      target_name: 'Maus', target_eid: 200, target_tank_id: 13825, target_config_idx: 1,
      hit_flags: 0x28, game_hit_result: 0, shell_id: 79242,
    }],
    author_path: 'ok', author_eid: 100, others: baseOthers,
  }

  it('命中弹：先交出射击数据，再把场景参数整个交给 router', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(hitShot)
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-2"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    await flushPromises()

    // 交接通道：整份 shots 交出去（查看器按 shot 序号找这一发）
    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    expect(storeShotsForViewer.mock.calls[0][0]).toHaveLength(1)
    // 目的地：装甲查看器要读的键一个不少（view / tank / shooter / shot / shell / config / world / heatmap）
    expect(navigate).toHaveBeenCalledWith({
      query: {
        view: 'agent-armor', tank: '13825', shooter: '19969', shot: '2',
        shell: '3', config: '1', world: '1', heatmap: '1',
      },
    })
    wrapper.unmount()
  })

  it('未命中弹（无目标实体）不给入口，也不交接数据', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{ ...hitShot.shots[0], index: 3, target_eid: null, target_name: '', target_tank_id: 0 }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-3"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="shot-open-viewer"]').exists()).toBe(false)
    expect(storeShotsForViewer).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

it('bundled shooting inputs preserve config identity and all global shells without remote fallback', async () => {
  const { default: snapshot } = await import('../../../common/shot-tank-data.json')
  const { default: shellKinds } = await import('../scene/shellKinds.json')
  const { fetchLocalShotTankData } = await vi.importActual('../scene/agentData.js')
  const noNetwork = vi.fn(() => { throw new Error('shooting inspection attempted network') })
  vi.stubGlobal('fetch', noNetwork)
  try {
    const [tankId, expected] = Object.entries(snapshot.tanks).find(([, tank]) => tank.configs.some(config => config.pitch_limits))
    expect(await fetchLocalShotTankData(tankId)).toEqual(expected)
    expect(expected.configs.some(config => Number.isFinite(config.pitch_limits?.max))).toBe(true)
    for (const tank of Object.values(snapshot.tanks)) {
      for (const config of tank.configs) {
        for (const shellId of config.shell_global_ids || []) expect(shellKinds[String(shellId)], `global shell ${shellId}`).toBeDefined()
      }
    }
    await expect(fetchLocalShotTankData('not-a-tank')).rejects.toThrow('Local shooting inputs unavailable')
    expect(noNetwork).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
