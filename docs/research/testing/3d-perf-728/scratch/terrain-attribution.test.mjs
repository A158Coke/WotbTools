import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeTerrainAttribution, formatTerrainAttribution } from './terrain-attribution.mjs'

const capture = {
  captureMode: 'diagnostic', perf: true, frameCount: 3,
  loadingEvents: [
    { stage: 'terrain-geometry', mode: 'initial', reason: 'map-load', at: 100, generation: 1, oldGeneration: 0, created: 1, disposed: 0, swapMs: 4, vertices: 10, indices: 12 },
    { stage: 'terrain-build', mode: 'sync', reason: 'first', at: 101 },
  ],
  captureEvents: [
    { stage: 'terrain-geometry', mode: 'worker', reason: 'lateral', at: 200, generation: 2, oldGeneration: 1, created: 2, disposed: 1, swapMs: 2, vertices: 20, indices: 24 },
  ],
  frames: [
    { at: 110, t: 1, terrainGeneration: 1, bufferDataCalls: 2, bufferDataBytes: 100, bufferSubDataCalls: 0, bufferSubDataBytes: 0, geometries: 1 },
    { at: 120, t: 2, terrainGeneration: 1, bufferDataCalls: 0, bufferDataBytes: 0, bufferSubDataCalls: 1, bufferSubDataBytes: 20, geometries: 1 },
    { at: 210, t: 3, terrainGeneration: 2, bufferDataCalls: 1, bufferDataBytes: 50, bufferSubDataCalls: 0, bufferSubDataBytes: 0, geometries: 2 },
  ],
}

test('attributes each generation to its own frames and never adds swapMs to upload time', () => {
  const view = analyzeTerrainAttribution(capture)
  assert.equal(view.mode, 'diagnostic')
  assert.equal(view.generations.length, 2)
  const [g1, g2] = view.generations
  assert.equal(g1.uploadCalls, 3)
  assert.equal(g1.uploadBytes, 120)
  assert.equal(g2.uploadCalls, 1)
  assert.equal(g2.uploadBytes, 50)
  assert.equal(g2.eventToFrameMs, 10)
  assert.equal(view.totals.calls, 4)
  assert.equal(view.totals.bytes, 170)
  assert.equal(view.maxFramesPerGeneration, 2)
  assert.match(formatTerrainAttribution(view), /gen 2 .* upload 1 calls \/ 50 bytes/)
})

test('score captures reject any perf attribution hook', () => {
  assert.deepEqual(analyzeTerrainAttribution({ captureMode: 'score', perf: false, frames: [] }), {
    mode: 'score', scoreHookClean: true, frameCount: 0, events: [], generations: [], totals: null,
  })
  assert.throws(() => analyzeTerrainAttribution({ captureMode: 'score', frames: [{ bufferDataCalls: 1 }] }), /hooks/)
  assert.throws(() => analyzeTerrainAttribution({ captureMode: 'score', frames: [], captureEvents: [{ stage: 'terrain-geometry' }] }), /hooks/)
})

test('rejects non-object capture', () => {
  assert.throws(() => analyzeTerrainAttribution(null), /object/)
})
