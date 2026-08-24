// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref, computed, toRaw, watch, onMounted, onUnmounted } from 'vue'
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
    // 无覆盖时 teamNamesPayload() = null（PR #123 Blocker 1：名称必须经 payload 传递）
    expect(state.replay.startExportJob).toHaveBeenCalledWith('aggregate', null)
  })

  it('export each button calls startExportJob with each', async () => {
    state.init.resp = makeResp()
    const wrapper = mountPage()
    await exportButtons(wrapper)[1].trigger('click')
    expect(state.replay.startExportJob).toHaveBeenCalledWith('each', null)
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
    useI18n: () => ({ locale, t: i18n.t, te: key => i18n.t.mock.calls.some(c => c[0] === key) })
  }
})

// We need locale ref from i18n mock. Store it in a shared module var.
const localeHolder = vi.hoisted(() => ({ ref: null }))

// 真实 BattlePlaybackPanel（playback 加载门控用例）的鉴权 seam：ensureToken 恒成功、token 恒定。
vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: { value: { realm_access: { roles: ['wotbtools-user'] } } },
    token: () => 'test-token',
    ensureToken: vi.fn(async () => true),
    login: vi.fn(),
    authenticated: { value: true },
    initPromise: Promise.resolve(true)
  })
}))

vi.mock('../composables/useReplay.js', async () => {
  const { ref, computed } = await import('vue')
  const resp = ref(null)
  const activeTab = ref('aggregate')
  const selectionRevision = ref(0)
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
      const updateFiles = vi.fn(() => { selectionRevision.value++ })
      state.captureFns({ startExportJob, startProcessingJob, updateFiles })
      return {
        files, loading, error, resp, activeTab,
        aggStats: computed(() => null),
        selectionRevision,
        pendingRemove, updateFiles, playerCols, aggCols,
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
    useColumns: () => {
      // 测试 seam：window.__testLeagueMode 控制 league 模式渲染；
      // window.__testCwVisible / __testCwOrder 模拟 useColumns cw scope（BLOCKER 2）
      const cwKeys = window.__testCwVisible || [
        'nickname', 'league_rating', 'clan', 'battles', 'wins', 'win_rate',
        'damage_avg', 'earned_avg', 'contribution', 'kast', 'impact'
      ]
      const cwOrder = window.__testCwOrder || [...cwKeys]
      return {
        visibleKeys: ref([]), aggVisibleKeys: ref([]),
        playerOrder: ref([]), aggOrder: ref([]),
        cwVisibleKeys: ref([...cwKeys]),
        cwOrder: ref([...cwOrder]),
        showColPicker: ref(false), pickerScope: ref('player'),
        currentOrder: computed(() => []),
        shownCols: computed(() => []), shownAggCols: computed(() => []),
        // 测试 seam：window.__testLeagueMode 控制 league 模式渲染
        leagueMode: computed(() => !!window.__testLeagueMode),
        toggleColPicker: vi.fn(), toggleCol: vi.fn(),
        selectAllCols: vi.fn(), resetCols: vi.fn(),
        handleReorder: vi.fn(), initFromResponse: vi.fn(),
      }
    }
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
        FileUploader: {
          props: ['files'],
          template: '<div class="file-uploader-stub"><button class="preview-stub" @click="$emit(&quot;preview&quot;)">action.preview</button>' +
            '<button class="ai-action-stub" @click="$emit(&quot;workspace-action&quot;, { file: files[0], mode: &apos;ai&apos; })">ai</button></div>'
        },
        AiReviewPanel: { name: 'AiReviewPanel', props: ['file', 'loginView'], template: '<div class="ai-panel-stub" />' },
        ...(overrides.realPlayback
          ? (overrides.mapStub ? { MapOverview: overrides.mapStub } : {})
          : { BattlePlaybackPanel: { name: 'BattlePlaybackPanel', props: ['file', 'active', 'seekTo', 'loginView'], template: '<div class="playback-panel-stub" />' } }),
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
        PlayerDetailDrawer: { props: ['context', 'player'], template: '<div class="drawer-stub">{{ context ? "open:" + context.accountId : "closed" }}</div>' },
        ...(overrides.stubs || {})
      }
    }
  })
}

