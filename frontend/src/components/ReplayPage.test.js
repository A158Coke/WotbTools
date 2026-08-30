// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref, computed, toRaw, watch, onMounted, onUnmounted } from 'vue'
import ReplayPage from './ReplayPage.vue'
import { setUiProfile } from '../composables/useUiProfile.js'

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
    // 无覆盖时 teamNamesPayload() = null（名称必须经 payload 传递）
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

/** requestDirectAction 可控制 impl（deferred Promise 决定 resolve 顺序）。 */
const directActionHolder = vi.hoisted(() => {
  let impl = async () => ({ processingJobId: 'p1', sourceId: 'r0' })
  return {
    setImpl: (fn) => { impl = fn },
    fn: () => vi.fn(impl),
    reset: () => { impl = async () => ({ processingJobId: 'p1', sourceId: 'r0' }) }
  }
})

/** stale 失败不得写 processingError（持有 useReplay mock 的 error ref）。 */
const wsErrState = vi.hoisted(() => {
  let ref = null
  return {
    capture: (r) => { ref = r },
    get value() { return ref ? ref.value : undefined }
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
      const processingErrorRef = ref('')
      jobState.capture(exportJobRef, exportActiveRef)
      pJobState.capture(processingJobRef, processingActiveRef, processingJobIdRef)
      wsErrState.capture(processingErrorRef)
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
        processingJob: processingJobRef, processingError: processingErrorRef, processingActive: processingActiveRef,
        processingJobId: processingJobIdRef,
        uploadState: ref(null), cancelProcessing: vi.fn(),
        requestDirectAction: directActionHolder.fn(),
        startProcessingJob, cancelProcessingJob: vi.fn(),
        dismissProcessingJob: vi.fn(), invalidateExpiredProcessingDataset: vi.fn(),
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
      // window.__testCwVisible / __testCwOrder 模拟 useColumns cw scope
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
        // 测试 seam：当前视图列（PNG 所见即所得断言用）
        shownCols: computed(() => window.__testShownCols || []),
        shownAggCols: computed(() => window.__testShownAggCols || []),
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
        AiReviewPanel: { name: 'AiReviewPanel', props: ['file'], template: '<div class="ai-panel-stub" />' },
        ...(overrides.realPlayback
          ? (overrides.mapStub ? { MapOverview: overrides.mapStub } : {})
          : { BattlePlaybackPanel: { name: 'BattlePlaybackPanel', props: ['file', 'active', 'seekTo'], template: '<div class="playback-panel-stub" />' } }),
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
        PlayerDetailDrawer: { props: ['context', 'player'], template: '<div class="drawer-stub">{{ context ? "open:" + context.accountId + ":" + JSON.stringify(player || {}) : "closed" }}</div>' },
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

  it('renders inline processing panel with real 18/34 parse progress', async () => {
    state.init.resp = null
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="replay-processing-panel"]').exists()).toBe(false)
    pJobState.setJob({ jobId: 'p1', status: 'PROCESSING', phase: 'PROCESSING_REPLAYS', total: 34, processed: 18, valid: 16, duplicates: 2, failures: 1, currentFile: 'x.wotbreplay' })
    await flushPromises()
    const panel = wrapper.find('[data-testid="replay-processing-panel"]')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain('replay.processing_job.title')
    expect(panel.text()).toContain('replay.processing_job.progress')
  })

  it('processing panel and export card coexist (no mutual exclusion)', async () => {
    state.init.resp = null
    const wrapper = mountPage()
    pJobState.setJob({ jobId: 'p1', status: 'READY', phase: null, total: 34, processed: 34, valid: 31, duplicates: 2, failures: 1 })
    jobState.setJob({ jobId: 'e1', status: 'PROCESSING', phase: 'BUILDING_EXCEL', total: 34, processed: 34, duplicates: 0, failures: 0 })
    await flushPromises()
    const panel = wrapper.find('[data-testid="replay-processing-panel"]')
    expect(panel.exists()).toBe(true, "Export 存在时 Processing 进度不得被隐藏")
    const cards = wrapper.findAll('[data-testid="replay-task-card"]')
    expect(cards.length).toBe(1, "Export 仍使用独立任务卡")
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

    it('uses profile-derived theme:classic→light, showcase→dark (data-theme 由 useUiProfile 派生)', async () => {
      state.init.resp = makeResp()
      // classic → data-theme=light → 浅色导出
      setUiProfile('classic')
      h2c.resetCalls()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#ffffff')
      // showcase → data-theme=dark → 深色导出
      setUiProfile('showcase')
      h2c.resetCalls()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
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
      return wrapper.findAll('.restoolbar .dataview-toggle button').find(b => b.classes().includes('active'))
    }

    it('setActiveTab changes activeTab ref before mount', () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      const btn = activeTabButton(wrapper)
      expect(btn.text()).toContain('result.single_tab')
    })

    it('setActiveTab changes activeTab ref after mount', async () => {
      state.init.resp = makeResp()
      wrapper = mountPage()
      expect(activeTabButton(wrapper).text()).toContain('result.aggregate_tab')
      state.setActiveTab('b0')
      await flushPromises()
      expect(activeTabButton(wrapper).text()).toContain('result.single_tab')
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
      return wrapper.findAll('.restoolbar .dataview-toggle button').find(b => b.classes().includes('active'))
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

    it('bataille switch b0->b1: filename still Lagoon (view follows currentSingleIndex, export target pinned)', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Lagoon')

      // Verify we're in single view (b0)
      expect(activeTabButton(wrapper).text()).toContain('result.single_tab')
      expect(activeTabButton(wrapper).text()).not.toContain('result.aggregate_tab')

      // Switch to b1 via REAL ref: view still single (toggle unchanged), target row follows currentSingleIndex
      state.setActiveTab('b1')
      await flushPromises()
      expect(activeTabButton(wrapper).text()).toContain('result.single_tab')

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

    it('bataille switch b1->aggregate: filename still Frozen (export target pinned)', async () => {
      state.init.resp = makeResp()
      state.init.activeTab = 'b1'
      wrapper = mountPage()
      vi.spyOn(document.body, 'appendChild')

      await startExportAndWaitForH2c()
      expect(h2c.getCalls()[0][0].textContent).toContain('Frozen')
      expect(activeTabButton(wrapper).text()).toContain('result.single_tab')

      state.setActiveTab('aggregate')
      await flushPromises()
      expect(activeTabButton(wrapper).text()).toContain('result.aggregate_tab')
      expect(activeTabButton(wrapper).text()).not.toContain('result.single_tab')

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

  describe('export clone html2canvas-safe preparation (regression: color-mix -> color(srgb) PNG failure)', () => {
    function leagueResp() {
      return makeResp({
        aggregate: [],
        battles: [{ mapName: 'Lagoon', players: [], league: null }],
        playerColumns: [], aggregateColumns: [],
        leagueMode: true,
        league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [] },
      })
    }

    function captureClone() {
      let clone = null
      interceptAppendChild(node => {
        const c = node.querySelector?.('.replay-export-root')
        if (c) clone = c
      })
      return () => clone
    }

    // 视图忠实 stub：渲染 sticky 列 + selected 行（正是 color-mix 所在 selector），
    // 用于验证 prepareReplayExportClone 把 clone 变成确定性静态快照。
    function safeStubs() {
      return {
        CwPlayerSummaryTable: {
          props: ['columns'],
          template: '<div class="cw-player-summary"><div class="tablewrap"><table>' +
            '<thead><tr><th class="sticky-col">nickname</th><th>rating</th></tr></thead>' +
            '<tbody><tr class="t1 selected"><td class="sticky-col sticky-t1">A</td><td>1</td></tr>' +
            '<tr class="t2"><td class="sticky-col sticky-t2">B</td><td>2</td></tr>' +
            '</tbody></table></div></div>'
        },
      }
    }

    it('clone is a static snapshot: sticky neutralized, selected removed, export theme applied', async () => {
      state.init.resp = leagueResp()
      state.init.activeTab = 'aggregate'
      wrapper = mountPage({ stubs: safeStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const clone = getClone()
      expect(clone).toBeTruthy()
      const classes = clone.className.split(' ').filter(Boolean)
      expect(classes).toContain('replay-export-root')
      expect(classes).toContain('replay-export-light')
      const sticky = clone.querySelectorAll('.sticky-col')
      expect(sticky.length).toBeGreaterThan(0)
      for (const el of sticky) {
        expect(el.style.position).toBe('static')
        expect(el.style.left).toBe('auto')
        expect(el.style.right).toBe('auto')
        expect(el.style.zIndex).toBe('auto')
      }
      expect(clone.querySelector('.selected')).toBeNull()
    })

    it('logs a detailed console.error with the real exception when html2canvas rejects', async () => {
      const err = new Error('unsupported color function color')
      h2c.setImpl(() => Promise.reject(err))
      state.init.resp = makeResp()
      wrapper = mountPage()
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0][0]).toContain('[Replay PNG Export]')
      expect(spy.mock.calls[0][1]).toBe(err)
      spy.mockRestore()
    })

    it('export-safe CSS overrides every color-mix-bearing table cell/header selector', async () => {
      const src = (await import('./ReplayPage.vue?raw')).default
      expect(src).toMatch(/\.replay-export-root \.sticky-col \{[\s\S]*?position: static !important;/)
      expect(src).toMatch(/\.replay-export-root tbody tr\.t1 td \{[\s\S]*?background: var\(--exp-t1-bg\) !important;/)
      expect(src).toMatch(/\.replay-export-root tbody tr\.t2 td \{[\s\S]*?background: var\(--exp-t2-bg\) !important;/)
      expect(src).toMatch(/\.replay-export-root \.league-summary-empty \{[\s\S]*?background: var\(--exp-card-bg\) !important;/)
    })
  })

  describe('league PNG export（PNG = 当前视图，所见即所得）', () => {
    afterEach(() => {
      delete window.__testCwVisible
      delete window.__testCwOrder
      delete window.__testShownCols
      delete window.__testShownAggCols
    })

    function leaguePngResp() {
      return makeResp({
        aggregate: [],
        battles: [
          {
            mapName: 'Lagoon', league: { mvpAccountId: 1001 },
            players: [
              { team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', tank_name: 'KV-2', damage_dealt: 5000, damage_assisted: 900, kills: 3, contribution: 22.4, kast: 100, impact: 151.2, league_rating: 927.4, league_damage_score: 342, league_shooting_score: 100, victory_points_earned: 5 } },
              { team: 2, cells: { account_id: 2001, nickname: 'Beta', clan: 'BBB', tank_name: 'IS-7', damage_dealt: 3000, damage_assisted: 400, kills: 1, contribution: null, kast: null, impact: 80.5, league_rating: null, league_damage_score: null, league_shooting_score: null, victory_points_earned: 0 } },
            ],
          },
        ],
        playerColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'tank_name', num: false },
          { key: 'damage_dealt', num: true }, { key: 'damage_assisted', num: true }, { key: 'kills', num: true },
          { key: 'contribution', num: true }, { key: 'kast', num: true }, { key: 'impact', num: true },
          { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
          { key: 'league_shooting_score', num: true }, { key: 'victory_points_earned', num: true },
        ],
        leagueMode: true,
        league: {
          mode: 'LEAGUE_RATING',
          columns: [
            { key: 'league_rating', max: 1000, fixed: true },
            { key: 'league_damage_score', max: 400 },
            { key: 'league_shooting_score', max: 100 },
          ],
          playerSummaries: [], playerSummaryColumns: [],
          teamSummaries: [], teamSummaryColumns: [], failures: [],
        },
      })
    }

    /** 视图忠实 stub：按 props 渲染当前可见列/顺序（PNG 克隆的就是这段 DOM，不再替换）。 */
    function viewStubs() {
      return {
        BattleTable: {
          props: ['battle', 'shownCols'],
          template: '<div class="battle-table-stub"><div class="tablewrap"><table>' +
            '<thead><tr><th v-for="c in shownCols" :key="c.key">player_labels.{{ c.key }}</th></tr></thead>' +
            '<tbody><tr v-for="p in battle.players" :key="p.cells.account_id">' +
            '<td v-for="c in shownCols" :key="c.key">{{ p.cells[c.key] ?? \'--\' }}</td></tr></tbody>' +
            '</table></div></div>'
        },
        CwPlayerSummaryTable: {
          props: ['columns'],
          template: '<div class="cw-player-summary"><div class="tablewrap"><table>' +
            '<thead><tr><th v-for="c in columns" :key="c.key">agg_labels.{{ c.key }}</th></tr></thead>' +
            '<tbody><tr><td>row</td></tr></tbody></table></div></div>'
        },
        LeagueSummaryTable: {
          props: ['columns'],
          template: '<div class="league-summary"><div class="tablewrap"><table>' +
            '<thead><tr><th v-for="c in columns" :key="c.key">league.summary.{{ c.key }}</th></tr></thead>' +
            '<tbody><tr><td>team</td></tr></tbody></table></div></div>'
        },
        AggregateTable: {
          props: ['shownCols'],
          template: '<div class="agg-table-stub"><div class="tablewrap"><table>' +
            '<thead><tr><th v-for="c in shownCols" :key="c.key">agg_labels.{{ c.key }}</th></tr></thead>' +
            '<tbody><tr><td>row</td></tr></tbody></table></div></div>'
        },
      }
    }

    function headerKeys(html) {
      return [...html.matchAll(/<th>([^<]+)<\/th>/g)].map(m => m[1])
    }

    function captureClone() {
      let clone = null
      interceptAppendChild(node => {
        const c = node.querySelector?.('.replay-export-root')
        if (c) clone = c
      })
      return () => clone
    }

    it('单场 Battle PNG：按当前 shownCols 导出（隐藏列不出现，顺序保持）', async () => {
      window.__testShownCols = [{ key: 'nickname' }, { key: 'league_rating' }, { key: 'impact' }, { key: 'damage_dealt' }]
      state.init.resp = leaguePngResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual([
        'player_labels.nickname', 'player_labels.league_rating', 'player_labels.impact', 'player_labels.damage_dealt'
      ])
      // 未勾选的列不得偷偷进入 PNG（不再是「全量列导出」contract）
      expect(headerKeys(html)).not.toContain('player_labels.kast')
      expect(headerKeys(html)).not.toContain('player_labels.kills')
      expect(headerKeys(html)).not.toContain('player_labels.league_damage_score')
      expect(headerKeys(html)).not.toContain('player_labels.victory_points_earned')
    })

    it('单场 Battle PNG：用户自定义顺序严格保留', async () => {
      window.__testShownCols = [{ key: 'nickname' }, { key: 'league_rating' }, { key: 'impact' }, { key: 'kast' }, { key: 'damage_dealt' }]
      state.init.resp = leaguePngResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual([
        'player_labels.nickname', 'player_labels.league_rating', 'player_labels.impact',
        'player_labels.kast', 'player_labels.damage_dealt'
      ])
    })

    it('单场 Battle PNG：Rating-ineligible（league_rating/七维 null）→ --，不得伪造 0 / 0%', async () => {
      window.__testShownCols = [{ key: 'nickname' }, { key: 'league_rating' }, { key: 'league_damage_score' }]
      state.init.resp = leaguePngResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      // Beta（league_rating / 七维 null）→ '--'；不出现 0 / 0% 伪造
      expect(html).toContain('--')
      expect(html).not.toContain('0 / 1000')
      expect(html).not.toContain('0 / 400')
      expect(html).not.toMatch(/0%/g)
    })

    it('CW 汇总 PNG：按当前 cwVisibleKeys 导出（隐藏 KAST/七维不出现，顺序保持）', async () => {
      window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating', 'impact', 'rated_battles', 'damage_avg']
      state.init.resp = makeResp({
        aggregate: [
          { team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', battles: 1, wins: 1, damage_avg: 5000, earned_avg: 5, contribution: 22.4, kast: 100, impact: 151.2 } },
        ],
        aggregateColumns: [
          { key: 'nickname', num: false }, { key: 'battles', num: true }, { key: 'wins', num: true },
          { key: 'damage_avg', num: true }, { key: 'earned_avg', num: true },
          { key: 'contribution', num: true }, { key: 'kast', num: true }, { key: 'impact', num: true },
        ],
        playerColumns: [{ key: 'nickname', num: false }],
        battles: [],
        leagueMode: true,
        league: {
          mode: 'LEAGUE_RATING',
          columns: [
            { key: 'league_rating', max: 1000, fixed: true },
            { key: 'league_damage_score', max: 400 },
          ],
          playerSummaries: [
            { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 1, ratingV5: 927.4, ratingRawMedian: 927.4,
              dimensionMedians: [342, 60, 70, 110, 40, 80, 100], mvpCount: 1, wins: 1,
              contribution: 22.4, kast: 100, impact: 151.2 },
          ],
          playerSummaryColumns: [
            { key: 'nickname', num: false }, { key: 'rated_battles', num: true },
            { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
            { key: 'mvp_count', num: true }, { key: 'contribution', num: true },
            { key: 'kast', num: true }, { key: 'impact', num: true },
          ],
          teamSummaries: [
            { teamKey: 'AAA', autoName: 'AAA', battles: 1, ratingMedian: 900.6,
              dimensionMedians: [300, 50, 60, 90, 30, 70, 80], wins: 1 },
          ],
          teamSummaryColumns: [
            { key: 'team_name', num: false }, { key: 'battles', num: true },
            { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
            { key: 'wins', num: true },
          ],
          failures: [],
        },
      })
      state.init.activeTab = 'aggregate'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const wraps = getClone().querySelectorAll('.tablewrap')
      expect(wraps.length).toBeGreaterThanOrEqual(2) // 玩家统一表 + 战队汇总表
      // 玩家统一表 = 当前 cw 可见列（不包含隐藏的 kast/七维），顺序严格保持
      expect(headerKeys(wraps[0].innerHTML)).toEqual([
        'agg_labels.nickname', 'agg_labels.league_rating', 'agg_labels.impact',
        'agg_labels.rated_battles', 'agg_labels.damage_avg'
      ])
      // 战队汇总表 = 当前完整显示列
      const teamKeys = headerKeys(wraps[1].innerHTML)
      expect(teamKeys[0]).toBe('league.summary.team_name')
      expect(teamKeys).toContain('league.summary.league_rating')
      expect(teamKeys).toContain('league.summary.league_damage_score')
    })

    it('Standard aggregate PNG：按当前 shownAggCols 导出（无全量列替换）', async () => {
      window.__testShownAggCols = [{ key: 'nickname' }, { key: 'battles' }, { key: 'damage_avg' }, { key: 'impact' }]
      state.init.resp = makeResp({
        aggregate: [{ cells: { nickname: 'P1', battles: 2, damage_avg: 5000, impact: 151.2 } }],
        battles: [],
      })
      state.init.activeTab = 'aggregate'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual(['agg_labels.nickname', 'agg_labels.battles', 'agg_labels.damage_avg', 'agg_labels.impact'])
      expect(headerKeys(html)).not.toContain('agg_labels.kast')
    })
  })
})


describe.skip('ReplayPage Battle context actions（旧 Workspace，已迁移至独立 capability views）', () => {
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

describe.skip('ReplayPage 单页 Workspace（已删除：AI/Playback 为独立 views）', () => {
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

  it('Workspace 一级导航是独立 .workspace-tabs，不携带二级 .tabs class（不继承全局 .tabs contract）', () => {
    const wrapper = mountWithFiles([new File(['r'], 'nav.wotbreplay')])
    const nav = wrapper.find('.workspace-tabs')
    expect(nav.exists()).toBe(true)
    expect(nav.classes()).not.toContain('tabs')
    expect(nav.attributes('role')).toBe('tablist')
    // 三个一级能力按钮仍完整存在
    expect(nav.find('[data-testid="workspace-results-tab"]').exists()).toBe(true)
    expect(nav.find('[data-testid="workspace-ai-tab"]').exists()).toBe(true)
    expect(nav.find('[data-testid="workspace-playback-tab"]').exists()).toBe(true)
  })

  it('无文件时不渲染 Workspace（只有上传面板）', () => {
    const wrapper = mountWithFiles([])
    expect(wrapper.find('[data-testid="workspace-ai-tab"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="workspace-ai-panel"]').exists()).toBe(false)
  })

  it('一级 tab active class 跟随切换，业务状态不被 UI 修复改变', async () => {
    const files = [new File(['r'], 'active.wotbreplay')]
    const wrapper = mountWithFiles(files)
    const resultsTab = wrapper.find('[data-testid="workspace-results-tab"]')
    const aiTab = wrapper.find('[data-testid="workspace-ai-tab"]')
    expect(resultsTab.classes()).toContain('active')
    expect(aiTab.classes()).not.toContain('active')
    await aiTab.trigger('click')
    await flushPromises()
    expect(aiTab.classes()).toContain('active')
    expect(resultsTab.classes()).not.toContain('active')
    expect(panelDisplay(wrapper, 'workspace-ai-panel')).not.toBe('none')
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
describe.skip('ReplayPage Workspace target resolution（已删除：独立 capability 页负责目标选择）', () => {
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

describe.skip('ReplayPage playback 加载门控（已迁移至 BattlePlaybackPage）', () => {
  /** /api/replay/map-overview 成功响应 mock（Playback Dataset 契约）。 */
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
    await flushPromises() // 新 async dataset 步骤（requestDirectAction）settle
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
      leagueMode: true,
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

  it('shows death-time unknown quality warning as non-blocking notice (not a failure)', async () => {
    state.init.resp = makeResp({
      battles: [
        { mapName: 'Lagoon', league: { mvp: { nickname: 'X' }, team1: {}, team2: {} }, players: [] },
      ],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        failures: [],
        ratingQuality: { unknownDeathTimePlayers: 5 }
      }
    })
    const wrapper = mountPage()
    await flushPromises()
    // 修复后场景：0 failure、全部评分（可评分 1 / 1），但存在 5 名死亡时间 UNKNOWN 玩家
    // → 只显示非阻断 quality warning，不进入「未生成 Rating」failure 列表
    expect(wrapper.find('[data-testid="league-failure-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="league-quality-warning"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('league.rated_count:1,1')
    expect(wrapper.text()).not.toContain('league.unrated_count')
    expect(wrapper.text()).not.toContain('LEAGUE_MISSING_DEATH_TIME')
    expect(wrapper.find('[data-testid="league-failure-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('.error').exists()).toBe(false)
  })

  it('shows aggregate tab in league mode (resp.leagueMode is the page source of truth)', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      leagueMode: true,
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
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['111:1'] = 'CHRD'
    expect(wrapper.vm.battleTeamNames['111:1']).toBe('CHRD')
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('summary rename only updates teamKey overrides (no battle pollution)', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    expect(wrapper.vm.summaryTeamNames['clan:CHRD']).toBe('CHRD A队')
    expect(wrapper.vm.battleTeamNames).toEqual({})
  })

  it('export passes battle + summary overrides payload', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
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

  it('clears both overrides when replay selection changes', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
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

  it('removing a single replay also clears overrides', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
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

  it('re-processing same selection does NOT clear overrides', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
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

describe('ReplayPage result visibility (no blank results; league mode from resp.leagueMode)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('多场 + aggregate 空 + 无 league：单场视图默认展示且 BattleTable panel 可见（不再空白）', async () => {
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
    // 无 aggregate 且非 league → 汇总视图不渲染（无可展示内容），只保留单场视图。
    expect(wrapper.find('[data-testid="data-view-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-view-single"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some(b => b.text().includes('Lagoon #1'))).toBe(false)
    expect(wrapper.findAll('button').some(b => b.text().includes('Frozen #2'))).toBe(false)
    // 至少一个 BattleTable panel 可见（结果区不为空）
    const battlePanels = wrapper.findAll('.battle-table-stub')
    expect(battlePanels.length).toBeGreaterThan(0)
    expect(battlePanels[0].isVisible()).toBe(true)
    // aggregate 空 → AggregateTable 不渲染（v-if 由 resp.aggregate 驱动）
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式以 resp.leagueMode 为唯一事实源：即使 playerColumns 无 league_rating，aggregate tab + 统一玩家表也显示', async () => {
    delete window.__testLeagueMode // 列派生 league mode（测试 seam）关闭，页面只看 resp.leagueMode
    state.init.resp = makeResp({
      aggregate: [],
      playerColumns: [{ key: 'nickname', label: '昵称' }], // 不含 league_rating
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', ratingV5: 1000, ratingRawMedian: 1500, battles: 5, wins: 3, damageTotal: 25000, killsTotal: 10, dimensionMedians: [] }],
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
    // CW 模式：玩家信息只走统一玩家表，不再渲染两张平级玩家表
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
  })

  it('league 模式 + aggregate 有数据：统一玩家表唯一存在，战队表独立', async () => {
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
        { cells: { nickname: 'P2', damage_dealt: 3000 } }
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }], // 不含 league_rating
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [],
        playerSummaries: [{ nickname: 'P1', ratingV5: 795.7, ratingRawMedian: 900, battles: 2, wins: 1, damageTotal: 9000, killsTotal: 4, dimensionMedians: [] }],
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
      leagueMode: true,
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
    // 0 可评分 ≠ Replay 没数据：统一玩家表仍渲染 aggregate 玩家（Missing side 不删玩家）
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

  it('leagueMode=false 即使构造异常 league metadata + playerColumns 含 league_rating → 仍是标准模式（第二事实源不得改变 mode）', async () => {
    // 唯一事实源 resp.leagueMode：league 对象与 playerColumns 列内容都不能把标准批次变成 CW
    state.init.resp = makeResp({
      aggregate: [
        { cells: { nickname: 'P1', damage_dealt: 5000 } },
      ],
      battles: [
        { mapName: 'Lagoon', players: [{ cells: { nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      },
      // leagueMode 缺省 = false
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    // 无 CW UI：不渲染统一玩家表 / League 标题，走基础 AggregateTable
    expect(wrapper.find('.cw-player-summary').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(false)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(true)
  })

  it('leagueMode=true + league envelope 存在但 0 评分（battle.league=null、playerSummaries=[]）：CW UI + 统一表保留 aggregate 玩家', async () => {
    // 生产 contract：纯 CW 批次必有 league envelope（无论评分场数）；单场是否评分由 battle.league 决定。
    state.init.resp = makeResp({
      aggregate: [
        { cells: { account_id: 1001, nickname: 'P1', damage_dealt: 5000 } },
      ],
      battles: [
        { mapName: 'Lagoon', league: null, players: [{ team: 1, cells: { account_id: 1001, nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }],
        teamSummaries: [], teamSummaryColumns: [], failures: [],
      },
      leagueMode: true,
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    // CW UI 存在（aggregate tab + 统一玩家表 + League 标题），不退化为基础表
    expect(wrapper.find('[data-testid="league-summary-title"]').exists()).toBe(true)
    expect(wrapper.find('.agg-table-stub').exists()).toBe(false)
    expect(wrapper.find('.cw-player-summary').exists()).toBe(true)
    // 统一表保留 Replay Aggregate 玩家（0 评分不删玩家；Rating/七维补 "--"）
    const rows = wrapper.findAll('.cw-player-summary tbody tr')
    expect(rows.length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('P1')
    // 战队区块为明确 neutral 空态，不伪造 Team Rating / MVP
    expect(wrapper.find('[data-testid="league-summary-empty"]').exists()).toBe(true)
    expect(wrapper.find('.league-summary').exists()).toBe(false)
  })
})
describe('ReplayPage Player Detail Drawer', () => {
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
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 3, ratingV5: 779.3, ratingRawMedian: 850.4,
            dimensionMedians: [342, 60, 70, 110, 40, 80, 100],
            dimensionMeans: [250, 40, 30, 75, 10, 50, 65], mvpCount: 2, wins: 2 },
        ],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
  }

  it('默认关闭', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toBe('closed')
    wrapper.unmount()
  })

  it('点击统一表玩家行 → 打开 Drawer 并带 accountId', async () => {
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

  it('点击另一玩家 → Drawer 不关闭，内容切换', async () => {
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

  it('Summary Drawer：player 携带 dimensionMeans（Radar mean 契约），不带单场 dimensionScores', async () => {
    state.init.resp = leagueResp()
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('.cw-player-summary tbody tr')[0].trigger('click')
    const text = wrapper.find('.drawer-stub').text()
    expect(text).toContain('"dimensionMeans":[250,40,30,75,10,50,65]')
    expect(text).not.toContain('"dimensionScores"')
    wrapper.unmount()
  })

  it('Battle Drawer：player 携带本场 dimensionScores，绝不携带跨场 dimensionMeans/dimensionMedians', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [{
        arenaId: '111', mapName: 'Lagoon',
        players: [{ team: 1, cells: {
          account_id: 1001, nickname: 'P1', league_rating: 812.6,
          league_damage_score: 320, league_assist_score: 55, league_kill_score: 70,
          league_exchange_score: 110, league_blocked_score: 40,
          league_survival_score: 75, league_shooting_score: 82,
        } }],
      }],
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [] },
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          props: ['battle', 'league', 'leagueMode'],
          emits: ['select-player'],
          template: '<div class="battle-table-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('.battle-table-stub').trigger('click')
    const text = wrapper.find('.drawer-stub').text()
    expect(text).toContain('"dimensionScores":[320,55,70,110,40,75,82]')
    expect(text).not.toContain('"dimensionMeans"')
    expect(text).not.toContain('"dimensionMedians"')
    wrapper.unmount()
  })

  it('排序后 selected accountId 不变', async () => {
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

  it('Tab 切换关闭 Drawer', async () => {
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
describe('ReplayPage CW unified table column contract + CW/Rating boundary', () => {
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
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [
          { key: 'league_rating', max: 1000, fixed: true },
          { key: 'league_damage_score', max: 400 },
          { key: 'league_shooting_score', max: 100 },
        ],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 8, ratingV5: 826.1, ratingRawMedian: 850.4, dimensionMedians: [342, 60, 70, 110, 40, 80, 100], mvpCount: 2, wins: 8, contribution: 22.4, kast: 100, impact: 151.2 },
        ],
        playerSummaryColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
          // rated_battles 进入生产 playerSummaryColumns（后端 ColumnDef）
          { key: 'rated_battles', num: true },
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

  it('统一表列 = cw scope 可见列：七维/MVP 不是 forced visible', async () => {
    window.__testCwVisible = ['nickname', 'league_rating', 'clan', 'battles', 'rated_battles', 'wins', 'win_rate',
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
    // rated_battles 走真实生产链（playerSummaryColumns → merge → cwVisibleKeys → 表头）
    expect(keys).toContain('rated_battles')
    wrapper.unmount()
  })

  it('用户自定义顺序生效：nickname + league_rating 固定前两位，其余按偏好顺序', async () => {
    window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating',
      'impact', 'kast', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    expect(keys).toEqual(['nickname', 'league_rating', 'impact', 'kast', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg'])
    wrapper.unmount()
  })

  it('leagueMode=true + 该场 league=null（Rating-ineligible CW 场）：battle 点击仍打开 Drawer', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: null, players: [{ team: 1, cells: { account_id: 1001, nickname: 'P1', damage_dealt: 5000 } }] },
      ],
      leagueMode: true,
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
describe('ReplayPage Drawer 玩家坦克数据透传', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'zh', files: [] }
  })
  afterEach(() => { delete window.__testCwVisible })

  it('Summary Drawer：透传 playerSummary 的 mostUsedVehicle + ratedBattles（数据源 row.league，不解析 cells.tanks）', async () => {
    state.init.resp = makeResp({
      aggregate: [{ team: 1, cells: { account_id: 1001, nickname: 'Alpha', clan: 'AAA', battles: 12 } }],
      battles: [],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING', columns: [],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', battles: 8, ratingV5: 850, ratingRawMedian: 850,
            dimensionMedians: [1, 2, 3, 4, 5, 6, 7], dimensionMeans: [2, 3, 4, 5, 6, 7, 8],
            mostUsedVehicle: { tankId: 7169, tankName: 'IS-7', battles: 3 } },
        ],
        playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [],
      }
    })
    state.init.activeTab = 'aggregate'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        CwPlayerSummaryTable: {
          emits: ['select-player'],
          template: '<div class="cw-sum-stub" data-testid="cw-sum-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;summary&apos;, accountId: 1001 })">sum</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('[data-testid="cw-sum-stub"]').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    const player = JSON.parse(drawer.text().replace(/^open:\d+:/, ''))
    expect(player.mostUsedVehicle).toEqual({ tankId: 7169, tankName: 'IS-7', battles: 3 })
    expect(player.ratedBattles).toBe(8)
    wrapper.unmount()
  })

  it('Battle Drawer：透传本场 tank_id/tank_name（battles=1）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: {}, players: [
          { team: 1, cells: { account_id: 1001, nickname: 'P1', clan: 'AAA', tank_id: 7169, tank_name: 'IS-7', damage_dealt: 5000 } },
        ] },
      ],
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], playerSummaryColumns: [], teamSummaries: [], teamSummaryColumns: [], failures: [] }
    })
    state.init.activeTab = 'b0'
    window.__testCwVisible = ['nickname', 'league_rating']
    const wrapper = mountPage({
      stubs: {
        BattleTable: {
          emits: ['select-player'],
          template: '<div class="battle-stub" data-testid="battle-stub" @click="$emit(&quot;select-player&quot;, { scope: &apos;battle&apos;, accountId: 1001, arenaId: &apos;111&apos; })">battle</div>'
        }
      }
    })
    await flushPromises()
    await wrapper.find('[data-testid="battle-stub"]').trigger('click')
    const drawer = wrapper.find('.drawer-stub')
    expect(drawer.text()).toContain('open:1001')
    const player = JSON.parse(drawer.text().replace(/^open:\d+:/, ''))
    expect(player.tankId).toBe(7169)
    expect(player.tankName).toBe('IS-7')
    expect(player.tankBattles).toBe(1)
    wrapper.unmount()
  })
})

describe('ReplayPage League failure UX separation', () => {
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
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    pJobState.setJob({ jobId: 'p1', status: 'READY', phase: null, total: 35, processed: 35, valid: 30, duplicates: 5, failures: 0 })
    await flushPromises()
    const card = wrapper.find('[data-testid="replay-processing-panel"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('replay.processing_job.valid_summary:30,5,0')
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
      leagueMode: true,
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
      leagueMode: true,
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
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findAll('.battle-table-stub').length).toBe(30)
    wrapper.unmount()
  })

  it('Test 5/6: 单场视图正常渲染；toolbar 不含重复 AI 复盘 / 战局回放入口（Workspace tabs 唯一导航）', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(1, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(1, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    state.init.activeTab = 'b0'
    const wrapper = mountPage()
    await flushPromises()
    // 单场视图可渲染 battle table（League-ineligible battle 仍完整展示）。
    expect(wrapper.findAll('.battle-table-stub').length).toBeGreaterThan(0)
    // 重复的 AI / 回放 toolbar 入口已被删除。
    expect(wrapper.find('[data-testid="battle-ai-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="battle-playback-btn"]').exists()).toBe(false)
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

  it('mixed 批次：leagueUnavailableCode 显示琥珀色提示，battles 正常渲染', async () => {
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

// ---- Workspace Dataset stale response ownership（generation/revision）----

describe.skip('ReplayPage Workspace Dataset generation ownership（已迁移至独立 capability 页）', () => {
  function mountWithFilesLocal(files) {
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files }
    return mountPage({ auth: { authenticated: true, login: vi.fn() } })
  }

  function deferred() {
    let resolve
    let reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  afterEach(() => {
    directActionHolder.reset()
  })

  it('AI：B 先 READY、A 迟到 → datasetRef 永远属于当前 workspaceFile（A 被丢弃）', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    const dA = deferred()
    const dB = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? dA.promise : dB.promise))
    const wrapper = mountWithFilesLocal([fileA, fileB])

    const pA = wrapper.vm.openWorkspaceAi(fileA) // A pending（不 await，等 B 先行）
    const pB = wrapper.vm.openWorkspaceAi(fileB) // B pending

    dB.resolve({ processingJobId: 'pB', sourceId: 'r1' })
    await flushPromises()
    expect(wrapper.vm.workspaceFile?.name).toBe('b.wotbreplay')
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' })

    dA.resolve({ processingJobId: 'pA', sourceId: 'r0' }) // A 迟到
    await flushPromises()
    expect(wrapper.vm.workspaceFile?.name).toBe('b.wotbreplay')
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' },
      'A 的迟到响应不得把 datasetRef 绑回 A')
    await pA
    await pB
    wrapper.unmount()
  })

  it('Playback：同一竞态下 B 胜出、A 迟到被丢弃', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    const dA = deferred()
    const dB = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? dA.promise : dB.promise))
    const wrapper = mountWithFilesLocal([fileA, fileB])

    const pA = wrapper.vm.openWorkspacePlayback(fileA)
    const pB = wrapper.vm.openWorkspacePlayback(fileB)

    dB.resolve({ processingJobId: 'pB', sourceId: 'r1' })
    await flushPromises()
    expect(wrapper.vm.workspaceFile?.name).toBe('b.wotbreplay')
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' })

    dA.resolve({ processingJobId: 'pA', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' })
    expect(wrapper.vm.workspaceFile?.name).toBe('b.wotbreplay')
    await pA
    await pB
    wrapper.unmount()
  })

  it('stale failure 不写 processingError、不污染当前 workspace', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    const dA = deferred()
    const dB = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? dA.promise : dB.promise))
    const wrapper = mountWithFilesLocal([fileA, fileB])

    const pA = wrapper.vm.openWorkspaceAi(fileA)
    const pB = wrapper.vm.openWorkspaceAi(fileB)
    dB.resolve({ processingJobId: 'pB', sourceId: 'r1' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' })

    dA.reject(new Error('STALE_DATASET_FAILURE')) // A 迟到失败
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r1' })
    expect(wsErrState.value).toBe('', 'stale 错误不得写入当前 selection 的 processingError')
    expect(wrapper.vm.workspaceFile?.name).toBe('b.wotbreplay')
    await pA
    await pB
    wrapper.unmount()
  })

  it('本地 source poll 取消（SOURCE_POLL_CANCELLED）即使属于当前 generation 也不写 processingError', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    directActionHolder.setImpl(() =>
      Promise.reject(Object.assign(new Error('SOURCE_POLL_CANCELLED'), { name: 'LocalCancellation' })))
    const wrapper = mountWithFilesLocal([fileA])

    await wrapper.vm.openWorkspaceAi(fileA)
    await flushPromises()
    expect(wrapper.vm.datasetRef).toBeNull()
    expect(wsErrState.value).toBe('', '本地取消不得显示成用户业务错误')
    wrapper.unmount()
  })

  it('dataset-recover（JOB_NOT_FOUND）→ onDatasetRecover 清空旧引用并重新绑定 p2（不回退 p1）', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const dA = deferred()
    const dB = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? dA.promise : dB.promise))
    const wrapper = mountWithFilesLocal([fileA])

    const pA = wrapper.vm.openWorkspaceAi(fileA)
    dA.resolve({ processingJobId: 'p1', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    expect(wrapper.vm.datasetError).toBe('')

    // AiReviewPanel 在 analyze 收到 backend JOB_NOT_FOUND → emit dataset-recover。
    // （AiReviewPanel 的真实 emit 由 AiReviewPanel.test.js 覆盖；此处验证 ReplayPage 恢复链。）
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    // onDatasetRecover 应先清空旧引用与旧错误，再重新走 requestDirectAction（第 2 次调用返回 p2）
    expect(wrapper.vm.datasetRef).toBeNull('恢复开始时应先清空旧 dataset 引用')
    expect(wrapper.vm.datasetError).toBe('')

    dB.resolve({ processingJobId: 'p2', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p2', sourceId: 'r0' },
      '恢复后必须绑定重建的 p2，绝不能再回退过期 p1')
    await pA
    wrapper.unmount()
  })

  it('workspaceFile 切换：旧 datasetRef 与旧 datasetError 同时清空（A 的失败不在 B 期间显示）', async () => {
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    directActionHolder.setImpl(() => ({ processingJobId: 'p1', sourceId: 'r0' }))
    const wrapper = mountWithFilesLocal([fileA, fileB])

    await wrapper.vm.openWorkspaceAi(fileA)
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    wrapper.vm.datasetError = 'A_PREP_FAILED' // 模拟 A 的 Dataset preparation failure

    // 切到 B：workspaceFile 变化 → 旧引用 + 旧错误同时清空，A 的失败不得在 B 期间显示
    await wrapper.vm.openWorkspaceAi(fileB)
    expect(wrapper.vm.datasetError).toBe('', 'A 的准备失败不得在 B 期间显示')
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })
    wrapper.unmount()
  })

  it('Playback exactly-once：第一次 JOB_NOT_FOUND recover p2、第二次不再 create p3、结束为本地化 FAILURE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const file = new File(['a'], 'a.wotbreplay')
    let call = 0
    directActionHolder.setImpl(() => (++call === 1
      ? Promise.resolve({ processingJobId: 'p1', sourceId: 'r0' })
      : call === 2
        ? Promise.resolve({ processingJobId: 'p2', sourceId: 'r0' })
        : Promise.resolve({ processingJobId: 'p3', sourceId: 'r0' })))
    const wrapper = mountWithFilesLocal([file])

    await wrapper.vm.openWorkspacePlayback(file)
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })

    // 第一次 JOB_NOT_FOUND → 自动恢复 p2
    wrapper.findComponent({ name: 'BattlePlaybackPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p2', sourceId: 'r0' })

    // 第二次 JOB_NOT_FOUND（p2 也过期）→ 不再 create p3，结束为本地化 FAILURE
    wrapper.findComponent({ name: 'BattlePlaybackPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()
    expect(wrapper.vm.datasetRef).toBeNull('第二次必须清空引用，不再绑定新 dataset')
    expect(wrapper.vm.datasetRef).not.toEqual({ processingJobId: 'p3', sourceId: 'r0' })
    expect(wrapper.vm.datasetError).toBe('workspace.dataset_prepare_failed')
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('两面板快速 emit dataset-recover → recovery single-flight（只触发一次恢复，不双创建）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const file = new File(['a'], 'a.wotbreplay')
    const d1 = deferred()
    const d2 = deferred()
    const d3 = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? d1.promise : call === 2 ? d2.promise : d3.promise))
    const wrapper = mountWithFilesLocal([file])
    const p1 = wrapper.vm.openWorkspacePlayback(file)
    d1.resolve({ processingJobId: 'p1', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })

    // 两个面板几乎同时 emit dataset-recover：recovery in-flight，第二个合并/忽略
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    wrapper.findComponent({ name: 'BattlePlaybackPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    d2.resolve({ processingJobId: 'p2', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p2', sourceId: 'r0' })
    expect(wrapper.vm.datasetRef).not.toEqual({ processingJobId: 'p3', sourceId: 'r0' },
      '不得触发第二次恢复（若双创建会走到 d3 → p3）')
    await p1
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('selection A recovery in-flight 时切 B：A 迟到结果 pure discard、B 不绑定 A、A 不消耗 B 的 budget', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    const d1 = deferred()
    const dARec = deferred()
    const dB = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? d1.promise : call === 2 ? dARec.promise : dB.promise))
    const wrapper = mountWithFilesLocal([fileA, fileB])
    const pA = wrapper.vm.openWorkspaceAi(fileA)
    d1.resolve({ processingJobId: 'p1', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })

    // A 触发 recovery（in-flight，dARec pending）
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    // A recovery 未返回前切到 B（workspaceFile 变化 → 重置 budget；B 使用第 3 次调用）
    const pB = wrapper.vm.openWorkspaceAi(fileB)
    dB.resolve({ processingJobId: 'pB', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r0' })

    // A 的 recovery 迟到返回 → pure discard（revision guard），不得覆盖 B / 回指 A
    dARec.resolve({ processingJobId: 'pA2', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB', sourceId: 'r0' }, 'A 的迟到恢复不得覆盖 B')
    await pA
    await pB
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('recovery context generation-owned：A stale finally 不清 B inFlight、B duplicate 仍被 single-flight 拦截', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }))
    const fileA = new File(['a'], 'a.wotbreplay')
    const fileB = new File(['b'], 'b.wotbreplay')
    const d1 = deferred()
    const dARec = deferred()
    const dB = deferred()
    const dBRec = deferred()
    const dStray = deferred()
    let call = 0
    directActionHolder.setImpl(() => (++call === 1 ? d1.promise
      : call === 2 ? dARec.promise
        : call === 3 ? dB.promise
          : call === 4 ? dBRec.promise
            : dStray.promise))
    const wrapper = mountWithFilesLocal([fileA, fileB])
    const pA = wrapper.vm.openWorkspaceAi(fileA)
    d1.resolve({ processingJobId: 'p1', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'p1', sourceId: 'r0' })

    // A 触发 recovery（pending, call2 → dARec；A 是当前 recovery owner）
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    // 切 B（workspaceFile 变化 → 重置 budget；B 首次 dataset 用 call3 → dB）
    const pB = wrapper.vm.openWorkspaceAi(fileB)
    dB.resolve({ processingJobId: 'pB1', sourceId: 'r0' })
    await flushPromises()
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB1', sourceId: 'r0' })

    // B 触发 recovery（pending, call4 → dBRec；B 是当前 recovery owner）
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    // A 的 stale recovery finally 执行（resolve）——不得清 B 的 inFlight
    dARec.resolve({ processingJobId: 'pA2', sourceId: 'r0' })
    await flushPromises()

    // B 的 duplicate dataset-recover 必须仍被 inFlight guard 拦截（不得触发第 5 次 requestDirectAction）
    wrapper.findComponent({ name: 'AiReviewPanel' }).vm.$emit('dataset-recover', 'JOB_NOT_FOUND')
    await flushPromises()

    dBRec.resolve({ processingJobId: 'pB2', sourceId: 'r0' })
    await flushPromises()
    // 若 B 的 inFlight 被 A 的 stale finally 误清，B duplicate 会走 2nd branch → datasetRef 被清空、
    // 不会绑定 pB2；这里必须绑定 B 自己的 pB2。
    expect(wrapper.vm.datasetRef).toEqual({ processingJobId: 'pB2', sourceId: 'r0' },
      'A 的 stale finally 不得清 B 的 inFlight / 不得让 B duplicate 走错误分支')
    await pA
    await pB
    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})

describe('ReplayPage League 算法说明入口', () => {
  afterEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en' }
    vi.restoreAllMocks()
  })

  it('普通模式不显示算法说明按钮', () => {
    state.init = { activeTab: 'aggregate', resp: makeResp(), error: '', loading: false, locale: 'en' }
    const wrapper = mountPage()
    expect(wrapper.find('[data-testid="league-docs-btn"]').exists()).toBe(false)
  })

  it('League 模式显示算法说明按钮，点击跳转 rating-docs', async () => {
    const navigate = vi.fn()
    state.init = {
      activeTab: 'aggregate',
      resp: makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } }),
      error: '', loading: false, locale: 'en',
    }
    const wrapper = mountPage({ navigate })
    await flushPromises()
    const btn = wrapper.find('[data-testid="league-docs-btn"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(navigate).toHaveBeenCalledWith('rating-docs')
  })
})
