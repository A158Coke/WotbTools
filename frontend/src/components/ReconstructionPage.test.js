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
    vi.useRealTimers()
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
      okResponse(teamResult())))
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
      okResponse(teamResult()))
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
      teamResult()))
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
      ...teamResult(),
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
    vi.useRealTimers()
  })

  it('clears analysis result after removing a file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      okResponse(teamResult())))
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

function teamResult() {
  return {
    analysis: 'team report'
  }
}

/**
 * SSE 响应 mock：把事件序列编码为 ReadableStream。
 * @param {Array<{event: string, data: object}>} events
 */
function sseResponse(events) {
  const payload = events
    .map(e => `event:${e.event}\ndata:${JSON.stringify(e.data)}\n\n`)
    .join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      controller.close()
    }
  })
  return {
    ok: true,
    status: 200,
    body: stream,
    text: vi.fn().mockResolvedValue('')
  }
}

/** 兼容旧契约：单 done 事件携带完整 result（analysis + preBattleSection）。 */
function okResponse(body) {
  return sseResponse([{ event: 'done', data: body }])
}

/** 多阶段流：call1 → evidence → call2 token 滚动 → done。 */
function sseStreamingResponse({ analysis = 'team report', preBattleSection = null, mapOverview = null } = {}) {
  return sseResponse([
    { event: 'call1_start', data: {} },
    { event: 'call1_done', data: {} },
    { event: 'evidence_done', data: {} },
    { event: 'call2_token', data: { delta: 'team ' } },
    { event: 'call2_token', data: { delta: 'report' } },
    { event: 'done', data: { analysis, preBattleSection, mapOverview } }
  ])
}

function errorResponse(status, code) {
  return {
    ok: false,
    status,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(code)
  }
}