function panelDisplay(wrapper, testId) {
  // happy-dom 的 getComputedStyle 不反映 inline style（v-show 依赖），
  // 故直接检查 element.style.display（与项目既有 v-show 测试一致）。
  const el = wrapper.find(`[data-test="${testId}"]`)
  return el.exists() ? el.element.style.display : null
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


describe('ReplayPage Battle context actions（V2：登录门控 + Workspace 原地切换）', () => {
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

  it('已登录点击「战局回放」→ 原地切到 Workspace playback，目标文件为当前 battle（不跨视图）', async () => {
    const navigate = vi.fn()
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: true, login: vi.fn() }, navigate)
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).not.toBe('none')
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none')
    const panel = wrapper.findComponent({ name: 'BattlePlaybackPanel' })
    expect(panel.props('file')?.name).toBe('lagoon.wotbreplay')
    expect(panel.props('active')).toBe(true)
  })

  it('已登录点击「AI 复盘」→ 原地切到 Workspace ai（不自动发起 AI、不跨视图）', async () => {
    const navigate = vi.fn()
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: true, login: vi.fn() }, navigate)
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none')
    const panel = wrapper.findComponent({ name: 'AiReviewPanel' })
    expect(panel.props('file')?.name).toBe('lagoon.wotbreplay')
    expect(panel.props('loginView')).toBe('replay')
  })

  it('未登录点击「战局回放」→ confirm 提示 + login，不切换 Workspace（不静默丢文件）', async () => {
    const navigate = vi.fn()
    const login = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWithBattle(makeRespWithSource(), { authenticated: false, login }, navigate)
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(login).toHaveBeenCalledWith('replay')
    expect(navigate).not.toHaveBeenCalled()
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none')
    confirmSpy.mockRestore()
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

describe('ReplayPage 单页 Workspace（解析结果 / AI 复盘 / 战局回放 原地切换）', () => {
  function mountWithFiles(files, resp = null) {
    state.init = { activeTab: 'aggregate', resp, error: '', loading: false, locale: 'en', files }
    return mountPage({ auth: { authenticated: true, login: vi.fn() } })
  }

  it('有文件时显示三个 Workspace tab，默认解析结果面板', () => {
    const wrapper = mountWithFiles([new File(['r'], 'a.wotbreplay')])
    expect(wrapper.find('[data-testid="workspace-results-tab"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workspace-ai-tab"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="workspace-playback-tab"]').exists()).toBe(true)
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none')
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none')
  })

  it('无文件时不渲染 Workspace（只有上传面板）', () => {
    const wrapper = mountWithFiles([])
    expect(wrapper.find('[data-testid="workspace-ai-tab"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="workspace-ai-panel"]').exists()).toBe(false)
  })

  it('FileUploader 直接入口（workspace-action ai）→ 原地切到 AI 面板并传入目标文件', async () => {
    const files = [new File(['r'], 'direct.wotbreplay')]
    const wrapper = mountWithFiles(files)
    await wrapper.find('.ai-action-stub').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none')
    expect(wrapper.findComponent({ name: 'AiReviewPanel' }).props('file')?.name).toBe('direct.wotbreplay')
  })

  it('切走再切回：AI 面板保持挂载（v-show 不销毁，file 未变 = 状态保留）', async () => {
    const files = [new File(['r'], 'keep.wotbreplay')]
    const wrapper = mountWithFiles(files)
    await wrapper.find('.ai-action-stub').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
    expect(wrapper.findComponent({ name: 'AiReviewPanel' }).props('file')?.name).toBe('keep.wotbreplay')

    // 切回解析结果 → AI 面板隐藏
    await wrapper.find('[data-testid="workspace-results-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none')

    // 再切回 AI：同一面板实例（file prop 未变）
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
    expect(wrapper.findComponent({ name: 'AiReviewPanel' }).props('file')?.name).toBe('keep.wotbreplay')
  })

  it('解析预览 → 切回解析结果面板并启动解析 Job', async () => {
    const files = [new File(['r'], 'a.wotbreplay')]
    const wrapper = mountWithFiles(files)
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await wrapper.find('.preview-stub').trigger('click')
    await flushPromises()
    expect(state.replay.startProcessingJob).toHaveBeenCalled()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none')
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none')
  })
})
describe('ReplayPage Workspace target resolution（唯一文件自动定位 / 多文件禁 fallback / 登录门禁统一）', () => {
  function makeBattleResp(sourceName) {
    return {
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
      battles: [
        { mapName: 'Lagoon', sourceName, players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] }
      ],
      duplicates: [], failures: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      aggregateColumns: [{ key: 'nickname', label: '昵称' }]
    }
  }

  function mountWs(files, resp = null, auth = { authenticated: true, login: vi.fn() }, activeTab = 'aggregate') {
    state.init = { activeTab, resp, error: '', loading: false, locale: 'en', files }
    return mountPage({ auth })
  }

  function aiPanel(wrapper) {
    return wrapper.findComponent({ name: 'AiReviewPanel' })
  }

  function playbackPanel(wrapper) {
    return wrapper.findComponent({ name: 'BattlePlaybackPanel' })
  }

  it('Case A: 唯一文件直接点击「AI 复盘」Tab → 自动以该文件为 target（复用原始 File reference，不重新上传/解析）', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const wrapper = mountWs([f])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(f)
  })

  it('Case B: 唯一文件直接点击「战局回放」Tab → 自动以该文件为 target，active 语义正确', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const wrapper = mountWs([f])
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).not.toBe('none')
    expect(toRaw(playbackPanel(wrapper).props('file'))).toBe(f)
    expect(playbackPanel(wrapper).props('active')).toBe(true)
  })

  it('Case C: 多文件未显式选择 target → 直接点击 AI/playback Tab 不 fallback 第一场（保持空态）', async () => {
    const a = new File(['r'], 'a.wotbreplay')
    const b = new File(['r'], 'b.wotbreplay')
    const wrapper = mountWs([a, b])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(aiPanel(wrapper).props('file')).toBeNull()
    expect(aiPanel(wrapper).props('file')).not.toBe(a)
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(playbackPanel(wrapper).props('file')).toBeNull()
    expect(playbackPanel(wrapper).props('file')).not.toBe(a)
  })

  it('Case D: 显式选择 b 后 AI → results → AI：target 仍是 b，面板不销毁', async () => {
    const a = new File(['r'], 'a.wotbreplay')
    const b = new File(['r'], 'b.wotbreplay')
    const wrapper = mountWs([a, b], makeBattleResp('b.wotbreplay'), { authenticated: true, login: vi.fn() }, 'b0')
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(b)
    const vmBefore = aiPanel(wrapper).vm
    // AI → results → AI：workspaceFile 不被清空，v-show 不销毁组件
    await wrapper.find('[data-testid="workspace-results-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none')
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(b)
    expect(aiPanel(wrapper).vm).toBe(vmBefore)
  })

  it('Case E: 显式 target=b 后删除 b → workspaceFile 失效为空态，不自动切到 a', async () => {
    const a = new File(['r'], 'a.wotbreplay')
    const b = new File(['r'], 'b.wotbreplay')
    const wrapper = mountWs([a, b], makeBattleResp('b.wotbreplay'), { authenticated: true, login: vi.fn() }, 'b0')
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(b)
    // 删除 b：真实 files ref 变化触发 watch(files) 失效 target，不得改指 a
    wrapper.vm.files = [a]
    await flushPromises()
    expect(aiPanel(wrapper).props('file')).toBeNull()
    expect(aiPanel(wrapper).props('file')).not.toBe(a)
  })

  it('Case F: 唯一文件 AI → playback → AI：同一 File reference，AI 面板不因切 Tab 重建', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const wrapper = mountWs([f])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(f)
    const vmBefore = aiPanel(wrapper).vm
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(toRaw(playbackPanel(wrapper).props('file'))).toBe(f)
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none') // v-show 隐藏而非销毁
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(toRaw(aiPanel(wrapper).props('file'))).toBe(f)
    expect(aiPanel(wrapper).vm).toBe(vmBefore) // 未重建
  })

  it('唯一文件未登录直接点击「AI 复盘」Tab → 与快捷入口统一登录门禁（confirm + login，不切换、不设置 target）', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const login = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWs([f], null, { authenticated: false, login })
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(login).toHaveBeenCalledWith('replay')
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).toBe('none') // 不切换
    expect(aiPanel(wrapper).props('file')).toBeNull() // 不设置 target
    confirmSpy.mockRestore()
  })

  it('多文件未登录直接点击「战局回放」Tab → 无 target 保持空态，不触发登录门禁', async () => {
    const a = new File(['r'], 'a.wotbreplay')
    const b = new File(['r'], 'b.wotbreplay')
    const login = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = mountWs([a, b], null, { authenticated: false, login })
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(confirmSpy).not.toHaveBeenCalled() // 无目标无需门禁（与快捷按钮禁用态一致）
    expect(login).not.toHaveBeenCalled()
    expect(playbackPanel(wrapper).props('file')).toBeNull()
    confirmSpy.mockRestore()
  })
})

