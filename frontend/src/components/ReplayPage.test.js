// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref, computed, toRaw, watch, onMounted, onUnmounted } from 'vue'
import ReplayPage from './ReplayPage.vue'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
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
describe('ReplayPage Excel export menu (client-side xlsx)', () => {
  // 导出统一收进「导出 ▾」菜单（design-language §7 Menu）：菜单项只在打开后渲染。
  async function openExportMenu(wrapper) {
    await wrapper.get('[data-testid="export-menu"]').trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: makeResp(), error: '', loading: false, locale: 'en', files: [] }
  })

  it('aggregate calls exportExcel("aggregate", null) when no team names are overridden', async () => {
    const wrapper = mountPage()
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-aggregate"]').trigger('click')
    await flushPromises()
    // 无覆盖时 teamNamesPayload() = null（名称必须经 payload 传递）
    expect(state.replay.exportExcel).toHaveBeenCalledWith('aggregate', null)
    wrapper.unmount()
  })

  it('each calls exportExcel("each", null)', async () => {
    const wrapper = mountPage()
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-each"]').trigger('click')
    await flushPromises()
    expect(state.replay.exportExcel).toHaveBeenCalledWith('each', null)
    wrapper.unmount()
  })

  it('while exporting: menu label shows replay.excel_exporting, Excel items disabled, no second export', async () => {
    let finish
    const wrapper = mountPage()
    state.replay.exportExcel.mockImplementation(() => new Promise((res) => { finish = res }))
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-aggregate"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="export-menu"]').text()).toContain('replay.excel_exporting')

    await openExportMenu(wrapper)
    const aggregate = wrapper.get('[data-testid="export-aggregate"]')
    expect(aggregate.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="export-each"]').attributes('disabled')).toBeDefined()
    await aggregate.trigger('click')
    expect(state.replay.exportExcel).toHaveBeenCalledTimes(1)

    finish()
    await flushPromises()
    expect(wrapper.get('[data-testid="export-menu"]').text()).not.toContain('replay.excel_exporting')
    wrapper.unmount()
  })

  it('failure surfaces replay.excel_export_failed and re-enables the menu', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountPage()
    state.replay.exportExcel.mockRejectedValue(new Error('exceljs failed'))
    await openExportMenu(wrapper)
    await wrapper.get('[data-testid="export-each"]').trigger('click')
    await flushPromises()

    expect(state.getError()).toBe('replay.excel_export_failed')
    expect(consoleError).toHaveBeenCalled()
    await openExportMenu(wrapper)
    expect(wrapper.get('[data-testid="export-each"]').attributes('disabled')).toBeUndefined()
    consoleError.mockRestore()
    wrapper.unmount()
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
    getError: () => _error?.value,
    clear: () => { _activeTab = null; _resp = null; _error = null; _loading = null; _locale = null },
    setActiveTab, setResp, setError, setLoading, setLocale,
    // Default initial values
    init: { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] },
  }
})


const columnsState = vi.hoisted(() => ({
  calls: [],
  reset() { this.calls.length = 0 },
}))

vi.mock('vue-i18n', async () => {
  const { ref } = await import('vue')
  const locale = ref('en')
  return {
    useI18n: () => ({ locale, t: i18n.t, te: key => i18n.t.mock.calls.some(c => c[0] === key) })
  }
})

