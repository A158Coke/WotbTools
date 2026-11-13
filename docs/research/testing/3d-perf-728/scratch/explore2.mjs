import { findChrome, launchChromeForCdp, openReplay3d, delay, ids } from './lib.mjs'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { query: '&q=mid' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(20000)
  console.log(JSON.stringify(await page.evaluate(`(()=>{const s=window.__pbPerf?.snapshot(); return s&&{identity:s.identity,keys:Object.keys(s)}})()`)))
  console.log(JSON.stringify(await page.evaluate(`Array.from(document.querySelectorAll('[data-testid="replay3d-stage"] ~ * button, .pb-root button, .pb-root input[type=range]')).map(e=>[e.tagName, e.dataset.test||e.dataset.testid||'', e.title||e.getAttribute('aria-label')||e.textContent.trim().slice(0,12), e.className.slice(0,30), e.max||''].join('|'))`)))
  console.log(page.consoleErrors.slice(0,5))
} finally { await chrome.close() }
