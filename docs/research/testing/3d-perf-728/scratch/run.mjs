// 一次性采集：run.mjs <scenarioId,...|all> <throttle,...> [--profile] [--fixture=x] [--secs=30] [--tag=x]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { root, ORIGIN, fixturePath, findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
import { startTimelineTrace, observeSubmissionAndLayout, observeAnchorWrites } from './trace.mjs'
const args = process.argv.slice(2)
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d
const pos = args.filter(a => !a.startsWith('--'))
if (!pos[0]) throw new Error('Usage: node run.mjs <scenario,...|all> <CPU rate,...> [--fixture=example] [--secs=30]')
const perf = !args.includes('--no-perf')
const PROFILE = args.includes('--profile')
const TRACE = args.includes('--trace')
const cpuMetrics = args.includes('--cpu-metrics')
const fixture = flag('fixture', 'random-battle-example')
const replayDigest = createHash('sha256').update(readFileSync(fixturePath(fixture))).digest('hex')
const SECS = Number(flag('secs', 30))
if (!(SECS > 0 && SECS <= 60)) throw new Error('capture duration must be in (0, 60] seconds')
const dataset = process.env.DATASET
const sourceRoot = process.env.BENCH_SOURCE_ROOT || root
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim()
const agent = JSON.parse(readFileSync(resolve(sourceRoot, 'deploy/agent/source.json'), 'utf8'))
const fingerprint = await fetch(new URL('/wasm/' + agent.ref + '/fingerprint.json', ORIGIN))
if (!fingerprint.ok) throw new Error('Cannot verify the served WASM fingerprint')
const wasm = await fingerprint.json()
if (wasm.upstream_commit !== agent.ref || wasm.tag !== agent.artifact.release) throw new Error('WASM fingerprint differs from source')
const trackedPatch = execFileSync('git', ['diff', '--no-ext-diff', 'HEAD', '--', 'frontend/src', 'frontend/package.json', 'frontend/pnpm-lock.yaml'], { cwd: sourceRoot })
const localTrackedPatchSha256 = process.env.BENCH_SOURCE_ROOT || !process.env.ORIGIN
  ? createHash('sha256').update(trackedPatch).digest('hex') : null
mkdirSync('out', { recursive: true })
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
for (const id of ids) {
  for (const rate of throttles) await runScenario(id, rate)
}

