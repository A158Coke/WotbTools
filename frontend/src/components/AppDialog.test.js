// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import AppDialog from './AppDialog.vue'
import ConfirmDialogHost from './ConfirmDialogHost.vue'
import { confirm } from '../composables/useConfirm.js'

const mocks = { $t: key => key }
let wrapper
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; document.body.removeAttribute('style') })

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
// Reka 在焦点陷阱卸载后的下一个宏任务才触发 close-auto-focus
const settleFocus = () => new Promise(resolve => setTimeout(resolve, 10))

describe('AppDialog', () => {
  it('returns focus when a conditional editor is unmounted while open', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const editor = mount(AppDialog, { props: { open: true, title: 'Conditional editor' }, attachTo: document.body, global: { mocks }, slots: { default: '<input autofocus>' } })
    await flushPromises()
    expect(document.activeElement).not.toBe(opener)
    editor.unmount()
    await settleFocus()
    expect(document.activeElement).toBe(opener)
  })
  it('does not take focus from a newer active dialog when an old editor unmounts', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener); opener.focus()
    const old = mount(AppDialog, { props: { open: true, title: 'Old' }, attachTo: document.body, global: { mocks }, slots: { default: '<input id="old-input" autofocus>' } })
    await flushPromises()
    const current = mount(AppDialog, { props: { open: true, title: 'Current' }, attachTo: document.body, global: { mocks }, slots: { default: '<input id="current-input" autofocus>' } })
    await flushPromises()
    old.unmount()
    await settleFocus()
    expect(document.activeElement.id).toBe('current-input')
    current.unmount()
    expect(document.getElementById('old-input')).toBeNull()
    expect(document.activeElement).not.toBe(opener)
  })
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
    await settleFocus()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('忽略视觉隐藏的焦点候选：初始焦点落在可见按钮，Tab 不逃到背景', async () => {
    // #678 回归：名人堂上传弹层里隐藏的 file input 曾抢走初始焦点，导致 Tab 进背景、Esc 关不掉。
    const Host = defineComponent({
      setup() {
        const open = ref(false)
        return () => h('div', [
          h('button', { id: 'opener', onClick: () => { open.value = true } }, 'open'),
          h(AppDialog, { open: open.value, title: 'Upload', onClose: () => { open.value = false } }, {
            default: () => [h('input', { id: 'hidden-file', type: 'file', style: 'display: none' }), h('button', { id: 'pick' }, 'pick')],
          }),
        ])
      },
    })
    wrapper = mount(Host, { attachTo: document.body, global: { mocks } })
    const opener = document.getElementById('opener')
    opener.focus()
    opener.click()
    await flushPromises()
    expect(document.activeElement.id).toBe('pick')
    document.querySelector('.dialog-close').focus()
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement.id).toBe('pick')
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    await settleFocus()
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

  it('嵌套对话框：Esc 只关闭最上层，下层保持打开', async () => {
    const closed = []
    const first = mount(AppDialog, { props: { open: true, title: 'Outer', onClose: () => closed.push('outer') }, attachTo: document.body, global: { mocks } })
    const second = mount(AppDialog, { props: { open: true, title: 'Inner', onClose: () => closed.push('inner') }, attachTo: document.body, global: { mocks } })
    await flushPromises()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(closed).toEqual(['inner'])

    second.unmount()
    first.unmount()
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
