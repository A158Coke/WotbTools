import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { callPageFunction } from './browser-page.mjs'
import { parseScenarioArgs, selectShard } from './browser-scenario-args.mjs'
import { measureReachability } from './browser-occlusion.mjs'
import { MOBILE_PAGE_SCENARIOS, SHELL_OVERLAY_SCENARIOS, runMobilePageScenario, runShellOverlayScenario } from './browser-shell-overlays.mjs'
import { DIALOG_SHEET_SCENARIOS, DRAWER_EXIT_SCENARIOS, runDialogSheetScenario, runDrawerExitScenario } from './browser-dialog-sheet.mjs'
import { DRAWER_TABLE_SCENARIOS, runDrawerTableScenario } from './browser-drawer-tables.mjs'
import { CATALOG_HOF_DOC_SCENARIOS, runCatalogHofDocScenario } from './browser-catalog-hof-docs.mjs'
import { createWorkspace2DScenario } from './browser-workspace-2d.mjs'
import { createLifecycleScenarios } from './browser-workspace-lifecycle.mjs'
import { createPlaybackShellScenarios } from './browser-playback-shell.mjs'
import { createOnboardingScenarios } from './browser-onboarding-menu.mjs'
import { createCapabilityScenarios } from './browser-capabilities.mjs'
import { rosterLayoutSignature } from './browser-roster-probes.mjs'
import { createRosterGeometryScenario } from './browser-roster-geometry.mjs'

/**
 * Browser-level interaction regression for the Replay Workspace capability tabs and the
 * Battle Playback transport controls.
 *
 * 为什么必须是真浏览器：本次回归的两类症状（「点了没反应」、透明层吃掉 pointer）在 jsdom 里
 * 结构上不可见 —— jsdom 没有真实布局/层叠/hit-testing，`elementFromPoint` 恒为 null。
 * 因此这里启动真实 Chrome（独立 user-data-dir）、按设备指标仿真 mobile/tablet/desktop，
 * 用真实输入管线（原始 touch / mouse 序列）点击真实坐标，并断言
 * `document.elementFromPoint(按钮中心)` 确实命中按钮本身。
 *
 * 例外：`roster-geometry-*` 场景里对 3D 面板的开关点击走 `clickElement()`——它把
 * 「滚动进视口 + `elementFromPoint` 命中测试 + `el.click()`」压在**同一次 evaluate** 里。
 * 原因见该函数注释：分两步（先量坐标、再由 CDP 点击）会在 fixture 注入后 HUD 高度还在收敛时
 * 点到别的控件上。命中测试仍然是真浏览器语义（透明层/遮挡照样暴露），只是把 measure→click
 * 合成一步；纯坐标点击的覆盖由上面那些场景保留。
 *
 * 与 `browser-playback-layout.mjs` 的分工：
 *   - 那个是 file:// + 生产 CSS 的**几何**夹具（布局/尺寸契约）；
 *   - 本文件是 Vite dev server + **真实生产应用**（router/AppShell/ReplayWorkspace/全部 CSS）
 *     的**交互**夹具，替换 Keycloak / 解析 / 场景加载边界（browser-fixtures/*-stub.js）。
 */
const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

/**
 * 替换外部运行时边界。用 resolveId 插件而不是 `resolve.alias` 正则：
 * rollup alias 的 RegExp 分支只替换「匹配到的那一段」，先把已解析的真实文件定位出来
 * 再整体换掉，才不会拼出假路径。
 */
const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.ts'), resolve(here, 'browser-fixtures/use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.ts'), resolve(here, 'browser-fixtures/use-business-user-bootstrap-stub.js')],
  [resolve(frontendRoot, 'src/scene/playbackParse.worker.ts'), resolve(here, 'browser-fixtures/playback-parse-worker-stub.mjs')],
  [resolve(frontendRoot, 'src/api/agent-replay-facets.ts'), resolve(here, 'browser-fixtures/shot-handoff-stub.js')],
  [resolve(frontendRoot, 'src/scene/tankViewer.js'), resolve(here, 'browser-fixtures/armor-handoff-stub.js')],
])

