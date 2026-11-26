// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSceneState } from './sceneState.ts'

function makeHost() {
  return {
    store: {
      speed: 1,
      qualityKey: 'high',
      qualityLabel: '',
      logdepth: false,
      dynres: true,
      armorHighlight: false,
      contactShadows: false,
    },
    perf: { interrupt: vi.fn() },
    scene: null,
    sunLight: null,
    rendererCaps: null,
  } as any
}

function installAt(query: string, contactShadowOverride?: boolean) {
  window.history.replaceState({}, '', '/replay' + query)
  localStorage.clear()
  const S = makeHost()
  installSceneState(S, contactShadowOverride)
  S.DATA = {}   // 模拟回放已开始（渲染上下文已定型，applyRenderSettings 走重载分支）
  return S
}

describe('sceneState.applyRenderSettings 重载参数', () => {
  let replace: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
  })

  afterEach(() => {
    replace.mockRestore()
    localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  function lastUrl(): URL {
    expect(replace).toHaveBeenCalledTimes(1)
    return new URL(String(replace.mock.calls[0][0]))
  }

  it('待开播卡片开启的接地阴影在改画质重载时进入本次暂存目标，不写入 URL', async () => {
    const S = installAt('?q=high')
    S.stageReloadReplay = vi.fn()
    S.contactShadowCtl.setEnabled(true)
    expect(S.store.contactShadows).toBe(true)

    expect(await S.applyRenderSettings({ qualityKey: 'ultra' })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('ultra')
    expect(url.searchParams.has('shadows')).toBe(false)
  })

  it('降档清掉接地阴影后，再次升档不会因旧 URL 参数意外恢复', async () => {
    const first = installAt('?q=ultra&shadows=1', true)
    first.stageReloadReplay = vi.fn()
    expect(first.store.contactShadows).toBe(true)
    expect(await first.applyRenderSettings({ qualityKey: 'low' })).toBe(true)
    expect(first.stageReloadReplay).toHaveBeenCalledWith(false)
    const downgraded = lastUrl()
    expect(downgraded.searchParams.get('q')).toBe('low')
    expect(downgraded.searchParams.has('shadows')).toBe(false)

    replace.mockClear()
    const second = installAt(downgraded.search)
    second.stageReloadReplay = vi.fn()
    expect(second.store.contactShadows).toBe(false)

    expect(await second.applyRenderSettings({ qualityKey: 'high' })).toBe(true)
    expect(second.stageReloadReplay).toHaveBeenCalledWith(false)
    const upgraded = lastUrl()
    expect(upgraded.searchParams.get('q')).toBe('high')
    expect(upgraded.searchParams.has('shadows')).toBe(false)
  })

  it('只改接地阴影也走同一次重载，目标随暂存记录而非 URL', async () => {
    const S = installAt('?q=high')
    S.stageReloadReplay = vi.fn()
    expect(S.store.contactShadows).toBe(false)

    expect(await S.applyRenderSettings({ contactShadows: true })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('high')
    expect(url.searchParams.has('shadows')).toBe(false)
  })

  it('只改 Log Depth 时保留当前已开启的接地阴影目标', async () => {
    const S = installAt('?q=high&logdepth=0', true)
    S.stageReloadReplay = vi.fn()
    expect(S.store.contactShadows).toBe(true)

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    const url = lastUrl()
    expect(url.searchParams.get('logdepth')).toBe('1')
    expect(url.searchParams.has('shadows')).toBe(false)
    expect(localStorage.getItem('pb_logdepth')).toBe('1')
  })

  it('旧 ?shadows=1 不参与场景初始化，也不会在重载时被重新带上', async () => {
    const S = installAt('?q=high&shadows=1')
    expect(S.store.contactShadows).toBe(false)
    S.stageReloadReplay = vi.fn()

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(false)
    expect(lastUrl().searchParams.has('shadows')).toBe(false)
  })

  it('无变化时不重载', async () => {
    const S = installAt('?q=high')
    expect(await S.applyRenderSettings({})).toBe(false)
    expect(await S.applyRenderSettings({ qualityKey: 'high' })).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })

  it('重载前先暂存当前回放，暂存完成后才发起一次导航', async () => {
    const S = installAt('?q=high')
    const calls: string[] = []
    S.stageReloadReplay = vi.fn(async () => { calls.push('stage') })
    replace.mockImplementation(() => { calls.push('replace') })

    expect(await S.applyRenderSettings({ qualityKey: 'low' })).toBe(true)
    expect(calls).toEqual(['stage', 'replace'])
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it('暂存失败：中止重载、不写偏好，保留当前会话', async () => {
    const S = installAt('?q=high')
    S.stageReloadReplay = vi.fn().mockRejectedValue(new Error('quota'))

    expect(await S.applyRenderSettings({ qualityKey: 'low', logdepth: true })).toBe(false)
    expect(S.stageReloadReplay).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
    expect(S.store.qualityKey).toBe('high')
    expect(S.LOGDEPTH).toBe(false)
    expect(localStorage.getItem('pb_logdepth')).toBeNull()
  })

  it('URL 显式携带 armorhl 时，重载前同步刚写入的装甲高亮值', async () => {
    const S = installAt('?q=high&armorhl=0')
    // 模拟 live setter：当前会话立即生效并写 localStorage（URL 仍优先）。
    S.ARMOR_HIGHLIGHT = true
    S.store.armorHighlight = true

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    expect(lastUrl().searchParams.get('armorhl')).toBe('1')
  })

  it('URL 未携带 armorhl 时不新增参数（不把一次保存变成永久 URL 覆盖）', async () => {
    const S = installAt('?q=high')
    S.ARMOR_HIGHLIGHT = true
    S.store.armorHighlight = true

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    expect(lastUrl().searchParams.has('armorhl')).toBe(false)
  })
})
