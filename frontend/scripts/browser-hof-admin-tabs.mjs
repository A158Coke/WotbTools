/**
 * HoF 管理页吸顶 Tab 条浏览器门禁（真实浏览器 computed style，不是源码正则）。
 *
 * 锁定的 invariant（历史回归：showcase-regressions.css 曾把 .hof-admin-tabs 从 sticky 改成
 * relative，Tab 条滑到筛选栏下面——生产「百场审核 Tab 不可见」，#827）：
 * - .hof-admin-tabs computed position: sticky，top == --header-h + --space-2（顶栏下方）；
 * - z-index == --z-sticky（不被后加载的全局样式表压下去）；
 * - 页面滚动后 Tab 条真实吸附在 top 位置（sticky 生效，不是只写了属性）；
 * - 窄屏 Tab 条横向可滚动（overflow-x: auto），最后一个 Tab 滚动后完整可见（不被裁掉）。
 *
 * 复用 fixture-server.mjs（真实 Vite 应用 + auth stub）： HofAdminPage 走真实路由
 * ?view=hof-admin，admin API 用确定性空夹具。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const hofAdminMiddleware = (request, response, next) => {
  const path = request.url?.split('?')[0]
  if (request.method !== 'GET' || !path.startsWith('/api/admin/hof')) { next(); return }
  response.setHeader('Content-Type', 'application/json')
  if (path.endsWith('/vehicle-options')) response.end(JSON.stringify([]))
  else response.end(JSON.stringify({ items: [], page: 1, size: 50, totalItems: 0, totalPages: 0 }))
}

/** 页面内探针：Tab 条 computed 定位几何 + token 值。 */
function tabsProbe() {
  const bar = document.querySelector('.hof-admin-tabs')
  if (!bar) return null
  const style = getComputedStyle(bar)
  const rootStyle = getComputedStyle(document.documentElement)
  const rect = bar.getBoundingClientRect()
  return {
    position: style.position,
    top: style.top,
    zIndex: style.zIndex,
    overflowX: style.overflowX,
    headerH: rootStyle.getPropertyValue('--header-h').trim(),
    space2: rootStyle.getPropertyValue('--space-2').trim(),
    zSticky: rootStyle.getPropertyValue('--z-sticky').trim(),
    scrollWidth: bar.scrollWidth,
    clientWidth: bar.clientWidth,
    viewportWidth: innerWidth,
    tabCount: bar.querySelectorAll('button').length,
  }
}

const px = (value) => parseFloat(value) || 0
const check = (failures, ok, message) => { if (!ok) failures.push(message) }

/** 桌面：sticky 属性与真实吸附行为（滚动到深处后 Tab 条仍在顶栏下方）。
 * 用矮视口让空数据的管理页也能滚动（sticky 的行为证据需要真实滚动量）。 */
async function runSticky(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.emulate({ width: 1024, height: 480, touch: false })
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem('wotb-lang', 'zh-CN')`)
    await page.goto(`${env.origin}/?view=hof-admin&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${tabsProbe.toString()})()`, probe => Boolean(probe?.tabCount), { label: 'hof-admin tabs rendered' })

    check(failures, state.position === 'sticky', `tabs must be position:sticky (got ${state.position})`)
    const expectedTop = px(state.headerH) + px(state.space2)
    check(failures, Math.abs(px(state.top) - expectedTop) <= 0.5, `tabs top must equal --header-h + --space-2 = ${expectedTop}px (got ${state.top}, --header-h=${state.headerH})`)
    check(failures, state.zIndex === String(parseInt(state.zSticky, 10)), `tabs z-index must equal --z-sticky=${state.zSticky} (got ${state.zIndex})`)

    // sticky 的行为证据：滚动到页面深处，Tab 条视口位置必须钉在 computed top 上。
    const stuck = await page.evaluate(`(() => {
      const bar = document.querySelector('.hof-admin-tabs')
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        viewportTop: bar.getBoundingClientRect().top,
        scrollTop: document.scrollingElement.scrollTop,
      }))))
    })()`)
    check(failures, stuck.scrollTop > 0, 'page must be scrollable for the sticky regression to be meaningful')
    check(failures, Math.abs(stuck.viewportTop - px(state.top)) <= 1, `scrolled tabs must stick at ${state.top} (got viewportTop ${stuck.viewportTop.toFixed(1)})`)
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/** 窄屏：Tab 条横向可滚动，最后一个 Tab 滚动到末尾后完整可见（不被裁掉，审计 PG-10）。 */
async function runNarrowScrollable(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  await page.enable()
  try {
    await page.emulate({ width: 320, height: 640, touch: true })
    await page.goto(`${env.origin}/`)
    await page.evaluate(`localStorage.setItem('wotb-lang', 'zh-CN')`)
    await page.goto(`${env.origin}/?view=hof-admin&ws-auth=1&ws-roles=wotbtools-admin&ws-auth-init=resolve-authenticated`)
    const state = await page.waitForValue(`(${tabsProbe.toString()})()`, probe => Boolean(probe?.tabCount), { label: 'narrow: hof-admin tabs rendered' })

    // <768px 档 .hof-admin-tabs 有意回退为 static（手机端不做吸顶），此处只锁滚动语义。
    check(failures, state.overflowX === 'auto', `narrow: tabs must be horizontally scrollable (got overflow-x ${state.overflowX})`)
    if (state.scrollWidth > state.clientWidth) {
      // 有溢出就必须真的能滚到末尾且最后一个 Tab 完整可见。
      const end = await page.evaluate(`(() => {
        const bar = document.querySelector('.hof-admin-tabs')
        bar.scrollLeft = bar.scrollWidth
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
          const last = bar.querySelector('button:last-child')
          const rect = last.getBoundingClientRect()
          resolve({ scrollLeft: bar.scrollLeft, lastRight: rect.right, barRight: bar.getBoundingClientRect().right })
        })))
      })()`)
      check(failures, end.scrollLeft > 0, 'narrow: tabs bar must actually scroll horizontally when content overflows')
      check(failures, end.lastRight <= end.barRight + 1, `narrow: last tab must be fully visible after scrolling (right ${end.lastRight.toFixed(1)} vs bar ${end.barRight.toFixed(1)})`)
    } else {
      check(failures, state.clientWidth >= state.scrollWidth, 'narrow: overflow must be real or fully visible')
    }
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  return failures
}

/* ------------------------------------------------------------------ main */

const chromeBinary = findChrome()
const { server, origin } = await startFixtureServer({ middleware: hofAdminMiddleware })
let chromeCdp = null
const results = []
try {
  chromeCdp = await launchChromeForCdp(chromeBinary, {
    extraArgs: [
      '--window-size=1440,900',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  for (const [name, run] of [['hof-admin-tabs-sticky', runSticky], ['hof-admin-tabs-narrow-scrollable', runNarrowScrollable]]) {
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
    console.log(`[browser-hof-admin-tabs] ${result.name} OK`)
    continue
  }
  failed += 1
  console.error(`[browser-hof-admin-tabs] ${result.name} FAILED`)
  for (const failure of result.failures) console.error(`  - ${failure}`)
}
if (failed > 0) {
  process.exitCode = 1
  console.error(`[browser-hof-admin-tabs] ${failed}/${results.length} scenarios failed`)
} else {
  console.log(`[browser-hof-admin-tabs] all ${results.length} scenarios passed`)
}
