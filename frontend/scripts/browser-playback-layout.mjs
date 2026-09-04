import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const cssUrls = [
  'src/styles/playback-shared.css',
  'src/styles/playback-pc.css',
  'src/styles/playback-tablet.css',
  'src/styles/playback-mobile.css',
].map((path) => pathToFileURL(resolve(frontendRoot, path)).href)

const scenarios = [
  { name: 'pc-1600x900', form: 'pc', width: 1600, height: 900, check: 'pc' },
  { name: 'tablet-1024x768', form: 'tablet', width: 1024, height: 768, check: 'tablet' },
  { name: 'mobile-390x844', form: 'mobile', width: 390, height: 844, check: 'mobile' },
  // Structural isolation: a PC form at tablet width must not accidentally receive tablet geometry.
  { name: 'pc-isolated-at-1024', form: 'pc', width: 1024, height: 768, check: 'pc-isolated' },
]

function fixtureHtml(scenario) {
  const links = cssUrls.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')
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
  html, body { margin: 0; width: 100%; min-height: 100%; overflow-x: hidden; }
  body { background: #111; }
  .battle-playback { width: 100%; }
  .pb-hud { min-height: 40px; }
  .pb-left-rail { min-height: 160px; }
  .pb-main { width: 100%; }
  .pb-map-stage { width: 100%; }
  .pb-map { aspect-ratio: 1 / 1; min-width: 0; min-height: 1px; background: #222; }
  .pb-side-panel-shell { min-width: 0; min-height: 0; }
  .pb-sidebar, .pb-side-panel { min-height: 120px; }
  .pb-mobile-overlay-content { min-height: 40px; }
</style>
${links}
</head>
<body>
<div id="root" class="battle-playback pb-form-${scenario.form}">
  <div class="pb-hud"></div>
  <aside class="pb-left-rail"><button class="pb-rail-collapse">rail</button></aside>
  <main class="pb-main">
    <div class="pb-map-stage">
      <div class="pb-map"></div>
      <div class="pb-side-panel-shell pb-details-active">
        <div class="pb-sidebar">details</div>
        <div class="pb-side-panel">panel</div>
      </div>
    </div>
    <div class="pb-mobile-overlay"><div class="pb-mobile-overlay-content"><div class="pb-controls"><button class="pb-btn">x</button></div></div></div>
  </main>
</div>
<script>
window.addEventListener('load', () => {
  const root = document.getElementById('root')
  const stage = root.querySelector('.pb-map-stage')
  const map = root.querySelector('.pb-map')
  const shell = root.querySelector('.pb-side-panel-shell')
  const rail = root.querySelector('.pb-left-rail')
  const button = root.querySelector('.pb-btn')
  const rootStyle = getComputedStyle(root)
  const stageStyle = getComputedStyle(stage)
  const mapRect = map.getBoundingClientRect()
  const stageRect = stage.getBoundingClientRect()
  const shellRect = shell.getBoundingClientRect()
  const buttonStyle = getComputedStyle(button)
  const failures = []
  const require = (ok, message) => { if (!ok) failures.push(message) }

  if (${JSON.stringify(scenario.check)} === 'pc') {
    require(rootStyle.display === 'grid', 'PC root must use grid at >=1200px')
    require(getComputedStyle(rail).display === 'flex', 'PC left rail must be persistent')
    require(stageStyle.display === 'grid', 'PC map stage must use map/details grid')
    require(shellRect.left >= mapRect.right - 2, 'PC details must occupy a distinct right column')
    require(stageRect.height <= innerHeight - 150, 'PC stage must remain viewport-bounded')
  }
  if (${JSON.stringify(scenario.check)} === 'tablet') {
    require(stageStyle.display === 'grid', '1024 tablet map stage must use two-column grid')
    require(shellRect.left >= mapRect.right - 2, 'tablet details must occupy the second column')
    require(stageRect.height <= innerHeight - 150, 'tablet stage must remain viewport-bounded')
    require(getComputedStyle(rail).display === 'none', 'tablet left rail must not become a persistent PC rail')
  }
  if (${JSON.stringify(scenario.check)} === 'mobile') {
    require(rootStyle.display === 'flex', 'mobile root must retain flow layout when not fullscreen')
    require(stageStyle.overflow === 'hidden', 'mobile map stage must clip overlays')
    require(getComputedStyle(rail).display === 'none', 'closed mobile rail must not cover the map')
    require(parseFloat(buttonStyle.minWidth) >= 36 && parseFloat(buttonStyle.minHeight) >= 36,
      'mobile controls must retain >=36px touch targets')
  }
  if (${JSON.stringify(scenario.check)} === 'pc-isolated') {
    require(stageStyle.display !== 'grid', 'PC form at 1024px must not receive tablet grid rules')
  }

  require(document.documentElement.scrollWidth <= innerWidth + 1, 'layout must not create page-level horizontal overflow')
  const result = { name: ${JSON.stringify(scenario.name)}, width: innerWidth, height: innerHeight, failures }
  document.body.dataset.result = btoa(JSON.stringify(result))
})
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
