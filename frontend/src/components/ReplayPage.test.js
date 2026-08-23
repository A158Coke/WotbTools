// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref, computed } from 'vue'
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
    call: (...args) => { calls.push(args); if (!impl) throw new Error('html2canvas not initialized'); return impl(...args) },
  }
describe('ReplayPage export job flow', () => {
  function exportButtons(wrapper) {
    return wrapper.findAll('button').filter(b => b.text().includes('action.export_aggregate') || b.text().includes('action.export_each'))
  }

  it('export aggregate button calls startExportJob with aggregate', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    await exportButtons(wrapper)[0].trigger('click')
    expect(state.replay.startExportJob).toHaveBeenCalledWith('aggregate')
  })

  it('export each button calls startExportJob with each', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    await exportButtons(wrapper)[1].trigger('click')
    expect(state.replay.startExportJob).toHaveBeenCalledWith('each')
  })

  it('renders ReplayTaskCard when export job exists', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="replay-task-card"]').exists()).toBe(false)
    jobState.setJob({ jobId: 'j1', status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', total: 2, processed: 1, duplicates: 0, failures: 0 })
    await flushPromises()
    expect(wrapper.find('[data-testid="replay-task-card"]').exists()).toBe(true)
  })

  it('disables export buttons while a job is active', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    jobState.setActive(true)
    await flushPromises()
    for (const btn of exportButtons(wrapper)) {
      expect(btn.attributes('disabled')).toBeDefined()
    }
  })

  it('does not create export job when active (guard in page)', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    jobState.setActive(true)
    await flushPromises()
    await exportButtons(wrapper)[0].trigger('click')
    expect(state.replay.startExportJob).not.toHaveBeenCalled()
  })
})

})

vi.mock('html2canvas', () => ({
  default: (...args) => h2c.call(...args)
}))

// ===== Reactive state store: tests control REAL refs used by the component =====
const state = vi.hoisted(() => {
  let _activeTab
  let _resp
  let _error
  let _loading
  let _locale
  let _files
  let _fns

  function setActiveTab(val) {
    if (_activeTab) _activeTab.value = val
  }
  function setResp(val) {
    if (_resp) _resp.value = val
  }
  function setError(val) {
    if (_error) _error.value = val
  }
  function setLoading(val) {
    if (_loading) _loading.value = val
  }
  function setLocale(val) {
    if (_locale) _locale.value = val
  }

  return {
    // Store ref once created
    capture: (r) => { _activeTab = r.activeTab; _resp = r.resp; _error = r.error; _loading = r.loading; _locale = r.locale; _files = r.files },
    captureFns: (fns) => { _fns = fns },
    get replay() { return _fns || {} },
    clear: () => { _activeTab = null; _resp = null; _error = null; _loading = null; _locale = null },
    setActiveTab, setResp, setError, setLoading, setLocale,
    // Default initial values
    init: { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] },
  }
})


const jobState = vi.hoisted(() => {
  let _exportJob
  let _exportActive
  return {
    capture: (job, active) => { _exportJob = job; _exportActive = active },
    clear: () => { _exportJob = null; _exportActive = null },
    setJob: (v) => { if (_exportJob) _exportJob.value = v },
    setActive: (v) => { if (_exportActive) _exportActive.value = v },
  }
})

const pJobState = vi.hoisted(() => {
  let _processingJob
  let _processingActive
  let _processingJobId
  return {
    capture: (job, active, id) => { _processingJob = job; _processingActive = active; _processingJobId = id },
    clear: () => { _processingJob = null; _processingActive = null; _processingJobId = null },
    setJob: (v) => { if (_processingJob) _processingJob.value = v },
    setActive: (v) => { if (_processingActive) _processingActive.value = v },
    setId: (v) => { if (_processingJobId) _processingJobId.value = v },
  }
})
vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  const locale = ref('en')
  return {
    useI18n: () => ({ locale, t: i18n.t })
  }
})

