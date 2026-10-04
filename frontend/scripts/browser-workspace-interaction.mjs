import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'

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
  [resolve(frontendRoot, 'src/composables/useAuth.js'), resolve(here, 'browser-fixtures/use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.js'), resolve(here, 'browser-fixtures/use-business-user-bootstrap-stub.js')],
  [resolve(frontendRoot, 'src/scene/playbackParse.worker.ts'), resolve(here, 'browser-fixtures/playback-parse-worker-stub.mjs')],
  [resolve(frontendRoot, 'src/api/agent-replay-facets.ts'), resolve(here, 'browser-fixtures/shot-handoff-stub.js')],
  [resolve(frontendRoot, 'src/scene/tankViewer.js'), resolve(here, 'browser-fixtures/armor-handoff-stub.js')],
])

/** Vite 的 module id 在 Windows 上是正斜杠、可能带盘符前导斜杠，且大小写不敏感；比较前统一规整。 */
function normalizeId(id) {
  const forward = id.replace(/\\/g, '/').replace(/^\/+/, '')
  return process.platform === 'win32' ? forward.toLowerCase() : forward
}

function authBoundaryStubPlugin() {
  const normalizedStubs = new Map([...AUTH_BOUNDARY_STUBS].map(([from, to]) => [normalizeId(from), to]))
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

async function startFixtureServer() {
  const server = await createServer({
    configFile: resolve(frontendRoot, 'vite.config.js'),
    root: frontendRoot,
    logLevel: 'error',
    plugins: [authBoundaryStubPlugin()],
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

/* ------------------------------------------------------------------ 页面内探针
   写成真实函数再序列化执行，避免模板字符串里的转义错误。 */

function capabilityHitProbe() {
  const button = document.querySelector('[data-testid="ws-tab"][data-cap="playback"]')
  if (!button) return { found: false }
  const rect = button.getBoundingClientRect()
  const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  const hit = document.elementFromPoint(center.x, center.y)
  const describe = (element) => {
    if (!element) return null
    const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).join('.') : ''
    return `${element.tagName}${className ? `.${className}` : ''}`
  }
  const chain = []
  for (let node = hit; node && chain.length < 10; node = node.parentElement) chain.push(describe(node))
  const buttonStyle = getComputedStyle(button)
  return {
    found: true,
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    center,
    insideViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
    hitIsButton: hit === button || button.contains(hit),
    hitChain: chain,
    pointerEvents: buttonStyle.pointerEvents,
    visibility: buttonStyle.visibility,
    opacity: buttonStyle.opacity,
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }
}

function capabilityStateProbe() {
  const pane = (testId) => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    if (!element) return { present: false, visible: false }
    return { present: true, visible: getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0 }
  }
  const tabs = Array.from(document.querySelectorAll('[data-testid="ws-tab"]')).map((tab) => {
    const rect = tab.getBoundingClientRect()
    return {
      cap: tab.dataset.cap,
      role: tab.getAttribute('role'),
      // 能力切换走 canonical SegmentedControl 的 radiogroup 模型（不是 tablist）
      selected: tab.getAttribute('aria-checked') === 'true',
      active: tab.classList.contains('is-active'),
      /** 触屏点击区域（design-language §5：coarse 下 ≥ 44px） */
      minSide: Math.round(Math.min(rect.width, rect.height)),
    }
  })
  const dialog = document.querySelector('.global-error-modal')
  const overlay = dialog ? dialog.closest('.dialog-scrim') : null
  return {
    tabs,
    data: pane('ws-data'),
    ai: pane('ws-ai'),
    playback: pane('ws-playback'),
    threeD: pane('ws-3d'),
    shots: pane('ws-shots'),
    errorDialog: dialog
      ? { text: dialog.textContent.trim(), visible: !!overlay && getComputedStyle(overlay).display !== 'none' }
      : null,
  }
}

function playbackControlProbe() {
  const play = document.querySelector('[data-test="pb-play"]')
  const root = document.querySelector('[data-test="battle-playback"]')
  if (!play) return { found: false, root: !!root }
  const rect = play.getBoundingClientRect()
  const center = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  const hit = document.elementFromPoint(center.x, center.y)
  const time = document.querySelector('[data-test="pb-time"]')
  const reason = document.querySelector('[data-test="pb-play-unavailable"]')
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
    /** 所有可见速度档位按钮的最小边（触屏点击区域契约：≥ 44px） */
    speedMinSide: (() => {
      const sides = [...document.querySelectorAll('[data-test^="pb-speed-"]')]
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => Math.min(r.width, r.height))
      return sides.length ? Math.min(...sides) : null
    })(),
    /** 速度档位菜单展开后必须一行排开且不越出自身容器（档位个数变化时的回归点） */
    speedMenu: (() => {
      const group = document.querySelector('.pb-speed-menu')
      if (!group) return null
      const limit = group.getBoundingClientRect()
      const buttons = [...group.querySelectorAll('.pb-speed-menu [data-test^="pb-speed-"]')].map((b) => b.getBoundingClientRect())
      if (!buttons.length) return null
      return {
        count: buttons.length,
        overflow: buttons.some((r) => r.left < limit.left - 1 || r.right > limit.right + 1 || r.top < limit.top - 1 || r.bottom > limit.bottom + 1),
        minSide: Math.min(...buttons.map((r) => Math.min(r.width, r.height))),
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

  async enable() {
    await this.client.send('Runtime.enable', {}, this.sessionId)
    await this.client.send('Page.enable', {}, this.sessionId)
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
    await this.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' }); return !!el })()`,
    )
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

/* ------------------------------------------------------------------ 场景 */

const APP_SCENARIOS = [
  { name: 'capability-375x812-portrait-coarse', width: 375, height: 812, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-740x360-landscape-coarse', width: 740, height: 360, touch: true, authenticated: true, login: 'resolve' },
  { name: 'capability-1024x768-tablet', width: 1024, height: 768, touch: false, authenticated: true, login: 'resolve' },
  { name: 'capability-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve' },
  // Data / 2D 在未登录、auth init 挂起 / 失败时立即可用；受保护能力停在登录门。
  // pending 的 watchdog 设得远长于场景本身——工作台必须在 auth init 仍挂起时就渲染（不能等超时兜底）。
  { name: 'anonymous-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'reject' },
  { name: 'auth-init-pending-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'pending', authTimeout: 120_000 },
  { name: 'auth-init-reject-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'reject', authTimeout: 120_000 },
  // Admin 与普通登录用户能力集合相同。
  { name: 'admin-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
  { name: 'admin-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
]

const AUTH_CAPABILITY_SCENARIOS = [
  { name: 'capability-normal-3d-desktop', cap: '3d', view: 'agent-replay', authenticated: true, width: 1600, height: 900, touch: false },
  { name: 'capability-normal-shots-desktop', cap: 'shots', view: 'agent-shots', authenticated: true, width: 1600, height: 900, touch: false },
  { name: 'capability-anonymous-3d-coarse', cap: '3d', view: 'agent-replay', authenticated: false, width: 390, height: 844, touch: true },
  { name: 'capability-anonymous-shots-coarse', cap: 'shots', view: 'agent-shots', authenticated: false, width: 390, height: 844, touch: true },
  { name: 'capability-normal-shots-armor-handoff', cap: 'shots', view: 'agent-shots', authenticated: true, width: 1600, height: 900, touch: false, reconstruct: true },
]

async function runAuthCapabilityScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/?view=replay&ws-auth=${scenario.authenticated ? 1 : 0}&ws-shot-fixture=1&assets=${encodeURIComponent(`${env.origin}/fixture-assets`)}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-data"]'), { label: 'data pane' })
  await page.evaluate(PARSE_LIFECYCLE_BRIDGE)
  await page.evaluate('window.__pbSelect("auth-capability.wotbreplay", [1, 2, 3, 4])')
  await page.installInputTrace()
  const selector = `[data-testid="ws-tab"][data-cap="${scenario.cap}"]`
  const center = await page.evaluate(clickCenterExpression(selector))
  if (!center) throw new Error(`${scenario.cap} tab must be hit-testable`)
  await page.tap({ ...center, touch: scenario.touch })
  await page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === scenario.view,
    { label: 'capability destination' })
  const trace = await page.evaluate('window.__wsInput.click')
  check(failures, trace?.cap === scenario.cap, `real capability click landed on ${JSON.stringify(trace)}`)
  const paneSelector = scenario.cap === '3d' ? '.pb-root' : '[data-testid="replay-shots-pane"]'
  if (!scenario.authenticated) {
    await page.waitFor(() => !!document.querySelector('[data-testid="capability-auth-gate"]'), { label: 'login gate' })
    check(failures, !await page.evaluate(`!!document.querySelector(${JSON.stringify(paneSelector)})`),
      `anonymous ${scenario.cap} must not mount its production pane`)
    check(failures, await page.evaluate('!window.__wsShotParse || (window.__wsShotParse.playback === 0 && window.__wsShotParse.shots === 0)'),
      'anonymous capability must not begin playback or shots parsing')
    check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0,
      'capability navigation must not initiate login')
    const loginCenter = await page.evaluate(clickCenterExpression('[data-testid="capability-login"]'))
    if (!loginCenter) throw new Error('capability login button must be hit-testable')
    await page.tap({ ...loginCenter, touch: scenario.touch })
    const loginTrace = await page.evaluate('window.__wsInput.click')
    check(failures, loginTrace?.testId === 'capability-login', `real login click landed on ${JSON.stringify(loginTrace)}`)
    check(failures, await page.evaluate('JSON.stringify(window.__wsAuth.loginCalls)') === JSON.stringify([scenario.view]),
      `login must preserve ${scenario.view} as destination`)
    const fileToggle = await page.evaluate(clickCenterExpression('.filebar .fb-actions button[aria-expanded="false"]'))
    if (fileToggle) await page.tap({ ...fileToggle, touch: scenario.touch })
    check(failures, await page.evaluate('document.querySelector("[data-testid=file-list]")?.textContent.includes("auth-capability.wotbreplay") === true'),
      'login gate must preserve the chosen replay')
  } else {
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(paneSelector)})`, (present) => present === true,
      { label: 'authenticated production pane' })
    check(failures, !await page.evaluate('!!document.querySelector("[data-testid=capability-auth-gate]")'),
      'normal authenticated user must bypass login gate')
    if (scenario.cap === 'shots') {
      await page.waitFor(() => !!document.querySelector('[data-testid="shot-row-1"]'), { label: 'parsed shot row' })
      check(failures, await page.evaluate('window.__wsShotParse.playback === 1 && window.__wsShotParse.shots === 1'),
        'normal authenticated user must execute the shot parsing chain')
    }
    if (scenario.reconstruct) {
      const row = await page.evaluate(clickCenterExpression('[data-testid="shot-row-1"]'))
      if (!row) throw new Error('shot row must be hit-testable')
      await page.tap({ ...row, touch: scenario.touch })
      check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'shot-row-1',
        'real selection click must land on the selected shot row')
      const open = await page.evaluate(clickCenterExpression('[data-testid="shot-open-viewer"]'))
      if (!open) throw new Error('armor handoff button must be hit-testable')
      await page.tap({ ...open, touch: scenario.touch })
      check(failures, await page.evaluate('window.__wsInput.click?.testId') === 'shot-open-viewer',
        'real armor handoff click must land on its button')
      await page.waitForValue('window.__wsArmorScene?.shot || null', (shot) => shot?.index === 1,
        { label: 'armor scene received the selected shot' })
      const scene = await page.evaluate('window.__wsArmorScene')
      check(failures, scene.tank === 2 && scene.shooter === 1, `armor scene tank context lost: ${JSON.stringify(scene)}`)
      const expected = { view: 'agent-armor', tank: '2', shooter: '1', config: '1', shell: '2', shot: '1', world: '1', heatmap: '1' }
      check(failures, Object.entries(expected).every(([key, value]) => scene.query[key] === value),
        `armor scene query lost: ${JSON.stringify(scene.query)}`)
      check(failures, scene.shot.target_eid === 8 && scene.shot.shooter_eid === 7,
        `armor scene local shot context lost: ${JSON.stringify(scene.shot)}`)
      check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0,
        'normal user armor handoff must not request another login')
    }
  }
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

/**
 * 3D 阵容车道的**真实几何**回归（review blocker：源码级 CSS 断言证明不了最终渲染）。
 * 每个场景走真实用户路径：选文件 → 真实点击切 3D 能力 → 真实点击「开始」（走过待开播
 * 闸门）→ 经 ?debug 注入口喂入就绪态（两队名单非空 / unknown 非空 / killfeed）→ 用
 * getBoundingClientRect 断言：三块名单两两不重叠、不覆盖 HUD 子面板、不覆盖底部控制条、
 * 全部位于 pb-root 内。宽档 normal 7v7 全员可见且无 team/lane 内滚动；phone/短视口
 * 必须由 Display 打开临时 roster surface，打开即关闭 Display，dismiss 即归还完整场景。
 */
/**
 * `getBoundingClientRect` 断言：三块名单两两不重叠、不覆盖 HUD 子面板、不覆盖底部控制条、
 * 全部位于 pb-root 内；每个可见行都要有 HP 数值与百分比且不被截断。
 *
 * `transient` 不是「手机 / 矮视口」的别名，而是**名册放不放得下**的实测结论
 * （`Replay3DPane` 的 `rosterConstrained`）。7v7 全员 16 行的真实名册需要约 534px 车道高，
 * 而 `.pb-root` 的高度上限是 `clamp(320px, 62dvh, 720px)` —— 战场必须占主导，900 高的视口
 * 只给出 558px 根高，HUD 与传输控件再各占 127 / 120px，车道只剩 313px。
 * 所以 1600×900 与 1024×768 上**全量名册**同样是临时面：常驻车道会溢出到控制条上，
 * 那正是这条门禁要挡住的事。
 */
/**
 * 3D 与 2D 同一个 workspace 契约：竖屏手机 = 纵向流（HUD / Stage / 传输控件 / 详情 / Team 1 /
 * Team 2）；其余（手机横屏、手机全屏横屏、平板、桌面）= `Team 1 | 正方形 Stage | Team 2`。
 * 正常 7v7 不走任何「临时名册面」，车道不出现滚动条。`unknown` 是未识别阵营的行数（排在 Team 1 下）。
 */
const ROSTER_GEOMETRY_SCENARIOS = [
  { name: 'roster-geometry-1600x900-desktop', width: 1600, height: 900, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side' },
  { name: 'roster-geometry-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-1024x768-tablet', width: 1024, height: 768, touch: false, players: 7, unknown: 2, killfeed: 3, layout: 'side' },
  { name: 'roster-geometry-375x812-portrait-coarse', width: 375, height: 812, touch: true, players: 7, unknown: 0, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-390x844-portrait-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 2, killfeed: 3, layout: 'portrait' },
  { name: 'roster-geometry-740x360-landscape-coarse', width: 740, height: 360, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-844x390-landscape-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side' },
  { name: 'roster-geometry-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', fullscreen: true },
  { name: 'roster-geometry-portrait-to844x390-coarse', width: 390, height: 844, touch: true, players: 7, unknown: 0, killfeed: 1, layout: 'side', rotateTo: { width: 844, height: 390 } },
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

/** 阵容车道的真实几何断言（getBoundingClientRect，0.5px 容差吸收亚像素舍入）。 */
function rosterGeometryProbe() {
  const rect = (el) => (el ? el.getBoundingClientRect() : null)
  const root = document.querySelector('.pb-root')
  const out = { root: !!root, errors: [], boxes: {} }
  if (!root) return out
  const rr = root.getBoundingClientRect()
  const transient = false
  out.portrait = root.classList.contains('portrait-flow')
  out.side = root.classList.contains('roster-side')
  out.viewport = { width: innerWidth, height: innerHeight }
  const square = root.querySelector('.stage-square')?.getBoundingClientRect()
  out.square = square ? { w: square.width, h: square.height, l: square.left, r: square.right, t: square.top, b: square.bottom } : null
  if (!square || Math.abs(square.width - square.height) > 1) out.errors.push(`3D Stage is not square: ${JSON.stringify(out.square)}`)
  const stage = root.querySelector('.pb-stage')?.getBoundingClientRect()
  const hud = root.querySelector('.hud')?.getBoundingClientRect()
  const transport = root.querySelector('.controls')?.getBoundingClientRect()
  const hudPanel = root.querySelector('.hud .pb-hud')
  if (hudPanel && hud && Math.abs(hudPanel.getBoundingClientRect().width - hud.width) > 1) out.errors.push('HUD panel must span its center column')
  if (innerWidth >= 1200 && hudPanel && parseFloat(getComputedStyle(hudPanel.querySelector('.pb-hud-value')).fontSize) < 16) out.errors.push('desktop HUD values must use the enlarged type scale')
  const friendlyTeam = window.__pbPane?.store.friendlyTeam
  if ([1, 2].includes(friendlyTeam)) {
    for (const team of [1, 2]) {
      const expected = root.querySelector(`[data-test="pb-hp-fill-${team === friendlyTeam ? 'friendly' : 'enemy'}"]`)
      for (const fill of root.querySelectorAll(`.team${team} .pb-roster-hpfill`)) {
        if (expected && getComputedStyle(fill).backgroundColor !== getComputedStyle(expected).backgroundColor) out.errors.push(`Team ${team} HP must use Recorder relation color`)
      }
    }
  }
  if (stage && square) {
    // Budget comes from the workspace and chrome, never the content-sized Stage itself.
    const style = getComputedStyle(root)
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    const availableHeight = rr.height - padding - border - (hud?.height || 0) - (transport?.height || 0)
      - (parseFloat(getComputedStyle(root.querySelector('.pb-stage')).marginTop) || 0)
      - (parseFloat(getComputedStyle(root.querySelector('.pb-stage')).marginBottom) || 0)
    const maximumSide = out.portrait ? stage.width : Math.min(stage.width, availableHeight)
    if (square.width < maximumSide - 2 || square.width > maximumSide + 2) {
      out.errors.push(`Stage does not maximize available square: side=${square.width.toFixed(1)}, available=${maximumSide.toFixed(1)}`)
    }
    if (hud && transport) {
      const gaps = { hud: square.top - hud.bottom, transport: transport.top - square.bottom }
      out.stackGaps = gaps
      for (const [name, gap] of Object.entries(gaps)) {
        if (gap < -1 || gap > 16) out.errors.push(`central ${name} gap must remain compact (0–16px): ${gap.toFixed(1)}`)
      }
    }
  }
  const primaryIds = ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']
  const primary = primaryIds.map((id) => root.querySelector(`[data-test="${id}"]`))
  if (primary.some((element) => !element)) out.errors.push('six shared primary controls must be present')
  else {
    const boxes = primary.map((element) => element.getBoundingClientRect())
    const domOrder = [...root.querySelectorAll('.pb-controls button[data-test]')]
      .map((element) => element.dataset.test).filter((id) => primaryIds.includes(id))
    if (JSON.stringify(domOrder) !== JSON.stringify(primaryIds)) out.errors.push(`primary control DOM order: ${domOrder.join(',')}`)
    if (boxes.some((box, index) => index > 0 && box.left < boxes[index - 1].right - 1)
      || boxes.some((box) => Math.abs(box.top - boxes[0].top) > 1)) out.errors.push('six primary controls must stay in x-order on one row')
    if (out.phone && boxes.some((box) => Math.min(box.width, box.height) < 43.5)) out.errors.push('primary touch targets must be at least 44px')
  }
  out.laneWidths = ['.side-left', '.side-right'].map((selector) => root.querySelector(selector)?.getBoundingClientRect().width ?? 0)
  // center 列宽：HUD 占满整列，直接量它的盒。
  out.centerWidth = root.querySelector('.hud')?.getBoundingClientRect().width ?? null
  out.laneIds = ['.side-left', '.side-right'].map((sel) => [...root.querySelectorAll(`${sel} .pl`)].map((el) => el.textContent.trim().split(/\s+/)[0]))
  // 行的信息契约：玩家 / 车型 / HP 条（条内文字）——百分比已经收进 HP 条内部。
  out.rowsComplete = [...root.querySelectorAll('.team-lane .pl')].every((row) => ['pb-roster-player', 'pb-roster-tank', 'roster-hp', 'roster-hp-text']
    .every((test) => (row.querySelector(`[data-test="${test}"]`)?.textContent || '').trim().length > 0))
  out.hpBar = !!root.querySelector('.team-lane [data-test="roster-hp"]')
  out.phone = root.classList.contains('phone-form')
  const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5
    && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
  const panels = {}
  for (const name of ['team1', 'team2', 'team-unknown']) {
    const el = document.querySelector('.' + name)
    const cs = el ? getComputedStyle(el) : null
    if (!el || cs.display === 'none' || el.getClientRects().length === 0) continue
    const b = rect(el)
    panels[name] = b
    out.boxes[name] = { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) }
    if (!transient && (b.left < rr.left - 0.5 || b.right > rr.right + 0.5 || b.top < rr.top - 0.5 || b.bottom > rr.bottom + 0.5)) {
      out.errors.push(`${name} is outside pb-root (root=${JSON.stringify({ l: +rr.left.toFixed(1), t: +rr.top.toFixed(1), r: +rr.right.toFixed(1), b: +rr.bottom.toFixed(1) })})`)
    }
  }
  if (transient) {
    const surface = root.querySelector('.roster-surface').getBoundingClientRect()
    if (surface.left < rr.left - 0.5 || surface.right > rr.right + 0.5
      || surface.top < rr.top - 0.5 || surface.bottom > rr.bottom + 0.5) {
      out.errors.push('transient roster surface is outside pb-root')
    }
  }
  // A secondary surface may overlay HUD while open, but must stay above the controls.
  const hudBoxes = transient ? [] : [...document.querySelectorAll('.hud > *')].map(rect).filter(Boolean)
  for (const [name, b] of Object.entries(panels)) {
    hudBoxes.forEach((h, i) => {
      if (overlap(b, h)) out.errors.push(`${name} overlaps hud child #${i} (${JSON.stringify(h)})`)
    })
  }
  const controls = rect(document.querySelector('.controls'))
  if (controls) {
    for (const [name, b] of Object.entries(panels)) {
      if (overlap(b, controls)) out.errors.push(`${name} overlaps controls (${JSON.stringify(controls)})`)
    }
  }
  const pairs = [['team1', 'team2'], ['team1', 'team-unknown'], ['team2', 'team-unknown']]
  for (const [a, c] of pairs) {
    if (panels[a] && panels[c] && overlap(panels[a], panels[c])) out.errors.push(`${a} overlaps ${c}`)
  }
  // 名册行的 HP 文本必须真实上屏、且**整段落在自己的条内**（条内文字 overlay）：
  // exact 写 `current / max`、relative 写 `pct%`、unknown 写 `—`，都不带多余后缀。
  const hpTexts = [...document.querySelectorAll('.pl [data-test="roster-hp-text"]')]
  out.hpCells = hpTexts.length
  for (const cell of hpTexts) {
    const text = cell.textContent.trim()
    const ok = /^\d+ \/ \d+$/.test(text) || /^\d+%$/.test(text) || text === '—'
    if (!ok) out.errors.push(`roster HP text has unexpected shape: ${JSON.stringify(text)}`)
    if (cell.scrollWidth > cell.clientWidth + 1) {
      out.errors.push(`roster HP text is truncated: ${JSON.stringify(text)}`)
    }
    // 文字不被 fill 宽度裁切：文本必须完整落在条的可视范围内（低血量时同样成立）。
    const bar = cell.closest('[data-test="roster-hp"]')
    if (bar) {
      const b = bar.getBoundingClientRect()
      const t = cell.getBoundingClientRect()
      if (t.left < b.left - 0.5 || t.right > b.right + 0.5 || t.top < b.top - 0.5 || t.bottom > b.bottom + 0.5) {
        out.errors.push(`roster HP text escapes its bar: ${JSON.stringify({ text, bar: [b.left, b.right], textBox: [t.left, t.right] })}`)
      }
      // 文字不能在 fill 节点内部（否则会被 fill 的宽度裁掉）
      const fill = bar.querySelector('.pb-roster-hpfill')
      if (fill && fill.contains(cell)) out.errors.push('roster HP text must not live inside the fill node')
    } else {
      out.errors.push(`roster HP text without its bar: ${JSON.stringify(text)}`)
    }
  }
  // 每个可见名册行都必须有 HP 条（值 / 百分比已经收进条内文字）
  const rows = [...document.querySelectorAll('.roster-surface .pl')].filter((el) => el.getClientRects().length > 0)
  out.rows = rows.length
  for (const row of rows) {
    const bar = row.querySelector('[data-test="roster-hp"]')
    if (!bar || !bar.querySelector('[data-test="roster-hp-text"]')) {
      out.errors.push(`roster row without HP bar: ${JSON.stringify(row.textContent)}`)
    }
    // reload 若出现，必须与 HP 条等宽且更细（次级瞬时状态不得抢 HP 权重）
    const reload = row.querySelector('[data-test="roster-reload"]')
    if (bar && reload) {
      const bb = bar.getBoundingClientRect()
      const rb = reload.getBoundingClientRect()
      if (Math.abs(rb.width - bb.width) > 1) out.errors.push(`roster reload must span the HP bar width: ${JSON.stringify({ hp: bb.width, reload: rb.width })}`)
      if (!(rb.height < bb.height - 1)) out.errors.push(`roster reload must be thinner than the HP bar: ${JSON.stringify({ hp: bb.height, reload: rb.height })}`)
    }
    if (!transient) {
      const r = row.getBoundingClientRect()
      const group = row.closest('.team').getBoundingClientRect()
      if (r.top < group.top - 0.5 || r.bottom > group.bottom + 0.5
        || r.top < rr.top - 0.5 || r.bottom > rr.bottom + 0.5) {
        out.errors.push(`wide roster row is clipped: ${JSON.stringify(row.textContent)}`)
      }
    }
  }

  // —— 纵向铺满（宽档侧车道，7v7）：header 固定顶部 + 列表吃满 section 剩余高度 + 行均匀分布 ——
  // 用比例 / 几何关系断言，不锁死每行具体 px（正常高度由 `1fr` 连续决定）。
  if (!transient && out.rows >= 5) {
    const sections = [...root.querySelectorAll('.roster-surface .pb-roster-team')]
      .filter((el) => el.getClientRects().length > 0)
    for (const section of sections) {
      const head = section.querySelector('.pb-team-head')
      const list = section.querySelector('.pb-roster-list')
      const sectionRows = [...list.querySelectorAll('.pl')].filter((el) => el.getClientRects().length > 0)
      if (!head || sectionRows.length < 5) continue
      const sr = section.getBoundingClientRect()
      const hr = head.getBoundingClientRect()
      const lr = list.getBoundingClientRect()
      const first = sectionRows[0].getBoundingClientRect()
      const last = sectionRows[sectionRows.length - 1].getBoundingClientRect()
      // header 在上、列表在 header 之下
      if (hr.bottom > lr.top + 1) out.errors.push('roster header must sit above the list')
      // 列表吃满 section 剩余高度（不是只占内容高、下面空着）
      const listShare = lr.height / Math.max(1, sr.height)
      if (listShare < 0.6) out.errors.push(`roster list must consume the section's remaining height: ${JSON.stringify({ listShare: +listShare.toFixed(3), section: sr.height, list: lr.height })}`)
      // 首行贴近列表顶、末行贴近列表底 → 行没有全部挤在顶部
      if (first.top - lr.top > Math.max(6, lr.height * 0.06)) out.errors.push(`first roster row must start near the list top: ${JSON.stringify({ gap: +(first.top - lr.top).toFixed(1) })}`)
      if (lr.bottom - last.bottom > Math.max(6, lr.height * 0.06)) out.errors.push(`last roster row must end near the list bottom: ${JSON.stringify({ gap: +(lr.bottom - last.bottom).toFixed(1) })}`)
      // 行间距大致均匀：相邻间距的最大 / 最小不要差太多
      const gaps = []
      for (let i = 1; i < sectionRows.length; i++) {
        gaps.push(sectionRows[i].getBoundingClientRect().top - sectionRows[i - 1].getBoundingClientRect().bottom)
      }
      const minGap = Math.min(...gaps)
      const maxGap = Math.max(...gaps)
      if (maxGap - minGap > Math.max(4, maxGap * 0.25)) {
        out.errors.push(`roster row spacing must be roughly even: ${JSON.stringify({ minGap: +minGap.toFixed(1), maxGap: +maxGap.toFixed(1) })}`)
      }
      out.rosterFill = { listShare: +listShare.toFixed(3), minGap: +minGap.toFixed(1), maxGap: +maxGap.toFixed(1), rows: sectionRows.length }
    }
  }
  for (const element of root.querySelectorAll('.team, .team-lane, .roster')) {
    const style = getComputedStyle(element)
    if (['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      out.errors.push(`independent/nested roster scroll: ${element.className}`)
    }
  }
  if (!transient) {
    const surface = root.querySelector('.roster-surface')
    if (surface && ['auto', 'scroll'].includes(getComputedStyle(surface).overflowY)
      && surface.scrollHeight > surface.clientHeight + 1) out.errors.push('normal wide roster requires scrolling')
  }

  // —— 手机竖屏：常驻控件不得吃掉战场（真机 blocker 的不变量）——
  // 紧凑档（< 768）要求：工具条整行不常驻、速度档位不铺开、常驻控件高度受控、
  // 战场（.pb-root 总高 - 常驻控件高）仍占主导。断言语义而非像素。
  if (out.phone && !transient) {
    const box = (el) => (el && el.getClientRects().length ? el.getBoundingClientRect() : null)
    const toolbar = box(document.querySelector('.toolbar'))
    const controlsBox = box(document.querySelector('.controls'))
    const rootH = rr.height
    // 紧凑档工具条只允许保留「显示」入口（其余项在面板里）；相机分档与画质徽标不得常驻。
    const toolbarEl = document.querySelector('.toolbar')
    const toolbarChildren = toolbarEl
      ? [...toolbarEl.children]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({
          // 「显示」入口是 .display-wrap 包着 display-toggle；其余项按类名/标签识别
          label: el.querySelector('[data-testid="display-toggle"]')
            ? 'display'
            : (el.dataset.testid || el.className || el.tagName).toString(),
          w: +el.getBoundingClientRect().width.toFixed(1),
        }))
      : []
    out.compact = {
      rootH: +rootH.toFixed(1),
      controlsH: controlsBox ? +controlsBox.height.toFixed(1) : null,
      // 分段高度：定位"控件为什么这么高"（时间轴 / 按钮行 / 内边距与间隙）
      parts: controlsBox ? (() => {
        const controlsEl = document.querySelector('.controls')
        const part = (sel) => {
          const el = controlsEl.querySelector(sel)
          return el && el.getClientRects().length ? +el.getBoundingClientRect().height.toFixed(1) : null
        }
        return {
          timeline: part('.pb-progress'),
          row: part('.pb-controls'),
          play: part('.pb-play-btn'),
          time: part('.pb-time'),
          speed: part('[data-test="pb-speed-current"]'),
          step: part('[data-test="pb-fwd5"]'),
          gap: getComputedStyle(controlsEl).rowGap,
          pad: getComputedStyle(controlsEl).paddingTop,
        }
      })() : null,
      toolbarChildren,
      speedButtons: document.querySelectorAll('.pb-speed .pb-btn').length,
      speedPicker: !!box(document.querySelector('[data-test="pb-speed-current"]')),
      displayEntry: !!box(document.querySelector('[data-testid="display-toggle"]')),
    }
    // 「显示」入口必须常驻可点（唯一的二级控件入口）
    if (!out.compact.displayEntry) out.errors.push('compact: display entry point is not visible')
    // 常驻工具条项只允许「显示」这一个（相机 / 阵容 / 画质都进面板）
    const extra = toolbarChildren.filter((c) => c.label !== 'display').map((c) => c.label)
    if (extra.length) out.errors.push(`compact: secondary controls still permanent on the toolbar: ${extra.join(', ')}`)
    if (document.querySelectorAll('.pb-speed .pb-btn').length > 0) {
      out.errors.push(`compact: ${out.compact.speedButtons} permanent speed buttons (must be progressive disclosure)`)
    }
    if (!out.compact.speedPicker) out.errors.push('compact: current-speed control is missing')
    if (controlsBox) {
      // 常驻控件（时间轴 + 一行按钮）不得吃掉战场：战场至少保留工作区高的 55%
      const sceneH = rootH - controlsBox.height
      out.compact.sceneH = +sceneH.toFixed(1)
      if (sceneH < rootH * 0.55) {
        out.errors.push(`compact: controls take too much scene height (scene=${sceneH.toFixed(1)} of root=${rootH.toFixed(1)}; controls=${controlsBox.height.toFixed(1)}; parts=${JSON.stringify(out.compact.parts)})`)
      }
    } else {
      out.errors.push('compact: playback controls missing')
    }
  }
  return out
}

/** 「显示」面板：全部开关可用、面板不越界、隐藏全部 UI 可恢复（真实点击）。 */
function displayPanelProbe() {
  const root = document.querySelector('.pb-root')
  const out = { root: !!root, errors: [], panel: null }
  if (!root) return out
  const rr = root.getBoundingClientRect()
  const panel = document.querySelector('[data-testid="display-panel"]')
  if (!panel) { out.errors.push('display panel not open'); return out }
  const pb = panel.getBoundingClientRect()
  out.panel = { l: +pb.left.toFixed(1), t: +pb.top.toFixed(1), r: +pb.right.toFixed(1), b: +pb.bottom.toFixed(1) }
  if (root.classList.contains('portrait-flow')) {
    // 竖屏纵向流：「显示」面板是传输控件之后的流内内容块（页面滚动），不是盖在 Stage 上的浮层。
    const controls = document.querySelector('.controls')?.getBoundingClientRect()
    const square = document.querySelector('.stage-square')?.getBoundingClientRect()
    if (getComputedStyle(panel).position !== 'static') out.errors.push('portrait display panel must be an in-flow block')
    if (controls && pb.top < controls.bottom - 1) out.errors.push('portrait display panel must follow the transport')
    if (square && pb.top < square.bottom - 1) out.errors.push('portrait display panel must not cover the Stage')
    for (const id of ['disp-topbar', 'disp-roster', 'disp-killfeed', 'disp-base', 'disp-player', 'disp-tank', 'disp-hp', 'disp-reload', 'disp-glb', 'hide-all-ui']) {
      if (!document.querySelector(`[data-testid="${id}"]`)) out.errors.push(`display panel control missing: ${id}`)
    }
    return out
  }
  // 可见范围 = .pb-root 与视口的交集（工作台在矮窗口里可能把 .pb-root 顶部推到视口外，
  // 那时"超出视口"并不等于面板不可用；真正的要求是面板落在**可见的面板区域**内）。
  const visTop = Math.max(rr.top, 0)
  const visBottom = Math.min(rr.bottom, document.documentElement.clientHeight)
  // 所有形态均是根内浮层，必须位于可见区域且不遮场景中心。
  if (pb.left < -0.5 || pb.top < visTop - 0.5
    || pb.right > document.documentElement.clientWidth + 0.5 || pb.bottom > visBottom + 0.5) {
    out.errors.push(`display panel outside visible pane: ${JSON.stringify(out.panel)} visible=[${visTop.toFixed(1)},${visBottom.toFixed(1)}]`)
  }
  if (pb.height < 60) {
    out.errors.push(`display panel too short to be usable: ${Math.round(pb.height)}px`)
  }
  if (pb.height > visBottom - visTop - 8) {
    out.errors.push(`display panel taller than the visible pane: ${Math.round(pb.height)}px`)
  }
  const gear = root.querySelector('[data-testid="display-toggle"]')?.getBoundingClientRect()
  if (!gear) out.errors.push('display anchor gear missing')
  else {
    const distanceX = Math.max(0, pb.left - gear.right, gear.left - pb.right)
    const distanceY = Math.max(0, pb.top - gear.bottom, gear.top - pb.bottom)
    if (Math.hypot(distanceX, distanceY) > 16) out.errors.push(`Display must stay anchored to gear: distance=${Math.hypot(distanceX, distanceY).toFixed(1)}`)
  }
  if (pb.left < rr.left - 1 || pb.right > rr.right + 1) out.errors.push('Display exceeds workspace width')
  if (innerWidth >= 1600 && innerHeight >= 900 && panel.scrollHeight > panel.clientHeight + 1) {
    out.errors.push(`standard Display must not scroll on large screens: ${panel.scrollHeight} > ${panel.clientHeight}`)
  }
  for (const id of ['disp-topbar', 'disp-roster', 'disp-killfeed', 'disp-base', 'disp-player', 'disp-tank', 'disp-hp', 'disp-reload', 'disp-glb', 'hide-all-ui']) {
    const el = document.querySelector(`[data-testid="${id}"]`)
    if (!el) { out.errors.push(`display panel control missing: ${id}`); continue }
    // 开关的真实命中区是包住 checkbox 的 <label>（方框本身只有 13px）
    const hit = id === 'hide-all-ui' ? el : el.closest('label')
    if (!hit) { out.errors.push(`display panel control has no label hit area: ${id}`); continue }
    const r = hit.getBoundingClientRect()
    if (r.width < 20 || r.height < 20) {
      out.errors.push(`display panel control hit area too small: ${id} (${Math.round(r.width)}x${Math.round(r.height)})`)
    }
  }
  return out
}

/**
 * 横向空间归属探针：bounded roster | fluid center | bounded roster。
 *
 * 量的是**真实应用**的 grid 结果（不是 file:// fixture），所以「center 吃掉全部剩余宽度」
 * 与「HUD 属于整个 center column」是实测结论而不是 CSS 推断。
 */
function workspaceColumnsProbe() {
  const root = document.querySelector('.pb-root')
  if (!root) return { root: false }
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    }
  }
  const main = root.querySelector('.pb-main')
  const left = box(root.querySelector('.side-left'))
  const right = box(root.querySelector('.side-right'))
  const square = box(document.querySelector('.stage-square'))
  const hud = box(root.querySelector('.hud'))
  const controls = box(root.querySelector('.controls'))
  const rootBox = box(root)
  const mainBox = box(main)
  // 列宽用的是 grid 容器（root）的**内边距盒**：root 自身有 padding，边框盒会多算进去。
  const cs = getComputedStyle(root)
  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  const contentW = +(root.clientWidth - padL - padR).toFixed(1)
  // center column 的宽度：grid 里 stage/hud/controls 都占 center 列，用 HUD 的盒直接量它。
  const centerW = hud ? hud.w : null
  const laneGutter = left && hud ? +(hud.left - left.right).toFixed(1) : null
  return {
    root: true,
    portrait: root.classList.contains('portrait-flow'),
    rosterSide: root.classList.contains('roster-side'),
    laneCount: root.querySelectorAll('.team-lane').length,
    columns: cs.gridTemplateColumns,
    left, right, square, hud, controls, rootBox, mainBox, contentW, centerW, laneGutter,
    laneW: left ? +left.w.toFixed(1) : null,
    rootW: rootBox ? +rootBox.w.toFixed(1) : null,
  }
}

/**
 * 等名册布局**稳定**（连续两次读到的几何签名一致）。
 *
 * 为什么不能只 sleep 一个常数：`Replay3DPane` 的 ResizeObserver 会把实测高度写回
 * `--pb-workspace-h`，每写一次都重排一次根元素、车道与传输控件。抢在重排中间读，
 * 拿到的是「上一轮布局 + 这一轮变量」的混合几何 —— 那是假失败（实测 1024×768 有时过、
 * 有时不过，差别只在读的时机）。
 */
function rosterLayoutSignature() {
  const root = document.querySelector('.pb-root')
  if (!root) return null
  const lane = root.querySelector('.team-lane')
  const controls = root.querySelector('.controls')
  const box = (el) => (el ? [Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().height)].join(',') : '-')
  return [
    box(root),
    box(lane),
    box(controls),
    root.style.getPropertyValue('--pb-workspace-h'),
    root.className,
  ].join('|')
}

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

async function runRosterGeometryScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  // ?debug：Replay3DPane 的状态注入口（与场景内核的 ?debug 钩子同一口径），
  // 必须在面板 setup 之前就在 URL 上。
  await page.goto(`${env.origin}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="3d"]'), { label: 'capability tabs' })

  // 单文件选择（DataTransfer 写入真实 input + change 事件）：单文件时 currentTargetFile
  // 直接派生为该 File，解析成败不影响 3D 面板拿到 file prop（稍后注入就绪态）。
  await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="select-files-input"]')
    if (!input) throw new Error('file input missing')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'roster-geometry.wotbreplay'))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)

  // 真实点击切到 3D 能力（工作台内挂载 Replay3DPane）
  const tabCenter = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="ws-tab"][data-cap="3d"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === button || button.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`)
  check(failures, !!tabCenter, '3D capability tab not hit-testable')
  if (!tabCenter) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  await page.tap({ ...tabCenter, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  // 真实点击「开始」：走过待开播闸门；垃圾文件必然解析失败 → 等内核状态收敛（err 落下，
  // 或极端环境下解析直接成功 hasData）再注入就绪态，此后内核不再有异步写入。
  const startCenter = await page.evaluate(`(() => {
    const button = document.querySelector('[data-test="replay3d-start"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === button || button.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`)
  check(failures, !!startCenter, 'pre-start start button not hit-testable')
  if (!startCenter) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  await page.tap({ ...startCenter, touch: scenario.touch })
  await page.waitForValue(
    'window.__pbPane && (window.__pbPane.store.err.length > 0 || window.__pbPane.store.hasData === true)',
    (v) => v === true,
    { timeout: 30_000, label: 'garbage replay parse rejection' },
  )

  // 注入 3D 就绪态（reviewer 要求的 fixture：两队非空 / unknown 非空 / killfeed 非空）
  await page.evaluate(`(() => {
    const s = window.__pbPane.store
    // 名册行的形状 = 身份（eid/team/nick/tank）+ 当前回放时刻的状态投影（hp/maxHp/dead）
    const mk = (prefix, n, team) => Array.from({ length: n }, (_, i) => ({
      eid: (team === 1 ? 0 : team === 2 ? 100 : 200) + i + 1, team,
      nick: prefix + '_' + String(i + 1).padStart(2, '0'),
      tank: i % 3 === 0 ? 'Kranvagn' : (i % 3 === 1 ? 'SPHT' : 'Chieftain Mk.6'),
      hp: i === 0 ? 0 : 1950 - i * 137,
      maxHp: 1950,
      dead: i === 0, followed: team === 1 && i === 1,
      reload: i === 0 ? null : [{ state: 'full' }, { state: 'loading', progress: 0.5 }],
    }))
    s.friendlyTeam = ${scenario.recorder || 1}
    s.hasData = true
    s.loading = false
    s.assetStage = false
    s.err = ''
    s.timer = '05:12'
    s.duration = 300
    s.time = 42
    s.startTime = 0
    s.cam = 'top'
    s.roster = {
      team1: mk('Ally', ${scenario.players}, 1),
      team2: mk('Enemy', ${scenario.players}, 2),
      unknown: mk('Neutral', ${scenario.unknown ?? 2}, null),
    }
    s.killfeed = Array.from({ length: ${scenario.killfeed} }, (_, i) => ({
      id: i + 1, killer: 'Killer_' + i, victim: 'Victim_' + i, kill: true,
    }))
  })()`)
  // ResizeObserver 异步把实测工作区高度写进 `--pb-workspace-h`（车道与正方形定界依赖它）。
  // ⚠️ 定下来之前**不能**开始断言：这个变量一变，`.pb-root` 的高度、
  // 车道的上下界、控制条的位置会一起重排，读到的就是「上一轮布局 + 这一轮变量」的混合几何
  // （实测同一次运行里 1024×768 会因为抢在重排前读而失败，稍后再读就通过）。
  await waitForStableLayout(page)

  if (scenario.rotateTo) {
    await page.emulate({ ...scenario, ...scenario.rotateTo })
    await page.waitFor(() => document.querySelector('.pb-root')?.classList.contains('roster-side'),
      { label: 'rotated 3D pane switches to Team 1 | Stage | Team 2' })
    await waitForStableLayout(page)
  }
  const viewport = scenario.rotateTo || scenario
  const sceneBefore = await page.evaluate('(window.__sceneMarker = window.__pbPane.sceneApi, true)')
  if (scenario.fullscreen) {
    const fsButton = await page.evaluate(`(() => {
      const el = document.querySelector('[data-test="pb-fullscreen"]')
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    check(failures, !!fsButton, '3D fullscreen control missing')
    if (fsButton) {
      await page.tap({ ...fsButton, touch: scenario.touch })
      await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: '3D document.fullscreenElement' })
      await waitForStableLayout(page)
    }
  }

  const geometry = await page.probe(rosterGeometryProbe)
  check(failures, geometry.root, 'pb-root missing')
  check(failures, geometry.viewport.width === viewport.width && geometry.viewport.height === viewport.height,
    `viewport collapsed: requested ${viewport.width}x${viewport.height}, measured ${JSON.stringify(geometry.viewport)}`)
  check(failures, geometry.errors.length === 0, `geometry violations: ${geometry.errors.join('; ')}`)
  check(failures, geometry.hpCells >= 2, 'roster HP cells missing in real browser')
  const expectedRows = scenario.players * 2 + (scenario.unknown ?? 2)
  check(failures, geometry.rows === expectedRows, `roster hides players: ${geometry.rows} rows, expected ${expectedRows}`)
  check(failures, geometry.rowsComplete, 'roster rows must show player / tank / HP bar with in-bar text')
  // HP 是主 combat state：行里必须真的有一条 HP bar（数值 / 百分比已经收进条内）。
  check(failures, geometry.hpBar, 'roster rows must render an HP bar')
  check(failures, geometry.laneIds[0].every((nick) => nick.startsWith(scenario.recorder === 2 ? 'Enemy' : 'Ally') || nick.startsWith('Neutral'))
    && geometry.laneIds[1].every((nick) => nick.startsWith(scenario.recorder === 2 ? 'Ally' : 'Enemy')),
    `lanes must follow Recorder perspective (friendly left / enemy right): ${JSON.stringify(geometry.laneIds)}`)
  if (scenario.layout === 'portrait') {
    check(failures, geometry.portrait && !geometry.side, `portrait must be the vertical flow (class portrait-flow): ${JSON.stringify(geometry)}`)
    const order = await page.evaluate(`(() => {
      const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null
      return { stage: top('.stage-square'), controls: top('.controls'), left: top('.side-left'), right: top('.side-right') }
    })()`)
    check(failures, order.stage < order.controls && order.controls < order.left && order.left < order.right,
      `portrait order must be Stage → Transport → Team 1 → Team 2: ${JSON.stringify(order)}`)
  } else {
    check(failures, geometry.side && !geometry.portrait, `expected Team 1 | Stage | Team 2 (class roster-side): portrait=${geometry.portrait} side=${geometry.side}`)
  }

  // Desktop center follows the maximum square; remaining width belongs to equal roster lanes.
  if (geometry.side) {
    const columns = await page.probe(workspaceColumnsProbe)
    // --pb-roster-min = 9rem，按根字号折算（2/6/2 的窄档 fallback 就是守在它上面）。
    const rosterMinPx = 9 * (await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize) || 16'))
    check(failures, columns.root, 'workspace columns: pb-root missing')
    check(failures, Math.abs(columns.left.w - columns.right.w) <= 0.5,
      `both lanes must share one width: ${JSON.stringify({ left: columns.left.w, right: columns.right.w })}`)
    // center 吃掉除两条 lane 与 gutter 之外的全部宽度（没有额外 max-width / margin 卡窄它）。
    // centerW 量自 HUD 盒（HUD 属于整列），所以这条同时证明「HUD 属于整列」。
    const expectedCenter = columns.contentW - 2 * columns.laneW - 2 * (columns.laneGutter ?? 0)
    check(failures, Math.abs(columns.centerW - expectedCenter) <= 1.5,
      `center column must consume all remaining width (expected ${expectedCenter}): ${JSON.stringify({ centerW: columns.centerW, laneW: columns.laneW, contentW: columns.contentW, gutter: columns.laneGutter })}`)
    // Desktop must not reserve dead space beside the square.
    if (scenario.width >= 1200) check(failures, Math.abs(columns.centerW - geometry.square.w) <= 2,
      `desktop center must fit the square: center=${columns.centerW} square=${geometry.square.w}`)
    // lane 不得低于可读下限（--pb-roster-min，2/6/2 的窄档 fallback 就是守在它上面）。
    // 下限值随 scenario 传入：page.evaluate 的表达式里没有 getComputedStyle 作用域。
    check(failures, columns.laneW >= rosterMinPx - 0.5,
      `roster lane must keep its readable floor: ${JSON.stringify({ laneW: columns.laneW, minLane: rosterMinPx })}`)
    // HUD 属于整个 center column，而不是按内容收缩成中间小块
    check(failures, columns.hud && Math.abs(columns.hud.w - columns.centerW) <= 1,
      `HUD must span the whole center column: ${JSON.stringify({ hudW: columns.hud?.w, centerW: columns.centerW })}`)
    // 正方形 Stage 落在 center column 内，且不产生水平溢出
    check(failures, columns.square && columns.square.w <= columns.centerW + 0.5,
      `Stage must fit inside the center column: ${JSON.stringify({ stage: columns.square?.w, centerW: columns.centerW })}`)
    check(failures, columns.square && Math.abs(columns.square.w - columns.square.h) <= 1,
      `Stage must stay square: ${JSON.stringify({ w: columns.square?.w, h: columns.square?.h })}`)
    check(failures, columns.rootBox.left >= -0.5 && columns.rootBox.right <= viewport.width + 0.5,
      `workspace must not overflow horizontally: ${JSON.stringify({ root: columns.rootBox, viewport: viewport.width })}`)
    // center column 水平居中：HUD 中心必须落在两条车道之间（左右留白对称）
    const hudCenter = columns.hud.left + columns.hud.w / 2
    const rootCenter = columns.rootBox.left + columns.rootBox.w / 2
    check(failures, Math.abs(hudCenter - rootCenter) <= 1,
      `center column must stay centered between the lanes: ${JSON.stringify({ hudCenter, rootCenter })}`)

    // roster off：两条车道必须完全消失、center 变成满宽、Stage 仍居中。
    // 用 hit-tested 的 clickElement：矮视口下 Display 面板比可见区还高，必须先滚面板再点。
    await page.evaluate(`document.querySelector('[data-testid="display-toggle"]')?.click()`)
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'),
      { label: 'display panel for roster toggle' })
    const rosterToggle = await clickElement(page, '[data-testid="disp-roster"]')
    check(failures, clicked(rosterToggle), `roster toggle not clickable: ${rosterToggle}`)
    if (clicked(rosterToggle)) {
      await page.waitFor(() => !document.querySelector('.pb-root')?.classList.contains('roster-side'),
        { label: 'roster lanes removed' })
      await waitForStableLayout(page)
      const off = await page.probe(workspaceColumnsProbe)
      check(failures, off.laneCount === 0 && !off.left && !off.right,
        `roster off must remove both lanes entirely: ${JSON.stringify({ laneCount: off.laneCount, left: off.left, right: off.right })}`)
      // center 变成满宽：Stage 不再被两条 lane 挤窄。
      // 注意 Stage 常是**高度受限**的（宽屏正方形由可用高度决定），所以这里锁的是
      // 「不会被挤小 + 不横向溢出」，而不是无条件变大。
      check(failures, off.square && off.square.w >= columns.square.w - 1,
        `roster off must not shrink the Stage: on=${columns.square?.w} off=${off.square?.w}`)
      check(failures, off.square && off.square.w <= off.rootW + 0.5,
        `roster off Stage must stay inside the workspace: ${JSON.stringify({ stage: off.square?.w, rootW: off.rootW })}`)
      // 若宽度本是限制项（center < 可用高度），关掉名册后 Stage 必须变大
      if (columns.centerW < columns.square.h - 1) {
        check(failures, off.square.w > columns.square.w,
          `roster off must enlarge a width-bound Stage: on=${columns.square?.w} off=${off.square?.w}`)
      }
      // Stage 仍水平居中于工作区
      check(failures, off.square && Math.abs((off.square.left + off.square.w / 2) - (off.rootBox.left + off.rootBox.w / 2)) <= 1.5,
        `roster off must keep the Stage centered: ${JSON.stringify({ square: off.square, root: off.rootBox })}`)
      // 恢复：名册回来，几何回到名册开启时的形状
      const restoreToggle = await clickElement(page, '[data-testid="disp-roster"]')
      check(failures, clicked(restoreToggle), `roster toggle restore not clickable: ${restoreToggle}`)
      await page.waitFor(() => document.querySelector('.pb-root')?.classList.contains('roster-side'),
        { label: 'roster lanes restored' })
      await waitForStableLayout(page)
      const restored = await page.probe(workspaceColumnsProbe)
      check(failures, Math.abs(restored.laneW - columns.laneW) <= 1 && Math.abs(restored.centerW - columns.centerW) <= 1,
        `restoring the roster must return the same column geometry: ${JSON.stringify({ before: columns.laneW, after: restored.laneW })}`)
    }
    await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
    await page.waitFor(() => !document.querySelector('[data-testid="display-panel"]:not([hidden])'),
      { label: 'display panel closed after roster check' })
  }
  if (scenario.fullscreen) {
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi'), 'entering fullscreen must not recreate the 3D scene')
  }

  // —— 选择：名册行 → 共享详情；选择不动相机 / 跟随 / 时间 ——
  const selectionBefore = await page.evaluate(`JSON.stringify({
    cam: window.__pbPane.store.cam,
    followed: window.__pbPane.store.roster.team1.filter(p => p.followed).map(p => p.eid),
    time: window.__pbPane.store.time,
  })`)
  // 页面顶部有吸顶的工作台标题：先把行滚到视口中部再点（真机用户也是这样点到的）。
  await page.evaluate(`document.querySelector('.team1 .pl:nth-child(2)')?.scrollIntoView({ block: 'center' })`)
  const rowClick = await clickElement(page, '.team1 .pl:nth-child(2)')
  check(failures, clicked(rowClick), `roster row not selectable: ${rowClick}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-info"]'), { label: 'roster selects and opens shared details' })
  const selectionAfter = await page.evaluate(`JSON.stringify({
    cam: window.__pbPane.store.cam,
    followed: window.__pbPane.store.roster.team1.filter(p => p.followed).map(p => p.eid),
    time: window.__pbPane.store.time,
  })`)
  check(failures, selectionAfter === selectionBefore, 'roster selection must not alter camera/follow/time')
  check(failures, await page.evaluate(`!document.querySelector('[data-test="pb-sb-dealt"]')
    && !document.querySelector('[data-test="pb-sb-v2-inspector"]')`),
    '3D details must hide unavailable stats/inspector rather than fabricate zeros')
  const details = await page.evaluate(`(() => {
    const el = document.querySelector('[data-test="pb-info"]')
    return { presentation: el.dataset.presentation, parentIsRoot: el.parentElement === document.querySelector('.pb-root'),
      lanes: document.querySelectorAll('.team-lane').length }
  })()`)
  check(failures, details.presentation === (scenario.layout === 'portrait' ? 'inline' : 'floating'),
    `details presentation=${details.presentation}`)
  check(failures, details.parentIsRoot, 'details must belong to the whole 3D workspace (.pb-root)')
  check(failures, details.lanes === 2, 'opening details must not hide either roster lane')

  if (scenario.layout === 'side') {
    // 拖到 Team 2 / Stage / Team 1 之上：始终在 workspace 内、不压传输控件
    for (const sel of ['.side-right', '.stage-square', '.side-left']) {
      const target = await page.evaluate(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return r.left + r.width / 2 })()`)
      await dragDetailsTo(page, target, scenario.touch)
      const d = await page.evaluate(`(() => {
        const p = document.querySelector('[data-test="pb-info"]').getBoundingClientRect()
        const root = document.querySelector('.pb-root').getBoundingClientRect()
        const t = document.querySelector('${sel}').getBoundingClientRect()
        const c = document.querySelector('.controls')?.getBoundingClientRect()
        const centre = p.left + p.width / 2
        return { over: centre >= t.left - p.width / 2 && centre <= t.right + p.width / 2,
          inside: p.left >= root.left - 0.5 && p.right <= root.right + 0.5 && p.top >= root.top - 0.5,
          clearOfControls: !c || p.bottom <= c.top + 0.5, left: p.left, top: p.top }
      })()`)
      check(failures, d.over, `3D details could not be dragged over ${sel}: ${JSON.stringify(d)} target=${target} hit=${await page.evaluate(`(() => { const h = document.querySelector('[data-test="pb-sb-drag"]').getBoundingClientRect(); const e = document.elementFromPoint(h.left + 12, h.top + h.height / 2); return e ? e.className : null })()`)}`)
      check(failures, d.inside, `3D details left the workspace after dragging over ${sel}`)
      check(failures, d.clearOfControls, `3D details covers the transport after dragging over ${sel}`)
    }
  }
  // 位置按 workspace（.pb-root）坐标比较：点行之前助手会把行滚进视口，页面滚动不是浮窗移动。
  const relativePanel = `(() => { const p = document.querySelector('[data-test="pb-info"]')?.getBoundingClientRect(); const r = document.querySelector('.pb-root').getBoundingClientRect(); return p ? { l: p.left - r.left, t: p.top - r.top } : {} })()`
  const dragged = await page.evaluate(relativePanel)
  // Team 2 连点：同一个窗更新，Team 2 车道仍在，拖过的位置不动
  await page.evaluate(`document.querySelector('.team2 .pl:nth-child(3)')?.scrollIntoView({ block: 'center' })`)
  const team2Click = await clickElement(page, '.team2 .pl:nth-child(3)')
  check(failures, clicked(team2Click), `Team 2 row not clickable with details open: ${team2Click}`)
  await delay(200)
  const afterTeam2 = { ...(await page.evaluate(`(() => ({ count: document.querySelectorAll('[data-test="pb-info"]').length,
      player: document.querySelector('[data-test="pb-sb-player"]')?.textContent.trim(),
      lane: !!document.querySelector('.team2'), selected: window.__pbPane.selectedEid }))()`)),
  ...(await page.evaluate(relativePanel)) }
  check(failures, afterTeam2.count === 1 && afterTeam2.player === 'Enemy_03' && afterTeam2.lane,
    `Team 2 selection must update the single details panel: ${JSON.stringify(afterTeam2)}`)
  if (scenario.layout === 'side') {
    check(failures, Math.abs(afterTeam2.l - dragged.l) < 1 && Math.abs(afterTeam2.t - dragged.t) < 1,
      'user-dragged 3D details position must survive selection changes')
  }
  await page.evaluate(`document.querySelector('[data-test="pb-sb-close"]')?.scrollIntoView({ block: 'center' })`)
  await clickElement(page, '[data-test="pb-sb-close"]')
  await page.waitFor(() => !document.querySelector('[data-test="pb-info"]'), { label: 'shared details close' })
  check(failures, await page.evaluate('window.__pbPane.selectedEid === 103 && !!document.querySelector(".team2 .pl.selected")'),
    'details × must keep the 3D selection')
  check(failures, await page.evaluate(`JSON.stringify({
    cam: window.__pbPane.store.cam,
    followed: window.__pbPane.store.roster.team1.filter(p => p.followed).map(p => p.eid),
    time: window.__pbPane.store.time,
  })`) === selectionBefore, 'closing details must not alter camera/follow/time')
  if (scenario.fullscreen) {
    await page.evaluate('document.exitFullscreen()')
    await page.waitFor(() => !document.fullscreenElement, { label: 'exit fullscreen' })
    check(failures, await page.evaluate('window.__sceneMarker === window.__pbPane.sceneApi && window.__pbPane.selectedEid === 103'),
      'exiting fullscreen must keep the scene and selection')
  }

  // —— 「显示」面板：真实点击展开，几何在视口内，不盖场景中心 ——
  // 可点目标：先在面板自身的滚动容器内把元素滚进可视区（**不用 scrollIntoView**：它会连带
  // 滚动祖先，把底部控制条滚出视口 → 中心点命中失败，实测 1600x900 的隐藏按钮就是这样"不可点"），
  // 再做 elementFromPoint 命中验证。

  // —— 「显示」面板：真实点击展开，几何在视口内，不盖场景中心 ——
  // 这段探针 2D / 3D 共用，且断言「点一下 = 打开」。3D 的名册场景会开关同一面板，
  // 所以先**幂等地归位到关闭**（关着就不动），再点开——否则点击会变成关闭、后续等待超时。
  await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (panel && !panel.hidden) document.querySelector('[data-testid="display-toggle"]')?.click()
  })()`)
  await page.waitFor(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    return !panel || panel.hidden
  }, { label: 'display panel closed before probe' })
  const displayToggle = await clickElement(page, '[data-testid="display-toggle"]')
  check(failures, clicked(displayToggle), `display toggle not clickable: ${displayToggle}`)
  if (clicked(displayToggle)) {
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'display panel opens' })
    const panel = await page.probe(displayPanelProbe)
    check(failures, panel.errors.length === 0, `display panel violations: ${panel.errors.join('; ')}`)

    // 单个分块开关真实生效：把击杀流**显式关掉**（先读当前值，避免依赖上一条浏览器配置里的
    // 持久化偏好），它必须从 DOM 里消失。失败时把复选框状态与面板几何一起带出来。
    const killToggle = await page.evaluate(`document.querySelector('[data-testid="disp-killfeed"]')?.checked`)
      ? await clickElement(page, '[data-testid="disp-killfeed"]') : 'already-off'
    check(failures, killToggle === 'already-off' || clicked(killToggle), `kill feed toggle not clickable: ${killToggle}`)
    if (clicked(killToggle)) {
      const killHidden = await page.waitFor(() => !document.querySelector('.killfeed'), { label: 'kill feed hidden by display panel' })
        .then(() => true)
        .catch(() => false)
      if (!killHidden) {
        const state = await page.evaluate(`JSON.stringify({
          checked: document.querySelector('[data-testid="disp-killfeed"]')?.checked,
          killfeed: document.querySelectorAll('.killfeed .kf').length,
          panel: (() => { const p = document.querySelector('.display-panel'); if (!p) return null; const r = p.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), p.scrollHeight, p.clientHeight] })(),
        })`)
        check(failures, false, `kill feed still visible after toggle: ${state}`)
      }
    }

    // H respects interactive targets, then closes an already-open Display panel and hides
    // result presentation without deleting its underlying state. Real keyboard input is
    // required: a synthetic event dispatched on window would bypass the focus/target guard.
    await page.evaluate(`(() => {
      window.__pbPane.store.banner = { text: 'Fixture battle result' }
      document.querySelector('[data-testid="disp-tank"]').focus()
    })()`)
    await page.pressH()
    check(failures, await page.evaluate(`!!document.querySelector('[data-testid="display-panel"]:not([hidden])')
      && !document.querySelector('[data-testid="show-all-ui"]')`), 'H on a checkbox must not hide UI')
    await page.evaluate('document.activeElement?.blur()')
    await page.pressH()
    await page.waitFor(() => {
      const root = document.querySelector('.pb-root')
      const panel = root?.querySelector('[data-testid="display-panel"]')
      return !!root && !root.querySelector('.hud') && !root.querySelector('.team-lane')
        && !root.querySelector('.controls') && !root.querySelector('.banner')
        && (!panel || panel.hidden) && !!root.querySelector('[data-testid="show-all-ui"]')
    }, { label: 'H hides all UI and closes Display' })
    check(failures, await page.evaluate('window.__pbPane.store.banner?.text === "Fixture battle result"'),
      'hide all UI must preserve underlying result state')
    const restoreAfterH = await clickElement(page, '[data-testid="show-all-ui"]')
    check(failures, clicked(restoreAfterH), `restore button after H not clickable: ${restoreAfterH}`)
    await page.waitFor(() => !!document.querySelector('.controls') && !!document.querySelector('.banner')
      && !document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'restore returns result, keeps Display closed' })
    const reopenDisplay = await clickElement(page, '[data-testid="display-toggle"]')
    check(failures, clicked(reopenDisplay), `display toggle after restore not clickable: ${reopenDisplay}`)
    await page.waitFor(() => !!document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'Display reopens' })

    // The inverse path uses the same transition: button hides, H restores.
    const hideBtn = await clickElement(page, '[data-testid="hide-all-ui"]')
    check(failures, clicked(hideBtn), `hide-all-ui button not clickable: ${hideBtn}`)
    if (clicked(hideBtn)) {
      await page.waitFor(() => {
        const root = document.querySelector('.pb-root')
        return !!root && !root.querySelector('.hud') && !root.querySelector('.team-lane')
          && !root.querySelector('.controls') && !root.querySelector('.banner')
          && !root.querySelector('[data-testid="display-panel"]:not([hidden])')
          && !!root.querySelector('[data-testid="show-all-ui"]')
      }, { label: 'all UI hidden' })
      await page.evaluate('document.activeElement?.blur()')
      await page.pressH()
      await page.waitFor(() => !!document.querySelector('.controls') && !!document.querySelector('.banner')
        && !document.querySelector('[data-testid="show-all-ui"]')
        && !document.querySelector('[data-testid="display-panel"]:not([hidden])'), { label: 'H restores UI after button hides it' })
    }
  }

  // —— A → 清空 → B（真实解析生命周期，P0 回归路径）——
  // 注意：本段必须先等 A 收敛（err / hasData）才能注入就绪态，所以它覆盖的是「A 已 settle
  // 后再换文件」；**A 仍在解析时就被清空**的线上真实序列由下面的
  // `runParseLifecycleScenario`（parse-lifecycle-* 场景）用闸门 Worker 覆盖。
  // 撤下第一场（解析未完成 resp=null → per-file remove 无确认；列表默认折叠，先展开），
  // 换入第二份文件再真实点击「开始」：第二场的解析必须收敛（loading 落下、err 或 ready），
  // 不得因旧解析占着 Worker 队列永远停在「解析中」。
  await page.evaluate(`(() => {
    const toggle = document.querySelector('.filebar .fb-actions button[aria-expanded]')
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  })()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="file-list"] .chipx'), { label: 'file chip after expanding list' })
  const chipCenter = await page.evaluate(`(() => {
    const chip = document.querySelector('[data-testid="file-list"] .chipx')
    chip.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = chip.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === chip || chip.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`)
  check(failures, !!chipCenter, 'file remove chip not hit-testable')
  if (chipCenter) {
    await page.installInputTrace()
    await page.tap({ ...chipCenter, touch: scenario.touch })
    const chipInput = await page.inputTrace()
    check(failures, chipInput.clickCount === 1, `file remove chip must receive exactly one real click: ${JSON.stringify(chipInput)}`)
    check(failures, chipInput.primary?.testId === 'file-list' && chipInput.click?.testId === 'file-list',
      `file remove touch/click must hit the chip: ${JSON.stringify(chipInput)}`)
    await page.waitFor(() => !document.querySelector('.pb-root'), { label: '3D pane torn down after clear' })
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="select-files-input"]')
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array([5, 6, 7, 8])], 'roster-geometry-b.wotbreplay'))
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { label: 'pre-start for battle B' })
    const startBCenter = await page.evaluate(`(() => {
      const button = document.querySelector('[data-test="replay3d-start"]')
      button.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return (hit === button || button.contains(hit))
        ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        : null
    })()`)
    check(failures, !!startBCenter, 'battle B start button not hit-testable')
    if (startBCenter) {
      // 先清掉 A 的失败残留：此后 store.err 只能由 B 自己的解析写回（内核代数 guard
      // 保证只有当前加载可写 err）——「err 重新非空」就是 B 的解析跑完并收敛的证明。
      // 若 P0 回归（旧解析占队列导致 B 永远「解析中」），err 保持空 → 超时失败。
      await page.evaluate(`(() => { window.__pbPane.store.err = '' })()`)
      await page.tap({ ...startBCenter, touch: scenario.touch })
      const settled = await page.waitForValue('window.__pbPane && window.__pbPane.store.err.length > 0', (v) => v === true,
        { timeout: 30_000, label: 'battle B parse settled (not stuck in parsing)' }).catch(() => null)
      check(failures, settled === true, 'battle B parse did not settle after A was cleared (stuck in parsing?)')
    }
  }

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}`, geometry })
}

