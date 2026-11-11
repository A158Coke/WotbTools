// 视觉核对：自由相机快速拉近（滚轮），逐帧截图 + 记录 terrain-build 事件，看换装延迟期间的画面
import { writeFileSync } from 'node:fs'
import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const tag = process.argv[2] || 'after'
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  const page = await openReplay3d(chrome, { fixture: 'example', query: '&q=mid&armorhl=0&dynres=0' })
  const sid = page.sessionId
  await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
  await page.waitForValue('!!window.__pbPerf && window.__pbPerf.snapshot().totalFrames > 30', Boolean, { timeout: 90000 })
  await delay(4000)
  const find = `Array.from(document.querySelectorAll('.segmented-option')).find(b=>!b.dataset.testid && b.textContent.includes('自由'))`
  if (!(await page.evaluate(`!!(${find})`))) { await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]')?.click()`); await delay(800) }
  await page.evaluate(`(${find}).click()`); await delay(400)
  await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
  await delay(2500)
  await page.evaluate(`window.__pbPerf.reset(); window.__pbPerf.startCapture({scenarioId:'visual', durationMs:20000})`)
  const box = await page.evaluate(`(()=>{const r=document.querySelector('[data-testid=replay3d-stage] canvas').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`)
  const send = (p) => chrome.client.send('Input.dispatchMouseEvent', p, sid)
  const shot = async (name) => { const r = await chrome.client.send('Page.captureScreenshot', { format: 'png' }, sid); writeFileSync(`../visual/${tag}_${name}.png`, Buffer.from(r.data, 'base64')) }
  const [cx, cy] = box
  await send({ type: 'mouseMoved', x: cx, y: cy })
  await shot('0_before')
  const t0 = Date.now()
  for (let k = 0; k < 8; k++) { await send({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -240 }); await delay(40) }
  const marks = [0, 150, 350, 650, 1200]
  let i = 1
  for (const m of marks) { const w = m - (Date.now() - t0); if (w > 0) await delay(w); await shot(`${i++}_t${m}ms`) }
  const cap = await page.evaluate(`window.__pbPerf.stopCapture()`)
  const ev = cap.events.filter(e => e.stage === 'terrain-build').map(e => ({ mode: e.mode, reason: e.reason, queueMs: e.queueMs, swapMs: e.swapMs, vertices: e.vertices }))
  console.log(JSON.stringify(ev))
  writeFileSync(`../visual/${tag}_events.json`, JSON.stringify(ev, null, 1))
} finally { await chrome.close() }