// We need locale ref from i18n mock. Store it in a shared module var.
const localeHolder = vi.hoisted(() => ({ ref: null }))


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
      const exportExcel = vi.fn(async () => {})
      const analyze = vi.fn(async () => ({ completed: true }))
      const updateFiles = vi.fn(() => { selectionRevision.value++ })
      state.captureFns({ exportExcel, analyze, updateFiles })
      return {
        files, loading, error, resp, activeTab,
        aggStats: computed(() => null),
        selectionRevision,
        pendingRemove, updateFiles, playerCols, aggCols,
        analysis: ref({ phase: 'idle', done: 0, total: 0, failure: null }),
        analysisActive: computed(() => false),
        analyze, cancelAnalysis: vi.fn(), dismissAnalysis: vi.fn(),
        exportExcel, parsedFiles: vi.fn(() => []),
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
        'damage_avg', 'earned_avg', 'multi_damage_rate', 'survival_time_avg'
      ]
      const cwOrder = window.__testCwOrder || [...cwKeys]
      return {
        visibleKeys: ref([]), aggVisibleKeys: ref([]),
        playerOrder: ref([]), aggOrder: ref([]),
        cwVisibleKeys: ref([...cwKeys]),
        cwOrder: ref([...cwOrder]),
        showColPicker: ref(false), pickerScope: ref('player'), colScope: computed(() => 'player'),
        currentOrder: computed(() => []),
        // 测试 seam：当前视图列（PNG 所见即所得断言用）
        shownCols: computed(() => window.__testShownCols || []),
        shownAggCols: computed(() => window.__testShownAggCols || []),
        // 测试 seam：window.__testLeagueMode 控制 league 模式渲染
        leagueMode: computed(() => !!window.__testLeagueMode),
        toggleColPicker: vi.fn(), toggleCol: vi.fn(),
        selectAllCols: vi.fn(), resetCols: vi.fn(),
        handleReorder: vi.fn(), initFromResponse: vi.fn((result) => columnsState.calls.push(result)),
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
  const navigate = overrides.navigate || vi.fn()
  return mount(ReplayPage, {
    global: {
      mocks: { $t: i18n.t },
      provide: {
        [NAVIGATE_VIEW_KEY]: navigate,
      },
      stubs: {
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

/**
 * PNG 导出入口在「导出 ▾」菜单里。返回一个与按钮包装器同形的句柄：
 * attributes / text 读菜单触发按钮（loading / 导出中时整个菜单禁用），trigger 打开菜单再点 PNG 项。
 */
function pngButton(wrapper) {
  const menuTrigger = wrapper.find('[data-testid="export-menu"]')
  if (!menuTrigger.exists()) return undefined
  return {
    exists: () => true,
    attributes: name => menuTrigger.attributes(name),
    text: () => menuTrigger.text(),
    async trigger(event = 'click') {
      if (menuTrigger.attributes('disabled') !== undefined) return
      await menuTrigger.trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="export-png"]').trigger(event)
    },
  }
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

afterEach(() => columnsState.reset())

describe('ReplayPage data hydration (embedded-only)', () => {
  beforeEach(() => {
    state.clear()
    state.init = { activeTab: 'aggregate', resp: null, error: '', loading: false, locale: 'en', files: [] }
  })

  it('embedded-only: no standalone uploader / processing panel / task card', async () => {
    state.init.files = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'FileUploader' }).exists()).toBe(false)
    expect(wrapper.find('[data-testid="replay-processing-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="replay-task-card"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hydrates Data columns immediately when a READY response already exists', async () => {
    const result = makeResp()
    state.init.resp = result
    const wrapper = mountPage()
    await flushPromises()
    expect(columnsState.calls.at(-1)).toEqual(result)
    wrapper.unmount()
  })

  it('hydrates Data columns when a later local analysis commits resp, including League columns', async () => {
    const result = makeResp({
      leagueMode: true,
      league: { playerSummaryColumns: [{ key: 'league_rating', label: 'Rating' }], playerSummaries: [] },
    })
    const wrapper = mountPage()
    expect(columnsState.calls).toHaveLength(0)
    state.setResp(result)
    await flushPromises()
    expect(columnsState.calls.at(-1)).toEqual(result)
    wrapper.unmount()
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
      return wrapper.findAll('[data-testid="data-view"] [role="radio"]').find(b => b.attributes('aria-checked') === 'true')
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
      return wrapper.findAll('[data-testid="data-view"] [role="radio"]').find(b => b.attributes('aria-checked') === 'true')
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
              { team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'Alpha', clan: 'AAA', tank_name: 'KV-2', damage_dealt: 5000, damage_assisted: 900, kills: 3, league_rating: 927.4, league_damage_score: 342, league_shooting_score: 100, victory_points_earned: 5 } },
              { team: 2, accountId: 2001, vehicleId: 10785, cells: { nickname: 'Beta', clan: 'BBB', tank_name: 'IS-7', damage_dealt: 3000, damage_assisted: 400, kills: 1, league_rating: null, league_damage_score: null, league_shooting_score: null, victory_points_earned: 0 } },
            ],
          },
        ],
        playerColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'tank_name', num: false },
          { key: 'damage_dealt', num: true }, { key: 'damage_assisted', num: true }, { key: 'kills', num: true },
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
            '<tbody><tr v-for="p in battle.players" :key="p.accountId">' +
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
      window.__testShownCols = [{ key: 'nickname' }, { key: 'league_rating' }, { key: 'league_shooting_score' }, { key: 'damage_dealt' }]
      state.init.resp = leaguePngResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual([
        'player_labels.nickname', 'player_labels.league_rating', 'player_labels.league_shooting_score', 'player_labels.damage_dealt'
      ])
      // 未勾选的列不得偷偷进入 PNG（不再是「全量列导出」contract）
      expect(headerKeys(html)).not.toContain('player_labels.kills')
      expect(headerKeys(html)).not.toContain('player_labels.league_damage_score')
      expect(headerKeys(html)).not.toContain('player_labels.victory_points_earned')
    })

    it('单场 Battle PNG：用户自定义顺序严格保留', async () => {
      window.__testShownCols = [{ key: 'nickname' }, { key: 'league_rating' }, { key: 'league_shooting_score' }, { key: 'damage_dealt' }, { key: 'kills' }]
      state.init.resp = leaguePngResp()
      state.init.activeTab = 'b0'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual([
        'player_labels.nickname', 'player_labels.league_rating', 'player_labels.league_shooting_score',
        'player_labels.damage_dealt', 'player_labels.kills'
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

    it('CW 汇总 PNG：按当前 cwVisibleKeys 导出（隐藏列/无本地化列不出现，顺序保持）', async () => {
      window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating', 'multi_damage_rate', 'rated_battles', 'damage_avg']
      state.init.resp = makeResp({
        aggregate: [
          { team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 1, wins: 1, damage_avg: 5000, earned_avg: 5, multi_damage_rate: 62.5, survival_time_avg: 120 } },
        ],
        aggregateColumns: [
          { key: 'nickname', num: false }, { key: 'battles', num: true }, { key: 'wins', num: true },
          { key: 'damage_avg', num: true }, { key: 'earned_avg', num: true },
          { key: 'multi_damage_rate', num: true }, { key: 'survival_time_avg', num: true },
          // B6：tanks 仍在 wire（结构化 vehicle usage），但列层不展示
          { key: 'tanks', num: false },
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
            { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 1, rating: 927.4, observedMean: 927.4,
              dimensionMeans: [342, 60, 70, 110, 40, 80, 100], mvpCount: 1, wins: 1 },
          ],
          playerSummaryColumns: [
            { key: 'nickname', num: false }, { key: 'rated_battles', num: true },
            { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
            { key: 'mvp_count', num: true },
          ],
          teamSummaries: [
            { teamKey: 'AAA', autoName: 'AAA', ratedBattles: 1, rating: 900.6, observedMean: 900.6,
              dimensionMeans: [300, 50, 60, 90, 30, 70, 80], wins: 1 },
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
      // 玩家统一表 = 当前 cw 可见列（不包含隐藏的七维），顺序严格保持
      expect(headerKeys(wraps[0].innerHTML)).toEqual([
        'agg_labels.nickname', 'agg_labels.league_rating', 'agg_labels.multi_damage_rate',
        'agg_labels.rated_battles', 'agg_labels.damage_avg'
      ])
      // B6：tanks 不在列 universe → PNG 也不得出现
      expect(headerKeys(wraps[0].innerHTML)).not.toContain('agg_labels.tanks')
      // 战队汇总表 = 当前完整显示列
      const teamKeys = headerKeys(wraps[1].innerHTML)
      expect(teamKeys[0]).toBe('league.summary.team_name')
      expect(teamKeys).toContain('league.summary.league_rating')
      expect(teamKeys).toContain('league.summary.league_damage_score')
    })

    it('Standard aggregate PNG：按当前 shownAggCols 导出（无全量列替换）', async () => {
      window.__testShownAggCols = [{ key: 'nickname' }, { key: 'battles' }, { key: 'damage_avg' }, { key: 'multi_damage_rate' }]
      state.init.resp = makeResp({
        aggregate: [{ accountId: 1, cells: { nickname: 'P1', battles: 2, damage_avg: 5000, multi_damage_rate: 62.5 } }],
        battles: [],
      })
      state.init.activeTab = 'aggregate'
      wrapper = mountPage({ stubs: viewStubs() })
      const getClone = captureClone()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      const html = getClone().querySelector('.tablewrap').innerHTML
      expect(headerKeys(html)).toEqual(['agg_labels.nickname', 'agg_labels.battles', 'agg_labels.damage_avg', 'agg_labels.multi_damage_rate'])
      expect(headerKeys(html)).not.toContain('agg_labels.tanks')
    })
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
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('is-danger')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('is-warning')
    expect(wrapper.text()).toContain('league.rated_count')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    // 展开详情 → 分组错误码 + 展开分组 → 具体文件与 arenaId
    await wrapper.find('[data-testid="league-failure-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('LEAGUE_NOT_SEVEN_VS_SEVEN')
    expect(wrapper.find('[data-testid="league-failure-files"]').exists()).toBe(false)
    await wrapper.find('[data-testid="league-failure-group"]').trigger('click')
    expect(wrapper.text()).toContain('bad.wotbreplay')
    expect(wrapper.text()).toContain('111')
  })

  it('does not render death-time provenance as League business warning', async () => {
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
    // Death provenance remains outside League business state; the compatibility
    // response slot must not create a League warning.
    expect(wrapper.find('[data-testid="league-failure-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-quality-warning"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('league.summary.no_rateable')
    expect(wrapper.text()).not.toContain('league.rated_count')
    expect(wrapper.text()).not.toContain('league.unrated_count')
    expect(wrapper.text()).not.toContain('LEAGUE_MISSING_DEATH_TIME')
    expect(wrapper.find('[data-testid="league-failure-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="league-failure-detail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
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
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
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
    await wrapper.get('[data-testid="export-menu"]').trigger('click')
    await flushPromises()
    const exportBtn = wrapper.get('[data-testid="export-aggregate"]')
    await exportBtn.trigger('click')
    await flushPromises()
    expect(state.replay.exportExcel).toHaveBeenCalledWith('aggregate', {
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
    state.replay.updateFiles(['b.wotbreplay'])
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
    state.replay.updateFiles(['a.wotbreplay'])
    await nextTick()
    expect(wrapper.vm.battleTeamNames).toEqual({})
    expect(wrapper.vm.summaryTeamNames).toEqual({})
  })

  it('re-analysing the same selection does NOT clear overrides', async () => {
    state.init.resp = makeResp({ leagueMode: true, league: { mode: 'LEAGUE_RATING', columns: [], playerSummaries: [], teamSummaries: [], failures: [] } })
    const wrapper = mountPage()
    await flushPromises()
    wrapper.vm.battleTeamNames['arenaA:1'] = 'CHRD'
    wrapper.vm.summaryTeamNames['clan:CHRD'] = 'CHRD A队'
    // 同一 selection 重新解析：selectionRevision 不变 → overrides 保留
    await state.replay.analyze()
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
    // 无 aggregate 且非 league → 汇总视图不渲染（无可展示内容），只有单场视图，因此不显示视图切换。
    expect(wrapper.find('[data-testid="data-view-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-view"]').exists()).toBe(false)
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
        playerSummaries: [{ nickname: 'P1', rating: 1000, observedMean: 1000, ratedBattles: 5, wins: 3, damageTotal: 25000, killsTotal: 10, dimensionMeans: [] }],
        playerSummaryColumns: [{ key: 'nickname', label: '昵称' }, { key: 'league_rating', label: 'Rating' }],
        teamSummaries: [],
        teamSummaryColumns: [],
        failures: []
      }
    })
    state.init.activeTab = 'aggregate'
    const wrapper = mountPage()
    await flushPromises()
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
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
        playerSummaries: [{ nickname: 'P1', rating: 795.7, observedMean: 900, ratedBattles: 2, wins: 1, damageTotal: 9000, killsTotal: 4, dimensionMeans: [] }],
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
    const tabs = wrapper.findAll('[data-testid="data-view"] [role="radio"]')
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
        { team: 1, accountId: 1001, cells: { nickname: 'P1', damage_dealt: 5000 } },
      ],
      battles: [
        { mapName: 'Lagoon', league: null, players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', damage_dealt: 5000 } }] },
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
        { team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 3, wins: 2, damage_avg: 500, earned_avg: 80 } },
        { team: 2, accountId: 2001, cells: { nickname: 'Beta', clan: 'BBB', battles: 2, wins: 0, damage_avg: 300, earned_avg: 40 } },
      ],
      playerColumns: [{ key: 'nickname', label: '昵称' }],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING',
        columns: [{ key: 'league_rating', max: 1000, fixed: true }],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 3, rating: 779.3, observedMean: 850.4,
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

  it('Battle Drawer：player 携带本场 dimensionScores，绝不携带跨场 dimensionMeans', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [{
        arenaId: '111', mapName: 'Lagoon',
        players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: {
          nickname: 'P1', league_rating: 812.6,
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

  /** 富 league 响应：playerSummaryColumns 含七维 + mvp_count；aggregateColumns 含 facts + 幸存的 Performance Metrics。 */
  function cwResp() {
    return makeResp({
      aggregate: [
        { team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 12, wins: 8, win_rate: 66.7, damage_avg: 500, earned_avg: 80, multi_damage_rate: 62.5, survival_time_avg: 120 } },
        { team: 2, accountId: 2001, cells: { nickname: 'Beta', clan: 'BBB', battles: 12, wins: 4, win_rate: 33.3, damage_avg: 300, earned_avg: 40, multi_damage_rate: 40.5, survival_time_avg: 95 } },
      ],
      aggregateColumns: [
        { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
        { key: 'wins', num: true }, { key: 'win_rate', num: true }, { key: 'damage_avg', num: true },
        { key: 'earned_avg', num: true }, { key: 'multi_damage_rate', num: true },
        { key: 'survival_time_avg', num: true },
        // B6：tanks 仍在 aggregate wire 上，但列层不展示（无本地化 label）
        { key: 'tanks', num: false },
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
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 8, rating: 826.1, observedMean: 850.4, dimensionMeans: [342, 60, 70, 110, 40, 80, 100], mvpCount: 2, wins: 8 },
        ],
        playerSummaryColumns: [
          { key: 'nickname', num: false }, { key: 'clan', num: false }, { key: 'battles', num: true },
          // rated_battles 进入生产 playerSummaryColumns（后端 ColumnDef）
          { key: 'rated_battles', num: true },
          { key: 'league_rating', num: true }, { key: 'league_damage_score', num: true },
          { key: 'league_shooting_score', num: true }, { key: 'mvp_count', num: true },
          { key: 'wins', num: true },
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
      'damage_avg', 'earned_avg', 'multi_damage_rate', 'survival_time_avg']
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
    // 幸存的 Performance Metrics 与 facts 可显示
    expect(keys).toContain('multi_damage_rate')
    expect(keys).toContain('survival_time_avg')
    expect(keys).toContain('earned_avg')
    // rated_battles 走真实生产链（playerSummaryColumns → merge → cwVisibleKeys → 表头）
    expect(keys).toContain('rated_battles')
    // B6：tanks 在 aggregateColumns 里也不可能进入统一表
    expect(keys).not.toContain('tanks')
    wrapper.unmount()
  })

  it('用户自定义顺序生效：nickname + league_rating 固定前两位，其余按偏好顺序', async () => {
    window.__testCwVisible = window.__testCwOrder = ['nickname', 'league_rating',
      'multi_damage_rate', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg', 'survival_time_avg']
    state.init.resp = cwResp()
    const wrapper = mountPage()
    await flushPromises()
    const keys = cwThKeys(wrapper)
    expect(keys).toEqual(['nickname', 'league_rating', 'multi_damage_rate', 'rated_battles', 'damage_avg', 'league_damage_score', 'earned_avg', 'survival_time_avg'])
    wrapper.unmount()
  })

  it('leagueMode=true + 该场 league=null（Rating-ineligible CW 场）：battle 点击仍打开 Drawer', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: null, players: [{ team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', damage_dealt: 5000 } }] },
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
      aggregate: [{ team: 1, accountId: 1001, cells: { nickname: 'Alpha', clan: 'AAA', battles: 12 } }],
      battles: [],
      leagueMode: true,
      league: {
        mode: 'LEAGUE_RATING', columns: [],
        playerSummaries: [
          { accountId: 1001, nickname: 'Alpha', clan: 'AAA', ratedBattles: 8, rating: 850, observedMean: 850,
            dimensionMeans: [2, 3, 4, 5, 6, 7, 8],
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

  it('Battle Drawer：透传本场 vehicleId/tank_name（battles=1）', async () => {
    state.init.resp = makeResp({
      aggregate: [],
      battles: [
        { arenaId: '111', mapName: 'Lagoon', league: {}, players: [
          { team: 1, accountId: 1001, vehicleId: 7169, cells: { nickname: 'P1', clan: 'AAA', tank_name: 'IS-7', damage_dealt: 5000 } },
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

  it('Test 1: valid=30 duplicate=5 failed=0 + leagueFailures=30 → 无红色「文件解析失败」，League 汇总为 warning', async () => {
    state.init.resp = makeResp({
      battles: manyBattles(30, true),
      leagueMode: true,
      league: { mode: 'LEAGUE_RATING', failures: manyLeagueFailures(30, 'LEAGUE_ROSTER_INCOMPLETE') }
    })
    const wrapper = mountPage()
    await flushPromises()
    // 不得出现红色解析失败块（result.failures 只用于真正 parser failure）
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('result.failures')
    // League failure 汇总存在且为 warning 语义
    const summary = wrapper.find('[data-testid="league-failure-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.classes()).toContain('is-warning')
    expect(summary.classes()).not.toContain('is-danger')
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
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).toContain('is-warning')
    expect(wrapper.find('[data-testid="league-failure-summary"]').classes()).not.toContain('is-danger')
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
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
    const errBlock = wrapper.find('[data-testid="result-failures"]')
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
    expect(notice.classes()).toContain('is-warning')
    expect(wrapper.text()).toContain('league.unavailable_mixed')
    expect(wrapper.findAll('.battle-table-stub').length).toBe(2)
    expect(wrapper.find('[data-testid="result-failures"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

// ---- Workspace Dataset stale response ownership（generation/revision）----

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
