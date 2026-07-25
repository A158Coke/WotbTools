// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReplayPage from './ReplayPage.vue'

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key)
}))

const h2c = vi.hoisted(() => {
  const calls = []
  let impl
  return {
    setImpl: (fn) => { impl = fn },
    getCalls: () => calls,
    resetCalls: () => { calls.length = 0 },
    call: (...args) => {
      calls.push(args)
      if (!impl) throw new Error('html2canvas not initialized')
      return impl(...args)
    },
  }
})

vi.mock('html2canvas', () => ({
  default: (...args) => h2c.call(...args)
}))

const box = vi.hoisted(() => ({
  respVal: null,
  activeTabVal: 'aggregate',
  errorVal: '',
  loadingVal: false,
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
      loading.value = box.loadingVal
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
function setLoading(val) { box.loadingVal = val }

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
            '<div class="tablewrap"><table style="width:2000px"><tbody>' +
            '<tr class="t1"><td><span class="rbadge">1500</span></td></tr>' +
            '<tr class="t2"><td><span class="rbadge">1200</span></td></tr>' +
            '</tbody></table></div>' +
            '<p class="scroll-hint">Scroll</p></div>'
        },
        BattleTable: {
          props: ['battle'],
          template: '<div class="battle-table-stub" :data-export-role="\'battle-\' + battle.mapName">' +
            '<div class="mcards"><div class="mc"><div class="k">Map</div><div class="v">{{ battle.mapName }}</div></div></div>' +
            '<div class="tablewrap"><table style="width:2000px"><tbody>' +
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

function setCloneScrollConfig(cloneW, cloneH, wrapW, wrapH, tableW, tableH) {
  return function setConfig(node) {
    const clone = node.querySelector?.('.replay-export-root')
    if (!clone) return
    setScrollProps(clone, cloneW, cloneH)
    for (const wrap of clone.querySelectorAll('.tablewrap')) {
      setScrollProps(wrap, wrapW, wrapH)
    }
    for (const tbl of clone.querySelectorAll('table')) {
      setScrollProps(tbl, tableW, tableH)
    }
  }
}

function interceptAppendChild(configFn) {
  const orig = document.body.appendChild.bind(document.body)
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = orig(node)
    configFn(node)
    return result
  })
}

function stripOffscreen() {
  for (const el of document.querySelectorAll('[style*="left: -9999px"]')) {
    el.parentNode?.removeChild(el)
  }
}

describe('ReplayPage PNG export', () => {
  let origCreateObjectURL
  let origRevokeObjectURL
  let mockCanvas
  let wrapper
  let h2cDefaultImpl

  beforeEach(() => {
    const mockCtx = { drawImage: vi.fn(), scale: vi.fn() }
    mockCanvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn(cb => cb(new Blob(['png'], { type: 'image/png' })))
    }
    h2cDefaultImpl = () => Promise.resolve(mockCanvas)
    h2c.resetCalls()
    h2c.setImpl(h2cDefaultImpl)
    origCreateObjectURL = URL.createObjectURL
    origRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:test')
    URL.revokeObjectURL = vi.fn()
    document.documentElement.removeAttribute('data-theme')
    setLoading(false)
  })

  afterEach(() => {
    URL.createObjectURL = origCreateObjectURL
    URL.revokeObjectURL = origRevokeObjectURL
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (wrapper) wrapper.unmount()
    wrapper = null
    setResp(null)
    setError('')
    setActiveTab('aggregate')
    setLoading(false)
    stripOffscreen()
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
      setLoading(true)
      wrapper = mountPage()
      expect(pngButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('does not call html2canvas when loading is true', async () => {
      setResp(makeResp())
      setLoading(true)
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls().length).toBe(0)
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
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#ffffff')
    })

    it('uses dark theme when data-theme=dark', async () => {
      setResp(makeResp())
      document.documentElement.setAttribute('data-theme', 'dark')
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#1e1e1e')
    })

    it('reads theme at click time on same component', async () => {
      setResp(makeResp())
      document.documentElement.setAttribute('data-theme', 'light')
      wrapper = mountPage()
      document.documentElement.setAttribute('data-theme', 'dark')
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#1e1e1e')
    })
  })

  describe('dimension measurement', () => {
    function expectDimensions(cfg, expectedW, expectedH, label) {
      interceptAppendChild(setCloneScrollConfig(
        cfg.cloneW, cfg.cloneH, cfg.wrapW, cfg.wrapH, cfg.tableW, cfg.tableH
      ))
      return async () => {
        await pngButton(wrapper).trigger('click')
        await flushPromises()
        const calls = h2c.getCalls()
        expect(calls.length, `${label} calls`).toBe(1)
        const opts = calls[0][1]
        expect(opts.width, `${label} width`).toBeGreaterThanOrEqual(expectedW)
        expect(opts.height, `${label} height`).toBeGreaterThanOrEqual(expectedH)
        expect(opts.width * opts.scale, `${label} w*s`).toBeLessThanOrEqual(16384)
        expect(opts.height * opts.scale, `${label} h*s`).toBeLessThanOrEqual(16384)
      }
    }

    it('aggregate: 2232 x 632', async () => {
      setResp(makeResp())
      setActiveTab('aggregate')
      wrapper = mountPage()
      await expectDimensions(
        { cloneW: 2232, cloneH: 632, wrapW: 2200, wrapH: 500, tableW: 2000, tableH: 400 },
        2232, 632, 'agg'
      )()
    })

    it('b0: 2760 x 700', async () => {
      setResp(makeResp())
      setActiveTab('b0')
      wrapper = mountPage()
      await expectDimensions(
        { cloneW: 2760, cloneH: 700, wrapW: 2700, wrapH: 600, tableW: 2600, tableH: 500 },
        2760, 700, 'b0'
      )()
    })

    it('b1: 3100 x 760', async () => {
      setResp(makeResp())
      setActiveTab('b1')
      wrapper = mountPage()
      await expectDimensions(
        { cloneW: 3100, cloneH: 760, wrapW: 3050, wrapH: 650, tableW: 3000, tableH: 550 },
        3100, 760, 'b1'
      )()
    })

    it('zero dimensions trigger fallback 800x600', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      interceptAppendChild(setCloneScrollConfig(0, 0, 0, 0, 0, 0))
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const opts = h2c.getCalls()[0][1]
      expect(opts.width).toBe(800)
      expect(opts.height).toBe(600)
      expect(opts.scale).toBe(1)
    })
  })

  describe('html2canvas receives correct parameters', () => {
    function getOpts() {
      return h2c.getCalls()[0][1]
    }

    it('receives target, scale, width, height, backgroundColor', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      const opts = getOpts()
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

      const opts = getOpts()
      expect(opts.onclone).toBeUndefined()
    })
  })

  describe('export context immutability', () => {
    it('aggregate: target is aggregate, filename is aggregate', async () => {
      setResp(makeResp())
      setActiveTab('aggregate')
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      const clone = h2c.getCalls()[0][0]
      expect(clone.textContent).toContain('Battles')
      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/wotb-replay-\d{8}-\d{6}-aggregate\.png/)
    })

    it('b0: target contains Lagoon, filename is battle type', async () => {
      setResp(makeResp())
      setActiveTab('b0')
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      const clone = h2c.getCalls()[0][0]
      expect(clone.textContent).toContain('Lagoon')
      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      // Filename must be a battle filename (not aggregate)
      expect(anchors[0].outerHTML).toMatch(/wotb-replay-\d{8}-\d{6}-.+\.png/)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)
    })

    it('b1: target contains Frozen, filename is battle type', async () => {
      setResp(makeResp())
      setActiveTab('b1')
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      const clone = h2c.getCalls()[0][0]
      expect(clone.textContent).toContain('Frozen')
      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/wotb-replay-\d{8}-\d{6}-.+\.png/)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)
    })

    it('tab switch during export: filename still uses original tab/map', async () => {
      setResp(makeResp())
      setActiveTab('b0')
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      let resolveH2c
      h2c.setImpl(() => new Promise(resolve => { resolveH2c = resolve }))
      pngButton(wrapper).trigger('click')
      // Wait for createExportClone + expandExportTables + waitForLayout
      await flushPromises()
      await new Promise(r => setTimeout(r, 100))
      await flushPromises()

      // At this point html2canvas should have been called
      expect(h2c.getCalls().length).toBe(1)
      const cloneDuring = h2c.getCalls()[0][0]
      expect(cloneDuring.textContent).toContain('Lagoon')

      // User switches tab mid-export
      setActiveTab('b1')

      // Resume export
      resolveH2c(mockCanvas)
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      // Filename must still be a battle filename (not aggregate)
      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)
      expect(anchors[0].outerHTML).toMatch(/wotb-replay-\d{8}-\d{6}-.+\.png/)
      expect(h2c.getCalls().length).toBe(1)

      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('reverse: b1 export, switch to aggregate, filename still refers to battle', async () => {
      setResp(makeResp())
      setActiveTab('b1')
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      let resolveH2c
      h2c.setImpl(() => new Promise(resolve => { resolveH2c = resolve }))
      pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 100))
      await flushPromises()

      expect(h2c.getCalls().length).toBe(1)
      const cloneDuring = h2c.getCalls()[0][0]
      expect(cloneDuring.textContent).toContain('Frozen')

      setActiveTab('aggregate')

      resolveH2c(mockCanvas)
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)
      expect(anchors[0].outerHTML).toMatch(/wotb-replay-\d{8}-\d{6}-.+\.png/)
    })

    it('target null at start: no clone, no html2canvas', async () => {
      h2c.resetCalls()
      setResp(makeResp())
      setActiveTab('b99')
      wrapper = mountPage()

      expect(pngButton(wrapper)).toBeDefined()
      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(h2c.getCalls().length).toBe(0)
      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
    })
  })

  describe('download lifecycle', () => {
    it('generates blob and triggers download', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')
      vi.spyOn(document.body, 'removeChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      expect(mockCanvas.toBlob).toHaveBeenCalled()
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(document.body.appendChild).toHaveBeenCalled()
      expect(document.body.removeChild).toHaveBeenCalled()
    })

    it('download filename matches aggregate pattern', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 300))
      await flushPromises()

      const anchors = document.body.appendChild.mock.calls
        .map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/download="?wotb-replay-\d{8}-\d{6}-aggregate\.png/)
    })

    it('shows error when toBlob returns null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t.mock.calls.some(c => c[0] === 'replay.png_export_failed')).toBe(true)
    })

    it('shows error when html2canvas rejects', async () => {
      h2c.setImpl(() => Promise.reject(new Error('canvas failed')))
      setResp(makeResp())
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(i18n.t.mock.calls.some(c => c[0] === 'replay.png_export_failed')).toBe(true)
    })

    it('does not call html2canvas when target is null', async () => {
      setResp(makeResp())
      setActiveTab('b99')
      wrapper = mountPage()

      await pngButton(wrapper).trigger('click')
      await flushPromises()

      expect(h2c.getCalls().length).toBe(0)
    })

    it('does not call html2canvas when already exporting', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      const btn = pngButton(wrapper)

      let resolveFn
      h2c.setImpl(() => new Promise(resolve => { resolveFn = resolve }))
      btn.trigger('click')
      await flushPromises()
      btn.trigger('click')
      await flushPromises()
      if (resolveFn) resolveFn(mockCanvas)
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      const calls = h2c.getCalls()
      expect(calls.length).toBe(1)
      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })

  describe('cleanup', () => {
    function expectClean() {
      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    }

    it('removes off-screen container and resets flag after success', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()
      expectClean()
    })

    it('removes off-screen container after html2canvas reject', async () => {
      h2c.setImpl(() => Promise.reject(new Error('failed')))
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expectClean()
    })

    it('removes off-screen container after toBlob null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expectClean()
    })

    it('removes off-screen container after downloadBlob reject', async () => {
      const origCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = origCreate(tag)
        if (tag === 'a') { el.click = () => { throw new Error('click failed') } }
        return el
      })
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expectClean()
    })

    it('revokes object URL after download', async () => {
      setResp(makeResp())
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
    })
  })
})