describe('ReconstructionPage SSE streaming', () => {
  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** 可分段写入的 SSE 流，用于验证流中间状态。 */
  function chunkedSse() {
    let controllerRef
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller
      }
    })
    return {
      stream,
      enqueue: text => controllerRef.enqueue(new TextEncoder().encode(text)),
      close: () => controllerRef.close()
    }
  }

  it('shows stage status and token scrolling mid-stream before done', async () => {
    const sse = chunkedSse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['stream.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    sse.enqueue('event:call1_start\ndata:{}\n\n')
    sse.enqueue('event:call1_done\ndata:{}\n\n')
    sse.enqueue('event:evidence_done\ndata:{}\n\n')
    sse.enqueue('event:call2_token\ndata:{"delta":"hello"}\n\n')
    sse.enqueue('event:call2_token\ndata:{"delta":" world"}\n\n')
    await flushPromises()

    // 生成中：阶段状态 + 已到达 token 可见，完整结果尚未设置
    expect(wrapper.text()).toContain('recon.stages.call2')
    expect(wrapper.text()).toContain('hello world')
    expect(wrapper.text()).not.toContain('recon.analysis_title_player')

    sse.enqueue('event:done\ndata:{"analysis":"hello world","preBattleSection":null}\n\n')
    sse.close()
    await flushPromises()

    // done 后切换到完整结果面板
    expect(wrapper.text()).toContain('recon.analysis_title_player')
    expect(wrapper.text()).toContain('hello world')
    expect(wrapper.text()).not.toContain('recon.stages.call2')
  })

  it('shows autopsy stage status for team flow', async () => {
    const sse = chunkedSse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['team.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    sse.enqueue('event:call2_token\ndata:{"delta":"team"}\n\n')
    sse.enqueue('event:autopsy_start\ndata:{}\n\n')
    await flushPromises()
    expect(wrapper.text()).toContain('recon.stages.autopsy')

    sse.enqueue('event:autopsy_done\ndata:{}\n\n')
    sse.enqueue('event:done\ndata:{"analysis":"team","preBattleSection":null}\n\n')
    sse.close()
    await flushPromises()
    expect(wrapper.text()).toContain('recon.analysis_title_player')
  })

  it('does not render a map block from the done payload (map section is standalone)', async () => {
    const sse = chunkedSse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['stream.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    sse.enqueue('event:done\ndata:{"analysis":"x","preBattleSection":null,' +
      '"mapOverview":{"mapCode":"desert_train","displayName":"Desert Sands"}}\n\n')
    sse.close()
    await flushPromises()

    // done 携带的 mapOverview 不再进入结果面板（地图已拆为页面级独立区块，
    // 由 /api/replay/map-overview 单独加载）；结果面板无地图折叠块
    expect(wrapper.find('[data-test="map-block"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="map-panel"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(true)
  })

  it('shows localized error from an error event mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { event: 'call1_start', data: {} },
      { event: 'error', data: { code: 'AI_RATE_LIMITED' } }
    ])))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['fail.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.errors.AI_RATE_LIMITED')
    expect(analyzeButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('recon.analysis_title_player')
  })

  it('treats premature stream end without done as invalid response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { event: 'call1_start', data: {} },
      { event: 'call2_token', data: { delta: 'partial' } }
    ])))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['cut.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.errors.AI_RESPONSE_INVALID')
  })

  it('passes preBattleSection from the done event to the result panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      { event: 'done', data: { analysis: 'a', preBattleSection: '## 赛前预测' } }
    ])))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['pre.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.prebattle.title')
    expect(wrapper.text()).toContain('recon.prebattle.collapse')
  })

  it('moves to call2 stage on first call2_token without evidence_done (fallback stream)', async () => {
    // fallback 路径（NON_ZH/NO_RECONSTRUCTION/RECORDER_UNRESOLVED/
    // FEATURES_UNAVAILABLE/PRE_BATTLE_UNAVAILABLE）直接进入旧 PlayerReplay 流：
    // 只发 call2_token，无 call1/evidence 阶段事件。
    const sse = chunkedSse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['fallback.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    // token 到达前：停留在初始 call1 阶段，不显示证据分析
    expect(wrapper.text()).toContain('recon.stages.call1')
    expect(wrapper.text()).not.toContain('recon.stages.evidence')

    sse.enqueue('event:call2_token\ndata:{"delta":"fallback "}\n\n')
    sse.enqueue('event:call2_token\ndata:{"delta":"review"}\n\n')
    await flushPromises()

    // 收到首个 call2_token：阶段强制进入 call2（不再依赖 evidence_done），token 正常滚动
    expect(wrapper.text()).toContain('recon.stages.call2')
    expect(wrapper.text()).not.toContain('recon.stages.call1')
    expect(wrapper.text()).not.toContain('recon.stages.evidence')
    expect(wrapper.text()).toContain('fallback review')

    sse.enqueue('event:done\ndata:{"analysis":"fallback review","preBattleSection":null}\n\n')
    sse.close()
    await flushPromises()

    // done 后切换到完整结果面板
    expect(wrapper.text()).toContain('recon.analysis_title_player')
    expect(wrapper.text()).toContain('fallback review')
    expect(wrapper.text()).not.toContain('recon.stages.call2')
  })

  it('keeps the stream alive when the component unmounts (no cancel/abort on in-app view switch)', async () => {
    const sse = chunkedSse()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['keep.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    const analyzeCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/replay/analyze')
    expect(analyzeCall).toBeDefined()

    wrapper.unmount()
    await flushPromises()

    // 卸载不再触发取消：不 abort、不调用 cancel 端点（真实关页/刷新仍由 beforeunload 处理）
    expect(analyzeCall[1].signal.aborted).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/replay/analyze/cancel'))).toBe(false)

    // 流仍可推进：卸载后继续消费数据，不会因组件卸载而中断
    sse.enqueue('event:call2_token\ndata:{"delta":"kept"}\n\n')
    sse.enqueue('event:done\ndata:{"analysis":"kept","preBattleSection":null}\n\n')
    sse.close()
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/replay/analyze/cancel'))).toBe(false)
  })

  it('keeps the stream alive across KeepAlive view switches (switch to replay parser, parse, then return)', async () => {
    // 复现用户场景：AI 复盘进行中 → 切到「回放解析」并解析一个回放 → 切回 AI 复盘。
    // App.vue 用 <KeepAlive :include="['ReconstructionPage']"> 缓存本页，
    // 切走时组件被 deactivate 而非 unmount，SSE 流必须继续消费且不得 abort / 调 cancel。
    const sse = chunkedSse()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    })
    vi.stubGlobal('fetch', fetchMock)

    const StubReplayPage = { name: 'StubReplayPage', template: '<div class="stub-replay" />' }
    const Harness = {
      components: { ReconstructionPage, StubReplayPage },
      data: () => ({ view: 'recon' }),
      template: `
        <KeepAlive :include="['ReconstructionPage']">
          <component :is="view === 'recon' ? 'ReconstructionPage' : 'StubReplayPage'" />
        </KeepAlive>
      `
    }
    const wrapper = mount(Harness, {
      global: { mocks: { $t: i18n.t } }
    })
    const recon = wrapper.findComponent(ReconstructionPage)
    await selectReplays(recon, ['keepalive.wotbreplay'])
    await analyzeButton(recon).trigger('click')
    await flushPromises()

    const analyzeCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/replay/analyze')
    expect(analyzeCall).toBeDefined()
    const analyzeSignal = analyzeCall[1].signal

    // 切到「回放解析」视图：ReconstructionPage 被 KeepAlive deactivate，SSE 不应被取消
    await wrapper.setData({ view: 'replay' })
    await flushPromises()
    expect(wrapper.find('.stub-replay').exists()).toBe(true)
    expect(analyzeSignal.aborted).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/replay/analyze/cancel'))).toBe(false)

    // 在回放解析页解析一个回放（独立 /api/preview 请求），不得影响进行中的复盘
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({ battles: [], aggregate: [] })
    })
    await fetch('/api/preview', { method: 'POST' })
    await flushPromises()
    expect(analyzeSignal.aborted).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/replay/analyze/cancel'))).toBe(false)

    // 切回 AI 复盘视图：流仍存活，token 持续消费，done 后结果可见
    sse.enqueue('event:call2_token\ndata:{"delta":"kept "}\n\n')
    await wrapper.setData({ view: 'recon' })
    await flushPromises()
    sse.enqueue('event:done\ndata:{"analysis":"kept alive","preBattleSection":null}\n\n')
    sse.close()
    await flushPromises()

    expect(analyzeSignal.aborted).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/replay/analyze/cancel'))).toBe(false)
    const reconAfter = wrapper.findComponent(ReconstructionPage)
    expect(reconAfter.text()).toContain('recon.analysis_title_player')
    expect(reconAfter.text()).toContain('kept alive')
  })

