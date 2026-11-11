import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { query: '&q=mid&armorhl=1' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(10000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(3000)
  console.log(JSON.stringify(await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); return {id:s.identity.armorhl, latest:s.latest, stat:Object.keys(s.statistics), arm:s.armorRt}})()`)).slice(0,1800))
} finally { await chrome.close() }
