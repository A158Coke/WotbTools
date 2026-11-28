import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { assertStickyPositions } from './browser-hof-sticky.mjs'
import { Page } from './browser-page.mjs'

const lastReplay = '.replay-evidence-item:last-child'
const decision = '.hof-review-decision'
const form = '.hundred-action-area'

function geometry() {
  const q = s => document.querySelector(s)
  const evidence = q('.hof-review-evidence').getBoundingClientRect()
  const facts = q('.hof-review-facts').getBoundingClientRect()
  const panel = q('.hof-review-pane')
  const overlay = panel.classList.contains('is-overlay')
  const tabs = q('.hof-admin-tabs').getBoundingClientRect()
  const problems = []
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push('page overflows')
  for (const [selector, bounds] of [['.hof-review-evidence *', evidence], ['.hof-review-facts *', facts]]) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect()
      if (r.left < bounds.left - 1 || r.right > bounds.right + 1) problems.push((el.getAttribute('class') || el.tagName) + ' escapes column')
    }
  }
  for (const name of document.querySelectorAll('.replay-name')) {
    if (name.scrollWidth > name.clientWidth + 1) problems.push('filename clipped')
  }
  return { problems: [...new Set(problems)], overlay, gap: overlay ? null : panel.getBoundingClientRect().top - tabs.bottom,
    columns: Math.abs(evidence.top - facts.top) < 2 ? 2 : 1, paneWidth: Math.round(panel.getBoundingClientRect().width) }
}

async function key(page, key, code, shift = false) {
  for (const type of ['keyDown', 'keyUp']) await page.client.send('Input.dispatchKeyEvent', {
    type, key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0,
  }, page.sessionId)
}

function hitPoints(selector) {
  const el = document.querySelector(selector), r = el.getBoundingClientRect()
  const dx = Math.min(5, r.width / 4), dy = Math.min(5, r.height / 4)
  return [[r.left + r.width / 2, r.top + r.height / 2], [r.left + dx, r.top + dy],
    [r.right - dx, r.top + dy], [r.left + dx, r.bottom - dy], [r.right - dx, r.bottom - dy]]
    .every(([x,y]) => el.contains(document.elementFromPoint(x, y)))
}

