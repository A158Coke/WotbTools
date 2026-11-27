import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { startFixtureAssetPack } from './browser-fixtures/fixture-asset-pack.mjs'

const NATION = 'ussr'
const NODE_W = 216
const NODE_H = 96
const ROWS = 10
const COLS = 4

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
      tankCache[id] = {
        id, name: `Fixture ${y}-${x}`, tier: y, nation: NATION, type: 'mediumTank',
        is_premium: x === 2, is_collector: x === 1,
      }
      if (x > 1) edges.push({ from: `Fixture_${y}_${x - 1}`, to: stem, cost: { xp: 1000 * x } })
    }
  }
  tankCache[9200] = { id: 9200, name: 'Fixture China', tier: 8, nation: 'china', type: 'heavyTank', is_premium: false, is_collector: true }
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

const CATALOG_SCENARIOS = [
  { name: 'catalog-desktop', width: 1440, height: 900, touch: false, mode: 'inline' },
  { name: 'catalog-tablet-menu', width: 1024, height: 768, touch: false, mode: 'menu', profile: 'winter', locale: 'ru' },
  { name: 'catalog-phone-sheet', width: 390, height: 844, touch: true, mode: 'sheet', rotate: true },
  { name: 'catalog-short-landscape', width: 844, height: 390, touch: true, mode: 'sheet' },
]

async function catalogState(page, category, ids) {
  await page.waitForValue(`new URLSearchParams(location.search).get('category')`, value => value === category, { label: `category URL ${category}` })
  await page.waitForValue(`Array.from(document.querySelectorAll('[data-testid="tank-card"]'), card => card.dataset.tankId)`, value => JSON.stringify(value) === JSON.stringify(ids), { label: `catalog results ${ids}` })
}

async function assertCatalogIcons(page) {
  await page.waitFor(() => [...document.querySelectorAll('.catalog-icon img')].every(image => image.complete && image.naturalWidth > 0), { label: 'catalog icon images loaded' })
  const icons = await page.probe(() => [...document.querySelectorAll('.catalog-icon-crop')].map(crop => {
    const image = crop.querySelector('img')
    const rect = crop.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    return {
      source: image.currentSrc,
      width: rect.width,
      height: rect.height,
      expectedCropAspect: Number(getComputedStyle(crop).getPropertyValue('--catalog-image-aspect')),
      imageAspect: imageRect.width / imageRect.height,
      naturalAspect: image.naturalWidth / image.naturalHeight,
    }
  }))
  assert.ok(icons.some(icon => icon.source.includes('flag_tank-tree_china')), 'CN filter asset is present')
  assert.ok(icons.some(icon => icon.source.includes('flag_tank-tree_ussr')), 'client USSR icon is present')
  for (const icon of icons.filter(icon => icon.width > 0 && icon.height > 0)) {
    assert.ok(Math.abs(icon.width / icon.height - icon.expectedCropAspect) < 0.03, `visible icon crop distorted: ${icon.source}`)
    assert.ok(Math.abs(icon.imageAspect - icon.naturalAspect) < 0.03, `source image distorted: ${icon.source}`)
  }
}

async function saveCatalogScreenshot(page, name) {
  const directory = fileURLToPath(new URL('../../tmp/issue-973-catalog/', import.meta.url))
  await mkdir(directory, { recursive: true })
  const { data } = await page.client.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
  await writeFile(`${directory}/${name}.png`, Buffer.from(data, 'base64'))
}

