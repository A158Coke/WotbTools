// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'
import TankCatalogMenu from './TankCatalogMenu.vue'

const data = vi.hoisted(() => ({
  tankImageUrl: vi.fn(id => `https://assets.test/tank_images/${id}.webp`),
  loadTankIconCrops: vi.fn(async () => null),
}))
vi.mock('../scene/agentData.js', () => data)

const layout = vi.hoisted(() => ({ compact: false }))
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return { useBreakpoint: () => ({ isCompact: computed(() => layout.compact), isExpanded: computed(() => !layout.compact) }) }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh'),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    te: key => key === 'agentTanks.nations.ussr',
  }),
}))

const TANKS = [
  { id: 1, name: 'T-34', tier: 5, nation: 'ussr', type: 'mediumTank', hp: 900, pen_max: 120, aliases: [] },
  { id: 2, name: 'IS-7', tier: 10, nation: 'ussr', type: 'heavyTank', hp: 2400, pen_max: 300, aliases: ['大白兔'] },
  { id: 3, name: 'E 100', tier: 10, nation: 'germany', type: 'heavyTank', hp: 2700, pen_max: 334, aliases: [] },
]

function mountMenu(props = {}) {
  return mount(TankCatalogMenu, { props: { tanks: TANKS, ...props }, attachTo: document.body, global: { provide: { [DIALOG_INLINE_KEY]: true } } })
}