/** 假文件场景专用：批次分析也换成替身，见 browser-fixtures/local-analysis-stub.js。 */
const LOCAL_ANALYSIS_STUBS = new Map([
  [resolve(frontendRoot, 'src/replay-local/parseReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
  [resolve(frontendRoot, 'src/replay-local/analyzeReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
])

// 这些映射按解析后的绝对路径匹配：源文件改名后替身会静默失效，门禁就会走真实实现。
for (const from of [...AUTH_BOUNDARY_STUBS.keys(), ...LOCAL_ANALYSIS_STUBS.keys()]) {
  if (!existsSync(from)) throw new Error(`Browser fixture stub source does not exist: ${from}`)
}

/** Vite 的 module id 在 Windows 上是正斜杠、可能带盘符前导斜杠，且大小写不敏感；比较前统一规整。 */
function normalizeId(id) {
  const forward = id.replace(/\\/g, '/').replace(/^\/+/, '')
  return process.platform === 'win32' ? forward.toLowerCase() : forward
}

function authBoundaryStubPlugin({ realReplay = false, fakeAnalysis = false } = {}) {
  const normalizedStubs = new Map([...AUTH_BOUNDARY_STUBS, ...(fakeAnalysis ? LOCAL_ANALYSIS_STUBS : [])]
    .filter(([, to]) => !realReplay || /use-(auth|business-user-bootstrap)-stub\.js$/.test(to))
    .map(([from, to]) => [normalizeId(from), to]))
  return {
    name: 'wotb-browser-fixture-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // 只接管「应用内部的相对 import」，不碰裸模块名（vue / vue-router / keycloak-js 等）：
      // stub 入口自己由测试用绝对路径 import，不会被这里接管。
      if (!importer || !source.startsWith('.')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved) return null
      return normalizedStubs.get(normalizeId(resolved.id.split('?')[0])) || null
    },
  }
}

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function startFixtureServer({ realReplay = false, fakeAnalysis = false } = {}) {
  const server = await createServer({
    configFile: resolve(frontendRoot, 'vite.config.js'),
    root: frontendRoot,
    // Stubbed dependency graphs must not invalidate an already-running developer server.
    cacheDir: resolve(frontendRoot, 'node_modules/.vite-browser-interaction'),
    logLevel: 'error',
    plugins: [authBoundaryStubPlugin({ realReplay, fakeAnalysis })],
    // Keep the production WASM pin and safe dev artifact middleware from the real Vite config.
    define: { __BUILD_COMMIT__: '"browser-fixture"', __BUILD_TIME__: '"browser-fixture"' },
    // 与 vite.config.js 一致：logo / icon / silent-check-sso 等 public 资源来自 common/assets。
    publicDir: resolve(frontendRoot, '../common/assets'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('fixture Vite server did not publish a local URL')
  return { server, origin: url.replace(/\/$/, '') }
}

let fakeAnalysisServer = null
/** 假文件场景的独立应用夹具；真实解析场景继续用主夹具。 */
async function fakeAnalysisOrigin() {
  if (!fakeAnalysisServer) fakeAnalysisServer = await startFixtureServer({ fakeAnalysis: true })
  return fakeAnalysisServer.origin
}

/* ------------------------------------------------------------------ 页面内探针
   写成真实函数再序列化执行，避免模板字符串里的转义错误。 */

function playbackControlProbe() {
  const play = document.querySelector('[data-test="pb-play"]')
  const root = document.querySelector('[data-test="battle-playback"]')
  if (!play) return { found: false, root: !!root }
  const rect = play.getBoundingClientRect()
  const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  const hit = document.elementFromPoint(center.x, center.y)
  const time = document.querySelector('[data-test="pb-time"]')
  const reason = document.querySelector('[data-test="pb-play-unavailable"]')
  const scene = document.querySelector('[data-scene-surface]')
  const sceneStyle = getComputedStyle(scene || document.documentElement)
  const minHit = parseFloat(sceneStyle.getPropertyValue('--hit-min-comfortable')) || 44
  const space4 = parseFloat(sceneStyle.getPropertyValue('--space-4')) || 16
  const compactScene = matchMedia('(pointer: coarse) and (orientation: landscape) and (height <= 520px)').matches
  // 视觉框只有 36px 时，紧凑档靠透明伪元素把命中区补到 40px。
  // 边界采样点本身是否算命中取决于亚像素取整，因此取目标框内缩 0.25px 的四边中点。
  const hitBoxAt = (button) => {
    const r = button.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const dx = minHit / 2 - 0.25, dy = minHit / 2 - 0.25
    const reaches = (x, y) => {
      // 控件贴住视口边缘时，边框最后 0.5px 会被 Chrome 的可命中区域裁掉；
      // 采样点限制在视口内 1px，避免把亚像素裁切误判成伪元素没有补足命中区。
      const px = Math.min(Math.max(x, 1), innerWidth - 1)
      const py = Math.min(Math.max(y, 1), innerHeight - 1)
      const hit = document.elementFromPoint(px, py)
      return hit === button || button.contains(hit)
    }
    return reaches(cx, cy) && reaches(cx - dx, cy) && reaches(cx + dx, cy)
      && reaches(cx, cy - dy) && reaches(cx, cy + dy)
  }
  return {
    found: true,
    disabled: play.disabled === true,
    ariaDisabled: play.getAttribute('aria-disabled'),
    unavailableReason: reason ? reason.textContent.trim() : null,
    time: time ? time.textContent.trim() : null,
    center,
    hitIsButton: hit === play || play.contains(hit),
    hitDescription: hit
      ? `${hit.tagName}${typeof hit.className === 'string' && hit.className.trim() ? `.${hit.className.trim().split(/\s+/).join('.')}` : ''}`
      : null,
    formClass: root ? Array.from(root.classList).find((name) => name.startsWith('pb-form-')) || null : null,
    /** 所有可见速度档位按钮都提供 minHit × minHit 的有效命中区（紧凑档 40 / 常规触屏 44） */
    speedHit: (() => {
      const buttons = [...document.querySelectorAll('button[data-test^="pb-speed-"]')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      return buttons.length ? buttons.every(hitBoxAt) : null
    })(),
    speedHitDetail: (() => {
      const buttons = [...document.querySelectorAll('button[data-test^="pb-speed-"]')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      return buttons.map((b) => {
        const r = b.getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const dx = minHit / 2 - 0.25, dy = minHit / 2 - 0.25
        const at = (x, y) => {
          const px = Math.min(Math.max(x, 1), innerWidth - 1)
          const py = Math.min(Math.max(y, 1), innerHeight - 1)
          const hit = document.elementFromPoint(px, py)
          return hit === b || b.contains(hit)
        }
        return { test: b.dataset.test, w: r.width, h: r.height, center: at(cx, cy), left: at(cx - dx, cy), right: at(cx + dx, cy), top: at(cx, cy - dy), bottom: at(cx, cy + dy) }
      })
    })(),
    /** 速度档位菜单展开后必须一行排开且不越出自身容器（档位个数变化时的回归点） */
    speedMenu: (() => {
      const group = document.querySelector('.pb-speed-menu')
      if (!group) return null
      const limit = group.getBoundingClientRect()
      const items = [...group.querySelectorAll('.pb-speed-menu [data-test^="pb-speed-"]')]
      const buttons = items.map((b) => b.getBoundingClientRect())
      if (!buttons.length) return null
      return {
        count: buttons.length,
        overflow: buttons.some((r) => r.left < limit.left - 1 || r.right > limit.right + 1 || r.top < limit.top - 1 || r.bottom > limit.bottom + 1),
        minSide: Math.min(...buttons.map((r) => Math.min(r.width, r.height))),
        minWidth: Math.min(...buttons.map((r) => r.width)),
        expectedWidth: compactScene ? minHit + space4 : minHit,
        allHit: items.every(hitBoxAt),
      }
    })(),
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    /** 排除滚动条后的真实内容宽度：区分「真横向溢出」与 innerWidth 含滚动条的假阳性。 */
    contentWidth: document.documentElement.clientWidth,
    /** 横向溢出时直接点名越界的元素，避免只报一个差值。 */
    overflowing: (() => {
      const limit = document.documentElement.clientWidth
      const offenders = []
      for (const element of document.body.querySelectorAll('*')) {
        const r = element.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right > limit + 1 || r.left < -1) {
          const cls = typeof element.className === 'string' && element.className.trim()
            ? `.${element.className.trim().split(/\s+/).join('.')}`
            : ''
          offenders.push(`${element.tagName}${cls}[${Math.round(r.left)}..${Math.round(r.right)}]`)
          if (offenders.length >= 6) break
        }
      }
      return offenders
    })(),
    /** 几何诊断：控件被挤出视口时，直接指出是谁把它推下去的。 */
    geometry: (() => {
      const box = (selector) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const r = element.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }
      }
      return {
        mapStage: box('.pb-map-stage'),
        map: box('.pb-map'),
        overlay: box('.pb-mobile-overlay'),
        overlayContent: box('.pb-mobile-overlay-content'),
        playTop: Math.round(rect.top),
        playBottom: Math.round(rect.bottom),
      }
    })(),
  }
}

/* ------------------------------------------------------------------ 页面驱动 */

class Page {
  constructor(client, sessionId) {
    this.client = client
    this.sessionId = sessionId
    this.consoleErrors = []
    client.on('Runtime.exceptionThrown', (params, session) => {
      if (session !== sessionId) return
      this.consoleErrors.push(`uncaught: ${params.exceptionDetails?.exception?.description || params.exceptionDetails?.text}`)
    })
    client.on('Runtime.consoleAPICalled', (params, session) => {
      if (session !== sessionId || params.type !== 'error') return
      this.consoleErrors.push(`console.error: ${(params.args || []).map((arg) => arg.value ?? arg.description).join(' ')}`)
    })
  }

  async enable({ locale = 'zh', profile = 'summer' } = {}) {
    await this.client.send('Runtime.enable', {}, this.sessionId)
    await this.client.send('Page.enable', {}, this.sessionId)
    // 页面共享 origin 的 localStorage；每个场景都在首屏前设置自己的偏好，避免矩阵污染后续场景。
    await this.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('wotb-lang', ${JSON.stringify(locale)}); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(profile)});`,
    }, this.sessionId)
  }

  async evaluate(expression) {
    const { result, exceptionDetails } = await this.client.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }, this.sessionId)
    if (exceptionDetails) {
      throw new Error(`page exception: ${exceptionDetails.exception?.description || exceptionDetails.text}`)
    }
    return result.value
  }

  /** 以 CDP 参数调用页面函数，参数不进入表达式源码。 */
  callWith(fn, ...args) {
    return callPageFunction(this.client, this.sessionId, fn, ...args)
  }

  /** 序列化执行 `fn()`（探针不依赖闭包，因此可以安全地跨进程传递）。 */
  probe(fn) {
    return this.evaluate(`(${fn.toString()})()`)
  }

  /**
   * 轮询页面表达式直到 predicate 成立。
   * navigate 期间执行上下文会被销毁，`Runtime.evaluate` 会失败 —— 那是预期噪声，重试即可。
   */
  async waitForValue(expression, predicate, { timeout = 20_000, label = expression } = {}) {
    const deadline = Date.now() + timeout
    let last
    let lastError = null
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression)
        lastError = null
        if (predicate(last)) return last
      } catch (error) {
        lastError = error
      }
      await delay(50)
    }
    throw new Error(`timeout waiting for ${label}; last=${JSON.stringify(last)}${lastError ? ` error=${lastError.message}` : ''}`)
  }

  waitFor(conditionFn, options) {
    return this.waitForValue(`(${conditionFn.toString()})()`, (value) => value === true, options)
  }

  async emulate(scenario) {
    const touch = scenario.touch !== false
    await this.client.send('Emulation.setDeviceMetricsOverride', {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: scenario.deviceScaleFactor ?? 3,
      mobile: touch,
    }, this.sessionId)
    await this.client.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 }, this.sessionId)
  }

  async goto(url) {
    await this.client.send('Page.navigate', { url }, this.sessionId)
    await this.waitForValue('document.readyState', (value) => value === 'complete', { label: 'document readyState=complete' })
  }

  /** 场景失败时的现场快照：页面异常 + 关键状态位，避免「timeout 但不知道为什么」。 */
  async diagnose() {
    const state = await this.probe(function diagnosticsProbe() {
      const present = (selector) => !!document.querySelector(selector)
      return {
        authStubLoaded: typeof window.__wsAuth === 'object' && window.__wsAuth !== null,
        appMounted: !!document.querySelector('#app')?.firstElementChild,
        tabs: document.querySelectorAll('[data-testid="ws-tab"]').length,
        dataPane: present('[data-testid="ws-data"]'),
        playbackPane: present('[data-testid="ws-playback"]'),
        inputTrace: window.__wsInput || null,
        url: location.href,
      }
    }).catch(() => null)
    return [`page state: ${JSON.stringify(state)}`, `page errors: ${this.consoleErrors.join(' | ') || '(none)'}`]
  }

  /**
   * 真实输入管线点击。
   *
   * 只用原始事件注入（touch 序列 / 鼠标序列），**不用 `Input.synthesizeTapGesture`**：
   * 本机 Chrome 上该 API 只派发 touch 事件、不合成兼容 click（已实测：连 topbar 控制组
   * 按钮也拿不到 click），会让「点击是否真的产生行为」这条断言全部假阳性。
   */
  async tap(point) {
    const touch = point.touch !== false
    if (touch) {
      await this.client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
      }, this.sessionId)
      await delay(40)
      await this.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, this.sessionId)
    } else {
      await this.client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, this.sessionId)
      await this.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, this.sessionId)
      await delay(40)
      await this.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, this.sessionId)
    }
    await delay(150)
  }

  /**
   * 记录**真实输入事件**实际落到哪个元素上。
   * 这是「click/touch 真的到达 button」的权威证据 —— 比 `elementFromPoint` 更强，
   * 因为它证明的是输入管线真实派发的 target，而不是静态几何。
   */
  async installInputTrace() {
    await this.evaluate(`(() => {
      const describe = (element) => {
        if (!element || !element.closest) return null
        const cap = element.closest('[data-cap]')
        const testId = element.closest('[data-testid]')
        const test = element.closest('[data-test]')
        return {
          tag: element.tagName,
          cap: cap ? cap.getAttribute('data-cap') : null,
          testId: testId ? testId.getAttribute('data-testid') : null,
          test: test ? test.getAttribute('data-test') : null,
        }
      }
      window.__wsInput = { primary: null, click: null, clickCount: 0, pointers: [] }
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        document.addEventListener(type, (event) => {
          window.__wsInput.pointers.push({ type, ...describe(event.target), x: event.clientX, y: event.clientY })
        }, true)
      }
      const recordPrimary = (event) => { window.__wsInput.primary = describe(event.target) }
      document.addEventListener('touchstart', recordPrimary, true)
      document.addEventListener('mousedown', recordPrimary, true)
      document.addEventListener('click', (event) => {
        window.__wsInput.click = { ...describe(event.target), x: event.clientX, y: event.clientY }
        window.__wsInput.clickCount += 1
      }, true)
      return true
    })()`)
  }

  inputTrace() {
    return this.evaluate('window.__wsInput')
  }

  /**
   * 把控件滚进视口后再探针。用于「非全屏横屏地图高于视口」这类形态：
   * 判定标准是「可滚动触达 + 触达后真的可点」，而不是「永远在首屏」。
   */
  async revealControl(selector) {
    await this.callWith((sel) => {
      const el = document.querySelector(sel)
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      return !!el
    }, selector)
    await delay(200)
    return this.probe(playbackControlProbe)
  }

  resetInputTrace() {
    return this.evaluate('window.__wsInput = { primary: null, click: null, clickCount: 0, pointers: [] }; window.__wsInput')
  }

  async pressH() {
    await this.client.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72,
    }, this.sessionId)
    await this.client.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72,
    }, this.sessionId)
    await delay(100)
  }
}

const results = []

/** 最近一次创建的场景页面：场景抛错时用它打印现场（诊断用，不参与断言）。 */
let lastPage = null

/**
 * 原子「命中测试 + 点击」：几何与 `el.click()` 在同一次 Runtime.evaluate 里完成，
 * 中间不给事件循环任何机会。分两步（先量坐标、再由 CDP 点击）在 1024x768 上必翻车：
 * fixture 注入后 HUD 高度还在收敛，量到的 y 在点击时已经落到另一个复选框上。
 * 命中测试仍然证明"目标没有被遮住"（真点击语义），只是把 measure→click 压成一步。
 *
 * 若目标在可滚动容器（.display-panel）内，先在容器内把它滚进可视区；若目标整体在视口外
 * （矮窗口里 .pb-root 会被推到视口外），先把页面滚到它可见——真机上用户也是这么点的。
 */
function clickElement(page, selector) {
  return page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return 'missing'
    if (el.closest('.pb-annot-compact') && !el.matches('.pb-annot-close')) {
      el.scrollIntoView({ block: 'nearest', inline: 'center' })
    }
    const panel = el.closest('.display-panel')
    if (panel && panel.scrollHeight > panel.clientHeight + 1) {
      const pr = panel.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      if (er.bottom > pr.bottom - 2 || er.top < pr.top + 2) panel.scrollTop += (er.top - pr.top) - 4
    }
    let r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > innerHeight) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      r = el.getBoundingClientRect()
    }
    if (r.width < 1 || r.height < 1) return 'zero-size'
    const cx = Math.round(r.left + r.width / 2)
    const cy = Math.round(r.top + r.height / 2)
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return 'outside-viewport:' + cx + ',' + cy
    const hits = (x, y) => { const h = document.elementFromPoint(x, y); return { h, ok: h === el || el.contains(h) || (h && h.contains(el)) } }
    let probe = hits(cx, cy)
    let px = cx, py = cy
    if (!probe.ok && !panel) {
      // 被固定的页面外壳（吸顶标题 / 底部 Tab 栏）挡住：像用户一样把它滚到视口中部再点。
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r2 = el.getBoundingClientRect()
      px = Math.round(r2.left + r2.width / 2)
      py = Math.round(r2.top + r2.height / 2)
      probe = hits(px, py)
    }
    if (!probe.ok) {
      return 'occluded-by:' + (probe.h ? probe.h.tagName + '.' + (probe.h.className || '') : 'null')
    }
    el.click()
    return 'clicked@' + px + ',' + py
  })()`)
}

const clicked = (result) => typeof result === 'string' && result.startsWith('clicked')
function check(failures, ok, message) {
  if (!ok) failures.push(message)
}

/** 场景根的有效触控下限：紧凑档 40px，常规触屏 44px；普通内容页不读场景 token。 */
async function sceneHitTarget(page) {
  const value = await page.evaluate(`(() => {
    const scene = document.querySelector('[data-scene-surface]')
    if (!scene) return 44
    const token = parseFloat(getComputedStyle(scene).getPropertyValue('--hit-min-comfortable'))
    return Number.isFinite(token) && token > 0 ? token : 44
  })()`)
  return value
}

/* ------------------------------------------------------------------ 场景 */

const ROSTER_GEOMETRY_SCENARIOS = [
  { name: 'roster-geometry-1600x900-desktop', width: 1600, height: 900, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side' },
  { name: 'roster-geometry-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-1024x768-tablet', width: 1024, height: 768, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side' },
  { name: 'roster-geometry-375x812-portrait-coarse', width: 375, height: 812, touch: true, players: 7, unknown: 0, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-390x844-portrait-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 2, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-390x844-portrait-fullscreen-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 2, killfeed: 3, layout: 'portrait', fullscreen: true },
  { name: 'roster-geometry-740x360-landscape-coarse', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-740x360-fullscreen-coarse', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-844x390-landscape-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-portrait-to844x390-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', rotateTo: { width: 844, height: 390 } },
  { name: 'roster-geometry-667x375-landscape-coarse', width: 667, height: 375, touch: true, players: 7, unknown: 0, killfeed: 0 },
  { name: 'roster-geometry-740x360-distance-ru-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', toggleFullscreen: true },
  { name: 'roster-geometry-740x360-distance-ru-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-ru-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', toggleFullscreen: true },
  { name: 'roster-geometry-844x390-distance-ru-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'top' },
  { name: 'roster-geometry-740x360-distance-ru-free-fullscreen', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', fullscreen: true },
  { name: 'roster-geometry-844x390-distance-ru-free-fullscreen', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'ru', camera: 'free', fullscreen: true },
  { name: 'roster-geometry-740x360-distance-zh-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'free' },
  { name: 'roster-geometry-740x360-distance-zh-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'top' },
  { name: 'roster-geometry-740x360-distance-en-free', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'free' },
  { name: 'roster-geometry-740x360-distance-en-top', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-zh-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'free' },
  { name: 'roster-geometry-844x390-distance-zh-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'zh', camera: 'top' },
  { name: 'roster-geometry-844x390-distance-en-free', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'free' },
  { name: 'roster-geometry-844x390-distance-en-top', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', locale: 'en', camera: 'top' },
  { name: 'roster-geometry-1280x720-desktop', width: 1280, height: 720, touch: false, players: 7, unknown: 2, killfeed: 0 },
  { name: 'roster-geometry-1280x800-desktop', width: 1280, height: 800, touch: false, players: 7, unknown: 2, killfeed: 0, killfeedRows: 2 },
  { name: 'roster-geometry-1280x704-desktop', width: 1280, height: 704, touch: false, players: 7, unknown: 2, killfeed: 0, killfeedRows: 2 },
  { name: 'roster-geometry-1280x660-desktop', width: 1280, height: 660, touch: false, players: 7, unknown: 2, killfeed: 0 },
  { name: 'roster-geometry-1024x460-short', width: 1024, height: 460, touch: false, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
]

const PLAYBACK_SCENARIOS = [
  { name: 'play-390x844-coarse', width: 390, height: 844, touch: true, duration: 60, form: 'pb-form-mobile' },
  // §form-factor：手机横屏内宽 >768 仍必须是 mobile 形态，不能落进 tablet/pc。
  { name: 'play-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 60, form: 'pb-form-tablet' },
  // 审计 PB-07：iPad 横屏是触屏但有平板的可用空间，必须拿 tablet 形态（触屏只放大点击区域）
  { name: 'play-1024x768-ipad-coarse', width: 1024, height: 768, touch: true, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1440x900-desktop', width: 1440, height: 900, touch: false, duration: 60, form: 'pb-form-pc' },
  // 触屏 + 大平板（iPad Pro / Android 平板横屏）走 pc 形态：六个 primary 控件仍在 Stage 之下的
  // 中心列，速度档位展开后每个都满足 44px 点击区域（触屏自动放大 --control-h-*）。
  { name: 'play-1366x1024-tablet-coarse', width: 1366, height: 1024, touch: true, duration: 60, form: 'pb-form-pc' },
  { name: 'duration-zero-390x844-coarse', width: 390, height: 844, touch: true, duration: 0, form: 'pb-form-mobile' },
]

/** §form-factor：竖屏 → 横屏旋转后 class / hit target 必须重新正确计算，不留 stale 状态。 */
const ROTATION_SCENARIO = {
  name: 'orientation-portrait-to-landscape-coarse',
  width: 390, height: 844, touch: true, duration: 60,
  rotateTo: { width: 844, height: 390 },
}

/** 3D 手机横屏所有常驻交互浮层的实际矩形（相对视口）。 */
async function waitForStableLayout(page, { timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout
  let previous = null
  let stableReads = 0
  while (Date.now() < deadline) {
    const current = await page.evaluate(`(${rosterLayoutSignature.toString()})()`).catch(() => null)
    if (current && current === previous) {
      stableReads += 1
      if (stableReads >= 2) return current
    } else {
      stableReads = 0
    }
    previous = current
    await delay(100)
  }
  return previous
}

async function runPlaybackControlScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  const sceneHit = await sceneHitTarget(page)

  const before = await page.probe(playbackControlProbe)
  // §landscape：非全屏手机横屏时地图按宽度定尺寸，方形地图可以比视口还高，
  // controls 因此排在首屏之外。要求不是「永远在首屏」，而是「可以滚动到并真的可点」。
  const control = before.hitIsButton ? before : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `play button center hit ${control.hitDescription} instead (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  // 命中区必须在档位控件真正进入视口后测量：1024×768 平板的地图高于视口，
  // 控件条会换行且档位可能在首屏之外；此时 elementFromPoint 返回 null 是可达性问题，
  // 不是命中区问题。先滚到档位控件本身，再判定 44×44 的可点范围。
  const speed = scenario.touch && !control.speedHit
    ? await page.revealControl('[data-test="pb-speed-current"]')
    : control
  if (scenario.touch && speed.speedHit != null) {
    check(failures, speed.speedHit,
      `touch speed option must expose a ${sceneHit}x${sceneHit} hit target: ${JSON.stringify(speed.speedHitDetail)}`)
  }
  // 速度档位是渐进披露：常驻只有当前值，展开后是一列档位菜单——档位齐全、不越出自身容器、
  // 触屏每个档位都满足场景命中下限（紧凑档 40px、常规触屏 44px）。菜单是覆盖层，不参与控件条高度。
  {
    await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]')?.click()`)
    await delay(150)
    const menu = await page.probe(playbackControlProbe)
    check(failures, !!menu.speedMenu, 'speed options must open on demand from the current value')
    if (menu.speedMenu) {
      check(failures, menu.speedMenu.count === 5,
        `speed menu must list every shared speed: ${JSON.stringify(menu.speedMenu)}`)
      check(failures, !menu.speedMenu.overflow, 'speed options overflow their menu')
      if (scenario.touch) {
        check(failures, menu.speedMenu.allHit,
          `touch speed option must expose a ${sceneHit}x${sceneHit} hit target: ${JSON.stringify(menu.speedMenu)}`)
        check(failures, menu.speedMenu.minWidth >= menu.speedMenu.expectedWidth - 0.5,
          `touch speed menu option width is ${menu.speedMenu.minWidth.toFixed(1)}px, below ${menu.speedMenu.expectedWidth}px: ${JSON.stringify(menu.speedMenu)}`)
      }
    }
    await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]')?.click()`)
    await delay(150)
  }
  check(failures, before.pageScrollWidth <= before.viewportWidth + 1,
    `page-level horizontal overflow: ${before.pageScrollWidth} > ${before.viewportWidth} (contentWidth=${before.contentWidth} overflowing=${JSON.stringify(before.overflowing)})`)
  if (scenario.form) check(failures, before.formClass === scenario.form, `form factor class=${before.formClass}, expected ${scenario.form}`)

  if (scenario.duration > 0) {
    check(failures, control.disabled === false, 'play button must be enabled when the timeline is usable')
    await page.installInputTrace()
    await page.tap({ ...control.center, touch: scenario.touch })
    const input = await page.inputTrace()
    check(failures, input?.click?.test === 'pb-play',
      `the real click landed on ${JSON.stringify(input?.click)} instead of the play button`)
    const advanced = await page
      .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== control.time, { timeout: 5000, label: 'clock advancing after play tap' })
      .catch(() => null)
    check(failures, advanced !== null, `play tap was a silent no-op: clock stayed ${control.time}`)
  } else {
    // duration<=0 是不可用时间线：控件必须显式不可用并给出原因，不得「看起来能用但什么都不发生」。
    check(failures, control.disabled === true || control.ariaDisabled === 'true',
      `duration<=0 but the play button still looks enabled (disabled=${control.disabled} aria-disabled=${control.ariaDisabled})`)
    check(failures, !!control.unavailableReason, 'duration<=0 without an explicit unavailable reason in the UI')
    await page.tap({ ...control.center, touch: scenario.touch })
    const after = await page.probe(playbackControlProbe)
    check(failures, after.time === control.time, `unavailable play button still moved the clock: ${control.time} -> ${after.time}`)
  }

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, xfail: scenario.xfail })
}

async function runRotationScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-play"]'), { label: 'playback controls' })
  const portrait = await page.probe(playbackControlProbe)
  check(failures, portrait.formClass === 'pb-form-mobile', `portrait form=${portrait.formClass}`)

  // 旋转：同一页面，只改 viewport —— 模拟真机 orientationchange。
  await page.emulate({ ...scenario, ...scenario.rotateTo })
  const rotated = await page.waitForValue(
    `(() => { const root = document.querySelector('[data-test="battle-playback"]'); return root ? (Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null) : null })()`,
    (value) => value !== null,
    { timeout: 5000, label: 'form class after rotation' },
  )
  check(failures, rotated === 'pb-form-mobile',
    `after rotating to ${scenario.rotateTo.width}x${scenario.rotateTo.height} form=${rotated}; coarse-pointer phones must never fall into tablet/pc`)

  const after = await page.probe(playbackControlProbe)
  check(failures, await page.evaluate(`!!document.querySelector('[data-test="pb-speed-current"]')
    && !document.querySelector('.pb-speed .pb-btn')`), '2D rotated phone must retain compact speed picker')
  check(failures, after.pageScrollWidth <= after.viewportWidth + 1,
    `after rotation page-level horizontal overflow: ${after.pageScrollWidth} > ${after.viewportWidth} (contentWidth=${after.contentWidth} geometry=${JSON.stringify(after.geometry)})`)
  const control = after.hitIsButton ? after : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `after rotation the play button center hit ${control.hitDescription} (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  await page.installInputTrace()
  await page.tap({ ...control.center, touch: scenario.touch })
  const input = await page.inputTrace()
  check(failures, input?.click?.test === 'pb-play',
    `after rotation the real click landed on ${JSON.stringify(input?.click)} instead of the play button`)
  const advanced = await page
    .waitForValue('document.querySelector(\'[data-test="pb-time"]\').textContent.trim()', (value) => value !== control.time, { timeout: 5000, label: 'clock advancing after rotation' })
    .catch(() => null)
  check(failures, advanced !== null, `after rotation the play tap was a silent no-op: clock stayed ${control.time}`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `rotate ${scenario.width}x${scenario.height} -> ${scenario.rotateTo.width}x${scenario.rotateTo.height}` })
}

/**
 * §mobile-fullscreen：手机横屏全屏与**非全屏横屏是同一个几何**——Team 1 | 正方形 Stage | Team 2，
 * 播放控件在 Stage 之下，没有常驻左栏；⚙ 打开的是锚定在 gear 上的 Display 浮面。
 * 早先「148px navigation rail | map」的模型已整体移除，这里锁的是替代它的契约：
 * 全屏本身不产生任何常驻侧栏，⚙ 的浮面既不离开 gear 也不越出视口。
 */
/**
 * §2d-toolbar-collapse / §roster-overlay：2D 工具栏折叠与名册浮层的真浏览器交互回归。
 * 夹具 = playback-controls.html（生产 BattlePlayback + 生产 CSS）：
 *   · 手机横屏默认收纳名册、Desktop / 平板默认展开；
 *   · 传输条折叠后只剩恢复入口（命中测试必须命中按钮本身）；
 *   · 名册浮层开合不得改变地图正方形面积（mapShare 独立度量），浮层不得盖住传输控件；
 *   · 展开状态下选中名册行、+5s seek 与播放都必须继续正确。
 */
const MOBILE_FULLSCREEN_SCENARIOS = [
  { name: 'fullscreen-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60 },
]

async function runMobileFullscreenScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=${scenario.duration}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-fullscreen"]'), { label: 'fullscreen button' })
  await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
  const button = await page.evaluate(`(() => {
    const r = document.querySelector('[data-test="pb-fullscreen"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  // 真实触摸 = user gesture，requestFullscreen 才会被浏览器放行
  await page.tap({ ...button, touch: scenario.touch })
  await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'document.fullscreenElement' })
  await delay(200)

  const state = await page.evaluate(`(() => {
    const root = document.querySelector('[data-test="battle-playback"]')
    return {
      fullscreenIsRoot: document.fullscreenElement === root,
      formClass: Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null,
      displayOpen: !!document.querySelector('[data-testid="display-panel"]'),
    }
  })()`)
  check(failures, state.fullscreenIsRoot, 'fullscreen element is not the playback root')
  check(failures, state.formClass === 'pb-form-mobile', `fullscreen form=${state.formClass}, expected pb-form-mobile`)
  check(failures, !state.displayOpen, 'mobile fullscreen must not open the Display surface before ⚙')
  // 手机全屏与非全屏横屏同一个几何（Team 1 | 正方形 Stage | Team 2）：⚙ 打开的是锚定在
  // gear 上的 workspace 级浮面，不是常驻左栏，也不改变三段式布局。
  await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]').click()`)
  await delay(200)
  const drawer = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (!panel) return null
    const r = panel.getBoundingClientRect()
    const gear = document.querySelector('[data-testid="display-toggle"]').getBoundingClientRect()
    return {
      width: r.width,
      position: getComputedStyle(panel).position,
      distance: Math.hypot(Math.max(0, r.left - gear.right, gear.left - r.right), Math.max(0, r.top - gear.bottom, gear.top - r.bottom)),
      insideViewport: r.left >= -1 && r.right <= innerWidth + 1,
    }
  })()`)
  check(failures, !!drawer && drawer.width > 0 && drawer.position === 'absolute',
    `⚙ must open the Display surface as an anchored overlay in mobile fullscreen: ${JSON.stringify(drawer)}`)
  check(failures, !!drawer && drawer.distance <= 16,
    `Display must stay anchored to gear in mobile fullscreen: ${JSON.stringify(drawer)}`)
  check(failures, !!drawer && drawer.insideViewport,
    `Display must stay inside the viewport in mobile fullscreen: ${JSON.stringify(drawer)}`)

  // 全屏中经导航抽屉离开：回放被 v-show 缓存、不卸载，只收到 active=false。
  // 必须由真实 Fullscreen API 退出，否则新页面被挡在旧 fullscreen root 后面。
  await page.evaluate(`window.__pbFixture.setActive(false)`)
  const exited = await page.waitFor(() => !document.fullscreenElement, { timeout: 5000, label: 'fullscreen exits on deactivate' })
    .then(() => true, () => false)
  check(failures, exited, 'deactivating the playback (active=false) must exit its own fullscreen')

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `fullscreen ${scenario.width}x${scenario.height}` })
}

/* ------------------------------------------------------------------ 解析生命周期（P0） */

/**
 * A → 清空 → B 的**真实在途**生命周期回归（线上 P0：replay parser lifecycle is not
 * session-owned）。
 *
 * 与同文件 roster-geometry 场景里那段「A → 清空 → B」的区别（review 指出的覆盖缺口）：
 * 那段必须先把 A 等成 `err` / `hasData` 才能注入就绪态，所以 clear 时 A 早已 settled——
 * 它证明的是"结算完之后再换文件"，**没有**覆盖线上真实故障序列：
 *
 *     A 正在解析（Worker 不回包）→ 用户清空 / 换 B → A 必须被真正撤下 → B 必须能继续
 *
 * 这里用 fixture Worker（`playback-parse-worker-stub.mjs`，经 `?debug` 的
 * `__setParseWorkerForTest` 注入点替换 Worker 来源）把 A 确定性地挂在 in-flight：
 * 不依赖真实网络随机卡顿，也不等 A 的 `err` / `hasData`。全程真实用户路径（工作台文件
 * 选择 → 3D 能力页 → 真实点击「开始」→ 真实点击 remove chip → 再选 B → 再点「开始」），
 * 只把 Worker 的实现换成可控闸门。
 *
 * 关键断言：
 *  1. clear 那一刻 A 仍在解析（store.loading、无 err/hasData）且请求已到 Worker；
 *  2. clear 真的撤下 A：Worker 被 terminate（生产代码的 abort 路径）；
 *  3. B 重新发起解析并**自己**收敛（hasData，无 err）——旧解析不占队列；
 *  4. 放行 A 的迟到回包 → 无人认领（不被 B 或任何会话消费）。
 */
/** Foreground event wiring through the real workspace and 3D pane; events are
 * simulated in Chrome and do not claim OS/WebView background behavior. */
async function runSceneActivityScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  try {
    await page.goto(`${await fakeAnalysisOrigin()}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
    await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="3d"]'), { label: 'capability tabs' })
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="select-files-input"]')
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'activity.wotbreplay'))
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    const tab = await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="3d"]'), Boolean, { label: '3D capability tab' })
    await page.tap({ ...tab, touch: scenario.touch })
    await page.waitFor(() => !!window.__pbPane?.sceneApi, { label: '3D scene' })
    await page.evaluate(`(() => {
      const scene = window.__pbPane.sceneApi
      const setPaused = scene.setPaused.bind(scene)
      const setPlaying = scene.setPlaying.bind(scene)
      window.__activityProbe = { scene, pauses: [], plays: [], visibility: 'visible' }
      scene.setPaused = value => { window.__activityProbe.pauses.push(value); return setPaused(value) }
      scene.setPlaying = value => { window.__activityProbe.plays.push(value); return setPlaying(value) }
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__activityProbe.visibility })
    })()`)
    await page.evaluate(`window.__activityProbe.visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))`)
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === true, { label: 'hidden scene pauses' })
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide')); window.__activityProbe.visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'))`)
    // A settled task boundary lets Vue flush both events before checking no resume.
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 0))')
    check(failures, await page.evaluate('window.__activityProbe.pauses.at(-1)') === true, 'visibility alone must not resume a pagehidden scene')
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow'))`)
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === false, { label: 'shown scene resumes' })
    check(failures, await page.evaluate('window.__activityProbe.scene === window.__pbPane.sceneApi'), 'foreground transition must reuse scene')
    check(failures, await page.evaluate('window.__activityProbe.plays.length') === 0, 'foreground transition must preserve playback intent')
    const data = await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="data"]'), Boolean, { label: 'data capability tab' })
    await page.tap({ ...data, touch: scenario.touch })
    await page.waitForValue('window.__activityProbe.pauses.at(-1)', value => value === true, { label: 'inactive 3D scene pauses' })
    await page.evaluate(`window.dispatchEvent(new PageTransitionEvent('pagehide')); window.dispatchEvent(new PageTransitionEvent('pageshow'))`)
    await page.evaluate('new Promise(resolve => setTimeout(resolve, 0))')
    check(failures, await page.evaluate('window.__activityProbe.pauses.at(-1)') === true, 'foreground transition must not resume inactive 3D scene')
    check(failures, await page.evaluate('window.__activityProbe.plays.length') === 0, 'capability switch must preserve playback intent')
    results.push({ name: scenario.name, failures: [...failures, ...page.consoleErrors], viewport: `${scenario.width}x${scenario.height}` })
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
}

