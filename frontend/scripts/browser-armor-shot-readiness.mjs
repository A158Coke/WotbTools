import assert from 'node:assert/strict'
import featureMessages from '../src/locales/feature-messages.json' with { type: 'json' }
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { FIXTURE_TANK_ID, FIXTURE_TANK_DATA, startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'
import { ArmorSection } from '../src/scene/penetration.js'
import { buildFindSpotsExpr } from './armor-spot-scan.mjs'
import upgradeFixtures from '../src/replay-local/compute/__fixtures__/upgrades/tanks.json' with { type: 'json' }

const shooterId = FIXTURE_TANK_ID + 1
const ARMOR_DEFAULT_FOV = 2 * Math.atan(Math.tan(18.75 * Math.PI / 360) * 1.1) * 180 / Math.PI
const labels = featureMessages.zh.armor
const penetrationText = labels.outcomes.penetration
const shellFailurePrefix = labels.load_failed.replace('{phase}', labels.phase_shell_data).replace('{msg}', '')
const tankFailurePrefix = labels.load_failed.replace('{phase}', labels.phase_tank_data).replace('{msg}', '')
const ammo = structuredClone(FIXTURE_TANK_DATA)
ammo.tank_id = shooterId
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
const xiSource = upgradeFixtures.find(item => item.modules.tankId === 27905)
const xiModules = { ...xiSource.modules, tankId: FIXTURE_TANK_ID }
const researchRoutes = {
  '/research/modules/ussr.json': { tanks: { [xiModules.stem]: xiModules } },
  '/research/consumables.json': { items: [] },
  '/research/provisions.json': { items: [] },
  '/research/params/format.json': { params: {} },
  '/research/params/structure.json': {},
  '/research/camouflage.json': { categories: {} },
  '/research/skills.json': { items: [], classes: {} },
}
const assets = await startFixtureAssetPack({ extraRoutes: Object.fromEntries(
  Object.entries(researchRoutes).map(([path, value]) => [path, { type: 'application/json', body: JSON.stringify(value) }]),
) })
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
  let targetResponse = null
  let shooterRequests = 0
  const release = (requestId, payload = response) => send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  })
  const pickFirstCard = async (buttonId) => {
    await page.evaluate(`document.getElementById(${JSON.stringify(buttonId)}).click()`)
    await page.waitForValue(`document.querySelectorAll('#tp-grid .tank-card').length`, count => count > 0,
      { timeout: 5000, label: `picker cards after ${buttonId}` })
    await page.evaluate(`document.querySelector('#tp-grid .tank-card').click()`)
  }
  browser.client.on('Fetch.requestPaused', (event, session) => {
    if (session !== sessionId) return
    if (event.request.url.includes('/tank/' + FIXTURE_TANK_ID + '.json')) {
      if (failTarget) {
        failTarget = false
        failedTargetRequests.push(event.requestId)
      } else if (failShooterSwitch) {
        failShooterSwitch = false
        failedSwitchRequests.push(event.requestId)
      } else if (targetResponse) operations.push(release(event.requestId, targetResponse))
      else operations.push(send('Fetch.continueRequest', { requestId: event.requestId }))
      return
    }
    if (event.request.url.includes('/research/devices.json')) {
      operations.push(release(event.requestId, { meta: {}, devices: [], presets: {} }))
      return
    }
    shooterRequests++
    if (hold) held.push(event.requestId)
    else operations.push(release(event.requestId))
  })
  await send('Fetch.enable', { patterns: [
    ...[shooterId, FIXTURE_TANK_ID].map(id => ({ urlPattern: `*/tank/${id}.json*`, requestStage: 'Request' })),
    { urlPattern: '*/research/devices.json', requestStage: 'Request' },
  ] })
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
    // The shot's parameters are collapsed; initialization feedback belongs to the visible scene loading surface.
    const status = document.querySelector('[data-testid="scene3d-loading"]');
    return status.getClientRects().length > 0 && status.textContent.includes(${JSON.stringify(labels.loading)});
  })()`), true, 'bootstrap has visible localized feedback')
  for (const id of ['shooter-select', 'target-select']) {
    const point = await page.evaluate(`(() => { const r = document.getElementById('${id}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
    await page.tap({ ...point, touch: false })
  }
  assert.equal(await page.evaluate('document.querySelector("#tank-picker").classList.contains("open")'), false, 'disabled selection cannot open the picker')
  await page.evaluate(`document.querySelector('#shooter-select').dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
  assert.equal(await page.evaluate('document.querySelector("#tank-picker").classList.contains("open")'), false, 'bootstrap guard also ignores synthetic clicks')
  await delay(1800)
  assert.equal(await page.evaluate('window.__armorRicochet?.info().judgments || 0'), 0, 'no judgment with missing ammo')
  assert.equal(await page.evaluate('!!document.querySelector("[data-testid=scene3d-loading]")'), true, 'loading remains visible')
  hold = false
  await Promise.all(held.splice(0).map(requestId => release(requestId)))
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'automatic penetration after ammo release' })
  assert.equal(await page.evaluate('document.querySelector("#shell-select").value'), '1', 'replay ammo selected before judgment')
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1, 'exactly one initial judgment')
  assert.equal(await page.evaluate(`['#shooter-select', '#target-select'].every(id => !document.querySelector(id).disabled) && document.querySelector('#tank-selection-status').hidden`), true, 'ready viewer restores selection and hides the loading hint')
  console.log('[shot-readiness] PASS: slow ammo, bootstrap ownership, automatic selection and first judgment')

  const shooterRequestsBeforeTargetFailure = shooterRequests
  failTarget = true
  await pickFirstCard('target-select')
  await waitHeld(failedTargetRequests)
  await Promise.all(failedTargetRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'target failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(tankFailurePrefix)})`), true, 'target failure has the tank-data phase')
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await page.waitForValue(`!document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('[data-testid="scene3d-loading"]') && document.querySelector('#traj-info')?.textContent.includes(${JSON.stringify(penetrationText)})`, value => value === true, { timeout: 30000, label: 'target retry recovers' })
  assert.equal(shooterRequests, shooterRequestsBeforeTargetFailure, 'target retry does not reload ready shooter ammo')
  console.log('[shot-readiness] PASS: target-only failure and retry reuse ready ammo')

  failShooterSwitch = true
  await pickFirstCard('shooter-select')
  await waitHeld(failedSwitchRequests)
  await page.evaluate(`document.querySelector('#shell-select').dispatchEvent(new Event('change'))`)
  await Promise.all(failedSwitchRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'shooter switch failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(shellFailurePrefix)})`), true, 'shooter failure has the shell-data phase')
  failShooterSwitch = true
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await waitHeld(failedSwitchRequests)
  await Promise.all(failedSwitchRequests.splice(0).map(requestId => send('Fetch.fulfillRequest', {
    requestId, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '',
  })))
  await page.waitFor(() => !!document.querySelector('[data-testid="scene3d-error"]'), { label: 'shooter retry failure' })
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="scene3d-error"]').textContent.includes(${JSON.stringify(shellFailurePrefix)})`), true, 'shooter retry failure has the shell-data phase')
  await page.evaluate('document.querySelector("[data-testid=scene3d-retry]").click()')
  await page.waitForValue(`!document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('[data-testid="scene3d-loading"]') && document.querySelector('#traj-info')?.textContent.includes(${JSON.stringify(penetrationText)})`, value => value === true, { timeout: 30000, label: 'retry reloads changed shooter ammo and target' })
  assert.equal(await page.evaluate('document.querySelector("#shell-select").options.length'), 1)
  console.log('[shot-readiness] PASS: shooter switch failure and retry')

  const navigate = query => page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify({ query })})`)
  await navigate({ view: 'home', 'ws-auth': '1' })
  hold = true
  await navigate(Object.fromEntries(new URL(url).searchParams))
  await waitHeld()
  await navigate({ view: 'home', 'ws-auth': '1' })
  await navigate({ view: 'agent-armor', 'ws-auth': '1', tank: String(FIXTURE_TANK_ID), heatmap: '1', assets: assets.origin })
  await page.waitFor(() => window.__armorRicochet?.info().meshCount > 0, { timeout: 30000, label: 'replacement viewer ready' })
  hold = false
  await Promise.all(held.splice(0).map(requestId => release(requestId)))
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
  response = ammo
  await page.evaluate('document.querySelector("[data-testid=scene3d-error] button").click()')
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'retry reloads ammo' })
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1)
  console.log('[shot-readiness] PASS: invalid ammo error and recovery')

  const plainAmmo = structuredClone(FIXTURE_TANK_DATA)
  const topShell = { ...plainAmmo.shells[0] }
  delete topShell.normalization
  delete topShell.ricochet
  plainAmmo.shells = [111, 222].map(penetration => ({ ...topShell, penetration }))
  const configShell = plainAmmo.configs[0].shells[0]
  plainAmmo.configs = [
    { ...plainAmmo.configs[0], label: 'Fixture 200/300', shells: [200, 300].map(penetration => ({ ...configShell, penetration, normalization: 5, ricochet: 85 })), shell_global_ids: [1, 2] },
    { ...plainAmmo.configs[0], label: 'Fixture 400/500', shells: [400, 500].map(penetration => ({ ...configShell, penetration, normalization: 2, ricochet: 80 })), shell_global_ids: [3, 4] },
  ]
  targetResponse = plainAmmo
  const plainUrl = `${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${FIXTURE_TANK_ID}&heatmap=1&assets=${encodeURIComponent(assets.origin)}`
  const assertShellTable = async (value, penetrations) => {
    const state = await page.evaluate(`({ value: document.querySelector('#shell-select').value, options: Array.from(document.querySelector('#shell-select').options, option => option.textContent) })`)
    assert.equal(state.value, String(value), 'deep-link shell index belongs to the active shell table')
    assert.equal(state.options.length, penetrations.length)
    penetrations.forEach((pen, index) => assert.ok(state.options[index].includes(`${pen}mm`), `shell ${index} uses configuration penetration ${pen}`))
  }
  for (const scenario of [
    { query: '&config=0&shell=1', value: 1, pens: [400, 500], retarget: true },
    { query: '&shell=1', value: 1, pens: [400, 500] },
    { query: '&config=0&shell=99', value: 0, pens: [400, 500] },
    { query: '&config=1&shell=-1', value: 0, pens: [400, 500] },
    { query: '&config=0&shell=invalid', value: 0, pens: [400, 500] },
    { query: '&config=0&scfg=0&shell=1', value: 1, pens: [200, 300] },
  ]) {
    await page.goto(plainUrl + scenario.query)
    await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && window.__armorRicochet?.info().meshCount > 0, { timeout: 30000, label: 'plain viewer ready' })
    await assertShellTable(scenario.value, scenario.pens)
    if (scenario.retarget) {
      await page.evaluate(`document.querySelector('#config-select').value = '1'; document.querySelector('#config-select').dispatchEvent(new Event('change'))`)
      await assertShellTable(scenario.value, scenario.pens)
      await page.evaluate(`document.querySelector('#config-select').value = '0'; document.querySelector('#config-select').dispatchEvent(new Event('change'))`)
      await assertShellTable(scenario.value, scenario.pens)
    }
  }
  console.log('[shot-readiness] PASS: plain configuration ammo, deep-link selection, invalid indices and shooter/target gun independence')

  const emptyCfgAmmo = structuredClone(FIXTURE_TANK_DATA)
  emptyCfgAmmo.shells = [{ ...emptyCfgAmmo.shells[0], penetration: 200, caliber: 100 }]
  const emptyCfgBase = emptyCfgAmmo.configs[0]
  emptyCfgAmmo.configs = [
    { ...emptyCfgBase, label: 'Fixture empty', shells: [], caliber: 122 },
    { ...emptyCfgBase, label: 'Fixture HE 500', shells: [{ ...emptyCfgBase.shells[0], penetration: 500, caliber: 152 }], caliber: 152 },
  ]
  targetResponse = emptyCfgAmmo
  const assertHudMatchesNative = async () => {
    await page.waitFor(() => /\d+\s*mm/.test(document.querySelector('[data-testid="hud-penetration"]')?.textContent || ''),
      { timeout: 10000, label: 'HUD penetration resolves at the scene distance' })
    const state = await page.evaluate(`(() => {
      const pens = texts => texts.map(text => (text.match(/(\\d+)mm/) || [])[1])
      return {
        native: pens(Array.from(document.querySelectorAll('#shell-select option'), o => o.textContent)),
        hud: pens(Array.from(document.querySelectorAll('[data-testid^="hud-shell-"]'), b => b.title)),
        visible: pens(Array.from(document.querySelectorAll('[data-testid="hud-penetration"]'), b => b.textContent.replace(/\\s/g, ''))),
        buttons: Array.from(document.querySelectorAll('[data-testid^="hud-shell-"]'), b => {
          const box = b.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
        value: document.querySelector('#shell-select').value,
      }
    })()`)
    assert.ok(state.native.length > 0, 'native shell table populated')
    assert.deepEqual(state.hud, state.native, 'HUD shell pens match the native/judgment table')
    assert.deepEqual(state.visible, [state.hud[Number(state.value)]], 'only selected shell penetration is visible')
    assert.ok(state.buttons.every(b => b.width >= 43.5 && b.height >= 43.5), `shell icons retain 44px touch targets: ${JSON.stringify(state.buttons)}`)
    return state
  }
  for (const scenario of [
    { query: '&scfg=0&shell=0', pens: [200], label: 'explicit scfg with empty config shells falls back to the top-level table' },
    { query: '&scfg=1&shell=0', pens: [500], label: 'explicit scfg with a populated config uses that table' },
    { query: '&shell=0', pens: [500], label: 'missing scfg uses the shooter default last config' },
    { query: '&scfg=9&shell=0', pens: [500], label: 'out-of-range scfg follows the HUD default rule' },
    { query: '&scfg=invalid&shell=0', pens: [500], label: 'non-numeric scfg follows the HUD default rule' },
  ]) {
    await page.goto(plainUrl + scenario.query)
    await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && window.__armorRicochet?.info().meshCount > 0, { timeout: 30000, label: `empty-config viewer ready (${scenario.label})` })
    await assertShellTable(0, scenario.pens)
    await assertHudMatchesNative()
  }
  console.log('[shot-readiness] PASS: explicit empty-config scfg, HUD/native/judgment share one table (top-level fallback, HUD default rule for invalid scfg)')
  for (const expected of ['530 mm', '500 mm']) {
    const point = await page.evaluate(`(() => {
      const r = document.querySelector('[data-testid="hud-calibrated"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    await page.tap({ ...point, touch: false })
    await page.waitForValue('document.querySelector("[data-testid=hud-penetration]").textContent.trim()',
      text => text === expected, { timeout: 5000, label: 'visible penetration follows calibration' })
    await assertHudMatchesNative()
  }
  targetResponse = plainAmmo

  const distanceAmmo = JSON.parse(JSON.stringify(plainAmmo))
  distanceAmmo.configs.forEach(config => { config.shells = [{ ...config.shells[0], type: 'ap', type_id: 0, penetration: 300, penetration_far: 260 }] })
  response = distanceAmmo
  targetResponse = distanceAmmo
  await page.goto(plainUrl + '&shell=0&eqcal=0')
  await page.waitForValue('document.querySelector("[data-testid=hud-distance]")?.disabled', value => value === false,
    { timeout: 30000, label: 'distance slider ready' })
  const distanceQuery = await page.evaluate('location.search')
  const originalView = await page.evaluate('window.__armorRicochet.info().view')
  await page.evaluate('document.querySelector("[data-testid=hud-distance]").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'End', code: 'End', windowsVirtualKeyCode: 35 })
  await page.waitForValue('window.__armorRicochet.aimingState().cameraDistance', value => Math.abs(value - 500) < 0.01,
    { timeout: 5000, label: 'range End moves camera to 500m' })
  const farView = await page.evaluate('window.__armorRicochet.info().view')
  assert.deepEqual(farView.target, originalView.target, 'range preserves orbit center')
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs((farView.position[axis] - farView.target[axis]) / farView.cameraDistance
      - (originalView.position[axis] - originalView.target[axis]) / originalView.cameraDistance) < 1e-6, 'range preserves viewing direction')
  }
  assert.equal(await page.evaluate('document.querySelector("[data-testid=hud-distance]").value'), '500')
  assert.equal(await page.evaluate('document.querySelector("[data-testid=hud-penetration]").textContent.trim()'), '260 mm')
  const wheelPoint = await page.evaluate(`(() => { const r = document.querySelector('#canvas-container canvas').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: -300 })
  await page.waitForValue('Number(document.querySelector("[data-testid=hud-distance]").value)', value => value < 500,
    { timeout: 5000, label: 'wheel updates range' })
  await page.waitForValue('window.__armorRicochet.aimingState().cameraSettledMs', value => value > 600,
    { timeout: 10000, label: 'wheel settles' })
  const rangeState = await page.evaluate(`({camera:window.__armorRicochet.aimingState().cameraDistance,range:Number(document.querySelector('[data-testid=hud-distance]').value),pen:document.querySelector('[data-testid=hud-penetration]').textContent.trim()})`)
  assert.equal(rangeState.range, Math.round(rangeState.camera))
  assert.equal(rangeState.pen, Math.round(300 - 40 * Math.max(0, rangeState.range - 100) / 400) + ' mm')
  await page.evaluate('document.querySelector("[data-testid=hud-distance]").focus()')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 })
  await page.waitForValue('window.__armorRicochet.aimingState().cameraDistance', value => Math.abs(value - 3) < 0.01,
    { timeout: 5000, label: 'range Home moves camera to 3m' })
  assert.equal(await page.evaluate('location.search'), distanceQuery, 'distance gestures never rewrite URL')
  console.log('[shot-readiness] PASS: range keyboard 3–500m, wheel synchronization, real far penetration, stable URL')
  {
    const trayAmmo = structuredClone(FIXTURE_TANK_DATA)
    trayAmmo.tank_id = shooterId
    trayAmmo.mechanics = [{
      name: 'TrayShell',
      kinds: ['ARMOR_PIERCING_CR'],
      sectors: [
        { distance: 50, factor: 1.4 },
        { distance: 120, factor: 1.2 },
        { distance: 200, factor: 1.0 },
        { distance: 720, factor: 0.8 },
      ],
    }]
    const trayShell = { ...trayAmmo.configs[0].shells[0], type: 'apcr', type_id: 1, name: 'APCR', penetration: 300, damage: 320 }
    const trayHe = { ...trayShell, type: 'he', type_id: 3, name: 'HE', penetration: 60, damage: 520 }
    trayAmmo.configs[0] = { ...trayAmmo.configs[0], shells: [trayShell, trayHe], shell_global_ids: [1, 2] }
    trayAmmo.shells = [trayShell, trayHe]
    response = trayAmmo
    targetResponse = null
    await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${shooterId}&heatmap=1&shell=0&scfg=0&assets=${encodeURIComponent(assets.origin)}`)
    await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && window.__armorRicochet?.info().meshCount > 0,
      { timeout: 30000, label: 'TrayShell static viewer ready' })
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="hud-distance"]');
      input.value = '51';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await page.waitForValue('window.__armorRicochet.aimingState().cameraDistance', value => Math.abs(value - 51) < 0.01,
      { timeout: 5000, label: 'center estimate at 51m' })
    await page.waitForValue('document.querySelector("[data-testid=hud-damage]").textContent.trim()', value => value === '384 HP',
      { timeout: 10000, label: 'center estimate damage at 51m' })
    assert.equal(await page.evaluate('document.querySelector("[data-testid=hud-multiplier]").textContent.trim()'), '×120%', 'center estimate uses the 51m band')
    assert.equal(await page.evaluate(`document.querySelector('label[for="armor-distance"]').textContent.trim()`), labels.distance_short)
    await page.waitFor(() => window.__armorRicochet.aimingState().cameraSettledMs > 400, { timeout: 20000, label: 'TrayShell camera settled' })
    const { hull } = await page.evaluate(buildFindSpotsExpr({ need: ['hull'], primarySections: [ArmorSection.HULL, ArmorSection.TURRET, ArmorSection.GUN] }))
    assert.ok(hull, 'TrayShell scene has a hittable hull')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hull.x, y: hull.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hull.x, y: hull.y, button: 'left', clickCount: 1 })
    const hitLine = new RegExp(`${labels.hit_distance}:\\s*([\\d.]+) ${labels.distance_unit} · ×140%`)
    await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => hitLine.test(text || ''),
      { timeout: 30000, label: 'static hit card lists the actual path distance and multiplier' })
    const readShot = () => page.evaluate(`(() => ({
      card: document.querySelector('#traj-info')?.textContent || '',
      distance: document.querySelector('[data-testid="hud-shot-distance"]')?.textContent || '',
      multiplier: document.querySelector('[data-testid="hud-shot-multiplier"]')?.textContent || '',
      centerDamage: document.querySelector('[data-testid="hud-damage"]')?.textContent || '',
      centerMultiplier: document.querySelector('[data-testid="hud-multiplier"]')?.textContent || '',
    }))()`)
    const shot = await readShot()
    const hitMatch = shot.card.match(new RegExp(`${labels.hit_distance}:\\s*([\\d.]+)`))
    assert.ok(Number(hitMatch?.[1]) > 0 && Number(hitMatch?.[1]) < 50, `actual hit is inside the 50m band (got ${hitMatch?.[1]})`)
    assert.equal(parseFloat(shot.distance), Number(hitMatch?.[1]), 'HUD shot readout shows the same path distance as the judgment card')
    assert.ok(/\b448\b/.test(shot.card), 'judgment damage uses the hit-distance multiplier (320 × 140% = 448)')
    assert.equal(shot.multiplier, '×140%', 'HUD shot readout matches the judgment multiplier')
    assert.equal(shot.centerDamage, '384 HP', 'HUD center estimate stays at 51m')
    assert.equal(shot.centerMultiplier, '×120%', 'HUD center multiplier stays at 51m')
    const canvasPoint = await page.evaluate(`(() => { const r = document.querySelector('#canvas-container canvas').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`)
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...canvasPoint, deltaX: 0, deltaY: -300 })
    await page.waitForValue('window.__armorRicochet.aimingState().cameraDistance', value => value < 50.5,
      { timeout: 5000, label: 'camera moves after the shot' })
    await page.waitForValue('window.__armorRicochet.aimingState().cameraSettledMs', value => value > 600,
      { timeout: 10000, label: 'camera settles after the shot' })
    const after = await readShot()
    assert.notEqual(after.centerDamage, shot.centerDamage, 'center estimate follows the camera')
    assert.equal(after.distance, shot.distance, 'camera movement does not rewrite the fixed shot distance')
    assert.equal(after.multiplier, shot.multiplier, 'camera movement does not rewrite the fixed shot multiplier')
    assert.equal(after.card, shot.card, 'camera movement does not rewrite the judgment card')
    await page.evaluate(`(() => {
      const select = document.querySelector('#shell-select');
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await page.waitForValue('document.querySelector("[data-testid=hud-shot]")', value => value === null,
      { timeout: 10000, label: 'stale shot HUD clears on shell change' })
    assert.equal(await page.evaluate('document.querySelector("#traj-info").getClientRects().length'), 0, 'shell change clears the result card with the shot HUD')
    assert.equal(await page.evaluate('!!document.querySelector("[data-testid=hud-multiplier]")'), false, 'shell change drops the obsolete assault-shell multiplier')
    response = ammo
    targetResponse = plainAmmo
    console.log('[shot-readiness] PASS: TrayShell launch-to-hit path stays fixed while the center estimate moves; shell change clears the stale shot HUD')
  }
  response = ammo
  targetResponse = plainAmmo

  await page.goto(`${origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    const { storeShotsForViewer } = await import('/src/scene/agentData.js');
    storeShotsForViewer([${JSON.stringify({ ...shot, shooter_tank_id: FIXTURE_TANK_ID })}]);
  })()`)
  await page.goto(plainUrl + '&shot=1&scfg=0&config=1&shell=0')
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'same-tank replay judgment' })
  await assertShellTable(1, [200, 300])
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1)
  assert.equal(await page.evaluate('document.querySelector("[data-testid=hud-distance]").disabled'), true, 'recorded distance is read-only')
  assert.equal(await page.evaluate(`document.querySelector('label[for="armor-distance"]').textContent.trim()`), labels.distance_recorded_short, 'recorded distance label names the recorded ballistic path')
  console.log('[shot-readiness] PASS: same-tank shot replay keeps shooter scfg and replay shell matching')
  {
    const missShot = {
      ...shot,
      target_eid: null, target_name: '',
      target_pos: [400, 1, 60], ball_a: [0, 1, 60], ball_b: [400, 1, 60],
      via: [[180, 25, 60]],
      launch_velocity: [1000, 0, 0],
      game_hit_result: 0, damage: 0, hit_flags: 0,
      terrain_impact: { impact_point: [400, 1, 60], terminal_dir: [1, 0, 0], material: 1 },
    }
    const loadShot = async (value, mode) => {
      await page.goto(`${origin}/?view=home&ws-auth=1`)
      await page.evaluate(`(async () => {
        const { storeShotsForViewer } = await import('/src/scene/agentData.js');
        storeShotsForViewer([${JSON.stringify(value)}]);
      })()`)
      await page.goto(plainUrl + '&shot=1&scfg=0&shell=0&config=0')
      if (mode === 'overview') {
        await page.waitFor(() => {
          const v = window.__armorRicochet?.info()?.view
          return v && v.worldOverview === true && Math.abs(v.fov - 50) < 0.01
            && window.__shotCtx?.shot?.target_eid == null
        }, { timeout: 30000, label: 'MISS world overview ready (50° FOV, shot loaded)' })
      } else {
        await page.waitForValue(`(() => {
          const v = window.__armorRicochet?.info()?.view
          return v && v.worldOverview === false && Math.abs(v.fov - ${ARMOR_DEFAULT_FOV}) < 0.01
            && Math.abs(v.cameraDistance - 15) < 0.2
            && window.__shotCtx?.shot?.target_eid != null
        })()`, value => value === true, { timeout: 30000, label: 'HIT default impact view ready (15m / 20.59° FOV, shot loaded)' })
      }
      return page.evaluate('window.__armorRicochet.info().view')
    }
    const missView = await loadShot(missShot, 'overview')
    assert.ok(Math.abs(missView.fov - 50) < 0.01, `MISS overview must keep native FOV (got ${missView.fov})`)
    console.log('[shot-readiness] PASS: miss world overview keeps native FOV (no dolly compensation)')
    const hitView = await loadShot(shot, 'impact')
    assert.ok(Math.abs(hitView.fov - ARMOR_DEFAULT_FOV) < 0.01, `HIT impact view must use display FOV (got ${hitView.fov})`)
    assert.ok(Math.abs(hitView.cameraDistance - 15) < 0.2, `HIT impact camera must be at 15m (got ${hitView.cameraDistance})`)
    console.log('[shot-readiness] PASS: HIT default impact view uses display 20.59° FOV at 15m')
    const clickViewToggle = async (selector) => {
      await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`,
        (v) => v === true, { timeout: 30000, label: `${selector} ready` })
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    }
    await clickViewToggle('#world-view-toggle')
    await page.waitFor(() => {
      const v = window.__armorRicochet?.info()?.view
      return v && v.worldOverview === true && Math.abs(v.fov - 50) < 0.01
    }, { timeout: 30000, label: 'HIT overview toggle ready (50° FOV)' })
    console.log('[shot-readiness] PASS: hit impact → overview keeps native 50° FOV')
    await clickViewToggle('#rel-view-toggle')
    await page.waitForValue(`(() => {
      const v = window.__armorRicochet?.info()?.view
      return v && v.worldOverview === false && Math.abs(v.fov - ${ARMOR_DEFAULT_FOV}) < 0.01
        && Math.abs(v.cameraDistance - 15) < 0.2
    })()`, value => value === true, { timeout: 30000, label: 'HIT impact toggle ready (15m / 20.59° FOV)' })
    console.log('[shot-readiness] PASS: hit overview → impact returns to display 15m / 20.59° FOV')
  }
  {
    const boxlessShot = { ...shot, hit_token: '3da6fd8a71d4', server_part_index: 1, armor_group: 1 }
    const boxlessTarget = structuredClone(FIXTURE_TANK_DATA)
    delete boxlessTarget.collision_boxes
    targetResponse = boxlessTarget
    await page.goto(`${origin}/?view=home&ws-auth=1`)
    await page.evaluate(`(async () => {
      const { storeShotsForViewer } = await import('/src/scene/agentData.js');
      storeShotsForViewer([${JSON.stringify(boxlessShot)}]);
    })()`)
    await page.goto(`${origin}/?view=agent-armor&ws-auth=1&tank=${FIXTURE_TANK_ID}&shooter=${shooterId}&heatmap=1&shot=1&shell=0&scfg=0&assets=${encodeURIComponent(assets.origin)}`)
    await page.waitForValue(`(() => {
      const e = document.querySelector('#shot-replay-error');
      return !!e && e.getClientRects().length > 0
        && getComputedStyle(e).display !== 'none'
        && e.textContent.includes('缺少客户端部件盒');
    })()`, value => value === true, { timeout: 30000, label: 'missing box visible error' })
    assert.equal(await page.evaluate('window.__segBoxMissing'), true, 'missing box state is explicit')
    assert.ok(page.consoleErrors.some(message => message.includes('缺少客户端部件盒')), 'missing box diagnosis is logged')
    assert.equal(await page.evaluate('window.__armorRicochet?.info().judgments || 0'), 0, 'missing box blocks world judgment')
    assert.equal(await page.evaluate('document.querySelector("#traj-info")?.textContent || ""'), '', 'missing box leaves no result card')
    targetResponse = null
    console.log('[shot-readiness] PASS: missing client box blocks world judgment instead of muzzle-chord fallback')
  }
  {
    const xi = structuredClone(FIXTURE_TANK_DATA)
    xi.tier = 11
    xi.configs = [{ ...xi.configs[0], ...xiSource.detail.configs[0],
      shells: xiSource.detail.configs[0].shells.map(shell => ({ ...xi.configs[0].shells[0], ...shell })),
    }]
    targetResponse = xi
    const waitXiReady = async () => page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]')
      && !document.querySelector('[data-testid="scene3d-error"]') && !!window.__armorRicochet?.info().grid,
    { timeout: 30000, label: 'XI fixture scene ready' })
    const findXiSpots = async () => {
      await page.waitFor(() => window.__armorRicochet.aimingState().cameraSettledMs > 400,
        { timeout: 20000, label: 'XI camera settled' })
      return page.evaluate(buildFindSpotsExpr({ need: ['gun', 'hull'], primarySections: [ArmorSection.HULL, ArmorSection.TURRET, ArmorSection.GUN] }))
    }
    const hullThickness = async () => {
      const spots = await findXiSpots()
      assert.ok(spots.hull && spots.gun, 'XI controlled model has hittable hull and gun')
      return page.evaluate(`window.__armorRicochet.__raytrace(${spots.hull.x}, ${spots.hull.y}).find(hit => hit.sec === 'hull').th`)
    }
    const clampPitch = async (down = false) => {
      const { gun } = await findXiSpots()
      assert.ok(gun, 'XI gun has a draggable pixel')
      const dy = down ? 260 : -260
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gun.x, y: gun.y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gun.x, y: gun.y, button: 'left', clickCount: 1 })
      for (let i = 1; i <= 3; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gun.x, y: gun.y + dy * i / 3, button: 'left' })
        await delay(30)
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gun.x, y: gun.y + dy, button: 'left', clickCount: 1 })
      return page.evaluate('window.__armorRicochet.aimingState().gunDeg')
    }
    const chooseXiUpgrade = async (side, mode) => {
      await page.evaluate(`document.querySelector('[data-testid="armor-tools"]').click()`)
      await page.waitFor(() => document.querySelectorAll('[data-testid="tank-upgrade-top"]').length === 2,
        { timeout: 20000, label: 'independent XI side controls ready' })
      await page.evaluate(`(() => {
        window.__xiPreviousCanvas = document.querySelector('#canvas-container canvas');
        const index = ${side === 'shooter' ? 0 : 1};
        const toggle = document.querySelector('[data-testid="armor-side-toggle-${side}"]');
        if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
        document.querySelectorAll('[data-testid="armor-side-config"]')[index].querySelector('[data-testid="tank-upgrade-${mode}"]').click();
      })()`)
      await page.waitFor(() => document.querySelector('#canvas-container canvas') !== window.__xiPreviousCanvas,
        { timeout: 20000, label: 'upgrade replaces the previous scene' })
      await waitXiReady()
    }
    await page.goto(plainUrl)
    await waitXiReady()
    assert.ok(Math.abs(await hullThickness() - 108) < 0.001, 'XI old link defaults to top armor')
    assert.equal(await clampPitch(), 20, 'XI default top upper pitch clamp')
    assert.equal(await clampPitch(true), -8, 'XI default top gun depression clamp')
    assert.ok((await page.evaluate('document.querySelector("[data-testid=hud-shell-0]").title')).endsWith('410'), 'XI default top uses max shooter ammunition')
    await chooseXiUpgrade('target', 'stock')
    assert.equal(await hullThickness(), 100, 'XI target stock restores initial armor')
    assert.equal(await clampPitch(), 15, 'XI target stock restores the initial pitch clamp')
    assert.equal(await clampPitch(true), -7, 'XI target stock restores the initial depression clamp')
    assert.ok((await page.evaluate('document.querySelector("[data-testid=hud-shell-0]").title')).endsWith('410'), 'target stock leaves same-tank shooter top ammunition')
    await chooseXiUpgrade('target', 'top')
    assert.ok(Math.abs(await hullThickness() - 108) < 0.001, 'XI target top armor includes both official armor bonuses')
    assert.equal(await clampPitch(), 20, 'XI target top pitch clamp includes the official +5 degrees')
    assert.equal(await clampPitch(true), -8, 'XI target top depression clamp includes the official +1 degree')
    await chooseXiUpgrade('target', 'stock')
    assert.equal(await hullThickness(), 100, 'target stock restores initial armor again')
    assert.equal(await clampPitch(), 15, 'target stock restores the initial pitch clamp again')
    assert.equal(await clampPitch(true), -7, 'target stock restores the initial depression clamp again')
    assert.ok((await page.evaluate('document.querySelector("[data-testid=hud-shell-0]").title')).endsWith('410'), 'target stock preserves shooter default-top ammunition')
    const xiQuery = await page.evaluate('Object.fromEntries(new URLSearchParams(location.search))')
    assert.equal(xiQuery.upgrade, 'stock')
    assert.equal(xiQuery.supgrade, undefined)
    targetResponse = null
    console.log('[shot-readiness] PASS: XI initial/max controls drive scene armor, real drag pitch limits and independent shooter ammunition (official progression, controlled model)')
  }
  assert.deepEqual(page.consoleErrors.filter(message => message.startsWith('uncaught:')), [])
  await Promise.all(operations)
} catch (error) {
  if (page) console.error(JSON.stringify({ errors: page.consoleErrors, state: await page.evaluate(`({load:document.querySelector('#loading')?.textContent, status:document.querySelector('.scene-status-overlay')?.textContent, controls:document.querySelector('#turret-controls')?.textContent, info:window.__armorRicochet?.info(), ctx:window.__shotCtx, world:window.__worldTickCtx})`) }))
  throw error
} finally {
  await browser?.close()
  await server.close()
  await assets.close()
}
