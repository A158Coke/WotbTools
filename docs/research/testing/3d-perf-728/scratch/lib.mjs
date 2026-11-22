import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Page } from '../../../../../frontend/scripts/browser-page.mjs'
export { Page, delay } from '../../../../../frontend/scripts/browser-page.mjs'
export { findChrome, launchChromeForCdp } from '../../../../../frontend/scripts/browser-chrome.mjs'
export const root = fileURLToPath(new URL('../../../../../', import.meta.url))
export function fixturePath(fixture) {
  return resolve(root, fixture === 'example' ? 'common/assets/onboarding/replay-2.wotbreplay' : `common/fixtures/replays/${fixture}.wotbreplay`)
}
export const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5190'
export async function openReplay3d(chrome, { fixture = 'random-battle-example', query = '', perf = true, observeNetwork, width = Number(process.env.VW||1280), height = Number(process.env.VH||720), dpr = Number(process.env.VDPR||1) } = {}) {
  const { sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  await page.enable()
  if (observeNetwork) await observeNetwork(sessionId)
  await page.emulate({ width, height, deviceScaleFactor: dpr, touch: false })
  await chrome.client.send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(4000)' }, sessionId)
  await page.goto(`${ORIGIN}/?view=replay&ws-auth=1${perf ? '&perf' : ''}${query}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'input' })
  const { root: r } = await chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await chrome.client.send('DOM.querySelector', { nodeId: r.nodeId, selector: '[data-testid="select-files-input"]' }, sessionId)
  await chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [fixturePath(fixture)] }, sessionId)
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 90000, label: 'parsed' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="3d"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { timeout: 30000, label: 'start btn' }).catch(async e => { console.log(await ids(page), await page.evaluate('document.body.innerText.slice(0,500)')); throw e })
  return page
}
export const ids = (page) => page.evaluate(`Array.from(document.querySelectorAll('[data-testid],[data-test]')).map(e=>(e.dataset.testid||e.dataset.test)).filter((v,i,a)=>a.indexOf(v)===i).join(' ')`)
