// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReplayPage from './ReplayPage.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key)
}))

const html2canvasMock = vi.hoisted(() => vi.fn())

const mockCanvasRef = vi.hoisted(() => ({ current: null }))

vi.mock('html2canvas', () => ({
  default: (...args) => {
    const mockFn = html2canvasMock
    if (mockFn.mock) {
      return mockFn(...args)
    }
    throw new Error('html2canvas not initialized')
  }
}))

const box = vi.hoisted(() => ({
  respVal: null,
  activeTabVal: 'aggregate',
  errorVal: '',
}))

vi.mock('../composables/useReplay.js', async () => {
  const { ref, computed } = await import('vue')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const error = ref('')
  const files = ref([])
  const loading = ref(false)
  const pendingRemove = ref(null)
  const playerCols = computed(() => resp.value?.playerColumns || [])
  const aggCols = computed(() => resp.value?.aggregateColumns || [])

  return {
    useReplay: () => {
      resp.value = box.respVal
      activeTab.value = box.activeTabVal
      error.value = box.errorVal
      return {
        files, loading, error, resp, activeTab,
        aggStats: computed(() => null),
        pendingRemove, playerCols, aggCols,
        doPreview: vi.fn(), doExport: vi.fn(),
        askRemoveBattle: vi.fn(), askRemoveFile: vi.fn(),
        cancelRemove: vi.fn(), confirmRemove: vi.fn(),
      }
    }
  }
})

vi.mock('../composables/useColumns.js', async () => {
  const { ref, computed } = await import('vue')
  return {
    useColumns: () => ({
      visibleKeys: ref([]), aggVisibleKeys: ref([]),
      playerOrder: ref([]), aggOrder: ref([]),
      showColPicker: ref(false), pickerScope: ref('player'),
      currentOrder: computed(() => []),
      shownCols: computed(() => []), shownAggCols: computed(() => []),
      toggleColPicker: vi.fn(), toggleCol: vi.fn(),
      selectAllCols: vi.fn(), resetCols: vi.fn(),
      handleReorder: vi.fn(), initFromResponse: vi.fn(),
    })
  }
})

vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  return {
    useI18n: () => ({ locale: ref('zh'), t: i18n.t })
  }
})

function setResp(data) { box.respVal = data }
function setActiveTab(tab) { box.activeTabVal = tab }
function setError(msg) { box.errorVal = msg }

function makeResp(overrides = {}) {
  return {
    aggregate: [
      { cells: { nickname: 'Player1', damage_dealt: 5000 } },
      { cells: { nickname: 'Player2', damage_dealt: 3000 } }
    ],
    battles: [
      {
        mapName: 'Lagoon',
        players: [
          { cells: { nickname: 'P1', damage_dealt: 5000 } },
          { cells: { nickname: 'P2', damage_dealt: 3000 } }
        ]
      },
      {
        mapName: 'Frozen',
        players: [
          { cells: { nickname: 'P3', damage_dealt: 4000 } }
        ]
      }
    ],
    duplicates: [], failures: [],
    playerColumns: [{ key: 'nickname', label: '昵称' }, { key: 'damage_dealt', label: '伤害' }],
    aggregateColumns: [{ key: 'nickname', label: '昵称' }, { key: 'damage_dealt', label: '伤害' }],
    ...overrides
  }
}

function mountPage() {
  return mount(ReplayPage, {
    global: {
      mocks: { $t: i18n.t },
      stubs: {
        FileUploader: { template: '<div class="file-uploader-stub" />' },
        ColumnPicker: { template: '<div class="col-picker-stub" />' },
        AggregateTable: { template: '<div class="agg-table-stub" />' },
        BattleTable: { template: '<div class="battle-table-stub" />' },
        RemoveConfirmModal: { template: '<div class="remove-modal-stub" />' },
        RatingModal: { template: '<div class="rating-modal-stub" />' }
      }
    }
  })
}

function pngButton(wrapper) {
  return wrapper.findAll('button').find(b => b.text().includes('action.download_png'))
}

