import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { Page } from './browser-page.mjs'
import { MOBILE_VIEWPORTS } from './browser-shell-overlays.mjs'

import { createTournamentFixture } from './browser-fixtures/tournament-admin.mjs'

const { middleware, writes, previews, unexpected, reset } = createTournamentFixture()
async function key(page, keyName, code) {
  for (const type of ['keyDown', 'keyUp']) await page.client.send('Input.dispatchKeyEvent', {
    type, key: keyName, code: keyName, windowsVirtualKeyCode: code,
  }, page.sessionId)
}
const eventInput = '[data-testid=event-compact] [role=combobox]'
async function search(page, selector, query, expectedCount, touch) {
  await page.tapSelector(selector + ' ~ button:last-child', touch)
  await page.waitForValue('document.activeElement?.matches(' + JSON.stringify(selector) + ') && document.activeElement.getAttribute("aria-expanded") === "true"', Boolean)
  await key(page, 'Escape', 27)
  await page.tapSelector(selector, touch)
  await key(page, 'ArrowDown', 40)
  const rings = await page.callWith(sel => {
    const input = document.querySelector(sel)
    return { inner: getComputedStyle(input).outlineStyle, group: getComputedStyle(input.closest('.select-field')).outlineStyle }
  }, selector)
  assert.equal(rings.inner, 'none', selector + ' must use the composite focus ring')
  assert.notEqual(rings.group, 'none', selector + ' needs a visible focus ring')
  await page.waitForValue('document.querySelectorAll("[role=listbox] [role=option]").length', count => count === expectedCount)
  await page.client.send('Input.insertText', { text: query }, page.sessionId)
  await page.waitForValue('document.querySelectorAll("[role=listbox] [role=option]").length', count => count === 1)
  await key(page, 'Enter', 13)
  await page.waitForValue('!document.querySelector("[role=listbox]")', Boolean)
}
async function clearDialog(page, touch) {
  await page.tapSelector('[data-testid=tournament-admin-more]', touch)
  await page.tapSelector('[data-testid=tournament-admin-clear]', touch)
  await page.waitForValue('!!document.querySelector("#clear-clan")', Boolean)
}
async function screenshot(page, name) {
  if (!process.env.TOURNAMENT_SCREENSHOTS) return
  await mkdir(process.env.TOURNAMENT_SCREENSHOTS, { recursive: true })
  const shot = await page.client.send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
  await writeFile(join(process.env.TOURNAMENT_SCREENSHOTS, name + '.png'), Buffer.from(shot.data, 'base64'))
}
async function showControl(page, selector, insets) {
  await page.callWith(selector => document.querySelector(selector).scrollIntoView({ block: 'center', inline: 'center' }), selector)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await page.animationsSettled()
  const evidence = await page.callWith((selector, insets) => {
    const control = document.querySelector(selector)
    const r = control.getBoundingClientRect()
    const safe = r.left >= (insets.left || 0) - 1 && r.right <= innerWidth - (insets.right || 0) + 1
      && r.top >= (insets.top || 0) - 1 && r.bottom <= innerHeight - (insets.bottom || 0) + 1
    const hits = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]].map(([x, y]) => {
      const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)
      return control.contains(hit) || hit?.outerHTML.slice(0, 90)
    })
    return { safe, hits, bounds: [r.left, r.top, r.right, r.bottom] }
  }, selector, insets)
  assert.ok(evidence.safe && evidence.hits.every(hit => hit === true), selector + ': ' + JSON.stringify(evidence))
}
async function auditAdmin(page, touch, name) {
  await page.waitForValue('!!document.querySelector("[data-testid=tournament-day-actions]")', Boolean)
  const start = writes.length
  await clearDialog(page, touch)
  await page.callWith(sel => document.querySelector(sel).focus(), '#clear-clan')
  await key(page, 'ArrowDown', 40)
  await screenshot(page, name)
  await key(page, 'Escape', 27)
  await search(page, '#clear-clan', 'clan-12', 12, touch)
  await page.tapSelector('[role=dialog] [data-value=round]', touch)
  await page.tapSelector('[role=dialog] textarea', touch)
  await page.client.send('Input.insertText', { text: 'Fixture adjudication' }, page.sessionId)
  await page.tap({ x: 1, y: 1, touch })
  assert.equal(await page.evaluate('document.querySelector("[role=dialog] textarea")?.value'), 'Fixture adjudication')
  await page.tapSelector('[role=dialog] footer button:first-child', touch)
  await page.waitForValue('!document.querySelector("[role=dialog]")', Boolean)
  assert.equal(writes.length, start)
  await page.waitForValue('document.activeElement?.dataset.testid', id => id === 'tournament-admin-more', { label: 'return focus to More' })
  await clearDialog(page, touch)
  await search(page, '#clear-clan', 'clan-12', 12, touch)
  await page.tapSelector('[role=dialog] [data-value=round]', touch)
  await page.tapSelector('[role=dialog] textarea', touch)
  assert.equal(await page.evaluate('document.activeElement.value'), '', 'a canceled sanction cannot supply the reason for a new one')
  await page.client.send('Input.insertText', { text: 'Fixture adjudication' }, page.sessionId)
  await page.tapSelector('[role=dialog] footer button:last-child', touch)
  await page.waitForValue('!document.querySelector("[role=dialog]")', Boolean)
  assert.deepEqual(writes.slice(start), [{ expectedEventVersion: 3, roundNumber: 1, dayNumber: null,
    clanTag: 'CLAN-12', reason: 'Fixture adjudication', restore: false }])
  await page.tapSelector('[data-testid=tournament-admin-more]', touch)
  await page.tapSelector('[data-testid=tournament-admin-csv]', touch)
  const before = previews.length
  await page.callWith(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['Clan,R1D1,R1D2,R2D1,R2D2,R3D1,R3D2,R4D1,R4D2\nCLAN-12,1,2,3,4,5,6,7,8'], 'scores.csv', { type: 'text/csv' }))
    const input = document.querySelector('[data-testid=csv-file]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.equal(previews.length, before)
  await page.tapSelector('[data-testid=csv-preview]', touch)
  await page.tapSelector('[data-testid=csv-publish]', touch)
  await page.tapSelector('[data-testid=csv-cancel]', touch)
  assert.deepEqual(previews.slice(before), [{ file: 'scores.csv', expectedEventVersion: '3' }])
  assert.equal(writes.length, start + 1)
  await page.tapSelector('[data-testid=csv-publish]', touch)
  await page.tapSelector('[data-testid=csv-confirm]', touch)
  await page.waitForValue('!document.querySelector("[role=dialog]")', Boolean)
  assert.equal(writes.length, start + 2)
  const publication = writes.at(-1)
  assert.equal(publication.file, 'scores.csv')
  assert.equal(publication.confirm, 'true')
  assert.equal(publication.expectedEventVersion, '3')
  assert.match(publication.sourceSha256, /^[a-f0-9]{64}$/)
  assert.ok(publication.idempotencyKey)
}
async function auditConfig(page, touch, name) {
  const test = id => '[data-testid=' + id + ']'
  await page.waitForValue('!!document.querySelector("[data-testid=rule-1-1]")', Boolean)
  const fields = await page.probe(() => {
    const rect = id => document.querySelector('[data-testid=' + id + ']').getBoundingClientRect()
    const year = rect('config-year'), season = rect('config-season'), region = rect('config-region')
    const grid = document.querySelector('.tournament-config-fields').getBoundingClientRect()
    const labelGap = id => {
      const control = document.querySelector('[data-testid=' + id + ']')
      return control.getBoundingClientRect().top - control.previousElementSibling.getBoundingClientRect().bottom
    }
    return { gapDiff: Math.abs(labelGap('config-year') - labelGap('config-season')), heightDiff: Math.abs(year.height - season.height), regionWidth: region.width, gridWidth: grid.width,
      afterYear: region.top >= year.bottom, afterSeason: region.top >= season.bottom }
  })
  assert.ok(fields.gapDiff <= 1 && fields.heightDiff <= 1 && fields.afterYear && fields.afterSeason && Math.abs(fields.regionWidth - fields.gridWidth) <= 1, JSON.stringify(fields))
  await page.callWith(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), '[data-testid=config-region]')
  await screenshot(page, name)
  const start = writes.length
  await page.tapSelector(test('default-rules-switch'), touch)
  await page.tapSelector(test('cancel-default-rules'), touch)
  await page.waitForValue('!document.querySelector("[role=dialog]")', Boolean)
  await page.waitForValue('document.activeElement?.dataset.testid', id => id === 'default-rules-switch', { label: 'default confirmation restores its trigger' })
  assert.equal(writes.length, start)
  await page.tapSelector(test('rules-round-2'), touch)
  assert.ok(await page.evaluate('document.querySelector("[data-testid=rule-1-1]").disabled'))
  await page.tapSelector(test('rules-round-1'), touch)
  await page.tapSelector(test('rule-1-1'), touch)
  await page.evaluate('document.activeElement.select()')
  await page.client.send('Input.insertText', { text: '7' }, page.sessionId)
  assert.equal(await page.evaluate('document.querySelector("[data-testid=default-rules-switch]").disabled'), true)
  assert.equal(writes.length, start)
  await page.tapSelector(test('save-round-rules'), touch)
  await page.waitForValue('document.querySelector("[data-testid=default-rules-switch]")?.disabled', value => value === false)
  assert.equal(writes.length, start + 1)
  assert.equal(writes.at(-1).expectedEventVersion, 3)
  assert.equal(writes.at(-1).expectedRulesVersion, 2)
  assert.equal(writes.at(-1).days[0].points[0].points, 7)
  await page.tapSelector(test('default-rules-switch'), touch)
  await page.tapSelector(test('confirm-default-rules'), touch)
  await page.waitForValue('document.querySelector("[data-testid=default-rules-switch]")?.getAttribute("aria-checked")', value => value === 'true')
  await page.waitForValue('document.activeElement?.dataset.testid', id => id === 'default-rules-switch', { label: 'confirmed default restores focus after refresh' })
  assert.deepEqual(writes.slice(start + 1), [{ eventId: 1, expectedEventVersion: 3, expectedDefaultVersion: 4, confirm: true }])
  await page.tapSelector('.tournament-event-form button.is-danger', touch)
  await page.tapSelector('[role=dialog] footer button:first-child', touch)
  assert.equal(writes.length, start + 2)
}
const { server, origin } = await startFixtureServer({ middleware })
let chrome
try {
  chrome = await launchChromeForCdp(findChrome())
  const layouts = [
    { id: 'desktop', width: 1280, height: 850, profile: 'summer', touch: false },
    { id: 'phone', width: 390, height: 850, profile: 'winter', touch: true },
    { id: 'desktop-winter', width: 1280, height: 850, profile: 'winter', touch: false },
    { id: 'phone-summer', width: 390, height: 850, profile: 'summer', touch: true },
    { id: 'ru-desktop-summer', width: 1280, height: 850, profile: 'summer', touch: false, locale: 'ru' },
    { id: 'ru-phone-winter', width: 390, height: 850, profile: 'winter', touch: true, locale: 'ru' },
    { id: 'ru-desktop', width: 1280, height: 850, profile: 'winter', touch: false, locale: 'ru' },
    { id: 'ru-phone', width: 390, height: 850, profile: 'summer', touch: true, locale: 'ru' },
    { id: 'tablet', width: 900, height: 850, profile: 'spring', touch: false },
    ...MOBILE_VIEWPORTS.map((size, i) => ({
      ...size, profile: ['autumn', 'spring', 'winter', 'autumn', 'winter'][i],
      locale: ['en', 'zh', 'en', 'ru', 'en'][i], touch: true,
    })),
  ]
  const requested = new Set(process.argv.slice(2))
  const selected = requested.size ? layouts.filter(size => requested.has(size.id)) : layouts
  if (requested.size) assert.equal(selected.length, requested.size, 'unknown viewport')
  for (const { width, height, profile, touch, insets, locale = 'en' } of selected) {
    const { sessionId, targetId } = await chrome.openPage()
    const page = new Page(chrome.client, sessionId)
    try {
      await page.enable()
      await page.emulate({ width, height, touch, deviceScaleFactor: 1 })
      if (insets) await chrome.client.send('Emulation.setSafeAreaInsetsOverride', { insets }, sessionId)
      await page.goto(origin)
      await page.callWith((p, l) => { localStorage.setItem('wotb-ui-profile', p); localStorage.setItem('wotb-lang', l) }, profile, locale)
      for (const view of ['tournament-points-admin', 'tournament-points-config']) {
        reset()
        const admin = view.endsWith('admin')
        const name = view + '-' + width + 'x' + height + '-' + profile + '-' + locale
        await page.goto(origin + '/?view=' + view + '&ws-roles=tournament-admin')
        await page.waitForValue('!!document.querySelector("[data-testid=event-compact] input:not(:disabled)")', Boolean)
        assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), profile)
        assert.equal(await page.evaluate('document.documentElement.lang.split("-")[0]'), locale)
        await search(page, eventInput, '2026', admin ? 13 : 14, touch)
        if (insets) {
          const controls = admin ? '[data-testid^=match-day-]' : '.tournament-rule-matrix input'
          await page.waitForValue('document.querySelectorAll(' + JSON.stringify(controls) + ').length', n => n === (admin ? 8 : 10))
          for (const id of await page.callWith(s => [...document.querySelectorAll(s)].map(node => node.dataset.testid), controls)) {
            await showControl(page, '[data-testid="' + id + '"]', insets)
          }
        }
        if (admin) await auditAdmin(page, touch, name)
        else await auditConfig(page, touch, name)
        assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, name + ' overflow')
        console.log('[browser-tournament-admin]', name, 'OK')
      }
    } catch (error) {
      console.error(await page.evaluate('({ active:document.activeElement?.outerHTML?.slice(0,220), status:document.querySelector("[role=status]")?.textContent, dialog:document.querySelector("[role=dialog]")?.textContent?.slice(0,220) })'))
      throw error
    } finally { await chrome.client.send('Target.closeTarget', { targetId }) }
  }
  assert.deepEqual(unexpected, [])
} finally {
  if (chrome) await chrome.close()
  await server.close()
}
