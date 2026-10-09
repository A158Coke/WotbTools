/** Single-shot lifecycle gate. Uses real viewer/GLBs/penetration math; only asset
 * responses are delayed/replaced. No screenshots or visual assertions.
 * Separate from the aiming gate: exercises async initialization and route disposal,
 * not pointer gestures. Run: npm run test:browser-armor-shot-readiness
 */
import assert from 'node:assert/strict'
import featureMessages from '../src/locales/feature-messages.json' with { type: 'json' }
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_ID, FIXTURE_TANK_DATA, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const shooterId = FIXTURE_TANK_ID + 1
const labels = featureMessages.zh.armor
const shellFailurePrefix = labels.load_failed.replace('{phase}', labels.phase_shell_data).replace('{msg}', '')
const tankFailurePrefix = labels.load_failed.replace('{phase}', labels.phase_tank_data).replace('{msg}', '')
const ammo = structuredClone(FIXTURE_TANK_DATA)
ammo.tank_id = shooterId
// The URL deliberately selects the wrong shell; replay shell_id must win before
// the first calculation. Both types retain the fixture's ordinary armor geometry.
ammo.configs[0].shells = [
  { ...ammo.shells[0], penetration: 1 },
  { ...ammo.shells[0], type: 'heat', name: 'HEAT', penetration: 300 },
]
ammo.configs[0].shell_global_ids = [1, 2]
const shot = {
  index: 1, time_s: 12, shooter_eid: 7, target_eid: 8, is_author: true,
  shooter_tank_id: shooterId, target_tank_id: FIXTURE_TANK_ID,
  shooter_name: 'Shooter', target_name: 'Target',
  shell_id: 2, shell_slot: 1, damage: 320, hit_flags: 16, game_hit_result: 3,
  shooter_pos: [0, 0, 60], target_pos: [0, 0, 0], shooter_ang: [0, 0, 0], target_ang: [0, 0, 0],
  ball_a: [0, 1, 60], ball_b: [0, 1, 0], launch_velocity: [0, 0, -1000],
  tick_samples: [-0.1, 0].map(dt => ({ dt, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 })),
  shooter_tick_samples: [{ dt: 0, pos: [0, 0, 60], yaw: 0, pitch: 0, roll: 0 }],
}
const { server, origin } = await startFixtureServer()
const assets = await startFixtureAssetPack()
let browser
let page
try {
  browser = await launchChromeForCdp(findChrome(), { extraArgs: ['--enable-unsafe-swiftshader'] })
  const { sessionId } = await browser.openPage()
  page = new Page(browser.client, sessionId)
  const send = (method, params = {}) => browser.client.send(method, params, sessionId)
  await page.enable()
  await page.emulate({ width: 1280, height: 900, touch: false, deviceScaleFactor: 1 })
  const held = []
  const failedSwitchRequests = []
  const failedTargetRequests = []
  const operations = []
  let hold = true
  let response = ammo
  let failShooterSwitch = false
  let failTarget = false
  let shooterRequests = 0
  const release = requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body: Buffer.from(JSON.stringify(response)).toString('base64'),
  })
  browser.client.on('Fetch.requestPaused', (event, session) => {
    if (session !== sessionId) return
    if (event.request.url.includes('/tank/' + FIXTURE_TANK_ID + '.json')) {
      if (failTarget) {
        failTarget = false
        failedTargetRequests.push(event.requestId)
      } else if (failShooterSwitch) {
        failShooterSwitch = false
        failedSwitchRequests.push(event.requestId)
      } else operations.push(send('Fetch.continueRequest', { requestId: event.requestId }))
      return
    }
    shooterRequests++
    if (hold) held.push(event.requestId)
    else operations.push(release(event.requestId))
  })
  await send('Fetch.enable', { patterns: [shooterId, FIXTURE_TANK_ID].map(id => ({ urlPattern: `*/tank/${id}.json*`, requestStage: 'Request' })) })
  await page.goto(`${origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    localStorage.setItem('wotb-lang', 'zh');
    const { storeShotsForViewer } = await import('/src/scene/agentData.js');
    storeShotsForViewer([${JSON.stringify(shot)}]);
  })()`)
  const url = `${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${shooterId}&heatmap=1&shot=1&shell=0&scfg=0&assets=${encodeURIComponent(assets.origin)}`
  await page.goto(url)
  const waitHeld = async (requests = held) => {
    const end = Date.now() + 20000
    while (!requests.length && Date.now() < end) await delay(50)
    assert.ok(requests.length, 'asset request reached the controlled boundary')
  }
  await waitHeld()
  assert.equal(await page.evaluate(`['#shooter-select', '#target-select'].every(id => document.querySelector(id).disabled)`), true, 'bootstrap disables vehicle selection')
  assert.equal(await page.evaluate(`(() => {
    const status = document.querySelector('#tank-selection-status');
    return status.getClientRects().length > 0 && status.textContent === ${JSON.stringify(labels.picker_loading)};
  })()`), true, 'bootstrap has visible localized feedback')
  for (const id of ['shooter-select', 'target-select']) {
    const point = await page.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
    await page.tap({ ...point, touch: false })
  }
  assert.equal(await page.evaluate('document.querySelector("#tank-picker").classList.contains("open")'), false, 'disabled selection cannot open the picker')
  // Synthetic stale inputs must also leave initialization ownership intact.
  await page.evaluate(`document.querySelector('#shooter-select').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  assert.equal(await page.evaluate('document.querySelector("#tank-picker").classList.contains("open")'), false, 'bootstrap guard also ignores synthetic clicks')
  // Deliberately longer than both old 600/800ms timers. This is an injected slow
  // network interval, not a timing-based assertion about a pointer intermediate state.
  await delay(1800)
  assert.equal(await page.evaluate('window.__armorRicochet?.info().judgments || 0'), 0, 'no judgment with missing ammo')
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=scene3d-loading]")'), true, 'loading remains visible')
  hold = false
  await Promise.all(held.splice(0).map(release))
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes('PENETRATION'), { timeout: 30000, label: 'automatic penetration after ammo release' })
  assert.equal(await page.evaluate('document.querySelector("#shell-select").value'), '1', 'replay ammo selected before judgment')
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1, 'exactly one initial judgment')
  assert.equal(await page.evaluate(`['#shooter-select', '#target-select'].every(id => !document.querySelector(id).disabled) && document.querySelector('#tank-selection-status').hidden`), true, 'ready viewer restores selection and hides the loading hint')
  console.log('[shot-readiness] PASS: slow ammo, bootstrap ownership, automatic selection and first judgment')

  // Only target data fails: retry must reuse the already valid shooter ammo.
  const shooterRequestsBeforeTargetFailure = shooterRequests
  failTarget = true
  await page.evaluate(`document.querySelector('#target-select').click(); document.querySelector('#tp-grid .tank-card').click()`)
  await waitHeld(failedTargetRequests)
  await Promise.all(failedTargetRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'target failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(tankFailurePrefix)})`), true, 'target failure has the tank-data phase')
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('[data-testid="scene3d-loading"]') && document.querySelector('#traj-info')?.textContent.includes('PENETRATION'), { timeout: 30000, label: 'target retry recovers' })
  assert.equal(shooterRequests, shooterRequestsBeforeTargetFailure, 'target retry does not reload ready shooter ammo')
  console.log('[shot-readiness] PASS: target-only failure and retry reuse ready ammo')

  failShooterSwitch = true
  await page.evaluate(`document.querySelector('#shooter-select').click(); document.querySelector('#tp-grid .tank-card').click()`)
  await waitHeld(failedSwitchRequests)
  await page.evaluate(`document.querySelector('#shell-select').dispatchEvent(new Event('change'))`)
  await Promise.all(failedSwitchRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'shooter switch failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(shellFailurePrefix)})`), true, 'shooter failure has the shell-data phase')
  // The retry error must retain the shell-data phase until ammo is recovered.
  failShooterSwitch = true
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await waitHeld(failedSwitchRequests)
  await Promise.all(failedSwitchRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'shooter retry failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(shellFailurePrefix)})`), true, 'shooter retry failure has the shell-data phase')
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await page.waitFor(() => !document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('[data-testid="scene3d-loading"]') && document.querySelector('#traj-info')?.textContent.includes('PENETRATION'), { timeout: 30000, label: 'retry reloads changed shooter ammo and target' })
  assert.equal(await page.evaluate('document.querySelector("#shell-select").options.length'), 1)
  console.log('[shot-readiness] PASS: shooter switch failure and retry')

  // Same-document navigation is essential: destroying the document would mask a
  // stale callback writing window globals or the next viewer DOM.
  const navigate = query => page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify({ query })})`)
  await navigate({ view: 'home', 'ws-auth': '1' })
  hold = true
  await navigate(Object.fromEntries(new URL(url).searchParams))
  await waitHeld()
  await navigate({ view: 'home', 'ws-auth': '1' })
  // Open a fresh viewer with different ammo while the old shooter is still pending.
  await navigate({ view: 'agent-armor', 'ws-auth': '1', tank: String(FIXTURE_TANK_ID), heatmap: '1', assets: assets.origin })
  await page.waitFor(() => window.__armorRicochet?.info().meshCount > 0, { timeout: 30000, label: 'replacement viewer ready' })
  hold = false
  await Promise.all(held.splice(0).map(release))
  await delay(1000)
  assert.equal(await page.evaluate('document.querySelector("#shell-select").options.length'), 1, 'late ammo cannot overwrite replacement viewer')
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 0, 'late shot cannot calculate in replacement viewer')
  console.log('[shot-readiness] PASS: pending load → leave → replacement viewer')

  response = structuredClone(ammo)
  delete response.configs[0].shells[0].penetration
  await page.goto(url)
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { timeout: 20000, label: 'invalid ammo error state' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(shellFailurePrefix)})`), true, 'bootstrap failure has the shell-data phase')
  assert.equal(await page.evaluate('window.__armorRicochet?.info().judgments || 0'), 0, 'invalid ammo is not zero penetration')
  // Retry must rebuild initialization, including shooter data, after an ammo failure.
  response = ammo
  await page.evaluate('document.querySelector("[data-testid=scene3d-error] button").click()')
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes('PENETRATION'), { timeout: 30000, label: 'retry reloads ammo' })
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1)
  assert.deepEqual(page.consoleErrors.filter(message => message.startsWith('uncaught:')), [])
  await Promise.all(operations)
  console.log('[shot-readiness] PASS: invalid ammo error and recovery')
} catch (error) {
  if (page) console.error(JSON.stringify({ errors: page.consoleErrors, state: await page.evaluate(`({load:document.querySelector('#loading')?.textContent, status:document.querySelector('.scene-status-overlay')?.textContent, controls:document.querySelector('#turret-controls')?.textContent, info:window.__armorRicochet?.info(), ctx:window.__shotCtx, world:window.__worldTickCtx})`) }))
  throw error
} finally {
  await browser?.close()
  await server.close()
  await assets.close()
}
