// @vitest-environment happy-dom

import { afterEach, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref, computed } from 'vue'
import ReplayPage from './ReplayPage.vue'
import { NAVIGATE_VIEW_KEY } from '../shared/navigation.js'
import { DIALOG_INLINE_KEY } from '../shared/dialog.js'

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

})

vi.mock('html2canvas', () => ({
  default: (...args) => h2c.call(...args)
}))

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
    capture: (r) => { _activeTab = r.activeTab; _resp = r.resp; _error = r.error; _loading = r.loading; _locale = r.locale; _files = r.files },
    captureFns: (fns) => { _fns = fns },
    get replay() { return _fns || {} },
    getError: () => _error?.value,
    clear: () => { _activeTab = null; _resp = null; _error = null; _loading = null; _locale = null },
    setActiveTab, setResp, setError, setLoading, setLocale,
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

  const i18nModule = await import('vue-i18n')
  const localeRef = i18nModule.useI18n().locale

  return {
    useReplay: () => {
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
        shownCols: computed(() => window.__testShownCols || []),
        shownAggCols: computed(() => window.__testShownAggCols || []),
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
    props: overrides.props || {},
    global: {
      mocks: { $t: i18n.t },
      provide: {
        [NAVIGATE_VIEW_KEY]: navigate,
        [DIALOG_INLINE_KEY]: true,
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
          props: ['battle', 'sortKey', 'sortReverse'],
          template: '<div class="battle-table-stub" :data-export-role="\'battle-\' + battle.mapName" ' +
            ':data-sort-key="sortKey || \'\'" :data-sort-reverse="String(!!sortReverse)">' +
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
  const el = wrapper.find(`[data-test="${testId}"]`)
  return el.exists() ? el.element.style.display : null
}

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


export { state, columnsState, makeResp, mountPage, panelDisplay, pngButton, setScrollProps, setCloneScrollConfig, interceptAppendChild, stripOffscreen, h2c, i18n, localeHolder }
