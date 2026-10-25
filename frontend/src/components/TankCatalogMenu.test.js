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
    await wrapper.find('#tp-nation').setValue('germany')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0]).toMatchObject({ nation: 'germany', tier: '10', sort: 'name' })
    await wrapper.find('#tp-sort').setValue('hp')
    expect(wrapper.emitted('update:filters')?.at(-1)?.[0].sort).toBe('hp')
    wrapper.unmount()
  })
})
