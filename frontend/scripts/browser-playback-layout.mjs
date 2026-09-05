import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ].filter(Boolean)
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' })
    if (probe.status === 0) return candidate
  }
  throw new Error(`Chrome/Chromium executable not found; tried: ${candidates.join(', ')}`)
}

const chrome = findChrome()
const cssPaths = [
  'src/styles/playback-shared.css',
  'src/styles/playback-pc.css',
  'src/styles/playback-tablet.css',
  'src/styles/playback-mobile.css',
  'src/styles/playback-mobile-fullscreen.css',
  // Must remain last: this owns battle-HUD placement across form-specific fullscreen rules.
  'src/styles/playback-fullscreen-form-contract.css',
]

// Native :fullscreen cannot be entered reliably from a file:// headless fixture without a user
// gesture. For geometry regression we use the production CSS verbatim except for replacing that
// single pseudo-class with a root marker. This still exercises the real cascade and browser layout.
const productionCss = cssPaths
  .map((path) => readFileSync(resolve(frontendRoot, path), 'utf8'))
  .join('\n')
  .replaceAll(':fullscreen', '.pb-test-fullscreen')
const safeInsetsUrl = pathToFileURL(resolve(frontendRoot, 'src/utils/playbackSafeInsets.js')).href
const rasterDensityUrl = pathToFileURL(resolve(frontendRoot, 'src/utils/mapRasterDensity.js')).href
const hdManifest = JSON.parse(readFileSync(resolve(frontendRoot, 'src/assets/maps-hd/manifest.json'), 'utf8'))
const faustManifestEntry = hdManifest.entries.find(entry => entry.enhanced.endsWith('/faust.webp'))
if (!faustManifestEntry) throw new Error('faust.webp is missing from maps-hd manifest')
const faustAssetUrl = pathToFileURL(resolve(frontendRoot, 'src/assets/maps-hd/faust.webp')).href

