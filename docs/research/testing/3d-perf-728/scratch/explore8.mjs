import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const [fixture, t0, secs] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])]
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture, query: '&q=mid&armorhl=1' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(8000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(1500)
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await seek(t0); await delay(500)
  await page.evaluate(`window.__pbPerf.reset(); window.__pbPerf.startCapture({scenarioId:'scan', durationMs:60000})`)
  await delay(secs*1000)
  const cap = await page.evaluate(`window.__pbPerf.stopCapture()`)
  const fr = cap.frames
  const hit = fr.filter(f => f.armorCalls > 0)
  console.log('frames', fr.length, 'armor frames', hit.length, 'picks>0', fr.filter(f=>f.armorPick>0).length, 't range', fr[0].t, fr[fr.length-1].t)
  console.log(JSON.stringify(hit.slice(0,3)))
  console.log(JSON.stringify(cap.statistics.frameIntervalMs))
} finally { await chrome.close() }
