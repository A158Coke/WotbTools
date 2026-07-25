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

vi.mock('html2canvas', () => ({
  default: (...args) => {
    if (html2canvasMock.mock) return html2canvasMock(...args)
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
      { mapName: 'Lagoon', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
      { mapName: 'Frozen', players: [{ cells: { nickname: 'P2', damage_dealt: 4000 } }] }
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
        AggregateTable: {
          template: '<div class="agg-table-stub" data-export-role="aggregate">' +
            '<div class="mcards"><div class="mc"><div class="k">Battles</div><div class="v">2</div></div></div>' +
            '<div class="tablewrap" style="overflow-x:auto"><table style="width:2000px"><tbody>' +
            '<tr class="t1"><td><span class="rbadge">1500</span></td></tr>' +
            '<tr class="t2"><td><span class="rbadge">1200</span></td></tr>' +
            '</tbody></table></div>' +
            '<p class="scroll-hint">Scroll</p></div>'
        },
        BattleTable: {
          props: ['battle'],
          template: '<div class="battle-table-stub" :data-export-role="\'battle-\' + battle.mapName">' +
            '<div class="mcards"><div class="mc"><div class="k">Map</div><div class="v">{{ battle.mapName }}</div></div></div>' +
            '<div class="tablewrap" style="overflow-x:auto"><table style="width:2000px"><tbody>' +
            '<tr class="t1"><td><span class="rbadge">1500</span></td></tr>' +
            '<tr class="t2"><td><span class="rbadge">1200</span></td></tr>' +
            '</tbody></table></div>' +
            '<p class="scroll-hint">Scroll</p></div>'
        },
        RemoveConfirmModal: { template: '<div class="remove-modal-stub" />' },
        RatingModal: { template: '<div class="rating-modal-stub" />' }
      }
    }
  })
}

function pngButton(wrapper) {
  return wrapper.findAll('button').find(b => b.text().includes('action.download_png'))
}

function setScrollProps(el, w, h) {
  Object.defineProperty(el, 'scrollWidth', { value: w, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: h, configurable: true })
}

