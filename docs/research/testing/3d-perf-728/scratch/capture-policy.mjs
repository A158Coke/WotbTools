export function capturePolicy(args, seconds) {
  const scoring = args.includes('--no-perf')
  const hooks = ['--trace', '--profile', '--count-anchors'].filter(flag => args.includes(flag))
  if (scoring && hooks.length) throw new Error(`Scoring cannot enable diagnostic hooks: ${hooks.join(', ')}`)
  const runId = args.find(arg => arg.startsWith('--run-id='))?.slice('--run-id='.length)
  if (!runId || !/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('A safe --run-id is required for each capture')
  return { mode: scoring ? 'score' : 'diagnostic', seconds, runId, hooks: hooks.map(flag => flag.slice(2)) }
}

/**
 * Artifact identity: mode, window and run id are part of the file name, and diagnostic
 * hooks are recorded too, so a score run cannot share a path with a traced diagnostic run.
 */
export function captureName({ tag, fixture, scenario, rate, mode, seconds, runId, viewport, hooks = [] }) {
  const prefix = `${tag}${fixture.split('-')[0]}_${scenario}_x${rate}`
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error('Capture name contains unsafe characters')
  if (!viewport || !(viewport.width > 0) || !(viewport.height > 0) || !(viewport.dpr > 0)) {
    throw new Error('Capture name requires the emulated viewport')
  }
  const flags = [...hooks].sort()
  if (flags.some(flag => !/^[A-Za-z0-9_-]+$/.test(flag))) throw new Error('Capture name contains unsafe characters')
  const hookPart = flags.length ? '_' + flags.join('-') : ''
  return `${prefix}_${mode}_${seconds}s_${runId}_${viewport.width}x${viewport.height}dpr${viewport.dpr}${hookPart}`
}

export function verifyScoredEntry(entry, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest ?? '')) {
    throw new Error('Scoring requires the registered BENCH_ENTRY_SHA256')
  }
  if (!entry?.path?.startsWith('/assets/') || entry.sha256 !== expectedDigest) {
    throw new Error('Served production entry differs from the registered build')
  }
}

/**
 * Score-mode scene gate. It reads only what the production page exposes (URL, DOM,
 * file input, the live WebGL context) so scoring never enables ?perf or native hooks.
 */
export function verifyScoredScene({ url, perfHandle, inputFiles, expectedInput, camera, followed, expectedCamera, quality, expectedQuality, canvas }) {
  if (new URL(url).searchParams.has('perf') || perfHandle) {
    throw new Error('Scoring must not enable ?perf diagnostics')
  }
  const normalize = file => String(file).replace(/\\/g, '/').replace(/\/+$/, '')
  if (!expectedInput || !Array.isArray(inputFiles) ||
      !inputFiles.some(file => normalize(file) === normalize(expectedInput))) {
    throw new Error('Scoring replay input differs from the fixture')
  }
  const observedCamera = expectedCamera === 'follow' ? (followed ? 'follow' : null) : camera
  if (observedCamera !== expectedCamera) {
    throw new Error(`Scoring camera differs: expected ${expectedCamera}, got ${observedCamera}`)
  }
  if (!expectedQuality || quality !== expectedQuality) {
    throw new Error(`Scoring quality differs: expected ${expectedQuality}, got ${quality}`)
  }
  if (!canvas?.webgl || !(canvas.width > 0) || !(canvas.height > 0)) {
    throw new Error('3D canvas has no live WebGL drawing buffer')
  }
  return { camera: observedCamera, quality, input: expectedInput, canvas }
}

/**
 * Continuous-draw gate for score mode. CDP screencast frames come from the browser
 * compositor, not from a page hook, so they prove the measured window kept presenting
 * frames instead of only advancing rAF/UI clocks.
 */
export function verifyScoredFrames(frames, { durationMs, minFrames = 4, minSpanRatio = 0.5 }) {
  if (!Array.isArray(frames) || frames.length < minFrames) {
    throw new Error(`Scoring saw too few presented frames: ${frames?.length ?? 0}`)
  }
  const first = frames[0]
  const last = frames[frames.length - 1]
  const span = last.at - first.at
  if (!(span >= durationMs * minSpanRatio)) {
    throw new Error(`Scoring frames only span ${Math.round(span)} of ${durationMs} ms`)
  }
  const distinct = new Set(frames.map(frame => frame.hash)).size
  if (distinct < 2) throw new Error('Scoring saw a frozen screen')
  return { frames: frames.length, distinct, spanMs: span, firstAt: first.at, lastAt: last.at }
}

export function verifySceneResources(urls, expectedRoot, version, expectedDataset, requireVehicle) {
  if (!expectedRoot) throw new Error('BENCH_ASSET_ROOT is required to verify the served dataset')
  const root = new URL(expectedRoot)
  const base = root.pathname.replace(/\/$/, '')
  if (!expectedDataset || version.dataset_id !== expectedDataset ||
      !/^sha256:[a-f0-9]{64}$/i.test(version.content_digest)) throw new Error('Invalid dataset identity')
  const sources = { terrain: [], scenery: [], vehicles: [] }
  const maps = new Set()
  for (const raw of new Set(urls)) {
    const url = new URL(raw)
    const suffix = url.pathname.match(/(\/map\/([^/]+)\/(terrain\.u16\.bin|scenery\.glb)|\/glb\/\d+\/model\.glb)$/)
    if (!suffix) continue
    if (url.origin !== root.origin || url.pathname !== base + suffix[0]) {
      throw new Error('Mixed scene resource: ' + url.href)
    }
    if (suffix[1]?.includes('/map/')) maps.add(suffix[2])
    const group = suffix[3] === 'terrain.u16.bin' ? 'terrain' : suffix[3] === 'scenery.glb' ? 'scenery' : 'vehicles'
    sources[group].push(url.href)
  }
  if (maps.size > 1) throw new Error('Mixed map scene resources: ' + JSON.stringify([...maps]))
  if (!sources.terrain.length || !sources.scenery.length || (requireVehicle && !sources.vehicles.length)) {
    throw new Error('Missing required scene resources: ' + JSON.stringify({ sources, observed: urls.filter(raw => /terrain|scenery|model\.glb/.test(raw)).map(raw => new URL(raw).pathname).slice(-12) }))
  }
  return sources
}

// Called outside the timed interval. A canvas video frame alone can be blank.
export async function sampleRenderedStage() {
  const stage = document.querySelector('[data-testid=replay3d-stage] canvas')
  if (!stage || !stage.width || !stage.height) throw new Error('Missing 3D canvas')
  const stream = stage.captureStream(0)
  const track = stream.getVideoTracks()[0]
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  let timeout
  let frame
  try {
    track.requestFrame()
    const sample = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('No canvas frame')), 4000) }),
    ])
    frame = sample.value
    if (!frame) throw new Error('Missing canvas frame')
    const ctx = new OffscreenCanvas(32, 24).getContext('2d')
    ctx.drawImage(frame, 0, 0, 32, 24)
    const pixels = ctx.getImageData(0, 0, 32, 24).data
    const colors = new Set()
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
    }
    if (colors.size < 2) throw new Error('Empty or uniform 3D canvas')
    return { width: frame.displayWidth, height: frame.displayHeight, colors: colors.size }
  } finally {
    clearTimeout(timeout)
    frame?.close()
    track.stop()
    await reader.cancel()
    reader.releaseLock()
  }
}

