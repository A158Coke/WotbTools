// 扫描回放时间轴上的幽灵名牌（lastKnownOn）分布，用于 R7 选片段。
// 用法：node scan-ghosts.mjs [fixture] [stepSecs]
import { ORIGIN, findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const fixture = process.argv[2] || 'random-battle-example'
const step = Number(process.argv[3] || 5)
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const { gpu } = await chrome.client.send('SystemInfo.getInfo')
  const renderer = gpu.auxAttributes.glRenderer
  if (!renderer || /swiftshader|llvmpipe|software|basic render/i.test(renderer)) throw new Error('Hardware GL required: ' + renderer)
  const page = await openReplay3d(chrome, { fixture, perf: false, query: '&q=mid&armorhl=0&dynres=0' })
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await page.waitFor(() => !!document.querySelector('.pb-roster-row'), { timeout: 90000, label: 'vehicles' })
  await delay(4000)
  await page.evaluate(`document.querySelector('[data-testid="display-toggle"]')?.click()`)
  await page.waitFor(() => !!document.querySelector('[data-testid="disp-last-known"]'), { timeout: 5000, label: 'last-known toggle' })
  if (!(await page.probe(() => document.querySelector('[data-testid="disp-last-known"]').checked))) {
    await page.evaluate(`document.querySelector('[data-testid="disp-last-known"]').click()`)
  }
  await delay(200)
  if (!(await page.probe(() => document.querySelector('[data-testid="disp-last-known"]').checked))) throw new Error('lastKnownOn did not stay on')
  await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
  const bounds = await page.probe(() => { const r = document.querySelector('input.pb-range'); return { min: Number(r.min), max: Number(r.max), value: Number(r.value) } })
  console.log('timeline', JSON.stringify(bounds), 'fixture', fixture, 'step', step)
  let hits = 0
  for (let t = Math.ceil(bounds.min); t <= bounds.max; t += step) {
    await page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${t}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await delay(400)
    const sample = await page.probe(() => {
      const anchors = Array.from(document.querySelectorAll('.vehicle-label-anchor:not([hidden])'))
      const ghosts = anchors.filter(a => a.querySelector('.label-last-known'))
      return {
        t: Number(document.querySelector('input.pb-range').value),
        anchors: anchors.length,
        ghosts: ghosts.length,
        names: ghosts.slice(0, 4).map(a => a.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)),
      }
    })
    if (sample.ghosts > 0) { hits++; console.log('HIT', JSON.stringify(sample)) }
    else if (sample.t % 30 < step) console.log('scan', sample.t, 'anchors', sample.anchors)
  }
  console.log('ghost hits', hits, 'windows scanned', Math.floor((bounds.max - bounds.min) / step) + 1)
} finally {
  await chrome.close()
}
