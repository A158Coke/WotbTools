import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Page } from './browser-page.mjs'
import { launchChromeForCdp, findChrome } from './browser-chrome.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { createAdminDirectory } from './browser-fixtures/admin-directory.mjs'

const test = id => '[data-testid="' + id + '"]'
const feedbackRow = test('feedback-row-open')
const userRow = test('admin-row-open')
const drawer = test('admin-detail-drawer')
const shotDirectory = resolve('../tmp/admin-directory')
async function exists(page, selector, expected = true) {
  await page.waitForValue('!!document.querySelector(' + JSON.stringify(selector) + ')', value => value === expected)
}
async function focusAt(page, selector) {
  await page.waitForValue('document.activeElement?.matches(' + JSON.stringify(selector) + ')', Boolean)
}
async function key(page, name, code) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.client.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code }, page.sessionId)
  }
}
async function capture(page, name, selector) {
  await page.callWith(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), selector)
  await page.animationsSettled()
  const { data } = await page.client.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
  await writeFile(resolve(shotDirectory, name + '.png'), Buffer.from(data, 'base64'))
}
async function exerciseFeedback(page, fixture, touch) {
  const tap = selector => page.tapSelector(selector, touch)
  await tap('.admin-list-pagination-controls button:last-child')
  await page.waitForValue("document.querySelector('.admin-list-pagination')?.textContent.includes('2 / 2')", Boolean)
  await tap(feedbackRow)
  await exists(page, test('feedback-detail-status'))
  await tap(test('admin-danger-start'))
  await tap(test('admin-danger-cancel'))
  assert.equal(fixture.requests.filter(r => r.method === 'DELETE').length, 0)
  await focusAt(page, test('admin-danger-start'))
  await key(page, 'Escape', 27)
  await exists(page, drawer, false)
  await focusAt(page, feedbackRow)
  const fixed = '.feedback-admin [role=radio][data-value=FIXED]'
  await tap(fixed)
  await exists(page, '.feedback-admin [role=alert]')
  assert.equal(await page.evaluate('document.querySelector(' + JSON.stringify(fixed) + ').getAttribute("aria-checked")'), 'false')
  await tap(fixed)
  await page.waitForValue('document.querySelector(' + JSON.stringify(fixed) + ').getAttribute("aria-checked")', v => v === 'true')
  assert.equal(fixture.requests.filter(r => r.method === 'PATCH').length, 2)
  await exists(page, drawer, false)
  await tap(feedbackRow)
  await tap(test('admin-danger-start'))
  await tap(test('admin-danger-confirm'))
  await exists(page, drawer, false)
  assert.deepEqual(fixture.requests.filter(r => r.method === 'DELETE').map(r => r.path.split('/').pop()), ['26'])
  await focusAt(page, '.feedback-admin')
}
async function exerciseUsers(page, fixture, touch) {
  const tap = selector => page.tapSelector(selector, touch)
  const search = test('admin-search-input')
  await tap(search)
  await page.client.send('Input.insertText', { text: 'fixture-' }, page.sessionId)
  assert.equal(fixture.requests.filter(r => r.query.query).length, 0)
  await tap(test('admin-search-btn'))
  await exists(page, userRow)
  assert.equal(fixture.requests.at(-1).query.query, 'fixture-')
  await tap('.admin-table thead input[type=checkbox]')
  await exists(page, test('admin-bulk-delete'))
  await tap('.admin-page-next')
  await exists(page, test('admin-bulk-delete'), false)
  await tap('.admin-table thead input[type=checkbox]')
  await tap(test('admin-bulk-delete'))
  await tap('.bulk-cancel')
  assert.equal(fixture.requests.filter(r => r.method === 'DELETE').length, 0)
  await tap(test('admin-bulk-delete'))
  await tap('.admin-confirm-input')
  await page.client.send('Input.insertText', { text: 'DELETE' }, page.sessionId)
  await tap('.bulk-confirm')
  await exists(page, '.bulk-failures')
  assert.deepEqual(fixture.requests.filter(r => r.method === 'DELETE').map(r => r.body), [['26','27']])
  await tap('.bulk-cancel')
  await tap(test('admin-bulk-delete'))
  await tap('.admin-confirm-input')
  await page.client.send('Input.insertText', { text: 'DELETE' }, page.sessionId)
  await tap('.bulk-confirm')
  await page.waitForValue("!!document.querySelector('.admin-bulk-confirm .admin-list-ok') || !document.querySelector('.bulk-confirm-modal')", Boolean)
  assert.deepEqual(fixture.requests.filter(r => r.method === 'DELETE').map(r => r.body), [['26','27'],['26']])
}

