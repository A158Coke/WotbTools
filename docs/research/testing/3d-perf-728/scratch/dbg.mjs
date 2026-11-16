import { findChrome, launchChromeForCdp, delay, ORIGIN, Page, root } from './lib.mjs'
import { resolve } from 'node:path'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const { sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId); await page.enable()
  await page.goto(`${ORIGIN}/?view=replay&perf&assets=&ws-auth=1`)
  await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'input' })
  const { root: r } = await chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await chrome.client.send('DOM.querySelector', { nodeId: r.nodeId, selector: '[data-testid="select-files-input"]' }, sessionId)
  await chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [resolve(root, 'common/fixtures/replays/random-battle-example.wotbreplay')] }, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 90000, label: 'parsed' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="3d"]').click()`)
  await delay(8000); console.log(await page.evaluate("document.querySelector('[data-testid=ws-3d]')?.innerText.slice(0,400)"), page.consoleErrors)
  } finally { await chrome.close() }
