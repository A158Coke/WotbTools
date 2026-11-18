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
  it('keeps guide keyboard shortcuts from controlling background panes while allowing real target keys', async () => {
    const target = button('workspace-demo')
    const background = vi.fn()
    document.addEventListener('keydown', background)
    const guide = controller('tour')
    render(guide)
    await settle()
    const card = document.querySelector('[data-testid="onboarding-card"]')
    for (const key of ['h', ' ', 'ArrowRight']) card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    expect(background).not.toHaveBeenCalled()
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(background).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', background)
  })

  it('lets mobile HoF filters open and operate their real companion sheet', async () => {
    const trigger = button('hof-filters')
    const guide = controller('tour')
    guide.topic.value = 'hof'
    guide.index.value = 1
    render(guide)
    await settle()
    trigger.addEventListener('click', () => {
      const sheet = document.createElement('div')
      sheet.dataset.tour = 'hof-filter-options'
      sheet.setAttribute('role', 'dialog')
      document.body.append(sheet)
      const field = document.createElement('select')
      field.dataset.tour = 'hof-filter-field'
      sheet.append(field)
      const done = button('filter-done', sheet)
      done.addEventListener('click', () => sheet.remove())
    })
    trigger.click()
    await settle()
    const field = document.querySelector('select')
    const change = vi.fn()
    field.addEventListener('pointerdown', change)
    field.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 4, bubbles: true, cancelable: true }))
    expect(change).toHaveBeenCalledTimes(1)
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(field)
    document.querySelector('[data-tour="filter-done"]').click()
    await settle()
    expect(document.querySelector('[data-tour="hof-filter-options"]')).toBeNull()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
  })

  it('suspends the tour for a real global dialog and resumes after it closes', async () => {
    button('workspace-demo')
    const guide = controller('tour')
    render(guide)
    await settle()
    const dialog = document.createElement('div')
    dialog.className = 'dialog-scrim'
    document.body.append(dialog)
    await settle()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(guide.skip).not.toHaveBeenCalled()
    dialog.remove()
    await settle()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
  })

  it('includes the active target modal and lets it own Escape before the guide', async () => {
    const modal = document.createElement('aside')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    const target = button('shot-open-viewer', modal)
    const close = button('close-inspector', modal)
    const escape = vi.fn()
    modal.addEventListener('keydown', escape)
    const guide = controller('tour')
    guide.topic.value = 'shots'
    guide.index.value = 1
    render(guide)
    await settle()
    close.focus()
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(escape).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
    target.click()
  })
  it('lets an allowed companion sheet close itself with Escape while the guide continues', async () => {
    button('playback-display')
    const sheet = document.createElement('div')
    sheet.setAttribute('role', 'dialog')
    sheet.dataset.tour = 'playback-display-options'
    document.body.append(sheet)
    const control = button('sheet-control', sheet)
    const ownEscape = vi.fn()
    sheet.addEventListener('keydown', ownEscape)
    const guide = controller('tour')
    guide.topic.value = 'playback'
    guide.index.value = 2
    render(guide)
    await settle()
    control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(ownEscape).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
  })

  it('keeps a continuation pointer locked if it arrives before the prior release animation frame', async () => {
    button('playback-declutter')
    const guide = controller('tour')
    guide.index.value = 4
    guide.issue.value = 'loading'
    render(guide)
    await settle()
    const frames = []
    vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
    const next = document.querySelector('[data-testid="onboarding-next"]')
    next.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, bubbles: true }))
    guide.issue.value = ''
    next.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, bubbles: true }))
    next.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 32, bubbles: true }))
    frames.shift()(0)
    await flushPromises()
    expect(document.querySelector('.onboarding-status').textContent).toContain(messages.zh.onboarding.loading)
    next.dispatchEvent(new PointerEvent('pointerup', { pointerId: 32, bubbles: true }))
    frames.shift()(0)
    await flushPromises()
    expect(document.querySelector('.onboarding-status')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('keeps loading content and Retry stable under a held Next until its native click', async () => {
    button('playback-declutter')
    const guide = controller('tour')
    guide.index.value = 4
    guide.issue.value = 'loading'
    render(guide)
    await settle()
    const next = document.querySelector('[data-testid="onboarding-next"]')
    next.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 27, pointerType: 'touch', bubbles: true }))
    guide.issue.value = ''
    await settle()
    expect(document.querySelector('.onboarding-status').textContent).toContain(messages.zh.onboarding.loading)
    next.dispatchEvent(new PointerEvent('pointerup', { pointerId: 27, pointerType: 'touch', bubbles: true }))
    next.click()
    expect(guide.next).toHaveBeenCalledTimes(1)
    await settle()
    expect(document.querySelector('.onboarding-status')).toBeNull()
  })

  it('admits every visible companion sharing the same stable anchor, including an opened filter sheet', async () => {
    button('tankopedia-search')
    const chips = button('tankopedia-filters')
    const sheet = document.createElement('div')
    sheet.dataset.tour = 'tankopedia-filters'
    sheet.setAttribute('role', 'dialog')
    document.body.append(sheet)
    const field = button('filter-value', sheet)
    const changed = vi.fn()
    chips.addEventListener('click', changed)
    field.addEventListener('click', changed)
    const guide = controller('tour')
    guide.topic.value = 'tankopedia'
    render(guide)
    await settle()
    chips.click()
    field.click()
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('admits the 3D camera workspace canvas and roster while blocking the external file area', async () => {
    button('replay3d-camera')
    const workspace = document.createElement('div')
    workspace.dataset.tour = 'replay3d-workspace'
    document.body.append(workspace)
    const canvas = document.createElement('canvas')
    workspace.append(canvas)
    const roster = button('roster-item', workspace)
    const files = button('workspace-file-controls')
    const pointer = vi.fn(), selection = vi.fn(), blocked = vi.fn()
    canvas.addEventListener('pointerdown', pointer)
    roster.addEventListener('click', selection)
    files.addEventListener('click', blocked)
    const guide = controller('tour')
    guide.topic.value = '3d'
    guide.stageIndex.value = 1
    render(guide)
    await settle()
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    roster.click()
    files.click()
    expect(pointer).toHaveBeenCalledTimes(1)
    expect(selection).toHaveBeenCalledTimes(1)
    expect(blocked).not.toHaveBeenCalled()
  })

  it('does not let host style mutations schedule a measurement loop after geometry settles', async () => {
    button('workspace-demo')
    const guide = controller('tour')
    render(guide)
    await settle()
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const count = geometry.mock.calls.length
    const card = document.querySelector('[data-testid="onboarding-card"]')
    card.style.setProperty('--test-only', '1')
    await settle()
    expect(geometry.mock.calls.length).toBe(count)
  })
})
