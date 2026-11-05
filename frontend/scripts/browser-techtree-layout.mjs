/**
 * 科技树 / compact 页头布局门禁（真实浏览器几何，不是源码正则）。
 *
 * 锁定的 invariant：
 * - compact（<768）页头收敛为「标题 + 操作」一行（≤56px，DC-ARC-02），国别页签单行；
 * - 科技树滚动区不得伸到固定底部 Tab 栏下面，吸底等级条必须停在底栏上方；
 * - 矮横屏树视口至少约两行；平板 / 桌面等级条保持在滚动视口内；
 * - 任何形态都没有页面级横向溢出。
 *
 * 负向对照：在手机场景注入旧实现 `max-block-size: calc(100dvh - 220px)`，断言探针
 * 必须抓到「等级条被底栏遮住」——防止断言在旧 bug 上仍然变绿。
 *
 * 数据面用确定性夹具资产包（科技树 JSON + tank_cache + crops），不依赖真实资产。
 */
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const NATION = 'ussr'
const NODE_W = 216
const NODE_H = 96
const ROWS = 10
const COLS = 4

/** 确定性科技树：10 行 × 4 列，行内串联研发边；内容高度 960px，足以让各档都产生纵向滚动。 */
function fixtureTechTree() {
  const nodes = []
  const edges = []
  const tankCache = {}
  let tankId = 9100
  for (let y = 1; y <= ROWS; y++) {
    for (let x = 1; x <= COLS; x++) {
      const stem = `Fixture_${y}_${x}`
      const id = tankId++
      nodes.push({ stem, tankId: id, tier: y, x, y })
      tankCache[id] = { id, name: `Fixture ${y}-${x}`, tier: y, nation: NATION, type: 'mediumTank' }
      if (x > 1) edges.push({ from: `Fixture_${y}_${x - 1}`, to: stem, cost: { xp: 1000 * x } })
    }
  }
  return {
    tree: { meta: { nation: NATION, premiumRows: 1 }, nodes, pending: [], edges },
    tankCache,
  }
}

const { tree, tankCache } = fixtureTechTree()

const SCENARIOS = [
  { name: 'phone-390x844', width: 390, height: 844, touch: true, compact: true },
  { name: 'phone-360x640', width: 360, height: 640, touch: true, compact: true },
  { name: 'phone-landscape-740x360', width: 740, height: 360, touch: true, compact: false, landscape: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, touch: true, compact: false },
  { name: 'desktop-1440x900', width: 1440, height: 900, touch: false, compact: false },
]

/** 页面内几何探针（Page.probe 会序列化，不能引用模块作用域）。 */
function layoutProbe() {
  const rect = (element) => {
    if (!element) return null
    const r = element.getBoundingClientRect()
    return {
      top: Math.round(r.top * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
      left: Math.round(r.left * 10) / 10,
      right: Math.round(r.right * 10) / 10,
      width: Math.round(r.width * 10) / 10,
      height: Math.round(r.height * 10) / 10,
    }
  }
  const q = selector => document.querySelector(selector)
  const scroll = q('.tt-scroll')
  const ruler = q('.tt-ruler')
  const tabbar = q('[data-testid="app-tab-bar"]')
  const header = q('.techtree .page-header')
  const tabs = q('.tt-tabs')
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    header: rect(header),
    tabs: rect(tabs),
    tabRows: tabs ? new Set([...tabs.children].map((element) => Math.round(element.getBoundingClientRect().top))).size : null,
    scroll: scroll ? { ...rect(scroll), clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight } : null,
    ruler: rect(ruler),
    tabbar: rect(tabbar),
    cells: document.querySelectorAll('.tt-cell').length,
  }
}

