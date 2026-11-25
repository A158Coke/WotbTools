// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TankCoverNation from './TankCoverNation.vue'

const provider = vi.hoisted(() => ({ url: vi.fn(path => `https://assets.test${path}`) }))
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: provider }))

describe('TankCoverNation（整幅封面国籍背景）', () => {
  beforeEach(() => { provider.url.mockClear() })

  it('按国籍渲染 tutor-tank 布旗作为封面背景，且对辅助技术隐藏', () => {
    const wrapper = mount(TankCoverNation, { props: { nation: 'ussr' } })
    const flag = wrapper.get('[data-testid="tank-cover-nation"]')
    expect(flag.element.tagName).toBe('IMG')
    expect(flag.attributes('src')).toBe('https://assets.test/ui/flags/flag_tutor-tank_ussr@2x.webp')
    expect(flag.attributes('aria-hidden')).toBe('true')
    // 父级 `.tp-media img` 是 contain；背景层必须内联 cover 才能铺满。
    expect(flag.attributes('style')).toContain('object-fit: cover')
    expect(provider.url).toHaveBeenCalledWith('/ui/flags/flag_tutor-tank_ussr@2x.webp')
    wrapper.unmount()
  })

  it('无国籍数据时不渲染', () => {
    const wrapper = mount(TankCoverNation, { props: {} })
    expect(wrapper.find('[data-testid="tank-cover-nation"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('资产 origin 未配置时隐藏背景而不是抛错', () => {
    provider.url.mockImplementationOnce(() => { throw new Error('资产源未配置') })
    const wrapper = mount(TankCoverNation, { props: { nation: 'usa' } })
    expect(wrapper.find('[data-testid="tank-cover-nation"]').exists()).toBe(false)
    wrapper.unmount()
  })
})