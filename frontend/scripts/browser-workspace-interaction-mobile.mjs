import { measureReachability } from './browser-occlusion.mjs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closePageTarget, PARSE_LIFECYCLE_BRIDGE, Page, check, clickCenterExpression, clickElement, clicked, confirmCollectionRemove, delay, dragPointer, enterReplay3d, fakeAnalysisOrigin, frontendRoot, openCollectionRemove, results, setLastPage, tapElement } from './browser-workspace-interaction-core.mjs'

export const MOBILE_FULLSCREEN_SCENARIOS = [
  { name: 'fullscreen-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60 },
]

export async function runMobileFullscreenScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-fullscreen"]'), { label: 'fullscreen button' })
  await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
  const button = await page.evaluate(`(() => {
    const r = document.querySelector('[data-test="pb-fullscreen"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  await page.tap({ ...button, touch: scenario.touch })
  await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'document.fullscreenElement' })
  await delay(200)

  const state = await page.evaluate(`(() => {
    const root = document.querySelector('[data-test="battle-playback"]')
    return {
      fullscreenIsRoot: document.fullscreenElement === root,
      formClass: Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null,
      displayOpen: !!document.querySelector('[data-testid="display-panel"]'),
    }
  })()`)
  check(failures, state.fullscreenIsRoot, 'fullscreen element is not the playback root')
  check(failures, state.formClass === 'pb-form-mobile', `fullscreen form=${state.formClass}, expected pb-form-mobile`)
  check(failures, !state.displayOpen, 'mobile fullscreen must not open the Display surface before ⚙')
  await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]').click()`)
  await delay(200)
  const drawer = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (!panel) return null
    const r = panel.getBoundingClientRect()
    const gear = document.querySelector('[data-testid="display-toggle"]').getBoundingClientRect()
    return {
      width: r.width,
      position: getComputedStyle(panel).position,
      distance: Math.hypot(Math.max(0, r.left - gear.right, gear.left - r.right), Math.max(0, r.top - gear.bottom, gear.top - r.bottom)),
      insideViewport: r.left >= -1 && r.right <= innerWidth + 1,
    }
  })()`)
  check(failures, !!drawer && drawer.width > 0 && drawer.position === 'absolute',
    `⚙ must open the Display surface as an anchored overlay in mobile fullscreen: ${JSON.stringify(drawer)}`)
  check(failures, !!drawer && drawer.distance <= 16,
    `Display must stay anchored to gear in mobile fullscreen: ${JSON.stringify(drawer)}`)
  check(failures, !!drawer && drawer.insideViewport,
    `Display must stay inside the viewport in mobile fullscreen: ${JSON.stringify(drawer)}`)

  await page.evaluate(`window.__pbFixture.setActive(false)`)
  const exited = await page.waitFor(() => !document.fullscreenElement, { timeout: 5000, label: 'fullscreen exits on deactivate' })
    .then(() => true, () => false)
  check(failures, exited, 'deactivating the playback (active=false) must exit its own fullscreen')

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `fullscreen ${scenario.width}x${scenario.height}` })
}


export async function runSceneActivityScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)
  try {
    await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
    await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="replay"]'), { label: 'capability tabs' })
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="select-files-input"]')
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'activity.wotbreplay'))
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await enterReplay3d(page, scenario)
    await page.waitFor(() => !!window.__pbPane?.sceneApi, { label: '3D scene' })
    await page.evaluate(`(() => {
      const scene = window.__pbPane.sceneApi
      const setPaused = scene.setPaused.bind(scene)
      const setPlaying = scene.setPlaying.bind(scene)
      window.__activityProbe = { scene, pauses: [], plays: [], visibility: 'visible' }
      scene.setPaused = value => { window.__activityProbe.pauses.push(value); return setPaused(value) }
      scene.setPlaying = value => { window.__activityProbe.plays.push(value); return setPlaying(value) }
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__activityProbe.visibility })
    })()`)
    await page.evaluate(`window.__activityProbe.visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))`)
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === true, { label: 'hidden scene pauses' })
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide')); window.__activityProbe.visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'))`)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 0))')
    check(failures, await page.evaluate('window.__activityProbe.pauses.at(-1)') === true, 'visibility alone must not resume a pagehidden scene')
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow'))`)
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === false, { label: 'shown scene resumes' })
    check(failures, await page.evaluate('window.__activityProbe.scene === window.__pbPane.sceneApi'), 'foreground transition must reuse scene')
    check(failures, await page.evaluate('window.__activityProbe.plays.length') === 0, 'foreground transition must preserve playback intent')
    const data = await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="data"]'), Boolean, { label: 'data capability tab' })
    await page.tap({ ...data, touch: scenario.touch })
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === true, { label: 'inactive 3D scene pauses' })
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pageshow'))`)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 0))')
    check(failures, await page.evaluate('window.__activityProbe.pauses.at(-1)') === true, 'foreground transition must not resume inactive 3D scene')
    check(failures, await page.evaluate('window.__activityProbe.plays.length') === 0, 'capability switch must preserve playback intent')
    results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
  } finally {
    await closePageTarget(env.chrome, targetId)
  }
}

export const LIFECYCLE_SCENARIOS = [
  { name: 'parse-lifecycle-a-clear-b-390x844-coarse', width: 390, height: 844, touch: true },
  { name: 'parse-lifecycle-a-clear-b-740x360-coarse', width: 740, height: 360, touch: true },
]

