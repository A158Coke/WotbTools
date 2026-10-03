import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'

/**
 * Browser-level interaction regression for the Replay Workspace capability tabs and the
 * Battle Playback transport controls.
 *
 * 为什么必须是真浏览器：本次回归的两类症状（「点了没反应」、透明层吃掉 pointer）在 jsdom 里
 * 结构上不可见 —— jsdom 没有真实布局/层叠/hit-testing，`elementFromPoint` 恒为 null。
 * 因此这里启动真实 Chrome（独立 user-data-dir）、按设备指标仿真 mobile/tablet/desktop，
 * 用真实输入管线（Input.synthesizeTapGesture）点击真实坐标，并断言
 * `document.elementFromPoint(按钮中心)` 确实命中按钮本身。
 *
 * 与 `browser-playback-layout.mjs` 的分工：
 *   - 那个是 file:// + 生产 CSS 的**几何**夹具（布局/尺寸契约）；
 *   - 本文件是 Vite dev server + **真实生产应用**（router/AppShell/ReplayWorkspace/全部 CSS）
 *     的**交互**夹具，只把 Keycloak 网络边界替换掉（见 browser-fixtures/*-stub.js）。
 */
const here = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(here, '..')

/**
 * 只替换 Keycloak 网络边界。用 resolveId 插件而不是 `resolve.alias` 正则：
 * rollup alias 的 RegExp 分支只替换「匹配到的那一段」，先把已解析的真实文件定位出来
 * 再整体换掉，才不会拼出假路径。
 */
const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.js'), resolve(here, 'browser-fixtures/use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.js'), resolve(here, 'browser-fixtures/use-business-user-bootstrap-stub.js')],
])

/** Vite 的 module id 在 Windows 上是正斜杠、可能带盘符前导斜杠，且大小写不敏感；比较前统一规整。 */
function normalizeId(id) {
  const forward = id.replace(/\\/g, '/').replace(/^\/+/, '')
  return process.platform === 'win32' ? forward.toLowerCase() : forward
}

