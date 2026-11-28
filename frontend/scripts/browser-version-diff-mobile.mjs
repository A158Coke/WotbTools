
import assert from 'node:assert/strict'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
const requested = process.env.WOTB_VERSION_DIFF_URL || 'http://localhost:5199'
const base = new URL(requested)
const assetOrigin = process.env.WOTB_VERSION_DIFF_ASSETS || 'http://127.0.0.1:8129'
async function checkGrip(page, selector, value) {
  const geometry = await page.callWith(sel => {
    const hit = document.querySelector(sel)
    const rail = hit.parentElement
    const frame = rail.getBoundingClientRect()
    const line = rail.querySelector('.vd-compare-divider').getBoundingClientRect()
    const grip = rail.querySelector('.vd-compare-grip').getBoundingClientRect()
    const target = hit.getBoundingClientRect()
    return {
      grip: grip.left + grip.width / 2,
      line: line.left + line.width / 2,
      frameLeft: frame.left,
      frameWidth: frame.width,
      targetInside: target.left >= frame.left - 0.01 && target.right <= frame.right + 0.01,
      targetWidth: target.width,
    }
  }, selector)
  const expected = geometry.frameLeft + geometry.frameWidth * value / 100
  assert.ok(Math.abs(geometry.grip - geometry.line) <= 0.5
    && Math.abs(geometry.line - expected) <= 0.5
    && geometry.targetInside && geometry.targetWidth >= 43.99, JSON.stringify(geometry))
}

