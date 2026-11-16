import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { query: '&q=mid&dynres=0' }); const sid = page.sessionId
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await page.waitForValue('!!window.__pbPerf && window.__pbPerf.snapshot().totalFrames > 30', Boolean, { timeout: 90000 })
  await delay(4000)
  await chrome.client.send('Profiler.enable', {}, sid); await chrome.client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false }, sid); await chrome.client.send('Profiler.takePreciseCoverage', {}, sid)
  const box = await page.evaluate(`(()=>{const r=document.querySelector('[data-testid=replay3d-stage] canvas').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`)
  const send = (p) => chrome.client.send('Input.dispatchMouseEvent', p, sid)
  const [cx, cy] = box
  for (let k = 0; k < 12; k++) {
    await send({ type: 'mouseMoved', x: cx, y: cy }); await send({ type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 20; i++) { await send({ type: 'mouseMoved', x: cx + i * 20 * (k % 2 ? -1 : 1), y: cy + i * 4, button: 'left', buttons: 1 }); await delay(30) }
    await send({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
    await send({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: k % 2 ? 300 : -300 }); await delay(300)
  }
  const cov = await chrome.client.send('Profiler.takePreciseCoverage', {}, sid); const c = {}
  for (const sc of cov.result) for (const fn of sc.functions) if (['maybeRebuildTerrainLod','buildTerrainGeometry','terrainLodStale','driveRecorderCamera','onPointerDown','zoomTick'].includes(fn.functionName) && fn.ranges[0].count) c[fn.functionName] = (c[fn.functionName] || 0) + fn.ranges[0].count
  console.log(JSON.stringify(c), JSON.stringify(await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); return {cam:s.identity.cameraMode, rebuilds:s.latest.terrainRebuilds, checks:s.latest.terrainChecks}})()`)))
} finally { await chrome.close() }
