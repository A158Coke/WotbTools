import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findChrome } from './browser-chrome.mjs'

// 直接 `node scripts/...mjs` 时执行全部门禁；被 import（诊断/单场景复跑）时只导出 fixture。
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

/**
 * 正方形 Stage 的**真实浏览器几何门禁**（2D / 3D 同一份布局契约，见 styles/playback-workspace.css）。
 *
 * 为什么必须用真浏览器而不是 happy-dom：这一层要证明的全是**几何**——Stage 是不是正方形、
 * Team 1 / Team 2 是不是分居左右、浮窗有没有越出 workspace 或压住传输控件、齿轮有没有掉到
 * 第二行。jsdom / happy-dom 没有布局引擎，这些断言在那里写出来只能是假的（读到 0 或读到
 * 我们自己塞进去的桩值）。
 *
 * 与 browser-playback-layout.mjs 同一套做法：逐字使用生产 CSS（只把 `:fullscreen` 换成
 * 根类标记，因为没有用户手势无法在 file:// 无头环境里真正进全屏），页面脚本在模块求值阶段
 * 同步发布结果，Chrome --dump-dom 才能稳定拿到。
 */

const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

const chrome = findChrome()
const cssPaths = [
  'src/styles/playback-shared.css',
  'src/styles/playback-pc.css',
  'src/styles/playback-tablet.css',
  'src/styles/playback-mobile.css',
  'src/styles/playback-workspace.css',
  'src/styles/playback-mobile-fullscreen.css',
  'src/styles/playback-fullscreen-form-contract.css',
]
const productionCss = cssPaths
  .map((path) => readFileSync(resolve(frontendRoot, path), 'utf8'))
  .join('\n')
  .replaceAll(':fullscreen', '.pb-test-fullscreen')

/**
 * 每个场景只声明「这个视口该得到哪一种布局」，断言由场景标签推导，不逐条复制粘贴。
 */
const scenarios = [
  { name: 'phone-portrait-375x812', form: 'mobile', width: 375, height: 812, layout: 'portrait' },
  { name: 'phone-portrait-390x844', form: 'mobile', width: 390, height: 844, layout: 'portrait' },
  { name: 'phone-landscape-740x360', form: 'mobile', width: 740, height: 360, layout: 'landscape' },
  { name: 'phone-landscape-844x390', form: 'mobile', width: 844, height: 390, layout: 'landscape' },
  { name: 'tablet-1024x768', form: 'tablet', width: 1024, height: 768, layout: 'landscape', knownGap: 'tablet 非全屏下正方形在中心列里偏左（map 208px vs 列 510px）——已定位为形态文件与共享契约在 `.pb-map` 宽度上的重复声明，尚未收敛' },
  { name: 'pc-1600x900', form: 'pc', width: 1600, height: 900, layout: 'landscape' },
  // 名册关闭：两侧车道整体不存在，Stage 仍是居中的正方形（绝不被拉宽填满）
  { name: 'pc-1600x900-no-roster', form: 'pc', width: 1600, height: 900, layout: 'no-roster' },
  { name: 'phone-landscape-844x390-no-roster', form: 'mobile', width: 844, height: 390, layout: 'no-roster' },
  // 详情浮窗：位置由 usePlaybackDetailsPlacement 写在行内样式上，这里复现它的输出并验证边界
  { name: 'pc-1600x900-floating-details', form: 'pc', width: 1600, height: 900, layout: 'floating-details' },
  { name: 'tablet-1024x768-floating-details', form: 'tablet', width: 1024, height: 768, layout: 'floating-details' },
]

const ROSTER_MARKUP = `
      <div class="pb-team-lane pb-team-lane-left" data-test="pb-team-lane-left">
        <div class="pb-roster pb-roster-2d" data-test="pb-shell-roster">
          <section class="pb-roster-team team pb-roster-friendly">
            <h3 class="pb-team-head">Friendly</h3>
            <div class="pb-roster-list roster">
              <button type="button" class="pb-roster-row pl" data-test="pb-roster-row">
                <span class="nick pb-team-player">You</span><span class="hpv pb-roster-hp">1950</span><span class="hpp pb-roster-hp-pct">100%</span><span class="tank pb-team-tank">Kranvagn</span><span class="hpbar"><i style="width:100%"></i></span>
              </button>
              <button type="button" class="pb-roster-row pl" data-test="pb-roster-row">
                <span class="nick pb-team-player">Wingman</span><span class="hpv pb-roster-hp">824</span><span class="hpp pb-roster-hp-pct">42%</span><span class="tank pb-team-tank">T-62A</span><span class="hpbar"><i style="width:42%"></i></span>
              </button>
            </div>
          </section>
        </div>
      </div>`

