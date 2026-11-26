// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installWorkspaceTestLifecycle, resetWorkspaceTestState, testState, flushPromises, mountWorkspace,
  paneMock, withBattles, serveDemo, analyzeDemo, guideContext, demoIdle, choose,
  waitForDemoReady, switchTo, clickDemo, TAB_KEY, tab, capKeys, demoBytes, REPLACE_DECLINED,
  computed, h, KeepAlive, ref, toRaw, useConfirmHost,
  loadOfficialDemo, OFFICIAL_DEMO, createShellChrome, useReplaySession, useConnectivityNotice, mount,
  NAVIGATE_VIEW_KEY, ONBOARDING_KEY, DIALOG_INLINE_KEY,
} from './ReplayWorkspace.test.harness.js'
import ReplayWorkspace from './ReplayWorkspace.vue'
import FileDrop from './FileDrop.vue'
const { authState, nav, formState, connectivityState, nativeImportState, replayStateRef: replayState } = testState

installWorkspaceTestLifecycle()

describe('ReplayWorkspace', () => {
  it('registers real workspace commands and keeps help available; final unmount unregisters', async () => {
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding, authenticated: true })
    await flushPromises()
    const commands = onboarding.registerWorkspace.mock.calls[0][0]
    expect(commands.hasFiles()).toBe(false)
    expect(commands.selectionIdentity()).toBe(0)
    nativeImportState.importing.value = true
    expect(commands.busy()).toBe(true)
    nativeImportState.importing.value = false
    expect(commands.busy()).toBe(false)
    await wrapper.get('[data-tour="workspace-help"]').trigger('click')
    expect(onboarding.openDirectory).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(onboarding.registerWorkspace).toHaveBeenLastCalledWith(null)
  })

  it('lets anonymous users open the complete feature directory from replay help', async () => {
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding, authenticated: false })
    await flushPromises()
    await wrapper.get('[data-tour="workspace-help"]').trigger('click')
    expect(onboarding.openDirectory).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-tour="workspace-demo"]').exists()).toBe(true)
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads the official File once through existing analysis, anonymously opens 3D/shots, and leaves AI locked', async () => {
    const fetch = serveDemo()
    analyzeDemo()
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { authenticated: false, onboarding })
    await clickDemo(wrapper)
    await waitForDemoReady(wrapper)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replayState.current.updateDemoFile).toHaveBeenCalledTimes(1)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(onboarding.sampleOpened).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="workspace-demo-label"]').text()).toBe('onboarding.demo_label')
    const selected = replayState.current.files.value
    for (const capability of ['3d', 'shots']) {
      await switchTo(wrapper, capability)
      expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
      expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(true)
    }
    await switchTo(wrapper, 'ai')
    expect(wrapper.find('[data-test="ws-ai-pane"]').exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    expect(replayState.current.files.value).toBe(selected)
    await clickDemo(wrapper)
    await flushPromises()
    expect(tab(wrapper, 'data').classes()).toContain('is-active')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(onboarding.sampleOpened).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('a failed official download leaves existing results intact and permits a successful retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    withBattles(1)
    const files = replayState.current.files.value
    const result = replayState.current.resp.value
    const wrapper = mountWorkspace('data')
    await clickDemo(wrapper)
    useConfirmHost().settle(true)
    await vi.waitFor(() => expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(true), { timeout: 4000 })
    expect(wrapper.get('[data-testid="workspace-demo-error"]').text()).toContain('onboarding.demo_failed')
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.resp.value).toBe(result)
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    serveDemo()
    analyzeDemo()
    await clickDemo(wrapper)
    useConfirmHost().settle(true)
    await waitForDemoReady(wrapper)
    expect(replayState.current.isDemoSelection.value).toBe(true)
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clicking the spotlighted sample after guide preload preserves selection identity and ready analysis', async () => {
    const fetch = serveDemo()
    analyzeDemo()
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding, authenticated: false })
    await flushPromises()
    const commands = onboarding.registerWorkspace.mock.calls[0][0]
    await commands.loadDemo()
    await flushPromises()
    const identity = commands.selectionIdentity()
    const files = replayState.current.files.value
    const result = replayState.current.resp.value
    await wrapper.get('[data-tour="workspace-demo"]').trigger('click')
    await flushPromises()
    expect(commands.selectionIdentity()).toBe(identity)
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.resp.value).toBe(result)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replayState.current.updateDemoFile).toHaveBeenCalledTimes(1)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(useConfirmHost().request.value).toBeNull()
    wrapper.unmount()
  })

  it('retries failed sample analysis with the same verified File and stable selection identity', async () => {
    const fetch = serveDemo()
    replayState.current.analyze.mockImplementationOnce(async () => {
      replayState.current.analysis.value = { phase: 'failed', done: 0, total: 1, failure: 'ENGINE_UNAVAILABLE' }
      return { completed: false, reason: 'ENGINE_UNAVAILABLE' }
    })
    const wrapper = mountWorkspace('data', { authenticated: false })
    await clickDemo(wrapper)
    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(true)
      expect(demoIdle(wrapper)).toBe(true)
    }, { timeout: 4000 })
    const files = replayState.current.files.value
    const revision = replayState.current.selectionRevision.value
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(true)
    analyzeDemo()
    await clickDemo(wrapper)
    await waitForDemoReady(wrapper)
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.selectionRevision.value).toBe(revision)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(replayState.current.updateDemoFile).toHaveBeenCalledTimes(1)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(2)
    expect(replayState.current.analysis.value.phase).toBe('ready')
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['private', 'mixed', 'same-demo', 'clear'])('revokes mounted anonymous sample panes on ordinary %s selection', async change => {
    serveDemo()
    const demo = await loadOfficialDemo()
    replayState.current.session.replaceDemoSelection(demo)
    const wrapper = mountWorkspace('3d', { authenticated: false })
    await flushPromises()
    await switchTo(wrapper, 'shots')
    expect(wrapper.find('[data-test="ws-3d-pane"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ws-shots-pane"]').exists()).toBe(true)
    const privateFile = new File(['private'], 'private.wotbreplay')
    const next = { private: [privateFile], mixed: [demo, privateFile], 'same-demo': [demo], clear: [] }[change]
    wrapper.findComponent(FileDrop).vm.$emit('update:files', next)
    await flushPromises()
    expect(replayState.current.isDemoSelection.value).toBe(false)
    expect(wrapper.find('[data-test="ws-3d-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ws-shots-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('prompts before replacing existing files and preserves them when the user cancels', async () => {
    const fetch = serveDemo()
    withBattles(1)
    const files = replayState.current.files.value
    const wrapper = mountWorkspace('data')
    await clickDemo(wrapper)
    await flushPromises()
    expect(useConfirmHost().request.value).toMatchObject({ title: 'onboarding.demo_replace_title' })
    expect(replayState.current.files.value).toBe(files)
    expect(fetch).not.toHaveBeenCalled()
    useConfirmHost().settle(false)
    await flushPromises()
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('guide: confirming the replacement makes the official sample the current replay', async () => {
    serveDemo()
    withBattles(1)
    analyzeDemo()
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding })
    await flushPromises()
    const commands = onboarding.registerWorkspace.mock.calls[0][0]
    const loading = commands.loadDemo()
    await flushPromises()
    expect(useConfirmHost().request.value).toMatchObject({ title: 'onboarding.demo_replace_title' })
    useConfirmHost().settle(true)
    await loading
    expect(replayState.current.updateDemoFile).toHaveBeenCalledTimes(1)
    expect(replayState.current.isDemoSelection.value).toBe(true)
    expect(replayState.current.files.value).toHaveLength(1)
    expect(replayState.current.files.value[0].name).toBe(OFFICIAL_DEMO.filename)
    wrapper.unmount()
  })

  it('guide: declining the replacement rejects as declined and keeps the user replay', async () => {
    const fetch = serveDemo()
    withBattles(1)
    const files = replayState.current.files.value
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding })
    await flushPromises()
    const commands = onboarding.registerWorkspace.mock.calls[0][0]
    const loading = commands.loadDemo()
    await flushPromises()
    useConfirmHost().settle(false)
    await expect(loading).rejects.toMatchObject({ name: REPLACE_DECLINED })
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.updateDemoFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('requires confirmed replacement and does not overwrite a selection changed during download', async () => {
    let finishDownload
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finishDownload = resolve })))
    withBattles(1)
    const wrapper = mountWorkspace('data')
    await clickDemo(wrapper)
    useConfirmHost().settle(true)
    await flushPromises()
    expect(replayState.current.updateDemoFile).not.toHaveBeenCalled()
    const latest = new File(['latest'], 'latest.wotbreplay')
    wrapper.findComponent(FileDrop).vm.$emit('update:files', [latest])
    finishDownload({ ok: true, arrayBuffer: async () => demoBytes.buffer.slice(demoBytes.byteOffset, demoBytes.byteOffset + demoBytes.byteLength) })
    await vi.waitFor(() => expect(demoIdle(wrapper)).toBe(true), { timeout: 4000 })
    await flushPromises()
    expect(replayState.current.files.value).toEqual([latest])
    expect(replayState.current.updateDemoFile).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="workspace-demo-error"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('guide cancellation aborts the pending sample before selecting or analyzing it', async () => {
    let finishDownload
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finishDownload = resolve })))
    const onboarding = guideContext()
    const wrapper = mountWorkspace('data', { onboarding })
    await flushPromises()
    const commands = onboarding.registerWorkspace.mock.calls[0][0]
    const controller = new AbortController()
    const loading = commands.loadDemo(controller.signal)
    controller.abort()
    finishDownload({ ok: true, arrayBuffer: async () => demoBytes.buffer.slice(demoBytes.byteOffset, demoBytes.byteOffset + demoBytes.byteLength) })
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' })
    expect(replayState.current.files.value).toEqual([])
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('Ready has no upload card; loading hides content without remounting and failures stay visible', async () => {
    withBattles(2)
    const wrapper = mountWorkspace('playback', { attached: true })
    await flushPromises()
    const pane = wrapper.get('[data-test="ws-playback-pane"]').element
    const content = () => wrapper.get('.workspace-content')
    expect(wrapper.find('[data-testid="file-uploader-empty"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="replay-processing-panel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="collection-trigger"]').text()).toContain('upload.manage')
    expect(content().isVisible()).toBe(true)
    expect(replayState.current.analyze).not.toHaveBeenCalled()

    const result = replayState.current.resp.value
    replayState.current.resp.value = null
    replayState.current.analysis.value = { phase: 'parsing', done: 0, total: 2, failure: null }
    await flushPromises()
    expect(content().isVisible()).toBe(false)
    expect(wrapper.get('[data-testid="collection-trigger"]').element.disabled).toBe(true)
    expect(wrapper.get('[data-test="ws-playback-pane"]').element).toBe(pane)

    replayState.current.resp.value = result
    replayState.current.analysis.value = { phase: 'ready', done: 2, total: 2, failure: null }
    replayState.current.error.value = 'parse failure'
    await flushPromises()
    expect(content().isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('parse failure')
    wrapper.unmount()
  })

  it('shows native read failures in the replay error surface and retries without starting analysis', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    nativeImportState.retry.mockClear()
    nativeImportState.onReadError()
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('workspace.native_replay_read_failed')
    await wrapper.get('[data-testid="ws-native-retry"]').trigger('click')
    expect(nativeImportState.retry).toHaveBeenCalledTimes(1)
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    await nativeImportState.onPendingFile(new File(['replay'], 'a.wotbreplay'), { pendingId: 'pending-a' })
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-native-retry"]').exists()).toBe(false)
    nativeImportState.onReadError('native-client-upgrade-required')
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-error"]').text()).toContain('workspace.native_client_upgrade_required')
    expect(wrapper.find('[data-testid="ws-native-retry"]').exists()).toBe(false)
    wrapper.unmount()
  })

  beforeEach(() => {
    resetWorkspaceTestState()
  })

  it.each(['3d', 'ai'])('offline deep link keeps %s discoverable but never mounts its online pane', async (cap) => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const file = replayState.current.files.value[0]
    const wrapper = mountWorkspace(cap, { authenticated: false })
    await flushPromises()
    expect(capKeys(wrapper)).toEqual(['data', 'replay', 'shots', 'ai'])
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    await switchTo(wrapper, 'playback')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    await switchTo(wrapper, 'shots')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ws-shots-pane"]').exists()).toBe(false)
    expect(replayState.current.files.value[0]).toBe(file)
    wrapper.unmount()
  })

  it.each(['3d', 'ai'])('offline %s pane shows connectivity (not the auth gate) even when authenticated', async (cap) => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const wrapper = mountWorkspace(cap)
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    wrapper.unmount()
  })

  it('reconnect activates a blocked pane once; disconnect preserves the replay and disables its active props', async () => {
    connectivityState.state.value = 'offline'
    authState.isAdmin.value = true
    withBattles(1)
    const file = replayState.current.files.value[0]
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.findAll('[data-test="ws-3d-pane"]')).toHaveLength(1)
    connectivityState.state.value = 'offline'
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('false')
    expect(replayState.current.files.value[0]).toBe(file)
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['ai', '3d'])('cold-start deep link to %s shows no connectivity verdict until detection settles ONLINE', async (cap) => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace(cap)
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    expect(wrapper.text()).not.toContain('featureOffline.')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find(`[data-test="ws-${cap}-pane"]`).exists()).toBe(false)
    expect(useConnectivityNotice().notice.value).toBe(null)

    connectivityState.settled.value = true
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.find(`[data-testid="ws-${cap}-connectivity"]`).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('connectivityNotice.')
    const pane = wrapper.get(`[data-test="ws-${cap}-pane"]`)
    expect(pane.text()).toContain('true')
    expect(useConnectivityNotice().notice.value).toBe(null)
    wrapper.unmount()
  })

  it('cold-start anonymous 3d deep link reaches the login gate only after detection settles ONLINE', async () => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace('3d', { authenticated: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ws-3d-connectivity"]').exists()).toBe(false)

    connectivityState.settled.value = true
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-3d-connectivity"]').exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['unknown', 'connectivityNotice.unknown'],
    ['offline', 'featureOffline.aiReview'],
  ])('cold-start ai deep link settling %s shows the real connectivity banner', async (result, messageKey) => {
    connectivityState.state.value = 'unknown'
    connectivityState.settled.value = false
    withBattles(1)
    const wrapper = mountWorkspace('ai')
    await flushPromises()
    expect(wrapper.find('[data-testid="ws-ai-connectivity"]').exists()).toBe(false)

    connectivityState.settled.value = true
    connectivityState.state.value = result
    await flushPromises()
    expect(wrapper.get('[data-testid="ws-ai-connectivity"]').text()).toContain(messageKey)
    expect(wrapper.find('[data-test="ws-ai-pane"]').exists()).toBe(false)
    expect(useConnectivityNotice().notice.value).toMatchObject({ messageKey })
    wrapper.unmount()
  })

  it.each([
    ['anonymous', false, false],
    ['authenticated normal user', true, false],
    ['admin', true, true],
  ])('%s sees the same four capability tabs', async (_, authenticated, isAdmin) => {
    authState.isAdmin.value = isAdmin
    const wrapper = mountWorkspace('data', { authenticated })
    await flushPromises()
    expect(capKeys(wrapper)).toEqual(['data', 'replay', 'shots', 'ai'])
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('events deep link opens the unified panel with the embedded event stream', async () => {
    withBattles(1)
    const navigate = vi.fn()
    const wrapper = mountWorkspace('events', { navigate })
    await flushPromises()
    expect(wrapper.find('[data-test="ws-event-stream"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ws-events"]').element.style.display).toBe('')
    expect(wrapper.get('[data-testid="viewer-events-toggle"]').attributes('aria-checked')).toBe('true')
    await switchTo(wrapper, 'data')
    await switchTo(wrapper, 'playback')
    expect(navigate).toHaveBeenLastCalledWith('battle-playback')
    wrapper.unmount()
  })

  it('shares one event-marker visibility state across 2D and 3D panes', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const toggle = () => wrapper.get('[data-testid="viewer-events-toggle"]')
    expect(toggle().attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[data-test="ws-playback-pane"]').attributes('data-show-event-markers')).toBe('false')

    await toggle().trigger('click')
    expect(toggle().attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-test="ws-playback-pane"]').attributes('data-show-event-markers')).toBe('true')

    await switchTo(wrapper, '3d')
    await flushPromises()
    expect(wrapper.get('[data-test="ws-playback-pane"]').attributes('data-show-event-markers')).toBe('true')
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-show-event-markers')).toBe('true')
    expect(toggle().attributes('aria-checked')).toBe('true')

    await switchTo(wrapper, 'playback')
    await flushPromises()
    expect(wrapper.get('[data-test="ws-playback-pane"]').attributes('data-show-event-markers')).toBe('true')

    await toggle().trigger('click')
    expect(wrapper.get('[data-test="ws-playback-pane"]').attributes('data-show-event-markers')).toBe('false')
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-show-event-markers')).toBe('false')
    wrapper.unmount()
  })

  it('shows the battle picker on events even when online capabilities are unavailable', async () => {
    withBattles(2)
    connectivityState.state.value = 'offline'
    const wrapper = mountWorkspace('events')
    await flushPromises()
    expect(wrapper.find('[data-testid="replay-battle-picker"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['3d', 'agent-replay'],
    ['shots', 'agent-shots'],
  ])('anonymous %s deep link gates before mounting; login restores selected replay', async (capability, view) => {
    withBattles(1)
    const files = replayState.current.files.value
    const revision = replayState.current.selectionRevision.value
    const wrapper = mountWorkspace(capability, { authenticated: false })
    await flushPromises()
    expect(tab(wrapper, capability).classes()).toContain('is-active')
    expect(wrapper.get('[data-testid="capability-auth-gate"]').text()).toContain(
      capability === '3d' ? 'workspace.login_required_3d' : 'workspace.login_required_shots')
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    expect(replayState.current.analyze).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="capability-login"]').trigger('click')
    expect(authState.login).toHaveBeenCalledWith(view)
    expect(nav.navigate).not.toHaveBeenCalled()
    authState.authenticated.value = true
    await flushPromises()
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(wrapper.get(`[data-test="ws-${capability}-pane"]`).text()).toContain('f0.wotbreplay')
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.selectionRevision.value).toBe(revision)
    expect(replayState.current.updateFiles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['3d', false], ['3d', true], ['shots', false], ['shots', true],
  ])('logout removes %s pane (hidden=%s) without clearing replay session', async (capability, hidden) => {
    withBattles(1)
    const files = replayState.current.files.value
    const result = replayState.current.resp.value
    const revision = replayState.current.selectionRevision.value
    const wrapper = mountWorkspace(capability)
    await flushPromises()
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(true)
    if (hidden) await switchTo(wrapper, 'data')
    authState.authenticated.value = false
    await flushPromises()
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    await switchTo(wrapper, capability)
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(true)
    expect(wrapper.find(`[data-test="ws-${capability}-pane"]`).exists()).toBe(false)
    expect(replayState.current.files.value).toBe(files)
    expect(replayState.current.resp.value).toBe(result)
    expect(replayState.current.selectionRevision.value).toBe(revision)
    expect(replayState.current.updateFiles).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('AI 不是 admin-only：普通用户也能切到 AI 复盘', async () => {
    replayState.current.files.value = [new File(['x'], 'a.wotbreplay')]
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await switchTo(wrapper, 'ai')
    expect(wrapper.find('[data-test="ws-ai-pane"]').exists()).toBe(true)
    expect(tab(wrapper, 'ai').classes()).toContain('is-active')
    wrapper.unmount()
  })

  it('2D and 3D receive the same workspace playback session owner', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const owner = wrapper.getComponent({ name: 'BattlePlaybackPanelMock' }).props('playbackSession')
    expect(owner.loadScene).toBeTypeOf('function')
    expect(owner.loadCanonical).toBeTypeOf('function')
    await switchTo(wrapper, '3d')
    expect(wrapper.getComponent({ name: 'Replay3DPaneMock' }).props('playbackSession')).toBe(owner)
    wrapper.unmount()
  })

  it('能力面板首次进入才挂载（按需拆包），切走只隐藏、不销毁', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ws-3d-pane"]').exists()).toBe(false)
    await switchTo(wrapper, 'playback')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    await switchTo(wrapper, 'data')
    expect(wrapper.find('[data-test="ws-playback-pane"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ws-replay"]').element.style.display).toBe('none')
    wrapper.unmount()
  })

  it('选中一次文件：data → 2D → 3D → 射击 → AI 全过程不重新选文件、selection identity 不变', async () => {
    withBattles(4)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const revision = replayState.current.selectionRevision.value
    const files = replayState.current.files.value

    for (const cap of ['playback', '3d', 'shots', 'ai', 'data', '3d']) {
      await switchTo(wrapper, cap)
      expect(replayState.current.files.value).toBe(files)
      expect(replayState.current.selectionRevision.value).toBe(revision)
      expect(replayState.current.updateFiles).not.toHaveBeenCalled()
    }
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('f0.wotbreplay')
    await switchTo(wrapper, 'shots')
    expect(wrapper.get('[data-test="ws-shots-pane"]').text()).toContain('f0.wotbreplay')
    wrapper.unmount()
  })

  it('切走 3D 时面板收到 active=false（停渲染但保留会话），切回 active=true', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('3d')
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    await switchTo(wrapper, 'data')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|false')
    await switchTo(wrapper, '3d')
    expect(wrapper.get('[data-test="ws-3d-pane"]').text()).toContain('|true')
    wrapper.unmount()
  })

  it('deactivating a kept-alive workspace suspends its retained 3D pane', async () => {
    withBattles(1)
    const shown = ref(true)
    const host = mount({
      setup: () => () => h(KeepAlive, null, () => shown.value
        ? h(ReplayWorkspace, { initialCapability: '3d' }) : null),
    }, { global: { provide: { [NAVIGATE_VIEW_KEY]: vi.fn(), [ONBOARDING_KEY]: null, [DIALOG_INLINE_KEY]: true }, mocks: { $t: (k) => k } } })
    await flushPromises()
    const pane = host.findComponent({ name: 'Replay3DPaneMock' })
    expect(pane.props('active')).toBe(true)
    const instance = pane.vm
    shown.value = false
    await flushPromises()
    expect(pane.props('active')).toBe(false)
    shown.value = true
    await flushPromises()
    expect(host.findComponent({ name: 'Replay3DPaneMock' }).vm).toBe(instance)
    expect(pane.props('active')).toBe(true)
    host.unmount()
  })

  it('能力切换写 URL（router owner）：五个能力各自的 view', async () => {
    const navigate = vi.fn()
    const wrapper = mountWorkspace('data', { navigate })
    await flushPromises()
    const expected = {
      playback: 'battle-playback',
      '3d': 'agent-replay',
      shots: 'agent-shots',
      ai: 'ai-review',
      data: 'replay',
    }
    for (const [cap, view] of Object.entries(expected)) {
      navigate.mockClear()
      await switchTo(wrapper, cap)
      expect(navigate).toHaveBeenCalledWith(view)
    }
    wrapper.unmount()
  })

  it('深链初始能力：3d / shots / playback / ai 各自直达', async () => {
    withBattles(1)
    for (const cap of ['3d', 'shots', 'playback', 'ai']) {
      const wrapper = mountWorkspace(cap)
      await flushPromises()
      expect(tab(wrapper, cap).classes()).toContain('is-active')
      expect(wrapper.get(`[data-testid="ws-${cap}"]`).element.style.display).not.toBe('none')
      wrapper.unmount()
    }
  })

  it('single-battle capabilities select the first finalized battle without reparsing', async () => {
    withBattles(3)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    for (const cap of ['3d', 'shots', 'playback', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.get(`[data-test="ws-${cap}-pane"]`).text()).toContain('f0.wotbreplay')
      expect(replayState.current.analyze).not.toHaveBeenCalled()
    }
    wrapper.unmount()
  })

  it('四个单场能力共用 workspace 的 selectBattle：选 #2 后都拿 f2', async () => {
    withBattles(3)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').selectBattle('r2')
    await flushPromises()
    for (const cap of ['playback', '3d', 'shots', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.get(`[data-test="ws-${cap}-pane"]`).text()).toContain('f2.wotbreplay')
    }
    wrapper.unmount()
  })

  it('匿名数据能力立即渲染投放区与数据面板，不请求登录', async () => {
    const wrapper = mountWorkspace('data', { authenticated: false })
    expect(wrapper.find('[data-testid="ws-auth-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="select-files-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ws-data"]').exists()).toBe(true)
    await flushPromises()
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('anonymous 2D capability mounts with selected replay without requesting login', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback', { authenticated: false })
    await flushPromises()
    expect(wrapper.get('[data-test="ws-playback-pane"]').text()).toContain('f0.wotbreplay')
    expect(wrapper.find('[data-testid="capability-auth-gate"]').exists()).toBe(false)
    expect(authState.login).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('五个能力都是同一个回放集合：添加是追加，不是替换', async () => {
    const a = new File(['x'], 'a.wotbreplay')
    replayState.current.files.value = [a]
    const wrapper = mountWorkspace('data')
    await flushPromises()
    for (const cap of ['data', 'playback', '3d', 'shots', 'ai']) {
      await switchTo(wrapper, cap)
      expect(wrapper.get('[data-testid="select-files-input"]').element.multiple).toBe(true)
      expect(wrapper.find('[data-testid="select-folder-input"]').exists()).toBe(true)
    }
    await switchTo(wrapper, 'shots')
    const input = wrapper.get('[data-testid="select-files-input"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['y'], 'b.wotbreplay')], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(replayState.current.changeFiles.mock.calls[0][0].map(file => file.name)).toEqual(['a.wotbreplay', 'b.wotbreplay'])
    wrapper.unmount()
  })

  it.each(['playback', '3d'])('%s 选文件即加载并切局；追加不换场，清空回到空态', async (cap) => {
    const wrapper = mountWorkspace(cap, { attached: true })
    await flushPromises()
    const a = new File(['a'], 'a.wotbreplay')
    const b = new File(['b'], 'b.wotbreplay')
    const c = new File(['c'], 'c.wotbreplay')
    const pickerId = 'replay-battle-picker'
    const pane = () => wrapper.get(`[data-test="ws-${cap}-pane"]`)
    replayState.current.analyze.mockImplementation(async () => {
      replayState.current.session.commitReadyResult({
        leagueMode: false,
        aggregate: [],
        battles: replayState.current.files.value.map((file, i) => ({
          sourceId: `r${i}`, sourceName: file.name, mapName: 'Lagoon', players: [],
        })),
      })
      return { completed: true }
    })
    const pick = async (testId, files) => {
      const input = wrapper.get(`[data-testid="${testId}"]`)
      expect(input.element.multiple).toBe(true)
      Object.defineProperty(input.element, 'files', { value: files, configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    await pick('select-files-input', [b, a])
    expect(replayState.current.files.value).toEqual([a, b])
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(tab(wrapper, cap).classes()).toContain('is-active')
    expect(pane().text()).toContain('a.wotbreplay')
    await wrapper.get(`[data-testid="${pickerId}"]`).trigger('click')
    await wrapper.get('[data-testid="battle-picker-option"][data-value="r1"]').trigger('click')
    await flushPromises()
    expect(pane().text()).toContain('b.wotbreplay')
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)

    await pick('select-files-input', [b, c])
    expect(replayState.current.files.value).toEqual([a, b, c])
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(replayState.current.resp.value).not.toBeNull()
    expect(toRaw(replayState.current.currentTargetFile.value)).toBe(b)
    expect(pane().text()).toContain('b.wotbreplay')
    replayState.current.session.commitReadyResult({
      leagueMode: false,
      aggregate: [],
      battles: replayState.current.files.value.map((file, i) => ({ sourceId: `r${i}`, sourceName: file.name, mapName: 'Lagoon', players: [] })),
    })
    await flushPromises()
    expect(toRaw(replayState.current.currentTargetFile.value)).toBe(b)
    await wrapper.get(`[data-testid="${pickerId}"]`).trigger('click')
    expect(wrapper.findAll('[data-testid="battle-picker-option"]')).toHaveLength(3)
    await wrapper.get('[data-testid="battle-picker-option"][data-value="r2"]').trigger('click')
    await flushPromises()
    expect(pane().text()).toContain('c.wotbreplay')

    await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="collection-clear"]').trigger('click')
    expect(replayState.current.files.value).toHaveLength(3)
    await wrapper.get('[data-testid="collection-clear-confirm"]').trigger('click')
    await flushPromises()
    expect(replayState.current.files.value).toEqual([])
    expect(replayState.current.currentTargetFile.value).toBeNull()
    expect(wrapper.find(`[data-testid="${pickerId}"]`).exists()).toBe(false)
    expect(pane().text()).not.toContain('.wotbreplay')
    wrapper.unmount()
  })

  it.each(['playback', '3d', 'shots', 'ai'])('%s opens on the first finalized battle without another parse', async cap => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.current.analyze.mockImplementation(async () => {
      replayState.current.session.commitReadyResult({ battles: [{ sourceId: 'r1', players: [] }], aggregate: [] })
      replayState.current.analysis.value = { phase: 'ready' }
      return { completed: true }
    })
    await choose(wrapper, ['a', 'b'].map(name => new File([name], `${name}.wotbreplay`)))
    await switchTo(wrapper, cap)
    expect(replayState.current.currentBattleId.value).toBe('r1')
    expect(wrapper.get(`[data-test="ws-${cap}-pane"]`).text()).toContain('b.wotbreplay')
    await switchTo(wrapper, 'data')
    await switchTo(wrapper, cap)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it.each(['playback', '3d', 'shots', 'ai'])('%s selects sparse finalized sources after failure and duplicate holes', async cap => {
    const wrapper = mountWorkspace(cap, { attached: true })
    await flushPromises()
    const files = ['bad', 'good', 'duplicate', 'other'].map(name => new File([name], `${name}.wotbreplay`))
    replayState.current.analyze.mockImplementation(async () => {
      replayState.current.session.commitReadyResult({
        battles: [1, 3].map(i => ({ sourceId: `r${i}`, sourceName: files[i].name, players: [] })),
        aggregate: [], failures: [['bad.wotbreplay', 'broken']], duplicates: [['duplicate.wotbreplay', 'arena']],
      })
      replayState.current.analysis.value = { phase: 'ready', done: 4, total: 4, failure: null }
      return { completed: true }
    })
    await choose(wrapper, files)
    expect(wrapper.find('[data-test="processing"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="workspace-partial-failure"]').text()).toContain('workspace.partial_failure')
    expect(wrapper.get('.workspace-content').isVisible()).toBe(true)
    expect(replayState.current.currentBattleId.value).toBe('r1')
    const pane = () => wrapper.findComponent({ name: ({ '3d': 'Replay3DPaneMock', playback: 'BattlePlaybackPanelMock', shots: 'ReplayShotsPaneMock', ai: 'AiReviewPaneMock' })[cap] })
    expect(toRaw(pane().props('file'))).toBe(files[1])
    const picker = ['playback', '3d'].includes(cap) ? 'replay-battle-picker' : `${cap}-battle-picker`
    await wrapper.get(`[data-testid="${picker}"]`).trigger('click')
    expect(wrapper.findAll('[data-testid="battle-picker-option"]').map(option => option.attributes('data-value'))).toEqual(['r1', 'r3'])
    await wrapper.get('[data-testid="battle-picker-option"][data-value="r3"]').trigger('click')
    await flushPromises()
    expect(toRaw(pane().props('file'))).toBe(files[3])
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it.each(['data', 'playback', '3d', 'shots', 'ai'])('%s shows the partial failure until acknowledged; a new result reminds again', async cap => {
    withBattles(2)
    const wrapper = mountWorkspace(cap, { attached: true })
    await flushPromises()
    const warning = () => wrapper.find('[data-testid="workspace-partial-failure"]')
    expect(warning().exists()).toBe(false)
    replayState.current.resp.value = { ...replayState.current.resp.value, failures: [['broken.wotbreplay', 'parse failed']] }
    await flushPromises()
    expect(warning().exists()).toBe(true)
    await wrapper.get('[data-testid="partial-failure-ack"]').trigger('click')
    await flushPromises()
    expect(warning().exists()).toBe(false)
    replayState.current.resp.value = { ...replayState.current.resp.value }
    await flushPromises()
    expect(warning().exists()).toBe(true)
    wrapper.unmount()
  })

  it('background adding during a partial failure never offers the first-load Cancel', async () => {
    withBattles(2)
    replayState.current.resp.value = { ...replayState.current.resp.value, failures: [['broken.wotbreplay', 'parse failed']] }
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    replayState.current.analysis.value = { phase: 'parsing', done: 0, total: 1, failure: null }
    await flushPromises()
    expect(wrapper.find('[data-testid="workspace-partial-failure"]').exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ReplayProcessingPanelMock' }).exists()).toBe(false)
    expect(replayState.current.files.value).toHaveLength(2)
    wrapper.unmount()
  })

  it('removing a replay asks first once results exist; a failed batch removes directly', async () => {
    withBattles(2)
    const wrapper = mountWorkspace('data', { attached: true })
    await flushPromises()
    const [first, second] = replayState.current.files.value
    await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-testid="collection-remove"]')[0].trigger('click')
    await flushPromises()
    expect(replayState.current.askRemoveFile).toHaveBeenCalledWith(first)
    expect(replayState.current.changeFiles).not.toHaveBeenCalled()

    replayState.current.resp.value = null
    replayState.current.analysis.value = { phase: 'failed', done: 0, total: 2, failure: 'NO_VALID_REPLAYS' }
    await flushPromises()
    await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-testid="collection-remove"]')[0].trigger('click')
    await flushPromises()
    expect(replayState.current.changeFiles).toHaveBeenCalledWith([second])
    wrapper.unmount()
  })

  it('marks the current battle only where one exists: Data summary has none', async () => {
    withBattles(2)
    const wrapper = mountWorkspace('data', { attached: true })
    await flushPromises()
    await wrapper.get('[data-testid="collection-trigger"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="collection-current"]').exists()).toBe(false)
    wrapper.findComponent({ name: 'ReplayPageMock' }).props('workspaceContext').selectBattle('r1')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="collection-row"]')[1].find('[data-testid="collection-current"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('a single replay shows static battle context instead of a raw file name', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const picker = wrapper.get('[data-testid="replay-battle-picker"]')
    expect(picker.find('button').exists()).toBe(false)
    expect(picker.text()).toContain('workspace.battle_n')
    expect(wrapper.find('.workspace-sessionbar').text()).not.toContain('.wotbreplay')
    wrapper.unmount()
  })

  it('when nothing opens the failure replaces the content, across capabilities, until an explicit retry', async () => {
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    replayState.current.analyze.mockImplementationOnce(async () => {
      replayState.current.analysis.value = { phase: 'failed', done: 1, total: 2, failure: 'NO_VALID_REPLAYS' }
      return { completed: true }
    })
    await choose(wrapper, ['a', 'b'].map(name => new File([name], `${name}.wotbreplay`)))
    expect(replayState.current.currentTargetFile.value).toBeNull()
    expect(wrapper.get('[data-test="processing"]').text()).toBe('failed')
    expect(wrapper.get('.workspace-content').element.style.display).toBe('none')
    const terminal = replayState.current.analysis.value
    for (const cap of ['3d', 'shots', 'ai', 'data', 'playback']) {
      await switchTo(wrapper, cap)
      expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
      expect(wrapper.findComponent({ name: 'ReplayProcessingPanelMock' }).props('analysis')).toEqual(terminal)
    }
    replayState.current.analyze.mockImplementationOnce(async () => {
      replayState.current.session.commitReadyResult({ battles: [{ sourceId: 'r1', players: [] }], aggregate: [] })
      replayState.current.analysis.value = { phase: 'ready', done: 2, total: 2, failure: null }
      return { completed: true }
    })
    wrapper.findComponent({ name: 'ReplayProcessingPanelMock' }).vm.$emit('retry')
    await flushPromises()
    expect(replayState.current.analyze).toHaveBeenCalledTimes(2)
    expect(replayState.current.currentBattleId.value).toBe('r1')
    expect(wrapper.get('.workspace-content').element.style.display).toBe('')
    wrapper.unmount()
  })

  it('cancelling the first load returns to Empty', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.current.analyze.mockImplementationOnce(() => {
      replayState.current.analysis.value = { phase: 'parsing', done: 0, total: 2, failure: null }
      return new Promise(() => {})
    })
    await choose(wrapper, ['a', 'b'].map(name => new File([name], `${name}.wotbreplay`)))
    wrapper.findComponent({ name: 'ReplayProcessingPanelMock' }).vm.$emit('cancel')
    await flushPromises()
    expect(replayState.current.cancelAnalysis).toHaveBeenCalledTimes(1)
    expect(replayState.current.files.value).toEqual([])
    expect(wrapper.find('[data-testid="file-uploader-empty"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opening another replay after a failure clears first, so the failed files are not merged', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    replayState.current.analyze.mockImplementationOnce(async () => {
      replayState.current.analysis.value = { phase: 'failed', done: 0, total: 1, failure: 'NO_VALID_REPLAYS' }
      return { completed: true }
    })
    await choose(wrapper, [new File(['a'], 'a.wotbreplay')])
    const click = vi.spyOn(wrapper.get('[data-testid="select-files-input"]').element, 'click').mockImplementation(() => {})
    wrapper.findComponent({ name: 'ReplayProcessingPanelMock' }).vm.$emit('open-other')
    await flushPromises()
    expect(replayState.current.files.value).toEqual([])
    expect(click).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('capability navigation does not call analyze again while the batch is parsing', async () => {
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    let finish
    replayState.current.analyze.mockImplementationOnce(() => {
      replayState.current.analysis.value = { phase: 'parsing', done: 0, total: 2, failure: null }
      return new Promise(resolve => { finish = resolve })
    })
    await choose(wrapper, ['a', 'b'].map(name => new File([name], `${name}.wotbreplay`)))
    for (const cap of ['3d', 'shots', 'ai', 'playback']) await switchTo(wrapper, cap)
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(replayState.current.analysis.value.phase).toBe('parsing')
    replayState.current.session.commitReadyResult({ battles: [{ sourceId: 'r1', players: [] }], aggregate: [] })
    replayState.current.analysis.value = { phase: 'ready', done: 2, total: 2, failure: null }
    finish({ completed: true })
    await flushPromises()
    expect(replayState.current.currentBattleId.value).toBe('r1')
    wrapper.unmount()
  })

  it('a dropped file anywhere on the workspace goes through the same preflight', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    await wrapper.get('.replay-workspace').trigger('drop', { dataTransfer: { files: [new File(['n'], 'new.wotbreplay')] } })
    await flushPromises()
    expect(replayState.current.changeFiles.mock.calls[0][0].map(file => file.name)).toEqual(['f0.wotbreplay', 'new.wotbreplay'])
    wrapper.unmount()
  })

  it('上传区的 selection 变更交给工作台唯一 session owner', async () => {
    withBattles(34)
    const wrapper = mountWorkspace('playback')
    await flushPromises()
    const single = new File(['x'], 'single.wotbreplay')
    wrapper.findComponent(FileDrop).vm.$emit('update:files', [single])
    await flushPromises()
    expect(replayState.current.changeFiles).toHaveBeenCalledWith([single])
    wrapper.unmount()
  })

  it('Data page 通过显式 props 消费 Workspace 唯一 replay/session owner', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const dataVm = wrapper.findComponent({ name: 'ReplayPageMock' })
    expect(dataVm.props('embedded')).toBe(true)
    expect(dataVm.props('replayContext')).toBe(replayState.current)
    expect(dataVm.props('workspaceContext')).toBeTruthy()
    expect(dataVm.props('active')).toBe(true)
    await switchTo(wrapper, 'playback')
    expect(dataVm.props('active')).toBe(false)
    await switchTo(wrapper, 'data')
    expect(dataVm.props('active')).toBe(true)
    wrapper.unmount()
  })

  it('Android pending import：挂载即消费（isReady 恒 true），替换 selection 并本机分析 exactly once', async () => {
    nativeImportState.onPendingFile = null
    const wrapper = mountWorkspace('playback', { authenticated: false })
    await flushPromises()
    expect(nativeImportState.isReady()).toBe(true)
    expect(nativeImportState.retry).toHaveBeenCalledTimes(1)

    const file = new File(['x'], 'a.wotbreplay')
    await expect(nativeImportState.onPendingFile(file, { pendingId: 'pending-uuid-1' })).resolves.toBe(true)
    await flushPromises()
    expect(replayState.current.updateFiles).toHaveBeenCalledWith([file])
    expect(replayState.current.analyze).toHaveBeenCalledTimes(1)
    expect(tab(wrapper, 'data').classes()).toContain('is-active')
    wrapper.unmount()
  })

  it.each([
    [{ completed: false, reason: 'ENGINE_UNAVAILABLE' }, false],
    [{ completed: false, reason: 'ALREADY_ACTIVE' }, false],
    [{ completed: false, reason: 'SUPERSEDED' }, false],
    [{ completed: true }, true],
  ])('Android pending replay ACK 只看 completed：%j → %s', async (result, ack) => {
    replayState.current.analyze.mockResolvedValueOnce(result)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    await expect(nativeImportState.onPendingFile(new File(['x'], 'a.wotbreplay'))).resolves.toBe(ack)
    wrapper.unmount()
  })

  it('键盘：方向键 / Home / End 在能力间移动并激活（canonical SegmentedControl 的 radiogroup 模型）', async () => {
    const wrapper = mountWorkspace('data')
    await flushPromises()
    const group = wrapper.get('[role="radiogroup"]')
    await group.trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(tab(wrapper, 'ai').classes()).toContain('is-active')
    await group.trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(tab(wrapper, 'data').classes()).toContain('is-active')
    expect(tab(wrapper, 'data').attributes('role')).toBe('radio')
    expect(tab(wrapper, 'data').attributes('aria-checked')).toBe('true')
    expect(tab(wrapper, 'ai').attributes('aria-checked')).toBe('false')
    expect(tab(wrapper, 'ai').attributes('tabindex')).toBe('-1')
    expect(wrapper.find('.capability-option').exists()).toBe(false)
    expect(wrapper.get('.segmented').classes()).toContain('is-wrapping')
    wrapper.unmount()
  })

  it('3D 自动播放按登录用户 sub 接线，并在 2D/3D 间保持同一身份', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('3d', { authenticated: true, userId: 'user/a' })
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-auto-start-user-id')).toBe('user/a')
    await switchTo(wrapper, 'playback')
    await switchTo(wrapper, '3d')
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-auto-start-user-id')).toBe('user/a')

    authState.tokenParsed.value = { sub: 'user-b' }
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-auto-start-user-id')).toBe('user-b')
    wrapper.unmount()
  })

  it('已登录但 tokenParsed 无 sub 时不传身份，不回退到全局 key', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('3d', { authenticated: true, userId: null })
    await flushPromises()
    expect(wrapper.get('[data-test="ws-3d-pane"]').attributes('data-auto-start-user-id')).toBe('')
    wrapper.unmount()
  })

  it('Case2（生产）：data READY → 3D → data，resp/files/analysis 保留、无空状态', async () => {
    withBattles(1)
    const wrapper = mountWorkspace('data')
    await flushPromises()
    expect(replayState.current.resp.value).toBeTruthy()
    await switchTo(wrapper, '3d')
    expect(replayState.current.resp.value).toBeTruthy()
    expect(replayState.current.files.value.length).toBe(1)
    await switchTo(wrapper, 'data')
    expect(replayState.current.resp.value).toBeTruthy()
    expect(wrapper.find('[data-test="data-pane"]').exists()).toBe(true)
    wrapper.unmount()
  })


  describe('手机横屏沉浸态（外壳让出高度）', () => {
    const landscapePhone = () => { formState.isPhone.value = true; formState.isPortrait.value = false; formState.coarse.value = true }
    afterEach(() => { formState.isPhone.value = false; formState.isPortrait.value = false; formState.coarse.value = false })

    it('触屏手机横屏 + 回放就绪才申请；离开 capability / 转竖屏 / 卸载立即释放', async () => {
      const chrome = createShellChrome()
      withBattles(1)
      landscapePhone()
      const wrapper = mountWorkspace('playback', { shellChrome: chrome })
      await flushPromises()
      expect(chrome.immersive.value).toBe(true)
      expect(wrapper.find('[data-testid="showcase-hero"]').exists()).toBe(false)
      await switchTo(wrapper, 'data')
      expect(chrome.immersive.value).toBe(false)
      expect(wrapper.find('[data-testid="showcase-hero"]').exists()).toBe(true)
      await switchTo(wrapper, '3d')
      expect(chrome.immersive.value).toBe(true)
      expect(wrapper.find('[data-testid="showcase-hero"]').exists()).toBe(false)
      formState.isPortrait.value = true
      await flushPromises()
      expect(chrome.immersive.value).toBe(false)
      formState.isPortrait.value = false
      await flushPromises()
      expect(chrome.immersive.value).toBe(true)
      wrapper.unmount()
      expect(chrome.immersive.value).toBe(false)
    })

    it.each([
      ['非手机形态（平板 / 桌面）', () => { formState.isPhone.value = false }],
      ['精确指针（桌面窗口压矮）', () => { formState.coarse.value = false }],
    ])('%s 不申请', async (_name, tweak) => {
      const chrome = createShellChrome()
      withBattles(1)
      landscapePhone()
      tweak()
      const wrapper = mountWorkspace('playback', { shellChrome: chrome })
      await flushPromises()
      expect(chrome.immersive.value).toBe(false)
      wrapper.unmount()
    })

    it('还没有回放文件时不隐藏外壳；没有外壳 provider 时静默无操作', async () => {
      const chrome = createShellChrome()
      landscapePhone()
      const wrapper = mountWorkspace('playback', { shellChrome: chrome })
      await flushPromises()
      expect(chrome.immersive.value).toBe(false)
      wrapper.unmount()
      withBattles(1)
      const bare = mountWorkspace('playback')
      await flushPromises()
      bare.unmount()
    })
  })
})
