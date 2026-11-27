import { measureOcclusion, measurePaintOrder, measureReachability } from './browser-occlusion.mjs'
import { join, resolve } from 'node:path'
import { closePageTarget, captureMobileReview, Page, check, clickElement, clicked, confirmCollectionRemove, dragPointer, enterReplay3d, fakeAnalysisOrigin, openCollectionRemove, results, sceneHitTarget, setLastPage } from './browser-workspace-interaction-core.mjs'
import { check3DDrawingSurface, checkPhoneSafeArea, displayPanelProbe, rosterGeometryProbe, sceneDistanceProbe, sceneDistanceViolations, waitForStableLayout, workspaceColumnsProbe } from './browser-workspace-interaction-probes-a.mjs'

export async function runRosterGeometryScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  setLastPage(page)
  await page.enable({ locale: scenario.locale ?? 'zh', profile: scenario.profile ?? 'summer' })
  await page.emulate(scenario)

  await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&ws-manual-3d=1&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="replay"]'), { label: 'capability tabs' })

  await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="select-files-input"]')
    if (!input) throw new Error('file input missing')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'roster-geometry.wotbreplay'))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)

  await enterReplay3d(page, scenario)
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  const startCenter = await page.evaluate(`(() => {
    const button = document.querySelector('[data-test="replay3d-start"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === button || button.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`)
  check(failures, !!startCenter, 'pre-start start button not hit-testable')
  if (!startCenter) {
    await closePageTarget(env.chrome, targetId)
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
    return
  }
  await page.tap({ ...startCenter, touch: scenario.touch })
  await page.waitForValue(
    'window.__pbPane && (window.__pbPane.store.err.length > 0 || window.__pbPane.store.hasData === true)',
    (v) => v === true,
    { timeout: 30_000, label: 'garbage replay parse rejection' },
  )

  await page.evaluate(`(() => {
    const s = window.__pbPane.store
    // 名册行的形状 = 身份（eid/team/nick/tank）+ 当前回放时刻的状态投影（hp/maxHp/dead）
    const mk = (prefix, n, team) => Array.from({ length: n }, (_, i) => ({
      eid: (team === 1 ? 0 : team === 2 ? 100 : 200) + i + 1, team,
      nick: prefix + '_' + String(i + 1).padStart(2, '0'),
      tank: i % 3 === 0 ? 'Kranvagn' : (i % 3 === 1 ? 'SPHT' : 'Chieftain Mk.6'),
      hp: i === 0 ? 0 : 1950 - i * 137,
      maxHp: 1950,
      dead: i === 0, followed: team === 1 && i === 1,
      reload: i === 0 ? null : [{ state: 'full' }, { state: 'loading', progress: 0.5 }],
    }))
    s.friendlyTeam = ${scenario.recorder || 1}
    s.hasData = true
    s.loading = false
    s.assetStage = false
    s.err = ''
    s.timer = '05:12'
    s.duration = 300
    s.time = 42
    s.startTime = 0
    s.cam = ${JSON.stringify(scenario.camera ?? 'free')}
    s.roster = {
      team1: mk('Ally', ${scenario.players}, 1),
      team2: mk('Enemy', ${scenario.players}, 2),
      unknown: mk('Neutral', ${scenario.unknown ?? 2}, null),
    }
    s.killfeed = Array.from({ length: ${scenario.killfeed} }, (_, i) => ({
      id: i + 1, killer: 'Killer_' + i, victim: 'Victim_' + i, kill: true,
    }))
  })()`)
  await waitForStableLayout(page)
  let sceneHit = await sceneHitTarget(page)

  if (scenario.rotateTo) {
    await page.emulate({ ...scenario, ...scenario.rotateTo })
    await page.waitFor(() => document.querySelector('.pb-root')?.classList.contains('roster-side'),
      { label: 'rotated 3D pane switches to Team 1 | Stage | Team 2' })
    await waitForStableLayout(page)
    sceneHit = await sceneHitTarget(page)
  }
  const viewport = scenario.rotateTo || scenario
  const sceneBefore = await page.evaluate('(window.__sceneMarker = window.__pbPane.sceneApi, true)')
  if (scenario.fullscreen) {
    const fsButton = await page.evaluate(`(() => {
      const el = document.querySelector('[data-test="pb-fullscreen"]')
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    check(failures, !!fsButton, '3D fullscreen control missing')
    if (fsButton) {
      await page.tap({ ...fsButton, touch: scenario.touch })
      await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: '3D document.fullscreenElement' })
      await waitForStableLayout(page)
    }
  }

  const toolbarSelector = '[data-testid="replay3d-controls-toggle"]'
  const controlsFootprint = "(() => { const r = document.querySelector('.controls').getBoundingClientRect(); return r.width * r.height })()"
  const expandedFootprint = await page.evaluate(controlsFootprint)
  const sessionBeforeCollapse = await page.evaluate('JSON.stringify({ time: window.__pbPane.store.time, speed: window.__pbPane.store.speed, cam: window.__pbPane.store.cam, playing: window.__pbPane.store.playing })')
  for (const collapsed of [true, false]) {
    await page.evaluate(`document.querySelector(${JSON.stringify(toolbarSelector)}).scrollIntoView({ block: 'center' })`)
    await waitForStableLayout(page)
    const hit = await page.evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(toolbarSelector)})
      const r = button.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      return { x, y, reachable: button.contains(document.elementFromPoint(x, y)), width: r.width, height: r.height }
    })()`)
    check(failures, hit.reachable && hit.width >= sceneHit - 0.5 && hit.height >= sceneHit - 0.5,
      `toolbar disclosure must be hit-testable with a ${sceneHit}px target`)
    await page.tap({ x: hit.x, y: hit.y, touch: scenario.touch })
    await page.waitForValue(`document.querySelector(${JSON.stringify(toolbarSelector)})?.getAttribute('aria-expanded')`,
      value => value === String(!collapsed), { label: 'toolbar disclosure changes after raw input' })
    await page.waitForValue("!document.querySelector('.controls-slide-enter-active, .controls-slide-leave-active')",
      value => value === true, { label: 'toolbar slide animation finished' })
    await waitForStableLayout(page)
    const footprint = await page.evaluate(controlsFootprint)
    check(failures, collapsed ? footprint < expandedFootprint / 2 : Math.abs(footprint - expandedFootprint) < expandedFootprint * 0.02,
      `toolbar must shrink and restore its footprint: expanded=${expandedFootprint}, actual=${footprint}`)
    check(failures, await page.evaluate("getComputedStyle(document.querySelector('.controls-content')).display === 'none'") === collapsed,
      'collapsed content must leave layout and keyboard navigation')
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi'), 'toolbar disclosure rebuilt the scene')
    check(failures, await page.evaluate('JSON.stringify({ time: window.__pbPane.store.time, speed: window.__pbPane.store.speed, cam: window.__pbPane.store.cam, playing: window.__pbPane.store.playing })') === sessionBeforeCollapse,
      'toolbar disclosure changed playback or camera state')
  }

  await captureMobileReview(page, scenario)
  await page.evaluate('window.scrollTo(0, 0)')
  await waitForStableLayout(page)
  const geometry = await page.probe(rosterGeometryProbe)
  if (scenario.name.includes('distance-')) {
    if (!scenario.fullscreen) {
      await page.evaluate("document.querySelector('.pb-root').scrollIntoView({ block: 'start' })");
      await waitForStableLayout(page)
    }
    const checkDistance = async (state = '') => {
      const measured = await page.probe(sceneDistanceProbe)
      console.log(`[browser-interaction] ${scenario.name}${state} distance ${JSON.stringify(measured)}`)
      for (const error of sceneDistanceViolations(measured, scenario, viewport)) {
        check(failures, false, `${scenario.name}${state} distance slider: ${error}`)
      }
      return measured
    }
    const dist = await checkDistance()

    const dragStart = await page.evaluate(`(() => {
      const el = document.querySelector('[data-testid="scene-distance-slider"]')
      const track = el && el.querySelector('.scene-dist-track')
      if (!el || !track) return null
      const r = track.getBoundingClientRect()
      return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, value: Number(el.getAttribute('aria-valuenow')) }
    })()`)
    if (!dragStart) {
      check(failures, false, `${scenario.name} distance slider: drag track missing`)
    } else {
      await dragPointer(page, { x: dragStart.x, y: dragStart.top + 6 }, { x: dragStart.x, y: dragStart.bottom - 6 }, { touch: scenario.touch })
      const farValue = await page.evaluate("Number(document.querySelector('[data-testid=\"scene-distance-slider\"]').getAttribute('aria-valuenow'))")
      await dragPointer(page, { x: dragStart.x, y: dragStart.bottom - 6 }, { x: dragStart.x, y: dragStart.top + 6 }, { touch: scenario.touch })
      const nearValue = await page.evaluate("Number(document.querySelector('[data-testid=\"scene-distance-slider\"]').getAttribute('aria-valuenow'))")
      check(failures, Number.isFinite(farValue) && farValue < dragStart.value - 10,
        `${scenario.name} distance slider: downward drag must move toward far (before=${dragStart.value}, after=${farValue})`)
      check(failures, Number.isFinite(nearValue) && nearValue > farValue + 10,
        `${scenario.name} distance slider: upward drag must move toward near (far=${farValue}, near=${nearValue})`)
    }

    await page.evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'distance-occlusion-negative-control'
      style.textContent = '.pb-root.playback-workspace .scene-dist { top: 120px !important; bottom: auto !important; right: var(--space-2) !important; left: auto !important; }'
      document.head.append(style)
    })()`)
    await waitForStableLayout(page)
    const mutant = await page.probe(sceneDistanceProbe)
    check(failures, mutant.rowOverlap.length > 0 && mutant.hpOverlap.length > 0,
      `${scenario.name} distance slider negative control: intentional overlay must hit roster rows and HP bars, got rows=${JSON.stringify(mutant.rowOverlap)} hp=${JSON.stringify(mutant.hpOverlap)}`)
    await page.evaluate("document.getElementById('distance-occlusion-negative-control')?.remove()")
    await waitForStableLayout(page)

    if (scenario.toggleFullscreen) {
      const fsButton = await page.evaluate(`(() => {
        const el = document.querySelector('[data-test="pb-fullscreen"]')
        if (!el) return null
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      })()`)
      check(failures, !!fsButton, `${scenario.name} distance slider: fullscreen entry missing`)
      if (fsButton) {
        await page.tap({ ...fsButton, touch: scenario.touch })
        await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'distance fullscreen on' })
        await waitForStableLayout(page)
        await checkDistance(' fullscreen')

        const exitCenter = await page.evaluate(`(() => {
          const el = document.querySelector('[data-test="pb-fullscreen"]')
          const r = el.getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })()`)
        await page.tap({ ...exitCenter, touch: scenario.touch })
        await page.waitFor(() => !document.fullscreenElement, { timeout: 5000, label: 'distance fullscreen off' })
        await page.evaluate("document.querySelector('.pb-root').scrollIntoView({ block: 'start' })")
        await waitForStableLayout(page)
        await checkDistance(' restored')
      }
    }
  }
  if (scenario.touch && scenario.layout !== 'portrait') {
    await checkPhoneSafeArea(page, failures, scenario.name + ' landscape')
  }
  if (scenario.layout !== 'portrait' && scenario.name.endsWith('-fullscreen-coarse')) {
    const slider = await page.probe(() => {
      const el = document.querySelector('[data-testid="scene-distance-slider"]')
      const fs = document.querySelector('[data-test="pb-fullscreen"]')
      if (!el || !fs) return null
      const r = el.getBoundingClientRect(), track = el.querySelector('.scene-dist-track').getBoundingClientRect(), f = fs.getBoundingClientRect()
      const hit = (x) => { const target = document.elementFromPoint(x, track.top + track.height / 2); return target === el || el.contains(target) }
      return { width: r.width, centerError: Math.abs((r.left + r.right - track.left - track.right) / 2),
        overlap: r.left < f.right && f.left < r.right && r.top < f.bottom && f.top < r.bottom,
        leftHit: hit(r.left + 2), rightHit: hit(r.right - 2) }
    })
    check(failures, slider && slider.width >= sceneHit - 0.5 && slider.centerError <= 1 && !slider.overlap && slider.leftHit && slider.rightHit,
      `3D replay distance slider hit geometry (${sceneHit}px): ${JSON.stringify(slider)}`)
  }

  await page.evaluate(`document.querySelector('.pb-root .scene').scrollIntoView({ block: 'center' })`)
  await waitForStableLayout(page)
  const compactBar = await page.evaluate(`document.querySelector('.pb-root').classList.contains('compact-bar')`)
  const EDGE_DOCKED = ['.team-lane', '.killfeed', '.scene-dist']
  const SCENE_OCCLUSION = { primary: '.pb-root .scene', persistent: ['.pb-root .hud', '.pb-root .killfeed'], overlayHud: true, edgeDocked: compactBar ? EDGE_DOCKED : [] }
  await page.evaluate(`(() => {
    window.__sceneKillfeed = window.__pbPane.store.killfeed
    window.__pbPane.store.killfeed = [1, 2, 3].map((id) => ({ id, killer: 'Killer_' + id, victim: 'Victim_' + id, kill: true }))
    document.querySelector('[data-testid="display-toggle"]').click()
  })()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="disp-killfeed"]'), { label: 'display panel for kill feed' })
  await page.evaluate(`(() => {
    const toggle = document.querySelector('[data-testid="disp-killfeed"]')
    if (!toggle.checked) toggle.click()
    document.querySelector('[data-testid="display-close"]').click()
  })()`)
  await page.waitFor(() => !!document.querySelector('.killfeed .kf') && !document.querySelector('[data-testid="display-panel"]'), { label: 'kill feed visible, display closed' })
  await waitForStableLayout(page)
  const sceneOcclusion = await measureOcclusion(page, SCENE_OCCLUSION)
  console.log(`[browser-interaction] ${scenario.name} scene ${JSON.stringify(sceneOcclusion.items?.map((i) => [i.label, i.pct, i.centralPct]))}`)
  for (const failure of sceneOcclusion.failures) check(failures, false, `3D 场景遮挡: ${failure}`)
  if (scenario.layout !== 'portrait') {
    check(failures, sceneOcclusion.items?.length > 0, '3D 遮挡判定空跑：网格没有发现任何 HUD 面')
    check(failures, sceneOcclusion.items?.some((item) => item.label === '[replay3d-killfeed]'), '3D 遮挡判定空跑：没有量到击杀流')
  }
  const killfeedRows = await page.evaluate(`(() => {
    const box = document.querySelector('.pb-root .killfeed').getBoundingClientRect()
    const rows = [...document.querySelectorAll('.pb-root .killfeed .kf')]
    return {
      texts: rows.map((row) => row.textContent),
      complete: rows.every((row) => {
        const r = row.getBoundingClientRect()
        return row.scrollHeight <= row.clientHeight + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1
      }),
    }
  })()`)
  console.log(`[browser-interaction] ${scenario.name} killfeed rows=${killfeedRows.texts.length}`)
  check(failures, killfeedRows.complete, `击杀流每一行都必须完整: ${JSON.stringify(killfeedRows)}`)
  check(failures, killfeedRows.texts.at(-1)?.includes('Victim_3'), `击杀流必须保留最新一条: ${JSON.stringify(killfeedRows)}`)
  if (scenario.killfeedRows) {
    check(failures, killfeedRows.texts.length === scenario.killfeedRows, `击杀流行数预算应为 ${scenario.killfeedRows}: ${JSON.stringify(killfeedRows)}`)
  }
  if (scenario.killfeedAdaptive) {
    await page.evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'killfeed-budget-control'
      style.textContent = '.pb-root.playback-workspace > .hud::after { content: ""; display: block; block-size: 44px }'
      document.head.append(style)
    })()`)
    await page.waitForValue(`document.querySelectorAll('.pb-root .killfeed .kf').length`, (rows) => rows === 1, { label: 'kill feed budget drops to one row' })
    const single = await page.evaluate(`document.querySelector('.pb-root .killfeed .kf').textContent`)
    check(failures, single.includes('Victim_3'), `1 行预算必须保留最新一条: ${single}`)
    await page.evaluate(`document.getElementById('killfeed-budget-control')?.remove()`)
    await page.waitForValue(`document.querySelectorAll('.pb-root .killfeed .kf').length`, (rows) => rows === scenario.killfeedRows, { label: 'kill feed budget restored' })
  }
  await page.evaluate(`(() => {
    const mutant = document.createElement('button')
    mutant.className = 'mutant-toolbar'
    const r = document.querySelector('.pb-root .scene').getBoundingClientRect()
    mutant.style.cssText = 'position:fixed;z-index:9;width:44px;height:44px;left:' + (r.left + r.width / 2 + 3) + 'px;top:' + (r.top + r.height / 2 + 3) + 'px'
    document.querySelector('.pb-root').append(mutant)
  })()`)
  const mutantOcclusion = await measureOcclusion(page, SCENE_OCCLUSION)
  await page.evaluate(`document.querySelector('.mutant-toolbar')?.remove()`)
  check(failures, mutantOcclusion.failures.some((failure) => failure.includes('mutant-toolbar')),
    `负向对照必须失败：清单外的 44px 控件压进中心却没被发现 ${JSON.stringify(mutantOcclusion.failures)}`)
  await page.evaluate(`(() => {
    const style = document.createElement('style')
    style.id = 'occlusion-negative-control'
    style.textContent = '.pb-root.playback-workspace > .hud { top: 40% !important; inset-block-start: 40% !important }'
    document.head.append(style)
  })()`)
  await waitForStableLayout(page)
  const hudMutant = await measureOcclusion(page, SCENE_OCCLUSION)
  await page.evaluate(`document.getElementById('occlusion-negative-control')?.remove()`)
  if (scenario.layout !== 'portrait') {
    check(failures, hudMutant.failures.some((failure) => failure.includes('.hud') || failure.includes('hud')),
      `负向对照必须失败：pointer-events: none 的 HUD 压进中心却没被发现 ${JSON.stringify(hudMutant.failures)}`)
  }
  const occlusionWithCss = async (css, options = SCENE_OCCLUSION) => {
    await page.evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'occlusion-negative-control'
      style.textContent = ${JSON.stringify(css)}
      document.head.append(style)
    })()`)
    await waitForStableLayout(page)
    const measured = await measureOcclusion(page, options)
    await page.evaluate(`document.getElementById('occlusion-negative-control')?.remove()`)
    return measured
  }
  if (compactBar) {
    const legal = sceneOcclusion.items.filter((item) => item.edgeDocked && item.centralPct > 0)
    console.log(`[browser-interaction] ${scenario.name} compact edge-docked ${JSON.stringify(legal.map((i) => [i.label, i.centralPct]))}`)
    const barMutant = await occlusionWithCss('.pb-root.playback-workspace > .controls { position: absolute !important; inset-block-start: 40% !important; inset-inline: 0 !important }')
    check(failures, barMutant.failures.some((failure) => failure.includes('div.controls')),
      `负向对照必须失败：控制条不享受贴边例外，上移压入中心却没被判 ${JSON.stringify(barMutant.failures)}`)
    const laneMutant = await occlusionWithCss('.pb-root.playback-workspace .team-lane.side-left { inline-size: 45% !important }')
    check(failures, laneMutant.failures.some((failure) => failure.includes('replay3d-lane-left')),
      `负向对照必须失败：车道超过贴边上限却没被判 ${JSON.stringify(laneMutant.failures)}`)
    const killfeedMutant = await occlusionWithCss('.pb-root .killfeed { inset-inline: -100% auto !important; inline-size: 60vw !important; max-width: none !important; block-size: 40vh !important; max-block-size: none !important }')
    check(failures, killfeedMutant.failures.some((failure) => failure.includes('replay3d-killfeed')),
      `负向对照必须失败：击杀流超过贴边上限却没被判 ${JSON.stringify(killfeedMutant.items)}`)
  } else if (scenario.layout !== 'portrait') {
    const LANE_MUTANT = '.pb-root.playback-workspace .team-lane.side-left { inset-inline-start: 22% !important; inset-block-start: 7% !important; max-block-size: 200px !important }'
    const strict = await occlusionWithCss(LANE_MUTANT)
    const lenient = await occlusionWithCss(LANE_MUTANT, { ...SCENE_OCCLUSION, edgeDocked: EDGE_DOCKED })
    const intrusion = strict.items?.find((item) => item.label === '[replay3d-lane-left]')?.centralPct
    console.log(`[browser-interaction] ${scenario.name} wide lane mutant central=${intrusion}%`)
    check(failures, strict.failures.some((failure) => failure.includes('replay3d-lane-left')),
      `负向对照必须失败：宽形态车道压入中心却没被判 ${JSON.stringify(strict.failures)}`)
    check(failures, !lenient.failures.some((failure) => failure.includes('replay3d-lane-left')),
      `对照失效：这个侵入量应落在 15% 以内，否则证明不了例外的作用域 ${JSON.stringify(lenient.failures)}`)
  }
  await page.evaluate('window.__pbPane.store.killfeed = window.__sceneKillfeed')
  await page.evaluate('window.scrollTo(0, 0)')
  await waitForStableLayout(page)
  check(failures, geometry.root, 'pb-root missing')
  check(failures, geometry.viewport.width === viewport.width && geometry.viewport.height === viewport.height,
    `viewport collapsed: requested ${viewport.width}x${viewport.height}, measured ${JSON.stringify(geometry.viewport)}`)
  check(failures, geometry.errors.length === 0, `geometry violations: ${geometry.errors.join('; ')}`)
  check(failures, geometry.hpCells >= 2, 'roster HP cells missing in real browser')
  const expectedRows = scenario.players * 2 + (scenario.unknown ?? 2)
  check(failures, geometry.rows === expectedRows, `roster hides players: ${geometry.rows} rows, expected ${expectedRows}`)
  check(failures, geometry.rowsComplete, 'roster rows must show player / tank / HP bar with in-bar text')
  check(failures, geometry.hpBar, 'roster rows must render an HP bar')
  check(failures, geometry.laneIds[0].every((nick) => nick.startsWith(scenario.recorder === 2 ? 'Enemy' : 'Ally') || nick.startsWith('Neutral'))
    && geometry.laneIds[1].every((nick) => nick.startsWith(scenario.recorder === 2 ? 'Ally' : 'Enemy')),
    `lanes must follow Recorder perspective (friendly left / enemy right): ${JSON.stringify(geometry.laneIds)}`)
  if (scenario.layout === 'portrait') {
    check(failures, geometry.portrait && !geometry.side, `portrait must be the vertical flow (class portrait-flow): ${JSON.stringify(geometry)}`)
    const order = await page.evaluate(`(() => {
      const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null
      return { stage: top('.stage-square'), controls: top('.controls'), left: top('.side-left'), right: top('.side-right') }
    })()`)
    check(failures, order.stage < order.controls && order.controls < order.left && order.left < order.right,
      `portrait order must be Stage → Transport → Team 1 → Team 2: ${JSON.stringify(order)}`)
  } else {
    check(failures, geometry.side && !geometry.portrait, `expected Team 1 | Stage | Team 2 (class roster-side): portrait=${geometry.portrait} side=${geometry.side}`)
  }

  await check3DDrawingSurface(page, failures, scenario, viewport, sceneHit)

  const LEGACY_GRID_CONTRACT = false
  if (geometry.side && LEGACY_GRID_CONTRACT) {
    const columns = await page.probe(workspaceColumnsProbe)
    const rosterMinPx = 9 * (await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize) || 16'))
    check(failures, columns.root, 'workspace columns: pb-root missing')
    check(failures, Math.abs(columns.left.w - columns.right.w) <= 0.5,
      `both lanes must share one width: ${JSON.stringify({ left: columns.left.w, right: columns.right.w })}`)
    const expectedCenter = columns.contentW - 2 * columns.laneW - 2 * (columns.laneGutter ?? 0)
    check(failures, Math.abs(columns.centerW - expectedCenter) <= 1.5,
      `center column must consume all remaining width (expected ${expectedCenter}): ${JSON.stringify({ centerW: columns.centerW, laneW: columns.laneW, contentW: columns.contentW, gutter: columns.laneGutter })}`)
    if (scenario.width >= 1200) check(failures, Math.abs(columns.centerW - columns.laneW * 2) <= 2,
      `desktop center must be twice the roster lane width: center=${columns.centerW} square=${geometry.square.w}`)
    check(failures, columns.laneW >= rosterMinPx - 0.5,
      `roster lane must keep its readable floor: ${JSON.stringify({ laneW: columns.laneW, minLane: rosterMinPx })}`)
    check(failures, columns.hud && Math.abs(columns.hud.w - columns.centerW) <= 1,
      `HUD must span the whole center column: ${JSON.stringify({ hudW: columns.hud?.w, centerW: columns.centerW })}`)
    check(failures, columns.square && columns.square.w <= columns.centerW + 0.5,
      `Stage must fit inside the center column: ${JSON.stringify({ stage: columns.square?.w, centerW: columns.centerW })}`)
    check(failures, columns.square && Math.abs(columns.square.w - columns.centerW) <= 1,
      `Stage must fill the center width: ${JSON.stringify({ w: columns.square?.w, h: columns.square?.h })}`)
    check(failures, columns.rootBox.left >= -0.5 && columns.rootBox.right <= viewport.width + 0.5,
      `workspace must not overflow horizontally: ${JSON.stringify({ root: columns.rootBox, viewport: viewport.width })}`)
    const hudCenter = columns.hud.left + columns.hud.w / 2
    const rootCenter = columns.rootBox.left + columns.rootBox.w / 2
    check(failures, Math.abs(hudCenter - rootCenter) <= 1,
      `center column must stay centered between the lanes: ${JSON.stringify({ hudCenter, rootCenter })}`)

    await page.evaluate(`document.querySelector('[data-testid="display-toggle"]')?.click()`)
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'),
      { label: 'display panel for roster toggle' })
    const rosterToggle = await clickElement(page, '[data-testid="disp-roster"]')
    check(failures, clicked(rosterToggle), `roster toggle not clickable: ${rosterToggle}`)
    if (clicked(rosterToggle)) {
      await page.waitFor(() => !document.querySelector('.pb-root')?.classList.contains('roster-side'),
        { label: 'roster lanes removed' })
      await waitForStableLayout(page)
      const off = await page.probe(workspaceColumnsProbe)
      check(failures, off.laneCount === 0 && !off.left && !off.right,
        `roster off must remove both lanes entirely: ${JSON.stringify({ laneCount: off.laneCount, left: off.left, right: off.right })}`)
      check(failures, off.square && off.square.w >= columns.square.w - 1,
        `roster off must not shrink the Stage: on=${columns.square?.w} off=${off.square?.w}`)
      check(failures, off.square && off.square.w <= off.rootW + 0.5,
        `roster off Stage must stay inside the workspace: ${JSON.stringify({ stage: off.square?.w, rootW: off.rootW })}`)
      if (columns.centerW < columns.square.h - 1) {
        check(failures, off.square.w > columns.square.w,
          `roster off must enlarge a width-bound Stage: on=${columns.square?.w} off=${off.square?.w}`)
      }
      check(failures, off.square && Math.abs((off.square.left + off.square.w / 2) - (off.rootBox.left + off.rootBox.w / 2)) <= 1.5,
        `roster off must keep the Stage centered: ${JSON.stringify({ square: off.square, root: off.rootBox })}`)
      const restoreToggle = await clickElement(page, '[data-testid="disp-roster"]')
      check(failures, clicked(restoreToggle), `roster toggle restore not clickable: ${restoreToggle}`)
      await page.waitFor(() => document.querySelector('.pb-root')?.classList.contains('roster-side'),
        { label: 'roster lanes restored' })
      await waitForStableLayout(page)
      const restored = await page.probe(workspaceColumnsProbe)
      check(failures, Math.abs(restored.laneW - columns.laneW) <= 1 && Math.abs(restored.centerW - columns.centerW) <= 1,
        `restoring the roster must return the same column geometry: ${JSON.stringify({ before: columns.laneW, after: restored.laneW })}`)
    }
    await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
    await page.waitFor(() => !document.querySelector('[data-testid="display-panel"]:not([hidden])'),
      { label: 'display panel closed after roster check' })
  }
  if (scenario.fullscreen) {
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi'), 'entering fullscreen must not recreate the 3D scene')
    if (scenario.touch && scenario.layout !== 'portrait') {
      await checkPhoneSafeArea(page, failures, scenario.name + ' fullscreen')
    }
  }

  const timeBeforeFollow = await page.evaluate('window.__pbPane.store.time')
  await page.evaluate(`document.querySelector('.team1 .pl:nth-child(2)')?.scrollIntoView({ block: 'center' })`)
  const row2Id = await page.evaluate(`(() => { const r = document.querySelector('.team1 .pl:nth-child(2)'); return Number(r?.dataset.accountId) })()`)
  const rowClick = await clickElement(page, '.team1 .pl:nth-child(2)')
  check(failures, clicked(rowClick), `roster row not selectable: ${rowClick}`)
  await page.waitForValue(
    `JSON.stringify({ cam: window.__pbPane.store.cam, sel: window.__pbPane.selectedEid })`,
    (s) => { const o = JSON.parse(s); return o.cam === 'follow' && o.sel === row2Id },
    { label: 'roster click follows the row', timeout: 8000 },
  )
  check(failures, await page.evaluate('window.__pbPane.selectedEid') === row2Id, `roster click must select the clicked row: expected ${row2Id}`)
  check(failures, await page.evaluate('window.__pbPane.store.time') === timeBeforeFollow, 'entering follow must not alter playback time')
  check(failures, await page.evaluate(`!!document.querySelector('.team1 .pl:nth-child(2).selected')`), 'clicked row must carry .selected')
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-info"]')`), 'roster click must not open details (follow only)')

  await page.evaluate(`document.querySelector('.team2 .pl:nth-child(3)')?.scrollIntoView({ block: 'center' })`)
  const row3Id = await page.evaluate(`(() => { const r = document.querySelector('.team2 .pl:nth-child(3)'); return Number(r?.dataset.accountId) })()`)
  const team2Click = await clickElement(page, '.team2 .pl:nth-child(3)')
  check(failures, clicked(team2Click), `Team 2 row not clickable: ${team2Click}`)
  await page.waitFor(() => window.__pbPane.store.cam === 'follow', { label: 'Team 2 click switches follow' })
  check(failures, await page.evaluate('window.__pbPane.selectedEid') === row3Id, `Team 2 click must select the clicked row: expected ${row3Id}`)
  check(failures, await page.evaluate('window.__pbPane.store.cam') === 'follow', 'follow switch keeps cam=follow')
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-info"]')`), 'follow switch must not open details')

  if (scenario.fullscreen) {
    await page.evaluate('document.exitFullscreen()')
    await page.waitFor(() => !document.fullscreenElement, { label: 'exit fullscreen' })
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi'), 'exiting fullscreen must keep the 3D scene')
    check(failures, await page.evaluate('window.__pbPane.selectedEid') === row3Id, 'exiting fullscreen must keep the selection')
  }


  const speedToggle = await clickElement(page, '[data-test="pb-speed-current"]')
  check(failures, clicked(speedToggle), `speed picker not clickable: ${speedToggle}`)
  if (clicked(speedToggle)) {
    await page.waitFor(() => !!document.querySelector('[data-test="pb-speed-menu"]'), { label: 'speed menu opens' })
    const speedReach = await measureReachability(page, {
      options: ['[data-test="pb-speed-menu"] button'], touch: scenario.touch, minTouchTargetPx: sceneHit,
    })
    for (const failure of speedReach.failures) check(failures, false, `3D 倍速菜单可达: ${failure}`)
    await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]').click()`)
    await page.waitFor(() => !document.querySelector('[data-test="pb-speed-menu"]'), { label: 'speed menu closes' })
  }

  await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (panel && !panel.hidden) document.querySelector('[data-testid="display-toggle"]')?.click()
  })()`)
  await page.waitFor(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    return !panel || panel.hidden
  }, { label: 'display panel closed before probe' })
  const displayToggle = await clickElement(page, '[data-testid="display-toggle"]')
  check(failures, clicked(displayToggle), `display toggle not clickable: ${displayToggle}`)
  if (clicked(displayToggle)) {
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'display panel opens' })
    await captureMobileReview(page, scenario, 'display')
    const panel = await page.probe(displayPanelProbe)
    check(failures, panel.errors.length === 0, `display panel violations: ${panel.errors.join('; ')}`)

    const pageScroll = await page.evaluate('window.scrollY')
    const displayOptions = await page.evaluate(`document.querySelectorAll('[data-testid="display-panel"] button, [data-testid="display-panel"] label').length`)
    check(failures, displayOptions > 0, '3D Display 可达性判定空跑：面板里没有选项')
    for (let i = 0; i < displayOptions; i += 1) {
      await page.evaluate(`(() => {
        document.querySelector('[data-occlusion-control]')?.removeAttribute('data-occlusion-control')
        const option = document.querySelectorAll('[data-testid="display-panel"] button, [data-testid="display-panel"] label')[${i}]
        option.dataset.occlusionControl = 'current'
        // 浮层形态只滚面板自身：连带滚页面会让 Display 重新定位，量到的就不是这次滚动的结果
        const panel = option.closest('[data-testid="display-panel"]')
        if (getComputedStyle(panel).position === 'absolute') {
          panel.scrollTop += option.getBoundingClientRect().top - panel.getBoundingClientRect().top - (panel.clientHeight - option.offsetHeight) / 2
        } else {
          option.scrollIntoView({ block: 'center', inline: 'nearest' })
        }
      })()`)
      const reach = await measureReachability(page, {
        options: ['[data-occlusion-control=current]'], touch: scenario.touch, minTouchTargetPx: sceneHit,
      })
      for (const failure of reach.failures) check(failures, false, `3D Display 可达: ${failure}`)
      check(failures, reach.sampled > 0, `3D Display 第 ${i} 项没有做到命中采样: ${JSON.stringify(reach.results)}`)
    }
    await page.evaluate(`(() => {
      document.querySelector('[data-occlusion-control]')?.removeAttribute('data-occlusion-control')
      document.querySelector('[data-testid="display-panel"]').scrollTop = 0
      window.scrollTo(0, ${pageScroll})
    })()`)
    const DISPLAY_PAINT = { above: '[data-testid="display-panel"]', below: '.controls' }
    const displayPaint = await measurePaintOrder(page, DISPLAY_PAINT)
    for (const failure of displayPaint.failures) check(failures, false, `3D Display 必须压过控制条: ${failure}`)
    if (displayPaint.overlaps) {
      await page.evaluate(`(() => {
        const style = document.createElement('style')
        style.id = 'occlusion-negative-control'
        style.textContent = '.pb-root .controls { z-index: 25 !important }'
        document.head.append(style)
      })()`)
      const inverted = await measurePaintOrder(page, DISPLAY_PAINT)
      await page.evaluate(`document.getElementById('occlusion-negative-control')?.remove()`)
      check(failures, inverted.failures.length > 0,
        `负向对照必须失败：控制条盖住 Display 后次序探针仍然通过 ${JSON.stringify(inverted)}`)
    }

    const killToggle = await page.evaluate(`document.querySelector('[data-testid="disp-killfeed"]')?.checked`)
      ? await clickElement(page, '[data-testid="disp-killfeed"]') : 'already-off'
    check(failures, killToggle === 'already-off' || clicked(killToggle), `kill feed toggle not clickable: ${killToggle}`)
    if (clicked(killToggle)) {
      const killHidden = await page.waitFor(() => !document.querySelector('.killfeed'), { label: 'kill feed hidden by display panel' })
        .then(() => true)
        .catch(() => false)
      if (!killHidden) {
        const state = await page.evaluate(`JSON.stringify({
          checked: document.querySelector('[data-testid="disp-killfeed"]')?.checked,
          killfeed: document.querySelectorAll('.killfeed .kf').length,
          panel: (() => { const p = document.querySelector('.display-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), p.scrollHeight, p.clientHeight] })(),
        })`)
        check(failures, false, `kill feed still visible after toggle: ${state}`)
      }
    }

    await page.evaluate(`(() => {
      window.__pbPane.store.banner = { text: 'Fixture battle result' }
      document.querySelector('[data-testid="disp-tank"]').focus()
    })()`)
    await page.pressH()
    check(failures, await page.evaluate(`!!document.querySelector('[data-testid="display-panel"]:not([hidden])')
      && !document.querySelector('[data-testid="show-all-ui"]')`), 'H on a checkbox must not hide UI')
    await page.evaluate('document.activeElement?.blur()')
    await page.pressH()
    await page.waitFor(() => {
      const root = document.querySelector('.pb-root')
      const panel = root?.querySelector('[data-testid="display-panel"]')
      return !!root && !root.querySelector('.hud') && !root.querySelector('.team-lane')
        && !root.querySelector('.controls') && !root.querySelector('.banner')
        && (!panel || panel.hidden) && !!root.querySelector('[data-testid="show-all-ui"]')
    }, { label: 'H hides all UI and closes Display' })
    check(failures, await page.evaluate('window.__pbPane.store.banner?.text === "Fixture battle result"'),
      'hide all UI must preserve underlying result state')
    if (scenario.touch && scenario.fullscreen) {
      await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
      await waitForStableLayout(page)
      const points = await page.probe(() => {
        const point = (selector) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const r = el.getBoundingClientRect()
          const x = r.left + r.width / 2, y = r.top + r.height / 2
          const hit = document.elementFromPoint(x, y)
          return { x, y, hit: el === hit || el.contains(hit), rect: [r.left, r.top, r.right, r.bottom] }
        }
        return { fullscreen: point('[data-test="pb-fullscreen"]'), restore: point('[data-testid="show-all-ui"]') }
      })
      check(failures, points.fullscreen?.hit && points.restore?.hit,
        `hidden UI buttons must both be independently hit-testable: ${JSON.stringify(points)}`)
      check(failures, points.restore?.rect?.[1] >= points.fullscreen?.rect?.[3] - 0.5,
        `hidden UI restore must sit below the fullscreen button: ${JSON.stringify(points)}`)
      if (points.fullscreen?.hit && points.restore?.hit) {
        await page.installInputTrace()
        await page.tap({ x: points.fullscreen.x, y: points.fullscreen.y, touch: true })
        await page.waitFor(() => !!document.fullscreenElement, { label: 'hidden UI fullscreen enters' }).catch(async (error) => {
          throw new Error(`${error.message}; points=${JSON.stringify(points)} trace=${JSON.stringify(await page.inputTrace())}`)
        })
        const restore = await page.probe(() => {
          const r = document.querySelector('[data-testid="show-all-ui"]').getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })
        await page.tap({ ...restore, touch: true })
        await page.waitFor(() => !document.querySelector('[data-testid="show-all-ui"]'), { label: 'touch restores UI' })
        const fs = await page.probe(() => {
          const r = document.querySelector('[data-test="pb-fullscreen"]').getBoundingClientRect()
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        })
        await page.tap({ ...fs, touch: true })
        await page.waitFor(() => !document.fullscreenElement, { label: 'fullscreen exits after restore' })
      }
    }
    const restoreAfterH = await page.evaluate('!document.querySelector(\'[data-testid="show-all-ui"]\')')
      ? 'clicked-by-touch' : await clickElement(page, '[data-testid="show-all-ui"]')
    check(failures, clicked(restoreAfterH), `restore button after H not clickable: ${restoreAfterH}`)
    await page.waitFor(() => !!document.querySelector('.controls') && !!document.querySelector('.banner')
      && !document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'restore returns result, keeps Display closed' })
    const reopenDisplay = await clickElement(page, '[data-testid="display-toggle"]')
    check(failures, clicked(reopenDisplay), `display toggle after restore not clickable: ${reopenDisplay}`)
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'Display reopens' })

    const hideBtn = await clickElement(page, '[data-testid="hide-all-ui"]')
    check(failures, clicked(hideBtn), `hide-all-ui button not clickable: ${hideBtn}`)
    if (clicked(hideBtn)) {
      await page.waitFor(() => {
        const root = document.querySelector('.pb-root')
        return !!root && !root.querySelector('.hud') && !root.querySelector('.team-lane')
          && !root.querySelector('.controls') && !root.querySelector('.banner')
          && !root.querySelector('[data-testid="display-panel"]:not([hidden])')
          && !!root.querySelector('[data-testid="show-all-ui"]')
      }, { label: 'all UI hidden' })
      await page.evaluate('document.activeElement?.blur()')
      await page.pressH()
      await page.waitFor(() => !!document.querySelector('.controls') && !!document.querySelector('.banner')
        && !document.querySelector('[data-testid="show-all-ui"]')
        && !document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'H restores UI after button hides it' })
    }
  }

  const chipCenter = await openCollectionRemove(page, scenario)
  check(failures, !!(chipCenter && chipCenter.x), `collection remove button not hit-testable: ${JSON.stringify(chipCenter || null)}`)
  if (chipCenter && Number.isFinite(chipCenter.x)) {
    if (scenario.touch && scenario.fullscreen) await page.resetInputTrace()
    else await page.installInputTrace()
    await page.tap({ ...chipCenter, touch: scenario.touch })
    const chipInput = await page.inputTrace()
    check(failures, chipInput.clickCount === 1, `collection remove must receive exactly one real click: ${JSON.stringify(chipInput)}`)
    check(failures, chipInput.primary?.testId === 'collection-remove' && chipInput.click?.testId === 'collection-remove',
      `collection remove touch/click must hit the button: ${JSON.stringify(chipInput)}`)
    await confirmCollectionRemove(page, scenario)
    await page.waitFor(() => !document.querySelector('.pb-root'), { label: '3D pane torn down after clear' })
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="select-files-input"]')
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([5, 6, 7, 8])], 'roster-geometry-b.wotbreplay'))
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { label: 'pre-start for battle B' })
    const startBCenter = await page.evaluate(`(() => {
      const button = document.querySelector('[data-test="replay3d-start"]')
      button.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return (hit === button || button.contains(hit))
        ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        : null
    })()`)
    check(failures, !!startBCenter, 'battle B start button not hit-testable')
    if (startBCenter) {
      await page.evaluate(`(() => { window.__pbPane.store.err = '' })()`)
      await page.tap({ ...startBCenter, touch: scenario.touch })
      const settled = await page.waitForValue('window.__pbPane && window.__pbPane.store.err.length > 0', (v) => v === true,
        { timeout: 30_000, label: 'battle B parse settled (not stuck in parsing)' }).catch(() => null)
      check(failures, settled === true, 'battle B parse did not settle after A was cleared (stuck in parsing?)')
    }
  }

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)

  await closePageTarget(env.chrome, targetId)
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, geometry, xfail: scenario.xfail })
}

