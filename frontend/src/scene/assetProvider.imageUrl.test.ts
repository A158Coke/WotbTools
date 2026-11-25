// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  android: true,
  base: 'https://assets.test',
  connectivity: 'offline',
  settled: true,
}))
const notices = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../platform/runtime.js', async importOriginal => ({
  ...(await importOriginal()),
  isAndroidRuntime: () => state.android,
}))
vi.mock('./assetBase.js', () => ({ assetBase: () => state.base }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  return {
    useConnectivity: () => ({
      connectivity: ref(state.connectivity),
      settled: ref(state.settled),
      whenSettled: () => Promise.resolve(),
    }),
  }
})
vi.mock('../composables/useConnectivityNotice.js', () => ({
  showConnectivityNotice: notices.show,
}))

import { assetProvider } from './assetProvider.js'

describe('assetProvider.imageUrl（装饰图无副作用 URL）', () => {
  beforeEach(() => {
    state.android = true
    state.base = 'https://assets.test'
    state.connectivity = 'offline'
    state.settled = true
    notices.show.mockClear()
  })

  it('Android 离线时返回 null，且不触发 3D 门禁提示', () => {
    expect(assetProvider.imageUrl('/ui/flags/flag_tutor-tank_usa@2x.webp')).toBeNull()
    expect(notices.show).not.toHaveBeenCalled()
  })

  it('Android 在线时返回资产 origin URL', () => {
    state.connectivity = 'online'
    expect(assetProvider.imageUrl('/ui/flags/flag_tutor-tank_usa@2x.webp'))
      .toBe('https://assets.test/ui/flags/flag_tutor-tank_usa@2x.webp')
    expect(notices.show).not.toHaveBeenCalled()
  })

  it('Web 不检查 PLAYBACK_3D 门禁', () => {
    state.android = false
    expect(assetProvider.imageUrl('/ui/flags/flag_tutor-tank_usa@2x.webp'))
      .toBe('https://assets.test/ui/flags/flag_tutor-tank_usa@2x.webp')
    expect(notices.show).not.toHaveBeenCalled()
  })

  it('资产源未配置时返回 null', () => {
    state.base = ''
    expect(assetProvider.imageUrl('/ui/flags/flag_tutor-tank_usa@2x.webp')).toBeNull()
    expect(notices.show).not.toHaveBeenCalled()
  })

  it('真正的 3D 资产 url() 仍走 requireFeature 并给出统一提示', () => {
    expect(() => assetProvider.url('/glb/1/model.glb')).toThrow('NETWORK_ERROR')
    expect(notices.show).toHaveBeenCalledTimes(1)
  })
})