const FORCED_UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
}
const FORCED_LANDSCAPE_SCENARIOS = [
  { name: 'forced-landscape-iphone-portrait', ua: 'iphone', width: 390, height: 664, touch: true, expectPrompt: true },
  { name: 'forced-landscape-ipad-portrait', ua: 'ipad', width: 820, height: 1180, touch: true, expectPrompt: false },
  { name: 'forced-landscape-desktop-narrow', ua: 'desktop', width: 390, height: 664, touch: false, expectPrompt: false },
  { name: 'forced-landscape-iphone-landscape', ua: 'iphone', width: 844, height: 340, touch: true, expectPrompt: false, immersive: true },
]

async function runForcedLandscapeScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  try {
    await page.enable()
    await env.chrome.client.send('Emulation.setUserAgentOverride', { userAgent: FORCED_UA[scenario.ua] }, sessionId)
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=battle-playback&ws-auth=1`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'replay picker' })
    const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
      nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
    }, sessionId)
    await env.chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [
      resolve(frontendRoot, '../common/fixtures/replays/cw-training-15-14-example.wotbreplay'),
    ] }, sessionId)
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: '2D playback loaded' })
    // 设备判定是异步的：给它充足时间，再断言「出现」或「始终不出现」
    const prompt = await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")',
      value => value === scenario.expectPrompt, { timeout: 5000, label: `rotate prompt = ${scenario.expectPrompt}` }).catch(() => !scenario.expectPrompt)
    if (!scenario.expectPrompt) {
      await delay(800)
      check(failures, await page.evaluate('!document.querySelector("[data-testid=rotate-prompt]")'), `${scenario.name}: 非强制设备不得出现旋转提示`)
    } else {
      check(failures, prompt === true, `${scenario.name}: iPhone 竖屏必须出现旋转提示`)
      const action = await page.waitForValue(clickCenterExpression('[data-testid="rotate-prompt-action"]'), Boolean, { label: 'rotate prompt action' })
      await page.tap({ ...action, touch: true })
      await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")', value => value === false, { label: 'prompt dismissed by data capability' })
      check(failures, await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="data"]')?.getAttribute('aria-checked') === 'true'`),
        `${scenario.name}: 退出动作必须回到赛后数据`)
    }
    if (scenario.immersive) {
      await page.waitForValue('document.documentElement.dataset.shellChrome', value => value === 'immersive', { label: 'immersive shell' })
      const menu = await page.waitForValue(clickCenterExpression('[data-testid="nav-menu"]'), Boolean, { label: 'immersive menu hit-testable' })
      await page.tap({ ...menu, touch: true })
      await page.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'drawer from immersive menu' })
    }
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

