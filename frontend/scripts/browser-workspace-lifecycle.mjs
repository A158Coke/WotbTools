import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export function createLifecycleScenarios({ Page, setLastPage, results, check, delay, dragPointer, fakeAnalysisOrigin, frontendRoot }) {
const LIFECYCLE_SCENARIOS = [
  { name: 'parse-lifecycle-a-clear-b-390x844-coarse', width: 390, height: 844, touch: true },
  { name: 'parse-lifecycle-a-clear-b-740x360-coarse', width: 740, height: 360, touch: true },
]

const PARSE_WORKER_STUB_URL = '/scripts/browser-fixtures/playback-parse-worker-stub.mjs'

const PARSE_LIFECYCLE_BRIDGE = `(() => {
  window.__pbSelect = (name, bytes) => {
    const input = document.querySelector('[data-testid="select-files-input"]')
    if (!input) throw new Error('file input missing')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], name))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.files.length
  }
  return true
})()`

async function openCollectionRemove(page, scenario) {
  const trigger = await page.waitForValue(clickCenterExpression('[data-testid="collection-trigger"]'), Boolean, { label: 'collection trigger' })
  await page.tap({ ...trigger, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('[data-testid="collection-remove"]'), { label: 'collection remove button' })
  return page.waitForValue(`(() => {
    const button = document.querySelector('[data-testid="collection-remove"]')
    if (!button) return null
    const r = button.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === button || button.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      : null
  })()`, Boolean, { label: 'collection remove hit-testable' }).catch(() => null)
}

async function confirmCollectionRemove(page, scenario) {
  const confirm = await page.waitForValue(clickCenterExpression('[data-testid="remove-confirm-ok"]'), Boolean, { label: 'remove confirmation' })
  await page.tap({ ...confirm, touch: scenario.touch })
}

function clickCenterExpression(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = element.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === element || element.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`
}

const PARSE_WORKER_STATE = `(() => {
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

const RELEASE_WORKER_RESPONSES = `(() => {
  const fixture = window.__pbWorkerFixture
  for (const worker of fixture.workers) { worker.unclaimed.length = 0; worker.releaseResponses() }
  return fixture.workers.map((worker) => worker.requests.map((request) => request.id))
})()`

async function runParseLifecycleScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="3d"]'), { label: 'capability tabs' })
  await page.evaluate(PARSE_LIFECYCLE_BRIDGE)

  await page.evaluate('window.__pbSelect("lifecycle-a.wotbreplay", [1, 2, 3, 4])')
  const tabCenter = await page.evaluate(clickCenterExpression('[data-testid="ws-tab"][data-cap="3d"]'))
  check(failures, !!tabCenter, '3D capability tab not hit-testable')
  if (!tabCenter) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }
  await page.tap({ ...tabCenter, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  const injected = await page.evaluate(`(async () => {
    const stub = await import(${JSON.stringify(PARSE_WORKER_STUB_URL)})
    const source = window.__pbReplaySource
    if (!source) throw new Error('replaySource debug bridge missing (?debug required)')
    source.__setParseWorkerForTest(stub.installParseWorkerFixture())
    return true
  })()`).catch((error) => `Error: ${error?.message || error}`)
  check(failures, injected === true, `worker fixture injection failed: ${JSON.stringify(injected)}`)

  const startA = await page.evaluate(clickCenterExpression('[data-test="replay3d-start"]'))
  check(failures, !!startA, 'battle A start button not hit-testable')
  if (!startA) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }
  await page.tap({ ...startA, touch: scenario.touch })

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
    await env.chrome.client.send('Target.closeTarget', { targetId })
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
    await env.chrome.client.send('Target.closeTarget', { targetId })
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

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

async function runOfflineWorkspaceScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  const businessAttempts = []
  const healthProbes = []
  const publicCategoryProbes = []
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
    const telemetry = url.origin === env.origin && url.pathname === '/api/observability/events'
      && params.request.method === 'POST'
    if (telemetry && await page.evaluate('window.__offlineFixtureOnline === true')) {
      await env.chrome.client.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 204 }, sessionId)
      return
    }
    const health = url.origin === env.origin && url.pathname === '/api/health' && params.request.method === 'GET'
    if (health && await page.evaluate('window.__offlineFixtureOnline === true')) {
      healthProbes.push(params.request.url)
      await env.chrome.client.send('Fetch.fulfillRequest', {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ status: 'ok', tanks: 1, capabilities: ['recommendations-v1'] })).toString('base64'),
      }, sessionId)
      return
    }
    const publicCategories = url.origin === env.origin && url.pathname === '/api/recommendations/categories' && params.request.method === 'GET'
    if (publicCategories && await page.evaluate('window.__offlineFixtureOnline === true')) {
      publicCategoryProbes.push(params.request.url)
      await env.chrome.client.send('Fetch.fulfillRequest', {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify([{ id: 1, name: 'Creator fixture', type: 'UP' }])).toString('base64'),
      }, sessionId)
      return
    }
    const business = (url.origin !== env.origin || url.pathname.startsWith('/api/')) && !assetPath
    if (business) businessAttempts.push(params.request.url)
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
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="playback"]').click()`)
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
  await page.evaluate(`window.__offlineFixtureOnline = true; window.dispatchEvent(new Event('online'))`)
  await page.waitFor(() => !document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'reconnect capability update' })
  await page.waitFor(() => !!document.querySelector('[data-testid="nav-creators"]'), { label: 'read-only backend capability probe completed' })
  await delay(300)
  await page.evaluate(`window.__offlineFixtureOnline = false; window.dispatchEvent(new Event('offline'))`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'disconnect capability update' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="shots"]').click()`)
  check(failures, await page.evaluate('document.querySelectorAll(".shot-row").length') === shots, 'disconnect reset local shooting/replay state')
  check(failures, businessAttempts.length === 0, `offline/reconnect matrix attempted business HTTP: ${businessAttempts.join(', ')}`)
  check(failures, healthProbes.length === 1, `reconnection must make exactly one read-only capability probe: ${healthProbes.length}`)
  check(failures, publicCategoryProbes.length === 1, `reconnection must make exactly one read-only public category probe: ${publicCategoryProbes.length}`)
  check(failures, interceptionErrors.length === 0, `request interception failed: ${interceptionErrors.join(', ')}`)
  closing = true
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: 'offline-local-workspace-matrix', failures, viewport: '1600x900' })
}

