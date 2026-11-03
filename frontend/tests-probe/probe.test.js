// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { asyncView } from '../../src/app/viewRegistry.js'

vi.mock('../../src/shared/motion/motionPolicy', () => ({
  readMotionTokens: () => ({ slow: 0.3, fast: 0.15, base: 0.2, ease: [0.2, 0, 0, 1] }),
}))

describe('probe', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('probe retry', async () => {
    const Page = defineComponent({ setup: () => () => h('p', { 'data-testid': 'probe-page' }, 'c') })
    let attempt = 0
    let rejectFirst
    const firstP = new Promise((res, rej) => { rejectFirst = rej })
    const loader = vi.fn(() => { attempt++; return attempt === 1 ? firstP : Promise.resolve(Page) })
    const comp = asyncView(loader)
    const Host = defineComponent({ setup: () => () => h('div', { 'data-testid': 'host' }, [h(comp)]) })
    const wrapper = mount(Host, { global: { mocks: { $t: (k) => k } } })
    await vi.advanceTimersByTimeAsync(0); await nextTick()
    rejectFirst(new Error('x'))
    await vi.advanceTimersByTimeAsync(0); await nextTick()
    console.log('AFTER FAIL html:', wrapper.html())
    console.log('attempt after fail:', attempt)
    await wrapper.find('[data-testid="view-transition-retry"]').trigger('click')
    await vi.advanceTimersByTimeAsync(0); await nextTick(); await vi.advanceTimersByTimeAsync(0); await nextTick()
    console.log('AFTER RETRY html:', wrapper.html())
    console.log('loader calls:', loader.mock.calls.length, 'attempt:', attempt)
    expect(true).toBe(true)
  })
})