/**
 * 装甲查看器同样强制横屏（2026-11-08 用户确认：只装甲查看器，科技树不强制）：
 * iPhone Safari 竖屏出现旋转提示；iPhone 横屏、iPad、缩窄的桌面浏览器都不出。
 */
const ARMOR_FORCED_LANDSCAPE_SCENARIOS = [
  { name: 'armor-forced-landscape-iphone-portrait', ua: 'iphone', width: 390, height: 664, touch: true, expectPrompt: true },
  { name: 'armor-forced-landscape-iphone-landscape', ua: 'iphone', width: 844, height: 340, touch: true, expectPrompt: false },
  { name: 'armor-forced-landscape-ipad-portrait', ua: 'ipad', width: 820, height: 1180, touch: true, expectPrompt: false },
  { name: 'armor-forced-landscape-desktop-narrow', ua: 'desktop', width: 390, height: 664, touch: false, expectPrompt: false },
]

async function runArmorForcedLandscapeScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  try {
    await page.enable()
    await env.chrome.client.send('Emulation.setUserAgentOverride', { userAgent: FORCED_UA[scenario.ua] }, sessionId)
    await page.emulate(scenario)
    await page.goto(`${env.origin}/?view=agent-armor&tank=2`)
    await page.waitFor(() => !!document.querySelector('.armor-viewer, [data-testid="armor-viewer"], #armor-canvas, canvas'), { timeout: 30_000, label: 'armor viewer mounted' })
    const prompt = await page.waitForValue('!!document.querySelector("[data-testid=rotate-prompt]")',
      value => value === scenario.expectPrompt, { timeout: 5000, label: `armor rotate prompt = ${scenario.expectPrompt}` }).catch(() => !scenario.expectPrompt)
    if (scenario.expectPrompt) {
      check(failures, prompt === true, `${scenario.name}: iPhone 竖屏打开装甲查看器必须出现旋转提示`)
      check(failures, await page.evaluate('!!document.querySelector("[data-testid=rotate-prompt-action]")'), `${scenario.name}: 旋转提示必须给出返回动作`)
    } else {
      await delay(800)
      check(failures, await page.evaluate('!document.querySelector("[data-testid=rotate-prompt]")'), `${scenario.name}: 不得出现旋转提示`)
    }
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

async function runMultiFileWorkspaceScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  try {
    await page.enable()
    await page.emulate({ width: 1600, height: 900, touch: false })
    await page.goto(`${env.origin}/?view=battle-playback&ws-auth=1`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'multi-file picker' })
    const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
    const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
      nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
    }, sessionId)
    await env.chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [
      resolve(frontendRoot, '../common/fixtures/replays/cw-training-15-14-example.wotbreplay'),
      resolve(frontendRoot, '../common/fixtures/replays/tournament-14-14-example.wotbreplay'),
    ] }, sessionId)
    const hit = async (selector, { touch = false } = {}) => {
      const point = await page.waitForValue(clickCenterExpression(selector), Boolean, { label: selector })
      await page.tap({ ...point, touch })
    }
    await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: 'first batch battle loaded in 2D' })
    const roster = `Array.from(document.querySelectorAll('[data-test="pb-roster-row"]')).map(row => row.dataset.accountId).join(',')`
    const firstRoster = await page.evaluate(roster)
    check(failures, !!firstRoster, 'first battle has no playback roster')
    await hit('[data-testid="playback-battle-picker"]')
    const options = await page.evaluate(`Array.from(document.querySelectorAll('[data-testid="battle-picker-option"]')).map(option => option.dataset.value)`)
    check(failures, JSON.stringify(options) === JSON.stringify(['r0', 'r1']), `unexpected batch options: ${options}`)
    await hit('[data-testid="battle-picker-option"][data-value="r1"]')
    await page.waitForValue(roster, value => !!value && value !== firstRoster, { timeout: 60_000, label: 'second original File loaded in 2D' })
    await hit('[data-testid="playback-battle-picker"]')
    await hit('[data-testid="battle-picker-option"][data-value="r0"]')
    await page.waitForValue(roster, value => value === firstRoster, { timeout: 60_000, label: 'cached first battle restored' })

    // 手机回归：picker 是 fixed 底部 sheet。Replay Workspace 的 layout-data-workspace 有
    // isolation: isolate，曾把仍留在局部层叠上下文里的 sheet 压在根层外壳之下。
    // 断言 sheet 贴住视口底部、底边命中 sheet 本身且第二场在视口内，并用真实触摸完成切换。
    await page.emulate({ width: 390, height: 844, touch: true })
    await page.waitFor(() => !!document.querySelector('[data-testid="app-top-bar"]'), { label: 'mobile app top bar after resize' })
    await hit('[data-testid="playback-battle-picker"]', { touch: true })
    const sheet = await page.waitForValue(`(() => {
      const panel = document.querySelector('[data-testid="battle-picker-panel"]')
      const option = document.querySelector('[data-testid="battle-picker-option"][data-value="r1"]')
      if (!panel || !option) return null
      const rect = panel.getBoundingClientRect()
      const optionRect = option.getBoundingClientRect()
      const bottomHit = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight - 8))
      return {
        teleported: panel.parentElement === document.body && !panel.closest('.battle-picker'),
        bottom: Math.round(rect.bottom),
        viewportHeight: innerHeight,
        bottomOverShell: !!bottomHit && panel.contains(bottomHit),
        optionInViewport: optionRect.top >= 0 && optionRect.left >= 0
          && optionRect.right <= innerWidth && optionRect.bottom <= innerHeight,
      }
    })()`, Boolean, { label: 'mobile battle picker sheet' })
    check(failures, sheet.teleported, `mobile battle picker sheet is not teleported to body: ${JSON.stringify(sheet)}`)
    check(failures, Math.abs(sheet.bottom - sheet.viewportHeight) <= 1, `mobile battle picker sheet must end at viewport bottom: ${JSON.stringify(sheet)}`)
    check(failures, sheet.bottomOverShell, `shell chrome paints over the battle picker sheet: ${JSON.stringify(sheet)}`)
    check(failures, sheet.optionInViewport, `Battle 2 option is outside the viewport: ${JSON.stringify(sheet)}`)
    // §5 可见即可达：逐个选项判定真实命中 / 裁剪 / 视口 / 触控命中区，而不是只看第二场那一项。
    const sheetReach = await measureReachability(page, {
      options: ['[data-testid="battle-picker-option"]'],
      touch: true,
    })
    for (const failure of sheetReach.failures) check(failures, false, `battle picker sheet 可达性: ${failure}`)
    check(failures, sheetReach.sampled > 0, 'battle picker sheet 可达性断言空跑：没有任何选项被实际命中采样')
    await hit('[data-testid="battle-picker-option"][data-value="r1"]', { touch: true })
    await page.waitForValue(roster, value => !!value && value !== firstRoster, { timeout: 60_000, label: 'second battle after mobile sheet selection' })
    // 退场动画期间 DrawerContent 由 Reka Presence 挂起（~duration-slow），等待真实卸载再断言（比同步判更强）
    await page.waitForValue(`!document.querySelector('[data-testid="battle-picker-panel"]')`, Boolean,
      { timeout: 10_000, label: 'mobile battle picker sheet unmount after selection' })

    // 手机横屏沉浸态（真实应用）：回放就绪的触屏手机横屏隐藏顶栏，地图拿走顶栏高度；
    // 转回竖屏 / 切到数据 capability 立即恢复，地图回到竖屏契约（= 视口宽）。
    const shellState = `(() => ({
      topBar: !!document.querySelector('[data-testid="app-top-bar"]'),
      tabBar: !!document.querySelector('[data-testid="app-tab-bar"]'),
      sidebar: !!document.querySelector('[data-testid="app-sidebar"]'),
      headerH: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
      map: document.querySelector('.pb-map')?.getBoundingClientRect().width ?? 0,
      stage: document.querySelector('.pb-map-stage')?.getBoundingClientRect().width ?? 0,
    }))()`
    await page.emulate({ width: 740, height: 360, touch: true })
    const landscape = await page.waitForValue(shellState, (state) => !state.topBar && !state.tabBar && state.map > 0, { label: 'immersive shell in phone landscape' })
    console.log(`[browser-interaction] shell landscape state=${JSON.stringify(landscape)}`)
    check(failures, !landscape.sidebar, `immersive phone shell must not mount the sidebar either: ${JSON.stringify(landscape)}`)
    check(failures, landscape.headerH === '0px', `immersive shell must zero --header-h: ${JSON.stringify(landscape)}`)
    check(failures, landscape.map >= 260, `phone-landscape real-app map must be >= 260px: ${JSON.stringify(landscape)}`)
    console.log(`[browser-interaction] multifile 740x360 real-app map=${Math.round(landscape.map)}`)
    await page.emulate({ width: 390, height: 844, touch: true })
    const portrait = await page.waitForValue(shellState, (state) => state.topBar && !state.tabBar, { label: 'shell restored in portrait' })
    check(failures, !portrait.sidebar, `portrait phone shell must not mount the sidebar: ${JSON.stringify(portrait)}`)
    check(failures, portrait.headerH === '48px', `portrait must restore --header-h: ${JSON.stringify(portrait)}`)
    check(failures, portrait.map > 0 && Math.abs(portrait.map - portrait.stage) <= 2, `portrait map must fill the full column width: ${JSON.stringify(portrait)}`)
    await page.emulate({ width: 740, height: 360, touch: true })
    await page.waitForValue(shellState, (state) => !state.topBar, { label: 'immersive shell again' })
    await hit('[data-testid="ws-tab"][data-cap="data"]', { touch: true })
    // 离开回放后仍处于手机横屏：导航是顶栏菜单 + 左侧抽屉（L3），没有侧边栏，也没有 Tab 栏
    await page.waitForValue(shellState,
      (state) => !state.sidebar && state.topBar && !state.tabBar && state.headerH === '48px',
      { label: 'drawer shell restored when leaving playback' })
  } finally {
    await env.chrome.client.send('Target.closeTarget', { targetId })
  }
  results.push({ name: 'multifile-workspace-playback', failures, viewport: '1600x900 → 390x844 → 740x360' })
}

