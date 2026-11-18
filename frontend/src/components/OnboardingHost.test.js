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
  it('offers only the official sample during a replay tutorial, even with a current file', async () => {
    const guide = controller('welcome')
    guide.hasFiles.value = true
    render(guide)
    await settle()
    expect(document.body.textContent).not.toContain('使用当前回放')
    document.querySelector('[data-testid="onboarding-begin"]').click()
    expect(guide.begin).toHaveBeenCalledWith()
  })
  it('makes the original own-replay picker the completion card primary action in all languages', async () => {
    for (const locale of ['zh', 'en', 'ru']) {
      const guide = controller('finish')
      const wrapper = render(guide, locale)
      await flushPromises()
      const primary = document.querySelector('[data-testid="onboarding-own-replay"]')
      expect(primary.classList.contains('is-primary')).toBe(true)
      expect(primary.textContent).toContain(messages[locale].onboarding.ownReplay)
      primary.click()
      expect(guide.useOwnReplay).toHaveBeenCalledTimes(1)
      expect(document.querySelector('[data-testid="onboarding-explore"]')).not.toBeNull()
      wrapper.unmount()
      wrappers = wrappers.filter(value => value !== wrapper)
    }
  })
  it('offers compact optional guides only after the core, with AI explicitly requiring login', async () => {
    const guide = controller('finish')
    render(guide)
    await flushPromises()
    expect(document.querySelectorAll('[data-testid="onboarding-follow-ups"] .onboarding-topic')).toHaveLength(5)
    const ai = document.querySelector('[data-testid="onboarding-follow-up-ai"]')
    expect(ai.textContent).toContain(messages.zh.onboarding.aiLoginRequired)
    ai.click()
    expect(guide.start).toHaveBeenCalledWith('ai')
    guide.topic.value = 'hof'
    await flushPromises()
    expect(document.querySelector('[data-testid="onboarding-follow-ups"]')).toBeNull()
  })
  it('offers login instead of starting an anonymous AI example tutorial', async () => {
    const guide = controller('welcome')
    guide.topic.value = 'ai'
    render(guide)
    await flushPromises()
    expect(document.querySelector('[data-testid="onboarding-begin"]')).toBeNull()
    document.querySelector('[data-testid="onboarding-ai-login"]').click()
    expect(guide.loginAiGuide).toHaveBeenCalledOnce()
    expect(guide.begin).not.toHaveBeenCalled()
  })
  it('identifies a core action inside its node without repeating an indistinguishable counter', async () => {
    const guide = controller('tour')
    guide.index.value = 3
    button('playback-annotation-entry')
    button('playback-annotation-tools')
    render(guide)
    await settle()
    expect(document.querySelector('.onboarding-progress').textContent).toContain('操作 1/2')
    guide.stageIndex.value = 1
    await settle()
    expect(document.querySelector('.onboarding-progress').textContent).toContain('操作 2/2')
  })
  it('exposes all ten function guides in all three languages, with the actual topic count', async () => {
    for (const locale of ['zh', 'en', 'ru']) {
      const guide = controller('directory')
      const wrapper = render(guide, locale)
      await flushPromises()
      expect(document.querySelectorAll('.onboarding-topic')).toHaveLength(10)
      const data = document.querySelector('[data-testid="onboarding-topic-data"]')
      expect(data.textContent).toContain('4')
      expect(wrapper.text()).not.toContain('onboarding.topics.')
      data.click()
      expect(guide.start).toHaveBeenCalledWith('data')
      wrapper.unmount()
      wrappers = wrappers.filter(value => value !== wrapper)
    }
  })

  it('keeps the real target clickable, blocks background clicks and traps Tab across target and guide', async () => {
    const target = button('workspace-demo')
    const outside = button('unrelated')
    const hit = vi.fn(), blocked = vi.fn()
    target.addEventListener('click', hit)
    outside.addEventListener('click', blocked)
    const guide = controller('tour')
    render(guide)
    await settle()
    expect(document.querySelector('[data-testid="onboarding-cutout"]')).not.toBeNull()
    target.click()
    outside.click()
    expect(hit).toHaveBeenCalledTimes(1)
    expect(blocked).not.toHaveBeenCalled()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(target)
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(document.querySelector('[data-testid="onboarding-skip"]'))
  })
  it('keeps Close at its pointerdown position while an asynchronous shot target appears', async () => {
    const guide = controller('tour')
    guide.index.value = 6
    guide.issue.value = 'loading'
    guide.skip.mockImplementation(() => { guide.mode.value = 'idle' })
    render(guide)
    await settle()
    const card = document.querySelector('[data-testid="onboarding-card"]')
    const close = document.querySelector('[data-testid="onboarding-skip"]')
    const before = card.getAttribute('style')
    close.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 17, pointerType: 'touch', bubbles: true }))
    guide.issue.value = ''
    button('shots-first-shot')
    await settle()
    expect(card.getAttribute('style')).toBe(before)
    close.dispatchEvent(new PointerEvent('pointerup', { pointerId: 17, pointerType: 'touch', bubbles: true }))
    expect(card.getAttribute('style')).toBe(before)
    close.click()
    await settle()
    expect(guide.skip).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="onboarding-layer"]')).toBeNull()
  })

  it('releases deferred geometry after a canceled card pointer without activating a button', async () => {
    const guide = controller('tour')
    guide.index.value = 6
    render(guide)
    await settle()
    const card = document.querySelector('[data-testid="onboarding-card"]')
    const close = document.querySelector('[data-testid="onboarding-skip"]')
    const before = card.getAttribute('style')
    close.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 19, pointerType: 'touch', bubbles: true }))
    button('shots-first-shot')
    await settle()
    expect(card.getAttribute('style')).toBe(before)
    close.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 19, pointerType: 'touch', bubbles: true }))
    await settle()
    expect(card.getAttribute('style')).not.toBe(before)
    expect(guide.skip).not.toHaveBeenCalled()
  })

  it('leaves Next available for missing/failed targets and restores focus on exit', async () => {
    const opener = button('opener')
    opener.focus()
    const guide = controller()
    render(guide)
    guide.mode.value = 'tour'
    guide.issue.value = 'unavailable'
    await settle()
    expect(document.querySelector('[data-testid="onboarding-cutout"]')).toBeNull()
    const next = document.querySelector('[data-testid="onboarding-next"]')
    expect(next.disabled).toBe(false)
    next.click()
    expect(guide.next).toHaveBeenCalledTimes(1)
    guide.mode.value = 'idle'
    await settle()
    expect(document.activeElement).toBe(opener)
    opener.click()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).toBeNull()
  })
  it('admits the actual map drawing pipeline only when the annotation stage requests it', async () => {
    button('playback-annotation-tools')
    const map = button('playback-map')
    const drawing = vi.fn()
    map.addEventListener('pointerdown', drawing)
    const guide = controller('tour')
    guide.index.value = 3
    guide.stageIndex.value = 1
    render(guide)
    await settle()
    map.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(drawing).toHaveBeenCalledTimes(1)
    guide.index.value = 4
    guide.stageIndex.value = 0
    await settle()
    map.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(drawing).toHaveBeenCalledTimes(1)
  })
})
