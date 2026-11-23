// 地形换装/上传归因（?perf 采集产物 → 有界汇总；不参与评分）。
// 用法：node terrain-attribution.mjs out/<capture>.json [--json]
// 只回答三件事：哪一代几何、何时换装、换装帧上传了多少；不把 swapMs 与上传时间相加。
import { readFileSync } from 'node:fs'

const UPLOAD_KEYS = ['bufferDataCalls', 'bufferDataBytes', 'bufferSubDataCalls', 'bufferSubDataBytes']

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 合并 loadingEvents 与 captureEvents，按 (stage, at, mode) 去重。 */
function terrainEvents(capture) {
  const all = [...(capture.loadingEvents ?? []), ...(capture.captureEvents ?? [])]
  const seen = new Set()
  const rows = []
  for (const event of all) {
    if (!event || event.stage !== 'terrain-geometry') continue
    const key = [event.at, event.mode, event.generation, event.reason].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      at: num(event.at), mode: event.mode ?? null, reason: event.reason ?? null,
      generation: num(event.generation), oldGeneration: num(event.oldGeneration),
      created: num(event.created), disposed: num(event.disposed),
      vertices: num(event.vertices), indices: num(event.indices),
      attributeBytes: num(event.attributeBytes), indexBytes: num(event.indexBytes),
      swapMs: num(event.swapMs),
    })
  }
  return rows.sort((a, b) => a.at - b.at)
}

function frameUpload(frame) {
  const upload = {}
  for (const key of UPLOAD_KEYS) upload[key] = num(frame?.[key])
  upload.calls = upload.bufferDataCalls + upload.bufferSubDataCalls
  upload.bytes = upload.bufferDataBytes + upload.bufferSubDataBytes
  return upload
}

/**
 * @param {Record<string, unknown>} capture run.mjs 写出的 JSON
 * @returns 归因视图；评分采集（--no-perf）必须没有任何逐帧上传字段。
 */
export function analyzeTerrainAttribution(capture) {
  if (!capture || typeof capture !== 'object') throw new Error('capture must be an object')
  const frames = Array.isArray(capture.frames) ? capture.frames : []
  const scoreMode = capture.captureMode === 'score' || capture.perf === false
  if (scoreMode) {
    const leaking = frames.filter(frame => UPLOAD_KEYS.some(key => key in (frame ?? {})))
    if (leaking.length || capture.captureEvents?.length) {
      throw new Error('score capture contains ?perf attribution hooks')
    }
    return { mode: 'score', scoreHookClean: true, frameCount: 0, events: [], generations: [], totals: null }
  }
  const events = terrainEvents(capture)
  const generations = new Map()
  for (const event of events) {
    const bucket = generations.get(event.generation) ?? {
      generation: event.generation, oldGeneration: event.oldGeneration, mode: event.mode, reason: event.reason,
      at: event.at, swapMs: event.swapMs, created: event.created, disposed: event.disposed,
      vertices: event.vertices, indices: event.indices, attributeBytes: event.attributeBytes, indexBytes: event.indexBytes,
      frames: 0, bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 0, bufferSubDataBytes: 0,
      uploadCalls: 0, uploadBytes: 0,
    }
    generations.set(event.generation, bucket)
  }
  const firstFrameByGeneration = new Map()
  for (const frame of frames) {
    const generation = num(frame?.terrainGeneration)
    const bucket = generations.get(generation)
    if (bucket) {
      const upload = frameUpload(frame)
      bucket.frames += 1
      bucket.bufferDataCalls += upload.bufferDataCalls
      bucket.bufferDataBytes += upload.bufferDataBytes
      bucket.bufferSubDataCalls += upload.bufferSubDataCalls
      bucket.bufferSubDataBytes += upload.bufferSubDataBytes
      bucket.uploadCalls += upload.calls
      bucket.uploadBytes += upload.bytes
      if (!firstFrameByGeneration.has(generation)) firstFrameByGeneration.set(generation, frame)
    }
  }
  const rows = [...generations.values()].map(bucket => {
    const first = firstFrameByGeneration.get(bucket.generation)
    const firstUpload = first ? frameUpload(first) : null
    return {
      ...bucket,
      firstFrameAt: first ? num(first.at) : null,
      firstFrameUploadCalls: firstUpload?.calls ?? null,
      firstFrameUploadBytes: firstUpload?.bytes ?? null,
      // 换装发生在该帧的 tick 中，渲染上传随后同帧记录；用事件到下一帧的间隔核对对齐。
      eventToFrameMs: first ? Math.max(0, num(first.at) - bucket.at) : null,
    }
  })
  const uploadFrames = frames.filter(frame => frameUpload(frame).calls > 0)
  const byFrame = uploadFrames.map(frame => ({
    at: num(frame.at), t: num(frame.t), generation: num(frame.terrainGeneration),
    ...frameUpload(frame), geometries: frame.geometries ?? null,
  }))
  const totals = byFrame.reduce((sum, frame) => ({
    calls: sum.calls + frame.calls, bytes: sum.bytes + frame.bytes,
    bufferDataCalls: sum.bufferDataCalls + frame.bufferDataCalls,
    bufferSubDataCalls: sum.bufferSubDataCalls + frame.bufferSubDataCalls,
  }), { calls: 0, bytes: 0, bufferDataCalls: 0, bufferSubDataCalls: 0 })
  return {
    mode: 'diagnostic', scoreHookClean: false, frameCount: frames.length, eventCount: events.length,
    // 只保留逐代/逐帧有界聚合；不累加父子阶段（swapMs 与上传是并列区间）。
    events, generations: rows, uploadFrames: byFrame, totals,
    maxFramesPerGeneration: rows.reduce((max, row) => Math.max(max, row.frames), 0),
  }
}

export function formatTerrainAttribution(view) {
  if (view.mode === 'score') return 'score capture: attribution hooks disabled (clean)'
  const lines = [
    'terrain attribution: ' + view.eventCount + ' camera-LOD generation(s), ' + view.frameCount + ' frames, upload ' + view.totals.calls + ' calls / ' + view.totals.bytes + ' bytes',
  ]
  for (const row of view.generations) {
    lines.push('gen ' + row.generation + ' (old ' + row.oldGeneration + ', ' + row.mode + '/' + row.reason + '): swap ' + row.swapMs.toFixed(2) + ' ms; upload ' + row.uploadCalls + ' calls / ' + row.uploadBytes + ' bytes over ' + row.frames + ' frames; first-frame upload ' + (row.firstFrameUploadCalls ?? 'n/a') + ' calls after ' + (row.eventToFrameMs === null ? 'n/a' : row.eventToFrameMs.toFixed(2) + ' ms'))
  }
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('terrain-attribution.mjs')) {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: node terrain-attribution.mjs <capture.json> [--json]')
  const view = analyzeTerrainAttribution(JSON.parse(readFileSync(file, 'utf8')))
  console.log(process.argv.includes('--json') ? JSON.stringify(view, null, 2) : formatTerrainAttribution(view))
}
