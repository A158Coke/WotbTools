// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TankCoverNation from './TankCoverNation.vue'

const provider = vi.hoisted(() => ({
  imageUrl: vi.fn(path => `https://assets.test${path}`),
  url: vi.fn(),
}))
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: provider }))

describe('TankCoverNation（整幅封面国籍背景）', () => {
  beforeEach(() => {
    provider.imageUrl.mockClear()
    provider.url.mockClear()
  })

  it('按国籍渲染 tutor-tank 布旗，隐藏装饰并走无副作用的 imageUrl', () => {
    const wrapper = mount(TankCoverNation, { props: { nation: 'ussr' } })
    const flag = wrapper.get('[data-testid="tank-cover-nation"]')
    expect(flag.element.tagName).toBe('SPAN')
    expect(flag.attributes('aria-hidden')).toBe('true')
    expect(flag.get('img').attributes('src')).toBe('https://assets.test/ui/flags/flag_tutor-tank_ussr@2x.webp')
    expect(provider.imageUrl).toHaveBeenCalledWith('/ui/flags/flag_tutor-tank_ussr@2x.webp')
    expect(provider.url).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('按可见 bounds 裁掉打包透明留白后再 cover 铺满', () => {
    const wrapper = mount(TankCoverNation, { props: { nation: 'ussr' } })
    const crop = wrapper.get('.tank-cover-flag-crop')
    const image = wrapper.get('.tank-cover-flag-crop img')
    expect(crop.attributes('style')).toContain('inline-size: 111.39')
    expect(crop.attributes('style')).toContain('block-size: 100%')
    expect(image.attributes('style')).toContain('inline-size: 115.83')
    expect(image.attributes('style')).toContain('block-size: 103.22')
    expect(image.attributes('style')).toContain('inset-inline-start: 0%')
    expect(image.attributes('style')).toContain('inset-block-start: 0%')
    wrapper.unmount()
  })

  it('无国籍数据时不渲染', () => {
    const wrapper = mount(TankCoverNation, { props: {} })
    expect(wrapper.find('[data-testid="tank-cover-nation"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('资产 origin 未配置/Android 3D 不可用时隐藏背景', () => {
    provider.imageUrl.mockImplementationOnce(() => null)
    const wrapper = mount(TankCoverNation, { props: { nation: 'usa' } })
    expect(wrapper.find('[data-testid="tank-cover-nation"]').exists()).toBe(false)
    wrapper.unmount()
  })
})