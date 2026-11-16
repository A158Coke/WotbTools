import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const fixture = process.argv[2]
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture, query: '&q=mid&armorhl=1' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(8000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(1500)
  await page.evaluate(`document.querySelector('[data-test="pb-play"]').click()`)  // pause
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  const mn = Number(await page.evaluate(`document.querySelector('input.pb-range').min`)), mx = Number(await page.evaluate(`document.querySelector('input.pb-range').max`))
  const out = []
  for (let t = mn; t < mx; t += 2) { await seek(t); await delay(350); out.push([Math.round(t), await page.evaluate(`(()=>{const c=document.querySelector('.reticle-halo'); const g=document.querySelector('.recorder-reticle'); return c? Math.round(Number(c.getAttribute('r'))):-1})()`)]) }
  console.log(fixture, out.map(x=>x.join(':')).join(' '))
} finally { await chrome.close() }