describe('ReplayPage playback 加载门控（file identity 与 active 解耦，真实 BattlePlaybackPanel）', () => {
  /** /api/replay/map-overview 成功响应 mock（与 ReconstructionPage.test 同款契约）。 */
  function mapJsonResponse(overview) {
    return { ok: true, status: 200, json: vi.fn().mockResolvedValue(overview) }
  }

  function mapOverviewFixture(mapCode = 'desert_train') {
    return {
      mapCode, displayName: 'Map', displayNames: { zh: '图', en: 'Map', ru: 'Карта' },
      friendlyTeam: 1, playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
      gridCells: [], spawnPoints: [], phases: [],
      heatmaps: { friendly: { dwell: [], damage: [], deaths: [] }, enemy: { dwell: [], damage: [], deaths: [] } },
      routes: [], arenaBonusType: 1, recorderAccountId: null, playback: null
    }
  }

  /** 记录 MapOverview seekTo 的 stub（含初始值与 watch 变化）。 */
  function mapSeekStub(seen) {
    return {
      name: 'MapOverview',
      props: ['overview', 'seekTo'],
      setup(props) {
        seen.push(props.seekTo)
        watch(() => props.seekTo, v => seen.push(v))
        return () => null
      }
    }
  }

  /** 记录 MapOverview 挂载/卸载生命周期（折叠/切 tab 应为 v-show 语义，不销毁组件）。 */
  function mapLifecycleStub(seen, lifecycle) {
    return {
      name: 'MapOverview',
      props: ['overview', 'seekTo'],
      setup(props) {
        seen.push(props.seekTo)
        watch(() => props.seekTo, v => seen.push(v))
        onMounted(() => lifecycle.push('mount'))
        onUnmounted(() => lifecycle.push('unmount'))
        return () => null
      }
    }
  }

  /** 记录 MapOverview overview.mapCode 的 stub（分辨 A/B 数据）。 */
  function mapCodeStub(seenCodes) {
    return {
      name: 'MapOverview',
      props: ['overview', 'seekTo'],
      setup(props) {
        seenCodes.push(props.overview ? props.overview.mapCode : null)
        return () => null
      }
    }
  }

  /** 可控 deferred fetch：按调用顺序记录 resolver；可选收集 AbortSignal。 */
  function deferredFetch(signals = []) {
    const resolvers = []
    const mock = vi.fn((url, opts = {}) => {
      if (opts.signal) signals.push(opts.signal)
      return new Promise(resolve => { resolvers.push(resolve) })
    })
    mock.resolvers = resolvers
    return mock
  }

  function mountWsReal(files, { resp = null, activeTab = 'aggregate', mapStub = null, auth } = {}) {
    state.init = { activeTab, resp, error: '', loading: false, locale: 'en', files }
    const overrides = { realPlayback: true, mapStub }
    if (auth) overrides.auth = auth
    return mountPage(overrides)
  }

  function mapCalls(fetchMock) {
    return fetchMock.mock.calls.filter(([u]) => String(u) === '/api/replay/map-overview').length
  }

  function makeTwoBattleResp() {
    return {
      aggregate: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }],
      battles: [
        { mapName: 'Lagoon', sourceName: 'a.wotbreplay', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
        { mapName: 'Frozen', sourceName: 'b.wotbreplay', players: [{ cells: { nickname: 'P2', damage_dealt: 4000 } }] }
      ],
      duplicates: [], failures: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      aggregateColumns: [{ key: 'nickname', label: '昵称' }]
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Case 1: 唯一文件直接点击「AI 复盘」→ AiReviewPanel 拿到文件，但 map-overview 请求 = 0', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const fetchMock = vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture()))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([f])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(toRaw(wrapper.findComponent({ name: 'AiReviewPanel' }).props('file'))).toBe(f)
    expect(mapCalls(fetchMock)).toBe(0)
  })

  it('Case 2: 唯一文件直接点击「战局回放」→ map-overview 请求 = 1', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const fetchMock = vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture()))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([f])
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(1)
  })

  it('Case 3: AI → Playback：AI 阶段无 map 请求，切 Playback 后才出现第 1 次', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const fetchMock = vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture()))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([f])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(0)
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(1)
  })

  it('Case 4: Playback 完成 → AI → Playback：map 请求总数仍 = 1，MapOverview 不销毁', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const seen = []
    const lifecycle = []
    const fetchMock = vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture()))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([f], { mapStub: mapLifecycleStub(seen, lifecycle) })
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(1)
    expect(lifecycle).toEqual(['mount'])
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).toBe('none') // v-show 隐藏而非销毁
    expect(lifecycle).toEqual(['mount'])
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(1) // 已加载同文件：不重复请求
    expect(lifecycle).toEqual(['mount']) // 同一 MapOverview 实例
  })

  it('Case 5: AI 报告时间链接 seek → 自动切 Playback、未加载则请求 map、seek 传给 MapOverview', async () => {
    const f = new File(['r'], 'single.wotbreplay')
    const seen = []
    const fetchMock = vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture()))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([f], { mapStub: mapSeekStub(seen) })
    await wrapper.find('[data-testid="workspace-ai-tab"]').trigger('click')
    await flushPromises()
    expect(mapCalls(fetchMock)).toBe(0)
    // AI 报告时间链接：由 AiReviewPanel 上抛 seek 事件
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('seek', 200)
    await flushPromises()
    expect(panelDisplay(wrapper, 'workspace-playback-panel')).not.toBe('none') // 已切到 Playback
    expect(mapCalls(fetchMock)).toBe(1) // 未加载：自动请求
    expect(seen).toContain(200) // seek 传给 MapOverview
  })

  it('Case 6: A 正在 map load → 切换 target B：A abort、迟到响应不覆盖、B 进入 Playback 后才加载', async () => {
    const a = new File(['r'], 'a.wotbreplay')
    const b = new File(['r'], 'b.wotbreplay')
    const seenCodes = []
    const signals = []
    const fetchMock = deferredFetch(signals)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountWsReal([a, b], { resp: makeTwoBattleResp(), activeTab: 'b0', mapStub: mapCodeStub(seenCodes) })
    // 显式选 A（battle toolbar）进入 Playback：A 请求 in-flight
    await wrapper.find('[data-testid="battle-playback-btn"]').trigger('click')
    await flushPromises()
    expect(fetchMock.resolvers.length).toBe(1)
    // 切换到 battle B（AI tab，未进入 Playback）：A 请求被 abort，B 不加载
    state.setActiveTab('b1')
    await flushPromises()
    await wrapper.find('[data-testid="battle-ai-btn"]').trigger('click')
    await flushPromises()
    expect(signals[0].aborted).toBe(true) // A 在途请求已取消
    expect(fetchMock.resolvers.length).toBe(1) // B 未进入 Playback 前不发起请求
    // A 迟到响应不得覆盖 B（generation 失效）
    fetchMock.resolvers[0](mapJsonResponse(mapOverviewFixture('rift')))
    await flushPromises()
    expect(seenCodes.filter(c => c === 'rift')).toHaveLength(0) // A 从未显示
    // 进入 Playback：B 开始加载并显示
    await wrapper.find('[data-testid="workspace-playback-tab"]').trigger('click')
    await flushPromises()
    expect(fetchMock.resolvers.length).toBe(2) // B 请求
    fetchMock.resolvers[1](mapJsonResponse(mapOverviewFixture('desert_train')))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
    expect(seenCodes).toContain('desert_train')
  })
})

