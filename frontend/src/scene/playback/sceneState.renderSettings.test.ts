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

  it('待开播卡片开启的接地阴影在改画质重载时仍随 URL 保留', () => {
    const S = installAt('?q=high')
    S.contactShadowCtl.setEnabled(true)
    expect(S.store.contactShadows).toBe(true)

    expect(S.applyRenderSettings({ qualityKey: 'ultra' })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('ultra')
    expect(url.searchParams.get('shadows')).toBe('1')
  })

  it('降档清掉接地阴影后，再次升档不会因遗留 ?shadows=1 意外恢复', () => {
    const first = installAt('?q=ultra&shadows=1')
    expect(first.store.contactShadows).toBe(true)
    expect(first.applyRenderSettings({ qualityKey: 'low' })).toBe(true)
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

    expect(second.applyRenderSettings({ qualityKey: 'high' })).toBe(true)
    const upgraded = lastUrl()
    expect(upgraded.searchParams.get('q')).toBe('high')
    expect(upgraded.searchParams.get('shadows')).toBe('0')
  })

  it('只改接地阴影也走同一次重载，并显式写 ?shadows=1', () => {
    const S = installAt('?q=high')
    expect(S.store.contactShadows).toBe(false)

    expect(S.applyRenderSettings({ contactShadows: true })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('high')
    expect(url.searchParams.get('shadows')).toBe('1')
  })

  it('只改 Log Depth 时保留当前已开启的接地阴影', () => {
    const S = installAt('?q=high&shadows=1&logdepth=0')
    expect(S.store.contactShadows).toBe(true)

    expect(S.applyRenderSettings({ logdepth: true })).toBe(true)
    const url = lastUrl()
    expect(url.searchParams.get('logdepth')).toBe('1')
    expect(url.searchParams.get('shadows')).toBe('1')
    expect(localStorage.getItem('pb_logdepth')).toBe('1')
  })

  it('无变化时不重载', () => {
    const S = installAt('?q=high')
    expect(S.applyRenderSettings({})).toBe(false)
    expect(S.applyRenderSettings({ qualityKey: 'high' })).toBe(false)
    expect(replace).not.toHaveBeenCalled()
  })
})