export const PARSE_WORKER_STUB_URL = '/scripts/browser-fixtures/playback-parse-worker-stub.mjs'

export const PARSE_WORKER_STATE = `(() => {
  const fixture = window.__pbWorkerFixture
  const workers = fixture ? fixture.workers : []
  const ids = workers.map((worker) => worker.requests.map((request) => request.id))
  const store = window.__pbPane && window.__pbPane.store
  return {
    workers: workers.length,
    ids,
    requests: ids.reduce((sum, list) => sum + list.length, 0),
    terminations: workers.reduce((sum, worker) => sum + worker.terminations, 0),
    unclaimed: workers.reduce((sum, worker) => sum + worker.unclaimed.length, 0),
    paneStore: store ? { loading: store.loading, hasData: store.hasData, err: store.err } : null,
  }
})()`

export const RELEASE_WORKER_RESPONSES = `(() => {
  const fixture = window.__pbWorkerFixture
  for (const worker of fixture.workers) { worker.unclaimed.length = 0; worker.releaseResponses() }
  return fixture.workers.map((worker) => worker.requests.map((request) => request.id))
})()`

export async function runParseLifecycleScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&ws-manual-3d=1&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="replay"]'), { label: 'capability tabs' })
  await page.evaluate(PARSE_LIFECYCLE_BRIDGE)

  await enterReplay3d(page, scenario)
  await page.waitFor(() => !!window.__pbReplaySource, { label: 'replaySource debug bridge' })
  const injected = await page.evaluate(`(async () => {
    const stub = await import(${JSON.stringify(PARSE_WORKER_STUB_URL)})
    const source = window.__pbReplaySource
    if (!source) throw new Error('replaySource debug bridge missing (?debug required)')
    source.__setParseWorkerForTest(stub.installParseWorkerFixture())
    return true
  })()`).catch((error) => `Error: ${error?.message || error}`)
  check(failures, injected === true, `worker fixture injection failed: ${JSON.stringify(injected)}`)

  await page.evaluate('window.__pbSelect("lifecycle-a.wotbreplay", [1, 2, 3, 4])')
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  const startA = await tapElement(page, '[data-test="replay3d-start"]', {
    touch: scenario.touch,
    verify: () => page.waitForValue(PARSE_WORKER_STATE, (state) => state.requests >= 1, { timeout: 5000, label: 'battle A parse request' }),
  })
  check(failures, startA, 'battle A start button was not hit-testable or the tap did not reach the parse worker')
  if (!startA) {
    await closePageTarget(env.chrome, targetId)
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }

  const inFlight = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.requests >= 1, {
      timeout: 15_000,
      label: 'battle A parse request reached the worker',
    })
    .catch(() => null)
  check(failures, inFlight !== null, `battle A parse never reached the worker: ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  check(failures, inFlight?.paneStore?.loading === true,
    `battle A must be in-flight before the clear (state=${JSON.stringify(inFlight)})`)
  check(failures, inFlight?.paneStore?.err === '' && inFlight?.paneStore?.hasData === false,
    `battle A must still be pending (no err / no data) at clear time (state=${JSON.stringify(inFlight)})`)

  const chipCenter = await openCollectionRemove(page, scenario)
  check(failures, !!chipCenter, 'collection remove button must be hit-testable')
  if (!chipCenter) {
    await closePageTarget(env.chrome, targetId)
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }
  await page.installInputTrace()
  await dragPointer(page, chipCenter, { x: chipCenter.x - 24, y: chipCenter.y - 24 }, { touch: scenario.touch })
  const dragInput = await page.inputTrace()
  check(failures, dragInput.clickCount === 0, `remove-button drag must not click: ${JSON.stringify(dragInput)}`)
  check(failures, await page.evaluate(`!!document.querySelector('[data-testid="collection-remove"]') && !!window.__pbPane?.store.loading`),
    'remove-button drag cleared selection or stopped battle A parse')
  await page.resetInputTrace()
  await page.tap({ ...chipCenter, touch: scenario.touch })
  const clearInput = await page.inputTrace()
  const click = clearInput?.click
  const insideChip = click && chipCenter.box
    && click.x >= chipCenter.box.left && click.x <= chipCenter.box.right
    && click.y >= chipCenter.box.top && click.y <= chipCenter.box.bottom
  check(failures, click?.testId === 'collection-remove' && insideChip,
    `the real click at (${click?.x},${click?.y}) must land on the remove button ${JSON.stringify(chipCenter.box)} (target=${JSON.stringify(click)})`)
  check(failures, clearInput.clickCount === 1, `remove tap must click exactly once: ${JSON.stringify(clearInput)}`)
  check(failures, clearInput.pointers.some((event) => event.type === 'pointerdown' && event.testId === 'collection-remove')
    && clearInput.pointers.some((event) => event.type === 'pointerup' && event.testId === 'collection-remove')
    && !clearInput.pointers.some((event) => event.type === 'pointercancel'),
    `remove tap must complete the real pointer sequence: ${JSON.stringify(clearInput)}`)
  await confirmCollectionRemove(page, scenario)
  await page.waitFor(() => !document.querySelector('.pb-root'), { label: '3D pane torn down after clear' })

  const aborted = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.terminations >= 1, {
      timeout: 10_000,
      label: 'worker terminated after aborting battle A parse',
    })
    .catch(() => null)
  check(failures, aborted !== null,
    `clearing battle A did not abort the in-flight parse (worker never terminated): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)

  await page.evaluate('window.__pbSelect("lifecycle-b.wotbreplay", [5, 6, 7, 8])')
  await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { label: 'pre-start for battle B' })
  const startB = await page.evaluate(clickCenterExpression('[data-test="replay3d-start"]'))
  check(failures, !!startB, 'battle B start button not hit-testable')
  if (!startB) {
    await closePageTarget(env.chrome, targetId)
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }
  await page.tap({ ...startB, touch: scenario.touch })

  const bRequest = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.requests >= 2, {
      timeout: 15_000,
      label: 'battle B parse request reached the worker',
    })
    .catch(() => null)
  check(failures, bRequest !== null,
    `battle B parse never reached the worker (stuck behind the abandoned A request?): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  check(failures, bRequest !== null && bRequest.workers >= 2 && bRequest.ids?.[1]?.length === 1,
    `battle B must parse on a re-created worker (abort must release the old queue): ${JSON.stringify(bRequest)}`)

  await page.evaluate(RELEASE_WORKER_RESPONSES)

  const settledB = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.paneStore !== null && state.paneStore.loading === false
      && (state.paneStore.hasData === true || state.paneStore.err !== ''), {
      timeout: 30_000,
      label: 'battle B parse settled (not stuck in parsing)',
    })
    .catch(() => null)
  check(failures, settledB !== null,
    `battle B parse did not settle after A was cleared (stuck in parsing?): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  check(failures, settledB?.paneStore?.hasData === true && settledB?.paneStore?.err === '',
    `battle B must settle ready (old parse must not own the new session): ${JSON.stringify(settledB?.paneStore)}`)

  const lateSettlement = await page.evaluate(`(async () => {
    const store = window.__pbPane && window.__pbPane.store
    const snapshot = () => (store ? { hasData: store.hasData, err: store.err, loading: store.loading } : null)
    const before = snapshot()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { before, after: snapshot(), state: ${PARSE_WORKER_STATE} }
  })()`)
  check(failures, JSON.stringify(lateSettlement?.before) === JSON.stringify(lateSettlement?.after),
    `late battle A response mutated the current session: ${JSON.stringify(lateSettlement)}`)
  check(failures, lateSettlement?.state?.unclaimed >= 1,
    `late battle A response must be unclaimed (none ignored): ${JSON.stringify(lateSettlement)}`)

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

export async function runOfflineWorkspaceScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  let phase = 'offline'
  const businessAttempts = []
  const recoveredReads = []
  const pendingQueries = ['/api/admin/hof/hundred/submissions', '/api/admin/hof/mark3/submissions']
  const interceptionErrors = []
  let closing = false
  await page.enable()
  await page.emulate({ width: 1600, height: 900, touch: false })
  await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__offlineFixtureOnline = false;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__offlineFixtureOnline });`,
  }, sessionId)
  env.chrome.client.on('Fetch.requestPaused', async (params, session) => {
    if (session !== sessionId) return
    const url = new URL(params.request.url)
    const assetPath = ['^/glb/', '^/map/', '^/tank/', '^/tank_images/', '^/data/']
      .some((p) => url.pathname.startsWith(p.slice(1)))
    const stage = phase
    const method = params.request.method
    const business = (url.origin !== env.origin || url.pathname.startsWith('/api/')) && !assetPath
    const sameOrigin = url.origin === env.origin
    const telemetry = url.pathname === '/api/observability/events' && method === 'POST'
    let payload
    if (stage === 'online' && sameOrigin && method === 'GET') {
      if (url.pathname === '/api/health' && !url.search) payload = { status: 'ok', tanks: 1, capabilities: ['recommendations-v1'] }
      if (url.pathname === '/api/recommendations/categories' && !url.search) {
        payload = [{ id: 1, name: 'Creator fixture', type: 'UP' }]
      }
      if (url.pathname === '/api/users/onboarding' && !url.search) payload = { coreEpoch: 1, disposition: 'SKIPPED' }
      if (pendingQueries.includes(url.pathname) && url.searchParams.size === 3 && url.searchParams.get('status') === 'PENDING'
        && url.searchParams.get('page') === '1' && url.searchParams.get('size') === '1') {
        payload = { items: [], page: 1, size: 1, totalItems: 0, totalPages: 0 }
      }
    }
    if (payload !== undefined || (stage === 'online' && sameOrigin && telemetry)) {
      if (payload !== undefined) recoveredReads.push(url.pathname)
      await env.chrome.client.send('Fetch.fulfillRequest', payload === undefined
        ? { requestId: params.requestId, responseCode: 204 }
        : { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
            body: Buffer.from(JSON.stringify(payload)).toString('base64') }, sessionId)
      return
    }
    if (business) businessAttempts.push(stage + ' ' + method + ' ' + params.request.url)
    try {
      await env.chrome.client.send(business ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        business ? { requestId: params.requestId, errorReason: 'InternetDisconnected' } : { requestId: params.requestId }, sessionId)
    } catch (error) {
      if (!closing && !error.message.includes('Invalid InterceptionId')) interceptionErrors.push(error.message)
    }
  })
  await env.chrome.client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
  const params = '&ws-auth=1&ws-roles=wotbtools-admin&ws-login=reject'
  for (const [view, selector] of [
    ['agent-replay', '[data-testid="ws-3d-connectivity"]'],
    ['ai-review', '[data-testid="ws-ai-connectivity"]'],
    ['hof', '[data-testid="hof-connectivity"]'],
    ['profile', '[data-testid="profile-connectivity-unavailable"]'],
  ]) {
    const viewParams = ['ai-review', 'hof'].includes(view) ? params.replace('ws-auth=1', 'ws-auth=0') : params
    await page.goto(`${env.origin}/?view=${view}${viewParams}`)
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean, { label: `offline deep link ${view}` })
    check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0, `${view} started login offline`)
  }
  for (let restart = 0; restart < 2; restart++) {
    await page.goto(`${env.origin}/?view=replay${params}`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'offline shell/restart' })
  }
  const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
  }, sessionId)
  await env.chrome.client.send('DOM.setFileInputFiles', {
    nodeId, files: [resolve(frontendRoot, '../common/fixtures/replays/tournament-14-14-example.wotbreplay')],
  }, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 60_000, label: 'real WASM local Result' })
  const ratings = await page.evaluate(`Array.from(document.querySelectorAll('.cw-player-summary tr.player-row td:nth-child(2)')).map(cell => cell.textContent.trim())`)
  check(failures, ratings.length > 0 && ratings.some(value => /[0-9]/.test(value)), 'deterministic local Rating has no scored rows')
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="replay"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: 'real WASM 2D playback' })
  await page.waitFor(() => {
    const map = document.querySelector('[data-test="pb-basemap"]')
    return !!map && map.complete && map.naturalWidth > 0
  }, { label: 'bundled local 2D map' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="shots"]').click()`)
  await page.waitFor(() => document.querySelectorAll('.shot-row').length > 0, { timeout: 60_000, label: 'real WASM local shooting inspection' })
  const shots = await page.evaluate('document.querySelectorAll(".shot-row").length')
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="ai"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'offline AI gate' })
  check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0, 'AI started login offline')
  phase = 'online'
  await page.evaluate(`performance.clearResourceTimings(); window.__offlineFixtureOnline = true; window.dispatchEvent(new Event('online'))`)
  await page.waitFor(() => !document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'reconnect capability update' })
  await page.waitFor(() => !!document.querySelector('[data-testid="nav-creators"]'), { label: 'read-only backend capability probe completed' })
  const expectedReads = ['/api/health', '/api/recommendations/categories', '/api/users/onboarding', ...pendingQueries]
  await page.waitForValue('performance.getEntriesByType("resource").map(e => new URL(e.name).pathname)',
    paths => expectedReads.every(path => paths.includes(path)), { label: 'all reconnect reads completed' })
  phase = 'offline again'
  await page.evaluate(`window.__offlineFixtureOnline = false; window.dispatchEvent(new Event('offline'))`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'disconnect capability update' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="shots"]').click()`)
  check(failures, await page.evaluate('document.querySelectorAll(".shot-row").length') === shots, 'disconnect reset local shooting/replay state')
  check(failures, businessAttempts.length === 0, `offline/reconnect matrix attempted business HTTP: ${businessAttempts.join(', ')}`)
  check(failures, recoveredReads.sort().join(',') === expectedReads.sort().join(','),
    'expected each reconnect GET exactly once, got ' + recoveredReads.join(', '))
  check(failures, interceptionErrors.length === 0, `request interception failed: ${interceptionErrors.join(', ')}`)
  closing = true
  await closePageTarget(env.chrome, targetId)
  results.push({ name: 'offline-local-workspace-matrix', failures, viewport: '1600x900' })
}

