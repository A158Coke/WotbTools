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

function installAt(query: string) {
  window.history.replaceState({}, '', '/replay' + query)
  localStorage.clear()
  const S = makeHost()
  installSceneState(S)
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

  it('待开播卡片开启的接地阴影在改画质重载时仍随 URL 保留', async () => {
    const S = installAt('?q=high')
    S.contactShadowCtl.setEnabled(true)
    expect(S.store.contactShadows).toBe(true)

    expect(await S.applyRenderSettings({ qualityKey: 'ultra' })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('ultra')
    expect(url.searchParams.get('shadows')).toBe('1')
  })

  it('降档清掉接地阴影后，再次升档不会因遗留 ?shadows=1 意外恢复', async () => {
    const first = installAt('?q=ultra&shadows=1')
    expect(first.store.contactShadows).toBe(true)
    expect(await first.applyRenderSettings({ qualityKey: 'low' })).toBe(true)
    const downgraded = lastUrl()
    expect(downgraded.searchParams.get('q')).toBe('low')
    expect(downgraded.searchParams.get('shadows')).toBe('0')

    // 模拟一次真实重载：新页面从降档后的 URL 恢复（此时阴影已 OFF）。
    replace.mockClear()
    window.history.replaceState({}, '', String(downgraded))
    const second = makeHost()
    installSceneState(second)
    second.DATA = {}
    expect(second.store.contactShadows).toBe(false)

    expect(await second.applyRenderSettings({ qualityKey: 'high' })).toBe(true)
    const upgraded = lastUrl()
    expect(upgraded.searchParams.get('q')).toBe('high')
    expect(upgraded.searchParams.get('shadows')).toBe('0')
  })

  it('只改接地阴影也走同一次重载，并显式写 ?shadows=1', async () => {
    const S = installAt('?q=high')
    expect(S.store.contactShadows).toBe(false)

    expect(await S.applyRenderSettings({ contactShadows: true })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('high')
    expect(url.searchParams.get('shadows')).toBe('1')
  })

  it('只改 Log Depth 时保留当前已开启的接地阴影', async () => {
    const S = installAt('?q=high&shadows=1&logdepth=0')
    expect(S.store.contactShadows).toBe(true)

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('logdepth')).toBe('1')
    expect(url.searchParams.get('shadows')).toBe('1')
    expect(localStorage.getItem('pb_logdepth')).toBe('1')
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
