// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { KeepAlive, defineComponent, h, onUnmounted } from 'vue'
import BattlePicker from './BattlePicker.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, locale: { value: 'en' } }) }))

// useBreakpoint 在模块级共享 matchMedia 监听：用一个可控 viewport 模拟 compact / expanded，
// 不重载模块（桌面 Popover / 手机 AppSheet 的判定直接消费同一份 tier）。
let viewportWidth = 1280
const mediaListeners = []
function setViewportWidth(width) {
  viewportWidth = width
  for (const listener of mediaListeners) listener()
}
vi.stubGlobal('matchMedia', (query) => {
  const minWidth = /min-width:\s*(\d+)px/.exec(query)
  return {
    media: query,
    get matches() { return minWidth ? viewportWidth >= Number(minWidth[1]) : false },
    addEventListener: (_event, listener) => mediaListeners.push(listener),
  }
})
beforeEach(() => setViewportWidth(1280))

function options(count) {
  return Array.from({ length: count }, (_, i) => ({
    value: `r${i}`,
    label: `Battle ${i + 1} · Map ${i}`,
    meta: i % 2 ? 'CHRD won' : 'TOP won',
    search: `file${i}.wotbreplay`,
  }))
}

let wrapper
function mountPicker(props) {
  wrapper = mount(BattlePicker, { props: { ariaLabel: 'Choose battle', ...props }, attachTo: document.body })
  return wrapper
}
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; document.body.removeAttribute('style') })

async function open() {
  await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
  await flushPromises()
}