describe('ReconstructionPage standalone map section', () => {
  /** /api/replay/map-overview 成功响应（MapOverview JSON 由组件 stub 消费）。 */
  function mapJsonResponse(overview) {
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(overview)
    }
  }

  function mapOverviewFixture() {
    return {
      mapCode: 'desert_train',
      displayName: 'Desert Sands',
      displayNames: { zh: '黄沙荒漠', en: 'Desert Sands', ru: 'Пустынные пески' },
      friendlyTeam: 2,
      playableBounds: { xMin: -256, xMax: 260, yMin: -251, yMax: 254.3 },
      gridCells: [],
      spawnPoints: [],
      phases: [],
      heatmaps: { friendly: { dwell: [], damage: [], deaths: [] }, enemy: { dwell: [], damage: [], deaths: [] } },
      routes: [],
      arenaBonusType: 1,
      recorderAccountId: null,
      playback: null
    }
  }

  /** 记录 MapOverview props（含 seekTo 变更）的 stub。 */
  function mapStub(seen) {
    return {
      name: 'MapOverview',
      props: ['overview', 'seekTo'],
      setup(props) {
        seen.push(props.seekTo)
        const { watch } = require('vue')
        watch(() => props.seekTo, v => seen.push(v))
        return () => null
      }
    }
  }

  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads map overview via the button and renders the map view without any AI', async () => {
    const seen = []
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture())))
    const wrapper = mount(ReconstructionPage, {
      global: { mocks: { $t: i18n.t }, stubs: { MapOverview: mapStub(seen) } }
    })
    await selectReplays(wrapper, ['map.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await flushPromises()

    // 请求打到独立端点（不经过 /api/replay/analyze）
    const call = fetch.mock.calls.find(([url]) => String(url) === '/api/replay/map-overview')
    expect(call).toBeDefined()
    expect(call[1].body.has('files')).toBe(true)
    // 地图视图挂载，overview 传入；按钮消失
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="map-unavailable"]').exists()).toBe(false)
    expect(seen).toContain(null)
  })

  it('shows the unavailable hint when the endpoint returns 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['map.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="map-unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(true)
  })

  it('shows a localized error when the map-overview endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(400, 'NO_BATTLE_DATA')))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['map.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="map-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('recon.errors.NO_BATTLE_DATA')
    // 失败后可重试
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(true)
  })

  it('resets the map section when the file is removed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mapJsonResponse(mapOverviewFixture())))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['map.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="map-panel"]').exists()).toBe(true)

    await wrapper.findAll('.chipx')[0].trigger('click')
    expect(wrapper.find('[data-test="map-panel"]').exists()).toBe(false)
  })

  it('clicking an AI report time link loads the map and seeks the playback', async () => {
    const seen = []
    const fetchMock = vi.fn((url) => {
      if (String(url) === '/api/replay/map-overview') {
        return Promise.resolve(mapJsonResponse(mapOverviewFixture()))
      }
      return Promise.resolve(okResponse({
        analysis: '你在 03:20 与敌方交火',
        preBattleSection: null
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ReconstructionPage, {
      global: { mocks: { $t: i18n.t }, stubs: { MapOverview: mapStub(seen) } }
    })
    await selectReplays(wrapper, ['seek.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    const link = wrapper.find('a[href="#seek=200"]')
    expect(link.exists()).toBe(true)
    await link.trigger('click')
    await flushPromises()

    // 未加载时点击时间链接：自动加载地图并把 seekTo=200 传给 MapOverview
    expect(seen).toContain(200)
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
    // 连续点击同一时间戳：再次 seek 200
    await link.trigger('click')
    await flushPromises()
    expect(seen.filter(v => v === 200).length).toBeGreaterThanOrEqual(2)
  })
})

describe('ReconstructionPage map request race (file switch)', () => {
  /** 可控 deferred fetch：按调用顺序记录 resolver；可选收集 AbortSignal。 */
  function deferredFetch(signals = []) {
    const resolvers = []
    const mock = vi.fn((url, opts = {}) => {
      if (opts.signal) signals.push(opts.signal)
      return new Promise(resolve => {
        resolvers.push(resolve)
      })
    })
    mock.resolvers = resolvers
    return mock
  }

  function raceJsonResponse(overview) {
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(overview)
    }
  }

  function raceOverview(mapCode) {
    return {
      mapCode,
      displayName: 'Map',
      displayNames: { zh: '图', en: 'Map', ru: 'Карта' },
      friendlyTeam: 1,
      playableBounds: { xMin: -300, xMax: 300, yMin: -300, yMax: 300 },
      gridCells: [],
      spawnPoints: [],
      phases: [],
      heatmaps: { friendly: { dwell: [], damage: [], deaths: [] }, enemy: { dwell: [], damage: [], deaths: [] } },
      routes: [],
      arenaBonusType: 1,
      recorderAccountId: null,
      playback: null
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

  beforeEach(() => {
    auth.ensureToken.mockResolvedValue(true)
    auth.login.mockReset()
    i18n.t.mockClear()
    authState.authenticated.value = true
    authState.roles = ['wotbtools-admin']
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('stale request A never shows its map after switching to file B (A resolves late)', async () => {
    const seenCodes = []
    const fetchMock = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ReconstructionPage, {
      global: { mocks: { $t: i18n.t }, stubs: { MapOverview: mapCodeStub(seenCodes) } }
    })
    await selectReplays(wrapper, ['a.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click') // request A
    await selectReplays(wrapper, ['b.wotbreplay']) // 换文件：旧请求失效并取消
    await wrapper.get('[data-test="map-load-btn"]').trigger('click') // request B
    // A 后到：页面不得显示 A
    fetchMock.resolvers[0](raceJsonResponse(raceOverview('rift')))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(false)
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(true) // B 仍在加载
    // B 到达：显示 B
    fetchMock.resolvers[1](raceJsonResponse(raceOverview('desert_train')))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
    expect(seenCodes.filter(c => c === 'rift')).toHaveLength(0) // A 从未显示
    expect(seenCodes).toContain('desert_train')
  })

  it('regardless of resolution order, only file B map is shown (B resolves first, A late)', async () => {
    const seenCodes = []
    const fetchMock = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(ReconstructionPage, {
      global: { mocks: { $t: i18n.t }, stubs: { MapOverview: mapCodeStub(seenCodes) } }
    })
    await selectReplays(wrapper, ['a.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await selectReplays(wrapper, ['b.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    // B 先到、A 后到
    fetchMock.resolvers[1](raceJsonResponse(raceOverview('desert_train')))
    await flushPromises()
    fetchMock.resolvers[0](raceJsonResponse(raceOverview('rift')))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
    expect(seenCodes.filter(c => c === 'rift')).toHaveLength(0)
    expect(seenCodes).toContain('desert_train')
  })

  it('stale request A finally does not clear file B loading state', async () => {
    const fetchMock = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['a.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await selectReplays(wrapper, ['b.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    expect(wrapper.get('[data-test="map-load-btn"]').text()).toBe('recon.map.loading')
    // A 返回（stale，失败路径也一样）：finally 不得提前解除 B 的 loading
    fetchMock.resolvers[0](errorResponse(400, 'NO_BATTLE_DATA'))
    await flushPromises()
    expect(wrapper.get('[data-test="map-load-btn"]').text()).toBe('recon.map.loading')
    expect(wrapper.get('[data-test="map-load-btn"]').attributes('disabled')).toBeDefined()
    // B 完成：loading 结束，地图显示
    fetchMock.resolvers[1](raceJsonResponse(raceOverview('desert_train')))
    await flushPromises()
    expect(wrapper.find('[data-test="map-load-btn"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'MapOverview' }).exists()).toBe(true)
  })

  it('aborts the in-flight map request on real unmount (KeepAlive deactivate unaffected)', async () => {
    const signals = []
    const fetchMock = deferredFetch(signals)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['a.wotbreplay'])
    await wrapper.get('[data-test="map-load-btn"]').trigger('click')
    await flushPromises()
    expect(signals.length).toBe(1)
    expect(signals[0].aborted).toBe(false)
    wrapper.unmount()
    expect(signals[0].aborted).toBe(true)
  })
})

  it('aborts with AI_TIMEOUT when the wall-clock deadline passes during an active stream', async () => {
    vi.useFakeTimers()
    const sse = chunkedSse()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: sse.stream,
      text: vi.fn().mockResolvedValue('')
    }))
    const wrapper = mountedPage()
    await selectReplays(wrapper, ['slow-stream.wotbreplay'])
    await analyzeButton(wrapper).trigger('click')
    await flushPromises()

    // 模拟后台标签：setTimeout 被节流未触发，但墙钟已超过 1100s——
    // 活跃流在下一个数据块到达时按墙钟 deadline 中止
    vi.setSystemTime(Date.now() + 1_100_000)
    sse.enqueue('event:call2_token\ndata:{"delta":"late"}\n\n')
    await flushPromises()

    expect(wrapper.text()).toContain('recon.errors.AI_TIMEOUT')
    expect(analyzeButton(wrapper).attributes('disabled')).toBeUndefined()
  })
})

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

    await vi.advanceTimersByTimeAsync(1_100_000)
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
