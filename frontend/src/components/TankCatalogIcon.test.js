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

  it('25 张目录素材全部有 /ui/** 远端路径（9 封面背景 + 9 国籍筛选 + 3 类别 + 4 车种）', () => {
    const entries = Object.entries(sources.assets)
    expect(entries).toHaveLength(25)
    for (const [, asset] of entries) {
      expect(asset.remote).toMatch(/^\/ui\//)
    }
    expect(entries.filter(([key]) => key.startsWith('cover-'))).toHaveLength(9)
    expect(entries.filter(([key]) => key.startsWith('nation-filter-'))).toHaveLength(9)
  })

  it('国籍旗统一用客户端 tank-tree 套（筛选与科技树页签同一套，9 国齐全）', () => {
    for (const [key, asset] of Object.entries(sources.assets)) {
      if (!key.startsWith('nation-filter-')) continue
      expect(asset.remote).toBe(`/ui/flags/flag_tank-tree_${key.slice('nation-filter-'.length)}@2x.webp`)
    }
  })

  it('国旗/类别/车种 客户端原图解析为 /ui/** 远端 URL', () => {
    const cases = [
      [{ kind: 'nation', value: 'ussr' }, 'https://assets.test/ui/flags/flag_tank-tree_ussr@2x.webp'],
      [{ kind: 'nation', value: 'germany' }, 'https://assets.test/ui/flags/flag_tank-tree_germany@2x.webp'],
      [{ kind: 'nation', value: 'usa' }, 'https://assets.test/ui/flags/flag_tank-tree_usa@2x.webp'],
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

  it('资产 origin 未配置时隐藏图标而不是抛断列表', () => {
    provider.imageUrl.mockImplementationOnce(() => null)
    const wrapper = mount(TankCatalogIcon, { props: { kind: 'nation', value: 'ussr' } })
    expect(wrapper.find('.catalog-icon').exists()).toBe(false)
    wrapper.unmount()
  })
})
