// @vitest-environment happy-dom
import { afterEach, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AgentArmorView from '../components/AgentArmorView.vue'
import { PLAYBACK_PHONE_QUERY } from '../composables/usePlaybackPhoneForm.ts'
import { PLAYBACK_PORTRAIT_QUERY } from '../composables/usePlaybackPortraitViewport.ts'
import { SHELL_CHROME_KEY } from '../shared/shellChrome.js'

export function installHarness(mocks) {
  const shots = [
    { index: 6, time_s: 72, shooter_tank_name: 'Object 907', target_tank_name: 'E 100', shooter_name: 'Nickname', shooter_tank_id: 1, target_tank_id: 2, target_eid: 20, damage: 350, hit_flags: 0x10 },
    { index: 9, time_s: 95, shooter_tank_name: 'Object 907', target_tank_name: 'Maus', shooter_tank_id: 1, target_tank_id: 3, target_eid: 30, damage: 0, hit_flags: 0x8 },
  ]
  const mounted = []
  const scenes = []
  const restoredMedia = []
  const translate = (key, args) => args ? `${key} ${args.current}/${args.total}` : key

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }

  async function setup({ query = { view: 'agent-armor', shot: '6' }, shellChrome = null, phone = false, portrait = false } = {}) {
    // Component phone/orientation checks read matchMedia directly; happy-dom uses exact query stubs.
    const original = window.matchMedia
    window.matchMedia = (mediaQuery) => ({
      matches: (phone && mediaQuery === PLAYBACK_PHONE_QUERY) || (portrait && mediaQuery === PLAYBACK_PORTRAIT_QUERY),
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    restoredMedia.push(() => { window.matchMedia = original })
    if (portrait) {
      const width = Object.getOwnPropertyDescriptor(window, 'innerWidth')
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
      restoredMedia.push(() => {
        if (width) Object.defineProperty(window, 'innerWidth', width)
        else delete window.innerWidth
      })
    }

    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push({ query })
    const wrapper = mount(AgentArmorView, {
      global: {
        plugins: [router],
        mocks: { $t: translate },
        ...(shellChrome ? { provide: { [SHELL_CHROME_KEY]: shellChrome } } : {}),
        stubs: { Scene3DStatus: { name: 'Scene3DStatus', props: ['mode', 'message'], template: '<div data-testid="status" :data-mode="mode">{{ message }}</div>' } },
      },
    })
    mounted.push(wrapper)
    await flushPromises()
    return { wrapper, router }
  }

  beforeEach(() => {
    mocks.init.mockReset()
    mocks.fetch.mockReset()
    mocks.query.mockReset()
    scenes.length = 0
    mocks.tank.mockReset().mockResolvedValue({ nation: 'germany' })
    mocks.devices.mockReset().mockResolvedValue({ devicePresets: { defaultPreset: [] } })
    mocks.modules.mockReset().mockResolvedValue({ tanks: {} })
    mocks.fetch.mockResolvedValue({ shots })
    mocks.query.mockImplementation(async shot => ({ view: 'agent-armor', shot: String(shot.index), tank: String(shot.target_tank_id) }))
    mocks.init.mockImplementation(options => {
      const scene = { destroy: vi.fn(), setDistance: vi.fn(), options, setPitchDeviceBonus: vi.fn(), setPitchDeviceAvailable: vi.fn(), setEquipmentOverride: vi.fn() }
      scenes.push(scene)
      options.onLoadState({ state: 'ready' })
      return scene
    })
  })

  afterEach(() => {
    mounted.forEach(wrapper => wrapper.unmount())
    mounted.length = 0
    restoredMedia.forEach(restore => restore())
    restoredMedia.length = 0
    mocks.coarse.value = false
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  return { deferred, restoredMedia, scenes, setup, shots }
}