/* ------------------------------------------------------------------ 2D 战场 workspace（正方形 Stage 契约） */

/**
 * 真实 `BattlePlayback`（playback-controls.html，正常 7v7）在真实设备指标下的 workspace 契约：
 *
 *   竖屏手机   = 纵向流：正方形 Stage → 传输控件 → 详情（inline）→ Team 1 → Team 2
 *   横屏 / 全屏 / 平板 / 桌面 = `Team 1 | 正方形 Stage | Team 2`，传输控件在 Stage 之下
 *   左车道恒为物理 Team 1、右车道恒为物理 Team 2（录像者在 Team 2 时也不交换）
 *   详情是**整个战场 workspace（.pb-main）**的浮窗：可拖到三栏任意一栏之上，不越出 workspace、
 *   不压传输控件；× 只关详情不清选中；名册与详情互不影响
 *
 * 每个横屏场景都断言页面实测视口与请求一致（不把回退成竖屏的视口算作横屏覆盖）。
 */
const WORKSPACE_2D_SCENARIOS = [
  { name: 'ws2d-375x812-portrait-coarse', width: 375, height: 812, touch: true, layout: 'portrait' },
  { name: 'ws2d-390x844-portrait-coarse', width: 390, height: 844, touch: true, layout: 'portrait' },
  // 手机横屏：地图是主角。minMap = 地图边长下限（由 740×360 基线 96px + 产品目标推出：
  // 外壳让出 104px、传输条合成一行、HUD 一行后的预算，留 ~6% 余量）。
  { name: 'ws2d-600x320-landscape-coarse', width: 600, height: 320, touch: true, layout: 'lanes', minMap: 170 },
  { name: 'ws2d-667x375-landscape-coarse', width: 667, height: 375, touch: true, layout: 'lanes', minMap: 270 },
  // 紧凑 HUD 宽度竞争：非空四基地 + 完整 5 位 HP 数字 + 超长地图名；mixed 再加 PARTIAL/UNKNOWN。
  { name: 'ws2d-667x375-hud-exact', width: 667, height: 375, touch: true, layout: 'lanes', minMap: 270, hudStress: 'exact' },
  { name: 'ws2d-740x360-hud-mixed', width: 740, height: 360, touch: true, layout: 'lanes', minMap: 260, hudStress: 'mixed' },
  { name: 'ws2d-844x390-hud-exact', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290, hudStress: 'exact' },
  { name: 'ws2d-740x360-landscape-coarse', width: 740, height: 360, touch: true, layout: 'lanes', minMap: 260 },
  { name: 'ws2d-740x360-fullscreen-coarse', width: 740, height: 360, touch: true, layout: 'lanes', fullscreen: true, minMap: 260 },
  { name: 'ws2d-844x390-landscape-coarse', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290 },
  { name: 'ws2d-844x390-annotation-fullscreen', width: 844, height: 390, touch: true, layout: 'lanes', minMap: 290, annotationFullscreen: true },
  { name: 'ws2d-844x390-landscape-recorder-team2', width: 844, height: 390, touch: true, layout: 'lanes', recorder: 2, minMap: 290 },
  { name: 'ws2d-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, layout: 'lanes', fullscreen: true, minMap: 290 },
  { name: 'ws2d-1024x768-tablet', width: 1024, height: 768, touch: false, layout: 'lanes' },
  // 1280 宽桌面：侧边车道（≈320）比详情浮窗（340）窄——初始落位必须收窄浮窗，而不是伸进中心栏盖住 HUD
  { name: 'ws2d-1280x720-desktop', width: 1280, height: 720, touch: false, layout: 'lanes' },
  { name: 'ws2d-1280x800-desktop', width: 1280, height: 800, touch: false, layout: 'lanes' },
  { name: 'ws2d-1600x900-desktop', width: 1600, height: 900, touch: false, layout: 'lanes' },
  { name: 'ws2d-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, layout: 'lanes', fullscreen: true },
]

/**
 * 真实指针拖动，把详情的拖动柄从 from 拖到 to。触屏场景走原始 touch 事件（设备仿真开着触屏时
 * 注入的鼠标事件不会合成 pointer 拖动），桌面走鼠标事件——两者都由浏览器合成 pointer 事件。
 */
async function dragPointer(page, from, to, { touch = false } = {}) {
  const steps = 6
  const along = (i) => ({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps })
  if (touch) {
    const point = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    await page.client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from) }, page.sessionId)
    for (let i = 1; i <= steps; i++) {
      await page.client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(along(i)) }, page.sessionId)
    }
    await page.client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.sessionId)
    await delay(150)
    return
  }
  const send = (type, point, extra = {}) => page.client.send('Input.dispatchMouseEvent', {
    type, x: point.x, y: point.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra,
  }, page.sessionId)
  await send('mouseMoved', from, { buttons: 0, button: 'none' })
  await send('mousePressed', from)
  for (let i = 1; i <= steps; i++) await send('mouseMoved', along(i))
  await send('mouseReleased', to)
  await delay(150)
}

