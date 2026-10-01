// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import MenuButton from './MenuButton.vue'

const ITEMS = [
  { key: 'aggregate', label: 'Excel · Summary', testid: 'item-aggregate' },
  { key: 'each', label: 'Excel · Per battle', disabled: true, testid: 'item-each' },
  { key: 'png', label: 'PNG', testid: 'item-png' },
]

let wrapper
function mountMenu(props = {}) {
  wrapper = mount(MenuButton, { props: { label: 'Export', items: ITEMS, ...props }, attrs: { 'data-testid': 'menu' }, attachTo: document.body })
  return wrapper
}
afterEach(() => wrapper?.unmount())

const trigger = () => wrapper.get('[data-testid="menu"]')
const enabledItems = () => wrapper.findAll('[role="menuitem"]:not([disabled])').map(i => i.element)

describe('MenuButton', () => {
  it('透传属性落在触发按钮上；点击打开并聚焦第一个可用项', async () => {
    mountMenu()
    expect(trigger().element.tagName).toBe('BUTTON')
    expect(trigger().attributes('aria-haspopup')).toBe('menu')
    await trigger().trigger('click')
    await flushPromises()
    expect(trigger().attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(enabledItems()[0])
  })

  it('方向键跳过禁用项并循环；Esc 关闭并把焦点还给触发按钮', async () => {
    mountMenu()
    await trigger().trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const menu = wrapper.get('[role="menu"]')
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('[data-testid="item-png"]').element)
    await menu.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('[data-testid="item-aggregate"]').element)
    await menu.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger().element)
  })

  it('选择项发出 key 并关闭；禁用项不发出', async () => {
    mountMenu()
    await trigger().trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="item-each"]').trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    await wrapper.get('[data-testid="item-png"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['png']])
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('整体禁用时不能打开', async () => {
    mountMenu({ disabled: true })
    await trigger().trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })
})