export async function runReplayCollectionScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  const tempDir = await mkdtemp(join(tmpdir(), 'wotb-replay-collection-'))
  const fixture = name => resolve(frontendRoot, `../common/fixtures/replays/${name}.wotbreplay`)
  const setFiles = async (files) => {
    const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await env.chrome.client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-testid="select-files-input"]' }, sessionId)
    await env.chrome.client.send('DOM.setFileInputFiles', { nodeId, files }, sessionId)
  }
  const press = async (key, code) => {
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) }, sessionId)
    await env.chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code }, sessionId)
  }
  const hit = async (selector) => {
    const point = await page.waitForValue(clickCenterExpression(selector), Boolean, { label: selector })
    await page.tap({ ...point, touch: false })
  }
  const openList = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await hit('[data-testid="collection-trigger"]')
      const opened = await page.waitForValue(`!!document.querySelector('[data-testid="replay-collection"]')`, Boolean, { timeout: 3000, label: 'collection list' }).catch(() => false)
      if (opened) return
    }
    throw new Error('collection list did not open')
  }
  const roster = `Array.from(document.querySelectorAll('[data-test="pb-roster-row"]')).map(row => row.dataset.accountId).join(',')`
  const contentTop = `(() => { window.scrollTo(0, 0); return Math.round(document.querySelector('.workspace-content').getBoundingClientRect().top) })()`
  const heroHeight = `Math.round(document.querySelector('.workspace-head .showcase-hero')?.getBoundingClientRect().height ?? 0)`
  const trigger = `document.querySelector('[data-testid="collection-trigger"]')?.textContent ?? ''`
  try {
    await page.enable()
    await page.emulate({ width: 1440, height: 900, touch: false })
    await page.goto(`${env.origin}/?view=agent-tankopedia&ws-auth=1`)
    await hit('[data-testid="nav-replay"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="file-uploader-empty"]'), { label: 'empty workspace' })
    const entryLength = await page.evaluate('history.length')
    await hit('[data-testid="ws-tab"][data-cap="replay"]')

    await setFiles([fixture('random-battle-example')])
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]') && !!document.querySelector('[data-testid="collection-trigger"]'), { timeout: 60_000, label: 'replay opens without a parse action' })
    const before = await page.waitForValue(roster, Boolean, { timeout: 60_000, label: 'first battle roster' })
    check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="file-uploader-empty"]')`), 'Ready must not keep the upload card')
    check(failures, await page.evaluate(`!!document.querySelector('[data-testid="replay-battle-picker"]:not(button)')`), 'a single replay shows static battle context')
    const singleHero = await page.evaluate(heroHeight)
    check(failures, singleHero >= 240 && singleHero <= 400, `replay compact hero must stay 240-400px at 1440: ${singleHero}`)
    const toolbarClearance = `(() => { const t = document.querySelector('.workspace-toolbar')?.getBoundingClientRect(); const h = document.querySelector('.workspace-head .showcase-hero')?.getBoundingClientRect(); return t && h ? Math.round(t.top - h.bottom) : -1 })()`
    check(failures, await page.evaluate(`${toolbarClearance} >= -2 && ${toolbarClearance} <= 24`), `replay toolbar must sit right below the taller hero: ${await page.evaluate(toolbarClearance)}`)
    const toolbarAtDocumentTop = await page.evaluate(`(() => {
      const rect = document.querySelector('.workspace-toolbar')?.getBoundingClientRect()
      if (!rect) return null
      return {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        viewportHeight: innerHeight,
        scrollY: window.scrollY,
      }
    })()`)
    check(failures, !!toolbarAtDocumentTop
      && toolbarAtDocumentTop.top >= 0
      && toolbarAtDocumentTop.bottom <= toolbarAtDocumentTop.viewportHeight,
    `replay toolbar must fit within the initial 1440x900 viewport: ${JSON.stringify(toolbarAtDocumentTop)}`)
    const singleTop = await page.evaluate(contentTop)
    check(failures, singleTop <= 175 + singleHero, `single-battle content must start within 175px + hero at 1440: ${singleTop} (hero ${singleHero})`)

    await page.emulate({ width: 1920, height: 540, touch: false })
    const shortHero = await page.evaluate(heroHeight)
    check(failures, shortHero >= 120 && shortHero <= 140, `replay hero must fall back to compact density in short windows: ${shortHero}`)
    check(failures, await page.evaluate(`(() => { const t = document.querySelector('[data-testid="collection-trigger"]')?.getBoundingClientRect(); return !!t && t.top >= 0 && t.bottom <= innerHeight })()`), 'collection trigger must stay visible in short windows')
    await page.emulate({ width: 1440, height: 900, touch: false })

    const broken = join(tempDir, 'broken.wotbreplay')
    await writeFile(broken, Buffer.alloc(64, 7))
    await page.evaluate(`(window.__collectionPane = document.querySelector('[data-test="battle-playback"]'), true)`)
    await setFiles([fixture('cw-training-15-14-example'), fixture('tournament-14-14-example'), broken])
    await page.waitFor(() => !!document.querySelector('[data-testid="workspace-partial-failure"]'), { timeout: 60_000, label: 'partial failure warning' })
    check(failures, await page.evaluate(`window.__collectionPane === document.querySelector('[data-test="battle-playback"]')`), 'adding replays must not rebuild the current pane')
    check(failures, await page.evaluate(roster) === before, 'adding replays must not change the current battle')
    check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="replay-processing-panel"]')`), 'a partial failure must not show the failure page')
    check(failures, (await page.evaluate(trigger)).includes('4'), `collection must count every file: ${await page.evaluate(trigger)}`)

    await hit('[data-testid="partial-failure-ack"]')
    await page.waitFor(() => !document.querySelector('[data-testid="workspace-partial-failure"]'), { label: 'warning acknowledged' })
    check(failures, /1/.test((await page.evaluate(trigger)).replace(/.*·/, '').replace(/^\s*4/, '')), `acknowledged failure stays on the trigger: ${await page.evaluate(trigger)}`)

    await page.evaluate(`document.querySelector('[data-testid="collection-trigger"]').focus()`)
    await press('Enter', 13)
    await page.waitFor(() => !!document.querySelector('[data-testid="collection-row"]'), { label: 'keyboard opens the list' })
    const rows = await page.evaluate(`Array.from(document.querySelectorAll('[data-testid="collection-row"]')).map(row => row.dataset.status)`)
    check(failures, rows.filter(status => status === 'ready').length === 3 && rows.filter(status => status === 'failed').length === 1, `collection row statuses: ${rows}`)
    await press('Tab', 9)
    check(failures, await page.evaluate(`!!document.activeElement?.closest('[data-testid="collection-panel"]')`), 'focus must stay inside the list')
    await press('Escape', 27)
    await page.waitForValue(`document.activeElement?.dataset?.testid`, value => value === 'collection-trigger', { label: 'focus returns to the trigger' })

    await openList()
    await page.waitFor(() => document.querySelectorAll('[data-testid="collection-remove"]').length === 4, { label: 'remove buttons' })
    await page.evaluate(`document.querySelector('[data-testid="collection-row"][data-status="failed"] [data-testid="collection-remove"]').click()`)
    await hit('[data-testid="remove-confirm-ok"]')
    await page.waitFor(() => /· 3/.test(document.querySelector('[data-testid="collection-trigger"]')?.textContent ?? ''), { label: 'failed replay removed' })
    check(failures, await page.evaluate(roster) === before, 'removing another replay must not change the current battle')
    await page.waitForValue(`document.activeElement?.dataset?.testid`, value => value === 'collection-trigger', { label: 'focus returns after removal' })

    for (const [width, height, touch, limit] of [[1440, 900, false, 120], [768, 1024, true, null], [390, 844, true, null]]) {
      await page.emulate({ width, height, touch })
      await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="data"]').click()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { label: 'Data capability' })
      await page.evaluate(`document.querySelector('[data-testid="data-view-summary"]').click()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="series-overview"]'), { label: 'Data summary' })
      const hero = await page.evaluate(heroHeight)
      if (width === 390) check(failures, hero >= 88 && hero <= 110, `compact hero must stay 88-110px at 390: ${hero}`)
      const top = await page.evaluate(contentTop)
      if (limit) check(failures, top <= limit + hero, `Data content must start within ${limit}px + hero at ${width}: ${top} (hero ${hero})`)
      check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="battle-picker"]')`), 'Data summary must not show a current battle picker')
      await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="replay"]').click()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="replay-battle-picker"]'), { label: 'single-battle picker' })
      const metrics = await page.evaluate(`(() => {
        window.scrollTo(0, 0)
        const button = document.querySelector('[data-testid="collection-trigger"]').getBoundingClientRect()
        return {
          top: Math.round(document.querySelector('.workspace-content').getBoundingClientRect().top),
          overflow: document.documentElement.scrollWidth - innerWidth,
          trigger: Math.round(button.height),
        }
      })()`)
      console.log(`[browser-interaction] replay-collection ${width}x${height} ${JSON.stringify({ dataTop: top, ...metrics })}`)
      check(failures, metrics.overflow <= 0, `no horizontal overflow at ${width}: ${JSON.stringify(metrics)}`)
      if (touch) check(failures, metrics.trigger >= 44, `manage trigger needs a 44px target at ${width}: ${JSON.stringify(metrics)}`)
      if (width === 1440) check(failures, metrics.top <= 175 + hero, `single-battle content must start within 175px + hero at 1440: ${JSON.stringify({ ...metrics, hero })}`)
      if (width === 390) check(failures, metrics.top <= 350 + hero, `single-battle content must start within 350px + hero at 390: ${JSON.stringify({ ...metrics, hero })}`)
    }

    await page.emulate({ width: 1440, height: 900, touch: false })
    await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="data"]').click()`)
    await openList()
    await hit('[data-testid="collection-clear"]')
    await hit('[data-testid="collection-clear-confirm"]')
    await page.waitFor(() => !!document.querySelector('[data-testid="file-uploader-empty"]'), { label: 'clear returns to Empty' })
    check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="replay-battle-picker"]')`), 'clear must remove the battle context')

    await setFiles([fixture('random-battle-example')])
    await page.waitFor(() => !!document.querySelector('[data-testid="collection-trigger"]:not([disabled])'), { timeout: 60_000, label: 'replay ready before back' })
    await openList()
    await page.evaluate(`history.go(-(history.length - ${entryLength} + 1))`)
    await page.waitForValue('new URLSearchParams(location.search).get("view")', view => view !== 'replay' && view !== 'battle-playback', { label: 'browser back left the workspace' })
    await page.waitFor(() => !document.querySelector('[data-testid="replay-collection"]'), { label: 'list closed after back' })
    check(failures, !await page.evaluate(`!!document.querySelector('.dialog-scrim')`), 'no modal scrim may remain over the destination page')
  } finally {
    await closePageTarget(env.chrome, targetId)
    await rm(tempDir, { recursive: true, force: true })
  }
  results.push({ name: 'replay-collection', failures, viewport: '1440x900 → 768x1024 → 390x844' })
}

