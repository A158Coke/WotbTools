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

function installAt(query: string, contactShadowOverride?: boolean, clearStorage = true, seedContactPref = false) {
  window.history.replaceState({}, '', '/replay' + query)
  if (clearStorage) localStorage.clear()
  if (seedContactPref) localStorage.setItem('pb_contact_shadows', '1')
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
    const S = installAt('?q=high&contactshadows=1')
    S.stageReloadReplay = vi.fn()
    expect(S.store.contactShadows).toBe(true)

    expect(await S.applyRenderSettings({ qualityKey: 'ultra' })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('ultra')
    expect(url.searchParams.has('shadows')).toBe(false)
  })

  it('降档只关闭有效效果并保留偏好，升档后恢复并进入本次暂存目标', async () => {
    const first = installAt('?q=ultra', undefined, true, true)
    first.stageReloadReplay = vi.fn()
    expect(first.store.contactShadows).toBe(true)

    expect(await first.applyRenderSettings({ qualityKey: 'low' })).toBe(true)
    expect(first.stageReloadReplay).toHaveBeenCalledWith(true)
    expect(first.store.contactShadows).toBe(false)
    expect(first.CONTACT_SHADOWS_PREF).toBe(true)
    expect(localStorage.getItem('pb_contact_shadows')).toBe('1')
    const downgraded = lastUrl()
    expect(downgraded.searchParams.get('q')).toBe('low')
    expect(downgraded.searchParams.has('shadows')).toBe(false)

    replace.mockClear()
    const second = installAt(downgraded.search, undefined, false)
    second.stageReloadReplay = vi.fn()
    expect(second.store.contactShadows).toBe(false)
    expect(second.CONTACT_SHADOWS_PREF).toBe(true)

    expect(await second.applyRenderSettings({ qualityKey: 'high' })).toBe(true)
    expect(second.stageReloadReplay).toHaveBeenCalledWith(true)
    expect(second.store.contactShadows).toBe(true)
    const upgraded = lastUrl()
    expect(upgraded.searchParams.get('q')).toBe('high')
    expect(upgraded.searchParams.has('shadows')).toBe(false)
  })

  it('接地阴影偏好默认关闭，开启后跨安装保留；低画质只关闭有效效果', () => {
    const off = installAt('?q=high')
    expect(off.CONTACT_SHADOWS_PREF).toBe(false)
    expect(off.store.contactShadows).toBe(false)

    localStorage.setItem('pb_contact_shadows', '1')
    const on = installAt('?q=high', undefined, false)
    expect(on.CONTACT_SHADOWS_PREF).toBe(true)
    expect(on.store.contactShadows).toBe(true)

    const low = installAt('?q=low', undefined, false)
    expect(low.CONTACT_SHADOWS_PREF).toBe(true)
    expect(low.store.contactShadows).toBe(false)
  })

  it('只改接地阴影也走同一次重载，目标随暂存记录而非 URL', async () => {
    const S = installAt('?q=high')
    S.stageReloadReplay = vi.fn()
    expect(S.store.contactShadows).toBe(false)

    expect(await S.applyRenderSettings({ contactShadows: true })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    expect(localStorage.getItem('pb_contact_shadows')).toBe('1')
    const url = lastUrl()
    expect(url.searchParams.get('q')).toBe('high')
    expect(url.searchParams.has('shadows')).toBe(false)
  })

  it('保存开启接地阴影时清掉旧的 ?contactshadows=0 覆盖，刷新后仍为新偏好', async () => {
    const S = installAt('?q=high&contactshadows=0')
    S.stageReloadReplay = vi.fn()
    expect(S.CONTACT_SHADOWS_PREF).toBe(false)

    expect(await S.applyRenderSettings({ contactShadows: true })).toBe(true)
    expect(S.stageReloadReplay).toHaveBeenCalledWith(true)
    expect(localStorage.getItem('pb_contact_shadows')).toBe('1')
    const url = lastUrl()
    expect(url.searchParams.has('contactshadows')).toBe(false)

    const next = installAt(url.search, undefined, false)
    expect(next.CONTACT_SHADOWS_PREF).toBe(true)
    expect(next.store.contactShadows).toBe(true)
  })

  it('保存关闭接地阴影时清掉旧的 ?contactshadows=1 覆盖', async () => {
    const S = installAt('?q=high&contactshadows=1')
    S.stageReloadReplay = vi.fn()
    expect(S.CONTACT_SHADOWS_PREF).toBe(true)

    expect(await S.applyRenderSettings({ contactShadows: false })).toBe(true)
    expect(localStorage.getItem('pb_contact_shadows')).toBe('0')
    expect(lastUrl().searchParams.has('contactshadows')).toBe(false)
  })

  it('低画质改接地阴影偏好也清掉 URL 覆盖，不依赖本次重载', async () => {
    const S = installAt('?q=low&contactshadows=0')
    S.stageReloadReplay = vi.fn()

    expect(await S.applyRenderSettings({ contactShadows: true })).toBe(false)
    expect(S.stageReloadReplay).not.toHaveBeenCalled()
    expect(localStorage.getItem('pb_contact_shadows')).toBe('1')
    expect(new URL(window.location.href).searchParams.has('contactshadows')).toBe(false)

    const next = installAt(window.location.search, undefined, false)
    expect(next.CONTACT_SHADOWS_PREF).toBe(true)
    expect(next.store.contactShadows).toBe(false)
  })

  it('只改其他渲染项时保留 URL 显式接地阴影覆盖', async () => {
    const S = installAt('?q=high&logdepth=0&contactshadows=1')
    S.stageReloadReplay = vi.fn()

    expect(await S.applyRenderSettings({ logdepth: true })).toBe(true)
    expect(lastUrl().searchParams.get('contactshadows')).toBe('1')
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
