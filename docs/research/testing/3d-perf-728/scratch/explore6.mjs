import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const fixture = process.argv[2]
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture, query: '&q=mid&armorhl=1' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(8000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(1500)
  await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]').click()`); await delay(300)
  console.log(await page.evaluate(`Array.from(document.querySelectorAll('.pb-speed-item')).map(e=>e.dataset.test).join(' ')`))
  const opts = await page.evaluate(`Array.from(document.querySelectorAll('.pb-speed-item')).map(e=>e.dataset.test)`)
  await page.evaluate(`document.querySelector('[data-test="${opts[opts.length-1]}"]').click()`); await delay(300)
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await seek(0); await delay(500)
  await page.evaluate(`window.__pbPerf.reset(); window.__pbPerf.startCapture({scenarioId:'scan', durationMs:60000})`)
  const dur = await page.evaluate(`document.querySelector('input.pb-range').max - document.querySelector('input.pb-range').min`)
  await delay(Math.min(58000, dur/8*1000 + 3000))
  const cap = await page.evaluate(`window.__pbPerf.stopCapture()`)
  console.log(Object.keys(cap), Object.keys(cap.frames?.[0]||cap.samples?.[0]||{}).slice(0,50).join(','))
  const fr = cap.frames || cap.samples || []
  const hit = fr.filter(f => f.armorPick > 0 || f.armorCalls > 0)
  console.log('frames', fr.length, 'armor frames', hit.length, hit.length ? `${hit[0].t}..${hit[hit.length-1].t}` : '')
  console.log(JSON.stringify(cap.statistics?.frameIntervalMs))
} finally { await chrome.close() }