const chrome = await launchChromeForCdp(findChrome(), { gpu: true, extraArgs: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const scenarios = [
    [320, 667, 'zh', '毫米', 'winter', '255, 255, 255'],
    [390, 844, 'ru', 'мм', 'spring', '14, 29, 23'],
    [844, 390, 'en', 'mm', 'autumn', '32, 22, 12'],
    [1280, 800, 'en', 'mm', 'summer', '35, 26, 9'],
  ]
  for (const [width, height, lang, unit, theme, cardRgb] of scenarios) {
    const { targetId, sessionId } = await chrome.openPage()
    try {
      const page = new Page(chrome.client, sessionId)
      await page.enable()
      await page.emulate({width, height, deviceScaleFactor: 1})
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `if (location.origin === ${JSON.stringify(base.origin)}) { localStorage.setItem('wotb-lang', ${JSON.stringify(lang)}); localStorage.setItem('wotb-ui-profile', ${JSON.stringify(theme)}) }`,
      }, sessionId)
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(${(() => {
          const paint = { strokes: new Set(), fills: new Set(), fades: new WeakMap() }
          window.__versionDiffTestPaint = paint
          const ctx = CanvasRenderingContext2D.prototype
          const { stroke, fill, clearRect, drawImage } = ctx
          ctx.clearRect = function (...args) {
            if (this.canvas.classList.contains('vd-armor-annotation')) paint.fades.set(this.canvas, [])
            return clearRect.apply(this, args)
          }
          ctx.drawImage = function (...args) {
            if (this.canvas.classList.contains('vd-armor-annotation')) {
              paint.fades.get(this.canvas).push(this.globalAlpha)
            }
            return drawImage.apply(this, args)
          }
          ctx.stroke = function (...args) {
            if (this.canvas.classList.contains('vd-armor-annotation')) {
              paint.strokes.add([this.lineWidth, this.strokeStyle, this.globalAlpha].join(' '))
            }
            return stroke.apply(this, args)
          }
          ctx.fill = function (...args) {
            if (this.canvas.classList.contains('vd-armor-annotation')) {
              paint.fills.add([this.fillStyle, this.globalAlpha].join(' '))
            }
            return fill.apply(this, args)
          }
        }).toString()})()`,
      }, sessionId)
      base.search = new URLSearchParams({ view: 'agent-tankopedia', localuser: '1', assets: assetOrigin })
      await chrome.client.send('Page.navigate', {url: base.href}, sessionId)
      const entry = '[data-testid="nav-version-diff"]'
      await page.waitFor(() => !!document.querySelector('[data-testid="nav-menu"], [data-testid="nav-version-diff"]'))
      if (await page.probe(() => !!document.querySelector('[data-testid="nav-menu"]'))) {
        await page.tapSelector('[data-testid="nav-menu"]', true)
      }
      await page.waitFor(() => {
        const sidebar = document.querySelector('[data-testid="nav-drawer-panel"]')
          ?? document.querySelector('[data-testid="app-sidebar"]')
        const nav = sidebar?.querySelector('nav.sidebar-nav')
        const first = nav?.querySelector('a')
        const dataset = sidebar?.querySelector('button.sidebar-version')
        const icon = first?.querySelector('svg.lucide-file-diff')
        return first?.dataset.testid === 'nav-version-diff' && dataset
          && icon?.getAttribute('aria-hidden') === 'true' && icon.getBoundingClientRect().width === 24
          && dataset.getBoundingClientRect().bottom <= first.getBoundingClientRect().top
          && first.getBoundingClientRect().top - dataset.getBoundingClientRect().bottom <= 16
      }, { label: 'Version Changes with File Diff icon directly under Data Version' })
      await page.tapSelector(entry, true)
      await page.waitFor(() => document.querySelector('.vd-title')?.textContent.includes('11.22.0') && !!document.querySelector('.vd-armor-preview'))
      await page.waitFor(() => !document.querySelector('[data-testid="nav-drawer"]'))
      await page.tapSelector('.vd-pair-trigger', true)
      await page.waitFor(() => !!document.querySelector('.app-select-menu [aria-selected="true"]'),
        { label: 'version pair popup and selected row' })
      const menu = await page.probe(() => {
        const trigger = document.querySelector('.vd-pair-trigger').getBoundingClientRect()
        const popup = document.querySelector('.app-select-menu')
        const bounds = popup.getBoundingClientRect()
        const options = [...popup.querySelectorAll('[role="option"]')]
        const selected = options.filter(option => option.getAttribute('aria-selected') === 'true')
        const style = getComputedStyle(popup)
        const reference = document.createElement('span')
        reference.style.backgroundColor = 'var(--color-surface-3)'
        popup.append(reference)
        const usesMenuSurface = style.backgroundColor === getComputedStyle(reference).backgroundColor
        reference.remove()
        return {
          usesMenuSurface,
          visibleShadow: style.boxShadow !== 'none',
          aligned: Math.abs(bounds.left - trigger.left) < 1 && Math.abs(bounds.right - trigger.right) < 1,
          inside: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
          rowSizes: options.every(option => option.getBoundingClientRect().height >= 40),
          selectedCheck: selected.length === 1 && !!selected[0].querySelector('.app-select-menu-check svg'),
        }
      })
      assert.ok(Object.values(menu).every(Boolean), JSON.stringify(menu))
      for (const type of ['keyDown', 'keyUp']) {
        await chrome.client.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
      }
      await page.waitFor(() => !document.querySelector('.app-select-menu')
        && document.activeElement?.matches('.vd-pair-trigger'))
      const surfaces = await page.probe(() => {
        const color = selector => getComputedStyle(document.querySelector(selector)).backgroundColor
        return { card: color('.vd-hero'), section: color('.vd-panel'), vehicle: color('.vd-armor-preview') }
      })
      assert.deepEqual(surfaces, { card: `rgba(${cardRgb}, 0.94)`, section: `rgba(${cardRgb}, 0.4)`, vehicle: `rgba(${cardRgb}, 0.94)` })
      const dimensions = await page.probe(() => {
        const host = document.querySelector('.vd-page')
        const measures = [...host.querySelectorAll('.vd-hero, .vd-pair-picker, .vd-lineup-card, .vd-vehicle, .vd-armor-preview')].map(el => ({
          cls: el.className, width: el.clientWidth, scroll: el.scrollWidth,
        }))
        return { viewport: innerWidth, doc: document.documentElement.scrollWidth, page: host.clientWidth, scroll: host.scrollWidth,
          overflow: measures.filter(el => el.scroll > el.width + 1),
          columns: getComputedStyle(host.querySelector('.vd-armor-previews')).gridTemplateColumns }
      })
      assert.ok(dimensions.doc <= dimensions.viewport + 1 && dimensions.scroll <= dimensions.page + 1 && !dimensions.overflow.length, JSON.stringify(dimensions))
      await page.waitFor(() => {
        const cards = [...document.querySelectorAll('#vd-section-tanks .vd-vehicle')]
        const tank = name => cards.find(card => card.querySelector('.tp-card-name')?.textContent === name)
        const pairs = name => [...(tank(name)?.querySelectorAll('.vd-comparison > div') ?? [])].map(row => [
          row.querySelector('.vd-reading-before')?.textContent,
          row.querySelector('strong.tp-param-value')?.textContent,
          row.querySelector('.tp-param-unit')?.textContent,
          row.querySelector('.tp-param-delta'),
        ])
        const count = (name, old, value, unit) => pairs(name).filter(row =>
          row[0] === old && row[1] === value && (!unit || row[2] === unit)).length
        const tone = (name, old, value, kind) => {
          const delta = pairs(name).find(row => row[0] === old && row[1] === value)?.[3]
          if (!delta || !delta.classList.contains('is-' + kind)) return false
          const reference = document.createElement('span')
          reference.style.color = kind === 'good' ? 'var(--color-success)' : 'var(--color-danger)'
          delta.parentElement.append(reference)
          const matches = getComputedStyle(delta).color === getComputedStyle(reference).color
          reference.remove()
          return matches
        }
        return tone('Lorraine 120 Alby', '7', '10', 'good')
          && tone('Lorraine 120 Alby', '21.3', '22.2', 'bad')
          && tone('TVP VTU', '225', '205', 'bad')
          && count('Lorraine 120 Alby', '7', '10', '°') === 1
          && count('M47 Chevalier', '3', '2', '°') === 1
          && count('M47 Chevalier', '35', '30', '°') === 1
          && count('TVP VTU', '225', '205') === 1
          && count('TVP VTU', '195', '185') === 1
      }, { label: 'distinct parameter rows and encyclopedia colors from local datasets' })
      if (lang === 'zh') await page.waitFor(() => {
        const card = [...document.querySelectorAll('#vd-section-tanks .vd-vehicle')].find(
          item => item.querySelector('.tp-card-name')?.textContent === 'Donnola',
        )
        const rows = [...(card?.querySelectorAll('.vd-comparison > div') ?? [])]
        return rows.filter(row => row.querySelector('dt')?.textContent === '车辆类别'
          && row.querySelector('.vd-reading-before')?.textContent === '金币车'
          && row.querySelector('strong.tp-param-value')?.textContent === '收藏车').length === 1
          && !rows.some(row => ['金币车', '收藏车'].includes(row.querySelector('dt')?.textContent))
      }, { label: 'Donnola shows one premium to collector change' })
      await page.tapSelector('.vd-vehicle .vd-identity-action', true)
      await page.waitFor(() => !!document.querySelector('[role="dialog"] .vd-tank .vd-tabs'))
      assert.ok(await page.probe(() => {
        const tabs = document.querySelector('[role="dialog"] .vd-tank .vd-tabs')
        return tabs.scrollWidth <= tabs.clientWidth + 1
      }))
      await page.tapSelector('[role="dialog"] .dialog-close', true)
      await page.waitFor(() => !document.querySelector('[role="dialog"] .vd-tank'))

      await page.tapSelector('#vd-section-maps summary', true)
      await page.tapSelector('#vd-section-maps .vd-map-row', true)
      const mapHandle = '[role="dialog"] .vd-map-compare .vd-compare-handle'
      await page.waitForValue('!!document.querySelector(' + JSON.stringify(mapHandle) + ')', Boolean)
      await page.animationsSettled()
      const mapLayout = await page.callWith(sel => {
        const handle = document.querySelector(sel)
        const hit = handle.getBoundingClientRect()
        const frame = handle.closest('.vd-map-compare').getBoundingClientRect()
        const summary = document.querySelector('.vd-map-summary').getBoundingClientRect()
        return {
          size: [hit.width, hit.height],
          stacked: summary.top >= frame.bottom - 1,
          sideBySide: summary.left >= frame.right - 1,
        }
      }, mapHandle)
      await checkGrip(page, mapHandle, 50)
      assert.ok(mapLayout.size.every(size => size >= 43.99), JSON.stringify(mapLayout))
      assert.ok(width < 768 ? mapLayout.stacked : mapLayout.sideBySide, JSON.stringify(mapLayout))
      await page.tapSelector('[role="dialog"] .vd-map-compare .vd-version-stop.is-new', true)
      await page.waitForValue('document.querySelector(' + JSON.stringify(mapHandle) + ')?.getAttribute("aria-valuenow")', value => value === '0')
      assert.match(await page.probe(() => document.querySelector('.vd-map-layer.is-overlay').style.clipPath), /100%/)
      await checkGrip(page, mapHandle, 0)
      await page.tapSelector('[role="dialog"] .vd-map-compare .vd-version-stop:not(.is-new)', true)
      await page.waitForValue('document.querySelector(' + JSON.stringify(mapHandle) + ')?.getAttribute("aria-valuenow")', value => value === '100')
      await checkGrip(page, mapHandle, 100)
      await page.tapSelector('[role="dialog"] .dialog-close', true)
      await page.waitFor(() => !document.querySelector('[role="dialog"] .vd-map'))

      await page.callWith(sel => document.querySelector(sel).scrollIntoView({block: 'center'}), '.vd-armor-preview .vd-armor-viewport')
      const selector = '.vd-armor-preview:first-child .vd-compare-handle'
      await page.waitFor(() => !!document.querySelector('.vd-armor-preview:first-child .vd-compare-handle'),
        {timeout: 16_000, label: 'first embedded armor comparison ready'})
      await checkGrip(page, selector, 50)
      await page.waitFor(() => {
        const paint = window.__versionDiffTestPaint
        const tokens = getComputedStyle(document.documentElement)
        const ink = tokens.getPropertyValue('--color-armor-note-ink').trim()
        const base = tokens.getPropertyValue('--color-armor-note-base').trim()
        return paint.strokes.has('4 ' + base + ' 1')
          && paint.strokes.has('1.5 ' + ink + ' 1')
          && paint.fills.has(base + ' 1')
      }, { label: 'opaque armor note fill and paired high-contrast leader strokes' })
      const armor = '.vd-armor-preview:first-child'
      const plate = armor + ' .vd-plate-select'
      const fadePasses = 'window.__versionDiffTestPaint.fades.get(document.querySelector('
        + JSON.stringify(armor + ' .vd-armor-annotation') + '))'
      assert.deepEqual(await page.evaluate(fadePasses), [])
      await page.tapSelector(armor + ' details summary', true)
      await page.tapSelector(plate, true)
      await page.waitForValue('document.querySelector(' + JSON.stringify(plate) + ')?.getAttribute("aria-pressed")', value => value === 'true')
      await page.waitForValue(fadePasses, alpha => alpha?.length === 1 && alpha[0] === 0.3,
        { label: 'unselected labels and leaders composite together at 30% opacity' })
      const canvas = armor + ' .vd-armor-canvas canvas'
      await page.callWith(sel => document.querySelector(sel).scrollIntoView({block: 'center'}), canvas)
      const point = await page.callWith(sel => {
        const rect = document.querySelector(sel).getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.85 }
      }, canvas)
      await page.tap(point)
      await page.waitForValue('document.querySelector(' + JSON.stringify(plate) + ')?.getAttribute("aria-pressed")', value => value === 'false')
      await page.waitForValue(fadePasses, alpha => alpha?.length === 0, { label: 'deselect restores full-opacity annotations' })
      for (const [which, stop] of [['.is-new', 0], [':not(.is-new)', 100]]) {
        await page.tapSelector('.vd-armor-preview:first-child .vd-version-stop' + which, true)
        const value = 'Number(document.querySelector(' + JSON.stringify(selector) + ').getAttribute("aria-valuenow"))'
        await page.waitForValue(value, current => current === stop, { timeout: 3_000, label: 'tap version ' + stop })
        await checkGrip(page, selector, stop)
      }

      const rect = await page.callWith(sel => {
        const r = document.querySelector(sel).getBoundingClientRect()
        return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height}
      }, selector)
      const touch = (type, touchPoints) => chrome.client.send('Input.dispatchTouchEvent', {type, touchPoints}, sessionId)
      const contact = x => ({ x, y: rect.y, id: 1, radiusX: 8, radiusY: 8, force: 1 })
      await touch('touchStart', [contact(rect.x)])
      for (const offset of [20, 40, 65]) {
        await page.evaluate('new Promise(requestAnimationFrame)')
        await touch('touchMove', [contact(rect.x - offset)])
      }
      await touch('touchEnd', [])
      const split = await page.callWith(sel => Number(document.querySelector(sel).getAttribute('aria-valuenow')), selector)
      assert.ok(split < 95, String(split))
      assert.ok(rect.w >= 44 && rect.h >= 44, JSON.stringify(rect))
      assert.ok(await page.callWith(unit => [...document.querySelectorAll('#vd-section-tanks .tp-param-unit')].some(el => el.textContent === unit), unit))
      if (theme === 'winter') {
        await page.tapSelector('.vd-pair-trigger', true)
        await page.tapSelector('.app-select-menu [role="option"]:nth-child(2)', true)
        await page.waitFor(() => new URLSearchParams(location.search).get('to') === '11.21.0_1'
          && !!document.querySelector('.vd-changes') && !document.querySelector('.vd-armor-action'),
        { label: 'older version pair summary rendered' })
        await page.tapSelector('.vd-pair-trigger', true)
        await page.tapSelector('.app-select-menu [role="option"]:first-child', true)
        await page.waitFor(() => new URLSearchParams(location.search).get('to') === '11.22.0'
          && !!document.querySelector('.vd-armor-action'), { label: 'newer version pair summary rendered' })
        await page.tapSelector('.vd-armor-action', true)
        await page.waitFor(() => {
          const query = new URLSearchParams(location.search)
          return query.get('view') === 'agent-tankopedia' && query.get('data') === '11.22.0' && query.has('tank')
        }, { label: 'armor card opens new version tank encyclopedia' })
      }
      console.log(JSON.stringify({ width, height, lang, theme, touch: [rect.w, rect.h], split }))
    } finally {
      await chrome.client.send('Target.closeTarget', {targetId})
    }
  }
} finally {
  await chrome.close()
}
