import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

const chrome = findChrome()
const cssPaths = [
  'src/styles/tokens/scale.css',
  'src/styles/playback-shared.css',
  'src/styles/playback-mobile.css',
  // Owns the square-Stage contract (`--pb-square-side`) and the Team 1 | Stage | Team 2 workspace.
  // Same position as in src/main.js: after the three form files, before the fullscreen refinements.
  'src/styles/playback-workspace.css',
]

// Native :fullscreen cannot be entered reliably from a file:// headless fixture without a user
// gesture. For geometry regression we use the production CSS verbatim except for replacing that
// single pseudo-class with a root marker. This still exercises the real cascade and browser layout.
const productionCss = cssPaths
  .map((path) => readFileSync(resolve(frontendRoot, path), 'utf8'))
  .join('\n')
  .replaceAll(':fullscreen', '.pb-test-fullscreen')
const rasterDensityUrl = pathToFileURL(resolve(frontendRoot, 'src/utils/mapRasterDensity.js')).href
const battleMapSource = readFileSync(resolve(frontendRoot, 'src/components/BattleMap.vue'), 'utf8')
const battlePlaybackSource = readFileSync(resolve(frontendRoot, 'src/components/BattlePlayback.vue'), 'utf8')
if (!battleMapSource.includes('screenOffsetToSvgDelta(offset, props.mapView, renderedFrame)')
  || /offset\.[xy]\s*\/\s*(scale|viewScale)/.test(battleMapSource)
  || !battlePlaybackSource.includes('const renderedMapFrame = computed(() =>')
  || !battlePlaybackSource.includes(':rendered-frame="renderedMapFrame"')) {
  throw new Error('BattleMap leader-line production wiring must use the rendered SVG frame contract')
}
const faustAssetUrl = pathToFileURL(resolve(frontendRoot, 'src/assets/maps/faust.webp')).href

