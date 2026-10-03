// @vitest-environment happy-dom
/**
 * 3D 回放面板（Replay3DPane）契约：
 * - WebGL 预检（不支持时不初始化场景，整块换说明）；
 * - 文件由工作台派生（面板自己不选文件）：先停在**待开播**（选画质），按「开始」才解析；
 * - 换文件先撤下上一场（内核 reset），不把旧场景留在待开播面板后面；
 * - `active` 闸门：切走停帧但不销毁会话、键盘不再被劫持；切回不重新解析；
 * - 解析失败可重试同一份文件（不必再选一次）；
 * - 顶栏双方血量 / 比分按**阵营视角**字段渲染（friendly_team 映射在场景层做）；
 * - HUD 阵营色走语义 token（阵容 / 胜负横幅不再写死红绿）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import Replay3DPane from './Replay3DPane.vue'

const playback = vi.hoisted(() => ({ api: null, init: null, apis: [] }))
/**
 * 模拟 `playbackScene.initPlayback` 的**真实契约**：加载状态与就绪状态由场景层唯一持有
 * （见 frontend/src/scene/playbackScene.js 的 loadData / teardownSession / reset）。
 * 组件层不再镜像这些状态，所以 mock 必须自己承担，否则测试会验证一个不存在的 owner。
 */
vi.mock('../scene/playbackScene.js', () => {
  playback.init = vi.fn((container, store) => {
    const api = {
      store,
      loadData: vi.fn(async () => {
        // 真实契约：新会话被接受即 loading=true / hasData=false，完成后反向翻转
        store.hasData = false
        store.loading = true
        store.loading = false
        store.hasData = true
      }),
      destroy: vi.fn(() => {
        // 会话终止 = 不再有可用回放数据（与生产 teardownSession 一致）
        store.hasData = false
        store.loading = false
      }),
      reset: vi.fn(() => {
        // 撤下当前回放（工作台清空 / 换选）：回到「无数据」等待态
        store.hasData = false
        store.loading = false
        store.assetStage = false
        store.err = ''
      }),
      setPlaying: vi.fn(),
      seekBy: vi.fn(),
      setSpeed: vi.fn(),
      seekTime: vi.fn(),
      setCam: vi.fn(),
      setFollow: vi.fn(),
      setGlb: vi.fn(),
      setLabels: vi.fn(),
      setQuality: vi.fn(),
      setPaused: vi.fn(),
    }
    playback.api = api
    playback.apis.push(api)
    return api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' }, mid: { label: 'Mid' }, high: { label: 'High' } } }
})
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { usePointer: () => ({ coarse: computed(() => false) }) }
})
// 唯一 reactive 主题源：给 HUD 阵营色一个可依赖的 profile ref
vi.mock('../composables/useUiProfile.js', async () => {
  const { ref } = await import('vue')
  return { uiProfile: ref('showcase'), useUiProfile: () => ({ uiProfile: ref('showcase') }) }
})
const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

/** WebGL 模拟：'webgl2' | 'none' */
function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    return level === 'webgl2' && name === 'webgl2' ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

const mkFile = (name) => new File(['x'], name)

/** props 变化后的 flush：watcher 是 post-flush（要等模板刷新出 stage 节点） */
async function flush() {
  await nextTick()
  await nextTick()
}

/** 待开播 → 按「开始」：解析与资产加载都发生在这一步之后（画质先定型） */
async function start(wrapper) {
  await wrapper.get('[data-test="replay3d-start"]').trigger('click')
  await flush()
}

function mountPane(props = {}) {
  return mount(Replay3DPane, {
    props: { file: mkFile('battle.wotbreplay'), active: true, ...props },
    global: { mocks: { $t: translate } },
  })
}