function assertScenario(scenario, layout) {
  const label = scenario.name
  assert.ok(layout.cells >= ROWS * COLS, `${label}: 科技树未完整渲染（cells=${layout.cells}）`)
  assert.ok(layout.header, `${label}: 缺少 PageHeader`)
  assert.ok(layout.scroll, `${label}: 缺少树滚动区`)
  assert.ok(layout.ruler, `${label}: 缺少等级条`)
  assert.ok(
    layout.document.scrollWidth <= layout.viewport.width,
    `${label}: 页面横向溢出（scrollWidth=${layout.document.scrollWidth} > ${layout.viewport.width}）`,
  )
  assert.ok(
    layout.ruler.bottom <= layout.scroll.bottom + 1,
    `${label}: 等级条超出滚动视口（ruler.bottom=${layout.ruler.bottom}, scroll.bottom=${layout.scroll.bottom}）`,
  )
  assert.ok(
    layout.ruler.top >= layout.scroll.top - 1,
    `${label}: 等级条跑到滚动视口上方（ruler.top=${layout.ruler.top}, scroll.top=${layout.scroll.top}）`,
  )
  if (scenario.compact) {
    assert.ok(layout.tabbar, `${label}: compact 外壳必须渲染底部 Tab 栏`)
    assert.ok(
      layout.header.height <= 56,
      `${label}: compact 页头 ${layout.header.height}px 超过 DC-ARC-02 的 56px`,
    )
    assert.equal(layout.tabRows, 1, `${label}: 国别页签必须单行横滑（rows=${layout.tabRows}）`)
    assert.ok(
      layout.scroll.bottom <= layout.tabbar.top + 1,
      `${label}: 树滚动区伸到底栏下面（scroll.bottom=${layout.scroll.bottom}, tabbar.top=${layout.tabbar.top}）`,
    )
    assert.ok(
      layout.ruler.bottom <= layout.tabbar.top - 1,
      `${label}: 等级条被底栏遮住（ruler.bottom=${layout.ruler.bottom}, tabbar.top=${layout.tabbar.top}）`,
    )
  }
  if (scenario.landscape) {
    assert.ok(
      layout.scroll.height >= NODE_H * 2,
      `${label}: 矮横屏树视口只有 ${layout.scroll.height}px（应至少 ${NODE_H * 2}px）`,
    )
  }
}

const { server, origin } = await startFixtureServer()
const assets = await startFixtureAssetPack({
  tankCache,
  extraRoutes: {
    [`/research/tech_tree/${NATION}.json`]: { type: 'application/json', body: JSON.stringify(tree) },
    '/tank_images/crops.json': { type: 'application/json', body: '{}' },
  },
})
const chrome = findChrome()
const cdp = await launchChromeForCdp(chrome, { extraArgs: ['--disable-background-timer-throttling'] })
const failures = []
try {
  for (const scenario of SCENARIOS) {
    const { targetId, sessionId } = await cdp.openPage()
    const page = new Page(cdp.client, sessionId)
    try {
      await page.enable()
      await page.emulate(scenario)
      await page.goto(`${origin}/?view=agent-techtree&nation=${NATION}&assets=${encodeURIComponent(assets.origin)}`)
      await page.waitForValue(
        'document.querySelectorAll(".tt-cell").length',
        count => count >= ROWS * COLS,
        { timeout: 30_000, label: `${scenario.name}: tech tree rendered` },
      )
      await page.animationsSettled()
      const layout = await page.probe(layoutProbe)
      assertScenario(scenario, layout)
      console.log(`[browser-techtree-layout] ${scenario.name} PASS ${JSON.stringify({
        header: layout.header.height,
        tabs: layout.tabRows,
        scroll: layout.scroll.height,
        rulerBottom: layout.ruler.bottom,
        tabbarTop: layout.tabbar?.top ?? null,
      })}`)

      // 负向对照：注入旧实现，探针必须能抓到等级条被底栏遮住。
      if (scenario.name === 'phone-390x844') {
        await page.evaluate(`(() => {
          const style = document.createElement('style')
          style.id = 'techtree-negative-control'
          style.textContent = '.tt-scroll { flex: none !important; max-block-size: calc(100dvh - 220px) !important; }'
          document.head.append(style)
        })()`)
        const broken = await page.probe(layoutProbe)
        assert.ok(
          broken.ruler.bottom > broken.tabbar.top,
          `negative control: 旧 max-block-size 未被识别（ruler.bottom=${broken.ruler.bottom}, tabbar.top=${broken.tabbar.top}）`,
        )
        await page.evaluate(`document.getElementById('techtree-negative-control')?.remove()`)
        console.log(`[browser-techtree-layout] negative control PASS（旧实现 ruler.bottom=${broken.ruler.bottom} > tabbar.top=${broken.tabbar.top}）`)
      }
    } catch (error) {
      failures.push(`${scenario.name}: ${error.message}`)
    } finally {
      try { await cdp.client.send('Target.closeTarget', { targetId }) } catch { /* page already gone */ }
    }
  }
} finally {
  await cdp.close()
  await assets.close()
  await server.close()
}

if (failures.length) {
  console.error('[browser-techtree-layout] FAIL')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`[browser-techtree-layout] PASS ${SCENARIOS.length} scenarios`)
}