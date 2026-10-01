// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import AppDialog from './AppDialog.vue'
import ConfirmDialogHost from './ConfirmDialogHost.vue'
import { confirm } from '../composables/useConfirm.js'

const mocks = { $t: key => key }
let wrapper
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = '' })

function mountDialog() {
  const Host = defineComponent({
    setup() {
      const open = ref(false)
      return () => h('div', [
        h('button', { id: 'opener', onClick: () => { open.value = true } }, 'open'),
        h(AppDialog, { open: open.value, title: 'Title', onClose: () => { open.value = false } }, {
          default: () => h('input', { id: 'field' }),
          actions: () => [h('button', { id: 'a' }, 'A'), h('button', { id: 'b' }, 'B')],
        }),
      ])
    },
  })
  wrapper = mount(Host, { attachTo: document.body, global: { mocks } })
  return wrapper
}

const dialog = () => document.querySelector('[role="dialog"]')

describe('AppDialog', () => {
  it('打开：role=dialog + aria-modal + 标题关联，焦点进入对话框', async () => {
    mountDialog()
    document.getElementById('opener').focus()
    document.getElementById('opener').click()
    await flushPromises()
    expect(dialog().getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog().getAttribute('aria-labelledby')).textContent).toBe('Title')
    expect(document.activeElement.id).toBe('field')
  })

  it('Tab 在对话框内循环；Esc 关闭并把焦点还给打开它的按钮', async () => {
    mountDialog()
    const opener = document.getElementById('opener')
    opener.focus()
    opener.click()
    await flushPromises()
    document.getElementById('b').focus()
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement.classList.contains('dialog-close')).toBe(true)
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement.id).toBe('b')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('点遮罩关闭', async () => {
    mountDialog()
    document.getElementById('opener').click()
    await flushPromises()
    document.querySelector('[data-testid="dialog-scrim"]').click()
    await flushPromises()
    expect(dialog()).toBeNull()
  })
})

describe('confirm() + ConfirmDialogHost', () => {
  it('确认 → true，取消 / Esc → false；默认焦点在「取消」', async () => {
    wrapper = mount(ConfirmDialogHost, { attachTo: document.body, global: { mocks } })
    const yes = confirm({ title: 'Delete?', confirmLabel: 'Delete', danger: true })
    await flushPromises()
    expect(document.activeElement.getAttribute('data-testid')).toBe('confirm-cancel')
    expect(document.querySelector('[data-testid="confirm-ok"]').textContent).toContain('Delete')
    document.querySelector('[data-testid="confirm-ok"]').click()
    await expect(yes).resolves.toBe(true)

    const no = confirm({ title: 'Again?' })
    await flushPromises()
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(no).resolves.toBe(false)
  })
})

describe('ConfirmDialogHost：离开页面时结束未决确认', () => {
  it('路由变化 → 按「取消」结束', async () => {
    const { createMemoryHistory, createRouter } = await import('vue-router')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/b', component: { template: '<div />' } }] })
    await router.push('/')
    wrapper = mount(ConfirmDialogHost, { attachTo: document.body, global: { mocks, plugins: [router] } })
    const pending = confirm({ title: 'Withdraw?' })
    await flushPromises()
    await router.push('/b')
    await expect(pending).resolves.toBe(false)
    expect(dialog()).toBeNull()
  })
})