beforeEach(() => {
  playback.api = null
  playback.apis.length = 0
  playback.init?.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Replay3DPane', () => {
  it('不支持 WebGL：不初始化场景，显示说明', () => {
    mockWebGL('none')
    const wrapper = mountPane()
    expect(playback.init).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="scene3d-unsupported"]').text()).toContain('scene3d.webgl_unavailable')
    wrapper.unmount()
  })

  it('没有文件 / 被工作台阻断时不初始化场景，也不自己开文件选择器', () => {
    mockWebGL('webgl2')
    const empty = mountPane({ file: null })
    expect(playback.init).not.toHaveBeenCalled()
    expect(empty.get('[data-testid="replay3d-empty"]').text()).toBe('agentReplay.no_file')
    expect(empty.find('input[type="file"]').exists()).toBe(false)
    empty.unmount()

    const blocked = mountPane({ blockedReason: 'workspace.single_replay_required' })
    expect(blocked.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    blocked.unmount()
  })

  it('有文件先停在待开播；按开始才用工作台派生文件加载一次；同一文件不重复解析', async () => {
    mockWebGL('webgl2')
    const file = mkFile('battle.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(1)
    // 待开播：画质尚未定型，所以既不解析也不拉资产
    expect(playback.api.loadData).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('battle.wotbreplay')
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith({ kind: 'local', file })
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    await flush()
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('换目标回放 → 先撤下上一场（内核 reset）回到待开播，按开始才解析新文件', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    playback.api.store.hasData = true
    await nextTick()

    const next = mkFile('b2.wotbreplay')
    await wrapper.setProps({ file: next })
    await flush()
    // 撤下旧场景：否则旧场景继续呈现，还会压住待开播面板（用户永远看着上一场）
    expect(playback.api.reset).toHaveBeenCalledTimes(1)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(playback.api.store.hasData).toBe(false)
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('b2.wotbreplay')

    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenLastCalledWith({ kind: 'local', file: next })
    wrapper.unmount()
  })

  it('active 闸门：切走 setPaused(true)、切回 setPaused(false)，且不销毁场景', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    playback.api.setPaused.mockClear()
    await wrapper.setProps({ active: false })
    expect(playback.api.setPaused).toHaveBeenCalledWith(true)
    expect(playback.api.destroy).not.toHaveBeenCalled()
    await wrapper.setProps({ active: true })
    expect(playback.api.setPaused).toHaveBeenLastCalledWith(false)
    wrapper.unmount()
    expect(playback.api.destroy).toHaveBeenCalledTimes(1)
  })

  it('解析中为不确定进度，资产阶段显示资产进度；失败后可重试同一文件或关闭', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const { store } = playback.api

    let finish
    // 首次解析（按「开始」触发的这一次）保持挂起：加载状态由场景层拥有，
    // 所以 mock 也要按场景契约翻转 loading / hasData。
    playback.api.loadData.mockImplementationOnce(() => {
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => { finish = resolve })
        .finally(() => { store.loading = false })   // 场景契约：加载结束必落下 loading
    })
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
    expect(store.hasData).toBe(false)
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.parsing')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()

    store.assetStage = true
    store.assetProgress = 0.3
    await nextTick()
    expect(wrapper.get('[data-testid="scene3d-loading"]').text()).toContain('agentReplay.loading_assets')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('30')

    store.err = 'bad replay'
    store.assetStage = false
    finish()
    await flush()
    expect(wrapper.get('[data-testid="scene3d-error"]').text()).toContain('agentReplay.error_load')
    await wrapper.get('[data-testid="scene3d-retry"]').trigger('click')
    await flush()
    expect(playback.api.loadData).toHaveBeenLastCalledWith({ kind: 'local', file: wrapper.props('file') })

    store.err = 'still bad'
    await nextTick()
    await wrapper.get('[data-testid="scene3d-dismiss"]').trigger('click')
    expect(store.err).toBe('')
    expect(wrapper.find('[data-testid="scene3d-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('HUD 阵营色取语义 token（inject 的 --color-team-* 生效），不写死红绿', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    // 阵容条目的真实形状来自 playbackScene 的 buildRoster（无 team 字段，分组即阵营）
    store.roster = {
      team1: [{ eid: 1, nick: 'A', tank: 'T-62A', frac: 50, dead: false, followed: false, dot: '#26794a' }],
      team2: [{ eid: 2, nick: 'B', tank: 'Maus', frac: 100, dead: false, followed: false, dot: '#98322a' }],
      unknown: [{ eid: 3, nick: 'C', tank: '', frac: 100, dead: false, followed: false, dot: '#f5f5f5' }],
    }
    document.documentElement.style.setProperty('--color-team-ally', 'rgb(1, 2, 3)')
    document.documentElement.style.setProperty('--color-team-enemy', 'rgb(4, 5, 6)')
    await nextTick()
    const dots = wrapper.findAll('.pl .dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].attributes('style')).toContain('rgb(1, 2, 3)')
    expect(dots[1].attributes('style')).toContain('rgb(4, 5, 6)')
    // 未知阵营既不并入我方也不并入敌方（用中性色）
    expect(dots[2].attributes('style')).not.toContain('rgb(1, 2, 3)')
    expect(dots[2].attributes('style')).not.toContain('rgb(4, 5, 6)')
    // 分组标题三语（未知阵营独立一段）
    expect(wrapper.findAll('.roster h3').map(h => h.text())).toEqual([
      'agentReplay.team1', 'agentReplay.team2', 'agentReplay.teamUnknown',
    ])
    document.documentElement.style.removeProperty('--color-team-ally')
    document.documentElement.style.removeProperty('--color-team-enemy')
    wrapper.unmount()
  })

  it('播放传输控件是 2D / 3D 共用的那一套（同一组 data-test 契约）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    playback.api.store.hasData = true
    playback.api.store.duration = 300
    await nextTick()
    expect(wrapper.find('[data-test="pb-controls"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-play"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-speed-0.5"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-time"]').exists()).toBe(true)
    // 3D 专属控件在独立 toolbar 行里，不混进传输控件
    expect(wrapper.get('[data-testid="replay3d-toolbar"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

/**
 * 场景生命周期不变量：sceneApi 存在 ⟺ 活的 stage DOM ∧ file ∧ !blocked ∧ WebGL。
 * 这三种变化的产品语义必须分开：active=false 只停帧；file/blocked 变化会销毁场景。
 */
describe('Replay3DPane 场景生命周期', () => {
  it('Test A — file → null 销毁旧场景；给新 file 时在新 stage 上重建，按开始后解析新文件', async () => {
    mockWebGL('webgl2')
    const fileA = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file: fileA })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledWith({ kind: 'local', file: fileA })

    // file=null：模板移除 .pb-root（stage 变成游离节点）→ 必须销毁场景，不能继续往它上面画
    await wrapper.setProps({ file: null })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.pb-root').exists()).toBe(false)
    expect(wrapper.find('.scene').exists()).toBe(false)
    expect(wrapper.get('[data-testid="replay3d-empty"]').exists()).toBe(true)

    // 新文件：必须是一次**全新的** initPlayback；新场景先待开播，按开始才解析
    const fileB = mkFile('b.wotbreplay')
    await wrapper.setProps({ file: fileB })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    const secondApi = playback.api
    expect(secondApi).not.toBe(firstApi)
    expect(secondApi.loadData).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)
    await start(wrapper)
    expect(secondApi.loadData).toHaveBeenCalledWith({ kind: 'local', file: fileB })
    // 新场景必须挂在**当前**的 stage 节点上，而不是那个已被移除的旧节点
    expect(wrapper.find('.scene').exists()).toBe(true)
    expect(playback.init.mock.calls[1][0]).toBe(wrapper.get('.scene').element)

    wrapper.unmount()
  })

  it('Test B — blocked 非空销毁场景；解除阻断后重建，按开始后重新解析同一文件', async () => {
    mockWebGL('webgl2')
    const file = mkFile('a.wotbreplay')
    const wrapper = mountPane({ file })
    await flush()
    const firstApi = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(firstApi.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(firstApi.destroy).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="replay3d-blocked"]').text()).toBe('workspace.single_replay_required')
    expect(wrapper.find('.scene').exists()).toBe(false)

    await wrapper.setProps({ blockedReason: '' })
    await flush()
    expect(playback.init).toHaveBeenCalledTimes(2)
    expect(playback.api).not.toBe(firstApi)
    expect(playback.api.loadData).not.toHaveBeenCalled()
    await start(wrapper)
    expect(playback.api.loadData).toHaveBeenCalledWith({ kind: 'local', file })

    wrapper.unmount()
  })

  it('Test C — active=false 只停帧：不销毁、不重建、不重解析；切回只恢复', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    expect(playback.init).toHaveBeenCalledTimes(1)
    await start(wrapper)
    expect(api.loadData).toHaveBeenCalledTimes(1)
    api.setPaused.mockClear()

    await wrapper.setProps({ active: false })
    await flush()
    expect(api.setPaused).toHaveBeenCalledWith(true)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ active: true })
    await flush()
    expect(api.setPaused).toHaveBeenLastCalledWith(false)
    expect(api.destroy).not.toHaveBeenCalled()
    expect(playback.init).toHaveBeenCalledTimes(1)
    expect(api.loadData).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('卸载销毁且只销毁一次', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    wrapper.unmount()
    expect(api.destroy).toHaveBeenCalledTimes(1)
  })

  it('无 WebGL 时不建场景，也不因 file 变化而建', async () => {
    mockWebGL('none')
    const wrapper = mountPane()
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(playback.init).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

/**
 * 就绪态（store.hasData）契约：它是 HUD 与播放传输的 authoritative gate
 * （`usePlaybackTransport({ isReady: () => store.hasData })`），因此必须在
 * 「新会话被接受」与「会话终止」两个时点落下，绝不能让上一场的 ready 泄漏到新会话。
 */
describe('Replay3DPane 就绪态（hasData）', () => {
  /** 让下一次加载保持挂起（按场景契约翻转 loading / hasData），返回完成句柄 */
  function pendNextLoad(api) {
    let settle
    api.loadData.mockImplementationOnce(() => {
      const store = api.store
      store.hasData = false
      store.loading = true
      return new Promise((resolve) => {
        settle = () => { store.loading = false; store.hasData = true; resolve() }
      })
    })
    return () => settle?.()
  }

  it('A：file=null 销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)      // 按开始后的加载已完成

    await wrapper.setProps({ file: null })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('B：被工作台阻断时就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    await wrapper.setProps({ blockedReason: 'workspace.single_replay_required' })
    await flush()
    expect(api.destroy).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    wrapper.unmount()
  })

  it('C：换文件先撤下上一场（reset）；新加载窗口不得继承上一场的 ready', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    // 换场：撤下旧场景（内核 reset）→ 回到待开播，ready 不得留在屏幕上
    await wrapper.setProps({ file: mkFile('b.wotbreplay') })
    await flush()
    expect(api.reset).toHaveBeenCalledTimes(1)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(true)

    // 新加载窗口：HUD / 播放传输都不得按 ready 渲染
    const settle = pendNextLoad(api)
    await start(wrapper)
    expect(api.store.loading).toBe(true)
    expect(api.store.hasData).toBe(false)
    expect(wrapper.find('[data-testid="replay3d-toolbar"]').exists()).toBe(false)

    settle()
    await flush()
    expect(api.store.hasData).toBe(true)
    expect(api.store.loading).toBe(false)
    wrapper.unmount()
  })

  it('卸载销毁会话后就绪态落下', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const api = playback.api
    await start(wrapper)
    expect(api.store.hasData).toBe(true)

    wrapper.unmount()
    expect(api.store.hasData).toBe(false)
  })
})

/**
 * 待开播画质闸门：内核 `startPlayback()` 是**惰性**创建渲染器并据当前档位定型首帧，
 * 所以画质必须在解析 + 拉资产之前选定——不能事后在「加载中」里切档
 * （生产内核在 DATA 就位后切档会走「已在播放 → 整页重载」分支，那是另一条路径）。
 */
describe('Replay3DPane 待开播画质闸门', () => {
  it('待开播先给画质档位并交出文件名；未按开始不解析', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: mkFile('battle.wotbreplay') })
    await flush()
    const pending = wrapper.get('[data-test="replay3d-pending"]')
    expect(pending.text()).toContain('battle.wotbreplay')
    expect(pending.text()).toContain('agentReplay.start')
    const quality = pending.get('[data-testid="replay3d-quality"]')
    expect(quality.findAll('button').map(b => b.attributes('data-value'))).toEqual(['low', 'mid', 'high'])

    // 档位选择直接交内核（画质定型在渲染器创建之前）
    await quality.get('button[data-value="low"]').trigger('click')
    expect(playback.api.setQuality).toHaveBeenCalledWith('low')
    expect(playback.api.loadData).not.toHaveBeenCalled()

    await start(wrapper)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('损坏 / 无文件名也不炸：卡片按兜底名呈现', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane({ file: { name: '', size: 0 } })
    await flush()
    expect(wrapper.get('[data-test="replay3d-pending"]').text()).toContain('replay')
    wrapper.unmount()
  })
})

/**
 * 顶栏双方总血量（与上游 3D 视图同布局：数值 + 色条夹住比分）。
 * 面板只渲染**阵营视角**字段：`hpFriend/hpEnemy` 与 `scoreFriend/scoreEnemy` 的映射在场景层
 * （teamHpTotals / perspectiveScore），HUD 不得再按 physical score1/score2 或 t1/t2 分组猜。
 */
describe('Replay3DPane 顶栏双方血量', () => {
  it('整数值 + 原始百分比色条 + 视角比分；标题给取整百分比', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.timer = '03:20'
    store.hpFriend = 12345; store.hpFriendMax = 20000; store.hpFriendPct = 61.725
    store.hpEnemy = 800; store.hpEnemyMax = 15000; store.hpEnemyPct = 5.333
    store.scoreFriend = 2; store.scoreEnemy = 1
    await nextTick()

    const hp = wrapper.get('[data-test="hud-team-hp"]')
    expect(hp.text()).toContain('12345 / 20000')
    expect(hp.text()).toContain('800 / 15000')
    // 血量不缩写（§11：禁止 12.3k）；己方在左、敌方在右
    expect(hp.text()).not.toContain('12.3k')
    const bars = hp.findAll('.hpbar > i')
    expect(bars[0].attributes('style')).toContain('width: 61.725%')   // 原始百分比：缓慢掉血也平滑
    expect(bars[1].attributes('style')).toContain('width: 5.333%')
    expect(hp.findAll('.hpbar')[0].attributes('title')).toBe('agentReplay.hp_friendly 62%')
    expect(hp.findAll('.hpbar')[1].attributes('title')).toBe('agentReplay.hp_enemy 5%')
    // 比分取视角字段（不是 score1/score2）
    expect(wrapper.get('[data-test="hud-score"]').text()).toBe('2 : 1')
    wrapper.unmount()
  })

  it('已死一方的空血上限不产生 NaN 文案（0 / 0 也照常渲染）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.hpFriend = NaN; store.hpFriendMax = null; store.hpFriendPct = NaN
    await nextTick()
    expect(wrapper.get('[data-test="hud-team-hp"]').text()).toContain('0 / 0')
    expect(wrapper.get('[data-test="hud-team-hp"]').text()).not.toContain('NaN')
    wrapper.unmount()
  })
})
