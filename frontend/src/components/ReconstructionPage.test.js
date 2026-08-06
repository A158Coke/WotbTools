// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReconstructionPage from './ReconstructionPage.vue'

const auth = vi.hoisted(() => ({
  ensureToken: vi.fn(),
  login: vi.fn()
}))

const authState = vi.hoisted(() => ({
  authenticated: { value: true },
  roles: ['wotbtools-admin']
}))

const i18n = vi.hoisted(() => ({
  t: vi.fn((key, values) => values
    ? `${key}:${Object.values(values).join(',')}`
    : key)
}))

const i18nLocale = vi.hoisted(() => ({ value: 'zh' }))

vi.mock('../composables/useAuth.js', () => ({
  useAuth: () => ({
    tokenParsed: {
      value: authState.roles.length
        ? { realm_access: { roles: authState.roles } }
        : null
    },
    token: () => 'test-token',
    ensureToken: auth.ensureToken,
    login: auth.login,
    authenticated: authState.authenticated,
    // 组件挂载时用 initPromise 确认登录状态；未登录会自动跳转登录页
    initPromise: Promise.resolve(authState.authenticated.value)
  })
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: i18n.t, locale: i18nLocale })
}))

describe('ReconstructionPage team analysis', () => {
  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('selecting a second file replaces the first', async () => {
    const wrapper = mountedPage()
    const input = wrapper.get('input[type="file"]')

    // Select first file
    const file1 = [new File(['replay'], 'first.wotbreplay', { type: 'application/octet-stream' })]
    Object.defineProperty(input.element, 'files', { value: file1, configurable: true })
    await input.trigger('change')
    expect(wrapper.text()).toContain('first.wotbreplay')
    expect(wrapper.text()).not.toContain('second.wotbreplay')

    // Select second file — replaces the first
    const file2 = [new File(['replay'], 'second.wotbreplay', { type: 'application/octet-stream' })]
    Object.defineProperty(input.element, 'files', { value: file2, configurable: true })
    await input.trigger('change')
    expect(wrapper.text()).toContain('second.wotbreplay')
    expect(wrapper.text()).not.toContain('first.wotbreplay')
  })

  it('file input does not have multiple attribute', async () => {
    const wrapper = mountedPage()
    const input = wrapper.get('input[type="file"]')
    expect(input.element.hasAttribute('multiple')).toBe(false)
  })

  it('shows only the AI review markdown, not internal diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse(teamResult('SINGLE_TEAM_BATTLE', [
        teamUnit('unit-1', 1, ['REPLAY_STREAM_PARTIAL'])
      ]))))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['training.wotbreplay'])

    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    // 普通用户只看到 AI 复盘标题与正文
    expect(wrapper.text()).toContain('recon.analysis_title_player')
    expect(wrapper.text()).toContain('team report')

    // 内部统计 / mode / 分析单元 / limitation / 关键事件 一律不展示
    expect(wrapper.text()).not.toContain('recon.modes.SINGLE_TEAM_BATTLE')
    expect(wrapper.text()).not.toContain('recon.team_scope_note')
    expect(wrapper.text()).not.toContain('recon.team_perspective:1')
    expect(wrapper.text()).not.toContain('recon.limitations.REPLAY_STREAM_PARTIAL')
    expect(wrapper.text()).not.toContain('recon.analysis_units')
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

  it('sends the current page locale as the lang form field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(
      teamResult('SINGLE_PLAYER_BATTLE', [{
        analysisUnitId: 'player-unit',
        perspectiveTeam: null,
        duplicateFileNames: [],
        report: null
      }])))
    vi.stubGlobal('fetch', fetchMock)

    try {
      for (const locale of ['zh', 'en', 'ru']) {
        i18nLocale.value = locale
        const wrapper = mountedPage()
        await selectReplays(wrapper, ['lang.wotbreplay'])
        await analyzeButton(wrapper).trigger('click')
        await flushPromises()

        const requestBody = fetchMock.mock.calls.at(-1)[1].body
        expect(requestBody.get('lang')).toBe(locale)
      }
    } finally {
      i18nLocale.value = 'zh'
    }
  })

  it('parses JSON error code correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'REPLAY_FILE_COUNT_EXCEEDED', maxFiles: 1 }),
        { status: 400, headers: { 'Content-Type': 'application/json' } })
    ))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['test.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
    expect(wrapper.text()).toContain('1')
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
    expect(wrapper.text()).toContain('player report')
    // mode 属内部字段，不再展示给普通用户
    expect(wrapper.text()).not.toContain('recon.modes.SINGLE_PLAYER_BATTLE')
    expect(wrapper.text()).not.toContain('recon.team_scope_note')
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

  it('allows clearing and re-selecting a file', async () => {
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['first.wotbreplay'])
    expect(wrapper.text()).toContain('first.wotbreplay')

    // Clear
    const clearBtn = wrapper.findAll('button').find(b => b.text() === 'upload.clear')
    await clearBtn.trigger('click')

    // Select a new file
    await selectReplays(wrapper, ['second.wotbreplay'])
    expect(wrapper.text()).toContain('second.wotbreplay')
  })

  it('displays single file name after selection', async () => {
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['single.wotbreplay'])
    expect(wrapper.text()).toContain('single.wotbreplay')
    expect(wrapper.text()).not.toContain('recon.errors.REPLAY_FILE_COUNT_EXCEEDED')
  })

  it('removes file when clicking remove button', async () => {
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['alpha.wotbreplay'])

    expect(wrapper.text()).toContain('alpha.wotbreplay')

    await wrapper.findAll('.chipx')[0].trigger('click')

    expect(wrapper.text()).not.toContain('alpha.wotbreplay')
  })

  it('does not show 16-file related text', async () => {
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['single.wotbreplay'])
    const text = wrapper.text()
    expect(text).not.toContain('/ 16')
    expect(text).not.toContain('16')
  })
})