async function dragDetailsTo(page, targetCenterX, touch = false) {
  const handle = await page.evaluate(`(() => {
    const h = document.querySelector('[data-test="pb-sb-drag"]')
    if (!h) return null
    // 矮横屏的页面里 workspace 可能有一截在首屏外：先像用户一样把拖动柄滚进视口。
    h.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = h.getBoundingClientRect()
    const panel = document.querySelector('[data-test="pb-info"]').getBoundingClientRect()
    return { x: r.left + 12, y: r.top + r.height / 2, panelCenter: panel.left + panel.width / 2, room: innerHeight - (r.top + r.height / 2) - 4 }
  })()`)
  if (!handle) return false
  // 向下拖到底（夹紧会把它停在传输控件之上）；指针本身不离开视口，否则移动事件会被丢掉。
  await dragPointer(page, handle, { x: handle.x + (targetCenterX - handle.panelCenter), y: handle.y + Math.max(0, handle.room) }, { touch })
  return true
}

async function captureMobileReview(page, scenario, state = 'battlefield') {
  const output = process.env.WOTB_MOBILE_REVIEW_DIR
  if (!output || scenario.width >= 900) return
  await mkdir(output, { recursive: true })
  const previousScroll = await page.evaluate(`(() => {
    const previous = { x: scrollX, y: scrollY }
    const root = document.querySelector('.pb-root, .battle-playback')
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0
    if (root && !document.fullscreenElement) scrollTo(0, root.getBoundingClientRect().top + scrollY - header)
    return previous
  })()`)
  await delay(100)
  const { data } = await page.client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId)
  await writeFile(resolve(output, `${scenario.name}-${state}.png`), Buffer.from(data, 'base64'))
  await page.evaluate(`scrollTo(${previousScroll.x}, ${previousScroll.y})`)
  await delay(100)
}

