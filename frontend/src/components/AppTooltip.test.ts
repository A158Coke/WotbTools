// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AppTooltip from './AppTooltip.vue'

let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })

function mountTooltip() {
  wrapper = mount(AppTooltip, {
    props: { label: '关闭' },
    slots: { default: '<button type="button" aria-label="关闭">x</button>' },
    attachTo: document.body,
  })
  return wrapper
}

describe('AppTooltip', () => {
  it('不改变触发元素本身：仍是原生 button，可访问名称由它自己的 aria-label 提供', () => {
    mountTooltip()
    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('关闭')
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('键盘聚焦立即显示 tooltip 并通过 aria-describedby 关联；Esc 关闭', async () => {
    mountTooltip()
    wrapper.get('button').element.focus()
    wrapper.get('button').element.dispatchEvent(new FocusEvent('focus'))
    await flushPromises()
    const tooltip = document.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent).toContain('关闭')
    expect(wrapper.get('button').attributes('aria-describedby')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
})
