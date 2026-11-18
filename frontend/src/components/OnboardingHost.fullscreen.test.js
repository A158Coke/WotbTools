// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { messages } from '../locales/messages.js'
import { createOnboardingHostTestHarness } from '../test/OnboardingHostTestHelpers.js'

let wrappers = []
const { button, controller, render, settle } = createOnboardingHostTestHarness({
  getWrappers: () => wrappers,
  setWrappers: (next) => { wrappers = next },
})

describe('OnboardingHost', () => {
  it('uses an explicit localized fullscreen exit before changing capabilities in either direction', async () => {
    for (const [direction, node] of [['next', 4], ['back', 5]]) {
      const fullscreen = document.createElement('div')
      document.body.append(fullscreen)
      let active = fullscreen
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active })
      const exit = vi.fn(async () => {
        active = null
        document.dispatchEvent(new Event('fullscreenchange'))
      })
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
      const guide = controller('tour')
      guide.index.value = node
      const wrapper = render(guide, 'ru')
      await settle()
      const action = document.querySelector(`[data-testid="onboarding-${direction}"]`)
      expect(action.textContent).toContain(messages.ru.onboarding[direction === 'next' ? 'exitFullscreenNext' : 'exitFullscreenBack'])
      action.click()
      await flushPromises()
      expect(exit).toHaveBeenCalledTimes(1)
      expect(guide[direction]).toHaveBeenCalledTimes(1)
      wrapper.unmount()
      wrappers = wrappers.filter(value => value !== wrapper)
      fullscreen.remove()
    }
  })

  it('discards a fullscreen exit continuation after the guide is interrupted or its stage changes', async () => {
    const fullscreen = document.createElement('div')
    document.body.append(fullscreen)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    let finish
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: vi.fn(() => new Promise(resolve => { finish = resolve })) })
    const guide = controller('tour')
    guide.index.value = 4
    render(guide)
    await settle()
    document.querySelector('[data-testid="onboarding-next"]').click()
    guide.mode.value = 'idle'
    finish()
    await flushPromises()
    expect(guide.next).not.toHaveBeenCalled()
  })

  it('does not publish an old fullscreen exit error into a later teaching stage', async () => {
    const fullscreen = document.createElement('div')
    document.body.append(fullscreen)
    button('playback-declutter', fullscreen)
    button('replay3d-start', fullscreen)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    let fail
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: vi.fn(() => new Promise((_, reject) => { fail = reject })) })
    const guide = controller('tour')
    guide.index.value = 4
    render(guide)
    await settle()
    document.querySelector('[data-testid="onboarding-next"]').click()
    guide.index.value = 5
    fail(new Error('old request'))
    await settle()
    expect(document.querySelector('[data-testid="onboarding-card"]').textContent).not.toContain(messages.zh.onboarding.exitFullscreenFailed)
    expect(guide.next).not.toHaveBeenCalled()
  })

  it('places dialogs and spotlight inside the current fullscreen element', async () => {
    const fullscreen = document.createElement('div')
    document.body.append(fullscreen)
    button('workspace-demo', fullscreen)
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen })
    const guide = controller('tour')
    render(guide)
    await settle()
    expect(fullscreen.querySelector('[data-testid="onboarding-host"]')).not.toBeNull()
    guide.mode.value = 'welcome'
    await settle()
    expect(fullscreen.querySelector('[data-testid="onboarding-welcome"]')).not.toBeNull()
  })
})
