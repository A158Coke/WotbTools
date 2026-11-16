/**
 * Replay3D HUD SegmentedControl 布局浏览器门禁（真实浏览器 computed style，不是源码正则）。
 *
 * 锁定的 invariant（接替 replay3d-hud-layout.test.js 的源码断言，#827）：
 * - 受限宽度（240px 夹具容器 + 8 个选项）下选项不得被 flex 压缩：computed flex-shrink 0 /
 *   flex-basis auto（源码 `flex: none`），容器单行横向可滚动（overflow-x: auto）；
 * - pointer: coarse 档：每个选项的点击区域必须抬到 --hit-min（design-language §5），
 *   computed min-height / min-width ≥ token 值。
 *
 * 夹具 scripts/browser-fixtures/replay3d-hud.html 挂载 canonical SegmentedControl
 * （Replay3DPane / ReplayCapabilityTabs 的 HUD 选项条即该组件），不 mock 任何样式。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const FINE_POINTER = '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'

/** 页面内探针：选项条的 computed flex / 滚动几何与 hit token。 */
function hudProbe() {
  const bar = document.querySelector('.segmented')
  if (!bar) return null
  const options = [...bar.querySelectorAll('.segmented-option')]
  if (options.length === 0) return null
  const rootStyle = getComputedStyle(document.documentElement)
  const hitMin = rootStyle.getPropertyValue('--hit-min').trim()
  const barStyle = getComputedStyle(bar)
  return {
    hitMin,
    hitMinPx: parseFloat(hitMin) || 0,
    overflowX: barStyle.overflowX,
    scrollWidth: bar.scrollWidth,
    clientWidth: bar.clientWidth,
    options: options.map((option) => {
      const style = getComputedStyle(option)
      const rect = option.getBoundingClientRect()
      return {
        flexShrink: style.flexShrink,
        flexBasis: style.flexBasis,
        minHeight: parseFloat(style.minHeight) || 0,
        minWidth: parseFloat(style.minWidth) || 0,
        width: rect.width,
        height: rect.height,
      }
    }),
  }
}

const check = (failures, ok, message) => { if (!ok) failures.push(message) }

/** fine 指针 + 受限宽度：flex:none 不收缩，单行横向滚动。 */
async function runConstrainedLayout(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.goto(`${env.origin}/scripts/browser-fixtures/replay3d-hud.html`)
    const state = await page.waitForValue(`(${hudProbe.toString()})()`, probe => Boolean(probe?.options.length), { label: 'hud segmented rendered' })

    check(failures, state.overflowX === 'auto', `scrollable segmented must be overflow-x:auto (got ${state.overflowX})`)
    check(failures, state.scrollWidth > state.clientWidth, `constrained fixture must overflow horizontally (scrollWidth ${state.scrollWidth} vs clientWidth ${state.clientWidth})`)
    for (const [index, option] of state.options.entries()) {
      check(failures, option.flexShrink === '0', `option ${index} must not shrink (flex-shrink ${option.flexShrink})`)
      check(failures, option.flexBasis === 'auto', `option ${index} must keep intrinsic basis (flex-basis ${option.flexBasis})`)
      check(failures, option.width > 0, `option ${index} must keep a positive intrinsic width`)
    }
    // 行为证据：滚到末尾后最后一个选项完整可见（单行滚动而不是裁切/换行）。
    const end = await page.evaluate(`(() => {
      const bar = document.querySelector('.segmented')
      bar.scrollLeft = bar.scrollWidth
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const last = bar.querySelector('.segmented-option:last-child')
        resolve({ scrollLeft: bar.scrollLeft, lastRight: last.getBoundingClientRect().right, barRight: bar.getBoundingClientRect().right })
      })))
    })()`)
    check(failures, end.scrollLeft > 0, 'segmented must actually scroll horizontally under constrained width')
    check(failures, end.lastRight <= end.barRight + 1, `last option must be fully visible after scrolling (right ${end.lastRight.toFixed(1)} vs bar ${end.barRight.toFixed(1)})`)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/** coarse 指针：触控命中面积抬到 --hit-min。 */
async function runCoarseHitTargets(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.emulate({ width: 390, height: 844, touch: true })
    await page.goto(`${env.origin}/scripts/browser-fixtures/replay3d-hud.html`)
    const state = await page.waitForValue(`(${hudProbe.toString()})()`, probe => Boolean(probe?.options.length), { label: 'coarse: hud segmented rendered' })

    check(failures, state.hitMinPx > 0, `--hit-min token must resolve (got ${state.hitMin})`)
    for (const [index, option] of state.options.entries()) {
      check(failures, option.minHeight >= state.hitMinPx, `coarse: option ${index} min-height must be ≥ --hit-min=${state.hitMinPx} (got ${option.minHeight})`)
      check(failures, option.minWidth >= state.hitMinPx, `coarse: option ${index} min-width must be ≥ --hit-min=${state.hitMinPx} (got ${option.minWidth})`)
    }
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/* ------------------------------------------------------------------ main */

const chromeBinary = findChrome()
const { server, origin } = await startFixtureServer({})
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: [
      FINE_POINTER,
      '--window-size=1440,900',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [name, run] of [['replay3d-hud-constrained', runConstrainedLayout], ['replay3d-hud-coarse-hit', runCoarseHitTargets]]) {
    try {
      results.push({ name, failures: await run(env) })
    } catch (error) {
      results.push({ name, failures: [error.message] })
    }
  }
} finally {
  if (chromeCdp) await chromeCdp.close()
  await server.close()
}

let failed = 0
for (const result of results) {
  if (result.failures.length === 0) {
    console.log(`[browser-replay3d-hud] ${result.name} OK`)
    continue
  }
  failed += 1
  console.error(`[browser-replay3d-hud] ${result.name} FAILED`)
  for (const failure of result.failures) console.error(`  - ${failure}`)
}
if (failed > 0) {
  process.exitCode = 1
  console.error(`[browser-replay3d-hud] ${failed}/${results.length} scenarios failed`)
} else {
  console.log(`[browser-replay3d-hud] all ${results.length} scenarios passed`)
}
