// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  installPaneTestLifecycle, mountPane, mockWebGL, mkFile, flush, start, openDetailsViaScene,
  paneComponent, translate, here, testState, fullscreenCalls,
  nextTick, ref, shallowReactive, mount, readFileSync, fileURLToPath, dirname, resolve,
  makeBattlePlaybackDataset, zh, en, ru,
} from './Replay3DPane.test.harness.js'

const { canonical, playback, layout, connectivityState } = testState

installPaneTestLifecycle()

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
    expect(firstApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileA }))

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
    expect(secondApi.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file: fileB }))
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
    expect(playback.api.loadData).toHaveBeenCalledWith(expect.objectContaining({ kind: 'local', file }))

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
    expect(quality.findAll('button').map(b => b.attributes('data-value'))).toEqual(['low', 'mid', 'high', 'ultra'])

    // 档位选择直接交内核（画质定型在渲染器创建之前）
    await quality.get('button[data-value="low"]').trigger('click')
    expect(playback.api.setQuality).toHaveBeenCalledWith('low')
    expect(playback.api.loadData).not.toHaveBeenCalled()

    await start(wrapper)
    expect(wrapper.find('[data-test="replay3d-pending"]').exists()).toBe(false)
    expect(playback.api.loadData).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('档位文案走 i18n（agentReplay.q_*），不直接用预设里的固定 label', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await flush()
    const quality = wrapper.get('[data-testid="replay3d-quality"]')
    // 预设 label 是上游固定中文（低/中/高）；界面必须取三语 key，
    // 否则 en / ru 界面会混入中文（用户实测反馈）
    expect(quality.findAll('button').map(b => b.text()))
      .toEqual(['agentReplay.q_low', 'agentReplay.q_mid', 'agentReplay.q_high', 'agentReplay.q_ultra'])
    expect(quality.text()).not.toContain('Low')
    // 相机档位同理（就绪态直接陈列在控制条；2026-10-05 从 Display 面板移出）
    playback.api.store.hasData = true
    await nextTick()
    const cams = wrapper.get('[data-testid="replay3d-camera"]')
    // 俯视是持续模式（旋转中心 = 地图中心），与自由并列；录像者档位暂不支持
    expect(cams.findAll('button').map(b => b.attributes('data-value'))).toEqual(['free', 'top', 'recorder'])
    expect(cams.text()).toContain('agentReplay.cam_free')
    expect(cams.text()).toContain('agentReplay.cam_sandbox')
    expect(wrapper.get('[data-testid="replay3d-top-view"]').text()).toBe('agentReplay.cam_top')
    // 沙盘是模式，俯视是动作：两个入口走不同的相机命令
    await cams.get('[data-value="top"]').trigger('click')
    expect(playback.api.setCam).toHaveBeenLastCalledWith('top')
    const recorder = cams.get('[data-value="recorder"]')
    expect(recorder.attributes('disabled')).toBeDefined()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_unsupported')
    playback.api.store.recorderCameraStatus = 'loading'
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_loading')
    playback.api.store.recorderCameraStatus = 'ready'
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_dead')
    playback.api.store.recorderModeUnknown = true
    await nextTick()
    expect(recorder.attributes('title')).toBe('agentReplay.cam_recorder_unsupported')
    playback.api.store.recorderModeUnknown = false
    playback.api.store.recorderViewAvailable = true
    await nextTick()
    expect(recorder.attributes('disabled')).toBeUndefined()
    await recorder.trigger('click')
    expect(playback.api.setCam).toHaveBeenLastCalledWith('recorder')
    playback.api.store.cam = 'recorder'
    await nextTick()
    expect(wrapper.get('[data-testid="replay3d-drawing-entry"]').attributes('disabled')).toBeDefined()
    playback.api.setFollow.mockClear()
    playback.init.mock.calls.at(-1)[3].onVehicleSelect(11)
    expect(playback.api.setFollow).not.toHaveBeenCalled()
    playback.api.store.cam = 'free'
    playback.api.store.recorderViewAvailable = false
    playback.api.store.recorderCameraStatus = 'idle'
    await nextTick()
    playback.api.store.cam = 'free'
    await nextTick()
    await wrapper.get('[data-testid="replay3d-top-view"]').trigger('click')
    expect(playback.api.setCam).toHaveBeenCalledWith('top-view')
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
    // 顶栏计时与 2D 同口径：开战起算（引擎发布的原点 startTime = 10 → 210 - 10 = 200s = 03:20）
    store.startTime = 10
    store.time = 210
    store.hpFriend = 12345; store.hpFriendMax = 20000; store.hpFriendPct = 61.725
    store.hpEnemy = 800; store.hpEnemyMax = 15000; store.hpEnemyPct = 5.333
    store.scoreFriend = 2; store.scoreEnemy = 1
    await nextTick()

    const hp = wrapper.get('[data-test="pb-hp-bars"]')
    expect(hp.text()).toContain('12345 / 20000')
    expect(hp.text()).toContain('800 / 15000')
    // 血量不缩写（§11：禁止 12.3k）；己方在左、敌方在右
    expect(hp.text()).not.toContain('12.3k')
    expect(hp.get('[data-test="pb-hp-fill-friendly"]').attributes('style')).toContain('width: 61.7%')
    expect(hp.get('[data-test="pb-hp-fill-enemy"]').attributes('style')).toContain('width: 5.3%')
    expect(wrapper.get('[data-test="pb-hud-time"]').text()).toBe('03:20')
    // 比分取视角字段（不是 score1/score2）
    expect(wrapper.get('[data-test="pb-hud-score"]').text()).toBe('2 : 1')
    wrapper.unmount()
  })

  it('已死一方的空血上限不产生 NaN 文案（0 / 0 也照常渲染）', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const { store } = playback.api
    store.hasData = true
    store.hpFriend = NaN; store.hpFriendMax = null; store.hpFriendPct = NaN
    await nextTick()
    expect(wrapper.get('[data-test="pb-hp-bars"]').text()).toContain('0 / 0')
    expect(wrapper.get('[data-test="pb-hp-bars"]').text()).not.toContain('NaN')
    wrapper.unmount()
  })
})

