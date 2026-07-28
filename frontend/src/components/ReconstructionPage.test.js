// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReconstructionPage from './ReconstructionPage.vue'

const auth = vi.hoisted(() => ({
  ensureToken: vi.fn(),
  login: vi.fn()
}))

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key)
}))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: {
      value: { realm_access: { roles: ['wotbtools-admin'] } }
    },
    token: () => 'test-token',
    ensureToken: auth.ensureToken,
    login: auth.login
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t })
}))

describe('ReconstructionPage team analysis', () => {
  it('shows error when selecting more than 16 files', async () => {
    const wrapper = mountedPage()
    const input = wrapper.get('input[type="file"]')
    const names = Array.from({ length: 17 }, (_, i) => `file${i}.wotbreplay`)
    const files = names.map(name => new File(['replay'], name, {
      type: 'application/octet-stream'
    }))
    Object.defineProperty(input.element, 'files', {
      value: files,
      configurable: true
    })
    await input.trigger('change')
    expect(wrapper.text()).toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
  })
  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a single-team perspective and its limitations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse(teamResult('SINGLE_TEAM_BATTLE', [
        teamUnit('unit-1', 1, ['REPLAY_STREAM_PARTIAL'])
      ]))))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['training.wotbreplay'])

    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.analysis_title_team')
    expect(wrapper.text()).toContain('recon.modes.SINGLE_TEAM_BATTLE')
    expect(wrapper.text()).toContain('recon.team_scope_note')
    expect(wrapper.text()).toContain('recon.team_perspective:1')
    expect(wrapper.text()).toContain(
      'recon.limitations.REPLAY_STREAM_PARTIAL')
    expect(wrapper.text()).toContain('team report')
  })

  it('renders multi-team units and duplicate-perspective metadata', async () => {
    const result = teamResult('MULTI_TEAM_BATTLE', [
      teamUnit('unit-1', 1, []),
      teamUnit('unit-2', 2, [])
    ])
    result.sameTeamDuplicatePerspectiveCount = 1
    result.analyzedUnitCount = 2
    result.battleCount = 2
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(result)))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['ally.wotbreplay', 'enemy.wotbreplay'])

    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.modes.MULTI_TEAM_BATTLE')
    expect(wrapper.text()).toContain('recon.multi_team_summary:2')
    expect(wrapper.text()).toContain('recon.duplicate_perspectives')
    expect(wrapper.text()).toContain('recon.team_perspective:1')
    expect(wrapper.text()).toContain('recon.team_perspective:2')
  })

  it('shows loading and removes the previous report before a failed retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      okResponse(teamResult('SINGLE_TEAM_BATTLE', [
        teamUnit('old-unit', 1, [])
      ])))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['old.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('team report')

    await selectReplays(wrapper, ['new.wotbreplay'])
    let resolveRequest
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {
      resolveRequest = resolve
    }))
    await analyzeButton(wrapper).trigger('click')

    expect(analyzeButton(wrapper).attributes('disabled')).toBeDefined()
    expect(analyzeButton(wrapper).text()).toBe('action.processing')
    expect(wrapper.text()).not.toContain('team report')

    resolveRequest(errorResponse(429, 'AI_RATE_LIMITED'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('team report')
    expect(wrapper.text()).toContain('recon.errors.AI_RATE_LIMITED')
    expect(analyzeButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('handles plain text error without JSON parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('AI_NOT_CONFIGURED', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    ))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['test.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('recon.errors.AI_NOT_CONFIGURED')
  })

  it('parses JSON error code correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'REPLAY_FILE_COUNT_EXCEEDED', maxFiles: 16 }),
        { status: 400, headers: { 'Content-Type': 'application/json' } })
    ))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['test.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
    expect(wrapper.text()).toContain('16')
  })

  it('keeps random-battle reports player focused', async () => {
    const result = {
      ...teamResult('SINGLE_PLAYER_BATTLE', [{
        analysisUnitId: 'player-unit',
        perspectiveTeam: null,
        duplicateFileNames: [],
        report: null
      }]),
      analysis: 'player report'
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(result)))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['random.wotbreplay'])

    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.analysis_title_player')
    expect(wrapper.text()).toContain('recon.modes.SINGLE_PLAYER_BATTLE')
    expect(wrapper.text()).not.toContain('recon.team_scope_note')
    expect(wrapper.text()).toContain('player report')
  })
})

