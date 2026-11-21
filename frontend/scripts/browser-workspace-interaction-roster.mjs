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

  // ?debug：Replay3DPane 的状态注入口（与场景内核的 ?debug 钩子同一口径），
  // 必须在面板 setup 之前就在 URL 上。
  await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="replay"]'), { label: 'capability tabs' })

  // 单文件选择（DataTransfer 写入真实 input + change 事件）：批次分析是替身，
  // 这里只负责让 3D 面板拿到 file prop（稍后注入就绪态）。
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="select-files-input"]')
    if (!input) throw new Error('file input missing')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'roster-geometry.wotbreplay'))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)

  // 真实点击进入统一回放面板并切到 3D（工作台内挂载 Replay3DPane）
  await enterReplay3d(page, scenario)
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  // 真实点击「开始」：走过待开播闸门；垃圾文件必然解析失败 → 等内核状态收敛（err 落下，
  // 或极端环境下解析直接成功 hasData）再注入就绪态，此后内核不再有异步写入。
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

  // 注入 3D 就绪态（reviewer 要求的 fixture：两队非空 / unknown 非空 / killfeed 非空）
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
  // ResizeObserver 异步把实测工作区高度写进 `--pb-workspace-h`（车道与正方形定界依赖它）。
  // ⚠️ 定下来之前**不能**开始断言：这个变量一变，`.pb-root` 的高度、
  // 车道的上下界、控制条的位置会一起重排，读到的就是「上一轮布局 + 这一轮变量」的混合几何
  // （实测同一次运行里 1024×768 会因为抢在重排前读而失败，稍后再读就通过）。
  await waitForStableLayout(page)
  let sceneHit = await sceneHitTarget(page)

  if (scenario.rotateTo) {
    await page.emulate({ ...scenario, ...scenario.rotateTo })
    await page.waitFor(() => document.querySelector('.pb-root')?.classList.contains('roster-side'),
      { label: 'rotated 3D pane switches to Team 1 | Stage | Team 2' })
    await waitForStableLayout(page)
    // 旋转后媒体查询从竖屏触控档切到紧凑档，命中下限必须重新读取。
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

  // Real input regression: disclosure must release toolbar space and remain reachable.
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
  // 回卷到顶部：start/scrollIntoView 留下的页面滚动会让"浮层在视口内"的测量失真
  // （lane top=-52 = 恰好一屏标题高）。浮层几何契约必须在**未滚动**的布局上取值。
  await page.evaluate('window.scrollTo(0, 0)')
  await waitForStableLayout(page)
  const geometry = await page.probe(rosterGeometryProbe)
  if (scenario.name.includes('distance-')) {
    // 非全屏工作台在矮窗口里会把 .pb-root 推到首屏之外；把根滚进视口后再测，
    // 否则行命中/滑条可见性测到的是页面滚动位置，而不是布局本身。
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

    // 真实拖动证明滑条仍可操作，而不是只摆对位置。
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

    // 负向对照：把滑条移到名册中段，必须真的压住行与血量条；否则几何判定是空跑。
    // （旧竖排布局只在 ru 等长标签下才必然压住短标签；这里用确定性的真实遮挡来验证探针。）
    await page.evaluate(`(() => {
      const style = document.createElement('style')
      style.id = 'distance-occlusion-negative-control'
      style.textContent = '.pb-root.playback-workspace .scene-dist { top: 120px !important; bottom: auto !important; }'
      document.head.append(style)
    })()`)
    await waitForStableLayout(page)
    const mutant = await page.probe(sceneDistanceProbe)
    check(failures, mutant.rowOverlap.length > 0 && mutant.hpOverlap.length > 0,
      `${scenario.name} distance slider negative control: intentional overlay must hit roster rows and HP bars, got rows=${JSON.stringify(mutant.rowOverlap)} hp=${JSON.stringify(mutant.hpOverlap)}`)
    await page.evaluate("document.getElementById('distance-occlusion-negative-control')?.remove()")
    await waitForStableLayout(page)

    // 全屏切换后仍须成立：同一场景内真实进入/退出，而不是只靠另一个全屏场景代证。
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

  // —— #727 3D 主内容遮挡（design-language §5 例外段）：HUD 可以浮在场景上，但控制条不得压入中心 ——
  await page.evaluate(`document.querySelector('.pb-root .scene').scrollIntoView({ block: 'center' })`)
  await waitForStableLayout(page)
  // HUD 与击杀流都是 pointer-events: none，网格看不见，必须显式列出；击杀流超出 HUD 盒，单列。
  // 按满 3 条击杀流量：这是 HUD 最高的状态，空击杀流量不出它压没压进中心。
  // 贴边例外的适用范围以组件自己派生的 compact-bar 为准，不在门禁里再写一套断点。
  const compactBar = await page.evaluate(`document.querySelector('.pb-root').classList.contains('compact-bar')`)
  const EDGE_DOCKED = ['.team-lane', '.killfeed']
  const SCENE_OCCLUSION = { primary: '.pb-root .scene', persistent: ['.pb-root .hud', '.pb-root .killfeed'], overlayHud: true, edgeDocked: compactBar ? EDGE_DOCKED : [] }
  await page.evaluate(`(() => {
    window.__sceneKillfeed = window.__pbPane.store.killfeed
    window.__pbPane.store.killfeed = [1, 2, 3].map((id) => ({ id, killer: 'Killer_' + id, victim: 'Victim_' + id, kill: true }))
    document.querySelector('[data-testid="display-toggle"]').click()
  })()`)
  // 击杀流开关是持久化偏好，前一个场景可能关掉了它：先打开，否则这里量不到击杀流
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
  // 竖屏的 HUD / 控制条都在流内，场景上本来就没有常驻面；横屏必须真的发现它们，否则就是空跑
  if (scenario.layout !== 'portrait') {
    check(failures, sceneOcclusion.items?.length > 0, '3D 遮挡判定空跑：网格没有发现任何 HUD 面')
    check(failures, sceneOcclusion.items?.some((item) => item.label === '[replay3d-killfeed]'), '3D 遮挡判定空跑：没有量到击杀流')
  }
  // 行数预算：放不下 3 条时只渲染最新的，每一行都完整，不是把 3 条一起压扁
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
  // 只有非紧凑形态的自然预算才有「HUD 变高 → 降到 1 行 → 恢复」的收缩语义可测
  if (scenario.killfeedAdaptive) {
    // HUD 变高（如基地状态条出现）时预算降到 1 行：只留最新一条，不是把 3 条压进一行高度
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
  // 负向对照：44px 的合规控件（类名不在任何清单里，位置避开任何整数倍采样点的巧合），探针只能靠命中发现它
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
  // 负向对照：不参与命中的装饰层进中心，只有显式清单能发现
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
  // 负向对照：贴边例外的作用域。真实改几何后过探针，而不是断言配置值。
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
    // 播放条已停靠在舞台下方（统一面板，flex 列布局）：对条加负 margin 只会让 flex:1 的舞台
    // 长高（实测 scene 325→513，条的位置不动），负向对照永远打不中。改用「控件被错误地
    // 绝对定位进场景中部」这一真实回归形态：探针必须把 div.controls 判进中心保护区。
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
    // 宽形态：车道轻微压入中心。这个量在紧凑例外的 15% 以内，严格判定必须红、放宽判定必须绿，
    // 两边都成立才证明例外确实没有漏到宽形态。
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
  // HP 是主 combat state：行里必须真的有一条 HP bar（数值 / 百分比已经收进条内）。
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

  // Desktop uses approximately 25 / 50 / 25 columns.
  // 2026-10-05 布局恢复为「场景铺满 + 浮层」：2/6/2 列几何断言编码的是被替换的旧契约，
  // 待按新布局重写（覆盖缺口记录于 PR #537）；重写确认前只保留布局无关断言。
  const LEGACY_GRID_CONTRACT = false
  if (geometry.side && LEGACY_GRID_CONTRACT) {
    const columns = await page.probe(workspaceColumnsProbe)
    // --pb-roster-min = 9rem，按根字号折算（2/6/2 的窄档 fallback 就是守在它上面）。
    const rosterMinPx = 9 * (await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize) || 16'))
    check(failures, columns.root, 'workspace columns: pb-root missing')
    check(failures, Math.abs(columns.left.w - columns.right.w) <= 0.5,
      `both lanes must share one width: ${JSON.stringify({ left: columns.left.w, right: columns.right.w })}`)
    // center 吃掉除两条 lane 与 gutter 之外的全部宽度（没有额外 max-width / margin 卡窄它）。
    // centerW 量自 HUD 盒（HUD 属于整列），所以这条同时证明「HUD 属于整列」。
    const expectedCenter = columns.contentW - 2 * columns.laneW - 2 * (columns.laneGutter ?? 0)
    check(failures, Math.abs(columns.centerW - expectedCenter) <= 1.5,
      `center column must consume all remaining width (expected ${expectedCenter}): ${JSON.stringify({ centerW: columns.centerW, laneW: columns.laneW, contentW: columns.contentW, gutter: columns.laneGutter })}`)
    // Desktop keeps the center twice as wide as either roster.
    if (scenario.width >= 1200) check(failures, Math.abs(columns.centerW - columns.laneW * 2) <= 2,
      `desktop center must be twice the roster lane width: center=${columns.centerW} square=${geometry.square.w}`)
    // lane 不得低于可读下限（--pb-roster-min，2/6/2 的窄档 fallback 就是守在它上面）。
    // 下限值随 scenario 传入：page.evaluate 的表达式里没有 getComputedStyle 作用域。
    check(failures, columns.laneW >= rosterMinPx - 0.5,
      `roster lane must keep its readable floor: ${JSON.stringify({ laneW: columns.laneW, minLane: rosterMinPx })}`)
    // HUD 属于整个 center column，而不是按内容收缩成中间小块
    check(failures, columns.hud && Math.abs(columns.hud.w - columns.centerW) <= 1,
      `HUD must span the whole center column: ${JSON.stringify({ hudW: columns.hud?.w, centerW: columns.centerW })}`)
    // 正方形 Stage 落在 center column 内，且不产生水平溢出
    check(failures, columns.square && columns.square.w <= columns.centerW + 0.5,
      `Stage must fit inside the center column: ${JSON.stringify({ stage: columns.square?.w, centerW: columns.centerW })}`)
    check(failures, columns.square && Math.abs(columns.square.w - columns.centerW) <= 1,
      `Stage must fill the center width: ${JSON.stringify({ w: columns.square?.w, h: columns.square?.h })}`)
    check(failures, columns.rootBox.left >= -0.5 && columns.rootBox.right <= viewport.width + 0.5,
      `workspace must not overflow horizontally: ${JSON.stringify({ root: columns.rootBox, viewport: viewport.width })}`)
    // center column 水平居中：HUD 中心必须落在两条车道之间（左右留白对称）
    const hudCenter = columns.hud.left + columns.hud.w / 2
    const rootCenter = columns.rootBox.left + columns.rootBox.w / 2
    check(failures, Math.abs(hudCenter - rootCenter) <= 1,
      `center column must stay centered between the lanes: ${JSON.stringify({ hudCenter, rootCenter })}`)

    // roster off：两条车道必须完全消失、center 变成满宽、Stage 仍居中。
    // 用 hit-tested 的 clickElement：矮视口下 Display 面板比可见区还高，必须先滚面板再点。
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
      // center 变成满宽：Stage 不再被两条 lane 挤窄。
      // 注意 Stage 常是**高度受限**的（宽屏正方形由可用高度决定），所以这里锁的是
      // 「不会被挤小 + 不横向溢出」，而不是无条件变大。
      check(failures, off.square && off.square.w >= columns.square.w - 1,
        `roster off must not shrink the Stage: on=${columns.square?.w} off=${off.square?.w}`)
      check(failures, off.square && off.square.w <= off.rootW + 0.5,
        `roster off Stage must stay inside the workspace: ${JSON.stringify({ stage: off.square?.w, rootW: off.rootW })}`)
      // 若宽度本是限制项（center < 可用高度），关掉名册后 Stage 必须变大
      if (columns.centerW < columns.square.h - 1) {
        check(failures, off.square.w > columns.square.w,
          `roster off must enlarge a width-bound Stage: on=${columns.square?.w} off=${off.square?.w}`)
      }
      // Stage 仍水平居中于工作区
      check(failures, off.square && Math.abs((off.square.left + off.square.w / 2) - (off.rootBox.left + off.rootBox.w / 2)) <= 1.5,
        `roster off must keep the Stage centered: ${JSON.stringify({ square: off.square, root: off.rootBox })}`)
      // 恢复：名册回来，几何回到名册开启时的形状
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

  // —— 跟随：名册行 → selectedEid + cam=follow（2026-10-05 交互契约）——
  // 名册点击 = 跟随 + 行高亮，**不再打开共享详情窗**（详情只能由场景点击坦克触发，
  // 属真实回放场景的覆盖——本场景用假回放只验几何，场景无 DATA，详情不可能打开）。
  const timeBeforeFollow = await page.evaluate('window.__pbPane.store.time')
  // 页面顶部有吸顶的工作台标题：先把行滚到视口中部再点（真机用户也是这样点到的）。
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

  // Team 2 行点击 = 跟随切换（详情仍不开）
  await page.evaluate(`document.querySelector('.team2 .pl:nth-child(3)')?.scrollIntoView({ block: 'center' })`)
  const row3Id = await page.evaluate(`(() => { const r = document.querySelector('.team2 .pl:nth-child(3)'); return Number(r?.dataset.accountId) })()`)
  const team2Click = await clickElement(page, '.team2 .pl:nth-child(3)')
  check(failures, clicked(team2Click), `Team 2 row not clickable: ${team2Click}`)
  await page.waitFor(() => window.__pbPane.store.cam === 'follow', { label: 'Team 2 click switches follow' })
  check(failures, await page.evaluate('window.__pbPane.selectedEid') === row3Id, `Team 2 click must select the clicked row: expected ${row3Id}`)
  check(failures, await page.evaluate('window.__pbPane.store.cam') === 'follow', 'follow switch keeps cam=follow')
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-info"]')`), 'follow switch must not open details')

  // 退出全屏（重写跟随块时曾误删——不退出的话，后续 chip / 显示面板检查都在全屏顶层
  // 下跑，工作台数据面板被全屏层完全遮蔽，永远不可点）
  if (scenario.fullscreen) {
    await page.evaluate('document.exitFullscreen()')
    await page.waitFor(() => !document.fullscreenElement, { label: 'exit fullscreen' })
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi'), 'exiting fullscreen must keep the 3D scene')
    check(failures, await page.evaluate('window.__pbPane.selectedEid') === row3Id, 'exiting fullscreen must keep the selection')
  }

  // —— 「显示」面板：真实点击展开，几何在视口内，不盖场景中心 ——
  // 可点目标：先在面板自身的滚动容器内把元素滚进可视区（**不用 scrollIntoView**：它会连带
  // 滚动祖先，把底部控制条滚出视口 → 中心点命中失败，实测 1600x900 的隐藏按钮就是这样"不可点"），
  // 再做 elementFromPoint 命中验证。

  // —— #727 控制条的子菜单：一行控制条上方展开，每个档位都要完整可点 ——
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

  // —— 「显示」面板：真实点击展开，几何在视口内，不盖场景中心 ——
  // 这段探针 2D / 3D 共用，且断言「点一下 = 打开」。3D 的名册场景会开关同一面板，
  // 所以先**幂等地归位到关闭**（关着就不动），再点开——否则点击会变成关闭、后续等待超时。
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

    // —— #727 瞬态优先 + 可见即可达（design-language §5）：3D 的 Display 与控制条 ——
    // 逐项滚进视口再测：竖屏的面在页面流里，矮横屏的面自己滚动，都不是"一屏全看得见"。
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
      // 负向对照：把控制条提到瞬态面之上，次序探针必须报错
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

    // 单个分块开关真实生效：把击杀流**显式关掉**（先读当前值，避免依赖上一条浏览器配置里的
    // 持久化偏好），它必须从 DOM 里消失。失败时把复选框状态与面板几何一起带出来。
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

    // H respects interactive targets, then closes an already-open Display panel and hides
    // result presentation without deleting its underlying state. Real keyboard input is
    // required: a synthetic event dispatched on window would bypass the focus/target guard.
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
      // 紧凑档全屏按钮本体 40px、top 6；恢复入口必须真的让到它下方，而不是只测两个中心点各自可点。
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

    // The inverse path uses the same transition: button hides, H restores.
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

  // —— A → 清空 → B（真实解析生命周期，P0 回归路径）——
  // 注意：本段必须先等 A 收敛（err / hasData）才能注入就绪态，所以它覆盖的是「A 已 settle
  // 后再换文件」；**A 仍在解析时就被清空**的线上真实序列由下面的
  // `runParseLifecycleScenario`（parse-lifecycle-* 场景）用闸门 Worker 覆盖。
  // 从回放列表撤下第一场（真实触屏/鼠标 + 确认框），换入第二份文件再真实点击「开始」：
  // 第二场的解析必须收敛（loading 落下、err 或 ready），不得因旧解析占着 Worker 队列永远停在「解析中」。
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
      // 先清掉 A 的失败残留：此后 store.err 只能由 B 自己的解析写回（内核代数 guard
      // 保证只有当前加载可写 err）——「err 重新非空」就是 B 的解析跑完并收敛的证明。
      // 若 P0 回归（旧解析占队列导致 B 永远「解析中」），err 保持空 → 超时失败。
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