const panelElement = () => document.querySelector('[data-testid="battle-picker-panel"]')
const documentOptions = () => Array.from(document.querySelectorAll('[data-testid="battle-picker-option"]'))
const optionValues = () => documentOptions().map(o => o.getAttribute('data-value'))
const searchInput = () => document.querySelector('[data-testid="battle-picker-search"]')
const triggerButton = () => wrapper.get('button[aria-haspopup="listbox"]')
async function pressKey(target, key) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await flushPromises()
}
async function typeQuery(value) {
  searchInput().value = value
  searchInput().dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

describe('BattlePicker', () => {
  it('只有一场时显示同样的上下文，不给打不开的下拉', () => {
    mountPicker({ options: options(1), modelValue: 'r0', 'data-testid': 'static-picker' })
    const context = document.querySelector('[data-testid="static-picker"]')
    expect(context.textContent).toContain('Battle 1 · Map 0')
    expect(context.getAttribute('role')).toBe('group')
    expect(context.querySelector('button')).toBeNull()
    expect(document.querySelector('.picker-trigger')).toBeNull()
  })

  it('触发按钮显示当前场次；打开后标记选中项', async () => {
    mountPicker({ options: options(3), modelValue: 'r1' })
    expect(triggerButton().text()).toContain('Battle 2 · Map 1')
    expect(triggerButton().attributes('aria-expanded')).toBe('false')
    await open()
    expect(triggerButton().attributes('aria-expanded')).toBe('true')
    const selected = Array.from(document.querySelectorAll('[role="option"][aria-selected="true"]'))
    expect(selected.map(o => o.getAttribute('data-value'))).toEqual(['r1'])
  })

  it('不超过 6 场不显示搜索框；超过 6 场显示搜索框并获得焦点', async () => {
    mountPicker({ options: options(6), modelValue: 'r0' })
    await open()
    expect(searchInput()).toBeNull()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    wrapper.unmount()
    await flushPromises()

    mountPicker({ options: options(7), modelValue: 'r0' })
    await open()
    expect(document.activeElement).toBe(searchInput())
  })

  it('搜索按标签、meta 与文件名过滤；无结果时说明', async () => {
    mountPicker({ options: options(10), modelValue: 'r0' })
    await open()
    await typeQuery('file7')
    expect(optionValues()).toEqual(['r7'])
    await typeQuery('chrd')
    expect(optionValues()).toEqual(['r1', 'r3', 'r5', 'r7', 'r9'])
    await typeQuery('nothing')
    expect(optionValues()).toEqual([])
    expect(document.body.textContent).toContain('workspace.battle_search_empty')
  })

  it('键盘：方向键移动高亮，Enter 选中并关闭、焦点回到触发按钮', async () => {
    mountPicker({ options: options(8), modelValue: 'r2' })
    await open()
    // 打开时高亮当前项
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(documentOptions()[2].id)
    await pressKey(searchInput(), 'ArrowDown')
    await pressKey(searchInput(), 'ArrowDown')
    await pressKey(searchInput(), 'Enter')
    expect(wrapper.emitted('update:modelValue')).toEqual([['r4']])
    expect(panelElement()).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(triggerButton().element)
  })

  it('Esc 关闭不改变选择；点击当前项不重复发出事件', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    await pressKey(document.activeElement, 'Escape')
    expect(panelElement()).toBeNull()
    await open()
    documentOptions()[0].click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('桌面端 Tab / Shift+Tab 不被困在面板里：关闭面板并把焦点放回触发按钮', async () => {
    mountPicker({ options: options(8), modelValue: 'r2' })
    await open()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    searchInput().dispatchEvent(tab)
    await flushPromises()
    expect(panelElement()).toBeNull()
    expect(document.activeElement).toBe(triggerButton().element)
    await open()
    searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(panelElement()).toBeNull()
    expect(document.activeElement).toBe(triggerButton().element)
  })

  it('手机端选中另一场或按 Esc 后，焦点回到场次按钮', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(3), modelValue: 'r0' })
    triggerButton().element.focus()
    await open()
    documentOptions()[1].click()
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(triggerButton().element)

    await open()
    await pressKey(document.activeElement, 'Escape')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(panelElement()).toBeNull()
    expect(document.activeElement).toBe(triggerButton().element)
  })

  it('点击组件外部关闭', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    // Reka 在下一个宏任务才注册 document 级 outside 监听
    await new Promise(resolve => setTimeout(resolve, 10))
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(panelElement()).toBeNull()
  })

  it('搜索过后再打开：搜索已清空，高亮仍是当前场次（审查回归）', async () => {
    mountPicker({ options: options(10), modelValue: 'r5' })
    await open()
    await typeQuery('file7')
    await pressKey(searchInput(), 'Escape')
    await open()
    expect(searchInput().value).toBe('')
    expect(searchInput().getAttribute('aria-activedescendant')).toBe(documentOptions()[5].id)
  })

  it('桌面端是 trigger 下方的 popover 面板（portal 到 body，不使用 sheet 遮罩）', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    expect(panelElement()).not.toBeNull()
    expect(panelElement().closest('.battle-picker')).toBeNull()
    expect(document.querySelector('[data-testid="sheet-scrim"]')).toBeNull()
  })

  it('手机端用 AppSheet：遮罩与 sheet 在 body，两场都可见，点击 Battle 2 正确 emit', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    const sheet = panelElement()
    expect(sheet).not.toBeNull()
    expect(sheet.parentElement).toBe(document.body)
    expect(sheet.closest('.battle-picker')).toBeNull()
    expect(document.querySelector('[data-testid="sheet-scrim"]').parentElement).toBe(document.body)
    expect(documentOptions().map(option => option.textContent)).toEqual([
      expect.stringContaining('Battle 1'),
      expect.stringContaining('Battle 2'),
    ])
    // sheet 内 option 的 pointerdown 不能被当成外部点击
    documentOptions()[1].dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(panelElement()).not.toBeNull()
    documentOptions()[1].click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['r1']])
    expect(panelElement()).toBeNull()
  })

  it('手机端 Esc 关闭并清理 teleported sheet', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    await pressKey(document.activeElement, 'Escape')
    expect(panelElement()).toBeNull()
    expect(document.querySelector('[data-testid="sheet-scrim"]')).toBeNull()
  })

  it('KeepAlive 停用（离开 Replay 页面）时关闭 teleported sheet', async () => {
    setViewportWidth(390)
    // 模拟真实层级：KeepAlive 缓存的是 ReplayWorkspace，BattlePicker 是其后代（不是缓存根）；
    // 切换 currentView 触发 deactivate，而不是卸载整棵子树。
    const unmounted = []
    const WorkspaceLike = defineComponent({
      name: 'WorkspaceLike',
      setup() {
        onUnmounted(() => unmounted.push('workspace'))
        return () => h(BattlePicker, { options: options(2), modelValue: 'r0', ariaLabel: 'Choose battle' })
      },
    })
    const OtherView = defineComponent({ name: 'OtherView', setup: () => () => h('div', { 'data-test': 'other-view' }) })
    const Host = defineComponent({
      props: { workspace: { type: Boolean, default: true } },
      setup(hostProps) {
        return () => h(KeepAlive, null, () => (hostProps.workspace ? h(WorkspaceLike) : h(OtherView)))
      },
    })
    wrapper = mount(Host, { attachTo: document.body })
    await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
    await flushPromises()
    expect(panelElement()).not.toBeNull()
    await wrapper.setProps({ workspace: false })
    await flushPromises()
    expect(unmounted).toEqual([])
    expect(panelElement()).toBeNull()
  })

  it('手机端 unmount 清理 teleported sheet', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    wrapper.unmount()
    wrapper = undefined
    await flushPromises()
    expect(panelElement()).toBeNull()
  })
})
