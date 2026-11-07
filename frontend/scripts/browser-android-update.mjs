import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Real application/shell/sheet/CSS, with only the Android transport boundary replaced.
// This verifies browser layout and interaction; it does not emulate DownloadManager or Gecko.
function nativeBoundary() {
  const listeners = new Set()
  const status = {
    revision: 1, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
    currentVersionName: '3.27.2', currentVersionCode: 3027002,
    latestVersionName: '3.29.0', latestVersionCode: 3029000, minSupportedVersionCode: 3017007,
    publishedAt: '2026-11-01T12:00:00Z', releaseNotes: 'Fixture release notes', optionalPromptSuppressed: false,
    download: { taskToken: null, versionName: null, versionCode: null, state: 'idle',
      downloadedBytes: null, totalBytes: null, progressPercent: null, failureReason: null },
  }
  window.updateFixture = { status, calls: [], focusChanges: 0 }
  document.addEventListener('focusin', () => { window.updateFixture.focusChanges += 1 })
  window.WotbNative = {
    addEventListener(_name, listener) { listeners.add(listener) },
    removeEventListener(_name, listener) { listeners.delete(listener) },
    postMessage(raw) {
      const request = JSON.parse(raw)
      window.updateFixture.calls.push(request)
      let result = null
      if (request.method === 'getCapabilities') result = ['app-update', 'app-update-status', 'connectivity']
      if (request.method === 'getBridgeVersion') result = 3
      if (request.method === 'connectivityGetState') result = 'online'
      if (request.method === 'getUpdateStatus') result = structuredClone(status)
      if (request.method === 'refreshUpdateStatus') {
        status.revision += 1
        status.checkState = 'failed'
        status.checkFailureReason = 'network'
        result = structuredClone(status)
      }
      if (request.method === 'beginUpdateDownload') {
        status.revision += 1
        status.download = { ...status.download, taskToken: 'fixture-task', versionName: status.latestVersionName,
          versionCode: status.latestVersionCode, state: 'downloading', downloadedBytes: 84000000,
          totalBytes: 200000000, progressPercent: 42 }
        result = true
      }
      if (request.method === 'dismissOptionalUpdate') {
        status.revision += 1
        status.optionalPromptSuppressed = true
        result = true
      }
      queueMicrotask(() => {
        for (const listener of listeners) listener({ data: { id: request.id, result } })
      })
    },
  }
}

