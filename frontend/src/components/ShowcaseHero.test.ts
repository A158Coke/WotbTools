// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ShowcaseHero from './ShowcaseHero.vue'
import { SECTION_HERO_IDS, SECTION_HEROES, sectionHeroStyle } from '../shared/sectionHeroes'

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

  it('section 映射到对应分区的固定主视觉与焦点位置', () => {
    for (const section of SECTION_HERO_IDS) {
      const wrapper = mount(ShowcaseHero, { props: { title: '页面标题', section } })
      const art = wrapper.get('.showcase-hero-art')
      const style = art.attributes('style') || ''
      expect(wrapper.get('[data-testid="showcase-hero"]').attributes('data-section')).toBe(section)
      expect(art.classes()).toContain('showcase-hero-art--section')
      expect(style).toContain(`hero-${section}.webp`)
      expect(style).toContain('--hero-pos')
      expect(style).toContain('--hero-pos-mobile')
    }
  })

  it('未传 section 时保留季节主视觉，不注入分区图片', () => {
    const wrapper = mount(ShowcaseHero, { props: { title: '首页' } })
    const art = wrapper.get('.showcase-hero-art')
    expect(art.classes()).not.toContain('showcase-hero-art--section')
    expect(art.attributes('style')).toBeUndefined()
  })

  it('声明了 compactPosition 的分区注入 --hero-pos-compact，其余分区不注入（回退 position）', () => {
    expect(sectionHeroStyle('replay')['--hero-pos-compact']).toBe('center 50%')
    expect(sectionHeroStyle('techtree')['--hero-pos-compact']).toBe('center 58%')
    for (const section of SECTION_HERO_IDS) {
      const style = sectionHeroStyle(section)
      if (SECTION_HEROES[section].compactPosition) continue
      expect(style['--hero-pos-compact']).toBeUndefined()
    }
  })

  it('compact 横幅的分区主视觉注入 compactPosition，窄横幅焦点对准主体带', () => {
    const wrapper = mount(ShowcaseHero, {
      props: { title: '回放工作台', section: 'replay', compact: true },
    })
    const style = wrapper.get('.showcase-hero-art').attributes('style') || ''
    expect(style).toContain('--hero-pos-compact')
    expect(style).toContain('hero-replay.webp')
  })

  it('compact 的横幅只保留 kicker / 标题，操作移到横幅外的工具条', () => {
    const wrapper = mount(ShowcaseHero, {
      props: { kicker: '回放', title: '回放工作台', description: '导入录像', compact: true },
      slots: { stats: '<strong>12</strong>', actions: '<button>选择文件</button>' },
    })
    expect(wrapper.get('[data-testid="showcase-hero"]').classes()).toContain('is-compact')
    expect(wrapper.get('.showcase-hero-kicker').text()).toBe('回放')
    expect(wrapper.get('h1').text()).toBe('回放工作台')
    expect(wrapper.find('.showcase-hero-description').exists()).toBe(false)
    expect(wrapper.find('.showcase-hero-stats').exists()).toBe(false)
    expect(wrapper.find('.showcase-hero-actions').exists()).toBe(false)
    expect(wrapper.find('.showcase-hero-toolbar button').text()).toBe('选择文件')
  })
})
