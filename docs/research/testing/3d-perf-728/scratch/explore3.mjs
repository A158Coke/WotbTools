import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { query: '&q=mid&armorhl=1' })
  console.log(await page.evaluate(`(()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return [g.getParameter(g.RENDERER),e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL),e&&g.getParameter(e.UNMASKED_VENDOR_WEBGL), navigator.userAgent, navigator.hardwareConcurrency]})()`))
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await delay(12000)
  const clickText = (t) => page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()==${JSON.stringify(t)}).click()`)
  await clickText('录像者'); await delay(3000)
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); return r.value})()`)
  const probe = () => page.evaluate(`(()=>{const rt=document.querySelector('[data-testid=recorder-reticle]'); const s=window.__pbPerf.snapshot(); return {ret: rt && (getComputedStyle(rt).display+'/'+getComputedStyle(rt).visibility+'/'+rt.className+'/'+rt.getBoundingClientRect().width), cam:s.identity.cameraMode, armorCalls:s.latest&&s.latest.armorCalls, pick:s.latest&&s.latest.armorPick, t:document.querySelector('input.pb-range').value}})()`)
  for (let t = 0; t <= 300; t += 15) { await seek(t); await delay(1500); console.log(t, JSON.stringify(await probe())) }
  console.log(page.consoleErrors.slice(0,3))
} finally { await chrome.close() }
