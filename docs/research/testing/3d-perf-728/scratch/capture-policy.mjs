export function capturePolicy(args, seconds) {
  const scoring = args.includes('--no-perf')
  const hooks = ['--trace', '--profile', '--count-anchors'].filter(flag => args.includes(flag))
  if (scoring && hooks.length) throw new Error(`Scoring cannot enable diagnostic hooks: ${hooks.join(', ')}`)
  const runId = args.find(arg => arg.startsWith('--run-id='))?.slice('--run-id='.length)
  if (!runId || !/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('A safe --run-id is required for each capture')
  return { mode: scoring ? 'score' : 'diagnostic', seconds, runId }
}

export function captureName({ tag, fixture, scenario, rate, mode, seconds, runId }) {
  const prefix = `${tag}${fixture.split('-')[0]}_${scenario}_x${rate}`
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error('Capture name contains unsafe characters')
  return `${prefix}_${mode}_${seconds}s_${runId}`
}

export function verifyScoredEntry(entry, expectedDigest) {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest ?? '')) {
    throw new Error('Scoring requires the registered BENCH_ENTRY_SHA256')
  }
  if (!entry?.path?.startsWith('/assets/') || entry.sha256 !== expectedDigest) {
    throw new Error('Served production entry differs from the registered build')
  }
}

export function verifySceneResources(urls, expectedRoot, version, expectedDataset, requireVehicle) {
  const root = new URL(expectedRoot)
  const base = root.pathname.replace(/\/$/, '')
  if (!expectedDataset || version.dataset_id !== expectedDataset ||
      !/^sha256:[a-f0-9]{64}$/i.test(version.content_digest)) throw new Error('Invalid dataset identity')
  const sources = { terrain: [], scenery: [], vehicles: [] }
  for (const raw of new Set(urls)) {
    const url = new URL(raw)
    const suffix = url.pathname.match(/(\/map\/[^/]+\/(terrain\.u16\.bin|scenery\.glb)|\/glb\/\d+\/model\.glb)$/)
    if (!suffix) continue
    if (url.origin !== root.origin || url.pathname !== base + suffix[0]) {
      throw new Error('Mixed scene resource: ' + url.href)
    }
    const group = suffix[2] === 'terrain.u16.bin' ? 'terrain' : suffix[2] === 'scenery.glb' ? 'scenery' : 'vehicles'
    sources[group].push(url.href)
  }
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