async function nationKeyboardNavigation(page) {
  const visibleSelection = () => {
    const tabs = document.querySelector('.tt-tabs').getBoundingClientRect()
    const selected = document.querySelector('.tt-tabs [aria-selected="true"]').getBoundingClientRect()
    return selected.left >= tabs.left - 1 && selected.right <= tabs.right + 1
  }
  assert.equal(await page.probe(visibleSelection), true, 'initial URL nation is visible in horizontal navigation')
  await page.callWith(() => document.querySelector('.tt-tabs [aria-selected="true"]').focus())
  const press = async (key, code, virtualCode) => {
    for (const type of ['keyDown', 'keyUp']) {
      await page.client.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualCode, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, page.sessionId)
    }
  }
  await press('End', 'End', 35)
  await page.waitFor(() => document.activeElement?.dataset.nation === 'european', { label: 'End focuses final nation' })
  assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('nation')`), NATION, 'focus movement alone preserves selected nation')
  assert.equal(await page.evaluate(`document.querySelectorAll('.tt-tabs [tabindex="0"]').length`), 1, 'only focused nation is in the tab order')
  await press('Enter', 'Enter', 13)
  await page.waitForValue(`new URLSearchParams(location.search).get('nation')`, value => value === 'european', { label: 'Enter activates focused nation' })
  assert.equal(await page.probe(visibleSelection), true, 'newly selected nation stays in view')
  assert.equal(await page.evaluate(`document.querySelectorAll('.tt-tabs [tabindex="0"]').length`), 1, 'activation keeps one tab stop')
  await press('Home', 'Home', 36)
  await press('Enter', 'Enter', 13)
  await page.waitForValue(`new URLSearchParams(location.search).get('nation')`, value => value === NATION, { label: 'Home and Enter restore first nation' })
  await page.waitForValue('document.querySelectorAll(".tt-cell").length', count => count >= ROWS * COLS, { label: 'USSR tree restored after keyboard navigation' })
}

async function assertCatalogMenu(page, trigger) {
  const layout = await page.callWith(selector => {
    const panel = document.querySelector('.catalog-select')
    const trigger = document.querySelector(selector)
    return { background: getComputedStyle(panel).backgroundColor, panelWidth: panel.getBoundingClientRect().width, triggerWidth: trigger.getBoundingClientRect().width }
  }, trigger)
  assert.notEqual(layout.background, 'rgba(0, 0, 0, 0)', 'menu surface must be opaque')
  assert.notEqual(layout.background, 'transparent', 'menu surface must be opaque')
  assert.ok(layout.panelWidth >= layout.triggerWidth - 1, 'menu must be at least as wide as its trigger')
}

async function assertCatalogControls(page, label) {
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  await page.animationsSettled()
  await page.waitFor(() => [...document.querySelectorAll('.tank-catalog-menu .segmented-indicator')]
    .every(indicator => getComputedStyle(indicator).transform === 'none'), { label: 'catalog selection projection settled' })
  const clipped = await page.probe(() => [...document.querySelectorAll('.tank-catalog-menu button, .tank-catalog-menu summary, .tank-catalog-menu select')].filter(element => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const field = element.closest('.tp-field')?.getBoundingClientRect()
    return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1
      || (field && (rect.left < field.left - 1 || rect.right > field.right + 1))
  }).map(element => ({ text: element.textContent, width: element.clientWidth, scrollWidth: element.scrollWidth,
    indicators: [...element.querySelectorAll('.segmented-indicator')].map(indicator => getComputedStyle(indicator).transform) })))
  assert.deepEqual(clipped, [], `${label}: filter controls fit their fields and remain reachable`)
}

async function catalogScenario(page, scenario) {
  await page.waitForValue('document.querySelectorAll("[data-testid=tank-card]").length', count => count === 1, { label: `${scenario.name}: catalog ready` })
  await catalogState(page, 'collector', ['9128'])
  await page.animationsSettled()
  await assertCatalogControls(page, `${scenario.name} initial collector`)

  if (scenario.mode === 'inline') {
    assert.equal(await page.evaluate('document.querySelector("#tp-category [data-value=collector]")?.getAttribute("aria-checked")'), 'true')
    await assertCatalogIcons(page)
    await saveCatalogScreenshot(page, scenario.name)
    await page.tapSelector('#tp-category [data-value=premium]', false)
    await catalogState(page, 'premium', ['9129'])
    await page.tapSelector('#tp-category [data-value=collector]', false)
    await page.tapSelector('#tp-nation [data-value=china]', false)
    await catalogState(page, 'collector', ['9200'])
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('nation')`), 'china')
  } else if (scenario.mode === 'menu') {
    await page.tapSelector('#tp-nation', false)
    await page.waitFor(() => !!document.querySelector('[role="option"][data-state="checked"]'), { label: 'nation menu open' })
    await assertCatalogMenu(page, '#tp-nation')
    await assertCatalogIcons(page)
    await saveCatalogScreenshot(page, scenario.name)
    await page.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
    await page.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
    await page.waitFor(() => !document.querySelector('[role="option"]'), { label: 'nation menu closes on Escape' })
    assert.equal(await page.evaluate('document.activeElement?.id'), 'tp-nation', 'Escape returns focus to nation trigger')
    await page.tapSelector('#tp-category', false)
    await page.waitFor(() => !!document.querySelector('.catalog-select [role="option"]'), { label: 'category menu open' })
    await assertCatalogMenu(page, '#tp-category')
    await page.tapSelector('[role="option"][data-value=premium]', false)
    await catalogState(page, 'premium', ['9129'])
  } else {
    await page.tapSelector('[data-testid=tank-search]')
    await page.client.send('Input.insertText', { text: 'Fixture' }, page.sessionId)
    await page.waitForValue(`new URLSearchParams(location.search).get('q')`, value => value === 'Fixture', { label: 'search committed' })
    await page.tapSelector('[data-testid=filter-toggle]')
    await page.tapSelector('#tp-category summary')
    await page.tapSelector('#tp-category [data-value=premium]')
    await catalogState(page, 'premium', ['9129'])
    await page.tapSelector('#tp-nation summary')
    await assertCatalogIcons(page)
    await saveCatalogScreenshot(page, scenario.name)
    if (scenario.rotate) {
      await page.emulate({ width: 844, height: 390, touch: true })
      await page.animationsSettled()
      assert.equal(await page.evaluate('document.querySelector("[data-testid=tank-search]").value'), 'Fixture')
      await catalogState(page, 'premium', ['9129'])
    }
    await page.tapSelector('[data-testid=filter-sheet-done]')
    await page.waitFor(() => !document.querySelector('[role="dialog"]'), { label: 'filter sheet closed' })
    await catalogState(page, 'premium', ['9129'])
    assert.equal(await page.evaluate('document.querySelector("[data-testid=tank-search]").value'), 'Fixture')
    if (scenario.rotate) {
      await page.tapSelector('[data-testid=filter-toggle]')
      await page.emulate({ width: 1440, height: 900, touch: false })
      await page.waitFor(() => !document.querySelector('[role="dialog"]'), { label: 'sheet closes when rotating into wide layout' })
      await catalogState(page, 'premium', ['9129'])
      assert.equal(await page.evaluate('document.querySelector("[data-testid=tank-search]").value'), 'Fixture')
    }
  }
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `${scenario.name}: no horizontal overflow`)
  await assertCatalogControls(page, scenario.name)
  if (scenario.profile) {
    assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), scenario.profile, 'requested UI profile is active')
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'), 'light', 'winter renders the light theme')
    assert.equal(await page.evaluate('document.documentElement.lang'), scenario.locale, 'requested language is active')
  }
}

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
  const header = q('.techtree .showcase-hero.is-compact')
  const legacyHeader = q('.techtree .page-header')
  const tabs = q('.tt-tabs')
  // 竖屏卡片与网格节点共用 .tt-cell + data-testid（前者多一个 .tt-tier-cell），
  // 单一选择器同时覆盖两种形态；两种形态都必须看到封面布旗层。
  const icon = q('.tt-cell[data-testid="techtree-cell-Fixture_10_1"] .tt-card-icon')
  const coverImg = icon?.querySelector('.tank-cover-flag img')
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    header: rect(header),
    legacyHeader: rect(legacyHeader),
    tankopedia: rect(q('.techtree .showcase-hero-toolbar [data-testid="techtree-tankopedia"]')),
    tabs: rect(tabs),
    tabRows: tabs ? new Set([...tabs.children].map((element) => Math.round(element.getBoundingClientRect().top))).size : null,
    scroll: scroll ? { ...rect(scroll), clientHeight: scroll.clientHeight, scrollHeight: scroll.scrollHeight } : null,
    ruler: rect(ruler),
    tabBar: !!q('[data-testid="app-tab-bar"]'),
    cells: document.querySelectorAll('.tt-cell').length,
    tierRows: document.querySelectorAll('.tt-tier-row').length,
    iconFrame: rect(icon),
    // 坦克图是 .tt-card-icon 的直接子元素；:scope 避免命中 TankCoverNation 的布旗 img。
    iconImage: rect(icon?.querySelector(':scope > img')),
    iconCoverLoaded: !!coverImg && coverImg.complete && coverImg.naturalWidth > 0,
    typeFilter: rect(q('[data-testid="techtree-type-filter"]')),
    smallestCell: [...document.querySelectorAll('.tt-tier-cell')].reduce((min, el) => { const r = el.getBoundingClientRect(); return Math.min(min, r.height, r.width) }, Infinity),
  }
}

