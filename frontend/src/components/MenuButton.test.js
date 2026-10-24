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
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; document.body.removeAttribute('style') })

const trigger = () => wrapper.get('[data-testid="menu"]')
const menu = () => document.querySelector('[role="menu"]')
const item = testid => document.querySelector(`[data-testid="${testid}"]`)
const key = (target, name) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
async function press(target, name) { key(target, name); await flushPromises() }
async function openByClick() {
  trigger().element.click()
  await flushPromises()
}

describe('MenuButton', () => {
  it('透传属性落在触发按钮上；点击打开后菜单出现，触发按钮 aria-expanded=true', async () => {
    mountMenu()
    expect(trigger().element.tagName).toBe('BUTTON')
    expect(trigger().attributes('aria-haspopup')).toBe('menu')
    await openByClick()
    expect(menu()).not.toBeNull()
    expect(menu().getAttribute('aria-label')).toBe('Export')
    expect(trigger().attributes('aria-expanded')).toBe('true')
  })

  it('键盘打开聚焦第一个可用项；方向键跳过禁用项并循环；Esc 关闭并把焦点还给触发按钮', async () => {
    mountMenu()
    trigger().element.focus()
    await press(trigger().element, 'ArrowDown')
    expect(document.activeElement).toBe(item('item-aggregate'))
    await press(menu(), 'ArrowDown')
    expect(document.activeElement).toBe(item('item-png'))
    await press(menu(), 'ArrowDown')
    expect(document.activeElement).toBe(item('item-aggregate'))
    await press(menu(), 'Home')
    expect(document.activeElement).toBe(item('item-aggregate'))
    await press(menu(), 'End')
    expect(document.activeElement).toBe(item('item-png'))
    await press(menu(), 'Escape')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger().element)
  })

  it('选择项发出 key 并关闭；禁用项不发出', async () => {
    mountMenu()
    await openByClick()
    expect(item('item-each').getAttribute('data-disabled')).not.toBeNull()
    item('item-each').click()
    await flushPromises()
    expect(wrapper.emitted('select')).toBeUndefined()
    item('item-png').click()
    await flushPromises()
    expect(wrapper.emitted('select')).toEqual([['png']])
    expect(menu()).toBeNull()
  })

  it('整体禁用时不能打开', async () => {
    mountMenu({ disabled: true })
    await openByClick()
    expect(menu()).toBeNull()
  })
})