const scenarios = [
  { name: 'pc-1600x900', form: 'pc', width: 1600, height: 900, check: 'pc' },
  { name: 'tablet-1024x768', form: 'tablet', width: 1024, height: 768, check: 'tablet' },
  { name: 'mobile-390x844', form: 'mobile', width: 390, height: 844, check: 'mobile' },
  { name: 'phone-landscape-740x360', form: 'mobile', width: 740, height: 360, check: 'wide' },
  { name: 'phone-landscape-844x390', form: 'mobile', width: 844, height: 390, check: 'wide' },
  { name: 'wide-fullscreen-1792x922', form: 'pc', width: 1792, height: 922, check: 'wide', fullscreen: true },
  // Form differences must not override the shared geometry.
  { name: 'pc-isolated-at-1024', form: 'pc', width: 1024, height: 768, check: 'pc-isolated' },
  // Real raster frame guard: intentionally non-square logical dimensions must remain the shared
  // frame for the basemap img, overlay SVG and marker layer.
  { name: 'raster-frame-source', form: 'pc', width: 1280, height: 900, check: 'raster' },
  // Real leader-line geometry guard: a 4x layout-scaled, non-square SVG frame must preserve the
  // same 20px screen displacement as the HTML marker on a mobile-sized visible map frame.
  { name: 'leader-line-non-1-to-1', form: 'mobile', width: 390, height: 844, check: 'leader' },

  // Fullscreen changes capacity while retaining the shared three-row battlefield contract.
  { name: 'pc-fullscreen-side-slots', form: 'pc', width: 1920, height: 900, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  { name: 'tablet-fullscreen-side-slots', form: 'tablet', width: 1180, height: 320, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  // Mobile production JS no longer enables sideSlots, but force the stale class defensively: even if
  // it survives a responsive transition, the form contract must keep HUD top + controller bottom.
  { name: 'mobile-fullscreen-forced-side-slots', form: 'mobile', width: 882, height: 344, check: 'fullscreen-mobile', fullscreen: true, sideSlots: true, controlsInRail: false, controlsVisible: true },
]

function fixtureHtml(scenario) {
  const fullscreen = !!scenario.fullscreen
  const lanes = !['mobile', 'raster', 'leader'].includes(scenario.check)
  const rootClasses = [
    'battle-playback',
    'playback-workspace',
    `pb-form-${scenario.form}`,
    lanes ? 'pb-roster-lanes' : '',
    fullscreen ? 'pb-test-fullscreen' : '',
    scenario.sideSlots ? 'pb-side-slots' : '',
  ].filter(Boolean).join(' ')
  const overlayClasses = [
    'pb-mobile-overlay',
    scenario.form === 'mobile' && fullscreen ? 'pb-mobile-overlay-transient' : '',
    scenario.controlsVisible ? 'pb-mobile-overlay-visible' : '',
  ].filter(Boolean).join(' ')
  const controlsMarkup = '<div class="pb-controls"><button class="pb-btn">-5</button><button class="pb-btn">play</button><button class="pb-btn">+5</button><button class="pb-btn">1×</button><button class="pb-btn">fullscreen</button><button class="pb-btn">gear</button></div><span class="pb-time">00:12 / 01:00</span>'
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg:#111; --bg-card:#181818; --bg-card2:#202020; --border:#444; --border-ghost:#333;
    --text:#eee; --text-label:#ddd; --text-muted:#aaa; --accent:#d18b2c; --accent-dark:#f0a23a;
    --surface-shadow:none; --z-modal:80;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  body { background: #111; }
  .battle-playback { width: 100%; }
  .pb-hud { min-height: 52px; }
  .pb-hud-grid { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:12px; width:100%; }
  .pb-hud-team { min-width:0; }
  .pb-hud-track { display:block; height:8px; background:#555; }
  .pb-main { width: 100%; }
  .pb-map-stage { width: 100%; }
  .pb-map { position:relative; width:100%; height:100%; min-width:0; min-height:1px; overflow:hidden; background:#090909; }
  .pb-viewport { position:absolute; left:0; top:0; width:100%; aspect-ratio:1 / 1; transform-origin:0 0; background:#2b3b2b; }
  .pb-basemap, .pb-svg { position:absolute; inset:0; display:block; width:100%; height:100%; }
  .pb-basemap { object-fit:fill; }
  .pb-markers { position:absolute; inset:0; pointer-events:none; }
  .pb-marker { position:absolute; width:20px; height:20px; transform:translate(-50%,-50%); border-radius:50%; background:#f00; }
  .pb-marker-leader { stroke:#aaa; stroke-width:1; }
  .pb-mobile-overlay-content { min-height:72px; }
  .pb-controls { display: flex; justify-content: center; gap: 4px; }
  .pb-btn { min-width:44px; min-height:44px; }

  /* Relevant scoped PlaybackMobileOverlay geometry. The global form contract below has the same
     production specificity relationship to these rules as it does in the app bundle. */
  .pb-mobile-overlay-transient { position:absolute; inset:0; z-index:25; pointer-events:none; opacity:0; }
  .pb-mobile-overlay-transient.pb-mobile-overlay-visible { opacity:1; }
  .pb-mobile-overlay-transient .pb-mobile-overlay-content { position:absolute; right:8px; bottom:8px; left:8px; display:none; pointer-events:none; }
  .pb-mobile-overlay-transient.pb-mobile-overlay-visible .pb-mobile-overlay-content { display:grid; pointer-events:auto; }

${productionCss}
</style>
</head>
<body>
<div id="root" class="${rootClasses}">
    <main class="pb-main">
  <section class="pb-hud">
    <div class="pb-hud-grid">
      <div class="pb-hud-team pb-hud-column-friendly">Friendly HP<span class="pb-hud-track"></span></div>
      <div class="pb-hud-center pb-hud-column-center">A · B</div>
      <div class="pb-hud-team pb-hud-enemy pb-hud-column-enemy">Enemy HP<span class="pb-hud-track"></span></div>
    </div>
  </section>
    ${lanes ? '<aside class="pb-team-lane pb-team-lane-left">Team 1</aside><aside class="pb-team-lane pb-team-lane-right">Team 2</aside>' : ''}
    <div class="pb-map-stage">
      <div class="pb-map"${scenario.check === 'leader' ? ' style="width:390px;height:387px"' : ''}><div class="pb-viewport"${scenario.check === 'raster' ? ' style="aspect-ratio:769 / 763"' : scenario.check === 'leader' ? ' style="width:400%;aspect-ratio:769 / 763;transform:translate(-585px,-580.5px)"' : ''}>
        ${scenario.check === 'raster' ? `<img class="pb-basemap" data-test="pb-basemap" src="${faustAssetUrl}" alt=""><svg class="pb-svg" viewBox="0 0 769 763"><rect x="0" y="0" width="769" height="763"></rect></svg><div class="pb-markers" data-test="pb-markers"></div>` : scenario.check === 'leader' ? `<svg class="pb-svg" viewBox="0 0 769 763"><line class="pb-marker-leader" x1="384.5" y1="381.5" x2="384.5" y2="381.5"></line></svg><div class="pb-markers"><div class="pb-marker" style="left:calc(50% + 20px);top:calc(50% - 16px)"></div></div>` : ''}
      </div></div>
    </div>
    <div class="${overlayClasses}"><div class="pb-mobile-overlay-content">${controlsMarkup}</div></div>
  </main>
</div>
<script type="module">
import { mapRasterDensity } from ${JSON.stringify(rasterDensityUrl)}

// This module script is deferred by HTML and the load event waits for its module graph to finish.
// Publish the geometry result synchronously during module evaluation so Chrome --dump-dom
// cannot serialize the page between load and a queued requestAnimationFrame callback.
{
    const root = document.getElementById('root')
    const stage = root.querySelector('.pb-map-stage')
    const map = root.querySelector('.pb-map')
    const viewport = root.querySelector('.pb-viewport')
    const hud = root.querySelector('.pb-hud')
    const overlayContent = root.querySelector('.pb-mobile-overlay-content')
    const button = root.querySelector('.pb-btn')
    root.style.setProperty('--pb-workspace-h', innerHeight + 'px')
    root.style.setProperty('--pb-square-avail-h', Math.max(1, innerHeight - hud.getBoundingClientRect().height - overlayContent.getBoundingClientRect().height - 8) + 'px')
    const rootStyle = getComputedStyle(root)
    const stageStyle = getComputedStyle(stage)
    const buttonStyle = button ? getComputedStyle(button) : null
    const failures = []
    let metrics = null
    const require = (ok, message) => { if (!ok) failures.push(message) }

    if (${JSON.stringify(lanes)}) {
      const main = root.querySelector('.pb-main').getBoundingClientRect()
      const left = root.querySelector('.pb-team-lane-left').getBoundingClientRect()
      const right = root.querySelector('.pb-team-lane-right').getBoundingClientRect()
      const mapRect = map.getBoundingClientRect()
      const controlsRect = overlayContent.getBoundingClientRect()
      const centerWidth = right.left - left.right - 8
      const availableHeight = innerHeight - hud.getBoundingClientRect().height - controlsRect.height - 8
      require(left.right <= mapRect.left && right.left >= mapRect.right, 'physical lanes must flank the Stage')
      require(Math.abs(mapRect.width - mapRect.height) <= 1, 'wide Stage must remain square')
      require(mapRect.width >= Math.min(centerWidth, availableHeight) - 2, 'Stage must maximize the available square')
      require(controlsRect.top >= mapRect.bottom - 1 && controlsRect.top - mapRect.bottom <= 8, 'transport must sit tightly below Stage')
      metrics = {
        laneWidth: left.width,
        laneRight: right.width,
        stageSide: mapRect.width,
        centerWidth,
        availableHeight,
        gridColumns: rootStyle.gridTemplateColumns,
        laneToken: rootStyle.getPropertyValue('--pb-lane-w').trim(),
        hudWidth: hud.getBoundingClientRect().width,
        hudLeft: hud.getBoundingClientRect().left,
        hudRight: hud.getBoundingClientRect().right,
        mainWidth: main.width,
        mainRight: main.right,
      }
    }
    if (['pc', 'tablet'].includes(${JSON.stringify(scenario.check)})) {
      const mapRect = map.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      require(rootStyle.display === 'flex', 'workspace root owns shared HUD/center stack')
      require(stageStyle.display === 'block', 'Stage must not reserve an obsolete details column')
      require(Math.abs(mapRect.width - mapRect.height) <= 1, 'battlefield must remain square')
      require(stageRect.height <= innerHeight, 'stage must remain viewport-bounded')
    }
    if (${JSON.stringify(scenario.check)} === 'mobile') {
      require(rootStyle.display === 'flex', 'mobile root must retain flow layout when not fullscreen')
      // 车辆详情不再住在 Stage 里（它是 workspace 浮窗 / 纵向流内容块），Stage 不需要裁剪浮层；
      // 这里锁的是正方形契约：竖屏 Stage 用满列宽、宽高相等。
      const mapRect = map.getBoundingClientRect()
      require(mapRect.width > 0 && Math.abs(mapRect.width - mapRect.height) <= 1, 'mobile portrait map must be a square')
      require(mapRect.width <= innerWidth + 0.5, 'mobile portrait square must fit the viewport width')
      require(buttonStyle && parseFloat(buttonStyle.minWidth) >= 44 && parseFloat(buttonStyle.minHeight) >= 44,
        'fixture controls must retain their intrinsic size')
    }
    if (${JSON.stringify(scenario.check)} === 'pc-isolated') {
      require(stageStyle.display !== 'grid', 'PC form at 1024px must not receive tablet grid rules')
    }

    if (${JSON.stringify(scenario.check)} === 'raster') {
      const basemap = root.querySelector('[data-test="pb-basemap"]')
      const svg = root.querySelector('.pb-svg')
      const markers = root.querySelector('[data-test="pb-markers"]')
      if (basemap && !basemap.complete) {
        await new Promise(resolve => {
          basemap.addEventListener('load', resolve, { once: true })
          basemap.addEventListener('error', resolve, { once: true })
        })
      }
      require(basemap && basemap.complete && basemap.naturalWidth > 0 && basemap.naturalHeight > 0, 'source basemap must decode successfully')
      require(svg && !svg.querySelector('image'), 'overlay SVG must not contain a raster image')
      const fitRect = basemap?.getBoundingClientRect()
      const fitDensity = mapRasterDensity({
        naturalWidth: basemap?.naturalWidth,
        naturalHeight: basemap?.naturalHeight,
        renderedCssWidth: fitRect?.width,
        renderedCssHeight: fitRect?.height,
        viewScale: 1,
        devicePixelRatio,
      })
      require(fitDensity && fitDensity.effectiveSourcePxPerDevicePx > 0, 'fit raster density must be measurable')
      const frame = (label) => {
        const rects = [basemap, svg, markers].map(element => element?.getBoundingClientRect())
        const [first, ...rest] = rects
        require(first && rest.every(rect => rect && Math.abs(rect.left - first.left) < 0.5 && Math.abs(rect.top - first.top) < 0.5 && Math.abs(rect.width - first.width) < 0.5 && Math.abs(rect.height - first.height) < 0.5), 'frame ' + label + ': basemap/SVG/markers must share one frame')
      }
      frame('fit')
      const viewport = root.querySelector('.pb-viewport')
      viewport.style.width = '400%'
      viewport.style.transform = 'translate(0px,0px)'
      frame('4x')
      const zoomRect = basemap?.getBoundingClientRect()
      const zoomDensity = mapRasterDensity({
        naturalWidth: basemap?.naturalWidth,
        naturalHeight: basemap?.naturalHeight,
        renderedCssWidth: fitRect?.width,
        renderedCssHeight: fitRect?.height,
        viewScale: 4,
        devicePixelRatio,
      })
      require(zoomDensity && zoomDensity.requiredDeviceWidth > (fitDensity?.requiredDeviceWidth || 0), '4x raster density must account for camera scale')
      require(zoomRect && zoomRect.width > (fitRect?.width || 0), '4x raster frame must be larger than fit frame')
    }

    if (${JSON.stringify(scenario.check)} === 'leader') {
      const logical = { W: 769, H: 763 }
      const offset = { x: 20, y: -16 }
      const svg = root.querySelector('.pb-svg')
      const line = root.querySelector('.pb-marker-leader')
      const marker = root.querySelector('.pb-marker')
      const visibleRect = map.getBoundingClientRect()
      const renderedRect = svg?.getBoundingClientRect()
      const delta = renderedRect && renderedRect.width > 0 && renderedRect.height > 0
        ? {
            x: offset.x * logical.W / renderedRect.width,
            y: offset.y * logical.H / renderedRect.height,
          }
        : null
      require(delta, 'leader-line SVG delta must be measurable')
      const canonical = { x: logical.W / 2, y: logical.H / 2 }
      const x2 = canonical.x + (delta?.x || 0)
      const y2 = canonical.y + (delta?.y || 0)
      line?.setAttribute('x2', String(x2))
      line?.setAttribute('y2', String(y2))
      const markerRect = marker?.getBoundingClientRect()
      const endpoint = renderedRect ? {
        x: renderedRect.left + x2 * renderedRect.width / logical.W,
        y: renderedRect.top + y2 * renderedRect.height / logical.H,
      } : null
      const markerCenter = markerRect ? {
        x: markerRect.left + markerRect.width / 2,
        y: markerRect.top + markerRect.height / 2,
      } : null
      const pixelDelta = endpoint && markerCenter ? {
        x: endpoint.x - markerCenter.x,
        y: endpoint.y - markerCenter.y,
      } : null
      require(renderedRect && Math.abs(renderedRect.width - visibleRect.width * 4) < 0.5,
        'leader-line fixture must use a 4x rendered SVG frame')
      require(markerCenter && endpoint && Math.abs(pixelDelta.x) <= 0.5 && Math.abs(pixelDelta.y) <= 0.5,
        'leader endpoint must match visible marker center within 0.5 CSS px')
      metrics = {
        logical,
        visibleCss: { width: visibleRect.width, height: visibleRect.height },
        renderedSvgCss: { width: renderedRect?.width, height: renderedRect?.height },
        viewScale: 4,
        presentationOffset: offset,
        markerCenter,
        leaderEndpoint: endpoint,
        pixelDelta,
      }
    }

    if (${JSON.stringify(fullscreen)}) {
      const hudRectBefore = hud.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const contentRectBefore = overlayContent.getBoundingClientRect()
      const overlayWrapRectBefore = root.querySelector('.pb-mobile-overlay').getBoundingClientRect()
      const mapRectBefore = map.getBoundingClientRect()
      // HUD and transport occupy their own grid rows outside Stage. Camera safe insets are zero.
      const top = 0
      const bottom = 0
      const safeH = Math.max(1, stageRect.height - top - bottom)
      const naturalW = mapRectBefore.width
      const naturalH = naturalW
      const scale = Math.min(1, safeH / naturalH) * 0.98
      const tx = (mapRectBefore.width - naturalW * scale) / 2
      const ty = top + (safeH - naturalH * scale) / 2
      viewport.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'

      const hudRect = hud.getBoundingClientRect()
      const mapRect = map.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      const overlayRect = overlayContent.getBoundingClientRect()
      const horizontalOverlap = Math.max(0, Math.min(hudRect.right, mapRect.right) - Math.max(hudRect.left, mapRect.left))

      require(hudRect.width > hudRect.height * 3, 'fullscreen HUD must remain horizontal, not a side rail')
      require(horizontalOverlap >= Math.min(hudRect.width, mapRect.width) * 0.5,
        'fullscreen HUD must remain attached horizontally to the map workspace')
      require(viewportRect.top >= hudRect.bottom - 1,
        'fitted map viewport must start below the visible top HUD')
      require(viewportRect.bottom <= stageRect.bottom + 1,
        'fitted map viewport must remain inside the fullscreen stage')

      if (${JSON.stringify(scenario.form === 'mobile' && !!scenario.controlsVisible)}) {
        require(overlayRect.height > 0, 'visible mobile controller must have measurable height')
        require(viewportRect.bottom <= overlayRect.top + 1,
          'fitted mobile map viewport must not sit underneath visible bottom controls'
            + ' (viewport=' + JSON.stringify(viewportRect) + ' controls=' + JSON.stringify(overlayRect) + ' stage=' + JSON.stringify(stageRect) + ')')
        require(getComputedStyle(root.querySelector('.pb-mobile-overlay')).width !== getComputedStyle(root).getPropertyValue('--pb-slot-w').trim(),
          'mobile controller must not become a permanent side-slot rail (the side-slot contract is gone, so this must always hold)')
      }
    }

    require(document.documentElement.scrollWidth <= innerWidth + 1, 'layout must not create page-level horizontal overflow')
    const result = { name: ${JSON.stringify(scenario.name)}, width: innerWidth, height: innerHeight, failures, metrics }
    document.body.dataset.result = btoa(JSON.stringify(result))
}
</script>
</body>
</html>`
}

// 设备指标走 CDP `Emulation.setDeviceMetricsOverride`，不是 `--window-size`：headless Chrome 的窗口
// 有最小宽度（实测 500px），`--window-size=390,844` 会被静默放大成 500×757，「手机竖屏」用例于是
// 跑在一个根本不是手机竖屏的视口上还报 OK。这里要求页面实测的 innerWidth/innerHeight 与请求一致，
// 否则直接失败——不允许把一个回退过的视口算作该形态的覆盖。
const temp = mkdtempSync(resolve(tmpdir(), 'wotb-playback-browser-'))
const browser = await launchChromeForCdp(chrome, { extraArgs: ['--allow-file-access-from-files', '--run-all-compositor-stages-before-draw'] })
const geometryByName = new Map()
try {
  for (const scenario of scenarios) {
    const htmlPath = resolve(temp, `${scenario.name}.html`)
    writeFileSync(htmlPath, fixtureHtml(scenario), 'utf8')
    const { targetId, sessionId } = await browser.openPage()
    const page = new Page(browser.client, sessionId)
    await page.enable()
    await page.emulate({ width: scenario.width, height: scenario.height, touch: false, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlPath).href)
    const encoded = await page.waitForValue('document.body && document.body.dataset.result', (value) => !!value,
      { label: `${scenario.name} result` })
    await browser.client.send('Target.closeTarget', { targetId })
    const result = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    if (result.width !== scenario.width || result.height !== scenario.height) {
      throw new Error(`${scenario.name}: requested ${scenario.width}x${scenario.height} but the page measured ${result.width}x${result.height}`)
    }
    if (result.failures.length) {
      throw new Error(`${scenario.name}:\n- ${result.failures.join('\n- ')}`)
    }
    geometryByName.set(scenario.name, result.metrics)
    console.log(`[browser-layout] ${scenario.name} OK (${result.width}x${result.height})${result.metrics ? ` ${JSON.stringify(result.metrics)}` : ''}`)
  }
  const tablet = geometryByName.get('tablet-1024x768')
  const desktop = geometryByName.get('pc-1600x900')
  const fullscreen = geometryByName.get('wide-fullscreen-1792x922')
  const phoneLandscape = geometryByName.get('phone-landscape-844x390')
  if (!(tablet.laneWidth < desktop.laneWidth && Math.abs(fullscreen.laneWidth - desktop.laneWidth) <= 1)) {
    throw new Error('Roster lanes must grow with workspace width then stop at the shared maximum')
  }

  // —— 横向空间归属：bounded roster | fluid center | bounded roster ——
  //
  // 用比例 / 恒等式而不是像素宽度做验收：断点只决定形态，尺寸由剩余空间连续决定，
  // 所以「center 吃掉多少剩余空间」才是要锁的契约，具体 px 会随上述设计自由调整。
  const ROSTER_MAX_PX = 11 * 16 // --pb-roster-max（tokens/scale.css 的 SSOT 值）
  const LANE_GAP_PX = 8 // --space-2：三栏之间的 gutter，由 --space-* token 决定
  const contractFailures = []
  const requireContract = (ok, message) => { if (!ok) contractFailures.push(message) }

  for (const [name, metrics] of geometryByName) {
    if (!metrics?.hudWidth) continue // 非三栏场景（mobile portrait / raster / leader）不参与
    const label = `${name}: lane=${metrics.laneWidth} center=${metrics.centerWidth} stage=${metrics.stageSide}`
    // roster 必须 bounded，且左右对称
    requireContract(metrics.laneWidth <= ROSTER_MAX_PX + 0.5, `roster lane must stay bounded by --pb-roster-max: ${label}`)
    requireContract(Math.abs(metrics.laneWidth - metrics.laneRight) <= 0.5, `both lanes must share one bounded width: ${label}`)
    // center 必须吃掉**全部**剩余宽度：等于 整宽 − 两条 lane − 两条 gutter。
    // 这条恒等式才是「center 没有额外 max-width / 固定宽度 / 多余 margin」的直接证据。
    // 注意 `centerWidth` 量的是 right.left − left.right − LANE_GAP_PX：右 lane 的 gutter
    // 已经内含在这段距离里，所以再减一条就重复了。
    const expectedCenter = metrics.mainWidth - 2 * metrics.laneWidth - LANE_GAP_PX
    requireContract(Math.abs(metrics.centerWidth - expectedCenter) <= 1,
      `center column must consume all remaining width (expected ${expectedCenter}): ${label}`)
    // center 明显宽于单侧 roster，且 Stage 不超出它
    requireContract(metrics.centerWidth >= metrics.laneWidth * 2.5,
      `center battlefield must dominate the bounded lanes: ${label}`)
    requireContract(metrics.stageSide <= metrics.centerWidth + 0.5, `Stage must fit inside the center column: ${label}`)
    // HUD 属于整个 center column，而不是按内容收缩成中间小块
    requireContract(Math.abs(metrics.hudWidth - metrics.centerWidth) <= 1,
      `HUD must span the whole center column (hud=${metrics.hudWidth} center=${metrics.centerWidth}): ${label}`)
    // center 横向居中，且不产生水平溢出
    requireContract(Math.abs((metrics.hudLeft + metrics.hudRight) / 2 - metrics.mainWidth / 2) <= 1,
      `center column must stay centered: ${label}`)
    requireContract(metrics.stageSide <= metrics.availableHeight + 1,
      `Stage must never exceed the measured vertical budget: ${label}`)
  }

  // 大屏新增的宽度只应归 center：roster 到顶后不再膨胀
  requireContract(Math.abs(desktop.laneWidth - fullscreen.laneWidth) <= 1,
    `roster must not grow past its maximum on larger viewports: desktop=${desktop.laneWidth} fullscreen=${fullscreen.laneWidth}`)
  requireContract(fullscreen.centerWidth - desktop.centerWidth > 100,
    `extra wide-viewport width must go to the center column: desktop=${desktop.centerWidth} fullscreen=${fullscreen.centerWidth}`)
  // 短横屏（844x390）与平板仍保持三栏 + 可读 roster
  requireContract(phoneLandscape.centerWidth > phoneLandscape.stageSide,
    `phone landscape center must remain the widest column: ${JSON.stringify(phoneLandscape)}`)
  requireContract(tablet.laneWidth >= 9 * 16 - 0.5,
    `tablet roster must keep its readable floor (--pb-roster-min): ${tablet.laneWidth}`)

  if (contractFailures.length) {
    throw new Error(`workspace column ownership contract:\n- ${contractFailures.join('\n- ')}`)
  }
} finally {
  await browser.close()
  rmSync(temp, { recursive: true, force: true })
}
