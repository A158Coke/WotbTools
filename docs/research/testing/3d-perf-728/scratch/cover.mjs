// 覆盖率计数法：不改源码，用 Profiler.startPreciseCoverage(callCount) 逐秒统计关键函数调用次数，定位开镜 / 准星命中 / armor pass 执行区间
import { writeFileSync } from 'node:fs'
import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const fixture = process.argv[2]; const speed = process.argv[3] || '8'
const WATCH = { fovFromZoomRaw: 'scoped', aimedVehicle: 'pick', armorHighlightBlock: 'target', renderArmorHighlight: 'rah', maybeRebuildTerrainLod: 'terrainCheck', buildTerrainGeometry: 'terrainBuild', stepFovRestore: 'fovRestore' }
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture, query: '&q=mid&armorhl=1&dynres=0' })
  const sid = page.sessionId
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await page.waitForValue('!!window.__pbPerf && window.__pbPerf.snapshot().totalFrames > 30', Boolean, { timeout: 90000, label: 'frames' })
  await delay(4000)
  await page.evaluate(`Array.from(document.querySelectorAll('.segmented-option')).find(b=>b.textContent.trim()=='录像者').click()`); await delay(1500)
  await page.evaluate(`document.querySelector('[data-test="pb-speed-current"]').click()`); await delay(300)
  await page.evaluate(`document.querySelector('[data-test="pb-speed-${speed}"]').click()`); await delay(300)
  const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  const mn = Number(await page.evaluate(`document.querySelector('input.pb-range').min`)), mx = Number(await page.evaluate(`document.querySelector('input.pb-range').max`))
  await seek(mn); await delay(500)
  await chrome.client.send('Profiler.enable', {}, sid)
  await chrome.client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false }, sid)
  await chrome.client.send('Profiler.takePreciseCoverage', {}, sid)
  const rows = []
  const total = (mx - mn) / Number(speed)
  for (let k = 0; k < total + 2; k++) {
    await delay(1000)
    const cov = await chrome.client.send('Profiler.takePreciseCoverage', {}, sid)
    const cnt = {}
    for (const sc of cov.result) for (const fn of sc.functions) if (WATCH[fn.functionName]) { const c = fn.ranges[0].count; if (c) cnt[WATCH[fn.functionName]] = (cnt[WATCH[fn.functionName]] || 0) + c }
    const t = Number(await page.evaluate(`document.querySelector('input.pb-range').value`))
    const s = await page.evaluate(`(()=>{const l=window.__pbPerf.snapshot().latest; return l&&{armorCalls:l.armorCalls, rt:l.armorRtWidth}})()`)
    rows.push({ t, cnt, s })
  }
  writeFileSync(`out/cover_${fixture}.json`, JSON.stringify(rows))
  const tag = (r) => Object.entries(r.cnt).map(([k, v]) => `${k}:${v}`).join(' ')
  let last = ''
  for (const r of rows) { const g = tag(r); if (g.includes('scoped') || g.includes('target') || g.includes('rah') || g.includes('terrainBuild')) console.log(r.t.toFixed(0), g, JSON.stringify(r.s)) }
  console.log('done', fixture, rows.length)
} finally { await chrome.close() }