// We need locale ref from i18n mock. Store it in a shared module var.
const localeHolder = vi.hoisted(() => ({ ref: null }))

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

  // Mirror i18n locale ref
  const i18nModule = await import('vue-i18n')
  const localeRef = i18nModule.useI18n().locale

  return {
    useReplay: () => {
      // Apply initial values on first call
      if (state.init) {
        activeTab.value = state.init.activeTab
        resp.value = state.init.resp
        error.value = state.init.error
        loading.value = state.init.loading
        localeRef.value = state.init.locale
        files.value = state.init.files || []
      }
      state.capture({ activeTab, resp, error, loading, locale: localeRef })
      state.init = null
      const exportJobRef = ref(null)
      const exportActiveRef = ref(false)
      const processingJobRef = ref(null)
      const processingActiveRef = ref(false)
      const processingJobIdRef = ref(null)
      jobState.capture(exportJobRef, exportActiveRef)
      pJobState.capture(processingJobRef, processingActiveRef, processingJobIdRef)
      const startExportJob = vi.fn()
      const startProcessingJob = vi.fn()
      state.captureFns({ startExportJob, startProcessingJob })
      return {
        files, loading, error, resp, activeTab,
        aggStats: computed(() => null),
        pendingRemove, updateFiles: vi.fn(), playerCols, aggCols,
        exportJob: exportJobRef, exportError: ref(''), exportActive: exportActiveRef,
        processingJob: processingJobRef, processingError: ref(''), processingActive: processingActiveRef,
        processingJobId: processingJobIdRef,
        startProcessingJob, cancelProcessingJob: vi.fn(),
        dismissProcessingJob: vi.fn(),
        startExportJob, cancelExportJob: vi.fn(),
        downloadExportResult: vi.fn(), dismissExportJob: vi.fn(),
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

function mountPage(overrides = {}) {
  const auth = overrides.auth || { authenticated: true, login: vi.fn() }
  const navigate = overrides.navigate || vi.fn()
  return mount(ReplayPage, {
    global: {
      mocks: { $t: i18n.t },
      provide: {
        navigate,
        isAuthenticated: () => auth.authenticated,
        login: auth.login,
      },
      stubs: {
        FileUploader: { template: '<div class="file-uploader-stub"><button class="preview-stub" @click="$emit(&quot;preview&quot;)">action.preview</button></div>' },
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
        RemoveConfirmModal: { template: '<div class="remove-modal-stub" />' }
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
  return function configFn(node) {
    const clone = node.querySelector?.('.replay-export-root')
    if (!clone) return
    setScrollProps(clone, cloneW, cloneH)
    for (const wrap of clone.querySelectorAll('.tablewrap')) setScrollProps(wrap, wrapW, wrapH)
    for (const tbl of clone.querySelectorAll('table')) setScrollProps(tbl, tableW, tableH)
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
  for (const el of document.querySelectorAll('[style*="left: -9999px"]')) el.parentNode?.removeChild(el)
}

describe('ReplayPage processing job flow', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('renders processing task card with real 18/34 progress (plan §64)', async () => {
    state.init.resp = null
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="replay-task-card"]').exists()).toBe(false)
    pJobState.setJob({ jobId: 'p1', status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', total: 34, processed: 18, valid: 16, duplicates: 2, failures: 1, currentFile: 'x.wotbreplay' })
    await flushPromises()
    const card = wrapper.find('[data-testid="replay-task-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('replay.processing_job.title')
    expect(card.text()).toContain('replay.processing_job.progress')
  })

  it('processing READY hides processing card when export card present (export takes the slot)', async () => {
    state.init.resp = null
    const wrapper = mountPage()
    pJobState.setJob({ jobId: 'p1', status: 'READY', phase: null, total: 34, processed: 34, valid: 31, duplicates: 2, failures: 1 })
    jobState.setJob({ jobId: 'e1', status: 'PROCESSING', phase: 'BUILDING_EXCEL', total: 34, processed: 34, duplicates: 0, failures: 0 })
    await flushPromises()
    const cards = wrapper.findAll('[data-testid="replay-task-card"]')
    expect(cards.length).toBe(1)
    expect(cards[0].text()).toContain('replay.export_job.title')
  })

  it('preview button triggers startProcessingJob', async () => {
    state.init.resp = null
    state.init.files = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountPage()
    const previewBtn = wrapper.findAll('button').find(b => b.text().includes('action.preview'))
    expect(previewBtn).toBeDefined()
    await previewBtn.trigger('click')
    await flushPromises()
    expect(state.replay.startProcessingJob).toHaveBeenCalled()
  })
})

describe('ReplayPage PNG export', () => {
  let origCreateObjectURL, origRevokeObjectURL, mockCanvas, wrapper, h2cDefaultImpl

  // Shared deferred promise controls
  let resolveH2c

  function pauseH2c() {
    resolveH2c = null
    h2c.setImpl(() => new Promise(resolve => { resolveH2c = resolve }))
  }

  function resumeH2c() {
    if (resolveH2c) { resolveH2c(mockCanvas); resolveH2c = null }
  }

  afterEach(() => {
    URL.createObjectURL = origCreateObjectURL
    URL.revokeObjectURL = origRevokeObjectURL
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (wrapper) wrapper.unmount()
    wrapper = null
    state.clear()
    stripOffscreen()
    // Reset initial values for next test
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en' }
  })

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
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en' }
  })

  describe('render and button state', () => {
    it('hides export button when no response data', () => {
      wrapper = mountPage()
      expect(pngButton(wrapper)).toBeUndefined()
    })

    it('shows export button when response data exists', () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      expect(pngButton(wrapper)).toBeDefined()
    })

    it('disables button when loading is true', () => {
      state.init.resp = makeResp()
      state.init.loading = true
      wrapper = mountPage()
      expect(pngButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('does not call html2canvas when loading is true', async () => {
      state.init.resp = makeResp()
      state.init.loading = true
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls().length).toBe(0)
    })
  })

  describe('real page isolation', () => {
    it('real page nodes never get export classes or inline styles', () => {
      state.init.resp = makeResp()
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
      state.init.resp = makeResp()
      wrapper = mountPage()
      document.documentElement.removeAttribute('data-theme')
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#ffffff')
    })

    it('uses dark theme when data-theme=dark', async () => {
      state.init.resp = makeResp()
      document.documentElement.setAttribute('data-theme', 'dark')
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#1e1e1e')
    })
  })

  describe('dimension measurement (exact values)', () => {
    function runDimensionTest(cfg, expectedW, expectedH, label) {
      return async () => {
        state.init.resp = makeResp()
        state.init.activeTab = cfg.tab
        wrapper = mountPage()
        interceptAppendChild(setCloneScrollConfig(cfg.cloneW, cfg.cloneH, cfg.wrapW, cfg.wrapH, cfg.tableW, cfg.tableH))
        await pngButton(wrapper).trigger('click')
        await flushPromises()
        const calls = h2c.getCalls()
        expect(calls.length, `${label} calls`).toBe(1)
        const opts = calls[0][1]
        expect(opts.width, `${label} width`).toBe(expectedW)
        expect(opts.height, `${label} height`).toBe(expectedH)
        expect(opts.width * opts.scale, `${label} w*s`).toBeLessThanOrEqual(16384)
        expect(opts.height * opts.scale, `${label} h*s`).toBeLessThanOrEqual(16384)
      }
    }

    it('aggregate: 2232 x 632', runDimensionTest(
      { tab: 'aggregate', cloneW: 2232, cloneH: 632, wrapW: 2200, wrapH: 500, tableW: 2000, tableH: 400 },
      2232, 632, 'agg'
    ))

    it('b0: 2760 x 700', runDimensionTest(
      { tab: 'b0', cloneW: 2760, cloneH: 700, wrapW: 2700, wrapH: 600, tableW: 2600, tableH: 500 },
      2760, 700, 'b0'
    ))

    it('b1: 3100 x 760', runDimensionTest(
      { tab: 'b1', cloneW: 3100, cloneH: 760, wrapW: 3050, wrapH: 650, tableW: 3000, tableH: 550 },
      3100, 760, 'b1'
    ))

    it('zero dimensions trigger fallback 800x600', async () => {
      state.init.resp = makeResp()
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
    it('receives target, scale, width, height, backgroundColor', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const opts = h2c.getCalls()[0][1]
      expect(opts.scale).toBeGreaterThan(0)
      expect(opts.width).toBeGreaterThan(0)
      expect(opts.height).toBeGreaterThan(0)
      expect(opts.backgroundColor).toBe('#ffffff')
      expect(opts.useCORS).toBe(true)
    })

    it('no onclone passed to html2canvas', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(h2c.getCalls()[0][1].onclone).toBeUndefined()
    })
  })

  describe('reactive state control (real refs)', () => {
    function activeTabButton(wrapper) {
      return wrapper.findAll('.restoolbar .tabs button').find(b => b.classes().includes('active'))
    }

    it('setActiveTab changes activeTab ref before mount', () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      const btn = activeTabButton(wrapper)
      expect(btn.text()).toContain('Lagoon')
    })

    it('setActiveTab changes activeTab ref after mount', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      expect(activeTabButton(wrapper).text()).toContain('result.aggregate_tab')
      state.setActiveTab('b0')
      await flushPromises()
      expect(activeTabButton(wrapper).text()).toContain('Lagoon')
      expect(activeTabButton(wrapper).text()).not.toContain('result.aggregate_tab')
    })

    it('setResp null removes PNG button', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      expect(pngButton(wrapper)).toBeDefined()
      state.setResp(null)
      await flushPromises()
      expect(pngButton(wrapper)).toBeUndefined()
    })
  })

  describe('async export context immutability (real ref changes)', () => {
    function activeTabButton(wrapper) {
      return wrapper.findAll('.restoolbar .tabs button').find(b => b.classes().includes('active'))
    }

    function captureAnchors() {
      const appendMock = document.body.appendChild
      if (!appendMock.mock) return []
      return appendMock.mock.calls.map(c => c[0])
        .filter(el => el && el.nodeName === 'A' && el.href && el.href.startsWith('blob:'))
    }

    async function startExportAndWaitForH2c() {
      pauseH2c()
      pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 100))
      await flushPromises()
      expect(h2c.getCalls().length).toBe(1)
    }

    async function completeExport() {
      resumeH2c()
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()
    }

    it('ctrl: b0 export without tab switch uses Lagoon filename', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Lagoon')
      await completeExport()

      const anchors = captureAnchors()
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/Lagoon/)
    })

    it('tab switch b0->b1: filename still Lagoon', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Lagoon')

      // Verify we're on b0
      expect(activeTabButton(wrapper).text()).toContain('Lagoon')

      // Switch to b1 via REAL ref
      state.setActiveTab('b1')
      await flushPromises()

      // Verify the page really shows b1 as active
      expect(activeTabButton(wrapper).text()).toContain('Frozen')
      expect(activeTabButton(wrapper).text()).not.toContain('Lagoon')

      await completeExport()

      const anchors = captureAnchors()
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/Lagoon/)
      expect(anchors[0].outerHTML).not.toMatch(/Frozen/)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)

      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
      expect(pngButton(wrapper).attributes('disabled')).toBeUndefined()
    })

    it('tab switch b1->aggregate: filename still Frozen', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b1'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Frozen')
      expect(activeTabButton(wrapper).text()).toContain('Frozen')

      state.setActiveTab('aggregate')
      await flushPromises()
      expect(activeTabButton(wrapper).text()).toContain('result.aggregate_tab')
      expect(activeTabButton(wrapper).text()).not.toContain('Frozen')

      await completeExport()

      const anchors = captureAnchors()
      expect(anchors.length).toBe(1)
      expect(anchors[0].outerHTML).toMatch(/Frozen/)
      expect(anchors[0].outerHTML).not.toMatch(/aggregate/)
    })

    it('response cleared mid-export: filename still Lagoon', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Lagoon')

      // Clear response via REAL ref
      state.setResp(null)
      await flushPromises()
      // PNG button should disappear since resp is null
      expect(pngButton(wrapper)).toBeUndefined()

      await completeExport()

      const anchors = captureAnchors()
      expect(anchors.length).toBe(1)
      // Must still contain Lagoon from saved context, not fallback to battle-N
      expect(anchors[0].outerHTML).toMatch(/Lagoon/)
      expect(anchors[0].outerHTML).not.toMatch(/battle-/)
    })
  })

  describe('download lifecycle', () => {
    it('generates blob and triggers download', async () => {
      state.init.resp = makeResp()
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

    it('shows error when toBlob returns null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(i18n.t.mock.calls.some(c => c[0] === 'replay.png_export_failed')).toBe(true)
    })

    it('shows error when html2canvas rejects', async () => {
      h2c.setImpl(() => Promise.reject(new Error('canvas failed')))
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(i18n.t.mock.calls.some(c => c[0] === 'replay.png_export_failed')).toBe(true)
    })

    it('does not call html2canvas when target is null', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b99'
      wrapper = mountPage()
      const btn = pngButton(wrapper)
      expect(btn).toBeDefined()
      await btn.trigger('click')
      await flushPromises()
      expect(h2c.getCalls().length).toBe(0)
      expect(document.querySelector('[style*="left: -9999px"]')).toBeNull()
    })

    it('does not call html2canvas when already exporting', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      const btn = pngButton(wrapper)

      pauseH2c()
      btn.trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 50))
      await flushPromises()
      btn.trigger('click')
      await flushPromises()
      resumeH2c()
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()

      expect(h2c.getCalls().length).toBe(1)
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

    it('removes off-screen container after success', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()
      expectClean()
    })

    it('removes off-screen container after html2canvas reject', async () => {
      h2c.setImpl(() => Promise.reject(new Error('failed')))
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expectClean()
    })

    it('removes off-screen container after toBlob null', async () => {
      mockCanvas.toBlob = vi.fn(cb => cb(null))
      state.init.resp = makeResp()
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
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expectClean()
    })

    it('revokes object URL after download', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      await new Promise(r => setTimeout(r, 200))
      await flushPromises()
      expect(URL.revokeObjectURL).toHaveBeenCalled()
    })
  })
})


