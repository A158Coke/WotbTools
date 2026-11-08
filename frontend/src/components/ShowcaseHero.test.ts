// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ShowcaseHero from './ShowcaseHero.vue'

describe('ShowcaseHero', () => {
  it('只渲染给出的标题区内容；主视觉层是装饰（aria-hidden）', () => {
    const wrapper = mount(ShowcaseHero, {
      props: { kicker: 'HALL OF FAME', title: '名人堂', description: '随机战斗与评级的最高纪录' },
      slots: { stats: '<div><strong>10,483</strong></div>', actions: '<button>提交记录</button>' },
    })
    expect(wrapper.get('h1').text()).toBe('名人堂')
    expect(wrapper.get('.showcase-hero-kicker').text()).toBe('HALL OF FAME')
    expect(wrapper.get('.showcase-hero-art').attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('.showcase-hero-stats strong').text()).toBe('10,483')
    expect(wrapper.find('.showcase-hero-actions button').exists()).toBe(true)
  })

  it('没有可选内容时不留空容器', () => {
    const wrapper = mount(ShowcaseHero, { props: { title: '坦克百科' } })
    expect(wrapper.find('.showcase-hero-kicker').exists()).toBe(false)
    expect(wrapper.find('.showcase-hero-stats').exists()).toBe(false)
    expect(wrapper.find('.showcase-hero-actions').exists()).toBe(false)
  })
})