describe('ReconstructionPage auth gating', () => {
  beforeEach(() => {
    auth.ensureToken.mockReset()
    i18n.t.mockClear()
    // Reset to default admin state before each test
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
  })

  it('renders when user has wotbtools-admin', async () => {
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
    const wrapper = mountedPage()
    expect(wrapper.find('[data-testid="ai-review-nav-button"]').exists()).toBe(false)
    // The page itself renders since ReplayInputPanel is unconditional in the template
    expect(wrapper.text()).toContain('recon.title')
  })

  it('redirects to login instead of rendering content when not authenticated', async () => {
    authState.authenticated.value = false
    authState.roles = ['wotbtools-admin'] // roles present but not authenticated
    const wrapper = mountedPage()
    await flushPromises()
    // 入口随时可见，但未登录时不渲染任何可操作内容，并自动跳转登录页（回跳本页）
    expect(wrapper.text()).toContain('recon.pleaseLogin')
    expect(wrapper.text()).not.toContain('recon.title')
    expect(wrapper.text()).not.toContain('action.processing')
    expect(auth.login).toHaveBeenCalledWith('reconstruction')
  })

  it('does not render analysis action for authenticated user without role', async () => {
    authState.authenticated.value = true
    authState.roles = ['some-other-role']
    const wrapper = mountedPage()
    expect(wrapper.text()).toContain('recon.title')
    // No analyze action because user lacks allowed roles
    expect(wrapper.text()).not.toContain('recon.analyze_btn')
    expect(wrapper.text()).not.toContain('recon.analyze_multi_btn')
  })

  it('renders analysis action for wotbtools-user', async () => {
    authState.authenticated.value = true
    authState.roles = ['wotbtools-user']
    const wrapper = mountedPage()
    expect(wrapper.text()).toContain('recon.title')
    // With a file loaded the analyze action appears
    const input = wrapper.get('input[type="file"]')
    const names = ['test.wotbreplay']
    const files = names.map(name => new File(['replay'], name, { type: 'application/octet-stream' }))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    expect(wrapper.text()).toContain('recon.analyze_btn')
  })

  it('does not expose upload or analyze surface for unauthenticated user', async () => {
    authState.authenticated.value = false
    authState.roles = ['wotbtools-user'] // roles present but not authenticated
    const wrapper = mountedPage()
    await flushPromises()
    // 未登录时整个上传/分析界面都不渲染，因此无从触发 analyze 请求
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
    const btns = wrapper.findAll('button').filter(b => b.text().startsWith('recon.analyze'))
    expect(btns.length).toBe(0)
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

describe('ReconstructionPage AI request lifecycle (timeout + cancel)', () => {
  /** fetch 模拟：可被 AbortController 中止的挂起请求。 */
  function pendingFetch() {
    return vi.fn((url, opts = {}) => new Promise((resolve, reject) => {
      opts.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        reject(err)
      })
    }))
  }

  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts with a clean AI_TIMEOUT when the client safety timeout fires', async () => {
    vi.useFakeTimers()
    const fetchMock = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['slow.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(analyzeButton(wrapper).attributes('disabled')).toBeDefined()
    expect(analyzeButton(wrapper).text()).toBe('action.processing')

    await vi.advanceTimersByTimeAsync(400_000)
    await flushPromises()

    expect(wrapper.text()).toContain('recon.errors.AI_TIMEOUT')
    expect(analyzeButton(wrapper).attributes('disabled')).toBeUndefined()

    // 超时后通知后端取消 in-flight 请求，避免上游继续计费
    const cancelCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/api/replay/analyze/cancel')
    )
    expect(cancelCall).toBeDefined()
  })

  it('cancel button aborts the request and notifies the backend', async () => {
    const fetchMock = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['long.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    const cancelBtn = wrapper.findAll('button')
      .find(b => b.text() === 'recon.cancel_btn')
    expect(cancelBtn).toBeDefined()

    const analyzeCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === '/api/replay/analyze'
    )
    const correlationId = analyzeCall[1].body.get('correlationId')
    expect(correlationId).toBeTruthy()

    await cancelBtn.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.cancelled')
    expect(analyzeButton(wrapper).attributes('disabled')).toBeUndefined()
    const cancelCall = fetchMock.mock.calls.find(
      ([url]) => String(url).includes('/api/replay/analyze/cancel')
    )
    expect(cancelCall).toBeDefined()
    expect(String(cancelCall[0])).toContain(encodeURIComponent(correlationId))
  })
})
