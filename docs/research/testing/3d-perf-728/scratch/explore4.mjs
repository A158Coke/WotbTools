import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const fixture = process.argv[2]
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture, query: '&q=mid&armorhl=1' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(10000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(2000)
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  console.log(await page.evaluate(`document.querySelector('input.pb-range').min+' '+document.querySelector('input.pb-range').max+' '+(document.querySelector('[data-testid=recorder-reticle]')?.outerHTML.slice(0,300))`))
  let last=''
  const max = Number(await page.evaluate(`document.querySelector('input.pb-range').max`))
  for (let t = 0; t < max; t += 4) { await seek(t); await delay(500); const r = await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); const rt=document.querySelector('[data-testid=recorder-reticle]'); return ""+'|'+ (s.latest&&s.latest.armorCalls)+'|'+(s.latest&&s.latest.armorPick)})()`); if (r!==last) console.log(t, r); last=r }
} finally { await chrome.close() }