async function click(page, selector) {
  const point = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) throw Error('Missing target: ' + ${JSON.stringify(selector)})
    element.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })()`)
  await page.client.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point }, page.sessionId)
  await page.client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }, page.sessionId)
}

function geometry() {
  const panel = document.querySelector('[data-testid="android-update-panel"]')
  const rect = panel?.getBoundingClientRect()
  const controls = panel ? [...panel.querySelectorAll('button')].map(element => ({
    text: element.textContent, height: element.getBoundingClientRect().height,
  })) : []
  return { width: innerWidth, focused: document.activeElement?.outerHTML.slice(0, 180), viewportOverflow: document.documentElement.scrollWidth > innerWidth,
    panel: rect ? { left: rect.left, right: rect.right } : null, controls }
}

const { server, origin } = await startFixtureServer()
let chrome
try {
  chrome = await launchChromeForCdp(findChrome())
  for (const profile of ['winter', 'summer']) {
    for (const width of [390, 900, 1440]) {
      const { targetId, sessionId } = await chrome.openPage()
      const page = new Page(chrome.client, sessionId)
      try {
        await page.enable()
        await page.emulate({ width, height: 900, touch: width < 1200 })
        await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
          source: `(${nativeBoundary.toString()})(); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(profile)}); localStorage.setItem('wotb-lang', 'en');`,
        }, sessionId)
        await chrome.client.send('Page.navigate', { url: `${origin}/?view=more&ws-auth=0` }, sessionId)
        // Cold Vite dependency transforms can exceed the shared navigation budget on CI.
        await page.waitForValue('document.readyState', value => value === 'complete', { timeout: 90_000, label: 'application modules loaded' })
        await page.waitForValue(`!!document.querySelector('[data-testid="android-update-notice"]') && !!document.querySelector('[data-testid="more-link-app-update"]')`, value => value === true)
        const initial = await page.evaluate(`({ dialogs: document.querySelectorAll('[role="dialog"][data-state="open"]').length,
          focused: document.activeElement.tagName, refreshes: window.updateFixture.calls.filter(call => call.method === 'refreshUpdateStatus').length })`)
        if (initial.dialogs || initial.focused !== 'BODY' || initial.refreshes) throw Error(`Optional startup interrupted: ${JSON.stringify(initial)}`)
        const openUpdate = async () => {
          if (width >= 768) {
            await click(page, '[data-testid="nav-more"]')
            await page.waitForValue(`!!document.querySelector('[data-testid="more-panel"] [data-testid="more-link-app-update"]')`, value => value === true)
            await click(page, '[data-testid="more-panel"] [data-testid="more-link-app-update"]')
          } else await click(page, '[data-testid="more-link-app-update"]')
          await page.waitForValue(`!!document.querySelector('[data-testid="update-refresh"]')`, value => value === true)
        }
        await openUpdate()
        await page.waitForValue(`!!document.querySelector('[data-testid="update-refresh"]')`, value => value === true)
        const shape = await page.probe(geometry)
        if (shape.viewportOverflow || !shape.panel || shape.panel.left < 0 || shape.panel.right > width + 1) throw Error(`Panel overflow: ${JSON.stringify(shape)}`)
        if (shape.controls.some(control => control.height < 44)) throw Error(`Undersized touch target: ${JSON.stringify(shape.controls)}`)
        await click(page, '[data-testid="update-refresh"]')
        await page.waitForValue(`document.querySelector('[data-testid="update-check-status"]')?.textContent.includes('Unable to check')`, value => value === true)
        await click(page, '[data-testid="update-download-action"]')
        await page.waitForValue(`document.querySelector('[data-testid="update-progress"]')?.textContent.includes('42%')`, value => value === true)
        await click(page, '[data-testid="update-close"]')
        await page.waitForValue(`!document.querySelector('[data-testid="update-close"]')`, value => value === true)
        const final = await page.evaluate(`({ download: window.updateFixture.status.download.state,
          enqueues: window.updateFixture.calls.filter(call => call.method === 'beginUpdateDownload').length,
          installs: window.updateFixture.calls.filter(call => call.method === 'installUpdate').length })`)
        if (final.download !== 'downloading' || final.enqueues !== 1 || final.installs !== 0) throw Error(`Closing panel changed download: ${JSON.stringify(final)}`)
        await openUpdate()
        await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
        await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
        await page.waitForValue(`!document.querySelector('[data-testid="update-close"]')`, value => value === true)
        await page.waitForValue(`document.activeElement?.dataset.testid`, value => value === (width >= 768 ? 'nav-more' : 'more-link-app-update'), { label: 'sheet Escape restores More trigger focus' })
        console.log(`[browser-android-update] ${profile}/${width}: optional nonblocking, More entry, bounds/44px, explicit failure, progress, close passed`)
      } catch (error) {
        console.error(error)
        console.error(await page.diagnose(geometry))
        throw error
      } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
    }
  }
  const { targetId, sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  try {
    await page.enable()
    await page.emulate({ width: 390, height: 900 })
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${nativeBoundary.toString()})(); localStorage.setItem('wotb-lang', 'en');`,
    }, sessionId)
    await chrome.client.send('Page.navigate', { url: `${origin}/?view=more&androidUpdate=1&keep=value#details` }, sessionId)
    await page.waitForValue(`!!document.querySelector('[data-testid="update-refresh"]')`, value => value === true, { timeout: 90_000, label: 'notification opens existing update panel' })
    const location = await page.evaluate(`({ query: Object.fromEntries(new URLSearchParams(window.location.search)), hash: window.location.hash })`)
    if (location.query.androidUpdate !== undefined || location.query.view !== 'more' || location.query.keep !== 'value' || location.hash !== '#details') {
      throw Error(`Notification marker changed unrelated route state: ${JSON.stringify(location)}`)
    }
    await click(page, '[data-testid="update-close"]')
    await page.waitForValue(`!document.querySelector('[data-testid="update-close"]')`, value => value === true)
    const reads = await page.evaluate(`window.updateFixture.calls.filter(call => call.method === 'getUpdateStatus').length`)
    await page.evaluate(`window.dispatchEvent(new Event('focus'))`)
    await page.waitForValue(`window.updateFixture.calls.filter(call => call.method === 'getUpdateStatus').length`, value => value > reads)
    if (await page.evaluate(`!!document.querySelector('[data-testid="update-close"]')`)) throw Error('Consumed notification reopened the panel')
    console.log('[browser-android-update] notification: capability-gated panel, marker-only router replace, no reopen passed')
  } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
} finally {
  if (chrome) await chrome.close()
  await server.close()
}
