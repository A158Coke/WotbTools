import { resolve } from 'node:path'
export const root = 'D:/Program/WotbTools/.claude/worktrees/designer-tool-7fb949'
const u = (p) => 'file:///' + root + '/' + p
export const { findChrome, launchChromeForCdp } = await import(u('frontend/scripts/browser-chrome.mjs'))
export const { Page, delay } = await import(u('frontend/scripts/browser-page.mjs'))
export const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:5190'
export async function openReplay3d(chrome, { fixture = 'random-battle-example', query = '', width = Number(process.env.VW||1280), height = Number(process.env.VH||720), dpr = Number(process.env.VDPR||1) } = {}) {
  const { sessionId } = await chrome.openPage()
  const page = new Page(chrome.client, sessionId)
  await page.enable()
  await page.emulate({ width, height, deviceScaleFactor: dpr, touch: false })
  await page.goto(`${ORIGIN}/?view=replay&perf&ws-auth=1${query}`)
  await page.waitFor(() => !!document.querySelector('[data-testid="select-files-input"]'), { label: 'input' })
  if (fixture === 'example') { await page.evaluate(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('打开示例回放')).click()`) } else {
  const { root: r } = await chrome.client.send('DOM.getDocument', {}, sessionId)
  const { nodeId } = await chrome.client.send('DOM.querySelector', { nodeId: r.nodeId, selector: '[data-testid="select-files-input"]' }, sessionId)
  await chrome.client.send('DOM.setFileInputFiles', { nodeId, files: [resolve(root, `common/fixtures/replays/${fixture}.wotbreplay`)] }, sessionId) }
  await page.waitFor(() => !!document.querySelector('[data-testid="data-toolbar"]'), { timeout: 90000, label: 'parsed' })
  await page.evaluate(`document.querySelector('[data-testid="ws-tab"][data-cap="3d"]').click()`)
  await page.waitFor(() => !!document.querySelector('[data-test="replay3d-start"]'), { timeout: 30000, label: 'start btn' }).catch(async e => { console.log(await ids(page), await page.evaluate('document.body.innerText.slice(0,500)')); throw e })
  return page
}
export const ids = (page) => page.evaluate(`Array.from(document.querySelectorAll('[data-testid],[data-test]')).map(e=>(e.dataset.testid||e.dataset.test)).filter((v,i,a)=>a.indexOf(v)===i).join(' ')`)
