import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'
import { createHofAdminFixture } from './browser-fixtures/hof-admin-fixture.mjs'

const fixture = createHofAdminFixture()
let reviewBarrier
const { server, origin } = await startFixtureServer({ async middleware(req, res, next) {
  if (reviewBarrier && req.method === 'POST' && req.url.endsWith('/approve')) {
    reviewBarrier.arrived.resolve()
    await reviewBarrier.release.promise
  }
  return fixture.middleware(req, res, next)
} })
const chrome = await launchChromeForCdp(findChrome())
const output = new URL('../../tmp/hof-pending-count/', import.meta.url)
const link = '[data-testid=nav-hof-admin]'
const badge = link + ' [data-testid=hof-pending-badge]'
const summary = '[data-testid=hof-pending-summary]'
const retry = '[data-testid=hof-pending-refresh]'
const counts = () => fixture.requests.filter(r => r.query.status === 'PENDING' && r.query.size === '1')
const present = (page, selector) => page.waitForValue('!!document.querySelector(' + JSON.stringify(selector) + ')', Boolean)
const badgeValue = (page, value) => page.waitForValue('document.querySelector(' + JSON.stringify(badge) + ')?.textContent?.trim() ?? null', actual => actual === value, { label: 'HoF badge ' + value })
async function enter(page) {
  for (const type of ['keyDown', 'keyUp']) {
    await page.client.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, page.sessionId)
  }
}
async function verifyLink(page, total) {
  const result = await page.callWith((s) => {
    const link = document.querySelector(s)
    const badge = link.querySelector('[data-testid=hof-pending-badge]')
    const b = badge.getBoundingClientRect(), l = link.getBoundingClientRect()
    return {
      hit: link.contains(document.elementFromPoint(b.left + b.width/2,b.top + b.height/2)),
      inside: b.left >= l.left - 1 && b.right <= l.right + 1 && b.top >= l.top - 1 && b.bottom <= l.bottom + 1,
      fontSize: parseFloat(getComputedStyle(badge).fontSize),
      name: link.getAttribute('aria-label'), badgeHidden: badge.getAttribute('aria-hidden'),
      nestedControls: link.querySelectorAll('button,a,input,[tabindex="0"]').length,
    }
  }, link)
  assert.ok(result.fontSize >= 12, 'pending count font size: ' + result.fontSize)
  assert.ok(result.hit && result.inside, JSON.stringify(result))
  assert.ok(result.name.includes(String(total)), result.name)
  assert.equal(result.badgeHidden, 'true')
  assert.equal(result.nestedControls, 0)
}