export function fixtureHtml(scenario) {
  const withRoster = scenario.layout !== 'no-roster'
  const detailsColumn = withRoster && scenario.layout !== 'portrait'
  const rootClasses = [
    'battle-playback',
    `pb-form-${scenario.form}`,
    withRoster ? 'pb-roster-lanes' : '',
    // 与生产同口径：`pb-details-column` = 右侧详情列真的有东西要放（生产是 shellInUse）。
    detailsColumn ? 'pb-details-column' : '',
  ].filter(Boolean).join(' ')
  const rightLaneMarkup = ROSTER_MARKUP
    .replaceAll('pb-team-lane-left', 'pb-team-lane-right')
    .replace('pb-roster-friendly', 'pb-roster-enemy')
  const detailsStyle = scenario.layout === 'floating-details' ? ' style="left:16px;top:16px"' : ''
  const detailsMarkup = scenario.layout === 'floating-details'
    ? `<aside class="pb-sidebar pb-floating" data-test="pb-info" data-presentation="floating"${detailsStyle}>
          <div class="pb-sb-head"><span class="pb-sb-drag" data-test="pb-sb-drag"><span class="pb-sb-grip"></span></span><button class="pb-close pb-sb-close">×</button></div>
          <dl class="pb-sb-grid"><dt>HP</dt><dd>824</dd></dl>
        </aside>`
    : ''
  const inlineDetails = scenario.layout === 'portrait'
    ? `<aside class="pb-sidebar pb-floating" data-test="pb-inline-details" data-presentation="inline">
          <div class="pb-sb-head"><span class="pb-sb-title"><strong>Kranvagn</strong></span><button class="pb-close pb-sb-close">×</button></div>
          <dl class="pb-sb-grid"><dt>HP</dt><dd>1950</dd></dl>
        </aside>`
    : ''
  const inlineArea = `<div class="pb-inline-area" data-test="pb-inline-area">
        ${inlineDetails}
        ${withRoster ? `<div class="pb-roster pb-roster-2d" data-test="pb-inline-roster">
          <section class="pb-roster-team team pb-roster-friendly"><h3 class="pb-team-head">Friendly</h3>
            <div class="pb-roster-list roster"><button type="button" class="pb-roster-row pl" data-test="pb-roster-row"><span class="nick pb-team-player">You</span><span class="hpv pb-roster-hp">1950</span><span class="hpp pb-roster-hp-pct">100%</span><span class="tank pb-team-tank">Kranvagn</span></button></div>
          </section>
          <section class="pb-roster-team team pb-roster-enemy"><h3 class="pb-team-head">Enemy</h3>
            <div class="pb-roster-list roster"><button type="button" class="pb-roster-row pl" data-test="pb-roster-row"><span class="nick pb-team-player">Foe</span><span class="hpv pb-roster-hp">1500</span><span class="hpp pb-roster-hp-pct">75%</span><span class="tank pb-team-tank">IS-7</span></button></div>
          </section>
        </div>` : ''}
      </div>`
  const controlsMarkup = `<div class="pb-controls" data-test="pb-controls">
          <button class="pb-btn" data-test="pb-play">play</button>
          <button class="pb-btn" data-test="pb-step-back">-5</button>
          <button class="pb-btn" data-test="pb-step-forward">+5</button>
          <div class="pb-speed"><button class="pb-btn" data-test="pb-speed-current">1&times;</button></div>
          <button class="pb-btn" data-test="pb-fullscreen">fs</button>
          <button class="pb-btn pb-secondary-entry" data-test="pb-secondary-entry">gear</button>
        </div>`

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root {
    --bg:#111; --bg-card:#181818; --bg-card2:#202020; --border:#444; --border-ghost:#333;
    --text:#eee; --text-label:#ddd; --text-muted:#aaa; --accent:#d18b2c; --accent-dark:#f0a23a;
    --color-surface-1:#181818; --color-surface-2:#202020; --color-surface-3:#282828;
    --color-border-subtle:#3a3a3a; --color-text-primary:#eee; --color-text-secondary:#bbb; --color-text-tertiary:#999;
    --color-team-1:#7fd18b; --color-team-2:#e0685f; --color-team-ally:#7fd18b; --color-team-enemy:#e0685f;
    --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --radius-sm:6px; --radius-full:999px;
    --radius-md:10px; --radius-lg:14px; --row-h:36px; --hit-min:44px; --font-size-caption:12px; --line-height-caption:16px;
    --type-caption:400 12px/16px sans-serif; --type-body:400 14px/20px sans-serif;
    --focus-outline:2px solid var(--accent); --focus-outline-offset:2px; --elevation-3:0 12px 32px rgb(0 0 0 / .5);
    --header-h:56px; --tabbar-h:52px; --pb-details-w:min(340px, 28vw);
  }
  * { box-sizing: border-box; }
  html, body { margin:0; width:100%; height:100dvh; overflow:hidden; }
  body { background:#111; font: var(--type-body); }
  /* workspace 根**占满视口**：生产里根高度由页面外壳（顶栏 / Tab 栏 / 侧栏）夹住，
     夹具没有那层外壳，不钉住就会「正方形把根撑高 → 下一次读到的纵向预算更大」无限长大
     （实测每轮 +44px，8 轮就从 722 涨到 1030）。这是夹具的边界，不是产品契约。 */
  .battle-playback { width:100%; block-size:100dvh; overflow:hidden; }
  .pb-hud { min-height:48px; }
  .pb-left-rail { display:none; }
  .pb-main { width:100%; }
  .pb-map-stage { width:100%; }
  .pb-map { position:relative; width:100%; height:100%; min-width:0; min-height:1px; overflow:hidden; background:#090909; }
  .pb-viewport { position:absolute; inset:0; background:#2b3b2b; }
  .pb-side-panel-shell { min-width:0; min-height:0; }
  .pb-sidebar, .pb-side-panel { min-height:120px; }
  .pb-sidebar { background:#181818; border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); padding:var(--space-2); font:var(--type-caption); }
  .pb-sb-head { display:flex; justify-content:space-between; gap:var(--space-2); }
  .pb-sb-grid { display:grid; grid-template-columns:auto minmax(0,1fr); gap:var(--space-1) var(--space-2); margin:0; }
  .pb-sb-grid dd { margin:0; text-align:right; }
  .pb-mobile-overlay-content { min-height:72px; }
  .pb-transport-slot { display:block; }
  .pb-controls { display:flex; flex-wrap:nowrap; align-items:center; gap:var(--space-1); }
  .pb-btn { min-width:36px; min-height:36px; flex:none; }
  .pb-roster { display:grid; gap:var(--space-3); padding:var(--space-3); background:#181818; border-radius:var(--radius-sm); }
  .pb-roster-list { display:grid; gap:var(--space-1); margin:0; padding:0; }
  .pb-roster-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; grid-template-rows:auto auto; gap:0 var(--space-2); width:100%; min-height:var(--hit-min); padding:var(--space-1) var(--space-2); border:1px solid var(--color-border-subtle); border-radius:var(--radius-sm); background:#202020; text-align:start; }
  .pb-roster-row .nick { grid-column:1 / span 2; grid-row:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pb-roster-row .hpv { grid-column:2; grid-row:1; }
  .pb-roster-row .hpp { grid-column:3; grid-row:1; }
  .pb-roster-row .tank { grid-column:1 / span 2; grid-row:2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pb-roster-row .hpbar { grid-column:3; grid-row:2; width:52px; height:3px; background:#333; }
  .pb-team-head { margin:0 0 var(--space-1); font:var(--type-caption); }
  .pb-mobile-overlay { position:static; }
  .pb-mobile-overlay-transient { position:absolute; inset:0; z-index:25; pointer-events:none; opacity:0; }
  .pb-mobile-overlay-transient.pb-mobile-overlay-visible { opacity:1; }
  .pb-mobile-overlay-transient .pb-mobile-overlay-content { position:absolute; right:8px; bottom:8px; left:8px; display:none; pointer-events:none; }
  .pb-mobile-overlay-transient.pb-mobile-overlay-visible .pb-mobile-overlay-content { display:grid; pointer-events:auto; }
  /* 生产里这条来自 PlaybackMobileOverlay 的 scoped 样式：非全屏手机排在地图下方。 */
  @media (width < 1200px) {
    .battle-playback.pb-form-mobile:not(.pb-test-fullscreen) .pb-mobile-overlay { position:static; inset:auto; opacity:1; pointer-events:auto; }
  }
  /* 正方形边长的高度那一半：页面 chrome 的合计占用是**形态相关常量**（生产里由
     playback-workspace.css 的 --pb-square-chrome 给默认值、形态规则各自覆盖）。
     这里按夹具的真实 chrome 高度声明，几何才与生产一致。 */
  .pb-form-mobile { --pb-square-chrome: 168px; }
  .pb-form-tablet { --pb-square-chrome: 240px; }
  .pb-form-pc { --pb-square-chrome: 288px; }
</style>
<style>${productionCss}</style>
<style>
  /* 夹具的 Stage 必须**只是**正方形纵向约束的容器，不能自己再贡献一个高度上限。
     生产里 Stage 的定高来自形态文件（pc 是 'min(100dvh - header - 170px, 850px)'，
     选择器特异性 0,4,0），而夹具没有页面顶栏 / Tab 栏这两段 chrome，同一条公式会算出
     比真实可用高度更大的值（实测 804 高的视口里 Stage 578px、正方形 622px →
     正方形压住传输控件）。这里按形态文件的特异性覆盖块轴尺寸，把它钉在同一个权威量上：
     '--pb-square-avail-h'（由页面脚本按「根高 − HUD − 传输控件」写入，与生产的
     writeSquareAvailHeight 同一口径）。于是「正方形 = min(列宽, 纵向可用高度)」这条契约
     在夹具里是**可判定**的，而不是被一个夹具专有的常量偶然满足。
     写 'height' 而不是 'block-size'：两者在水平书写模式下映射到同一个逻辑属性，胜负只由
     （特异性, 源序）决定，而形态文件那条是 0,4,0 —— 低特异性的 'block-size' 即使在后面
     也照样输（实测仍算 578px）。这里用同一个特异性 + 更晚的源序。 */
  .battle-playback.pb-form-mobile .pb-main > .pb-map-stage,
  .battle-playback.pb-form-tablet .pb-main > .pb-map-stage,
  .battle-playback.pb-form-pc .pb-main > .pb-map-stage { height: var(--pb-square-avail-h); }
</style>
</head>
<body>
<div id="root" class="${rootClasses}">
  <section class="pb-hud">HUD</section>
  <main class="pb-main" data-test="pb-main">
${withRoster && scenario.layout !== 'portrait' ? ROSTER_MARKUP : ''}
    <div class="pb-map-stage" data-test="pb-map-stage">
      <div class="pb-map" data-test="pb-map"><div class="pb-viewport" data-test="pb-viewport"></div></div>
      ${detailsColumn ? '<div class="pb-side-panel-shell" data-test="pb-side-panel-shell"></div>' : ''}
    </div>
${withRoster && scenario.layout !== 'portrait' ? rightLaneMarkup : ''}
    ${detailsMarkup}
    <div class="pb-mobile-overlay"><div class="pb-mobile-overlay-content"><div class="pb-transport-slot" data-test="pb-transport-slot">${controlsMarkup}</div></div></div>
${scenario.layout === 'portrait' ? inlineArea : ''}
  </main>
</div>
<script type="module">
// 模块里的异常不会冒泡到 dump-dom 的输出里，页面只会「什么都没发布」。
// 捕获后写进 body 的 data-error，失败信息才可诊断（否则只能看到一句 published nothing）。
try {
  const root = document.getElementById('root')
  const main = root.querySelector('[data-test="pb-main"]')
  const stage = root.querySelector('[data-test="pb-map-stage"]')
  const map = root.querySelector('[data-test="pb-map"]')
  const lanes = root.querySelectorAll('.pb-team-lane')
  const leftLane = root.querySelector('.pb-team-lane-left')
  const rightLane = root.querySelector('.pb-team-lane-right')
  const laneDump = Array.from(lanes).map((el) => el.className + '|' + (el.dataset.test || '') + '|' + Math.round(el.getBoundingClientRect().width))
  const transport = root.querySelector('[data-test="pb-transport-slot"]')
  const hudEl = root.querySelector('.pb-hud')
  const details = root.querySelector('[data-test="pb-info"]')
  const inlineArea = root.querySelector('[data-test="pb-inline-area"]')
  const failures = []
  const require = (ok, message) => { if (!ok) failures.push(message) }
  const r = (el) => el ? el.getBoundingClientRect() : null
  const overlaps = (a, b) => !!(a && b) && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
  const metrics = {
    dbg: {},
  }
  /* ── 先把纵向预算**迭代到稳定**，再做任何断言 ─────────────────────────────
     生产里 '--pb-square-avail-h' 由 ResizeObserver 写入（见 BattlePlayback 的
     writeSquareAvailHeight）：workspace 根高度 − HUD − 传输控件。夹具没有那个 observer，
     所以脚本自己按同一定义迭代。
     为什么要迭代而不是读一次：写回预算会改变正方形 → 改变根高度 → 改变下一次读到的
     预算。生产里这条环路是收敛的（形态文件给 workspace 根定了高，根高度不随正方形走）；
     夹具里根高度由下面的 'block-size: 100dvh' 钉住，同样收敛，但**收敛前的那一轮读数
     仍然是混合几何**——迭代到稳定再断言，断言才是对同一份布局说的。
     迭代上限之后若仍未稳定，夹具直接报错，而不是让断言去猜。 */
  const budgetTrace = []
  let settled = false
  for (let i = 0; i < 8 && !settled; i++) {
    const budget = Math.round(r(root).height - r(hudEl).height - r(transport).height)
    const previous = parseFloat(root.style.getPropertyValue('--pb-square-avail-h')) || 0
    if (budget > 0) root.style.setProperty('--pb-square-avail-h', budget + 'px')
    void root.offsetHeight                       // 强制重排：下一次读数必须基于本轮预算
    budgetTrace.push(budget)
    settled = Math.abs(budget - previous) <= 1
  }
  require(settled, 'longitudinal budget did not settle (trace ' + budgetTrace.join(' -> ') + ')')
  const rectOf = (el) => {
    const x = r(el)
    return x ? { l: Math.round(x.left), t: Math.round(x.top), w: Math.round(x.width), h: Math.round(x.height) } : null
  }
  // ── 实际视口判定：headless Chrome 的 --window-size 并不等于布局视口（实测会被钳到
  //    504x716 / 500x281 一类），所以断言必须按**量到的**宽高分类，而不是按场景名。
  //    判据与 production 的 form factor 一致：宽 < 768 或 高 <= 500 即手机形态。
  const vw = innerWidth
  const vh = innerHeight
  const isPhone = vw < 768 || vh <= 500
  const isPortrait = vw < vh
  const phoneLandscape = isPhone && !isPortrait
  const layout = ${JSON.stringify(scenario.layout)}

  // ── 正方形 Stage：每个场景（含名册关闭）都必须成立 ─────────────────────
  const mapRect = r(map)
  require(mapRect && mapRect.width > 0, 'map must be measurable')
  require(mapRect && Math.abs(mapRect.width - mapRect.height) <= 2,
    'square stage: map must be 1:1 (got ' + (mapRect ? mapRect.width.toFixed(1) + 'x' + mapRect.height.toFixed(1) : 'none') + ')')

  // 正方形在它所在的中心列里**居中**（不是在整个 workspace 里：三段式下左右车道与留白
  // 本来就不对称，那属于车道布局，不属于 Stage 的对齐契约）。
  const stageRect = r(stage)
  if (stageRect && mapRect) {
    const leftGap = mapRect.left - stageRect.left
    const rightGap = stageRect.right - mapRect.right
    require(Math.abs(leftGap - rightGap) <= 4, 'square stage must be centred in its column (gaps ' + leftGap.toFixed(1) + '/' + rightGap.toFixed(1) + ')')
  }

  // ── 传输控件永远要在 Stage 下方，且不被其它东西压住 ─────────────────────
  const transportRect = r(transport)
  require(transportRect && transportRect.height > 0, 'transport slot must have height')
  require(!overlaps(mapRect, transportRect), 'transport must not overlap the stage')

  // ── 一级动作行不换行（齿轮不得掉到第二行） ────────────────────────────
  const buttons = Array.from(root.querySelectorAll('.pb-controls > .pb-btn, .pb-controls .pb-speed'))
  if (buttons.length) {
    const tops = buttons.map((el) => Math.round(r(el).top))
    const minTop = Math.min(...tops)
    const sameRow = tops.filter((top) => Math.abs(top - minTop) <= 2).length
    require(sameRow === buttons.length,
      'primary action row must not wrap: ' + buttons.length + ' controls spread over ' + new Set(tops).size + ' rows')
    const last = buttons[buttons.length - 1]
    require(r(last).right <= (r(root).right + 1) && r(last).left >= r(root).left - 1,
      'last primary control (secondary entry) must stay inside the workspace')
  }

  if (layout === 'landscape') {
    if (isPhone && isPortrait) {
      // 视口被无头 Chrome 钳成了竖屏：这一档的**权威契约**仍然是纵向流，
      // 所以只验证「正方形 + 传输在下方 + 一级行不换行」这三条共通底线。
      metrics.collapsedToPortrait = vw + 'x' + vh
    } else {
      require(lanes.length === 2, 'three-column layout must render exactly two roster lanes (got ' + lanes.length + ')')
      const leftRect = r(leftLane)
      const rightRect = r(rightLane)
      require(leftRect && leftRect.right <= mapRect.left + 1, 'Team 1 lane must sit left of the stage')
      require(rightRect && rightRect.left >= mapRect.right - 1, 'Team 2 lane must sit right of the stage')
      require(!overlaps(leftRect, mapRect) && !overlaps(rightRect, mapRect), 'roster lanes must not overlap the stage')
      require(!overlaps(leftRect, rightRect), 'roster lanes must not overlap each other')
      require(transportRect.top >= Math.min(leftRect ? leftRect.top : 0, mapRect.top), 'transport must stay below the workspace top')
      metrics.map = { w: Math.round(mapRect.width), h: Math.round(mapRect.height) }
      metrics.laneLeft = leftRect ? Math.round(leftRect.width) : null
      metrics.laneRight = rightRect ? Math.round(rightRect.width) : null
    }
    const gear = root.querySelector('[data-test="pb-secondary-entry"]')
    const fullscreen = root.querySelector('[data-test="pb-fullscreen"]')
    require(!!gear && !!fullscreen, 'primary row must keep both fullscreen and the secondary entry')
    require(Math.abs(r(gear).top - r(fullscreen).top) <= 2, 'gear and fullscreen must share one row')
  }

  if (layout === 'portrait') {
    require(lanes.length === 0, 'portrait must not render side lanes (纵向流 instead)')
    require(!!inlineArea, 'portrait must render the inline area')
    require(!overlaps(mapRect, r(inlineArea)), 'inline area must be below the stage')
    const inlineRect = r(inlineArea)
    require(inlineRect.top >= transportRect.bottom - 1, 'inline area must sit below the transport controls')
    require(stageRect.width > 0 && mapRect.width >= stageRect.width - 1, 'portrait stage must use the full column width')
  }

  if (layout === 'no-roster') {
    require(lanes.length === 0, 'roster off must remove both lanes entirely')
    require(!root.classList.contains('pb-roster-lanes'), 'roster off must not carry the lane layout class')
  }

  if (layout === 'floating-details') {
    require(!!details, 'floating details must be rendered at the workspace level')
    const detailsRect = r(details)
    const rootRect = r(root)
    require(detailsRect.left >= rootRect.left - 1 && detailsRect.top >= rootRect.top - 1,
      'floating details must stay inside the workspace (top-left)')
    require(detailsRect.right <= rootRect.right + 1 && detailsRect.bottom <= rootRect.bottom + 1,
      'floating details must stay inside the workspace (bottom-right)')
    require(!overlaps(detailsRect, transportRect), 'floating details must not cover the transport controls')
    require(details.parentElement === main,
      'floating details must be a workspace-level layer, not a child of a lane or the stage')
    // 拖到右下角：仍必须被夹回 workspace 内、且仍然不压住传输控件。
    // ⚠️ 这里必须**跑一次生产夹紧算法**，而不是只写一个越界坐标：浮窗在生产里是
    // usePlaybackDetailsPlacement.clampToBounds 的产物（left/top 由 JS 写内联样式），
    // 直接摆一个越界坐标只是在测「越界后会不会被裁」，等于把契约换成了另一个问题
    // （而且会让传输控件被推出 workspace，连带别的断言一起假失败）。
    // 夹具没有那个 composable，所以按同一定义重算（与 BattlePlayback 传的
    // dragHost=.pb-map-stage / dragBounds=.pb-transport-slot 同一对元素）。
    const detailsClamp = (() => {
      const hostRect = r(stage)
      const panelRect = r(details)
      const transportBox = r(transport)
      if (!hostRect || !panelRect || hostRect.width <= 0 || panelRect.width <= 0) return null
      const edge = 8
      const maxLeft = Math.max(edge, hostRect.width - panelRect.width - edge)
      let transportTop = hostRect.height
      if (transportBox && transportBox.height > 0) transportTop = Math.min(transportTop, transportBox.top - hostRect.top)
      const maxTop = Math.max(edge, Math.min(hostRect.height - edge, transportTop - edge) - panelRect.height)
      const draggedLeft = hostRect.width - panelRect.width + 400
      const draggedTop = hostRect.height - panelRect.height + 400
      const left = Math.round(Math.min(Math.max(draggedLeft, edge), maxLeft))
      const top = Math.round(Math.min(Math.max(draggedTop, edge), maxTop))
      details.style.left = left + 'px'
      details.style.top = top + 'px'
      return { left, top, maxLeft, maxTop }
    })()
    metrics.detailsClamp = detailsClamp
    const clampedRect = r(details)
    require(clampedRect.right <= r(stage).right + 1 && clampedRect.bottom <= r(stage).bottom + 1,
      'floating details must stay inside its drag host after a drag to the far corner')
    require(!overlaps(clampedRect, transportRect),
      'floating details must not cover the transport controls after a drag to the far corner')
  }

  require(document.documentElement.scrollWidth <= innerWidth + 1, 'layout must not create horizontal overflow')
  metrics.dbg = {
    view: vw + 'x' + vh,
    budgetTrace,
    stageCols: getComputedStyle(stage).gridTemplateColumns,
    stageChildren: stage.children.length,
    root: rectOf(root),
    main: rectOf(main),
    stage: rectOf(stage),
    map: rectOf(map),
    left: rectOf(leftLane),
    right: rectOf(rightLane),
    transport: rectOf(transport),
    inline: rectOf(inlineArea),
    laneCount: lanes.length,
    laneW: getComputedStyle(root).getPropertyValue('--pb-lane-w').trim(),
    laneGutter: getComputedStyle(root).getPropertyValue('--pb-lane-gutter').trim(),
    mainCols: getComputedStyle(main).gridTemplateColumns,
    mainDisplay: getComputedStyle(main).display,
    squareSide: getComputedStyle(map).getPropertyValue('--pb-square-side').trim(),
    availH: getComputedStyle(root).getPropertyValue('--pb-square-avail-h').trim(),
    mapInline: getComputedStyle(map).inlineSize,
    mapMaxInline: getComputedStyle(map).maxInlineSize,
    mapHeight: getComputedStyle(map).height,
    stageW: getComputedStyle(stage).inlineSize,
    stageMaxInline: getComputedStyle(stage).maxInlineSize,
    mqTabletNarrow: matchMedia('(width < 860px)').matches,
    mapParent: map.parentElement ? map.parentElement.className : '',
    mapW: getComputedStyle(map).inlineSize,
    mapRatio: getComputedStyle(map).aspectRatio,
    mapMaxW: getComputedStyle(map).maxInlineSize,
    stageDisplay: getComputedStyle(stage).display,
    stageH: getComputedStyle(stage).blockSize,
    rootGutter: getComputedStyle(root).getPropertyValue('--pb-lane-gutter').trim(),
    mq1200: matchMedia('(width >= 1200px)').matches,
    mqLandscapeShort: matchMedia('(orientation: landscape) and (height <= 500px)').matches,
    laneDump,
  }
  const result = { name: ${JSON.stringify(scenario.name)}, width: innerWidth, height: innerHeight, failures, metrics }
  document.body.dataset.result = btoa(JSON.stringify(result))
} catch (error) {
  document.body.dataset.error = String((error && error.stack) || error)
}
</script>
</body>
</html>`
}

export function runScenario(scenario, temp) {
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
  if (!match) {
    const error = output.match(/data-error="([^"]*)"/)
    return {
      name: scenario.name,
      failures: [`browser fixture did not publish a result${error ? `: ${error[1]}` : ''}`],
      metrics: {},
    }
  }
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
}

if (invokedDirectly) {
  const temp = mkdtempSync(resolve(tmpdir(), 'wotb-playback-workspace-'))
  try {
    for (const scenario of scenarios) {
      const result = runScenario(scenario, temp)
      if (result.failures.length) {
        throw new Error(`${scenario.name}:\n- ${result.failures.join('\n- ')}`)
      }
      console.log(`[browser-workspace] ${scenario.name} OK (${result.width}x${result.height})${Object.keys(result.metrics).length ? ` ${JSON.stringify(result.metrics)}` : ''}`)
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