async function runScenario(id, rate) {
  const chrome = await launchChromeForCdp(findChrome(), { gpu: true })
  try {
    const { gpu } = await chrome.client.send('SystemInfo.getInfo')
    const { product } = await chrome.client.send('Browser.getVersion')
    const renderer = gpu.auxAttributes.glRenderer
    if (!renderer || /swiftshader|llvmpipe|software|basic render/i.test(renderer)) throw new Error('Hardware GL required: ' + renderer)
    const datasetQuery = dataset ? '&data=' + encodeURIComponent(dataset) : ''
    const sc = SC[id]
    if (!sc) throw new Error('Unknown scenario: ' + id)
    const name = `${tag}${fixture.split('-')[0]}_${id}_x${rate}${PROFILE ? '_prof' : ''}` + (perf ? '' : '_noprobe')
    const page = await openReplay3d(chrome, { fixture, perf, query: `&q=${sc.q}&armorhl=${sc.armorhl}&dynres=${sc.dynres}${datasetQuery}` })
    const sid = page.sessionId
    await page.evaluate(`document.querySelector('[data-test="replay3d-start"]').click()`)
    if (perf) await page.waitForValue('!!window.__pbPerf && window.__pbPerf.snapshot().totalFrames > 30', Boolean, { timeout: 90000, label: 'frames' })
    if (!perf) await page.waitFor(() => !!document.querySelector('.pb-roster-row'), { timeout: 90000, label: 'vehicles' })
    await delay(5000)
    let followTank = null
    if (sc.cam === 'follow') followTank = await page.evaluate(`(()=>{const row=document.querySelector('.pb-roster-row');row.click();return row.querySelector('[data-test=pb-roster-tank]').textContent})()`)
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
    const pre = perf && await page.probe(() => {
      const { sessionId, identity, resources, latest, events } = window.__pbPerf.snapshot()
      const loadingEvents = events.filter(event => event.sessionId === sessionId && event.stage !== 'terrain-build' && event.stage !== 'terrain-rebuild-inclusive')
      return { identity, resources, vehicles: latest?.veh, loadingEvents }
    })
    if (perf && !(pre.resources.textures > 1 && pre.vehicles > 0)) throw new Error('Empty replay scene')
    const expectedCamera = { '录像者': 'recorder', follow: 'follow' }[sc.cam]
    if (perf && expectedCamera && pre.identity.cameraMode !== expectedCamera) throw new Error('Camera mismatch')
    const assets = await page.probe(async () => {
      const entries = performance.getEntriesByType('resource').filter(e => e.responseStatus === 200)
      const terrain = entries.find(e => new URL(e.name).pathname.endsWith('/terrain.u16.bin'))
      const vehicle = entries.find(e => /\/glb\/\d+\/model\.glb$/.test(new URL(e.name).pathname))
      const scenery = entries.find(e => new URL(e.name).pathname.endsWith('/scenery.glb'))
      if (!terrain || !scenery) throw new Error('Expected loaded map assets: ' + entries.filter(e => /terrain|scenery/.test(e.name)).map(e => new URL(e.name).pathname).slice(-15).join(', '))
      const base = terrain.name.slice(0, terrain.name.lastIndexOf('/map/'))
      const version = await fetch(base + '/version.json', {cache:'no-store'})
      if (!version.ok) throw new Error('Cannot verify asset version')
      const { dataset_id, release, content_digest } = await version.json()
      if (!content_digest || !terrain.name.startsWith(base + '/')) throw new Error('Asset identity mismatch')
      return { dataset_id, release, content_digest, vehicleModelLoaded: !!vehicle }
    })
    if ((sc.q === 'high' || sc.q === 'ultra') && !assets.vehicleModelLoaded) throw new Error('High-fidelity vehicle asset missing')
    if (dataset && dataset !== assets.dataset_id) throw new Error('Selected dataset mismatch')
    const playbackSpeed = await page.evaluate("document.querySelector('[data-test=pb-speed-current]').textContent.trim()")
    // A checkout can change after vite build. Also identify the bytes actually served.
    const servedEntry = await page.probe(async () => {
      const script = Array.from(document.scripts).find(s => s.type === 'module' && s.src && new URL(s.src).pathname.startsWith('/assets/'))
      if (!script) return null
      const response = await fetch(script.src)
      if (!response.ok) throw new Error('Cannot verify the production entry module')
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer()))
      return { path: new URL(script.src).pathname, sha256: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') }
    })
    if (perf && !sourceSha.startsWith(pre.identity.buildCommit)) throw new Error('Served build does not match BENCH_SOURCE_ROOT')
    if (perf && pre.identity.replayDigest !== replayDigest) throw new Error('Scene and input file digests differ')
    const viewport = await page.probe(() => {
      const canvas = document.querySelector('[data-testid=replay3d-stage] canvas')
      const rect = canvas.getBoundingClientRect()
      return { window: [innerWidth, innerHeight], stage: [rect.width, rect.height], buffer: [canvas.width, canvas.height], deviceDpr: devicePixelRatio }
    })
    let navigationStartMs
    const saveTrace = TRACE ? await startTimelineTrace(chrome.client) : null
    if (TRACE) await page.probe(observeSubmissionAndLayout)
    if (args.includes('--count-anchors')) await page.probe(observeAnchorWrites)
    if (PROFILE || cpuMetrics) await chrome.client.send('Performance.enable', {}, sid)
    if (PROFILE) {
      const { metrics } = await chrome.client.send('Performance.getMetrics', {}, sid)
      navigationStartMs = metrics.find(m => m.name === 'NavigationStart').value * 1000
      await chrome.client.send('Profiler.enable', {}, sid)
      await chrome.client.send('Profiler.setSamplingInterval', { interval: 500 }, sid)
      await chrome.client.send('Profiler.start', {}, sid)
    }
    await seek(sc.cam === 'follow' ? 66 : sc.t0)
    const readCpuMetrics = async () => Object.fromEntries(
      (await chrome.client.send('Performance.getMetrics', {}, sid)).metrics.map(({ name, value }) => [name, value]),
    )
    const cpuBefore = cpuMetrics ? await readCpuMetrics() : null
    await page.evaluate(`(()=>{
      const duration = ${SECS} * 1000
      window.__pbPerf?.reset()
      window.__pbPerf?.startCapture({ scenarioId: ${JSON.stringify(id + '-x' + rate)}, durationMs: duration })
      const start = ${TRACE} ? performance.mark('pb-benchmark-start').startTime : performance.now()
      const timeline = document.querySelector('input.pb-range')
      window.__raf = { ts: [], start, end: start + duration, timelineStart: Number(timeline.value) }
      function sample(t) {
        if (t >= start + duration) {
          window.__raf.timelineEnd = Number(timeline.value)
          return
        }
        if (t >= start) window.__raf.ts.push(t)
        window.__raf.id = requestAnimationFrame(sample)
      }
      window.__raf.id = requestAnimationFrame(sample)
      window.__lt = []
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.startTime >= start && e.startTime < start + duration) window.__lt.push([e.startTime,e.duration])
      }).observe({type:'longtask',buffered:false})
    })()`)
    const wall0 = Date.now()
    let cpuMid = null
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
    } else if (cpuMetrics && SECS === 60 && args.includes('--split-window')) {
      await delay(30000)
      cpuMid = await readCpuMetrics()
      await delay(Math.max(0, wall0 + 60000 - Date.now()))
    } else await delay(SECS * 1000)
    const cpuAfter = cpuMetrics ? await readCpuMetrics() : null
    const cap = perf && await page.evaluate(`window.__pbPerf.stopCapture()`)
    const snap = perf && await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); return {identity:s.identity, resources:s.resources, armorRt:s.armorRt, gpu:s.gpu, slowest:s.slowest, events:s.events, annotation:s.annotation}})()`)
    let profile = null
    if (PROFILE) { profile = (await chrome.client.send('Profiler.stop', {}, sid)).profile }
    const raf = await page.evaluate("({ts:window.__raf.ts, lt:window.__lt, start:window.__raf.start, timelineStart:window.__raf.timelineStart, timelineEnd:window.__raf.timelineEnd ?? Number(document.querySelector('input.pb-range').value)})")
    if (saveTrace) {
      mkdirSync('out/traces', { recursive: true })
      await saveTrace(`out/traces/${name}.json`)
      raf.nativeCalls = await page.evaluate('window.__pbBenchCalls')
    }
    await page.evaluate('cancelAnimationFrame(window.__raf.id)')
    const iv = raf.ts.slice(1).map((t, i) => t - raf.ts[i])
    const fr = cap?.frames || []
    if (!(raf.timelineEnd > raf.timelineStart)) throw new Error('Replay timeline did not advance')
    if (!iv.length || (perf && (!fr.length || cap.interrupted))) throw new Error('Empty or interrupted capture')
    const countAbove = threshold => iv.filter(value => value > threshold).length
    const ordered = [...iv].sort((a, b) => a - b)
    const nearestRank = Object.fromEntries([50, 90, 95, 99].map(p => ['p' + p, ordered[Math.ceil(p / 100 * ordered.length) - 1]]))
    const stat = {
      n: iv.length, p50: pct(iv, .5), p90: pct(iv, .9), p95: pct(iv, .95), p99: pct(iv, .99), max: Math.max(...iv),
      percentileMethod: 'rounded index p*(n-1), retained for historical comparisons', nearestRank,
      gt33: countAbove(33.4), gt50: countAbove(50), gt100: countAbove(100), gt200: countAbove(200), gt400: countAbove(400),
      wallSec: (Date.now() - wall0) / 1000, observedSec: (raf.ts.at(-1) - raf.ts[0]) / 1000,
      longtasks: raf.lt.length, longtaskTotalMs: raf.lt.reduce((a, b) => a + b[1], 0),
      longtaskMax: Math.max(0, ...raf.lt.map(entry => entry[1])),
    }
    const cpu = fr.map(frame => frame.cpuFrameMs)
    const dpr = fr.map(frame => frame.dpr)
    const frameStat = fr.length ? {
      n: fr.length, rebuilds: fr.at(-1).terrainRebuilds - fr[0].terrainRebuilds, checks: fr.at(-1).terrainChecks,
      cpu_p50: pct(cpu, .5), cpu_p95: pct(cpu, .95), cpu_max: Math.max(...cpu),
      armorCallFrames: fr.filter(f => f.armorCalls > 0).length,
      dprMin: Math.min(...dpr), dprMax: Math.max(...dpr), tRange: [fr[0].t, fr.at(-1).t],
    } : null
    const out = {
      name, fixture, scenario: id, sc, rate, secs: SECS, stat, frameStat, captureStats: cap?.statistics,
      captureEvents: cap?.events, captureDroppedEvents: cap?.droppedEvents,
      loadingEvents: pre?.loadingEvents, captureReason: cap?.reason, interrupted: cap?.interrupted,
      identity: cap?.identity ?? snap?.identity,
      resources: snap?.resources, gpu: snap?.gpu, raf, frames: fr, sourceSha, localTrackedPatchSha256, servedEntry,
      product, renderer, dataset, assets, wasm, viewport, replayDigest, playbackSpeed, perf, followTank, startedAt: cap?.startedAt, stoppedAt: cap?.stoppedAt,
    }
    if (profile) out.profile = { p0: profile.startTime / 1000 - navigationStartMs, startTime: profile.startTime, nodes: profile.nodes, samples: profile.samples, timeDeltas: profile.timeDeltas }
    if (args.includes('--count-anchors')) out.anchorWrites = await page.evaluate('window.__pbBenchAnchorWrites')
    if (cpuBefore && cpuAfter) {
      const names = ['Timestamp', 'TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
      out.chromeMetricDelta = Object.fromEntries(names.map(key => [key, cpuAfter[key] - cpuBefore[key]]))
      if (cpuMid) out.first30MetricDelta = Object.fromEntries(names.map(key => [key, cpuMid[key] - cpuBefore[key]]))
    }
    writeFileSync(`out/${name}.json`, JSON.stringify(out))
    console.log(name, JSON.stringify(stat), JSON.stringify(frameStat), 'camMode', snap?.identity?.cameraMode, 'errs', page.consoleErrors.length)
    await chrome.client.send('Emulation.setCPUThrottlingRate', { rate: 1 }, sid)
    if (args.includes('--verify-labels') || args.includes('--verify-resize')) {
      await page.evaluate("document.querySelector('[data-test=pb-play]').click()")
      for (const time of [66, 95]) {
        if (time === 95 && args.includes('--verify-resize')) {
          await page.emulate({ width: 840, height: 420, deviceScaleFactor: 2, touch: false })
        }
        await seek(time)
        await delay(1000)
        const rows = await page.probe(() => Array.from(document.querySelectorAll('.vehicle-label-anchor'), anchor => ({
          eid: anchor.dataset.eid,
          visible: !anchor.hidden,
          text: anchor.textContent.trim(),
          hpWidth: anchor.querySelector('.pb-hp-fill')?.style.width,
          reload: Array.from(anchor.querySelectorAll('.reload-shell'), el => [el.dataset.state, el.firstElementChild?.style.width]),
        })))
        const contentHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
        const geometry = await page.probe(() => {
          const canvas = document.querySelector('[data-testid=replay3d-stage] canvas')
          return {
            cssSize: [canvas.clientWidth, canvas.clientHeight], bufferSize: [canvas.width, canvas.height],
            anchors: Array.from(document.querySelectorAll('.vehicle-label-anchor:not([hidden])'), el => ({
              eid: el.dataset.eid, transform: el.style.transform,
            })),
          }
        })
        mkdirSync('out/visual', { recursive: true })
        writeFileSync(`out/visual/${name}-${time}s.json`, JSON.stringify({ geometry, contentHash }))
        const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png' }, sid)
        writeFileSync(`out/${name}-${time}s.png`, Buffer.from(data, 'base64'))
        if (!rows.some(row => row.visible)) throw new Error('No projected label visible at ' + time + 's; rows=' + rows.length)
        console.log(time + 's label snapshot', rows.length, contentHash)
      }
    }
  } finally {
    await chrome.close()
  }
}