async function runAppScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  const authParams = scenario.authInit
    ? `&ws-auth-init=${scenario.authInit}&ws-auth-timeout-ms=${scenario.authTimeout ?? 12_000}`
    : ''
  const roleParams = scenario.roles?.length ? `&ws-roles=${encodeURIComponent(scenario.roles.join(','))}` : ''
  const url = `${env.origin}/?view=replay&ws-auth=${scenario.authenticated ? 1 : 0}&ws-login=${scenario.login}${authParams}${roleParams}`
  await page.goto(url)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="playback"]'), { label: 'capability tabs' })

  // 无 auth gating：auth init 挂起 / 失败时数据面板也必须马上出现（远早于 auth watchdog）
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-data"]'), {
    ...(scenario.authInit ? { timeout: 3_000 } : {}),
    label: 'data pane',
  })
  if (scenario.authInit === 'pending') {
    check(failures, await page.evaluate(`window.__wsAuth?.authInitState?.value !== 'authenticated'`),
      'auth init unexpectedly settled; the pending scenario no longer proves the workspace ignores auth')
  }
  check(failures, !(await page.evaluate(`!!document.querySelector('[data-testid="ws-auth-loading"]')`)),
    'workspace shows a removed auth-checking state')

  // —— B. 无透明 blocker：真实 hit-testing ——
  const hit = await page.probe(capabilityHitProbe)
  check(failures, hit.found, 'capability tab button missing')
  check(failures, hit.hitIsButton, `elementFromPoint(${hit.center?.x},${hit.center?.y}) hit ${JSON.stringify(hit.hitChain)} instead of the tab button`)
  check(failures, hit.pointerEvents === 'auto', `tab pointer-events=${hit.pointerEvents}`)
  check(failures, hit.visibility === 'visible' && Number(hit.opacity) > 0.9, `tab visibility=${hit.visibility} opacity=${hit.opacity}`)
  check(failures, hit.insideViewport, `tab rect ${JSON.stringify(hit.rect)} is outside the ${hit.viewportWidth}px viewport`)
  check(failures, hit.pageScrollWidth <= hit.viewportWidth + 1, `page-level horizontal overflow: scrollWidth=${hit.pageScrollWidth} viewport=${hit.viewportWidth}`)
  if (scenario.touch) {
    check(failures, hit.coarsePointer && hit.hoverNone, `device emulation missed pointer:coarse/hover:none (coarse=${hit.coarsePointer} hoverNone=${hit.hoverNone})`)
  }

  // —— A/C. 真实点击 ——
  await page.installInputTrace()
  await page.tap({ ...hit.center, touch: scenario.touch })
  const input = await page.inputTrace()
  check(failures, input?.primary?.cap === 'playback',
    `the real ${scenario.touch ? 'touchstart' : 'mousedown'} landed on ${JSON.stringify(input?.primary)} instead of the playback tab button`)
  check(failures, input?.click?.cap === 'playback',
    `the real click landed on ${JSON.stringify(input?.click)} instead of the playback tab button`)

  await page.waitForValue('new URLSearchParams(location.search).get("view")', (value) => value === 'battle-playback', { label: 'route ?view=battle-playback' })
  const state = await page.probe(capabilityStateProbe)
  check(failures, state.playback.visible, `ws-playback not visible after tap (${JSON.stringify(state.playback)})`)
  check(failures, !state.data.visible, 'ws-data still visible after switching to playback')
  const playbackTab = state.tabs.find((tab) => tab.cap === 'playback')
  check(failures, !!playbackTab && playbackTab.selected && playbackTab.active, `playback tab not marked active: ${JSON.stringify(state.tabs)}`)
  // §3.6：结论必须稳定——不能被别的 watcher / route sync 事后改回 data/ai。
  await delay(500)
  const settled = await page.probe(capabilityStateProbe)
  check(failures, settled.playback.visible && !settled.data.visible
    && settled.tabs.find((tab) => tab.cap === 'playback')?.selected === true,
  `capability was reverted by a later watcher/route sync: ${JSON.stringify(settled)}`)
  check(failures, await page.evaluate('new URLSearchParams(location.search).get("view")') === 'battle-playback',
    'route was reverted away from ?view=battle-playback by a later watcher/route sync')
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  if (!scenario.authenticated) {
    const attempts = await page.evaluate('window.__wsAuth.loginCalls.length')
    check(failures, attempts === 0, `anonymous capability switch must not start login, loginCalls=${attempts}`)
  }

  // 五项能力对所有身份公开可见，身份只决定受保护能力是否挂载。
  const expectedCaps = ['data', 'playback', '3d', 'shots', 'ai']
  check(failures, JSON.stringify(state.tabs.map((t) => t.cap)) === JSON.stringify(expectedCaps),
    `capability set=${JSON.stringify(state.tabs.map((t) => t.cap))}, expected ${JSON.stringify(expectedCaps)}`)
  if (scenario.touch) {
    const small = state.tabs.filter((t) => t.minSide < 43.5)
    check(failures, small.length === 0,
      `coarse capability targets below 44px: ${JSON.stringify(small)}`)
  }

  // —— 3D 能力：切过去留在同一工作台，URL 与面板一起变 ——
  const threeDTab = state.tabs.find((t) => t.cap === '3d')
  const threeDHit = await page.evaluate(`(() => {
    const button = document.querySelector('[data-testid="ws-tab"][data-cap="3d"]')
    if (!button) return null
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = button.getBoundingClientRect()
    const center = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    const hit = document.elementFromPoint(center.x, center.y)
    return { center, hitIsButton: hit === button || button.contains(hit) }
  })()`)
  check(failures, !!threeDTab && !!threeDHit?.hitIsButton,
    `3D capability tab not hit-testable: ${JSON.stringify({ threeDTab, threeDHit })}`)
  if (threeDHit?.hitIsButton) {
    await page.tap({ ...threeDHit.center, touch: scenario.touch })
    await page.waitForValue('new URLSearchParams(location.search).get("view")', (value) => value === 'agent-replay',
      { label: 'route ?view=agent-replay' })
    const threeDState = await page.probe(capabilityStateProbe)
    check(failures, threeDState.threeD.visible, `ws-3d not visible after switching (${JSON.stringify(threeDState.threeD)})`)
    check(failures, !threeDState.playback.visible, 'ws-playback still visible after switching to 3D')
    check(failures, !threeDState.data.visible, 'ws-data still visible after switching to 3D')
    const gate = await page.evaluate('!!document.querySelector("[data-testid=capability-auth-gate]")')
    check(failures, gate === !scenario.authenticated, `3D gate visibility must follow authentication: ${gate}`)
  }

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
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

  const before = await page.probe(playbackControlProbe)
  // §landscape：非全屏手机横屏时地图按宽度定尺寸，方形地图可以比视口还高，
  // controls 因此排在首屏之外。要求不是「永远在首屏」，而是「可以滚动到并真的可点」。
  const control = before.hitIsButton ? before : await page.revealControl('[data-test="pb-play"]')
  check(failures, control.hitIsButton,
    `play button center hit ${control.hitDescription} instead (viewport=${control.viewportWidth}x${control.viewportHeight} geometry=${JSON.stringify(control.geometry)})`)
  if (scenario.touch && before.speedMinSide != null) {
    check(failures, before.speedMinSide >= 43.5,
      `touch speed option hit target is ${before.speedMinSide.toFixed(1)}px, below 44px`)
  }
  // 速度档位是渐进披露：常驻只有当前值，展开后是一列档位菜单——档位齐全、不越出自身容器、
  // 触屏每个档位都满足 44px。菜单是覆盖层，不参与控件条高度。
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
        check(failures, menu.speedMenu.minSide >= 43.5,
          `touch speed option hit target is ${menu.speedMenu.minSide.toFixed(1)}px, below 44px`)
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
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
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
const LIFECYCLE_SCENARIOS = [
  { name: 'parse-lifecycle-a-clear-b-390x844-coarse', width: 390, height: 844, touch: true },
  { name: 'parse-lifecycle-a-clear-b-740x360-coarse', width: 740, height: 360, touch: true },
]