export const FORCED_UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
}
export const FORCED_LANDSCAPE_SCENARIOS = [
  { name: 'forced-landscape-iphone-portrait', ua: 'iphone', width: 390, height: 664, touch: true, expectPrompt: true },
  { name: 'forced-landscape-ipad-portrait', ua: 'ipad', width: 820, height: 1180, touch: true, expectPrompt: false },
  { name: 'forced-landscape-desktop-narrow', ua: 'desktop', width: 390, height: 664, touch: false, expectPrompt: false },
  { name: 'forced-landscape-iphone-landscape', ua: 'iphone', width: 844, height: 340, touch: true, expectPrompt: false, immersive: true },
]

export async function runForcedLandscapeScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  try {
    await page.enable()
    await env.chrome.client.send('Emulation.setUserAgentOverride', { userAgent: FORCED_UA[scenario.ua] }, sessionId)
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=battle-playback&ws-auth=1`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'replay picker' })
    const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
      nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
    }, sessionId)
    await env.chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [
      resolve(frontendRoot, '../common/fixtures/replays/cw-training-15-14-example.wotbreplay'),
    ] }, sessionId)
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: '2D playback loaded' })
    const prompt = await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")',
      value => value === scenario.expectPrompt, { timeout: 5000, label: `rotate prompt = ${scenario.expectPrompt}` }).catch(() => !scenario.expectPrompt)
    if (!scenario.expectPrompt) {
      await delay(800)
      check(failures, await page.evaluate('!document.querySelector("[data-testid=rotate-prompt]")'), `${scenario.name}: 非强制设备不得出现旋转提示`)
    } else {
      check(failures, prompt === true, `${scenario.name}: iPhone 竖屏必须出现旋转提示`)
      const action = await page.waitForValue(clickCenterExpression('[data-testid="rotate-prompt-action"]'), Boolean, { label: 'rotate prompt action' })
      await page.tap({ ...action, touch: true })
      await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")', value => value === false, { label: 'prompt dismissed by data capability' })
      check(failures, await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="data"]')?.getAttribute('aria-checked') === 'true'`),
        `${scenario.name}: 退出动作必须回到赛后数据`)
    }
    if (scenario.immersive) {
      await page.waitForValue('document.documentElement.dataset.shellChrome', value => value === 'immersive', { label: 'immersive shell' })
      const menu = await page.waitForValue(clickCenterExpression('[data-testid="nav-menu"]'), Boolean, { label: 'immersive menu hit-testable' })
      await page.tap({ ...menu, touch: true })
      await page.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'drawer from immersive menu' })
    }
  } finally {
    await closePageTarget(env.chrome, targetId)
  }
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

