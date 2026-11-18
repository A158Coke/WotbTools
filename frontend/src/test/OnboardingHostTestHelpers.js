import { afterEach, beforeEach, vi } from 'vitest'
import { computed, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import OnboardingHost from '../components/OnboardingHost.vue'
import { ONBOARDING_GUIDES } from '../composables/useOnboarding.js'
import { messages } from '../locales/messages.js'

/** Register a fresh onboarding harness and DOM cleanup for one test file. */
export function createOnboardingHostTestHarness({ getWrappers, setWrappers }) {
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
    setWrappers([...getWrappers(), wrapper])
    return wrapper
  }

  async function settle() {
    await flushPromises()
    await new Promise(resolve => setTimeout(resolve, 20))
    await flushPromises()
  }

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
    for (const wrapper of getWrappers()) wrapper.unmount()
    setWrappers([])
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

  return { button, controller, render, settle }
}