/** 在 fixture server 上传入 main world 的 Worker stub 入口（`.mjs` 不是应用源码） */
const PARSE_WORKER_STUB_URL = '/scripts/browser-fixtures/playback-parse-worker-stub.mjs'

/** 页面内辅助（main world）：真实 File 选择 */
const PARSE_LIFECYCLE_BRIDGE = `(() => {
  window.__pbSelect = (name, bytes) => {
    const input = document.querySelector('[data-testid="select-files-input"]')
    if (!input) throw new Error('file input missing')
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], name))
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return input.files.length
  }
  return true
})()`

/** 可点击中心点（hit-test 通过才返回；与其它场景同一口径） */
function clickCenterExpression(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return null
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = element.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === element || element.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      : null
  })()`
}

/** fixture Worker 状态（页面内）：请求 id / terminate 次数 / 迟到回包无人认领数 */
const PARSE_WORKER_STATE = `(() => {
  const fixture = window.__pbWorkerFixture
  const workers = fixture ? fixture.workers : []
  const ids = workers.map((worker) => worker.requests.map((request) => request.id))
  const store = window.__pbPane && window.__pbPane.store
  return {
    workers: workers.length,
    ids,
    requests: ids.reduce((sum, list) => sum + list.length, 0),
    terminations: workers.reduce((sum, worker) => sum + worker.terminations, 0),
    unclaimed: workers.reduce((sum, worker) => sum + worker.unclaimed.length, 0),
    paneStore: store ? { loading: store.loading, hasData: store.hasData, err: store.err } : null,
  }
})()`

/** 放行全部已登记请求 + 清零「无人认领」计数（之后新增的条目 = 本次放行里的迟到回包） */
const RELEASE_WORKER_RESPONSES = `(() => {
  const fixture = window.__pbWorkerFixture
  for (const worker of fixture.workers) { worker.unclaimed.length = 0; worker.releaseResponses() }
  return fixture.workers.map((worker) => worker.requests.map((request) => request.id))
})()`

async function runParseLifecycleScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)

  await page.goto(`${env.origin}/?view=replay&ws-auth=1&ws-login=resolve&debug`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-tab"][data-cap="3d"]'), { label: 'capability tabs' })
  await page.evaluate(PARSE_LIFECYCLE_BRIDGE)

  // —— A：选文件 → 3D 能力页（惰性 chunk 挂载）→ 注入闸门 Worker → 真实点击「开始」 ——
  await page.evaluate('window.__pbSelect("lifecycle-a.wotbreplay", [1, 2, 3, 4])')
  const tabCenter = await page.evaluate(clickCenterExpression('[data-testid="ws-tab"][data-cap="3d"]'))
  check(failures, !!tabCenter, '3D capability tab not hit-testable')
  if (!tabCenter) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  await page.tap({ ...tabCenter, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('.pb-root'), { label: '3D pane root' })

  // 闸门 Worker 必须在**任何解析请求之前**注入：3D chunk（含 replaySource）此时已装载
  const injected = await page.evaluate(`(async () => {
    const stub = await import(${JSON.stringify(PARSE_WORKER_STUB_URL)})
    const source = window.__pbReplaySource
    if (!source) throw new Error('replaySource debug bridge missing (?debug required)')
    source.__setParseWorkerForTest(stub.installParseWorkerFixture())
    return true
  })()`).catch((error) => `Error: ${error?.message || error}`)
  check(failures, injected === true, `worker fixture injection failed: ${JSON.stringify(injected)}`)

  const startA = await page.evaluate(clickCenterExpression('[data-test="replay3d-start"]'))
  check(failures, !!startA, 'battle A start button not hit-testable')
  if (!startA) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  await page.tap({ ...startA, touch: scenario.touch })

  // A 必须真的停在 in-flight（闸门 Worker 不回包）：请求已到 Worker，且内核仍在 loading、
  // 既没有 err 也没有 hasData —— 这正是线上「A 正在解析」的那一刻。
  const inFlight = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.requests >= 1, {
      timeout: 15_000,
      label: 'battle A parse request reached the worker',
    })
    .catch(() => null)
  check(failures, inFlight !== null, `battle A parse never reached the worker: ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  check(failures, inFlight?.paneStore?.loading === true,
    `battle A must be in-flight before the clear (state=${JSON.stringify(inFlight)})`)
  check(failures, inFlight?.paneStore?.err === '' && inFlight?.paneStore?.hasData === false,
    `battle A must still be pending (no err / no data) at clear time (state=${JSON.stringify(inFlight)})`)

  // —— clear A：展开文件列表 → 真实点击 remove chip ——
  await page.evaluate(`(() => {
    const toggle = document.querySelector('.filebar .fb-actions button[aria-expanded]')
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click()
  })()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="file-list"] .chipx'), { label: 'file chip after expanding list' })
  // Dragging a chip is a scroll gesture: it must leave A selected and its parse alive.
  await page.installInputTrace()
  const dragStart = await page.evaluate(clickCenterExpression('[data-testid="file-list"] .chipx'))
  check(failures, !!dragStart, 'file chip must be hit-testable for a real scroll gesture')
  if (dragStart) {
    await dragPointer(page, dragStart, { x: dragStart.x - 24, y: dragStart.y - 24 }, { touch: scenario.touch })
    const dragInput = await page.inputTrace()
    check(failures, dragInput.clickCount === 0, `chip drag must not click: ${JSON.stringify(dragInput)}`)
    check(failures, await page.evaluate(`!!document.querySelector('[data-testid="file-list"] .chipx') && !!window.__pbPane?.store.loading`),
      'chip drag cleared selection or stopped battle A parse')
    await page.resetInputTrace()
  }
  const chipCenter = await page.evaluate(`(() => {
    const chip = document.querySelector('[data-testid="file-list"] .chipx')
    if (!chip) return null
    chip.scrollIntoView({ block: 'center', inline: 'nearest' })
    const r = chip.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === chip || chip.contains(hit))
      ? {
        x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      }
      : null
  })()`)
  check(failures, !!chipCenter, 'file remove chip not hit-testable')
  if (!chipCenter) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  // 真实输入事件必须落在 remove chip 上：用页面内记录的真实 click 目标 + 坐标证明
  // （点击完成后 chip 与列表都消失了，事后再 elementFromPoint 只会拿到别的东西）
  await page.tap({ ...chipCenter, touch: scenario.touch })
  const clearInput = await page.inputTrace()
  const click = clearInput?.click
  const insideChip = click && chipCenter.box
    && click.x >= chipCenter.box.left && click.x <= chipCenter.box.right
    && click.y >= chipCenter.box.top && click.y <= chipCenter.box.bottom
  check(failures, click?.testId === 'file-list' && insideChip,
    `the real click at (${click?.x},${click?.y}) must land on the remove chip ${JSON.stringify(chipCenter.box)} (target=${JSON.stringify(click)})`)
  check(failures, clearInput.clickCount === 1, `chip tap must click exactly once: ${JSON.stringify(clearInput)}`)
  check(failures, clearInput.pointers.some((event) => event.type === 'pointerdown' && event.testId === 'file-list')
    && clearInput.pointers.some((event) => event.type === 'pointerup' && event.testId === 'file-list')
    && !clearInput.pointers.some((event) => event.type === 'pointercancel'),
    `chip tap must complete the real pointer sequence: ${JSON.stringify(clearInput)}`)
  await page.waitFor(() => !document.querySelector('.pb-root'), { label: '3D pane torn down after clear' })

  // clear 必须**真的撤下** A 的解析：生产代码在 abort 时整体 terminate 当前 Worker
  const aborted = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.terminations >= 1, {
      timeout: 10_000,
      label: 'worker terminated after aborting battle A parse',
    })
    .catch(() => null)
  check(failures, aborted !== null,
    `clearing battle A did not abort the in-flight parse (worker never terminated): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)

  // —— B：选文件 → 真实点击「开始」 ——
  await page.evaluate('window.__pbSelect("lifecycle-b.wotbreplay", [5, 6, 7, 8])')
  await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { label: 'pre-start for battle B' })
  const startB = await page.evaluate(clickCenterExpression('[data-test="replay3d-start"]'))
  check(failures, !!startB, 'battle B start button not hit-testable')
  if (!startB) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
    return
  }
  await page.tap({ ...startB, touch: scenario.touch })

  const bRequest = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.requests >= 2, {
      timeout: 15_000,
      label: 'battle B parse request reached the worker',
    })
    .catch(() => null)
  check(failures, bRequest !== null,
    `battle B parse never reached the worker (stuck behind the abandoned A request?): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  // A 的解析被撤下时必须整体放弃那个 Worker（terminate）→ B 只能在**重建后的** Worker 上跑。
  // 若 abort 没有真的让位（旧请求仍占着旧 Worker 的队列），B 会排在 A 后面而不是新 Worker。
  check(failures, bRequest !== null && bRequest.workers >= 2 && bRequest.ids?.[1]?.length === 1,
    `battle B must parse on a re-created worker (abort must release the old queue): ${JSON.stringify(bRequest)}`)

  // —— 放行闸门：A 的迟到回包 + B 的正常回包（同一次放行；顺序 = 请求顺序） ——
  await page.evaluate(RELEASE_WORKER_RESPONSES)

  // B 必须自己收敛：旧解析不再占队列，B 的解析跑完并落到就绪态
  const settledB = await page
    .waitForValue(PARSE_WORKER_STATE, (state) => state.paneStore !== null && state.paneStore.loading === false
      && (state.paneStore.hasData === true || state.paneStore.err !== ''), {
      timeout: 30_000,
      label: 'battle B parse settled (not stuck in parsing)',
    })
    .catch(() => null)
  check(failures, settledB !== null,
    `battle B parse did not settle after A was cleared (stuck in parsing?): ${await page.evaluate(PARSE_WORKER_STATE).then(JSON.stringify).catch(String)}`)
  check(failures, settledB?.paneStore?.hasData === true && settledB?.paneStore?.err === '',
    `battle B must settle ready (old parse must not own the new session): ${JSON.stringify(settledB?.paneStore)}`)

  // A 的迟到回包必须无人认领（旧解析已经被 abort 结算，不得再写任何会话）
  const lateSettlement = await page.evaluate(`(async () => {
    const store = window.__pbPane && window.__pbPane.store
    const snapshot = () => (store ? { hasData: store.hasData, err: store.err, loading: store.loading } : null)
    const before = snapshot()
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { before, after: snapshot(), state: ${PARSE_WORKER_STATE} }
  })()`)
  check(failures, JSON.stringify(lateSettlement?.before) === JSON.stringify(lateSettlement?.after),
    `late battle A response mutated the current session: ${JSON.stringify(lateSettlement)}`)
  check(failures, lateSettlement?.state?.unclaimed >= 1,
    `late battle A response must be unclaimed (none ignored): ${JSON.stringify(lateSettlement)}`)

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
}

/** B13: real local parser/UI with every business HTTP attempt intercepted and counted.
 * Local fixture resources remain available, as bundled appassets do in airplane mode.
 * This checks state and requests only; it never inspects or captures a 3D scene.
 */
async function runOfflineWorkspaceScenario(env) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  const businessAttempts = []
  const interceptionErrors = []
  let closing = false
  await page.enable()
  await page.emulate({ width: 1600, height: 900, touch: false })
  await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__offlineFixtureOnline = false;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.__offlineFixtureOnline });`,
  }, sessionId)
  env.chrome.client.on('Fetch.requestPaused', async (params, session) => {
    if (session !== sessionId) return
    const url = new URL(params.request.url)
    const business = url.origin !== env.origin || url.pathname.startsWith('/api/')
    if (business) businessAttempts.push(params.request.url)
    try {
      await env.chrome.client.send(business ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        business ? { requestId: params.requestId, errorReason: 'InternetDisconnected' } : { requestId: params.requestId }, sessionId)
    } catch (error) {
      // Navigation cancels intercepted old-document requests before CDP can continue them.
      if (!closing && !error.message.includes('Invalid InterceptionId')) interceptionErrors.push(error.message)
    }
  })
  await env.chrome.client.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
  const params = '&ws-auth=1&ws-roles=wotbtools-admin&ws-login=reject'
  for (const [view, selector] of [
    ['agent-replay', '[data-testid="ws-3d-connectivity"]'],
    ['ai-review', '[data-testid="ws-ai-connectivity"]'],
    ['hof', '[data-testid="hof-connectivity"]'],
    ['profile', '[data-testid="profile-connectivity-unavailable"]'],
  ]) {
    const viewParams = ['ai-review', 'hof'].includes(view) ? params.replace('ws-auth=1', 'ws-auth=0') : params
    await page.goto(`${env.origin}/?view=${view}${viewParams}`)
    await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean, { label: `offline deep link ${view}` })
    check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0, `${view} started login offline`)
  }
  // Cold start and restart both initialize the ordinary local data workspace.
  for (let restart = 0; restart < 2; restart++) {
    await page.goto(`${env.origin}/?view=replay${params}`)
    await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'offline shell/restart' })
  }
  const { root } = await env.chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await env.chrome.client.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: '[data-testid="select-files-input"]',
  }, sessionId)
  await env.chrome.client.send('DOM.setFileInputFiles', {
    nodeId, files: [resolve(frontendRoot, '../common/fixtures/replays/tournament-14-14-example.wotbreplay')],
  }, sessionId)
  await page.waitFor(() => !!document.querySelector('.replay-primary-actions button'), { label: 'manual replay selected' })
  await page.evaluate(`document.querySelector('.replay-primary-actions button').click()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 60_000, label: 'real WASM local Result' })
  const ratings = await page.evaluate(`Array.from(document.querySelectorAll('.cw-player-summary tr.player-row td:nth-child(2)')).map(cell => cell.textContent.trim())`)
  check(failures, ratings.length > 0 && ratings.some(value => /[0-9]/.test(value)), 'deterministic local Rating has no scored rows')
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="playback"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-test="battle-playback"]'), { timeout: 60_000, label: 'real WASM 2D playback' })
  await page.waitFor(() => {
    const map = document.querySelector('[data-test="pb-basemap"]')
    return !!map && map.complete && map.naturalWidth > 0
  }, { label: 'bundled local 2D map' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="shots"]').click()`)
  await page.waitFor(() => document.querySelectorAll('.shot-row').length > 0, { timeout: 60_000, label: 'real WASM local shooting inspection' })
  const shots = await page.evaluate('document.querySelectorAll(".shot-row").length')
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="ai"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'offline AI gate' })
  check(failures, await page.evaluate('window.__wsAuth.loginCalls.length') === 0, 'AI started login offline')
  // Recovering connectivity may prepare local AI projection but must never submit it.
  await page.evaluate(`window.__offlineFixtureOnline = true; window.dispatchEvent(new Event('online'))`)
  await page.waitFor(() => !document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'reconnect capability update' })
  await delay(300)
  await page.evaluate(`window.__offlineFixtureOnline = false; window.dispatchEvent(new Event('offline'))`)
  await page.waitFor(() => !!document.querySelector('[data-testid="ws-ai-connectivity"]'), { label: 'disconnect capability update' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="shots"]').click()`)
  check(failures, await page.evaluate('document.querySelectorAll(".shot-row").length') === shots, 'disconnect reset local shooting/replay state')
  check(failures, businessAttempts.length === 0, `offline/reconnect matrix attempted business HTTP: ${businessAttempts.join(', ')}`)
  check(failures, interceptionErrors.length === 0, `request interception failed: ${interceptionErrors.join(', ')}`)
  closing = true
  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: 'offline-local-workspace-matrix', failures, viewport: '1600x900' })
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
  { name: 'ws2d-740x360-landscape-coarse', width: 740, height: 360, touch: true, layout: 'lanes' },
  { name: 'ws2d-844x390-landscape-coarse', width: 844, height: 390, touch: true, layout: 'lanes' },
  { name: 'ws2d-844x390-landscape-recorder-team2', width: 844, height: 390, touch: true, layout: 'lanes', recorder: 2 },
  { name: 'ws2d-844x390-fullscreen-coarse', width: 844, height: 390, touch: true, layout: 'lanes', fullscreen: true },
  { name: 'ws2d-1024x768-tablet', width: 1024, height: 768, touch: false, layout: 'lanes' },
  { name: 'ws2d-1600x900-desktop', width: 1600, height: 900, touch: false, layout: 'lanes' },
  { name: 'ws2d-1792x922-fullscreen-desktop', width: 1792, height: 922, touch: false, layout: 'lanes', fullscreen: true },
]

