// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { KeepAlive, defineComponent, h, onUnmounted } from 'vue'
import BattlePicker from './BattlePicker.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: key => key, locale: { value: 'en' } }) }))

// useBreakpoint 在模块级共享 matchMedia 监听：用一个可控 viewport 模拟 compact / expanded，
// 不重载模块（Teleport 判定直接消费同一份 tier）。
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
afterEach(() => wrapper?.unmount())

async function open() {
  await wrapper.get('button[aria-haspopup="listbox"]').trigger('click')
  await flushPromises()
}

const optionValues = () => wrapper.findAll('[data-testid="battle-picker-option"]').map(o => o.attributes('data-value'))
const panelElement = () => document.querySelector('[data-testid="battle-picker-panel"]')
const documentOptions = () => Array.from(document.querySelectorAll('[data-testid="battle-picker-option"]'))

describe('BattlePicker', () => {
  it('触发按钮显示当前场次；打开后标记选中项', async () => {
    mountPicker({ options: options(3), modelValue: 'r1' })
    const trigger = wrapper.get('button[aria-haspopup="listbox"]')
    expect(trigger.text()).toContain('Battle 2 · Map 1')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    await open()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const selected = wrapper.findAll('[role="option"][aria-selected="true"]')
    expect(selected.map(o => o.attributes('data-value'))).toEqual(['r1'])
  })

  it('不超过 6 场不显示搜索框，焦点进入列表；超过 6 场显示搜索框并获得焦点', async () => {
    mountPicker({ options: options(6), modelValue: 'r0' })
    await open()
    expect(wrapper.find('[data-testid="battle-picker-search"]').exists()).toBe(false)
    expect(document.activeElement?.getAttribute('role')).toBe('listbox')
    wrapper.unmount()

    mountPicker({ options: options(7), modelValue: 'r0' })
    await open()
    expect(document.activeElement).toBe(wrapper.get('[data-testid="battle-picker-search"]').element)
  })

  it('搜索按标签、meta 与文件名过滤；无结果时说明', async () => {
    mountPicker({ options: options(10), modelValue: 'r0' })
    await open()
    const search = wrapper.get('[data-testid="battle-picker-search"]')
    await search.setValue('file7')
    expect(optionValues()).toEqual(['r7'])
    await search.setValue('chrd')
    expect(optionValues()).toEqual(['r1', 'r3', 'r5', 'r7', 'r9'])
    await search.setValue('nothing')
    expect(optionValues()).toEqual([])
    expect(wrapper.text()).toContain('workspace.battle_search_empty')
  })

  it('键盘：方向键移动高亮，Enter 选中并关闭、焦点回到触发按钮', async () => {
    mountPicker({ options: options(8), modelValue: 'r2' })
    await open()
    const search = wrapper.get('[data-testid="battle-picker-search"]')
    // 打开时高亮当前项
    expect(search.attributes('aria-activedescendant')).toMatch(/-2$/)
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'ArrowDown' })
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['r4']])
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('button[aria-haspopup="listbox"]').element)
  })

  it('Esc 关闭不改变选择；点击当前项不重复发出事件', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
    await open()
    await wrapper.findAll('[data-testid="battle-picker-option"]')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('点击组件外部关闭', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="battle-picker-panel"]').exists()).toBe(false)
  })

  it('搜索过后再打开：搜索已清空，高亮仍是当前场次（审查回归）', async () => {
    mountPicker({ options: options(10), modelValue: 'r5' })
    await open()
    await wrapper.get('[data-testid="battle-picker-search"]').setValue('file7')
    await wrapper.get('[data-testid="battle-picker-search"]').trigger('keydown', { key: 'Escape' })
    await open()
    const search = wrapper.get('[data-testid="battle-picker-search"]')
    expect(search.element.value).toBe('')
    expect(search.attributes('aria-activedescendant')).toMatch(/-5$/)
  })

  it('桌面端保持 trigger 下方 dropdown：overlay 仍在组件 DOM 内', async () => {
    mountPicker({ options: options(3), modelValue: 'r0' })
    await open()
    expect(panelElement()).not.toBeNull()
    expect(panelElement().closest('.battle-picker')).toBe(wrapper.element)
  })

  it('手机端把遮罩与 sheet teleport 到 body：两场都可见，点击 Battle 2 正确 emit', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    const sheet = panelElement()
    expect(sheet).not.toBeNull()
    expect(sheet.parentElement).toBe(document.body)
    expect(sheet.closest('.battle-picker')).toBeNull()
    expect(document.querySelector('.picker-scrim').parentElement).toBe(document.body)
    expect(documentOptions().map(option => option.textContent)).toEqual([
      expect.stringContaining('Battle 1'),
      expect.stringContaining('Battle 2'),
    ])
    // 点击 sheet 内 option 前的 pointerdown 不能被 document outside handler 当成外部点击。
    const second = documentOptions()[1]
    second.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(panelElement()).not.toBeNull()
    second.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([['r1']])
    expect(panelElement()).toBeNull()
  })

  it('手机端点击 scrim 关闭并清理 teleported sheet', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    document.querySelector('.picker-scrim').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(panelElement()).toBeNull()
    expect(document.querySelector('.picker-scrim')).toBeNull()
  })

  it('手机端点击 sheet 外部仍会关闭', async () => {
    setViewportWidth(390)
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(panelElement()).toBeNull()
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

  it('手机端 unmount 移除 document pointerdown 监听并清理 teleported sheet', async () => {
    setViewportWidth(390)
    const removeListener = vi.spyOn(document, 'removeEventListener')
    mountPicker({ options: options(2), modelValue: 'r0' })
    await open()
    wrapper.unmount()
    wrapper = undefined
    expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    removeListener.mockRestore()
    expect(panelElement()).toBeNull()
  })
})