describe('ReconstructionPage file management', () => {
  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clears file count error after removing a file', async () => {
    const wrapper = mountedPage()
    const input = wrapper.get('input[type="file"]')

    // Add 16 valid files (fills to max)
    const names16 = Array.from({ length: 16 }, (_, i) => `file${i}.wotbreplay`)
    const files16 = names16.map(name => new File(['replay'], name, { type: 'application/octet-stream' }))
    Object.defineProperty(input.element, 'files', { value: files16, configurable: true })
    await input.trigger('change')

    // Try adding 1 more — triggers count exceeded error
    const extra = [new File(['replay'], 'extra.wotbreplay', { type: 'application/octet-stream' })]
    Object.defineProperty(input.element, 'files', { value: extra, configurable: true })
    await input.trigger('change')

    expect(wrapper.text()).toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')

    // Remove one file
    await wrapper.findAll('.chipx')[0].trigger('click')

    expect(wrapper.text()).not.toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
  })

  it('does not call fetch when file count exceeds limit', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    const input = wrapper.get('input[type="file"]')

    const names = Array.from({ length: 17 }, (_, i) => `file${i}.wotbreplay`)
    const files = names.map(name => new File(['replay'], name, { type: 'application/octet-stream' }))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')

    expect(wrapper.text()).toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears analysis result after removing a file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse(teamResult('SINGLE_TEAM_BATTLE', [
        teamUnit('unit-1', 1, ['REPLAY_STREAM_PARTIAL'])
      ]))))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['test.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('team report')

    await wrapper.findAll('.chipx')[0].trigger('click')

    expect(wrapper.text()).not.toContain('team report')
  })

  it('allows adding files after clearing', async () => {
    const wrapper = mountedPage()

    const names = Array.from({ length: 16 }, (_, i) => `file${i}.wotbreplay`)
    const files = names.map(name => new File(['replay'], name, { type: 'application/octet-stream' }))
    Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { value: files, configurable: true })
    await wrapper.get('input[type="file"]').trigger('change')

    const clearBtn = wrapper.findAll('button').find(b => b.text() === 'upload.clear')
    await clearBtn.trigger('click')

    await selectReplays(wrapper, ['single.wotbreplay'])

    expect(wrapper.text()).toContain('single.wotbreplay')
  })

  it('renders file count display', async () => {
    const wrapper = mountedPage()
    const names = Array.from({ length: 12 }, (_, i) => `file${i}.wotbreplay`)
    const files = names.map(name => new File(['replay'], name, { type: 'application/octet-stream' }))
    Object.defineProperty(wrapper.get('input[type="file"]').element, 'files', { value: files, configurable: true })
    await wrapper.get('input[type="file"]').trigger('change')

    expect(wrapper.text()).toContain('recon.max_files_count:12')
  })

  it('removes single file by index', async () => {
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['alpha.wotbreplay', 'beta.wotbreplay', 'gamma.wotbreplay'])

    expect(wrapper.text()).toContain('alpha.wotbreplay')
    expect(wrapper.text()).toContain('beta.wotbreplay')
    expect(wrapper.text()).toContain('gamma.wotbreplay')

    await wrapper.findAll('.chipx')[1].trigger('click')

    expect(wrapper.text()).toContain('alpha.wotbreplay')
    expect(wrapper.text()).not.toContain('beta.wotbreplay')
    expect(wrapper.text()).toContain('gamma.wotbreplay')
  })
})

function mountedPage() {
  return mount(ReconstructionPage, {
    global: {
      mocks: { $t: i18n.t }
    }
  })
}

async function selectReplays(wrapper, names) {
  const input = wrapper.get('input[type="file"]')
  const files = names.map(name => new File(['replay'], name, {
    type: 'application/octet-stream'
  }))
  Object.defineProperty(input.element, 'files', {
    value: files,
    configurable: true
  })
  await input.trigger('change')
}

function analyzeButton(wrapper) {
  return wrapper.findAll('button').find(button => {
    const text = button.text()
    return text === 'action.processing'
      || text.startsWith('recon.analyze_btn')
      || text.startsWith('recon.analyze_multi_btn')
  })
}

function teamResult(mode, analyses) {
  return {
    mode,
    submittedFileCount: 1,
    validFileCount: 1,
    analysisUnitCount: analyses.length,
    analyzedUnitCount: analyses.length,
    battleCount: analyses.length,
    analysis: 'team report',
    failedFileCount: 0,
    exactDuplicateCount: 0,
    sameTeamDuplicatePerspectiveCount: 0,
    files: [],
    analyses,
    keyEvents: []
  }
}

function teamUnit(analysisUnitId, perspectiveTeam, limitations) {
  return {
    analysisUnitId,
    perspectiveTeam,
    representativeFileName: `${analysisUnitId}.wotbreplay`,
    duplicateFileNames: [],
    report: {
      coverage: { fullFeaturesAvailable: false },
      limitations
    }
  }
}

function okResponse(body) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue('')
  }
}

function errorResponse(status, code) {
  return {
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(code)
  }
}