/** workspace 几何探针（只读）。 */
function workspace2dProbe() {
  const box = (el) => {
    if (!el || !el.getClientRects().length) return null
    const r = el.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const root = document.querySelector('[data-test="battle-playback"]')
  const main = document.querySelector('[data-test="pb-main"]')
  const lane = (side) => {
    const el = document.querySelector(`[data-test="pb-team-lane-${side}"]`)
    if (!el) return null
    const rows = [...el.querySelectorAll('[data-test="pb-roster-row"]')]
    return {
      box: box(el),
      ids: rows.map((row) => Number(row.dataset.accountId)),
      scrolls: el.scrollHeight > el.clientHeight + 1,
      rowsComplete: rows.every((row) => ['pb-roster-player', 'pb-roster-tank', 'roster-hp', 'roster-hp-text']
        .every((test) => (row.querySelector(`[data-test="${test}"]`)?.textContent || '').trim().length > 0)),
      hpBar: !!el.querySelector('[data-test="roster-hp"]'),
    }
  }
  const buttons = [...document.querySelectorAll('.pb-controls > .pb-btn, .pb-controls > * > .pb-btn, .pb-controls .pb-btn')]
    .filter((b) => b.getClientRects().length && !b.closest('.pb-speed-menu'))
  const primary = ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']
    .map((test) => box(document.querySelector(`[data-test="${test}"]`)))
  const details = document.querySelector('[data-test="pb-info"]')
  const transport = document.querySelector('[data-test="pb-transport-slot"]')
  const inline = document.querySelector('[data-test="pb-inline-area"]')
  return {
    width: innerWidth,
    height: innerHeight,
    fullscreen: !!document.fullscreenElement,
    rootClass: root?.className || '',
    hud: box(document.querySelector('.pb-hud')),
    pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
    main: box(main),
    map: box(document.querySelector('[data-test="pb-map"]')),
    transport: box(transport),
    left: lane('left'),
    right: lane('right'),
    inline: box(inline),
    inlineRosterIds: inline ? [...inline.querySelectorAll('[data-test="pb-roster-row"]')].map((r) => Number(r.dataset.accountId)) : [],
    inlineHasDetails: !!inline?.querySelector('[data-test="pb-info"]'),
    details: box(details),
    detailsCount: document.querySelectorAll('[data-test="pb-info"]').length,
    detailsParentIsMain: !!details && details.parentElement === main,
    detailsPresentation: details?.dataset.presentation || null,
    detailsPlayer: document.querySelector('[data-test="pb-sb-player"]')?.textContent?.trim() || null,
    selectedIds: [...document.querySelectorAll('[data-test="pb-roster-row"][aria-pressed="true"]')].map((r) => Number(r.dataset.accountId)),
    time: document.querySelector('[data-test="pb-time"]')?.textContent?.trim() || null,
    friendlyHp: document.querySelector('[data-test="pb-hp-value-friendly"]')?.textContent?.trim() || null,
    primaryTops: primary.map((b) => (b ? Math.round(b.t) : null)),
    primaryBoxes: primary,
    primaryOrder: [...document.querySelectorAll('.pb-controls button[data-test]')].map((b) => b.dataset.test)
      .filter((id) => ['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry'].includes(id)),
    primaryMinSide: Math.min(...primary.filter(Boolean).map((b) => Math.min(b.w, b.h))),
    buttonCount: buttons.length,
    layout: ['.battle-playback', '.pb-hud', '.pb-main', '.pb-map-stage', '.pb-map', '.pb-transport-slot', '.pb-mobile-overlay', '.pb-mobile-overlay-content', '.pb-team-lane-left', '[data-test="pb-roster-row"]'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return { selector }
      const style = getComputedStyle(element)
      return { selector, box: box(element), rows: style.gridTemplateRows, columns: style.gridTemplateColumns,
        gridRow: style.gridRow, position: style.position, display: style.display, flex: style.flex,
        padding: style.padding, margin: style.margin, border: style.borderWidth, gap: style.gap, minHeight: style.minHeight, maxHeight: style.maxHeight,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, classes: element.className,
        squareAvailable: style.getPropertyValue('--pb-square-avail-h'), workspaceHeight: style.getPropertyValue('--pb-workspace-h') }
    }),
  }
}

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

