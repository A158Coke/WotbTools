// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const assets = vi.hoisted(() => ({ configured: true }))
vi.mock('../scene/agentData.js', () => ({
  tankImageUrl: (id: number) => {
    if (!assets.configured) throw new Error('asset source not configured')
    return `https://assets.test/tank_images/${id}.webp`
  },
}))

vi.mock('../scene/replaySource.js', () => ({
  mapCoverUrl: (key: string) => assets.configured ? `https://assets.test/cover/${key}.webp` : null,
}))

import HofPodium from './HofPodium.vue'

const rows = [
  { id: 'a', rank: 1, nickname: 'first', tankId: 1, tankName: 'Leopard 1', damageDealt: 10483, mapName: 'savanna' },
  { id: 'b', rank: 2, nickname: 'second', tankId: 2, tankName: 'Type 5 Heavy', damageDealt: 10294, mapName: 'not_a_map' },
  { id: 'c', rank: 3, nickname: 'third', tankId: 3, tankName: 'Obj. 777 II', damageDealt: 10103 },
]

function mountPodium(compact = false) {
  return mount(HofPodium, {
    props: { rows, compact, locale: 'en' },
    global: { mocks: { $t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key } },
  })
}

describe('HofPodium', () => {
  it('大屏按 2 · 1 · 3 排列，第 1 名居中并加强调', () => {
    const wrapper = mountPodium()
    const cards = wrapper.findAll('.hof-podium-card')
    expect(cards.map(card => card.get('.hof-podium-name').text())).toEqual(['second', 'first', 'third'])
    expect(cards[1].classes()).toContain('is-first')
    expect(cards[1].get('.hof-podium-damage').text()).toBe('10,483')
    expect(cards[1].get('.hof-podium-meta').text()).toContain('Oasis Palms')
  })

  it('小屏只显示第 1 名', () => {
    const wrapper = mountPodium(true)
    expect(wrapper.findAll('.hof-podium-card')).toHaveLength(1)
    expect(wrapper.get('.hof-podium-name').text()).toBe('first')
  })

  it('车辆图加载失败时隐藏，不显示破图标', async () => {
    const wrapper = mountPodium(true)
    const img = wrapper.get('.hof-podium-tank')
    await img.trigger('error')
    expect((img.element as HTMLImageElement).hidden).toBe(true)
  })

  it('资产源未配置时不渲染车辆图，领奖台照常显示', () => {
    assets.configured = false
    const wrapper = mountPodium()
    expect(wrapper.findAll('.hof-podium-card')).toHaveLength(3)
    expect(wrapper.find('.hof-podium-tank').exists()).toBe(false)
    assets.configured = true
  })

  it('卡片背景是该记录的地图封面；资产源不可用时回退打包地图图，没有地图名就不画', () => {
    const wrapper = mountPodium()
    const maps = wrapper.findAll('.hof-podium-map')
    expect(maps.map(img => img.attributes('src'))).toEqual(['https://assets.test/cover/not_a_map.webp', 'https://assets.test/cover/savanna.webp'])
    assets.configured = false
    const offline = mountPodium(true)
    expect(offline.find('.hof-podium-map').attributes('src')).toBeTruthy()
    assets.configured = true
  })
})