describe('ReplayPage League Rating', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'b0', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  it('renders league validation failures as collapsible summary, details on expand', async () => {
    state.init.resp = makeResp({
      battles: [
        { mapName: 'Lagoon', league: null, players: [] },
      ],
      league: {
        mode: 'LEAGUE_RATING',
        failures: [
          { fileName: 'bad.wotbreplay', arenaId: '111', code: 'LEAGUE_NOT_SEVEN_VS_SEVEN' }
        ]
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    // 默认：汇总可见，详情（文件名/错误码）折叠——不得默认铺满红色解析失败
    expect(wrapper.find('[data-testid="league-failure-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('error')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('warn')
    expect(wrapper.text()).toContain('league.rated_count')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('.error').exists()).toBe(false)
    // 展开详情 → 分组错误码 + 展开分组 → 具体文件与 arenaId
    await wrapper.find('[data-testid="league-failure-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('LEAGUE_NOT_SEVEN_VS_SEVEN')
    expect(wrapper.find('[data-testid="league-failure-files"]').exists()).toBe(false)
    await wrapper.find('[data-testid="league-failure-group"]').trigger('click')
    expect(wrapper.text()).toContain('bad.wotbreplay')
    expect(wrapper.text()).toContain('111')
  })

  it('shows aggregate tab in league mode (resp.league is the page source of truth)', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [],
        playerSummaryColumns: [],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    const tabs = wrapper.findAll('button')
    expect(tabs.some(b => b.text().includes('result.aggregate_tab'))).toBe(true)
  })

  it('battle rename only updates battle overrides (no summary pollution)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['111:1'] = 'CHRD'
    expect(wrapper.vm.battleTeamNames['111:1']).toBe('CHRD')
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('summary rename only updates teamKey overrides (no battle pollution)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    expect(wrapper.vm.summaryTeamNames['clan:CHRD']).toBe('CHRD A队')
    expect(wrapper.vm.battleTeamNames).toEqual({})
  })

  it('export passes battle + summary overrides payload (PR #123 Blocker 1)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['111:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    const exportBtn = wrapper.findAll('button').find(b => b.text().includes('action.export_aggregate'))
    await exportBtn.trigger('click')
    expect(state.replay.startExportJob).toHaveBeenCalledWith('aggregate', {
      battle: { '111:1': 'CHRD' },
      summary: { 'clan:CHRD': 'CHRD A队' }
    })
  })

  it('clears both overrides when replay selection changes (PR #123 Blocker 2)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    expect(wrapper.vm.battleTeamNames).not.toEqual({})
    // 触发真实 selection 变化（统一 updateFiles 入口 → selectionRevision++）
    wrapper.vm.updateFiles(['b.wotbreplay'])
    await nextTick()
    expect(wrapper.vm.battleTeamNames).toEqual({})
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('removing a single replay also clears overrides (PR #123 Blocker 2)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    // 删除单个 replay：同样走 updateFiles → selection 变化
    wrapper.vm.updateFiles(['a.wotbreplay'])
    await nextTick()
    expect(wrapper.vm.battleTeamNames).toEqual({})
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('re-processing same selection does NOT clear overrides (PR #123 Blocker 2)', async () => {
    state.init.resp = makeResp({ league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    // 同一 selection 重新解析：selectionRevision 不变 → overrides 保留
    wrapper.vm.startProcessingJob()
    await nextTick()
    expect(wrapper.vm.battleTeamNames['arenaA:1']).toBe('CHRD')
    expect(wrapper.vm.summaryTeamNames['clan:CHRD']).toBe('CHRD A队')
  })
})

describe('ReplayPage result visibility (P0: no blank results; league mode from resp.league)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('多场 + aggregate 空 + 无 league：battle tabs 存在且 BattleTable panel 可见（不再空白）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { mapName: 'Lagoon', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
        { mapName: 'Frozen', players: [{ cells: { nickname: 'P2', damage_dealt: 4000 } }] }
      ]
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage()
    await flushPromises()
    // 两个 battle tabs 都存在
    const tabs = wrapper.findAll('button')
    expect(tabs.some(b => b.text().includes('Lagoon #1'))).toBe(true)
    expect(tabs.some(b => b.text().includes('Frozen #2'))).toBe(true)
    // 至少一个 BattleTable panel 可见（结果区不为空）
    const battlePanels = wrapper.findAll('.battle-table-stub')
    expect(battlePanels.length).toBeGreaterThan(0)
    expect(battlePanels[0].isVisible()).toBe(true)
    // aggregate 空 → AggregateTable 不渲染（v-if 由 resp.aggregate 驱动，plan §5）
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式以 resp.league 为唯一事实源：即使 playerColumns 无 league_rating，aggregate tab + 统一玩家表也显示', async () => {
    delete window.__testLeagueMode // 列派生 league mode 必须关闭
    state.init.resp = makeResp({
      aggregate: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }], // 不含 league_rating
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', ratingMedian: 1500, battles: 5, wins: 3, damageTotal: 25000, killsTotal: 10, dimensionMedians: [] }],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const tabs = wrapper.findAll('button')
    expect(tabs.some(b => b.text().includes('result.aggregate_tab'))).toBe(true)
    // CW 模式：玩家信息只走统一玩家表（plan §1.3），不再渲染两张平级玩家表
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式 + aggregate 有数据：统一玩家表唯一存在（plan §1.3），战队表独立', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
        { cells: { nickname: 'P2', damage_dealt: 3000 } }
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }], // 不含 league_rating
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', ratingMedian: 900, battles: 2, wins: 1, damageTotal: 9000, killsTotal: 4, dimensionMedians: [] }],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    // CW 模式：玩家只有一个主表（统一表），基础 AggregateTable 与 League 玩家表都不得再出现
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    expect(wrapper.find('[data-testid="base-aggregate-title"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('league 0/30：统一玩家表仍显示全部 aggregate 玩家（缺失 League 补 --），战队显示空态，tab 人数来自 resp.aggregate', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
        { cells: { nickname: 'P2', damage_dealt: 3000 } }
      ],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    // 0 可评分 ≠ Replay 没数据：统一玩家表仍渲染 aggregate 玩家（plan §21 Missing side 不删玩家）
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    // 战队区块为明确 neutral 空态，而不是 "--"
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="league-summary-empty"]').classes()).not.toContain('error')
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    // 汇总 tab 人数来自 resp.aggregate（2），不是 league.playerSummaries（0）
    const tabs = wrapper.findAll('button')
    const aggTab = tabs.find(b => b.text().includes('result.aggregate_tab'))
    expect(aggTab.text()).toContain('result.aggregate_tab:2')
    wrapper.unmount()
  })

  it('无 battles 无 aggregate 无 league：显示空态提示，不崩溃不空白', async () => {
    state.init.resp = makeResp({ aggregate: [], battles: [], league: null })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('replay.no_results')
    expect(wrapper.findAll('.battle-table-stub').length).toBe(0)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })
})
describe('ReplayPage Player Detail Drawer (plan §8/§23)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  function leagueResp() {
    return makeResp({
      aggregate: [
        { team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', battles: 3, wins: 2, damage_avg: 500, earned_avg: 80 } },
        { team: 2, cells: { account_id: 2001, nickname: 'Beta', clan: 'BBB', battles: 2, wins: 0, damage_avg: 300, earned_avg: 40 } },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 3, ratingMedian: 850.4, dimensionMedians: [342, 60, 70, 110, 40, 80, 100], mvpCount: 2, wins: 2 },
        ],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
  }

  it('默认关闭（plan §8.2）', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toBe('closed')
    wrapper.unmount()
  })

  it('点击统一表玩家行 → 打开 Drawer 并带 accountId（plan §8.3/§8.7）', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    expect(rows.length).toBe(2)
    await rows[0].trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })

  it('点击另一玩家 → Drawer 不关闭，内容切换（plan §8.5）', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    await rows[1].trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:2001')
    wrapper.unmount()
  })

  it('排序后 selected accountId 不变（plan §8.7/§23 Sorting）', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    // 排序：点击 nickname 表头 → ASC（Alpha/Beta 不变顺序）
    const th = wrapper.findAll('.cw-player-summary th').find(t => t.text().includes('nickname'))
    await th.trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })

  it('Tab 切换关闭 Drawer（plan §8.9）', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    await rows[0].trigger('click')
    state.setActiveTab('b0')
    await nextTick()
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toBe('closed')
    wrapper.unmount()
  })
})
describe('ReplayPage CW unified table column contract + CW/Rating boundary (review PR#134 BLOCKER 2/3)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
    delete window.__testCwVisible
    delete window.__testCwOrder
  })

  /** 富 league 响应：playerSummaryColumns 含七维 + mvp_count + perf；aggregateColumns 含 facts。 */
  function cwResp() {
    return makeResp({
      aggregate: [
        { team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', battles: 12, wins: 8, win_rate: 66.7, damage_avg: 500, earned_avg: 80, contribution: 22.4, kast: 100, impact: 151.2 } },
        { team: 2, cells: { account_id: 2001, nickname: 'Beta', clan: 'BBB', battles: 12, wins: 4, win_rate: 33.3, damage_avg: 300, earned_avg: 40, contribution: 18.1, kast: 80, impact: 120.5 } },
      ],
      aggregateColumns: [
        { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
        { key: 'wins', num: true }, { key: 'win_rate', num: true }, { key: 'damage_avg', num: true },
        { key: 'earned_avg', num: true }, { key: 'contribution', num: true }, { key: 'kast', num: true },
        { key: 'impact', num: true },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [
          { key: 'league_rating', max: 1000, fixed: true },
          { key: 'league_damage_score', max: 400 },
          { key: 'league_shooting_score', max: 100 },
        ],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 8, ratingMedian: 850.4, dimensionMedians: [342, 60, 70, 110, 40, 80, 100], mvpCount: 2, wins: 8, contribution: 22.4, kast: 100, impact: 151.2 },
        ],
        playerSummaryColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
          { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
          { key: 'league_shooting_score', num: true }, { key: 'mvp_count', num: true },
          { key: 'wins', num: true }, { key: 'contribution', num: true }, { key: 'kast', num: true },
          { key: 'impact', num: true },
        ],
        teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
  }

  function cwThKeys(wrapper) {
    // $t mock 返回完整 key（'agg_labels.nickname'）→ 去掉前缀还原列 key
    return wrapper.findAll('.cw-player-summary th').map(t =>
      t.text().replace(/[▼▲]/g, '').replace(/^agg_labels\./, ''))
  }

  it('统一表列 = cw scope 可见列：七维/MVP 不是 forced visible（BLOCKER 2.6）', async () => {
    window.__testCwVisible = ['nickname', 'league_rating', 'clan', 'battles', 'wins', 'win_rate',
      'damage_avg', 'earned_avg', 'contribution', 'kast', 'impact']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    // 七维/MVP 不在 cwVisibleKeys → 不渲染（不再是 alwaysVisible）
    expect(keys).not.toContain('league_damage_score')
    expect(keys).not.toContain('mvp_count')
    // nickname + league_rating 固定出现
    expect(keys[0]).toBe('nickname')
    expect(keys[1]).toBe('league_rating')
    // 表现指标与 facts 可显示
    expect(keys).toContain('contribution')
    expect(keys).toContain('kast')
    expect(keys).toContain('impact')
    expect(keys).toContain('earned_avg')
    wrapper.unmount()
  })

  it('用户自定义顺序生效：nickname + league_rating 固定前两位，其余按偏好顺序（BLOCKER 2.8/2.11）', async () => {
    window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating',
      'impact', 'kast', 'damage_avg', 'league_damage_score', 'earned_avg']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    expect(keys).toEqual(['nickname', 'league_rating', 'impact', 'kast', 'damage_avg', 'league_damage_score', 'earned_avg'])
    wrapper.unmount()
  })

  it('leagueMode=true + 该场 league=null（Rating-ineligible CW 场）：battle 点击仍打开 Drawer（BLOCKER 3.4）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: null, players: [{ team: 1, cells: { account_id: 1001, nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [], playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
    state.init.activeTab = 'b0'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          props: ['battle', 'league', 'leagueMode'],
          emits: ['select-player'],
          template: '<div class="battle-table-stub" data-testid="battle-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    // leagueMode=true（CW 批次），即使该场 league=null：仍是 CW UI
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    await wrapper.find('.battle-table-stub').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    wrapper.unmount()
  })
})
describe('ReplayPage League failure UX separation (plan §23 Test 1-7)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })

  function manyBattles(count, leagueFlags = true) {
    const out = []
    for (let i = 0; i < count; i++) {
      out.push({ mapName: 'Lagoon', sourceName: 'b' + i + '.wotbreplay', league: leagueFlags ? null : undefined, players: [{ cells: { nickname: 'P' + i, damage_dealt: 100 } }] })
    }
    return out
  }

  function manyLeagueFailures(count, code) {
    const out = []
    for (let i = 0; i < count; i++) out.push({ fileName: 'b' + i + '.wotbreplay', arenaId: 'arena-' + i, code })
    return out
  }

  it('Test 1: valid=30 duplicate=5 failed=0 + leagueFailures=30 → 卡片计数正确，无红色「文件解析失败」，League 汇总为 warning', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(30, true),
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    pJobState.setJob({ jobId: 'p1', status: 'READY', phase: null, total: 35, processed: 35, valid: 30, duplicates: 5, failures: 0 })
    await flushPromises()
    const card = wrapper.find('[data-testid="replay-task-card"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('replay.processing_job.counts:30,5,0')
    // 不得出现红色解析失败块（result.failures 只用于真正 parser failure）
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('result.failures')
    // League failure 汇总存在且为 warning 语义
    const summary = wrapper.find('[data-testid="league-failure-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.classes()).toContain('warn')
    expect(summary.classes()).not.toContain('error')
    wrapper.unmount()
  })

  it('Test 2: League failure 汇总含可评分/未生成计数，可展开分组详情', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(3, true),
      league: {
        mode: 'LEAGUE_RATING',
        failures: [
          ...manyLeagueFailures(2, 'LEAGUE_ROSTER_INCOMPLETE'),
          { fileName: 'b2.wotbreplay', arenaId: 'arena-2', code: 'LEAGUE_ROSTER_MISMATCH' }
        ]
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('league.rated_count:0,3')
    expect(wrapper.text()).toContain('league.unrated_count:3')
    await wrapper.find('[data-testid="league-failure-toggle"]').trigger('click')
    const groups = wrapper.findAll('[data-testid="league-failure-group"]')
    expect(groups.length).toBe(2)
    expect(groups[0].text()).toContain('LEAGUE_ROSTER_INCOMPLETE')
    expect(groups[0].text()).toContain('2')
    wrapper.unmount()
  })

  it('Test 3: League failure 不使用 destructive error 呈现（类为 warn 非 error）', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(1, true),
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(1, 'LEAGUE_NOT_SEVEN_VS_SEVEN') }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('warn')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('error')
    expect(wrapper.find('.error').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Test 4: 30 Battle + 0 Rating → battle tabs 全部存在，可逐场查看', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(30, true),
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(30)
    wrapper.unmount()
  })

  it('Test 5/6: League-ineligible Battle 的 AI 复盘 / 战局回放 action 正常可用', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(1, true),
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(1, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage()
    await flushPromises()
    const aiBtn = wrapper.find('[data-testid="battle-ai-btn"]')
    const pbBtn = wrapper.find('[data-testid="battle-playback-btn"]')
    expect(aiBtn.exists()).toBe(true)
    expect(pbBtn.exists()).toBe(true)
    expect(aiBtn.attributes('disabled')).toBeUndefined()
    expect(pbBtn.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('Test 7: 真正 parser failure 仍显示红色「文件解析失败」（不降级成 warning）', async () => {
    state.init.resp = makeResp({
      failures: [['broken.wotbreplay', 'REPLAY_PROCESSING_FAILED']]
    })
    const wrapper = mountPage()
    await flushPromises()
    const errBlock = wrapper.find('.error')
    expect(errBlock.exists()).toBe(true)
    expect(errBlock.text()).toContain('result.failures:1')
    expect(errBlock.text()).toContain('broken.wotbreplay')
    wrapper.unmount()
  })

  it('mixed 批次：leagueUnavailableCode 显示琥珀色提示，battles 正常渲染（plan §21）', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(2, false),
      leagueUnavailableCode: 'MIXED_LEAGUE_AND_STANDARD_REPLAYS'
    })
    const wrapper = mountPage()
    await flushPromises()
    const notice = wrapper.find('[data-testid="league-unavailable"]')
    expect(notice.exists()).toBe(true)
    expect(notice.classes()).toContain('warn')
    expect(wrapper.text()).toContain('league.unavailable_mixed')
    expect(wrapper.findAll('.battle-table-stub').length).toBe(2)
    expect(wrapper.find('.error').exists()).toBe(false)
    wrapper.unmount()
  })
})
