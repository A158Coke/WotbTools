// 浏览器交互门禁：入口/编排（场景实现按域拆分到 browser-workspace-interaction-*.mjs）。
// 门禁分类：frontend/scripts/browser-* 属 test（≤1500 行），拆分只搬家不改场景语义。
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'
import { SHELL_OVERLAY_SCENARIOS, MOBILE_PAGE_SCENARIOS, runShellOverlayScenario, runMobilePageScenario } from './browser-shell-overlays.mjs'
import { DIALOG_SHEET_SCENARIOS, DRAWER_EXIT_SCENARIOS, runDialogSheetScenario, runDrawerExitScenario } from './browser-dialog-sheet.mjs'
import { DRAWER_TABLE_SCENARIOS, runDrawerTableScenario } from './browser-drawer-tables.mjs'
import { CATALOG_HOF_DOC_SCENARIOS, runCatalogHofDocScenario } from './browser-catalog-hof-docs.mjs'
import { check, closeFakeAnalysisServer, getLastPage, results, startFixtureServer } from './browser-workspace-interaction-core.mjs'
import {
  APP_SCENARIOS, AUTH_CAPABILITY_SCENARIOS, PLAYBACK_SCENARIOS, ROSTER_GEOMETRY_SCENARIOS, ROTATION_SCENARIO,
  MENU_VIEWPORT_SCENARIOS, ONBOARDING_SCENARIOS,
  closeOnboardingServer, runAppScenario, runAuthCapabilityScenario, runMenuViewportScenario,
  runOnboardingScenario, runPlaybackControlScenario, runRotationScenario,
} from './browser-workspace-interaction-app-auth.mjs'
import { runRosterGeometryScenario } from './browser-workspace-interaction-roster.mjs'
import {
  PLAYBACK_COLLAPSE_SCENARIOS, PLAYBACK_SHELLNAV_SCENARIOS, closeShellNavServer,
  runPlaybackCollapseScenario, runPlaybackShellNavScenario,
} from './browser-workspace-interaction-playback-shell.mjs'
import {
  ARMOR_FORCED_LANDSCAPE_SCENARIOS, FORCED_LANDSCAPE_SCENARIOS, LIFECYCLE_SCENARIOS,
  MOBILE_FULLSCREEN_SCENARIOS, runArmorForcedLandscapeScenario, runForcedLandscapeScenario,
  runMobileFullscreenScenario, runMultiFileWorkspaceScenario, runOfflineWorkspaceScenario,
  runParseLifecycleScenario, runReplayCollectionScenario, runSceneActivityScenario,
} from './browser-workspace-interaction-mobile.mjs'
import { WORKSPACE_2D_SCENARIOS, runWorkspace2DScenario } from './browser-workspace-interaction-workspace2d.mjs'

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
let chromeCdp = null