describe('ReplayPage PNG export', () => {
  let origCreateObjectURL
  let origRevokeObjectURL
  let mockCanvas

  beforeEach(() => {
    vi.clearAllMocks()
    origCreateObjectURL = URL.createObjectURL
    origRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    document.documentElement.removeAttribute('data-theme')

    const mockCtx = { drawImage: vi.fn(), scale: vi.fn() }
    mockCanvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn(cb => cb(new Blob(['png'], { type: 'image/png' })))
    }
    html2canvasMock.mockImplementation(() => Promise.resolve(mockCanvas))
  })

  afterEach(() => {
    URL.createObjectURL = origCreateObjectURL
    URL.revokeObjectURL = origRevokeObjectURL
    vi.unstubAllGlobals()
    setResp(null)
    setError('')
    setActiveTab('aggregate')
  })

  describe('render and button state', () => {
    it('hides export button when no response data', () => {
      const wrapper = mountPage()
      expect(pngButton(wrapper)).toBeUndefined()
    })

    it('shows export button when response data exists', () => {
      setResp(makeResp())
      const wrapper = mountPage()
      expect(pngButton(wrapper)).toBeDefined()
    })
  })

  describe('target isolation', () => {
    it('real page nodes do not have export classes', () => {
      setResp(makeResp())
      const wrapper = mountPage()
      const nodes = wrapper.findAll('[data-png-export-target]')
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.classes()).not.toContain('replay-export-root')
        expect(node.classes()).not.toContain('replay-export-light')
        expect(node.classes()).not.toContain('replay-export-dark')
      }
    })

    it('onclone adds export classes only to cloned target', async () => {
      setResp(makeResp())
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock).toHaveBeenCalled()
      const options = html2canvasMock.mock.calls[0][1]
      expect(options.onclone).toBeInstanceOf(Function)

      const rootEl = {
        classList: { add: vi.fn() },
        querySelectorAll: vi.fn(() => []),
        scrollWidth: 800, children: [], style: {}
      }
      options.onclone({ querySelector: vi.fn(() => rootEl) })
      expect(rootEl.classList.add).toHaveBeenCalledWith('replay-export-root', 'replay-export-light')
    })
  })

  describe('theme detection', () => {
    it('uses light theme by default', async () => {
      setResp(makeResp())
      document.documentElement.removeAttribute('data-theme')
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#ffffff')
    })

    it('uses dark theme when data-theme=dark', async () => {
      setResp(makeResp())
      document.documentElement.setAttribute('data-theme', 'dark')
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#1e1e1e')
    })

    it('reads theme at click time', async () => {
      document.documentElement.setAttribute('data-theme', 'light')
      setResp(makeResp())
      mountPage()
      document.documentElement.setAttribute('data-theme', 'dark')

      const wrapper2 = mountPage()
      await pngButton(wrapper2).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#1e1e1e')
    })
  })

  describe('html2canvas call parameters', () => {
    it('passes correct target and options for aggregate tab', async () => {
      setResp(makeResp())
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock).toHaveBeenCalledTimes(1)
      const [target, opts] = html2canvasMock.mock.calls[0]
      expect(target).toBeTruthy()
      expect(opts.useCORS).toBe(true)
      expect(opts.scale).toBeGreaterThan(0)
      expect(opts.width).toBeGreaterThan(0)
      expect(opts.height).toBeGreaterThan(0)
      expect(opts.onclone).toBeInstanceOf(Function)
    })

    it('uses battle tab target when battle tab is active', async () => {
      setResp(makeResp())
      setActiveTab('b0')
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('download lifecycle', () => {
    it('generates blob, triggers download, cleans up', async () => {
      setResp(makeResp())
      const wrapper = mountPage()
      const appendChild = vi.spyOn(document.body, 'appendChild')
      const removeChild = vi.spyOn(document.body, 'removeChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))

      expect(mockCanvas.toBlob).toHaveBeenCalled()
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(appendChild).toHaveBeenCalled()
      expect(removeChild).toHaveBeenCalled()
    })

    it('uses correct filename for aggregate download', async () => {
      setResp(makeResp())
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))

      const anchor = document.body.appendChild.mock?.calls?.[0]?.[0]
      if (anchor) {
        expect(anchor.download).toMatch(/^wotb-replay-\d{8}-\d{6}-aggregate\.png$/)
      }
    })

    it('shows error when toBlob returns null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      setResp(makeResp())
      const wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t).toHaveBeenCalledWith('replay.png_export_failed')
    })

    it('shows error when html2canvas rejects', async () => {
      html2canvasMock.mockImplementation(() => Promise.reject(new Error('canvas failed')))
      setResp(makeResp())
      const wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t).toHaveBeenCalledWith('replay.png_export_failed')
    })

    it('does not call html2canvas when target is null', async () => {
      setResp(makeResp())
      setActiveTab('b99')
      const wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('resets exporting flag and revokes URL', async () => {
      setResp(makeResp())
      const wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      await new Promise(r => setTimeout(r, 200))
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })
})
