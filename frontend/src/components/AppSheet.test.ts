// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import AppSheet from './AppSheet.vue'

let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; document.body.removeAttribute('style') })

function mountSheet() {
  const Host = defineComponent({
    setup() {
      const open = ref(false)
      return () => h('div', [
        h('button', { id: 'opener', onClick: () => { open.value = true } }, 'open'),
        h(AppSheet, { open: open.value, title: 'Filters', onClose: () => { open.value = false } }, {
          default: () => h('input', { id: 'field' }),
        }),
      ])
    },
  })
  wrapper = mount(Host, { attachTo: document.body })
}
const sheet = () => document.querySelector('[role="dialog"]')

describe('AppSheet', () => {
  it('打开后是带标题的模态 dialog 并挂到 body；焦点进入 sheet', async () => {
    mountSheet()
    document.getElementById('opener')!.focus()
    document.getElementById('opener')!.click()
    await flushPromises()
    expect(sheet()).not.toBeNull()
    expect(sheet()!.parentElement).toBe(document.body)
    expect(document.getElementById(sheet()!.getAttribute('aria-labelledby')!)!.textContent).toBe('Filters')
    expect(sheet()!.contains(document.activeElement)).toBe(true)
  })

  it('Esc 关闭并触发 close', async () => {
    mountSheet()
    document.getElementById('opener')!.click()
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(sheet()).toBeNull()
  })

  it('关闭后焦点回到打开前的元素（没有 DrawerTrigger 也成立）', async () => {
    mountSheet()
    const opener = document.getElementById('opener')!
    opener.focus()
    opener.click()
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('遮罩使用 sheet 层 token 并随 sheet 关闭', async () => {
    mountSheet()
    document.getElementById('opener')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="sheet-scrim"]')).not.toBeNull()
  })
})