async function runReplayCollectionScenario(env) {
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
    await hit('[data-testid="ws-tab"][data-cap="playback"]')

    await setFiles([fixture('random-battle-example')])
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]') && !!document.querySelector('[data-testid="collection-trigger"]'), { timeout: 60_000, label: 'replay opens without a parse action' })
    const before = await page.waitForValue(roster, Boolean, { timeout: 60_000, label: 'first battle roster' })
    check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="file-uploader-empty"]')`), 'Ready must not keep the upload card')
    check(failures, await page.evaluate(`!!document.querySelector('[data-testid="playback-battle-picker"]:not(button)')`), 'a single replay shows static battle context')
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
      await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="playback"]').click()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="playback-battle-picker"]'), { label: 'single-battle picker' })
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
    check(failures, !await page.evaluate(`!!document.querySelector('[data-testid="playback-battle-picker"]')`), 'clear must remove the battle context')

    await setFiles([fixture('random-battle-example')])
    await page.waitFor(() => !!document.querySelector('[data-testid="collection-trigger"]:not([disabled])'), { timeout: 60_000, label: 'replay ready before back' })
    await openList()
    await page.evaluate(`history.go(-(history.length - ${entryLength} + 1))`)
    await page.waitForValue('new URLSearchParams(location.search).get("view")', view => view !== 'replay' && view !== 'battle-playback', { label: 'browser back left the workspace' })
    await page.waitFor(() => !document.querySelector('[data-testid="replay-collection"]'), { label: 'list closed after back' })
    check(failures, !await page.evaluate(`!!document.querySelector('.dialog-scrim')`), 'no modal scrim may remain over the destination page')
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    await rm(tempDir, { recursive: true, force: true })
  }
  results.push({ name: 'replay-collection', failures, viewport: '1440x900 → 768x1024 → 390x844' })
}


return { LIFECYCLE_SCENARIOS, PARSE_LIFECYCLE_BRIDGE, openCollectionRemove, confirmCollectionRemove, clickCenterExpression, runParseLifecycleScenario, runOfflineWorkspaceScenario, runReplayCollectionScenario }
}