/* ------------------------------------------------------------------ main */

const { LIFECYCLE_SCENARIOS, PARSE_LIFECYCLE_BRIDGE, openCollectionRemove, confirmCollectionRemove, clickCenterExpression,
  runParseLifecycleScenario, runOfflineWorkspaceScenario, runReplayCollectionScenario } = createLifecycleScenarios({
  Page, setLastPage: page => { lastPage = page }, results, check, delay, dragPointer, fakeAnalysisOrigin, frontendRoot,
})

const { PLAYBACK_COLLAPSE_SCENARIOS, PLAYBACK_SHELLNAV_SCENARIOS, runPlaybackCollapseScenario,
  runPlaybackShellNavScenario, closeShellNavServer } = createPlaybackShellScenarios({
  Page, setLastPage: page => { lastPage = page }, results, check, clicked, clickElement,
  clickCenterExpression, delay, startFixtureServer,
})

const { ONBOARDING_SCENARIOS, MENU_VIEWPORT_SCENARIOS, runOnboardingScenario, runMenuViewportScenario,
  closeOnboardingServer } = createOnboardingScenarios({
  Page, setLastPage: page => { lastPage = page }, results, check, clickCenterExpression, captureMobileReview, startFixtureServer,
})

const { APP_SCENARIOS, AUTH_CAPABILITY_SCENARIOS, runAppScenario, runAuthCapabilityScenario } = createCapabilityScenarios({
  Page, setLastPage: page => { lastPage = page }, results, check, delay, fakeAnalysisOrigin, clickCenterExpression, PARSE_LIFECYCLE_BRIDGE,
})

