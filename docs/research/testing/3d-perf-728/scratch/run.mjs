// 一次性采集：run.mjs <scenarioId,...|all> <throttle,...> --run-id=x [--profile] [--fixture=x] [--secs=30] [--tag=x]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { root, ORIGIN, fixturePath, findChrome, launchChromeForCdp, openReplay3d, delay } from './lib.mjs'
import { startTimelineTrace, observeSubmissionAndLayout, observeAnchorWrites } from './trace.mjs'
import { captureName, capturePolicy, sampleRenderedStage, verifySceneResources, verifyScoredEntry, verifyScoredFrames, verifyScoredScene } from './capture-policy.mjs'
const args = process.argv.slice(2)
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d
const pos = args.filter(a => !a.startsWith('--'))
if (!pos[0]) throw new Error('Usage: node run.mjs <scenario,...|all> <CPU rate,...> --run-id=x [--fixture=example] [--secs=30]')
const perf = !args.includes('--no-perf')
const LAST_KNOWN = flag('last-known', null)
if (LAST_KNOWN !== null && !['on', 'off'].includes(LAST_KNOWN)) throw new Error('--last-known must be on or off')
const PROFILE = args.includes('--profile')
const TRACE = args.includes('--trace')
const cpuMetrics = args.includes('--cpu-metrics')
const fixture = flag('fixture', 'random-battle-example')
const SECS = Number(flag('secs', 30))
if (!(SECS > 0 && SECS <= 60)) throw new Error('capture duration must be in (0, 60] seconds')
const policy = capturePolicy(args, SECS)
const windowSize = { width: Number(process.env.VW || 1280), height: Number(process.env.VH || 720), dpr: Number(process.env.VDPR || 1) }
const replayDigest = createHash('sha256').update(readFileSync(fixturePath(fixture))).digest('hex')
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
  // R7 幽灵片段：random-battle-example 在 150–170s 有 3 个 lastKnown 幽灵名牌入镜。
  'top-mid-ghost':  { cam: '固定',   t0: 150, q: 'mid', armorhl: 0, dynres: 0 },
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
    const name = captureName({ tag, fixture, scenario: id, rate, ...policy, viewport: windowSize })
    const urls = []
    const observeNetwork = async sessionId => {
      chrome.client.on('Network.responseReceived', ({ response }, session) => {
        if (session === sessionId && response.status === 200) urls.push(response.url)
      })
      await chrome.client.send('Network.enable', {}, sessionId)
    }
    const page = await openReplay3d(chrome, { fixture, perf, observeNetwork, query: `&q=${sc.q}&armorhl=${sc.armorhl}&dynres=${sc.dynres}${datasetQuery}` })
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
    // R7：每轮显式设置 lastKnownOn 并核实实际开关状态，不继承 localStorage 偏好。
    if (LAST_KNOWN !== null) {
      await page.evaluate(`document.querySelector('[data-testid="display-toggle"]')?.click()`)
      await page.waitFor(() => !!document.querySelector('[data-testid="disp-last-known"]'), { timeout: 5000, label: 'last-known toggle' })
      const want = LAST_KNOWN === 'on'
      const read = () => page.probe(() => document.querySelector('[data-testid="disp-last-known"]')?.checked ?? null)
      if ((await read()) !== want) await page.evaluate(`document.querySelector('[data-testid="disp-last-known"]').click()`)
      await delay(200)
      const got = await read()
      if (got !== want) throw new Error(`lastKnownOn did not apply: wanted ${want}, got ${got}`)
      await page.evaluate(`document.querySelector('[data-testid="display-close"]')?.click()`)
      await delay(300)
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
    const expectedCamera = { '固定': 'top', '自由': 'free', '录像者': 'recorder', follow: 'follow' }[sc.cam]
    if (perf && expectedCamera && pre.identity.cameraMode !== expectedCamera) throw new Error('Camera mismatch')
    if (!process.env.BENCH_ASSET_ROOT) throw new Error('BENCH_ASSET_ROOT is required to verify the served dataset')
    const expectedRoot = new URL(process.env.BENCH_ASSET_ROOT).href.replace(/\/$/, '')
    await chrome.client.send('Network.disable', {}, sid)
    const versionResponse = await fetch(expectedRoot + '/version.json', { cache: 'no-store' })
    if (!versionResponse.ok) throw new Error('Cannot verify expected dataset version')
    const { dataset_id, release, content_digest } = await versionResponse.json()
    // The selected dataset is the actual asset configuration; when the harness pins one,
    // version.json must agree. Every terrain/scenery/vehicle URL must sit under this root.
    if (dataset && dataset !== dataset_id) throw new Error('Selected dataset differs from the served asset version')
    const assets = { dataset_id, release, content_digest }
    assets.sources = verifySceneResources(urls, expectedRoot, assets, dataset || dataset_id, ['high', 'ultra'].includes(sc.q))
    assets.vehicleModelLoaded = assets.sources.vehicles.length > 0
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
    if (!perf) verifyScoredEntry(servedEntry, process.env.BENCH_ENTRY_SHA256)
    if (perf && !sourceSha.startsWith(pre.identity.buildCommit)) throw new Error('Served build does not match BENCH_SOURCE_ROOT')
    if (perf && pre.identity.replayDigest !== replayDigest) throw new Error(`Scene and input file digests differ: ${pre.identity.replayDigest} != ${replayDigest}; events=${JSON.stringify(pre.loadingEvents.map(e => [e.stage, e.digest ?? e.status ?? '']))}`)
    const viewport = await page.probe(() => {
      const canvas = document.querySelector('[data-testid=replay3d-stage] canvas')
      const rect = canvas.getBoundingClientRect()
      return { window: [innerWidth, innerHeight], stage: [rect.width, rect.height], buffer: [canvas.width, canvas.height], deviceDpr: devicePixelRatio }
    })
    // Score runs get their scene facts from CDP/DOM/WebGL only: ?perf and the native
    // probe hooks stay disabled, but a missing production entry or a dead scene is fatal.
    let scoredScene = null
    if (!perf) {
      // DOM.getFileInputFiles is no longer exposed by this Chrome, and FileDrop clears
      // input.value after change. The new-document audit hashes the File bytes instead.
      await page.waitForValue(
        'window.__pbInputAudit && (window.__pbInputAudit.sha256 || window.__pbInputAudit.error)',
        Boolean,
        { timeout: 30000, label: 'input byte audit' },
      )
      const inputAudit = await page.probe(() => ({ ...window.__pbInputAudit }))
      scoredScene = await page.probe(() => {
        const stage = document.querySelector('[data-testid=replay3d-stage]')
        const canvas = stage?.querySelector('canvas')
        const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'))
        return {
          url: location.href,
          perfHandle: !!window.__pbPerf,
          camera: stage?.dataset.camera ?? null,
          followed: !!document.querySelector('.pb-roster-row.followed'),
          quality: stage?.dataset.quality ?? null,
          canvas: canvas ? { width: canvas.width, height: canvas.height, webgl: !!gl && !gl.isContextLost() } : null,
        }
      })
      verifyScoredScene({ ...scoredScene, inputSha256: inputAudit.sha256, expectedInputSha256: replayDigest, expectedCamera, expectedQuality: sc.q })
      scoredScene.input = inputAudit
    }
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
    const stageBefore = !perf && await page.probe(sampleRenderedStage)
    const cpuBefore = cpuMetrics ? await readCpuMetrics() : null
    // Score runs prove continuous drawing with the canvas's own WebGL pixels, not page
    // compositor frames or a page-side rAF/UI clock: HUD-only updates must not make a
    // frozen 3D scene look alive. Four 720x16 strips are read back through a PBO every 1.5 s.
    const wall0 = Date.now()
    await page.evaluate(`(()=>{
      const duration = ${SECS} * 1000
      const scoreMode = ${JSON.stringify(!perf)}
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
      window.__ghost = { samples: [], maxGhosts: 0, maxAnchors: 0 }
      const ghostSample = () => {
        const anchors = Array.from(document.querySelectorAll('.vehicle-label-anchor:not([hidden])'))
        const ghosts = anchors.filter(a => a.querySelector('.label-last-known')).length
        window.__ghost.samples.push({ at: performance.now() - start, replayT: Number(timeline.value), anchors: anchors.length, ghosts })
        window.__ghost.maxGhosts = Math.max(window.__ghost.maxGhosts, ghosts)
        window.__ghost.maxAnchors = Math.max(window.__ghost.maxAnchors, anchors.length)
      }
      ghostSample()
      window.__ghost.timer = setInterval(ghostSample, 250)
      window.__canvasProbe = null
      // 评分模式才安装 PBO 探针；诊断模式不得为此多一次 bufferData 或 GPU 回读。
      if (scoreMode) {
      window.__canvasProbe = { frames: [], error: null, stopped: false, cpuMs: 0, samples: 0, maxCpuMs: 0 }
      const probeCanvas = document.querySelector('[data-testid=replay3d-stage] canvas')
      const probeGl = probeCanvas && probeCanvas.getContext('webgl2')
      if (!probeCanvas || !probeGl) {
        window.__canvasProbe.error = 'missing WebGL2 3D canvas'
      } else {
        // 异步 PBO 回读：4 条横带覆盖画面中部，每条 720x16 像素；一次 readPixels
        // 写入 PIXEL_PACK_BUFFER 后 fence，下一次采样只在 fence 已 signal 时
        // getBufferSubData，避免同步等待 GPU。采样的是 3D 画布自身像素。
        const probeWMax = 720
        const probeH = 16
        const probeStrips = 4
        const probePx = new Uint8Array(probeWMax * probeH * 4 * probeStrips)
        const probePbo = probeGl.createBuffer()
        probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, probePbo)
        probeGl.bufferData(probeGl.PIXEL_PACK_BUFFER, probePx.byteLength, probeGl.STREAM_READ)
        probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, null)
        let probeSync = null
        let probePendingAt = 0
        let probeIssueMs = 0
        let probeUsed = 0
        let probeLast = -Infinity
        const probeLoop = () => {
          if (window.__canvasProbe.stopped) return
          const now = performance.now()
          // 计时窗口结束后不再发起新的回读；窗口外的一次变化不能作为窗口内持续绘制的证据。
          if (now > start + duration) {
            window.__canvasProbe.stopped = true
            return
          }
          if (probeSync) {
            const status = probeGl.clientWaitSync(probeSync, 0, 0)
            if (status === probeGl.ALREADY_SIGNALED || status === probeGl.CONDITION_SATISFIED) {
              const cpuStart = performance.now()
              probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, probePbo)
              probeGl.getBufferSubData(probeGl.PIXEL_PACK_BUFFER, 0, probePx, 0, probeUsed)
              probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, null)
              probeGl.deleteSync(probeSync)
              probeSync = null
              let hash = 2166136261
              const colors = new Set()
              for (let i = 0; i < probeUsed; i += 4) {
                if (!probePx[i + 3]) continue
                colors.add((probePx[i] << 16) | (probePx[i + 1] << 8) | probePx[i + 2])
                hash ^= probePx[i]; hash = Math.imul(hash, 16777619)
                hash ^= probePx[i + 1]; hash = Math.imul(hash, 16777619)
                hash ^= probePx[i + 2]; hash = Math.imul(hash, 16777619)
              }
              const cpuMs = performance.now() - cpuStart + probeIssueMs
              probeIssueMs = 0
              window.__canvasProbe.cpuMs += cpuMs
              window.__canvasProbe.samples++
              window.__canvasProbe.maxCpuMs = Math.max(window.__canvasProbe.maxCpuMs, cpuMs)
              window.__canvasProbe.frames.push({
                at: probePendingAt,
                hash: (hash >>> 0).toString(16),
                colors: colors.size,
              })
            }
          }
          if (!probeSync && now - probeLast >= 1500) {
            probeLast = now
            const issueStart = performance.now()
            const w = probeGl.drawingBufferWidth
            const h = probeGl.drawingBufferHeight
            const ww = Math.min(probeWMax, w)
            const x = Math.max(0, Math.floor((w - ww) / 2))
            probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, probePbo)
            let offset = 0
            for (let strip = 1; strip <= probeStrips; strip++) {
              const y = Math.max(0, Math.min(h - probeH, Math.floor(h * strip / 5) - probeH / 2))
              probeGl.readPixels(x, y, ww, probeH, probeGl.RGBA, probeGl.UNSIGNED_BYTE, offset)
              offset += ww * probeH * 4
            }
            probeGl.bindBuffer(probeGl.PIXEL_PACK_BUFFER, null)
            probeUsed = offset
            probeSync = probeGl.fenceSync(probeGl.SYNC_GPU_COMMANDS_COMPLETE, 0)
            probePendingAt = now - start
            probeIssueMs = performance.now() - issueStart
            probeGl.flush()
          }
          requestAnimationFrame(probeLoop)
        }
        requestAnimationFrame(probeLoop)
        }
      }
      window.__lt = []
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) if (e.startTime >= start && e.startTime < start + duration) window.__lt.push([e.startTime,e.duration])
      }).observe({type:'longtask',buffered:false})
    })()`)
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
    let scoredEvidence = null
    let canvasProbe = null
    if (!perf) {
      await page.evaluate('window.__canvasProbe.stopped = true')
      await delay(400)
      canvasProbe = await page.evaluate('({ frames: window.__canvasProbe.frames, error: window.__canvasProbe.error, cpuMs: window.__canvasProbe.cpuMs, samples: window.__canvasProbe.samples, maxCpuMs: window.__canvasProbe.maxCpuMs })')
      if (canvasProbe.error) throw new Error('Canvas probe failed: ' + canvasProbe.error)
      scoredEvidence = verifyScoredFrames(canvasProbe.frames, { durationMs: SECS * 1000, maxGapMs: 2500 })
      scoredEvidence.source = 'webgl-strips-async'
      scoredEvidence.probeError = canvasProbe.error
      // 采样成本只算 getBufferSubData/hash 的同步 CPU；GPU 异步回读已在 fence 后，
      // 百分比用于证明连续门禁没有把评分拖成另一个负载。
      scoredEvidence.probeCpuMs = Math.round(canvasProbe.cpuMs * 10) / 10
      scoredEvidence.probeSamples = canvasProbe.samples
      scoredEvidence.probeMaxCpuMs = Math.round(canvasProbe.maxCpuMs * 10) / 10
      scoredEvidence.probeCpuPct = Math.round((canvasProbe.cpuMs / (SECS * 1000)) * 1000) / 10
      scoredEvidence.hashes = canvasProbe.frames.map(frame => [Math.round(frame.at), frame.hash, frame.colors])
    }
    const cap = perf && await page.evaluate(`window.__pbPerf.stopCapture()`)
    const snap = perf && await page.evaluate(`(()=>{const s=window.__pbPerf.snapshot(); return {identity:s.identity, resources:s.resources, armorRt:s.armorRt, gpu:s.gpu, slowest:s.slowest, events:s.events, annotation:s.annotation}})()`)
    let profile = null
    if (PROFILE) { profile = (await chrome.client.send('Profiler.stop', {}, sid)).profile }
    const raf = await page.evaluate("({ts:window.__raf.ts, lt:window.__lt, ghost:window.__ghost, start:window.__raf.start, timelineStart:window.__raf.timelineStart, timelineEnd:window.__raf.timelineEnd ?? Number(document.querySelector('input.pb-range').value)})")
    await page.evaluate('clearInterval(window.__ghost.timer)')
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
    const stageAfter = !perf && await page.probe(sampleRenderedStage)
    const out = {
      stageBefore, stageAfter, canvasProbe,
      name, fixture, scenario: id, sc, rate, windowSize, secs: SECS, captureMode: policy.mode, runId: policy.runId, scoredScene, scoredEvidence, stat, frameStat, captureStats: cap?.statistics,
      captureEvents: cap?.events, captureDroppedEvents: cap?.droppedEvents,
      loadingEvents: pre?.loadingEvents, captureReason: cap?.reason, interrupted: cap?.interrupted,
      identity: cap?.identity ?? snap?.identity,
      resources: snap?.resources, gpu: snap?.gpu, raf, frames: fr, sourceSha, localTrackedPatchSha256, servedEntry,
      product, renderer, dataset, assets, wasm, viewport, replayDigest, playbackSpeed, perf, followTank, startedAt: cap?.startedAt, stoppedAt: cap?.stoppedAt,
      lastKnown: LAST_KNOWN, ghost: LAST_KNOWN === null ? null : raf.ghost,
    }
    if (profile) out.profile = { p0: profile.startTime / 1000 - navigationStartMs, startTime: profile.startTime, nodes: profile.nodes, samples: profile.samples, timeDeltas: profile.timeDeltas }
    if (args.includes('--count-anchors')) out.anchorWrites = await page.evaluate('window.__pbBenchAnchorWrites')
    if (cpuBefore && cpuAfter) {
      const names = ['Timestamp', 'TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
      out.chromeMetricDelta = Object.fromEntries(names.map(key => [key, cpuAfter[key] - cpuBefore[key]]))
      if (cpuMid) out.first30MetricDelta = Object.fromEntries(names.map(key => [key, cpuMid[key] - cpuBefore[key]]))
    }
    writeFileSync(`out/${name}.json`, JSON.stringify(out), { flag: 'wx' })
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
        writeFileSync(`out/visual/${name}-${time}s.json`, JSON.stringify({ geometry, contentHash }), { flag: 'wx' })
        const { data } = await chrome.client.send('Page.captureScreenshot', { format: 'png' }, sid)
        writeFileSync(`out/${name}-${time}s.png`, Buffer.from(data, 'base64'), { flag: 'wx' })
        if (!rows.some(row => row.visible)) throw new Error('No projected label visible at ' + time + 's; rows=' + rows.length)
        console.log(time + 's label snapshot', rows.length, contentHash)
      }
    }
  } finally {
    await chrome.close()
  }
}
