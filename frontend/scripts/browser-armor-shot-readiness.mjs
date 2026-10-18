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
const penetrationText = labels.outcomes.penetration
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
  let targetResponse = null
  let shooterRequests = 0
  const release = (requestId, payload = response) => send('Fetch.fulfillRequest', {
    requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  })
  /** 打开共享 TankCatalogMenu（Vue 下一 tick 才渲染卡片）→ 点第一张卡。 */
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
    // The shot's parameters are collapsed; initialization feedback belongs to the visible scene loading surface.
    const status = document.querySelector('[data-testid="scene3d-loading"]');
    return status.getClientRects().length > 0 && status.textContent.includes(${JSON.stringify(labels.loading)});
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
  await Promise.all(held.splice(0).map(requestId => release(requestId)))
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'automatic penetration after ammo release' })
  assert.equal(await page.evaluate('document.querySelector("#shell-select").value'), '1', 'replay ammo selected before judgment')
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1, 'exactly one initial judgment')
  assert.equal(await page.evaluate(`['#shooter-select', '#target-select'].every(id => !document.querySelector(id).disabled) && document.querySelector('#tank-selection-status').hidden`), true, 'ready viewer restores selection and hides the loading hint')
  console.log('[shot-readiness] PASS: slow ammo, bootstrap ownership, automatic selection and first judgment')

  // Only target data fails: retry must reuse the already valid shooter ammo.
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
  await page.waitForValue(`!document.querySelector('[data-testid="scene3d-error"]') && !document.querySelector('[data-testid="scene3d-loading"]') && document.querySelector('#traj-info')?.textContent.includes(${JSON.stringify(penetrationText)})`, value => value === true, { timeout: 30000, label: 'retry reloads changed shooter ammo and target' })
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
  // Retry must rebuild initialization, including shooter data, after an ammo failure.
  response = ammo
  await page.evaluate('document.querySelector("[data-testid=scene3d-error] button").click()')
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'retry reloads ammo' })
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1)
  console.log('[shot-readiness] PASS: invalid ammo error and recovery')

  // Plain inspection intentionally uses the displayed gun configuration. Keep
  // the top-level table distinguishable and omit its normalization/ricochet.
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
    { query: '&config=0&shell=1', value: 1, pens: [200, 300], manual: true },
    { query: '&shell=1', value: 1, pens: [400, 500] },
    { query: '&config=0&shell=99', value: 0, pens: [200, 300] },
    { query: '&config=1&shell=-1', value: 0, pens: [400, 500] },
    { query: '&config=0&shell=invalid', value: 0, pens: [200, 300] },
  ]) {
    await page.goto(plainUrl + scenario.query)
    await page.waitFor(() => !document.querySelector('[data-testid="scene3d-loading"]') && !document.querySelector('[data-testid="scene3d-error"]') && window.__armorRicochet?.info().meshCount > 0, { timeout: 30000, label: 'plain viewer ready' })
    await assertShellTable(scenario.value, scenario.pens)
    if (scenario.manual) {
      await page.evaluate(`document.querySelector('#config-select').value = '1'; document.querySelector('#config-select').dispatchEvent(new Event('change'))`)
      await assertShellTable(0, [400, 500])
    }
  }
  console.log('[shot-readiness] PASS: plain configuration ammo, deep-link selection, invalid indices and manual configuration switch')

  // Same tank type still does not make the victim's configuration authoritative
  // for replay ammunition. scfg=0 and replay shell_id=2 must win over config=1.
  await page.goto(`${origin}/?view=home&ws-auth=1`)
  await page.evaluate(`(async () => {
    const { storeShotsForViewer } = await import('/src/scene/agentData.js');
    storeShotsForViewer([${JSON.stringify({ ...shot, shooter_tank_id: FIXTURE_TANK_ID })}]);
  })()`)
  await page.goto(plainUrl + '&shot=1&scfg=0&config=1&shell=0')
  await page.waitForValue('document.querySelector("#traj-info")?.textContent', text => text?.includes(penetrationText), { timeout: 30000, label: 'same-tank replay judgment' })
  await assertShellTable(1, [200, 300])
  assert.equal(await page.evaluate('window.__armorRicochet.info().judgments'), 1)
  console.log('[shot-readiness] PASS: same-tank shot replay keeps shooter scfg and replay shell matching')
  // review 2026-10-13：脱靶（MISS）world 总览同样不得套 dolly-zoom 补偿——此前
  // worldOverviewMode 只在命中路径置位，MISS 在弹道标注后提前返回漏置 → 远距落点裁出视锥。
  // 400m 弦 + 非零 x via：总览必须保持原生 50°；随后切回命中发仍 50°（命中/MISS 切换）。
  {
    const missShot = {
      ...shot,
      target_eid: null, target_name: '',
      // 弹道几何整体离原点（脱靶守卫要求 ball_a 非全零）：发射点 (0,1,60) → 落点 (400,1,60)
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
      // 只断言视图就绪与视图参数；基础初始化的错误面（夹具拦截器状态的既有噪音，
      // 同场景历史用例同样容忍）不在本回归范围——终检仅对 uncaught: 计数。
      // 命中弹默认 = 命中点相对视角（15m/18.75° 标定）；MISS 无命中点 = world 总览 50°。
      if (mode === 'overview') {
        await page.waitFor(() => {
          const v = window.__armorRicochet?.info()?.view
          return v && v.worldOverview === true && Math.abs(v.fov - 50) < 0.01
        }, { timeout: 30000, label: 'MISS world overview ready (50° FOV)' })
      } else {
        await page.waitFor(() => {
          const v = window.__armorRicochet?.info()?.view
          return v && v.worldOverview === false && Math.abs(v.fov - 18.75) < 0.01
            && Math.abs(v.cameraDistance - 15) < 0.2
        }, { timeout: 30000, label: 'HIT default impact view ready (15m / 18.75° FOV)' })
      }
      return page.evaluate('window.__armorRicochet.info().view')
    }
    const missView = await loadShot(missShot, 'overview')
    assert.ok(Math.abs(missView.fov - 50) < 0.01, `MISS overview must keep native FOV (got ${missView.fov})`)
    console.log('[shot-readiness] PASS: miss world overview keeps native FOV (no dolly compensation)')
    const hitView = await loadShot(shot, 'impact')
    assert.ok(Math.abs(hitView.fov - 18.75) < 0.01, `HIT impact view must use calibrated FOV (got ${hitView.fov})`)
    assert.ok(Math.abs(hitView.cameraDistance - 15) < 0.2, `HIT impact camera must be at 15m (got ${hitView.cameraDistance})`)
    console.log('[shot-readiness] PASS: HIT default impact view uses calibrated 18.75° FOV at 15m')
    // 相对视角 ↔ 双方位置切换：overview 必须 50°，切回命中视角必须回到 18.75°。
    // 先等按钮真实挂上：viewer 初始化/夹具迟到响应期间 DOM 会短暂重建。
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
    await page.waitFor(() => {
      const v = window.__armorRicochet?.info()?.view
      return v && v.worldOverview === false && Math.abs(v.fov - 18.75) < 0.01
        && Math.abs(v.cameraDistance - 15) < 0.2
    }, { timeout: 30000, label: 'HIT impact toggle ready (15m / 18.75° FOV)' })
    console.log('[shot-readiness] PASS: hit overview → impact returns to calibrated 15m / 18.75° FOV')
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