const chrome = await launchChromeForCdp(findChrome())
let fixture = createAdminDirectory()
const { server, origin } = await startFixtureServer({ middleware: (...args) => fixture.middleware(...args) })
const profiles = [['summer',1280], ['winter',390], ['spring',900], ['autumn',360], ['winter',1280], ['summer',390]]
try {
  await mkdir(shotDirectory, { recursive: true })
  for (const view of ['admin-users','admin-ai-review-feedback','admin-site-feedback']) {
    for (const [theme,width] of profiles) {
      fixture = createAdminDirectory()
      const { sessionId, targetId } = await chrome.openPage()
      const page = new Page(chrome.client, sessionId)
      const touch = width < 768
      try {
        await page.enable()
        await page.emulate({ width, height: 850, touch, deviceScaleFactor: 1 })
        await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
          'localStorage.setItem("wotb-ui-profile",' + JSON.stringify(theme) + ');localStorage.setItem("wotb-lang","en")' }, sessionId)
        await page.goto(origin + '/?view=' + view + '&ws-auth=1&ws-roles=wotbtools-admin')
        const isUsers = view === 'admin-users'
        await exists(page, isUsers ? userRow : feedbackRow)
        assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), theme)
        if (isUsers && !touch) {
          const boxes = await page.probe(() => Array.from(document.querySelectorAll(
            '.admin-page-prev, .admin-page-next, .admin-page-jump input, .admin-page-go, [data-testid=admin-page-size]'),
            el => { const r = el.getBoundingClientRect(); return [r.top, r.bottom] }))
          assert.equal(boxes.length, 5)
          for (const [top, bottom] of boxes) {
            assert.ok(Math.abs(top - boxes[0][0]) <= 1 && Math.abs(bottom - boxes[0][1]) <= 1,
              'pagination controls must share top and bottom edges: ' + JSON.stringify(boxes))
          }
        }
        await capture(page, view + '-' + theme + '-' + width, isUsers ? '.admin-list-pagination' : feedbackRow)
        if ((theme === 'summer' && width === 1280) || (theme === 'winter' && width === 390)) {
          if (isUsers) await exerciseUsers(page, fixture, touch)
          else await exerciseFeedback(page, fixture, touch)
        }
        assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true)
        console.log('PASS', view, theme, width)
      } catch (error) {
        console.error(view, width, error.message, await page.evaluate('document.activeElement?.outerHTML.slice(0,200)'), fixture.requests.slice(-3))
        process.exitCode = 1
      } finally {
        await chrome.client.send('Target.closeTarget', { targetId })
      }
    }
  }
  const presentationCases = []
  for (const locale of ['en', 'zh', 'ru']) for (const width of [1280, 390]) for (const theme of ['summer', 'winter']) {
    presentationCases.push({ view: 'admin-users', mode: 'footer', locale, width, height: 850, theme })
  }
  for (const [width, height] of [[900,600], [1280,600], [1440,650]]) {
    presentationCases.push({ view: 'admin-users', mode: 'first-row', locale: 'en', width, height, theme: 'winter' })
  }
  for (const view of ['admin-ai-review-feedback', 'admin-site-feedback']) for (const width of [320,390]) {
    presentationCases.push({ view, mode: 'status', locale: 'ru', width, height: 800, theme: 'winter' })
  }
  for (const { view, mode, locale, width, height, theme } of presentationCases) {
    fixture = createAdminDirectory(mode === 'footer' ? 25_001 : 27)
    const { sessionId, targetId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    const name = [view, mode, locale, theme, width, height].join('-')
    try {
      await page.enable()
      await page.emulate({ width, height, touch: width < 768, deviceScaleFactor: 1 })
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
        'localStorage.setItem("wotb-ui-profile",' + JSON.stringify(theme) + ');localStorage.setItem("wotb-lang",' + JSON.stringify(locale) + ')' }, sessionId)
      await page.goto(origin + '/?view=' + view + '&ws-auth=1&ws-roles=wotbtools-admin')
      await exists(page, view === 'admin-users' ? userRow : feedbackRow)
      await page.evaluate('document.fonts.ready')
      assert.equal(await page.evaluate('document.documentElement.lang.split("-")[0]'), locale)
      assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), theme)
      if (mode === 'footer') {
        const summary = await page.evaluate("document.querySelector('.admin-page-info').textContent")
        for (const count of [25001, 1001]) assert.ok(summary.includes(count.toLocaleString(locale)), summary)
        const input = '#admin-jump-page'
        await page.tapSelector(input, width < 768)
        await page.client.send('Input.insertText', { text: '1001' }, sessionId)
        await page.waitForValue('document.querySelector("#admin-jump-page").value', value => value === '1001')
        await capture(page, name, '.admin-pagination')
        const facts = await page.probe(() => {
          const input = document.querySelector('#admin-jump-page')
          const controls = document.querySelector('.admin-list-pagination-controls')
          const groups = [...controls.children]
          const label = input.labels[0]
          return { label: label?.textContent.trim(), inputMax: input.max, inputScroll: input.scrollLeft,
            viewportFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
            groupGap: parseFloat(getComputedStyle(controls).columnGap), innerGap: parseFloat(getComputedStyle(input.parentElement).columnGap),
            fits: groups.every(g => { const b = g.getBoundingClientRect()
              return b.left >= 0 && b.right <= innerWidth + 1 && [...g.children].every(c => { const r = c.getBoundingClientRect()
                return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1 &&
                  c.scrollWidth <= c.clientWidth + 1 }) }) }
        })
        assert.equal(facts.label, { en:'Page', zh:'页码', ru:'Страница' }[locale])
        assert.ok(facts.viewportFits && facts.fits && facts.groupGap > facts.innerGap && facts.inputMax === '1001' && facts.inputScroll === 0, JSON.stringify(facts))
      } else if (mode === 'first-row') {
        await page.animationsSettled()
        const row = await page.callWith(sel => document.querySelector(sel).closest('tr').getBoundingClientRect().toJSON(), userRow)
        assert.ok(row.top >= 0 && row.bottom <= height, JSON.stringify(row))
        const shot = await chrome.client.send('Page.captureScreenshot', { format:'png' }, sessionId)
        await writeFile(resolve(shotDirectory, name + '.png'), Buffer.from(shot.data,'base64'))
      } else {
        const selector = 'tbody tr:first-child [role=radiogroup]'
        await capture(page, name, selector)
        const fits = await page.callWith(sel => {
          const group = document.querySelector(sel), cell = group.closest('td').getBoundingClientRect()
          return cell.left >= -1 && cell.right <= document.documentElement.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && [...group.querySelectorAll('[role=radio]')].every(b => { const r=b.getBoundingClientRect()
            return r.left >= cell.left - 1 && r.right <= cell.right + 1 && b.scrollWidth <= b.clientWidth + 1 })
        }, selector)
        assert.ok(fits, 'Russian status options overflow the feedback card at ' + width)
      }
      console.log('PASS', name)
    } catch (error) {
      console.error('FAIL', name, error.message)
      process.exitCode = 1
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
} finally {
  await chrome.close()
  await server.close()
}
