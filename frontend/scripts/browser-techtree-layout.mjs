/**
 * 科技树 / compact 页头布局门禁（真实浏览器几何，不是源码正则）。
 *
 * 锁定的 invariant：
 * - 竖屏手机按等级从高到低一行一级（无等级标尺），页头一行（≤56px，DC-ARC-02），国别页签单行横滑；
 * - 外壳没有底部常驻栏（L1）：科技树滚动区与吸底等级条都停在视口底边之内；
 * - 矮横屏树视口至少约两行；平板 / 桌面等级条保持在滚动视口内；
 * - 任何形态都没有页面级横向溢出。
 *
 * 负向对照：在手机场景注入固定高度实现 `max-block-size: calc(100dvh + 120px)`，断言探针
 * 必须抓到「等级条落到视口外」——防止断言在旧 bug 上仍然变绿。
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
  { name: 'phone-390x844', width: 390, height: 844, touch: true, portrait: true },
  { name: 'phone-360x640', width: 360, height: 640, touch: true, portrait: true },
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
  const scroll = q('.tt-scroll') || q('.tt-tiers')
  const ruler = q('.tt-ruler')
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
    tabBar: !!q('[data-testid="app-tab-bar"]'),
    cells: document.querySelectorAll('.tt-cell').length,
    tierRows: document.querySelectorAll('.tt-tier-row').length,
    typeFilter: rect(q('[data-testid="techtree-type-filter"]')),
    smallestCell: [...document.querySelectorAll('.tt-tier-cell')].reduce((min, el) => { const r = el.getBoundingClientRect(); return Math.min(min, r.height, r.width) }, Infinity),
  }
}

function assertScenario(scenario, layout) {
  const label = scenario.name
  assert.ok(layout.cells >= ROWS * COLS, `${label}: 科技树未完整渲染（cells=${layout.cells}）`)
  assert.ok(layout.header, `${label}: 缺少 PageHeader`)
  assert.ok(layout.scroll, `${label}: 缺少树滚动区`)
  assert.equal(layout.tabBar, false, `${label}: 外壳不得渲染底部 Tab 栏（L1）`)
  assert.ok(
    layout.document.scrollWidth <= layout.viewport.width,
    `${label}: 页面横向溢出（scrollWidth=${layout.document.scrollWidth} > ${layout.viewport.width}）`,
  )
  assert.ok(
    layout.scroll.bottom <= layout.viewport.height + 1,
    `${label}: 树滚动区伸到视口外（scroll.bottom=${layout.scroll.bottom}, viewport=${layout.viewport.height}）`,
  )
  if (scenario.portrait) {
    // 竖屏手机：按等级从高到低一行一级，不渲染会压住节点的等级标尺；国家页签单行横滑 + 车种分段在滚动区之上
    assert.equal(layout.ruler, null, `${label}: 竖屏不得渲染等级标尺`)
    assert.equal(layout.tierRows, ROWS, `${label}: 每个等级一行（rows=${layout.tierRows}）`)
    assert.equal(layout.tabRows, 1, `${label}: 国别页签必须单行横滑（rows=${layout.tabRows}）`)
    assert.ok(layout.typeFilter && layout.typeFilter.bottom <= layout.scroll.top + 1, `${label}: 车种分段必须在等级列表之上`)
    assert.ok(layout.smallestCell >= 44, `${label}: 坦克卡片触控尺寸不足（${layout.smallestCell}px）`)
    assert.ok(layout.header.height <= 56, `${label}: compact 页头 ${layout.header.height}px 超过 DC-ARC-02 的 56px`)
    return
  }
  assert.ok(layout.ruler, `${label}: 缺少等级条`)
  assert.ok(
    layout.ruler.bottom <= layout.scroll.bottom + 1,
    `${label}: 等级条超出滚动视口（ruler.bottom=${layout.ruler.bottom}, scroll.bottom=${layout.scroll.bottom}）`,
  )
  assert.ok(
    layout.ruler.top >= layout.scroll.top - 1,
    `${label}: 等级条跑到滚动视口上方（ruler.top=${layout.ruler.top}, scroll.top=${layout.scroll.top}）`,
  )
  assert.ok(layout.ruler.bottom <= layout.viewport.height, `${label}: 等级条落到视口外（ruler.bottom=${layout.ruler.bottom}）`)
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
        rulerBottom: layout.ruler?.bottom ?? null,
        tierRows: layout.tierRows,
      })}`)

      // 负向对照：注入旧实现，探针必须能抓到等级条被底栏遮住。
      if (scenario.name === 'phone-landscape-740x360') {
        await page.evaluate(`(() => {
          const style = document.createElement('style')
          style.id = 'techtree-negative-control'
          style.textContent = '.tt-scroll { flex: none !important; max-block-size: calc(100dvh + 120px) !important; }'
          document.head.append(style)
        })()`)
        const broken = await page.probe(layoutProbe)
        assert.ok(
          broken.ruler.bottom > broken.viewport.height,
          `negative control: 固定 max-block-size 未被识别（ruler.bottom=${broken.ruler.bottom}, viewport=${broken.viewport.height}）`,
        )
        await page.evaluate(`document.getElementById('techtree-negative-control')?.remove()`)
        console.log(`[browser-techtree-layout] negative control PASS（ruler.bottom=${broken.ruler.bottom} > viewport=${broken.viewport.height}）`)
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