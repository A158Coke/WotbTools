import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Page } from './browser-page.mjs'

const map = '[data-testid=map-filter]'
const sheet = '[data-testid=admin-filter-sheet]'
async function key(page, name, code) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.client.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code }, page.sessionId)
  }
}
export async function verifyBattleFilters(env, fixture, theme, width, directory) {
  const { sessionId, targetId } = await env.chrome.openPage()
  const page = new Page(env.chrome.client, sessionId)
  const touch = width < 768
  const tap = selector => page.tapSelector(selector, touch)
  const present = (selector, expected = true) => page.waitForValue('!!document.querySelector(' + JSON.stringify(selector) + ')', value => value === expected)
  const text = value => page.client.send('Input.insertText', { text: value }, sessionId)
  try {
    const start = fixture.listQueries.length
    await page.enable()
    await page.emulate({ width, height: 850, touch, deviceScaleFactor: 1 })
    await page.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
      'localStorage.setItem("wotb-ui-profile",' + JSON.stringify(theme) + ');localStorage.setItem("wotb-lang","en")' }, sessionId)
    await page.goto(env.origin + '/?view=admin-battle-data&ws-auth=1&ws-roles=wotbtools-admin')
    await present('[data-testid=recent-battles] tbody tr')
    assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), theme)
    if (touch) await tap('[data-testid=filter-toggle]')
    await tap(map)
    await present('#map-filter-list [role=option]')
    assert.ok(await page.evaluate('document.querySelectorAll("#map-filter-list [role=option]").length > 11'))
    if (touch) {
      assert.ok(await page.evaluate('!!document.querySelector("[role=dialog] #map-filter-list")'))
      const last = '#map-filter-list [role=option]:last-child'
      await tap(last)
      await present('#map-filter-list', false)
      await tap(map)
    }
    await mkdir(directory, { recursive: true })
    const { data } = await page.client.send('Page.captureScreenshot', { format: 'png' }, sessionId)
    await writeFile(join(directory, 'filters-' + theme + '-' + width + '.png'), Buffer.from(data, 'base64'))
    await text('no-matching-map')
    await present('.searchable-select [role=status]')
    await key(page, 'Escape', 27)
    await present('#map-filter-list', false)
    if (touch) await present(sheet)
    assert.ok(await page.evaluate('document.activeElement?.id === "map-filter"'))
    await tap(map)
    await text('erlenberg')
    await key(page, 'Enter', 13)
    await present('#map-filter-list', false)
    assert.equal(await page.evaluate('document.querySelector("#map-filter").dataset.value'), 'erlenberg')
    await tap('[data-testid=winner-filter] [data-value="0"]')
    assert.equal(fixture.listQueries.length, start + 1)
    await tap(touch ? '[data-testid=battle-sheet-apply]' : '[data-testid=battle-apply]')
    if (touch) await present(sheet, false)
    assert.equal(fixture.listQueries.length, start + 2)
    assert.equal(fixture.listQueries.at(-1).mapKey, 'erlenberg')
    assert.equal(fixture.listQueries.at(-1).winnerTeam, '0')
    if (touch) {
      await tap('[data-testid=filter-toggle]')
      await tap('[data-testid=version-filter]')
      await text('11.99')
      await key(page, 'Escape', 27)
      await present(sheet, false)
      await tap('[data-testid=filter-chip][data-key=mapKey]')
      assert.equal(fixture.listQueries.length, start + 3)
      const lastQuery = fixture.listQueries.at(-1)
      assert.equal(lastQuery.winnerTeam, '0')
      assert.ok(!('clientVersion' in lastQuery || 'mapKey' in lastQuery))
      await tap('[data-testid=filter-toggle]')
      assert.equal(await page.evaluate('document.querySelector("[data-testid=version-filter]").value'), '11.99')
    }
  } finally {
    await page.client.send('Target.closeTarget', { targetId })
  }
}
