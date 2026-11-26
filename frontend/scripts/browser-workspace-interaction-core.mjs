import { callPageFunction } from './browser-page.mjs'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'


export const here = dirname(fileURLToPath(import.meta.url))
export const frontendRoot = resolve(here, '..')

export const AUTH_BOUNDARY_STUBS = new Map([
  [resolve(frontendRoot, 'src/composables/useAuth.ts'), resolve(here, 'browser-fixtures/use-auth-stub.js')],
  [resolve(frontendRoot, 'src/composables/useBusinessUserBootstrap.ts'), resolve(here, 'browser-fixtures/use-business-user-bootstrap-stub.js')],
  [resolve(frontendRoot, 'src/scene/playbackParse.worker.ts'), resolve(here, 'browser-fixtures/playback-parse-worker-stub.mjs')],
  [resolve(frontendRoot, 'src/api/agent-replay-facets.ts'), resolve(here, 'browser-fixtures/shot-handoff-stub.js')],
  [resolve(frontendRoot, 'src/scene/tankViewer.js'), resolve(here, 'browser-fixtures/armor-handoff-stub.js')],
])

export const LOCAL_ANALYSIS_STUBS = new Map([
  [resolve(frontendRoot, 'src/replay-local/parseReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
  [resolve(frontendRoot, 'src/replay-local/analyzeReplays.ts'), resolve(here, 'browser-fixtures/local-analysis-stub.js')],
])

for (const from of [...AUTH_BOUNDARY_STUBS.keys(), ...LOCAL_ANALYSIS_STUBS.keys()]) {
  if (!existsSync(from)) throw new Error(`Browser fixture stub source does not exist: ${from}`)
}

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
    cacheDir: resolve(frontendRoot, 'node_modules/.vite-browser-interaction'),
    logLevel: 'error',
    plugins: [authBoundaryStubPlugin({ realReplay, fakeAnalysis })],
    define: { __BUILD_COMMIT__: '"browser-fixture"', __BUILD_TIME__: '"browser-fixture"' },
    publicDir: resolve(frontendRoot, '../common/assets'),
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const url = server.resolvedUrls?.local?.[0]
  if (!url) throw new Error('fixture Vite server did not publish a local URL')
  return { server, origin: url.replace(/\/$/, '') }
}

export let fakeAnalysisServer = null
export async function fakeAnalysisOrigin() {
  if (!fakeAnalysisServer) fakeAnalysisServer = await startFixtureServer({ fakeAnalysis: true })
  return fakeAnalysisServer.origin
}


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
  const hitBoxAt = (button) => {
    const r = button.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const dx = minHit / 2 - 0.25, dy = minHit / 2 - 0.25
    const reaches = (x, y) => {
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
    contentWidth: document.documentElement.clientWidth,
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

  callWith(fn, ...args) {
    return callPageFunction(this.client, this.sessionId, fn, ...args)
  }

  probe(fn) {
    return this.evaluate(`(${fn.toString()})()`)
  }

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

export let lastPage = null
export function setLastPage(page) { lastPage = page }
export function getLastPage() { return lastPage }

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

export async function sceneHitTarget(page) {
  const value = await page.evaluate(`(() => {
    const scene = document.querySelector('[data-scene-surface]')
    if (!scene) return 44
    const token = parseFloat(getComputedStyle(scene).getPropertyValue('--hit-min-comfortable'))
    return Number.isFinite(token) && token > 0 ? token : 44
  })()`)
  return value
}


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

export async function enterReplay3d(page, scenario) {
  const tab = await page.waitForValue(clickCenterExpression('[data-testid="ws-tab"][data-cap="replay"]'), Boolean, { label: 'replay capability tab' })
  await page.tap({ ...tab, touch: scenario.touch })
  await page.waitFor(() => !!document.querySelector('[data-testid="viewer-mode-3d"]'), { label: '3D mode switch' })
  const tapped = await tapElement(page, '[data-testid="viewer-mode-3d"]', {
    touch: scenario.touch,
    verify: () => page.waitForValue('new URLSearchParams(location.search).get("view")', (view) => view === 'agent-replay',
      { timeout: 5000, label: '3D mode route' }),
  })
  if (!tapped) throw new Error('3D mode switch not hit-testable or tap did not change the route')
  await page.waitFor(() => new URLSearchParams(location.search).get('view') === 'agent-replay', { label: '3D mode route' })
}
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