const scenarios = [
  { name: 'pc-1600x900', form: 'pc', width: 1600, height: 900, check: 'pc' },
  { name: 'tablet-1024x768', form: 'tablet', width: 1024, height: 768, check: 'tablet' },
  { name: 'mobile-390x844', form: 'mobile', width: 390, height: 844, check: 'mobile' },
  // Structural isolation: a PC form at tablet width must not accidentally receive tablet geometry.
  { name: 'pc-isolated-at-1024', form: 'pc', width: 1024, height: 768, check: 'pc-isolated' },
  // Real raster frame guard: intentionally non-square logical dimensions must remain the shared
  // frame for the HD img, overlay SVG and marker layer.
  { name: 'raster-frame-hd', form: 'pc', width: 1280, height: 900, check: 'raster' },

  // Real browser geometry guards for the regression behind PR #248. sideSlots is forced on the
  // class for CSS-cascade coverage; production JS only enables it when the measured gutter qualifies.
  { name: 'pc-fullscreen-side-slots', form: 'pc', width: 1920, height: 900, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  { name: 'tablet-fullscreen-side-slots', form: 'tablet', width: 1180, height: 320, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  // Mobile production JS no longer enables sideSlots, but force the stale class defensively: even if
  // it survives a responsive transition, the form contract must keep HUD top + controller bottom.
  { name: 'mobile-fullscreen-forced-side-slots', form: 'mobile', width: 882, height: 344, check: 'fullscreen-mobile', fullscreen: true, sideSlots: true, controlsInRail: false, controlsVisible: true },
]

function fixtureHtml(scenario) {
  const fullscreen = !!scenario.fullscreen
  const rootClasses = [
    'battle-playback',
    `pb-form-${scenario.form}`,
    fullscreen ? 'pb-test-fullscreen' : '',
    scenario.sideSlots ? 'pb-side-slots' : '',
  ].filter(Boolean).join(' ')
  const overlayClasses = [
    'pb-mobile-overlay',
    scenario.form === 'mobile' && fullscreen ? 'pb-mobile-overlay-transient' : '',
    scenario.controlsVisible ? 'pb-mobile-overlay-visible' : '',
  ].filter(Boolean).join(' ')
  const controlsInRail = !!scenario.controlsInRail
  const controlsMarkup = '<div class="pb-controls"><button class="pb-btn">play</button><button class="pb-btn">-5</button><button class="pb-btn">+5</button><div class="pb-speed"><button class="pb-btn">1×</button></div><span class="pb-time">00:12 / 01:00</span></div>'
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
  .pb-left-rail { min-height: 160px; }
  .pb-main { width: 100%; }
  .pb-map-stage { width: 100%; }
  .pb-map { position:relative; width:100%; height:100%; min-width:0; min-height:1px; overflow:hidden; background:#090909; }
  .pb-viewport { position:absolute; left:0; top:0; width:100%; aspect-ratio:1 / 1; transform-origin:0 0; background:#2b3b2b; }
  .pb-basemap, .pb-svg { position:absolute; inset:0; display:block; width:100%; height:100%; }
  .pb-basemap { object-fit:fill; }
  .pb-markers { position:absolute; inset:0; pointer-events:none; }
  .pb-side-panel-shell { min-width:0; min-height:0; }
  .pb-sidebar, .pb-side-panel { min-height:120px; }
  .pb-mobile-overlay-content { min-height:72px; }
  .pb-btn { min-width:36px; min-height:36px; }

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
  <section class="pb-hud">
    <div class="pb-hud-grid">
      <div class="pb-hud-team pb-hud-column-friendly">Friendly HP<span class="pb-hud-track"></span></div>
      <div class="pb-hud-center pb-hud-column-center">A · B</div>
      <div class="pb-hud-team pb-hud-enemy pb-hud-column-enemy">Enemy HP<span class="pb-hud-track"></span></div>
    </div>
  </section>
  <aside class="pb-left-rail"><button class="pb-rail-collapse">rail</button>${controlsInRail ? controlsMarkup : ''}</aside>
    <main class="pb-main">
    <div class="pb-map-stage">
      <div class="pb-map"><div class="pb-viewport"${scenario.check === 'raster' ? ' style="aspect-ratio:769 / 763"' : ''}>
        ${scenario.check === 'raster' ? `<img class="pb-basemap" data-test="pb-basemap" src="${faustAssetUrl}" alt=""><svg class="pb-svg" viewBox="0 0 769 763"><rect x="0" y="0" width="769" height="763"></rect></svg><div class="pb-markers" data-test="pb-markers"></div>` : ''}
      </div></div>
      <div class="pb-side-panel-shell pb-details-active">
        <div class="pb-sidebar">details</div>
        <div class="pb-side-panel">panel</div>
      </div>
    </div>
    <div class="${overlayClasses}"><div class="pb-mobile-overlay-content">${controlsInRail ? '' : controlsMarkup}</div></div>
  </main>
</div>
<script type="module">
import { playbackSafeInsetOwnership } from ${JSON.stringify(safeInsetsUrl)}
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
    const shell = root.querySelector('.pb-side-panel-shell')
    const rail = root.querySelector('.pb-left-rail')
    const overlayContent = root.querySelector('.pb-mobile-overlay-content')
    const button = root.querySelector('.pb-btn')
    const rootStyle = getComputedStyle(root)
    const stageStyle = getComputedStyle(stage)
    const buttonStyle = button ? getComputedStyle(button) : null
    const failures = []
    const require = (ok, message) => { if (!ok) failures.push(message) }

    if (${JSON.stringify(scenario.check)} === 'pc') {
      const mapRect = map.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      require(rootStyle.display === 'grid', 'PC root must use grid at >=1200px')
      require(getComputedStyle(rail).display === 'flex', 'PC left rail must be persistent')
      require(stageStyle.display === 'grid', 'PC map stage must use map/details grid')
      require(shellRect.left >= mapRect.right - 2, 'PC details must occupy a distinct right column')
      require(stageRect.height <= innerHeight - 150, 'PC stage must remain viewport-bounded')
    }
    if (${JSON.stringify(scenario.check)} === 'tablet') {
      const mapRect = map.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      require(stageStyle.display === 'grid', '1024 tablet map stage must use two-column grid')
      require(shellRect.left >= mapRect.right - 2, 'tablet details must occupy the second column')
      require(stageRect.height <= innerHeight - 150, 'tablet stage must remain viewport-bounded')
      require(getComputedStyle(rail).display === 'none', 'tablet left rail must not become a persistent PC rail')
    }
    if (${JSON.stringify(scenario.check)} === 'mobile') {
      require(rootStyle.display === 'flex', 'mobile root must retain flow layout when not fullscreen')
      require(stageStyle.overflow === 'hidden', 'mobile map stage must clip overlays')
      require(getComputedStyle(rail).display === 'none', 'closed mobile rail must not cover the map')
      require(buttonStyle && parseFloat(buttonStyle.minWidth) >= 36 && parseFloat(buttonStyle.minHeight) >= 36,
        'mobile controls must retain >=36px touch targets')
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
      require(basemap && basemap.complete, 'HD basemap image must finish loading')
      require(basemap && basemap.naturalWidth === ${JSON.stringify(faustManifestEntry.enhancedPixels[0])}, 'HD basemap naturalWidth must match manifest')
      require(basemap && basemap.naturalHeight === ${JSON.stringify(faustManifestEntry.enhancedPixels[1])}, 'HD basemap naturalHeight must match manifest')
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

    if (${JSON.stringify(fullscreen)}) {
      const ownership = playbackSafeInsetOwnership({
        isFullscreen: true,
        formFactor: ${JSON.stringify(scenario.form)},
        sideSlots: ${JSON.stringify(!!scenario.sideSlots)},
        controlsInRail: ${JSON.stringify(controlsInRail)},
      })
      const hudRectBefore = hud.getBoundingClientRect()
      const contentRectBefore = overlayContent.getBoundingClientRect()
      const overlayWrapRectBefore = root.querySelector('.pb-mobile-overlay').getBoundingClientRect()
      const mapRectBefore = map.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const top = ownership.reserveTop ? hudRectBefore.height : 0
      const bottom = ownership.reserveBottom && contentRectBefore.height > 0
        ? Math.max(0, overlayWrapRectBefore.bottom - contentRectBefore.top)
        : 0
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
          'fitted mobile map viewport must not sit underneath visible bottom controls')
        require(getComputedStyle(root.querySelector('.pb-mobile-overlay')).width !== getComputedStyle(root).getPropertyValue('--pb-slot-w').trim(),
          'mobile controller must not become a permanent side-slot rail')
      }
    }

    require(document.documentElement.scrollWidth <= innerWidth + 1, 'layout must not create page-level horizontal overflow')
    const result = { name: ${JSON.stringify(scenario.name)}, width: innerWidth, height: innerHeight, failures }
    document.body.dataset.result = btoa(JSON.stringify(result))
}
</script>
</body>
</html>`
}

const temp = mkdtempSync(resolve(tmpdir(), 'wotb-playback-browser-'))
try {
  for (const scenario of scenarios) {
    const htmlPath = resolve(temp, `${scenario.name}.html`)
    writeFileSync(htmlPath, fixtureHtml(scenario), 'utf8')
    const output = execFileSync(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--run-all-compositor-stages-before-draw',
      `--window-size=${scenario.width},${scenario.height}`,
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    const match = output.match(/data-result="([A-Za-z0-9+/=]+)"/)
    if (!match) throw new Error(`${scenario.name}: browser fixture did not publish a result`)
    const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
    if (result.failures.length) {
      throw new Error(`${scenario.name}:\n- ${result.failures.join('\n- ')}`)
    }
    console.log(`[browser-layout] ${scenario.name} OK (${result.width}x${result.height})`)
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
