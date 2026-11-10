import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Real application/shell/sheet/CSS, with only the Android transport boundary replaced.
// This verifies browser layout and interaction; it does not emulate DownloadManager or Gecko.
function nativeBoundary({ promptSuppressed = false, installPermissionRequired = false } = {}) {
  const listeners = new Set()
  const status = {
    revision: 1, state: 'optional', checkState: 'succeeded', checkFailureReason: null,
    currentVersionName: '3.27.2', currentVersionCode: 3027002,
    latestVersionName: '3.29.0', latestVersionCode: 3029000, minSupportedVersionCode: 3017007,
    publishedAt: '2026-11-01T12:00:00Z', releaseNotes: 'Fixture release notes', optionalPromptSuppressed: promptSuppressed,
    download: installPermissionRequired
      ? { taskToken: 'fixture-permission', versionName: '3.29.0', versionCode: 3029000, state: 'installPermissionRequired',
          downloadedBytes: null, totalBytes: null, progressPercent: null, failureReason: 'permissionDenied' }
      : { taskToken: null, versionName: null, versionCode: null, state: 'idle',
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
    clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
    whiteSpace: getComputedStyle(element).whiteSpace,
  })) : []
  return { width: innerWidth, focused: document.activeElement?.outerHTML.slice(0, 180), viewportOverflow: document.documentElement.scrollWidth > innerWidth,
    panel: rect ? { left: rect.left, right: rect.right } : null, controls }
}

/** 可选更新提示与固定外壳的真实几何 / hit-test 探针（在页面内执行）。 */
function noticeGeometry() {
  const measure = (element) => {
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }
  }
  const topbar = document.querySelector('[data-testid="app-top-bar"]')
  const notice = document.querySelector('[data-testid="android-update-notice"]')
  const main = document.querySelector('.app-main')
  const buttons = notice ? [...notice.querySelectorAll('button')].map((button) => {
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { text: button.textContent, rect: measure(button), hit: hit === button || button.contains(hit) }
  }) : []
  return {
    width: innerWidth,
    height: innerHeight,
    topbar: measure(topbar),
    notice: measure(notice),
    main: measure(main),
    buttons,
    headerH: getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim(),
    mainPaddingTop: main ? getComputedStyle(main).paddingTop : null,
    overflow: document.documentElement.scrollWidth > innerWidth,
    shellChrome: document.documentElement.dataset.shellChrome ?? null,
  }
}

function assertNoticeLayout(layout, { safeTop = 0, hasTopBar }) {
  if (!layout.notice) throw Error(`Missing optional update notice: ${JSON.stringify(layout)}`)
  if (hasTopBar) {
    if (!layout.topbar) throw Error(`Missing compact top bar at ${layout.width}px: ${JSON.stringify(layout)}`)
    if (layout.notice.top < layout.topbar.bottom - 0.5) {
      throw Error(`Optional update notice overlaps fixed top bar: notice.top=${layout.notice.top} topbar.bottom=${layout.topbar.bottom}`)
    }
  } else if (layout.topbar) {
    throw Error(`Unexpected compact top bar at ${layout.width}px: ${JSON.stringify(layout.topbar)}`)
  }
  if (layout.notice.top < safeTop - 0.5) throw Error(`Optional update notice enters top safe area: ${JSON.stringify(layout)}`)
  if (layout.notice.left < -0.5 || layout.notice.right > layout.width + 1) {
    throw Error(`Optional update notice overflows horizontally: ${JSON.stringify(layout)}`)
  }
  if (layout.main && layout.main.top - layout.notice.bottom > 20) {
    throw Error(`Content repeats the fixed header offset: notice.bottom=${layout.notice.bottom} main.top=${layout.main.top}`)
  }
  if (layout.main && Math.abs(parseFloat(layout.mainPaddingTop)) > 0.5) {
    throw Error(`Content repeats the fixed header offset: main padding-top=${layout.mainPaddingTop}`)
  }
  if (layout.buttons.length < 2) throw Error(`Optional update notice lost actions: ${JSON.stringify(layout.buttons)}`)
  for (const button of layout.buttons) {
    if (!button.hit) throw Error(`Optional update notice action is covered: ${JSON.stringify(button)}`)
    if (button.rect.height < 44) throw Error(`Optional update notice action is undersized: ${JSON.stringify(button)}`)
  }
  if (layout.overflow) throw Error(`Optional update notice causes horizontal overflow: ${JSON.stringify(layout)}`)
}