describe('Replay3DPane 3D annotation wiring', () => {
  async function openDrawing({ playing = false } = {}) {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    playback.api.store.playing = playing
    await nextTick()
    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    return wrapper
  }

  function sceneOptions() {
    return playback.init.mock.calls.at(-1)[3]
  }

  it('opens with pen without touching transport and exposes only pen/eraser plus shared actions', async () => {
    const wrapper = await openDrawing({ playing: true })
    const api = playback.api
    expect(api.store.playing).toBe(true)
    expect(api.setPlaying).not.toHaveBeenCalledWith(false)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: true, tool: 'pen', width: 3, eraserWidth: 16,
    }))
    const panel = wrapper.get('[data-test="replay3d-annotations"]')
    expect(panel.find('[data-test="pb-annot-pen"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-undo"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-redo"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-clear"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-toggle"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-close"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-toolbar"]').classes()).toContain('pb-annot-compact')
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-select"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-route"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-arrow"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-LT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-MT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-HT"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-TD"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows only the current tool slider in the compact 3D toolbar', async () => {
    const wrapper = await openDrawing()
    const panel = wrapper.get('[data-test="replay3d-annotations"]')
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)

    await panel.find('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(false)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(true)

    await panel.find('[data-test="pb-annot-pen"]').trigger('click')
    await flush()
    expect(panel.find('[data-test="pb-annot-width"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-colors"]').exists()).toBe(true)
    expect(panel.find('[data-test="pb-annot-eraser-radius"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('pen/eraser activation and exit never change playback state', async () => {
    const playingWrapper = await openDrawing({ playing: true })
    const playingApi = playback.api
    await playingWrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(playingApi.store.playing).toBe(true)
    await playingWrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(playingApi.store.playing).toBe(true)
    expect(playingApi.setPlaying).not.toHaveBeenCalledWith(false)
    playingWrapper.unmount()

    const pausedWrapper = await openDrawing({ playing: false })
    const pausedApi = playback.api
    await pausedWrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(pausedApi.store.playing).toBe(false)
    await pausedWrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(pausedApi.store.playing).toBe(false)
    expect(pausedApi.setPlaying).not.toHaveBeenCalledWith(true)
    pausedWrapper.unmount()
  })

  it('统一传输条：3D 主进度条带名册入口（与 2D 同位），切换不改变共用按键位置', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    const api = playback.api
    api.store.hasData = true
    await nextTick()
    const entry = () => wrapper.get('.pb-controls [data-test="pb-roster-entry"]')
    const pressed = entry().attributes('aria-pressed')
    await entry().trigger('click')
    expect(entry().attributes('aria-pressed')).toBe(pressed === 'true' ? 'false' : 'true')
    wrapper.unmount()
  })

  it('keeps Drawing out of the shared transport and opens it from the 3D tool-row', async () => {
    mockWebGL('webgl2')
    const wrapper = mountPane()
    await start(wrapper)
    const toolrow = wrapper.get('[data-testid="replay3d-toolrow"]')
    expect(toolrow.find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-controls"]').find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(false)

    await toolrow.find('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="replay3d-toolrow"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="pb-controls"]').find('[data-testid="replay3d-drawing-entry"]').exists()).toBe(false)

    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-testid="replay3d-toolrow"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-toolbar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('commits one annotation through the scene callback and supports undo/redo/clear', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    expect(wrapper.find('[data-test="pb-annot-clear"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-redo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])

    await wrapper.get('[data-test="pb-annot-clear"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    wrapper.unmount()
  })

  it('keeps optional surfaceY through commit / undo / redo', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = {
      type: 'pen', color: '#ff4d4f', width: 1.2,
      points: [{ x: 0, y: 0, surfaceY: 8 }, { x: 10, y: 0, surfaceY: 8 }],
    }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])

    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-redo"]').trigger('click')
    await flush()
    const restored = api.setAnnotations.mock.calls.at(-1)[0]
    expect(restored[0].points.every((p) => Number.isFinite(p.surfaceY))).toBe(true)
    expect(restored[0]).toEqual(annotation)
    wrapper.unmount()
  })

  it('eraser split keeps finite surfaceY on both generated endpoints', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = {
      type: 'pen', color: '#ff4d4f', width: 1.2,
      points: [{ x: 0, y: 0, surfaceY: 8 }, { x: 10, y: 0, surfaceY: 12 }],
    }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    sceneOptions().onAnnotationErase({ points: [{ x: 5, y: 0, surfaceY: 10 }], radius: 1 })
    await flush()
    const pieces = api.setAnnotations.mock.calls.at(-1)[0]
    expect(pieces).toHaveLength(2)
    for (const piece of pieces) {
      expect(piece.points.every((p) => Number.isFinite(p.surfaceY))).toBe(true)
    }
    expect(pieces[0].points.at(-1).surfaceY).toBeGreaterThan(8)
    expect(pieces[0].points.at(-1).surfaceY).toBeLessThan(12)
    wrapper.unmount()
  })

  it('eraser callback applies semantically and adds one history entry', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.get('[data-test="pb-annot-eraser"]').trigger('click')
    await flush()
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ tool: 'eraser' }))
    const before = api.setAnnotations.mock.calls.length
    sceneOptions().onAnnotationErase({ points: [{ x: 0.5, y: 0.5 }], radius: 10 })
    await flush()
    expect(api.setAnnotations.mock.calls.length).toBe(before + 1)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    await wrapper.get('[data-test="pb-annot-undo"]').trigger('click')
    await flush()
    expect(api.setAnnotations).toHaveBeenLastCalledWith([annotation])
    wrapper.unmount()
  })

  it('visibility toggle never changes history and does not reproject', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    const projections = api.setAnnotations.mock.calls.length
    await wrapper.get('[data-test="pb-annot-toggle"]').trigger('click')
    await flush()
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(false)
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    await wrapper.get('[data-test="pb-annot-toggle"]').trigger('click')
    await flush()
    expect(api.setAnnotationsVisible).toHaveBeenLastCalledWith(true)
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    wrapper.unmount()
  })

  it('close keeps committed annotations and disables interaction; reopen restores them', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    const projections = api.setAnnotations.mock.calls.length
    await wrapper.get('[data-test="pb-annot-close"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    expect(api.setAnnotationInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, tool: null }))
    expect(api.setAnnotations.mock.calls.length).toBe(projections)
    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="pb-annot-undo"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('opening Display or collapsing controls closes drawing mode', async () => {
    const wrapper = await openDrawing()
    await wrapper.get('[data-testid="display-toggle"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)

    await wrapper.get('[data-testid="replay3d-drawing-entry"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(true)
    await wrapper.get('[data-testid="replay3d-controls-toggle"]').trigger('click')
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('changing the replay file clears history and closes drawing mode', async () => {
    const wrapper = await openDrawing()
    const api = playback.api
    const annotation = { type: 'pen', color: '#ff4d4f', width: 1.2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    sceneOptions().onAnnotationCommit(annotation)
    await flush()
    await wrapper.setProps({ file: mkFile('next.wotbreplay') })
    await flush()
    expect(wrapper.find('[data-test="replay3d-annotations"]').exists()).toBe(false)
    expect(api.setAnnotations).toHaveBeenLastCalledWith([])
    wrapper.unmount()
  })

  /**
   * 2026-11-19 用户要求：2D/3D 同一个面板窗口，播放条从场景里拿出来、放到窗口下方通栏。
   * 源码级守卫：根节点必须带 transport-docked；共享 CSS 必须把 controls 放回普通流
   * （否则播放条又变成压在场景底部的 absolute 浮层）。
   */
  it('统一回放面板：3D 根带 transport-docked，播放条在舞台下方通栏（源码守卫）', () => {
    const src = readFileSync(resolve(here, 'Replay3DPane.vue'), 'utf8')
    expect(src).toContain('class="pb-root playback-workspace transport-docked"')
    const css = [
      readFileSync(resolve(here, '../styles/playback-workspace.css'), 'utf8'),
      readFileSync(resolve(here, '../styles/playback-workspace-3d.css'), 'utf8'),
    ].join('\n')
    const docked = /\.pb-root\.playback-workspace\.transport-docked:not\(\.portrait-flow\) > \.controls \{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(docked).toContain('position: relative')
    expect(docked).toContain('inline-size: 100%')
    expect(docked).toContain('order: 1')
    // 2026-11-19 统一传输条 chrome：与 2D 同一行布局（次级行在上 | 主进度条 | 折叠钮在右）
    expect(docked).toContain('flex-direction: row')
    expect(docked).toContain('padding: 0')
    // 收起态只包按钮（不占满行宽），否则手机横屏折叠不省空间。
    const collapsed = /\.pb-root\.playback-workspace\.transport-docked:not\(\.portrait-flow\) > \.controls\.controls-docked \{([\s\S]*?)\}/.exec(css)?.[1] ?? ''
    expect(collapsed).toContain('inline-size: fit-content')
  })
})

