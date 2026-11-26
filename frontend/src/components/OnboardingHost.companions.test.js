// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { downloadBlob } from '../utils/exportReplayPng.js'
import { createOnboardingHostTestHarness } from '../test/OnboardingHostTestHelpers.js'

let wrappers = []
const { button, controller, render, settle } = createOnboardingHostTestHarness({
  getWrappers: () => wrappers,
  setWrappers: (next) => { wrappers = next },
})

describe('OnboardingHost', () => {
  it('includes a real sibling menu connected by aria-controls in pointer and focus scope', async () => {
    const trigger = button('data-export')
    trigger.setAttribute('aria-controls', 'real-export-menu')
    const menu = document.createElement('div')
    menu.id = 'real-export-menu'
    menu.setAttribute('role', 'menu')
    menu.dataset.tour = 'menu-options'
    document.body.append(menu)
    const option = button('export-choice', menu)
    const download = vi.fn()
    option.addEventListener('click', download)
    const guide = controller('tour')
    guide.topic.value = 'data'
    guide.index.value = 3
    render(guide)
    await settle()
    option.click()
    expect(download).toHaveBeenCalledTimes(1)
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(option)
  })

  it('keeps the card clear of a companion menu opened by the real anchor', async () => {
    const trigger = button('data-export')
    trigger.setAttribute('aria-controls', 'real-export-menu')
    trigger.getBoundingClientRect = () => new DOMRect(900, 100, 100, 48)
    const menu = document.createElement('div')
    menu.id = 'real-export-menu'
    menu.setAttribute('role', 'menu')
    menu.getBoundingClientRect = () => new DOMRect(800, 160, 200, 120)
    document.body.append(menu)
    const guide = controller('tour')
    guide.topic.value = 'data'
    guide.index.value = 3
    render(guide)
    await settle()
    const card = document.querySelector('[data-testid="onboarding-card"]')
    const cardRect = { left: parseFloat(card.style.left), top: parseFloat(card.style.top), width: parseFloat(card.style.width), height: 220 }
    const menuRect = menu.getBoundingClientRect()
    const overlaps = cardRect.left < menuRect.right && cardRect.left + cardRect.width > menuRect.left
      && cardRect.top < menuRect.bottom && cardRect.top + cardRect.height > menuRect.top
    expect(overlaps).toBe(false)
  })

  it('lets an opened column panel and export menu own Escape while the guide keeps its step', async () => {
    const panelTrigger = button('data-columns')
    const panel = document.createElement('div')
    panel.setAttribute('role', 'dialog')
    panel.dataset.tour = 'data-column-options'
    document.body.append(panel)
    const option = button('column-toggle', panel)
    const closePanel = vi.fn(() => panel.remove())
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel() })
    const guide = controller('tour')
    guide.topic.value = 'data'
    guide.index.value = 2
    render(guide)
    await settle()
    option.focus()
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closePanel).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()

    panelTrigger.remove()
    guide.index.value = 3
    const menuTrigger = button('data-export')
    menuTrigger.setAttribute('aria-controls', 'real-export-menu')
    const menu = document.createElement('div')
    menu.id = 'real-export-menu'
    menu.setAttribute('role', 'menu')
    menu.getBoundingClientRect = () => new DOMRect(800, 160, 200, 120)
    document.body.append(menu)
    const item = button('export-choice', menu)
    const closeMenu = vi.fn(() => menu.remove())
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu() })
    await settle()
    item.focus()
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closeMenu).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
  })

  it('lets the auto-opened Display own the first Escape on the declutter step', async () => {
    const panel = document.createElement('section')
    panel.setAttribute('role', 'dialog')
    panel.dataset.tour = 'playback-display-options'
    document.body.append(panel)
    button('playback-declutter', panel)
    const close = button('display-close', panel)
    const closePanel = vi.fn(() => panel.remove())
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel() })
    const guide = controller('tour')
    guide.topic.value = 'core'
    guide.index.value = 4
    expect(guide.currentStage.value.anchor).toBe('playback-declutter')
    render(guide)
    await settle()
    close.focus()
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closePanel).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()
  })

  it('lets the real export download activation through while blocking background clicks', async () => {
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    const activations = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      this.dispatchEvent(event)
      activations.push({ filename: this.getAttribute('download'), marked: this.hasAttribute('data-app-download'), prevented: event.defaultPrevented })
    })
    try {
      const trigger = button('data-export')
      trigger.setAttribute('aria-controls', 'real-export-menu')
      const menu = document.createElement('div')
      menu.id = 'real-export-menu'
      menu.setAttribute('role', 'menu')
      menu.getBoundingClientRect = () => new DOMRect(800, 160, 200, 120)
      document.body.append(menu)
      const downloads = []
      for (const [anchor, filename] of [['export-aggregate', 'summary.xlsx'], ['export-png', 'view.png']]) {
        button(anchor, menu).addEventListener('click', () => { downloads.push(downloadBlob(new Blob(['x']), filename)) })
      }
      const guide = controller('tour')
      guide.topic.value = 'data'
      guide.index.value = 3
      render(guide)
      await settle()
      document.querySelector('[data-tour="export-aggregate"]').click()
      document.querySelector('[data-tour="export-png"]').click()
      await Promise.all(downloads)
      expect(activations).toEqual([
        { filename: 'summary.xlsx', marked: true, prevented: false },
        { filename: 'view.png', marked: true, prevented: false },
      ])
      expect(guide.skip).not.toHaveBeenCalled()

      const background = document.createElement('button')
      document.body.append(background)
      const backgroundClick = vi.fn()
      background.addEventListener('click', backgroundClick)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      background.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(backgroundClick).not.toHaveBeenCalled()
    } finally {
      clickSpy.mockRestore()
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('lets an expanded combobox close its own popup before the guide exits', async () => {
    const anchor = document.createElement('div')
    anchor.dataset.tour = 'data-export'
    document.body.append(anchor)
    const combobox = document.createElement('input')
    combobox.setAttribute('role', 'combobox')
    combobox.setAttribute('aria-expanded', 'true')
    combobox.setAttribute('aria-controls', 'vehicle-options')
    anchor.append(combobox)
    const listbox = document.createElement('div')
    listbox.id = 'vehicle-options'
    listbox.setAttribute('role', 'listbox')
    listbox.getBoundingClientRect = () => new DOMRect(100, 200, 200, 160)
    document.body.append(listbox)
    const closePopup = vi.fn(() => {
      listbox.remove()
      combobox.setAttribute('aria-expanded', 'false')
    })
    combobox.addEventListener('keydown', event => { if (event.key === 'Escape') closePopup() })
    const guide = controller('tour')
    guide.topic.value = 'data'
    guide.index.value = 3
    render(guide)
    await settle()
    combobox.focus()
    combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closePopup).toHaveBeenCalledTimes(1)
    expect(guide.skip).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="onboarding-layer"]')).not.toBeNull()

    combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(guide.skip).toHaveBeenCalledTimes(1)
  })
})
