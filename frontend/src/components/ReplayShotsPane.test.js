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
  fetchTankData: async () => ({ configs: [] }),
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
import { storeShotsForViewer } from '../scene/agentData.js'

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
  observers.length = 0
  parseAgentShotsFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockReset()
  parseAgentPlaybackFromBytes.mockResolvedValue({ vehicles: [] })
  storeShotsForViewer.mockClear()
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
    // 时间统一 mm:ss（design-language §11）
    expect(wrapper.text()).toContain('01:50.3')
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

  it('「在装甲查看器里打开」交出本地射击数据并导航（组件不碰 history）', async () => {
    parseAgentShotsFromBytes.mockResolvedValue(oneShot)
    const navigate = vi.fn()
    const wrapper = await mountPane({ navigate })
    await wrapper.get('[data-testid="shot-row-7"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="shot-open-viewer"]').trigger('click')
    await flushPromises()
    expect(storeShotsForViewer).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
    const { query } = navigate.mock.calls[0][0]
    expect(query.view).toBe('agent-armor')
    expect(query.tank).toBe('2')
    expect(query.shot).toBe('7')
    expect(query.world).toBe('1')
    wrapper.unmount()
  })

  it('脱靶弹不提供 3D 复现入口', async () => {
    parseAgentShotsFromBytes.mockResolvedValue({
      shots: [{
        index: 3, time_s: 12, damage: 0, is_kill: false,
        shooter_eid: 100, shooter_name: 'A158', target_eid: null,
        hit_flags: 0, game_hit_result: 255, shell_id: 79242,
      }],
      author_path: 'ok', author_eid: 100, others: baseOthers,
    })
    const wrapper = await mountPane()
    await wrapper.get('[data-testid="shot-row-3"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('agentShots.impact_miss')
    expect(wrapper.find('[data-testid="shot-open-viewer"]').exists()).toBe(false)
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
