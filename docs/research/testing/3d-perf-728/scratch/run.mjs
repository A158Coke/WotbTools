// 一次性采集：run.mjs <scenarioId,...|all> <throttle,...> [--profile] [--fixture=x] [--secs=30] [--tag=x]
import { writeFileSync } from 'node:fs'
import { findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
const args = process.argv.slice(2)
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d
const pos = args.filter(a => !a.startsWith('--'))
const PROFILE = args.includes('--profile')
const fixture = flag('fixture', 'random-battle-example')
const SECS = Number(flag('secs', 30))
const tag = flag('tag', '')
// 场景：camera(top|free|follow|recorder) / t0 / armorhl / dynres / q
const SC = {
  'top-mid':        { cam: '固定',   t0: 60,  q: 'mid', armorhl: 0, dynres: 0 },
  'free-mid':       { cam: '自由',   t0: 60,  q: 'mid', armorhl: 0, dynres: 0 },
  'follow-mid':     { cam: 'follow', t0: 60,  q: 'mid', armorhl: 0, dynres: 0 },
  'rec-arcade-a0':  { cam: '录像者', t0: 125, q: 'mid', armorhl: 0, dynres: 0 },
  'rec-arcade-a1':  { cam: '录像者', t0: 125, q: 'mid', armorhl: 1, dynres: 0 },
  'rec-scoped-a0':  { cam: '录像者', t0: 95,  q: 'mid', armorhl: 0, dynres: 0 },
  'rec-scoped-a1':  { cam: '录像者', t0: 95,  q: 'mid', armorhl: 1, dynres: 0 },
  'orbit-mid':      { cam: '固定',   t0: 60,  q: 'mid', armorhl: 0, dynres: 0, drag: 1 },
  'orbit-wheel-mid':{ cam: '自由',   t0: 60,  q: 'mid', armorhl: 0, dynres: 0, drag: 2 },
  'top-ex':         { cam: '固定',   t0: 40,  q: 'mid', armorhl: 0, dynres: 0 },
  'rec-ex':         { cam: '录像者', t0: 40,  q: 'mid', armorhl: 0, dynres: 0 },
  'follow-high':    { cam: 'follow', t0: 60,  q: 'high', armorhl: 0, dynres: 0 },
  'follow-mid-dyn': { cam: 'follow', t0: 60,  q: 'mid', armorhl: 0, dynres: 1 },
}
const ids = pos[0] === 'all' ? Object.keys(SC) : pos[0].split(',')
const throttles = (pos[1] || '1').split(',').map(Number)
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : null }
const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
try {
  for (const id of ids) for (const rate of throttles) {
    const sc = SC[id]
    const name = `${tag}${fixture.split('-')[0]}_${id}_x${rate}${PROFILE ? '_prof' : ''}`
    const page = await openReplay3d(chrome, { fixture, query: `&q=${sc.q}&armorhl=${sc.armorhl}&dynres=${sc.dynres}` })
    const sid = page.sessionId
    await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
    await page.waitForValue('!!window.__pbPerf && window.__pbPerf.snapshot().totalFrames > 30', Boolean, { timeout: 90000, label: 'frames' })
    await delay(5000)
    if (sc.cam === 'follow') await page.evaluate(`document.querySelector('.pb-roster-row').click()`)
    else {
      const find = `Array.from(document.querySelectorAll('.segmented-option')).find(b=>!b.dataset.testid && b.textContent.includes(${JSON.stringify(sc.cam)}))`
      if (!(await page.evaluate(`!!(${find})`))) { await page.evaluate(`document.querySelector('[data-test="pb-secondary-entry"]')?.click()`); await delay(800) }
      await page.evaluate(`(${find}).click()`); await delay(400)
      await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
    }
    await delay(1500)
    const seek = (s) => page.evaluate(`(()=>{const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await seek(sc.t0)
    await chrome.client.send('Emulation.setCPUThrottlingRate', { rate }, sid)
    await delay(6000 * Math.max(1, rate / 2))   // 节流下预热：着色器 / 资源稳定
    await page.evaluate(`(()=>{ window.__raf={ts:[]}; const f=(t)=>{window.__raf.ts.push(t); window.__raf.id=requestAnimationFrame(f)}; window.__raf.id=requestAnimationFrame(f);
      window.__lt=[]; try{ new PerformanceObserver(l=>{for(const e of l.getEntries()) window.__lt.push([e.startTime,e.duration])}).observe({type:'longtask',buffered:false}) }catch(e){} })()`)
    let p0 = 0, pstart = 0
    if (PROFILE) {
      await chrome.client.send('Profiler.enable', {}, sid)
      await chrome.client.send('Profiler.setSamplingInterval', { interval: 500 }, sid)
      await chrome.client.send('Profiler.start', {}, sid)
      p0 = await page.evaluate('performance.now()')
    }
    await page.evaluate(`window.__pbPerf.reset(); window.__pbPerf.startCapture({scenarioId:${JSON.stringify(id + '-x' + rate)}, durationMs:60000})`)
    const wall0 = Date.now()
    if (sc.drag) {
      const box = await page.evaluate(`(()=>{const r=document.querySelector('[data-testid=replay3d-stage] canvas').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()`)
      const send = (p) => chrome.client.send('Input.dispatchMouseEvent', p, sid)
      const end = Date.now() + SECS * 1000; let k = 0
      while (Date.now() < end) {
        const [cx, cy] = box
        if (sc.drag === 2) { await send({ type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: (k % 2 ? 120 : -120) }); await delay(250) }
        await send({ type: 'mouseMoved', x: cx, y: cy })
        await send({ type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 })
        for (let i = 1; i <= 10; i++) { await send({ type: 'mouseMoved', x: cx + i * 15 * (k % 2 ? -1 : 1), y: cy + i * 3, button: 'left', buttons: 1 }); await delay(30) }
        await send({ type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
        k++; await delay(300)
      }
    } else await delay(SECS * 1000)
    const cap = await page.evaluate(`window.__pbPerf.stopCapture()`)
    const snap = await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); return {identity:s.identity, resources:s.resources, armorRt:s.armorRt, gpu:s.gpu, slowest:s.slowest, events:s.events, annotation:s.annotation}})()`)
    let profile = null
    if (PROFILE) { profile = (await chrome.client.send('Profiler.stop', {}, sid)).profile }
    const raf = await page.evaluate('({ts:window.__raf.ts, lt:window.__lt})')
    await page.evaluate('cancelAnimationFrame(window.__raf.id)')
    const iv = raf.ts.slice(1).map((t, i) => t - raf.ts[i])
    const fr = cap.frames
    const stat = { n: iv.length, p50: pct(iv, .5), p95: pct(iv, .95), p99: pct(iv, .99), max: Math.max(...iv), gt33: iv.filter(x => x > 33.4).length, gt50: iv.filter(x => x > 50).length, gt100: iv.filter(x => x > 100).length, gt200: iv.filter(x => x > 200).length, gt400: iv.filter(x => x > 400).length, wallSec: (Date.now() - wall0) / 1000, longtasks: raf.lt.length, longtaskTotalMs: raf.lt.reduce((a, b) => a + b[1], 0), longtaskMax: Math.max(0, ...raf.lt.map(x => x[1])) }
    const frameStat = fr.length ? { n: fr.length, rebuilds: fr[fr.length - 1].terrainRebuilds - fr[0].terrainRebuilds, checks: fr[fr.length - 1].terrainChecks, cpu_p50: pct(fr.map(f => f.cpuFrameMs), .5), cpu_p95: pct(fr.map(f => f.cpuFrameMs), .95), cpu_max: Math.max(...fr.map(f => f.cpuFrameMs)), armorCallFrames: fr.filter(f => f.armorCalls > 0).length, dprMin: Math.min(...fr.map(f => f.dpr)), dprMax: Math.max(...fr.map(f => f.dpr)), tRange: [fr[0].t, fr[fr.length - 1].t] } : null
    const keep = ['t', 'at', 'frameIntervalMs', 'cpuFrameMs', 'tickMs', 'updateMs', 'cameraMs', 'terrainCheckInclusiveMs', 'renderMs', 'armorMs', 'terrainRebuilds', 'terrainChecks', 'dpr', 'gpu_main_ms', 'calls', 'veh']
    const out = { name, fixture, scenario: id, sc, rate, secs: SECS, stat, frameStat, captureStats: cap.statistics, captureEvents: cap.events, captureReason: cap.reason, interrupted: cap.interrupted, identity: snap.identity, resources: snap.resources, gpu: snap.gpu, raf: { ts: raf.ts, lt: raf.lt }, frames: fr.map(f => Object.fromEntries(keep.map(k => [k, f[k]]))) }
    if (profile) out.profile = { p0, startTime: profile.startTime, nodes: profile.nodes, samples: profile.samples, timeDeltas: profile.timeDeltas }
    writeFileSync(`out/${name}.json`, JSON.stringify(out))
    console.log(name, JSON.stringify(stat), JSON.stringify(frameStat), 'camMode', snap.identity.cameraMode, 'errs', page.consoleErrors.length)
    await chrome.client.send('Emulation.setCPUThrottlingRate', { rate: 1 }, sid)
    await chrome.client.send('Target.closeTarget', { targetId: (await chrome.client.send('Target.getTargets')).targetInfos.find(t => t.url.includes('5190'))?.targetId }).catch(() => {})
  }
} finally { await chrome.close() }