describe('ReplayPage Battle context actions（V2：登录门控 + 跨视图文件传递）', () => {
  function makeRespWithSource() {
    return {
      aggregate: [{ cells: { nickname: 'Player1', damage_dealt: 5000 } }],
      battles: [
        { mapName: 'Lagoon', sourceName: 'lagoon.wotbreplay', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] }
      ],
      duplicates: [], failures: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      aggregateColumns: [{ key: 'nickname', label: '昵称' }]
    }
  }

  afterEach(async () => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en' }
    // 清空模块级 replayTransfer 单例，避免跨测试污染
    const transferModule = await import('../utils/replayTransfer.js')
    transferModule.takePendingReplayFiles()
    vi.restoreAllMocks()
  })

  function mountWithBattle(resp, auth, nav) {
    const files = resp.battles.map(b => {
      const f = new File(['replay'], b.sourceName, { type: 'application/octet-stream' })
      return f
    })
    state.init = { activeTab: 'b0', resp, error: '', loading: false, locale: 'en', files }
    return mountPage({ auth, navigate: nav || vi.fn() })
  }

  it('Summary（aggregate）context 不渲染战局回放 / AI 复盘按钮', () => {
    state.init = { activeTab: 'aggregate', resp: makeRespWithSource(), error: '', loading: false, locale: 'en' }
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="battle-playback-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="battle-ai-btn"]').exists()).toBe(false)
  })

  it('已登录点击「战局回放」→ setPendingReplayFiles(playback) + navigate(reconstruction)', async () => {
    const navigate = vi.fn()
    const setPending = vi.fn()
    const transferModule = await import('../utils/replayTransfer.js')
    const spy = vi.spyOn(transferModule, 'setPendingReplayFiles')
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: true, login: vi.fn() }, navigate)
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith([expect.any(Object)], 'playback')
    expect(navigate).toHaveBeenCalledWith('reconstruction')
    expect(transferModule.takePendingReplayFiles()).toBeTruthy()
    spy.mockRestore()
  })

  it('已登录点击「AI 复盘」→ setPendingReplayFiles(ai) + navigate(reconstruction)，不自动发起 AI', async () => {
    const navigate = vi.fn()
    const transferModule = await import('../utils/replayTransfer.js')
    const spy = vi.spyOn(transferModule, 'setPendingReplayFiles')
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: true, login: vi.fn() }, navigate)
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalledWith([expect.any(Object)], 'ai')
    expect(navigate).toHaveBeenCalledWith('reconstruction')
    spy.mockRestore()
  })

  it('未登录点击「战局回放」→ confirm 提示 + login，不 navigate、不 setPending（不静默丢文件）', async () => {
    const navigate = vi.fn()
    const login = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const transferModule = await import('../utils/replayTransfer.js')
    const spy = vi.spyOn(transferModule, 'setPendingReplayFiles')
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: false, login }, navigate)
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(login).toHaveBeenCalledWith('replay')
    expect(navigate).not.toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
    expect(transferModule.takePendingReplayFiles()).toBeNull()
    confirmSpy.mockRestore()
    spy.mockRestore()
  })

  it('未登录取消 confirm → 不 login 不 navigate', async () => {
    const navigate = vi.fn()
    const login = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: false, login }, navigate)
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('battle 无对应文件（files 中无匹配 sourceName）→ 点击无操作', async () => {
    const navigate = vi.fn()
    const resp = makeRespWithSource()
    // files 为空：currentBattleFile 找不到 battle.sourceName 对应文件
    state.init = { activeTab: 'b0', resp, error: '', loading: false, locale: 'en', files: [] }
    const wrapper = mountPage({ auth: { authenticated: true, login: vi.fn() }, navigate })
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
  })
})