const { server, origin } = await startFixtureServer()
let chrome
try {
  chrome = await launchChromeForCdp(findChrome())

  async function openAppPage({ width, height = 900, profile = 'summer', safeTop = 0, promptSuppressed = false,
    expectNotice = true, waitForMoreLink = true, lang = 'en', boundaryArgs = {},
    url = `${origin}/?view=more&ws-auth=0` }) {
    const { targetId, sessionId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    try {
      await page.enable()
      await page.emulate({ width, height, touch: width < 1200 })
      if (safeTop > 0) {
        await chrome.client.send('Emulation.setSafeAreaInsetsOverride', {
          insets: { top: safeTop, left: 0, bottom: 0, right: 0 },
        }, sessionId)
      }
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(${nativeBoundary.toString()})(${JSON.stringify({ promptSuppressed, ...boundaryArgs })}); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(profile)}); localStorage.setItem('wotb-lang', ${JSON.stringify(lang)});`,
      }, sessionId)
      await chrome.client.send('Page.navigate', { url }, sessionId)
      // Cold Vite dependency transforms can exceed the shared navigation budget on CI.
      await page.waitForValue('document.readyState', value => value === 'complete', { timeout: 90_000, label: 'application modules loaded' })
      if (expectNotice) {
        const ready = waitForMoreLink
          ? '!!document.querySelector(\'[data-testid="android-update-notice"]\') && !!document.querySelector(\'[data-testid="more-link-app-update"]\')'
          : '!!document.querySelector(\'[data-testid="android-update-notice"]\')'
        await page.waitForValue(ready, value => value === true, { timeout: 90_000, label: 'optional update notice' })
      } else {
        await page.waitForValue(`({ read: window.updateFixture.calls.some(call => call.method === 'getUpdateStatus'),
          notice: !!document.querySelector('[data-testid="android-update-notice"]') })`,
        value => value.read && !value.notice, { label: 'update status read without prompt' })
      }
      return { targetId, sessionId, page }
    } catch (error) {
      await chrome.client.send('Target.closeTarget', { targetId }).catch(() => {})
      throw error
    }
  }

  for (const profile of ['winter', 'summer']) {
    for (const width of [390, 900, 1440]) {
      const { targetId, page } = await openAppPage({ width, profile })
      try {
        await page.evaluate('window.scrollTo(0, 0)')
        assertNoticeLayout(await page.probe(noticeGeometry), { hasTopBar: width < 768 })
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
        await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
        await chrome.client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, page.sessionId)
        await page.waitForValue(`!document.querySelector('[data-testid="update-close"]')`, value => value === true)
        await page.waitForValue(`document.activeElement?.dataset.testid`, value => value === (width >= 768 ? 'nav-more' : 'more-link-app-update'), { label: 'sheet Escape restores More trigger focus' })
        console.log(`[browser-android-update] ${profile}/${width}: notice geometry, optional nonblocking, More entry, bounds/44px, explicit failure, progress, close passed`)
      } catch (error) {
        console.error(error)
        console.error(await page.diagnose(geometry))
        throw error
      } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
    }
  }

  for (const scenario of [
    { name: '320px', width: 320, safeTop: 0 },
    { name: '390px safe-area=24', width: 390, safeTop: 24 },
  ]) {
    const { targetId, page } = await openAppPage({ width: scenario.width, safeTop: scenario.safeTop })
    try {
      await page.evaluate('window.scrollTo(0, 0)')
      const layout = await page.probe(noticeGeometry)
      assertNoticeLayout(layout, { hasTopBar: true, safeTop: scenario.safeTop })
      console.log(`[browser-android-update] layout ${scenario.name}: notice.top=${layout.notice.top} topbar.bottom=${layout.topbar.bottom} buttons=${layout.buttons.map(button => button.rect.height).join('/')} passed`)
    } catch (error) {
      console.error(error)
      console.error(await page.diagnose(noticeGeometry))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    // 320px + 俄文 + installPermissionRequired：AppButton 默认 nowrap，长操作文案（Разрешить установку и продолжить）
    // 必须允许按钮内换行且不产生水平溢出，同时保持 44px 触控高度（PR #939 评审 P2）。
    // 有进行中下载时可选提示不出现（showPrompt 要求 download.state==='idle'），改从 More 入口直达面板。
    const { targetId, page } = await openAppPage({ width: 320, lang: 'ru', expectNotice: false, boundaryArgs: { installPermissionRequired: true } })
    try {
      await page.evaluate('window.scrollTo(0, 0)')
      await page.waitForValue(`!!document.querySelector('[data-testid="more-link-app-update"]')`, value => value === true, { timeout: 90_000, label: 'More app-update entry' })
      await click(page, '[data-testid="more-link-app-update"]')
      await page.waitForValue(`!!document.querySelector('[data-testid="update-install"]')`, value => value === true, { timeout: 90_000, label: 'ru install panel' })
      const installText = await page.evaluate(`document.querySelector('[data-testid="update-install"]').textContent.trim()`)
      if (installText !== 'Разрешить установку и продолжить') {
        throw Error(`Unexpected ru install label: ${JSON.stringify(installText)}`)
      }
      const shape = await page.probe(geometry)
      if (shape.viewportOverflow || !shape.panel || shape.panel.left < 0 || shape.panel.right > shape.width + 1) {
        throw Error(`ru 320px panel overflow: ${JSON.stringify(shape)}`)
      }
      const clipped = shape.controls.filter(control => control.clipped)
      if (clipped.length) throw Error(`ru 320px clipped buttons: ${JSON.stringify(clipped)}`)
      const nowrap = shape.controls.filter(control => control.whiteSpace !== 'normal')
      if (nowrap.length) throw Error(`ru 320px buttons cannot wrap long labels: ${JSON.stringify(nowrap)}`)
      if (shape.controls.some(control => control.height < 44)) throw Error(`ru 320px undersized touch target: ${JSON.stringify(shape.controls)}`)
      await click(page, '[data-testid="update-install"]')
      await page.waitForValue(`window.updateFixture.calls.filter(call => call.method === 'installUpdate').length`, value => value === 1, { label: 'ru install click' })
      console.log(`[browser-android-update] ru 320px installPermissionRequired: no overflow/clipped labels, heights=${shape.controls.map(control => Math.round(control.height)).join('/')} install clickable passed`)
    } catch (error) {
      console.error(error)
      console.error(await page.diagnose(geometry))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    const { targetId, page } = await openAppPage({ width: 390, promptSuppressed: true, expectNotice: false })
    try {
      const layout = await page.probe(noticeGeometry)
      if (layout.notice) throw Error(`Suppressed optional update still rendered a notice: ${JSON.stringify(layout.notice)}`)
      if (!layout.topbar) throw Error(`Missing compact top bar without update notice: ${JSON.stringify(layout)}`)
      if (Math.abs(parseFloat(layout.mainPaddingTop) - parseFloat(layout.headerH)) > 0.5) {
        throw Error(`Content lost its header offset without the notice: padding-top=${layout.mainPaddingTop} header-h=${layout.headerH}`)
      }
      console.log(`[browser-android-update] no-update: notice absent, app-main keeps ${layout.mainPaddingTop} header offset passed`)
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }

  {
    const { targetId, page } = await openAppPage({ width: 740, height: 360, waitForMoreLink: false, url: `${origin}/?view=agent-armor&ws-auth=0` })
    try {
      await page.waitForValue('document.documentElement.dataset.shellChrome', value => value === 'immersive', { timeout: 20_000, label: 'phone landscape immersive shell' })
      const immersive = await page.evaluate(`({ shellChrome: document.documentElement.dataset.shellChrome,
        notice: !!document.querySelector('[data-testid="android-update-notice"]'),
        topbar: !!document.querySelector('[data-testid="app-top-bar"]'),
        tabbar: !!document.querySelector('[data-testid="app-tab-bar"]'),
        mainPaddingTop: getComputedStyle(document.querySelector('.app-main')).paddingTop })`)
      if (immersive.shellChrome !== 'immersive' || immersive.notice || immersive.topbar || immersive.tabbar) {
        throw Error(`Immersive shell still renders update chrome: ${JSON.stringify(immersive)}`)
      }
      if (parseFloat(immersive.mainPaddingTop) !== 0) throw Error(`Immersive shell keeps header padding: ${immersive.mainPaddingTop}`)
      console.log('[browser-android-update] immersive: notice/topbar/tabbar hidden and header offset collapsed passed')
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
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
