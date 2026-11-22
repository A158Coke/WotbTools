import { callPageFunction } from './browser-page.mjs'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'


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
export const here = dirname(fileURLToPath(import.meta.url))
export const frontendRoot = resolve(here, '..')

/**
 * 替换外部运行时边界。用 resolveId 插件而不是 `resolve.alias` 正则：
 * rollup alias 的 RegExp 分支只替换「匹配到的那一段」，先把已解析的真实文件定位出来
 * 再整体换掉，才不会拼出假路径。
 */
export const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.ts'), resolve(here, 'browser-fixtures/use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.ts'), resolve(here, 'browser-fixtures/use-business-user-bootstrap-stub.js')],
  [resolve(frontendRoot, 'src/scene/playbackParse.worker.ts'), resolve(here, 'browser-fixtures/playback-parse-worker-stub.mjs')],
  [resolve(frontendRoot, 'src/api/agent-replay-facets.ts'), resolve(here, 'browser-fixtures/shot-handoff-stub.js')],
  [resolve(frontendRoot, 'src/scene/tankViewer.js'), resolve(here, 'browser-fixtures/armor-handoff-stub.js')],
])

/** 假文件场景专用：批次分析也换成替身，见 browser-fixtures/local-analysis-stub.js。 */
export const LOCAL_ANALYSIS_STUBS = new Map([
  [resolve(frontendRoot, 'src/replay-local/parseReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
  [resolve(frontendRoot, 'src/replay-local/analyzeReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
])

// 这些映射按解析后的绝对路径匹配：源文件改名后替身会静默失效，门禁就会走真实实现。
for (const from of [...AUTH_BOUNDARY_STUBS.keys(), ...LOCAL_ANALYSIS_STUBS.keys()]) {
  if (!existsSync(from)) throw new Error(`Browser fixture stub source does not exist: ${from}`)
}

/** Vite 的 module id 在 Windows 上是正斜杠、可能带盘符前导斜杠，且大小写不敏感；比较前统一规整。 */
export function normalizeId(id) {
  const forward = id.replace(/\\/g, '/').replace(/^\/+/, '')
  return process.platform === 'win32' ? forward.toLowerCase() : forward
}

export function authBoundaryStubPlugin({ realReplay = false, fakeAnalysis = false } = {}) {
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

export const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

export async function startFixtureServer({ realReplay = false, fakeAnalysis = false } = {}) {
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

export let fakeAnalysisServer = null
/** 假文件场景的独立应用夹具；真实解析场景继续用主夹具。 */
export async function fakeAnalysisOrigin() {
  if (!fakeAnalysisServer) fakeAnalysisServer = await startFixtureServer({ fakeAnalysis: true })
  return fakeAnalysisServer.origin
}

/* ------------------------------------------------------------------ 页面内探针
   写成真实函数再序列化执行，避免模板字符串里的转义错误。 */

export function playbackControlProbe() {
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

export class Page {
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

export const results = []

/** 最近一次创建的场景页面：场景抛错时用它打印现场（诊断用，不参与断言）。 */
export let lastPage = null
export function setLastPage(page) { lastPage = page }
export function getLastPage() { return lastPage }

/**
 * 原子「命中测试 + 点击」：几何与 `el.click()` 在同一次 Runtime.evaluate 里完成，
 * 中间不给事件循环任何机会。分两步（先量坐标、再由 CDP 点击）在 1024x768 上必翻车：
 * fixture 注入后 HUD 高度还在收敛，量到的 y 在点击时已经落到另一个复选框上。
 * 命中测试仍然证明"目标没有被遮住"（真点击语义），只是把 measure→click 压成一步。
 *
 * 若目标在可滚动容器（.display-panel）内，先在容器内把它滚进可视区；若目标整体在视口外
 * （矮窗口里 .pb-root 会被推到视口外），先把页面滚到它可见——真机上用户也是这么点的。
 */
export function clickElement(page, selector) {
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

export const clicked = (result) => typeof result === 'string' && result.startsWith('clicked')
export function check(failures, ok, message) {
  if (!ok) failures.push(message)
}

/** 场景根的有效触控下限：紧凑档 40px，常规触屏 44px；普通内容页不读场景 token。 */
export async function sceneHitTarget(page) {
  const value = await page.evaluate(`(() => {
    const scene = document.querySelector('[data-scene-surface]')
    if (!scene) return 44
    const token = parseFloat(getComputedStyle(scene).getPropertyValue('--hit-min-comfortable'))
    return Number.isFinite(token) && token > 0 ? token : 44
  })()`)
  return value
}

/* ------------------------------------------------------------------ 场景 */

export const PARSE_LIFECYCLE_BRIDGE = `(() => {
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

/** 打开回放列表并返回第一行移除按钮的命中中心（含按钮盒，供事后证明真实 click 的落点）。 */
export async function openCollectionRemove(page, scenario) {
  const trigger = await page.waitForValue(clickCenterExpression('[data-testid="collection-trigger"]'), Boolean, { label: 'collection trigger' })
  await page.tap({ ...trigger, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('[data-testid="collection-remove"]'), { label: 'collection remove button' })
  return page.waitForValue(`(() => {
    const button = document.querySelector('[data-testid="collection-remove"]')
    if (!button) return null
    const r = button.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    return (hit === button || button.contains(hit))
      ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      : null
  })()`, Boolean, { label: 'collection remove hit-testable' }).catch(() => null)
}

export async function confirmCollectionRemove(page, scenario) {
  const confirm = await page.waitForValue(clickCenterExpression('[data-testid="remove-confirm-ok"]'), Boolean, { label: 'remove confirmation' })
  await page.tap({ ...confirm, touch: scenario.touch })
}

/** 可点击中心点（hit-test 通过才返回；与其它场景同一口径） */
export function clickCenterExpression(selector) {
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

/** 进入统一回放面板的 3D 模式（2026-11-19：3D 不再是独立能力标签）。 */
export async function enterReplay3d(page, scenario) {
  const tab = await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="replay"]'), Boolean, { label: 'replay capability tab' })
  await page.tap({ ...tab, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('[data-testid="viewer-mode-3d"]'), { label: '3D mode switch' })
  // 模式开关在面板自动居中/布局收敛期间会移位：measure→tap 两步会落到旧坐标
  // （740x360 landscape 实测点击丢失，URL 停在 battle-playback）。与 roster-geometry
  // 同款：同一次 evaluate 内滚动 + 命中测试 + click，仍保留「目标未被遮挡」的真浏览器语义。
  const tapped = await tapElement(page, '[data-testid="viewer-mode-3d"]', {
    touch: scenario.touch,
    verify: () => page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === 'agent-replay',
      { timeout: 5000, label: '3D mode route' }),
  })
  if (!tapped) throw new Error('3D mode switch not hit-testable or tap did not change the route')
  await page.waitFor(() => new URLSearchParams(location.search).get('view') === 'agent-replay', { label: '3D mode route' })
}
/**
 * 真实指针拖动，把详情的拖动柄从 from 拖到 to。触屏场景走原始 touch 事件（设备仿真开着触屏时
 * 注入的鼠标事件不会合成 pointer 拖动），桌面走鼠标事件——两者都由浏览器合成 pointer 事件。
 */
export async function dragPointer(page, from, to, { touch = false } = {}) {
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
export async function closeFakeAnalysisServer() {
  if (fakeAnalysisServer) await fakeAnalysisServer.server.close()
}

export async function captureMobileReview(page, scenario, state = 'battlefield') {
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

/**
 * 真实 CDP 点击（非脚本 el.click）：同一 evaluate 内滚动 + 命中测试（只接受目标自身或子树，
 * 祖先命中不算），随后用 CDP touch/mouse 点一次；目标状态未达成的场景在稳定布局后重试。
 * measure 与 tap 之间布局仍可能收敛，verify 让「点击确实生效」成为重试条件。
 */
export async function tapElement(page, selector, { touch = false, attempts = 4, verify = null } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const point = await page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return null
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null
      const hit = document.elementFromPoint(x, y)
      return (hit === el || el.contains(hit)) ? { x, y } : null
    })()`)
    if (point) {
      await page.tap({ ...point, touch })
      if (!verify) return true
      try { if (await verify()) return true } catch (_) { /* 布局又动了：下一轮重新测量 */ }
    }
    await delay(150)
  }
  return false
}

/**
 * 关闭场景 target。响应可能永远不来（渲染器崩溃、target 已消失、浏览器主线程卡住）：
 * 有界等待并在超时后继续矩阵，避免单个 close 把整个分片拖到 job 超时；浏览器在 finally 统一关闭。
 */
export async function closePageTarget(chrome, targetId, { timeout = 8000 } = {}) {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${timeout}ms`)), timeout)
  })
  try {
    await Promise.race([chrome.client.send('Target.closeTarget', { targetId }), timeoutPromise])
  } catch (error) {
    console.error(`[browser-interaction] closeTarget ${targetId} not acknowledged: ${error.message}`)
  } finally {
    clearTimeout(timer)
  }
}
