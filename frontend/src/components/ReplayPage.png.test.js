// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setUiProfile } from '../composables/useUiProfile.js'
import { state, makeResp, mountPage, pngButton, setCloneScrollConfig, interceptAppendChild, stripOffscreen, h2c, i18n } from './ReplayPage.test.fixture.js'

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

    it('uses profile-derived theme:winter→light, summer→dark (data-theme 由 useUiProfile 派生)', async () => {
      state.init.resp = makeResp()
      // 寒冬 → data-theme=light → 浅色导出
      setUiProfile('winter')
      h2c.resetCalls()
      wrapper = mountPage()
      await pngButton(wrapper).trigger('click')
      await flushPromises()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      expect(h2c.getCalls()[0][1].backgroundColor).toBe('#ffffff')
      // 盛夏 → data-theme=dark → 深色导出
      setUiProfile('summer')
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
      // export-safe CSS 已拆至 sidecar：契约覆盖宿主源 + css
      const cssText = readFileSync(join(process.cwd(), 'src/components/replay-page.css'), 'utf8')
      const src = (await import('./ReplayPage.vue?raw')).default + '\n' + cssText
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