function authBoundaryStubPlugin() {
  const normalizedStubs = new Map([...AUTH_BOUNDARY_STUBS].map(([from, to]) => [normalizeId(from), to]))
  return {
    name: 'wotb-browser-fixture-auth-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // 只接管「应用内部的相对 import」，不碰裸模块名（vue / vue-router / keycloak-js 等）。
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
    configFile: false,
    root: frontendRoot,
    logLevel: 'error',
    plugins: [authBoundaryStubPlugin(), vue()],
    // vite.config.js 的 define 只在读取项目配置时注入；本实例不读 configFile，需显式提供。
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
    /** rail 模式下速度档位必须一行排开且不撑出 rail（档位个数变化时的回归点） */
    railSpeeds: (() => {
      const group = document.querySelector('.pb-controls-rail-mode .pb-speed')
      if (!group) return null
      const container = group.closest('.pb-left-rail') || group.parentElement
      const limit = container.getBoundingClientRect()
      const buttons = [...group.querySelectorAll('[data-test^="pb-speed-"]')].map((b) => b.getBoundingClientRect())
      return {
        count: buttons.length,
        rows: new Set(buttons.map((r) => Math.round(r.top))).size,
        overflow: buttons.some((r) => r.left < limit.left - 1 || r.right > limit.right + 1),
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
      window.__wsInput = { primary: null, click: null, clickCount: 0 }
      const recordPrimary = (event) => { window.__wsInput.primary = describe(event.target) }
      document.addEventListener('touchstart', recordPrimary, true)
      document.addEventListener('mousedown', recordPrimary, true)
      document.addEventListener('click', (event) => {
        window.__wsInput.click = describe(event.target)
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
    return this.evaluate('window.__wsInput = { primary: null, click: null, clickCount: 0 }; window.__wsInput')
  }
}

const results = []

/** 最近一次创建的场景页面：场景抛错时用它打印现场（诊断用，不参与断言）。 */
let lastPage = null

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
  // 服务器没有 parser，工作台没有 auth gating：未登录、auth init 挂起 / 失败时都立即可用，且不发起登录。
  // pending 的 watchdog 设得远长于场景本身——工作台必须在 auth init 仍挂起时就渲染（不能等超时兜底）。
  { name: 'anonymous-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'reject' },
  { name: 'auth-init-pending-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'pending', authTimeout: 120_000 },
  { name: 'auth-init-reject-390x844-coarse', width: 390, height: 844, touch: true, authenticated: false, login: 'resolve', authInit: 'reject', authTimeout: 120_000 },
  // 管理员（内测 feature flag）：五能力齐全，3D 能力真实可切（不再导航去独立页面）
  { name: 'admin-1600x900-desktop', width: 1600, height: 900, touch: false, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
  { name: 'admin-390x844-portrait-coarse', width: 390, height: 844, touch: true, authenticated: true, login: 'resolve', roles: ['wotbtools-admin'] },
]

/**
 * 3D 阵容车道的**真实几何**回归（review blocker：源码级 CSS 断言证明不了最终渲染）。
 * 每个场景走真实用户路径：选文件 → 真实点击切 3D 能力 → 真实点击「开始」（走过待开播
 * 闸门）→ 经 ?debug 注入口喂入就绪态（两队名单非空 / unknown 非空 / killfeed）→ 用
 * getBoundingClientRect 断言：三块名单两两不重叠、不覆盖 HUD 子面板、不覆盖底部控制条、
 * 全部位于 pb-root 内。mobile 还要求默认收起 + 真实点击 roster-toggle 展开。
 * 小高度横屏场景故意用更小的夹具（1 条击杀 / 2 名玩家）——屏幕放不下全部内容时车道按
 * max-height 收缩（内容截断 / 内部滚动），但**不得与 HUD / controls 交叉**。
 */
const ROSTER_GEOMETRY_SCENARIOS = [
  { name: 'roster-geometry-1600x900-desktop', width: 1600, height: 900, touch: false, players: 7, killfeed: 3 },
  { name: 'roster-geometry-1024x768-tablet', width: 1024, height: 768, touch: false, players: 7, killfeed: 3 },
  { name: 'roster-geometry-390x844-portrait-coarse', width: 390, height: 844, touch: true, players: 5, killfeed: 3, mobile: true },
  { name: 'roster-geometry-740x360-landscape-coarse', width: 740, height: 360, touch: true, players: 2, killfeed: 1, mobile: true },
]

const PLAYBACK_SCENARIOS = [
  { name: 'play-390x844-coarse', width: 390, height: 844, touch: true, duration: 60, form: 'pb-form-mobile' },
  // §form-factor：手机横屏内宽 >768 仍必须是 mobile 形态，不能落进 tablet/pc。
  { name: 'play-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60, form: 'pb-form-mobile' },
  { name: 'play-1024x768-tablet', width: 1024, height: 768, touch: false, duration: 60, form: 'pb-form-tablet' },
  // 审计 PB-07：iPad 横屏是触屏但有平板的可用空间，必须拿 tablet 形态（触屏只放大点击区域）
  { name: 'play-1024x768-ipad-coarse', width: 1024, height: 768, touch: true, duration: 60, form: 'pb-form-tablet' },
  { name: 'play-1440x900-desktop', width: 1440, height: 900, touch: false, duration: 60, form: 'pb-form-pc' },
  // 触屏 + rail：视口 >1200 的大平板（iPad Pro / Android 平板横屏）走 pc 形态，控件进 rail；
  // 速度档位必须一行排开且每个都满足 44px 点击区域（rail 在触屏上自动加宽）
  { name: 'play-1366x1024-tablet-coarse-rail', width: 1366, height: 1024, touch: true, duration: 60, form: 'pb-form-pc' },
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
    if (b.left < rr.left - 0.5 || b.right > rr.right + 0.5 || b.top < rr.top - 0.5 || b.bottom > rr.bottom + 0.5) {
      out.errors.push(`${name} is outside pb-root (root=${JSON.stringify({ l: +rr.left.toFixed(1), t: +rr.top.toFixed(1), r: +rr.right.toFixed(1), b: +rr.bottom.toFixed(1) })})`)
    }
  }
  const hudBoxes = [...document.querySelectorAll('.hud > *')].map(rect).filter(Boolean)
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
  return out
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
  await page.goto(`${env.origin}/?view=replay&ws-auth=1&ws-login=resolve&ws-roles=wotbtools-admin&debug`)
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
    const mk = (prefix, n) => Array.from({ length: n }, (_, i) => ({
      eid: i + 1, nick: prefix + '_' + String(i + 1).padStart(2, '0'), tank: 'Tank ' + (i + 1),
      frac: Math.min(100, 40 + i * 7), dead: i === 0, followed: false, dot: '#26794a',
    }))
    s.hasData = true
    s.loading = false
    s.assetStage = false
    s.err = ''
    s.timer = '05:12'
    s.duration = 300
    s.time = 42
    s.startTime = 0
    s.roster = {
      team1: mk('Ally', ${scenario.players}),
      team2: mk('Enemy', ${scenario.players}),
      unknown: mk('Neutral', 2),
    }
    s.killfeed = Array.from({ length: ${scenario.killfeed} }, (_, i) => ({
      id: i + 1, killer: 'Killer_' + i, victim: 'Victim_' + i, kill: true,
    }))
  })()`)
  // ResizeObserver 异步把 hud / controls 的实测高度写进 CSS 变量（车道定界依赖它）
  await delay(500)

  if (scenario.mobile) {
    // 紧凑档默认收起（审计 3D-15），真实点击 roster-toggle 展开
    const collapsed = await page.evaluate(`(() => {
      const lanes = [...document.querySelectorAll('.team-lane')]
      return lanes.length === 2 && lanes.every((l) => getComputedStyle(l).display === 'none')
    })()`)
    check(failures, collapsed, 'mobile roster lanes must be collapsed by default')
    const toggleCenter = await page.evaluate(`(() => {
      const button = document.querySelector('[data-testid="roster-toggle"]')
      if (!button) return null
      button.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = button.getBoundingClientRect()
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
      return (hit === button || button.contains(hit))
        ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        : null
    })()`)
    check(failures, !!toggleCenter, 'roster toggle not hit-testable after ready-state injection')
    if (!toggleCenter) {
      await env.chrome.client.send('Target.closeTarget', { targetId })
      results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
      return
    }
    await page.tap({ ...toggleCenter, touch: scenario.touch })
    await page.waitFor(() => {
      const lane = document.querySelector('.team-lane')
      return !!lane && getComputedStyle(lane).display !== 'none'
    }, { label: 'roster lanes visible after toggle' })
  }

  const geometry = await page.probe(rosterGeometryProbe)
  check(failures, geometry.root, 'pb-root missing')
  check(failures, geometry.errors.length === 0, `geometry violations: ${geometry.errors.join('; ')}`)
  check(failures, page.consoleErrors.length === 0, `JS errors: ${page.consoleErrors.join(' | ')}`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `${scenario.width}x${scenario.height}` })
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

  // —— 能力集合（PR-B：五能力同一工作台）——
  // 普通用户 = data / playback / ai（AI 是正式能力，不是 admin-only）；
  // 管理员额外有 3D 回放 / 射击分析。两条集合都必须完整渲染，不因能力不可用而消失。
  const expectedCaps = scenario.roles?.includes('wotbtools-admin')
    ? ['data', 'playback', '3d', 'shots', 'ai']
    : ['data', 'playback', 'ai']
  check(failures, JSON.stringify(state.tabs.map((t) => t.cap)) === JSON.stringify(expectedCaps),
    `capability set=${JSON.stringify(state.tabs.map((t) => t.cap))}, expected ${JSON.stringify(expectedCaps)}`)
  if (scenario.touch) {
    const small = state.tabs.filter((t) => t.minSide < 43.5)
    check(failures, small.length === 0,
      `coarse capability targets below 44px: ${JSON.stringify(small)}`)
  }

  // —— 3D 能力（管理员）：切过去真的落在同一工作台，URL 与面板一起变 ——
  if (expectedCaps.includes('3d')) {
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
    }
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
  if (before.railSpeeds) {
    check(failures, before.railSpeeds.rows === 1,
      `rail speed options wrapped onto ${before.railSpeeds.rows} rows (${before.railSpeeds.count} options)`)
    check(failures, !before.railSpeeds.overflow, 'rail speed options overflow the rail')
  }
  if (scenario.touch && before.speedMinSide != null) {
    check(failures, before.speedMinSide >= 43.5,
      `touch speed option hit target is ${before.speedMinSide.toFixed(1)}px, below 44px`)
  }
  if (scenario.name.endsWith('-rail')) {
    check(failures, !!before.railSpeeds, 'expected the playback controls to be in the rail')
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
 * §mobile-fullscreen：手机横屏全屏是「148px navigation rail | map」，播放控件仍在底部 overlay。
 * 触屏 rail 的 248px 下限只属于「控件真的在 rail 里」的大平板，不得通过 inline --pb-rail-w
 * 盖掉 mobile fullscreen 的 148px（inline style 优先级高于 CSS 规则）；用户在桌面拖过、持久化在
 * localStorage 的 rail 宽度同样不得盖掉它。
 */
const MOBILE_FULLSCREEN_SCENARIOS = [
  { name: 'fullscreen-740x360-landscape-coarse', width: 740, height: 360, touch: true, duration: 60 },
  {
    name: 'fullscreen-740x360-landscape-coarse-persisted-rail',
    width: 740, height: 360, touch: true, duration: 60,
    paneWidths: { rail: 320, details: null },
  },
]

async function runMobileFullscreenScenario(env, scenario) {
  const failures = []
  const { targetId, sessionId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  lastPage = page
  await page.enable()
  await page.emulate(scenario)
  if (scenario.paneWidths) {
    // mount 前写入持久化偏好（模拟此前在桌面拖过 rail）
    await env.chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('wotb.pb.pane-widths', ${JSON.stringify(JSON.stringify(scenario.paneWidths))}) } catch {}`,
    }, sessionId)
  }

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
    const rail = root.querySelector('.pb-left-rail')
    return {
      fullscreenIsRoot: document.fullscreenElement === root,
      formClass: Array.from(root.classList).find((n) => n.startsWith('pb-form-')) || null,
      persisted: localStorage.getItem('wotb.pb.pane-widths'),
      railVar: getComputedStyle(root).getPropertyValue('--pb-rail-w').trim(),
      inlineRailVar: root.style.getPropertyValue('--pb-rail-w').trim(),
      railWidth: rail ? rail.getBoundingClientRect().width : null,
      controlsInRail: !!document.querySelector('.pb-controls-rail-mode'),
    }
  })()`)
  check(failures, state.fullscreenIsRoot, 'fullscreen element is not the playback root')
  check(failures, state.formClass === 'pb-form-mobile', `fullscreen form=${state.formClass}, expected pb-form-mobile`)
  check(failures, !state.controlsInRail, 'mobile fullscreen must keep the playback controls out of the rail')
  if (scenario.paneWidths) {
    check(failures, state.persisted === JSON.stringify(scenario.paneWidths),
      `persisted pane widths were not in place: ${state.persisted}`)
  }
  check(failures, state.inlineRailVar === '', `mobile fullscreen wrote inline --pb-rail-w=${state.inlineRailVar}`)
  check(failures, state.railVar === '148px',
    `mobile fullscreen --pb-rail-w=${state.railVar} (inline=${state.inlineRailVar || 'none'}), expected 148px`)
  check(failures, state.railWidth != null && Math.abs(state.railWidth - 148) <= 1,
    `mobile fullscreen rail rendered ${state.railWidth}px wide, expected 148px`)

  await env.chrome.client.send('Target.closeTarget', { targetId })
  results.push({ name: scenario.name, failures, viewport: `fullscreen ${scenario.width}x${scenario.height}` })
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
    ...APP_SCENARIOS.map((scenario) => ({ scenario, run: () => runAppScenario(env, scenario) })),
    ...ROSTER_GEOMETRY_SCENARIOS.map((scenario) => ({ scenario, run: () => runRosterGeometryScenario(env, scenario) })),
    ...PLAYBACK_SCENARIOS.map((scenario) => ({ scenario, run: () => runPlaybackControlScenario(env, scenario) })),
    { scenario: ROTATION_SCENARIO, run: () => runRotationScenario(env, ROTATION_SCENARIO) },
    ...MOBILE_FULLSCREEN_SCENARIOS.map((scenario) => ({ scenario, run: () => runMobileFullscreenScenario(env, scenario) })),
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
