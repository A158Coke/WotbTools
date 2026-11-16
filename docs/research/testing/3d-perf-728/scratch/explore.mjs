import { resolve } from 'node:path'
const root = 'D:/Program/WotbTools/.claude/worktrees/designer-tool-7fb949'
const { findChrome, launchChromeForCdp } = await import('file:///' + root + '/frontend/scripts/browser-chrome.mjs')
const { Page, delay } = await import('file:///' + root + '/frontend/scripts/browser-page.mjs')
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const { sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  await page.enable()
  await page.emulate({ width: 1280, height: 720, deviceScaleFactor: 1, touch: false })
  await page.goto('http://127.0.0.1:5190/?view=replay&perf&assets=&ws-auth=1')
  await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'input' })
  const { root: r } = await chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await chrome.client.send('DOM.querySelector', { nodeId: r.nodeId, selector: '[data-testid="select-files-input"]' }, sessionId)
  await chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [resolve(root, 'common/fixtures/replays/random-battle-example.wotbreplay')] }, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 90000, label: 'parsed' }); console.log(page.consoleErrors.slice(0,8)); console.log(await page.evaluate(`Array.from(document.querySelectorAll('[data-testid]')).map(e=>e.dataset.testid).join(' ')`))
  console.log('tabs', await page.evaluate(`Array.from(document.querySelectorAll('[data-testid="ws-tab"]')).map(e=>e.dataset.cap+':'+e.disabled+':'+e.textContent.trim())`))
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="3d"]')?.click()`)
  await delay(3000)
  console.log(await page.evaluate(`Array.from(document.querySelectorAll('[data-testid],[data-test]')).map(e=>(e.dataset.testid||e.dataset.test)).filter((v,i,a)=>a.indexOf(v)===i).join(' ')`))
  console.log(page.consoleErrors.slice(0,5))
} finally { await chrome.close() }
