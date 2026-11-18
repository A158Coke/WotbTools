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
import { nextTick, ref } from 'vue'

const i18n = vi.hoisted(() => ({ t: vi.fn((key) => key) }))
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
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

vi.mock('../scene/assetProvider.js', () => ({
  assetProvider: {
    configured: () => false,
    json: vi.fn(async () => { throw new Error('asset source unconfigured') }),
    bytes: async () => { throw new Error('asset source unconfigured') },
  },
}))

vi.mock('../scene/agentData.js', () => ({
  tankImageUrl: (id) => `img:${id}`,
  storeShotsForViewer: vi.fn(),
  shotViewerQuery: vi.fn(),
  fetchTankData: vi.fn(async () => ({ configs: [] })),
  fetchShotTankData: vi.fn(async () => ({ configs: [] })),
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

vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))

import { ONBOARDING_KEY } from '../shared/onboarding.js'
import ReplayShotsPane from './ReplayShotsPane.vue'
import { assetProvider } from '../scene/assetProvider.js'
import { fetchShotTankData, fetchTankData, storeShotsForViewer, shotViewerQuery } from '../scene/agentData.js'

function mkFile(name = 'cn.wotbreplay') {
  return new File([new Uint8Array([1, 2, 3, 4])], name)
}

const baseOthers = { total_launches: 0, skipped_no_endpoint: 0, skipped_no_target_state: 0, muzzle_fallback: 0 }

/** 新手教程表面（ONBOARDING_KEY）：compact 检视面板只在教程引导中出现，测试用它模拟引导态 */
const guideSurfaces = {}
const guideActive = ref(false)
const guideHost = { guideActive, registerSurface: (id, surface) => { guideSurfaces[id] = surface } }
function guideCompactInspector() { guideActive.value = true; guideSurfaces.shots?.setGuideInset(120) }
afterEach(() => { guideActive.value = false })

async function mountPane(props = {}) {
  const wrapper = mount(ReplayShotsPane, {
    props: { file: mkFile(), active: true, ...props },
    global: { mocks: { $t: i18n.t }, provide: { [ONBOARDING_KEY]: guideHost } },
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
  shotViewerQuery.mockReset()
  shotViewerQuery.mockImplementation(async (shot) => ({
    view: 'agent-armor', tank: String(shot.target_tank_id || shot.shooter_tank_id),
    ...(shot.shooter_tank_id ? { shooter: String(shot.shooter_tank_id) } : {}),
    shot: String(shot.index),
    ...(shot.is_author && shot.shell_slot != null ? { shell: String(shot.shell_slot) } : {}),
    ...(shot.target_config_idx != null ? { config: String(shot.target_config_idx) } : {}),
    world: '1', heatmap: '1',
  }))
  fetchTankData.mockClear()
})

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
    guideCompactInspector()
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
    await wrapper.get('#shots-shooter-select').setValue('player-0')
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
    // 显式查看全员，再选 B；本人默认不混入其他玩家。
    await wrapper.get('#shots-shooter-select').setValue('all')
    await wrapper.get('[data-testid="shot-row-5"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="shot-inspector"]').exists()).toBe(true)

    await wrapper.get('#shots-shooter-select').setValue('player-0')
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
    expect(wrapper.get('.shot-clock').text()).toBe('02:31')
    await wrapper.get('[data-testid="shot-row-1"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="shot-inspector"]').text()).toContain('02:31')
    wrapper.unmount()
  })
})