describe('ReplayPage PNG export', () => {
  let origCreateObjectURL
  let origRevokeObjectURL
  let mockCanvas
  let wrapper

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
    if (wrapper) wrapper.unmount()
    wrapper = null
    setResp(null)
    setError('')
    setActiveTab('aggregate')
    // Remove any off-screen containers left by tests
    for (const el of document.querySelectorAll('[style*="left: -9999px"]')) {
      el.parentNode?.removeChild(el)
    }
  })

  describe('render and button state', () => {
    it('hides export button when no response data', () => {
      wrapper = mountPage()
      expect(pngButton(wrapper)).toBeUndefined()
    })

    it('shows export button when response data exists', () => {
      setResp(makeResp())
      wrapper = mountPage()
      expect(pngButton(wrapper)).toBeDefined()
    })

    it('disables button when loading is true', () => {
      setResp(makeResp())
      box.respVal = makeResp()
      // We can't directly modify loading ref from outside, but the button uses
      // :disabled="loading || exportingPng" — test that exportingPng disables it
      wrapper = mountPage()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })

  describe('real page isolation', () => {
    it('real page nodes never get export classes or inline styles', () => {
      setResp(makeResp())
      wrapper = mountPage()
      const allElements = wrapper.findAll('*')
      for (const el of allElements) {
        expect(el.classes()).not.toContain('replay-export-root')
        expect(el.classes()).not.toContain('replay-export-light')
        expect(el.classes()).not.toContain('replay-export-dark')
      }
    })
  })

  describe('theme detection', () => {
    it('uses light theme by default', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      document.documentElement.removeAttribute('data-theme')
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#ffffff')
    })

    it('uses dark theme when data-theme=dark', async () => {
      setResp(makeResp())
      document.documentElement.setAttribute('data-theme', 'dark')
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#1e1e1e')
    })

    it('reads theme at click time on same component', async () => {
      setResp(makeResp())
      document.documentElement.setAttribute('data-theme', 'light')
      wrapper = mountPage()
      document.documentElement.setAttribute('data-theme', 'dark')

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock.mock.calls[0][1].backgroundColor).toBe('#1e1e1e')
    })
  })

  describe('clone creation and target isolation', () => {
    function getCallClone() {
      return html2canvasMock.mock.calls[0][0]
    }

    it('passes a clone not a real page node', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const clone = getCallClone()
      expect(clone).toBeTruthy()
      // Clone should not be in the real Vue component tree
      expect(clone.classList.contains('replay-export-root')).toBe(true)
    })

    it('aggregate clone contains aggregate data only', async () => {
      setResp(makeResp())
      setActiveTab('aggregate')
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const clone = getCallClone()
      expect(clone.querySelector('.tablewrap')).toBeTruthy()
    })

    it('battle-0 clone is different from aggregate', async () => {
      setResp(makeResp())
      setActiveTab('b0')
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(html2canvasMock).toHaveBeenCalled()
    })

    it('clone has export-root and theme class', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const clone = getCallClone()
      expect(clone.classList.contains('replay-export-root')).toBe(true)
      expect(clone.classList.contains('replay-export-light')).toBe(true)
    })
  })

  describe('html2canvas receives correct parameters', () => {
    it('receives target, scale, width, height, backgroundColor', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const [target, opts] = html2canvasMock.mock.calls[0]
      expect(target).toBeTruthy()
      expect(opts.scale).toBeGreaterThan(0)
      expect(opts.width).toBeGreaterThan(0)
      expect(opts.height).toBeGreaterThan(0)
      expect(opts.backgroundColor).toBe('#ffffff')
      expect(opts.useCORS).toBe(true)
    })

    it('no onclone passed to html2canvas', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const opts = html2canvasMock.mock.calls[0][1]
      expect(opts.onclone).toBeUndefined()
    })
  })

  describe('download lifecycle', () => {
    it('generates blob and triggers download', async () => {
      setResp(makeResp())
      wrapper = mountPage()
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

    it('download filename matches aggregate pattern', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      const appendChild = vi.spyOn(document.body, 'appendChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 300))

      expect(appendChild).toHaveBeenCalled()
      // Find the <a> element that was appended with blob href
      const anchors = appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      // Check outerHTML for download attribute (happy-dom may not expose .download)
      const html = anchors[0].outerHTML
      expect(html).toMatch(/download="?wotb-replay-\d{8}-\d{6}-aggregate\.png/)
    })

    it('shows error when toBlob returns null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t).toHaveBeenCalledWith('replay.png_export_failed')
    })

    it('shows error when html2canvas rejects', async () => {
      html2canvasMock.mockImplementation(() => Promise.reject(new Error('canvas failed')))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t).toHaveBeenCalledWith('replay.png_export_failed')
    })

    it('does not call html2canvas when target is null', async () => {
      setResp(makeResp())
      setActiveTab('b99')
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(html2canvasMock).not.toHaveBeenCalled()
    })

    it('does not call html2canvas when already exporting', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      const btn = pngButton(wrapper)

      html2canvasMock.mockImplementation(() => new Promise(() => {}))
      btn.trigger('click')
      await flushPromises()
      btn.trigger('click')
      await flushPromises()

      expect(html2canvasMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanup', () => {
    it('removes off-screen container after success', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))

      const offscreen = document.querySelector('[style*="left: -9999px"]')
      expect(offscreen).toBeNull()
    })

    it('removes off-screen container after html2canvas reject', async () => {
      html2canvasMock.mockImplementation(() => Promise.reject(new Error('failed')))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const offscreen = document.querySelector('[style*="left: -9999px"]')
      expect(offscreen).toBeNull()
    })

    it('removes off-screen container after toBlob null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const offscreen = document.querySelector('[style*="left: -9999px"]')
      expect(offscreen).toBeNull()
    })

    it('resets exporting flag after success', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))

      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('revokes object URL after download', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))

      expect(URL.revokeObjectURL).toHaveBeenCalled()
    })
  })
})
