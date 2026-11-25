// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import sources from '../assets/tank-catalog/sources.json'
import TankCatalogIcon from './TankCatalogIcon.vue'

const provider = vi.hoisted(() => ({
  imageUrl: vi.fn(path => `https://assets.test${path}`),
  url: vi.fn(),
}))
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: provider }))

describe('TankCatalogIcon（客户端图标走资产 origin）', () => {
  beforeEach(() => {
    provider.imageUrl.mockClear()
    provider.url.mockClear()
  })

  it('34 张目录素材全部有 /ui/** 远端路径（22 图标 + 9 封面背景 + 3 筛选补全）', () => {
    const entries = Object.entries(sources.assets)
    expect(entries).toHaveLength(34)
    for (const [, asset] of entries) {
      expect(asset.remote).toMatch(/^\/ui\//)
    }
    expect(entries.filter(([key]) => key.startsWith('cover-'))).toHaveLength(9)
    expect(entries.filter(([key]) => key.startsWith('nation-filter-'))).toHaveLength(9)
  })

  it('国旗/类别/车种 客户端原图解析为 /ui/** 远端 URL', () => {
    const cases = [
      [{ kind: 'nation', value: 'ussr' }, 'https://assets.test/ui/flags/flag_text_ussr@2x.webp'],
      [{ kind: 'nation', value: 'germany' }, 'https://assets.test/ui/flags/flag_carousel_germany@2x.webp'],
      [{ kind: 'category', value: 'premium' }, 'https://assets.test/ui/lobby-icons/icon_tank-premium@2x.webp'],
      [{ kind: 'type', value: 'mediumTank' }, 'https://assets.test/ui/lobby-icons/icon_tank-class_medium@2x.webp'],
    ]
    for (const [props, expected] of cases) {
      const wrapper = mount(TankCatalogIcon, { props })
      expect(wrapper.get('img').attributes('src')).toBe(expected)
      expect(provider.imageUrl).toHaveBeenCalledWith(expected.replace('https://assets.test', ''))
      expect(provider.url).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })

  it('筛选控件统一用 flag_filter_*（含美国/德国/中国，避免轮播图顶部压暗）', () => {
    for (const value of ['usa', 'germany', 'china', 'ussr']) {
      const wrapper = mount(TankCatalogIcon, { props: { kind: 'nation', value, variant: 'filter' } })
      expect(wrapper.get('img').attributes('src')).toBe(`https://assets.test/ui/flags/flag_filter_${value}@2x.webp`)
      wrapper.unmount()
    }
  })

  it('美国/中国默认仍使用客户端轮播旗', () => {
    const cases = [
      ['usa', 'https://assets.test/ui/flags/flag_carousel_usa@2x.webp'],
      ['china', 'https://assets.test/ui/flags/flag_carousel_china@2x.webp'],
    ]
    for (const [value, expected] of cases) {
      const wrapper = mount(TankCatalogIcon, { props: { kind: 'nation', value } })
      expect(wrapper.get('img').attributes('src')).toBe(expected)
      expect(wrapper.get('img').attributes('src')).not.toContain(`nation-${value}`)
      wrapper.unmount()
    }
  })

  it('资产 origin 未配置时隐藏图标而不是抛断列表', () => {
    provider.imageUrl.mockImplementationOnce(() => null)
    const wrapper = mount(TankCatalogIcon, { props: { kind: 'nation', value: 'ussr' } })
    expect(wrapper.find('.catalog-icon').exists()).toBe(false)
    wrapper.unmount()
  })
})