try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  const runs = [
    ...SHELL_OVERLAY_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runShellOverlayScenario(env, scenario)) })),
    ...MOBILE_PAGE_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runMobilePageScenario(env, scenario)) })),
    ...DIALOG_SHEET_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDialogSheetScenario(env, scenario)) })),
    ...DRAWER_EXIT_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDrawerExitScenario(env, scenario)) })),
    ...DRAWER_TABLE_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDrawerTableScenario(env, scenario)) })),
    ...CATALOG_HOF_DOC_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runCatalogHofDocScenario(env, scenario)) })),
    ...MENU_VIEWPORT_SCENARIOS.map(scenario => ({ scenario, run: () => runMenuViewportScenario(env, scenario) })),
    { scenario: { name: 'multifile-workspace-playback', width: 1600, height: 900 }, run: () => runMultiFileWorkspaceScenario(env) },
    ...FORCED_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runForcedLandscapeScenario(env, scenario) })),
    ...ARMOR_FORCED_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runArmorForcedLandscapeScenario(env, scenario) })),
    { scenario: { name: 'replay-collection', width: 1440, height: 900 }, run: () => runReplayCollectionScenario(env) },
    { scenario: { name: 'offline-local-workspace-matrix', width: 1600, height: 900 }, run: () => runOfflineWorkspaceScenario(env) },
    ...APP_SCENARIOS.map((scenario) => ({ scenario, run: () => runAppScenario(env, scenario) })),
    ...AUTH_CAPABILITY_SCENARIOS.map((scenario) => ({ scenario, run: () => runAuthCapabilityScenario(env, scenario) })),
    ...ONBOARDING_SCENARIOS.map((scenario) => ({ scenario, run: () => runOnboardingScenario(env, scenario) })),
    { scenario: { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }, run: () => runRosterGeometryScenario(env, { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }) },
    ...ROSTER_GEOMETRY_SCENARIOS.map((scenario) => ({ scenario, run: () => runRosterGeometryScenario(env, scenario) })),
    { scenario: { name: 'scene-activity-lifecycle-desktop', width: 1600, height: 900, touch: false }, run: () => runSceneActivityScenario(env, { name: 'scene-activity-lifecycle-desktop', width: 1600, height: 900, touch: false }) },
    ...LIFECYCLE_SCENARIOS.map((scenario) => ({ scenario, run: () => runParseLifecycleScenario(env, scenario) })),
    ...PLAYBACK_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackControlScenario(env, scenario) })),
    ...PLAYBACK_COLLAPSE_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackCollapseScenario(env, scenario) })),
    ...PLAYBACK_SHELLNAV_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackShellNavScenario(env, scenario) })),
    { scenario: ROTATION_SCENARIO, run: () => runRotationScenario(env, ROTATION_SCENARIO) },
    ...MOBILE_FULLSCREEN_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileFullscreenScenario(env, scenario) })),
    ...WORKSPACE_2D_SCENARIOS.map((scenario) => ({ scenario, run: () => runWorkspace2DScenario(env, scenario) })),
  ]
  // 可选场景名过滤（调试单个形态时不必跑满矩阵）。
  const scenarioArgs = parseScenarioArgs(process.argv.slice(2))
  const { nameFilter } = scenarioArgs
  const base = process.argv.includes('--occlusion')
    ? runs.filter(({ scenario }) => /^(shell-overlay-|mobile-pages-|dialog-sheet-|drawer-tables-|overlay-|menu-viewport-|ws2d-|roster-geometry-|capability-normal-shots-armor-handoff)/.test(scenario.name))
    : process.argv.includes('--mobile-visual')
    ? runs.filter(({ scenario }) => scenario.width < 900 && /^(roster-geometry|ws2d)-/.test(scenario.name))
    : nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  const selected = selectShard(base, scenarioArgs)
  for (const { scenario, run } of selected) {
    // 单个场景抛错（例如等不到元素）不得吞掉整轮结果：记为该场景的失败后继续。
    try {
      await run()
      if (scenario.name.startsWith('onboarding-')) {
        const completed = results.at(-1)
        console.log(`[browser-interaction-progress] ${scenario.name} ${completed?.failures.length ? 'FAILED' : 'OK'}`)
      }
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(getLastPage() ? await getLastPage().diagnose().catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
        xfail: scenario.xfail,
      })
      if (scenario.name.startsWith('onboarding-')) console.error(`[browser-interaction-progress] ${scenario.name} FAILED: ${error.message}`)
    }
  }

  const tabletRoster = results.find((result) => result.name === 'roster-geometry-1024x768-tablet')?.geometry
  const desktopRoster = results.find((result) => result.name === 'roster-geometry-1600x900-desktop')?.geometry
  const fullscreenRoster = results.find((result) => result.name === 'roster-geometry-1792x922-fullscreen-desktop')?.geometry
  // 2026-10-05：浮层布局下 lane 宽度 = clamp(11rem, 16vw, 15rem) 恒定，center=2×lane 的
  // 比例契约随旧网格一并停用，待按新布局重写（覆盖缺口记录于 PR #537）。
  const LEGACY_GRID_CONTRACT = false
  if (tabletRoster && desktopRoster && fullscreenRoster && LEGACY_GRID_CONTRACT) {
    const failures = []
    // As the workspace grows, desktop center stays twice the roster width.
    // 这里锁的是比例：lane 变大、center 变大且桌面始终约 2× lane。
    check(failures, tabletRoster.laneWidths[0] + 1 < desktopRoster.laneWidths[0], 'roster lanes must grow between tablet and desktop')
    check(failures, fullscreenRoster.laneWidths[0] > desktopRoster.laneWidths[0] + 1, 'roster lanes must absorb spare viewport width')
    for (const [name, g] of [['tablet', tabletRoster], ['desktop', desktopRoster], ['fullscreen', fullscreenRoster]]) {
      const lane = g.laneWidths[0]
      // HUD 属于 center 列，用它的宽度当 center 宽度的实测值
      const center = g.centerWidth ?? null
      if (!lane || !center) { check(failures, false, `${name} roster matrix: missing lane/center`); continue }
      if (name !== 'tablet') check(failures, Math.abs(center - lane * 2) <= 2,
        `${name} roster matrix: center must be twice the roster lane width (center=${center} square=${g.square.w})`)
    }
    results.push({ name: 'roster-fluid-width-matrix', failures, viewport: '1024 → 1600 → 1792' })
  }
  let failed = 0
  let knownIssues = 0
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`[browser-interaction] ${result.name} OK (${result.viewport})`)
      continue
    }
    if (result.xfail) {
      // 显式已知问题：照常运行与打印，但不计入退出码（修复后应从 known-issues 移除）。
      knownIssues += 1
      console.error(`[browser-interaction] ${result.name} KNOWN-ISSUE (${result.viewport}): ${result.xfail}`)
      for (const failure of result.failures) console.error(`  - ${failure}`)
      continue
    }
    failed += 1
    console.error(`[browser-interaction] ${result.name} FAILED (${result.viewport})`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }
  if (failed > 0) {
    process.exitCode = 1
    console.error(`[browser-interaction] ${failed}/${results.length} scenarios failed`)
  } else {
    console.log(`[browser-interaction] all ${results.length} scenarios passed`)
  }
} finally {
  // Chrome 启动失败时也必须关掉 Vite server，否则脚本会挂在未释放的监听上而不是报错退出。
  if (chromeCdp) await chromeCdp.close()
  await closeOnboardingServer()
  await closeFakeAnalysisServer()
  await closeShellNavServer()
  await server.close()
}