async function setRosterVisible(page, visible) {
  return page.evaluate(`(async () => {
    const wait = () => new Promise((r) => setTimeout(r, 120))
    const box = document.querySelector('[data-test="pb-show-roster"]')
    if (!box) {
      document.querySelector('[data-test="pb-secondary-entry"]')?.click()
      await wait()
    }
    const input = document.querySelector('[data-test="pb-show-roster"]')
    if (!input) return 'missing'
    if (input.checked !== ${visible}) input.click()
    await wait()
    const close = document.querySelector('[data-testid="display-close"]') || document.querySelector('[data-test="pb-secondary-entry"]')
    close?.click()
    await wait()
    return 'ok'
  })()`)
}

/**
 * Display 面开合：始终可从 gear 到达，且不把用户丢到首屏之外。
 *
 * 竖屏下 Display 是**流内**的一块面（不是浮层），必须紧跟传输控件，而不是被排到长长的
 * 详情 / 名册块之后——那种回归在 jsdom 里看不出来（没有布局引擎），只能在这里拦。
 * 宽档 / 横屏则必须是锚定 gear 的浮层。
 *
 * 必须在竖屏分支 return 之前调用：竖屏场景不走三段式断言。
 */
async function checkDisplaySurface(page, failures, layout) {
  const anchorFocused = await page.evaluate(`(() => {
    const gear = document.querySelector('[data-test="pb-secondary-entry"]')
    gear?.focus()
    return document.activeElement === gear
  })()`)
  await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]')?.click()`)
  await delay(200)
  const display = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="display-panel"]')
    if (!panel) return null
    const rect = panel.getBoundingClientRect()
    const transport = document.querySelector('[data-test="pb-transport-slot"]')
    const transportRect = transport?.getBoundingClientRect() || null
    const area = document.querySelector('[data-test="pb-inline-area"]')
    const close = panel.querySelector('[data-testid="display-close"]')
    return {
      order: getComputedStyle(panel).order,
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      position: getComputedStyle(panel).position,
      transportBottom: transportRect ? Math.round(transportRect.bottom) : null,
      inlineAreaBottom: area ? Math.round(area.getBoundingClientRect().bottom) : null,
      viewportHeight: innerHeight,
      focusInside: panel.contains(document.activeElement),
      focusOnClose: !!close && document.activeElement === close,
    }
  })()`)
  check(failures, !!display, 'Display must open from the gear')
  if (display) {
    // 键盘落点：打开时进入面内（有明确关闭入口就优先给它），不在面外干等
    check(failures, display.focusInside,
      `Display must take the keyboard focus on open: ${JSON.stringify(display)}`)
    check(failures, display.focusOnClose,
      `Display should land on its close button: ${JSON.stringify(display)}`)
    if (layout === 'portrait') {
      check(failures, display.position === 'static',
        `portrait Display must be an inline surface: ${JSON.stringify(display)}`)
      check(failures, display.transportBottom != null && display.top - display.transportBottom <= 24,
        `portrait Display must follow the transport, not the inline details/roster block: ${JSON.stringify(display)}`)
      check(failures, display.inlineAreaBottom == null || display.top <= display.inlineAreaBottom + 1,
        `portrait Display must not be pushed below the inline details/roster block: ${JSON.stringify(display)}`)
      check(failures, display.top < display.viewportHeight,
        `portrait Display must open inside the first screen: ${JSON.stringify(display)}`)
    } else {
      check(failures, display.position === 'absolute',
        `wide Display must be an anchored overlay: ${JSON.stringify(display)}`)
    }
  }
  await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
  await delay(200)
  const closed = await page.evaluate(`(() => ({
    gone: !document.querySelector('[data-testid="display-panel"]'),
    focusBackOnGear: document.activeElement === document.querySelector('[data-test="pb-secondary-entry"]'),
  }))()`)
  check(failures, closed.gone, 'Display close must remove the surface')
  // 关掉之后键盘不能掉在 body 上：焦点回到触发它的 gear
  if (anchorFocused) {
    check(failures, closed.focusBackOnGear,
      `closing Display must return focus to the gear: ${JSON.stringify(closed)}`)
  }
}

async function runWorkspace2DScenario(env, scenario) {
  const failures = []
  const viewport = `${scenario.fullscreen ? 'fullscreen ' : ''}${scenario.width}x${scenario.height}`
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  await page.goto(`${env.origin}/scripts/browser-fixtures/playback-controls.html?duration=60&players=7&recorder=${scenario.recorder || 1}`)
  await page.waitFor(() => !!document.querySelector('[data-test="pb-roster-row"]'), { label: '2D roster rows' })
  await delay(300)

  if (scenario.fullscreen) {
    await page.evaluate(`document.querySelector('[data-test="pb-fullscreen"]').scrollIntoView({ block: 'center' })`)
    await delay(200)
    const button = await page.evaluate(`(() => {
      const el = document.querySelector('[data-test="pb-fullscreen"]')
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await page.installInputTrace()
    await page.tap({ ...button, touch: scenario.touch })
    const input = await page.inputTrace()
    check(failures, input.click?.test === 'pb-fullscreen', `fullscreen real click missed button: ${JSON.stringify(input)}`)
    if (input.click?.test !== 'pb-fullscreen') {
      const boxes = await page.evaluate(`(() => {
        const selectors = ['.battle-playback', '.pb-main', '.pb-map-stage', '.pb-map', '.pb-transport-slot', '.pb-mobile-overlay', '.pb-mobile-overlay-content', '.pb-controls']
        return selectors.map((selector) => {
          const el = document.querySelector(selector)
          if (!el) return { selector, missing: true }
          const rect = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            position: style.position, display: style.display, gridColumn: style.gridColumn, gridRow: style.gridRow,
            columns: style.gridTemplateColumns, rows: style.gridTemplateRows, inlineSize: style.inlineSize, minWidth: style.minWidth }
        })
      })()`)
      throw new Error(`fullscreen button occluded: ${JSON.stringify({ input, boxes })}`)
    }
    await page.waitFor(() => !!document.fullscreenElement, { timeout: 5000, label: 'document.fullscreenElement' })
    await delay(400)
  }

  const g = await page.probe(workspace2dProbe)
  const result = () => results.push({ name: scenario.name, failures, viewport })
  check(failures, g.width === scenario.width && g.height === scenario.height,
    `viewport collapsed: requested ${scenario.width}x${scenario.height}, measured ${g.width}x${g.height}`)
  if (scenario.fullscreen) check(failures, g.fullscreen, 'fullscreen did not engage')
  check(failures, !g.pageOverflowX, 'page-level horizontal overflow')
  // 正方形 Stage：2D 地图元素带的是地图自己的逻辑画框（mapView W/H，如 766×769，底图 / SVG /
  // 标记共用这一个画框），与 1:1 的差 < 1%——拉成严格 1:1 反而会把地图拉伸变形。
  const squareish = (b) => b && b.w > 0 && Math.abs(b.w - b.h) <= Math.max(1.5, b.w * 0.01)
  check(failures, squareish(g.map), `Stage is not square: ${JSON.stringify(g.map)}`)
  check(failures, JSON.stringify(g.primaryOrder) === JSON.stringify(['pb-back5', 'pb-play', 'pb-fwd5', 'pb-speed-current', 'pb-fullscreen', 'pb-secondary-entry']),
    `primary controls DOM order: ${JSON.stringify(g.primaryOrder)}`)
  check(failures, g.primaryBoxes.every((box) => box)
    && g.primaryBoxes.every((box, index) => index === 0 || box.l >= g.primaryBoxes[index - 1].r - 1),
    'six primary controls must preserve their x-order')
  if (g.hud && g.map && g.transport) {
    for (const [name, gap] of [['HUD', g.map.t - g.hud.b], ['Transport', g.transport.t - g.map.b]]) {
      check(failures, gap >= -1 && gap <= 16, `${name} gap must remain compact (0–16px): ${gap.toFixed(1)} layout=${JSON.stringify(g.layout)}`)
    }
  }
  // 主控件行：-5 ▶ +5 1× ⛶ ⚙ 同一行（触屏 44px）
  if (scenario.touch) {
    const tops = g.primaryTops.filter((t) => t != null)
    check(failures, tops.length === 6 && Math.max(...tops) - Math.min(...tops) <= 1,
      `primary controls are not one row: ${JSON.stringify(g.primaryTops)}`)
    check(failures, g.primaryMinSide >= 43.5, `primary control below 44px: ${g.primaryMinSide}`)
  }

  const team1 = Array.from({ length: 7 }, (_, i) => 1001 + i)
  const team2 = Array.from({ length: 7 }, (_, i) => 2001 + i)
  if (scenario.layout === 'portrait') {
    check(failures, !g.left && !g.right, 'portrait must not render side lanes')
    check(failures, !!g.inline && !!g.transport && g.inline.t >= g.transport.b - 1, 'portrait roster must flow below the transport')
    check(failures, g.transport && g.map && g.transport.t >= g.map.b - 1, 'portrait transport must sit below the Stage')
    check(failures, JSON.stringify(g.inlineRosterIds) === JSON.stringify([...team1, ...team2]),
      `portrait roster order must be Team 1 then Team 2: ${JSON.stringify(g.inlineRosterIds)}`)
    check(failures, g.map && Math.abs(g.map.w - scenario.width) <= 2, 'portrait Stage must use the full column width')
    // 竖屏允许页面纵向延伸（纵向流），不是把名册塞进一个滚动盒
    const longPage = await page.evaluate('document.documentElement.scrollHeight > innerHeight')
    check(failures, longPage, 'portrait vertical flow should extend the page (no nested roster scroll box)')
    // 选中 → inline 详情排在传输控件之后、名册之前；× 只关详情
    await clickElement(page, '[data-test="pb-roster-row"][data-account-id="2002"]')
    await delay(200)
    const opened = await page.probe(workspace2dProbe)
    check(failures, opened.detailsPresentation === 'inline' && opened.inlineHasDetails,
      `portrait details must be the inline shared panel: ${opened.detailsPresentation}`)
    await clickElement(page, '[data-test="pb-sb-close"]')
    await delay(200)
    const closed = await page.probe(workspace2dProbe)
    check(failures, closed.detailsCount === 0, 'details × must close the panel')
    check(failures, JSON.stringify(closed.selectedIds) === '[2002]', `details × must keep the selection: ${JSON.stringify(closed.selectedIds)}`)
    await checkDisplaySurface(page, failures, scenario.layout)
    await env.chrome.client.send('Target.closeTarget', { targetId })
    return result()
  }

  // ---- 三段式 ----
  check(failures, g.rootClass.includes('pb-roster-lanes'), `expected Team 1 | Stage | Team 2 lanes (class=${g.rootClass})`)
  check(failures, !!g.left && !!g.right, 'both physical lanes must be visible without opening any menu')
  if (!g.left || !g.right || !g.map) {
    await env.chrome.client.send('Target.closeTarget', { targetId })
    return result()
  }
  check(failures, JSON.stringify(g.left.ids) === JSON.stringify(scenario.recorder === 2 ? team2 : team1), `left lane must be Recorder friendly: ${JSON.stringify(g.left.ids)}`)
  check(failures, JSON.stringify(g.right.ids) === JSON.stringify(scenario.recorder === 2 ? team1 : team2), `right lane must be Recorder enemy: ${JSON.stringify(g.right.ids)}`)
  check(failures, g.left.box.r <= g.map.l + 1 && g.right.box.l >= g.map.r - 1, 'lanes must flank the square Stage')
  check(failures, !g.left.scrolls && !g.right.scrolls, 'normal 7v7 lanes must not scroll')
  check(failures, g.left.rowsComplete && g.right.rowsComplete, 'roster rows must show player / tank / HP bar with in-bar text')
  check(failures, g.left.hpBar && g.right.hpBar, 'roster rows must render an HP bar')
  if (g.transport && g.transport.h > 0) {
    check(failures, g.transport.t >= g.map.b - 1, `transport must sit below the Stage (transport=${JSON.stringify(g.transport)} map=${JSON.stringify(g.map)})`)
  }
  if (scenario.recorder === 2) {
    // HUD 仍是录像者视角：friendly 总血量 = Team 2 的当前总血量
    check(failures, /\d/.test(g.friendlyHp || ''), 'friendly HUD value missing')
  }

  // ---- 选择 Team 1 → 浮窗；名册两条都在 ----
  const time0 = g.time
  const leftPlayer = scenario.recorder === 2 ? 2002 : 1002
  const rightPlayer = scenario.recorder === 2 ? 1003 : 2003
  const rightName = scenario.recorder === 2 ? 'T1_Player_3' : 'T2_Player_3'
  const team1Click = await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${leftPlayer}"]`)
  check(failures, clicked(team1Click), `Team 1 row not clickable: ${team1Click}`)
  await delay(250)
  let s = await page.probe(workspace2dProbe)
  check(failures, s.detailsCount === 1 && s.detailsPresentation === 'floating', 'selecting must open one floating details panel')
  check(failures, s.detailsParentIsMain, 'floating details must be a child of the battlefield workspace (.pb-main)')
  check(failures, !!s.left && !!s.right, 'details must not hide either lane')
  check(failures, s.details && s.details.l >= s.map.l - 1, 'clicking a left-lane row should place details away from the left lane')

  // ---- 拖到 Team 1 / Stage / Team 2 三个区域 ----
  // 右 → 中 → 左：最后停在 Team 1 之上，Team 2 车道保持可点（用户的真实流程：开着详情连点 Team 2）。
  const regions = [['right', (s.right.box.l + s.right.box.r) / 2], ['center', (s.map.l + s.map.r) / 2], ['left', (s.left.box.l + s.left.box.r) / 2]]
  let lastPos = null
  for (const [label, x] of regions) {
    await dragDetailsTo(page, x, scenario.touch)
    const d = await page.probe(workspace2dProbe)
    const panel = d.details
    const centre = panel ? (panel.l + panel.r) / 2 : NaN
    const target = label === 'left' ? d.left.box : label === 'right' ? d.right.box : d.map
    check(failures, panel && centre >= target.l - panel.w / 2 && centre <= target.r + panel.w / 2,
      `details could not be dragged over the ${label} region (panel=${JSON.stringify(panel)})`)
    check(failures, panel && panel.l >= d.main.l - 0.5 && panel.r <= d.main.r + 0.5 && panel.t >= d.main.t - 0.5,
      `details left the battlefield workspace after dragging ${label}`)
    if (d.transport && d.transport.h > 0) {
      check(failures, panel && panel.b <= d.transport.t + 0.5, `details covers the transport after dragging ${label}`)
    }
    lastPos = panel
  }

  // ---- 点 Team 2 → 同一个窗更新、位置不动、Team 2 车道仍在 ----
  const team2Click = await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${rightPlayer}"]`)
  check(failures, clicked(team2Click), `Team 2 row not clickable: ${team2Click}`)
  await delay(250)
  s = await page.probe(workspace2dProbe)
  check(failures, s.detailsCount === 1 && s.detailsPlayer === rightName, `details did not update to the Team 2 vehicle: ${s.detailsPlayer}`)
  check(failures, !!s.right, 'Team 2 lane disappeared after selecting a Team 2 vehicle')
  check(failures, lastPos && s.details && Math.abs(s.details.l - lastPos.l) < 1 && Math.abs(s.details.t - lastPos.t) < 1,
    'user-dragged details position must survive selection changes')

  // ---- × 只关详情 ----
  await clickElement(page, '[data-test="pb-sb-close"]')
  await delay(200)
  s = await page.probe(workspace2dProbe)
  check(failures, s.detailsCount === 0, 'details × must close the panel')
  check(failures, JSON.stringify(s.selectedIds) === JSON.stringify([rightPlayer]), `details × must keep the selection: ${JSON.stringify(s.selectedIds)}`)
  check(failures, s.time === time0, `closing details changed playback time ${time0} -> ${s.time}`)
  await clickElement(page, `[data-test="pb-roster-row"][data-account-id="${rightPlayer}"]`)
  await delay(200)
  s = await page.probe(workspace2dProbe)
  check(failures, s.detailsCount === 1, 'clicking the selected vehicle again must reopen details')

  // ---- 名册关闭：车道消失，Stage 仍是居中正方形，详情与选中保留 ----
  if (!scenario.fullscreen) {
    check(failures, (await setRosterVisible(page, false)) === 'ok', 'roster preference toggle missing')
    await delay(300)
    s = await page.probe(workspace2dProbe)
    check(failures, !s.left && !s.right, 'roster OFF must remove both lanes')
    check(failures, squareish(s.map), `roster OFF Stage must stay square: ${JSON.stringify(s.map)} main=${JSON.stringify(s.main)}`)
    check(failures, s.map && s.main && Math.abs((s.map.l + s.map.r) / 2 - (s.main.l + s.main.r) / 2) <= 2, 'roster OFF Stage must stay centred')
    check(failures, s.detailsCount === 1, 'roster OFF must keep Details open')
    await setRosterVisible(page, true)
    await delay(300)
    s = await page.probe(workspace2dProbe)
    check(failures, !!s.left && !!s.right && JSON.stringify(s.selectedIds) === JSON.stringify([rightPlayer]), 'roster ON must restore lanes with the existing selection')
  }

  // ---- Display 面开合：始终可从 gear 到达，且不把用户丢到首屏之外 ----
  await checkDisplaySurface(page, failures, scenario.layout)

  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)
  await env.chrome.client.send('Target.closeTarget', { targetId })
  result()
}