describe('TankCatalogMenu（坦克百科 / 装甲查看器选车共用）', () => {
  beforeEach(() => { layout.compact = false; document.body.innerHTML = '' })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  it('page 模式：即时筛选 + 防抖提交 filters，别名命中正式车名', async () => {
    vi.useFakeTimers()
    const wrapper = mountMenu()
    await wrapper.find('#tp-search').setValue('大白兔')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].q).toBe('大白兔')
    wrapper.unmount()
  })

  it('IME 组合输入期间不提前筛选或提交，组合结束后更新搜索', async () => {
    vi.useFakeTimers()
    const wrapper = mountMenu()
    const input = wrapper.find('#tp-search').element
    input.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }))
    input.value = '大白兔'
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await flushPromises()
    vi.advanceTimersByTime(300)

    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(3)
    expect(wrapper.emitted('update:filters')).toBeUndefined()

    input.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }))
    await flushPromises()
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['IS-7'])
    vi.advanceTimersByTime(300)
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].q).toBe('大白兔')
    wrapper.unmount()
  })

  it('selects every filtered result beyond 48, preserves hidden picks and only commits on confirmation', async () => {
    const tanks = Array.from({ length: 75 }, (_, i) => ({ id: i + 1, name: 'Tank ' + i, tier: i < 60 ? 10 : 9, nation: 'usa', type: 'mediumTank' }))
    const wrapper = mountMenu({ tanks, multiple: true, filters: { tier: '10' } })
    const buttons = () => wrapper.get('.tc-bulk-bar').findAll('button')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(48)
    await buttons()[0].trigger('click')
    expect(wrapper.get('.tc-bulk-bar').text()).toContain('"count":60')
    await wrapper.setProps({ filters: { tier: '9' } })
    expect(wrapper.get('.tc-bulk-bar').text()).toContain('"hidden":60')
    await buttons()[0].trigger('click')
    await buttons()[1].trigger('click')
    await wrapper.get('[data-tank-id="61"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('select')).toBeUndefined()
    await buttons()[2].trigger('click')
    expect(wrapper.emitted('confirm')[0][0].map(t => t.id).sort((a,b) => a-b)).toEqual(Array.from({ length: 61 }, (_, i) => i+1))
    wrapper.unmount()
  })

  it('dialog 模式：标题/关闭/autofocus/当前项高亮/选择事件', async () => {
    const wrapper = mountMenu({ layout: 'dialog', title: '选择目标', selectedId: 2, autofocus: true })
    await flushPromises()
    expect(wrapper.find('#tp-title').text()).toBe('选择目标')
    expect(document.activeElement?.id).toBe('tp-search')
    expect(wrapper.find('.tp-card.sel').attributes('data-tank-id')).toBe('2')
    await wrapper.find('[data-tank-id="3"]').trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0].name).toBe('E 100')
    await wrapper.find('#tp-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('compact：筛选 chips + sheet，四个筛选控件在 dialog 内', async () => {
    layout.compact = true
    const wrapper = mountMenu({ filters: { q: '', tier: '10', nation: '', type: '', sort: 'name' } })
    expect(wrapper.find('[data-testid="filter-chip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tank-filters"]').exists()).toBe(false)
    await wrapper.find('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"] [data-testid="tank-filters"]').exists()).toBe(true)
    for (const id of ['tp-tier', 'tp-nation', 'tp-type', 'tp-sort']) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    wrapper.unmount()
  })

  it('外部 filters 新对象但值不变时，不覆盖正在输入的搜索草稿', async () => {
    const wrapper = mountMenu({ filters: { q: '', tier: '', nation: '', type: '', sort: 'name' } })
    await wrapper.find('#tp-search').setValue('is7')
    await wrapper.setProps({ filters: { q: '', tier: '', nation: '', type: '', sort: 'name' } })
    await flushPromises()
    expect(wrapper.find('#tp-search').element.value).toBe('is7')
    wrapper.unmount()
  })

  it('机动 opt-in：同一模态内切换筛选，保留搜索、结果节点和隐藏草稿，完成后才允许确认', async () => {
    layout.compact = true
    const wrapper = mountMenu({ layout: 'dialog', inlineFilters: true, multiple: true })
    await wrapper.get('#tp-search').setValue('e100')
    await wrapper.get('[data-tank-id="3"]').trigger('click')
    const results = wrapper.get('.tp-results').element
    const toggle = wrapper.get('[data-testid="filter-toggle"]').element
    toggle.focus()
    await wrapper.get('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="catalog-filter-panel"]').isVisible()).toBe(true)
    expect(wrapper.get('.tp-results').isVisible()).toBe(false)
    expect(wrapper.get('.tc-bulk-bar').isVisible()).toBe(false)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('filter-sheet-done')
    await wrapper.get('#tp-nation [data-value="ussr"]').trigger('click')
    await wrapper.get('[data-testid="filter-sheet-done"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.tp-results').element).toBe(results)
    expect(wrapper.get('#tp-search').element.value).toBe('e100')
    expect(wrapper.get('.tc-bulk-bar').text()).toContain('"hidden":1')
    expect(document.activeElement).toBe(toggle)
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.get('.tc-bulk-bar button:last-of-type').trigger('click')
    expect(wrapper.emitted('confirm')[0][0].map(tank => tank.id)).toEqual([3])
    wrapper.unmount()
  })

  it.each(['done', 'escape'])('筛选按钮未获得焦点时直接激活，%s 仍把焦点还给实际按钮', async exit => {
    layout.compact = true
    const wrapper = mountMenu({ layout: 'dialog', inlineFilters: true })
    try {
      const search = wrapper.get('#tp-search')
      const toggle = wrapper.get('[data-testid="filter-toggle"]')
      search.element.focus()
      expect(document.activeElement).toBe(search.element)
      // Dispatch activation without focusing the button, as touch browsers may do.
      await toggle.trigger('click')
      await flushPromises()
      const done = wrapper.get('[data-testid="filter-sheet-done"]')
      expect(document.activeElement).toBe(done.element)
      if (exit === 'done') await done.trigger('click')
      else done.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await flushPromises()
      expect(wrapper.get('[data-testid="catalog-filter-panel"]').isVisible()).toBe(false)
      expect(document.activeElement).toBe(toggle.element)
    } finally { wrapper.unmount() }
  })

  it('机动子面板 Escape 不传给外层；未显式启用的 dialog 仍使用 Sheet', async () => {
    layout.compact = true
    const wrapper = mountMenu({ layout: 'dialog', inlineFilters: true })
    await wrapper.get('[data-testid="filter-toggle"]').trigger('click')
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    wrapper.get('[data-testid="filter-sheet-done"]').element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(outer).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="catalog-filter-panel"]').isVisible()).toBe(false)
    window.removeEventListener('keydown', outer)
    wrapper.unmount()
    const armor = mountMenu({ layout: 'dialog' })
    await armor.get('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    expect(armor.find('[role="dialog"] [data-testid="tank-filters"]').exists()).toBe(true)
    expect(armor.find('[data-testid="catalog-filter-panel"]').exists()).toBe(false)
    armor.unmount()
  })

  it('compact 筛选 sheet：焦点进入 sheet，Escape 关闭 sheet 并把焦点还给筛选按钮', async () => {
    layout.compact = true
    const wrapper = mountMenu({ filters: { q: '', tier: '10', nation: '', type: '', sort: 'name' } })
    const toggle = wrapper.find('[data-testid="filter-toggle"]').element
    toggle.focus()
    toggle.click()
    await flushPromises()
    const sheet = wrapper.find('[role="dialog"]')
    expect(sheet.exists()).toBe(true)
    expect(sheet.element.contains(document.activeElement)).toBe(true)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="tank-filters"]').exists()).toBe(false)
    expect(document.activeElement).toBe(toggle)
    wrapper.unmount()
  })

  it('non-compact 筛选区：Escape 不拦截，继续冒泡给外层弹窗', async () => {
    layout.compact = false
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    const wrapper = mountMenu()
    wrapper.find('#tp-tier').element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(outer).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', outer)
    wrapper.unmount()
  })

  it('卸载前 flush 未提交的搜索草稿', async () => {
    vi.useFakeTimers()
    const wrapper = mountMenu()
    await wrapper.find('#tp-search').setValue('is7')
    wrapper.unmount()
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].q).toBe('is7')
  })

  it('筛选/排序 emit 完整 filters', async () => {
    const wrapper = mountMenu({ filters: { q: '', tier: '10', nation: '', type: '', sort: 'name' } })
    await wrapper.find('#tp-nation [data-value="germany"]').trigger('click')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0]).toMatchObject({ nation: 'germany', tier: '10', sort: 'name' })
    // sort / type 是 Choice Group（DC-SEL-01）：点选而非 <select>.setValue
    await wrapper.find('#tp-sort [data-value="hp"]').trigger('click')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].sort).toBe('hp')
    await wrapper.find('#tp-type [data-value="heavyTank"]').trigger('click')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].type).toBe('heavyTank')
    // 「全部」= 空值选项：仍可清除筛选（不计入候选数）
    await wrapper.find('#tp-type [data-value=""]').trigger('click')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].type).toBe('')
    wrapper.unmount()
  })
  it('类别参与组合和重置，筛选不触发选车', async () => {
    layout.compact = true
    const tanks = TANKS.map((tank, index) => ({ ...tank, category: index === 2 ? 'collector' : 'regular' }))
    const wrapper = mountMenu({ tanks })
    await wrapper.find('[data-testid="filter-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.find('#tp-category [data-value="collector"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]').map(card => card.find('.tp-card-name').text())).toEqual(['E 100'])
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.emitted('update:filters').at(-1)[0].category).toBe('collector')
    await wrapper.find('[data-testid="catalog-clear"]').trigger('click')
    expect(wrapper.findAll('[data-testid="tank-card"]')).toHaveLength(3)
    expect(wrapper.emitted('update:filters').at(-1)[0].category).toBe('')
    wrapper.unmount()
  })

})
