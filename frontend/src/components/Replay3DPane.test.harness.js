// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, shallowReactive } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'
import zh from '../locales/zh.json'
import en from '../locales/en.json'
import ru from '../locales/ru.json'

export const here = dirname(fileURLToPath(import.meta.url))
let Replay3DPane

const canonical = vi.hoisted(() => ({ load: vi.fn(), portrait: vi.fn() }))
vi.mock('../platform/screenForm.js', () => ({ forcedLandscapeDevice: async () => 'android-phone-app' }))
vi.mock('../vehicle-portraits/runtime.js', () => ({ loadVehiclePortrait: canonical.portrait }))
const playback = vi.hoisted(() => ({ api: null, init: null, apis: [] }))
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

vi.mock('../scene/playbackScene.js', () => {
  playback.init = vi.fn((container, store, _labelOverlay, options = {}) => {
    store.contactShadows = options.contactShadowOverride === true
    let generation = 0
    const api = {
      store,
      loadData: vi.fn(async (source) => {
        const current = ++generation
        store.hasData = false
        store.loading = true
        const result = source.session ? await source.session.loadScene(source.file) : null
        if (current !== generation) return
        store.playbackSession = source.session?.getState(source.file) ?? null
        store.loading = false
        store.hasData = true
      }),
      destroy: vi.fn(() => {
        store.hasData = false
        store.loading = false
      }),
      reset: vi.fn(() => {
        generation++
        store.playbackSession = null
        store.hasData = false
        store.loading = false
        store.assetStage = false
        store.err = ''
      }),
      setPlaying: vi.fn(),
      setBattleClock: vi.fn((clock) => { if (clock) store.startTime = clock.startRaw }),
      seekBy: vi.fn(),
      setSpeed: vi.fn(),
      seekTime: vi.fn(),
      setCam: vi.fn(),
      setFollow: vi.fn(),
      setFlySpeed: vi.fn(),
      setGlb: vi.fn(),
      setLabelPrefs: vi.fn(),
      setBattleMarkers: vi.fn(),
      setQuality: vi.fn(),
      setContactShadows: vi.fn((on) => { store.contactShadows = !!on }),
      applyRenderSettings: vi.fn(),
      setArmorHighlight: vi.fn((on) => { store.armorHighlight = !!on }),
      setPaused: vi.fn(),
      setAnnotations: vi.fn(),
      setAnnotationInteraction: vi.fn(),
      setAnnotationsVisible: vi.fn(),
    }
    playback.api = api
    playback.apis.push(api)
    return api
  })
  return { initPlayback: playback.init, QUALITY_PRESETS: { low: { label: 'Low' }, mid: { label: 'Mid' }, high: { label: 'High' }, ultra: { label: 'Ultra' } } }
})
vi.mock('../scene/assetProvider.js', () => ({ assetProvider: { configured: () => true } }))
const layout = vi.hoisted(() => ({ compact: false, portrait: false }))
export const fullscreenCalls = { request: 0 }
vi.mock('../composables/useBreakpoint.js', async () => {
  const { computed } = await import('vue')
  return {
    usePointer: () => ({ coarse: computed(() => false) }),
    useBreakpoint: () => ({
      tier: computed(() => (layout.compact ? 'compact' : 'expanded')),
      isCompact: computed(() => layout.compact),
      isExpanded: computed(() => !layout.compact),
    }),
  }
})
vi.mock('../composables/usePlaybackPhoneForm.ts', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPhoneForm: () => ({ isPhone: computed(() => layout.compact) }) }
})
vi.mock('../composables/usePlaybackPortraitViewport.ts', async () => {
  const { computed } = await import('vue')
  return { usePlaybackPortraitViewport: () => ({ isPortrait: computed(() => layout.portrait) }) }
})
vi.mock('../composables/useUiProfile.js', async () => {
  const { ref } = await import('vue')
  return { uiProfile: ref('summer'), useUiProfile: () => ({ uiProfile: ref('summer') }) }
})
export const translate = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('zh'), t: translate, te: () => false }),
}))

export function mockWebGL(level) {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (name) {
    return level === 'webgl2' && name === 'webgl2' ? { getExtension: () => ({ loseContext() {} }) } : null
  })
}

export const mkFile = (name) => new File(['x'], name)

export async function flush() {
  await nextTick()
  await nextTick()
}

export async function start(wrapper) {
  await wrapper.get('[data-test="replay3d-start"]').trigger('click')
  await flush()
}

export async function openDetailsViaScene(eid) {
  const onVehicleSelect = playback.init.mock.calls.at(-1)[3].onVehicleSelect
  onVehicleSelect(eid)
  await flush()
}

export function mountPane(props = {}) {
  const states = new WeakMap()
  const getState = file => {
    if (!states.has(file)) states.set(file, shallowReactive({ canonical: null, sceneState: 'idle' }))
    return states.get(file)
  }
  const playbackSession = {
    getState,
    loadScene: async file => {
      getState(file).canonical = await canonical.load(file)
      getState(file).sceneState = 'ready'
      return {}
    },
  }
  return mount(Replay3DPane, {
    props: { file: mkFile('battle.wotbreplay'), active: true, playbackSession, ...props },
    global: { mocks: { $t: translate } },
  })
}

export const testState = { canonical, playback, layout, connectivityState }

export function paneComponent() { return Replay3DPane }

export function installPaneTestLifecycle() {
  beforeEach(async () => {

    canonical.load.mockReset().mockResolvedValue({ dataset: null, reloadTelemetry: null })
    canonical.portrait.mockReset().mockResolvedValue(null)
    layout.compact = false
    layout.portrait = false
    playback.api = null
    playback.apis.length = 0
    playback.init?.mockClear()
    localStorage.clear()
    vi.resetModules()
    Replay3DPane = (await import('./Replay3DPane.vue')).default
    if (connectivityState.state) connectivityState.state.value = 'online'

  })
  afterEach(() => {

    vi.restoreAllMocks()
    document.body.innerHTML = ''

  })
}

export { nextTick, ref, shallowReactive } from 'vue'
export { mount } from '@vue/test-utils'
export { readFileSync } from 'node:fs'
export { fileURLToPath } from 'node:url'
export { dirname, resolve } from 'node:path'
export { makeBattlePlaybackDataset } from '../test/playbackV2TestUtil.js'
export { default as zh } from '../locales/zh.json'
export { default as en } from '../locales/en.json'
export { default as ru } from '../locales/ru.json'