/* ------------------------------------------------------------------ main */

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
    { scenario: { name: 'offline-local-workspace-matrix', width: 1600, height: 900 }, run: () => runOfflineWorkspaceScenario(env) },
    ...APP_SCENARIOS.map((scenario) => ({ scenario, run: () => runAppScenario(env, scenario) })),
    ...AUTH_CAPABILITY_SCENARIOS.map((scenario) => ({ scenario, run: () => runAuthCapabilityScenario(env, scenario) })),
    { scenario: { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }, run: () => runRosterGeometryScenario(env, { ...ROSTER_GEOMETRY_SCENARIOS[0], name: 'roster-geometry-recorder-team2-desktop', recorder: 2 }) },
    ...ROSTER_GEOMETRY_SCENARIOS.map((scenario) => ({ scenario, run: () => runRosterGeometryScenario(env, scenario) })),
    ...LIFECYCLE_SCENARIOS.map((scenario) => ({ scenario, run: () => runParseLifecycleScenario(env, scenario) })),
    ...PLAYBACK_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackControlScenario(env, scenario) })),
    { scenario: ROTATION_SCENARIO, run: () => runRotationScenario(env, ROTATION_SCENARIO) },
    ...MOBILE_FULLSCREEN_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileFullscreenScenario(env, scenario) })),
    ...WORKSPACE_2D_SCENARIOS.map((scenario) => ({ scenario, run: () => runWorkspace2DScenario(env, scenario) })),
  ]
  // 可选场景名过滤（调试单个形态时不必跑满矩阵）。
  const nameFilter = process.argv.slice(2).find((arg) => !arg.startsWith('-'))
  const selected = nameFilter ? runs.filter(({ scenario }) => scenario.name.includes(nameFilter)) : runs
  if (nameFilter && selected.length === 0) throw new Error(`no scenario matches "${nameFilter}"`)
  for (const { scenario, run } of selected) {
    // 单个场景抛错（例如等不到元素）不得吞掉整轮结果：记为该场景的失败后继续。
    try {
      await run()
    } catch (error) {
      results.push({
        name: scenario.name,
        failures: [error.message, ...(lastPage ? await lastPage.diagnose().catch(() => []) : [])],
        viewport: `${scenario.width}x${scenario.height}`,
      })
    }
  }

  const tabletRoster = results.find((result) => result.name === 'roster-geometry-1024x768-tablet')?.geometry
  const desktopRoster = results.find((result) => result.name === 'roster-geometry-1600x900-desktop')?.geometry
  const fullscreenRoster = results.find((result) => result.name === 'roster-geometry-1792x922-fullscreen-desktop')?.geometry
  if (tabletRoster && desktopRoster && fullscreenRoster) {
    const failures = []
    // As the workspace grows, roster lanes absorb width beyond the maximum square.
    // 这里锁的是比例：lane 变大、center 变大且始终约 3× lane。
    check(failures, tabletRoster.laneWidths[0] + 1 < desktopRoster.laneWidths[0], 'roster lanes must grow between tablet and desktop')
    check(failures, fullscreenRoster.laneWidths[0] > desktopRoster.laneWidths[0] + 1, 'roster lanes must absorb spare viewport width')
    for (const [name, g] of [['tablet', tabletRoster], ['desktop', desktopRoster], ['fullscreen', fullscreenRoster]]) {
      const lane = g.laneWidths[0]
      // HUD 属于 center 列，用它的宽度当 center 宽度的实测值
      const center = g.centerWidth ?? null
      if (!lane || !center) { check(failures, false, `${name} roster matrix: missing lane/center`); continue }
      if (name !== 'tablet') check(failures, Math.abs(center - g.square.w) <= 2,
        `${name} roster matrix: center must match square (center=${center} square=${g.square.w})`)
    }
    results.push({ name: 'roster-fluid-width-matrix', failures, viewport: '1024 → 1600 → 1792' })
  }
  let failed = 0
  for (const result of results) {
    if (result.failures.length === 0) {
      console.log(`[browser-interaction] ${result.name} OK (${result.viewport})`)
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
  await server.close()
}