async function runNavigation(page, size) {
  const { width, height, theme, touch, locale } = size
  const drawer = touch
  const tap = sel => page.tapSelector(sel, touch)
  const rail = width === 900
  if (rail) fixture.setPendingCounts(83, 22)
  await page.emulate({ width, height, touch, deviceScaleFactor: 1 })
  await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source:
    'localStorage.setItem("wotb-ui-profile",' + JSON.stringify(theme) + ');localStorage.setItem("wotb-lang",' + JSON.stringify(locale) + ')' }, page.sessionId)
  await page.goto(origin + '/?view=more&ws-auth=1&ws-roles=HoF-admin', { timeout: 240_000 })
  if (drawer) await page.openNavDrawer()
  await badgeValue(page, rail ? '99+' : '12')
  assert.equal(await page.evaluate('document.documentElement.dataset.uiProfile'), theme)
  if (rail) assert.ok(await page.evaluate('!!document.querySelector(".app-sidebar.is-rail")'))
  await page.callWith(s => document.querySelector(s).scrollIntoView({block:'center'}), link)
  await page.animationsSettled()
  await verifyLink(page, rail ? 105 : 12)
  const batched = counts()
  assert.deepEqual(batched.map(r => r.pathname).sort(), ['/api/admin/hof/hundred/submissions','/api/admin/hof/mark3/submissions'])
  for (const call of batched) assert.deepEqual(call.query, {status:'PENDING',page:'1',size:'1'})
  const {data} = await chrome.client.send('Page.captureScreenshot', {format:'png'}, page.sessionId)
  await writeFile(fileURLToPath(new URL(theme+'-'+width+'.png', output)), Buffer.from(data, 'base64'))
  if (drawer) {
    await page.closeNavDrawer()
    await page.waitForValue('document.activeElement?.dataset.testid', value => value === 'nav-menu')
    await page.openNavDrawer()
  }
  if (touch) await tap(badge)
  else {
    await page.callWith(s => document.querySelector(s).focus(), link)
    await enter(page)
  }
  await present(page, '.hof-admin-records, .hof-admin-tabs')
  assert.equal(await page.evaluate('document.querySelector(".hof-admin-tabs [aria-selected=true]") === document.querySelector(".hof-admin-tabs button")'), true)
  await present(page, summary)
  const value = await page.callWith(s => document.querySelector(s).textContent, summary)
  for (const n of (rail ? [83,22] : [7,5])) assert.ok(value.includes(String(n)), value)
  assert.equal(counts().length, 2)
}
async function exerciseStates(page) {
  const tap = sel => page.tapSelector(sel, false)
  fixture.setPendingCounts(83,22)
  await tap(retry)
  await badgeValue(page,'99+')
  await verifyLink(page,105)
  fixture.setPendingCounts(0,0)
  await tap(retry)
  await badgeValue(page,null)
  assert.ok(await page.callWith(s => document.querySelector(s).textContent.includes('0'), summary))
  fixture.setCountFailure('mark3',403)
  await tap(retry)
  await badgeValue(page,'?')
  const rejectedCount = counts().length
  await page.evaluate("window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))")
  assert.equal(counts().length,rejectedCount)
  assert.equal(await page.evaluate('window.__wsAuth.loginCalls.length'),0)
  fixture.setCountFailure('mark3',null)
  fixture.setPendingCounts(7,5)
  const releaseCount = fixture.holdCount('hundred')
  try {
    await tap(retry)
    await badgeValue(page,'…')
  } finally { releaseCount() }
  await badgeValue(page,'12')
  // 百场审核请求在途时离开，消息应由 shell 接收。
  await tap('.hof-admin-tabs button:nth-child(3)')
  await tap('.hof-queue-item [data-testid=hof-queue-open]')
  await tap('.hof-review-decision .ok:not(:disabled)')
  reviewBarrier = {arrived:Promise.withResolvers(), release:Promise.withResolvers()}
  try {
    await tap('.hundred-action-area .ok')
    await Promise.race([reviewBarrier.arrived.promise, reviewTimeout(5000)])
    await tap('.sidebar-brand')
    await page.waitForValue('!document.querySelector(".hof-admin-tabs")',Boolean)
  } finally { reviewBarrier.release.resolve();reviewBarrier=null }
  await badgeValue(page,'11')
  assert.equal(fixture.requests.filter(r=>r.method==='POST').length,1)
}
function reviewTimeout(ms) {
  return new Promise((_, reject) => { const timer=setTimeout(()=>reject(new Error('review request did not reach fixture')),ms);timer.unref() })
}
try {
  await mkdir(output,{recursive:true})
  for (const [width,height,theme,touch,locale] of [[1280,850,'summer',false,'en'],[900,850,'winter',false,'ru'],[390,664,'spring',true,'zh'],[360,740,'autumn',true,'ru'],[844,340,'winter',true,'en']]) {
    fixture.reset()
    const {targetId,sessionId}=await chrome.openPage()
    const page=new Page(chrome.client,sessionId)
    try {
      await page.enable()
      await runNavigation(page,{width,height,theme,touch,locale})
      if(width===1280) await exerciseStates(page)
      console.log('[hof-pending]',width,height,theme,'PASS')
    } catch(error) {
      console.error('[hof-pending]',width,height,error.message, page.consoleErrors.slice(-4), await page.evaluate('document.activeElement?.outerHTML.slice(0,160)'),counts().slice(-2))
      process.exitCode=1
    } finally {await chrome.client.send('Target.closeTarget',{targetId})}
  }
} finally {await chrome.close();await server.close()}