export const ARMOR_FORCED_LANDSCAPE_SCENARIOS = [
  { name: 'armor-forced-landscape-iphone-portrait', ua: 'iphone', width: 390, height: 664, touch: true, expectPrompt: true },
  { name: 'armor-forced-landscape-iphone-landscape', ua: 'iphone', width: 844, height: 340, touch: true, expectPrompt: false },
  { name: 'armor-forced-landscape-ipad-portrait', ua: 'ipad', width: 820, height: 1180, touch: true, expectPrompt: false },
  { name: 'armor-forced-landscape-desktop-narrow', ua: 'desktop', width: 390, height: 664, touch: false, expectPrompt: false },
]

export async function runArmorForcedLandscapeScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  try {
    await page.enable()
    await env.chrome.client.send('Emulation.setUserAgentOverride', { userAgent: FORCED_UA[scenario.ua] }, sessionId)
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=agent-armor&tank=2`)
    await page.waitFor(() => !!document.querySelector('.armor-viewer, [data-testid="armor-viewer"], #armor-canvas, canvas'), { timeout: 30_000, label: 'armor viewer mounted' })
    const prompt = await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")',
      value => value === scenario.expectPrompt, { timeout: 5000, label: `armor rotate prompt = ${scenario.expectPrompt}` }).catch(() => !scenario.expectPrompt)
    if (scenario.expectPrompt) {
      check(failures, prompt === true, `${scenario.name}: iPhone 竖屏打开装甲查看器必须出现旋转提示`)
      check(failures, await page.evaluate('!!document.querySelector("[data-testid=rotate-prompt-action]")'), `${scenario.name}: 旋转提示必须给出返回动作`)
    } else {
      await delay(800)
      check(failures, await page.evaluate('!document.querySelector("[data-testid=rotate-prompt]")'), `${scenario.name}: 不得出现旋转提示`)
    }
  } finally {
    await closePageTarget(env.chrome, targetId)
  }
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

export async function runMultiFileWorkspaceScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  try {
    await page.enable()
    await page.emulate({ width: 1600, height: 900, touch: false })
    await page.goto(`${env.origin}/?view=battle-playback&ws-auth=1`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'multi-file picker' })
    const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
      nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
    }, sessionId)
    await env.chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [
      resolve(frontendRoot, '../common/fixtures/replays/cw-training-15-14-example.wotbreplay'),
      resolve(frontendRoot, '../common/fixtures/replays/tournament-14-14-example.wotbreplay'),
    ] }, sessionId)
    const hit = async (selector, { touch = false } = {}) => {
      const point = await page.waitForValue(clickCenterExpression(selector), Boolean, { label: selector })
      await page.tap({ ...point, touch })
    }
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: 'first batch battle loaded in 2D' })
    const roster = `Array.from(document.querySelectorAll('[data-test="pb-roster-row"]')).map(row => row.dataset.accountId).join(',')`
    const firstRoster = await page.evaluate(roster)
    check(failures, !!firstRoster, 'first battle has no playback roster')
    await hit('[data-testid="replay-battle-picker"]')
    const options = await page.evaluate(`Array.from(document.querySelectorAll('[data-testid="battle-picker-option"]')).map(option => option.dataset.value)`)
    check(failures, JSON.stringify(options) === JSON.stringify(['r0', 'r1']), `unexpected batch options: ${options}`)
    await hit('[data-testid="battle-picker-option"][data-value="r1"]')
    await page.waitForValue(roster, value => !!value && value !== firstRoster, { timeout: 60_000, label: 'second original File loaded in 2D' })
    await hit('[data-testid="replay-battle-picker"]')
    await hit('[data-testid="battle-picker-option"][data-value="r0"]')
    await page.waitForValue(roster, value => value === firstRoster, { timeout: 60_000, label: 'cached first battle restored' })

    await page.emulate({ width: 390, height: 844, touch: true })
    await page.waitFor(() => !!document.querySelector('[data-testid="app-top-bar"]'), { label: 'mobile app top bar after resize' })
    await hit('[data-testid="replay-battle-picker"]', { touch: true })
    const sheet = await page.waitForValue(`(() => {
      const panel = document.querySelector('[data-testid="battle-picker-panel"]')
      const option = document.querySelector('[data-testid="battle-picker-option"][data-value="r1"]')
      if (!panel || !option) return null
      const rect = panel.getBoundingClientRect()
      const optionRect = option.getBoundingClientRect()
      const bottomHit = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight - 8))
      return {
        teleported: panel.parentElement === document.body && !panel.closest('.battle-picker'),
        bottom: Math.round(rect.bottom),
        viewportHeight: innerHeight,
        bottomOverShell: !!bottomHit && panel.contains(bottomHit),
        optionInViewport: optionRect.top >= 0 && optionRect.left >= 0
          && optionRect.right <= innerWidth && optionRect.bottom <= innerHeight,
      }
    })()`, Boolean, { label: 'mobile battle picker sheet' })
    check(failures, sheet.teleported, `mobile battle picker sheet is not teleported to body: ${JSON.stringify(sheet)}`)
    check(failures, Math.abs(sheet.bottom - sheet.viewportHeight) <= 1, `mobile battle picker sheet must end at viewport bottom: ${JSON.stringify(sheet)}`)
    check(failures, sheet.bottomOverShell, `shell chrome paints over the battle picker sheet: ${JSON.stringify(sheet)}`)
    check(failures, sheet.optionInViewport, `Battle 2 option is outside the viewport: ${JSON.stringify(sheet)}`)
    const sheetReach = await measureReachability(page, {
      options: ['[data-testid="battle-picker-option"]'],
      touch: true,
    })
    for (const failure of sheetReach.failures) check(failures, false, `battle picker sheet 可达性: ${failure}`)
    check(failures, sheetReach.sampled > 0, 'battle picker sheet 可达性断言空跑：没有任何选项被实际命中采样')
    await hit('[data-testid="battle-picker-option"][data-value="r1"]', { touch: true })
    await page.waitForValue(roster, value => !!value && value !== firstRoster, { timeout: 60_000, label: 'second battle after mobile sheet selection' })
    await page.waitForValue(`!document.querySelector('[data-testid="battle-picker-panel"]')`, Boolean,
      { timeout: 10_000, label: 'mobile battle picker sheet unmount after selection' })

    const shellState = `(() => ({
      topBar: !!document.querySelector('[data-testid="app-top-bar"]'),
      tabBar: !!document.querySelector('[data-testid="app-tab-bar"]'),
      sidebar: !!document.querySelector('[data-testid="app-sidebar"]'),
      headerH: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
      map: document.querySelector('.pb-map')?.getBoundingClientRect().width ?? 0,
      stage: document.querySelector('.pb-map-stage')?.getBoundingClientRect().width ?? 0,
    }))()`
    await page.emulate({ width: 740, height: 360, touch: true })
    const landscape = await page.waitForValue(shellState, (state) => !state.topBar && !state.tabBar && state.map > 0, { label: 'immersive shell in phone landscape' })
    console.log(`[browser-interaction] shell landscape state=${JSON.stringify(landscape)}`)
    check(failures, !landscape.sidebar, `immersive phone shell must not mount the sidebar either: ${JSON.stringify(landscape)}`)
    check(failures, landscape.headerH === '0px', `immersive shell must zero --header-h: ${JSON.stringify(landscape)}`)
    check(failures, landscape.map >= 260, `phone-landscape real-app map must be >= 260px: ${JSON.stringify(landscape)}`)
    console.log(`[browser-interaction] multifile 740x360 real-app map=${Math.round(landscape.map)}`)
    await page.emulate({ width: 390, height: 844, touch: true })
    const portrait = await page.waitForValue(shellState, (state) => state.topBar && !state.tabBar, { label: 'shell restored in portrait' })
    check(failures, !portrait.sidebar, `portrait phone shell must not mount the sidebar: ${JSON.stringify(portrait)}`)
    check(failures, portrait.headerH === '48px', `portrait must restore --header-h: ${JSON.stringify(portrait)}`)
    check(failures, portrait.map > 0 && Math.abs(portrait.map - portrait.stage) <= 2, `portrait map must fill the full column width: ${JSON.stringify(portrait)}`)
    await page.emulate({ width: 740, height: 360, touch: true })
    await page.waitForValue(shellState, (state) => !state.topBar, { label: 'immersive shell again' })
    await hit('[data-testid="ws-tab"][data-cap="data"]', { touch: true })
    await page.waitForValue(shellState,
      (state) => !state.sidebar && state.topBar && !state.tabBar && state.headerH === '48px',
      { label: 'drawer shell restored when leaving playback' })
  } finally {
    await closePageTarget(env.chrome, targetId)
  }
  results.push({ name: 'multifile-workspace-playback', failures, viewport: '1600x900 → 390x844 → 740x360' })
}