function assertScenario(scenario, layout) {
  const label = scenario.name
  assert.ok(layout.cells >= ROWS * COLS, `${label}: 科技树未完整渲染（cells=${layout.cells}）`)
  if (scenario.landscape) {
    assert.equal(layout.header.height, 0, `${label}: 矮横屏应隐藏分区主视觉（height=${layout.header.height}）`)
    assert.ok(
      layout.tankopedia && layout.tankopedia.height > 0,
      `${label}: 隐藏横幅后仍须保留「坦克百科」操作`,
    )
  } else {
    assert.ok(layout.header, `${label}: 缺少分区主视觉紧凑横幅`)
  }
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
    assert.equal(layout.ruler, null, `${label}: 竖屏不得渲染等级标尺`)
    assert.equal(layout.tierRows, ROWS, `${label}: 每个等级一行（rows=${layout.tierRows}）`)
    assert.equal(layout.tabRows, 1, `${label}: 国别页签必须单行横滑（rows=${layout.tabRows}）`)
    assert.ok(layout.typeFilter && layout.typeFilter.bottom <= layout.scroll.top + 1, `${label}: 车种分段必须在等级列表之上`)
    assert.ok(layout.smallestCell >= 44, `${label}: 坦克卡片触控尺寸不足（${layout.smallestCell}px）`)
    assert.deepEqual(layout.iconImage, layout.iconFrame, `${label}: 无裁剪变换的封面图应恰好填满自己的图标盒`)
    assert.ok(
      layout.header.height >= 88 && layout.header.height <= 112,
      `${label}: compact 横幅 ${layout.header.height}px 不在 88–112px 区间`,
    )
    assert.equal(layout.legacyHeader, null, `${label}: 不应再渲染 PageHeader`)
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
const topVehicle = tree.nodes.find(node => node.stem === 'Fixture_10_1')
const catalogSources = JSON.parse(readFileSync(
  fileURLToPath(new URL('../src/assets/tank-catalog/sources.json', import.meta.url)), 'utf8'))
const catalogRoutes = {}
for (const asset of Object.values(catalogSources.assets)) {
  if (!asset.remote) continue
  const [width, height] = asset.canvas
  catalogRoutes[asset.remote] = {
    type: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#789"/></svg>`,
  }
}
const assets = await startFixtureAssetPack({
  tankCache,
  extraRoutes: {
    ...catalogRoutes,
    [`/research/tech_tree/${NATION}.json`]: { type: 'application/json', body: JSON.stringify(tree) },
    '/tank_images/crops.json': { type: 'application/json', body: '{}' },
    [`/tank_images/${topVehicle.tankId}.webp`]: {
      type: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128"/></svg>',
    },
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
      // 封面布旗（TankCoverNation）是 .tt-card-icon 里第一个 img；坦克图取直接子 img，
      // fixture 坦克贴图 256×128、布旗画布 1024×512，两者都要等到加载完成再探针。
      await page.waitFor(() => {
        const img = document.querySelector('[data-testid="techtree-cell-Fixture_10_1"] .tank-cover-flag img')
        return !!img && img.complete && img.naturalWidth > 0
      }, { label: `${scenario.name}: cover flag loaded` })
      if (scenario.portrait) {
        await page.waitFor(() => document.querySelector('[data-testid="techtree-cell-Fixture_10_1"] .tt-card-icon > img')?.naturalWidth === 256,
          { label: `${scenario.name}: fixture cover loaded` })
      }
      const layout = await page.probe(layoutProbe)
      assertScenario(scenario, layout)
      if (scenario.name === 'phone-390x844') await nationKeyboardNavigation(page)
      console.log(`[browser-techtree-layout] ${scenario.name} PASS ${JSON.stringify({
        header: layout.header.height,
        tabs: layout.tabRows,
        scroll: layout.scroll.height,
        rulerBottom: layout.ruler?.bottom ?? null,
        tierRows: layout.tierRows,
      })}`)

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
      failures.push(`${scenario.name}: ${error.message}; ${(await page.diagnose()).join('; ')}`)
    } finally {
      try { await cdp.client.send('Target.closeTarget', { targetId }) } catch { /* page already gone */ }
    }
  }
  for (const scenario of CATALOG_SCENARIOS) {
    const { targetId, sessionId } = await cdp.openPage()
    const page = new Page(cdp.client, sessionId)
    try {
      await page.enable()
      await page.emulate(scenario)
      await cdp.client.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wotb-ui-profile',${JSON.stringify(scenario.profile ?? 'summer')});localStorage.setItem('wotb-lang',${JSON.stringify(scenario.locale ?? 'zh')});` }, sessionId)
      await page.goto(`${origin}/?view=agent-tankopedia&nation=${NATION}&tier=8&category=collector&assets=${encodeURIComponent(assets.origin)}`)
      await catalogScenario(page, scenario)
      console.log(`[browser-techtree-layout] ${scenario.name} PASS`)
    } catch (error) {
      failures.push(`${scenario.name}: ${error.message}; ${(await page.diagnose()).join('; ')}`)
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
  console.log(`[browser-techtree-layout] PASS ${SCENARIOS.length + CATALOG_SCENARIOS.length} scenarios`)
}