export async function runReviewDetail({ chrome, origin }, fixture, scenario) {
  const { width, height, locale, theme, domain, reduced } = scenario
  const touch = width < 1200
  fixture.reset()
  fixture.setPendingCounts(24, 24)
  const { targetId, sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  const failures = []
  const present = sel => page.waitForValue('!!document.querySelector(' + JSON.stringify(sel) + ')', Boolean)
  const tap = sel => page.tapSelector(sel, touch)
  async function reveal(sel) {
    await present(sel)
    await page.callWith(s => document.querySelector(s).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }), sel)
    await page.animationsSettled()
  }
  async function checkHit(sel) {
    await reveal(sel)
    if (!await page.callWith(hitPoints, sel)) failures.push('obscured: ' + sel)
  }
  async function snapshot(state) {
    if (!process.env.HOF_DETAIL_SHOTS) return
    const dir = process.env.HOF_DETAIL_SHOTS
    await mkdir(dir, { recursive: true })
    const image = await chrome.client.send('Page.captureScreenshot', { format: 'webp', quality: 80 }, sessionId)
    await writeFile(join(dir, [domain, width, height, locale, theme, state].join('-') + '.webp'), Buffer.from(image.data, 'base64'))
  }
  try {
    await page.enable()
    await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('wotb-lang', ${JSON.stringify(locale)});localStorage.setItem('wotb-ui-profile', ${JSON.stringify(theme)})`,
    }, sessionId)
    await page.emulate({ width, height, touch, deviceScaleFactor: 1 })
    await chrome.client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] }, sessionId)
    await page.goto(origin + '/?view=hof-admin&ws-auth=1&ws-roles=HoF-admin')
    await tap('.hof-admin-tabs button:nth-child(' + (domain === 'hundred' ? 3 : 4) + ')')
    await tap('[data-testid=hof-queue-open]')
    await present(lastReplay + ' button')
    await page.evaluate("Promise.all([...document.querySelectorAll('.hundred-proof')].map(img => img.decode()))")
    await page.evaluate('document.fonts.ready')
    await page.animationsSettled()
    const sticky = touch ? null : await assertStickyPositions(page, ['.hof-admin-tabs', '.hof-review-pane'])
    const layout = await page.probe(geometry)
    assert.equal(layout.overlay, touch, 'detail presentation at ' + width)
    if (sticky) {
      console.log('[hof-review] sticky', domain, width, JSON.stringify({ ...sticky, gap: layout.gap }))
      assert.ok(Math.abs(layout.gap - 8) <= 1, 'expected 8px between pinned tabs and detail, got ' + layout.gap)
      assert.equal(layout.columns, width === 1600 ? 2 : 1, 'detail columns at ' + width)
    }
    failures.push(...layout.problems)
    const photos = await page.probe(() => [...document.querySelectorAll('.hundred-proof')].map(img => [img.naturalWidth, img.naturalHeight]))
    assert.equal(photos.length, domain === 'hundred' ? 1 : 2)
    assert.ok(photos[0][0] > photos[0][1] && photos[0][1] > 100)
    if (domain === 'mark3') assert.ok(photos[1][1] > photos[1][0])
    console.log('[hof-review]', domain, width, height, JSON.stringify(layout))
    await snapshot('top')
    for (const sel of [lastReplay + ' button', '.hof-review-compare dt:last-of-type', '.val-list li:last-child', '.hof-review-meta dd:last-child']) {
      await checkHit(sel)
      if (sel === lastReplay + ' button') await snapshot('replays')
      if (sel === '.val-list li:last-child') await snapshot('facts')
    }
    await tap(decision + ' .danger')
    await present(form + ' textarea')
    await page.waitForValue("document.activeElement.matches('.hundred-action-area select')", Boolean)
    for (const [selector, backwards] of [['textarea', false], ['button:not(.danger)', false], ['button.danger', false], ['button:not(.danger)', true]]) {
      await key(page, 'Tab', 9, backwards)
      assert.ok(await page.evaluate('document.activeElement.matches(' + JSON.stringify(form + ' ' + selector) + ')'), 'Tab to ' + selector)
      await page.waitForValue(`(${hitPoints.toString()})(':focus')`, Boolean, { timeout: 1500, label: 'focused ' + selector + ' visible after keyboard scroll' }).catch(async error => {
        const rect = await page.probe(() => document.activeElement.getBoundingClientRect().toJSON())
        throw new Error(error.message + ' ' + JSON.stringify(rect))
      })
    }
    await checkHit(form + ' textarea')
    await checkHit(form + ' .danger')
    await snapshot('reject')
    await tap(form + ' button:not(.danger)')
    await tap(decision + ' .ok')
    await checkHit(form + ' .ok')
    await snapshot('confirm')
    await tap(form + ' button:not(.ok)')
    if (failures.length) return failures
    await checkHit('.hundred-proof-row:last-child .hof-zoom-proof')
    await tap('.hundred-proof-row:last-child .hof-zoom-proof')
    await present('.screenshot-zoom [role=dialog]')
    await key(page, 'Escape', 27)
    await page.waitForValue("document.activeElement.matches('.hof-zoom-proof')", Boolean)
    await key(page, 'Tab', 9)
    await page.waitForValue("document.activeElement.matches('.hundred-proof-row .btn-sm')", Boolean)
    await checkHit('.hundred-proof-row:last-child .btn-sm')
    await key(page, 'Tab', 9, true)
    await page.waitForValue("document.activeElement.matches('.hof-zoom-proof')", Boolean)
    await page.evaluate("document.addEventListener('click', e => { if (e.target instanceof HTMLAnchorElement && e.target.download) document.body.dataset.download = e.target.download }, true)")
    await tap('.hundred-proof-row:last-child .btn-sm')
    await page.waitForValue('document.body.dataset.download', name => name?.endsWith('.webp'))
    await tap(lastReplay + ' button')
    assert.ok(fixture.requests.some(r => r.pathname.endsWith('/replays/504')), 'last replay requested')
    await tap('[data-testid=hof-review-next]')
    await present(lastReplay + ' button')
    await tap('[data-testid=hof-review-prev]')
    await present(decision + ' .ok:not(:disabled)')
    await tap(decision + ' .danger')
    await page.callWith(sel => {
      const select = document.querySelector(sel)
      select.value = 'OTHER'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }, form + ' select')
    await tap(form + ' textarea')
    await page.client.send('Input.insertText', { text: 'Fixture review' }, sessionId)
    await tap(form + ' .danger')
    await page.waitForValue("!document.querySelector('.hof-review-pane')", Boolean)
    await page.waitForValue("document.activeElement.matches('[data-testid=hof-queue-open]')", Boolean)
    await tap('.hof-queue-item:nth-child(3) [data-testid=hof-queue-open]')
    await present('.hundred-proof-empty')
    await present('.hof-review-decision .ok:disabled')
    await tap('[data-testid=hof-review-next]')
    await present('.hundred-proof-row [role=status]')
    await checkHit('.hundred-proof-row .btn-sm')
    await tap('[data-testid=hof-review-back]')
    await page.waitForValue("!document.querySelector('.hof-review-pane')", Boolean)
    return failures
  } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
}
