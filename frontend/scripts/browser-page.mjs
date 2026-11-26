
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function callPageFunction(client, sessionId, fn, ...args) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `(${fn.toString()})`,
  }, sessionId)
  if (exceptionDetails) {
    throw new Error(`page exception: ${exceptionDetails.exception?.description || exceptionDetails.text}`)
  }
  const call = await client.send('Runtime.callFunctionOn', {
    functionDeclaration: 'function(...args) { return this(...args) }',
    objectId: result.objectId,
    arguments: args.map(value => ({ value })),
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (call.exceptionDetails) {
    throw new Error(`page exception: ${call.exceptionDetails.exception?.description || call.exceptionDetails.text}`)
  }
  return call.result.value
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

  async goto(url, { timeout = 45_000 } = {}) {
    await this.client.send('Page.navigate', { url }, this.sessionId)
    await this.waitForValue('document.readyState', (value) => value === 'complete', { timeout, label: 'document readyState=complete' })
  }

  async diagnose(probeFn = null) {
    const state = probeFn ? await this.probe(probeFn).catch(() => null) : null
    return [
      `page state: ${JSON.stringify(state)}`,
      `page errors: ${this.consoleErrors.join(' | ') || '(none)'}`,
    ]
  }

  async animationsSettled(timeout = 3000) {
    await this.waitForValue(
      `document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)`,
      value => value === true,
      { timeout, label: 'animations settled' },
    ).catch(() => {})
  }

  async tap(point) {
    const touch = point.touch !== false
    if (touch) {
      await this.client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }],
      }, this.sessionId)
      await delay(40)
      await this.client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }, this.sessionId)
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
      window.__inputTrace = { primary: null, click: null, clickCount: 0 }
      const recordPrimary = (event) => { window.__inputTrace.primary = describe(event.target) }
      document.addEventListener('touchstart', recordPrimary, true)
      document.addEventListener('mousedown', recordPrimary, true)
      document.addEventListener('click', (event) => {
        window.__inputTrace.click = describe(event.target)
        window.__inputTrace.clickCount += 1
      }, true)
      return true
    })()`)
  }

  inputTrace() {
    return this.evaluate('window.__inputTrace')
  }

  resetInputTrace() {
    return this.evaluate('window.__inputTrace = { primary: null, click: null, clickCount: 0 }; window.__inputTrace')
  }

  async tapSelector(selector, touch = true) {
    await this.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`, Boolean, { label: `present ${selector}` })
    await this.callWith((sel) => document.querySelector(sel).scrollIntoView({ block: 'center', inline: 'nearest' }), selector)
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await this.animationsSettled()
    const point = await this.callWith((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, selector)
    await this.tap({ ...point, touch })
  }

  async navigateViaShell(id, touch = true) {
    await this.waitForValue('!!document.querySelector("[data-testid=nav-menu],[data-testid=app-sidebar]")', Boolean, { label: 'app shell ready' })
    const drawer = await this.evaluate('!!document.querySelector("[data-testid=nav-menu]")')
    if (!drawer) {
      await this.tapSelector(`[data-testid=nav-${id}]`, touch)
      return `[data-testid=nav-${id}]`
    }
    await this.openNavDrawer(touch)
    const selector = `[data-testid=nav-drawer-panel] [data-testid=nav-${id}]`
    await this.tapSelector(selector, touch)
    await this.waitForValue('!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: `drawer closed after nav-${id}` })
    return selector
  }

  async openNavDrawer(touch = true) {
    await this.tapSelector('[data-testid=nav-menu]', touch)
    await this.waitForValue('!!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'nav drawer open' })
    await this.animationsSettled()
  }

  async closeNavDrawer() {
    for (const type of ['keyDown', 'keyUp']) {
      await this.client.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, this.sessionId)
    }
    await this.waitForValue('!document.querySelector("[data-testid=nav-drawer-panel]")', Boolean, { label: 'nav drawer closed' })
  }

  callWith(fn, ...args) {
    return callPageFunction(this.client, this.sessionId, fn, ...args)
  }

  async revealControl(selector, probeFn) {
    await this.callWith((sel) => {
      const el = document.querySelector(sel)
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' })
      return !!el
    }, selector)
    await delay(200)
    return this.probe(probeFn)
  }
}
