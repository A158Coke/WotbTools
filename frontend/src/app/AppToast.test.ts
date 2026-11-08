// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

vi.mock('../composables/useHaptics.js', () => ({ haptic: async () => {} }))
vi.mock('../composables/useSound.js', () => ({ playSound: () => false }))

import AppToast from './AppToast.vue'
import { __resetToastsForTest, showToast } from '../composables/useToast.js'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'

const immersive = ref(false)
function mountToasts() {
  return mount(AppToast, {
    global: {
      mocks: { $t: (key: string) => key },
      provide: { [SHELL_CHROME_KEY]: { immersive, request() {}, navHosted: ref(false), hostNav() {} } },
    },
  })
}

afterEach(() => { __resetToastsForTest(); immersive.value = false })

describe('AppToast', () => {
  it('成功 / 提示是 role=status，警告 / 错误是 role=alert；错误带下一步操作', async () => {
    const retry = vi.fn()
    const wrapper = mountToasts()
    showToast({ tone: 'success', title: 'done' })
    showToast({ tone: 'error', title: 'failed', action: { label: 'Retry', run: retry } })
    await nextTick()
    expect(wrapper.get('[data-testid="toast-success"]').attributes('role')).toBe('status')
    expect(wrapper.get('[data-testid="toast-error"]').attributes('role')).toBe('alert')
    await wrapper.get('[data-testid="toast-action"]').trigger('click')
    expect(retry).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="toast-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('i18n key 由组件翻译；关闭按钮移除这一条', async () => {
    const wrapper = mountToasts()
    showToast({ tone: 'warning', titleKey: 'connectivity.title', messageKey: 'connectivity.body' })
    await nextTick()
    expect(wrapper.text()).toContain('connectivity.title')
    await wrapper.get('[data-testid="toast-close"]').trigger('click')
    expect(wrapper.find('[data-testid="toast-warning"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('横屏沉浸时成功 / 提示不叠在场景上，警告 / 错误照常显示', async () => {
    immersive.value = true
    const wrapper = mountToasts()
    showToast({ tone: 'success', title: 'parsed' })
    showToast({ tone: 'error', title: 'failed' })
    await nextTick()
    expect(wrapper.find('[data-testid="toast-success"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="toast-error"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
