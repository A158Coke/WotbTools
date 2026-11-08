// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import HoFReviewPane from './HoFReviewPane.vue'

const baseProps = {
  prefix: 'hundredAdmin' as const, title: 'T-62A', status: 'PENDING', statusLabel: 'pending', loading: false, phase: 'view',
  busy: false, message: '', compare: [], meta: [], screenshots: [], replays: [], evidenceLoading: false, evidenceError: '',
  evidenceComplete: true, checks: [], position: 1, total: 2, rejectReasons: {}, deleteReasons: {},
}

afterEach(() => { document.body.innerHTML = '' })

function setup(compact: boolean) {
  const app = document.createElement('div')
  app.id = 'app'
  const opener = document.createElement('button')
  app.append(opener)
  document.body.append(app)
  opener.focus()
  const wrapper = mount(HoFReviewPane, {
    attachTo: app,
    props: { ...baseProps, compact },
    global: { mocks: { $t: (key: string) => key } },
  })
  return { wrapper, app, opener }
}

describe('HoFReviewPane compact overlay', () => {
  it('窄屏覆盖层是模态的：焦点移入、背景 inert、Esc 关闭；卸载后焦点回到打开前的元素', async () => {
    const { wrapper, app, opener } = setup(true)
    await flushPromises()
    const pane = document.querySelector<HTMLElement>('[data-testid="hof-review-pane"]')!
    expect(pane.getAttribute('role')).toBe('dialog')
    expect(pane.contains(document.activeElement)).toBe(true)
    expect(app.inert).toBe(true)
    pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
    expect(app.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('大屏内联时不是模态，不改焦点也不设 inert', async () => {
    const { wrapper, app, opener } = setup(false)
    await flushPromises()
    expect(document.querySelector('[data-testid="hof-review-pane"]')!.getAttribute('role')).toBeNull()
    expect(app.inert).toBeFalsy()
    expect(document.activeElement).toBe(opener)
    wrapper.unmount()
  })
})
