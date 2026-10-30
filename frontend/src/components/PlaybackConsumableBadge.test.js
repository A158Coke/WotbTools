// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PlaybackConsumableBadge from './PlaybackConsumableBadge.vue'

const mountBadge = (props = {}) => mount(PlaybackConsumableBadge, {
  props: {
    logicalItemId: 'ADRENALINE',
    remainingSec: 15,
    durationSec: 20,
    ...props,
  },
})

describe('PlaybackConsumableBadge', () => {
  it('正在生效：图标 + 剩余比例环（dashoffset 随剩余时间变化）', () => {
    const wrapper = mountBadge()
    expect(wrapper.find('[data-test="pb-consumable-badge"]').exists()).toBe(true)
    expect(wrapper.find('.pb-consumable-icon').exists()).toBe(true)
    const ring = wrapper.get('.pb-consumable-ring-fill')
    const dasharray = Number(ring.attributes('stroke-dasharray'))
    const dashoffset = Number(ring.attributes('stroke-dashoffset'))
    expect(dasharray).toBeGreaterThan(0)
    expect(dashoffset).toBeCloseTo(dasharray * 0.25, 5)
  })

  it('Shell Reload Boost 使用客户端 reload 图标', () => {
    const wrapper = mountBadge({ logicalItemId: 'SHELL_RELOAD_BOOST' })
    const img = wrapper.get('.pb-consumable-icon')
    expect(img.attributes('src')).toContain('reload')
  })

  it('无图 logicalItemId 回退几何点，不裸显 ID', () => {
    const wrapper = mountBadge({ logicalItemId: 'GRAVITY_JUMP' })
    expect(wrapper.find('.pb-consumable-icon').exists()).toBe(false)
    expect(wrapper.find('.pb-consumable-fallback').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('GRAVITY_JUMP')
  })
})
