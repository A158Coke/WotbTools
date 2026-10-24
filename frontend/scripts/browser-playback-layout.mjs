import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { OCCLUSION_LIMITS, assertDocumentedLimits, measureOcclusion, measureReachability } from './browser-occlusion.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

// 规则 owner 是 design-language §5：文档与门禁的数值必须一致，任一侧漂移就失败。
assertDocumentedLimits()

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
// 2026-10-16 用户裁定：标记删除防重叠位移与虚线 leader，车体严格落在真实位置。
// 本门禁守住"生产接线里不再出现位移/虚线"（反过来写回去也会在这里失败）。
if (battleMapSource.includes('screenOffsetToSvgDelta')
  || battleMapSource.includes('presentationOffset')
  || battleMapSource.includes('pb-marker-leader')
  || battlePlaybackSource.includes('presentationOffset')
  || battlePlaybackSource.includes('computeTankCollisionLayout')
  || battlePlaybackSource.includes('renderedMapFrame')) {
  throw new Error('markers must render at their true positions: no collision displacement / leader line')
}
const faustAssetUrl = pathToFileURL(resolve(frontendRoot, 'src/assets/maps/faust.webp')).href

const scenarios = [
  { name: 'pc-1600x900', form: 'pc', width: 1600, height: 900, check: 'pc', occlusion: true },
  { name: 'tablet-1024x768', form: 'tablet', width: 1024, height: 768, check: 'tablet', occlusion: true },
  { name: 'mobile-390x844', form: 'mobile', width: 390, height: 844, check: 'mobile', occlusion: true },
  { name: 'phone-landscape-740x360', form: 'mobile', width: 740, height: 360, check: 'wide', occlusion: true },
  { name: 'phone-landscape-844x390', form: 'mobile', width: 844, height: 390, check: 'wide', occlusion: true },
  // 负向对照：同一形态下故意加一块盖住地图的常驻控件，断言遮挡探针**必须**失败。
  { name: 'occlusion-negative-740x360', form: 'mobile', width: 740, height: 360, check: 'wide', occlusion: true, occlusionNegative: true },
  { name: 'wide-fullscreen-1792x922', form: 'pc', width: 1792, height: 922, check: 'wide', fullscreen: true },
  // Form differences must not override the shared geometry.
  { name: 'pc-isolated-at-1024', form: 'pc', width: 1024, height: 768, check: 'pc-isolated' },
  // Real raster frame guard: intentionally non-square logical dimensions must remain the shared
  // frame for the basemap img, overlay SVG and marker layer.
  { name: 'raster-frame-source', form: 'pc', width: 1280, height: 900, check: 'raster' },
  // Real marker-position guard: the marker center must coincide with its semantic anchor
  // same 20px screen displacement as the HTML marker on a mobile-sized visible map frame.
  { name: 'marker-true-position', form: 'mobile', width: 390, height: 844, check: 'true-position' },

  // Fullscreen changes capacity while retaining the shared three-row battlefield contract.
  { name: 'pc-fullscreen-side-slots', form: 'pc', width: 1920, height: 900, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  { name: 'tablet-fullscreen-side-slots', form: 'tablet', width: 1180, height: 320, check: 'fullscreen', fullscreen: true, sideSlots: true, controlsInRail: false },
  // Mobile production JS no longer enables sideSlots, but force the stale class defensively: even if
  // it survives a responsive transition, the form contract must keep HUD top + controller bottom.
  { name: 'mobile-fullscreen-forced-side-slots', form: 'mobile', width: 882, height: 344, check: 'fullscreen-mobile', fullscreen: true, sideSlots: true, controlsInRail: false, controlsVisible: true },
]

// 负向对照：故意重新引入一块盖住主内容的常驻控件。门禁断言探针对它**失败**——
// 这是「这套门禁真的能发现 #727 这类问题」的唯一证据，没有它，断言只是对当前实现的同义重复。
function negativeOverlayMarkup(scenario) {
  if (!scenario.occlusionNegative) return ''
  return '<div class="pb-quick-actions pb-occlusion-negative" data-test="pb-occlusion-negative" style="position:absolute;inset-block-start:30%;inset-inline-start:10%;inline-size:60%;block-size:30%;background:#333"></div>'
}

// 可达性探针自测夹具（PR #747 review）。每个元素对应一种判定，期望写在下面的断言里：
// 三个负向样本的**中心点都露着**——这正是只看中心点的探针会放过的那一类。
// 两个正向样本防止修过头：可滚动触达不是缺陷；fixed 元素不受非 containing block 祖先的
// overflow 裁剪（CSS 规定它逃出去了），把它判成"被裁掉"就是误报。
function reachabilitySelfTestHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font: 12px sans-serif; padding: 8px; }
  .t { display: block; width: 44px; height: 44px; margin: 0; padding: 0; border: 0; background: #4a7; }
  .slot { margin-block-end: 12px; }
</style></head><body>
  <div class="slot"><button id="r-ok" class="t">ok</button></div>
  <div class="slot" style="overflow: hidden; height: 32px"><button id="r-clip12" class="t">clip</button></div>
  <div class="slot" style="cursor: pointer"><button id="r-pe-none" class="t" style="pointer-events: none">pe</button></div>
  <div class="slot" style="position: relative">
    <button id="r-cover12" class="t">cover</button>
    <div style="position: absolute; inset-inline: 0; inset-block-start: 32px; block-size: 12px; background: #000"></div>
  </div>
  <div class="slot" style="overflow: auto; height: 60px"><div style="height: 200px"></div><button id="r-scroll" class="t">scroll</button></div>
  <div class="slot" style="overflow: hidden; width: 10px; height: 10px">
    <button id="r-fixed" class="t" style="position: fixed; left: 400px; top: 20px">fixed</button>
  </div>
</body></html>`
}

function fixtureHtml(scenario) {
  const fullscreen = !!scenario.fullscreen
  const lanes = !['mobile', 'raster', 'true-position'].includes(scenario.check)
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
      ${negativeOverlayMarkup(scenario)}
      <div class="pb-map"${scenario.check === 'true-position' ? ' style="width:390px;height:387px"' : ''}><div class="pb-viewport"${scenario.check === 'raster' ? ' style="aspect-ratio:769 / 763"' : scenario.check === 'true-position' ? ' style="width:400%;aspect-ratio:769 / 763;transform:translate(-585px,-580.5px)"' : ''}>
        ${scenario.check === 'raster' ? `<img class="pb-basemap" data-test="pb-basemap" src="${faustAssetUrl}" alt=""><svg class="pb-svg" viewBox="0 0 769 763"><rect x="0" y="0" width="769" height="763"></rect></svg><div class="pb-markers" data-test="pb-markers"></div>` : scenario.check === 'true-position' ? `<svg class="pb-svg" viewBox="0 0 769 763"><circle class="pb-true-anchor" cx="384.5" cy="381.5" r="2"></circle></svg><div class="pb-markers"><div class="pb-marker" style="left:50%;top:50%"></div></div>` : ''}
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

    if (${JSON.stringify(scenario.check)} === 'true-position') {
      // 标记严格落在真实位置：marker 中心必须与同一语义点的 SVG 锚点重合（无任何位移项），
      // 且 DOM 里不得出现虚线 leader。
      const logical = { W: 769, H: 763 }
      const svg = root.querySelector('.pb-svg')
      const marker = root.querySelector('.pb-marker')
      const anchor = root.querySelector('.pb-true-anchor')
      require(!root.querySelector('.pb-marker-leader'), 'leader line must not exist (removed 2026-10-16)')
      const markerRect = marker?.getBoundingClientRect()
      const svgRect = svg?.getBoundingClientRect()
      const anchorRect = anchor?.getBoundingClientRect()
      const markerCenter = markerRect ? { x: markerRect.left + markerRect.width / 2, y: markerRect.top + markerRect.height / 2 } : null
      const anchorCenter = anchorRect ? { x: anchorRect.left + anchorRect.width / 2, y: anchorRect.top + anchorRect.height / 2 } : null
      const pixelDelta = markerCenter && anchorCenter
        ? { x: markerCenter.x - anchorCenter.x, y: markerCenter.y - anchorCenter.y } : null
      require(svgRect && svgRect.width > 0, 'marker-true-position fixture must render the map frame')
      require(pixelDelta && Math.abs(pixelDelta.x) <= 0.5 && Math.abs(pixelDelta.y) <= 0.5,
        'marker center must coincide with its semantic anchor (no displacement)')
      metrics = {
        logical,
        visibleCss: { width: svgRect.width, height: svgRect.height },
        markerCenter,
        anchorCenter,
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

/**
 * 3D 伤害数字覆盖层的浏览器级几何探针（在页面内执行，**不能引用模块作用域**）。
 *
 * 验收：出生贴血条右侧且不覆盖血条 / 跟随当前 anchor（车辆与相机每帧在动）/ 出屏立即隐藏 /
 * 贴右缘镜像到血条左侧且漂移反向（远离血条、不出边界）/ fit 边界含整段漂移行程 /
 * 真 0×0 空名牌回退到锚点上方 / rerender 不重算 animation-delay。
 * 组件挂载与偏好注入由 scripts/browser-fixtures/damage-overlay-entry.js 提供（真实组件 + 真实 CSS）。
 */
async function probeDamageOverlay() {
  const failures = []
  const require = (ok, message) => { if (!ok) failures.push(message) }
  const api = window.__damageOverlay
  const stageRect = document.getElementById('stage').getBoundingClientRect()
  const box = (element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left - stageRect.left, top: rect.top - stageRect.top,
      right: rect.right - stageRect.left, bottom: rect.bottom - stageRect.top,
      width: rect.width, height: rect.height,
    }
  }
  const barEl = () => document.querySelector('.pb-hp-bar')
  const labelEl = () => document.querySelector('.vehicle-label')
  const dmgEl = () => document.querySelector('[data-test="pb-damage"]')
  // 几何一律量**数字文本本身**：外层 span 只是定位载体，文本带 translate(0,-50%) 与漂移动画，
  // 真正要与血条对齐 / 不覆盖血条的是文本的可见盒。
  const dmgTextEl = () => document.querySelector('[data-test="pb-damage"] .pb-damage-text')
  const driftX = () => parseFloat(getComputedStyle(dmgEl()).getPropertyValue('--pb-damage-drift-x')) || 0
  const row = (eid, extra = {}) => ({
    eid, accountId: 1000 + eid, playerName: 'Recipient 7', tankName: 'Maus', friendly: true,
    destroyed: false, lastKnown: false, hp: { current: 800, pct: 80, state: 'CURRENT' },
    reload: null, hpGhost: null, hpFlash: null, tankClass: 'Heavy tank', ...extra,
  })
  const anchorAt = (x, y) => ({ x, y, visible: true, occluded: false, projected: true })
  const stageW = stageRect.width
  const metrics = {}

  await api.setLabels([row(7), row(8)])
  await api.setAnchor(7, anchorAt(300, 260))
  await api.spawn(7, 342, 60000)
  await api.setAnchor(7, anchorAt(300, 260))

  // 1) 出生在血条右侧、垂直居中于血条；漂移行程仍在舞台内（fit 含 drift）
  const bar = box(barEl())
  let dmg = box(dmgTextEl())
  require(!!dmgEl() && !dmgEl().hidden, 'damage number must be visible next to the HP bar')
  require(dmg.left >= bar.right + 4,
    `damage must start right of the HP bar (dmg=${JSON.stringify(dmg)} bar=${JSON.stringify(bar)})`)
  require(Math.abs((dmg.top + dmg.height / 2) - (bar.top + bar.height / 2)) <= 1.5,
    `damage must be vertically centred on the HP bar (dmg=${JSON.stringify(dmg)} bar=${JSON.stringify(bar)})`)
  require(driftX() > 0, `right-side damage must drift right (driftX=${driftX()})`)
  require(dmg.right + driftX() <= stageW + 0.5,
    `right-side drift must stay inside the stage (dmg.right=${dmg.right} drift=${driftX()} stage=${stageW})`)
  metrics.birth = { gap: dmg.left - bar.right, driftX: driftX(), dmg, bar }

  // 2) 跟随当前 anchor：车辆 / 相机移动时按同一偏移一起走（不缓存屏幕绝对坐标）
  await api.setAnchor(7, anchorAt(360, 300))
  const moved = box(dmgTextEl())
  require(Math.abs((moved.left - dmg.left) - 60) <= 1 && Math.abs((moved.top - dmg.top) - 40) <= 1,
    `damage must follow the anchor (dx=${moved.left - dmg.left} dy=${moved.top - dmg.top})`)
  metrics.follow = { dx: moved.left - dmg.left, dy: moved.top - dmg.top }

  // 3) 出屏（projected=false）→ 立即隐藏；回到视锥内 → 按新 anchor 继续显示
  await api.setAnchor(7, { ...anchorAt(360, 300), projected: false })
  require(dmgEl().hidden, 'damage must hide as soon as the vehicle leaves the frustum')
  await api.setAnchor(7, anchorAt(360, 300))
  require(!dmgEl().hidden, 'damage must come back with the remaining lifetime')

  // 4) 贴右缘放不下（含漂移行程）→ 镜像到血条左侧，漂移反向、不覆盖血条、不出左边界
  await api.setAnchor(7, anchorAt(stageW - 20, 260))
  dmg = box(dmgTextEl())
  const barNear = box(barEl())
  require(driftX() < 0, `mirrored damage must drift left, away from the bar (driftX=${driftX()})`)
  require(dmg.right <= barNear.left + 0.5,
    `mirrored damage must not cover the HP bar (dmg.right=${dmg.right} bar.left=${barNear.left})`)
  require(dmg.left + driftX() >= -0.5,
    `mirrored drift must stay inside the stage (dmg.left=${dmg.left} drift=${driftX()})`)
  metrics.mirror = { dmgRight: dmg.right, barLeft: barNear.left, driftX: driftX() }

  // 5) rerender 不重算 animation-delay（存活期间 timeline 稳定，不被重复快进）
  await api.setAnchor(7, anchorAt(300, 260))
  const delayBefore = getComputedStyle(dmgEl().firstElementChild).animationDelay
  await api.setLabels([row(7), row(8), row(9)])
  await api.spawn(7, 120, 60000)
  const delayAfter = getComputedStyle(dmgEl().firstElementChild).animationDelay
  require(delayBefore === delayAfter,
    `animation-delay must stay stable across rerenders (${delayBefore} -> ${delayAfter})`)
  metrics.delay = delayAfter

  // Force the previous mirrored side to stop fitting before testing right remount.
  await api.setAnchor(7, anchorAt(20, 260))
  const rightNode = dmgEl()
  require(driftX() === 20, 'right side must be selected before remount')

  // 5b) showStatus 关→开 = 真实 remount：只补偿一次相位，之后 rerender 不再改动
  await api.remount()
  require(dmgEl() !== rightNode, 'showStatus must create a new node')
  require(driftX() === 20, 'right drift must be restored before placement')
  await api.setAnchor(7, anchorAt(300, 260))
  const afterRemount = getComputedStyle(dmgEl().firstElementChild).animationDelay
  require(afterRemount !== delayAfter,
    `remount must compensate the phase exactly once (${delayAfter} -> ${afterRemount})`)
  await api.setLabels([row(7), row(8), row(9), row(10)])
  require(getComputedStyle(dmgEl().firstElementChild).animationDelay === afterRemount,
    'phase compensation must not be recomputed by later rerenders')
  metrics.remountDelay = afterRemount

  await api.setAnchor(7, anchorAt(stageW - 20, 260))
  require(driftX() === -20, 'left side must be selected before remount')
  const leftNode = dmgEl()
  await api.remount()
  require(dmgEl() !== leftNode, 'left damage must remount')
  require(driftX() === -20, 'left drift must be restored before placement')
  await api.setAnchor(7, anchorAt(stageW - 20, 260))
  require(driftX() === -20, 'left drift must survive placement with unchanged side')

  // H 恢复实际 CSS phase，原始 removal timer 不延长。
  api.clearDamages()
  const waitUntil = async (predicate, timeoutMs = 6000) => {
    const start = performance.now()
    while (!predicate()) {
      if (performance.now() - start > timeoutMs) throw new Error('damage lifecycle condition timed out')
      await new Promise(requestAnimationFrame)
    }
  }
  const bornBefore = performance.now()
  await api.spawn(7, 342, 4000)
  const bornAfter = performance.now()
  await api.setAnchor(7, anchorAt(300, 260))
  const hNode = dmgEl()
  await waitUntil(() => dmgTextEl().getAnimations()[0]?.currentTime >= 500)
  await api.setHidden(true)
  await waitUntil(() => performance.now() - bornAfter >= 1100)
  await api.setHidden(false)
  require(dmgEl() === hNode, 'H must preserve the damage node')
  const animation = dmgTextEl().getAnimations()[0]
  const timing = animation?.effect.getComputedTiming()
  const effectiveTime = timing && animation.currentTime - timing.delay
  const ageMin = performance.now() - bornAfter
  const ageMax = performance.now() - bornBefore
  require(Number.isFinite(effectiveTime) && effectiveTime >= ageMin - 100 && effectiveTime <= ageMax + 100,
    `H must restore actual CSS phase (effective=${effectiveTime}, age=${ageMin}..${ageMax})`)
  require(timing?.progress > 0.25, 'animation must not replay its birth phase')
  const restoredDelay = dmgTextEl().style.animationDelay
  await api.setLabels([row(7), row(8)])
  require(dmgTextEl().style.animationDelay === restoredDelay, 'rerender must preserve restored delay')
  await waitUntil(() => performance.now() - bornAfter >= 3500)
  require(!!dmgEl(), 'damage must survive close to its original deadline')
  await waitUntil(() => !dmgEl())
  const removedAt = performance.now()
  require(removedAt - bornBefore < 4400, 'H must not restart removal timer')
  metrics.hiddenRecovery = { effectiveTime, ageMin, ageMax, removedAfterMs: removedAt - bornBefore }

  // 出屏再进屏也会重启 CSS timeline，必须恢复原始 wall-clock phase。
  const offscreenBornBefore = performance.now()
  await api.spawn(7, 342, 4000)
  const offscreenBornAfter = performance.now()
  await api.setAnchor(7, anchorAt(300, 260))
  await waitUntil(() => dmgTextEl().getAnimations()[0]?.currentTime >= 500)
  const beforeOffscreen = dmgTextEl().getAnimations()[0].currentTime
  await api.setAnchor(7, { ...anchorAt(300, 260), projected: false })
  require(dmgEl().hidden, 'off-screen damage must be hidden')
  await waitUntil(() => performance.now() - offscreenBornAfter >= 1100)
  await api.setAnchor(7, anchorAt(300, 260))
  require(!dmgEl().hidden, 'returning damage must be visible')
  const resumedAnimation = dmgTextEl().getAnimations()[0]
  const resumedTiming = resumedAnimation.effect.getComputedTiming()
  const resumedTime = resumedAnimation.currentTime - resumedTiming.delay
  const resumedAgeMin = performance.now() - offscreenBornAfter
  const resumedAgeMax = performance.now() - offscreenBornBefore
  require(resumedTime >= resumedAgeMin - 100 && resumedTime <= resumedAgeMax + 100,
    `off-screen return phase must match age (${resumedTime} vs ${resumedAgeMin}..${resumedAgeMax})`)
  require(resumedTime > beforeOffscreen + 300, 'return phase must advance past the pre-hide phase')
  const resumedDelay = dmgTextEl().style.animationDelay
  await api.setAnchor(7, anchorAt(320, 260))
  require(dmgTextEl().style.animationDelay === resumedDelay, 'ordinary anchor updates must preserve return phase')
  await waitUntil(() => performance.now() - offscreenBornAfter >= 3500)
  require(!!dmgEl(), 'returning damage must survive close to its original deadline')
  await waitUntil(() => !dmgEl())
  const offscreenRemovedAfterMs = performance.now() - offscreenBornBefore
  require(offscreenRemovedAfterMs < 4400, 'off-screen return must not extend removal deadline')
  metrics.offscreenRecovery = { beforeOffscreen, resumedTime, resumedAgeMin, resumedAgeMax, offscreenRemovedAfterMs }

  // 出生时已经在视锥外：延迟首次可见也要恢复原始 wall-clock phase。
  await api.setAnchor(7, { ...anchorAt(300, 260), projected: false })
  const unseenBornBefore = performance.now()
  await api.spawn(7, 342, 4000)
  const unseenBornAfter = performance.now()
  await api.setAnchor(7, { ...anchorAt(300, 260), projected: false })
  require(dmgEl().hidden, 'born-off-screen damage must remain hidden')
  await waitUntil(() => performance.now() - unseenBornAfter >= 1200)
  await api.setAnchor(7, anchorAt(300, 260))
  require(!dmgEl().hidden, 'first projected display must reveal damage')
  const firstAnimation = dmgTextEl().getAnimations()[0]
  const firstTiming = firstAnimation.effect.getComputedTiming()
  const firstTime = firstAnimation.currentTime - firstTiming.delay
  const firstAgeMin = performance.now() - unseenBornAfter
  const firstAgeMax = performance.now() - unseenBornBefore
  require(firstTime >= firstAgeMin - 100 && firstTime <= firstAgeMax + 100,
    `first visible phase must match age (${firstTime} vs ${firstAgeMin}..${firstAgeMax})`)
  require(firstTiming.progress > 0.25, 'first display must not start at birth phase')
  const firstDelay = dmgTextEl().style.animationDelay
  await api.setAnchor(7, anchorAt(320, 260))
  await api.setLabels([row(7), row(8)])
  require(dmgTextEl().style.animationDelay === firstDelay, 'first-display phase must stay stable on ordinary updates')
  await waitUntil(() => performance.now() - unseenBornAfter >= 3500)
  require(!!dmgEl(), 'first-display damage must survive close to its original deadline')
  await waitUntil(() => !dmgEl())
  const unseenRemovedAfterMs = performance.now() - unseenBornBefore
  require(unseenRemovedAfterMs < 4400, 'delayed first display must not extend removal deadline')
  metrics.bornOffscreen = { firstTime, firstAgeMin, firstAgeMax, unseenRemovedAfterMs }

  // showStatus=false 时出生：延迟首次挂载仍消费原始 wall-clock age。
  await api.prefs({ markerPrefs: { showStatus: false } })
  const delayedBorn = performance.now()
  await api.spawn(7, 342, 4000)
  await waitUntil(() => performance.now() - delayedBorn >= 700)
  await api.prefs({ markerPrefs: { showStatus: true } })
  await api.setAnchor(7, anchorAt(300, 260))
  const delayedAnimation = dmgTextEl().getAnimations()[0]
  const delayedTiming = delayedAnimation.effect.getComputedTiming()
  require(delayedAnimation.currentTime - delayedTiming.delay >= 650,
    'delayed first mount must compensate elapsed time')
  api.clearDamages()

  // 第一槽到期后再出生：三个仍存活的数字必须占三个不同位置。
  await api.spawn(7, 100, 500)
  await api.spawn(7, 200, 4000)
  await api.spawn(7, 300, 4000)
  await waitUntil(() => document.querySelectorAll('[data-test="pb-damage"]').length === 2)
  await api.spawn(7, 400, 4000)
  await api.setAnchor(7, anchorAt(300, 260))
  const slotPositions = [...document.querySelectorAll('[data-test="pb-damage"]')].map(el => el.style.transform)
  require(new Set(slotPositions).size === 3, 'expire-then-spawn must reuse the free stacking slot')

  // 6) HP 关掉 → 退回名牌块右侧，仍然可见
  await api.clearDamages()
  await api.prefs({ hpPrefs: { showHp: false } })
  await api.spawn(7, 400, 60000)
  await api.setAnchor(7, anchorAt(300, 260))
  dmg = box(dmgTextEl())
  const label = box(labelEl())
  require(!dmgEl().hidden, 'damage must stay visible when the HP display is off')
  require(dmg.left >= label.right - 0.5 && dmg.left <= label.right + 10,
    `HP-off damage must fall back to the right of the label block (dmg.left=${dmg.left} label.right=${label.right})`)
  metrics.hpOff = { dmgLeft: dmg.left, labelRight: label.right }

  // 7) 姓名 / 车型 / HP 全关 → 真正的 0×0 名牌 → 回退到锚点上方（不得一直 hidden）
  await api.clearDamages()
  await api.prefs({ labelPrefs: { showPlayerName: false, showTankName: false }, hpPrefs: { showHp: false } })
  await api.spawn(7, 400, 60000)
  await api.setAnchor(7, anchorAt(300, 260))
  dmg = box(dmgTextEl())
  require(!dmgEl().hidden, 'empty 0x0 label must still yield a visible damage number above the vehicle')
  require(Math.abs(dmg.left - 300) <= 1.5 && dmg.bottom <= 260,
    `0x0 fallback must sit above the anchor (dmg=${JSON.stringify(dmg)})`)
  metrics.emptyLabel = dmg

  api.clearDamages()
  return { failures, metrics }
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
    // 遮挡判定（design-language §5）：常驻控件不得实质遮挡主内容。必须在真实浏览器里量，
    // 因为它取决于真实布局与绘制结果，而不是声明值。
    const occlusion = scenario.occlusion
      ? await measureOcclusion(page, {
        primary: '.pb-map',
        persistent: ['.pb-map-quick-actions', '.pb-quick-action', '.pb-occlusion-negative'],
      })
      : null
    await browser.client.send('Target.closeTarget', { targetId })
    if (occlusion) {
      const negative = !!scenario.occlusionNegative
      if (!negative && occlusion.failures.length) {
        throw new Error(`${scenario.name} 遮挡契约（design-language §5，上限 ${OCCLUSION_LIMITS.maxPrimaryCoveragePct}%）:
- ${occlusion.failures.join('\n- ')}`)
      }
      if (negative && !occlusion.failures.length) {
        throw new Error(`${scenario.name}: 负向对照必须失败——故意盖住主内容 ${occlusion.totalPct}% 却通过了，说明遮挡探针发现不了 #727 这类问题`)
      }
      console.log(`[browser-layout] ${scenario.name} occlusion ${negative ? 'NEGATIVE-OK' : 'OK'} total=${occlusion.totalPct}% items=${JSON.stringify(occlusion.items.map((i) => [i.label, i.pct]))}`)
    }
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
  // Equal roster lanes absorb width beyond the maximum square while retaining their floor.
  if (!(tablet.laneWidth >= 9 * 16 - 0.5 && desktop.laneWidth > tablet.laneWidth)) {
    throw new Error('Roster lanes must keep their readable floor and grow with the workspace')
  }

  // —— 横向空间归属：桌面中心贴合正方形、车道承接余量 ——
  //
  // 用比例 / 恒等式而不是像素宽度做验收：断点只决定形态，尺寸由 fr 连续决定，
  // 所以「center 相对 lane 有多宽」才是要锁的契约，具体 px 会随视口自由变化。
  const LANE_GAP_PX = 8 // --space-2：三栏之间的 gutter，由 --space-* token 决定
  const ROSTER_MIN_PX = 9 * 16 // --pb-roster-min（窄档 fallback 的下限）
  const contractFailures = []
  const requireContract = (ok, message) => { if (!ok) contractFailures.push(message) }

  for (const [name, metrics] of geometryByName) {
    if (!metrics?.hudWidth) continue // 非三栏场景（mobile portrait / raster / leader）不参与
    const label = `${name}: lane=${metrics.laneWidth} center=${metrics.centerWidth} stage=${metrics.stageSide}`
    // 两条 lane 等宽，且不低于可读下限（2/6/2 的窄档 fallback 就是守在 --pb-roster-min 上）
    requireContract(Math.abs(metrics.laneWidth - metrics.laneRight) <= 0.5, `both lanes must share one width: ${label}`)
    requireContract(metrics.laneWidth >= ROSTER_MIN_PX - 0.5, `roster lane must keep its readable floor: ${label}`)
    // center 必须吃掉**全部**剩余宽度：等于 整宽 − 两条 lane − 一条 gutter。
    // 这条恒等式才是「center 没有额外 max-width / 固定宽度 / 多余 margin」的直接证据。
    // 注意 `centerWidth` 量的是 right.left − left.right − LANE_GAP_PX：右 lane 的 gutter
    // 已经内含在这段距离里，所以再减一条就重复了。
    const expectedCenter = metrics.mainWidth - 2 * metrics.laneWidth - LANE_GAP_PX
    requireContract(Math.abs(metrics.centerWidth - expectedCenter) <= 1,
      `center column must consume all remaining width (expected ${expectedCenter}): ${label}`)
    // Desktop keeps the center twice as wide as either roster.
    if (metrics.mainWidth >= 1200) requireContract(Math.abs(metrics.centerWidth - metrics.laneWidth * 2) <= 2,
      `desktop center must be twice the roster lane width: ${label}`)
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

  // Wide viewport surplus is assigned to the roster lanes.
  requireContract(fullscreen.laneWidth > desktop.laneWidth,
    `extra wide-viewport width must grow the roster lanes: desktop=${desktop.centerWidth}/${desktop.laneWidth} fullscreen=${fullscreen.centerWidth}/${fullscreen.laneWidth}`)
  // 短横屏（844x390）与平板仍保持三栏 + 可读 roster
  requireContract(phoneLandscape.centerWidth > phoneLandscape.stageSide,
    `phone landscape center must remain the widest column: ${JSON.stringify(phoneLandscape)}`)
  if (contractFailures.length) {
    throw new Error(`workspace column ownership contract:\n- ${contractFailures.join('\n- ')}`)
  }

  // —— 可达性探针自测：探针自己必须能发现 #727 这一类问题，同时不能误伤 ——
  // 只看中心点、或者把「命中了祖先」算成可达的探针，对部分裁剪 / 部分覆盖 / pointer-events 穿透
  // 全都会给出绿色。这里用确定性夹具逐项锁定判定方向。
  {
    const htmlPath = resolve(temp, 'reachability-self-test.html')
    writeFileSync(htmlPath, reachabilitySelfTestHtml(), 'utf8')
    const { targetId, sessionId } = await browser.openPage()
    const selfTestPage = new Page(browser.client, sessionId)
    await selfTestPage.enable()
    await selfTestPage.emulate({ width: 600, height: 600, touch: false, deviceScaleFactor: 1 })
    await selfTestPage.goto(pathToFileURL(htmlPath).href)
    const expectations = [
      ['#r-ok', 'pass', '完整可见'],
      ['#r-scroll', 'pass', '滚出可滚动容器 = 可滚动触达'],
      ['#r-fixed', 'pass', 'fixed 逃出非 containing block 祖先的 overflow'],
      ['#r-clip12', 'fail', 'overflow:hidden 裁掉底部 12px，中心仍露出'],
      ['#r-pe-none', 'fail', 'pointer-events:none，命中落到祖先'],
      ['#r-cover12', 'fail', '兄弟元素盖住底部 12px，中心仍露出'],
    ]
    const selfTestFailures = []
    for (const [selector, expected, why] of expectations) {
      const { failures } = await measureReachability(selfTestPage, { options: [selector], touch: true })
      const actual = failures.length ? 'fail' : 'pass'
      if (actual !== expected) {
        selfTestFailures.push(`${selector}（${why}）应判 ${expected}，实际 ${actual}${failures.length ? `: ${failures.join(' | ')}` : ''}`)
      }
    }
    await browser.client.send('Target.closeTarget', { targetId })
    if (selfTestFailures.length) {
      throw new Error(`可达性探针自测失败——探针会漏判或误报 #727 这一类问题:\n- ${selfTestFailures.join('\n- ')}`)
    }
    console.log('[browser-layout] reachability-self-test OK（部分裁剪 / 部分覆盖 / pointer-events 穿透均判失败；可滚动触达与逃出 overflow 的 fixed 均判通过）')
  }

  // —— 3D 伤害数字覆盖层：真实组件 + 真实 CSS 的浏览器几何 / 跟随 / 出屏 / 镜像门禁 ——
  // 覆盖层是纯 DOM（无 WebGL、无资产），所以能在真浏览器里锁几何；3D 场景画面观感仍归用户人工验收。
  const { startFixtureServer } = await import('./browser-fixtures/fixture-server.mjs')
  const fixture = await startFixtureServer()
  try {
    const { targetId, sessionId } = await browser.openPage()
    const overlayPage = new Page(browser.client, sessionId)
    await overlayPage.enable()
    await overlayPage.emulate({ width: 1200, height: 800, touch: false, deviceScaleFactor: 1 })
    await overlayPage.goto(`${fixture.origin}/scripts/browser-fixtures/damage-overlay.html`)
    await overlayPage.waitForValue('!!(window.__damageOverlay && window.__damageOverlay.ready())', (ready) => ready === true,
      { label: '3d damage overlay fixture ready' })
    const overlayResult = await overlayPage.probe(probeDamageOverlay)
    const pageErrors = overlayPage.consoleErrors
    await browser.client.send('Target.closeTarget', { targetId })
    if (overlayResult.failures.length) {
      throw new Error(`3d damage overlay geometry:\n- ${overlayResult.failures.join('\n- ')}`)
    }
    if (pageErrors.length) {
      throw new Error(`3d damage overlay fixture page errors:\n- ${pageErrors.join('\n- ')}`)
    }
    console.log(`[browser-layout] 3d-damage-overlay OK ${JSON.stringify(overlayResult.metrics)}`)
  } finally {
    await fixture.server.close()
  }
} finally {
  await browser.close()
  rmSync(temp, { recursive: true, force: true })
}