const runRosterGeometryScenario = createRosterGeometryScenario({
  Page, setLastPage: page => { lastPage = page }, results, check, clicked, clickElement,
  confirmCollectionRemove, openCollectionRemove, dragPointer, captureMobileReview, fakeAnalysisOrigin,
  sceneHitTarget, waitForStableLayout,
})

const runWorkspace2DScenario = createWorkspace2DScenario({
  Page, setLastPage: page => { lastPage = page }, results, check, clicked, clickElement,
  clickCenterExpression, delay, dragDetailsTo, dragPointer, captureMobileReview, waitForStableLayout,
})

const chrome = findChrome()
const { server, origin } = await startFixtureServer()
let chromeCdp = null

try {
  chromeCdp = await launchChromeForCdp(chrome, {
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  })
  const env = { origin, chrome: chromeCdp }
  const runs = [
    ...SHELL_OVERLAY_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runShellOverlayScenario(env, scenario)) })),
    ...MOBILE_PAGE_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runMobilePageScenario(env, scenario)) })),
    ...DIALOG_SHEET_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDialogSheetScenario(env, scenario)) })),
    ...DRAWER_EXIT_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDrawerExitScenario(env, scenario)) })),
    ...DRAWER_TABLE_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runDrawerTableScenario(env, scenario)) })),
    ...CATALOG_HOF_DOC_SCENARIOS.map(scenario => ({ scenario, run: async () => results.push(await runCatalogHofDocScenario(env, scenario)) })),
    ...MENU_VIEWPORT_SCENARIOS.map(scenario => ({ scenario, run: () => runMenuViewportScenario(env, scenario) })),
    { scenario: { name: 'multifile-workspace-playback', width: 1600, height: 900 }, run: () => runMultiFileWorkspaceScenario(env) },
    ...FORCED_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runForcedLandscapeScenario(env, scenario) })),
    ...ARMOR_FORCED_LANDSCAPE_SCENARIOS.map(scenario => ({ scenario, run: () => runArmorForcedLandscapeScenario(env, scenario) })),
    { scenario: { name: 'replay-collection', width: 1440, height: 900 }, run: () => runReplayCollectionScenario(env) },
    { scenario: { name: 'offline-local-workspace-matrix', width: 1600, height: 900 }, run: () => runOfflineWorkspaceScenario(env) },
    ...APP_SCENARIOS.map((scenario) => ({ scenario, run: () => runAppScenario(env, scenario) })),
    ...AUTH_CAPABILITY_SCENARIOS.map((scenario) => ({ scenario, run: () => runAuthCapabilityScenario(env, scenario) })),
    ...ONBOARDING_SCENARIOS.map((scenario) => ({ scenario, run: () => runOnboardingScenario(env, scenario) })),
    { scenario: { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }, run: () => runRosterGeometryScenario(env, { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }) },
    ...ROSTER_GEOMETRY_SCENARIOS.map((scenario) => ({ scenario, run: () => runRosterGeometryScenario(env, scenario) })),
    { scenario: { name: 'scene-activity-lifecycle-desktop', width: 1600, height: 900, touch: false }, run: () => runSceneActivityScenario(env, { name: 'scene-activity-lifecycle-desktop', width: 1600, height: 900, touch: false }) },
    ...LIFECYCLE_SCENARIOS.map((scenario) => ({ scenario, run: () => runParseLifecycleScenario(env, scenario) })),
    ...PLAYBACK_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackControlScenario(env, scenario) })),
    ...PLAYBACK_COLLAPSE_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackCollapseScenario(env, scenario) })),
    ...PLAYBACK_SHELLNAV_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackShellNavScenario(env, scenario) })),
    { scenario: ROTATION_SCENARIO, run: () => runRotationScenario(env, ROTATION_SCENARIO) },
    ...MOBILE_FULLSCREEN_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileFullscreenScenario(env, scenario) })),
    ...WORKSPACE_2D_SCENARIOS.map((scenario) => ({ scenario, run: () => runWorkspace2DScenario(env, scenario) })),
  ]
  // 可选场景名过滤（调试单个形态时不必跑满矩阵）。
  const scenarioArgs = parseScenarioArgs(process.argv.slice(2))
  const { nameFilter } = scenarioArgs
  const base = process.argv.includes('--occlusion')
    ? runs.filter(({ scenario }) => /^(shell-overlay-|mobile-pages-|dialog-sheet-|drawer-tables-|overlay-|menu-viewport-|ws2d-|roster-geometry-|capability-normal-shots-armor-handoff)/.test(scenario.name))
    : process.argv.includes('--mobile-visual')
    ? runs.filter(({ scenario }) => scenario.width < 900 && /^(roster-geometry|ws2d)-/.test(scenario.name))
    : nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  const selected = selectShard(base, scenarioArgs)
  for (const { scenario, run } of selected) {
    // 单个场景抛错（例如等不到元素）不得吞掉整轮结果：记为该场景的失败后继续。
    try {
      await run()
      if (scenario.name.startsWith('onboarding-')) {
        const completed = results.at(-1)
        console.log(`[browser-interaction-progress] ${scenario.name} ${completed?.failures.length ? 'FAILED' : 'OK'}`)
      }
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(lastPage ? await lastPage.diagnose().catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
        xfail: scenario.xfail,
      })
      if (scenario.name.startsWith('onboarding-')) console.error(`[browser-interaction-progress] ${scenario.name} FAILED: ${error.message}`)
    }
  }

  const tabletRoster = results.find((result) => result.name === 'roster-geometry-1024x768-tablet')?.geometry
  const desktopRoster = results.find((result) => result.name === 'roster-geometry-1600x900-desktop')?.geometry
  const fullscreenRoster = results.find((result) => result.name === 'roster-geometry-1792x922-fullscreen-desktop')?.geometry
  // 2026-10-05：浮层布局下 lane 宽度 = clamp(11rem, 16vw, 15rem) 恒定，center=2×lane 的
  // 比例契约随旧网格一并停用，待按新布局重写（覆盖缺口记录于 PR #537）。
  const LEGACY_GRID_CONTRACT = false
  if (tabletRoster && desktopRoster && fullscreenRoster && LEGACY_GRID_CONTRACT) {
    const failures = []
    // As the workspace grows, desktop center stays twice the roster width.
    // 这里锁的是比例：lane 变大、center 变大且桌面始终约 2× lane。
    check(failures, tabletRoster.laneWidths[0] + 1 < desktopRoster.laneWidths[0], 'roster lanes must grow between tablet and desktop')
    check(failures, fullscreenRoster.laneWidths[0] > desktopRoster.laneWidths[0] + 1, 'roster lanes must absorb spare viewport width')
    for (const [name, g] of [['tablet', tabletRoster], ['desktop', desktopRoster], ['fullscreen', fullscreenRoster]]) {
      const lane = g.laneWidths[0]
      // HUD 属于 center 列，用它的宽度当 center 宽度的实测值
      const center = g.centerWidth ?? null
      if (!lane || !center) { check(failures, false, `${name} roster matrix: missing lane/center`); continue }
      if (name !== 'tablet') check(failures, Math.abs(center - lane * 2) <= 2,
        `${name} roster matrix: center must be twice the roster lane width (center=${center} square=${g.square.w})`)
    }
    results.push({ name: 'roster-fluid-width-matrix', failures, viewport: '1024 → 1600 → 1792' })
  }
  let failed = 0
  let knownIssues = 0
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`[browser-interaction] ${result.name} OK (${result.viewport})`)
      continue
    }
    if (result.xfail) {
      // 显式已知问题：照常运行与打印，但不计入退出码（修复后应从 known-issues 移除）。
      knownIssues += 1
      console.error(`[browser-interaction] ${result.name} KNOWN-ISSUE (${result.viewport}): ${result.xfail}`)
      for (const failure of result.failures) console.error(`  - ${failure}`)
      continue
    }
    failed += 1
    console.error(`[browser-interaction] ${result.name} FAILED (${result.viewport})`)
    for (const failure of result.failures) console.error(`  - ${failure}`)
  }
  if (failed > 0) {
    process.exitCode = 1
    console.error(`[browser-interaction] ${failed}/${results.length} scenarios failed`)
  } else {
    console.log(`[browser-interaction] all ${results.length} scenarios passed`)
  }
} finally {
  // Chrome 启动失败时也必须关掉 Vite server，否则脚本会挂在未释放的监听上而不是报错退出。
  if (chromeCdp) await chromeCdp.close()
  await closeOnboardingServer()
  if (fakeAnalysisServer) await fakeAnalysisServer.server.close()
  await closeShellNavServer()
  await server.close()
}
