// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import OnboardingHost from './OnboardingHost.vue'
import { ONBOARDING_GUIDES } from '../composables/useOnboarding.js'
import { messages } from '../locales/messages.js'
import { downloadBlob } from '../utils/exportReplayPng.js'

let wrappers = []
let originalFullscreen
let originalExitFullscreen
function controller(mode = 'idle') {
  const topic = ref('core'), index = ref(0), stageIndex = ref(0)
  const steps = computed(() => ONBOARDING_GUIDES[topic.value])
  return { mode: ref(mode), topic, index, stageIndex, steps, issue: ref(''), hasFiles: ref(false),
    hintVisible: ref(false), canResume: ref(false), resume: vi.fn(), dismissHint: vi.fn(),
    isSignedIn: ref(false),
    currentStage: computed(() => steps.value[index.value].stages[stageIndex.value]),
    begin: vi.fn(), next: vi.fn(), back: vi.fn(), skip: vi.fn(), retry: vi.fn(), interrupt: vi.fn(), start: vi.fn(), openDirectory: vi.fn(), useOwnReplay: vi.fn(), loginAiGuide: vi.fn(), reserveShotGuideSpace: vi.fn() }
}
function render(guide, locale = 'zh') {
  const wrapper = mount(OnboardingHost, { attachTo: document.body, props: { onboarding: guide },
    global: { plugins: [createI18n({ locale, fallbackLocale: 'en', messages })] } })
  wrappers.push(wrapper)
  return wrapper
}
async function settle() { await flushPromises(); await new Promise(resolve => setTimeout(resolve, 20)); await flushPromises() }
function button(anchor, parent = document.body) {
  const element = document.createElement('button')
  element.dataset.tour = anchor
  element.textContent = anchor
  parent.append(element)
  return element
}
beforeEach(() => {
  originalFullscreen = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
  originalExitFullscreen = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('onboarding-card')) return new DOMRect(0, 0, 360, 220)
    if (this.closest('.onboarding-card') && this.tagName === 'BUTTON') return new DOMRect(0, 0, 80, 44)
    if (this.matches('.dialog-scrim, [role="dialog"]')) return new DOMRect(100, 80, 600, 400)
    if (this.dataset.tour) return new DOMRect(180, 100, 200, 44)
    return new DOMRect()
  })
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: false, media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true } }))
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  document.body.innerHTML = ''
  document.body.className = ''
  delete document.body.dataset.dialogLockCount
  if (originalFullscreen) Object.defineProperty(document, 'fullscreenElement', originalFullscreen)
  else delete document.fullscreenElement
  if (originalExitFullscreen) Object.defineProperty(document, 'exitFullscreen', originalExitFullscreen)
  else delete document.exitFullscreen
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
    // #680 回归：导出菜单比触发按钮宽（右对齐、min-width 200），只避让按钮会让卡片压住菜单左半。
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
    // #669 回归：列面板与导出菜单都是可自行关闭的伴随层，引导不能吞掉 Esc 直接退出教程。
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

  it('lets the real export download activation through while blocking background clicks', async () => {
    // #680 回归：downloadBlob 在 body 上点击隐藏 anchor；引导的背景点击隔离不能取消这次程序化下载。
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

      // 普通背景点击仍然被教程拦截，不因下载放行而放宽隔离。
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
    // ARIA combobox 打开时焦点仍在 input 上：第一次 Escape 必须关 dropdown，教程保持当前步骤。
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

    // dropdown 关闭后，第二次 Escape 才回到教程。
    combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(guide.skip).toHaveBeenCalledTimes(1)
  })

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
